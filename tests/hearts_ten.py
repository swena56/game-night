"""Hearts 🔟 10♣ (off by default): with it on, whoever takes the 10♣ has that hand's points doubled
(not on a moon shot). Bots play full games through the real move path; old pickled objects still load.

    python3 tests/hearts_ten.py
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


def table(ten):
    r = server.Room("TEST")
    for n in ("Ann", "Bo", "Cy", "Di"):
        r.add_player(n)
    r.switch_game("hearts")
    if ten is not None:
        r.settings["ten"] = ten
    r.start()
    return r, r.game


r, g = table(None)
check("default off", not g.ten() and g.view(r.players[g.seats[0]])["hearts"]["tenAt"] is None)
g.taken = [["TC", "QS", "2H"], [], [], []]
g.end_hand()
check("off: no doubling", g.scores[0] == 14, g.scores)

r, g = table(True)
g.taken = [["TC", "QS", "2H"], ["3H"], [], []]
check("view: tenAt", g.view(r.players[g.seats[1]])["hearts"]["tenAt"] == 0)
g.end_hand()
check("on: taker's 14 doubled", g.scores[:2] == [28, 1], g.scores)

r, g = table(True)
g.taken = [["TC"], ["QS"], [], []]
g.end_hand()
check("on: clean 10♣ stays 0", g.scores[:2] == [0, 13], g.scores)

r, g = table(True)
g.taken = [["TC", "QS"] + [x + "H" for x in "23456789TJQKA"], [], [], []]
g.end_hand()
check("moon: not doubled", g.scores == [0, 26, 26, 26], g.scores)

# old-style object without the setting loads and plays
r, g = table(None)
r.settings.pop("ten", None)
g2 = pickle.loads(pickle.dumps(r)).game
check("pickle round trip + missing setting", not g2.ten())

# full bot games with it on, via the real move path
random.seed(3)
for lvl in ("easy", "normal", "hard"):
    r, g = table(True)
    for p in r.players.values():
        p.bot = lvl
    g.s["target"] = 30
    steps = 0
    ok = True
    while r.phase == "playing" and steps < 3000:
        steps += 1
        if g.stage == "score":
            g.deal()
            continue
        if g.stage == "pass":
            for i in range(4):
                if i not in g.passes:
                    cs = g.choose_pass(i, lvl)
                    g.act(r.players[g.seats[i]], {"type": "pass", "cards": cs})
            continue
        i = g.seats.index(r.turn)
        c = g.choose_play(i, lvl)
        if c not in g.legal(i):
            ok = False
            break
        g.act(r.players[g.seats[i]], {"type": "play", "card": c})
    check(f"{lvl} bots finish legally", ok and r.phase == "over", (steps, r.phase))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
