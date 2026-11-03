"""Hover Rally: an original real-time hover-craft race on a looping track generated each game.

The throttle is automatic: you only steer. Bends push you toward the outside, so you steer into
them; scraping a wall scrubs off speed. ⚡ Boost pads on the track give a burst of speed, and each
racer also has three boosts of their own. Tucking in close behind a rival puts you in their
slipstream, which lifts your top speed so you can pull out and pass. 🚀 Missile pickups (in races
of two or more) give one missile that homes in on the racer ahead; a hit knocks most of their speed
off and spins them for a moment. Craft that touch bump each other sideways. First across the line
after the last lap wins.

Server-owned like Sumo Saucers: the track is a closed curve sampled into points; each craft is a
position along it (s, in track units) and a sideways offset (d), so the simulation stays tiny.
frame(now) runs at 60 fps and positions stream to browsers over the room's fast channel, along with
the moments the browser turns into sparks, sounds and camera shake: bumps, boost-pad hits and
missile pickups, launches and hits."""
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
DRAFT_SPEED = 17.5        # top speed in a rival's slipstream
DRAFT_LEN, DRAFT_W = 7.0, 1.2   # the slipstream: this far behind a craft and this close sideways
MISSILE_SPEED, MISSILE_TURN, MISSILE_LIFE = 30.0, 3.0, 3.5   # units/s, sideways units/s, seconds
SPIN_SECS, SPIN_KEEP, SHIELD = 0.7, 0.35, 2.0   # a missile hit: no steering this long, speed drops to this share,
#                                              then no further hits for SHIELD seconds after the spin
PICKUP_RESPAWN = 4.0
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
    # defaults for races saved before these existed (rooms come back from data/rooms.pickle on restart)
    wall, pad, draft, missile, spin_until = False, None, False, False, 0.0

    def __init__(self, s, d):
        self.s, self.d, self.v = s, d, 0.0
        self.steer = 0.0
        self.boost_until = 0.0
        self.boosts = BOOSTS
        self.lap = 0
        self.finished = None   # finishing place
        self.finish_time = None
        self.wall = False      # scraping a wall right now
        self.pad = None        # the boost pad it's on, so each pad counts as one hit
        self.draft = False     # in someone's slipstream
        self.missile = False   # holding a missile
        self.spin_until = 0.0  # spinning from a missile hit


