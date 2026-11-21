"""Reversi 🌊 Tidal wave (off by default): a move that flips 8 or more discs earns another move; bots stay
legal in every level, undo and pickling work.

    python3 tests/reversi_tidal.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import reversi  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(tidal, bots=None):
    r = server.Room("TEST")
    for n in ("Ann", "Bo"):
        r.add_player(n)
    r.switch_game("reversi")
    if tidal is not None:
        r.settings["tidal"] = tidal
    r.start()
    for p, lvl in zip(r.seated(), bots or []):
        p.bot = lvl
    return r, r.game


def make(*cells):
    """Board from (cell, owner) pairs."""
    bd = [None] * 64
    for c, v in cells:
        bd[c] = v
    return tuple(bd)


# dark to move at f1 (cell 5): the row e1..b1 closed by a1 (4 discs) and the column f2..f5 closed by f6 (4 discs)
BASE = [(0, 0), (1, 1), (2, 1), (3, 1), (4, 1), (13, 1), (21, 1), (29, 1), (37, 1), (45, 0)]
SPARE = [(56, 0), (57, 1)]   # dark can also play c8 (cell 58) later
WAVE = make(*BASE, *SPARE)
SEVEN = make(*[x for x in BASE if x[0] != 1], (1, 0), *SPARE)   # a1 b1 both dark: only c1..e1 flip, 3 + 4 = 7
LONE = make(*BASE)                                              # no other move for anyone after f1
check("fixture: f1 flips exactly 8 / 7", len(reversi.flips(WAVE, 0, 5)) == 8 and len(reversi.flips(SEVEN, 0, 5)) == 7)
check("fixture: dark has a spare move after the wave, LONE has none",
      bool(reversi.placements(reversi.play(WAVE, 0, 5), 0)) and not reversi.placements(reversi.play(LONE, 0, 5), 0))


def setup(tidal, board):
    r, g = game(tidal)
    g.seats = [p.id for p in r.seated()]
    g.board = board
    r.begin_turn(g.seats[0])
    return r, g


def waves(r):
    return [e["text"] for e in r.log if "moves again" in e["text"]]


def f1(r, g):
    g.act(r.players[g.seats[0]], {"type": "place", "cell": 5})


check("default setting is off", reversi.Reversi.defaults()["tidal"] is False)
r, g = setup(True, WAVE)
f1(r, g)
check("on: 8 flips, the same player moves again, with a callout", r.turn == g.seats[0] and len(waves(r)) == 1, r.turn)
r, g = setup(None, WAVE)
f1(r, g)
check("default: the classic 🌊 callout, no extra-move line", any("flips 8!" in e["text"] for e in r.log) and not waves(r))
r, g = setup(True, SEVEN)
f1(r, g)
check("on: 7 flips is not a wave", not waves(r))
r, g = setup(True, LONE)
f1(r, g)
check("on: a wave with no second move just ends or passes as normal", r.phase == "over" and not waves(r))

# undo of the extra move gives the turn back to the mover; pickle mid-game keeps the option
r, g = setup(True, WAVE)
f1(r, g)
mid = pickle.loads(pickle.dumps(r))
check("pickle mid-game keeps tidal and the turn", mid.game.s.get("tidal") is True and mid.turn == g.seats[0])
g.act(r.players[g.seats[0]], {"type": "undo_ask"})
g.act(r.players[g.seats[1]], {"type": "undo_yes"})
check("undo after a wave restores the board and the mover", g.board == WAVE and r.turn == g.seats[0])
old = pickle.loads(pickle.dumps(game(None)[0]))
del old.game.s["tidal"]
check("old-style room (no setting) loads and plays classic", old.game.s.get("tidal") is None)

# --- bots: every move legal, games finish, firing rate
fired = n = 0
errors = []
for lvls in [("easy", "easy")] * 14 + [("normal", "easy")] * 6 + [("hard", "easy")] * 1 + [("normal", "normal")] * 3:
    r, g = game(True, lvls)
    n += 1
    for ply in range(150):
        if r.phase != "playing":
            break
        if ply == 25:
            r = pickle.loads(pickle.dumps(r))
            g = r.game
        p = r.players[r.turn]
        me = g.seat(p)
        before, legal = g.board, reversi.placements(g.board, me)
        try:
            g.bot_turn(p)
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))
            break
        placed = [c for c in range(64) if before[c] is None and g.board[c] is not None]
        if len(placed) != 1 or placed[0] not in legal:
            errors.append(f"illegal {placed} not in {legal}")
            break
    if r.phase != "over":
        errors.append("did not finish")
    if waves(r):
        fired += 1
check("bots (easy/normal/hard): all moves legal, games finish, no exceptions", not errors, errors[:2])
print(f"tidal wave fired in {fired} of {n} bot games")
check("fires in at least one real bot game", fired >= 1)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
