"""Moon Lander: an original lunar-landing contest for 1–6 players, everyone flying at once.

Each round drops everyone over the same stretch of moon with three landing pads: a wide ×1 pad, a ×2 and a narrow ×3
perched somewhere awkward. Rotate and fire your one engine to come down softly on a pad: under 2.5 m/s down,
1.5 m/s sideways and 11° of tilt, or it's a crash. A landing scores the pad's multiplier × (50 + up to 30 for a
soft touchdown + up to 20 for landing near the middle). Fuel carries over: the tank gets a top-up each round, so
fuel burnt hovering now is fuel you won't have later.

You're the supply run (#165): each pad is an outpost that needs something. A ⛽ refinery fills your tank back up a
little, a 🚑 medical rush pays the first lander a bonus, and a 🔬 survey lab pays for landing dead centre. Crystals
and fuel canisters float in the sky (#167): a canister tops the tank up the moment you touch it; a 💎 crystal only
counts if that flight ends in a landing. After a landing you may hop (#166): burn again within a few seconds of
touchdown to lift off and land on a *different* pad for ×1.5 more (a crash on the hop keeps the first landing).

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
# the supply run: outposts on the pads, pickups in the sky, the hop
NEEDS = ("fuel", "rush", "lab")
NEED_FUEL, RUSH, LAB, LAB_PREC = 8 * 30, 40, 30, 0.8
OUTPOSTS = ("Tycho Base", "Copernicus Camp", "Shackleton Ice Works", "Mare Station", "Kepler Lab", "Aristarchus Post",
            "Plato Depot", "Hadley Outpost", "Serenity Dome", "Clavius Yard")
GEM, PICK_FUEL, PICK_R2, N_PICKS = 15, 3 * 30, 2.6 * 2.6, 4
HOP_MULT, HOP_MIN, HOP_OPEN, HOP_CLOSE = 1.5, 3 * 30, 24, 24 + 120   # ticks after touchdown: the window to lift off
STREAK_PTS, STREAK_MAX = 5, 15   # 🔥 each landing in a row after the first adds this much (up to the max); a crash or a missed round resets it
BRIEFING, EXPEDITION_REFILL = 8.0, 8 * 30
RESUPPLY = ("Resupply", "Make a successful first touchdown", 8)
CONTRACT_WINDOW = 5.0  # seconds after launch to accept a contract
CONTRACTS = {
    "courier": ("Low-risk delivery", "Land on the wide ×1 pad", 120),
    "precision": ("Precision survey", "Land within the middle half of a pad's safe zone", 55),
    "reserve": ("Fuel economy", "Land with at least 8 s of fuel before the touchdown refill", 65),
    "salvage": ("Crystal recovery", "Collect a crystal and land on the same flight", 75),
    "sprint": ("Express delivery", "Make your first landing within 16 s", 65),
    "transfer": ("Outpost transfer", "Land, then complete a hop to a different pad", 100),
}
HOP_TICKS = 35 * 30    # a hop may fly this long from its lift-off (past the round's usual end)
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


def make_supply(rng, h, pads, start):
    """This round's outpost needs (one per pad, [kind, name]) and the pickups in the sky ([x, y, kind]: 0 crystal, 1 fuel)."""
    kinds = list(NEEDS)
    rng.shuffle(kinds)
    needs = [[k, nm] for k, nm in zip(kinds, rng.sample(OUTPOSTS, len(pads)))]
    picks = []
    for kind in [0] * (N_PICKS - 1) + [1]:
        for _ in range(200):
            x = rng.uniform(10, W - 10)
            y = ground(h, x) + rng.uniform(12, 55)
            if y > CEILING - 8:
                continue
            if any(abs(x - (l + r) / 2) < (r - l) / 2 + 4 for l, r, _, _ in pads):
                continue
            if math.hypot(x - start[0], y - START_Y) < 12 or any(math.hypot(x - q[0], y - q[1]) < 10 for q in picks):
                continue
            picks.append([round(x, 2), round(y, 2), kind])
            break
    return needs, picks


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


