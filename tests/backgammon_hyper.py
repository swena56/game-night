"""Backgammon ⚡ Hypergammon (Checkers setting; 15 each by default): three checkers each on the rival's three
deepest points, and bearing off all three wins.

    python3 tests/backgammon_hyper.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import backgammon as bg  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(variant):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("backgammon")
    if variant is not None:
        r.settings["variant"] = variant
    r.start()
    return r, r.game, ann, bo


r, g, ann, bo = table(None)
check("default: 15 each", sum(v for v in g.pos[1:25] if v > 0) == 15 and g.total() == 15)
r, g, ann, bo = table("hyper")
check("hyper: 3 each", sum(v for v in g.pos[1:25] if v > 0) == 3 and sum(-v for v in g.pos[1:25] if v < 0) == 3)
check("view says 3", g.view(ann)["backgammon"]["total"] == 3)

# bots play a hypergammon game to the end
for p in (ann, bo):
    p.bot = "normal"
for _ in range(600):
    if r.phase != "playing":
        break
    if g.bot_ready():
        g.bot_tick()
    else:
        break
check("bots finish a hypergammon game", r.phase == "over", r.phase)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
