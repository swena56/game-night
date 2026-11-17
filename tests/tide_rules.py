"""Tide Castles rules: waves lose force a square and flow round things, walls and towers wear only when hit at least
two harder than they're tall (more levels for harder hits), moats soak once a tide, water on the keep knocks off its
strength until it falls, shells wash away, sand and building rules (costs, wall→tower, piling to 4, take-backs that
restore what stood before, the keep's once-a-tide move), rivals' beaches stay hidden while
building, everyone gets the same waves, bots build legally, and whole games finish.

    python3 tests/tide_rules.py
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import tide as T  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


# -- the water
p = T.new_plot()
waves, survived, hp = T.run_tide(p, [T.KEEP_ROW, T.KEEP_ROW + 1, 1, 1, 1])
check("a wave reaches as many rows as its force", max(r for r, c, f in waves[0]["wet"]) == T.KEEP_ROW - 1 and not waves[0]["keep"])
check("one more and it reaches the keep (a trickle does no harm)", waves[1]["keep"] and waves[1]["dmg"] == T.keep_dmg(1) == 0)
p = T.new_plot()
waves, survived, hp = T.run_tide(p, [T.KEEP_ROW + 8] * 5)
check("a strong wave knocks a third of its force off the keep", waves[0]["dmg"] == 3 and waves[0]["hp"] == T.KEEP_HP - 3, f"{waves[0]['dmg']}")
check("…until it falls", hp == 0 and survived == (T.KEEP_HP + 2) // 3 - 1, f"{survived}")

p = T.new_plot()
for c in range(T.COLS):
    p["g"][2][c] = ("wall", 1)
waves, survived, hp = T.run_tide(p, [5])
check("a wall row stops the water", all(r < 2 for r, c, f in waves[0]["wet"]))
check("hit 2 harder than its height, a wall wears away", all(p["g"][2][c] is None for c in range(T.COLS)))
p = T.new_plot()
for c in range(T.COLS):
    p["g"][3][c] = ("wall", 1)
T.run_tide(p, [5])   # arrives at row 3 with force 2: only 1 harder than the wall
check("a wall hit only a little harder stays (#157)", all(p["g"][3][c] == ("wall", 1) for c in range(T.COLS)))
p = T.new_plot()
for c in range(T.COLS):
    p["g"][1][c] = ("tower", 2)
T.run_tide(p, [5])   # force 4 at row 1: 2 harder than the tower
check("a tower wears down to a wall", all(p["g"][1][c] == ("wall", 1) for c in range(T.COLS)))
p = T.new_plot()
for c in range(T.COLS):
    p["g"][1][c] = ("tower", 4)
T.run_tide(p, [10])  # force 9 at row 1: 5 harder: two levels
check("a much harder hit wears two levels off", all(p["g"][1][c] == ("tower", 2) for c in range(T.COLS)))
check("wear: none, one, two levels", (T.wear(5, 4), T.wear(6, 4), T.wear(9, 4), T.wear(30, 2)) == (0, 1, 2, 2))

# water flows round a single wall
p = T.new_plot()
p["g"][1][3] = ("wall", 1)
waves, _, _ = T.run_tide(p, [5])
wet = {(r, c) for r, c, f in waves[0]["wet"]}
check("water flows round a lone wall", (2, 3) in wet)

# moats soak once a tide
p = T.new_plot()
for c in range(T.COLS):
    p["g"][1][c] = ("moat", 0)
waves, _, _ = T.run_tide(p, [6, 6])
check("dry moats soak the wave", not any(r >= 2 for r, c, f in waves[0]["wet"]) and len(waves[0]["soak"]) == T.COLS)
check("full moats let the next one through", any(r >= 2 for r, c, f in waves[1]["wet"]))

# shells wash away; scoring
p = T.new_plot()
p["g"][0][0] = ("shell", 0)
p["g"][T.KEEP_ROW][0] = ("shell", 0)
waves, survived, hp = T.run_tide(p, [3, 3, 3, 3, 3])
pts, shells = T.score_tide(p, survived, hp)
check("a shell the water reaches is gone, one it doesn't stays", p["g"][0][0] is None and p["g"][T.KEEP_ROW][0] == ("shell", 0))
check("five waves standing, full strength and a shell", pts == 5 * T.WAVE_PTS + T.KEEP_HP + T.SHELL_PTS and survived == 5, f"{pts}")

# forecasts rise, the last is the big one
f1, f3 = T.forecast(random.Random(1), 0), T.forecast(random.Random(1), 2)
check("the last wave is the biggest", f1[-1] == max(f1) and f1[-1] > f1[-2])
check("later tides are stronger", sum(f3) > sum(f1))


# -- a game
def game(n=2, bots=(), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy")[:n]]
    for lv in bots:
        r.add_bot(lv)
    r.switch_game("tide")
    r.settings.update(settings)
    r.start()
    return r, r.game, list(r.players.values())


r, g, (a, b) = game()
check("starts building", g.stage == "build" and g.left == [g.sand, g.sand])
g.act(a, {"type": "build", "r": 3, "c": 2, "item": "wall"})
check("a wall costs 1", g.left[0] == g.sand - 1)
g.act(a, {"type": "build", "r": 3, "c": 2, "item": "tower"})
check("piling a wall into a tower costs 1 more", g.plots[0]["g"][3][2] == ("tower", 2) and g.left[0] == g.sand - 2)
g.act(a, {"type": "build", "r": 3, "c": 2, "item": "tower"})
g.act(a, {"type": "build", "r": 3, "c": 2, "item": "tower"})
check("piling up to 4 high, 1 a level", g.plots[0]["g"][3][2] == ("tower", 4) and g.left[0] == g.sand - 4)
try:
    g.act(a, {"type": "build", "r": 3, "c": 2, "item": "tower"})
    check("no higher than 4", False)
except GameError:
    check("no higher than 4", True)
g.act(a, {"type": "clear", "r": 3, "c": 2})
check("taking it back refunds every level", g.left[0] == g.sand and g.plots[0]["g"][3][2] is None)
for bad, why in (({"type": "build", "r": 9, "c": 0, "item": "wall"}, "off the beach"),
                 ({"type": "build", "r": T.KEEP_ROW, "c": g.plots[0]["keep"], "item": "wall"}, "on the keep"),
                 ({"type": "build", "r": 0, "c": 0, "item": "cannon"}, "a cannon"),
                 ({"type": "build", "r": True, "c": 0, "item": "wall"}, "a bool row"),
                 ({"type": "keep", "r": 2, "c": 0}, "keep off the back row")):
    try:
        g.act(a, bad)
        check(f"refused: {why}", False)
    except GameError:
        check(f"refused: {why}", True)
g.act(a, {"type": "keep", "r": T.KEEP_ROW, "c": 0})
try:
    g.act(a, {"type": "keep", "r": T.KEEP_ROW, "c": 6})
    check("the keep moves once a tide", False)
except GameError:
    check("the keep moves once a tide", True)
g.left[0] = 1
try:
    g.act(a, {"type": "build", "r": 1, "c": 1, "item": "tower"})
    check("not enough sand", False)
except GameError:
    check("not enough sand", True)
g.left[0] = g.sand
g.act(a, {"type": "build", "r": 0, "c": 5, "item": "wall"})
vb = g.view(b)["tide"]
check("rivals' beaches are hidden while building", vb["plots"][0] is None and vb["plots"][1] is not None)
g.act(a, {"type": "done"})
check("one ready isn't enough", g.stage == "build")
g.act(b, {"type": "done"})
check("everyone ready: the tide comes in", g.stage == "tide" and g.result and all(x for x in g.result))
check("everyone met the same waves", len({len(x["waves"]) for x in g.result}) == 1)
v = g.view(a)["tide"]
check("the tide view carries the beaches as they were", v["before"] and v["plots"][1] is not None)
json.dumps(v)
check("view serialises", True)
with r.cond:
    g.on_timeout()
    g.on_timeout()
check("tide 2 starts with a fresh bucket", g.tide == 2 and g.stage == "build" and g.left == [g.sand, g.sand])
vb = g.view(b)["tide"]
check("…and rivals see what stood after the last tide", vb["plots"][0] is not None and vb["plots"][0]["keep"] == 0)
try:
    g.act(a, {"type": "clear", "r": 0, "c": 5})
    check("last tide's walls can't be taken back", g.plots[0]["g"][0][5] is not None and False)
except GameError:
    check("last tide's walls can't be taken back", True)
# piling onto last tide's wall, then taking it back, returns just that sand and leaves the old wall (#157 exploit)
g.left[0] = 5
g.plots[0]["g"][0][5] = ("wall", 1)        # (as if last tide's wall still stood)
g.act(a, {"type": "build", "r": 0, "c": 5, "item": "tower"})
g.act(a, {"type": "clear", "r": 0, "c": 5})
check("a take-back on an old wall refunds only what was spent and keeps the wall", g.left[0] == 5 and g.plots[0]["g"][0][5] == ("wall", 1), f"{g.left[0]} {g.plots[0]['g'][0][5]}")
g.left[0] = g.sand

# bots build legally and finish
for nb in (2, 5):
    r, g, ps = game(1, bots=["hard", "normal", "easy", "hard", "normal"][:nb])
    ps[0].bot = "easy"
    ok = True
    for _ in range(100):
        if r.phase != "playing":
            break
        with r.cond:
            for i in range(len(g.seats)):
                g.bot_next[i] = 0
            if g.bot_ready():
                g.bot_tick()
            elif r.deadline:
                g.on_timeout()
        if g.stage == "tide":
            ok = ok and all(0 <= x <= g.sand for x in g.left)
    check(f"{nb + 1} bots finish a game, spending sand legally", r.phase == "over" and ok, r.log[-1]["text"])

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
