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

# 🔥 the sacrifice estimate counts the bonus: a 3-box chain (3 points) is the cheaper handout until the
# +2 streak makes it cost 5, while a chain of two with a 💎 (4 points) is never close enough to a streak.
FREE = {("h", 0, 0), ("h", 0, 2), ("h", 1, 0), ("h", 1, 2), ("h", 2, 2), ("h", 3, 2), ("v", 1, 0)}
THREE = {("h", 0, 2), ("h", 1, 2), ("h", 2, 2), ("h", 3, 2)}


def sacrifice(level, streak):
    r = server.Room("S")
    for n in ("Ann", "Bo"):
        q = r.add_player(n)
        q.bot = level
    r.switch_game("boxes")
    r.settings.update(size="3x4", gems=True, streak=streak)
    r.start()
    g = r.game
    g.gems = [[1, 3], [1, 0]]
    drawn = set(g.lines()) - FREE
    for d, rr, c in drawn:
        (g.h if d == "h" else g.v)[rr][c] = 0
    for b in g.cells():
        if all(sd in drawn for sd in g.sides_of(b)):
            g.owner[b[0]][b[1]] = 0
    assert not g.three_sided(drawn)
    q = r.players[r.turn]
    seen = []
    g.draw = lambda pp, ln: seen.append(ln)
    g.bot_turn(q)
    return seen[0] if len(seen) == 1 else None


for level in ("normal", "hard"):
    off = {sacrifice(level, False) for _ in range(12)}
    on = {sacrifice(level, True) for _ in range(12)}
    check(f"{level} bot hands over the 3-chain when streak is off", None not in off and off <= THREE, off)
    check(f"{level} bot avoids the 3-chain when the streak bonus tips it", None not in on and not (on & THREE), on)
for streak in (False, True):
    easy = {sacrifice("easy", streak) for _ in range(40)}
    check(f"easy bot ignores streak (streak={streak})", None not in easy and bool(easy & THREE))

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
