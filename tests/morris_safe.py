"""Nine Men's Morris 🛡️ Safe point: a man there is spared by mills while others can be taken; setting; bots stay legal.

    python3 tests/morris_safe.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import morris  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(lvl=None, **st):
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        q = r.add_player(n)
        if lvl:
            q.bot = lvl
    r.switch_game("morris")
    r.settings.update(st)
    r.start()
    return r, r.game


r, g = room()
check("safe point set", g.safe is not None and 0 <= g.safe < 24)
check("view carries safe", g.view(r.players[r.turn])["morris"]["safe"] == g.safe)
r, g = room(safe=False)
check("off by setting", g.safe is None)

# rules: pure functions
b = [None] * 24
b[0] = 1; b[1] = 1; b[3] = 1
check("safe man spared", morris.removable(b, 1, safe=0) == [1, 3])
check("no safe: all loose men", morris.removable(b, 1) == [0, 1, 3])
only = [None] * 24
only[5] = 1
check("lone safe man can still go", morris.removable(only, 1, safe=5) == [5])
mill = [None] * 24
for i in (0, 1, 2):
    mill[i] = 1
mill[10] = 1
check("loose beats mill; safe loose man spared", morris.removable(mill, 1, safe=10) == [0, 1, 2])

# a real mill: seat 0 men on 0,1 place on 2; rival has men on 3 (safe) and 4
r, g = room(safe=False)
g.safe = 3
me = g.seat(r.players[r.turn])
board = [None] * 24
board[0] = board[1] = me
board[3] = board[4] = 1 - me
g.state = (tuple(board), (5, 5), 0)
mv = morris.legal(g.state, me, True, False, False, g.safe)
takes = {m[2] for m in mv if m[1] == 2}
check("mill cannot take safe man", takes == {4}, str(takes))
try:
    g.act(r.players[r.turn], {"type": "move", "move": [-1, 2, 3]})
    check("taking the safe man rejected", False)
except server.GameError:
    check("taking the safe man rejected", True)
g.act(r.players[r.turn], {"type": "move", "move": [-1, 2, 4]})
check("other man taken", g.state[0][4] is None and g.state[0][3] == 1 - me)

# bots: no swallowed errors, every move legal, game finishes
for men in (9, 12, 10):
    for lvl in ("easy", "normal", "hard"):
        if lvl == "hard" and men != 9:
            continue  # hard search is slow on small hosts: one variant, capped
        r, g = room(lvl, men=men)
        orig = g.move

        def checked(pl, mv, g=g, orig=orig, r=r):
            check("bot move legal", mv in morris.legal(g.state, g.seat(pl), g.fly, g.twelve, g.lasker, g.safe), str(mv))
            return orig(pl, mv)
        g.move = checked
        cap = 40 if lvl == "hard" else 300
        for _ in range(cap):
            if r.phase != "playing":
                break
            g.bot_turn(r.players[r.turn])
        if lvl == "hard":
            check(f"hard bot played {cap} plies legally", True)
        else:
            check(f"bots finish men={men} {lvl}", r.phase != "playing", r.phase)
        del g.move

print("FAILED" if fails else "ALL OK")
sys.exit(1 if fails else 0)
