"""Realm Wars rules on real rooms: undo while drafting (not past a trade), forts (+1 to the defender's best die,
falling with the land), storms (no attack or fortify across a closed lane), picking lands (every land claimed,
leftover troops in the first draft), exact odds with a fort, and the Grand Archipelago map.

    python3 tests/realm_rules.py        # a few seconds
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import realm as R  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(name, fn):
    try:
        fn()
        check(name, False, "was allowed")
    except GameError as e:
        check(name, True, str(e))


def room_for(bots=("normal",), **settings):
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    for lvl in bots:
        room.add_bot(lvl)
    room.switch_game("realm")
    room.settings.update(settings)
    room.start()
    return room, ann


def to_my_draft(room, ann):
    """Let bots play until it's Ann's draft."""
    for _ in range(3000):
        if room.phase != "playing":
            return False
        g = room.game
        if room.turn == ann.id and g.phase == "draft":
            return True
        if room.turn == ann.id:
            g.end_turn(ann) if g.phase in ("attack", "fortify") else g.autopilot(ann)
            continue
        room.bot_at = 0
        g.bot_tick()
    return False


class Dice:
    """A stand-in rng whose randint hands out a fixed sequence."""
    def __init__(self, seq, base):
        self.seq, self.base = list(seq), base

    def randint(self, a, b):
        return self.seq.pop(0) if self.seq else self.base.randint(a, b)

    def __getattr__(self, k):
        return getattr(self.base, k)


# -- undo
room, ann = room_for(storms=False, forts=True)
g = room.game
check("starts on my draft", to_my_draft(room, ann))
s = g.seat(ann)
mine = g.lands_of(s)
t = mine[0]
before, res = g.troops[t], g.reserve
g.act(ann, {"type": "place", "land": t, "n": 1})
g.act(ann, {"type": "unplace"})
check("undo restores troops and reserve", g.troops[t] == before and g.reserve == res)
refused("nothing left to undo", lambda: g.act(ann, {"type": "unplace"}))
g.act(ann, {"type": "place", "land": t, "n": 999})
check("placing everything moves to attack", g.phase == "attack")
g.act(ann, {"type": "unplace"})
check("undo from attack goes back to drafting", g.phase == "draft" and g.reserve == res)
ann.g.cards = [0, 0, 0]
g.act(ann, {"type": "place", "land": t, "n": 1})
g.act(ann, {"type": "trade"})
refused("can't undo past a trade", lambda: g.act(ann, {"type": "unplace"}))

# -- forts
res = g.reserve
f = next(x for x in mine if x not in g.forts)
g.act(ann, {"type": "fort", "land": f})
check("a fort costs 4 from the draft", g.reserve == res - R.FORT_COST and f in g.forts)
other = next((x for x in mine if x not in g.forts and x != f), None)
if other is not None and g.reserve >= R.FORT_COST:
    refused("one fort per turn", lambda: g.act(ann, {"type": "fort", "land": other}))
g.act(ann, {"type": "unplace"})
check("undo takes the fort back", f not in g.forts and g.reserve == res)
check("fort +1 turns a 6–5 win into a loss", R.resolve([6], [5], fort=True) == (1, 0) and R.resolve([6], [5]) == (0, 1))
check("fort only lifts the best die", R.resolve([6, 5], [5, 4], fort=True) == (1, 1))

# a fort on a rival's land: fixed dice, and it falls with the land
room, ann = room_for(storms=False)
g = room.game
to_my_draft(room, ann)
s = g.seat(ann)
pair = next((a, b) for a in g.lands_of(s) for b in R.ADJ[a] if g.owner[b] not in (s, -1))
a, b = pair
g.troops[a], g.troops[b] = 10, 1
g.forts = {b}
g.reserve = 0
g.phase = "attack"
g.rng = Dice([6, 6, 6, 5], g.rng)  # attacker 6 6 6 vs defender 5+1: ties go to the defender
g.act(ann, {"type": "attack", "from": a, "to": b, "blitz": False})
check("fort defender wins a 6 v 5+1 tie", g.troops[b] == 1 and g.troops[a] == 9, f"{g.troops[a]} v {g.troops[b]}")
g.rng = Dice([6, 6, 6, 3], g.rng.base)
g.act(ann, {"type": "attack", "from": a, "to": b, "blitz": False})
check("the land falls, and its fort with it", g.owner[b] == s and b not in g.forts)

# -- storms
room, ann = room_for(storms=True)
g = room.game
to_my_draft(room, ann)
s = g.seat(ann)
check("a storm is up from round one", len(g.storms) == 1)
a, b = R.MAPS["isles"].sea[0]
g.owner[a], g.owner[b] = s, 1 - s if len(g.seats) == 2 else (s + 1) % len(g.seats)
g.troops[a], g.troops[b] = 8, 1
g.storms = [[min(a, b), max(a, b)]]
g.reserve = 0
g.phase = "attack"
refused("no attack across a stormy lane", lambda: g.act(ann, {"type": "attack", "from": a, "to": b}))
g.owner[b] = s
check("no fortify path across it either", b not in g.reach(s, a) or any(
    g.owner[x] == s for x in R.ADJ[a] if x != b), "reach goes round by land only")
g.storms = []
check("with the lane open, it's reachable", b in g.reach(s, a))

# -- picking lands
room, ann = room_for(bots=("normal", "hard"), start="pick", storms=False)
g = room.game
check("starts in the claim phase", g.phase == "claim" and all(o == -1 for o in g.owner))
while room.turn != ann.id:
    g.bot_tick()
t = next(x for x in range(R.N) if g.owner[x] == -1)
g.act(ann, {"type": "claim", "land": t})
check("a claim takes the land with one troop", g.owner[t] == g.seat(ann) and g.troops[t] == 1)
refused("can't claim out of turn", lambda: g.act(ann, {"type": "claim", "land": 4}))
for _ in range(200):
    if g.phase != "claim":
        break
    if room.turn == ann.id:
        g.act(ann, {"type": "claim", "land": g.best_claim(g.seat(ann), "normal")})
    else:
        g.bot_tick()
check("every land gets claimed", -1 not in g.owner and g.phase == "draft")
n = len(g.seats)
first = room.players[room.turn]
k = g.seat(first)
check("the first draft carries the leftover starting troops",
      g.reserve >= g.income(k) + R.MAPS["isles"].start[n] - 1, f"reserve {g.reserve}")

# -- odds
for a_, d_ in ((3, 2), (5, 3), (8, 6)):
    rng = random.Random(7)
    wins = 0
    for _ in range(4000):
        x, y = a_, d_
        while x > 0 and y > 0:
            at = sorted((rng.randint(1, 6) for _ in range(min(3, x))), reverse=True)
            de = sorted((rng.randint(1, 6) for _ in range(min(2, y))), reverse=True)
            la, ld = R.resolve(at, de, True)
            x -= la; y -= ld
        wins += y == 0
    exact = R.win_chance(a_, d_, True)
    check(f"fort odds {a_} v {d_} match a simulation", abs(wins / 4000 - exact) < 0.03, f"{exact:.3f} vs {wins / 4000:.3f}")
check("a fort makes a land harder to take", R.win_chance(6, 4, True) < R.win_chance(6, 4))

# -- the grand map
gm = R.MAPS["grand"]
check("grand map: 44 lands on 8 islands", gm.n == 44 and len(gm.islands) == 8)
check("grand map: every land has a neighbour, links are symmetric",
      all(gm.adj[i] for i in range(gm.n)) and all(i in gm.adj[j] for i in range(gm.n) for j in gm.adj[i]))
seen, todo = {0}, [0]
while todo:
    x = todo.pop()
    for y in gm.adj[x]:
        if y not in seen:
            seen.add(y); todo.append(y)
check("grand map: all one connected world", len(seen) == gm.n)
room, ann = room_for(bots=("normal", "normal", "normal"), map="grand")
check("a grand game deals all 44 lands", -1 not in room.game.owner and len(room.game.owner) == 44)

# -- gambits
room, ann = room_for(storms=True, gambits=True)
g = room.game
to_my_draft(room, ann)
s = g.seat(ann)
check("four gambits each when storms are on", sorted(ann.g.gambits) == ["march", "muster", "runner", "shield"])
res = g.reserve
g.act(ann, {"type": "gambit", "name": "muster"})
check("muster adds half the draft, rounded up", g.reserve == res + -(-g.drafted // 2), f"{res} -> {g.reserve}")
refused("each gambit only once", lambda: g.act(ann, {"type": "gambit", "name": "muster"}))
g.act(ann, {"type": "gambit", "name": "shield"})
check("shield wall marks the seat", s in g.shield)
check("other viewers see the gambits left", room.view(next(q for q in room.players.values() if q.id != ann.id))["realm"]["gambits"][s] == ["march", "runner"])
# a shielded defender wins a 6 v 5+1 tie
bot_seat = next(k for k in range(len(g.seats)) if k != s)
a, b = next((x, y) for x in g.lands_of(bot_seat) for y in R.ADJ[x] if g.owner[y] == s and not g.stormed(x, y))
g.troops[a], g.troops[b] = 10, 1
g.forts = set(g.forts) - {b}
bot = room.players[g.seats[bot_seat]]
g.rng = Dice([6, 6, 6, 5], g.rng)
g.battle(bot, bot_seat, a, b, False)
check("shield wall: the defender's best die gets +1", g.owner[b] == s and g.roll["shield"], f"{g.troops[a]} v {g.troops[b]}")
g.rng = g.rng.base
# forced march: two fortify moves
g.reserve = 0
g.phase = "attack"
g.act(ann, {"type": "gambit", "name": "march"})
mine = g.lands_of(s)
pairs = [(x, y) for x in mine for y in g.reach(s, x)]
if pairs:
    x, y = pairs[0]
    g.troops[x] = max(g.troops[x], 5)
    g.act(ann, {"type": "fortify", "from": x, "to": y, "n": 1})
    check("forced march: still fortifying after the first move", g.phase == "fortify" and room.turn == ann.id)
    g.act(ann, {"type": "fortify", "from": x, "to": y, "n": 1})
    check("forced march: the second move ends the turn", room.turn != ann.id)
check("the shield stays up through other turns", s in g.shield)
to_my_draft(room, ann)
check("the shield comes down at your next turn", s not in g.shield)
# storm runner
a, b = R.MAPS["isles"].sea[0]
other = next(k for k in range(len(g.seats)) if k != s)
g.owner[a], g.owner[b] = s, other
g.troops[a], g.troops[b] = 8, 1
g.storms = [[min(a, b), max(a, b)]]
g.reserve = 0
g.phase = "attack"
refused("the storm blocks before running it", lambda: g.act(ann, {"type": "attack", "from": a, "to": b}))
g.act(ann, {"type": "gambit", "name": "runner"})
g.act(ann, {"type": "attack", "from": a, "to": b, "blitz": True})
check("storm runner: attack across the storm", g.roll["to"] == b)
room2, ann2 = room_for(gambits=False)
to_my_draft(room2, ann2)
refused("gambits off: none to play", lambda: room2.game.act(ann2, {"type": "gambit", "name": "shield"}))

# -- ambitions
room, ann = room_for(bots=("normal", "normal"), ambitions=True, storms=False)
g = room.game
to_my_draft(room, ann)
s = g.seat(ann)
check("everyone draws an ambition", all(getattr(q.g, "amb", None) for q in room.players.values()))
other = next(q for q in room.players.values() if q.id != ann.id)
check("you see your own ambition", room.view(ann)["realm"]["ambition"]["text"] == g.amb_text(ann.g.amb))
check("a rival sees only theirs, never yours", room.view(other)["realm"]["ambition"]["text"] == g.amb_text(other.g.amb)
      and json.dumps(ann.g.amb) not in json.dumps(room.view(other)) or ann.g.amb == other.g.amb)
ann.g.amb = {"kind": "lands", "n": 1}
cards, bonus = len(ann.g.cards), ann.g.bonus
g.end_turn(ann)
check("fulfilling one: +6 next draft and a ⭐", ann.g.bonus == bonus + R.AMBITION_REWARD and ann.g.cards[-1] == 3 and len(ann.g.cards) == cards + 1)
check("a new ambition is drawn", ann.g.amb and ann.g.amb.get("kind") != "lands" and ann.g.amb_done == 1)
to_my_draft(room, ann)
ann.g.amb_done = 2
ann.g.amb = {"kind": "lands", "n": 1}
g.end_turn(ann)
check("the third ambition wins", room.phase != "playing" and room.winner == ann.id)

# -- advice is always legal: Ann follows it for a whole game
for mapkey in ("isles", "grand"):
    room, ann = room_for(bots=("hard", "normal"), map=mapkey, start="pick", gambits=True, ambitions=True, forts=True, storms=True)
    g = room.game
    bad = None
    for step in range(6000):
        if room.phase != "playing":
            break
        if room.turn != ann.id:
            room.bot_at = 0
            g.bot_tick()
            continue
        v = room.view(ann)["realm"]
        adv, hint = v["advice"], v["gambitHint"]
        try:
            if hint and step % 3 == 0:
                g.act(ann, {"type": "gambit", "name": hint["name"]})
                continue
            k = adv["kind"]
            if k == "claim":
                g.act(ann, {"type": "claim", "land": adv["land"]})
            elif k == "trade":
                g.act(ann, {"type": "trade"})
            elif k == "fort":
                g.act(ann, {"type": "fort", "land": adv["land"]})
            elif k == "place":
                g.act(ann, {"type": "place", "land": adv["land"], "n": adv["n"]})
            elif k == "attack":
                g.act(ann, {"type": "attack", "from": adv["from"], "to": adv["to"], "blitz": True})
            elif k == "stop":
                g.act(ann, {"type": "stop"})
            elif k == "occupy":
                g.act(ann, {"type": "occupy", "n": adv["n"]})
            elif k == "fortify":
                g.act(ann, {"type": "fortify", "from": adv["from"], "to": adv["to"], "n": adv["n"]})
            else:
                g.act(ann, {"type": "end"})
        except GameError as e:
            bad = f"{adv} -> {e}"
            break
    check(f"advice is always legal and the game ends ({mapkey})", bad is None and room.phase != "playing",
          bad or f"{step} steps, round {g.round}: {room.log[-1]['text'] if room.log else ''} / {[e['text'] for e in room.log if 'wins' in e['text'] or 'rules' in e['text']][-1:]}")

print("\n" + ("all ok" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
