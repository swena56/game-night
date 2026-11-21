"""Sky Drop rules: the race counts down, everyone descends and the run finishes with a winner, rings score
(with a combo), boosts speed you up and are limited (3, refilled at checkpoints), bots race to the finish,
bots by level thread about 40% / 60% / 80% of the rings, the seat chips show live points,
spectators / late joiners / the replay viewer get a view (no crash), and bad input is refused.

    python3 tests/skydrop_rules.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import skydrop as M  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []
CLOCK = [1_000_000.0]
M.time.time = lambda: CLOCK[0]   # the game reads time.time() for boosts and views; drive it by hand


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, bots=0, level="normal", dive=None, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("skydrop")
    for _ in range(bots):
        r.add_bot(level)
    r.settings.update(settings)
    if dive is not None:
        r.settings["level"] = dive
    CLOCK[0] += 1000
    r.start()
    return r, r.game, [p for p in r.players.values() if not p.spectator]


def tick(g, secs, step=1 / 60, each=None):
    end = CLOCK[0] + secs
    while CLOCK[0] < end and g.room.phase == "playing":
        CLOCK[0] += step
        with g.room.cond:   # the server's ticker holds the room lock around frame()
            if g.frame(CLOCK[0]):
                g.room.snap()
        if each:
            each()


def to_race(g):
    tick(g, M.COUNTDOWN + 0.1)
    return g.stage == "race"


# countdown, descent, finish with a winner
r, g, ps = game(2)
check("starts in countdown", g.stage == "countdown")
d0 = g.flyers[0].depth
tick(g, 1.0)
check("no movement during countdown", g.flyers[0].depth == d0)
check("race starts after the countdown", to_race(g))
tick(g, 5)
check("players descend", all(f.depth > 40 for f in g.flyers), str([round(f.depth) for f in g.flyers]))
tick(g, 70)
check("everyone reaches the deck", all(f.depth == M.LENGTH and f.done_at > 0 for f in g.flyers))
check("run results stage", g.stage == "results", g.stage)
check("places 1 and 2 handed out", sorted(f.place for f in g.flyers) == [1, 2])
tick(g, 6)
check("one-run match ends", r.phase == "over", r.phase)
check("finish bonus counted", all(n >= 15 for n in g.points), str(g.points))

# rings score: a flyer parked on every ring's line threads them all, with a growing combo
r, g, ps = game(2, hazards=False)
to_race(g)
f = g.flyers[0]


def aim():
    nxt = next((ring for ring in g.rings if ring[0] > f.depth), None)
    if nxt:
        f.x, f.z, f.vx, f.vz, f.sx, f.sz = nxt[1], nxt[2], 0.0, 0.0, 0.0, 0.0


tick(g, 20, each=aim)
check("rings scored", f.rings >= 10, f"{f.rings} rings")
check("combo grows", f.combo == f.rings and f.score > f.rings * 10, f"combo {f.combo} score {f.score}")
check("a 5-ring streak sets off the surge", f.surge_until > 0, f"surge_until {f.surge_until}")
miss = g.flyers[1]
check("a flyer that never steers misses most rings", miss.rings < f.rings, f"{miss.rings} vs {f.rings}")

# a miss resets the combo
nxt = next(ring for ring in g.rings if ring[0] > f.depth)
f.x, f.z = (nxt[1] + 4 if nxt[1] < 0 else nxt[1] - 4), nxt[2]
tick(g, (nxt[0] - f.depth) / 12.5 + 0.1)
check("missing a ring resets the combo", f.combo == 0, f"combo {f.combo}")

# boost: speeds you up, only 3 charges, cooldown, refilled at a checkpoint
r, g, ps = game(2, hazards=False)
to_race(g)
a, b = g.flyers
g.on_input(ps[0], {"boost": True})
tick(g, 1.0)
check("boost makes you faster", a.depth > b.depth + 3, f"{a.depth:.1f} vs {b.depth:.1f}")
check("boost uses a charge", a.boosts == 2)
g.on_input(ps[0], {"boost": True})
check("boost has a cooldown", a.boosts == 2)
for _ in range(3):
    tick(g, 2.6)
    g.on_input(ps[0], {"boost": True})
check("only three boosts before a checkpoint", a.boosts == 0 and a.depth < 180, f"{a.boosts} at {a.depth:.0f}")
check("the extra tap did nothing", a.boost_until < M.time.time())
while a.depth < 180 and r.phase == "playing":
    tick(g, 0.5)
check("checkpoint refills boosts", a.boosts == 3, str(a.boosts))
r, g, ps = game(2)
g.on_input(ps[0], {"boost": True})
check("no boost during the countdown", g.flyers[0].boosts == 3)

# 😮‍💨 a close call: skim a hazard's edge without touching it
r, g, ps = game(2, hazards=False)
to_race(g)
a, b = g.flyers
g.hazards = [[a.depth + 3.0, 1.55 + 0.4, 0.0, 0, 0.0]]
a.x = 0.0
g.flyers[1].done_at = -1
before = a.score
tick(g, 0.6)
check("skimming a hazard pays a close-call bonus", a.grazes == 1 and a.score == before + M.GRAZE_PTS, f"{a.grazes} {a.score - before}")

r, g, ps = game(2, hazards=False)
to_race(g)
a, b = g.flyers
g.hazards = [[a.depth + 3.0, 6.0, 0.0, 0, 0.0]]
tick(g, 0.6)
check("a far miss is no close call", a.grazes == 0)

# steering input moves you
r, g, ps = game(2, hazards=False)
to_race(g)
x0 = g.flyers[0].x
g.on_input(ps[0], {"sx": 1, "sz": -1})
tick(g, 0.6)
check("steer right moves right", g.flyers[0].x > x0 + 1, f"{x0:.2f} → {g.flyers[0].x:.2f}")
check("steer forward moves z", g.flyers[0].z < -0.5, f"{g.flyers[0].z:.2f}")
tick(g, 4)
check("walls keep you in the shaft", abs(g.flyers[0].x) <= 8.5 and abs(g.flyers[0].z) <= 5.5)

# bots race to the finish and score rings; a hard bot beats an easy one on rings over a few races
for lvl in ("easy", "hard"):
    r, g, ps = game(1, bots=3, level=lvl, runs=1)
    tick(g, 80)
    bots = [i for i, pid in enumerate(g.seats) if r.players[pid].bot]
    check(f"{lvl} bots finish the run", all(g.flyers[i].done_at > 0 for i in bots) and r.phase == "over",
          f"{r.phase} {[round(g.flyers[i].depth) for i in bots]}")
    check(f"{lvl} bots thread rings", sum(g.flyers[i].rings for i in bots) >= 3 * 8,
          str([g.flyers[i].rings for i in bots]))
    check(f"{lvl} bot match has a winner line", any("wins Sky Drop" in (e.get("text") or "") for e in r.log[-5:]))

# bot strength by level: average share of rings over several seeded races (easy must be beatable)
share = {}
for lvl in ("easy", "normal", "hard"):
    got = total = 0
    for seed in range(4):
        r, g, ps = game(1, bots=3, level=lvl, runs=1)
        g.rng.seed(seed)
        g.run = 0
        g.new_run(CLOCK[0])   # the same seeded course and bot rolls for every level
        tick(g, 80, step=1 / 30)
        bots = [i for i, pid in enumerate(g.seats) if r.players[pid].bot]
        got += sum(g.flyers[i].rings for i in bots)
        total += len(bots) * len(g.rings)
    share[lvl] = got / total
detail = " ".join(f"{k} {v:.0%}" for k, v in share.items())
check("bots: easy < normal < hard on rings", share["easy"] < share["normal"] < share["hard"], detail)
check("bots: easy threads at most half the rings", 0.25 <= share["easy"] <= 0.50, detail)
check("bots: normal about 55-65%, hard about 75-85%", 0.50 <= share["normal"] <= 0.70 and 0.70 <= share["hard"] <= 0.90, detail)

# the seat chips show live points during a run (match total + this run), and don't double up when it ends
r, g, ps = game(2, hazards=False, runs=3)
to_race(g)
f = g.flyers[0]
g.points[0] = 50      # as if an earlier run had scored
refreshed = []
tick(g, 12, each=aim)
check("live points in the chip mid-run", f.score > 0 and g.meta(ps[0]) == f"{50 + f.score} pts", f"{g.meta(ps[0])} score {f.score}")


def run_ticks(secs):
    end = CLOCK[0] + secs
    while CLOCK[0] < end and g.stage == "race":
        CLOCK[0] += 1 / 60
        with g.room.cond:
            if g.frame(CLOCK[0]):
                refreshed.append(g.stage)


run_ticks(4)
check("chips refresh during the race", "race" in refreshed, str(refreshed[:5]))
run_ticks(80)
check("run ends", g.stage == "results", g.stage)
check("no double count after the run", g.meta(ps[0]) == f"{g.points[0]} pts" and g.points[0] == 50 + f.score,
      f"{g.meta(ps[0])} points {g.points[0]} run {f.score}")

# three runs: points carry across runs
r, g, ps = game(2, runs=3)
tick(g, 3 * 75)
check("three-run match ends", r.phase == "over" and g.run == 3, f"{r.phase} run {g.run}")

# spectators, late joiners and the replay viewer get a view without crashing
r, g, ps = game(2)
late = r.add_player("Late")
to_race(g)
tick(g, 2)
for who, p in (("late joiner", late), ("replay viewer", server.REPLAY_VIEWER)):
    try:
        v = g.view(p)["skydrop"]
        json.dumps(v)
        ok = v["me"] is None and len(v["flyers"]) == 2
    except Exception as e:  # noqa: BLE001
        ok, v = False, repr(e)
    check(f"{who} gets a view", ok, str(v)[:100])
check("late joiner meta", g.meta(late) == "Watching")
check("server room view for the late joiner", isinstance(r.view(late), dict))
check("replay view after an input", isinstance(r.view(server.REPLAY_VIEWER), dict))
try:
    g.on_input(late, {"sx": 1})
    check("late joiner can't steer", False)
except GameError:
    check("late joiner can't steer", True)

# bad input refused
r, g, ps = game(2)
to_race(g)
for bad in ({"sx": "x"}, {"sz": float("nan")}, {"sx": True}, {"sz": float("inf")}, {"sx": [1]}):
    try:
        g.on_input(ps[0], bad)
        check(f"refuses {bad}", False)
    except GameError:
        check(f"refuses {bad}", True)
g.on_input(ps[0], {"sx": 9, "sz": -9})
check("clamps wild steering", (g.flyers[0].sx, g.flyers[0].sz) == (1.0, -1.0))
try:
    g.act(ps[0], {"type": "boost"})
    check("act is refused", False)
except GameError:
    check("act is refused", True)
g.on_input(ps[0], {"boost": "yes"})
check("a non-true boost is ignored", g.flyers[0].boosts == 3)

# a player who leaves mid-run doesn't stall the race or the winner
r, g, ps = game(3)
to_race(g)
ps[2].eliminated = True
tick(g, 75)
check("race ends with a quitter", r.phase == "over", r.phase)
check("fast view is JSON", isinstance(json.dumps(g.fast_view(CLOCK[0])), str))
check("all finite", all(math.isfinite(x) for f in g.flyers for x in (f.depth, f.x, f.z)))

# 🧩 dynamic levels: every run is built from random sections, always flyable, different every time
import random
paths = [M._ring_path(random.Random(n), th, 39) for n in range(60) for th in ("spire", "storm", "aurora")]
check("level rings stay inside the ring field", all(abs(x) <= M.RX + .01 and abs(z) <= M.RZ + .01 for p in paths for x, z in p))
check("no hop between rings is too far to fly", all(abs(a[0] - b[0]) <= M.STEP_X + .01 and abs(a[1] - b[1]) <= M.STEP_Z + .01 for p in paths for a, b in zip(p, p[1:])))
check("levels differ from run to run", len({tuple(M._ring_path(random.Random(n), "spire", 39)) for n in range(60)}) == 60)
r, g, ps = game(2)
r2, g2, ps2 = game(2)
check("two matches get different courses", [x[1:3] for x in g.rings] != [x[1:3] for x in g2.rings])
check("hazards get denser with depth", len([h for h in g.hazards if h[0] > M.LENGTH / 2]) >= len([h for h in g.hazards if h[0] <= M.LENGTH / 2]) - 1, str(len(g.hazards)))

# 💎 greed forks: about one gap in three hangs a gem well off the ring line
r, g, ps = game(2)
gems = [c for c in g.coins if c[3] == 1]
check("greed forks: about a third of the gaps", 10 <= len(gems) <= 15, str(len(gems)))
off = []
for j, (gd, gx, gz) in g.forks.items():
    lx, lz = M._line_xz(g.rings[j], g.rings[j + 1], gd)
    off.append(math.hypot(gx - lx, gz - lz))
check("every fork gem is out of reach from the ring line", off and min(off) > M.COIN_R + 1, f"min {min(off):.1f}")
check("fork gems stay inside the shaft", all(abs(c[1]) <= M.SHAFT_X and abs(c[2]) <= M.SHAFT_Z for c in gems))

# 🎚️ levels: smaller rings, set pieces with a flyable lane through them, speed ramp at 5
for lvl in (1, 2, 3, 4, 5):
    r, g, ps = game(2, dive=lvl)
    check(f"level {lvl}: course built", g.level == lvl and g.ring_r == M.LEVELS[lvl]["ring_r"] and g.fast_view(CLOCK[0])["ringR"] == g.ring_r)
check("level 1 has no pendulums", not any(h[3] == M.PENDULUM_KIND for h in game(2, dive=1)[1].hazards))
for lvl in (3, 4, 5):
    kinds = set()
    ok = True
    for n in range(12):
        r, g, ps = game(2, dive=lvl)
        kinds |= {h[3] for h in g.hazards}
        for j in range(len(g.rings) - 1):
            ring = g.rings[j + 1]
            if (j + 1) % M.LEVELS[lvl]["sets"] != M.LEVELS[lvl]["sets"] - 1:
                continue
            near = [h for h in g.hazards if abs(h[0] - (ring[0] - 6)) < 0.01]
            # the lane along the ring line stays clear: every non-pendulum hazard sits well off it
            lx, lz = M._line_xz(g.rings[j], ring, ring[0] - 6)
            for h in near:
                if h[3] != M.PENDULUM_KIND and abs(h[1] - lx) < 2.99:
                    ok = False
    check(f"level {lvl}: set pieces appear, with gaps", (3 in kinds or 0 in kinds) and ok)
r, g, ps = game(2, hazards=False, dive=3)
check("hazards Off removes set pieces", not g.hazards)
# a pendulum sweeps across the ring line
g.race_started = 0.0
x0, _ = g.hazard_position(100, 0.0, 0.0, M.PENDULUM_KIND, 0.0, 0.0)
x1, _ = g.hazard_position(100, 0.0, 0.0, M.PENDULUM_KIND, 0.0, 0.83)
check("pendulum swings", abs(x1 - x0) > 3, f"{x0:.1f}->{x1:.1f}")
# after a hit you get a short speed-up
r, g, ps = game(2)
to_race(g)
f = g.flyers[0]
f.stun_until = CLOCK[0] - 0.1
d0 = f.depth
g.simulate(0.1, CLOCK[0])
f2 = g.flyers[1]
d1 = f2.depth
g.simulate(0.1, CLOCK[0])
check("recovering after a hit is faster", f.depth - d0 > f2.depth - d1)

# 🎁 checkpoint perks
r, g, ps = game(2, hazards=False)
to_race(g)
f = g.flyers[0]
f.depth = 179.9
f.sx = f.sz = 0
g.simulate(0.05, CLOCK[0])
check("checkpoint offers a perk", f.offer is True and g.fast_view(CLOCK[0])["flyers"][0][15] is True)
g.on_input(ps[0], {"perk": "shield"})
check("choosing a perk uses the offer", f.perk == "shield" and not f.offer)
try:
    g.on_input(ps[0], {"perk": "nope"})
    check("unknown perk refused", False)
except GameError:
    check("unknown perk refused", True)
g.hazards = [[f.depth + 0.2, f.x, f.z, 0, 0.0]]
before = f.score
g.simulate(0.05, CLOCK[0] + 0.05)
check("shield blocks one hit, no stun", f.perk == "" and f.stun_until <= CLOCK[0] and f.hits == 0 and f.score >= before)
f.perk = "wide"
f.last_ring = -1
g.rings = [[f.depth + 0.2, f.x + g.ring_r + 0.2, f.z, 1.0]]
g.simulate(0.05, CLOCK[0] + 0.1)
check("wide perk counts a ring just outside the normal radius", f.rings == 1)
r, g, ps = game(1, bots=1)
to_race(g)
b = g.flyers[1]
b.depth = 179.9
g.simulate(0.05, CLOCK[0])
check("bots pick a perk automatically", b.perk in M.PERKS and not b.offer)

# 🌀 drifting rings (level 4+)
check("levels 1-3 have no drifting rings", all(not any(game(2, dive=l)[1].drifts) for l in (1, 3)))
r, g, ps = game(2, dive=4)
mv = [j for j, d in enumerate(g.drifts) if d]
check("level 4 has drifting rings that pay more", len(mv) >= 5 and all(g.rings[j][3] >= 1.3 for j in mv), str(len(mv)))
check("drifting rings never carry a set piece or leave the shaft", all(abs(g.rings[j][1]) + g.drifts[j][0] <= M.SHAFT_X and abs(g.rings[j][2]) + g.drifts[j][1] <= M.SHAFT_Z for j in mv)
      and not any(abs(h[0] - (g.rings[j][0] - 6)) < .01 for j in mv for h in g.hazards))
g.race_started = 0.0
j = mv[0]
p0, p1 = g.ring_position(j, 0.0), g.ring_position(j, 1.5)
check("a drifting ring moves", math.hypot(p0[0] - p1[0], p0[1] - p1[1]) > 0.5)
to_race(g)
f = g.flyers[0]
j = mv[0]
t = CLOCK[0]
f.depth, f.last_ring, f.sx, f.sz = g.rings[j][0] - 0.1, j - 1, 0, 0
f.x, f.z = g.ring_position(j, t + 0.01)
g.hazards = []
before = f.rings
g.simulate(0.02, t + 0.02)
check("a drifting ring scores against where it is now", f.rings == before + 1)
f.depth, f.last_ring = g.rings[mv[1]][0] - 0.1, mv[1] - 1
bx, bz = g.ring_position(mv[1], t + 0.01)
f.x, f.z = bx + g.ring_r + 1.0, bz
g.simulate(0.02, t + 0.02)
check("missing a drifting ring breaks the combo", f.combo == 0)

# 🌑 blackout, 🚀 slingshot, 📈 climb
check("blackout stretches only on level 5", not game(2, dive=4)[1].dark and len(game(2, dive=5)[1].dark) >= 2)
r, g, ps = game(2, hazards=False)
to_race(g)
a, b = g.flyers
for f in (a, b):
    f.depth, f.x, f.z, f.sx, f.sz = 100.0, 0.0, 0.0, 0, 0
g.streams = [[100.0, 0.0, 0.0, 0, 0]]
a.boost_until = CLOCK[0] + 5
g.simulate(0.1, CLOCK[0])
check("boosting inside a stream slingshots (faster than boosting outside)", a.slinging and a.depth > b.depth + 0.1 and not b.slinging, f"{a.depth:.2f} vs {b.depth:.2f}")
check("a slingshot fires an event", any(e[1] == "sling" for e in g.events))
b.boost_until = CLOCK[0] + 5
b.x = 7.0
g.simulate(0.1, CLOCK[0] + 0.1)
check("boosting outside a stream is no slingshot", not b.slinging)
r, g, ps = game(2, runs=3, dive=0)
lv = [g.level]
for _ in range(2):
    g.new_run(CLOCK[0])
    lv.append(g.level)
check("climb steps 1, 4, 8 over three runs", lv == [1, 4, 8], str(lv))

print("FAILED: " + ", ".join(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
