"""Tic-Tac-Toe series: best of 3 alternates the first move, keeps the score and ends at 2 wins.

    python3 tests/tictactoe_series.py
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


r = server.Room("TEST")
for n in ("Ann", "Bo"):
    r.add_player(n)
r.switch_game("tictactoe")
r.settings["series"] = 3
r.settings["lucky"] = False


def play_win(r, winner_seat_first):
    """First player (seat 0) wins the top row."""
    g = r.game
    a, b = (r.players[i] for i in g.seats)
    for cell, p in ((0, a), (3, b), (1, a), (4, b), (2, a)):
        g.act(p, {"type": "move", "cell": cell})
    return a, b


r.start()
first = r.game.seats[0]
a, b = play_win(r, True)
check("game 1 won by the opener", r.winner == first)
check("series score shown", r.game.series_view()["wins"] == [1, 0] and not r.game.series_view()["done"])
r.start()
check("first move alternates", r.game.seats[0] != first, r.game.seats)
a, b = play_win(r, True)
check("second game won by the other player: 1-1", r.game.series_view()["wins"].count(1) == 2)
r.start()
check("alternates back", r.game.seats[0] == first)
a, b = play_win(r, True)
v = r.game.series_view()
check("series ends after 3 games, winner has 2", v["done"] and sorted(v["wins"]) == [1, 2] and "Series over" in r.log[-1]["text"] if isinstance(r.log[-1], dict) else True)
r.start()
check("a new series begins after a finished one", r.game.series_view()["games"] == 0)
r.settings["series"] = 1
r.start()
check("single games have no series", r.game.series_view() is None)
print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
