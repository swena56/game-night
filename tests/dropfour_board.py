"""Drop Four board size for two players (6 × 7 by default; 7 × 8 or 7 × 9); 3–4 players always get 7 × 9.
The view says which seat is yours.

    python3 tests/dropfour_board.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def size(board, n=2):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("dropfour")
    if board is not None:
        r.settings["board"] = board
    r.start()
    g = r.game
    return (len(g.grid), len(g.grid[0])), g, ps


dims, g, ps = size(None)
check("default 6 × 7", dims == (6, 7))
check("view: my seat", g.view(ps[0])["d4"]["me"] == g.seats.index(ps[0].id))
check("7 × 8", size("7x8")[0] == (7, 8))
check("7 × 9", size("7x9")[0] == (7, 9))
check("three players: 7 × 9 whatever the setting", size("7x8", 3)[0] == (7, 9))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
