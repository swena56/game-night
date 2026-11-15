"""Rules checks for the five dice games added together: Midnight, Mia, Dice Squares, Dice Brawl, Dice Derby.

    python3 tests/dice5_rules.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402
from games import mia as M, squares as Q, brawl as B, derby as D, midnight as MN  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(gid, n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game(gid)
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def raises(fn):
    try:
        fn()
    except GameError:
        return True
    return False


# -- Midnight
r, g, _ = room("midnight")
p = r.players[r.turn]
g.kept = [6, 6, 6, 4, 1]
g.dice = [6]
g.do_keep(p, [0])
check("midnight: 1, 4 and four 6s score 24", p.g.score == 24, p.g.score)
q = r.players[r.turn]
check("midnight: the turn passes after six dice are kept", q is not p and g.kept == [])
g.kept = [6, 6, 6, 6, 4]
g.dice = [5]
g.do_keep(q, [0])
check("midnight: no 1 scores nothing", q.g.score == 0)
g.do_roll(r.players[r.turn])
check("midnight: keeping nothing is refused", raises(lambda: g.do_keep(r.players[r.turn], [])))
check("midnight: the exact search averages about 18.7", 18.5 < MN.value(6, False, False, 0) < 18.9)

# -- Mia
check("mia: 21 values, Mia on top, double 1s above 65", len(M.ORDER) == 21 and M.ORDER[-1] == 21 and M.RANK[11] > M.RANK[65])
check("mia: dice read high first", M.read(3, 5) == 53 and M.read(1, 2) == 21)
r, g, _ = room("mia", 3)
a = r.players[r.turn]
g.act(a, {"type": "roll"})
g.dice = [6, 5]
g.act(a, {"type": "claim", "value": 65})
b = r.players[r.turn]
check("mia: the claim passes the cup on", b is not a and g.claim == 65)
check("mia: the next player can't see the dice", g.view(b)["mia"]["dice"] is None)
check("mia: a claim must beat the last one", raises(lambda: (g.act(b, {"type": "roll"}), g.act(b, {"type": "claim", "value": 64}))))
g.act(b, {"type": "claim", "value": 11})   # b's dice are whatever was rolled: a bluff or not
c = r.players[r.turn]
g.truth = [3, 1]                          # b really had a 31: the double 1s were a bluff
lives = b.g.lives
g.act(c, {"type": "lift"})
check("mia: a lifted bluff costs the liar a life", b.g.lives == lives - 1)
check("mia: the loser opens the next round", r.turn == b.id and g.claim is None)
g.act(b, {"type": "roll"})
g.dice = [2, 1]
g.act(b, {"type": "claim", "value": 21})
c = r.players[r.turn]
check("mia: nothing beats a Mia, so no believing", raises(lambda: g.act(c, {"type": "roll"})))
lives = c.g.lives
g.act(c, {"type": "lift"})
check("mia: lifting a true Mia costs 2 lives", c.g.lives == max(0, lives - 2))
json.dumps(g.view(a))

# -- Dice Squares
check("squares: four of a kind", Q.hand([3, 3, 3, 3])[0] == "four")
check("squares: a run of 4", Q.hand([2, 5, 3, 4])[0] == "run")
check("squares: a full house of 5", Q.hand([2, 2, 5, 5, 5])[0] == "full")
check("squares: two pairs beat a pair", Q.hand([2, 2, 5, 5])[2] > Q.hand([2, 2, 5, 6])[2])
r, g, (ann, bo) = room("squares")
check("squares: nobody has the turn (everyone places at once)", r.turn is None)
g.act(ann, {"type": "place", "cell": 0})
check("squares: a square can't be used twice", raises(lambda: g.act(ann, {"type": "place", "cell": 1})))
check("squares: Ann's new square is hidden from Bo until he's placed", g.view(bo)["squares"]["rivals"][ann.id][0] == 0)
t = g.t
g.act(bo, {"type": "place", "cell": 5})
check("squares: the next roll comes when everyone is in", g.t == t + 1)
check("squares: then it shows", g.view(bo)["squares"]["rivals"][ann.id][0] != 0)

# -- Dice Brawl
check("brawl: swords and smashes add up", B.tally([2, 3, 4, 5, 6])["dmg"] == 4)
r, g, (ann, bo) = room("brawl", hp=12)
a = r.players[r.turn]
o = bo if a is ann else ann
g.dice, g.rolls = [B.SMASH, B.SMASH, B.SWORD, B.SHIELD, B.HEART], 1
o.g.guard = 1
a.g.hp = 10
g.act(a, {"type": "fight", "target": o.id})
check("brawl: a shield blocks 1, the rest hits", o.g.hp == 12 - 4, o.g.hp)
check("brawl: hearts heal and shields guard", a.g.hp == 11 and a.g.guard == 1)
g.dice, g.rolls = [B.SKULL, B.SKULL, B.SWORD, B.SWORD, B.SWORD], 1
g.held = [True, True, False, False, False]
hp = o.g.hp
g.rng.randint = lambda lo, hi: B.SKULL
g.do_roll(o, [])
check("brawl: a third skull backfires for 2", o.g.hp == hp - 2)
del g.rng.randint
json.dumps(g.view(ann))

# -- Dice Derby
pos = {h: 0 for h in range(1, 7)}
check("derby: +2, +1, −1 in that order", D.apply({**pos, 3: 1}, [1, 2, 3], (0, 1, 2)) == {**pos, 1: 2, 2: 1, 3: 0})
check("derby: tied horses share the better place", D.places({1: 5, 2: 5, 3: 1, 4: 0, 5: 0, 6: 0})[2] == 0)
r, g, (ann, bo) = room("derby", races=1)
check("derby: two secret tickets each", len(ann.g.tickets) == 2 and g.view(bo)["derby"]["tickets"] == bo.g.tickets)
check("derby: rivals' tickets stay hidden", g.view(bo)["derby"]["result"] is None and "tickets" not in json.dumps({k: v for k, v in g.view(bo)["derby"].items() if k != "tickets"}))
a = r.players[r.turn]
g.act(a, {"type": "roll"})
check("derby: every die needs a job", raises(lambda: g.act(a, {"type": "move", "order": [0, 0, 1]})))
g.pos = {h: 0 for h in range(1, 7)}
g.pos[ann.g.tickets[0]] = D.TRACK - 1
g.dice = [ann.g.tickets[0], 6 if ann.g.tickets[0] != 6 else 5, 4 if ann.g.tickets[0] != 4 else 3]
g.act(a, {"type": "move", "order": [0, 1, 2]})
check("derby: reaching the line ends the race and pays the tickets", r.phase == "over" and ann.g.score >= 5)

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
