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
    pc = {(p[0], p[1]): {"axis": p[2], "kind": p[3], "by": p[4] if len(p) > 4 else 9} for p in pieces}
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

# The build HUD preview is produced by the same authoritative topple and score functions.
r_preview = server.Room("PREVIEW")
pa = r_preview.add_player("Preview")
r_preview.add_player("Other")
r_preview.switch_game("domino")
r_preview.settings.update(tables=1, turns=3)
r_preview.start()
gp = r_preview.game
gp.starters = [(0, 5, 0, 0)]
gp.pieces = {(1, 5): {"axis": 0, "kind": "domino", "by": 0}}
gp.targets = {(2, 5): {"kind": "bell", "axis": 0}}
pv = gp.view(pa)["domino"]
check("build preview names the first target from topple order", pv["firstTarget"]["0"] == {"x": 2, "y": 5, "kind": "bell"}, str(pv["firstTarget"]))
check("build preview score equals the authoritative topple score", pv["preview"] == D.score_of(*D.topple(gp.size, gp.pieces, gp.targets, gp.starters)[:2], gp.targets, {(0, 5)}) == {0: 11}, str(pv["preview"]))

# -- #175: ramps, poppers, pirates, combos, slow motion
falls, rings, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino"), (4, 5, 0, "domino")], [(2, 5, "ramp", 0)])
check("a ramp along the run leaps the next square", (2, 5) in rings and (3, 5) not in falls and (4, 5) in falls)
falls, rings, _ = run([(1, 5, 0, "domino"), (4, 5, 0, "domino")], [(2, 5, "ramp", 2)])
check("a ramp across the run stops it", (2, 5) not in rings and (4, 5) not in falls)
falls, rings, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino"), (2, 6, 2, "domino"), (2, 4, 2, "domino"), (1, 6, 0, "domino"), (3, 6, 1, "domino")],
                      [(2, 5, "pop", 0)])
check("a popper bursts every way but back", (2, 5) in rings and all(c in falls for c in [(3, 5), (2, 6), (2, 4), (3, 6)]),
      str(sorted(falls)))
f2, r2_, _ = run([(2, 5, 0, "domino")], [(1, 5, "ramp", 0), (3, 5, "pop", 0)])
check("…but not back the way the run came", (3, 5) in r2_ and (2, 5) not in f2, str(sorted(f2)))
check("a popper's pushes come a step after it rings", falls[(3, 5)][0] == round(rings[(2, 5)][0] + D.STEP, 3))
falls, rings, _ = run([(1, 5, 0, "domino"), (2, 5, 0, "pirate", 1), (3, 5, 0, "domino")])
check("a pirate domino shares the run from there on", falls[(1, 5)][2] == frozenset({0}) and falls[(2, 5)][2] == frozenset({0, 1})
      and falls[(3, 5)][2] == frozenset({0, 1}))
tg = [(2, 5, "bell", 0), (4, 5, "bell", 0), (6, 5, "gate", 0)]
fr, rg, _ = run([(1, 5, 0, "domino"), (3, 5, 0, "domino"), (5, 5, 0, "domino")], tg)
cmb = D.combos(rg)
check("combo counts a run's targets in order", [cmb[(2, 5)][0], cmb[(4, 5)][0], cmb[(6, 5)][0]] == [1, 2, 3])
tgd = {(x, y): {"kind": k, "axis": a} for x, y, k, a in tg}
check("combo scoring: +5 per target after the first", D.score_of(fr, rg, tgd, {(0, 5)}) == {0: 3 + 10 + 15 + 30})
w = D.slow_windows({(5, 5): (1.0, frozenset({0})), (6, 6): (1.1, frozenset({0})), (1, 1): (0.5, frozenset({0}))},
                   {(5, 5): {"kind": "tower"}, (6, 6): {"kind": "pop"}, (1, 1): {"kind": "bell"}})
check("slow windows round the tower and poppers, merged", w == [[0.88, 1.4]], str(w))
check("playback time stretches inside them", D.to_real(0.5, w) == 0.5 and abs(D.to_real(1.4, w) - (1.4 + 0.52 * (1 / D.SLOW - 1))) < 1e-9)

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
check("blocks are gone", refused(first, {"type": "place", "x": free[2][0], "y": free[2][1], "axis": 0, "kind": "block"}) is not None)
g.act(first, {"type": "place", "x": free[2][0], "y": free[2][1], "axis": 0, "kind": "pirate"})
check("one pirate a table", not g.pirate[g.seat(first)])
check("three pieces pass the turn", r.turn == other.id)
json.dumps(g.view(a))
v = g.view(a)["domino"]
check("the view carries the preview, ends and theme", isinstance(v["preview"], dict) and isinstance(v["ends"], list) and v["theme"])
check("the table has a theme's features", g.theme in D.THEMES)
for _ in range(100):
    if g.stage != "build":
        break
    g.on_timeout()       # timeouts build the rest
check("after the build turns the table topples", g.stage == "topple" and g.topple_res is not None)
check("points were added", sum(g.points) == sum(g.topple_res["pts"].values()))
tr = g.topple_res
check("the topple carries slow windows and the real end", tr["realEnd"] >= tr["end"] + D.LEAD - 1e-6 and isinstance(tr["slow"], list))
check("deadline waits for the slow-mo playback", abs(r.deadline - g.ready_at) < 1e-6)
g.on_timeout()
check("standings after the topple", g.stage == "between" and g.view(a)["domino"]["standings"])
g.on_timeout()
check("one table: the game ends", r.phase == "over")

# -- specials come back each table; old saves load
r2 = server.Room("TST2")
r2.add_player("Cy"); r2.add_player("Di")
r2.switch_game("domino")
r2.settings.update(tables=2, turns=3)
r2.start()
g2 = r2.game
g2.pirate = [False, False]; g2.split = [False, False]
th = g2.theme
for _ in range(200):
    if g2.table_no > 1 or r2.phase != "playing":
        break
    g2.on_timeout()
check("a fresh table gives back split and pirate", g2.split == [True, True] and g2.pirate == [True, True])
check("the next table has a different theme", g2.theme != th)
st = dict(g2.__dict__); st.pop("pirate"); st.pop("theme")
g3 = D.Domino.__new__(D.Domino); g3.__setstate__(st)
check("an old save loads with a pirate each and a theme", g3.pirate == [True, True] and g3.theme == "classic")

# -- bots play pirates
import random as _r
_r.seed(3)
used = 0
for seed in range(6):
    r3 = server.Room(f"B{seed}")
    for nm in ("A", "B", "C"):
        r3.add_player(nm)
    r3.switch_game("domino")
    r3.settings.update(tables=1, turns=4)
    r3.start()
    g4 = r3.game
    for _ in range(200):
        if g4.stage != "build":
            break
        p = r3.players[r3.turn]
        x, y, ax, k = g4.plan(g4.seat(p), "normal")
        g4.place(g4.seat(p), x, y, ax, k)
    used += sum(1 for v in g4.pieces.values() if v["kind"] == "pirate")
check("normal bots use their pirates", used >= 6, str(used))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
