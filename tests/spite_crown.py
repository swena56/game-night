"""Spite & Malice 👑 Queen bonus: finishing a middle pile (ace to queen) draws the finisher one bonus card
from the stock (setting "crown", on by default); Off or an empty stock draws nothing; old rooms load;
easy/normal/hard bots finish full games through the real move path and the bonus fires.

    python3 tests/spite_crown.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(on=None, n=2):
    r = server.Room("TEST")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("spite")
    if on is not None:
        r.settings["crown"] = on
    r.start()
    return r, r.game


def near_queen(g, stock=("2C", "3C")):
    g.center = [[("AH", 1)] * 0 + [("5H", k + 1) for k in range(11)]]
    g.hands[0] = ["QD", "4S", "4C", "4D", "4H"]
    g.stock = list(stock)
    g.done = []
    g.to(0)
    g.stage = "play"


for on in (None, False):
    tag = "on" if on is None else "off"
    r, g = table(on)
    near_queen(g)
    g.build(0, "QD", 0)
    want = 5 if on is None else 4
    check(f"[{tag}] hand after finishing a pile", len(g.hands[0]) == want, len(g.hands[0]))
    check(f"[{tag}] pile cleared", g.center == [])
    check(f"[{tag}] callout only when on", any("bonus card" in e["text"] for e in r.log) == (on is None))
r, g = table()
near_queen(g, stock=())
g.build(0, "QD", 0)
check("empty stock: no bonus, no crash", len(g.hands[0]) == 4)
r, g = table()
near_queen(g)
g.hands[0] = ["QD"]
g.build(0, "QD", 0)
check("emptied hand still refills to 5 (+1 bonus)", len(g.hands[0]) >= 5, len(g.hands[0]))

r, g = table()
r.settings.pop("crown", None)
g.s.pop("crown", None)
g2 = pickle.loads(pickle.dumps(r)).game
near_queen(g2)
g2.build(0, "QD", 0)
check("old object (no key) works, default on", len(g2.hands[0]) == 5)

from games import spite  # noqa: E402
fires, games = 0, 0
real_moment = spite.Spite.moment
def mom(self, text, *a, **k):
    global fires
    if "bonus card" in text:
        fires += 1
    return real_moment(self, text, *a, **k)
spite.Spite.moment = mom
real_build = spite.Spite.build
def build(self, i, src, dst):
    c = self.top(i, src)
    assert c and dst in self.fits(c), (src, dst)
    return real_build(self, i, src, dst)
spite.Spite.build = build
try:
    for n in range(12):
        for lv in ("easy", "normal", "hard"):
            r, g = table(n=2)
            steps = 0
            while r.phase == "playing" and steps < 3000:
                g.bot_move(g.seats.index(r.turn), lv)
                steps += 1
            check(f"{lv} bot game {n} finishes", r.phase == "over", steps) if r.phase != "over" else None
            games += 1
        if n >= 5 and fires:
            break
finally:
    spite.Spite.moment, spite.Spite.build = real_moment, real_build
check("bonus fires in bot games", fires > 0, f"{fires} in {games} games")
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
