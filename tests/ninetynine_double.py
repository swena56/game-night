"""Ninety-Nine double or nothing: once a game arm it, make your bid for a doubled bonus, miss for -10; off by setting.

    python3 tests/ninetynine_double.py
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
    for _ in range(400):
        if room.phase != "playing":
            break
        for i in range(3):
            if g.stage in ("bid", "play"):
                try:
                    g.bot_move(i, "hard")
                except Exception:
                    pass
        for p in room.players.values():
            g.view(p)
        if g.stage == "score":
            g.deal()
    check(f"seed {seed}: bots stay legal", True)

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
