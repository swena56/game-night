"""Paper Planes rules: flights land where the model says, each challenge scores right, the better of two planes counts,
the paperclip flies true once, bad throws are refused, and the rounds run from whistle to standings to the end.

    python3 tests/planes_rules.py
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import planes as P  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


class Still(random.Random):
    """No wobble and no gusts."""
    def gauss(self, mu=0.0, sigma=1.0):
        return mu


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("planes")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def goal(g, kind):
    """Force the current round to `kind`, open it, and take the luck out."""
    g.order[g.round_no - 1] = kind
    g.round_no -= 1
    g.new_round()
    g.on_timeout()          # the whistle
    g.rng = Still()


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def throw(g, p, fold="glider", pitch=10, yaw=0, power=0.6, clip=False):
    p.g.busy_until = 0
    g.act(p, {"type": "throw", "fold": fold, "pitch": pitch, "yaw": yaw, "power": power, "clip": clip})
    return p.g.shots[-1]


# -- the flight model
path, land, air = P.fly("glider", 10, 0, 0.6, (0, 0), [])
check("a calm glider lands straight ahead", land[0] > 15 and abs(land[1]) < 1e-6, str(land))
check("paths start at the hand", path[0][1:] == (0.0, P.H0, 0.0))
check("paths end on the ground", path[-1][2] == 0.0)
_, l_tail, _ = P.fly("glider", 10, 0, 0.6, (3, 0), [])
_, l_head, _ = P.fly("glider", 10, 0, 0.6, (-3, 0), [])
check("a tail wind carries further than a head wind", l_tail[0] > land[0] > l_head[0])
_, l_vent, a_vent = P.fly("glider", 10, 0, 0.6, (0, 0), [(12, 0, 3.0)])
check("warm air over a grill lifts a plane further", l_vent[0] > land[0] + 3 and a_vent > air)
_, l_dart, _ = P.fly("dart", 10, 0, 0.6, (0, 3), [])
_, l_glid, _ = P.fly("glider", 10, 0, 0.6, (0, 3), [])
check("a cross wind pushes a glider more than a dart", abs(l_glid[1]) > 2 * abs(l_dart[1]))
_, l_st, _ = P.fly("stunt", 10, 0, 0.6, (0, 0), [])
check("a stunt plane curls right", l_st[1] > 2)
p_loop, _, _ = P.fly("stunt", 20, 0, 1.0, (0, 0), [])
xs = [q[1] for q in p_loop]
check("a hard, high stunt throw loops", any(b < a - 0.05 for a, b in zip(xs, xs[1:])))
check("thin keeps ≤ 60 points and the landing", len(P.thin(p_loop)) <= 60 and P.thin(p_loop)[-1][2] == 0.0)

# -- scoring
check("blanket bullseye pays 50", P.score("blanket", {"blanket": (10, 0)}, [], (10.5, 0.2), 1)[0] == 50)
check("blanket edge pays 10", P.score("blanket", {"blanket": (10, 0)}, [], (14.5, 0), 1)[0] == 10)
check("off the blanket pays 0", P.score("blanket", {"blanket": (10, 0)}, [], (20, 0), 1)[0] == 0)
line = [(0, 0, 2, 0), (1, 20, 2, 0)]
check("straight through the hoop pays 60", P.score("hoop", {"hoop": (10, 2, 0)}, line, (20, 0), 1)[0] == 60)
check("a near miss of the hoop pays a little", 0 < P.score("hoop", {"hoop": (10, 2, 2.5)}, line, (20, 0), 1)[0] < 60)
rings = [(5, 2, 0), (10, 2, 0), (15, 2, 3)]
pts, info = P.score("rings", {"rings": rings}, line, (20, 0), 1)
check("two of three rings pays 40", pts == 40 and info["rings"] == [0, 1], str((pts, info)))
check("all three rings pays the bonus", P.score("rings", {"rings": rings[:2] + [(15, 2, 0)]}, line, (20, 0), 1)[0] == 80)
check("distance scores metres", P.score("far", {}, [], (31.6, 4), 1)[0] == 32)
check("airtime scores tenths", P.score("air", {}, [], (5, 0), 6.27)[0] == 63)

# -- a round
r, g, (a, b) = game()
check("starts on the countdown", g.stage == "count" and r.deadline)
check("no throws before the whistle", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 0, "power": 0.5}) is not None)
goal(g, "far")
check("bad fold refused", refused(g, a, {"type": "throw", "fold": "rock", "pitch": 5, "yaw": 0, "power": 0.5}) is not None)
check("too much power refused", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 0, "power": 2}) is not None)
check("yaw out of range refused", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 80, "power": 0.5}) is not None)
check("NaN refused", refused(g, a, {"type": "throw", "fold": "dart", "pitch": float("nan"), "yaw": 0, "power": 0.5}) is not None)
check("bool power refused", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 0, "power": True}) is not None)
g.wind = (0.0, 0.0)
g.vents = []
s1 = throw(g, a, "glider", 10, 0, 0.3)
check("the server's flight matches the model", abs(s1["land"][0] - P.fly("glider", 10, 0, 0.3, (0, 0), [])[1][0]) < 0.01)
check("can't throw again mid-flight", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 0, "power": 0.5}) is not None)
first = a.g.points
s2 = throw(g, a, "glider", 10, 0, 0.8)
check("the better plane counts", a.g.points == max(s1["pts"], s2["pts"]) and a.g.points >= first, f"{a.g.points} {s1['pts']} {s2['pts']}")
check("two planes a round", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 0, "power": 0.5}) is not None)
throw(g, b, "dart", 0, 0, 0.1)
s_worse = b.g.points
throw(g, b, "dart", 0, 0, 0.05)
check("a worse second plane doesn't lower the round", b.g.points == s_worse)
check("both thrown → settle", g.stage == "settle")
g.on_timeout()
check("standings between rounds", g.stage == "between" and g.view(a)["planes"]["standings"])
g.on_timeout()
check("next round", g.round_no == 2 and g.stage == "count")

# -- the paperclip
r, g, (a, b) = game()
goal(g, "far")
g.rng = random.Random(5)      # real wobble this time
clean = P.fly("dart", 5, 0, 0.7, g.wind, g.vents)[1]
s = throw(g, a, "dart", 5, 0, 0.7, clip=True)
check("a clipped throw flies true", abs(s["land"][0] - clean[0]) < 0.01 and abs(s["land"][1] - clean[1]) < 0.01)
cl, _, multiplier, wind_multiplier, _, _, lift_cap = P.FOLDS["dart"]
speed = (P.SPEED[0] + (P.SPEED[1] - P.SPEED[0]) * 0.7) * multiplier
check("flight report uses the actual launch and landing values",
      s["telemetry"] == {"speed": round(speed, 1), "lift": round(min(cl * speed ** 2, lift_cap * P.G), 1),
                         "wind": [round(v * wind_multiplier, 1) for v in g.wind], "end": "ground"}
      and s["path"][-1][2] == 0)
check("the clip is used up", not a.g.clip)
check("only once a game", refused(g, a, {"type": "throw", "fold": "dart", "pitch": 5, "yaw": 0, "power": 0.5, "clip": True}) is not None)

# -- a whole game ends with a winner, and the view serialises
import json  # noqa: E402
r, g, ps = game(3, rounds=3)
for _ in range(3):
    g.on_timeout()          # whistle
    for p in ps:
        for _ in range(2):
            throw(g, p, "glider", 8, 0, random.random())
    json.dumps(g.view(ps[0]))
    g.on_timeout()          # settle → between
    g.on_timeout()          # between → next / end
check("three rounds end the game", r.phase == "over", r.phase)

# -- bots throw something sensible
r, g, (a, b) = game()
goal(g, "blanket")
b.bot = "hard"
t = time.time()
fold, pitch, yaw, power, clip = g.plan(b)
dt = time.time() - t
check("a hard bot thinks in well under a second", dt < 0.6, f"{dt:.2f}s")
check("bot throws are legal", fold in P.FOLDS and P.PITCH[0] <= pitch <= P.PITCH[1] and abs(yaw) <= P.YAW and 0 <= power <= 1)

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
