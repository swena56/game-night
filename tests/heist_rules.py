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

# 🎯 marked thief: a lone thief pays double if caught the next night
def marked_room(on):
    room = server.Room("TEST")
    ps = [room.add_player(n) for n in ("Ann", "Bo", "Cy")]
    room.switch_game("heist")
    room.settings["marked"] = on
    room.start()
    return room, ps, room.game


def night(g, ps, picks):
    for p, c in zip(ps, picks):
        g.act(p, {"type": "choose", "choice": c})


room, (ann, bo, cy), g = marked_room(True)
check("marked on by default", server.Room("T").settings.get("marked", True) is True)
g.moon = 99
night(g, (ann, bo, cy), ("grab", "rest", "rest"))
check("lone thief is marked", g.view(ann)["heist"]["marked"] == [ann.id] and "🎯" in g.meta(ann))
before = g.gold[ann.id]
night(g, (ann, bo, cy), ("grab", "guard", "rest"))
check("double fine when marked and caught", before - g.gold[ann.id] == 4, before - g.gold[ann.id])
check("mark clears after", g.view(ann)["heist"]["marked"] == [])
night(g, (ann, bo, cy), ("grab", "guard", "rest"))
check("normal fine unmarked", g.gold[ann.id] >= 0 and g.last["text"].startswith("🚨") and "double" not in g.last["text"])

room, (ann, bo, cy), g = marked_room(False)
g.moon = 99
night(g, (ann, bo, cy), ("grab", "rest", "rest"))
check("off: no mark", g.view(ann)["heist"]["marked"] == [])

# bots through the real path: legal choices, no exceptions
room, (ann, bo, cy), g = marked_room(True)
g.moon = 99
g.marked = {ann.id}
for p in (bo, cy):
    p.bot = "normal"
g.bot_tick()
check("bots chose legally", {bo.id, cy.id} <= set(g.choices) and all(c in ("grab", "guard", "rest") for c in g.choices.values()), g.choices)

# pickles: marked survives a save; a pre-change save (no `marked`) still plays a night
import pickle  # noqa: E402
room, (ann, bo, cy), g = marked_room(True)
g.moon = 99
night(g, (ann, bo, cy), ("grab", "rest", "rest"))
r2 = pickle.loads(pickle.dumps(room))
check("marked survives a pickle", r2.game.marked == {ann.id})
room, (ann, bo, cy), g = marked_room(True)
g.moon = 99
del g.__dict__["marked"]
r3 = pickle.loads(pickle.dumps(room))
g3 = r3.game
a3, b3, c3 = r3.seated()
check("old save without marked views", g3.view(a3)["heist"]["marked"] == [])
night(g3, (a3, b3, c3), ("grab", "rest", "rest"))
check("old save plays and marks", g3.view(a3)["heist"]["marked"] == [a3.id])

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
