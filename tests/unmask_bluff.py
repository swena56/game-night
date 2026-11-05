"""Unmask 🃏 Bluff card (off by default; duels only): the rival's next question gets the opposite answer,
the liar is told privately, everyone sees that a bluff is waiting, and the lie is owned up at the end.
Bots cope with a lie: when no face fits every answer they keep the faces that fit all but one.

    python3 tests/unmask_bluff.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import unmask as u  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def duel(bluff, mode="duel", seed=1):
    random.seed(seed)
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("unmask")
    r.settings["mode"] = mode
    if bluff is not None:
        r.settings["bluff"] = bluff
    r.start()
    return r, r.game, ann, bo


r, g, ann, bo = duel(None)
check("off by default: nobody is dealt a Bluff", all("bluff" not in p.g.cards for p in (ann, bo)) and not g.s["bluff"])

dealt = 0
for seed in range(30):
    r, g, ann, bo = duel(True, seed=seed)
    dealt += any("bluff" in p.g.cards for p in (ann, bo))
check("on: Bluff turns up in duels", dealt > 0, f"{dealt}/30")

r, g, ann, bo = duel(True, mode="manhunt")
check("never in manhunt", all("bluff" not in p.g.cards for p in r.seated()))

# Ann bluffs; Bo asks; the answer is flipped once, then truthful again
r, g, ann, bo = duel(True)
ann.g.cards = ["bluff"]
first, second = (ann, bo) if r.turn == ann.id else (bo, ann)
if r.turn != ann.id:
    g.act(bo, {"type": "ask", "q": {"a": "glasses:any"}})
g.act(ann, {"type": "card", "card": "bluff"})
check("bluff is public", any("bluff up their sleeve" in e["text"] for e in r.log))
truth = u.evaluate(g.board[ann.g.secret], {"a": "gender:woman", "op": None})
g.act(ann, {"type": "ask", "q": {"a": "hat:any"}})  # Ann's own question: truthful
g.act(bo, {"type": "ask", "q": {"a": "gender:woman"}})
said = bo.g.learned[-1][1]
check("the next question about Ann is a lie", said == (not truth))
check("Ann is told privately", any(e.get("to") == ann.id and "You lied" in e["text"] for e in r.log) if isinstance(r.log[0], dict) else True)
g.act(ann, {"type": "ask", "q": {"a": "hat:any"}})
g.act(bo, {"type": "ask", "q": {"a": "gender:man"}})
check("only one lie", bo.g.learned[-1][1] == u.evaluate(g.board[ann.g.secret], {"a": "gender:man", "op": None}))
# bots: candidates fit all answers but one when nothing fits them all
cands = g.candidates(bo)
check("bot candidates still include the real face", any(f["id"] == ann.g.secret for f in cands), len(cands))
g.act(ann, {"type": "accuse", "face": bo.g.secret})
check("the lie is owned up at the end", any("bluffed" in e["text"] for e in r.log))

# a full bot duel with bluffs finishes
for seed in range(8):
    r, g, ann, bo = duel(True, seed=seed)
    ann.bot = bo.bot = "hard"
    ann.g.cards, bo.g.cards = ["bluff"], ["bluff"]
    for _ in range(80):
        if r.phase != "playing":
            break
        p = r.players[r.turn]
        g.bot_turn(p)
    check(f"bot duel {seed} finishes", r.phase == "over")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
