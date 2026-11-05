"""Shut the Box 📦 Shut it, win it (off by default): shutting the box wins the game at once (with company).

    python3 tests/shutbox_instant.py
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


def box(instant):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("shutbox")
    if instant is not None:
        r.settings["instant"] = instant
    r.start()
    g = r.game
    me = r.players[r.turn]
    me.g.tiles = [4]
    g.dice, g.rolled = [1, 3], True
    return r, g, me


r, g, me = box(None)
g.shut(me, [4])
check("off by default: the game goes on", r.phase == "playing")
r, g, me = box(True)
g.shut(me, [4])
check("on: shutting the box wins at once", r.phase == "over" and r.winner == me.id)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
