"""Ninety-Nine double or nothing: once a game arm it, make your bid for a doubled bonus, miss for -10; off by setting.

    python3 tests/ninetynine_double.py
"""
import os
import sys
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

from games.cardbase import pretty, suit  # noqa: E402
from games.ninetynine import WORTH  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(double=None):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(3)]
    room.switch_game("ninetynine")
    if double is not None:
        room.settings["double"] = double
    room.start()
    g = room.game
    ps.sort(key=lambda p: g.seat(p))
    return room, ps, g


def btn(g, p):
    return [b for b in (g.view(p)["ninetynine"].get("buttons") or []) if b["a"].get("type") == "double"]


def end(g, bids, took, dbl):
    g.bids, g.tricks, g.dbl = bids, took, set(dbl)
    g.bidcards = [[] for _ in range(3)]
    g.scores = [0] * 3
    g.end_hand()


room, ps, g = table()
check("button offered", len(btn(g, ps[0])) == 1)
g.act(ps[0], {"type": "double"})
check("armed", 0 in g.armed)
g.act(ps[0], {"type": "double"})
check("toggles off", 0 not in g.armed)
g.act(ps[0], {"type": "double"})
g.act(ps[0], {"type": "bid", "cards": g.hands[0][:3]})
check("double spent and tagged", g.dons[0] == 0 and 0 in g.dbl)
check("no button after", not btn(g, ps[0]))

room, ps, g = table()
end(g, [3, 2, 5], [3, 0, 0], [0])  # only seat 0 makes it: 3 + 30, doubled bonus
check("made double pays bonus twice", g.scores[0] == 63, g.scores)
room, ps, g = table()
end(g, [3, 2, 5], [1, 2, 0], [0])  # seat 0 misses (1 trick) and loses 10
check("missed double costs 10", g.scores[0] == 1 - 10 and g.scores[1] == 2 + 30, g.scores)

room, ps, g = table()
g.dons[0] = 0
try:
    g.act(ps[0], {"type": "double"}); ok = False
except Exception:
    ok = True
check("none when spent", ok)

room, ps, g = table(double=0)
try:
    g.act(ps[0], {"type": "double"}); ok = False
except Exception:
    ok = True
check("off by setting", ok and not btn(g, ps[0]))

for seed in range(3):
    random.seed(seed)
    room = server.Room("B%d" % seed)
    for k in range(3):
        room.add_player(f"B{k}")
    room.switch_game("ninetynine"); room.settings["target"] = 60; room.start(); g = room.game
    def legal_play(i, c, _play=g.play):
        assert g.stage == "play" and c in g.hands[i] and c in g.legal(i), f"illegal bot card {c} for seat {i}"
        return _play(i, c)

    def legal_bid(i, cards, _bid=g.place_bid):
        assert g.stage == "bid" and i in g.waiting, f"bot {i} bid out of turn"
        assert len(cards) == 3 and len(set(cards)) == 3 and all(c in g.hands[i] for c in cards), f"illegal bid {cards}"
        return _bid(i, cards)

    g.play, g.place_bid = legal_play, legal_bid
    moves = 0
    for _ in range(400):
        if room.phase != "playing":
            break
        if g.stage == "bid":
            for i in list(g.waiting):
                could = g.can_double(i)
                g.bot_move(i, "hard")  # exceptions propagate: a bot raising fails the test
                assert i not in g.armed or could, f"bot {i} armed a double it can't have"
                moves += 1
        elif g.stage == "play":
            g.bot_move(g.seat(room.players[room.turn]), "hard")
            moves += 1
        for p in room.players.values():
            g.view(p)
        if g.stage == "score":
            g.deal()
    check(f"seed {seed}: bots stay legal", moves > 50, f"{moves} moves")

room, ps, g = table()
hand = g.hands[0].copy()
raw_card = {pretty(c): c for c in hand}
plan = g.view(ps[0])["ninetynine"]["bidPlan"]
check("bid planner recommends three owned cards for each achievable bid",
      plan and all(len(set(row["cards"])) == 3
                   and sum(WORTH[suit(raw_card[c])] for c in row["cards"]) == row["bid"] for row in plan))
check("another bidder gets only their own discard choices",
      all(not set(row["cards"]) & set(raw_card) for row in g.view(ps[1])["ninetynine"]["bidPlan"]))
check("spectators receive no bid plan", "bidPlan" not in g.table(ps[0], None))
row = plan[0]
g.act(ps[0], {"type": "bid", "cards": [raw_card[c] for c in row["cards"]]})
check("the recommendation gives the advertised bid and then clears",
      g.bids[0] == row["bid"] and len(g.hands[0]) == len(hand) - 3
      and "bidPlan" not in g.view(ps[0])["ninetynine"])

# Private in-play note explains whether the bid is still reachable.
room, ps, g = table()
g.stage = "play"
g.bids = [2, 0, 9]
g.bidcards = [["6D"] for _ in range(3)]
g.tricks = [1, 0, 0]
g.hands = [["6D"] * 8 for _ in range(3)]
check("reachable bid progress", "Win 1 more trick." in g.view(ps[0])["ninetynine"]["note"])
check("zero bid progress", "Avoid taking another trick." in g.view(ps[1])["ninetynine"]["note"])
check("spectator has no bid note", not g.view(room.add_player("Watcher"))["ninetynine"].get("note"))
g.tricks = [2, 0, 0]
check("made bid says avoid", "Avoid taking another trick." in g.view(ps[0])["ninetynine"]["note"])
g.tricks = [3, 0, 0]
check("overshot bid", "Bid missed" in g.view(ps[0])["ninetynine"]["note"])
g.tricks = [0, 4, 4]
g.hands = [["6D"] for _ in range(3)]
check("unreachable bid", "Bid out of reach. Only 1 trick left." in g.view(ps[0])["ninetynine"]["note"])

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
