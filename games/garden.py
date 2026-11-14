"""Word Garden: an easy-going word game with no rush. Everyone gets the same ring of letters and the
same little crossword (the garden). Spell words from the ring to fill it in, at your own pace. There's
no clock unless you pick one, and wrong guesses cost nothing. Words that aren't in the garden still count
as bonus words, and every few bonus words earn a 💧 drop that reveals a letter. A garden ends when
everyone has finished it (or called it a day); the finishers can hunt bonus words while they wait.

Built on the shared puzzle race (games/puzzlerace.py) with its first-to-finish bonus turned off."""
import random
import threading
from collections import Counter

from .base import GameError
from .ladder_words import COMMON
from .puzzlerace import PuzzleRace
from .wordsmith import mask, words

# Everyday words that make good letter rings (each must also be in the dictionary).
BASE6 = """GARDEN FLOWER PLANET SILVER WINTER SPRING SUMMER BASKET BUTTER CASTLE CANDLE DINNER FOREST
    GARLIC HONEST ISLAND JUNGLE KITTEN LADDER MARKET NATURE ORANGE PARENT PENCIL POCKET RABBIT RIDDLE
    SADDLE SECOND SPIDER STREAM STRING TABLET TEACHER THREAD TRAVEL TUNNEL VALLEY WANDER WONDER YELLOW
    ANSWER BRIDGE CAMERA CORNER DESERT DOCTOR FINGER FRIEND GENTLE HEALTH HUNTER INSECT LEADER LISTEN
    MASTER MATTER MIRROR MOTHER NEARLY PALACE PEPPER PLASTER RATTLE REASON SAILOR SEASON SHADOW SINGER
    SISTER SLEDGE SPRINT STABLE STOLEN STRAIN STRIPE TALENT TENDER TINSEL TOMATO TRADES WARDEN WASTED
    BREATH CREATE DANGER DEALER EASTER ENGINE FATHER GATHER GOLDEN HARBOR HEARTS LEARNS LIGHTS MANTLE
    MEADOW MENTAL NESTLE OTTERS PASTEL PLANTS POSTER RAISED RANGED RESCUE ROTATE SALTED SHINED SKATER
    SNORED SOLDER STARED STONED TRAINS TRANCE WAITER BRAINS CHAINS DREAMS HOTELS LEMONS MELONS PIRATE
    PETALS ROASTED SPRITE STORED TRACES TRAILS GRAINS RELISH SAINTS TINDER LINTER INSERT""".split()
BASE7 = """READING STATION PAINTER GARDENS MORNING TEACHER PLANETS RAINBOW STARLIT DOLPHIN
    BLANKET LEATHER WEATHER FEATHER PRESENT CAPTAIN HOLIDAY KITCHEN LANTERN PICTURE RESTING
    SEASONS SHELTER STEAMER STRANGE TRAINED VILLAGE WARMEST WINTERS COASTER DANCERS DRAGONS
    HUNTERS LEADERS MASTERS NESTING ORCHARD PARENTS PARTIES POTTERS PRINTED REASONS ROASTED SAILORS
    SHORTEN SINGERS SISTERS SPARKLE SPRINGS STAINED STREAMS TALENTS TEASING
    TRAINER TREASON WANDERS WONDERS ARTISTS CARTONS CLOSETS DETAILS DIAMOND EARNEST ENTRIES GRANITE
    HEATING INSTEAD MANSION NOTICED ORIGINS PAINTED PIRATES PLANTER RESTING SETTING SLEEPER
    SMOKING SNORTED SPIDERS STRINGS TANGLES TRADERS TRAINEE""".split()
TARGET = {5: 5, 6: 7, 7: 9}   # garden words per ring size
MAX_SIDE = 10                 # the garden fits in 10 × 10
START_DROPS = 3               # 💧 each player starts the game with
DROP_EVERY = 3                # bonus words per new 💧
BOT = {"easy": 15.0, "normal": 9.5, "hard": 6.0}   # seconds per word (± 30%)
BONUS_TRY = {"easy": 0.08, "normal": 0.18, "hard": 0.28}  # how often a bot spots a bonus word instead

_lock = threading.Lock()
_bases = None


def can_make(w, have):
    need = Counter(w)
    return all(have[ch] >= k for ch, k in need.items())


def everyday():
    """Words a garden may use: the everyday 3–5 letter list plus the ring words."""
    dic = words()
    return {w for n in (3, 4, 5) for w in COMMON[n]} | {w for w in BASE6 + BASE7 if w in dic}


