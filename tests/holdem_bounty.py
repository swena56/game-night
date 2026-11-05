"""Hold'em 🎯 Bounties (off by default): whoever wins the pot that knocks a player out collects 10% of the
starting chips. An all-in run-out records where it started (`runout`), so the page deals the rest slowly,
and the next hand waits for it.

    python3 tests/holdem_bounty.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def showdown(bounty):
    room = server.Room("TEST")
    ps = [room.add_player(n) for n in ("Ann", "Bo", "Cy")]
    room.switch_game("holdem")
    if bounty is not None:
        room.settings["bounty"] = bounty
    room.start()
    g = room.game
    ann, bo, cy = ps
    g.board = ["9S", "9H", "2C", "7D", "KC"]
    ann.g.cards, bo.g.cards = ["9D", "9C"], ["KH", "3S"]
    for p in (ann, bo):
        p.g.folded = False
        p.g.put = 100
    bo.g.chips = 0          # Bo is all in for his last 100
    ann.g.chips = 500
    g.in_hand = [ann.id, bo.id]
    return room, g, ann, bo, cy


room, g, ann, bo, cy = showdown(None)
g.payout()
check("off by default: just the pot", ann.g.chips == 700 and bo.eliminated, ann.g.chips)

room, g, ann, bo, cy = showdown(True)
g.payout()
check("on: the pot plus a bounty of 10% of the start", ann.g.chips == 700 + g.s["chips"] // 10, ann.g.chips)
check("the log says so", any("Bounty" in e["text"] for e in room.log[-4:]))

# run-out marker
room = server.Room("TEST")
ann, bo = (room.add_player(n) for n in ("Ann", "Bo"))
room.switch_game("holdem")
room.start()
g = room.game
check("no run-out on a new hand", g.view(ann)["holdem"]["runout"] is None)
g.stage = "preflop"
g.board = []
t0 = time.time()
g.run_out()
v = g.view(ann)["holdem"]
check("an all-in pre-flop runs out from 0", v["runout"] == 0 and len(v["board"]) == 5, v["runout"])
check("the next hand waits for the slow deal", room.deadline is None or room.deadline - t0 > 5, room.deadline and round(room.deadline - t0, 1))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
