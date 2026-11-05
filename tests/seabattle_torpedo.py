"""Sea Battle 💥 Torpedo: off by default; on, each player can once fire at three squares in a line as one
shot (squares already fired at and off the sea are skipped), and a torpedo can win the game.

    python3 tests/seabattle_torpedo.py
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


def battle(torpedo, shots="classic"):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("seabattle")
    if torpedo is not None:
        r.settings["torpedo"] = torpedo
    r.settings["shots"] = shots
    r.start()
    g = r.game
    for p in (ann, bo):
        p.g.ships = [{"name": "Boat", "cells": [(0, 0), (0, 1)], "hits": set()},
                     {"name": "Raft", "cells": [(5, 5), (6, 5)], "hits": set()}]
    g.stage = "firing"
    g.begin(ann)
    return r, g, ann, bo


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


r, g, ann, bo = battle(None)
check("off by default: no torpedo", g.view(ann)["sea"]["torpedo"] == 0)
check("off by default: firing one is refused", refused(g, ann, {"type": "torpedo", "r": 0, "c": 1}) is not None)

r, g, ann, bo = battle(True)
check("on: one torpedo each", g.view(ann)["sea"]["torpedo"] == 1 and g.view(bo)["sea"]["torpedo"] == 1)
g.act(ann, {"type": "torpedo", "r": 0, "c": 1, "dir": "h"})
check("it hits the three squares across", {(0, 0), (0, 1), (0, 2)} <= set(ann.g.shots), str(sorted(ann.g.shots)))
check("…sinking the boat", ann.g.shots[(0, 0)] == "sunk" and ann.g.shots[(0, 1)] == "sunk")
check("…and the miss is a miss", ann.g.shots[(0, 2)] == "miss")
check("it counts as one shot: the turn passes", r.turn == bo.id)
check("Ann's torpedo is spent", g.view(ann)["sea"]["torpedo"] == 0)
g.act(bo, {"type": "fire", "r": 9, "c": 9})
check("a second torpedo is refused", refused(g, ann, {"type": "torpedo", "r": 5, "c": 5}) is not None)

r, g, ann, bo = battle(True)
g.act(ann, {"type": "torpedo", "r": 0, "c": 0, "dir": "h"})
check("at the edge only the squares on the sea are hit", set(ann.g.shots) == {(0, 0), (0, 1)}, str(sorted(ann.g.shots)))

r, g, ann, bo = battle(True)
for cell in [(0, 0), (0, 1)]:
    bo.g.ships[0]["hits"].add(cell)
g.act(ann, {"type": "torpedo", "r": 6, "c": 5, "dir": "v"})
check("a torpedo that sinks the last ship wins", r.phase == "over", r.phase)

r, g, ann, bo = battle(True, shots="chain")
g.act(ann, {"type": "torpedo", "r": 0, "c": 1, "dir": "h"})
check("with Hit = fire again, a torpedo hit keeps the turn", r.turn == ann.id)

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
