"""Ranter-Go-Round Ace of Doom (off by default): the lowest card being an ace costs 2 lives; bots stay legal; old rooms pickle.

    python3 tests/ranter_doom.py
"""
import os
import pickle
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(doom=None, n=4, bots=None):
    r = server.Room("T")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("ranter")
    if doom is not None:
        r.settings["doom"] = doom
    r.start()
    return r, r.game


def force(g, cards):
    g.card = list(cards)
    g.dealer = g.n - 1
    g.stage = "swap"
    g.showdown()


r, g = table(1)
force(g, ["AS", "5H", "9C", "KD"])
check("doom: lowest ace loses 2", g.lives == [1, 3, 3, 3], g.lives)
r, g = table(1)
force(g, ["AS", "AH", "9C", "KD"])
check("doom: tied aces both lose 2", g.lives == [1, 1, 3, 3], g.lives)
r, g = table(1)
force(g, ["2S", "5H", "9C", "KD"])
check("doom: non-ace lowest loses 1", g.lives == [2, 3, 3, 3], g.lives)
r, g = table(1)
g.lives[0] = 1
force(g, ["AS", "5H", "9C", "KD"])
check("doom: out with a life left", g.lives[0] <= 0 and g.is_out(0))
r, g = table()
force(g, ["AS", "5H", "9C", "KD"])
check("default off: ace loses 1", g.lives == [2, 3, 3, 3], g.lives)

# old-style object (no setting) and pickle round trip mid-hand
r, g = table(1)
g.s.pop("doom", None)
force(g, ["AS", "5H", "9C", "KD"])
check("old rooms: no setting means off", g.lives[0] == 2)
r, g = table(1)
r2 = pickle.loads(pickle.dumps(r))
force(r2.game, ["AS", "5H", "9C", "KD"])
check("pickle keeps the setting", r2.game.lives[0] == 1)

# bot play: count doom firings, every move legal
fired = games = 0
for seed in range(24):
    random.seed(seed)
    level = ("easy", "normal", "hard")[seed % 3]
    r = server.Room("B%d" % seed)
    for k in range(3 + seed % 4):
        r.add_player(f"B{k}")
    r.switch_game("ranter")
    r.settings["doom"] = 1
    r.settings["lives"] = 2
    r.start()
    g = r.game
    for p in r.players.values():
        p.bot = level
    games += 1
    for _ in range(600):
        if r.phase != "playing":
            break
        before = list(g.lives)
        if g.after:
            f, g.after = g.after, None
            f()
        else:
            for i in g.pending():
                g.bot_move(i, level)
        if any(b - a == 2 for a, b in zip(g.lives, before)):
            fired += 1
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} {level}: finishes", r.phase != "playing")
print(f"doom fired {fired} times in {games} games")
check("doom fires in bot play", fired >= 1)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
