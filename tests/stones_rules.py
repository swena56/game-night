"""Ice Stones rules: draw weight stops in the house, curl bends the right way (more as it slows), the glide
slows evenly, sweeping carries further (live, from the thrower's input), collisions keep momentum, short
stones come off, takeouts knock stones out, the end is counted (and a hot stone doubles; a dead heat is
blank), bad throws are refused, turns rotate, old saves load and the game ends after the last end.

    python3 tests/stones_rules.py
"""
import math
import os
import pickle
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import stones as I  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("stones")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def run(g, sweep=None, t=None):
    """Play a live slide out on a fake clock (frame at 60 fps), the thrower sweeping at `sweep` if given."""
    t = time.time() if t is None else t
    by = g.pl(g.live["by"]) if g.live else None
    while g.live:
        t += 1 / 60
        if sweep is not None and by:
            g.on_input(by, {"sweep": sweep})
            g.live["until"] = t + 1
        with g.room.cond:   # push_fast notifies the room's streams
            g.frame(t)
    g.ready_at = 0
    return t


def slide(stones, aim, w, curl=1, sweep=0):
    keep, tracks, hit = I.simulate(stones, {"o": 0, "id": 99}, aim, w, curl, sweep)
    return next((s for s in keep if s["id"] == 99), None), keep, tracks, hit


# physics
DRAW = I.weight_for(I.TEE)
s, *_ = slide([], -0.9, DRAW)
check("draw weight (aimed for the curl) stops in the house", s is not None and I.dist(s) <= 0.61, s and f"{s['x']:.2f},{s['y']:.2f}")
check("the weight slider gives the house a fifth of its travel",
      0.17 < I.weight_for(I.TEE + I.HOUSE) - I.weight_for(I.TEE - I.HOUSE) < 0.25)
r_, *_ = slide([], 0.0, DRAW, curl=1)
l_, *_ = slide([], 0.0, DRAW, curl=-1)
check("curl bends the way it's set, about a metre on a draw", 0.6 < r_["x"] < 1.4 and -1.4 < l_["x"] < -0.6, f"{r_['x']:.2f} / {l_['x']:.2f}")
sl = I.Slide([], {"o": 0, "id": 1}, 0.0, DRAW, 1)
xs, sp, vel = [], [], []
while sl.step(0):
    xs.append(sl.st[-1]["x"])
    sp.append(sl.speed())
    if sl.speed() > 1e-6:
        vel.append((sl.vx[-1], sl.vy[-1]))
drops = [a - b for a, b in zip(sp, sp[1:])]
half = len(xs) // 2
check("curl grows as the stone slows", xs[-1] - xs[half] > 2 * (xs[half] - xs[0]), f"{xs[half]:.2f} then {xs[-1]:.2f}")
check("the glide slows evenly (no jerks, no sudden stop)", all(abs(d - I.FRICTION * I.DT) < 1e-6 for d in drops[:-1]) and sp[-2] < 0.01,
      f"last speeds {sp[-3]:.3f} {sp[-2]:.3f}")
turn = max(abs(math.atan2(vx_, vy_)) for vx_, vy_ in vel)
check("the curl never hooks it round (heading stays within 45° of down the sheet)", turn < math.pi / 4, f"{math.degrees(turn):.0f}°")
a, *_ = slide([], 0.0, I.weight_for(25))
b, *_ = slide([], 0.0, I.weight_for(25), sweep=2)
check("sweeping carries further and curls less", b["y"] > a["y"] + 1 and abs(b["x"]) < abs(a["x"]), f"{a['y']:.1f}→{b['y']:.1f}")
s, _, tracks, _ = slide([], 0.0, 0.0)
check("a stone short of the hog line comes off", s is None and tracks[0].get("short"))
s, *_ = slide([], 0.0, 1.0)
check("a peel with nothing to hit slides through", s is None)
target = [{"o": 1, "id": 5, "x": 0.0, "y": I.TEE}]
best = None
for aim in [x / 20 for x in range(-20, 1)]:
    _, keep, _, hit = slide(target, aim, 0.85)
    if hit and not any(k["id"] == 5 for k in keep):
        best = aim
        break
