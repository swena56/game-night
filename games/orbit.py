"""Orbit Golf: an original space mini-golf game for 2–6 players, taking turns.

Each hole is a patch of space between a tee and a glowing cup. Launch your probe with a drag (direction and power):
planets pull it off a straight line, so the way to the cup is usually a curve round a planet or a slingshot past one.
Space here has a little drag (it's a golf course after all), so probes slow down and come to rest, in open space or
lying on a planet's surface, and the next stroke goes from there.

A probe drops in the cup if it arrives slowly enough; too fast and it lips out. Hazards: a black hole swallows a
probe that crosses its edge, and drifting out of the course does the same (+1 stroke, back where you hit from).
Asteroid belts bounce probes about, and wormholes send them out of their twin, still moving.

Turns go golf style: whoever is furthest from the cup plays next. Fewest strokes over the holes wins.
The server simulates every shot and sends the path; browsers play it back.
"""
import math
import random
import time

from .base import Game, GameError

DT = 1 / 90
T_MAX = 9.0
VMAX = 19.0           # launch speed at full power
DRAG, FRICTION = 0.45, 0.9      # space drag (per second) and a constant slow-down (units/s²), so probes come to rest
STOP_V = 0.45
PROBE_R = 0.25
CUP_R = 0.75
CUP_V = 8.5           # faster than this and it lips out
X_MAX, Y_MAX = 13.0, 19.0
TEE = (0.0, -16.0)
MASS_K = 13.0         # a planet's pull = MASS_K × r² / d²
BH_MASS, BH_R = 70.0, 0.85
ROCK_R = 0.55
WORM_R = 0.8
MAX_STROKES = 8
PLAY = 1.6            # browsers play a shot this many times faster than it happened
HOLE_PAUSE = 5.0
SHOT_PAUSE = 0.9
FEATURES = ("twin", "sling", "belt", "black", "worm")
FEATURE_NAMES = {"twin": "🌗 Twin Moons", "sling": "🪐 The Slingshot", "belt": "☄️ Asteroid Alley",
                 "black": "🕳 Event Horizon", "worm": "🌀 Wormhole Way"}
PAR = {"twin": 3, "sling": 3, "belt": 4, "black": 3, "worm": 3}
BOT_SIG = {"easy": (5.0, 0.09), "normal": (2.4, 0.045), "hard": (1.1, 0.02)}     # angle °, power
BOT_TRIES = {"easy": 12, "normal": 30, "hard": 40}


def gravity(x, y, planets, blacks):
    ax = ay = 0.0
    for px, py, r, _ in planets:
        dx, dy = px - x, py - y
        d2 = dx * dx + dy * dy
        d = math.sqrt(d2) or 1e-6
        a = MASS_K * r * r / max(d2, r * r)
        ax += a * dx / d
        ay += a * dy / d
    for bx, by in blacks:
        dx, dy = bx - x, by - y
        d2 = dx * dx + dy * dy
        d = math.sqrt(d2) or 1e-6
        a = BH_MASS / max(d2, 0.5)
        ax += a * dx / d
        ay += a * dy / d
    return ax, ay


