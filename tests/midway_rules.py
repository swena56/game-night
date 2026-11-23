"""Midway Night rules: throws land where aimed (give or take the wobble) and score by booth, cans fall with their
supports, a clean sweep restacks and pays, the jackpot pays once, the hot hand doubles, bad throws are refused,
the countdown and the throw clock run the rounds, and the night ends after the last booth.

    python3 tests/midway_rules.py
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import midway as M  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


class Still(random.Random):
    """No wobble, no luck: every gauss is 0 and every coin lands heads-up (no bounce, no neighbour)."""
    def gauss(self, mu=0.0, sigma=1.0):
        return mu

    def random(self):
        return 0.99


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("midway")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def booth(g, kind):
    """Force the current round to `kind` and open it."""
    g.order[g.round_no - 1] = kind
    g.round_no -= 1
    g.new_round()
    g.on_timeout()          # the bell
    g.rng = Still()


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def throw(g, p, x, y):
    p.g.last_at = 0
    aim, power = g.to_throw(x, y)
    g.act(p, {"type": "throw", "aim": aim, "power": power})
    return p.g.shots[-1]


s = Still()
# -- pure maths
check("skee centre scores 50", M.skee_score(0, M.SK_CY)[0] == 50)
check("skee corner cup scores 100", M.skee_score(*M.SK_CUPS[0])[0] == 100)
check("skee short scores 0", M.skee_score(0, -0.1)[:2] == (0, "short"))
import random as _r
_rg = _r.Random(3)
_x, _y, _rat = M.skee_settle(0.0, M.SK_CY + M.SK_RINGS[0][0] + 0.003, _rg)
check("a ball on a ring's wire rattles to one side", _rat and abs(((_x ** 2 + (_y - M.SK_CY) ** 2) ** 0.5) - M.SK_RINGS[0][0]) > M.SK_LIP)
check("a ball in the middle of a ring stays put", M.skee_settle(0.0, M.SK_CY, _rg) == (0.0, M.SK_CY, False))
check("short balls don't rattle", M.skee_settle(0.0, -0.1, _rg)[2] is False)
check("skee wide falls to the 10", M.skee_score(0.5, 0.2)[0] == 10)
check("ring on a neck rings it", M.ring_settle(*M.BOTTLES[7], s)[0] == 7)
check("ring between necks misses", M.ring_settle(0.11, 0.80, s)[0] is None)
bottom_mid = M.CAN_AT[(0, 1)]
fell = M.can_knock(bottom_mid, M.CANS[bottom_mid][2], [True] * 10, s)
check("a bottom can takes the cans it holds up", sorted(fell) == sorted([bottom_mid, M.CAN_AT[(1, 0)], M.CAN_AT[(1, 1)],
                                                                         M.CAN_AT[(2, 0)], M.CAN_AT[(2, 1)], M.CAN_AT[(3, 0)]]), str(fell))
top = M.CAN_AT[(3, 0)]
check("the top can falls alone", M.can_knock(top, 0, [True] * 10, s) == [top])
check("a ball over the cans hits nothing", M.can_hit(0, 0.9, [True] * 10) is None)
check("a ball hits a standing can", M.can_hit(*M.CANS[0][2:], [True] * 10) == 0)
check("a fallen can can't be hit", M.can_hit(*M.CANS[0][2:], [False] + [True] * 9) is None)

# -- the round flow
r, g, (a, b) = game()
check("starts in the countdown", g.stage == "count" and r.deadline == g.t0)
check("no throws before the bell", refused(g, a, {"type": "throw", "aim": 0, "power": 0.5}) == "Wait for the bell!")
g.on_timeout()
check("the bell opens the booth", g.stage == "play" and abs(r.deadline - (g.t0 + g.clock)) < 1e-6)
for bad in ({"aim": 2, "power": 0.5}, {"aim": 0, "power": -0.1}, {"aim": "x", "power": 0.5}, {"aim": True, "power": 0.5},
            {"aim": float("nan"), "power": 0.5}, {"aim": 0}):
    check(f"refuses {bad}", refused(g, a, {"type": "throw", **bad}) == "Bad throw.")

# skee
booth(g, "skee")
sh = throw(g, a, 0, M.SK_CY)
check("skee: a centre roll pays 50", sh["pts"] == 50 and a.g.tickets == 50, str(sh))
check("too quick a second throw is refused", refused(g, a, {"type": "throw", "aim": 0, "power": 0.5}) == "One at a time!")
g.jack_by = None
jx, jy = g.jack
sh = throw(g, b, jx, jy)
check("skee: the jackpot pays +100 once", sh["jack"] and g.jack_by == b.id and b.g.jackpots == 1, str(sh))
sh = throw(g, a, jx, jy)
check("skee: a second jackpot hit doesn't pay it", not sh["jack"])

# hot hand
booth(g, "skee")
pts = [throw(g, a, 0, M.SK_CY)["pts"] for _ in range(5)]
check("hot hand doubles after three good throws", pts == [50, 50, 50, 100, 100], str(pts))
sh = throw(g, a, 0, -0.5)
check("a miss ends the hot hand", sh["pts"] == 0 and a.g.streak == 0)
check("hot hand flag shows", a.g.shots[3]["hot"] and not a.g.shots[2]["hot"])

# rings
booth(g, "rings")
i = next(k for k, c in enumerate(g.colours) if c == "r" and k != g.jack)
sh = throw(g, a, *M.BOTTLES[i])
check("rings: a red bottle pays 80", sh["b"] == i and sh["pts"] == 80, str(sh))
sh = throw(g, a, 0.11, 0.8)
check("rings: between the necks pays nothing", sh["b"] is None and sh["pts"] == 0)
sh = throw(g, b, *M.BOTTLES[g.jack])
check("rings: the gold bottle pays the jackpot", sh["jack"] and sh["pts"] == M.RT_PTS[g.colours[g.jack]] + M.JACKPOT)

# cans
booth(g, "cans")
g.jack_by = b.id          # the jackpot's gone: count plain cans
mid = M.CANS[bottom_mid]
sh = throw(g, a, mid[2], mid[3])
check("cans: a bottom-middle hit drops six", len(sh["fell"]) == 6 and sh["pts"] == 60, str(sh["fell"]))
left = [k for k, up in enumerate(a.g.cans) if up]
for k in left:
    if a.g.cans[k] and not a.g.stacks:
        throw(g, a, M.CANS[k][2], M.CANS[k][3])
check("cans: clearing the stack restacks it", all(a.g.cans) and a.g.stacks == 1 and a.g.shots[-1]["sweep"])
check("cans: the sweep pays its bonus", a.g.shots[-1]["pts"] >= M.SWEEP)

# out of throws, early finish, end of the night
booth(g, "cans")
for p in (a, b):
    while p.g.left:
        throw(g, p, 0, 0.95)
check("out of throws is refused", refused(g, a, {"type": "throw", "aim": 0, "power": 0.5}) is not None)
check("everyone done settles the round", g.stage == "settle" and r.deadline <= time.time() + M.SETTLE + 0.01)
g.on_timeout()
check("then the standings", g.stage == "between" and g.view(a)["midway"]["standings"])

r, g, (a, b) = game(booths=3)
for _ in range(3):
    g.on_timeout()        # bell
    g.on_timeout()        # clock runs out
    g.on_timeout()        # standings over
check("the night ends after the last booth", r.phase != "playing" and g.round_no == 3)
r, g, (a, b) = game(booths=6)
check("six booths: each booth twice, never twice in a row",
      sorted(g.order) == sorted(M.BOOTHS * 2) and all(x != y for x, y in zip(g.order, g.order[1:])), str(g.order))

# single-booth matches
for kind in M.BOOTHS:
    for rounds in (3, 6):
        r, g, (a, b) = game(booths=rounds, booth_type=kind)
        check(f"{kind}: all {rounds} rounds use the selected booth",
              g.view(a)["midway"]["order"] == [kind] * rounds)
        for _ in range(rounds):
            check(f"round {g.round_no} opens {kind}", g.kind == kind)
            g.on_timeout()
            g.on_timeout()
            g.on_timeout()
        check(f"{kind}: match ends after {rounds} rounds", r.phase == "over" and g.round_no == rounds)

# leaving
r, g, (a, b, c) = game(3)
g.on_timeout()
g.on_leave(c)
check("a leaver doesn't block the round", c not in g.present() and r.phase == "playing")
g.on_leave(b)
check("the last one standing wins", r.phase != "playing")

# the view is JSON and has no secrets worth hiding (every booth is public), and spectators can watch
import json
r, g, (a, b) = game()
json.dumps(g.view(a))
spec = r.add_player("Zed")
check("a spectator's view works", g.view(spec)["midway"]["me"] is None)

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
