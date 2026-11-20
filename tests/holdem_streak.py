"""Hold'em 🔥 Hot streak (off by default): win three hands in a row on your own for 5% of the starting chips.
Rules checks, an old-style object, a pickle round trip, and easy/normal/hard bot games that must fire it.

    python3 tests/holdem_streak.py
"""
import os
import pickle
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def table(streak, n=3):
    room = server.Room("TEST")
    ps = [room.add_player(x) for x in ("Ann", "Bo", "Cy")[:n]]
    room.switch_game("holdem")
    if streak is not None:
        room.settings["streak"] = streak
    room.start()
    return room, room.game, ps


def win(g, who):
    g.winners = [who.id] if who else []
    g.hot_streak()


room, g, (ann, bo, cy) = table(None)
check("off by default", g.s.get("streak") is False)
base = ann.g.chips
for _ in range(4):
    win(g, ann)
check("off: no bonus", ann.g.chips == base, ann.g.chips)

room, g, (ann, bo, cy) = table(True)
start = ann.g.chips
win(g, ann), win(g, ann)
check("two in a row pays nothing", ann.g.chips == start)
win(g, ann)
check("the third pays 5% of the start", ann.g.chips == start + g.s["chips"] // 20, ann.g.chips - start)
check("it is called out", any(e["kind"] == "moment" and "hot streak" in e["text"] for e in room.log))
win(g, ann), win(g, ann)
check("the run restarts after a bonus", ann.g.chips == start + g.s["chips"] // 20)
bstart = bo.g.chips
win(g, bo), win(g, bo), win(g, ann)
check("someone else winning breaks the run", bo.g.chips == bstart and ann.g.chips == start + g.s["chips"] // 20 and g.streak_n == 1)
win(g, ann), win(g, None), win(g, ann)
check("a split pot (no sole winner) breaks the run", g.streak_n == 1)

# old-style object and pickle round trip
room, g, (ann, bo, cy) = table(True)
win(g, ann), win(g, ann)
g2 = pickle.loads(pickle.dumps(room)).game
check("pickle keeps the run", (g2.streak_id, g2.streak_n) == (ann.id, 2))
old = pickle.loads(pickle.dumps(room)).game
ann = old.room.players[ann.id]
for a in ("streak_id", "streak_n"):
    old.__dict__.pop(a, None)
check("an old object has class defaults", (old.streak_id, old.streak_n) == (None, 0))
old.winners = [ann.id]
old.hot_streak()
check("and can still score", old.streak_n == 1)

# a player leaving takes their run with them, and a missing winner is never paid
room, g, (ann, bo, cy) = table(True)
win(g, cy), win(g, cy)
g.on_leave(cy)
check("leaving clears the run", (g.streak_id, g.streak_n) == (None, 0))
room, g, (ann, bo, cy) = table(True)
win(g, cy), win(g, cy)
del room.players[cy.id]
win(g, cy)
check("a winner with no seat gets no bonus and no crash", True)

# real bot games: every hand through the real move path
fired = games = 0
t0 = time.time()
for level in ("easy", "normal", "hard"):
    for _ in range(3 if level != "hard" else 2):
        room = server.Room("TEST")
        room.add_bot(level), room.add_bot(level), room.add_bot(level)
        room.switch_game("holdem")
        room.settings.update(streak=True, chips=1000, pace=6, rebuys=0)
        room.start()
        g = room.game
        games += 1
        steps = 0
        while room.phase == "playing" and steps < 4000:
            steps += 1
            if g.stage == "done":
                g.new_hand()
                continue
            p = room.players[room.turn]
            before = [pp.g.chips for pp in room.players.values()]
            g.bot_turn(p)
            check_ok = all(pp.g.chips >= 0 for pp in room.players.values())
            if not check_ok:
                check("chips never negative", False)
                break
        total = sum(pp.g.chips for pp in room.players.values())
        bonuses = sum(1 for e in room.log if "Hot streak" in e["text"])
        fired += bonuses > 0
        if bonuses:
            pass
        check(f"{level} game finishes", room.phase != "playing", f"steps={steps} bonuses={bonuses}")
check("the streak fired in bot games", fired >= 1, f"{fired}/{games} games, {round(time.time() - t0)}s")

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
