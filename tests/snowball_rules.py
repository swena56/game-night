"""Snowball Scramble rules: nothing moves in the countdown, the stick moves you (and is validated), a throw
costs a snowball and lands after its flight, a hit takes a pip and three snow you in (the thrower scores),
a fort takes the hit for whoever shelters behind it and crumbles, snowballs come back, a giant grows in fresh
snow and flattens a rival, and the most snow-ins wins when the clock runs out.

    python3 tests/snowball_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import snowball as W  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.on_input(p, a)
    except GameError as e:
        return str(e)
    return None


def run(g, t0, secs):
    """Step the field from t0 for secs, 60 calls a second like the server; returns the new time."""
    t = t0
    with g.room.cond:
        for _ in range(int(secs * 60)):
            t += 1 / 60
            g.frame(t)
    return t


r = server.Room("TEST")
ps = [r.add_player(n) for n in ("Ann", "Bo")]
r.switch_game("snowball")
r.settings["time"] = 90
r.settings["map"] = "meadow"     # the classic field and rules first; #178's extras further down
r.settings["extras"] = False
r.start()
g = r.game
ann, bo = ps
A, B = g.kids
for bad in ({"sx": "left", "sy": 0}, {"sx": 1}, {"sx": float("nan"), "sy": 0}, {"sx": True, "sy": 0}, {"throw": "hard"}):
    check(f"bad input refused {bad}", refused(g, ann, bad) is not None)
try:
    g.act(ann, {"type": "throw"})
    check("act is refused", False)
except GameError:
    check("act is refused", True)

# the countdown: the stick is taken but nobody moves
A.x, A.y, B.x, B.y = -5.0, 0.5, 5.0, 0.5
check("a stick is taken (and capped at 1)", refused(g, ann, {"sx": 3, "sy": 0}) is None and abs(A.sx - 1) < 1e-9)
t = g.go_at - 1
run(g, t, 0.5)
check("nobody moves in the countdown", A.x == -5.0 and g.stage == "countdown")
check("a throw in the countdown does nothing", not g.throw(0, t, False) and A.ammo == W.AMMO)
t = run(g, g.go_at - 0.01, 0.5)
check("the countdown ends", g.stage == "play")
check("the stick moves you", A.x > -5.0 + 1.5, f"{A.x:.2f}")
A.sx = A.sy = 0.0
t = run(g, t, 0.4)

# a throw: costs a snowball, flies, and lands on Bo if he stands still
A.x, A.y, B.x, B.y = -2.0, 6.0, 2.0, 6.0   # an open strip along the top, clear of forts
A.vx = A.vy = B.vx = B.vy = 0.0
A.fx, A.fy = 1.0, 0.0
check("a throw is taken", g.throw(0, t, False) and A.ammo == W.AMMO - 1 and len(g.balls) == 1)
ball = g.balls[0]
check("it aims where the target stands", (ball[2], ball[3]) == (2.0, 6.0) and ball[8] == -1)
check("no second throw inside the cooldown", not g.throw(0, t + 0.1, False))
t = run(g, t, 0.3)
check("it is still flying", B.pips == 0 and len(g.balls) == 1)
t = run(g, t, ball[5] - t + 0.1)
check("it lands and takes a pip", B.pips == 1 and not g.balls and A.hits == 1)
check("the hit went out as an event", any(e[2][0] == "hit" for e in g.events))
check("a snowball comes back", (run(g, t, W.RELOAD + 0.1) and A.ammo) == W.AMMO, f"{A.ammo}")
t += W.RELOAD + 0.1

# dodging: a throw at a spot Bo has left misses
B.x = 2.0
g.throw(0, t, False)
B.x = 4.0
t = run(g, t, 1.0)
check("a dodged snowball splats", B.pips == 1 and any(e[2][0] == "splat" for e in g.events))

# three pips snow you in, and the thrower scores
B.x, B.y = 2.0, 6.0
A.cool_until = 0
g.throw(0, t, True)   # a big one: two pips
t = run(g, t, 1.0)
check("a big one takes two pips and snows him in", B.pips == 0 and B.frozen_until > t and A.points == 1, f"pips {B.pips}, pts {A.points}")
B.sx = 1.0
x0 = B.x
t = run(g, t, 0.5)
check("snowed in, you can't move", abs(B.x - x0) < 0.05)
check("and can't throw", not g.throw(1, t, False))
B.sx = 0.0
t = run(g, t, W.FROZEN)

# a fort shelters whoever hides close behind it, and crumbles
fx, fy, horiz = W.FORTS[6]   # the upright fort left of centre at (-2.4, 0)
A.x, A.y = fx - 4.5, fy
B.x, B.y = fx + 0.9, fy
A.ammo, A.cool_until = W.AMMO, 0
hp = g.forts[6]
g.throw(0, t, False, (B.x, B.y))
check("the fort is in the way", g.balls[-1][8] == 6)
t = run(g, t, 1.0)
check("the fort takes the hit", g.forts[6] == hp - 1 and B.pips == 0)
for _ in range(6):
    if g.forts[6] <= 0:
        break
    A.ammo, A.cool_until = W.AMMO, 0
    g.throw(0, t, True, (B.x, B.y))
    t = run(g, t, 1.0)
check("enough hits knock it down", g.forts[6] == 0 and any(e[2][0] == "crumble" for e in g.events))
A.ammo, A.cool_until = W.AMMO, 0
B.pips = 0
g.throw(0, t, False, (B.x, B.y))
t = run(g, t, 1.0)
check("with the fort down the throw gets through", B.pips == 1)
B.x, B.y = 6.0, 5.8
t = run(g, t, W.FORT_REGROW + 0.5)
check("the fort grows back", g.forts[6] == W.FORT_HP)

# ⛄ a giant grows in fresh snow and flattens a rival
px, py = W.PATCHES[2]
A.x, A.y, A.giant = px - 1.0, py + 0.5, 0.0
B.x, B.y = 8.0, -6.0
B.pips = 0
for _ in range(12):   # run back and forth through the patch
    A.sx = 1.0 if A.x < px else -1.0
    if abs(A.x - px) > 0.9:
        A.sx = 1.0 if A.x < px else -1.0
    t = run(g, t, 0.4)
    A.sx = -A.sx
    t = run(g, t, 0.4)
    if A.giant >= W.GIANT_MAX - 1e-6:
        break
check("running through fresh snow rolls a giant", A.giant >= W.GIANT_MAX - 1e-6, f"{A.giant:.2f}")
check("the patch is used up a little", g.patches[2] < 1.0)
A.sx = A.sy = 0.0
t = run(g, t, 0.3)
A.fx, A.fy = 1.0, 0.0
B.x, B.y = A.x + W.BODY + W.GIANT_R * 2 + 0.2, A.y
B.frozen_until = B.knock_until = 0
A.sx = 1.0
t = run(g, t, 0.4)
A.sx = 0.0
check("the giant flattens the rival (two pips' worth)", B.knock_until > 0 and A.giant < 0.5 and B.pips == 2, f"pips {B.pips}, giant {A.giant}")
check("and wins the avalanche badge", any(e[2][0] == "flat" for e in g.events))

# the view
v = g.view(ann)["snowball"]
check("the view has every kid, the forts and my seat", len(v["k"]) == 2 and len(v["f"]) == len(W.FORTS) and v["me"] == 0 and v["st"] == "play")

# the clock runs out: the most snow-ins wins
B.points = 0
A.points = max(A.points, 1)
t = run(g, g.end_at - 0.2, 0.5)
check("the game ends when the clock runs out", r.phase == "over")
check("the most snow-ins wins", r.winner == ann.id, f"{r.winner}")
fs = g.final_scores()
check("final scores are snow-ins", fs[ann.id] == A.points and fs[bo.id] == 0)

# 🔴🔵 teams (#126)
r = server.Room("TEAM")
ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy", "Di")]
r.switch_game("snowball")
r.settings["teams"] = True
r.settings["extras"] = False
r.start()
g = r.game
check("teams alternate seats", g.teams and g.team == [0, 1, 0, 1])
check("each team starts on its own end", all((g.kids[i].x < 0) == (g.team[i] == 0) for i in range(4)))
check("you never aim at a teammate", all(g.foes(i, g.target_of(i)) for i in range(4)))
t = g.go_at + 0.01
g.frame(t)
A, B, C = g.kids[0], g.kids[1], g.kids[2]
C.x, C.y = 0.0, 0.0
A.x, A.y = -3.0, 0.0
B.x, B.y = 3.0, 3.0
g.throw(0, t, False, (0.0, 0.0))  # at my own teammate
t = run(g, t, 1.2)
check("a snowball passes over a teammate", C.pips == 0, f"pips {C.pips}")
B.x, B.y = 0.0, 0.0
C.x, C.y = 3.0, 3.0
A.cool_until = 0
g.throw(0, t, False, (0.0, 0.0))
t = run(g, t, 1.2)
check("and hits a rival", B.pips == 1, f"pips {B.pips}")
check("the view carries the teams", g.view(ps[0])["snowball"]["teams"] and g.view(ps[0])["snowball"]["team"] == [0, 1, 0, 1])
A.points, C.points, B.points = 2, 1, 2
check("team points add up", g.team_points(0) == 3 and g.team_points(1) == 2 and g.state(t)["tp"] == [3, 2])
g.end_at = t
run(g, t, 0.1)
check("the team with more snow-ins wins", r.phase == "over" and "Red" in r.log[-1]["text"], r.log[-1]["text"])

# ---- #178: fields, gifts, decoys, slush, the crown, streaks
import json  # noqa: E402
import pickle  # noqa: E402


def fresh(n=2, **st):
    r = server.Room("X178")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di", "Ed", "Flo")[:n]]
    r.switch_game("snowball")
    r.settings.update(st)
    r.start()
    g = r.game
    t = g.go_at + 0.01
    with r.cond:
        g.frame(t)
    return r, g, ps, t


seen = set()
for _ in range(6):
    r, g, ps, t = fresh()
    seen.add(g.map)
check("a different field each game ('mix' never repeats the last one)", len(seen) >= 2 and all(m in W.MAPS for m in seen), str(seen))
r, g, ps, t = fresh(map="village")
v = g.view(ps[0])["snowball"]
check("the field's forts and patches go to the browser", v["map"] == "village" and len(v["forts"]) == len(W.MAPS["village"]["forts"]) == len(v["f"])
      and len(v["patches"]) == len(v["p"]))
check("the view is JSON", bool(json.dumps(g.view(ps[0]))))
check("bad gift input refused", refused(g, ps[0], {"use": "yes"}) is not None)

# ⛸️ the pond: you slide
r, g, ps, t = fresh(map="pond", extras=False)
A, B = g.kids
B.x, B.y = 8.0, 6.0
A.x, A.y, A.vx, A.vy, A.sx, A.sy = -2.0, 0.0, 0.0, 0.0, 1.0, 0.0
t = run(g, t, 0.1)
ice_v = A.vx
r2, g2, ps2, t2 = fresh(map="meadow", extras=False)
A2 = g2.kids[0]
g2.kids[1].x, g2.kids[1].y = 8.0, 6.0
A2.x, A2.y, A2.vx, A2.vy, A2.sx, A2.sy = -1.0, 6.0, 0.0, 0.0, 1.0, 0.0
run(g2, t2, 0.1)
check("on the pond you pick up speed slowly", 0 < ice_v < A2.vx * 0.6, f"{ice_v:.2f} v {A2.vx:.2f}")
A.sx = 0.0
v0 = A.vx = 4.0
t = run(g, t, 0.2)
check("and slide on when you let go", A.vx > v0 * 0.4, f"{A.vx:.2f}")

# 🎁 gifts
r, g, ps, t = fresh(map="meadow")
A, B = g.kids
check("no gift before the first drop", not g.gifts)
A.x, A.y, B.x, B.y = -9.0, -6.0, 9.0, 6.0
t = run(g, t, W.GIFT_FIRST + 0.2)
check("a gift drops", len(g.gifts) == 1 and any(e[2][0] == "gift" for e in g.events))
gid, gx, gy, kind = g.gifts[0]
A.x, A.y = gx, gy
t = run(g, t, 0.1)
check("walking over it picks it up", A.item == kind and not g.gifts)
check("the state carries what you hold", g.state(t)["k"][0][13] == W.ITEMS.index(kind) + 1)

# 🧊 ice ball: quick, two hits and a chill
A.item = "ice"
A.x, A.y, B.x, B.y = -2.0, 6.0, 2.0, 6.0
A.vx = A.vy = B.vx = B.vy = 0.0
A.sx = A.sy = B.sx = B.sy = 0.0
A.fx, A.fy = 1.0, 0.0
ammo = A.ammo
check("✨ spends it", refused(g, ps[0], {"use": True}) is None and A.item is None and A.ammo == ammo)
ball = g.balls[-1]
check("an ice ball flies faster", ball[10] == 1 and ball[5] - ball[4] < (W.FLIGHT[0] + 4 * W.FLIGHT[1]) * 0.6)
B.pips = 0
t = run(g, t, 0.8)
check("and hits for two with a chill", B.pips == 2 and B.chill_until > t and B.slow == W.CHILL_SPEED, f"pips {B.pips} slow {B.slow}")
B.pips = 0
t = run(g, t, W.CHILL + 0.1)
check("the chill wears off", B.slow == 1.0)

# 💦 slush: a puddle that slows rivals, not you
A.item = "slush"
A.cool_until = 0
g.use(0, t)
t = run(g, t, 1.0)
check("the slush bomb leaves a puddle", len(g.slush) == 1 and abs(g.slush[0][0] - 2.0) < 0.01)
check("the rival in it is bogged down", B.slow == W.SLUSH_SPEED)
A.x, A.y = 2.0, 5.5
t = run(g, t, 0.1)
check("its thrower isn't", A.slow == 1.0)
t = run(g, t, W.SLUSH_T)
check("the puddle melts away", not g.slush)

# ☃️ decoy: auto-aim goes for it and it soaks the throws
A.x, A.y, B.x, B.y = -4.0, 6.0, 3.0, 6.0
B.fx, B.fy = -1.0, 0.0
B.item = "decoy"
g.use(1, t)
d = g.decoys[0]
check("a decoy is dropped in front", len(g.decoys) == 1 and d[3] == 1 and d[1] < B.x)
A.fx, A.fy = 1.0, 0.0
check("rivals' auto-aim locks on to it", g.aim_point(0) == (d[1], d[2]))
B.pips = 0
for _ in range(2):
    A.ammo, A.cool_until = W.AMMO, 0
    g.throw(0, t, False)
    t = run(g, t, 1.0)
check("it soaks two throws and goes poof", not g.decoys and B.pips == 0 and B.soaks == 2 and any(e[2][0] == "poof" for e in g.events))

# 👑 the crown
check("no crown before half time", not g.crown_open)
A.x, A.y = W.MAPS["meadow"]["hill"]
A.x += 0.3
B.x, B.y = 8.0, -6.0
pts = A.points
t = run(g, max(t, g.crown_at - 0.1), 0.3)
check("it opens at half time", g.crown_open and any(e[2][0] == "crown" for e in g.events))
t = run(g, t, W.HILL_EVERY + 0.2)
check("holding it alone scores", A.points == pts + 1 and A.crowns == 1, f"{A.points - pts}")
B.x, B.y = A.x - 0.6, A.y
B.frozen_until = B.knock_until = 0
prog = g.crown_prog
t = run(g, t, 2.0)
check("a rival inside stops the count", g.crown_contest == 1 and abs(g.crown_prog - prog) < 0.05)

# 👑 #178 follow-up: crowds. Most kids inside holds it; a level hill in a 4+ game goes on at half speed for the holder
r, g, ps, t = fresh(n=6, map="meadow", teams=True)
hx, hy = W.MAPS["meadow"]["hill"]
for k in g.kids:
    k.x, k.y = 9.0, -7.0
t = run(g, max(t, g.crown_at - 0.1), 0.3)
red = [i for i in range(6) if g.side(i) == 0]
blue = [i for i in range(6) if g.side(i) == 1]
for n, i in enumerate(red[:2] + blue[:1]):
    g.kids[i].x, g.kids[i].y = hx + 0.3 * n, hy
t = run(g, t, W.HILL_EVERY + 0.3)
check("two reds beat one blue on the hill", g.crown_side == 0 and sum(g.kids[i].crowns for i in red) == 1 and g.crown_contest == 0,
      f"{g.crown_side} {g.crown_contest}")
g.kids[blue[1]].x, g.kids[blue[1]].y = hx - 0.3, hy + 0.3
prog = g.crown_prog
t = run(g, t, 2.0)
check("level in a 6-player game: the holder fills at half speed", g.crown_contest == 2 and g.crown_side == 0
      and 0.15 < g.crown_prog - prog < 0.25, f"{g.crown_contest} {g.crown_prog - prog:.2f}")
for i in red[:2]:
    g.kids[i].x, g.kids[i].y = 9.0, -7.0
t = run(g, t, 0.5)
check("outnumbered, the hill changes hands and red banks its count", g.crown_side == 1 and g.crown_bank.get(0, 0) > 0.2,
      f"{g.crown_side} {g.crown_bank}")
r, g, ps, t = fresh(n=3, map="meadow")
for k in g.kids:
    k.x, k.y = 9.0, -7.0
t = run(g, max(t, g.crown_at - 0.1), 0.3)
g.kids[0].x, g.kids[0].y = hx, hy
g.kids[1].x, g.kids[1].y = hx + 0.5, hy
t = run(g, t, W.HILL_EVERY + 0.3)
check("with 3 players a rival inside still freezes it", g.crown_contest == 1 and not any(k.crowns for k in g.kids))

# 🔥 streaks and the shutdown bonus
r, g, ps, t = fresh(map="meadow")
A, B = g.kids
for _ in range(3):
    B.pips, B.frozen_until = 0, 0
    g.hit(1, 0, 3, t)
check("three in a row is a streak", A.streak == 3 and A.points == 3 and any(e[2][0] == "streak" for e in g.events))
A.frozen_until = 0
g.hit(0, 1, 3, t + 5)
check("ending it scores a bonus", B.points == 1 + W.STREAK_BONUS and A.streak == 0, f"{B.points}")

# a game saved before #178 still loads and runs
r, g, ps, t = fresh(map="meadow", extras=False)
for k in ("map", "fort_xy", "patch_xy", "hill_xy", "ice", "extras", "gifts", "decoys", "slush", "item_id", "said", "gift_at", "crown_at",
          "crown_open", "crown_side", "crown_prog", "crown_contest", "bot_hill"):
    g.__dict__.pop(k, None)
g.balls.append([0, 0, 1, 1, t, t + 0.5, False, 0, -1, 99])
r = pickle.loads(pickle.dumps(r))
g2 = r.game
ps = [r.players[p.id] for p in ps]
ok = True
try:
    t = run(g2, t, 1.0)
    json.dumps(g2.view(ps[0]))
except Exception as e:  # noqa: BLE001
    ok = False
    print(e)
check("an old saved game loads and runs (classic field, no extras)", ok and g2.map == "meadow" and not g2.extras and not g2.balls)

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
