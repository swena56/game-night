"""Whisker Run: an original real-time maze chase, mice against cats. Every round a fresh hedge maze is grown;
some players are 🐭 mice nibbling crumbs, the rest are 🐱 cats hunting them, and the roles rotate so everyone
hunts equally often. A caught mouse drops half the crumbs it has nibbled this round, straight into the cat's
score. Ring a 🔔 bell and every cat panics for a few seconds: bump one then and it's sent back to its basket.

Server-side and tick-based like Light Riders: frame(now) (called at 60 fps) runs the maze at TICK_HZ; each
critter has its own speed and moves a cell whenever its accumulator fills. Turns arrive through on_input and
are held until the turn is possible (so you can press early for a corner); positions stream to browsers over
the room's fast channel, with a full view every SYNC_EVERY seconds."""
import math
import time
from collections import deque

from .base import Game, GameError

W, H = 21, 19                     # maze cells, border included (rooms on odd coordinates)
DIRS = [(0, -1), (1, 0), (0, 1), (-1, 0)]  # up, right, down, left
TICK_HZ = 15                      # simulation ticks a second (a critter moves at most one cell a tick)
COUNTDOWN, ROUND_PAUSE = 3.0, 4.0
SYNC_EVERY = 3.0
LIVES = 3                         # per mouse per round
RESPAWN, GHOST = 2.0, 1.6         # a caught mouse's wait, then its untouchable blink
SPOOK, BONK_HOLD = 6.0, 3.0       # 🔔 panic time; how long a bumped cat sits in the basket
CAT_PACE, ALLEY_PACE, SPOOK_PACE = 1.0, 0.85, 0.6   # speeds relative to a mouse
NIBBLE = 0.25                     # a mouse loses this much of a step munching each crumb
CRUMB, BELL, BONK, CATCH = 1, 5, 20, 8               # points
CLEAR_BONUS, SWEEP_BONUS = 25, 25  # every crumb gone (each mouse still in) / every mouse out (each cat)
DEN = (8, 8, 12, 10)              # the cats' basket: x0, y0, x1, y1 (inclusive)
CAT_SPAWNS = [(10, 9), (9, 9), (11, 9), (8, 9), (12, 9), (10, 8)]
MOUSE_SPAWNS = [(7, 17), (13, 17), (3, 17), (17, 17), (9, 17), (11, 17)]
BELLS = [(1, 1), (19, 1), (1, 17), (19, 17)]
INF = 10 ** 6


