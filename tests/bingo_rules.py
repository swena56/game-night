"""Rules checks for Bingo Bash.

    python3 tests/bingo_rules.py
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402
from games import bingo as BG, bingo_patterns as P  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(n=2, **settings):
    r = server.Room("TEST")
    ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy", "Di")[:n]]
    r.switch_game("bingo")
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def raises(fn):
    try:
        fn()
    except GameError:
        return True
    return False


def call(g, n):
    """Force the next ball to be n."""
    if n in g.calledset:
        return
    k = len(g.called)
    j = g.balls.index(n)
    g.balls[k], g.balls[j] = g.balls[j], g.balls[k]
    g.next_at = g.now() - 1
    g.process()


# -- cards
c = BG.new_card(random.Random(1))
cols_ok = all(15 * (i % 5) + 1 <= v <= 15 * (i % 5) + 15 for i, v in enumerate(c["nums"]) if i != BG.FREE)
check("cards: each column holds its own 15 numbers", cols_ok)
check("cards: FREE centre is pre-daubed", c["nums"][BG.FREE] == 0 and c["daub"][BG.FREE])
check("cards: 24 distinct numbers", len({v for v in c["nums"] if v}) == 24)
check("cards: the star is never the FREE cell", BG.FREE not in c["stars"])
check("patterns: 12 lines, corners, blackout", len(P.PATTERNS) == 14)

# -- deal stage
r, g, (a, b) = room()
check("deal: humans start with 2 cards", len(a.g.cards) == 2 and g.stage == "deal")
g.act(a, {"type": "cards", "n": 4})
check("deal: pick 4 cards", len(a.g.cards) == 4)
check("deal: 5 cards refused", raises(lambda: g.act(a, {"type": "cards", "n": 5})))
check("deal: True is not a number", raises(lambda: g.act(a, {"type": "cards", "n": True})))
old = a.g.cards[1]["nums"]
g.act(a, {"type": "reroll", "card": 1})
check("deal: one swap", a.g.cards[1]["nums"] != old and raises(lambda: g.act(a, {"type": "reroll", "card": 0})))
check("deal: no daubing before the balls", raises(lambda: g.act(a, {"type": "daub", "card": 0, "cell": 0})))
g.act(a, {"type": "cards", "n": 1})
g.act(a, {"type": "go"})
check("deal: everyone ready starts the calls early", g.stage == "deal")
g.act(b, {"type": "go"})
check("deal: both ready → calls", g.stage == "call")

# -- daubing and claiming
card = a.g.cards[0]
card["stars"] = [24]  # keep the star out of the way
top = card["nums"][0:5]
check("daub: an uncalled number is refused", raises(lambda: g.act(a, {"type": "daub", "card": 0, "cell": 0})))
check("daub: the FREE cell is refused", raises(lambda: g.act(a, {"type": "daub", "card": 0, "cell": 12})))
check("daub: a bad card index is refused", raises(lambda: g.act(a, {"type": "daub", "card": 3, "cell": 0})))
check("claim: nothing finished → refused", raises(lambda: g.act(a, {"type": "claim"})))
g.golden = set()
for n in top:
    call(g, n)
for i in range(5):
    g.act(a, {"type": "daub", "card": 0, "cell": i})
check("view: the claim hint lights up", g.view(a)["bingo"]["can"])
g.act(a, {"type": "claim"})
# first line (+150) + speed (+50) on 100
check("claim: row + first + speed = 300", a.g.score == 300, a.g.score)
check("claim: the row is scored once", raises(lambda: g.act(a, {"type": "claim"})) and a.g.bingos == 1)

# a column + diagonal finished by the same ball → combo; left cold for 3 balls → half
col = [card["nums"][r * 5] for r in range(1, 5)]  # column 0 below the scored row
diag = [card["nums"][i * 6] for i in (1, 3, 4)]   # d0 minus the corner (row 0) and FREE
for n in col[:-1] + diag:
    call(g, n)
for i in (5, 10, 15, 6, 18, 24):
    g.act(a, {"type": "daub", "card": 0, "cell": i})
call(g, col[-1])  # finishes column 0, and the corners? (0, 4, 20, 24 are daubed now)
g.act(a, {"type": "daub", "card": 0, "cell": 20})
before = a.g.score
ready = {k for _, k, _, _ in g.ready_patterns(a)}
check("multi: one ball finishes column 0, a diagonal and the corners", {"c0", "x4", "d0"} <= ready, ready)
ev = g.claim(a)
check("multi: TRIPLE BINGO name", ev["name"] == "TRIPLE BINGO", ev["name"])
d0 = next(x for x in ev["parts"] if x["key"] == "d0")
check("multi: a pattern done 3+ balls ago went cold (half)", "🧊½" not in d0["tags"] or d0["pts"] == 50)
check("multi: the corners got the first-corners bonus", "🥇+150" in next(x for x in ev["parts"] if x["key"] == "x4")["tags"])
check("multi: combo ×1.5 applied", a.g.score - before == int(sum(x["pts"] for x in ev["parts"]) * 1.5))
check("multi: bingos count lines and corners", a.g.bingos == 4, a.g.bingos)

# golden ball doubles
row1 = [card["nums"][5 + i] for i in range(5) if not card["daub"][5 + i] and card["nums"][5 + i] not in g.calledset]
g.golden = {len(g.called) + len(row1) - 1}
for n in row1:
    call(g, n)
for i in range(5, 10):
    if not card["daub"][i]:
        g.act(a, {"type": "daub", "card": 0, "cell": i})
ev = g.claim(a)
r1 = next((x for x in ev["parts"] if x["key"] == "r1"), None)
check("golden: a line finished by a golden ball doubles", r1 and "✨×2" in r1["tags"], r1)

# lucky star → a free daub on an uncalled number
card["stars"] = [23]
n23 = card["nums"][23]
if n23 not in g.calledset:
    call(g, n23)
free0 = a.g.free  # the diagonal already daubed the old star on cell 24
g.act(a, {"type": "daub", "card": 0, "cell": 23})
check("star: earns a free daub", a.g.free == free0 + 1)
spare = next(i for i in range(25) if not card["daub"][i] and card["nums"][i] not in g.calledset)
g.act(a, {"type": "daub", "card": 0, "cell": spare})
check("star: the free daub marks an uncalled number", card["daub"][spare] and a.g.free == free0)

# -- views never leak other players' cards
v = json.dumps(g.view(b))
check("view: Bo can't see Ann's cards", json.dumps(a.g.cards[0]["nums"]) not in v)
check("view: table shows scores only", all(set(t) == {"id", "score", "rounds", "bingos", "cards", "close", "ready", "frozen"} for t in g.view(b)["bingo"]["table"]))

# -- blackout ends the game
r, g, (a, b) = room()
g.act(a, {"type": "cards", "n": 1})
g.act(a, {"type": "go"}); g.act(b, {"type": "go"})
card = a.g.cards[0]
for n in card["nums"]:
    if n:
        call(g, n)
for i in range(25):
    if not card["daub"][i]:
        g.act(a, {"type": "daub", "card": 0, "cell": i})
g.act(a, {"type": "claim"})
check("blackout: ends the game", r.phase == "over" and g.stage == "over")
check("blackout: 12 lines + corners counted", a.g.bingos == 13, a.g.bingos)

# -- auto mode daubs and claims by itself, without speed bonuses
r, g, (a, b) = room(daub="auto")
g.act(a, {"type": "go"}); g.act(b, {"type": "go"})
check("auto: daubing by hand is refused", raises(lambda: g.act(a, {"type": "daub", "card": 0, "cell": 0})))
g.golden = set()
for n in a.g.cards[0]["nums"][:5]:
    call(g, n)
check("auto: the row was daubed and claimed", "r0" in a.g.cards[0]["got"] and a.g.score >= 100)
check("auto: no speed bonus", all("⚡+50" not in x["tags"] for x in a.g.last["parts"]))

# -- the ball cap ends the game after a grace
r, g, (a, b) = room(balls=45)
g.act(a, {"type": "go"}); g.act(b, {"type": "go"})
for _ in range(60):
    if r.phase != "playing":
        break
    g.on_timeout()
check("cap: 45 balls then game over", r.phase == "over" and len(g.called) == 45, len(g.called))


# ======================================================================== round 2: styles and options


def go(g, *ps):
    for q in ps:
        g.act(q, {"type": "go"})


def fill(g, p, ci, cells):
    """Call and daub these cells of p's card."""
    card = p.g.cards[ci]
    for i in cells:
        n = card["nums"][i]
        if n and not card["daub"][i]:
            call(g, n)
            g.act(p, {"type": "daub", "card": ci, "cell": i})


