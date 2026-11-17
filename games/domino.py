"""Domino Run: an original domino-toppling building game for 2–6 players, taking turns.

Everyone builds on one shared table. Each player has a starter domino on the table's edge, pointing in. On your turn
you stand up 3 dominoes, each on a grid cell at one of four angles (straight across, or turned 45°). When everyone
has built a few turns, the starters are pushed and every chain topples at once.

A falling domino knocks over the domino in the next cell it falls toward if that domino is no more than 45° off
square to it (it then falls along its own line, so a 45° domino turns the run). Side-on, it just bumps it.
Your run scores what it reaches first: 🔔 bells 10 and ⛩ gates 20 (a gate only when the run falls through along it;
both let the run carry on past), 🏯 the cup tower 50 (the run ends there), and 1 point a domino it topples. Runs can merge: whoever's push gets
to a domino first owns everything after it, so you can hijack a rival's run.

Once a game you may stand a ✂ split domino (it knocks both cells 45° either side of its fall, forking the run) and
a 🚫 block (nothing gets past it).
"""
import math
import random
import time

from .base import Game, GameError

DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]    # 0 = east, counter-clockwise
STEP = 0.16           # seconds for one domino to knock the next
PER_TURN = 3
TARGETS = {"bell": 10, "gate": 20, "tower": 50}
TOPPLE_PAD = 3.5
BETWEEN = 6.0


def axis_dirs(axis):
    """The two directions a domino on this axis (0–3) can fall."""
    return axis, axis + 4


def fall_dir(axis, push):
    """The way a domino on `axis` falls when pushed toward `push`, or None if the push is side-on."""
    best = None
    for d in axis_dirs(axis):
        diff = min((d - push) % 8, (push - d) % 8)
        if diff <= 1:
            best = d if best is None or diff < min((best - push) % 8, (push - best) % 8) else best
    return best


def topple(size, pieces, targets, starters):
    """Run every chain. pieces {(x, y): {"axis", "kind"}}, targets {(x, y): {"kind", "axis"}},
    starters [(x, y, dir, seat)]. Returns falls {(x, y): (t, dir, owners)}, rings {(x, y): (t, owners)} and
    ends [(x, y, dir, owners)]: empty squares a falling domino pushes into (where a run could carry on)."""
    falls, rings, ends = {}, {}, []
    frontier = {}
    for x, y, d, s in starters:
        frontier.setdefault((x, y), [d, set()])[1].add(s)
    t = 0.0
    while frontier:
        nxt = {}
        for (x, y), (d, owners) in frontier.items():
            if (x, y) in falls:
                continue
            falls[(x, y)] = (round(t, 3), d, frozenset(owners))
            piece = pieces.get((x, y))
            pushes = [(d + 7) % 8, (d + 1) % 8] if piece and piece["kind"] == "split" else [d]
            for p in pushes:
                cx, cy = x, y
                # a gate passes the push on through it (along its line), after ringing
                for _ in range(size):
                    dx, dy = DIRS[p]
                    cx, cy = cx + dx, cy + dy
                    if not (0 <= cx < size and 0 <= cy < size):
                        break
                    tg = targets.get((cx, cy))
                    if tg:
                        if tg["kind"] == "gate" and p % 4 != tg["axis"]:
                            break                      # hits the gate's side: stops
                        prev = rings.get((cx, cy))
                        if prev is None or prev[0] > t + STEP:
                            rings[(cx, cy)] = (round(t + STEP, 3), set(owners))
                        elif abs(prev[0] - (t + STEP)) < 1e-6:
                            prev[1].update(owners)
                        if tg["kind"] == "tower":
                            break
                        continue                       # a bell rings and a gate swings: the push carries on past
                    q = pieces.get((cx, cy))
                    if q is None:
                        ends.append((cx, cy, p, frozenset(owners)))
                        break
                    if q["kind"] == "block" or (cx, cy) in falls:
                        break
                    nd = fall_dir(q["axis"], p)
                    if nd is None:
                        break
                    slot = nxt.get((cx, cy))
                    if slot is None:
                        nxt[(cx, cy)] = [nd, set(owners)]
                    else:
                        slot[1].update(owners)
                    break
        frontier = nxt
        t += STEP
    rings = {k: (v[0], frozenset(v[1])) for k, v in rings.items()}
    return falls, rings, ends


