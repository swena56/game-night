"""Spire Siege: real-time falling-block battle on a cylindrical tower.

Each player's browser runs its own tower; the server routes attacks, shows everyone's
boards and decides who's still standing. Bots run their towers here, server-side.

Rules: pieces (2-, 3- and 5-block shapes, or an all-4-block set) fall onto a 12-column ring that wraps around.
Filling a whole ring clears it. Clearing 2+ rings at once (or chaining clears) sends junk
rings to a random rival. Power cells trigger when their ring clears: ⚡ surge (rivals fall
faster), 🛡️ shield (blocks the next junk), 💣 blast (removes your bottom two rings).
A block locking above the top of the tower knocks you out. Last spire standing wins."""
import random
import time

from .base import Game, GameError

W, H, BUFFER = 12, 18, 5
SHAPES = {
    "a": [(0, 0), (1, 0)],                          # domino
    "b": [(0, 0), (1, 0), (2, 0)],                  # straight three
    "c": [(0, 0), (1, 0), (0, 1)],                  # corner three
    "d": [(0, 0), (1, 0), (0, 1), (1, 1), (0, 2)],  # P five
    "e": [(0, 0), (2, 0), (0, 1), (1, 1), (2, 1)],  # U five
    "f": [(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)],  # T five
    "g": [(0, 0), (1, 0), (1, 1), (1, 2), (2, 2)],  # S five
    # the 4-block set ("j" is taken by junk)
    "h": [(0, 0), (1, 0), (2, 0), (3, 0)],          # straight four
    "i": [(0, 0), (1, 0), (0, 1), (1, 1)],          # square
    "k": [(0, 0), (1, 0), (2, 0), (1, 1)],          # T four
    "l": [(0, 0), (1, 0), (1, 1), (2, 1)],          # S four
    "m": [(1, 0), (2, 0), (0, 1), (1, 1)],          # Z four
    "n": [(0, 0), (1, 0), (2, 0), (0, 1)],          # J four
    "o": [(0, 0), (1, 0), (2, 0), (2, 1)],          # L four
}
PIECE_SETS = {"mixed": "abcdefg", "four": "hiklmno"}
POWERS = {"1": "surge", "2": "shield", "3": "blast"}
ROW_CHARS = set(".j") | set(SHAPES) | set(POWERS)
SPEEDS = {"chill": 1.0, "normal": 0.75, "fast": 0.5}
SURGE_SECS = 8
POWER_CHANCE = 1 / 8


def attack_for(rings, combo):
    if not rings:
        return 0
    base = {1: 0, 2: 1, 3: 2}.get(rings, 4)
    return base + (1 if combo >= 2 else 0)


def rotations(cells):
    out, cur = [], cells
    for _ in range(4):
        min_x = min(x for x, _ in cur)
        min_y = min(y for _, y in cur)
        norm = sorted((x - min_x, y - min_y) for x, y in cur)
        if norm not in out:
            out.append(norm)
        cur = [(y, -x) for x, y in cur]
    return out


ROTATIONS = {k: rotations(v) for k, v in SHAPES.items()}


class Tower:
    """Server-side tower for bots (and stand-ins for players who dropped out)."""

    def __init__(self, rng, rows=None, flat=False):
        self.rng = rng
        self.flat = flat  # a flat well has side walls instead of wrapping around
        self.grid = [[None] * W for _ in range(H + BUFFER)]
        if rows:
            for y in range(H):
                for x in range(W):
                    ch = rows[y * W + x]
                    self.grid[y][x] = None if ch == "." else ch
        self.combo = 0
        self.shield = 0
        self.dead = False

    def fits(self, cells, px, py, grid=None):
        g = grid or self.grid
        for dx, dy in cells:
            y = py + dy
            if self.flat and not 0 <= px + dx < W:
                return False
            if y < 0 or y >= H + BUFFER or g[y][(px + dx) % W]:
                return False
        return True

    def drop_y(self, cells, px, grid=None):
        y = H
        if not self.fits(cells, px, y, grid):
            return None
        while self.fits(cells, px, y - 1, grid):
            y -= 1
        return y

    @staticmethod
    def clear(grid):
        full = [y for y in range(len(grid)) if all(grid[y])]
        powers = [POWERS[c] for y in full for c in grid[y] if c in POWERS]
        for y in reversed(full):
            del grid[y]
            grid.append([None] * W)
        return len(full), powers

    def add_junk(self, n):
        gap = self.rng.randrange(W)
        for _ in range(n):
            self.grid.insert(0, [None if x == gap else "j" for x in range(W)])
            if any(self.grid.pop()):
                self.dead = True

    def blast(self):
        for _ in range(2):
            del self.grid[0]
            self.grid.append([None] * W)

    def overflow(self):
        return any(any(row) for row in self.grid[H:])

    def rows(self):
        return "".join(c or "." for y in range(H) for c in self.grid[y])

    def evaluate(self, grid, lines):
        heights = []
        holes = 0
        for x in range(W):
            h = 0
            for y in range(H + BUFFER - 1, -1, -1):
                if grid[y][x]:
                    h = y + 1
                    break
            heights.append(h)
            holes += sum(1 for y in range(h) if not grid[y][x])
        bump = sum(abs(heights[x] - heights[(x + 1) % W]) for x in range(W - 1 if self.flat else W))
        top = max(heights)
        return -0.51 * sum(heights) + 0.9 * lines - 0.5 * holes - 0.18 * bump - (8 if top >= H - 2 else 0)

    def best_move(self, kind, level):
        noise = {"easy": 2.5, "normal": 0.6, "hard": 0.0}[level]
        best, best_score = None, -1e9
        for cells in ROTATIONS[kind]:
            for px in range(W):
                py = self.drop_y(cells, px)
                if py is None:
                    continue
                g = [row[:] for row in self.grid]
                for dx, dy in cells:
                    g[py + dy][(px + dx) % W] = kind
                lines, _ = self.clear(g)
                score = self.evaluate(g, lines) + random.uniform(0, noise)
                if score > best_score:
                    best, best_score = (cells, px, py), score
        return best


