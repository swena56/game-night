"""Rules checks for the 🃏 card-table games (games/cardbase.py): Cheat's call, President's beats,
Euchre's bowers, Spades' lead rule, Oh Hell's dealer hook, Knock Out Whist knock-outs, and every view
hiding the other hands.

    python3 tests/cardtable_rules.py        # a few seconds
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
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


def room_for(gid, n=4, **settings):
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    room.settings = server.default_settings(gid)
    room.settings.update(settings)
    for _ in range(n - 1):
        room.add_bot("normal")
    random.seed(7)
    room.start()
    return room, ann


def hidden(room, gid):
    """No viewer's view holds another seat's hand."""
    g = room.game
    for p in room.players.values():
        v = json.dumps(room.view(p))
        i = g.seat(p)
        for k in range(g.n):
            if k == i or not g.hands[k]:
                continue
            mine = set(g.hands[i]) if i is not None else set()
            others = [c for c in g.hands[k] if c not in mine]
            if others and all(f'"{c}"' in v for c in others) and len(others) > 2:
                return False
    return True


# -- Cheat
room, ann = room_for("cheat")
g = room.game
i = g.seat(ann)
g.stage = "play"
room.turn = ann.id
g.hands[i] = ["AS", "5H", "9C"]
g.need = "A"
g.act(ann, {"type": "play", "cards": ["5H"], "rank": "A"})
check("cheat: a play opens the call window for the others", g.stage == "call" and i not in g.waiting and len(g.waiting) == g.n - 1)
caller = next(iter(g.waiting))
before = len(g.hands[i])
g.do_call(caller)
check("cheat: a caught liar takes the pile", len(g.hands[i]) == before + 1 and g.reveal["liar"])
check("cheat: views hide the other hands", hidden(room, "cheat"))
refused("cheat: can't claim the wrong rank", lambda: (setattr(g, "stage", "play"), setattr(room, "turn", ann.id), setattr(g, "after", None),
                                                    g.act(ann, {"type": "play", "cards": [g.hands[i][0]], "rank": "7"})))

# -- President
room, ann = room_for("president")
g = room.game
g.pile = [[1, ["9H", "9S"]]]
check("president: a higher pair beats a pair", g.beats(["JC", "JD"]))
check("president: a single can't beat a pair", not g.beats(["2C"]))
check("president: a lower pair can't", not g.beats(["4C", "4D"]))
check("president: 2 is high", g.beats(["2C", "2D"]))

# -- Euchre bowers
room, ann = room_for("euchre")
g = room.game
g.trump = "H"
check("euchre: the jack of trumps is top", g.power("JH") > g.power("JD") > g.power("AH"))
check("euchre: the left bower counts as a trump", g.suit_of("JD") == "H" and g.suit_of("JC") == "C")
g.stage, g.trick = "play", [(1, "9H")]
k = g.seat(ann)
g.hands[k] = ["JD", "AS", "KC"]
check("euchre: the left bower must follow trumps", g.legal(k) == ["JD"])

# -- Spades
room, ann = room_for("spades")
g = room.game
k = g.seat(ann)
g.stage, g.trick, g.broken = "play", [], False
g.hands[k] = ["AS", "3H", "4D"]
check("spades: no leading spades before they're broken", "AS" not in g.legal(k))
g.hands[k] = ["AS", "KS"]
check("spades: unless you hold only spades", g.legal(k) == ["AS", "KS"])

# -- Oh Hell hook
room, ann = room_for("ohhell")
g = room.game
g.size, g.bids = 5, [2, 1, 1, None]
g.dealer = 3
check("oh hell: the dealer can't make the bids add up", g.banned(3) == 1)
g.s["hook"] = False
check("oh hell: unless the hook is off", g.banned(3) is None)

# -- Knock Out Whist
room, ann = room_for("kowhist", n=3)
g = room.game
g.tricks = [4, 3, 0]
g.trick, g.stage = [], "play"
g.hands = [[], [], []]
g.end_hand()
check("knock out whist: no tricks knocks you out", g.knocked == [False, False, True])
check("knock out whist: most tricks picks trumps", g.chooser == 0)

# -- Bridge: the declarer plays dummy's cards
room, ann = room_for("bridge", n=4)
g = room.game
me = g.seat(ann)
g.calls = []
g.stage = "bid"
g.calls = [(me, "1S"), ((me + 1) % 4, "P"), ((me + 2) % 4, "P"), ((me + 3) % 4, "P")]
g.won_auction()
check("bridge: the first to name the strain declares", g.declarer == me and g.dummy == (me + 2) % 4)
lead = (me + 1) % 4
g.play(lead, g.legal(lead)[0])
check("bridge: dummy's turn goes to the declarer", room.turn == ann.id and g.cur == g.dummy)
v = room.view(ann)["bridge"]
check("bridge: the declarer sees dummy's cards to play", v.get("rows") and set(m["card"] for m in v["moves"]) <= set(g.hands[g.dummy]))
c = g.legal(g.dummy)[0]
room.game.act(ann, {"type": "play", "card": c})
check("bridge: the declarer plays dummy's card", c not in g.hands[g.dummy] and g.cur == (me + 3) % 4)
check("bridge: contract scores", server.GAMES["bridge"] and __import__("games.bridge", fromlist=["x"]).contract_score(4, "S", 0, False, 10) == 420
      and __import__("games.bridge", fromlist=["x"]).contract_score(3, "N", 1, True, 7) == -500)

# -- every game runs bot-only to the end with every view serialising
for gid, n in [("cheat", 3), ("president", 4), ("spoons", 4), ("kowhist", 3), ("spades", 4), ("ohhell", 4), ("euchre", 4), ("bridge", 4), ("canasta", 2), ("bezique", 2)]:
    room = server.Room("SIM")
    h = room.add_player("Host")
    room.settings = server.default_settings(gid)
    for _ in range(n - 1):
        room.add_bot("normal")
    h.bot = "hard"
    room.start()
    steps = 0
    while room.phase == "playing" and steps < 20000:
        steps += 1
        room.bot_at = 0
        if room.game.bot_ready():
            room.game.bot_tick()
        elif room.deadline:
            room.game.on_timeout()
        else:
            break
        if steps % 7 == 0:
            for p in room.players.values():
                json.dumps(room.view(p))
    check(f"{gid}: a bot game finishes", room.phase == "over", f"{steps} steps")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
