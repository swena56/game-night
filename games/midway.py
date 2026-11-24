"""Midway Night: an original carnival-midway game for 2–6 players, everyone throwing at once.

A night is a run of booths. In each round everybody plays the same booth at the same time, each in their own copy
of it (the same seeded layout), against a throw clock. Basketball has unlimited shots:

- 🎳 Skee Roll: roll balls up a ramp into rings worth 10–50; the two corner cups pay 100.
- ⭕ Ring Toss: toss rings over a 5×5 grid of bottle necks; green, blue and red bottles pay 30, 50, 80.
- 🥫 Can Slam: knock down a 10-can pyramid; a can falls when it is hit or when a can it stands on falls.
  Clearing the stack pays a bonus and it is stacked again.

- 🏀 Basketball: make a swish and follow it with a bank shot for +3. Three baskets in a row activate the hot hand.

🔔 The other booths hide a gold jackpot in a new place each round: the first to hit it wins
+100. 🔥 Hot hand: after three good throws in a row, every good throw pays double until you miss.

A throw is an aim (-1..1, left to right) and a power (0..1). The server adds a little wobble and determines
where it lands and what it scores. For basketball, the browser simulates the bounce and return to the rack.
"""
import math
import random
import time

from .base import Game, GameError

BOOTHS = ("skee", "rings", "cans", "hoops")
NAMES = {"skee": "🎳 Skee Roll", "rings": "⭕ Ring Toss", "cans": "🥫 Can Slam", "hoops": "🏀 Basketball"}
THROWS = {"skee": 9, "rings": 8, "cans": 6}
SHOW = {"skee": 1.6, "rings": 1.2, "cans": 1.0, "hoops": 1.1}    # seconds the browsers take to play a throw out
THROW_CLOCKS = (30, 45, 60, 90, 120)
DEFAULT_THROW_CLOCK = 60
COUNT = 3.0          # the countdown before the bell
BETWEEN = 6.0        # the standings between booths
SETTLE = 2.2         # once everyone has thrown, the last throws play out for this long
HOOP_SETTLE = 2.2    # time for the last basketball to bounce back to the rack
GAP = 0.8            # a person can't throw again sooner than this
JACKPOT = 100
HOT_AT = 3           # good throws in a row before the hot hand

# 🎳 Skee Roll: the ring board, in metres on its face; x across, y up the board (0 at the lip)
SK_W, SK_H, SK_CY = 0.55, 1.1, 0.91
SK_RINGS = ((0.06, 50, SK_CY), (0.06, 40, 0.755), (0.06, 30, 0.595), (0.246, 20, 0.428))
SK_LEGACY_RINGS = tuple((r, points, 0.5) for r, points in
                        ((0.06, 50), (0.13, 40), (0.21, 30), (0.30, 20), (0.40, 10)))
SK_CUPS = ((-0.42, 0.92), (0.42, 0.92))
SK_CUP_R, SK_CUP_PTS = 0.055, 100
SK_JACK_R = 0.05

# ⭕ Ring Toss: bottle necks on a 5×5 grid, x across, y away from you
RT_W, RT_H = 0.6, 1.1
RT_GAP, RT_Y0, RT_DY = 0.22, 0.14, 0.19
RT_RING, RT_RIM, RT_BOUNCE = 0.05, 0.1, 0.4
RT_PTS = {"g": 30, "b": 50, "r": 80}

# 🥫 Can Slam: a 4-3-2-1 pyramid; x across, y up from the shelf
CAN_W, CAN_H, BALL_R = 0.12, 0.16, 0.045
CAN_PTS, SWEEP = 10, 50
CN_W = 0.45
ROWS = (4, 3, 2, 1)
CANS = [(r, k, (k - (n - 1) / 2) * (CAN_W + 0.01), CAN_H / 2 + r * CAN_H) for r, n in enumerate(ROWS) for k in range(n)]
CAN_AT = {(r, k): i for i, (r, k, _, _) in enumerate(CANS)}

# 🏀 Basketball: (x, loft, scoring width, scoring height, tickets) at the hoop entry plane.
BB_MAP = (0.75, 1.15, 0.0)
HOOPS = ((0.0, 0.90, 0.29, 0.26, 1),)
HOOP_TRAVEL = 0.51
HOOP_PERIOD = 3.2
HOOP_CENTER_PAUSE = 0.50
HOOP_GAP = 0.10
HOOP_FLIGHT = SHOW["hoops"] * 0.73
HOOP_FLOATER_TIME = 1.15
HOOP_BANK_LOFT = 1.0
HOOP_BANK_FLIGHT = 0.907  # time for a centered bank at HOOP_BANK_LOFT to reach the net
HOOP_COMBO_BONUS = 3
RAIL_LIMIT = 0.765        # furthest ball-centre reach before the side rail: the ramp's wall less the ball's radius
RAIL_BOUNCE = 0.55


def hoop_x(elapsed, travel=HOOP_TRAVEL):
    leg = HOOP_PERIOD / 2 + HOOP_CENTER_PAUSE
    clock = max(0.0, elapsed) % (2 * leg)
    away = max(0.0, clock % leg - HOOP_CENTER_PAUSE)
    direction = 1 if clock < leg else -1
    return direction * travel * math.sin(math.tau * away / HOOP_PERIOD) ** 2


def hoop_land(aim, power, rng, start_x=0.0):
    w, h, offset = BB_MAP
    s = wobble(power) * 0.7
    return aim * w + rng.gauss(0, s), power * h + offset + rng.gauss(0, s)


