"""Eleusis: on your turn the note spells out how a play is judged, naming the last accepted card.

    python3 tests/eleusis_turn_note.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(3)]
room.switch_game("eleusis")
room.start()
g = room.game
p = next(x for x in ps if x.id == room.turn)
i = g.seat(p)
note = g.table(p, i)["note"]
print(note)
ok = "Play a card after" in note and "draw 2" in note
g.knows.add(i)
note2 = g.table(p, i)["note"]
ok = ok and "You know the rule" in note2
print("ok  " if ok else "FAIL")
sys.exit(0 if ok else 1)
