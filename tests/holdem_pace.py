"""Hold'em between hands (#58): the "Between hands" pause, ▶ Next hand (the next hand starts once every
person still in has asked), and results that name the hand. Runs a real room.

    python3 tests/holdem_pace.py        # well under a second
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(g, p, a):
    try:
        g.act(p, a)
    except GameError:
        return True
    return False


def new_room(breather=None, bot=False):
    room = server.Room("TEST")
    ann, bo = room.add_player("Ann"), room.add_player("Bo")
    cy = room.add_bot("normal") if bot else room.add_player("Cy")
    room.switch_game("holdem")
    if breather is not None:
        room.settings["breather"] = breather
    room.start()
    return room, (ann, bo, cy), room.game


def fold_out(room, g):
    """Everyone to act folds (or checks) until the hand is over."""
    for _ in range(20):
        if g.stage == "done":
            return
        p = room.players[room.turn]
        g.act(p, {"type": "fold"} if g.cur_bet - p.g.bet > 0 else {"type": "check"})


def showdown(room, g):
    for _ in range(40):
        if g.stage == "done":
            return
        p = room.players[room.turn]
        g.act(p, {"type": "call"} if g.cur_bet - p.g.bet > 0 else {"type": "check"})


room, ps, g = new_room()
check("Between hands defaults to Normal", room.settings.get("breather", g.s.get("breather")) == 2)
check("no ▶ Next before the hand is over", refused(g, ps[0], {"type": "next"}))
fold_out(room, g)
left = room.deadline - time.time()
check("Normal waits about 5 s after a fold-out", 4.5 < left <= 5.01, f"{left:.2f}")

room, ps, g = new_room(breather=1)
fold_out(room, g)
left = room.deadline - time.time()
check("⚡ Quick keeps the old 2.5 s", 2.0 < left <= 2.51, f"{left:.2f}")

room, ps, g = new_room(breather=3)
showdown(room, g)
left = room.deadline - time.time()
check("🐢 Relaxed waits about 15 s after a showdown", g.shown and 14.5 < left <= 15.01, f"{left:.2f}")
check("a showdown result names the hand", any(w in g.result.lower() for w in ("pair", "high", "flush", "straight", "three", "four", "full")), g.result)
check("shown hands use the friendly name", all(v["hand"][0].isupper() for v in g.shown.values()), str([v["hand"] for v in g.shown.values()]))

# ▶ Next: the hand starts only once every person still in has asked
room, (ann, bo, cy), g = new_room()
fold_out(room, g)
n = g.hand_no
g.act(ann, {"type": "next"})
check("one ▶ Next of three waits for the others", g.stage == "done" and g.hand_no == n and g.view(ann)["holdem"]["ready"] == [ann.id])
g.act(bo, {"type": "next"})
g.act(cy, {"type": "next"})
check("all three ▶ Next start the next hand", g.hand_no == n + 1 and g.stage != "done", f"hand {g.hand_no}, {g.stage}")
check("the ready list clears for the new hand", g.view(ann)["holdem"]["ready"] == [])

# bots don't hold anyone up
room, (ann, bo, bot), g = new_room(bot=True)
fold_out(room, g)
n = g.hand_no
g.act(ann, {"type": "next"}); g.act(bo, {"type": "next"})
check("bots don't need to press ▶ Next", g.hand_no == n + 1)

print("\nall passed" if not fails else f"\n{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
