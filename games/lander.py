"""Moon Lander: an original lunar-landing contest for 1–6 players, everyone flying at once.

Each round drops everyone over the same stretch of moon with three landing pads: a wide ×1 pad, a ×2 and a narrow ×3
perched somewhere awkward. Rotate and fire your one engine to come down softly on a pad: under 2.5 m/s down,
1.5 m/s sideways and 11° of tilt, or it's a crash. A landing scores the pad's multiplier × (50 + up to 30 for a
soft touchdown + up to 20 for landing near the middle). Fuel carries over: the tank gets a top-up each round, so
fuel burnt hovering now is fuel you won't have later.

Every browser flies its own lander on a fixed 30 Hz tick and sends its input log when it touches down; the server
replays the log with the same integrator and judges the landing (its word is final). The angle moves in whole steps
and the server hands out the sine/cosine table, so both sides do exactly the same arithmetic. Rivals show as ghost
landers: humans post their position as they fly, and bots' planned flights are played back on the server clock.
"""
import math
import random
import time

from .base import Game, GameError

DT = 1 / 30
G = 1.62               # moon gravity, m/s²
THRUST = 4.2           # engine acceleration, m/s²
ROT_STEP = 0.075       # radians per tick of rotation
K_MAX = 24             # the most the lander leans, in steps (≈103°)
W, SEG = 160.0, 2.0    # terrain width (m) and heightfield spacing
NPTS = int(W / SEG) + 1
START_Y = 75.0
CEILING = 140.0
VY_OK, VX_OK, ANG_OK = 2.5, 1.5, 0.2   # landing limits
FOOT = 1.1             # half the lander's foot spread: both feet must be on the pad
PADS = ((1, 7), (2, 5), (3, 3))        # multiplier, width in segments
MAX_TICKS = int(45 / DT)
TANK0, REFILL, TANK_MAX = 24 * 30, 14 * 30, 36 * 30   # fuel, in ticks of burn
COUNT, BETWEEN, SETTLE = 3.0, 6.0, 1.2
GHOST_HZ = 10
BOT = {  # think every n ticks, pad choice, touchdown speed aimed for, gain noise, approach speed cap
    "easy": (6, 1, 2.0, 0.35, 4.5),
    "normal": (3, 2, 1.4, 0.15, 6.0),
    "hard": (1, 3, 1.0, 0.04, 7.0),
}
SIN = [math.sin(k * ROT_STEP) for k in range(-K_MAX, K_MAX + 1)]
COS = [math.cos(k * ROT_STEP) for k in range(-K_MAX, K_MAX + 1)]


def make_moon(rng):
    """A heightfield (NPTS heights), three pads [x_left, x_right, height, mult] and a start (x, vx)."""
    h = []
    phase = [rng.uniform(0, math.tau) for _ in range(4)]
    base = rng.uniform(14, 22)
    walk = 0.0
    for i in range(NPTS):
        x = i * SEG
        walk = max(-6.0, min(6.0, walk + rng.uniform(-1.6, 1.6)))
        y = (base + 7 * math.sin(x / 23 + phase[0]) + 4 * math.sin(x / 9.5 + phase[1]) + 2.2 * math.sin(x / 4.1 + phase[2])
             + 9 * max(0.0, math.sin(x / 31 + phase[3])) ** 3 + walk)
        h.append(round(max(3.0, min(42.0, y)), 2))
    # three pads in three different thirds of the moon; the ×3 goes on the highest ground of its third
    thirds = [0, 1, 2]
    rng.shuffle(thirds)
    pads = []
    span = (NPTS - 1) // 3
    for (mult, wseg), third in zip(PADS, thirds):
        lo, hi = third * span + 3, (third + 1) * span - wseg - 3
        if mult == 3:
            i0 = max(range(lo, hi + 1), key=lambda i: sum(h[i:i + wseg + 1]))
        else:
            i0 = rng.randint(lo, hi)
        top = round(sum(h[i0:i0 + wseg + 1]) / (wseg + 1) + (2.0 if mult == 3 else 0.0), 2)
        for i in range(i0, i0 + wseg + 1):
            h[i] = top
        # soften the ground next to the pad so it isn't a cliff (unless it's the ×3: a mesa)
        if mult != 3:
            for d in (1, 2):
                for i in (i0 - d, i0 + wseg + d):
                    if 0 <= i < NPTS:
                        h[i] = round((h[i] * d + top) / (d + 1), 2)
        pads.append([i0 * SEG, (i0 + wseg) * SEG, top, mult])
    x0 = rng.uniform(25, W - 25)
    vx0 = rng.uniform(-4, 4)
    return h, pads, (round(x0, 2), round(vx0, 2))


