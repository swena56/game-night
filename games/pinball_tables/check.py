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
    used = set()
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
        before, event_id = table.balls, table.event_id
        table.input(held, 0, tick / 240)
        table.step()
        if table.event_id != event_id and table.event:
            used.add(table.event.rstrip("0123456789"))
        if table.balls < before:
            spans.append((tick - last) / 240)
            last = tick
    return {"score": table.score, "spans": spans, "finished": not table.balls, "used": used}


def check(spec):
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
    runs = [_play(clean, s) for s in range(GAMES)]
    spans = [x for r in runs for x in r["spans"]]
    scores = [r["score"] for r in runs]
    stats = {"parts": len(items), "kinds": len(kinds), "avg_score": round(statistics.mean(scores)), "min_score": min(scores),
             "avg_ball_s": round(statistics.mean(spans), 1) if spans else None, "min_ball_s": round(min(spans), 1) if spans else None,
             "unfinished_games": sum(1 for r in runs if not r["finished"])}
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
        notes.append(f"{stats['unfinished_games']} of {GAMES} test games did not finish within the time limit.")
    seen = set().union(*(r["used"] for r in runs))
    idle = sorted(k for k in ("bump", "sling", "target", "lane", "spinner", "ramp", "saucer", "subway", "orbit", "mover", "hole", "portal", "magnet")
                  if k in kinds and {"bump": "bumper"}.get(k, k) not in seen)
    if idle:
        notes.append("Parts the test player never triggered: " + ", ".join(idle) + " (may just be hard to reach).")
    return {"ok": not problems, "problems": problems, "notes": notes, "stats": stats}
