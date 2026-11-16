"""Snowball Scramble: an original real-time snowball fight for 2–6 players in a walled snowfield.

Steer with a virtual stick (or WASD). Tap ❄️ to lob a snowball at the nearest rival (the one you're
facing first); hold it to pack a big one (you move slowly while you pack). Snowballs fly in an arc and
land where the target stood when you threw, so keep moving: a shadow shows where each one will land.
Snow forts block throws at anyone sheltering behind them, and get knocked down by the hits they take
(they grow back). Three hits and you're snowed in for a few seconds, and the thrower scores a point.

⛄ Walk through a patch of fresh snow to roll a giant snowball in front of you; run it into a rival to
knock them flat (two hits' worth). Most points when the clock runs out wins.

Server-owned physics like Sumo Saucers: frame(now) steps the field 30 times a second, the stick and the
throw button arrive through on_input, and positions stream to browsers over the room's fast channel.
Hits, splats and knockdowns go out as numbered events, repeated for EVENT_KEEP seconds."""
import math
import random
import time

from .base import Game, GameError

AW, AH = 10.0, 7.0          # the field: x in [-AW, AW], y in [-AH, AH]
BODY = 0.45                 # a player's radius
SPEED, PACK_SPEED = 4.6, 2.0
STEP = 1 / 30               # the field moves 30 times a second (frame() is called at 60)
AMMO, RELOAD = 3, 1.1       # snowballs held, seconds to scoop another
COOLDOWN = 0.35
BIG_HOLD = 0.8              # hold this long to pack a big one
SPLASH, BIG_SPLASH = 0.75, 1.15
PIPS = 3                    # hits to be snowed in
FROZEN = 3.0
FLIGHT = (0.5, 1.0 / 14)    # seconds: base + per unit of distance
MISS_RANGE = 7.0            # a throw with nobody to aim at goes this far
FORT_HP, FORT_REGROW = 5, 18.0
FORTS = [(-6.0, -3.2, 0), (-6.0, 3.2, 0), (6.0, -3.2, 0), (6.0, 3.2, 0), (0.0, -4.4, 1), (0.0, 4.4, 1), (-2.4, 0.0, 0), (2.4, 0.0, 0)]
FORT_LEN, FORT_THICK = 2.4, 0.55
PATCHES = [(-3.5, -5.4), (3.5, 5.4), (0.0, 0.0)]
PATCH_R, PATCH_REGROW = 1.3, 10.0
GIANT_MAX, GIANT_GROW = 1.0, 0.45   # a giant's size 0..1 grows this much per second rolled in fresh snow
GIANT_R = 0.55              # a full giant's radius, in front of you
KNOCK_SECS = 1.6
COUNTDOWN, EVENT_KEEP = 3.0, 0.6
BOT = {  # reaction (s), throw eagerness per second, aim error (units), dodges, uses cover
    "easy": (0.4, 0.5, 1.2, False, False),
    "normal": (0.2, 0.9, 0.5, True, False),
    "hard": (0.1, 1.4, 0.2, True, True),
}


def fort_rect(f):
    x, y, horiz = f
    hw, hh = (FORT_LEN / 2, FORT_THICK / 2) if horiz else (FORT_THICK / 2, FORT_LEN / 2)
    return x - hw, y - hh, x + hw, y + hh


def seg_hits_rect(x0, y0, x1, y1, r, pad=0.0):
    """Where the segment first enters the rectangle (grown by pad), as a fraction 0..1, or None."""
    a0, b0, a1, b1 = r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - a0), (dx, a1 - x0), (-dy, y0 - b0), (dy, b1 - y0)):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return t0


class Kid:
    def __init__(self, x, y):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.fx, self.fy = 1.0, 0.0      # facing
        self.sx = self.sy = 0.0
        self.ammo, self.reload_at, self.cool_until = AMMO, 0.0, 0.0
        self.pips, self.frozen_until, self.knock_until = 0, 0.0, 0.0
        self.pack_at = 0.0               # when the throw button went down (0 = not packing)
        self.giant = 0.0
        self.points = 0
        self.hits = 0


