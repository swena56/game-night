"""Liar's Dice badges: 🎯 Spot on for a right Exact call, 🛡️ Untouchable for winning with all five dice.
Runs a real room.

    python3 tests/liars_badges.py        # well under a second
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def badges(p):
    return getattr(p, "badges", None) or {}


def new_room(n=3):
    room = server.Room("TEST")
    ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    room.switch_game("liars")
    room.settings["wild"] = False
    room.start()
    return room, ps, room.game


# Exact, right: three 4s on the table, Bo bid three 4s, Ann calls exact
room, (ann, bo, cy), g = new_room()
ann.g.dice, bo.g.dice, cy.g.dice = [4, 1, 2, 2, 6], [4, 4, 3, 5, 6], [1, 2, 3, 5, 6]
g.bid = (3, 4, bo.id)
g.call(ann, "exact")
check("a right Exact call earns 🎯 Spot on", badges(ann).get("liars:spot_on") == 1, str(badges(ann)))
check("everyone else lost a die", bo.g.count == 4 and cy.g.count == 4 and ann.g.count == 5)

# Exact, wrong: no badge
room, (ann, bo, cy), g = new_room()
ann.g.dice, bo.g.dice, cy.g.dice = [4, 1, 2, 2, 6], [4, 3, 3, 5, 6], [1, 2, 3, 5, 6]
g.bid = (3, 4, bo.id)
g.call(ann, "exact")
check("a wrong Exact call earns nothing", not badges(ann).get("liars:spot_on") and ann.g.count == 4)

# the last call of the game: Ann still has all five dice and catches Bo's bluff on his last die
room, (ann, bo), g = new_room(2)
bo.g.count, bo.g.dice = 1, [2]
ann.g.dice = [1, 1, 3, 3, 5]
g.bid = (3, 6, bo.id)
g.call(ann, "liar")
check("the game is over", room.phase == "over", room.phase)
check("winning with all five dice earns 🛡️ Untouchable", badges(ann).get("liars:untouchable") == 1, str(badges(ann)))

# winning after losing a die: no Untouchable
room, (ann, bo), g = new_room(2)
bo.g.count, bo.g.dice = 1, [2]
ann.g.count, ann.g.dice = 4, [1, 1, 3, 3]
g.bid = (3, 6, bo.id)
g.call(ann, "liar")
check("a win with dice lost earns no Untouchable", room.phase == "over" and not badges(ann).get("liars:untouchable"))

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
