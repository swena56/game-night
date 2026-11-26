"""Light Riders: an original light-cycle game. Every rider moves forward constantly and leaves a
solid wall of light behind them. Hit a wall, any trail, or another rider head-on and you're out;
the last rider riding wins the round. First to the target number of rounds wins.

🐍 Snake mode (the "mode" setting) plays on the same grid: every rider is a snake that eats orbs to grow.
Its own body is safe to cross, running into another snake kills it (its body spills into orbs), and the
arena edge only turns it. A round ends with one snake left, or on the clock, when the longest one wins.

Server-side and tick-based: frame(now) (called at 60 fps) advances the grid at the arena's tick
rate. Turns arrive through on_input (queued, so quick double turns work) and positions stream to
browsers over the room's fast channel."""
import math
import random
import time
from collections import deque

from .base import Game, GameError

DIRS = [(0, -1), (1, 0), (0, 1), (-1, 0)]  # up, right, down, left (screen directions)
COUNTDOWN, ROUND_PAUSE = 3.0, 2.8
BOOSTS, BOOST_TICKS = 3, 12
BRAKES, BRAKE_TICKS = 2, 10  # one-shot slow turn: move on alternate server ticks, then it ends
GRIND_FULL = 25    # ticks spent riding right beside a wall or trail that earn a boost back
RESPAWN = 1.5      # seconds between a crash and riding again, while lives remain
GHOST_TICKS = 2    # a respawned rider holds still this long so everyone sees it appear
SYNC_EVERY = 3.0   # seconds between full-view resyncs while riding
TAIL = 6           # recent cells per rider in each fast update (covers missed updates and boosts)


SHRINK_AFTER, SHRINK_EVERY = 60, 2.5  # 🧱 closing arena: seconds of riding before the walls move, then a ring this often
# 🎁 power-ups (#80): the first appears this long after GO, then one more every ITEM_EVERY s, up to ITEM_MAX on the grid
ITEM_FIRST, ITEM_EVERY, ITEM_MAX = 3.0, 4.0, 3
SLOW_TICKS = 40    # 🐌: rivals move every other tick for this many ticks (4 s at normal speed)
# 🐍 Snake mode
SNAKE_START, SNAKE_MAX = 8, 150  # body length in cells: at the start (and after a respawn), and the most it grows
SNAKE_ROUND = 120  # seconds of riding; then the longest living snake takes the round
ORB_GROW, DROP_GROW = 2, 1  # length gained: a scattered orb, an orb spilled by a dead snake
ORB_AREA = 45      # one scattered orb is kept on the grid for every this many cells
ITEMS = {  # kind: (icon, what the log says it did)
    "bolt": ("⚡", "boosts refilled"),
    "slow": ("🐌", "everyone else crawls for a moment"),
    "life": ("❤️", "an extra life"),
    "cut": ("✂️", "half their trail vanishes"),
}

