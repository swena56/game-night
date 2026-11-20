"""Whisker Run: maze sizes and themes, mouse holes (mice through, cats not, a paw reaches in), the glide
head start in fast updates, and whole bot games at every table size.

    python3 tests/whisker_rules.py
"""
import os
import random
import sys
import time
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import whisker as wk  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(n, bot="normal", **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di", "Ed", "Flo")[:n]]
    for p in ps:
        p.bot = bot
    r.switch_game("whisker")
    r.settings.update(settings)
    r.start()
    sent = []
    r.push_fast = sent.append
    return r, r.game, sent


def reach(g, start, cats):
    nb = g.nbc if cats else g.nb
    seen, q = {start}, deque([start])
    while q:
        for n in nb[q.popleft()]:
            if n is not None and n not in seen:
                seen.add(n)
                q.append(n)
    return seen


# -- mazes
rng = random.Random(7)
bad = []
for size in list(wk.SIZES.values()) + [wk.BIG]:
    for t in wk.THEMES:
        for _ in range(15):
            w, h = size
            cells, tunnel = wk.make_maze(rng, 0.3, w, h, t["bias"], t["holes"])
            grid = [cells[y * w:(y + 1) * w] for y in range(h)]
            if any(row[x] != row[w - 1 - x] for row in grid for x in range(w)):
                bad.append(("mirror", size, t["id"]))
            holes = sum(1 for v in cells if v == wk.HOLE)
            if holes != 2 * t["holes"]:
                bad.append(("holes", size, t["id"], holes))
            for y in range(1, h - 1):  # braided: no room is a dead end (counting holes as open, for mice)
                for x in range(1, w - 1, 2):
                    if y % 2 and not grid[y][x] and sum(1 for dx, dy in wk.DIRS if grid[y + dy][x + dx] != wk.HEDGE) < 2:
                        bad.append(("dead end", size, t["id"], x, y))
check("mazes: mirrored, the right number of holes, no dead ends", not bad, bad[:3])

for n, want in ((2, (21, 19)), (3, (25, 19)), (4, (25, 19)), (5, (25, 23)), (6, (29, 23))):
    r, g, _ = table(n)
    check(f"{n} players → a {want[0]}×{want[1]} maze", (g.w, g.h) == want, (g.w, g.h))
    open_cells = [c for c in range(g.w * g.h) if g.walls[c] == wk.OPEN]
    check(f"{n} players: cats can reach every open cell without the holes",
          set(open_cells) <= reach(g, g.ents[0]["spawn"], True))
    spawns = [e["spawn"] for e in g.ents]
    check(f"{n} players: every spawn is open and distinct", len(set(spawns)) == len(spawns)
          and all(g.walls[c] == wk.OPEN for c in spawns))
    v = g.view(r.players[g.seats[0]])["whisker"]
    check(f"{n} players: the view carries the size, theme and walls", v["w"] == g.w and v["h"] == g.h
          and len(v["walls"]) == 2 * g.w * g.h and v["theme"] == "garden" and v["themeName"])

r, g, _ = table(2, laps=2)
seen = []
for _ in range(3):
    seen.append(g.theme["id"])
    g.end_round(time.time(), "time")
    g.new_round(time.time())
check("themes take turns round by round", seen == ["garden", "pantry", "cellar"], seen)

# -- mouse holes
r, g, sent = table(2)
hole = next(c for c in range(g.w * g.h) if g.walls[c] == wk.HOLE)
sides = [n for n in g.nb[hole] if n is not None]
check("a hole joins two open cells for mice", len(sides) == 2 and all(g.walls[s] == wk.OPEN for s in sides))
check("cats can't step into a hole", all(hole not in g.nbc[s] for s in sides) and hole in g.nb[sides[0]])
mouse = next(e for e in g.ents if e["role"] == "m")
cat = next(e for e in g.ents if e["role"] == "c")
now = time.time()
g.stage, g.end_at = "play", now + 60
mouse["cell"] = mouse["prev"] = hole
cat["cell"] = cat["prev"] = sides[0]
mouse["ghost_until"] = 0
g.catches(now)
check("a cat at the mouth reaches in and catches a mouse in the hole", mouse["lives"] == wk.LIVES - 1)

r, g, sent = table(2)
hole = next(c for c in range(g.w * g.h) if g.walls[c] == wk.HOLE)
side = next(n for n in g.nb[hole] if n is not None)
mouse = next(e for e in g.ents if e["role"] == "m")
r.players[g.seats[mouse["seat"]]].bot = None  # steered by the test, not a bot brain
for e in g.ents:
    e["frozen_until"] = 1e18 if e is not mouse else 0  # only the mouse moves
d = next(d for d in range(4) if g.nb[side][d] == hole)
mouse["cell"] = mouse["prev"] = side
mouse["dir"], mouse["acc"] = d, 0.99
g.stage, g.end_at = "play", time.time() + 60
g.step(time.time())
check("a mouse steps into a hole, and squeezing costs it", mouse["cell"] == hole and mouse["acc"] < 0.99 + 7 / 15 - 1 - wk.SQUEEZE + 0.01,
      round(mouse["acc"], 2))

# -- fast updates carry the head start
r, g, sent = table(2)
now = time.time()
g.last_frame = now
g.next_at = now
for _ in range(60):
    now += 1 / 60
    g.frame(now)
p = sent[-1]["p"][0]
check("fast updates send 7 fields per critter, the last the step's head start", len(p) == 7 and -100 <= p[6] <= 100, p)

# -- ⚡ a zoomies pickup grows back after ZOOM_BACK seconds
r, g, _ = table(2)
now = time.time()
g.last_frame, g.next_at = now, now
g.frame(now + 0.01)
zc = next(c for c, k in g.food.items() if k == "z")
mouse = next(e for e in g.ents if e["role"] == "m")
g.nibble(mouse, zc, now)
check("eaten zoomies is gone at first", zc not in g.food)
mouse["cell"] = g.ents[0]["spawn"] if g.ents[0] is not mouse else g.ents[1]["spawn"]
g.step(now + wk.ZOOM_BACK + 1)
check("zoomies grows back later", g.food.get(zc) == "z")

# -- whole games at every size, every bot level
for n in (2, 3, 4, 5, 6):
    for bot in ("easy", "normal", "hard"):
        r, g, _ = table(n, bot)
        now = time.time()
        g.last_frame, g.next_at = now, now
        t0 = time.perf_counter()
        steps = 0
        while r.phase == "playing" and steps < 60 * 60 * 12:
            now += 1 / 30
            g.frame(now)
            steps += 1
        cpu = (time.perf_counter() - t0) / max(1, steps) * 1000
        check(f"{n}p {bot}: the game ends ({g.round} rounds), {cpu:.2f} ms a frame", r.phase != "playing" and cpu < 2)

# late turns: a swipe just after passing a side opening steps back into it
r, g, _ = table(2)
m = next(e for e in g.ents if e["role"] == "m")
now = time.time(); g.stage = "play"; m["out_until"] = None; m["frozen_until"] = 0
cell = next(c for c, nb in enumerate(g.nb) if nb and nb[0] is not None and nb[1] is not None and g.nb[nb[0]] and g.nb[nb[0]][1] is None)
fwd = g.nb[cell][0]
m["cell"], m["from"], m["dir"], m["moved_at"] = fwd, cell, 0, now
g.late_turn(m, 1, now + 0.1)
check("a late swipe turns back into the missed opening", m["cell"] == cell and m["dir"] == 1, (m["cell"], cell, m["dir"]))
m["cell"], m["from"], m["dir"], m["moved_at"] = fwd, cell, 0, now
g.late_turn(m, 1, now + 1.0)
check("a swipe far too late is left alone", m["cell"] == fwd and m["dir"] == 0)

# -- ⚡ zoomies
r, g, _ = table(2)
mz = next(e for e in g.ents if e["role"] == "m")
zc = next((c for c, k in g.food.items() if k == "z"), None)
check("the maze has zoomies pickups", zc is not None and sum(1 for k in g.food.values() if k == "z") == 2)
now = time.time()
base = g.speed_of(mz, now)
g.nibble(mz, zc, now)
check("zoomies makes a mouse faster", g.speed_of(mz, now) > base * 1.3 and mz["zoom_until"] > now)
check("and wears off", g.speed_of(mz, now + wk.ZOOM_SECS + 0.1) == base)

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
