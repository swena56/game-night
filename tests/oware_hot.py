"""Oware 🌶️ Hot pits (default Off): a last seed also captures pits of 4; classic rules unchanged, bots play
legal moves at every level, the callout fires, and a mid-game pickle round trip works.

    python3 tests/oware_hot.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import oware  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(hot, level="normal"):
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("oware")
    if hot is not None:
        r.settings["hot"] = hot
    r.start()
    for p in r.seated():
        p.bot = level
    return r


# rules: seat 0 sows pit 5 (1 seed) onto pit 6 holding 3 -> 4
st = ((0, 0, 0, 0, 0, 1, 3, 5, 0, 0, 0, 0), (0, 0), 0)
check("classic: a pit made 4 is safe", oware.apply(st, 0, 5)[1] == (0, 0))
check("hot: a pit made 4 is captured", oware.apply(st, 0, 5, oware.CAPS[True])[1] == (4, 0))
check("hot: grand slam still captures nothing", oware.apply(((0,) * 5 + (1, 3) + (0,) * 5, (0, 0), 0), 0, 5, oware.CAPS[True])[1] == (0, 0))
d = game(None)
check("default Off", d.game.caps() == (2, 3) and d.game.view(d.seated()[0])["oware"]["caps"] == [2, 3])

# bots: every move legal, all levels, firing rate with the option on
fired = games = 0
for level, n in (("easy", 12), ("normal", 6), ("hard", 2)):
    for _ in range(n):
        r = game(True, level)
        g = r.game
        hit = False
        orig = g.moment
        def spy(text, *a, **k):
            global hit
            if "of 4" in text:
                hit = True
            return orig(text, *a, **k)
        g.moment = spy
        for _ in range(600):
            if r.phase != "playing":
                break
            p = r.players[r.turn]
            me = g.seat(p)
            before = g.state
            moves = oware.legal(before, me)
            g.bot_turn(p)
            if not moves or g.state == before:
                check("legal bot move", False, level)
        check(f"{level} game finishes", r.phase == "over")
        games += 1
        fired += hit
print(f"callout fired in {fired}/{games} bot games")
check("callout fires at least once", fired >= 1)

# pickle mid-game, then keep playing; an old-style object without the setting is classic
r = game(True, "easy")
for _ in range(10):
    r.game.bot_turn(r.players[r.turn])
r2 = pickle.loads(pickle.dumps(r))
g2 = r2.game
check("pickle keeps hot", g2.caps() == (2, 3, 4) and g2.state == r.game.state)
g2.s = {}
check("old settings lack hot -> classic", g2.caps() == (2, 3))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
