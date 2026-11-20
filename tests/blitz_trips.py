"""Blitz three of a kind: counts 30 (option, default on); callout at showdown; bots play legal games on all levels.

    python3 tests/blitz_trips.py
"""
import os
import sys
import pickle

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import blitz  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(trips=None, n=3):
    r = server.Room("TEST")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("blitz")
    if trips is not None:
        r.settings["trips"] = trips
    r.start()
    return r, r.game


check("value: trips 30", blitz.value(["7C", "7D", "7H"], True) == 30 and blitz.value(["7C", "7D", "7H"]) == 7)
check("value: ace trips 30, not 31", blitz.value(["AC", "AD", "AH"], True) == 30)
check("value: 4 cards never trips", blitz.value(["7C", "7D", "7H", "2S"], True) < 30)
check("value: suit total beats 30 never", blitz.value(["AC", "KC", "QC"], True) == 31)

r, g = table()
check("default on", g.val(["9C", "9D", "9S"]) == 30)
r, g = table(trips=0)
check("off by setting", g.val(["9C", "9D", "9S"]) == 9)

# showdown: trips holder wins the knock and a callout fires; off gives no callout
for setting, want in ((None, 1), (0, 0)):
    r, g = table(setting)
    seen = []
    g.moment = lambda text, *a, **k: seen.append(text)
    g.hands = [["9C", "9D", "9S"], ["2C", "3D", "5H"], ["KC", "4D", "6H"]]
    g.knocker = 0
    g.showdown()
    n = sum(1 for t in seen if t.startswith("🎰"))
    check(f"showdown callout x{want} (setting {setting})", n == want, str(seen))
    if want:
        check("lowest lost the life, trips safe", g.lives[0] == 3 and g.lives[1] == 2 and g.lives[2] == 3)

# old object / pickle round trip
r, g = table()
g2 = pickle.loads(pickle.dumps(r)).game
check("pickle round trip", g2.val(["9C", "9D", "9S"]) == 30)

# real bot games, easy/normal/hard, legal moves; callout fires
fired = 0
games = 0
real_throw, real_draw = blitz.Blitz.throw, blitz.Blitz.draw
real_moment = blitz.Blitz.moment


def throw(self, i, c):
    assert c in self.hands[i] and c != self.took and self.stage == "discard", c
    return real_throw(self, i, c)


def draw(self, i, src):
    assert self.stage == "draw" and src in ("stock", "discard")
    return real_draw(self, i, src)


def moment(self, text, *a, **k):
    global fired
    if text.startswith("🎰"):
        fired += 1
    return real_moment(self, text, *a, **k)


blitz.Blitz.throw, blitz.Blitz.draw, blitz.Blitz.moment = throw, draw, moment
done = 0
try:
    for n in range(300):
        if n >= 20 and fired:
            break
        r, g = table(n=3 + n % 2)
        lv = [("easy", "normal", "hard", "hard")[(k + n) % 4] for k in range(g.n)]
        steps = 0
        while r.phase == "playing" and steps < 6000:
            if getattr(g, "after", None):
                g.on_timeout()
                continue
            i = g.seats.index(r.turn)
            g.bot_move(i, lv[i])
            steps += 1
        if r.phase == "over":
            done += 1
        games += 1
finally:
    blitz.Blitz.throw, blitz.Blitz.draw, blitz.Blitz.moment = real_throw, real_draw, real_moment
check("bot games finish", done == games, f"{done}/{games}")
check("trips callout fires in bot games", fired > 0, f"{fired} in {games} games")
# the "Your hand" note names the trips instead of a suit; a tie with a 30 suit total loses nothing extra
for setting, want in ((None, True), (0, False)):
    r, g = table(setting)
    g.hands[0] = ["9C", "9D", "9S"]
    note = g.table(g.pl(0), 0)["note"]
    check(f"note trips (setting {setting})", ("30 (three 9s)" in note) == want, note)
r, g = table()
g.hands = [["9C", "9D", "9S"], ["KC", "QC", "KD"], ["2C", "3D", "5H"]]
g.knocker = 0
g.showdown()
check("trips 30 ties suit 30: both safe, lowest loses", g.lives == [3, 3, 2], str(g.lives))

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
