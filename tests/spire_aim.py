"""Spire Siege 👑 Junk goes to the leader: off by default (a random rival); on, junk from a big clear lands
on whoever has cleared the most rings. Runs a real room.

    python3 tests/spire_aim.py
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


def siege(aim):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy")]
    r.switch_game("spire")
    if aim:
        r.settings["aim"] = aim
    r.start()
    ann, bo, cy = ps
    ann.g.rings, bo.g.rings, cy.g.rings = 0, 9, 2
    return r, r.game, ann, bo, cy


def junk(p):
    return [e for e in p.g.events if e["kind"] == "junk"]


r, g, ann, bo, cy = siege("leader")
for _ in range(6):
    g.on_clear(ann, 4, 1, [])
check("👑 every junk from Ann lands on Bo, the leader", len(junk(bo)) == 6 and not junk(cy), f"Bo {len(junk(bo))}, Cy {len(junk(cy))}")

hit = set()
for seed in range(12):
    r, g, ann, bo, cy = siege(None)
    g.rng.seed(seed)
    g.on_clear(ann, 4, 1, [])
    hit |= {p.name for p in (bo, cy) if junk(p)}
check("by default junk goes to a random rival (both get some)", hit == {"Bo", "Cy"}, str(hit))

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
