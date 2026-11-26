#!/usr/bin/env python3
"""Measure how a pinball level plays, while you build it. See .claude/skills/make-pinball-level/SKILL.md.

  python3 tools/pinball_level.py report TABLE.json [--quick]    gap, side drains, slingshot loops, flipper reach (pass / FAIL)
  python3 tools/pinball_level.py mouths TABLE.json              where real flipper shots go: places for a ramp or wire-lane mouth
  python3 tools/pinball_level.py games TABLE.json... [--games N]   full games by a tapping test player (slow; compare tables)

TABLE.json is a curated file (games/pinball_tables/*.json) or a bare editor spec (games/pinball_official/*.json).
Everything is seeded, but small geometry changes reshuffle every bounce: never trust a difference seen in a few dozen balls.
"""
import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from games.pinball import CustomTable                             # noqa: E402
from games.pinball_custom import build, build_rules               # noqa: E402
from games.pinball_tables.reach import RARE, SHOTS, WEAK_UP, reach  # noqa: E402

MIN_CLEAR = 1.3        # space between the resting flippers, in ball widths
MAX_SIDE = 6.0         # percent of rolled balls that may leave by a side lane (Star Cadet: 2.9, older tables: 11-14)
MAX_SLING_RUN = 5      # slingshot kicks in a row with nothing else hit


