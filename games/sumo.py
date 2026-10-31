"""Sumo Saucers: an original real-time arena game. Everyone pilots a hover saucer on a round platform
floating in space. Steer with a virtual stick (momentum carries you), and 💨 dash for a big shove.
Knock rivals off the edge: the last saucer on the platform wins the round, and the first to the
target number of rounds wins the match.

The rim is lined with glowing bumpers. A bumper bounces a saucer back onto the platform once, then
shatters, so the edge gets more dangerous as the round goes on. The platform also shrinks every
SHRINK_EVERY seconds.

Server-owned physics like Air Hockey: frame(now) (60 fps) integrates the saucers, the stick and dash
arrive through on_input, and positions stream to browsers over the room's fast channel."""
import math
import random
import time

from .base import Game, GameError

RADIUS = 10.0          # starting platform radius
MIN_RADIUS = 4.5
SHRINK_EVERY, SHRINK_BY = 15.0, 1.1
SAUCER = 0.85          # saucer radius
ACCEL, MAX_SPEED, DRAG = 16.0, 7.5, 1.1   # units/s², units/s, fraction of speed lost per second
DASH_SPEED, DASH_SECS, DASH_COOL = 15.0, 0.28, 2.0
DASH_MASS = 2.5        # a dashing saucer hits like this many saucers
BOUNCE = 1.15          # saucer-on-saucer restitution (a little extra pop)
BUMPERS = 16           # rim segments
BUMPER_KICK = 0.75     # how much of a saucer's outward speed a bumper returns
FALL_SECS = 1.0        # falling animation before a saucer is out
COUNTDOWN, ROUND_PAUSE = 3.0, 3.0
BOT = {  # reaction interval (s), aim noise (units), dash willingness
    "easy": (0.35, 1.6, 0.35),
    "normal": (0.15, 0.8, 0.7),
    "hard": (0.06, 0.3, 1.0),
}


class Saucer:
    def __init__(self, x, y):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.sx = self.sy = 0.0       # stick, each -1..1
        self.dash_until = self.cool_until = 0.0
        self.fall = 0.0               # time it went over the edge (0 = on the platform)
        self.out = False
        self.hit_by, self.hit_at = None, 0.0   # who shoved it last, for the log


