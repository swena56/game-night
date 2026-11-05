"""Spire Siege speed-up (#65): "gentle" by default (a level every 45 s, ×0.88, never quicker than 0.2 s a row);
"steady" is the old curve (every 30 s, ×0.85); "off" keeps the start speed. Rooms saved before the setting
keep the old curve. The browser gets the curve in the view; bots slow their ramp to match.

    python3 tests/spire_ramp.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import spire  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def siege(ramp):
    r = server.Room("TEST")
    ann = r.add_player("Ann")
    r.switch_game("spire")
    if ramp is not None:
        r.settings["ramp"] = ramp
    r.start()
    return r, r.game, ann


r, g, ann = siege(None)
check("default is gentle", g.s["ramp"] == "gentle" and g.view(ann)["spire"]["ramp"] == spire.RAMPS["gentle"])
g.t0 -= 100
check("gentle: level 2 after 100 s", g.level() == 2, g.level())

r, g, ann = siege("steady")
g.t0 -= 100
check("steady: level 3 after 100 s (old curve)", g.level() == 3, g.level())

r, g, ann = siege("off")
g.t0 -= 1000
check("off: never levels up", g.level() == 0)

r, g, ann = siege(None)
del r.settings["ramp"]
g.t0 -= 100
check("old room keeps the steady curve", g.level() == 3)

# the drop time a browser works out (spire.js interval): gentle reaches its floor; steady keeps shrinking
normal = spire.SPEEDS["normal"]
drop = lambda name, secs: max(spire.RAMPS[name]["floor"], normal * spire.RAMPS[name]["factor"] ** (secs // spire.RAMPS[name]["every"]))
check("gentle at 4 min is still over 0.35 s", drop("gentle", 240) > 0.35, round(drop("gentle", 240), 3))
check("gentle never under 0.2 s", drop("gentle", 3600) == 0.2)
check("steady at 4 min under 0.25 s", drop("steady", 240) < 0.25, round(drop("steady", 240), 3))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
