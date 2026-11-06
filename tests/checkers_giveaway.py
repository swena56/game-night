"""Checkers 🎁 Giveaway (off by default): the side left with no pieces or no move wins; bots play to lose
their pieces and finish the game.

    python3 tests/checkers_giveaway.py
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


def game(win):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("checkers")
    if win is not None:
        r.settings["win"] = win
    r.start()
    return r, r.game


def endgame(g, r):
    """Dark's last man takes light's last man: light has nothing left."""
    b = [[""] * 8 for _ in range(8)]
    b[5][2], b[4][3] = "d", "l"
    g.board = b
    dark = next(p for p in r.seated() if g.side(p) == "d")
    r.turn = dark.id
    g.play(dark, [(5, 2), (3, 4)])
    return dark


r, g = game(None)
dark = endgame(g, r)
check("classic: taking the last piece wins", r.phase == "over" and r.winner == dark.id)
r, g = game("give")
dark = endgame(g, r)
light = next(p for p in r.seated() if p is not dark)
check("giveaway: the side with nothing left wins", r.phase == "over" and r.winner == light.id)

r, g = game("give")
for p in r.seated():
    p.bot = "easy"
for _ in range(300):
    if r.phase != "playing":
        break
    g.bot_turn(r.players[r.turn])
check("easy bots finish a Giveaway game", r.phase == "over")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