# -- 🏀 the ball in flight: one simulation decides the shot and the browsers replay its contacts. Positions are the
# cabinet's own coordinates (x across, y up, z down the lane); the cabinet is stretched in y and z, so distances are
# measured in rendered metres by scaling those axes while the ball stays round.
SIM_G = 9.81
SIM_STEP = 1 / 240
SIM_LAUNCH_Y, SIM_LAUNCH_Z = 1.17, -0.50
SIM_RIM_Z = -2.42                # the hoop's centre depth
SIM_SY, SIM_SZ = 1.14, 1.68      # rendered metres per unit of y and z
SIM_BALL = 0.155
SIM_TUBE = 0.013
SIM_GLASS_Z = -2.622             # rendered glass plane behind the ring
SIM_BOARD_Z = SIM_GLASS_Z + SIM_BALL / SIM_SZ
SIM_RIM_E, SIM_RIM_GLANCE_E, SIM_RIM_SLIP = 0.5, 0.18, 0.92
SIM_BANK_CLIP = 0.10          # a ball kicked off the glass is moving sideways, so it needs a cleaner line through the ring
SIM_BOARD_E, SIM_BOARD_SLIP = 0.78, 0.94    # glass: a deader bounce that also scrubs speed along its face
SIM_RIM_POINTS = 48
SIM_FLOOR_Y, SIM_RACK_Z, SIM_SLOPE = 0.69, -0.86, 0.24
SIM_MAX_T = 4.0
SIM_MAX_HITS = 14


def sim_ramp_y(z):
    return SIM_FLOOR_Y + SIM_BALL + (SIM_RACK_Z - z) * SIM_SLOPE


def hoop_sim(start_x, x, y, elapsed, travel, flight=HOOP_FLIGHT, spin=0.0, backspin=0.0, mode=""):
    """Fly a ball released at (start_x, launch) so that, undisturbed, it would reach the hoop's depth at (x, y), and follow
    it through the rim, glass and side rails. Returns {good, swish, bank, path, landAt}: `path` is a list of keyframes
    [t, x, y, z, vx, vy, vz, kind, ax, ay], the launch and each contact; between two keyframes the ball is in free fall."""
    ring_r = HOOPS[0][2] + 0.052
    rim_y = 1 + HOOPS[0][1]
    reach = SIM_BALL + SIM_TUBE
    if mode == "floater":
        flight *= HOOP_FLOATER_TIME
    spin = max(-1.0, min(1.0, spin))
    backspin = max(0.0, min(1.0, backspin))
    ax = spin * 0.4
    ay = backspin * 1.2
    vx = (x - start_x) / flight - ax * flight / 2
    vz = (SIM_RIM_Z - SIM_LAUNCH_Z) / flight
    vy = (y - 0.17) / flight + (SIM_G - ay) * flight / 2
    px, py, pz = start_x, SIM_LAUNCH_Y, SIM_LAUNCH_Z
    t = 0.0
    path = []
    hits = 0
    good = bank = rim_touched = False

    def key(kind):
        path.append([round(t, 4), round(px, 4), round(py, 4), round(pz, 4), round(vx, 4), round(vy, 4), round(vz, 4), kind, round(ax, 4), round(ay, 4)])

    key("launch")
    ring = [(math.cos(math.tau * k / SIM_RIM_POINTS) * ring_r, math.sin(math.tau * k / SIM_RIM_POINTS) * ring_r / SIM_SZ)
            for k in range(SIM_RIM_POINTS)]
    while t < SIM_MAX_T:
        prev_y = py
        board_contact = vz < 0 and pz + vz * SIM_STEP <= SIM_BOARD_Z
        # End the free-flight segment at impact so replay never carries the ball through the glass.
        dt = (SIM_BOARD_Z - pz) / vz if board_contact else SIM_STEP
        px += vx * dt + ax * dt ** 2 / 2
        py += vy * dt + (ay - SIM_G) * dt ** 2 / 2
        pz += vz * dt
        vy += (ay - SIM_G) * dt
        vx += ax * dt
        t += dt
        hit = None
        hard_rim_hit = False
        if abs(px) > RAIL_LIMIT and px * vx > 0:
            px = math.copysign(RAIL_LIMIT, px)
            vx *= -RAIL_BOUNCE
            hit = "rail"
        if board_contact:
            pz = SIM_BOARD_Z
            vx *= SIM_BOARD_SLIP
            vy *= SIM_BOARD_SLIP
            vz *= -SIM_BOARD_E
            hit = "board" if py >= rim_y - 0.15 else "wall"
            bank |= hit == "board"
        hoop_time = elapsed + t
        hx = hoop_x(hoop_time, travel)
        hoop_vx = (hoop_x(hoop_time + SIM_STEP / 2, travel) -
                   hoop_x(hoop_time - SIM_STEP / 2, travel)) / SIM_STEP if travel else 0.0
        if not board_contact and abs(py - rim_y) * SIM_SY < reach + 0.05 and abs(pz - SIM_RIM_Z) * SIM_SZ < ring_r + reach:
            for ox, oz in ring:
                dx, dy, dz = px - (hx + ox), (py - rim_y) * SIM_SY, (pz - (SIM_RIM_Z + oz)) * SIM_SZ
                d = math.sqrt(dx * dx + dy * dy + dz * dz)
                if d >= reach or d < 1e-9:
                    continue
                nx, ny, nz = dx / d, dy / d, dz / d
                wy, wz = vy * SIM_SY, vz * SIM_SZ
                relative_vx = vx - hoop_vx
                vn = relative_vx * nx + wy * ny + wz * nz
                if vn < 0:
                    # Blend from a soft iron graze to a firmer rebound instead
                    # of switching restitution abruptly at one impact speed.
                    impact = -vn
                    blend = max(0.0, min(1.0, (impact - 0.08) / 0.67))
                    e = SIM_RIM_GLANCE_E + (SIM_RIM_E - SIM_RIM_GLANCE_E) * blend
                    slip = SIM_RIM_SLIP + backspin * (1 - SIM_RIM_SLIP) * 0.45
                    tx, ty, tz = relative_vx - vn * nx, wy - vn * ny, wz - vn * nz
                    vx = tx * slip - e * vn * nx + hoop_vx
                    wy = ty * slip - e * vn * ny
                    wz = tz * slip - e * vn * nz
                    vy, vz = wy / SIM_SY, wz / SIM_SZ
                    # Even a glancing contact changes velocity, so preserve
                    # it in the replay path as well as in the scored sim.
                    hit = "rim"
                    rim_touched = True
                    hard_rim_hit |= impact > 0.3
                push = reach - d
                px += nx * push
                py += ny * push / SIM_SY
                pz = max(SIM_BOARD_Z, pz + nz * push / SIM_SZ)
        if hit:
            # Soft rim grazes can be recorded without consuming the guard
            # against repeated hard collisions in a crowded path.
            if hit != "rim" or hard_rim_hit:
                hits += 1
            key(hit)
            if hits >= SIM_MAX_HITS:
                break
        if prev_y > rim_y >= py and vy < 0:
            off = math.hypot(px - hx, (pz - SIM_RIM_Z) * SIM_SZ)
            # A rim hit can knock the ball back over the opening. Give it time
            # to rattle around the iron, then let a downward crossing drop if
            # its center has cleared the inner edge of the rim.
            spin_help = abs(spin) * 0.035 + backspin * 0.025
            rattled_in = rim_touched and off <= ring_r - SIM_BALL * 0.1 + spin_help
            clean_in = off <= ring_r - SIM_BALL * 0.55 - (SIM_BANK_CLIP if bank else 0.0) + spin_help
            if clean_in or rattled_in:
                good = True
                key("net")
                break
        if py <= sim_ramp_y(pz) or py < rim_y - 1.0:
            break
    if not good and path[-1][0] != round(t, 4):
        key("end")
    swish = good and not any(k[7] in ("rim", "board") for k in path)
    return {"good": good, "swish": swish, "bank": good and bank, "path": path, "landAt": path[-1][0]}


