"""Putt Party: an original mini-golf game on generated holes.

Each hole is a winding fairway of square tiles from the tee to the cup, walled in, with some of:
round bumpers, square posts, a sand trap (slow), a slope (pushes the ball), a hill or a bowl (the
ball rolls off the hump or into the dip), and a pond off to the side (a stroke penalty, back to where
you hit from). Everyone plays the same hole, one stroke each in turn; balls
pass through each other. Fewest strokes over the round wins.

Physics runs on the server in 2D (x across, y up the course, one unit per tile) at 240 steps a second,
and each putt's path is sent to every browser to play back, like Billiards."""
import math
import random
import time

from .base import Game, GameError

COLS, ROWS = 6, 9
BALL, CUP = 0.06, 0.1
DT = 1 / 240
ROLL, SAND = 0.85, 3.2         # deceleration, units/s²
SLOPE = 0.9                    # slope acceleration, units/s²
HILL_G = 4.0                   # how hard the ground's tilt pulls on a hill or in a bowl
HIT_MIN = 0.35                 # an impact slower than this isn't worth a flash on screen
FRINGE, LONG = 1.4, 2.2        # longer grass slows the ball more (fairway ROLL, sand SAND)
FRICTION = {"sand": SAND, "fringe": FRINGE, "long": LONG}
RAMP_G = 1.6                   # a ramp's uphill pull, units/s²
BANK = 0.38                    # a corner bank's size: how far along each side it starts
ROCK_BOUNCE = 0.45
MILL_OMEGA = 2 * math.pi / 5   # a windmill turns once every 5 seconds
MILL_BLOCK = 0.32              # radians either side of straight down that a blade fills the doorway
MILL_DOOR = 0.17               # half the doorway's width
WALL_BOUNCE, BUMPER_BOUNCE = 0.75, 0.9
MAX_SPEED = 4.6
CUP_SPEED = 2.0                # faster than this and the ball lips out
FRAME = 8                      # record every 8th step (30 fps)
MAX_STEPS = 240 * 14
STROKE_CAP = 8
HOLE_PAUSE = 4.0               # seconds to read the hole's scores, after the last putt has rolled


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


def straight_up(path, k):
    """Does the path run straight up through cell k (in from below, out above)?"""
    return 0 < k < len(path) - 1 and path[k - 1] == (path[k][0], path[k][1] - 1) and path[k + 1] == (path[k][0], path[k][1] + 1)


