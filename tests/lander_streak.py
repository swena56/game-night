"""Moon Lander 🔥 landing streak: each landing in a row after the first adds +5 (up to +15); a crash resets it.

    python3 tests/lander_streak.py
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import lander as L  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


random.seed(5)
r = server.Room("TEST")
a, b = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("lander")
r.start()
g = r.game
with r.cond:
    g.on_timeout(g.t0 + 0.01)
for tries in range(30):
    log = L.autopilot(g.h, g.pads, g.start_xv, b.g.tank, "hard", random.Random(tries))
    res = L.fly(g.h, g.pads, g.start_xv, b.g.tank, log, picks=g.picks)
    if res["how"] == "land":
        break
base = dict(res)
import re
bonus = []
for k in range(5):
    b.g.res = None
    g.done(b, dict(base), time.time())
    m = [re.search(r"streak \+(\d+)", w) for w in b.g.res["words"]]
    bonus.append(next((int(x.group(1)) for x in m if x), 0))
check("the first landing has no streak bonus", bonus[0] == 0 and b.g.streak == 5, bonus)
check("bonus climbs +5 a landing", bonus[1:4] == [5, 10, 15], bonus)
check("and caps at +15", bonus[4] == 15, bonus)
crash = dict(base, how="crash", pts=0, words=[])
b.g.res = None
g.done(b, crash, time.time())
check("a crash resets the streak", b.g.streak == 0)
sys.exit(1 if fails else 0)
