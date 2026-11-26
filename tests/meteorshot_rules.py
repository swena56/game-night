"""Meteor Shot rules: the game ends after `shots` launches each (not shots²), aim reaches rings off to the side,
wind bends the comet, spectators and late joiners get a view (no crash), bad input is refused, bots score by
level, and the ring moves each round.

    python3 tests/meteorshot_rules.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import meteorshot as M  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("meteorshot")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def fire(r, g, **a):
    p = r.players[r.turn]
    g.act(p, {"type": "fire", "angle": 45, "power": 14, "aim": 0, **a})
    return p


# 🌀 twists: none in round 1; a lucky ring pays half again; a gale doubles the wind
r, g, ps = game(2, shots=5)
check("no twist in round 1", g.twist is None)
g.twist = None
g.rng.seed(1)
base = {}
for tw in (None, "lucky"):
    r, g, ps = game(2, shots=5)
    g.wind = 0.0
    g.twist = tw
    g.target = [0.0, 10.0]
    g.target_drift = 0.0
    g.stars, g.rocks = [], []  # the ring alone
    g.gravity, g.target_phase = 4.9, 0.0  # both games must be the same
    p = fire(r, g)
    base[tw] = p.g.score
check("a lucky ring pays more", base["lucky"] > base[None], f"{base}")
seen = set()
for sd in range(40):
    r, g, ps = game(2, shots=5)
    g.rng.seed(sd)
    g.round = 1
    g.new_target()
    seen.add(g.twist)
    if g.twist == "gale":
        check("a gale blows hard", abs(g.wind) >= 0.9, g.wind)
check("all twists turn up", {None, "gale", "lucky"} <= seen, seen)

# length: 3 shots each → 6 launches for 2 players
r, g, ps = game(2)
n = 0
while r.phase == "playing" and not getattr(g, "sd", None) and n < 40:   # a tie goes to a shoot-off after the regular shots
    fire(r, g)
    n += 1
check("2 players × 3 shots ends after 6 launches", n == 6, f"{n}")
check("every player fired 3", all(p.g.shots == 3 for p in ps))
r, g, ps = game(3, shots=5)
n = 0
while r.phase == "playing" and not getattr(g, "sd", None) and n < 80:
    fire(r, g)
    n += 1
check("3 players × 5 shots ends after 15 launches", n == 15, f"{n}")

# turns alternate, the ring and wind move after each full round only
r, g, ps = game(2)
t0 = list(g.target)
a = fire(r, g)
check("turn passes after a shot", r.turn != a.id)
check("ring stays mid-round", g.target == t0)
fire(r, g)
check("ring moves after the round", g.target != t0)
check("round counter", g.view(ps[0])["meteor"]["round"] == 2)

# aim reaches a ring off to the side
target, wind = [2.6, 10.0], 0.0
best = max((M.points_for(*M.fly(ang, pw, aim, target, wind), target), ang, pw, aim)
           for ang in range(18, 73, 2) for pw in range(8, 21) for aim in range(-16, 17))
check("a ring 2.6 to the side can be hit near dead centre", best[0] >= 90, f"{best}")
x0, _ = M.fly(45, 14, 0, target, 0.0)
x1, _ = M.fly(45, 14, 0, target, 0.6)
check("wind pushes the comet downwind", x1 > x0 + 0.1, f"{x0:.2f} → {x1:.2f}")
xl, _ = M.fly(45, 14, -10, target, 0.0)
check("aim left goes left", xl < x0 - 1)

# spectator / late joiner view does not crash
r, g, ps = game(2)
late = r.add_player("Late")
try:
    v = g.view(late)["meteor"]
    ok = v["score"] is None and len(v["board"]) == 2
except Exception as e:  # noqa: BLE001
    ok, v = False, repr(e)
check("late joiner gets a view", ok, str(v)[:120])
check("late joiner's chip meta is safe", g.meta(late) == "")
check("server room view for the late joiner", isinstance(r.view(late), dict))

# bad input
r, g, ps = game(2)
for bad in ({"angle": "x"}, {"power": None}, {"aim": float("nan")}, {"angle": True}):
    try:
        fire(r, g, **bad)
        check(f"refuses {bad}", False)
    except GameError:
        check(f"refuses {bad}", True)
try:
    g.act(r.players[[p.id for p in ps if p.id != r.turn][0]], {"type": "fire", "angle": 45, "power": 14})
    check("refuses out of turn", False)
except GameError:
    check("refuses out of turn", True)
p = fire(r, g, angle=500, power=-3, aim=99)
r2, g2, ps2 = game(2)
fire(r2, g2, angle=33.33333, power=12.987, aim=-4.1771)
check("shot numbers are rounded to 0.1", (g2.last["angle"], g2.last["power"], g2.last["aim"]) == (33.3, 13.0, -4.2), str(g2.last))
check("clamps wild numbers", g.last["angle"] == 72 and g.last["power"] == 8 and g.last["aim"] == 16)

# bots: hard beats easy on average, nobody crashes
avg = {}
for lvl in ("easy", "normal", "hard"):
    tot = 0
    for seed in range(30):
        r, g, ps = game(1)
        g.rng = random.Random(seed)
        g.new_target()
        ps[0].bot = lvl
        g.bot_turn(ps[0])
        tot += g.last["points"]
    avg[lvl] = tot / 30
check("bots by level: easy < normal < hard", avg["easy"] < avg["normal"] < avg["hard"], str({k: round(v) for k, v in avg.items()}))
check("hard bot averages 70+", avg["hard"] >= 70, f"{avg['hard']:.0f}")

# a full game of bots finishes with a winner or a tie
r, g, ps = game(3)
for p in ps:
    p.bot = "normal"
k = 0
while r.phase == "playing" and k < 50:
    g.bot_turn(r.players[r.turn])
    k += 1
check("bot game finishes", r.phase == "over" and k == 9, f"{r.phase} {k}")

# a save from before this fix (no fired / best / fired_total) still plays
r, g, ps = game(2)
for attr in ("fired", "fired_total"):
    if hasattr(g, attr):
        delattr(g, attr)
for p in ps:
    del p.g.best
try:
    fire(r, g)
    g.view(ps[0])
    check("old save keeps playing", True)
except Exception as e:  # noqa: BLE001
    check("old save keeps playing", False, repr(e))

# ⭐ the star field: one shot (the route) takes every star and passes every asteroid
every, clear = True, True
rocks_seen = 0
for sd in range(60):
    r, g, ps = game(2, shots=5)
    g.rng.seed(sd)
    g.round = 1 + sd % 4
    g.new_target()
    if not g.route:
        every = False
        continue
    got, broke = M.along(g.route, g.target, g.wind, g.gravity, g.stars, g.rocks)
    every &= len(got) == 3
    clear &= broke is None
    rocks_seen += len(g.rocks)
check("one arc takes all three stars", every)
check("and the asteroids leave that arc open", clear and rocks_seen > 40, f"{rocks_seen}")
r, g, ps = game(2)
check("round 1 has no asteroids", len(g.rocks) == 0 and len(g.stars) == 3)
p = fire(r, g, angle=g.route[0], power=g.route[1], aim=g.route[2])
check("stars score", len(g.last["got"]) == 3 and p.g.score >= 3 * M.STAR_PTS, f"{p.g.score}")
r, g, ps = game(2)
g.stars, g.rocks = [], [list(M.at(45, 14, 0, g.wind, g.gravity, 0.4))]
p = fire(r, g)
check("an asteroid breaks the comet up", g.last["broke"] is not None and p.g.score == 0, f"{g.last['broke']} {p.g.score}")

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
