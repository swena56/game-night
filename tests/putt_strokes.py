"""Putt Party stroke limit (#68) and course styles (#70): 8 by default (the cap scores the hole); 6 or 10; or ∞, where a player
picks up with ⛳ (strokes so far +1) and a safety limit of 20 still ends a lost hole.

    python3 tests/putt_strokes.py
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import putt  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def course(limit):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("putt")
    if limit is not None:
        r.settings["strokes"] = limit
    r.settings["holes"] = 3
    r.start()
    return r, r.game, ann, bo


def tap(g, p):
    """A feeble putt away from the cup: never holes, never reaches water from the tee."""
    i = g.seat(p)
    bx, by = g.balls[i]
    cx, cy = g.hole["cup"]
    g.act(p, {"type": "putt", "angle": math.atan2(by - cy, bx - cx), "power": 0.04})


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


# default: 8, and the cap is what the hole costs
r, g, ann, bo = course(None)
check("default limit is 8", g.cap == 8 and g.view(ann)["putt"]["cap"] == 8)
check("pick up refused with a limit", refused(g, ann, {"type": "pickup"}) is not None)
for _ in range(8):
    tap(g, ann); tap(g, bo)
check("hole ends at 8 strokes", g.hole_no == 1 and g.between and g.cards[0][-1] == 8, f"cards {g.cards}")

# 6
r, g, ann, bo = course(6)
for _ in range(6):
    tap(g, ann); tap(g, bo)
check("limit 6 ends the hole at 6", g.between and g.cards == [[6], [6]], f"cards {g.cards}")

# no limit: past 8, then pick up
r, g, ann, bo = course(0)
check("no limit view", g.view(ann)["putt"]["cap"] is None)
check("pick up before a stroke is refused", refused(g, ann, {"type": "pickup"}) is not None)
for _ in range(9):
    tap(g, ann); tap(g, bo)
check("no limit: still playing after 9", not g.between and g.strokes == [9, 9], f"strokes {g.strokes}")
check("pick up out of turn refused", refused(g, bo, {"type": "pickup"}) is not None)
g.act(ann, {"type": "pickup"})
check("after pick up it is Bo's turn", r.turn == bo.id)
g.act(bo, {"type": "pickup"})
check("both picked up: hole scored strokes +1", g.between and g.cards == [[10], [10]], f"cards {g.cards}")

# no limit: the safety cap ends a hole nobody picks up
r, g, ann, bo = course(0)
for _ in range(putt.SAFETY_CAP):
    tap(g, ann); tap(g, bo)
check("safety cap ends the hole", g.between and g.cards[0][-1] == putt.SAFETY_CAP + 1, f"cards {g.cards}")

# a room saved before the setting existed plays to 8
r, g, ann, bo = course(None)
del r.settings["strokes"]
del g.picked
check("old room: cap 8", g.cap == 8 and not g.done(0))

# course styles (#70): classic by default; each style still builds a hole that starts and ends on the fairway
import random  # noqa: E402
r, g, ann, bo = course(None)
check("course defaults to classic", g.hole["style"] == "classic" and g.view(ann)["putt"]["theme"] in putt.THEMES)
for st in ("classic", "mixed", "water", "obstacles", "hills"):
    ok = True
    for seed in range(40):
        h = putt.make_hole(random.Random(seed), st)
        cells = {tuple(c) for c in h["cells"]}
        ok &= tuple(h["path"][0]) in cells and tuple(h["path"][-1]) in cells and h["kinds"].get("%d,%d" % h["path"][-1]) is None
    check(f"style {st} builds sound holes", ok)
waters = sum(list(putt.make_hole(random.Random(s), "water")["kinds"].values()).count("water") for s in range(60))
classic = sum(list(putt.make_hole(random.Random(s), "classic")["kinds"].values()).count("water") for s in range(60))
check("water style has more water", waters > classic * 2, f"{waters} vs {classic}")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