def simulate(hole, start, angle, power):
    """Fly one stroke. angle in degrees (0 = straight up the course), power 0..1.
    Returns (path [[t, x, y, jump]], events [[t, kind, x, y]], result, end (x, y)).
    result: "rest" | "cup" | "black" | "out"."""
    planets, blacks = hole["planets"], hole["blacks"]
    rocks, worms, cup = hole["rocks"], hole["worms"], hole["cup"]
    a = math.radians(angle)
    sp = VMAX * max(0.0, min(1.0, power))
    vx, vy = sp * math.sin(a), sp * math.cos(a)
    x, y = start
    t = 0.0
    path = [[0.0, x, y, 0]]
    events = []
    result = "rest"
    warp_cool = 0.0
    every = 3
    step = 0
    while t < T_MAX:
        ax, ay = gravity(x, y, planets, blacks)
        v = math.hypot(vx, vy)
        if v > 1e-6:
            dec = DRAG * v + FRICTION
            k = max(0.0, v - dec * DT) / v
            vx *= k
            vy *= k
        vx += ax * DT
        vy += ay * DT
        x += vx * DT
        y += vy * DT
        t += DT
        step += 1
        jump = 0
        touching = False
        # planets: the probe can't go in; it bounces off fast and settles on the surface when slow
        for px, py, r, _ in planets:
            dx, dy = x - px, y - py
            d = math.hypot(dx, dy)
            if d < r + PROBE_R:
                nx, ny = (dx / d, dy / d) if d > 1e-6 else (0.0, 1.0)
                x, y = px + nx * (r + PROBE_R), py + ny * (r + PROBE_R)
                vn = vx * nx + vy * ny
                if vn < 0:
                    e = 0.45 if vn < -3 else 0.0
                    vx -= (1 + e) * vn * nx
                    vy -= (1 + e) * vn * ny
                    if vn < -3:
                        events.append([round(t, 3), "bump", round(x, 2), round(y, 2)])
                # rolling friction along the surface
                f = max(0.0, 1 - 2.2 * DT)
                vx *= f
                vy *= f
                touching = True
        for rx, ry in rocks:
            dx, dy = x - rx, y - ry
            d = math.hypot(dx, dy)
            if d < ROCK_R + PROBE_R:
                nx, ny = (dx / d, dy / d) if d > 1e-6 else (0.0, 1.0)
                x, y = rx + nx * (ROCK_R + PROBE_R), ry + ny * (ROCK_R + PROBE_R)
                vn = vx * nx + vy * ny
                if vn < 0:
                    vx -= 1.7 * vn * nx
                    vy -= 1.7 * vn * ny
                    events.append([round(t, 3), "rock", round(x, 2), round(y, 2)])
        warp_cool = max(0.0, warp_cool - DT)
        if worms and warp_cool <= 0:
            for k2, (wx, wy) in enumerate(worms):
                if math.hypot(x - wx, y - wy) < WORM_R:
                    ox, oy = worms[1 - k2]
                    events.append([round(t, 3), "warp", round(wx, 2), round(wy, 2)])
                    x, y = ox + (x - wx), oy + (y - wy)
                    warp_cool = 0.6
                    jump = 1
                    break
        v = math.hypot(vx, vy)
        cx, cy = cup
        if math.hypot(x - cx, y - cy) < CUP_R:
            if v < CUP_V:
                x, y = cx, cy
                result = "cup"
                path.append([round(t, 3), round(x, 3), round(y, 3), jump])
                events.append([round(t, 3), "cup", cx, cy])
                break
            if not any(e[1] == "lip" and t - e[0] < 0.3 for e in events):
                events.append([round(t, 3), "lip", round(x, 2), round(y, 2)])
                # skims the rim: turned aside a little and slowed
                s = 1 if (vx * (y - cy) - vy * (x - cx)) > 0 else -1
                c, sn = math.cos(0.45 * s), math.sin(0.45 * s)
                vx, vy = (vx * c - vy * sn) * 0.7, (vx * sn + vy * c) * 0.7
        if any(math.hypot(x - bx, y - by) < BH_R for bx, by in blacks):
            result = "black"
            path.append([round(t, 3), round(x, 3), round(y, 3), jump])
            events.append([round(t, 3), "black", round(x, 2), round(y, 2)])
            break
        if abs(x) > X_MAX or abs(y) > Y_MAX:
            result = "out"
            path.append([round(t, 3), round(x, 3), round(y, 3), jump])
            events.append([round(t, 3), "out", round(x, 2), round(y, 2)])
            break
        if v < STOP_V and t > 0.25 and (touching or math.hypot(ax, ay) < 1.2):
            path.append([round(t, 3), round(x, 3), round(y, 3), jump])
            break
        if jump or step % every == 0:
            path.append([round(t, 3), round(x, 3), round(y, 3), jump])
    else:
        path.append([round(t, 3), round(x, 3), round(y, 3), 0])
    return path, events, result, (round(x, 3), round(y, 3))


