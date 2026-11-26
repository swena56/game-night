"""🌀 Marble Rush: everyone tilts their own copy of the same maze board at once and races a marble from the
start pad to the goal cup. Each browser rolls its own marble (the physics run there); the server makes
the course, keeps everyone's position for the ghosts, checks the finish times and runs the bots.

Course cells are 1×1 in board units: x runs along columns (east), z along rows (south). Walls are a
bitmask per cell: 1 north, 2 east, 4 south, 8 west."""
import random
import time

from .base import Game, GameError

N, E, S_, W_ = 1, 2, 4, 8
DIRS = {N: (0, -1), E: (1, 0), S_: (0, 1), W_: (-1, 0)}
OPP = {N: S_, E: W_, S_: N, W_: E}

SIZES = {"small": (7, 7), "medium": (9, 9), "large": (11, 11)}
COUNTDOWN = 3.5
RESULTS_SECS = 9      # between boards: the standings, and time to pick a perk
GEM_BONUS = 1000      # ms off your time for each gem
MAX_SPEED = 7.0       # cells a second: the browser caps the marble's speed here
# #97: cells/s, seconds lost braking into each corner, chance to fall at each hole on the way, takes a gem
# when it's worth it, and how often it dares the 🔥 shortcut
BOT = {
    "easy": {"speed": 1.9, "corner": 0.25, "fall": 0.20, "gems": 0.0, "dare": 0.15},
    "normal": {"speed": 2.5, "corner": 0.15, "fall": 0.08, "gems": 0.5, "dare": 0.5},
    "hard": {"speed": 2.9, "corner": 0.10, "fall": 0.03, "gems": 1.0, "dare": 0.85},
}
# perks, picked between boards for the next one (last place picks two)
PERKS = {
    "turbo": ("⚡", "Turbo", "One big shove: tap ⚡ (or Space) when you want it"),
    "shield": ("🛡️", "Shield", "Your first fall doesn't send you back"),
    "magnet": ("🧲", "Magnet", "Gems fly to you from a cell away"),
}
STEP = 0.25           # seconds of bot play per tick


