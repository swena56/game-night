"""Yacht ⭐ Bonus roll (off by default): one extra roll a game, spent on a turn after the third roll.
Holds tapped between rolls are sent to the table (the "hold" action) without rolling.

    python3 tests/yacht_bonusroll.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(on):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("yacht")
    if on is not None:
        r.settings["bonusroll"] = on
    r.start()
    me = r.players[r.turn]
    return r, r.game, me


def refused(fn):
    try:
        fn()
    except GameError:
        return True
    return False


ROLL = {"type": "roll", "hold": [False] * 5}
r, g, me = table(None)
for _ in range(3):
    g.act(me, ROLL)
check("off by default: no fourth roll", refused(lambda: g.act(me, ROLL)))

r, g, me = table(True)
check("hold before the first roll is refused", refused(lambda: g.act(me, {"type": "hold", "hold": [True] * 5})))
g.act(me, ROLL)
g.act(me, {"type": "hold", "hold": [True, False, True, False, False]})
check("holds reach the table", g.view(me)["yacht"]["held"] == [True, False, True, False, False])
g.act(me, ROLL); g.act(me, ROLL)
check("bonus roll on offer", g.view(me)["yacht"]["bonusRolls"][me.id] == 1)
check("category comparison recognizes the bonus roll", g.view(me)["yacht"]["comparison"]["reroll"])
g.act(me, ROLL)
check("a fourth roll spends it", g.view(me)["yacht"]["bonusRolls"][me.id] == 0 and g.rolls_left == 0)
check("only once a game", refused(lambda: g.act(me, ROLL)))
check("comparison hides the spent bonus roll", not g.view(me)["yacht"]["comparison"]["reroll"])

r, g, me = table(False)
g.s.update(bonus=True, extra=True)
me.g.card.update(fours=16, fives=20, yacht=50)
g.rolls_left, g.dice = 0, [6] * 5
before = g.total(me)
view = g.view(me)["yacht"]
check("comparison identifies the exact category bonuses",
      view["pick"] == "sixes" and view["preview"]["sixes"] == 30 and view["comparison"]["upper"] == ["sixes"]
      and view["comparison"]["extra"] == 50 and view["comparison"]["upperPoints"] == 35)
g.act(me, {"type": "score", "cat": "sixes"})
check("banked total matches the shown comparison", g.total(me) - before == 115)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
