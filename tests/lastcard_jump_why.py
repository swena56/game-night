"""Last Card: a rejected jump-in says why, naming the top card's rank and colour.

    python3 tests/lastcard_jump_why.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(3)]
room.switch_game("lastcard")
room.settings["jumpin"] = True
room.start()
g = room.game
fails = []


def attempt(card):
    p = next(x for x in ps if x.id != room.turn)
    p.g.hand = [card, "2C"]
    try:
        g.jump_in(p, card)
        return "OK"
    except GameError as e:
        return str(e)


g.penalty = 0
g.discard.append("5H")
for card, want in [("5C", "wrong colour"), ("9H", "red 5"), ("5H", "top card itself")]:
    m = attempt(card)
    ok = want in m
    print("ok  " if ok else "FAIL", card, m)
    if not ok:
        fails.append(card)
sys.exit(1 if fails else 0)