def crash_reason(pad, vx, vy):
    if pad < 0:
        return "off the pads"
    if -vy > VY_OK:
        return "too fast"
    if abs(vx) > VX_OK:
        return "sliding sideways"
    return "tilted over"


def fly(h, pads, start, fuel, log, path_every=0, picks=(), taken=(), hop=None, record=False):
    """Replay an input log: [[tick, bits], …] where bits = thrust + 2 × (rot + 1) applies from that tick on.
    Returns a result dict; with path_every, also every n-th tick's [x, y, k, thrust] (for ghosts).
    picks: the pickups in the sky (those in `taken` are already gone); "got" lists the ones this flight touched.
    hop=(x, y, tick): a hop from a pad, standing upright at rest from that tick; it only counts as down again once it
    has been airborne (more than 1 m up). With record, sample [elapsed tick, vx, vy, lean step, fuel] for review."""
    if hop:
        x, y, t0 = hop
        vx = vy = 0.0
        air = False
    else:
        x, vx = start
        y, t0, air = START_Y, 0, True
        vy = 0.0
    k = 0
    thrust, rot = 0, 0
    li = 0
    path = []
    got = []
    gone = set(taken)
    end = t0 + HOP_TICKS if hop else MAX_TICKS
    telemetry = []

    def report(result):
        if record:
            final = [result["ticks"] - t0, result["vx"], result["vy"], result["k"], result["fuel"]]
            if telemetry[-1][0] == final[0]:
                telemetry[-1] = final
            else:
                telemetry.append(final)
            result["telemetry"] = telemetry
        return result

    if record:
        telemetry.append([0, round(vx, 2), round(vy, 2), k, fuel])
    for t in range(t0, end):
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
        for i, (px, py, kind) in enumerate(picks):
            if i not in gone:
                dx, dy = x - px, y + 1.0 - py
                if dx * dx + dy * dy < PICK_R2:
                    gone.add(i)
                    got.append(i)
                    if kind == 1:
                        fuel += PICK_FUEL
        if path_every and (t - t0) % path_every == 0:
            path.append([round(x, 2), round(y, 2), k, 1 if on else 0])
        if record and (t + 1 - t0) % 15 == 0:
            telemetry.append([t + 1 - t0, round(vx, 2), round(vy, 2), k, fuel])
        gy = ground(h, x)
        if not air:
            if y > gy + 1.0:
                air = True
            elif y <= gy:
                y, vy, vx = gy, 0.0, 0.0
                continue
        if y <= gy:
            how, pad, pts, soft, prec = judge(pads, x, vx, vy, k)
            if path_every:
                path.append([round(x, 2), round(gy, 2), k, 0])
            return report({"how": how, "pad": pad, "pts": pts, "ticks": t + 1, "x": round(x, 2), "vx": round(vx, 2),
                    "vy": round(vy, 2), "k": k, "fuel": fuel, "soft": round(soft, 2), "prec": round(prec, 2), "path": path,
                    "got": got, "reason": crash_reason(pad, vx, vy) if how == "crash" else None})
    return report({"how": "lost", "pad": -1, "pts": 0, "ticks": end, "x": round(x, 2), "vx": round(vx, 2), "vy": round(vy, 2),
                   "k": k, "fuel": fuel, "soft": 0, "prec": 0, "path": path, "got": got})


