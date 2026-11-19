"""Grid Hunt 🔥 hunt map: each player's review (tile heat from their own words, their best-scoring misses)
is private, appears only once time is up, matches the grid, and old saved games / spectators don't crash.

    python3 tests/gridhunt_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import gridhunt as G  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ann, bo = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("gridhunt")
r.start()
g = r.game
g.plans = []  # no bots here
ws = sorted(g.all, key=lambda w: (-len(w), w))
a_words, b_words = ws[:3], ws[3:5]
for w in a_words:
    g.act(ann, {"type": "word", "word": w})
for w in b_words:
    g.act(bo, {"type": "word", "word": w})
check("no review while hunting", g.view(ann)["gridhunt"]["review"] is None)
check("no review for a spectator mid-hunt", g.view(server.REPLAY_VIEWER)["gridhunt"]["review"] is None)

g.reveal()
va, vb = g.view(ann)["gridhunt"]["review"], g.view(bo)["gridhunt"]["review"]
check("review appears after time", va is not None and vb is not None)
check("heat covers the grid", len(va["heat"]) == g.n * g.n)
# heat = the sum, over my words, of one valid tracing each
want = [0] * (g.n * g.n)
for w in a_words:
    path = G.trace(g.tiles, g.n, w, g.star)
    ok = bool(path) and "".join(g.tiles[i] for i in path) == w and len(set(path)) == len(path) \
        and all(b in G.neighbours(a, g.n) for a, b in zip(path, path[1:]))
    check(f"{w} traces as a real path", ok, path)
    for i in path or ():
        want[i] += 1
check("heat matches my words' paths", va["heat"] == want)
check("heat differs per player (private)", va["heat"] != vb["heat"])
check("my misses exclude my words", not {w for w, _ in va["missed"]} & set(a_words))
shown = {w for w, _ in va["missed"]}
pts = [p for _, p in va["missed"]]
check("misses are my best-scoring ones", pts == sorted(pts, reverse=True)
      and all(g.points(w) <= min(pts) for w in g.all if w not in a_words and w not in shown))
check("at most 6 misses", 0 < len(va["missed"]) <= G.MY_MISSES)
check("spectator still gets no review", g.view(server.REPLAY_VIEWER)["gridhunt"]["review"] is None)

# a fresh round hides the old review until its own time is up
g.end = g.now()
g.process()
v = g.view(ann)["gridhunt"]
check("next round: old review hidden", v["stage"] == "hunt" and v["review"] is None)

# a saved game from before the hunt map (no p.g.review) still reveals
g.stage = "reveal"
del ann.g.review
check("old saved game: view without review", g.view(ann)["gridhunt"]["review"] is None)

# a late joiner with an empty p.g gets a view
cy = r.add_player("Cy")
try:
    g.view(cy)
    check("late joiner view ok", True)
except Exception as e:  # noqa: BLE001
    check("late joiner view ok", False, repr(e))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
