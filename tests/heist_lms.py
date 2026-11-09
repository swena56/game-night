"""Night Heist 🔦 last thief standing: 🔥3 catches = arrested, rising rent from night 6 (can't pay = busted),
arrested players 👻 tail someone in the open (grab while tailed = 🔥1), last one free wins.

    python3 tests/heist_lms.py
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


def room(n=3):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("heist")
    r.settings["rounds"] = heist.LMS
    r.start()
    return r, r.game, ps


def night(g, ps, picks):
    for p, c in zip(ps, picks):
        g.act(p, {"type": "choose", "choice": c})


r, g, ps = room()
ann, bo, cy = ps
check("lms flags", g.lms and g.limit == 0 and g.view(ann)["heist"]["lms"])
check("no rent before night 6", [g.rent(k) for k in (1, 5, 6, 9, 10, 14)] == [0, 0, 1, 1, 2, 3])

# heat: caught three times → arrested
for k in range(3):
    night(g, ps, ["grab", "guard", "rest"])
check("caught 3× → arrested", ann.eliminated and g.heat[ann.id] == 3, g.heat)
check("still playing with two left", r.phase == "playing" and len(r.contenders()) == 2)
try:
    g.act(ann, {"type": "choose", "choice": "rest"})
    check("arrested can't choose", False)
except GameError:
    check("arrested can't choose", True)
try:
    g.act(bo, {"type": "tail", "target": cy.id})
    check("free players can't tail", False)
except GameError:
    check("free players can't tail", True)
g.act(ann, {"type": "tail", "target": cy.id})
check("tail is public", g.view(bo)["heist"]["tails"] == {ann.id: cy.id})
pot = g.pot
night(g, [bo, cy], ["rest", "grab"])
check("tailed lone grabber keeps the loot but gets 🔥1", g.heat[cy.id] == 1 and g.gold[cy.id] >= pot, (g.heat, g.gold))
check("tails reset each night", g.tails == {})
check("meta shows arrest", g.meta(ann).startswith("🚔"))

# rent: can't pay → busted; last one standing wins
r, g, ps = room()
ann, bo, cy = ps
for _ in range(5):
    night(g, ps, ["rest", "rest", "rest"])
g.gold[ann.id], g.gold[bo.id], g.gold[cy.id] = 0, 0, 20
night(g, ps, ["guard", "rest", "rest"])  # night 6, rent 💰1: Ann can't pay, Bo rests and pays
check("can't pay rent → busted", ann.eliminated and not bo.eliminated, g.gold)
check("rent goes in the vault", g.pot > 0)
g.gold[bo.id] = 0
night(g, [bo, cy], ["guard", "rest"])
check("last thief standing wins", r.phase == "over" and r.winner == cy.id, r.phase)

# everyone left falls the same night: richest of them wins
r, g, ps = room(n=2)
ann, bo = ps
g.heat = {ann.id: 2, bo.id: 2}
g.gold[ann.id], g.gold[bo.id] = 9, 4
g.night = 9  # rent 💰1
g.gold[bo.id] = 0
night(g, ps, ["grab", "grab"])  # alarm, no catch; Bo can't pay rent
check("one busted of two → other wins", r.phase == "over" and r.winner == ann.id)

r, g, ps = room()
ann, bo, cy = ps
g.heat = {ann.id: 2, bo.id: 2, cy.id: 0}
cy.eliminated = True  # pretend Cy's already out and tails nobody
g.gold[ann.id], g.gold[bo.id] = 7, 5
night(g, [ann, bo], ["grab", "grab"])
g.heat[ann.id] = g.heat[bo.id] = 2
check("alarm alone adds no heat", r.phase == "playing")
g.act(cy, {"type": "tail", "target": ann.id})
g.tails["ghost"] = bo.id
night(g, [ann, bo], ["grab", "grab"])
check("both arrested together → richer wins", r.phase == "over" and r.winner == ann.id, (r.phase, r.winner, g.gold))

# cash out still works as an escape hatch; endless/fixed modes are untouched
r, g, ps = room()
night(g, ps, ["rest"] * 3)
g.act(r.players[r.host], {"type": "cashout"})
check("host can cash out", r.phase == "over")

# bots play it out on their own
random.seed(7)
nights = []
for seed in range(12):
    random.seed(seed)
    r, g, ps = room(n=4)
    for i, p in enumerate(ps):
        p.bot = ("hard", "normal", "easy", "normal")[i]
    for _ in range(200):
        if r.phase != "playing":
            break
        g.bot_tick()
    nights.append(g.night)
    # usually one thief is left; if the last of them fall together with equal gold it's a tie
    check(f"bot game {seed} ends by itself", r.phase == "over" and g.night < heist.MAX_NIGHTS
          and (r.winner or not r.contenders()), (g.night, len(r.contenders())))
print("nights per bot game:", nights)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
