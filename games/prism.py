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
PACE = {"easy": 2.8, "normal": 1.6, "hard": 1.1}   # seconds a bot takes per move


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
    """Pick a move for a bot: easy plays any match, normal the best first clear, hard looks at the whole
    cascade it can see (no peeking at gems that haven't fallen yet) and likes specials, attacks and low moves."""
    moves = board.moves()
    if not moves:
        return None
    if level == "easy" and rng.random() < 0.6:
        return rng.choice(moves)
    best, best_score = None, None
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
        score += rng.random() * (40 if level == "easy" else 15)
        if best_score is None or score > best_score:
            best, best_score = (a, b), score
    return best


class Prism(Game):
    id = "prism"
    category = "action"
    howto = [
        'Everyone plays their own board at the same time. Swap two neighbouring gems to line up 3 or more of a kind.',
        'Tap a gem, then a neighbour (or swipe it). ⌨️ Arrow keys move, Enter or Space picks.',
        '4 in a row makes a ⚡ beam (clears a row or column), an L or T makes a 💥 nova (clears around it), 5 in a row makes a 🌈 prism: swap it with a gem to clear that colour.',
        'Swap two specials together for a bigger blast. Cascades raise the multiplier: ×2, ×3…',
        'Big plays send 🧊 frost (frozen gems can\'t move) and 🪨 stones to a rival: a match next to them breaks them. Highest score when the clock runs out wins.',
    ]
    name = "Prism Pop"
    icon = "💎"
    blurb = ("A match-3 race: everyone plays their own sparkling board at once. Chain cascades, build beams, "
             "novas and prisms, and send frost and stones to your rivals. Top score at the bell wins.")
    min_players = 1
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "cascade5": ("🌊", "Waterfall", "Set off a ×5 cascade"),
              "prism": ("🌈", "Prism maker", "Make a 🌈 prism gem")}
    settings_schema = {
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
        kinds = self.kinds()
        for p in seated:
            g = p.g
            g.board = None
            g.rows = Board(random.Random(self.seed + self.seats.index(p.id)), kinds).rows()
            g.score, g.sent, g.best, g.events, g.applied = 0, 0, 0, [], 0
            g.next_at, g.vt = self.t0 + random.uniform(0.8, 1.6), 0.0
        r = self.room
        r.turn = None
        r.deadline = self.t0 + self.length()
        r.bot_at = 0
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
        o.g.events = (o.g.events + [{**event, "id": self.eid}])[-30:]
        o.g.hits = getattr(o.g, "hits", 0) + 1

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
        for ev in g.events:
            if ev["id"] <= g.applied:
                continue
            g.applied = ev["id"]
            (b.freeze if ev["kind"] == "frost" else b.stones)(ev["n"])
        pace = PACE.get(o.bot, 1.6)
        g.vt += pace
        g.next_at = now + pace * random.uniform(0.8, 1.25)
        move = bot_move(b, o.bot, self.rng)
        if not move:
            b.shuffle()
        else:
            res = b.play(*move)
            if res:
                g.score += res["pts"]
                if res["cascade"] >= 3 or res["fired"] or res["made"]:
                    self.on_burst(o, res["cascade"], res["fired"], res["made"])
        g.rows = b.rows()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"💎 {p.g.score:,}"

    def final_scores(self):
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def view(self, p):
        now = time.time()
        boards = {}
        for i in self.seats:
            o = self.room.players.get(i)
            if o:
                boards[i] = {"rows": o.g.rows, "score": o.g.score, "sent": o.g.sent, "hits": getattr(o.g, "hits", 0), "alive": not o.eliminated}
        mine = p.id in self.seats
        return {"prism": {
            "N": N, "kinds": self.kinds(), "seed": self.seed + (self.seats.index(p.id) if mine else 0),
            "startIn": max(0.0, self.t0 - now), "timeLeft": max(0.0, (self.room.deadline or now) - now) if self.room.phase == "playing" else 0,
            "length": self.length(), "attacks": bool(self.s.get("attacks", True)),
            "boards": boards, "events": p.g.events if mine else [],
            "playing": mine and not p.eliminated and self.room.phase == "playing",
        }}
