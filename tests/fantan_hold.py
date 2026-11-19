"""Fan Tan 🛑 Hold back: once a round, pass with a playable card for +2 penalty points; not before the 7♦ is down,
not twice, off by a setting, old saves have none; bots never break the deal.

    python3 tests/fantan_hold.py
"""
import os
import sys
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(hold=None, n=3):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(n)]
    room.switch_game("fantan")
    if hold is not None:
        room.settings["hold"] = hold
    room.start()
    g = room.game
    ps.sort(key=lambda p: g.seat(p))   # seats are shuffled at the start: ps[k] is seat k
    return room, ps, g


def act(g, p, a):
    try:
        g.act(p, a); return None
    except Exception as e:
        return str(e)


room, ps, g = table()
check("one hold back each by default", g.sneaks == [1, 1, 1])
first = g.seat(next(p for p in ps if "7D" in g.hands[g.seat(p)]))
check("can't hold back before the 7♦ is down", not g.can_hold(first) and act(g, ps[first], {"type": "hold"}) is not None)
g.act(ps[first], {"type": "play", "card": "7D"})
i = g.seat(next(p for p in ps if room.turn == p.id))
g.hands[i] = ["7S", "6D", "KC"]                       # 6♦ and 7♠ are playable
check("playable card: hold back offered", g.can_hold(i) and any(b["a"].get("type") == "hold" for b in g.view(ps[i])["fantan"]["buttons"]))
before = g.scores[i]; nxt = g.next_seat(i)
check("hold back: no error", act(g, ps[i], {"type": "hold"}) is None)
check("+2 penalty, hand kept, turn passes", g.scores[i] == before + 2 and len(g.hands[i]) == 3 and room.turn == ps[nxt].id)
check("the hold is spent", g.sneaks[i] == 0 and not g.can_hold(i))
g.to(i)
check("a second hold back is refused", act(g, ps[i], {"type": "hold"}) is not None)
check("playing is still allowed", act(g, ps[i], {"type": "play", "card": "6D"}) is None)

# nothing playable: hold isn't offered (a plain knock is)
room, ps, g = table()
f = g.seat(next(p for p in ps if "7D" in g.hands[g.seat(p)])); g.act(ps[f], {"type": "play", "card": "7D"})
i = g.seat(next(p for p in ps if room.turn == p.id)); g.hands[i] = ["2C", "3C"]
check("no hold with nothing playable", not g.can_hold(i) and act(g, ps[i], {"type": "hold"}) is not None)

# setting off
room, ps, g = table(hold=False)
check("off by the setting", g.sneaks == [0, 0, 0])

# old save
room, ps, g = table()
g.sneaks = None
check("old saves: no hold, views work", not g.can_hold(0) and g.view(ps[0]) is not None)

# whole bot games stay legal and conserve cards; hard bots do hold sometimes
used = 0
for seed in range(8):
    room = server.Room("B%d" % seed)
    for k in range(4):
        room.add_player(f"B{k}")
    room.switch_game("fantan"); room.settings["rounds"] = 1; room.start(); g = room.game; g.rng = random.Random(seed)
    for _ in range(400):
        if room.phase != "playing" or g.stage != "play":
            break
        i = g.seat(next(p for p in room.players.values() if room.turn == p.id)) if hasattr(room, "players") else None
        if i is None:
            break
        g.bot_move(i, "hard")
    used += 4 - sum(g.sneaks)
    check(f"seed {seed}: 52 cards kept", sum(len(h) for h in g.hands) + sum(len(v) for v in [[0] * (g.hi[s] - g.lo[s] + 1) for s in g.lo]) == 52) if room.phase == "playing" or True else None
check("hard bots hold back sometimes", used > 0, used)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
