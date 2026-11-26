"""Automatic checks for a player-made pinball table, used before it is added to the curated list.

``check(spec)`` builds the table exactly as the server would, then plays it with a simple flipper bot for several three-ball
games and reports whether it is a table worth listing. The bot is crude (it is a sanity check, not a play-tester): it only
catches tables that are broken, unscoreable, instantly drained or impossible to finish. A human still plays it before it is added.
"""
import random
import statistics

from ..base import GameError
from ..pinball import CustomTable
from ..pinball_custom import MAX_ITEMS, build, build_rules, decode_table
from .reach import RARE, WEAK_UP, reach

# what a table has to do to be listed
MIN_PARTS = 6                 # fewer is an empty table
MIN_BALL_SECONDS = 6          # a ball that drains faster than this on average is an instant-drain table
MAX_BALL_SECONDS = 70         # ...and one that never ends is stuck or has no drain
MIN_AVG_SCORE = 2000          # the bot has to be able to score on it
SCORING = {"bump", "sling", "target", "lane", "spinner", "ramp", "saucer", "subway", "orbit", "mover", "hole", "portal", "magnet"}
GAMES, BALLS, TICK_LIMIT = 6, 3, 240 * 150


def _play(spec, seed):
    rng = random.Random(seed)
    layout, _ = build(spec)
    table = CustomTable(layout_override=layout, rules_override=build_rules(spec), balls=BALLS)
    table.rng = random.Random(seed)
    target, spans, last = rng.randint(150, 235), [], 0
    drains, at, last_event = [], (5.0, 12.0), "launch"
    even, cradled, release = spec.get("even_guides") or spec.get("closed_sides"), 0, 0
    for tick in range(TICK_LIMIT):
        if not table.balls:
            break
        if table.staged:
            held = 4 if table.charge < target else 0
            if not held:
                target = rng.randint(150, 235)
        else:
            held = 0
            if table.y > 12.6 and table.vy > -2:
                held |= 1 if table.x < 4.4 else 2
            elif rng.random() < 0.004:
                held |= rng.choice((1, 2, 3))
            if tick % 90 < 12:
                held |= 3
            if even:        # centred flippers: a ball can rest on a raised bat for the rest of the game, so let go and let it roll
                cradled = cradled + 1 if held and table.y > 12.6 and abs(table.vx) + abs(table.vy) < 2.5 else 0
                if cradled > 180:
                    cradled, release = 0, 150
                if release:
                    release, held = release - 1, 0
        before, event_id = table.balls, table.event_id
        if not table.staged and table.y > 9:
            at = (table.x, table.y)                  # where the ball was just before it can drain
        table.input(held, 0, tick / 240)
        table.step()
        if table.event_id != event_id and table.event:
            if table.event not in ("drain", "bonus", "nudge"):
                last_event = table.event.rstrip("0123456789")
        if table.balls < before:
            spans.append((tick - last) / 240)
            last = tick
            drains.append((drain_lane(at[0], layout), last_event))
            last_event = "launch"
    return {"score": table.score, "spans": spans, "finished": not table.balls, "drains": drains}


def drain_lane(x, layout):
    """Which way a ball left the table: down a side outlane (outside the inlane guides) or between the flippers, on the left or right half."""
    inner = (layout.flippers[0][0] + layout.flippers[1][0]) / 2
    if x < 0.95:
        return "left_outlane"
    if x > 7.85:
        return "right_outlane"
    return "left" if x < inner else "right"


def check(spec, games=GAMES):
    """Return {"ok": bool, "problems": [...], "notes": [...], "stats": {...}} for a table spec, code or dict."""
    problems, notes = [], []
    try:
        spec = decode_table(spec)
        layout, clean = build(spec)
    except GameError as e:
        return {"ok": False, "problems": [str(e)], "notes": [], "stats": {}}
    items = clean["items"]
    kinds = {i[0] for i in items}
    if len(items) < MIN_PARTS:
        problems.append(f"Only {len(items)} parts: add at least {MIN_PARTS}.")
    if len(items) > MAX_ITEMS:
        problems.append("Too many parts.")
    if not kinds & SCORING:
        problems.append("Nothing on it scores (add a bumper, target, lane, ramp...).")
    runs = [_play(clean, s) for s in range(games)]
    spans = [x for r in runs for x in r["spans"]]
    scores = [r["score"] for r in runs]
    stats = {"parts": len(items), "kinds": len(kinds), "avg_score": round(statistics.mean(scores)), "min_score": min(scores),
             "avg_ball_s": round(statistics.mean(spans), 1) if spans else None, "min_ball_s": round(min(spans), 1) if spans else None,
             "unfinished_games": sum(1 for r in runs if not r["finished"])}
    lanes = [d for r in runs for d, _ in r["drains"]]
    side_after = {}
    for r in runs:
        for lane, event in r["drains"]:
            if lane.endswith("outlane"):
                side_after[event] = side_after.get(event, 0) + 1
    if side_after:
        stats["side_after"] = dict(sorted(side_after.items(), key=lambda kv: -kv[1]))
    if lanes:
        stats["drains"] = {k: round(100 * lanes.count(k) / len(lanes)) for k in ("left_outlane", "left", "right", "right_outlane")}
    if not spans:
        problems.append("No ball ever drained in the test games: the ball gets stuck or there is no way down.")
    else:
        if stats["avg_ball_s"] < MIN_BALL_SECONDS:
            problems.append(f"Balls drain too fast ({stats['avg_ball_s']} s on average; need {MIN_BALL_SECONDS} s).")
        if stats["avg_ball_s"] > MAX_BALL_SECONDS:
            problems.append(f"Balls last too long ({stats['avg_ball_s']} s): is the ball getting stuck?")
    if stats["avg_score"] < MIN_AVG_SCORE:
        problems.append(f"The test player scores too little ({stats['avg_score']} on average; need {MIN_AVG_SCORE}).")
    if stats["unfinished_games"]:
        notes.append(f"{stats['unfinished_games']} of {games} test games did not finish within the time limit.")
    if lanes and stats["drains"]["left_outlane"] + stats["drains"]["right_outlane"] >= 40:
        notes.append(f"{stats['drains']['left_outlane'] + stats['drains']['right_outlane']}% of balls drained down the side outlanes: widen or move the inlane guides, or add a post above each outlane.")
    shots = stats["reach"] = reach(clean)
    never = [p["label"] for p in shots["parts"] if not p["hits"]]
    rare = [p["label"] for p in shots["parts"] if 0 < p["hits"] <= RARE]
    if never:
        notes.append(f"No flipper shot hit: {', '.join(never)}.")
    if rare:
        notes.append(f"Hard to hit ({RARE} shots or fewer of {shots['shots']}): {', '.join(rare)}.")
    for s in shots["spots"]:
        if s["up"] < WEAK_UP:
            notes.append(f"Weak shot: {s['flipper'].lower()} flipper, {s['spot']}, ball {s['ball']}: only {s['up']}% got up the table.")
    return {"ok": not problems, "problems": problems, "notes": notes, "stats": stats}
