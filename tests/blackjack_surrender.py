"""Blackjack 🏳️ Surrender (off by default): on your first two cards (not after a split) give up half your
bet. The 💡 advice in the view is basic strategy (the hard bot's table), and suggests surrendering 16 against
9, 10 or an ace when surrender is on.

    python3 tests/blackjack_surrender.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError:
        return True
    return False


def table(surrender, deal):
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    room.switch_game("twentyone")
    if surrender is not None:
        room.settings["surrender"] = surrender
    room.start()
    g = room.game
    g.shoe = ["2C"] * 60 + list(reversed(deal))   # Ann, dealer up, Ann, dealer hole, then 2s
    return room, ann, g


SIXTEEN_V_TEN = ["TC", "TD", "6H", "8S"]   # Ann 10+6 = 16, dealer T up, 8 hole: 18
room, ann, g = table(None, SIXTEEN_V_TEN)
g.act(ann, {"type": "bet", "amount": 20})
check("off by default: no surrender", not g.view(ann)["twentyone"]["canSurrender"] and refused(g, ann, {"type": "surrender"}))
check("advice without surrender: hit 16 v 10", g.view(ann)["twentyone"]["advice"] == "hit")

room, ann, g = table(True, SIXTEEN_V_TEN)
g.act(ann, {"type": "bet", "amount": 20})
v = g.view(ann)["twentyone"]
check("on: surrender offered on two cards", v["canSurrender"])
check("advice: surrender 16 v 10", v["advice"] == "surrender", v["advice"])
chips = g.chips[0]
g.act(ann, {"type": "surrender"})
while g.stage == "dealer":
    g.dealer_step()
check("half the bet comes back", g.stage == "settle" and g.chips[0] == chips - 10, (g.stage, g.chips[0], chips))
check("the result says so", g.result[0][0] == "surrendered")

room, ann, g = table(True, ["TC", "TD", "6H", "8S"])
g.act(ann, {"type": "bet", "amount": 20})
g.act(ann, {"type": "hit"})
check("no surrender after a hit", g.stage != "play" or refused(g, ann, {"type": "surrender"}))

room, ann, g = table(True, ["TC", "6D", "TH", "8S"])   # Ann 20 v 6: stand
g.act(ann, {"type": "bet", "amount": 20})
check("advice: stand on 20", g.view(ann)["twentyone"]["advice"] == "stand")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
