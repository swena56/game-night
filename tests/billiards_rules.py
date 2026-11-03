"""Billiards rules checks: break scratches, 9-ball push-outs and three fouls in a row. The shot engine is
stubbed out, so each test scripts what a shot pockets and hits, and a small fake room stands in for the server.

    python3 tests/billiards_rules.py        # well under a second
"""
import os
import random
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import billiards as b  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


class Player:
    def __init__(self, pid, name, bot=None):
        self.id, self.name, self.bot = pid, name, bot
        self.g = types.SimpleNamespace()
        self.spectator = self.eliminated = False


class Room:
    def __init__(self, settings, players):
        self.settings = dict(b.Billiards.defaults(), timer=0, **settings)
        self.players = {p.id: p for p in players}
        self.order = [p.id for p in players]
        self.turn = self.deadline = self.winner = None
        self.bot_at, self.phase, self.logs = 0.0, "playing", []
        self.game = None

    def add_log(self, text, kind="info", **_):
        self.logs.append(text)

    def begin_turn(self, pid):
        self.turn = pid

    def advance(self):
        self.turn = self.order[(self.order.index(self.turn) + 1) % len(self.order)]

    def finish(self, winner, text):
        self.phase, self.winner, self.turn = "over", winner.id if winner else None, None
        self.logs.append(text)

    def rerack(self):
        """Hook for match play: nothing by default."""


def new_game(rules="9", first="a", **settings):
    pa, pb = Player("a", "Ann"), Player("b", "Bo")
    room = Room({"rules": rules, **settings}, [pa, pb])
    g = b.Billiards(room)
    room.game = g
    rng = random.Random(1)
    rng.choice = lambda seq: next(p for p in seq if p.id == first)
    g.start([pa, pb], rng)
    return g, room, pa, pb


def script(sunk=(), first="low", move=None):
    """Make the next simulate() call pocket `sunk` and touch `first` first ("low": the lowest ball up)."""
    def sim(pos, angle, speed, **kw):
        final = {n: xy for n, xy in pos.items() if n not in sunk}
        if move:
            final.update(move)
        f = min(n for n in pos if n) if first == "low" else first
        holes = kw.get("holes")
        if holes is not None:
            for n in sunk:
                holes[n] = 0
        return final, list(sunk), f, [[0, 0]]
    b.simulate = sim


def shoot(g, p, **extra):
    g.busy_until = 0.0
    g.act(p, {"type": "shoot", "angle": 0.0, "power": 0.5, **extra})
    if g.ending:  # the result shows once the balls stop
        g.bot_tick()


def pass_back(g, p):
    g.busy_until = 0.0
    g.act(p, {"type": "pass"})


def raises(fn):
    try:
        fn()
    except GameError:
        return True
    return False


# ---------- 8-ball: a scratch on the break puts the cue ball behind the line; later scratches anywhere
g, room, a, bo = new_game("8")
script(sunk=[0])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
check("8-ball break scratch: ball in hand behind the line", g.in_hand == "kitchen" and room.turn == "b", g.in_hand)
script(sunk=[0])
shoot(g, bo, cue=[b.HEAD_X - 5, b.TH / 2])
check("8-ball scratch after the break: ball in hand anywhere", g.in_hand == "anywhere" and room.turn == "a", g.in_hand)

g, room, a, bo = new_game("8")
script(sunk=[0, 8])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
check("8 and the cue ball on the break: 8 spotted, kitchen", 8 in g.pos and g.in_hand == "kitchen" and room.phase == "playing")

# ---------- 9-ball push-out
g, room, a, bo = new_game("9")
check("no push-out on the break", raises(lambda: shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2], push=True)))
script(sunk=[])  # the break pots nothing
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
check("after the break the next shooter may push", g.push_ok and room.turn == "b")
script(sunk=[], first=None)  # the push touches nothing
shoot(g, bo, push=True)
check("a push that hits nothing is no foul", g.in_hand is None and g.fouls["b"] == 0)
check("after a push the rival chooses", g.push_choice == "a" and room.turn == "a" and not g.push_ok)
room.turn = "b"
check("the pusher can't hand it back", raises(lambda: pass_back(g, bo)))
room.turn = "a"
pass_back(g, a)
check("handing it back makes the pusher shoot", room.turn == "b" and g.push_choice is None)
check("no second push-out", raises(lambda: shoot(g, bo, push=True)))

