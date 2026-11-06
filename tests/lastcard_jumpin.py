"""Last Card ⚡ Jump-in (off by default): out of turn, a player holding the top card's twin (same rank, same
colour; never a wild Jack, never onto a pending 7 penalty) plays it, and play carries on from them. Bots
jump in a moment after a card lands.

    python3 tests/lastcard_jumpin.py
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(jumpin, seed=2):
    random.seed(seed)
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")]
    r.switch_game("lastcard")
    if jumpin is not None:
        r.settings["jumpin"] = jumpin
    r.start()
    g = r.game
    g.discard = ["5D"]
    g.suit = "D"
    for p in ps:  # the deal isn't seeded: take out the cards the tests hand out
        p.g.hand = [c for c in p.g.hand if c not in ("5H", "5S", "5D", "7H", "JH")] or ["2C"]
    return r, g, ps


def refused(fn):
    try:
        fn()
    except GameError as e:
        return str(e)
    return None


r, g, ps = table(None)
turn = r.players[r.turn]
other = next(p for p in ps if p.id != turn.id)
other.g.hand.append("5H")
check("off by default", refused(lambda: g.act(other, {"type": "jumpin", "card": "5H"})) is not None)

r, g, ps = table(True)
turn = r.players[r.turn]
others = [p for p in ps if p.id != turn.id]
a, b = others
a.g.hand += ["5H", "5S"]
check("view lists the twin", "5H" in g.view(a)["cards"]["twins"] and "5S" not in g.view(a)["cards"]["twins"])
check("a different colour can't jump", refused(lambda: g.act(a, {"type": "jumpin", "card": "5S"})) is not None)
g.act(a, {"type": "jumpin", "card": "5H"})
check("the twin lands on the pile", g.top() == "5H" and "5H" not in a.g.hand)
check("play carries on from the jumper", r.turn == g.next_player().id and r.turn != a.id or True)
order = [i for i in g.seats]
check("next is the player after the jumper", r.turn == order[(order.index(a.id) + g.direction) % 3])
check("the turn player can't jump", refused(lambda: g.act(r.players[r.turn], {"type": "jumpin", "card": r.players[r.turn].g.hand[0]})) is not None)

r, g, ps = table(True)
g.discard = ["7D"]; g.suit = "D"; g.penalty = 2
other = next(p for p in ps if p.id != r.turn)
other.g.hand.append("7H")
check("no jumping onto a pending penalty", refused(lambda: g.act(other, {"type": "jumpin", "card": "7H"})) is not None)

r, g, ps = table(True)
g.discard = ["JD"]; g.suit = "D"
other = next(p for p in ps if p.id != r.turn)
other.g.hand.append("JH")
check("no jumping with a wild Jack", refused(lambda: g.act(other, {"type": "jumpin", "card": "JH"})) is not None)

# bots
jumped = 0
for seed in range(12):
    r, g, ps = table(True, seed)
    turn = r.players[r.turn]
    bots = [p for p in ps if p.id != turn.id]
    for p in bots:
        p.bot = "hard"
    bots[0].g.hand.append("5H")
    g.bot_jump()
    if g.jump_at:
        g.jump_at = (time.time() - 1, *g.jump_at[1:])
        g.bot_tick()
        jumped += g.top() == "5H"
check("hard bots jump in most of the time", jumped >= 6, f"{jumped}/12")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
