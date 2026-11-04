"""Night Heist: the 🕵️ inside man (an option) tells you, once a game and before you choose, how many of the
players who have already chosen are grabbing. Runs a real room.

    python3 tests/heist_rules.py        # well under a second
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError:
        return True
    return False


def new_room(tip):
    room = server.Room("TEST")
    ps = [room.add_player(n) for n in ("Ann", "Bo", "Cy")]
    room.switch_game("heist")
    room.settings["tip"] = tip
    room.start()
    return room, ps, room.game


room, (ann, bo, cy), g = new_room(tip=False)
check("off by default", room.settings.get("tip") is False and refused(g, ann, {"type": "tip"}))

room, (ann, bo, cy), g = new_room(tip=True)
check("no tip before anyone has chosen", refused(g, ann, {"type": "tip"}) and g.view(ann)["heist"]["tips"] == 1)
g.act(bo, {"type": "choose", "choice": "grab"})
g.act(ann, {"type": "tip"})
said = [e for e in room.log if e.get("to") == ann.id]
check("the whisper counts the grabbers", said and "1 of the 1" in said[-1]["text"], said[-1]["text"] if said else room.log[-3:])
check("only once a game", g.view(ann)["heist"]["tips"] == 0 and refused(g, ann, {"type": "tip"}))
g.act(cy, {"type": "choose", "choice": "rest"})
check("not after choosing", refused(g, cy, {"type": "tip"}))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
