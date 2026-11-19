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
# 🕵️ bluff meter: from the public calls and lives only, and gone once the cup is shaken again
seen = []
for truth in ([1, 1], [3, 1], [6, 5]):
    g.truth = truth
    seen.append(json.dumps([g.view(q)["mia"]["bluff"] for q in (a, b, c)]))
bl = g.view(c)["mia"]["bluff"]
check("mia meter: shown after a call, the same whatever is under the cup", len(set(seen)) == 1 and bl and 0 <= bl["pct"] <= 100, bl)
check("mia meter: matches the public-calls estimate", bl["pct"] == round(100 * (1 - M.true_chance(65, 11))) and bl["cost"] == 1 and bl["claimerLives"] == b.g.lives)
watcher = r.add_player("Eve")
check("mia meter: a watcher's view works", g.view(watcher)["mia"]["bluff"] == bl)
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
r2, g2, _ = room("mia", 3)
a2 = r2.players[r2.turn]
g2.act(a2, {"type": "roll"})
check("mia meter: none before the first call", g2.view(a2)["mia"]["bluff"] is None)
g2.act(a2, {"type": "claim", "value": 66})
b2 = r2.players[r2.turn]
check("mia meter: an opening call gets one too", g2.view(b2)["mia"]["bluff"]["pct"] == round(100 * (1 - M.true_chance(None, 66))))
g2.act(b2, {"type": "roll"})
check("mia meter: gone once the cup is shaken", all(g2.view(q)["mia"]["bluff"] is None for q in r2.players.values()))
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
# 🔮 forecast: matches the final count for every hand, and only for the placer until the roll locks
for n, lines_ in ((4, [[3, 3, 3], [2, 3, 4], [2, 2, 5], [1, 1, 1], [6, 6, 2], [1, 3, 5]]),
                  (5, [[3, 3, 3, 3], [2, 2, 5, 5], [2, 3, 4, 5], [4, 4, 4, 1], [1, 2, 6, 6], [1, 3, 5, 6], [2, 2, 2, 5]])):
    for vals in lines_:
        for v in range(1, 7):
            grid = [0] * (n * n)
            grid[:n - 1] = vals
            row = Q.forecast(grid, [v], n)[n - 1][0][0]
            full = vals + [v]
            g2 = list(grid)
            g2[n - 1] = v
            if not (row[1] and row[2:] == list(Q.hand(full)[1:]) and Q.total(g2, n) == row[3]):
                check(f"squares forecast: {full} on {n}×{n}", False, row)
check("squares forecast: completing lines match hand() for every category on 4×4 and 5×5", True)
check("squares forecast: an unfinished line shows its best hand", Q.forecast([3, 3, 0, 0] + [0] * 12, [3], 4)[2][0][0] == [0, False, "Four of a kind", 20])
r, g, (ann, bo) = room("squares")
va, vb = g.view(ann)["squares"], g.view(bo)["squares"]
check("squares forecast: each placer gets one for their own grid", va["forecast"] and len(va["forecast"]) == 16 and len(va["forecast"][0]) == len(g.dice))
g.act(ann, {"type": "place", "cell": 3})
check("squares forecast: gone once placed, and never about a rival's grid", g.view(ann)["squares"]["forecast"] is None and "forecast" not in json.dumps(g.view(bo)["squares"]["rivals"]))
watcher = r.add_player("Eve")
check("squares forecast: a watcher gets none", g.view(watcher)["squares"]["forecast"] is None)

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
# ⚔️ combat preview: follows the held dice and the chosen target, with backfire and quake odds
S_, W_, X_, G_, H_ = B.SKULL, B.SWORD, B.SMASH, B.SHIELD, B.HEART
pv = B.preview([S_, S_, X_, X_, W_], {2, 3}, {"bo": 1, "cy": 0}, "bo", 2)
check("brawl preview: fight now hits the target through its guard", pv["now"] == {"backfire": 0, "quake": 0, "dmg": 4, "guard": 0, "heal": 0}, pv["now"])
check("brawl preview: one free die, a third skull 1 in 6", abs(pv["reroll"]["backfire"] - 1 / 6) < 1e-9, pv["reroll"])
check("brawl preview: a third smash quakes everyone 1 in 6", abs(pv["reroll"]["quake"] - 1 / 6) < 1e-9)
# reroll the sword: sword ×2 → 5−1, smash → quake 6−1 on Bo + 6 on Cy, shield/heart → 4−1; skull → 0
check("brawl preview: average damage counts the quake on every rival", abs(pv["reroll"]["dmg"] - (2 * 4 + 11 + 3 + 3) / 6) < 1e-9, pv["reroll"]["dmg"])
pv2 = B.preview([S_, S_, X_, X_, W_], {2, 3}, {"bo": 1, "cy": 0}, "cy", 2)
check("brawl preview: changing target changes the damage", pv2["now"]["dmg"] == 5)
pv3 = B.preview([S_, S_, X_, X_, W_], {2, 3, 4}, {"bo": 1}, "bo", 2)
check("brawl preview: holding everything leaves no reroll", pv3["reroll"] is None)
pv4 = B.preview([G_, H_, H_, H_, W_], {0, 1, 2, 3}, {"bo": 0}, "bo", 2)
check("brawl preview: healing caps at the missing health", pv4["now"]["heal"] == 2 and pv4["now"]["guard"] == 1)
pv5 = B.preview([W_, W_, W_, W_, W_], set(), {"bo": 0}, "bo", 0)
check("brawl preview: five free dice", 0 < pv5["reroll"]["backfire"] < 0.2 and 0 < pv5["reroll"]["quake"] < 0.2, pv5["reroll"])

