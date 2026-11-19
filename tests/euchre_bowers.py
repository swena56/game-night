"""Euchre trump label names the right and left bower for the called suit.

    python3 tests/euchre_bowers.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.euchre import GLYPH, SAME  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(4)]
room.switch_game("euchre")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
fails = []
for t in "SHDC":
    g.trump = t
    lab = g.table(ps[0], 0)["trumpLabel"]
    ok = f"right J{GLYPH[t]}" in lab and f"left J{GLYPH[SAME[t]]}" in lab
    print("ok  " if ok else "FAIL", t, lab)
    if not ok:
        fails.append(t)
g.trump = None
ok = g.table(ps[0], 0)["trumpLabel"] == ""
print("ok  " if ok else "FAIL", "no trump -> empty")
if not ok:
    fails.append("none")
sys.exit(1 if fails else 0)
