"""Light Riders 👑 Leader's cost: the lone round leader starts the next round with one boost fewer
(on by default; bots ride it through the real frame()).

    python3 tests/riders_catchup.py
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


def arena(catchup, n=3):
    r = server.Room("TEST")
    for x in ("Ann", "Bo", "Cy")[:n]:
        r.add_player(x).bot = "normal"
    r.switch_game("riders")
    if catchup is not None:
        r.settings["catchup"] = catchup
    r.start()
    r.push_fast = lambda d: None
    return r, r.game


for setting, label in ((None, "default"), (True, "on"), (False, "off")):
    r, g = arena(setting)
    check(f"{label}: round 1 everyone has full boosts", g.boosts == [riders.BOOSTS] * 3)
    g.wins = [1, 0, 0]
    g.new_round(time.time())
    want = setting is not False
    check(f"{label}: lone leader {'loses' if want else 'keeps'} a boost",
          (g.boosts[0] == riders.BOOSTS - 1) == want and g.boosts[1:] == [riders.BOOSTS] * 2, g.boosts)
    check(f"{label}: callout only when on", any("leads" in e["text"] for e in r.log) == want)

r, g = arena(True)
g.wins = [1, 1, 0]
g.new_round(time.time())
check("a tie for the lead pays nothing", g.boosts == [riders.BOOSTS] * 3, g.boosts)

# bots ride a real round with a crowned leader; nothing breaks and boosts stay in range
r, g = arena(True)
g.wins = [0, 1, 0]
now = time.time()
g.new_round(now)
g.next_at = now; g.last_frame = now
for _ in range(600):
    now += 0.05
    g.frame(now)
    if r.phase != "playing":
        break
check("crowned leader starts short and bots ride on", all(0 <= b <= riders.BOOSTS for b in g.boosts), g.boosts)

print("FAILED: " + ", ".join(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
