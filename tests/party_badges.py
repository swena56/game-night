"""Badges in the party games: 🔥 On fire (Trivia, 5 right in a row), ⚡ Lightning hands (Qork, escape
in under 300 ms) and 🧵 Long word (Grid Hunt, a 7+ letter word nobody else found). Runs real rooms.

    python3 tests/party_badges.py        # a second or two
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


def badges(p):
    return getattr(p, "badges", None) or {}


def new_room(game):
    room = server.Room("TEST")
    ps = [room.add_player(n) for n in ("Ann", "Bo", "Cy")]
    room.switch_game(game)
    room.start()
    return room, ps, room.game


# ---- Trivia: Ann answers right every time, Bo always wrong
room, (ann, bo, cy), g = new_room("trivia")
for k in range(5):
    if g.stage != "ask" or room.phase != "playing":
        break
    right = g.q["right"]
    g.answers = {ann.id: (right, 1.0), bo.id: ((right + 1) % len(g.q["options"]), 1.0), cy.id: ((right + 1) % len(g.q["options"]), 1.0)}
    g.reveal()
    if k == 3:
        check("no 🔥 at 4 in a row", not badges(ann).get("trivia:on_fire"))
    g.next_question()
check("five right in a row (got to 5)", ann.g.streak == 5, f"streak {ann.g.streak}")
check("🔥 On fire at 5 in a row", badges(ann).get("trivia:on_fire") == 1, str(badges(ann)))
check("no 🔥 for wrong answers", not badges(bo).get("trivia:on_fire"))

# ---- Qork: a snap where Ann yanks in 250 ms, Bo in 420 ms, the Cupper slams at 500
room, ps, g = new_room("qork")
cup = room.players[g.cupper]
ann, bo = [p for p in ps if p.id != g.cupper][:2]
g.stage = "snap"
g.acted = {ann.id: 250, bo.id: 420, cup.id: 500}
g.resolve()
check("an escape in 250 ms earns ⚡ Lightning hands", badges(ann).get("qork:lightning") == 1, str(badges(ann)))
check("an escape in 420 ms doesn't", not badges(bo).get("qork:lightning"))
room, ps, g = new_room("qork")
ann = [p for p in ps if p.id != g.cupper][0]
g.stage = "snap"
g.acted = {ann.id: -1, g.cupper: 500}
g.resolve()
check("a jump before the dice landed (-1) earns nothing", not badges(ann).get("qork:lightning"))

# ---- Grid Hunt: Ann has a unique 7-letter word, Bo shares one with Cy
room, (ann, bo, cy), g = new_room("gridhunt")
g.all = {"bandage": False, "garbage": False, "cab": False}
ann.g.words, bo.g.words, cy.g.words = ["bandage", "cab"], ["garbage"], ["garbage"]
g.reveal()
check("a unique 7-letter word earns 🧵 Long word", badges(ann).get("gridhunt:long_word") == 1, str(badges(ann)))
check("a shared 7-letter word doesn't", not badges(bo).get("gridhunt:long_word") and not badges(cy).get("gridhunt:long_word"))

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
