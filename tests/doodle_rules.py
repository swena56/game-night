"""Doodle Dash: once the picture is finished, more letters show through the last-chance time (one every
quarter, at spots fixed for the picture, never the whole word), and each one shown takes a point off a
correct guess. Runs a real room with a stopped clock.

    python3 tests/doodle_rules.py        # well under a second
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import doodle as D  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


room = server.Room("TEST")
ann = room.add_player("Ann")
bo = room.add_player("Bo")
room.switch_game("doodle")
room.start()
g = room.game
long_word = next(i for i, d in enumerate(D.DRAWINGS) if len(d[0]) >= 7 and " " not in d[0])
g.pic = D.DRAWINGS[long_word]
clock = [g.t0]
g.now = lambda: clock[0]


def letters():
    return sum(ch not in "_ " for ch in g.hint((clock[0] - g.t0) / D.DRAW_SECS))


clock[0] = g.t0 + D.DRAW_SECS * 0.9
check("first letter before the end", letters() == 1, g.hint(0.9))
clock[0] = g.t0 + D.DRAW_SECS + 0.1
check("no late letter yet", letters() == 1)
step = D.GRACE_SECS / (D.EXTRA_LETTERS + 1)
seen = []
for k in range(1, D.EXTRA_LETTERS + 1):
    clock[0] = g.t0 + D.DRAW_SECS + k * step + 0.01
    seen.append(letters())
check("one more letter each quarter", seen == [2, 3, 4], seen)
h = g.hint(2)
check("never the whole word", "_" in h, h)
check("the same spots on every look", g.hint(2) == h)

g.act(ann, {"type": "guess", "text": g.pic[0]})
got = dict(g.solvers).get(ann.id)
check("each late letter costs a point", got == max(1, 3 + 2 - D.EXTRA_LETTERS), f"got {got}")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
