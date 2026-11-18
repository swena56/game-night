"""Orbit Golf rules: probes fly straight in empty space and curve near planets, come to rest, drop in the cup when
slow and lip out when fast, black holes and deep space cost a stroke and send you back, wormholes carry you through,
rocks bounce, turns go to whoever is furthest, bad launches are refused, and the holes run to the end.

    python3 tests/orbit_rules.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import orbit as O  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def hole(**kw):
    h = {"planets": [], "blacks": [], "rocks": [], "worms": [], "cup": (0.0, 99.0), "feature": "twin"}
    h.update(kw)
    return h


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("orbit")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


# -- physics
path, ev, res, end = O.simulate(hole(), O.TEE, 0, 0.5)
check("empty space: straight up the course", abs(end[0]) < 1e-6 and end[1] > O.TEE[1] + 5 and res == "rest", str(end))
check("paths start where you hit from", path[0][1:3] == list(O.TEE))
_, _, _, e2 = O.simulate(hole(), O.TEE, 0, 0.8)
check("more power goes further", e2[1] > end[1])
_, _, _, e3 = O.simulate(hole(), O.TEE, 90, 0.4)
check("90° launches to the right", e3[0] > 3 and abs(e3[1] - O.TEE[1]) < 1e-6, str(e3))
_, _, _, bent = O.simulate(hole(planets=[(4.0, -6.0, 2.0, 0)]), O.TEE, 0, 0.6)
check("a planet bends the path toward it", bent[0] > 0.5, str(bent))
_, ev, res, rest = O.simulate(hole(planets=[(0.0, -9.0, 2.5, 0)]), O.TEE, 0, 0.6)
d = math.hypot(rest[0], rest[1] + 9)
check("a probe hitting a planet ends up resting on its surface", res == "rest" and abs(d - 2.5 - O.PROBE_R) < 0.05, f"{d:.2f}")
check("a hard hit on a planet is a bump", any(e[1] == "bump" for e in ev))
_, ev, res, _ = O.simulate(hole(cup=(0.0, -10.0)), (0.0, -16.0), 0, 0.3)
check("a slow probe drops in the cup", res == "cup", str(res))
_, ev, res, _ = O.simulate(hole(cup=(0.0, -10.0)), O.TEE, 0, 1.0)
check("a fast probe lips out", res != "cup" and any(e[1] == "lip" for e in ev))
_, ev, res, _ = O.simulate(hole(blacks=[(0.0, -8.0)]), O.TEE, 0, 0.7)
check("a black hole swallows a probe", res == "black")
_, ev, res, fend = O.simulate(hole(), O.TEE, 90, 1.0)
check("#171 the tractor fence pulls a wide shot back in", res == "rest" and abs(fend[0]) < O.FENCE_X and any(e[1] == "fence" for e in ev), str(fend))
_, ev, res, _ = O.simulate(hole(), (O.X_MAX - 1.0, 0.0), 90, 1.0)
check("flung through the fence into deep space is out", res == "out")
# -- #173 moving asteroids, comets, stardust; #169 the tractor cup
slide = (0.0, -12.0, 3.0, 0.0, 0.5, 0)
x0, y0, _, _ = O.rock_at(slide, 0.0)
x1, y1, vx1, _ = O.rock_at(slide, math.pi)
check("a belt rock slides side to side with the clock", abs(x0 - 3) < 1e-9 and abs(x1) < 1e-6 and y0 == y1 == -12.0 and vx1 < 0)
orb = (0.0, 0.0, 5.0, 0.0, 1.0, 1)
check("a ring rock orbits its centre", all(abs(math.hypot(*O.rock_at(orb, t)[:2]) - 5) < 1e-9 for t in (0, 0.7, 2.1)))
_, ev_a, _, ea = O.simulate(hole(rocks=[slide]), O.TEE, 0, 0.5, tau0=0.0)
_, ev_b, _, eb = O.simulate(hole(rocks=[slide]), O.TEE, 0, 0.5, tau0=2.0)
check("the same shot meets the belt or not depending on the clock", ea != eb, f"{ea} {eb}")
cm = [-34.0, -14.0, 10.0, 0.0, 9.0, 0.0]
hx, hy = O.comet_at(cm, 3.4)
check("a comet streaks across and comes round again", abs(hx - 0.0) < 1e-6 and hy == -14.0 and O.comet_at(cm, 12.4) == (hx, hy))
_, ev, _, ce = O.simulate(hole(comets=[cm]), O.TEE, 0, 0.6, tau0=3.0)
check("brushing a comet's tail flings the probe its way", any(e[1] == "comet" for e in ev) and ce[0] > 3, str(ce))
_, ev, _, _ = O.simulate(hole(stars=[(0.0, -18.0), (5.0, 5.0)]), O.TEE, 0, 0.5)
check("stardust on the way is picked up", [e[4] for e in ev if e[1] == "star"] == [0])
_, ev, _, _ = O.simulate(hole(stars=[(0.0, -18.0)]), O.TEE, 0, 0.5, taken=[0])
check("taken stardust is gone", not any(e[1] == "star" for e in ev))
near = hole(cup=(3.0, -10.0))
_, _, r0, _ = O.simulate(near, (0.0, -16.0), 0, 0.31)
_, ev, r1, _ = O.simulate(near, (0.0, -16.0), 0, 0.31, magnet=True)
check("a tractor cup pulls in a near miss", r0 == "rest" and r1 == "cup" and any(e[1] == "magnet" for e in ev), f"{r0} {r1}")
_, ev, res, wend = O.simulate(hole(worms=[(0.0, -11.0), (8.0, 4.0)]), O.TEE, 0, 0.5)
check("a wormhole carries the probe to its twin", any(e[1] == "warp" for e in ev) and wend[0] > 6, str(wend))
p_w, _, _, _ = O.simulate(hole(worms=[(0.0, -11.0), (8.0, 4.0)]), O.TEE, 0, 0.5)
check("the jump is marked on the path", any(q[3] for q in p_w))
_, ev, _, rb = O.simulate(hole(rocks=[(0.0, -12.0)]), O.TEE, 0, 0.5)
check("rocks bounce probes back", any(e[1] == "rock" for e in ev) and rb[1] < -12)

# -- holes are fair
import random  # noqa: E402
rng = random.Random(1)
for f in O.FEATURES:
    for _ in range(20):
        h = O.make_hole(rng, f)
        ok = O.free(h["cup"], h, 2.2) and O.free(O.TEE, h, 2.5)
        if not ok:
            break
    check(f"{f} holes keep the tee and cup clear", ok)

# -- turns
r, g, (a, b) = game()
check("starts on hole 1 with someone to play", g.hole_no == 1 and r.turn in (a.id, b.id))
first = r.players[r.turn]
other = b if first is a else a
check("not your turn refused", refused(g, other, {"type": "launch", "angle": 0, "power": 0.5}) is not None)
check("NaN refused", refused(g, first, {"type": "launch", "angle": float("nan"), "power": 0.5}) is not None)
check("no power refused", refused(g, first, {"type": "launch", "angle": 0, "power": 0}) is not None)
check("bool refused", refused(g, first, {"type": "launch", "angle": True, "power": 0.5}) is not None)
g.hole = hole(cup=(0.0, 14.0))
g.act(first, {"type": "launch", "angle": 0, "power": 0.2})
check("a stroke is counted", g.strokes[g.seat(first)] == 1)
check("the furthest player goes next", r.turn == other.id)
check("can't launch while the probe flies", refused(g, other, {"type": "launch", "angle": 0, "power": 0.5}) is not None)
g.ready_at = 0
g.hole = hole(cup=(0.0, 14.0), blacks=[(0.0, -8.0)])
g.act(other, {"type": "launch", "angle": 0, "power": 0.7})
check("the black hole costs a stroke", g.strokes[g.seat(other)] == 2 and g.pos[g.seat(other)] == list(O.TEE))
g.ready_at = 0
check("still the furthest goes", r.turn == other.id)
# sink both
for p in (other, first):
    i = g.seat(p)
    g.pos[i] = [0.0, 13.5]
for _ in range(4):
    if g.between or r.turn is None:
        break
    p = r.players[r.turn]
    g.ready_at = 0
    g.hole = hole(cup=(0.0, 14.0))
    g.act(p, {"type": "launch", "angle": 0, "power": 0.05})
check("all holed → between holes", g.between, str(g.done))
check("cards record the hole", all(len(c) == 1 for c in g.cards))
g.on_timeout()
check("next hole", g.hole_no == 2 and not g.between)

# -- stardust banks across holes and buys a tractor cup
r, g, (a, b) = game()
p = r.players[r.turn]
i = g.seat(p)
check("no stardust, no tractor cup", refused(g, p, {"type": "launch", "angle": 0, "power": 0.5, "magnet": True}) is not None)
g.hole = hole(cup=(0.0, 30.0), stars=[(0.0, -18.0)])
g.taken = []
g.act(p, {"type": "launch", "angle": 0, "power": 0.5})
check("a launch through stardust banks it", g.dust[i] == 1 and g.taken == [0], str(g.dust))
v = g.view(p)["orbit"]
check("the view carries the clock, stardust and comets", "clk" in v and v["taken"] == [0] and v["dust"][i] == 1 and "comets" in v)
check("the shot says when on the clock it flew", "tau0" in g.shot and g.shot["magnet"] is False)
t_a = g.clock_now()
g.ready_at = 0
q = r.players[r.turn]
if q is p:
    g.act(p, {"type": "launch", "angle": 0, "power": 0.3, "magnet": True})
    check("spending stardust on a tractor cup", g.dust[i] == 0 and g.shot["magnet"] is True)
check("the course clock runs on through a shot", g.clock_now() >= t_a)
ang, pw, mg = g.plan(g.seat(r.players[r.turn]), "normal")
check("bots plan an angle, a power and whether to use the tractor cup", isinstance(mg, bool) and 0 < pw <= 1)

# -- a full game ends, timeouts move things along, views serialise
r, g, ps = game(3, holes=3)
for _ in range(200):
    if r.phase != "playing":
        break
    json.dumps(g.view(ps[0]))
    g.ready_at = 0
    g.on_timeout()
check("timeouts alone finish the game", r.phase == "over", r.phase)
check("cards are full", all(len(c) == 3 for c in g.cards))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
