"""Sea Battle 📡 Bounty (off by default): sinking a ship (but not the last) earns a sonar scan.

    python3 tests/seabattle_bounty.py
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


def battle(bounty):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("seabattle")
    if bounty is not None:
        r.settings["bounty"] = bounty
    r.settings["shots"] = "classic"
    r.start()
    g = r.game
    for p in (ann, bo):
        p.g.ships = [{"name": "Boat", "cells": [(0, 0), (0, 1)], "hits": set()},
                     {"name": "Raft", "cells": [(5, 5), (6, 5)], "hits": set()}]
    g.stage = "firing"
    g.begin(ann)
    return r, g, ann, bo


r, g, ann, bo = battle(None)
before = ann.g.sonar
g.strike(ann, 0, 0); g.strike(ann, 0, 1)
check("off by default: no extra scan", ann.g.sonar == before)
r, g, ann, bo = battle(True)
before = ann.g.sonar
g.strike(ann, 0, 0); g.strike(ann, 0, 1)
check("on: a sunk ship earns a scan", ann.g.sonar == before + 1, (before, ann.g.sonar))
g.strike(ann, 5, 5); g.strike(ann, 6, 5)
check("the last ship ends the game, no scan needed", r.phase == "over" and ann.g.sonar == before + 1)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
