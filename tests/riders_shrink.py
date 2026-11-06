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

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
