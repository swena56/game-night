"""Ecarte bold bonus: play as dealt and win for +1; off by setting; old rooms; bots legal; fires often.

    python3 tests/ecarte_bold.py
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


def room_of(bold=None, tag="E"):
    room = server.Room(tag)
    for k in range(2):
        room.add_player(f"P{k}")
    room.switch_game("ecarte")
    if bold is not None:
        room.settings["bold"] = bold
    room.start()
    return room, room.game


def end(g, tricks, dealt, bold=None, tag="E"):
    g.tricks = list(tricks); g.played_dealt = dealt; g.refused = None
    g.score = [0, 0]
    g.end_hand()
    return g.score[:]


room, g = room_of()
check("default on", g.s["bold"] == 1)
check("dealt winner 3 tricks +2", end(g, [3, 2], 0) == [2, 0])
check("dealt loser: rival 2, no bold", end(g, [2, 3], 0) == [0, 2])
check("vole as dealt +3", end(g, [5, 0], 0) == [3, 0])
check("no dealt: plain 1", end(g, [3, 2], None) == [1, 0])
g.hand_no = 0
# a 3-4 trick loss after playing as dealt: the rival gets 2 (played-as-dealt branch), no bold bonus or callout
for tr in ([2, 3], [1, 4]):
    room, g = room_of(tag="L")
    moments = []
    room.moment = lambda text, *a, **k: moments.append(text)
    sc = end(g, tr, 0)
    check(f"dealt loser {tr}: rival 2, played-as-dealt branch", sc == [0, 2] and "played as dealt" in g.result, f"{sc} {g.result}")
    check(f"dealt loser {tr}: no bold text/callout", "bold" not in g.result.lower() and not any("Bold" in m for m in moments), moments)
    g.s["bold"] = 0
    check(f"dealt loser {tr}: same with Bold Off", end(g, tr, 0) == [0, 2])
room, g = room_of(bold=0, tag="F")
check("off: plain 1", end(g, [3, 2], 0) == [1, 0])
room, g = room_of(tag="G")
g.s.pop("bold", None)
check("old room w/o setting works", end(g, [3, 2], 0) == [2, 0])
g2 = pickle.loads(pickle.dumps(room)).game
check("pickle round trip", g2.played_dealt == g.played_dealt)

fired = games = 0
for n in range(30):
    room, g = room_of(tag=f"S{n}")
    hits = 0
    orig = g.end_hand
    seen = []

    def wrap(g=g, orig=orig, seen=seen):
        seen.append(g.played_dealt is not None and g.tricks[g.played_dealt] > g.tricks[1 - g.played_dealt])
        return orig()
    g.end_hand = wrap
    level = ["easy", "normal", "hard"][n % 3]
    for _ in range(3000):
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
    games += 1
    fired += any(seen)
print("fired in", fired, "of", games, "games")
check("fires in at least one game", fired >= 1)
print("all ok" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
