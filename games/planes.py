"""Paper Planes: an original paper-plane throwing contest for 2–6 players, everyone throwing at once.

Each round sets one challenge in a park: 📏 longest throw, ⭕ through the hoop, 🎯 land on the picnic blanket,
💫 through the rings, ⏱ longest time in the air. Everybody throws in the same park at the same time, two planes each,
and the better plane counts. Before each throw you pick a fold:

- 🎯 Dart: fast and straight; the wind barely touches it, but it comes down sooner.
- 🕊 Glider: slow and floaty; rides a long way and soars on warm air, but the wind pushes it about.
- 🌀 Stunt: loops when thrown hard and high, and curls to the right (aim left).

The wind blows the same for everyone in a round (the windsock shows it) and every throw meets its own small gust.
🔥 Warm air rises over the barbecue grills: a plane that crosses one gets lifted. 📎 Once a game, clip a paperclip
on: that throw flies true, with no wobble and no gust.

Flights are simulated on the server (a point-mass glider: lift, drag, gravity, the wind and the updrafts), and the
browsers play the sampled path back, so everyone sees what scored.
"""
import math
import random
import time

from .base import Game, GameError

G = 9.8
H0 = 1.6              # the hand is this high
DT = 0.02
T_MAX = 12.0
FIELD = 60.0          # metres downrange shown
# fold -> (lift coefficient, drag coefficient, launch speed ×, wind effect ×, wobble σ (radians), curl rad/s, most lift in g)
FOLDS = {
    "dart":   (0.11, 0.016, 1.15, 0.25, 0.025, 0.0, 1.5),
    "glider": (0.30, 0.030, 0.85, 0.6, 0.035, 0.0, 1.6),
    "stunt":  (0.24, 0.026, 1.0, 0.45, 0.06, 0.10, 3.0),
}
FOLD_NAMES = {"dart": "🎯 Dart", "glider": "🕊 Glider", "stunt": "🌀 Stunt"}
SPEED = (4.0, 15.0)   # launch speed range (m/s) for power 0..1
PITCH = (-10.0, 50.0) # degrees
YAW = 30.0            # degrees each way
GOALS = ("far", "hoop", "blanket", "rings", "air")
GOAL_NAMES = {"far": "📏 Longest throw", "hoop": "⭕ Through the hoop", "blanket": "🎯 Picnic blanket",
              "rings": "💫 Through the rings", "air": "⏱ Longest flight"}
THROWS = 2
COUNT = 3.0
CLOCK = 35.0
BETWEEN = 6.0
SETTLE_PAD = 0.8
HOOP_R = 1.0
RING_R = 1.2
BLANKET = (1.0, 2.0, 3.5, 5.0)   # bullseye bands (m): 50 / 35 / 20 / 10
BLANKET_PTS = (50, 35, 20, 10)
VENT_R, VENT_TOP = 3.2, 9.0
WINDS = {"calm": (0.0, 1.2, 0.08), "breezy": (1.0, 3.0, 0.15), "gusty": (2.5, 5.0, 0.28)}

BOT_SIG = {"easy": (4.0, 4.0, 0.08), "normal": (2.0, 2.0, 0.04), "hard": (0.9, 0.9, 0.018)}   # pitch°, yaw°, power
BOT_PACE = {"easy": (4.0, 7.0), "normal": (3.0, 5.5), "hard": (2.0, 4.0)}
BOT_SAMPLES = {"easy": 5, "normal": 12, "hard": 18}


