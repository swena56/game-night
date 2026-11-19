"""Word Ladder 🧼 Clean climb: +3 for par or better with no undo, hint or peek; setting turns it off; bots stay legal.

    python3 tests/ladder_clean.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import ladder  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def climb(clean=None):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("ladder")
    if clean is not None:
        r.settings["clean"] = clean
    r.start()
    return r, r.game, ann, bo


def walk(g, p, undo=False):
    """Walk p up the shortest ladder; optionally step and take one back first."""
    path = [g.start_word]
    while path[-1] != g.target:
        path.append(g.best_step(path[-1], path))
    if undo:
        g.act(p, {"type": "step", "word": path[1]})
        g.act(p, {"type": "undo"})
    for w in path[1:]:
        g.act(p, {"type": "step", "word": w})
    return len(path) - 1


def base(g, steps):
    return max(2, ladder.FINISH - ladder.OVER_PAR * max(0, steps - g.par))


r, g, ann, bo = climb()
steps = walk(g, ann)
check("clean climb pays the bonus", ann.g.score == base(g, steps) + ladder.FIRST + ladder.CLEAN, (ann.g.score, steps, g.par))
check("callout sent", any(e.get("kind") == "moment" and "clean climb" in e["text"] for e in r.log[-6:]), r.log[-3:])

r, g, ann, bo = climb()
steps = walk(g, ann, undo=True)
check("an undo spoils it", ann.g.score == base(g, steps) + ladder.FIRST, ann.g.score)

r, g, ann, bo = climb()
g.act(ann, {"type": "peek"})
steps = walk(g, ann)
check("a peek spoils it", ann.g.score == base(g, steps) + ladder.FIRST - ladder.PEEK, ann.g.score)

r, g, ann, bo = climb(False)
steps = walk(g, ann)
check("setting off: no bonus", ann.g.score == base(g, steps) + ladder.FIRST, ann.g.score)

# bots play a round by themselves: every path is legal
r = server.Room("TEST")
r.add_player("Ann")
r.add_bot("hard")
r.add_bot("normal")
r.switch_game("ladder")
r.settings["rounds"] = 1
r.start()
g = r.game
for _ in range(300):
    if r.phase != "playing" or g.stage != "climb":
        break
    g.on_timeout()
check("bots finished or ran out the round", g.stage == "reveal" or r.phase == "over")
bots = [p for p in r.seated() if p.bot]
for p in bots:
    path = g.paths[p.id]
    ok = all(ladder.one_apart(x, y) for x, y in zip(path, path[1:])) and all(w in ladder.words() for w in path[1:])
    check(f"{p.name} path is legal", ok, path)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
