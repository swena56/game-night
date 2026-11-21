"""Piquet run bonus (setting "run", default off): eight tricks in a row in a deal score 8 more, once, added at
the end of the deal (not toward pique); bots play full games legally and the bonus fires; pickle round trip
mid-hand and an old-style object.

    python3 tests/piquet_run.py
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


def table(run=None, deals=1):
    r = server.Room("TEST")
    for k in range(2):
        r.add_player(f"P{k}")
    r.switch_game("piquet")
    r.settings["deals"] = deals
    if run is not None:
        r.settings["run"] = run
    r.start()
    return r, r.game


def play_plan(g, winners):
    """Deal exact hands: trick t uses suit t%4 pair (hi, lo) with unique ranks per suit."""
    suits = "CDHS"
    ranks = "AKQ"
    hs = [[], []]
    plan = []
    for t, w in enumerate(winners):
        s, k = suits[t % 4], t // 4
        hi, lo = ranks[k] + s, "JT9"[k] + s
        hs[w].append(hi)
        hs[1 - w].append(lo)
        plan.append((w, hi, lo))
    g.stage, g.talon = "play", []
    g.hands = hs
    g.trick, g.last, g.tricks, g.hand_pts, g.pique_on = [], None, [0, 0], [0, 0], False
    g.run_seat, g.run_n, g.run_pts = None, 0, [0, 0]
    g.won = [[], []]
    g.played = set()
    g.decl = None
    return plan


def run_out(g, plan, upto=None):
    for t, (w, hi, lo) in enumerate(plan[:upto]):
        g.to(w)
        g.play(w, hi)
        g.play(1 - w, lo)


for run in (None, 1):
    tag = "off" if run is None else "on"
    r, g = table(run)
    plan = play_plan(g, [0] * 8 + [1, 0, 1, 1])
    run_out(g, plan)
    w0 = 9
    exp1 = 3 + 1  # last trick won by seat 1: +1
    exp0 = w0 + 10 + (8 if run else 0)
    check(f"[{tag}] scores", g.score == [exp0, exp1], (g.score, exp0, exp1))

# a streak of three broken, then eight by the other seat: scored once
r, g = table(1, deals=2)
plan = play_plan(g, [0] * 3 + [1] * 8 + [0])
run_out(g, plan, 10)
check("seven in a row: nothing yet", g.run_pts == [0, 0])
run_out_rest = plan[10:11]
for w, hi, lo in run_out_rest:
    g.to(w); g.play(w, hi); g.play(1 - w, lo)
check("eight in a row for seat 1", g.run_pts == [0, 8], g.run_pts)
for w, hi, lo in plan[11:]:
    g.to(w); g.play(w, hi); g.play(1 - w, lo)
check("bonus once, scores", g.score == [5, 26], g.score)

# tie in tricks 6-6: seven in a row for one seat still pays once; capot pays bonus too
r, g = table(1)
plan = play_plan(g, [0] * 12)
run_out(g, plan)
check("capot: 12 + 1 + 40 + 8 once", g.score == [61, 0], g.score)

# pique is not helped by the bonus
r, g = table(1, deals=2)
plan = play_plan(g, [0] * 6 + [1] * 6)
g.elder, g.hand_pts = 0, [0, 0]
run_out(g, plan, 5)
check("no pique from run", g.pique_on is False and g.hand_pts[0] == 5, (g.hand_pts, g.pique_on))

# old-style object and pickle mid-hand
r, g = table(1, deals=2)
plan = play_plan(g, [0] * 12)
run_out(g, plan, 7)
g2 = pickle.loads(pickle.dumps(r)).game
check("pickle keeps streak", g2.run_seat == 0 and g2.run_n == 7)
g2.to(0); g2.play(0, plan[7][1]); g2.play(1, plan[7][2])
check("bonus after reload", g2.run_pts == [8, 0], g2.run_pts)
r, g = table()
for k in ("run_seat", "run_n", "run_pts"):
    g.__dict__.pop(k, None)
r.settings.pop("run", None)
g3 = pickle.loads(pickle.dumps(r)).game
check("old object defaults", (g3.run_seat, g3.run_n, tuple(g3.run_pts)) == (None, 0, (0, 0)))

# bots, real play: legal moves, no exceptions, bonus fires
fired, games = 0, 0
for lv in ("easy", "normal", "hard"):
    for n in range(12):
        r = server.Room("TEST")
        r.add_player("A"); r.add_player("B")
        r.switch_game("piquet")
        r.settings.update({"deals": 2, "run": 1})
        r.start()
        g = r.game
        legal_ok = True
        orig = g.play
        def wrapped(i, c, g=g, orig=orig):
            global legal_ok
            if c not in g.legal(i):
                legal_ok = False
            return orig(i, c)
        g.play = wrapped
        seen = 0
        deals = 0
        guard = 0
        while r.phase == "playing" and guard < 400:
            guard += 1
            if g.stage == "score":
                g.after and g.after()
                continue
            for i in g.pending():
                before = g.run_pts[:]
                g.bot_move(i, lv)
                if g.run_pts != before:
                    seen += 1
                break
        games += 1
        fired += seen > 0
        if not legal_ok:
            check(f"legal bot moves ({lv})", False)
print(f"deals with a run bonus: fired in {fired} of {games} 2-deal games")
check("bonus fires in bot play", fired >= 1)
check("bots legal", "legal bot moves (easy)" not in fails and not any(f.startswith("legal") for f in fails))

print("FAILED: " + ", ".join(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
