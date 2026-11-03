"""Billiards shot engine checks: spin, cushions, pockets, throw, tunnelling, the bot's aim, and that the
browser's aim-guide copy of the engine (predict() in static/games/billiards.js) agrees with the server's.

    python3 tests/billiards_physics.py        # a few seconds; the guide check needs Node.js, else it is skipped
"""
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import billiards as b  # noqa: E402

R = b.R
fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def shot(pos, angle, speed, **kw):
    holes = {}
    final, sunk, first, frames = b.simulate(pos, angle, speed, holes=holes, **kw)
    return final, sunk, first, frames, holes


# ---------- spin: stun, draw, follow on a full hit from close range
for name, spin, test in (("stun stops dead", 0, lambda x: abs(x - 89.8) < 1.5),
                         ("draw pulls back", -1, lambda x: x < 75),
                         ("follow runs on", 1, lambda x: x > 105)):
    final = shot({0: (60, 50), 1: (90, 50)}, 0, 150, spin=spin)[0]
    check(name, test(final[0][0]), f"cue ball ends at x={final[0][0]:.1f}, object ball was at 90")

# a centre-ball hit from far away has started rolling, so it follows through
final = shot({0: (20, 50), 1: (120, 50)}, 0, 200)[0]
check("a long stun shot rolls through", final[0][0] > 125, f"x={final[0][0]:.1f}")

# ---------- english: right english straight into the right rail comes off to the ball's own right (−y)
final = shot({0: (100, 50)}, 0, 200, side=1)[0]
check("right english bends off the rail", final[0][1] < 40, f"y={final[0][1]:.1f}")
final = shot({0: (100, 50)}, 0, 200, side=-1)[0]
check("left english bends the other way", final[0][1] > 60, f"y={final[0][1]:.1f}")

# ---------- cushions: a rolling ball comes off still rolling; a soft hit keeps more speed than a hard one
ball = [190.0, 50.0, 100.0, 0.0, 100.0, 0.0, 0.0]
b.rail(ball, 1.0, 0.0)
check("rolling into a cushion, rolling out", abs(ball[2] - ball[4]) < 1e-9 and ball[2] < 0, f"v={ball[2]:.1f} s={ball[4]:.1f}")
check("soft hits bounce more", b.cushion_e(50) > b.cushion_e(400), f"{b.cushion_e(50):.2f} vs {b.cushion_e(400):.2f}")

# ---------- the cushion line is closed: every edge starts where the last one ended, or across a hole
E = b.EDGES
gaps = [i for i in range(len(E)) if math.hypot(E[i][2] - E[(i + 1) % len(E)][0], E[i][3] - E[(i + 1) % len(E)][1]) > 1e-6]
across = all(any(math.hypot(E[i][2] - px, E[i][3] - py) <= cap + 1e-3 for px, py, cap in b.POCKETS) for i in gaps)
check("cushion line closed apart from the six holes", len(gaps) == 6 and across, f"{len(gaps)} gaps")

# ---------- pockets: straight in drops at any pace; a slanted entry off line rattles out
saved = b.MAX_STEPS
b.MAX_STEPS = 240
for v in (150, 500):
    holes = shot({0: (28, 28)}, math.atan2(-28, -28), v)[4]
    check(f"straight into a corner drops (v={v})", holes.get(0) == 0)
start = (100 + 40 * math.cos(math.radians(25)), -0.8 + 40 * math.sin(math.radians(25)))
base, dist = math.atan2(-0.8 - start[1], 100 - start[0]), 40
holes = shot({0: start}, base + math.atan2(-2, dist), 150)[4]
check("a shallow side-pocket shot on the near side drops", holes.get(0) == 1)
holes = shot({0: start}, base + math.atan2(3, dist), 150)[4]
check("a shallow side-pocket shot on the far side hits the jaw", holes.get(0) != 1)
b.MAX_STEPS = saved

