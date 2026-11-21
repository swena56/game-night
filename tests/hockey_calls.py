"""Air Hockey callouts: 🧤 a fast puck stopped and sent back, 🚀 a very hard hit at the far goal, rate limited; slow hits are quiet.

    python3 tests/hockey_calls.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import hockey as H  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


r = server.Room("TEST")
r.add_player("Ann")
r.add_player("Bo")
r.switch_game("hockey")
r.start()
g = r.game
said = []
g.moment = lambda text, *a, **k: said.append(text)


def puck(vx, vy):
    p = H.Puck(0.5, 0.5)
    p.vx, p.vy = vx, vy
    return p


g.last_frame = 100.0
# seat 0 defends the bottom goal: a puck heading down (vy > 0) at 2.5 is stopped and sent up
pk = puck(0.0, -0.3)   # state after the hit
g.hit_call(0, pk, 2.5, True)
check("a fast puck sent back is a big save", len(said) == 1 and "big save" in said[0], said)
g.last_frame = 101.0
g.hit_call(0, puck(0.0, -2.6), 0.5, False)
check("callouts are rate limited", len(said) == 1, said)
g.last_frame = 110.0
g.hit_call(0, puck(0.0, -2.6), 0.5, False)
check("a very hard hit at the far goal is a rocket", len(said) == 2 and "rocket" in said[1], said)
g.last_frame = 120.0
g.hit_call(1, puck(0.0, 0.8), 0.3, False)
check("an ordinary hit is quiet", len(said) == 2, said)
g.hit_call(1, puck(0.0, -0.3), 2.5, True)   # seat 1 defends the top; a puck sent the wrong way isn't a save
check("a fast puck that still heads for your goal isn't a save", len(said) == 2, said)
sys.exit(1 if fails else 0)
