"""Paint Blast: an original real-time bomb-maze game. Run through a maze of pillars and crates and
drop paint bombs. A bomb's blast runs in a straight line in all four directions, breaks the first
crate it meets, and paints every tile it touches in your colour. When the clock runs out, each
painted tile is a point, and catching a rival in your blast is worth a bonus. Caught players are
stunned for a moment and respawn at home, so nobody sits out a round.

Server-side and tick-based like Light Riders: frame(now) (called at 60 fps) advances the arena at
TICK steps a second, input arrives through on_input, and the whole arena (it's small) streams to
browsers over the room's fast channel each tick."""
import random
import time
from collections import deque

from .base import Game, GameError

DIRS = [(0, -1), (1, 0), (0, 1), (-1, 0)]  # up, right, down, left
TICK = 12            # simulation steps per second
MOVE_TICKS = 3       # a step to the next tile takes this many ticks (4 tiles a second)
FUSE = 30            # 2.5 s
BURN = 6             # a blast burns for half a second
STUN = 36            # 3 s out after being caught
SHIELD = 18          # 1.5 s of safety after respawning
TAG_POINTS = 10
COUNTDOWN, PAUSE = 3.0, 5.0
CLOSE_FROM, CLOSE_EVERY = 15.0, 4.0  # 🧱 the walls close in: a ring of pillars from 15 s left, then every 4 s
FLOOR, PILLAR, CRATE = 0, 1, 2
POWERS = {"b": "💣 extra bomb", "r": "🔥 longer blast", "p": "🪣 paint splash", "k": "👟 kick"}


