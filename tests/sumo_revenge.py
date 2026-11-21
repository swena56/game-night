"""Sumo Saucers: 🩸 first blood (a round's first knockout) and 🔁 revenge (knocking off the saucer that last knocked you off).

    python3 tests/sumo_revenge.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print("ok  " if ok else "FAIL", name, detail)
    if not ok:
        fails.append(name)


r = server.Room("TEST")
ps = [r.add_player(x) for x in ("Ann", "Bo", "Cy")]
r.switch_game("sumo")
r.start()
g = r.game
said = []
g.moment = lambda text, *a, **k: said.append(text)
g.stage = "play"
now = time.time() + 100


def ko(victim, by):
    s = g.saucers[victim]
    s.out, s.fall, s.hit_by, s.hit_at = False, now - 10, by, now
    g.check_falls(now)


ko(1, 0)   # Ann knocks Bo off: first blood
check("first blood is called", any("First blood" in t for t in said), said)
n = len(said)
ko(2, 0)   # a second knockout in the round: no more first blood
check("only the round's first knockout is first blood", not any("First blood" in t for t in said[n:]) , said[n:])
g.saucers[0].out = False
n = len(said)
ko(0, 1)   # Bo knocks Ann off: Bo was floored by Ann earlier -> revenge
check("knocking off the one who got you is revenge", any("revenge" in t for t in said[n:]), said[n:])
sys.exit(1 if fails else 0)
