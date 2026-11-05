"""Sumo Saucers simulation checks: bot matches in every arena, with and without power-ups and ghosts, run
on a fake clock against a small fake room. Checks that matches finish, rounds don't drag, the harder bot
wins, ghosts drop meteors, power-ups get picked up, and a room saved before power-ups still runs.

    python3 tests/sumo_sim.py        # about half a minute on a phone
"""
import os
import random
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from games import sumo as m  # noqa: E402

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
        self.settings = dict(m.Sumo.defaults(), **settings)
        self.players = {p.id: p for p in players}
        self.order = [p.id for p in players]
        self.turn = self.deadline = self.winner = None
        self.phase, self.logs, self.fast = "playing", [], None
        self.game = None

    def add_log(self, text, kind="info", **_):
        self.logs.append(text)

    def push_fast(self, data):
        self.fast = data

    def seated(self):
        return [self.players[i] for i in self.order if not self.players[i].spectator]

    def contenders(self):
        return [p for p in self.seated() if not p.eliminated]

    def finish(self, winner, text):
        self.phase, self.winner = "over", winner
        self.add_log(text)


def match(levels, seed, **settings):
    """One bot match on a fake 60 fps clock. Returns (room, game, round lengths, {event kind: how many})."""
    random.seed(seed)
    players = [Player(f"p{k}", f"{lv}{k}", lv) for k, lv in enumerate(levels)]
    room = Room(settings, players)
    g = m.Sumo(room)
    room.game = g
    t = 1000.0
    g.start(list(players), random.Random(seed))
    g.last_frame = t  # start() uses time.time(): move the round onto the fake clock
    g.next_at = t + m.COUNTDOWN
    lengths, kinds = [], {}
    while room.phase == "playing" and t < 1000 + 1800:
        t += 1 / 60
        g.frame(t)
        for e in (room.fast or {}).get("ev", []):
            kinds.setdefault(e[1], set()).add(e[0])
        if g.stage in ("over", "done") and g.started and (not lengths or lengths[-1][0] != g.round):
            lengths.append((g.round, t - g.started))
    return room, g, [x for _, x in lengths], {k: len(v) for k, v in kinds.items()}


# every arena and option finishes
for arena in ("disc", "ring", "mix"):
    for pu, gh in ((True, True), (False, False), (True, False)):
        room, g, lens, ev = match(["normal", "normal", "hard"], hash((arena, pu, gh)) & 0xffff,
                                  arena=arena, powerups=pu, ghosts=gh)
        check(f"{arena} powerups={pu} ghosts={gh} finishes", room.phase == "over",
              f"{len(lens)} rounds, longest {max(lens or [0]):.0f}s")
        check(f"{arena} powerups={pu} ghosts={gh} rounds under 90 s on average",
              lens and sum(lens) / len(lens) < 90, f"avg {sum(lens) / max(1, len(lens)):.0f}s")
        if pu:
            check(f"{arena} orbs get picked up", ev.get("p", 0) > 0, f"{ev.get('p', 0)} pickups")
        else:
            check(f"{arena} no orbs when off", ev.get("p", 0) == 0)
        if gh:
            check(f"{arena} ghosts drop meteors", ev.get("m", 0) > 0, f"{ev.get('m', 0)} meteors")
        else:
            check(f"{arena} no meteors when ghosts are off", ev.get("m", 0) == 0)
        check(f"{arena} hits are sent as events", ev.get("h", 0) > 0, f"{ev.get('h', 0)} hits")

# knockouts are counted
room, g, _, _ = match(["normal"] * 4, 7)
check("knockouts are counted", sum(g.kos) > 0, f"kos {g.kos}")

# hard beats normal head to head
hard = sum(match(["hard", "normal"], 100 + k)[0].winner.bot == "hard" for k in range(16))
check("hard beats normal", hard >= 11, f"{hard}–{16 - hard}")

# sudden death: after SQUEEZE_AFTER the bumpers go, a warning comes, then the platform shrinks below its usual floor
random.seed(5)
players = [Player(f"p{k}", f"b{k}") for k in range(2)]
room = Room({}, players)
g = m.Sumo(room)
g.start(list(players), random.Random(5))
t = g.next_at + 0.01
g.frame(t)
g.started -= m.SQUEEZE_AFTER
g.target = g.radius = m.MIN_RADIUS
for k, s in enumerate(g.saucers):  # nobody steers: park them in the middle
    s.x, s.y = (-1.0, 0.0) if k == 0 else (1.0, 0.0)
seen = []
for _ in range(60 * 30):
    t += 1 / 60
    g.frame(t)
    seen += [e[1] for e in room.fast["ev"] if e[1] not in seen]
check("sudden death removes the bumpers", g.squeeze and not any(g.bumpers))
check("sudden death warns, then shrinks", seen[:3] == ["x", "k", "r"], seen)
check("sudden death goes below the usual floor", g.radius == m.SQUEEZE_MIN, g.radius)

# a room saved before power-ups and ghosts (no new attributes) keeps running
random.seed(3)
players = [Player(f"p{k}", f"b{k}", "normal") for k in range(3)]
room = Room({}, players)
g = m.Sumo(room)
g.start(list(players), random.Random(3))
for k in ("kos", "events", "orbs", "meteors", "target", "ev_seq", "orb_at", "warned", "squeeze"):
    g.__dict__.pop(k, None)
for s in g.saucers:
    for k in ("heavy_until", "turbo_until", "shield", "gx", "gy"):
        s.__dict__.pop(k, None)
del room.settings["powerups"], room.settings["ghosts"]
t = g.next_at
try:
    for _ in range(600):
        t += 1 / 60
        g.frame(t)
    g.view(players[0])
    check("an old saved room keeps running", True)
except Exception as e:  # noqa: BLE001
    check("an old saved room keeps running", False, repr(e))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {', '.join(fails)}")
sys.exit(1 if fails else 0)
