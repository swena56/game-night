"""Euchre 🪶 Nine lives: a trick won with the 9 of trumps earns its team +1 at hand end (setting "nine", default Off).
Exact cases, tie handling, pickle round trip, bot games on every level (legal moves, firing rate).

    python3 tests/euchre_nine.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(on=None, tag="E"):
    r = server.Room(tag)
    for k in range(4):
        r.add_player(f"P{k}")
    r.switch_game("euchre")
    if on is not None:
        r.settings["nine"] = on
    r.start()
    g = r.game
    g.pause = lambda *a, **k: None
    return r, g


def last_trick(on, cards, leader=0):
    """Hearts trumps; play the final trick of a hand (four singletons) with seat order from leader."""
    r, g = table(on)
    g.trump, g.maker, g.alone, g.stage = "H", 0, None, "play"
    g.tricks, g.won, g.played, g.trick = [1, 1, 1, 0], [[] for _ in range(4)], set(), []
    order = [(leader + k) % 4 for k in range(4)]
    for s, c in zip(order, cards):
        g.hands[s] = [c]
    g.to(leader)
    for s, c in zip(order, cards):
        g.play(s, c)
    return r, g


check("default Off", table()[1].s["nine"] is False)
# 9H cuts a spade lead; seat 1 wins (team 1) ; makers (team 0) took 3 earlier? tricks [1,1,1,0]: team0 has 2 -> euchred
r, g = last_trick(True, ["AS", "9H", "KS", "QS"])
check("On: nine wins -> bonus to its team (euchre +2, nine +1 both team 1)", g.team_score == [0, 3], g.team_score)
check("logged", any("+1 for the 9 of trumps" in l["text"] if isinstance(l, dict) else "9 of trumps" in str(l) for l in r.log[-8:]))
r, g = last_trick(False, ["AS", "9H", "KS", "QS"])
check("Off: no bonus", g.team_score == [0, 2], g.team_score)
r, g = last_trick(True, ["AS", "TH", "9H", "QS"])
check("nine loses to ten: none", g.nine is None and g.team_score == [0, 2], (g.team_score, g.nine))
r, g = last_trick(True, ["AS", "9H", "TH", "QS"])
check("nine under a higher trump: no bonus", g.nine is None and g.team_score == [1, 0], (g.team_score, g.nine))
r, g = last_trick(True, ["9S", "9D", "KS", "QS"])
check("a 9 of another suit does nothing", g.nine is None)
# nine won by the makers' side: makers take 3 -> +1, nine +1
r, g = table(True)
g.trump, g.maker, g.alone, g.stage = "H", 0, None, "play"
g.tricks, g.won, g.played, g.trick = [1, 0, 1, 0], [[] for _ in range(4)], set(), []
for s, c in zip((0, 1, 2, 3), ["9H", "AS", "KS", "QS"]):
    g.hands[s] = [c]
g.to(0)
for s, c in zip((0, 1, 2, 3), ["9H", "AS", "KS", "QS"]):
    g.play(s, c)
check("led 9 of trumps wins when nobody else holds trumps: makers 3 tricks = 1 + 1", g.team_score == [2, 0], g.team_score)
# tie at the target is not a win
r, g = table(True)
g.team_score = [8, 9]
g.trump, g.maker, g.alone, g.stage = "H", 0, None, "play"
g.tricks, g.won, g.played, g.trick = [2, 0, 1, 0], [[] for _ in range(4)], set(), []
g.nine = 1
g.end_hand()
check("8-9 plus the nine bonus: 9-10 is not a tie, ends the game", r.phase != "playing" and "incl. the 9" in r.log[-1]["text"], (g.team_score, r.log[-1]))
r, g = table(True)
g.team_score = [9, 9]
g.trump, g.maker, g.alone, g.stage = "H", 0, None, "play"
g.tricks, g.won, g.played, g.trick = [2, 0, 1, 0], [[] for _ in range(4)], set(), []
g.nine = 1
g.end_hand()
check("tie 10-10 plays on", r.phase == "playing" and g.team_score == [10, 10], (r.phase, g.team_score))


def hand_end(on, score, tricks, nine, maker=0):
    r, g = table(on)
    g.team_score = list(score)
    g.trump, g.maker, g.alone, g.stage = "H", maker, None, "play"
    g.tricks, g.won, g.played, g.trick = list(tricks), [[] for _ in range(4)], set(), []
    g.nine = nine
    g.end_hand()
    return r, g


# Off: an (unreachable in play) tie at the target keeps the original rule, no plays-on
r, g = hand_end(False, [10, 10], [2, 0, 1, 0], None)
check("Off: equal scores at target end the game as before", r.phase != "playing", g.team_score)
# On: both cross with different scores -> higher wins
r, g = hand_end(True, [9, 9], [3, 0, 2, 0], 1)
check("On: both cross 11-10, the higher wins", r.phase != "playing" and "11 to 10" in r.log[-1]["text"], (g.team_score, r.log[-1]))
# On: long run of ties keeps playing; a decisive hand ends it
r, g = hand_end(True, [9, 9], [2, 0, 1, 0], 1)
for _ in range(60):
    g.tricks, g.nine, g.stage = [2, 0, 1, 0], 1, "play"
    g.end_hand()
    if r.phase != "playing" or g.team_score[0] != g.team_score[1]:
        break
check("On: ties keep playing", r.phase == "playing" and g.team_score[0] == g.team_score[1], g.team_score)
g.tricks, g.nine, g.stage = [2, 0, 1, 0], None, "play"
g.end_hand()
check("On: a lead at hand end finishes it", r.phase != "playing", g.team_score)
for seed in range(9):
    r, g = table(True, tag=f"T{seed}")
    g.team_score = [9, 9]
    for _ in range(4000):
        if r.phase != "playing":
            break
        if g.stage in ("call", "discard", "play"):
            g.bot_move(g.seats.index(r.turn), ["easy", "normal", "hard"][seed % 3])
        elif g.stage == "score":
            g.deal()
    check(f"tie-start bot game {seed} ends", r.phase != "playing", g.team_score)

# old-style object (no attribute), pickle
r, g = table(True)
g.__dict__.pop("nine", None)
check("missing attr defaults None", g.nine is None)
g.__dict__.pop("pause", None)
r2 = pickle.loads(pickle.dumps(r))
check("pickle keeps setting", r2.game.s["nine"] is True)

# bot games, every level incl. hard-vs-hard
fired = games = 0
for seed in range(24):
    r, g = table(True, tag=f"B{seed}")
    lvl = ["easy", "normal", "hard"][seed % 3]
    orig = g.play
    g.play = lambda i, c, g=g, orig=orig: (c in g.legal(i) or (_ for _ in ()).throw(AssertionError((i, c)))) and orig(i, c)
    msgs = []
    om = g.moment
    g.moment = lambda text, *a, om=om, msgs=msgs, **k: (msgs.append(text), om(text, *a, **k))[1]
    pickled = False
    for _ in range(3000):
        if r.phase != "playing":
            break
        if g.stage in ("call", "discard", "play"):
            g.bot_move(g.seats.index(r.turn), lvl)
        elif g.stage == "score":
            g.deal()
        if not pickled and g.stage == "play" and len(g.hands[0]) == 3:
            saved = {k: g.__dict__.pop(k) for k in ("play", "moment", "pause") if k in g.__dict__}
            r2 = pickle.loads(pickle.dumps(r))
            g.__dict__.update(saved)
            check("mid-hand pickle round trip", r2.game.hands == g.hands and r2.game.s["nine"] is True)
            pickled = True
        for p in r.players.values():
            g.view(p)
    check(f"seed {seed} ({lvl}): game ends", r.phase != "playing")
    games += 1
    fired += sum("Nine lives" in m for m in msgs)
print(f"fired {fired} times in {games} games")
check("fires in bot games", fired >= games / 10 and fired > 0, fired)
sys.exit(1 if fails else 0)
