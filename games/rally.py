"""Hover Rally: an original real-time hover-craft race on a looping track generated each game.

The throttle is automatic: you only steer. Bends push you toward the outside, so you steer into
them; scraping a wall scrubs off speed. ⚡ Boost pads on the track give a burst of speed, and each
racer also has three boosts of their own. Tucking in close behind a rival puts you in their
slipstream, which lifts your top speed so you can pull out and pass. Item pickups (in races of two
or more) give one of: 🚀 a missile that homes in on the racer ahead, 💣 a mine dropped behind you,
or 🛡️ a shield that stops the next hit. A hit knocks most of a craft's speed off and spins it for a
moment. Leaders mostly get mines and shields, racers further back mostly missiles, so the leader
isn't just a target. Craft that touch bump each other sideways. First across the line after the
last lap wins; in 💥 Elimination, each time the leader crosses the line (from the end of lap 1)
whoever is last is out, until one is left.

Server-owned like Sumo Saucers: the track is a closed curve sampled into points; each craft is a
position along it (s, in track units) and a sideways offset (d), so the simulation stays tiny.
frame(now) runs at 60 fps and positions stream to browsers over the room's fast channel, along with
the moments the browser turns into sparks, sounds and camera shake: bumps, boost-pad hits and
item pickups, launches, drops, shields and hits.

📅 Today's track comes from the date alone, so every room races the same one; people's best laps
on it go on a board for the day, kept in data/ (one file per server port, like the rooms file)."""
import json
import math
import os
import random
import threading
import time

from .base import Game, GameError

SAMPLES = 720
HALF_WIDTH = 2.4          # track half-width
TOP_SPEED, BOOST_SPEED = 15.0, 23.0
ACCEL = 9.0
STEER = 7.5               # sideways units/s at full lock
PUSH = 0.3                # how hard bends push outward (× speed² × curvature)
SCRAPE = 0.3              # speed kept per second while touching a wall
BOOST_SECS, BOOSTS = 1.2, 3
PAD_EVERY = 90            # a boost pad every this many samples (roughly)
CRAFT = 0.7               # craft half-size for bumps
DRAFT_SPEED = 17.5        # top speed in a rival's slipstream
DRAFT_LEN, DRAFT_W = 7.0, 1.2   # the slipstream: this far behind a craft and this close sideways
MISSILE_SPEED, MISSILE_TURN, MISSILE_LIFE = 30.0, 3.0, 3.5   # units/s, sideways units/s, seconds
SPIN_SECS, SPIN_KEEP, SAFE = 0.7, 0.35, 2.0   # a hit: no steering this long, speed drops to this share,
#                                            then no further hits for SAFE seconds after the spin
MINE_LIFE, MINE_ARM, MINES = 25.0, 0.6, 8      # seconds on the track, seconds before it's live, most on the track at once
SHIELD_SECS = 6.0
PICKUP_RESPAWN = 4.0
ITEMS = {"missile": 1, "mine": 2, "shield": 3}   # as sent to browsers


BOARD_FILE = os.environ.get("RALLY_BOARD_FILE") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data",
    "rally-daily" + ("" if os.environ.get("PORT", "8000") == "8000" else f"-{os.environ['PORT']}") + ".json")
BOARD_KEEP = 10
_board_lock = threading.Lock()


def read_board(today):
    """Today's best laps, fastest first: [{"name", "ms"}, ...] (empty on a new day)."""
    try:
        with open(BOARD_FILE) as f:
            data = json.load(f)
        return data["laps"] if data.get("date") == today else []
    except (OSError, ValueError, KeyError, TypeError):
        return []


def add_to_board(today, name, ms):
    """Put a lap on today's board if it's fast enough; returns (its place or None, the board)."""
    with _board_lock:
        laps = read_board(today)
        if len(laps) >= BOARD_KEEP and ms >= laps[-1]["ms"]:
            return None, laps
        laps.append({"name": name, "ms": ms})
        laps.sort(key=lambda x: x["ms"])
        del laps[BOARD_KEEP:]
        place = next((k + 1 for k, x in enumerate(laps) if x["ms"] == ms and x["name"] == name), None)
        try:
            os.makedirs(os.path.dirname(BOARD_FILE), exist_ok=True)
            tmp = BOARD_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"date": today, "laps": laps}, f)
            os.replace(tmp, BOARD_FILE)
        except OSError:
            pass
        return place, laps


