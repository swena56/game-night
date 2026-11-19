"""Sudoku and Word Search rules on real rooms: unique-solution puzzles at every level, right and wrong
digits, hints, the solution never sent mid-puzzle, scoring without double counting; word finds in either
direction, any copy of a word, grab conflicts, grab points landing live, and hints.

    python3 tests/puzzle_rules.py        # a few seconds
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import sudoku as SD  # noqa: E402
from games import wordsearch as WS  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(name, fn):
    try:
        fn()
        check(name, False, "was allowed")
    except GameError as e:
        check(name, True, str(e))


def room_for(gid, bots=(), **settings):
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    for lvl in bots:
        room.add_bot(lvl)
    room.switch_game(gid)
    room.settings.update(settings)
    room.start()
    return room, ann


# -- sudoku generator
for n in (9, 6):
    for lv in ("easy", "medium", "hard"):
        g, sol = SD.make_puzzle(random.Random(f"{n}{lv}"), n, lv)
        sh = SD.Shape(n)
        ok = SD.count_solutions(g, sh, 2) == 1 and all(g[i] in (0, sol[i]) for i in range(n * n))
        ok = ok and all(sorted(sol[i] for i in u) == list(range(1, n + 1)) for u in sh.units)
        if lv != "hard":
            ok = ok and SD.logic_solves(g, sh, SD.LEVELS[lv][0])
        check(f"sudoku {n}x{n} {lv}: one solution, solvable by its level's logic", ok, f"{g.count(0)} blanks")

# -- sudoku moves
room, ann = room_for("sudoku", bots=("easy",))
G = room.game
v = G.view(ann)["sudoku"]
check("sudoku: no solution in the view mid-puzzle", v["sol"] is None and "sol" not in json.dumps(v["rivals"]))
i = G.puzzle.index(0)
wrong = next(d for d in range(1, 10) if d != G.sol[i])
room.act(ann, {"type": "put", "cell": i, "digit": wrong})
st = G.st[ann.id]
check("sudoku: a wrong digit bounces off and counts", st["g"][i] == 0 and st["wrong"] == 1 and st["miss"] == [i, wrong])
room.act(ann, {"type": "put", "cell": i, "digit": G.sol[i]})
check("sudoku: a right digit stays", st["g"][i] == G.sol[i] and st["mine"] == 1)
refused("sudoku: a filled cell can't change", lambda: room.act(ann, {"type": "put", "cell": i, "digit": G.sol[i]}))
refused("sudoku: a given can't change", lambda: room.act(ann, {"type": "put", "cell": G.puzzle.index(next(x for x in G.puzzle if x)), "digit": 1}))
refused("sudoku: digit 0", lambda: room.act(ann, {"type": "put", "cell": 1, "digit": 0}))
refused("sudoku: bad cell", lambda: room.act(ann, {"type": "put", "cell": 81, "digit": 1}))
refused("sudoku: bool cell", lambda: room.act(ann, {"type": "put", "cell": True, "digit": 1}))
room.act(ann, {"type": "hint"})
check("sudoku: a hint fills a cell", st["hints"] == 1 and st["g"][st["hint"]] == G.sol[st["hint"]])
for k, d in enumerate(G.sol):   # fill the rest
    if not st["g"][k]:
        room.act(ann, {"type": "put", "cell": k, "digit": d})
check("sudoku: finishing ends Ann's puzzle", ann.id in G.done)
pts = st["mine"] - 1 - 1 + 10 + 5
G.bank(room.players[[p for p in room.players if p != ann.id][0]])
check("sudoku: score = right digits − slips − hints + finish + first", ann.g.score == pts, f"{ann.g.score} vs {pts}")
check("sudoku: the solution shows after the puzzle", G.view(ann)["sudoku"]["sol"] == G.sol)

# -- sudoku hint caps and no clock
room, ann = room_for("sudoku", bots=("easy",), hints=1, secs=0)
G = room.game
v = G.view(ann)["sudoku"]
check("sudoku no clock: the view says so, and the round runs for hours", v["clock"] is False and v["left"] > 3600)
check("sudoku hints=1: the view counts it", v["hintsLeft"] == 1)
room.act(ann, {"type": "hint"})
check("sudoku hints=1: one hint taken", G.view(ann)["sudoku"]["hintsLeft"] == 0)
refused("sudoku hints=1: a second hint is refused", lambda: room.act(ann, {"type": "hint"}))
room, ann = room_for("sudoku", bots=("easy",), hints=0)
refused("sudoku hints off: no hint at all", lambda: room.act(ann, {"type": "hint"}))
room, ann = room_for("sudoku", bots=("easy",), hints=-1)
for _ in range(5):
    room.act(ann, {"type": "hint"})
check("sudoku unlimited hints", room.game.view(ann)["sudoku"]["hintsLeft"] is None and room.game.st[ann.id]["hints"] == 5)
room, ann = room_for("sudoku")
v = room.game.view(ann)["sudoku"]
check("sudoku default: 3 hints and a clock", v["hintsLeft"] == 3 and v["clock"] is True, str((v["hintsLeft"], v["clock"])))
room, ann = room_for("wordsearch", secs=0)
check("word search no clock", room.game.view(ann)["wordsearch"]["clock"] is False)

# -- word search grids
for i in range(60):
    size = (8, 10, 12)[i % 3]
    rows, where = WS.build(random.Random(i), size, WS.DIRS["hard"], sorted(WS.THEMES)[i % len(WS.THEMES)])
    if len(where) < 6 or any(len(r) != size for r in rows):
        check(f"word search grid {i}", False, f"{len(where)} words")
        break
    for w, (r1, c1, r2, c2) in where.items():
        n = max(abs(r2 - r1), abs(c2 - c1))
        dr, dc = (r2 > r1) - (r2 < r1), (c2 > c1) - (c2 < c1)
        if "".join(rows[r1 + dr * k][c1 + dc * k] for k in range(n + 1)) != w:
            check(f"word search grid {i}: {w} where it says", False)
else:
    check("word search: 60 grids, every word where it says, 6+ words each", True)

# -- word search grab
room, ann = room_for("wordsearch", bots=("easy",), mode="grab")
G = room.game
bob = room.players[[p for p in room.players if p != ann.id][0]]
v = G.view(ann)["wordsearch"]
check("word search: hidden words' places aren't sent", v["lines"] == {})
w = G.words[0]
r1, c1, r2, c2 = G.where[w]
room.act(ann, {"type": "find", "cells": [r2, c2, r1, c1]})
check("word search: found from the last letter back", w in G.st[ann.id]["found"] and G.claims[w] == ann.id)
# the progress list: in Grab, everyone (a spectator and the replay viewer too) sees who owns which word,
# and the only path sent is the found word's
w2 = G.words[1]
G.take(bob, G.st[bob.id], w2, list(G.where[w2]))
watcher = room.add_player("Wes")
for who, label in ((ann, "me"), (bob, "rival"), (watcher, "spectator"), (server.REPLAY_VIEWER, "replay")):
    vv = G.view(who)["wordsearch"]
    check(f"word search grab list ({label}): owners are right", vv["owners"] == {w: ann.id, w2: bob.id}, vv["owners"])
    check(f"word search grab list ({label}): paths only for found words", set(vv["lines"]) == {w, w2}, sorted(vv["lines"]))
    check(f"word search grab list ({label}): no race counts in grab", vv["rivalFound"] == {})
G.st[bob.id]["found"].remove(w2); G.claims.pop(w2); bob.g.score -= len(w2)
check("word search: grab points land at once", ann.g.score == len(w))
refused("word search: grabbed already", lambda: room.act(bob, {"type": "find", "cells": [r1, c1, r2, c2]}))
refused("word search: not a straight line", lambda: room.act(ann, {"type": "find", "cells": [0, 0, 1, 2]}))
refused("word search: off the grid", lambda: room.act(ann, {"type": "find", "cells": [0, 0, 0, 99]}))
room.act(ann, {"type": "hint"})
check("word search: a hint costs points", ann.g.score == len(w) - WS.HINT_COST and len(G.st[ann.id]["hints"]) == 1)
before = ann.g.score
for x in G.words[1:]:
    a, b, c, d = G.where[x]
    room.act(ann, {"type": "find", "cells": [a, b, c, d]})
check("word search: the grid ends when every word is grabbed", G.stage == "reveal")
check("word search: the reveal doesn't count grab points twice",
      ann.g.score == before + sum(len(x) for x in G.words[1:]) and G.gained[ann.id] == ann.g.score)

# -- word search race
room, ann = room_for("wordsearch", bots=("easy",), mode="race")
G = room.game
bob = room.players[[p for p in room.players if p != ann.id][0]]
# the progress list in Race: a rival's find is a count on my list, never its path or an owner
x0 = G.words[0]
G.take(bob, G.st[bob.id], x0, list(G.where[x0]))
v = G.view(ann)["wordsearch"]
check("word search race list: a rival's find is counted for me", v["rivalFound"] == {x0: 1}, v["rivalFound"])
check("word search race list: but not its owner or path", v["owners"] == {} and v["lines"] == {}, (v["owners"], v["lines"]))
vb = G.view(bob)["wordsearch"]
check("word search race list: my own find isn't in my rival counts", vb["rivalFound"] == {} and vb["owners"] == {x0: bob.id})
vs = G.view(server.REPLAY_VIEWER)["wordsearch"]
check("word search race list: the replay viewer sees counts, no paths", vs["rivalFound"] == {x0: 1} and vs["lines"] == {})
G.st[bob.id]["found"].remove(x0); G.st[bob.id]["at"].pop(x0)
for x in G.words:
    a, b, c, d = G.where[x]
    room.act(ann, {"type": "find", "cells": [a, b, c, d]})
check("word search race: finding every word finishes", ann.id in G.done)
G.bank(room.players[[p for p in room.players if p != ann.id][0]])
check("word search race: letters + finish + first", ann.g.score == sum(map(len, G.words)) + 15, str(ann.g.score))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
