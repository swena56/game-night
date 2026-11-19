"""Sixty-Six: the play note says how far you are from 66, or that a held marriage wins on the next trick.

    python3 tests/sixtysix_goal.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(2)]
room.switch_game("sixtysix")
room.start()
g = room.game
p = next(x for x in ps if x.id == room.turn)
i = g.seat(p)
g.stage = "play"
fails = []


def note():
    return g.table(p, i).get("note", "")


g.points[i], g.held[i] = 30, 0
n = note()
print(n)
if "36 to 66" not in n:
    fails.append("far")
g.points[i], g.held[i] = 50, 20
n = note()
print(n)
if "reach 66" not in n:
    fails.append("held")
print("FAIL" if fails else "ok", fails)
sys.exit(1 if fails else 0)
