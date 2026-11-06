"""Ultimate 🏆 Most small boards (off by default: a draw): when no line can be made, whoever won more small
boards wins; equal boards are still a draw.

    python3 tests/ultimate_tiebreak.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import ultimate  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def ending(tiebreak, boards):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("ultimate")
    if tiebreak is not None:
        r.settings["tiebreak"] = tiebreak
    r.start()
    g = r.game
    me = r.players[r.turn]
    i = g.seat(me)
    # every board decided except board 8, whose last empty square (80) is the final move
    cells = [0 if k % 2 else 1 for k in range(81)]
    cells[80] = None
    g.state = (tuple(cells), tuple(boards[:8]) + (None,), None)
    ultimate_legal = ultimate.legal
    ultimate.legal = lambda state, seat: [] if state[0][80] is not None else [80]
    ultimate.big_result_real = ultimate.big_result
    ultimate.big_result = lambda b: None
    try:
        g.mark(me, 80)
    finally:
        ultimate.legal = ultimate_legal
        ultimate.big_result = ultimate.big_result_real
    return r, g, me, i


r, g, me, i = ending(None, [0, 0, 1, 1, 0, "draw", 1, 0])
check("default: no line left is a draw", r.phase == "over" and r.winner is None)
r, g, me, i = ending("boards", [0, "draw", 0, 0, 1, "draw", 1, 0])
counts = [g.state[1].count(0), g.state[1].count(1)]
want = g.seats[0] if counts[0] > counts[1] else g.seats[1] if counts[1] > counts[0] else None
check("most small boards wins", r.phase == "over" and r.winner == want, (counts, r.winner))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
