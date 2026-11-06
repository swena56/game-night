"""Hearts 🌙 Shooter's choice (off by default: everyone else +26). With it on, a moon shot takes −26 off the
shooter's score unless +26 to the rest ends the game with the shooter lowest, or the shooter already leads.
The view also says who holds the Q♠ (and the J♦) this hand.

    python3 tests/hearts_moon.py
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


ALL = ["QS"] + [r + "H" for r in "23456789TJQKA"]


def table(moon, scores):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy", "Di")]
    r.switch_game("hearts")
    if moon is not None:
        r.settings["moon"] = moon
    r.start()
    g = r.game
    g.scores = list(scores)
    g.taken = [list(ALL), [], [], []]
    return r, g, ps


r, g, ps = table(None, [40, 30, 30, 30])
check("view: who holds the Q♠", g.view(ps[1])["hearts"]["queenAt"] == 0)
g.end_hand()
check("default: everyone else +26", g.scores == [40, 56, 56, 56], g.scores)

r, g, ps = table("choice", [40, 30, 30, 30])
g.end_hand()
check("choice, trailing: −26 for the shooter", g.scores == [14, 30, 30, 30], g.scores)

r, g, ps = table("choice", [20, 30, 40, 50])
g.end_hand()
check("choice, leading: +26 to the rest", g.scores == [20, 56, 66, 76], g.scores)

r, g, ps = table("choice", [60, 50, 80, 70])
g.end_hand()
check("choice: +26 ends the game with the shooter lowest", r.phase == "over" and r.winner == g.seats[0], (g.scores, r.phase))

r, g, ps = table("choice", [90, 50, 80, 70])
g.end_hand()
check("choice: never hands the game to someone else", r.phase == "playing" and g.scores[0] == 64, g.scores)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
