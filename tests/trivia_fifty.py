"""Trivia ✂️ 50:50: off by default; on, each player can take two wrong answers away once a game, only
on four-choice questions, and only for themselves. Runs a real room.

    python3 tests/trivia_fifty.py
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


def raises(f):
    try:
        f()
    except GameError as e:
        return str(e)
    return None


def room(fifty):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("trivia")
    if fifty is not None:
        r.settings["fifty"] = fifty
    r.start()
    return r, r.game, ann, bo


r, g, ann, bo = room(None)
check("off by default: no lifeline in the view", g.view(ann)["trivia"]["fifty"] is None)
check("off by default: asking for it is refused", raises(lambda: g.act(ann, {"type": "fifty"})) is not None)

r, g, ann, bo = room(True)
g.q = {"topic": g.q["topic"], "text": "Q?", "options": ["a", "b", "c", "d"], "right": 2}
check("on: Ann has her 50:50", g.view(ann)["trivia"]["fifty"] is True)
g.act(ann, {"type": "fifty"})
v = g.view(ann)["trivia"]
check("two answers are cut", len(v["cut"]) == 2, str(v["cut"]))
check("the right answer is never cut", 2 not in v["cut"])
check("the lifeline is spent", v["fifty"] is False)
check("Bo's view is untouched", g.view(bo)["trivia"]["cut"] == [] and g.view(bo)["trivia"]["fifty"] is True)
check("a second use is refused", raises(lambda: g.act(ann, {"type": "fifty"})) is not None)
g.n += 1
check("the cut doesn't carry over to the next question", g.view(ann)["trivia"]["cut"] == [])
g.q = {"topic": g.q["topic"], "text": "T/F?", "options": ["True", "False"], "right": 0}
check("not on a true/false question", raises(lambda: g.act(bo, {"type": "fifty"})) is not None)
g.q = {"topic": g.q["topic"], "text": "Q?", "options": ["a", "b", "c", "d"], "right": 0}
g.act(bo, {"type": "answer", "i": 0})
check("not after answering", raises(lambda: g.act(bo, {"type": "fifty"})) is not None)

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
