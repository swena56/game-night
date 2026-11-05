"""Night Heist ♾️ endless nights (#63): play on until the host cashes out (most gold wins; night 99 ends it
anyway). 🤝 Crews: two grabbers split the vault; three trip the alarm. Defaults unchanged.

    python3 tests/heist_endless.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import heist  # noqa: E402
from games.base import GameError  # noqa: E402
heist.GameError = GameError

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def heist_room(rounds=None, style=None, n=3):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("heist")
    if rounds is not None:
        r.settings["rounds"] = rounds
    if style is not None:
        r.settings["style"] = style
    r.start()
    return r, r.game, ps


def night(g, ps, picks):
    for p, c in zip(ps, picks):
        g.act(p, {"type": "choose", "choice": c})


r, g, ps = heist_room()
check("defaults: 8 nights, lone wolves", g.s["rounds"] == 8 and g.s["style"] == "solo")

# endless
r, g, ps = heist_room(rounds=0)
ann, bo, cy = ps
for _ in range(12):
    night(g, ps, ["rest", "rest", "rest"])
check("endless: still going after 12 nights", r.phase == "playing" and g.night == 13, g.night)
check("view says endless", g.view(ann)["heist"]["rounds"] == 0)
host = r.players[r.host]
other = next(p for p in ps if p.id != r.host)
try:
    g.act(other, {"type": "cashout"})
    check("only the host cashes out", False)
except heist.GameError:
    check("only the host cashes out", True)
g.gold[bo.id] += 5
g.act(host, {"type": "cashout"})
check("cash out: most gold wins", r.phase == "over" and r.winner == bo.id)

r, g, ps = heist_room()
try:
    g.act(r.players[r.host], {"type": "cashout"})
    check("no cash out with a night limit", False)
except heist.GameError:
    check("no cash out with a night limit", True)

r, g, ps = heist_room(rounds=0)
g.night = heist.MAX_NIGHTS
night(g, ps, ["rest", "rest", "rest"])
check("the safety night ends it", r.phase == "over")

# crews
r, g, ps = heist_room(style="crew")
ann, bo, cy = ps
g.pot = 11
night(g, ps, ["grab", "grab", "rest"])
check("crew: two grabbers split", g.gold[ann.id] == 3 + 5 and g.gold[bo.id] == 3 + 5, f"{g.gold}")
r, g, ps = heist_room(style="crew")
ann, bo, cy = ps
g.pot = 10
night(g, ps, ["grab", "grab", "grab"])
check("crew: three trip the alarm", all(g.gold[p.id] == 3 for p in ps))
r, g, ps = heist_room(style="crew")
ann, bo, cy = ps
g.pot = 10
night(g, ps, ["grab", "grab", "guard"])
check("crew: a guard still catches them", g.gold[cy.id] > 3 and g.gold[ann.id] < 3)
r, g, ps = heist_room()
ann, bo, cy = ps
g.pot = 10
night(g, ps, ["grab", "grab", "rest"])
check("lone wolves: two grabbers trip the alarm", g.gold[ann.id] == 3 and g.gold[bo.id] == 3)

# bots finish an endless game
random.seed(4)
for seed in range(3):
    r, g, ps = heist_room(rounds=0, style="crew" if seed % 2 else "solo", n=4)
    for p in ps:
        p.bot = "hard"
    for _ in range(40):
        g.bot_tick()
    g.act(r.players[r.host], {"type": "cashout"})
    check(f"bot endless game {seed}: 40 nights, then cashed out", r.phase == "over" and g.night == 41, g.night)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
