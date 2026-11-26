"""Sky Drop: a server-authoritative 3D descent race through a generated sky shaft.

Players steer on two axes to collect rings, draft through air streams, and dodge
moving hazards. The browser renders the shared course; the server owns scoring.
"""
import math
import random
import time

from .base import Game, GameError

LENGTH = 720.0
STEP = 1 / 30
SEND_EVERY = 2
COUNTDOWN = 3.0
INTRO = 6.0   # (#247) the first run counts down longer, so there is time to read the briefing card
COIN_PTS, GEM_PTS, COIN_R = 2, 10, 1.8   # 🪙 coins and 💎 gems hang between the rings: fly through them for points
DRAFT_GAP, DRAFT_R, DRAFT_BOOST = 8.0, 2.0, 1.12   # 🌬️ tuck in close behind a rival and you ride their slipstream: a bit more speed
STREAK_EVERY, STREAK_PTS, STREAK_SURGE = 5, 10, 1.5   # 🔥 every 5th ring in a row: bonus points and a short free speed surge
MINE_PTS, MINE_STUN = 12, 2.2        # 💥 a mine is deadly: it blows you out of the dive for a couple of seconds and costs points
GRAZE, GRAZE_PTS = 0.8, 3   # skim a hazard within this much of its edge for a few points: risk for reward
PLACE_BONUS = (40, 26, 16, 10, 6, 2)   # 1st through 6th. Enough to swing a close run; a missed shaft still loses.
FORK_OFF = 3.8   # greed gem sits this far off the ring-to-ring line, past the coin grab radius
SHAFT_X, SHAFT_Z = 8.5, 5.5
# 🎚️ Levels: 1 is the classic dive. Higher levels shrink the rings, crowd the dive with set pieces (corridor, pendulum,
# mine field: each one has a flyable line through it) and, at 5, ramp the speed up as you fall.
# ring_r, set-piece spacing in rings (0 = none), speed ramp at the bottom, stream strength, recovery window after a hit.
LEVELS = {
    1: {"name": "Open Sky", "ring_r": 2.05, "sets": 0, "ramp": 0.0, "streams": 1.0, "drift": 0, "amp": 0.0},
    2: {"name": "Crosswinds", "ring_r": 1.85, "sets": 0, "ramp": 0.0, "streams": 1.5, "drift": 0, "amp": 0.0},
    3: {"name": "Gauntlet", "ring_r": 1.85, "sets": 6, "ramp": 0.0, "streams": 1.2, "drift": 0, "amp": 0.0},
    4: {"name": "Needle Eye", "ring_r": 1.65, "sets": 4, "ramp": 0.0, "streams": 1.4, "drift": 3, "amp": 1.6},
    5: {"name": "Redline", "ring_r": 1.6, "sets": 3, "ramp": 0.28, "streams": 1.5, "drift": 2, "amp": 2.0},
    6: {"name": "Storm Front", "ring_r": 1.55, "sets": 5, "ramp": 0.15, "streams": 1.5, "drift": 3, "amp": 1.8, "gusts": True},
    7: {"name": "Shutters", "ring_r": 1.5, "sets": 3, "ramp": 0.2, "streams": 1.4, "drift": 3, "amp": 2.0, "gusts": True, "shutters": True},
    8: {"name": "Zero Hour", "ring_r": 1.4, "sets": 3, "ramp": 0.38, "streams": 1.5, "drift": 2, "amp": 2.2, "gusts": True, "shutters": True, "dark": 160, "pts": 1.25},
}
MAX_LEVEL = 8
CLIMB = (1, 4, 8)   # 📈 the Climb option's level for each run of a 3-run match
GUST_ACC, GUST_LEN, GUST_WARN = 14.0, 40.0, 30.0   # 💨 a gust shoves you sideways (units/s²) for 40 units of the dive; a warning call 30 units before
SHUT_KINDS, SHUT_AMP, SHUT_RATE = (5, 6), 2.4, 1.6   # 🪟 two jaws (left, right) that slide shut and open together; the gap is wide open every ~4 s
MEDAL_PERFECT, MEDAL_CLEAN = 15, 6
RECOVER = 2.0   # after a hit you get a short speed-up, so one mistake does not end the run
PENDULUM_KIND = 4
SLING = 1.25   # boost + current: +25% speed, but you steer at 60%
# 🎁 at every checkpoint you pick one perk for the next stretch (bots pick at random)
PERKS = ("magnet", "wide", "shield")   # 🧲 coins and gems pulled from twice as far · ⭕ rings 0.45 wider · 🛡️ blocks the next hit
MAGNET, WIDE = 1.9, 0.45


def _unit_perp(dx, dz):
    h = math.hypot(dx, dz)
    if h < 1e-6:
        return 1.0, 0.0
    return -dz / h, dx / h


