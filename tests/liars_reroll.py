"""Liar's Dice 🎲 Show & reroll (off by default): once a round, on your turn, put some dice on show for
everyone and reroll the rest; the turn stays yours to bid. Must show at least one and reroll at least one.

    python3 tests/liars_reroll.py
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


def table(reroll):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("liars")
    if reroll is not None:
        r.settings["reroll"] = reroll
    r.start()
    g = r.game
    me = r.players[r.turn]
    other = bo if me is ann else ann
    me.g.dice = [2, 3, 5, 5, 6]
    return r, g, me, other


def refused(fn):
    try:
        fn()
    except GameError:
        return True
    return False


r, g, me, other = table(None)
check("off by default", refused(lambda: g.act(me, {"type": "reroll", "show": [2, 3]})) and not g.view(me)["liars"]["canReroll"])

r, g, me, other = table(True)
check("on: offered on your turn", g.view(me)["liars"]["canReroll"] and not g.view(other)["liars"]["canReroll"])
check("must keep one to reroll", refused(lambda: g.act(me, {"type": "reroll", "show": [0, 1, 2, 3, 4]})))
check("must show one", refused(lambda: g.act(me, {"type": "reroll", "show": []})))
g.act(me, {"type": "reroll", "show": [2, 3]})
check("the shown fives stay, three dice rerolled", g.view(other)["liars"]["shown"][me.id] == [5, 5] and len(me.g.dice) == 5 and me.g.dice.count(5) >= 2)
check("still your turn", r.turn == me.id)
check("only once a round", refused(lambda: g.act(me, {"type": "reroll", "show": [0]})))
g.act(me, {"type": "bid", "qty": 2, "face": 5})
check("then you bid as usual", r.turn == other.id)
g.act(other, {"type": "liar"})
check("a new round clears what's on show", all(not v for v in g.view(me)["liars"]["shown"].values()))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
