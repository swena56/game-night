"""Sumo 🧊 Freeze orb: the nearest rival can't steer or dash for FREEZE_SECS, then moves again.

    python3 tests/sumo_freeze.py
"""
import math
import os
import random
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import sumo as m  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


class Player:
    def __init__(self, pid, bot=None):
        self.id, self.name, self.bot = pid, pid, bot
        self.g = types.SimpleNamespace()
        self.spectator = self.eliminated = False


class Room:
    def __init__(self, settings, players):
        self.settings = dict(m.Sumo.defaults(), **settings)
        self.players = {p.id: p for p in players}
        self.turn = self.deadline = self.winner = None
        self.phase, self.logs = "playing", []

    def add_log(self, text, kind="info", **_):
        self.logs.append(text)

    def push_fast(self, data):
        pass

    def contenders(self):
        return [p for p in self.players.values() if not p.eliminated]

    def finish(self, winner, text):
        self.phase, self.winner = "over", winner


def game(settings, wins):
    players = [Player(f"b{k}", "hard") for k in range(3)]
    room = Room(settings, players)
    g = m.Sumo(room)
    g.start(list(players), random.Random(3))
    g.wins = list(wins)
    g.new_round(1000.0)
    return room, g


room, g = game({}, [0, 0, 0])
now = 1000.0 + m.COUNTDOWN
g.stage = "play"
a, b, c = g.saucers
a.x, a.y, b.x, b.y, c.x, c.y = 0.0, 0.0, 2.0, 0.0, 6.0, 0.0
g.orbs = [[0.0, 0.0, "freeze"]]
g.pickups(now)
check("nearest rival frozen", b.frozen_until > now and c.frozen_until == 0 and a.frozen_until == 0, (b.frozen_until, c.frozen_until))
check("frozen shows in the powers bit", b.powers(now) & 8)
b.vx = b.vy = 0.0
b.sx, b.sy = 1.0, 0.0
g.integrate(0.05, now + 0.5)
check("a frozen saucer can't accelerate", abs(b.vx) < 1e-9, b.vx)
b.cool_until = 0.0
g.dash(1, now + 0.5)
check("a frozen saucer can't dash", now + 0.5 >= b.dash_until and abs(b.vx) < 1e-9)
g.integrate(0.05, now + m.FREEZE_SECS + 0.1)
check("thawed: steers again", b.vx > 0, b.vx)
print("all ok" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
