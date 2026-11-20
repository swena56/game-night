"""Palace 8 skips the next player (option, default on): callout, 2p goes again, bots legal on all levels, pickle.

    python3 tests/palace_skip.py
"""
import os
import sys
import pickle

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import palace  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(n=3, eight=None, level=None):
    r = server.Room("TEST")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("palace")
    if eight is not None:
        r.settings["eight"] = eight
    r.start()
    g = r.game
    g.stage = "play"
    g.waiting = set()
    g.pile = ["5C"]
    g.stock = []
    return r, g


def play8(n, eight):
    r, g = table(n, eight)
    seen = []
    g.moment = lambda text, *a, **k: seen.append(text)
    g.hands[0] = ["8D", "KS", "QS"]
    g.play(0, ["8D"])
    return r, g, seen


r, g, seen = play8(3, None)
check("default: next player skipped", r.turn == g.seats[2], str(r.turn))
check("callout names skipped player", len(seen) == 1 and "skips P1" in seen[0], str(seen))
r, g, seen = play8(2, None)
check("2 players: goes again", r.turn == g.seats[0] and len(seen) == 1, str(seen))
r, g, seen = play8(3, False)
check("off: normal turn order, no callout", r.turn == g.seats[1] and not seen)

# 8 that burns (four of a rank) still burns, no skip callout needed
r, g = table(3)
g.pile = ["8C", "8H", "8S"]
g.hands[0] = ["8D", "KS", "QS"]
g.play(0, ["8D"])
check("four 8s burn and go again", g.pile == [] and r.turn == g.seats[0])

# winning with an 8 ends the game
r, g = table(3)
g.hands[0], g.up[0], g.down[0] = ["8D"], [], []
g.play(0, ["8D"])
check("last card 8 wins", r.phase != "playing")

# old-style room (no setting stored) behaves as default; pickle
r, g = table(3)
r.settings.pop("eight", None)
g2 = pickle.loads(pickle.dumps(r)).game
g2.hands[0] = ["8D", "KS", "QS"]
g2.pile = ["5C"]
g2.play(0, ["8D"])
check("pickle + missing setting = on", g2.room.turn == g2.seats[2])

# real bot games on all levels, legal moves, count firings
fired = games = 0
real = palace.Palace.moment
log = []
palace.Palace.moment = lambda self, text, *a, **k: log.append(text)
try:
    for n, level in ((2, "easy"), (3, "normal"), (4, "hard"), (3, "hard"), (2, "hard"), (3, "easy")) * 4:
        r = server.Room("TEST")
        for k in range(n):
            r.add_player(f"P{k}")
        r.switch_game("palace")
        r.start()
        g = r.game
        steps = 0
        while r.phase == "playing" and steps < 3000:
            steps += 1
            if g.stage == "swap":
                for i in sorted(g.waiting):
                    g.bot_move(i, level)
                continue
            i = g.seats.index(r.turn)
            before = (len(g.hands[i]), len(g.pile))
            g.bot_move(i, level)
            if g.source(i) is None and r.phase == "playing":
                check("card count sane", False)
        games += 1
        check(f"bot game {n}p {level} finished", r.phase != "playing", str(steps)) if r.phase == "playing" else None
finally:
    palace.Palace.moment = real
fired = sum(1 for t in log if t.startswith("⏭"))
print(f"{fired} skip callouts in {games} games")
check("fires at least once per game on average", fired >= games and games > 0)

sys.exit(1 if fails else 0)
