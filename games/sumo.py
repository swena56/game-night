"""Sumo Saucers: an original real-time arena game. Everyone pilots a hover saucer on a round platform
floating in space. Steer with a virtual stick (momentum carries you), and 💨 dash for a big shove.
Knock rivals off the edge: the last saucer on the platform wins the round, and the first to the
target number of rounds wins the match.

The rim is lined with glowing bumpers. A bumper bounces a saucer back onto the platform once, then
shatters, so the edge gets more dangerous as the round goes on. The platform also shrinks every
SHRINK_EVERY seconds (with a warning first), and a round that drags on past SQUEEZE_AFTER turns into
sudden death: the bumpers go and the platform keeps shrinking.

Power-up orbs appear on the platform (🪨 heavy, ⚡ shockwave, 🔁 turbo dash, 🛡️ shield), and a saucer
that's been knocked out comes back as a 👻 ghost that drops ☄️ meteors on the ones still floating.

Server-owned physics like Air Hockey: frame(now) (60 fps) integrates the saucers, the stick and dash
arrive through on_input, and positions stream to browsers over the room's fast channel. Hits, shatters,
falls and pickups go out as numbered events ("ev") so browsers can show sparks and play sounds; each event
is repeated for EVENT_KEEP seconds in case a browser misses an update, and browsers skip ones they've seen."""
import math
import random
import time

from .base import Game, GameError

RADIUS = 10.0          # starting platform radius
MIN_RADIUS = 4.5
SHRINK_EVERY, SHRINK_BY = 15.0, 1.1
SHRINK_WARN = 3.0      # the rim glows red this long before it shrinks
SHRINK_RATE = SHRINK_BY / 0.6   # units/s: a shrink eases in over 0.6 s
SQUEEZE_AFTER, SQUEEZE_EVERY = 75.0, 8.0   # sudden death: no bumpers, and a shrink every 8 s…
SQUEEZE_MIN, RING_SQUEEZE_MIN = 3.0, 4.6   # …down to these
SAUCER = 0.85          # saucer radius
ACCEL, MAX_SPEED, DRAG = 16.0, 7.5, 1.1   # units/s², units/s, fraction of speed lost per second
DASH_SPEED, DASH_SECS, DASH_COOL = 15.0, 0.28, 2.0
DASH_MASS = 2.5        # a dashing saucer hits like this many saucers
BOUNCE = 1.15          # saucer-on-saucer restitution (a little extra pop)
BUMPERS = 16           # rim segments
BUMPER_KICK = 0.75     # how much of a saucer's outward speed a bumper returns
PIT = 2.2              # the 🍩 ring arena: a pit of this radius in the middle
RING_MIN_RADIUS = 5.6  # …so the ring never shrinks thinner than this
FALL_SECS = 1.0        # falling animation before a saucer is out
COUNTDOWN, ROUND_PAUSE = 3.0, 3.0
HIT_EVENT = 4.0        # collisions harder than this impulse are sent as events
EVENT_KEEP = 0.5
# power-ups
POWERS = ("heavy", "shock", "turbo", "shield")
ORB_FIRST, ORB_EVERY, ORB_MAX, ORB_REACH = 4.0, 7.0, 2, SAUCER + 0.5
POWER_SECS = 5.0
HEAVY_MASS = 2.0       # 🪨 on top of DASH_MASS
TURBO_COOL = 0.6       # 🔁 dash cooldown
SHOCK_R, SHOCK_SPEED = 4.0, 11.0   # ⚡ reach, and the speed it gives a saucer right next to it
# 👻 ghosts
GHOST_SPEED = 9.0
METEOR_COOL, METEOR_DELAY = 4.0, 1.0
METEOR_R, METEOR_SPEED = 3.0, 7.0
BOT = {  # reaction interval (s), aim noise (units), dash willingness
    "easy": (0.35, 1.6, 0.35),
    "normal": (0.15, 0.8, 0.7),
    "hard": (0.06, 0.3, 1.0),
}