class Sumo(Game):
    id = "sumo"
    category = "action"
    howto = [
        "Drag anywhere to steer your saucer (it keeps its momentum). Or use WASD / the arrow keys.",
        "Tap, 💨 or Space to dash: a big shove, every 2 seconds.",
        "Knock rivals off the edge. Glowing bumpers on the rim bounce you back once, then shatter.",
        "The platform shrinks as the round goes on. Last saucer standing wins the round; first to the target wins.",
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
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.wins = [0] * len(seated)
        self.round = 0
        self.room.turn = None
        self.room.deadline = None
        self.bot_next = [0.0] * len(seated)
        self.room.add_log(f"🪐 {len(seated)} saucers take the platform. First to {self.s['target']} rounds wins.", "big")
        self.new_round(time.time())

    def new_round(self, now):
        k = len(self.seats)
        self.round += 1
        self.radius = RADIUS
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
        self.stage = "countdown"
        self.next_at = now + COUNTDOWN
        self.started = None
        self.last_frame = now
        self.frames = 0
        self.room.add_log(f"🪐 Round {self.round} — get ready!")

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

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
        if self.stage != "play" or s.out or s.fall or now < s.cool_until:
            return
        dx, dy = s.sx, s.sy
        if math.hypot(dx, dy) < 0.2:  # no stick: dash the way you're drifting
            dx, dy = s.vx, s.vy
        m = math.hypot(dx, dy)
        if m < 1e-6:
            return
        s.vx, s.vy = dx / m * DASH_SPEED, dy / m * DASH_SPEED
        s.dash_until, s.cool_until = now + DASH_SECS, now + DASH_COOL

    # -- simulation

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view (round changes)."""
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "play"
                self.started = self.shrunk_at = now
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
            if p and p.bot and not self.saucers[i].out:
                self.bot_think(i, p.bot, now)
        if now - self.shrunk_at >= SHRINK_EVERY and self.radius > MIN_RADIUS:
            self.shrunk_at = now
            self.radius = max(MIN_RADIUS, self.radius - SHRINK_BY)
            self.room.add_log("🌑 The platform shrinks!")
        h = dt / 3
        for _ in range(3):
            self.integrate(h, now)
            self.collide(now)
            self.edges(now)
        changed = self.check_falls(now)
        if self.frames % 2 == 0 or changed:
            self.broadcast(now)
        return changed

    def integrate(self, h, now):
        for s in self.saucers:
            if s.out:
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
                mp = DASH_MASS if now < p.dash_until else 1.0
                mq = DASH_MASS if now < q.dash_until else 1.0
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

    def segment(self, x, y):
        return int((math.atan2(y, x) % math.tau) / math.tau * BUMPERS) % BUMPERS

    def edges(self, now):
        for i, s in enumerate(self.saucers):
            if s.out or s.fall:
                continue
            d = math.hypot(s.x, s.y)
            if d <= self.radius - SAUCER * 0.2:
                continue
            seg = self.segment(s.x, s.y)
            nx, ny = s.x / d, s.y / d
            out = s.vx * nx + s.vy * ny
            if self.bumpers[seg] and out > 0:
                # bounce back in, and the bumper shatters
                s.vx -= (1 + BUMPER_KICK) * out * nx
                s.vy -= (1 + BUMPER_KICK) * out * ny
                s.x, s.y = nx * (self.radius - SAUCER * 0.2), ny * (self.radius - SAUCER * 0.2)
                self.bumpers[seg] = False
            elif d > self.radius + SAUCER * 0.3:
                s.fall = now  # centre past the rim: over it goes

    def check_falls(self, now):
        changed = False
        for i, s in enumerate(self.saucers):
            if s.fall and not s.out and now - s.fall >= FALL_SECS:
                s.out = True
                changed = True
                r = self.room
                p = r.players.get(self.seats[i])
                by = s.hit_by if s.hit_by is not None and now - s.hit_at < 3 else None
                q = r.players.get(self.seats[by]) if by is not None else None
                r.add_log(f"🕳️ {q.name} knocked {p.name if p else '?'} off!" if q else
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
                return r.finish(p, f"🏆 {name} wins the match, {self.wins[i]} rounds to {rest}!")
            r.add_log(f"🏁 {name} wins round {self.round}!", "big")
        else:
            r.add_log(f"🤝 Round {self.round} is a draw — everyone fell.", "big")
        self.stage = "over"
        self.next_at = now + ROUND_PAUSE

    def broadcast(self, now):
        r2 = lambda v: round(v, 3)
        self.room.push_fast({
            "rd": self.round, "st": self.stage, "R": r2(self.radius),
            "bm": "".join("1" if b else "0" for b in self.bumpers),
            "s": [[r2(s.x), r2(s.y), r2(s.vx), r2(s.vy), int(now < s.dash_until),
                   r2(max(0.0, s.cool_until - now)), 2 if s.out else 1 if s.fall else 0] for s in self.saucers],
        })

    # -- bots: stay central, get behind a rival near the edge, then dash through them

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, noise, eager = BOT[level]
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        me = self.saucers[i]
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
        # too close to the edge: get back toward the middle
        if d_me > R * (0.62 if level == "hard" else 0.72):
            self.steer(me, -me.x, -me.y)
            return
        # victim: the rival easiest to push out (nearest the edge, and close to us)
        def ease(js):
            j, s = js
            return (R - math.hypot(s.x, s.y)) + 0.5 * math.hypot(s.x - me.x, s.y - me.y)
        j, t = min(rivals, key=ease)
        dt_ = math.hypot(t.x, t.y) or 1e-6
        ux, uy = t.x / dt_, t.y / dt_  # outward through the target
        # line up on the inside of the target, then charge outward through it
        bx, by = t.x - ux * 2.6 * SAUCER, t.y - uy * 2.6 * SAUCER
        bx += random.gauss(0, noise)
        by += random.gauss(0, noise)
        to_b = math.hypot(bx - me.x, by - me.y)
        lined = (me.x * ux + me.y * uy) < (t.x * ux + t.y * uy) - SAUCER
        gap = math.hypot(t.x - me.x, t.y - me.y)
        if lined and gap < 4.5 and now >= me.cool_until and random.random() < eager:
            self.steer(me, t.x - me.x, t.y - me.y)
            self.dash(i, now)
            return
        if to_b > 0.6:
            self.steer(me, bx - me.x, by - me.y)
        else:
            self.steer(me, t.x - me.x, t.y - me.y)

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
        return {"sumo": {
            "seats": self.seats, "me": self.seat(p), "round": self.round, "wins": self.wins,
            "target": self.s["target"], "stage": self.stage, "R": self.radius, "R0": RADIUS, "saucer": SAUCER,
            "bm": "".join("1" if b else "0" for b in self.bumpers), "nb": BUMPERS,
            "s": [[s.x, s.y, s.vx, s.vy, int(now < s.dash_until), max(0.0, s.cool_until - now),
                   2 if s.out else 1 if s.fall else 0] for s in self.saucers],
            "countdown": max(0.0, self.next_at - now) if self.stage in ("countdown", "over") else 0,
            "dashCool": DASH_COOL,
        }}
