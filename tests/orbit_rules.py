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
_, ev, res, _ = O.simulate(hole(cup=(0.0, -10.0)), O.TEE, 0, 0.32)
check("a slow probe drops in the cup", res == "cup", str(res))
_, ev, res, _ = O.simulate(hole(cup=(0.0, -10.0)), O.TEE, 0, 1.0)
check("a fast probe lips out", res != "cup" and any(e[1] == "lip" for e in ev))
_, ev, res, _ = O.simulate(hole(blacks=[(0.0, -8.0)]), O.TEE, 0, 0.7)
check("a black hole swallows a probe", res == "black")
_, ev, res, _ = O.simulate(hole(), O.TEE, 90, 1.0)
check("off the edge is out", res == "out")
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
