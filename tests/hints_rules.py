#!/usr/bin/env python3
"""💡 The room's Hints setting (#32): by default hints work only while one person is playing (against bots);
the host can turn them on for everyone, or off even against bots. The server enforces it, and the daily
puzzles don't depend on it.

    python3 tests/hints_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []
OFF = "Hints are off at this table."


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(gid, humans=1, bots=1, **settings):
    r = server.Room("H" + gid[:3].upper())
    hs = [r.add_player(f"H{i}") for i in range(humans)]
    for _ in range(bots):
        r.add_bot("normal")
    r.switch_game(gid)
    r.settings.update(settings)
    r.start()
    return r, hs


def error(fn):
    try:
        fn()
    except GameError as e:
        return str(e)
    return None


for gid in ("sudoku", "minesweeper", "wordsearch", "ladder", "klondike", "garden"):
    r, (a,) = room(gid)
    check(f"{gid}: against bots, hints work by default", r.view(a)["hintsOk"] and error(lambda: r.act(a, {"type": "hint"})) != OFF)
    r, (a, b) = room(gid, humans=2, bots=0)
    check(f"{gid}: two people, off by default", not r.view(a)["hintsOk"] and error(lambda: r.act(a, {"type": "hint"})) == OFF)
    r, (a, b) = room(gid, humans=2, bots=0, assist="on")
    check(f"{gid}: the host can turn them on", error(lambda: r.act(a, {"type": "hint"})) != OFF)
    r, (a,) = room(gid, assist="off")
    check(f"{gid}: and off against bots too", error(lambda: r.act(a, {"type": "hint"})) == OFF)

r, (a, b) = room("ladder", humans=2, bots=0)
check("ladder: 🔎 is a hint too", error(lambda: r.act(a, {"type": "peek"})) == OFF)

r, (a,) = room("wordsmith")
check("wordsmith: a hint against a bot", error(lambda: r.game.peek(a, {"what": "hint"})) is None)
r, (a,) = room("wordsmith", assist="off")
check("wordsmith: none when off", error(lambda: r.game.peek(a, {"what": "hint"})) == OFF)
r, (a, b) = room("wordsmith", humans=2, bots=0, assist="on")
check("wordsmith: with people, when the host says so", error(lambda: r.game.peek(a, {"what": "hint"})) is None)

for gid, key in (("twentyone", "advice"), ("realm", "advice"), ("archery", "hint")):
    for mode, want in (("auto", True), ("off", False)):
        r, (a,) = room(gid, assist=mode)
        r.turn = r.turn and a.id
        v = r.view(a)
        got = v.get(gid, {}).get(key) if gid in v else None
        if not want:
            check(f"{gid}: no {key} in the view when off", got is None, str(got))

keys = []
for assist, autoplay in (("auto", True), ("off", False)):
    r, (a,) = room("sudoku", daily=True, assist=assist, autoplay=autoplay)
    keys.append(r.game.puzzle)
check("today's puzzle is the same whatever these settings say", keys[0] == keys[1])

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