class PaintBlast(Game):
    id = "paintblast"
    category = "action"
    howto = [
        "Move with a swipe-and-hold on the arena, the arrows, or the keyboard (arrows / WASD). Tap the arena, 💣 or Space to drop a bomb.",
        "A bomb blasts in a straight line in all four directions. It breaks the first crate it meets and paints every tile it touches in your colour.",
        "Caught in a blast? You're stunned for 3 s and respawn at home. Catching a rival scores +10.",
        "Crates hide 💣 more bombs, 🔥 longer blasts, 🪣 paint splashes and 👟 kick: walk into a bomb to send it sliding.",
        "When the clock runs out, every tile in your colour is a point. Most points after the last round wins.",
        "🧱 In the last 15 s the walls close in, one ring at a time. Paint under them still counts.",
    ]
    name = "Paint Blast"
    icon = "🎨"
    blurb = "Real-time bomb maze where every blast paints the floor. Most colour when the clock stops wins."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "secs": ("Round length", [(90, "1½ min"), (60, "1 min"), (120, "2 min")], 90),
        "rounds": ("Rounds", [(2, "2"), (1, "1"), (3, "3")], 2),
        "arena": ("Arena", [(13, "Medium"), (11, "Small"), (15, "Large")], 13),
        "closing": ("Last 15 s", [(True, "🧱 Walls close in"), (False, "Arena stays open")], True),
    }
    closed = 0  # rings of the arena walled off so far (rounds saved before this had none)
    kick = None  # who has picked up 👟 kick this round

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.n = self.s["arena"]
        self.total = [0] * len(seated)
        self.round = 0
        self.room.turn = None
        self.room.deadline = None
        self.room.add_log(f"🎨 Paint Blast! {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''} of "
                          f"{self.s['secs']} s. Paint the most floor.", "big")
        self.new_round(time.time())

    def homes(self):
        e, m = self.n - 1, self.n // 2
        return [(0, 0), (e, e), (e, 0), (0, e), (0, m), (e, m)][:len(self.seats)]

    def new_round(self, now):
        n, k = self.n, len(self.seats)
        self.round += 1
        self.tiles = self.make_maze()
        self.paint = bytearray(n * n)  # 0 = bare, else seat + 1
        self.bombs = {}    # cell -> [fuse, owner, range]
        self.burn = {}     # cell -> [ticks, owner]
        self.items = {}    # cell -> power kind
        self.pos = [y * n + x for x, y in self.homes()]
        self.want, self.nudge, self.cool = [-1] * k, [False] * k, [0] * k
        self.drop, self.facing = [False] * k, [2] * k
        self.maxb, self.reach = [1] * k, [2] * k
        self.kick = [False] * k
        self.stun, self.shield, self.tags = [0] * k, [SHIELD] * k, [0] * k
        self.moved = [0] * k  # tick of each player's last step, so browsers can glide
        self.think = [0] * k
        self.tick = 0
        self.stage = "countdown"
        self.next_at = now + COUNTDOWN
        self.ends_at = None
        self.closed = 0
        self.last_frame = now
        self.acc = 0.0
        self.room.add_log(f"🎨 Round {self.round}/{self.s['rounds']}: a fresh maze. Get ready!")

    def make_maze(self):
        """Pillars and crates mirrored on both axes (fair for every corner), every open tile connected,
        and each home kept clear."""
        n, rng = self.n, self.rng
        homes = [(0, 0), (n - 1, 0), (0, n - 1), (n - 1, n - 1), (0, n // 2), (n - 1, n // 2)]
        clear = {(x, y) for hx, hy in homes for x in range(n) for y in range(n) if abs(x - hx) + abs(y - hy) <= 2}
        half = (n + 1) // 2
        while True:
            tiles = bytearray(n * n)
            for y in range(half):
                for x in range(half):
                    roll = rng.random()
                    kind = PILLAR if roll < 0.2 and (x % 2 or y % 2) == 0 else CRATE if roll < 0.75 else FLOOR
                    for xx, yy in {(x, y), (n - 1 - x, y), (x, n - 1 - y), (n - 1 - x, n - 1 - y)}:
                        tiles[yy * n + xx] = FLOOR if (xx, yy) in clear else kind
            open_ = [c for c in range(n * n) if tiles[c] != PILLAR]
            seen, todo = {open_[0]}, [open_[0]]
            while todo:
                c = todo.pop()
                for nb in self.nbrs(c):
                    if tiles[nb] != PILLAR and nb not in seen:
                        seen.add(nb)
                        todo.append(nb)
            if len(seen) == len(open_):
                return tiles

    def nbrs(self, c):
        n, x, y = self.n, c % self.n, c // self.n
        return [(y + dy) * n + x + dx for dx, dy in DIRS if 0 <= x + dx < n and 0 <= y + dy < n]

    def step_to(self, c, d):
        x, y = c % self.n + DIRS[d][0], c // self.n + DIRS[d][1]
        return y * self.n + x if 0 <= x < self.n and 0 <= y < self.n else None

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- input

    def act(self, p, a):
        raise GameError("Move with the arrows or a swipe, and drop bombs with 💣.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        if a.get("bomb") is True:
            self.drop[i] = True
        d = a.get("dir")
        if d is None:
            return
        if d not in (-1, 0, 1, 2, 3):
            raise GameError("Bad direction.")
        self.want[i] = d
        if d >= 0:
            self.facing[i] = d
            self.nudge[i] = True  # a quick tap still moves one tile

    # -- simulation

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view (stage changes)."""
        dt = min(0.25, max(0.0, now - self.last_frame))
        self.last_frame = now
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "play"
                self.ends_at = now + self.s["secs"]
                self.acc = 0.0
                return True
            return False
        if self.stage == "over":
            if now >= self.next_at:
                if self.round >= self.s["rounds"]:
                    return self.finish_game() or True
                self.new_round(now)
                return True
            return False
        self.acc += dt * TICK
        while self.acc >= 1 and self.stage == "play":
            self.acc -= 1
            self.step()
            self.close_in(now)
            if now >= self.ends_at:
                self.end_round(now)
                return True
        self.broadcast(now)
        return False

    def close_in(self, now):
        """Wall off the outer rings near the end. Anyone standing there is pushed to the nearest open tile inside."""
        left = self.ends_at - now
        if not self.s.get("closing", True) or left > CLOSE_FROM:
            return
        n = self.n
        want = min((n - 5) // 2, int((CLOSE_FROM - left) / CLOSE_EVERY) + 1)
        if want <= self.closed:
            return
        self.closed = want
        ring = lambda c: min(c % n, c // n, n - 1 - c % n, n - 1 - c // n)
        for c in range(n * n):
            if ring(c) < want:
                self.tiles[c] = PILLAR
                self.bombs.pop(c, None)
                self.burn.pop(c, None)
                self.items.pop(c, None)
        for i, c in enumerate(self.pos):
            if self.tiles[c] == PILLAR:
                self.pos[i] = self.nearest_open(c)
                self.moved[i] = self.tick
        if want == 1:
            self.room.add_log("🧱 The walls are closing in!", "power")

    def nearest_open(self, c):
        n = self.n
        spots = [d for d in range(n * n) if self.tiles[d] == FLOOR] or [c]
        return min(spots, key=lambda d: abs(d % n - c % n) + abs(d // n - c // n))

    def active(self, i):
        return self.stun[i] == 0

    def step(self):
        self.tick += 1
        k = len(self.seats)
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and self.active(i) and not p.eliminated:
                self.bot_think(i, p.bot)
        for i in range(k):
            if self.cool[i]:
                self.cool[i] -= 1
            if not self.active(i):
                continue
            if self.drop[i]:
                self.drop[i] = False
                c = self.pos[i]
                mine = sum(1 for b in self.bombs.values() if b[1] == i)
                if c not in self.bombs and mine < self.maxb[i]:
                    self.bombs[c] = [FUSE, i, self.reach[i]]
            d = self.want[i] if self.want[i] >= 0 else (self.facing[i] if self.nudge[i] else -1)
            if d >= 0 and not self.cool[i]:
                self.nudge[i] = False
                nxt = self.step_to(self.pos[i], d)
                if nxt is not None and self.tiles[nxt] == FLOOR and nxt not in self.bombs:
                    self.pos[i] = nxt
                    self.cool[i] = MOVE_TICKS
                    self.moved[i] = self.tick
                    self.pick_up(i, nxt)
                elif nxt in self.bombs and self.kick and self.kick[i]:
                    self.kick_bomb(nxt, d)
                    self.cool[i] = MOVE_TICKS
        # fuses, chain reactions, burning
        for c in list(self.bombs):
            self.bombs[c][0] -= 1
        while True:
            due = [c for c, b in self.bombs.items() if b[0] <= 0]
            if not due:
                break
            for c in due:
                if c in self.bombs:
                    self.explode(c)
        for c in list(self.burn):
            self.burn[c][0] -= 1
            if self.burn[c][0] <= 0:
                del self.burn[c]
        for i in range(k):
            if self.shield[i]:
                self.shield[i] -= 1
            if self.stun[i]:
                self.stun[i] -= 1
                if not self.stun[i]:
                    hx, hy = self.homes()[i]
                    self.pos[i] = hy * self.n + hx
                    if self.tiles[self.pos[i]] == PILLAR:  # home is behind the closing walls
                        self.pos[i] = self.nearest_open(self.pos[i])
                    self.shield[i] = SHIELD
                    self.want[i], self.nudge[i] = -1, False
            elif not self.shield[i] and self.pos[i] in self.burn:
                self.caught(i, self.burn[self.pos[i]][1])

    def kick_bomb(self, c, d):
        """👟 Send the bomb at c sliding in direction d until a wall, crate, bomb or player stops it."""
        end = c
        while True:
            nxt = self.step_to(end, d)
            if nxt is None or self.tiles[nxt] != FLOOR or nxt in self.bombs or nxt in self.pos:
                break
            end = nxt
        if end != c:
            self.bombs[end] = self.bombs.pop(c)

    def pick_up(self, i, c):
        kind = self.items.pop(c, None)
        if kind == "k" and self.kick:
            self.kick[i] = True
        if kind == "b":
            self.maxb[i] = min(5, self.maxb[i] + 1)
        elif kind == "r":
            self.reach[i] = min(6, self.reach[i] + 1)
        elif kind == "p":
            for cc in [c] + self.nbrs(c) + [x for nb in self.nbrs(c) for x in self.nbrs(nb)]:
                if self.tiles[cc] == FLOOR:
                    self.paint[cc] = i + 1

    def blast_cells(self, c, reach):
        """Tiles a bomb at c with this reach would burn: (cells, crates it would break)."""
        cells, crates = [c], []
        for d in range(4):
            cur = c
            for _ in range(reach):
                cur = self.step_to(cur, d)
                if cur is None or self.tiles[cur] == PILLAR:
                    break
                cells.append(cur)
                if self.tiles[cur] == CRATE:
                    crates.append(cur)
                    break
                if cur in self.bombs:
                    break
        return cells, crates

    def explode(self, c):
        fuse, owner, reach = self.bombs.pop(c)
        cells, crates = self.blast_cells(c, reach)
        for cc in cells:
            if cc in self.bombs:
                self.bombs[cc][0] = 0  # chain reaction
            self.items.pop(cc, None)
            self.burn[cc] = [BURN, owner]
            self.paint[cc] = owner + 1
        for cc in crates:
            self.tiles[cc] = FLOOR
            if self.rng.random() < 0.3:
                self.items[cc] = self.rng.choice("bbrrpk")

    def caught(self, i, by):
        self.stun[i] = STUN
        r = self.room
        victim = r.players.get(self.seats[i])
        if by != i:
            self.tags[by] += 1
            hunter = r.players.get(self.seats[by])
            r.add_log(f"💥 {hunter.name if hunter else '?'} caught {victim.name if victim else '?'}! +{TAG_POINTS}", "power")
        else:
            r.add_log(f"💥 {victim.name if victim else '?'} got caught in their own blast.", "power")

    def round_points(self, i):
        return self.paint.count(i + 1) + TAG_POINTS * self.tags[i]

    def end_round(self, now):
        r = self.room
        pts = [self.round_points(i) for i in range(len(self.seats))]
        for i, v in enumerate(pts):
            self.total[i] += v
        order = sorted(range(len(self.seats)), key=lambda i: -pts[i])
        names = [(r.players[self.seats[i]].name if self.seats[i] in r.players else "?") for i in range(len(self.seats))]
        r.add_log(f"⏱️ Round {self.round}: " + " · ".join(f"{names[i]} {pts[i]}" for i in order), "big")
        self.last_points = pts
        self.stage = "over"
        self.next_at = now + PAUSE
        self.broadcast(now)

    def finish_game(self):
        r = self.room
        live = [i for i, pid in enumerate(self.seats) if pid in r.players and not r.players[pid].eliminated]
        ranked = sorted(live, key=lambda i: -self.total[i])
        text = " · ".join(f"{r.players[self.seats[i]].name} {self.total[i]}" for i in ranked)
        self.stage = "done"
        if len(ranked) > 1 and self.total[ranked[0]] == self.total[ranked[1]]:
            return r.finish(None, f"🤝 It's a tie! {text}")
        r.finish(r.players[self.seats[ranked[0]]], f"🏆 {r.players[self.seats[ranked[0]]].name} wins Paint Blast! {text}")

    def snapshot(self, now):
        return {
            "k": self.tick, "st": self.stage, "rd": self.round,
            "t": "".join(".#+"[v] for v in self.tiles), "c": self.paint.hex(),
            "b": [[c, b[0], b[1]] for c, b in self.bombs.items()],
            "f": [[c, b[1]] for c, b in self.burn.items()],
            "i": [[c, kind] for c, kind in self.items.items()],
            "p": [[self.pos[i], self.stun[i], self.shield[i], self.moved[i], self.maxb[i], self.reach[i],
                   self.round_points(i), bool(self.kick and self.kick[i])] for i in range(len(self.seats))],
            "left": max(0.0, self.ends_at - now) if self.ends_at and self.stage == "play" else None,
        }

    def broadcast(self, now):
        self.room.push_fast(self.snapshot(now))

    # -- bots

    def danger(self, extra=None):
        """{cell: ticks until it burns} for every live bomb (chains included), plus burning tiles at 0."""
        bombs = dict(self.bombs)
        if extra is not None:
            bombs[extra[0]] = [FUSE, extra[1], extra[2]]
        fuse = {c: b[0] for c, b in bombs.items()}
        saved, self.bombs = self.bombs, bombs
        try:
            blasts = {c: self.blast_cells(c, b[2])[0] for c, b in bombs.items()}
        finally:
            self.bombs = saved
        for _ in range(3):  # a blast that reaches another bomb sets it off early
            for c, cells in blasts.items():
                for cc in cells:
                    if cc in fuse and fuse[cc] > fuse[c]:
                        fuse[cc] = fuse[c]
        out = {c: 0 for c in self.burn}
        for c, cells in blasts.items():
            for cc in cells:
                out[cc] = min(out.get(cc, 99), fuse[c])
        return out

    def routes(self, start, danger, limit=400):
        """BFS from start over open tiles, never stepping where a blast lands as we arrive:
        {cell: (distance, first direction)}."""
        out = {start: (0, -1)}
        todo = deque([start])
        while todo and len(out) < limit:
            c = todo.popleft()
            dist, first = out[c]
            for d in range(4):
                nb = self.step_to(c, d)
                if nb is None or nb in out or self.tiles[nb] != FLOOR or nb in self.bombs:
                    continue
                arrive = (dist + 1) * MOVE_TICKS
                if nb in danger and danger[nb] <= arrive + MOVE_TICKS + 2 and danger[nb] + BURN >= arrive - 1:
                    continue
                out[nb] = (dist + 1, d if first < 0 else first)
                todo.append(nb)
        return out

    def bomb_value(self, i, c, level):
        cells, crates = self.blast_cells(c, self.reach[i])
        v = len(crates) * 3
        v += sum(1 for cc in cells if self.paint[cc] != i + 1 and self.tiles[cc] == FLOOR) * (0.8 if level == "hard" else 0.4)
        for j, pc in enumerate(self.pos):
            if j != i and self.active(j) and not self.shield[j] and pc in cells:
                v += 6 if level == "hard" else 3
        return v

    def bot_think(self, i, level):
        if self.cool[i] > 1:
            return
        self.think[i] -= 1
        if self.think[i] > 0:
            return
        self.think[i] = {"easy": 4, "normal": 2, "hard": 1}[level]
        here = self.pos[i]
        danger = self.danger()
        self.want[i] = -1
        if here in danger:  # get out of the way
            if level == "easy" and random.random() < 0.2:
                return
            safe = [(dist, c, first) for c, (dist, first) in self.routes(here, danger).items() if c not in danger]
            if safe:
                _, _, first = min(safe)
                self.go(i, first)
            return
        mine = sum(1 for b in self.bombs.values() if b[1] == i)
        if mine < self.maxb[i] and here not in self.bombs:
            v = self.bomb_value(i, here, level)
            if v >= (3 if level != "easy" else 2):
                after = self.danger((here, i, self.reach[i]))
                escape = [c for c, (dist, _) in self.routes(here, after).items()
                          if c not in after and dist * MOVE_TICKS < FUSE - 6]
                if escape or (level == "easy" and random.random() < 0.15):
                    self.drop[i] = True
                    return
        reach = self.routes(here, danger, limit=200 if level == "easy" else 400)
        best, best_score = None, 0.0
        for c, (dist, first) in reach.items():
            if c == here or c in danger:
                continue
            score = (12 if c in self.items else 0) + self.bomb_value(i, c, level)
            score /= dist + 2
            if level != "hard":
                score *= random.uniform(0.6, 1.4)
            if score > best_score:
                best, best_score = first, score
        if best is not None:
            self.go(i, best)

    def go(self, i, d):
        self.want[i] = -1
        self.nudge[i] = True
        self.facing[i] = d

    # -- the rest of the contract

    def bot_ready(self):
        return False  # bots think inside frame()

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} left the arena.")
        if i is not None:
            self.stun[i] = 10 ** 9  # out of play; the paint stays on the floor
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        if i is None:
            return ""
        now = self.total[i] + (self.round_points(i) if self.stage == "play" else 0)
        return f"🎨 {now}"

    def final_scores(self):
        return {pid: self.total[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"paintblast": {
            "n": self.n, "seats": self.seats, "me": self.seat(p), "round": self.round, "rounds": self.s["rounds"],
            "secs": self.s["secs"], "total": self.total, "tick": TICK, "move": MOVE_TICKS, "fuse": FUSE,
            "countdown": max(0.0, self.next_at - now) if self.stage in ("countdown", "over") else 0,
            "last": getattr(self, "last_points", None) if self.stage == "over" else None,
            **self.snapshot(now),
        }}
