"""Ultimate Tic-Tac-Toe ⭐ Star board: win the starred small board and move again, anywhere; off by setting;
the bots play legal moves through the real path.

    python3 tests/ultimate_star.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import ultimate  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(**st):
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("ultimate")
    r.settings.update(st)
    r.start()
    return r, r.game


r, g = room()
check("star board set by default", g.star is not None and 0 <= g.star < 9)
r, g = room(star=False)
check("off: no star", g.star is None and g.view(r.players[r.turn])["ultimate"]["star"] is None)

# star board 3: me holds two in a row there, the third square wins it
r, g = room(star=True)
g.star = 3
me = r.players[r.turn]
i = g.seat(me)
cells = [None] * 81
cells[27], cells[28] = i, i
g.state = (tuple(cells), (None,) * 9, 3)
g.act(me, {"type": "mark", "cell": 29})
check("star won: same player still to move", r.turn == me.id and g.star is None, r.turn)
g.act(me, {"type": "undo_ask"})
g.act(next(q for q in r.players.values() if q.id != me.id), {"type": "undo_yes"})
check("undo restores the star and the turn", g.star == 3 and g.state[0][29] is None and r.turn == me.id, (g.star, r.turn))
g.act(me, {"type": "mark", "cell": 29})
check("star spent, play anywhere", ultimate.legal(g.state, i) and {m // 9 for m in ultimate.legal(g.state, i)} == set(range(9)) - {3})

# non-star board win passes the turn
r, g = room(star=True)
g.star = 5
me = r.players[r.turn]
i = g.seat(me)
cells = [None] * 81
cells[0], cells[1] = i, i
g.state = (tuple(cells), (None,) * 9, 0)
g.act(me, {"type": "mark", "cell": 2})
check("other board win passes the turn", r.turn != me.id and g.star == 5)

# off: winning that same board passes the turn
r, g = room(star=False)
me = r.players[r.turn]
i = g.seat(me)
cells = [None] * 81
cells[27], cells[28] = i, i
g.state = (tuple(cells), (None,) * 9, 3)
g.act(me, {"type": "mark", "cell": 29})
check("off: turn passes", r.turn != me.id)

# bots, real path, legal every move
for lvl in ("easy", "normal", "hard"):
    r = server.Room("TEST")
    r.add_bot(lvl)
    r.add_bot(lvl)
    r.switch_game("ultimate")
    r.start()
    g = r.game
    seen = 0
    for _ in range(120):
        if r.phase != "playing":
            break
        cur = r.players[r.turn]
        legal = ultimate.legal(g.state, g.seat(cur))
        orig = g.mark

        def checked(pl, c, orig=orig, legal=legal):
            check("bot move legal", c in legal, c)
            return orig(pl, c)
        g.mark = checked
        g.bot_turn(cur)
        del g.mark
        seen += 1
    check(f"{lvl} bots played", seen > 5, seen)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
