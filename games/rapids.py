"""Paper Boat Rapids: an original real-time river race for 2–6 players, each steering a folded paper boat
down the same winding stream at once.

Drag (or ←/→) to steer across the river; the current carries you downstream. Tap 🛶 to paddle (a short
burst of speed: 3 charges that refill), hold it to brace (slower, but white water soaks you half as much).
Paper gets soggy: rocks, waterfall splashes, white water and other boats soak it, and a soggy boat is slow
and sluggish. At 100 % it sinks, and you refold at the start of the stretch with a damp boat. ☀️ Sun patches
and dry folds dry you out; 🍃 leaf sails give a burst of speed. Finish order scores 10/7/5/3/2/1 a race.

The river is a list of stretches (calm, rocks, whirlpool, white-water rapids, a small waterfall with gaps,
sunny pools), generated from a seed, in river coordinates: s runs downstream, x across (0 = the middle).
Server-owned physics like Snowball Scramble: frame(now) steps the river 30 times a second, steering comes
through on_input, and boat states stream over the room's fast channel 15 times a second. Splashes, bumps,
sinks and finishes go out as numbered events, repeated for EVENT_KEEP seconds."""
import math
import random
import time

from .base import Game, GameError

SEG = 24.0                  # one stretch of river, in units downstream
LENGTHS = {"short": 12, "medium": 18, "long": 24}
BOAT_R = 0.5
STEP = 1 / 30               # the river moves 30 times a second (frame() is called at 60)
SEND_EVERY = 2              # …and boat states go out every other step
STEER = 3.4                 # sideways speed at full stick
PADDLES, PADDLE_REFILL = 3, 1.5
PADDLE_KICK, BOOST_SECS, BOOST_ADD = 2.6, 0.6, 1.8
BRACE_SPEED, BRACE_SOAK = 0.75, 0.5
SOG_SLOW, SOG_TURN = 0.35, 0.4  # a fully soggy boat is this much slower / less nimble
SOG_SEEP = 0.5              # paper soaks a little all the time (% per second)
SINK_SECS, REFOLD_SOG = 2.5, 30.0
ROCK_SOAK, BUMP_SOAK, LEDGE_SOAK = 18.0, 4.0, 10.0
WHITE_SOAK, EYE_SOAK, SUN_DRY = 6.0, 8.0, 10.0      # % per second
EDGE_SPLASH, EDGE_KICK = 25.0, 2.5
WHIRL_PULL, WHIRL_SWIRL, WHIRL_SPIT = 2.2, 3.0, 4.0  # spat out after this many seconds caught
LEAF_SECS, LEAF_ADD, DRY_FOLD = 2.0, 2.5, 40.0
DRAFT_AHEAD, DRAFT_WIDE, DRAFT_ADD = 3.5, 0.9, 1.3   # 💨 tuck in this close behind another boat to ride its wake
PICK_R, PICK_RESPAWN = 0.9, 8.0
COUNTDOWN, GRACE, BETWEEN, EVENT_KEEP = 3.0, 20.0, 5.0, 0.6
POINTS = [10, 7, 5, 3, 2, 1]
DROP_H = 0.7                # each waterfall steps the water down this far (drawing only)
BOT = {  # reaction (s), aim noise (units), white-water caution, braces, paddle style
    "easy": (0.5, 1.2, 0.0, False, "random"),
    "normal": (0.3, 0.6, 3.0, True, "full"),
    "hard": (0.15, 0.25, 2.5, True, "smart"),
}


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def bump(v, c, w):
    d = (v - c) / w
    return math.exp(-d * d)


