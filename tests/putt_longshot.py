"""Putt Party long shot: holing out from 3.5+ tiles takes a stroke off (never below 1); short putts don't; off by setting; bots stay legal.

    python3 tests/putt_longshot.py
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import putt  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def course(longshot=None):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("putt")
    r.settings["holes"] = 3
    if longshot is not None:
        r.settings["longshot"] = longshot
    r.start()
    return r, r.game, ann, bo


def hole_out(g, i, strokes_before, dist):
    """Make seat i hole out with one more putt, from `dist` tiles away, after `strokes_before` strokes."""
    cx, cy = g.hole["cup"]
    g.balls[i] = [cx, cy - dist]
    g.strokes[i] = strokes_before
    real = putt.simulate
    putt.simulate = lambda *a, **k: ((cx, cy), "cup", [[cx, cy]])
    try:
        g.putt(i, 0.0, 0.5)
    finally:
        putt.simulate = real
    return g.strokes[i]


check("setting defaults on", putt.Putt.defaults()["longshot"] == 1)
r, g, ann, bo = course()
check("long putt on 3rd stroke counts 2", hole_out(g, 0, 2, 4.0) == 2)
r, g, ann, bo = course()
check("short putt keeps its stroke", hole_out(g, 0, 2, 1.0) == 3)
r, g, ann, bo = course()
check("hole in one from far stays 1", hole_out(g, 0, 0, 5.0) == 1)
r, g, ann, bo = course()
hole_out(g, 0, 1, 4.0)
check("long shot trimming 2 to 1 is not an ace", not any("Hole in one" in e["text"] or "HOLE IN ONE" in e["text"] for e in r.log[-4:]))
v = g.view(ann)["putt"]
check("the screens are told it was a long shot (#387)", v["longShots"][0] == [g.hole_no] and v["strokes"][0] == 1, v.get("longShots"))
r, g, ann, bo = course()
hole_out(g, 0, 0, 5.0)
check("a real hole in one is no long shot", not any(g.view(ann)["putt"]["longShots"]) if g.view(ann)["putt"]["longShots"] else True)
r, g, ann, bo = course(0)
check("off: long putt counts normally", hole_out(g, 0, 2, 4.0) == 3)
r, g, ann, bo = course()
del r.settings["longshot"]
check("old room without the setting plays with it", hole_out(g, 0, 2, 4.0) == 2)

# bots play whole holes legally (exceptions propagate)
r, g, ann, bo = course()
bo.bot = "hard"
ok = True
for _ in range(6):
    a, pw = g.plan_shot(1, "hard")
    ok &= math.isfinite(a) and 0.0 < pw <= 1.0
    g.putt(1, a, pw)
    ok &= 1 <= g.strokes[1] <= 20
    if g.holed[1]:
        break
check("bot putts legal", ok, g.strokes)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
