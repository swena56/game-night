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
check("skee stacked cups score 50, 40, and 30 from top to bottom",
      [M.skee_score(0, y)[0] for _, _, y in M.SK_RINGS[:3]] == [50, 40, 30])
check("skee lower catch ring scores 20", M.skee_score(0, 0.29)[:2] == (20, "20"))
check("skee bottom return scores 10", M.skee_score(0, 0.09)[:2] == (10, "gutter"))
check("skee old boards retain their original scoring",
      M.skee_score(0, 0.5, rings=M.SK_LEGACY_RINGS)[:2] == (50, "50"))
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

# basketball
for settings, seconds in (({}, 60), ({"clock": 90}, 90), ({"clock": 120}, 120)):
    r, g, (a, b) = game(booth_type="hoops", **settings)
    g.t0 = time.time()
    g.on_timeout()
    view = g.view(a)["midway"]
    check(f"basketball opens with a {seconds}-second clock",
          view["clock"] == seconds and r.deadline - g.t0 == seconds and seconds - 1 < view["timeLeft"] <= seconds)

r, g, (a, b) = game(booth_type="hoops")
g.on_timeout()
g.rng = Still()
_, hoop_y, _, _, _ = M.HOOPS[0]
g.t0 = time.time() + M.HOOP_FLIGHT - (M.HOOP_CENTER_PAUSE + M.HOOP_PERIOD / 4)
check("basketball defaults to a fixed hoop for players and bots",
      g.view(a)["midway"]["geo"]["travel"] == 0 and g.targets(b)[0][1] == 0)
sh = throw(g, a, 0, hoop_y)
check("a centered shot scores with the fixed hoop", sh["targetX"] == 0 and sh["pts"] == 1)
sh = throw(g, a, M.HOOP_TRAVEL, hoop_y)
check("a shot away from the fixed hoop misses", sh["targetX"] == 0 and sh["pts"] == 0)
kinds = lambda sim: [k[7] for k in sim["path"]]
sh = throw(g, a, 0.04, 1.0)
check("a high shot banks off glass for one point",
      sh["pts"] == 1 and sh["bank"] and not sh["swish"] and "board" in kinds(sh))
check("a shot's path starts at launch and ends at its landing time",
      sh["path"][0][7] == "launch" and sh["path"][-1][0] == sh["landAt"] and sh["path"][-1][7] == "net")
sh = throw(g, a, 0, hoop_y)
check("a clean centered shot is a swish with no contacts", sh["swish"] and kinds(sh) == ["launch", "net"])
sh = throw(g, a, 0.3, hoop_y)
check("a shot wide of the ring rattles off the iron without scoring", sh["pts"] == 0 and "rim" in kinds(sh))
sh = throw(g, a, 0.0, 0.3)
check("a weak shot meets the front of the rim and misses", sh["pts"] == 0 and "rim" in kinds(sh))
sim = M.hoop_sim(0.68, -0.75, 1.0, 0, 0)
check("a cross-court ball kicks off the side rail instead of passing the glass",
      "rail" in kinds(sim) and all(abs(k[1]) <= M.RAIL_LIMIT + 1e-6 for k in sim["path"]))
check("every path stays on the right side of the glass and ends", all(k[3] >= M.SIM_BOARD_Z - 1e-6 for k in sim["path"])
      and sim["path"][-1][7] in ("net", "end"))
check("the simulation is deterministic", M.hoop_sim(0.2, 0.05, 0.7, 1.3, M.HOOP_TRAVEL) == M.hoop_sim(0.2, 0.05, 0.7, 1.3, M.HOOP_TRAVEL))
moving = M.hoop_sim(0, 0.51, hoop_y, 0.25, M.HOOP_TRAVEL)
check("a moving hoop is followed during the flight", moving["good"] == (abs(0.51 - M.hoop_x(0.25 + moving["landAt"])) < 0.19))

