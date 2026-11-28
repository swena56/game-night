"""Key Clash (#374): a typing battle. Everyone types the same stream of words at once; each word typed
right is an attack on a rival. Longer words hit harder, perfect words in a row build a combo, and a full
charge offers three power words (shield, strike, heal) that fire when typed. A typo breaks the combo
and must be fixed for the word to count. A round ends at a knock-out or when the clock runs out;
first to win most of the rounds takes the match.

Modes: ⚔️ Duel (two fighters), 🏟️ Last Typist Standing (everyone; each word hits your target, the last
one up wins the round), ⌨️ Pure Typing (no fighting: the most letters typed right wins the round), and
(#376) 🏰 Castle Siege (words send soldiers at a rival's castle, or cut down soldiers close to yours),
🧟 Survival (the same waves of enemies walk at everyone; each word hits your front one), 👹 Boss Rush
(everyone fights an identical boss that hits back on one shared beat; first to beat theirs wins),
🚀 Hyperdrive (a race to the line; a combo boosts your ship) and 🪢 Tug-of-War (two teams; every word
pulls the rope).

Typing happens in the browser, which sends each finished word with the number of typos made on it; the
server checks the word against the shared stream, times it on its own clock and keeps all the scores.
Bots type at a steady speed by level and sometimes make a typo, which costs them time and their combo."""
from bisect import bisect_right
import functools
import os
import time

from operator import itemgetter

from .base import Game, GameError
from .garden import BASE6, BASE7
from .keyclash_words import THEME_NAMES, THEMES
from .ladder_words import COMMON

HP = 100
REVEAL_SECS = 6
READY_SECS, COUNTDOWN_SECS = 15, 3
STREAM = 400                 # words in a round's stream: more than anyone types in the longest round
WINDOW = 40                  # words of it sent ahead of where each viewer is
CHARGE = 100
MIN_CHAR_SECS = 0.03         # faster than this per letter (400 wpm) can't be a person typing
BOT_WPM = {"easy": 24, "normal": 40, "hard": 62}
BOT_SLIP = {"easy": 0.12, "normal": 0.06, "hard": 0.02}   # chance a bot's word has a typo in it

LONG = """ADVENTURE AFTERNOON ALPHABET ANYTHING BASEBALL BIRTHDAY BLUEBERRY BUTTERFLY CALENDAR CAMPFIRE
    CHAMPION CHOCOLATE COMPUTER CROCODILE DAYLIGHT DINOSAUR DISCOVERY ELEPHANT ENVELOPE EVERYTHING EXCELLENT
    FIREWORKS FOOTBALL FOUNTAIN FRIENDSHIP GALAXY GRANDMOTHER HAMBURGER HAPPINESS HARMONICA HEADPHONES
    HELICOPTER HOMEWORK HORIZON IMPORTANT INVENTION KANGAROO KEYBOARD LANGUAGE LIGHTNING MAGAZINE MARATHON
    MIDNIGHT MOUNTAIN MUSHROOM NEIGHBOR NOTEBOOK OCTOPUS PANCAKE PARACHUTE PENGUIN PINEAPPLE PLAYGROUND
    POPCORN PRINCESS QUESTION RAINCOAT SANDWICH SKELETON SNOWFLAKE SOMETHING SPAGHETTI STRAWBERRY SUNFLOWER
    SUNSHINE SURPRISE TELESCOPE THUNDER TOMORROW TREASURE TRIANGLE UMBRELLA UNIVERSE VACATION VOLCANO
    WATERFALL WEEKEND WHISPER WONDERFUL YESTERDAY ZEPPELIN ASTRONAUT BACKPACK BLIZZARD CARNIVAL CATERPILLAR
    DETECTIVE DRAGONFLY FLAMINGO GARDENING GRASSHOPPER HURRICANE JELLYFISH LABYRINTH MARSHMALLOW MOONLIGHT
    NIGHTINGALE ORCHESTRA PAINTBRUSH PEPPERMINT PORCUPINE QUICKSAND RATTLESNAKE SCARECROW SEAHORSE STARFISH
    SUBMARINE THERMOMETER TOOTHBRUSH TRAMPOLINE WATERMELON WOODPECKER""".split()

POWER = {   # power words a full charge offers, one of each kind
    "shield": ["guard", "barrier", "bulwark", "fortress", "aegis", "rampart"],
    "strike": ["thunder", "meteor", "avalanche", "tempest", "lightning", "comet"],
    "heal": ["remedy", "restore", "recover", "mend", "soothe", "revive"],
}
LESSON_WORDS = {
    "home-row": ("ask", "sad", "all", "fall", "lass", "salad", "flask", "adds", "glass", "shall"),
    "top-row": ("type", "write", "quiet", "power", "query", "tower", "poetry", "pretty", "upper", "quote"),
    "bottom-row": ("zoom", "cabin", "combine", "maximum", "ban", "can", "man", "van", "mix", "box"),
    "reach": ("quick", "jazz", "quiz", "zero", "sphinx", "fuzzy", "jumpy", "zippy", "fizz", "buzz"),
    "accuracy": ("accurate", "practice", "keyboard", "remember", "carefully", "mistakes", "rhythm", "success", "focus", "steady"),
}
SHIELD, STRIKE, HEAL = 15, 16, 18
# 🏰 Castle Siege: soldiers march MARCH s; a word cuts down soldiers past the halfway mark first
MARCH = 5.0
# 🧟 Survival: wave w has 3 + w enemies of 4 + 2w health, one every SPAWN_GAP s, walking for max(4, 7 - 0.3w) s
SPAWN_GAP, WAVE_GAP = 1.6, 3.0
FOE_SPAWN, FOE_ARRIVAL = itemgetter("spawn"), itemgetter("arrive")
# 👹 Boss Rush: each boss has BOSS_HP and hits every fighter for BOSS_HIT every BOSS_EVERY s
BOSS_HP, BOSS_HIT, BOSS_EVERY = 120, 6, 5.0
# 🚀 Hyperdrive: the finish line; 🪢 Tug-of-War: the rope wins at ±ROPE
TRACK, ROPE = 160, 60
# (#379) "No limit": a round runs until someone wins, under a hidden cap so a stalemate can't run forever;
# Pure Typing, which has no finish of its own, becomes a race to RACE_GOAL letters
NO_LIMIT, RACE_GOAL = 15 * 60, 400
# ... and after OVERTIME s every hit and pull grows by half again each minute, and castles stop cutting down soldiers,
# so two even sides can't stall (even bots ran Castle Siege to 14 min and Tug-of-War to the cap without it)
OVERTIME = 120
POWERED = ("duel", "lms", "siege", "survival", "boss")   # the modes with power words
TEAMS = ("🔴 Red", "🔵 Blue")


