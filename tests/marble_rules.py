"""Marble Rush: the course generator (connected, solvable, same seed → same course, holes off the quick
route's centre line), what a browser may report (positions, finish times), rounds, totals with a time-out
cap, the end of the game, bots by level, and clocks moving with a restore.

    python3 tests/marble_rules.py        # a few seconds
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402
from games.marble import gen_course, bfs, DIRS, Marble, MAX_SPEED, STEP  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError:
        return True
    return False


# -- courses
bad = []
for seed in range(200):
    for size in ("small", "medium", "large"):
        for hz in ("off", "some", "lots"):
            c = gen_course(random.Random(seed), size, hz)
            w, h = c["w"], c["h"]
            walls = [c["walls"][r * w:(r + 1) * w] for r in range(h)]
            dist = bfs(walls, c["goal"])
            if any(d < 0 for row in dist for d in row):
                bad.append((seed, size, hz, "unreachable cell"))
            p = c["path"]
            if p[0] != c["start"] or p[-1] != c["goal"]:
                bad.append((seed, size, hz, "path ends"))
            for a, b in zip(p, p[1:]):
                d = next((k for k, v in DIRS.items() if (b[0] - a[0], b[1] - a[1]) == v), None)
                if d is None or walls[a[1]][a[0]] & d:
                    bad.append((seed, size, hz, "path through a wall"))
            for x in c["holes"]:
                for q in p:  # a hole on the route must leave the cell's centre line clear
                    if int(x["x"]) == q[0] and int(x["z"]) == q[1] and abs(x["x"] - q[0] - 0.5) < 0.1 and abs(x["z"] - q[1] - 0.5) < 0.1:
                        bad.append((seed, size, hz, "hole in the middle of the route"))
            if hz == "off" and c["holes"]:
                bad.append((seed, size, hz, "holes with hazards off"))
            for g in c["gems"]:
                if [int(g["x"]), int(g["z"])] in p:
                    bad.append((seed, size, hz, "gem on the route"))
check("1800 courses: every cell reachable, the route runs start → goal through open sides, holes and gems off its line",
      not bad, str(bad[:3]))
check("the same seed makes the same course", gen_course(random.Random(7)) == gen_course(random.Random(7)))
check("different seeds make different courses", gen_course(random.Random(7))["walls"] != gen_course(random.Random(8))["walls"])
c = gen_course(random.Random(3), "medium", "some")
check("a medium board has two 🚩 flags, gems and pads", len(c["flags"]) == 2 and c["gems"] and c["boosts"], str(c["flags"]))


def new_room(n=3, **settings):
    room = server.Room("TEST")
    room.push_fast = lambda data: None   # no streams here (the live server holds the room lock)
    ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    room.switch_game("marble")
    room.settings.update(settings)
    room.start()
    room.game.t0 = time.time() - 30   # skip the countdown; 30 s into the board
    return room, ps, room.game


room, (ann, bo, cy), game = new_room(rounds=3)
check("no turns: everyone races at once, on a deadline", room.turn is None and room.deadline)
check("everyone sees the same course", game.view(ann)["marble"]["course"] is game.view(bo)["marble"]["course"])
check("a position off the board is refused", refused(game, ann, {"type": "pos", "r": 0, "x": 99, "z": 1, "cp": 0}))
check("a position for another board is refused", refused(game, ann, {"type": "pos", "r": 1, "x": 1, "z": 1, "cp": 0}))
check("a fine position is kept", not refused(game, ann, {"type": "pos", "r": 0, "x": 2.5, "z": 1.5, "cp": 1}) and ann.g.x == 2.5)
fast = game.min_ms() - 1
check("a finish faster than the marble's top speed allows is refused", refused(game, ann, {"type": "finish", "r": 0, "ms": fast, "gems": 0}))
check("a finish later than the clock is refused", refused(game, ann, {"type": "finish", "r": 0, "ms": 60000, "gems": 0}))
check("more gems than the board has are refused", refused(game, ann, {"type": "finish", "r": 0, "ms": 20000, "gems": 9}))
check("a true finish counts, gems off", not refused(game, ann, {"type": "finish", "r": 0, "ms": 20000, "gems": 1}) and ann.g.done == 19000)
check("min_ms is the route at top speed", game.min_ms() == int((len(game.course["path"]) - 1) / MAX_SPEED * 1000))
check("once finished, more reports are ignored", not refused(game, ann, {"type": "finish", "r": 0, "ms": 21000, "gems": 0}) and ann.g.done == 19000)
game.act(bo, {"type": "finish", "r": 0, "ms": 25000, "gems": 0})
check("the board stays open while someone is still rolling", game.stage == "race")
game.on_timeout()   # Cy runs out of time
check("the clock ends the board; a time-out counts as the full limit",
      game.stage == "results" and cy.g.total == game.limit() * 1000 and ann.g.total == 19000 and bo.g.total == 25000)
check("standings go out between boards, lowest first", [r["id"] for r in game.view(ann)["marble"]["standings"]] == [ann.id, bo.id, cy.id])
check("no actions between boards", refused(game, ann, {"type": "pos", "r": 0, "x": 1, "z": 1, "cp": 0}))
game.on_timeout()
check("then the next board, a new course", game.stage == "race" and game.round == 1 and game.course != game.results and ann.g.done is None)
for rnd in (1, 2):
    if game.stage == "results":
        game.on_timeout()
    game.t0 = time.time() - 30
    for p, ms in ((ann, 20000), (bo, 18000), (cy, 26000)):
        game.act(p, {"type": "finish", "r": rnd, "ms": ms, "gems": 0})
check("the last board ends the game, lowest total wins",
      room.phase == "over" and room.winner == ann.id and game.final_scores()[ann.id] == 59000, str(game.final_scores()))
check("lower is better in the match history", Marble.low_wins)

# -- leaving mid-board doesn't stall it
room, (ann, bo), game = new_room(2, rounds=1)
game.act(ann, {"type": "finish", "r": 0, "ms": 20000, "gems": 0})
game.on_leave(bo)
check("when the last one still rolling leaves, the board ends", room.phase == "over" or game.stage != "race")

# -- restore moves the clocks
room, (ann, bo), game = new_room(2)
t0, na = game.t0, ann.g.next_at
game.on_restore(100)
check("a restore moves the start and bot clocks", game.t0 == t0 + 100 and ann.g.next_at == na + 100)


# -- #97: the fork (a 🔥 shortcut on the route with a 🌿 longer way round), perks between boards
forks, badf = 0, []
for seed in range(150):
    for size in ("small", "medium", "large"):
        c = gen_course(random.Random(seed), size, "some")
        f = c["fork"]
        if not f:
            continue
        forks += 1
        w = c["w"]
        walls = [c["walls"][r * w:(r + 1) * w] for r in range(c["h"])]
        sh, lg, p = f["short"], f["long"], c["path"]
        i = p.index(sh[0])
        if p[i:i + len(sh)] != sh or lg[0] != sh[0] or lg[-1] != sh[-1] or len(lg) <= len(sh):
            badf.append((seed, size, "ends"))
        for a, b in zip(lg, lg[1:]):
            d = next((k for k, v in DIRS.items() if (b[0] - a[0], b[1] - a[1]) == v), None)
            if d is None or walls[a[1]][a[0]] & d:
                badf.append((seed, size, "long way through a wall"))
        if any(q in p for q in lg[1:-1]):
            badf.append((seed, size, "long way touches the route"))
        if any(fl in sh or fl in lg for fl in c["flags"]):
            badf.append((seed, size, "flag on the fork"))
        if not any(int(b["x"]) == q[0] and int(b["z"]) == q[1] for b in c["boosts"] for q in lg):
            badf.append((seed, size, "no pad on the way round"))
        if not any(int(h["x"]) == q[0] and int(h["z"]) == q[1] for h in c["holes"] for q in sh[1:-1]) and len(sh) > 3:
            pass  # a shortcut of only corners keeps just the corner holes
check("most boards have a fork: the shortcut is on the route, the way round is longer, joins it at both ends, has a pad, no flags on either",
      forks > 270 and not badf, f"{forks}/450 {badf[:3]}")
c = gen_course(random.Random(5), "medium", "off")
check("hazards off: no holes, even on a shortcut", not c["holes"])

room, (ann, bo, cy), game = new_room(rounds=3)
check("no perks on board 1", not ann.g.perks)
check("a perk mid-race is refused", refused(game, ann, {"type": "perk", "r": 0, "perk": "turbo"}))
for p, ms in ((ann, 20000), (bo, 18000), (cy, 26000)):
    game.act(p, {"type": "finish", "r": 0, "ms": ms, "gems": 0})
check("between boards, perks can be picked", game.stage == "results" and not refused(game, ann, {"type": "perk", "r": 0, "perk": "turbo"}))
check("an unknown perk is refused", refused(game, ann, {"type": "perk", "r": 0, "perk": "jetpack"}))
game.act(ann, {"type": "perk", "r": 0, "perk": "shield"})
check("one pick each: a new pick replaces the old", ann.g.pick == ["shield"])
game.act(cy, {"type": "perk", "r": 0, "perk": "turbo"})
game.act(cy, {"type": "perk", "r": 0, "perk": "magnet"})
check("whoever is last picks two", cy.g.pick == ["turbo", "magnet"] and game.view(cy)["marble"]["picks"] == 2 and game.view(ann)["marble"]["picks"] == 1)
game.act(cy, {"type": "perk", "r": 0, "perk": "magnet"})
check("tap a perk again to take it back", cy.g.pick == ["turbo"])
game.on_timeout()
check("picks become the next board's perks, and the view says so",
      ann.g.perks == ["shield"] and cy.g.perks == ["turbo"] and game.view(ann)["marble"]["perks"] == ["shield"] and not ann.g.pick)


# -- bots: faster levels finish faster, over many boards
def bot_time(level, seed):
    room = server.Room("B")
    room.push_fast = lambda data: None
    host = room.add_player("H")
    room.switch_game("marble")
    room.settings.update({"rounds": 1, "size": "medium"})
    host.bot = level
    random.seed(seed)
    room.start()
    room.game.rng = random.Random(seed)
    room.game.seed = seed
    room.game.round = -1
    room.game.begin_round()
    for _ in range(2000):
        if room.phase != "playing" or host.g.done is not None:
            break
        host.g.next_at = 0
        room.game.bot_tick()
    return host.g.done or room.game.final_scores().get(host.id)


avg = {lv: sum(bot_time(lv, s) for s in range(20)) / 20 for lv in ("easy", "normal", "hard")}
check("bots: hard < normal < easy on average", avg["hard"] < avg["normal"] < avg["easy"], {k: round(v) for k, v in avg.items()}.__repr__())
check("a hard bot's medium board takes a human-like 8–25 s", 8000 < avg["hard"] < 25000, str(round(avg["hard"])))
check("a normal bot takes 12–20 s: beatable by a person who learns the board (#97)", 12000 < avg["normal"] < 20000, str(round(avg["normal"])))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
