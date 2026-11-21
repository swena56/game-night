"""Sky Drop levels 6-8: gusts warn then push, shutters close and open and stay flyable, level 8 pays more per ring,
Climb steps 1/4/8, a hitless dive earns a medal, and all-bot dives finish on every level.

    python3 tests/skydrop_levels.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import skydrop as M  # noqa: E402

fails = []
CLOCK = [2_000_000.0]
M.time.time = lambda: CLOCK[0]


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def game(level, bots=2, **s):
    r = server.Room("TEST")
    r.add_player("Ann")
    r.switch_game("skydrop")
    for _ in range(bots):
        r.add_bot("hard")
    r.settings["level"] = level
    r.settings.update(s)
    CLOCK[0] += 1000
    r.start()
    return r, r.game


def run(g, secs=140):
    end = CLOCK[0] + secs
    while CLOCK[0] < end and g.room.phase == "playing" and g.stage != "results":
        CLOCK[0] += 1 / 30
        with g.room.cond:
            if g.frame(CLOCK[0]):
                g.room.snap()


for lv in (6, 7, 8):
    r, g = game(lv)
    check(f"L{lv} gusts exist, spaced", len(g.gusts) >= 3 and all(a[1] <= b[0] for a, b in zip(g.gusts, g.gusts[1:])), len(g.gusts))
    n_shut = sum(1 for h in g.hazards if h[3] in M.SHUT_KINDS)
    check(f"L{lv} shutters {'present' if lv >= 7 else 'absent'}", (n_shut > 0) == (lv >= 7), n_shut)
    g.flyers[0].done_at = -1   # the human sits out; the bots dive
    run(g)
    bots = [f for f in g.flyers[1:]]
    check(f"L{lv} bots finish", all(f.depth >= M.LENGTH for f in bots), [round(f.depth) for f in bots])

# shutters: wide open at the right phase, shut at the opposite one, always symmetric about the line
r, g = game(7)
g.race_started = 0.0
jl = (0.0, 0.0, 0.0, M.SHUT_KINDS[0], -1.5707963)   # sin(rate*0 + ph) = -1 -> s = 0 -> open
x_open = g.hazard_position(0, -3.2, 0, M.SHUT_KINDS[0], -1.5707963, 0.0)[0]
x_open_r = g.hazard_position(0, 3.2, 0, M.SHUT_KINDS[1], -1.5707963, 0.0)[0]
x_shut = g.hazard_position(0, -3.2, 0, M.SHUT_KINDS[0], 1.5707963, 0.0)[0]
x_shut_r = g.hazard_position(0, 3.2, 0, M.SHUT_KINDS[1], 1.5707963, 0.0)[0]
check("shutter open: jaws at ±3.2", abs(x_open + 3.2) < 1e-6 and abs(x_open_r - 3.2) < 1e-6)
check("shutter shut: jaws close in, symmetric", abs(x_shut + x_shut_r) < 1e-6 and x_shut > x_open + 2.0, (x_shut, x_shut_r))

# a gust warns once, then pushes
r, g = game(6, bots=1)
f = g.flyers[0]
g.stage = "race"
g.race_started = CLOCK[0]
g.gusts = [[100.0, 140.0, 1]]
f.depth, f.x, f.vx = 71.0, 0.0, 0.0
CLOCK[0] += 1 / 30
g.simulate(1 / 30, CLOCK[0])
warns = [e for e in g.events if e[1] in ("gustr", "gustl") and e[2] == 0]
check("gust warns once 30 ahead", len(warns) == 1 and warns[0][1] == "gustr", warns)
g.simulate(1 / 30, CLOCK[0])
check("no second warning", len([e for e in g.events if e[1] in ("gustr", "gustl")]) == 1)
f.depth, f.vx = 110.0, 0.0
g.simulate(1 / 30, CLOCK[0])
check("inside the gust you are pushed", f.vx > 0.1, f.vx)
f.depth, f.vx = 176.0, 0.0
g.simulate(1 / 30, CLOCK[0])
check("outside it you are not", abs(f.vx) < 1e-6, f.vx)

# Climb: 1, 4, 8
r, g = game(0, bots=1, runs=3)
check("climb run 1 is level 1", g.level == 1, g.level)
for want, run in ((4, 2), (8, 3)):
    g.run = run - 1
    g.new_run(CLOCK[0])
    check(f"climb run {run} is level {want}", g.level == want, g.level)

# medal for a hitless dive (level 3+), none on level 1
for lv, medal in ((5, True), (1, False)):
    r, g = game(lv, bots=1)
    f = g.flyers[0]
    f.depth, f.done_at, f.hits, f.score = M.LENGTH, 5.0, 0, 0
    g.flyers[1].done_at = -1
    g.finished = [0]
    g.end_run(CLOCK[0])
    got = f.score >= 18 + M.MEDAL_PERFECT
    check(f"L{lv} hitless dive {'earns' if medal else 'earns no'} a medal", got == medal, f.score)

# level 8 pays 25% more per ring
check("level 8 ring points x1.25", M.LEVELS[8]["pts"] == 1.25 and M.LEVELS[5].get("pts", 1.0) == 1.0)
sys.exit(1 if fails else 0)
