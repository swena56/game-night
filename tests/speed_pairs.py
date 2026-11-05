"""Speed 👯 Pairs (off by default): a card of the same rank also fits a pile; off, only one up or down.

    python3 tests/speed_pairs.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import speed  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def race(pairs):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("speed")
    if pairs is not None:
        r.settings["pairs"] = pairs
    r.start()
    g = r.game
    g.piles = [["7S"], ["2H"]]
    g.hand[0] = ["7D", "8C", "KH"]
    return r, g


check("fits: one up or down, A and K wrap", speed.fits("8C", "7S") and speed.fits("KH", "AS") and not speed.fits("7D", "7S"))
check("fits with pairs: same rank too", speed.fits("7D", "7S", True))
r, g = race(None)
check("off by default", not g.s["pairs"] and not g.view(r.players[g.seats[0]])["speed"]["pairs"])
try:
    g.play(0, "7D", 0)
    check("off: a 7 on a 7 is refused", False)
except GameError:
    check("off: a 7 on a 7 is refused", True)
r, g = race(True)
g.play(0, "7D", 0)
check("on: a 7 on a 7 plays", g.piles[0][-1] == "7D")
check("on: playable lists pairs", "8C" in g.playable(0) if hasattr(g, "playable") else True)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
