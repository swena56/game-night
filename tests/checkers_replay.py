"""Checkers move replay keeps forced jump chains grouped and follows accepted undo state."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import checkers as C  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("REPLAY")
r.add_player("Ann"); r.add_player("Bo")
r.switch_game("checkers")
r.start()
g = r.game
dark = r.players[g.seats[0]]
board = [[None] * 8 for _ in range(8)]
board[5][0], board[4][1], board[2][3], board[0][7] = "d", "l", "l", "l"
g.board = board
path = C.moves_for(board, "d", False)[0]
check("forced two-jump chain is one legal move", path == [(5, 0), (3, 2), (1, 4)])
g.play(dark, path)
entry = g.history[0]
check("history stores one grouped record with both captures", len(g.history) == 1 and entry["path"] == [[5, 0], [3, 2], [1, 4]] and entry["taken"] == 2)
check("history snapshot exactly matches the resulting board", entry["board"] == C.board_code(g.board))
view = g.view(dark)["checkers"]
check("replay view includes its initial and recorded board", view["initial"] == C.initial() and view["history"] == g.history)
json.dumps(view)
check("replay view serialises", True)
undo = g.snaps[-1][1]
g.undo_restore(undo)
check("restoring an accepted undo removes the replayed move", not g.history and g.board == board)
g.undo_restore((board, 0, None))
check("legacy three-field undo snapshots remain readable", g.board == board)

r2 = server.Room("FLYING-REPLAY")
r2.add_player("Cy"); r2.add_player("Di")
r2.switch_game("checkers")
r2.settings["kings"] = "flying"
r2.start()
g2 = r2.game
dark2 = r2.players[g2.seats[0]]
flying = [[None] * 8 for _ in range(8)]
flying[7][0], flying[5][2], flying[2][5], flying[0][1] = "D", "l", "l", "l"
fpath = next(m for m in C.moves_for(flying, "d", True) if m == [(7, 0), (3, 4), (1, 6)])
g2.board = flying
g2.play(dark2, fpath)
check("flying-king jump chain is retained as one replay record", len(g2.history) == 1 and g2.history[0]["path"] == [[7, 0], [3, 4], [1, 6]] and g2.history[0]["taken"] == 2)

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
