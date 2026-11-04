"""Unmask: a right accusation with a third of your board still face-up earns the 🎲 Bold guess badge; a
careful one (most faces flipped) doesn't. A small fake room stands in for the server.

    python3 tests/unmask_rules.py        # well under a second
"""
import os
import random
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import unmask as u  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


class Player:
    def __init__(self, pid, name):
        self.id, self.name, self.bot = pid, name, None
        self.g = types.SimpleNamespace()
        self.spectator = self.eliminated = False


class Room:
    def __init__(self, players):
        self.settings = dict(u.Unmask.defaults(), mode="duel", size=24, powers=False)
        self.players = {p.id: p for p in players}
        self.turn = self.winner = None
        self.phase, self.logs, self.awards = "playing", [], []

    def add_log(self, text, kind="info", **_):
        self.logs.append(text)

    def begin_turn(self, pid):
        self.turn = pid

    def opponent(self, p):
        return next(q for q in self.players.values() if q.id != p.id)

    def finish(self, winner, text):
        self.phase, self.winner = "over", winner.id if winner else None

    def award(self, p, gid, key):
        self.awards.append((p.id if hasattr(p, "id") else p, gid, key))


def game(flipped):
    a, b = Player("a", "Ann"), Player("b", "Bo")
    room = Room([a, b])
    g = u.Unmask(room)
    g.start([a, b], random.Random(5))
    a.g.flipped = set([i for i in range(24) if i != b.g.secret][:flipped])
    g.accuse(a, b.g.secret)
    return room


room = game(flipped=8)  # 16 of 24 still up
check("a right guess with 16 faces up is bold", ("a", "unmask", "bold") in room.awards and room.winner == "a", room.awards)
room = game(flipped=20)  # 4 up
check("a careful guess isn't", ("a", "unmask", "bold") not in room.awards and room.winner == "a", room.awards)
check("bold badge defined", "bold" in u.Unmask.badges)

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
