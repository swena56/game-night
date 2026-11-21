"""Paint Blast ⛓️ Chain: a blast that sets off two or more more bombs pays its starter a bonus; a pair does not.

    python3 tests/paintblast_chain.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import paintblast as pb  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def arena():
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("paintblast")
    r.start()
    g = r.game
    # a clear row of floor so the bombs sit in each other's blast
    n = g.n
    row = n // 2
    for x in range(n):
        g.tiles[row * n + x] = pb.FLOOR
    g.bombs.clear()
    g.chain = [0] * len(g.seats)
    return g, row * n


g, base = arena()
# drive the real fuse/chain code: step the game's own tick with the fuse of bomb 0 at 1
for k, c in enumerate([base + 3, base + 5, base + 7]):
    g.bombs[c] = [1 if k == 0 else 90, k % 2, 3]
g.stage = "play"
g.step()
check("a chain of three pays the starter", g.chain[0] == pb.CHAIN_PTS and not g.bombs, f"{g.chain} bombs left {len(g.bombs)}")

g, base = arena()
for k, c in enumerate([base + 3, base + 5]):
    g.bombs[c] = [1 if k == 0 else 90, k % 2, 3]
g.stage = "play"
g.step()
check("a pair is no chain", g.chain == [0, 0] and not g.bombs)

g, base = arena()
for k, c in enumerate([base + 3, base + 5, base + 7, base + 9]):
    g.bombs[c] = [1 if k == 0 else 90, 0, 3]
g.stage = "play"
g.step()
check("a chain of four pays more, to the first bomb's owner", g.chain[0] == pb.CHAIN_PTS * 2, str(g.chain))
check("the chain bonus counts in the round score", g.round_points(0) >= pb.CHAIN_PTS * 2)

print("FAILED: " + ", ".join(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