r, g, (a, b) = game(booth_type="hoops", hoop_movement="moving")
g.on_timeout()
g.rng = Still()
check("basketball is timed and has one shared hoop", g.view(a)["midway"]["throws"] is None
      and g.view(a)["midway"]["timeLeft"] > 0
      and g.view(a)["midway"]["geo"]["hoops"] == M.HOOPS
      and len(M.HOOPS) == 1 and g.view(b)["midway"]["geo"]["travel"] == M.HOOP_TRAVEL)
check("basketball accepts a modest power error while keeping lateral aim important",
      M.hoop_sim(0, 0, hoop_y + 0.12, 0, 0)["good"] and not M.hoop_sim(0, 0.27, hoop_y, 0, 0)["good"])
pause = M.HOOP_CENTER_PAUSE
leg = M.HOOP_PERIOD / 2 + pause
peak = pause + M.HOOP_PERIOD / 4
check("the hoop pauses at center before moving in either direction",
      M.hoop_x(pause / 2) == 0 and M.hoop_x(leg + pause / 2) == 0)
check("the hoop travels in both directions", M.hoop_x(peak) == M.HOOP_TRAVEL
      and M.hoop_x(leg + peak) == -M.HOOP_TRAVEL)

def moving_hoop_x():
    return M.hoop_x(time.time() - g.t0 + M.HOOP_FLIGHT)

g.t0 = time.time() + M.HOOP_FLIGHT - peak
got = []
for _ in range(5):
    sh = throw(g, a, moving_hoop_x(), hoop_y)
    got.append((sh["pts"], sh["hot"]))
    check("every shot in the streak scored", sh["hoop"] == 0 and not sh["jack"], str(sh))
check("the hot hand starts on the fourth basket, and a clean swish on it pays one more",
      got == [(1, False), (1, False), (1, False), (3, True), (3, True)], str(got))
check("the score counts the bonuses", a.g.booth_pts == 9)
sh = throw(g, a, -moving_hoop_x(), hoop_y)
check("a shot on the opposite side misses", sh["hoop"] is None and sh["pts"] == 0 and a.g.streak == 0)
import random as _rr
def bot_rate(level):
    rr, n = _rr.Random(11), 0
    for _ in range(300):
        tx = rr.gauss(0, M.BOT_HOOP_SIGMA[level])
        aim, power = g.to_throw(tx, hoop_y + rr.gauss(0, M.BOT_HOOP_SIGMA[level]))
        x, y = M.hoop_land(aim, power, rr)
        n += M.hoop_sim(0, x, y, 0, 0)["good"]
    return n / 300
rates = [bot_rate(level) for level in ("easy", "normal", "hard")]
check("basketball bots get steadily better with level", rates[0] + 0.1 < rates[1] < rates[2] and 0.35 < rates[0] < 0.7 and rates[2] > 0.8, str(rates))
for level in M.BOT_SIGMA:
    b.bot = level
    b.g.next_at = 0
    before = len(b.g.shots)
    g.bot_tick()
    check(f"{level} bot takes a basketball shot", len(b.g.shots) == before + 1 and b.g.shots[-1]["k"] == "hoops")
for p in (a, b):
    for _ in range(9):
        throw(g, p, moving_hoop_x(), hoop_y)
check("both players can exceed eight shots without ending the round",
      len(a.g.shots) > 8 and len(b.g.shots) > 8 and g.stage == "play")
r.deadline = time.time() - 1
check("basketball rejects shots after the clock expires", refused(g, a, {"type": "throw", "aim": 0, "power": 0.5}))
check("basketball bots stop at the buzzer", not g.bot_ready())
g.on_timeout()
check("the final basketball can return after the buzzer", g.stage == "settle")
g.on_timeout()
check("basketball advances to the standings", g.stage == "between")

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
check("equal tickets and jackpots record a draw", r.history[-1].get("draw") is True and r.winner is None
      and "Ann & Bo" in r.history[-1]["text"]
      and all(not row["won"] and row["pts"] == server.POINTS_PLAYED for row in r.history[-1]["players"]))

