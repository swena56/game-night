"""Dice Derby 🐴 Long shot (off by default): a horse that trailed the leader by 6 squares and still wins adds +3
to every ticket on it.

    python3 tests/derby_longshot.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import derby as D  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("derby")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def finish_with(r, g, win, tickets, lag):
    """Rig the board so the next move sends horse `win` over the line; every player holds `tickets`."""
    for q in g.players():
        q.g.tickets = list(tickets)
    g.pos = {h: 0 for h in range(1, 7)}
    g.pos[win] = D.TRACK - 1
    g.lag = {h: 0 for h in range(1, 7)}
    g.lag[win] = lag
    a = r.players[r.turn]
    other = [h for h in range(1, 7) if h != win]
    g.dice = [win, other[0], other[1]]
    g.act(a, {"type": "move", "order": [0, 1, 2]})


check("default off", D.Derby.defaults()["longshot"] is False)
check("payout: bonus only for a winner in the set", D.payout({1: 12, 2: 5, 3: 0, 4: 0, 5: 0, 6: 0}, [1, 2], {1, 2}) == 5 + 3 + 3
      and D.payout({1: 12, 2: 5, 3: 0, 4: 0, 5: 0, 6: 0}, [1, 2], {2}) == 5 + 3 and D.payout({1: 12, 2: 5, 3: 0, 4: 0, 5: 0, 6: 0}, [1, 2]) == 8)

# off: a long-trailing winner pays the plain 5
r, g, (ann, bo) = room(longshot=False)
finish_with(r, g, 4, [4, 5], D.LAG + 3)
check("off: no bonus, no moment", ann.g.score == 6 and g.result["long"] == [] and not any("Long shot" in m.get("text", "") for m in r.log if isinstance(m, dict)))

# on: lag at the threshold pays +3 a ticket; one short pays nothing extra
r, g, (ann, bo) = room(longshot=True, races=1)
finish_with(r, g, 4, [4, 5], D.LAG)
check("on: winner that trailed by 6 pays 5+3", ann.g.score == 9 and bo.g.score == 9 and g.result["long"] == [4], ann.g.score)
r, g, (ann, bo) = room(longshot=True, races=1)
finish_with(r, g, 4, [4, 5], D.LAG - 1)
check("on: one square short pays plain", ann.g.score == 6 and g.result["long"] == [])
# both copies of the horse in one hand pay twice; a 2nd place horse never gets the bonus
r, g, (ann, bo) = room(longshot=True, races=1)
finish_with(r, g, 4, [4, 4], D.LAG)
check("on: two tickets on the long shot each pay", ann.g.score == 16)
# a tie for the win, both long shots
check("on: a shared win pays both long shots", D.payout({1: 12, 2: 12, 3: 0, 4: 0, 5: 0, 6: 0}, [1, 2], {1, 2}) == 16)
# lag tracking through real moves
r, g, (ann, bo) = room(longshot=True)
g.pos = {h: 0 for h in range(1, 7)}
g.pos[1] = 8
g.lag = {h: 0 for h in range(1, 7)}
a = r.players[r.turn]
g.dice = [1, 2, 3]
g.act(a, {"type": "move", "order": [0, 1, 2]})   # horse 1 gallops to 10, 2 trots to 1, 3 stays at 0
check("lag: the trailing horses record the gap", g.lag[4] == 10 and g.lag[3] == 10 and g.lag[1] == 0, g.lag)
# portfolio shows the bonus only while the winner is qualified
r, g, (ann, bo) = room(longshot=True)
check("portfolio: pays include the bonus", D.portfolio({1: 12, 2: 3, 3: 0, 4: 0, 5: 0, 6: 0}, [1], None, {1})["rows"][0]["pays"] == 8
      and D.portfolio({1: 12, 2: 3, 3: 0, 4: 0, 5: 0, 6: 0}, [1])["rows"][0]["pays"] == 5)
v = g.view(ann)["derby"]
check("view: option and lag are public", v["longshot"] is True and set(v["lag"]) == set(range(1, 7)))
r2, g2, (a2, b2) = room()
check("view: off hides the lag", g2.view(a2)["derby"]["longshot"] is False and g2.view(a2)["derby"]["lag"] is None)

# old saves: no lag attribute, option missing, mid-game pickle round trip
r, g, (ann, bo) = room(longshot=True)
a = r.players[r.turn]
g.act(a, {"type": "roll"})
g.act(a, {"type": "move", "order": [2, 1, 0]})
r3 = pickle.loads(pickle.dumps(r))
g3 = r3.game
check("pickle mid-game keeps the lag", g3.lag == g.lag and g3.longs() == g.longs())
del g3.__dict__["lag"]
g3.s.pop("longshot", None)
check("old object: class default and no option", g3.longs() == set() and g3.view(ann)["derby"]["lag"] is None)
b = r3.players[r3.turn]
g3.act(b, {"type": "roll"})
g3.act(b, {"type": "move", "order": [0, 1, 2]})
check("old object: a move still works", True)

# bots at every level play legally; the twist fires
fired = races = 0
for level in ("easy", "normal", "hard"):
    for _ in range(4 if level == "hard" else 10):
        r = server.Room("T")
        r.add_player("H").bot = level
        r.add_bot(level)
        r.switch_game("derby")
        r.settings.update(races=3, longshot=True)
        r.start()
        g = r.game
        orig = g.do_move
        def mv(p, order, orig=orig):
            assert sorted(order) == [0, 1, 2] and p.id == r.turn
            return orig(p, order)
        g.do_move = mv
        oe = g.end_race
        def er(oe=oe, g=g):
            global fired, races
            races += 1
            fired += bool(g.longs() & {h for h, pl in D.places(g.pos).items() if pl == 0})
            oe()
        g.end_race = er
        for _ in range(3000):
            if r.phase != "playing":
                break
            g.bot_turn(r.players[r.turn])
        if r.phase != "over":
            fails.append(f"bots ({level}) finished")
check("bots finish legally and the bonus fires", fired >= 1 and 0.03 < fired / races < 0.8, f"{fired}/{races}")

# edge: a long-trailing horse that finishes 2nd gets nothing while another horse wins
r, g, (ann, bo) = room(longshot=True, races=1)
ann.g.tickets, bo.g.tickets = [2, 5], [1, 5]
g.pos = {h: 0 for h in range(1, 7)}
g.pos[1] = D.TRACK - 1
g.pos[2] = 7
g.lag = {h: 0 for h in range(1, 7)}
g.lag[2] = D.LAG + 2
a = r.players[r.turn]
g.dice = [1, 3, 4]
g.act(a, {"type": "move", "order": [0, 1, 2]})
check("edge: a qualified 2nd-place horse gets no bonus", g.result["long"] == [] and ann.g.score == 3 and bo.g.score == 5, (ann.g.score, bo.g.score))

# edge: dead heat, only one of the two winners qualified; holders of other horses get nothing extra
r, g, (ann, bo) = room(longshot=True, races=1)
ann.g.tickets, bo.g.tickets = [1, 5], [2, 5]
g.pos = {h: 0 for h in range(1, 7)}
g.pos[1], g.pos[2] = D.TRACK - 2, D.TRACK - 1
g.lag = {h: 0 for h in range(1, 7)}
g.lag[1] = D.LAG
a = r.players[r.turn]
g.dice = [1, 2, 3]        # 1 gallops to 12, 2 trots to 12, 3 stumbles (stays 0)
g.act(a, {"type": "move", "order": [0, 1, 2]})
check("edge: dead heat pays the bonus only to the qualified winner", g.result["long"] == [1] and ann.g.score == 9 and bo.g.score == 6, (ann.g.score, bo.g.score, g.result["long"]))

# edge: a player with no ticket on the long shot gets nothing extra
r, g, (ann, bo) = room(longshot=True, races=1)
finish_with(r, g, 4, [4, 5], D.LAG)
ann.g.score = 0
check("edge: callout is public, no ticket info in it",
      not any("Ann" in m.get("text", "") for m in r.log if isinstance(m, dict) and "Long shot" in m.get("text", "")))
r, g, (ann, bo) = room(longshot=True, races=1)
ann.g.tickets, bo.g.tickets = [4, 5], [1, 2]
g.pos = {h: 0 for h in range(1, 7)}
g.pos[4] = D.TRACK - 1
g.lag = {h: 0 for h in range(1, 7)}
g.lag[4] = D.LAG
a = r.players[r.turn]
g.dice = [4, 5, 6]
g.act(a, {"type": "move", "order": [0, 1, 2]})
check("edge: holders of other horses get no bonus", ann.g.score == 11 and bo.g.score == 2, (ann.g.score, bo.g.score))

# edge: lag is measured from the leader after each move; a tie for the lead and the opening are no gap
r, g, (ann, bo) = room(longshot=True)
check("lag: nothing at the start", set(g.lag.values()) == {0})
g.pos = {h: 0 for h in range(1, 7)}
a = r.players[r.turn]
g.dice = [1, 1, 2]      # 1 gallops +2 then trots +1 (=3), 2 stumbles
g.act(a, {"type": "move", "order": [0, 1, 2]})
check("lag: leader 0, others the gap", g.lag[1] == 0 and g.lag[2] == 3 and g.lag[3] == 3 and g.pos[1] == 3, g.lag)
r, g, (ann, bo) = room(longshot=True)
g.pos = {h: 0 for h in range(1, 7)}
g.pos[1], g.pos[2] = 4, 5
g.lag = {h: 0 for h in range(1, 7)}
a = r.players[r.turn]
g.dice = [1, 3, 4]      # horse 3 gallops, horse 1 trots to 5 and ties horse 2
g.act(a, {"type": "move", "order": [1, 0, 2]})
tied_ok = g.pos[1] == 5 and g.pos[2] == 5
check("lag: a tie for the lead gives the tied horses no gap", tied_ok and g.lag[1] == 0 and g.lag[2] == 0, (g.pos, g.lag))

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
