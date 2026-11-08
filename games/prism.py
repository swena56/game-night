"""Prism Pop: a match-3 race. Everyone plays their own 8×8 board at the same time.

Each player's browser runs its own board; the server keeps a copy of every board (for the rival
minis), routes attacks, ends the round on the clock and runs the bots' boards here.

Rules: swap two neighbouring gems to line up 3+ of a kind. 4 in a row makes a ⚡ beam gem (clears its
row or column), an L or T makes a 💥 nova (clears the 3×3 around it), 5 in a row makes a 🌈 prism
(swap it with a gem to clear that whole colour). Swapping two specials together combines them.
Each cascade step raises the multiplier. Big plays send 🧊 frost (frozen gems can't move until a match
next to them thaws them) and 🪨 stones (they only break when a match lands next to them) to a rival.
Highest score when the clock runs out wins.

Board strings (mirrored in static/games/prism.js): 64 characters, row by row from the top.
  a–f plain gem · A–F frozen gem · g–l ⚡ row beam · m–r ⚡ column beam · s–x 💥 nova · * 🌈 prism · # stone
"""
import random
import time

from .base import Game, GameError

N = 8
PLAIN, FROZEN, BEAM_H, BEAM_V, NOVA = "abcdef", "ABCDEF", "ghijkl", "mnopqr", "stuvwx"
PRISM, STONE, EMPTY = "*", "#", "."
CHARS = set(PLAIN + FROZEN + BEAM_H + BEAM_V + NOVA + PRISM + STONE)
SPECIAL_KINDS = ("beam", "nova", "prism", "combo")
GEM_PTS, STONE_PTS = 10, 20
MAKE_PTS = {"beam": 60, "nova": 100, "prism": 200}
MAX_GAIN = 60000          # the most one board report may add to a score
PACE = {"easy": 4.0, "normal": 2.4, "hard": 1.8}   # seconds a bot thinks per move
# a player's screen spends this long on each cascade step (pop + fall) and on a blast before the next move,
# so a bot's clock pays it too
STEP_SECS, BLAST_SECS = 0.35, 0.4
ATTACK_ODDS = {"easy": 0.0, "normal": 0.5, "hard": 1.0}   # how often a bot's big play really attacks


def kind(ch):
    """Gem colour 0–5, or None for a prism, a stone or a gap."""
    for group in (PLAIN, FROZEN, BEAM_H, BEAM_V, NOVA):
        i = group.find(ch)
        if i >= 0:
            return i
    return None


def special(ch):
    if ch in BEAM_H:
        return "h"
    if ch in BEAM_V:
        return "v"
    if ch in NOVA:
        return "n"
    if ch == PRISM:
        return "p"
    return None


def attack_for(cascade, specials):
    """(frost, stones) a burst sends to a rival: a ×3+ cascade or a 💥 nova sends frost, a 🌈 blast, a special
    combo or a ×5 cascade sends stones. Plain beams don't attack (they turn up too often). The server also
    spaces each player's attacks ATTACK_GAP seconds apart."""
    frost = min(4, cascade - 1) if cascade >= 3 else 0
    if "nova" in specials:
        frost = max(frost, 2)
    stones = 0
    if "prism" in specials or "combo" in specials or cascade >= 5:
        stones = 2 + (1 if cascade >= 6 else 0)
        frost = 0 if cascade < 5 else frost
    return frost, stones


ATTACK_GAP = 5.0
PARRY_SECS = 3.0          # an attack shows a warning this long before it lands; a burst in time shatters it
# 🔥 fever: each scoring move fills the meter (more for cascades), it drains over time, and a full meter gives
# FEVER_SECS of double points. The last RUSH_SECS of a race score double too (they stack). Mirrored in prism.js.
FEVER_DRAIN, FEVER_SECS, RUSH_SECS = 6.0, 6.0, 10.0


def fever_fill(cascade):
    return 22 + 10 * (cascade - 1) if cascade >= 1 else 0


def bursts(cascade, fired):
    """Is a move big enough to shatter an incoming attack (a ×3+ cascade or any special set off)?"""
    return cascade >= 3 or bool(fired)


