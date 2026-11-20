"""Drop Four 🛡️ block bonus: dropping into the spot a rival needs to connect four earns an extra turn.

    python3 tests/dropfour_block.py
"""
import os
import pickle
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def make(n=2, block=True, bots=None):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    r.switch_game("dropfour")
    r.settings["block"] = block
    r.start()
    return r, r.game, ps


def setup(g, rows):
    """rows: bottom row first, strings of seat digits or '.'"""
    H, W = len(g.grid), len(g.grid[0])
    g.grid = [[None] * W for _ in range(H)]
    for i, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != ".":
                g.grid[H - 1 - i][c] = int(ch)


r, g, ps = make()
check("off by default", server.GAMES["dropfour"].defaults()["block"] is False)
cur = r.players[r.turn]
me = g.seats.index(cur.id)
rival = 1 - me
# rival has three in the bottom row (cols 0-2); column 3 wins for them
setup(g, [str(rival) * 3 + "."])
g.drop(cur, 3)
check("blocking keeps the turn", r.turn == cur.id)
check("callout names the blocker", any("blocked" in m["text"] and cur.name in m["text"] for m in r.log if m["kind"] == "moment"))
setup(g, [str(rival) * 3 + ".", "...."])
g.bonus_now = True
g.drop(cur, 3)
check("no chaining: the bonus move does not earn another", r.turn != cur.id)
# a plain drop does not
r, g, ps = make()
cur = r.players[r.turn]
g.drop(cur, 0)
check("an ordinary drop passes the turn", r.turn != cur.id)
# setting off
r, g, ps = make(block=False)
cur = r.players[r.turn]; me = g.seats.index(cur.id)
setup(g, [str(1 - me) * 3 + "."])
g.drop(cur, 3)
check("off: no bonus", r.turn != cur.id)
# own win beats everything
r, g, ps = make()
cur = r.players[r.turn]; me = g.seats.index(cur.id)
setup(g, [str(me) * 3 + "."])
g.drop(cur, 3)
check("winning still wins", r.phase == "over" and r.winner == cur.id)
# three players: blocks the right rival
r, g, ps = make(3)
cur = r.players[r.turn]; me = g.seats.index(cur.id); other = (me + 2) % 3
setup(g, [str(other) * 3 + "."])
g.drop(cur, 3)
check("3 players: block earns the bonus", r.turn == cur.id)
# old-style object and pickle
r, g, ps = make()
del g.__dict__["bonus_now"]
check("old object has class default", g.bonus_now is False)
r2 = pickle.loads(pickle.dumps(r)).game
check("pickle round trip", r2.bonus_now is False)

# bots, all levels, real move path
fired = games = 0
t0 = time.time()
for level in ("easy", "normal", "hard", "normal", "easy", "hard") * 4:
    if time.time() - t0 > 50:
        break
    r = server.Room("TEST")
    a = r.add_player("A"); b = r.add_player("B")
    for p, lv in ((a, level), (b, "normal" if level == "hard" else level)):
        p.bot = lv
    r.switch_game("dropfour"); r.settings["block"] = True; r.start()
    g = r.game
    for _ in range(200):
        if r.phase != "playing":
            break
        cur = r.players[r.turn]
        before = [row[:] for row in g.grid]
        n = len(g.moves)
        g.bot_turn(cur)
        assert len(g.moves) == n + 1 or r.phase == "over", "bot made no move"
    games += 1
    fired += sum("blocked" in m["text"] for m in r.log if m["kind"] == "moment") > 0
    check(f"bot game ({level}) ended legally", r.phase == "over")
print(f"block bonus fired in {fired}/{games} bot games")
check("fires in bot play", fired >= 1)
print("FAILED" if fails else "all ok")
sys.exit(1 if fails else 0)