def _line_xz(a, b, depth):
    """Point on the ring-to-ring line at this depth. a and b are ring rows [depth, x, z, mult]."""
    span = b[0] - a[0]
    t = 0.0 if span == 0 else (depth - a[0]) / span
    return a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t


def _place_off(a, b, t, px, pz, dist, limit):
    """A point `dist` off the ring line, kept inside the shaft and clear of the line."""
    lx, lz = _line_xz(a, b, a[0] + (b[0] - a[0]) * t)
    x = min(7.4, max(-7.4, lx + px * dist))
    z = min(5.2, max(-5.2, lz + pz * dist))
    for _ in range(5):
        if math.hypot(x - lx, z - lz) > limit:
            break
        if abs(x) < 7.2:
            x += 0.55 if x >= lx else -0.55
        elif abs(z) < 5.0:
            z += 0.45 if z >= lz else -0.45
        else:
            break
    e = math.hypot(x / 7.4, z / 5.0)   # 🥚 the shaft is round: pull a corner gem back inside the ellipse
    if e > 1:
        x, z = x / e, z / e
    return round(x, 2), round(z, 2)
RX, RZ, STEP_X, STEP_Z = 4.8, 3.1, 8.0, 5.4   # ring field, and the most a ring may sit from the last one (so every line is flyable)
PATTERNS = {
    "scatter": 1.0,   # loose random
    "slalom": 1.0,    # hard left, hard right, hard left ...
    "spiral": 1.0,    # round and round the shaft
    "zigzag": 1.0,    # sweeping diagonals corner to corner
    "ramp": 0.8,      # one long drift across the shaft
    "straight": 0.6,  # a breather: rings stacked near the middle
}
THEME_PATTERN = {"storm": {"zigzag": 1.6, "slalom": 1.4}, "aurora": {"spiral": 1.8, "ramp": 1.3}, "spire": {"scatter": 1.3}}


def _ring_path(r, theme, count):
    """Ring positions [x, z] for the whole dive, built from short sections (4-7 rings) of different shapes, no shape twice
    in a row, so every run is a different course but always flyable: no ring is further from the last than STEP_X / STEP_Z."""
    weights = {k: w * THEME_PATTERN.get(theme, {}).get(k, 1.0) for k, w in PATTERNS.items()}
    out, last = [], None
    cx, cz = r.uniform(-1, 1), r.uniform(-1, 1)
    while len(out) < count:
        kind = r.choices([k for k in weights if k != last], [w for k, w in weights.items() if k != last])[0]
        last, n = kind, r.randint(4, 7)
        a0 = r.uniform(0, math.tau)
        spin = r.choice([-1, 1])
        tx, tz = r.choice([-1, 1]) * r.uniform(3.2, RX), r.choice([-1, 1]) * r.uniform(1.8, RZ)
        for i in range(n):
            u = i / max(1, n - 1)
            if kind == "scatter":
                x, z = r.uniform(-RX, RX), r.uniform(-RZ, RZ)
            elif kind == "slalom":
                x, z = (RX * 0.85 if (i + int(a0)) % 2 else -RX * 0.85), r.uniform(-1.2, 1.2)
            elif kind == "spiral":
                ang = a0 + spin * i * 1.15
                x, z = math.cos(ang) * RX * 0.9, math.sin(ang) * RZ * 0.9
            elif kind == "zigzag":
                x = (-1 if (i % 2) else 1) * tx * 0.9
                z = (1 if (i % 2) else -1) * tz * 0.9
            elif kind == "ramp":
                x, z = -tx + 2 * tx * u, -tz * 0.6 + tz * 1.2 * u
            else:   # straight
                x, z = r.uniform(-0.9, 0.9), r.uniform(-0.7, 0.7)
            # keep every hop flyable
            x = max(cx - STEP_X, min(cx + STEP_X, x))
            z = max(cz - STEP_Z, min(cz + STEP_Z, z))
            cx, cz = max(-RX, min(RX, x)), max(-RZ, min(RZ, z))
            out.append((round(cx, 2), round(cz, 2)))
    return out[:count]


# Bots: (seconds between steering decisions, steering noise, chance to line up each ring properly).
# A bot that loses focus on a ring aims for a spot beside it, so it usually misses that ring and
# then has to recover for the next one. Tuned for about 40% / 60% / 80% of the rings.
BOT = {"easy": (0.35, 0.8, 0.0), "normal": (0.25, 0.6, 0.35), "hard": (0.14, 0.4, 0.72)}