def gen_course(rng, size="medium", hazards="some"):
    """A maze with a few loops, start at the top-left area and the goal at the far corner, plus holes,
    checkpoint flags, boost pads and gems. Everything is plain lists so it goes straight into the view."""
    w, h = SIZES.get(size, SIZES["medium"])
    walls = [[15] * w for _ in range(h)]
    seen = [[False] * w for _ in range(h)]
    stack = [(0, 0)]
    seen[0][0] = True
    while stack:  # recursive backtracker
        c, r = stack[-1]
        opts = [(d, c + dx, r + dy) for d, (dx, dy) in DIRS.items()
                if 0 <= c + dx < w and 0 <= r + dy < h and not seen[r + dy][c + dx]]
        if not opts:
            stack.pop()
            continue
        d, nc, nr = rng.choice(opts)
        walls[r][c] &= ~d
        walls[nr][nc] &= ~OPP[d]
        seen[nr][nc] = True
        stack.append((nc, nr))
    # knock out a few extra walls so there's more than one way round
    for _ in range(w * h // 9):
        c, r = rng.randrange(w), rng.randrange(h)
        d = rng.choice(list(DIRS))
        dx, dy = DIRS[d]
        if 0 <= c + dx < w and 0 <= r + dy < h and walls[r][c] & d:
            walls[r][c] &= ~d
            walls[r + dy][c + dx] &= ~OPP[d]
    start, goal = [0, 0], [w - 1, h - 1]
    dist = bfs(walls, goal)
    # the shortest path, start → goal, by walking downhill on the distance map
    path, (c, r) = [list(start)], start
    while [c, r] != goal:
        c, r = min(((c + dx, r + dy) for d, (dx, dy) in DIRS.items() if not walls[r][c] & d),
                   key=lambda q: dist[q[1]][q[0]])
        path.append([c, r])
    on_path = {tuple(p) for p in path}
    n = len(path)
    fork = find_fork(walls, path)
    if not fork and carve_fork(walls, path, rng):  # no loop round any stretch: knock one through
        dist = bfs(walls, goal)
        fork = find_fork(walls, path)
    # flags at a third and two thirds of the way, nudged off the fork so both ways pass them
    flags = []
    if n >= 9:
        busy = {tuple(q) for q in fork["short"]} if fork else set()
        for t in (n // 3, 2 * n // 3):
            k = min((i for i in range(1, n - 1) if tuple(path[i]) not in busy and path[i] not in flags), key=lambda i: abs(i - t), default=None)
            if k is not None:
                flags.append(path[k])
        flags.sort(key=lambda f: path.index(f))
    # holes: at the outer corner of a turn on the path (punishing a marble that comes in too fast), and
    # in the middle of dead ends off the path
    holes = []
    corner_rate = {"off": 0, "some": 0.35, "lots": 0.65}.get(hazards, 0.35)
    for i in range(2, n - 2):
        a, b, cc = path[i - 1], path[i], path[i + 1]
        din, dout = (b[0] - a[0], b[1] - a[1]), (cc[0] - b[0], cc[1] - b[1])
        if din != dout and b not in flags and rng.random() < corner_rate:
            # the corner the marble runs into: ahead along the way in, away from the way out
            ox, oz = din[0] * 0.21 - dout[0] * 0.21, din[1] * 0.21 - dout[1] * 0.21
            holes.append({"x": round(b[0] + 0.5 + ox, 3), "z": round(b[1] + 0.5 + oz, 3), "r": 0.17})
    # the 🔥 shortcut: a slalom of holes either side of its straights (hazards on), so the quick way is the risky one
    if fork and hazards != "off":
        side = 1
        for q in fork["short"][1:-1]:
            i = path.index(q)
            a, b = path[i - 1], path[i + 1]
            if b[0] - q[0] != q[0] - a[0] or b[1] - q[1] != q[1] - a[1]:
                continue  # a corner: the corner holes above already guard it
            dx, dz = b[0] - q[0], b[1] - q[1]
            holes.append({"x": round(q[0] + 0.5 - dz * 0.25 * side, 3), "z": round(q[1] + 0.5 + dx * 0.25 * side, 3), "r": 0.16})
            side = -side
    dead_ends = [(c, r) for r in range(h) for c in range(w)
                 if (c, r) not in on_path and bin(walls[r][c]).count("1") == 3]
    rng.shuffle(dead_ends)
    to_path = bfs_multi(walls, on_path)
    gems = []
    for c, r in sorted(dead_ends, key=lambda q: -to_path[q[1]][q[0]])[:3]:
        gems.append({"x": c + 0.5, "z": r + 0.5, "d": to_path[r][c]})
    gem_cells = {(int(g["x"]), int(g["z"])) for g in gems}
    if hazards == "lots":
        for c, r in dead_ends:
            if (c, r) not in gem_cells and len([x for x in holes if x["r"] > 0.2]) < 3:
                holes.append({"x": c + 0.5, "z": r + 0.5, "r": 0.3})
    # boost pads: on a straight stretch of the path, pushing toward the goal
    boosts = []
    straight = [i for i in range(2, n - 2)
                if path[i][0] - path[i - 1][0] == path[i + 1][0] - path[i][0]
                and path[i][1] - path[i - 1][1] == path[i + 1][1] - path[i][1]
                and path[i] not in flags and not any(int(x["x"]) == path[i][0] and int(x["z"]) == path[i][1] for x in holes)]
    if fork:  # no plain pads on the shortcut: its reward is being short
        straight = [i for i in straight if path[i] not in fork["short"]]
    rng.shuffle(straight)
    for i in sorted(straight[:{"off": 1, "some": 2, "lots": 4}.get(hazards, 2)]):
        boosts.append({"x": path[i][0] + 0.5, "z": path[i][1] + 0.5,
                       "dx": path[i + 1][0] - path[i][0], "dz": path[i + 1][1] - path[i][1]})
    # the 🌿 safe way round gets a pad pushing along it and a gem of its own
    if fork:
        lg = fork["long"]
        k = len(lg) // 2
        a, b = lg[k - 1], lg[k]
        boosts.append({"x": a[0] + 0.5, "z": a[1] + 0.5, "dx": b[0] - a[0], "dz": b[1] - a[1]})
        q = lg[min(len(lg) - 2, k + 1)]
        if not any(int(g["x"]) == q[0] and int(g["z"]) == q[1] for g in gems):
            gems.append({"x": q[0] + 0.5, "z": q[1] + 0.5, "d": 0, "fork": True})
    return {"w": w, "h": h, "walls": [x for row in walls for x in row], "start": start, "goal": goal,
            "path": path, "dist": [x for row in dist for x in row], "flags": flags, "holes": holes,
            "gems": gems, "boosts": boosts, "fork": fork}


def carve_fork(walls, path, rng):
    """Knock one wall between a side pocket hanging off route cell a and a later (or earlier) route cell b,
    so the pocket becomes a longer way round the stretch a…b. Only where that way is 2–10 cells longer (4+ preferred), so
    the quick route stays the quick route."""
    flags = []
    h, w = len(walls), len(walls[0])
    idx = {tuple(q): i for i, q in enumerate(path)}
    root, depth, q = {}, {}, []
    for c, r in idx:
        root[(c, r)], depth[(c, r)] = idx[(c, r)], 0
        q.append((c, r))
    for c, r in q:  # every off-route cell: which route cell its pocket hangs off, and how deep it is
        for d, (dx, dy) in DIRS.items():
            nc, nr = c + dx, r + dy
            if not walls[r][c] & d and (nc, nr) not in root:
                root[(nc, nr)], depth[(nc, nr)] = root[(c, r)], depth[(c, r)] + 1
                q.append((nc, nr))
    flagset = {tuple(f) for f in flags}
    opts = []
    for (c, r), a in root.items():
        if (c, r) in idx:
            continue
        for d, (dx, dy) in DIRS.items():
            nc, nr = c + dx, r + dy
            if not (0 <= nc < w and 0 <= nr < h) or not walls[r][c] & d or (nc, nr) not in idx:
                continue
            b = idx[(nc, nr)]
            lo, hi = min(a, b), max(a, b)
            if hi - lo < 3 or lo < 1 or hi > len(path) - 2 or any(tuple(x) in flagset for x in path[lo:hi + 1]):
                continue
            extra = depth[(c, r)] + 1 - (hi - lo)
            if 2 <= extra <= 10:
                opts.append((extra >= 4, hi - lo, c, r, d))
    if not opts:
        return False
    best = max(o[:2] for o in opts)
    _, _, c, r, d = rng.choice(sorted(o for o in opts if o[:2] == best))
    dx, dy = DIRS[d]
    walls[r][c] &= ~d
    walls[r + dy][c + dx] &= ~OPP[d]
    return True


def find_fork(walls, path, flags=()):
    """#97: a stretch of the quick route with a second, longer way round it (the maze's extra loops make
    them). Returns {"short": cells, "long": cells}, both from the same branch cell to the same rejoin cell,
    or None. The longest stretch whose way round costs 4–10 more cells wins (2 if that's all there is)."""
    h, w = len(walls), len(walls[0])
    idx = {tuple(q): i for i, q in enumerate(path)}
    flagset = {tuple(f) for f in flags}
    best = None
    for i in range(1, len(path) - 3):
        for j in range(i + 3, min(len(path) - 1, i + 9)):
            inner = {tuple(q) for q in path[i + 1:j]}
            if inner & flagset or tuple(path[i]) in flagset or tuple(path[j]) in flagset:
                continue
            # BFS from path[i] to path[j] without the stretch between them, nor other route cells
            src, dst = tuple(path[i]), tuple(path[j])
            prev, q = {src: None}, [src]
            for c, r in q:
                if (c, r) == dst:
                    break
                for d, (dx, dy) in DIRS.items():
                    nc, nr = c + dx, r + dy
                    if walls[r][c] & d or not (0 <= nc < w and 0 <= nr < h) or (nc, nr) in prev:
                        continue
                    if (nc, nr) in idx and (nc, nr) != dst:
                        continue
                    prev[(nc, nr)] = (c, r)
                    q.append((nc, nr))
            if dst not in prev:
                continue
            way, cur = [], dst
            while cur is not None:
                way.append(list(cur))
                cur = prev[cur]
            way.reverse()
            extra = (len(way) - 1) - (j - i)
            score = (extra >= 4, j - i)
            if 2 <= extra <= 10 and (best is None or score > best[0]):
                best = (score, {"short": [list(x) for x in path[i:j + 1]], "long": way})
    return best and best[1]


def bfs(walls, goal):
    return bfs_multi(walls, {tuple(goal)})


def bfs_multi(walls, sources):
    h, w = len(walls), len(walls[0])
    dist = [[-1] * w for _ in range(h)]
    q = list(sources)
    for c, r in q:
        dist[r][c] = 0
    for c, r in q:
        for d, (dx, dy) in DIRS.items():
            nc, nr = c + dx, r + dy
            if not walls[r][c] & d and dist[nr][nc] < 0:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nc, nr))
    return dist


