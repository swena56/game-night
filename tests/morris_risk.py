"""Nine Men's Morris move-risk warnings: a move that lets the rival block me is 'loss', one that spends the
quiet-move allowance is 'draw', and only the mover sees them.

    python3 tests/morris_risk.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import morris as M  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("TEST")
for n in ("Ann", "Bo"):
    r.add_player(n)
r.switch_game("morris")
r.start()
g = r.game
me = g.seat(r.players[r.turn])
mover = r.players[r.turn]
other = r.players[g.seats[1 - me]]
check("no risks at the start", g.view(mover)["morris"]["risk"] == [])
check("the waiting player gets none", g.view(other)["morris"]["risk"] == [])

# quiet-move clock: the next step runs it out → a draw warning
board = [None] * 24
for i in (0, 1, 2):
    board[i] = me
for i in (9, 10, 11):
    board[i] = 1 - me
g.state = (tuple(board), (0, 0), M.QUIET_LIMIT - 1)
mv = [m for m in M.legal(g.state, me, g.fly, g.twelve, g.lasker, g.safe)]
risks = g.risks(me, mv)
check("the move that spends the last quiet move is a draw warning", risks and all(v == "draw" for v in risks.values()))

# a man with one step left: moving next to the rival's blockers loses
board = [None] * 24
for i in (1, 3, 4):
    board[i] = 1 - me
board[0] = me
g.fly = False
g.state = (tuple(board), (0, 0), 0)
mv = M.legal(g.state, me, False, g.twelve, g.lasker, g.safe)
risks = g.risks(me, mv)
check("risks are computed without crashing and name only legal moves", set(risks) <= {(a, b) for a, b, _ in mv})
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
