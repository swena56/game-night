"""Regatta rules: the polar (no speed in irons, fastest across the wind), boats speed up toward it, tacks cost speed,
gusts add wind and wind shadows take it, buoys round in order, the finish line finishes, bumps push boats apart,
bad input is refused, bots sail a whole race, and the regatta ends.

    python3 tests/regatta_rules.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import regatta as R  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("regatta")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def run(g, r, secs, clock):
    for _ in range(int(secs * 60)):
        clock += 1 / 60
        with r.cond:
            g.frame(clock)
        if r.phase != "playing":
            break
    return clock


# -- the polar
check("no speed in irons", R.polar(0) == 0 and R.polar(R.NOGO - 1) == 0)
check("fastest across the wind", R.polar(95) == max(R.polar(a) for a in range(0, 181)))
check("slower dead downwind than on a reach", R.polar(180) < R.polar(120))

r, g, (a, b) = game()
check("starts on the countdown", g.stage == "countdown")
try:
    g.on_input(a, {"steer": float("nan")})
    check("NaN steer refused", False)
except GameError:
    check("NaN steer refused", True)
try:
    g.on_input(a, {"tack": 1})
    check("bad tack refused", False)
except GameError:
    check("bad tack refused", True)
try:
    g.act(a, {"type": "x"})
    check("acts are refused (steering is input)", False)
except GameError:
    check("acts are refused (steering is input)", True)
clock = run(g, r, R.COUNTDOWN + 0.1, g.go_at - R.COUNTDOWN)
check("the race starts", g.stage == "race")
g.gusts = []
# a boat on a beam reach speeds up; one pointed into the wind stalls
A, B = g.boats
A.x, A.y, A.h, A.v = -40, 50, 0.0, 0.0            # east: the wind is from the north, so a beam reach
B.x, B.y, B.h, B.v = 40, 50, g.wind_dir, 3.0       # straight into the wind
g.wind_base = g.shift_to = g.wind_dir
g.shift_at = clock + 999
clock = run(g, r, 6, clock)
check("a boat across the wind picks up speed", A.v > 4, f"{A.v:.2f}")
check("a boat into the wind stalls (in irons)", B.v < 0.6 and B.irons, f"{B.v:.2f}")
# a tack mirrors the heading across the wind and costs speed
A.h = g.wind_dir + math.radians(50)
A.v = 4.0
A.side = 0
clock = run(g, r, 0.2, clock)
v0 = A.v
g.tack(0)
target = A.auto
clock = run(g, r, 3, clock)
check("⟲ tack turns to the mirrored heading", target is not None and abs(R.wrap(A.h - target)) < 0.1, f"{A.h:.2f} {target}")
check("…and costs some speed", any(e[2][0] == "tack" for e in g.events) or A.v < v0)
# gusts and shadows
sp0 = g.wind_at(0, 300)[0]
g.gusts = [[0.0, 300.0, 20.0]]
check("a gust adds wind", abs(g.wind_at(0, 300)[0] - sp0 * (1 + R.GUST_UP)) < 1e-6)
g.gusts = []
A.x, A.y = 0, 100
to = g.wind_to()
sx, sy = A.x + math.cos(to) * 10, A.y + math.sin(to) * 10
check("just downwind of a sail is a wind shadow", g.wind_at(sx, sy, 1)[2] and not g.wind_at(sx + 20, sy, 1)[2])
# buoys in order, then the finish
B.mark = 0
mx, my = g.course["marks"][1]
B.x, B.y = mx, my
g.progress(1, B, clock)
check("the wrong buoy doesn't count", B.mark == 0)
B.x, B.y = g.course["marks"][0]
g.progress(1, B, clock)
check("the right buoy rounds", B.mark == 1)
B.mark = len(g.course["marks"])
B.x, B.y = 0.0, g.course["finish"][0][1] - 1
g.progress(1, B, clock)
check("crossing the line after the last buoy finishes", B.done_at and B.place == 1)
# bumps
A.x, A.y, B.x, B.y = 0, 0, 1, 0
B.done_at = 0
g.collide(clock)
check("touching boats are pushed apart", math.hypot(A.x - B.x, A.y - B.y) >= 2 * R.BOAT_R - 1e-6)
json.dumps(g.view(a))
json.dumps(g.state(clock))

# -- bots sail a whole regatta
r, g, ps = game(3, course="short")
for p in ps:
    p.bot = "normal"
clock = run(g, r, 400, g.go_at - R.COUNTDOWN)
check("a bot regatta finishes", r.phase == "over", g.stage)
check("bots finished the course", sum(1 for x in g.results[-1] if x[1]) >= 2, str(g.results))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
