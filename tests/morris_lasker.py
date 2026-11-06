"""Lasker Morris (a Men choice; Nine Men's by default): 10 men each, and while you still hold men you may
place one or move one. Undo takes back your last move.

    python3 tests/morris_lasker.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import morris  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(men):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("morris")
    if men is not None:
        r.settings["men"] = men
    r.start()
    return r, r.game


r, g = game(None)
check("default: nine men each, placing only", g.state[1] == (9, 9) and all(m[0] < 0 for m in morris.legal(g.state, 0, True, False, g.lasker)))

r, g = game(10)
check("Lasker: ten men each", g.state[1] == (10, 10) and g.lasker)
p0 = r.players[r.turn]
g.act(p0, {"type": "move", "move": [-1, 0, -1]})
p1 = r.players[r.turn]
g.act(p1, {"type": "move", "move": [-1, 23, -1]})
moves = morris.legal(g.state, g.seat(p0), True, False, True)
check("with men in hand you may move as well as place", any(m[0] == 0 for m in moves) and any(m[0] < 0 for m in moves))
g.act(p0, {"type": "move", "move": [0, 1, -1]})
check("a move with men still in hand", g.state[0][1] == g.seat(p0) and g.state[1][g.seat(p0)] == 9)
g.act(p0, {"type": "undo_ask"})
g.act(p1, {"type": "undo_yes"})
check("undo takes it back", g.state[0][0] == g.seat(p0) and g.state[0][1] is None and r.turn == p0.id)

# bots play a whole Lasker game
r, g = game(10)
for p in r.seated():
    p.bot = "easy"
for _ in range(400):
    if r.phase != "playing":
        break
    g.bot_turn(r.players[r.turn])
check("easy bots finish a Lasker game", r.phase == "over", g.state[2])

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
