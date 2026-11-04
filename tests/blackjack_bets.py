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

# -- Perfect Pairs side bet
check("pair kinds", (t.pair_kind(["7H", "7D"]), t.pair_kind(["7H", "7S"]), t.pair_kind(["7H", "7H"]), t.pair_kind(["7H", "8H"]))
      == ("coloured", "mixed", "perfect", None))


def pairs_game(cards):
    """A one-seat game with Perfect Pairs on; the shoe deals `cards` to the player, then 9C 7S to the dealer."""
    g, room, pa = new_game()
    room.settings["pairs"] = True
    g.shoe = [r + s for r in "23456" for s in "SHDC"] * 4  # plenty left, so no fresh shoe
    g.shoe += ["7S", cards[1], "9C", cards[0]]  # popped from the end: you, dealer, you, dealer
    return g, room, pa


g, room, pa = new_game()
g.act(pa, {"type": "bet", "amount": 10, "pair": True})
check("pair bet ignored when the option is off", g.pair[0] == 0 and g.pair_res[0] is None)

g, room, pa = pairs_game(["KH", "KH"])
g.act(pa, {"type": "bet", "amount": 10, "pair": True})
check("a perfect pair pays 25 to 1", g.pair_res[0] == ["perfect", 125] and g.chips[0] >= 100 + 125 - 10, f"{g.pair_res} chips={g.chips}")

g, room, pa = pairs_game(["KH", "KS"])
g.act(pa, {"type": "bet", "amount": 10, "pair": True})
check("a mixed pair pays 6 to 1", g.pair_res[0] == ["mixed", 30], f"{g.pair_res}")

g, room, pa = pairs_game(["KH", "QS"])
g.act(pa, {"type": "bet", "amount": 10, "pair": True})
check("no pair loses the side bet", g.pair_res[0] == ["none", -5], f"{g.pair_res}")
check("the pair choice is remembered", g.last_pair == [True])

g, room, pa = pairs_game(["KH", "QS"])
g.chips[0] = 10
try:
    g.act(pa, {"type": "bet", "amount": 10, "pair": True})
    check("all-in plus a pair bet rejected", False)
except GameError:
    check("all-in plus a pair bet rejected", True)

state = g.__dict__.copy()
for k in ("pair", "pair_res", "last_pair"):
    state.pop(k)
g2 = t.TwentyOne.__new__(t.TwentyOne)
g2.__setstate__(state)
check("old saves get empty pair bets", g2.pair == [0] and g2.pair_res == [None] and g2.last_pair == [False])

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
