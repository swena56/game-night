"""Star Guard: 🌀 grazes score once per bullet, 😡 boss enrage fires once at half HP, 🎁 a cleared wave arms the ships.

    python3 tests/starguard_graze.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import starguard as sg  # noqa: E402
from games.starguard import Alien  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


room = server.Room("TEST")
for k in range(2):
    room.add_player(f"P{k}")
room.switch_game("starguard")
room.settings.update({"waves": 5, "lives": 3})
room.start()
g = room.game
g.stage = "fight"
now = time.time()
with room.cond:
    g.aliens = [Alien(0.0, 0.0, 1, "grunt")]
    g.total = 1
    g.fx, g.fy = 0.5, 0.2
    g.alien_fire = now + 99
    s = g.ships[0]
    s.invuln = 0.0
    s.x = s.tx = 0.5
    g.ebul = [[0.5 + 0.05, sg.SHIP_Y, 0.0, 0.0], [0.9, 0.5, 0.0, 0.0]]
    g.fight(0.016, now)
    g.fight(0.016, now)
    check("graze scores once", s.score == sg.GRAZE_PTS and s.grazes == 1, f"score={s.score} grazes={s.grazes}")
    check("graze costs no life", g.lives == 3)
    s.grazes = sg.GRAZE_CALL - 1
    g.ebul = [[0.55, sg.SHIP_Y, 0.0, 0.0]]
    g.fight(0.016, now)
    check("tenth graze calls out", s.grazes == sg.GRAZE_CALL)

    # enrage
    g.aliens = []
    g.boss = {"x": 0.5, "y": 0.28, "hp": 60, "max": 60, "dir": 1, "fire": 0.0, "phase": 0.0}
    g.boss_step(0.016, now)
    check("no rage at full hp", not g.boss.get("rage"))
    g.boss["hp"] = 30
    g.boss_step(0.016, now)
    check("rage at half hp", g.boss.get("rage") is True)
    check("snapshot carries rage", g.snapshot()["bo"][4] == 1)

    # supply drop
    g.boss = None
    g.stage = "fight"
    for sh in g.ships:
        sh.rapid = sh.spread = 0.0
    g.wave = 1
    g.wave_clear(now)
    check("supply drop arms live ships", all(max(sh.rapid, sh.spread) >= sg.SUPPLY_SECS for sh in g.ships if sh.alive))
sys.exit(1 if fails else 0)
