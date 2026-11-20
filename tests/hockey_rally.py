"""Air Hockey 🔥 rally heat: after RALLY_FROM mallet touches without a goal, the puck's top speed grows (capped); a new serve resets it.

    python3 tests/hockey_rally.py
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import hockey as hk  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("TEST")
for n in ("Ann", "Bo"):
    r.add_player(n)
r.switch_game("hockey")
r.start()
g = r.game


def top_speed(rally):
    pk = g.pucks[0]
    pk.x, pk.y, pk.vx, pk.vy, pk.rally = 0.5, 0.8, 0.0, 50.0, rally
    g.mallets = [[0.5, 1.5], [0.5, 0.1]]
    g.move_puck(pk, 0.001)
    return math.hypot(pk.vx, pk.vy)


base = top_speed(0)
check("no heat early", abs(top_speed(hk.RALLY_FROM) - base) < 1e-6, base)
hot = top_speed(hk.RALLY_FROM + 4)
check("heat after a long rally", hot > base * 1.1, (base, hot))
cap = top_speed(200)
check("heat is capped", abs(cap - base * (1 + hk.RALLY_MAX)) < 1e-3, (cap, base * (1 + hk.RALLY_MAX)))
g.serve(0, 0, 100.0)
check("a serve resets the rally", g.pucks[0].rally == 0)
print("all ok" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