@functools.lru_cache(maxsize=None)
def dictionary():
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "words.txt")) as f:
            return frozenset(w.strip().lower() for w in f)
    except OSError:
        return None


@functools.lru_cache(maxsize=None)
def themed(theme):
    """(#382) a theme's words that are real words (checked against data/words.txt)."""
    d = dictionary()
    return tuple(sorted(w for w in set(THEMES[theme].split()) if d is None or w in d))


@functools.lru_cache(maxsize=None)
def pool(level, theme="mixed"):
    """The words a round can use: by length for the level, from one theme or (mixed) everything."""
    if theme in THEMES:
        source = set(themed(theme))
    else:
        source = ({w.lower() for n in (3, 4, 5) for w in COMMON[n]} | {w.lower() for w in BASE6 + BASE7 + LONG}
                  | {w for t in THEMES for w in themed(t)})
    fits = {"easy": lambda w: len(w) <= 5, "normal": lambda w: 4 <= len(w) <= 7, "hard": lambda w: len(w) >= 6}[level]
    words = sorted(w for w in source if fits(w) and w.isalpha())
    return tuple(words if len(words) >= 40 else sorted(source))   # a small theme at an odd length: all of it


class KeyClash(Game):
    id = "keyclash"
    category = "words"
    name = "Key Clash"
    icon = "⌨️"
    blurb = "A typing battle: every word you type right is a hit on your rival."
    howto = [
        "Everyone types the same words. Press space (or Enter) after each one.",
        "Each word typed right is a hit: longer words hit harder, perfect words in a row build a combo.",
        "A typo breaks your combo. Fix it to earn credit, or enable skipping regular words in Typing settings.",
        f"Fill the ⚡ charge, select a power (Alt+1, Alt+2 or Alt+3), then type its word to 🛡️ shield (blocks the next {SHIELD} damage), 💥 strike (a big hit) or 💚 heal (+{HEAL} health).",
        "Eight modes: duel, free-for-all, castles, waves, bosses, a race, a ship race and a tug-of-war.",
    ]
    tip_lines = ["Accuracy beats speed: a typo costs time and your combo."]
    min_players = 1
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "flawless": ("✨", "Flawless", "Win a round without losing any health"),
              "streak": ("🔥", "On fire", "Type 25 perfect words in a row")}
    MODES = [("duel", "⚔️ Duel"), ("lms", "🏟️ Last Typist Standing"), ("siege", "🏰 Castle Siege"),
             ("survival", "🧟 Survival"), ("boss", "👹 Boss Rush"), ("hyper", "🚀 Hyperdrive"),
             ("tug", "🪢 Tug-of-War"), ("race", "⌨️ Pure Typing")]
    settings_schema = {
        "mode": ("Mode", MODES, "duel"),
        "words": ("Words", [("easy", "Short"), ("normal", "Everyday"), ("hard", "Long")], "normal"),
        "theme": ("Theme", list(THEME_NAMES.items()), "mixed"),
        "lesson": ("Training lesson", [("mixed", "Mixed words"), *[(key, key.replace("-", " ").title()) for key in LESSON_WORDS]], "mixed"),
        "secs": ("Round", [(45, "45 s"), (60, "1 min"), (90, "90 s"), (120, "2 min"), (0, "Play to win (15 min cutoff)")], 60),
        "rounds": ("Match", [(1, "1 round"), (3, "Best of 3"), (5, "Best of 5")], 3),
        "round_ready": ("Round start", [("off", "Immediate"), ("countdown", "3-second countdown"),
                                        ("ready", "Wait for typists (up to 15 s)")], "off"),
    }

    def teams_for(self, seated):
        choices = self.s.get("tug_teams", {})
        teams = {p.id: choices[p.id] for p in seated if p.id in choices}
        counts = [list(teams.values()).count(side) for side in range(len(TEAMS))]
        for p in seated:
            if p.id not in teams:
                side = int(counts[1] < counts[0])
                teams[p.id] = side
                counts[side] += 1
        return teams

    def change_team(self, pid, side):
        seated = self.room.seated()
        if not isinstance(pid, str) or not any(p.id == pid for p in seated):
            raise GameError("Choose a seated typist.")
        if side is not None and (type(side) is not int or side not in (0, 1)):
            raise GameError("Choose Red, Blue, or Auto.")
        choices = {p.id: self.s["tug_teams"][p.id] for p in seated if p.id in self.s.get("tug_teams", {})}
        if side is None:
            choices.pop(pid, None)
        else:
            choices[pid] = side
        self.s["tug_teams"] = choices

    def check_players(self, seated):
        super().check_players(seated)
        mode = self.s["mode"]
        if mode == "duel" and len(seated) != 2:
            raise GameError("A Duel is for two fighters: pick Last Typist Standing for more, or Pure Typing.")
        if mode in ("lms", "siege", "tug") and len(seated) < 2:
            raise GameError(f"{dict(self.MODES)[mode]} needs at least two typists.")
        if mode == "tug" and len(set(self.teams_for(seated).values())) < 2:
            raise GameError("Seat at least one typist on each Tug-of-War team.")

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0              # the bot simulator fast-forwards this clock
        self.gid = f"{time.time():.3f}"   # this game: a rematch starts at round 1 again, so screens key on game and round
        self.mode = self.s["mode"]
        self.ids = [p.id for p in seated]
        self.need = self.s["rounds"] // 2 + 1
        self.round = 0
        self.practice_words = {}
        self.history = []            # (#381) each finished round's stats and typing traces, for the charts afterwards
        self.events = []             # recent hits for the screens to animate: {n, kind, by, to, dmg, t}
        self.seq = 0
        teams = self.teams_for(seated) if self.mode == "tug" else {}
        for p in seated:
            p.g.wins = 0
            p.g.dealt_total = 0
            p.g.chars_total = 0
            p.g.errs_total = 0
            p.g.best_combo = 0
            p.g.team = teams.get(p.id, 0)
        self.room.turn = None
        self.room.bot_at = 0
        mode = dict(self.MODES)[self.mode]
        if self.mode == "tug":
            teams = " vs ".join(f"{TEAMS[t]} ({', '.join(p.name for p in seated if p.g.team == t)})" for t in (0, 1))
            mode += f": {teams}"
        limit = "play to win (15-minute cutoff)" + (f", first to {RACE_GOAL} letters" if self.mode == "race" else "") if not self.s["secs"] else f"{self.s['secs']} s rounds"
        if self.s.get("lesson", "mixed") != "mixed":
            mode += f" · {self.s['lesson'].replace('-', ' ')} lesson"
        self.room.add_log(f"⌨️ Key Clash: {mode}, {limit}, first to {self.need} round{'s' if self.need > 1 else ''}. Get typing!", "big")
        self.next_round()

    # a game saved by older code (a dev-server restart mid-game) lacks state added since: fill it in, so it carries on
    GAME_DEFAULTS = {"overtime": False, "timers": [], "armies": [], "foes": [], "rope": 0.0, "gid": "", "events": [], "seq": 0,
                     "history": [], "round_ready": set(), "practice_words": {}}
    PLAYER_DEFAULTS = {"dist": 0.0, "kills": 0, "boss": BOSS_HP, "foe_hp": {}, "team": 0, "trace": [], "skips": 0, "skip_errors": 0, "ko_at": None}

    def __setstate__(self, state):
        self.__dict__.update(state)
        for k, v in self.GAME_DEFAULTS.items():
            if not hasattr(self, k):
                setattr(self, k, type(v)(v) if isinstance(v, (list, dict, set)) else v)
        self.upgraded = False

    def upgrade(self):
        """Fill in per-player state an older save lacks (players aren't ready yet while the game unpickles)."""
        if getattr(self, "upgraded", True):
            return
        self.upgraded = True
        for k, q in enumerate(self.live()):
            for key, v in self.PLAYER_DEFAULTS.items():
                if hasattr(q.g, "idx") and not hasattr(q.g, key):
                    setattr(q.g, key, (k % 2) if key == "team" else type(v)(v) if isinstance(v, (list, dict)) else v)

    def now(self):
        event_at = getattr(self, 'event_at', None)
        return time.time() + self.skew if event_at is None else event_at

    def on_restore(self, shift):
        self.skew -= shift

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def fighting(self):
        return [p for p in self.live() if not p.g.ko]

    def next_round(self):
        self.round += 1
        self.mark_round()
        words = self.word_pool()
        self.words = [self.rng.choice(words) for _ in range(STREAM)]
        self.t0 = self.now()
        self.events = []
        self.result = None
        self.overtime = False
        self.plans = []
        self.timers = []             # (time, kind, data): soldiers arriving, enemies arriving, the boss's beat
        self.armies = []             # 🏰 {n, by, to, power, t0}
        self.rope = 0.0              # 🪢 below 0 red is winning, above 0 blue
        self.foes = []               # 🧟 the round's enemies, the same for everyone: {i, hp, spawn, arrive, wave}
        for p in self.live():
            g = p.g
            g.idx, g.hp, g.shield, g.combo, g.charge = 0, HP, 0, 0, 0
            g.chars, g.errs, g.words, g.dealt, g.taken, g.ko = 0, 0, 0, 0, 0, False
            g.skips, g.skip_errors, g.ko_at = 0, 0, None
            g.offer, g.last_at, g.by = None, self.t0, None
            g.dist, g.kills, g.boss = 0.0, 0, BOSS_HP
            g.foe_hp = {}            # 🧟 enemy index -> health left, once hit
            g.trace = []             # (#381) every word: [seconds into the round, letters so far, typos on it]
        self.round_ready = set()
        setting = self.s.get("round_ready", "off")
        if setting == "ready":
            self.stage = "ready"
            self.end = self.now() + READY_SECS
            self.sync()
        elif setting == "countdown":
            self.start_countdown()
        else:
            self.begin_round()

    def start_countdown(self):
        self.stage = "countdown"
        self.end = self.now() + COUNTDOWN_SECS
        self.sync()

    def begin_round(self):
        self.stage = "play"
        self.t0 = self.now()
        self.end = self.t0 + (self.s["secs"] or NO_LIMIT)
        if self.mode == "survival":
            t, w = self.t0 + 2.0, 1
            while t < self.end:
                for _ in range(3 + w):
                    self.foes.append({"i": len(self.foes), "hp": 4 + 2 * w, "spawn": t, "arrive": t + max(4.0, 7 - 0.3 * w), "wave": w})
                    self.timers.append((self.foes[-1]["arrive"], "foe", len(self.foes) - 1))
                    t += SPAWN_GAP
                t += WAVE_GAP
                w += 1
        if self.mode == "boss":
            self.timer(self.t0 + BOSS_EVERY, "boss", None)
        if not self.s["secs"] and self.mode in ("duel", "lms", "siege", "boss", "tug"):
            self.timer(self.t0 + OVERTIME, "overtime", None)
        for p in self.live():
            p.g.last_at = self.t0
            if p.bot:
                self.plan(p)
        self.sync()
        self.room.add_log(f"🔔 Round {self.round}: " + {"race": "type!", "hyper": "engines on!", "tug": "pull!",
                                                       "survival": "here they come!", "boss": "the boss awakes!"}.get(self.mode, "fight!"), "question")

    def word_pool(self):
        lesson = self.s.get("lesson", "mixed")
        return LESSON_WORDS[lesson] if lesson in LESSON_WORDS else pool(self.s["words"], self.s.get("theme", "mixed"))

    def timer(self, t, kind, data):
        self.timers.append((t, kind, data))
        self.timers.sort(key=lambda x: x[0])

    # -- the clock (as in games/puzzlerace.py)

    def bot_secs(self, p, word):
        """How long bot p takes over `word` (and whether it slipped on it)."""
        wpm = BOT_WPM.get(p.bot or "normal", 40) * self.rng.uniform(0.85, 1.15)
        secs = (len(word) + 1) / (wpm * 5 / 60)
        slip = self.rng.random() < BOT_SLIP.get(p.bot or "normal", 0.06)
        return secs + (self.rng.uniform(0.5, 1.0) if slip else 0), slip

    def plan(self, p):
        self.plans = [x for x in self.plans if x[1] != p.id]
        word = self.bot_choice(p)
        secs, slip = self.bot_secs(p, word[1])
        self.plans.append((self.now() + secs, p.id, word, slip))
        self.plans.sort(key=lambda x: x[0])

    def bot_choice(self, p):
        """(power kind or None, word) the bot will type next."""
        g = p.g
        if g.offer:
            others = [q for q in self.fighting() if q.id != p.id]
            danger = max((q.g.charge for q in others), default=0) >= 70 or self.mode in ("boss", "survival")
            if g.hp < 45:
                kind = "heal"
            elif p.bot == "hard" and danger and g.hp < 75:
                kind = "shield"
            else:
                kind = "strike"
            return kind, g.offer[kind]
        return None, self.words[g.idx]

    def sync(self):
        self.room.deadline = self.next_event() - self.skew

    def next_event(self):
        return min([self.end] + [x[0] for x in self.plans[:1]] + [x[0] for x in self.timers[:1]])

    def bot_ready(self):
        return self.room.phase == "playing" and self.now() >= self.next_event()

    def bot_tick(self):
        self.process()

    def on_timeout(self):
        gap = self.next_event() - self.now()
        if gap > 0:
            self.skew += gap
        self.process()

    def process(self):
        self.upgrade()
        now = self.now()
        if self.stage == "ready":
            if now >= self.end:
                self.start_countdown()
            return
        if self.stage == "countdown":
            if now >= self.end:
                self.begin_round()
            return
        if self.stage == "reveal":
            if now >= self.end:
                self.next_match_step()
            return
        # The deadline wins ties with scheduled events.
        while self.stage == "play":
            due = [x for x in (self.plans[:1] + self.timers[:1]) if x[0] <= now and x[0] < self.end]
            if not due:
                break
            first = min(due, key=lambda x: x[0])
            self.event_at = first[0]
            try:
                self.apply_event(first)
            finally:
                self.event_at = None
        if self.stage != "play":
            return
        if now >= self.end:
            return self.round_over(None)
        self.sync()

    def apply_event(self, event):
        if self.timers and event is self.timers[0]:
            _, kind, data = self.timers.pop(0)
            self.fire(kind, data)
            return
        _, pid, (kind, word), slip = self.plans.pop(0)
        p = self.room.players.get(pid)
        if not p or p not in self.fighting():
            return
        if kind and p.g.offer and p.g.offer.get(kind) == word:
            self.power(p, kind, word, int(slip))
        elif not kind and self.words[p.g.idx] == word:
            self.typed(p, word, int(slip))
        if self.stage == "play" and p in self.fighting():
            self.plan(p)

    def surge(self):
        """How much harder everything hits in overtime (1 before it)."""
        return 1 + 0.5 * max(0.0, self.now() - self.t0 - OVERTIME) / 60 if self.overtime else 1

    def rope_line(self):
        """🪢 How far the rope must go to win: in overtime the lines creep in, a quarter each minute, to a fifth."""
        if not self.overtime:
            return ROPE
        return ROPE * max(0.2, 1 - 0.25 * max(0.0, self.now() - self.t0 - OVERTIME) / 60)

    def fire(self, kind, data):
        """A timed event comes due."""
        if kind == "overtime":
            self.overtime = True
            effect = {
                "siege": "Hits grow stronger and castles stop blocking armies.",
                "boss": "Your hits on the boss grow stronger.",
                "tug": "Pulls grow stronger and the line moves closer.",
            }.get(self.mode, "Hits grow stronger.")
            self.moment(f"⏱️ Overtime! {effect}", "bad", "alarm")
            return
        if kind == "army":       # 🏰 soldiers reach a castle
            a = next((x for x in self.armies if x["n"] == data), None)
            if not a:
                return
            self.armies.remove(a)
            by, to = self.room.players.get(a["by"]), self.room.players.get(a["to"])
            if by and to and to in self.fighting():
                self.hit(by, to, a["power"], "army")
        elif kind == "foe":      # 🧟 an enemy reaches everyone it's still alive for
            foe = self.foes[data]
            for p in self.fighting():
                if p.g.foe_hp.get(data, foe["hp"]) > 0:
                    p.g.foe_hp[data] = 0
                    self.hurt(p, 8 + foe["wave"], None, "bite")
                    if self.stage != "play":
                        return
        elif kind == "boss":     # 👹 every boss strikes at once
            for p in list(self.fighting()):
                if p.g.boss > 0:
                    self.hurt(p, BOSS_HIT, None, "boss")
                    if self.stage != "play":
                        return
            self.timer(self.now() + BOSS_EVERY, "boss", None)

    # -- actions

    def act(self, p, a):
        self.upgrade()
        action = a.get("type")
        if action == "clash_ready":
            if self.stage != "ready" or a.get("rid") != f"{getattr(self, 'gid', '')}:{self.round}":
                raise GameError("The countdown has already started.")
            if p not in self.live():
                raise GameError("You're watching this game.")
            self.round_ready.add(p.id)
            if all(q.bot or q.id in self.round_ready for q in self.live()):
                self.start_countdown()
            return
        if action not in ("word", "skip"):
            raise GameError("Unknown action.")
        skip = action == "skip"
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        if self.stage != "play" or self.now() >= self.end:
            raise GameError("This round is over.")
        if p.g.ko:
            raise GameError("You're knocked out until the next round.")
        word, errs = a.get("word"), a.get("errs", 0)
        if not isinstance(word, str) or type(errs) is not int or not 0 <= errs <= 99:
            raise GameError("Bad word.")
        # Older clients omit these fields. New clients bind queued words to a round and submission.
        if (skip or "rid" in a) and a.get("rid") != f"{getattr(self, 'gid', '')}:{self.round}":
            raise GameError("This round is over.")
        number = a.get("number")
        if (skip or "number" in a) and (type(number) is not int or number != p.g.words + 1):
            raise GameError("Out of step: that word was already counted.")
        if self.now() - p.g.last_at < len(word) * MIN_CHAR_SECS:
            raise GameError("Too fast.")
        offer = p.g.offer or {}
        if skip:
            kind = None
        elif "number" in a:
            kind = a.get("power")
            if kind is not None and (not isinstance(kind, str) or offer.get(kind) != word):
                raise GameError("That power word is no longer available.")
        else:
            kind = next((k for k, w in offer.items() if w == word), None)
        if kind:
            return self.power(p, kind, word, errs)
        i = a.get("i")
        if type(i) is not int or i != p.g.idx:
            raise GameError("Out of step: that word was already counted.")
        expected = self.words[i]
        if skip:
            if (a.get("power") is not None or len(word) < len(expected) or word == expected
                    or not word.isascii() or not word.isalpha() or not word.islower()):
                raise GameError("That word cannot be skipped.")
            mismatches = len(word) - len(expected) + sum(ch != typed for ch, typed in zip(expected, word))
            skip_errors = max(errs, mismatches)
            self.remember_miss(p, expected)
            self.count(p, "", skip_errors)
            p.g.skip_errors += skip_errors
            p.g.skips += 1
            self.advance_word(p)
            return
        if expected != word:
            raise GameError("That's not the word.")
        self.typed(p, word, errs)

    def target(self, p):
        """Who p's attacks hit: the rival in a Duel; otherwise whoever last hit p (while they're still up),
        else the one closest to going down (aiming at the healthiest ganged everyone up on the best typist)."""
        if self.mode not in ("duel", "lms", "siege"):
            return None
        rivals = [q for q in self.fighting() if q.id != p.id]
        if not rivals:
            return None
        back = next((q for q in rivals if q.id == p.g.by), None)
        return back or min(rivals, key=lambda q: (q.g.hp, self.ids.index(q.id)))

    def remember_miss(self, p, word):
        if p.bot:
            return
        words = self.practice_words.setdefault(p.id, [])
        if word not in words and len(words) < 40:
            words.append(word)

    def count(self, p, word, errs):
        g = p.g
        g.chars += len(word)
        g.errs += errs
        g.words += 1
        g.last_at = self.now()
        if len(g.trace) < 1500:
            g.trace.append([round(g.last_at - self.t0, 2), g.chars, errs])
        if errs:
            if word:
                self.remember_miss(p, word)
            g.combo = 0
        else:
            g.combo += 1
            g.best_combo = max(g.best_combo, g.combo)
            if g.combo == 25:
                self.award(p, "streak")
                self.moment(f"🔥 {p.name}: 25 perfect words in a row!", "gold", "fanfare")

    def power_of(self, p, word):
        return max(1, round(len(word) * 0.5 * (1 + 0.06 * min(p.g.combo, 10)) * self.surge()))

    def advance_word(self, p):
        p.g.idx += 1
        if len(self.words) - p.g.idx < WINDOW + 10:   # a long round: the stream goes on
            self.words += [self.rng.choice(self.word_pool()) for _ in range(200)]

    def typed(self, p, word, errs):
        g = p.g
        self.count(p, word, errs)
        self.advance_word(p)
        mode = self.mode
        if mode == "race":
            if not self.s["secs"] and g.chars >= RACE_GOAL:
                self.moment(f"⌨️ {p.name} types {RACE_GOAL} letters first!", "cool", "fanfare")
                self.round_over([p])
            return
        if mode == "hyper":      # 🚀 a combo is a boost
            g.dist = min(TRACK, g.dist + len(word) * (1 + 0.05 * min(g.combo, 10)))
            if g.dist >= TRACK:
                self.moment(f"🚀 {p.name} crosses the line!", "cool", "fanfare")
                self.round_over([p])
            return
        if mode == "tug":        # 🪢 a team's pull is shared out, so a bigger team doesn't pull harder
            mine = sum(1 for q in self.live() if q.g.team == g.team)
            pull = len(word) * 0.5 * (1 + 0.05 * min(g.combo, 10)) * (len(self.live()) / 2) / max(1, mine) * self.surge()
            self.rope += pull if g.team else -pull
            self.event("pull", p, None, round(pull, 1))
            if abs(self.rope) >= self.rope_line():
                side = 1 if self.rope > 0 else 0
                self.moment(f"🪢 {TEAMS[side]} pulls the rope over the line!", "gold", "cheer")
                self.round_over([q for q in self.live() if q.g.team == side])
            return
        if not g.offer:
            g.charge = min(CHARGE, g.charge + len(word) * (3 if not errs else 1))
            if g.charge >= CHARGE:
                g.offer = {k: self.rng.choice(ws) for k, ws in POWER.items()}
        self.attack(p, self.power_of(p, word), "hit")

    def attack(self, p, dmg, kind):
        """p's word lands: on a rival, a castle, the front enemy or the boss, by mode."""
        mode = self.mode
        if mode == "siege":
            # soldiers past the halfway mark on their way to p's castle are cut down first
            now = self.now()
            for a in sorted(self.armies, key=lambda x: x["t0"]):
                if a["to"] != p.id or now - a["t0"] < MARCH / 2 or dmg <= 0 or self.overtime:
                    continue
                cut = min(a["power"], dmg)
                a["power"] -= cut
                dmg -= cut
                self.event("cut", p, self.room.players.get(a["by"]), cut)
                if a["power"] <= 0:
                    self.armies.remove(a)
            to = self.target(p)
            if dmg > 0 and to:
                self.seq += 1
                self.armies.append({"n": self.seq, "by": p.id, "to": to.id, "power": dmg, "t0": now, "big": kind == "strike"})
                self.timer(now + MARCH, "army", self.seq)
            return
        if mode == "survival":
            now = self.now()
            f = next((f for f in self.walking_foes(now) if p.g.foe_hp.get(f["i"], f["hp"]) > 0), None)
            if f is None:
                return
            left = p.g.foe_hp.get(f["i"], f["hp"]) - dmg
            p.g.foe_hp[f["i"]] = max(0, left)
            p.g.dealt += min(dmg, left + dmg)
            self.event("zap" if left > 0 else "kill", p, None, dmg)
            if left <= 0:
                p.g.kills += 1
            return
        if mode == "boss":
            g = p.g
            hit = min(dmg, g.boss)
            g.boss -= hit
            g.dealt += hit
            self.event(kind, p, None, hit)
            if g.boss <= 0:
                self.moment(f"👹 {p.name} beats the boss!", "gold", "fanfare")
                self.round_over([p])
            return
        self.hit(p, self.target(p), dmg, kind)

    def power(self, p, kind, word, errs):
        g = p.g
        self.count(p, word, errs)
        g.offer, g.charge = None, 0
        if kind == "shield":
            g.shield = SHIELD
            self.event("shield", p, None, SHIELD)
            self.room.add_log(f"🛡️ {p.name} raises a shield.")
        elif kind == "heal":
            gain = min(HEAL, HP - g.hp)
            g.hp += gain
            self.event("heal", p, None, gain)
            self.room.add_log(f"💚 {p.name} heals {gain}.")
        else:
            to = self.target(p)
            self.room.add_log(f"💥 {p.name} strikes" + (f" {to.name}!" if to else "!"), "power")
            self.attack(p, STRIKE + len(word), "strike")

    def event(self, kind, by, to, n):
        self.seq += 1
        self.events = (self.events + [{"n": self.seq, "kind": kind, "by": by.id if by else None, "to": to.id if to else None,
                                       "dmg": n, "t": round(self.now() - self.t0, 2)}])[-16:]

    def hit(self, p, to, dmg, kind):
        if not to:
            return
        p.g.dealt += self.hurt(to, dmg, p, kind)

    def hurt(self, to, dmg, by, kind):
        """`to` takes dmg (a shield soaks it first); returns the damage done. By None: an enemy or the boss."""
        g = to.g
        soak = min(g.shield, dmg)
        g.shield -= soak
        dmg -= soak
        g.hp = max(0, g.hp - dmg)
        g.taken += dmg
        if by:
            g.by = by.id
        # (#380) the screens show what a shield soaked: all of a hit ("block") or part of one ("soak", then the hit)
        if soak and dmg:
            self.event("soak", by, to, soak)
        self.event("block" if not dmg else kind, by, to, dmg or soak)
        if g.hp <= 0:
            g.ko = True
            g.ko_at = self.now()
            g.offer = None
            self.plans = [x for x in self.plans if x[1] != to.id]
            what = {"army": "storms the castle of", "bite": None, "boss": None}.get(kind, "knocks out")
            if by and what:
                self.moment(f"💫 {by.name} {what} {to.name}!", "bad" if not by.bot or to.bot else "gold", "boom")
            else:
                self.moment(f"💫 {to.name} is down!", "bad", "boom")
            left = self.fighting()
            if self.mode in ("survival", "boss"):
                if not left:
                    self.round_over(None)
            elif len(left) <= 1:
                self.round_over(left or ([by] if by else None))
        return dmg

    # -- rounds

    def rank_key(self):
        return {"race": lambda q: (q.g.chars - q.g.errs, -q.g.errs),
                "hyper": lambda q: (round(q.g.dist, 2),),
                "survival": lambda q: (not q.g.ko, q.g.kills, q.g.hp),
                "boss": lambda q: (q.g.boss <= 0, q.g.dealt, not q.g.ko, q.g.hp),
                }.get(self.mode, lambda q: (not q.g.ko, q.g.hp, q.g.dealt))

    def round_over(self, winners):
        live = self.live()
        if winners is None and live:
            if self.mode == "tug":
                side = None if abs(self.rope) < 0.5 else int(self.rope > 0)
                winners = [q for q in live if q.g.team == side] if side is not None else []
            else:
                key = self.rank_key()
                ranked = sorted(live, key=key, reverse=True)
                winners = [] if len(ranked) > 1 and key(ranked[0]) == key(ranked[1]) else ranked[:1]
        winners = winners or []
        secs = max(1.0, min(self.now(), self.end) - self.t0)
        stats = {}
        for q in live:
            q.g.chars_total += q.g.chars
            q.g.errs_total += q.g.errs
            q.g.dealt_total += q.g.dealt
            stats[q.id] = {"wpm": round(q.g.chars / 5 / (secs / 60)), "acc": self.accuracy(q.g.chars, q.g.errs),
                           "words": q.g.words - q.g.skips, "dealt": q.g.dealt, "hp": q.g.hp, "best": q.g.best_combo,
                           "kills": q.g.kills, "chars": q.g.chars, "errors": q.g.errs, "secs": secs,
                           "corrected": q.g.errs - q.g.skip_errors, "skips": q.g.skips,
                           "active": min(secs, max(0, q.g.ko_at - self.t0)) if q.g.ko_at else secs}
        for w in winners:
            w.g.wins += 1
            if self.mode in ("duel", "lms", "siege", "boss", "survival") and w.g.taken == 0 and len(live) > 1:
                self.award(w, "flawless")
        if self.mode == "tug" and winners:
            self.room.add_log(f"🏆 Round {self.round} to {TEAMS[winners[0].g.team]}.", "big")
        elif winners:
            w = winners[0]
            why = {"race": "typed the most", "hyper": "flew furthest", "survival": f"held out best ({w.g.kills} down)",
                   "boss": "beat the boss" if w.g.boss <= 0 else "hit the boss hardest"}.get(
                self.mode, "is the last one standing" if any(q.g.ko for q in live) else "has the most health left")
            self.room.add_log(f"🏆 Round {self.round} to {w.name}, who {why} "
                              f"({stats[w.id]['wpm']} wpm, {stats[w.id]['acc']}%).", "big")
        else:
            self.room.add_log(f"🤝 Round {self.round} is a draw.", "big")
        self.result = {"winner": winners[0].id if len(winners) == 1 else None, "winners": [w.id for w in winners],
                       "team": winners[0].g.team if self.mode == "tug" and winners else None, "stats": stats}
        self.history.append({"round": self.round, "secs": round(secs, 1), "winners": [w.id for w in winners],
                             "stats": stats, "names": {q.id: q.name for q in live},
                             "trace": {q.id: q.g.trace for q in live}})
        self.stage = "reveal"
        self.plans = []
        self.timers = []
        self.armies = []
        self.end = self.now() + REVEAL_SECS
        self.sync()

    def next_match_step(self):
        live = self.live()
        if self.mode == "tug" and len({q.g.team for q in live}) < 2:
            return self.finish_game()
        top = max((q.g.wins for q in live), default=0)
        if top >= self.need or self.round >= self.s["rounds"] + 2 or not live:
            return self.finish_game()
        self.next_round()

    def finish_game(self):
        r, live = self.room, self.live()
        if not live:
            return r.finish(None, "Everyone left.")
        if self.mode == "tug":
            score = {t: max((q.g.wins for q in live if q.g.team == t), default=-1) for t in (0, 1)}
            if score[0] == score[1]:
                return r.finish(None, f"🤝 A tie! {TEAMS[0]} {score[0]} · {TEAMS[1]} {score[1]}", draw=True)
            side = 0 if score[0] > score[1] else 1
            team = [q for q in live if q.g.team == side]
            names = ', '.join(q.name for q in team)
            if score[1 - side] < 0:
                result = f"🏆 {TEAMS[side]} ({names}) wins by forfeit. {TEAMS[1 - side]} left the match."
            else:
                result = f"🏆 {TEAMS[side]} ({names}) wins the tug-of-war {score[side]}–{score[1 - side]}!"
            return r.finish(team[0], result, team_winner_ids=[q.id for q in team])
        if self.mode == "race":
            def match_key(q):
                return q.g.wins, q.g.chars_total - q.g.errs_total, -q.g.errs_total
        else:
            def match_key(q):
                return q.g.wins, q.g.dealt_total
        ranked = sorted(live, key=match_key, reverse=True)
        text = " · ".join(f"{q.name} {q.g.wins}" for q in ranked)
        if self.mode == "race":
            totals = " · ".join(f"{q.name} {q.g.chars_total} letters, {q.g.errs_total} errors"
                                f" ({q.g.chars_total - q.g.errs_total} net)" for q in ranked)
            text += f". Typing totals: {totals}."
        if len(ranked) == 1:
            p = ranked[0]
            return r.finish(p if p.g.wins else None, f"⌨️ {p.name}: {p.g.wins} round{'s' if p.g.wins != 1 else ''} won.")
        if match_key(ranked[0]) == match_key(ranked[1]):
            return r.finish(None, f"🤝 A tie! {text}", draw=True)
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Key Clash! {text}")

    def on_leave(self, p):
        self.room.add_log(f"{p.name} left the game.")
        p.eliminated = True
        self.plans = [x for x in self.plans if x[1] != p.id]
        live = self.live()
        if self.mode == "tug" and len({q.g.team for q in live}) < 2:
            return self.finish_game()
        if len(live) < (1 if len(self.ids) == 1 else 2):
            return self.finish_game()
        if self.stage == "ready" and all(q.bot or q.id in self.round_ready for q in live):
            return self.start_countdown()
        if self.stage != "play":
            return
        if self.mode in ("duel", "lms", "siege") and len(self.fighting()) <= 1:
            self.round_over(self.fighting()[:1] or None)

    # -- view

    @staticmethod
    def accuracy(chars, errs):
        return round(100 * chars / (chars + errs)) if chars + errs else 100

    def meta(self, p):
        if not hasattr(p.g, "wins"):
            return ""
        if getattr(self, "stage", "") == "play" and hasattr(p.g, "hp") and self.mode in POWERED:
            return f"🏆{p.g.wins} · ❤️{p.g.hp}"
        return f"🏆 {p.g.wins}"

    def final_scores(self):
        return {q.id: q.g.wins for q in self.room.seated() if hasattr(q.g, "wins")}

    def walking_foes(self, now):
        # Both times increase with spawn order: travel time drops by less than the gap between waves.
        first = bisect_right(self.foes, now, key=FOE_ARRIVAL)
        last = bisect_right(self.foes, now, key=FOE_SPAWN)
        return self.foes[first:last]

    def foes_of(self, q, now):
        """🧟 the enemies walking at q: [progress 0..1, health left, full health]."""
        out = []
        for f in self.walking_foes(now):
            hp = q.g.foe_hp.get(f["i"], f["hp"])
            if hp > 0:
                out.append([round((now - f["spawn"]) / (f["arrive"] - f["spawn"]), 3), hp, f["hp"]])
                if len(out) == 10:
                    break
        return out

    def view(self, p):
        self.upgrade()
        # (#383) while paused the clock stands still on screen too (on resume, on_restore moves the game's clocks on)
        now = (self.room.paused + self.skew) if getattr(self.room, "paused", 0) else self.now()
        secs = max(1.0, min(now, self.end) - self.t0) if self.stage == "play" else 1
        me = p.id in self.ids and not p.eliminated and hasattr(p.g, "idx")
        live = self.live()
        lead = max((q.g.idx for q in live if hasattr(q.g, "idx")), default=0)
        at = p.g.idx if me else lead
        fighters = []
        for q in live:
            g = q.g
            if not hasattr(g, "idx"):
                continue
            tgt = self.target(q) if self.stage == "play" and not g.ko else None
            f = {"id": q.id, "hp": g.hp, "shield": g.shield, "combo": g.combo, "charge": g.charge,
                 "ko": g.ko, "wins": g.wins, "idx": g.idx, "words": g.words, "target": tgt.id if tgt else None,
                 "retaliating": bool(tgt and g.by == tgt.id),
                 # (#384) live while typing; between rounds and after the match, the round's final figure
                 "wpm": round(g.chars / 5 / (secs / 60)) if self.stage == "play" else ((self.result or {}).get("stats", {}).get(q.id, {}).get("wpm", 0)),
                 "acc": self.accuracy(g.chars, g.errs), "errors": g.errs, "chars": g.chars, "power": bool(g.offer), "team": g.team}
            if self.mode == "hyper":
                f["dist"] = round(g.dist, 1)
            elif self.mode == "boss":
                f["boss"] = g.boss
            elif self.mode == "survival":
                f["kills"] = g.kills
                f["foes"] = self.foes_of(q, now) if self.stage == "play" else []
            fighters.append(f)
        out = {
            "mode": self.mode, "stage": self.stage, "round": self.round, "rid": f"{getattr(self, 'gid', '')}:{self.round}", "need": self.need, "rounds": self.s["rounds"],
            "maxRounds": self.s["rounds"] + 2,
            "preparing": me and self.stage in ("ready", "countdown"),
            "ready": self.stage == "ready" and p.id in self.round_ready,
            "readyCount": sum(not q.bot and q.id in self.round_ready for q in live) if self.stage == "ready" else None,
            "typistCount": sum(not q.bot for q in live) if self.stage == "ready" else None,
            "left": round(max(0.0, self.end - now), 2), "secs": {"ready": READY_SECS, "countdown": COUNTDOWN_SECS, "reveal": REVEAL_SECS}.get(
                self.stage, self.s["secs"] or NO_LIMIT),
            "unlimited": not self.s["secs"] and self.stage == "play", "overtime": self.overtime and self.stage == "play", "goal": RACE_GOAL if self.mode == "race" and not self.s["secs"] else None,
            "elapsed": round(max(0.0, now - self.t0), 2) if self.stage == "play" else None,
            "base": at, "words": self.words[at:at + WINDOW], "playing": me and not p.g.ko and self.stage == "play",
            "offer": p.g.offer if me else None, "fighters": fighters, "events": self.events,
            "wordAge": max(0.0, now - p.g.last_at) if me else None, "minCharMs": MIN_CHAR_SECS * 1000,
            "missedWords": self.practice_words.get(p.id, []) if self.room.phase == "over" else [],
            "result": self.result, "hp": HP, "charge": CHARGE, "powered": self.mode in POWERED,
            # (#381) the charts: shown between rounds and after the match, never while a round is being typed
            "history": self.history if self.stage == "reveal" or self.room.phase != "playing" else None,
            "shieldAmount": SHIELD, "healAmount": HEAL, "strikeBase": STRIKE,
            "effects": {"shield": f"blocks the next {SHIELD} damage", "heal": f"+{HEAL} health",
                        "strike": {"siege": "a big army", "survival": "a big hit on the front enemy", "boss": "a big hit on the boss"}.get(self.mode, "a big hit")},
        }
        if self.mode == "siege":
            out["armies"] = [{"by": a["by"], "to": a["to"], "power": a["power"], "big": a["big"],
                              "prog": round(min(1.0, (now - a["t0"]) / MARCH), 3)} for a in self.armies]
        elif self.mode == "tug":
            out.update(rope=round(self.rope, 1), ropeMax=ROPE, ropeLine=round(self.rope_line(), 1), teams=TEAMS)
        elif self.mode == "hyper":
            out["track"] = TRACK
        elif self.mode == "boss":
            out["bossMax"] = BOSS_HP
            boss_at = next((t for t, kind, _ in self.timers if kind == "boss" and t < self.end), None)
            out["bossIn"] = round(max(0.0, boss_at - now), 2) if boss_at is not None else None
        elif self.mode == "survival":
            spawned = bisect_right(self.foes, now, key=FOE_SPAWN)
            out["wave"] = self.foes[spawned - 1]["wave"] if spawned else 1
        return {self.id: out}
