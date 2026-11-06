"""Hover Rally speed class (150cc by default; 100cc or 200cc): top speeds and acceleration scale, and the
view's top speed says so.

    python3 tests/rally_class.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import rally  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


for cls, k in ((None, 1.0), (100, 0.82), (200, 1.2)):
    r = server.Room("TEST")
    ann = r.add_player("Ann")
    r.switch_game("rally")
    if cls:
        r.settings["class"] = cls
    r.start()
    g = r.game
    check(f"{cls or 150}cc: ×{k}", abs(g.k() - k) < 1e-9 and abs(g.view(ann)["rally"]["top"] - rally.TOP_SPEED * k) < 1e-9)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
