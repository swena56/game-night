"""Wind Archery rules: no wind lands on the aim, drift follows the wind and grows with distance, rings score,
the apple pays once, a steady breath works once and skips the gust, bad shots are refused, turns rotate, the
game ends after the last end, and ties go to the most dead-centre shots.

    python3 tests/archery_rules.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import archery as A  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("archery")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def still(g, wind=(0.0, 0.0)):
    """Make the end predictable: a known wind, no bias, no gusts, no apple in the way."""
    g.wind, g.bias, g.apple = wind, 0.0, None
    g.gust = lambda: 0.0
    g.ready_at = 0


# flight
check("no wind lands on the aim", A.land(0.2, -0.1, (0, 0), 70) == (0.2, -0.1))
x30, _ = A.land(0, 0, (5, 0), 30)
x70, y70 = A.land(0, 0, (5, 0), 70)
check("a wind from the left carries arrows right", x30 > 0 and y70 == 0, f"{x30:.3f}")
check("drift grows with distance", x70 > 4 * x30, f"{x30:.3f} → {x70:.3f}")
check("an updraft lifts the arrow", A.land(0, 0, (0, 2), 50)[1] > 0)
check("a strong wind at 70 m stays on the face when aimed off", abs(A.land(-x70, 0, (5, 0), 70)[0]) < 1e-9 and x70 < A.AIM)
bx, _ = A.land(0, 0, (5, 0), 70, 1.2)
check("a stronger real wind drifts further", bx > x70)

# scoring
check("the middle is an X worth 10", A.score_at(0.01, 0.01) == (10, True))
check("the 10 ring outside the X", A.score_at(A.RING * 0.9, 0) == (10, False))
check("ring boundaries", A.score_at(A.RING * 1.01, 0)[0] == 9 and A.score_at(0, -A.RING * 9.5)[0] == 1)
check("off the face scores nothing", A.score_at(A.FACE + 0.001, 0) == (0, False))

# the game
r, g, (ann, bo) = game(2, ends=2)
check("2 players shoot 3 arrows each an end", len(g.order) == 6 and g.order.count(0) == 3)
check("the first end is at 30 m", g.dist == 30)
check("the view hides the bias", "bias" not in g.view(ann)["archery"])
still(g)
me = next(p for p in (ann, bo) if p.id == r.turn)
other = bo if me is ann else ann
mi, oi = g.seat(me), g.seat(other)
ok = {"ax": 0.0, "ay": 0.0}
check("not your turn is refused", refused(g, other, {"type": "shoot", **ok}) is not None)
for bad in ({"ax": 9}, {"ay": -1.3}, {"ax": "x"}, {"ay": float("nan")}, {"ax": True}, {"breath": 1}):
    check(f"bad shot refused {bad}", refused(g, me, {"type": "shoot", **ok, **bad}) is not None)
check("a good shot is taken", refused(g, me, {"type": "shoot", **ok}) is None and g.shots_done == 1)
check("dead centre scores 10 and an X", g.points[mi] == 10 and g.xs[mi] == 1)
check("the turn passes", r.turn == other.id)
check("you can't shoot while the arrow is in the air", refused(g, other, {"type": "shoot", **ok}) is not None)
g.ready_at = 0
check("the view carries the shot", g.view(other)["archery"]["shot"]["ring"] == 10)
check("landing on an arrow splits it", refused(g, other, {"type": "shoot", "ax": 0.005, "ay": 0.0}) is None and g.shot["split"])

# the apple pays once
still(g)
g.apple = {"x": 0.3, "y": 0.0}
before = g.points[mi]
g.act(me, {"type": "shoot", "ax": 0.31, "ay": 0.0})
ring = A.score_at(0.31, 0)[0]
check("the apple adds 5", g.points[mi] - before == ring + A.APPLE_PTS and g.apple is None, f"{g.points[mi] - before}")
g.ready_at = 0
before = g.points[oi]
g.act(other, {"type": "shoot", "ax": 0.31, "ay": 0.0})
check("the apple is gone for the next arrow", g.points[oi] - before == ring)

# a steady breath: no gust, once a game
g.ready_at = 0
g.wind, g.bias = (4.0, 0.0), 0.0
g.gust = lambda: 0.3
dx, _ = A.drift(g.wind, g.dist)
g.act(me, {"type": "shoot", "ax": -dx, "ay": 0.0, "breath": True})
check("a steady breath skips the gust", abs(g.shot["x"]) < 0.002 and not g.breath[mi], f"{g.shot['x']}")
g.ready_at = 0
g.act(other, {"type": "shoot", "ax": -dx, "ay": 0.0})
check("without it the gust pushes the arrow", g.shot["x"] > 0.005, f"{g.shot['x']}")
check("the end is over after six arrows", g.between and r.turn is None and len(g.ends_log) == 1)
g.after_end()
check("the second end is at 50 m", g.end_no == 2 and g.dist == 50 and not g.arrows)
still(g)
me2 = r.players[r.turn]
if me2 is me:
    check("a second steady breath is refused", refused(g, me, {"type": "shoot", **ok, "breath": True}) is not None)
else:
    g.act(me2, {"type": "shoot", **ok})
    g.ready_at = 0
    check("a second steady breath is refused", refused(g, me, {"type": "shoot", **ok, "breath": True}) is not None)
for _ in range(20):
    if r.phase != "playing" or g.between:
        break
    g.ready_at = 0
    g.act(r.players[r.turn], {"type": "shoot", "ax": 0.2, "ay": 0.0})
g.after_end()
check("the game ends after the last end", r.phase == "over" and len(g.ends_log) == 2, f"{r.phase} {g.ends_log}")
check("points add up", sum(g.points) == sum(sum(row) for row in g.ends_log), f"{g.points} {g.ends_log}")

# ties go to the Xs
r, g, (ann, bo) = game(2, ends=2)
g.end_no = 2
g.points, g.xs = [50, 50], [1, 2]
g.after_end()
check("a tie on points goes to the most Xs", r.phase == "over" and r.winner == bo.id, f"{getattr(r, 'winner', None)}")
r, g, (ann, bo) = game(2, ends=2)
g.end_no = 2
g.points, g.xs = [50, 50], [2, 2]
g.after_end()
check("level on both is a tie", r.phase == "over" and not r.winner)

# timeouts shoot at the middle; bots play from any state, and the better ones score more
r, g, ps = game(3, ends=2)
n0 = g.shots_done
g.on_timeout()
check("a timeout shoots at the middle", g.shots_done == n0 + 1 and g.shot["ax"] == 0)
p = r.players[r.turn]
p.bot = "hard"
t0 = time.time()
g.bot_turn(p)
check("a bot shoots at once", time.time() - t0 < 0.5 and g.shots_done == n0 + 2)
tot = {"easy": 0, "normal": 0, "hard": 0}
for k in range(60):
    r, g, ps = game(3, ends=3, wind=("breezy", "gusty", "calm")[k % 3])
    for p, lv in zip(ps, ("easy", "normal", "hard")):
        p.bot = lv
    for _ in range(200):
        if r.phase != "playing":
            break
        if g.between:
            g.after_end()
        else:
            g.bot_turn(r.players[r.turn])
    for p, lv in zip(ps, tot):
        tot[lv] += g.points[g.seat(p)]
avg = {k: round(v / 60) for k, v in tot.items()}
check("hard bots outscore normal, normal outscore easy", avg["hard"] > avg["normal"] > avg["easy"], str(avg))

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