def make_course(seed, nseg, leaves=True):
    """The river: a list of stretches with their hazards, plus the bends (for drawing). Deterministic per seed."""
    rng = random.Random(seed)
    types = ["calm"]
    weights = {"rocks": 3, "rapids": 2, "whirl": 2, "drop": 2, "sun": 1.5, "calm": 1}
    since_sun = 0
    for k in range(nseg - 2):
        opts = [t for t in weights if t != types[-1] and not (t == "drop" and k == 0)]
        if since_sun >= 4 and k >= 3:
            opts = ["sun"]
        t = rng.choices(opts, [weights[o] for o in opts])[0]
        since_sun = 0 if t == "sun" else since_sun + 1
        types.append(t)
    types.append("calm")
    widths = {"calm": (9, 12), "rocks": (9, 11), "whirl": (10, 12), "rapids": (7, 9), "drop": (10, 12), "sun": (9, 12)}
    segs = []
    for i, t in enumerate(types):
        lo, hi = widths[t]
        w = 10.0 if i in (0, nseg - 1) else round(rng.uniform(lo, hi), 2)
        s0 = i * SEG
        g = {"t": t, "w": w, "lane": 0.0}
        half = w / 2
        if t in ("calm", "sun"):
            g["lane"] = round(rng.uniform(-half + 2, half - 2), 2) if 0 < i < nseg - 1 else 0.0
        if t == "sun":
            g["sun"] = [s0 + 12, round(rng.uniform(-half + 2.5, half - 2.5), 2), 2.8]
            g["lane"] = g["sun"][1]
        elif t == "rocks":
            lane = rng.uniform(-half + 1.6, half - 1.6)
            rocks = []
            tries = 0
            while len(rocks) < rng.randint(4, 6) and tries < 80:
                tries += 1
                r = rng.uniform(0.45, 0.85)
                rs, rx = rng.uniform(s0 + 5, s0 + 20), rng.uniform(-half + 0.3, half - 0.3)
                if abs(rx - lane) < r + 1.4:
                    continue
                if any(math.hypot(rs - a, rx - b) < r + c + 0.4 for a, b, c in rocks):
                    continue
                rocks.append((rs, rx, r))
            g["rocks"] = [[round(a, 2), round(b, 2), round(c, 2)] for a, b, c in rocks]
            g["lane"] = round(lane, 2)
        elif t == "whirl":
            side = rng.choice((-1, 1))
            wx = side * rng.uniform(1.6, half - 2.0)
            g["whirl"] = [s0 + 12, round(wx, 2), 2.6]
            g["lane"] = round(-side * (half - 2.0), 2)
        elif t == "rapids":
            bw = w * 0.5
            c = rng.uniform(-half + bw / 2 + 0.5, half - bw / 2 - 0.5)
            g["band"] = [round(c - bw / 2, 2), round(c + bw / 2, 2)]
            g["lane"] = round(c, 2)
        elif t == "drop":
            mid = rng.uniform(-1.0, 1.0)
            g["ledge"] = s0 + 14
            g["gaps"] = [[round(-half + 1.2, 2), 0.75, 1], [round(mid, 2), 0.9, 0], [round(half - 1.2, 2), 0.75, 1]]
            g["lane"] = round(mid, 2)
        segs.append(g)
    picks = []
    if leaves:
        for i, g in enumerate(segs):
            if g["t"] in ("calm", "sun") and 0 < i < nseg - 1:
                for _ in range(rng.randint(1, 2)):
                    picks.append([round(i * SEG + rng.uniform(5, 19), 2), round(rng.uniform(-g["w"] / 2 + 1, g["w"] / 2 - 1), 2),
                                  "leaf" if rng.random() < 0.6 else "dry"])
    bend = [[round(a * rng.uniform(0.7, 1.2), 2), round(math.tau / (wl * rng.uniform(0.8, 1.2)), 5), round(rng.uniform(0, math.tau), 3)]
            for a, wl in ((7.0, 170.0), (3.5, 90.0), (1.5, 45.0))]
    return {"segs": segs, "picks": picks, "bend": bend, "len": nseg * SEG, "seg": SEG}


