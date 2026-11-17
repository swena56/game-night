"""Paint Blast turn buffer (#100): hold a turn a little early and you keep running until the corridor opens,
then turn; a turn into a wall from standing still doesn't move you sideways; reversing is instant.

    python3 tests/paintblast_turns.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import paintblast as pb  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def corridor():
    """Everything walled off except row 1 (x 1..6) and a side turning down at x 4."""
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("paintblast")
    r.start()
    g = r.game
    n = g.n
    g.tiles = [pb.PILLAR] * (n * n)
    for x in range(1, 7):
        g.tiles[n + x] = pb.FLOOR
    for y in (2, 3):
        g.tiles[y * n + 4] = pb.FLOOR
    g.items, g.bombs = {}, {}
    me = g.seat(ann)
    g.pos = [n + 6, n + 6]
    g.pos[me] = n + 1
    g.me = me
    g.stage = "play"
    return g, ann, n


def run(g, ticks):
    for _ in range(ticks):
        g.step()


xy = lambda g, n: (g.pos[g.me] % n, g.pos[g.me] // n)

g, ann, n = corridor()
g.on_input(ann, {"dir": 1})            # run right (the first step is at once)
run(g, 1)
check("running right", xy(g, n) == (2, 1), xy(g, n))
g.on_input(ann, {"dir": 2})            # swipe down two tiles early
run(g, 1)
check("an early turn keeps you running", xy(g, n)[1] == 1 and xy(g, n)[0] >= 2, xy(g, n))
run(g, pb.MOVE_TICKS * 4)
check("…and turns at the opening", xy(g, n)[0] == 4 and xy(g, n)[1] >= 2, xy(g, n))

g, ann, n = corridor()
g.on_input(ann, {"dir": 2})            # down into the wall, standing still
run(g, pb.MOVE_TICKS * 3)
check("a turn into a wall from standing doesn't slide you", xy(g, n) == (1, 1), xy(g, n))

g, ann, n = corridor()
g.on_input(ann, {"dir": 1})
run(g, pb.MOVE_TICKS * 2 + 1)
x0 = xy(g, n)[0]
g.on_input(ann, {"dir": 3})            # straight back
run(g, pb.MOVE_TICKS + 1)
check("reversing is instant", xy(g, n)[0] < x0, (x0, xy(g, n)))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