# ---------- ball to ball: true contact angles, a little throw, no tunnelling
for cut in (30, 60):
    t = (100.0, 50.0)
    u = (math.cos(math.radians(-cut)), math.sin(math.radians(-cut)))
    c = (60.0, t[1] - u[1] * 2 * R)
    frames = shot({0: c, 1: t}, 0, 300)[3]
    moved = [(f[2], f[3]) for f in frames if f[2] != -1 and math.hypot(f[2] - t[0] * 10, f[3] - t[1] * 10) > 15]
    left = math.degrees(math.atan2(moved[0][1] - t[1] * 10, moved[0][0] - t[0] * 10))
    throw = left + cut  # the object ball is dragged toward the cue ball's line: a thinner cut than aimed
    check(f"{cut}° cut throws the object ball 1–5°", 1 <= throw <= 5.5, f"left at {left:.1f}°")
# slow cuts throw more than hard ones (the balls grip better when their surfaces slip slowly)
def throw_at(cut, speed):
    t = (100.0, 50.0)
    u = (math.cos(math.radians(-cut)), math.sin(math.radians(-cut)))
    frames = shot({0: (t[0] - 12, t[1] - u[1] * 2 * R), 1: t}, 0, speed)[3]  # close: still skidding (a stun)
    moved = [(f[2], f[3]) for f in frames if f[2] != -1 and math.hypot(f[2] - t[0] * 10, f[3] - t[1] * 10) > 60]
    return math.degrees(math.atan2(moved[0][1] - t[1] * 10, moved[0][0] - t[0] * 10)) + cut


slow, fast = throw_at(30, 100), throw_at(30, 500)
check("a soft stun cut throws more than a hard one", slow > fast + 1 and 2.5 < slow < 6, f"{slow:.1f}° vs {fast:.1f}°")
# squirt: right english pushes the cue ball left of the aim (−y heading +x), about 2°
final = shot({0: (30, 50)}, 0, 120, side=1)[0]
check("right english squirts the cue ball left", 47 < final[0][1] < 49.6, f"y={final[0][1]:.2f} after {final[0][0] - 30:.0f} units")
final = shot({0: (30, 50)}, 0, 120, side=-1)[0]
check("left english squirts it right", 50.4 < final[0][1] < 53, f"y={final[0][1]:.2f}")
# english wears off at a steady rate, not ever more slowly
ball = [100.0, 50.0, 50.0, 0.0, 50.0, 0.0, 100.0]
for _ in range(30):
    b.cloth(ball, 1 / 120)
check("english wears off steadily", abs(ball[6] - (100 - b.SIDE_DECAY * 30 / 120)) < 1e-6, f"{ball[6]:.1f} left")
check("a fast ball grazing another hits it", shot({0: (20, 50), 1: (60, 54.5)}, 0, 520)[2] == 1)
check("a fast ball just missing another misses", shot({0: (20, 50), 1: (60, 54.7)}, 0, 520)[2] is None)

# ---------- the bot's aim allows for throw: it pots most cut shots into one corner, on either cloth
g = b.Billiards.__new__(b.Billiards)
for cloth in ("classic", "fast"):
    g.s = {"cloth": cloth}
    fric, top = g.table
    rng, made, tried = random.Random(7), 0, 0
    b.MAX_STEPS = 360
    for _ in range(30):
        t = (rng.uniform(25, 90), rng.uniform(15, 85))
        c = (rng.uniform(t[0] + 15, 180), rng.uniform(10, 90))
        g.pos = {0: c, 1: t}
        cands = [x for x in g.candidates(*c, [1]) if x[3] == 0]
        if cands:
            _, ang, power, _ = cands[0]
            tried += 1
            made += shot({0: c, 1: t}, ang, b.MIN_SPEED + (top - b.MIN_SPEED) * power, friction=fric)[4].get(1) == 0
    b.MAX_STEPS = saved
    check(f"the bot pots most cut shots ({cloth} cloth)", tried >= 15 and made >= 0.75 * tried, f"{made} of {tried}")


