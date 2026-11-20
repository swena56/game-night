"""Sky Drop 🪙 coins, 💎 gems and 💥 mines: coins and gems sit on the course and pay when flown through,
mines are lethal (a long stun and a bigger penalty), and the full view carries the coins.

    python3 tests/skydrop_coins.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import skydrop as M  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []
CLOCK = [1_000_000.0]
M.time.time = lambda: CLOCK[0]   # the game reads time.time() for boosts and views; drive it by hand


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, bots=0, level="normal", **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("skydrop")
    for _ in range(bots):
        r.add_bot(level)
    r.settings.update(settings)
    CLOCK[0] += 1000
    r.start()
    return r, r.game, [p for p in r.players.values() if not p.spectator]


r, g, ps = game(2)
check("the course has coins and some gems", len(g.coins) > 40 and any(c[3] for c in g.coins) and any(not c[3] for c in g.coins), len(g.coins))
check("the full view carries the coins", len(r.game.view(ps[0])["skydrop"].get("coins", [])) == len(g.coins))
check("the fast view leaves them out", "coins" not in g.fast_view(CLOCK[0]))
f = g.flyers[0]
g.stage = "race"
g.race_started = CLOCK[0]
c = next(c for c in g.coins if not c[3])
f.depth, f.x, f.z = c[0] - 0.1, c[1], c[2]
before = f.score
g.simulate(0.05, CLOCK[0])
check("a coin on the line pays 2", f.score == before + M.COIN_PTS and f.coins == 1, (before, f.score))
gm = next(c for c in g.coins if c[3])
f.depth, f.x, f.z, f.last_ring = gm[0] - 0.1, gm[1], gm[2], 10**6
before = f.score
g.simulate(0.05, CLOCK[0])
check("a gem pays 10", f.score >= before + M.GEM_PTS and f.gems == 1, (before, f.score))
f.depth, f.x, f.z = gm[0] + 5, gm[1] + 6, gm[2]
f.score = 50
g.hazards = []
g.coins = [[f.depth + 0.05, f.x + 4, f.z, 0]]
g.simulate(0.05, CLOCK[0])
check("a coin well off the line is missed", f.score == 50 and f.coins == 1)
g.coins = []
g.hazards = [[f.depth + 0.4, f.x, f.z, 3, 0.0]]
f.stun_until = f.hit_cool_until = 0.0
f.score = 50
g.simulate(0.1, CLOCK[0])
check("a mine costs 12 points", f.score == 50 - M.MINE_PTS, f.score)
check("a mine stuns for over two seconds", f.stun_until - CLOCK[0] >= M.MINE_STUN - 0.01, f.stun_until - CLOCK[0])
check("a mine is its own event", any(e[1] == "boom" for e in g.events))
print("all ok" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