# 🎯 solo levels: (goal, target, moves, frozen, stones, kinds, colour). Goals: score, colour (pop gems of one
# colour), thaw (free every frozen gem), stones (break every stone), make (make specials), prism (make 🌈).
# The browser gets them in the view.
LEVELS = [
    # 🌱 world 1
    ("score", 1200, 20, 0, 0, 6, None), ("colour", 20, 18, 0, 0, 6, 0), ("thaw", 6, 20, 6, 0, 6, None),
    ("score", 2500, 20, 0, 0, 6, None), ("make", 2, 20, 0, 0, 6, None), ("stones", 4, 22, 0, 4, 6, None),
    # 🌊 world 2
    ("thaw", 10, 20, 10, 0, 6, None), ("colour", 30, 20, 0, 0, 6, 1), ("score", 4000, 20, 0, 0, 6, None),
    ("stones", 6, 20, 4, 6, 6, None), ("make", 3, 18, 0, 0, 6, None), ("prism", 1, 25, 0, 0, 5, None),
    # 🔥 world 3
    ("thaw", 14, 20, 14, 0, 6, None), ("score", 5000, 18, 0, 0, 6, None), ("colour", 35, 18, 0, 0, 6, 2),
    ("stones", 8, 20, 0, 8, 6, None), ("make", 4, 18, 0, 0, 6, None), ("score", 7000, 20, 6, 0, 6, None),
    # 💎 world 4
    ("thaw", 18, 20, 18, 4, 6, None), ("colour", 40, 18, 6, 0, 6, 4), ("stones", 10, 20, 0, 10, 6, None),
    ("prism", 2, 25, 0, 0, 5, None), ("score", 9000, 18, 0, 4, 6, None), ("thaw", 20, 22, 20, 6, 6, None),
]