# ---------- the fast cloth: the same power rolls much further
def rolled(cloth, power=None, speed=None):
    fric, top = b.CLOTHS[cloth]
    speed = speed or b.MIN_SPEED + (top - b.MIN_SPEED) * power
    frames = shot({0: (40, 50)}, 0.0, speed, friction=fric)[3]  # along the centre line: no pocket
    pts = [(f[0] / 10, f[1] / 10) for f in frames if f[0] != -1]
    return sum(math.hypot(x2 - x1, y2 - y1) for (x1, y1), (x2, y2) in zip(pts, pts[1:]))


# its top speed is lower (so the power bar stays usable), so the same power rolls a bit further, and
# a ball going at the same speed rolls far further
for power in (0.15, 0.4):
    slow, fast = rolled("classic", power), rolled("fast", power)
    check(f"fast cloth rolls further at {power:.0%} power", fast > 1.3 * slow, f"{slow:.0f} vs {fast:.0f} units")
slow, fast = rolled("classic", speed=150), rolled("fast", speed=150)
check("fast cloth: a ball at the same speed rolls far further", fast > 2.5 * slow, f"{slow:.0f} vs {fast:.0f} units")
check("fast cloth: a soft shot still stays on the table", rolled("fast", 0.05) < 120, f"{rolled('fast', 0.05):.0f} units at 5%")

# ---------- speed: a full-power break simulates quickly
pos = b.rack(random.Random(1))
pos[0] = (b.HEAD_X, b.TH / 2)
t0 = time.process_time()  # CPU time: other busy processes on this machine don't count
shot(pos, math.atan2(b.FOOT[1] - b.TH / 2, b.FOOT[0] - b.HEAD_X), b.MAX_SPEED)
check("a break simulates in under half a second", time.process_time() - t0 < 0.5, f"{time.process_time() - t0:.3f}s of CPU")