def item_odds(f):
    """Chances of (missile, mine, shield) for a racer whose place is f of the way back (0 = leading, 1 = last)."""
    return 0.2 + 0.5 * f, 0.5 - 0.4 * f, 0.3 - 0.1 * f
COUNTDOWN, FINISH_WAIT = 3.0, 15.0
LAUNCH_WINDOW, LAUNCH_EARLY = 0.45, 1.0   # boost this close before GO for a start boost; earlier than this stalls
LAUNCH_SECS, LAUNCH_V, STALL_SECS = 0.9, 9.0, 0.6   # a good start leaves the line at LAUNCH_V
LAUNCH_ODDS = {"easy": 0.0, "normal": 0.35, "hard": 0.7}   # how often a bot nails the start
BOT = {  # reaction (s), look-ahead (s), how well it counters the outward push, steering correction
    "easy": (0.45, 0.1, 0.5, 0.8),
    "normal": (0.15, 0.3, 0.85, 1.6),
    "hard": (0.04, 0.45, 1.0, 2.4),
}


def make_track(rng):
    """A smooth closed loop: wobbly control points round a circle, Catmull-Rom between them.
    Returns (points, lengths, total length, curvatures)."""
    while True:
        k = rng.randint(8, 11)
        ctrl = []
        for j in range(k):
            a = math.tau * j / k + rng.uniform(-0.18, 0.18)
            r = rng.uniform(30, 48)
            ctrl.append((math.cos(a) * r, math.sin(a) * r))
        pts = []
        per = SAMPLES // k
        for j in range(k):
            p0, p1, p2, p3 = ctrl[j - 1], ctrl[j], ctrl[(j + 1) % k], ctrl[(j + 2) % k]
            for t_ in range(per):
                t = t_ / per
                t2, t3 = t * t, t * t * t
                pts.append(tuple(0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
                                        + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3) for i in (0, 1)))
        n = len(pts)
        seg = [math.dist(pts[i], pts[(i + 1) % n]) for i in range(n)]
        curv = []
        for i in range(n):
            a = math.atan2(pts[(i + 1) % n][1] - pts[i][1], pts[(i + 1) % n][0] - pts[i][0])
            b = math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])
            turn = (a - b + math.pi) % math.tau - math.pi
            curv.append(turn / max(1e-6, (seg[i] + seg[i - 1]) / 2))
        # keep bends drivable: nothing tighter than a radius of about 10
        if max(abs(c) for c in curv) < 1 / 10:
            return pts, seg, sum(seg), curv


class Craft:
    # defaults for races saved before these existed (rooms come back from data/rooms.pickle on restart)
    wall, pad, draft, item, spin_until, shield_until, out = False, None, False, None, 0.0, 0.0, False
    launch, stall_until, lap_t0, best_lap = None, 0.0, None, None

    def __init__(self, s, d):
        self.s, self.d, self.v = s, d, 0.0
        self.steer = 0.0
        self.boost_until = 0.0
        self.boosts = BOOSTS
        self.lap = 0
        self.finished = None   # finishing place
        self.finish_time = None
        self.wall = False      # scraping a wall right now
        self.pad = None        # the boost pad it's on, so each pad counts as one hit
        self.draft = False     # in someone's slipstream
        self.item = None       # the item held: "missile", "mine" or "shield"
        self.spin_until = 0.0  # spinning from a hit
        self.shield_until = 0.0
        self.out = False       # knocked out in Elimination (it also has a finishing place)
        self.launch = None     # when boost was first pressed in the countdown
        self.stall_until = 0.0 # jumped the start: slow to get going
        self.lap_t0 = None     # when this lap began (the first one when it crosses the line)
        self.best_lap = None   # ms