BOT_SIGMA = {"easy": 0.10, "normal": 0.055, "hard": 0.03}
BOT_HOOP_SIGMA = {"easy": 0.15, "normal": 0.087, "hard": 0.058}    # basketball: about 51%, 76% and 90% of shots go in
BOT_PACE = {"easy": (2.6, 4.4), "normal": (2.2, 3.6), "hard": (1.9, 3.0)}


def wobble(power):
    """The server's own scatter on a throw (metres): a harder throw is a little less sure."""
    return 0.012 + 0.025 * power


def bottles():
    """Bottle neck centres, row by row from the front: [(x, y)] × 25."""
    return [((c - 2) * RT_GAP, RT_Y0 + r * RT_DY) for r in range(5) for c in range(5)]


BOTTLES = bottles()


# -- where throws land and what they score (pure: the bots use these too)

def skee_land(aim, power, rng):
    s = wobble(power)
    return aim * SK_W + rng.gauss(0, s), power * SK_H - 0.08 + rng.gauss(0, s)


SK_LIP = 0.014      # a ball landing this close to a ring's edge rattles along the lip and drops one side or the other
SK_RIMLIP = 0.022   # ...and one skimming a cup's rim may drop in


def skee_settle(x, y, rng, rings=SK_RINGS):
    """🎳 Where a ball that first lands at (x, y) comes to rest: (x, y, rattled). Straddling a ring's wire it hops
    to either side; just outside a corner cup's rim it sometimes drops in."""
    if y < 0:
        return x, y, False
    for cx, cy in SK_CUPS:
        d = math.hypot(x - cx, y - cy)
        if SK_CUP_R <= d < SK_CUP_R + SK_RIMLIP and rng.random() < 0.4:
            return cx, cy, True
    for rad, _, cy in rings:
        r = math.hypot(x, y - cy)
        if abs(r - rad) < SK_LIP:
            to = rad + rng.choice((-1, 1)) * (SK_LIP + 0.012)
            k = to / (r or 1e-6)
            return x * k, cy + (y - cy) * k, True
    return x, y, False


def skee_score(x, y, jack=None, rings=SK_RINGS):
    """(points, where, jackpot hit) for a skee ball that reaches (x, y) on the board."""
    if y < 0:
        return 0, "short", False
    jp = bool(jack) and math.hypot(x - jack[0], y - jack[1]) < SK_JACK_R
    for cx, cy in SK_CUPS:
        if math.hypot(x - cx, y - cy) < SK_CUP_R:
            return SK_CUP_PTS, "cup", jp
    for rad, pts, cy in rings:
        if math.hypot(x, y - cy) < rad:
            return pts, str(pts), jp
    return 10, "gutter", jp      # it rolls down into the 10 at the bottom


