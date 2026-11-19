"""Whist 👑 honours: three of the four top trumps between partners +1, all four +2, counted after the tricks,
announced at the end of the hand only; tricks reaching the target win first; setting off; old saves.

    python3 tests/whist_honours.py
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


def table(honours=None, target=None):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(4)]
    room.switch_game("whist")
    if honours is not None:
        room.settings["honours"] = honours
    if target:
        room.settings["target"] = target
    room.start()
    g = room.game
    return room, ps, g


def finish(g, tricks, honours=None, scores=(0, 0)):
    """Score a hand: tricks per seat, the honours counts dealt per team."""
    g.tricks = list(tricks); g.team_score = list(scores)
    g.honours = honours; g.trump = "S"
    g.end_hand()


room, ps, g = table()
top = {"AS", "KS", "QS", "JS"}
check("honours counted at the deal from the real hands", g.honours == [sum(c in {"A" + g.trump, "K" + g.trump, "Q" + g.trump, "J" + g.trump} for k in (t, t + 2) for c in g.hands[k]) for t in (0, 1)], g.honours)
check("two partnerships hold the four honours between them", sum(g.honours) == 4, g.honours)

finish(g, [4, 2, 3, 0], honours=[3, 1])                    # team 0 wins 7 tricks (+1), holds 3 honours (+1)
check("3 honours: +1 on top of the tricks", g.team_score == [2, 0], g.team_score)

finish(g, [4, 2, 3, 0], honours=[4, 0])
check("4 honours: +2 on top of the tricks", g.team_score == [3, 0], g.team_score)

finish(g, [4, 2, 3, 0], honours=[2, 2])
check("a 2-2 split scores nothing", g.team_score == [1, 0], g.team_score)

finish(g, [2, 4, 1, 3], honours=[3, 1])                    # team 1 wins the tricks (+1), team 0 holds the honours (+1)
check("honours go to the holders even when the other side wins the tricks", g.team_score == [1, 1], g.team_score)

# order: tricks reaching the target win before honours are counted
room, ps, g = table(target=3)
finish(g, [6, 0, 4, 0], honours=[1, 3], scores=(0, 1))     # team 0 takes 10 tricks (+4) → wins; team 1's honours never counted
check("tricks to the target win first", room.phase == "over" and g.team_score == [4, 1], (room.phase, g.team_score))

# honours can carry a team over the target
room, ps, g = table(target=3)
finish(g, [4, 2, 3, 0], honours=[0, 3], scores=(0, 2))     # team 0 +1 on tricks, team 1 +1 honours → 3
check("honours can win the game", room.phase == "over" and g.team_score[1] == 3, (room.phase, g.team_score))

# off by the setting
room, ps, g = table(honours=False)
finish(g, [4, 2, 3, 0], honours=[4, 0])
check("off by the setting: tricks only", g.team_score == [1, 0], g.team_score)

# old saves
room, ps, g = table()
finish(g, [4, 2, 3, 0], honours=None)
check("old saves without honours still score tricks", g.team_score == [1, 0], g.team_score)

# whole bot games finish and views work
for seed in range(4):
    room = server.Room("B%d" % seed)
    for k in range(4):
        room.add_player(f"B{k}")
    room.switch_game("whist"); room.settings["target"] = 3; room.start(); g = room.game; g.rng = random.Random(seed); random.seed(seed)
    n = 0
    while room.phase == "playing" and n < 2500:
        n += 1
        if g.stage == "score":
            g.deal(); continue
        i = g.seat(next(p for p in room.players.values() if room.turn == p.id))
        g.bot_move(i, "hard")
        for p in room.players.values():
            g.view(p)
    check(f"seed {seed}: game ends", room.phase != "playing", n)

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
