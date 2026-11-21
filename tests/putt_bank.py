"""Putt Party bank shot: holing out after 3+ bounces gets a callout; fewer doesn't; scoring unchanged.

    python3 tests/putt_bank.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import putt  # noqa: E402

fails = []


def run(nhits):
    r = server.Room("TEST")
    r.add_player("Ann"); r.add_player("Bo")
    r.switch_game("putt")
    r.settings["holes"] = 3
    r.start()
    g = r.game
    cx, cy = g.hole["cup"]
    g.balls[0] = [cx, cy - 1]
    g.strokes[0] = 1
    real = putt.simulate

    def fake(*a, hits=None, **k):
        for n in range(nhits):
            hits.append([1 + n, cx, cy, "wall", 1.0])
        return (cx, cy), "cup", [[cx, cy]]
    putt.simulate = fake
    try:
        r.turn = g.seats[0]
        g.putt(0, 0.0, 0.5)
    finally:
        putt.simulate = real
    return g, [m for m in str(getattr(r, "moments", "")) + str(r.log)]


for n, want in ((3, True), (2, False)):
    g, _ = run(n)
    txt = str(g.room.__dict__)
    ok = ("bank shot" in txt) == want
    print("ok  " if ok else "FAIL", f"{n} bounces -> bank={want}")
    if not ok:
        fails.append(n)
sys.exit(1 if fails else 0)
