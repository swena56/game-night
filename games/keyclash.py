"""Key Clash (#374): a typing battle. Everyone types the same stream of words at once; each word typed
right is an attack on a rival. Longer words hit harder, perfect words in a row build a combo, and a full
charge offers three power words (shield, strike, heal) that fire when typed. A typo has to be fixed
before the word counts, and it breaks the combo. A round ends at a knock-out or when the clock runs out;
first to win most of the rounds takes the match.

Modes: ⚔️ Duel (two fighters), 🏟️ Last Typist Standing (everyone; each word hits your target, the last
one up wins the round), ⌨️ Pure Typing (no fighting: the most letters typed right wins the round).

Typing happens in the browser, which sends each finished word with the number of typos made on it; the
server checks the word against the shared stream, times it on its own clock and keeps all the scores.
Bots type at a steady speed by level and sometimes make a typo, which costs them time and their combo."""
import time

from .base import Game, GameError
from .garden import BASE6, BASE7
from .ladder_words import COMMON

HP = 100
REVEAL_SECS = 6
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
SHIELD, STRIKE, HEAL = 15, 16, 18


def pool(level):
    small = [w.lower() for n in (3, 4) for w in sorted(COMMON[n])]
    mid = [w.lower() for n in (4, 5) for w in sorted(COMMON[n])] + [w.lower() for w in BASE6]
    big = [w.lower() for w in BASE6 + BASE7 + LONG]
    return {"easy": small, "normal": mid, "hard": big}[level]


