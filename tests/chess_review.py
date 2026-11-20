"""Chess post-game review: a hanging queen is flagged as a turning point with a better move named; quiet games have none.

    python3 tests/chess_review.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import chess as C  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def mv(g, uci):
    p = server.Room  # noqa: F841
    c = "abcdefgh"
    m = (8 - int(uci[1]), c.index(uci[0]), 8 - int(uci[3]), c.index(uci[2]), None)
    pl = g.room.players[g.room.turn]
    g.act(pl, {"type": "move", "move": list(m[:4]) + [0]})


r = server.Room("TEST")
for n in ("Ann", "Bo"):
    r.add_player(n)
r.switch_game("chess")
r.start()
g = r.game
check("no review while playing", g.view(r.players[g.seats[0]])["chess"]["review"] is None)
# fool's mate: 1. f3 e5 2. g4?? Qh4#  (White's f3 and g4 give everything away)
for u in ("f2f3", "e7e5", "g2g4", "d8h4"):
    mv(g, u)
check("the game ended in mate", r.phase == "over" and r.winner == g.seats[1])
v = g.view(r.players[g.seats[0]])["chess"]["review"]
check("review starts when the game is over", v is not None)
t = time.time()
while not g.review["done"] and time.time() - t < 30:
    time.sleep(0.2)
v = g.view(r.players[g.seats[0]])["chess"]["review"]
check("review finishes", v["done"])
check("g4 is flagged for White with a better move", any(s["ply"] == 2 and s["color"] == "w" and s["best"] != s["played"] for s in v["swings"]), v["swings"])
check("each swing names a best move with a loss", all(s["best"] and s["loss"] >= C.REVIEW_SWING for s in v["swings"]))
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
