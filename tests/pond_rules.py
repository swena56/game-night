"""Frozen Pond rules: holes drill and take the line, bites come near schools and only then, a bite must be hooked in
time, the fight lands a fish when you reel through its rests and snaps when you reel into its lunges, points add up,
bad actions are refused, the clock jumps for simulate.py, and the pond closes at the horn.

    python3 tests/pond_rules.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import pond as P  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("pond")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def jump(g, t):
    """Move the game's clock to t."""
    g.skew += t - g.T()


def fight(kind, segs, toggles):
    return {"kind": kind, "segs": segs, "toggles": toggles}


# -- the fight model
segs = [[2.0, False], [1.0, True]] * 10
p_, tau, out, at = P.fight_state(fight("perch", segs, [0]), 5)
check("reeling a resting perch lands it", out == "land" and at < 2.0, f"{out} {at}")
p_, tau, out, at = P.fight_state(fight("pike", [[0.5, False], [3.0, True]] * 10, [0]), 6)
check("reeling into a long pike lunge snaps the line", out == "snap", f"{out} {tau}")
p_, tau, out, _ = P.fight_state(fight("pike", segs, []), 6)
check("doing nothing lands nothing", out is None and p_ == 0)
# reel in rests, let go in lunges (toggles at 2 s, 3 s, 5 s, 6 s … in steps)
st = round(1 / P.FIGHT_DT)
tg = [0]
for k in range(10):
    tg += [(2 + 3 * k) * st, (3 + 3 * k) * st]
p_, tau, out, at = P.fight_state(fight("pike", segs, tg), 30)
check("reeling in the rests and easing off in the lunges lands a pike", out == "land", f"{out} {at:.1f}")
check("lunging() finds the phase", P.lunging({"segs": segs}, 2.5) == (True, 3.0) and P.lunging({"segs": segs}, 0.5) == (False, 2.0))
check("a fight runs out", P.fight_state(fight("perch", segs, []), 40)[2] == "escape")

# -- bites follow the schools
s = {"kind": "perch", "rate": 0.5, "cx": 0, "cy": 0, "a1": 0, "a2": 0, "b1": 0, "b2": 0, "w1": 0, "w2": 0, "p1": 0, "p2": 0}
near, _ = P.bite_rate([s], 0.5, 0, 0)
far, _ = P.bite_rate([s], 9, 0, 0)
check("bites come near a school", near > 0.4 and far < 0.01, f"{near:.2f} {far:.4f}")
s2 = dict(s, t0=50, t1=60)
check("a school that isn't here yet gives no bites", P.bite_rate([s2], 0, 0, 10)[0] == 0 and P.bite_rate([s2], 0, 0, 55)[0] > 0)

# -- a game
r, g, (a, b) = game()
check("starts on a countdown", g.T() < 0)
check("no drilling before the horn", refused(g, a, {"type": "drill", "x": 0, "y": 0}) is not None)
jump(g, 1)
check("drill off the pond refused", refused(g, a, {"type": "drill", "x": 30, "y": 0}) is not None)
check("NaN refused", refused(g, a, {"type": "drill", "x": float("nan"), "y": 0}) is not None)
g.act(a, {"type": "drill", "x": 0, "y": 0})
check("a hole is drilled", len(g.holes) == 1 and g.holes[0]["o"] == 0)
check("the line will go in when it's through", a.g.line["st"] == "retie")
check("a second hole while drilling refused", refused(g, a, {"type": "drill", "x": 4, "y": 0}) is not None)
check("too close to a hole refused", refused(g, b, {"type": "drill", "x": 0.5, "y": 0}) is not None)
check("someone else's hole refused", refused(g, b, {"type": "drop", "hole": 0}) is not None)
check("hook with nothing biting refused", refused(g, a, {"type": "hook"}) is not None)
# park every school right on the hole so a bite comes
for sc in g.schools:
    sc.update(cx=0, cy=0, a1=0, a2=0, b1=0, b2=0, t0=0, t1=1e9)
    sc["kind"] = "perch"
