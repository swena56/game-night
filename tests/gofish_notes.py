"""Go Fish 📝 table notes + 🔥 streak: notes come from public history only (never the hidden hand), they drop a
rank once it's given away or laid down, can be turned off, old saves still work; three good asks make a streak.

    python3 tests/gofish_notes.py
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


def table(notes=None, n=3):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(n)]
    room.switch_game("gofish")
    if notes is not None:
        room.settings["notes"] = notes
    room.start()
    g = room.game
    ps.sort(key=lambda p: g.seat(p))
    return room, ps, g


def tags(g, viewer, k):
    return g.view(viewer)["gofish"]["info"][k]["tags"]


room, ps, g = table()
g.hands = [["7C", "7D", "KS", "2C"], ["7H", "3C", "9D", "QS"], ["AC", "AD", "5S", "6S"]]
g.known = [set() for _ in range(3)]; g.pond = ["8H"] * 10; g.books = [[], [], []]; g.streak = [0] * 3
g.to(0)
g.act(ps[0], {"type": "ask", "who": 1, "rank": "7"})          # gets the 7♥, goes again
check("an ask is public: the asker is known to hold 7s", "7" in g.known[0])
check("others see the asker's note", any("📝" in t and "7" in t for t in tags(g, ps[1], 0)))
check("you don't see a note about yourself", not any("📝" in t for t in tags(g, ps[0], 0)))
check("a rank given away leaves the giver's notes", "7" not in g.known[1])
# a hidden card is never listed: seat 2 holds A,A but nobody has seen them ask
check("no note for ranks only held in secret", not any("📝" in t for t in tags(g, ps[0], 2)))
g.act(ps[0], {"type": "ask", "who": 2, "rank": "2"})          # go fish
check("a failed ask still notes the rank as the asker's", "2" in g.known[0])

check("memory lists public asks and denies from this viewer's opponents",
      g.view(ps[1])["gofish"]["memory"] == [
          {"seat": 0, "asked": ["2", "7"], "denied": []},
          {"seat": 2, "asked": [], "denied": ["2"]},
      ])
check("the asker sees only the rival's reply",
      g.view(ps[0])["gofish"]["memory"] == [{"seat": 2, "asked": [], "denied": ["2"]}])
check("spectators get no private memory panel", "memory" not in g.table(ps[0], None))

# books clear the note
g.hands[0] = ["7C", "7D", "7H", "KS"]; g.known[0] = {"7", "K"}; g.hands[1] = ["7S", "3C"]; g.to(0)
g.act(ps[0], {"type": "ask", "who": 1, "rank": "7"})
check("a laid-down book leaves the notes", "7" not in g.known[0] and "7" in g.books[0])

# streak: three successes in a row
room, ps, g = table()
g.hands = [["2C", "3C", "4C", "9H"], ["2D", "3D", "4D", "8H"], ["5S", "6S", "5C", "6C"]]
g.books = [[], [], []]; g.known = [set() for _ in range(3)]; g.pond = ["QH"] * 10; g.streak = [0] * 3; g.to(0)
for r in "234":
    g.act(ps[0], {"type": "ask", "who": 1, "rank": r})
check("three good asks in a row make a streak", g.streak[0] == 3, g.streak)
g.to(0); g.hands[0] = ["9H", "9C"]; g.hands[1] = ["8H"]
g.act(ps[0], {"type": "ask", "who": 1, "rank": "9"})
check("a go-fish resets the streak", g.streak[0] == 0)

# setting off
room, ps, g = table(notes=False)
g.known[0] = {"7"}
check("notes off by the setting", not any("📝" in t for t in tags(g, ps[1], 0)))
g.asked[0].add("7")
check("the notes setting also disables the memory panel", "memory" not in g.view(ps[1])["gofish"])
g.start(ps, random.Random(1))
check("new hand clears old asks and denials", not any(g.asked) and not any(g.denied))

# old saves
room, ps, g = table()
g.streak = None
g.hands[0] = ["7C"] + g.hands[0][:3]; g.hands[1] = ["7D", "2C"]; g.to(0)
try:
    g.act(ps[0], {"type": "ask", "who": 1, "rank": "7"}); ok = True
except Exception as e:
    ok = False
check("old saves without a streak still play", ok)

# whole bot games finish, 52 cards kept
for seed in range(6):
    room = server.Room("B%d" % seed)
    for k in range(4):
        room.add_player(f"B{k}")
    room.switch_game("gofish"); room.start(); g = room.game; g.rng = random.Random(seed)
    for _ in range(3000):
        if room.phase != "playing":
            break
        i = g.seat(next(p for p in room.players.values() if room.turn == p.id))
        g.bot_move(i, "hard")
        for p in room.players.values():
            g.view(p)
    check(f"seed {seed}: game ends", room.phase != "playing")
    tot = sum(len(h) for h in g.hands) + len(g.pond) + 4 * sum(len(b) for b in g.books)
    check(f"seed {seed}: 52 cards kept", tot == 52, tot)

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