class Rally(Game):
    id = "rally"
    category = "action"
    howto = [
        "Your hover craft speeds up by itself — you only steer. Hold the left or right side of the screen, the arrows, or A / D.",
        "Bends push you toward the outside: steer into them. Scraping a wall slows you down.",
        "Glowing ⚡ pads on the track give a burst of speed. You also have 3 boosts of your own (⚡, Space or swipe up).",
        "Grab a 🚀 pickup to hold a missile, then fire it (🚀, F or swipe down): it homes in on the racer ahead and spins them out.",
        "Tuck in close behind a rival to ride their 💨 slipstream, then pull out and pass.",
        "Bump rivals sideways. First across the line after the last lap wins.",
    ]
    name = "Hover Rally"
    icon = "🛸"
    blurb = "Hover-craft racing on a new looping 3D track each game. Steer into the bends, hit the boost pads, fire homing missiles."
    min_players = 1
    max_players = 6
    replayable = False
    pickups, pickup_at, missiles = (), (), ()   # for races saved before missiles; start() sets real ones
    settings_schema = {
        "laps": ("Laps", [(3, "3"), (2, "2 (quick)"), (5, "5")], 3),
        "missiles": ("Missiles", [(True, "🚀 On"), (False, "Off (pure racing)")], True),
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
        # missile pickups: pairs across the track, between the boost pads (not in a solo time trial)
        self.pickups = []
        if n > 1 and self.s.get("missiles", True):
            for i in range(PAD_EVERY, SAMPLES, PAD_EVERY * 2):
                self.pickups += [(i, -1.2), (i, 1.2)]
        self.pickup_at = [0.0] * len(self.pickups)   # back on the track at this time
        self.missiles = []     # dicts: s, d, owner, target (craft index or None), until
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
        self.ev = []           # ["bump", i, j] / ["pad", i] / ["pick", i] / ["fire", i] / ["hit", victim, by] since the last broadcast
        self.touching = set()  # pairs in contact, so a long scrape alongside is one bump
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
        if a.get("fire") is True:
            self.fire(i, time.time())

    def boost(self, i, now):
        c = self.crafts[i]
        if self.stage == "race" and c.boosts > 0 and now >= c.boost_until and c.finished is None:
            c.boosts -= 1
            c.boost_until = now + BOOST_SECS

    def fire(self, i, now):
        c = self.crafts[i]
        if self.stage != "race" or not c.missile or c.finished is not None:
            return
        c.missile = False
        # aim at the nearest racer ahead (within half a lap); with nobody there it flies straight on
        ahead = [((o.s - c.s) % self.length, j) for j, o in enumerate(self.crafts)
                 if j != i and o.finished is None and self.active(j)]
        ahead = [x for x in ahead if x[0] < self.length / 2]
        self.missiles.append({"s": c.s + 1.2, "d": c.d, "owner": i, "target": min(ahead)[1] if ahead else None,
                              "until": now + MISSILE_LIFE})
        self.ev.append(["fire", i])

    def fly(self, dt, now):
        """Move each missile along the track, steering toward its target; it hits any rival it reaches."""
        half = self.length / 2
        for m in list(self.missiles):
            m["s"] += MISSILE_SPEED * dt
            t = m["target"]
            if t is not None and (self.crafts[t].finished is not None or not self.active(t)):
                t = m["target"] = None
            if t is not None:
                want = self.crafts[t].d - m["d"]
                m["d"] += max(-MISSILE_TURN * dt, min(MISSILE_TURN * dt, want))
            hit = None
            for j, c in enumerate(self.crafts):
                if j != m["owner"] and c.finished is None and self.active(j) and now >= c.spin_until + SHIELD:
                    ds = (c.s - m["s"] + half) % self.length - half
                    if abs(ds) < 1.0 and abs(c.d - m["d"]) < 1.1:
                        hit = j
                        break
            if hit is not None:
                c = self.crafts[hit]
                c.v *= SPIN_KEEP
                c.spin_until = now + SPIN_SECS
                c.boost_until = 0.0
                self.ev.append(["hit", hit, m["owner"]])
                by, who = self.room.players.get(self.seats[m["owner"]]), self.room.players.get(self.seats[hit])
                self.room.add_log(f"🚀 {by.name if by else '?'} hits {who.name if who else '?'}!")
            if hit is not None or now > m["until"]:
                self.missiles.remove(m)

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
                c.wall = False
                c.v = max(0.0, c.v - ACCEL * dt) if c.finished is not None else 0.0
                c.s += c.v * dt
                continue
            c.draft = self.drafting(i)
            top = BOOST_SPEED if now < c.boost_until else DRAFT_SPEED if c.draft else TOP_SPEED
            c.v = min(top, c.v + ACCEL * dt) if c.v < top else max(top, c.v - ACCEL * 0.6 * dt)
            k = self.curvature(c.s)
            # left is +d; a left bend (k > 0) pushes the craft right (outward); no steering while spinning
            steer = 0.0 if now < c.spin_until else c.steer
            c.d += (steer * STEER - k * c.v * c.v * PUSH) * dt
            c.wall = abs(c.d) > HALF_WIDTH - 0.35
            if c.wall:
                c.d = math.copysign(HALF_WIDTH - 0.35, c.d)
                c.v *= SCRAPE ** dt
            # the inside of a bend is a tighter curve, so it covers the track faster
            c.s += c.v * dt / max(0.6, 1 - k * c.d)
            # boost pads
            idx = self.index(c.s)
            on = None
            for pi_, lat in self.pads:
                if abs(idx - pi_) <= 2 and abs(c.d - lat) < 0.9:
                    c.boost_until = max(c.boost_until, now + 0.7)
                    on = pi_
            if on is not None and on != c.pad:
                self.ev.append(["pad", i])
            c.pad = on
            # missile pickups: one held at a time
            if not c.missile:
                for n_, (pi_, lat) in enumerate(self.pickups):
                    if now >= self.pickup_at[n_] and abs(idx - pi_) <= 2 and abs(c.d - lat) < 0.9:
                        c.missile = True
                        self.pickup_at[n_] = now + PICKUP_RESPAWN
                        self.ev.append(["pick", i])
                        break
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
        self.fly(dt, now)
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

    def drafting(self, i):
        """Is craft i close behind another racer (not finished) and roughly in line with it?"""
        c = self.crafts[i]
        for j, o in enumerate(self.crafts):
            if j != i and o.finished is None and self.active(j):
                ds = (o.s - c.s) % self.length
                if 2 * CRAFT < ds < DRAFT_LEN and abs(o.d - c.d) < DRAFT_W:
                    return True
        return False

    def bump(self):
        live = [i for i, c in enumerate(self.crafts) if c.finished is None and self.active(i)]
        touching = set()
        for a in range(len(live)):
            for b in range(a + 1, len(live)):
                p, q = self.crafts[live[a]], self.crafts[live[b]]
                ds = (p.s - q.s + self.length / 2) % self.length - self.length / 2
                dd = p.d - q.d
                pair = (live[a], live[b])
                # a pair stays "in contact" until it's clearly apart, so the push that separates it
                # for a frame doesn't make every frame of a scrape a new bump
                if pair in self.touching and abs(ds) < 2 * CRAFT * 1.4 + 1 and abs(dd) < 2 * CRAFT + 0.6:
                    touching.add(pair)
                if abs(ds) < 2 * CRAFT * 1.4 and abs(dd) < 2 * CRAFT:
                    touching.add(pair)
                    if pair not in self.touching:
                        self.ev.append(["bump", *pair])
                    push = (2 * CRAFT - abs(dd)) / 2 + 0.05
                    sgn = 1 if dd >= 0 else -1
                    p.d += sgn * push
                    q.d -= sgn * push
                    # the one behind loses a little speed
                    (q if ds > 0 else p).v *= 0.97
        self.touching = touching

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
        self.room.push_fast({"st": self.stage, "c": self.craft_rows(now), "e": self.ev, "m": self.missile_rows(), "pk": self.pickup_flags(now)})
        self.ev = []

    def craft_rows(self, now):
        """Each craft as [s, d, speed, boosting, boosts left, laps done, finishing place, scraping a wall,
        in a slipstream, holding a missile, spinning]."""
        r2 = lambda v: round(v, 2)
        return [[r2(c.s), r2(c.d), r2(c.v), int(now < c.boost_until), c.boosts, c.lap, c.finished or 0, int(c.wall), int(c.draft),
                 int(c.missile), int(now < c.spin_until)] for c in self.crafts]

    def missile_rows(self):
        """Each missile in flight as [s, d, target craft or -1]."""
        return [[round(m["s"], 2), round(m["d"], 2), -1 if m["target"] is None else m["target"]] for m in self.missiles]

    def pickup_flags(self, now):
        return [int(now >= t) for t in self.pickup_at]

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
        # normal and hard tuck into a slipstream on the straights; everyone pulls out to pass when close
        straight = all(abs(self.curvature(c.s + x)) < 0.02 for x in (3, 8, 14))
        for j, o in enumerate(self.crafts):
            if j != i and o.finished is None:
                ds = (o.s - c.s) % self.length
                if 0 < ds < 2.5 and abs(o.d - c.d) < 1.4:
                    target = o.d + (1.6 if o.d < 0 else -1.6)
                elif level != "easy" and straight and 2.5 <= ds < DRAFT_LEN - 1:
                    target = o.d
        # normal and hard sidestep a missile closing in on them
        if level != "easy" and any(m["target"] == i and 0 < (c.s - m["s"]) % self.length < 12 for m in self.missiles):
            if level == "hard" or random.random() < 0.5:
                target = c.d + (2.0 if c.d < 0 else -2.0)
        push = k * c.v * c.v * PUSH * skill
        c.steer = max(-1.0, min(1.0, (push + (target - c.d) * gain) / STEER + random.gauss(0, 0.08 if level == "easy" else 0.02)))
        # fire at a rival a little way ahead
        if c.missile and now >= c.spin_until:
            near = any(0 < (o.s - c.s) % self.length < 25 for j, o in enumerate(self.crafts) if j != i and o.finished is None)
            if near and random.random() < {"easy": 0.1, "normal": 0.25, "hard": 0.5}[level]:
                self.fire(i, now)
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
            "c": self.craft_rows(now), "pickups": self.pickups, "pk": self.pickup_flags(now), "m": self.missile_rows(),
            "countdown": max(0.0, self.next_at - now) if self.stage == "countdown" else 0,
            "top": TOP_SPEED,
        }}
