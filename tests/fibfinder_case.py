"""Fib Finder (#85): a typed fib takes the truth's house style, so a phone's auto-capital or a closing full
stop doesn't show which answers people wrote and which came from bots.

    python3 tests/fibfinder_case.py
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


r = server.Room("TEST")
ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy")]
r.switch_game("fibfinder")
r.start()
g = r.game
g.fact = ("Rats ____ when they're tickled.", "laugh", [], ["hiccup", "purr", "sneeze", "glow"])
g.act(ps[0], {"type": "fib", "text": "  Sing.  "})
check("auto-capital and full stop go", g.fibs[ps[0].id] == "sing", repr(g.fibs[ps[0].id]))
g.act(ps[1], {"type": "fib", "text": "NASA tech!"})
check("an acronym keeps its capitals", g.fibs[ps[1].id] == "NASA tech", repr(g.fibs[ps[1].id]))
g.fibs.pop(ps[0].id); g.fibs.pop(ps[1].id)
try:
    g.act(ps[0], {"type": "fib", "text": "..."})
    check("only dots is refused", False)
except Exception:
    check("only dots is refused", True)
g.fact = ("The national animal of Scotland is the ____.", "Unicorn", [], ["Stag", "Eagle"])
g.act(ps[2], {"type": "fib", "text": "dragon"})
check("capital when the truth has one", g.fibs[ps[2].id] == "Dragon", repr(g.fibs[ps[2].id]))

print("\nALL OK" if not fails else f"\n{len(fails)} FAILED")
sys.exit(1 if fails else 0)
