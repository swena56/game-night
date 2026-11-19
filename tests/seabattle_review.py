"""Post-game Sea Battle review reveals both sonar histories only after the hunt.

    python3 tests/seabattle_review.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok):
    print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
r.switch_game("seabattle")
r.start()
g = r.game
ann.g.scans = [[1, 2, 3]]
bo.g.scans = [[4, 5, 0]]
check("live views omit the shared sonar reveal", g.view(ann)["sea"]["postScans"] is None
      and g.view(bo)["sea"]["postScans"] is None
      and g.view(ann)["sea"]["scans"] == ann.g.scans and g.view(bo)["sea"]["scans"] == bo.g.scans)
r.phase = "over"
expected = [r.players[i].g.scans for i in g.seats]
check("post-game review returns both scan histories", g.view(ann)["sea"]["postScans"] == expected)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