def score_of(falls, rings, targets, starters_cells):
    pts = {}
    for c, (_, _, owners) in falls.items():
        if c in starters_cells:
            continue
        for s in owners:
            pts[s] = pts.get(s, 0) + 1
    for c, (_, owners) in rings.items():
        for s in owners:
            pts[s] = pts.get(s, 0) + TARGETS[targets[c]["kind"]]
    return pts


class Domino(Game):
    id = "domino"
    category = "party"
    family = None
    howto = [
        "Everyone builds on one table. Your starter domino sits on the edge (the arrow in your colour). On your turn stand up 3 dominoes: tap a pulsing ring (where your run reaches next), tap again (or ⟳) to turn it 45°, then ✔ Place.",
        "A falling domino knocks the one in the next square it falls toward, if that one isn't side-on (45° turns the run). The preview lights up what your run reaches now.",
        "After the last build turn every starter is pushed at once. Your run scores 🔔 bells 10 and ⛩ gates 20 (falling through along the gate), and carries on past them; 🏯 the tower 50 ends it. Plus 1 a domino.",
        "Runs can merge: whoever's push reaches a domino first owns everything after it, so hijack a rival's run, or cut it off.",
        "Once a game: a ✂ split domino (forks the run both ways) and a 🚫 block (nothing gets past). Most points after the last table wins.",
    ]
    name = "Domino Run"
    icon = "🁫"
    blurb = "Build domino runs on one shared table toward bells, gates and the tower, then topple them all at once. Hijacking welcome."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "tower": ("🏯", "Tower toppler", "Bring down the cup tower with your run"),
              "hijack": ("🏴‍☠️", "Hijacker", "Score with a run that took over someone else's dominoes"),
              "long": ("📏", "Long run", "Topple 30 dominoes in one run")}
    settings_schema = {
        "tables": ("Tables", [(2, "2"), (1, "1"), (3, "3")], 2),
        "turns": ("Build turns", [(4, "4 each"), (3, "3 each"), (5, "5 each")], 4),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.size = 12 if n <= 3 else 14
        self.points = [0] * n
        self.tower_hits = [0] * n
        self.split = [True] * n
        self.block = [True] * n
        self.table_no = 0
        self.history = []
        self.room.add_log(f"🁫 Domino Run: {self.total} table{'s' if self.total > 1 else ''}, {self.turns} build turns each.", "big")
        self.new_table()

    @property
    def total(self):
        v = self.s.get("tables", 2)
        return v if v in (1, 2, 3) else 2

    @property
    def turns(self):
        v = self.s.get("turns", 4)
        return v if v in (3, 4, 5) else 4

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def present(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    def new_table(self):
        self.mark_round()
        self.table_no += 1
        rng, n, N = self.rng, len(self.seats), self.size
        self.pieces = {}            # (x, y) -> {"axis", "kind", "by"}
        self.targets = {}
        self.stage = "build"
        self.topple_res = None
        # starters spread round the edge, pointing in
        self.starters = []
        spots = []
        per_side = math.ceil(n / 4) + 1
        for side in range(4):
            for k in range(1, per_side):
                u = round(k * (N - 1) / per_side)
                spots.append([(u, 0, 2), (N - 1, u, 4), (u, N - 1, 6), (0, u, 0)][side])
        order = sorted(spots, key=lambda s: (spots.index(s) % (per_side - 1), spots.index(s)))
        off = rng.randrange(4)
        picks = [order[(k * len(order) // n + off) % len(order)] for k in range(n)]
        for i, (x, y, d) in enumerate(picks):
            self.starters.append((x, y, d, i))
        taken = {(x, y) for x, y, _, _ in self.starters}

        def free(c, gap=2):
            return all(max(abs(c[0] - a), abs(c[1] - b)) >= gap for a, b in taken)

        mid = (N - 1) / 2
        tc = (round(mid + rng.choice((-0.5, 0.5))), round(mid + rng.choice((-0.5, 0.5))))
        self.targets[tc] = {"kind": "tower", "axis": 0}
        taken.add(tc)
        for kind, cnt in (("gate", 2 + (n > 3)), ("bell", 3 + n)):
            for _ in range(cnt):
                for _ in range(200):
                    c = (rng.randrange(2, N - 2), rng.randrange(2, N - 2))
                    if free(c, 3 if kind == "gate" else 2):
                        self.targets[c] = {"kind": kind, "axis": rng.randrange(4)}
                        taken.add(c)
                        break
        self.order = [i for i in range(n) if self.present(i)]
        rot = (self.table_no - 1) % max(1, len(self.order))
        self.order = self.order[rot:] + self.order[:rot]
        self.turn_k = 0             # index into the build turns (order × turns)
        self.placed = 0
        self.room.add_log(f"🪵 Table {self.table_no} of {self.total}: {len(self.targets)} targets, {self.turns} build turns each.", "info")
        self.begin()

    def begin(self):
        k = self.turn_k
        while k < len(self.order) * self.turns and not self.present(self.order[k % len(self.order)]):
            k += 1
        self.turn_k = k
        if k >= len(self.order) * self.turns:
            return self.push()
        self.placed = 0
        self.room.begin_turn(self.seats[self.order[k % len(self.order)]])

    @property
    def build_round(self):
        return self.turn_k // max(1, len(self.order)) + 1

    # -- actions

    def cell_free(self, c):
        return (0 <= c[0] < self.size and 0 <= c[1] < self.size and c not in self.pieces and c not in self.targets
                and all((x, y) != c for x, y, _, _ in self.starters))

    def act(self, p, a):
        if self.stage != "build":
            raise GameError("Watch them fall!")
        self.require_turn(p)
        if a.get("type") != "place":
            raise GameError("Unknown action.")
        x, y, axis, kind = a.get("x"), a.get("y"), a.get("axis", 0), a.get("kind", "domino")
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in (x, y, axis)):
            raise GameError("Bad square.")
        if kind not in ("domino", "split", "block") or not 0 <= axis < 4:
            raise GameError("Bad piece.")
        if not self.cell_free((x, y)):
            raise GameError("That square is taken.")
        i = self.seat(p)
        if kind == "split" and not self.split[i]:
            raise GameError("You've used your split domino.")
        if kind == "block" and not self.block[i]:
            raise GameError("You've used your block.")
        self.place(i, x, y, axis, kind)

    def place(self, i, x, y, axis, kind):
        self.pieces[(x, y)] = {"axis": axis, "kind": kind, "by": i}
        if kind == "split":
            self.split[i] = False
            self.room.add_log(f"✂ {self.name_of(i)} stands a split domino.", "power")
        elif kind == "block":
            self.block[i] = False
            self.room.add_log(f"🚫 {self.name_of(i)} puts down a block.", "power")
        self.placed += 1
        if self.placed >= PER_TURN:
            pv = self.preview().get(i, 0)
            self.room.add_log(f"🁫 {self.name_of(i)} builds (their run reaches {pv} now).", "info")
            self.turn_k += 1
            self.begin()

    # -- the topple

    def run(self, pieces=None):
        return topple(self.size, self.pieces if pieces is None else pieces, self.targets, self.starters)[:2]

    def preview(self, pieces=None):
        falls, rings = self.run(pieces)
        return score_of(falls, rings, self.targets, {(x, y) for x, y, _, _ in self.starters})

    def push(self):
        r = self.room
        self.stage = "topple"
        r.turn = None
        falls, rings = self.run()
        pts = score_of(falls, rings, self.targets, {(x, y) for x, y, _, _ in self.starters})
        end = max([t for t, _, _ in falls.values()] + [t for t, _ in rings.values()] + [0.0])
        self.topple_res = {
            "falls": [[x, y, t, d, sorted(o)] for (x, y), (t, d, o) in sorted(falls.items(), key=lambda kv: kv[1][0])],
            "rings": [[x, y, t, sorted(o)] for (x, y), (t, o) in sorted(rings.items(), key=lambda kv: kv[1][0])],
            "pts": {str(k): v for k, v in pts.items()}, "end": round(end, 3),
        }
        n = len(self.seats)
        at = time.time() + end
        for i in range(n):
            self.points[i] += pts.get(i, 0)
        # moments: the tower, a hijack, a long run
        for (x, y), (t, o) in rings.items():
            if self.targets[(x, y)]["kind"] == "tower":
                for s in o:
                    self.tower_hits[s] += 1
                    if self.pl(s):
                        self.award(self.pl(s), "tower", at=time.time() + t)
                self.moment(f"🏯 {' & '.join(self.name_of(s) for s in sorted(o))} bring{'s' if len(o) == 1 else ''} down the TOWER!", "gold", "fanfare", at=time.time() + t)
        counts = {}
        for (x, y), (t, d, o) in falls.items():
            for s in o:
                counts[s] = counts.get(s, 0) + 1
            piece = self.pieces.get((x, y))
            if piece and len(o) == 1 and piece["by"] not in o and pts.get(next(iter(o)), 0) > 0:
                s = next(iter(o))
                if self.pl(s) and not getattr(self, "_hj", {}).get((self.table_no, s)):
                    self.__dict__.setdefault("_hj", {})[(self.table_no, s)] = True
                    self.award(self.pl(s), "hijack", at=at)
        for s, c in counts.items():
            if c >= 30 and self.pl(s):
                self.award(self.pl(s), "long", at=at)
        here = [i for i in range(n) if self.present(i)]
        r.add_log(f"💥 Table {self.table_no} topples! " + ", ".join(f"{self.name_of(i)} +{pts.get(i, 0)}" for i in sorted(here, key=lambda k: -pts.get(k, 0))) + ".", "big")
        self.history.append([pts.get(i, 0) for i in range(n)])
        r.deadline = time.time() + end + TOPPLE_PAD
        self.ready_at = time.time() + end + TOPPLE_PAD

    def after_topple(self):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.present(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        if self.stage == "topple":
            self.stage = "between"
            r.deadline = time.time() + BETWEEN
            return
        if self.table_no >= self.total or len(here) <= 1:
            best = max(self.points[i] for i in here)
            tied = [i for i in here if self.points[i] == best]
            if len(tied) > 1:
                tb = max(self.tower_hits[i] for i in tied)
                tied = [i for i in tied if self.tower_hits[i] == tb]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {best} points between {' & '.join(self.name_of(i) for i in tied)}.")
            return r.finish(self.pl(tied[0]), f"🏆 {self.name_of(tied[0])} wins Domino Run with {best} points!")
        self.new_table()

    def on_timeout(self):
        r = self.room
        if self.stage in ("topple", "between"):
            return self.after_topple()
        if r.turn not in self.seats:
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.name_of(i)} ran out of time: the rest of their dominoes go up by themselves.", "power")
        while self.stage == "build" and r.turn == self.seats[i]:
            x, y, axis, kind = self.plan(i, "easy")
            if (x, y) == (-1, -1):
                self.turn_k += 1
                self.begin()
                break
            self.place(i, x, y, axis, kind)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the table.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if self.stage == "build" and r.turn == p.id:
            self.turn_k += 1
            self.begin()

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "points"):
            return ""
        return f"{self.points[i]} pts"

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        falls, rings = self.run() if self.stage == "build" else ({}, {})
        reach = {}
        if self.stage == "build":
            for (x, y), (t, d, o) in falls.items():
                for s in o:
                    reach.setdefault(str(s), {"cells": [], "targets": []})["cells"].append([x, y])
            for (x, y), (t, o) in rings.items():
                for s in o:
                    reach.setdefault(str(s), {"cells": [], "targets": []})["targets"].append([x, y])
        cur = self.order[self.turn_k % len(self.order)] if self.stage == "build" and self.order else None
        return {"domino": {
            "seats": self.seats, "me": i, "size": self.size, "table": self.table_no, "tables": self.total,
            "stage": self.stage, "round": min(self.build_round, self.turns), "turns": self.turns, "perTurn": PER_TURN,
            "placed": self.placed, "cur": cur,
            "pieces": [[x, y, v["axis"], v["kind"], v["by"]] for (x, y), v in self.pieces.items()],
            "targets": [[x, y, v["kind"], v["axis"]] for (x, y), v in self.targets.items()],
            "starters": [list(s) for s in self.starters],
            "points": self.points, "split": self.split, "block": self.block, "history": self.history,
            "preview": self.preview() if self.stage == "build" else None, "reach": reach,
            "topple": self.topple_res, "values": TARGETS, "step": STEP,
            "readyIn": max(0.0, round(getattr(self, "ready_at", 0) - time.time(), 2)),
            "standings": self.standings() if self.stage == "between" and len(self.seats) > 1 else None,
        }}

    # -- bots: try every square next to where their run (or a rival's) pushes, at every angle, and keep the best

    def ends(self, pieces=None):
        return topple(self.size, self.pieces if pieces is None else pieces, self.targets, self.starters)[2]

    def candidates(self, i, level):
        """Empty squares my run pushes into (and, for a blocker, the ones rivals' runs push into)."""
        mine, theirs = set(), set()
        for x, y, d, o in self.ends():
            if self.cell_free((x, y)):
                (mine if i in o else theirs).add((x, y))
        return mine, theirs

    def dist_value(self, i, pieces):
        """How close my run's live ends are to targets nobody has reached (a pull toward them)."""
        falls, rings, fr = topple(self.size, pieces, self.targets, self.starters)
        ends = [(x, y, d) for x, y, d, o in fr if i in o]
        free_t = [c for c in self.targets if c not in rings]
        if not ends or not free_t:
            return 0.0
        best = 0.0
        for (tx, ty) in free_t:
            v = TARGETS[self.targets[(tx, ty)]["kind"]]
            for x, y, d in ends:
                dist = max(abs(tx - x), abs(ty - y))
                best = max(best, v / (1 + dist) ** 1.3)
        return best

    def options(self, i, level, pieces):
        """[(value, (x, y, axis, kind), pieces after)] for every placement worth a look, on the table `pieces`."""
        rng = random
        n = len(self.seats)
        ends = topple(self.size, pieces, self.targets, self.starters)[2]
        free = lambda c: self.cell_free(c) and c not in pieces
        mine = {(x, y) for x, y, d, o in ends if i in o and free((x, y))}
        theirs = {(x, y) for x, y, d, o in ends if i not in o and free((x, y))}
        base = self.preview(pieces)
        others = lambda pv: max([pv.get(s, 0) for s in range(n) if s != i] + [0])
        kinds = ["domino"] + (["split"] if self.split[i] and level != "easy" else []) + (["block"] if self.block[i] and level == "hard" else [])
        # with nowhere left to build (or, for a hard bot, always) look at rivals' paths: a side-on domino stops a run
        rival_cells = theirs if level != "easy" and (not mine or level == "hard") else set()
        out = []
        for c in list(mine) + list(rival_cells - mine):
            for kind in kinds:
                if kind == "block" and c not in rival_cells:
                    continue
                for axis in range(4) if kind != "block" else (0,):
                    trial = dict(pieces)
                    trial[c] = {"axis": axis, "kind": kind, "by": i}
                    pv = self.preview(trial)
                    gain = pv.get(i, 0) - base.get(i, 0)
                    rivals = others(pv) - others(base)
                    v = gain * 3 + (self.dist_value(i, trial) if level != "easy" else 0) * 2
                    v -= rivals * {"hard": 0.8, "normal": 0.4}.get(level, 0)
                    if kind == "split":
                        v -= 4      # save it for a fork worth having
                    if kind == "block":
                        v -= 3
                    v += rng.uniform(0, {"easy": 6, "normal": 4, "hard": 0.3}.get(level, 4))
                    out.append((v, (c[0], c[1], axis, kind), trial))
        return out

    def plan(self, i, level):
        """(x, y, axis, kind) for one domino, or (-1, -1, 0, '') if there's nowhere to put one."""
        opts = self.options(i, level, self.pieces)
        if not opts:
            free = [(x, y) for x in range(self.size) for y in range(self.size) if self.cell_free((x, y))]
            if not free:
                return -1, -1, 0, ""
            c = random.choice(free)
            return c[0], c[1], random.randrange(4), "domino"
        if level == "hard" and self.placed < PER_TURN - 1:
            # look one domino further: the best pair beats the best single
            opts.sort(key=lambda o: -o[0])
            best, best_v = opts[0][1], -math.inf
            for v, move, trial in opts[:6]:
                nxt = self.options(i, "normal", trial)
                v2 = max((o[0] for o in nxt), default=0.0)
                if v + 0.7 * v2 > best_v:
                    best, best_v = move, v + 0.7 * v2
            return best
        return max(opts, key=lambda o: o[0])[1]

    def bot_ready(self):
        if self.stage != "build":
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_turn(self, p):
        i = self.seat(p)
        x, y, axis, kind = self.plan(i, p.bot)
        if (x, y) == (-1, -1):
            self.turn_k += 1
            return self.begin()
        self.place(i, x, y, axis, kind)
        if self.room.turn == p.id:
            self.room.bot_at = time.time() + 0.7
