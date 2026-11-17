"""Coin Cascade rules: the shelf's stroke, the pile shoves without overlaps, coins over the front edge score for the
tray below them (⭐ 3), the open sides lose coins (and side guards stop that), a handful is three coins, drops end with
the shelf all the way out, bells give bonuses, bad drops are refused, the turn passes, bots play whole games.

    python3 tests/pusher_rules.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import pusher as P  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


check("the shelf is back at phase 0", abs(P.face_at(0) - P.FACE[0]) < 1e-9)
check("and all the way out at phase 0.5", abs(P.face_at(0.5) - P.FACE[1]) < 1e-9)
for ph in (0.0, 0.2, 0.5, 0.77):
    t = P.run_time(ph)
    if not (t >= P.SIM_T - 1e-9 and abs(P.face_at(ph + t / P.PERIOD) - P.FACE[1]) < 0.01):
        break
else:
    t = None
check("every drop runs at least SIM_T and ends with the shelf out", t is None)
check("owners split the edge", P.owner_of(-P.HW + 0.01, 3) == 0 and P.owner_of(0, 3) == 1 and P.owner_of(P.HW - 0.01, 3) == 2)

# a coin in front of the face gets shoved forward by the stroke
coins = [[1, 0.0, P.FACE[0] + P.R_COIN + 0.01, P.R_COIN, 0]]
P.simulate(coins, 0.0, 2, frames=False)
check("the shelf shoves a coin forward", coins[0][2] >= P.FACE[1] + P.R_COIN - 0.01, f"{coins[0][2]:.2f}")

# a column of coins pushed over the edge scores for the tray below
col = [[k + 1, 2.0, P.FACE[0] + P.R_COIN + 0.02 + k * 2 * P.R_COIN, P.R_COIN, 1 if k == 6 else 0] for k in range(7)]
falls, frames = P.simulate(col, 0.0, 3)
check("the front of a jammed column goes over the edge", len(falls) >= 1 and all(f[3] == 2 for f in falls), str(falls))
check("a ⭐ token among them", any(f[1] == 1 for f in falls))
check("frames are recorded", len(frames) > 10 and all(isinstance(f[1], list) for f in frames))
ok = True
for a in range(len(col)):
    for b in range(a + 1, len(col)):
        if math.hypot(col[a][1] - col[b][1], col[a][2] - col[b][2]) < col[a][3] + col[b][3] - 0.05:
            ok = False
check("no two coins left deep inside each other", ok)

# open sides lose coins near the front; guards keep them
side = [[1, P.HW + 0.2, P.GAP_Y + 0.5, P.R_COIN, 0]]
falls, _ = P.simulate(side, 0.5, 2, frames=False)
check("off the open side into the gutter", falls and falls[0][3] == -1)
side = [[1, P.HW + 0.2, P.GAP_Y + 0.5, P.R_COIN, 0]]
falls, _ = P.simulate(side, 0.5, 2, guard=True, frames=False)
check("side guards keep it on the field", not falls and side[0][1] <= P.HW - P.R_COIN + 1e-9)


def game(n=2, bots=(), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy")[:n]]
    for lv in bots:
        r.add_bot(lv)
    r.switch_game("pusher")
    r.settings.update(settings)
    r.start()
    return r, r.game, list(r.players.values())


r, g, (a, b) = game()
check("a jammed pile to start", len(g.coins) >= 70 and sum(1 for c in g.coins if c[4] == 1) == P.START_STARS, f"{len(g.coins)}")
check("Ann drops first", r.turn == a.id)
for bad in ({"x": 2, "phase": 0.1}, {"x": 0, "phase": -0.1}, {"x": float("nan"), "phase": 0}, {"x": True, "phase": 0}):
    try:
        g.act(a, {"type": "drop", **bad})
        check(f"bad drop refused {bad}", False)
    except GameError:
        check(f"bad drop refused {list(bad.values())}", True)
try:
    g.act(b, {"type": "drop", "x": 0, "phase": 0})
    check("not Bo's turn", False)
except GameError:
    check("not Bo's turn", True)
n0, pts0 = len(g.coins), sum(g.points)
with r.cond:
    g.act(a, {"type": "drop", "x": 0.0, "phase": 0.0})
sh = g.shot
check("a handful is three coins", len(sh["adds"]) == P.HANDFUL)
fallen = len(sh["falls"])
check("coins are conserved", len(g.coins) == n0 + P.HANDFUL - fallen + (1 if g.turns % P.STAR_EVERY == 0 else 0), f"{n0} +3 -{fallen} = {len(g.coins)}")
check("trays score what fell into them", sum(g.points) - pts0 == sum((3 if f[1] == 1 else 1) for f in sh["falls"] if f[3] >= 0))
check("the turn passes to Bo", r.turn == b.id and g.left[0] == g.drops - 1)
try:
    g.act(b, {"type": "drop", "x": 0, "phase": 0})
    check("no drop while the coins settle", False)
except GameError:
    check("no drop while the coins settle", True)
g.busy_until = 0
# a bell: aim straight at it (the face all the way out at phase 0.5)
bx, by = P.BELLS[1]
xf = bx / (P.HW - P.R_COIN)
seen = set()
for _ in range(12):
    g.guard = [0, 0]
    g.mega = [False, False]
    i = g.seats.index(r.turn)
    with r.cond:
        g.drop(i, xf, 0.5 - (P.STEP * 0.5) / P.PERIOD)
    if g.shot["bonus"]:
        seen.add(g.shot["bonus"])
    g.busy_until = 0
    if r.phase != "playing":
        break
check("bells ring bonuses", len(seen) >= 2, str(seen))
json.dumps(g.view(a))
check("view serialises", True)

# bots play whole games
for nb in (1, 2):
    r, g, ps = game(1, bots=["hard", "normal"][:nb], drops=6)
    ps[0].bot = "easy"
    for _ in range(200):
        if r.phase != "playing":
            break
        with r.cond:
            if g.bot_ready():
                g.bot_tick()
            elif r.deadline:
                g.on_timeout()
    check(f"{nb + 1} bots finish a game", r.phase == "over", r.log[-1]["text"])

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
