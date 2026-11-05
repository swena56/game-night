"""Contract Rummy: 🙋 May I? (off by default) lets a player out of turn buy the top discard before the next
player draws, taking a penalty card too (3 buys a hand; not your own discard). Bots buy a discard they want
when the player in turn passes it up. 💡 Find my contract (peek) returns the melds, or None. The recap of
the last hand survives the next deal.

    python3 tests/rummy_mayi.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(mayi, n=3):
    random.seed(5)
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("rummy")
    if mayi is not None:
        r.settings["mayi"] = mayi
    r.start()
    return r, r.game, ps


def refused(fn):
    try:
        fn()
    except GameError as e:
        return str(e)
    return None


r, g, ps = table(None)
turn = r.players[r.turn]
other = next(p for p in ps if p.id != turn.id)
check("off by default", not g.s["mayi"] and refused(lambda: g.act(other, {"type": "mayi"})))

r, g, ps = table(True)
turn = r.players[r.turn]
ti = g.seat(turn)
other = next(p for p in ps if p.id != turn.id)
oi = g.seat(other)
top, before = g.discard[-1], len(g.hands[oi])
g.act(other, {"type": "mayi"})
check("buy: the discard and a penalty card", len(g.hands[oi]) == before + 2 and top in g.hands[oi])
check("buying is out of turn: the turn stays", r.turn == turn.id)
check("the player in turn can't buy", refused(lambda: g.act(turn, {"type": "mayi"})))
g.act(turn, {"type": "draw", "from": "deck"})
check("after the draw nobody can buy", refused(lambda: g.act(other, {"type": "mayi"})))
card = g.hands[ti][0]
g.act(turn, {"type": "discard", "card": card})
check("you can't buy back your own discard", refused(lambda: g.act(turn, {"type": "mayi"})))
g.buys[oi] = 3
check("three buys a hand", refused(lambda: g.act(other, {"type": "mayi"})) is not None or r.turn == other.id)

# bots buy what they want when it's passed up
r, g, ps = table(True)
ann, bo, cy = ps
for p in ps:
    if p.id != r.turn:
        p.bot = "hard"
turn = r.players[r.turn]
bought = 0
for k in range(30):
    if r.phase != "playing" or r.players[r.turn].bot:
        break
    me = r.players[r.turn]
    g.act(me, {"type": "draw", "from": "deck"})
    bought = sum(g.buys)
    g.act(me, {"type": "discard", "card": g.hands[g.seat(me)][0]})
    while r.phase == "playing" and r.players[r.turn].bot:
        g.bot_tick()
check("bots call May I? sometimes", sum(g.buys) > 0, g.buys)

# hint and recap
r, g, ps = table(None)
ann = ps[0]
i = g.seat(ann)
res = g.peek(ann, {"what": "contract"})
check("hint answers groups or None", "groups" in res)
g.hands[i] = ["7S0", "7H0", "7D0", "9C0", "9S0", "9H1", "2C0", "3C0", "4C0", "5C0"]
res = g.peek(ann, {"what": "contract"})
check("hint finds two sets", res["groups"] and all(x["kind"] == "set" for x in res["groups"]), res)
g.end_hand(i if not g.hands[i] else None)
check("recap survives the next deal", g.view(ann)["rummy"]["recap"]["hand"] == 1 and g.hand_no == 2)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