class Course:
    """Lookups on a course dict: width, current and the stretch at a point."""

    def __init__(self, c):
        self.c = c
        self.segs = c["segs"]
        self.n = len(self.segs)
        self.L = c["len"]

    def idx(self, s):
        return max(0, min(self.n - 1, int(s // SEG)))

    def width(self, s):
        t = s / SEG - 0.5
        i = math.floor(t)
        a = self.segs[max(0, min(self.n - 1, i))]["w"]
        b = self.segs[max(0, min(self.n - 1, i + 1))]["w"]
        return a + (b - a) * smooth(t - i)

    def current(self, s, x):
        g = self.segs[self.idx(s)]
        t = g["t"]
        if t == "rapids":
            a, b = g["band"]
            s0 = self.idx(s) * SEG
            inside = smooth(min(x - a, b - x) / 0.8 + 0.5) * smooth(min(s - s0 - 1, s0 + SEG - 1 - s) / 2)
            u = 3.6 + 2.0 * inside
        elif t == "rocks":
            u = 3.6 + 0.8 * bump(x, g["lane"], 1.6)
        elif t == "whirl":
            u = 3.4 + 1.0 * bump(x, g["lane"], 1.6)
        elif t == "drop":
            u = 3.8 + 0.8 * bump(x, g["lane"], 1.6)
        else:
            u = 3.2 + 1.3 * bump(x, g["lane"], 1.6)
        edge = self.width(s) / 2 - abs(x)
        return u * (0.7 + 0.3 * max(0.0, min(1.0, edge / 1.5)))

    def white(self, s, x):
        g = self.segs[self.idx(s)]
        if g["t"] != "rapids":
            return False
        s0 = self.idx(s) * SEG
        return g["band"][0] <= x <= g["band"][1] and s0 + 1.5 <= s <= s0 + SEG - 1.5

    def near(self, s):
        """The stretches around s (hazards can sit close to a boundary)."""
        i = self.idx(s)
        return self.segs[max(0, i - 1):i + 2]


class Boat:
    def __init__(self, x):
        self.s, self.x, self.vs, self.vx = 1.0, x, 0.0, 0.0
        self.sx = 0.0
        self.brace = False
        self.sog = 0.0
        self.paddles, self.refill_at = PADDLES, 0.0
        self.boost_until = self.leaf_until = 0.0
        self.sunk_until = 0.0
        self.bump_until = 0.0
        self.spin = 0.0
        self.whirl_t = 0.0
        self.flags = 0
        self.done_at = 0.0
        self.place = 0
        self.sinks = 0
        self.pts = 0
        self.wins = 0


class Rapids(Game):
    id = "rapids"
    solo_bots = 3
    category = "action"
    family = None
    howto = [
        "Everyone races a paper boat down the same river at once. Drag (or ←/→ / A/D) to steer across it; the current carries you.",
        "Tap 🛶 (or Space) to paddle: a burst of speed (3 charges, they refill). Hold it (or ↓ / S) to brace: slower, but white water soaks you half as much.",
        "Paper gets soggy: rocks, waterfall splashes, white water and bumping boats soak it, and a soggy boat is slow. At 100 % it sinks and you refold at the start of the stretch.",
        "☀️ Sun patches and dry folds dry you out; 🍃 leaf sails give a burst of speed. Whirlpools spin you round: paddle out. At a waterfall the middle gap is safe; the edge gaps are faster but drench you.",
        "Finishing order scores 10/7/5/3/2/1 a race; most points wins.",
    ]
    name = "Paper Boat Rapids"
    icon = "🚣"
    blurb = "A real-time 3D river race in paper boats: dodge rocks and whirlpools, shoot the falls, and don't get soggy."
    min_players = 2
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "ace": ("🌊", "White-water ace", "Win a race without sinking"),
              "soggy": ("🧻", "Soggy survivor", "Win a race with a boat 80 % soaked")}
    settings_schema = {
        "course": ("River", [("short", "Short (~1 min)"), ("medium", "Medium (~90 s)"), ("long", "Long (~2 min)")], "short"),
        "races": ("Races", [(1, "1"), (3, "3")], 1),
        "leaves": ("🍃 Leaves & dry folds", [(True, "On"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(seated)
        self.boats = [Boat(0.0) for _ in range(n)]
        self.events, self.ev_seq = [], 0
        self.bot_next = [0.0] * n
        self.race = 0
        self.races = int(self.s.get("races", 1))
        self.results = []           # per race: [seat, …] in finishing order
        r = self.room
        r.turn = None
        r.deadline = None
        self.new_race(time.time())
        r.add_log(f"🚣 Paper Boat Rapids: {self.races} race{'s' if self.races > 1 else ''} down a {self.s.get('course', 'short')} river. Don't get soggy!", "big")

    def new_race(self, now):
        self.race += 1
        nseg = LENGTHS.get(self.s.get("course", "short"), 10)
        self.seed = self.rng.randrange(1 << 30)
        self.course = make_course(self.seed, nseg, bool(self.s.get("leaves", True)))
        self.cv = Course(self.course)
        self.pick_back = [0.0] * len(self.course["picks"])   # when each pickup is back (0 = there)
        n = len(self.boats)
        w = self.course["segs"][0]["w"]
        for i, b in enumerate(self.boats):
            pts, wins = b.pts, b.wins
            nb = Boat((i - (n - 1) / 2) * min(1.4, (w - 1.5) / max(1, n - 1)))
            nb.pts, nb.wins = pts, wins
            self.boats[i] = nb
        self.stage = "countdown"
        self.go_at = now + COUNTDOWN
        self.cap_at = self.go_at + nseg * SEG / 2.0 + 30
        self.first_at = 0.0
        self.next_at = 0.0
        self.finished = []
        self.leader = None
        self.lead_moment = 0.0
        self.last = now
        self.acc = 0.0
        self.frames = 0
        self.steps = 0

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
        raise GameError("Steer by dragging, and tap 🛶 to paddle.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this race.")
        b = self.boats[i]
        sx = a.get("sx")
        if sx is not None:
            if not isinstance(sx, (int, float)) or isinstance(sx, bool) or not math.isfinite(sx):
                raise GameError("Bad steer.")
            b.sx = max(-1.0, min(1.0, float(sx)))
        br = a.get("brace")
        if br is not None:
            if not isinstance(br, bool):
                raise GameError("Bad brace.")
            b.brace = br
        if a.get("paddle") is not None:
            if a["paddle"] is not True and a["paddle"] != 1:
                raise GameError("Bad paddle.")
            self.paddle(i, time.time())

    def can_move(self, b, now):
        return self.stage == "race" and not b.done_at and now >= b.sunk_until

    def paddle(self, i, now):
        b = self.boats[i]
        if not self.can_move(b, now) or b.paddles <= 0:
            return False
        b.paddles -= 1
        if b.refill_at <= now:
            b.refill_at = now + PADDLE_REFILL
        b.vs += PADDLE_KICK
        b.boost_until = now + BOOST_SECS
        self.event(now, "paddle", i)
        return True

    # -- the river

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view."""
        if self.room.phase != "playing":
            return False
        if self.stage == "countdown":
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
        self.move(dt, now)
        self.collide(now)
        self.tick_world(now)
        self.steps += 1
        if self.race_over(now):
            self.end_race(now)
            return True
        if self.steps % SEND_EVERY == 0:
            self.broadcast(now)
        return False

    def move(self, dt, now):
        cv = self.cv
        for i, b in enumerate(self.boats):
            if not self.active(i):
                continue
            if b.done_at:   # drift on into the finish pool
                b.s = min(cv.L + 10, b.s + 1.6 * dt)
                b.vs, b.vx = 1.6, b.vx * 0.9
                continue
            if b.sunk_until:
                if now < b.sunk_until:
                    continue
                self.refold(i, now)
            soggy = b.sog / 100
            u = cv.current(b.s, b.x)
            target = u * (1 - SOG_SLOW * soggy)
            if now < b.boost_until:
                target += BOOST_ADD
            if now < b.leaf_until:
                target += LEAF_ADD
            drafting = any(
                j != i and self.active(j) and not o.done_at and not o.sunk_until and 0.7 < o.s - b.s < DRAFT_AHEAD and abs(o.x - b.x) < DRAFT_WIDE
                for j, o in enumerate(self.boats))
            if drafting:
                target += DRAFT_ADD
            if b.brace:
                target *= BRACE_SPEED
            b.vs += (target - b.vs) * min(1.0, dt * 2.5)
            tvx = b.sx * STEER * (1 - SOG_TURN * soggy)
            b.vx += (tvx - b.vx) * min(1.0, dt * 6)
            g = cv.segs[cv.idx(b.s)]
            ds, dx = b.vs, b.vx
            b.flags = int(b.brace) | (32 if drafting else 0)
            if now < b.boost_until or now < b.leaf_until:
                b.flags |= 2
            # 🌀 a whirlpool pulls you in and spins you round
            caught = False
            for h in cv.near(b.s):
                if "whirl" not in h:
                    continue
                ws, wx, R = h["whirl"]
                d = math.hypot(b.s - ws, b.x - wx)
                if d < R:
                    caught = True
                    f = 1 - d / R
                    rs, rx = (ws - b.s) / (d or 1e-6), (wx - b.x) / (d or 1e-6)
                    ds = b.vs * (0.35 + 0.65 * d / R) + rs * WHIRL_PULL * f - rx * WHIRL_SWIRL * f
                    dx = b.vx + rx * WHIRL_PULL * f + rs * WHIRL_SWIRL * f
                    b.spin += 4 * f * dt
                    if d < 0.8:
                        self.soak(i, EYE_SOAK * dt, now)
                    b.whirl_t += dt
                    if b.whirl_t > WHIRL_SPIT:   # it spits you out downstream
                        b.whirl_t = 0.0
                        b.vs += 4.0
                        b.s = ws + R + 0.1
                        self.event(now, "spit", i)
                    b.flags |= 8
            if not caught:
                b.whirl_t = 0.0
            # white water: fast, bumpy and wet
            if cv.white(b.s, b.x):
                b.flags |= 4
                dx += self.rng.uniform(-1, 1) * 2.5
                self.soak(i, WHITE_SOAK * dt * (BRACE_SOAK if b.brace else 1), now)
            # ☀️ sun dries you
            if "sun" in g:
                ss, sx, R = g["sun"]
                if math.hypot(b.s - ss, b.x - sx) < R:
                    b.sog = max(0.0, b.sog - SUN_DRY * dt)
                    b.flags |= 16
            old = b.s
            b.s += max(-1.0, ds) * dt
            b.x += dx * dt
            half = cv.width(b.s) / 2 - BOAT_R
            if abs(b.x) > half:
                b.x = math.copysign(half, b.x)
                b.vx = 0.0
            # the waterfall: through a gap, or stuck on the ledge
            for h in cv.near(old):
                if "ledge" in h and old < h["ledge"] <= b.s:
                    gap = next((gp for gp in h["gaps"] if abs(b.x - gp[0]) <= gp[1] - 0.15), None)
                    if gap is None:
                        b.s = h["ledge"] - 0.02
                        b.vs = 0.0
                        near = min(h["gaps"], key=lambda gp: abs(gp[0] - b.x))
                        b.vx = math.copysign(2.5, near[0] - b.x)
                        if now >= b.bump_until:
                            b.bump_until = now + 0.7
                            self.soak(i, LEDGE_SOAK, now)
                            self.event(now, "ledge", i, round(b.s, 2), round(b.x, 2))
                    elif gap[2]:
                        b.vs += EDGE_KICK
                        self.soak(i, EDGE_SPLASH * (BRACE_SOAK if b.brace else 1), now)
                        self.event(now, "falls", i, 1, round(b.s, 2), round(b.x, 2))
                    else:
                        self.event(now, "falls", i, 0, round(b.s, 2), round(b.x, 2))
            # rocks
            for h in cv.near(b.s):
                for rs, rx, rr in h.get("rocks", ()):
                    d = math.hypot(b.s - rs, b.x - rx)
                    if d < rr + BOAT_R:
                        ns, nx = (b.s - rs) / (d or 1e-6), (b.x - rx) / (d or 1e-6)
                        b.s, b.x = rs + ns * (rr + BOAT_R), rx + nx * (rr + BOAT_R)
                        b.vs = min(b.vs, 0.3)
                        b.vx += nx * 2.0 or 1.0
                        b.spin += math.copysign(0.8, nx or 1) if now >= b.bump_until else 0.0
                        if now >= b.bump_until:
                            b.bump_until = now + 0.7
                            self.soak(i, ROCK_SOAK, now)
                            self.event(now, "rock", i, round(rs, 2), round(rx, 2))
            b.sog = min(100.0, b.sog + SOG_SEEP * dt) if b.sog < 100 else b.sog
            if b.sog >= 100 and not b.sunk_until:
                self.sink(i, now)
            if b.s >= cv.L and not b.sunk_until:
                self.finish_boat(i, now)
            b.spin *= 1 - min(1.0, dt * (0.6 if b.flags & 8 else 2.0))

    def soak(self, i, amt, now):
        b = self.boats[i]
        if b.sunk_until or b.done_at:
            return
        b.sog = min(100.0, b.sog + amt)

    def sink(self, i, now):
        b = self.boats[i]
        b.sunk_until = now + SINK_SECS
        b.sinks += 1
        b.vs = b.vx = 0.0
        b.paddles = max(b.paddles, 1)
        self.event(now, "sink", i, round(b.s, 2), round(b.x, 2))
        self.room.add_log(f"🧻 {self.name_of(i)}'s boat went soggy and sank!")

    def refold(self, i, now):
        b = self.boats[i]
        cv = self.cv
        k = cv.idx(b.s)
        g = cv.segs[k]
        b.s = k * SEG + 1.0
        b.x = max(-g["w"] / 2 + 1, min(g["w"] / 2 - 1, g["lane"]))
        b.sunk_until = 0.0
        b.sog = REFOLD_SOG
        b.vs = b.vx = 0.0
        b.spin = 0.0
        self.event(now, "refold", i)

    def finish_boat(self, i, now):
        b = self.boats[i]
        b.done_at = now
        self.finished.append(i)
        b.place = len(self.finished)
        t = now - self.go_at
        self.event(now, "finish", i, b.place, round(t, 2))
        if b.place == 1:
            self.first_at = now
            self.room.add_log(f"🏁 {self.name_of(i)} wins race {self.race} in {t:.1f} s!", "power")
            if b.sinks == 0 and self.pl(i):
                self.award(self.seats[i], "ace")
            if b.sog >= 80 and self.pl(i):
                self.award(self.seats[i], "soggy")
        elif b.place == 2 and now - self.first_at < 0.3:
            self.moment(f"📸 Photo finish! {self.name_of(self.finished[0])} pips {self.name_of(i)} by {now - self.first_at:.2f} s", "gold")

    def collide(self, now):
        bs = self.boats
        for i in range(len(bs)):
            a = bs[i]
            if not self.active(i) or a.sunk_until or a.done_at:
                continue
            for j in range(i + 1, len(bs)):
                c = bs[j]
                if not self.active(j) or c.sunk_until or c.done_at:
                    continue
                ds, dx = c.s - a.s, c.x - a.x
                d = math.hypot(ds, dx)
                if d < 2 * BOAT_R:
                    if d < 1e-6:
                        ds, dx, d = 0.0, 1.0, 1.0
                    push = (2 * BOAT_R - d) / 2
                    a.s -= ds / d * push
                    a.x -= dx / d * push
                    c.s += ds / d * push
                    c.x += dx / d * push
                    a.vx -= dx / d * 1.2
                    c.vx += dx / d * 1.2
                    if now >= a.bump_until and now >= c.bump_until:
                        a.bump_until = c.bump_until = now + 0.5
                        self.soak(i, BUMP_SOAK, now)
                        self.soak(j, BUMP_SOAK, now)
                        self.event(now, "bump", i, j, round((a.s + c.s) / 2, 2), round((a.x + c.x) / 2, 2))

    def tick_world(self, now):
        cv = self.cv
        for i, b in enumerate(self.boats):
            if b.paddles < PADDLES and now >= b.refill_at:
                if b.refill_at:
                    b.paddles += 1
                b.refill_at = now + PADDLE_REFILL if b.paddles < PADDLES else 0.0
            if not self.active(i) or b.done_at or b.sunk_until:
                continue
            for k, (ps, px, kind) in enumerate(self.course["picks"]):
                if self.pick_back[k] > now or abs(b.s - ps) > PICK_R + BOAT_R:
                    continue
                if math.hypot(b.s - ps, b.x - px) < PICK_R + BOAT_R:
                    self.pick_back[k] = now + PICK_RESPAWN
                    if kind == "leaf":
                        b.leaf_until = now + LEAF_SECS
                    else:
                        b.sog = max(0.0, b.sog - DRY_FOLD)
                    self.event(now, "pick", i, k, kind)
        # a late change of leader is worth a callout
        live = [i for i in range(len(self.boats)) if self.active(i)]
        if live and not self.finished:
            lead = max(live, key=lambda i: self.boats[i].s)
            if lead != self.leader:
                if self.leader is not None and self.boats[lead].s > cv.L - SEG and now - self.lead_moment > 3:
                    self.lead_moment = now
                    self.moment(f"🚣 {self.name_of(lead)} takes the lead on the home stretch!", "good")
                self.leader = lead
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]

    def race_over(self, now):
        live = [i for i in range(len(self.boats)) if self.active(i)]
        if not live:
            return True
        if all(self.boats[i].done_at for i in live):
            return True
        if self.first_at and now >= self.first_at + GRACE:
            return True
        return now >= self.cap_at

    def end_race(self, now):
        live = [i for i in range(len(self.boats)) if self.active(i)]
        rest = sorted((i for i in live if not self.boats[i].done_at), key=lambda i: -self.boats[i].s)
        order = list(self.finished) + rest
        for n, i in enumerate(order):
            b = self.boats[i]
            b.place = n + 1
            b.pts += POINTS[n] if n < len(POINTS) else 0
        if order:
            self.boats[order[0]].wins += 1
        self.results.append([[i, round(self.boats[i].done_at - self.go_at, 2) if self.boats[i].done_at else None] for i in order])
        self.event(now, "results", self.race)
        if self.race >= self.races or len(live) < 1:
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
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins the river race{f' in {t:.1f} s' if t else ''}!")
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins the regatta with {self.boats[top].pts} points!")

    # -- streaming

    def state(self, now):
        r = lambda v: round(v, 2)  # noqa: E731
        return {
            "st": self.stage, "race": self.race, "go": r(max(0.0, self.go_at - now)), "rt": r(max(0.0, now - self.go_at)),
            "gr": r(max(0.0, self.first_at + GRACE - now)) if self.first_at and self.stage == "race" else -1,
            "nx": r(max(0.0, self.next_at - now)) if self.stage == "results" else -1,
            "b": [[r(b.s), r(b.x), r(b.vs), r(b.vx), round(b.sog, 1), r(max(0.0, b.sunk_until - now)) if b.sunk_until else 0,
                   b.flags, b.paddles, r(b.spin), b.place if b.done_at or self.stage != "race" else 0, b.pts,
                   r(max(0.0, b.leaf_until - now))] for b in self.boats],
            "pk": [int(t <= now) for t in self.pick_back],
        }

    def broadcast(self, now):
        d = self.state(now)
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.room.push_fast(d)

    # -- bots

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, err, caution, braces, style = BOT.get(level, BOT["normal"])
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        b = self.boats[i]
        if not self.can_move(b, now):
            b.sx, b.brace = 0.0, False
            return
        cv = self.cv
        look = max(3.0, min(8.0, b.vs * 1.2 + 2.5))
        s1 = b.s + look
        w = cv.width(s1)
        soggy = b.sog / 100
        best, best_x = -1e9, b.x
        hazards = [h for h in cv.near(b.s)] + ([cv.segs[cv.idx(s1) + 1]] if cv.idx(s1) + 1 < cv.n else [])
        for k in range(13):
            x = -w / 2 + 0.7 + (w - 1.4) * k / 12
            sc = cv.current(s1, x)
            for h in hazards:
                for rs, rx, rr in h.get("rocks", ()):
                    if b.s - 0.5 < rs < s1 + 2.5 and abs(rx - x) < rr + BOAT_R + 0.5:
                        sc -= 8
                if "whirl" in h:
                    ws, wx, R = h["whirl"]
                    if b.s - R < ws < s1 + R + 2 and abs(wx - x) < R:
                        sc -= 6 * (1 - abs(wx - x) / R) + 1
                if "ledge" in h and b.s < h["ledge"] < s1 + 4:
                    gap = next((gp for gp in h["gaps"] if abs(x - gp[0]) <= gp[1] - 0.3), None)
                    if gap is None:
                        sc -= 10
                    elif gap[2]:
                        sc += 2.0 if style == "smart" and b.sog < 40 else -3 - 4 * soggy
                if "band" in h and h["band"][0] <= x <= h["band"][1]:
                    sc -= caution * soggy * 2
                if "sun" in h and b.sog > 50:
                    ss, sx, R = h["sun"]
                    if b.s < ss + R and abs(sx - x) < R:
                        sc += 3 * (b.sog - 50) / 50
            for k2, (ps, px, kind) in enumerate(self.course["picks"]):
                if self.pick_back[k2] <= now and b.s < ps < s1 + 3 and abs(px - x) < 1.0 and level != "easy":
                    sc += 1.5 if kind == "leaf" else 2.0 * soggy * 2
            sc -= 0.25 * abs(x - b.x)
            if sc > best:
                best, best_x = sc, x
        tx = best_x + random.gauss(0, err)
        caught = b.flags & 8
        if caught:   # steer away from the whirlpool's eye
            for h in cv.near(b.s):
                if "whirl" in h:
                    tx = b.x + math.copysign(3, b.x - h["whirl"][1])
        b.sx = max(-1.0, min(1.0, (tx - b.x) * 1.2 - b.vx * 0.25))
        white = cv.white(b.s + 1, b.x)
        b.brace = bool(braces and white and b.sog > (30 if style == "full" else 55))
        if b.paddles > 0:
            if style == "random":
                go = random.random() < 0.15
            elif style == "full":
                go = b.paddles == PADDLES or caught
            else:
                go = caught or b.paddles > 1
            if go and not b.brace:
                self.paddle(i, now)

    def bot_ready(self):
        return False   # bots think inside frame()

    # -- the rest of the contract

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} pulled their boat out of the water.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")
        elif i is not None:
            self.boats[i].sx = 0.0

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "boats"):
            return ""
        b = self.boats[i]
        return f"🚣 {b.pts}" if self.races > 1 else (f"🏁 {b.place}" if b.place else "")

    def final_scores(self):
        return {pid: self.boats[i].pts for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"rapids": {
            **self.state(now), "seats": self.seats, "me": self.seat(p), "races": self.races, "seed": self.seed,
            "course": self.course, "boatR": BOAT_R, "paddleMax": PADDLES, "seq": self.ev_seq, "dropH": DROP_H,
            "results": self.results, "pickR": PICK_R,
        }}
