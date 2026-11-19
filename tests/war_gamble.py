"""War 🎲 gambles: spend one before a flip; win and you also take a card from every rival, lose and the winner
takes one of yours. Never a pile's last card, limited to 2 a game, off by a setting, old saves have none.

    python3 tests/war_gamble.py
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


def table(n=2, gamble=None):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(n)]
    room.switch_game("war")
    if gamble is not None:
        room.settings["gamble"] = gamble
    room.start()
    ps.sort(key=lambda p: room.game.seat(p))   # seats are shuffled at the start: ps[k] is seat k
    return room, ps, room.game


def stack(g, tops):
    """Give each seat a pile starting with the card in tops[k], then low filler (no accidental ties later)."""
    g.piles = [[tops[k]] + ["2C", "3D", "2H", "3S", "2D"] for k in range(g.n)]
    g.stage = "flip"; g.bets = set(); g.waiting = set(range(g.n))


def play(g, ps, gambles=()):
    for k, p in enumerate(ps):
        g.act(p, {"type": "flip", "gamble": True} if k in gambles else {"type": "flip"})


room, ps, g = table()
check("two gambles each by default", g.gambles == [2, 2])
check("the Gamble button is offered", any(b.get("a", {}).get("gamble") for b in g.view(ps[0])["war"]["buttons"]))

# winner gambles: takes the loser's top card on top of the battle
stack(g, ["AC", "5D"]); before = [len(p) for p in g.piles]
play(g, ps, gambles={0})
check("winner's gamble: +1 from the rival", len(g.piles[0]) == before[0] + 1 + 1 and len(g.piles[1]) == before[1] - 2, [len(p) for p in g.piles])
check("a gamble is spent", g.gambles == [1, 2])

# loser gambles: pays one extra
room, ps, g = table()
stack(g, ["5D", "AC"]); before = [len(p) for p in g.piles]
play(g, ps, gambles={0})
check("loser's gamble: winner takes one extra", len(g.piles[0]) == before[0] - 2 and len(g.piles[1]) == before[1] + 2, [len(p) for p in g.piles])

# both gamble, the winner collects only one card from the loser (a loser pays once)
room, ps, g = table()
stack(g, ["AC", "5D"]); before = [len(p) for p in g.piles]
play(g, ps, gambles={0, 1})
check("both gamble: the loser pays one extra, once", len(g.piles[1]) == before[1] - 2, [len(p) for p in g.piles])

# never the last card
room, ps, g = table()
g.piles = [["AC", "2C", "3D"], ["5D"]]; g.stage = "flip"; g.bets = set(); g.waiting = {0, 1}
play(g, ps, gambles={0})
check("a gamble can't take a pile's last card", len(g.piles[1]) == 0 and len(g.piles[0]) == 4, [len(p) for p in g.piles])
check("an out player stays out (no card created)", sum(len(p) for p in g.piles) == 4)

# limit: out of gambles
room, ps, g = table()
g.gambles = [0, 2]; stack(g, ["AC", "5D"])
try:
    g.act(ps[0], {"type": "flip", "gamble": True}); ok = False
except Exception:
    ok = True
check("no gamble with none left", ok)
check("no button with none left", not any(b.get("a", {}).get("gamble") for b in (g.view(ps[0])["war"].get("buttons") or [])))

# setting off
room, ps, g = table(gamble=0)
check("gambles off by the setting", g.gambles == [0, 0] and not any(b.get("a", {}).get("gamble") for b in g.view(ps[0])["war"]["buttons"]))

# old save: no gambles at all
room, ps, g = table()
g.gambles = None; g.bets = None; stack(g, ["AC", "5D"]); g.bets = None
try:
    play(g, ps); ok = True
except Exception as e:
    ok = False
check("old saves without gambles still play", ok and sum(len(p) for p in g.piles) == 12)
g.view(ps[0]); g.view(room.add_player("Watcher"))
check("views work for old saves and watchers", True)

# cards are conserved over whole bot games, 4 players
import random
tot = gam = 0
for seed in range(6):
    room = server.Room("T%d" % seed)
    for k in range(4):
        room.add_player(f"B{k}")
    room.switch_game("war"); room.settings["limit"] = 30; room.start(); g = room.game; g.rng = random.Random(seed)
    for _ in range(300):
        if room.phase != "playing":
            break
        if g.stage == "flip":
            for i in sorted(g.waiting):
                g.bot_move(i, "hard")
        if g.stage == "show":
            g.next_battle()
    gam += 2 * 4 - sum(g.gambles)
    tot += sum(len(p) for p in g.piles)
check("bot gambling keeps 52 cards", tot == 52 * 6, tot)
check("bots do gamble", gam > 0, gam)

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
