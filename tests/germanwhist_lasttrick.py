"""German Whist 🏁 last trick: the winner of the final counted trick scores a bonus 1 (setting "lasttrick",
on by default); Off scores nothing extra; old-style object without the field works; pickle round trip; bots
play full games through the real move path (legal cards) and the bonus really fires.

    python3 tests/germanwhist_lasttrick.py
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


def table(on=None, hands=1):
    random.seed(5)
    r = server.Room("TEST")
    for k in range(2):
        r.add_player(f"P{k}")
    r.switch_game("germanwhist")
    r.settings["hands"] = hands
    if on is not None:
        r.settings["lasttrick"] = on
    r.start()
    return r, r.game


def last_trick(g, on_seat_wins):
    """Set up the final counted trick: seat 0 leads a high spade vs seat 1's low one."""
    g.stage, g.phase, g.stock, g.trump = "play", 2, [], "H"
    g.counted, g.tricks, g.scores = [7, 5], [7, 5], [0, 0]
    g.hands = [["AS"] if on_seat_wins == 0 else ["2S"], ["2S"] if on_seat_wins == 0 else ["AS"]]
    g.trick, g.lastwin = [], None
    g.to(0)
    g.play(0, g.hands[0][0])
    g.play(1, g.hands[1][0])


for on in (None, False):
    tag = "on" if on is None else "off"
    r, g = table(on)
    last_trick(g, 1)            # seat 1 takes the last trick, counted 7-6: seat 0 wins the hand by 1
    exp = [1, 1 if on is None else 0]
    check(f"[{tag}] scores", g.scores == exp, g.scores)
    check(f"[{tag}] lastwin", g.lastwin == (1 if on is None else None), g.lastwin)

# old-style object: no lastwin attribute, setting key absent
r, g = table()
g.__dict__.pop("lastwin", None)
r.settings.pop("lasttrick", None)
g2 = pickle.loads(pickle.dumps(r)).game
check("old object loads, class default None", g2.lastwin is None)
g2.stage = "score"; g2.counted = [8, 5]; g2.scores = [0, 0]; g2.hand_no = 99
g2.end_hand()
check("old object scores plain diff", g2.scores == [3, 0], g2.scores)
r, g = table()
last_trick(g, 0)
g3 = pickle.loads(pickle.dumps(r)).game
check("pickle keeps lastwin", g3.lastwin == 0 and g3.scores[0] == 4, (g3.lastwin, g3.scores))

# bots: full games, legal cards, bonus fires
fired = 0
for seed in range(6):
    random.seed(seed)
    r = server.Room("B%d" % seed)
    for k in range(2):
        r.add_player(f"B{k}")
    r.switch_game("germanwhist"); r.settings["hands"] = 2; r.start(); g = r.game
    orig = g.play
    def chk(i, c, g=g, orig=orig):
        assert c in g.legal(i), (i, c)
        return orig(i, c)
    g.play = chk
    for _ in range(200):
        if r.phase != "playing":
            break
        if g.stage == "play":
            before = list(g.scores)
            g.bot_move(g.seats.index(r.turn), random.choice(["easy", "normal", "hard"]))
            if g.lastwin is not None and g.stage == "score" or (r.phase != "playing" and g.lastwin is not None):
                fired += 1
        elif g.stage == "score":
            g.deal()
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed}: game ends", r.phase != "playing")
check("bonus fired in bot games", fired > 0, fired)

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
