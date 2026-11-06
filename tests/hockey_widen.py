"""Air Hockey 🥅 Leader's goal widens (off by default): +15% goal width per goal of lead, up to +50%, and the
wider mouth really lets the puck in.

    python3 tests/hockey_widen.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import hockey  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def rink(widen):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("hockey")
    if widen is not None:
        r.settings["widen"] = widen
    r.start()
    return r, r.game


r, g = rink(None)
g.score = [3, 0]
check("off by default: both goals the same", g.goal_w(0) == g.goal_w(1) == hockey.GOAL)
r, g = rink(True)
g.score = [2, 0]
check("on: the leader's goal is 30% wider", abs(g.goal_w(0) - hockey.GOAL * 1.3) < 1e-9 and g.goal_w(1) == hockey.GOAL)
g.score = [6, 0]
check("capped at +50%", abs(g.goal_w(0) - hockey.GOAL * 1.5) < 1e-9)
# a puck heading for seat 0's goal (the bottom), just outside the normal mouth: it goes in now
g.score = [3, 0]
pk = g.pucks[0] if hasattr(g, "pucks") else g.puck
pk.x, pk.y, pk.vx, pk.vy = hockey.W / 2 + hockey.GOAL * 0.55, hockey.H - hockey.PUCK * 0.5, 0, 2
g.mallets = [[0.1, 0.1], [0.1, 0.1]]
scored = None
for _ in range(40):
    scored = g.move_puck(pk, 0.01)
    if scored is not None:
        break
check("the wider mouth lets a puck in", scored == 1, (scored, round(pk.y, 3)))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
