"""Chess 3️⃣ Three-check (off by default): the third check wins at once; bots chase it with legal moves; undo restores the count.

    python3 tests/chess_threecheck.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import chess  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(variant=None):
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("chess")
    if variant:
        r.settings["variant"] = variant
    r.start()
    return r, r.game


def bare(g, r):
    """White rook a1 + king e1, black king h8 (not in check). Ra8 checks along the back rank."""
    b = [[None] * 8 for _ in range(8)]
    b[7][4], b[7][0], b[0][6] = "wK", "wR", "bK"
    g.pos = chess.Pos(b, "w", "", None, 0)
    r.turn = g.seats[0]
    return r.players[g.seats[0]]


CHECK = (7, 0, 0, 0, None)  # Ra1-a8+

r, g = game()
w = bare(g, r)
g.play(w, CHECK)
check("standard: checks aren't counted", r.phase == "playing" and g.view(w)["chess"]["checks"] is None)

r, g = game("threecheck")
w = bare(g, r)
check("view starts at 0-0", g.view(w)["chess"]["checks"] == {"w": 0, "b": 0})
g.play(w, CHECK)
check("a check counts", g.checks["w"] == 1 and r.phase == "playing", g.checks)

r, g = game("threecheck")
w = bare(g, r)
g.checks = {"w": 2, "b": 0}
g.play(w, CHECK)
check("the third check wins", r.phase == "over" and r.winner == w.id)

# undo restores the count
r, g = game("threecheck")
w = bare(g, r)
st = g.undo_state()
g.play(w, CHECK)
g.undo_restore(st)
check("undo state restores checks", g.checks == {"w": 0, "b": 0})

# bots: legal moves, and a bot on its third check takes it
for lvl in ("normal", "hard"):  # (easy plays a random move 30% of the time)
    r, g = game("threecheck")
    w = bare(g, r)
    w.bot = lvl
    g.checks = {"w": 2, "b": 0}
    g.bot_turn(w)
    check(f"{lvl} bot gives the winning check", r.phase == "over" and r.winner == w.id)
# a short bot game stays legal
r, g = game("threecheck")
for p in r.players.values():
    p.bot = "easy"
ok = True
for _ in range(30):
    if r.phase != "playing":
        break
    p = r.players[r.turn]
    legal = set(chess.legal(g.pos))
    g.bot_turn(p)
    ok = ok and g.last is not None and tuple(g.last) in {m[:4] for m in legal}
check("easy bots play legal moves", ok)

print("FAIL" if fails else "all ok", fails or "")
sys.exit(1 if fails else 0)
