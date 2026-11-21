"""Lane Night callouts: 👑 a new outright leader (once everyone has bowled a few balls), 💯 a perfect game.

    python3 tests/lanes_calls.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ann, bo = r.add_player("Ann"), r.add_player("Bo")
r.switch_game("lanes")
r.start()
g = r.game
said = []
g.moment = lambda text, *a, **k: said.append(text)
ann.g.rolls = [9, 0]
bo.g.rolls = [5]
g.after_roll(ann, 0)
check("too early: no leader call", said == [] and getattr(g, "leader", None) is None)
ann.g.rolls = [9, 0, 9, 0]
bo.g.rolls = [5, 3, 5, 3]
g.after_roll(ann, 0)
check("first leader is silent", said == [] and g.leader == ann.id, said)
bo.g.rolls = [10, 10, 10]
ann.g.rolls = [9, 0, 9, 0, 9]
g.after_roll(bo, 0)
check("a new leader is called", len(said) == 1 and "takes the lead" in said[0], said)
g.after_roll(bo, 0)
check("the same leader isn't called again", len(said) == 1)
ann.g.rolls = [10, 10, 10, 10]
bo.g.rolls = [10, 10, 10, 10]
g.after_roll(bo, 0)
check("a tie at the top isn't a lead change", len(said) == 1, said)

ann.g.rolls = [10] * 12
ann.g.done = True
g.after_roll(ann, 0)
check("twelve strikes is a perfect game", any("PERFECT GAME" in t for t in said), said)
n = len(said)
ann.g.rolls = [10] * 11 + [9]
g.after_roll(ann, 0)
check("eleven and a nine is not", not any("PERFECT" in t for t in said[n:]))
sys.exit(1 if fails else 0)
