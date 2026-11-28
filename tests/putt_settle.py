"""Putt Party settling (#390): a ball held against a wall on a slope used to run the shot to its 14 s limit (422 frames
at the same spot), so bots and the hole recap waited on a still ball. It must stop once settled, while a ball creeping
or rolling down open slope keeps going.

    python3 tests/putt_settle.py
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import putt  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def strip(n, kind="slope"):
    """n tiles in a column, all `kind`, sloping down toward y = 0 (the low wall)."""
    return putt.Course({"cells": [[0, y] for y in range(n)], "kinds": {f"0,{y}": kind for y in range(n)}, "slope": [0, -1],
                        "bumpers": [], "cup": [0.5, n - 0.45], "hills": [], "posts": [], "rocks": [], "mills": [], "banks": [],
                        "path": [[0, y] for y in range(n)], "tee": [0.5, 0.35]})


c = strip(2)
end, _, frames = putt.simulate(c, (0.5, 0.5), -math.pi / 2, 0.04)
check("a ball against the low wall stops once settled", len(frames) < 150, f"{len(frames)} frames")
check("...where it rests against the wall", abs(end[1] - putt.BALL) < 0.01, end)
c = strip(4)
end, _, frames = putt.simulate(c, (0.5, 3.0), 0.0, 0.0)
check("a ball at rest high on an open slope still creeps all the way down", end[1] < 0.1, end)
end, _, frames = putt.simulate(c, (0.5, 2.0), math.pi / 2, 0.05)
check("a gentle putt uphill rolls back down", end[1] < 0.1, end)
check("no shot runs to the 14 s limit here", len(frames) < putt.MAX_STEPS // 8, f"{len(frames)} frames")
print("\n" + ("putt settle OK" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