def fmt(ms):
    return f"{ms / 1000:.2f} s"


class Marble(Game):
    id = "marble"
    solo_bots = 2
    category = "action"
    howto = [
        'Everyone gets the same maze board. Tilt it to roll your marble from the 🟢 start pad to the 🏁 goal cup.',
        '📱 Drag anywhere on the board (or tap “Use tilt” and tip your phone). ⌨️ Arrow keys or WASD on a computer.',
        '🕳️ Holes catch a marble that comes into a corner too fast: you go back to your last 🚩 flag.',
        '💎 Gems take a second off your time but sit off the quick route. ⏩ Pads give you a shove.',
        '💎 Gems you carry are only safe once you pass a 🚩 flag or finish: fall in a hole first and they roll back to their spots.',
        '🔥 The quick route has a shortcut lined with holes; 🌿 the safe way round is longer but has a pad and a gem. Your call.',
        '🎁 Between boards, pick a perk for the next one: ⚡ Turbo, 🛡️ Shield or 🧲 Magnet. Whoever is last picks two.',
        'Fastest total time over all the boards wins. See your rivals as ghost marbles on your board.',
        '🚩 Checkpoint split times are shown beside the race. A faster finish on the same maze saves a personal best ghost on this device; toggle it on or off during your next run.',
    ]
    name = "Marble Rush"
    icon = "🌀"
    blurb = "Tilt your own copy of the same 3D maze and race a marble to the goal. Fastest total time over the boards wins."
    min_players = 1
    max_players = 6
    replayable = False
    low_wins = True
    badges = {**Game.badges, "clean": ("🎯", "Clean run", "Finish a board without falling in a hole"),
              "sweep": ("💎", "Gem sweep", "Take every gem on a board and still finish")}
    settings_schema = {
        "rounds": ("Boards", [(1, "1 board"), (3, "3 boards"), (5, "5 boards")], 3),
        "size": ("Maze", [("small", "🟢 Small 7×7"), ("medium", "🟡 Medium 9×9"), ("large", "🔴 Large 11×11")], "medium"),
        "hazards": ("Hazards", [("off", "Off (no holes)"), ("some", "🕳️ Some"), ("lots", "🕳️🕳️ Lots")], "some"),
        "limit": ("Time per board", [(60, "⏱️ 60 s"), (90, "⏱️ 90 s"), (120, "⏱️ 2 min")], 90),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seed = rng.getrandbits(30)
        self.seats = [p.id for p in seated]
        self.round = -1
        self.rounds = int(self.s.get("rounds") or 3)
        self.results = []  # one {pid: {ms, gems, falls, dnf}} per finished board
        for p in seated:
            p.g.total = 0
        r = self.room
        r.turn = None
        r.bot_at = 0
        r.add_log(f"🌀 Marble Rush! {self.rounds} board{'s' * (self.rounds > 1)} — tilt your maze and roll to the 🏁 goal.", "big")
        self.begin_round()

    def limit(self):
        return int(self.s.get("limit") or 90)

    def begin_round(self):
        r = self.room
        self.round += 1
        self.stage = "race"
        self.mark_round()
        self.course = gen_course(random.Random(self.seed + self.round), self.s.get("size", "medium"), self.s.get("hazards", "some"))
        self.cells = {tuple(p): i for i, p in enumerate(self.course["path"])}
        self.t0 = time.time() + COUNTDOWN
        r.deadline = self.t0 + self.limit()
        self.first = None
        for i in self.seats:
            p = r.players.get(i)
            if not p:
                continue
            g = p.g
            g.x, g.z = self.course["start"][0] + 0.5, self.course["start"][1] + 0.5
            g.done, g.gems, g.falls, g.cp = None, 0, 0, 0
            g.perks, g.pick = list(getattr(g, "pick", [])), []  # last break's picks are this board's perks
            g.vt, g.next_at, g.plan, g.out_of_time = 0.0, self.t0 + STEP, None, False
        if self.round:
            r.add_log(f"🌀 Board {self.round + 1} of {self.rounds}!", "big")

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
            raise GameError("You're watching this race.")
        if t == "perk":
            return self.pick_perk(p, a)
        if self.stage != "race":
            raise GameError("Between boards — get ready for the next one.")
        if a.get("r") != self.round:
            raise GameError("That was for another board.")
        if time.time() < self.t0 - 0.5:
            raise GameError("Not yet — get ready!")
        g = p.g
        if g.done is not None:
            return None
        if t == "pos":
            x, z, cp = a.get("x"), a.get("z"), a.get("cp")
            c = self.course
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, z)) \
                    or not (0 <= x <= c["w"] and 0 <= z <= c["h"]) or cp not in (0, 1, 2):
                raise GameError("Bad position.")
            g.x, g.z, g.cp = round(float(x), 3), round(float(z), 3), cp
            return self.quiet_ghosts()
        if t == "fall":
            g.falls += 1
            if g.falls == 3:
                self.room.add_log(f"🕳️ {p.name} has fallen in three holes on this board!", "info")
            return None
        if t == "finish":
            ms, gems = a.get("ms"), a.get("gems")
            if not isinstance(ms, int) or isinstance(ms, bool) or not isinstance(gems, int) or isinstance(gems, bool):
                raise GameError("Bad finish.")
            elapsed = (time.time() - self.t0) * 1000
            if ms < self.min_ms() or ms > elapsed + 2500 or not 0 <= gems <= len(self.course["gems"]):
                raise GameError("That finish doesn't add up.")
            return self.finished(p, ms, gems)
        raise GameError("Unknown action.")

    def perk_picks(self, p):
        """How many perks this player may pick for the next board: two for whoever is last on time."""
        live = [i for i in self.racing() if hasattr(self.room.players[i].g, "total")]
        if len(live) > 1 and p.id == max(live, key=lambda i: self.room.players[i].g.total):
            return 2
        return 1

    def pick_perk(self, p, a):
        if self.stage != "results" or a.get("r") != self.round:
            raise GameError("Perks are picked between boards.")
        k = a.get("perk")
        if k not in PERKS:
            raise GameError("Unknown perk.")
        g = p.g
        if k in g.pick:
            g.pick.remove(k)  # tap again to take it back
        else:
            g.pick = (g.pick + [k])[-self.perk_picks(p):]
        return None

    def min_ms(self):
        """No marble can get round faster than its top speed along the shortest path."""
        return int((len(self.course["path"]) - 1) / MAX_SPEED * 1000)

    def finished(self, p, ms, gems):
        r = self.room
        g = p.g
        g.done = max(0, ms - gems * GEM_BONUS)
        g.gems = gems
        g.x, g.z = self.course["goal"][0] + 0.5, self.course["goal"][1] + 0.5
        bonus = f" (💎×{gems}: −{gems} s)" if gems else ""
        if self.first is None:
            self.first = p.id
            if len(self.seats) > 1:
                self.moment(f"🏁 {p.name} reaches the goal first: {fmt(g.done)}!", "cool", "tag")
            else:
                r.add_log(f"🏁 {p.name} finished in {fmt(g.done)}{bonus}.", "big")
        else:
            r.add_log(f"🏁 {p.name} finished in {fmt(g.done)}{bonus}.", "info")
        if not g.falls:
            self.award(p, "clean")
        if gems and gems == len(self.course["gems"]):
            self.award(p, "sweep")
            if gems >= 3:
                self.moment(f"💎 {p.name} swept all {gems} gems!", "gold", "fanfare")
        if all(self.room.players[i].g.done is not None for i in self.racing()):
            self.end_round()

    def racing(self):
        return [o.id for o in self.room.contenders() if o.id in self.seats]

    def end_round(self):
        r = self.room
        cap = self.limit() * 1000
        res = {}
        for i in self.seats:
            p = r.players.get(i)
            if not p or not hasattr(p.g, "done"):
                continue
            dnf = p.g.done is None
            ms = cap if dnf else p.g.done
            p.g.total += ms
            res[i] = {"ms": ms, "gems": p.g.gems, "falls": p.g.falls, "dnf": dnf}
            if dnf and not p.eliminated:
                r.add_log(f"⏰ {p.name} ran out of time on board {self.round + 1} ({fmt(cap)}).", "info")
        self.results.append(res)
        if self.round + 1 >= self.rounds:
            return self.finish_game()
        self.stage = "results"
        r.deadline = time.time() + RESULTS_SECS
        for i in self.seats:  # bots pick their perks straight away
            o = r.players.get(i)
            if o and o.bot and not o.eliminated:
                o.g.pick = self.rng.sample(sorted(PERKS), self.perk_picks(o))
        lead = min(self.racing() or self.seats, key=lambda i: r.players[i].g.total)
        if len(self.seats) > 1:
            r.add_log(f"📊 After board {self.round + 1}: {r.players[lead].name} leads on {fmt(r.players[lead].g.total)}.", "question")

    def finish_game(self):
        r = self.room
        self.stage = "over"
        live = [i for i in self.seats if i in r.players and not r.players[i].eliminated] or [i for i in self.seats if i in r.players]
        if not live:
            return r.finish(None, "Everyone left.")
        if len(self.seats) == 1:
            p = r.players[live[0]]
            return r.finish(None, f"🌀 Done! {p.name}'s total: {fmt(p.g.total)}. Try to beat it!")
        best = min(r.players[i].g.total for i in live)
        tops = [i for i in live if r.players[i].g.total == best]
        if len(tops) == 1:
            w = r.players[tops[0]]
            return r.finish(w, f"🏆 {w.name} wins Marble Rush in {fmt(best)}!")
        return r.finish(None, f"🤝 A dead heat at {fmt(best)}!")

    def on_timeout(self):
        r = self.room
        if r.phase != "playing":
            return
        if self.stage == "race":
            self.end_round()
        elif self.stage == "results":
            self.begin_round()

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the game.")
        if not r.contenders():
            return r.finish(None, "Everyone left.")
        if self.stage == "race" and all(r.players[i].g.done is not None for i in self.racing()):
            self.end_round()

    # -- bots: each rolls along the shortest path on its own clock (vt = its seconds of play)

    def bot_plan(self, o):
        """The bot's whole run, decided at the start: which way at the fork, which gems it fetches, which
        holes catch it. Perks: 🛡️ skips the first fall, ⚡ a little faster, 🧲 gems a cell off the route are free."""
        k = BOT[o.bot or "normal"]
        perks = getattr(o.g, "perks", [])
        path = [list(q) for q in self.course["path"]]
        fork = self.course.get("fork")
        dare = True
        if fork:
            dare = self.rng.random() < k["dare"]
            if not dare:  # the safe way round
                i, j = path.index(fork["short"][0]), path.index(fork["short"][-1])
                path = path[:i] + [list(q) for q in fork["long"]] + path[j + 1:]
        cells = {tuple(q): i for i, q in enumerate(path)}
        fall_rate = k["fall"] * (1.5 if dare and fork else 1)
        holes = [cells.get((int(x["x"]), int(x["z"]))) for x in self.course["holes"]]
        falls = sorted(i for i in holes if i is not None and self.rng.random() < fall_rate)
        if "shield" in perks and falls:
            falls.pop(0)
        detours, ngems = {}, 0
        for gm in self.course["gems"]:
            gc = (int(gm["x"]), int(gm["z"]))
            if gc in cells:  # on its way (the safe branch's gem)
                ngems += 1
                continue
            if gm.get("fork"):
                continue
            free = "magnet" in perks and gm["d"] <= 1
            cost = 0 if free else 2 * gm["d"] / k["speed"]
            if free or (cost < GEM_BONUS / 1000 * 1.4 and self.rng.random() < k["gems"]):
                gi = min(range(len(path)), key=lambda i: abs(path[i][0] + 0.5 - gm["x"]) + abs(path[i][1] + 0.5 - gm["z"]))
                detours[gi] = detours.get(gi, 0) + cost
                ngems += 1
        corners = {i for i in range(1, len(path) - 1)
                   if (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) != (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])}
        speed = k["speed"] * self.rng.uniform(0.9, 1.1) * (1.06 if "turbo" in perks else 1)
        return {"speed": speed, "falls": falls, "gems": ngems, "detours": detours, "corners": corners,
                "corner": k["corner"], "path": path, "cells": cells, "pos": 0.0, "wait": 0.0, "cp": 0}

    def bot_ready(self):
        if self.stage != "race":
            return False
        now = time.time()
        return any(o.bot and o.id in self.seats and o.g.done is None and not o.g.out_of_time
                   and now >= o.g.next_at for o in self.room.contenders())

    def bot_tick(self):
        now = time.time()
        r = self.room
        moved, before = False, r._eid
        for o in r.contenders():
            if o.bot and o.id in self.seats and o.g.done is None and not o.g.out_of_time \
                    and now >= o.g.next_at and self.stage == "race":
                self.bot_step(o, now)
                moved = True
                if self.stage != "race":
                    return
        if moved and r.phase == "playing" and self.stage == "race":
            self.quiet_ghosts()
            if r._eid != before:  # someone finished: the log line needs a full broadcast
                r.no_bump = False

    def bot_step(self, o, now):
        g = o.g
        if g.plan is None:
            g.plan = self.bot_plan(o)
        pl = g.plan
        path = pl["path"]
        g.vt += STEP
        g.next_at = now + STEP
        if g.vt > self.limit():
            g.out_of_time = True  # waits for the board's clock like a person who didn't make it
            return
        budget = STEP  # this tick's seconds: pauses (corners, gems, a fall) and rolling share them
        while budget > 1e-9 and pl["pos"] < len(path) - 1:
            if pl["wait"] > 0:
                use = min(pl["wait"], budget)
                pl["wait"] -= use
                budget -= use
                continue
            old = pl["pos"]
            target = min(len(path) - 1, old + pl["speed"] * budget)
            event = None
            for i in range(int(old) + 1, int(target) + 1):
                if i in pl["detours"] or i in pl["corners"] or (pl["falls"] and pl["falls"][0] == i):
                    event = i
                    break
            if event is None:
                pl["pos"] = target
                budget = 0
                break
            budget -= (event - old) / pl["speed"]
            pl["pos"] = float(event)
            if event in pl["detours"]:  # off to fetch a gem
                pl["wait"] += pl["detours"].pop(event)
            if event in pl["corners"]:  # braking into the turn
                pl["corners"].discard(event)
                pl["wait"] += pl["corner"]
            if pl["falls"] and pl["falls"][0] == event:  # in the hole: back to the last flag
                pl["falls"].pop(0)
                g.falls += 1
                flags = [pl["cells"][tuple(f)] for f in self.course["flags"] if pl["cells"][tuple(f)] < event]
                pl["pos"] = float(flags[-1]) if flags else 0.0
                pl["wait"] = 0.8
        for k, f in enumerate(self.course["flags"]):
            if pl["pos"] >= pl["cells"][tuple(f)]:
                g.cp = max(g.cp, k + 1)
        i = int(pl["pos"])
        j = min(len(path) - 1, i + 1)
        t = pl["pos"] - i
        g.x = round(path[i][0] + 0.5 + (path[j][0] - path[i][0]) * t, 3)
        g.z = round(path[i][1] + 0.5 + (path[j][1] - path[i][1]) * t, 3)
        if pl["pos"] >= len(path) - 1:
            ms = max(self.min_ms(), int(g.vt * 1000))
            self.finished(o, ms, pl["gems"])

    # -- ghosts on the fast channel

    def progress(self, g):
        c = self.course
        if g.done is not None:
            return 1.0
        cx, cz = min(c["w"] - 1, max(0, int(g.x))), min(c["h"] - 1, max(0, int(g.z)))
        d0 = c["dist"][c["start"][1] * c["w"] + c["start"][0]] or 1
        return round(max(0.0, 1 - c["dist"][cz * c["w"] + cx] / d0), 3)

    def ghosts(self):
        out = {}
        for i in self.seats:
            o = self.room.players.get(i)
            if o and hasattr(o.g, "x"):
                out[i] = {"x": o.g.x, "z": o.g.z, "p": self.progress(o.g), "done": o.g.done, "out": o.eliminated}
        return out

    def quiet_ghosts(self):
        """Positions change several times a second: send them on the fast channel, no full re-broadcast."""
        self.room.push_fast({"ghosts": self.ghosts(), "r": self.round})
        self.room.no_bump = True

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "total"):
            return ""
        if self.stage == "race" and getattr(p.g, "done", None) is not None:
            return f"🏁 {fmt(p.g.done)}"
        return f"⏱️ {fmt(p.g.total)}" if p.g.total else ""

    def final_scores(self):
        return {i: self.room.players[i].g.total for i in self.seats if i in self.room.players and hasattr(self.room.players[i].g, "total")}

    def view(self, p):
        now = time.time()
        mine = p.id in self.seats and not p.eliminated
        g = p.g if mine else None
        return {"marble": {
            "round": self.round, "rounds": self.rounds, "stage": self.stage, "course": self.course,
            "startIn": max(0.0, self.t0 - now) if self.stage == "race" else 0,
            "elapsed": max(0.0, now - self.t0), "limit": self.limit(),
            "nextIn": max(0.0, self.room.deadline - now) if self.stage == "results" and self.room.deadline else 0,
            "ghosts": self.ghosts(), "results": self.results, "gemBonus": GEM_BONUS, "maxSpeed": MAX_SPEED,
            "totals": {i: self.room.players[i].g.total for i in self.seats if i in self.room.players and hasattr(self.room.players[i].g, "total")},
            "done": g.done if g else None, "playing": mine and self.stage == "race" and g.done is None,
            "standings": self.standings() if self.stage in ("results", "over") and len(self.seats) > 1 else None,
            "perkInfo": {k: list(v) for k, v in PERKS.items()},
            "perks": list(getattr(g, "perks", [])) if g else [],
            "pick": list(getattr(g, "pick", [])) if g else [], "picks": self.perk_picks(p) if g and self.stage == "results" else 0,
        }}
