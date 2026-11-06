"""Grid Hunt ⚡ Frenzy (off by default): words found in the last 15 seconds of a round score double.

    python3 tests/gridhunt_frenzy.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import gridhunt  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def hunt(frenzy):
    r = server.Room("TEST")
    ann = r.add_player("Ann")
    r.switch_game("gridhunt")
    if frenzy is not None:
        r.settings["frenzy"] = frenzy
    r.start()
    g = r.game
    early, late = sorted(g.all, key=len)[:2]
    return r, g, ann, early, late


for frenzy in (None, True):
    r, g, ann, early, late = hunt(frenzy)
    g.act(ann, {"type": "word", "word": early})
    g.end = g.now() + 10  # ten seconds left: inside the frenzy
    g.act(ann, {"type": "word", "word": late})
    g.reveal()
    lists = {w: pts for w, pts, _ in g.results["lists"][ann.id]}
    if frenzy:
        check("frenzy: a late word scores double", lists[late] == 2 * g.points(late) and lists[early] == g.points(early), lists)
    else:
        check("off by default: no doubling", lists[late] == g.points(late), lists)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
