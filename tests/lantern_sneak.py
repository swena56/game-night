"""Lantern Market 🐭 Sneak bonus: winning with a bid of 1 or 2 pays +3; 3 does not; a clash gives nothing; the
setting turns it off; bots' real choices are always legal tiles.

    python3 tests/lantern_sneak.py
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


def round_(sneak, bids, lot=6):
    room = server.Room("TEST")
    ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy")]
    room.switch_game("lantern")
    room.settings.update(timer=0, sneak=sneak)
    room.start()
    g = room.game
    g.table, g.deck = [lot], [1, 2, 3, 4, 5, 7, 8, 9, 10]
    g.choices = {}
    for p, b in zip(ps, bids):
        g.act(p, {"type": "bid", "bid": b})
    return room, ps, g


room, ps, g = round_(True, (9, 9, 2))
check("bid 2 wins +3", g.score[ps[2].id] == 9, g.score)
check("callout logged", any("Sneak" in t for t in [l["text"] if isinstance(l, dict) else str(l) for l in room.log]))
room = server.Room("TEST")
ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy")]
room.switch_game("lantern"); room.settings["timer"] = 0; room.start()
g = room.game; g.table, g.deck, g.choices = [6], [1, 2, 3, 4, 5, 7, 8, 9, 10], {}
for p_, b_ in zip(ps, (9, 9, 2)):
    g.act(p_, {"type": "bid", "bid": b_})
check("default setting: bid 2 wins +3", g.score[ps[2].id] == 9, g.score)
room, ps, g = round_(True, (9, 9, 1))
check("bid 1 wins +3", g.score[ps[2].id] == 9, g.score)
room, ps, g = round_(True, (9, 9, 3))
check("bid 3 no bonus", g.score[ps[2].id] == 6, g.score)
room, ps, g = round_(True, (2, 2, 2))
check("clash: nothing", set(g.score.values()) == {0} and len(g.table) == 2, g.score)
room, ps, g = round_(False, (9, 9, 2))
check("off: no bonus", g.score[ps[2].id] == 6, g.score)

# bots: real choices are legal tiles through a whole game
room = server.Room("TEST")
ps = [room.add_player(x) for x in ("Ann", "Bo")]
for lvl, p in zip(("hard", "easy"), ps):
    p.bot = lvl
room.switch_game("lantern")
room.settings["timer"] = 0
room.start()
g = room.game
for _ in range(30):
    if room.phase != "playing":
        break
    for p in ps:
        if p.id not in g.choices:
            c = g.bot_choice(p)
            bid, lit = c
            check("bot bid legal", type(bid) is int and bid in g.hands[p.id], (bid, g.hands[p.id]))
            g.act(p, {"type": "bid", "bid": bid, "lit": bool(lit)})
check("game finished", room.phase == "over", room.phase)
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
