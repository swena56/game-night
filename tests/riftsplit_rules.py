"""Rift Split rules: two walls may grow at once but never cross, hearts give a life, orbs stay capped.

    python3 tests/riftsplit_rules.py
"""
import math
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
for level, speed in enumerate((4.9, 5.7, 6.5, 6.75), start=1):
    board = R.Board(random.Random(1), level)
    check(f"level {level} orb speed is {speed}", R.ball_speed(level) == speed
          and all(math.isclose(math.hypot(vx, vy), speed) for _, _, vx, vy in board.balls))

later_levels = range(4, R.MAX_LEVEL + 1)
check("level 4 onward retains the speed curve and cap",
      all(R.ball_speed(level) == min(11.0, 6.5 + 0.25 * (level - 3)) for level in later_levels))
later_boards = (R.Board(random.Random(1), level) for level in later_levels)
check("level 4 onward retains orb counts, lives, and seal goals",
      all(len(board.balls) == min(11, 2 + (board.level - 1) // 3)
          and board.lives == min(6, 3 + (board.level - 1) // 3)
          and math.isclose(R.level_goal(board.level), min(0.85, 0.50 + 0.015 * board.level))
          for board in later_boards))
check("early goals are gentle", abs(R.level_goal(1) - 0.515) < 1e-9 and R.level_goal(5) < 0.6)
check("walls slow down with level, floor 8", R.grow_speed(1) == 15.0 and R.grow_speed(19) == 8.0 and R.grow_speed(50) == 8.0)
check("fewer power-ups from level 9", len([q for q in R.Board(random.Random(1), 10).pickups if q[2] != "heart"]) == 1)
check("orbs capped", len(R.Board(random.Random(1), 40).balls) <= R.MAX_ORBS)
check("lives capped", R.Board(random.Random(1), 40).lives <= R.MAX_LIVES)
check("speed capped", R.ball_speed(99) <= 11.0)
c = R.Board(random.Random(3), 1)
c.balls = [[3 + 1 + R.RADIUS + 0.4, 15.0, 0.0, 0.0]]
c.place(3, 15, True)
sc = c.score
for _ in range(900):
    c.step(R.STEP, 0)
check("near miss that still seals: close call + bonus", c.event == "close" and c.score >= sc + R.CLOSE_BONUS, f"{c.event} {c.score}")
d = R.Board(random.Random(3), 1)
d.balls = [[20.5, 15.0, 0.0, 0.0]]
d.place(3, 15, True)
for _ in range(900):
    d.step(R.STEP, 0)
check("clear sweep is a plain seal", d.event == "seal", d.event)
print("FAILED" if fails else "all ok")
sys.exit(1 if fails else 0)
