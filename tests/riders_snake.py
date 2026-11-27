"""Light Riders 🐍 Snake mode: a snake crosses its own body, running into another snake kills it (the body
spills into orbs), orbs make it grow, the arena edge only turns it, there is no round clock, and the board takes
the shape of the host's screen.

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


def arena(game="snake", n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game(game)
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
    return (all(g.own[c] == sum(t.count(c) for t in g.trails) for c in range(g.w * g.h))
            and all(bool(g.grid[c]) == (c in cells) for c in range(g.w * g.h))
            and all(g.grid[c] == i + 1 for i, t in enumerate(g.trails) for c in t))


r, g, _ = arena("riders")
check("Light Riders is light cycles only", not g.snake and not g.orbs and "mode" not in r.settings
      and g.view(r.players[g.seats[0]])["riders"]["mode"] == "cycles")
r, g, _ = arena()
check("Orb Snakes is its own game", g.snake and g.id == "snake" and g.view(r.players[g.seats[0]])["riders"]["mode"] == "snake")
check("orbs are green or gold, with few gold ones",
      set(g.orbs.values()) <= {riders.ORB_GROW, riders.GOLD_GROW} and list(g.orbs.values()).count(riders.GOLD_GROW) <= riders.GOLD_MOST)

r, g, sent = arena()
n = g.n
check("snake mode scatters orbs on open cells", len(g.orbs) == g.orb_target() and not any(g.grid[c] for c in g.orbs))

# crossing yourself
place(g, 1, [(30, 30)], 1, 8)
place(g, 0, [(x, 10) for x in range(1, 25)], 1)
steps(g, [2, None, 3, None, None, 0, None, None])  # down two, left three, up and on through its own body
check("a snake crosses its own body, well behind its head, and lives",
      g.alive[0] and g.lives[0] == 3 and g.trails[0][-1] == 9 * n + 21, g.trails[0][-9:])
check("the body keeps its length and the grid matches it", len(g.trails[0]) == 24 and consistent(g))
steps(g, [None] * 14)
check("the grid still matches once the loop has passed", consistent(g))

# its own neck (#347): the five blocks behind its head bite
for name, turns in (("a tight curl back into the 3rd block", [2, 3, 0]), ("a two by three loop into the 5th", [2, 3, None, 0])):
    r2, g2, _ = arena()
    place(g2, 1, [(30, 30)], 1, 8)
    place(g2, 0, [(x, 10) for x in range(5, 17)], 1)
    steps(g2, turns)
    check(f"{name}: a person's last moment holds it", g2.alive[0])
    g2.orbs.clear()
    g2.step(time.time())
    check(f"{name} costs a life", not g2.alive[0] and g2.lives[0] == 2 and consistent(g2), g2.lives)
    check(f"{name} is nobody's trap", not any(getattr(g2, "kills", None) or []))
r2, g2, _ = arena()
place(g2, 1, [(30, 30)], 1, 8)
place(g2, 0, [(x, 10) for x in range(1, 25)], 1)
steps(g2, [2, 3, None, None, None, None, 0, None])  # back up into the 7th block
check("farther back than the neck can be crossed", g2.alive[0] and g2.lives[0] == 3 and g2.trails[0][-1] == 9 * n + 19, g2.trails[0][-9:])

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
g.step(time.time())  # a person's last moment: held for this tick (see below)
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
check("fast updates carry lengths, move counts and orbs, and no clock",
      all(k in sent[-1] for k in ("sq", "sz", "oc", "wn")) and "tl" not in sent[-1])
json.dumps(sent[-1]), json.dumps(g.view(r.players[g.seats[0]]))

# no clock (#345): only a hidden limit ends a round that can't finish
r, g, _ = arena()
check("the view has no time left", "timeLeft" not in g.view(r.players[g.seats[0]])["riders"])
g.ride_at = time.time() - 300
g.last_frame = time.time()
g.frame(time.time())
check("five minutes in, the round is still on", g.stage == "ride", g.stage)
for sizes, want in (([20, 12], 0), ([9, 30], 1), ([14, 14], -1)):
    r, g, _ = arena()
    g.size = list(sizes)
    now = g.ride_at + riders.SNAKE_CAP + 0.1
    g.last_frame = now
    g.frame(now)
    check(f"a stalled round with lengths {sizes} is called", g.stage == "over" and g.won == want and sum(g.wins) == (want >= 0), (g.won, g.wins))

# orb changes: a browser that applies updates, even skipping some, ends up with the server's orbs
for every in (1, 3, 10):
    r, g, sent = arena(n=3, goal=0)
    for p in list(r.players.values()):
        p.bot = "hard"
    full = g.view(r.players[g.seats[0]])["riders"]
    mine, at, stale, now = {c: v for c, v in full["orbs"]}, full["tick"], 0, time.time()
    g.last_frame = now
    for k in range(600):
        now += 0.05
        g.frame(now)
        if not sent or g.stage != "ride":
            break
        if k % (2 * every) == 0:   # only the newest update is read, as on a slow connection
            msg = sent[-1]
            since, changes = msg["oc"]
            if since > at:
                stale += 1
                continue
            for c, v in changes:
                mine.pop(c, None) if not v else mine.__setitem__(c, v)
            at = msg["k"]
    got = {c: v for c, v in sent[-1] and mine.items()}
    if at == g.tick:
        check(f"reading every {every} updates keeps the orbs right", got == g.orbs and not stale, (len(got), len(g.orbs), stale))
    else:
        check(f"reading every {every} updates never falls behind", not stale and at > g.tick - riders.ORB_WINDOW, (at, g.tick, stale))
r, g, sent = arena()
for _ in range(3):
    g.broadcast(time.time())
    g.tick += riders.ORB_WINDOW * 3
g.broadcast(time.time())
check("a browser too far behind is told so (it waits for a full view)", sent[-1]["oc"][0] > 0, sent[-1]["oc"][0])

# turns are numbered: sent at once, so requests can cross, repeat or go missing
r, g, _ = arena()
me = r.players[g.seats[0]]
place(g, 0, [(20, 20)], 1, 8)
g.on_input(me, {"dir": 0, "turns": [[5, 0]]})
g.on_input(me, {"turns": [[5, 0], [6, 3]]})
check("each numbered turn is queued once", list(g.queue[0]) == [0, 3], list(g.queue[0]))
g.on_input(me, {"turns": [[5, 0]]})
check("an older request arriving late changes nothing", list(g.queue[0]) == [0, 3])
g.queue[0].clear()
g.on_input(me, {"turns": [[7, 0], [8, 3], [9, 2]]})
check("a lost request's turn arrives with the next one", list(g.queue[0]) == [0, 3, 2], list(g.queue[0]))
g.on_input(me, {"dir": 0})
for bad in ("x", [[1]], [[1.5, 0]], [[10, 7]], [[10, 0]] * 7, [5]):
    try:
        g.on_input(me, {"turns": bad})
        check(f"bad turns {bad!r} are refused", False)
    except server.GameError:
        pass
check("bad turns are refused", True)

# the last moment: a person gets one tick's grace before running into a snake
def wall(people=True):
    r, g, _ = arena()
    if not people:
        for p in r.players.values():
            p.bot = "easy"
        g.snake_steer = lambda i, level: None
    place(g, 1, [(11, y) for y in range(5, 16)], 2)
    place(g, 0, [(x, 10) for x in range(3, 11)], 1)
    g.ghost = [0, 5]
    return g


g = wall()
steps(g, [None])
check("a person about to crash waits a tick", g.alive[0] and g.trails[0][-1] == 10 * g.w + 10)
steps(g, [0])
check("and a late turn saves it", g.alive[0] and g.trails[0][-1] == 9 * g.w + 10)
g = wall()
steps(g, [None, None])
check("without a turn it crashes on the next tick", not g.alive[0])
g = wall(people=False)
steps(g, [None])
check("computer snakes get no grace", not g.alive[0])

# the goal (#346 follow-up): reaching it takes the round at once
r, g, _ = arena(n=3)
check("no length goal by default (no limit on length)", g.goal == 0 and g.view(r.players[g.seats[0]])["riders"]["goal"] == 0)
g.size = [5000, 20, 20]
check("however long, the round goes on", not g.check_goal(time.time()) and g.stage == "ride")
g.size[0] = 400
place(g, 0, [(5, 10)], 1, 400)
g.orbs = {10 * g.w + 6: riders.GOLD_GROW}
g.step(time.time())
check("a very long snake still grows", g.size[0] == 400 + riders.GOLD_GROW, g.size[0])
r, g, _ = arena(n=3, goal=60)
g.size = [59, 20, 20]
check("one short of the goal isn't enough", not g.check_goal(time.time()) and g.stage == "ride")
g.size = [60, 20, 20]
check("reaching it takes the round", g.check_goal(time.time()) and g.stage == "over" and g.won == 0 and g.wins == [1, 0, 0])
for sizes, want in (([61, 63, 20], 1), ([60, 60, 20], -1)):
    r, g, _ = arena(n=3, goal=60)
    g.size = list(sizes)
    g.check_goal(time.time())
    check(f"two get there at once with lengths {sizes[:2]}", g.won == want, g.won)
r, g, _ = arena(n=3, goal=0)
g.size = [150, 20, 20]
check("last snake alive: length wins nothing", not g.check_goal(time.time()) and g.stage == "ride")
r, g, _ = arena(n=3, goal=60)
g.size, g.alive[0] = [70, 20, 20], False
check("a crashed snake can't reach the goal", not g.check_goal(time.time()))

# a boost costs length, left behind as white orbs
r, g, _ = arena()
place(g, 0, [(x, 10) for x in range(5, 25)], 1)
place(g, 1, [(30, 30)], 1, 8)
tail = g.trails[0][: riders.BOOST_COST]
g.on_input(r.players[g.seats[0]], {"boost": True})
check("a boost costs length", g.size[0] == 20 - riders.BOOST_COST and len(g.trails[0]) == g.size[0] and g.boosting[0], (g.size[0], len(g.trails[0])))
check("and drops it as white orbs", all(g.orbs.get(c) == riders.DROP_GROW and not g.grid[c] for c in tail) and consistent(g))
size = g.size[0]
g.on_input(r.players[g.seats[0]], {"boost": True})
check("no second boost while one is running", g.size[0] == size)
g.boosting[0], g.size[0] = 0, riders.SNAKE_START + riders.BOOST_COST - 1
g.on_input(r.players[g.seats[0]], {"boost": True})
check("a short snake can't boost", not g.boosting[0] and g.size[0] == riders.SNAKE_START + riders.BOOST_COST - 1)
g.on_input(r.players[g.seats[0]], {"brake": True})
check("snakes have no brake", not g.braking[0])
r, g, _ = arena("riders")
g.on_input(r.players[g.seats[0]], {"boost": True})
g.boosting[0] = 0
g.on_input(r.players[g.seats[0]], {"brake": True})
check("light cycles keep their charges and brake", g.boosts[0] == riders.BOOSTS - 1 and g.braking[0])

# only bots left: they don't get to circle for ever
r, g, _ = arena(n=3)
for p in list(r.players.values())[1:]:
    p.bot = "hard"
now = time.time()
check("a person still riding means no limit", not g.only_bots_left(now) and not g.only_bots_left(now + 500))
g.lives[g.seats.index(r.host)] = 0
check("bots alone get a little while", not g.only_bots_left(now) and not g.only_bots_left(now + riders.BOTS_ONLY - 1))
check("then the round is called", g.only_bots_left(now + riders.BOTS_ONLY))

# the board fits the host's screen (#345), only during a countdown, and keeps about the same room
r, g, _ = arena(n=3)
host = r.players[r.host]
guest = next(p for p in r.players.values() if p.id != r.host)
g.on_input(host, {"fit": 1.8})
check("no reshaping while riding", (g.w, g.h) == (g.n, g.n))
g.stage, g.next_at = "countdown", time.time() + 2
rounds, until = g.round, g.next_at
g.on_input(guest, {"fit": 1.8})
check("only the host's screen counts", (g.w, g.h) == (g.n, g.n))
for bad in (0, -1, float("nan"), float("inf"), "2", None):
    g.on_input(host, {"fit": bad})
check("nonsense shapes are ignored", (g.w, g.h) == (g.n, g.n))
g.on_input(host, {"fit": 1.8})
check("a wide screen gets a wide board", g.w > g.n > g.h and abs(g.w / g.h - 1.8) < 0.1 and abs(g.w * g.h / g.n ** 2 - 1) < 0.05, (g.w, g.h))
check("the same round carries on, with its countdown", (g.round, g.next_at, g.stage) == (rounds, until, "countdown"))
cells = [c for t in g.trails for c in t]
check("snakes and orbs are laid out on the new board",
      len(g.grid) == g.w * g.h and len(cells) == 3 and all(0 <= c < g.w * g.h for c in cells) and len(g.orbs) == g.orb_target())
g.last_frame = time.time()
view = g.view(host)["riders"]
check("everyone is sent the new shape", g.frame(time.time()) and (view["w"], view["h"]) == (g.w, g.h) and not g.frame(time.time()))
g.on_input(host, {"fit": 9})
check("very wide screens are limited", abs(g.w / g.h - riders.FIT_MAX) < 0.1, (g.w, g.h))
g.on_input(host, {"fit": 0.1})
check("very tall screens are limited", abs(g.w / g.h - riders.FIT_MIN) < 0.05, (g.w, g.h))

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
    g.fit({"easy": 1.7, "normal": 0.7, "hard": 2.0}[level])
    k, ok, longest, began = 0, True, 0, now
    while r.phase == "playing" and k < 150000:
        k, now = k + 1, now + 0.05
        was = g.stage
        g.frame(now)
        if was != "ride" and g.stage == "ride":
            began = now
        if g.stage == "ride":
            longest = max(longest, now - began)
        if k % 100 == 0:
            ok = ok and consistent(g)
    check(f"{level} bots finish a match", r.phase == "over" and ok and consistent(g), (r.phase, g.wins, g.round, f"longest round {longest:.0f}s"))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
