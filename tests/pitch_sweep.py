"""Pitch 🧹 sweep: taking all four points (High, Low, Jack, Game) scores 2 bonus points (setting "sweep", on by
default); Off or a split hand scores plain points; old rooms load; bot games fire it.

    python3 tests/pitch_sweep.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import pitch  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(on=None, n=2, teams=False):
    r = server.Room("TEST")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("pitch")
    if on is not None:
        r.settings["sweep"] = on
    if teams:
        r.settings["teams"] = True
    r.start()
    return r, r.game


def rig(g, sweep):
    g.trump = "H"
    g.bidder, g.bid = 0, 3
    g.dealt = [["AH", "JH", "2H", "KC", "TC", "3D"], ["4H", "QS", "5S", "6S", "7S", "8S"]]
    g.won = [["AH", "JH", "2H", "KC", "TC"], ["QS"]] if sweep else [["AH", "4H", "KC", "TC"], ["JH", "2H", "QS"]]
    g.score = [0, 0]


r, g = table(); rig(g, True); g.end_hand()
check("sweep: 4 points + 2 bonus (default)", g.score == [6, 0], g.score)
r, g = table(); rig(g, False); g.end_hand()
check("split hand: no bonus", g.score == [3, 1], g.score)
r, g = table(False); rig(g, True); g.end_hand()
check("Off: plain 4 points", g.score == [4, 0], g.score)
r, g = table(); g.s.pop("sweep", None); rig(g, True)
g2 = pickle.loads(pickle.dumps(r)).game
rig(g2, True); g2.end_hand()
check("old object (no key) pickles and defaults on", g2.score == [6, 0], g2.score)
check("howto mentions the option", any("option" in h for h in pitch.Pitch.howto))

# edge cases: "all four" means High, Low, Jack and Game all won by one side (pts == 4)
def hand(n, dealt, won, bidder, bid, on=None, teams=False):
    r, g = table(on, n, teams)
    g.trump = "H"
    g.bidder, g.bid = bidder, bid
    g.dealt = dealt
    g.won = won
    g.score = [0] * g.sides
    g.end_hand()
    return g

# jack not dealt: only 3 points exist, a clean 3 never sweeps
g = hand(2, [["AH", "2H", "KC", "TC", "3D", "5D"], ["4S", "QS", "5S", "6S", "7S", "8S"]],
         [["AH", "2H", "KC", "TC", "3D"], ["QS"]], 0, 3)
check("jack not out: no sweep, 3 plain points", g.score == [3, 0], g.score)
# tied Game points: the Game point is not awarded, so 3 max
g = hand(2, [["AH", "JH", "2H", "KC", "3D", "5D"], ["4S", "QS", "5S", "6S", "7S", "8S"]],
         [["AH", "JH", "2H", "KC", "QS"], ["TC"]], 0, 2)
check("tied Game: no sweep", g.score == [3, 0] and "Game" not in g.result["got"], (g.score, g.result))
# three players: every point to different players, nothing sweeps; and a 3-way sweep works
g = hand(3, [["AH", "JH", "KC", "TC"], ["2H", "4S"], ["5S", "6S"]],
         [["AH", "KC", "TC"], ["2H"], ["JH"]], 0, 2)
check("3 players split: no bonus", g.score == [2, 1, 1], g.score)
g = hand(3, [["AH", "JH", "2H", "KC"], ["4S", "QS"], ["5S", "6S"]],
         [["AH", "JH", "2H", "KC", "TC"], ["QS"], []], 1, 2)
check("3 players, defender sweeps: set bidder -2, sweeper 4+2", g.score == [6, -2, 0], g.score)
# bidder sweeps and makes a 4 bid; bonus on top
g = hand(2, [["AH", "JH", "2H", "KC"], ["4S", "QS"]], [["AH", "JH", "2H", "KC", "TC"], ["QS"]], 0, 4)
check("bidder sweeps a 4 bid: 4 + 2", g.score == [6, 0], g.score)
# defenders sweep: bidder is set (minus bid) and the sweeper gets 4 + 2
g = hand(2, [["4S", "QS"], ["AH", "JH", "2H", "KC"]], [["QS"], ["AH", "JH", "2H", "KC", "TC"]], 0, 3)
check("defender sweep sets the bidder: -3 / 6", g.score == [-3, 6], g.score)
# 4 players, teams: partner cards count for the side
g = hand(4, [["AH", "2H"], ["4S", "QS"], ["JH", "KC"], ["5S", "6S"]],
         [["AH", "2H"], ["QS"], ["JH", "KC", "TC"], []], 0, 3, teams=True)
check("teams: pair sweeps together", g.score[0] == 6 and g.score[1] == 0, g.score)

# real bot games at every level: every bid and card legal, no swallowed exceptions, sweeps fire
real = pitch.Pitch.end_hand
real_play, real_bid = pitch.Pitch.play, pitch.Pitch.place_bid
st = {"sweeps": 0, "hands": 0, "bad": []}
def spy(self):
    real(self)
    st["hands"] += 1
    if len(self.result["got"]) == 4 and len(set(self.result["got"].values())) == 1:
        st["sweeps"] += 1
def play(self, i, c):
    if c not in self.legal(i):
        st["bad"].append(("card", c))
    return real_play(self, i, c)
def bid(self, i, b):
    if b not in self.bid_options(i):
        st["bad"].append(("bid", b))
    return real_bid(self, i, b)
pitch.Pitch.end_hand, pitch.Pitch.play, pitch.Pitch.place_bid = spy, play, bid
import time
t0 = time.time()
done = games = 0
errs = []
try:
    for level in ("easy", "normal", "hard"):
        for n in range(40):
            if time.time() - t0 > 90 or (n >= 3 and (st["sweeps"] or level != "hard")):
                break
            r, g = table(n=2 + n % 3, teams=n % 3 == 2 and n % 2 == 0)
            games += 1
            steps = 0
            try:
                while r.phase == "playing" and steps < 5000:
                    if g.after:
                        g.on_timeout()
                        continue
                    g.bot_move(g.seats.index(r.turn), level)
                    steps += 1
            except Exception as e:  # noqa: BLE001
                errs.append(f"{level}: {e!r}")
            done += r.phase == "over"
finally:
    pitch.Pitch.end_hand, pitch.Pitch.play, pitch.Pitch.place_bid = real, real_play, real_bid
check("bot games finish (easy, normal, hard)", done == games and not errs, f"{done}/{games} {errs[:2]}")
check("every bot bid and card legal", not st["bad"], st["bad"][:3])
check("a sweep fires in bot games", st["sweeps"] > 0, f"{st['sweeps']} in {games} games / {st['hands']} hands")
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
