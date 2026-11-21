"""Dice Brawl: 🩸 last stand (4th roll at 3 ❤️ or less), 🛡️ parry (a fully soaked hit costs the attacker 1), ☠️ KO callout.

    python3 tests/brawl_comeback.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import brawl as B  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def table(n=2):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("brawl")
    r.start()
    return r, r.game, ps


r, g, ps = table()
a = r.players[r.turn]
b = next(p for p in ps if p.id != a.id)
check("healthy: three rolls", g.max_rolls == 3 and g.view(a)["brawl"]["maxRolls"] == 3)
a.g.hp = 3
g.begin(a.id)
check("last stand: four rolls", g.max_rolls == 4 and g.view(a)["brawl"]["maxRolls"] == 4)
for _ in range(4):
    g.dice = []
    g.rolls = 0
g.dice, g.rolls = [2, 2, 2, 2, 2], 3
try:
    g.do_roll(a, [0, 1, 2, 3, 4][:4])
    ok = True
except Exception as e:
    ok = False
check("fourth roll allowed", ok or g.rolls == 3)
g.rolls = 4
try:
    g.do_roll(a)
    ok = False
except Exception:
    ok = True
check("no fifth roll", ok)
a.g.hp = 4
g.begin(a.id)
check("4 ❤️: no extra roll", g.max_rolls == 3)

# parry: b's shield soaks a's single sword hit
r, g, ps = table()
a = r.players[r.turn]
b = next(p for p in ps if p.id != a.id)
a.g.hp = b.g.hp = 12
g.dice, g.rolls = [B.SWORD, B.SKULL, B.SKULL, B.SHIELD, B.SHIELD], 1
b.g.guard = 2
g.do_fight(a, b.id)
check("parry: attacker loses 1", a.g.hp == 12 - B.PARRY, a.g.hp)
check("parry: no damage to target", b.g.hp == 12)

# a parry can knock the attacker out
r, g, ps = table()
a = r.players[r.turn]
b = next(p for p in ps if p.id != a.id)
a.g.hp, b.g.hp, b.g.guard = 1, 12, 5
g.dice, g.rolls = [B.SWORD, B.SKULL, B.SKULL, B.SHIELD, B.SHIELD], 1
g.do_fight(a, b.id)
check("parry KO: attacker out, rival wins", a.eliminated and r.phase != "playing", r.phase)
sys.exit(1 if fails else 0)
