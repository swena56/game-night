"""Wordsmith 🎯 Comeback bounty (off by default): the bounty letter scores double for whoever is strictly
behind everyone.

    python3 tests/wordsmith_comeback.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import wordsmith as ws  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(comeback):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("wordsmith")
    if comeback is not None:
        r.settings["comeback"] = comeback
    r.start()
    g = r.game
    g.bounty = "A"
    g.scores[ann.id], g.scores[bo.id] = 10, 30
    return r, g, ann, bo


CAT = [(5, 4, "C"), (5, 5, "A"), (5, 6, "T")]
r, g, ann, bo = table(None)
plain = g.check_play(CAT, ann)[0]
r, g, ann, bo = table(True)
behind = g.check_play(CAT, ann)[0]
ahead = g.check_play(CAT, bo)[0]
check("off by default: the usual bounty", plain == ahead)
check("on: the player behind gets the bounty twice", behind == plain + ws.BOUNTY_BONUS, (plain, behind))
check("the leader doesn't", ahead == plain)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