def ring_land(aim, power, rng):
    s = wobble(power)
    return aim * RT_W + rng.gauss(0, s), power * RT_H - 0.05 + rng.gauss(0, s)


def ring_settle(x, y, rng):
    """Which bottle (index or None) a ring landing at (x, y) ends up on, and where it ends up: (bottle, x, y, bounced)."""
    best, bd = None, 9.0
    for i, (bx, by) in enumerate(BOTTLES):
        d = math.hypot(x - bx, y - by)
        if d < bd:
            best, bd = i, d
    if bd < RT_RING:
        return best, BOTTLES[best][0], BOTTLES[best][1], False
    if bd < RT_RIM and rng.random() < RT_BOUNCE:
        # it clips the rim and hops on once
        bx, by = BOTTLES[best]
        a = math.atan2(y - by, x - bx) + rng.uniform(-0.9, 0.9)
        dist = rng.uniform(0.12, 0.24)
        nx, ny = bx + dist * math.cos(a), by + dist * math.sin(a)
        for i, (cx, cy) in enumerate(BOTTLES):
            if math.hypot(nx - cx, ny - cy) < RT_RING * 1.4:
                return i, cx, cy, True
        return None, nx, ny, True
    return None, x, y, False


def can_land(aim, power, rng):
    s = wobble(power)
    return aim * CN_W + rng.gauss(0, s), 0.02 + power * 0.7 + rng.gauss(0, s)


def can_hit(x, y, up):
    """The standing can (index) a ball at (x, y) strikes first, or None. `up` is the list of standing flags."""
    best, bd = None, 9.0
    for i, (_, _, cx, cy) in enumerate(CANS):
        if up[i] and abs(x - cx) < CAN_W / 2 + BALL_R and abs(y - cy) < CAN_H / 2 + BALL_R:
            d = math.hypot(x - cx, y - cy)
            if d < bd:
                best, bd = i, d
    return best


def can_knock(hit, x, up, rng):
    """Knock can `hit` down (it falls the way the ball pushes it); returns the list of cans that fall, in order."""
    up = list(up)
    fell = [hit]
    up[hit] = False
    r, k, cx, _ = CANS[hit]
    # a solid hit sends a neighbour on the same row over too
    side = 1 if x < cx else -1
    nb = CAN_AT.get((r, k + side))
    if nb is not None and up[nb] and rng.random() < 0.35:
        up[nb] = False
        fell.append(nb)
    # anything standing on a fallen can follows it down
    changed = True
    while changed:
        changed = False
        for i, (rr, kk, _, _) in enumerate(CANS):
            if up[i] and rr > 0 and not (up[CAN_AT[(rr - 1, kk)]] and up[CAN_AT[(rr - 1, kk + 1)]]):
                up[i] = False
                fell.append(i)
                changed = True
    return fell


