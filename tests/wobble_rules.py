"""Wobble Tower rules: blocks land on the highest thing under them, the statics model keeps a centred stack
up and drops an overhang, a plank bridging two pillars holds, a roof only carries along its ridge, gusts lean
a tower over, bad placements and gifts are refused, a topple costs a life and resets the tower, the last
builder standing wins, timeouts play on, and bots finish whole games quickly.

    python3 tests/wobble_rules.py
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import wobble as W  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("wobble")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def put(tower, shape, x, z, r=0):
    """Add a block the way the game does (no slip) and return the tower."""
    got = W.land(tower, shape, x, z, r)
    assert got, (shape, x, z)
    y, sup = got
    return tower + [{"id": len(tower) + 1, "s": shape, "x": x, "z": z, "y": y, "r": r, "o": 0, "sup": sup}]


# -- landing
t = put([], "cube", 0, 0)
check("a block on the plinth lands at 0", t[0]["y"] == 0 and t[0]["sup"][0][0] == -1)
t = put(t, "plank", 0.5, 0)
check("a block lands on the highest thing under it", t[1]["y"] == 1.0 and [k for k, _ in t[1]["sup"]] == [0])
check("nothing under it: no landing", W.land([], "cube", 3, 3, 0) is None)
check("the ell's quarter turns differ", W.parts("ell", 0, 0, 0) != W.parts("ell", 0, 0, 1))

# -- statics
t = []
for _ in range(6):
    t = put(t, "cube", 0, 0)
check("a centred stack of cubes stands", W.check(t)["margin"] > 0.4, f"{W.check(t)['margin']:.2f}")
t = put([], "pillar", 0, 0)
t = put(t, "plank", 1.25, 0)
res = W.check(t)
check("a plank hanging off a pillar topples", res["fail"] is not None and res["fail"]["i"] == 1, f"{res['margin']:.2f}")
check("…tipping away from the pillar", res["fail"] and res["fail"]["dir"][0] > 0.9)
t = put(put([], "pillar", -1.5, 0), "pillar", 1.5, 0)
t = put(t, "beam", 0, 0)
check("a beam bridging two pillars holds", W.check(t)["margin"] > 0, f"{W.check(t)['margin']:.2f}")
t = put(t, "cube", 1.5, 0)
check("…and a load over one pillar still holds", W.check(t)["fail"] is None)
t = put(t, "cube", 1.5, 0)
t2 = put(put([], "cube", 0, 0), "plank", 1.0, 0)
t2 = put(t2, "cube", 2.0, 0)
check("a load on the overhanging end brings it down", W.check(t2)["fail"] is not None)
falls = W.check(t2)["fail"]["falls"]
check("…with everything resting on it", falls == [1, 2], f"{falls}")
roof = put([], "roof", 0, 0)
on = put(roof, "cube", 0, 0)
check("a cube on a roof's ridge balances", W.check(on)["fail"] is None)
off = put(roof, "cube", 0, 0.75)
check("a cube on a roof's slope slides off", off[-1]["sup"] == [] and W.check(off)["fail"] is not None)
# a gust leans a tall, nearly-edged tower over
t = put([], "cube", 0, 0)
for _ in range(7):
    t = put(t, "cube", 0.25, 0) if len(t) % 2 else put(t, "cube", 0, 0)
calm, windy = W.check(t)["margin"], W.check(t, (1, 0))["margin"]
check("a gust cuts a tower's margin", windy < calm - 0.1, f"{calm:.2f} → {windy:.2f}")

# -- the game
r, g, (ann, bo) = game(2, gusts="off")
me = next(p for p in (ann, bo) if p.id == r.turn)
other = bo if me is ann else ann
check("not your turn is refused", refused(g, other, {"type": "place", "x": 0, "z": 0, "rot": 0}) is not None)
for bad in ({"x": 9}, {"x": 0.1}, {"x": "a"}, {"x": float("nan")}, {"rot": 4}, {"rot": True}, {"x": 3, "z": 3}):
    check(f"bad placement refused {bad}", refused(g, me, {"type": "place", "x": 0, "z": 0, "rot": 0, **bad}) is not None)
check("you can't gift before you place", refused(g, me, {"type": "gift", "pick": 0}) is not None)
g.current = "cube"
check("a good placement is taken", refused(g, me, {"type": "place", "x": 0, "z": 0, "rot": 0}) is None and len(g.tower) == 1)
check("then it's time to gift", g.phase == "gift" and r.turn == me.id)
check("you can't place twice", refused(g, me, {"type": "place", "x": 0, "z": 0, "rot": 0}) is not None)
for bad in (3, -1, True, "1", None):
    check(f"bad gift refused {bad!r}", refused(g, me, {"type": "gift", "pick": bad}) is not None)
want = g.next3[1]
check("a gift is taken", refused(g, me, {"type": "gift", "pick": 1}) is None)
check("the next player gets the gifted block", r.turn == other.id and g.current == want and len(g.next3) == 3)
v = g.view(other)["wobble"]
check("the view carries the tower and the next three", len(v["tower"]) == 1 and len(v["next3"]) == 3 and v["current"] == want)
# a topple costs a life and resets the tower
g.current = "plank"
g.tower = put([], "pillar", 0, 0)
g.ready_at = 0
lives = g.lives[g.seat(other)]
g.act(other, {"type": "place", "x": 1.25, "z": 0, "rot": 0})
check("a topple costs a life", g.lives[g.seat(other)] == lives - 1)
check("…the tower starts again", g.tower == [] and g.last["fall"] and len(g.last["fall"]["tower"]) == 2)
check("…and you still pick the next block", g.phase == "gift" and r.turn == other.id)
g.act(other, {"type": "gift", "pick": 0})
check("you can't place while it's still falling", refused(g, me, {"type": "place", "x": 0, "z": 0, "rot": 0}) is not None)
# the last life
g.ready_at = 0
g.lives[g.seat(me)] = 1
g.current = "plank"
g.tower = put([], "pillar", 0, 0)
g.act(me, {"type": "place", "x": 1.25, "z": 0, "rot": 0})
check("losing the last life ends a 2-player game", r.phase == "over" and r.winner == other.id, f"{r.phase} {r.winner}")

# gusts: forecast, then they lean on the placement
r, g, ps = game(3, gusts="on")
check("the first gust is forecast", g.view(ps[0])["wobble"]["gust"]["in"] == W.GUST_EVERY - 1)
for _ in range(W.GUST_EVERY - 1):
    g.ready_at = 0
    p = r.players[r.turn]
    g.current = "cube"
    g.act(p, {"type": "place", "x": 0, "z": 0, "rot": 0})
    g.act(p, {"type": "gift", "pick": 0})
check("the gust turn comes", g.gust_now() != (0.0, 0.0))
g.ready_at = 0
p = r.players[r.turn]
g.current = "cube"
g.act(p, {"type": "place", "x": 0, "z": 0, "rot": 0})
check("a gust is logged on the placement and the next one forecast", g.last["gust"] and g.gust["at"] == g.places + W.GUST_EVERY - 1)

# timeouts: a block is set for you; a gift is picked for you
r, g, ps = game(3)
n0 = g.places
g.on_timeout()
check("a placement timeout sets the block", g.places == n0 + 1 and g.phase == "gift")
t0 = r.turn
g.on_timeout()
check("a gift timeout passes the turn", g.phase == "place" and r.turn != t0)
# someone leaves on their turn
leaver = r.players[r.turn]
r.game.on_leave(leaver)
check("leaving on your turn passes it on", r.turn != leaver.id and r.phase == "playing")

# bots: whole games, quickly, and they place within budget
random.seed(3)
worst, places = 0.0, []
for seed in range(3):
    r, g, ps = game(3)
    for p, lv in zip(ps, ("easy", "normal", "hard")):
        p.bot = lv
    g.rng.seed(seed)
    for _ in range(400):
        if r.phase != "playing":
            break
        g.ready_at = 0
        t0 = time.time()
        g.bot_turn(r.players[r.turn])
        worst = max(worst, time.time() - t0)
    places.append(g.places)
    check(f"a bot game finishes (seed {seed})", r.phase == "over", f"{g.places} placements")
check("a bot's move takes under 1.5 s", worst < 1.5, f"{worst:.2f}s")

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
