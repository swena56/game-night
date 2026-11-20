"""Unmask 🍀 Cold streak (off by default): two NO answers in a row earn a free Spyglass; bots play whole games.

    python3 tests/unmask_streak.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import unmask  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(mode="manhunt", powers=True, **st):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo")]
    r.switch_game("unmask")
    r.settings.update(mode=mode, powers=powers, **st)
    r.start()
    return r, r.game, ps


def pick(g, p, want):
    """A question about p's target whose answer is `want`."""
    face = g.target_face(p)
    return next({"a": c["id"]} for c in unmask.CATALOG if unmask.holds(face, c["id"]) == want)


def ask(r, g, p, want):
    r.turn = p.id
    g.ask(p, pick(g, p, want))


check("off by default", unmask.Unmask.defaults()["streak"] is False)
r, g, (a, b) = table()
a.g.cards = []
ask(r, g, a, False); ask(r, g, a, False)
check("off: no card from two NOs", a.g.cards == [])

r, g, (a, b) = table(streak=True)
a.g.cards = []
ask(r, g, a, False)
check("one NO is not enough", a.g.cards == [])
ask(r, g, a, False)
check("two NOs earn a Spyglass", a.g.cards == ["spyglass"])
ask(r, g, a, False)
check("the streak restarts", a.g.cards == ["spyglass"])
a.g.cards, a.g.nos = [], 0
ask(r, g, a, False); ask(r, g, a, True); ask(r, g, a, False)
check("a YES breaks the streak", a.g.cards == [])
a.g.cards = ["jam", "jam", "jam"]
a.g.nos = 1
ask(r, g, a, False)
check("a full hand gets no extra card", len(a.g.cards) == 3)

r, g, (a, b) = table(streak=True, powers=False)
ask(r, g, a, False); ask(r, g, a, False)
check("needs power cards", a.g.cards == [])

# Manhunt: the callout must not be public (it would reveal the NO); duel answers are public anyway
r, g, (a, b) = table(streak=True)
a.g.cards = []
n0 = len(r.log)
ask(r, g, a, False); ask(r, g, a, False)
mo = [e for e in r.log[n0:] if e.get("kind") == "moment"]
check("manhunt callout is private to the asker", mo and all(e.get("to") == a.id for e in mo), str(mo))

# an old game whose players never had the counter, and a pickle round trip
r, g, (a, b) = table(streak=True)
a.g.cards = []
check("no counter yet is fine", not hasattr(a.g, "nos"))
ask(r, g, a, False)
check("counter appears lazily", a.g.nos == 1)
r2 = pickle.loads(pickle.dumps(r))
check("pickle round trip keeps the streak", r2.players[a.id].g.nos == 1 and r2.game.s["streak"])

# bots through the real path, both modes
for mode in ("manhunt", "duel"):
    r, g, ps = table(mode, streak=True)
    for p in ps:
        p.bot = "hard"
    for _ in range(300):
        if r.phase != "playing":
            break
        if r.turn and r.players[r.turn].bot:
            g.bot_turn(r.players[r.turn])
        else:
            break
    check(f"bots finish a {mode} game with streak on", r.phase == "over", r.phase)

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