def ground(h, x):
    i = int(x // SEG)
    i = max(0, min(NPTS - 2, i))
    f = x / SEG - i
    return h[i] + (h[i + 1] - h[i]) * f


def judge(pads, x, vx, vy, k):
    """What a touchdown at (x, vx, vy, lean k) scores: (how, pad index or -1, points, softness, precision)."""
    for n, (l, r, top, mult) in enumerate(pads):
        if l + FOOT <= x <= r - FOOT:
            ang = abs(k) * ROT_STEP
            if -vy <= VY_OK and abs(vx) <= VX_OK and ang <= ANG_OK:
                soft = max(0.0, 1 - (-vy) / VY_OK)
                half = (r - l) / 2 - FOOT
                prec = max(0.0, 1 - abs(x - (l + r) / 2) / half) if half > 0 else 1.0
                return "land", n, int(round(mult * (50 + 30 * soft + 20 * prec))), soft, prec
            return "crash", n, 0, 0.0, 0.0
    return "crash", -1, 0, 0.0, 0.0


def fly(h, pads, start, fuel, log, path_every=0):
    """Replay an input log: [[tick, bits], …] where bits = thrust + 2 × (rot + 1) applies from that tick on.
    Returns a result dict; with path_every, also every n-th tick's [x, y, k, thrust] (for ghosts)."""
    x, vx = start
    y, vy, k = START_Y, 0.0, 0
    thrust, rot = 0, 0
    li = 0
    path = []
    for t in range(MAX_TICKS):
        while li < len(log) and log[li][0] <= t:
            bits = log[li][1]
            thrust, rot = bits & 1, (bits >> 1) - 1
            li += 1
        k = max(-K_MAX, min(K_MAX, k + rot))
        on = thrust and fuel > 0
        if on:
            vx += SIN[k + K_MAX] * THRUST * DT
            vy += COS[k + K_MAX] * THRUST * DT
            fuel -= 1
        vy -= G * DT
        x += vx * DT
        y += vy * DT
        if x < 1.0:
            x, vx = 1.0, 0.0
        elif x > W - 1.0:
            x, vx = W - 1.0, 0.0
        if y > CEILING:
            y, vy = CEILING, min(vy, 0.0)
        if path_every and t % path_every == 0:
            path.append([round(x, 2), round(y, 2), k, 1 if on else 0])
        gy = ground(h, x)
        if y <= gy:
            how, pad, pts, soft, prec = judge(pads, x, vx, vy, k)
            if path_every:
                path.append([round(x, 2), round(gy, 2), k, 0])
            return {"how": how, "pad": pad, "pts": pts, "ticks": t + 1, "x": round(x, 2), "vx": round(vx, 2),
                    "vy": round(vy, 2), "k": k, "fuel": fuel, "soft": round(soft, 2), "prec": round(prec, 2), "path": path}
    return {"how": "lost", "pad": -1, "pts": 0, "ticks": MAX_TICKS, "x": round(x, 2), "vx": round(vx, 2), "vy": round(vy, 2),
            "k": k, "fuel": fuel, "soft": 0, "prec": 0, "path": path}


def autopilot(h, pads, start, fuel, level, rng):
    """A bot's flight: a PD controller toward a chosen pad, deciding every few ticks, with shaky gains.
    Returns the input log it would have pressed (so the server judges it exactly like a human's)."""
    every, want, touch, noise, vcap = BOT.get(level, BOT["normal"])
    # pick a pad: the bot's favourite multiplier, or a lower one if the tank is low
    cands = sorted(range(len(pads)), key=lambda n: -pads[n][3])
    pref = [n for n in cands if pads[n][3] <= want]
    if fuel < 10 * 30:
        pref = [n for n in cands if pads[n][3] == 1] or pref
    n = pref[0] if pref else cands[-1]
    l, r, top, _ = pads[n]
    px = (l + r) / 2 + rng.uniform(-1, 1) * ((r - l) / 2 - FOOT) * (0.6 if level == "easy" else 0.25)
    gx, gk, gv = (1 + rng.gauss(0, noise) for _ in range(3))
    x, vx = start
    y, vy, k = START_Y, 0.0, 0
    log, bits_now = [], None
    thrust = rot = 0
    for t in range(MAX_TICKS):
        if t % every == 0:
            dx = px - x
            alt = y - max(top, ground(h, x))
            over = abs(dx) < (r - l) / 2 - FOOT - 0.3
            # clear the terrain between here and the pad: keep above the highest ground on the way
            lo_x, hi_x = sorted((x, px))
            peak = max(h[max(0, int(lo_x // SEG)):min(NPTS, int(hi_x // SEG) + 2)] or [top])
            clear = y - peak
            want_vx = max(-vcap, min(vcap, dx * 0.22 * gx))
            if abs(dx) < 3:
                want_vx = dx * 0.4
            want_k = max(-9, min(9, round((want_vx - vx) * 2.2 * gk)))
            if alt < 7 or (over and abs(vx) < 0.6):
                want_k = max(-2, min(2, round((want_vx - vx) * 1.2))) if alt > 2.5 else 0
            if not over and clear < 12:
                want_vy = 1.0                 # climb over the ridge first
            elif not over:
                want_vy = -min(3.0, max(0.5, clear * 0.1))
            else:
                want_vy = -max(touch, min(7.0, alt * 0.32 * gv))
            thrust = 1 if (vy < want_vy or (abs(want_k - k) <= 1 and abs(want_vx - vx) > 1.5 and vy < want_vy + 2)) else 0
            rot = (want_k > k) - (want_k < k)
            b = thrust + 2 * (rot + 1)
            if b != bits_now:
                log.append([t, b])
                bits_now = b
        # step exactly as fly() does
        k = max(-K_MAX, min(K_MAX, k + rot))
        on = thrust and fuel > 0
        if on:
            vx += SIN[k + K_MAX] * THRUST * DT
            vy += COS[k + K_MAX] * THRUST * DT
            fuel -= 1
        vy -= G * DT
        x += vx * DT
        y += vy * DT
        if x < 1.0:
            x, vx = 1.0, 0.0
        elif x > W - 1.0:
            x, vx = W - 1.0, 0.0
        if y > CEILING:
            y, vy = CEILING, min(vy, 0.0)
        if y <= ground(h, x):
            break
    return log


class Lander(Game):
    id = "lander"
    category = "action"
    family = None
    howto = [
        "Everyone flies at once over the same stretch of moon. Hold 🔥 (or ↑ / Space) to fire the engine, ◀ ▶ (or ← →) to lean.",
        "Touch down on a pad gently: under 2.5 m/s down, 1.5 m/s sideways, nearly upright. Anything else is a crash.",
        "Pads score ×1, ×2 or ×3 (the narrow, awkward one) × (50 + softness up to 30 + aim up to 20).",
        "Fuel carries over: the tank only gets a top-up each round, so don't waste it hovering.",
        "Most points after the last round wins.",
    ]
    name = "Moon Lander"
    icon = "🚀"
    blurb = "Everyone lands at once: lean, burn, touch down softly on the ×3 pad. Fuel carries over between rounds."
    min_players = 1
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "feather": ("🪶", "Feather", "Touch down at under 0.5 m/s"),
              "bullseye": ("🎯", "Bullseye", "Land dead centre on a ×3 pad")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5"), (3, "3"), (7, "7")], 5),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.rounds = int(self.s.get("rounds", 5))
        self.round_no = 0
        self.ghost_at = 0.0
        for p in seated:
            p.g.points, p.g.fuel, p.g.best = 0, TANK0, 0
            p.g.lands = 0
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🚀 Moon Lander: {self.rounds} rounds. Land softly; fuel carries over!", "big")
        self.new_round(time.time())

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players]

    def present(self):
        return [p for p in self.players() if not p.eliminated]

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def new_round(self, now):
        r = self.room
        self.mark_round()
        self.round_no += 1
        self.h, self.pads, self.start_xv = make_moon(self.rng)
        self.stage = "count"
        self.t0 = now + COUNT
        r.deadline = self.t0
        for p in self.players():
            g = p.g
            if self.round_no > 1:
                g.fuel = min(TANK_MAX, g.fuel + REFILL)
            g.tank = g.fuel                 # what this round's flight starts with
            g.res = None                    # this round's result
            g.ghost = None                  # [x, y, k, thrust] as last posted
            g.plan = None                   # a bot's planned flight: (result, path)
        r.add_log(f"🌕 Round {self.round_no} of {self.rounds}: pads ×1, ×2 and ×3. Get ready…", "info")

    # -- flying

    def act(self, p, a):
        if a.get("type") != "land":
            raise GameError("Unknown action.")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're watching this one.")
        if self.stage != "fly":
            raise GameError("Not flying right now.")
        if p.g.res is not None:
            raise GameError("You've already come down this round.")
        log = a.get("log")
        if not isinstance(log, list) or len(log) > 3000:
            raise GameError("Bad flight log.")
        last = -1
        for e in log:
            if (not isinstance(e, list) or len(e) != 2 or not all(isinstance(v, int) and not isinstance(v, bool) for v in e)
                    or e[0] <= last or not 0 <= e[0] < MAX_TICKS or not 0 <= e[1] <= 5):
                raise GameError("Bad flight log.")
            last = e[0]
        res = fly(self.h, self.pads, self.start_xv, p.g.tank, log)
        # the flight must have taken (about) as long as it says
        if res["ticks"] * DT > time.time() - self.t0 + 3.0:
            raise GameError("That flight was too quick.")
        self.done(p, res, time.time())

    def on_input(self, p, a):
        """A human's lander position while flying (for everyone else's ghost view)."""
        if p.id not in self.seats or p.eliminated or self.stage != "fly" or p.g.res is not None:
            return
        g = a.get("at")
        if not (isinstance(g, list) and len(g) == 4 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in g)):
            raise GameError("Bad position.")
        p.g.ghost = [round(max(0.0, min(W, g[0])), 2), round(max(-5.0, min(CEILING + 5, g[1])), 2), int(max(-K_MAX, min(K_MAX, g[2]))), 1 if g[3] else 0]

    def done(self, p, res, now):
        g = p.g
        res = {k: v for k, v in res.items() if k != "path"}
        g.res = res
        g.fuel = res["fuel"]
        g.points += res["pts"]
        g.best = max(g.best, res["pts"])
        g.ghost = None
        r = self.room
        if res["how"] == "land":
            g.lands += 1
            mult = self.pads[res["pad"]][3]
            r.add_log(f"🛬 {p.name} lands on the ×{mult} pad at {-res['vy']:.1f} m/s: +{res['pts']}.", "info")
            if -res["vy"] < 0.5:
                self.award(p, "feather")
            if mult == 3 and res["prec"] >= 0.9:
                self.award(p, "bullseye")
            if mult == 3:
                self.moment(f"🎯 {p.name} sticks the ×3 landing! +{res['pts']}", "gold", "good")
        elif res["how"] == "crash":
            why = ("off the pads" if res["pad"] < 0 else "too fast" if -res["vy"] > VY_OK else "sliding sideways"
                   if abs(res["vx"]) > VX_OK else "tilted over")
            r.add_log(f"💥 {p.name} crashes ({why}).", "info")
        else:
            r.add_log(f"🛰️ {p.name} drifts off into space.", "info")
        here = self.present()
        if all(o.g.res is not None for o in here) and self.stage == "fly":
            self.stage = "settle"
            r.deadline = now + SETTLE

    def frame(self, now):
        """Bots fly their planned flights on the clock; ghost positions stream ~10 times a second."""
        r = self.room
        if r.phase != "playing":
            return False
        if r.deadline and now > r.deadline:     # (the room's ticker does this too; simulate.py only calls frame)
            self.on_timeout(now)
            return True
        if self.stage != "fly":
            return False
        changed = False
        t = now - self.t0
        for p in self.present():
            g = p.g
            if not p.bot or g.res is not None:
                continue
            if g.plan is None:
                log = autopilot(self.h, self.pads, self.start_xv, g.tank, p.bot, random)
                res = fly(self.h, self.pads, self.start_xv, g.tank, log, path_every=3)
                g.plan = (res, max(0.0, t))           # a stand-in who took over late starts from now
            res, since = g.plan
            k = int((t - since) / DT)
            if k >= res["ticks"]:
                self.done(p, res, now)
                changed = True
            else:
                path = res["path"]
                g.ghost = path[min(len(path) - 1, k // 3)]
        if now - self.ghost_at >= 1 / GHOST_HZ:
            self.ghost_at = now
            self.room.push_fast({"gh": {str(self.seats.index(p.id)): p.g.ghost for p in self.present() if p.g.ghost and p.id in self.seats},
                                 "rd": self.round_no})
        return changed

    def end_round(self, now):
        r = self.room
        here = self.present()
        self.stage = "between"
        r.deadline = now + BETWEEN
        for o in here:
            if o.g.res is None:
                o.g.res = {"how": "lost", "pad": -1, "pts": 0, "ticks": MAX_TICKS, "x": 0, "vx": 0, "vy": 0, "k": 0,
                           "fuel": o.g.fuel, "soft": 0, "prec": 0}
                r.add_log(f"⏰ {o.name} never touched down.", "info")
        if here:
            r.add_log(f"🌕 Round {self.round_no}: " + ", ".join(f"{o.name} {o.g.res['pts']}" for o in sorted(here, key=lambda o: -o.g.res["pts"])) + ".", "big")

    def after_round(self, now):
        r = self.room
        here = self.present()
        if not here:
            return r.finish(None, "Everyone left.")
        if self.round_no >= self.rounds:
            key = lambda o: (o.g.points, o.g.best, o.g.lands)  # noqa: E731
            ranked = sorted(here, key=key, reverse=True)
            top = ranked[0]
            tied = [o for o in ranked if key(o) == key(top)]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {top.g.points} points between {' & '.join(o.name for o in tied)}.")
            return r.finish(top, f"🏆 {top.name} wins Moon Lander with {top.g.points} points!")
        self.new_round(now)

    def on_timeout(self, now=None):
        now = time.time() if now is None else now
        r = self.room
        if r.phase != "playing":
            return
        if self.stage == "count":
            self.stage = "fly"
            r.deadline = self.t0 + MAX_TICKS * DT + 1.0
            return
        if self.stage in ("fly", "settle"):
            # (simulate.py: bots whose flights are still playing back land now)
            for p in self.present():
                if p.bot and p.g.res is None:
                    if p.g.plan is None:
                        log = autopilot(self.h, self.pads, self.start_xv, p.g.tank, p.bot, random)
                        p.g.plan = (fly(self.h, self.pads, self.start_xv, p.g.tank, log), 0.0)
                    self.done(p, p.g.plan[0], now)
            return self.end_round(now)
        return self.after_round(now)

    def bot_ready(self):
        return False   # bots fly inside frame()

    def on_restore(self, shift):
        self.t0 += shift

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} heads back to Earth.")
        left = r.contenders()
        if not left:
            return r.finish(None, "Everyone left.")
        if len(left) == 1 and len(self.seats) > 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if self.stage == "fly" and all(o.g.res is not None for o in self.present()):
            self.stage = "settle"
            r.deadline = time.time() + SETTLE

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "points"):
            return ""
        return f"{p.g.points} pts · ⛽ {p.g.fuel // 30}s"

    def final_scores(self):
        return {o.id: o.g.points for o in self.players()}

    def view(self, p):
        now = time.time()
        r = self.room
        fliers = []
        for i, pid in enumerate(self.seats):
            o = r.players.get(pid)
            g = o.g if o else None
            fliers.append({"points": getattr(g, "points", 0), "fuel": getattr(g, "fuel", 0), "tank": getattr(g, "tank", 0),
                           "res": getattr(g, "res", None), "out": not o or o.eliminated})
        me = self.seat(p)
        return {"lander": {
            "seats": self.seats, "me": me, "round": self.round_no, "rounds": self.rounds, "stage": self.stage,
            "startIn": max(0.0, round(self.t0 - now, 2)) if self.stage == "count" else 0,
            "flown": max(0.0, round(now - self.t0, 2)) if self.stage in ("fly", "settle") else 0,
            "h": self.h, "pads": self.pads, "start": list(self.start_xv), "fliers": fliers,
            "standings": self.standings() if self.stage == "between" and len(self.seats) > 1 else None,
            "geo": {"dt": DT, "g": G, "thrust": THRUST, "rot": ROT_STEP, "kMax": K_MAX, "w": W, "seg": SEG, "startY": START_Y,
                    "ceiling": CEILING, "vyOk": VY_OK, "vxOk": VX_OK, "angOk": ANG_OK, "foot": FOOT, "maxTicks": MAX_TICKS,
                    "sin": SIN, "cos": COS, "tankMax": TANK_MAX},
        }}
