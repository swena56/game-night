"""Cannon Hills rules: craters and mounds change the ground, cannons drop (and a long drop hurts), you can
hit yourself, a splitter lands three times, bad shots are refused, shells run out, a knockout ends the
round, and ⚡ All at once fires everyone's shells together.

    python3 tests/cannon_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import cannon as C  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("cannon")
    r.settings.update(settings)
    r.start()
    g = r.game
    g.wind = 0
    return r, g, ps


def flat(g, h=60):
    """Level ground, cannons where they were, standing on it."""
    g.terrain = [h] * C.W
    for t in g.tanks:
        t[1] = float(h)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def first(r, g, ps):
    """The player whose turn it is, and the other one."""
    me = next(p for p in ps if p.id == r.turn)
    return me, next(p for p in ps if p is not me)


# craters dig, mounds build
t = [60] * C.W
C.carve(t, 100, 60, 16)
check("a crater digs down", t[100] < 50 and t[100] >= 60 - 17 and t[60] == 60, f"{t[100]}")
t = [60] * C.W
C.mound(t, 100, 60, 18)
check("a dirt bomb heaps a mound", t[100] > 70 and t[60] == 60, f"{t[100]}")

# a shell straight up comes back down on the shooter
r, g, ps = game()
flat(g)
me, other = first(r, g, ps)
i = g.seat(me)
g.tanks[i][0] = 60.0
g.tanks[1 - i][0] = 260.0
g.act(me, {"type": "fire", "angle": 90, "power": 0.5, "shell": "shell"})
check("you can hit yourself", g.tanks[i][2] < C.HP, f"hp {g.tanks[i][2]}")
check("the crater under you drops your cannon", g.tanks[i][1] < 60, f"y {g.tanks[i][1]}")
check("the turn passes", r.turn == other.id)
check("the shot is recorded for playback", g.shot and g.shot["paths"] and g.shot["booms"] and len(g.shot["before"]) == C.W)
check("your trail is kept", g.trails[i] and len(g.trails[i]) > 3)

# fall damage
r, g, ps = game()
flat(g, 120)
me, other = first(r, g, ps)
j = g.seat(other)
x = int(g.tanks[j][0])
for c in range(x - 3, x + 4):
    g.terrain[c] = 40
falls = g.settle()
check("a long drop hurts", g.tanks[j][1] == 40 and any(f[0] == j and f[1] > 0 for f in falls) and g.tanks[j][2] == C.HP - C.FALL_MAX, f"{falls} hp {g.tanks[j][2]}")
for c in range(x - 3, x + 4):
    g.terrain[c] = 3
g.settle()
check("sinking into the sea knocks you out", g.tanks[j][2] == 0)

# the splitter lands three times
r, g, ps = game()
flat(g)
me, other = first(r, g, ps)
i = g.seat(me)
g.tanks[i][0], g.tanks[1 - i][0] = 40.0, 280.0
ang = 60 if g.tanks[i][0] < g.tanks[1 - i][0] else 120
g.act(me, {"type": "fire", "angle": ang, "power": 0.6, "shell": "split"})
check("a splitter makes three blasts", len(g.shot["booms"]) == 3 and len(g.shot["paths"]) == 4, f"{len(g.shot['booms'])} booms")
check("and is used up", g.ammo[i]["split"] == 0)
g.act(other, {"type": "fire", "angle": 90, "power": 0.05, "shell": "shell"})
check("no second splitter this round", refused(g, me, {"type": "fire", "angle": 60, "power": 0.5, "shell": "split"}) is not None)

# bad shots are refused
for bad in ({"type": "fire", "angle": "x", "power": 0.5}, {"type": "fire", "angle": 200, "power": 0.5},
            {"type": "fire", "angle": 45, "power": 1.5}, {"type": "fire", "angle": 45, "power": float("nan")},
            {"type": "fire", "angle": True, "power": 0.5}, {"type": "fire", "angle": 45, "power": 0.5, "shell": "nuke"},
            {"type": "boom"}):
    check(f"refused {bad}", refused(g, me, bad) is not None)
check("not your turn", refused(g, other, {"type": "fire", "angle": 45, "power": 0.5}) is not None)

# a knockout ends the round, and the winner scores it
r, g, ps = game(rounds=3)
flat(g)
me, other = first(r, g, ps)
i, j = g.seat(me), g.seat(other)
g.tanks[j][2] = 5
g.tanks[i][0], g.tanks[j][0] = 100.0, 140.0
# aim with the bot's own planner so the shot lands on the rival
a, pw, _ = g.plan_shot(i, "hard")
for _ in range(5):
    if g.between:
        break
    g.fire_turn(i, a, pw, "big")
    g.ammo[i]["big"] = 1
    if not g.between:
        g.tanks[j][2] = 5
        r.turn = me.id
check("a knockout ends the round", g.between and r.turn is None and g.wins[i] == 1, f"wins {g.wins}")
check("standings show between rounds", g.view(me)["cannon"]["standings"])
g.on_timeout()
check("the next round starts on fresh ground", g.round_no == 2 and not g.between and all(t[2] == C.HP for t in g.tanks))

# clinching ends the game early
g.wins[i] = 2
g.end_round([i])
g.after_round()
check("a clinched game finishes", r.phase == "over" and r.winner == me.id, r.phase)

# ⚡ All at once
r, g, ps = game(n=3, volley=1)
flat(g)
check("no one has the turn in a volley", r.turn is None)
g.ready_at = 0
a, b, c = ps
g.act(a, {"type": "fire", "angle": 90, "power": 0.05})
check("locking in waits for the others", g.shot is None and g.seat(a) in g.locked)
check("one lock each", refused(g, a, {"type": "fire", "angle": 90, "power": 0.05}) is not None)
check("locks show on the chip", "✅" in g.meta(a))
g.act(b, {"type": "fire", "angle": 90, "power": 0.05})
g.act(c, {"type": "fire", "angle": 90, "power": 0.05})
check("all three fly together", g.shot and sorted(g.shot["by"]) == [0, 1, 2] and len(g.shot["booms"]) == 3)
check("and a new volley opens", not g.locked and g.ready_at > 0)
check("firing again before they land is refused", refused(g, a, {"type": "fire", "angle": 90, "power": 0.05}) is not None)

# the view serialises and hides nothing it shouldn't need to
import json  # noqa: E402
json.dumps(g.view(a))
check("the view serialises", True)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
