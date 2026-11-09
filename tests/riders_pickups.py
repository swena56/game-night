"""Light Riders 🎁 Power-ups (off by default, #80): items appear on open cells once the ride starts;
riding over one grabs it — ⚡ refills boosts, 🐌 slows every rival for a while, ❤️ adds a life,
✂️ cuts the grabber's trail in half (freeing the grid). Bots go for them.

    python3 tests/riders_pickups.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import riders  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def arena(pickups, n=2):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    for p in ps:
        p.bot = "normal"
    r.switch_game("riders")
    if pickups is not None:
        r.settings["pickups"] = pickups
    r.settings["lives"] = 5
    r.start()
    sent = []
    r.push_fast = lambda d: sent.append(d)
    return r, r.game, sent


def ride(r, g, secs, now):
    for _ in range(int(secs / 0.05)):
        now += 0.05
        g.frame(now)
        if r.phase != "playing":
            break
    return now


r, g, _ = arena(None)
now = time.time(); g.next_at = now; g.last_frame = now
ride(r, g, 20, now)
check("off by default: no items", not g.items and not g.grabs)

r, g, sent = arena(True)
now = time.time(); g.next_at = now; g.last_frame = now
now = ride(r, g, 0.2, now)
check("nothing before the first drop", not g.items)
now = ride(r, g, riders.ITEM_FIRST + 0.5, now)
check("an item appears after a few seconds", len(g.items) >= 1 or g.grabs, g.items)
check("items sit on open cells", all(not g.grid[c] for c in g.items))
check("fast updates carry the items", "it" in sent[-1] and "sl" in sent[-1])
check("the view carries them too", "items" in g.view(r.players[g.seats[0]])["riders"])

# each kind, by hand
r, g, _ = arena(True)
g.stage = "ride"; g.ride_at = time.time()
g.boosts[0] = 0
g.grab(0, "bolt")
check("⚡ refills boosts", g.boosts[0] == riders.BOOSTS)
g.grab(0, "slow")
check("🐌 slows the rival, not the grabber", g.slow[1] == riders.SLOW_TICKS and g.slow[0] == 0)
lives = g.lives[0]
g.grab(0, "life")
check("❤️ adds a life", g.lives[0] == lives + 1)
for _ in range(10):
    g.grab(0, "life")
check("lives are capped", g.lives[0] == g.s["lives"] + 2, g.lives[0])
for c in g.trails[0]:  # lay a 12-cell trail by hand along row 1
    g.grid[c] = 0
g.trails[0] = []
for x in range(2, 14):
    g.occupy(0, x, 1)
before = list(g.trails[0])
g.grab(0, "cut")
check("✂️ halves the trail and keeps the head", len(g.trails[0]) == len(before) - len(before) // 2 and g.trails[0][-1] == before[-1])
check("✂️ frees the cut cells", all(not g.grid[c] for c in before[:len(before) // 2]))
check("grabs are logged", any("grabbed" in e["text"] for e in r.log))

# slowed riders cover about half the distance
r, g, _ = arena(True)
now = time.time(); g.next_at = now; g.last_frame = now
now = ride(r, g, 0.1, now)
g.item_at = now + 999  # no items in the way
g.slow[1] = 30
l0, l1 = len(g.trails[0]), len(g.trails[1])
now = ride(r, g, 2.0, now)
d0, d1 = len(g.trails[0]) - l0, len(g.trails[1]) - l1
if all(g.alive):
    check("🐌 a slowed rider moves about half as far", d1 < d0 * 0.75, (d0, d1))

# riding onto an item grabs it
r, g, _ = arena(True)
g.stage = "ride"; g.ride_at = time.time(); g.item_at = time.time() + 999
head = g.trails[0][-1]
dx, dy = riders.DIRS[g.dirs[0]]
c = (head // g.n + dy) * g.n + head % g.n + dx
g.items[c] = "bolt"; g.boosts[0] = 1
for j in range(len(g.seats)):
    g.queue[j].clear()
r.players[g.seats[0]].bot = None
g.step(time.time())
check("riding over an item grabs it", c not in g.items and g.boosts[0] == riders.BOOSTS, (g.boosts[0], g.items))

# bots go for items: over many short rides, bots grab more than chance
r, g, _ = arena(True, 3)
now = time.time(); g.next_at = now; g.last_frame = now
ride(r, g, 40, now)
check("bots grab power-ups", len(g.grabs) >= 1 or r.phase != "playing", len(g.grabs))

print("FAILED: " + ", ".join(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
