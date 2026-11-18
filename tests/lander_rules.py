"""Moon Lander rules: moons are well formed (flat pads, ×1/×2/×3), the landing limits judge touchdowns, scoring,
the flight replay matches the browser's own (static/games/lander.js run in node on the same logs: bit for bit, pickups
and hops too), fuel carries over, bad logs and too-quick flights are refused, bots land, and whole games finish.
The supply run: outposts pay their needs (refinery fuel, first-come rush, lab bullseye), crystals bank only on a
landing, canisters fuel mid-flight, and a hop to another pad scores ×1.5 (refused outside its window).

    python3 tests/lander_rules.py
"""
import json
import os
import random
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import lander as L  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


# -- moons
for seed in range(30):
    h, pads, (x0, vx0) = L.make_moon(random.Random(seed))
    ok = len(h) == L.NPTS and sorted(p[3] for p in pads) == [1, 2, 3]
    for l, r, top, m in pads:
        i0, i1 = int(l / L.SEG), int(r / L.SEG)
        ok = ok and all(h[i] == top for i in range(i0, i1 + 1)) and r - l > 2 * L.FOOT
    spans = sorted((p[0], p[1]) for p in pads)
    ok = ok and all(spans[k][1] < spans[k + 1][0] for k in range(2)) and 0 < x0 < L.W
    if not ok:
        break
check("30 moons: three flat, separate pads ×1 ×2 ×3", ok)
h, pads, start = L.make_moon(random.Random(4))
check("×3 pad is the narrowest", min(pads, key=lambda p: p[1] - p[0])[3] == 3)

# -- judging
l, r, top, m = pads[0]
mid = (l + r) / 2
check("soft and centred on a pad lands", L.judge(pads, mid, 0, -0.5, 0)[0] == "land")
check("too fast crashes", L.judge(pads, mid, 0, -(L.VY_OK + 0.1), 0)[0] == "crash")
check("sliding crashes", L.judge(pads, mid, L.VX_OK + 0.1, -0.5, 0)[0] == "crash")
check("tilted crashes", L.judge(pads, mid, 0, -0.5, 4)[0] == "crash")
check("a foot off the edge crashes", L.judge(pads, l + L.FOOT - 0.05, 0, -0.5, 0)[0] == "crash")
check("off the pads crashes", L.judge(pads, (pads[0][1] + 1), 0, -0.1, 0)[1] in (-1, 1, 2) and L.judge(pads, 0.5, 0, -0.1, 0)[0] == "crash")
best = L.judge(pads, mid, 0, 0.0, 0)[2]
check("a perfect touchdown scores mult × 100", best == m * 100, f"{best}")
check("softer scores more", L.judge(pads, mid, 0, -0.4, 0)[2] > L.judge(pads, mid, 0, -2.0, 0)[2])

# -- flights: no input free-falls and crashes; fuel only burns with thrust
res = L.fly(h, pads, start, L.TANK0, [])
check("no input free-falls into the ground", res["how"] == "crash" and res["fuel"] == L.TANK0)
res = L.fly(h, pads, start, 10, [[0, 3]])
check("the tank runs dry", res["fuel"] == 0)

# -- bots land
lands = 0
for seed in range(12):
    hh, pp, st = L.make_moon(random.Random(100 + seed))
    log = L.autopilot(hh, pp, st, L.TANK0, "hard", random.Random(seed))
    lands += L.fly(hh, pp, st, L.TANK0, log)["how"] == "land"
check("hard bots land most flights", lands >= 9, f"{lands}/12")

