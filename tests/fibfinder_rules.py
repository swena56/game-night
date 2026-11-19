"""Fib Finder rules: the 📖 fact card (why the truth is true, plus a source note) belongs to the fact on the
table and stays out of every view (players, spectators, the replay viewer) until the picks are in.

    python3 tests/fibfinder_rules.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.fib_facts import FACTS  # noqa: E402
from games.fib_notes import NOTES  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


check("every fact has a context and a source", all(NOTES.get(f[0], ("", ""))[0] and NOTES[f[0]][1] for f in FACTS),
      [f[0] for f in FACTS if not NOTES.get(f[0], ("", ""))[0]][:3])

r = server.Room("TEST")
ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy")]
r.switch_game("fibfinder")
r.start()
g = r.game
watcher = r.add_player("Wes")  # joins mid-game: a spectator with no game state


def everyone():
    return (*ps, watcher, server.REPLAY_VIEWER)


def views():
    return [g.view(p)["fibfinder"] for p in everyone()]


def leaks(context, source):
    blob = json.dumps([g.view(p) for p in everyone()])
    return '"card"' in blob or context in blob or source in blob


ctx, src = NOTES[g.fact[0]]
check("no card while writing", not leaks(ctx, src))
for p, fib in zip(ps, ("alpha", "beta", "gamma")):
    g.act(p, {"type": "fib", "text": fib})
check("now picking", g.stage == "pick", g.stage)
check("no card while picking", not leaks(ctx, src))
truth = next(i for i, o in enumerate(g.options) if o["truth"])
for p in ps[:2]:
    g.act(p, {"type": "pick", "i": truth})
check("no card with a pick still to come", not leaks(ctx, src))
mine = [i for i, o in enumerate(g.options) if ps[2].id in o["authors"]]
g.act(ps[2], {"type": "pick", "i": next(i for i in range(len(g.options)) if i not in mine)})
check("revealed", g.stage == "reveal", g.stage)
vs = views()
check("every viewer gets the card at the reveal", all(v.get("card") for v in vs))
card = vs[0]["card"]
check("the card is this fact's note", card == {"fact": g.fact[0], "truth": g.fact[1], "context": ctx, "source": src}, card)
json.dumps([g.view(p) for p in everyone()])

# next fact: the card goes away again
g.on_timeout()
check("next fact: no card", g.stage == "write" and not any("card" in v for v in views()))

# a saved game holding a fact the notes don't know still reveals (an empty card, no crash)
g.fact = ("An unknown ____ fact.", "odd", [], ["even", "plain", "flat", "round"])
g.stage = "reveal"
check("an unknown fact reveals without a note", g.view(ps[0])["fibfinder"]["card"]["context"] == "")

print("\nall passed" if not fails else f"\n{len(fails)} failed")
sys.exit(1 if fails else 0)
