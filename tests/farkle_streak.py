"""Farkle 🔥 hot-dice streak: the second hot dice in a turn adds +500; off by setting; resets each turn.

    python3 tests/farkle_streak.py
"""
import os
from itertools import product
import sys
from unittest.mock import patch

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
    with patch.object(g.rng, "randint", return_value=1):
        g.act(p, {"type": "roll", "keep": [0, 1, 2, 3, 4, 5]})


# Count ordered rolls independently using the game's live scoring predicate.
scoring = {}
for n in range(1, 7):
    busts = 0
    for roll in product(range(1, 7), repeat=n):
        key = tuple(sorted(roll))
        if key not in scoring:
            scoring[key] = bool(F.keep_options(key))
        busts += not scoring[key]
    check(f"exact bust odds for {n} dice", F.bust_probability(n) == busts / 6 ** n)


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
    check("forecast accounts for the next hot-dice bonus",
          g.view(p)["farkle"]["nextHotBonus"] == (F.HOT_STREAK if on else 0))
    g.rolled = True
    hot(g, p)
    check(f"streak={on}: the second {'adds' if on else 'does not add'} +500", g.turn_pts == first + 2500 + (F.HOT_STREAK if on else 0), g.turn_pts)
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
