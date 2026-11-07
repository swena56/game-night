"""Lantern Market: the highest unmatched bid wins, matched bids cancel and the lot carries over, a lit lantern
doubles a win and burns out either way, the last lot plays itself, and nobody sees a bid before the reveal.

    python3 tests/lantern_rules.py        # well under a second
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402
from games.lantern import winner_of  # noqa: E402

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


def new_room(n=3):
    room = server.Room("TEST")
    ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    room.switch_game("lantern")
    room.settings["timer"] = 0
    room.start()
    return room, ps, room.game


check("winner_of: highest unique", winner_of({"a": 9, "b": 9, "c": 4}) == "c" and winner_of({"a": 3, "b": 7}) == "b")
check("winner_of: all matched", winner_of({"a": 5, "b": 5}) is None)

room, (ann, bo, cy), g = new_room()
g.table, g.deck = [6], [1, 2, 3, 4, 5, 7, 8, 9, 10]
check("bad bids refused", refused(g, ann, {"type": "bid", "bid": 11}) and refused(g, ann, {"type": "bid", "bid": "3"})
      and refused(g, ann, {"type": "bid", "bid": 3, "lit": "yes"}))
g.act(ann, {"type": "bid", "bid": 8})
v = g.view(bo)["lantern"]
check("a bid stays secret until the reveal", v["mine"] is None and 8 in v["hands"][ann.id] and ann.id not in v["waiting"])
g.act(bo, {"type": "bid", "bid": 8})
g.act(cy, {"type": "bid", "bid": 2})
check("matched bids cancel; the lowest unmatched wins", g.score[cy.id] == 6 and g.score[ann.id] == 0, g.score)
check("tiles are spent win or lose", 8 not in g.hands[ann.id] and 8 not in g.hands[bo.id] and 2 not in g.hands[cy.id])

g.table = [9]
for p, b in ((ann, 5), (bo, 5), (cy, 5)):
    g.act(p, {"type": "bid", "bid": b})
check("all matched: the lot stays and the next joins it", len(g.table) == 2 and g.table[0] == 9 and g.reveals[-1]["winner"] is None, g.table)

pot = sum(g.table)
g.act(ann, {"type": "bid", "bid": 10, "lit": True})
g.act(bo, {"type": "bid", "bid": 1, "lit": True})
g.act(cy, {"type": "bid", "bid": 1})
check("a lit lantern doubles the win", g.score[ann.id] == pot * 2, (g.score, pot))
check("lanterns burn out win or lose", g.lamps[ann.id] == 0 and g.lamps[bo.id] == 0 and g.lamps[cy.id] == 1)
check("a burned-out lantern can't be lit", refused(g, ann, {"type": "bid", "bid": g.hands[ann.id][0], "lit": True}))

# play on with everyone's lowest tile until only the last lot is left: it plays itself, then the game ends
while room.phase == "playing" and len(g.hands[ann.id]) > 1:
    for p in (ann, bo, cy):
        if room.phase == "playing" and p.id not in g.choices:
            g.act(p, {"type": "bid", "bid": g.hands[p.id][0]})
check("the last lot plays itself and the market closes", room.phase == "over" and not g.deck, room.phase)
check("an unused lantern lights itself on the last lot", g.lamps[cy.id] == 0)
check("both final reveals are kept: the auto-played last lot follows the one before",
      [x["round"] for x in g.reveals] == [9, 10] and g.reveals[1]["auto"] and not g.reveals[0]["auto"], g.reveals)

# market events: a mystery lot stays hidden (from views and bots) until bought; rain washes an unsold table away
room, (ann, bo, cy), g = new_room()
g.table, g.deck, g.hidden, g.event = [4], [1, 2, 3, 5, 6, 7, 8, 9, 10], set(), None
g.events = {10: "mystery"}
g.act(ann, {"type": "bid", "bid": 3}); g.act(bo, {"type": "bid", "bid": 3}); g.act(cy, {"type": "bid", "bid": 3})
v = g.view(ann)["lantern"]
check("a mystery lot is hidden in the view", 10 in g.table and 0 in v["table"] and 10 not in v["table"], v["table"])
check("the hidden value doesn't leak through the reveals or the log",
      all(10 not in x["table"] and x["pot"] < 10 for x in v["reveals"]) and not any("Compass" in str(e) for e in room.log), v["reveals"])
check("bots price a mystery lot at the average unseen lot", abs(g.bot_pot() - (4 + sum(g.deck + [10]) / (len(g.deck) + 1))) < 1e-9)
g.act(ann, {"type": "bid", "bid": 9}); g.act(bo, {"type": "bid", "bid": 1}); g.act(cy, {"type": "bid", "bid": 2})
check("buying a mystery lot reveals it", g.score[ann.id] == 4 + 10 and not g.hidden and "Compass" in g.reveals[-1]["text"], g.reveals[-1])
g.table, g.event = [9, 6], "rain"
g.act(ann, {"type": "bid", "bid": 8}); g.act(bo, {"type": "bid", "bid": 8}); g.act(cy, {"type": "bid", "bid": 8})
check("rain washes an unsold table away", g.reveals[-1].get("washed") and len(g.table) == 1, g.table)
room = server.Room("EVT")
for x in ("Ann", "Bo"):
    room.add_player(x)
room.switch_game("lantern"); room.settings["events"] = True; room.start()
g = room.game
check("events never land on the last lot", g.deck[0] not in g.events and set(g.events.values()) <= {"mystery", "rain"})

room, (ann, bo), g = new_room(2)
room.deadline = 1
g.act(ann, {"type": "bid", "bid": 4})
g.on_timeout()
check("on time-out the slow bidder plays their lowest tile", 1 not in g.hands[bo.id] and len(g.rounds) == 1)

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
