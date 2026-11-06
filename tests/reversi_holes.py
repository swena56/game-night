"""Reversi ⬛ blocked squares (off by default): four squares, two and their mirror images, that nobody can
play on and that stop a line of flips; bots play the game out.

    python3 tests/reversi_holes.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import reversi  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(holes):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("reversi")
    if holes is not None:
        r.settings["holes"] = holes
    r.start()
    return r, r.game


r, g = game(None)
check("default: no holes", reversi.HOLE not in g.board)
r, g = game(True)
holes = [c for c, v in enumerate(g.board) if v == reversi.HOLE]
check("four holes, mirrored through the centre", len(holes) == 4 and all(63 - c in holes for c in holes), holes)
check("never a corner or the centre", not set(holes) & {0, 7, 56, 63, 27, 28, 35, 36})
b = [None] * 64
b[0], b[1], b[2], b[3] = 0, 1, reversi.HOLE, None
check("a hole stops a line of flips", reversi.flips(tuple(b), 0, 3) == [])
for p in r.seated():
    p.bot = "easy"
for _ in range(100):
    if r.phase != "playing":
        break
    g.bot_turn(r.players[r.turn])
check("bots finish a game with holes", r.phase == "over" and sum(g.board.count(k) for k in (0, 1)) <= 60)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
