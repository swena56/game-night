"""Shut the Box 📊 forecast: from the current open tiles and the one-die rule, the average points left
and the chance of shutting the box, per way to roll before a roll and per legal set of tiles after it.
It only informs: the box and the roll are untouched and nothing is picked.

    python3 tests/shutbox_forecast.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import shutbox as SB  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


f = SB.forecast(list(range(1, 10)), [], 9, True)
check("a fresh box: about 11 points left with best play, ~10% to shut", f["roll"] == {"2": [11.0, 10]} and f["options"] is None, f)
f = SB.forecast([1, 2, 3], [], 9, True)
check("7 and up shut: one die is offered too", set(f["roll"]) == {"1", "2"}, f)
f2 = SB.forecast([1, 2, 3], [], 9, False)
check("with one die off, only two dice", set(f2["roll"]) == {"2"} and f2["roll"]["2"] != f["roll"]["1"], f2)
check("one tile left: one die shuts the 1 a sixth of the time", SB.forecast([1], [], 9, True)["roll"]["1"] == [round(5 / 6, 1), 17])

f = SB.forecast([1, 2, 3, 4, 5, 6, 7, 8, 9], [6, 6], 9, True)
legal = sorted(sorted(o) for o in SB.options(list(range(1, 10)), 12))
check("after a roll: every legal set of tiles, nothing else", sorted(sorted(r[0]) for r in f["options"]) == legal)
check("points left now are the open tiles minus the set", all(r[1] == 45 - sum(r[0]) for r in f["options"]))
check("best average first", [r[2] for r in f["options"]] == sorted(r[2] for r in f["options"]))
f = SB.forecast([3, 4], [3, 4], 9, True)
row = {tuple(r[0]): r for r in f["options"]}
check("shutting the last tiles: 0 left and 100%", row[(3, 4)][1:] == [0, 0.0, 100], f)

# in a room: the view's forecast follows the box, and acting is still up to the player
r = server.Room("TEST")
ann, bo = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("shutbox")
r.start()
g = r.game
me = r.players[r.turn]
v = g.view(me)["shutbox"]
check("before a roll the forecast covers the roll modes", v["forecast"]["roll"] and v["forecast"]["options"] is None)
me.g.tiles = [1, 2, 3, 4, 5, 6]
g.dice, g.rolled = [2, 3], True
before = (list(me.g.tiles), list(g.dice), g.rolled, r.turn)
v = g.view(me)["shutbox"]
check("after a roll it lists every fit", sorted(sorted(x[0]) for x in v["forecast"]["options"]) == sorted(sorted(o) for o in SB.options(me.g.tiles, 5)))
check("and changes nothing", before == (list(me.g.tiles), list(g.dice), g.rolled, r.turn))
watcher = r.add_player("Eve")
check("a watcher sees the same forecast", g.view(watcher)["shutbox"]["forecast"] == v["forecast"])
g.stage = "stuck"
check("no forecast once the box is stuck", g.view(me)["shutbox"]["forecast"] is None)
json.dumps(g.view(watcher))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
