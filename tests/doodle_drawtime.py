"""Doodle Dash drawing speed (18 s by default; 12 or 25): each picture draws over that long.

    python3 tests/doodle_drawtime.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import doodle  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


for secs in (None, 12, 25):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("doodle")
    if secs:
        r.settings["drawtime"] = secs
    r.start()
    g = r.game
    want = secs or doodle.DRAW_SECS
    v = g.view(ann)["doodle"] if "doodle" in g.view(ann) else next(iter(g.view(ann).values()))
    check(f"{want} s a picture", v["secs"] == want and abs((g.end - g.t0) - (want + doodle.GRACE_SECS)) < 0.01, v["secs"])

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