# -- the browser's replay matches the server's, bit for bit
node = shutil.which("node")
if node:
    cases = []
    rng = random.Random(7)
    for seed in range(40):
        hh, pp, st = L.make_moon(random.Random(200 + seed))
        _, picks = L.make_supply(random.Random(300 + seed), hh, pp, st)
        if seed % 4 == 3:   # a pickup right on the flight's path, so some are always touched
            probe = L.fly(hh, pp, st, L.TANK0, [[0, 3], [40, 2]], path_every=1)["path"]
            if len(probe) > 20:
                q = probe[len(probe) // 2]
                picks[seed % len(picks)] = [q[0] + 0.5, q[1] + 1.2, seed % 2]
        if seed % 2:
            log = L.autopilot(hh, pp, st, L.TANK0, rng.choice(["easy", "normal", "hard"]), rng)
        else:
            log, t = [], 0
            while t < L.MAX_TICKS:
                log.append([t, rng.randint(0, 5)])
                t += rng.randint(1, 40)
        fuel = L.TANK0 if seed % 2 else rng.choice([L.TANK0, 200, 50])
        res = L.fly(hh, pp, st, fuel, log, picks=picks)
        v = {"h": hh, "pads": pp, "start": list(st), "picks": picks,
             "geo": {"dt": L.DT, "g": L.G, "thrust": L.THRUST, "rot": L.ROT_STEP, "kMax": L.K_MAX, "w": L.W, "seg": L.SEG,
                     "startY": L.START_Y, "ceiling": L.CEILING, "vyOk": L.VY_OK, "vxOk": L.VX_OK, "angOk": L.ANG_OK,
                     "foot": L.FOOT, "maxTicks": L.MAX_TICKS, "sin": L.SIN, "cos": L.COS, "pickR2": L.PICK_R2, "pickFuel": L.PICK_FUEL, "hopTicks": L.HOP_TICKS}}
        keys = ("how", "pad", "pts", "ticks", "fuel", "k", "got")
        cases.append({"v": v, "log": log, "fuel": fuel, "want": {k: res[k] for k in keys}})
        # and a hop from the middle of each pad: a bot's hop log, or random presses
        n0 = seed % 3
        l0, r0, top0, _ = pp[n0]
        hop = [round((l0 + r0) / 2, 2), top0, 300 + seed]
        if seed % 2:
            hl = L.autopilot(hh, pp, None, 600, "hard", rng, hop=tuple(hop), target=(n0 + 1) % 3)
        else:
            hl, t = [], hop[2]
            while t < hop[2] + L.HOP_TICKS:
                hl.append([t, rng.randint(0, 5)])
                t += rng.randint(1, 40)
        hres = L.fly(hh, pp, None, 600, hl, picks=picks, taken=res["got"], hop=tuple(hop))
        cases.append({"v": v, "log": hl, "fuel": 600, "o": {"hop": hop, "taken": res["got"]}, "want": {k: hres[k] for k in keys}})
    js = r"""
globalThis.window = globalThis; globalThis.UI = {};
require(process.argv[1]);
const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let bad = [];
cases.forEach((c, n) => {
  const r = UI.lander.replay(c.v, c.log, c.fuel, c.o || {});
  for (const k of Object.keys(c.want)) if (JSON.stringify(r[k]) !== JSON.stringify(c.want[k])) { bad.push([n, k, r[k], c.want[k]]); break; }
});
console.log(JSON.stringify(bad));
"""
    out = subprocess.run([node, "-e", js, os.path.join(ROOT, "static/games/lander.js")], input=json.dumps(cases),
                         capture_output=True, text=True, timeout=60)
    bad = json.loads(out.stdout.strip() or "null") if out.returncode == 0 else None
    check("browser replay == server replay on 40 flights + 40 hops", bad == [], (out.stderr.strip()[:300] if bad is None else str(bad[:3])))
    check("those flights include landings", sum(c["want"]["how"] == "land" for c in cases) >= 10)
    check("…hops that land", sum(c["want"]["how"] == "land" for c in cases if "o" in c) >= 5, str(sum(c["want"]["how"] == "land" for c in cases if "o" in c)))
    check("…and pickups touched", sum(bool(c["want"]["got"]) for c in cases) >= 5, str(sum(bool(c["want"]["got"]) for c in cases)))
else:
    print("skip  node not found: browser replay not compared")


# -- a game: logs are checked, quick flights refused, fuel carries over
def game(n=2, bots=(), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy")[:n]]
    for lv in bots:
        r.add_bot(lv)
    r.switch_game("lander")
    r.settings.update(settings)
    r.start()
    return r, r.game, list(r.players.values())


r, g, (a, b) = game()
check("starts on the countdown", g.stage == "count")
try:
    g.act(a, {"type": "land", "log": []})
    check("no landing during the countdown", False)
except GameError:
    check("no landing during the countdown", True)
with r.cond:
    g.on_timeout(g.t0 + 0.01)
check("then everyone flies", g.stage == "fly")
for bad in ([[0, 9]], [[5, 1], [3, 1]], [[0, "x"]], "nope", [[0, True]]):
    try:
        g.act(a, {"type": "land", "log": bad})
        check(f"bad log refused {bad}", False)
    except GameError:
        check(f"bad log refused {str(bad)[:20]}", True)
# a hard bot's log, sent the moment the round starts: refused as too quick
log = L.autopilot(g.h, g.pads, g.start_xv, a.g.tank, "hard", random.Random(1))
res = L.fly(g.h, g.pads, g.start_xv, a.g.tank, log)
g.t0 = time.time()
try:
    g.act(a, {"type": "land", "log": log})
    check("a too-quick flight is refused", False)
except GameError:
    check("a too-quick flight is refused", True)
g.t0 = time.time() - res["ticks"] * L.DT
g.act(a, {"type": "land", "log": log})
check("the server judges the log", a.g.res["how"] == res["how"] and a.g.points >= res["pts"] and (res["how"] == "land" or a.g.points == 0), f"{a.g.res['how']} {a.g.points}")
refuel = L.NEED_FUEL if res["how"] == "land" and g.needs[res["pad"]][0] == "fuel" else 0
check("fuel left is what the flight left (+ a refinery's refill)", a.g.fuel == min(L.TANK_MAX, res["fuel"] + refuel))
try:
    g.act(a, {"type": "land", "log": log})
    check("one landing a round", False)
except GameError:
    check("one landing a round", True)
fuel_a = a.g.fuel
with r.cond:
    g.on_timeout(time.time())   # fly → between (Bo never landed)
check("someone who never lands scores 0", b.g.res["how"] == "lost" and b.g.points == 0)
with r.cond:
    g.on_timeout(time.time())   # between → round 2
check("round 2 tops the tank up", g.round_no == 2 and a.g.fuel == min(L.TANK_MAX, fuel_a + L.REFILL))
json.dumps(g.view(a))
check("view serialises", True)

# -- bots finish whole games (the simulated clock, as simulate.py runs them)
for n_bots in (1, 5):
    r, g, ps = game(1, bots=["hard", "normal", "easy", "hard", "normal"][:n_bots])
    ps[0].bot = "easy"
    clock = time.time()
    for _ in range(60 * 600):
        clock += 1 / 60
        with r.cond:
            g.frame(clock)
        if r.phase != "playing":
            break
    check(f"{n_bots + 1} bots finish a game", r.phase == "over", r.log[-1]["text"])

# -- the supply run
for seed in range(20):
    hh, pp, st = L.make_moon(random.Random(seed))
    needs, picks = L.make_supply(random.Random(seed), hh, pp, st)
    ok = sorted(n[0] for n in needs) == sorted(L.NEEDS) and len({n[1] for n in needs}) == 3 and len(picks) == L.N_PICKS
    ok = ok and sum(q[2] for q in picks) == 1 and all(L.ground(hh, q[0]) + 11 < q[1] < L.CEILING for q in picks)
    if not ok:
        break
check("20 rounds: three different outposts, 3 crystals + 1 canister in the sky", ok)
# a canister on the path fuels mid-flight; a crystal on the path is touched
h, pads, start = L.make_moon(random.Random(4))
path = L.fly(h, pads, start, 200, [[0, 3]], path_every=1)["path"]
q = path[60]
base = L.fly(h, pads, start, 200, [[0, 3]])
withc = L.fly(h, pads, start, 200, [[0, 3]], picks=[[q[0], q[1] + 1.0, 1]])
check("a canister is picked up and burns longer", withc["got"] == [0] and withc["ticks"] != base["ticks"] or withc["fuel"] > 0, str(withc["got"]))
check("…but only once", L.fly(h, pads, start, 200, [[0, 3]], picks=[[q[0], q[1] + 1.0, 1]], taken=[0])["got"] == [])


def landed_game(seed=3):
    """Ann lands a hard bot's flight on its pad; returns (room, game, ann, bo, result)."""
    random.seed(seed)
    r, g, (a, b) = game()
    with r.cond:
        g.on_timeout(g.t0 + 0.01)
    for tries in range(20):
        log = L.autopilot(g.h, g.pads, g.start_xv, a.g.tank, "hard", random.Random(tries))
        res = L.fly(g.h, g.pads, g.start_xv, a.g.tank, log, picks=g.picks)
        if res["how"] == "land":
            break
    g.t0 = time.time() - res["ticks"] * L.DT
    g.act(a, {"type": "land", "log": log})
    return r, g, a, b, res


r, g, a, b, res = landed_game()
kind = g.needs[res["pad"]][0]
gems = sum(1 for i in res["got"] if g.picks[i][2] == 0)
want = res["pts"] + gems * L.GEM + (L.RUSH if kind == "rush" else L.LAB if kind == "lab" and res["prec"] >= L.LAB_PREC else 0)
check("a landing scores the pad + crystals + the outpost's need", a.g.points == want, f"{a.g.points} vs {want} ({kind})")
check("a landing with fuel opens a hop window", isinstance(a.g.hop, dict) and a.g.hop["open"] == res["ticks"] + L.HOP_OPEN)
check("the round waits while a hop is possible", g.stage == "fly")
for bad in (res["ticks"], res["ticks"] + L.HOP_CLOSE + 1, "x"):
    try:
        g.act(a, {"type": "lift", "t": bad})
        check(f"lift outside the window refused ({bad})", False)
    except GameError:
        check(f"lift outside the window refused ({bad})", True)
try:
    g.act(b, {"type": "lift", "t": res["ticks"] + 30})
    check("no hop without a landing", False)
except GameError:
    check("no hop without a landing", True)
lift = a.g.hop["open"] + 2
g.t0 -= 1.5   # (pretend the clock has moved on)
g.act(a, {"type": "lift", "t": lift})
check("a lift in the window starts the hop", a.g.hop == "up")
first = res["pad"]
pts_before = a.g.points
for tries in range(40):
    target = [n for n in range(3) if n != first][tries % 2]
    hl = L.autopilot(g.h, g.pads, None, a.g.fuel, "hard", random.Random(tries), hop=(res["x"], g.pads[first][2], lift), target=target)
    hres = g.fly_hop(a, hl)
    if hres["how"] == "land" and hres["pad"] == target:
        break
check("a hard bot's hop can land on another pad", hres["how"] == "land" and hres["pad"] == target)
try:
    g.act(a, {"type": "hop", "log": [[lift - 1, 3]]})
    check("hop presses before the lift refused", False)
except GameError:
    check("hop presses before the lift refused", True)
g.t0 = time.time() - hres["ticks"] * L.DT
g.act(a, {"type": "hop", "log": hl})
gems2 = sum(1 for i in hres["got"] if g.picks[i][2] == 0)
k2 = g.needs[target][0]
bonus = gems2 * L.GEM + (L.RUSH if k2 == "rush" else 0) + (L.LAB if k2 == "lab" and hres["prec"] >= L.LAB_PREC else 0)
gain = a.g.points - pts_before
check("a hop to another pad scores ×1.5 (+ that outpost)", gain == round(1.5 * hres["pts"]) + bonus, f"{gain} vs {round(1.5 * hres['pts'])}+{bonus}")
check("the hop is done", isinstance(a.g.hop, dict) and a.g.hop["how"] == "land")
# the same pad: no bonus; a crash keeps the first landing
r, g, a, b, res = landed_game(5)
pts1 = a.g.points
lift = a.g.hop["open"]
g.t0 -= 1.5
g.act(a, {"type": "lift", "t": lift})
g.t0 -= 8
g.act(a, {"type": "hop", "log": [[lift, 3], [lift + 45, 2]]})   # a short burn straight up, then a free fall back down
check("a hop that crashes keeps the first landing", a.g.points == pts1 and a.g.hop["how"] in ("crash", "land") and a.g.hop["pts"] == 0, str(a.g.hop.get("how")))
json.dumps(g.view(a))
# the rush pays only the first one down
r, g, a, b, res = landed_game(3)
n = res["pad"]
g.needs[n] = ["rush", "Test"]
before = b.g.points
b.g.res = None
g.done(b, dict(res), time.time())
check("a rush outpost pays only the first lander", b.g.points - before == res["pts"] + sum(L.GEM for i in res["got"] if g.picks[i][2] == 0) or n in g.rushed, f"{b.g.points - before}")
# the window closing lets the round settle
r, g, a, b, res = landed_game(3)
b.g.res = {"how": "crash", "pad": -1, "pts": 0, "fuel": 0}
with r.cond:
    g.frame(g.t0 + (a.g.hop["close"] + 5) * L.DT + 1.5)
check("when the hop window closes the round settles", a.g.hop is None and g.stage == "settle", f"{a.g.hop} {g.stage}")

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
