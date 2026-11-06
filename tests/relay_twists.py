"""Scribble Relay 🎲 Twist cards (off by default): every drawer gets a twist on a drawing step, none on
writing or captioning steps.

    python3 tests/relay_twists.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import relay  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def step(g, ps):
    """Everyone hands in this step's entry, which moves the game on."""
    for p in ps:
        if g.kind() == "draw":
            g.act(p, {"type": "submit", "strokes": [[0, [10, 10, 50, 50]]]})
        else:
            g.act(p, {"type": "submit", "text": "a cat on a bike"})


def table(twists):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy")]
    r.switch_game("relay")
    if twists is not None:
        r.settings["twists"] = twists
    r.start()
    return r, r.game, ps


r, g, ps = table(None)
check("off: no twist when writing", g.view(ps[0])["relay"]["twist"] is None)
step(g, ps)
check("off: no twist when drawing", g.kind() == "draw" and g.view(ps[0])["relay"]["twist"] is None)

r, g, ps = table(True)
check("on: no twist when writing", g.kind() == "write" and g.view(ps[0])["relay"]["twist"] is None)
step(g, ps)
tw = [g.view(p)["relay"]["twist"] for p in ps]
check("on: every drawer gets a twist", g.kind() == "draw" and all(t in relay.TWISTS for t in tw), tw)
step(g, ps)
check("on: none when captioning", g.kind() == "caption" and g.view(ps[0])["relay"]["twist"] is None)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
