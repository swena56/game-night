"""Paint Blast 🎨 Comeback: with 25 s left the round's lowest painter gets +1 bomb and +1 reach.

    python3 tests/paintblast_comeback.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import paintblast as pb  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def arena():
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("paintblast")
    r.start()
    return r.game


g = arena()
floor = [c for c in range(g.n * g.n) if g.tiles[c] == pb.FLOOR]
for c in floor[:5]:
    g.paint[c] = 1
g.ends_at = 100.0
g.comeback(50.0)
check("early: nothing yet", not g.boosted and g.maxb == [1, 1])
g.comeback(80.0)
check("ahead keeps stats", g.maxb[0] == 1 and g.reach[0] == 2, (g.maxb, g.reach))
check("behind gets +1 bomb, +1 reach", g.maxb[1] == 2 and g.reach[1] == 3, (g.maxb, g.reach))
g.comeback(90.0)
check("only once", g.maxb[1] == 2)
g = arena()
g.ends_at = 100.0
g.comeback(80.0)
check("tie: no boost", g.maxb == [1, 1])
print("all ok" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