def make_hole(rng):
    path = walk_path(rng)
    cells = set(path)
    for (x, y) in path[1:-1]:  # widen the fairway here and there
        if rng.random() < 0.35:
            nb = rng.choice([(x - 1, y), (x + 1, y)])
            if 0 <= nb[0] < COLS:
                cells.add(nb)
    narrow = lambda c: (c[0] - 1, c[1]) not in cells and (c[0] + 1, c[1]) not in cells
    mid = path[2:-2]
    kinds = {}
    # a jump: a ramp, then a stream across the fairway to clear (too slow and you land in the water)
    jump = [k for k in range(2, len(path) - 3) if straight_up(path, k) and straight_up(path, k + 1) and narrow(path[k]) and narrow(path[k + 1])]
    if jump and rng.random() < 0.45:
        k = rng.choice(jump)
        kinds[path[k]], kinds[path[k + 1]] = "ramp", "water"
    # a windmill over a straight, narrow stretch: its blades sweep down through the doorway in turn
    mills = []
    spots = [path[k] for k in range(2, len(path) - 2) if straight_up(path, k) and narrow(path[k]) and path[k] not in kinds
             and kinds.get(path[k - 1]) is None and kinds.get(path[k + 1]) is None]
    if spots and rng.random() < 0.5:
        mills.append(rng.choice(spots))
    busy = set(kinds) | set(mills)
    free_mid = [c for c in mid if c not in busy]
    if free_mid and rng.random() < 0.8:
        kinds[rng.choice(free_mid)] = "sand"
    slope = None
    free_mid = [c for c in mid if c not in kinds and c not in mills]
    if len(free_mid) > 2 and rng.random() < 0.7:
        c = rng.choice(free_mid)
        kinds[c] = "slope"
        slope = rng.choice([(1, 0), (-1, 0), (0, -1)])
    # a pond: a cell off the fairway, touching it
    edge = [(x + dx, y + dy) for x, y in path[2:-1] for dx, dy in ((1, 0), (-1, 0)) if 0 <= x + dx < COLS]
    edge = [c for c in edge if c not in cells]
    if edge and rng.random() < 0.75:
        w = rng.choice(edge)
        cells.add(w)
        kinds[w] = "water"
    busy = set(kinds) | set(mills)
    bumpers = []
    for c in rng.sample(mid, min(len(mid), rng.randint(1, 3))):
        if c not in busy:
            bumpers.append((c[0] + rng.uniform(0.3, 0.7), c[1] + rng.uniform(0.3, 0.7), rng.choice((0.1, 0.13, 0.16))))
    in_cell = lambda objs: {(math.floor(o[0]), math.floor(o[1])) for o in objs}
    # rolling ground: a hump or a bowl filling a whole tile (flat at its edges, so tiles still meet)
    hills = []
    free = [c for c in mid if c not in busy and c not in in_cell(bumpers)]
    for c in rng.sample(free, min(len(free), rng.choice((0, 1, 1, 2)))):
        hills.append((c[0], c[1], rng.choice((0.14, 0.14, -0.12))))
    taken = busy | {(h[0], h[1]) for h in hills} | in_cell(bumpers)
    # square posts and rocks: standing on the fairway, off the centre line so there's always a way past
    posts, rocks = [], []
    spots = [c for c in path[2:-2] if c not in taken]
    for c in rng.sample(spots, min(len(spots), rng.choice((0, 1, 1, 2)))):
        posts.append((c[0] + rng.choice((0.28, 0.72)), c[1] + rng.uniform(0.35, 0.65), 0.09))
    taken |= in_cell(posts)
    spots = [c for c in path[2:-2] if c not in taken]
    for c in rng.sample(spots, min(len(spots), rng.choice((0, 1, 1)))):
        rocks.append((c[0] + rng.choice((0.25, 0.75)), c[1] + rng.uniform(0.3, 0.7), rng.choice((0.08, 0.1, 0.12))))
    # banks in the outer corner of a turn: a straight one at 45°, or a curved one
    banks = []
    for k in range(1, len(path) - 1):
        (px, py), (cx, cy), (nx, ny) = path[k - 1], path[k], path[k + 1]
        e, n = (px - cx, py - cy), (nx - cx, ny - cy)
        if e[0] == -n[0] and e[1] == -n[1]:
            continue  # straight on: no corner
        if (cx - e[0], cy - e[1]) in cells or (cx - n[0], cy - n[1]) in cells or (cx, cy) in kinds or (cx, cy) in mills:
            continue  # the outer corner isn't walled in on both sides
        if rng.random() < 0.6:
            banks.append((cx, cy, e[0], e[1], n[0], n[1], rng.choice(("flat", "curve"))))
    # grass: the fairway is mown short; the fringe is longer and the rough off to the side longer still
    for c in cells:
        if c in kinds or c in mills or c == path[0] or c == path[-1]:
            continue
        if c not in path:
            kinds[c] = "long" if rng.random() < 0.65 else "fringe"
        elif rng.random() < 0.15:
            kinds[c] = "fringe"
    tee = (path[0][0] + 0.5, 0.35)
    cup = (path[-1][0] + 0.5, path[-1][1] + 0.55)
    par = 3 + ("ramp" in kinds.values() or bool(mills) or len(path) > 12)
    return {"par": par, "cells": sorted(cells), "kinds": {f"{x},{y}": k for (x, y), k in kinds.items()}, "slope": slope,
            "bumpers": bumpers, "tee": tee, "cup": cup, "path": path, "hills": hills, "posts": posts,
            "rocks": rocks, "banks": banks, "mills": mills}


def hill_grad(a, u, v):
    """Gradient of a tile's height a·sin²(πu)·sin²(πv) at (u, v) in 0..1: zero at the tile's edges."""
    su, sv = math.sin(math.pi * u), math.sin(math.pi * v)
    return a * math.pi * math.sin(2 * math.pi * u) * sv * sv, a * math.pi * su * su * math.sin(2 * math.pi * v)


