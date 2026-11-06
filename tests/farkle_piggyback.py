"""Farkle 🐷 Piggyback (off by default): after a bank with dice left, the next player may take over those
points and dice before rolling; rolling fresh turns it down. Farkle on it and it's all gone.

    python3 tests/farkle_piggyback.py
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


def table(pig):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("farkle")
    if pig is not None:
        r.settings["piggyback"] = pig
    r.settings["opening"] = 0
    r.start()
    g = r.game
    first = r.players[r.turn]
    other = bo if first is ann else ann
    # first player rolls 1 5 2 3 4 6 -> keeps the 1 (100) and banks, leaving 5 dice
    g.rng.randint = lambda a, b, seq=iter([1, 5, 2, 3, 4, 6] + [2] * 50): next(seq)
    g.act(first, {"type": "roll", "keep": []})
    g.act(first, {"type": "bank", "keep": [0]})
    return r, g, first, other


r, g, first, other = table(None)
check("off by default: no offer", g.view(other)["farkle"]["pig"] is None)

r, g, first, other = table(True)
pig = g.view(other)["farkle"]["pig"]
check("on: the next player is offered 100 with 5 dice", pig and pig["pts"] == 100 and pig["dice"] == 5, pig)
g.rng.randint = lambda a, b, seq=iter([5, 2, 3, 4, 6] + [2] * 50): next(seq)
g.act(other, {"type": "piggy"})
check("piggyback: 100 on the line, 5 dice rolled", g.turn_pts == 100 and len(g.roll) == 5, (g.turn_pts, g.roll))
g.act(other, {"type": "bank", "keep": [0]})
check("bank adds the piggyback points", r.players[other.id].g.score == 150, r.players[other.id].g.score)

r, g, first, other = table(True)
g.rng.randint = lambda a, b, seq=iter([1, 2, 3, 4, 6, 6] + [2] * 50): next(seq)
g.act(other, {"type": "roll", "keep": []})
check("rolling fresh turns it down", g.view(other)["farkle"]["pig"] is None and g.turn_pts == 0 and len(g.roll) == 6)
try:
    g.act(other, {"type": "piggy"})
    check("no piggyback after rolling", False)
except GameError:
    check("no piggyback after rolling", True)

r, g, first, other = table(True)
g.rng.randint = lambda a, b, seq=iter([2, 2, 3, 4, 6] + [2] * 50): next(seq)
g.act(other, {"type": "piggy"})
check("farkle on a piggyback loses it all", r.players[other.id].g.score == 0 and r.turn == first.id)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
