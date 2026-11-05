"""Hold'em showdown payout: the pot goes to the best hand, and a four-of-a-kind win earns the 💎 badge
(the pot-paying method used to shadow Game.award, so this showdown raised a TypeError). Runs a real room.

    python3 tests/holdem_payout.py        # well under a second
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


room = server.Room("TEST")
ann, bo = (room.add_player(n) for n in ("Ann", "Bo"))
room.switch_game("holdem")
room.start()
g = room.game
# a stacked showdown: Ann holds quad nines, Bo a pair of kings; both put 100 in
g.board = ["9S", "9H", "2C", "7D", "KC"]
ann.g.cards, bo.g.cards = ["9D", "9C"], ["KH", "3S"]
for p in (ann, bo):
    p.g.folded = False
    p.g.put = 100
g.in_hand = [ann.id, bo.id]
before = {p.id: p.g.chips for p in (ann, bo)}
try:
    g.payout()
    crashed = None
except Exception as e:  # noqa: BLE001
    crashed = repr(e)
check("showdown with quads pays out without error", crashed is None, crashed or "")
check("the pot goes to the quads", ann.g.chips - before[ann.id] == 200 and bo.g.chips == before[bo.id],
      f"Ann +{ann.g.chips - before[ann.id]}, Bo +{bo.g.chips - before[bo.id]}")
check("the winning five are the quads and the king", sorted(g.best5) == sorted(["9S", "9H", "9D", "9C", "KC"]), str(g.best5))
check("💎 Monster hand badge awarded", (getattr(ann, "badges", None) or {}).get("holdem:quads") == 1)
check("the loser gets no badge", not (getattr(bo, "badges", None) or {}).get("holdem:quads"))

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
