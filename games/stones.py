"""Ice Stones: an original curling-style game for 2–6 players, each playing for themselves.

Players take turns sliding granite stones down a sheet of ice towards the house, a target of rings. Each
throw sets an aim (the skip's broom across the house), a weight (how hard) and a curl (which way the stone
bends as it slows); then, while it slides, the thrower sweeps (hold or scrub the 🧹 pad) to carry it further
and straighter. When every stone of the end has been thrown, whoever has the stone nearest the button scores
one point for each of their stones closer than anyone else's best (real curling's count). 🔥 One stone in
each end is a hot stone, and it scores double.

Physics runs on the server in 2D (x across the sheet, y down it, metres-ish) at 120 steps a second. A human's
throw slides live on the server's clock (frame()), so their sweeping counts as it happens (#187); the moving
stones' tracks stream to every browser (push_fast) to play back at 30 frames a second, a moment behind.
Bots sweep at a level they pick before the throw, so their live slide is exactly the one they planned.
"""
import math
import random
import time

from .base import Game, GameError

HALF = 2.2            # the sheet: x from -HALF to HALF
START = 1.0           # where a stone is released
HOG = 21.0            # a thrown stone that stops short of this line (without touching another) is taken off
TEE = 28.0            # the button: the centre of the house
HOUSE = 1.83          # the house's outer ring
BACK = TEE + HOUSE    # a stone that slides past the back line is out
END_Y = BACK + 1.2    # the end of the sheet (drawn); stones are off long before this
R = 0.145             # a stone's radius
# #187 the glide, retuned to feel like curling: a stone slows evenly (constant friction, so a draw takes about
# 8½ s), its path turns more and more as it slows (heading rate 2·CURL·V_CURL/(v² + V_CURL²): gentle at speed,
# strongest near the end but never a spiral, since it stays finite as the stone stops) and the speed is never
# touched by the curl. Sweeping lowers the friction and straightens the curl while it's on.
FRICTION = 0.75       # m/s² deceleration on bare ice
CURL = 0.13           # how hard a stone turns: the heading turns at up to 2·CURL/V_CURL rad/s as it stops
V_CURL = 0.8          # the speed (m/s) below which the turn stops growing (a draw curls about a metre)
SWEEP = [(1.0, 1.0), (0.93, 0.8), (0.86, 0.6)]   # (friction, curl) multipliers for no / light / hard sweeping
SWEEP_FROM = 7.5      # sweepers pick the stone up past this point (and stop at the back line)
# #186/#187 weight: 0 … W_DRAW slides a stone (straight, keen ice, unswept) to a stop from STOP_LO to STOP_HI,
# evenly, so a fifth of the slider is draw weight (the house); above W_DRAW the speed climbs to VMAX for hits.
W_DRAW = 0.7
STOP_LO, STOP_HI = 19.0, 32.0
VMAX = 8.8
REST = 0.86           # stone-on-stone restitution
DT = 1 / 120
FRAME = 4             # record every 4th step: 30 frames a second
MAX_T = 20.0
END_PAUSE = 5.5       # seconds to read an end's result after its last stone has stopped
LAG = 0.45            # how far behind the server's live stone the browsers play (s), plus a breath before the next turn


def per_player(n):
    return {2: 4, 3: 3}.get(n, 2)


def speed_of(weight):
    """Release speed for a weight 0..1 (see W_DRAW)."""
    if weight <= W_DRAW:
        stop = STOP_LO + (STOP_HI - STOP_LO) * weight / W_DRAW
        return math.sqrt(2 * FRICTION * (stop - START))
    v = math.sqrt(2 * FRICTION * (STOP_HI - START))
    return v + (VMAX - v) * (weight - W_DRAW) / (1 - W_DRAW)