class Spire(Game):
    id = "spire"
    category = "action"
    howto = [
        'Pieces fall onto a tower that wraps all the way around.',
        '← → move around the tower, ↑ rotate, Space drops. On phones: swipe, tap, swipe down.',
        'Fill a whole ring to clear it. Clear 2+ at once to send junk rings to a rival.',
        'Glowing power cells: ⚡ speed rivals up, 🛡️ block junk, 💣 blast your bottom rings.',
        'Hold (C, Shift, ⇄ or swipe up) parks the falling piece for later, once per piece.',
        'Prefer an upright board? Pick 🧱 Flat well. Prefer plain pieces? Pick the 4-block set.',
    ]
    name = "Spire Siege"
    icon = "🗼"
    blurb = ("Real-time 3D block battle on a spinning tower. Fill a ring to clear it, clear several "
             "at once to bury your rivals in junk. Last spire standing wins.")
    min_players = 1
    max_players = 6
    replayable = False
    settings_schema = {
        "speed": ("Start speed", [("chill", "🐢 Chill"), ("normal", "Normal"), ("fast", "🔥 Fast")], "normal"),
        "powers": ("Power cells", [(True, "On (⚡🛡️💣)"), (False, "Off")], True),
        "board": ("Board", [("tower", "🗼 Tower (wraps around)"), ("flat", "🧱 Flat well (side walls)")], "tower"),
        "pieces": ("Pieces", [("mixed", "🧩 Mixed (2, 3 and 5 blocks)"), ("four", "🟦 4 blocks each")], "mixed"),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seed = rng.getrandbits(30)
        self.t0 = time.time() + 3.5  # countdown
        self.seats = [p.id for p in seated]
        self.eid = 0
        for p in seated:
            g = p.g
            g.rows, g.rings, g.sent, g.shield = "." * (W * H), 0, 0, 0
            g.events, g.applied, g.tower, g.surge_until = [], 0, None, 0
            g.next_at = self.t0 + random.uniform(0.6, 1.2)
        r = self.room
        r.turn = r.deadline = None
        r.bot_at = 0
        r.add_log("🗼 Spire Siege! Fill a whole ring to clear it — clear several at once to send junk.", "big")

    def level(self):
        return max(0, int((time.time() - self.t0) // 30))

    # -- actions from players' browsers

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're out of this round.")
        if t == "board":
            rows = a.get("rows")
            if not isinstance(rows, str) or len(rows) != W * H or not set(rows) <= ROW_CHARS:
                raise GameError("Bad board.")
            p.g.rows = rows
            p.g.shield = max(0, min(9, int(a.get("shield") or 0)))
            return
        if t == "clear":
            rings, combo = a.get("rings"), a.get("combo")
            powers = [x for x in a.get("powers") or [] if x in POWERS.values()][:5]
            if not (isinstance(rings, int) and 1 <= rings <= 5 and isinstance(combo, int) and 0 <= combo <= 50):
                raise GameError("Bad clear.")
            p.g.rings += rings
            return self.on_clear(p, rings, combo, powers)
        if t == "topout":
            return self.knock_out(p)
        raise GameError("Unknown action.")

    def send(self, o, event):
        self.eid += 1
        o.g.events = (o.g.events + [{**event, "id": self.eid}])[-30:]

    def on_clear(self, p, rings, combo, powers):
        r = self.room
        foes = [o for o in r.contenders() if o.id != p.id]
        attack = attack_for(rings, combo)
        if attack and foes:
            target = self.rng.choice(foes)
            self.send(target, {"kind": "junk", "n": attack, "from": p.name})
            p.g.sent += attack
            if attack >= 2:
                r.add_log(f"🗼 {p.name} cleared {rings} ring{'s' * (rings > 1)}"
                          f"{f' (combo ×{combo})' if combo >= 2 else ''} → {attack} junk at {target.name}!", "question")
        if "surge" in powers and foes:
            for o in foes:
                self.send(o, {"kind": "surge", "secs": SURGE_SECS, "from": p.name})
            r.add_log(f"⚡ {p.name} triggered a surge — everyone else falls faster for {SURGE_SECS}s!", "power")
        if "shield" in powers:
            r.add_log(f"🛡️ {p.name} raised a shield.", "power")
        if "blast" in powers:
            r.add_log(f"💣 {p.name} blasted away two rings.", "power")

    def knock_out(self, p):
        r = self.room
        if p.eliminated:
            return
        p.eliminated = True
        left = r.contenders()
        r.add_log(f"💥 {p.name}'s spire toppled with {p.g.rings} rings cleared!", "big")
        if len(self.seats) == 1:
            r.finish(None, f"🗼 Your spire fell after {p.g.rings} rings. Try to beat it!")
        elif len(left) == 1:
            r.finish(left[0], f"🏆 {left[0].name} has the last spire standing!")
        elif not left:
            r.finish(None, "Every spire fell.")

    def on_leave(self, p):
        self.knock_out(p)

    # -- bots: each places a piece on its own clock

    def bot_ready(self):
        now = time.time()
        return any(o.bot and now >= o.g.next_at for o in self.room.contenders())

    def bot_tick(self):
        now = time.time()
        for o in self.room.contenders():
            if o.bot and now >= o.g.next_at and self.room.phase == "playing":
                self.bot_step(o, now)

    def bot_step(self, o, now):
        g = o.g
        if g.tower is None:
            g.tower = Tower(self.rng, g.rows, self.s.get("board") == "flat")
            g.tower.shield = g.shield
            g.applied = max([e["id"] for e in g.events], default=0)  # a stand-in starts fresh
        t = g.tower
        for ev in g.events:
            if ev["id"] <= g.applied:
                continue
            g.applied = ev["id"]
            if ev["kind"] == "junk":
                if t.shield:
                    t.shield -= 1
                else:
                    t.add_junk(ev["n"])
            elif ev["kind"] == "surge":
                g.surge_until = now + ev["secs"]
        if t.dead:
            return self.knock_out(o)
        kind = self.rng.choice(PIECE_SETS[self.s.get("pieces", "mixed")])
        move = t.best_move(kind, o.bot)
        if not move:
            return self.knock_out(o)
        cells, px, py = move
        power_at = self.rng.randrange(len(cells)) if self.s["powers"] and self.rng.random() < POWER_CHANCE else None
        for i, (dx, dy) in enumerate(cells):
            t.grid[py + dy][(px + dx) % W] = self.rng.choice(list(POWERS)) if i == power_at else kind
        lines, powers = t.clear(t.grid)
        t.combo = t.combo + 1 if lines else 0
        if "shield" in powers:
            t.shield += 1
        if "blast" in powers:
            t.blast()
        g.rows, g.shield = t.rows(), t.shield
        if lines:
            g.rings += lines
            self.on_clear(o, lines, t.combo, powers)
        if t.overflow():
            return self.knock_out(o)
        pace = {"easy": 1.6, "normal": 1.05, "hard": 0.62}[o.bot] * (0.9 ** self.level())
        if now < g.surge_until:
            pace *= 0.6
        g.next_at = now + max(0.25, pace * random.uniform(0.85, 1.2))

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "rings"):
            return ""
        return f"🗼 {p.g.rings} rings" + (" · 🛡️" * min(1, p.g.shield))

    def final_scores(self):
        return {i: self.room.players[i].g.rings for i in self.seats if i in self.room.players}

    def view(self, p):
        now = time.time()
        boards = {}
        for i in self.seats:
            o = self.room.players.get(i)
            if o:
                boards[i] = {"rows": o.g.rows, "rings": o.g.rings, "sent": o.g.sent,
                             "shield": o.g.shield, "alive": not o.eliminated}
        mine = p.id in self.seats
        return {"spire": {
            "W": W, "H": H, "buffer": BUFFER, "seed": self.seed + (self.seats.index(p.id) if mine else 0),
            "startIn": max(0.0, self.t0 - now), "elapsed": max(0.0, now - self.t0),
            "speed": SPEEDS[self.s["speed"]], "powers": self.s["powers"], "surgeSecs": SURGE_SECS,
            "flat": self.s.get("board") == "flat", "pieces": PIECE_SETS[self.s.get("pieces", "mixed")], "boards": boards, "events": p.g.events if mine else [], "playing": mine and not p.eliminated,
        }}
