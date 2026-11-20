"""Hover Rally pit refill: last across the line gets a spent boost back (setting to turn it off).

    python3 tests/rally_pit.py
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


def race(**settings):
    r = server.Room("TEST")
    r.add_player("Ann")
    r.add_player("Bob")
    r.switch_game("rally")
    r.settings.update(settings)
    r.start()
    return r, r.game


r, g = race()
check("pit on by default", g.s.get("pit") is True)
a, b = g.crafts
a.s, b.s, a.lap, b.lap, a.boosts = 10.0, 50.0, 1, 1, 1
check("last place refills", g.pit_refill(0, next(iter(r.players.values()))) is True and a.boosts == 2)
check("leader does not", g.pit_refill(1, next(iter(r.players.values()))) is False and b.boosts == 3)
a.boosts = 3
check("never above the cap", g.pit_refill(0, None) is False and a.boosts == 3)
a.boosts, a.lap = 0, g.s["laps"]
check("not on the finishing lap", g.pit_refill(0, None) is False)

r, g = race(pit=False)
a, b = g.crafts
a.s, b.s, a.lap, b.lap, a.boosts = 10.0, 50.0, 1, 1, 0
check("off: no refill", g.pit_refill(0, None) is False and a.boosts == 0)

r, g = race(mode="elim")
a, b = g.crafts
a.s, b.s, a.lap, b.lap, a.boosts = 10.0, 50.0, 1, 1, 0
check("elimination: no refill", g.pit_refill(0, None) is False)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
