"""How Orb Snakes plays: not a pass/fail test, a table to compare rules before changing a default.

    python3 tests/riders_balance.py [matches] [NAME=value ...]      e.g.  48 CRASH_KEEP=0 SHIELD=0

Each match seats an easy, a normal and a hard snake and a stand-in for an average person: it steers like a normal
bot but only every other tick (a person's reactions), and gets a person's rules (the last moment, and the
bots-only limit once it is out). Seats are rotated. NAME=value sets a constant in games/riders.py; goal=60 and
the like set a room setting. The clock is simulated.
"""
import collections
import itertools
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import riders  # noqa: E402

LEVELS = ("easy", "normal", "hard")
matches = int(sys.argv[1]) if len(sys.argv) > 1 else 48
settings = {"target": 3}
for arg in sys.argv[2:]:
    name, value = arg.split("=")
    if name.isupper():
        assert hasattr(riders, name), name
        setattr(riders, name, float(value) if "." in value else int(value))
    else:
        settings[name] = int(value)

wins, secs, ends = collections.Counter(), [], collections.Counter()
alive_for, longest = collections.defaultdict(list), []
orders = list(itertools.permutations(LEVELS))
for m in range(matches):
    random.seed(m)
    r = server.Room("TEST")
    seats = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "You")]
    r.switch_game("snake")
    r.settings.update(settings)
    r.push_fast = lambda d: None
    r.start()
    g = r.game
    g.rng.seed(m)
    for p, level in zip(seats, orders[m % 6]):
        p.bot = level
    me = g.seats.index(seats[3].id)
    kind = {i: r.players[pid].bot or "average player" for i, pid in enumerate(g.seats)}
    step = g.step

    def stepped(now, g=g, me=me, step=step):
        if g.alive[me] and g.tick % 2 == 0:
            g.snake_steer(me, "normal")
        return step(now)
    g.step = stepped
    now = time.time()
    g.next_at = g.last_frame = now
    began, k, out_at, top = now, 0, None, 0
    while r.phase == "playing" and k < 300000:
        k, now = k + 1, now + 0.05
        was = g.stage
        g.frame(now)
        if was != "ride" and g.stage == "ride":
            began, out_at, top = now, None, 0
        if g.stage == "ride":
            top = max(top, max(g.size))
            if out_at is None and not g.lives[me]:
                out_at = now - began
        if was == "ride" and g.stage != "ride":
            secs.append(now - began)
            longest.append(top)
            alive_for["average player"].append(out_at if out_at is not None else now - began)
            won = g.won if g.won is not None else -1
            wins[kind[won] if won >= 0 else "draw"] += 1
            left = sum(g.alive[i] or g.respawn_at[i] is not None for i in range(4))
            ends["goal" if g.goal and won >= 0 and g.size[won] >= g.goal else "last alive" if left <= 1 else "bots-only or stall limit"] += 1


def mid(v):
    return sorted(v)[len(v) // 2]


total = len(secs)
print(" ".join(sys.argv[2:]) or "(defaults)", f"| {total} rounds")
print("  round wins  " + "  ".join(f"{k} {100 * wins[k] / total:.0f}%" for k in ("easy", "normal", "hard", "average player", "draw")))
print(f"  round length median {mid(secs):.0f}s, longest {max(secs):.0f}s | average player in play {mid(alive_for['average player']):.0f}s (median) | longest snake {mid(longest)} (median), {max(longest)}")
print("  ended: " + ", ".join(f"{k} {100 * v / total:.0f}%" for k, v in ends.most_common()))
