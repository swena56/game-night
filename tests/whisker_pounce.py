"""Whisker Run 🐾 pounce: a cat with a mouse in its straight run ahead lunges (faster for a second), then waits;
a blinking or out mouse doesn't trigger it; a panicking cat doesn't pounce.

    python3 tests/whisker_pounce.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import whisker as wk  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


def setup():
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")]
    for p in ps:
        p.bot = "normal"
    r.switch_game("whisker")
    r.start()
    g = r.game
    r.push_fast = lambda d: None
    now = time.time() + 10
    g.stage = "play"
    cat = next(e for e in g.ents if g.is_cat(e))
    mouse = next(e for e in g.ents if e["role"] == "m")
    # find a cat cell and direction with two open cells straight ahead
    for c in range(len(g.walls)):
        for d in range(4):
            nb = g.nbs(cat)
            a = nb[c][d]
            b = nb[a][d] if a is not None else None
            if a is not None and b is not None:
                cat["cell"] = cat["prev"] = c
                cat["dir"] = d
                mouse["cell"] = mouse["prev"] = b
                return g, cat, mouse, now
    raise SystemExit("no corridor found")


g, cat, mouse, now = setup()
mouse["ghost_until"] = 0.0
g.events = []
g.step(now)
check("a mouse two cells ahead triggers a pounce", cat.get("pounce_until", 0) > now)
check("the pounce is announced as an event", any(e[1] == "pounce" for e in g.events))
check("the lunge is faster", g.speed_of(cat, now) > g.speed_of(cat, now + 5) * 1.2, (g.speed_of(cat, now), g.speed_of(cat, now + 5)))
until = cat["pounce_until"]
g.step(now + 0.2)
check("no second pounce while cooling down", cat["pounce_until"] == until)

g, cat, mouse, now = setup()
mouse["ghost_until"] = now + 5
g.step(now)
check("a blinking mouse doesn't trigger it", cat.get("pounce_until", 0) <= now)
mouse["ghost_until"] = 0.0
mouse["out_until"] = now + 5
g.step(now)
check("a caught mouse doesn't either", cat.get("pounce_until", 0) <= now)
mouse["out_until"] = None
cat["spook_until"] = now + 5
g.step(now)
check("a panicking cat doesn't pounce", cat.get("pounce_until", 0) <= now)
sys.exit(1 if fails else 0)
