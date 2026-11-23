"""Fuse Frenzy 🎁 pickups: items appear (max two), touching one grants a shield or speed boost, a shield soaks one tag
(then the carrier can't retry for a moment), a boost speeds a runner, a new round clears them, bots stay legal.

    python3 tests/fuse_items.py
"""
import json
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import fuse as F  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")]
r.switch_game("fuse")
r.start()
g = r.game
g.rng = random.Random(7)
g.carrier = 0
said = []
g.moment = lambda text, *a, **k: said.append(text)
now = g.paused_until + 1
g.next_item = now - 1
g.pickups(now)
check("an item appears when due", len(g.items) == 1, g.items)
for k in range(5):
    g.next_item = now - 1
    g.pickups(now)
check("never more than two on the floor", len(g.items) == F.ITEM_MAX, g.items)

# take a shield (nothing else is due to spawn)
g.next_item = now + 100
runner = next(i for i in range(3) if i != g.carrier)
g.items = [[g.pos[runner][0], g.pos[runner][1], "shield"]]
g.pickups(now)
check("touching a shield grants it", g.shield[runner] and not g.items)
# the carrier tags that runner: blocked, no handover
c = g.carrier
g.pos[c] = [g.pos[runner][0] - 0.05, g.pos[runner][1]]
g.immune = [0.0] * 3
g.tag(now)
check("the shield soaks the tag", g.carrier == c and not g.shield[runner] and any("blocks" in t for t in said), said)
check("and the carrier can't retry straight away", g.immune[runner] > now)
g.tag(now + 0.1)
check("still blocked during the grace", g.carrier == c)
g.tag(now + 2)
check("after the grace the tag lands", g.carrier == runner)

# Keep the other runners out of pickup range after the tag test.
g.pos[c] = [0.5, 1.0]
g.pos[runner] = [0.5, 0.3]
g.pos[next(i for i in range(3) if i not in (c, runner))] = [0.1, 0.1]

# a boost speeds a runner
g.items = [[g.pos[c][0], g.pos[c][1], "boost"]]
g.carrier = runner
g.pickups(now)
check("touching a boost starts it", g.boost_until[c] > now)
g.target[c] = [g.pos[c][0], 0.1]
g.pos[c] = [0.5, 1.0]
y0 = g.pos[c][1]
g.dash_until[c] = 0
g.move(c, 0.1, now)
boosted = y0 - g.pos[c][1]
g.boost_until[c] = 0
g.pos[c] = [0.5, 1.0]
g.move(c, 0.1, now)
check("a boosted runner covers more ground", boosted > (y0 - g.pos[c][1]) * 1.2, (boosted, y0 - g.pos[c][1]))

# Directional input uses both axes at a capped speed and release stops immediately.
p = r.players[g.seats[c]]
g.pos[c] = [0.5, 0.5]
g.on_input(p, {"dx": 1, "dy": -1})
g.move(c, 0.1, now)
dx, dy = g.pos[c][0] - 0.5, 0.5 - g.pos[c][1]
check("diagonal steering is capped", dx > 0 and abs(dx - dy) < 1e-8 and abs((dx ** 2 + dy ** 2) ** 0.5 - F.SPEED * 0.1) < 1e-8)
g.on_input(p, {"dx": 0, "dy": 0})
before = g.pos[c][:]
g.move(c, 0.1, now)
check("releasing the stick stops the runner", g.pos[c] == before)
g.paused_until = 0
g.on_input(p, {"dx": -1, "dy": 0, "dash": True})
g.move(c, 0.1, g.dash_until[c] - 0.01)
check("dash uses the current direction", abs(before[0] - g.pos[c][0] - 0.1 * F.DASH_SPEED) < 1e-8 and g.pos[c][1] == before[1])

# a new round clears everything
g.shield = [True] * 3
g.items = [[0.5, 0.5, "boost"]]
g.new_round(now)
check("a new round clears items and shields", not g.items and not any(g.shield) and not any(g.boost_until))
check("a new round clears steering", g.steer == [None] * len(ps))
check("the view carries them", "it" in g.view(ps[0])["fuse"] and "sh" in g.view(ps[0])["fuse"])

# The ready countdown leaves the whole fuse available, and the walls begin closing halfway in.
check("ready snapshot shows the full fuse", g.snapshot(now)["f"] == round(g.fuse_len, 2))
g.next_item = g.fuse_end + 1
middle = g.paused_until + g.fuse_len / 2
with r.cond:
    g.frame(middle - 0.02)
    g.frame(middle)
    check("the arena stays open through halfway", abs(g.inset) < 1e-8)
    g.pos = [[F.R, F.R], [F.R, F.R], [F.W - F.R, F.H - F.R]]
    g.target = [p[:] for p in g.pos]
    g.items = [[0.15, 0.15, "shield"], [0.5, 0.65, "boost"]]
    late = middle + g.fuse_len / 4
    g.frame(late)
    check("walls close progressively", abs(g.inset - F.MAX_INSET / 2) < 1e-7)
    edge = F.R + g.inset
    check("stationary and overlapping runners stay inside the walls",
          all(edge <= x <= F.W - edge and edge <= y <= F.H - edge for x, y in g.pos))
    check("items overtaken by the walls disappear", g.items == [[0.5, 0.65, "boost"]])
    g.broadcast(late)
    check("fast and full snapshots agree on the boundary", json.loads(r.fast)["edge"] == g.view(ps[0])["fuse"]["edge"])

    # At expiry the carrier is out even if the two runners are already touching.
    carrier = g.carrier
    g.pos = [[0.5, 0.65] for _ in ps]
    passes = g.passes[:]
    g.frame(g.fuse_end)
    check("an expired fuse cannot be handed off", not g.alive[carrier] and g.passes == passes)
    state = json.loads(r.fast)
    check("the next round immediately streams open walls and the elimination",
          state["edge"] == 0 and state["rd"] == g.round and not state["a"][carrier])
    g.s["arena"] = "classic"
    late = g.fuse_end - 0.01
    g.frame(late)
    check("Classic keeps its full arena through expiry", g.inset == 0)
    g.frame(g.fuse_end)
    check("the final elimination ends the match with one survivor", r.phase == "over" and sum(g.alive) == 1)
sys.exit(1 if fails else 0)
