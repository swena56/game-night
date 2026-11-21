"""Five Hundred Contra option: opponents may double; scoring x2; off by default; old rooms; bots legal; fires.

    python3 tests/fivehundred_contra.py
"""
import os
import sys
import pickle

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room_of(n=4, contra=None, tag="C"):
    room = server.Room(tag)
    for k in range(n):
        room.add_player(f"P{k}")
    room.switch_game("fivehundred")
    if contra is not None:
        room.settings["contra"] = contra
    room.start()
    return room, room.game


def finish_hand(g, contract, took, doubled):
    g.score = [0] * g.sides
    g.contract, g.bidder, g.doubled = contract, 0, doubled
    g.tricks = list(took)
    g.end_hand()
    return g.score[:]


room, g = room_of(4)
check("default off", g.s["contra"] == 0)
s = finish_hand(g, "7H", [4, 1, 3, 2], None)
check("undoubled make 7H = 200", s[0] == 200, s)
room, g = room_of(4, 1, "D")
s = finish_hand(g, "7H", [4, 1, 3, 2], 1)
check("doubled make = 400", s[0] == 400, s)
s = finish_hand(g, "7H", [2, 3, 2, 3], 1)
check("doubled down = -400, opps +60", s == [-400, 60], s)
s = finish_hand(g, "6S", [5, 2, 3, 0], 3)
check("doubled slam 10 = 500 not 80", finish_hand(g, "6S", [5, 0, 5, 0], 1)[0] == 500)
room, g = room_of(3, 1, "T")
check("3p doubled down", finish_hand(g, "8S", [5, 3, 2], 2)[0] == -480, finish_hand(g, "8S", [5, 3, 2], 2))

# flow with the stage, rigged
room, g = room_of(4, 1, "F")
g.deal()
g.contract, g.bidder = "7H", 0
g.win_auction()
g.drop(0, g.bot_drop(0, "normal"))
check("stage contra after discard", g.stage == "contra" and room.turn == g.seats[1], g.stage)
g.act(room.players[g.seats[1]], {"type": "contra", "double": False})
check("next opponent asked", g.stage == "contra" and room.turn == g.seats[3])
try:
    g.act(room.players[g.seats[3]], {"type": "contra", "double": True})
except Exception as e:
    check("double accepted", False, str(e))
check("doubled then play, bidder leads", g.stage == "play" and g.doubled == 3 and room.turn == g.seats[0])
# partner can't double; wrong-turn refused
room, g = room_of(4, 1, "G")
g.contract, g.bidder = "7H", 0
g.win_auction(); g.drop(0, g.bot_drop(0, "normal"))
try:
    g.act(room.players[g.seats[2]], {"type": "contra", "double": True}); ok = False
except Exception:
    ok = True
check("partner / off-turn refused", ok and g.doubled is None)
# misere and off setting never ask
room, g = room_of(4, 1, "H")
g.contract, g.bidder = "M", 0
g.win_auction(); g.drop(0, g.bot_drop(0, "normal"))
check("misere not doubled", g.stage == "play")
room, g = room_of(4, 0, "I")
g.contract, g.bidder = "7H", 0
g.win_auction(); g.drop(0, g.bot_drop(0, "normal"))
check("off: straight to play", g.stage == "play")
# old room object without the new attrs, and pickle mid-contra
room, g = room_of(4, 1, "J")
g.contract, g.bidder = "7H", 0
g.win_auction(); g.drop(0, g.bot_drop(0, "normal"))
g2 = pickle.loads(pickle.dumps(room)).game
check("pickle mid-contra", g2.stage == "contra" and list(g2.contra_q) == list(g.contra_q))
for a in ("doubled", "contra_q"):
    g2.__dict__.pop(a, None)
check("old object defaults", g2.doubled is None and not g2.contra_q)
g.s.pop("contra", None)
check("old room w/o setting (get)", g.s.get("contra") is None)


# offer order starts left of the bidder; partner never asked; all-pass; timeout; leaving
def rigged(n, tag, bidder):
    room, g = room_of(n, 1, tag)
    g.contract, g.bidder = "7H", bidder
    g.win_auction(); g.drop(bidder, g.bot_drop(bidder, "normal"))
    return room, g

room, g = rigged(4, "O1", 1)
check("4p order from bidder's left, no partner", list(g.contra_q) == [2, 0], g.contra_q)
room, g = rigged(3, "O2", 1)
check("3p order from bidder's left", list(g.contra_q) == [2, 0], g.contra_q)
for n in (3, 4):
    room, g = rigged(n, f"AP{n}", 0)
    asked = list(g.contra_q)
    for k in asked:
        check(f"{n}p turn is seat {k}", room.turn == g.seats[k])
        g.act(room.players[g.seats[k]], {"type": "contra", "double": False})
    check(f"{n}p all pass -> play, bidder leads", g.stage == "play" and g.doubled is None and room.turn == g.seats[0])
    check(f"{n}p no stale queue", not g.contra_q)
    for p_ in room.players.values():
        g.view(p_)
# timeouts: human passes, stage advances, nothing sticks
room, g = rigged(4, "TO", 0)
first = g.contra_q[0]
room.deadline = 0
g.on_timeout()
check("timeout passes, next opponent", g.stage == "contra" and room.turn == g.seats[g.contra_q[0]] and g.contra_q[0] != first and g.doubled is None)
g.on_timeout()
check("last timeout -> play, undoubled", g.stage == "play" and g.doubled is None and room.turn == g.seats[0])
# leaving mid-contra: the seat plays itself, no stall
for n in (3, 4):
    room, g = rigged(n, f"LV{n}", 0)
    for k in list(g.contra_q):
        room.players[g.seats[k]].eliminated = True
    for _ in range(10):
        if g.stage != "contra":
            break
        g.bot_tick()
        room.bot_at = 0
    check(f"{n}p leavers mid-contra: no stall", g.stage == "play", g.stage)
room, g = rigged(4, "LV9", 0)
q0 = g.contra_q[0]
room.leave(room.players[g.seats[q0]])
for _ in range(10):
    if g.stage != "contra":
        break
    g.bot_tick(); room.bot_at = 0
    if g.stage == "contra" and g.seats[room.turn and g.seats.index(room.turn)] in room.players:
        g.act(room.players[room.turn], {"type": "contra", "double": False})   # the other human passes
check("real leave mid-contra: no stall", g.stage == "play", g.stage)

# bot play
fired = hands = 0
for n in range(24):
    room, g = room_of(4 if n % 2 else 3, 1, f"S{n}")
    level = ["easy", "normal", "hard"][n % 3]
    for p in list(room.players.values())[1:]:
        pass
    orig_say, orig_hand = g.say_contra, g.end_hand
    cnt = [0, 0]

    def say(i, yes, g=g, o=orig_say, cnt=cnt):
        cnt[0] += 1
        cnt[1] += yes
        return o(i, yes)
    g.say_contra = say
    orig_play = g.play

    def play(i, c, g=g, o=orig_play):
        assert c in g.legal(i), "illegal bot card"
        return o(i, c)
    g.play = play
    for _ in range(4000):
        if room.phase != "playing":
            break
        if g.stage == "score":
            g.deal()
            continue
        k = g.seats.index(room.turn)
        g.bot_move(k, level)
        for p in room.players.values():
            g.view(p)
    check(f"game {n} ({level}) ends", room.phase != "playing")
    hands += g.hand_no
    fired += cnt[1]
print("doubles", fired, "in", hands, "hands")
check("fires at least once", fired >= 1)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
