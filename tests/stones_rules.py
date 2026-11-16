"""Ice Stones rules: draw weight stops in the house, curl bends the right way, sweeping carries further,
short stones come off, takeouts knock stones out, the end is counted (and a hot stone doubles), bad
throws are refused, turns rotate and the game ends after the last end.

    python3 tests/stones_rules.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import stones as I  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(nm) for nm in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("stones")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


def slide(stones, aim, w, curl=1, sweep=0):
    keep, tracks, hit = I.simulate(stones, {"o": 0, "id": 99}, aim, w, curl, sweep)
    return next((s for s in keep if s["id"] == 99), None), keep, tracks, hit


# physics
s, *_ = slide([], 0.0, 0.38)
check("draw weight stops in the house", s is not None and I.dist(s) <= I.HOUSE + I.R, s and f"{s['x']:.2f},{s['y']:.2f}")
r_, *_ = slide([], 0.0, 0.3, curl=1)
l_, *_ = slide([], 0.0, 0.3, curl=-1)
check("curl bends the way it's set", r_["x"] > 0.3 and l_["x"] < -0.3, f"{r_['x']:.2f} / {l_['x']:.2f}")
a, *_ = slide([], 0.0, 0.25, sweep=0)
b, *_ = slide([], 0.0, 0.25, sweep=2)
check("sweeping carries further and curls less", b["y"] > a["y"] + 1 and abs(b["x"]) < abs(a["x"]), f"{a['y']:.1f}→{b['y']:.1f}")
s, _, tracks, _ = slide([], 0.0, 0.0)
check("a stone short of the hog line comes off", s is None and tracks[0].get("short"))
s, *_ = slide([], 0.0, 1.0)
check("a peel with nothing to hit slides through", s is None)
target = [{"o": 1, "id": 5, "x": 0.0, "y": I.TEE}]
best = None
for aim in [x / 20 for x in range(-20, 1)]:
    _, keep, _, hit = slide(target, aim, 0.85)
    if hit and not any(k["id"] == 5 for k in keep):
        best = aim
        break
check("a takeout knocks a stone out of play", best is not None, f"aim {best}")

# counting
stones = [{"o": 0, "id": 1, "x": 0.1, "y": I.TEE}, {"o": 0, "id": 2, "x": 0.5, "y": I.TEE}, {"o": 1, "id": 3, "x": 0.8, "y": I.TEE},
          {"o": 0, "id": 4, "x": 1.2, "y": I.TEE}]
side, pts, counted = I.count_end(stones)
check("only stones closer than the best rival count", side == 0 and pts == 2 and {s["id"] for s in counted} == {1, 2}, f"{side} {pts}")
stones[1]["hot"] = True
check("a counting hot stone scores double", I.count_end(stones)[1] == 3)
check("an empty house is a blank end", I.count_end([{"o": 0, "id": 1, "x": 0, "y": 15}])[0] is None)

# the game
r, g, (ann, bo) = game(2, ends=2)
check("2 players throw 4 stones each", len(g.order) == 8 and g.order.count(0) == 4)
me = next(p for p in (ann, bo) if p.id == r.turn)
other = bo if me is ann else ann
ok = {"aim": 0.0, "weight": 0.38, "curl": 1, "sweep": 0}
check("not your turn is refused", refused(g, other, {"type": "throw", **ok}) is not None)
for bad in ({"aim": 9}, {"weight": 1.5}, {"curl": 0}, {"curl": True}, {"sweep": 3}, {"aim": "x"}, {"weight": float("nan")}):
    check(f"bad throw refused {bad}", refused(g, me, {"type": "throw", **ok, **bad}) is not None)
check("a good throw is taken", refused(g, me, {"type": "throw", **ok}) is None and g.thrown == 1)
check("the turn passes", r.turn == other.id)
check("you can't throw while stones are sliding", refused(g, other, {"type": "throw", **ok}) is not None)
g.ready_at = 0
check("the view carries the shot's tracks", g.view(other)["stones"]["shot"]["tracks"])
# play the rest of both ends out
for _ in range(40):
    if r.phase != "playing":
        break
    if g.between:
        g.after_end()
        continue
    g.ready_at = 0
    p = r.players[r.turn]
    g.act(p, {"type": "throw", **ok, "aim": 0.0 if g.thrown % 2 else 0.6})
check("the game ends after the last end", r.phase == "over" and len(g.ends_log) == 2, f"{r.phase} {g.ends_log}")
check("points add up", sum(g.points) == sum(p for _, p in g.ends_log))

# timeouts lose the stone; a bot plays from any state within its time budget
r, g, ps = game(3, ends=1)
n0 = g.thrown
g.on_timeout()
check("a timeout loses that stone", g.thrown == n0 + 1)
p = r.players[r.turn]
p.bot = "hard"
t0 = time.time()
g.ready_at = 0
g.bot_turn(p)
check("a hard bot throws within its budget", time.time() - t0 < 3.0 and g.thrown == n0 + 2, f"{time.time() - t0:.2f}s")

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
