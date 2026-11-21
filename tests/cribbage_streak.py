"""Cribbage: 🔥 Hot streak: three scoring plays in a row by one player in a deal peg a bonus 1 (setting
"streak", on by default); a dud play resets it; Off scores nothing extra; an old-style player without the
counter still works; pickle round trip; bots finish full games through the real move path.

    python3 tests/cribbage_streak.py
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


def board(streak=None):
    random.seed(3)
    r = server.Room("TEST")
    ann, bo = (r.add_player(n) for n in ("Ann", "Bo"))
    r.switch_game("cribbage")
    if streak is not None:
        r.settings["streak"] = streak
    r.start()
    g = r.game
    g.stage = "peg"
    g.starter = "2C"
    g.count, g.seq, g.last_player = 0, [], None
    ann.g.score = bo.g.score = 0
    return r, g, ann, bo


def play(g, p, card):
    g.turn_to(p.id)
    g.play(p, card)


for on in (None, False):
    tag = "on" if on is None else "off"
    r, g, ann, bo = board(on)
    # Ann: 7 (no score), 8 (15 = 2), then Bo breaks nothing; Ann 7 -> 22? use pairs: set up the table directly
    ann.g.peg_hand, bo.g.peg_hand = ["6H", "6C", "6S", "6D", "AH"], ["2H", "3D"]
    g.seq, g.count = ["QD"], 10
    play(g, ann, "6H")            # 16: no score
    check(f"[{tag}] a dud leaves streak 0", ann.g.streak == 0)
    play(g, ann, "6C")            # 22 pair: 2
    play(g, ann, "6S")            # 28 trips: 6 (second in a row)
    check(f"[{tag}] two scoring plays: 8 points, no bonus yet", ann.g.score == 8, ann.g.score)
    g.seq, g.count = ["6H", "6C", "6S"], 18   # a fresh count so a third 6 is legal: quads for 12
    play(g, ann, "6D")
    expect = 8 + 12 + (1 if on is None else 0)
    check(f"[{tag}] third scoring play {'adds the bonus' if on is None else 'adds nothing'}", ann.g.score == expect, ann.g.score)
    check(f"[{tag}] callout/log only when on", any("Hot streak" in e["text"] for e in r.log) == (on is None))
    history = g.view(ann)["cribbage"]["pegHistory"]
    check("peg replay totals match the score including any hot streak",
          sum(e["credited"] for e in history if e["who"] == ann.id) == ann.g.score)
    if on is None:
        check("streak restarts after the bonus", ann.g.streak == 0)

# a rival's play in between does not reset (streak counts your own plays)
r, g, ann, bo = board()
ann.g.peg_hand, bo.g.peg_hand = ["5H", "5C", "5S"], ["2H"]
g.seq, g.count = ["5D"], 5
play(g, ann, "5H")
play(g, bo, "2H")
check("a rival's play doesn't touch my streak", ann.g.streak == 1, ann.g.streak)

# an old-style player (no counter) and a pickle round trip
r, g, ann, bo = board()
del ann.g.streak
ann.g.peg_hand = ["KS"]
play(g, ann, "KS")
check("old-style player works", ann.g.streak == 0)
r2 = pickle.loads(pickle.dumps(r))
check("pickle round trip keeps the setting", r2.game.s.get("streak", True) is True)

# bots play whole games through the real path (seeds picked because the bonus fires in them; a full 121
# game is ~0.4 s each). Every bonus must come with its log line and its callout.
# Seeds are not fully repeatable (str-hash ordering of card sets varies per process), so play until a
# bonus has fired (at least 3 games, at most 20; about a third of games have one, ~0.4 s each).
bonus = 0
for seed in range(1, 21):
    if seed > 3 and bonus:
        break
    random.seed(seed)
    r = server.Room("TEST")
    r.add_bot("hard")
    r.add_bot("normal")
    r.switch_game("cribbage")
    r.settings["target"] = 121
    r.start()
    g = r.game
    steps = 0
    while r.phase == "playing" and steps < 4000:
        steps += 1
        if g.stage == "show":
            g.on_timeout()
        elif g.bot_ready():
            g.bot_tick()   # illegal moves raise GameError and fail the run
        else:
            break
    check(f"bots finish game {seed}", r.phase == "over", f"{steps} steps, stage {g.stage}")
    logs = sum("Hot streak!" in e["text"] for e in r.log)
    calls = sum("hot streak +1" in e["text"] for e in r.log)
    check(f"game {seed}: each bonus has a log line and a callout", logs == calls, f"{logs} vs {calls}")
    bonus += logs
check("the streak bonus fires in bot games", bonus >= 1, f"{bonus} in {seed} games")
print("streak bonuses in bot games:", bonus)

r, g, ann, bo = board()
ann.g.peg_hand, bo.g.peg_hand = ["7C"], ["8D"]
g.count, g.seq, g.last_player = 25, ["QD", "9C", "6C"], ann.id
g.next_peg(ann.id)
event = g.view(bo)["cribbage"]["pegHistory"][-1]
check("go is credited before starting a new count",
      event["items"] == [("Go", 1)] and event["count"] == 25
      and event["group"] + 1 == g.peg_group and g.count == 0)

r, g, ann, bo = board()
ann.g.score = g.s["target"] - 1
ann.g.peg_hand, bo.g.peg_hand = ["AC"], ["8D"]
g.count, g.seq = 30, ["QD", "KC", "JD"]
play(g, ann, "AC")
event = g.view(bo)["cribbage"]["pegHistory"][-1]
check("pegging out records the scoring reason and exact peg movement",
      r.phase == "over" and event["items"] == [("Thirty-one", 2)] and event["credited"] == 1
      and ann.g.score == g.s["target"])

print("\n" + ("ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
sys.exit(1 if fails else 0)
