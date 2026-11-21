"""Sky Drift 🔥 pennant streak: a pennant three turns running refuels the burner by one; a miss or a storm throw resets it.

    python3 tests/drift_streak.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


r = server.Room("TEST")
a, b = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("drift")
r.start()
g = r.game
said = []
g.moment = lambda text, *x, **k: said.append(text)
f0 = g.fuel[a.id]
g.update_streaks({a.id: 1, b.id: 0})
g.update_streaks({a.id: 2, b.id: 0})
check("two turns running: no bonus yet", g.fuel[a.id] == f0 and not said)
g.update_streaks({a.id: 1, b.id: 0})
check("third turn running: +1 burner and a callout", g.fuel[a.id] == f0 + 1 and len(said) == 1, said)
check("a rival with no pennants gets nothing", g.fuel[b.id] == g.fuel[b.id] and g.streaks[b.id] == 0)
g.update_streaks({a.id: 0, b.id: 0})
check("a miss resets the streak", g.streaks[a.id] == 0)
g.update_streaks({a.id: 1})
g.update_streaks({a.id: 1})
g.update_streaks({a.id: 1}, flung={a.id: [0, 0, 0]})
check("a storm throw resets it too", g.streaks[a.id] == 0 and g.fuel[a.id] == f0 + 1)
sys.exit(1 if fails else 0)
