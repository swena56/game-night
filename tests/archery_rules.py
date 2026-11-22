"""Wind Archery rules: no wind lands on the aim, drift follows the wind and grows with distance, rings score,
the apple pays once, a steady breath works once and skips the gust, bad shots are refused, turns rotate, the
game ends after the last end, and ties go to a shoot-off. #177: the course (apple / balloons / swinging face),
🔥 fire arrows, ✨ golden streaks, slow motion on big shots, old saves loading.

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
    r.settings.update(course="archery", **settings)
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
    g.wind, g.bias, g.prizes, g.swing = wind, 0.0, [], None
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
for bad in ({"ax": 9}, {"ay": -1.6}, {"fire": 1}, {"ph": "x"}, {"ax": "x"}, {"ay": float("nan")}, {"ax": True}, {"breath": 1}, {"held": "x"}, {"held": float("inf")}, {"held": True}):
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
g.prizes = [{"k": "apple", "x": 0.3, "y": 0.0, "r": A.APPLE_R, "pts": A.APPLE_PTS, "id": 0}]
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

# #177 a tie on points goes to a one-arrow shoot-off at 70 m, closest to the middle
def drive_shootoff(aims):
    r, g, (ann, bo) = game(2, ends=2)
    g.end_no = 2
    g.points, g.xs = [50, 50], [1, 2]
    g.after_end()
    ok1 = r.phase == "playing" and g.kind == "shootoff" and g.dist == 70 and len(g.order) == 2
    for _ in range(2):
        still(g)
        p = r.players[r.turn]
        g.act(p, {"type": "shoot", "ax": aims[g.seat(p)], "ay": 0.0})
    pts = list(g.points)
    ok2 = g.between and g.shot["pts"] == 0 and pts == [50, 50]
    g.after_end()
    return r, g, (ann, bo), ok1, ok2
r, g, (ann, bo), ok1, ok2 = drive_shootoff([0.1, 0.02])
check("a tie on points starts a shoot-off at 70 m", ok1)
check("shoot-off arrows score nothing", ok2)
check("closest to the middle wins the shoot-off", r.phase == "over" and r.winner == bo.id, f"{getattr(r, 'winner', None)}")
r, g, _, _, _ = drive_shootoff([0.05, -0.05])
check("level in the shoot-off too is a tie", r.phase == "over" and not r.winner)
r, g, (ann, bo) = game(2, ends=2)
g.end_no = 2
g.points = [51, 50]
g.after_end()
check("a clear winner needs no shoot-off", r.phase == "over" and r.winner == ann.id)

# #177 the course: apple, balloons, then a swinging face
r, g, (ann, bo) = game(2, ends=3)
check("end 1 is the apple end", g.kind == "apple" and len(g.prizes) == 1 and g.apple)
for _ in range(10):
    if g.between:
        break
    g.ready_at = 0
    g.act(r.players[r.turn], {"type": "shoot", "ax": 0.9, "ay": 0.9})
g.after_end()
check("end 2 is the balloon end", g.kind == "balloons" and len(g.prizes) == 4 and sum(q["k"] == "gold" for q in g.prizes) == 1)
still(g)
g.prizes = [{"k": "balloon", "x": 0.4, "y": 0.0, "r": A.BALLOON_R, "pts": 3, "id": 1}, {"k": "gold", "x": -0.64, "y": 0.0, "r": 0.056, "pts": 6, "id": 0}]
me = r.players[r.turn]
mi = g.seat(me)
before = g.points[mi]
g.act(me, {"type": "shoot", "ax": 0.42, "ay": 0.0})
check("a balloon pops for +3 on top of the ring", g.points[mi] - before == A.score_at(0.42, 0)[0] + 3 and len(g.prizes) == 1 and g.shot["slow"] > 0, f"{g.points[mi] - before}")
g.ready_at = 0
p2 = r.players[r.turn]
before = g.points[g.seat(p2)]
g.act(p2, {"type": "shoot", "ax": -0.65, "ay": 0.0})
check("the gold balloon off the face is +6 alone", g.points[g.seat(p2)] - before == 6 and not g.prizes)
check("a plain shot isn't slowed", g.shot["t"] == A.show_time(g.dist) or g.shot["slow"] > 0)
for _ in range(10):
    if g.between:
        break
    g.ready_at = 0
    g.act(r.players[r.turn], {"type": "shoot", "ax": 0.9, "ay": 0.9})
g.after_end()
check("end 3 is the swinging face at 70 m", g.kind == "swing" and g.swing and g.dist == 70 and not g.prizes)
still(g)
g.swing = {"a": A.SWING_A, "p": A.SWING_P}
me = r.players[r.turn]
age = g.swing_age()
cx = A.swing_x(A.SWING_A, A.SWING_P, age + A.show_time(70))
g.act(me, {"type": "shoot", "ax": cx, "ay": 0.0, "ph": age})
check("leading the swing hits the middle", g.shot["ring"] == 10 and abs(g.shot["cx"] - cx) < 1e-3 and g.shot["ph"] is not None, f"{g.shot}")
g.ready_at = 0
p2 = r.players[r.turn]
age = g.swing_age()
quarter = A.swing_x(A.SWING_A, A.SWING_P, age + A.show_time(70) + A.SWING_P / 2)   # aimed at the wrong side of the swing
g.act(p2, {"type": "shoot", "ax": quarter, "ay": 0.0, "ph": age})
check("aiming where it was, not where it will be, misses the gold", g.shot["ring"] < 9 or abs(cx) < 0.05, f"{g.shot}")
g.ready_at = 0
p3 = r.players[r.turn]
g.act(p3, {"type": "shoot", "ax": 0.0, "ay": 0.0, "ph": age + 50})
check("a swing clock far off the server's is ignored", abs(g.shot["ph"] - g.swing_age()) < 0.5, f"{g.shot['ph']}")

# 🔥 fire arrows: gold doubles, anything else is nothing, once an end; ✨ streaks from the third gold
r, g, (ann, bo) = game(2, ends=2)
still(g)
me = r.players[r.turn]
mi = g.seat(me)
g.act(me, {"type": "shoot", "ax": 0.0, "ay": 0.0, "fire": True})
check("a fire arrow in the gold scores double", g.points[mi] == 20 and g.shot["fire"] and not g.fire[mi], f"{g.points[mi]}")
g.ready_at = 0
other = r.players[r.turn]
oi = g.seat(other)
g.act(other, {"type": "shoot", "ax": 0.3, "ay": 0.0, "fire": True})
check("a fire arrow outside the gold scores nothing", g.points[oi] == 0 and g.shot["ring"] > 0)
g.ready_at = 0
check("a second fire arrow this end is refused", refused(g, me, {"type": "shoot", "ax": 0.0, "ay": 0.0, "fire": True}) is not None)
g.act(me, {"type": "shoot", "ax": 0.0, "ay": 0.0})
check("second gold in a row: no bonus yet", g.points[mi] == 30 and g.streak[mi] == 2)
for _ in range(4):
    if g.between:
        break
    g.ready_at = 0
    p = r.players[r.turn]
    g.act(p, {"type": "shoot", "ax": 0.0 if p is me else 0.5, "ay": 0.0})
check("the third gold in a row is +1", g.points[mi] == 41 and g.streak[mi] == 3, f"{g.points[mi]} {g.streak[mi]}")
check("a miss of the gold ends a streak", g.streak[oi] == 0)
g.after_end()
check("fire arrows come back each end", all(g.fire))
still(g)
check("the streak carries into the next end", g.streak[mi] == 3)

# old saves: a game pickled before #177 still loads and plays
import pickle  # noqa: E402
r, g, (ann, bo) = game(2, ends=3)
st = dict(g.__dict__)
for k in ("prizes", "kind", "swing", "swing_t0", "fire", "streak", "shootoff", "so_winner"):
    st.pop(k, None)
st["apple"] = {"x": 0.3, "y": 0.1}
old = A.Archery.__new__(A.Archery)
old.__setstate__(st)
check("an old save gets an apple prize and fire arrows", old.kind == "apple" and old.prizes[0]["k"] == "apple" and old.fire == [True, True])
old.ready_at = 0
check("an old save shoots and views", refused(old, r.players[r.turn], {"type": "shoot", "ax": 0.0, "ay": 0.0}) is None and old.view(ann)["archery"]["kind"] == "apple")
check("a room pickles", pickle.loads(pickle.dumps(r)).game.kind == "apple")

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
print("   bot averages over 3 ends:", avg)
check("hard bots outscore normal, normal outscore easy", avg["hard"] > avg["normal"] > avg["easy"], str(avg))
# #177 follow-up: casual players face these bots, so hard stays within reach (≈ easy 64 / normal 84 / hard 101)
check("bot levels stay close enough for people (easy ≥ 55, hard ≤ 115, gap < 50)",
      avg["easy"] >= 55 and avg["hard"] <= 115 and avg["hard"] - avg["easy"] < 50, str(avg))

# #128 tired arms: a long hold scatters the release; a short one, or a steady breath, doesn't
def spread(held, breath=False, n=40):
    xs = []
    for _ in range(n):
        r2, g2, (a2, b2) = game(2, ends=1)
        still(g2)
        p2 = r2.players[r2.turn]
        g2.act(p2, {"type": "shoot", "ax": 0.0, "ay": 0.0, "held": held, "breath": breath})
        xs.append(abs(g2.shot["x"]) + abs(g2.shot["y"]))
    return sum(xs) / n
quick, long_, calm = spread(1.0), spread(8.5), spread(8.5, True)
check("a quick release lands where aimed", quick < 1e-6, f"{quick:.4f}")
check("a long hold wanders", long_ > 0.01, f"{long_:.4f}")
check("a steady breath holds it", calm < 1e-6, f"{calm:.4f}")
r3, g3, _ = game(2, ends=1)
still(g3)
check("a silly hold is clamped, not refused", refused(g3, r3.players[r3.turn], {"type": "shoot", "ax": 0.0, "ay": 0.0, "held": 999}) is None)

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
