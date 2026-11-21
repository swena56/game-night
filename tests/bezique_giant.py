"""Bezique giant killer: trump a plain ace/ten with a 7/8/9 of trumps for +10 (setting "giant", default Off).
Exact scoring, Off/missing key, pickle mid-hand, legal bot moves on easy/normal/hard, firing rate.

    python3 tests/bezique_giant.py
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


def table(on=None, tag="G"):
    r = server.Room(tag)
    for k in range(2):
        r.add_player(f"P{k}")
    r.switch_game("bezique")
    if on is not None:
        r.settings["giant"] = on
    r.start()
    return r, r.game


def trick(g, lead, follow):
    """Seat 0 leads `lead`, seat 1 follows `follow` (trumps are spades, stock phase)."""
    g.trump, g.phase, g.stage, g.score = "S", 1, "play", [0, 0]
    g.laid, g.trick = [[], []], []
    g.hands = [[lead, "9D", "8D"], [follow, "7D", "8C"]]
    g.to(0)
    g.play_key(0, lead)
    g.play_key(1, follow)
    return g.score


r, g = table()
check("default Off", g.s["giant"] is False)
check("Off: no bonus", trick(g, "AH", "7S") == [0, 0])
r, g = table(True)
check("On: 7 of trumps takes a plain ace +10", trick(g, "AH", "7S") == [0, 10])
check("On: 9 of trumps takes a ten +10", trick(g, "TH", "9S") == [0, 10])
check("On: low trump led, plain ace thrown on it: +10 to leader", trick(g, "7S", "AH") == [10, 0])
check("On: trump king over ace: no bonus", trick(g, "AH", "KS") == [0, 0])
check("On: low trump over plain king: no bonus", trick(g, "KH", "7S") == [0, 0])
check("On: plain 7 can't win, none", trick(g, "AH", "7H") == [0, 0])
check("On: leader's low trump beats nothing special", trick(g, "7S", "7D") == [0, 0])
r, g = table()
r.settings.pop("giant", None)
g2 = pickle.loads(pickle.dumps(r)).game
check("missing key = Off", trick(g2, "AH", "7S") == [0, 0])
r, g = table(True)
g.trump, g.phase, g.stage, g.score, g.trick = "S", 1, "play", [0, 0], []
g.hands = [["AH", "9D"], ["7S", "8C"]]
g.to(0); g.play_key(0, "AH")
g3 = pickle.loads(pickle.dumps(r)).game
g3.play_key(1, "7S")
check("pickle mid-trick then bonus", g3.score == [0, 10], g3.score)

fired = games = 0
for seed in range(18):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(2):
        r.add_player(f"B{k}")
    r.switch_game("bezique"); r.settings["giant"] = True; r.settings["target"] = 500; r.start(); g = r.game
    orig = g.play_key
    def chk(i, key, g=g, orig=orig):
        assert key in g.legal_keys(i), (i, key)
        return orig(i, key)
    g.play_key = chk
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    lvl = ["easy", "normal", "hard"][seed % 3]
    for _ in range(4000):
        if r.phase != "playing":
            break
        if g.stage in ("play", "meld"):
            g.bot_move(g.seats.index(r.turn), lvl)
        elif g.stage == "score":
            g.deal()
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}) ends", r.phase != "playing")
    games += 1
    fired += sum("trumps the" in m for m in msgs)
print(f"fired {fired} times in {games} games")
check("fires in bot games (>= once per game)", fired >= games, fired)

# hard bot: saves a low trump for a plain ace/ten when giant is On; still trumps the ace
def bot_reply(on, led, hand):
    r, g = table(on)
    g.trump, g.phase, g.stage, g.score = "S", 1, "play", [0, 0]
    g.laid, g.trick = [[], []], []
    g.hands = [[led, "9D"], hand]
    g.to(0)
    g.play_key(0, led)
    g.bot_move(1, "hard")
    return g.last["cards"][1][1]


check("hard, On: trump 7 over an ace", bot_reply(True, "AH", ["7S", "KH", "8C"]) == "7S")
check("hard, On: led king, wins with the ace of the suit, not the 7",
      bot_reply(True, "KH", ["7S", "AH", "8C"]) != "7S")
check("hard, On: low trump not spent on a plain king", bot_reply(True, "QH", ["7S", "8C", "9C"]) != "7S")
print("FAILED" if fails else "all ok")
sys.exit(1 if fails else 0)
