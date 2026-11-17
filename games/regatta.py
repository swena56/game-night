"""Regatta: an original real-time sailing race for 2–6 players on a lake.

Everyone races round the same buoys at once. You steer (drag sideways, or ← →); the wind does the rest. A boat
sails fastest across the wind, a little slower with it behind, and can't sail straight into it: within about 40°
of the wind it stalls ("in irons"). So to get upwind you zig-zag, tacking from one side to the other; each tack
costs a little speed. ⟲ Tack turns you through the wind for you.

The wind shifts every so often, dark gust patches drift down the lake (+30 % wind inside), and a boat sitting in
another's wind shadow (just downwind of it) loses a quarter of its speed. Pass close by each buoy in order, then
cross the finish line. Finishing order scores 10/7/5/3/2/1; the race ends 20 s after the winner.

The server sails the lake 30 times a second and streams it (as Paper Boat Rapids does).
"""
import math
import random
import time

from .base import Game, GameError

STEP = 1 / 30
SEND_EVERY = 2
COUNTDOWN = 4.0
GRACE = 20.0
BETWEEN = 7.0
BOAT_R = 2.2
MARK_R = 9.0          # pass within this of a buoy to round it
NOGO = 38.0           # degrees off the wind where a boat stalls
TURN = math.radians(55)
SPEED_K = 0.8         # boat speed = SPEED_K × wind × polar
ACCEL = 0.65          # how quickly speed follows its target (per second)
TACK_LOSS = 0.82      # speed kept through a tack
SHADOW_LEN, SHADOW_ANG, SHADOW_CUT = 28.0, math.radians(18), 0.25
GUST_UP = 0.3
POINTS = (10, 7, 5, 3, 2, 1)
LENGTHS = {"short": 2, "normal": 3, "long": 4}
EVENT_KEEP = 3.0
# reaction (s), heading noise (rad), uses gusts, tacks on the layline (vs. too early / late), oversteer
BOT = {"easy": (0.6, 0.22, False, 0.7, 1.6), "normal": (0.35, 0.1, False, 0.9, 1.2), "hard": (0.18, 0.04, True, 1.0, 1.0)}


def polar(twa):
    """Share of full speed at a true wind angle (degrees off the wind, 0..180)."""
    a = abs(twa)
    if a < NOGO:
        return 0.0
    if a < 45:
        return 0.7 * (a - NOGO) / (45 - NOGO)
    if a < 95:
        return 0.7 + 0.3 * (a - 45) / 50
    if a < 140:
        return 1.0 - 0.05 * (a - 95) / 45
    return 0.95 - 0.2 * (a - 140) / 40


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def make_course(rng, marks):
    """Start line at y = 0 (the wind comes from +y, north), buoys up the lake and back, finish by the start."""
    pts = []
    up = rng.uniform(105, 120)
    pts.append((rng.uniform(-20, 20), up))                                   # the windward mark
    if marks >= 3:
        pts.append((rng.choice((-1, 1)) * rng.uniform(40, 55), up * rng.uniform(0.45, 0.6)))   # a reach
    if marks >= 4:
        pts.append((rng.uniform(-20, 20), up * rng.uniform(0.8, 0.95)))      # back upwind
    pts.append((rng.uniform(-15, 15), rng.uniform(20, 30)))                  # the leeward mark
    return {"marks": [[round(x, 1), round(y, 1)] for x, y in pts], "start": [[-30.0, 0.0], [30.0, 0.0]],
            "finish": [[-22.0, -14.0], [22.0, -14.0]]}


class Boat:
    def __init__(self, x, y, h):
        self.x, self.y, self.h, self.v = x, y, h, 0.0
        self.steer = 0.0
        self.auto = None          # a heading the boat is turning to by itself (⟲ Tack)
        self.mark = 0             # next buoy (len(marks) = the finish)
        self.done_at = 0.0
        self.place = 0
        self.pts = 0
        self.wins = 0
        self.side = 0             # which side the wind is on (+1 / -1), for spotting tacks
        self.irons = False
        self.shadow = False
        self.gust = False


