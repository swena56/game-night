"""Blackjack insurance (an option, off by default): when the dealer shows an ace, each player may insure
for half their bet; it pays 2 to 1 if the dealer has blackjack. Runs a real room with a stacked shoe.

    python3 tests/blackjack_insurance.py        # well under a second
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


def table(insurance, deal, bot=False):
    """Ann and Bo (or a bot) at a table; `deal` is the cards in the order they come out of the shoe:
    Ann, Bo, dealer up, Ann, Bo, dealer hole."""
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    bo = room.add_bot("normal") if bot else room.add_player("Bo")
    room.switch_game("twentyone")
    room.settings["insurance"] = insurance
    room.start()
    g = room.game
    g.shoe = ["2C"] * 60 + list(reversed(deal))   # draw() takes from the end
    return room, ann, bo, g


ACE_UP_BJ = ["TC", "9D", "AS", "7H", "8C", "KD"]      # dealer A♠ K♦: blackjack
ACE_UP_NO = ["TC", "9D", "AS", "7H", "8C", "6D"]      # dealer A♠ 6♦: no blackjack

room, ann, bo, g = table(False, ACE_UP_BJ)
g.act(ann, {"type": "bet", "amount": 20}); g.act(bo, {"type": "bet", "amount": 10})
check("off by default: an ace up goes straight on (here to the dealer's blackjack)", g.stage == "settle", g.stage)

room, ann, bo, g = table(True, ACE_UP_BJ)
g.act(ann, {"type": "bet", "amount": 20}); g.act(bo, {"type": "bet", "amount": 10})
check("an ace up asks for insurance", g.stage == "insure" and g.view(ann)["twentyone"]["insStake"] == 10)
check("no hitting while insurance is open", refused(g, ann, {"type": "hit"}))
c_ann, c_bo = g.chips[0], g.chips[1]
g.act(ann, {"type": "insure", "take": True})
check("one answer waits for the other", g.stage == "insure")
check("no second answer", refused(g, ann, {"type": "insure", "take": False}))
g.act(bo, {"type": "insure", "take": False})
check("dealer blackjack: insured Ann gets 2 to 1 on 10 and loses her 20 bet (net 0)", g.chips[0] - c_ann == 0, f"{g.chips[0] - c_ann}")
check("dealer blackjack: Bo, uninsured, loses his 10", g.chips[1] - c_bo == -10, f"{g.chips[1] - c_bo}")
check("insurance results are in the view", g.view(ann)["twentyone"]["insRes"] == [20, None])

room, ann, bo, g = table(True, ACE_UP_NO)
g.act(ann, {"type": "bet", "amount": 20}); g.act(bo, {"type": "bet", "amount": 10})
c_ann = g.chips[0]
g.act(ann, {"type": "insure", "take": True}); g.act(bo, {"type": "insure", "take": False})
check("no dealer blackjack: insurance is lost and play goes on", g.stage == "play" and g.chips[0] - c_ann == -10, f"{g.stage} {g.chips[0] - c_ann}")

room, ann, bot, g = table(True, ACE_UP_NO, bot=True)
g.act(ann, {"type": "bet", "amount": 20})
for _ in range(5):
    if g.stage == "bet":
        g.bot_tick()
check("bots decline at once; the table waits only for people", g.stage == "insure" and g.ins[1] == 0 and g.ins[0] is None, str(g.ins))
g.on_timeout()
check("the clock declines for anyone who hasn't answered", g.stage == "play" and g.ins == [0, 0], f"{g.stage} {g.ins}")

room, ann, bo, g = table(True, ACE_UP_NO)
g.act(ann, {"type": "bet", "amount": 100}); g.act(bo, {"type": "bet", "amount": 10})
check("all-in leaves nothing to insure with: not asked", g.ins[0] == 0 and g.ins[1] is None, str(g.ins))

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