class Flyer:
    def __init__(self, lane):
        self.depth = 0.0
        self.x, self.z = lane, 0.0
        self.vx = self.vz = 0.0
        self.sx = self.sz = 0.0
        self.score = self.rings = self.combo = 0
        self.boosts = 3
        self.boost_until = self.boost_cool = 0.0
        self.stun_until = 0.0
        self.done_at = 0.0
        self.place = 0
        self.next_bot = 0.0
        self.last_ring = -1
        self.hits = 0
        self.grazes = 0
        self.hit_cool_until = 0.0
        self.coins = self.gems = self.mines = 0
        self.drafting = False
        self.surge_until = 0.0
        self.aim_ring = -1          # bots: the ring they're lining up and their offset from it
        self.aim_dx = self.aim_dz = 0.0
        self.gust_warned = -1       # the last gust this diver was warned about
        self.fork_go = False        # bots: this gap's gem is worth leaving the ring line for
        self.fork_x = self.fork_z = self.fork_d = 0.0
        self.perk = ""              # 🎁 this stretch's checkpoint perk; "shield" is spent by the next hit
        self.slinging = False
        self.offer = False          # a checkpoint perk choice is waiting


class SkyDrop(Game):
    id = "skydrop"
    solo_bots = 3
    category = "action"
    name = "Sky Drop"
    icon = "🪂"
    blurb = "Dive a sky shaft, thread the bright ring, or peel off for a gem."
    min_players, max_players = 2, 6
    replayable = False
    howto = [
        "Everyone dives the same course at once. Drag from anywhere to steer with the floating stick, or use WASD / arrow keys.",
        "Fly through glowing rings to score. Consecutive rings build a combo; missing one resets it. 🔥 Every 5th ring in a row pays +10 and a short speed surge.",
        "🔵 Blue and 🟡 gold rings are the ones to fly through. Spinning red ✴️ blades, orange gates and 💥 mines are hazards: stay away from those.",
        "Steering is stabilized, so you can make small corrections without drifting away. Avoid turbines and storm gates, and keep well clear of the red 💥 mines: they blow you out of the dive for two seconds. Checkpoints refill boosts.",
        "🌬️ Tuck in close behind a rival and you ride their slipstream: a little extra speed to slingshot past. Tap ⚡ or Space for one of three short boosts. The boost refills at the checkpoint.",
        "😮‍💨 Skim a hazard for +3. Most gaps pay a coin line (+2). About one gap in three is a 💎 greed fork off to the side (+10): take it and you can miss the next ring.",
        "🚀 Boost while inside an air stream and you slingshot: 25% more speed, but you steer at 60% until it ends.",
        "🎚️ Levels 2-5 add smaller rings, corridor / pendulum / mine-field set pieces, drifting gold rings (4+) and a dark, fast Redline (5). 6 Storm Front adds 💨 gusts (a warning shows first), 7 adds 🪟 shutters that slide shut and open (wait for the gap), 8 Zero Hour is all of it with tiny rings. 📈 Climb steps 1, 4, 8 over a 3-run match. 🏅 A dive with no hits (level 3+) pays +15. Pick a 🎁 perk at each checkpoint.",
        "Cloud Spire mixes those forks in. Stormwell hangs the gem on a moving gate. Aurora Shaft slides the gold rings off the coin line.",
        "🧩 Every dive is a brand-new course built from sections (slalom, spiral, zigzag, drift, breather) and it gets busier the deeper you go.",
        "Finish order pays 40, 26, 16, 10, 6, then 2. Ring points still decide a messy dive.",
    ]
    settings_schema = {
        "course": ("Course", [("spire", "🏙️ Cloud Spire"), ("storm", "⛈️ Stormwell"), ("aurora", "🌌 Aurora Shaft")], "spire"),
        "runs": ("Runs", [(1, "1 run"), (3, "3 runs")], 1),
        "level": ("Level", [(0, "📈 Climb each run"), (1, "1 · Open Sky"), (2, "2 · Crosswinds"), (3, "3 · Gauntlet"), (4, "4 · Needle Eye"), (5, "5 · Redline"), (6, "6 · Storm Front"), (7, "7 · Shutters"), (8, "8 · Zero Hour")], 1),
        "hazards": ("Hazards", [(True, "On"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.runs = int(self.s.get("runs", 1))
        self.run = 0
        self.points = [0] * len(seated)
        self.ring_totals = [0] * len(seated)
        self.last = time.time()
        self.frames = 0
        self.room.turn = self.room.deadline = None
        self.new_run(self.last)
        self.room.add_log(f"🪂 Sky Drop: {self.runs} run{'s' if self.runs != 1 else ''} through the {self.s.get('course', 'spire')} course. Ring points plus finish bonus win.", "big")

    def new_run(self, now):
        self.run += 1
        self.seed = self.rng.randrange(1 << 30)
        r = self.rng
        # Every course element is shared and immutable for the whole run.
        self.rings = []
        theme = self.s.get("course", "spire")
        chosen = int(self.s.get("level", 1) or 0)
        self.level = CLIMB[min(self.run, len(CLIMB)) - 1] if chosen == 0 else max(1, min(MAX_LEVEL, chosen))   # 📈 0 = climb: 1, 4, 8 over a 3-run match
        lv = LEVELS[self.level]
        self.ring_r = lv["ring_r"]
        depths = list(range(28, int(LENGTH), 18))
        path = _ring_path(r, theme, len(depths))   # 🧩 every run is built from random sections: slalom, spiral, zigzag, ramp...
        for j, d in enumerate(depths):
            mult = (1.2 if j % 4 == 3 else 1.0) if theme == "aurora" else (0.85 if j % 4 == 3 else 1.0)
            self.rings.append([d, path[j][0], path[j][1], mult])
        # 🪙 a short arc of coins just past most rings, and now and then a 💎 gem off the line
        self.coins = []
        self.forks = {}   # ring index -> (depth, x, z) of the gem forked off the line after that ring
        for j, (d, rx, rz, _) in enumerate(self.rings[:-1]):
            nd, nx, nz, _ = self.rings[j + 1]
            if r.random() < 0.7:
                for k in (1, 2, 3):
                    t = k / 4
                    self.coins.append([round(d + (nd - d) * t, 2), round(rx + (nx - rx) * t, 2), round(rz + (nz - rz) * t, 2), 0])
            if j % 3 == 1 or (self.level >= 4 and j % 3 == 0):   # 💎 a greed fork: a gem well off the ring line. Grab it and you may miss the next ring.
                a, b = self.rings[j], self.rings[j + 1]
                px, pz = _unit_perp(b[1] - a[1], b[2] - a[2])
                side = r.choice([-1, 1])
                lx, lz = _line_xz(a, b, (d + nd) / 2)
                tries = [_place_off(a, b, 0.5, px * sd, pz * sd, FORK_OFF, FORK_OFF - 0.4) for sd in (side, -side)]
                gx, gz = max(tries, key=lambda q: (math.hypot(q[0] - lx, q[1] - lz) >= COIN_R + 1.05, tries.index(q) == 0, math.hypot(q[0] - lx, q[1] - lz)))
                gd = round((d + nd) / 2, 2)
                self.coins.append([gd, gx, gz, 1])
                self.forks[j] = (gd, gx, gz)
        self.hazards = []
        if self.s.get("hazards", True):
            hazard_gap = 27 if theme == "storm" else 36
            d = 48
            while d < int(LENGTH) - 20:
                kind = 3 if r.random() < 0.22 else r.randrange(3)
                self.hazards.append([d, r.uniform(-5.4, 5.4), r.uniform(-3.4, 3.4), kind, r.uniform(0, math.tau)])
                d += round(hazard_gap * (1 - 0.4 * d / LENGTH))   # 📈 the dive gets busier the deeper you go
            if lv["sets"]:
                self._set_pieces(r, lv["sets"], lv.get("shutters"))
        # 🌀 level 4+: some rings drift on a slow orbit, so you lead the shot. They pay more. Rings with a set piece in front stay put.
        self.drifts = [None] * len(self.rings)
        if lv["drift"]:
            for j in range(1, len(self.rings) - 1):
                if j % lv["drift"] == 1 and not (lv["sets"] and j % lv["sets"] == lv["sets"] - 1):
                    self.drifts[j] = [lv["amp"], round(lv["amp"] * 0.55, 2), round(r.uniform(0, math.tau), 2), round(r.uniform(1.0, 1.4), 2)]
                    self.rings[j][3] = max(self.rings[j][3], 1.3)
        # 🌑 level 5: dark stretches where rings and coins only show up 25 units ahead (hazards still glow)
        self.dark = [[d, d + 90] for d in range(200, int(LENGTH) - 100, lv.get("dark", 220))] if self.level >= 5 else []
        # 💨 level 6+: gusts, each a stretch of the dive where the wind shoves you sideways
        self.gusts = []
        if lv.get("gusts"):
            d = 110.0
            while d < LENGTH - 90:
                self.gusts.append([round(d, 1), round(d + GUST_LEN, 1), r.choice((-1, 1))])
                d += GUST_LEN + r.uniform(70, 110)
        self.streams = []
        for d in range(42, int(LENGTH) - 30, 54):
            self.streams.append([d, r.uniform(-5, 5), r.uniform(-3, 3), r.choice([-1, 1]), r.uniform(-1, 1)])
        lanes = [(-2.2 + i * 4.4 / max(1, len(self.seats) - 1)) for i in range(len(self.seats))]
        self.flyers = [Flyer(lanes[i]) for i in range(len(self.seats))]
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if not p or p.eliminated:
                self.flyers[i].done_at = -1
        self.stage = "countdown"
        self.go_at = now + (INTRO if self.run == 1 else COUNTDOWN)
        self.last = now
        self.frames = 0
        self.finished = []
        self.events = []
        self.ev_seq = 0
        self.race_started = self.go_at
        self.room.deadline = None
        self.chip_key, self.chip_at = None, 0.0

    def _set_pieces(self, r, every, shutters=False):
        """Corridor / pendulum / mine field laid across the line into a ring. Each leaves a flyable lane through the ring,
        so a bot or player aiming at the ring finds the gap. Ordinary hazards near a set piece are cleared out."""
        for j in range(every - 1, len(self.rings) - 1, every):
            a, b = self.rings[j - 1], self.rings[j]
            d = b[0] - 6
            lx, lz = _line_xz(a, b, d)
            kind = r.choice(("corridor", "pendulum", "field", "shutter") if shutters else ("corridor", "pendulum", "field"))
            self.hazards = [h for h in self.hazards if abs(h[0] - d) > 12]
            if kind == "corridor":
                for side in (-1, 1):
                    self.hazards.append([d, round(lx + side * 3.2, 2), round(lz, 2), 0, r.uniform(0, math.tau)])
            elif kind == "shutter":   # 🪟 two jaws that close over the ring line and open again: wait for the gap
                ph = r.uniform(0, math.tau)
                for side, k in ((-1, SHUT_KINDS[0]), (1, SHUT_KINDS[1])):
                    self.hazards.append([d, round(lx + side * 3.2, 2), round(lz, 2), k, ph])
            elif kind == "pendulum":
                self.hazards.append([d, round(lx, 2), round(lz, 2), PENDULUM_KIND, r.uniform(0, math.tau)])
            else:
                for off in (-5.6, -3.0, 3.0, 5.6):
                    if abs(lx + off) <= 8.0:
                        self.hazards.append([d, round(lx + off, 2), round(lz, 2), 3, r.uniform(0, math.tau)])
        self.hazards.sort(key=lambda h: h[0])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        raise GameError("Steer by dragging and tap ⚡ to boost.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this run.")
        f = self.flyers[i]
        for key in ("sx", "sz"):
            value = a.get(key)
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise GameError("Bad steering input.")
                setattr(f, key, max(-1.0, min(1.0, float(value))))
        perk = a.get("perk")
        if perk is not None:
            if perk not in PERKS:
                raise GameError("Unknown perk.")
            if f.offer and self.stage == "race" and f.done_at == 0:
                f.perk, f.offer = perk, False
                self.event(time.time(), "perk", i)
        if a.get("boost") is True:
            now = time.time()
            if self.stage == "race" and f.done_at == 0 and now >= f.boost_cool and f.boosts:
                f.boosts -= 1
                f.boost_until = now + 1.25
                f.boost_cool = now + 2.5
                self.event(now, "boost", i)

    def event(self, now, kind, i):
        self.ev_seq += 1
        self.events.append([self.ev_seq, kind, i, now])
        self.events = self.events[-30:]

    def ring_position(self, ri, at):
        """Where ring ri is at time `at`: drifting rings circle their base spot."""
        _, x, z, _ = self.rings[ri]
        dr = self.drifts[ri]
        if dr:
            e = max(0.0, at - self.race_started)
            x += math.sin(e * dr[3] + dr[2]) * dr[0]
            z += math.cos(e * dr[3] * 0.8 + dr[2]) * dr[1]
        return x, z

    def hazard_position(self, d, x, z, kind, phase, at):
        if kind == 2:
            elapsed = max(0.0, at - self.race_started)
            x += math.sin(elapsed * 1.5 + phase) * 1.5
            z += math.cos(elapsed * 1.1 + phase) * 1.1
        if kind in SHUT_KINDS:   # 🪟 both jaws share a phase: closed at s=1, wide open at s=0
            s = (1 + math.sin(max(0.0, at - self.race_started) * SHUT_RATE + phase)) / 2
            x += SHUT_AMP * s * (1 if kind == SHUT_KINDS[0] else -1)
        if kind == PENDULUM_KIND:   # 🕰️ swings right across the ring line: time your pass
            elapsed = max(0.0, at - self.race_started)
            x += math.sin(elapsed * 1.9 + phase) * 4.4
            z += math.cos(elapsed * 1.3 + phase) * 0.6
        return x, z

    def frame(self, now):
        if self.room.phase != "playing":
            return False
        if self.stage == "results":
            if now >= self.next_at:
                if self.run >= self.runs:
                    self.finish_match()
                else:
                    self.new_run(now)
                return True
            self.frames += 1
            if self.frames % 8 == 0:
                self.broadcast(now)
            return False
        if self.stage == "countdown":
            if now >= self.go_at:
                self.stage = "race"
                self.last = now
                self.race_started = now
                return True
            if int(now * 4) != int(self.last * 4):
                self.last = now
                self.broadcast(now)
            return False
        dt = min(0.05, max(0.0, now - self.last))
        self.last = now
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated and not self.flyers[i].done_at:
                self.bot_think(i, p.bot, now)
        self.simulate(dt, now)
        self.frames += 1
        if self.frames % SEND_EVERY == 0:
            self.broadcast(now)
        if all(f.done_at or not self.active(i) for i, f in enumerate(self.flyers)) or now - self.race_started > 100:
            self.end_run(now)
            return True
        # The seat chips show live points (meta); refresh the full views when they change, at most once a second.
        key = [self.live_points(i) for i in range(len(self.seats))]
        if key != self.chip_key and now - self.chip_at >= 1.0:
            self.chip_key, self.chip_at = key, now
            return True
        return False

    def live_points(self, i):
        """Match points so far plus the run in progress (end_run adds the run to points, so not twice)."""
        return self.points[i] + (self.flyers[i].score if self.stage != "results" else 0)

    def active(self, i):
        p = self.room.players.get(self.seats[i])
        return bool(p and not p.eliminated)

    def simulate(self, dt, now):
        for i, f in enumerate(self.flyers):
            if not self.active(i) or f.done_at:
                continue
            prev_depth, prev_x, prev_z = f.depth, f.x, f.z
            if now < f.stun_until:
                f.depth = min(LENGTH, f.depth + 4.2 * dt)
            else:
                # Course currents are local force fields, with a small oscillation for movement.
                # Steering is a velocity target with gentle damping. This keeps a release or
                # direction change predictable on touch screens, while currents still matter.
                target_vx, target_vz = f.sx * 8.0, f.sz * 6.6
                response = min(1.0, dt * 9.0) * (0.6 if f.slinging else 1.0)   # snappy: ~110 ms to reach the stick's speed (was ~240 ms)
                f.vx += (target_vx - f.vx) * response
                f.vz += (target_vz - f.vz) * response
                ax = az = 0.0
                current_scale = (1.45 if self.s.get("course") == "storm" else 1.0) * LEVELS[self.level]["streams"]
                in_stream = False
                for d, x, z, dx, dz in self.streams:
                    dd = abs(f.depth - d)
                    dist = math.hypot(f.x - x, f.z - z)
                    if dd < 9 and dist < 4:
                        in_stream = True
                        k = (1 - dd / 9) * (1 - dist / 4) * current_scale
                        ax += dx * 8 * k
                        az += dz * 8 * k
                for gi, (g0, g1, gdir) in enumerate(self.gusts):   # 💨
                    if gi > f.gust_warned and f.depth >= g0 - GUST_WARN:
                        f.gust_warned = gi
                        self.event(now, "gustr" if gdir > 0 else "gustl", i)
                    if g0 <= f.depth < g1:
                        ax += gdir * GUST_ACC
                f.vx = max(-9, min(9, (f.vx + ax * dt) * (1 - 1.2 * dt)))
                f.vz = max(-7.5, min(7.5, (f.vz + az * dt) * (1 - 1.35 * dt)))
                speed = 12.5 * (1 + LEVELS[self.level]["ramp"] * f.depth / LENGTH) + (4.0 if now < f.boost_until else 0) + (3.0 if now < f.surge_until else 0)
                tow = any(0 < o.depth - f.depth < DRAFT_GAP and math.hypot(o.x - f.x, o.z - f.z) < DRAFT_R
                          for j, o in enumerate(self.flyers) if o is not f and self.active(j) and not o.done_at)
                if tow:
                    speed *= DRAFT_BOOST
                slinging = in_stream and now < f.boost_until   # 🚀 boosting inside a current: a big speed kick, but it fights your steering
                if slinging:
                    speed *= SLING
                    if not f.slinging:
                        self.event(now, "sling", i)
                f.slinging = slinging
                if now < f.stun_until + RECOVER:   # recovering from a hit: a little extra speed
                    speed *= 1.12
                if tow != f.drafting:
                    f.drafting = tow
                    if tow:
                        self.event(now, "draft", i)
                f.depth = min(LENGTH, f.depth + speed * dt)
                f.x += f.vx * dt
                f.z += f.vz * dt
                e = math.hypot(f.x / SHAFT_X, f.z / SHAFT_Z)   # 🥚 a round tunnel: the wall is an ellipse, not a box
                if e > 1:
                    f.x, f.z = f.x / e, f.z / e
                    f.vx *= -0.45
                    f.vz *= -0.45
            for ri, ring in enumerate(self.rings):
                d, x, z, mult = ring
                if f.last_ring < ri and prev_depth < d <= f.depth:
                    f.last_ring = ri
                    t = (d - prev_depth) / max(1e-9, f.depth - prev_depth)
                    x, z = self.ring_position(ri, now - dt + t * dt)
                    cross_x = prev_x + (f.x - prev_x) * t
                    cross_z = prev_z + (f.z - prev_z) * t
                    if math.hypot(cross_x - x, cross_z - z) <= self.ring_r + (WIDE if f.perk == "wide" else 0):
                        f.combo += 1
                        f.rings += 1
                        pts = (10 + min(10, (f.combo - 1) * 2)) * mult * LEVELS[self.level].get("pts", 1.0)
                        if math.hypot(cross_x - x, cross_z - z) <= self.ring_r * 0.3:   # 🎯 dead centre pays half again
                            pts *= 1.5
                            self.event(now, "bullseye", i)
                        f.score += round(pts)
                        self.event(now, "ring", i)
                        if f.combo % STREAK_EVERY == 0:
                            f.score += STREAK_PTS
                            f.surge_until = now + STREAK_SURGE
                            self.event(now, "streak", i)
                    else:
                        f.combo = 0
            for d, x, z, kind in self.coins:
                if prev_depth < d <= f.depth:
                    t = (d - prev_depth) / max(1e-9, f.depth - prev_depth)
                    if math.hypot(prev_x + (f.x - prev_x) * t - x, prev_z + (f.z - prev_z) * t - z) <= COIN_R * (MAGNET if f.perk == "magnet" else 1):
                        if kind:
                            f.gems += 1
                            f.score += GEM_PTS
                            self.event(now, "gem", i)
                        else:
                            f.coins += 1
                            f.score += COIN_PTS
                            self.event(now, "coin", i)
            for d, x, z, kind, phase in self.hazards:
                crossed = prev_depth < d <= f.depth
                t = (d - prev_depth) / max(1e-9, f.depth - prev_depth) if crossed else 1.0
                hit_x = prev_x + (f.x - prev_x) * t
                hit_z = prev_z + (f.z - prev_z) * t
                hazard_x, hazard_z = self.hazard_position(d, x, z, kind, phase, now - dt + t * dt)
                hz_r = 1.55 if kind == 0 else 1.15 if kind == 3 else 1.3 if kind == PENDULUM_KIND else 1.25
                hz_d = math.hypot(hit_x - hazard_x, hit_z - hazard_z)
                if crossed and now >= f.stun_until and hz_r <= hz_d < hz_r + GRAZE:   # 😮‍💨 a close call pays
                    f.score += GRAZE_PTS
                    f.grazes += 1
                    self.event(now, "graze", i)
                if now >= f.hit_cool_until and crossed and hz_d < hz_r and f.perk == "shield":
                    f.perk = ""   # 🛡️ the shield takes the hit: no stun, no lost points, but the combo survives too
                    f.hit_cool_until = now + 1.0
                    self.event(now, "shield", i)
                    break
                if now >= f.hit_cool_until and crossed and hz_d < hz_r:
                    f.stun_until = now + (MINE_STUN if kind == 3 else 0.55 if kind == 1 else 0.8)
                    f.hit_cool_until = now + 1.0
                    f.vx += (1 if f.x < x else -1) * 4.5
                    f.vz += (1 if f.z < z else -1) * 3.0
                    f.combo = 0
                    f.score = max(0, f.score - (MINE_PTS if kind == 3 else 4))
                    f.hits += 1
                    self.event(now, "boom" if kind == 3 else "hit", i)
                    break
            # Checkpoints restore the boost charges, while the finish registers exact time.
            if int(f.depth // 180) > getattr(f, "checkpoint", 0):
                f.checkpoint = int(f.depth // 180)
                f.boosts = 3
                f.perk = ""
                f.offer = True
                if not self.room.players.get(self.seats[i]) or self.room.players[self.seats[i]].bot:
                    f.perk, f.offer = self.rng.choice(PERKS), False
                self.event(now, "checkpoint", i)
            if f.depth >= LENGTH:
                f.depth = LENGTH
                f.done_at = now - dt + max(0.0, LENGTH - prev_depth) / max(1e-9, f.depth - prev_depth) * dt
                self.finished.append(i)
                self.event(now, "finish", i)

    def bot_think(self, i, level, now):
        f = self.flyers[i]
        interval, noise, focus = BOT.get(level, BOT["normal"])
        if now < f.next_bot:
            return
        f.next_bot = now + interval
        ri = next((j for j, ring in enumerate(self.rings) if ring[0] > f.depth), None)
        if ri is not None:
            x, z = self.ring_position(ri, now + max(0.0, self.rings[ri][0] - f.depth) / 12.5)   # lead a drifting ring
            if f.aim_ring != ri:
                f.aim_ring = ri
                if self.rng.random() < focus:
                    f.aim_dx = f.aim_dz = 0.0
                else:   # distracted: heads for a spot well beside the ring
                    a = self.rng.uniform(0, math.tau)
                    off = self.rng.uniform(2.2, 3.6)
                    f.aim_dx, f.aim_dz = math.cos(a) * off, math.sin(a) * off * 0.7
            fk = self.forks.get(ri - 1)
            if fk and fk[0] > f.depth:   # a greed fork ahead: some bots peel off for the gem, once per gap
                if f.fork_d != fk[0]:
                    f.fork_d = fk[0]
                    f.fork_go = self.rng.random() < {"easy": 0.0, "normal": 0.3, "hard": 0.5}.get(level, 0.3)
                if f.fork_go:
                    x, z = fk[1], fk[2]
                    f.aim_dx = f.aim_dz = 0.0
            if level != "easy":   # 🪟 a shutter about to be shut when we get there: go round it (the ring is forgone), else thread the gap
                for h in self.hazards:
                    if h[3] == SHUT_KINDS[0] and 0 < h[0] - f.depth < 18:
                        at = now + (h[0] - f.depth) / 12.5
                        if self.hazard_position(*h[:3], h[3], h[4], at)[0] > h[1] + SHUT_AMP * 0.5 - 0.01:   # jaws more than half shut
                            cx = h[1] + 3.2
                            x = max(-7.4, min(7.4, cx + (5.6 if cx <= 0 else -5.6)))
                            f.aim_dx = 0.0
                        break
            x += f.aim_dx
            z += f.aim_dz
            # Lead toward ring to account for steering inertia.
            f.sx = max(-1, min(1, (x - f.x - f.vx * 0.45) / 3.0 + self.rng.uniform(-noise, noise)))
            f.sz = max(-1, min(1, (z - f.z - f.vz * 0.45) / 2.5 + self.rng.uniform(-noise, noise)))
        if f.boosts and now >= f.boost_cool and ri is not None and abs(self.rings[ri][0] - f.depth) < 14:
            f.boosts -= 1
            f.boost_until, f.boost_cool = now + 1.25, now + 2.5

    def end_run(self, now):
        # Timeout finish order uses depth, then actual finish times.
        remaining = sorted((i for i, f in enumerate(self.flyers) if not f.done_at and self.active(i)),
                           key=lambda i: (-self.flyers[i].depth, self.seats[i]))
        for place, i in enumerate(remaining):
            f = self.flyers[i]
            f.done_at, f.place = now + place * 1e-4, len(self.finished) + place + 1
            self.finished.append(i)
        self.finished.sort(key=lambda i: (self.flyers[i].done_at, self.seats[i]))
        for place, i in enumerate(self.finished, 1):
            f = self.flyers[i]
            f.place = place
            f.score += max(0, 18 - 3 * (place - 1))
            if self.level >= 3 and f.done_at and f.depth >= LENGTH:   # 🏅 a dive with no hits, 🥈 with one
                if f.hits == 0:
                    f.score += MEDAL_PERFECT
                    self.moment(f"🏅 {self.player_name(i)}: perfect line, no hits! +{MEDAL_PERFECT}", "gold", "fanfare")
                elif f.hits == 1:
                    f.score += MEDAL_CLEAN
                    self.room.add_log(f"🥈 {self.player_name(i)}: a clean dive, one hit. +{MEDAL_CLEAN}", "power")
        for i, f in enumerate(self.flyers):
            if not self.active(i):
                continue
            self.points[i] += f.score
            self.ring_totals[i] += f.rings
        self.stage = "results"
        self.next_at = now + 4.5
        order = ", ".join(self.player_name(i) for i in self.finished)
        self.room.add_log(f"🪂 Run {self.run}: {order}. Ring points and finish bonuses added.", "big")

    def player_name(self, i):
        p = self.room.players.get(self.seats[i])
        return p.name if p else "?"

    def finish_match(self):
        live = [i for i in range(len(self.seats)) if self.active(i)] or list(range(len(self.seats)))
        top = max(self.points[i] for i in live)
        winners = [i for i in live if self.points[i] == top]
        winner = self.room.players.get(self.seats[winners[0]]) if len(winners) == 1 else None
        self.room.finish(winner, f"🏆 {', '.join(self.player_name(i) for i in winners)} wins Sky Drop with {top} points!")

    def broadcast(self, now=None):
        self.room.push_fast({"skydrop": self.fast_view(now or time.time())})

    def fast_view(self, now, full=False):
        return {"stage": self.stage, "run": self.run, "runs": self.runs, "go": self.go_at,
                "time": now, "raceStarted": self.race_started, "length": LENGTH, "seed": self.seed, "course": self.s.get("course", "spire"), "level": self.level, "levelName": LEVELS[self.level]["name"], "ringR": self.ring_r, "ramp": LEVELS[self.level]["ramp"], "drifts": self.drifts, "dark": self.dark,
                "rings": self.rings, "hazards": self.hazards, "streams": self.streams, "gusts": self.gusts, **({"coins": self.coins} if full else {}),
                "finished": self.finished, "events": self.events,
                "flyers": [[f.depth, f.x, f.z, f.vx, f.vz, f.score, f.rings, f.combo,
                            f.boosts, f.done_at, f.place, f.stun_until, f.hits, f.boost_until, f.perk, f.offer] for f in self.flyers],
                "points": self.points, "ringTotals": self.ring_totals}

    def view(self, p):
        i = self.seat(p)
        return {"skydrop": {**self.fast_view(time.time(), True), "me": i, "seats": self.seats}}

    def meta(self, p):
        i = self.seat(p)
        return f"{self.live_points(i)} pts" if i is not None else "Watching"

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}
