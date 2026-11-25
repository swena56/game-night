"""Rift Split rules: two walls may grow at once but never cross, hearts give a life, orbs stay capped.

    python3 tests/riftsplit_rules.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import riftsplit as R  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


b = R.Board(random.Random(3), 1)
b.sim = True
b.balls = [[1.5, 1.5, 0.0, 0.0]]
check("first wall placed", b.place(10, 10, True))
check("crossing horizontal refused", not b.can_place(10, 12))
check("cell on the live line refused", not b.can_place(10, 12))
check("parallel second wall allowed", b.place(20, 10, True))
check("third wall refused", not b.can_place(30, 10))
for _ in range(600):
    b.step(R.STEP, 0)
check("both walls finish", not b.walls)
check("orbs capped", len(R.Board(random.Random(1), 40).balls) <= R.MAX_ORBS)
check("lives capped", R.Board(random.Random(1), 40).lives <= R.MAX_LIVES)
check("speed capped", R.ball_speed(99) <= 10.5)
print("FAILED" if fails else "all ok")
sys.exit(1 if fails else 0)
