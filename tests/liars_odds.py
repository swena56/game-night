"""Liar's Dice 📊 bid estimates: every bid this round carries the chance it holds, worked out from the
dice count and the dice on show only (never anyone's hidden dice), with wild 1s and palifico rounds.

    python3 tests/liars_odds.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import liars as L  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(**settings):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy")]
    r.switch_game("liars")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


r, g, ps = table(wild=True)
me = r.players[r.turn]
g.act(me, {"type": "bid", "qty": 4, "face": 3})
nxt = r.players[r.turn]
g.act(nxt, {"type": "bid", "qty": 6, "face": 5})
odds = g.view(ps[0])["liars"]["bidOdds"]
check("one estimate per bid", len(odds) == 2, odds)
check("wild 1s: each die counts a third of the time", odds == [round(100 * L.at_least(4, 15, 1 / 3)), round(100 * L.at_least(6, 15, 1 / 3))], odds)
before = json.dumps([g.view(p)["liars"]["bidOdds"] for p in ps])
for p in ps:
    p.g.dice = [5] * len(p.g.dice)          # whatever is under the cups...
check("hidden dice never move the estimate, and every seat sees the same", json.dumps([g.view(p)["liars"]["bidOdds"] for p in ps]) == before)
watcher = r.add_player("Eve")
check("a watcher sees the same estimates", g.view(watcher)["liars"]["bidOdds"] == odds)

r, g, ps = table(wild=False)
me = r.players[r.turn]
g.act(me, {"type": "bid", "qty": 3, "face": 1})
check("wilds off: a sixth of the time, and 1s can be bid", g.view(me)["liars"]["bidOdds"] == [round(100 * L.at_least(3, 15, 1 / 6))])

r, g, ps = table(wild=True, palifico=True)
g.new_round(ps[0].id, palifico=True)
g.act(ps[0], {"type": "bid", "qty": 2, "face": 4})
check("palifico: 1s aren't wild, so a sixth", g.view(ps[1])["liars"]["bidOdds"] == [round(100 * L.at_least(2, 15, 1 / 6))])

r, g, ps = table(wild=True, reroll=True)
me = r.players[r.turn]
me.g.dice = [1, 2, 5, 5, 6]
g.act(me, {"type": "reroll", "show": [0, 2, 3]})   # a 1 and two 5s on show for everyone
g.act(me, {"type": "bid", "qty": 5, "face": 5})
check("dice on show count as known (a wild 1 too)", g.view(ps[0])["liars"]["bidOdds"] == [round(100 * L.at_least(2, 12, 1 / 3))])
for p in ps:
    del p.g.shown                            # a game saved before Show & reroll
check("old saves without dice on show still estimate", g.view(ps[0])["liars"]["bidOdds"] == [round(100 * L.at_least(5, 15, 1 / 3))])

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
