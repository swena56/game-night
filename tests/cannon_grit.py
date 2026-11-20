"""Cannon Hills last stand: the first drop to 30 hp or less in a round hands out a free Big Bang; off by setting; bots stay legal.

    python3 tests/cannon_grit.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import cannon as C  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(**settings):
    r = server.Room("TEST")
    for nm in ("Ann", "Bo"):
        r.add_player(nm)
    r.switch_game("cannon")
    r.settings.update(settings)
    r.start()
    g = r.game
    g.wind = 0
    g.terrain = [60] * C.W
    for t in g.tanks:
        t[1] = 60.0
    return r, g


def hit(g, by, j):
    t = g.tanks[j]
    g.blast(by, "shell", {"x": t[0], "y": t[1] + C.TANK_UP, "hit": j, "kind": "tank"}, 0)


r, g = game()
check("starts with one Big Bang", g.ammo[1]["big"] == 1)
hit(g, 0, 1)
check("still healthy: no gift", g.tanks[1][2] > 30 and g.ammo[1]["big"] == 1 and 1 not in g.grit, g.tanks[1])
g.tanks[1][2] = 45
hit(g, 0, 1)
check("down to 30 or less: free Big Bang", 0 < g.tanks[1][2] <= 30 and g.ammo[1]["big"] == 2, g.tanks[1])
hit(g, 0, 1)
check("only once a round", g.ammo[1]["big"] == 2, g.ammo[1])
check("shooter not rewarded", g.ammo[0]["big"] == 1)

r, g = game(grit=0)
g.tanks[1][2] = 45
hit(g, 0, 1)
check("off: no gift", g.ammo[1]["big"] == 1 and 0 < g.tanks[1][2] <= 30, g.tanks[1])

# volley mode (all at once): same gift, once a round, not for the shooter
r, g = game(volley=1)
check("volley: on", g.volley)
g.ammo[0]["big"] = 0
g.tanks[1][2] = 45
g.ready_at = 0
g.locked = {0: (0.0, 0.0, "shell"), 1: (0.0, 0.0, "shell")}
hit(g, 0, 1)
check("volley: free Big Bang", 0 < g.tanks[1][2] <= 30 and g.ammo[1]["big"] == 2 and 1 in g.grit, g.tanks[1])
hit(g, 0, 1)
check("volley: once a round", g.ammo[1]["big"] == 2, g.ammo[1])
check("volley: shooter not rewarded", g.ammo[0]["big"] == 0)

# bots fire whole turns legally (exceptions propagate)
r, g = game()
for p in r.players.values():
    p.bot = "hard"
shots = 0
while r.phase == "playing" and not g.between and shots < 12:
    p = r.players[r.turn]
    i = g.seat(p)
    a, pw, shell = g.plan_shot(i, p.bot)
    ok = 0 <= a <= 180 and 0 <= pw <= 1 and shell in C.SHELLS and (C.SHELLS[shell][4] is None or g.ammo[i].get(shell, 0) > 0)
    check("bot shot legal", ok, (a, pw, shell))
    if not ok:
        break
    g.act(p, {"type": "fire", "angle": a, "power": pw, "shell": shell})
    shots += 1

print("FAIL" if fails else "all ok")
sys.exit(1 if fails else 0)