def fly(fold, pitch, yaw, power, wind, vents, jitter=(0.0, 0.0, 0.0), gust=0.0):
    """Simulate one throw. pitch/yaw in degrees, power 0..1, wind (wx, wz) m/s, vents [(x, z, up)].
    jitter: (pitch rad, yaw rad, lift ×) from the wobble. Returns (path [(t, x, y, z)], landed (x, z), airtime)."""
    cl, cd, spd, wmul, _, curl, lmax = FOLDS[fold]
    cl *= 1.0 + jitter[2]
    # the plane's own state, relative to the air: speed V, climb angle gam (it can loop right over), heading psi
    V = (SPEED[0] + (SPEED[1] - SPEED[0]) * power) * spd
    gam = math.radians(pitch) + jitter[0]
    psi = math.radians(yaw) + jitter[1]
    x, y, z = 0.0, H0, 0.0
    wx, wz = wind[0] * wmul * (1 + gust), wind[1] * wmul * (1 + gust)
    lift_vent = 0.6 if fold == "dart" else wmul
    t = 0.0
    path = [(0.0, x, y, z)]
    while t < T_MAX:
        # paper flexes when it's thrown too hard: the lift tops out
        L = min(cl * V * V, lmax * G)
        V += (-cd * V * V - G * math.sin(gam)) * DT
        V = max(V, 0.3)
        gam += (L - G * math.cos(gam)) / V * DT
        if curl:
            psi += curl * min(1.0, V / 8.0) * DT       # a stunt plane banks right while it's fast
        # warm air rising over a grill carries the plane up with it
        uy = 0.0
        for vx0, vz0, up in vents:
            d2 = (x - vx0) ** 2 + (z - vz0) ** 2
            if d2 < VENT_R * VENT_R and y < VENT_TOP:
                uy += up * (1 - d2 / (VENT_R * VENT_R)) * (1 - y / VENT_TOP) * lift_vent
        hv = V * math.cos(gam)
        x += (hv * math.cos(psi) + wx) * DT
        z += (hv * math.sin(psi) + wz) * DT
        y += (V * math.sin(gam) + uy) * DT
        t += DT
        if y <= 0:
            # step back to the ground
            py = path[-1][2]
            f = py / (py - y) if py > y else 1.0
            px, pz = path[-1][1], path[-1][3]
            x = px + (x - px) * f
            z = pz + (z - pz) * f
            t = path[-1][0] + DT * f
            path.append((t, x, 0.0, z))
            break
        path.append((t, x, y, z))
    return path, (path[-1][1], path[-1][3]), path[-1][0]


def thin(path, n=60):
    """At most n samples of a path, always keeping the last."""
    if len(path) <= n:
        return [[round(v, 3) for v in q] for q in path]
    step = (len(path) - 1) / (n - 1)
    return [[round(v, 3) for v in path[round(k * step)]] for k in range(n)]


def crossings(path, gate_x, gy, gz, r):
    """Does the path pass through a vertical ring at x = gate_x centred (gy, gz) with radius r? (hit, miss distance)"""
    best = 1e9
    for (t0, x0, y0, z0), (t1, x1, y1, z1) in zip(path, path[1:]):
        if (x0 - gate_x) * (x1 - gate_x) <= 0 and x1 != x0:
            f = (gate_x - x0) / (x1 - x0)
            y, z = y0 + (y1 - y0) * f, z0 + (z1 - z0) * f
            best = min(best, math.hypot(y - gy, z - gz))
    return best <= r, best


def score(goal, targets, path, land, air):
    """(points, details) for a flight in this round's challenge."""
    if goal == "far":
        return max(0, round(land[0])), {"far": round(land[0], 1)}
    if goal == "air":
        return round(air * 10), {"air": round(air, 2)}
    if goal == "blanket":
        bx, bz = targets["blanket"]
        d = math.hypot(land[0] - bx, land[1] - bz)
        pts = next((p for r, p in zip(BLANKET, BLANKET_PTS) if d <= r), 0)
        return pts, {"off": round(d, 2)}
    if goal == "hoop":
        hx, hy, hz = targets["hoop"]
        hit, miss = crossings(path, hx, hy, hz, HOOP_R)
        if hit:
            return 60, {"hoop": True}
        # near misses still count a little, so every throw means something
        return max(0, round(20 - 4 * (miss - HOOP_R))) if miss < 1e8 else 0, {"miss": round(miss, 2) if miss < 1e8 else None}
    if goal == "rings":
        through = []
        for k, (gx, gy, gz) in enumerate(targets["rings"]):
            if crossings(path, gx, gy, gz, RING_R)[0]:
                through.append(k)
        pts = 20 * len(through) + (20 if len(through) == len(targets["rings"]) else 0)
        return pts, {"rings": through}
    return 0, {}


