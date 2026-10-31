"""Hover Rally: an original real-time hover-craft race on a looping track generated each game.

The throttle is automatic: you only steer. Bends push you toward the outside, so you steer into
them; scraping a wall scrubs off speed. ⚡ Boost pads on the track give a burst of speed, and each
racer also has three boosts of their own. Craft that touch bump each other sideways. First across
the line after the last lap wins.

Server-owned like Sumo Saucers: the track is a closed curve sampled into points; each craft is a
position along it (s, in track units) and a sideways offset (d), so the simulation stays tiny.
frame(now) runs at 60 fps and positions stream to browsers over the room's fast channel."""
import math
import random
import time

from .base import Game, GameError

SAMPLES = 720
HALF_WIDTH = 2.4          # track half-width
TOP_SPEED, BOOST_SPEED = 15.0, 23.0
ACCEL = 9.0
STEER = 7.5               # sideways units/s at full lock
PUSH = 0.3                # how hard bends push outward (× speed² × curvature)
SCRAPE = 0.3              # speed kept per second while touching a wall
BOOST_SECS, BOOSTS = 1.2, 3
PAD_EVERY = 90            # a boost pad every this many samples (roughly)
CRAFT = 0.7               # craft half-size for bumps
COUNTDOWN, FINISH_WAIT = 3.0, 15.0
BOT = {  # reaction (s), look-ahead (s), how well it counters the outward push, steering correction
    "easy": (0.45, 0.1, 0.5, 0.8),
    "normal": (0.15, 0.3, 0.85, 1.6),
    "hard": (0.04, 0.45, 1.0, 2.4),
}


def make_track(rng):
    """A smooth closed loop: wobbly control points round a circle, Catmull-Rom between them.
    Returns (points, lengths, total length, curvatures)."""
    while True:
        k = rng.randint(8, 11)
        ctrl = []
        for j in range(k):
            a = math.tau * j / k + rng.uniform(-0.18, 0.18)
            r = rng.uniform(30, 48)
            ctrl.append((math.cos(a) * r, math.sin(a) * r))
        pts = []
        per = SAMPLES // k
        for j in range(k):
            p0, p1, p2, p3 = ctrl[j - 1], ctrl[j], ctrl[(j + 1) % k], ctrl[(j + 2) % k]
            for t_ in range(per):
                t = t_ / per
                t2, t3 = t * t, t * t * t
                pts.append(tuple(0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
                                        + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3) for i in (0, 1)))
        n = len(pts)
        seg = [math.dist(pts[i], pts[(i + 1) % n]) for i in range(n)]
        curv = []
        for i in range(n):
            a = math.atan2(pts[(i + 1) % n][1] - pts[i][1], pts[(i + 1) % n][0] - pts[i][0])
            b = math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])
            turn = (a - b + math.pi) % math.tau - math.pi
            curv.append(turn / max(1e-6, (seg[i] + seg[i - 1]) / 2))
        # keep bends drivable: nothing tighter than a radius of about 10
        if max(abs(c) for c in curv) < 1 / 10:
            return pts, seg, sum(seg), curv


class Craft:
    def __init__(self, s, d):
        self.s, self.d, self.v = s, d, 0.0
        self.steer = 0.0
        self.boost_until = 0.0
        self.boosts = BOOSTS
        self.lap = 0
        self.finished = None   # finishing place
        self.finish_time = None


