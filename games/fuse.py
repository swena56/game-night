"""Fuse Frenzy: real-time hot-potato tag with a lit bomb, server-side physics at 60 fps.

One player carries a bomb with a burning fuse. The carrier runs a little faster and passes the bomb by
touching someone; the one who just passed can't be tagged straight back. When the fuse burns out the
carrier blows up and is out. Everyone else dashes, dodges and corners rivals; a new bomb with a shorter
fuse is lit for the survivors until one brawler is left.

Arena: x 0..W, y 0..H. Players steer at a capped speed. Positions stream ~30 times a second over the room's fast channel."""
import math
import random
import time

from .base import Game, GameError

W, H = 1.0, 1.3
R = 0.045                      # a player's radius
SPEED, CARRIER_SPEED = 0.46, 0.54   # arena units per second; the carrier is about 17% faster
DASH_SPEED, DASH_SECS, DASH_COOL = 1.55, 0.22, 2.4   # ⚡ a short burst, then a wait
IMMUNE = 1.1                   # the one who just passed the bomb can't be tagged straight back
READY = 1.8                    # a pause before each new bomb: a "Ready…" for every screen
FUSE_STEP, FUSE_MIN = 1.2, 5.5  # each round's fuse is this much shorter, never below the minimum
ITEM_EVERY, ITEM_MAX, ITEM_R = (4.5, 7.5), 2, 0.035   # 🎁 a pickup appears every few seconds (two at most) on the arena floor
BOOST_PACE, BOOST_SECS = 1.3, 4.0   # ⚡ a speed pickup: this much faster for this long
BLOCK_IMMUNE = 0.8              # 🛡️ a shield soaks one tag; the carrier can't try that runner again for this long
CLOSE_CALL = 1.0               # a pass with less than this left on the fuse is a callout
BOT = {  # reaction interval (s), speed factor, aim noise (units), dashes
    "easy": (0.26, 0.9, 0.12, 0.0),
    "normal": (0.13, 0.97, 0.06, 0.5),
    "hard": (0.06, 1.0, 0.02, 1.0),
}


