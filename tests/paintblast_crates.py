"""Paint Blast 📦 Crate Clear (#364): the round ends a moment after the last crate goes, with a hidden time limit;
the finale and the comeback come with the last crates, not the clock; other modes keep their clock.

    python3 tests/paintblast_crates.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import paintblast as pb  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def arena(mode="crates", **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo")]
    r.switch_game("paintblast")
    r.settings.update(mode=mode, **settings)
    r.push_fast = lambda d: None
    r.start()
    g = r.game
    now = time.time()
    g.stage, g.ends_at, g.last_frame = "play", now + (pb.CRATE_CAP if mode == "crates" else g.s["secs"]), now
    return r, g, now


def run(g, now, ticks):
    for _ in range(ticks):
        now += 1 / pb.TICK
        g.frame(now)
        if g.stage != "play":
            break
    return now


def keep(g, count):
    """Leave only `count` crates."""
    for c in [c for c, t in enumerate(g.tiles) if t == pb.CRATE][count:]:
        g.tiles[c] = pb.FLOOR


r, g, now = arena()
view = g.view(r.players[g.seats[0]])["paintblast"]
check("the screen is told it's Crate Clear", view["crateClear"] is True and view["lastCrates"] == pb.LAST_CRATES)
now = run(g, now + 100, 5)
check("long past the round length, crates standing: still playing", g.stage == "play")
keep(g, 1)
now = run(g, now, 3)
check("one crate left: still playing", g.stage == "play" and g.finale)
keep(g, 0)
now = run(g, now, pb.CLEAR_HOLD - 1)
check("the last crate's blast gets a moment before the count", g.stage == "play")
now = run(g, now, 4)
check("then the round ends and the paint is counted", g.stage == "over" and g.last_points == [g.round_points(i) for i in range(2)], (g.stage, g.last_points))

r, g, now = arena()
g.ends_at = now + 0.2
run(g, now, 12)
check("the hidden limit ends a round nobody will finish", g.stage == "over" and g.crates_left() > 0)

r, g, now = arena()
keep(g, pb.LAST_CRATES + 3)
gold = len(g.gold)
now = run(g, now, 3)
check("no finale with plenty of crates left", not g.finale and len(g.gold) == gold)
keep(g, pb.LAST_CRATES)
run(g, now, 3)
check("the finale comes with the last crates", g.finale and len(g.gold) > gold)

r, g, now = arena(closing=True)
keep(g, 2)
pillars = g.tiles.count(pb.PILLAR)
run(g, now, 24)
check("walls never close in here (they would take crates)", g.closed == 0 and g.tiles.count(pb.PILLAR) == pillars)

r, g, now = arena()
keep(g, g.crates_at_start // 3)
for c in range(30):
    g.paint[c] = 1
run(g, now, 2)
check("the comeback comes when a third of the crates are left", g.boosted and g.maxb[1] == 2, (g.maxb, g.reach))

r, g, now = arena("paint")
keep(g, 0)
run(g, now, pb.CLEAR_HOLD + 6)
check("paint points still runs on its clock with no crates", g.stage == "play" and not g.view(r.players[g.seats[0]])["paintblast"]["crateClear"])

for level in ("easy", "normal", "hard"):
    r, g, now = arena(rounds=1)
    for p in r.players.values():
        p.bot = level
    g.stage, g.next_at = "countdown", now
    k = 0
    while r.phase == "playing" and k < 20000:
        k, now = k + 1, now + 1 / pb.TICK
        g.frame(now)
    check(f"{level} bots finish a Crate Clear match", r.phase == "over", (r.phase, g.crates_left()))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