class Rally(Game):
    id = "rally"
    category = "action"
    howto = [
        "Your hover craft speeds up by itself — you only steer. Hold the left or right side of the screen, the arrows, or A / D.",
        "Bends push you toward the outside: steer into them. Scraping a wall slows you down.",
        "Glowing ⚡ pads on the track give a burst of speed. You also have 3 boosts of your own (⚡, Space or swipe up).",
        "Bump rivals sideways. First across the line after the last lap wins.",
    ]
    name = "Hover Rally"
    icon = "🛸"
    blurb = "Hover-craft racing on a new looping 3D track each game. Steer into the bends and hit the boost pads."
    min_players = 1
    max_players = 6
    replayable = False
    settings_schema = {
        "laps": ("Laps", [(3, "3"), (2, "2 (quick)"), (5, "5")], 3),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.pts, self.seg, self.length, self.curv = make_track(rng)
        self.cum = [0.0]
        for L in self.seg:
            self.cum.append(self.cum[-1] + L)
        # boost pads: (sample index, lateral centre)
        self.pads = []
        for i in range(PAD_EVERY // 2, SAMPLES, PAD_EVERY):
            if rng.random() < 0.75:
                self.pads.append((i + rng.randint(-8, 8), rng.choice((-1.3, 0.0, 1.3))))
        n = len(seated)
        # grid: two abreast, a few units apart, just behind the line
        self.crafts = [Craft(-2.0 - 2.2 * (i // 2), (-1.1 if i % 2 == 0 else 1.1) if n > 1 else 0.0) for i in range(n)]
        self.stage = "countdown"
        self.next_at = time.time() + COUNTDOWN
        self.started = None
        self.last_frame = time.time()
        self.frames = 0
        self.places = 0
        self.first_done = None
        self.bot_next = [0.0] * n
        self.room.turn = None
        self.room.deadline = None
        self.room.add_log(f"🛸 Hover Rally: {self.s['laps']} laps of a new track ({self.length:.0f} m). Get ready!", "big")

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- track helpers

    def index(self, s):
        """Sample index at track position s (any lap)."""
        s %= self.length
        lo, hi = 0, len(self.seg)
        while lo < hi - 1:  # binary search over cumulative lengths
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        return lo

    def curvature(self, s):
        return self.curv[self.index(s)]

    # -- input

    def act(self, p, a):
        raise GameError("Steer with the sides of the screen or the arrow keys.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this race.")
        c = self.crafts[i]
        st = a.get("steer")
        if st is not None:
            if not isinstance(st, (int, float)) or isinstance(st, bool) or not math.isfinite(st):
                raise GameError("Bad steer.")
            c.steer = max(-1.0, min(1.0, float(st)))
        if a.get("boost") is True:
            self.boost(i, time.time())

    def boost(self, i, now):
        c = self.crafts[i]
        if self.stage == "race" and c.boosts > 0 and now >= c.boost_until and c.finished is None:
            c.boosts -= 1
            c.boost_until = now + BOOST_SECS

    # -- simulation

    def frame(self, now):
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "race"
                self.started = now
                self.room.add_log("🟢 Go!")
                return True
            if self.frames % 6 == 0:
                self.broadcast(now)
            return False
        if self.stage != "race":
            return False
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and self.crafts[i].finished is None:
                self.bot_think(i, p.bot, now)
        changed = False
        for i, c in enumerate(self.crafts):
            p = self.room.players.get(self.seats[i])
            if c.finished is not None or not p or p.eliminated:
                c.v = max(0.0, c.v - ACCEL * dt) if c.finished is not None else 0.0
                c.s += c.v * dt
                continue
            top = BOOST_SPEED if now < c.boost_until else TOP_SPEED
            c.v = min(top, c.v + ACCEL * dt) if c.v < top else max(top, c.v - ACCEL * 0.6 * dt)
            k = self.curvature(c.s)
            # left is +d; a left bend (k > 0) pushes the craft right (outward)
            c.d += (c.steer * STEER - k * c.v * c.v * PUSH) * dt
            if abs(c.d) > HALF_WIDTH - 0.35:
                c.d = math.copysign(HALF_WIDTH - 0.35, c.d)
                c.v *= SCRAPE ** dt
            # the inside of a bend is a tighter curve, so it covers the track faster
            c.s += c.v * dt / max(0.6, 1 - k * c.d)
            # boost pads
            idx = self.index(c.s)
            for pi_, lat in self.pads:
                if abs(idx - pi_) <= 2 and abs(c.d - lat) < 0.9:
                    c.boost_until = max(c.boost_until, now + 0.7)
            # laps completed: the grid starts just behind the line, at s < 0
            lap = max(0, math.floor(c.s / self.length))
            if lap > c.lap:
                c.lap = lap
                if c.lap >= self.s["laps"]:
                    self.places += 1
                    c.finished = self.places
                    c.finish_time = now - self.started
                    self.room.add_log(f"🏁 {p.name} finishes {self.ordinal(self.places)} in {c.finish_time:.1f}s!",
                                      "big" if self.places == 1 else "power")
                    if self.first_done is None:
                        self.first_done = now
                    changed = True
        self.bump()
        racing = [i for i, c in enumerate(self.crafts) if c.finished is None and self.active(i)]
        if not racing or (self.first_done and now - self.first_done > FINISH_WAIT):
            self.end_race()
            return True
        if self.frames % 2 == 0:
            self.broadcast(now)
        return changed

    def active(self, i):
        p = self.room.players.get(self.seats[i])
        return bool(p and not p.eliminated)

    def bump(self):
        live = [c for i, c in enumerate(self.crafts) if c.finished is None and self.active(i)]
        for a in range(len(live)):
            for b in range(a + 1, len(live)):
                p, q = live[a], live[b]
                ds = (p.s - q.s + self.length / 2) % self.length - self.length / 2
                dd = p.d - q.d
                if abs(ds) < 2 * CRAFT * 1.4 and abs(dd) < 2 * CRAFT:
                    push = (2 * CRAFT - abs(dd)) / 2 + 0.05
                    sgn = 1 if dd >= 0 else -1
                    p.d += sgn * push
                    q.d -= sgn * push
                    # the one behind loses a little speed
                    (q if ds > 0 else p).v *= 0.97

    def end_race(self):
        r = self.room
        self.stage = "done"
        # unfinished craft are ranked by distance covered
        rest = sorted((i for i, c in enumerate(self.crafts) if c.finished is None), key=lambda i: -self.crafts[i].s)
        for i in rest:
            self.places += 1
            self.crafts[i].finished = self.places
        winner = min(range(len(self.crafts)), key=lambda i: self.crafts[i].finished)
        p = r.players.get(self.seats[winner])
        if len(self.seats) == 1:
            t = self.crafts[0].finish_time
            par = self.length * self.s["laps"] / (TOP_SPEED * 0.92)
            if t is not None and t <= par:
                return r.finish(p, f"🏆 {p.name} beats the target time: {t:.1f}s (target {par:.1f}s)!")
            return r.finish(None, f"🛸 {p.name if p else '?'} finished in {t:.1f}s; the target was {par:.1f}s." if t else "🛸 Race over.")
        r.finish(p, f"🏆 {p.name if p else '?'} wins Hover Rally!")

    @staticmethod
    def ordinal(n):
        return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")

    def broadcast(self, now):
        r2 = lambda v: round(v, 2)
        self.room.push_fast({
            "st": self.stage,
            "c": [[r2(c.s), r2(c.d), r2(c.v), int(now < c.boost_until), c.boosts, c.lap, c.finished or 0] for c in self.crafts],
        })

    # -- bots

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, ahead, skill, gain = BOT[level]
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        c = self.crafts[i]
        look = c.s + c.v * ahead
        k = self.curvature(look)
        # take the inside of the bend ahead; on straights head for a boost pad (hard) or the middle
        inside = {"easy": 0.6, "normal": 1.3, "hard": 1.8}[level]
        target = math.copysign(min(inside, abs(k) * 25), k) if abs(k) > 0.01 else 0.0
        if level == "hard":
            idx = self.index(look + 4)
            for pi_, lat in self.pads:
                if 0 <= (pi_ - idx) % SAMPLES <= 18:
                    target = lat
                    break
        # don't sit right behind someone
        for j, o in enumerate(self.crafts):
            if j != i and o.finished is None:
                ds = (o.s - c.s) % self.length
                if 0 < ds < 4 and abs(o.d - c.d) < 1.4:
                    target = o.d + (1.6 if o.d < 0 else -1.6)
        push = k * c.v * c.v * PUSH * skill
        c.steer = max(-1.0, min(1.0, (push + (target - c.d) * gain) / STEER + random.gauss(0, 0.08 if level == "easy" else 0.02)))
        straight = all(abs(self.curvature(c.s + x)) < 0.02 for x in (3, 8, 14))
        if level != "easy" and c.boosts and straight and now >= c.boost_until and random.random() < (0.05 if level == "hard" else 0.02):
            self.boost(i, now)

    # -- the rest of the contract

    def bot_ready(self):
        return False  # bots steer inside frame()

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the race.")
        left = r.contenders()
        if len(self.seats) > 1 and len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        if i is None:
            return ""
        c = self.crafts[i]
        return f"🏁 {self.ordinal(c.finished)}" if c.finished else f"Lap {min(c.lap + 1, self.s['laps'])}/{self.s['laps']}"

    def final_scores(self):
        return {pid: self.crafts[i].finished for i, pid in enumerate(self.seats) if self.crafts[i].finished}

    def view(self, p):
        now = time.time()
        r2 = lambda v: round(v, 2)
        return {"rally": {
            "seats": self.seats, "me": self.seat(p), "laps": self.s["laps"], "stage": self.stage,
            "track": [[r2(x), r2(y)] for x, y in self.pts], "length": self.length, "width": HALF_WIDTH,
            "pads": self.pads, "cum": [r2(v) for v in self.cum],
            "c": [[r2(c.s), r2(c.d), r2(c.v), int(now < c.boost_until), c.boosts, c.lap, c.finished or 0] for c in self.crafts],
            "countdown": max(0.0, self.next_at - now) if self.stage == "countdown" else 0,
            "top": TOP_SPEED,
        }}
