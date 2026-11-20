"""Moon Shot 🌬️ Slipstream: stopping 1-2 squares behind a rival drafts you onto their square (setting "slip",
on by default). Off, nothing changes; solo and the moon are untouched; bots of every level finish games
through the real move path and the draft fires.

    python3 tests/moonshot_slip.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def race(slip=None, n=2, bots=None):
    r = server.Room("TEST")
    ps = [r.add_player(f"P{k}") for k in range(n)]
    r.switch_game("moonshot")
    r.settings["hazards"] = False
    if slip is not None:
        r.settings["slip"] = slip
    if bots:
        for p, b in zip(ps, bots):
            p.bot = b
    r.start()
    g = r.game
    me = r.players[r.turn]
    others = [p for p in ps if p is not me]
    return r, g, me, others


r, g, me, (them,) = race()
check("on by default", g.s["slip"] is True)
g.pos[them.id] = 12; g.pos[me.id] = 2; g.fuel = 8
g.bank(me)
check("2 behind: drafts onto the rival", g.pos[me.id] == 12 and g.pos[them.id] == 12, g.pos)
check("callout fired", any("slipstream" in e["text"] for e in r.log))

r, g, me, (them,) = race()
g.pos[them.id] = 12; g.pos[me.id] = 2; g.fuel = 9
g.bank(me)
check("1 behind: drafts", g.pos[me.id] == 12)

for fuel, name in ((7, "3 behind"), (11, "passing them"), (10, "landing on them")):
    r, g, me, (them,) = race()
    g.pos[them.id] = 12; g.pos[me.id] = 2; g.fuel = fuel
    g.bank(me)
    check(f"{name}: no draft", g.pos[me.id] == 2 + fuel, g.pos)

r, g, me, (them,) = race(False)
g.pos[them.id] = 12; g.pos[me.id] = 2; g.fuel = 8
g.bank(me)
check("off: no draft", g.pos[me.id] == 10 and not any("slipstream" in e["text"] for e in r.log))

r, g, me, others = race(n=3)
a, b = others
g.pos[a.id] = 12; g.pos[b.id] = 11; g.pos[me.id] = 2; g.fuel = 8
g.bank(me)
check("three players: nearest rival ahead", g.pos[me.id] == 11 and g.pos[a.id] == 12, g.pos)

r, g, me, (them,) = race()
g.pos[me.id] = 40; g.pos[them.id] = 49; g.fuel = 8
g.bank(me)
check("moon not affected / rival at 49 fine", g.pos[me.id] == 49)

r = server.Room("TEST")
r.add_player("Solo")
r.switch_game("moonshot")
r.settings["hazards"] = False
r.start()
r.game.pos[r.turn] = 5
r.game.fuel = 4
r.game.bank(r.players[r.turn])
check("solo: nothing to draft", r.game.pos[r.turn] == 9)

# old room (no setting key) and pickle round trip
r, g, me, (them,) = race()
r.settings.pop("slip", None)
g.s.pop("slip", None) if isinstance(g.s, dict) else None
g.pos[them.id] = 12; g.pos[me.id] = 2; g.fuel = 8
g.bank(me)
check("old settings load", g.pos[me.id] in (10, 12))
g2 = pickle.loads(pickle.dumps(r))
check("pickle round trip", g2.game.pos == r.game.pos)

# bots, every level, real path
fired = games = 0
for lvl in ("easy", "normal", "hard"):
    for k in range(10):
        r, g, me, others = race(n=3, bots=[lvl] * 3)
        games += 1
        steps = 0
        while r.phase == "playing" and steps < 800:
            steps += 1
            pid = r.turn
            p = r.players[pid]
            g.bot_turn(p)
            assert all(0 <= v <= g.goal for v in g.pos.values())
        check(f"{lvl} bot game {k} finished", r.phase != "playing", steps) if r.phase == "playing" else None
        if any("slipstream" in e["text"] for e in r.log):
            fired += 1
print(f"games with a slipstream: {fired}/{games}")
check("fires in bot play", fired >= 1)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
