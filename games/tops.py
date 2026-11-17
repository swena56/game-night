"""Spin Tops: an original real-time spinning-top battle for 2–6 players in a shallow 3D bowl.

Each round starts with a launch: a power meter swings and you tap 🚀 to let your top go (a better launch means
more spin). Then steer with a virtual stick (or WASD) and tap 💨 to dash. Tops that collide bounce apart, and
the slower-spinning top loses more spin. A top that runs out of spin topples, and one knocked over the rim is
out. ⚡ Spark rings pop up in the bowl: roll over one for a burst of spin. The last top spinning takes the round.

Server-owned physics like Snowball Scramble: frame(now) steps the bowl 30 times a second, the stick and dash
arrive through on_input, and positions stream to browsers over the room's fast channel. Hits, ring-outs and
topples go out as numbered events, repeated for EVENT_KEEP seconds."""
import math
import random
import time

from .base import Game, GameError

R = 6.0                     # the bowl's rim radius
BODY = 0.5                  # a top's radius
STEP = 1 / 30
SLOPE = 3.4                 # the bowl pulls toward the middle this hard at the rim (units/s²), less further in
STEER = 7.0                 # stick acceleration at full spin
DRAG = 0.9                  # velocity loss per second (exponential)
VMAX = 9.0
DASH, DASH_COOL, DASH_COST = 5.5, 2.4, 0.04
DECAY = 0.014               # spin lost per second just by spinning
WOBBLE = 0.25               # below this a top wobbles: steering weakens
KICK = 2.8                  # how hard a top's spin flings what it hits (per unit of spin)
DRAIN = 0.014               # spin lost per unit of impact, split toward the slower top
ATTACK = 0.12              # charging into a hit: harder shove, less spin lost (per unit of approach speed)
HIT_MAX = 5.0
CREDIT = 2.5                # seconds a hit counts for a ring-out
SPARK_EVERY, SPARK_R, SPARK_GAIN, SPARK_LIFE = (6.0, 9.0), 0.55, 0.14, 7.0
LAUNCH, METER, BETWEEN = 3.0, 1.3, 3.5   # launch countdown, meter swing period, pause between rounds
ROUND_MAX = 45.0
EVENT_KEEP = 0.6
BOT = {  # reaction (s), aim error (rad), dash eagerness, launch (lo, hi), avoids the rim, rings out
    "easy": (0.42, 0.5, 0.3, (0.25, 0.75), False, False),
    "normal": (0.24, 0.25, 0.6, (0.5, 0.9), True, False),
    "hard": (0.12, 0.08, 1.0, (0.78, 1.0), True, True),
}


def meter(t):
    """The launch meter at t seconds into the countdown: a triangle wave 0 → 1 → 0."""
    f = (t / METER) % 1.0
    return 2 * f if f < 0.5 else 2 - 2 * f


class Top:
    def __init__(self, x, y):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.sx = self.sy = 0.0
        self.spin = 0.0
        self.power = None            # the launch meter where you tapped
        self.out = None              # None while spinning, else "ring" | "topple"
        self.out_at = 0.0
        self.dash_at = 0.0           # when the dash is ready again
        self.touch, self.touch_at = None, 0.0   # who hit me last, and when
        self.points = 0
        self.wins = 0
        self.outs = 0                # ring-outs caused (whole game)


