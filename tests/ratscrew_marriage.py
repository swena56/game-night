"""Egyptian Ratscrew 💍 marriage: with the option on, a K and Q back to back is slappable (bots included, all
levels); off by default; slapping a non-marriage still burns; old objects and pickles load.

    python3 tests/ratscrew_marriage.py
"""
import os
import pickle
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(on, n=3, level="normal"):
    room = server.Room("TEST")
    room.add_player("Host")
    for k in range(n - 1):
        room.add_bot(level)
    room.switch_game("ratscrew")
    room.settings["marriage"] = on
    room.settings["limit"] = 0
    room.start()
    return room, room.game


room, g = table(False)
g.pile = ["7C", "KH", "QS"]
check("off by default: K Q is not slappable", g.slappable() is None)
check("schema default off", g.settings_schema["marriage"][2] is False)
room, g = table(True)
g.pile = ["7C", "KH", "QS"]
check("on: K then Q slappable", g.slappable() == "marriage")
g.pile = ["7C", "QH", "KS"]
check("on: Q then K slappable", g.slappable() == "marriage")
g.pile = ["7C", "KH", "KS"]
check("K K is a double, not a marriage", g.slappable() == "double")
g.pile = ["KH", "7C", "QS"]
check("K 7 Q is not", g.slappable() is None)
g.pile = ["QH"]
check("single card not", g.slappable() is None)
g.s["variant"] = "snap"
g.pile = ["7C", "KH", "QS"]
check("other variants ignore marriage", g.slappable() is None)
g.s["variant"] = "ratscrew"

# a human slap takes the pile
g.pile = ["7C", "KH", "QS"]
g.stage = "window"
n0 = len(g.piles[0])
g.slap(0)
check("slap takes the marriage pile", len(g.piles[0]) == n0 + 3 and not g.pile)
g.pile = ["7C", "KH", "9S"]
g.stage = "window"
n0 = len(g.piles[1])
g.slap(1)
check("wrong slap still burns", len(g.piles[1]) == n0 - 1)

# old object without the setting, and a pickle round trip
room, g = table(False)
g.s.pop("marriage", None)
g.pile = ["KH", "QS"]
check("old settings: no marriage", g.slappable() is None)
r2 = pickle.loads(pickle.dumps(room))
check("pickle round trip", r2.game.slappable() is None and r2.game.n == g.n)


# bot-vs-bot via direct seat drive (all seats auto at the given level)
import random  # noqa: E402
from games import ratscrew as R  # noqa: E402

wed = 0
games = 0
t0 = time.time()
for level in ("easy", "normal", "hard"):
    for _ in range(4):
        room, g = table(True, n=3)
        g.auto = lambda i: True
        g.level = lambda i, level=level: level
        g.room.deadline = None
        orig = g.moment
        marks = []
        g.moment = lambda text, *a, **k: (marks.append(text), orig(text, *a, **k))[1]
        steps = 0
        while room.phase == "playing" and steps < 700:
            steps += 1
            if g.stage == "window":
                if g.react:
                    g.bot_tick()
                else:
                    g.after_window()
            elif g.stage == "flip":
                i = g.seats.index(room.turn) if room.turn in g.seats else None
                if i is None:
                    break
                assert g.piles[i], "turn seat has cards"
                g.flip(i)
            else:
                break
        w = sum(1 for m in marks if "marriage" in m)
        wed += w
        games += 1
check("bots at all levels play legally", True, f"{games} games, {wed} marriage slaps by bots, {time.time()-t0:.1f}s")
check("marriages happen", wed >= 3, str(wed))

print("FAIL" if fails else "ALL OK")
sys.exit(1 if fails else 0)
