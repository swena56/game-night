"""First badges for Air Hockey (🧤 Shutout), Spire Siege (🗼 Four at once) and Doodle Dash (⚡ Quick draw).

    python3 tests/action_badges.py
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


def room(game, n=2):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game(game)
    r.start()
    r.push_fast = lambda *a, **k: None
    return r, r.game, ps


# hockey: a 5-0 win is a shutout, a 5-1 win isn't
r, g, (ann, bo) = room("hockey")
g.score = [g.s["target"] - 1, 0]
import time
g.goal(0, 0, time.time())
won = r.players.get(g.seats[0])
check("hockey: a shutout win", r.phase == "over" and (won.badges or {}).get("hockey:shutout") == 1, (r.phase, g.score, won.badges))

# spire: four rings at once
r, g, (ann, bo) = room("spire")
g.on_clear(ann, 4, 0, [])
check("spire: four rings at once", (ann.badges or {}).get("spire:quad") == 1)
g.on_clear(bo, 3, 0, [])
check("spire: three isn't four", not (bo.badges or {}).get("spire:quad"))

# doodle: a guess in the first quarter of the drawing
r, g, (ann, bo) = room("doodle")
g.stage = "draw"
g.t0 = g.now()
g.act(ann, {"type": "guess", "text": g.pic[0]})
check("doodle: a quick draw", (ann.badges or {}).get("doodle:quick") == 1, ann.badges)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
