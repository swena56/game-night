"""Dots & Boxes 🔥 Hot streak: 3 boxes in one turn pays +2, 6 pays +4 more; off by setting; bots stay legal.

    python3 tests/boxes_streak.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def row(streak=None):
    """3x3, no gems: the top row is a strip of three boxes with only the inner verticals missing."""
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo")]
    r.switch_game("boxes")
    r.settings.update(size=3, gems=False)
    if streak is not None:
        r.settings["streak"] = streak
    r.start()
    g = r.game
    for c in range(3):
        g.h[0][c] = g.h[1][c] = -1
    g.v[0][0] = g.v[0][3] = -1
    cur = r.players[r.turn]
    return r, g, cur


r, g, p = row()
s0 = p.g.score
g.act(p, {"type": "line", "d": "v", "r": 0, "c": 1})
check("one box, no bonus", p.g.score == s0 + 1, p.g.score)
g.act(p, {"type": "line", "d": "v", "r": 0, "c": 2})
check("three in a turn pays +2", p.g.score == s0 + 3 + 2 and p.g.boxes == 3, p.g.score)

r, g, p = row()
g.run = 5
g.act(p, {"type": "line", "d": "v", "r": 0, "c": 1})
check("sixth box pays +4", p.g.score == 1 + 4, p.g.score)

r, g, p = row(streak=False)
g.act(p, {"type": "line", "d": "v", "r": 0, "c": 1})
g.act(p, {"type": "line", "d": "v", "r": 0, "c": 2})
check("off by setting", p.g.score == 3, p.g.score)

r, g, p = row()
g.act(p, {"type": "line", "d": "h", "r": 2, "c": 0})
check("a miss resets the run", g.run == 0)

import random
for size in (3, 4):
    for seed in range(3):
        random.seed(seed)
        r = server.Room("B%d%d" % (size, seed))
        for k, lvl in enumerate(("easy", "normal", "hard")):
            q = r.add_player(f"B{k}"); q.bot = lvl
        r.switch_game("boxes"); r.settings["size"] = size; r.start(); g = r.game
        legal = True
        for _ in range(200):
            if r.phase != "playing":
                break
            q = r.players[r.turn]
            free = {ln for ln in g.lines() if not g.is_drawn(ln)}
            seen = []
            orig = g.draw
            g.draw = lambda pp, ln, orig=orig, seen=seen: (seen.append(ln), orig(pp, ln))[1]
            g.bot_turn(q)
            g.draw = orig
            legal &= all(ln in free for ln in seen) and len(seen) == 1
        check(f"{size}x{size} seed {seed}: bots legal and game ends", legal and r.phase != "playing")

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
