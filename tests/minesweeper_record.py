#!/usr/bin/env python3
"""Minesweeper's high score is the fastest clearing time (production report #30)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

def play(clear):
    r = server.Room("TEST")
    p = r.add_player("Ann")
    r.switch_game("minesweeper")
    r.start()
    g = r.game
    g.t0 -= 42.5                      # 42.5 s on the clock
    if clear:
        for i in range(g.n * g.n):
            if not g.mine[i] and not g.st[p.id]["o"][i]:
                g.act(p, {"type": "open", "cell": i})
    else:
        g.act(p, {"type": "bank"})
    while r.phase == "playing":
        g.on_timeout()
    return r, p, r.history[-1]

r, p, h = play(True)
row = h["players"][0]
assert h["record"]["kind"] == "time" and 42000 <= row["recordScore"] <= 44000, row
assert r.room_records[h["record"]["key"]]["value"] == row["recordScore"]
r, p, h = play(False)
assert "recordScore" not in h["players"][0] or h["players"][0]["recordScore"] is None
assert not r.room_records
print("minesweeper record OK")
