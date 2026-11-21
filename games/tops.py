"""Spin Tops: an original real-time spinning-top battle for 2–6 players in a shallow 3D bowl.

Before each round you pick a top (⚖️ Balanced, ⚔️ Attack, 🛡️ Defense or 🌀 Stamina: attack beats stamina, defense
beats attack, stamina outlasts defense). Each round starts with a launch: a power meter swings and you tap 🚀 to let
your top go (a better launch means more spin). Then steer with a virtual stick (or WASD), tap 💨 to dash (a dash that
lands a hit within half a second is a 💥 smash) and tap 🌀 Rev when its meter is full for a burst of spin (a bad rev
costs spin). Tops that collide bounce apart, and the slower-spinning top loses more spin. A top that runs out of spin
topples, and one knocked over the rim is out. Pickups pop up in the bowl: ⚡ spin, ⚓ heavy, 💨 turbo. Each round has
its own arena (🥣 classic, 🔵 bumpers, 🔥 closing ring, ❄️ ice) and after 28 s the rim heats up everywhere (sudden
death). The last top spinning takes the round; the knockout plays out in slow motion.

Server-owned physics like Snowball Scramble: frame(now) steps the bowl 30 times a second, the stick and buttons
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
SMASH_WIN, SMASH_KICK, SMASH_SAVE = 0.5, 1.6, 0.4   # a hit this soon after your dash: harder shove, you lose less
SMASH_PTS = 2               # a ring-out off a smash scores this instead of 1
SPARK_EVERY, SPARK_R, SPARK_GAIN, SPARK_LIFE = (5.0, 8.0), 0.55, 0.14, 7.0
PICKUPS = (("spin", 0.5), ("heavy", 0.25), ("turbo", 0.25))
HEAVY_T, HEAVY_MASS, HEAVY_KICK = 6.0, 2.2, 1.2
TURBO_T, TURBO_STEER, TURBO_V = 3.5, 1.45, 1.25
REV_PERIOD, REV_COOL, REV_GAIN, REV_MISS = 1.1, 7.0, 0.17, 0.035   # gain = REV_GAIN·m² − REV_MISS
LAUNCH, METER, BETWEEN = 3.0, 1.3, 3.5   # launch countdown, meter swing period, pause between rounds
ROUND_MAX = 45.0
HOT_DRAIN = 0.3             # spin lost per second outside the safe ring
HOT_ARENA = (3.0, 16.0, 0.45)       # 🔥 closing ring: starts, fully closed at (s after go), down to this × R
SUDDEN = (28.0, 40.0, 0.35)         # sudden death in every arena
ICE_DRAG, ICE_STEER = 0.3, 0.55
BUMP_R, BUMP_KICK = 0.38, 2.6
SLOW, SLOW_T = 0.3, 1.4     # the knockout that decides a round plays at this speed for this long (real seconds)
EVENT_KEEP = 0.6
# kind: (icon, name, kick dealt, mass, spin decay, steer, spin lost to hits)
TYPES = {
    "bal": ("⚖️", "Balanced", 1.05, 1.15, 1.0, 1.0, 1.0),
    "atk": ("⚔️", "Attack", 1.3, 0.9, 2.8, 1.12, 1.2),
    "def": ("🛡️", "Defense", 0.85, 1.6, 1.0, 0.9, 0.8),
    "sta": ("🌀", "Stamina", 0.95, 1.0, 0.3, 1.12, 1.0),
}
KINDS = list(TYPES)
COUNTER = {"atk": "def", "def": "sta", "sta": "atk", "bal": "atk"}
ARENAS = {"classic": ("🥣", "Classic bowl"), "bumpers": ("🔵", "Bumper bowl"), "hot": ("🔥", "Closing ring"),
          "ice": ("❄️", "Ice bowl")}
BOT = {  # reaction (s), aim error (rad), dash eagerness, launch (lo, hi), avoids the rim, rings out
    "easy": (0.42, 0.5, 0.3, (0.25, 0.75), False, False),
    "normal": (0.24, 0.25, 0.6, (0.5, 0.9), True, False),
    "hard": (0.12, 0.08, 1.0, (0.78, 1.0), True, True),
}


def meter(t, period=METER):
    """A swinging meter at t seconds: a triangle wave 0 → 1 → 0."""
    f = (t / period) % 1.0
    return 2 * f if f < 0.5 else 2 - 2 * f


class Top:
    # class defaults: tops pickled before #179 pick these up
    kind = "bal"
    rev_at = 0.0
    heavy_until = 0.0
    turbo_until = 0.0
    dashed_at = -99.0
    smash_by, smash_at = None, 0.0
    streak = 0

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
        "Before launch, compare the selected tops’ speed cap, mass, attack and full-spin lifetime. Arena hazards can shorten that lifetime.",
        "Pick your top before the launch: ⚔️ Attack hits hard but spins down fast, 🛡️ Defense is heavy, 🌀 Stamina spins longest, ⚖️ Balanced is in between. Attack beats Stamina, Defense beats Attack, Stamina outlasts Defense.",
        "Each round starts with a launch: tap 🚀 when the swinging meter is high. A better launch means more spin.",
        "Drag anywhere to steer (or WASD / arrows). Tap 💨 (or Space) to dash: hit someone within half a second for a 💥 smash.",
        "🌀 Rev (or R) when its meter is full for a burst of spin; a badly timed rev costs a little. It recharges in 7 s.",
        "Tops bounce off each other and the slower-spinning one loses more spin. Out of spin: you topple. Over the rim: you're out.",
        "Pickups: ⚡ spin, ⚓ heavy (hard to shift, hits harder), 💨 turbo (faster, dash ready). Each round has its own arena: 🥣 classic, 🔵 bumpers, 🔥 a closing ring, ❄️ ice. After 28 s the rim heats up everywhere.",
        "Last top spinning scores 3, the runner-up 1, and each ring-out you cause scores 1 (2 off a smash). Most points after the last round wins.",
    ]
    name = "Spin Tops"
    icon = "🌀"
    blurb = "A real-time 3D spinning-top battle: pick a top, launch, dash, smash and rev. Last top spinning wins."
    min_players = 2
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "flawless": ("💎", "Flawless", "Win every round"),
              "sweeper": ("🧹", "Sweeper", "Ring out two tops in one round"),
              "smasher": ("💥", "Smasher", "Ring a top out with a dash smash"),
              "clutch": ("😅", "Wobble win", "Win a round while your top wobbles"),
              "onfire": ("🔥", "On fire", "Win three rounds in a row")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5"), (3, "3"), (7, "7")], 5),
        "arena": ("Arenas", [("mix", "🎲 A new one each round"), ("classic", "🥣 Classic bowl only")], "mix"),
        "sparks": ("⚡ Pickups", [(True, "On"), (False, "Off")], True),
    }
    # games pickled before #179 pick these up
    arena = "classic"
    bumpers = ()
    slow_until = 0.0
    slow_left = None
    slow_at = (0.0, 0.0)
    duel_said = True
    arena_bag = ()

    def __setstate__(self, st):
        self.__dict__.update(st)
        self.__dict__["sparks"] = [list(s) + ["spin"] if len(s) < 5 else s for s in st.get("sparks", [])]
        self.__dict__.setdefault("bot_rev", [None] * len(st.get("seats", [])))

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.tops = [Top(0, 0) for _ in seated]
        self.round = 0
        self.rounds = int(self.s.get("rounds", 5))
        self.events, self.ev_seq = [], 0
        self.bot_next = [0.0] * len(seated)
        self.bot_dash = [0.0] * len(seated)
        self.bot_rev = [None] * len(seated)
        r = self.room
        r.turn = None
        r.deadline = None
        self.last = time.time()
        self.acc = 0.0
        self.frames = 0
        self.round_outs = [0] * len(seated)
        self.arena_bag = []
        r.add_log(f"🌀 Spin Tops: {self.rounds} rounds. Pick a top, launch, and be the last one spinning.", "big")
        self.new_round(time.time())

    def next_arena(self):
        if self.s.get("arena", "mix") == "classic":
            return "classic"
        if self.round == 1:
            return "classic"
        if not self.arena_bag:
            bag = ["bumpers", "hot", "ice", "classic"]
            self.rng.shuffle(bag)
            if bag[0] == self.arena and len(bag) > 1:
                bag.append(bag.pop(0))
            self.arena_bag = bag
        return self.arena_bag.pop(0)

    def new_round(self, now):
        self.round += 1
        self.mark_round()
        n = len(self.seats)
        self.arena = self.next_arena()
        self.bumpers = []
        if self.arena == "bumpers":
            k, off = (3 if n <= 3 else 4), self.rng.random() * math.tau
            self.bumpers = [(round(math.cos(off + math.tau * j / k) * R * 0.48, 2), round(math.sin(off + math.tau * j / k) * R * 0.48, 2)) for j in range(k)]
        off = self.rng.random() * math.tau
        for i, t in enumerate(self.tops):
            a = off + math.tau * i / n
            t.x, t.y = math.cos(a) * R * 0.62, math.sin(a) * R * 0.62
            t.vx = t.vy = t.sx = t.sy = 0.0
            t.spin, t.power = 0.0, None
            t.out = None if self.active(i) else "gone"
            t.dash_at, t.touch, t.touch_at = 0.0, None, 0.0
            t.rev_at = t.heavy_until = t.turbo_until = 0.0
            t.dashed_at, t.smash_by, t.smash_at = -99.0, None, 0.0
        self.round_outs = [0] * n
        self.order = []          # seats in the order they went out this round
        self.sparks = []         # [x, y, born, id, kind]
        self.spark_id = 0
        self.next_spark = 0.0
        self.stage = "launch"
        self.go_at = now + LAUNCH
        self.launch_at = now
        self.end_at = self.go_at + ROUND_MAX
        self.last = now
        self.result = None
        self.slow_until, self.slow_left, self.slow_at = 0.0, None, (0.0, 0.0)
        self.duel_said = n < 3
        self.bot_power = [None] * n
        for i in range(n):
            p = self.pl(i)
            if p and p.bot:
                lo, hi = BOT.get(p.bot, BOT["normal"])[3]
                self.bot_power[i] = random.uniform(lo, hi)
                self.tops[i].kind = self.bot_pick(i, p.bot)
        icon, name = ARENAS[self.arena]
        self.room.add_log(f"🌀 Round {self.round} of {self.rounds}: {icon} {name}. Get ready to launch!", "info")

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

    # -- a top's make-up right now

    def mass(self, t, now):
        return TYPES[t.kind][3] * (HEAVY_MASS if now < t.heavy_until else 1.0)

    def kick_of(self, t, now):
        return TYPES[t.kind][2] * (HEAVY_KICK if now < t.heavy_until else 1.0)

    def safe_r(self, now):
        """The safe ring's radius: outside it the rim is hot and drains spin (R + 1 when nothing is hot)."""
        if self.stage != "spin":
            return R + 1.0
        t = now - self.go_at
        r = R + 1.0
        if self.arena == "hot" and t > HOT_ARENA[0]:
            f = min(1.0, (t - HOT_ARENA[0]) / (HOT_ARENA[1] - HOT_ARENA[0]))
            r = R - R * (1 - HOT_ARENA[2]) * f
        if t > SUDDEN[0]:
            f = min(1.0, (t - SUDDEN[0]) / (SUDDEN[1] - SUDDEN[0]))
            r = min(r, R - R * (1 - SUDDEN[2]) * f)
        return r

    # -- input

    def act(self, p, a):
        raise GameError("Steer by dragging, and tap 💨 to dash.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        t = self.tops[i]
        k = a.get("pick")
        if k is not None:
            if k not in TYPES:
                raise GameError("Bad top.")
            if self.stage == "spin" and t.out is None:
                raise GameError("Pick your top before the launch.")
            t.kind = k
            self.event(time.time(), "pick", i, KINDS.index(k))
            return
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
            if b not in ("launch", "dash", "rev"):
                raise GameError("Bad button.")
            now = time.time()
            if b == "launch" or self.stage == "launch":
                self.launch(i, now)
            elif b == "rev":
                self.rev(i, now)
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
        t.dashed_at = now
        self.event(now, "dash", i)
        return True

    def rev_meter(self, now):
        return meter(now - self.go_at, REV_PERIOD)

    def rev(self, i, now, m=None):
        """🌀 Rev: a burst of spin, bigger the fuller the rev meter is (a bad one costs a little)."""
        t = self.tops[i]
        if self.stage != "spin" or t.out is not None or now < t.rev_at or self.slow_until:
            return False
        m = self.rev_meter(now) if m is None else m
        gain = REV_GAIN * m * m - REV_MISS
        t.spin = max(0.005, min(1.0, t.spin + gain))
        t.rev_at = now + REV_COOL
        self.event(now, "rev", i, round(m, 2))
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
        if self.slow_until:
            # the deciding knockout, in slow motion; then the round ends
            if now >= self.slow_until:
                self.round_over(now, self.slow_left)
                self.broadcast(now)
                return True
            self.move(dt * SLOW, now)
            self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]
            self.broadcast(now)
            return False
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated:
                self.bot_think(i, p.bot, now)
                self.bot_rev_tap(i, p.bot, now)
        before = sum(1 for i in range(len(self.tops)) if self.spinning(i))
        self.move(dt, now)
        self.tick_sparks(now)
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]
        left = [i for i in range(len(self.tops)) if self.spinning(i)]
        if len(left) == 2 and before > 2 and not self.duel_said:
            self.duel_said = True
            self.event(now, "duel", *left)
        if len(left) <= 1 and before >= 2 and self.order:
            # a knockout decided it: play it out slowly
            j = self.order[-1]
            self.slow_until, self.slow_left = now + SLOW_T, left
            self.slow_at = (round(self.tops[j].x, 2), round(self.tops[j].y, 2))
            self.event(now, "slow", left[0] if left else -1, j)
            self.broadcast(now)
            return False
        if len(left) <= 1 or now >= self.end_at:
            self.round_over(now, left)
            self.broadcast(now)
            return True
        self.broadcast(now)
        return False

    def go(self, now):
        self.stage = "spin"
        self.last = now
        self.next_spark = now + self.rng.uniform(*SPARK_EVERY) * 0.5
        for i, t in enumerate(self.tops):
            if t.out is not None:
                continue
            if t.power is None:   # never tapped: a weak launch
                t.power = 0.3
            t.spin = 0.62 + 0.38 * t.power
            t.rev_at = now + 2.0
            a = math.atan2(t.y, t.x) + math.pi / 2       # tops come off the launcher rolling round the bowl
            t.vx, t.vy = math.cos(a) * 1.2, math.sin(a) * 1.2
        self.event(now, "go")

    def move(self, dt, now):
        tops = self.tops
        ice = self.arena == "ice"
        drag = ICE_DRAG if ice else DRAG
        safe = self.safe_r(now)
        for i, t in enumerate(tops):
            if t.out is not None:
                continue
            if not self.active(i):
                t.out = "gone"
                continue
            ty = TYPES[t.kind]
            turbo = now < t.turbo_until
            d = math.hypot(t.x, t.y)
            grip = 0.35 + 0.65 * min(1.0, t.spin / WOBBLE) if t.spin < WOBBLE else 1.0
            st = STEER * grip * ty[5] * (ICE_STEER if ice else 1.0) * (TURBO_STEER if turbo else 1.0)
            ax, ay = t.sx * st, t.sy * st
            if d > 1e-6:
                pull = SLOPE * (d / R)
                ax -= t.x / d * pull
                ay -= t.y / d * pull
            t.vx += ax * dt
            t.vy += ay * dt
            k = math.exp(-drag * dt)
            t.vx *= k
            t.vy *= k
            v, vm = math.hypot(t.vx, t.vy), VMAX * (TURBO_V if turbo else 1.0)
            if v > vm:
                t.vx, t.vy = t.vx / v * vm, t.vy / v * vm
            t.x += t.vx * dt
            t.y += t.vy * dt
            t.spin = max(0.0, t.spin - DECAY * ty[4] * dt - (HOT_DRAIN * dt if d > safe else 0.0))
            for bx, by in self.bumpers:
                ex, ey = t.x - bx, t.y - by
                e = math.hypot(ex, ey)
                if e < BUMP_R + BODY and e > 1e-9:
                    nx, ny = ex / e, ey / e
                    t.x, t.y = bx + nx * (BUMP_R + BODY), by + ny * (BUMP_R + BODY)
                    vn = t.vx * nx + t.vy * ny
                    if vn < 0:
                        t.vx -= 2 * vn * nx
                        t.vy -= 2 * vn * ny
                        t.vx += nx * BUMP_KICK
                        t.vy += ny * BUMP_KICK
                        self.event(now, "bump", i, round(bx, 2), round(by, 2), round(min(3.0, -vn / 2 + 0.5), 2))
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
                ma, mb = self.mass(a, now), self.mass(b, now)
                # who drove into whom: the one charging in hits harder and loses less
                ua = max(0.0, a.vx * nx + a.vy * ny)
                ub = max(0.0, -(b.vx * nx + b.vy * ny))
                sa = now - a.dashed_at < SMASH_WIN and ua > 1.5
                sb = now - b.dashed_at < SMASH_WIN and ub > 1.5
                imp = -vn * 1.8 / (1 / ma + 1 / mb)     # (1 + e) with e = 0.8
                a.vx -= nx * imp / ma
                a.vy -= ny * imp / ma
                b.vx += nx * imp / mb
                b.vy += ny * imp / mb
                # each top's spin flings the other: the faster spinner shoves harder
                ka = KICK * a.spin * (1 + ATTACK * ua) * self.kick_of(a, now) * (SMASH_KICK if sa else 1.0)
                kb = KICK * b.spin * (1 + ATTACK * ub) * self.kick_of(b, now) * (SMASH_KICK if sb else 1.0)
                a.vx -= nx * kb / ma
                a.vy -= ny * kb / ma
                b.vx += nx * ka / mb
                b.vy += ny * ka / mb
                hit = min(HIT_MAX, -vn + 0.5)
                wa, wb = b.spin + ATTACK * ub, a.spin + ATTACK * ua    # what each one is hit with
                tot = (wa + wb) or 1.0
                da = DRAIN * hit * 2 * wa / tot * TYPES[a.kind][6] * (SMASH_SAVE if sa else 1.0)
                db = DRAIN * hit * 2 * wb / tot * TYPES[b.kind][6] * (SMASH_SAVE if sb else 1.0)
                a.spin = max(0.0, a.spin - da)
                b.spin = max(0.0, b.spin - db)
                a.touch, a.touch_at = j, now
                b.touch, b.touch_at = i, now
                if sa:
                    b.smash_by, b.smash_at = i, now
                if sb:
                    a.smash_by, a.smash_at = j, now
                self.event(now, "hit", i, j, round((a.x + b.x) / 2, 2), round((a.y + b.y) / 2, 2), round(min(3.0, hit), 2),
                           1 if sa else 2 if sb else 0)
        # outs (not during the slow-motion finish: the result is already decided)
        if self.slow_until:
            return
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
            smash = t.smash_by == by and now - t.smash_at < CREDIT
            pts = SMASH_PTS if smash else 1
            self.tops[by].points += pts
            self.tops[by].outs += 1
            self.round_outs[by] += 1
            self.event(now, "out", i, how, by, 1 if smash else 0)
            if smash:
                self.room.add_log(f"💥 {self.name_of(by)} SMASHES {self.name_of(i)} over the rim! (+{pts})", "power")
                if self.pl(by):
                    self.award(self.seats[by], "smasher")
            else:
                self.room.add_log(f"💥 {self.name_of(by)} rings out {self.name_of(i)}! (+1)", "power")
            if self.round_outs[by] == 2:
                if self.pl(by):
                    self.award(self.seats[by], "sweeper")
                self.moment(f"🧹 {self.name_of(by)} rings out two in one round!", "gold", "good")
        else:
            self.event(now, "out", i, how, -1 if by is None else by, 0)
            what = "flies over the rim" if how == "ring" else "topples over"
            self.room.add_log(f"🌀 {self.name_of(i)} {what}.", "info")

    def tick_sparks(self, now):
        if not self.s.get("sparks", True):
            return
        if now >= self.next_spark:
            self.next_spark = now + self.rng.uniform(*SPARK_EVERY)
            if len(self.sparks) < 3:
                a, d = self.rng.random() * math.tau, R * math.sqrt(self.rng.uniform(0.05, 0.55))
                x, y = math.cos(a) * d, math.sin(a) * d
                if not any(math.hypot(x - bx, y - by) < BUMP_R + SPARK_R + 0.3 for bx, by in self.bumpers):
                    roll, kind = self.rng.random(), "spin"
                    for k, w in PICKUPS:
                        if roll < w:
                            kind = k
                            break
                        roll -= w
                    self.spark_id += 1
                    self.sparks.append([round(x, 2), round(y, 2), now, self.spark_id, kind])
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
            kind = s[4] if len(s) > 4 else "spin"
            if kind == "heavy":
                t.heavy_until = now + HEAVY_T
            elif kind == "turbo":
                t.turbo_until = now + TURBO_T
                t.dash_at = 0.0
            else:
                t.spin = min(1.0, t.spin + SPARK_GAIN)
            self.event(now, "zap", got, s[0], s[1], kind)
        self.sparks = keep

    def round_over(self, now, left):
        # last spinning wins; if the clock ran out, the most spin wins and the rest go out in order of spin
        timeout = len(left) > 1
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
        for i, t in enumerate(self.tops):
            if i != win:
                t.streak = 0
        if win is not None:
            w = self.tops[win]
            w.points += 3
            w.wins += 1
            w.streak += 1
        if second is not None and len(self.seats) > 2:
            self.tops[second].points += 1
        self.result = [win, second if len(self.seats) > 2 else None]
        self.slow_until, self.slow_left = 0.0, None
        if win is not None:
            w = self.tops[win]
            self.room.add_log(f"🏆 {self.name_of(win)} is the last top spinning in round {self.round}! (+3)", "big")
            if self.round_outs[win] >= 1 and len(self.seats) > 2 and all(not self.active(i) or i == win or self.tops[i].out == "ring" for i in range(len(self.seats))):
                self.moment(f"🌀 {self.name_of(win)} clears the bowl!", "gold", "good")
            elif w.streak == 3:
                if self.pl(win):
                    self.award(self.seats[win], "onfire")
                self.moment(f"🔥 {self.name_of(win)} wins three rounds in a row!", "gold", "good")
            elif not timeout and w.spin < WOBBLE:
                if self.pl(win):
                    self.award(self.seats[win], "clutch")
                self.moment(f"😅 {self.name_of(win)} wins on a wobble!", "cool", "good")
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
        live = self.stage == "spin"
        return {
            "st": self.stage, "rd": self.round, "go": r(max(0.0, self.go_at - now)), "tl": r(max(0.0, self.end_at - now)),
            "mt": r(now - self.launch_at) if self.stage == "launch" else 0,
            "rt": r(now - self.go_at) if live else 0,
            "ar": self.arena, "bm": list(self.bumpers), "sr": r(min(R + 1.0, self.safe_r(now))),
            "sl": r(max(0.0, self.slow_until - now)) if self.slow_until else 0, "fx": list(self.slow_at),
            "t": [[r(t.x), r(t.y), r(t.vx), r(t.vy), round(t.spin, 3), {None: 0, "ring": 1, "topple": 2, "gone": 3}[t.out],
                   r(max(0.0, t.dash_at - now)), -1 if t.power is None else t.power, t.points,
                   KINDS.index(t.kind), r(max(0.0, t.rev_at - now)) if live else 0,
                   r(max(0.0, t.heavy_until - now)) if live else 0, r(max(0.0, t.turbo_until - now)) if live else 0,
                   t.streak] for t in self.tops],
            "sp": [[s[0], s[1], r(max(0.0, SPARK_LIFE - (now - s[2]))), s[3], s[4] if len(s) > 4 else "spin"] for s in self.sparks],
            "res": self.result,
        }

    def broadcast(self, now):
        d = self.state(now)
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.room.push_fast(d)

    # -- bots

    def bot_pick(self, i, level):
        """Easy bots pick at random; normal ones favour the all-rounders; hard ones counter the most common rival top."""
        if level == "easy":
            return random.choice(KINDS)
        rivals = [self.tops[j].kind for j in range(len(self.tops)) if j != i and self.active(j)]
        if level == "hard" and rivals:
            common = max(set(rivals), key=rivals.count)
            if random.random() < 0.7:
                return COUNTER[common]
        return random.choice(["bal", "bal", "atk", "def", "sta"])

    def bot_rev_tap(self, i, level, now):
        """Bots rev when their meter reaches the level they aim for (hard ones near the top)."""
        t = self.tops[i]
        if t.out is not None or now < t.rev_at or t.spin > 0.93:
            return
        if self.bot_rev[i] is None:
            lo, hi = BOT.get(level, BOT["normal"])[3]
            self.bot_rev[i] = random.uniform(lo, hi)
        if abs(self.rev_meter(now) - self.bot_rev[i]) < 0.04:
            if self.rev(i, now):
                self.bot_rev[i] = None

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
        edge_r = min(R, self.safe_r(now))
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
        heavy = now < me.heavy_until
        stronger = heavy or me.spin * TYPES[me.kind][2] >= t.spin * TYPES[t.kind][2] - (0.05 if level == "hard" else 0.1)
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
        # grab a pickup if one is near (spin when weaker, heavy and turbo any time); easy bots only by luck
        reach = {"easy": 1.5, "normal": 3.5, "hard": 5.0}.get(level, 3.5)
        for s in self.sparks:
            sd = math.hypot(s[0] - me.x, s[1] - me.y)
            kind = s[4] if len(s) > 4 else "spin"
            if sd < reach and (kind != "spin" or not stronger or me.spin < 0.6) and sd < dist + 0.5:
                gx, gy = (s[0] - me.x) / (sd or 1), (s[1] - me.y) / (sd or 1)
                break
        if rim and d0 > edge_r * 0.68:
            # too close to the rim (or the hot ring): head back in, harder the further out (and the faster you're heading out)
            outv = (me.vx * me.x + me.vy * me.y) / (d0 or 1)
            w = (d0 / edge_r - 0.68) * 6 + max(0.0, outv) * 0.3
            gx -= me.x / d0 * w
            gy -= me.y / d0 * w
        a = math.atan2(gy, gx) + random.gauss(0, err)
        m = min(1.0, math.hypot(gx, gy))
        me.sx, me.sy = math.cos(a) * m, math.sin(a) * m
        # dash at the target when lined up and close (a smash), unless it would carry me over the rim
        near = 2.4 if level == "hard" else 3.0
        if now >= me.dash_at and stronger and dist < near and random.random() < eager:
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

    def matchup_stats(self, arena, kind):
        _, _, attack, mass, decay, steer, _ = TYPES[kind]
        ice = arena == "ice"
        return {
            "speed": VMAX, "mass": mass, "attack": attack,
            "stamina": round(1 / (DECAY * decay), 1),
            "steering": round(steer * (ICE_STEER if ice else 1), 2),
        }

    def view(self, p):
        now = time.time()
        return {"tops": {
            **self.state(now), "seats": self.seats, "me": self.seat(p), "rounds": self.rounds,
            "R": R, "body": BODY, "meter": METER, "dashCool": DASH_COOL, "wobble": WOBBLE, "sparkR": SPARK_R,
            "seq": self.ev_seq, "steer": STEER, "slope": SLOPE, "drag": DRAG,
            "sparks": bool(self.s.get("sparks", True)),
            "revPeriod": REV_PERIOD, "revCool": REV_COOL, "bumpR": BUMP_R,
            "kinds": [[k, *TYPES[k][:2]] for k in KINDS],
            "matchups": {arena: [self.matchup_stats(arena, kind) for kind in KINDS] for arena in ARENAS},
            "arenaRules": {
                "classic": "Standard bowl", "bumpers": "Bumpers reflect tops",
                "hot": "Spin drains outside the closing ring", "ice": "Less drag and weaker steering",
            },
            "arenas": {k: list(v) for k, v in ARENAS.items()},
        }}
