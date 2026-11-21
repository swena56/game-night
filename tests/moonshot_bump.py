"""Moon Shot 💥 Bumping (off by default): flying onto a rival's square knocks them back 3 (not on the pad
or the moon). Off, rockets share squares as before.

    python3 tests/moonshot_bump.py
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


def race(bump):
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("moonshot")
    r.settings["hazards"] = False
    r.settings["slip"] = False  # keep this test about bumping alone
    if bump is not None:
        r.settings["bump"] = bump
    r.start()
    g = r.game
    mover = r.players[r.turn]
    other = bo if mover is ann else ann
    return r, g, mover, other


r, g, me, them = race(None)
check("off by default", not g.s["bump"])
g.pos[them.id] = 10; g.pos[me.id] = 2; g.fuel = 8
g.bank(me)
check("off: rockets share a square", g.pos[them.id] == 10 and g.pos[me.id] == 10)

r, g, me, them = race(True)
g.pos[them.id] = 10; g.pos[me.id] = 2; g.fuel = 8
g.bank(me)
check("on: landing on a rival knocks them back 3", g.pos[them.id] == 7 and g.pos[me.id] == 10, g.pos)
check("the log says so", "bumped" in r.log[-2]["text"] or any("bumped" in e["text"] for e in r.log[-3:]))

r, g, me, them = race(True)
g.pos[them.id] = 2; g.pos[me.id] = 0; g.fuel = 2
g.bank(me)
check("never below the pad", g.pos[them.id] == 0)

r, g, me, them = race(True)
g.pos[them.id] = 6; g.pos[me.id] = 2; g.fuel = 3
g.bank(me)
check("a near miss leaves them be", g.pos[them.id] == 6)

r, g, me, them = race(True)
g.pos[me.id], g.pos[them.id], g.fuel = 2, 15, 4
g.tiles = {6: "star", 10: "wormhole", 12: "meteor"}
view = g.view(me)["moon"]
rolls = {tuple(item["dice"]): item for item in view["rolls"]}
check("forecast includes every unordered roll and leaves the game unchanged",
      len(rolls) == 21 and g.fuel == 4 and g.pos[me.id] == 2 and g.shields[me.id] == 0)
check("forecast distinguishes ordinary busts from a crash",
      rolls[1, 2]["end"] == 2 and rolls[1, 1]["end"] == 0)
check("forecast uses the boost and names a wormhole swap",
      view["preview"]["end"] == 11 and rolls[2, 2]["swap"] == them.id and rolls[2, 2]["end"] == 15)
check("forecast accounts for a shield earned on doubles",
      rolls[3, 3]["shielded"] and rolls[3, 3]["end"] == 12 and rolls[2, 4]["end"] == 7)
g.fuel += 9
route = g.view(me)["moon"]["preview"]
g.bank(me)
check("forecast matches the actual bump",
      route["bumped"] == [them.id] and route["end"] == g.pos[me.id] and g.pos[them.id] == 12)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