def weight_for(stop, fk=1.0):
    """The weight that slides a straight unswept stone to a stop at y = stop on ice with friction ×fk."""
    v = math.sqrt(2 * FRICTION * fk * max(0.0, stop - START))
    lo, hi = speed_of(0.0), speed_of(W_DRAW)
    if v <= hi:
        stop0 = START + v * v / (2 * FRICTION)
        return max(0.0, min(W_DRAW, (stop0 - STOP_LO) / (STOP_HI - STOP_LO) * W_DRAW)) if v >= lo else 0.0
    return min(1.0, W_DRAW + (v - hi) / (VMAX - hi) * (1 - W_DRAW))


def launch(aim, weight):
    """Velocity of a stone released at (0, START) towards the broom at (aim, TEE), with weight 0..1."""
    v = speed_of(weight)
    dx, dy = aim, TEE - START
    d = math.hypot(dx, dy)
    return v * dx / d, v * dy / d


class Slide:
    """One throw on the ice, a step (1/120 s) at a time, so it can run all at once (bots, tests) or live on the
    server's clock while the thrower sweeps (#187). Plain lists and dicts, so a room saved mid-slide pickles."""

    def __init__(self, stones, thrown, aim, weight, curl, fk=1.0, ck=1.0, record=True):
        self.st = [dict(s) for s in stones] + [dict(thrown, x=0.0, y=START)]
        n = len(self.st)
        self.n = n
        self.vx, self.vy = [0.0] * n, [0.0] * n
        self.spin = [0.0] * n
        self.vx[-1], self.vy[-1] = launch(aim, weight)
        self.spin[-1] = curl
        self.live = [True] * n          # still on the sheet
        self.moving = [n - 1]
        self.fk, self.ck, self.record = fk, ck, record
        self.tracks = {n - 1: {"s": 0, "f": [[0.0, START]]}} if record else {}
        self.hit = False
        self.steps, self.t = 0, 0.0
        self.swept = 0                  # steps the thrown stone was swept, for the log

    @property
    def head(self):
        return self.steps // FRAME

    def running(self):
        return bool(self.moving) and self.t < MAX_T

    def speed(self, i=-1):
        return math.hypot(self.vx[i], self.vy[i])

    def step(self, sweep=0):
        """Advance one step with the thrown stone swept at `sweep` (0/1/2). False once nothing moves."""
        if not self.running():
            return False
        st, vx, vy, spin, n = self.st, self.vx, self.vy, self.spin, self.n
        self.steps += 1
        self.t += DT
        moving = set(self.moving)
        for i in sorted(moving):
            sp = math.hypot(vx[i], vy[i])
            if sp < 1e-3:
                vx[i] = vy[i] = 0.0
                moving.discard(i)
                continue
            swept = sweep and i == n - 1 and SWEEP_FROM < st[i]["y"] < BACK
            fm, cm = SWEEP[sweep] if swept else (1.0, 1.0)
            if swept:
                self.swept += 1
            ns = max(0.0, sp - FRICTION * self.fk * fm * DT)
            ux, uy = vx[i] / sp, vy[i] / sp
            if spin[i] and ns > 0:
                # the heading turns (spin +1 bends towards +x), faster as the stone slows; the speed is untouched
                a = spin[i] * CURL * self.ck * cm * 2 * V_CURL / (ns * ns + V_CURL * V_CURL) * DT
                c, s = math.cos(a), math.sin(a)
                ux, uy = ux * c + uy * s, uy * c - ux * s
            vx[i], vy[i] = ux * ns, uy * ns
            st[i]["x"] += vx[i] * DT
            st[i]["y"] += vy[i] * DT
            if ns == 0:
                moving.discard(i)
        # collisions: any moving stone against any stone in play (equal masses: momentum is shared along the
        # line of centres, a little lost to the granite)
        for i in sorted(moving):
            if not self.live[i]:
                continue
            for j in range(n):
                if j == i or not self.live[j]:
                    continue
                dx = st[j]["x"] - st[i]["x"]
                dy = st[j]["y"] - st[i]["y"]
                d2 = dx * dx + dy * dy
                if d2 >= (2 * R) ** 2 or d2 == 0:
                    continue
                d = math.sqrt(d2)
                nx, ny = dx / d, dy / d
                rel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny
                overlap = 2 * R - d
                st[i]["x"] -= nx * overlap / 2
                st[i]["y"] -= ny * overlap / 2
                st[j]["x"] += nx * overlap / 2
                st[j]["y"] += ny * overlap / 2
                if rel <= 0:
                    continue
                k = rel * (1 + REST) / 2
                vx[i] -= k * nx
                vy[i] -= k * ny
                vx[j] += k * nx
                vy[j] += k * ny
                spin[i] *= 0.3
                spin[j] = 0.0
                if i == n - 1 or j == n - 1:
                    self.hit = True
                if j not in moving:
                    moving.add(j)
                    if self.record and j not in self.tracks:
                        self.tracks[j] = {"s": self.steps // FRAME, "f": [[round(st[j]["x"], 3), round(st[j]["y"], 3)]]}
        # off the sheet: over the side boards or past the back line
        for i in sorted(moving):
            s = st[i]
            if abs(s["x"]) > HALF - R or s["y"] > BACK + R:
                self.live[i] = False
                moving.discard(i)
                if self.record:
                    self.tracks[i]["f"].append([round(s["x"], 3), round(s["y"], 3)])
                    self.tracks[i]["out"] = True
        if self.record and self.steps % FRAME == 0:
            for i in moving:
                tr = self.tracks.get(i)
                if tr is not None:
                    tr["f"].append([round(st[i]["x"], 3), round(st[i]["y"], 3)])
        self.moving = sorted(moving)
        return self.running()

    def finish(self):
        """(stones still in play, tracks, hit) once it has stopped; see simulate()."""
        st, n = self.st, self.n
        if self.record:  # every track ends where its stone came to rest
            for i, tr in self.tracks.items():
                last = [round(st[i]["x"], 3), round(st[i]["y"], 3)]
                if self.live[i] and tr["f"][-1] != last:
                    tr["f"].append(last)
        me = st[-1]
        if self.live[-1] and me["y"] < HOG and not self.hit:
            self.live[-1] = False
            if self.record:
                self.tracks[n - 1]["short"] = True
        keep = [s for i, s in enumerate(st) if self.live[i]]
        return keep, self.tracks, self.hit


def simulate(stones, thrown, aim, weight, curl, sweep, record=True, fk=1.0, ck=1.0):
    """Slide `thrown` (a new stone dict) into `stones` (a list of stone dicts, each {x, y, ...}), swept at
    `sweep` the whole way. Returns (stones still in play, tracks, hit), where tracks maps a stone's index in the
    input list (len(stones) for the thrown one) to {"s": first frame, "f": [[x, y], ...]} and hit says whether
    the thrown stone touched another."""
    sl = Slide(stones, thrown, aim, weight, curl, fk, ck, record)
    while sl.step(sweep):
        pass
    return sl.finish()


def dist(s):
    return math.hypot(s["x"], s["y"] - TEE)


def in_house(s):
    return dist(s) <= HOUSE + R      # a stone touching the outer ring is in


def count_end(stones):
    """(scoring seat, points, the scoring stones) for stones in play, or (None, 0, []) with none in the house.
    Real curling's count: the player with the stone nearest the button scores one for each of their stones in
    the house closer than every other player's best (a hot stone counts two). A dead heat for shot stone is
    a blank end."""
    house = sorted((s for s in stones if in_house(s)), key=dist)
    if not house:
        return None, 0, []
    side = house[0]["o"]
    best_other = min((dist(s) for s in house if s["o"] != side), default=HOUSE + R + 1)
    counted = [s for s in house if s["o"] == side and dist(s) < best_other]
    if not counted:
        return None, 0, []
    return side, sum(2 if s.get("hot") else 1 for s in counted), counted


def measure(stones):
    """What the browsers draw for the count: the shot side, its points, the counting stones' ids and the
    distance of the best rival stone in the house (the measuring ring), or None."""
    side, pts, counted = count_end(stones)
    house = [s for s in stones if in_house(s)]
    rival = min((dist(s) for s in house if s["o"] != side), default=None) if side is not None else None
    return {"side": side, "pts": pts, "ids": [s["id"] for s in counted], "ring": round(rival, 3) if rival is not None else None,
            "d": {str(s["id"]): round(dist(s), 2) for s in house}}


class Stones(Game):
    id = "stones"
    solo_bots = 2
    category = "action"
    family = None
    howto = [
        "Take turns sliding stones at the house (the rings). Set the 🧹 broom (tap or drag the ice), the weight (guard stops in front of the house, draw in it, takeout hits) and ↺ / ↻ the curl: the stone bends that way, more as it slows.",
        "While your stone slides, hold the 🧹 Sweep pad to sweep (scrub it fast to sweep hard): the stone runs further and straighter. The marker on the ice shows where it will stop. A stone that stops before the red hog line (without touching another) comes off.",
        "Scoring is real curling's: after the end's last stone, only the player with the stone nearest the button scores — one point for each of their stones in the house closer than anyone else's best. The gold ring measures it.",
        "🔥 One stone each end is a hot stone: if it counts, it scores double. Knock rivals out of the house; stones over the sides or the back line are out.",
        "Most points after the last end wins. The last stone of an end (the hammer) moves round the table.",
    ]
    name = "Ice Stones"
    icon = "🥌"
    blurb = "Slide stones down the ice with weight and curl, then sweep them home. Closest to the button scores; 🔥 hot stones double."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "button": ("🎯", "On the button", "Stop a stone within a hand's width of the button"),
              "double": ("💥", "Double takeout", "Knock two rival stones out with one throw")}
    settings_schema = {
        "ends": ("Ends", [(4, "4"), (6, "6"), (2, "2"), (8, "8")], 4),
        "ice": ("Ice", [("keen", "❄️ Keen"), ("swingy", "🌀 Swingy"), ("heavy", "🧊 Heavy")], "keen"),
    }

    def __setstate__(self, st):   # rooms saved before #187 have no live slide
        self.__dict__.update(st)
        self.__dict__.setdefault("live", None)
        self.__dict__.setdefault("extra", 0)

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.points = [0] * n
        self.ends_log = []          # [[seat or None, points], ...]
        self.end_no = 0
        self.shot, self.shot_id = None, 0
        self.between = False
        self.ready_at = 0.0
        self.live = None
        self.extra = 0              # extra ends played to break a tie
        ends = self.s.get("ends", 4)
        self.room.add_log(f"🥌 Ice Stones: {ends} end{'s' if ends != 1 else ''}, {per_player(n)} stones each per end. Closest to the button scores.", "big")
        self.new_end()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def present(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    @property
    def ice(self):
        return {"keen": (1.0, 1.0), "swingy": (1.0, 1.6), "heavy": (1.12, 0.85)}[self.s.get("ice", "keen")]

    def new_end(self, only=None):
        """The next end; only: the seats tied on top after the last end, who play an extra end (#186)."""
        self.between = False
        self.mark_round()
        self.end_no += 1
        n = len(self.seats)
        first = (self.end_no - 1) % n
        here = [i for i in ((first + k) % n for k in range(n)) if self.present(i) and (only is None or i in only)]
        self.order = here * per_player(n if only is None else len(here))   # who throws each stone of this end
        self.thrown = 0
        self.stones = []                            # {"o": seat, "x", "y", "hot", "id"}
        self.hot = self.rng.randrange(len(self.order)) if self.order else -1
        self.sid = 0
        title = f"Extra end {self.extra}" if only is not None else f"End {self.end_no} of {self.s.get('ends', 4)}"
        self.room.add_log(f"🧊 {title}: {self.name_of(self.order[-1])} has the hammer. 🔥 Stone {self.hot + 1} is hot.")
        self.next_turn(0.0)

    def next_turn(self, wait, now=None):
        now = time.time() if now is None else now
        while self.thrown < len(self.order) and not self.present(self.order[self.thrown]):
            self.thrown += 1
        if self.thrown >= len(self.order):
            return self.end_end(wait, now)
        i = self.order[self.thrown]
        r = self.room
        r.begin_turn(self.seats[i])
        self.ready_at = now + wait
        if wait:
            if self.pl(i).bot:
                r.bot_at = max(r.bot_at, self.ready_at + 0.6)
            if r.deadline:
                r.deadline += wait

    # -- actions

    def act(self, p, a):
        if a.get("type") != "throw":
            raise GameError("Unknown action.")
        if self.between:
            raise GameError("The next end is coming up.")
        if self.live:
            raise GameError("Wait for the stones to stop.")
        self.require_turn(p)
        aim, weight, curl, sweep = a.get("aim"), a.get("weight"), a.get("curl"), a.get("sweep", 0)
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (aim, weight)):
            raise GameError("Bad throw.")
        if not -HALF <= aim <= HALF or not 0 <= weight <= 1:
            raise GameError("Bad throw.")
        if curl not in (-1, 1) or sweep not in (0, 1, 2) or isinstance(curl, bool) or isinstance(sweep, bool):
            raise GameError("Bad throw.")
        if time.time() < self.ready_at - 0.3:
            raise GameError("Wait for the stones to stop.")
        # a human sweeps live (on_input); `sweep` is where the brooms start (the old pre-set sweeping)
        self.throw(self.seat(p), float(aim), float(weight), curl, sweep, live=True)

    def throw(self, i, aim, weight, curl, sweep, live=False, now=None):
        """Release a stone. live: it slides on the server's clock (frame) with the thrower sweeping as they go;
        otherwise (bots) at its planned sweep, still played out live so everyone watches it at the same pace."""
        now = time.time() if now is None else now
        hot = self.thrown == self.hot
        self.sid += 1
        new = {"o": i, "hot": hot, "id": self.sid}
        fk, ck = self.ice
        sl = Slide(self.stones, new, aim, weight, curl, fk, ck, True)
        p = self.pl(i)
        self.live = {"sl": sl, "by": i, "hot": hot, "new": new["id"], "before": [dict(s) for s in self.stones],
                     "aim": round(aim, 3), "curl": curl, "bot": bool(p and p.bot), "base": sweep,
                     "sw": sweep, "until": now + (1e9 if p and p.bot else 0.8), "acc": 0.0, "last": now,
                     "push": 0.0, "max": sweep, "id": self.shot_id + 1}
        self.thrown += 1
        self.shot_id += 1
        self.shot = self.live_shot()
        r = self.room
        r.deadline = None      # the clock waits for the stones to stop
        self.ready_at = now + MAX_T + 5

    def sweep_now(self, now):
        L = self.live
        return L["sw"] if now < L["until"] else 0

    def live_shot(self):
        L = self.live
        sl = L["sl"]
        return {"id": L["id"], "by": L["by"], "hot": L["hot"], "before": L["before"], "after": None, "new": L["new"],
                "tracks": [{"k": k, "s": tr["s"], "f": list(tr["f"]), **({"out": True} if tr.get("out") else {})} for k, tr in sl.tracks.items()],
                "aim": L["aim"], "curl": L["curl"], "sweep": L["max"], "frames": sl.head, "live": True,
                "sw": self.sweep_now(time.time()) if not L["bot"] else L["base"]}

    def on_input(self, p, a):
        """🧹 The thrower sweeping their own stone: {sweep: 0|1|2}, resent while held (a lost release lapses)."""
        L = self.live
        if not L or self.seat(p) != L["by"]:
            return
        lvl = a.get("sweep")
        if lvl not in (0, 1, 2) or isinstance(lvl, bool):
            return
        L["sw"] = lvl
        L["until"] = time.time() + 0.6

    def frame(self, now):
        """Runs the live slide. Also, for simulate.py (which only calls frame), takes bot turns and the end's
        pause a moment after the room's own ticker would have."""
        r = self.room
        if r.phase != "playing":
            return False
        if self.live:
            return self.advance(now)
        if self.between:
            if r.deadline and now > r.deadline + 1.0:
                self.after_end()
                return True
            return False
        if self.bot_ready() and now >= r.bot_at + 1.0:
            self.bot_tick()
            return True
        return False

    def advance(self, now):
        L = self.live
        sl = L["sl"]
        dt = min(0.1, max(0.0, now - L["last"]))
        L["last"] = now
        L["acc"] += dt
        lvl = L["base"] if L["bot"] else max(L["base"], self.sweep_now(now))
        if lvl > L["max"] and SWEEP_FROM < sl.st[-1]["y"] < BACK:
            L["max"] = lvl
        done = False
        while L["acc"] >= DT:
            L["acc"] -= DT
            if not sl.step(lvl):
                done = True
                break
        if done:
            self.settle(now)
            return True
        if now - L["push"] >= 0.1:
            L["push"] = now
            # the newest ~0.4 s of every track (a dropped packet or two leaves no gap), and whether it's still
            # moving (0), stopped (1) or out (2)
            mv = set(sl.moving)
            self.room.push_fast({"ic": {"id": L["id"], "h": sl.head, "sw": lvl, "t": [
                [k, tr["s"], max(0, len(tr["f"]) - 12), tr["f"][-12:], 2 if tr.get("out") else 0 if k in mv else 1]
                for k, tr in sl.tracks.items()]}})
        return False

    def settle(self, now):
        """The slide has stopped: keep the stones, say what happened, pass the turn."""
        L, self.live = self.live, None
        i, hot = L["by"], L["hot"]
        keep, tracks, hit = L["sl"].finish()
        before = L["before"]
        kept_ids = {s["id"] for s in keep}
        out = [s for s in before if s["id"] not in kept_ids]
        self.stones = keep
        nm = self.name_of(i)
        landed = next((s for s in keep if s["id"] == L["new"]), None)
        rivals_out = [s for s in out if s["o"] != i]
        sweep = L["max"]
        words = ("", " with light sweeping", " sweeping hard")[sweep]
        if landed is None:
            why = "short of the hog line" if tracks.get(len(before), {}).get("short") else "through the house" if not hit else "out"
            self.room.add_log(f"🥌 {nm}'s {'🔥 hot ' if hot else ''}stone goes {why}{words}.", "info")
        else:
            d = dist(landed)
            where = ("on the button" if d < 0.15 else "in the house" if d <= HOUSE + R else
                     "as a guard" if landed["y"] < TEE - HOUSE else "behind the house")
            self.room.add_log(f"🥌 {nm}'s {'🔥 hot ' if hot else ''}stone stops {where}{words}.", "info")
            if d < 0.15:
                self.award(self.seats[i], "button")
                self.moment(f"🎯 {nm}: ON THE BUTTON", "gold", "good")
        if rivals_out:
            self.room.add_log(f"💥 {nm} knocks out {', '.join(self.name_of(s['o']) + ('’s 🔥' if s.get('hot') else '’s') + ' stone' for s in rivals_out)}.", "power")
            if len(rivals_out) >= 2:
                self.award(self.seats[i], "double")
                self.moment(f"💥 {nm}: DOUBLE TAKEOUT", "gold", "boom")
        frames = max([tr["s"] + len(tr["f"]) for tr in tracks.values()] + [0])
        self.shot = {"id": L["id"], "by": i, "hot": hot, "before": before, "after": self.stones,
                     "new": L["new"], "tracks": [{"k": k, **tr} for k, tr in tracks.items()],
                     "aim": L["aim"], "curl": L["curl"], "sweep": sweep, "frames": frames, "swept": round(L["sl"].swept * DT, 1)}
        self.next_turn(LAG + 0.6, now)

    def sim(self, stones, new, aim, weight, curl, sweep, record, fk=1.0, ck=1.0):
        return simulate(stones, new, aim, weight, curl, sweep, record, fk, ck)

    # -- ends

    def end_end(self, wait, now=None):
        r = self.room
        now = time.time() if now is None else now
        side, pts, counted = count_end(self.stones)
        self.end_measure = measure(self.stones)
        if side is not None:
            self.points[side] += pts
            hot = any(s.get("hot") for s in counted)
            n = len(counted)
            why = "the only stone in the house" if not self.end_measure["ring"] and n == 1 else (
                f"{'its' if n == 1 else 'their'} {n} stone{'s' if n != 1 else ''} {'in the house' if not self.end_measure['ring'] else 'closer than anyone else’s best'}")
            r.add_log(f"🏁 End {self.end_no}: {self.name_of(side)} scores {pts} — {why}{' (🔥 hot stone doubled)' if hot else ''}.", "big")
            if pts >= 3:
                self.moment(f"🥌 {self.name_of(side)} scores {pts}!", "gold", "fanfare")
        else:
            r.add_log(f"🏁 End {self.end_no}: nobody in the house, a blank end.", "big")
        self.ends_log.append([side, pts])
        self.end_counted = [s["id"] for s in counted]
        self.between = True
        r.turn = None
        r.deadline = now + wait + END_PAUSE

    def after_end(self):
        r = self.room
        self.between = False
        total = self.s.get("ends", 4)
        left = total - self.end_no
        here = [i for i in range(len(self.seats)) if self.present(i)]
        ranked = sorted(here, key=lambda i: self.points[i], reverse=True)
        if left <= 0 or len(here) <= 1:
            if not ranked:
                return r.finish(None, "Everyone left.")
            top = ranked[0]
            tied = [i for i in ranked if self.points[i] == self.points[top]]
            if len(tied) > 1 and self.extra < 2 and len(here) > 1:   # like curling: a tie plays an extra end
                self.extra += 1
                r.add_log(f"⚖️ Tied on {self.points[top]}: an extra end for {' & '.join(self.name_of(i) for i in tied)}.", "big")
                self.moment(f"⚖️ EXTRA END: {' v '.join(self.name_of(i) for i in tied)}", "cool")
                return self.new_end(only=tied)
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {self.points[top]} between {' & '.join(self.name_of(i) for i in tied)}.")
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Ice Stones with {self.points[top]} point{'s' if self.points[top] != 1 else ''}!")
        self.new_end()

    def on_timeout(self):
        r = self.room
        if self.between:
            return self.after_end()
        if self.live or r.turn not in self.seats:
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.name_of(i)} ran out of time: that stone is lost.", "power")
        self.thrown += 1
        self.next_turn(0.0)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the ice.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if not self.between and not self.live and r.turn == p.id:
            self.thrown += 1
            self.next_turn(0.0)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "points"):
            return ""
        left = sum(1 for k in range(getattr(self, "thrown", 0), len(getattr(self, "order", []))) if self.order[k] == i)
        return f"{self.points[i]} pts · 🥌{left}"

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        live = getattr(self, "live", None)
        nxt = self.order[self.thrown] if not self.between and not live and self.thrown < len(self.order) else None
        fk, ck = self.ice
        return {"stones": {
            "seats": self.seats, "me": self.seat(p), "end": self.end_no, "ends": self.s.get("ends", 4),
            "ice": self.s.get("ice", "keen"),
            "stones": self.stones, "shot": self.live_shot() if live else self.shot, "points": self.points, "endsLog": self.ends_log,
            "order": self.order, "thrown": self.thrown, "hot": self.hot, "next": nxt,
            "between": self.between, "counted": getattr(self, "end_counted", []) if self.between else [],
            "sliding": live["by"] if live else None, "extra": self.extra if self.end_no > self.s.get("ends", 4) else 0,
            "count": measure(self.stones), "endMeasure": getattr(self, "end_measure", None) if self.between else None,
            "phys": {"fric": FRICTION, "curl": CURL, "vc": V_CURL, "sweep": SWEEP, "from": SWEEP_FROM, "dt": DT, "fk": fk, "ck": ck,
                     "wd": W_DRAW, "lo": STOP_LO, "hi": STOP_HI, "vmax": VMAX, "lag": LAG},
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)),
            "standings": self.standings() if self.between and len(self.seats) > 1 else None,
            "sheet": {"half": HALF, "start": START, "hog": HOG, "tee": TEE, "house": HOUSE, "back": BACK, "end": END_Y, "r": R},
        }}

    # -- bots: try throws in the real physics and keep the one that leaves the best position

    def value(self, stones, i):
        """How good the stones in play look for seat i."""
        side, pts, counted = count_end(stones)
        v = 0.0
        if side == i:
            v += 10 * pts
        elif side is not None:
            v -= 10 * pts
        for s in stones:
            d = dist(s)
            near = max(0.0, (HOUSE + R) - d)
            w = 2 if s.get("hot") else 1
            v += (2.0 if s["o"] == i else -1.6) * near * w
            if s["o"] == i and TEE - 7 < s["y"] < TEE - HOUSE - 0.3 and abs(s["x"]) < 1.0:
                v += 0.6  # a guard in front of the house
        return v

    def plan(self, i, level):
        rng = random
        hot = self.thrown == self.hot
        new = {"o": i, "hot": hot, "id": -1}
        fk, ck = self.ice
        last = self.thrown == len(self.order) - 1
        tries = {"easy": 10, "normal": 28, "hard": 55}.get(level, 28)
        deadline = time.time() + {"easy": 0.5, "normal": 1.2, "hard": 2.2}.get(level, 1.2)
        rivals = [s for s in self.stones if s["o"] != i and dist(s) <= HOUSE + R]
        cands = []
        for _ in range(tries):
            curl = rng.choice((-1, 1))
            r = rng.random()
            if rivals and r < 0.4 and level != "easy":
                t = min(rivals, key=dist)
                cands.append((t["x"] - curl * rng.uniform(-0.1, 0.5), rng.uniform(0.74, 1.0), curl, rng.choice((0, 0, 1))))
            else:   # a guard or a draw: aim off the centre line and let it curl back
                cands.append((rng.uniform(-1.5, 1.5), weight_for(rng.uniform(22.5, 30.0), fk), curl, rng.choice((0, 1, 2))))

        def score(c):
            keep, _, _ = self.sim(self.stones, new, *c, False, fk, ck)
            v = self.value(keep, i)
            if last:  # with the hammer only the count matters
                side, pts, _ = count_end(keep)
                v += 30 * (pts if side == i else -pts if side is not None else 0)
            return v

        best, best_v = None, -1e9
        for c in cands:
            if time.time() > deadline and best is not None:
                break
            v = score(c)
            if v > best_v:
                best, best_v = c, v
        if level == "hard":
            for _ in range(14):
                if time.time() > deadline:
                    break
                c = (min(HALF, max(-HALF, best[0] + rng.gauss(0, 0.12))), min(1.0, max(0.0, best[1] + rng.gauss(0, 0.03))), best[2], best[3])
                v = score(c)
                if v > best_v:
                    best, best_v = c, v
        aim, w, curl, sweep = best
        na, nw = {"easy": (0.35, 0.06), "normal": (0.12, 0.02), "hard": (0.04, 0.008)}.get(level, (0.12, 0.02))
        aim = min(HALF, max(-HALF, aim + rng.gauss(0, na)))
        w = min(1.0, max(0.0, w + rng.gauss(0, nw)))
        return round(aim, 3), round(w, 3), curl, sweep

    def bot_ready(self):
        if self.between or getattr(self, "live", None):
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_turn(self, p):
        i = self.seat(p)
        self.throw(i, *self.plan(i, p.bot))
