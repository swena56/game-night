"""Spire Siege 🎯 bounty: a spire that topples soon after taking junk pays its attacker an upgrade token; an old hit doesn't.

    python3 tests/spire_bounty.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def table(n=3):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("spire")
    r.start()
    return r, r.game, ps


r, g, (a, b, c) = table()
g.send(b, {"kind": "junk", "n": 2, "from": a.name}, by=a)
check("junk records the attacker", b.g.last_hit[0] == a.id)
t0 = a.g.upgrade_tokens
g.act(b, {"type": "topout"})
check("the finisher gets a token", a.g.upgrade_tokens == t0 + 1, a.g.upgrade_tokens)
check("a duel call isn't skipped: two left, game goes on", r.phase == "playing" and len(r.contenders()) == 2)

r, g, (a, b, c) = table()
g.send(b, {"kind": "junk", "n": 2, "from": a.name}, by=a)
b.g.last_hit = (a.id, time.time() - 60)
g.act(b, {"type": "topout"})
check("an old hit pays nothing", a.g.upgrade_tokens == 0)

r, g, (a, b, c) = table()
g.act(b, {"type": "topout"})
check("self-topout with no attacker pays nothing", a.g.upgrade_tokens == 0 and c.g.upgrade_tokens == 0)
sys.exit(1 if fails else 0)
