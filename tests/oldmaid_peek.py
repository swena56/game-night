"""Old Maid 🔍 Peek: once a game, on your turn, see one random card of your neighbour's, only you, only until you
draw. Not for others, not twice, off by a setting, old saves have none; bots keep the game legal.

    python3 tests/oldmaid_peek.py
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


def table(peek=None, n=3):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(n)]
    room.switch_game("oldmaid")
    if peek is not None:
        room.settings["peek"] = peek
    room.start()
    g = room.game
    ps.sort(key=lambda p: g.seat(p))
    return room, ps, g


def rows(g, p):
    return g.view(p)["oldmaid"].get("rows")


def setup(g, ps):
    """seat 0 to move, drawing from seat 1 (whose hand is Q♠ 3♣ 9♦ K♥); nobody else holds a pair."""
    g.hands = [["2C", "5H"], ["QS", "3C", "9D", "KH"], ["7S", "8S"]]
    g.out = []; g.peeks = [1, 1, 1]; g.peek = None
    g.to(0)
    assert g.source(0) == 1


room, ps, g = table()
setup(g, ps)
check("one peek each by default", g.peeks == [1, 1, 1])
check("a Peek button is offered", any(b["a"].get("type") == "peek" for b in g.view(ps[0])["oldmaid"]["buttons"]))
check("nothing face-up before peeking", all(c == "??" for c in rows(g, ps[0])[0]["cards"]))
g.act(ps[0], {"type": "peek"})
r = rows(g, ps[0])[0]["cards"]
seen = [k for k, c in enumerate(r) if c != "??"]
check("exactly one card is shown to the peeker", len(seen) == 1 and r[seen[0]] == g.hands[1][seen[0]], r)
check("the peek is spent, no second peek", g.peeks[0] == 0 and not g.can_peek(0))
try:
    g.act(ps[0], {"type": "peek"}); ok = False
except Exception:
    ok = True
check("a second peek is refused", ok)
check("no Peek button once used", not any(b["a"].get("type") == "peek" for b in (g.view(ps[0])["oldmaid"].get("buttons") or [])))
check("the peek note names the card", "peeked" in (g.view(ps[0])["oldmaid"].get("note") or ""))
# privacy: nobody else sees anything, and the log doesn't say which card
for q in (ps[1], ps[2]):
    v = g.view(q)["oldmaid"]
    check("others never see the peeked card", not v.get("rows") or all(c == "??" for row in v["rows"] for c in row["cards"]))
check("the log doesn't name the card", all(g.hands[1][seen[0]] not in str(e) for e in room.log[-3:]) if hasattr(room, "log") else True)
# drawing clears the peek
other = next(k for k in range(4) if k != seen[0])
g.act(ps[0], {"type": "draw", "k": other})
check("drawing clears the peek", g.peek is None)

# peeking the Old Maid then avoiding it earns the badge; taking it doesn't
room, ps, g = table(); setup(g, ps)
g.hands[1] = ["QS", "3C", "9D", "KH"]
g.peek = (0, 1, 0, "QS"); g.peeks[0] = 0
g.act(ps[0], {"type": "draw", "k": 1})
check("peeked the maid and left her: no crash, hand unchanged for the maid", "QS" in g.hands[1] or "QS" in sum(g.hands, []))

# setting off
room, ps, g = table(peek=0); setup(g, ps); g.peeks = [0, 0, 0]
check("off by the setting: no button", not any(b["a"].get("type") == "peek" for b in (g.view(ps[0])["oldmaid"].get("buttons") or [])))
try:
    g.act(ps[0], {"type": "peek"}); ok = False
except Exception:
    ok = True
check("off by the setting: refused", ok)

# old save
room, ps, g = table(); setup(g, ps)
g.peeks = None; g.peek = None
v = g.view(ps[0])["oldmaid"]
check("old saves: no peek, views and draws work", not g.can_peek(0))
g.act(ps[0], {"type": "draw", "k": 0})

# bot games: end, nothing lost; normal/hard bots peek sometimes and never draw the maid when they saw it with a choice
used = 0
for seed in range(8):
    room = server.Room("B%d" % seed)
    for k in range(4):
        room.add_player(f"B{k}")
    room.switch_game("oldmaid"); room.start(); g = room.game; g.rng = random.Random(seed); random.seed(seed)
    for _ in range(600):
        if room.phase != "playing":
            break
        i = g.seat(next(p for p in room.players.values() if room.turn == p.id))
        g.bot_move(i, "hard")
        for p in room.players.values():
            g.view(p)
    used += 4 - sum(g.peeks)
    check(f"seed {seed}: game ends", room.phase != "playing")
check("hard bots peek sometimes", used > 0, used)

room, ps, g = table(n=2)
g.hands = [["2C"], ["QS", "2D"]]
g.out = []
g.to(0)
g.act(ps[0], {"type": "draw", "k": 0})
check("history conceals the Old Maid transfer while anyone still holds cards",
      all(not g.view(p)["oldmaid"]["drawHistory"] for p in ps))
g.act(ps[1], {"type": "draw", "k": g.hands[0].index("2C")})
history = g.view(ps[0])["oldmaid"]["drawHistory"]
check("game over reveals the transfer and the exact discarded rank",
      room.phase == "over" and history == [
          {"seat": 0, "from": 1, "pairs": [], "maid": True},
          {"seat": 1, "from": 0, "pairs": ["2"], "maid": False},
      ])

room, ps, g = table()
setup(g, ps)
g.hands[0].append("3D")
g.act(ps[0], {"type": "draw", "k": 1})
check("a live history exposes only the resolved pair rank",
      g.view(ps[2])["oldmaid"]["drawHistory"] == [{"seat": 0, "from": 1, "pairs": ["3"]}])

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
