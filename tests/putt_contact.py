"""Putt Party ball contact: off by default; on, a ball in play blocks and bounces a putt; tee balls never do.

    python3 tests/putt_contact.py
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


def game(contact):
    r = server.Room("TEST")
    r.add_player("Ann"); r.add_player("Bo")
    r.switch_game("putt")
    r.settings["holes"] = 3
    r.settings["contact"] = contact
    r.start()
    return r.game


check("default off", putt.Putt.settings_schema["contact"][2] == 0)
for contact in (0, 1):
    g = game(contact)
    c = g.get_course()
    tx, ty = g.hole["tee"]
    # straight at a spot ~1 tile away: put Bo's ball there, already in play
    path = g.hole["path"]
    a = math.atan2(g.hole["cup"][1] - ty, g.hole["cup"][0] - tx)
    bx, by = tx + math.cos(a) * 0.9, ty + math.sin(a) * 0.9
    g.balls[1] = [bx, by]; g.strokes[1] = 1
    free, _, _ = putt.simulate(c, (tx, ty), a, 0.5)
    hits = []
    hit, _, _ = putt.simulate(c, (tx, ty), a, 0.5, hits=hits, others=[(bx, by)] if contact else ())
    bumped = any(h[3] == "ball" for h in hits)
    check(f"contact={contact} bump {'happens' if contact else 'absent'}", bumped == bool(contact))
    check(f"contact={contact} path {'changes' if contact else 'same'}", (hit != free) == bool(contact))
    g.putt(0, a, 0.5)
    check(f"contact={contact} putt resolves, ball in bounds", g.strokes[0] == 1)
# unplayed balls on the tee never block
g = game(1)
g.putt(0, 0.0, 0.3)
check("tee ball of unplayed player does not block", g.strokes[1] == 0)
print("FAIL" if fails else "all ok")
sys.exit(1 if fails else 0)
