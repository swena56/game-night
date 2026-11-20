"""Dots & Boxes endgame chain plan: who is expected to take each chain.

    python3 tests/boxes_plan.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("TEST")
for n in ("Ann", "Bo"):
    r.add_player(n)
r.switch_game("boxes")
r.start()
g = r.game
a, b = g.seats
r.turn = a
plan = g.chain_plan([[1, False], [3, False], [6, False]])
check("short chains are taken whole, the taker must then open", plan[0] == [1, False, 1, 1, 0], plan)
check("a long chain mid-way keeps control with a double-cross", plan[1] == [3, False, 0, 1, 2], plan)
check("the last chain is taken whole", plan[2][3] == 6 and plan[2][4] == 0, plan)
check("no plan with no chains", g.chain_plan(None) is None and g.chain_plan([]) is None)
lp = g.chain_plan([[4, False], [8, True], [8, True]])
check("a loop keeps control by handing back four", lp[1] == [8, True, 1, 4, 4] and lp[2][4] == 0, lp)
v = g.view(r.players[a])["boxes"]
check("view carries the plan key", "plan" in v and v["plan"] is None)
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
