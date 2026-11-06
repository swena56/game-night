"""Tic-Tac-Toe 🙃 Misère (a Variant choice): whoever completes a line loses; the hard bot never loses on 3×3.

    python3 tests/tictactoe_misere.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(variant):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("tictactoe")
    if variant:
        r.settings["variant"] = variant
    r.start()
    return r, r.game


r, g = game("misere")
a, b = (r.players[i] for i in g.seats)
for cell, p in ((0, a), (3, b), (1, a), (4, b), (2, a)):
    g.act(p, {"type": "move", "cell": cell})
check("misère: making three in a row loses", r.phase == "over" and r.winner == b.id)

lost = 0
for seed in range(20):
    random.seed(seed)
    r, g = game("misere")
    a, b = (r.players[i] for i in g.seats)
    b.bot = "hard"
    while r.phase == "playing":
        p = r.players[r.turn]
        if p.bot:
            g.bot_turn(p)
        else:
            free = [i for i, v in enumerate(g.cells) if v is None]
            g.act(p, {"type": "move", "cell": random.choice(free)})
    lost += r.winner == a.id
check("the hard bot never loses misère", lost == 0, lost)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
