"""Putt Party: an original mini-golf game on generated holes.

Each hole is a winding fairway of square tiles from the tee to the cup, walled in, with some of:
round bumpers, a sand trap (slow), a slope (pushes the ball), and a pond off to the side (a stroke
penalty, back to where you hit from). Everyone plays the same hole, one stroke each in turn; balls
pass through each other. Fewest strokes over the round wins.

Physics runs on the server in 2D (x across, y up the course, one unit per tile) at 240 steps a second,
and each putt's path is sent to every browser to play back, like Billiards."""
import math
import random

from .base import Game, GameError

COLS, ROWS = 6, 9
BALL, CUP = 0.06, 0.1
DT = 1 / 240
ROLL, SAND = 0.85, 3.2         # deceleration, units/s²
SLOPE = 0.9                    # slope acceleration, units/s²
WALL_BOUNCE, BUMPER_BOUNCE = 0.75, 0.9
MAX_SPEED = 4.6
CUP_SPEED = 2.0                # faster than this and the ball lips out
FRAME = 8                      # record every 8th step (30 fps)
MAX_STEPS = 240 * 14
STROKE_CAP = 8


def walk_path(rng):
    """A random tee-to-cup path of cells, bottom row to top row, never doubling back."""
    while True:
        x, y = rng.randrange(COLS), 0
        path, seen = [(x, y)], {(x, y)}
        while y < ROWS - 1 and len(path) < 30:
            opts = [(x, y + 1)] * 3 + [(x - 1, y), (x + 1, y)]
            opts = [(a, b) for a, b in opts if 0 <= a < COLS and (a, b) not in seen]
            if not opts:
                break
            x, y = rng.choice(opts)
            path.append((x, y))
            seen.add((x, y))
        if y == ROWS - 1 and len(path) >= 8:
            return path


def make_hole(rng):
    path = walk_path(rng)
    cells = set(path)
    for (x, y) in path[1:-1]:  # widen the fairway here and there
        if rng.random() < 0.35:
            nb = rng.choice([(x - 1, y), (x + 1, y)])
            if 0 <= nb[0] < COLS:
                cells.add(nb)
    mid = path[2:-2]
    kinds = {}
    if mid and rng.random() < 0.8:
        kinds[rng.choice(mid)] = "sand"
    slope = None
    if len(mid) > 2 and rng.random() < 0.7:
        c = rng.choice([m for m in mid if m not in kinds])
        kinds[c] = "slope"
        slope = rng.choice([(1, 0), (-1, 0), (0, -1)])
    # a pond: a cell off the fairway, touching it
    edge = [(x + dx, y + dy) for x, y in path[2:-1] for dx, dy in ((1, 0), (-1, 0)) if 0 <= x + dx < COLS]
    edge = [c for c in edge if c not in cells]
    if edge and rng.random() < 0.75:
        w = rng.choice(edge)
        cells.add(w)
        kinds[w] = "water"
    bumpers = []
    for c in rng.sample(mid, min(len(mid), rng.randint(1, 3))):
        if kinds.get(c) not in ("water",):
            bumpers.append((c[0] + rng.uniform(0.3, 0.7), c[1] + rng.uniform(0.3, 0.7), rng.choice((0.1, 0.13, 0.16))))
    tee = (path[0][0] + 0.5, 0.35)
    cup = (path[-1][0] + 0.5, path[-1][1] + 0.55)
    return {"cells": sorted(cells), "kinds": {f"{x},{y}": k for (x, y), k in kinds.items()}, "slope": slope,
            "bumpers": bumpers, "tee": tee, "cup": cup, "path": path}


class Course:
    """Fast lookups over one hole."""
    def __init__(self, hole):
        self.h = hole
        self.cells = {tuple(c) for c in hole["cells"]}
        self.kinds = {tuple(map(int, k.split(","))): v for k, v in hole["kinds"].items()}
        self.slope = tuple(hole["slope"]) if hole["slope"] else None
        self.bumpers = [tuple(b) for b in hole["bumpers"]]
        self.cup = tuple(hole["cup"])

    def open(self, cx, cy):
        return (cx, cy) in self.cells

    def kind(self, x, y):
        return self.kinds.get((math.floor(x), math.floor(y)))


