"""Skat 🍺 Bock: with the option on, the deal after a lost game counts double (setting "bock", default Off).
Exact scoring, edge cases (last deal, pass-out, won game), pickle round trip, and bot games.

    python3 tests/skat_bock.py
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


def table(on=None, deals=None, tag="K"):
    r = server.Room(tag)
    for k in range(3):
        r.add_player(f"P{k}")
    r.switch_game("skat")
    if on is not None:
        r.settings["bock"] = on
    if deals:
        r.settings["deals"] = deals
    r.start()
    g = r.game
    g.pause = lambda *a, **k: None
    return r, g


def finish(g, win, bock=None):
    """End a club game (matadors: with 1 -> x2 game... value fixed by hand) for declarer 0: win=True takes 70, else 50."""
    g.declarer, g.game, g.bid, g.hand_game = 0, "C", 18, False
    g.orig, g.put_away = ["JC", "7C"], []
    g.won = [["AS"] * 7 if win else ["AS"] * 4, [], []]       # 7 aces = 77, 4 aces = 44
    g.tricks = [3, 0, 0]
    if bock is not None:
        g.bock = bock
    g.end_hand()


r, g = table()
check("default Off", g.s["bock"] is False)
finish(g, False)
check("Off: loss scores -2v, next deal not bock", g.score[0] == -48 and not g.bock, (g.score, g.bock))

r, g = table(True)
finish(g, False)
check("On: first loss is normal", g.score[0] == -48 and g.bock, (g.score, g.bock))
check("banner shows bock", "Bock" in str(g.table(next(iter(r.players.values())), 0)["scores"]["hint"]))
g.score = [0, 0, 0]
finish(g, True)
check("bock win doubles: +48", g.score[0] == 48 and not g.bock, (g.score, g.bock))
check("summary mentions bock", "Bock" in g.result, g.result)
g.score = [0, 0, 0]
finish(g, False, bock=True)
check("bock loss doubles and chains", g.score[0] == -96 and g.bock, (g.score, g.bock))

r, g = table(True, deals=3)
g.deal_no = 3
finish(g, False)
check("last deal: no bock carried", not g.bock and r.phase != "playing", (g.bock, r.phase))

# all passed keeps the flag
r, g = table(True)
g.bock = True
g.bid, g.declarer, g.passed = 0, None, [True, True, False]
g.place(2, None)
check("pass-out keeps bock, redeal", g.bock and g.stage in ("score", "bid"))

# old-style object without the attribute, and pickle
r, g = table(True)
g.__dict__.pop("bock", None)
check("class default False", g.bock is False)
r.settings.pop("bock", None)
finish(g, False)
check("missing key acts as Off", not g.bock)

fired = games = deals = 0
for seed in range(12):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(3):
        r.add_player(f"B{k}")
    r.switch_game("skat"); r.settings["bock"] = True; r.settings["deals"] = 3; r.start(); g = r.game
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    orig_play = g.play
    g.play = lambda i, c, g=g, orig=orig_play: (c in g.legal(i) or (_ for _ in ()).throw(AssertionError((i, c)))) and orig(i, c)
    lvl = ["easy", "normal", "hard"][seed % 3]
    pickled = False
    for _ in range(3000):
        if r.phase != "playing":
            break
        if g.stage == "score":
            if g.after:
                f, g.after = g.after, None
                f()
        else:
            g.bot_move(g.seats.index(r.turn), lvl)
        if not pickled and g.stage == "play" and len(g.hands[0]) == 5:
            saved = {k: g.__dict__.pop(k) for k in ("play", "moment") if k in g.__dict__}
            r2 = pickle.loads(pickle.dumps(r))
            g.__dict__.update(saved)
            check("mid-hand pickle round trip", r2.game.hands == g.hands and r2.game.bock == g.bock)
            pickled = True
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}): game ends", r.phase != "playing")
    games += 1
    deals += g.deal_no
    fired += sum("Bock!" in m for m in msgs)
print(f"fired {fired} times in {games} games ({deals} deals)")
check("bock fires in bot games", fired >= games / 10 and fired > 0, fired)
sys.exit(1 if fails else 0)