class Fuse(Game):
    id = "fuse"
    category = "action"
    howto = [
        "Drag on the arena like a joystick and lift to stop. Use WASD or arrow keys to steer on a keyboard.",
        "💣 One runner holds the bomb. It runs a little faster, and touching someone passes the bomb on.",
        "The one who just passed it can't be tagged back for a second, so get away!",
        "🎁 Glowing pickups appear on the floor: 🛡️ a shield soaks one tag, ⚡ a speed boost lasts 4 seconds. First to touch one gets it.",
        "⚡ Tap Dash (or Space) for a short burst of speed, then wait a couple of seconds.",
        "When the fuse burns out the carrier blows up and is out. A new bomb with a shorter fuse is lit; last runner standing wins.",
    ]
    name = "Fuse Frenzy"
    icon = "💣"
    blurb = "Hot-potato tag with a lit bomb: run, dash, and pass it on before it blows."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "fuse": ("Fuse", [(11, "🧨 Normal"), (8, "💨 Short"), (15, "🕯️ Long")], 11),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.pos = [[W / 2, H / 2] for _ in range(n)]
        self.target = [[W / 2, H / 2] for _ in range(n)]
        self.steer = [None] * n
        self.dir = [[0.0, 1.0] for _ in range(n)]
        self.alive = [True] * n
        self.dash_until = [0.0] * n
        self.dash_ready = [0.0] * n
        self.immune = [0.0] * n
        self.survived = [0] * n
        self.passes = [0] * n
        self.bot_next = [0.0] * n
        self.shield = [False] * n
        self.boost_until = [0.0] * n
        self.items = []
        self.next_item = 0.0
        self.round = 0
        self.last_frame = None
        self.frames = 0
        self.carrier = 0
        self.fuse_len = 10.0
        self.fuse_end = 0.0
        self.paused_until = 0.0
        self.room.turn = None
        self.room.deadline = None
        self.room.add_log("💣 Fuse Frenzy! Pass the bomb on before it blows.", "big")
        self.new_round(time.time())

    def new_round(self, now):
        self.round += 1
        live = [i for i, a in enumerate(self.alive) if a]
        k = len(live)
        for j, i in enumerate(live):   # spread the survivors round the arena
            a = math.tau * j / k + 0.4
            self.pos[i] = [W / 2 + math.cos(a) * 0.32, H / 2 + math.sin(a) * 0.42]
            self.target[i] = list(self.pos[i])
            if hasattr(self, "steer"):
                self.steer[i] = None
            self.dash_until[i] = 0.0
            self.dash_ready[i] = 0.0
            self.immune[i] = 0.0
            self.shield[i] = False
            self.boost_until[i] = 0.0
        self.items = []
        self.carrier = self.rng.choice(live)
        base = float(self.s.get("fuse", 11))
        self.fuse_len = max(FUSE_MIN, base - FUSE_STEP * (self.round - 1)) + self.rng.uniform(-0.8, 1.4)
        self.paused_until = now + READY
        self.fuse_end = self.paused_until + self.fuse_len
        self.next_item = self.paused_until + self.rng.uniform(2.0, 4.0)
        self.room.add_log(f"💣 Round {self.round}: {self.name_of(self.carrier)} has the bomb! ({len(live)} left)", "power")

    def name_of(self, i):
        p = self.room.players.get(self.seats[i])
        return p.name if p else "?"

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- input

    def act(self, p, a):
        raise GameError("Drag to run, tap Dash to burst.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated or not self.alive[i]:
            raise GameError("You're watching this game.")
        if not hasattr(self, "steer"):
            self.steer = [None] * len(self.seats)
        dx, dy = a.get("dx"), a.get("dy")
        if dx is not None or dy is not None:
            if not all(type(v) in (int, float) and -1 <= v <= 1 for v in (dx, dy)):
                raise GameError("Bad direction.")
            length = math.hypot(dx, dy) or 1
            self.steer[i] = (dx / length, dy / length)
            if (dx or dy) and time.time() >= self.dash_until[i]:
                self.dir[i] = self.steer[i]
        x, y = a.get("x"), a.get("y")
        if x is not None or y is not None:
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (x, y)):
                raise GameError("Bad position.")
            self.steer[i] = None
            self.target[i] = [min(W - R, max(R, x)), min(H - R, max(R, y))]
        if a.get("dash") is True:
            self.dash(i, time.time())

    def dash(self, i, now):
        if now < self.paused_until or now < self.dash_ready[i] or not self.alive[i]:
            return False
        px, py = self.pos[i]
        dx, dy = self.target[i][0] - px, self.target[i][1] - py
        steer = self.steer[i] if hasattr(self, "steer") else None
        p = self.room.players.get(self.seats[i])
        if steer is not None and not (p and p.bot):
            dx, dy = steer
        d = math.hypot(dx, dy)
        if d > 0.02:
            self.dir[i] = [dx / d, dy / d]
        self.dash_until[i] = now + DASH_SECS
        self.dash_ready[i] = now + DASH_COOL
        return True

    # -- physics

    def frame(self, now):
        if self.last_frame is None:
            self.last_frame = now
            return False
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and self.alive[i]:
                self.bot_think(i, p.bot, now)
        changed = False
        before = [list(q) for q in self.pos]
        if now >= self.paused_until:
            for i in range(len(self.seats)):
                if self.alive[i]:
                    self.move(i, dt, now)
            self.separate()
            changed = self.pickups(now)
            changed = self.tag(now) or changed
            if now >= self.fuse_end and self.alive[self.carrier]:
                return self.explode(now)
        self._prev = before
        if self.frames % 2 == 0:
            self.broadcast(now)
        return changed

    def move(self, i, dt, now):
        x, y = self.pos[i]
        if now < self.dash_until[i]:
            ux, uy = self.dir[i]
            step = DASH_SPEED * dt
        else:
            p = self.room.players.get(self.seats[i])
            sp = CARRIER_SPEED if i == self.carrier else SPEED
            if now < self.boost_until[i]:
                sp *= BOOST_PACE
            if p and p.bot:
                sp *= BOT[p.bot][1]
            steer = self.steer[i] if hasattr(self, "steer") and not (p and p.bot) else None
            if steer is not None:
                ux, uy = steer
                step = sp * dt
            else:
                dx, dy = self.target[i][0] - x, self.target[i][1] - y
                d = math.hypot(dx, dy)
                if d < 1e-6:
                    return
                ux, uy = dx / d, dy / d
                step = min(d, sp * dt)
        self.pos[i] = [min(W - R, max(R, x + ux * step)), min(H - R, max(R, y + uy * step))]

    def separate(self):
        live = [i for i, a in enumerate(self.alive) if a]
        for a in range(len(live)):
            for b in range(a + 1, len(live)):
                i, j = live[a], live[b]
                dx, dy = self.pos[j][0] - self.pos[i][0], self.pos[j][1] - self.pos[i][1]
                d = math.hypot(dx, dy)
                if 0 < d < 2 * R:
                    push = (2 * R - d) / 2
                    nx, ny = dx / d, dy / d
                    self.pos[i] = [self.pos[i][0] - nx * push, self.pos[i][1] - ny * push]
                    self.pos[j] = [self.pos[j][0] + nx * push, self.pos[j][1] + ny * push]

    def pickups(self, now):
        """🎁 Items appear now and then; the first runner to touch one takes it. Returns True when something changed."""
        changed = False
        if now >= self.next_item and len(self.items) < ITEM_MAX:
            self.next_item = now + self.rng.uniform(*ITEM_EVERY)
            cx, cy = self.pos[self.carrier]
            for _ in range(8):   # not right on top of the bomb
                x, y = self.rng.uniform(0.15, W - 0.15), self.rng.uniform(0.15, H - 0.15)
                if math.hypot(x - cx, y - cy) > 0.3:
                    self.items.append([round(x, 3), round(y, 3), self.rng.choice(("shield", "boost"))])
                    changed = True
                    break
        for it in list(self.items):
            for i, ok in enumerate(self.alive):
                if ok and math.hypot(self.pos[i][0] - it[0], self.pos[i][1] - it[1]) <= R + ITEM_R:
                    self.items.remove(it)
                    if it[2] == "shield":
                        self.shield[i] = True
                    else:
                        self.boost_until[i] = now + BOOST_SECS
                    self.room.add_log(f"{'🛡️ shield' if it[2] == 'shield' else '⚡ speed boost'}: {self.name_of(i)} grabs it.", "info")
                    changed = True
                    break
        return changed

    def tag(self, now):
        c = self.carrier
        for j, ok in enumerate(self.alive):
            if not ok or j == c or now < self.immune[j]:
                continue
            if math.hypot(self.pos[j][0] - self.pos[c][0], self.pos[j][1] - self.pos[c][1]) <= 2 * R + 0.006:
                if self.shield[j]:   # 🛡️ the shield soaks this one tag
                    self.shield[j] = False
                    self.immune[j] = now + BLOCK_IMMUNE
                    self.moment(f"🛡️ {self.name_of(j)} blocks the bomb from {self.name_of(c)}!", "cool", "tag")
                    return True
                left = self.fuse_end - now
                self.immune[c] = now + IMMUNE
                self.passes[c] += 1
                self.room.add_log(f"💣 {self.name_of(c)} tags {self.name_of(j)}! {left:.1f}s left.", "question")
                if left < CLOSE_CALL:
                    self.moment(f"😅 {self.name_of(c)} passes it with {left:.1f}s to spare!", "good", "pop")
                self.carrier = j
                return True
        return False

    def explode(self, now):
        c = self.carrier
        self.alive[c] = False
        self.survived[c] = self.round - 1
        p = self.room.players.get(self.seats[c])
        if p:
            p.eliminated = True
        self.moment(f"💥 {self.name_of(c)} BLOWS UP!", "bad", "boom")
        live = [i for i, a in enumerate(self.alive) if a]
        self.broadcast(now)
        if len(live) <= 1:
            winner = self.room.players.get(self.seats[live[0]]) if live else None
            if live:
                self.survived[live[0]] = self.round
            self.room.finish(winner, f"🏆 {winner.name} is the last runner standing!" if winner else "💥 Nobody left.")
            return True
        self.new_round(now)
        return True

    def broadcast(self, now):
        r3 = lambda v: round(v, 3)
        self.room.push_fast({
            "p": [[r3(x), r3(y)] for x, y in self.pos],
            "a": [int(v) for v in self.alive],
            "im": [round(max(0.0, t - now), 2) for t in self.immune],
            "dc": [round(max(0.0, t - now), 1) for t in self.dash_ready],
            "dn": [int(now < t) for t in self.dash_until],
            "it": self.items, "sh": [int(v) for v in self.shield], "bo": [int(now < t) for t in self.boost_until],
            "c": self.carrier, "rd": self.round,
            "f": round(max(0.0, self.fuse_end - now), 2), "len": round(self.fuse_len, 1),
            "pause": round(max(0.0, self.paused_until - now), 2),
        })

    # -- bots

    def bot_think(self, i, level, now):
        react, _, noise, dashes = BOT[level]
        if now < self.bot_next[i] or now < self.paused_until:
            return
        self.bot_next[i] = now + react
        x, y = self.pos[i]
        rnd = self.rng.gauss
        if i == self.carrier:   # chase the nearest runner who can be tagged, leading a moving one
            foes = [j for j, a in enumerate(self.alive) if a and j != i and now >= self.immune[j]]
            if not foes:
                return
            j = min(foes, key=lambda k: math.hypot(self.pos[k][0] - x, self.pos[k][1] - y))
            d = math.hypot(self.pos[j][0] - x, self.pos[j][1] - y)
            lead = {"easy": 0.0, "normal": 0.25, "hard": 0.45}[level] * d / CARRIER_SPEED
            vx, vy = self.pos[j][0] - self.prev(j)[0], self.pos[j][1] - self.prev(j)[1]
            tx, ty = self.pos[j][0] + vx * lead * 60, self.pos[j][1] + vy * lead * 60
            self.target[i] = [min(W - R, max(R, tx + rnd(0, noise))), min(H - R, max(R, ty + rnd(0, noise)))]
            if dashes and 0.16 < d < 0.34 and now >= self.dash_ready[i] and self.rng.random() < dashes:
                self.dash(i, now)
        else:                   # run from the carrier, away from walls and corners, toward open space
            c = self.carrier
            cx, cy = self.pos[c]
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy) or 1e-6
            fx, fy = dx / d * (1.0 / (d + 0.15)), dy / d * (1.0 / (d + 0.15))
            fx += (W / 2 - x) * 0.9 * (1 - min(1.0, min(x, W - x) / 0.22) if min(x, W - x) < 0.22 else 0) * 3
            fy += (H / 2 - y) * 0.9 * (1 - min(1.0, min(y, H - y) / 0.22) if min(y, H - y) < 0.22 else 0) * 3
            if d < 0.4:   # slide sideways round the carrier rather than straight along a wall
                fx += -dy / d * 0.8 * (1 if (i + c) % 2 else -1)
                fy += dx / d * 0.8 * (1 if (i + c) % 2 else -1)
            m = math.hypot(fx, fy) or 1e-6
            if level != "easy" and d > 0.4 and self.items:   # the bomb is far: nip over to a pickup
                it = min(self.items, key=lambda q: math.hypot(q[0] - x, q[1] - y))
                if math.hypot(it[0] - x, it[1] - y) < 0.45:
                    self.target[i] = [it[0], it[1]]
                    return
            self.target[i] = [min(W - R, max(R, x + fx / m * 0.4 + rnd(0, noise))), min(H - R, max(R, y + fy / m * 0.4 + rnd(0, noise)))]
            if dashes and d < 0.2 and now >= self.dash_ready[i] and self.rng.random() < dashes:
                self.dash(i, now)

    def prev(self, j):
        """Where runner j was a moment ago (a cheap velocity for leading a target)."""
        prev = getattr(self, "_prev", None)
        return prev[j] if prev and j < len(prev) else self.pos[j]

    def bot_ready(self):
        return False   # bots play inside frame()

    # -- the rest of the game contract

    def on_leave(self, p):
        r = self.room
        i = self.seat(p)
        if i is None or not self.alive[i]:
            return
        self.alive[i] = False
        self.survived[i] = self.round - 1
        p.eliminated = True
        live = [k for k, a in enumerate(self.alive) if a]
        if len(live) <= 1:
            winner = r.players.get(self.seats[live[0]]) if live else None
            r.finish(winner, f"🏳️ {p.name} left — {winner.name} wins!" if winner else "Everyone left.")
        elif self.carrier == i:
            self.carrier = self.rng.choice(live)
            self.immune[self.carrier] = 0.0

    def meta(self, p):
        i = self.seat(p)
        if i is None:
            return ""
        return "☠️ out" if not self.alive[i] else "💣" if i == self.carrier else "🏃"

    def final_scores(self):
        return {pid: self.survived[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        i = self.seat(p)
        return {"fuse": {"W": W, "H": H, "R": R, "seats": self.seats, "me": i,
                         "p": self.pos, "a": [int(v) for v in self.alive], "c": self.carrier, "rd": self.round,
                         "f": round(max(0.0, self.fuse_end - now), 2), "len": round(self.fuse_len, 1),
                         "pause": round(max(0.0, self.paused_until - now), 2),
                         "dc": [round(max(0.0, t - now), 1) for t in self.dash_ready],
                         "it": self.items, "sh": [int(v) for v in self.shield], "bo": [int(now < t) for t in self.boost_until]}}