class Planes(Game):
    id = "planes"
    category = "action"
    family = None
    howto = [
        "Each round is one challenge in the park, and everyone throws at once: two paper planes each, the better one counts.",
        "Pick a fold: 🎯 Dart flies fast and straight, 🕊 Glider floats far but the wind pushes it, 🌀 Stunt loops when thrown hard and high and curls right.",
        "Swipe up on the park to throw: sideways aims, a longer swipe throws harder. ▲ ▼ set the loft (how steeply it climbs).",
        "Watch the windsock: the wind is the same for everyone this round. 🔥 Warm air over the grills lifts a plane that crosses it.",
        "📎 Once a game, clip on a paperclip: that throw flies true, with no wobble and no gust. Most points after the last round wins.",
    ]
    name = "Paper Planes"
    icon = "✈️"
    blurb = "Fold a dart, a glider or a stunt plane and throw it through hoops, onto the blanket or as far as it will go."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "hoop": ("⭕", "Threaded", "Fly a plane through the hoop"),
              "allrings": ("💫", "Ring run", "Fly through every ring in one throw"),
              "bull": ("🧺", "Picnic bullseye", "Land in the middle of the blanket")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5 (one of each)"), (3, "3"), (8, "8")], 5),
        "wind": ("Wind", [("breezy", "🍃 Breezy"), ("calm", "🪶 Calm"), ("gusty", "🌬 Gusty")], "breezy"),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.shot_id = 0
        self.round_no = 0
        self.stage = "count"
        self.t0 = time.time()
        n = self.total
        order = []
        while len(order) < n:
            run = list(GOALS)
            rng.shuffle(run)
            if order and run[0] == order[-1]:
                run.reverse()
            order += run
        self.order = order[:n]
        for p in seated:
            p.g.points, p.g.best_round, p.g.clip = 0, 0, True
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"✈️ Paper Planes: {n} rounds, {THROWS} planes each per round. Fold well!", "big")
        self.new_round()

    @property
    def total(self):
        v = self.s.get("rounds", 5)
        return v if v in (3, 5, 8) else 5

    @property
    def wind_set(self):
        return WINDS.get(self.s.get("wind", "breezy"), WINDS["breezy"])

    @property
    def goal(self):
        return self.order[self.round_no - 1]

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players]

    def present(self):
        return [p for p in self.players() if not p.eliminated]

    def new_round(self):
        r, rng = self.room, self.rng
        self.mark_round()
        self.round_no += 1
        goal = self.goal
        self.stage = "count"
        self.t0 = time.time() + COUNT
        r.deadline = self.t0
        lo, hi, _ = self.wind_set
        sp = rng.uniform(lo, hi)
        ang = rng.uniform(-math.pi, math.pi)
        if goal == "far":
            ang = rng.uniform(-0.9, 0.9) if rng.random() < 0.6 else ang      # more often a tail wind for the long throw
        self.wind = (round(sp * math.cos(ang), 2), round(sp * math.sin(ang), 2))
        # one or two grills, somewhere down the park
        self.vents = []
        for _ in range(rng.choice((1, 2)) if goal != "air" else 2):
            self.vents.append((round(rng.uniform(8, 26), 2), round(rng.uniform(-6, 6), 2), round(rng.uniform(2.2, 3.6), 2)))
        t = {}
        if goal == "hoop":
            t["hoop"] = (round(rng.uniform(9, 16), 2), round(rng.uniform(1.4, 2.6), 2), round(rng.uniform(-3, 3), 2))
        elif goal == "blanket":
            t["blanket"] = (round(rng.uniform(12, 22), 2), round(rng.uniform(-4, 4), 2))
        elif goal == "rings":
            z = rng.uniform(-2, 2)
            rings = []
            for k, gx in enumerate((6.0, 11.0, 16.0)):
                z += rng.uniform(-1.4, 1.4)
                rings.append((gx + rng.uniform(-0.6, 0.6), round(2.4 - 0.45 * k + rng.uniform(-0.3, 0.3), 2), round(z, 2)))
            t["rings"] = [tuple(round(v, 2) for v in q) for q in rings]
        self.targets = t
        for p in self.players():
            g = p.g
            g.left = THROWS
            g.shots = []
            g.round_pts = 0
            g.busy_until = 0.0
            g.next_at = self.t0 + random.uniform(1.0, 3.0)
        r.add_log(f"🏁 Round {self.round_no} of {self.total}: {GOAL_NAMES[goal]}. Wind {self.wind_desc()}.", "info")

    def wind_desc(self):
        wx, wz = self.wind
        sp = math.hypot(wx, wz)
        if sp < 0.5:
            return "still"
        d = ("behind you" if wx > abs(wz) else "in your face" if -wx > abs(wz)
             else "from the left" if wz > 0 else "from the right")
        return f"{round(sp * 3.6)} km/h {d}"

    def on_restore(self, shift):
        self.t0 += shift
        for p in self.players():
            if hasattr(p.g, "next_at"):
                p.g.next_at += shift
                p.g.busy_until += shift

    # -- throwing

    def act(self, p, a):
        if a.get("type") != "throw":
            raise GameError("Unknown action.")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're watching this one.")
        fold, pitch, yaw, power, clip = a.get("fold"), a.get("pitch"), a.get("yaw"), a.get("power"), a.get("clip", False)
        if fold not in FOLDS or not isinstance(clip, bool):
            raise GameError("Bad throw.")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (pitch, yaw, power)):
            raise GameError("Bad throw.")
        if not PITCH[0] <= pitch <= PITCH[1] or abs(yaw) > YAW or not 0 <= power <= 1:
            raise GameError("Bad throw.")
        if self.stage == "count":
            raise GameError("Wait for the whistle!")
        if self.stage != "play":
            raise GameError("This round is over.")
        if p.g.left <= 0:
            raise GameError("You've thrown both planes: watch the others.")
        if clip and not p.g.clip:
            raise GameError("You've already used your paperclip.")
        if time.time() < p.g.busy_until - 0.3:
            raise GameError("Wait for your plane to land.")
        self.throw(p, fold, float(pitch), float(yaw), float(power), clip)

    def throw(self, p, fold, pitch, yaw, power, clip=False):
        g, rng, now = p.g, self.rng, time.time()
        wob = FOLDS[fold][4]
        jit = (0.0, 0.0, 0.0) if clip else (rng.gauss(0, wob), rng.gauss(0, wob), rng.gauss(0, wob * 1.5))
        gust = 0.0 if clip else max(-0.6, min(0.6, rng.gauss(0, self.wind_set[2])))
        path, land, air = fly(fold, pitch, yaw, power, self.wind, self.vents, jit, gust)
        pts, info = score(self.goal, self.targets, path, land, air)
        if clip:
            g.clip = False
        g.left -= 1
        self.shot_id += 1
        show = max(1.2, air)
        shot = {"id": self.shot_id, "fold": fold, "pitch": round(pitch, 1), "yaw": round(yaw, 1), "power": round(power, 3),
                "path": thin(path), "land": [round(land[0], 2), round(land[1], 2)], "air": round(air, 2),
                "pts": pts, "clip": clip, "t": round(show, 2), **info}
        g.shots.append(shot)
        best = max(s["pts"] for s in g.shots)
        g.points += best - g.round_pts
        g.round_pts = best
        g.busy_until = now + show + 0.4
        self.tell(p, shot, now + show)
        if all(o.g.left <= 0 for o in self.present()):
            last = max((o.g.busy_until for o in self.present()), default=now)
            self.stage = "settle"
            self.room.deadline = min(self.room.deadline or last + SETTLE_PAD, last + SETTLE_PAD)

    def tell(self, p, shot, at):
        nm, goal = p.name, self.goal
        fold = FOLD_NAMES[shot["fold"]]
        if goal == "far":
            what = f"flies {shot['far']} m"
        elif goal == "air":
            what = f"stays up {shot['air']:.1f} s"
        elif goal == "blanket":
            what = "lands on the blanket" if shot["pts"] else f"lands {shot['off']} m off the blanket"
        elif goal == "hoop":
            what = "flies through the hoop" if shot.get("hoop") else "misses the hoop"
        else:
            n = len(shot.get("rings", []))
            what = f"threads {n} ring{'s' if n != 1 else ''}"
        self.room.add_log(f"✈️ {nm}'s {fold}{' 📎' if shot['clip'] else ''} {what} ({shot['pts']} pts).", "info")
        if goal == "hoop" and shot.get("hoop"):
            self.award(p, "hoop", at=at)
            self.moment(f"⭕ {nm} threads the hoop!", "good", "good", at=at)
        if goal == "rings" and len(shot.get("rings", [])) == len(self.targets["rings"]):
            self.award(p, "allrings", at=at)
            self.moment(f"💫 {nm} flies through EVERY ring!", "gold", "fanfare", at=at)
        if goal == "blanket" and shot["pts"] == BLANKET_PTS[0]:
            self.award(p, "bull", at=at)
            self.moment(f"🧺 {nm} lands it in the middle of the blanket!", "gold", "fanfare", at=at)
        if goal == "far" and shot["far"] >= 45:
            self.moment(f"📏 {nm}: {shot['far']} m!", "gold", "good", at=at)
        if goal == "air" and shot["air"] >= 7:
            self.moment(f"⏱ {nm} hangs in the air {shot['air']:.1f} s!", "cool", "good", at=at)

    # -- rounds

    def ranking(self, ps):
        return sorted(ps, key=lambda o: (o.g.points, o.g.best_round), reverse=True)

    def end_round(self):
        r = self.room
        here = self.present()
        self.stage = "between"
        r.deadline = time.time() + BETWEEN
        for o in here:
            o.g.best_round = max(o.g.best_round, o.g.round_pts)
        if here:
            r.add_log(f"🏁 {GOAL_NAMES[self.goal]}: " + ", ".join(f"{o.name} {o.g.round_pts}" for o in sorted(here, key=lambda o: -o.g.round_pts)) + ".", "big")
            best = max(here, key=lambda o: o.g.round_pts)
            if best.g.round_pts and sum(1 for o in here if o.g.round_pts == best.g.round_pts) == 1 and len(here) > 1:
                self.moment(f"🏆 {best.name} takes the round!", "gold", "good")

    def after_round(self):
        r = self.room
        here = self.present()
        if not here:
            return r.finish(None, "Everyone left.")
        if self.round_no >= self.total or len(here) <= 1:
            ranked = self.ranking(here)
            top = ranked[0]
            tied = [o for o in ranked if (o.g.points, o.g.best_round) == (top.g.points, top.g.best_round)]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {top.g.points} points between {' & '.join(o.name for o in tied)}.")
            return r.finish(top, f"🏆 {top.name} wins Paper Planes with {top.g.points} points!")
        self.new_round()

    def on_timeout(self):
        r = self.room
        if r.phase != "playing":
            return
        if self.stage == "count":
            self.stage = "play"
            r.deadline = self.t0 + CLOCK
            return
        if self.stage in ("play", "settle"):
            return self.end_round()
        return self.after_round()

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the park.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if self.stage == "play" and all(o.g.left <= 0 for o in self.present()):
            self.stage = "settle"
            r.deadline = time.time() + SETTLE_PAD

    # -- bots: try a handful of throws per fold in their head (the wind they can see, no gusts) and throw the best
    # with a hand as steady as theirs

    def plan(self, o):
        level = o.bot or "normal"
        rng = random
        n = BOT_SAMPLES.get(level, 12)
        folds = list(FOLDS) if level != "easy" else [rng.choice(list(FOLDS))]
        wind = self.wind if level != "easy" else (0.0, 0.0)
        cands = []
        for fold in folds:
            for _ in range(n):
                cands.append((fold, rng.uniform(-2, 35), rng.uniform(-20, 20), rng.uniform(0.3, 1.0)))
        best, best_v = None, -math.inf
        for c in cands:
            v = self.judge(c, wind)
            if v > best_v:
                best, best_v = c, v
        if level == "hard":
            # refine around the best guess
            for _ in range(10):
                f, pi, ya, po = best
                c = (f, max(PITCH[0], min(PITCH[1], pi + rng.gauss(0, 3))), max(-YAW, min(YAW, ya + rng.gauss(0, 3))),
                     max(0.0, min(1.0, po + rng.gauss(0, 0.06))))
                v = self.judge(c, wind)
                if v > best_v:
                    best, best_v = c, v
        fold, pitch, yaw, power = best
        sp, sy, sw = BOT_SIG.get(level, BOT_SIG["normal"])
        clip = o.g.clip and level != "easy" and (self.round_no == self.total or (level == "hard" and self.goal in ("hoop", "rings")))
        pitch = max(PITCH[0], min(PITCH[1], pitch + rng.gauss(0, sp)))
        yaw = max(-YAW, min(YAW, yaw + rng.gauss(0, sy)))
        power = max(0.0, min(1.0, power + rng.gauss(0, sw)))
        return fold, round(pitch, 1), round(yaw, 1), round(power, 3), bool(clip)

    def judge(self, c, wind):
        fold, pitch, yaw, power = c
        path, land, air = fly(fold, pitch, yaw, power, wind, self.vents)
        pts, info = score(self.goal, self.targets, path, land, air)
        # a smooth nudge toward the target so near misses rank above wild ones
        if self.goal == "hoop" and not info.get("hoop"):
            pts += -0.5 * (info.get("miss") or 50)
        if self.goal == "blanket":
            pts += -0.3 * info["off"]
        if self.goal == "rings":
            for k, (gx, gy, gz) in enumerate(self.targets["rings"]):
                if k not in info["rings"]:
                    pts -= 0.3 * min(20, crossings(path, gx, gy, gz, RING_R)[1])
        return pts

    def bot_ready(self):
        if self.stage != "play":
            return False
        now = time.time()
        return any(o.bot and getattr(o.g, "left", 0) > 0 and now >= o.g.next_at for o in self.present())

    def bot_tick(self):
        now = time.time()
        for o in self.present():
            if o.bot and o.g.left > 0 and now >= o.g.next_at and self.stage == "play":
                fold, pitch, yaw, power, clip = self.plan(o)
                lo, hi = BOT_PACE.get(o.bot, BOT_PACE["normal"])
                self.throw(o, fold, pitch, yaw, power, clip)
                o.g.next_at = max(now + random.uniform(lo, hi), o.g.busy_until)

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "points"):
            return ""
        return f"{p.g.points} pts" + (" · 📎" if getattr(p.g, "clip", False) else "")

    def final_scores(self):
        return {o.id: o.g.points for o in self.players()}

    def view(self, p):
        now = time.time()
        r = self.room
        fliers = {}
        for o in self.players():
            g = o.g
            fliers[o.id] = {"points": g.points, "roundPts": g.round_pts, "left": g.left, "clip": g.clip,
                            "shots": g.shots, "out": o.eliminated}
        me = p.id if p.id in self.seats else None
        return {"planes": {
            "seats": self.seats, "me": me, "round": self.round_no, "rounds": self.total, "order": self.order,
            "goal": self.goal, "goalName": GOAL_NAMES[self.goal], "stage": self.stage, "throws": THROWS,
            "startIn": max(0.0, round(self.t0 - now, 2)) if self.stage == "count" else 0,
            "timeLeft": max(0.0, round((r.deadline or now) - now, 2)) if self.stage in ("play", "settle") else 0,
            "busyIn": max(0.0, round(p.g.busy_until - now, 2)) if me and hasattr(p.g, "busy_until") else 0,
            "wind": list(self.wind), "windDesc": self.wind_desc(), "vents": [list(v) for v in self.vents],
            "targets": {k: (list(v) if k != "rings" else [list(q) for q in v]) for k, v in self.targets.items()},
            "fliers": fliers,
            "geo": {"h0": H0, "field": FIELD, "hoopR": HOOP_R, "ringR": RING_R, "blanket": BLANKET, "blanketPts": BLANKET_PTS,
                    "ventR": VENT_R, "pitch": PITCH, "yaw": YAW, "speed": SPEED,
                    "folds": {k: list(v) for k, v in FOLDS.items()}, "dt": DT, "g": G},
            "standings": self.standings() if self.stage == "between" and len(self.seats) > 1 else None,
        }}
