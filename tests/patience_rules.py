"""FreeCell and Solitaire (Klondike) rules on real rooms: the same deal for everyone, move legality
(colours and ranks, the run limit, kings only into empty Solitaire columns, draw three and the
turn-over), undo, face-down cards never sent to any browser, scoring with the first-clear bonus, the
hard FreeCell bot clearing deals, and a race of bots running to the end on the clock.

    python3 tests/patience_rules.py        # 10-20 seconds
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import freecell as F  # noqa: E402
from games import klondike as KL  # noqa: E402
from games import patience as PT  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(name, fn):
    try:
        fn()
        check(name, False, "was allowed")
    except GameError as e:
        check(name, True, str(e))


def room_for(gid, bots=(), **settings):
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    for lvl in bots:
        room.add_bot(lvl)
    room.switch_game(gid)
    room.settings.update(settings)
    room.start()
    return room, ann, room.game


def run_clock(room, g, limit=20000):
    """Fast-forward the bots and the clock to the end of the game."""
    n = 0
    while room.phase == "playing" and n < limit:
        g.on_timeout()
        n += 1
    return n


# ---------------------------------------------------------------- FreeCell
room, ann, g = room_for("freecell", bots=("hard",))
bot = [p for p in room.players.values() if p.bot][0]
check("everyone gets the same deal", g.boards[ann.id] == g.boards[bot.id])
b = g.boards[ann.id]
check("52 cards between the columns and home", sum(map(len, b["t"])) + PT.Patience.home(b) == 52)
check("no ace is left on top (they fly home at the deal)", not any(c and c[-1][0] == "A" for c in b["t"]))

# a hand-made board to test the rules on
g.boards[ann.id] = b = {"t": [["KS", "QS"], ["5C"], ["9D", "8C", "7H", "6S"], [], ["TC"], ["2H"], ["3S"], ["JD"]],
                        "c": [None, None, None, None], "f": {"S": 0, "H": 1, "D": 0, "C": 0}}
g.s["automove"] = False
refused("same colour refused", lambda: g.act(ann, {"type": "move", "src": "t1", "n": 1, "dst": "t6"}))
refused("not one lower refused", lambda: g.act(ann, {"type": "move", "src": "t4", "n": 1, "dst": "t0"}))
refused("a broken run can't move together", lambda: g.act(ann, {"type": "move", "src": "t0", "n": 2, "dst": "t3"}))
refused("bad pile names are refused", lambda: g.act(ann, {"type": "move", "src": "t9", "n": 1, "dst": "c"}))
refused("n must be a number", lambda: g.act(ann, {"type": "move", "src": "t1", "n": "1", "dst": "c"}))
g.act(ann, {"type": "move", "src": "t2", "n": 4, "dst": "t3"})      # 4 free cells, 0 other empty columns: 5 fit
check("a run of four moves into an empty column", b["t"][3] == ["9D", "8C", "7H", "6S"] and b["t"][2] == [])
g.act(ann, {"type": "move", "src": "t5", "n": 1, "dst": "f"})
check("2♥ goes home on the A♥", b["f"]["H"] == 2)
for k, c in enumerate(["t1", "t4", "t6", "t7"]):
    g.act(ann, {"type": "move", "src": c, "n": 1, "dst": "c"})
check("four cards in the free cells", all(b["c"]))
refused("a fifth card has no free cell", lambda: g.act(ann, {"type": "move", "src": "t0", "n": 1, "dst": "c"}))
check("the run limit follows the cells and columns", F.capacity(0, 3, True) == 4 and F.capacity(2, 1, False) == 6)
g.act(ann, {"type": "undo"})
check("undo takes the last move back", b is not g.boards[ann.id] and g.boards[ann.id]["c"][3] is None)

# a finished deal: Ann clears first and gets the bonus
room, ann, g = room_for("freecell", bots=("easy",))
easy = [p for p in room.players.values() if p.bot][0]
g.plans = []   # the bot sits still
plan = F.solve(g.boards[ann.id], 5.0)
check("the solver clears the deal", plan is not None, f"{len(plan or [])} moves")
for src, n, dst, card in plan or []:
    bb = g.boards[ann.id]
    here = bb["c"][int(src[1])] if src[0] == "c" else (bb["t"][int(src[1])][-n] if len(bb["t"][int(src[1])]) >= n else None)
    if here != card:
        continue   # it flew home by itself
    g.act(ann, {"type": "move", "src": src, "n": n, "dst": dst})
check("Ann cleared the deal", ann.id in g.done)
g.act(easy, {"type": "bank"})
check("the deal ends once the other player calls it a day", g.stage == "reveal")
home_easy = PT.Patience.home(g.boards[easy.id])
check("clearing first pays 52 + 10 + 5", g.gained[ann.id] == 52 + PT.CLEAR + PT.FIRST, g.gained)
check("calling it a day keeps the cards home", g.gained[easy.id] == home_easy, g.gained)
used = any(d[0] == "c" for _, _, d, _ in plan or [])
check("free-cell use is tracked for the cold cells badge", (ann.id in g.cell_used) == used, f"used={used}")

# the hard bot clears seeded deals inside its budget
k = F.FreeCell.__new__(F.FreeCell)
k.s, k.rng, k.bot_state = {"automove": True}, random.Random(3), {}
won = 0
for seed in range(20, 26):
    bb = k.deal_board(random.Random(seed))
    p = type("P", (), {"id": f"h{seed}", "bot": "hard"})()
    for _ in range(800):
        a = k.bot_move(p, bb)
        if a is None:
            break
        k.apply(bb, a)
    won += PT.Patience.home(bb) == 52
check("the hard bot clears most deals", won >= 5, f"{won}/6")

# a bot race runs to the end on the clock
room, ann, g = room_for("freecell", bots=("easy", "normal", "hard"), rounds=3)
room.players[ann.id].bot = "normal"   # autopilot for Ann
steps = run_clock(room, g)
check("a three-deal bot race finishes", room.phase == "over", f"{steps} steps")
check("scores are kept", all(isinstance(v, int) for v in g.final_scores().values()), g.final_scores())

# ---------------------------------------------------------------- Solitaire
room, ann, g = room_for("klondike", bots=("normal",), draw=3)
bot = [p for p in room.players.values() if p.bot][0]
b = g.boards[ann.id]
check("seven columns, 1 to 7 cards, 24 in the stock", [len(c) for c in b["t"]] == list(range(1, 8)) and len(b["stock"]) == 24)
v = g.view(ann)["klondike"]
shown = json.dumps(v)
hidden = [c for i, col in enumerate(b["t"]) for c in col[:b["down"][i]]] + b["stock"]
check("face-down cards and the stock never reach the browser", not any(f'"{c}"' in shown for c in hidden))
check("rivals show only progress", all(set(r) == {"id", "home", "done", "banked", "score"} for r in v["rivals"]))
g.plans = []
g.act(ann, {"type": "draw"})
check("drawing three turns three cards", len(b["waste"]) == 3 and len(b["stock"]) == 21)
for _ in range(7):
    g.act(ann, {"type": "draw"})
check("the stock runs out", not b["stock"] and len(b["waste"]) == 24)
g.act(ann, {"type": "draw"})
check("tapping the empty stock turns the waste over", len(b["stock"]) == 24 and not b["waste"] and b["passes"] == 1)

g.boards[ann.id] = b = {"t": [["QS", "5D"], ["6C"], [], ["KH"], ["9S"], ["TH"], ["4C"]], "down": [1, 0, 0, 0, 0, 0, 0],
                        "stock": [], "waste": ["KC", "AD"], "f": {"S": 0, "H": 0, "D": 0, "C": 3}, "passes": 0}
refused("only a king fills an empty column", lambda: g.act(ann, {"type": "move", "src": "t4", "n": 1, "dst": "t2"}))
refused("a face-down card can't move", lambda: g.act(ann, {"type": "move", "src": "t0", "n": 2, "dst": "t2"}))
refused("same colour refused", lambda: g.act(ann, {"type": "move", "src": "t1", "n": 1, "dst": "t4"}))
g.act(ann, {"type": "move", "src": "t0", "n": 1, "dst": "t1"})
check("5♦ on 6♣, and the Q♠ under it turns face up", b["t"][1] == ["6C", "5D"] and b["down"][0] == 0)
g.act(ann, {"type": "move", "src": "w", "n": 1, "dst": "f"})
g.act(ann, {"type": "move", "src": "w", "n": 1, "dst": "t2"})
check("A♦ home and K♣ into the empty column", b["f"]["D"] == 1 and b["t"][2] == ["KC"])
g.act(ann, {"type": "move", "src": "t6", "n": 1, "dst": "f"})
g.act(ann, {"type": "move", "src": "f3", "n": 1, "dst": "t1"})
check("a foundation card can come back down", b["f"]["C"] == 3 and b["t"][1][-1] == "4C")
refused("an empty waste has nothing to move", lambda: g.act(ann, {"type": "move", "src": "w", "n": 1, "dst": "f"}))

# bots play from what they can see: their move is the same whatever the face-down cards are
k = KL.Klondike.__new__(KL.Klondike)
k.s, k.rng = {"draw": 1}, random.Random(1)
same = True
for seed in range(10):
    b1 = k.deal_board(random.Random(seed))
    b2 = json.loads(json.dumps(b1))
    downs = [c for i, col in enumerate(b2["t"]) for c in col[:b2["down"][i]]] + b2["stock"]
    random.Random(seed + 99).shuffle(downs)
    it = iter(downs)
    for i, col in enumerate(b2["t"]):
        for j in range(b2["down"][i]):
            col[j] = next(it)
    b2["stock"] = list(it)
    p1 = type("P", (), {"id": "x", "bot": "hard"})()
    k.bot_state = {}
    m1 = k.bot_move(p1, b1)
    k.bot_state = {}
    m2 = k.bot_move(p1, b2)
    same &= m1 == m2
check("the bot doesn't peek at face-down cards", same)

room, ann, g = room_for("klondike", bots=("easy", "hard"), rounds=1)
room.players[ann.id].bot = "hard"
steps = run_clock(room, g)
check("a Solitaire bot race finishes", room.phase == "over", f"{steps} steps")

room, ann, g = room_for("klondike")
check("solo: one player, no rivals but yourself", len(g.view(ann)["klondike"]["rivals"]) == 1)
g.act(ann, {"type": "bank"})
check("solo: calling it a day ends the deal", g.stage == "reveal")
run_clock(room, g)
check("solo: not clearing the deal is not a win", room.phase == "over")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