class Saucer:
    heavy_until = turbo_until = 0.0   # (class defaults for saucers saved before power-ups)
    shield = False
    gx = gy = 0.0                     # 👻 ghost cursor, once it's out

    def __init__(self, x, y):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.sx = self.sy = 0.0       # stick, each -1..1
        self.dash_until = self.cool_until = 0.0
        self.fall = 0.0               # time it went over the edge (0 = on the platform)
        self.out = False
        self.hit_by, self.hit_at = None, 0.0   # who shoved it last, for the log and the knockout count

    def mass(self, now):
        return (DASH_MASS if now < self.dash_until else 1.0) * (HEAVY_MASS if now < self.heavy_until else 1.0)

    def powers(self, now):
        return (1 if now < self.heavy_until else 0) | (2 if now < self.turbo_until else 0) | (4 if self.shield else 0)


class Sumo(Game):
    id = "sumo"
    # (class defaults for rooms saved before these existed)
    pit = 0.0
    target = None
    kos = None
    events = orbs = meteors = ()
    ev_seq = 0
    orb_at = 0.0
    warned = squeeze = False
    category = "action"
    howto = [
        "Drag anywhere to steer your saucer (it keeps its momentum). Or use WASD / the arrow keys.",
        "Tap, 💨 or Space to dash: a big shove, every 2 seconds.",
        "Knock rivals off the edge. Glowing bumpers on the rim bounce you back once, then shatter.",
        "🍩 The ring arena has a pit in the middle: that's an edge too.",
        "The platform shrinks as the round goes on (the rim glows red first). After 75 s it's sudden death.",
        "Orbs: 🪨 heavy, ⚡ shockwave, 🔁 quick dashes, 🛡️ one save at the edge.",
        "👻 Knocked out? Steer your ghost and tap to drop ☄️ meteors on the others.",
        "Last saucer standing wins the round; first to the target wins.",
    ]
    name = "Sumo Saucers"
    icon = "🪐"
    blurb = "Shove rival hover saucers off a shrinking platform in space. Last one floating wins."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "target": ("Rounds to win", [(3, "3"), (2, "2"), (5, "5")], 3),
        "bumpers": ("Rim bumpers", [(True, "On"), (False, "Off (sudden death)")], True),
        "arena": ("Arena", [("disc", "🪐 Disc"), ("ring", "🍩 Ring (a pit in the middle)"), ("mix", "🔀 Changes every round")], "disc"),
        "powerups": ("Power-up orbs", [(True, "On"), (False, "Off")], True),
        "ghosts": ("👻 Ghosts (players who are out drop meteors)", [(True, "On"), (False, "Off")], True),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.wins = [0] * len(seated)
        self.kos = [0] * len(seated)
        self.round = 0
        self.room.turn = None
        self.room.deadline = None
        self.bot_next = [0.0] * len(seated)
        self.room.add_log(f"🪐 {len(seated)} saucers take the platform. First to {self.s['target']} rounds wins.", "big")
        self.new_round(time.time())

    def upgrade(self):
        """Rooms saved before power-ups and ghosts: give them their own lists."""
        if self.kos is None:
            self.kos = [0] * len(self.seats)
        for k in ("events", "orbs", "meteors"):
            if not isinstance(getattr(self, k), list):
                setattr(self, k, [])
        if self.target is None:
            self.target = self.radius

    def new_round(self, now):
        k = len(self.seats)
        self.round += 1
        self.radius = self.target = RADIUS
        arena = self.s.get("arena", "disc")
        self.pit = PIT if arena == "ring" or (arena == "mix" and self.round % 2 == 0) else 0.0
        self.bumpers = [bool(self.s["bumpers"])] * BUMPERS
        offset = self.rng.random() * math.tau
        self.saucers = []
        for i in range(k):
            a = offset + math.tau * i / k
            self.saucers.append(Saucer(math.cos(a) * RADIUS * 0.55, math.sin(a) * RADIUS * 0.55))
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if not p or p.eliminated:
                self.saucers[i].out = True
        self.orbs, self.meteors = [], []
        if not isinstance(self.events, list):
            self.events = []
        self.warned = self.squeeze = False
        self.stage = "countdown"
        self.next_at = now + COUNTDOWN
        self.started = None
        self.last_frame = now
        self.frames = 0
        self.room.add_log(f"🪐 Round {self.round} — get ready!")

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def event(self, now, *e):
        self.ev_seq += 1
        self.events.append((self.ev_seq, now, e))

    # -- input

    def act(self, p, a):
        raise GameError("Steer by dragging, and tap to dash.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        s = self.saucers[i]
        sx, sy = a.get("sx"), a.get("sy")
        if sx is not None or sy is not None:
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (sx, sy)):
                raise GameError("Bad stick.")
            m = math.hypot(sx, sy)
            if m > 1:
                sx, sy = sx / m, sy / m
            s.sx, s.sy = sx, sy
        if a.get("dash") is True:
            self.dash(i, time.time())

    def dash(self, i, now):
        s = self.saucers[i]
        if self.stage != "play" or now < s.cool_until:
            return
        if s.out:  # 👻 a ghost drops a meteor where its cursor is
            if self.s.get("ghosts", True) and self.room.players.get(self.seats[i]):
                self.upgrade()
                self.meteors.append([s.gx, s.gy, now + METEOR_DELAY, i])
                s.cool_until = now + METEOR_COOL
            return
        if s.fall:
            return
        dx, dy = s.sx, s.sy
        if math.hypot(dx, dy) < 0.2:  # no stick: dash the way you're drifting
            dx, dy = s.vx, s.vy
        m = math.hypot(dx, dy)
        if m < 1e-6:
            return
        s.vx, s.vy = dx / m * DASH_SPEED, dy / m * DASH_SPEED
        s.dash_until = now + DASH_SECS
        s.cool_until = now + (TURBO_COOL if now < s.turbo_until else DASH_COOL)
        self.event(now, "d", i)

    # -- simulation

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view (round changes)."""
        self.upgrade()
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "play"
                self.started = self.shrunk_at = now
                self.orb_at = now + ORB_FIRST
                return True
            if self.frames % 6 == 0:
                self.broadcast(now)
            return False
        if self.stage == "over":
            if now >= self.next_at:
                self.new_round(now)
                return True
            return False
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated and (not self.saucers[i].out or self.s.get("ghosts", True)):
                self.bot_think(i, p.bot, now)
        self.shrink(now, dt)
        if self.s.get("powerups", True) and now >= self.orb_at:
            self.spawn_orb(now)
        h = dt / 3
        for _ in range(3):
            self.integrate(h, now)
            self.collide(now)
            self.edges(now)
        self.pickups(now)
        self.land_meteors(now)
        changed = self.check_falls(now)
        if self.frames % 2 == 0 or changed:
            self.broadcast(now)
        return changed

    def floor(self):
        if self.squeeze:
            return RING_SQUEEZE_MIN if self.pit else SQUEEZE_MIN
        return RING_MIN_RADIUS if self.pit else MIN_RADIUS

    def until_shrink(self, now):
        """Seconds to the next shrink, or None when the platform is as small as it gets."""
        if self.stage != "play" or self.target <= self.floor():
            return None
        return max(0.0, (SQUEEZE_EVERY if self.squeeze else SHRINK_EVERY) - (now - self.shrunk_at))

    def shrink(self, now, dt):
        if not self.squeeze and now - self.started >= SQUEEZE_AFTER:
            self.squeeze = True
            self.bumpers = [False] * BUMPERS
            self.shrunk_at = now - (SQUEEZE_EVERY - SHRINK_WARN)   # the next shrink comes after a warning
            self.warned = False
            self.room.add_log("💀 Sudden death! The bumpers are gone and the platform keeps shrinking.", "power")
            self.event(now, "x")
        left = self.until_shrink(now)
        if left is not None:
            if left <= SHRINK_WARN and not self.warned:
                self.warned = True
                self.event(now, "k")
            if left <= 0:
                self.shrunk_at = now
                self.warned = False
                self.target = max(self.floor(), self.target - SHRINK_BY)
                self.room.add_log("🌑 The platform shrinks!")
                self.event(now, "r")
                self.orbs = [o for o in self.orbs if self.orb_ok(o[0], o[1])]
        if self.radius > self.target:
            self.radius = max(self.target, self.radius - SHRINK_RATE * dt)

    def integrate(self, h, now):
        for s in self.saucers:
            if s.out:  # 👻 the ghost cursor glides over the arena
                s.gx += s.sx * GHOST_SPEED * h
                s.gy += s.sy * GHOST_SPEED * h
                d = math.hypot(s.gx, s.gy)
                if d > self.radius:
                    s.gx, s.gy = s.gx / d * self.radius, s.gy / d * self.radius
                continue
            if s.fall:  # off the edge: keep drifting, no control
                s.x += s.vx * h
                s.y += s.vy * h
                continue
            dashing = now < s.dash_until
            if not dashing:
                s.vx += s.sx * ACCEL * h
                s.vy += s.sy * ACCEL * h
                sp = math.hypot(s.vx, s.vy)
                if sp > MAX_SPEED:  # over the cap (after a dash or a hit): ease back down
                    k = max(MAX_SPEED / sp, 1 - 3 * h)
                    s.vx *= k
                    s.vy *= k
            k = max(0.0, 1 - DRAG * h)
            s.vx *= k
            s.vy *= k
            s.x += s.vx * h
            s.y += s.vy * h

    def collide(self, now):
        live = [(i, s) for i, s in enumerate(self.saucers) if not s.out and not s.fall]
        for a in range(len(live)):
            for b in range(a + 1, len(live)):
                i, p = live[a]
                j, q = live[b]
                dx, dy = q.x - p.x, q.y - p.y
                d = math.hypot(dx, dy)
                if d >= 2 * SAUCER or d < 1e-9:
                    continue
                nx, ny = dx / d, dy / d
                mp, mq = p.mass(now), q.mass(now)
                # push apart by mass
                over = 2 * SAUCER - d
                p.x -= nx * over * mq / (mp + mq)
                p.y -= ny * over * mq / (mp + mq)
                q.x += nx * over * mp / (mp + mq)
                q.y += ny * over * mp / (mp + mq)
                rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny
                if rel <= 0:
                    continue
                imp = (1 + BOUNCE) * rel / (1 / mp + 1 / mq)
                p.vx -= imp / mp * nx
                p.vy -= imp / mp * ny
                q.vx += imp / mq * nx
                q.vy += imp / mq * ny
                q.hit_by, q.hit_at = i, now
                p.hit_by, p.hit_at = j, now
                if imp > HIT_EVENT:
                    self.event(now, "h", round(p.x + nx * SAUCER, 2), round(p.y + ny * SAUCER, 2), round(imp, 1), i, j)

    def segment(self, x, y):
        return int((math.atan2(y, x) % math.tau) / math.tau * BUMPERS) % BUMPERS

    def edges(self, now):
        for i, s in enumerate(self.saucers):
            if s.out or s.fall:
                continue
            d = math.hypot(s.x, s.y)
            if self.pit and d < self.pit - SAUCER * 0.3:
                if s.shield:  # 🛡️ pops it back out of the pit
                    nx, ny = (s.x / d, s.y / d) if d > 1e-6 else (1.0, 0.0)
                    inward = -(s.vx * nx + s.vy * ny)
                    if inward > 0:
                        s.vx += (1 + BUMPER_KICK) * inward * nx
                        s.vy += (1 + BUMPER_KICK) * inward * ny
                    s.x, s.y = nx * (self.pit + SAUCER * 0.2), ny * (self.pit + SAUCER * 0.2)
                    s.shield = False
                    self.event(now, "s", i)
                    continue
                s.fall = now  # centre over the pit: down it goes
                self.event(now, "f", i)
                continue
            if d <= self.radius - SAUCER * 0.2:
                continue
            seg = self.segment(s.x, s.y)
            nx, ny = s.x / d, s.y / d
            out = s.vx * nx + s.vy * ny
            if (s.shield or self.bumpers[seg]) and out > 0:
                # bounce back in: the shield pops, or the bumper shatters
                s.vx -= (1 + BUMPER_KICK) * out * nx
                s.vy -= (1 + BUMPER_KICK) * out * ny
                s.x, s.y = nx * (self.radius - SAUCER * 0.2), ny * (self.radius - SAUCER * 0.2)
                if s.shield:
                    s.shield = False
                    self.event(now, "s", i)
                else:
                    self.bumpers[seg] = False
                    self.event(now, "b", seg)
            elif d > self.radius + SAUCER * 0.3:
                s.fall = now  # centre past the rim: over it goes
                self.event(now, "f", i)

    # -- power-ups

    def orb_ok(self, x, y):
        d = math.hypot(x, y)
        return d < self.target - 1.6 and (not self.pit or d > self.pit + 1.4)

    def spawn_orb(self, now):
        self.orb_at = now + ORB_EVERY * self.rng.uniform(0.8, 1.2)
        if len(self.orbs) >= ORB_MAX:
            return
        lo = self.pit + 1.5 if self.pit else 0.0
        hi = self.target - 1.8
        for _ in range(12):
            r = math.sqrt(self.rng.uniform(lo * lo, hi * hi))
            a = self.rng.random() * math.tau
            x, y = r * math.cos(a), r * math.sin(a)
            if all(math.hypot(x - s.x, y - s.y) > 2.2 for s in self.saucers if not s.out) and \
                    all(math.hypot(x - o[0], y - o[1]) > 3 for o in self.orbs):
                self.orbs.append([round(x, 2), round(y, 2), self.rng.choice(POWERS)])
                return

    def pickups(self, now):
        for o in list(self.orbs):
            for i, s in enumerate(self.saucers):
                if s.out or s.fall or math.hypot(s.x - o[0], s.y - o[1]) > ORB_REACH:
                    continue
                self.orbs.remove(o)
                kind = o[2]
                if kind == "heavy":
                    s.heavy_until = now + POWER_SECS
                elif kind == "turbo":
                    s.turbo_until = now + POWER_SECS
                    s.cool_until = min(s.cool_until, now + TURBO_COOL)
                elif kind == "shield":
                    s.shield = True
                else:
                    self.blast(s.x, s.y, SHOCK_R, SHOCK_SPEED, i, now, skip=i)
                    self.event(now, "w", round(s.x, 2), round(s.y, 2), i)
                self.event(now, "p", i, kind)
                break

    def blast(self, x, y, reach, speed, by, now, skip=None):
        """Push every saucer near (x, y) away from it (a ⚡ shockwave or a ☄️ meteor)."""
        for j, s in enumerate(self.saucers):
            if j == skip or s.out or s.fall:
                continue
            dx, dy = s.x - x, s.y - y
            d = math.hypot(dx, dy)
            if d >= reach:
                continue
            if d < 1e-6:
                dx, dy, d = math.cos(j), math.sin(j), 1.0
            k = speed * (1 - 0.5 * d / reach) / (HEAVY_MASS if now < s.heavy_until else 1.0)
            s.vx += dx / d * k
            s.vy += dy / d * k
            if by != j:
                s.hit_by, s.hit_at = by, now

    def land_meteors(self, now):
        for m in [m for m in self.meteors if now >= m[2]]:
            self.meteors.remove(m)
            self.blast(m[0], m[1], METEOR_R, METEOR_SPEED, m[3], now)
            self.event(now, "m", round(m[0], 2), round(m[1], 2))

    def check_falls(self, now):
        changed = False
        for i, s in enumerate(self.saucers):
            if s.fall and not s.out and now - s.fall >= FALL_SECS:
                s.out = True
                s.gx, s.gy = s.x * 0.5, s.y * 0.5   # the ghost starts above where it went over, nudged in
                s.sx = s.sy = 0.0
                s.cool_until = now + 1.0
                changed = True
                r = self.room
                p = r.players.get(self.seats[i])
                by = s.hit_by if s.hit_by is not None and now - s.hit_at < 3 else None
                q = r.players.get(self.seats[by]) if by is not None else None
                if by is not None:
                    self.kos[by] += 1
                ghost = "👻 " if by is not None and self.saucers[by].out else ""
                r.add_log(f"🕳️ {ghost}{q.name} knocked {p.name if p else '?'} off!" if q else
                          f"🕳️ {p.name if p else '?'} drifted off the edge.", "power")
        if changed:
            self.check_round(now)
        return changed

    def check_round(self, now):
        left = [i for i, s in enumerate(self.saucers) if not s.out and not s.fall]
        falling = [i for i, s in enumerate(self.saucers) if s.fall and not s.out]
        if len(left) > 1 or falling:
            return
        r = self.room
        if left:
            i = left[0]
            self.wins[i] += 1
            p = r.players.get(self.seats[i])
            name = p.name if p else "?"
            if self.wins[i] >= self.s["target"]:
                self.stage = "done"
                rest = max([w for j, w in enumerate(self.wins) if j != i] or [0])
                ko = self.kos[i] if self.kos else 0
                return r.finish(p, f"🏆 {name} wins the match, {self.wins[i]} rounds to {rest}"
                                   f"{f' with {ko} knockout' + ('s' if ko != 1 else '') if ko else ''}!")
            r.add_log(f"🏁 {name} wins round {self.round}!", "big")
        else:
            r.add_log(f"🤝 Round {self.round} is a draw — everyone fell.", "big")
        self.stage = "over"
        self.next_at = now + ROUND_PAUSE

    def state(self, now, r2=lambda v: v):
        sk = self.until_shrink(now)
        return {
            "rd": self.round, "st": self.stage, "R": r2(self.radius),
            "bm": "".join("1" if b else "0" for b in self.bumpers),
            "s": [[r2(s.x), r2(s.y), r2(s.vx), r2(s.vy), int(now < s.dash_until),
                   r2(max(0.0, s.cool_until - now)), 2 if s.out else 1 if s.fall else 0,
                   s.powers(now), r2(s.gx), r2(s.gy)] for s in self.saucers],
            "o": self.orbs,
            "mt": [[r2(m[0]), r2(m[1]), r2(max(0.0, m[2] - now)), m[3]] for m in self.meteors],
            "sk": -1 if sk is None else round(sk, 1),
            "sd": int(self.squeeze),
            "ko": self.kos,
        }

    def broadcast(self, now):
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]
        d = self.state(now, lambda v: round(v, 3))
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.room.push_fast(d)

    # -- bots: stay central, get behind a rival near the edge, then dash through them

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, noise, eager = BOT[level]
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        me = self.saucers[i]
        if me.out:
            return self.ghost_think(i, level, now)
        if me.fall:
            return
        R = self.radius
        rivals = [(j, s) for j, s in enumerate(self.saucers) if j != i and not s.out and not s.fall]
        if not rivals:
            me.sx = me.sy = 0.0
            return
        d_me = math.hypot(me.x, me.y)
        # a rival dashing at us: sidestep (hard bots mostly, normal sometimes)
        if level != "easy" and random.random() < (0.9 if level == "hard" else 0.4):
            for j, s in rivals:
                if now < s.dash_until:
                    rx, ry = me.x - s.x, me.y - s.y
                    dist = math.hypot(rx, ry)
                    if dist < 5 and (s.vx * rx + s.vy * ry) > 0.7 * math.hypot(s.vx, s.vy) * dist:
                        # perpendicular to their path, toward the centre side
                        px, py = -s.vy, s.vx
                        if px * -me.x + py * -me.y < 0:
                            px, py = -px, -py
                        m = math.hypot(px, py) or 1
                        self.steer(me, px / m, py / m)
                        return
        # a meteor about to land on us: get out from under it
        for m in self.meteors:
            if level != "easy" and m[2] - now < 0.8 and math.hypot(me.x - m[0], me.y - m[1]) < METEOR_R * 0.8:
                ax, ay = me.x - m[0], me.y - m[1]
                if ax * me.x + ay * me.y > 0:  # don't flee outward: slide round it toward the middle
                    ax, ay = -me.x, -me.y
                self.steer(me, ax, ay)
                return
        # too close to the edge: get back toward the middle (of the ring, in the 🍩 arena)
        pit = self.pit
        if pit:
            safe = (R - pit) * (0.22 if level == "hard" else 0.14)
            mid = (R + pit) / 2
            if d_me < pit + SAUCER + safe or d_me > R - SAUCER - safe:
                k = (mid - d_me) / (d_me or 1e-6)
                self.steer(me, me.x * k, me.y * k)
                return
        elif d_me > R * (0.62 if level == "hard" else 0.72):
            self.steer(me, -me.x, -me.y)
            return
        near = min(math.hypot(s.x - me.x, s.y - me.y) for _, s in rivals)
        # an orb close by, and nobody close enough to charge us: grab it
        if self.orbs and near > 3.5:
            reach = {"easy": 3.0, "normal": 4.5, "hard": 6.0}[level]
            ox, oy, _ = min(self.orbs, key=lambda o: math.hypot(o[0] - me.x, o[1] - me.y))
            if math.hypot(ox - me.x, oy - me.y) < reach:
                self.steer(me, ox - me.x, oy - me.y)
                return
        # victim: the rival easiest to push out (nearest the edge, and close to us)
        def ease(js):
            j, s = js
            d = math.hypot(s.x, s.y)
            edge = min(R - d, d - pit) if pit else R - d
            return edge + 0.5 * math.hypot(s.x - me.x, s.y - me.y) + (1.5 if s.shield else 0)
        j, t = min(rivals, key=ease)
        dt_ = math.hypot(t.x, t.y) or 1e-6
        ux, uy = t.x / dt_, t.y / dt_  # outward through the target
        if pit and dt_ - pit < R - dt_:
            ux, uy = -ux, -uy           # nearer the pit: shove it inward instead
        # line up on the inside of the target, then charge outward through it
        bx, by = t.x - ux * 2.6 * SAUCER, t.y - uy * 2.6 * SAUCER
        bx += random.gauss(0, noise)
        by += random.gauss(0, noise)
        to_b = math.hypot(bx - me.x, by - me.y)
        lined = (me.x * ux + me.y * uy) < (t.x * ux + t.y * uy) - SAUCER
        gap = math.hypot(t.x - me.x, t.y - me.y)
        inward = pit and (ux * t.x + uy * t.y) < 0
        # a dash toward the pit carries you in after them: careful bots only take it from well back
        reach = 4.5 if not inward else 3.0 if level == "easy" or d_me - pit > 4.0 else 0.0
        if lined and gap < reach and now >= me.cool_until and random.random() < eager:
            self.steer(me, t.x - me.x, t.y - me.y)
            self.dash(i, now)
            return
        if to_b > 0.6:
            self.steer(me, bx - me.x, by - me.y)
        else:
            self.steer(me, t.x - me.x, t.y - me.y)

    def ghost_think(self, i, level, now):
        """👻 a bot ghost hunts the leader still floating (most wins), aiming where it's heading."""
        me = self.saucers[i]
        live = [(j, s) for j, s in enumerate(self.saucers) if not s.out and not s.fall]
        if not live:
            me.sx = me.sy = 0.0
            return
        _, noise, eager = BOT[level]
        j, t = max(live, key=lambda js: (self.wins[js[0]], -math.hypot(js[1].x, js[1].y)))
        tx, ty = t.x + t.vx * METEOR_DELAY * 0.6, t.y + t.vy * METEOR_DELAY * 0.6
        dx, dy = tx - me.gx, ty - me.gy
        d = math.hypot(dx, dy)
        if d < 0.9 + noise and now >= me.cool_until and random.random() < eager:
            self.dash(i, now)
        if d > 0.4:
            self.steer(me, dx, dy)
        else:
            me.sx = me.sy = 0.0

    @staticmethod
    def steer(s, dx, dy):
        m = math.hypot(dx, dy)
        s.sx, s.sy = (dx / m, dy / m) if m > 1e-6 else (0.0, 0.0)

    # -- the rest of the contract

    def bot_ready(self):
        return False  # bots steer inside frame()

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} left the platform.")
        if i is not None and not self.saucers[i].out:
            self.saucers[i].out = True
            if self.stage == "play":
                self.check_round(time.time())
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🏁 {self.wins[i]}"

    def final_scores(self):
        return {pid: self.wins[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        self.upgrade()
        return {"sumo": {
            **self.state(now),
            "seats": self.seats, "me": self.seat(p), "round": self.round, "wins": self.wins,
            "target": self.s["target"], "stage": self.stage, "R0": RADIUS, "saucer": SAUCER,
            "pit": self.pit, "nb": BUMPERS, "ghosts": bool(self.s.get("ghosts", True)),
            "countdown": max(0.0, self.next_at - now) if self.stage in ("countdown", "over") else 0,
            "dashCool": DASH_COOL, "meteorCool": METEOR_COOL, "seq": self.ev_seq,
        }}
