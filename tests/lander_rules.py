"""Moon Lander rules: moons are well formed (flat pads, ×1/×2/×3), the landing limits judge touchdowns, scoring,
the flight replay matches the browser's own (static/games/lander.js run in node on the same logs: bit for bit),
fuel carries over, bad logs and too-quick flights are refused, bots land, and whole games finish.

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
        if seed % 2:
            log = L.autopilot(hh, pp, st, L.TANK0, rng.choice(["easy", "normal", "hard"]), rng)
        else:
            log, t = [], 0
            while t < L.MAX_TICKS:
                log.append([t, rng.randint(0, 5)])
                t += rng.randint(1, 40)
        fuel = L.TANK0 if seed % 2 else rng.choice([L.TANK0, 200, 50])
        res = L.fly(hh, pp, st, fuel, log)
        v = {"h": hh, "pads": pp, "start": list(st),
             "geo": {"dt": L.DT, "g": L.G, "thrust": L.THRUST, "rot": L.ROT_STEP, "kMax": L.K_MAX, "w": L.W, "seg": L.SEG,
                     "startY": L.START_Y, "ceiling": L.CEILING, "vyOk": L.VY_OK, "vxOk": L.VX_OK, "angOk": L.ANG_OK,
                     "foot": L.FOOT, "maxTicks": L.MAX_TICKS, "sin": L.SIN, "cos": L.COS}}
        cases.append({"v": v, "log": log, "fuel": fuel, "want": {k: res[k] for k in ("how", "pad", "pts", "ticks", "fuel", "k")}})
    js = r"""
globalThis.window = globalThis; globalThis.UI = {};
require(process.argv[1]);
const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let bad = [];
cases.forEach((c, n) => {
  const r = UI.lander.replay(c.v, c.log, c.fuel);
  for (const k of Object.keys(c.want)) if (r[k] !== c.want[k]) { bad.push([n, k, r[k], c.want[k]]); break; }
});
console.log(JSON.stringify(bad));
"""
    out = subprocess.run([node, "-e", js, os.path.join(ROOT, "static/games/lander.js")], input=json.dumps(cases),
                         capture_output=True, text=True, timeout=60)
    bad = json.loads(out.stdout.strip() or "null") if out.returncode == 0 else None
    check("browser replay == server replay on 40 flights", bad == [], (out.stderr.strip()[:300] if bad is None else str(bad[:3])))
    check("those flights include landings", sum(c["want"]["how"] == "land" for c in cases) >= 10)
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
check("the server judges the log", a.g.res["how"] == res["how"] and a.g.points == res["pts"], f"{a.g.res['how']} {a.g.points}")
check("fuel left is what the flight left", a.g.fuel == res["fuel"])
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

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
