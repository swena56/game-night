"""Farkle 🔥 hot-dice streak: the second hot dice in a turn adds +500; off by setting; resets each turn.

    python3 tests/farkle_streak.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import farkle as F  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def hot(g, p):
    g.rolled, g.roll, g.dice_left = True, [1, 1, 1, 5, 5, 5], 6
    g.act(p, {"type": "roll", "keep": [0, 1, 2, 3, 4, 5]})


for on in (True, False):
    r = server.Room("T")
    r.add_player("A")
    r.switch_game("farkle")
    r.settings["hotstreak"] = on
    r.start()
    g = r.game
    p = r.players[r.turn]
    hot(g, p)
    first = g.turn_pts
    check(f"streak={on}: the first hot dice gets no bonus", first == 2500)
    g.rolled = True
    hot(g, p)
    check(f"streak={on}: the second {'adds' if on else 'does not add'} +500", g.turn_pts == first + 2500 + (F.HOT_STREAK if on else 0), g.turn_pts)
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
