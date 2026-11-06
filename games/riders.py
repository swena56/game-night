"""Light Riders: an original light-cycle game. Every rider moves forward constantly and leaves a
solid wall of light behind them. Hit a wall, any trail, or another rider head-on and you're out;
the last rider riding wins the round. First to the target number of rounds wins.

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
GRIND_FULL = 25    # ticks spent riding right beside a wall or trail that earn a boost back
RESPAWN = 1.5      # seconds between a crash and riding again, while lives remain
GHOST_TICKS = 2    # a respawned rider holds still this long so everyone sees it appear
SYNC_EVERY = 3.0   # seconds between full-view resyncs while riding
TAIL = 6           # recent cells per rider in each fast update (covers missed updates and boosts)


SHRINK_AFTER, SHRINK_EVERY = 60, 2.5  # 🧱 closing arena: seconds of riding before the walls move, then a ring this often

class Riders(Game):
    id = "riders"
    category = "action"
    howto = [
        "Your light bike never stops, and leaves a wall of light behind it.",
        "Swipe, use the arrows or the arrow keys to turn. Don't hit any wall — yours included.",
        "⚡ Boost (3 per round) doubles your speed for a moment. Ride right beside a wall or trail to grind a boost back.",
        "Crash with lives left and your trail vanishes — you respawn in open space a moment later.",
        "Last rider with lives left wins the round. First to the target wins the match.",
    ]
    name = "Light Riders"
    icon = "🏍️"
    blurb = "Neon light-bike duels. Box your rivals in, grind trails for boosts — last rider riding wins."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "target": ("Rounds to win", [(3, "3"), (2, "2"), (5, "5")], 3),
        "arena": ("Arena", [(44, "Medium"), (32, "Small"), (60, "Large")], 44),
        "speed": ("Speed", [(10, "Normal"), (7, "Chill"), (14, "Fast")], 10),
        "lives": ("Lives", [(3, "3"), (1, "1 (classic)"), (5, "5")], 3),
        "shrink": ("🧱 Closing arena", [(False, "Off"), (True, f"On: after {SHRINK_AFTER} s the walls close in")], False),
    }

    def walled(self, x, y):
        """Inside the band the 🧱 closing arena has already walled off."""
        ring = getattr(self, "ring", 0)
        return ring > 0 and min(x, y, self.n - 1 - x, self.n - 1 - y) < ring

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.n = self.s["arena"]
        self.wins = [0] * len(seated)
        self.round = 0
        self.stage = "countdown"
        self.room.turn = None
        self.room.deadline = None
        self.room.add_log(f"🏍️ {len(seated)} riders enter the grid. First to {self.s['target']} rounds wins.", "big")
        self.new_round(time.time())

    def new_round(self, now):
        n, k = self.n, len(self.seats)
        self.round += 1
        self.grid = bytearray(n * n)  # 0 empty, else seat + 1
        self.trails = [[] for _ in range(k)]
        self.alive = [True] * k
        self.dirs, self.queue = [0] * k, [deque() for _ in range(k)]
        self.boosts, self.boosting = [BOOSTS] * k, [0] * k
        self.lives = [self.s.get("lives", 3)] * k
        self.respawn_at, self.ghost, self.grind = [None] * k, [0] * k, [0] * k
        self.tick = 0
        self.ring, self.ride_at = 0, None
        # spread riders round a circle, each facing the nearest axis toward the centre
        offset = self.rng.random() * 6.283
        for i in range(k):
            a = offset + 6.283 * i / k
            x = int(n / 2 + math.cos(a) * n * 0.36)
            y = int(n / 2 + math.sin(a) * n * 0.36)
            dx, dy = n / 2 - x, n / 2 - y
            self.dirs[i] = (1 if dx > 0 else 3) if abs(dx) > abs(dy) else (2 if dy > 0 else 0)
            self.occupy(i, x, y)
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
        if self.stage == "ride" and self.alive[i] and self.boosts[i] > 0 and not self.boosting[i]:
            self.boosts[i] -= 1
            self.boosting[i] = BOOST_TICKS

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
        if self.s.get("shrink") and getattr(self, "ride_at", None):  # 🧱 a ring closes every few seconds
            ring = min(self.n // 2 - 4, max(0, int((now - self.ride_at - SHRINK_AFTER) // SHRINK_EVERY) + 1))
            if ring > self.ring:
                if not self.ring:
                    self.room.add_log("🧱 The arena is closing in!", "power")
                self.ring = ring
                changed = True
        self.acc += dt * self.s["speed"]
        while self.acc >= 1 and self.stage == "ride":
            self.acc -= 1
            changed |= self.step(now)
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
        """One tick: bots decide, turns apply, everyone moves (boosters twice). Returns True on crashes."""
        self.tick += 1
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if self.alive[i] and p and p.bot:
                self.bot_steer(i, p.bot)
        for i in range(len(self.seats)):
            if self.queue[i]:
                self.dirs[i] = self.queue[i].popleft()
        crashed = set()
        holding = {i for i in range(len(self.seats)) if self.ghost[i]}
        for i in holding:
            self.ghost[i] -= 1
        for sub in range(2):
            movers = [i for i in range(len(self.seats))
                      if self.alive[i] and i not in crashed and i not in holding and (sub == 0 or self.boosting[i])]
            if not movers:
                continue
            targets = {}
            for i in movers:
                hx, hy = divmod(self.trails[i][-1], self.n)[::-1]
                dx, dy = DIRS[self.dirs[i]]
                x, y = hx + dx, hy + dy
                if not (0 <= x < self.n and 0 <= y < self.n) or self.grid[y * self.n + x] or self.walled(x, y):
                    crashed.add(i)
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
        if not crashed:
            return False
        names = []
        for i in crashed:
            self.alive[i] = False
            self.boosting[i] = self.grind[i] = 0
            self.queue[i].clear()
            self.lives[i] -= 1
            p = self.room.players.get(self.seats[i])
            name = p.name if p else "?"
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
        self.check_round(now)
        return True

    def grinding(self, i):
        """True when the rider's head is right beside a wall or any trail other than the cell it came from."""
        t = self.trails[i]
        head, prev = t[-1], (t[-2] if len(t) > 1 else None)
        x, y = head % self.n, head // self.n
        for dx, dy in DIRS:
            xx, yy = x + dx, y + dy
            if not (0 <= xx < self.n and 0 <= yy < self.n):
                return True
            c = yy * self.n + xx
            if c != prev and self.grid[c]:
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
        self.occupy(i, best % n, best // n)
        self.alive[i] = True
        self.queue[i].clear()
        self.ghost[i] = GHOST_TICKS
        return True

    def check_round(self, now):
        left = [i for i in range(len(self.seats)) if self.alive[i] or self.respawn_at[i] is not None]
        if len(left) > 1:
            return
        r = self.room
        if left:
            i = left[0]
            self.wins[i] += 1
            p = r.players.get(self.seats[i])
            name = p.name if p else "?"
            if self.wins[i] >= self.s["target"]:
                self.stage = "done"
                return r.finish(p, f"🏆 {name} wins the match, {self.wins[i]} rounds to {max([w for j, w in enumerate(self.wins) if j != i] or [0])}!")
            r.add_log(f"🏁 {name} wins round {self.round}!", "big")
        else:
            r.add_log(f"🤝 Round {self.round} is a draw — everyone crashed.", "big")
        self.respawn_at = [None] * len(self.seats)
        self.stage = "over"
        self.next_at = now + ROUND_PAUSE

    def broadcast(self, now):
        self.room.push_fast({
            "k": self.tick, "st": self.stage, "w": getattr(self, "ring", 0),
            "p": [[len(t), int(self.alive[i]), self.dirs[i], self.boosts[i], int(self.boosting[i] > 0),
                   self.lives[i], self.grind[i], *t[-TAIL:]]
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
            "ring": getattr(self, "ring", 0),
            "wins": self.wins, "target": self.s["target"], "speed": self.s["speed"], "tick": self.tick,
            "trails": self.trails, "alive": self.alive, "dirs": self.dirs, "boosts": self.boosts,
            "lives": self.lives, "maxLives": self.s.get("lives", 3), "grind": self.grind, "grindFull": GRIND_FULL,
            "respawning": [None if at is None else max(0.0, at - time.time()) for at in self.respawn_at],
            "countdown": max(0.0, self.next_at - time.time()) if self.stage in ("countdown", "over") else 0,
        }}
