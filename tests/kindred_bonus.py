"""Kindred ⭐ bonus square: one square per board pays +2 to whoever fills it; setting can turn it off;
bots value it and only make legal moves.

    python3 tests/kindred_bonus.py
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import kindred as K  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(**settings):
    r = server.Room("TEST")
    for x in ("Ann", "Bo"):
        r.add_player(x)
    r.switch_game("kindred")
    r.settings.update(settings)
    r.start()
    g = r.game
    return r, g, [r.players[i] for i in g.seats]


r, g, (a, b) = game()
check("a bonus square is marked by default", g.bonus in range(16), g.bonus)
check("it is in the view", g.view(a)["kindred"]["bonus"] == g.bonus)
r2, g2, _ = game(bonus=False)
check("setting off: no bonus square", g2.bonus is None and g2.view(a)["kindred"]["bonus"] is None)

# filling the bonus square scores +2 even when it finishes no line, with a log line and a callout
g.board = [None] * 16
g.bonus = 5
g.hand, g.stage = 3, "place"
r.begin_turn(a.id)
g.act(a, {"type": "move", "cell": 5})
check("bonus square pays +2 alone", g.scores[g.seat(a)] == 2, g.scores)
text = json.dumps(list(r.log), ensure_ascii=False)
check("log and callout name the bonus", "⭐ bonus +2" in text and "takes the bonus square" in text)

# a plain square pays nothing; a finished line on the bonus square adds to the line's points
r, g, (a, b) = game()
g.board = [None] * 16
g.board[0], g.board[1], g.board[2] = 8, 9, 10
g.bonus = 3
g.hand, g.stage = 12, "place"
r.begin_turn(a.id)
line, _ = K.gain(g.board, g.through, 3, g.hand)
g.act(a, {"type": "move", "cell": 3})
check("line + bonus", g.scores[g.seat(a)] == line + 2 and line > 0, g.scores)
check("no bonus elsewhere", K.gain([None] * 16, g.through, 4, 1, 7)[0] == 0)

# bot-vs-bot: every move is legal (no exceptions swallowed), board fills, and a bonus cell is taken once
for level in ("easy", "normal", "hard"):
    r, g, (a, b) = game(rounds=1)
    random.seed(7)
    for p in (a, b):
        p.bot = level
    taken = 0
    for _ in range(80):
        if r.phase != "playing":
            break
        pl = r.players[r.turn]
        stage, board, pool = g.stage, list(g.board), g.pool()
        cell, give = g.choose(pl, level)
        if stage == "place":
            check(f"{level}: bot square is empty", cell is not None and board[cell] is None)
            if len(g.empties()) > 1:
                check(f"{level}: bot gives an unused piece", give in pool)
        else:
            check(f"{level}: bot gives from the pool", cell is None and give in pool)
        g.move(pl, cell, give)
    check(f"{level}: game finishes", r.phase == "over" and all(v is not None for v in g.board))
    total = sum(g.scores)
    check(f"{level}: scores include the bonus", total >= 2, g.scores)

# bots prefer the bonus square when nothing else scores
r, g, (a, b) = game(rounds=1)
g.board = [None] * 16
g.bonus = 9
g.hand, g.stage = 3, "place"
r.begin_turn(a.id)
a.bot = "normal"
cell, _ = g.choose(a, "normal")
check("bot takes the bonus square on an empty board", cell == 9, cell)

# the 'squares' variant: bonus still pays, alone and on top of a finished 2x2 block
r, g, (a, b) = game(variant="squares")
check("squares: variant is on and a bonus is marked", g.variant == "squares" and g.bonus in range(16), g.variant)
g.board = [None] * 16
g.bonus = 10
g.hand, g.stage = 3, "place"
r.begin_turn(a.id)
g.act(a, {"type": "move", "cell": 10})
check("squares: bonus pays +2 alone", g.scores[g.seat(a)] == 2, g.scores)
r, g, (a, b) = game(variant="squares")
g.board = [None] * 16
g.board[5], g.board[6], g.board[9] = 0, 1, 4  # three of the 2x2 block 5,6,9,10
g.bonus = 10
g.hand, g.stage = 5, "place"
r.begin_turn(a.id)
base, _ = K.gain(g.board, g.through, 10, g.hand)
g.act(a, {"type": "move", "cell": 10})
check("squares: bonus adds to a block's points", base > 0 and g.scores[g.seat(a)] == base + 2, (base, g.scores))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
