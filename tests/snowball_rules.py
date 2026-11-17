"""Snowball Scramble rules: nothing moves in the countdown, the stick moves you (and is validated), a throw
costs a snowball and lands after its flight, a hit takes a pip and three snow you in (the thrower scores),
a fort takes the hit for whoever shelters behind it and crumbles, snowballs come back, a giant grows in fresh
snow and flattens a rival, and the most snow-ins wins when the clock runs out.

    python3 tests/snowball_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import snowball as W  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.on_input(p, a)
    except GameError as e:
        return str(e)
    return None


def run(g, t0, secs):
    """Step the field from t0 for secs, 60 calls a second like the server; returns the new time."""
    t = t0
    with g.room.cond:
        for _ in range(int(secs * 60)):
            t += 1 / 60
            g.frame(t)
    return t


r = server.Room("TEST")
ps = [r.add_player(n) for n in ("Ann", "Bo")]
r.switch_game("snowball")
r.settings["time"] = 90
r.start()
g = r.game
ann, bo = ps
A, B = g.kids
for bad in ({"sx": "left", "sy": 0}, {"sx": 1}, {"sx": float("nan"), "sy": 0}, {"sx": True, "sy": 0}, {"throw": "hard"}):
    check(f"bad input refused {bad}", refused(g, ann, bad) is not None)
try:
    g.act(ann, {"type": "throw"})
    check("act is refused", False)
except GameError:
    check("act is refused", True)

# the countdown: the stick is taken but nobody moves
A.x, A.y, B.x, B.y = -5.0, 0.5, 5.0, 0.5
check("a stick is taken (and capped at 1)", refused(g, ann, {"sx": 3, "sy": 0}) is None and abs(A.sx - 1) < 1e-9)
t = g.go_at - 1
run(g, t, 0.5)
check("nobody moves in the countdown", A.x == -5.0 and g.stage == "countdown")
check("a throw in the countdown does nothing", not g.throw(0, t, False) and A.ammo == W.AMMO)
t = run(g, g.go_at - 0.01, 0.5)
check("the countdown ends", g.stage == "play")
check("the stick moves you", A.x > -5.0 + 1.5, f"{A.x:.2f}")
A.sx = A.sy = 0.0
t = run(g, t, 0.4)

# a throw: costs a snowball, flies, and lands on Bo if he stands still
A.x, A.y, B.x, B.y = -2.0, 6.0, 2.0, 6.0   # an open strip along the top, clear of forts
A.vx = A.vy = B.vx = B.vy = 0.0
A.fx, A.fy = 1.0, 0.0
check("a throw is taken", g.throw(0, t, False) and A.ammo == W.AMMO - 1 and len(g.balls) == 1)
ball = g.balls[0]
check("it aims where the target stands", (ball[2], ball[3]) == (2.0, 6.0) and ball[8] == -1)
check("no second throw inside the cooldown", not g.throw(0, t + 0.1, False))
t = run(g, t, 0.3)
check("it is still flying", B.pips == 0 and len(g.balls) == 1)
t = run(g, t, ball[5] - t + 0.1)
check("it lands and takes a pip", B.pips == 1 and not g.balls and A.hits == 1)
check("the hit went out as an event", any(e[2][0] == "hit" for e in g.events))
check("a snowball comes back", (run(g, t, W.RELOAD + 0.1) and A.ammo) == W.AMMO, f"{A.ammo}")
t += W.RELOAD + 0.1

# dodging: a throw at a spot Bo has left misses
B.x = 2.0
g.throw(0, t, False)
B.x = 4.0
t = run(g, t, 1.0)
check("a dodged snowball splats", B.pips == 1 and any(e[2][0] == "splat" for e in g.events))

# three pips snow you in, and the thrower scores
B.x, B.y = 2.0, 6.0
A.cool_until = 0
g.throw(0, t, True)   # a big one: two pips
t = run(g, t, 1.0)
check("a big one takes two pips and snows him in", B.pips == 0 and B.frozen_until > t and A.points == 1, f"pips {B.pips}, pts {A.points}")
B.sx = 1.0
x0 = B.x
t = run(g, t, 0.5)
check("snowed in, you can't move", abs(B.x - x0) < 0.05)
check("and can't throw", not g.throw(1, t, False))
B.sx = 0.0
t = run(g, t, W.FROZEN)

# a fort shelters whoever hides close behind it, and crumbles
fx, fy, horiz = W.FORTS[6]   # the upright fort left of centre at (-2.4, 0)
A.x, A.y = fx - 4.5, fy
B.x, B.y = fx + 0.9, fy
A.ammo, A.cool_until = W.AMMO, 0
hp = g.forts[6]
g.throw(0, t, False, (B.x, B.y))
check("the fort is in the way", g.balls[-1][8] == 6)
t = run(g, t, 1.0)
check("the fort takes the hit", g.forts[6] == hp - 1 and B.pips == 0)
for _ in range(6):
    if g.forts[6] <= 0:
        break
    A.ammo, A.cool_until = W.AMMO, 0
    g.throw(0, t, True, (B.x, B.y))
    t = run(g, t, 1.0)
check("enough hits knock it down", g.forts[6] == 0 and any(e[2][0] == "crumble" for e in g.events))
A.ammo, A.cool_until = W.AMMO, 0
B.pips = 0
g.throw(0, t, False, (B.x, B.y))
t = run(g, t, 1.0)
check("with the fort down the throw gets through", B.pips == 1)
B.x, B.y = 6.0, 5.8
t = run(g, t, W.FORT_REGROW + 0.5)
check("the fort grows back", g.forts[6] == W.FORT_HP)

# ⛄ a giant grows in fresh snow and flattens a rival
px, py = W.PATCHES[2]
A.x, A.y, A.giant = px - 1.0, py + 0.5, 0.0
B.x, B.y = 8.0, -6.0
B.pips = 0
for _ in range(12):   # run back and forth through the patch
    A.sx = 1.0 if A.x < px else -1.0
    if abs(A.x - px) > 0.9:
        A.sx = 1.0 if A.x < px else -1.0
    t = run(g, t, 0.4)
    A.sx = -A.sx
    t = run(g, t, 0.4)
    if A.giant >= W.GIANT_MAX - 1e-6:
        break
check("running through fresh snow rolls a giant", A.giant >= W.GIANT_MAX - 1e-6, f"{A.giant:.2f}")
check("the patch is used up a little", g.patches[2] < 1.0)
A.sx = A.sy = 0.0
t = run(g, t, 0.3)
A.fx, A.fy = 1.0, 0.0
B.x, B.y = A.x + W.BODY + W.GIANT_R * 2 + 0.2, A.y
B.frozen_until = B.knock_until = 0
A.sx = 1.0
t = run(g, t, 0.4)
A.sx = 0.0
check("the giant flattens the rival (two pips' worth)", B.knock_until > 0 and A.giant < 0.5 and B.pips == 2, f"pips {B.pips}, giant {A.giant}")
check("and wins the avalanche badge", any(e[2][0] == "flat" for e in g.events))

# the view
v = g.view(ann)["snowball"]
check("the view has every kid, the forts and my seat", len(v["k"]) == 2 and len(v["f"]) == len(W.FORTS) and v["me"] == 0 and v["st"] == "play")

# the clock runs out: the most snow-ins wins
B.points = 0
A.points = max(A.points, 1)
t = run(g, g.end_at - 0.2, 0.5)
check("the game ends when the clock runs out", r.phase == "over")
check("the most snow-ins wins", r.winner == ann.id, f"{r.winner}")
fs = g.final_scores()
check("final scores are snow-ins", fs[ann.id] == A.points and fs[bo.id] == 0)

# 🔴🔵 teams (#126)
r = server.Room("TEAM")
ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy", "Di")]
r.switch_game("snowball")
r.settings["teams"] = True
r.start()
g = r.game
check("teams alternate seats", g.teams and g.team == [0, 1, 0, 1])
check("each team starts on its own end", all((g.kids[i].x < 0) == (g.team[i] == 0) for i in range(4)))
check("you never aim at a teammate", all(g.foes(i, g.target_of(i)) for i in range(4)))
t = g.go_at + 0.01
g.frame(t)
A, B, C = g.kids[0], g.kids[1], g.kids[2]
C.x, C.y = 0.0, 0.0
A.x, A.y = -3.0, 0.0
B.x, B.y = 3.0, 3.0
g.throw(0, t, False, (0.0, 0.0))  # at my own teammate
t = run(g, t, 1.2)
check("a snowball passes over a teammate", C.pips == 0, f"pips {C.pips}")
B.x, B.y = 0.0, 0.0
C.x, C.y = 3.0, 3.0
A.cool_until = 0
g.throw(0, t, False, (0.0, 0.0))
t = run(g, t, 1.2)
check("and hits a rival", B.pips == 1, f"pips {B.pips}")
check("the view carries the teams", g.view(ps[0])["snowball"]["teams"] and g.view(ps[0])["snowball"]["team"] == [0, 1, 0, 1])
A.points, C.points, B.points = 2, 1, 2
check("team points add up", g.team_points(0) == 3 and g.team_points(1) == 2 and g.state(t)["tp"] == [3, 2])
g.end_at = t
run(g, t, 0.1)
check("the team with more snow-ins wins", r.phase == "over" and "Red" in r.log[-1]["text"], r.log[-1]["text"])

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
