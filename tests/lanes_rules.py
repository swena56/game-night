"""Lane Night rules: tenpin scoring (strikes, spares, the last frame's bonus balls), the cosmic frame's +10,
the pins fall to a ball in the pocket and stay up for a gutter ball, bad rolls are refused, nobody gets more
than two frames ahead, the spare saver drops a lone pin, and the game ends when everyone has bowled out.

    python3 tests/lanes_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import lanes as L  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


# scoring
check("a perfect game is 300", L.score([10] * 12, 10)[-1] == 300)
check("all 9s are 90", L.score([9, 0] * 10, 10)[-1] == 90)
check("all 5/5 spares (and a 5) are 150", L.score([5] * 21, 10)[-1] == 150)
check("a strike waits for two more balls", L.score([10, 3], 10) == [None])
check("strike then 3,4 is 17 then 24", L.score([10, 3, 4], 10)[:2] == [17, 24])
check("a spare counts the next ball", L.score([7, 3, 5, 0], 10)[:2] == [15, 20])
check("the cosmic frame adds 10 to a mark", L.score([7, 3, 5, 0], 10, cosmic=0)[:2] == [25, 30])
check("an open cosmic frame adds nothing", L.score([7, 2, 5, 0], 10, cosmic=0)[:2] == [9, 14])
check("5-frame games end on frame 5", L.score([10] * 7, 5)[-1] == 150)
check("frames split right", L.frame_rolls([10, 7, 3, 9, 0, 10, 10, 10], 4) == [[10], [7, 3], [9, 0], [10, 10, 10]])

# physics
k, tr, gut = L.roll(list(range(10)), 0.06, 0.0, 0.6, 0.0, 12.0)
check("a ball near the pocket knocks most pins down", len(k) >= 8, f"{len(k)}")
k, tr, gut = L.roll(list(range(10)), 0.45, 0.06, 0.6, 0.0, 12.0)
check("a ball into the gutter knocks nothing", gut and not k)
k, _, _ = L.roll([6], L.SPOTS[6][0], 0.0, 0.6, 0.0, 12.0)
check("a ball at a lone pin knocks it", k == [6])
check("pin tracks carry frames", all(len(t["f"]) >= 1 for t in tr["pins"]) and len(tr["ball"]) > 20)

# the game
r = server.Room("TEST")
ps = [r.add_player(n) for n in ("Ann", "Bo")]
r.switch_game("lanes")
r.start()
g = r.game
ann, bo = ps
ok = {"start": 0.1, "angle": 0.0, "speed": 0.6, "spin": 0.0}
for bad in ({"start": 2}, {"angle": 0.5}, {"speed": -0.1}, {"spin": 3}, {"speed": "fast"}, {"angle": float("inf")}, {"saver": "yes"}):
    check(f"bad roll refused {bad}", refused(g, ann, {"type": "bowl", **ok, **bad}) is not None)
check("the saver can't be armed on a first ball", refused(g, ann, {"type": "bowl", **ok, "saver": True}) is not None)
check("a roll is taken", refused(g, ann, {"type": "bowl", **ok}) is None and len(ann.g.rolls) == 1)
check("both can bowl at once", refused(g, bo, {"type": "bowl", **ok}) is None)
check("no second roll while the pins settle", refused(g, ann, {"type": "bowl", **ok}) is not None)
# #105/#108: once the pins settle the server wakes the bowler with a fresh view, even if nobody else moves
check("a settling bowler is not woken early", ann not in g.sleepers(__import__("time").time()))
ann.g.busy = 0
check("settled pins wake the bowler", ann in g.sleepers(__import__("time").time()) and g.bot_ready())
g.bot_tick()
check("woken once, view says go", ann.g.woke and g.view(ann)["lanes"]["wait"] is None and ann not in g.sleepers(__import__("time").time()))
# race Ann ahead: the lead cap holds her at three frames past Bo
for _ in range(12):
    ann.g.busy = 0
    if refused(g, ann, {"type": "bowl", "start": 0.45, "angle": 0.06, "speed": 0.5, "spin": 0.0}):
        break
check("nobody gets more than two frames ahead", ann.g.frame <= bo.g.frame + L.LEAD + 1 and ann.g.ball == 0, f"{ann.g.frame} vs {bo.g.frame}")
# the spare saver: leave one pin up on a spare ball and arm it
bo.g.busy = 0
bo.g.standing, bo.g.ball = [6, 9], 1   # 7-10 split left; bowl a gutter ball to leave both… then one
bo.g.rolls.append(8)
before = len(bo.g.rolls)
g.act(bo, {"type": "bowl", "start": 0.4, "angle": 0.003, "speed": 0.6, "spin": 0.0, "saver": True})
shot = bo.g.shot
check("the spare saver drops the lone pin", shot["saved"] == 6 and not bo.g.saver and bo.g.rolls[-1] == 2, f"saved {shot['saved']}, knocked {shot['knocked']}")
check("and the frame is a spare", sum(bo.g.rolls[before - 1:]) == 10)
v = g.view(ann)["lanes"]
check("the view has every row and my shot", len(v["rows"]) == 2 and v["shot"] and v["me"] == 0)
check("a rival's shot isn't sent", "shot" not in v["rows"][1])
# bowl out
for _ in range(80):
    if r.phase != "playing":
        break
    for p in ps:
        if not p.g.done:
            p.g.busy = 0
            if not g.can_bowl(p):
                g.bowl(p, 0.06, 0.0, 0.6, 0.0)
check("everyone bowled out: the game waits for the last roll to play (#130)", r.phase == "playing" and g.finish_at > 0 and all(p.g.done for p in ps))
g.finish_at = 1
check("then ends", g.bot_ready() and (g.bot_tick() or True) and r.phase == "over")
fs = g.final_scores()
check("final scores are the totals", fs[ann.id] == g.total(ann) and fs[bo.id] == g.total(bo), f"{fs}")

# a gutter first ball leaves all ten up, but the next ball is still ball 2 (it used to start the frame over)
r = server.Room("TEST3")
gp = r.add_player("Gus")
hp = r.add_player("Hal")
r.switch_game("lanes")
r.start()
g = r.game
gut = {"type": "bowl", "start": 0.4, "angle": 0.12, "speed": 0.5, "spin": 0.0}
for _ in range(2):
    gp.g.busy = 0
    g.act(gp, gut)
check("two gutter balls end the frame", gp.g.frame == 1 and gp.g.ball == 0 and gp.g.rolls == [0, 0], f"frame {gp.g.frame + 1} ball {gp.g.ball} rolls {gp.g.rolls}")
gp.g.busy = 0
g.act(gp, gut)
gp.g.busy = 0
g.bowl(gp, 0.06, 0.0, 0.6, 0.0)
check("gutter then all ten is a spare, not a strike", gp.g.frame == 2 and gp.g.last["word"] in ("spare", None) and gp.g.rolls[2] == 0, f"{gp.g.rolls} {gp.g.last}")
gp.g.frame, gp.g.ball, gp.g.rolls, gp.g.standing = 9, 0, [0, 0] * 9, list(range(10))
hp.g.frame = 9
for _ in range(2):
    gp.g.busy = 0
    g.act(gp, gut)
check("two gutter balls in the last frame finish", gp.g.done and gp.g.rolls[-2:] == [0, 0])

# #110: a bot never gets onto a later frame than the human
r = server.Room("TEST2")
h = r.add_player("Hal")
r.switch_game("lanes")
r.add_bot("normal") if hasattr(r, "add_bot") else None
r.start()
g = r.game
bots = [p for p in g.players() if p.bot]
if bots:
    import time as _t
    b = bots[0]
    for _ in range(40):
        b.g.busy = 0; b.g.next_at = 0
        g.bot_tick()
    check("an idle human holds the bot at frame 2", b.g.frame == 1 and b.g.ball == 0, f"bot on frame {b.g.frame + 1}")
    for _ in range(3):  # the human bowls frame 1 (gutter balls)
        h.g.busy = 0
        if h.g.frame == 1 or refused(g, h, {"type": "bowl", "start": 0.4, "angle": 0.12, "speed": 0.5, "spin": 0.0}):
            break
    check("the human is on frame 2", h.g.frame == 1, f"{h.g.frame}")
    b.g.busy = 0; b.g.next_at = 0
    g.bot_tick()
    check("let go, the bot waits a beat", b.g.frame == 1 and b.g.ball == 0 and b.g.next_at > _t.time())
    for _ in range(20):
        b.g.busy = 0; b.g.next_at = 0
        g.bot_tick()
    check("then bowls frame 2 and no further", b.g.frame == 2 and b.g.ball == 0, f"frame {b.g.frame + 1}")
else:
    check("a bot could be added", False)

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
