"""Meteor Shot ⚔️ shoot-off: a tie at the top gets one more shot each (best wins); a re-tie repeats up to 3 times then draws;
a missed shoot-off shot scores 0; no tie, no shoot-off.

    python3 tests/meteorshot_shootoff.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import meteorshot as M  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def table(n=3):
    names = ("Ann", "Bo", "Cy")
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in names[:n]]
    r.switch_game("meteorshot")
    r.start()
    g = r.game
    return r, g, ps


def shoot(g, p, pts):
    real = M.points_for
    M.points_for = lambda *a, **k: pts
    try:
        g.act(p, {"type": "fire", "angle": 45, "power": 14, "aim": 0})
    finally:
        M.points_for = real


r, g, (a, b, c) = table()
for p, sc in ((a, 100), (b, 100), (c, 50)):
    p.g.score = sc
    p.g.shots = g.shots
g.end()
check("a two-way tie at the top starts a shoot-off", r.phase == "playing" and set(g.sd) == {a.id, b.id}, g.sd)
check("the third player is skipped", g.skip_turn(c) and not g.skip_turn(a))
first = r.players[r.turn]
second = b if first.id == a.id else a
shoot(g, first, 40)
check("after one shot, the other tied player is up", r.turn == second.id, r.turn)
shoot(g, second, 70)
check("the better shoot-off shot wins the match", r.phase != "playing" and r.winner == second.id if hasattr(r, "winner") else r.phase != "playing")

r, g, (a, b, c) = table()
for p, sc in ((a, 90), (b, 70), (c, 50)):
    p.g.score, p.g.shots = sc, g.shots
g.end()
check("no tie, no shoot-off", r.phase != "playing" and not getattr(g, "sd", None))

r, g, (a, b) = table(2)
for p in (a, b):
    p.g.score, p.g.shots = 100, g.shots
g.end()
for k in range(3):
    check(f"shoot-off {k + 1} is running", r.phase == "playing" and g.sd, r.phase)
    first = r.players[r.turn]
    other = b if first.id == a.id else a
    shoot(g, first, 55)
    shoot(g, other, 55)
check("after three level shoot-offs it is a draw", r.phase != "playing")

r, g, (a, b) = table(2)
for p in (a, b):
    p.g.score, p.g.shots = 100, g.shots
g.end()
first = r.players[r.turn]
other = b if first.id == a.id else a
g.on_timeout()
check("a timed-out shoot-off shot scores 0", g.sd_scores.get(first.id) == 0 and r.turn == other.id)
sys.exit(1 if fails else 0)
