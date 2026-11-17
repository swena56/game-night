"""Coin Cascade: an original coin-pusher game for 2–6 players sharing one arcade machine, taking turns.

The machine's shelf slides in and out over a playfield packed with coins. Each player owns a stretch of the front
edge (their tray). On your turn you slide the chute left or right and drop a handful of three coins, timing it against the shelf:
coins dropped while the shelf is pulled back land deep and get the full shove. The shelf pushes the coin, the coin
pushes the pile, and whatever goes over the front edge drops into the tray below it: 1 point a coin, 3 for a ⭐ prize
token. Coins pushed off the open sides near the front fall into the gutters and are lost.

Land your coin on a 🔔 bell spot for a bonus: 🧱 side guards (your next 3 drops lose nothing off the sides),
🫨 shake (this drop gets an extra, longer shove) or 🪙 mega coin (your next handful has a big heavy one).

The server simulates each drop (coins as discs that only move when shoved: by the shelf's face, by each other and by
the walls) and streams the motion to the browsers once over the fast channel; the view carries the settled pile.
"""
import math
import random
import time

from .base import Game, GameError

HW = 3.6                     # the playfield: x in [-HW, HW]
EDGE = 6.0                   # the front edge (y); the shelf's face moves at the back (small y)
FACE = (0.35, 2.2)           # the shelf face's travel (y)
PERIOD = 2.4                 # seconds for one stroke out and back
GAP_Y = 3.4                  # the side walls stop here: past it, coins can fall off the sides
R_COIN, R_MEGA = 0.3, 0.52
STEP = 1 / 20
SIM_T, SHAKE_T = 4.8, 2.4    # seconds a drop runs (a shake adds a stroke)
FRAME_EVERY = 2              # record motion every n steps (10 a second)
ITERS = 14                   # solver passes a step at most (it stops once nothing overlaps more than SLOP)
SLOP = 0.008
CELL = 1.1
START_COINS, START_STARS = 72, 3
STAR_EVERY = 3               # a new ⭐ drops in the back every n turns
BELLS = ((-1.8, 2.5), (1.8, 2.5))
BELL_R = 0.45
BONUSES = ("guard", "shake", "mega")
BONUS_NAMES = {"guard": "🧱 side guards", "shake": "🫨 shake", "mega": "🪙 mega coin"}
GUARD_DROPS = 3
HANDFUL, GAP_T = 3, 0.3          # coins a turn, seconds between them
SPREAD = (0.0, -0.42, 0.42)      # each coin's offset from the aim (#154: wide enough that they don't land on each other)
BOT = {"easy": 3, "normal": 8, "hard": 18}     # candidate drops tried
BOT_RIVAL = {"easy": 0.0, "normal": 0.1, "hard": 0.3}  # how much a coin into a rival's tray counts against


def face_at(phase):
    """The shelf face's y at a point in its cycle (0..1, 0 = pulled back)."""
    return FACE[0] + (FACE[1] - FACE[0]) * (0.5 - 0.5 * math.cos(math.tau * phase))


def run_time(phase, extra=0.0):
    """How long a drop runs: at least SIM_T (+ extra), ending with the shelf all the way out, so the idle shelf
    between turns never reaches past the pile it left."""
    t = SIM_T + extra
    t += ((0.5 - phase - t / PERIOD) % 1.0) * PERIOD
    return round(t / STEP) * STEP


def owner_of(x, n):
    k = int((x + HW) / (2 * HW / n))
    return max(0, min(n - 1, k))


def clamp_coin(c, face, guard):
    """The shelf's face and the side walls (where there are walls) hold a coin back."""
    if c[2] - c[3] < face:
        c[2] = face + c[3]
    if c[2] < GAP_Y or guard:
        lim = HW - c[3]
        if c[1] < -lim:
            c[1] = -lim
        elif c[1] > lim:
            c[1] = lim