class Midway(Game):
    id = "midway"
    category = "action"
    family = None
    howto = [
        "Everyone plays the same carnival booth at the same time, each in your own copy. If the throw clock is on, roll or throw before it runs out.",
        "In Ring Toss and Can Slam, swipe up to throw. A longer swipe throws farther or higher. Ring Toss and Can Slam also have on-screen buttons.",
        "🎳 Skee Roll: drag sideways to aim, pull back and hold to charge, then release. Pockets pay 10–50, and the corner cups pay 100.",
        "⭕ Ring Toss: green 30, blue 50, red 80. 🥫 Can Slam: 10 a can, +50 for clearing the stack.",
        "🏀 Basketball: Tap a ball and flick up to shoot. A longer flick hits the glass. In Swish & Bank, follow a clean swish with a made bank shot for +3. Use the mark on the power meter to judge your flick. Baskets are worth one, and a clean swish during the hot hand pays one extra.",
        "🔔 Skee Roll, Ring Toss and Can Slam hide a gold jackpot: the first to hit it wins +100. 🔥 Three good throws in a row and every good throw pays double until you miss (in every booth).",
        "Most 🎟 tickets after the last booth wins; ties go to the most jackpots.",
    ]
    name = "Midway Night"
    icon = "🎪"
    blurb = "A carnival night of skee rolls, ring tosses, can slams and basketball: everyone throws at once, the gold jackpot goes to the quickest."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "jackpot": ("🔔", "Jackpot", "Hit a booth's gold jackpot first"),
              "sweep": ("🥫", "Clean sweep", "Knock down a whole can pyramid"),
              "hot": ("🔥", "Hot hand", "Make five good throws in a row")}
    settings_schema = {
        "booths": ("Rounds", [(4, "4 rounds"), (3, "3 rounds"), (6, "6 rounds")], 4),
        "booth_type": ("Booth type", [("mixed", "Mixed booths")] + [(kind, NAMES[kind]) for kind in BOOTHS], "mixed"),
        "hoop_movement": ("Basketball hoop", [("fixed", "Fixed hoop"), ("moving", "Moving hoop")], "fixed"),
        "hoop_scoring": ("Basketball scoring", [("combo", "Swish & Bank"), ("classic", "Classic")], "combo"),
        "clock": ("Throw clock", [(seconds, f"{seconds} s") for seconds in THROW_CLOCKS] + [(0, "No time limit")], DEFAULT_THROW_CLOCK),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.hoop_scoring = self.s.get("hoop_scoring", "combo")
        self.seats = [p.id for p in seated]
        self.shot_id = 0
        self.round_no = 0
        self.stage = "count"
        self.t0 = time.time()
        n = self.total
        kind = self.s.get("booth_type")
        order = [kind] * n if kind in BOOTHS else []
        while len(order) < n:
            run = list(BOOTHS)
            rng.shuffle(run)
            if order and run[0] == order[-1]:
                run.reverse()
            order += run
        self.order = order[:n]
        for p in seated:
            p.g.tickets, p.g.jackpots, p.g.best_streak = 0, 0, 0
        self.room.turn = None
        self.room.bot_at = 0
        timing = f"{self.clock} seconds each" if self.clock else "no time limit"
        title = "🏀 Basketball" if self.id == "basketball" else "🎪 Midway Night"
        intro = ("Shoot for your high score!" if len(seated) == 1 else "Shoot for the high score!") if self.id == "basketball" else "Step right up!"
        self.room.add_log(f"{title}: {n} booths, {timing}. {intro}", "big")
        self.new_round()

    @property
    def total(self):
        v = self.s.get("booths", 4)
        return v if v in (3, 4, 6) else 4

    @property
    def clock(self):
        v = self.s.get("clock")
        return v if v in THROW_CLOCKS or v == 0 else DEFAULT_THROW_CLOCK

    @property
    def hoop_travel(self):
        return HOOP_TRAVEL if self.s.get("hoop_movement") == "moving" else 0.0

    @property
    def hoop_combos(self):
        return getattr(self, "hoop_scoring", "classic") == "combo"

    def bank_ready(self, g):
        return self.hoop_combos and bool(g.shots and g.shots[-1].get("swish"))

    @property
    def kind(self):
        return self.order[self.round_no - 1]

    @property
    def skee_rings(self):
        return SK_RINGS if getattr(self, "stacked_skee", False) else SK_LEGACY_RINGS

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players]

    def present(self):
        return [p for p in self.players() if not p.eliminated]

    def new_round(self):
        r, rng = self.room, self.rng
        self.mark_round()
        self.round_no += 1
        kind = self.kind
        self.stage = "count"
        self.t0 = time.time() + COUNT
        r.deadline = self.t0
        self.jack_by = None
        self.colours = None
        if kind == "skee":
            self.stacked_skee = True
            self.jack = (round(rng.uniform(-0.3, 0.3), 3), round(rng.uniform(0.72, 0.9), 3))
        elif kind == "rings":
            cols = []
            for row in range(5):
                for _ in range(5):
                    w = {0: (6, 1, 0), 1: (4, 2, 0), 2: (2, 3, 1), 3: (1, 3, 2), 4: (0, 2, 3)}[row]
                    cols.append(rng.choices("gbr", weights=w)[0])
            self.colours = cols
            self.jack = rng.randrange(10, 25)     # a bottle in the middle or back rows
        elif kind == "hoops":
            self.jack = None
        else:
            self.jack = rng.choice([i for i, (row, _, _, _) in enumerate(CANS) if row < 3])
        for p in self.players():
            g = p.g
            g.left = THROWS.get(kind)
            g.shots, g.streak, g.booth_pts = [], 0, 0
            g.cans = [True] * len(CANS)
            g.stacks = 0
            g.last_at = 0.0
            g.next_at = self.t0 + random.uniform(0.6, 1.8)
        format_hint = ("Free play, no time limit" if self.clock == 0 else f"{self.clock} seconds to score") if kind == "hoops" else f"{THROWS[kind]} throws each"
        scoring_hint = "One point per basket."
        if self.hoop_combos:
            scoring_hint += f" Follow a swish with a bank for +{HOOP_COMBO_BONUS}."
        if self.id == "basketball":
            r.add_log(f"🏀 Tip-off! {format_hint}. {scoring_hint}", "info")
        else:
            r.add_log(f"🔔 Booth {self.round_no} of {self.total}: {NAMES[kind]}, {format_hint}. " +
                      ("A gold jackpot is hidden in it!" if kind != "hoops" else scoring_hint), "info")

    def on_restore(self, shift):
        self.t0 += shift
        for p in self.players():
            if hasattr(p.g, "next_at"):
                p.g.next_at += shift
                p.g.last_at += shift

    # -- throwing

    def act(self, p, a):
        if a.get("type") != "throw":
            raise GameError("Unknown action.")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're watching this one.")
        aim, power = a.get("aim"), a.get("power")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (aim, power)):
            raise GameError("Bad throw.")
        if abs(aim) > 1 or not 0 <= power <= 1:
            raise GameError("Bad throw.")
        if self.stage == "count":
            raise GameError("Wait for the bell!")
        now = time.time()
        if self.stage != "play" or (self.room.deadline is not None and now >= self.room.deadline):
            raise GameError("This booth is closed.")
        if self.kind != "hoops" and p.g.left <= 0:
            raise GameError("You're out of throws: watch the others.")
        if now < p.g.last_at + (HOOP_GAP if self.kind == "hoops" else GAP):
            raise GameError("One at a time!")
        start_x = a.get("startX", 0.0)
        if self.kind == "hoops" and (not isinstance(start_x, (int, float)) or isinstance(start_x, bool)
                                     or not math.isfinite(start_x) or abs(start_x) > 0.85):
            raise GameError("Bad ball position.")
        spin = a.get("spin", 0.0)
        if self.kind == "hoops" and (not isinstance(spin, (int, float)) or isinstance(spin, bool)
                                      or not math.isfinite(spin) or abs(spin) > 1):
            raise GameError("Bad spin.")
        backspin = a.get("backspin", 0.0)
        if self.kind == "hoops" and (not isinstance(backspin, (int, float)) or isinstance(backspin, bool)
                                      or not math.isfinite(backspin) or not 0 <= backspin <= 1):
            raise GameError("Bad backspin.")
        mode = a.get("mode", "")
        if self.kind == "hoops" and mode not in ("", "bank", "floater"):
            raise GameError("Bad shot mode.")
        self.throw(p, float(aim), float(power), float(start_x) if self.kind == "hoops" else 0.0,
                   float(spin) if self.kind == "hoops" else 0.0,
                   float(backspin) if self.kind == "hoops" else 0.0, mode if self.kind == "hoops" else "")

    def throw(self, p, aim, power, start_x=0.0, spin=0.0, backspin=0.0, mode=""):
        g, kind, rng, now = p.g, self.kind, self.rng, time.time()
        if kind != "hoops":
            g.left -= 1
        g.last_at = now
        self.shot_id += 1
        shot = {"id": self.shot_id, "aim": round(aim, 3), "power": round(power, 3), "k": kind}
        pts, good, jack, sweep = 0, False, False, False
        if kind == "skee":
            x, y = skee_land(aim, power, rng)
            ex, ey, rattle = skee_settle(x, y, rng, self.skee_rings)
            jk = self.jack if self.jack_by is None else None
            pts, where, jack = skee_score(ex, ey, jk, self.skee_rings)
            good = pts >= 30
            shot.update(x=round(x, 3), y=round(y, 3), ex=round(ex, 3), ey=round(ey, 3), rattle=rattle, where=where)
        elif kind == "rings":
            x, y = ring_land(aim, power, rng)
            b, ex, ey, bounced = ring_settle(x, y, rng)
            if b is not None:
                pts = RT_PTS[self.colours[b]]
                good = True
                jack = b == self.jack and self.jack_by is None
            shot.update(x=round(x, 3), y=round(y, 3), ex=round(ex, 3), ey=round(ey, 3), b=b, bounce=bounced)
        elif kind == "hoops":
            x, y = hoop_land(aim, power, rng)
            shot["startX"] = round(start_x, 3)
            elapsed = now - self.t0
            sim = hoop_sim(start_x, x, y, elapsed, self.hoop_travel, spin=spin, backspin=backspin, mode=mode)
            good = sim["good"]
            pts = int(good)
            shot.update(x=round(x, 3), y=round(y, 3), spin=round(spin, 2), backspin=round(backspin, 2), mode=mode,
                        hoop=0 if good else None, path=sim["path"], landAt=sim["landAt"],
                        swish=sim["swish"], bank=sim["bank"],
                        targetX=round(hoop_x(elapsed + sim["landAt"], self.hoop_travel), 4))
        else:
            x, y = can_land(aim, power, rng)
            hit = can_hit(x, y, g.cans)
            fell = can_knock(hit, x, g.cans, rng) if hit is not None else []
            for i in fell:
                g.cans[i] = False
            pts = CAN_PTS * len(fell)
            good = bool(fell)
            jack = self.jack in fell and self.jack_by is None and g.stacks == 0
            if fell and not any(g.cans):
                sweep = True
                pts += SWEEP
                g.cans = [True] * len(CANS)
                g.stacks += 1
            shot.update(x=round(x, 3), y=round(y, 3), fell=fell, sweep=sweep)
        hot = good and g.streak >= HOT_AT
        if hot:
            pts *= 2
            if kind == "hoops" and shot.get("swish"):
                pts += 1     # a clean swish on the hot hand pays a ticket more
        if kind == "hoops" and shot["bank"] and self.bank_ready(g):
            shot["combo"] = HOOP_COMBO_BONUS
            pts += HOOP_COMBO_BONUS
        g.streak = g.streak + 1 if good else 0
        g.best_streak = max(g.best_streak, g.streak)
        if jack:
            self.jack_by = p.id
            pts += JACKPOT
            g.jackpots += 1
        g.tickets += pts
        g.booth_pts += pts
        shot.update(pts=pts, good=good, hot=hot, jack=jack, t=SHOW[kind])
        g.shots.append(shot)
        self.tell(p, shot)
        if kind != "hoops" and all(o.g.left <= 0 for o in self.present()):
            self.stage = "settle"
            self.room.deadline = now + SETTLE

    def tell(self, p, shot):
        nm, kind, at = p.name, shot["k"], time.time() + shot["t"]
        if kind == "skee":
            what = {"short": "falls short", "cup": "sinks a corner cup", "gutter": "rolls into the 10"}.get(shot["where"], f"rolls into the {shot['where']}")
        elif kind == "rings":
            what = f"rings a {dict(g='green', b='blue', r='red')[self.colours[shot['b']]]} bottle" if shot["b"] is not None else "misses"
        elif kind == "hoops":
            what = ("completes a swish-and-bank combo" if shot.get("combo") else
                    "sinks a basket" if shot["hoop"] is not None else "misses the basket")
        else:
            n = len(shot["fell"])
            what = f"knocks down {n} can{'s' if n != 1 else ''}" if n else "misses the cans"
        self.room.add_log(f"🎟 {nm} {what}" + (f" (+{shot['pts']}{', 🔥 ×2' if shot['hot'] else ''})" if shot["pts"] else "") + ".", "info")
        if shot["jack"]:
            self.award(p, "jackpot", at=at)
            self.moment(f"🔔 {nm} hits the JACKPOT: +{JACKPOT}!", "gold", "fanfare", at=at)
        if shot.get("sweep"):
            self.award(p, "sweep", at=at)
            self.moment(f"🥫 {nm} clears the whole stack: +{SWEEP}!", "good", "boom", at=at)
        if kind == "skee" and shot["where"] == "cup" and not shot["jack"]:
            self.moment(f"🎳 {nm} sinks a corner cup!", "good", "good", at=at)
        if p.g.streak == HOT_AT:
            self.moment(f"🔥 {nm} has a hot hand: double tickets!", "cool", "good", at=at)
        if p.g.streak == 5:
            self.award(p, "hot", at=at)

    # -- rounds

    def ranking(self, ps):
        return sorted(ps, key=lambda o: (o.g.tickets, o.g.jackpots), reverse=True)

    def end_round(self):
        r = self.room
        here = self.present()
        self.stage = "between"
        r.deadline = time.time() + BETWEEN
        if here:
            r.add_log(f"🏁 {NAMES[self.kind]}: " + ", ".join(f"{o.name} {o.g.booth_pts}" for o in self.ranking(here)) + " tickets.", "big")
            best = max(here, key=lambda o: o.g.booth_pts)
            if best.g.booth_pts and sum(1 for o in here if o.g.booth_pts == best.g.booth_pts) == 1 and len(here) > 1:
                self.moment(f"🏆 {best.name} takes {NAMES[self.kind]} with {best.g.booth_pts} tickets!", "gold", "good")

    def after_round(self):
        r = self.room
        here = self.present()
        if not here:
            return r.finish(None, "Everyone left.")
        if self.round_no >= self.total or len(here) <= 1:
            ranked = self.ranking(here)
            top = ranked[0]
            tied = [o for o in ranked if (o.g.tickets, o.g.jackpots) == (top.g.tickets, top.g.jackpots)]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {top.g.tickets} tickets between {' & '.join(o.name for o in tied)}.",
                                draw=True)
            by_jack = len(ranked) > 1 and ranked[1].g.tickets == top.g.tickets
            return r.finish(top, f"🏆 {top.name} wins Midway Night with {top.g.tickets} tickets"
                            + (f" and {top.g.jackpots} jackpot{'s' if top.g.jackpots != 1 else ''}!" if by_jack else "!"))
        self.new_round()

    def on_timeout(self):
        r = self.room
        if r.phase != "playing":
            return
        if self.stage == "count":
            self.stage = "play"
            r.deadline = self.t0 + self.clock if self.clock else None
            return
        if self.stage == "play":
            if self.clock == 0:
                r.deadline = None
                return
            last_throw = max((o.g.last_at for o in self.players()), default=0)
            last_return = last_throw + (HOOP_SETTLE if self.kind == "hoops" else SETTLE)
            if time.time() < last_return:
                self.stage = "settle"
                r.deadline = last_return
                return
        if self.stage in ("play", "settle"):
            return self.end_round()
        return self.after_round()

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the midway.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if self.stage == "play" and self.kind != "hoops" and all(o.g.left <= 0 for o in self.present()):
            self.stage = "settle"
            r.deadline = time.time() + SETTLE

    # -- bots: pick the target worth most to a hand as steady as theirs, then throw at it with that hand

    def can_bot_throw(self, o, now):
        return (self.stage == "play" and (self.room.deadline is None or now < self.room.deadline)
                and o.bot and (self.kind == "hoops" or getattr(o.g, "left", 0) > 0)
                and now >= o.g.next_at)

    def bot_ready(self):
        now = time.time()
        return any(self.can_bot_throw(o, now) for o in self.present())

    def bot_tick(self):
        now = time.time()
        for o in self.present():
            if self.can_bot_throw(o, now):
                aim, power = self.plan(o)
                lo, hi = BOT_PACE.get(o.bot, BOT_PACE["normal"])
                o.g.next_at = now + random.uniform(lo, hi)
                self.throw(o, aim, power)

    def targets(self, o):
        """[(name, x, y)] spots on this booth worth aiming at, in its own metres."""
        kind = self.kind
        if kind == "skee":
            out = [(str(points), 0.0, cy) for _, points, cy in self.skee_rings if points >= 30]
            if self.skee_rings is SK_LEGACY_RINGS:
                out = out[:1]
            out.extend(("cup", x, y) for x, y in SK_CUPS)
            if self.jack_by is None:
                out.append(("jack", *self.jack))
            return out
        if kind == "rings":
            return [(i, x, y) for i, (x, y) in enumerate(BOTTLES)]
        if kind == "hoops":
            flight, loft = (HOOP_BANK_FLIGHT, HOOP_BANK_LOFT) if self.bank_ready(o.g) else (HOOP_FLIGHT, HOOPS[0][1])
            return [(0, hoop_x(time.time() - self.t0 + flight, self.hoop_travel), loft)]
        return [(i, cx, cy) for i, (_, _, cx, cy) in enumerate(CANS) if o.g.cans[i]]

    def value(self, o, x, y, rng):
        """Tickets one throw landing at (x, y) would earn (before the hot hand)."""
        kind = self.kind
        if kind == "skee":
            pts, _, jp = skee_score(x, y, self.jack if self.jack_by is None else None, self.skee_rings)
            return pts + (JACKPOT if jp else 0)
        if kind == "rings":
            b, _, _, _ = ring_settle(x, y, rng)
            if b is None:
                return 0
            return RT_PTS[self.colours[b]] + (JACKPOT if b == self.jack and self.jack_by is None else 0)
        hit = can_hit(x, y, o.g.cans)
        if hit is None:
            return 0
        fell = can_knock(hit, x, o.g.cans, rng)
        v = CAN_PTS * len(fell)
        if len(fell) == sum(o.g.cans):
            v += SWEEP
        if self.jack in fell and self.jack_by is None and o.g.stacks == 0:
            v += JACKPOT
        return v

    def to_throw(self, x, y):
        """The (aim, power) that lands at (x, y) with no wobble."""
        kind = self.kind
        if kind == "skee":
            aim, power = x / SK_W, (y + 0.08) / SK_H
        elif kind == "rings":
            aim, power = x / RT_W, (y + 0.05) / RT_H
        elif kind == "hoops":
            w, h, offset = BB_MAP
            aim, power = x / w, (y - offset) / h
        else:
            aim, power = x / CN_W, (y - 0.02) / 0.7
        return max(-1.0, min(1.0, aim)), max(0.0, min(1.0, power))

    def plan(self, o):
        level = o.bot if o.bot in BOT_SIGMA else "normal"
        sig = BOT_SIGMA[level]
        rng = random.Random(self.rng.getrandbits(32))
        cands = self.targets(o)
        if self.kind == "hoops":
            _, x, y = cands[0]
            hs = BOT_HOOP_SIGMA[level]
            return self.to_throw(x + rng.gauss(0, hs), y + rng.gauss(0, hs))
        if level == "easy":
            # aims at whatever looks biggest, without weighing its own shaky hand
            if self.kind == "skee":
                pick = rng.choice(cands)
            elif self.kind == "rings":
                pick = max(cands, key=lambda t: RT_PTS[self.colours[t[0]]] + rng.random() * 30)
            else:
                pick = rng.choice(cands)
            tx, ty = pick[1], pick[2]
        else:
            def ev(t):
                tot = 0.0
                for _ in range(16):
                    aim, power = self.to_throw(t[1] + rng.gauss(0, sig), t[2] + rng.gauss(0, sig))
                    land = {"skee": skee_land, "rings": ring_land, "cans": can_land}[self.kind](aim, power, rng)
                    tot += self.value(o, land[0], land[1], rng)
                return tot / 16
            if level == "normal" and len(cands) > 6:
                cands = rng.sample(cands, 6)
            tx, ty = max(cands, key=ev)[1:]
        return self.to_throw(tx + rng.gauss(0, sig), ty + rng.gauss(0, sig))

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "tickets"):
            return ""
        return f"🎟 {p.g.tickets}" + (f" · 🔥" if getattr(p.g, "streak", 0) >= HOT_AT else "")

    def final_scores(self):
        return {o.id: o.g.tickets for o in self.players()}

    def view(self, p):
        now = time.time()
        r = self.room
        booths = {}
        for o in self.players():
            g = o.g
            booths[o.id] = {"tickets": g.tickets, "jackpots": g.jackpots, "left": None if self.kind == "hoops" else g.left, "streak": g.streak,
                            "pts": g.booth_pts, "shots": g.shots, "cans": g.cans, "stacks": g.stacks, "out": o.eliminated}
        kind = self.kind
        layout = ({"jack": list(self.jack)} if kind == "skee" else
                  {"colours": self.colours, "jack": self.jack} if kind == "rings" else {"jack": self.jack})
        geo = ({"map": [SK_W, SK_H, -0.08], "rings": self.skee_rings, "cups": SK_CUPS, "cupR": SK_CUP_R, "jackR": SK_JACK_R,
                "cy": self.skee_rings[0][2], "stacked": getattr(self, "stacked_skee", False)}
               if kind == "skee" else
               {"map": [RT_W, RT_H, -0.05], "bottles": BOTTLES, "pts": RT_PTS, "ring": RT_RING} if kind == "rings" else
               {"map": [CN_W, 0.7, 0.02], "cans": [[cx, cy] for _, _, cx, cy in CANS], "w": CAN_W, "h": CAN_H, "ball": BALL_R,
                "pts": CAN_PTS, "sweep": SWEEP})
        if kind == "hoops":
            geo = {"map": BB_MAP, "hoops": HOOPS, "travel": self.hoop_travel, "period": HOOP_PERIOD,
                   "centerPause": HOOP_CENTER_PAUSE}
            if self.hoop_combos:
                geo["combo"] = {"bonus": HOOP_COMBO_BONUS, "swishPower": HOOPS[0][1] / BB_MAP[1],
                                "bankPower": HOOP_BANK_LOFT / BB_MAP[1]}
        jb = r.players.get(self.jack_by) if self.jack_by else None
        return {"midway": {
            "seats": self.seats, "me": p.id if p.id in self.seats else None,
            "round": self.round_no, "rounds": self.total, "order": self.order, "kind": kind, "name": NAMES[kind],
            "throws": THROWS.get(kind), "stage": self.stage, "clock": self.clock,
            "hoopElapsed": max(0.0, now - self.t0) if kind == "hoops" else None,
            "startIn": max(0.0, round(self.t0 - now, 2)) if self.stage == "count" else 0,
            "timeLeft": (None if r.deadline is None else max(0.0, round(r.deadline - now, 2))) if self.stage in ("play", "settle") else 0,
            "layout": layout, "geo": geo, "jackBy": jb.name if jb else None, "booths": booths, "gap": HOOP_GAP if kind == "hoops" else GAP, "hotAt": HOT_AT,
            "standings": self.standings() if self.stage == "between" and len(self.seats) > 1 else None,
        }}