def simulate(course, pos, angle, power, record=True):
    """Returns (final position, 'cup' | 'water' | None, frames)."""
    x, y = pos
    speed = 0.25 + max(0.0, min(1.0, power)) * (MAX_SPEED - 0.25)
    vx, vy = math.cos(angle) * speed, math.sin(angle) * speed
    frames = [[round(x, 3), round(y, 3)]] if record else []
    cx_, cy_ = course.cup
    for step in range(MAX_STEPS):
        k = course.kind(x, y)
        sp = math.hypot(vx, vy)
        if k == "slope":
            vx += course.slope[0] * SLOPE * DT
            vy += course.slope[1] * SLOPE * DT
        dec = (SAND if k == "sand" else ROLL) * DT
        if sp > 0:
            f = max(0.0, sp - dec) / sp
            vx *= f
            vy *= f
        # move one axis at a time against the walls (cell edges next to closed cells)
        nx = x + vx * DT
        cx, cy = math.floor(x), math.floor(y)
        if vx > 0 and nx + BALL > cx + 1 and not course.open(cx + 1, cy):
            nx, vx = cx + 1 - BALL, -vx * WALL_BOUNCE
        elif vx < 0 and nx - BALL < cx and not course.open(cx - 1, cy):
            nx, vx = cx + BALL, -vx * WALL_BOUNCE
        x = nx
        ny = y + vy * DT
        cx = math.floor(x)
        if vy > 0 and ny + BALL > cy + 1 and not course.open(cx, cy + 1):
            ny, vy = cy + 1 - BALL, -vy * WALL_BOUNCE
        elif vy < 0 and ny - BALL < cy and not course.open(cx, cy - 1):
            ny, vy = cy + BALL, -vy * WALL_BOUNCE
        y = ny
        if not course.open(math.floor(x), math.floor(y)):  # squeezed through a corner: put it back
            x, y = min(max(x, cx + BALL), cx + 1 - BALL), min(max(y, cy + BALL), cy + 1 - BALL)
        for bx, by, br in course.bumpers:
            dx, dy = x - bx, y - by
            d = math.hypot(dx, dy)
            if d < br + BALL and d > 1e-9:
                nxv, nyv = dx / d, dy / d
                x, y = bx + nxv * (br + BALL), by + nyv * (br + BALL)
                dot = vx * nxv + vy * nyv
                if dot < 0:
                    vx -= (1 + BUMPER_BOUNCE) * dot * nxv
                    vy -= (1 + BUMPER_BOUNCE) * dot * nyv
        if record and step % FRAME == 0:
            frames.append([round(x, 3), round(y, 3)])
        if course.kind(x, y) == "water":
            if record:
                frames.append([round(x, 3), round(y, 3)])
            return (x, y), "water", frames
        sp = math.hypot(vx, vy)
        if math.hypot(x - cx_, y - cy_) < CUP and sp < CUP_SPEED:
            if record:
                frames.append([round(cx_, 3), round(cy_, 3)])
            return (cx_, cy_), "cup", frames
        if sp < 0.03 and course.kind(x, y) != "slope":
            break
    if record:
        frames.append([round(x, 3), round(y, 3)])
    return (x, y), None, frames


