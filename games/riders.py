"""Light Riders: an original light-cycle game. Every rider moves forward constantly and leaves a
solid wall of light behind them. Hit a wall, any trail, or another rider head-on and you're out;
the last rider riding wins the round. First to the target number of rounds wins.

🐍 The same grid also runs Orb Snakes (games/orbsnake.py, `snake = True`): every rider is a snake that eats orbs
to grow. Running into another snake kills it (its body spills into orbs), and so does biting its own neck, the few cells
behind its head; farther back its own body is safe to cross, and
the arena edge only turns it. A round ends with one snake left.

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
ORB_WINDOW = 12    # 🐍 ticks of orb changes each fast update repeats, so a browser that misses a few stays right
TAIL = 6           # recent cells per rider in each fast update (covers missed updates and boosts)


SHRINK_AFTER, SHRINK_EVERY = 60, 2.5  # 🧱 closing arena: seconds of riding before the walls move, then a ring this often
# 🎁 power-ups (#80): the first appears this long after GO, then one more every ITEM_EVERY s, up to ITEM_MAX on the grid
ITEM_FIRST, ITEM_EVERY, ITEM_MAX = 3.0, 4.0, 3
SLOW_TICKS = 40    # 🐌: rivals move every other tick for this many ticks (4 s at normal speed)
# 🐍 Snake mode
SNAKE_START = 8    # body length in cells at the start (and after a respawn); there is no longest
SNAKE_CAP = 600    # not shown (#345: no clock): only to end a round nobody can finish, when the longest snake takes it
NECK = 5           # 🐍 the cells just behind a snake's head: running into your own there costs a life (#347)
BOOST_COST = 4     # a snake's boost is paid in length, dropped behind it as white orbs (never below the start)
# pacing (measure a change with tests/riders_balance.py before keeping it)
CRASH_KEEP = 0     # 🐍 the share of its length a snake comes back with after a crash (never below the start); 0: off, untested
SHIELD = 0         # 🐍 seconds after respawning with no crashing for it or into it; 0: off (untested, and not yet drawn)
EASY_SEEK = 0.2    # how often an easy snake heads for food instead of carrying on
SNAKE_PAUSE = 5.0  # 🐍 between rounds: long enough to read the recap
BOTS_ONLY = 15     # ...and sooner once only computer snakes have lives left: careful bots can circle for ever
ORB_GROW, DROP_GROW = 2, 1  # length gained: a scattered orb, an orb spilled by a dead snake
GOLD_GROW, GOLD_CHANCE, GOLD_MOST = 10, 0.08, 3  # the odd scattered orb is gold, a few on the board at most
ORB_AREA = 45      # one scattered orb is kept on the grid for every this many cells
FIT_MIN, FIT_MAX = 0.65, 2.5  # how tall or wide the board may get to match a screen
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
    ]
    name = "Light Riders"
    icon = "🏍️"
    blurb = "Neon light-bike duels. Box your rivals in and grind trails for boosts."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "target": ("Rounds to win", [(3, "3"), (2, "2"), (5, "5")], 3),
        "arena": ("Arena", [(44, "Medium"), (32, "Small"), (60, "Large")], 44),
        "speed": ("Speed", [(10, "Normal"), (7, "Chill"), (14, "Fast")], 10),
        "lives": ("Lives", [(3, "3"), (1, "1 (classic)"), (5, "5")], 3),
        "shrink": ("🧱 Closing arena", [(False, "Off"), (True, f"On: after {SHRINK_AFTER} s the walls close in")], False),
        "catchup": ("👑 Leader's cost", [(True, "On: leader starts 1 ⚡ short"), (False, "Off")], True),
        "pickups": ("🎁 Power-ups", [(False, "Off"), (True, "On: grab ⚡ boosts, 🐌 slow-mo, ❤️ lives and ✂️ trail cuts")], False),
    }

    snake = False  # 🐍 True in Orb Snakes
    shape = None   # (columns, rows) once the board is fitted to the host's screen; square until then (#345)
    refit = False  # the board changed shape: everyone needs a full view

    @property
    def w(self):
        return self.shape[0] if self.shape else self.n

    @property
    def h(self):
        return self.shape[1] if self.shape else self.n

    def fit(self, aspect):
        """Reshape the board to `aspect` (width / height), keeping about n × n cells, and lay the round out again.
        Only while counting down, so nothing moves under a rider."""
        if self.stage != "countdown":
            return
        a = math.sqrt(min(FIT_MAX, max(FIT_MIN, aspect)))
        shape = (round(self.n * a), round(self.n / a))
        if shape == (self.w, self.h) or max(abs(shape[0] - self.w), abs(shape[1] - self.h)) < 2:
            return
        self.shape = shape
        self.new_round(time.time(), again=True)
        self.refit = True

    def walled(self, x, y):
        """Inside the band the 🧱 closing arena has already walled off."""
        ring = getattr(self, "ring", 0)
        return ring > 0 and min(x, y, self.w - 1 - x, self.h - 1 - y) < ring

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.n = self.s["arena"]
        self.shape = None
        self.wins = [0] * len(seated)
        self.round = 0
        self.stage = "countdown"
        self.room.turn = None
        self.room.deadline = None
        who = f"🐍 {len(seated)} snakes" if self.snake else f"🏍️ {len(seated)} riders"
        self.room.add_log(f"{who} enter the grid. First to {self.s['target']} rounds wins.", "big")
        self.new_round(time.time())

    def new_round(self, now, again=False):
        """Lay out a round. again: the same round on a reshaped board, with the countdown left running."""
        w, h, k = self.w, self.h, len(self.seats)
        starts = self.next_at if again else now + COUNTDOWN
        if not again:
            self.round += 1
        self.grid = bytearray(w * h)  # 0 empty, else seat + 1
        self.trails = [[] for _ in range(k)]
        self.alive = [True] * k
        self.dirs, self.queue = [0] * k, [deque() for _ in range(k)]
        self.boosts, self.boosting = [BOOSTS] * k, [0] * k
        self.brakes, self.braking = [BRAKES] * k, [0] * k
        self.lives = [self.s.get("lives", 3)] * k
        if self.s.get("catchup", True) and not self.snake:
            top = max(self.wins)
            if top > 0 and self.wins.count(top) == 1:  # 👑 a lone leader pays a boost for the crown
                i = self.wins.index(top)
                self.boosts[i] = BOOSTS - 1
                p = self.room.players.get(self.seats[i])
                if p and not again:
                    self.moment(f"👑 {p.name} leads and starts round {self.round} one boost short", "cool")
        self.respawn_at, self.ghost, self.grind = [None] * k, [0] * k, [0] * k
        self.held = [False] * k  # 🐍 a person's snake that has used its last moment on this approach
        self.shield = [0] * k  # 🐍 ticks of protection left after a respawn
        self.prior = [None] * k  # 🐍 each snake's heading before its latest turn (the way it'll go at a wall)
        self.comeback = [SNAKE_START] * k  # 🐍 the length each snake respawns with
        self.best, self.traps = [SNAKE_START] * k, [0] * k  # 🐍 this round's recap: longest length, snakes trapped
        self.tick = 0
        self.ring, self.ride_at = 0, None
        self.bots_since = None
        self.items, self.item_at, self.slow, self.grabs = {}, None, [0] * k, []
        self.won = None  # who took the round once it's over (-1: a draw)
        self.orbs = {}  # 🐍 cell -> length it's worth
        self.orb_seen, self.orb_tick, self.orb_news = {}, 0, []  # what updates have told: see orb_changes
        self.size = [SNAKE_START] * k  # 🐍 how long each snake is allowed to be
        self.own = [0] * (w * h)  # 🐍 body segments on each cell: a snake can lie across itself
        self.seq = [0] * k  # 🐍 cells ever added per snake, so browsers can follow a body that repeats cells
        # spread riders round a circle, each facing the nearest axis toward the centre
        offset = self.rng.random() * 6.283
        for i in range(k):
            a = offset + 6.283 * i / k
            x = int(w / 2 + math.cos(a) * w * 0.36)
            y = int(h / 2 + math.sin(a) * h * 0.36)
            dx, dy = w / 2 - x, h / 2 - y
            self.dirs[i] = (1 if dx > 0 else 3) if abs(dx) > abs(dy) else (2 if dy > 0 else 0)
            self.occupy(i, x, y)
        if self.snake:
            self.spawn_orbs(self.orb_target())
        self.stage = "countdown"
        self.next_at = starts
        self.synced = now
        self.last_frame = now
        self.acc = 0.0
        self.sent = None
        if not again:
            self.room.add_log(f"🔵 Round {self.round} — get ready!")

    def occupy(self, i, x, y):
        c = y * self.w + x
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
        self.size[i] += self.orbs.pop(c, 0)
        best = self.__dict__.get("best")
        if best:
            best[i] = max(best[i], self.size[i])
        t = self.trails[i]
        while len(t) > self.size[i]:
            old = t.pop(0)
            self.own[old] -= 1
            if not self.own[old]:
                self.grid[old] = 0

    def orb_target(self):
        return self.w * self.h // ORB_AREA

    def spawn_orbs(self, most):
        """Scatter up to `most` orbs on open cells, while the grid has fewer than its share."""
        cells = self.w * self.h
        most = min(most, self.orb_target() - len(self.orbs))
        for _ in range(max(0, most) * 4):
            if most <= 0:
                break
            c = self.rng.randrange(cells)
            if not self.grid[c] and c not in self.orbs:
                golds = sum(v == GOLD_GROW for v in self.orbs.values())
                self.orbs[c] = GOLD_GROW if golds < GOLD_MOST and self.rng.random() < GOLD_CHANCE else ORB_GROW
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
        return 0 <= x < self.w and 0 <= y < self.h

    def blocked(self, c, i):
        """🐍 True if snake i dies moving onto c: another snake's body does that, and so does its own neck, the NECK
        cells behind its head (#347: a tight curl bites; the rest of its body is safe to cross)."""
        owner = self.grid[c]
        return owner != 0 and (owner != i + 1 or c in self.trails[i][-NECK - 1:-1])

    def heading(self, i, d):
        if d != self.dirs[i]:
            self.__dict__.setdefault("prior", [None] * len(self.seats))[i] = self.dirs[i]
            self.dirs[i] = d

    def edge_turn(self, i, was):
        """🐍 The edge doesn't kill. A snake about to leave the grid keeps its old heading if that's still inside;
        failing that it carries on the way it was going before its last turn (#349: up after going right means right
        at the wall), and only then takes the roomier side. Other snakes in the way are avoided first of all."""
        prior = (self.__dict__.get("prior") or [None] * len(self.seats))[i]
        head, d = self.trails[i][-1], self.dirs[i]
        x, y = head % self.w, head // self.w
        if self.inside(x + DIRS[d][0], y + DIRS[d][1]):
            return d
        options = []
        for o in (was, (was + 1) % 4, (was + 3) % 4):
            xx, yy = x + DIRS[o][0], y + DIRS[o][1]
            if self.inside(xx, yy):
                ahead = sum(self.inside(x + DIRS[o][0] * k, y + DIRS[o][1] * k) for k in range(1, max(self.w, self.h)))
                options.append((not self.blocked(yy * self.w + xx, i), o == was, o == prior, ahead, o))
        return max(options)[-1]

    def time_up(self, now):
        """🐍 A round that has run far too long goes to the longest living snake (lives break a tie)."""
        ranked = sorted(((self.size[i], self.lives[i], i) for i in range(len(self.seats)) if self.alive[i]), reverse=True)
        best = ranked[0][2] if ranked and (len(ranked) == 1 or ranked[0][:2] != ranked[1][:2]) else None
        self.room.add_log("🐍 Calling this round: it has gone on long enough.", "power")
        self.end_round(best, now, f" with a length of {self.size[best]}" if best is not None else "")

    def only_bots_left(self, now):
        """🐍 True once no person has had a life left in this round for BOTS_ONLY seconds. (A table of nothing but
        bots from the start counts too.)"""
        players = (self.room.players.get(pid) for pid in self.seats)
        if any(p and not p.bot and self.lives[i] > 0 for i, p in enumerate(players)):
            self.bots_since = None
        elif getattr(self, "bots_since", None) is None:
            self.bots_since = now
        return getattr(self, "bots_since", None) is not None and now - self.bots_since >= BOTS_ONLY

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
        w, high = self.w, self.h
        heads = [self.trails[j][-1] for j in range(len(self.seats)) if self.alive[j] and self.trails[j]]
        for _ in range(40):
            x, y = self.rng.randrange(2, w - 2), self.rng.randrange(2, high - 2)
            c = y * w + x
            if self.grid[c] or c in self.items or self.walled(x, y) or min(x, y, w - 1 - x, high - 1 - y) < self.ring + 2:
                continue
            if any(abs(h % w - x) + abs(h // w - y) < 6 for h in heads):
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
        if "fit" in a:  # the host's browser asks for a board shaped like its screen; anyone else's wish is ignored
            if p.id == self.room.host and isinstance(a["fit"], (int, float)) and math.isfinite(a["fit"]) and a["fit"] > 0:
                self.fit(a["fit"])
            return
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        if a.get("boost") is True:
            self.start_boost(i)
        if a.get("brake") is True:
            self.start_brake(i)
        turns = a.get("turns")
        if turns is not None:
            self.numbered_turns(i, turns)
        elif a.get("dir") is not None:
            self.queue_turn(i, a["dir"])

    def numbered_turns(self, i, turns):
        """[[number, direction], ...], oldest first. A browser sends each turn at once, with the few before it, so
        requests can cross or get lost: each number is acted on once, and an older one arriving late is ignored."""
        if not (isinstance(turns, list) and len(turns) <= 6 and all(
                isinstance(t, list) and len(t) == 2 and type(t[0]) is int and t[1] in (0, 1, 2, 3) for t in turns)):
            raise GameError("Bad direction.")
        seen = self.__dict__.setdefault("turn_seen", {})
        for number, d in turns:
            if number > seen.get(i, 0):
                seen[i] = number
                self.queue_turn(i, d)

    def queue_turn(self, i, d):
        if d not in (0, 1, 2, 3):
            raise GameError("Bad direction.")
        q = self.queue[i]
        last = q[-1] if q else self.dirs[i]
        if d != last and d != (last + 2) % 4 and len(q) < 3:  # no U-turns into your own trail
            q.append(d)

    def can_boost(self, i):
        if self.stage != "ride" or not self.alive[i] or self.boosting[i] or self.braking[i]:
            return False
        return self.size[i] - BOOST_COST >= SNAKE_START if self.snake else self.boosts[i] > 0

    def shed(self, i):
        """🐍 Pay for a boost: shorten the snake and leave what it gave up behind as white orbs."""
        self.size[i] -= BOOST_COST
        t = self.trails[i]
        while len(t) > self.size[i]:
            old = t.pop(0)
            self.own[old] -= 1
            if not self.own[old]:
                self.grid[old] = 0
                if old not in self.orbs and len(self.orbs) < 2 * self.orb_target():
                    self.orbs[old] = DROP_GROW

    def start_boost(self, i):
        if self.can_boost(i):
            if self.snake:
                self.shed(i)
            else:
                self.boosts[i] -= 1
            self.boosting[i] = BOOST_TICKS

    def start_brake(self, i):
        if not self.snake and self.stage == "ride" and self.alive[i] and self.brakes[i] > 0 and not self.braking[i]:
            self.brakes[i] -= 1
            self.braking[i] = BRAKE_TICKS
            self.boosting[i] = 0

    # -- simulation

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view (round changes, crashes)."""
        dt = min(0.25, max(0.0, now - self.last_frame))
        self.last_frame = now
        if self.refit:
            self.refit = False
            return True
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
            ring = min(min(self.w, self.h) // 2 - 4, max(0, int((now - self.ride_at - SHRINK_AFTER) // SHRINK_EVERY) + 1))
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
            for c in [c for c in self.items if self.walled(c % self.w, c // self.w)]:
                del self.items[c]
        self.acc += dt * self.s["speed"]
        while self.acc >= 1 and self.stage == "ride":
            self.acc -= 1
            changed |= self.step(now)
            if self.snake and self.stage == "ride":
                changed |= self.check_goal(now)
        if self.snake and self.stage == "ride" and (now - self.ride_at >= SNAKE_CAP or self.only_bots_left(now)):
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
                    self.heading(i, d)
        crashed = set()
        cutter = {}  # crashed rider -> whose trail they hit (✂️ credit)
        holding = {i for i in range(len(self.seats)) if self.ghost[i]}
        for i in holding:
            self.ghost[i] -= 1
        grabbed = len(self.grabs)
        if self.snake:
            self.shield = [max(0, t - 1) for t in self.shields()]
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
                hy, hx = divmod(self.trails[i][-1], self.w)
                if self.snake:
                    self.heading(i, self.edge_turn(i, was[i] if sub == 0 else self.dirs[i]))
                    dx, dy = DIRS[self.dirs[i]]
                    c = (hy + dy) * self.w + hx + dx
                    if self.blocked(c, i):
                        owner = self.grid[c] - 1
                        if self.shields()[i] or self.shields()[owner]:  # protected: whoever's in the way, nobody crashes
                            holding.add(i)
                            continue
                        if self.last_moment(i):  # held for this tick: a turn that is on its way still counts
                            holding.add(i)
                            continue
                        crashed.add(i)
                        if self.grid[c] != i + 1:  # (biting your own neck is nobody's trap)
                            cutter[i] = self.grid[c] - 1
                    else:
                        targets.setdefault(c, []).append(i)
                    continue
                dx, dy = DIRS[self.dirs[i]]
                x, y = hx + dx, hy + dy
                if not self.inside(x, y) or self.grid[y * self.w + x] or self.walled(x, y):
                    crashed.add(i)
                    if self.inside(x, y) and self.grid[y * self.w + x] and self.grid[y * self.w + x] - 1 != i:
                        cutter[i] = self.grid[y * self.w + x] - 1
                else:
                    targets.setdefault(y * self.w + x, []).append(i)
            for c, who in targets.items():
                if len(who) > 1:  # head-on into the same cell
                    if self.snake and any(self.shields()[i] for i in who):
                        continue  # protected: they both wait
                    crashed.update(who)
                    continue
                i = who[0]
                if i not in crashed:
                    self.occupy(i, c % self.w, c // self.w)
                    if self.snake:
                        self.held[i] = False
        for i in range(len(self.seats)):
            if self.boosting[i]:
                self.boosting[i] -= 1
            elif not self.snake and self.alive[i] and i not in crashed and i not in holding and self.grinding(i):
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
                self.__dict__.setdefault("comeback", [SNAKE_START] * len(self.seats))[i] = max(SNAKE_START, int(self.size[i] * CRASH_KEEP))
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
                if self.__dict__.get("traps"):
                    self.traps[k] += 1
                self.moment(f"🪤 {kp.name} trapped {vp.name}!" if self.snake else f"✂️ {kp.name} cut {vp.name} off!", "cool", "crack")
        self.check_round(now)
        return True

    def shields(self):
        """🐍 Ticks of respawn protection left for each seat (a room saved before this has none)."""
        return self.__dict__.setdefault("shield", [0] * len(self.seats))

    def last_moment(self, i):
        """🐍 A person about to run into a snake waits one tick, once, before it counts. Computer snakes don't."""
        held = self.__dict__.get("held")
        if held is None:
            held = self.held = [False] * len(self.seats)
        p = self.room.players.get(self.seats[i])
        if not p or p.bot or held[i]:
            return False
        held[i] = True
        return True

    def grinding(self, i):
        """True when the rider's head is right beside a wall or any trail other than the cell it came from.
        🐍 A snake only grinds off other snakes: neither the edge nor its own body can hurt it."""
        t = self.trails[i]
        head, prev = t[-1], (t[-2] if len(t) > 1 else None)
        x, y = head % self.w, head // self.w
        for dx, dy in DIRS:
            xx, yy = x + dx, y + dy
            if not self.inside(xx, yy):
                if self.snake:
                    continue
                return True
            c = yy * self.w + xx
            if self.blocked(c, i) if self.snake else c != prev and self.grid[c]:
                return True
        return False

    def run(self, c, d):
        """How many empty cells lie straight ahead of c in direction d."""
        k = 0
        while k < max(self.w, self.h) and (c := self.free(c, *DIRS[d])) is not None:
            k += 1
        return k

    def respawn(self, i):
        """Bring a crashed rider back in the most open spot away from everyone else. True if it worked."""
        w, cells = self.w, self.w * self.h
        self.respawn_at[i] = None
        heads = [self.trails[j][-1] for j in range(len(self.seats)) if self.alive[j] and self.trails[j]]
        best, best_score = None, -1
        for _ in range(60):
            c = self.rng.randrange(cells)
            if self.grid[c] or self.walled(c % w, c // w) or any(abs(h % w - c % w) + abs(h // w - c // w) < 4 for h in heads):
                continue
            score = self.space(c, 200) * 10 + max(self.run(c, d) for d in range(4))
            if score > best_score:
                best, best_score = c, score
        if best is None:  # nowhere open: try any empty cell at all
            empty = [c for c in range(cells) if not self.grid[c] and not self.walled(c % w, c // w)]
            if not empty:
                self.lives[i] = 0
                self.check_round(time.time())
                return True
            best = self.rng.choice(empty)
        self.dirs[i] = max(range(4), key=lambda d: self.run(best, d))
        self.trails[i] = []
        comeback = self.__dict__.get("comeback")
        self.size[i] = comeback[i] if comeback else SNAKE_START
        self.occupy(i, best % w, best // w)
        if self.snake:
            self.shields()[i] = round(SHIELD * self.s["speed"])
        self.alive[i] = True
        self.queue[i].clear()
        self.ghost[i] = GHOST_TICKS
        return True

    def check_round(self, now):
        left = [i for i in range(len(self.seats)) if self.alive[i] or self.respawn_at[i] is not None]
        if len(left) > 1:
            return
        self.end_round(left[0] if left else None, now)

    @property
    def goal(self):
        """🐍 The length that takes a round at once (0: only being the last one left does)."""
        return self.s.get("goal", 0) if self.snake else 0

    def check_goal(self, now):
        """🐍 True if someone reached the goal length and the round is over. If two get there on the same tick the
        longer one wins; equal lengths are a draw."""
        there = sorted(((self.size[i], i) for i in range(len(self.seats)) if self.alive[i] and self.size[i] >= self.goal), reverse=True)
        if not self.goal or not there:
            return False
        winner = there[0][1] if len(there) == 1 or there[0][0] > there[1][0] else None
        self.end_round(winner, now, f" by reaching length {there[0][0]}")
        return True

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
        self.next_at = now + (SNAKE_PAUSE if self.snake else ROUND_PAUSE)

    def broadcast(self, now):
        self.room.push_fast({
            "k": self.tick, "st": self.stage, "w": getattr(self, "ring", 0),
            "it": [[c, k] for c, k in getattr(self, "items", {}).items()],
            "sl": [int(x > 0) for x in getattr(self, "slow", [])], "gr": getattr(self, "grabs", []),
            **({"sq": list(self.seq), "sz": list(self.size), "oc": self.orb_changes(),
                "wn": self.won} if self.snake else {}),
            "p": [[len(t), int(self.alive[i]), self.dirs[i], self.boosts[i], int(self.boosting[i] > 0),
                   self.lives[i], self.grind[i], int(self.braking[i] > 0), self.brakes[i], *t[-TAIL:]]
                  for i, t in enumerate(self.trails)],
        })

    # -- bots: steer toward the most open space

    def free(self, c, dx, dy):
        """Cell index one step from c, or None if that's a wall or a trail."""
        x, y = c % self.w + dx, c // self.w + dy
        if self.inside(x, y) and not self.grid[y * self.w + x] and not self.walled(x, y):
            return y * self.w + x
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
        n, grid = self.w, self.grid
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
                    if self.inside(xx, yy):
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
                if abs(h % self.w - nxt % self.w) + abs(h // self.w - nxt // self.w) <= 1:
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
                near = min(others, key=lambda h: abs(h % self.w - nxt % self.w) + abs(h // self.w - nxt // self.w))
                score -= (abs(near % self.w - nxt % self.w) + abs(near // self.w - nxt // self.w)) * 0.3
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

    # -- 🐍 snake bots: stay off other snakes and go for orbs; hard ones also go out of their way for richer ones and dither less

    def open_to(self, i, start, limit):
        """Flood-fill count of cells snake i could move through from start (its own body included), capped."""
        n = self.w
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
        return min(len(seen), limit)  # the search overshoots by a few: that must not outvote the food

    def snake_steer(self, i, level):
        n, head, d = self.w, self.trails[i][-1], self.dirs[i]
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
            if food is not None and random.random() < EASY_SEEK:
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
            if hard and self.orbs:  # nearest still, but a richer orb is worth a few cells' detour
                food = min(self.orbs, key=lambda c: gap(head, c) - 2 * (self.orbs[c] - ORB_GROW))

            # Food behind can't be reached by going on (a snake can't reverse): straight must not win a tie then, or
            # the snake rides away from its meal for as long as nothing else tips the choice.
            behind = food is not None and (food % n - x) * DIRS[d][0] + (food // n - y) * DIRS[d][1] <= 0

            def score(o):
                c = safe[o]
                v = self.open_to(i, c, 150 if hard else 60) * 10
                if any(gap(h, c) <= far for h, far in rivals):  # a rival could reach that cell too
                    v -= 40
                if food is not None:
                    v -= gap(c, food) * 2
                if c in self.orbs:
                    v += 12 * self.orbs[c] if hard else 25
                return v + (3 if o == d and not behind else 0) + random.uniform(0, 1 if hard else 6)

            best = max(safe, key=score)
        if best != d:
            self.queue[i].clear()
            self.queue[i].append(best)
        if level != "easy" and self.races_for_gold(i, safe.get(best), best):
            self.start_boost(i)

    def races_for_gold(self, i, nxt, d):
        """🐍 Worth paying for a boost: gold dead ahead down a clear straight that a rival could get to first."""
        if nxt is None or not self.can_boost(i) or self.size[i] < SNAKE_START + 2 * BOOST_COST:
            return False
        w = self.w
        rivals = [self.trails[j][-1] for j in range(len(self.seats)) if j != i and self.alive[j] and self.trails[j]]
        x, y = nxt % w, nxt // w
        for k in range(1, 13):
            if not self.inside(x, y) or self.blocked(y * w + x, i):
                return False
            if self.orbs.get(y * w + x) == GOLD_GROW:
                return k >= 4 and any(abs(h % w - x) + abs(h // w - y) <= k + 3 for h in rivals)
            x, y = x + DIRS[d][0], y + DIRS[d][1]
        return False

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

    def orb_changes(self):
        """🐍 [tick, [[cell, worth], ...]]: every orb cell that has changed since that tick, with what's there now
        (0: nothing). Sending only changes halves each update; repeating the last ORB_WINDOW ticks of them covers a
        browser that skips some (push_fast keeps just the newest), and full views carry every orb."""
        seen = getattr(self, "orb_seen", None)
        if seen is None:  # a room saved before this: start from here, and let the next full view fill it in
            self.orb_seen, self.orb_tick, self.orb_news = dict(self.orbs), self.tick, []
            return [self.tick, []]
        changed = {c for c, v in self.orbs.items() if seen.get(c) != v} | {c for c in seen if c not in self.orbs}
        self.orb_news.append((self.orb_tick, changed))
        self.orb_seen, self.orb_tick = dict(self.orbs), self.tick
        while len(self.orb_news) > 1 and self.orb_news[0][0] < self.tick - ORB_WINDOW:
            self.orb_news.pop(0)
        cells = set().union(*(c for _, c in self.orb_news))
        return [self.orb_news[0][0], [[c, self.orbs.get(c, 0)] for c in sorted(cells)]]

    def final_scores(self):
        return {pid: self.wins[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        return {"riders": {
            "n": self.n, "w": self.w, "h": self.h, "seats": self.seats, "me": self.seat(p), "stage": self.stage, "round": self.round,
            "mode": "snake" if self.snake else "cycles", "won": getattr(self, "won", None),
            **({"orbs": [[c, v] for c, v in self.orbs.items()], "sq": self.seq, "size": self.size, "goal": self.goal,
                "boostCost": BOOST_COST, "boostMin": SNAKE_START + BOOST_COST,
                "recap": {"best": self.__dict__.get("best"), "traps": self.__dict__.get("traps")} if self.stage in ("over", "done") else None}
               if self.snake else {}),
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
