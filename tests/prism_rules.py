"""Prism Pop: matching (runs, L and T), which special each shape makes, specials and combos going off,
cascades, swaps that bounce back, frost and stones, the reshuffle when no moves are left, attacks and the
checks on what a browser may report.

    python3 tests/prism_rules.py        # a second or two
"""
import os
import random
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402
from games.prism import N, Board, attack_for, bot_move, kind, PRISM, STONE  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError:
        return True
    return False


FILL = [["cdef"[(x + 2 * y) % 4] for x in range(N)] for y in range(N)]  # no matches and no moves, no a/b gems


def board(marks, seed=0):
    """A filler board with some cells set: marks = {(x, y): ch}."""
    grid = [row[:] for row in FILL]
    for (x, y), ch in marks.items():
        grid[y][x] = ch
    return Board(random.Random(seed), 6, "".join("".join(r) for r in grid))


I = lambda x, y: y * N + x  # noqa: E731

# -- matching and specials
b = board({(0, 0): "a", (1, 0): "a", (2, 0): "a"})
check("a straight 3 is one run", len(b.runs()) == 1 and sorted(b.runs()[0][0]) == [0, 1, 2])

b = board({(0, 0): "a", (1, 0): "a", (3, 0): "a", (2, 1): "a"})   # a at (2,1) moves up to make 4
res = b.play(I(2, 1), I(2, 0), refill=False)
check("4 in a row makes a ⚡ beam where you swapped", res and res["made"] == ["beam"] and b.at(2, 0) == "g", b.rows())

b = board({(0, 0): "a", (1, 0): "a", (3, 0): "a", (4, 0): "a", (2, 1): "a"})
res = b.play(I(2, 1), I(2, 0), refill=False)
check("5 in a row makes a 🌈 prism", res and res["made"] == ["prism"] and PRISM in b.rows(), str(res))

b = board({(0, 0): "a", (1, 0): "a", (2, 1): "a", (2, 2): "a", (3, 0): "a"})  # swap (3,0)->(2,0): row a a a + column a a a = L
res = b.play(I(3, 0), I(2, 0), refill=False)
check("an L makes a 💥 nova", res and res["made"] == ["nova"] and any(c in "stuvwx" for c in b.rows()), str(res))

b = board({(0, 0): "a", (1, 0): "b", (2, 0): "a"})
before = b.rows()
check("a swap that makes nothing bounces back", b.play(0, 1) is None and b.rows() == before)
check("only neighbours swap", b.swap_kind(0, 9) is None and b.swap_kind(0, 2) is None)

# -- specials going off
b = board({(0, 4): "a", (1, 4): "a", (2, 4): "g", (3, 5): "a"})  # g = a row beam of colour a, at (2,4); a at (3,5) moves up
res = b.play(I(3, 5), I(3, 4), refill=False)
top = b.rows()[:N]
check("a ⚡ row beam in a match clears its whole row", res and "beam" in res["fired"] and top.count(".") == N - 1 and res["pts"] >= 8 * 10, top)

b = board({(3, 3): PRISM, (4, 3): "b", (0, 6): "b", (5, 7): "b"})
res = b.play(I(3, 3), I(4, 3), refill=False)
check("swapping a 🌈 prism with a gem clears every gem of that colour", res and "prism" in res["fired"] and not any(kind(c) == 1 for c in b.rows()), b.rows())

b = board({(3, 3): "g", (3, 4): "m"})   # a row beam and a column beam side by side
res = b.play(I(3, 3), I(3, 4), refill=False)
check("two beams swapped together clear a cross", res and "combo" in res["fired"] and res["pts"] == 13 * 10, str(res and res["pts"]))

b = board({(2, 2): PRISM, (2, 3): PRISM})
res = b.play(I(2, 2), I(2, 3), refill=False)
check("two prisms clear the whole board", res and b.rows() == "." * (N * N))

# -- frost and stones
b = board({(0, 0): "a", (1, 0): "a", (2, 1): "a", (3, 0): "A"})
check("a frozen gem can't be swapped", b.swap_kind(I(3, 0), I(3, 1)) is None)
res = b.play(I(2, 1), I(2, 0), refill=False)
check("a match next to a frozen gem thaws it", res and "A" not in b.rows(), b.rows())

b = board({(0, 1): "a", (1, 1): "a", (2, 2): "a", (2, 0): STONE})
res = b.play(I(2, 2), I(2, 1), refill=False)
check("a match next to a stone breaks it", res and STONE not in b.rows() and res["pts"] >= 3 * 10 + 20, str(res))

b = Board(random.Random(3))
b.freeze(4)
check("frost freezes gems", sum(c in "ABCDEF" for c in b.rows()) == 4)
b.stones(3)
check("stones land on the board", b.rows().count(STONE) == 3 and b.moves())

# -- cascades and refills
# a hand-made two-step: column 2 holds b over a a; swapping the a in from (3,7) clears the column,
# the b drops to the bottom row next to b b
b = board({(0, 7): "b", (1, 7): "b", (2, 4): "b", (2, 5): "a", (2, 6): "a", (2, 7): "d", (3, 7): "a"})
check("the cascade board starts settled", not b.runs())
res = b.play(I(3, 7), I(2, 7), refill=False)
check("gems falling into a new line make a ×2 cascade", res and res["cascade"] == 2 and res["pts"] == 30 + 2 * 30, str(res))