def settle(g):
    g.skew += 10  # past the claim window / between-rounds pause
    g.process()


# -- shapes
for key, (name, masks) in P.SHAPES.items():
    check(f"shape {key}: cells on the card", all(0 <= c < 25 for m in masks for c in m) and masks)
check("shapes: stamp has a variant per corner", len(P.SHAPES["stamp"][1]) == 4)

# -- 🏁 race: first claim opens a window, a second claim in it shares, then a new round
r, g, (a, b) = room(style="race", rounds=3)
go(g, a, b)
for q in (a, b):
    q.g.cards = q.g.cards[:1]
    q.g.cards[0]["stars"] = [24]
row = [0, 1, 2, 3, 4]
fill(g, a, 0, row)
check("race: a line is claimable", g.claimable(a))
g.act(a, {"type": "claim"})
check("race: the first claim opens a window and holds the caller", g.window and g.next_at is None)
check("race: claiming twice is refused", raises(lambda: g.act(a, {"type": "claim"})))
# Bo finishes a line in the window by free daubs
b.g.free = 5
for i in [0, 1, 3, 4]:
    if not b.g.cards[0]["daub"][i]:
        g.act(b, {"type": "daub", "card": 0, "cell": i})
for i in [2]:
    if not b.g.cards[0]["daub"][i]:
        g.act(b, {"type": "daub", "card": 0, "cell": i})
