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

# bots through the real frame(): a short race (2 laps) simulated at 20 fps with a wall-clock cap
import time  # noqa: E402

for level in ("hard", "normal"):
    r = server.Room("TEST")
    r.add_bot(level)
    r.add_bot(level)
    r.add_bot(level)
    r.switch_game("rally")
    r.settings.update(laps=2, missiles=True)
    r.start()
    g = r.game
    fired, bad, errs = [], [], []
    orig = g.pit_refill

    def wrapped(i, p, orig=orig, g=g, fired=fired, bad=bad):
        c = g.crafts[i]
        before = c.boosts
        res = orig(i, p)
        if res:
            fired.append(i)
            if c.boosts != before + 1 or c.boosts > 3 or not any(o.s > c.s and o.finished is None for o in g.crafts if o is not c):
                bad.append((i, before, c.boosts))
        return res

    g.pit_refill = wrapped
    t0, now, cap = time.time(), time.time(), 40.0
    try:
        while g.stage != "over" and r.phase != "over" and time.time() - t0 < cap and now - t0 < 400:
            now += 0.05
            with r.cond:
                g.frame(now)
            if any(c.boosts > 3 for c in g.crafts):
                bad.append("cap")
    except Exception as e:  # noqa: BLE001
        errs.append(repr(e))
    done = all(c.finished is not None for c in g.crafts) or r.phase == "over"
    check(f"{level} bots: no exceptions", not errs, str(errs))
    check(f"{level} bots: race completes", done, f"stage={g.stage} laps={[c.lap for c in g.crafts]}")
    check(f"{level} bots: refills obey the rule", not bad, str(bad))
    print(f"     {level}: pit refills fired {len(fired)}")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
