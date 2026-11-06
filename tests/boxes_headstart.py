"""Dots & Boxes ✏️ Head start (off by default): about a quarter of the lines start drawn (by nobody), never
a box's third side; bots then play the game out.

    python3 tests/boxes_headstart.py
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


def grid(head, size=5):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("boxes")
    r.settings["size"] = size
    if head is not None:
        r.settings["headstart"] = head
    r.start()
    return r, r.game, ann, bo


r, g, ann, bo = grid(None)
check("off by default: an empty grid", not g.drawn())
for _ in range(5):
    r, g, ann, bo = grid(True)
    total = len(g.lines())
    worst = max(sum(g.is_drawn(ln) for ln in g.sides_of(b)) for b in g.cells())
    check("head start: a quarter drawn, no box past two sides", abs(len(g.drawn()) - total // 4) <= 2 and worst <= 2, (len(g.drawn()), total, worst))
for p in (ann, bo):
    p.bot = "normal"
for _ in range(200):
    if r.phase != "playing":
        break
    g.bot_turn(r.players[r.turn])
check("bots finish a head-start game", r.phase == "over" and sum(p.g.boxes for p in (ann, bo)) == 25)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
