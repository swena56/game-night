"""Belote 🃏 last jack: win the last trick with the trump jack for +20 (setting "lastjack", default Off);
Off scores nothing extra; missing setting key works; pickle round trip; bots play legal cards in full games
and the bonus fires at a measurable rate.

    python3 tests/belote_lastjack.py
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
    r.switch_game("belote")
    if on is not None:
        r.settings["lastjack"] = on
    r.start()
    return r, r.game


def final(g, jack_seat):
    """Last trick: seat 0 leads, jack_seat's team wins it with the trump jack (spades)."""
    g.played = set()
    g.trump, g.taker, g.belote, g.stage = "S", 0, None, "play"
    g.won = [[] for _ in range(4)]
    g.tricks = [0, 0, 0, 0]
    g.score = [0, 0]
    g.hands = [[], [], [], []]
    g.trick = [(0, "7H"), (1, "8H"), (2, "9H")]
    g.hands[3] = ["JS"] if jack_seat == 3 else ["AH"]
    g.to(3)
    g.play(3, g.hands[3][0])


r, g = table()
check("default is Off", g.s["lastjack"] is False)
final(g, 3)
check("Off: no bonus", g.score == [0, 162], g.score)
base = list(g.score)

r, g = table(True)
final(g, 3)
check("On: bonus lands on the winning side", g.score != base, (g.score, base))

# non-jack winner: no bonus
r, g = table(True)
g.trump = "S"
final(g, 0)
check("no jack, no bonus", g.score == base, (g.score, base))

# missing key / pickle
r, g = table()
r.settings.pop("lastjack", None)
g2 = pickle.loads(pickle.dumps(r)).game
final(g2, 3)
check("missing key works as Off", g2.score == base, g2.score)

fired, games, boundary = 0, 0, 0
for seed in range(24):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(4):
        r.add_player(f"B{k}")
    r.switch_game("belote"); r.settings["lastjack"] = True; r.settings["target"] = 501; r.start(); g = r.game
    orig_play = g.play
    def chk(i, c, g=g, orig=orig_play):
        assert c in g.legal(i), (i, c)
        return orig(i, c)
    g.play = chk
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    lvl = ["easy", "normal", "hard"][seed % 3]
    hands = 0
    for _ in range(3000):
        if r.phase != "playing":
            break
        if g.stage in ("bid", "play"):
            g.bot_move(g.seats.index(r.turn), lvl)
        elif g.stage == "score":
            g.deal()
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}): game ends", r.phase != "playing")
    games += 1
    fired += sum("last trick with the jack" in m for m in msgs)
print(f"fired {fired} times in {games} games")
check("bonus fires in bot games", fired >= games / 10 and fired > 0, fired)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
