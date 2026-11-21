"""Qork 🔥 escape streak: every 3rd clean escape in a row pays a bonus point; a trap or early yank resets it.

    python3 tests/qork_streak.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import qork  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ann, bo, cy = (r.add_player(n) for n in ("Ann", "Bo", "Cy"))
r.switch_game("qork")
r.start()
g = r.game
corker = next(p for p in (ann, bo, cy) if p.id != g.cupper)


def round_(ms):
    g.stage = "snap"
    g.acted = {g.cupper: 700, corker.id: ms}
    for q in r.contenders():
        g.acted.setdefault(q.id, 500)
    g.acted[corker.id] = ms
    g.resolve()


s0 = corker.g.score
round_(300); round_(300)
check("two escapes: +1 each, no bonus", corker.g.score == s0 + 2, corker.g.score - s0)
round_(300)
check("third escape: bonus", corker.g.score == s0 + 4 and corker.g.streak == 3, corker.g.score - s0)
round_(900)
check("trapped resets", corker.g.streak == 0)
g.stage = "snap"
g.react(corker, -5)
check("early yank keeps it at 0", corker.g.streak == 0)
sys.exit(1 if fails else 0)
