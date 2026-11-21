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

# --- scoring edge cases (exact numbers)
def last_trick(on, taker, jack_seat, card="JS", t7=0, belote=None):
    r, g = table(on)
    g.played = set()
    g.trump, g.taker, g.belote, g.stage = "S", taker, belote, "play"
    g.won = [[] for _ in range(4)]
    g.tricks = [0, 0, 0, t7]
    g.score = [0, 0]
    g.hands = [[], [], [], [card]]
    g.trick = [(0, "7H"), (1, "8H"), (2, "9H")]
    g.to(3)
    g.play(3, card)
    return g


for on, exp in ((False, [0, 162]), (True, [0, 182])):
    g = last_trick(on, 0, 3)
    check(f"taker fails, jack by defenders (on={on}): defenders get 162{'+20' if on else ''}", g.score == exp, g.score)
g = last_trick(True, 1, 3)
check("taker side wins last trick with jack: 30 + 20", g.score == [0, 50], g.score)
check("summary mentions the +20", "(+20 last jack)" in g.result, g.result)
g = last_trick(False, 1, 3)
check("Off: summary has no +20 note", "last jack" not in g.result, g.result)
check("same, Off: 30 (jack 20 + dix de der 10)", g.score == [0, 30], g.score)
g = last_trick(True, 1, 3, t7=7)
check("capot + jack: 252 + 20", g.score == [0, 272], g.score)
g = last_trick(False, 1, 3, t7=7)
check("capot Off: 252", g.score == [0, 252], g.score)
g = last_trick(True, 1, 3, belote=1)
check("belote + jack stack: 30 + 20 + 20", g.score == [0, 70], g.score)
g = last_trick(True, 1, 3, card="JH")
check("jack of a plain suit: no bonus", g.score == [0, 12], g.score)  # J plain = 2, +10 dix de der
g = last_trick(True, 0, 3, belote=0)
check("taker fails, belote kept by taker side goes to defenders too", g.score == [0, 202], g.score)

# --- old room: a hand in progress saved without the setting finishes as Off
random.seed(5)
r = server.Room("OLD")
for k in range(4):
    r.add_player(f"O{k}")
r.switch_game("belote"); r.start(); g = r.game
for _ in range(400):
    if g.stage == "play" and sum(len(h) for h in g.hands) < 20:
        break
    if g.stage == "score" or r.turn is None:
        g.deal()
        continue
    g.bot_move(g.seats.index(r.turn), "normal")
check("reached mid-hand", g.stage == "play" and sum(len(h) for h in g.hands) < 32)
r2 = pickle.loads(pickle.dumps(r))
r2.settings.pop("lastjack", None)
g2 = r2.game
msgs = []
om = g2.moment
g2.moment = lambda text, *a, **k: (msgs.append(text), om(text, *a, **k))[1]
sc0 = list(g2.score); h0 = g2.hand_no
for _ in range(200):
    if g2.hand_no != h0 or r2.phase != "playing" or g2.stage == "score" or r2.turn is None:
        break
    g2.bot_move(g2.seats.index(r2.turn), "normal")
check("old room: hand finishes", g2.hand_no != h0 or r2.phase != "playing" or g2.stage == "score", g2.stage)
check("old room: no jack bonus", not any("last trick with the jack" in m for m in msgs))
check("old room: score moved", g2.score != sc0)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