class Snowball(Game):
    id = "snowball"
    category = "action"
    family = None
    howto = [
        "Drag anywhere to run (or WASD / arrows). Tap ❄️ (or Space) to lob a snowball at the nearest rival, the one you're facing first.",
        "Hold ❄️ to pack a big one (two hits, wider splash); you move slowly while you pack. You carry 3 and scoop more as you go.",
        "Snowballs land where the target stood when they were thrown: a shadow shows where. Keep moving! Forts block throws at whoever hides behind them, and crumble.",
        "Three hits and you're snowed in for 3 s: the thrower scores a point. ⛄ Walk through fresh snow to roll a giant; run it into a rival to knock them flat.",
        "Most points when the clock runs out wins.",
    ]
    name = "Snowball Scramble"
    icon = "❄️"
    blurb = "A real-time 3D snowball fight: lob, dodge the shadows, hide behind forts, roll a giant. Most snow-ins wins."
    min_players = 2
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "avalanche": ("🏔️", "Avalanche", "Flatten a rival with a giant snowball"),
              "untouched": ("🧊", "Untouchable", "Win without being snowed in")}
    settings_schema = {
        "time": ("Length", [(120, "2 min"), (90, "90 s"), (180, "3 min")], 120),
        "giants": ("⛄ Giant snowballs", [(True, "On"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(seated)
        self.kids = []
        off = rng.random() * math.tau
        for i in range(n):
            a = off + math.tau * i / n
            self.kids.append(Kid(math.cos(a) * AW * 0.8, math.sin(a) * AH * 0.75))
        self.forts = [FORT_HP] * len(FORTS)
        self.fort_down = [0.0] * len(FORTS)
        self.patches = [1.0] * len(PATCHES)       # fresh snow left in each patch, 0..1
        self.balls = []                            # [x0, y0, x1, y1, t0, t1, big, by, fort index or -1, id]
        self.ball_id = 0
        self.events, self.ev_seq = [], 0
        self.bot_next = [0.0] * n
        self.frozen_ever = [False] * n
        r = self.room
        r.turn = None
        r.deadline = None
        now = time.time()
        self.stage = "countdown"
        self.go_at = now + COUNTDOWN
        self.end_at = self.go_at + int(self.s.get("time", 120))
        self.last = now
        self.acc = 0.0
        self.frames = 0
        r.add_log(f"❄️ Snowball Scramble: {int(self.s.get('time', 120))} seconds. Three hits snow someone in.", "big")

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
        raise GameError("Run by dragging, and tap ❄️ to throw.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        k = self.kids[i]
        sx, sy = a.get("sx"), a.get("sy")
        if sx is not None or sy is not None:
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (sx, sy)):
                raise GameError("Bad stick.")
            m = math.hypot(sx, sy)
            if m > 1:
                sx, sy = sx / m, sy / m
            k.sx, k.sy = sx, sy
        t = a.get("throw")
        if t is not None:
            if t not in ("down", "up", "tap"):
                raise GameError("Bad throw.")
            now = time.time()
            if t == "down":
                if not k.pack_at:
                    k.pack_at = now
            else:
                big = t == "up" and k.pack_at and now - k.pack_at >= BIG_HOLD
                k.pack_at = 0.0
                self.throw(i, now, bool(big))

    # -- the field

    def can_act(self, k, now):
        return self.stage == "play" and now >= k.frozen_until and now >= k.knock_until

    def target_of(self, i):
        """The rival to lob at: the nearest one roughly in front of you, else the nearest."""
        k = self.kids[i]
        best, best_s = None, 1e9
        for j, o in enumerate(self.kids):
            if j == i or not self.active(j):
                continue
            dx, dy = o.x - k.x, o.y - k.y
            d = math.hypot(dx, dy) or 1e-6
            facing = (dx * k.fx + dy * k.fy) / d
            score = d * (1.0 if facing > 0.5 else 1.8)
            if score < best_s:
                best, best_s = j, score
        return best

    def throw(self, i, now, big, at=None):
        k = self.kids[i]
        if not self.can_act(k, now) or now < k.cool_until or k.ammo <= 0:
            return False
        if at is None:
            j = self.target_of(i)
            if j is None:
                at = (k.x + k.fx * MISS_RANGE, k.y + k.fy * MISS_RANGE)
            else:
                at = (self.kids[j].x, self.kids[j].y)
        x1 = max(-AW, min(AW, at[0]))
        y1 = max(-AH, min(AH, at[1]))
        k.ammo -= 1
        k.cool_until = now + COOLDOWN
        if k.ammo < AMMO and k.reload_at <= now:
            k.reload_at = now + RELOAD
        dx, dy = x1 - k.x, y1 - k.y
        d = math.hypot(dx, dy)
        if d > 0.1:
            k.fx, k.fy = dx / d, dy / d
        # a fort between you and the landing spot takes the hit if the target is sheltering close behind it
        fort = -1
        best = 2.0
        for fi, f in enumerate(FORTS):
            if self.forts[fi] <= 0:
                continue
            t = seg_hits_rect(k.x, k.y, x1, y1, fort_rect(f), 0.1)
            if t is not None and t > 0.05 and d * (1 - t) < 1.8 and t < best:
                best, fort = t, fi
        if fort >= 0:
            x1, y1 = k.x + dx * best, k.y + dy * best
            d *= best
        self.ball_id += 1
        self.balls.append([round(k.x, 2), round(k.y, 2), round(x1, 2), round(y1, 2), now, now + FLIGHT[0] + d * FLIGHT[1], big, i, fort, self.ball_id])
        self.event(now, "throw", i, int(big))
        return True

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view."""
        if self.room.phase != "playing":
            return False
        if self.stage == "countdown":
            if now >= self.go_at:
                self.stage = "play"
                self.last = now
                return True
            self.frames += 1
            if self.frames % 6 == 0:
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
        self.move(dt, now)
        self.land(now)
        self.tick_world(dt, now)
        if now >= self.end_at:
            self.broadcast(now)
            self.end()
            return True
        self.broadcast(now)
        return False

    def move(self, dt, now):
        giants = self.s.get("giants", True)
        for i, k in enumerate(self.kids):
            if not self.active(i):
                continue
            if k.pack_at and now - k.pack_at > 3.0:   # a button held down too long throws itself
                k.pack_at = 0.0
                self.throw(i, now, True)
            if self.can_act(k, now):
                sp = PACK_SPEED if k.pack_at else SPEED
                tx, ty = k.sx * sp, k.sy * sp
            else:
                tx = ty = 0.0
            # a little momentum: reach the stick's speed quickly, slide a bit when knocked
            blend = min(1.0, dt * (14 if now >= k.knock_until else 2))
            k.vx += (tx - k.vx) * blend
            k.vy += (ty - k.vy) * blend
            k.x += k.vx * dt
            k.y += k.vy * dt
            if math.hypot(k.sx, k.sy) > 0.2 and self.can_act(k, now):
                m = math.hypot(k.sx, k.sy)
                k.fx, k.fy = k.sx / m, k.sy / m
            k.x = max(-AW + BODY, min(AW - BODY, k.x))
            k.y = max(-AH + BODY, min(AH - BODY, k.y))
            for fi, f in enumerate(FORTS):
                if self.forts[fi] > 0:
                    self.push_out(k, fort_rect(f))
            # ⛄ rolling a giant through fresh snow
            if giants and math.hypot(k.vx, k.vy) > 1.0 and k.giant < GIANT_MAX:
                for pi, (px, py) in enumerate(PATCHES):
                    if self.patches[pi] > 0.05 and math.hypot(k.x - px, k.y - py) < PATCH_R:
                        grow = min(GIANT_GROW * dt, GIANT_MAX - k.giant, self.patches[pi])
                        k.giant += grow
                        self.patches[pi] -= grow * 0.8
                        if k.giant >= GIANT_MAX - 1e-6:
                            self.event(now, "giant", i)
        # bodies bump apart; a full giant flattens whoever it rolls into
        for i, a in enumerate(self.kids):
            if not self.active(i):
                continue
            for j in range(i + 1, len(self.kids)):
                if not self.active(j):
                    continue
                b = self.kids[j]
                dx, dy = b.x - a.x, b.y - a.y
                d = math.hypot(dx, dy)
                if 0 < d < 2 * BODY:
                    push = (2 * BODY - d) / 2
                    a.x -= dx / d * push
                    a.y -= dy / d * push
                    b.x += dx / d * push
                    b.y += dy / d * push
            if a.giant >= 0.5:
                gx, gy = a.x + a.fx * (BODY + GIANT_R * a.giant), a.y + a.fy * (BODY + GIANT_R * a.giant)
                for j, b in enumerate(self.kids):
                    if j == i or not self.active(j) or now < b.frozen_until or now < b.knock_until:
                        continue
                    if math.hypot(b.x - gx, b.y - gy) < BODY + GIANT_R * a.giant:
                        b.knock_until = now + KNOCK_SECS
                        b.vx, b.vy = a.fx * 7, a.fy * 7
                        self.event(now, "flat", j, i, round(gx, 2), round(gy, 2))
                        self.room.add_log(f"⛄ {self.name_of(i)} flattens {self.name_of(j)} with a giant snowball!", "power")
                        if self.pl(i):
                            self.award(self.seats[i], "avalanche")
                        self.hit(j, i, 2, now)
                        a.giant = 0.0
                        break

    @staticmethod
    def push_out(k, r):
        cx = max(r[0], min(r[2], k.x))
        cy = max(r[1], min(r[3], k.y))
        dx, dy = k.x - cx, k.y - cy
        d = math.hypot(dx, dy)
        if d < BODY:
            if d < 1e-6:   # inside: out the nearest side
                opts = [(k.x - r[0], -1, 0), (r[2] - k.x, 1, 0), (k.y - r[1], 0, -1), (r[3] - k.y, 0, 1)]
                m, nx, ny = min(opts)
                k.x += nx * (m + BODY)
                k.y += ny * (m + BODY)
            else:
                k.x += dx / d * (BODY - d)
                k.y += dy / d * (BODY - d)

    def land(self, now):
        keep = []
        for b in self.balls:
            x0, y0, x1, y1, t0, t1, big, by, fort, bid = b
            if now < t1:
                keep.append(b)
                continue
            if fort >= 0 and self.forts[fort] > 0:
                self.forts[fort] = max(0, self.forts[fort] - (2 if big else 1))
                self.event(now, "fort", fort, x1, y1, int(big))
                if self.forts[fort] == 0:
                    self.fort_down[fort] = now
                    self.event(now, "crumble", fort)
                continue
            reach = BIG_SPLASH if big else SPLASH
            hit = False
            for j, o in enumerate(self.kids):
                if j == by or not self.active(j) or now < o.frozen_until:
                    continue
                if math.hypot(o.x - x1, o.y - y1) < reach + BODY * 0.5:
                    hit = True
                    self.event(now, "hit", j, by, x1, y1, int(big))
                    self.hit(j, by, 2 if big else 1, now)
            if not hit:
                self.event(now, "splat", x1, y1, int(big))
        self.balls = keep

    def hit(self, j, by, n, now):
        o = self.kids[j]
        o.pips += n
        self.kids[by].hits += 1
        if o.pips >= PIPS:
            o.pips = 0
            o.frozen_until = now + FROZEN
            o.pack_at = 0.0
            o.giant = 0.0
            self.frozen_ever[j] = True
            self.kids[by].points += 1
            self.event(now, "frozen", j, by)
            self.room.add_log(f"❄️ {self.name_of(by)} snows in {self.name_of(j)}!", "power")
            pts = self.kids[by].points
            if pts and pts % 5 == 0:
                self.moment(f"❄️ {self.name_of(by)}: {pts} snow-ins!", "cool", "good")

    def tick_world(self, dt, now):
        for i, k in enumerate(self.kids):
            if k.ammo < AMMO and now >= k.reload_at:
                if k.reload_at:
                    k.ammo += 1
                k.reload_at = now + RELOAD if k.ammo < AMMO else 0.0
        for fi in range(len(FORTS)):
            if self.forts[fi] <= 0 and now - self.fort_down[fi] > FORT_REGROW:
                # only grow back once nobody is standing in it
                if all(not self.active(i) or seg_hits_rect(k.x, k.y, k.x, k.y, fort_rect(FORTS[fi]), BODY) is None for i, k in enumerate(self.kids)):
                    self.forts[fi] = FORT_HP
                    self.event(now, "regrow", fi)
        for pi in range(len(PATCHES)):
            self.patches[pi] = min(1.0, self.patches[pi] + dt / PATCH_REGROW)
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]

    def end(self):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.active(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        ranked = sorted(here, key=lambda i: (self.kids[i].points, self.kids[i].hits), reverse=True)
        top = ranked[0]
        tied = [i for i in ranked if (self.kids[i].points, self.kids[i].hits) == (self.kids[top].points, self.kids[top].hits)]
        self.stage = "done"
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {self.kids[top].points} between {' & '.join(self.name_of(i) for i in tied)}.")
        if not self.frozen_ever[top] and self.pl(top):
            self.award(self.seats[top], "untouched")
        pts = self.kids[top].points
        more = "" if len(ranked) < 2 or pts > self.kids[ranked[1]].points else f" (most hits: {self.kids[top].hits})"
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins the snowball fight with {pts} snow-in{'s' if pts != 1 else ''}{more}!")

    # -- streaming

    def state(self, now):
        r = lambda v: round(v, 2)  # noqa: E731
        return {
            "st": self.stage, "tl": r(max(0.0, self.end_at - now)), "go": r(max(0.0, self.go_at - now)),
            "k": [[r(k.x), r(k.y), r(k.vx), r(k.vy), r(k.fx), r(k.fy), k.ammo, k.pips,
                   r(max(0.0, k.frozen_until - now)), r(max(0.0, k.knock_until - now)), int(bool(k.pack_at)),
                   r(k.giant), k.points] for k in self.kids],
            "b": [[b[0], b[1], b[2], b[3], r(max(0.0, b[5] - now)), r(b[5] - b[4]), int(b[6]), b[7], b[9]] for b in self.balls],
            "f": self.forts, "p": [r(v) for v in self.patches],
        }

    def broadcast(self, now):
        d = self.state(now)
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.room.push_fast(d)

    # -- bots

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, eager, err, dodge, cover = BOT.get(level, BOT["normal"])
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        k = self.kids[i]
        if not self.can_act(k, now):
            k.sx = k.sy = 0.0
            return
        j = self.target_of(i)
        gx, gy = k.x, k.y
        if j is not None:
            t = self.kids[j]
            d = math.hypot(t.x - k.x, t.y - k.y) or 1e-6
            # keep a lobbing distance
            want = 5.5
            gx = k.x + (t.x - k.x) / d * (d - want)
            gy = k.y + (t.y - k.y) / d * (d - want)
            if cover:   # hard: a spot behind the fort nearest to it, away from the target
                best = None
                for fi, f in enumerate(FORTS):
                    if self.forts[fi] <= 0:
                        continue
                    fx, fy = f[0], f[1]
                    ax, ay = fx - t.x, fy - t.y
                    m = math.hypot(ax, ay) or 1
                    sx, sy = fx + ax / m * 0.9, fy + ay / m * 0.9
                    c = math.hypot(sx - k.x, sy - k.y) + 0.3 * abs(math.hypot(sx - t.x, sy - t.y) - want)
                    if best is None or c < best[0]:
                        best = (c, sx, sy)
                if best and best[0] < 6:
                    gx, gy = best[1], best[2]
            # roll a giant when a patch is near and fresh
            if self.s.get("giants", True) and k.giant < GIANT_MAX and level != "easy":
                for pi, (px, py) in enumerate(PATCHES):
                    if self.patches[pi] > 0.5 and math.hypot(px - k.x, py - k.y) < 3.5:
                        gx, gy = px + math.cos(now * 2) * 0.9, py + math.sin(now * 2) * 0.9
            if k.giant >= GIANT_MAX - 0.05:   # charge at the target with it
                gx, gy = t.x, t.y
        # dodge shadows that will land on me soon
        if dodge:
            for b in self.balls:
                if b[7] == i or b[8] >= 0:
                    continue
                if math.hypot(b[2] - k.x, b[3] - k.y) < (BIG_SPLASH if b[6] else SPLASH) + BODY and b[5] - now < 0.7:
                    ax, ay = k.x - b[2], k.y - b[3]
                    m = math.hypot(ax, ay) or 1e-6
                    if m < 1e-3:
                        ax, ay = -k.fy, k.fx
                        m = 1
                    gx, gy = k.x + ax / m * 3, k.y + ay / m * 3
                    break
        dx, dy = gx - k.x, gy - k.y
        m = math.hypot(dx, dy)
        k.sx, k.sy = (dx / m, dy / m) if m > 0.3 else (0.0, 0.0)
        if m <= 0.3 and j is not None:  # face the target while standing
            t = self.kids[j]
            d = math.hypot(t.x - k.x, t.y - k.y) or 1e-6
            k.fx, k.fy = (t.x - k.x) / d, (t.y - k.y) / d
        # throw now and then (with aim error)
        if j is not None and k.ammo > 0 and now >= k.cool_until and random.random() < eager * react:
            t = self.kids[j]
            big = level != "easy" and k.ammo >= 2 and random.random() < 0.25
            self.throw(i, now, big, (t.x + random.gauss(0, err), t.y + random.gauss(0, err)))

    def bot_ready(self):
        return False   # bots think inside frame()

    # -- the rest of the contract

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} went home to dry off.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")
        elif i is not None:
            self.kids[i].sx = self.kids[i].sy = 0.0

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None or not hasattr(self, "kids") else f"❄️ {self.kids[i].points}"

    def final_scores(self):
        return {pid: self.kids[i].points for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"snowball": {
            **self.state(now), "seats": self.seats, "me": self.seat(p), "len": int(self.s.get("time", 120)),
            "aw": AW, "ah": AH, "body": BODY, "forts": FORTS, "fortLen": FORT_LEN, "fortThick": FORT_THICK, "fortHp": FORT_HP,
            "patches": PATCHES, "patchR": PATCH_R, "ammoMax": AMMO, "pips": PIPS, "bigHold": BIG_HOLD, "giantR": GIANT_R,
            "giants": bool(self.s.get("giants", True)), "seq": self.ev_seq, "splash": [SPLASH, BIG_SPLASH],
        }}
