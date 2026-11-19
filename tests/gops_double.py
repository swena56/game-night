"""GOPS double down: once a game arm a bid, win it for 2x the prize, lose it and drop 3; off by setting; bots stay legal.

    python3 tests/gops_double.py
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


def table(double=None):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(2)]
    room.switch_game("gops")
    if double is not None:
        room.settings["double"] = double
    room.start()
    g = room.game
    ps.sort(key=lambda p: g.seat(p))
    g.pot = ["8D"]; g.prizes = ["2D", "3D"]
    return room, ps, g


def btn(g, p):
    return [b for b in (g.view(p)["gops"].get("buttons") or []) if b["a"].get("type") == "double"]


room, ps, g = table()
check("button offered", len(btn(g, ps[0])) == 1)
g.act(ps[0], {"type": "double"})
check("armed", 0 in g.armed)
g.act(ps[0], {"type": "bid", "card": "KC"})
g.act(ps[1], {"type": "bid", "card": "2S"})
check("double win pays 2x", g.scores[0] == 16, g.scores)
check("double spent", g.doubles[0] == 0)
check("doubled tag shown", "✌️ doubled" in g.view(ps[0])["gops"]["info"][0]["tags"])

room, ps, g = table()
g.scores = [5, 5]
g.act(ps[0], {"type": "double"}); g.act(ps[0], {"type": "bid", "card": "2C"})
g.act(ps[1], {"type": "bid", "card": "KS"})
check("double loss costs 3", g.scores[0] == 2 and g.scores[1] == 13, g.scores)

room, ps, g = table()
g.act(ps[0], {"type": "double"}); g.act(ps[0], {"type": "double"})
g.act(ps[0], {"type": "bid", "card": "KC"}); g.act(ps[1], {"type": "bid", "card": "2S"})
check("toggle off means a normal bid", g.scores[0] == 8 and g.doubles[0] == 1, g.scores)

room, ps, g = table()
g.doubles[0] = 0
try:
    g.act(ps[0], {"type": "double"}); ok = False
except Exception:
    ok = True
check("no double when spent", ok and not btn(g, ps[0]))

room, ps, g = table(double=0)
try:
    g.act(ps[0], {"type": "double"}); ok = False
except Exception:
    ok = True
check("off by setting", ok and not btn(g, ps[0]))

for seed in range(4):
    room = server.Room("B%d" % seed)
    for k in range(3):
        room.add_player(f"B{k}")
    room.switch_game("gops"); room.start(); g = room.game; random.seed(seed)
    for _ in range(80):
        if room.phase != "playing":
            break
        for i in list(g.waiting):
            g.bot_move(i, "hard")
        for p in room.players.values():
            g.view(p)
        g.pause_run() if hasattr(g, "pause_run") else None
        if g.stage == "show":
            g.next_prize()
    check(f"seed {seed}: game ends", room.phase != "playing")

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
