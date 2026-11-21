"""Cassino 🧹 big sweep: clearing 3+ table piles in one capture counts as 2 sweeps (setting "bigsweep", on by
default); Off or a smaller sweep counts 1; old rooms load; a bot takes a 3+-pile sweep through the real move path.

    python3 tests/cassino_bigsweep.py
"""
import os
import pickle
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(on=None):
    r = server.Room("TEST")
    for k in range(2):
        r.add_player(f"P{k}")
    r.switch_game("cassino")
    if on is not None:
        r.settings["bigsweep"] = on
    r.start()
    return r, r.game


def lay(g, cards):
    g.table_items = [{"cards": [c], "value": int(c[0]), "owner": None, "rank": c[0]} for c in cards]
    g.hands = [["9S", "3C"], ["8D", "5D"]]
    g.stock = ["KH"]
    g.sweeps = [0, 0]
    g.last_taker = None
    g.to(0)


def full_take(g, i):
    ms = [m for m in g.moves_for(i) if m["kind"] == "take" and len(m["items"]) == len(g.table_items)]
    assert ms, "no sweep move"
    return ms[0]


FOUR = ["9H", "9D", "4H", "5H"]       # 9S takes both 9s and 4+5: four piles
THREE = ["9H", "4H", "5H"]            # 9S takes the 9 and 4+5: three piles
r, g = table(); lay(g, ["4H", "5H"]); g.apply(0, full_take(g, 0))
check("2-pile sweep counts 1", g.sweeps[0] == 1, g.sweeps)
r, g = table(); lay(g, FOUR); g.apply(0, full_take(g, 0))
check("4-pile sweep counts 2 (default)", g.sweeps[0] == 2, g.sweeps)
r, g = table(); lay(g, THREE); g.apply(0, full_take(g, 0))
check("3-pile sweep counts 2 (default)", g.sweeps[0] == 2, g.sweeps)
def hint(g):
    return g.table(r.players[next(iter(r.players))], 0)["scores"]["hint"]


r, g = table()
check("hint mentions big sweep when On", "sweeps 1 (3+ piles = 2)" in hint(g), hint(g))
r, g = table(False)
check("hint unchanged when Off", hint(g).endswith("sweeps 1."), hint(g))
r, g = table(False); lay(g, FOUR); g.apply(0, full_take(g, 0))
check("Off: 4-pile sweep counts 1", g.sweeps[0] == 1, g.sweeps)

r, g = table()
r.settings.pop("bigsweep", None)
g.s.pop("bigsweep", None)
g2 = pickle.loads(pickle.dumps(r)).game
lay(g2, FOUR); g2.apply(0, full_take(g2, 0))
check("old object (no key) works, default on", g2.sweeps[0] == 2, g2.sweeps)

# bot: hard bot holding the sweep takes it through bot_move
fired = 0
for _ in range(10):
    r, g = table(); lay(g, FOUR)
    seat = 0
    g.to(seat)
    legal = g.moves_for(seat)
    orig = g.apply
    def chk(i, m, orig=orig, legal=legal):
        assert any(x["card"] == m["card"] and x["kind"] == m["kind"] and x["items"] == m["items"] for x in legal), m
        return orig(i, m)
    g.apply = chk
    g.bot_move(seat, "hard")
    if g.sweeps[seat] == 2:
        fired += 1
        break
check("bot takes the big sweep", fired > 0)
# real bot games (hard vs normal): finish, every move legal, big sweeps fire (about 1 game in 6 has one)
big = 0
from games import cassino  # noqa: E402
real = cassino.Cassino.apply
def spy(self, i, m):
    assert any(x["card"] == m["card"] and x["kind"] == m["kind"] and x["items"] == m["items"] for x in self.moves_for(i)), m
    sw, k = self.sweeps[i], len(m["items"])
    out = real(self, i, m)
    if m["kind"] == "take" and self.sweeps[i] - sw == 2 and k >= 3:
        global big
        big += 1
    return out
cassino.Cassino.apply = spy
done = 0
try:
    for n in range(100):
        if n >= 20 and big:      # at least 20 games; more (a few ms each) until a big sweep fires
            break
        r, g = table()
        lv = ["hard", "normal"]
        steps = 0
        while r.phase == "playing" and steps < 4000:
            if g.after:
                g.on_timeout()
                continue
            i = g.seats.index(r.turn)
            g.bot_move(i, lv[i])
            steps += 1
        if r.phase == "over":
            done += 1
finally:
    cassino.Cassino.apply = real
check("bot games finish, every move legal", done == n, f"{done}/{n + 1}" if done != n else f"{done} games")
check("a big sweep fires in bot games", big > 0, f"{big} in {done} games")
r, g = table()
lay(g, ["2H"])
g.hands[0] = ["3C", "5C"]
owner, rival = g.pl(0), g.pl(1)
g.act(owner, {"type": "play", "card": "3C", "kind": "build", "items": [0], "value": 5})
ledger = g.view(rival)["cassino"]["builds"]
check("ledger lists the build owner, target and committed cards",
      ledger == [{"owner": 0, "target": 5, "cards": cassino.show(["2H", "3C"])}])
check("owners still cannot trail if a capture is available",
      g.owns_build(0) and not any(m["kind"] == "trail" for m in g.moves_for(0)))
g.act(rival, {"type": "play", "card": "5D", "kind": "take", "items": [0]})
check("a rival can capture the listed cards using its target",
      g.taken[1] == ["5D", "2H", "3C"] and not g.view(owner)["cassino"]["builds"])

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
