"""Cribbage: pegging out while a rival is short of the skunk line (target − 30) earns 🦨 Skunk and says so;
during the play the view lists what each of your cards would score if laid now.

    python3 tests/cribbage_skunk.py
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


def board(a, b):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("cribbage")
    r.start()
    g = r.game
    ann.g.score, bo.g.score = a, b
    return r, g, ann, bo


r, g, ann, bo = board(119, 85)
g.peg(ann, 2, "test")
check("a skunk earns the badge", r.phase == "over" and (ann.badges or {}).get("cribbage:skunk") == 1, getattr(ann, "badges", None))
check("and is announced", any("Skunk" in e["text"] for e in r.log[-3:]))

r, g, ann, bo = board(119, 95)
g.peg(ann, 2, "test")
check("past the line: no skunk", r.phase == "over" and not (ann.badges or {}).get("cribbage:skunk"))

r, g, ann, bo = board(0, 0)
g.stage = "peg"
g.count, g.seq = 10, ["TS"]
ann.g.peg_hand = ["5H", "TD", "2C"]
r.turn = ann.id
now = g.view(ann)["cribbage"]["pegNow"]
check("pegNow: a 5 makes 15, a ten pairs", now.get("5H") == 2 and now.get("TD") == 2 and now.get("2C") == 0, now)
check("pegNow is only for the player in turn", g.view(bo)["cribbage"]["pegNow"] == {})

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
