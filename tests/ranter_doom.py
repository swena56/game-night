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
from games import ranter  # noqa: E402

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

# edge cases: elimination, clamping, ties, rank order, log/banner note
r, g = table(1)
g.lives[0] = 2
force(g, ["AS", "5H", "9C", "KD"])
check("doom: 2 lives + ace = out", g.lives[0] == 0 and g.is_out(0), g.lives)
r, g = table(1)
g.lives[0] = 1
force(g, ["AS", "5H", "9C", "KD"])
check("doom: 1 life + ace = out, not negative", g.lives[0] == 0, g.lives)
r, g = table(1)
g.lives[0], g.lives[1] = 1, 3
force(g, ["AS", "AH", "9C", "KD"])
check("doom: tied aces, one eliminated", g.lives[:2] == [0, 1] and g.is_out(0) and not g.is_out(1), g.lives)
check("ace is lowest, king highest", ranter.low("AS") == 0 and ranter.low("KS") > ranter.low("QH") > ranter.low("2D") > ranter.low("AD"))
r, g = table(1)
force(g, ["KS", "KH", "AC", "2D"])
check("doom: suit irrelevant, club ace loses 2", g.lives == [3, 3, 1, 3], g.lives)
r, g = table(1)
force(g, ["2S", "KH", "9C", "3D"])
check("doom: no ace at all, 1 life", g.lives == [2, 3, 3, 3], g.lives)
r, g = table(1)
force(g, ["AS", "5H", "9C", "KD"])
check("log and banner note the doom", any("Ace of Doom: -2" in l.get("text", str(l)) if isinstance(l, dict) else "Ace of Doom: -2" in str(l) for l in r.log)
      and "Ace of Doom: -2" in g.table(r.players[g.pl(1).id], 1)["banner"])
r, g = table(0)
force(g, ["AS", "5H", "9C", "KD"])
check("off: banner has no doom note", "Doom" not in g.table(r.players[g.pl(1).id], 1)["banner"])

# bots to mid-hand, pickle, drop the setting, finish
def mid(doom):
    random.seed(5)
    r = server.Room("M")
    for k in range(4):
        r.add_player(f"B{k}")
    r.switch_game("ranter")
    r.settings["doom"] = doom
    r.start()
    g = r.game
    for p in r.players.values():
        p.bot = "normal"
    g.bot_move(g.pending()[0], "normal")      # two decisions in, hand not over
    assert g.stage == "swap" and not g.after
    return r


for doom, strip, want in ((1, True, 1), (1, False, 2)):
    r = mid(doom)
    r2 = pickle.loads(pickle.dumps(r))
    if strip:
        r2.settings.pop("doom", None)
        r2.game.s.pop("doom", None)
    g2 = r2.game
    # make the ace the unique lowest card for every hand: seat 0 holds it, others 5+
    alive = [k for k in range(g2.n)]
    for k in alive:
        g2.card[k] = "6S" if k else "AS"
    g2.deck = ["7H"] * 5
    before = list(g2.lives)
    while g2.stage == "swap" and r2.phase == "playing":
        for i in g2.pending():
            g2.keep(i)
    check(f"mid-hand pickle doom={doom} stripped={strip}: ace costs {want}", before[0] - g2.lives[0] == want, g2.lives)
    # and the rest of the game finishes
    for _ in range(800):
        if r2.phase != "playing":
            break
        if g2.after:
            f, g2.after = g2.after, None
            f()
        else:
            for i in g2.pending():
                g2.bot_move(i, "normal")
    check(f"mid-hand pickle doom={doom} stripped={strip}: game finishes", r2.phase != "playing")

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
    moves = [0]

    def guard(name, orig, g=g, moves=moves):
        def w(i):
            # the game's own rules: swap stage, my turn, alive, and the dealer's deck is never empty
            assert g.stage == "swap" and not g.after, "move outside the swap stage"
            assert i in g.pending() and not g.is_out(i), "bot moved out of turn or while out"
            assert g.card[i] is not None, "bot without a card"
            assert not (name == "swap" and i == g.dealer and not g.deck), "dealer swap with empty deck"
            if name == "swap" and i != g.dealer and g.card[g.left(i)] is None:
                raise AssertionError("swap with an eliminated neighbour")
            moves[0] += 1
            return orig(i)
        return w
    g.keep, g.swap = guard("keep", g.keep), guard("swap", g.swap)
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
    check(f"seed {seed} {level}: finishes, {moves[0]} legal moves", r.phase != "playing" and moves[0] > 0)
print(f"doom fired {fired} times in {games} games")
check("doom fires in bot play", fired >= 1)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
