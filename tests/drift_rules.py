"""Sky Drift rules: a choice moves you a layer and the wind of that layer carries you, the burner adds a cell
(and runs out), balloons stop at the map's edge, drafting adds a cell, passing next to a pennant takes it
(two balloons on the same step both score), the storm throws you, everyone moves at once, bad moves are
refused, and the most pennants wins after the last turn.

    python3 tests/drift_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import drift as D  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError as e:
        return str(e)
    return None


east = [(0, 1), (0, 2), (4, 1), (2, 1)]   # layer 0 → east ×1, 1 → east ×2, 2 → west, 3 → south
path = D.step_path(3, 3, 0, "up", False, east)
check("climbing rides the layer above", path[-1] == [5, 3, 1] and len(path) == 3, f"{path}")
check("holding rides your own layer", D.step_path(3, 3, 0, "hold", False, east)[-1] == [4, 3, 0])
check("descending at the bottom stays at the bottom", D.step_path(3, 3, 0, "down", False, east)[-1] == [4, 3, 0])
check("the burner adds a cell", D.step_path(3, 3, 0, "hold", True, east)[-1] == [5, 3, 0])
check("drafting adds a cell", D.step_path(3, 3, 0, "hold", False, east, 1)[-1] == [5, 3, 0])
check("balloons stop at the edge", D.step_path(D.W - 1, 3, 1, "hold", True, east)[-1] == [D.W - 1, 3, 1])
check("winds always differ between layers", all(len({w[0] for w in D.make_winds(__import__('random').Random(s))}) >= 2 for s in range(200)))

r = server.Room("TEST")
ps = [r.add_player(n) for n in ("Ann", "Bo")]
r.switch_game("drift")
r.settings["storm"] = 0
r.settings["size"] = "cosy"  # the positions below are laid out on the 12×9 map
r.start()
g = r.game
ann, bo = ps
g.ready_at = 0
for bad in ({"choice": "left"}, {"choice": "up", "burn": "yes"}, {"choice": None}):
    check(f"bad move refused {bad}", refused(g, ann, {"type": "fly", **bad}) is not None)
# set up a known sky: both balloons side by side, a pennant right in their path
g.winds = east
g.pos = {ann.id: [2, 2, 0], bo.id: [2, 2, 0]}
g.pennants = [[4, 2], [10, 8], [0, 8], [11, 0], [6, 7]]
check("a choice is taken", refused(g, ann, {"type": "fly", "choice": "hold", "burn": True}) is None and g.fuel[ann.id] == D.FUEL)
check("no second choice", refused(g, ann, {"type": "fly", "choice": "up"}) is not None)
check("nobody moves until everyone has chosen", g.pos[ann.id] == [2, 2, 0])
v = g.view(bo)["drift"]
check("my options are previewed", set(v["options"]) >= {"up", "hold", "down", "up+"} and v["drafts"] == sorted([ann.id, bo.id]))
check("a rival's choice isn't shown", v["mine"] is None and ann.id in v["locked"])
refused(g, bo, {"type": "fly", "choice": "hold"})
check("the turn resolves once everyone has chosen", g.turn_no == 2 and g.last and g.last["turn"] == 1)
check("drafting carried both (and the burner Ann)", g.pos[ann.id][0] == 2 + 1 + 1 + 1 and g.pos[bo.id][0] == 2 + 1 + 1, f"{g.pos}")
check("both took the pennant they reached together", g.score[ann.id] == 1 and g.score[bo.id] == 1, f"{g.score}")
check("the burner used fuel", g.fuel[ann.id] == D.FUEL - 1)
check("a new pennant replaced it", len(g.pennants) == D.PENNANTS and [4, 2] not in g.pennants)
check("you can't choose while the turn plays back", refused(g, ann, {"type": "fly", "choice": "hold"}) is not None)
g.ready_at = 0
g.fuel[ann.id] = 0
check("no burner without fuel", refused(g, ann, {"type": "fly", "choice": "hold", "burn": True}) is not None)

# the storm throws whoever ends a turn under it
r2 = server.Room("T2")
q = r2.add_player("Cy")
r2.switch_game("drift")
r2.settings["size"] = "cosy"
r2.start()
g2 = r2.game
g2.winds = [(0, 1)] * 4
g2.pos[q.id] = [5, 4, 2]
g2.storm = {"x": 7, "y": 4, "d": 4}   # it moves west to (6, 4); the balloon drifts east to (6, 4)
g2.pennants = [[0, 0], [0, 8], [11, 8], [11, 0], [0, 4]]
g2.ready_at = 0
g2.rng.random = lambda: 0.9   # the storm keeps its heading this turn
g2.act(q, {"type": "fly", "choice": "hold"})
check("the storm throws a balloon and drops it a layer", q.id in g2.last["flung"] and g2.pos[q.id][2] == 1, f"{g2.last['flung']}")

# play out: the game ends after the last turn with the most pennants winning
for _ in range(40):
    if r.phase != "playing":
        break
    g.ready_at = 0
    for p in ps:
        if p.id not in g.choices and r.phase == "playing":
            g.act(p, {"type": "fly", "choice": "hold"})
check("the game ends after the last turn", r.phase == "over" and g.turn_no == g.turns)
w = r.players.get(r.winner)
check("the winner has the most pennants", w is None or g.score[w.id] == max(g.score.values()), f"{g.score}")

# #107: the sky sizes, with pennants at the same density, and balloons stopping at the bigger map's edge
for size, (w, h) in D.SIZES.items():
    r3 = server.Room("TEST")
    r3.add_player("Ann"); r3.add_player("Bo")
    r3.switch_game("drift"); r3.settings["size"] = size; r3.start()
    g3 = r3.game
    v3 = g3.view(list(r3.players.values())[0])["drift"]
    check(f"{size} sky is {w}x{h}", (v3["w"], v3["h"]) == (w, h) and len(v3["terrain"]) == h and len(v3["terrain"][0]) == w)
    check(f"{size} sky has {g3.npen} pennants", len(g3.pennants) == g3.npen == round(D.PENNANTS * w * h / (D.W * D.H)))
    check(f"{size} edge stops balloons", g3.path(w - 1, 3, 1, "hold", True, [(0, 2)] * D.LAYERS)[-1] == [w - 1, 3, 1])

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