def autopilot(h, pads, start, fuel, level, rng, hop=None, target=None):
    """A bot's flight: a PD controller toward a chosen pad, deciding every few ticks, with shaky gains.
    Returns the input log it would have pressed (so the server judges it exactly like a human's).
    hop=(x, y, tick) and target=pad index: a hop from a pad (as fly() takes it)."""
    every, want, touch, noise, vcap = BOT.get(level, BOT["normal"])
    # pick a pad: the bot's favourite multiplier, or a lower one if the tank is low
    cands = sorted(range(len(pads)), key=lambda n: -pads[n][3])
    pref = [n for n in cands if pads[n][3] <= want]
    if fuel < 10 * 30:
        pref = [n for n in cands if pads[n][3] == 1] or pref
    n = target if target is not None else pref[0] if pref else cands[-1]
    l, r, top, _ = pads[n]
    px = (l + r) / 2 + rng.uniform(-1, 1) * ((r - l) / 2 - FOOT) * (0.6 if level == "easy" else 0.25)
    gx, gk, gv = (1 + rng.gauss(0, noise) for _ in range(3))
    if hop:
        x, y, t0 = hop
        vx = vy = 0.0
        air = False
    else:
        x, vx = start
        y, t0, air = START_Y, 0, True
        vy = 0.0
    k = 0
    log, bits_now = [], None
    thrust = rot = 0
    climb, clr = (2.5, 6) if hop else (1.0, 12)   # a hop skims low and quick
    for t in range(t0, t0 + HOP_TICKS if hop else MAX_TICKS):
        if (t - t0) % every == 0:
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
            if not over and clear < clr:
                want_vy = climb               # climb over the ridge first
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
        gy = ground(h, x)
        if not air:
            if y > gy + 1.0:
                air = True
            elif y <= gy:
                y, vy, vx = gy, 0.0, 0.0
                continue
        if y <= gy:
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
        "Each pad is an outpost that needs you: ⛽ a refinery refills 8 s of fuel, 🚑 a medical rush pays +40 to the first one down, 🔬 a lab pays +30 for landing dead centre.",
        "💎 Crystals in the sky are +15 each if that flight lands; a ⛽ canister adds 3 s of fuel the moment you touch it.",
        "🔥 Land round after round and each landing in a row adds +5 (up to +15). A crash or a round without a landing resets it.",
        "Landed with fuel to spare? Burn again within 4 s to hop to a different pad for ×1.5 more. A crash on the hop keeps your first landing.",
        "Fuel carries over: the tank only gets a top-up each round, so don't waste it hovering.",
        "In Expedition, choose a mission before launch. Resupply on your first touchdown or earn mission points. Between moons you get 8 seconds of fuel.",
        "In Contract Flight, pick one optional contract before launch or in the first 5 seconds. Complete it for bonus points. Review your last flight's telemetry to refine your approach.",
        "Most points after the last round wins.",
    ]
    name = "Moon Lander"
    icon = "🚀"
    blurb = "Fly supply runs and bonus contracts, bank crystals on touchdown, and hop between outposts. Fuel carries over."
    min_players = 1
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "feather": ("🪶", "Feather", "Touch down at under 0.5 m/s"),
              "bullseye": ("🎯", "Bullseye", "Land dead centre on a ×3 pad"),
              "hopper": ("🔁", "Hopper", "Hop from one pad and land on the ×3"),
              "contractor": ("📋", "Contractor", "Complete three different contracts in one match")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5"), (3, "3"), (7, "7")], 5),
        "flight_rules": ("Flight rules", [("contracts", "Contract Flight"), ("expedition", "Expedition"), ("classic", "Classic")], "contracts"),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.rounds = int(self.s.get("rounds", 5))
        self.flight_rules = self.s.get("flight_rules", "contracts")
        self.round_no = 0
        self.ghost_at = 0.0
        for p in seated:
            p.g.points, p.g.fuel, p.g.best = 0, TANK0, 0
            p.g.lands, p.g.streak = 0, 0
            p.g.completed_contracts = []
            p.g.replay = None
            if self.expedition:
                p.g.missions = []
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

    @property
    def expedition(self):
        return getattr(self, "flight_rules", None) == "expedition"

    def new_round(self, now):
        r = self.room
        self.mark_round()
        self.round_no += 1
        self.h, self.pads, self.start_xv = make_moon(self.rng)
        self.needs, self.picks = make_supply(self.rng, self.h, self.pads, self.start_xv)
        self.contracts = self.round_contracts()
        self.rushed = set()               # rush outposts already reached this round
        self.stage = "briefing" if self.expedition else "count"
        self.t0 = now + COUNT + (BRIEFING if self.expedition else 0)
        r.deadline = self.t0 - COUNT if self.expedition else self.t0
        for p in self.players():
            g = p.g
            if self.round_no > 1:
                g.fuel = min(TANK_MAX, g.fuel + (EXPEDITION_REFILL if self.expedition else REFILL))
            g.tank = g.fuel                 # what this round's flight starts with
            g.res = None                    # this round's result
            g.ghost = None                  # [x, y, k, thrust] as last posted
            g.plan = None                   # a bot's planned flight: (result, started at, first tick)
            g.hop = None                    # after a landing: {"open", "close"} ticks → "up" → the hop's result
            g.land1 = None                  # the first landing's result (for the hop)
            bot_choices = ("courier", "reserve", "precision", "sprint") if p.bot == "easy" else ("precision", "reserve", "sprint", "courier")
            g.contract = next((key for key in bot_choices if key in self.contracts), None) if p.bot else None
            if self.expedition and p.bot and self.round_no < self.rounds and (g.tank < 20 * 30 or not g.contract):
                g.contract = "resupply"
            g.contract_paid = False
        r.add_log(f"🌕 Round {self.round_no} of {self.rounds}: pads ×1, ×2 and ×3. Get ready…", "info")

    def round_contracts(self):
        if getattr(self, "flight_rules", "classic") == "classic":
            return []
        if (self.round_no - 1) % 3 == 0 or not hasattr(self, "contract_deck"):
            deck_rng = random.Random()
            deck_rng.setstate(self.rng.getstate())
            self.contract_deck = deck_rng.sample(list(CONTRACTS), len(CONTRACTS))
        offset = 2 * ((self.round_no - 1) % 3)
        return self.contract_deck[offset:offset + 2]

    def mission_offers(self):
        offers = list(getattr(self, "contracts", []))
        if self.expedition and self.round_no < self.rounds:
            offers.append("resupply")
        return offers

    def contract_open(self, g, now):
        if g is None or getattr(g, "contract", None) or g.res is not None:
            return False
        if self.expedition:
            return self.stage == "briefing" and now < self.t0 - COUNT
        return self.stage in ("count", "fly") and now < self.t0 + CONTRACT_WINDOW

    # -- flying

    @staticmethod
    def _log(log, lo=0, hi=MAX_TICKS):
        if not isinstance(log, list) or len(log) > 3000:
            raise GameError("Bad flight log.")
        last = lo - 1
        for e in log:
            if (not isinstance(e, list) or len(e) != 2 or not all(isinstance(v, int) and not isinstance(v, bool) for v in e)
                    or e[0] <= last or not lo <= e[0] < hi or not 0 <= e[1] <= 5):
                raise GameError("Bad flight log.")
            last = e[0]
        return log

    def act(self, p, a):
        kind = a.get("type")
        if kind not in ("land", "lift", "hop", "contract"):
            raise GameError("Unknown action.")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're watching this one.")
        g, now = p.g, time.time()
        if kind == "contract":
            key = a.get("key")
            round_no = a.get("round")
            if type(round_no) is not int or round_no != self.round_no or key not in self.mission_offers():
                raise GameError("That contract is unavailable.")
            if not self.contract_open(g, now):
                raise GameError("Contract selection is closed.")
            g.contract = key
            return
        if self.stage not in ("fly", "settle"):
            raise GameError("Not flying right now.")
        if kind == "lift":
            hop, t = g.hop, a.get("t")
            if not isinstance(hop, dict):
                raise GameError("No hop to make.")
            if not isinstance(t, int) or isinstance(t, bool) or not hop["open"] <= t <= hop["close"]:
                raise GameError("Too late to hop.")
            if t * DT > now - self.t0 + 3.0 or now - self.t0 > hop["close"] * DT + 3.0:
                raise GameError("Too late to hop.")
            g.hop = "up"
            g.lift = t
            self.room.deadline = max(self.room.deadline or 0, self.t0 + (t + HOP_TICKS) * DT + 1.5)
            return
        if kind == "hop":
            if g.hop != "up":
                raise GameError("You're not hopping.")
            log = self._log(a.get("log"), g.lift, g.lift + HOP_TICKS)
            res = self.fly_hop(p, log, record=True)
            if res["ticks"] * DT > now - self.t0 + 3.0:
                raise GameError("That flight was too quick.")
            return self.hop_done(p, res, now)
        if self.stage != "fly":
            raise GameError("Not flying right now.")
        if g.res is not None:
            raise GameError("You've already come down this round.")
        log = self._log(a.get("log"))
        res = fly(self.h, self.pads, self.start_xv, g.tank, log, picks=self.picks, record=True)
        # the flight must have taken (about) as long as it says
        if res["ticks"] * DT > now - self.t0 + 3.0:
            raise GameError("That flight was too quick.")
        self.done(p, res, now)

    def fly_hop(self, p, log, path_every=0, record=False):
        g = p.g
        r1 = g.land1
        top = self.pads[r1["pad"]][2]
        return fly(self.h, self.pads, None, g.fuel, log, path_every=path_every, picks=self.picks, taken=r1.get("got", []),
                   hop=(r1["x"], top, g.lift), record=record)

    def on_input(self, p, a):
        """A human's lander position while flying (for everyone else's ghost view)."""
        if p.id not in self.seats or p.eliminated or self.stage not in ("fly", "settle") or (p.g.res is not None and p.g.hop != "up"):
            return
        g = a.get("at")
        if not (isinstance(g, list) and len(g) == 4 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in g)):
            raise GameError("Bad position.")
        p.g.ghost = [round(max(0.0, min(W, g[0])), 2), round(max(-5.0, min(CEILING + 5, g[1])), 2), int(max(-K_MAX, min(K_MAX, g[2]))), 1 if g[3] else 0]

    def deliver(self, p, res):
        """A landing's extras: crystals from that flight and the outpost's need. Returns (points, words)."""
        g = p.g
        kind, name = self.needs[res["pad"]]
        pts, words = 0, []
        gems = sum(1 for i in res.get("got", []) if self.picks[i][2] == 0)
        if gems:
            pts += GEM * gems
            words.append(f"💎×{gems} +{GEM * gems}")
        if kind == "fuel":
            g.fuel = min(TANK_MAX, g.fuel + NEED_FUEL)
            words.append(f"⛽ {name} refuels you")
        elif kind == "rush":
            if res["pad"] not in self.rushed:
                self.rushed.add(res["pad"])
                pts += RUSH
                words.append(f"🚑 first to {name} +{RUSH}")
        elif kind == "lab" and res["prec"] >= LAB_PREC:
            pts += LAB
            words.append(f"🔬 {name} bullseye +{LAB}")
        key = getattr(g, "contract", None)
        hop = g.hop == "up"
        if key == "resupply" and not g.contract_paid and not hop:
            g.fuel = min(TANK_MAX, g.fuel + RESUPPLY[2] * 30)
            g.contract_paid = True
            words.append("⛽ Expedition resupply")
        elif key in CONTRACTS and not g.contract_paid and self.contract_met(key, res, hop, gems):
            title, _, reward = CONTRACTS[key]
            pts += reward
            words.append(f"📋 {title} +{reward}")
            g.contract_paid = True
            if key not in g.completed_contracts:
                g.completed_contracts.append(key)
                if len(g.completed_contracts) == 3:
                    self.award(p, "contractor")
        res["bonus"] = pts
        res["words"] = words
        return pts

    def contract_met(self, key, res, hop, gems):
        if key == "courier":
            return self.pads[res["pad"]][3] == 1
        if key == "precision":
            return res["prec"] >= 0.5
        if key == "reserve":
            return res["fuel"] >= 8 * 30
        if key == "salvage":
            return gems > 0
        if key == "sprint":
            return not hop and res["ticks"] <= 16 * 30
        return key == "transfer" and hop

    def save_replay(self, p, res, leg):
        samples = res.pop("telemetry", None)
        if not samples:
            return
        g = p.g
        replay = getattr(g, "replay", None)
        if not replay or replay["round"] != self.round_no or leg == "descent":
            g.replay = replay = {"round": self.round_no, "legs": {}}
        pad = res["pad"]
        replay["legs"][leg] = {"how": res["how"], "reason": res.get("reason"), "samples": samples,
                               "mult": self.pads[pad][3] if pad >= 0 else None}

    def done(self, p, res, now):
        g = p.g
        res = {k: v for k, v in res.items() if k != "path"}
        self.save_replay(p, res, "descent")
        g.res = res
        g.fuel = res["fuel"]
        g.ghost = None
        r = self.room
        if res["how"] == "land":
            res["pts"] += self.deliver(p, res)
            g.streak = getattr(g, "streak", 0) + 1   # 🔥 landings in a row, round to round
            bonus = min(STREAK_MAX, STREAK_PTS * (g.streak - 1))
            if bonus:
                res["pts"] += bonus
                res["words"] = list(res.get("words") or []) + [f"🔥 streak +{bonus}"]
        else:
            g.streak = 0
        g.points += res["pts"]
        g.best = max(g.best, res["pts"])
        if res["how"] == "land":
            g.lands += 1
            g.land1 = res
            if g.fuel >= HOP_MIN and len(self.pads) > 1:
                g.hop = {"open": res["ticks"] + HOP_OPEN, "close": res["ticks"] + HOP_CLOSE}
            mult = self.pads[res["pad"]][3]
            extra = f" ({', '.join(res['words'])})" if res["words"] else ""
            r.add_log(f"🛬 {p.name} lands on the ×{mult} pad at {-res['vy']:.1f} m/s: +{res['pts']}{extra}.", "info")
            if -res["vy"] < 0.5:
                self.award(p, "feather")
            if mult == 3 and res["prec"] >= 0.9:
                self.award(p, "bullseye")
            if mult == 3:
                self.moment(f"🎯 {p.name} sticks the ×3 landing! +{res['pts']}", "gold", "good")
            elif g.streak in (3, 5):
                self.moment(f"🔥 {p.name}: {g.streak} landings in a row!", "gold", "good")
        elif res["how"] == "crash":
            why = res.get("reason") or crash_reason(res["pad"], res["vx"], res["vy"])
            r.add_log(f"💥 {p.name} crashes ({why}).", "info")
        else:
            r.add_log(f"🛰️ {p.name} drifts off into space.", "info")
        self.check_settle(now)

    def hop_done(self, p, res, now):
        g, r = p.g, self.room
        res = {k: v for k, v in res.items() if k != "path"}
        self.save_replay(p, res, "hop")
        g.fuel = res["fuel"]
        g.ghost = None
        first = g.land1["pad"]
        if res["how"] == "land" and res["pad"] != first:
            res["pts"] = int(round(HOP_MULT * res["pts"]))
            res["pts"] += self.deliver(p, res)
            g.points += res["pts"]
            g.res["pts"] += res["pts"]
            g.best = max(g.best, g.res["pts"])
            mult = self.pads[res["pad"]][3]
            extra = f" ({', '.join(res['words'])})" if res["words"] else ""
            r.add_log(f"🔁 {p.name} hops to the ×{mult} pad: +{res['pts']}{extra}.", "info")
            if mult == 3:
                self.award(p, "hopper")
                self.moment(f"🔁 {p.name} hops onto the ×3 pad! +{res['pts']}", "gold", "good")
        else:
            res["pts"] = 0
            r.add_log(f"🔁 {p.name}'s hop " + ("crashes (the first landing still counts)." if res["how"] == "crash"
                      else "ends on the same pad: no bonus." if res["how"] == "land" else "comes to nothing."), "info")
        g.hop = res
        self.check_settle(now)

    def busy(self, o, now):
        """Still flying, or may yet hop."""
        h = o.g.hop
        return o.g.res is None or h == "up" or (isinstance(h, dict) and "open" in h and now < self.t0 + h["close"] * DT + 1.0)

    def check_settle(self, now):
        if self.stage == "fly" and not any(self.busy(o, now) for o in self.present()):
            self.stage = "settle"
            self.room.deadline = now + SETTLE

    def bot_descent(self, p, path_every=0):
        g = p.g
        target = 0 if getattr(g, "contract", None) == "courier" else None  # pads are ordered by multiplier
        log = autopilot(self.h, self.pads, self.start_xv, g.tank, p.bot, random, target=target)
        return fly(self.h, self.pads, self.start_xv, g.tank, log, path_every=path_every, picks=self.picks)

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
            if not p.bot:
                if isinstance(g.hop, dict) and "open" in g.hop and not self.busy(p, now):
                    g.hop = None                      # the hop window closed
                    self.check_settle(now)
                    changed = True
                continue
            if g.res is None:
                if g.plan is None:
                    res = self.bot_descent(p, path_every=3)
                    g.plan = (res, max(0.0, t), 0)    # a stand-in who took over late starts from now
            elif isinstance(g.hop, dict) and "open" in g.hop:
                if not self.bot_hop(p, t):
                    g.hop = None
                    self.check_settle(now)
                    changed = True
                continue
            elif g.hop != "up":
                continue
            res, since, t0 = g.plan
            k = int((t - since) / DT)
            if k >= res["ticks"]:
                (self.hop_done if g.hop == "up" else self.done)(p, res, now)
                changed = True
            else:
                path = res["path"]
                g.ghost = path[max(0, min(len(path) - 1, (k - t0) // 3))]
        if now - self.ghost_at >= 1 / GHOST_HZ:
            self.ghost_at = now
            self.room.push_fast({"gh": {str(self.seats.index(p.id)): p.g.ghost for p in self.present() if p.g.ghost and p.id in self.seats},
                                 "rd": self.round_no})
        return changed

    def bot_hop(self, p, t):
        """A bot that has landed: normal and hard bots hop to a better pad when the tank allows. Plans it and lifts."""
        g = p.g
        first = g.land1["pad"]
        if p.bot not in ("normal", "hard") or g.fuel < 10 * 30 or (p.bot == "normal" and random.random() < 0.5):
            return False
        here = self.pads[first][3]
        better = [n for n in range(len(self.pads)) if n != first and (self.pads[n][3] > here or self.needs[n][0] == "rush" and n not in self.rushed)]
        if not better:
            return False
        x0 = g.land1["x"]
        better = [n for n in better if abs((self.pads[n][0] + self.pads[n][1]) / 2 - x0) < 70]
        if not better:
            return False
        n = max(better, key=lambda n: self.pads[n][3])
        _, since, _ = g.plan
        g.lift = g.hop["open"] + random.randint(4, 30)
        # a bot only sets off on a hop it can see itself making (in good time): a couple of tries at a plan
        for _ in range(3):
            log = autopilot(self.h, self.pads, None, g.fuel, p.bot, random, hop=(x0, self.pads[first][2], g.lift), target=n)
            res = self.fly_hop(p, log, path_every=3)
            if res["how"] == "land" and res["pad"] == n and res["ticks"] - g.lift < 26 * 30:
                break
        else:
            return False
        g.hop = "up"
        g.plan = (res, since, g.lift)
        self.room.deadline = max(self.room.deadline or 0, self.t0 + (g.lift + HOP_TICKS) * DT + 1.5)
        return True

    def end_round(self, now):
        r = self.room
        here = self.present()
        self.stage = "between"
        r.deadline = now + BETWEEN
        for o in here:
            if isinstance(o.g.hop, dict) and "open" in o.g.hop:
                o.g.hop = None
            if o.g.res is None:
                o.g.streak = 0
                o.g.res = {"how": "lost", "pad": -1, "pts": 0, "ticks": MAX_TICKS, "x": 0, "vx": 0, "vy": 0, "k": 0,
                           "fuel": o.g.fuel, "soft": 0, "prec": 0}
                r.add_log(f"⏰ {o.name} never touched down.", "info")
        if self.expedition:
            for o in self.players():
                g = o.g
                if g.res is not None and (not g.missions or g.missions[-1]["round"] < self.round_no):
                    g.missions.append({"round": self.round_no, "key": g.contract, "complete": g.contract_paid,
                                       "points": g.res["pts"], "fuel": g.fuel,
                                       "nextTank": min(TANK_MAX, g.fuel + EXPEDITION_REFILL)
                                       if self.round_no < self.rounds else None})
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
        if self.stage == "briefing":
            if self.round_no < self.rounds:
                for p in self.present():
                    if not p.g.contract:
                        p.g.contract = "resupply"
            self.stage = "count"
            self.t0 = now + COUNT
            r.deadline = self.t0
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
                        p.g.plan = (self.bot_descent(p), 0.0, 0)
                    self.done(p, p.g.plan[0], now)
                if p.bot and isinstance(p.g.hop, dict) and "open" in p.g.hop:
                    self.bot_hop(p, now - self.t0)
                if p.g.hop == "up":
                    if p.bot:
                        self.hop_done(p, p.g.plan[0], now)
                    else:
                        self.hop_done(p, {"how": "lost", "pad": -1, "pts": 0, "fuel": p.g.fuel, "got": []}, now)
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
        self.check_settle(time.time())

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
                           "res": getattr(g, "res", None), "hop": getattr(g, "hop", None), "out": not o or o.eliminated})
        me = self.seat(p)
        pilot = p.g if me is not None else None
        contract = getattr(pilot, "contract", None)
        offers = self.mission_offers()
        return {"lander": {
            "seats": self.seats, "me": me, "round": self.round_no, "rounds": self.rounds, "stage": self.stage,
            "startIn": max(0.0, round(self.t0 - now, 2)) if self.stage == "count" else 0,
            "flown": max(0.0, round(now - self.t0, 2)) if self.stage in ("fly", "settle") else 0,
            "h": self.h, "pads": self.pads, "start": list(self.start_xv), "fliers": fliers,
            "needs": self.needs, "picks": self.picks, "rushed": sorted(self.rushed),
            "contracts": [[key, *CONTRACTS[key]] for key in getattr(self, "contracts", [])],
            "contract": contract, "contractWindow": CONTRACT_WINDOW, "contractPaid": getattr(pilot, "contract_paid", False),
            "contractOpen": bool(offers and p is not None and not p.eliminated
                                 and self.contract_open(pilot, now)),
            "expedition": {
                "briefingLeft": max(0.0, self.t0 - COUNT - (r.paused or now)) if self.stage == "briefing" else 0,
                "offers": [[key, *(RESUPPLY if key == "resupply" else CONTRACTS[key])]
                           for key in offers],
                "resupplyFuel": RESUPPLY[2] * 30,
                "history": getattr(pilot, "missions", []),
                "titles": {key: title for key, (title, _, _) in dict(CONTRACTS, resupply=RESUPPLY).items()},
            } if self.expedition else None,
            "replay": getattr(pilot, "replay", None),
            "standings": self.standings() if self.stage == "between" and len(self.seats) > 1 else None,
            "geo": {"dt": DT, "g": G, "thrust": THRUST, "rot": ROT_STEP, "kMax": K_MAX, "w": W, "seg": SEG, "startY": START_Y,
                    "ceiling": CEILING, "vyOk": VY_OK, "vxOk": VX_OK, "angOk": ANG_OK, "foot": FOOT, "maxTicks": MAX_TICKS,
                    "sin": SIN, "cos": COS, "tankMax": TANK_MAX, "pickR2": PICK_R2, "pickFuel": PICK_FUEL, "gem": GEM,
                    "hopOpen": HOP_OPEN, "hopClose": HOP_CLOSE, "hopTicks": HOP_TICKS, "hopMin": HOP_MIN, "hopMult": HOP_MULT, "needFuel": NEED_FUEL,
                    "rush": RUSH, "lab": LAB, "labPrec": LAB_PREC},
        }}
