"""Spin Tops rules: the launch meter sets the spin, the bowl pulls toward the middle, collisions bounce and drain the
slower top more, a charge hits harder, ring-outs and topples knock tops out (and credit the hitter), sparks add spin,
bad input is refused, bots play whole games, and the game ends.

    python3 tests/tops_rules.py
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import tops as T  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, bots=(), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    for lv in bots:
        r.add_bot(lv)
    r.switch_game("tops")
    r.settings.update(settings)
    r.start()
    return r, r.game, list(r.players.values())


def step(r, g, secs, clock):
    for _ in range(int(secs * 60)):
        clock += 1 / 60
        with r.cond:
            g.frame(clock)
        if r.phase != "playing":
            break
    return clock


# -- the meter
check("meter starts at 0", T.meter(0) == 0)
check("meter peaks half a swing in", abs(T.meter(T.METER / 2) - 1) < 1e-9)
check("meter swings back", abs(T.meter(T.METER) - 0) < 1e-9)

r, g, (a, b) = game()
check("starts on the launch", g.stage == "launch" and g.round == 1)
for bad in ({"sx": float("nan"), "sy": 0}, {"sx": "x", "sy": 0}, {"btn": "boom"}):
    try:
        g.on_input(a, bad)
        check(f"bad input refused {bad}", False)
    except GameError:
        check(f"bad input refused {list(bad)}", True)
g.launch(0, g.launch_at, power=1.0)
check("a launch is locked in", g.tops[0].power == 1.0 and not g.launch(0, g.launch_at + 0.5))
clock = g.go_at - 0.01
clock = step(r, g, 0.1, clock)
check("the fight starts after the countdown", g.stage == "spin")
check("a full launch spins harder than none", g.tops[0].spin > g.tops[1].spin, f"{g.tops[0].spin:.2f} v {g.tops[1].spin:.2f}")

# the bowl pulls a still top toward the middle
t = g.tops[0]
t.x, t.y, t.vx, t.vy, t.sx, t.sy = 4.0, 0.0, 0.0, 0.0, 0.0, 0.0
g.tops[1].x, g.tops[1].y = -4.0, 0.0
g.tops[1].vx = g.tops[1].vy = 0.0
with r.cond:
    g.move(1 / 30, clock)
check("the bowl pulls inward", g.tops[0].vx < 0)

# a head-on collision: they bounce apart, the slower spinner loses more spin
a_, b_ = g.tops
a_.x, a_.y, a_.vx, a_.vy, a_.spin = -0.45, 0.0, 2.0, 0.0, 0.9
b_.x, b_.y, b_.vx, b_.vy, b_.spin = 0.45, 0.0, -2.0, 0.0, 0.4
with r.cond:
    g.move(1 / 30, clock)
check("they bounce apart", a_.vx < 0 < b_.vx, f"{a_.vx:.2f} {b_.vx:.2f}")
check("the slower top loses more spin", 0.9 - a_.spin < 0.4 - b_.spin, f"{0.9 - a_.spin:.3f} v {0.4 - b_.spin:.3f}")
check("both remember who hit them", a_.touch == 1 and b_.touch == 0)

# a charge: same spins, one moving in, one still: the charger loses less
a_.x, a_.y, a_.vx, a_.vy, a_.spin = -0.45, 0.0, 4.0, 0.0, 0.7
b_.x, b_.y, b_.vx, b_.vy, b_.spin = 0.45, 0.0, 0.0, 0.0, 0.7
with r.cond:
    g.move(1 / 30, clock)
check("a charge costs the charger less", 0.7 - a_.spin < 0.7 - b_.spin, f"{0.7 - a_.spin:.3f} v {0.7 - b_.spin:.3f}")
check("and shoves the target hard", b_.vx > 3.5, f"{b_.vx:.2f}")

# dash: cooldown and cost
a_.x, a_.y, a_.vx, a_.vy, a_.spin, a_.dash_at = -3.0, 0.0, 0.0, 0.0, 0.8, 0.0
b_.x, b_.y = 3.0, 0.0
check("dash works", g.dash(0, clock, 1.0, 0.0) and a_.vx > 4 and a_.spin < 0.8)
check("dash cools down", not g.dash(0, clock + 0.5, 1.0, 0.0))

# a ring-out right after a hit credits the hitter
r, g, (a, b, c) = game(3)
clock = step(r, g, T.LAUNCH + 0.1, g.launch_at)
check("3-player fight starts", g.stage == "spin")
v = g.tops[1]
v.x, v.y, v.vx, v.vy, v.touch, v.touch_at = T.R + 0.1, 0.0, 6.0, 0.0, 0, clock
with r.cond:
    g.move(1 / 30, clock)
check("over the rim is out", v.out == "ring")
check("the hitter gets the point", g.tops[0].points == 1 and g.tops[0].outs == 1)
w = g.tops[2]
w.spin = 0.0001
with r.cond:
    g.move(1 / 30, clock + 1)
check("out of spin topples", w.out == "topple")
with r.cond:
    g.frame(clock + 1.05)
check("the last top spinning wins the round", g.stage == "between" and g.result[0] == 0 and g.tops[0].points == 4,
      f"{g.result} {g.tops[0].points}")
check("the runner-up (last out) gets 1", g.tops[2].points == 1)
clock = step(r, g, T.BETWEEN + 0.2, clock + 1.05)
check("next round starts with a launch", g.stage == "launch" and g.round == 2 and all(t.out is None for t in g.tops))

# sparks add spin
g.stage = "spin"
g.tops[0].x, g.tops[0].y, g.tops[0].spin = 1.0, 1.0, 0.5
g.sparks = [[1.0, 1.2, clock, 99]]
g.next_spark = clock + 99
g.tick_sparks(clock)
check("a spark adds spin", abs(g.tops[0].spin - (0.5 + T.SPARK_GAIN)) < 1e-9 and not g.sparks)

# view is serialisable and shaped
import json  # noqa: E402
vw = g.view(a)["tops"]
json.dumps(vw)
check("view has every top", len(vw["t"]) == 3 and vw["me"] == 0)

# bots play whole games
for n_bots in (2, 5):
    r, g, ps = game(1, bots=["hard", "normal", "easy", "hard", "normal"][:n_bots])
    ps[0].bot = "normal"
    clock = step(r, g, 600, g.launch_at)
    check(f"{n_bots + 1} bots finish a game", r.phase == "over", r.log[-1]["text"])

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