class Tops(Game):
    id = "tops"
    category = "action"
    family = None
    howto = [
        "Each round starts with a launch: tap 🚀 when the swinging meter is high. A better launch means more spin.",
        "Drag anywhere to steer (or WASD / arrows). Tap 💨 (or Space) to dash. Everything slows as your spin runs down.",
        "Tops bounce off each other and the slower-spinning one loses more spin. Out of spin: you topple. Over the rim: you're out.",
        "⚡ Roll over a spark ring for a burst of spin.",
        "Last top spinning scores 3, the runner-up 1, and each ring-out you cause scores 1. Most points after the last round wins.",
    ]
    name = "Spin Tops"
    icon = "🌀"
    blurb = "A real-time 3D spinning-top battle: launch, steer, dash, knock rivals over the rim. Last top spinning wins."
    min_players = 2
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "flawless": ("💎", "Flawless", "Win every round"),
              "sweeper": ("🧹", "Sweeper", "Ring out two tops in one round")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5"), (3, "3"), (7, "7")], 5),
        "sparks": ("⚡ Spark rings", [(True, "On"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.tops = [Top(0, 0) for _ in seated]
        self.round = 0
        self.rounds = int(self.s.get("rounds", 5))
        self.events, self.ev_seq = [], 0
        self.bot_next = [0.0] * len(seated)
        self.bot_dash = [0.0] * len(seated)
        r = self.room
        r.turn = None
        r.deadline = None
        self.last = time.time()
        self.acc = 0.0
        self.frames = 0
        self.round_outs = [0] * len(seated)
        r.add_log(f"🌀 Spin Tops: {self.rounds} rounds. Last top spinning takes each one.", "big")
        self.new_round(time.time())

    def new_round(self, now):
        self.round += 1
        self.mark_round()
        n = len(self.seats)
        off = self.rng.random() * math.tau
        for i, t in enumerate(self.tops):
            a = off + math.tau * i / n
            t.x, t.y = math.cos(a) * R * 0.62, math.sin(a) * R * 0.62
            t.vx = t.vy = t.sx = t.sy = 0.0
            t.spin, t.power = 0.0, None
            t.out = None if self.active(i) else "gone"
            t.dash_at, t.touch, t.touch_at = 0.0, None, 0.0
        self.round_outs = [0] * n
        self.order = []          # seats in the order they went out this round
        self.sparks = []         # [x, y, born, id]
        self.spark_id = 0
        self.next_spark = 0.0
        self.stage = "launch"
        self.go_at = now + LAUNCH
        self.launch_at = now
        self.end_at = self.go_at + ROUND_MAX
        self.last = now
        self.result = None
        self.bot_power = [None] * n
        for i in range(n):
            p = self.pl(i)
            if p and p.bot:
                lo, hi = BOT.get(p.bot, BOT["normal"])[3]
                self.bot_power[i] = random.uniform(lo, hi)
        self.room.add_log(f"🌀 Round {self.round} of {self.rounds}: get ready to launch!", "info")

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

    def spinning(self, i):
        return self.tops[i].out is None and self.active(i)

    def event(self, now, *e):
        self.ev_seq += 1
        self.events.append((self.ev_seq, now, e))

    # -- input

    def act(self, p, a):
        raise GameError("Steer by dragging, and tap 💨 to dash.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        t = self.tops[i]
        sx, sy = a.get("sx"), a.get("sy")
        if sx is not None or sy is not None:
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (sx, sy)):
                raise GameError("Bad stick.")
            m = math.hypot(sx, sy)
            if m > 1:
                sx, sy = sx / m, sy / m
            t.sx, t.sy = sx, sy
        b = a.get("btn")
        if b is not None:
            if b not in ("launch", "dash"):
                raise GameError("Bad button.")
            now = time.time()
            if b == "launch" or self.stage == "launch":
                self.launch(i, now)
            else:
                self.dash(i, now)

    def launch(self, i, now, power=None):
        t = self.tops[i]
        if self.stage != "launch" or t.power is not None or t.out is not None:
            return False
        t.power = round(meter(now - self.launch_at) if power is None else power, 3)
        self.event(now, "launch", i, t.power)
        return True

    def dash(self, i, now, dx=None, dy=None):
        t = self.tops[i]
        if self.stage != "spin" or t.out is not None or now < t.dash_at:
            return False
        if dx is None:
            dx, dy = t.sx, t.sy
            if math.hypot(dx, dy) < 0.2:      # no stick: dash the way you're rolling
                dx, dy = t.vx, t.vy
        m = math.hypot(dx, dy)
        if m < 1e-6:
            return False
        k = DASH * (0.5 + 0.5 * min(1.0, t.spin / 0.6))
        t.vx += dx / m * k
        t.vy += dy / m * k
        t.spin = max(0.0, t.spin - DASH_COST)
        t.dash_at = now + DASH_COOL
        self.event(now, "dash", i)
        return True

    # -- the bowl

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view."""
        if self.room.phase != "playing":
            return False
        if self.stage == "launch":
            if now >= self.go_at:
                self.go(now)
                return True
            for i in range(len(self.tops)):
                bp = self.bot_power[i]
                if bp is not None and self.tops[i].power is None and abs(meter(now - self.launch_at) - bp) < 0.04:
                    self.launch(i, now)
            self.frames += 1
            if self.frames % 6 == 0:
                self.broadcast(now)
            return False
        if self.stage == "between":
            if now >= self.next_at:
                if self.round >= self.rounds:
                    self.end()
                else:
                    self.new_round(now)
                return True
            self.frames += 1
            if self.frames % 10 == 0:
                self.broadcast(now)
            return False
        if self.stage != "spin":
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
        self.move(dt, now)
        self.tick_sparks(now)
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]
        left = [i for i in range(len(self.tops)) if self.spinning(i)]
        if len(left) <= 1 or now >= self.end_at:
            self.round_over(now, left)
            self.broadcast(now)
            return True
        self.broadcast(now)
        return False

    def go(self, now):
        self.stage = "spin"
        self.last = now
        self.next_spark = now + self.rng.uniform(*SPARK_EVERY) * 0.6
        for i, t in enumerate(self.tops):
            if t.out is not None:
                continue
            if t.power is None:   # never tapped: a weak launch
                t.power = 0.3
            t.spin = 0.62 + 0.38 * t.power
            a = math.atan2(t.y, t.x) + math.pi / 2       # tops come off the launcher rolling round the bowl
            t.vx, t.vy = math.cos(a) * 1.2, math.sin(a) * 1.2
        self.event(now, "go")

    def move(self, dt, now):
        tops = self.tops
        for i, t in enumerate(tops):
            if t.out is not None:
                continue
            if not self.active(i):
                t.out = "gone"
                continue
            d = math.hypot(t.x, t.y)
            grip = 0.35 + 0.65 * min(1.0, t.spin / WOBBLE) if t.spin < WOBBLE else 1.0
            ax, ay = t.sx * STEER * grip, t.sy * STEER * grip
            if d > 1e-6:
                pull = SLOPE * (d / R)
                ax -= t.x / d * pull
                ay -= t.y / d * pull
            t.vx += ax * dt
            t.vy += ay * dt
            k = math.exp(-DRAG * dt)
            t.vx *= k
            t.vy *= k
            v = math.hypot(t.vx, t.vy)
            if v > VMAX:
                t.vx, t.vy = t.vx / v * VMAX, t.vy / v * VMAX
            t.x += t.vx * dt
            t.y += t.vy * dt
            t.spin = max(0.0, t.spin - DECAY * dt)
        # collisions
        for i, a in enumerate(tops):
            if a.out is not None:
                continue
            for j in range(i + 1, len(tops)):
                b = tops[j]
                if b.out is not None:
                    continue
                dx, dy = b.x - a.x, b.y - a.y
                d = math.hypot(dx, dy)
                if d >= 2 * BODY or d < 1e-9:
                    continue
                nx, ny = dx / d, dy / d
                over = (2 * BODY - d) / 2
                a.x -= nx * over
                a.y -= ny * over
                b.x += nx * over
                b.y += ny * over
                vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
                if vn >= 0:
                    continue        # already parting
                # who drove into whom: the one charging in hits harder and loses less
                ua = max(0.0, a.vx * nx + a.vy * ny)
                ub = max(0.0, -(b.vx * nx + b.vy * ny))
                imp = -vn * 0.9     # (1 + e) / 2 with e = 0.8, equal masses
                a.vx -= nx * imp
                a.vy -= ny * imp
                b.vx += nx * imp
                b.vy += ny * imp
                # each top's spin flings the other: the faster spinner shoves harder
                ka = KICK * a.spin * (1 + ATTACK * ua)
                kb = KICK * b.spin * (1 + ATTACK * ub)
                a.vx -= nx * kb
                a.vy -= ny * kb
                b.vx += nx * ka
                b.vy += ny * ka
                hit = min(HIT_MAX, -vn + 0.5)
                wa, wb = b.spin + ATTACK * ub, a.spin + ATTACK * ua    # what each one is hit with
                tot = (wa + wb) or 1.0
                a.spin = max(0.0, a.spin - DRAIN * hit * 2 * wa / tot)
                b.spin = max(0.0, b.spin - DRAIN * hit * 2 * wb / tot)
                a.touch, a.touch_at = j, now
                b.touch, b.touch_at = i, now
                self.event(now, "hit", i, j, round((a.x + b.x) / 2, 2), round((a.y + b.y) / 2, 2), round(min(3.0, hit), 2))
        # outs
        for i, t in enumerate(tops):
            if t.out is not None:
                continue
            if math.hypot(t.x, t.y) > R + 0.15:
                self.knock_out(i, "ring", now)
            elif t.spin <= 0.0:
                self.knock_out(i, "topple", now)

    def knock_out(self, i, how, now):
        t = self.tops[i]
        t.out, t.out_at = how, now
        t.sx = t.sy = 0.0
        by = t.touch if t.touch is not None and now - t.touch_at < CREDIT else None
        if how == "ring":
            t.vx, t.vy = t.vx * 0.5, t.vy * 0.5
        self.order.append(i)
        if by is not None and how == "ring" and self.tops[by].out is None:
            self.tops[by].points += 1
            self.tops[by].outs += 1
            self.round_outs[by] += 1
            self.event(now, "out", i, how, by)
            self.room.add_log(f"💥 {self.name_of(by)} rings out {self.name_of(i)}! (+1)", "power")
            if self.round_outs[by] == 2:
                if self.pl(by):
                    self.award(self.seats[by], "sweeper")
                self.moment(f"🧹 {self.name_of(by)} rings out two in one round!", "gold", "good")
        else:
            self.event(now, "out", i, how, -1 if by is None else by)
            what = "flies over the rim" if how == "ring" else "topples over"
            self.room.add_log(f"🌀 {self.name_of(i)} {what}.", "info")

    def tick_sparks(self, now):
        if not self.s.get("sparks", True):
            return
        if now >= self.next_spark:
            self.next_spark = now + self.rng.uniform(*SPARK_EVERY)
            a, d = self.rng.random() * math.tau, R * math.sqrt(self.rng.uniform(0.05, 0.55))
            self.spark_id += 1
            self.sparks.append([round(math.cos(a) * d, 2), round(math.sin(a) * d, 2), now, self.spark_id])
            self.event(now, "spark", self.spark_id)
        keep = []
        for s in self.sparks:
            if now - s[2] > SPARK_LIFE:
                continue
            got = None
            for i, t in enumerate(self.tops):
                if t.out is None and math.hypot(t.x - s[0], t.y - s[1]) < BODY + SPARK_R:
                    got = i
                    break
            if got is None:
                keep.append(s)
                continue
            t = self.tops[got]
            t.spin = min(1.0, t.spin + SPARK_GAIN)
            self.event(now, "zap", got, s[0], s[1])
        self.sparks = keep

    def round_over(self, now, left):
        # last spinning wins; if the clock ran out, the most spin wins and the rest go out in order of spin
        if len(left) > 1:
            for i in sorted(left, key=lambda i: self.tops[i].spin):
                if i != max(left, key=lambda i: self.tops[i].spin):
                    self.order.append(i)
            left = [max(left, key=lambda i: self.tops[i].spin)]
        win = left[0] if left else None
        second = None
        for i in reversed(self.order):
            if i != win and self.active(i):
                second = i
                break
        if win is not None:
            self.tops[win].points += 3
            self.tops[win].wins += 1
        if second is not None and len(self.seats) > 2:
            self.tops[second].points += 1
        self.result = [win, second if len(self.seats) > 2 else None]
        if win is not None:
            self.room.add_log(f"🏆 {self.name_of(win)} is the last top spinning in round {self.round}! (+3)", "big")
            if self.round_outs[win] >= 1 and len(self.seats) > 2 and all(not self.active(i) or i == win or self.tops[i].out == "ring" for i in range(len(self.seats))):
                self.moment(f"🌀 {self.name_of(win)} clears the bowl!", "gold", "good")
        else:
            self.room.add_log(f"🌀 Round {self.round}: nobody's left spinning.", "info")
        self.stage = "between"
        self.next_at = now + BETWEEN
        self.event(now, "round", -1 if win is None else win)

    def end(self):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.active(i)]
        self.stage = "done"
        if not here:
            return r.finish(None, "Everyone left.")
        key = lambda i: (self.tops[i].points, self.tops[i].wins, self.tops[i].outs)  # noqa: E731
        ranked = sorted(here, key=key, reverse=True)
        top = ranked[0]
        tied = [i for i in ranked if key(i) == key(top)]
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {self.tops[top].points} between {' & '.join(self.name_of(i) for i in tied)}.")
        if self.tops[top].wins == self.rounds and self.pl(top):
            self.award(self.seats[top], "flawless")
        pts = self.tops[top].points
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Spin Tops with {pts} point{'s' if pts != 1 else ''} ({self.tops[top].wins} round{'s' if self.tops[top].wins != 1 else ''})!")

    # -- streaming

    def state(self, now):
        r = lambda v: round(v, 2)  # noqa: E731
        return {
            "st": self.stage, "rd": self.round, "go": r(max(0.0, self.go_at - now)), "tl": r(max(0.0, self.end_at - now)),
            "mt": r(now - self.launch_at) if self.stage == "launch" else 0,
            "t": [[r(t.x), r(t.y), r(t.vx), r(t.vy), round(t.spin, 3), {None: 0, "ring": 1, "topple": 2, "gone": 3}[t.out],
                   r(max(0.0, t.dash_at - now)), -1 if t.power is None else t.power, t.points] for t in self.tops],
            "sp": [[s[0], s[1], r(max(0.0, SPARK_LIFE - (now - s[2]))), s[3]] for s in self.sparks],
            "res": self.result,
        }

    def broadcast(self, now):
        d = self.state(now)
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.room.push_fast(d)

    # -- bots

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, err, eager, _, rim, ringer = BOT.get(level, BOT["normal"])
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        me = self.tops[i]
        if me.out is not None:
            return
        rivals = [j for j, t in enumerate(self.tops) if j != i and t.out is None]
        if not rivals:
            me.sx = me.sy = 0.0
            return
        d0 = math.hypot(me.x, me.y)
        # who to go for: a weak spinner, or (hard) one near the rim that a shove would send over
        def appeal(j):
            t = self.tops[j]
            dist = math.hypot(t.x - me.x, t.y - me.y)
            edge = math.hypot(t.x, t.y) / R
            return (me.spin - t.spin) * 3 + (edge * 2.5 if ringer else 0) - dist * 0.25
        j = max(rivals, key=appeal)
        t = self.tops[j]
        # lead the target a little
        lead = 0.25 if level != "easy" else 0.0
        tx, ty = t.x + t.vx * lead, t.y + t.vy * lead
        dx, dy = tx - me.x, ty - me.y
        dist = math.hypot(dx, dy) or 1e-6
        stronger = me.spin >= t.spin - (0.05 if level == "hard" else 0.1)
        if stronger or level == "easy":
            gx, gy = dx / dist, dy / dist
            # come at it from the bowl's middle side so the hit points outward
            if ringer and dist > 1.6:
                ox, oy = t.x - me.x, t.y - me.y
                cx, cy = -t.x, -t.y
                cm = math.hypot(cx, cy) or 1
                wx, wy = t.x + cx / cm * 1.4 - me.x, t.y + cy / cm * 1.4 - me.y
                wm = math.hypot(wx, wy) or 1e-6
                if math.hypot(ox, oy) > 2.2:
                    gx, gy = wx / wm, wy / wm
        else:
            # weaker: keep away, circling the middle
            gx, gy = -dx / dist, -dy / dist
            gx, gy = gx - me.x / R * 0.9, gy - me.y / R * 0.9
            # grab a spark if one is near
            for s in self.sparks:
                sd = math.hypot(s[0] - me.x, s[1] - me.y)
                if sd < 4:
                    gx, gy = (s[0] - me.x) / (sd or 1), (s[1] - me.y) / (sd or 1)
                    break
        if rim and d0 > R * 0.68:
            # too close to the rim: head back in, harder the further out (and the faster you're heading out)
            outv = (me.vx * me.x + me.vy * me.y) / (d0 or 1)
            w = (d0 / R - 0.68) * 6 + max(0.0, outv) * 0.3
            gx -= me.x / d0 * w
            gy -= me.y / d0 * w
        a = math.atan2(gy, gx) + random.gauss(0, err)
        m = min(1.0, math.hypot(gx, gy))
        me.sx, me.sy = math.cos(a) * m, math.sin(a) * m
        # dash at the target when lined up and close, unless it would carry me over the rim
        if now >= me.dash_at and stronger and dist < 3.0 and random.random() < eager:
            aim = math.atan2(dy, dx) + random.gauss(0, err)
            ex, ey = me.x + math.cos(aim) * 2.5, me.y + math.sin(aim) * 2.5
            if not rim or math.hypot(ex, ey) < R * 0.85:
                self.dash(i, now, math.cos(aim), math.sin(aim))

    def bot_ready(self):
        return False   # bots think inside frame()

    # -- the rest of the contract

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} picked up their top and left.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")
        elif i is not None:
            self.tops[i].sx = self.tops[i].sy = 0.0

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "tops"):
            return ""
        return f"🌀 {self.tops[i].points}"

    def final_scores(self):
        if not hasattr(self, "tops"):
            return {}
        return {pid: self.tops[i].points for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"tops": {
            **self.state(now), "seats": self.seats, "me": self.seat(p), "rounds": self.rounds,
            "R": R, "body": BODY, "meter": METER, "dashCool": DASH_COOL, "wobble": WOBBLE, "sparkR": SPARK_R,
            "seq": self.ev_seq, "steer": STEER, "slope": SLOPE, "drag": DRAG,
            "sparks": bool(self.s.get("sparks", True)),
        }}