def make_maze(rng, loops):
    """A left-right symmetric hedge maze with no dead ends. Returns (walls bytearray, tunnel row)."""
    g = [[1] * W for _ in range(H)]
    mid = W // 2
    rooms = [(x, y) for y in range(1, H, 2) for x in range(1, mid, 2)]
    start = rng.choice(rooms)
    g[start[1]][start[0]] = 0
    seen, stack = {start}, [start]
    while stack:  # a random spanning tree over the left half's rooms
        x, y = stack[-1]
        nb = [(x + dx * 2, y + dy * 2) for dx, dy in DIRS
              if 1 <= x + dx * 2 < mid and 1 <= y + dy * 2 <= H - 2 and (x + dx * 2, y + dy * 2) not in seen]
        if not nb:
            stack.pop()
            continue
        nx, ny = rng.choice(nb)
        g[(y + ny) // 2][(x + nx) // 2] = g[ny][nx] = 0
        seen.add((nx, ny))
        stack.append((nx, ny))

    def mirror():
        for row in g:
            for x in range(mid + 1, W):
                row[x] = row[W - 1 - x]

    def walls_of(x, y):  # passage cells from a left-half room (the centre column joins the halves)
        out = []
        for dx, dy in DIRS:
            px, py, rx, ry = x + dx, y + dy, x + dx * 2, y + dy * 2
            if 1 <= rx <= W - 2 and 1 <= ry <= H - 2 and px <= mid:
                out.append((px, py))
        return out

    centre = [y for y in range(1, H, 2)]
    rng.shuffle(centre)
    for y in centre[:3]:  # a few doors straight across the middle
        g[y][mid] = 0
    for (x, y) in rooms:  # extra loops make it a chase, not a labyrinth
        for px, py in walls_of(x, y):
            if g[py][px] and rng.random() < loops:
                g[py][px] = 0
    mirror()
    for _ in range(2):  # braid: knock through every dead end (twice: a knock can't make a new one, but be sure)
        for (x, y) in rooms:
            ws = walls_of(x, y)
            if sum(1 for px, py in ws if not g[py][px]) <= 1:
                shut = [w for w in ws if g[w[1]][w[0]]]
                if shut:
                    px, py = rng.choice(shut)
                    g[py][px] = 0
        mirror()
    x0, y0, x1, y1 = DEN
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = 0
    tunnel = rng.choice([5, 13])
    g[tunnel][0] = g[tunnel][W - 1] = 0
    return bytearray(v for row in g for v in row), tunnel


def in_den(c):
    x, y = c % W, c // W
    return DEN[0] <= x <= DEN[2] and DEN[1] <= y <= DEN[3]


class Whisker(Game):
    id = "whisker"
    category = "action"
    howto = [
        "Each round some players are 🐭 mice and the rest are 🐱 cats — the roles rotate, so everyone hunts.",
        "Mice: nibble crumbs for points. Swipe, use the arrows or the arrow keys — press early to take a corner.",
        "Cats: catch a mouse and you snatch half the crumbs it nibbled this round. Cats run a touch faster.",
        "🔔 A mouse that rings a bell makes every cat panic: bump one then to send it back to its basket.",
        "Most points after every round wins. Run off one side of the tunnel and you pop out the other.",
    ]
    name = "Whisker Run"
    icon = "🐭"
    blurb = "Mice nibble, cats pounce, roles swap every round. Ring the bell and the hunters run."
    min_players = 2
    max_players = 6
    replayable = False
    settings_schema = {
        "speed": ("Speed", [(7.0, "Normal"), (5.5, "Chill"), (8.5, "Fast")], 7.0),
        "length": ("Round length", [(75, "75 s"), (50, "50 s"), (100, "100 s")], 75),
        "laps": ("Rounds", [(1, "Everyone hunts once"), (2, "Everyone hunts twice")], 1),
        "alley": ("🐈‍⬛ Alley cats", [(-1, "Auto: one when mice outnumber cats"), (0, "None"), (1, "1"), (2, "2")], -1),
        "maze": ("Maze", [(0.3, "Roomy"), (0.15, "Twisty"), (0.45, "Wide open")], 0.3),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.score = [0] * len(seated)
        self.round = 0
        self.rounds = len(seated) * self.s.get("laps", 1)
        self.room.turn = None
        self.room.deadline = None
        self.tick = 0
        self.events, self.eid = [], 0
        self.room.add_log(f"🐭 {len(seated)} players, {self.rounds} rounds: everyone takes a turn as a 🐱 cat.", "big")
        self.new_round(time.time())

    def hunters(self, r):
        """Seat indexes that are cats in round r (0-based): spread evenly so everyone hunts as often."""
        n = len(self.seats)
        c = 1 if n <= 3 else 2
        return {(r + j * (n // c)) % n for j in range(c)}

    def new_round(self, now):
        self.round += 1
        self.walls, self.tunnel = make_maze(self.rng, self.s.get("maze", 0.3))
        self.nb = [[self.step_cell(c, d) for d in range(4)] for c in range(W * H)]
        cats = self.hunters(self.round - 1)
        self.ents = []
        ci = mi = 0
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if not p or p.eliminated:
                continue
            if i in cats:
                self.ents.append(self.critter("c", i, CAT_SPAWNS[ci]))
                ci += 1
            else:
                self.ents.append(self.critter("m", i, MOUSE_SPAWNS[mi]))
                mi += 1
        alley = self.s.get("alley", -1)
        if alley < 0:  # a hunter for nobody, when the mice would otherwise run riot
            alley = 1 if mi > ci else 0
        for _ in range(alley):
            self.ents.append(self.critter("a", None, CAT_SPAWNS[ci]))
            ci += 1
        spawns = {e["spawn"] for e in self.ents}
        bells = {y * W + x for x, y in BELLS}
        self.food = {}
        for c in range(W * H):
            if not self.walls[c] and not in_den(c) and c not in spawns:
                self.food[c] = "b" if c in bells else "c"
        self.crumbs_at_start = len(self.food)
        self.eaten = []  # [tick, cell] lately eaten, for the fast channel
        self.stage = "countdown"
        self.next_at = now + COUNTDOWN
        self.end_at = None
        self.synced = self.last_frame = now
        self.acc = 0.0
        self.sent = None
        self.mark_round()
        names = lambda role: ", ".join(self.name_of(e) for e in self.ents if e["role"] == role) or "nobody"
        self.room.add_log(f"🔵 Round {self.round} of {self.rounds} — 🐱 cats: {names('c')} · 🐭 mice: {names('m')}")
        for e in self.ents:
            p = self.room.players.get(self.seats[e["seat"]]) if e["seat"] is not None else None
            if p and not p.bot:
                self.moment("🐱 You're a CAT — catch the mice!" if e["role"] == "c" else "🐭 You're a MOUSE — nibble crumbs, dodge cats!",
                            "cool" if e["role"] == "c" else "gold", None, to=p.id)

    def critter(self, role, seat, xy):
        c = xy[1] * W + xy[0]
        return {"role": role, "seat": seat, "cell": c, "prev": c, "spawn": c, "dir": 0 if role == "m" else 2,
                "pend": None, "acc": 0.0, "lives": LIVES if role == "m" else 0, "out_until": None, "done": False,
                "ghost_until": 0.0, "spook_until": 0.0, "frozen_until": 0.0, "pouch": 0}

    def step_cell(self, c, d):
        """The cell one step from c in direction d (wrapping through the tunnel), or None for a hedge."""
        dx, dy = DIRS[d]
        x, y = c % W + dx, c // W + dy
        if not 0 <= y < H:
            return None
        x %= W
        n = y * W + x
        return None if self.walls[n] else n

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def ent_of(self, i):
        for e in self.ents:
            if e["seat"] == i:
                return e
        return None

    def name_of(self, e):
        if e["seat"] is None:
            return "Alley cat"
        p = self.room.players.get(self.seats[e["seat"]])
        return p.name if p else "?"

    def level_of(self, e):
        if e["seat"] is None:
            return "normal"
        p = self.room.players.get(self.seats[e["seat"]])
        return p.bot if p and p.bot else None

    def is_cat(self, e):
        return e["role"] != "m"

    def speed_of(self, e, now):
        v = self.s.get("speed", 7.0)
        if e["role"] == "m":
            return v
        if e["spook_until"] > now:
            return v * SPOOK_PACE
        return v * (ALLEY_PACE if e["role"] == "a" else CAT_PACE)

    def state_of(self, e, now):
        """0 running · 1 caught, waiting · 2 panicking cat · 3 cat in the basket · 4 blinking mouse · 5 out."""
        if e["done"]:
            return 5
        if e["out_until"] is not None:
            return 1
        if e["frozen_until"] > now:
            return 3
        if e["spook_until"] > now:
            return 2
        if e["ghost_until"] > now:
            return 4
        return 0

    # -- input

    def act(self, p, a):
        raise GameError("Steer with swipes, the arrows or the arrow keys.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        d = a.get("dir")
        if d not in (0, 1, 2, 3) or isinstance(d, bool):
            raise GameError("Bad direction.")
        e = self.ent_of(i)
        if e:
            e["pend"] = d

    # -- simulation

    def frame(self, now):
        dt = min(0.25, max(0.0, now - self.last_frame))
        self.last_frame = now
        if self.stage == "countdown":
            if now >= self.next_at:
                self.stage = "play"
                self.end_at = now + self.s.get("length", 75)
                self.acc = 0.0
                return True
            return False
        if self.stage == "over":
            if now >= self.next_at:
                self.new_round(now)
                return True
            return False
        if self.stage != "play":
            return False
        changed = False
        for e in self.ents:
            if e["out_until"] is not None and now >= e["out_until"]:
                e["out_until"] = None
                e["cell"] = e["prev"] = e["spawn"]
                e["ghost_until"] = now + GHOST
                e["pend"], e["acc"] = None, 0.0
                changed = True
        self.acc += dt * TICK_HZ
        while self.acc >= 1 and self.stage == "play":
            self.acc -= 1
            changed |= self.step(now)
        if self.stage == "play" and now >= self.end_at:
            self.end_round(now, "time")
            changed = True
        if self.stage == "play" and now - self.synced > SYNC_EVERY:
            self.synced = now
            changed = True
        if (self.tick, self.stage) != self.sent:
            self.sent = (self.tick, self.stage)
            self.broadcast(now)
        return changed

    def step(self, now):
        """One tick: critters whose turn it is to move decide (bots) and move; then catches. True if anything big happened."""
        self.tick += 1
        big = False
        for e in self.ents:
            e["prev"] = e["cell"]
        for e in self.ents:
            if e["done"] or e["out_until"] is not None or e["frozen_until"] > now:
                continue
            e["acc"] += self.speed_of(e, now) / TICK_HZ
            if e["acc"] < 1:
                continue
            e["acc"] -= 1
            lvl = self.level_of(e)
            if lvl:
                self.brain(e, lvl, now)
            nb = self.nb[e["cell"]]
            if e["pend"] is not None and nb[e["pend"]] is not None:
                e["dir"], e["pend"] = e["pend"], None
            n = nb[e["dir"]]
            if n is None:  # nose against a hedge: wait there (no banking moves)
                e["acc"] = 0.0
                continue
            e["cell"] = n
            if e["role"] == "m":
                big |= self.nibble(e, n, now)
        big |= self.catches(now)
        if self.stage == "play":
            if not self.food:
                self.end_round(now, "clear")
                big = True
            elif not any(e["role"] == "m" and not e["done"] for e in self.ents):
                self.end_round(now, "sweep")
                big = True
        return big

    def nibble(self, e, c, now):
        kind = self.food.pop(c, None)
        if not kind:
            return False
        self.eaten = (self.eaten + [[self.tick, c]])[-16:]
        pts = BELL if kind == "b" else CRUMB
        e["acc"] -= NIBBLE
        self.score[e["seat"]] += pts
        e["pouch"] += pts
        if kind == "b":
            for o in self.ents:
                if self.is_cat(o) and o["frozen_until"] <= now:
                    o["spook_until"] = now + SPOOK
                    o["dir"] = (o["dir"] + 2) % 4  # startled: they turn tail
            self.event("bell", c, e["seat"])
            self.room.add_log(f"🔔 {self.name_of(e)} rang a bell — the cats panic!", "power")
            return True
        return False

    def catches(self, now):
        big = False
        mice = [e for e in self.ents if e["role"] == "m" and not e["done"] and e["out_until"] is None]
        for cat in self.ents:
            if not self.is_cat(cat) or cat["frozen_until"] > now:
                continue
            for m in mice:
                if m["out_until"] is not None:
                    continue
                met = cat["cell"] == m["cell"] or (cat["prev"] == m["cell"] and m["prev"] == cat["cell"])
                if not met:
                    continue
                if cat["spook_until"] > now:
                    self.bonk(m, cat, now)
                    big = True
                    break
                if m["ghost_until"] > now:
                    continue
                self.catch(cat, m, now)
                big = True
        return big

    def bonk(self, m, cat, now):
        self.score[m["seat"]] += BONK
        m["pouch"] += BONK
        self.event("bonk", cat["cell"], m["seat"])
        cat["cell"] = cat["prev"] = cat["spawn"]
        cat["spook_until"], cat["frozen_until"], cat["acc"], cat["pend"] = 0.0, now + BONK_HOLD, 0.0, None
        self.room.add_log(f"🧹 {self.name_of(m)} bumped {self.name_of(cat)} back to the basket! +{BONK}", "power")
        mb = getattr(self, "bonks", None) or {}
        mb[m["seat"]] = mb.get(m["seat"], 0) + 1
        self.bonks = mb
        if mb[m["seat"]] == 3:
            self.moment(f"🧹 {self.name_of(m)} has sent three cats packing!", "gold", "fanfare")

    def catch(self, cat, m, now):
        lost = m["pouch"] // 2 if cat["role"] == "c" else m["pouch"] // 4
        m["pouch"] -= lost
        self.score[m["seat"]] -= lost
        m["lives"] -= 1
        if cat["role"] == "c":
            self.score[cat["seat"]] += lost + CATCH
            cat["pouch"] += lost + CATCH
        self.event("catch", m["cell"], m["seat"])
        m["pend"], m["acc"] = None, 0.0
        left = f" ({m['lives']} ♥ left)" if m["lives"] else " — out for the round"
        if m["lives"] > 0:
            m["out_until"] = now + RESPAWN
        else:
            m["done"] = True
        gain = f", snatching {lost + CATCH}" if cat["role"] == "c" else f" and scattered {lost} crumbs"
        self.room.add_log(f"🐾 {self.name_of(cat)} caught {self.name_of(m)}{gain}!{left}", "power")
        if cat["role"] == "c" and lost >= 30:
            self.moment(f"🐾 {self.name_of(cat)} snatched {lost + CATCH} from {self.name_of(m)}!", "cool", "crack")

    def event(self, kind, cell, seat):
        self.eid += 1
        self.events = (self.events + [[self.eid, kind, cell, -1 if seat is None else seat]])[-8:]

    def end_round(self, now, why):
        r = self.room
        mice = [e for e in self.ents if e["role"] == "m"]
        cats = [e for e in self.ents if e["role"] == "c"]
        if why == "clear":
            for e in mice:
                if not e["done"]:
                    self.score[e["seat"]] += CLEAR_BONUS
            self.moment(f"🧀 Every crumb nibbled! Mice still running get +{CLEAR_BONUS}.", "gold", "fanfare")
        elif why == "sweep":
            for e in cats:
                self.score[e["seat"]] += SWEEP_BONUS
            self.moment(f"🐾 Every mouse caught! The cats get +{SWEEP_BONUS} each.", "cool", "fanfare")
        else:
            r.add_log(f"⏰ Time! {len(self.food)} crumbs left uneaten.", "big")
        if self.round >= self.rounds:
            self.stage = "done"
            best = max(self.score)
            top = [i for i, s in enumerate(self.score) if s == best]
            p = r.players.get(self.seats[top[0]]) if len(top) == 1 else None
            text = (f"🏆 {p.name} wins with {best} points!" if p else f"🤝 A tie on {best} points!")
            return r.finish(p, text)
        lead = max(range(len(self.seats)), key=lambda i: self.score[i])
        lp = r.players.get(self.seats[lead])
        r.add_log(f"🏁 Round {self.round} done. {lp.name if lp else '?'} leads with {self.score[lead]}.", "big")
        self.stage = "over"
        self.next_at = now + ROUND_PAUSE

    def broadcast(self, now):
        self.room.push_fast({
            "k": self.tick, "st": self.stage, "left": len(self.food), "e": self.eaten, "ev": self.events,
            "t": round(max(0.0, (self.end_at or now) - now), 1) if self.stage == "play" else None,
            "sc": self.score,
            "p": [[e["cell"], e["dir"], self.state_of(e, now), round(self.speed_of(e, now) * 10), e["lives"],
                   max(0, round((e["spook_until"] - now) * 10))] for e in self.ents],
        })

    # -- bots

    def bfs(self, sources, parents=False):
        dist = [-1] * (W * H)
        par = [-1] * (W * H) if parents else None
        q = deque()
        for s in sources:
            if dist[s] < 0:
                dist[s] = 0
                q.append(s)
        nb = self.nb
        while q:
            c = q.popleft()
            dc = dist[c] + 1
            for n in nb[c]:
                if n is not None and dist[n] < 0:
                    dist[n] = dc
                    if parents:
                        par[n] = c
                    q.append(n)
        return dist, par

    def options(self, e):
        """Directions open from e's cell, without turning back unless it's the only way."""
        nb = self.nb[e["cell"]]
        opts = [d for d in range(4) if nb[d] is not None and d != (e["dir"] + 2) % 4]
        return opts or [d for d in range(4) if nb[d] is not None]

    def steer_to(self, e, field, maximise=False):
        nb = self.nb[e["cell"]]
        opts = self.options(e)
        def val(d):
            v = field[nb[d]]
            v = INF if v < 0 else v
            return (-v if maximise else v) + self.rng.random() * 0.1
        e["dir"] = min(opts, key=val)
        e["pend"] = None

    def brain(self, e, level, now):
        if self.is_cat(e):
            self.cat_brain(e, level, now)
        else:
            self.mouse_brain(e, level, now)

    def ahead(self, c, d, k):
        """Up to k cells straight on from c heading d (stops at a hedge)."""
        for _ in range(k):
            n = self.nb[c][d]
            if n is None:
                break
            c = n
        return c

    def cat_brain(self, e, level, now):
        opts = self.options(e)
        if len(opts) == 1:
            e["dir"] = opts[0]
            return
        mice = [m for m in self.ents if m["role"] == "m" and not m["done"] and m["out_until"] is None]
        if level == "easy" and self.rng.random() < 0.3:
            e["dir"] = self.rng.choice(opts)
            return
        if e["spook_until"] > now:  # panicking: get away from the mice
            if mice:
                self.steer_to(e, self.bfs([m["cell"] for m in mice])[0], maximise=True)
            return
        catchable = [m for m in mice if m["ghost_until"] <= now + 0.3] or mice
        if not catchable:
            e["dir"] = self.rng.choice(opts)
            return
        if level == "easy":  # chases the closest mouse as the crow flies
            m = min(catchable, key=lambda m: abs(m["cell"] % W - e["cell"] % W) + abs(m["cell"] // W - e["cell"] // W))
            self.steer_to(e, self.bfs([m["cell"]])[0])
            return
        mine = self.bfs([e["cell"]])[0]
        m = min(catchable, key=lambda m: mine[m["cell"]] if mine[m["cell"]] >= 0 else INF)
        d = mine[m["cell"]]
        target = m["cell"]
        if level == "hard" and d > 2:
            # cut it off: race for the junction it's heading to; if the mouse gets there first, close in directly
            j, k = m["cell"], 0
            while k < 12:
                n = self.nb[j][m["dir"]]
                if n is None:
                    break
                j, k = n, k + 1
                if sum(1 for x in self.nb[j] if x is not None) > 2:
                    break
            target = j if 0 <= mine[j] <= k + 1 else m["cell"]
        elif level == "normal" and d > 4 and self.rng.random() < 0.5:
            target = self.ahead(m["cell"], m["dir"], 2)
        if level == "normal" and self.rng.random() < 0.08:
            e["dir"] = self.rng.choice(opts)
            return
        self.steer_to(e, self.bfs([target])[0])

    def mouse_brain(self, e, level, now):
        cats = [c for c in self.ents if self.is_cat(c) and c["frozen_until"] <= now]
        threats = [c for c in cats if c["spook_until"] <= now + 0.8]
        panicky = [c for c in cats if c["spook_until"] > now + 1.0]
        dc = self.bfs([c["cell"] for c in threats])[0] if threats else None
        dm, par = self.bfs([e["cell"]], parents=True)
        pace = self.s.get("speed", 7.0)
        margin = {"easy": 0, "normal": 2, "hard": 2}[level]
        ghost = e["ghost_until"] > now

        def safe(c):
            if dc is None or ghost and dm[c] < 3:
                return True
            k = dc[c]
            return k < 0 or k > dm[c] * (1 + NIBBLE) * CAT_PACE + margin

        def path(t):
            out = []
            while t != e["cell"] and t >= 0:
                out.append(t)
                t = par[t]
            return out[::-1]

        def go(t):
            p = path(t)
            if p:
                n = p[0]
                for d in range(4):
                    if self.nb[e["cell"]][d] == n:
                        e["dir"], e["pend"] = d, None
                        return True
            return False

        # a panicking cat close by is worth chasing
        if level != "easy" and panicky:
            for c in sorted(panicky, key=lambda c: dm[c["cell"]] if dm[c["cell"]] >= 0 else INF):
                d = dm[c["cell"]]
                if 0 < d <= 9 and (c["spook_until"] - now) * pace * 0.8 > d and (level == "hard" or d <= 5):
                    if all(safe(x) for x in path(c["cell"])) and go(c["cell"]):
                        return
        here = dc[e["cell"]] if dc else -1
        if level != "easy" and 0 <= here <= 5:  # trouble close by: a bell nearby turns it around
            bells = [c for c, k in self.food.items() if k == "b" and 0 < dm[c] <= 7]
            for b in sorted(bells, key=lambda c: dm[c]):
                if all(safe(x) for x in path(b)[:-1]) and go(b):
                    return
        if level == "easy" and 0 <= here <= 2:
            self.steer_to(e, dc, maximise=True)
            return
        food = sorted((c for c in self.food if dm[c] > 0), key=lambda c: dm[c])
        tries = 3 if level == "easy" else 10
        for c in food[:tries]:
            if level == "easy" or all(safe(x) for x in path(c)):
                if go(c):
                    return
        if dc is not None:  # nowhere safe to eat: run for the most room away from the cats
            nb = self.nb[e["cell"]]
            def room_after(d):
                n = nb[d]
                v = dc[n] if dc[n] >= 0 else INF
                return v * 10 + sum(1 for x in self.nb[n] if x is not None) + self.rng.random()
            e["dir"] = max([d for d in range(4) if nb[d] is not None], key=room_after)
            e["pend"] = None
        elif food and go(food[0]):
            return

    # -- the rest of the contract

    def bot_ready(self):
        return False  # bots steer inside frame()

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} left the maze.")
        if i is not None:
            self.ents = [e for e in self.ents if e["seat"] != i]
        left = list(r.contenders())
        if len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")
        elif self.stage == "play" and not any(e["role"] == "m" and not e["done"] for e in self.ents):
            self.end_round(self.last_frame, "time")

    def meta(self, p):
        i = self.seat(p)
        if i is None:
            return ""
        e = self.ent_of(i)
        icon = "" if not e else ("🐱 " if e["role"] == "c" else "🐭 ")
        return f"{icon}{self.score[i]}"

    def final_scores(self):
        return {pid: self.score[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = self.last_frame
        me = self.seat(p)
        mine = next((k for k, e in enumerate(self.ents) if me is not None and e["seat"] == me), None)
        return {"whisker": {
            "w": W, "h": H, "walls": self.walls.hex(), "tunnel": self.tunnel, "den": DEN,
            "seats": self.seats, "me": me, "mine": mine, "stage": self.stage, "round": self.round, "rounds": self.rounds,
            "food": [[c, k] for c, k in self.food.items()], "total": self.crumbs_at_start, "tick": self.tick,
            "score": self.score, "ev": self.events, "lives": LIVES, "spook": SPOOK,
            "ents": [{"role": e["role"], "seat": e["seat"], "cell": e["cell"], "dir": e["dir"], "st": self.state_of(e, now),
                      "v": round(self.speed_of(e, now) * 10), "lives": e["lives"], "pouch": e["pouch"],
                      "back": max(0.0, (e["out_until"] or 0) - now), "spook": max(0.0, e["spook_until"] - now)} for e in self.ents],
            "timeLeft": max(0.0, self.end_at - now) if self.stage == "play" and self.end_at else None,
            "countdown": max(0.0, self.next_at - now) if self.stage in ("countdown", "over") else 0,
            "next": [("c" if i in self.hunters(self.round) else "m") for i in range(len(self.seats))] if self.round < self.rounds else None,
        }}
