"""Briscola swap: trade the trump 7 for a stronger turned-up card on your turn; off by setting; bots stay legal.

    python3 tests/briscola_swap.py
"""
import os
import sys
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(swap=None):
    room = server.Room("TEST")
    for k in range(2):
        room.add_player(f"P{k}")
    room.switch_game("briscola")
    if swap is not None:
        room.settings["swap"] = swap
    room.start()
    g = room.game
    g.trump = "H"
    g.brisc = "AH"
    g.stock = ["2C", "4C", "5C", "AH"]
    g.hands[0] = ["7H", "2D", "4D"]
    lead = g.seats.index(room.turn)
    return room, g, lead


def btn(g, i):
    p = g.pl(i)
    return [b for b in (g.view(p)["briscola"].get("buttons") or []) if b["a"].get("type") == "swap"]


room, g, lead = table()
if lead != 0:
    g.to(0)
check("button offered", len(btn(g, 0)) == 1)
g.act(g.pl(0), {"type": "swap"})
check("hand gets the ace", "AH" in g.hands[0] and "7H" not in g.hands[0])
check("seven now turned up", g.brisc == "7H" and g.stock[-1] == "7H")
check("no second swap", not btn(g, 0))

room, g, _ = table(swap=0)
g.to(0)
try:
    g.act(g.pl(0), {"type": "swap"}); ok = False
except Exception:
    ok = True
check("off by setting", ok and not btn(g, 0))

room, g, _ = table()
g.to(0); g.stock = ["AH"]
check("not with a one-card stock", not btn(g, 0))
g.stock = ["2C", "4C", "5C", "2H"]; g.brisc = "2H"
check("not for a weaker card", not btn(g, 0))

for seed in range(4):
    room = server.Room("B%d" % seed)
    for k in range(3):
        room.add_player(f"B{k}")
    room.switch_game("briscola"); room.start(); g = room.game; random.seed(seed)
    for _ in range(200):
        if room.phase != "playing":
            break
        if g.stage == "play":
            g.bot_move(g.seats.index(room.turn), "hard")
        elif g.stage == "score":
            g.deal()
        for p in room.players.values():
            g.view(p)
    check(f"seed {seed}: game ends", room.phase != "playing")

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