# -- Dice Derby
pos = {h: 0 for h in range(1, 7)}
check("derby: +2, +1, −1 in that order", D.apply({**pos, 3: 1}, [1, 2, 3], (0, 1, 2)) == {**pos, 1: 2, 2: 1, 3: 0})
check("derby: tied horses share the better place", D.places({1: 5, 2: 5, 3: 1, 4: 0, 5: 0, 6: 0})[2] == 0)
r, g, (ann, bo) = room("derby", races=1)
check("derby: two secret tickets each", len(ann.g.tickets) == 2 and g.view(bo)["derby"]["tickets"] == bo.g.tickets)
check("derby: rivals' tickets stay hidden", g.view(bo)["derby"]["result"] is None and "tickets" not in json.dumps({k: v for k, v in g.view(bo)["derby"].items() if k != "tickets"}))
# 🎟️ portfolio: built from the owner's own tickets only, reconciled with every move
check("derby: the portfolio is the owner's", [x["horse"] for x in g.view(ann)["derby"]["portfolio"]["rows"]] == ann.g.tickets
      and [x["horse"] for x in g.view(bo)["derby"]["portfolio"]["rows"]] == bo.g.tickets)
watcher = r.add_player("Eve")
check("derby: a watcher gets no tickets or portfolio", g.view(watcher)["derby"]["tickets"] is None and g.view(watcher)["derby"]["portfolio"] is None)
f = D.portfolio({1: 6, 2: 4, 3: 4, 4: 2, 5: 1, 6: 0}, [2, 5], {1: 4, 2: 4, 3: 4, 4: 2, 5: 2, 6: 0})
check("derby: portfolio pays, pass and threats", f["rows"][0] == {"horse": 2, "place": 1, "pays": 3, "pass": [1], "threats": [3]}
      and f["rows"][1] == {"horse": 5, "place": 4, "pays": 0, "pass": [4], "threats": [6]} and f["total"] == 3 and f["last"] == -2, f)
a = r.players[r.turn]
g.act(a, {"type": "roll"})
g.act(a, {"type": "move", "order": [0, 1, 2]})
for q in (ann, bo):
    fv = g.view(q)["derby"]["portfolio"]
    check(f"derby: {q.name}'s portfolio reconciles after the move", fv["total"] == D.payout(g.pos, q.g.tickets)
          and fv["last"] == D.payout(g.pos, q.g.tickets) - D.payout(g.prev_pos, q.g.tickets))
del g.prev_pos
check("derby: an old save without the last position still shows", g.view(ann)["derby"]["portfolio"]["last"] is None)
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
