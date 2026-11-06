"""Go ⚔️ Atari Go (off by default): the first capture wins; in normal Go a capture just counts.

    python3 tests/go_atari.py
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


def corner(variant):
    """White stone in the corner, black on one side: black captures with the other."""
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("go")
    if variant:
        r.settings["variant"] = variant
    r.start()
    g = r.game
    black, white = (r.players[i] for i in g.seats)
    g.act(black, {"type": "move", "r": 0, "c": 1})
    g.act(white, {"type": "move", "r": 0, "c": 0})
    g.act(black, {"type": "move", "r": 1, "c": 0})
    return r, g, black


r, g, black = corner(None)
check("normal Go: a capture plays on", r.phase == "playing" and g.board[0][0] is None)
r, g, black = corner("atari")
check("Atari Go: the first capture wins", r.phase == "over" and r.winner == black.id)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