check("a takeout knocks a stone out of play", best is not None, f"aim {best}")

# collisions share momentum: a stone driven straight into a still one
sl = I.Slide([{"o": 1, "id": 5, "x": 0.0, "y": 10.0}], {"o": 0, "id": 6}, 0.0, 0.5, 1)
p0 = None
while sl.step(0):
    if sl.hit and p0 is None:
        break
    p0 = (sl.vx[0] + sl.vx[1], sl.vy[0] + sl.vy[1])
p1 = (sl.vx[0] + sl.vx[1], sl.vy[0] + sl.vy[1])
check("a collision keeps the momentum", sl.hit and abs(p1[1] - p0[1]) < I.FRICTION * I.DT * 2 + 1e-6 and sl.vy[0] > sl.vy[1],
      f"{p0[1]:.3f} → {p1[1]:.3f}")

# counting
stones = [{"o": 0, "id": 1, "x": 0.1, "y": I.TEE}, {"o": 0, "id": 2, "x": 0.5, "y": I.TEE}, {"o": 1, "id": 3, "x": 0.8, "y": I.TEE},
          {"o": 0, "id": 4, "x": 1.2, "y": I.TEE}]
side, pts, counted = I.count_end(stones)
check("only stones closer than the best rival count", side == 0 and pts == 2 and {s["id"] for s in counted} == {1, 2}, f"{side} {pts}")
stones[1]["hot"] = True
check("a counting hot stone scores double", I.count_end(stones)[1] == 3)
check("an empty house is a blank end", I.count_end([{"o": 0, "id": 1, "x": 0, "y": 15}])[0] is None)
tie = [{"o": 0, "id": 1, "x": 0.3, "y": I.TEE}, {"o": 1, "id": 2, "x": -0.3, "y": I.TEE}]
check("a dead heat for shot stone is a blank end", I.count_end(tie)[0] is None)
m = I.measure(stones)
check("the measure rings the best rival stone", m["side"] == 0 and m["ring"] == 0.8 and set(m["ids"]) == {1, 2}, str(m))
far = [{"o": 0, "id": 1, "x": 0.1, "y": I.TEE}, {"o": 1, "id": 3, "x": 0.0, "y": I.TEE + I.HOUSE + 0.5}]
check("a rival stone outside the house doesn't stop the count", I.count_end(far)[1] == 1 and I.measure(far)["ring"] is None)

# the game
r, g, (ann, bo) = game(2, ends=2)
check("2 players throw 4 stones each", len(g.order) == 8 and g.order.count(0) == 4)
me = next(p for p in (ann, bo) if p.id == r.turn)
other = bo if me is ann else ann
ok = {"aim": 0.0, "weight": 0.38, "curl": 1, "sweep": 0}
check("not your turn is refused", refused(g, other, {"type": "throw", **ok}) is not None)
for bad in ({"aim": 9}, {"weight": 1.5}, {"curl": 0}, {"curl": True}, {"sweep": 3}, {"aim": "x"}, {"weight": float("nan")}):
    check(f"bad throw refused {bad}", refused(g, me, {"type": "throw", **ok, **bad}) is not None)
check("a good throw is taken", refused(g, me, {"type": "throw", **ok}) is None and g.thrown == 1)
check("it slides live", g.live is not None and g.view(other)["stones"]["shot"]["live"] and g.view(other)["stones"]["sliding"] is not None)
check("you can't throw while stones are sliding", refused(g, other, {"type": "throw", **ok}) is not None)
pushed = []
orig = r.push_fast
r.push_fast = lambda d: (pushed.append(d), orig(d))
run(g)
r.push_fast = orig
check("the slide streams its tracks", pushed and all("ic" in d for d in pushed) and len(pushed) > 30, f"{len(pushed)} packets")
check("the turn passes once it stops", r.turn == other.id and g.live is None)
check("the view carries the shot's tracks", g.view(other)["stones"]["shot"]["tracks"] and not g.view(other)["stones"]["shot"].get("live"))
check("a room saves and loads", pickle.loads(pickle.dumps(r)).game.live is None)
st = g.__dict__.copy(); st.pop("live")
g2 = I.Stones.__new__(I.Stones); g2.__setstate__(st)
check("a save from before live sweeping gets live = None", g2.live is None)
# play the rest of both ends out
for _ in range(40):
    if r.phase != "playing":
        break
    if g.between:
        g.after_end()
        continue
    g.ready_at = 0
    p = r.players[r.turn]
    g.act(p, {"type": "throw", **ok, "aim": 0.0 if g.thrown % 2 else 0.6})
    run(g)
