"""President: the give-back note names who you give to and your weakest cards.

    python3 tests/president_swap_note.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(4)]
room.switch_game("president")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
g.ranks = [0, 1, 2, 3]
g.deal()
print(g.stage, getattr(g, "swaps", None))
i = g.swaps[0][0]
t = g.table(ps[i], i)
note = t.get("note", "")
print(note)
low = g.swaps[0][1]
ok = g.nm(low) in note and "weakest" in note
print("ok  " if ok else "FAIL")
sys.exit(0 if ok else 1)