def mill_blocked(t):
    """Is a windmill blade down across the doorway at time t? Four blades; one points straight down
    when OMEGA·t + i·π/2 ≡ -π/2."""
    a = (MILL_OMEGA * t + math.pi / 2) % (math.pi / 2)
    return min(a, math.pi / 2 - a) < MILL_BLOCK


class Course:
    """Fast lookups over one hole."""
    def __init__(self, hole):
        self.h = hole
        self.cells = {tuple(c) for c in hole["cells"]}
        self.kinds = {tuple(map(int, k.split(","))): v for k, v in hole["kinds"].items()}
        self.slope = tuple(hole["slope"]) if hole["slope"] else None
        self.bumpers = [tuple(b) for b in hole["bumpers"]]
        self.cup = tuple(hole["cup"])
        self.hills = {(h[0], h[1]): h[2] for h in hole.get("hills", [])}  # older saved holes have none of these
        self.posts = [tuple(b) for b in hole.get("posts", [])]
        self.rocks = [tuple(b) for b in hole.get("rocks", [])]
        self.mills = {tuple(m) for m in hole.get("mills", [])}
        self.banks = {}
        for cx, cy, ex, ey, nx, ny, shape in hole.get("banks", []):
            corner = (cx + 0.5 - 0.5 * ex - 0.5 * nx, cy + 0.5 - 0.5 * ey - 0.5 * ny)
            self.banks[(cx, cy)] = (corner, (ex, ey), (nx, ny), shape)

    def open(self, cx, cy):
        return (cx, cy) in self.cells

    def kind(self, x, y):
        return self.kinds.get((math.floor(x), math.floor(y)))


