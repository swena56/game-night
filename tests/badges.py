"""🏅 Badges: a game awards one, the room counts it, announces only the first, ignores bots and unknown
keys, sends it in the view, and keeps it when the player leaves and comes back.

    python3 tests/badges.py        # well under a second
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import GAMES  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


gid, key = next((g, next(iter(c.badges))) for g, c in GAMES.items() if c.badges)
room = server.Room("TEST")
ann = room.add_player("Ann")
bot = room.add_player("Robo")
bot.bot = "normal"

room.award(ann, gid, key)
room.award(ann.id, gid, key)
check("counted twice", ann.badges == {f"{gid}:{key}": 2}, ann.badges)
check("announced once", sum(e["kind"] == "badge" for e in room.log) == 1)
room.award(ann, gid, "no-such-badge")
room.award(bot, gid, key)
check("unknown keys and bots ignored", len(ann.badges) == 1 and not bot.badges)

view = room.view(ann) if hasattr(room, "view") else None
if view is not None:
    me = next(p for p in view["players"] if p["id"] == ann.id)
    check("badges in the view", me["badges"] == ann.badges)
    check("badge list in game info", any(g["badges"] for g in view["games"]))

ann.played = 1
room.remove_player(ann)
back = room.add_player("ann")
check("kept on rejoin", back.badges == {f"{gid}:{key}": 2}, back.badges)

# every badge is (emoji, name, how)
bad = [f"{g}:{k}" for g, c in GAMES.items() for k, v in c.badges.items() if len(v) != 3 or not all(v)]
check("badge definitions well formed", not bad, bad)

print("FAILED: " + ", ".join(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
