"""Star Guard 🛸 bonus saucer: it crosses the top now and then, a hit scores 100 and drops a power-up, and it leaves on its own.

    python3 tests/starguard_ufo.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.starguard import Alien  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def table(n=2, waves=5, lives=3):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(n)]
    room.switch_game("starguard")
    room.settings.update({"waves": waves, "lives": lives})
    room.start()
    g = room.game
    g.stage = "fight"
    return room, ps, g


room, ps, g = table()
now = time.time()
with room.cond:
    g.aliens = [Alien(0.0, 0.0, 1, "grunt")]
    g.total = 1
    g.fx, g.fy = 0.5, 0.5
    g.ufo, g.ufo_at = None, now - 1
    g.last_frame = now
    g.fight(0.05, now)
    check("a saucer appears once its time comes", g.ufo is not None, g.ufo)
    x = g.ufo[0]
    g.fight(0.5, now + 0.5)
    check("it moves across", g.ufo is None or abs(g.ufo[0] - x) > 0.05, g.ufo)
    g.ufo = [0.5, 1]
    before = g.ships[0].score
    g.pbul = [[0.5, 0.065, 0, 0.0, 1]]
    g.pups = []
    g.fight(0.001, now + 1)
    check("a hit scores 100", g.ships[0].score >= before + 100, (before, g.ships[0].score))
    check("a power-up drops", len(g.pups) == 1 and g.pups[0][2] in ("rapid", "spread", "shield", "bomb"), g.pups)
    check("the saucer is gone", g.ufo is None)
    g.ufo = [0.5, 1]
    g.fight(30.0, now + 40)
    check("it leaves the screen on its own", g.ufo is None)
    g.boss = {"x": 0.5, "y": 0.28, "hp": 99, "max": 99, "dir": 1, "fire": 0.0, "phase": 0.0}
    g.ufo, g.ufo_at = None, now - 1
    g.fight(0.05, now + 41)
    check("none on a boss wave", g.ufo is None)
print("all ok" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
