"""Sky Drop 🌬️ slipstream: close behind a rival you fly faster; far off or off to the side you don't.

    python3 tests/skydrop_draft.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import skydrop as M  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []
CLOCK = [1_000_000.0]
M.time.time = lambda: CLOCK[0]   # the game reads time.time() for boosts and views; drive it by hand


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, bots=0, level="normal", **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("skydrop")
    for _ in range(bots):
        r.add_bot(level)
    r.settings.update(settings)
    CLOCK[0] += 1000
    r.start()
    return r, r.game, [p for p in r.players.values() if not p.spectator]


r, g, ps = game(2)
g.stage = "race"
g.race_started = CLOCK[0]
g.rings, g.hazards, g.coins, g.streams = [], [], [], []
a, b = g.flyers
def run(ax, az, bx, bz, gap):
    a.depth, a.x, a.z, a.vx, a.vz = 100.0, ax, az, 0.0, 0.0
    b.depth, b.x, b.z = 100.0 + gap, bx, bz
    a.sx = a.sz = 0.0
    a.stun_until = 0.0
    a.drafting = False
    d0 = a.depth
    g.simulate(0.1, CLOCK[0])
    return a.depth - d0
base = run(0, 0, 5, 0, 30)
close = run(0, 0, 0.5, 0, 4)
check("close behind a rival is faster", close > base * 1.08, (base, close))
check("a draft event fires once", sum(1 for e in g.events if e[1] == "draft") == 1)
side = run(0, 0, 4, 0, 4)
check("off to the side: no tow", abs(side - base) < 1e-6, (base, side))
ahead = run(0, 0, 0.5, 0, -4)
check("a rival behind you gives no tow", abs(ahead - base) < 1e-6, (base, ahead))
print("all ok" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
