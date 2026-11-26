"""Light Riders 🐍 Snake mode: a snake crosses its own body, running into another snake kills it (the body
spills into orbs), orbs make it grow, the arena edge only turns it, and the round clock picks the longest.

    python3 tests/riders_snake.py
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import riders  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def arena(mode="snake", n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("riders")
    if mode:
        r.settings["mode"] = mode
    r.settings.update(settings)
    r.start()
    sent = []
    r.push_fast = lambda d: sent.append(d)
    g = r.game
    g.stage, g.ride_at = "ride", time.time()
    return r, g, sent


def place(g, i, cells, d, size=None):
    """Lay snake i along `cells` (tail first), heading d."""
    for c in g.trails[i]:
        g.grid[c], g.own[c] = 0, 0
    g.trails[i], g.size[i], g.dirs[i] = [], size or len(cells), d
    g.queue[i].clear()
    g.orbs.clear()
    for x, y in cells:
        g.occupy(i, x, y)


def steps(g, turns, i=0):
    for d in turns:
        if d is not None:
            g.queue[i].append(d)
        g.orbs.clear()
        g.step(time.time())


def consistent(g):
    cells = [c for t in g.trails for c in t]
    return (all(g.own[c] == sum(t.count(c) for t in g.trails) for c in range(g.n * g.n))
            and all(bool(g.grid[c]) == (c in cells) for c in range(g.n * g.n))
            and all(g.grid[c] == i + 1 for i, t in enumerate(g.trails) for c in t))


r, g, _ = arena(None)
check("light cycles stay the default", not g.snake and not g.orbs and g.view(r.players[g.seats[0]])["riders"]["mode"] == "cycles")

r, g, sent = arena()
n = g.n
check("snake mode scatters orbs on open cells", len(g.orbs) == g.orb_target() and not any(g.grid[c] for c in g.orbs))

# crossing yourself
place(g, 1, [(30, 30)], 1, 8)
place(g, 0, [(x, 10) for x in range(5, 17)], 1)
steps(g, [2, 3, 0, None])  # down, left, up and on through its own body
check("a snake crosses its own body and lives", g.alive[0] and g.lives[0] == 3 and g.trails[0][-1] == 9 * n + 15, g.trails[0][-5:])
check("the body keeps its length and the grid matches it", len(g.trails[0]) == 12 and consistent(g))
steps(g, [None] * 14)
check("the grid still matches once the loop has passed", consistent(g))

# orbs
place(g, 0, [(x, 10) for x in range(5, 11)], 1)
before = g.size[0]
g.orbs = {10 * n + 11: riders.ORB_GROW}
g.step(time.time())
check("an orb makes the snake grow", g.size[0] == before + riders.ORB_GROW and 10 * n + 11 not in g.orbs)
steps(g, [None] * 3)
check("the body reaches its new length", len(g.trails[0]) == before + riders.ORB_GROW and consistent(g))

# the edge turns, never kills
for name, cells, d in (("right wall", [(n - 3, 10), (n - 2, 10), (n - 1, 10)], 1),
                       ("corner", [(0, 2), (0, 1), (0, 0)], 0)):
    place(g, 0, cells, d)
    g.step(time.time())
    check(f"the {name} turns the snake", g.alive[0] and g.lives[0] == 3 and len(g.trails[0]) == 3, g.dirs[0])
place(g, 0, [(8, 0), (9, 0), (10, 0)], 1)
steps(g, [0])  # steering into the wall: carry on along it, not back over itself
check("steering into the edge keeps the old heading", g.alive[0] and g.dirs[0] == 1 and g.trails[0][-1] == 11)

# another snake kills
place(g, 1, [(20, y) for y in range(15, 26)], 2)
place(g, 0, [(x, 20) for x in range(14, 20)], 1)
g.orbs.clear()
body = list(g.trails[0])
g.step(time.time())
check("running into another snake costs a life", not g.alive[0] and g.alive[1] and g.lives[0] == 2)
check("the dead body spills into orbs and leaves the grid", not g.trails[0] and any(c in g.orbs for c in body) and consistent(g))
check("a kill is credited", g.kills[1] == 1)
g.respawn(0)
check("a respawned snake starts short again", g.alive[0] and g.size[0] == riders.SNAKE_START and consistent(g))

# head-on
place(g, 0, [(8, 30), (9, 30)], 1)
place(g, 1, [(12, 30), (11, 30)], 3)
g.ghost = [0, 0]
g.step(time.time())
check("head-on kills both", not g.alive[0] and not g.alive[1])

# fast updates and views
r, g, sent = arena()
g.broadcast(time.time())
check("fast updates carry lengths, move counts, orbs and the clock", all(k in sent[-1] for k in ("sq", "sz", "or", "tl", "wn")))
json.dumps(sent[-1]), json.dumps(g.view(r.players[g.seats[0]]))

# the round clock
for sizes, want in (([20, 12], 0), ([9, 30], 1), ([14, 14], -1)):
    r, g, _ = arena()
    g.size = list(sizes)
    now = g.ride_at + riders.SNAKE_ROUND + 0.1
    g.last_frame = now
    g.frame(now)
    check(f"time up with lengths {sizes}", g.stage == "over" and g.won == want and sum(g.wins) == (want >= 0), (g.won, g.wins))

# closing arena and power-ups belong to light cycles
r, g, _ = arena(shrink=True, pickups=True)
now = g.ride_at = time.time() - riders.SHRINK_AFTER - 5
now += riders.SHRINK_AFTER + 5
g.last_frame = now
g.frame(now)
check("no walls closing in or power-ups in snake mode", g.ring == 0 and not g.items)

# leaving clears the snake
r, g, _ = arena(n=3)
g.on_leave(r.players[g.seats[2]])
check("a leaver's snake leaves the grid", not g.trails[2] and consistent(g))

# bots play a whole match without the grid drifting out of step
for level in ("easy", "normal", "hard"):
    r, g, _ = arena(n=3, target=2)
    for p in r.players.values():
        p.bot = level
    g.stage, now = "countdown", time.time()
    g.next_at = g.last_frame = now
    k, ok = 0, True
    while r.phase == "playing" and k < 60000:
        k, now = k + 1, now + 0.05
        g.frame(now)
        if k % 100 == 0:
            ok = ok and consistent(g)
    check(f"{level} bots finish a match", r.phase == "over" and ok and consistent(g), (r.phase, g.wins, g.round))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