def bases():
    """{ring size: [(base, [everyday sub-words])]} for the words with enough sub-words for a garden."""
    global _bases
    with _lock:
        if _bases is None:
            dic, pool = words(), everyday()
            info = sorted((len(w), w, mask(w), Counter(w)) for w in pool)
            out = {}
            for n, src in ((5, sorted(COMMON[5])), (6, BASE6), (7, BASE7)):
                got = []
                for b in dict.fromkeys(src):
                    if len(b) != n or b not in dic:
                        continue
                    have, m = Counter(b), mask(b)
                    subs = [w for k, w, wm, need in info if k <= n and not wm & ~m
                            and all(have[ch] >= x for ch, x in need.items())]
                    if len(subs) >= TARGET[n] + 2 and any(len(w) >= n - 1 and w != b for w in subs):
                        got.append((b, sorted(subs)))
                out[n] = got
            _bases = out
    return _bases


def layout(rng, base, subs, target):
    """A small crossword: [(word, row, col, across)] with `target` words if they fit, the ring word first."""
    best = None
    for _ in range(40):
        cells = {}   # (r, c) -> [letter, set of directions]
        placed = []

        def put(w, r, c, across):
            for k, ch in enumerate(w):
                at = (r, c + k) if across else (r + k, c)
                cells.setdefault(at, [ch, set()])[1].add(across)
            placed.append((w, r, c, across))

        def fits(w, r, c, across):
            dr, dc = (0, 1) if across else (1, 0)
            if (r - dr, c - dc) in cells or (r + dr * len(w), c + dc * len(w)) in cells:
                return -1
            cross = 0
            for k, ch in enumerate(w):
                at = (r + dr * k, c + dc * k)
                if at in cells:
                    if cells[at][0] != ch or across in cells[at][1]:
                        return -1
                    cross += 1
                else:   # a new letter: nothing may touch it from the sides
                    if (at[0] + dc, at[1] + dr) in cells or (at[0] - dc, at[1] - dr) in cells:
                        return -1
            if cross == 0 or cross == len(w):
                return -1
            rs = [p[0] for p in cells] + [r, r + dr * (len(w) - 1)]
            cs = [p[1] for p in cells] + [c, c + dc * (len(w) - 1)]
            if max(rs) - min(rs) >= MAX_SIDE or max(cs) - min(cs) >= MAX_SIDE:
                return -1
            return cross

        put(base, 0, 0, True)
        rest = [w for w in subs if w != base]
        rng.shuffle(rest)
        rest.sort(key=lambda w: -len(w) - rng.random() * 2.5)   # longer words first, loosely
        for w in rest:
            if len(placed) >= target:
                break
            spots = []
            for (r0, c0), (ch, dirs) in list(cells.items()):
                for k, x in enumerate(w):
                    if x != ch:
                        continue
                    for across in (True, False):
                        if across in dirs:
                            continue
                        r, c = (r0, c0 - k) if across else (r0 - k, c0)
                        n = fits(w, r, c, across)
                        if n > 0:
                            spots.append((n + rng.random(), r, c, across))
            if spots:
                _, r, c, across = max(spots)
                put(w, r, c, across)
        r0 = min(p[0] for p in cells)
        c0 = min(p[1] for p in cells)
        h = max(p[0] for p in cells) - r0 + 1
        wd = max(p[1] for p in cells) - c0 + 1
        score = (min(len(placed), target), -h * wd)
        if best is None or score > best[0]:
            best = (score, [(w, r - r0, c - c0, a) for w, r, c, a in placed], h, wd)
        if len(placed) >= target and h * wd <= 64:
            break
    return best[1], best[2], best[3]


def slot_cells(slot):
    w, r, c, across = slot
    return [(r, c + k) if across else (r + k, c) for k in range(len(w))]


