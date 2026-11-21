"""Truc sweep: winning the first two tricks outright scores +1 (setting "sweep", default Off; Truc only).
Exact scoring, Off/missing key, Put, folds, pickle mid-hand, legal bot moves on all levels, firing rate.

    python3 tests/truc_sweep.py
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


def table(on=None, rules=None, tag="T"):
    r = server.Room(tag)
    for k in range(2):
        r.add_player(f"P{k}")
    r.switch_game("truc")
    if on is not None:
        r.settings["sweep"] = on
    if rules:
        r.settings["rules"] = rules
    r.start()
    return r, r.game


def hand(g, h0, h1):
    g.hands = [list(h0), list(h1)]
    g.score, g.stake, g.won, g.history, g.trick, g.first = [0, 0], 1, [0, 0], [], [], None
    g.stage, g.leader = "play", 0
    g.to(0)


def play(g, seq):
    for seat, c in seq:
        g.play(seat, c)
    return g.score


r, g = table()
check("default Off", g.s["sweep"] is False)
hand(g, ["3S", "2S", "7S"], ["AH", "KH", "8H"])
check("Off: 2-0 scores stake only", play(g, [(0, "3S"), (1, "AH"), (0, "2S"), (1, "KH")]) == [1, 0])
r, g = table(True)
hand(g, ["3S", "2S", "7S"], ["AH", "KH", "8H"])
check("On: 2-0 sweep +1", play(g, [(0, "3S"), (1, "AH"), (0, "2S"), (1, "KH")]) == [2, 0])
check("On: result text mentions sweep", "sweep" in g.result, g.result)
hand(g, ["3S", "7S", "2D"], ["AH", "KH", "8H"])
check("On: 2-1 win no bonus", play(g, [(0, "3S"), (1, "AH"), (0, "7S"), (1, "KH"), (0, "2D"), (1, "8H")]) == [1, 0])
hand(g, ["3S", "2S", "7S"], ["3H", "KH", "8H"])
g.stake = 3
check("On: tie, 1-1, first trick decides: no sweep; stake kept", play(g, [(0, "3S"), (1, "3H"), (0, "2S"), (1, "KH"), (0, "7S"), (1, "8H")]) == [3, 0])
hand(g, ["8S", "7S", "9S"], ["AH", "KH", "8H"])
g.stake = 2
check("On: sweep adds to raised stake", play(g, [(0, "8S"), (1, "AH"), (0, "7S"), (1, "KH")]) == [0, 3])
hand(g, ["8S", "7S", "9S"], ["AH", "KH", "8H"])
g.call(0); g.answer(1, False)
check("On: fold no bonus", g.score == [1, 0], g.score)
r, g = table(True, "put")
hand(g, ["3S", "2S", "7S"], ["AH", "KH", "8H"])
check("On + Put: no bonus", play(g, [(0, "3S"), (1, "AH"), (0, "2S"), (1, "KH")]) == [1, 0])
r, g = table()
r.settings.pop("sweep", None)
g2 = pickle.loads(pickle.dumps(r)).game
hand(g2, ["3S", "2S", "7S"], ["AH", "KH", "8H"])
check("missing key = Off", play(g2, [(0, "3S"), (1, "AH"), (0, "2S"), (1, "KH")]) == [1, 0])
r, g = table(True)
hand(g, ["3S", "2S", "7S"], ["AH", "KH", "8H"])
g.play(0, "3S"); g.play(1, "AH"); g.play(0, "2S")
g3 = pickle.loads(pickle.dumps(r)).game
g3.play(1, "KH")
check("pickle mid-hand then sweep", g3.score == [2, 0], g3.score)

fired = games = 0
for seed in range(24):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(2):
        r.add_player(f"B{k}")
    r.switch_game("truc"); r.settings["sweep"] = True; r.start(); g = r.game
    lvl = ["easy", "normal", "hard"][seed % 3]
    legal = [True]
    op = g.play
    def chk(i, c, g=g, op=op, legal=legal):
        if c not in g.hands[i]:
            legal[0] = False
        return op(i, c)
    g.play = chk
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    for _ in range(3000):
        if r.phase != "playing":
            break
        if g.stage in ("play", "answer"):
            g.bot_move(g.seats.index(r.turn), lvl)
        elif g.stage == "score":
            g.deal()
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}) ends, legal", r.phase != "playing" and legal[0])
    games += 1
    fired += sum("sweeps" in m for m in msgs)
print(f"fired {fired} times in {games} games")
check("fires in bot games (>= once per game)", fired >= games, fired)
print("FAILED" if fails else "all ok")
sys.exit(1 if fails else 0)
