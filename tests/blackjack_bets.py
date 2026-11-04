"""Blackjack betting checks (#5): a bet is any multiple of 5 up to your stack, or all-in, and the
last bet is remembered. A small fake room stands in for the server.

    python3 tests/blackjack_bets.py        # well under a second
"""
import os
import random
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import twentyone as t  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


class Player:
    def __init__(self, pid, name, bot=None):
        self.id, self.name, self.bot = pid, name, bot
        self.g = types.SimpleNamespace()
        self.spectator = self.eliminated = False


class Room:
    def __init__(self, players):
        self.settings = dict(t.TwentyOne.defaults(), timer=0)
        self.players = {p.id: p for p in players}
        self.turn = self.deadline = self.winner = None
        self.bot_at, self.phase, self.logs = 0.0, "playing", []

    def add_log(self, text, kind="info", **_):
        self.logs.append(text)

    def begin_turn(self, pid):
        self.turn = pid

    def finish(self, winner, text):
        self.phase, self.winner, self.turn = "over", winner.id if winner else None, None


def new_game():
    pa = Player("a", "Ann")
    room = Room([pa])
    g = t.TwentyOne(room)
    g.start([pa], random.Random(3))
    return g, room, pa


def rejects(g, p, amount):
    try:
        g.act(p, {"type": "bet", "amount": amount})
    except GameError:
        return True
    return False


g, room, pa = new_game()
check("renamed to Blackjack", t.TwentyOne.name == "Blackjack")
check("bet of 3 rejected", rejects(g, pa, 3))
check("bet of 12 rejected", rejects(g, pa, 12))
check("bet over the stack rejected", rejects(g, pa, 105))
check("a non-number rejected", rejects(g, pa, "10"))
check("True is not a bet", rejects(g, pa, True))
g.act(pa, {"type": "bet", "amount": 35})
check("a built bet of 35 is taken", g.bets[0] == 35 and g.stage in ("play", "settle"), f"bets={g.bets} stage={g.stage}")
check("the last bet is remembered", g.view(pa)["twentyone"]["lastBets"] == [35])

g, room, pa = new_game()
g.chips[0] = 7
g.act(pa, {"type": "bet", "amount": 7})
check("all-in with an odd stack", g.bets[0] == 7)

g, room, pa = new_game()
g.last_bet[0] = 20
g.on_timeout()
check("the clock repeats your last bet", g.bets[0] == 20, f"bets={g.bets}")

state = g.__dict__.copy()
state.pop("last_bet")
g2 = t.TwentyOne.__new__(t.TwentyOne)
g2.__setstate__(state)
check("old saves get a last bet", g2.last_bet == g.bets)

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