# ---------- the aim guide's engine agrees with the server's
def guide_check():
    node = shutil.which("node")
    if not node:
        print("skip the aim guide check (no Node.js)")
        return
    src = open(os.path.join(ROOT, "static", "games", "billiards.js")).read()
    m = re.search(r"\n  const OBJ_LEN.*?\n  function predict\(cue\) \{.*?\n  \}\n", src, re.S)
    if not m:
        check("found predict() in billiards.js", False)
        return
    shots = [  # (cue ball, object ball, aim angle, power, spin, english, a break? / "fast" cloth)
        ((60, 50), (100, 53), 0.0, 0.4, 0, 0, False), ((60, 50), (100, 47), 0.0, 0.6, 1, 0, False),
        ((40, 30), (120, 60), math.atan2(28, 80), 0.5, -1, 0.5, False), ((150, 80), (60, 20), math.atan2(-58.2, -90), 0.7, 0.3, -1, False),
        ((50, 50), (100, 52), 0.0, 1.0, 0, 0, True),  # the break: its own top speed and cloth
        ((60, 50), (100, 47), 0.0, 0.5, 1, 0, "fast"), ((40, 30), (120, 60), math.atan2(28, 80), 0.6, -1, 0.5, "fast"),
    ]
    cases, every = [], b.FRAME_EVERY
    b.FRAME_EVERY = 1  # record every step, so curved (spin) paths are compared closely
    for cue, obj, ang, power, spin, side, brk in shots:
        top, fric = (b.BREAK_MAX_SPEED, b.BREAK_FRICTION) if brk is True else b.CLOTHS["fast"][::-1] if brk else (b.MAX_SPEED, b.FRICTION)
        speed = b.MIN_SPEED + (top - b.MIN_SPEED) * power
        _, _, first, frames, _ = shot({0: cue, 1: obj}, ang, speed, spin=spin, side=side, friction=fric)
        cases.append({"cue": cue, "obj": obj, "aim": ang, "power": power, "spin": spin, "english": side,
                      "breaking": brk is True, "friction": fric if brk is not True else b.FRICTION,
                      "maxSpeed": top if brk is not True else b.MAX_SPEED, "first": first, "frames": frames})
    b.FRAME_EVERY = every
    phys = {"slide": b.SLIDE, "bounce": b.BOUNCE, "railGrip": b.RAIL_GRIP, "tipK": b.TIP_K, "sideTip": b.SIDE_TIP,
            "sideDecay": b.SIDE_DECAY, "dt": b.DT, "stop": b.STOP, "throw": b.THROW, "throwSlow": b.THROW_SLOW,
            "throwV": b.THROW_V, "squirt": b.SQUIRT, "cushionSoft": b.CUSHION_SOFT,
            "cushionHard": b.CUSHION_HARD, "cushionV": b.CUSHION_V, "near": b.NEAR_EDGE}
    table = {"W": b.TW, "H": b.TH, "R": R, "pockets": [list(p) for p in b.POCKETS], "edges": [list(e) for e in b.EDGES],
             "friction": b.FRICTION, "minSpeed": b.MIN_SPEED, "maxSpeed": b.MAX_SPEED, "phys": phys,
             "breakFriction": b.BREAK_FRICTION, "breakMaxSpeed": b.BREAK_MAX_SPEED}
    js = f"""
let aim = 0, power = 0, spin = 0, english = 0, TABLE = {json.dumps(table)}, CUR = null;
const B = () => CUR;
{m.group(0)}
const out = [];
for (const c of {json.dumps(cases)}) {{
  aim = c.aim; power = c.power; spin = c.spin; english = c.english; predKey = '';
  CUR = Object.assign({{}}, TABLE, {{ balls: [[1, c.obj[0], c.obj[1]]], breaking: c.breaking, friction: c.friction, maxSpeed: c.maxSpeed }});
  const p = predict(c.cue);
  out.push(p && p.obj ? {{ obj: p.obj.pts, cue: p.cue.pts }} : null);
}}
console.log(JSON.stringify(out));
"""
    d = tempfile.mkdtemp()
    try:
        f = os.path.join(d, "guide.js")
        open(f, "w").write(js)
        res = subprocess.run([node, f], capture_output=True, text=True, timeout=60)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    if res.returncode:
        check("the aim guide's engine runs", False, res.stderr.strip()[-300:])
        return
    for i, (case, pred) in enumerate(zip(cases, json.loads(res.stdout))):
        if case["first"] != 1 or not pred:
            check(f"guide shot {i + 1}: both engines see the hit", case["first"] == 1 and bool(pred))
            continue
        # every point the guide drew lies on the server's path
        worst = 0.0
        for k, pts in ((2, pred["obj"]), (0, pred["cue"])):
            path = [(f[k] / 10, f[k + 1] / 10) for f in case["frames"] if f[k] != -1]
            segs = list(zip(path, path[1:]))
            # (the cue ball's first point is the moment of contact, mid-step, where its recorded path
            # turns a corner; the corner itself isn't recorded)
            for x, y in pts[1:] if k == 0 else pts:
                worst = max(worst, min(seg_dist(x, y, *a, *bb) for a, bb in segs) if segs else 0)
        check(f"guide shot {i + 1} follows the server's path", worst < 0.3, f"off by up to {worst:.2f}")


def seg_dist(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if not L2 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
    return math.hypot(ax + t * dx - x, ay + t * dy - y)


# ---------- the break: its livelier cloth and top speed pot a ball on about half of all breaks
def break_check():
    for nine in (False, True):
        pots = scratches = 0
        for seed in range(40):
            rng = random.Random(seed)
            pos = b.rack9(rng) if nine else b.rack(rng)
            y = b.TH / 2 + rng.uniform(-6, 6)
            pos[0] = (b.HEAD_X, y)
            ang = math.atan2(b.FOOT[1] - y, b.FOOT[0] - b.HEAD_X) + rng.gauss(0, 0.004)
            _, sunk, _, _ = b.simulate(pos, ang, b.BREAK_MAX_SPEED, record=False, friction=b.BREAK_FRICTION)
            pots += any(n for n in sunk)
            scratches += 0 in sunk
        game = "9-ball" if nine else "8-ball"
        check(f"{game} breaks pot a ball often", 10 <= pots <= 30, f"{pots}/40")
        check(f"{game} breaks rarely scratch", scratches <= 6, f"{scratches}/40")


break_check()
guide_check()
print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