g.act(b, {"type": "claim"})
settle(g)
check("race: both share the round", a.g.rounds == 1 and b.g.rounds == 1, (a.g.rounds, b.g.rounds))
check("race: winners shown between rounds", g.stage == "between" and len(g.view(b)["bingo"]["result"]["winners"]) == 2)
check("race: the winning card is shown to everyone", g.view(b)["bingo"]["result"]["winners"][0]["nums"] == a.g.cards[0]["nums"])
settle(g)
check("race: round 2 deals fresh cards", g.round == 2 and g.stage == "deal" and g.called == [])
check("race: final_scores are rounds won", g.final_scores() == {a.id: 1, b.id: 1})
# a: win rounds 2 and 3 → the match
for rnd in (2, 3):
    go(g, a, b)
    fill(g, a, 0, [0, 5, 10, 15, 20])
    g.act(a, {"type": "claim"})
    settle(g)
    if r.phase == "playing":
        settle(g)
check("race: best of 3 ends with a winner", r.phase == "over" and a.g.rounds == 3, (r.phase, a.g.rounds, b.g.rounds))

# sudden death after a tie
r, g, (a, b) = room(style="race", rounds=1)
go(g, a, b)
fill(g, a, 0, [0, 1, 2, 3, 4])
b.g.free = 5
for i in [0, 1, 2, 3, 4]:
    if not b.g.cards[0]["daub"][i]:
        g.act(b, {"type": "daub", "card": 0, "cell": i})
g.act(a, {"type": "claim"}); g.act(b, {"type": "claim"})
settle(g); settle(g)
check("race: a tie after the last round plays sudden death", r.phase == "playing" and g.round == 2, (r.phase, g.round))

# -- 🎯 hunt: only the target shape counts
r, g, (a, b) = room(style="hunt", rounds=3)
go(g, a, b)
g.hunt = ["frame"] + [k for k in g.hunt if k != "frame"]
g.target = g.make_target()
fill(g, a, 0, [0, 1, 2, 3, 4])
check("hunt: a plain line isn't the frame", not g.claimable(a))
check("hunt: false claim, no penalty by default", raises(lambda: g.act(a, {"type": "claim"})) and a.g.locked == 0)
fill(g, a, 0, P.SHAPES["frame"][1][0])
check("hunt: the full frame is claimable", g.claimable(a))
check("hunt: target outlined in the view", g.view(a)["bingo"]["target"]["name"] == "Picture frame")

# -- 📈 ladder: stage order, prizes, blackout ends
r, g, (a, b) = room(style="ladder")
go(g, a, b)
g.golden = set()
fill(g, a, 0, [0, 1, 2, 3, 4])
check("ladder: corners can't be claimed in stage 1", g.target["kind"] == "line")
g.act(a, {"type": "claim"}); settle(g)
check("ladder: one line pays 100", a.g.score == 100 and g.target["kind"] == "two", (a.g.score, g.target["kind"]))
check("ladder: the same line alone isn't two lines", not g.claimable(a))
fill(g, a, 0, [20, 21, 22, 23, 24])
g.act(a, {"type": "claim"}); settle(g)
check("ladder: two lines pays 200, then corners", a.g.score == 300 and g.target["kind"] == "corners")
check("ladder: corners already done → claimable", g.claimable(a))
g.act(a, {"type": "claim"}); settle(g)
check("ladder: corners 150 → blackout stage", a.g.score == 450 and g.target["kind"] == "blackout")
fill(g, a, 0, list(range(25)))
g.act(a, {"type": "claim"}); settle(g)
check("ladder: blackout ends the game", r.phase == "over" and a.g.score == 950, (r.phase, a.g.score))

