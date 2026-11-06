"""Ship, Captain & Crew 🏴‍☠️ Raids (off by default): docking 11 or 12 cargo plunders 2 from the leader
(someone who was ahead of you), never below 0; no raids with the pub pot.

    python3 tests/shipcrew_raid.py
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


def harbour(raid, cargo=(6, 5)):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy")]
    r.switch_game("shipcrew")
    if raid is not None:
        r.settings["raid"] = raid
    r.start()
    g = r.game
    me = r.players[r.turn]
    others = [p for p in ps if p is not me]
    others[0].g.score, others[1].g.score = 20, 8
    me.g.score = 10
    g.found, g.free = [6, 5, 4], list(cargo)
    return r, g, me, others


r, g, me, (lead, other) = harbour(None)
g.end_turn(me)
check("off by default: just the cargo", me.g.score == 21 and lead.g.score == 20)

r, g, me, (lead, other) = harbour(True)
g.end_turn(me)
check("11 cargo raids the leader for 2", me.g.score == 23 and lead.g.score == 18 and other.g.score == 8, (me.g.score, lead.g.score))
check("the last haul names the raided", g.last["raid"] == lead.id)

r, g, me, (lead, other) = harbour(True, cargo=(5, 5))
g.end_turn(me)
check("10 cargo: no raid", me.g.score == 20 and lead.g.score == 20)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
