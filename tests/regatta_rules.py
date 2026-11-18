"""Regatta rules: the polar (no speed in irons, fastest across the wind), boats speed up toward it, tacks cost speed,
gusts add wind and wind shadows take it, buoys round in order, the finish line finishes, bumps push boats apart,
bad input is refused, bots sail a whole race, and the regatta ends. 🏴‍☠️ Cannons (#176): aim abeam only, a shot
spends a ball, leads the target and lands later, a hit knocks the wind out (then cover), reloads favour the boats
behind, kegs, the pirate ship, pirates off, old saves, and bots fire.

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
# #150: a pointed heading: the helm turns to it and holds it; a rudder input or a tack takes over
A.x, A.y, A.h, A.v = -40, 0, 0.0, 4.0
g.on_input(a, {"head": 0.6})
check("head sets a goal", A.goal is not None and abs(A.goal - 0.6) < 1e-9 and A.steer == 0)
clock = run(g, r, 2.5, clock)
check("the boat turns to the pointed heading and holds it", abs(R.wrap(A.h - 0.6)) < 0.02, f"{A.h:.3f}")
try:
    g.on_input(a, {"head": float("inf")})
    check("bad heading refused", False)
except GameError:
    check("bad heading refused", True)
g.on_input(a, {"steer": 0.5})
check("a rudder input clears the goal", A.goal is None)
g.on_input(a, {"head": 0.3}); g.tack(0)
check("a tack clears the goal", A.goal is None and A.auto is not None)
A.auto = None; A.steer = 0.0
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

# -- 🏴‍☠️ cannons (#176)
import pickle  # noqa: E402
r, g, (a, b, c) = game(3)
check("pirates on by default: a pirate ship and kegs", g.guns and g.npc is not None and len(g.kegs) == len(g.course["marks"]))
clock = run(g, r, R.COUNTDOWN + 0.1, g.go_at - R.COUNTDOWN)
A, B, C = g.boats
g.npc.cx = g.npc.cy = 900.0
g.npc.x = g.npc.y = 900.0
g.kegs = []
A.x, A.y, A.h, A.v = 0.0, 60.0, 0.0, 4.0           # heading east
B.x, B.y, B.h, B.v = 0.0, 80.0, 0.0, 4.0           # 20 m to port (abeam)
C.x, C.y, C.h, C.v = 20.0, 60.0, 0.0, 4.0          # 20 m dead ahead
t = g.aim(0, clock)
check("aims at the rival abeam, not the one dead ahead", t and t[1] == 1 and t[3] == 1, str(t))
C.x, C.y = 60.0, 60.0
B.x, B.y = 0.0, 60.0 + R.RANGE + 2
check("nobody abeam in range: no target", g.aim(0, clock) is None)
B.x, B.y = 0.0, 80.0
A.ammo, A.fire_at = 0, 0.0
check("no ball, no shot", not g.fire(0, clock))
A.ammo = 2
rng0 = g.rng
g.rng = type("Steady", (), {"gauss": staticmethod(lambda m, sd: 0.0), "choice": staticmethod(lambda xs: xs[0])})()
check("a shot fires", g.fire(0, clock) and A.ammo == 1 and len(g.balls) == 1)
check("…not again straight away", not g.fire(0, clock) and A.ammo == 1)
ball = g.balls[0]
check("the ball leads the target and lands later", ball[6] > clock + 0.4 and ball[3] > B.x + 1, str(ball))
g.rng = rng0
try:
    g.on_input(a, {"fire": "yes"})
    check("bad fire refused", False)
except GameError:
    check("bad fire refused", True)
# a ball landing on B: hit, sails knocked flat, then cover
g.balls = [[99, 0.0, 70.0, B.x, B.y, clock - 1, clock, 0, 1]]
v0 = B.v
g.land(g.balls.pop(), clock)
check("a hit knocks the speed down and the wind out of the sails", B.v < v0 * 0.6 and B.stun > clock and B.guard > B.stun, f"{B.v:.2f}")
check("…and counts for the gunner", A.hits == 1 and any(e[2][0] == "hit" for e in g.events))
v1 = B.v
g.land([100, 0.0, 70.0, B.x, B.y, clock - 1, clock, 2, 1], clock)
check("under cover a second ball does nothing", B.v == v1 and C.hits == 0)
check("a boat under cover can't be aimed at", g.aim(0, clock) is None or g.aim(0, clock)[1] != 1)
# stunned sails: a boat on a beam reach goes slower than an unhurt one
B.guard = B.stun = 0.0
for o, y in ((A, 20.0), (B, 140.0)):
    o.x, o.y, o.h, o.v, o.goal, o.auto, o.steer = -60.0, y, 0.0, 0.0, None, None, 0.0
C.x, C.y = 500.0, 500.0
g.gusts = []
g.wind_base = g.shift_to = g.wind_dir = math.pi / 2
g.shift_at = clock + 999
B.stun = clock + 99
clock = run(g, r, 4, clock)
check("torn sails sail slower", B.v < A.v * 0.6, f"{B.v:.2f} vs {A.v:.2f}")
B.stun = 0.0
# reloads: one ball per RELOAD for the boats behind, slower for the leader
A.ammo = B.ammo = C.ammo = 0
A.reload = B.reload = C.reload = 0.0
g.ranks = [0, 1, 2]
g.steps = 1
g.cannons(1.0, clock)
check("the leader reloads slower than the boats behind", A.reload < B.reload < C.reload, f"{A.reload} {B.reload} {C.reload}")
B.reload = R.RELOAD - 0.01
g.cannons(0.1, clock)
check("a full reload adds a ball", B.ammo == 1 and B.reload == 0.0)
# kegs
g.kegs = [[B.x, B.y, 0.0]]
g.cannons(0.01, clock)
check("a powder keg gives a ball, then floats back later", B.ammo == 2 and g.kegs[0][2] > clock)
# the pirate ship: fires at a boat in range; hit it to silence it and plunder a ball
n = g.npc
n.cx, n.cy, n.quiet, n.fire_at = A.x + 10 - R.NPC_LOOP, A.y, 0.0, 0.0
nb = len(g.balls)
g.pirate(0.0, clock)
check("the pirate ship fires at a boat in range", len(g.balls) == nb + 1 and g.balls[-1][7] == -1)
A.ammo = 0
g.land([101, A.x, A.y, n.x, n.y, clock - 1, clock, 0, -1], clock)
check("hitting the pirate ship silences it and plunders a ball", n.quiet > clock + 5 and A.ammo == 1)
json.dumps(g.view(a))
st = g.state(clock)
check("state streams ammo, the ship, kegs and balls", len(st["b"][0]) == 15 and st["np"] and "kg" in st and "bl" in st)
# pirates off: plain racing
r2, g2, (a2, b2) = game(2, pirates="off")
check("pirates off: no ship, no kegs", not g2.guns and g2.npc is None and not g2.kegs)
try:
    g2.on_input(a2, {"fire": True})
    check("pirates off: fire refused", False)
except GameError:
    check("pirates off: fire refused", True)
# a regatta saved before #176
st0 = {k: v for k, v in g2.__dict__.items() if k not in ("guns", "balls", "kegs", "npc", "ranks", "said", "ball_seq")}
st0["boats"] = []
for bt in g2.boats:
    nb = R.Boat.__new__(R.Boat)
    nb.__dict__.update({k: v for k, v in bt.__dict__.items() if k not in ("ammo", "reload", "fire_at", "stun", "guard", "hits", "last_hit")})
    st0["boats"].append(nb)
old = R.Regatta.__new__(R.Regatta)
old.__setstate__(st0)
check("an old save loads without cannons", old.guns is False and old.npc is None and old.boats[0].ammo == 0)
old.cannons(0.1, clock); json.dumps(old.state(clock))

# -- bots sail a whole regatta
r, g, ps = game(3, course="short", pirates="off")
for p in ps:
    p.bot = "normal"
clock = run(g, r, 400, g.go_at - R.COUNTDOWN)
check("a bot regatta finishes", r.phase == "over", g.stage)
check("bots finished the course", sum(1 for x in g.results[-1] if x[1]) >= 2, str(g.results))
r, g, ps = game(3, course="short")
for p in ps:
    p.bot = "normal"
clock = run(g, r, 400, g.go_at - R.COUNTDOWN)
check("a pirate regatta finishes", r.phase == "over" and g.results[-1][0][1], str(g.results))
check("bots fired their cannons", g.ball_seq >= 3, str(g.ball_seq))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