def simulate(course, pos, angle, power, record=True, hits=None, t0=0.0):
    """Returns (final position, 'cup' | 'water' | None, frames). Frames are [x, y], or [x, y, z] while the ball
    is in the air or sinking. With a `hits` list, every impact hard enough to show is added to it as
    [frame (fractional), x, y, kind, speed]. t0 is the clock time of the putt (the windmills turn on it)."""
    x, y = pos
    speed = 0.25 + max(0.0, min(1.0, power)) * (MAX_SPEED - 0.25)
    vx, vy = math.cos(angle) * speed, math.sin(angle) * speed
    frames = [[round(x, 3), round(y, 3)]] if record else []
    cx_, cy_ = course.cup
    air, air_t, air_h = 0.0, 0.0, 0.0   # time left in the air, the jump's length and height

    def hit(step, kind, v):
        if hits is not None and v >= HIT_MIN:
            hits.append([round(step / FRAME + 1, 2), round(x, 3), round(y, 3), kind, round(v, 2)])

    def bounce(nxv, nyv, e):
        nonlocal vx, vy
        dot = vx * nxv + vy * nyv
        if dot < 0:
            vx -= (1 + e) * dot * nxv
            vy -= (1 + e) * dot * nyv
        return -dot

    for step in range(MAX_STEPS):
        k = None if air > 0 else course.kind(x, y)
        sp = math.hypot(vx, vy)
        ax = ay = 0.0
        if air <= 0:
            if k == "slope":
                vx += course.slope[0] * SLOPE * DT
                vy += course.slope[1] * SLOPE * DT
            elif k == "ramp":  # uphill: it slows the ball, and rolls a slow one back
                vy -= RAMP_G * DT
            cell = (math.floor(x), math.floor(y))
            a = course.hills.get(cell)
            if a:  # the ground tilts on a hill or in a bowl: roll downhill
                gx, gy = hill_grad(a, x - cell[0], y - cell[1])
                ax, ay = -HILL_G * gx, -HILL_G * gy
                vx += ax * DT
                vy += ay * DT
            dec = FRICTION.get(k, ROLL) * DT
            sp = math.hypot(vx, vy)  # after the ground's pull: friction mustn't cancel a slope's push from rest
            if sp > 0:
                f = max(0.0, sp - dec) / sp
                vx *= f
                vy *= f
        # move one axis at a time against the walls (cell edges next to closed cells)
        nx = x + vx * DT
        cx, cy = math.floor(x), math.floor(y)
        if vx > 0 and nx + BALL > cx + 1 and not course.open(cx + 1, cy):
            hit(step, "wall", abs(vx))
            nx, vx = cx + 1 - BALL, -vx * WALL_BOUNCE
        elif vx < 0 and nx - BALL < cx and not course.open(cx - 1, cy):
            hit(step, "wall", abs(vx))
            nx, vx = cx + BALL, -vx * WALL_BOUNCE
        x = nx
        ny = y + vy * DT
        cx = math.floor(x)
        if vy > 0 and ny + BALL > cy + 1 and not course.open(cx, cy + 1):
            hit(step, "wall", abs(vy))
            ny, vy = cy + 1 - BALL, -vy * WALL_BOUNCE
        elif vy < 0 and ny - BALL < cy and not course.open(cx, cy - 1):
            hit(step, "wall", abs(vy))
            ny, vy = cy + BALL, -vy * WALL_BOUNCE
        # off the top of a ramp: into the air, further and higher the faster it goes
        if air <= 0 and course.kind(x, y) == "ramp" and vy > 0 and ny >= cy + 1:
            air = air_t = min(0.75, max(0.12, vy * 0.24))
            air_h = 0.05 + vy * 0.07
        # a windmill's front wall runs across the middle of its tile, with a doorway the blades sweep through
        if (cx, cy) in course.mills or (cx, math.floor(ny)) in course.mills:
            mx, my = (cx, cy) if (cx, cy) in course.mills else (cx, math.floor(ny))
            line = my + 0.5
            crossing = (y + BALL <= line < ny + BALL) if vy > 0 else (ny - BALL < line <= y - BALL) if vy < 0 else False
            if crossing:
                door = abs(x - (mx + 0.5)) < MILL_DOOR - BALL
                blade = door and mill_blocked(t0 + step * DT)
                if not door or blade:
                    hit(step, "mill" if blade else "wall", abs(vy))
                    ny = line - BALL if vy > 0 else line + BALL
                    vy = -vy * WALL_BOUNCE
        y = ny
        if not course.open(math.floor(x), math.floor(y)):  # squeezed through a corner: put it back
            x, y = min(max(x, cx + BALL), cx + 1 - BALL), min(max(y, cy + BALL), cy + 1 - BALL)
        # a bank in a turn's outer corner
        bank = course.banks.get((math.floor(x), math.floor(y)))
        if bank:
            (qx, qy), (ex, ey), (nxd, nyd), shape = bank
            if shape == "flat":  # a straight wall at 45° across the corner, BANK from it along each side
                inx, iny = (ex + nxd) / math.sqrt(2), (ey + nyd) / math.sqrt(2)   # its normal, into the tile
                d = (x - qx) * inx + (y - qy) * iny - BANK / math.sqrt(2)
                if d < BALL:
                    x, y = x + (BALL - d) * inx, y + (BALL - d) * iny
                    hit(step, "wall", bounce(inx, iny, WALL_BOUNCE))
            else:  # a curved wall: a quarter circle of radius BANK, touching both sides
                ox, oy = qx + BANK * (ex + nxd), qy + BANK * (ey + nyd)
                if (x - ox) * ex + (y - oy) * ey < 0 and (x - ox) * nxd + (y - oy) * nyd < 0:  # out in the corner, past the centre
                    dx, dy = x - ox, y - oy
                    d = math.hypot(dx, dy)
                    if d > BANK - BALL and d > 1e-9:
                        ux, uy = dx / d, dy / d
                        x, y = ox + ux * (BANK - BALL), oy + uy * (BANK - BALL)
                        hit(step, "wall", bounce(-ux, -uy, WALL_BOUNCE))
        if air <= 0:
            for bx, by, br in course.bumpers:
                dx, dy = x - bx, y - by
                d = math.hypot(dx, dy)
                if d < br + BALL and d > 1e-9:
                    x, y = bx + dx / d * (br + BALL), by + dy / d * (br + BALL)
                    hit(step, "bumper", bounce(dx / d, dy / d, BUMPER_BOUNCE))
            for bx, by, br in course.rocks:  # rocks: lumpy and dead, they soak up the bounce
                dx, dy = x - bx, y - by
                d = math.hypot(dx, dy)
                if d < br + BALL and d > 1e-9:
                    x, y = bx + dx / d * (br + BALL), by + dy / d * (br + BALL)
                    hit(step, "rock", bounce(dx / d, dy / d, ROCK_BOUNCE))
            for px, py, ph in course.posts:  # a square block: bounce off its nearest face or corner
                qx, qy = min(max(x, px - ph), px + ph), min(max(y, py - ph), py + ph)
                dx, dy = x - qx, y - qy
                d = math.hypot(dx, dy)
                if d < BALL:
                    if d > 1e-9:
                        nxv, nyv = dx / d, dy / d
                    else:  # the centre got inside: push out through the nearest face
                        ex_, ey_ = ph - abs(x - px), ph - abs(y - py)
                        nxv, nyv = (math.copysign(1, x - px), 0.0) if ex_ < ey_ else (0.0, math.copysign(1, y - py))
                        qx, qy = (px + nxv * ph, y) if ex_ < ey_ else (x, py + nyv * ph)
                    x, y = qx + nxv * BALL, qy + nyv * BALL
                    hit(step, "post", bounce(nxv, nyv, WALL_BOUNCE))
        z = None
        if air > 0:  # in flight: a parabola over the jump
            air -= DT
            s = 1 - max(0.0, air) / air_t
            z = round(4 * air_h * s * (1 - s), 3)
            if air <= 0:
                hit(step, "land", math.hypot(vx, vy))
        if record and step % FRAME == 0:
            frames.append([round(x, 3), round(y, 3)] if z is None else [round(x, 3), round(y, 3), z])
        if air <= 0 and course.kind(x, y) == "water":
            hit(step, "splash", max(HIT_MIN, math.hypot(vx, vy)))
            if record:  # plunge in, slow right down and sink
                for j in range(1, 13):  # a little way on, staying in the water
                    nx_, ny_ = x + vx * 0.008 * (1 - j / 13), y + vy * 0.008 * (1 - j / 13)
                    if course.kind(nx_, ny_) == "water":
                        x, y = nx_, ny_
                    frames.append([round(x, 3), round(y, 3), round(-0.02 * j, 3)])
            return (x, y), "water", frames
        sp = math.hypot(vx, vy)
        if air <= 0 and math.hypot(x - cx_, y - cy_) < CUP and sp < CUP_SPEED:
            if record:
                frames.append([round(cx_, 3), round(cy_, 3)])
            return (cx_, cy_), "cup", frames
        # stop when slow, unless the ground is steep enough to keep it rolling (a slope, a ramp, a hillside)
        if air <= 0 and sp < 0.03 and course.kind(x, y) not in ("slope", "ramp") and math.hypot(ax, ay) < ROLL:
            break
    if record:
        frames.append([round(x, 3), round(y, 3)])
    return (x, y), None, frames


