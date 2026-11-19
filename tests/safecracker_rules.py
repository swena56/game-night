"""Safecracker rules: the 📝 notes board lives on the player's device only. The server has no notes action,
so a stray "note" is turned away without touching the shared clue history, the codes-left count or the
round; the browser check (headless Chromium) confirms tapping notes sends nothing.

    python3 tests/safecracker_rules.py
"""
import json
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


r = server.Room("TEST")
ann = r.add_player("Ann")
r.add_bot("normal")
r.switch_game("safecracker")
r.start()
g = r.game
bot = next(p for p in r.seated() if p.bot)

# one revealed round so there's a clue history and a codes-left count
g.act(ann, {"type": "guess", "pegs": list(range(g.length))})
g.bot_tick()
check("a round is revealed", len(g.history) == 1, len(g.history))
before = json.dumps([g.history, g.view(ann), g.view(bot), g.round, g.locked])
for note in ({"type": "note", "color": 0, "mark": "out"}, {"type": "notes", "spots": [[1, 2]]}):
    try:
        g.act(ann, note)
        check(f"a {note['type']!r} action is refused", False, "was allowed")
    except GameError as e:
        check(f"a {note['type']!r} action is refused", True, str(e))
after = json.dumps([g.history, g.view(ann), g.view(bot), g.round, g.locked])
check("the clues, codes left and round are untouched", before == after)
v = g.view(ann)["safecracker"]
check("the view carries no notes", not any("note" in k.lower() for k in v), sorted(v))
check("the codes-left count is the server's own", v["fit"] == len(g.consistent(ann)))
g.view(server.REPLAY_VIEWER)

print("\nall passed" if not fails else f"\n{len(fails)} failed")
sys.exit(1 if fails else 0)
