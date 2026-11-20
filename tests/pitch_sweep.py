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


def table(on=None, n=2):
    r = server.Room("TEST")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("pitch")
    if on is not None:
        r.settings["sweep"] = on
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

# real bot games: every move legal, sweeps fire
real = pitch.Pitch.end_hand
st = {"sweeps": 0, "hands": 0}
def spy(self):
    b = list(self.score)
    real(self)
    st["hands"] += 1
    if len(self.result["got"]) == 4 and len(set(self.result["got"].values())) == 1:
        st["sweeps"] += 1
pitch.Pitch.end_hand = spy
done = games = 0
try:
    for n in range(60):
        if n >= 6 and st["sweeps"]:
            break
        r, g = table(n=2 + n % 3)
        games += 1
        steps = 0
        while r.phase == "playing" and steps < 5000:
            if g.after:
                g.on_timeout()
                continue
            i = g.seats.index(r.turn)
            if g.stage == "play":
                pass
            g.bot_move(i, "hard")
            steps += 1
        done += r.phase == "over"
finally:
    pitch.Pitch.end_hand = real
check("bot games finish", done == games, f"{done}/{games}")
check("a sweep fires in bot games", st["sweeps"] > 0, f"{st['sweeps']} in {games} games / {st['hands']} hands")
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
