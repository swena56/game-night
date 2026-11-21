"""Scopa 🌊 Napola (default Off): a captured A♦-2♦-3♦(+) run scores its length; Off is classic scoring, bots play
legal moves at every level, the callout fires, the target tie plays on, and a mid-game pickle round trip works.

    python3 tests/scopa_napola.py
"""
import os
import pickle
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.scopa import Scopa  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def game(napola, level="normal", n=2, **extra):
    r = server.Room("TEST")
    for k in range(n):
        r.add_player(f"P{k}")
    r.switch_game("scopa")
    if napola is not None:
        r.settings["napola"] = napola
    r.settings.update(extra)
    r.start()
    for p in r.seated():
        p.bot = level
    return r


def finish_round(g, taken, scores=(0, 0)):
    """End a round with seat 0 holding `taken`, seat 1 a few junk cards."""
    g.table_cards = []
    g.taken = [list(taken), ["KC", "KS"]]
    g.scopas = [0, 0]
    g.scores = list(scores)
    g.last_taker = 0
    g.end_round()
    return g.summary


check("run lengths", [Scopa.napola_run(c) for c in (["AD", "2D"], ["AD", "2D", "3D"], ["AD", "2D", "3D", "5D"],
                                                    ["AD", "2D", "3D", "4D", "5D"], ["2D", "3D", "4D"])] == [0, 3, 3, 5, 0])
full = [r + "D" for r in "A234567JQK"]
check("full run is 10", Scopa.napola_run(full) == 10)

d = game(None)
check("default Off", d.game.napola() is False and d.game.defaults()["napola"] == "off")
on, off = game("on"), game("off")
s_on = finish_round(on.game, ["AD", "2D", "3D", "4D"])
s_off = finish_round(off.game, ["AD", "2D", "3D", "4D"])
check("on: run of 4 scores 4 (+♦ and cards)", s_on[0]["pts"] == s_off[0]["pts"] + 4 and "🌊 napola 4" in s_on[0]["why"], s_on[0])
check("off: classic scoring, no napola text", all("napola" not in w for w in s_off[0]["why"]))
check("on: rival unaffected", s_on[1]["pts"] == s_off[1]["pts"])
check("hint mentions napola only when on", "napola" in on.game.table(on.seated()[0], 0)["scores"]["hint"]
      and "napola" not in off.game.table(off.seated()[0], 0)["scores"]["hint"])

# crossing the target: both pass it, the higher wins; a tie plays on
t = game("on", target=6)
finish_round(t.game, ["AD", "2D", "3D"], scores=(5, 5))
check("napola breaks a would-be tie at the target", t.phase == "over" and t.game.scores[0] > t.game.scores[1])
t = game("on", target=6)
finish_round(t.game, ["KC"], scores=(5, 5))
check("no napola: round still decided normally", t.phase in ("playing", "over"))

# bots: every move legal, all levels, firing rate
fired = games = 0
for level, n in (("easy", 10), ("normal", 6), ("hard", 4)):
    for k in range(n):
        r = game("on", level, n=2 + k % 3, target=6)
        g = r.game
        hit = []
        orig_m, orig_p = g.moment, g.play

        def spy(text, *a, _o=orig_m, **kw):
            if "NAPOLA" in text:
                hit.append(text)
            return _o(text, *a, **kw)

        def legal_play(i, c, cap, _o=orig_p):
            ok = c in g.hands[i] and ((cap and tuple(sorted(cap)) in [tuple(sorted(x)) for x in g.captures(c)])
                                      or (not cap and not g.captures(c)))
            if not ok:
                check("legal bot move", False, f"{level} {c} {cap}")
            return _o(i, c, cap)
        g.moment, g.play = spy, legal_play
        for _ in range(3000):
            if r.phase != "playing":
                break
            if g.after:
                g.on_timeout()
                continue
            g.bot_move(g.seat(r.players[r.turn]), level)
        check(f"{level} game finishes", r.phase == "over")
        games += 1
        fired += bool(hit)
print(f"napola fired in {fired}/{games} bot games")
check("callout fires at least once", fired >= 1)

# pickle mid-game, then play on; an old-style object without the setting is classic
r = game("on", "easy")
for _ in range(10):
    r.game.bot_move(r.game.seat(r.players[r.turn]), "easy")
r2 = pickle.loads(pickle.dumps(r))
g2 = r2.game
check("pickle keeps napola", g2.napola() and g2.hands == r.game.hands)
g2.bot_move(g2.seat(r2.players[r2.turn]), "easy")
g2.s = {k: v for k, v in g2.s.items() if k != "napola"}
check("old settings lack napola -> classic", not g2.napola())

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