jump(g, 1 + P.DRILL + 0.01)
g.on_timeout()
check("the line goes in after drilling", a.g.line["st"] == "wait", a.g.line["st"])
view = g.view(b)["pond"]
check("nobody sees when the bite comes", "bite_at" not in view["anglers"][a.id]["line"])
for _ in range(50):
    if a.g.line["st"] == "bite":
        break
    g.on_timeout()
check("a fish bites", a.g.line["st"] == "bite")
g.act(a, {"type": "hook"})
check("hooked: the fight is on", a.g.line["st"] == "fight")
ln = a.g.line
ln["segs"] = [[3.0, False], [1.0, True]] * 10
g.act(a, {"type": "reel", "on": True})
for _ in range(20):
    if a.g.line["st"] != "fight":
        break
    g.on_timeout()
check("reeling a resting perch lands it", a.g.points == 10 and len(a.g.catches) == 1, f"{a.g.points} {a.g.line['st']}")
landed = a.g.history[-1]
check("landed fish log has species, weight, location and result",
      landed["kind"] == "perch" and 0.3 <= landed["weight"] <= 1.5
      and landed["result"] == "landed" and "x" in landed and "y" in landed, landed)
check("landed fish log is public in the anglers view",
      g.view(b)["pond"]["anglers"][a.id]["history"][-1] == landed)
check("then the line goes back in", a.g.line["st"] in ("retie", "wait"))
# a missed bite
for _ in range(50):
    if a.g.line["st"] == "bite":
        break
    g.on_timeout()
g.on_timeout()
check("an unhooked bite gets away", a.g.line["st"] in ("retie", "wait") and len(a.g.catches) == 1)
check("missed strike is recorded as an escape", a.g.history[-1]["result"] == "missed strike")
# a snap
for _ in range(50):
    if a.g.line["st"] == "bite":
        break
    g.on_timeout()
g.act(a, {"type": "hook"})
a.g.line["kind"] = "pike"
a.g.line["segs"] = [[0.2, False], [3.0, True]] * 10
g.act(a, {"type": "reel", "on": True})
for _ in range(20):
    if a.g.line["st"] != "fight":
        break
    g.on_timeout()
check("reeling into a lunge snaps the line", a.g.last["what"] == "snap" and a.g.points == 10, str(a.g.last))
check("snapped fish is recorded without changing score", a.g.history[-1]["result"] == "line snapped" and a.g.points == 10)
a.g.line = {"st": "fight", "h": a.g.line["h"], "kind": "trout", "weight": 2.2}
g.end_fight(a, "escape", g.T())
check("escaped fish records its fight result and weight",
      a.g.history[-1]["result"] == "escaped" and a.g.history[-1]["weight"] == 2.2)
json.dumps(g.view(a))
# the horn
jump(g, g.t_end + 0.1)
g.on_timeout()
check("the pond closes at the horn", r.phase == "over")

# -- bots fill a whole pond on their own (the clock jumps)
r, g, ps = game(3, minutes=2)
for p in ps:
    p.bot = "normal"
    p.g.act_at = 0.5
for _ in range(20000):
    if r.phase != "playing":
        break
    if g.bot_ready():
        g.bot_tick()
    else:
        g.on_timeout()
check("a bot-only pond finishes", r.phase == "over")
check("bots catch fish", sum(len(p.g.catches) for p in ps) > 5, str([len(p.g.catches) for p in ps]))

# -- #180: the page gets the line's reach (for the ring and the sonar pings) and the tip card says the loop
r, g, ps = game(2)
v = g.view(ps[0])["pond"]
check("the view carries the line's reach", v["geo"].get("sigma") == P.BITE_SIGMA)
check("the tip card says the loop", "drill a hole" in P.Pond.blurb.lower() and "strikes" in P.Pond.blurb and "drill" in P.Pond.howto[0].lower())

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
