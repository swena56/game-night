"""Blackjack 📋 hands panel: your own view lists each hand's stake and state against the dealer's up-card, with
basic strategy's advisory move for every hand still to play. The advice follows the table's rules (surrender
on/off, doubles and splits only with the chips for them, the split limit) and handles split aces.

    python3 tests/blackjack_plan.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(deal, surrender=None, bo=False, rest="2C"):
    room = server.Room("TEST")
    ps = [room.add_player("Ann")] + ([room.add_player("Bo")] if bo else [])
    room.switch_game("twentyone")
    if surrender is not None:
        room.settings["surrender"] = surrender
    room.start()
    g = room.game
    g.shoe = [rest] * 60 + list(reversed(deal))   # seats in order, dealer up; again, dealer hole; then `rest`
    return room, ps, g


def plan(g, p):
    return g.view(p)["twentyone"]["plan"]


# 8,8 v 6: one hand, split advised; nothing during betting
room, (ann,), g = table(["8C", "6D", "8H", "TS"])
check("no panel while betting", plan(g, ann) is None)
g.act(ann, {"type": "bet", "amount": 20})
pl = plan(g, ann)
check("one hand: stake, total, up-card", pl and pl["up"] == "6D" and pl["hands"][0]["bet"] == 20 and pl["hands"][0]["total"] == 16, pl)
check("advice for the hand: split 8s", pl["hands"][0]["advice"] == "split" and pl["hands"][0]["state"] == "now")
check("same as the button tip", pl["hands"][0]["advice"] == g.view(ann)["twentyone"]["advice"])
check("replay viewer / spectators get no panel", g.view(server.REPLAY_VIEWER)["twentyone"]["plan"] is None)

g.act(ann, {"type": "split"})   # 8+2 and 8+2: 10 v 6 → double each (chips allow)
pl = plan(g, ann)
check("split: two hands listed", len(pl["hands"]) == 2, pl)
check("split: each with its own stake", [h["bet"] for h in pl["hands"]] == [20, 20])
check("split: playing hand 1, hand 2 next", [h["state"] for h in pl["hands"]] == ["now", "next"])
check("split: advice per hand (10 v 6: double)", [h["advice"] for h in pl["hands"]] == ["double", "double"], pl)
check("free chips shown", pl["chips"] == 100 - 40)
g.act(ann, {"type": "double"})
pl = plan(g, ann)
check("after doubling hand 1: done, stake 40", pl["hands"][0]["state"] == "done" and pl["hands"][0]["bet"] == 40 and pl["hands"][0]["advice"] is None, pl)
check("hand 2 is now in play", pl["hands"][1]["state"] == "now" and pl["hands"][1]["advice"] == "double")

# not enough chips to double: advice falls back to hit
room, (ann,), g = table(["8C", "6D", "8H", "TS"])
g.chips[0] = 40
g.act(ann, {"type": "bet", "amount": 20})
g.act(ann, {"type": "split"})
pl = plan(g, ann)
check("no spare chips: 10 v 6 advises hit, not double", [h["advice"] for h in pl["hands"]] == ["hit", "hit"], pl)

# split aces: one card each, both done straight away (the panel shows them, the hand moves on)
room, (ann, bo), g = table(["AC", "TC", "6D", "AH", "TD", "TS"], bo=True)
g.act(ann, {"type": "bet", "amount": 10})
g.act(bo, {"type": "bet", "amount": 10})
g.act(ann, {"type": "split"})
pl = plan(g, ann)
check("split aces: both hands done, noted", pl and all(h["state"] == "done" and h["note"] == "split aces: one card each" and h["advice"] is None for h in pl["hands"]), pl)
check("split aces: turn moved on to Bo", room.turn == bo.id)
pb = plan(g, bo)
check("Bo's panel shows only Bo's hand", pb and len(pb["hands"]) == 1 and pb["hands"][0]["total"] == 20 and pb["hands"][0]["advice"] == "stand", pb)

# surrender on: 16 v 10 advises surrender on two cards, never after a split
room, (ann,), g = table(["TC", "TD", "6H", "8S"], surrender=True)
g.act(ann, {"type": "bet", "amount": 20})
check("surrender on: 16 v 10 → surrender", plan(g, ann)["hands"][0]["advice"] == "surrender" and plan(g, ann)["surrender"])
room, (ann,), g = table(["TC", "TD", "6H", "8S"], surrender=False)
g.act(ann, {"type": "bet", "amount": 20})
check("surrender off: 16 v 10 → hit", plan(g, ann)["hands"][0]["advice"] == "hit" and not plan(g, ann)["surrender"])
room, (ann,), g = table(["8C", "TD", "8H", "8S"], surrender=True, rest="8D")   # 8,8 v 10, then 8s: 16 each
g.act(ann, {"type": "bet", "amount": 10})
g.act(ann, {"type": "split"})
pl = plan(g, ann)
check("after a split: no surrender advice (16 v 10 → hit or split)", all(h["advice"] in ("hit", "split") for h in pl["hands"]), pl)
check("split limit: 4 hands at most, then no split advice", True)
for _ in range(3):
    if g.can_split(0):
        g.act(ann, {"type": "split"})
pl = plan(g, ann)
check("split limit reached: no hand advises split", len(pl["hands"]) == 4 and all(h["advice"] != "split" for h in pl["hands"]), pl)

# bust and the dealer's turn
room, (ann,), g = table(["TC", "6D", "6H", "TS"], rest="TH")
g.act(ann, {"type": "bet", "amount": 10})
g.act(ann, {"type": "hit"})
check("after the hands are played the panel goes", plan(g, ann) is None and g.stage in ("dealer", "settle"))

# a saved game: hands with no 'surr' key, views still fine
room, (ann,), g = table(["8C", "6D", "8H", "TS"])
g.act(ann, {"type": "bet", "amount": 20})
for h in g.hands[0]:
    h.pop("surr", None)
check("old saved hands still view", plan(g, ann) is not None)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
