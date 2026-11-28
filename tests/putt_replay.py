"""Putt Party replays (#389): a putt made while the one before is still rolling, or an update a browser misses, must not
drop the earlier putt. The view carries the last few putts in order, each with its hole.

    python3 tests/putt_replay.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import putt  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
r.switch_game("putt")
r.settings["holes"] = 2
r.start()
g = r.game
first = g.seats.index(r.turn)
g.putt(first, 0.3, 0.2)                  # a short putt...
second = g.seats.index(r.turn)
g.putt(second, 0.3, 0.2)                 # ...and the next one straight away, before it has finished rolling
shots = g.view(ann)["putt"]["shots"]
check("both putts are in the view", len(shots) >= 2 and [s["by"] for s in shots[-2:]] == [first, second], [s["by"] for s in shots])
check("in order", all(a["id"] < b["id"] for a, b in zip(shots, shots[1:])))
check("each knows its hole", all(s["hole"] == g.hole_no for s in shots[-2:]))
check("the latest is still the one in 'shot'", g.view(ann)["putt"]["shot"]["id"] == shots[-1]["id"])
for _ in range(8):
    i = g.seats.index(r.turn) if r.turn else None
    if i is None:
        break
    g.putt(i, 0.3, 0.2)
check("only the last few are kept", len(g.view(ann)["putt"]["shots"]) <= putt.RECENT_SHOTS)
print("\n" + ("putt replay OK" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
