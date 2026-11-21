"""Canasta 🏁 Race: with the option on, the first side to complete a natural canasta in a hand earns +100 (setting "race", default Off).
Exact scoring, pairs, old-style objects, pickle round trip, and bot games at every level.

    python3 tests/canasta_race.py
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


def table(n=2, on=None, tag="R"):
    r = server.Room(tag)
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("canasta")
    if on is not None:
        r.settings["race"] = on
    r.start()
    g = r.game
    g.pause = lambda *a, **k: None
    return r, g


def setup_canasta(g, i, n_have=6):
    """Side of seat i has a six-card meld of kings and holds the seventh in hand plus a spare card."""
    s = g.side(i)
    g.melds[s] = {"K": ["KS", "KH", "KD", "KC", "KS", "KH"][:n_have]}
    g.hands[i] = ["KD", "5C", "9H"]
    g.stage = "meld"
    g.to(i)


r, g = table()
check("default Off", g.s["race"] is False)
setup_canasta(g, 0)
g.meld(0, ["KD"])
check("Off: no race side", g.race_side is None)
g.end_hand()
check("Off: summary has no race", "🏁" not in g.result)

r, g = table(on=True)
setup_canasta(g, 0)
g.hands[0] = ["2D", "5C", "9H"]
g.meld(0, ["2D"])
check("mixed canasta does not win the race", g.canastas(0) == 1 and g.race_side is None, g.race_side)
g.melds[0] = {"K": ["KS"] * 6}
g.hands[0] = ["KD", "5C", "9H"]
g.stage = "meld"
g.to(0)
g.meld(0, ["KD"])
check("a later natural canasta still wins it", g.race_side == 0, g.race_side)

r, g = table(on=True)
msgs = []
om = g.moment
g.moment = lambda text, *a, **k: (msgs.append(text), om(text, *a, **k))[1]
setup_canasta(g, 0)
before = list(g.score)
g.meld(0, ["KD"])
check("On: side 0 wins the race", g.race_side == 0, g.race_side)
check("race callout once", sum("canasta race" in m for m in msgs) == 1, msgs)
# second canasta by the other side does not take it
setup_canasta(g, 1)
g.meld(1, ["KD"])
check("rival's later canasta does not steal it", g.race_side == 0 and sum("canasta race" in m for m in msgs) == 1)
g.hands = [["5C"], ["5C"]]
g.melds = [{"K": ["KS"] * 7}, {}]
g.out_by = None
g.score = [0, 0]
g.red3s = [[], []]
g.end_hand()
check("bonus counted exactly", g.score[0] == 70 + 500 + 100 - 5 + 0 or g.score[0] == 7 * 10 + 500 + 100 - 5, g.score)
check("summary mentions race", "🏁" in g.result, g.result)
check("rival not rewarded", g.score[1] == -5, g.score)
check("banner hint shows race", "natural canasta" in g.table(next(iter(r.players.values())), 0)["scores"]["hint"])

# a new deal resets
r, g = table(on=True)
g.race_side = 1
g.deal()
check("new deal clears race", g.race_side is None)

# pairs: team side
r, g = table(4, on=True, tag="R4")
setup_canasta(g, 2)
g.meld(2, ["KD"])
check("pairs: race goes to the side", g.race_side == g.side(2) == 0, g.race_side)
g.hands = [["5C"]] * 4
g.melds = [{"K": ["KS"] * 7}, {}]
g.red3s = [[], []]
g.score = [0, 0]
g.out_by = None
g.end_hand()
check("pairs: 100 once for the side", g.score[0] == 70 + 500 + 100 - 10 and "🏁" in g.result, g.score)

# old-style object and missing setting
r, g = table(on=True)
g.__dict__.pop("race_side", None)
check("class default None", g.race_side is None)
r.settings.pop("race", None)
setup_canasta(g, 0)
g.meld(0, ["KD"])
check("missing key acts as Off", g.race_side is None)

# bot games
fired = games = hands = 0
for seed in range(12):
    random.seed(seed)
    n = [2, 3, 4][seed % 3]
    r = server.Room("B%d" % seed)
    for k in range(n):
        r.add_player(f"B{k}")
    r.switch_game("canasta")
    r.settings["race"] = True
    r.settings["target"] = 1500
    r.start()
    g = r.game
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    ok_plan = g.plan
    lvl = ["easy", "normal", "hard"][seed % 3]
    pickled = False
    seen_hands = 0
    last = g.hand_no
    for _ in range(20000):
        if r.phase != "playing":
            break
        if g.stage == "score":
            if g.after:
                f, g.after = g.after, None
                f()
            continue
        g.bot_move(g.seats.index(r.turn), lvl)     # bot moves go through take/meld/discard, which validate every card
        if not pickled and g.stage == "meld" and g.hand_no == 2:
            saved = {k: g.__dict__.pop(k) for k in ("moment",) if k in g.__dict__}
            r2 = pickle.loads(pickle.dumps(r))
            g.__dict__.update(saved)
            check("mid-hand pickle round trip", r2.game.hands == g.hands and r2.game.race_side == g.race_side)
            pickled = True
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({n}p, {lvl}): game ends", r.phase != "playing")
    games += 1
    hands += g.hand_no
    fired += sum("canasta race" in m for m in msgs)
print(f"race fired {fired} times in {games} games ({hands} hands)")
check("race fires in bot games, not every hand", fired >= games / 10 and fired > 0 and fired < 0.8 * hands, (fired, hands))
sys.exit(1 if fails else 0)