check("the game ends after the last end (and any extra ends)", r.phase == "over" and 2 <= len(g.ends_log) <= 2 + g.extra, f"{r.phase} {g.ends_log}")
check("points add up", sum(g.points) == sum(p for _, p in g.ends_log))

# a tie after the last end plays an extra end (twice at most)
r, g, ps = game(3, ends=1)
g.points = [2, 2, 0]
g.between = True
g.after_end()
check("a tie on top plays an extra end for the tied players", r.phase == "playing" and g.extra == 1 and set(g.order) == {0, 1} and len(g.order) == 8,
      f"{g.extra} {g.order}")
check("the view says it's an extra end", g.view(ps[0])["stones"]["extra"] == 1)
for _ in range(2):
    g.between = True
    g.after_end()
check("still tied after two extra ends: a draw", r.phase == "over" and g.extra == 2)

# live sweeping: the same throw goes further and straighter when the thrower sweeps it
def one(sweep):
    r, g, ps = game(2, ends=1)
    p = r.players[r.turn]
    g.act(p, {"type": "throw", "aim": 0.0, "weight": round(I.weight_for(25), 3), "curl": 1})
    run(g, sweep)
    return g.stones[0] if g.stones else None, g.shot
a, sha = one(None)
b, shb = one(2)
check("live sweeping carries further and straighter", a and b and b["y"] > a["y"] + 1 and b["x"] < a["x"] and shb["sweep"] == 2 and shb["swept"] > 3,
      f"{a and round(a['y'], 2)} → {b and round(b['y'], 2)}, swept {shb['swept']} s")
r, g, ps = game(2, ends=1)
p = r.players[r.turn]
other = next(q for q in ps if q is not p)
g.act(p, {"type": "throw", "aim": 0.0, "weight": round(I.weight_for(25), 3), "curl": 1})
run(g, None)
c = g.stones[0]
check("only the thrower's sweeping counts (and it lapses when they let go)", abs(c["y"] - a["y"]) < 1e-6)

# a bot's live slide ends exactly where its plan said
r, g, ps = game(2, ends=1)
p = r.players[r.turn]
p.bot = "normal"
plan = g.plan(g.seat(p), "normal")
keep, _, _ = g.sim(g.stones, {"o": g.seat(p), "hot": g.thrown == g.hot, "id": g.sid + 1}, *plan, False, *g.ice)
g.throw(g.seat(p), *plan)
run(g)
check("a bot's live slide matches its plan", [(round(s["x"], 6), round(s["y"], 6)) for s in keep] == [(round(s["x"], 6), round(s["y"], 6)) for s in g.stones])

# timeouts lose the stone; a bot plays from any state within its time budget
r, g, ps = game(3, ends=1)
n0 = g.thrown
g.on_timeout()
check("a timeout loses that stone", g.thrown == n0 + 1)
p = r.players[r.turn]
p.bot = "hard"
t0 = time.time()
g.ready_at = 0
g.bot_turn(p)
check("a hard bot throws within its budget", time.time() - t0 < 3.0 and g.thrown == n0 + 2, f"{time.time() - t0:.2f}s")
run(g)

# frame() alone plays a bots' game out (as simulate.py does)
r, g, ps = game(2, ends=1)
for q in ps:
    q.bot = "easy"
t = time.time()
for _ in range(60 * 200):
    if r.phase != "playing":
        break
    t += 1 / 60
    with r.cond:
        g.frame(t)
check("frame() alone plays a bots' game to the end", r.phase == "over", r.phase)

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