def free(p, hole, gap):
    """Is point p at least `gap` clear of every body on the hole?"""
    x, y = p
    for px, py, r, _ in hole["planets"]:
        if math.hypot(x - px, y - py) < r + gap:
            return False
    for bx, by in hole["blacks"]:
        if math.hypot(x - bx, y - by) < BH_R + gap + 1.5:
            return False
    for rx, ry in hole["rocks"]:
        if math.hypot(x - rx, y - ry) < ROCK_R + gap:
            return False
    for wx, wy in hole["worms"]:
        if math.hypot(x - wx, y - wy) < WORM_R + gap:
            return False
    return True


def make_hole(rng, feature):
    """A seeded hole: planets (x, y, r, look), black holes, rocks, wormholes, the cup."""
    for _ in range(200):
        h = {"planets": [], "blacks": [], "rocks": [], "worms": [], "feature": feature}
        cup = (round(rng.uniform(-8, 8), 2), round(rng.uniform(12, 16), 2))
        if feature == "sling":
            # a big planet sits right between the tee and the cup
            h["planets"].append((round(rng.uniform(-2.5, 2.5), 2), round(rng.uniform(-1, 3), 2), round(rng.uniform(3.6, 4.4), 2), rng.randrange(6)))
        elif feature == "twin":
            y0 = rng.uniform(-3, 5)
            h["planets"].append((round(rng.uniform(-8, -3), 2), round(y0, 2), round(rng.uniform(2, 3), 2), rng.randrange(6)))
            h["planets"].append((round(rng.uniform(3, 8), 2), round(y0 + rng.uniform(-3, 3), 2), round(rng.uniform(2, 3), 2), rng.randrange(6)))
        elif feature == "black":
            h["blacks"].append((round(rng.uniform(-3, 3), 2), round(rng.uniform(1, 7), 2)))
        elif feature == "belt":
            # a curved band of rocks across the course with one gap
            yb = rng.uniform(0, 6)
            gap = rng.uniform(-8, 8)
            bend = rng.uniform(-0.05, 0.05)
            xx = -X_MAX + 0.5
            while xx < X_MAX - 0.5:
                if abs(xx - gap) > 1.7:
                    h["rocks"].append((round(xx, 2), round(yb + bend * xx * xx + rng.uniform(-0.3, 0.3), 2)))
                xx += 1.25
        elif feature == "worm":
            a = (round(rng.uniform(-10, -5) * rng.choice((1, -1)), 2), round(rng.uniform(-10, -4), 2))
            b = (round(-a[0] * rng.uniform(0.3, 1.0), 2), round(rng.uniform(1, 6), 2))
            h["worms"] = [a, b]
        # one or two more small planets anywhere in the middle
        for _ in range(rng.choice((1, 2)) if feature != "sling" else 1):
            p = (round(rng.uniform(-10, 10), 2), round(rng.uniform(-9, 11), 2), round(rng.uniform(1.2, 2.2), 2), rng.randrange(6))
            h2 = dict(h, planets=[])
            if free(p[:2], h2, p[2] + 1.2) and all(math.hypot(p[0] - q[0], p[1] - q[1]) > p[2] + q[2] + 1.2 for q in h["planets"]):
                h["planets"].append(p)
        if not free(cup, h, 2.2) or not free(TEE, h, 2.5):
            continue
        if any(abs(px) + r > X_MAX - 0.5 for px, _, r, _ in h["planets"]):
            continue
        h["cup"] = cup
        return h
    return {"planets": [(0.0, 2.0, 2.5, 0)], "blacks": [], "rocks": [], "worms": [], "feature": "twin", "cup": (0.0, 14.0)}


