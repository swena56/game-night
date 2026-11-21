"""Light Riders 🧱 Closing arena (off by default): after SHRINK_AFTER seconds of riding, a band of the edge
closes every SHRINK_EVERY seconds; riding into it is a crash, and bots keep out of it.

    python3 tests/riders_shrink.py
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


def arena(shrink):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo")]
    for p in ps:
        p.bot = "normal"
    r.switch_game("riders")
    if shrink is not None:
        r.settings["shrink"] = shrink
    r.settings["lives"] = 5
    r.start()
    r.push_fast = lambda *a, **k: None
    return r, r.game


def ride(r, g, secs, now=None):
    now = now or time.time()
    g.last_frame = now
    for _ in range(int(secs / 0.05)):
        now += 0.05
        g.frame(now)
        if r.phase != "playing":
            break
    return now


r, g = arena(None)
ride(r, g, 80)
check("off by default: the arena stays open", g.ring == 0)

r, g = arena(True)
g.next_at = time.time()  # skip the countdown
t = ride(r, g, riders.SHRINK_AFTER + 1)
check("on: nothing closes before the minute", g.ring <= 1, g.ring)
ride(r, g, 10, t)
check("then the band grows", g.ring >= 3 or g.round > 1, (g.ring, g.round))
check("a walled cell is deadly", g.walled(0, 0) == (g.ring > 0))

r, g = arena(False)
for player in r.players.values():
    player.bot = None
g.stage = "ride"
g.grid = bytearray(g.n * g.n)
g.trails = [[], []]
g.occupy(0, 2, 2)
g.occupy(1, 2, 4)
g.dirs = [1, 1]
player = r.players[g.seats[0]]
now = time.time()
for tick in range(riders.BRAKE_TICKS):
    g.on_input(player, {"brake": True})
    g.step(now + tick / 20)
check("brake halves movement during its fixed server window",
      len(g.trails[0]) - 1 == riders.BRAKE_TICKS // 2 and len(g.trails[1]) - 1 == riders.BRAKE_TICKS)
check("repeated presses during braking cost only one charge and do not extend it",
      g.brakes[0] == riders.BRAKES - 1 and g.braking[0] == 0)
g.step(now + riders.BRAKE_TICKS / 20)
check("normal movement resumes on the next tick", len(g.trails[0]) - 1 == riders.BRAKE_TICKS // 2 + 1)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