class KeyClash(Game):
    id = "keyclash"
    category = "words"
    name = "Key Clash"
    icon = "⌨️"
    blurb = "A typing battle: every word you type right is a hit on your rival."
    howto = [
        "Everyone types the same words. Press space (or Enter) after each one.",
        "Each word typed right hits your rival: longer words hit harder, perfect words in a row build a combo.",
        "A typo turns the word red: fix it before it counts. It also breaks your combo.",
        "Fill the ⚡ charge and three power words appear: type one to 🛡️ shield, 💥 strike or 💚 heal.",
        "Knock your rival out, or have more health when the clock runs out, to win the round.",
    ]
    tip_lines = ["Accuracy beats speed: a typo costs time and your combo."]
    min_players = 1
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "flawless": ("✨", "Flawless", "Win a round without losing any health"),
              "streak": ("🔥", "On fire", "Type 25 perfect words in a row")}
    settings_schema = {
        "mode": ("Mode", [("duel", "⚔️ Duel"), ("lms", "🏟️ Last Typist Standing"), ("race", "⌨️ Pure Typing")], "duel"),
        "words": ("Words", [("easy", "Short"), ("normal", "Everyday"), ("hard", "Long")], "normal"),
        "secs": ("Round", [(45, "45 s"), (60, "1 min"), (90, "90 s"), (120, "2 min")], 60),
        "rounds": ("Match", [(1, "1 round"), (3, "Best of 3"), (5, "Best of 5")], 3),
    }

    def check_players(self, seated):
        super().check_players(seated)
        if self.s["mode"] == "duel" and len(seated) != 2:
            raise GameError("A Duel is for two fighters: pick Last Typist Standing for more, or Pure Typing.")
        if self.s["mode"] == "lms" and len(seated) < 2:
            raise GameError("Last Typist Standing needs at least two typists.")

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0              # the bot simulator fast-forwards this clock
        self.mode = self.s["mode"]
        self.ids = [p.id for p in seated]
        self.need = self.s["rounds"] // 2 + 1
        self.round = 0
        self.events = []             # recent hits for the screens to animate: {n, kind, by, to, dmg, t}
        self.seq = 0
        for p in seated:
            p.g.wins = 0
            p.g.dealt_total = 0
            p.g.chars_total = 0
            p.g.errs_total = 0
            p.g.best_combo = 0
        self.room.turn = None
        self.room.bot_at = 0
        mode = dict(self.settings_schema["mode"][1])[self.mode]
        self.room.add_log(f"⌨️ Key Clash: {mode}, first to {self.need} round{'s' if self.need > 1 else ''}. Get typing!", "big")
        self.next_round()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def fighting(self):
        return [p for p in self.live() if not p.g.ko]

    def next_round(self):
        self.round += 1
        self.mark_round()
        words = pool(self.s["words"])
        self.words = [self.rng.choice(words) for _ in range(STREAM)]
        self.stage = "play"
        self.t0 = self.now()
        self.end = self.t0 + self.s["secs"]
        self.events = []
        self.result = None
        self.plans = []
        for p in self.live():
            g = p.g
            g.idx, g.hp, g.shield, g.combo, g.charge = 0, HP, 0, 0, 0
            g.chars, g.errs, g.words, g.dealt, g.taken, g.ko = 0, 0, 0, 0, 0, False
            g.offer, g.last_at, g.by = None, self.t0, None
            if p.bot:
                self.plan(p)
        self.sync()
        self.room.add_log(f"🔔 Round {self.round}: fight!", "question")

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
            danger = max((q.g.charge for q in others), default=0) >= 70
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
        return min([self.end] + [x[0] for x in self.plans[:1]])

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
        now = self.now()
        if self.stage == "reveal":
            if now >= self.end:
                self.next_match_step()
            return
        while self.plans and self.plans[0][0] <= now and self.stage == "play":
            _, pid, (kind, word), slip = self.plans.pop(0)
            p = self.room.players.get(pid)
            if not p or p not in self.fighting():
                continue
            if kind and p.g.offer and p.g.offer.get(kind) == word:
                self.power(p, kind, word, 1 if slip else 0)
            elif not kind and self.words[p.g.idx] == word:
                self.typed(p, word, 1 if slip else 0)
            if self.stage == "play" and p in self.fighting():
                self.plan(p)
        if self.stage != "play":
            return
        if now >= self.end:
            return self.round_over(None)
        self.sync()

    # -- actions

    def act(self, p, a):
        if a.get("type") != "word":
            raise GameError("Unknown action.")
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        if self.stage != "play" or self.now() >= self.end:
            raise GameError("This round is over.")
        if p.g.ko:
            raise GameError("You're knocked out until the next round.")
        word, errs = a.get("word"), a.get("errs", 0)
        if not isinstance(word, str) or type(errs) is not int or not 0 <= errs <= 99:
            raise GameError("Bad word.")
        if self.now() - p.g.last_at < len(word) * MIN_CHAR_SECS:
            raise GameError("Too fast.")
        offer = p.g.offer or {}
        kind = next((k for k, w in offer.items() if w == word), None)
        if kind:
            return self.power(p, kind, word, errs)
        i = a.get("i")
        if type(i) is not int or i != p.g.idx:
            raise GameError("Out of step: that word was already counted.")
        if self.words[i] != word:
            raise GameError("That's not the word.")
        self.typed(p, word, errs)

    def target(self, p):
        """Who p's attacks hit: the rival in a Duel; in Last Typist Standing, whoever last hit p (while
        they're still up), else the one with the most health."""
        rivals = [q for q in self.fighting() if q.id != p.id]
        if not rivals:
            return None
        back = next((q for q in rivals if q.id == p.g.by), None)
        return back or max(rivals, key=lambda q: (q.g.hp, -self.ids.index(q.id)))

    def count(self, p, word, errs):
        g = p.g
        g.chars += len(word)
        g.errs += errs
        g.words += 1
        g.last_at = self.now()
        if errs:
            g.combo = 0
        else:
            g.combo += 1
            g.best_combo = max(g.best_combo, g.combo)
            if g.combo == 25:
                self.award(p, "streak")
                self.moment(f"🔥 {p.name}: 25 perfect words in a row!", "gold", "fanfare")

    def typed(self, p, word, errs):
        g = p.g
        self.count(p, word, errs)
        g.idx += 1
        if self.mode == "race":
            return
        if not g.offer:
            g.charge = min(CHARGE, g.charge + len(word) * (3 if not errs else 1))
            if g.charge >= CHARGE:
                g.offer = {k: self.rng.choice(ws) for k, ws in POWER.items()}
        dmg = max(1, round(len(word) * 0.5 * (1 + 0.06 * min(g.combo, 10))))
        self.hit(p, self.target(p), dmg, "hit")

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
            self.hit(p, to, STRIKE + len(word), "strike")

    def event(self, kind, by, to, n):
        self.seq += 1
        self.events = (self.events + [{"n": self.seq, "kind": kind, "by": by.id, "to": to.id if to else None,
                                       "dmg": n, "t": round(self.now() - self.t0, 2)}])[-12:]

    def hit(self, p, to, dmg, kind):
        if not to:
            return
        g = to.g
        soak = min(g.shield, dmg)
        g.shield -= soak
        dmg -= soak
        g.hp = max(0, g.hp - dmg)
        g.taken += dmg
        g.by = p.id
        p.g.dealt += dmg
        self.event("block" if not dmg else kind, p, to, dmg)
        if g.hp <= 0:
            g.ko = True
            g.offer = None
            self.plans = [x for x in self.plans if x[1] != to.id]
            self.moment(f"💫 {p.name} knocks out {to.name}!", "bad" if not p.bot or to.bot else "gold", "boom")
            left = self.fighting()
            if len(left) <= 1:
                self.round_over(left[0] if left else p)

    # -- rounds

    def round_over(self, winner):
        live = self.live()
        if winner is None and live:
            if self.mode == "race":
                key = lambda q: (q.g.chars - q.g.errs, -q.g.errs)
            else:
                key = lambda q: (not q.g.ko, q.g.hp, q.g.dealt)
            ranked = sorted(live, key=key, reverse=True)
            if len(ranked) > 1 and key(ranked[0]) == key(ranked[1]):
                winner = None
            else:
                winner = ranked[0]
        secs = max(1.0, min(self.now(), self.end) - self.t0)
        stats = {}
        for q in live:
            q.g.chars_total += q.g.chars
            q.g.errs_total += q.g.errs
            q.g.dealt_total += q.g.dealt
            stats[q.id] = {"wpm": round(q.g.chars / 5 / (secs / 60)), "acc": self.accuracy(q.g.chars, q.g.errs),
                           "words": q.g.words, "dealt": q.g.dealt, "hp": q.g.hp, "best": q.g.best_combo}
        if winner:
            winner.g.wins += 1
            if self.mode != "race" and winner.g.taken == 0 and len(live) > 1:
                self.award(winner, "flawless")
            why = ("typed the most" if self.mode == "race" else "is the last one standing" if any(q.g.ko for q in live)
                   else "has the most health left")
            self.room.add_log(f"🏆 Round {self.round} to {winner.name}, who {why} "
                              f"({stats[winner.id]['wpm']} wpm, {stats[winner.id]['acc']}%).", "big")
        else:
            self.room.add_log(f"🤝 Round {self.round} is a draw.", "big")
        self.result = {"winner": winner.id if winner else None, "stats": stats}
        self.stage = "reveal"
        self.plans = []
        self.end = self.now() + REVEAL_SECS
        self.sync()

    def next_match_step(self):
        live = self.live()
        top = max((q.g.wins for q in live), default=0)
        if top >= self.need or self.round >= self.s["rounds"] + 2 or not live:
            return self.finish_game()
        self.next_round()

    def finish_game(self):
        r, live = self.room, self.live()
        if not live:
            return r.finish(None, "Everyone left.")
        ranked = sorted(live, key=lambda q: (q.g.wins, q.g.dealt_total, q.g.chars_total), reverse=True)
        text = " · ".join(f"{q.name} {q.g.wins}" for q in ranked)
        if len(ranked) == 1:
            p = ranked[0]
            return r.finish(p if p.g.wins else None, f"⌨️ {p.name}: {p.g.wins} round{'s' if p.g.wins != 1 else ''} won.")
        if ranked[0].g.wins == ranked[1].g.wins and ranked[0].g.dealt_total == ranked[1].g.dealt_total:
            return r.finish(None, f"🤝 A tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Key Clash! {text}")

    def on_leave(self, p):
        self.room.add_log(f"{p.name} left the game.")
        p.eliminated = True
        self.plans = [x for x in self.plans if x[1] != p.id]
        live = self.live()
        if len(live) < (1 if len(self.ids) == 1 else 2):
            return self.finish_game()
        if self.stage == "play" and len(self.fighting()) <= 1 and self.mode != "race":
            self.round_over(self.fighting()[0] if self.fighting() else None)

    # -- view

    @staticmethod
    def accuracy(chars, errs):
        return round(100 * chars / (chars + errs)) if chars + errs else 100

    def meta(self, p):
        if not hasattr(p.g, "wins"):
            return ""
        if getattr(self, "stage", "") == "play" and hasattr(p.g, "hp") and self.mode != "race":
            return f"🏆{p.g.wins} · ❤️{p.g.hp}"
        return f"🏆 {p.g.wins}"

    def final_scores(self):
        return {q.id: q.g.wins for q in self.room.seated() if hasattr(q.g, "wins")}

    def view(self, p):
        now = self.now()
        secs = max(1.0, min(now, self.end if self.stage == "play" else now) - self.t0) if self.stage == "play" else 1
        me = p.id in self.ids and not p.eliminated and hasattr(p.g, "idx")
        live = self.live()
        lead = max((q.g.idx for q in live if hasattr(q.g, "idx")), default=0)
        at = p.g.idx if me else lead
        fighters = []
        for q in live:
            g = q.g
            if not hasattr(g, "idx"):
                continue
            tgt = self.target(q) if self.stage == "play" and not g.ko and self.mode != "race" else None
            fighters.append({"id": q.id, "hp": g.hp, "shield": g.shield, "combo": g.combo, "charge": g.charge,
                             "ko": g.ko, "wins": g.wins, "idx": g.idx, "words": g.words, "target": tgt.id if tgt else None,
                             "wpm": round(g.chars / 5 / (secs / 60)) if self.stage == "play" else 0,
                             "acc": self.accuracy(g.chars, g.errs), "chars": g.chars, "power": bool(g.offer)})
        return {self.id: {
            "mode": self.mode, "stage": self.stage, "round": self.round, "need": self.need, "rounds": self.s["rounds"],
            "left": round(max(0.0, self.end - now), 2), "secs": self.s["secs"] if self.stage == "play" else REVEAL_SECS,
            "base": at, "words": self.words[at:at + WINDOW], "playing": me and not p.g.ko and self.stage == "play",
            "offer": p.g.offer if me else None, "fighters": fighters, "events": self.events,
            "result": self.result, "hp": HP, "charge": CHARGE,
        }}
