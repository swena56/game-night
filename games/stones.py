"""Ice Stones: an original curling-style game for 2–6 players, each playing for themselves.

Players take turns sliding granite stones down a sheet of ice towards the house, a target of rings. Each
throw sets an aim (the skip's broom across the house), a weight (how hard), a curl (which way the stone
bends as it slows) and how hard to sweep (sweeping makes the stone run further and curl less). When every
stone of the end has been thrown, whoever has the stone nearest the button scores one point for each of
their stones closer than anyone else's best. 🔥 One stone in each end is a hot stone, and it scores double.

Physics runs on the server in 2D (x across the sheet, y down it, metres-ish) at 120 steps a second, and the
moving stones' tracks are sent to every browser to play back at 30 frames a second, like Cannon Hills.
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
FRICTION = 1.10       # m/s² deceleration on bare ice
SWEEP = [(1.0, 1.0), (0.95, 0.8), (0.9, 0.6)]   # (friction, curl) multipliers for no / light / hard sweeping
SWEEP_FROM = 8.0      # sweepers pick the stone up past this point
CURL_K = 0.38         # sideways pull, grows as the stone slows
VMIN, VMAX = 6.2, 10.3
REST = 0.86           # stone-on-stone restitution
DT = 1 / 120
FRAME = 4             # record every 4th step: 30 frames a second
MAX_T = 16.0
END_PAUSE = 4.5       # seconds to read an end's result after its last stone has stopped


def per_player(n):
    return {2: 4, 3: 3}.get(n, 2)


def launch(aim, weight):
    """Velocity of a stone released at (0, START) towards the broom at (aim, TEE), with weight 0..1."""
    v = VMIN + (VMAX - VMIN) * weight
    dx, dy = aim, TEE - START
    d = math.hypot(dx, dy)
    return v * dx / d, v * dy / d


def simulate(stones, thrown, aim, weight, curl, sweep, record=True, fk=1.0, ck=1.0):
    """Slide `thrown` (a new stone dict) into `stones` (a list of stone dicts, each {x, y, ...}).
    Returns (stones still in play, tracks, hit), where tracks maps a stone's index in the input list
    (len(stones) for the thrown one) to {"s": first frame, "f": [[x, y], ...]} and hit says whether the
    thrown stone touched another."""
    allst = [dict(s) for s in stones] + [dict(thrown, x=0.0, y=START)]
    n = len(allst)
    vx, vy = [0.0] * n, [0.0] * n
    spin = [0.0] * n
    vx[-1], vy[-1] = launch(aim, weight)
    spin[-1] = curl
    live = [True] * n          # still on the sheet
    moving = {n - 1}
    tracks = {}
    fric_k, curl_k = SWEEP[sweep]
    hit = False
    step, t = 0, 0.0
    if record:
        tracks[n - 1] = {"s": 0, "f": [[0.0, START]]}
    while moving and t < MAX_T:
        step += 1
        t += DT
        for i in list(moving):
            sp = math.hypot(vx[i], vy[i])
            if sp < 1e-3:
                vx[i] = vy[i] = 0.0
                moving.discard(i)
                continue
            swept = i == n - 1 and allst[i]["y"] > SWEEP_FROM
            dec = FRICTION * fk * (fric_k if swept else 1.0) * DT
            ux, uy = vx[i] / sp, vy[i] / sp
            ns = max(0.0, sp - dec)
            vx[i], vy[i] = ux * ns, uy * ns
            if spin[i] and ns > 0:
                # pull sideways (perpendicular to travel), more as the stone slows
                lat = spin[i] * CURL_K * ck * (curl_k if swept else 1.0) / (0.6 + ns) * DT
                vx[i] += uy * lat
                vy[i] -= ux * lat
            allst[i]["x"] += vx[i] * DT
            allst[i]["y"] += vy[i] * DT
            if ns == 0:
                moving.discard(i)
        # collisions: any moving stone against any stone in play
        for i in list(moving):
            if not live[i]:
                continue
            for j in range(n):
                if j == i or not live[j]:
                    continue
                dx = allst[j]["x"] - allst[i]["x"]
                dy = allst[j]["y"] - allst[i]["y"]
                d2 = dx * dx + dy * dy
                if d2 >= (2 * R) ** 2 or d2 == 0:
                    continue
                d = math.sqrt(d2)
                nx, ny = dx / d, dy / d
                rel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny
                overlap = 2 * R - d
                allst[i]["x"] -= nx * overlap / 2
                allst[i]["y"] -= ny * overlap / 2
                allst[j]["x"] += nx * overlap / 2
                allst[j]["y"] += ny * overlap / 2
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
                    hit = True
                if j not in moving:
                    moving.add(j)
                    if record and j not in tracks:
                        tracks[j] = {"s": step // FRAME, "f": [[round(allst[j]["x"], 3), round(allst[j]["y"], 3)]]}
        # off the sheet: over the side boards or past the back line
        for i in list(moving):
            s = allst[i]
            if abs(s["x"]) > HALF - R or s["y"] > BACK + R:
                live[i] = False
                moving.discard(i)
                if record:
                    tracks[i]["f"].append([round(s["x"], 3), round(s["y"], 3)])
                    tracks[i]["out"] = True
        if record and step % FRAME == 0:
            for i in moving:
                tr = tracks.get(i)
                if tr is not None:
                    tr["f"].append([round(allst[i]["x"], 3), round(allst[i]["y"], 3)])
    if record:  # every track ends where its stone came to rest
        for i, tr in tracks.items():
            last = [round(allst[i]["x"], 3), round(allst[i]["y"], 3)]
            if live[i] and tr["f"][-1] != last:
                tr["f"].append(last)
    me = allst[-1]
    if live[-1] and me["y"] < HOG and not hit:
        live[-1] = False
        if record:
            tracks[n - 1]["short"] = True
    keep = [s for i, s in enumerate(allst) if live[i]]
    return keep, tracks, hit


def dist(s):
    return math.hypot(s["x"], s["y"] - TEE)


def count_end(stones):
    """(scoring seat, points, the scoring stones) for stones in play, or (None, 0, []) with none in the house."""
    house = sorted((s for s in stones if dist(s) <= HOUSE + R), key=dist)
    if not house:
        return None, 0, []
    side = house[0]["o"]
    best_other = min((dist(s) for s in house if s["o"] != side), default=HOUSE + R + 1)
    counted = [s for s in house if s["o"] == side and dist(s) < best_other]
    return side, sum(2 if s.get("hot") else 1 for s in counted), counted


class Stones(Game):
    id = "stones"
    category = "action"
    family = None
    howto = [
        "Take turns sliding stones down the ice at the house (the rings). Set the 🧹 broom where to aim, the weight (how hard), and ↺ / ↻ the curl: a stone bends that way as it slows.",
        "Sweeping (None / Light / Hard) makes a stone run further and curl less. A stone that stops before the red hog line (without touching another) is taken off.",
        "When every stone of the end has been thrown, the stone nearest the button scores: one point for each of that player's stones closer than anyone else's best.",
        "🔥 One stone each end is a hot stone: if it counts, it scores double. Knock rivals out of the house; stones over the sides or the back line are out.",
        "Most points after the last end wins. The last stone of an end (the hammer) moves round the table.",
    ]
    name = "Ice Stones"
    icon = "🥌"
    blurb = "Slide stones down the ice with weight, curl and sweep. Closest to the button scores; 🔥 hot stones double."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "button": ("🎯", "On the button", "Stop a stone within a hand's width of the button"),
              "double": ("💥", "Double takeout", "Knock two rival stones out with one throw")}
    settings_schema = {
        "ends": ("Ends", [(4, "4"), (6, "6"), (2, "2"), (8, "8")], 4),
        "ice": ("Ice", [("keen", "❄️ Keen"), ("swingy", "🌀 Swingy"), ("heavy", "🧊 Heavy")], "keen"),
    }

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

    def new_end(self):
        self.between = False
        self.mark_round()
        self.end_no += 1
        n = len(self.seats)
        first = (self.end_no - 1) % n
        here = [i for i in ((first + k) % n for k in range(n)) if self.present(i)]
        self.order = here * per_player(n)          # who throws each stone of this end
        self.thrown = 0
        self.stones = []                            # {"o": seat, "x", "y", "hot", "id"}
        self.hot = self.rng.randrange(len(self.order)) if self.order else -1
        self.sid = 0
        self.room.add_log(f"🧊 End {self.end_no} of {self.s.get('ends', 4)}: {self.name_of(self.order[-1])} has the hammer. 🔥 Stone {self.hot + 1} is hot.")
        self.next_turn(0.0)

    def next_turn(self, wait):
        while self.thrown < len(self.order) and not self.present(self.order[self.thrown]):
            self.thrown += 1
        if self.thrown >= len(self.order):
            return self.end_end(wait)
        i = self.order[self.thrown]
        r = self.room
        r.begin_turn(self.seats[i])
        self.ready_at = time.time() + wait
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
        self.throw(self.seat(p), float(aim), float(weight), curl, sweep)

    def throw(self, i, aim, weight, curl, sweep):
        hot = self.thrown == self.hot
        self.sid += 1
        new = {"o": i, "hot": hot, "id": self.sid}
        before = [dict(s) for s in self.stones]
        fk, ck = self.ice
        keep, tracks, hit = self.sim(self.stones, new, aim, weight, curl, sweep, True, fk, ck)
        kept_ids = {s["id"] for s in keep}
        out = [s for s in before if s["id"] not in kept_ids]
        self.stones = keep
        self.thrown += 1
        nm = self.name_of(i)
        landed = next((s for s in keep if s["id"] == new["id"]), None)
        rivals_out = [s for s in out if s["o"] != i]
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
        self.shot_id += 1
        frames = max([tr["s"] + len(tr["f"]) for tr in tracks.values()] + [0])
        self.shot = {"id": self.shot_id, "by": i, "hot": hot, "before": before, "after": self.stones,
                     "new": new["id"], "tracks": [{"k": k, **tr} for k, tr in tracks.items()],
                     "aim": round(aim, 3), "curl": curl, "sweep": sweep, "frames": frames}
        self.next_turn(frames / 30 + 0.6)

    def sim(self, stones, new, aim, weight, curl, sweep, record, fk=1.0, ck=1.0):
        return simulate(stones, new, aim, weight, curl, sweep, record, fk, ck)

    # -- ends

    def end_end(self, wait):
        r = self.room
        side, pts, counted = count_end(self.stones)
        if side is not None:
            self.points[side] += pts
            hot = any(s.get("hot") for s in counted)
            r.add_log(f"🏁 End {self.end_no}: {self.name_of(side)} scores {pts}{' (🔥 hot stone doubled)' if hot else ''}.", "big")
            if pts >= 3:
                self.moment(f"🥌 {self.name_of(side)} scores {pts}!", "gold", "fanfare")
        else:
            r.add_log(f"🏁 End {self.end_no}: nobody in the house, a blank end.", "big")
        self.ends_log.append([side, pts])
        self.end_counted = [s["id"] for s in counted]
        self.between = True
        r.turn = None
        r.deadline = time.time() + wait + END_PAUSE

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
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {self.points[top]} between {' & '.join(self.name_of(i) for i in tied)}.")
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Ice Stones with {self.points[top]} point{'s' if self.points[top] != 1 else ''}!")
        self.new_end()

    def on_timeout(self):
        r = self.room
        if self.between:
            return self.after_end()
        if r.turn not in self.seats:
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
        if not self.between and r.turn == p.id:
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
        nxt = self.order[self.thrown] if not self.between and self.thrown < len(self.order) else None
        return {"stones": {
            "seats": self.seats, "me": self.seat(p), "end": self.end_no, "ends": self.s.get("ends", 4),
            "ice": self.s.get("ice", "keen"),
            "stones": self.stones, "shot": self.shot, "points": self.points, "endsLog": self.ends_log,
            "order": self.order, "thrown": self.thrown, "hot": self.hot, "next": nxt,
            "between": self.between, "counted": getattr(self, "end_counted", []) if self.between else [],
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
                cands.append((t["x"] + curl * rng.uniform(0.1, 0.7), rng.uniform(0.55, 1.0), curl, rng.choice((0, 0, 1))))
            else:
                cands.append((rng.uniform(-1.4, 1.4), rng.uniform(0.15, 0.5), curl, rng.choice((0, 1, 2))))

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
        if self.between:
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_turn(self, p):
        i = self.seat(p)
        self.throw(i, *self.plan(i, p.bot))
