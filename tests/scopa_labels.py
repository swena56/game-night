"""Scopa move labels flag 7♦ captures and warn when laying it down.

    python3 tests/scopa_labels.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

room = server.Room("TEST")
ps = [room.add_player(f"P{k}") for k in range(2)]
room.switch_game("scopa")
room.start()
g = room.game
ps.sort(key=lambda p: g.seat(p))
i = 0
fails = []
for case, hand, table_, want in [
    ("capture", ["7D"], ["7H"], "🌟 7♦"),
    ("lay", ["7D"], ["2C"], "gives away 7♦"),
    ("plain", ["4C"], ["4H"], None),
]:
    g.hands[i] = hand
    g.table_cards = table_
    g.stage = "play"
    room.turn = ps[i].id
    labels = [m["label"] for m in g.table(ps[i], i)["moves"]]
    ok = (want is None and all("7♦" not in l for l in labels)) or (want and any(want in l for l in labels))
    print("ok  " if ok else "FAIL", case, labels)
    if not ok:
        fails.append(case)
for mode, table_cards, expected in [
    ("scopa", ["7H", "3H", "4H"], ["7H"]),
    ("scopa", ["3H", "4H"], ["3H", "4H"]),
    ("escoba", ["3H", "5H"], ["3H", "5H"]),
]:
    g.s["mode"] = mode
    g.hands = [["7C"], []]
    g.table_cards = table_cards
    g.stock = ["AC"]
    move = g.table(ps[0], 0)["moves"][0]
    correct = move["a"]["take"] == expected and ("🧹" in move["label"]) == (len(table_cards) == len(expected))
    g.stock = []
    correct = correct and "🧹" not in g.table(ps[0], 0)["moves"][0]["label"]
    print("ok  " if correct else "FAIL", mode, "exact preview and final-play sweep exception", move)
    if not correct:
        fails.append(mode)
sys.exit(1 if fails else 0)
