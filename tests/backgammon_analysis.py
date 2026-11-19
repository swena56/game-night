"""Backgammon turn plans honor complete legal dice use in the current position."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import backgammon as B  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def valid_sequence(pos, side, dice, path, must_use_larger=True):
    p, remaining, first = pos, list(dice), must_use_larger
    for frm, to, die in path:
        if (frm, to, die) not in B.legal_moves(p, side, remaining, must_use_larger=first):
            return False
        p = B.apply(p, side, frm, to)
        remaining.remove(die)
        first = False
    return len(path) == B.max_len(pos, side, tuple(sorted(dice)))


r = server.Room("PLAN")
white, black = r.add_player("White"), r.add_player("Black")
r.switch_game("backgammon")
r.start()
g = r.game
white = r.players[g.ids[B.WHITE]]
black = r.players[g.ids[B.BLACK]]

# Doubles require four dice and all example paths must play four.
g.pos = B.new_position(); g.begin(B.WHITE, [2, 2, 2, 2])
a = g.view(white)["backgammon"]["analysis"]
check("doubles planner includes four moves per legal sequence", a["need"] == 4 and a["plans"] and all(len(x) == 4 for x in a["plans"]))
check("doubles examples replay as legal sequences", all(valid_sequence(g.pos, B.WHITE, g.dice, x) for x in a["plans"]))
check("a rival cannot inspect the current player's private plan", g.view(black)["backgammon"]["analysis"] is None)
try:
    g.act(white, {"type": "end"})
    check("a turn with legal dice use cannot end", False)
except GameError:
    check("a turn with legal dice use cannot end", True)

# Entry from the bar must be the first planned checker move, then the remaining die continues it.
pos = [0] * 28; pos[25] = 1; pos[19] = -2
g.pos = tuple(pos); g.begin(B.WHITE, [1, 6])
a = g.view(white)["backgammon"]["analysis"]
check("bar plans enter before moving any other checker", a["need"] == 2 and all(x[0][0] == "bar" for x in a["plans"]))
g.move("bar", 24)
a = g.view(white)["backgammon"]["analysis"]
check("partial-turn plan updates for the remaining die", a["need"] == 1 and all(x == [[24, 18, 6]] for x in a["plans"]))

# Only one checker can move; the larger die is compulsory when both dice cannot be used.
pos = [0] * 28
for point, count in {6: -2, 8: -3, 11: -5, 12: -5, 13: -4, 14: -4, 20: 1}.items(): pos[point] = count
g.pos = tuple(pos); g.begin(B.WHITE, [1, 5])
a = g.view(white)["backgammon"]["analysis"]
check("one-die plan obeys the larger playable die rule", a["need"] == 1 and all(x[0][2] == 5 for x in a["plans"]))
check("higher-die examples are legal", all(valid_sequence(g.pos, B.WHITE, g.dice, x) for x in a["plans"]))

# An oversized die may bear off the farthest checker only after the smaller die is used.
pos = [0] * 28; pos[5] = 1
g.pos = tuple(pos); g.begin(B.WHITE, [2, 6])
a = g.view(white)["backgammon"]["analysis"]
check("bearing-off plans use both dice in order", a["need"] == 2 and all(x == [[5, 3, 2], [3, "off", 6]] for x in a["plans"]))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
