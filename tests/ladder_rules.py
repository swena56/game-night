"""Word Ladder: 🔎 peek marks the letter to change next (once per step) and costs a point at the finish;
a hint still costs three. Runs a real room with one player.

    python3 tests/ladder_rules.py        # a second or two (it loads the word list)
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import ladder as L  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def new_room():
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    room.switch_game("ladder")
    room.start()
    return room, ann, room.game


room, ann, g = new_room()
g.act(ann, {"type": "peek"})
v = g.view(ann)["ladder"]
start = g.paths[ann.id][-1]
check("a peek marks one letter", isinstance(v["peek"], int) and 0 <= v["peek"] < g.n_len, v["peek"])
try:
    g.act(ann, {"type": "peek"})
    check("a second peek at the same step is refused", False)
except GameError:
    check("a second peek at the same step is refused", True)
spot = v["peek"]
nxt = g.best_step(start, g.paths[ann.id])
check("the marked letter can lead on", nxt is not None)

# climb the rest with the solver: the finish pays one point less for the peek
while g.paths[ann.id][-1] != g.target:
    w = g.best_step(g.paths[ann.id][-1], g.paths[ann.id])
    g.act(ann, {"type": "step", "word": w})
    check_peek = g.view(ann)["ladder"]["peek"]
check("the peek is gone after the step", check_peek is None)
steps = len(g.paths[ann.id]) - 1
want = max(2, L.FINISH - L.OVER_PAR * max(0, steps - g.par)) - L.PEEK
check("finish pays one point less", g.gained.get(ann.id) == want, f"gained={g.gained} want={want}")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
