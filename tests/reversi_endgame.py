"""Reversi endgame advice lists only legal moves and reports direct corner replies."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import reversi as R  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


board = [R.HOLE] * 64
board[0], board[9], board[10], board[11], board[18] = None, None, 1, 0, 1
board[20], board[28], board[36] = None, 1, 0
board = tuple(board)
hints = R.endgame_hints(board, 0)
check("endgame comparison includes only legal placements", set(hints) == set(R.placements(board, 0)), str(hints))
check("the X-square move reports its exact immediate corner danger", 9 in hints and 0 in hints[9]["corners"], str(hints.get(9)))
check("a move with no corner reply is reported as safer", 20 in hints and not hints[20]["corners"], str(hints.get(20)))
check("flip counts match the move rules", all(h["flips"] == len(R.flips(board, 0, c)) for c, h in hints.items()))

r = server.Room("ENDGAME")
white, black = r.add_player("White"), r.add_player("Black")
r.switch_game("reversi")
r.start()
g = r.game
white = r.players[g.seats[0]]
black = r.players[g.seats[1]]
g.board = board
r.turn = white.id
v = g.view(white)["reversi"]
check("the acting player receives the endgame comparison", set(map(int, v["endHints"])) == set(R.placements(board, 0)))
check("the rival never receives another player's endgame hint", g.view(black)["reversi"]["endHints"] == {})

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
