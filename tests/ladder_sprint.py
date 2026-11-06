"""Word Ladder 🏃 Sprint (off by default): the first to finish cuts everyone else's clock to 15 seconds.
Badges: ⛳ On par (par steps, no hints or peeks), 🦅 Under par.

    python3 tests/ladder_sprint.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import ladder  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def climb(sprint):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("ladder")
    if sprint is not None:
        r.settings["sprint"] = sprint
    r.start()
    return r, r.game, ann, bo


def finish(g, p):
    """Walk Ann up the shortest ladder."""
    path = [g.start_word]
    while path[-1] != g.target:
        path.append(g.best_step(path[-1], path))
    for w in path[1:]:
        g.act(p, {"type": "step", "word": w})
    return len(path) - 1


r, g, ann, bo = climb(None)
left = g.end - g.now()
steps = finish(g, ann)
check("off by default: the clock runs on", abs((g.end - g.now()) - left) < 2 and g.stage == "climb")
check("par without help earns ⛳ (or 🦅 under par)", any(k in (ann.badges or {}) for k in ("ladder:par", "ladder:eagle")), (steps, g.par, ann.badges))

r, g, ann, bo = climb(True)
finish(g, ann)
check("sprint: the others get 15 seconds", g.stage == "climb" and abs((g.end - g.now()) - ladder.SPRINT_SECS) < 1, round(g.end - g.now(), 1))
check("and the log says so", any("Sprint" in e["text"] for e in r.log[-3:]))

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
