"""Cheat: the call note counts the claimed rank still unseen to you and flags impossible claims.

    python3 tests/cheat_odds_note.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(3)]
room.switch_game("cheat")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
fails = []
g.stage = "call"
g.waiting = {1}
g.hands[1] = ["7C", "7D", "7H", "2C"]
for n, want in [(1, "at most 1 are left"), (2, "impossible")]:
    g.claim = {"seat": 0, "rank": "7", "n": n, "cards": ["7S"] * n}
    note = g.table(ps[1], 1)["note"]
    ok = want in note
    print("ok  " if ok else "FAIL", n, note)
    if not ok:
        fails.append(n)
sys.exit(1 if fails else 0)
