"""Oh Hell shows the dealer's forbidden bid on the score hint while bidding.

    python3 tests/ohhell_hook_note.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(3)]
room.switch_game("ohhell")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


g.stage = "bid"
g.size = 5
d = g.dealer
others = [k for k in range(g.n) if k != d]
g.bids = [None] * g.n
g.bids[others[0]], g.bids[others[1]] = 2, 1
h = g.table(ps[0], 0)["scores"]["hint"]
check("names forbidden bid", "can't bid 2" in h, h)
g.bids[others[1]] = 4
h = g.table(ps[0], 0)["scores"]["hint"]
check("dealer free when over", "dealer is free" in h, h)
g.bids[d] = 0
check("gone after dealer bids", "🪝" not in g.table(ps[0], 0)["scores"]["hint"])
g.bids = [None] * g.n
g.bids[others[0]] = 2
g.s["hook"] = False
check("off with setting", "🪝" not in g.table(ps[0], 0)["scores"]["hint"])
sys.exit(1 if fails else 0)
