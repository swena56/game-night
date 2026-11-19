"""Star Guard rules: shared lives, shields, bombs, power-ups, wave clear and the win/lose endings.

    python3 tests/starguard_rules.py
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
    g.fx, g.fy = 0.5, 0.3
    s = g.ships[0]
    s.shield = True
    check("shield absorbs a hit", g.ship_hit(0, now) is False and g.lives == 3 and not s.shield)
    check("hit costs a shared life", g.ship_hit(0, now) is False and g.lives == 2 and not s.alive)
    g.ship_hit(1, now)
    g.ships[1].alive = True
    g.ship_hit(1, now)
    check("no lives left ends the game", g.over and room.phase == "over" and room.winner is None, f"lives={g.lives}")

room, ps, g = table()
with room.cond:
    g.aliens = [Alien(0.0, 0.0, 2, "tough"), Alien(0.1, 0.0, 1, "grunt")]
    g.ebul = [[0.5, 1.0, 0.0, 0.5]]
    g.bomb(0, time.time())
    check("bomb clears shots and hurts aliens", not g.ebul and len(g.aliens) == 0 and g.ships[0].score == 30, g.ships[0].score)
    check("one bomb each", g.ships[0].bombs == 0 and (g.bomb(0, time.time()) is None) and g.ships[0].bombs == 0)

room, ps, g = table(waves=5)
with room.cond:
    g.aliens = []
    g.pups = []
    g.take(0, "life")
    check("extra life", g.lives == 4)
    g.take(1, "rapid")
    check("rapid power-up", g.ships[1].rapid > 0)
    g.wave = 1
    g.wave_clear(time.time())
    check("wave clear moves on", g.wave == 2 and g.stage == "intro" and g.ships[0].score >= 25)
    g.wave = 5
    g.boss = None
    g.aliens = []
    g.wave_clear(time.time())
    check("last wave clear wins", g.over and room.winner is not None)

room, ps, g = table()
with room.cond:
    g.next_wave(time.time())
    g.wave = 4
    g.next_wave(time.time())
    check("boss on wave 5", g.boss is not None and g.wave == 5 and not g.aliens)
    g.stage = "fight"
    g.boss["hp"] = 1
    g.pbul = [[g.boss["x"], g.boss["y"], 1, 0.0, 1]]
    g.fight(0.01, time.time())
    check("boss dies, shooter scores and gets a bomb", g.boss is None and g.ships[1].score >= 200 and g.ships[1].bombs == 2)

sys.exit(1 if fails else 0)