class Board:
    """The rules engine: matching, specials, gravity, cascades, attacks. Used by bots and tests."""

    def __init__(self, rng, kinds=6, rows=None):
        self.rng, self.kinds = rng, kinds
        if rows:
            self.g = list(rows)
            self.fill()
        else:
            self.g = [EMPTY] * (N * N)
            self.deal()

    # -- helpers
    def rows(self):
        return "".join(self.g)

    def at(self, x, y):
        return self.g[y * N + x]

    def new_gem(self):
        return PLAIN[self.rng.randrange(self.kinds)]

    def deal(self):
        """A fresh board with no ready-made matches and at least one move."""
        for _ in range(200):
            for i in range(N * N):
                x, y = i % N, i // N
                for _ in range(20):
                    ch = self.new_gem()
                    if x >= 2 and kind(self.g[i - 1]) == kind(self.g[i - 2]) == kind(ch):
                        continue
                    if y >= 2 and kind(self.g[i - N]) == kind(self.g[i - 2 * N]) == kind(ch):
                        continue
                    break
                self.g[i] = ch
            if self.moves():
                return

    def fill(self):
        for i, ch in enumerate(self.g):
            if ch == EMPTY:
                self.g[i] = self.new_gem()

    @staticmethod
    def matchable(ch):
        return ch not in FROZEN and ch not in (PRISM, STONE, EMPTY)

    def movable(self, i):
        ch = self.g[i]
        return ch not in FROZEN and ch not in (STONE, EMPTY)

    # -- matching
    def runs(self):
        """Every straight run of 3+ matchable gems of one colour: (cells, 'h' | 'v')."""
        out = []
        for horiz in (True, False):
            for a in range(N):
                b = 0
                while b < N:
                    idx = lambda t: (a * N + t) if horiz else (t * N + a)
                    ch = self.g[idx(b)]
                    k = kind(ch) if self.matchable(ch) else None
                    e = b + 1
                    while k is not None and e < N and self.matchable(self.g[idx(e)]) and kind(self.g[idx(e)]) == k:
                        e += 1
                    if k is not None and e - b >= 3:
                        out.append(([idx(t) for t in range(b, e)], "h" if horiz else "v"))
                    b = e
        return out

    def groups(self):
        """Runs joined where they share a cell: [(cells set, [runs])]."""
        groups = []
        for run in self.runs():
            cells = set(run[0])
            joined = [g for g in groups if g[0] & cells]
            for g in joined:
                groups.remove(g)
                cells |= g[0]
            groups.append((cells, [run] + [r for g in joined for r in g[1]]))
        return groups

    def made(self, cells, runs, prefer):
        """The special a matched group makes, and where it goes: (char, index) or None."""
        k = kind(self.g[next(iter(cells))])
        longest = max(len(r[0]) for r in runs)
        dirs = {r[1] for r in runs}
        if longest >= 5:
            ch = PRISM
        elif len(dirs) == 2:
            ch = NOVA[k]
        elif longest == 4:
            ch = (BEAM_H if runs[0][1] == "h" else BEAM_V)[k]
        else:
            return None
        spot = next((i for i in prefer if i in cells), None)
        if spot is None and len(dirs) == 2:
            h = {i for r in runs if r[1] == "h" for i in r[0]}
            v = {i for r in runs if r[1] == "v" for i in r[0]}
            spot = min(h & v) if h & v else None
        if spot is None:
            run = max(runs, key=lambda r: len(r[0]))[0]
            spot = run[len(run) // 2]
        return ch, spot

    # -- blasts
    def blast_area(self, i, sp, hit_kind=None):
        x, y = i % N, i // N
        if sp == "h":
            return {y * N + t for t in range(N)}
        if sp == "v":
            return {t * N + x for t in range(N)}
        if sp == "n":
            return {yy * N + xx for yy in range(y - 1, y + 2) for xx in range(x - 1, x + 2) if 0 <= xx < N and 0 <= yy < N}
        if sp == "p":
            if hit_kind is None:  # set off by another blast: takes the commonest colour with it
                counts = [sum(1 for c in self.g if kind(c) == k and c not in FROZEN) for k in range(self.kinds)]
                hit_kind = max(range(self.kinds), key=lambda k: counts[k])
            return {j for j, c in enumerate(self.g) if kind(c) == hit_kind and c not in FROZEN} | {i}
        return set()

    def explode(self, clear, fired):
        """Grow `clear` with every special inside it, chaining. `fired` collects the specials set off."""
        todo, done = list(clear), set()
        while todo:
            i = todo.pop()
            if i in done:
                continue
            done.add(i)
            sp = special(self.g[i])
            if sp:
                fired.append({"h": "beam", "v": "beam", "n": "nova", "p": "prism"}[sp])
                for j in self.blast_area(i, sp):
                    if j not in done:
                        todo.append(j)
            clear.add(i)
        return clear

    def remove(self, clear, step, fired, created=None):
        """Clear cells; frozen gems thaw and stones break instead. Neighbours of cleared gems thaw / break.
        Returns points scored."""
        pts = 0
        hits = set(clear)
        for i in list(clear):
            x, y = i % N, i // N
            for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= xx < N and 0 <= yy < N:
                    hits.add(yy * N + xx)
        for i in hits:
            ch = self.g[i]
            if ch in FROZEN:
                self.g[i] = PLAIN[FROZEN.index(ch)]
            elif ch == STONE:
                self.g[i] = EMPTY
                pts += STONE_PTS * step
            elif i in clear and ch != EMPTY:
                self.g[i] = EMPTY
                pts += GEM_PTS * step
        for ch, spot in created or []:
            self.g[spot] = ch
            pts += MAKE_PTS["prism" if ch == PRISM else "nova" if ch in NOVA else "beam"] * step
        return pts

    def gravity(self, refill=True):
        for x in range(N):
            col = [self.g[y * N + x] for y in range(N) if self.g[y * N + x] != EMPTY]
            gaps = N - len(col)
            col = [self.new_gem() if refill else EMPTY for _ in range(gaps)] + col
            for y in range(N):
                self.g[y * N + x] = col[y]

    def swap_kind(self, a, b):
        """What swapping a and b does: 'combo' / 'prism' (a special pair or a prism with a gem), 'match',
        or None (it would bounce back)."""
        if b not in self.neighbours(a) or not self.movable(a) or not self.movable(b):
            return None
        sa, sb = special(self.g[a]), special(self.g[b])
        if sa and sb:
            return "combo"
        if "p" in (sa, sb):
            return "prism"
        self.g[a], self.g[b] = self.g[b], self.g[a]
        ok = self.lined(a) or self.lined(b)
        self.g[a], self.g[b] = self.g[b], self.g[a]
        return "match" if ok else None

    def lined(self, i):
        """Is the gem at i part of a straight 3 (quick local check)?"""
        ch = self.g[i]
        if not self.matchable(ch):
            return False
        k, x, y = kind(ch), i % N, i // N
        same = lambda xx, yy: 0 <= xx < N and 0 <= yy < N and self.matchable(self.g[yy * N + xx]) and kind(self.g[yy * N + xx]) == k
        for dx, dy in ((1, 0), (0, 1)):
            n = 1
            t = 1
            while same(x + dx * t, y + dy * t):
                n, t = n + 1, t + 1
            t = 1
            while same(x - dx * t, y - dy * t):
                n, t = n + 1, t + 1
            if n >= 3:
                return True
        return False

    @staticmethod
    def neighbours(i):
        x, y = i % N, i // N
        return [yy * N + xx for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)) if 0 <= xx < N and 0 <= yy < N]

    def moves(self):
        out = []
        for i in range(N * N):
            for j in (i + 1, i + N):
                if (j == i + 1 and i % N == N - 1) or j >= N * N:
                    continue
                if self.swap_kind(i, j):
                    out.append((i, j))
        return out

    def play(self, a, b, refill=True):
        """Make a move. Returns {pts, cascade, fired, made} or None for a move that bounces back.
        With refill=False nothing new falls in (a bot's fair look-ahead: it can't see the next gems)."""
        what = self.swap_kind(a, b)
        if not what:
            return None
        fired, made, pts = [], [], 0
        if what in ("combo", "prism"):
            sa, sb = special(self.g[a]), special(self.g[b])
            if what == "prism":
                other = b if sa == "p" else a
                prism = a if sa == "p" else b
                area = self.blast_area(prism, "p", kind(self.g[other]))
                self.g[prism] = EMPTY
                fired.append("prism")
            else:
                pair = {sa, sb}
                x, y = b % N, b // N
                if "p" in pair:
                    area = set(range(N * N))
                elif pair == {"n"}:
                    area = {yy * N + xx for yy in range(y - 2, y + 3) for xx in range(x - 2, x + 3) if 0 <= xx < N and 0 <= yy < N}
                elif "n" in pair:
                    area = {t * N + xx for t in range(N) for xx in range(x - 1, x + 2) if 0 <= xx < N} | \
                           {yy * N + t for t in range(N) for yy in range(y - 1, y + 2) if 0 <= yy < N}
                else:
                    area = {y * N + t for t in range(N)} | {t * N + x for t in range(N)}
                self.g[a] = self.g[b] = EMPTY
                fired.append("combo")
            area = self.explode(set(area), fired)
            pts += self.remove(area, 1, fired)
            self.gravity(refill)
            step = 1
        else:
            self.g[a], self.g[b] = self.g[b], self.g[a]
            step = 0
        prefer = [a, b]
        while True:
            groups = self.groups()
            if not groups:
                break
            step += 1
            clear, created = set(), []
            for cells, runs in groups:
                m = self.made(cells, runs, prefer)
                if m:
                    created.append(m)
                    made.append("prism" if m[0] == PRISM else "nova" if m[0] in NOVA else "beam")
                clear |= cells
            # specials sitting in the match go off; new specials land on their spots after the clear
            clear = self.explode(clear, fired)
            pts += self.remove(clear, step, fired, created)
            self.gravity(refill)
            prefer = []
        if refill and not self.moves():
            self.shuffle()
        return {"pts": pts, "cascade": step, "fired": fired, "made": made}

    def shuffle(self):
        """No moves left: shuffle the loose gems (thawing everything if that still finds nothing)."""
        for attempt in range(60):
            if attempt == 40:
                self.g = [PLAIN[FROZEN.index(c)] if c in FROZEN else self.new_gem() if c == STONE else c for c in self.g]
            loose = [i for i, c in enumerate(self.g) if self.movable(i)]
            vals = [self.g[i] for i in loose]
            self.rng.shuffle(vals)
            for i, v in zip(loose, vals):
                self.g[i] = v
            if not self.runs() and self.moves():
                return
        self.g = [EMPTY] * (N * N)
        self.deal()

    # -- attacks
    def freeze(self, n):
        spots = [i for i, c in enumerate(self.g) if c in PLAIN]
        for i in self.rng.sample(spots, min(n, len(spots))):
            self.g[i] = FROZEN[PLAIN.index(self.g[i])]
        if not self.moves():
            self.shuffle()

    def stones(self, n):
        spots = [i for i, c in enumerate(self.g) if c in PLAIN and i < N * 3] or [i for i, c in enumerate(self.g) if c in PLAIN]
        for i in self.rng.sample(spots, min(n, len(spots))):
            self.g[i] = STONE
        if not self.moves():
            self.shuffle()


