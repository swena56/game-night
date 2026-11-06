"""Qork 🍀 Lucky number (off by default): each round draws a lucky total (4–6 or 8–10) that triggers like a 7.

    python3 tests/qork_lucky.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import qork  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


check("triggers: doubles, seven, and the lucky total", qork.trigger((2, 3), 5) == "lucky" and qork.trigger((3, 4), 5) == "seven" and qork.trigger((4, 4), 8) == "doubles")
check("no lucky number: a 5 is just a roll", qork.trigger((2, 3)) is None)


def mat(lucky):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("qork")
    if lucky is not None:
        r.settings["lucky"] = lucky
    r.start()
    return r, r.game, ann


r, g, ann = mat(None)
check("off by default", g.lucky is None and g.view(ann)["qork"]["lucky"] is None)
r, g, ann = mat(True)
check("on: a lucky total each round", g.lucky in (4, 5, 6, 8, 9, 10))
g.pending = (1, g.lucky - 1) if g.lucky - 1 != 1 else (2, g.lucky - 2)
if sum(g.pending) == 7 or g.pending[0] == g.pending[1]:
    g.pending = (1, g.lucky - 1)
g.land()
check("rolling the lucky total opens the snap", g.stage == "snap", (g.pending, g.lucky))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
