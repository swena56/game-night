"""Big Two: when a rival is down to one card the play note warns, using only public card counts.

    python3 tests/bigtwo_last_card.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(3)]
room.switch_game("bigtwo")
room.start()
g = room.game
p = next(x for x in ps if x.id == room.turn)
i = g.seat(p)
fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


g.stage = "play"
g.first = False
g.lastplay = None
other = next(k for k in range(g.n) if k != i)
check("quiet at start", "ONE card" not in g.table(p, i)["note"])
g.hands[other] = g.hands[other][:1]
n = g.table(p, i)["note"]
check("lead warning", "lead pairs or runs" in n, n)
g.lastplay = (other, [g.hands[i][0]])
n = g.table(p, i)["note"]
check("single warning", "could go out" in n, n)
sys.exit(1 if fails else 0)
