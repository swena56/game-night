"""Air Hockey 💥 Bank shots count double (on by default): a goal after a wall bounce is worth 2, capped at the
target; a straight goal is 1; off turns it back to 1; bots still play legal frames.

    python3 tests/hockey_bank.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def rink(bank=None):
    r = server.Room("TEST")
    r.add_player("Ann")
    r.add_player("Bo")
    r.switch_game("hockey")
    if bank is not None:
        r.settings["bank"] = bank
    r.start()
    return r, r.game


def goal(g, banked, scorer=0):
    g.pucks[0].banked = banked
    with g.room.cond:
        g.goal(scorer, 0, time.time())


r, g = rink()
goal(g, 1)
check("bank shot is worth 2", g.score == [2, 0], g.score)
goal(g, 0)
check("straight goal is worth 1", g.score == [3, 0], g.score)
goal(g, 3)
check("capped at the target, game ends on 5", g.score == [5, 0], g.score)
r, g = rink(False)
goal(g, 2)
check("off: bank shot is 1", g.score == [1, 0], g.score)
r, g = rink(True)
g.score = [0, 4]
goal(g, 1, 1)
check("win by bank shot caps at 5", g.score == [0, 5], g.score)

# bots: run frames and make sure their targets stay inside their half (legal)
r, g = rink()
for p in r.players.values():
    p.bot = "hard"
now = time.time() + 5
for k in range(300):
    now += 0.016
    with r.cond:
        g.frame(now)
for i in range(2):
    x, y = g.targets[i]
    lo, hi = (0.8, 1.6) if i == 0 else (0, 0.8)
    check(f"bot {i} target inside its half", 0 <= x <= 1 and lo <= y <= hi, (x, y))
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