def load(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("spec", data)


class Level:
    def __init__(self, spec):
        self.layout, _ = build(spec)
        self.rules = build_rules(spec)
        self.mid = (self.layout.flippers[0][0] + self.layout.flippers[1][0]) / 2

    def table(self, seed):
        table = CustomTable(layout_override=self.layout, rules_override=self.rules, balls=3)
        table.rng = random.Random(seed)
        return table

    def loose(self, seed, x, y, vx, vy):
        """A ball already in play."""
        table = self.table(seed)
        table.staged = False
        table.x, table.y, table.vx, table.vy = x, y, vx, vy
        return table


def clear_gap(level):
    """Free space between the two resting flippers, in table units."""
    lay = level.layout
    tips = [(x + lay.flipper_length * math.cos(rest), y + lay.flipper_length * math.sin(rest)) for x, y, rest, _ in lay.flippers[:2]]
    return math.dist(*tips) - 2 * lay.flipper_radius


def middle_drops(level, count=41):
    """How many balls dropped between the resting flippers drain, with the ball save and centre post already spent."""
    drained = 0
    for k in range(count):
        table = level.loose(k, level.mid - 0.1 + 0.2 * k / (count - 1), 14.6, 0, 2)
        table.save_ticks, table.post_used = 0, True
        for _ in range(240 * 4):
            table.step()
            if table.balls < 3:
                drained += 1
                break
    return drained, count


def side_drains(level, balls):
    """Roll balls down from mid-table: how many leave by a side lane, and how many come to rest somewhere."""
    side = stuck = 0
    for seed in range(balls):
        rng = random.Random(seed)
        table = level.loose(seed, rng.uniform(0.5, 8.3), rng.uniform(9.6, 10.4), rng.uniform(-10, 10), rng.uniform(-3, 8))
        still = 0
        for _ in range(240 * 8):
            table.step()
            if 12.9 < table.y < 13.6 and not table.height and not 0.9 <= table.x <= 7.9:
                side += 1
                break
            if table.balls < 3 or table.staged or (table.y > 14.2 and 0.9 < table.x < 7.9):
                break
            still = still + 1 if abs(table.vx) + abs(table.vy) < 0.4 else 0
            if still > 480:
                stuck += 1
                break
        else:
            stuck += still > 240
    return 100 * side / balls, stuck


def sling_runs(level, drops):
    """The longest run of slingshot hits with nothing else in between, from balls thrown around between the slings."""
    longest = 0
    for seed in range(drops):
        rng = random.Random(seed)
        table = level.loose(seed, rng.uniform(2.6, 6.2), rng.uniform(10.4, 12.4), rng.uniform(-14, 14), rng.uniform(-8, 6))
        event_id, run = table.event_id, 0
        for _ in range(240 * 30):
            table.step()
            if table.event_id != event_id:
                event_id = table.event_id
                run = run + 1 if table.event.startswith("sling") else 0
                longest = max(longest, run)
            if table.balls < 3 or table.staged or table.y > 14.5:
                break
    return longest


def report(spec, quick=False):
    level = Level(spec)
    failed = []

    def line(ok, text):
        print(("pass  " if ok else "FAIL  ") + text, flush=True)
        if not ok:
            failed.append(text)

    gap, ball = clear_gap(level), 2 * level.layout.ball
    line(gap >= MIN_CLEAR * ball, f"flipper gap {gap:.2f}, ball {ball:.2f} ({gap / ball:.1f} balls; need {MIN_CLEAR})")
    drained, count = middle_drops(level)
    line(drained == count, f"{drained} of {count} balls dropped down the middle drain once the saves are spent")
    side, stuck = side_drains(level, 500 if quick else 1500)
    line(side <= MAX_SIDE, f"side lanes take {side:.1f}% of balls rolled from mid-table (limit {MAX_SIDE}%)")
    line(not stuck, f"{stuck} rolled balls came to rest somewhere")
    run = sling_runs(level, 100 if quick else 300)
    line(run <= MAX_SLING_RUN, f"longest slingshot run {run} (limit {MAX_SLING_RUN}; more means the slings juggle the ball)")
    shots = reach(spec, shots=5 if quick else SHOTS)
    never = [p["label"] for p in shots["parts"] if not p["hits"]]
    line(not never, "every part was hit by a flipper shot" if not never else "never hit: " + ", ".join(never))
    weak = [f"{s['flipper']} {s['spot']} {s['ball']} {s['up']}%" for s in shots["spots"] if s["up"] < WEAK_UP]
    line(not weak, "every flipper spot gets the ball up the table" if not weak else "weak spots: " + ", ".join(weak))
    rare = RARE if not quick else 1
    for p in shots["parts"]:
        if p["key"] in ("ramp", "orbit") or 0 < p["hits"] <= rare:
            print(f"      {p['label']}: {p['hits']} of {shots['shots']} shots")
    print("\nOK" if not failed else f"\n{len(failed)} check(s) failed")
    return not failed


def mouths(spec, top=6):
    """Follow real flipper shots with the ramp and wire lane removed, then rank mouth positions by how many shots pass through
    them moving up fast enough to get on (a ramp needs vy < -7, a wire lane vy < -3)."""
    bare = {**spec, "items": [i for i in spec["items"] if i[0] not in ("ramp", "orbit")]}
    level = Level(bare)
    paths = []
    for side in (0, 1):
        px, py = level.layout.flippers[side][:2]
        for dx in (0.15, 0.35, 0.55, 0.75, 0.95):
            for delay in range(6, 200, 4):
                table = level.loose(delay, px + (dx if side == 0 else -dx), py - 0.9, 0, 0)
                table.bank = (1 << len(level.layout.targets)) - 1
                path = []
                for tick in range(delay + 300):
                    table.input(1 << side if delay <= tick < delay + 60 else 0, 0, tick / 240)
                    table.step()
                    if tick > delay:
                        path.append((table.x, table.y, table.vx, table.vy))
                    if table.staged or table.balls < 3:
                        break
                paths.append(path)
    print(f"{len(paths)} flipper shots")
    for name, ys in (("ramp", range(13, 22)), ("wire lane", range(11, 21))):
        found = []
        for x in (v / 4 for v in range(6, 31)):
            for y in (v / 2 for v in ys):
                if name == "ramp":
                    n = sum(any(b[1] <= y < a[1] and b[3] < -7 and abs(b[0] - x) < 0.65 for a, b in zip(p, p[1:])) for p in paths)
                else:
                    n = sum(any(math.hypot(a - x, b - y) < 0.4 and vy < -3 for a, b, _, vy in p) for p in paths)
                found.append((n, x, y))
        found.sort(reverse=True)
        for label, keep in (("left", lambda x: x < level.mid - 0.8), ("right", lambda x: x > level.mid + 0.8)):
            print(f"{name:9} {label:5} best mouths (shots, x, y):", [f for f in found if keep(f[1])][:top])


def play(spec, games, first_seed=3000):
    """Full three-ball games by a player who taps a flipper as the ball reaches it (it never holds the ball)."""
    level = Level(spec)
    drains, unfinished = [], 0
    for seed in range(first_seed, first_seed + games):
        rng = random.Random(seed)
        table = level.table(seed)
        target, press, cool, x = rng.randint(150, 235), [0, 0], [0, 0], level.mid
        for tick in range(240 * 150):
            if not table.balls:
                break
            held = 0
            if table.staged:
                if table.charge < target:
                    held = 4
                else:
                    target = rng.randint(150, 235)
            else:
                for i in (0, 1):
                    mine = (table.x < level.mid) == (i == 0)
                    if not press[i] and not cool[i] and mine and 13.9 < table.y < 15.3 and table.vy > 0 \
                            and abs(table.x - level.mid) < 1.9 and rng.random() < 0.12:
                        press[i] = 30
                    if press[i]:
                        held |= 1 << i
                        press[i] -= 1
                        if not press[i]:
                            cool[i] = 30
                    elif cool[i]:
                        cool[i] -= 1
                if table.y > 9:
                    x = table.x
            balls = table.balls
            table.input(held, 0, tick / 240)
            table.step()
            if table.balls < balls:
                drains.append("side" if not 0.95 <= x <= 7.85 else "middle")
        unfinished += bool(table.balls)
    share = drains.count("side") / max(1, len(drains))
    margin = 200 * math.sqrt(share * (1 - share) / max(1, len(drains)))
    return {"drained": len(drains), "side_percent": round(100 * share), "margin": round(margin), "unfinished_games": unfinished}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("report", "mouths", "games"))
    parser.add_argument("tables", nargs="+")
    parser.add_argument("--quick", action="store_true", help="report: fewer balls and shots, for use while editing")
    parser.add_argument("--games", type=int, default=40)
    args = parser.parse_args(argv)
    if args.command == "games":
        for path in args.tables:
            print(os.path.basename(path), play(load(path), args.games), flush=True)
        return 0
    if args.command == "mouths":
        mouths(load(args.tables[0]))
        return 0
    return 0 if report(load(args.tables[0]), args.quick) else 1


if __name__ == "__main__":
    sys.exit(main())
