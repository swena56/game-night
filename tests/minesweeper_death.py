#!/usr/bin/env python3
"""Minesweeper's 💀 instant death option (report #311): the first mine ends that player's field, the others play on,
and games without it keep the high-score board they had."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server


def table(names, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in names]
    r.switch_game("minesweeper")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def mine_of(g, p):
    return next(i for i in range(g.n * g.n) if g.mine[i] and not g.st[p.id]["o"][i])


def finish(r, g):
    while r.phase == "playing":
        g.on_timeout()


# off (the default): a mine costs points and you play on
r, g, (a, b) = table(("Ann", "Bo"))
g.act(a, {"type": "open", "cell": mine_of(g, a)})
assert g.playing(a.id) and g.stage == "play"
assert g.view(a)["minesweeper"]["dead"] is False

# on: out at once, no more moves, the other player carries on
r, g, (a, b) = table(("Ann", "Bo"), death=True)
g.act(a, {"type": "open", "cell": mine_of(g, a)})
assert not g.playing(a.id) and g.playing(b.id) and g.stage == "play"
assert g.view(a)["minesweeper"]["dead"] is True and g.view(b)["minesweeper"]["dead"] is False
assert any("hit a mine: out" in e["text"] for e in r.log)
try:
    g.act(a, {"type": "open", "cell": 0})
    raise AssertionError("a dead player moved")
except server.GameError:
    pass
g.act(b, {"type": "open", "cell": mine_of(g, b)})
assert g.stage == "reveal"   # nobody left: the field ends

# a chord stops at the first mine: wrong flags round a number with two or more hidden mines to set off
r, g, (a,) = table(("Ann",), death=True)
for i in range(g.n * g.n):
    st = g.st[a.id]
    hid = [j for j in g.nb[i] if not st["o"][j]]
    mines = [j for j in hid if g.mine[j]]
    safe = [j for j in hid if not g.mine[j]]
    if st["o"][i] == 1 and len(mines) >= 2 and len(safe) >= len(mines) >= 2:
        for j in safe[:g.cnt[i]]:
            st["f"][j] = 1
        g.act(a, {"type": "chord", "cell": i})
        assert st["boom"] == 1, st["boom"]
        break
finish(r, g)

# bots die too, and a table of them still finishes
r = server.Room("BOTS")
for p in [r.add_player(x) for x in ("A", "B", "C")]:
    p.bot = "easy"
r.switch_game("minesweeper")
r.settings.update(death=True, level="hard")
r.start()
g = r.game
finish(r, g)
assert all(st["boom"] <= 1 for st in g.st.values())

# the high-score board: unchanged without instant death, separate with it
keys = []
for death in (False, True):
    r, g, _ = table(("Ann",), death=death)
    keys.append(r.round_record)
assert "Hitting a mine" not in keys[0]["label"] and "Instant death" in keys[1]["label"]
assert keys[0]["key"] != keys[1]["key"]
import hashlib, json
old = {"daily": False, "hints": 3, "level": "easy", "rounds": 1, "secs": 300}
assert keys[0]["key"] == hashlib.sha256(json.dumps(["minesweeper", "time", old, 0, ["human"]], sort_keys=True).encode()).hexdigest()[:24]
print("minesweeper instant death OK")
