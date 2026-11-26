"""Regatta: an original real-time sailing race for 2–6 players on a lake.

Everyone races round the same buoys at once. You steer (drag sideways, or ← →); the wind does the rest. A boat
sails fastest across the wind, a little slower with it behind, and can't sail straight into it: within about 40°
of the wind it stalls ("in irons"). So to get upwind you zig-zag, tacking from one side to the other; each tack
costs a little speed. ⟲ Tack turns you through the wind for you.

The wind shifts every so often, dark gust patches drift down the lake (+30 % wind inside), and a boat sitting in
another's wind shadow (just downwind of it) loses a quarter of its speed. Pass close by each buoy in order, then
cross the finish line. Finishing order scores 10/7/5/3/2/1; the race ends 20 s after the winner.

🏴‍☠️ Pirates (on by default, #176): every boat is a pirate sloop with a cannon each side. 💥 Fire shoots a broadside
at the nearest rival abeam (within 50° of straight out to the side, up to 32 m); the ball leads the target and lands
about a second later, so a sharp turn can dodge it. A hit knocks the wind out of the target's sails (speed halved,
2 s luffing, a slew off course) and then 5 s of cover from more hits. You hold up to 3 balls and reload one every 10 s
(the leader reloads slower, boats behind faster); floating powder kegs give one more. The pirate ship Black Jack
patrols one side of the first leg and fires at anyone who comes close; hit it to silence it for a while and plunder a ball.

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
# 🏴‍☠️ cannons (#176)
RANGE = 32.0          # a broadside reaches this far
ARC = math.radians(50)  # …within this of straight out to the side
BALL_V = 30.0         # m/s: a ball takes about a second to land
HIT_R = 3.0           # a ball landing this close to a hull hits it
NEAR_R = 7.0          # …this close is a near miss
AMMO_MAX, AMMO_START, RELOAD, FIRE_GAP = 3, 1, 10.0, 1.5
STUN, STUN_KEEP, STUN_SAIL, GUARD, SLEW = 2.0, 0.5, 0.35, 5.0, 0.35
KEG_R, KEG_BACK = 3.5, 25.0
NPC_R, NPC_LOOP, NPC_V, NPC_RANGE, NPC_RELOAD, NPC_QUIET, NPC_SD = 3.4, 14.0, 3.0, 28.0, 6.0, 15.0, 1.4
NPC_NAME = "Black Jack"
# bots: fire at targets within this share of the range and this far off the beam (degrees), with this chance a think
BOT_GUN = {"easy": (0.7, 40, 0.25), "normal": (0.8, 30, 0.3), "hard": (0.75, 22, 0.6)}


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
    goal = None                   # (boats pickled before #150 have no goal)
    ammo, reload, fire_at, stun, guard, hits, last_hit = 0, 0.0, 0.0, 0.0, 0.0, 0, 0.0   # (and before #176 no cannons)

    def __init__(self, x, y, h):
        self.x, self.y, self.h, self.v = x, y, h, 0.0
        self.steer = 0.0
        self.auto = None          # a heading the boat is turning to by itself (⟲ Tack)
        self.goal = None          # a heading the player pointed at (drag to steer, #150): the helm turns to it and holds
        self.mark = 0             # next buoy (len(marks) = the finish)
        self.done_at = 0.0
        self.place = 0
        self.pts = 0
        self.wins = 0
        self.side = 0             # which side the wind is on (+1 / -1), for spotting tacks
        self.irons = False
        self.shadow = False
        self.gust = False
        self.ammo = AMMO_START    # 🏴‍☠️ cannonballs ready
        self.reload = 0.0         # seconds toward the next one
        self.fire_at = 0.0        # no shot before this (one shot per FIRE_GAP)
        self.stun = 0.0           # sails knocked flat until this
        self.guard = 0.0          # no more hits until this
        self.hits = 0             # hits landed this race
        self.last_hit = 0.0


class Pirate:
    """Black Jack, the pirate ship that patrols one side of the first leg (not a racer)."""

    def __init__(self, cx, cy, d):
        self.cx, self.cy, self.d = cx, cy, d
        self.ang = 0.0
        self.x, self.y, self.h = cx + NPC_LOOP, cy, d * math.pi / 2
        self.fire_at = 0.0
        self.quiet = 0.0          # silenced (hit) until this


class Regatta(Game):
    id = "regatta"
    solo_bots = 3
    category = "action"
    family = None
    replayable = False
    tip_lines = 2
    howto = [
        "Everyone sails the same course at once. Drag sideways to point the boat (the white arrow shows where), or hold ◀ ▶. Follow the gold arrow to the next buoy.",
        "You can't sail into the red wedge (straight into the wind): you stall, in irons. Zig-zag upwind, tacking from side to side (⟲ Tack, or Space, does it for you).",
        "Round each buoy in order (pass close by it, the glowing one is next), then cross the finish line between the flags.",
        "Watch the wind arrow: it shifts. Dark gust patches give 30 % more wind; sailing just downwind of a rival's sail costs you a quarter of your speed.",
        "Finishing order scores 10/7/5/3/2/1; the race ends 20 s after the winner.",
        "🏴‍☠️ Pirates: 💥 Fire (or F) shoots a broadside at the nearest rival out to your side (red ring). A hit knocks the wind out of their sails. Balls reload every 10 s (faster when you're behind); grab floating 🛢 kegs for more, and steer clear of the pirate ship Black Jack.",
    ]
    name = "Regatta"
    icon = "⛵"
    blurb = "Race sailboats round the buoys: tack upwind, ride the gusts and steal a rival's wind."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "wire": ("🏁", "Wire to wire", "Lead at every buoy and win"),
              "shadow": ("🌬", "Wind thief", "Pass a rival while they sail in your wind shadow"),
              "gust": ("💨", "Gust rider", "Win a race in gusty wind"),
              "gunner": ("💥", "Master gunner", "Land 3 cannon hits in one race")}
    settings_schema = {
        "course": ("Course", [("normal", "3 buoys (~90 s)"), ("short", "2 buoys (~75 s)"), ("long", "4 buoys (~2 min)")], "normal"),
        "races": ("Races", [(1, "1"), (3, "3")], 1),
        "wind": ("Wind", [("steady", "🍃 Steady"), ("shifty", "🌬 Shifty & gusty")], "steady"),
        "pirates": ("Pirates", [("on", "🏴‍☠️ Pirate ships with cannons"), ("off", "⛵ Clean racing")], "on"),
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
        self.guns = self.s.get("pirates", "on") != "off"
        self.ball_seq = 0
        self.said = {}
        r = self.room
        r.turn = None
        r.deadline = None
        self.new_race(time.time())
        r.add_log(f"⛵ Regatta: {self.races} race{'s' if self.races > 1 else ''} round {LENGTHS.get(self.s.get('course', 'normal'), 3)} buoys. Mind the wind!", "big")

    def __setstate__(self, st):   # regattas saved before #176 have no cannons
        self.__dict__.update(st)
        d = self.__dict__
        d.setdefault("guns", False)
        d.setdefault("balls", [])
        d.setdefault("ball_seq", 0)
        d.setdefault("kegs", [])
        d.setdefault("npc", None)
        d.setdefault("ranks", [])
        d.setdefault("said", {})

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
            b = Boat(-22 + 44 * (i + 0.5) / n, -8.0, math.radians(90 + rng.choice((75, -75))))
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
        self.ranks = list(range(n))
        # 🏴‍☠️ a pirate ship off one side of the first leg, and a powder keg along each leg
        self.balls, self.kegs, self.npc = [], [], None
        if self.guns:
            m0 = self.course["marks"][0]
            d = rng.choice((-1, 1))
            self.npc = Pirate(m0[0] / 2 + d * rng.uniform(30, 36), m0[1] * rng.uniform(0.42, 0.55), d)
            self.npc.fire_at = self.go_at + 8.0
            pts = [(0.0, 0.0)] + [tuple(m) for m in self.course["marks"]]
            for k in range(len(pts) - 1):
                (ax, ay), (bx, by) = pts[k], pts[k + 1]
                t = rng.uniform(0.4, 0.6)
                L = math.hypot(bx - ax, by - ay) or 1
                side = rng.uniform(-10, 10)
                self.kegs.append([round(ax + (bx - ax) * t - (by - ay) / L * side, 1), round(ay + (by - ay) * t + (bx - ax) / L * side, 1), 0.0])

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
            b.goal = None
        hd = a.get("head")
        if hd is not None:
            if not isinstance(hd, (int, float)) or isinstance(hd, bool) or not math.isfinite(hd):
                raise GameError("Bad heading.")
            b.goal = wrap(float(hd))
            b.auto = None
            b.steer = 0.0
        if a.get("tack") is not None:
            if a["tack"] is not True:
                raise GameError("Bad tack.")
            self.tack(i)
        if a.get("fire") is not None:
            if a["fire"] is not True:
                raise GameError("Bad fire.")
            if not self.guns:
                raise GameError("No cannons in this regatta.")
            self.fire(i, time.time())

    def tack(self, i):
        """Turn through the wind (or, sailing downwind, gybe) to the same angle on the other side."""
        b = self.boats[i]
        # mirror the heading across the wind's line
        b.auto = wrap(2 * self.wind_to() - b.h)
        b.goal = None
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
        if self.guns:
            self.cannons(dt, now)
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
            elif b.goal is not None:
                d = wrap(b.goal - b.h)
                b.h = wrap(b.h + max(-rate * dt, min(rate * dt, d)))
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
            if now < b.stun:
                target *= STUN_SAIL           # 🏴‍☠️ hit: the sails hang torn and luffing
            b.irons = twa < NOGO
            k = ACCEL * dt * (1.0 if target > b.v else 1.6)
            b.v += (target - b.v) * min(1.0, k)
            helm = 0.6 if b.auto is not None else min(1.0, abs(wrap(b.goal - b.h)) / 0.35) if b.goal is not None else abs(b.steer)
            b.v -= helm * 0.25 * b.v * dt     # the rudder drags
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
        n = self.npc
        if n:
            for i, a in enumerate(bs):
                if not self.active(i):
                    continue
                dx, dy = a.x - n.x, a.y - n.y
                d = math.hypot(dx, dy)
                if d < BOAT_R + NPC_R:
                    if d < 1e-6:
                        dx, dy, d = 1.0, 0.0, 1.0
                    a.x += dx / d * (BOAT_R + NPC_R - d)
                    a.y += dy / d * (BOAT_R + NPC_R - d)
                    if now >= getattr(a, "bump_at", 0):
                        a.v *= 0.8
                        a.bump_at = now + 1.0
                        self.event(now, "bump", i, -1)

    # -- 🏴‍☠️ cannons (#176)

    def aim(self, i, now):
        """The rival boat i would fire at: (score, j, distance, side), j = -1 for the pirate ship; side +1 = to port
        (left of the bow), -1 = starboard. The nearest one roughly abeam, inside the range, not under cover."""
        b = self.boats[i]
        cands = [(j, o.x, o.y) for j, o in enumerate(self.boats) if j != i and self.active(j) and not o.done_at and now >= o.guard]
        n = self.npc
        if n and now >= n.quiet:
            cands.append((-1, n.x, n.y))
        best = None
        for j, x, y in cands:
            dx, dy = x - b.x, y - b.y
            d = math.hypot(dx, dy)
            if d < 4 or d > RANGE:
                continue
            rel = wrap(math.atan2(dy, dx) - b.h)
            off = abs(abs(rel) - math.pi / 2)
            if off > ARC:
                continue
            score = d + off * 12
            if best is None or score < best[0]:
                best = (score, j, d, 1 if rel > 0 else -1)
        return best

    def fire(self, i, now):
        """💥 A broadside from boat i at whoever it's aiming at (nothing happens without a target or a ball)."""
        b = self.boats[i]
        if self.stage != "race" or b.done_at or b.ammo <= 0 or now < b.fire_at:
            return False
        t = self.aim(i, now)
        if not t:
            return False
        _, j, d, side = t
        off = abs(abs(wrap(math.atan2(self.ty(j) - b.y, self.tx(j) - b.x) - b.h)) - math.pi / 2)
        b.ammo -= 1
        b.fire_at = now + FIRE_GAP
        sx, sy = b.x + math.cos(b.h + side * math.pi / 2) * 1.2, b.y + math.sin(b.h + side * math.pi / 2) * 1.2
        self.shoot(i, sx, sy, j, now, off * 2.5, side)     # a true broadside shoots straightest
        return True

    def tx(self, j):
        return self.npc.x if j < 0 else self.boats[j].x

    def ty(self, j):
        return self.npc.y if j < 0 else self.boats[j].y

    def shoot(self, src, sx, sy, j, now, extra, side):
        """A ball from (sx, sy) at boat j (-1 = the pirate ship), led to where the target will be when it lands."""
        if j < 0:
            n = self.npc
            tx, ty = n.x, n.y
            vx, vy = -math.sin(n.ang) * NPC_V * n.d, math.cos(n.ang) * NPC_V * n.d
        else:
            o = self.boats[j]
            tx, ty, vx, vy = o.x, o.y, math.cos(o.h) * o.v, math.sin(o.h) * o.v
        T = math.hypot(tx - sx, ty - sy) / BALL_V
        for _ in range(2):
            px, py = tx + vx * T, ty + vy * T
            T = math.hypot(px - sx, py - sy) / BALL_V
        T = max(0.35, T)
        d = math.hypot(px - sx, py - sy)
        sd = 1.0 + d * 0.08 + extra
        px += self.rng.gauss(0, sd)
        py += self.rng.gauss(0, sd)
        self.ball_seq += 1
        self.balls.append([self.ball_seq, sx, sy, px, py, now, now + T, src, j])
        self.event(now, "fire", src, side, round(sx, 2), round(sy, 2), round(px, 2), round(py, 2), round(T, 2))

    def say(self, key, gap, now, text, tone="gold", sound=None):
        """A moment, at most once per `gap` seconds for this key (cannon fire can come thick and fast)."""
        if now < self.said.get(key, 0) or now < self.said.get("", 0):
            return
        self.said[key] = now + gap
        self.said[""] = now + 6.0      # and no more than one every 6 s in all
        self.moment(text, tone, sound)

    def nm(self, j):
        return f"🏴‍☠️ {NPC_NAME}" if j < 0 else self.name_of(j)

    def rank_boats(self):
        live = [i for i in range(len(self.boats)) if self.active(i)]
        order = list(self.finished) + sorted((i for i in live if not self.boats[i].done_at), key=self.left_to_sail)
        self.ranks = [order.index(i) if i in order else len(order) for i in range(len(self.boats))]

    def cannons(self, dt, now):
        if self.steps % 15 == 0 or len(self.ranks) != len(self.boats):
            self.rank_boats()
        n_live = sum(1 for i in range(len(self.boats)) if self.active(i))
        for i, b in enumerate(self.boats):
            if not self.active(i) or b.done_at:
                continue
            # reloading: the leader slower, boats further back faster (a comeback weapon)
            if b.ammo < AMMO_MAX:
                rk = self.ranks[i] if i < len(self.ranks) else 0
                rate = 0.75 if rk == 0 and n_live > 1 else 1.0 + 0.12 * min(rk, 4)
                b.reload += dt * rate
                if b.reload >= RELOAD:
                    b.reload = 0.0
                    b.ammo += 1
            else:
                b.reload = 0.0
            for k in self.kegs:
                if now >= k[2] and b.ammo < AMMO_MAX and math.hypot(b.x - k[0], b.y - k[1]) < KEG_R + BOAT_R:
                    k[2] = now + KEG_BACK
                    b.ammo += 1
                    self.event(now, "keg", i)
        self.pirate(dt, now)
        keep = []
        for ball in self.balls:
            if now >= ball[6]:
                self.land(ball, now)
            else:
                keep.append(ball)
        self.balls = keep

    def pirate(self, dt, now):
        n = self.npc
        if not n:
            return
        n.ang = wrap(n.ang + n.d * NPC_V / NPC_LOOP * dt)
        n.x, n.y = n.cx + math.cos(n.ang) * NPC_LOOP, n.cy + math.sin(n.ang) * NPC_LOOP
        n.h = wrap(n.ang + n.d * math.pi / 2)
        if now < n.fire_at or now < n.quiet:
            return
        best = None
        for j, o in enumerate(self.boats):
            if not self.active(j) or o.done_at or now < o.guard:
                continue
            d = math.hypot(o.x - n.x, o.y - n.y)
            if d < NPC_RANGE and (best is None or d < best[0]):
                best = (d, j)
        if best:
            o = self.boats[best[1]]
            rel = wrap(math.atan2(o.y - n.y, o.x - n.x) - n.h)
            self.shoot(-1, n.x, n.y, best[1], now, NPC_SD, 1 if rel > 0 else -1)
            n.fire_at = now + NPC_RELOAD
        else:
            n.fire_at = now + 0.5

    def land(self, ball, now):
        _, sx, sy, x, y, t0, t1, src, aim = ball
        hit, near = None, None
        for j, o in enumerate(self.boats):
            if j == src or not self.active(j) or o.done_at:
                continue
            d = math.hypot(o.x - x, o.y - y)
            if d < HIT_R and (hit is None or d < hit[0]):
                hit = (d, j)
            elif d < NEAR_R and (near is None or d < near[0]):
                near = (d, j)
        n = self.npc
        if n and src >= 0 and math.hypot(n.x - x, n.y - y) < NPC_R + 1.2 and now >= n.quiet:
            n.quiet = now + NPC_QUIET
            b = self.boats[src]
            b.ammo = min(AMMO_MAX, b.ammo + 1)
            self.event(now, "sink", src, round(x, 2), round(y, 2))
            self.say("npc", 20, now, f"🏳 {self.name_of(src)} silences the pirate ship {NPC_NAME}! +1 cannonball", "good", "boom")
            return
        if hit:
            j = hit[1]
            o = self.boats[j]
            if now < o.guard:
                self.event(now, "splash", round(x, 2), round(y, 2), j)
                return
            self.strike(src, j, now)
            return
        self.event(now, "splash", round(x, 2), round(y, 2), near[1] if near else -1)
        if near and src >= 0 and near[0] < 4.5:
            self.say("near", 8, now, f"😅 Near miss! {self.name_of(src)}'s ball splashes right beside {self.name_of(near[1])}", "cool")

    def strike(self, src, j, now):
        """A ball hits boat j: the wind knocked out of its sails, a slew off course, then a few seconds of cover."""
        o = self.boats[j]
        o.v *= STUN_KEEP
        o.stun = now + STUN
        o.guard = now + GUARD
        if o.auto is None:
            o.h = wrap(o.h + self.rng.choice((-1, 1)) * SLEW)
        self.event(now, "hit", src, j, round(o.x, 2), round(o.y, 2))
        if src < 0:
            self.say("npchit", 6, now, f"🏴‍☠️ {NPC_NAME}'s guns hole {self.name_of(j)}!", "bad")
            return
        b = self.boats[src]
        b.hits += 1
        rk = self.ranks if len(self.ranks) == len(self.boats) else list(range(len(self.boats)))
        live = sum(1 for k in range(len(self.boats)) if self.active(k) and not self.boats[k].done_at)
        if b.hits == 3 and self.pl(src):
            self.award(self.pl(src), "gunner")
        if rk[j] == 0 and rk[src] >= 2 and rk[src] == max(rk[k] for k in range(len(self.boats)) if self.active(k)) and live >= 3:
            self.say("comeback", 6, now, f"🔥 Comeback cannon! {self.name_of(src)}, in last, knocks the leader {self.name_of(j)} flat!", "gold", "boom")
        elif now - b.last_hit < 10:
            self.say("double", 6, now, f"🎯 {self.name_of(src)} lands another broadside, on {self.name_of(j)}!", "gold", "boom")
        elif rk[j] == 0:
            self.say("lead", 6, now, f"💥 {self.name_of(src)} rakes the leader {self.name_of(j)} with a broadside!", "gold", "boom")
        else:
            self.say("hit", 6, now, f"💥 {self.name_of(src)} rakes {self.name_of(j)} with a broadside!", "cool", "boom")
        b.last_hit = now

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
                   int(b.irons), int(b.shadow), int(b.gust), b.pts, r(b.steer),
                   b.ammo, r(b.reload / RELOAD), r(max(0.0, b.stun - now)), r(max(0.0, b.guard - now))] for b in self.boats],
            "np": [r(self.npc.x), r(self.npc.y), round(self.npc.h, 3), r(max(0.0, self.npc.quiet - now))] if self.npc else None,
            "kg": [[k[0], k[1], int(now >= k[2])] for k in self.kegs],
            "bl": [[bl[0], r(bl[1]), r(bl[2]), r(bl[3]), r(bl[4]), r(now - bl[5]), r(bl[6] - bl[5]), bl[7]] for bl in self.balls],
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
        if self.guns and b.ammo > 0 and now >= b.fire_at:
            t = self.aim(i, now)
            reach, beam, keen = BOT_GUN.get(level, BOT_GUN["normal"])
            off = abs(abs(wrap(math.atan2(self.ty(t[1]) - b.y, self.tx(t[1]) - b.x) - b.h)) - math.pi / 2) if t else 9
            if t and t[2] < RANGE * reach and off < math.radians(beam) and random.random() < keen:
                # a sharp bot saves its shot for a rival ahead or close by (or the pirate ship)
                rk = self.ranks if len(self.ranks) == len(self.boats) else None
                if level != "hard" or t[1] < 0 or not rk or rk[t[1]] <= rk[i] + 1 or t[2] < 18:
                    self.fire(i, now)
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
        if self.guns and level != "easy" and b.ammo < AMMO_MAX:
            # a powder keg close to the way there: swing by it
            for kx, ky, back in self.kegs:
                if now >= back and math.hypot(kx - b.x, ky - b.y) < 22 and math.hypot(kx - tx, ky - ty) < math.hypot(b.x - tx, b.y - ty):
                    if abs(wrap(math.atan2(ky - b.y, kx - b.x) - math.atan2(ty - b.y, tx - b.x))) < 0.5:
                        tx, ty = kx, ky
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
        b.goal = None

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
            "guns": self.guns, "cannon": [RANGE, math.degrees(ARC), AMMO_MAX, RELOAD, HIT_R, NPC_R, NPC_RANGE],
        }}
