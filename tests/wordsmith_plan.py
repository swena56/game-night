"""Wordsmith 🔮 rack planning: a private dry run of the next turn after a proposed play. It uses the current
board plus the proposed tiles and the dictionary, keeps only the tiles you'd keep, and never commits tiles or
changes a score. Alone against bots it names the words; with other people only scores show.

    python3 tests/wordsmith_plan.py
"""
import copy
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import wordsmith as ws  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(bot_rival):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    if bot_rival:
        bo.bot = "normal"
    r.switch_game("wordsmith")
    r.start()
    g = r.game
    ann.g.rack = list("CATSERO")
    g.bounty = "S"
    return r, g, ann, bo


CAT = [{"r": 5, "c": 4, "i": 0}, {"r": 5, "c": 5, "i": 1}, {"r": 5, "c": 6, "i": 2}]


def snapshot(g, ps):
    return copy.deepcopy((g.grid, g.by, g.bag, g.scores, g.bounty, g.last, getattr(g, "plays", []), [p.g.rack for p in ps]))


# alone against a bot: names the next turns
r, g, ann, bo = table(True)
before = snapshot(g, [ann, bo])
res = g.peek(ann, {"what": "plan", "tiles": CAT})
check("plan: the proposed play and its score", res.get("words") == ["CAT"] and res["score"] == g.check_play([(5, 4, "C"), (5, 5, "A"), (5, 6, "T")], ann)[0], res)
check("plan: keeps the other tiles", sorted(res["leave"]) == sorted("SERO"), res.get("leave"))
check("plan: finds next turns", res["count"] > 0 and 0 < len(res["next"]) <= 3, res)
check("plan: named when alone against bots", res["named"] and all(n.get("words") for n in res["next"]))
check("plan: best first", [n["score"] for n in res["next"]] == sorted((n["score"] for n in res["next"]), reverse=True))
# every named next turn is real on the board after CAT, using only the kept tiles
dic = ws.words()
check("plan: next words are in the dictionary", all(w in dic for n in res["next"] for w in n["words"]))
check("plan: next words use the board (they cross CAT)", all(any(set(w) & set("CAT") for w in n["words"]) for n in res["next"]))
check("plan: nothing committed (board, racks, bag, scores, bounty, history)", snapshot(g, [ann, bo]) == before)
check("plan: still Ann's or Bo's turn as before", r.phase == "playing")

# another person at the table: only the scores
r, g, ann, bo = table(False)
res = g.peek(ann, {"what": "plan", "tiles": CAT})
check("plan: scores only with other people", not res["named"] and res["next"] and all(set(n) == {"score"} for n in res["next"]), res)

# bad or illegal input is refused, never a crash
r, g, ann, bo = table(True)
for bad in (None, "x", [{"r": 5, "c": 4, "i": True}], [{"r": 5, "c": 4, "i": 9}], [{"r": 0, "c": 0, "i": 0}, {"r": 0, "c": 1, "i": 1}],
            [{"r": "5", "c": 4, "i": 0}], [{"r": 5, "c": 4, "i": 0}, {"r": 5, "c": 5, "i": 0}]):
    out = g.peek(ann, {"what": "plan", "tiles": bad})
    check(f"plan: refuses {str(bad)[:40]}", "error" in out, out)
spec = r.add_player("Cy")
check("plan: a spectator gets an error", "error" in g.peek(spec, {"what": "plan", "tiles": CAT}))
check("plan: the replay viewer gets an error", "error" in g.peek(server.REPLAY_VIEWER, {"what": "plan", "tiles": CAT}))

# a whole-rack play leaves nothing to plan with
r, g, ann, bo = table(True)
ann.g.rack = list("TOASTED")
full = [{"r": 5, "c": 2 + k, "i": k} for k in range(7)]
res = g.peek(ann, {"what": "plan", "tiles": full})
check("plan: a 7-tile play keeps nothing", res.get("leave") == "" and res["next"] == [], res)

# a plan on a later board still works (connects to existing tiles)
r, g, ann, bo = table(True)
g.grid[5][4], g.grid[5][5], g.grid[5][6] = "D", "O", "G"
ann.g.rack = list("CATSERO")
res = g.peek(ann, {"what": "plan", "tiles": [{"r": 6, "c": 5, "i": 0}, {"r": 7, "c": 5, "i": 1}]})  # O-C-A? only if a word
check("plan: an illegal play on a later board is refused", "error" in res or res.get("words"))
res = g.peek(ann, {"what": "plan", "tiles": [{"r": 4, "c": 6, "i": 1}, {"r": 6, "c": 6, "i": 6}]})  # A/G/O → AGO
check("plan: a crossing play on a later board", res.get("words") == ["AGO"] and isinstance(res["next"], list), res)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
