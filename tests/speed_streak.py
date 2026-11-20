"""Speed 🔥 Streak: 3 plays in a row (rival silent) shed a bonus stock card; off, nothing; old pickles load.

    python3 tests/speed_streak.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import speed  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def make(streak=None):
    r = server.Room("TEST")
    r.add_player("Ann")
    r.add_player("Bo")
    r.switch_game("speed")
    if streak is not None:
        r.settings["streak"] = streak
    r.start()
    g = r.game
    g.piles = [["5S"], ["9H"]]
    g.hand[0] = ["6D", "7C", "8H", "KH", "3C"]
    g.stock[0] = ["2D"] * 6
    g.next_at = None
    return r, g


r, g = make()
check("on by default", g.s["streak"] is True)
n = len(g.stock[0])
g.play(0, "6D", 0)
g.play(0, "7C", 0)
check("two plays: no bonus yet", len(g.stock[0]) == n - 2 and g.streak[0] == 2)
g.play(0, "8H", 0)
check("third in a row sheds a bonus card", len(g.stock[0]) == n - 4, len(g.stock[0]))
check("streak resets", g.streak == [0, 0])
check("callout logged", any("3 in a row" in str(l) for l in r.log))

r, g = make()
g.hand[1] = ["4S", "5H"]
g.play(0, "6D", 0)
g.play(0, "7C", 0)
g.play(1, "4S", 0) if speed.fits("4S", g.piles[0][-1]) else g.play(1, "5H", 1) if speed.fits("5H", g.piles[1][-1]) else None
g.play(0, "8H", 0) if speed.fits("8H", g.piles[0][-1]) else None
check("rival play breaks the streak", g.streak[1] <= 1 and g.streak[0] <= 1)

r, g = make(False)
n = len(g.stock[0])
for c in ("6D", "7C", "8H"):
    g.play(0, c, 0)
check("off: no bonus", len(g.stock[0]) == n - 3)
check("view flag", g.view(r.players[g.seats[0]])["speed"]["streak"] is False)

# an old pickled object (no streak attr) still plays
r, g = make()
del g.__dict__["streak"]
check("old object has class default", g.streak == (0, 0))
for c in ("6D", "7C", "8H"):
    g.play(0, c, 0)
g2 = pickle.loads(pickle.dumps(r)).game
check("pickle round trip", g2.streak == g.streak and g2.stock == g.stock)

# bots play whole rounds through the real path, every play legal
for lvl in ("easy", "hard"):
    r = server.Room("TEST")
    for n in ("Ann", "Bot"):
        r.add_player(n).bot = lvl
    r.switch_game("speed")
    r.start()
    g = r.game
    steps = 0
    while r.phase == "playing" and steps < 3000:
        steps += 1
        g.skew += 3
        if g.bot_ready():
            g.bot_tick()
    check(f"{lvl} bots finish a match", r.phase != "playing", f"{steps} steps")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
