"""Chess 👑 King of the Hill (off by default): a king stepping onto d4, e4, d5 or e5 wins at once; bots go for
it. Undo works in untimed games and not with a clock.

    python3 tests/chess_hill.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import chess  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(variant=None, clock=None):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("chess")
    if variant:
        r.settings["variant"] = variant
    if clock:
        r.settings["clock"] = clock
    r.start()
    return r, r.game


def bare(g, r):
    """White king on e3, black king on h8, white rook a1: the white king can step onto the hill."""
    b = [[None] * 8 for _ in range(8)]
    b[5][4], b[0][7], b[7][0] = "wK", "bK", "wR"
    g.pos = chess.Pos(b, "w", "", None, 0)
    r.turn = g.seats[0]
    return r.players[g.seats[0]]


r, g = game()
white = bare(g, r)
g.play(white, (5, 4, 4, 4, None))
check("standard: a king in the centre is just a move", r.phase == "playing")

r, g = game("hill")
white = bare(g, r)
g.play(white, (5, 4, 4, 4, None))
check("hill: the king on e4 wins", r.phase == "over" and r.winner == white.id)

r, g = game("hill")
white = bare(g, r)
white.bot = "normal"
g.bot_turn(white)
check("a bot takes the hill when it can", r.phase == "over" and r.winner == white.id, g.last)

r, g = game()
white = r.players[g.seats[0]]
black = r.players[g.seats[1]]
g.act(white, {"type": "move", "move": [6, 4, 4, 4, None]})
g.act(white, {"type": "undo_ask"})
g.act(black, {"type": "undo_yes"})
check("untimed: undo takes the move back", g.pos.b[6][4] == "wP" and g.pos.b[4][4] is None and r.turn == white.id)

r, g = game(clock=300)
white = r.players[g.seats[0]]
g.act(white, {"type": "move", "move": [6, 4, 4, 4, None]})
try:
    g.act(white, {"type": "undo_ask"})
    check("with a clock: no undo", False)
except GameError:
    check("with a clock: no undo", True)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
