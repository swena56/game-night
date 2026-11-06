"""Paint Blast ⭐ Gold tiles (off by default): a few floor tiles worth 3 each at the end of a round.

    python3 tests/paintblast_gold.py
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


def arena(gold):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("paintblast")
    if gold is not None:
        r.settings["gold"] = gold
    r.start()
    return r, r.game, ann


r, g, ann = arena(None)
check("off by default: no gold", not g.gold and g.view(ann)["paintblast"]["gold"] == [])
r, g, ann = arena(True)
check("on: gold on floor tiles", g.gold and all(g.tiles[c] == pb.FLOOR for c in g.gold), g.gold)
before = g.round_points(0)
g.paint[g.gold[0]] = 1
g.paint[next(c for c in range(g.n * g.n) if g.tiles[c] == pb.FLOOR and c not in g.gold)] = 1
check("a gold tile is worth 3, a plain one 1", g.round_points(0) == before + 3 + 1, (before, g.round_points(0)))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