g, room, a, bo = new_game("9")
script(sunk=[])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
script(sunk=[9], first=None)
shoot(g, bo, push=True)
check("the 9 on a push is spotted, no win", 9 in g.pos and room.phase == "playing" and room.turn == "a")
script(sunk=[])
shoot(g, a)  # shooting takes the table as it lies
check("shooting after a push takes the table", g.push_choice is None and room.turn == "b")

g, room, a, bo = new_game("9")
script(sunk=[])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
script(sunk=[0], first=None)
shoot(g, bo, push=True)
check("a scratch on a push is a foul", g.in_hand == "anywhere" and room.turn == "a" and g.push_choice is None and g.fouls["b"] == 1)

# the bot answers a push: no pot worth taking means hand it back
g, room, a, bo = new_game("9")
bo.bot = "normal"
g.push_choice, room.turn = "b", "b"
g.candidates = lambda cx, cy, targets: []
g.bot_turn(bo)
check("a bot hands back a push that leaves it no pot", room.turn == "a" and g.push_choice is None)

# ---------- 9-ball: three fouls in a row lose; a legal shot resets the count
g, room, a, bo = new_game("9")
script(sunk=[])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])  # break, nothing down: Bo to shoot
spot = [10.0, 10.0]
for k in range(2):
    script(sunk=[], first=None)
    shoot(g, bo, **({"cue": spot} if g.in_hand else {}))  # foul: no ball hit
    script(sunk=[], first=None)
    shoot(g, a, cue=spot)  # Ann fouls too
check("two fouls each: still playing, warned", room.phase == "playing" and g.fouls == {"a": 2, "b": 2}
      and any("one more loses" in t for t in room.logs))
script(sunk=[])
shoot(g, bo, cue=spot)  # a legal miss
check("a legal shot resets the fouls", g.fouls["b"] == 0)
script(sunk=[], first=None)
shoot(g, a)
check("the third foul in a row loses", room.phase == "over" and room.winner == "b")

# ---------- match play: race to 2, the break alternates, a pause between racks
g, room, a, bo = new_game("9", race=2)
script(sunk=[9])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])  # the 9 on the break wins rack 1
check("rack 1 won: a pause, not game over", room.phase == "playing" and g.between and room.turn is None
      and g.racks == {"a": 1, "b": 0} and room.deadline)
v = g.view(a)["billiards"]
check("the view shows the match score between racks", v["between"] and v["race"] == 2 and v["rackWinner"] == "a"
      and v["standings"] and v["standings"][0]["id"] == "a")
check("no bot moves during the pause", not g.bot_ready())
g.on_timeout()
check("rack 2: the other player breaks", not g.between and room.turn == "b" and g.breaking and g.rack_no == 2
      and g.in_hand == "kitchen" and len(g.pos) == 10)
script(sunk=[9])
shoot(g, bo, cue=[b.HEAD_X - 5, b.TH / 2])
check("1–1: another rack", g.between and g.racks == {"a": 1, "b": 1})
g.on_timeout()
check("rack 3: back to the first breaker", room.turn == "a" and g.rack_no == 3)
script(sunk=[9])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
check("reaching the race wins the match", room.phase == "over" and room.winner == "a" and "2–1" in room.logs[-1], room.logs[-1])
check("a match records racks won", g.final_scores() == {"a": 2, "b": 1})

g, room, a, bo = new_game("8")
check("one rack records balls sunk", g.final_scores() == {"a": 0, "b": 0} and g.race == 1)
script(sunk=[0, 8])
shoot(g, a, cue=[b.HEAD_X - 5, b.TH / 2])
script(sunk=[8])
g.groups = {"a": "solids", "b": "stripes"}
g.pos = {0: (50, 50), 8: (100, 50)}
shoot(g, bo, pocket=0)  # Bo's group is cleared: the 8 in the called pocket wins
check("one rack: the 8 ends the game at once", room.phase == "over" and room.winner == "b")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