b = Board(random.Random(5), 6, "".join("abcdef"[(x + 3 * y) % 6] for y in range(N) for x in range(N)))
check("the no-moves board really has none", not b.moves())
b.shuffle()
check("a reshuffle finds moves and no ready-made lines", b.moves() and not b.runs())

rng = random.Random(9)
b = Board(rng)
for i in range(150):
    m = bot_move(b, "hard", rng)
    b.play(*m)
    if b.runs() or "." in b.rows() or not b.moves():
        break
check("150 bot moves keep the board full, settled and playable", i == 149, b.rows())

# -- attacks
check("a small match sends nothing", attack_for(1, []) == (0, 0) and attack_for(2, []) == (0, 0))
check("a ×3 cascade sends frost", attack_for(3, []) == (2, 0))
check("a plain beam sends nothing, a nova sends frost", attack_for(1, ["beam"]) == (0, 0) and attack_for(1, ["nova"]) == (2, 0))
check("a prism blast or combo sends stones", attack_for(1, ["prism"]) == (0, 2) and attack_for(1, ["combo"]) == (0, 2))
check("a ×6 cascade sends both", attack_for(6, []) == (4, 3))


# -- the game in a room
def new_room(n=3, **settings):
    room = server.Room("TEST")
    ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    room.switch_game("prism")
    room.settings.update(settings)
    room.start()
    room.game.t0 = time.time() - 1   # skip the countdown
    return room, ps, room.game


room, (ann, bo, cy), game = new_room()
check("each board starts full and settled", all(len(p.g.rows) == 64 and not Board(random.Random(0), 6, p.g.rows).runs() for p in (ann, bo, cy)))
check("no turns: everyone plays at once", room.turn is None and room.deadline)
check("a bad board is refused", refused(game, ann, {"type": "board", "rows": "z" * 64, "score": 10}))
check("a short board is refused", refused(game, ann, {"type": "board", "rows": "a" * 10, "score": 10}))
check("a falling score is refused", not refused(game, ann, {"type": "board", "rows": ann.g.rows, "score": 500})
      and refused(game, ann, {"type": "board", "rows": ann.g.rows, "score": 400}))
check("an impossible jump is refused", refused(game, ann, {"type": "board", "rows": ann.g.rows, "score": 10 ** 7}))
check("a score that isn't a number is refused", refused(game, ann, {"type": "board", "rows": ann.g.rows, "score": "900"}))
check("a bad burst is refused", refused(game, ann, {"type": "burst", "cascade": 99}) and refused(game, ann, {"type": "burst", "cascade": True}))
game.act(ann, {"type": "burst", "cascade": 4, "specials": ["nova", "hack"], "made": []})
hit = [p for p in (bo, cy) if p.g.events]
check("a big burst sends frost to one rival", len(hit) == 1 and hit[0].g.events[0]["kind"] == "frost" and ann.g.sent > 0)
mine = game.view(ann)["prism"]
game.act(ann, {"type": "burst", "cascade": 4, "specials": [], "made": []})
check("attacks are spaced out", sum(len(p.g.events) for p in (bo, cy)) == 1)
check("you only see your own attacks", mine["events"] == [] and game.view(hit[0])["prism"]["events"])
check("the view shows every board and score", set(mine["boards"]) == {ann.id, bo.id, cy.id} and mine["boards"][ann.id]["score"] == 500)

room, (ann, bo, cy), game = new_room(attacks=False)
game.act(ann, {"type": "burst", "cascade": 6, "specials": ["combo"], "made": []})
check("with attacks off nothing is sent", not bo.g.events and not cy.g.events)

room, (ann, bo, cy), game = new_room()
ann.bot = "easy"
for _ in range(5):
    ann.g.attack_at = 0
    game.on_burst(ann, 6, ["combo"], [])
check("easy bots never attack", not bo.g.events and not cy.g.events)
ann.bot = "normal"
for _ in range(40):
    ann.g.attack_at = 0
    game.on_burst(ann, 3, [], [])
n = len(bo.g.events) + len(cy.g.events)
check("normal bots attack about half the time", 8 <= n <= 32, str(n))

room, (ann, bo, cy), game = new_room(aim="leader")
cy.g.score = 900
for _ in range(4):
    ann.g.attack_at = 0
    game.act(ann, {"type": "burst", "cascade": 3, "specials": [], "made": []})
check("👑 aimed at the leader", len(cy.g.events) == 4 and not bo.g.events)

room, (ann, bo, cy), game = new_room()
ann.g.score, bo.g.score, cy.g.score = 300, 800, 500
room.deadline = time.time() - 1
check("the clock ending makes bots ready to finish", game.bot_ready())
game.bot_tick()
check("top score wins at the bell", room.phase == "over" and room.winner == bo.id)

room, (ann, bo), game = new_room(2)
ann.g.score = bo.g.score = 400
game.on_timeout()
check("a tie has no winner", room.phase == "over" and room.winner is None)

room, (ann, bo), game = new_room(2)
game.t0 = time.time() + 3
check("moves are refused during the countdown", refused(game, ann, {"type": "board", "rows": ann.g.rows, "score": 10}))

print()
print(f"{len(fails)} failed" if fails else "all ok")
sys.exit(1 if fails else 0)