class Putt(Game):
    id = "putt"
    category = "action"
    howto = [
        "Put your finger on your ball (the ringed one), drag back and let go: the further you drag, the harder the shot. The ball goes the opposite way, like a slingshot.",
        "Drag anywhere else to turn and tilt the view; two fingers (or a right-drag) pan, pinch or the wheel zooms. The camera follows your ball, then swings round behind it. 🎯 does that too, ⛳ shows the whole hole.",
        "⛰️ Humps push the ball aside and bowls pull it in; ⚪ bumpers, ▪️ posts and 🪨 rocks bounce it; long grass slows it.",
        "🌀 Time your putt through the windmill's doorway, and hit the ramp hard enough to clear the stream.",
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
    low_wins = True  # strokes: the standings card ranks fewest first

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.cards = [[] for _ in seated]   # strokes per finished hole
        self.hole_no = 0
        self.pars = []
        self.room.add_log(f"⛳ Putt Party: {self.s['holes']} holes. Fewest strokes wins.", "big")
        self.new_hole()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def new_hole(self):
        self.between = False
        self.mark_round()
        self.hole_no += 1
        self.hole = make_hole(self.rng)
        self.pars = getattr(self, "pars", [3] * (self.hole_no - 1)) + [self.hole.get("par", 3)]
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
        names = [self.pl(i).name if self.pl(i) else "?" for i in range(len(self.seats))]
        r.add_log(f"🏁 Hole {self.hole_no}: " + " · ".join(f"{names[i]} {self.cards[i][-1]}" for i in range(len(self.seats))), "big")
        # Let the last putt roll in on everyone's screen, then show the hole's scores, before moving on:
        # the next hole used to replace this one in the same update, so the final putt was never seen.
        self.between = True
        r.turn = None
        r.deadline = time.time() + self.roll_time() + HOLE_PAUSE

    def roll_time(self):
        """How long the last putt takes to play back in the browsers (frames at 30 a second)."""
        return len(self.shot["frames"]) / 30 if self.shot else 0.0

    def after_hole(self):
        r = self.room
        self.between = False
        totals = [sum(c) for c in self.cards]
        names = [self.pl(i).name if self.pl(i) else "?" for i in range(len(self.seats))]
        if self.hole_no >= self.s["holes"]:
            if len(self.seats) == 1:
                par = sum(getattr(self, "pars", [])) or 3 * self.s["holes"]  # each hole's par: 3, or 4 for a tricky one
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
        hits, t0 = [], time.time()
        end, result, frames = simulate(self.get_course(), start, angle, power, hits=hits, t0=t0)
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
        self.shot = {"by": i, "frames": frames, "result": result, "id": self.shot_id, "from": list(start), "hits": hits[:40],
                     "t0": round(t0, 3)}
        self.next_turn(i)
        # nobody putts again until this ball has stopped rolling on screen (a bot used to go after about a
        # second, cutting the animation short so the ball jumped to where it stopped)
        r, wait = self.room, self.roll_time()
        if r.turn is not None:
            if self.pl(self.seats.index(r.turn)).bot:
                r.bot_at = max(r.bot_at, time.time() + wait + 0.8)
            if r.deadline:
                r.deadline += wait

    def on_timeout(self):
        r = self.room
        if getattr(self, "between", False):
            return self.after_hole()
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
            "tee": h["tee"], "cup": h["cup"], "path": h["path"], "par": h.get("par", 3), "pars": getattr(self, "pars", []),
            "hills": h.get("hills", []), "posts": h.get("posts", []), "rocks": h.get("rocks", []),
            "banks": h.get("banks", []), "mills": h.get("mills", []), "millSpeed": MILL_OMEGA, "now": round(time.time(), 3), "cols": COLS, "rows": ROWS, "ball": BALL, "cupR": CUP,
            "balls": self.balls, "strokes": self.strokes, "holed": self.holed, "cards": self.cards,
            "shot": self.shot, "cap": STROKE_CAP, "between": getattr(self, "between", False),
            "standings": self.standings() if getattr(self, "between", False) and len(self.seats) > 1 else None,
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
        t0 = time.time()  # the windmills will be where they are now, give or take
        cands = []
        for a in list(angles):
            for _ in range(max(1, tries // max(1, len(angles)))):
                cands.append((a + random.gauss(0, 0.12), random.uniform(0.05, 1.0)))
        while len(cands) < tries:
            cands.append((random.uniform(-math.pi, math.pi), random.uniform(0.05, 1.0)))
        best, best_score = cands[0], float("inf")
        for a, pw in cands:
            end, result, _ = simulate(course, (bx, by), a, pw, record=False, t0=t0)
            score = -100 if result == "cup" else 50 if result == "water" else self.path_distance(*end)
            if score < best_score:
                best, best_score = (a, pw), score
        a, pw = best
        noise_a, noise_p = {"easy": (0.12, 0.15), "normal": (0.05, 0.07), "hard": (0.012, 0.02)}[level]
        return a + random.gauss(0, noise_a), max(0.02, min(1.0, pw * (1 + random.gauss(0, noise_p))))

    def bot_ready(self):
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot) and not getattr(self, "between", False)  # the pause between holes runs on the clock

    def bot_turn(self, p):
        i = self.seat(p)
        self.putt(i, *self.plan_shot(i, p.bot))
