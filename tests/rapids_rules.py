"""Paper Boat Rapids rules: the river is the same for the same seed, input is validated, nobody moves in the
countdown, the current carries you, a rock stops and soaks you, white water soaks (half when bracing), a sun
patch dries, a full soak sinks you and you refold at the start of the stretch, a waterfall's gap is found by x
(the edge gaps splash, the lip stops you), a whirlpool catches and spits you out, boats bump, pickups work,
paddles cost a charge and refill, finishing order scores, the grace period ends a race, three races run, and
bots finish a race cheaply (and in level order over a few rivers).

    python3 tests/rapids_rules.py
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import rapids as R  # noqa: E402
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
    """Step the river from t0 for secs, 60 calls a second like the server; returns the new time."""
    t = t0
    with g.room.cond:
        for _ in range(int(secs * 60)):
            t += 1 / 60
            g.frame(t)
            if g.room.phase != "playing":
                break
    return t


def room(n=2, **settings):
    r = server.Room(f"T{random.randrange(10**6)}")
    ps = [r.add_player(f"P{k}") for k in range(n)]
    r.switch_game("rapids")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def use(g, segs, picks=()):
    """Swap in a hand-made river (a list of stretch dicts) for the current race."""
    c = {"segs": segs, "picks": [list(p) for p in picks], "bend": [[0, 0.01, 0]], "len": len(segs) * R.SEG, "seg": R.SEG}
    g.course = c
    g.cv = R.Course(c)
    g.pick_back = [0.0] * len(c["picks"])


def calm(w=10.0, lane=0.0, **extra):
    return {"t": "calm", "w": w, "lane": lane, **extra}


def place(b, s, x):
    b.s, b.x, b.vs, b.vx, b.sx, b.spin = s, x, 0.0, 0.0, 0.0, 0.0


# -- the course
a, b = R.make_course(42, 12), R.make_course(42, 12)
check("the same seed makes the same river", a == b)
check("a different seed makes another", R.make_course(43, 12) != a)
c = R.make_course(7, 18)
types = [s["t"] for s in c["segs"]]
check("it starts and ends calm", types[0] == "calm" and types[-1] == "calm" and len(types) == 18)
check("no stretch type twice in a row", all(x != y for x, y in zip(types, types[1:])), types)
check("the length is the stretches", c["len"] == 18 * R.SEG)
cv = R.Course(c)
ok = True
for k, s in enumerate(c["segs"]):
    for rs, rx, rr in s.get("rocks", ()):
        ok &= abs(rx - s["lane"]) >= rr + 1.4 - 1e-6 and k * R.SEG < rs < (k + 1) * R.SEG
check("rocks leave the lane clear", ok)
check("no pickups when leaves are off", R.make_course(7, 18, leaves=False)["picks"] == [])
check("the river's width runs between stretches", 6.5 < cv.width(R.SEG * 3) < 12.5)

# -- input and the countdown
r, g, (ann, bo) = room(course="short")
A, B = g.boats
for bad in ({"sx": "left"}, {"sx": float("nan")}, {"sx": True}, {"brace": 1}, {"paddle": "yes"}):
    check(f"bad input refused {bad}", refused(g, ann, bad) is not None)
try:
    g.act(ann, {"type": "paddle"})
    check("act is refused", False)
except GameError:
    check("act is refused", True)
check("steering is capped at 1", refused(g, ann, {"sx": 5}) is None and A.sx == 1.0)
use(g, [calm(), calm(), calm()])
s0 = A.s
t = run(g, g.go_at - 1, 0.5)
check("nobody moves in the countdown", A.s == s0 and g.stage == "countdown")
check("no paddling in the countdown", not g.paddle(0, t) and A.paddles == R.PADDLES)
t = run(g, g.go_at - 0.01, 0.1)
check("the countdown ends", g.stage == "race")
place(A, 2.0, 0.0)
place(B, 2.0, 3.0)
A.sx = 0.0
t = run(g, t, 1.0)
check("the current carries you downstream", A.s > 4.5, f"{A.s:.2f}")
A.sx = 1.0
x0 = A.x
t = run(g, t, 0.5)
check("steering moves you across", A.x > x0 + 0.8, f"{A.x - x0:.2f}")
A.sx = -1.0
t = run(g, t, 3.0)
check("the bank stops you", abs(A.x + (g.cv.width(A.s) / 2 - R.BOAT_R)) < 1e-6, f"{A.x:.2f}")
A.sx = 0.0

# -- 💨 slipstream
place(A, 6.0, 0.0)
place(B, 8.0, 0.0)
A.sx = B.sx = 0.0
g.move(R.STEP, t)
check("a boat close behind another is drafting", A.flags & 32 and not B.flags & 32, f"{A.flags} {B.flags}")
place(B, 8.0, 3.0)
g.move(R.STEP, t)
check("beside the wake there is no draft", not A.flags & 32)

# -- paddles
place(A, 10.0, 0.0)
A.vs = 3.0
check("a paddle is taken", g.paddle(0, t) and A.paddles == R.PADDLES - 1 and abs(A.vs - (3.0 + R.PADDLE_KICK)) < 1e-9)
check("a paddle is sent through input", refused(g, ann, {"paddle": True}) is None and A.paddles == R.PADDLES - 2)
g.paddle(0, t)
check("no paddle with no charges", not g.paddle(0, t) and A.paddles == 0)
t = run(g, t, R.PADDLE_REFILL + 0.1)
check("paddles refill", A.paddles == 1, A.paddles)

# -- rocks, white water, sun, sinking
r, g, (ann, bo) = room(course="short")
A, B = g.boats
use(g, [calm(), {"t": "rocks", "w": 10.0, "lane": -3.0, "rocks": [[30.0, 0.0, 0.6]]},
        {"t": "rapids", "w": 8.0, "lane": 0.0, "band": [-2.0, 2.0]}, calm(sun=[3 * R.SEG + 12, 0.0, 2.8]), calm()])
t = run(g, g.go_at + 0.01, 0.1)
place(B, 5.0, 4.0)
place(A, 28.5, 0.0)
A.sog = 0.0
A.vs = 4.0
t = run(g, t, 0.3)
check("a rock stops you", A.vs < 1.5 and A.s < 30.0, f"vs {A.vs:.2f} s {A.s:.2f}")
check("a rock soaks you", R.ROCK_SOAK - 0.5 < A.sog < R.ROCK_SOAK + 2, f"{A.sog:.1f}")
check("the rock hit is an event", any(e[2][0] == "rock" for e in g.events))
sog = A.sog
t = run(g, t, 0.3)
check("one rock soaks you once", A.sog < sog + 1, f"{A.sog:.1f}")
place(A, 2 * R.SEG + 3, 0.0)
A.sog, A.brace = 0.0, False
t = run(g, t, 1.0)
wet = A.sog
check("white water soaks you", wet > R.WHITE_SOAK * 0.8, f"{wet:.1f}")
check("white water is flagged", A.flags & 4 or not g.cv.white(A.s, A.x))
place(A, 2 * R.SEG + 3, 0.0)
A.sog, A.brace = 0.0, True
t = run(g, t, 1.0)
check("bracing halves the soak", A.sog < wet * 0.65, f"{A.sog:.1f} vs {wet:.1f}")
A.brace = False
place(A, 3 * R.SEG + 10.5, 0.0)
A.sog = 50.0
t = run(g, t, 0.5)
check("the sun dries you", A.sog < 50 - R.SUN_DRY * 0.3, f"{A.sog:.1f}")
place(A, 2 * R.SEG + 6, 0.0)
A.sog = 99.9
t = run(g, t, 0.4)
check("a full soak sinks you", A.sunk_until > 0 and A.sinks == 1)
check("the sink is an event", any(e[2][0] == "sink" for e in g.events))
s_sunk = A.s
t = run(g, t, 1.0)
check("a sunk boat stays put", A.s == s_sunk)
t = run(g, t, R.SINK_SECS)
check("you refold at the start of the stretch", A.sunk_until == 0 and abs(A.s - (2 * R.SEG + 1)) < 4.5, f"{A.s:.2f}")
check("a refolded boat is damp", R.REFOLD_SOG - 1 < A.sog < R.REFOLD_SOG + 12, f"{A.sog:.1f}")

# -- the waterfall
r, g, (ann, bo) = room(course="short")
A, B = g.boats
ledge = R.SEG + 14
use(g, [calm(), {"t": "drop", "w": 10.0, "lane": 0.0, "ledge": ledge, "gaps": [[-3.8, 0.75, 1], [0.0, 0.9, 0], [3.8, 0.75, 1]]}, calm()])
t = run(g, g.go_at + 0.01, 0.1)
place(B, 3.0, 4.0)
place(A, ledge - 1.0, 0.0)
A.vs, A.sog = 4.0, 0.0
t = run(g, t, 0.5)
check("the middle gap is safe", A.s > ledge and A.sog < 2, f"s {A.s:.2f} sog {A.sog:.1f}")
place(A, ledge - 1.0, 3.8)
A.vs, A.sog = 4.0, 0.0
t = run(g, t, 0.5)
check("an edge gap drenches you and speeds you", A.s > ledge and A.sog > R.EDGE_SPLASH - 1 and A.vs > 4.5, f"sog {A.sog:.1f} vs {A.vs:.1f}")
place(A, ledge - 1.0, 2.0)
A.vs, A.sog = 4.0, 0.0
t = run(g, t, 0.4)
check("the lip stops you", A.s < ledge and A.sog >= R.LEDGE_SOAK - 0.5, f"s {A.s:.2f} sog {A.sog:.1f}")
t = run(g, t, 2.5)
check("…and you slide to a gap and through", A.s > ledge, f"s {A.s:.2f} x {A.x:.2f}")

# -- the whirlpool
r, g, (ann, bo) = room(course="short")
A, B = g.boats
ws = R.SEG + 12
use(g, [calm(), {"t": "whirl", "w": 11.0, "lane": -3.5, "whirl": [ws, 1.5, 2.6]}, calm(), calm()])
t = run(g, g.go_at + 0.01, 0.1)
place(B, 3.0, -4.0)
place(A, ws - 1.0, 1.5)
A.vs = 3.0
t = run(g, t, 1.0)
check("a whirlpool holds you", abs(A.s - ws) < 2.6 and A.flags & 8, f"s {A.s - ws:.2f}")
check("…and spins you", abs(A.spin) > 0.5, f"{A.spin:.2f}")
t = run(g, t, R.WHIRL_SPIT + 0.5)
check("a whirlpool spits you out in the end", A.s > ws + 2.0, f"s {A.s - ws:.2f}")

# -- bumping boats and pickups
r, g, (ann, bo) = room(course="short", leaves=True)
A, B = g.boats
use(g, [calm(), calm(), calm()], picks=[(30.0, 3.0, "leaf"), (36.0, -3.0, "dry")])
t = run(g, g.go_at + 0.01, 0.1)
place(A, 10.0, 0.0)
place(B, 10.0, 0.3)
A.sog = B.sog = 0.0
t = run(g, t, 0.1)
check("boats push apart", abs(A.x - B.x) >= 2 * R.BOAT_R - 0.05 or abs(A.s - B.s) > 0.3, f"{abs(A.x - B.x):.2f}")
check("a bump splashes both", A.sog >= R.BUMP_SOAK - 0.1 and B.sog >= R.BUMP_SOAK - 0.1)
place(B, 15.0, -4.0)
place(A, 29.6, 3.0)
A.vs = 3.0
t = run(g, t, 0.2)
check("a leaf gives a sail", A.leaf_until > t and g.pick_back[0] > t)
place(A, 35.6, -3.0)
A.sog = 60.0
t = run(g, t, 0.2)
check("a dry fold dries you", A.sog < 60 - R.DRY_FOLD + 2 and g.pick_back[1] > t, f"{A.sog:.1f}")
check("a taken pickup shows as gone", g.state(t)["pk"] == [0, 0])
t = run(g, t, R.PICK_RESPAWN + 0.2)
check("pickups come back", g.state(t)["pk"] == [1, 1])

# -- finishing, points, the grace period, three races
r, g, ps = room(3, course="short", races=3)
A, B, Cc = g.boats
use(g, [calm(), calm()])
t = run(g, g.go_at + 0.01, 0.1)
place(A, 47.9, 0.0)
place(B, 47.85, 2.0)
place(Cc, 5.0, -3.0)
A.vs = B.vs = 4.0
A.sinks = 0
t = run(g, t, 0.2)
check("first over the line finishes first", A.place == 1 and B.place == 2 and A.done_at <= B.done_at)
check("a near tie is a photo finish", any("Photo finish" in (e.get("text", "") if isinstance(e, dict) else str(e)) for e in r.log[-5:]))
check("the race waits for the rest", g.stage == "race")
Cc.s = 10.0
Cc.sunk_until = t + 100   # held back so it can't finish inside the grace period
t = run(g, t, R.GRACE + 0.2)
check("the grace period ends the race", g.stage == "results" and g.race == 1)
check("points 10/7/5", (A.pts, B.pts, Cc.pts) == (10, 7, 5), (A.pts, B.pts, Cc.pts))
check("results are kept", g.results[0][0][0] == 0 and g.results[0][2][1] is None)
t = run(g, t, R.BETWEEN + 0.1)
check("the next race gets a new river", g.race == 2 and g.stage == "countdown" and g.boats[0].pts == 10 and g.boats[0].s == 1.0)
for k in range(2):
    t = run(g, g.go_at + 0.01, 0.1)
    use(g, [calm(), calm()])
    for n, bt in enumerate(g.boats):
        place(bt, 47.0 - n, 0.0 + n * 1.5)
        bt.vs = 4.0
    t = run(g, t, 1.5)
    if k == 0:
        t = run(g, t, R.BETWEEN + 0.1)
check("three races and the game is over", r.phase != "playing" and g.race == 3, f"{r.phase} race {g.race}")
check("the regatta winner has the most points", g.boats[0].pts == 30, [b.pts for b in g.boats])

# -- bots: a full race, cheaply, in level order
random.seed(5)
places = {"easy": 0, "normal": 0, "hard": 0}
cpu = 0.0
for sd in range(4):
    r = server.Room(f"B{sd}")
    ps = [r.add_player(n) for n in ("E", "N", "H")]
    for p, lv in zip(ps, ("easy", "normal", "hard")):
        p.bot = lv
    r.switch_game("rapids")
    r.settings["course"] = "short"
    r.start()
    g = r.game
    c0 = time.process_time()
    t = run(g, g.go_at - 0.01, 200)
    cpu = max(cpu, time.process_time() - c0)
    check(f"bots finish a river ({sd})", r.phase != "playing", r.phase)
    for n, (i, _) in enumerate(g.results[-1]):
        places[("easy", "normal", "hard")[i]] += n + 1
check("a bot race costs little CPU", cpu < 1.5, f"{cpu:.2f} s")
check("hard places ahead of easy", places["hard"] < places["easy"], places)

# a six-boat race
r = server.Room("SIX")
ps = [r.add_player(f"S{k}") for k in range(6)]
for p in ps:
    p.bot = "normal"
r.switch_game("rapids")
r.start()
g = r.game
t = run(g, g.go_at - 0.01, 200)
check("six bots finish a river", r.phase != "playing" and len(g.results[-1]) == 6)
check("the final scores are the points", set(g.final_scores().values()) <= set(R.POINTS))
v = g.view(ps[0])["rapids"]
check("the view carries the course", v["course"]["segs"] and v["me"] == 0 and len(v["b"]) == 6)

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