class Orbit(Game):
    id = "orbit"
    category = "action"
    family = None
    howto = [
        "Take turns launching your probe at the glowing cup: drag back from your probe to aim and set the power (or use ◀ ▶ − + and 🚀 Launch).",
        "Planets pull your probe into curves: go round them or slingshot past. Probes slow down and stop in open space or on a planet, and you play on from there.",
        "Arrive slowly to drop in the cup; too fast and it lips out. The dotted line shows how your probe sets off.",
        "🕳 Black holes swallow probes, and drifting off the course does too: +1 stroke, back where you hit from. ☄️ Rocks bounce you about; 🌀 a wormhole sends you out of its twin.",
        "Whoever is furthest from the cup goes next. Fewest strokes after the last hole wins (8 at most on a hole).",
    ]
    name = "Orbit Golf"
    icon = "🪐"
    blurb = "Mini-golf in space: curve your probe round planets, slingshot past moons and keep out of the black hole."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "ace": ("🌟", "Hole in one", "Sink a hole in one stroke"),
              "sling": ("🪐", "Slingshot", "Sink a shot that swung round a planet"),
              "warp": ("🌀", "Through the wormhole", "Sink a shot that went through a wormhole")}
    settings_schema = {
        "holes": ("Holes", [(5, "5"), (3, "3"), (9, "9")], 5),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.cards = [[] for _ in range(n)]     # strokes per finished hole
        self.hole_no = 0
        self.shot, self.shot_id = None, 0
        self.between = False
        self.ready_at = 0.0
        feats = []
        while len(feats) < self.total:
            run = list(FEATURES)
            rng.shuffle(run)
            feats += run
        self.features = feats[:self.total]
        self.room.add_log(f"🪐 Orbit Golf: {self.total} holes. Mind the gravity!", "big")
        self.new_hole()

    @property
    def total(self):
        v = self.s.get("holes", 5)
        return v if v in (3, 5, 9) else 5

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

    def new_hole(self):
        self.between = False
        self.mark_round()
        self.hole_no += 1
        feat = self.features[self.hole_no - 1]
        self.hole = make_hole(self.rng, feat)
        self.par = PAR[feat]
        n = len(self.seats)
        self.pos = [list(TEE) for _ in range(n)]
        self.strokes = [0] * n
        self.done = [not self.present(i) for i in range(n)]
        self.trail = [[] for _ in range(n)]       # where each probe has rested this hole
        self.shot = None
        self.room.add_log(f"⛳ Hole {self.hole_no} of {self.total}: {FEATURE_NAMES[feat]}, par {self.par}.", "info")
        self.next_turn(0.0, first=True)

    def dist(self, i):
        cx, cy = self.hole["cup"]
        return math.hypot(self.pos[i][0] - cx, self.pos[i][1] - cy)

    def next_turn(self, wait, first=False):
        n = len(self.seats)
        self.ready_at = time.time() + wait      # set even when the hole ends, so browsers can time the last shot
        left = [i for i in range(n) if not self.done[i] and self.present(i)]
        if not left:
            return self.end_hole(wait)
        if first:
            # on the tee everyone is the same distance away: rotate who starts each hole
            start = (self.hole_no - 1) % n
            i = min(left, key=lambda k: (k - start) % n)
        else:
            i = max(left, key=lambda k: (round(self.dist(k), 3), -self.strokes[k]))
        r = self.room
        r.begin_turn(self.seats[i])
        self.ready_at = time.time() + wait
        if wait:
            if self.pl(i).bot:
                r.bot_at = max(r.bot_at, self.ready_at + 0.6)
            if r.deadline:
                r.deadline += wait

    # -- actions

    def act(self, p, a):
        if a.get("type") != "launch":
            raise GameError("Unknown action.")
        if self.between:
            raise GameError("The next hole is coming up.")
        self.require_turn(p)
        ang, power = a.get("angle"), a.get("power")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (ang, power)):
            raise GameError("Bad launch.")
        if abs(ang) > 360 or not 0.02 <= power <= 1:
            raise GameError("Bad launch.")
        if time.time() < self.ready_at - 0.3:
            raise GameError("Wait for the probe to stop.")
        self.launch(self.seat(p), float(ang), float(power))

    def launch(self, i, ang, power):
        start = tuple(self.pos[i])
        path, events, result, end = simulate(self.hole, start, ang, power)
        self.strokes[i] += 1
        nm = self.name_of(i)
        self.shot_id += 1
        t_play = path[-1][0] / PLAY
        at = time.time() + t_play
        pen = 0
        swung = any(abs(self.angle_to(start, q[1:3]) - math.radians(ang)) > 0.6 for q in path[len(path) // 3:]) and bool(self.hole["planets"])
        warped = any(e[1] == "warp" for e in events)
        if result == "cup":
            self.pos[i] = list(self.hole["cup"])
            self.done[i] = True
            s = self.strokes[i]
            word = {1: "a HOLE IN ONE", self.par - 2: "an eagle", self.par - 1: "a birdie", self.par: "par", self.par + 1: "a bogey"}.get(s, f"{s} strokes")
            self.room.add_log(f"⛳ {nm} sinks it: {word}!", "big" if s < self.par else "info")
            p = self.pl(i)
            if s == 1:
                self.award(p, "ace", at=at)
                self.moment(f"🌟 {nm}: HOLE IN ONE!", "gold", "fanfare", at=at)
            elif s < self.par:
                self.moment(f"🐦 {nm} makes {word}!", "good", "good", at=at)
            if warped:
                self.award(p, "warp", at=at)
            elif swung and s <= self.par:
                self.award(p, "sling", at=at)
        elif result in ("black", "out"):
            pen = 1
            self.strokes[i] += 1
            what = "falls into the black hole" if result == "black" else "drifts off into deep space"
            self.room.add_log(f"🛰 {nm}'s probe {what}: +1 stroke.", "power")
            if result == "black":
                self.moment(f"🕳 {nm}'s probe is swallowed!", "bad", "boom", at=at)
        else:
            self.pos[i] = list(end)
            self.trail[i].append(list(end))
            self.room.add_log(f"🚀 {nm} launches: {self.dist(i):.1f} from the cup.", "info")
        if not self.done[i] and self.strokes[i] >= MAX_STROKES:
            self.done[i] = True
            self.strokes[i] = MAX_STROKES
            self.room.add_log(f"🏳 {nm} picks up on {MAX_STROKES}.", "info")
        self.shot = {"id": self.shot_id, "o": i, "path": path, "events": events, "result": result, "from": list(start),
                     "end": list(end), "angle": round(ang, 2), "power": round(power, 3), "t": round(t_play, 2), "pen": pen,
                     "strokes": self.strokes[i]}
        self.next_turn(t_play + SHOT_PAUSE)

    @staticmethod
    def angle_to(a, b):
        return math.atan2(b[0] - a[0], b[1] - a[1])

    # -- holes

    def totals(self):
        return [sum(c) for c in self.cards]

    def end_hole(self, wait):
        r = self.room
        n = len(self.seats)
        for i in range(n):
            self.cards[i].append(self.strokes[i] if self.present(i) or self.strokes[i] else MAX_STROKES)
        here = [i for i in range(n) if self.present(i)]
        if here:
            r.add_log(f"🏁 Hole {self.hole_no}: " + ", ".join(f"{self.name_of(i)} {self.strokes[i]}" for i in sorted(here, key=lambda k: self.strokes[k])) + f" (par {self.par}).", "big")
        self.between = True
        r.turn = None
        r.deadline = time.time() + wait + HOLE_PAUSE

    def after_hole(self):
        r = self.room
        self.between = False
        here = [i for i in range(len(self.seats)) if self.present(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        if self.hole_no >= self.total or len(here) <= 1:
            tot = self.totals()
            best = min(tot[i] for i in here)
            tied = [i for i in here if tot[i] == best]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {best} strokes between {' & '.join(self.name_of(i) for i in tied)}.")
            w = tied[0]
            pars = sum(PAR[f] for f in self.features[:self.hole_no])
            rel = best - pars
            return r.finish(self.pl(w), f"🏆 {self.name_of(w)} wins Orbit Golf on {best} strokes ({'+' if rel > 0 else ''}{rel if rel else 'level par'})!")
        self.new_hole()

    def on_timeout(self):
        r = self.room
        if self.between:
            return self.after_hole()
        if r.turn not in self.seats:
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.name_of(i)} ran out of time: the probe launches itself.", "power")
        self.launch(i, *self.plan(i, "easy"))

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the course.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        i = self.seat(p)
        if i is not None and not self.between:
            self.done[i] = True
            if r.turn == p.id:
                self.next_turn(0.0)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "cards"):
            return ""
        return f"{sum(self.cards[i]) + (self.strokes[i] if not self.between else 0)} strokes"

    def final_scores(self):
        return {pid: -t for pid, t in zip(self.seats, self.totals())}

    def view(self, p):
        h = self.hole
        return {"orbit": {
            "seats": self.seats, "me": self.seat(p), "hole": self.hole_no, "holes": self.total, "par": self.par,
            "pars": [PAR[f] for f in self.features], "feature": h["feature"], "name": FEATURE_NAMES[h["feature"]],
            "planets": h["planets"], "blacks": h["blacks"], "rocks": h["rocks"], "worms": h["worms"], "cup": h["cup"], "tee": TEE,
            "pos": self.pos, "strokes": self.strokes, "done": self.done, "cards": self.cards, "trail": self.trail,
            "shot": self.shot, "between": self.between,
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)),
            "standings": self.standings() if self.between and len(self.seats) > 1 else None,
            "geo": {"dt": DT, "vmax": VMAX, "drag": DRAG, "friction": FRICTION, "mass": MASS_K, "bhMass": BH_MASS, "bhR": BH_R,
                    "probe": PROBE_R, "cupR": CUP_R, "rock": ROCK_R, "worm": WORM_R, "xMax": X_MAX, "yMax": Y_MAX, "play": PLAY},
        }}

    # -- bots: try launches in their head with the same physics and take the one that ends nearest the cup

    def plan(self, i, level):
        rng = random
        start = tuple(self.pos[i])
        cx, cy = self.hole["cup"]
        straight = math.degrees(math.atan2(cx - start[0], cy - start[1]))
        d = math.hypot(cx - start[0], cy - start[1])
        tries = BOT_TRIES.get(level, 30)
        best, best_v = (straight, min(1.0, 0.15 + d / 34)), math.inf

        def judge(c):
            _, _, res, end = simulate(self.hole, start, c[0], c[1])
            if res == "cup":
                return -10.0
            if res in ("black", "out"):
                return 60.0
            return math.hypot(end[0] - cx, end[1] - cy)

        for k in range(tries):
            c = (straight + rng.uniform(-75, 75) if k % 3 else straight + rng.gauss(0, 15),
                 rng.uniform(0.15, 1.0) if k % 2 else min(1.0, max(0.05, 0.12 + d / 30 + rng.gauss(0, 0.12))))
            v = judge(c)
            if v < best_v:
                best, best_v = c, v
        if level == "hard" and best_v > -10:
            for _ in range(14):
                c = (best[0] + rng.gauss(0, 4), max(0.03, min(1.0, best[1] + rng.gauss(0, 0.05))))
                v = judge(c)
                if v < best_v:
                    best, best_v = c, v
        sa, sp = BOT_SIG.get(level, BOT_SIG["normal"])
        ang = best[0] + rng.gauss(0, sa)
        power = max(0.03, min(1.0, best[1] + rng.gauss(0, sp)))
        return round(((ang + 180) % 360) - 180, 2), round(power, 3)

    def bot_ready(self):
        if self.between:
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_turn(self, p):
        i = self.seat(p)
        self.launch(i, *self.plan(i, p.bot))
