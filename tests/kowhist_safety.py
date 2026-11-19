"""Knock Out Whist: the play note tells you whether you've dodged the knock-out yet.

    python3 tests/kowhist_safety.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(3)]
room.switch_game("kowhist")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
g.stage = "play"
fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


g.tricks = [0, 1, 0]
g.hands[0] = ["2C", "3C", "4C"]
g.hands[1] = ["2D", "3D", "4D"]
n0 = g.table(ps[0], 0).get("note", "")
n1 = g.table(ps[1], 1).get("note", "")
check("no trick yet", "No trick yet" in n0, n0)
check("safe once won", "Safe" in n1, n1)
g.hands[0] = ["2C"]
check("last card", "Last card" in g.table(ps[0], 0).get("note", ""))
sys.exit(1 if fails else 0)