# -- penalties
r, g, (a, b) = room(penalty="lock")
go(g, a, b)
call(g, 75 if 75 not in g.calledset else 74)
check("penalty lock: false claim refused", raises(lambda: g.act(a, {"type": "claim"})))
check("penalty lock: locked for 2 balls", g.view(a)["bingo"]["locked"] == 2)
check("penalty lock: claims refused while locked", "Locked" in (g.can_claim(a) or ""))
r, g, (a, b) = room(penalty="points")
go(g, a, b)
raises(lambda: g.act(a, {"type": "claim"}))
check("penalty points: −50", a.g.score == -50)

# -- sleepers: an unclaimed line dies at the next ball
r, g, (a, b) = room(claims="sleep")
go(g, a, b)
a.g.cards[0]["stars"] = [24]
fill(g, a, 0, [0, 1, 2, 3, 4])
other = next(n for n in range(1, 76) if n not in g.calledset and n not in a.g.cards[0]["nums"])
call(g, other)
check("sleepers: the line slept", "r0" in a.g.cards[0]["slept"] and not g.claimable(a))

# -- power-ups
r, g, (a, b) = room(powerups=True, maxcards=8)
check("power: two stars per card", all(len(c["stars"]) == 2 for c in a.g.cards))
g.act(a, {"type": "cards", "n": 8})
check("maxcards 8: eight cards", len(a.g.cards) == 8 and raises(lambda: g.act(a, {"type": "cards", "n": 9})))
go(g, a, b)
a.g.pw = {"peek": 1, "double": 1, "freeze": 1}
g.act(a, {"type": "power", "kind": "peek"})
nxt = g.balls[len(g.called)]
check("peek: you see the next ball", g.view(a)["bingo"]["peek"] == nxt)
check("peek: others don't", g.view(b)["bingo"]["peek"] is None and str(nxt) not in json.dumps(g.view(b)["bingo"].get("peek")))
call(g, nxt)
check("peek: gone once drawn", g.view(a)["bingo"]["peek"] is None)
check("freeze: needs a rival", raises(lambda: g.act(a, {"type": "power", "kind": "freeze", "target": a.id})))
g.act(a, {"type": "power", "kind": "freeze", "target": b.id})
check("freeze: Bo can't claim", "Frozen" in (g.can_claim(b) or "") and g.view(b)["bingo"]["frozen"] == 2)
check("freeze: used up", raises(lambda: g.act(a, {"type": "power", "kind": "freeze", "target": b.id})))
g.act(a, {"type": "power", "kind": "double"})
g.golden = set()
a.g.cards[0]["stars"] = []
fill(g, a, 0, [0, 1, 2, 3, 4])
before = a.g.score
g.act(a, {"type": "claim"})
check("double: next claim ×2", a.g.score - before == 2 * a.g.last["parts"][0]["pts"] and not a.g.double)

# -- daub all
n = g.called[-1]
held = [(ci, i) for ci, c in enumerate(b.g.cards) for i, v in enumerate(c["nums"]) if v == n]
if held:
    g.act(b, {"type": "daub_all"})
    check("daub all: marks the latest ball on every card", all(b.g.cards[ci]["daub"][i] for ci, i in held))
else:
    check("daub all: nothing to daub is refused", raises(lambda: g.act(b, {"type": "daub_all"})))


# -- the browser's copy of the shapes (static/games/bingokit.js) matches games/bingo_patterns.py
import subprocess  # noqa: E402
try:
    out = subprocess.run(["node", "-e", "const K = require('./static/games/bingokit.js'); console.log(JSON.stringify({s: K.SHAPES, l: K.LINES}))"],
                         cwd=ROOT, capture_output=True, text=True, timeout=30).stdout
    js = json.loads(out)
    check("kit: shapes match the server's", {k: [v[0], v[1]] for k, v in js["s"].items()} == {k: [n, m] for k, (n, m) in P.SHAPES.items()})
    check("kit: lines match the server's", js["l"] == P.LINES)
except (OSError, ValueError) as e:
    check("kit: node available for the shape check", False, e)

print(f"\n{len(fails)} failed" if fails else "\nall ok")
sys.exit(1 if fails else 0)
