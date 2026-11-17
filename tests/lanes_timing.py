"""Lane Night timing (#129 #130): a strike's callouts (TURKEY, badges) wait until the pins land on screen,
and the game only ends once the last roll has played out. Also the room's held-log queue itself.

    python3 tests/lanes_timing.py
"""
import os
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


# the queue
r = server.Room("TIME")
r.add_log("now")
r.add_log("later", at=time.time() + 5)
r.moment("✨ held", at=time.time() + 5)
check("a held line isn't in the log yet", [e["text"] for e in r.log] == ["now"] and len(r.later) == 2)
check("nothing due, nothing flushed", not r.flush_later(time.time()))
check("due lines come out in order with fresh ids", r.flush_later(time.time() + 6) and [e["text"] for e in r.log] == ["now", "later", "✨ held"])
check("a held moment keeps its tone", r.log[-1]["kind"] == "moment" and r.log[-1]["tone"] == "gold")
ids = [e["id"] for e in r.log]
check("ids increase", ids == sorted(ids) and len(set(ids)) == 3)

# a turkey
r = server.Room("TURK")
ann = r.add_player("Ann")
r.switch_game("lanes")
r.start()
g = r.game
g.cosmic = 99
for i in range(3):
    ann.g.busy = 0
    ann.g.standing = list(range(10))
    # a perfect pocket ball is luck: force the strike by rolling at a rack that's already down
    g.bowl(ann, 0.06, 0.0, 0.6, 0.0)
    if ann.g.rolls[-1] != 10:
        ann.g.rolls[-1] = 10
        ann.g.streak = i + 1
        ann.g.frame = i + 1
        ann.g.ball = 0
texts = [e["text"] for e in r.log]
check("no strike lines before the pins land", not any("STRIKE" in t for t in texts), texts[-3:])
held = [e[1]["text"] for e in r.later]
check("they're held", any("STRIKE" in t for t in held))
r.flush_later(time.time() + 10)
check("and let out once the shot has played", any("STRIKE" in e["text"] for e in r.log))

# the end
r = server.Room("ENDS")
ann = r.add_player("Ann")
r.settings["frames"] = 5
r.switch_game("lanes")
r.settings["frames"] = 5
r.start()
g = r.game
for _ in range(40):
    if ann.g.done:
        break
    ann.g.busy = 0
    g.bowl(ann, 0.45, 0.06, 0.6, 0.0)  # gutter balls: quick
check("done but still playing", ann.g.done and r.phase == "playing" and g.finish_at > time.time())
check("not ready before the roll has played", not g.bot_ready())
g.finish_at = time.time() - 0.01
check("ready after", g.bot_ready())
g.bot_tick()
check("then over", r.phase == "over")
r2 = server.Room("IDLE")
a2 = r2.add_player("Ann")
r2.switch_game("lanes"); r2.start()
r2.game.finish_at = time.time() + 30
r2.game.on_timeout()
check("an idle timeout ends a finished game at once", r2.phase == "over")
s0 = time.time() + 3
r2.game.finish_at = s0
r2.game.on_restore(10)
check("on_restore moves the end on", abs(r2.game.finish_at - s0 - 10) < 1e-6)

print("\nall ok" if not fails else f"\n{len(fails)} failed: {fails}")
sys.exit(1 if fails else 0)