def bot_move(board, level, rng):
    """Pick a move for a bot: easy plays any match it sees, normal one of its three best first clears, hard
    looks at the whole cascade it can see (no peeking at gems that haven't fallen yet) and likes specials,
    attacks and low moves."""
    moves = board.moves()
    if not moves:
        return None
    if level == "easy":
        return rng.choice(moves)
    ranked = []
    for a, b in moves:
        sim = Board(random.Random(0), board.kinds)
        sim.g = list(board.g)
        res = sim.play(a, b, refill=False)
        if not res:
            continue
        if level == "hard":
            frost, stones = attack_for(res["cascade"], res["fired"] + (["prism"] if "prism" in res["made"] else []))
            score = res["pts"] + 40 * len(res["made"]) + 30 * (frost + 2 * stones) + 4 * (max(a, b) // N)
        else:
            score = res["pts"] if res["cascade"] <= 1 else res["pts"] * 0.6
        ranked.append((score + rng.random() * 15, (a, b)))
    if not ranked:
        return None
    ranked.sort(reverse=True)
    return (rng.choice(ranked[:3]) if level != "hard" else ranked[0])[1]


class Prism(Game):
    id = "prism"
    category = "action"
    howto = [
        'Everyone plays their own board at the same time. Swap two neighbouring gems to line up 3 or more of a kind.',
        'Tap a gem, then a neighbour (or swipe it). ⌨️ Arrow keys move, Enter or Space picks.',
        '4 in a row makes a ⚡ beam (clears a row or column), an L or T makes a 💥 nova (clears around it), 5 in a row makes a 🌈 prism: swap it with a gem to clear that colour.',
        'Swap two specials together for a bigger blast. Cascades raise the multiplier: ×2, ×3…',
        'Big plays send 🧊 frost (frozen gems can\'t move) and 🪨 stones to a rival: a match next to them breaks them. An attack shows a warning first: a ×3 cascade or a special before it lands 🛡 shatters it. Highest score when the clock runs out wins.',
        'Quick matches fill the 🔥 fever meter: when it\'s full, points count double for 6 seconds. The last 10 seconds are a RUSH: double points again (they stack).',
        '🎯 Levels mode (one player): reach each level\'s goal before your moves run out. More moves left = more ★.',
    ]
    name = "Prism Pop"
    icon = "💎"
    blurb = ("A match-3 race: everyone plays their own sparkling board at once. Chain cascades, build beams, "
             "novas and prisms, and send frost and stones to your rivals. Top score at the bell wins.")
    min_players = 1
    max_players = 6
    replayable = False
    levels = False   # 🎯 levels mode (one player, no clock); set in start()
    badges = {**Game.badges,
              "cascade5": ("🌊", "Waterfall", "Set off a ×5 cascade"),
              "prism": ("🌈", "Prism maker", "Make a 🌈 prism gem"),
              "parry": ("🛡", "Shatterproof", "Shatter an incoming attack"),
              "levels": ("👑", "Prism master", "Clear all 24 🎯 levels")}
    settings_schema = {
        "mode": ("Mode", [("race", "⏱️ Race"), ("levels", "🎯 Levels (one player)")], "race"),
        "length": ("Round", [(60, "⏱️ 60 s"), (90, "⏱️ 90 s"), (120, "⏱️ 2 min")], 90),
        "attacks": ("Attacks", [(True, "On (🧊 frost, 🪨 stones)"), (False, "Off (pure score race)")], True),
        "aim": ("Attacks go to", [("random", "🎲 A random rival"), ("leader", "👑 The leader (comeback)")], "random"),
        "gems": ("Gem colours", [(6, "6 (standard)"), (5, "5 (more cascades)")], 6),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seed = rng.getrandbits(30)
        self.t0 = time.time() + 3.5  # countdown
        self.seats = [p.id for p in seated]
        self.eid = 0
        r = self.room
        self.levels = self.s.get("mode") == "levels" and len(seated) == 1 and not seated[0].bot
        if self.s.get("mode") == "levels" and not self.levels:
            r.add_log("🎯 Levels are for one player on their own — playing a race instead.")
        if self.levels:
            self.t0 = time.time()
        kinds = self.kinds()
        for p in seated:
            g = p.g
            g.board = None
            g.rows = Board(random.Random(self.seed + self.seats.index(p.id)), kinds).rows()
            g.score, g.sent, g.best, g.events, g.applied = 0, 0, 0, [], 0
            g.next_at, g.vt = self.t0 + random.uniform(0.8, 1.6), 0.0
            g.fever, g.fever_until, g.parried, g.hits, g.last_from = 0.0, 0.0, 0, 0, None
            g.level, g.runs, g.stars = 0, 0, {}
        r.turn = None
        r.bot_at = 0
        if self.levels:
            r.deadline = None
            r.add_log("🎯 Prism Pop levels! Pick a level and reach its goal before your moves run out.", "big")
        else:
            r.deadline = self.t0 + self.length()
            r.add_log(f"💎 Prism Pop! {self.length()} seconds — line up 3+ gems, chain cascades, top score wins.", "big")

    def kinds(self):
        return 5 if self.s.get("gems") == 5 else 6

    def length(self):
        return int(self.s.get("length") or 90)

    def on_restore(self, shift):
        self.t0 += shift
        for i in self.seats:
            p = self.room.players.get(i)
            if p and hasattr(p.g, "next_at"):
                p.g.next_at += shift
                for ev in p.g.events:
                    if "at" in ev:
                        ev["at"] += shift

    # -- actions from players' browsers

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're not on a board this round.")
        if time.time() < self.t0 - 0.5:
            raise GameError("Not yet — get ready!")
        if t == "board":
            rows, score = a.get("rows"), a.get("score")
            if not isinstance(rows, str) or len(rows) != N * N or not set(rows) <= CHARS:
                raise GameError("Bad board.")
            if not isinstance(score, int) or isinstance(score, bool) or not p.g.score <= score <= p.g.score + MAX_GAIN:
                raise GameError("Bad score.")
            p.g.rows, p.g.score = rows, score
            return
        if t == "parry":
            n, src = a.get("n"), a.get("from") or []
            if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 20) or not isinstance(src, list):
                raise GameError("Bad parry.")
            return self.on_parry(p, n, [i for i in src if i in self.seats and i != p.id][:6])
        if t in ("level", "levelEnd", "map", "quit"):
            if not self.levels:
                raise GameError("Not a levels game.")
            return self.level_act(p, t, a)
        if t == "burst":
            cascade, specials = a.get("cascade"), a.get("specials") or []
            made = a.get("made") or []
            if not (isinstance(cascade, int) and not isinstance(cascade, bool) and 0 <= cascade <= 30):
                raise GameError("Bad burst.")
            if not isinstance(specials, list) or not isinstance(made, list):
                raise GameError("Bad burst.")
            specials = [s for s in specials if s in SPECIAL_KINDS][:6]
            made = [s for s in made if s in ("beam", "nova", "prism")][:6]
            return self.on_burst(p, cascade, specials, made)
        raise GameError("Unknown action.")

    def send(self, o, event):
        self.eid += 1
        o.g.events = (o.g.events + [{**event, "id": self.eid, "at": time.time() + PARRY_SECS}])[-30:]
        o.g.hits = getattr(o.g, "hits", 0) + 1
        o.g.last_from = event.get("fromId")

    def on_parry(self, p, n, src):
        p.g.parried += n
        self.award(p, "parry")
        names = [self.room.players[i].name for i in dict.fromkeys(src) if i in self.room.players]
        who = f"{' and '.join(names)}'s attack" if names else "an attack"
        self.room.add_log(f"🛡 {p.name} shattered {who}!", "question")

    # -- 🎯 levels
    def level_act(self, p, t, a):
        g, r = p.g, self.room
        if t == "quit":
            done = sum(1 for v in g.stars.values() if v)
            stars = sum(g.stars.values())
            return r.finish(None, f"🎯 {p.name} cleared {done} level{'s' if done != 1 else ''} ({stars}★) this time.")
        if t == "map":
            g.level = 0
            return
        n = a.get("n")
        if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= len(LEVELS)):
            raise GameError("No such level.")
        if t == "levelEnd":
            stars, score = a.get("stars"), a.get("score")
            if n != g.level or not (isinstance(stars, int) and not isinstance(stars, bool) and 0 <= stars <= 3):
                raise GameError("Bad level result.")
            g.stars[n] = max(stars, g.stars.get(n, 0))
            if stars:
                r.add_log(f"🎯 {p.name} cleared level {n} {'★' * stars}{'☆' * (3 - stars)}", "question")
                if n == len(LEVELS):
                    self.award(p, "levels")
            return
        goal, target, moves_, frozen, stones, kinds, colour = LEVELS[n - 1]
        b = Board(random.Random(self.seed + n), kinds)
        if frozen:
            b.freeze(frozen)
        if stones:
            b.stones(stones)
        g.rows, g.score, g.level = b.rows(), 0, n
        g.runs += 1

    def on_burst(self, p, cascade, specials, made):
        r = self.room
        if cascade >= 5:
            self.award(p, "cascade5")
        if "prism" in made:
            self.award(p, "prism")
        if not self.s.get("attacks", True):
            if cascade >= 5:
                r.add_log(f"🌊 {p.name} set off a ×{cascade} cascade!", "question")
            return
        frost, stones = attack_for(cascade, specials)
        if p.bot and self.rng.random() >= ATTACK_ODDS.get(p.bot, 1.0):
            frost = stones = 0
        foes = [o for o in r.contenders() if o.id != p.id]
        now = time.time()
        if not (frost or stones) or not foes or now < getattr(p.g, "attack_at", 0):
            return
        p.g.attack_at = now + ATTACK_GAP
        if self.s.get("aim") == "leader":
            top = max(o.g.score for o in foes)
            target = self.rng.choice([o for o in foes if o.g.score == top])
        else:
            target = self.rng.choice(foes)
        what = []
        if frost:
            self.send(target, {"kind": "frost", "n": frost, "from": p.name, "fromId": p.id})
            what.append(f"🧊 {frost} frost")
        if stones:
            self.send(target, {"kind": "stone", "n": stones, "from": p.name, "fromId": p.id})
            what.append(f"🪨 {stones} stones")
        p.g.sent += frost + stones
        if stones or cascade >= 4:
            why = f"a ×{cascade} cascade" if cascade >= 4 else "a 🌈 blast" if "prism" in specials else "a special combo"
            r.add_log(f"💎 {p.name}'s {why} sent {' and '.join(what)} to {target.name}!", "question")

    def on_timeout(self):
        r = self.room
        if r.phase != "playing":
            return
        scores = {i: r.players[i].g.score for i in self.seats if i in r.players}
        # one line per round in the server log, to tune the bots against what people really score
        print(f"[prism] {self.length()}s {self.kinds()} gems: " + ", ".join(
            f"{r.players[i].bot + ' bot' if r.players[i].bot else 'human'} {s}" for i, s in scores.items()), flush=True)
        if len(self.seats) == 1:
            pid = self.seats[0]
            p = r.players.get(pid)
            best = scores.get(pid, 0)
            return r.finish(None, f"💎 Time! {p.name if p else 'You'} scored {best:,} points.")
        live = {i: s for i, s in scores.items() if not r.players[i].eliminated} or scores
        top = max(live.values(), default=0)
        leaders = [i for i, s in live.items() if s == top]
        if len(leaders) == 1:
            w = r.players[leaders[0]]
            r.finish(w, f"🏆 {w.name} wins Prism Pop with {top:,} points!")
        else:
            r.finish(None, f"🤝 A tie at {top:,} points!")

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the game.")
        if not r.contenders():
            r.finish(None, "Everyone left.")

    # -- bots: each plays its own board on its own clock (vt counts their own seconds of play)

    def bot_ready(self):
        now = time.time()
        if self.room.deadline and now >= self.room.deadline:
            return True
        return any(o.bot and now >= o.g.next_at and o.g.vt < self.length() for o in self.room.contenders())

    def bot_tick(self):
        now = time.time()
        r = self.room
        if r.deadline and now >= r.deadline:
            return self.on_timeout()
        for o in r.contenders():
            if o.bot and now >= o.g.next_at and o.g.vt < self.length() and r.phase == "playing":
                self.bot_step(o, now)

    def bot_step(self, o, now):
        g = o.g
        if g.board is None:
            g.board = Board(random.Random(self.rng.getrandbits(30)), self.kinds(), g.rows)
            g.applied = max([e["id"] for e in g.events], default=0)  # a stand-in starts fresh
        b = g.board
        # attacks land once their warning runs out (events come in id order, so stop at the first one still due)
        for ev in g.events:
            if ev["id"] <= g.applied:
                continue
            if ev.get("at", 0) > now:
                break
            g.applied = ev["id"]
            (b.freeze if ev["kind"] == "frost" else b.stones)(ev["n"])
        pace = PACE.get(o.bot, 2.4) * random.uniform(0.8, 1.25)
        move = bot_move(b, o.bot, self.rng)
        if not move:
            b.shuffle()
        else:
            mult = self.mult(g, now)
            res = b.play(*move)
            if res:
                # the moves' animations take time on a player's screen; bots wait for them too
                pace += STEP_SECS * res["cascade"] + BLAST_SECS * len(res["fired"])
                g.score += res["pts"] * mult
                if g.vt >= g.fever_until:
                    g.fever += fever_fill(res["cascade"])
                    if g.fever >= 100:
                        g.fever, g.fever_until = 0.0, g.vt + pace + FEVER_SECS
                if bursts(res["cascade"], res["fired"]):
                    pending = [e for e in g.events if e["id"] > g.applied]
                    if pending:   # shattered in time, like a player's parry
                        g.applied = pending[-1]["id"]
                        self.on_parry(o, len(pending), [e.get("fromId") for e in pending])
                if res["cascade"] >= 3 or res["fired"] or res["made"]:
                    self.on_burst(o, res["cascade"], res["fired"], res["made"])
        g.vt += pace
        g.fever = max(0.0, g.fever - FEVER_DRAIN * pace)
        g.next_at = now + pace
        g.rows = b.rows()

    def mult(self, g, now):
        """Points multiplier for a bot's move: 🔥 fever ×2 (on its own clock), the final RUSH ×2."""
        m = 2 if g.vt < g.fever_until else 1
        if self.room.deadline and now >= self.room.deadline - RUSH_SECS:
            m *= 2
        return m

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        if self.levels:
            return f"🎯 Level {p.g.level}" if p.g.level else "🎯 Choosing a level"
        return f"💎 {p.g.score:,}"

    def final_scores(self):
        if self.levels:   # a level's score isn't a race score: keep it out of personal bests
            return {}
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def view(self, p):
        now = time.time()
        boards = {}
        for i in self.seats:
            o = self.room.players.get(i)
            if o:
                boards[i] = {"rows": o.g.rows, "score": o.g.score, "sent": o.g.sent, "hits": o.g.hits,
                             "lastFrom": o.g.last_from, "parried": o.g.parried, "alive": not o.eliminated}
        mine = p.id in self.seats
        out = {
            "N": N, "kinds": self.kinds(), "seed": self.seed + (self.seats.index(p.id) if mine else 0),
            "startIn": max(0.0, self.t0 - now), "timeLeft": max(0.0, (self.room.deadline or now) - now) if self.room.phase == "playing" else 0,
            "length": self.length(), "attacks": bool(self.s.get("attacks", True)) and not self.levels,
            "boards": boards, "events": p.g.events if mine else [],
            "playing": mine and not p.eliminated and self.room.phase == "playing",
            "mode": "levels" if self.levels else "race",
        }
        if self.levels:
            o = self.room.players.get(self.seats[0])
            lv = o.g.level if o else 0
            out.update(level=lv, runs=o.g.runs if o else 0, seed=self.seed + 7919 * (o.g.runs if o else 0),
                       kinds=LEVELS[lv - 1][5] if lv else self.kinds(),
                       levels=[{"goal": d[0], "target": d[1], "moves": d[2], "frozen": d[3], "stones": d[4],
                                "kinds": d[5], "colour": d[6]} for d in LEVELS])
        return {"prism": out}
