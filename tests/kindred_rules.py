"""Kindred rules (feedback #99): one tap places and scores at once, then the same player hands a piece
over; {cell, give} together still works; a line of four alike names its trait and gets a callout.

    python3 tests/kindred_rules.py
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402
from games import kindred as K  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(**settings):
    r = server.Room("TEST")
    for x in ("Ann", "Bo"):
        r.add_player(x)
    r.switch_game("kindred")
    r.settings.update(settings)
    r.start()
    g = r.game
    return r, g, [r.players[i] for i in g.seats]


def refused(fn):
    try:
        fn()
    except GameError:
        return True
    return False


def logtext(r):
    return json.dumps(list(r.log), ensure_ascii=False)


# first move of a board: give only
r, g, (a, b) = game()
check("board starts with a give", g.stage == "give" and r.turn == a.id)
check("a square on the first give is refused", refused(lambda: g.act(a, {"type": "move", "cell": 0, "give": 3})))
g.act(a, {"type": "move", "give": 3})
check("give hands the piece over", g.hand == 3 and g.stage == "place" and r.turn == b.id)
check("a give alone while placing is refused", refused(lambda: g.act(b, {"type": "move", "give": 5})))

# one tap places, scores, and keeps the turn for the hand-over
g.act(b, {"type": "move", "cell": 5})
check("a square alone places at once", g.board[5] == 3 and g.last == 5 and g.hand is None)
check("then the same player hands over", g.stage == "give" and r.turn == b.id)
check("a square while handing over is refused", refused(lambda: g.act(b, {"type": "move", "cell": 6})))
check("can't hand over a placed piece", refused(lambda: g.act(b, {"type": "move", "give": 3})))
g.act(b, {"type": "move", "give": 7})
check("hand-over passes the turn", g.hand == 7 and g.stage == "place" and r.turn == a.id)

# {cell, give} together still works (bots, older clients)
g.act(a, {"type": "move", "cell": 0, "give": 1})
check("square + piece in one action", g.board[0] == 7 and g.hand == 1 and r.turn == b.id and g.stage == "place")

# a row of four starred pieces: kin label, log and callout
r, g, (a, b) = game()
g.board = [None] * 16
g.board[0], g.board[1], g.board[2] = 8, 8 | 1, 8 | 2      # starred; mixed size/colour
g.hand, g.stage = 8 | 4, "place"
r.begin_turn(a.id)
pts, _ = K.gain(g.board, g.through, 3, g.hand)
g.act(a, {"type": "move", "cell": 3})
row = [x for x in g.scored if x["cells"] == [0, 1, 2, 3]]
check("kin_traits names the shared trait", row and "✦ all starred" in row[0]["kin"], row)
check("score added at placement", g.scores[g.seat(a)] == pts and pts > 0, pts)
check("log names the trait", "all starred" in logtext(r))
check("a callout for four alike", "All starred!" in logtext(r))
check("kin_traits both sides", K.kin_traits([0, 0, 0, 0]) == ["· all small", "☀️ all sun", "● all round", "○ all plain"]
      and K.kin_traits([1, 2, 4, 8]) == [])

# last square ends the board without a hand-over; timeout in give stage hands a random piece
r, g, (a, b) = game(rounds=1)
g.board = list(range(15)) + [None]
g.hand, g.stage = 15, "place"
r.begin_turn(a.id)
g.act(a, {"type": "move", "cell": 15})
check("last square ends the game", r.phase == "over" and g.stage == "over")

r, g, (a, b) = game()
g.act(a, {"type": "move", "give": 3})
g.act(b, {"type": "move", "cell": 0})
g.on_timeout()
check("timeout while handing over gives a random piece", g.stage == "place" and r.turn == a.id and g.hand not in (None, 3))

# a full bot-vs-bot game still finishes (combined moves)
r, g, (a, b) = game(rounds=1)
random.seed(4)
for p in (a, b):
    p.bot = "normal"
for _ in range(60):
    if r.phase != "playing":
        break
    g.bot_turn(r.players[r.turn])
check("bot game fills the board and finishes", r.phase == "over" and all(v is not None for v in g.board))

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
