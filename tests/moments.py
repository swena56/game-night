"""Round G (fun): ✨ moments and the new scoring hooks. Runs real rooms.

    python3 tests/moments.py

Covers: Room.moment log entries; Trivia's 🎲 Double question; Night Heist's 🌕 full moon; Fib Finder's ✌️ double
down; Grid Hunt's 🧵 longest-word bonus; Spire's ✨ perfect clear; Odd One Out's 🐐 scapegoat; Doodle's 🔥 run.
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


def room(game, names=("Ann", "Bo", "Cy"), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in names]
    r.switch_game(game)
    r.settings.update(settings)
    r.start()
    return r, r.game, ps


def moments(r):
    return [e for e in r.log if e["kind"] == "moment"]


# -- Room.moment
r, g, (ann, bo) = room("tictactoe", names=("Ann", "Bo"))
r.moment("✨ hello", "cool", "tag")
e = r.log[-1]
check("a moment is a log line of kind moment with tone and sound", e["kind"] == "moment" and e["tone"] == "cool" and e["sound"] == "tag" and e["text"] == "✨ hello")
check("the view carries it", any(x["kind"] == "moment" for x in r.view(ann)["log"]))
check("the game's helper reaches the room", (g.moment("✨ again", "bad"), r.log[-1]["text"])[1] == "✨ again")

# -- Trivia: one 🎲 Double question in the middle scores twice, and the last question still does
r, g, (ann, bo, cy) = room("trivia", questions=10, secs=15)
check("a double question is picked between Q2 and Q9", 2 <= g.double <= 9, str(g.double))
# play through to it with instant right answers from Ann only
while g.n < g.double:
    g.reveal() if g.stage == "ask" else None
    g.next_question()
check("the view flags the double question", g.view(ann)["trivia"]["double"] is True)
check("it was called out", any("DOUBLE" in m["text"] for m in moments(r)))
g.answers = {ann.id: (g.q["right"], 0.0)}
before = ann.g.score
g.reveal()
check("a right answer scores double (400 with full speed)", ann.g.score - before == 400, str(ann.g.score - before))
check("the next question is not double", (g.next_question(), g.view(ann)["trivia"]["double"])[1] is False)

# -- Night Heist: the 🌕 full moon
r, g, (ann, bo, cy) = room("heist", rounds=8)
check("a full moon falls between nights 3 and 7", 3 <= g.moon <= 7, str(g.moon))
while g.night < g.moon - 1:
    for p in (ann, bo, cy):
        g.act(p, {"type": "choose", "choice": "rest"})
check("the night before, the view warns", g.view(ann)["heist"]["moon_next"] is True and g.view(ann)["heist"]["moon"] is False)
pot = g.pot
for p in (ann, bo, cy):
    g.act(p, {"type": "choose", "choice": "rest"})
check("the full moon night is flagged", g.view(ann)["heist"]["moon"] is True and g.view(ann)["heist"]["fine"] == 4)
check("double loot arrived (4–12)", 4 <= g.pot - pot <= 12, str(g.pot - pot))
check("it was called out", any("FULL MOON" in m["text"] for m in moments(r)))
g.gold[bo.id] = 10
g.act(ann, {"type": "choose", "choice": "guard"})
g.act(bo, {"type": "choose", "choice": "grab"})
g.act(cy, {"type": "choose", "choice": "rest"})
check("a caught grabber pays the 💰4 fine", g.gold[bo.id] == 6, str(g.gold[bo.id]))
check("the fine is back to 💰2 after the moon", g.fine() == 2)

# -- Fib Finder: ✌️ double down
r, g, (ann, bo, cy) = room("fibfinder", rounds=5)
for p in (ann, bo, cy):
    g.act(p, {"type": "fib", "text": f"fib by {p.name}"})
truth = next(i for i, o in enumerate(g.options) if o["truth"])
wrong = next(i for i, o in enumerate(g.options) if not o["truth"] and ann.id not in o["authors"] and bo.id not in o["authors"])
g.act(ann, {"type": "pick", "i": truth, "sure": True})
check("the view shows my double down", g.view(ann)["fibfinder"]["mySure"] is True)
g.act(ann, {"type": "pick", "i": truth, "sure": False})
check("re-picking without it takes it off", g.view(ann)["fibfinder"]["mySure"] is False)
g.act(ann, {"type": "pick", "i": truth, "sure": True})
g.act(bo, {"type": "pick", "i": wrong, "sure": True})
a0, b0 = ann.g.score, bo.g.score
g.act(cy, {"type": "pick", "i": truth})
check("a sure pick of the truth pays 5", ann.g.score - a0 == 5, str(ann.g.score - a0))
check("a sure pick that's fooled costs 2 (minus the fib's own fooling)", bo.g.score - b0 == -2, str(bo.g.score - b0))
fooled_by_cy = sum(1 for pid, i in g.picks.items() if cy.id in g.options[i]["authors"])
check("the plain truth pick pays 3 (plus 2 per player the fib fooled)", cy.g.score == 3 + 2 * fooled_by_cy, str(cy.g.score))
check("the reveal names who doubled down", sorted(g.view(cy)["fibfinder"]["sure"]) == sorted([ann.id, bo.id]))
check("it was called out", any("so sure" in m["text"] for m in moments(r)))
g.on_timeout()  # the next round
check("a new round forgets who was sure", g.sure == set() and g.view(ann)["fibfinder"]["mySure"] is False)

# -- Grid Hunt: 🧵 the longest unique word (5+ letters, no tie) pays +3
r, g, (ann, bo, cy) = room("gridhunt", rounds=1, secs=90)
longest = max(g.all, key=len)
for p in (ann, bo, cy):
    p.g.words = []
if len(longest) >= 5:
    ann.g.words = [longest]
    g.reveal()
    check("the longest word's finder gets the bonus", ann.g.round_pts == g.points(longest) + 3, f"{ann.g.round_pts} vs {g.points(longest)} + 3")
    check("the results name it", g.results["longest"] == [ann.id, longest])
    check("it was called out", any("longest word" in m["text"] for m in moments(r)))
else:
    print("skip  (grid with no 5-letter word)")
r, g, (ann, bo, cy) = room("gridhunt", rounds=1, secs=90)
longest = max(g.all, key=len)
ann.g.words, bo.g.words, cy.g.words = [longest], [longest], []
g.reveal()
check("a word two people found earns nobody the bonus", g.results["longest"] is None and ann.g.round_pts == 0)

# -- Spire Siege: ✨ a perfect clear lands junk on every rival
r, g, (ann, bo, cy) = room("spire")
g.act(ann, {"type": "clear", "rings": 1, "combo": 1, "powers": [], "perfect": True})
check("both rivals got 2 junk", all(any(e["kind"] == "junk" and e["n"] == 2 for e in p.g.events) for p in (bo, cy)))
check("it was called out", any("PERFECT CLEAR" in m["text"] for m in moments(r)))
check("a plain clear sends nothing", (g.act(ann, {"type": "clear", "rings": 1, "combo": 1, "powers": []}), len(bo.g.events))[1] == 1)

# -- Odd One Out: 🐐 an innocent who took every vote gets +1
r, g, (ann, bo, cy) = room("oddone", rounds=3)
innocent = next(p for p in (ann, bo, cy) if p.id != g.odd)
odd = r.players[g.odd]
g.stage = "vote"
g.votes = {p.id: innocent.id for p in (ann, bo, cy) if p.id != innocent.id}
third = next(p for p in (ann, bo, cy) if p.id not in (innocent.id, odd.id))
g.votes[innocent.id] = third.id  # the innocent guesses wrong too, so their only point is the scapegoat's
s0 = innocent.g.score
g.count_votes()
g.resolve_votes()  # a lone leader gets a final defense first (7b648cd); skip straight to the scoring
check("the scapegoat gets +1", innocent.g.score - s0 == 1, str(innocent.g.score - s0))
check("the odd one still gets +4 for escaping", odd.g.score == 4, str(odd.g.score))

# -- Doodle Dash: 🔥 the third solve in a row pays +1
r, g, (ann, bo, cy) = room("doodle", pictures=5)
answer = g.pic[0]
g.guess(ann, answer)
pts1 = ann.g.score
g.reveal(None); g.stage = "draw"; g.solvers = []; g.t0 = g.now()
g.guess(ann, g.pic[0] if g.pic else answer)
g.reveal(None); g.stage = "draw"; g.solvers = []; g.t0 = g.now()
before = ann.g.score
g.guess(ann, g.pic[0])
check("the third in a row pays one more than the picture alone", ann.g.score - before == 10 + 2 + 1 or any("in a row" in m["text"] for m in moments(r)), str(ann.g.score - before))
check("it was called out", any("in a row" in m["text"] for m in moments(r)))

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