def landing(coins, x, r, face):
    """Where a dropped coin settles (#154): the first free spot in front of the shelf's face under the chute, not
    on top of a coin already lying there (a deep pile leaves it at the face, to be shoved)."""
    y = face + r + 0.02
    for _ in range(30):
        if all((c[1] - x) ** 2 + (c[2] - y) ** 2 >= (c[3] + r) ** 2 for c in coins):
            return y
        y += 0.06
        if y > EDGE - r - 0.3:
            break
    return face + r + 0.02


def simulate(coins, phase, n, guard=False, extra=0.0, frames=True, adds=()):
    """Run the machine for SIM_T (+ extra) seconds from `phase`. coins: [[id, x, y, r, kind], …] (changed in place;
    fallen coins removed). adds: [(t, x, r, kind, id)] coins dropped in during the run (each lands just in front
    of the shelf's face). Returns (falls [[id, kind, x, owner or -1, t]], frames [[t, [[id, x, y], …]], …])."""
    t = 0.0
    out = []
    rec = []
    last = {c[0]: (c[1], c[2]) for c in coins}
    steps = int(round(run_time(phase, extra) / STEP))
    pending = sorted(adds)
    for s in range(1, steps + 1):
        t = s * STEP
        face = face_at(phase + t / PERIOD)
        while pending and pending[0][0] <= t:
            _, ax, ar, ak, aid = pending.pop(0)
            coins.append([aid, ax, landing(coins, ax, ar, face), ar, ak])
        for it in range(ITERS):
            # the face and the walls
            for c in coins:
                clamp_coin(c, face, guard)
            worst = 0.0
            # coins shove each other apart (a coin pressed against the face only moves sideways and forward)
            grid = {}
            for k, c in enumerate(coins):
                grid.setdefault((int((c[1] + 10) // CELL), int((c[2] + 10) // CELL)), []).append(k)
            for (gx, gy), ks in grid.items():
                near = []
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        near.extend(grid.get((gx + dx, gy + dy), ()))
                for a in ks:
                    ca = coins[a]
                    for b in near:
                        if b <= a:
                            continue
                        cb = coins[b]
                        dx, dy = cb[1] - ca[1], cb[2] - ca[2]
                        d2 = dx * dx + dy * dy
                        rr = ca[3] + cb[3]
                        if d2 >= rr * rr:
                            continue
                        d = math.sqrt(d2) or 1e-6
                        if d2 == 0:
                            dx, dy = 0.0, 1.0
                        over = rr - d
                        if over > worst:
                            worst = over
                        nx, ny = dx / d, dy / d
                        # the heavier coin gives less
                        wa = cb[3] * cb[3] / (ca[3] * ca[3] + cb[3] * cb[3])
                        pin_a = ca[2] - ca[3] <= face + 1e-6
                        pin_b = cb[2] - cb[3] <= face + 1e-6
                        if pin_a and not pin_b:
                            wa = 0.0 if ny > 0 else wa
                        elif pin_b and not pin_a:
                            wa = 1.0 if ny > 0 else wa
                        ca[1] -= nx * over * wa
                        ca[2] -= ny * over * wa
                        cb[1] += nx * over * (1 - wa)
                        cb[2] += ny * over * (1 - wa)
            if worst < SLOP:
                break
        # #154: no coin ends a step behind the face or through a wall
        for c in coins:
            clamp_coin(c, face, guard)
        # over the edge?
        keep = []
        for c in coins:
            if c[2] > EDGE:
                out.append([c[0], c[4], round(c[1], 2), owner_of(c[1], n), round(t, 2)])
            elif abs(c[1]) > HW and c[2] >= GAP_Y and not guard:
                out.append([c[0], c[4], round(c[1], 2), -1, round(t, 2)])
            else:
                keep.append(c)
        if len(keep) != len(coins):
            coins[:] = keep
        if frames and s % FRAME_EVERY == 0:
            moved = []
            for c in coins:
                lx, ly = last.get(c[0], (None, None))
                if lx is None or abs(c[1] - lx) > 0.004 or abs(c[2] - ly) > 0.004:
                    moved.append([c[0], round(c[1], 3), round(c[2], 3)])
                    last[c[0]] = (c[1], c[2])
            rec.append([round(t, 2), moved])
    return out, rec


class Pusher(Game):
    id = "pusher"
    category = "party"
    family = None
    howto = [
        "One shared coin-pusher machine. You own a stretch of the front edge: coins pushed over it drop into your tray.",
        "On your turn, slide the chute and drop a handful of three coins. Time it: dropped while the shelf is pulled back, they land deep and get the full shove.",
        "1 point a coin, 3 for a ⭐ prize token. Coins pushed off the open sides near the front are lost.",
        "Land on a 🔔 bell spot for a bonus: 🧱 side guards (3 drops), 🫨 an extra shove, or a 🪙 mega coin next turn.",
        "Most points when everyone's handfuls are spent wins.",
    ]
    name = "Coin Cascade"
    icon = "🪙"
    blurb = "A shared 3D arcade coin pusher: time your drop, shove the pile, catch the cascade in your tray."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "jackpot": ("🎰", "Jackpot", "Five or more points in your tray from one drop"),
              "collector": ("⭐", "Collector", "Catch three prize tokens in one game")}
    settings_schema = {
        "drops": ("Turns each", [(10, "10"), (6, "6"), (14, "14")], 10),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(seated)
        self.drops = int(self.s.get("drops", 10))
        self.left = [self.drops] * n
        self.points = [0] * n
        self.stars = [0] * n
        self.guard = [0] * n
        self.mega = [False] * n
        self.best = [0] * n
        self.coin_id = 0
        self.coins = []
        # a packed pile to start: a loose honeycomb of coins in front of the shelf, a few prizes among them
        spots = []
        row, y = 0, EDGE - 0.2                        # the front row teeters on the edge
        while y > FACE[1] + R_COIN + 0.1:
            x = -HW + R_COIN + (0.3 if row % 2 else 0.0)
            while x <= HW - R_COIN + 1e-9:
                spots.append((x + rng.uniform(-0.01, 0.01), y + rng.uniform(-0.01, 0.01)))
                x += 2 * R_COIN
            y -= 0.53
            row += 1
        rng.shuffle(spots)
        front = sorted(spots, key=lambda q: -q[1])[:START_COINS + START_STARS]
        stars = set(rng.sample(range(12, min(30, len(front))), START_STARS))
        for k, (x, y) in enumerate(front):
            self.add_coin(x, y, R_COIN, 1 if k in stars else 0)
        self.turns = 0
        self.shot = None              # the last drop: {id, by, x, y, phase, falls, frames, extra}
        self.shot_no = 0
        self.busy_until = 0.0
        self.room.add_log(f"🪙 Coin Cascade: {self.drops} handfuls each. Catch the cascade in your tray!", "big")
        self.room.begin_turn(self.seats[0])

    def add_coin(self, x, y, r, kind):
        self.coin_id += 1
        self.coins.append([self.coin_id, round(x, 3), round(y, 3), r, kind])
        return self.coin_id

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def present(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    def skip_turn(self, p):
        i = self.seat(p)
        return i is None or self.left[i] <= 0

    # -- a drop

    def act(self, p, a):
        if a.get("type") != "drop":
            raise GameError("Unknown action.")
        self.require_turn(p)
        x, ph = a.get("x"), a.get("phase")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (x, ph)):
            raise GameError("Bad drop.")
        if not -1 <= x <= 1 or not 0 <= ph <= 1:
            raise GameError("Bad drop.")
        if time.time() < self.busy_until - 0.3:
            raise GameError("Wait for the coins to settle.")
        self.drop(self.seat(p), x, ph)

    def handful(self, i, xf, phase, ids=True):
        """The coins of one turn: HANDFUL of them a moment apart round the aim (the first is the mega coin, if any)."""
        out = []
        mid = xf * (HW - R_COIN - max(SPREAD))       # the aim keeps the whole handful between the walls
        for k in range(HANDFUL):
            rad = R_MEGA if (k == 0 and self.mega[i]) else R_COIN
            x = max(-(HW - rad), min(HW - rad, mid + SPREAD[k]))
            cid = (self.coin_id + 1 + k) if ids else -1 - k
            out.append((round(GAP_T * k + STEP * 0.5, 3), round(x, 3), rad, 2 if rad == R_MEGA else 0, cid))
        return out

    def drop(self, i, xf, phase):
        r = self.room
        mega = self.mega[i]
        adds = self.handful(i, xf, phase)
        self.coin_id += len(adds)
        self.mega[i] = False
        # a bell under one of the coins?
        bonus = None
        for t, x, rad, _, _ in adds:
            y = face_at((phase + t / PERIOD) % 1.0) + rad + 0.02
            if any(math.hypot(x - bx, y - by) < BELL_R + rad * 0.5 for bx, by in BELLS):
                bonus = self.rng.choice(BONUSES)
                break
        guard = self.guard[i] > 0
        if guard:
            self.guard[i] -= 1
        extra = SHAKE_T if bonus == "shake" else 0.0
        n = len(self.seats)
        falls, frames = simulate(self.coins, phase, n, guard=guard, extra=extra, adds=adds)
        if bonus == "guard":
            self.guard[i] = GUARD_DROPS
        elif bonus == "mega":
            self.mega[i] = True
        self.left[i] -= 1
        self.turns += 1
        # score the trays
        gain = [0] * n
        for _, kind, _, own, _ in falls:
            if own >= 0:
                pts = 3 if kind == 1 else 1
                self.points[own] += pts
                gain[own] += pts
                if kind == 1:
                    self.stars[own] += 1
                    if self.stars[own] == 3 and self.pl(own):
                        self.award(self.seats[own], "collector")
        lost = sum(1 for f in falls if f[3] < 0)
        self.best[i] = max(self.best[i], gain[i])
        dur = run_time(phase, extra)
        self.shot_no += 1
        self.shot = {"no": self.shot_no, "by": i, "adds": [list(a) for a in adds], "phase": round(phase, 4),
                     "extra": extra, "dur": round(dur, 3), "falls": falls, "bonus": bonus, "gain": gain}
        r.push_fast({"shot": self.shot_no, "frames": frames})
        now = time.time()
        self.busy_until = now + dur + 0.2
        # a new prize drops in at the back now and then
        if self.turns % STAR_EVERY == 0:
            sx = self.rng.uniform(-HW + 1, HW - 1)
            self.add_coin(sx, FACE[1] + R_COIN + 0.05, R_COIN, 1)
        # the log, held until the coins land on screen
        bits = []
        if gain[i]:
            bits.append(f"+{gain[i]} in their tray")
        others = [f"{self.name_of(k)} +{g}" for k, g in enumerate(gain) if g and k != i]
        if others:
            bits.append("pushes " + ", ".join(others))
        if lost:
            bits.append(f"{lost} off the side")
        what = "handful with a 🪙 mega coin" if mega else "handful"
        r.add_log(f"🪙 {self.name_of(i)} drops a {what}: " + ("; ".join(bits) if bits else "nothing falls yet.") + ".", "info", at=now + dur * 0.8)
        if bonus:
            r.add_log(f"🔔 {self.name_of(i)} rings a bell: {BONUS_NAMES[bonus]}!", "power", at=now + 0.6)
        if gain[i] >= 5:
            if self.pl(i):
                self.award(self.seats[i], "jackpot", at=now + dur)
            self.moment(f"🎰 {self.name_of(i)} hits a cascade: +{gain[i]}!", "gold", "good", at=now + dur * 0.8)
        if all(self.left[k] <= 0 or not self.present(k) for k in range(n)):
            self.stage_end = now + dur + 1.0
            r.turn = None
            r.deadline = self.stage_end
            return
        r.advance()
        # don't start the next turn's clock (or a bot) until the coins have settled
        if r.deadline:
            r.deadline += dur
        r.bot_at = max(r.bot_at, self.busy_until + random.uniform(0.4, 1.0))

    def on_timeout(self):
        r = self.room
        if r.turn is None:
            return self.end()
        i = self.seats.index(r.turn) if r.turn in self.seats else None
        if i is None:
            return r.advance()
        r.add_log(f"⏰ {self.name_of(i)} ran out of time: the coin drops by itself.", "power")
        x, ph = self.plan(i, "easy")
        self.drop(i, x, ph)

    def end(self):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.present(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        key = lambda i: (self.points[i], self.stars[i], self.best[i])  # noqa: E731
        top = max(here, key=key)
        tied = [i for i in here if key(i) == key(top)]
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {self.points[top]} between {' & '.join(self.name_of(i) for i in tied)}.")
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Coin Cascade with {self.points[top]} points!")

    # -- bots: try drops in their head on a copy of the pile and keep the best

    def plan(self, i, level):
        n = len(self.seats)
        tries = BOT.get(level, 8)
        rival = BOT_RIVAL.get(level, 0.25)
        lo, hi = -HW + 2 * HW * i / n, -HW + 2 * HW * (i + 1) / n
        mid = (lo + hi) / 2 / HW
        best, best_v = None, -math.inf
        for k in range(tries):
            if level == "easy":
                x, ph = random.uniform(-1, 1), random.random()
            elif level == "hard":      # a grid across my stretch and a little either side, at three timings
                x = max(-1.0, min(1.0, (lo + (hi - lo) * ((k // 3) + 0.5) / (tries // 3)) / HW * 1.15 - mid * 0.15))
                ph = ((k % 3) + random.random()) / 3
            else:
                x = max(-1.0, min(1.0, mid + random.gauss(0, 0.35)))
                ph = random.random()
            v = 0.0
            if level != "easy":
                coins = [c[:] for c in self.coins]
                adds = self.handful(i, x, ph, ids=False)
                falls, _ = simulate(coins, ph, n, guard=self.guard[i] > 0, frames=False, adds=adds)
                for _, kind, _, own, _ in falls:
                    pts = 3 if kind == 1 else 1
                    v += pts if own == i else (-rival * pts if own >= 0 else 0)
                # (hard) value pushing the pile toward my tray: coins near my edge are next turn's points
                if level == "hard":
                    for c in coins:
                        if lo <= c[1] <= hi and c[2] > EDGE - 1.0:
                            v += 0.15 * (3 if c[4] == 1 else 1)
                for t, ax, ar, _, _ in adds:
                    y = face_at(ph + t / PERIOD) + ar + 0.02
                    if any(math.hypot(ax - bx, y - by) < BELL_R + ar * 0.5 for bx, by in BELLS):
                        v += 0.8
                        break
            v += random.uniform(0, 0.05)
            if v > best_v:
                best, best_v = (round(x, 3), round(ph, 3)), v
        return best

    def bot_turn(self, p):
        i = self.seat(p)
        x, ph = self.plan(i, p.bot)     # (drop() already held this bot back until the last coins settled)
        self.drop(i, x, ph)

    def bot_ready(self):
        if self.room.turn is None:
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the arcade.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if r.turn == p.id:
            if any(self.left[k] > 0 and self.present(k) for k in range(len(self.seats))):
                r.advance()
            else:
                r.turn = None
                r.deadline = time.time() + 1.0

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "points"):
            return ""
        return f"🪙 {self.points[i]} · {self.left[i]} left"

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"pusher": {
            "seats": self.seats, "me": self.seat(p), "coins": [[c[0], round(c[1], 3), round(c[2], 3), c[3], c[4]] for c in self.coins],
            "points": self.points, "left": self.left, "stars": self.stars, "guard": self.guard, "mega": self.mega,
            "shot": self.shot, "busy": round(max(0.0, self.busy_until - now), 2), "drops": self.drops,
            "geo": {"hw": HW, "edge": EDGE, "face": FACE, "period": PERIOD, "gapY": GAP_Y, "r": R_COIN, "rMega": R_MEGA,
                    "bells": BELLS, "bellR": BELL_R, "simT": SIM_T, "spread": SPREAD, "gapT": GAP_T},
        }}
