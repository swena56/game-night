"""Oh Hell 🧗 bold bids: an exact bid of 3+ tricks pays 5 extra (option, default off); bots of every level
stay legal, the bonus fires in real bot play, old/pickled rooms load.

    python3 tests/ohhell_bold.py
"""
import os
import pickle
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.cardbase import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(n=3, **settings):
    room = server.Room("TEST")
    ps = [room.add_player(f"P{k}") for k in range(n)]
    room.switch_game("ohhell")
    room.settings.update(settings)
    room.start()
    return room, ps, room.game


def score(g, bids, tricks):
    g.scores = [0] * g.n; g.made = [0] * g.n
    g.bids, g.tricks = list(bids), list(tricks)
    g.hand_no = 1; g.plan = [7, 6]      # not the last hand
    g.end_hand()


room, ps, g = table()
check("default is off", g.s.get("bold", False) is False and g.defaults()["bold"] is False)
score(g, [3, 2, 0], [3, 2, 0])
check("off: plain scoring", g.scores == [13, 12, 10], g.scores)
room, ps, g = table(bold=True)
score(g, [3, 2, 0], [3, 2, 0])
check("on: exact 3 +5, exact 2 and 0 not", g.scores == [18, 12, 10], g.scores)
score(g, [4, 3, 5], [3, 3, 2])
check("on: a missed bold bid scores nothing, extra tricks no bonus", g.scores == [0, 18, 0], g.scores)
score(g, [7, 3, 3], [7, 3, 3])
check("on: every exact bold bidder gets it", g.scores == [22, 18, 18], g.scores)
check("badge setting wording", "bold" in g.settings_schema and "an option" in " ".join(g.howto))

# last hand: bonus counted before the winner is decided
room, ps, g = table(bold=True)
g.scores = [0, 0, 0]; g.made = [0] * 3
g.bids, g.tricks = [3, 2, 0], [3, 2, 0]
g.hand_no = len(g.plan)
g.end_hand()
check("last hand counts the bonus", room.phase == "over" and g.scores[0] == 18, (room.phase, g.scores))

# moment text only names makers, public info
room, ps, g = table(bold=True)
logs = []
room.moment = lambda text, tone, sound, to, **k: logs.append((text, to))
score(g, [3, 2, 0], [3, 2, 0])
check("one public callout", len(logs) == 1 and logs[0][1] is None and "+5" in logs[0][0], logs)
logs.clear(); score(g, [3, 2, 0], [1, 2, 0])
check("no callout without a bold make", not logs)

# bots, all levels, with legality checked
CALLS = []
server.Room.moment = lambda self, text, tone, sound, to, **k: CALLS.append(text)
fired = rounds = games = 0
for level_set in (["easy"] * 4, ["normal"] * 4, ["hard"] * 4, ["easy", "normal", "hard", "hard"]):
    for rep in range(3):
        room, ps, g = table(n=4, bold=True, most=7)
        calls = CALLS; calls.clear()
        random.seed(rep * 7 + 1); g.rng = random.Random(rep)
        n = 0
        while room.phase == "playing" and n < 4000:
            n += 1
            if g.stage == "score":
                g.deal(); continue
            if n % 97 == 0:
                g2 = pickle.loads(pickle.dumps(room)).game
                if g2.scores != g.scores or g2.hands != g.hands or g2.bids != g.bids:
                    check("mid-game pickle", False)
            i = g.seat(next(p for p in room.players.values() if room.turn == p.id))
            try:
                g.bot_move(i, level_set[i])
            except GameError as e:
                check("bot move legal", False, str(e)); break
            for p in room.players.values():
                g.view(p)
        check(f"{level_set} game {rep} ends", room.phase != "playing", n)
        games += 1; rounds += len(g.plan); fired += len(calls)
print(f"bold callouts: {fired} over {games} games / {rounds} hands")
check("fires in bot play", fired >= 1)

# pickle round trip mid-game and an old-style object (no new state, setting absent)
room, ps, g = table(bold=True)
g2 = pickle.loads(pickle.dumps(room)).game
check("pickle round trip", g2.s.get("bold") is True and g2.hands == g.hands)
del g2.s["bold"]
score(g2, [3, 2, 0], [3, 2, 0])
check("old settings without the key: off", g2.scores == [13, 12, 10], g2.scores)

print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
