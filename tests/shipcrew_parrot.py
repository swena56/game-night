"""Ship, Captain & Crew 🦜 Parrot: once a game, after your first roll, one extra roll that turn; off by setting; bots stay legal.

    python3 tests/shipcrew_parrot.py
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


def table(parrot=None, bots=None):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo")]
    r.switch_game("shipcrew")
    if parrot is not None:
        r.settings["parrot"] = parrot
    r.start()
    return r, r.game, r.players[r.turn]


def refused(g, p, t):
    try:
        g.act(p, {"type": t})
    except server.GameError:
        return True
    return False


r, g, me = table()
check("not before the first roll", refused(g, me, "parrot") and me.g.parrot)
g.act(me, {"type": "roll"})
check("offered after a roll", g.view(me)["shipcrew"]["parrot"] is True)
g.act(me, {"type": "parrot"})
check("spent, a 4th roll", me.g.parrot is False and g.cap == 4 and g.view(me)["shipcrew"]["maxRolls"] == 4)
check("only once", refused(g, me, "parrot"))
g.found, g.free = [6, 5, 4], [1, 2]
for _ in range(3 - g.rolls):
    g.act(me, {"type": "roll", "reroll": [0, 1]})
check("turn still open after 3 rolls", r.turn == me.id and g.rolls == 3)
g.act(me, {"type": "roll", "reroll": [0, 1]})
check("4th roll ends the turn", r.turn != me.id)
check("no parrot next turn", g.cap == 3)
me.g.parrot = False
other = r.players[r.turn]
g.act(other, {"type": "roll"})
check("spent parrot not offered again", not g.view(other)["shipcrew"]["parrot"] or other.g.parrot)

r, g, me = table(False)
g.act(me, {"type": "roll"})
check("setting off: refused", refused(g, me, "parrot") and g.cap == 3)

# bots: a full 3-bot game at every level, bot moves must not raise
for lvl in ("easy", "normal", "hard"):
    r = server.Room("TEST")
    r.add_player("Host")
    r.switch_game("shipcrew")
    r.settings["rounds"] = 3
    r.start()
    g = r.game
    for p in list(r.players.values()):
        p.bot = lvl
    used = []
    real = g.use_parrot

    def spy(p, real=real, g=g):
        assert g.can_parrot(p), "bot used the parrot illegally"
        used.append(p.id)
        return real(p)
    g.use_parrot = spy
    for _ in range(400):
        if r.phase != "playing":
            break
        g.bot_turn(r.players[r.turn])  # exceptions propagate
    check(f"{lvl} bot parrot only legal ({len(used)} used)", len(used) <= 1 and (lvl == "easy") <= (not used))
    check(f"{lvl} game finished", r.phase == "over", r.phase)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
