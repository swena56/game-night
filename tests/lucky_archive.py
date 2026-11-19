"""Lucky Letters 📚 puzzle archive: only completed puzzles (with category and solver), never the phrase on the
board; it lasts across rematches, and a rematch doesn't reuse tonight's puzzles until the pool runs low.

    python3 tests/lucky_archive.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import lucky as L  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def solve_now(r, g):
    p = r.players[r.turn]
    g.stage = "spin"
    g.act(p, {"type": "solve", "guess": g.answer})
    return p


r = server.Room("TEST")
ann, bo = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("lucky")
r.settings["rounds"] = 2
r.start()
g = r.game
v = g.view(ann)["lucky"]
check("archive empty at the start", v["archive"] == [])
first = g.answer
check("no active phrase in the archive (or the view's board)", first not in repr(v["archive"]) and v["board"] != first)
p = solve_now(r, g)
v = g.view(server.REPLAY_VIEWER)["lucky"]
check("a solved puzzle is filed", len(v["archive"]) == 1 and v["archive"][0]["answer"] == first)
e = v["archive"][0]
check("with its category, round, solver and winnings", e["category"] == g.category and e["round"] == 1 and e["by"] == p.name and e["won"] >= L.SOLVE_MIN, e)
g.on_timeout()  # the next puzzle
v = g.view(bo)["lucky"]
check("next puzzle: archive holds only the completed one", [x["answer"] for x in v["archive"]] == [first] and g.answer != first)
solve_now(r, g)
check("game over after 2 puzzles", r.phase == "over")
v = g.view(ann)["lucky"]
check("game over: both puzzles archived", len(v["archive"]) == 2)
seen1 = {x["answer"] for x in v["archive"]}

# rematch: new puzzles (none from tonight), the archive carries over and never shows the live phrase
with r.cond:
    r.start()
g2 = r.game
check("rematch: a different game object", g2 is not g)
check("rematch: no reused puzzle", not ({q[1] for q in g2.queue} & seen1), [q[1] for q in g2.queue])
v = g2.view(ann)["lucky"]
check("rematch: earlier puzzles still in the archive", {x["answer"] for x in v["archive"]} == seen1)
check("rematch: entries tagged with their game", all(x["game"] != v["gameNo"] for x in v["archive"]))

# when the pool runs low, puzzles come back; a reused live puzzle is hidden from the archive until solved
r.lucky_seen = {ph for phs in L.PUZZLES.values() for ph in phs}
r.lucky_archive.append({"game": -1, "round": 1, "rounds": 2, "category": "X", "answer": None, "by": "Old", "won": 1000, "mind": False})
with r.cond:
    r.start()
g3 = r.game
check("pool exhausted: puzzles reset (game still starts)", len(g3.queue) == g3.s["rounds"])
check("pool reset: archived puzzles still avoided", not ({q[1] for q in g3.queue} & {x["answer"] for x in r.lucky_archive}))
upcoming = g3.queue[1][1]
r.lucky_archive.append({"game": -1, "round": 2, "rounds": 2, "category": "X", "answer": upcoming, "by": "Old", "won": 1000, "mind": False})
check("a puzzle still to come this game stays out of the archive", all(x["answer"] != upcoming for x in g3.view(ann)["lucky"]["archive"]))
r.lucky_archive.append({"game": -1, "round": 1, "rounds": 2, "category": g3.category, "answer": g3.answer, "by": "Old", "won": 1000, "mind": False})
v = g3.view(bo)["lucky"]
check("a reused puzzle on the board stays out of the archive", all(x["answer"] != g3.answer for x in v["archive"]))
solve_now(r, g3)
v = g3.view(bo)["lucky"]
check("once solved, it shows", sum(x["answer"] == v["last"]["answer"] for x in v["archive"]) >= 1)

# old saved rooms / spectators
r2 = server.Room("TEST2")
a2, b2 = r2.add_player("Ann"), r2.add_player("Bo")
r2.switch_game("lucky")
r2.start()
del r2.lucky_seen
check("old saved room: view without an archive", r2.game.view(a2)["lucky"]["archive"] == [])
check("spectator view ok", isinstance(r2.game.view(server.REPLAY_VIEWER)["lucky"]["archive"], list))
solve_now(r2, r2.game)
check("old saved room: solving files the puzzle", len(r2.lucky_archive) == 1)

# bots still finish games
r3 = server.Room("TEST3")
for n in ("A", "B"):
    r3.add_player(n).bot = "hard"
r3.switch_game("lucky")
r3.start()
random.seed(3)
for _ in range(3000):
    if r3.phase != "playing":
        break
    with r3.cond:
        g = r3.game
        if g.bot_ready():
            g.bot_turn(r3.players[r3.turn])
        else:
            g.on_timeout()
check("bots finish a game, every puzzle archived", r3.phase == "over" and len(r3.lucky_archive) == r3.game.s["rounds"])

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