class Regatta(Game):
    id = "regatta"
    category = "action"
    family = None
    replayable = False
    howto = [
        "Everyone sails the same course at once. Drag sideways (or ← →) to steer; the wind fills your sail.",
        "You're fastest across the wind and can't sail straight into it: within about 40° you stall, in irons. Zig-zag upwind, tacking from side to side (⟲ Tack, or Space, does it for you).",
        "Round each buoy in order (pass close by it, the glowing one is next), then cross the finish line between the flags.",
        "Watch the wind arrow: it shifts. Dark gust patches give 30 % more wind; sailing just downwind of a rival's sail costs you a quarter of your speed.",
        "Finishing order scores 10/7/5/3/2/1; the race ends 20 s after the winner.",
    ]
    name = "Regatta"
    icon = "⛵"
    blurb = "Race sailboats round the buoys: tack upwind, ride the gusts and steal a rival's wind."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "wire": ("🏁", "Wire to wire", "Lead at every buoy and win"),
              "shadow": ("🌬", "Wind thief", "Pass a rival while they sail in your wind shadow"),
              "gust": ("💨", "Gust rider", "Win a race in gusty wind")}
    settings_schema = {
        "course": ("Course", [("normal", "3 buoys (~90 s)"), ("short", "2 buoys (~75 s)"), ("long", "4 buoys (~2 min)")], "normal"),
        "races": ("Races", [(1, "1"), (3, "3")], 1),
        "wind": ("Wind", [("steady", "🍃 Steady"), ("shifty", "🌬 Shifty & gusty")], "steady"),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(seated)
        self.boats = [Boat(0, 0, 0) for _ in range(n)]
        self.events, self.ev_seq = [], 0
        self.bot_next = [0.0] * n
        self.bot_plan = [None] * n
        self.race = 0
        self.races = int(self.s.get("races", 1)) if self.s.get("races", 1) in (1, 3) else 1
        self.results = []
        self.leads = [[] for _ in range(n)]
        r = self.room
        r.turn = None
        r.deadline = None
        self.new_race(time.time())
        r.add_log(f"⛵ Regatta: {self.races} race{'s' if self.races > 1 else ''} round {LENGTHS.get(self.s.get('course', 'normal'), 3)} buoys. Mind the wind!", "big")

    @property
    def shifty(self):
        return self.s.get("wind", "steady") == "shifty"

    def new_race(self, now):
        self.race += 1
        rng = self.rng
        self.course = make_course(rng, LENGTHS.get(self.s.get("course", "normal"), 3))
        n = len(self.boats)
        # boats line up behind the start line, sailing across the wind
        for i in range(n):
            b0 = self.boats[i]
            b = Boat(-22 + 44 * (i + 0.5) / n, -8.0, math.radians(90 + rng.choice((55, -55))))
            b.pts, b.wins = b0.pts, b0.wins
            b.v = 1.5
            self.boats[i] = b
        self.wind_base = math.pi / 2 + rng.uniform(-0.12, 0.12)     # the direction the wind comes FROM (north)
        self.wind_dir = self.wind_base
        self.wind_spd = rng.uniform(7.0, 8.5)
        self.shift_at = now + COUNTDOWN + rng.uniform(15, 25)
        self.shift_to = self.wind_dir
        self.gusts = []
        if self.shifty:
            for _ in range(4):
                self.gusts.append(self.new_gust(rng, rng.uniform(-20, 190)))
        self.stage = "countdown"
        self.go_at = now + COUNTDOWN
        self.cap_at = self.go_at + 60 * LENGTHS.get(self.s.get("course", "normal"), 3) + 30
        self.first_at = 0.0
        self.next_at = 0.0
        self.finished = []
        self.last = now
        self.acc = 0.0
        self.frames = 0
        self.steps = 0
        self.leads = [[] for _ in range(n)]

    def new_gust(self, rng, y=None):
        return [rng.uniform(-80, 80), 230.0 if y is None else y, rng.uniform(16, 26)]

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def active(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    def event(self, now, *e):
        self.ev_seq += 1
        self.events.append((self.ev_seq, now, e))

    # -- input

    def act(self, p, a):
        raise GameError("Steer by dragging, and tap ⟲ to tack.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this race.")
        b = self.boats[i]
        st = a.get("steer")
        if st is not None:
            if not isinstance(st, (int, float)) or isinstance(st, bool) or not math.isfinite(st):
                raise GameError("Bad steer.")
            b.steer = max(-1.0, min(1.0, float(st)))
            if abs(b.steer) > 0.2:
                b.auto = None
        if a.get("tack") is not None:
            if a["tack"] is not True:
                raise GameError("Bad tack.")
            self.tack(i)

    def tack(self, i):
        """Turn through the wind (or, sailing downwind, gybe) to the same angle on the other side."""
        b = self.boats[i]
        # mirror the heading across the wind's line
        b.auto = wrap(2 * self.wind_to() - b.h)
        if abs(wrap(b.auto - b.h)) < 0.05:
            b.auto = None

    def wind_to(self):
        """The direction the wind blows toward."""
        return wrap(self.wind_dir + math.pi)

    # -- the lake

    def wind_at(self, x, y, i=None):
        """(speed, gust, shadow) at a point; i = the boat asking (no shadow from itself)."""
        sp = self.wind_spd
        gust = any(math.hypot(x - gx, y - gy) < gr for gx, gy, gr in self.gusts)
        if gust:
            sp *= 1 + GUST_UP
        shadow = False
        to = self.wind_to()
        for j, o in enumerate(self.boats):
            if j == i or not self.active(j) or o.done_at:
                continue
            dx, dy = x - o.x, y - o.y
            d = math.hypot(dx, dy)
            if 2 < d < SHADOW_LEN and abs(wrap(math.atan2(dy, dx) - to)) < SHADOW_ANG:
                shadow = True
                break
        if shadow:
            sp *= 1 - SHADOW_CUT
        return sp, gust, shadow

    def frame(self, now):
        if self.room.phase != "playing":
            return False
        if self.stage == "countdown":
            # boats drift slowly on their lines during the countdown (nobody crosses early)
            if now >= self.go_at:
                self.stage = "race"
                self.last = now
                return True
            self.frames += 1
            if self.frames % 6 == 0:
                self.broadcast(now)
            return False
        if self.stage == "results":
            if now >= self.next_at:
                self.new_race(now)
                return True
            self.frames += 1
            if self.frames % 15 == 0:
                self.broadcast(now)
            return False
        self.acc += max(0.0, min(0.1, now - self.last))
        self.last = now
        if self.acc < STEP:
            return False
        dt = min(0.05, self.acc)
        self.acc = 0.0
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated:
                self.bot_think(i, p.bot, now)
        self.sail(dt, now)
        self.collide(now)
        self.weather(dt, now)
        self.steps += 1
        if self.race_over(now):
            self.end_race(now)
            return True
        if self.steps % SEND_EVERY == 0:
            self.broadcast(now)
        return False

    def weather(self, dt, now):
        rng = self.rng
        if now >= self.shift_at:
            amp = 0.35 if self.shifty else 0.16
            self.shift_to = self.wind_base + rng.uniform(-amp, amp)
            self.shift_at = now + rng.uniform(16, 24)
            self.event(now, "shift", round(math.degrees(wrap(self.shift_to - self.wind_dir))))
        self.wind_dir += max(-0.08 * dt, min(0.08 * dt, wrap(self.shift_to - self.wind_dir)))
        to = self.wind_to()
        for g in self.gusts:
            g[0] += math.cos(to) * 4.5 * dt
            g[1] += math.sin(to) * 4.5 * dt
            if g[1] < -60:
                g[:] = self.new_gust(rng)

    def sail(self, dt, now):
        to = self.wind_to()
        for i, b in enumerate(self.boats):
            if not self.active(i):
                continue
            if b.done_at:
                b.v *= 1 - 0.8 * dt
                b.x += math.cos(b.h) * b.v * dt
                b.y += math.sin(b.h) * b.v * dt
                continue
            # the helm: an auto tack, or the player's rudder
            rate = TURN * (0.45 + 0.55 * min(1.0, b.v / 4.5))
            if b.auto is not None:
                d = wrap(b.auto - b.h)
                turn = max(-rate * dt, min(rate * dt, d))
                b.h = wrap(b.h + turn)
                if abs(d) < 0.03:
                    b.auto = None
            else:
                b.h = wrap(b.h + b.steer * rate * dt)
            # the wind on the sail
            off = wrap(b.h - (to + math.pi))           # heading relative to straight into the wind
            twa = math.degrees(abs(off))
            side = 1 if off > 0 else -1
            if b.side and side != b.side and twa < 90:
                b.v *= TACK_LOSS
                self.event(now, "tack", i)
            b.side = side
            sp, b.gust, b.shadow = self.wind_at(b.x, b.y, i)
            target = SPEED_K * sp * polar(twa)
            b.irons = twa < NOGO
            k = ACCEL * dt * (1.0 if target > b.v else 1.6)
            b.v += (target - b.v) * min(1.0, k)
            b.v -= abs(b.steer if b.auto is None else 0.6) * 0.25 * b.v * dt     # the rudder drags
            b.v = max(0.0, b.v)
            vx, vy = math.cos(b.h) * b.v, math.sin(b.h) * b.v
            if b.irons:
                # stalled: pushed backwards and sideways by the wind
                vx += math.cos(to) * 0.6
                vy += math.sin(to) * 0.6
            b.x += vx * dt
            b.y += vy * dt
            self.progress(i, b, now)

    def progress(self, i, b, now):
        marks = self.course["marks"]
        if b.mark < len(marks):
            mx, my = marks[b.mark]
            if math.hypot(b.x - mx, b.y - my) < MARK_R:
                b.mark += 1
                ahead = sum(1 for o in self.boats if o.mark >= b.mark and o is not b)
                self.leads[i].append(ahead == 0)
                self.event(now, "mark", i, b.mark)
                if ahead == 0 and b.mark == 1:
                    self.moment(f"⛵ {self.name_of(i)} rounds the first buoy in the lead!", "good")
            return
        (ax, ay), (bx, by) = self.course["finish"]
        if ax <= b.x <= bx and b.y <= ay:
            b.done_at = now
            self.finished.append(i)
            place = len(self.finished)
            b.place = place
            t = now - self.go_at
            self.event(now, "finish", i, place)
            if place == 1:
                self.first_at = now
                self.room.add_log(f"🏁 {self.name_of(i)} wins race {self.race} in {t:.1f} s!", "big")
                self.moment(f"🏁 {self.name_of(i)} takes the gun!", "gold", "fanfare")
                if self.leads[i] and all(self.leads[i]) and self.pl(i):
                    self.award(self.pl(i), "wire")
                if self.shifty and self.pl(i):
                    self.award(self.pl(i), "gust")
            else:
                self.room.add_log(f"🏁 {self.name_of(i)} finishes {place}{'nd' if place == 2 else 'rd' if place == 3 else 'th'}.")

    def collide(self, now):
        bs = self.boats
        for i in range(len(bs)):
            a = bs[i]
            if not self.active(i):
                continue
            for j in range(i + 1, len(bs)):
                c = bs[j]
                if not self.active(j):
                    continue
                dx, dy = c.x - a.x, c.y - a.y
                d = math.hypot(dx, dy)
                if d < 2 * BOAT_R:
                    if d < 1e-6:
                        dx, dy, d = 1.0, 0.0, 1.0
                    push = (2 * BOAT_R - d) / 2
                    a.x -= dx / d * push
                    a.y -= dy / d * push
                    c.x += dx / d * push
                    c.y += dy / d * push
                    # a bump costs a little speed once (not every frame two boats touch)
                    if now >= getattr(a, "bump_at", 0) and now >= getattr(c, "bump_at", 0):
                        a.v *= 0.85
                        c.v *= 0.85
                        a.bump_at = c.bump_at = now + 1.0
                        self.event(now, "bump", i, j)

    def race_over(self, now):
        live = [i for i in range(len(self.boats)) if self.active(i)]
        if not live or all(self.boats[i].done_at for i in live):
            return True
        if self.first_at and now >= self.first_at + GRACE:
            return True
        return now >= self.cap_at

    def left_to_sail(self, i):
        """Metres still to go for boat i (for ordering the boats that didn't finish)."""
        b = self.boats[i]
        marks = self.course["marks"]
        pts = [(b.x, b.y)] + [tuple(m) for m in marks[b.mark:]] + [(0.0, self.course["finish"][0][1])]
        return sum(math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) for k in range(len(pts) - 1))

    def end_race(self, now):
        live = [i for i in range(len(self.boats)) if self.active(i)]
        rest = sorted((i for i in live if not self.boats[i].done_at), key=self.left_to_sail)
        order = list(self.finished) + rest
        for n, i in enumerate(order):
            b = self.boats[i]
            b.place = n + 1
            b.pts += POINTS[n] if n < len(POINTS) else 0
        if order:
            self.boats[order[0]].wins += 1
        self.results.append([[i, round(self.boats[i].done_at - self.go_at, 2) if self.boats[i].done_at else None] for i in order])
        self.event(now, "results", self.race)
        if self.race >= self.races or not live:
            self.broadcast(now)
            return self.end()
        self.room.add_log(f"🏁 Race {self.race}: " + ", ".join(f"{n + 1}. {self.name_of(i)}" for n, i in enumerate(order)))
        self.stage = "results"
        self.next_at = now + BETWEEN
        self.broadcast(now)

    def end(self):
        r = self.room
        self.stage = "done"
        here = [i for i in range(len(self.seats)) if self.active(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        key = lambda i: (self.boats[i].pts, self.boats[i].wins)  # noqa: E731
        ranked = sorted(here, key=key, reverse=True)
        top = ranked[0]
        tied = [i for i in ranked if key(i) == key(top)]
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {self.boats[top].pts} points between {' & '.join(self.name_of(i) for i in tied)}.")
        if self.races == 1:
            t = self.results[-1][0][1]
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins the regatta{f' in {t:.1f} s' if t else ''}!")
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins the regatta with {self.boats[top].pts} points!")

    # -- streaming

    def state(self, now):
        r = lambda v: round(v, 2)  # noqa: E731
        return {
            "st": self.stage, "race": self.race, "go": r(max(0.0, self.go_at - now)), "rt": r(max(0.0, now - self.go_at)),
            "gr": r(max(0.0, self.first_at + GRACE - now)) if self.first_at and self.stage == "race" else -1,
            "nx": r(max(0.0, self.next_at - now)) if self.stage == "results" else -1,
            "w": [round(self.wind_dir, 3), r(self.wind_spd)],
            "g": [[r(x), r(y), r(rr)] for x, y, rr in self.gusts],
            "b": [[r(b.x), r(b.y), round(b.h, 3), r(b.v), b.mark, b.place if b.done_at or self.stage != "race" else 0,
                   int(b.irons), int(b.shadow), int(b.gust), b.pts, r(b.steer)] for b in self.boats],
        }

    def broadcast(self, now):
        d = self.state(now)
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]
        self.room.push_fast(d)

    # -- bots: aim at the next buoy, or sail close-hauled on the tack that gets there, and tack on the layline

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, noise, gusty, layline, over = BOT.get(level, BOT["normal"])
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        b = self.boats[i]
        if b.done_at or self.stage != "race":
            b.steer = 0.0
            return
        marks = self.course["marks"]
        if b.mark < len(marks):
            tx, ty = marks[b.mark]
        else:
            (ax, ay), (bx, by) = self.course["finish"]
            tx, ty = max(ax + 4, min(bx - 4, b.x)), ay - 6
        if gusty and self.gusts:
            # lean toward a gust that's on the way
            for gx, gy, gr in self.gusts:
                if math.hypot(gx - b.x, gy - b.y) < 45 and math.hypot(gx - tx, gy - ty) < math.hypot(b.x - tx, b.y - ty):
                    tx, ty = tx * 0.8 + gx * 0.2, ty * 0.8 + gy * 0.2
                    break
        want = math.atan2(ty - b.y, tx - b.x)
        into = self.wind_dir                                  # heading straight into the wind
        close = math.radians(NOGO + 7 + 4 * (1 - layline))
        off = wrap(want - into)
        if abs(off) < close:
            # upwind: sail close-hauled on the side the buoy is on, and tack once the other side points at it
            side = b.side or (1 if off > 0 else -1)
            cur = wrap(into + side * close)
            # keep this tack while the buoy is on this side of the wind; tack once the other tack's heading reaches it
            # (a less able bot tacks early, short of the layline, and needs more tacks)
            if (off > 0) != (side > 0) and abs(off) > close * layline - 0.03 and b.auto is None and b.v > 1.2:
                self.tack(i)
                return
            want = cur
        elif abs(wrap(want - (into + math.pi))) < math.radians(18):
            # dead downwind is slow: sail a little off it
            want = wrap(into + math.pi + (b.side or 1) * math.radians(25))
        want += random.gauss(0, noise)
        if b.auto is not None:
            return
        d = wrap(want - b.h)
        b.steer = max(-1.0, min(1.0, d * 2.4 * over))

    def bot_ready(self):
        return False   # bots think inside frame()

    # -- the rest

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} sailed home.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")
        elif i is not None:
            self.boats[i].steer = 0.0

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "boats"):
            return ""
        b = self.boats[i]
        return f"⛵ {b.pts}" if self.races > 1 else (f"🏁 {b.place}" if b.place else "")

    def final_scores(self):
        return {pid: self.boats[i].pts for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"regatta": {
            **self.state(now), "seats": self.seats, "me": self.seat(p), "races": self.races, "course": self.course,
            "boatR": BOAT_R, "markR": MARK_R, "nogo": NOGO, "seq": self.ev_seq, "results": self.results,
            "shadow": [SHADOW_LEN, math.degrees(SHADOW_ANG)], "polar": [polar(a) for a in range(0, 181, 5)], "speedK": SPEED_K,
        }}
