"""Pinochle 🧹 romp: a side that takes 10+ of the twelve tricks scores +20 (setting "romp", default Off).
Exact scoring cases, Off/missing key, pickle round trip, bots play legal in full games and the romp fires.

    python3 tests/pinochle_romp.py
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


def table(on=None, tag="T"):
    r = server.Room(tag)
    for k in range(4):
        r.add_player(f"P{k}")
    r.switch_game("pinochle")
    if on is not None:
        r.settings["romp"] = on
    r.start()
    return r, r.game


def hand_end(on, bidder, bid, t0, t1, meld=(10, 0, 0, 0), start=(0, 0)):
    """Finish a hand where seats 0/2 won t0 tricks and 1/3 won t1; each trick counts as 2 'ATK' cards."""
    r, g = table(on)
    g.pause = lambda *a, **k: None
    g.stage, g.trump, g.bidder, g.bid = "play", "S", bidder, bid
    g.score = list(start)
    g.melds = [(m, []) for m in meld]
    g.won = [["AS"] * t0, ["AH"] * t1, [], []]   # 1 point per card
    g.tricks = [t0, t1, 0, 0]
    g.last = {"winner": 0 if t0 else 1, "cards": []}
    g.end_hand()
    return g


check("default Off", table()[1].s["romp"] is False)
g = hand_end(False, 0, 20, 12, 0)
check("Off: romp pays nothing extra (10 meld + 13)", g.score == [23, 0], g.score)
g = hand_end(True, 0, 20, 12, 0)
check("On: bidders romp +20", g.score == [43, 0], g.score)
check("summary mentions it", "+20 romp" in g.result, g.result)
g = hand_end(True, 0, 20, 9, 3)
check("9 tricks: no bonus", g.score == [20, 3], g.score)
g = hand_end(True, 0, 20, 10, 2)
check("10 tricks is a romp", g.score == [10 + 11 + 20, 2], g.score)
g = hand_end(True, 1, 20, 12, 0)
check("defenders romp a bidder who is set: +20 and bid lost", g.score == [43, -20], g.score)
g = hand_end(True, 0, 100, 12, 0, meld=(10, 0, 0, 0))
check("bidders romp but still miss a huge bid: no bonus", g.score == [-100, 0], g.score)
g = hand_end(True, 0, 20, 0, 12)
check("defenders romp, bidders took 0: set, bonus for defenders", g.score == [-20, 20 + 13], g.score)
g = hand_end(True, 0, 20, 12, 0, start=(140, 0))
check("romp points count toward the target", g.room.phase != "playing" and g.score == [183, 0], (g.room.phase, g.score))

r, g = table()
r.settings.pop("romp", None)
g = pickle.loads(pickle.dumps(r)).game
check("missing key works as Off", g.s.get("romp", False) is False)

fired, games = 0, 0
for seed in range(18):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(4):
        r.add_player(f"B{k}")
    r.switch_game("pinochle"); r.settings["romp"] = True; r.settings["target"] = 100; r.start(); g = r.game
    orig_play = g.play
    g.play = lambda i, c, g=g, orig=orig_play: (c in g.legal(i) or (_ for _ in ()).throw(AssertionError((i, c)))) and orig(i, c)
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    lvl = ["easy", "normal", "hard"][seed % 3]
    pickled = False
    for _ in range(4000):
        if r.phase != "playing":
            break
        if g.stage in ("bid", "trump", "play"):
            g.bot_move(g.seats.index(r.turn), lvl)
        elif g.stage == "score":
            g.deal()
        if not pickled and g.stage == "play" and len(g.hands[0]) == 6:
            saved = {k: g.__dict__.pop(k) for k in ("play", "moment") if k in g.__dict__}
            r2 = pickle.loads(pickle.dumps(r))
            g.__dict__.update(saved)
            check("mid-hand pickle round trip", r2.game.hands == g.hands and r2.game.s["romp"] is True)
            pickled = True
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}): game ends", r.phase != "playing")
    games += 1
    fired += sum("romp home" in m for m in msgs)
print(f"fired {fired} times in {games} games")
check("romp fires in bot games", fired >= games / 10 and fired > 0, fired)
sys.exit(1 if fails else 0)