class Rally(Game):
    id = "rally"
    category = "action"
    howto = [
        "Your hover craft speeds up by itself — you only steer. Hold the left or right side of the screen, the arrows, or A / D.",
        "Bends push you toward the outside: steer into them. Scraping a wall slows you down.",
        "Glowing ⚡ pads on the track give a burst of speed. You also have 3 boosts of your own (⚡, Space or swipe up).",
        "🚀 Start boost: press boost just before GO (as the 1 goes). Too early and you stall.",
        "Grab a 🎁 pickup for an item, and use it with its button, F or a swipe down: 🚀 a missile homes in on the racer ahead, "
        "💣 a mine drops behind you, 🛡️ a shield stops the next hit. A hit spins you out. Leaders get more mines and shields, the pack more missiles.",
        "Tuck in close behind a rival to ride their 💨 slipstream, then pull out and pass.",
        "Bump rivals sideways. First across the line after the last lap wins.",
        "💥 Elimination (a lobby setting): each time the leader crosses the line, whoever is last is out. The last one flying wins.",
    ]
    name = "Hover Rally"
    icon = "🛸"
    blurb = "Hover-craft racing on a new looping 3D track each game. Steer into the bends, hit the boost pads, fire homing missiles, drop mines."
    min_players = 1
    max_players = 6
    replayable = False
    pickups, pickup_at, missiles, mines, elim, elim_lap = (), (), (), (), False, 0   # for races saved before items; start() sets real ones
    daily, today, board, race_id = False, "", (), 0   # races saved before today's track
    settings_schema = {
        "laps": ("Laps", [(3, "3"), (2, "2 (quick)"), (5, "5")], 3),
        "mode": ("Mode", [("race", "🏁 Race"), ("elim", "💥 Elimination (last place out every lap; laps don't apply)")], "race"),
        "missiles": ("Items", [(True, "🎁 On (🚀 💣 🛡️)"), (False, "Off (pure racing)")], True),
        "track": ("Track", [("new", "🎲 A new track"), ("daily", "📅 Today's track (the same everywhere, with a best-lap board)")], "new"),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        # 📅 today's track: the track (and everything on it) comes from the date alone
        self.today = time.strftime("%Y-%m-%d")
        self.daily = self.s.get("track") == "daily"
        trng = random.Random(f"rally {self.today}") if self.daily else rng
        self.board = read_board(self.today) if self.daily else []
        self.race_id = rng.randrange(1 << 30)   # so browsers can tell a rematch on the same track is a new race
        self.pts, self.seg, self.length, self.curv = make_track(trng)
        self.cum = [0.0]
        for L in self.seg:
            self.cum.append(self.cum[-1] + L)
        # boost pads: (sample index, lateral centre)
        self.pads = []
        for i in range(PAD_EVERY // 2, SAMPLES, PAD_EVERY):
            if trng.random() < 0.75:
                self.pads.append((i + trng.randint(-8, 8), trng.choice((-1.3, 0.0, 1.3))))
        n = len(seated)
        # item pickups: pairs across the track, between the boost pads (not in a solo time trial)
        self.pickups = []
        if n > 1 and self.s.get("missiles", True):
            for i in range(PAD_EVERY, SAMPLES, PAD_EVERY * 2):
                self.pickups += [(i, -1.2), (i, 1.2)]
        self.pickup_at = [0.0] * len(self.pickups)   # back on the track at this time
        self.missiles = []     # dicts: s, d, owner, target (craft index or None), until
        self.mines = []        # dicts: s, d, owner, armed (time), until
        # grid: two abreast, a few units apart, just behind the line
        self.crafts = [Craft(-2.0 - 2.2 * (i // 2), (-1.1 if i % 2 == 0 else 1.1) if n > 1 else 0.0) for i in range(n)]
        self.stage = "countdown"
        self.next_at = time.time() + COUNTDOWN
        self.started = None
        self.last_frame = time.time()
        self.frames = 0
        self.places = 0
        self.first_done = None
        self.elim = n > 1 and self.s.get("mode") == "elim"
        self.elim_lap = 0      # the most laps anyone has done, so each lap the leader completes knocks one out
        self.bot_next = [0.0] * n
        self.ev = []           # since the last broadcast: ["bump", i, j] / ["pad", i] / ["pick", i, item] / ["fire", i] /
        #                        ["drop", i] / ["shield", i] / ["hit", victim, by, "missile"|"mine"] / ["block", victim, by]
        self.touching = set()  # pairs in contact, so a long scrape alongside is one bump
        self.room.turn = None
        self.room.deadline = None
        what = "💥 Elimination (last place out every lap)" if self.elim else f"{self.s['laps']} laps"
        where = f"📅 today's track ({self.today}, {self.length:.0f} m)" if self.daily else f"a new track ({self.length:.0f} m)"
        self.room.add_log(f"🛸 Hover Rally: {what} on {where}. Get ready!", "big")

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- track helpers

    def index(self, s):
        """Sample index at track position s (any lap)."""
        s %= self.length
        lo, hi = 0, len(self.seg)
        while lo < hi - 1:  # binary search over cumulative lengths
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        return lo

    def curvature(self, s):
        return self.curv[self.index(s)]

    # -- input

    def act(self, p, a):
        raise GameError("Steer with the sides of the screen or the arrow keys.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this race.")
        c = self.crafts[i]
        st = a.get("steer")
        if st is not None:
            if not isinstance(st, (int, float)) or isinstance(st, bool) or not math.isfinite(st):
                raise GameError("Bad steer.")
            c.steer = max(-1.0, min(1.0, float(st)))
        if a.get("boost") is True:
            self.boost(i, time.time())
        if a.get("fire") is True:
            self.fire(i, time.time())

    def boost(self, i, now):
        c = self.crafts[i]
        if self.stage == "countdown":
            if c.launch is None:
                c.launch = now
            return
        if self.stage == "race" and c.boosts > 0 and now >= c.boost_until and c.finished is None:
            c.boosts -= 1
            c.boost_until = now + BOOST_SECS

    def fire(self, i, now):
        """Use the held item."""
        c = self.crafts[i]
        if self.stage != "race" or not c.item or c.finished is not None:
            return
        item, c.item = c.item, None
        if item == "shield":
            c.shield_until = now + SHIELD_SECS
            self.ev.append(["shield", i])
            return
        if item == "mine":
            self.mines.append({"s": c.s - 2 * CRAFT - 0.4, "d": c.d, "owner": i, "armed": now + MINE_ARM, "until": now + MINE_LIFE})
            del self.mines[:-MINES]
            self.ev.append(["drop", i])
            return
        # aim at the nearest racer ahead (within half a lap); with nobody there it flies straight on
        ahead = [((o.s - c.s) % self.length, j) for j, o in enumerate(self.crafts)
                 if j != i and o.finished is None and self.active(j)]
        ahead = [x for x in ahead if x[0] < self.length / 2]
        self.missiles.append({"s": c.s + 1.2, "d": c.d, "owner": i, "target": min(ahead)[1] if ahead else None,
                              "until": now + MISSILE_LIFE})
        self.ev.append(["fire", i])

    def fly(self, dt, now):
        """Move each missile along the track, steering toward its target; it hits any rival it reaches.
        Mines sit still and hit whoever runs into them (their owner too, once armed)."""
        for m in list(self.missiles):
            m["s"] += MISSILE_SPEED * dt
            t = m["target"]
            if t is not None and (self.crafts[t].finished is not None or not self.active(t)):
                t = m["target"] = None
            if t is not None:
                want = self.crafts[t].d - m["d"]
                m["d"] += max(-MISSILE_TURN * dt, min(MISSILE_TURN * dt, want))
            hit = self.touch(m, 1.0, 1.1, now, m["owner"])
            if hit is not None:
                self.strike(hit, m["owner"], "missile", now)
            if hit is not None or now > m["until"]:
                self.missiles.remove(m)
        for m in list(self.mines):
            hit = self.touch(m, 0.9, 1.0, now, None if now >= m["armed"] else m["owner"])
            if hit is not None:
                self.strike(hit, m["owner"], "mine", now)
            if hit is not None or now > m["until"]:
                self.mines.remove(m)

    def touch(self, m, reach_s, reach_d, now, skip):
        """The racer (not `skip`, not still recovering from a hit) that missile or mine m is touching, or None."""
        half = self.length / 2
        for j, c in enumerate(self.crafts):
            if j != skip and c.finished is None and self.active(j) and now >= c.spin_until + SAFE:
                ds = (c.s - m["s"] + half) % self.length - half
                if abs(ds) < reach_s and abs(c.d - m["d"]) < reach_d:
                    return j
        return None

    def strike(self, j, by, what, now):
        """A missile or mine reaches craft j: its shield takes the hit, or it spins out."""
        c = self.crafts[j]
        pb, pj = self.room.players.get(self.seats[by]), self.room.players.get(self.seats[j])
        nb, nj = pb.name if pb else "?", pj.name if pj else "?"
        whose = "their own" if by == j else f"{nb}’s"
        if now < c.shield_until:
            c.shield_until = 0.0
            self.ev.append(["block", j, by])
            self.room.add_log(f"🛡️ {nj}'s shield stops {whose} {what}!")
            return
        c.v *= SPIN_KEEP
        c.spin_until = now + SPIN_SECS
        c.boost_until = 0.0
        self.ev.append(["hit", j, by, what])
        self.room.add_log(f"💣 {nj} hits {whose} mine!" if what == "mine" else f"🚀 {nb} hits {nj}!")

    # -- simulation

    def frame(self, now):
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "race"
                self.started = now
                self.launches(now)
                self.room.add_log("🟢 Go!")
                return True
            if self.frames % 6 == 0:
                self.broadcast(now)
            return False
        if self.stage != "race":
            return False
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and self.crafts[i].finished is None:
                self.bot_think(i, p.bot, now)
        changed = False
        for i, c in enumerate(self.crafts):
            p = self.room.players.get(self.seats[i])
            if c.finished is not None or not p or p.eliminated:
                c.wall = False
                c.v = max(0.0, c.v - ACCEL * dt) if c.finished is not None else 0.0
                c.s += c.v * dt
                continue
            c.draft = self.drafting(i)
            top = BOOST_SPEED if now < c.boost_until else DRAFT_SPEED if c.draft else TOP_SPEED
            acc = ACCEL * (0.5 if now < c.stall_until else 1.0)
            c.v = min(top, c.v + acc * dt) if c.v < top else max(top, c.v - ACCEL * 0.6 * dt)
            k = self.curvature(c.s)
            # left is +d; a left bend (k > 0) pushes the craft right (outward); no steering while spinning
            steer = 0.0 if now < c.spin_until else c.steer
            c.d += (steer * STEER - k * c.v * c.v * PUSH) * dt
            c.wall = abs(c.d) > HALF_WIDTH - 0.35
            if c.wall:
                c.d = math.copysign(HALF_WIDTH - 0.35, c.d)
                c.v *= SCRAPE ** dt
            # the inside of a bend is a tighter curve, so it covers the track faster
            c.s += c.v * dt / max(0.6, 1 - k * c.d)
            # boost pads
            idx = self.index(c.s)
            on = None
            for pi_, lat in self.pads:
                if abs(idx - pi_) <= 2 and abs(c.d - lat) < 0.9:
                    c.boost_until = max(c.boost_until, now + 0.7)
                    on = pi_
            if on is not None and on != c.pad:
                self.ev.append(["pad", i])
            c.pad = on
            # item pickups: one held at a time
            if not c.item:
                for n_, (pi_, lat) in enumerate(self.pickups):
                    if now >= self.pickup_at[n_] and abs(idx - pi_) <= 2 and abs(c.d - lat) < 0.9:
                        c.item = self.draw_item(i)
                        self.pickup_at[n_] = now + PICKUP_RESPAWN
                        self.ev.append(["pick", i, ITEMS[c.item]])
                        break
            # laps completed: the grid starts just behind the line, at s < 0
            if c.lap_t0 is None and c.s >= 0:
                c.lap_t0 = now
            lap = max(0, math.floor(c.s / self.length))
            if lap > c.lap:
                c.lap = lap
                changed = self.lap_done(i, p, now) or changed
                if self.elim:
                    if lap > self.elim_lap:
                        self.elim_lap = lap
                        changed = self.knock_out(now) or changed
                elif c.lap >= self.s["laps"]:
                    self.places += 1
                    c.finished = self.places
                    c.finish_time = now - self.started
                    self.room.add_log(f"🏁 {p.name} finishes {self.ordinal(self.places)} in {c.finish_time:.1f}s!",
                                      "big" if self.places == 1 else "power")
                    if self.first_done is None:
                        self.first_done = now
                    changed = True
        self.bump()
        self.fly(dt, now)
        racing = [i for i, c in enumerate(self.crafts) if c.finished is None and self.active(i)]
        if not racing or (self.elim and len(racing) == 1) or (self.first_done and now - self.first_done > FINISH_WAIT):
            self.end_race()
            return True
        if self.frames % 2 == 0:
            self.broadcast(now)
        return changed

    def lap_done(self, i, p, now):
        """Time the lap just finished; on today's track a person's good lap goes on the day's board
        (True then, so everyone's view picks up the new board)."""
        c = self.crafts[i]
        if c.lap_t0 is None:
            return False
        ms, c.lap_t0 = round((now - c.lap_t0) * 1000), now
        c.best_lap = ms if c.best_lap is None else min(c.best_lap, ms)
        if not self.daily or p.bot:
            return False
        place, self.board = add_to_board(self.today, p.name, ms)
        if place == 1:
            self.room.add_log(f"⭐ {p.name} sets today's best lap: {ms / 1000:.2f}s!", "big")
        elif place:
            self.room.add_log(f"📅 {p.name}'s {ms / 1000:.2f}s lap is {self.ordinal(place)} on today's board.")
        return place is not None

    def launches(self, now):
        """GO: a boost pressed just before it gives a start boost, one pressed too early stalls.
        Bots roll for a good start here."""
        for i, c in enumerate(self.crafts):
            p = self.room.players.get(self.seats[i])
            if p and p.bot and random.random() < LAUNCH_ODDS.get(p.bot, 0.0):
                c.launch = now - random.uniform(0.05, LAUNCH_WINDOW - 0.05)
            if c.launch is None:
                continue
            if now - c.launch <= LAUNCH_WINDOW:
                c.boost_until = now + LAUNCH_SECS
                c.v = max(c.v, LAUNCH_V)
                self.ev.append(["launch", i, 1])
            elif now - c.launch > LAUNCH_EARLY:
                c.stall_until = now + STALL_SECS
                self.ev.append(["launch", i, 0])
            c.launch = None

    def draw_item(self, i):
        """A random item, weighted by place: see item_odds."""
        live = sorted((j for j, c in enumerate(self.crafts) if c.finished is None and self.active(j)),
                      key=lambda j: -self.crafts[j].s)
        f = live.index(i) / (len(live) - 1) if i in live and len(live) > 1 else 0.5
        return self.rng.choices(("missile", "mine", "shield"), item_odds(f))[0]

    def active(self, i):
        p = self.room.players.get(self.seats[i])
        return bool(p and not p.eliminated)

    def drafting(self, i):
        """Is craft i close behind another racer (not finished) and roughly in line with it?"""
        c = self.crafts[i]
        for j, o in enumerate(self.crafts):
            if j != i and o.finished is None and self.active(j):
                ds = (o.s - c.s) % self.length
                if 2 * CRAFT < ds < DRAFT_LEN and abs(o.d - c.d) < DRAFT_W:
                    return True
        return False

    def bump(self):
        live = [i for i, c in enumerate(self.crafts) if c.finished is None and self.active(i)]
        touching = set()
        for a in range(len(live)):
            for b in range(a + 1, len(live)):
                p, q = self.crafts[live[a]], self.crafts[live[b]]
                ds = (p.s - q.s + self.length / 2) % self.length - self.length / 2
                dd = p.d - q.d
                pair = (live[a], live[b])
                # a pair stays "in contact" until it's clearly apart, so the push that separates it
                # for a frame doesn't make every frame of a scrape a new bump
                if pair in self.touching and abs(ds) < 2 * CRAFT * 1.4 + 1 and abs(dd) < 2 * CRAFT + 0.6:
                    touching.add(pair)
                if abs(ds) < 2 * CRAFT * 1.4 and abs(dd) < 2 * CRAFT:
                    touching.add(pair)
                    if pair not in self.touching:
                        self.ev.append(["bump", *pair])
                    push = (2 * CRAFT - abs(dd)) / 2 + 0.05
                    sgn = 1 if dd >= 0 else -1
                    p.d += sgn * push
                    q.d -= sgn * push
                    # the one behind loses a little speed
                    (q if ds > 0 else p).v *= 0.97
        self.touching = touching

    def knock_out(self, now):
        """Elimination: the racer furthest back is out, and takes the lowest place still free."""
        live = [i for i, c in enumerate(self.crafts) if c.finished is None and self.active(i)]
        if len(live) < 2:
            return False
        i = min(live, key=lambda j: self.crafts[j].s)
        c = self.crafts[i]
        c.out = True
        c.finished = len(self.crafts) - sum(o.out for o in self.crafts) + 1
        c.item, c.boost_until, c.shield_until = None, 0.0, 0.0
        p = self.room.players.get(self.seats[i])
        self.ev.append(["out", i])
        self.room.add_log(f"💥 {p.name if p else '?'} is out on lap {self.elim_lap} ({self.ordinal(c.finished)}).", "power")
        return True

    def end_race(self):
        r = self.room
        self.stage = "done"
        # unfinished craft are ranked by distance covered
        rest = sorted((i for i, c in enumerate(self.crafts) if c.finished is None), key=lambda i: -self.crafts[i].s)
        for i in rest:
            self.places += 1
            self.crafts[i].finished = self.places
        winner = min(range(len(self.crafts)), key=lambda i: self.crafts[i].finished)
        p = r.players.get(self.seats[winner])
        if len(self.seats) == 1:
            t = self.crafts[0].finish_time
            par = self.length * self.s["laps"] / (TOP_SPEED * 0.92)
            if t is not None and t <= par:
                return r.finish(p, f"🏆 {p.name} beats the target time: {t:.1f}s (target {par:.1f}s)!")
            return r.finish(None, f"🛸 {p.name if p else '?'} finished in {t:.1f}s; the target was {par:.1f}s." if t else "🛸 Race over.")
        r.finish(p, f"🏆 {p.name if p else '?'} {'is the last one flying and ' if self.elim else ''}wins Hover Rally!")

    @staticmethod
    def ordinal(n):
        return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")

    def broadcast(self, now):
        self.room.push_fast({"st": self.stage, "c": self.craft_rows(now), "e": self.ev, "m": self.missile_rows(),
                             "mn": self.mine_rows(), "pk": self.pickup_flags(now)})
        self.ev = []

    def craft_rows(self, now):
        """Each craft as [s, d, speed, boosting, boosts left, laps done, finishing place, scraping a wall,
        in a slipstream, item held (0 none, else ITEMS), spinning, shielded, knocked out]."""
        r2 = lambda v: round(v, 2)
        return [[r2(c.s), r2(c.d), r2(c.v), int(now < c.boost_until), c.boosts, c.lap, c.finished or 0, int(c.wall), int(c.draft),
                 ITEMS.get(c.item, 0), int(now < c.spin_until), int(now < c.shield_until), int(c.out)] for c in self.crafts]

    def missile_rows(self):
        """Each missile in flight as [s, d, target craft or -1]."""
        return [[round(m["s"], 2), round(m["d"], 2), -1 if m["target"] is None else m["target"]] for m in self.missiles]

    def mine_rows(self):
        """Each mine on the track as [s, d]."""
        return [[round(m["s"], 2), round(m["d"], 2)] for m in self.mines]

    def pickup_flags(self, now):
        return [int(now >= t) for t in self.pickup_at]

    # -- bots

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, ahead, skill, gain = BOT[level]
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        c = self.crafts[i]
        look = c.s + c.v * ahead
        k = self.curvature(look)
        # take the inside of the bend ahead; on straights head for a boost pad (hard) or the middle
        inside = {"easy": 0.6, "normal": 1.3, "hard": 1.8}[level]
        target = math.copysign(min(inside, abs(k) * 25), k) if abs(k) > 0.01 else 0.0
        if level == "hard":
            idx = self.index(look + 4)
            for pi_, lat in self.pads:
                if 0 <= (pi_ - idx) % SAMPLES <= 18:
                    target = lat
                    break
        # normal and hard tuck into a slipstream on the straights; everyone pulls out to pass when close
        straight = all(abs(self.curvature(c.s + x)) < 0.02 for x in (3, 8, 14))
        for j, o in enumerate(self.crafts):
            if j != i and o.finished is None:
                ds = (o.s - c.s) % self.length
                if 0 < ds < 2.5 and abs(o.d - c.d) < 1.4:
                    target = o.d + (1.6 if o.d < 0 else -1.6)
                elif level != "easy" and straight and 2.5 <= ds < DRAFT_LEN - 1:
                    target = o.d
        # normal and hard steer round mines ahead and sidestep a missile closing in on them
        incoming = any(m["target"] == i and 0 < (c.s - m["s"]) % self.length < 12 for m in self.missiles)
        if level != "easy":
            for m in self.mines:
                if 0 < (m["s"] - c.s) % self.length < 3 + c.v * ahead * 1.5 and abs(m["d"] - target) < 1.3:
                    target = m["d"] + (1.7 if m["d"] < 0 else -1.7)
            if incoming and (level == "hard" or random.random() < 0.5) and now >= c.shield_until:
                target = c.d + (2.0 if c.d < 0 else -2.0)
        push = k * c.v * c.v * PUSH * skill
        c.steer = max(-1.0, min(1.0, (push + (target - c.d) * gain) / STEER + random.gauss(0, 0.08 if level == "easy" else 0.02)))
        # items: fire at a rival a little way ahead, drop a mine in front of one close behind,
        # raise the shield when a missile is coming; now and then anyone just uses what they hold
        if c.item and now >= c.spin_until:
            rivals = [(o.s - c.s) % self.length for j, o in enumerate(self.crafts) if j != i and o.finished is None and self.active(j)]
            eager = {"easy": 0.1, "normal": 0.25, "hard": 0.5}[level]
            use = {"missile": any(0 < x < 25 for x in rivals),
                   "mine": any(self.length - 12 < x < self.length - 2 for x in rivals),
                   "shield": incoming}[c.item]
            if (use and random.random() < eager) or random.random() < 0.004:
                self.fire(i, now)
        if level != "easy" and c.boosts and straight and now >= c.boost_until and random.random() < (0.05 if level == "hard" else 0.02):
            self.boost(i, now)

    # -- the rest of the contract

    def bot_ready(self):
        return False  # bots steer inside frame()

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the race.")
        left = r.contenders()
        if len(self.seats) > 1 and len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        if i is None:
            return ""
        c = self.crafts[i]
        if c.finished:
            return f"{'💥' if c.out else '🏁'} {self.ordinal(c.finished)}"
        return f"Lap {c.lap + 1}" if self.elim else f"Lap {min(c.lap + 1, self.s['laps'])}/{self.s['laps']}"

    def final_scores(self):
        return {pid: self.crafts[i].finished for i, pid in enumerate(self.seats) if self.crafts[i].finished}

    def view(self, p):
        now = time.time()
        r2 = lambda v: round(v, 2)
        return {"rally": {
            "seats": self.seats, "me": self.seat(p), "laps": self.s["laps"], "stage": self.stage,
            "track": [[r2(x), r2(y)] for x, y in self.pts], "length": self.length, "width": HALF_WIDTH,
            "pads": self.pads, "cum": [r2(v) for v in self.cum],
            "c": self.craft_rows(now), "pickups": self.pickups, "pk": self.pickup_flags(now), "m": self.missile_rows(),
            "mn": self.mine_rows(),
            "countdown": max(0.0, self.next_at - now) if self.stage == "countdown" else 0,
            "top": TOP_SPEED, "elim": self.elim, "race": self.race_id,
            "daily": {"date": self.today, "board": list(self.board[:5])} if self.daily else None,
        }}
