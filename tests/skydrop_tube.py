#!/usr/bin/env python3
"""Sky Drop's 🌀 Tube Runner play style (report #334): movement round the wall, jumping, the course, and the free
dive left as it was.

    python3 tests/skydrop_tube.py
"""
import hashlib
import json
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402
from games import skydrop as sd, skydrop_tube as tube  # noqa: E402


def table(n=2, bot=None, **settings):
    r = server.Room("TUBE")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    for p in ps:
        p.bot = bot
    r.switch_game("skydrop")
    r.settings.update(style="runner", **settings)
    r.start()
    r.push_fast = lambda data: None
    return r, r.game, ps


# movement: on the wall, all the way round, and a jump comes back down
f = sd.Flyer(0)
f.x, f.z = tube.spot(0)
f.sx = 1.0
turned, now = 0.0, 100.0
for _ in range(90):
    before = f.angle
    now += 1 / 30
    tube.move(f, 1 / 30, now, False)
    turned += tube.turn_to(before, f.angle)
    assert abs(math.hypot(f.x, f.z) - tube.WALL) < 1e-6
assert turned > math.tau, turned          # more than once round in three seconds
f.sx = 0.0
tube.jump(f, now)
heights = []
for _ in range(45):
    now += 1 / 30
    tube.move(f, 1 / 30, now, False)
    heights.append(f.height)
assert 2.2 < max(heights) < 2.8 and heights[-1] == 0 and f.rise == 0
air = sum(1 for h in heights if h > 0) / 30
assert 0.8 < air < 1.1, air
# no double jump in the air; a press just before landing waits for the ground; stunned divers can't jump
tube.jump(f, now); tube.move(f, 1 / 30, now, False)
for _ in range(8):
    now += 1 / 30; tube.move(f, 1 / 30, now, False)
rising = f.rise
tube.jump(f, now); now += 1 / 30; tube.move(f, 1 / 30, now, False)
assert f.rise < rising
f.height, f.rise, f.jump_at = 0.0, 0.0, -9.0
tube.jump(f, now); now += 1 / 30; tube.move(f, 1 / 30, now, True)
assert f.height == 0

# the course: rings on the wall or HIGH above it, a bit of each; coins and gems in the tube; hazards on the wall
for level in (1, 4, 8):
    r, g, _ = table(level=level)
    assert g.ring_r < sd.LEVELS[level]["ring_r"] and not g.streams and not g.gusts and not g.dark and not any(g.drifts)
    hs = [tube.polar(x, z)[1] for _, x, z, _ in g.rings]
    assert all(abs(h) < .02 or abs(h - tube.HIGH) < .02 for h in hs)
    high = sum(h > 1 for h in hs)
    assert 3 <= high <= len(hs) * .75, (level, high, len(hs))
    assert tube.HIGH > g.ring_r                       # so a floating ring can't be taken from the wall
    angles = [tube.polar(x, z)[0] for _, x, z, _ in g.rings]
    assert all(abs(tube.turn_to(a, b)) <= tube.MAX_TURN + .02 for a, b in zip(angles, angles[1:]))
    assert g.hazards and all(abs(tube.polar(x, z)[1]) < .02 for _, x, z, _, _ in g.hazards)
    assert all(math.hypot(x, z) <= tube.WALL + .01 for _, x, z, _ in g.coins)
    assert g.view(r.players[g.seats[0]])["skydrop"]["style"] == "runner"
r, g, _ = table(hazards=False)
assert not g.hazards

# the jump comes from the player's input, only while racing
r, g, (a, b) = table()
i = g.seat(a)
g.on_input(a, {"jump": True})
assert g.flyers[i].jump_at < 0
g.stage = "race"
g.on_input(a, {"jump": True, "sx": 0.5})
assert g.flyers[i].jump_at > 0 and g.flyers[i].sx == 0.5
now = time.time()
g.last = now
for _ in range(10):
    now += 1 / 30
    g.simulate(1 / 30, now)
assert g.flyers[i].height > 1.5 and g.flyers[g.seat(b)].height == 0

# bots: whole runs finish, and a harder bot threads more rings
share = {}
for level in ("easy", "normal", "hard"):
    got = []
    for seed in range(3):
        random.seed(seed)
        r, g, _ = table(2, level, level=3)
        now = g.last
        while g.stage != "results":
            now += 1 / 30
            g.frame(now)
        assert all(f.depth > 600 for f in g.flyers)
        got += [f.rings / len(g.rings) for f in g.flyers]
    share[level] = sum(got) / len(got)
assert .2 < share["easy"] < share["normal"] < share["hard"] and share["hard"] > .7, share

# the free dive is as it was, and keeps its high-score board; the tube has its own
keys = {}
for style in ("dive", "runner"):
    r = server.Room("KEY")
    r.add_player("Ann")
    r.add_player("Bo")
    r.switch_game("skydrop")
    r.settings["style"] = style
    r.start()
    keys[style] = r.round_record
    if style == "dive":
        assert r.game.streams and r.game.flyers[0].z == 0.0
assert "Play style" not in keys["dive"]["label"] and "Tube Runner" in keys["runner"]["label"]
old = {"course": "spire", "hazards": True, "level": 1, "runs": 1}
assert keys["dive"]["key"] == hashlib.sha256(json.dumps(["skydrop", keys["dive"]["kind"], old, 0, ["human", "human"]], sort_keys=True).encode()).hexdigest()[:24]
print("sky drop tube runner OK", {k: f"{v:.0%}" for k, v in share.items()})
