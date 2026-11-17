"""Domino Run rules: a run topples square-on and 45° dominoes but not side-on ones, turns at 45°, rings bells and
carries on, swings gates only along them, ends at the tower, splits fork, blocks stop, merging runs go to whoever
gets there first, turns place three pieces, bad placements are refused, and the tables run to the end.

    python3 tests/domino_rules.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import domino as D  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def run(pieces, targets=None, starters=((0, 5, 0, 0),), size=12):
    pc = {(x, y): {"axis": a, "kind": k} for x, y, a, k in pieces}
    tg = {(x, y): {"kind": k, "axis": a} for x, y, k, a in (targets or [])}
    return D.topple(size, pc, tg, list(starters))


# -- the fall rules
check("square-on falls the same way", D.fall_dir(0, 0) == 0 and D.fall_dir(0, 4) == 4)
check("45° turns the run", D.fall_dir(1, 0) == 1 and D.fall_dir(3, 0) == 7)
check("side-on doesn't fall", D.fall_dir(2, 0) is None)
falls, rings, ends = run([(1, 5, 0, "domino"), (2, 5, 0, "domino"), (3, 5, 0, "domino")])
check("a straight run topples in order", [falls[(k, 5)][0] for k in range(4)] == [0, D.STEP, round(2 * D.STEP, 3), round(3 * D.STEP, 3)])
check("its end pushes into the next square", (4, 5, 0, frozenset({0})) in ends)
falls, _, _ = run([(1, 5, 0, "domino"), (2, 5, 2, "domino"), (3, 5, 0, "domino")])
check("a side-on domino stops the run", (2, 5) not in falls and (3, 5) not in falls)
falls, _, _ = run([(1, 5, 1, "domino"), (2, 6, 1, "domino"), (3, 7, 2, "domino")])
check("a 45° domino turns the run diagonally", (2, 6) in falls and falls[(2, 6)][1] == 1 and (3, 7) in falls and falls[(3, 7)][1] == 2)
falls, rings, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino")], [(2, 5, "bell", 0)])
check("a bell rings and the run carries on", (2, 5) in rings and (3, 5) in falls)
falls, rings, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino")], [(2, 5, "gate", 0)])
check("a gate along the run swings and lets it through", (2, 5) in rings and (3, 5) in falls)
falls, rings, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino")], [(2, 5, "gate", 2)])
check("a gate across the run stops it", (2, 5) not in rings and (3, 5) not in falls)
falls, rings, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino")], [(2, 5, "tower", 0)])
check("the tower falls and ends the run", (2, 5) in rings and (3, 5) not in falls)
falls, _, _ = run([(1, 5, 0, "split"), (2, 6, 1, "domino"), (2, 4, 3, "domino")])
check("a split domino forks the run", (2, 6) in falls and (2, 4) in falls)
falls, _, _ = run([(1, 5, 0, "block"), (2, 5, 0, "domino")])
check("a block stops everything", (1, 5) not in falls and (2, 5) not in falls)
# two runs into one line: the nearer starter takes it
falls, _, _ = run([(1, 5, 0, "domino"), (2, 5, 0, "domino"), (3, 5, 0, "domino"), (4, 5, 1, "domino"), (4, 4, 2, "domino")],
                  starters=((0, 5, 0, 0), (4, 3, 2, 1)))
check("whoever's push gets there first owns the rest", falls[(4, 5)][2] == frozenset({1}), str(falls[(4, 5)]))
check("scores: 1 a domino and the targets", D.score_of(*run([(1, 5, 0, "domino")], [(2, 5, "bell", 0)])[:2],
                                                          {(2, 5): {"kind": "bell", "axis": 0}}, {(0, 5)}) == {0: 11})

# -- a game
r = server.Room("TEST")
a, b = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("domino")
r.settings.update(tables=1, turns=3)
r.start()
g = r.game
first = r.players[r.turn]
other = b if first is a else a


def refused(p, act):
    try:
        g.act(p, act)
    except GameError as e:
        return str(e)
    return None


free = [(x, y) for x in range(g.size) for y in range(g.size) if g.cell_free((x, y))]
check("not your turn refused", refused(other, {"type": "place", "x": free[0][0], "y": free[0][1], "axis": 0}) is not None)
check("off the table refused", refused(first, {"type": "place", "x": 99, "y": 0, "axis": 0}) is not None)
check("bad axis refused", refused(first, {"type": "place", "x": free[0][0], "y": free[0][1], "axis": 7}) is not None)
check("float refused", refused(first, {"type": "place", "x": 1.5, "y": 2, "axis": 0}) is not None)
t = next(iter(g.targets))
check("a target's square refused", refused(first, {"type": "place", "x": t[0], "y": t[1], "axis": 0}) is not None)
g.act(first, {"type": "place", "x": free[0][0], "y": free[0][1], "axis": 0})
check("a taken square refused", refused(first, {"type": "place", "x": free[0][0], "y": free[0][1], "axis": 0}) is not None)
g.act(first, {"type": "place", "x": free[1][0], "y": free[1][1], "axis": 0, "kind": "split"})
check("one split a game", refused(first, {"type": "place", "x": free[2][0], "y": free[2][1], "axis": 0, "kind": "split"}) is not None)
g.act(first, {"type": "place", "x": free[2][0], "y": free[2][1], "axis": 0, "kind": "block"})
check("three pieces pass the turn", r.turn == other.id)
json.dumps(g.view(a))
check("the view carries the preview", isinstance(g.view(a)["domino"]["preview"], dict))
for _ in range(100):
    if g.stage != "build":
        break
    g.on_timeout()       # timeouts build the rest
check("after the build turns the table topples", g.stage == "topple" and g.topple_res is not None)
check("points were added", sum(g.points) == sum(g.topple_res["pts"].values()))
g.on_timeout()
check("standings after the topple", g.stage == "between" and g.view(a)["domino"]["standings"])
g.on_timeout()
check("one table: the game ends", r.phase == "over")

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
