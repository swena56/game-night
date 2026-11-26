#!/usr/bin/env python3
"""🔁 Restart (#17): alone with bots it happens at once; with other people everyone must agree."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server

def room(humans, bots):
    r = server.Room("TEST")
    people = [r.add_player(f"P{i}") for i in range(humans)]
    r.settings = server.default_settings("chess")
    for _ in range(bots):
        r.add_bot("easy")
    r.start()
    return r, people

r, (a,) = room(1, 1)
n = r.game_no
r.act(a, {"type": "restart", "agree": True})
assert r.game_no == n + 1 and r.phase == "playing" and r.view(a)["restart"] == []

r, (a, b) = room(2, 0)
n = r.game_no
r.act(a, {"type": "restart", "agree": True})
r.act(a, {"type": "restart", "agree": True})  # asking twice is one vote
assert r.game_no == n and r.view(b)["restart"] == [a.id] and len(r.view(b)["restartNeeds"]) == 2
r.act(b, {"type": "restart", "agree": False})
assert r.game_no == n and r.view(a)["restart"] == []
r.act(b, {"type": "restart", "agree": True})
r.act(a, {"type": "restart", "agree": True})
assert r.game_no == n + 1 and r.view(a)["restart"] == []

watcher = r.add_player("W")
try:
    r.act(watcher, {"type": "restart", "agree": True})
    raise SystemExit("a spectator restarted the game")
except server.GameError:
    pass
print("restart rules OK")
