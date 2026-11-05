"""Hold'em 📊 Show my odds: off by default (no number sent), on it gives each player still in their own
rough chance to win, stable across re-renders and recomputed when the board changes. Runs a real room.

    python3 tests/holdem_odds.py        # a second or two
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(odds):
    room = server.Room("TEST")
    ann, bo = (room.add_player(n) for n in ("Ann", "Bo"))
    room.switch_game("holdem")
    if odds is not None:
        room.settings["odds"] = odds
    room.start()
    g = room.game
    g.board = []
    ann.g.cards, bo.g.cards = ["AS", "AH"], ["7C", "2D"]
    for p in (ann, bo):
        p.g.folded = False
    g.in_hand = [ann.id, bo.id]
    return g, ann, bo


g, ann, bo = table(None)
check("off by default: no odds in the view", g.view(ann)["holdem"]["myOdds"] is None)

g, ann, bo = table(True)
a = g.view(ann)["holdem"]["myOdds"]
check("aces before the flop are a big favourite heads-up", isinstance(a, int) and 78 <= a <= 92, str(a))
check("the same spot shows the same number again", g.view(ann)["holdem"]["myOdds"] == a)
b = g.view(bo)["holdem"]["myOdds"]
check("7-2 is an underdog (judged against a random hand: no peeking at the aces)", isinstance(b, int) and b < 40, str(b))
g.board = ["7S", "7H", "2C"]
b2 = g.view(bo)["holdem"]["myOdds"]
check("a flop that gives 7-2 a full house makes it the favourite", b2 is not None and b2 > 90, str(b2))
bo.g.folded = True
check("no odds once everyone else has folded", g.view(ann)["holdem"]["myOdds"] is None)
check("no odds for a folded player", g.view(bo)["holdem"]["myOdds"] is None)

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
