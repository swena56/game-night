"""Hedgerow: an original garden-maze race for 2–4 players. Step your pawn across the garden to the far
edge, or plant a two-cell hedge to make a rival walk the long way round. A hedge may never seal
anyone in completely. Each player also gets one 🐇 hop: step straight through a hedge, once a game."""
import random
import time
from collections import deque

from .base import Game, GameError

SIDES = ("S", "N", "W", "E")  # where each seat starts; it races to the opposite edge
SIDE_NAME = {"S": "bottom", "N": "top", "W": "left", "E": "right"}
STEPS = ((-1, 0), (1, 0), (0, -1), (0, 1))
PLY_CAP = 400  # a stalemate guard: after this many turns, the pawn closest to home wins


class Hedgerow(Game):
    id = "hedgerow"
    category = "strategy"
    howto = [
        "On your turn, step your pawn one square, or plant a hedge (two squares long) in a groove.",
        "First pawn to reach the far edge, your coloured side opposite, wins.",
        "To plant, tap a groove: the hedge centres on the nearest crossing and shows how many steps it costs each rival. ↻ Turn flips it.",
        "A hedge can never seal anyone in: there must always be a way through.",
        "Standing face to face? Leap over the other pawn, or slip diagonally past if a hedge is behind it.",
        "🐇 Once per game you may hop straight through a hedge.",
    ]
    name = "Hedgerow"
    icon = "🌿"
    blurb = "Race across the garden, plant hedges to send rivals the long way round."
    min_players = 2
    max_players = 4
    badges = {**Game.badges, "detour": ("🌀", "Long way round", "Add 6 or more steps to a rival's route with one hedge")}
    settings_schema = {
        "size": ("Garden", [(9, "9×9"), (7, "7×7 (quick)")], 9),
        "hop": ("🐇 Hop", [(True, "One hop each"), (False, "Off")], True),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        n = self.n = self.s["size"]
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        total = 20 if n == 9 else 12
        each = total // 2 if len(seated) == 2 else total // 4
        mid = n // 2
        start_at = {"S": (n - 1, mid), "N": (0, mid), "W": (mid, 0), "E": (mid, n - 1)}
        for i, p in enumerate(seated):
            p.g.side = SIDES[i]
            p.g.pos = start_at[p.g.side]
            p.g.hedges = each
            p.g.hop = bool(self.s["hop"])
            p.g.steps = 0
        self.hedges = []  # [o, r, c, seat]: "h" at (r, c) lies under cells (r, c) and (r, c+1); "v" right of (r, c), (r+1, c)
        self.cut = set()
        self.last = None
        self.ply = 0
        self.room.add_log(f"🌿 A {n}×{n} garden, {each} hedges each. {seated[0].name} sets off first.", "big")
        self.room.begin_turn(seated[0].id)

    # -- geometry

    @staticmethod
    def edge(a, b):
        return (a, b) if a < b else (b, a)

    @classmethod
    def hedge_cuts(cls, o, r, c):
        if o == "h":
            return [cls.edge((r, c), (r + 1, c)), cls.edge((r, c + 1), (r + 1, c + 1))]
        return [cls.edge((r, c), (r, c + 1)), cls.edge((r + 1, c), (r + 1, c + 1))]

    def inside(self, r, c):
        return 0 <= r < self.n and 0 <= c < self.n

    def at_goal(self, side, cell):
        r, c = cell
        return {"S": r == 0, "N": r == self.n - 1, "W": c == self.n - 1, "E": c == 0}[side]

    def dist(self, side, start, cut=None):
        """Steps from start to the side's goal edge, ignoring pawns; None if sealed in."""
        cut = self.cut if cut is None else cut
        if self.at_goal(side, start):
            return 0
        seen, q = {start: 0}, deque([start])
        while q:
            cell = q.popleft()
            r, c = cell
            for dr, dc in STEPS:
                nxt = (r + dr, c + dc)
                if nxt in seen or not self.inside(*nxt) or self.edge(cell, nxt) in cut:
                    continue
                seen[nxt] = seen[cell] + 1
                if self.at_goal(side, nxt):
                    return seen[nxt]
                q.append(nxt)
        return None

    def path(self, side, start, cut=None):
        """One shortest route (list of cells after start) to the goal edge."""
        cut = self.cut if cut is None else cut
        prev, q = {start: None}, deque([start])
        while q:
            cell = q.popleft()
            if self.at_goal(side, cell):
                out = []
                while cell != start:
                    out.append(cell)
                    cell = prev[cell]
                return out[::-1]
            r, c = cell
            for dr, dc in STEPS:
                nxt = (r + dr, c + dc)
                if nxt not in prev and self.inside(*nxt) and self.edge(cell, nxt) not in cut:
                    prev[nxt] = cell
                    q.append(nxt)
        return []

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and hasattr(self.room.players[i].g, "pos")]

    def racers(self):
        """Players still in the race (not left / eliminated)."""
        return [q for q in self.players() if not q.eliminated and not q.spectator]

    def moves(self, p):
        """Legal pawn moves: {(r, c): "step" | "jump" | "hop"}."""
        occ = {q.g.pos for q in self.racers() if q is not p}
        out = {}
        r, c = p.g.pos
        for dr, dc in STEPS:
            nxt = (r + dr, c + dc)
            if not self.inside(*nxt):
                continue
            blocked = self.edge((r, c), nxt) in self.cut
            if blocked:
                if p.g.hop and nxt not in occ:
                    out[nxt] = "hop"
                continue
            if nxt not in occ:
                out[nxt] = "step"
                continue
            far = (nxt[0] + dr, nxt[1] + dc)  # leap the pawn, or slip diagonally past it
            if self.inside(*far) and self.edge(nxt, far) not in self.cut and far not in occ:
                out[far] = "jump"
                continue
            for sr, sc in ((dc, dr), (-dc, -dr)):
                side = (nxt[0] + sr, nxt[1] + sc)
                if self.inside(*side) and self.edge(nxt, side) not in self.cut and side not in occ and side != (r, c):
                    out.setdefault(side, "jump")
        return out

    def hedge_fits(self, o, r, c):
        """Fits in the grooves without overlapping or crossing another hedge (path rule checked separately)."""
        if o not in ("h", "v") or not (0 <= r < self.n - 1 and 0 <= c < self.n - 1):
            return False
        have = {(h[0], h[1], h[2]) for h in self.hedges}
        other = "v" if o == "h" else "h"
        if (o, r, c) in have or (other, r, c) in have:
            return False
        near = ((o, r, c - 1), (o, r, c + 1)) if o == "h" else ((o, r - 1, c), (o, r + 1, c))
        return not any(x in have for x in near)

    def hedge_ok(self, o, r, c):
        if not self.hedge_fits(o, r, c):
            return False
        cut = self.cut | set(self.hedge_cuts(o, r, c))
        return all(self.dist(q.g.side, q.g.pos, cut) is not None for q in self.racers())

    def legal_hedges(self):
        n = self.n
        return [(o, r, c) for o in ("h", "v") for r in range(n - 1) for c in range(n - 1) if self.hedge_ok(o, r, c)]

    # -- actions

    def act(self, p, a):
        kind = a.get("type")
        if kind not in ("move", "hedge"):
            raise GameError("Unknown action.")
        self.require_turn(p)
        r, c = a.get("r"), a.get("c")
        if not (isinstance(r, int) and isinstance(c, int)) or isinstance(r, bool) or isinstance(c, bool):
            raise GameError("Pick a square.")
        if kind == "move":
            if (r, c) not in self.moves(p):
                raise GameError("Your pawn can't go there.")
            return self.do_move(p, (r, c))
        o = a.get("o")
        if p.g.hedges <= 0:
            raise GameError("You have no hedges left.")
        if not self.hedge_fits(o, r, c):
            raise GameError("That hedge doesn't fit there.")
        if not self.hedge_ok(o, r, c):
            raise GameError("That hedge would seal someone in — there must always be a way through.")
        self.do_hedge(p, (o, r, c))

    def do_move(self, p, cell):
        how = self.moves(p)[cell]
        p.g.pos = cell
        p.g.steps += 1
        if how == "hop":
            p.g.hop = False
        self.last = {"by": p.id, "kind": how, "to": list(cell)}
        verb = {"step": "steps", "jump": "leaps", "hop": "🐇 hops through a hedge"}[how]
        self.room.add_log(f"{p.name} {verb} to {self.label(cell)}", "power" if how == "hop" else "question")
        if self.at_goal(p.g.side, cell):
            return self.room.finish(p, f"🏆 {p.name} makes it across the garden and wins!")
        self.next_turn()

    def do_hedge(self, p, hedge):
        o, r, c = hedge
        before = {q.id: self.dist(q.g.side, q.g.pos) for q in self.racers() if q is not p}
        self.hedges.append([o, r, c, self.seats.index(p.id)])
        self.cut |= set(self.hedge_cuts(o, r, c))
        p.g.hedges -= 1
        gain = max((self.dist(q.g.side, q.g.pos) - d for q in self.racers() if q.id in before
                    for d in [before[q.id]]), default=0)
        self.last = {"by": p.id, "kind": "hedge", "hedge": [o, r, c], "gain": gain}
        extra = f" (+{gain} steps for a rival)" if gain >= 2 else ""
        self.room.add_log(f"{p.name} plants a hedge{extra} · {p.g.hedges} left", "question")
        if gain >= 6:
            self.award(p, "detour")
        self.next_turn()

    def next_turn(self):
        self.ply += 1
        if self.ply >= PLY_CAP:
            ranked = sorted(self.racers(), key=lambda q: self.dist(q.g.side, q.g.pos))
            return self.room.finish(ranked[0], f"⌛ The garden gate closes — {ranked[0].name} was closest to home and wins!")
        self.room.advance()

    def label(self, cell):
        r, c = cell
        return f"{'abcdefghi'[c]}{self.n - r}"

    def on_timeout(self):
        """Out of time: the pawn takes a step along its shortest route."""
        p = self.room.players[self.room.turn]
        self.room.add_log(f"⏰ {p.name} ran out of time — their pawn takes a step.", "power")
        self.do_move(p, self.best_step(p))

    # -- what each player sees

    def meta(self, p):
        return f"🌿{p.g.hedges}" + (" 🐇" if p.g.hop else "") if hasattr(p.g, "hedges") else ""

    def view(self, p):
        seats = []
        for i, pid in enumerate(self.seats):
            q = self.room.players.get(pid)
            if not q or not hasattr(q.g, "pos"):
                continue
            seats.append({"id": pid, "seat": i, "side": q.g.side, "pos": list(q.g.pos), "hedges": q.g.hedges, "hop": q.g.hop,
                          "dist": self.dist(q.g.side, q.g.pos), "out": bool(q.eliminated)})
        out = {"n": self.n, "seats": seats, "hedges": self.hedges, "last": self.last, "ply": self.ply}
        mine = self.room.players.get(p.id) if p.id in self.seats else None
        if mine and self.room.phase == "playing":
            out["route"] = [list(x) for x in self.path(mine.g.side, mine.g.pos)]
            if self.room.turn == p.id:
                out["moves"] = [[r, c, k] for (r, c), k in self.moves(mine).items()]
                out["legal"] = [f"{o},{r},{c}" for o, r, c in self.legal_hedges()] if mine.g.hedges > 0 else []
        return {"hedgerow": out}

    def final_scores(self):
        return {q.id: -(self.dist(q.g.side, q.g.pos) or 0) for q in self.players()}

    # -- bot

    def best_step(self, p):
        moves = self.moves(p)
        return min(moves, key=lambda m: (self.dist(p.g.side, m) if self.dist(p.g.side, m) is not None else 99,
                                         moves[m] == "hop", random.random()))

    def evaluate(self, p, cut=None):
        """From p's side: how far ahead of the leading rival p is (positive is good)."""
        mine = self.dist(p.g.side, p.g.pos, cut)
        if mine == 0:
            return 1000
        rivals = [q for q in self.racers() if q is not p]
        best_rival = min((self.dist(q.g.side, q.g.pos, cut) for q in rivals), default=99)
        if best_rival == 0:
            return -1000
        return best_rival - mine

    def candidate_hedges(self, p):
        """Hedges that touch a rival's current shortest route (the ones worth thinking about)."""
        want = set()
        for q in self.racers():
            if q is p:
                continue
            route = [q.g.pos] + self.path(q.g.side, q.g.pos)
            for a, b in zip(route, route[1:]):
                (r1, c1), (r2, c2) = a, b
                if r1 != r2:  # crossing a row groove: horizontal hedges
                    r = min(r1, r2)
                    want |= {("h", r, c1), ("h", r, c1 - 1)}
                else:
                    c = min(c1, c2)
                    want |= {("v", r1, c), ("v", r1 - 1, c)}
        return [h for h in want if self.hedge_ok(*h)]

    def score(self, p, cut=None):
        """evaluate() plus what p still holds: a 🐇 hop and hedges in hand are worth something later."""
        return self.evaluate(p, cut) + (0.8 if p.g.hop else 0) + 0.35 * p.g.hedges

    def options(self, p):
        """(score, kind, arg) for every move p could make now, scored one turn ahead, best first."""
        out = []
        for cell in self.moves(p):
            undo = self.apply_quiet(p, "move", cell)
            out.append((self.score(p) + 0.01 * random.random(), "move", cell))
            self.undo_quiet(p, undo)
        if p.g.hedges > 0:
            for h in self.candidate_hedges(p):
                undo = self.apply_quiet(p, "hedge", h)
                out.append((self.score(p) + 0.01 * random.random(), "hedge", h))
                self.undo_quiet(p, undo)
        return sorted(out, key=lambda x: -x[0])

    def play(self, p, kind, arg):
        return self.do_move(p, arg) if kind == "move" else self.do_hedge(p, arg)

    def bot_turn(self, p):
        level = p.bot or "normal"
        if level == "easy":
            if p.g.hedges > 0 and random.random() < 0.18:
                hs = self.candidate_hedges(p)
                if hs:
                    return self.do_hedge(p, random.choice(hs))
            if random.random() < 0.15:
                return self.do_move(p, random.choice(list(self.moves(p))))
            return self.do_move(p, self.best_step(p))
        opts = self.options(p)
        if level == "normal" or len(self.racers()) != 2:
            # Normal hedges only when it clearly pays; hard (multi-player) picks the best outright.
            if level == "normal" and len(opts) > 1 and random.random() < 0.2:
                return self.play(p, *opts[min(1, len(opts) - 1)][1:])
            return self.play(p, *opts[0][1:])
        return self.play(p, *self.search(p, opts))

    def search(self, p, opts):
        """Hard, two players: look one reply deep. For each of my best options, assume the rival
        answers with their best reply, and keep the option that leaves me best placed."""
        rival = next(q for q in self.racers() if q is not p)
        deadline = time.time() + 2.5
        best, best_score = opts[0][1:], -1e9
        for s, kind, arg in opts[:14]:
            if time.time() > deadline:
                break
            undo = self.apply_quiet(p, kind, arg)
            if self.dist(p.g.side, p.g.pos) == 0:
                self.undo_quiet(p, undo)
                return kind, arg
            replies = self.options(rival)[:10]
            worst = 1e9
            for _, rk, ra in replies:
                u2 = self.apply_quiet(rival, rk, ra)
                worst = min(worst, self.score(p) - 0.35 * rival.g.hedges)
                self.undo_quiet(rival, u2)
            self.undo_quiet(p, undo)
            if worst > best_score:
                best, best_score = (kind, arg), worst
        return best

    def apply_quiet(self, p, kind, arg):
        if kind == "move":
            undo = ("move", p.g.pos, p.g.hop)
            if self.moves(p)[arg] == "hop":
                p.g.hop = False
            p.g.pos = arg
            return undo
        added = set(self.hedge_cuts(*arg)) - self.cut
        self.cut |= added
        p.g.hedges -= 1
        return ("hedge", added)

    def undo_quiet(self, p, undo):
        if undo[0] == "move":
            p.g.pos, p.g.hop = undo[1], undo[2]
        else:
            self.cut -= undo[1]
            p.g.hedges += 1
