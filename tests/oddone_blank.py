"""Odd One Out 🫥 Blank (off by default): the odd one's word is the blank, everyone else has the common word;
bots still play a whole game. A rematch uses word pairs not played tonight.

    python3 tests/oddone_blank.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import oddone  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(blank):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in ("Ann", "Bo", "Cy", "Di")]
    r.switch_game("oddone")
    if blank is not None:
        r.settings["blank"] = blank
    r.start()
    return r, r.game, ps


r, g, ps = table(None)
check("off by default: the odd one has a real word", r.players[g.odd].g.word not in (None, oddone.BLANK))
first = set(map(tuple, g.pairs[:g.s["rounds"]]))
r.start()
check("a rematch plays new pairs", not first & set(map(tuple, r.game.pairs[:r.game.s["rounds"]])))

r, g, ps = table(True)
odd = r.players[g.odd]
check("blank: the odd one has the blank", odd.g.word == oddone.BLANK and all(p.g.word == g.common for p in ps if p.id != g.odd))
for p in ps:
    p.bot = "normal"
for _ in range(300):
    if r.phase != "playing":
        break
    if g.bot_ready():
        g.bot_tick()
    else:
        g.on_timeout()
check("bots play a whole Blank game", r.phase == "over")

r, g, ps = table(False)
g.stage = "vote"
g.odd = ps[1].id
ps[1].g.word = g.odd_word
for p in ps:
    if p.id != g.odd:
        p.g.word = g.common
g.votes = {ps[0].id: ps[1].id, ps[1].id: ps[0].id, ps[2].id: ps[1].id}
locked_votes = dict(g.votes)
g.count_votes()
check("unique accused gets a defense turn", g.stage == "defense" and g.defender == ps[1].id)
view = g.view(ps[1])["oddone"]
check("defense does not reveal who is odd", view["odd"] is None and view["oddWord"] is None and view["result"] is None)
try:
    g.act(ps[0], {"type": "defend", "text": "careful"})
    rejected = False
except GameError:
    rejected = True
check("only accused player can defend", rejected)
g.act(ps[1], {"type": "defend", "text": "careful"})
check("defense is shown before resolution and votes stay locked",
      g.stage == "defense_reveal" and g.defense == "careful" and g.votes == locked_votes and g.result is None)
view = g.view(ps[1])["oddone"]
check("defense reveal still hides role", view["odd"] is None and view["defense"] == "careful")
g.on_timeout()
check("vote result resolves after defense", g.stage == "guess" and g.result["caught"] and g.votes == locked_votes)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
