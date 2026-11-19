"""Spoons: holding four of a kind must not change the screen (no red button, same text) in the pass stage.

    python3 tests/spoons_quiet.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(4)]
room.switch_game("spoons")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
g.stage = "pass"
g.waiting = set(range(g.n))
views = []
for hand in (["AC", "AD", "AH", "AS", "2C"], ["3C", "4D", "5H", "6S", "2C"]):
    g.hands[0] = hand
    t = g.table(ps[0], 0)
    views.append((t["buttons"], t["note"], t["turnText"]))
ok = views[0] == views[1] and views[0][0][0]["kind"] == ""
print("ok  " if ok else "FAIL", views[0])
sys.exit(0 if ok else 1)