class Riders(Game):
    id = "riders"
    solo_bots = 3
    category = "action"
    howto = [
        "Your light bike never stops, and leaves a wall of light behind it.",
        "Swipe, use the arrows or the arrow keys to turn. Don't hit any wall — yours included.",
        "⚡ Boost (3 per round) doubles your speed for a moment. Ride right beside a wall or trail to grind a boost back.",
        f"🛑 Brake ({BRAKES} per round) moves you at half speed for {BRAKE_TICKS} ticks; tap it before a tight turn. It can't be held on.",
        "Crash with lives left and your trail vanishes — you respawn in open space a moment later.",
        "Last rider with lives left wins the round. First to the target wins the match.",
        f"🐍 Snake mode: eat orbs to grow. Crossing yourself is safe, running into another snake is not, and the edge just turns you. "
        f"After {SNAKE_ROUND // 60} minutes the longest snake takes the round.",
    ]
    name = "Light Riders"
    icon = "🏍️"
    blurb = "Neon light-bike duels. Box your rivals in, grind trails for boosts — or play 🐍 Snake and eat orbs to grow."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "mode": ("Mode", [("cycles", "🏍️ Light cycles"), ("snake", "🐍 Snake: eat orbs to grow, only other snakes kill")], "cycles"),
        "target": ("Rounds to win", [(3, "3"), (2, "2"), (5, "5")], 3),
        "arena": ("Arena", [(44, "Medium"), (32, "Small"), (60, "Large")], 44),
        "speed": ("Speed", [(10, "Normal"), (7, "Chill"), (14, "Fast")], 10),
        "lives": ("Lives", [(3, "3"), (1, "1 (classic)"), (5, "5")], 3),
        "shrink": ("🧱 Closing arena (light cycles)", [(False, "Off"), (True, f"On: after {SHRINK_AFTER} s the walls close in")], False),
        "catchup": ("👑 Leader's cost", [(True, "On: leader starts 1 ⚡ short"), (False, "Off")], True),
        "pickups": ("🎁 Power-ups (light cycles)", [(False, "Off"), (True, "On: grab ⚡ boosts, 🐌 slow-mo, ❤️ lives and ✂️ trail cuts")], False),
    }

    snake = False  # 🐍 Snake mode, fixed when the match starts

    def walled(self, x, y):
        """Inside the band the 🧱 closing arena has already walled off."""
        ring = getattr(self, "ring", 0)
        return ring > 0 and min(x, y, self.n - 1 - x, self.n - 1 - y) < ring

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.snake = self.s.get("mode") == "snake"
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.n = self.s["arena"]
        self.wins = [0] * len(seated)
        self.round = 0
        self.stage = "countdown"
        self.room.turn = None
        self.room.deadline = None
        who = f"🐍 {len(seated)} snakes" if self.snake else f"🏍️ {len(seated)} riders"
        self.room.add_log(f"{who} enter the grid. First to {self.s['target']} rounds wins.", "big")
        self.new_round(time.time())

    def new_round(self, now):
        n, k = self.n, len(self.seats)
        self.round += 1
        self.grid = bytearray(n * n)  # 0 empty, else seat + 1
        self.trails = [[] for _ in range(k)]
        self.alive = [True] * k
        self.dirs, self.queue = [0] * k, [deque() for _ in range(k)]
        self.boosts, self.boosting = [BOOSTS] * k, [0] * k
        self.brakes, self.braking = [BRAKES] * k, [0] * k
        self.lives = [self.s.get("lives", 3)] * k
        if self.s.get("catchup", True):
            top = max(self.wins)
            if top > 0 and self.wins.count(top) == 1:  # 👑 a lone leader pays a boost for the crown
                i = self.wins.index(top)
                self.boosts[i] = BOOSTS - 1
                p = self.room.players.get(self.seats[i])
                if p:
                    self.moment(f"👑 {p.name} leads and starts round {self.round} one boost short", "cool")
        self.respawn_at, self.ghost, self.grind = [None] * k, [0] * k, [0] * k
        self.tick = 0
        self.ring, self.ride_at = 0, None
        self.items, self.item_at, self.slow, self.grabs = {}, None, [0] * k, []
        self.won = None  # who took the round once it's over (-1: a draw)
        self.orbs = {}  # 🐍 cell -> length it's worth
        self.size = [SNAKE_START] * k  # 🐍 how long each snake is allowed to be
        self.own = [0] * (n * n)  # 🐍 body segments on each cell: a snake can lie across itself
        self.seq = [0] * k  # 🐍 cells ever added per snake, so browsers can follow a body that repeats cells
        # spread riders round a circle, each facing the nearest axis toward the centre
        offset = self.rng.random() * 6.283
        for i in range(k):
            a = offset + 6.283 * i / k
            x = int(n / 2 + math.cos(a) * n * 0.36)
            y = int(n / 2 + math.sin(a) * n * 0.36)
            dx, dy = n / 2 - x, n / 2 - y
            self.dirs[i] = (1 if dx > 0 else 3) if abs(dx) > abs(dy) else (2 if dy > 0 else 0)
            self.occupy(i, x, y)
        if self.snake:
            self.spawn_orbs(self.orb_target())
        self.stage = "countdown"
        self.next_at = now + COUNTDOWN
        self.synced = now
        self.last_frame = now
        self.acc = 0.0
        self.sent = None
        self.room.add_log(f"🔵 Round {self.round} — get ready!")

    def occupy(self, i, x, y):
        c = y * self.n + x
        self.grid[c] = i + 1
        self.trails[i].append(c)
        if self.snake:
            return self.slither(i, c)
        kind = self.items.pop(c, None) if getattr(self, "items", None) else None
        if kind:
            self.grab(i, kind)

    # -- 🐍 Snake mode

    def slither(self, i, c):
        """The head has just moved onto c: eat any orb there, then draw the tail in to the snake's length."""
        self.own[c] += 1
        self.seq[i] += 1
        self.size[i] = min(SNAKE_MAX, self.size[i] + self.orbs.pop(c, 0))
        t = self.trails[i]
        while len(t) > self.size[i]:
            old = t.pop(0)
            self.own[old] -= 1
            if not self.own[old]:
                self.grid[old] = 0

    def orb_target(self):
        return self.n * self.n // ORB_AREA

    def spawn_orbs(self, most):
        """Scatter up to `most` orbs on open cells, while the grid has fewer than its share."""
        cells = self.n * self.n
        most = min(most, self.orb_target() - len(self.orbs))
        for _ in range(max(0, most) * 4):
            if most <= 0:
                break
            c = self.rng.randrange(cells)
            if not self.grid[c] and c not in self.orbs:
                self.orbs[c] = ORB_GROW
                most -= 1

    def spill(self, i):
        """A dead snake leaves the grid, and every other cell of its body turns into an orb."""
        body = list(dict.fromkeys(self.trails[i]))
        for c in body:
            self.grid[c] = 0
            self.own[c] = 0
        for c in body[::2]:
            if len(self.orbs) >= 2 * self.orb_target():
                break
            self.orbs[c] = max(DROP_GROW, self.orbs.get(c, 0))
        self.trails[i] = []

    def inside(self, x, y):
        return 0 <= x < self.n and 0 <= y < self.n

    def blocked(self, c, i):
        """🐍 True if snake i dies moving onto c: only another snake's body does that."""
        return self.grid[c] not in (0, i + 1)

    def edge_turn(self, i, was):
        """🐍 The edge doesn't kill. A snake about to leave the grid keeps its old heading if that's
        still inside, or turns along the edge (away from other snakes, toward the roomier side)."""
        head, d = self.trails[i][-1], self.dirs[i]
        x, y = head % self.n, head // self.n
        if self.inside(x + DIRS[d][0], y + DIRS[d][1]):
            return d
        options = []
        for o in (was, (was + 1) % 4, (was + 3) % 4):
            xx, yy = x + DIRS[o][0], y + DIRS[o][1]
            if self.inside(xx, yy):
                ahead = sum(self.inside(x + DIRS[o][0] * k, y + DIRS[o][1] * k) for k in range(1, self.n))
                options.append((not self.blocked(yy * self.n + xx, i), o == was, ahead, o))
        return max(options)[3]

    def time_up(self, now):
        """🐍 The round clock ran out: the longest living snake takes it (lives break a tie)."""
        ranked = sorted(((self.size[i], self.lives[i], i) for i in range(len(self.seats)) if self.alive[i]), reverse=True)
        best = ranked[0][2] if ranked and (len(ranked) == 1 or ranked[0][:2] != ranked[1][:2]) else None
        self.room.add_log("⏱️ Time's up!", "power")
        self.end_round(best, now, f" with a length of {self.size[best]}" if best is not None else "")

    def time_left(self, now):
        if not self.snake:
            return None
        ride_at = getattr(self, "ride_at", None)
        return SNAKE_ROUND if ride_at is None else max(0.0, SNAKE_ROUND - (now - ride_at))

    # -- 🎁 power-ups

    def grab(self, i, kind):
        if kind == "bolt":
            self.boosts[i] = BOOSTS
        elif kind == "slow":
            for j in range(len(self.seats)):
                if j != i and self.alive[j]:
                    self.slow[j] = SLOW_TICKS
        elif kind == "life":
            self.lives[i] = min(self.lives[i] + 1, self.s.get("lives", 3) + 2)
        elif kind == "cut":
            t = self.trails[i]
            k = len(t) // 2 if len(t) >= 8 else 0
            for c in t[:k]:
                self.grid[c] = 0
            self.trails[i] = t[k:]
        self.grabs = (self.grabs + [[self.tick, i, kind]])[-6:]
        p = self.room.players.get(self.seats[i])
        icon, what = ITEMS[kind]
        self.room.add_log(f"{icon} {p.name if p else '?'} grabbed {icon}: {what}!", "power")

    def spawn_item(self, now):
        """Drop a power-up on an open cell away from every rider's head."""
        n = self.n
        heads = [self.trails[j][-1] for j in range(len(self.seats)) if self.alive[j] and self.trails[j]]
        for _ in range(40):
            x, y = self.rng.randrange(2, n - 2), self.rng.randrange(2, n - 2)
            c = y * n + x
            if self.grid[c] or c in self.items or self.walled(x, y) or min(x, y, n - 1 - x, n - 1 - y) < self.ring + 2:
                continue
            if any(abs(h % n - x) + abs(h // n - y) < 6 for h in heads):
                continue
            # boosts and slow-mo turn up most; lives only matter with lives to lose
            kinds = ["bolt", "bolt", "slow", "slow", "cut", "cut", "life"]
            self.items[c] = self.rng.choice(kinds)
            return True
        return False

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- input

    def act(self, p, a):
        raise GameError("Steer with swipes, the arrows or the arrow keys.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        if a.get("boost") is True:
            self.start_boost(i)
        if a.get("brake") is True:
            self.start_brake(i)
        d = a.get("dir")
        if d is None:
            return
        if d not in (0, 1, 2, 3):
            raise GameError("Bad direction.")
        q = self.queue[i]
        last = q[-1] if q else self.dirs[i]
        if d != last and d != (last + 2) % 4 and len(q) < 3:  # no U-turns into your own trail
            q.append(d)

    def start_boost(self, i):
        if self.stage == "ride" and self.alive[i] and self.boosts[i] > 0 and not self.boosting[i] and not self.braking[i]:
            self.boosts[i] -= 1
            self.boosting[i] = BOOST_TICKS

    def start_brake(self, i):
        if self.stage == "ride" and self.alive[i] and self.brakes[i] > 0 and not self.braking[i]:
            self.brakes[i] -= 1
            self.braking[i] = BRAKE_TICKS
            self.boosting[i] = 0

    # -- simulation

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view (round changes, crashes)."""
        dt = min(0.25, max(0.0, now - self.last_frame))
        self.last_frame = now
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "ride"
                self.acc = 0.0
                self.ride_at = now
                return True
            return False
        if self.stage == "over":
            if now >= self.next_at:
                self.new_round(now)
                return True
            return False
        changed = False
        for i, at in enumerate(self.respawn_at):
            if at is not None and now >= at:
                changed |= self.respawn(i)
        if self.s.get("shrink") and not self.snake and getattr(self, "ride_at", None):  # 🧱 a ring closes every few seconds
            ring = min(self.n // 2 - 4, max(0, int((now - self.ride_at - SHRINK_AFTER) // SHRINK_EVERY) + 1))
            if ring > self.ring:
                if not self.ring:
                    self.room.add_log("🧱 The arena is closing in!", "power")
                self.ring = ring
                changed = True
        if self.s.get("pickups") and not self.snake and self.ride_at:
            if self.item_at is None:
                self.item_at = self.ride_at + ITEM_FIRST
            if now >= self.item_at:
                self.item_at = now + ITEM_EVERY
                if len(self.items) < ITEM_MAX and self.spawn_item(now):
                    changed = True
            for c in [c for c in self.items if self.walled(c % self.n, c // self.n)]:
                del self.items[c]
        self.acc += dt * self.s["speed"]
        while self.acc >= 1 and self.stage == "ride":
            self.acc -= 1
            changed |= self.step(now)
        if self.snake and self.stage == "ride" and self.time_left(now) <= 0:
            self.time_up(now)
            changed = True
        if self.stage == "ride" and now - self.synced > SYNC_EVERY:
            self.synced = now
            changed = True
        # only when the grid moved: sending every 60 fps frame flooded each browser with ~50 updates a
        # second at 6 riders, each one redrawing the side panel and re-uploading every trail (#32)
        if (self.tick, self.stage) != self.sent:
            self.sent = (self.tick, self.stage)
            self.broadcast(now)
        return changed

    def step(self, now):
        """One tick: bots decide, turns apply, riders move (boosts can move twice; braking skips alternate ticks)."""
        self.tick += 1
        braking = {i for i in range(len(self.seats)) if self.braking[i] > 0}
        for i in braking:
            self.braking[i] -= 1
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if self.alive[i] and p and p.bot:
                (self.snake_steer if self.snake else self.bot_steer)(i, p.bot)
        was = list(self.dirs)
        for i in range(len(self.seats)):
            if self.queue[i]:
                d = self.queue[i].popleft()
                if not (self.snake and d == (self.dirs[i] + 2) % 4):  # an edge turn can make a queued turn a reversal
                    self.dirs[i] = d
        crashed = set()
        cutter = {}  # crashed rider -> whose trail they hit (✂️ credit)
        holding = {i for i in range(len(self.seats)) if self.ghost[i]}
        for i in holding:
            self.ghost[i] -= 1
        grabbed = len(self.grabs)
        for i in range(len(self.seats)):  # 🐌 slowed riders move on even ticks only
            if self.slow[i]:
                self.slow[i] -= 1
                if self.tick % 2 and self.alive[i]:
                    holding.add(i)
        for sub in range(2):
            movers = [i for i in range(len(self.seats))
                      if self.alive[i] and i not in crashed and i not in holding
                      and ((sub == 0 and (i not in braking or self.tick % 2 == 0))
                           or (sub == 1 and self.boosting[i]))]
            if not movers:
                continue
            targets = {}
            for i in movers:
                hx, hy = divmod(self.trails[i][-1], self.n)[::-1]
                if self.snake:
                    self.dirs[i] = self.edge_turn(i, was[i] if sub == 0 else self.dirs[i])
                    dx, dy = DIRS[self.dirs[i]]
                    c = (hy + dy) * self.n + hx + dx
                    if self.blocked(c, i):
                        crashed.add(i)
                        cutter[i] = self.grid[c] - 1
                    else:
                        targets.setdefault(c, []).append(i)
                    continue
                dx, dy = DIRS[self.dirs[i]]
                x, y = hx + dx, hy + dy
                if not (0 <= x < self.n and 0 <= y < self.n) or self.grid[y * self.n + x] or self.walled(x, y):
                    crashed.add(i)
                    if 0 <= x < self.n and 0 <= y < self.n and self.grid[y * self.n + x] and self.grid[y * self.n + x] - 1 != i:
                        cutter[i] = self.grid[y * self.n + x] - 1
                else:
                    targets.setdefault(y * self.n + x, []).append(i)
            for c, who in targets.items():
                if len(who) > 1:  # head-on into the same cell
                    crashed.update(who)
                    continue
                i = who[0]
                if i not in crashed:
                    self.occupy(i, c % self.n, c // self.n)
        for i in range(len(self.seats)):
            if self.boosting[i]:
                self.boosting[i] -= 1
            elif self.alive[i] and i not in crashed and i not in holding and self.grinding(i):
                self.grind[i] += 1
                if self.grind[i] >= GRIND_FULL:
                    self.grind[i] = 0
                    self.boosts[i] = min(BOOSTS, self.boosts[i] + 1)
        if self.snake:
            self.spawn_orbs(1)
        if not crashed:
            return len(self.grabs) != grabbed  # a grab (✂️ a cut trail): everyone gets a full view
        names = []
        for i in crashed:
            self.alive[i] = False
            self.boosting[i] = self.grind[i] = self.slow[i] = 0
            self.braking[i] = 0
            self.queue[i].clear()
            self.lives[i] -= 1
            p = self.room.players.get(self.seats[i])
            name = p.name if p else "?"
            if self.snake:
                self.spill(i)
            if self.lives[i] > 0:
                for c in self.trails[i]:  # the wreck clears away, freeing its space
                    self.grid[c] = 0
                self.trails[i] = []
                self.respawn_at[i] = now + RESPAWN
                name += f" ({self.lives[i]} ♥ left)"
            else:
                name += " (out)"
            names.append(name)
        self.room.add_log(f"💥 {' and '.join(names)} crashed!", "power")
        for i, k in cutter.items():  # ✂️ whose wall did it
            kp = self.room.players.get(self.seats[k])
            vp = self.room.players.get(self.seats[i])
            if kp and vp and self.alive[k]:
                self.kills = getattr(self, "kills", None) or [0] * len(self.seats)
                self.kills[k] += 1
                self.moment(f"✂️ {kp.name} cut {vp.name} off!", "cool", "crack")
        self.check_round(now)
        return True

    def grinding(self, i):
        """True when the rider's head is right beside a wall or any trail other than the cell it came from.
        🐍 A snake only grinds off other snakes: neither the edge nor its own body can hurt it."""
        t = self.trails[i]
        head, prev = t[-1], (t[-2] if len(t) > 1 else None)
        x, y = head % self.n, head // self.n
        for dx, dy in DIRS:
            xx, yy = x + dx, y + dy
            if not (0 <= xx < self.n and 0 <= yy < self.n):
                if self.snake:
                    continue
                return True
            c = yy * self.n + xx
            if self.blocked(c, i) if self.snake else c != prev and self.grid[c]:
                return True
        return False

    def run(self, c, d):
        """How many empty cells lie straight ahead of c in direction d."""
        k = 0
        while k < self.n and (c := self.free(c, *DIRS[d])) is not None:
            k += 1
        return k

    def respawn(self, i):
        """Bring a crashed rider back in the most open spot away from everyone else. True if it worked."""
        n = self.n
        self.respawn_at[i] = None
        heads = [self.trails[j][-1] for j in range(len(self.seats)) if self.alive[j] and self.trails[j]]
        best, best_score = None, -1
        for _ in range(60):
            c = self.rng.randrange(n * n)
            if self.grid[c] or self.walled(c % n, c // n) or any(abs(h % n - c % n) + abs(h // n - c // n) < 4 for h in heads):
                continue
            score = self.space(c, 200) * 10 + max(self.run(c, d) for d in range(4))
            if score > best_score:
                best, best_score = c, score
        if best is None:  # nowhere open: try any empty cell at all
            empty = [c for c in range(n * n) if not self.grid[c] and not self.walled(c % n, c // n)]
            if not empty:
                self.lives[i] = 0
                self.check_round(time.time())
                return True
            best = self.rng.choice(empty)
        self.dirs[i] = max(range(4), key=lambda d: self.run(best, d))
        self.trails[i] = []
        self.size[i] = SNAKE_START
        self.occupy(i, best % n, best // n)
        self.alive[i] = True
        self.queue[i].clear()
        self.ghost[i] = GHOST_TICKS
        return True

    def check_round(self, now):
        left = [i for i in range(len(self.seats)) if self.alive[i] or self.respawn_at[i] is not None]
        if len(left) > 1:
            return
        self.end_round(left[0] if left else None, now)

    def end_round(self, i, now, how=""):
        """Seat i takes the round (None: a draw)."""
        r = self.room
        self.won = -1 if i is None else i
        if i is not None:
            self.wins[i] += 1
            p = r.players.get(self.seats[i])
            name = p.name if p else "?"
            if self.wins[i] >= self.s["target"]:
                self.stage = "done"
                return r.finish(p, f"🏆 {name} wins the match, {self.wins[i]} rounds to {max([w for j, w in enumerate(self.wins) if j != i] or [0])}!")
            r.add_log(f"🏁 {name} wins round {self.round}{how}!", "big")
        else:
            r.add_log(f"🤝 Round {self.round} is a draw{'' if any(self.alive) else ' — everyone crashed'}.", "big")
        self.respawn_at = [None] * len(self.seats)
        self.stage = "over"
        self.next_at = now + ROUND_PAUSE

    def broadcast(self, now):
        self.room.push_fast({
            "k": self.tick, "st": self.stage, "w": getattr(self, "ring", 0),
            "it": [[c, k] for c, k in getattr(self, "items", {}).items()],
            "sl": [int(x > 0) for x in getattr(self, "slow", [])], "gr": getattr(self, "grabs", []),
            **({"sq": list(self.seq), "sz": list(self.size), "or": [[c, v] for c, v in self.orbs.items()],
                "tl": round(self.time_left(now), 1), "wn": self.won} if self.snake else {}),
            "p": [[len(t), int(self.alive[i]), self.dirs[i], self.boosts[i], int(self.boosting[i] > 0),
                   self.lives[i], self.grind[i], int(self.braking[i] > 0), self.brakes[i], *t[-TAIL:]]
                  for i, t in enumerate(self.trails)],
        })

    # -- bots: steer toward the most open space

    def free(self, c, dx, dy):
        """Cell index one step from c, or None if that's a wall or a trail."""
        x, y = c % self.n + dx, c // self.n + dy
        if 0 <= x < self.n and 0 <= y < self.n and not self.grid[y * self.n + x] and not self.walled(x, y):
            return y * self.n + x
        return None

    def space(self, start, limit):
        """Flood-fill count of empty cells reachable from start (capped)."""
        seen, todo = {start}, [start]
        while todo and len(seen) < limit:
            c = todo.pop()
            for dx, dy in DIRS:
                nxt = self.free(c, dx, dy)
                if nxt is not None and nxt not in seen:
                    seen.add(nxt)
                    todo.append(nxt)
        return len(seen)

    def territory(self, start, rivals):
        """Cells this rider reaches strictly before every rival (simultaneous flood fill from all heads),
        minus the cells rivals reach first. Rivals start a step ahead, which keeps the bot careful."""
        n, grid = self.n, self.grid
        owner = {h: 2 for h in rivals}
        owner[start] = 1
        frontier = [(start, 1)] + [(h, 2) for h in rivals]
        mine = theirs = 0
        while frontier:
            nxt = []
            claim = {}
            for c, who in frontier:
                x, y = c % n, c // n
                for dx, dy in DIRS:
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < n and 0 <= yy < n:
                        cc = yy * n + xx
                        if not grid[cc] and cc not in owner:
                            claim[cc] = who if claim.get(cc, who) == who else 0  # 0 = reached at the same time
            for cc, who in claim.items():
                owner[cc] = who
                if who == 1:
                    mine += 1
                elif who == 2:
                    theirs += 1
                if who:
                    nxt.append((cc, who))
            frontier = nxt
        return mine - theirs

    def bot_steer(self, i, level):
        head, d = self.trails[i][-1], self.dirs[i]
        options = [d, (d + 1) % 4, (d + 3) % 4]
        if level == "easy":
            if random.random() < 0.12:  # easy riders sometimes don't look
                return
            safe = [o for o in options if self.free(head, *DIRS[o]) is not None]
            turns = [o for o in safe if o != d]
            if turns and (d not in safe or random.random() < 0.08):
                self.queue[i].append(random.choice(turns))
            return
        limit = 120 if level == "normal" else 500
        others = [self.trails[j][-1] for j in range(len(self.seats)) if j != i and self.alive[j]]
        best, best_score = d, -1
        two = self.boosting[i] > 0  # boosting covers two cells per tick: both must be free
        for o in options:
            nxt = self.free(head, *DIRS[o])
            if nxt is not None and two:
                nxt = self.free(nxt, *DIRS[o])
            if nxt is None:
                continue
            if level == "hard" and 0 < len(others) <= 2:  # few riders left: fight for territory
                score = self.territory(nxt, others) * 10 + min(self.space(nxt, 40), 40)
            else:
                score = self.space(nxt, limit) * 10
            # don't drive into a cell a rival could also reach next tick (head-on risk)
            for h in others:
                if abs(h % self.n - nxt % self.n) + abs(h // self.n - nxt // self.n) <= 1:
                    score -= 40 if level == "normal" else 100000
            if o == d:
                score += 3  # a little preference for going straight
            if self.items:  # 🎁 a power-up straight ahead is worth a small detour
                c, k = nxt, 0
                while c is not None and k < 10:
                    if c in self.items:
                        score += (30 if level == "normal" else 60) - 2 * k
                        break
                    c, k = self.free(c, *DIRS[o]), k + 1
            if level == "hard" and len(others) == 1:  # in a duel, crowd the rival a bit
                near = min(others, key=lambda h: abs(h % self.n - nxt % self.n) + abs(h // self.n - nxt // self.n))
                score -= (abs(near % self.n - nxt % self.n) + abs(near // self.n - nxt // self.n)) * 0.3
            score += random.uniform(0, 4 if level == "normal" else 1)
            if score > best_score:
                best, best_score = o, score
        if best != d:
            self.queue[i].clear()
            self.queue[i].append(best)
        if level == "hard" and self.boosts[i] and not self.boosting[i] and best_score > 3000 and random.random() < 0.03:
            c, clear = head, 0
            while clear < 8 and (c := self.free(c, *DIRS[best])) is not None:
                clear += 1
            if clear == 8:  # only boost onto an open straight
                self.start_boost(i)

    # -- 🐍 snake bots: stay off other snakes and go for orbs; hard ones forage better and refuse head-on gambles

    def open_to(self, i, start, limit):
        """Flood-fill count of cells snake i could move through from start (its own body included), capped."""
        n = self.n
        seen, todo = {start}, [start]
        while todo and len(seen) < limit:
            c = todo.pop()
            x, y = c % n, c // n
            for dx, dy in DIRS:
                if self.inside(x + dx, y + dy):
                    cc = (y + dy) * n + x + dx
                    if cc not in seen and not self.blocked(cc, i):
                        seen.add(cc)
                        todo.append(cc)
        return len(seen)

    def snake_steer(self, i, level):
        n, head, d = self.n, self.trails[i][-1], self.dirs[i]
        x, y = head % n, head // n
        reach = 2 if self.boosting[i] else 1  # boosting covers two cells per tick: both must be safe

        def gap(a, b):
            return abs(a % n - b % n) + abs(a // n - b // n)

        safe = {}  # heading -> the cell it leads to
        for o in (d, (d + 1) % 4, (d + 3) % 4):
            path = [(x + DIRS[o][0] * k, y + DIRS[o][1] * k) for k in range(1, reach + 1)]
            if self.inside(*path[0]) and not any(self.inside(a, b) and self.blocked(b * n + a, i) for a, b in path):
                safe[o] = path[0][1] * n + path[0][0]
        if not safe:
            return
        food = min(self.orbs, key=lambda c: gap(head, c), default=None)
        if level == "easy":
            if random.random() < 0.12:  # easy snakes sometimes don't look
                return
            if food is not None and random.random() < 0.2:
                best = min(safe, key=lambda o: gap(safe[o], food))
            elif d not in safe or random.random() < 0.08:
                best = random.choice(list(safe))
            else:
                return
        else:
            hard = level == "hard"
            # rival heads, with how far each can get in one tick
            rivals = [(self.trails[j][-1], 2 if self.boosting[j] else 1) for j in range(len(self.seats))
                      if j != i and self.alive[j]]
            if hard and self.orbs:  # the best meal, not just the nearest: clusters count, lost races don't
                def cost(c):
                    cluster = sum(1 for o in self.orbs if gap(o, c) <= 4)
                    beaten = any(gap(h, c) + 1 < gap(head, c) for h, _ in rivals)
                    return gap(head, c) - 2 * min(cluster, 5) + (12 if beaten else 0)
                food = min(self.orbs, key=cost)

            def score(o):
                c = safe[o]
                v = self.open_to(i, c, 150 if hard else 60) * 10
                if any(gap(h, c) <= far for h, far in rivals):  # a rival could reach that cell too
                    v -= 100000 if hard else 40
                if food is not None:
                    v -= gap(c, food) * (3 if hard else 2)
                if c in self.orbs:
                    v += 25
                return v + (3 if o == d else 0) + random.uniform(0, 1 if hard else 6)

            best = max(safe, key=score)
        if best != d:
            self.queue[i].clear()
            self.queue[i].append(best)

    # -- the rest of the contract

    def bot_ready(self):
        return False  # bots steer inside frame()

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} left the grid.")
        if i is not None:
            self.lives[i] = 0
            self.respawn_at[i] = None
            self.alive[i] = False
            if self.snake:
                self.spill(i)
            if self.stage == "ride":
                self.check_round(time.time())
        left = [q for q in r.contenders()]
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🏁 {self.wins[i]}"

    def final_scores(self):
        return {pid: self.wins[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        return {"riders": {
            "n": self.n, "seats": self.seats, "me": self.seat(p), "stage": self.stage, "round": self.round,
            "mode": "snake" if self.snake else "cycles", "won": getattr(self, "won", None),
            **({"orbs": [[c, v] for c, v in self.orbs.items()], "sq": self.seq, "size": self.size,
                "timeLeft": self.time_left(time.time())} if self.snake else {}),
            "ring": getattr(self, "ring", 0), "kills": getattr(self, "kills", None) or [0] * len(self.seats),
            "items": [[c, k] for c, k in getattr(self, "items", {}).items()], "pickups": bool(self.s.get("pickups")) and not self.snake,
            "slow": [int(x > 0) for x in getattr(self, "slow", [0] * len(self.seats))], "grabs": getattr(self, "grabs", []),
            "wins": self.wins, "target": self.s["target"], "speed": self.s["speed"], "tick": self.tick,
            "trails": self.trails, "alive": self.alive, "dirs": self.dirs, "boosts": self.boosts,
            "brakes": self.brakes, "braking": [int(x > 0) for x in self.braking],
            "lives": self.lives, "maxLives": self.s.get("lives", 3), "grind": self.grind, "grindFull": GRIND_FULL,
            "respawning": [None if at is None else max(0.0, at - time.time()) for at in self.respawn_at],
            "countdown": max(0.0, self.next_at - time.time()) if self.stage in ("countdown", "over") else 0,
        }}
