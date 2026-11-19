"""Spades: the hand-end review shows each team's bid, tricks taken and score swing.

    python3 tests/spades_recap.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(4)]
room.switch_game("spades")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
g.bids = [3, 4, 3, 2]
g.tricks = [4, 2, 4, 3]
g.bags = [0, 0]
g.team_score = [0, 0]
g.end_hand()
note = g.table(ps[0], 0).get("note", "")
print(note)
ok = "🔵 bid 6, took 8" in note and "+62" in note and "🟠 bid 6, took 5" in note and "-60" in note
print("ok  " if ok else "FAIL")
sys.exit(0 if ok else 1)
