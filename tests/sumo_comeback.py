"""Sumo 🛡️ Comeback shield: a saucer two or more rounds behind the leader starts the next round with a
shield; one round behind does not; the setting turns it off. Bots still steer with finite, bounded sticks.

    python3 tests/sumo_comeback.py
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


room, g = game({}, [3, 1, 2])
check("default on; two behind gets a shield", g.saucers[1].shield and not g.saucers[0].shield and not g.saucers[2].shield,
      [s.shield for s in g.saucers])
check("shield shows in the powers bit", g.saucers[1].powers(1000.0) & 4)
check("callout logged", any("comeback shield" in t for t in room.logs))
room, g = game({"comeback": False}, [3, 0, 0])
check("off: no shields", not any(s.shield for s in g.saucers))
room, g = game({}, [0, 0, 0])
check("level: no shields", not any(s.shield for s in g.saucers))

# bots steer legally (finite stick no longer than 1)
room, g = game({}, [3, 0, 0])
t = 1000.0 + m.COUNTDOWN
g.last_frame = t
for _ in range(600):
    t += 1 / 60
    g.frame(t)
    for s in g.saucers:
        check_ok = math.isfinite(s.sx) and math.isfinite(s.sy) and math.hypot(s.sx, s.sy) <= 1.0001
        if not check_ok:
            check("bot stick legal", False, (s.sx, s.sy))
            break
check("ran frames", g.stage in ("play", "over", "done"), g.stage)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