class Putt(Game):
    id = "putt"
    category = "action"
    howto = [
        "Drag back from anywhere and let go to putt: the further you drag, the harder the shot. The ball goes the opposite way, like a slingshot.",
        "Move the view with two fingers: drag to pan, pinch to zoom, twist to turn. Or use the buttons on the view: 🎯 stands behind your ball, ⛳ shows the whole hole.",
        "Everyone plays the same hole, one stroke each in turn. Balls pass through each other.",
        "🟫 Sand slows the ball, ↗ slopes push it, ⚪ bumpers bounce it, and 💧 water costs a stroke (you replay from where you hit).",
        f"Hole out in the fewest strokes; {STROKE_CAP} is the most a hole can cost. Lowest total wins.",
    ]
    name = "Putt Party"
    icon = "⛳"
    blurb = "Mini golf on freshly built 3D holes with bumpers, sand, slopes and water. Fewest strokes wins."
    min_players = 1
    max_players = 6
    settings_schema = {
        "holes": ("Holes", [(6, "6"), (3, "3 (quick)"), (9, "9")], 6),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.cards = [[] for _ in seated]   # strokes per finished hole
        self.hole_no = 0
        self.room.add_log(f"⛳ Putt Party: {self.s['holes']} holes. Fewest strokes wins.", "big")
        self.new_hole()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def new_hole(self):
        self.hole_no += 1
        self.hole = make_hole(self.rng)
        self.course = None
        n = len(self.seats)
        self.balls = [list(self.hole["tee"]) for _ in range(n)]
        self.strokes = [0] * n
        self.holed = [False] * n
        self.shot = None  # {"by", "frames", "result", "id"}
        self.shot_id = getattr(self, "shot_id", 0)
        self.room.add_log(f"⛳ Hole {self.hole_no}/{self.s['holes']}.")
        self.next_turn(-1)

    def get_course(self):
        if self.course is None or self.course.h is not self.hole:
            self.course = Course(self.hole)
        return self.course

    def __getstate__(self):  # the Course cache isn't saved with the room
        d = dict(self.__dict__)
        d["course"] = None
        return d

    def done(self, i):
        p = self.pl(i)
        return self.holed[i] or self.strokes[i] >= STROKE_CAP or p is None or p.eliminated

    def next_turn(self, after):
        n = len(self.seats)
        for k in range(1, n + 1):
            i = (after + k) % n
            if not self.done(i):
                return self.room.begin_turn(self.seats[i])
        self.end_hole()

    def end_hole(self):
        r = self.room
        for i in range(len(self.seats)):
            self.cards[i].append(self.strokes[i] if self.holed[i] else STROKE_CAP)
        totals = [sum(c) for c in self.cards]
        names = [self.pl(i).name if self.pl(i) else "?" for i in range(len(self.seats))]
        r.add_log(f"🏁 Hole {self.hole_no}: " + " · ".join(f"{names[i]} {self.cards[i][-1]}" for i in range(len(self.seats))), "big")
        if self.hole_no >= self.s["holes"]:
            if len(self.seats) == 1:
                par = 3 * self.s["holes"]
                won = totals[0] <= par
                return r.finish(self.pl(0) if won else None,
                                f"{'🏆' if won else '⛳'} {names[0]} finishes on {totals[0]} (par {par}){'!' if won else '.'}")
            low = min(totals[i] for i in range(len(self.seats)) if self.pl(i) and not self.pl(i).eliminated)
            best = [i for i, t in enumerate(totals) if t == low and self.pl(i) and not self.pl(i).eliminated]
            if len(best) == 1:
                return r.finish(self.pl(best[0]), f"🏆 {names[best[0]]} wins Putt Party with {low} strokes!")
            return r.finish(None, f"🤝 A tie on {low} strokes between {' & '.join(names[i] for i in best)}.")
        self.new_hole()

    # -- actions

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        if a.get("type") != "putt":
            raise GameError("Unknown action.")
        self.require_turn(p)
        ang, pw = a.get("angle"), a.get("power")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (ang, pw)):
            raise GameError("Bad shot.")
        self.putt(self.seat(p), float(ang), max(0.0, min(1.0, float(pw))))

    def putt(self, i, angle, power):
        start = tuple(self.balls[i])
        end, result, frames = simulate(self.get_course(), start, angle, power)
        self.strokes[i] += 1
        p = self.pl(i)
        name = p.name if p else "?"
        if result == "water":
            self.strokes[i] += 1
            self.balls[i] = list(start)
            self.room.add_log(f"💧 {name} found the water (+1).", "power")
        elif result == "cup":
            self.holed[i] = True
            self.balls[i] = list(end)
            s = self.strokes[i]
            self.room.add_log(f"⛳ {name} holes out in {s}!" + (" 🎯 Hole in one!" if s == 1 else ""), "power" if s <= 2 else "question")
        else:
            self.balls[i] = [end[0], end[1]]
            if self.strokes[i] >= STROKE_CAP:
                self.room.add_log(f"🙈 {name} picks up at {STROKE_CAP}.", "question")
            else:
                self.room.add_log(f"🏌️ {name} putts ({self.strokes[i]}).", "question")
        self.shot_id += 1
        self.shot = {"by": i, "frames": frames, "result": result, "id": self.shot_id, "from": list(start)}
        self.next_turn(i)

    def on_timeout(self):
        r = self.room
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.pl(i).name} ran out of time.", "power")
        self.putt(i, *self.plan_shot(i, "easy"))

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the course.")
        left = r.contenders()
        if len(self.seats) > 1 and len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if r.turn == p.id:
            self.next_turn(self.seats.index(p.id))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"⛳ {sum(self.cards[i]) + self.strokes[i]}"

    def final_scores(self):
        return {pid: sum(self.cards[i]) for i, pid in enumerate(self.seats)}

    def view(self, p):
        h = self.hole
        return {"putt": {
            "seats": self.seats, "me": self.seat(p), "hole": self.hole_no, "holes": self.s["holes"],
            "cells": h["cells"], "kinds": h["kinds"], "slope": h["slope"], "bumpers": h["bumpers"],
            "tee": h["tee"], "cup": h["cup"], "cols": COLS, "rows": ROWS, "ball": BALL, "cupR": CUP,
            "balls": self.balls, "strokes": self.strokes, "holed": self.holed, "cards": self.cards,
            "shot": self.shot, "cap": STROKE_CAP,
        }}

    # -- bots: aim along the fairway, try many putts in the real physics, keep the best

    def path_distance(self, x, y):
        """Distance to the cup along the fairway path (cells), plus the straight bit in the last cell."""
        path = self.hole["path"]
        cell = (math.floor(x), math.floor(y))
        cx, cy = self.hole["cup"]
        if cell in path:
            k = path.index(cell)
            rest = len(path) - 1 - k
            if rest == 0:
                return math.hypot(x - cx, y - cy)
            nx, ny = path[k + 1]
            return rest + math.hypot(x - (nx + 0.5), y - (ny + 0.5)) * 0.6
        # off the main path (a widened cell): measure from the nearest path cell
        k = min(range(len(path)), key=lambda j: abs(path[j][0] + 0.5 - x) + abs(path[j][1] + 0.5 - y))
        return len(path) - k + 0.5

    def plan_shot(self, i, level):
        course = self.get_course()
        bx, by = self.balls[i]
        path = self.hole["path"]
        targets = [self.hole["cup"]] + [(c[0] + 0.5, c[1] + 0.5) for c in path]
        angles = {math.atan2(ty - by, tx - bx) for tx, ty in targets if (tx, ty) != (bx, by)}
        tries = {"easy": 25, "normal": 70, "hard": 160}[level]
        cands = []
        for a in list(angles):
            for _ in range(max(1, tries // max(1, len(angles)))):
                cands.append((a + random.gauss(0, 0.12), random.uniform(0.05, 1.0)))
        while len(cands) < tries:
            cands.append((random.uniform(-math.pi, math.pi), random.uniform(0.05, 1.0)))
        best, best_score = cands[0], float("inf")
        for a, pw in cands:
            end, result, _ = simulate(course, (bx, by), a, pw, record=False)
            score = -100 if result == "cup" else 50 if result == "water" else self.path_distance(*end)
            if score < best_score:
                best, best_score = (a, pw), score
        a, pw = best
        noise_a, noise_p = {"easy": (0.12, 0.15), "normal": (0.05, 0.07), "hard": (0.012, 0.02)}[level]
        return a + random.gauss(0, noise_a), max(0.02, min(1.0, pw * (1 + random.gauss(0, noise_p))))

    def bot_turn(self, p):
        i = self.seat(p)
        self.putt(i, *self.plan_shot(i, p.bot))
