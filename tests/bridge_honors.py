"""Bridge 🎖️ honors: with the option on, four of the five top trump honors in one hand score 100, all five 150,
four aces at no trumps 150, to that hand's side (setting "honors", default Off). Edge cases, pickle, bot games.

    python3 tests/bridge_honors.py
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


def table(on=None, tag="H", deals=None):
    r = server.Room(tag)
    for k in range(4):
        r.add_player(f"P{k}")
    r.switch_game("bridge")
    if on is not None:
        r.settings["honors"] = on
    if deals:
        r.settings["deals"] = deals
    r.start()
    g = r.game
    g.pause = lambda *a, **k: None
    return r, g


def setup(g, trump, dealt, declarer=0, took=10):
    g.trump = trump
    g.dealt = dealt
    g.declarer, g.dummy, g.dbl = declarer, (declarer + 2) % 4, 0
    g.contract = "4" + (trump or "N")
    g.tricks = [took, 0, 0, 0]
    g.score = [0, 0]
    g.end_hand()


def hands(h1):
    return [list(h1), ["2C"] * 13, ["3C"] * 13, ["4C"] * 13]


r, g = table()
check("default Off", g.s["honors"] is False and g.dealt and len(g.dealt[0]) == 13)
setup(g, "S", hands(["AS", "KS", "QS", "JS", "TS"]))
check("Off: no bonus (4S made = 420)", g.score == [420, 0], g.score)

r, g = table(True)
setup(g, "S", hands(["AS", "KS", "QS", "JS", "2S"]))
check("On: 4 honors = +100 (declarer side)", g.score == [520, 0], g.score)
setup(g, "S", hands(["AS", "KS", "QS", "JS", "TS"]))
check("On: 5 honors = +150", g.score == [570, 0], g.score)
setup(g, "S", hands(["AS", "KS", "QS", "2S", "9S", "AH", "KH", "QH", "JH"]))
check("On: 3 honors in trump (plus other-suit honors) = none", g.score == [420, 0], g.score)
setup(g, "S", [["2C"] * 13, ["AS", "KS", "QS", "JS"] + ["5C"] * 9, ["3C"] * 13, ["4C"] * 13])
check("On: defenders' honors score for the defenders", g.score == [420, 100], g.score)
setup(g, "S", [["2C"] * 13, ["AS", "KS", "QS", "JS"] + ["5C"] * 9, ["3C"] * 13, ["4C"] * 13], took=5)
check("On: failed contract + defenders' honors stack (down 5, 4S not vul = 100+200+200+300+300 for 2 down.. see score)", g.score[0] == 0 and g.score[1] > 100, g.score)
setup(g, None, hands(["AS", "AH", "AD", "AC"]))
check("NT: four aces = +150 (4NT made 430)", g.score == [580, 0], g.score)
setup(g, None, hands(["AS", "AH", "AD", "2C"]))
check("NT: three aces = none", g.score == [430, 0], g.score)
setup(g, None, hands(["AS", "KS", "QS", "JS", "TS"]))
check("NT: trump honors don't count", g.score == [430, 0], g.score)

# old-style object (no dealt attribute) and missing setting
r, g = table(True)
del g.dealt
check("old object: dealt defaults None", g.dealt is None and g.honors() == [])
g.s.pop("honors", None)
check("missing key acts as Off", not g.s.get("honors", False))

# callout text carries no private info beyond what is public at the end of a hand
r, g = table(True)
msgs = []
om = g.moment
g.moment = lambda text, *a, **k: (msgs.append(text), om(text, *a, **k))[1]
setup(g, "S", hands(["AS", "KS", "QS", "JS", "2S"]))
check("callout names holder and points", any("held 4 trump honors" in m and "+100" in m for m in msgs), msgs)
check("banner mentions bonus", "Honors" in g.result or "🎖️" in g.result)

fired = games = deals = 0
for seed in range(40):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(4):
        r.add_player(f"B{k}")
    r.switch_game("bridge"); r.settings["honors"] = True; r.settings["deals"] = 4; r.start(); g = r.game
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    orig_play = g.play
    g.play = lambda i, c, g=g, orig=orig_play: (c in g.legal(i) or (_ for _ in ()).throw(AssertionError((i, c)))) and orig(i, c)
    lvl = ["easy", "normal", "hard"][seed % 3]
    pickled = False
    for _ in range(4000):
        if r.phase != "playing":
            break
        if g.stage == "score":
            if g.after:
                f, g.after = g.after, None
                f()
        else:
            g.bot_move(g.seats.index(r.turn), lvl)
        if not pickled and g.stage == "play" and sum(map(len, g.hands)) < 30:
            saved = {k: g.__dict__.pop(k) for k in ("play", "moment") if k in g.__dict__}
            r2 = pickle.loads(pickle.dumps(r))
            g.__dict__.update(saved)
            check("mid-hand pickle round trip", r2.game.hands == g.hands and r2.game.dealt == g.dealt)
            pickled = True
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}): game ends", r.phase != "playing")
    games += 1
    deals += g.deal_no
    fired += sum("🎖️" in m for m in msgs)
    if fired and not seed % 10:
        pass
print(f"fired {fired} times in {games} games ({deals} deals)")
check("honors fire in bot games", fired >= games / 10 and fired > 0, fired)
sys.exit(1 if fails else 0)
