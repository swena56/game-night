"""Hedgerow rules: hedges can't overlap, cross or seal anyone in; face-to-face pawns leap or slip
diagonally; the 🐇 hop goes through a hedge once.

    python3 tests/hedgerow_rules.py
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


def game(n=2):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("hedgerow")
    r.start()
    g = r.game
    seated = [r.players[i] for i in g.seats]
    return r, g, seated


def refused(fn):
    try:
        fn()
    except GameError:
        return True
    return False


r, g, (a, b) = game()
check("start positions", a.g.pos == (8, 4) and b.g.pos == (0, 4))
check("10 hedges each for two", a.g.hedges == b.g.hedges == 10)
g.act(a, {"type": "hedge", "o": "h", "r": 6, "c": 3})
check("hedge planted", a.g.hedges == 9 and len(g.hedges) == 1)
check("overlap refused", refused(lambda: g.act(b, {"type": "hedge", "o": "h", "r": 6, "c": 4})))
check("crossing refused", refused(lambda: g.act(b, {"type": "hedge", "o": "v", "r": 6, "c": 3})))
check("bad fields refused", refused(lambda: g.act(b, {"type": "hedge", "o": "x", "r": "1", "c": 0})))
check("not your turn", refused(lambda: g.act(a, {"type": "move", "r": 7, "c": 4})))

# sealing: a pawn in the top-left corner with a hedge to its right; a hedge under it would seal it in
r, g, (a, b) = game()
b.g.pos = (0, 0)
g.act(a, {"type": "hedge", "o": "v", "r": 0, "c": 0})
check("route still open", g.dist("N", (0, 0)) == 8)
check("sealing hedge refused", refused(lambda: g.act(b, {"type": "hedge", "o": "h", "r": 1, "c": 0})))
check("not in the legal list", ("h", 1, 0) not in g.legal_hedges() and ("h", 1, 1) in g.legal_hedges())

# face to face: leap, or slip diagonally when a hedge is behind
r, g, (a, b) = game()
a.g.pos, b.g.pos = (5, 4), (4, 4)
m = g.moves(a)
check("leap straight over", m.get((3, 4)) == "jump" and (4, 4) not in m)
g.cut |= set(g.hedge_cuts("h", 3, 4))  # hedge behind b
m = g.moves(a)
check("diagonal when blocked behind", (3, 4) not in m and m.get((4, 3)) == "jump" and m.get((4, 5)) == "jump")

# the hop
r, g, (a, b) = game()
g.cut |= set(g.hedge_cuts("h", 7, 4))
m = g.moves(a)
check("hop offered through a hedge", m.get((7, 4)) == "hop")
g.act(a, {"type": "move", "r": 7, "c": 4})
check("hop used up", a.g.hop is False and a.g.pos == (7, 4))
g.cut |= set(g.hedge_cuts("h", 5, 3))
a.g.pos = (6, 4)
check("no second hop", (5, 4) not in g.moves(a))

# four players, win
r, g, ps = game(4)
check("four sides", [p.g.side for p in ps] == ["S", "N", "W", "E"] and all(p.g.hedges == 5 for p in ps))
a = ps[0]
a.g.pos = (1, 0)
g.act(a, {"type": "move", "r": 0, "c": 0})
check("reaching the far edge wins", r.phase == "over")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
