"""Spin Tops rules: the launch meter sets the spin, the bowl pulls toward the middle, collisions bounce and drain the
slower top more, a charge hits harder, ring-outs and topples knock tops out (and credit the hitter), sparks add spin,
bad input is refused, bots play whole games, and the game ends.

    python3 tests/tops_rules.py
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import tops as T  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, bots=(), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    for lv in bots:
        r.add_bot(lv)
    r.switch_game("tops")
    r.settings.update(settings)
    r.start()
    return r, r.game, list(r.players.values())


def step(r, g, secs, clock):
    for _ in range(int(secs * 60)):
        clock += 1 / 60
        with r.cond:
            g.frame(clock)
        if r.phase != "playing":
            break
    return clock


# -- the meter
check("meter starts at 0", T.meter(0) == 0)
check("meter peaks half a swing in", abs(T.meter(T.METER / 2) - 1) < 1e-9)
check("meter swings back", abs(T.meter(T.METER) - 0) < 1e-9)

r, g, (a, b) = game()
check("starts on the launch", g.stage == "launch" and g.round == 1)
g.arena = "ice"
g.tops[0].kind = "sta"
preview = g.view(a)["tops"]
kind_index = preview["t"][0][9]
stats = preview["matchups"][preview["ar"]][kind_index]
_, _, attack, mass, decay, steer, _ = T.TYPES["sta"]
check("matchup reports the selected top and ice steering",
      preview["kinds"][kind_index][0] == "sta" and stats == {
          "speed": T.VMAX, "mass": mass, "attack": attack,
          "stamina": round(1 / (T.DECAY * decay), 1),
          "steering": round(steer * T.ICE_STEER, 2),
      })
g.arena = "classic"
g.tops[0].kind = "bal"
for bad in ({"sx": float("nan"), "sy": 0}, {"sx": "x", "sy": 0}, {"btn": "boom"}):
    try:
        g.on_input(a, bad)
        check(f"bad input refused {bad}", False)
    except GameError:
        check(f"bad input refused {list(bad)}", True)
g.launch(0, g.launch_at, power=1.0)
check("a launch is locked in", g.tops[0].power == 1.0 and not g.launch(0, g.launch_at + 0.5))
clock = g.go_at - 0.01
clock = step(r, g, 0.1, clock)
check("the fight starts after the countdown", g.stage == "spin")
check("a full launch spins harder than none", g.tops[0].spin > g.tops[1].spin, f"{g.tops[0].spin:.2f} v {g.tops[1].spin:.2f}")

# the bowl pulls a still top toward the middle
t = g.tops[0]
t.x, t.y, t.vx, t.vy, t.sx, t.sy = 4.0, 0.0, 0.0, 0.0, 0.0, 0.0
g.tops[1].x, g.tops[1].y = -4.0, 0.0
g.tops[1].vx = g.tops[1].vy = 0.0
with r.cond:
    g.move(1 / 30, clock)
check("the bowl pulls inward", g.tops[0].vx < 0)

# a head-on collision: they bounce apart, the slower spinner loses more spin
a_, b_ = g.tops
a_.x, a_.y, a_.vx, a_.vy, a_.spin = -0.45, 0.0, 2.0, 0.0, 0.9
b_.x, b_.y, b_.vx, b_.vy, b_.spin = 0.45, 0.0, -2.0, 0.0, 0.4
with r.cond:
    g.move(1 / 30, clock)
check("they bounce apart", a_.vx < 0 < b_.vx, f"{a_.vx:.2f} {b_.vx:.2f}")
check("the slower top loses more spin", 0.9 - a_.spin < 0.4 - b_.spin, f"{0.9 - a_.spin:.3f} v {0.4 - b_.spin:.3f}")
check("both remember who hit them", a_.touch == 1 and b_.touch == 0)

# a charge: same spins, one moving in, one still: the charger loses less
a_.x, a_.y, a_.vx, a_.vy, a_.spin = -0.45, 0.0, 4.0, 0.0, 0.7
b_.x, b_.y, b_.vx, b_.vy, b_.spin = 0.45, 0.0, 0.0, 0.0, 0.7
with r.cond:
    g.move(1 / 30, clock)
check("a charge costs the charger less", 0.7 - a_.spin < 0.7 - b_.spin, f"{0.7 - a_.spin:.3f} v {0.7 - b_.spin:.3f}")
check("and shoves the target hard", b_.vx > 3.5, f"{b_.vx:.2f}")

# dash: cooldown and cost
a_.x, a_.y, a_.vx, a_.vy, a_.spin, a_.dash_at = -3.0, 0.0, 0.0, 0.0, 0.8, 0.0
b_.x, b_.y = 3.0, 0.0
check("dash works", g.dash(0, clock, 1.0, 0.0) and a_.vx > 4 and a_.spin < 0.8)
check("dash cools down", not g.dash(0, clock + 0.5, 1.0, 0.0))

# a ring-out right after a hit credits the hitter
r, g, (a, b, c) = game(3)
clock = step(r, g, T.LAUNCH + 0.1, g.launch_at)
check("3-player fight starts", g.stage == "spin")
v = g.tops[1]
v.x, v.y, v.vx, v.vy, v.touch, v.touch_at = T.R + 0.1, 0.0, 6.0, 0.0, 0, clock
with r.cond:
    g.move(1 / 30, clock)
check("over the rim is out", v.out == "ring")
check("the hitter gets the point", g.tops[0].points == 1 and g.tops[0].outs == 1)
w = g.tops[2]
w.spin = 0.0001
with r.cond:
    g.move(1 / 30, clock + 1)
check("out of spin topples", w.out == "topple")
with r.cond:
    g.frame(clock + 1.05)
check("the last top spinning wins the round", g.stage == "between" and g.result[0] == 0 and g.tops[0].points == 4,
      f"{g.result} {g.tops[0].points}")
check("the runner-up (last out) gets 1", g.tops[2].points == 1)
clock = step(r, g, T.BETWEEN + 0.2, clock + 1.05)
check("next round starts with a launch", g.stage == "launch" and g.round == 2 and all(t.out is None for t in g.tops))

# sparks add spin
g.stage = "spin"
g.tops[0].x, g.tops[0].y, g.tops[0].spin = 1.0, 1.0, 0.5
g.sparks = [[1.0, 1.2, clock, 99]]
g.next_spark = clock + 99
g.tick_sparks(clock)
check("a spark adds spin", abs(g.tops[0].spin - (0.5 + T.SPARK_GAIN)) < 1e-9 and not g.sparks)

# view is serialisable and shaped
import json  # noqa: E402
vw = g.view(a)["tops"]
json.dumps(vw)
check("view has every top", len(vw["t"]) == 3 and vw["me"] == 0)

# -- #179: top picks, smash, rev, pickups, arenas, slow-mo finish, streaks, old saves
r, g, (a, b) = game()
for bad in ({"pick": "tank"},):
    try:
        g.on_input(a, bad)
        check("a bad top is refused", False)
    except GameError:
        check("a bad top is refused", True)
g.on_input(a, {"pick": "def"})
check("pick a top before the launch", g.tops[0].kind == "def")
clock = step(r, g, T.LAUNCH + 0.1, g.launch_at)
try:
    g.on_input(a, {"pick": "atk"})
    check("no swapping tops mid-fight", False)
except GameError:
    check("no swapping tops mid-fight", g.tops[0].kind == "def")
check("round 1 is the classic bowl", g.arena == "classic")
# a defender is harder to shift than an attacker
a_, b_ = g.tops
def head_on(ka, kb):
    a_.kind, b_.kind = ka, kb
    a_.x, a_.y, a_.vx, a_.vy, a_.spin, a_.dashed_at = -0.45, 0.0, 3.0, 0.0, 0.8, -99
    b_.x, b_.y, b_.vx, b_.vy, b_.spin, b_.dashed_at = 0.45, 0.0, 0.0, 0.0, 0.8, -99
    b_.heavy_until = 0.0
    with r.cond:
        g.move(1 / 30, clock)
    return b_.vx, 0.8 - a_.spin, 0.8 - b_.spin
vd, _, _ = head_on("atk", "def")
va, _, _ = head_on("atk", "atk")
check("🛡️ Defense is shoved less than ⚔️ Attack", vd < va, f"{vd:.2f} v {va:.2f}")
# smash: a hit straight after a dash shoves harder and costs the smasher less
v0, la0, _ = head_on("bal", "bal")
a_.kind = b_.kind = "bal"
a_.x, a_.y, a_.vx, a_.vy, a_.spin = -0.45, 0.0, 3.0, 0.0, 0.8
b_.x, b_.y, b_.vx, b_.vy, b_.spin = 0.45, 0.0, 0.0, 0.0, 0.8
a_.dashed_at = clock - 0.1
with r.cond:
    g.move(1 / 30, clock)
check("💥 a smash shoves harder", b_.vx > v0 * 1.2, f"{b_.vx:.2f} v {v0:.2f}")
check("💥 and costs the smasher less", 0.8 - a_.spin < la0, f"{0.8 - a_.spin:.3f} v {la0:.3f}")
check("the smash is remembered for the ring-out", b_.smash_by == 0)
b_.x, b_.y, b_.vx = T.R + 0.1, 0.0, 6.0
pts = a_.points
with r.cond:
    g.move(1 / 30, clock + 0.1)
check("a smash ring-out scores 2", a_.points - pts == T.SMASH_PTS and b_.out == "ring", f"{a_.points - pts}")

# rev: good timing adds spin, bad timing costs a little, then it cools down
r, g, (a, b) = game()
clock = step(r, g, T.LAUNCH + 0.1, g.launch_at)
t = g.tops[0]
t.spin, t.rev_at = 0.5, 0.0
check("🌀 a full rev adds spin", g.rev(0, clock, m=1.0) and abs(t.spin - (0.5 + T.REV_GAIN - T.REV_MISS)) < 1e-9, f"{t.spin:.3f}")
check("rev cools down", not g.rev(0, clock + 1, m=1.0))
t.spin, t.rev_at = 0.5, 0.0
g.rev(0, clock + 0.5, m=0.0)
check("a bad rev costs a little", t.spin < 0.5)
try:
    g.on_input(a, {"btn": "rev"})
    check("rev is a button", True)
except GameError:
    check("rev is a button", False)

# pickups
g.tops[1].x, g.tops[1].y = -4.0, 0.0
for kind in ("heavy", "turbo"):
    t.x, t.y, t.dash_at = 1.0, 1.0, clock + 9
    g.sparks = [[1.0, 1.2, clock, 50, kind]]
    g.next_spark = clock + 99
    g.tick_sparks(clock)
check("🪨 heavy and 💨 turbo pickups take", t.heavy_until > clock and t.turbo_until > clock and t.dash_at == 0.0)
check("heavy makes a top weigh more", g.mass(t, clock) > g.mass(g.tops[1], clock))

# arenas: the hot rim drains spin outside the safe ring; bumpers fling tops back
g.arena = "hot"
check("the closing ring starts open", g.safe_r(g.go_at + 1) > T.R)
check("then closes in", g.safe_r(g.go_at + T.HOT_ARENA[1] + 1) < T.R * 0.5)
check("sudden death everywhere", (setattr(g, "arena", "classic") or g.safe_r(g.go_at + T.SUDDEN[1])) < T.R * 0.4)
g.arena = "hot"
t.x, t.y, t.vx, t.vy, t.sx, t.sy, t.spin, t.heavy_until = 5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8, 0.0
with r.cond:
    g.move(0.1, g.go_at + T.HOT_ARENA[1] + 1)
check("🔥 the hot rim drains spin", t.spin < 0.8 - T.HOT_DRAIN * 0.05, f"{t.spin:.3f}")
g.arena, g.bumpers = "bumpers", [(2.0, 0.0)]
t.x, t.y, t.vx, t.vy, t.spin = 2.0 - T.BUMP_R - T.BODY + 0.05, 0.0, 3.0, 0.0, 0.8
with r.cond:
    g.move(1 / 30, clock)
check("🔵 a bumper flings a top back", t.vx < -2, f"{t.vx:.2f}")
g.bumpers = []
mix = set()
r2, g2, _ = game(2, bots=["normal"])
for _ in range(6):
    g2.round += 1
    mix.add(g2.next_arena())
check("mixed arenas vary by round", len(mix) >= 3, f"{mix}")

# the deciding knockout plays in slow motion, then the round ends
r, g, (a, b) = game()
clock = step(r, g, T.LAUNCH + 0.1, g.launch_at)
g.tops[1].spin = 0.0001
g.tops[0].x, g.tops[1].x = -3.0, 3.0
with r.cond:
    g.frame(clock + 0.04)
check("knockout → slow motion", g.slow_until > 0 and g.stage == "spin" and g.slow_left == [0])
clock = step(r, g, T.SLOW_T + 0.2, clock + 0.04)
check("then the round ends with the winner", g.stage == "between" and g.result[0] == 0 and g.tops[0].streak == 1)

# old saves (before #179) still load and play
import pickle  # noqa: E402
r, g, (a, b) = game()
clock = step(r, g, T.LAUNCH + 0.1, g.launch_at)
for k in ("arena", "bumpers", "slow_until", "slow_left", "slow_at", "duel_said", "arena_bag", "bot_rev"):
    g.__dict__.pop(k, None)
for t in g.tops:
    for k in ("kind", "rev_at", "heavy_until", "turbo_until", "dashed_at", "smash_by", "smash_at", "streak"):
        t.__dict__.pop(k, None)
g.sparks = [[1.0, 1.0, clock, 7]]
r = pickle.loads(pickle.dumps(r))
g2 = r.game
a = r.players[a.id]
with r.cond:
    g2.frame(clock + 0.05)
    g2.frame(clock + 0.1)
check("an old save loads and steps", g2.arena == "classic" and g2.tops[0].kind == "bal" and len(g2.sparks[0]) >= 5 if g2.sparks else True)
import json as _j  # noqa: E402
_j.dumps(g2.view(a))
check("old save's view serialises", True)

# bots play whole games (and use the new buttons)
for n_bots in (2, 5):
    r, g, ps = game(1, bots=["hard", "normal", "easy", "hard", "normal"][:n_bots])
    ps[0].bot = "normal"
    clock = step(r, g, 600, g.launch_at)
    check(f"{n_bots + 1} bots finish a game", r.phase == "over", r.log[-1]["text"])

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
