"""Rift Split: an original take on the classic "wall in the bouncing balls" puzzle-arcade genre.

Every player has their own glowing field with bouncing orbs. Tap a spot to grow a wall from it in both
directions (horizontal or vertical). A wall half that an orb strikes while it is still growing shatters and costs a
life; a half that reaches a barrier locks in. When the wall is done, every pocket with no orb inside is sealed off.
Seal the goal % of the field to clear the level. The server owns the physics (fixed grid, circle-vs-cell collisions)
and streams each field to every browser."""
import math
import random
import time
from uuid import uuid4

from .base import Game, GameError

W, H = 40, 24
GOAL = 0.75        # kept for the layout default; the real target climbs with the level


def level_goal(level):
    return min(0.85, 0.50 + 0.015 * level)   # L1 52%, L5 58%, L10 65%, L20 80%, L24+ 85%: a slow climb


def orb_count(level):
    return min(MAX_ORBS, 2 + (level - 1) // 3)   # an extra orb every 3 levels: 2,2,2,3,3,3,... cap at L28


def start_lives(level):
    return min(MAX_LIVES, 3 + (level - 1) // 3)   # 3 lives at L1, one more every 3 levels, cap 6 at L10
RADIUS = 0.42
GROW = 15.0              # wall cells per second at level 1


def grow_speed(level):
    return max(8.0, GROW - 0.4 * (level - 1))   # walls extend slower each level, so they stay exposed longer (floor 8 from L19)
STEP = 1 / 60
CLEAR_PAUSE = 2.6
SLOW_SECS, SLOW_FACTOR = 8.0, 0.45
MAX_LEVEL = 99
MAX_LIVES = 6
MAX_WALLS = 2       # two walls may grow at once, on lines that don't cross
MAX_SPEED = 11.0
MAX_ORBS = 11       # late stages stay readable: orbs and starting lives stop growing
NEAR = 0.8          # an orb this close to a growing tip (cells) counts as a near miss
CLOSE_BONUS = 25
HOLD_SECS = 2.1     # a 3-2-1 before every level, orbs frozen
BOT = {"easy": (1.6, 2), "normal": (0.9, 8), "hard": (0.6, 22)}   # seconds between walls, candidates to simulate


def ball_speed(level):
    if 1 <= level <= 3:
        return (4.9, 5.7, 6.5)[level - 1]
    return min(MAX_SPEED, 6.5 + 0.25 * (level - 3))   # +0.25 per level, cap at L21


class Board:
    def __init__(self, rng, level=1, score=0):
        self.rng = rng
        self.score = score
        self.rev = 0
        self.sent = -1
        self.sim = False
        self.streak = 0
        self.shield = 0
        self.slow_until = 0.0
        self.event = ""
        self.event_id = 0
        self.state = "play"
        self.until = 0.0
        self.bot_at = 0.0
        self.departed = False
        self.setup(level)

    # ----- level setup -----
    def setup(self, level):
        self.level = level
        self.lives = start_lives(level)
        self.hold = 0.0
        self.holding = False
        self.grid = [bytearray(W) for _ in range(H)]
        self.filled = 0
        self.walls = []
        self.state = "play"
        speed = ball_speed(level)
        self.grow = grow_speed(level)
        self.balls = []
        for _ in range(orb_count(level)):
            ang = self.rng.uniform(0.35, 1.2) + self.rng.choice((0, 1.57, 3.14, 4.71))
            vx, vy = speed * math.cos(ang), speed * math.sin(ang)
            self.balls.append([self.rng.uniform(2, W - 2), self.rng.uniform(2, H - 2), vx, vy])
        self.pickups = []
        kinds = ("slow", "shield") if level < 9 else (("slow",) if level % 2 else ("shield",))   # fewer power-ups from L9
        for kind in kinds:
            self.pickups.append([self.rng.randrange(3, W - 3), self.rng.randrange(3, H - 3), kind])
        if level >= 5 and level % 2:   # a heart to seal in, worth a life back, every other level
            self.pickups.append([self.rng.randrange(3, W - 3), self.rng.randrange(3, H - 3), "heart"])
        self.rev += 1

    @property
    def pct(self):
        return self.filled / (W * H)

    def emit(self, name):
        self.event = name
        self.event_id += 1

    # ----- collisions -----
    def solid(self, x, y):
        cx, cy = int(x // 1), int(y // 1)
        return not (0 <= cx < W and 0 <= cy < H) or bool(self.grid[cy][cx])

    def blocked(self, x, y, r=RADIUS):
        return (self.solid(x - r, y - r) or self.solid(x + r, y - r)
                or self.solid(x - r, y + r) or self.solid(x + r, y + r))

    def move_ball(self, b, dt):
        stuck = self.blocked(b[0], b[1])
        nx = b[0] + b[2] * dt
        if not stuck and self.blocked(nx, b[1]):
            b[2] = -b[2]
        else:
            b[0] = nx
        ny = b[1] + b[3] * dt
        if not stuck and self.blocked(b[0], ny):
            b[3] = -b[3]
        else:
            b[1] = ny

    # ----- walls -----
    def free(self, cx, cy):
        return 0 <= cx < W and 0 <= cy < H and not self.grid[cy][cx]

    def line_cells(self):
        """Cells on the lines of walls that are still growing: a second wall may not cross them."""
        occ = set()
        for w in self.walls:
            for half in w["h"]:
                occ.update(self.half_cells(w, half))
        return occ

    def can_place(self, cx, cy):
        return (self.state == "play" and not self.holding and len(self.walls) < MAX_WALLS and self.free(cx, cy)
                and (cx, cy) not in self.line_cells())

    def place(self, cx, cy, vertical):
        if not self.can_place(cx, cy):
            return False
        halves = []
        occ = self.line_cells()
        for d in (-1, 1):
            n = 0
            while True:
                k = (cy if vertical else cx) + (-n if d < 0 else n + 1)
                cell = (cx, k) if vertical else (k, cy)
                if not self.free(*cell) or cell in occ:
                    break
                n += 1
            halves.append({"d": d, "room": n, "len": 0.0, "st": "grow" if n else "done"})
        self.walls.append({"v": bool(vertical), "cx": cx, "cy": cy, "h": halves})
        return True

    def half_rect(self, w, half):
        c = w["cy"] if w["v"] else w["cx"]
        lo, hi = (c + 1 - half["len"], c + 1) if half["d"] < 0 else (c + 1, c + 1 + half["len"])
        return (w["cx"], w["cx"] + 1, lo, hi) if w["v"] else (lo, hi, w["cy"], w["cy"] + 1)

    def half_cells(self, w, half):
        c = w["cy"] if w["v"] else w["cx"]
        for i in range(half["room"]):
            k = c - i if half["d"] < 0 else c + 1 + i
            yield (w["cx"], k) if w["v"] else (k, w["cy"])

    def step_wall(self, w, dt):
        for half in w["h"]:
            if half["st"] != "grow":
                continue
            half["len"] = min(half["room"], half["len"] + self.grow * dt)
            rx0, rx1, ry0, ry1 = self.half_rect(w, half)
            for b in self.balls:
                if rx0 - RADIUS < b[0] < rx1 + RADIUS and ry0 - RADIUS < b[1] < ry1 + RADIUS:
                    half["st"] = "dead"
                    self.hit()
                    break
            else:
                if not self.sim and half["len"] < half["room"] and any(
                        rx0 - RADIUS - NEAR < b[0] < rx1 + RADIUS + NEAR and ry0 - RADIUS - NEAR < b[1] < ry1 + RADIUS + NEAR
                        for b in self.balls):
                    w["near"] = True   # an orb grazed the growing tip and missed
                if half["len"] >= half["room"]:
                    for x, y in self.half_cells(w, half):
                        if not self.grid[y][x]:   # another wall's seal may have filled it already
                            self.grid[y][x] = 1
                            self.filled += 1
                    half["st"] = "done"
        if all(h["st"] != "grow" for h in w["h"]):
            self.walls.remove(w)
            before = self.event_id
            self.seal()
            if w.get("near") and not self.sim and self.event == "seal" and self.event_id != before \
                    and all(h["st"] == "done" for h in w["h"]):
                self.score += CLOSE_BONUS   # a close call that still sealed: small bonus and a callout
                self.emit("close")

    def hit(self):
        self.streak = 0
        if self.sim:
            self.lost = True
            return
        if self.shield:
            self.shield = 0
            self.emit("shield")
        else:
            self.lives -= 1
            self.emit("hit")

    def seal(self):
        """Fill every pocket that holds no orb. Returns how many cells were sealed."""
        seen = [bytearray(W) for _ in range(H)]
        keep = {(int(b[1] // 1), int(b[0] // 1)) for b in self.balls}
        sealed = []
        for sy in range(H):
            for sx in range(W):
                if self.grid[sy][sx] or seen[sy][sx]:
                    continue
                region, stack, alive = [], [(sy, sx)], False
                seen[sy][sx] = 1
                while stack:
                    y, x = stack.pop()
                    region.append((y, x))
                    alive = alive or (y, x) in keep
                    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= ny < H and 0 <= nx < W and not self.grid[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = 1
                            stack.append((ny, nx))
                if not alive:
                    sealed.extend(region)
        for y, x in sealed:
            self.grid[y][x] = 1
        self.filled += len(sealed)
        self.captured = len(sealed)
        if sealed and not self.sim:
            self.rev += 1
            self.streak += 1
            mult = min(5, 1 + self.streak // 2)
            self.score += len(sealed) * 10 * mult
            if len(sealed) >= (150 if self.level < 9 else 200) and self.lives < MAX_LIVES:   # a giant seal earns a life back
                self.lives += 1
                self.emit("life")
            else:
                self.emit("big" if len(sealed) >= 90 else "seal")
        elif sealed:
            self.rev += 1
        if not self.sim:
            self.collect()
        return len(sealed)

    def collect(self):
        """A pickup is yours once its cell is solid: sealed in, or under the wall line itself."""
        for p in list(self.pickups):
            if self.grid[p[1]][p[0]]:
                self.pickups.remove(p)
                if p[2] == "heart":
                    self.lives = min(MAX_LIVES, self.lives + 1)
                    self.emit("life")
                elif p[2] == "shield":
                    self.shield = 1
                    self.emit("shield+")
                else:
                    self.slow_until = time.time() + SLOW_SECS
                    self.emit("slow")

    # ----- clock -----
    def step(self, dt, now):
        if self.state != "play":
            return
        if not self.sim and now < self.hold:
            self.holding = True
            return
        self.holding = False
        scale = SLOW_FACTOR if now < self.slow_until else 1.0
        for b in self.balls:
            self.move_ball(b, dt * scale)
        for w in list(self.walls):
            if self.state == "play":
                self.step_wall(w, dt)
        if self.lives <= 0:
            self.state = "over"
            self.walls = []
            self.emit("over")
        elif self.pct >= level_goal(self.level):
            self.state = "clear"
            self.walls = []
            self.until = now + CLEAR_PAUSE
            self.score += 500 * self.level + 250 * self.lives + max(0, int((self.pct - level_goal(self.level)) * 100)) * 40   # overshoot bonus: every % past the goal
            self.emit("clear")

    def next_level(self, now=0.0):
        self.setup(self.level + 1)
        self.hold = now + HOLD_SECS

    # ----- bots -----
    def probe(self, cx, cy, vertical):
        """Dry-run a wall at (cx, cy): returns cells it would seal, or -1 if an orb breaks it."""
        sim = Board.__new__(Board)
        sim.__dict__ = dict(self.__dict__)
        sim.sim = True
        sim.holding = False
        sim.lost = False
        sim.grid = [bytearray(r) for r in self.grid]
        sim.balls = [list(b) for b in self.balls]
        sim.walls = []
        sim.captured = 0
        if not sim.place(cx, cy, vertical):
            return -1
        for _ in range(600):
            sim.step(STEP, 0.0)
            if sim.lost:
                return -1
            if not sim.walls:
                break
        return sim.captured

    def bot_move(self, level):
        """Choose a wall: sample candidates and keep the one that seals the most without a hit."""
        _, tries = BOT[level]
        spots = [(x, y) for _ in range(max(tries, 1) * 3) for x, y in [(self.rng.randrange(W), self.rng.randrange(H))]
                 if self.free(x, y)]
        if not tries:
            x, y = spots[0] if spots else (W // 2, H // 2)
            return self.place(x, y, self.rng.random() < 0.5)
        best, best_score = None, 0
        for x, y in spots[:tries]:
            v = self.rng.random() < 0.5
            got = self.probe(x, y, v)
            if got > best_score:
                best, best_score = (x, y, v), got
        if best:
            return self.place(*best)
        return False

    # ----- wire format -----
    def grid_str(self):
        return "".join("".join("1" if c else "0" for c in row) for row in self.grid)

    def public(self, now, full=False):
        def wire(w):
            return [int(w["v"]), w["cx"], w["cy"]] + [v for h in w["h"] for v in (round(h["len"], 2), h["room"], "x" if h["st"] == "dead" else h["st"][0])]
        walls = wire(self.walls[0]) if self.walls else []
        walls2 = wire(self.walls[1]) if len(self.walls) > 1 else []
        out = {"lv": self.level, "lives": self.lives, "score": self.score, "pct": round(self.pct, 4), "goal": level_goal(self.level), "st": self.state,
               "b": [[round(b[0], 2), round(b[1], 2)] for b in self.balls], "w": walls, "w2": walls2,
               "p": self.pickups, "gr": self.grow, "mu": min(5, 1 + self.streak // 2), "hd": max(0, round(self.hold - now, 1)), "sh": self.shield, "slow": max(0, round(self.slow_until - now, 1)),
               "ev": [self.event_id, self.event], "rev": self.rev}
        if full:
            out["g"] = self.grid_str()
        return out


class RiftSplit(Game):
    id = "riftsplit"
    name = "Rift Split"
    category = "action"
    icon = "🔷"
    min_players, max_players = 1, 6
    replayable = False
    blurb = "Grow glowing walls to wall in the bouncing orbs. Seal enough of the field before they break your wall."
    howto = [
        "Press and hold a spot to preview the line, slide to aim, and let go to grow a wall both ways from it (click on a computer). Tap the ↔ / ↕ buttons, press Space, or right-click to switch direction. You can start a second wall while the first is still growing.",
        "While a wall is growing (you can have two at once, on lines that don't cross), an orb that touches either half shatters that half and costs a life. A half that reaches a barrier locks in solid.",
        "When a wall finishes, every pocket with no orb inside is sealed. Seal the goal % of the field (it rises slowly each level, from 52%) to clear the level; each level adds an orb, and a life.",
        "Chain clean seals for a score multiplier. Seal a 🛡️ to block one hit, or a ⏳ to slow every orb for a few seconds. Everyone plays their own field; the highest score wins.",
    ]

    def start(self, seated, rng):
        self.rng = rng
        self.boards = {p.id: Board(random.Random(rng.random())) for p in seated}
        self.run = uuid4().hex
        self.frames = 0
        self.last = time.time()
        for b in self.boards.values():
            b.hold = self.last + HOLD_SECS
        self.solo = len(seated) == 1 and not seated[0].bot
        self.room.turn = self.room.deadline = None

    def on_input(self, p, a):
        board = self.boards.get(p.id)
        if board is None or p.eliminated:
            raise GameError("You're watching this game.")
        x, y, v = a.get("x"), a.get("y"), a.get("v")
        if type(x) is not int or type(y) is not int or type(v) is not bool:
            raise GameError("Invalid wall.")
        board.place(x, y, v)

    def frame(self, now):
        dt = min(0.05, max(0.0, now - self.last))
        self.last = now
        steps = max(1, round(dt / STEP))
        for pid, board in self.boards.items():
            if board.departed:
                continue
            player = self.room.players.get(pid)
            for _ in range(steps):
                board.step(dt / steps, now)
            if board.state == "clear" and now >= board.until:
                board.next_level(now)
            if player and player.bot and board.state == "play" and not board.walls and now >= board.bot_at:
                board.bot_move(player.bot if player.bot in BOT else "normal")
                board.bot_at = now + BOT[player.bot if player.bot in BOT else "normal"][0]
        self.frames += 1
        if self.complete():
            return True
        if self.frames % 2 == 0:
            self.room.push_fast(self.snapshot(now))
            for b in self.boards.values():
                b.sent = b.rev
        return False

    def complete(self):
        live = [(pid, b) for pid, b in self.boards.items() if not b.departed and pid in self.room.players]
        if any(b.state != "over" for _, b in live):
            return False
        if not live:
            self.room.finish(None, "Everyone left.")
            return True
        best = max(b.score for _, b in live)
        winners = [self.room.players[pid] for pid, b in live if b.score == best]
        if len(winners) == 1:
            who = winners[0]
            self.room.finish(who, f"{who.name} scores {best:,}!" if self.solo else f"{who.name} wins with {best:,}!")
        else:
            self.room.finish(None, f"Tied at {best:,}!", draw=True)
        return True

    def on_leave(self, p):
        board = self.boards[p.id]
        board.departed = p.eliminated = True
        self.complete()

    def final_scores(self):
        return {pid: b.score for pid, b in self.boards.items() if not b.departed}

    def meta(self, p):
        b = getattr(self, "boards", {}).get(p.id)
        return f"Lv {b.level} · {b.score:,}" if b else ""

    def snapshot(self, now, full=False):
        every = full or self.frames % 30 == 0
        return {"rift": self.run, "tick": self.frames,
                "boards": {pid: b.public(now, every or b.rev != b.sent) for pid, b in self.boards.items() if not b.departed}}

    def view(self, p):
        board = self.boards.get(p.id)
        return {"riftsplit": {**self.snapshot(time.time(), True), "layout": {"w": W, "h": H, "goal": GOAL},
                              "solo": self.solo, "me": p.id if board and not board.departed else None}}