r, g, (a, b) = game()
g.round_no = g.total
a.g.tickets = b.g.tickets = 12
b.g.jackpots = 1
g.after_round()
check("jackpots break a ticket tie", r.winner == b.id and not r.history[-1].get("draw"))

r, g, (a, b) = game()
check("the default night visits all four booths once", g.total == 4 and set(g.order) == set(M.BOOTHS), str(g.order))
r, g, (a, b) = game(booths=6)
check("six rounds: all booths once and two repeats, never back to back",
      len(g.order) == 6 and set(g.order) == set(M.BOOTHS)
      and len(set(g.order[4:])) == 2 and all(x != y for x, y in zip(g.order, g.order[1:])), str(g.order))

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

# basketball: glass shots are a real, deliberate window: centred and hard goes in, from either side too, but wide does not
bank = lambda sx, x, y: M.hoop_sim(sx, x, y, 0, 0)
check("a centred shot off the glass scores as a bank", all(bank(sx, 0, y)["good"] and bank(sx, 0, y)["bank"] for sx in (-0.68, 0, 0.68) for y in (0.95, 1.0, 1.05)))
check("a glass shot aimed wide of the hoop misses", not any(bank(0, x, 1.0)["good"] for x in (-0.3, 0.3)))
check("the bank window is no wider than a few swishes",
      sum(bank(0, x / 100, y / 100)["bank"] and bank(0, x / 100, y / 100)["good"] for x in range(-48, 49, 3) for y in range(30, 120, 2))
      <= 1.5 * sum(bank(0, x / 100, y / 100)["swish"] for x in range(-48, 49, 3) for y in range(30, 120, 2)))

# basketball: hot hand and swish bonus
r, g, (a, b) = game(booth_type="hoops")
g.on_timeout()
g.rng = Still()
_, hoop_y, _, _, _ = M.HOOPS[0]
swishes = [throw(g, a, 0, hoop_y) for _ in range(M.HOT_AT)]
check("basketball: baskets before the hot hand pay one point each", [s_["pts"] for s_ in swishes] == [1] * M.HOT_AT)
sh = throw(g, a, 0, hoop_y)
check("basketball: a swish on the hot hand pays double plus one", sh["hot"] and sh["swish"] and sh["pts"] == 3, str(sh["pts"]))
sh = throw(g, a, 0.04, 1.0)
check("basketball: a bank on the hot hand pays double with no swish bonus", sh["hot"] and sh["bank"] and sh["pts"] == 2, str(sh["pts"]))
sh = throw(g, a, 0.3, hoop_y)
check("basketball: a miss ends the hot hand", sh["pts"] == 0 and a.g.streak == 0)
sh = throw(g, a, 0, hoop_y)
check("basketball: the next basket is plain again", not sh["hot"] and sh["pts"] == 1)

# basketball bots land about the advertised share of shots (seeded, so this cannot flake)
for level, lo, hi in (("easy", 0.40, 0.60), ("normal", 0.65, 0.85), ("hard", 0.80, 0.95)):
    r, g, (a, b) = game(booth_type="hoops")
    g.on_timeout()
    g.rng = random.Random(7)
    b.bot = level
    made = 0
    for _ in range(400):
        aim, power = g.plan(b)
        b.g.last_at = 0
        g.throw(b, aim, power)
        made += b.g.shots[-1]["pts"] > 0
    check(f"basketball: {level} bot makes {lo:.0%}-{hi:.0%} of shots", lo <= made / 400 <= hi, f"{made / 400:.0%}")

# the view is JSON and has no secrets worth hiding (every booth is public), and spectators can watch
import json
r, g, (a, b) = game()
json.dumps(g.view(a))
spec = r.add_player("Zed")
check("a spectator's view works", g.view(spec)["midway"]["me"] is None)

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
