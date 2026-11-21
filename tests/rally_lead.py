"""Hover Rally 🥇 lead change callouts (clear gap, rate-limited) and the 🏁 final-lap call; none in Elimination.

    python3 tests/rally_lead.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def race(**s):
    r = server.Room("TEST")
    r.add_player("Ann")
    r.add_player("Bob")
    r.switch_game("rally")
    r.settings.update(s)
    r.start()
    g = r.game
    said = []
    g.moment = lambda text, *a, **k: said.append(text)
    g.started = 100.0
    return g, said


g, said = race()
g.crafts[0].s, g.crafts[1].s = 50.0, 10.0
g.lead_check(110.0)
check("first sight of the leader is silent", said == [])
g.crafts[1].s = 51.0   # ahead by one unit: inside the margin
g.lead_check(111.0)
check("a photo-finish swap isn't called", said == [] and g.leader == 0, said)
g.crafts[1].s = 50.0 + g.LEAD_MARGIN * g.length + 1
g.lead_check(112.0)
check("a clear pass is called", len(said) == 1 and "takes the lead" in said[0], said)
g.crafts[0].s = g.crafts[1].s + g.length
g.lead_check(113.0)
check("an immediate pass back is rate limited", len(said) == 1, said)
g.crafts[1].s = g.crafts[0].s + g.length
g.lead_check(120.0)
check("later it is called again", len(said) == 2, said)

g, said = race(mode="elim")
g.crafts[0].s, g.crafts[1].s = 50.0, 10.0
g.lead_check(110.0)
g.crafts[1].s = 500.0
g.lead_check(120.0)
check("no lead calls in Elimination", said == [], said)
sys.exit(1 if fails else 0)
