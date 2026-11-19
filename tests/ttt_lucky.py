"""Tic-Tac-Toe ⭐ Lucky square: claiming it means moving again; off by setting and in Misère; bots stay legal.

    python3 tests/ttt_lucky.py
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


def room(**st):
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("tictactoe")
    r.settings.update(st)
    r.start()
    return r, r.game


r, g = room()
check("lucky square set", g.bonus is not None and 0 <= g.bonus < 9)
first = r.turn
plain = next(i for i in range(9) if i != g.bonus)
g.act(r.players[first], {"type": "move", "cell": plain})
check("plain move passes the turn", r.turn != first)
p = r.players[r.turn]
b = g.bonus
g.act(p, {"type": "move", "cell": b})
check("lucky claim keeps the turn", r.turn == p.id and g.bonus is None and g.cells[b] is not None)
free = next(i for i, v in enumerate(g.cells) if v is None)
g.act(p, {"type": "move", "cell": free})
check("then the turn passes", r.turn != p.id)
check("view carries bonus", "bonus" in g.view(p)["ttt"])

for st, name in (({"lucky": False}, "off"), ({"variant": "misere"}, "misere")):
    r, g = room(**st)
    check(f"no lucky square when {name}", g.bonus is None)

# bots: never swallow errors, every move must be legal and the game must finish
for variant in ("classic", "vanishing"):
    for size in (3, 4):
        for lvl in ("easy", "normal", "hard"):
            r = server.Room("TEST")
            ps = [r.add_player(n) for n in ("A", "B")]
            for q in ps:
                q.bot = lvl
            r.switch_game("tictactoe")
            r.settings.update(variant=variant, size=size)
            r.start()
            g = r.game
            for _ in range(200):
                if r.phase != "playing":
                    break
                cur = r.players[r.turn]
                orig = g.move

                def legal_move(pl, cell, orig=orig, g=g):
                    check("bot move is on an empty square", isinstance(cell, int) and g.cells[cell] is None)
                    return orig(pl, cell)
                g.move = legal_move
                g.bot_turn(cur)
                del g.move
            check(f"bots finish {variant} {size} {lvl}", r.phase != "playing", r.phase)

print("FAILED" if fails else "ALL OK")
sys.exit(1 if fails else 0)