class Garden(PuzzleRace):
    id = "garden"
    category = "words"
    name = "Word Garden"
    icon = "🌻"
    noun = "garden"
    blurb = "A calm word game: spell words from a ring of letters to grow a little crossword garden. No clock, no rush."
    howto = [
        "Spell words from the ring of letters: drag across them, tap them one by one, or type. Each word needs 3+ letters.",
        "Words in the garden (the little crossword) fill in. Other real words are bonus words.",
        f"Garden words score a point per letter, bonus words 1 (2 for six letters or more). Every {DROP_EVERY} bonus words earn a 💧, which reveals a letter.",
        "No clock and no penalties: a garden ends when everyone is done. Finishing it scores +10. Most points after the last garden wins.",
        "Alone, grow every garden to win.",
    ]
    settings_schema = {
        "letters": ("Letters", [(6, "6 letters"), (5, "5 letters (gentle)"), (7, "7 letters (big garden)")], 6),
        "rounds": ("Gardens", [(3, "3"), (1, "1"), (5, "5")], 3),
        "secs": ("Clock", [(0, "🌿 No clock"), (300, "5 min per garden"), (600, "10 min per garden")], 0),
        "daily": ("Gardens", [(False, "🎲 Random"), (True, "📅 Today's gardens (the same everywhere)")], False),
    }
    badges = {**PuzzleRace.badges, "thumb": ("🌱", "Green thumb", "Grow a whole garden without a 💧")}
    first_bonus = 0
    BOT = BOT

    def start(self, seated, rng):
        self.used = []
        for p in seated:
            p.g.drops = START_DROPS
        super().start(seated, rng)

    def late_join(self, p):
        if not hasattr(p.g, "drops"):
            p.g.drops = START_DROPS
        super().late_join(p)

    # -- the puzzle

    def new_puzzle(self, rng):
        n = self.s.get("letters") if self.s.get("letters") in TARGET else 6
        options = [b for b in bases()[n] if b[0] not in self.used] or bases()[n]
        self.base, subs = rng.choice(options)
        self.used.append(self.base)
        lrng = random.Random(rng.random())
        self.slots, self.h, self.w = layout(lrng, self.base, subs, TARGET[n])
        self.slots.sort(key=lambda s: (len(s[0]), s[0]))
        self.answers = [s[0] for s in self.slots]
        self.cells = {}
        for i, s in enumerate(self.slots):
            for at in slot_cells(s):
                self.cells.setdefault(at, []).append(i)
        ring = list(self.base)
        while "".join(ring) == self.base:
            lrng.shuffle(ring)
        self.ring = "".join(ring)
        have, dic = Counter(self.base), words()
        self.bonus_all = {w for w in dic if 3 <= len(w) <= n and w not in self.answers and can_make(w, have)}
        pool = everyday()
        self.bonus_easy = sorted(w for w in self.bonus_all if w in pool)   # what a bot "thinks of"
        return f"{len(self.answers)} words to grow from {n} letters"

    def fresh(self):
        return {"found": [], "pts": {}, "shown": [], "bonus": [], "hinted": 0, "seq": 0, "last": None}

    def finished(self, pid):
        st = self.st.get(pid)
        return bool(st) and len(st["found"]) == len(self.answers)

    def progress(self, pid):
        return [len(self.st[pid]["found"]), len(self.answers)]

    def points(self, p):
        st = self.st[p.id]
        return sum(st["pts"].values()) + sum(bonus_pts(w) for w in st["bonus"])

    # -- moves

    def act(self, p, a):
        # finishers may keep hunting bonus words while the others grow theirs
        if (p.id in self.done and p.id in self.ids and not p.eliminated and self.stage == "play"
                and self.room.phase == "playing" and a.get("type") == "word"):
            return self.move(p, self.st[p.id], a)
        return super().act(p, a)

    def move(self, p, st, a):
        kind = a.get("type")
        if kind == "word":
            w = a.get("word")
            if not isinstance(w, str) or not w.isascii() or not w.isalpha():
                raise GameError("Spell a word from the ring.")
            return self.say(p, st, w.upper())
        if kind == "hint":
            return self.hint(p, st)
        raise GameError("Unknown action.")

    def say(self, p, st, w):
        if len(w) < 3:
            raise GameError("Words need at least 3 letters.")
        if not can_make(w, Counter(self.ring)):
            raise GameError(f"{w} needs letters the ring doesn't have.")
        st["seq"] += 1
        if w in self.answers:
            if w in st["found"]:
                st["last"] = {"w": w, "kind": "again", "n": st["seq"]}
                return
            i = self.answers.index(w)
            shown = {tuple(x) for x in st["shown"]}
            pts = sum(1 for at in slot_cells(self.slots[i]) if at not in shown)
            self.grow(st, w, pts)
            st["last"] = {"w": w, "kind": "garden", "pts": pts, "n": st["seq"]}
            if len(w) == len(self.ring) and not self.solo:
                self.room.add_log(f"🌻 {p.name} found the {len(w)}-letter word.")
            return
        if w in st["bonus"]:
            st["last"] = {"w": w, "kind": "again", "n": st["seq"]}
            return
        if w not in self.bonus_all:   # no error toast: a quiet note in the player's own view
            st["last"] = {"w": w, "kind": "nope", "n": st["seq"]}
            return
        st["bonus"].append(w)
        drop = len(st["bonus"]) % DROP_EVERY == 0
        if drop:
            p.g.drops += 1
        st["last"] = {"w": w, "kind": "bonus", "pts": bonus_pts(w), "drop": drop, "n": st["seq"]}

    def grow(self, st, w, pts):
        st["found"].append(w)
        st["pts"][w] = pts
        # a hint can complete crossing words too: those count as found, for no points
        known = {tuple(x) for x in st["shown"]}
        for s in self.slots:
            known.update(slot_cells(s) if s[0] in st["found"] else [])
        for s in self.slots:
            if s[0] not in st["found"] and all(at in known for at in slot_cells(s)):
                st["found"].append(s[0])
                st["pts"][s[0]] = 0

    def hint(self, p, st):
        if p.g.drops <= 0:
            raise GameError(f"No 💧 left. Every {DROP_EVERY} bonus words earn one.")
        known = {tuple(x) for x in st["shown"]}
        for s in self.slots:
            if s[0] in st["found"]:
                known.update(slot_cells(s))
        # a letter of the unfound word with the fewest letters showing, so a hint really helps
        left = [s for s in self.slots if s[0] not in st["found"]]
        if not left:
            raise GameError("Your garden is already in bloom.")
        left.sort(key=lambda s: (sum(at in known for at in slot_cells(s)) / len(s[0]), self.rng.random()))
        spots = [at for at in slot_cells(left[0]) if at not in known]
        at = self.rng.choice(spots)
        st["shown"].append(list(at))
        st["hinted"] += 1
        st["seq"] += 1
        p.g.drops -= 1
        before = len(st["found"])
        known.add(at)
        for s in self.slots:
            if s[0] not in st["found"] and all(c in known for c in slot_cells(s)):
                st["found"].append(s[0])
                st["pts"][s[0]] = 0
        st["last"] = {"w": "", "kind": "hint", "n": st["seq"], "done": len(st["found"]) - before}

    def on_finish(self, p, secs):
        st = self.st[p.id]
        if not st["hinted"]:
            self.award(p, "thumb")
        if not self.solo:
            self.moment(f"🌸 {p.name}'s garden is in bloom", "good", "chime")

    # -- bots: a word every so often, now and then a bonus word, a 💧 when stuck

    def bot_pace(self, p, st):
        base = self.BOT.get(p.bot or "normal", 9.5)
        base *= {5: 0.8, 6: 1.0, 7: 1.2}.get(len(getattr(self, "ring", "")) or 6, 1.0)
        return base * self.rng.uniform(0.7, 1.3)

    def bot_move(self, p, st):
        lvl = p.bot if p.bot in BOT else "normal"
        left = [w for w in self.answers if w not in st["found"]]
        if not left:
            return False
        extra = [w for w in self.bonus_easy if w not in st["bonus"]]
        if extra and self.rng.random() < BONUS_TRY[lvl]:
            return self.say(p, st, self.rng.choice(extra))
        # stuck on the long ones now and then: an easy bot reaches for the watering can
        if p.g.drops > 0 and self.rng.random() < {"easy": 0.2, "normal": 0.08, "hard": 0.0}[lvl]:
            return self.hint(p, st)
        w = min(self.rng.sample(left, min(2, len(left))), key=len)   # short words come to mind first
        self.say(p, st, w)

    # dropped humans get a stand-in bot (p.bot) mid-garden: make sure it's on the schedule
    def missing_plans(self):
        if self.stage != "play":
            return []
        planned = {pid for _, pid in self.plans}
        return [p for p in self.live() if p.bot and self.playing(p.id) and p.id not in planned]

    def bot_ready(self):
        return super().bot_ready() or (self.room.phase == "playing" and bool(self.missing_plans()))

    def process(self):
        for p in self.missing_plans():
            self.plan(p)
        super().process()

    # -- view

    def meta(self, p):
        m = super().meta(p)
        return f"{m} · 💧{p.g.drops}" if m and hasattr(p.g, "drops") else m

    def public(self, p):
        st = self.st.get(p.id) or self.fresh()
        over = self.stage == "reveal" or self.room.phase == "over"
        known = {tuple(x) for x in st["shown"]}
        for s in self.slots:
            if s[0] in st["found"] or over:
                known.update(slot_cells(s))
        grid = [[None] * self.w for _ in range(self.h)]
        for (r, c) in self.cells:
            grid[r][c] = self.letter(r, c) if (r, c) in known else ""
        return {
            "ring": self.ring, "h": self.h, "w": self.w, "grid": grid,
            "slots": [[len(s[0]), s[1], s[2], s[3], s[0] if (s[0] in st["found"] or over) else None,
                       s[0] in st["found"]] for s in self.slots],
            "found": len(st["found"]), "total": len(self.answers),
            "shown": st["shown"], "bonus": st["bonus"], "bonusAll": len(self.bonus_all),
            "drops": getattr(p.g, "drops", 0), "dropEvery": DROP_EVERY, "last": st["last"], "seq": st["seq"],
            "base": self.base if over else None,
            "clock": bool(self.s.get("secs")),
            "bonusBy": {q.id: len(self.st[q.id]["bonus"]) for q in self.live() if q.id in self.st},
        }

    def letter(self, r, c):
        i = self.cells[(r, c)][0]
        w, r0, c0, across = self.slots[i]
        return w[c - c0] if across else w[r - r0]


def bonus_pts(w):
    return 2 if len(w) >= 6 else 1
