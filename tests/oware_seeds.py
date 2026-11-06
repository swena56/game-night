"""Oware seeds per pit (4 by default; 3 or 5): the board starts with that many, more than half the seeds in
play wins (25 of 48, 19 of 36, 31 of 60), and bots finish a game.

    python3 tests/oware_seeds.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import oware  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(seeds):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("oware")
    if seeds is not None:
        r.settings["seeds"] = seeds
    r.start()
    return r, r.game, ann


for seeds, goal in ((None, 25), (3, 19), (5, 31)):
    r, g, ann = game(seeds)
    check(f"{seeds or 4} a pit: goal {goal}", g.view(ann)["oware"]["goal"] == goal and sum(g.state[0]) == 2 * (goal - 1))
st = ((0,) * 12, (19, 17), 0)
check("3 a pit: 19 stops the game", oware.legal(st, 0) == [])
for seeds in (3, 5):
    r, g, ann = game(seeds)
    for p in r.seated():
        p.bot = "easy"
    for _ in range(400):
        if r.phase != "playing":
            break
        g.bot_turn(r.players[r.turn])
    check(f"bots finish a {seeds}-a-pit game", r.phase == "over")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
