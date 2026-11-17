"""⏸ Pause (#119): only the one human in a game against bots can pause; everything stands still while it's
paused (moves refused, no bot moves, no real-time frames), and every clock moves on by the pause on resume
(the room's deadline, the bots' next move, the game's own timers, held log lines). A second human joining
lifts it.

    python3 tests/pause.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games.base import GameError, shift_times  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(fn):
    try:
        fn()
    except GameError as e:
        return str(e)
    return None


def room(gid, humans=1, bots=1):
    r = server.Room("P" + gid[:3].upper())
    hs = [r.add_player(f"H{i}") for i in range(humans)]
    for _ in range(bots):
        r.add_bot("normal")
    r.switch_game(gid)
    r.start()
    return r, hs


# a real-time game: snowball keeps absolute clocks and has no on_restore of its own
r, (ann,) = room("snowball")
g = r.game
check("the view offers pause to the one human", r.view(ann)["canPause"] and not r.view(ann)["paused"])
end0, go0 = g.end_at, g.go_at
r.act(ann, {"type": "pause"})
check("paused", r.paused and r.view(ann)["paused"])
check("moves are refused while paused", refused(lambda: r.act(ann, {"type": "throw"})) == "The game is paused.")
r.paused -= 30  # as if 30 s went by
r.act(ann, {"type": "resume"})
check("resume moves the game's clocks on by the pause", abs(g.end_at - end0 - 30) < 0.5 and abs(g.go_at - go0 - 30) < 0.5,
      f"{g.end_at - end0:.2f}")
check("and it runs again", not r.paused)

# lanes: its own on_restore
r, (ann,) = room("lanes")
g = r.game
d0 = r.deadline
r.act(ann, {"type": "pause"})
r.paused -= 10
r.act(ann, {"type": "resume"})
check("the room's deadline moves on too", abs(r.deadline - d0 - 10) < 0.5)

# two humans: no pause
r, (a, b) = room("lanes", humans=2, bots=0)
check("two humans can't pause", not r.view(a)["canPause"] and refused(lambda: r.act(a, {"type": "pause"})))

# a second human joining lifts it (the ticker's check)
r, (ann,) = room("lanes")
r.act(ann, {"type": "pause"})
r.players[r.order[1]].bot = None  # the bot becomes a human, as if someone took the seat
r.players[r.order[1]].standin = False
check("two humans now", len(r.humans()) == 2)
if r.paused and len(r.humans()) != 1:
    r.resume(why="▶ Someone joined: the game goes on.")
check("lifted", not r.paused)

# auto-pause: the only human goes quiet → paused (not autopilot); with two humans, autopilot as before
r, (ann,) = room("lanes")
ann.last_seen = time.time() - 30
check("a quiet lone human pauses the game", r.check_offline(time.time()) and r.paused and not ann.standin and "away" in r.log[-1]["text"])
r.seen(ann)
check("coming back leaves it paused (Resume is theirs)", r.paused and not ann.standin)
r, (a, b) = room("lanes", humans=2, bots=0)
a.last_seen = time.time() - 60
r.check_offline(time.time())
check("two humans: no pause, the autopilot covers", not r.paused and a.standin)
r, (ann,) = room("snowball")
r.act(ann, {"type": "autopause"})
check("the page's own autopause", r.paused)
r, (a, b) = room("lanes", humans=2, bots=0)
r.act(a, {"type": "autopause"})
check("autopause is quietly ignored with two humans", not r.paused)

# the generic clock shifter
class P: pass
class G: pass
fake = G(); fake.room = G(); fake.room.players = {}
now = time.time()
fake.t = now + 5; fake.n = 7; fake.flag = True; fake.balls = [{"t0": now - 1, "x": 3.5}]; fake.pair = (now, 2)
pl = P(); pl.g = G(); pl.g.until = now + 2; fake.room.players["x"] = pl
shift_times(fake, 10, now)
check("stamps move, other numbers don't", abs(fake.t - now - 15) < 1e-6 and fake.n == 7 and fake.flag is True and fake.balls[0]["x"] == 3.5)
check("nested and player clocks move", abs(fake.balls[0]["t0"] - now - 9) < 1e-6 and abs(pl.g.until - now - 12) < 1e-6 and abs(fake.pair[0] - now - 10) < 1e-6)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
