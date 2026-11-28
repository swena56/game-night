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
# (#388) only balls still playing the hole block: not picked up, capped or gone
g = game(1)
tx, ty = g.hole["tee"]
g.balls[1] = [tx, ty + 0.9]; g.strokes[1] = 1
check("an active ball blocks", (tx, ty + 0.9) in g.blockers(0, (tx, ty)))
if not hasattr(g, "picked"):
    g.picked = [False] * len(g.seats)
g.picked[1] = True
check("a picked-up ball does not block", not g.blockers(0, (tx, ty)))
check("a picked-up ball shows as out of the hole", g.view(g.room.players[g.seats[0]])["putt"]["out"][1])
g.picked[1] = False
g.strokes[1] = g.cap or putt.SAFETY_CAP
check("a capped ball does not block", not g.blockers(0, (tx, ty)))
g.strokes[1] = 1
g.room.players[g.seats[1]].eliminated = True
check("a departed player's ball does not block", not g.blockers(0, (tx, ty)))
g.room.players[g.seats[1]].eliminated = False
g.strokes[1] = 0
check("a ball still on the tee does not block", not g.blockers(0, (tx, ty)))
# (#393) a bot plans with the balls that will really block it: on a straight, 3-wide hole with a rival ball right on
# the line to the cup, the hard bot's putts must not run into that ball (an open line runs either side of it)
import random as _random
wide = {"cells": [[x, y] for x in range(3) for y in range(5)], "kinds": {}, "slope": None, "bumpers": [], "cup": [1.5, 4.55],
        "hills": [], "posts": [], "rocks": [], "mills": [], "banks": [], "path": [(1, y) for y in range(5)], "tee": [1.5, 0.35],
        "par": 2, "theme": "day", "style": "classic"}
holed = {True: 0, False: 0}
left = {True: 0.0, False: 0.0}
for aware in (True, False):
    for trial in range(10):
        _random.seed(trial)
        g = game(1)
        g.hole = dict(wide); g.course = None
        g.balls[0] = [1.5, 0.6]; g.strokes[0] = 1
        g.balls[1] = [1.5, 2.6]; g.strokes[1] = 1          # Bo's ball, in play, dead on the line
        if not aware:   # what the bot used to do: plan as if nobody else were on the course
            real = g.blockers
            g.blockers = lambda i, start: []
            a, pw = g.plan_shot(0, "hard")
            g.blockers = real
        else:
            a, pw = g.plan_shot(0, "hard")
        end, result, _ = putt.simulate(g.get_course(), tuple(g.balls[0]), a, pw, others=g.blockers(0, tuple(g.balls[0])))
        holed[aware] += result == "cup"
        left[aware] += 0 if result == "cup" else math.hypot(end[0] - 1.5, end[1] - 4.55)
check("a hard bot that sees the ball in the way holes out more", holed[True] > holed[False], f"aware {holed[True]}/10, blind {holed[False]}/10")
check("...and leaves itself closer when it misses", left[True] < left[False], f"left {left[True]:.1f} vs {left[False]:.1f} tiles in all")
print("FAIL" if fails else "all ok")
sys.exit(1 if fails else 0)
