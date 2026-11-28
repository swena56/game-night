"""Putt Party rounded corners (#368): every outer corner of the course without a bank curves at radius ROUND, in the
ball physics as on screen. Putts fired into those corners from all round never pass the curve or leave the course.

    python3 tests/putt_round.py
"""
import math
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import putt  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


corners = shots = 0
worst_arc = worst_cell = 0.0
for seed in range(12):
    hole = putt.make_hole(random.Random(seed), "classic")
    c = putt.Course(hole)
    for (cx, cy), arcs in c.rounds.items():
        for ox, oy, sx, sy in arcs:
            corners += 1
            for k in range(7):   # aim from inside the tile into the corner, from steep to shallow, hard and soft
                a = math.atan2(sy, sx) + (k - 3) * 0.22
                for power in (0.35, 0.9):
                    start = (cx + 0.5 - 0.25 * sx, cy + 0.5 - 0.25 * sy)
                    _, _, frames = putt.simulate(c, start, a, power)
                    shots += 1
                    for f in frames:
                        x, y = f[0], f[1]
                        worst_cell = max(worst_cell, 0.0 if c.open(math.floor(x), math.floor(y)) else 1.0)
                        if (math.floor(x), math.floor(y)) == (cx, cy) and (x - ox) * sx > 0 and (y - oy) * sy > 0:
                            worst_arc = max(worst_arc, math.hypot(x - ox, y - oy) - (putt.ROUND - putt.BALL))
check("courses have rounded corners", corners > 20, f"{corners} corners")
check("the ball never passes a rounded corner's curve", worst_arc < 0.02, f"worst {worst_arc:.3f} past it, {shots} putts")
check("the ball never leaves the course", worst_cell == 0.0)
hole = putt.make_hole(random.Random(1), "classic")
c = putt.Course(hole)
banked = {(cx, cy) for cx, cy, *_ in hole.get("banks", [])}
check("a bank's corner keeps the bank, not a curve", all(
    not any((sx, sy) == (-(ex + nx), -(ey + ny)) for _, _, sx, sy in c.rounds.get((cx, cy), ()))
    for cx, cy, ex, ey, nx, ny, _ in hole.get("banks", [])), f"{len(banked)} banks")
print("\n" + ("putt round corners OK" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
