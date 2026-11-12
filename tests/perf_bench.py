"""Server performance bench: runs the real ticker threads in process (no HTTP) and prints the health numbers.

    python3 tests/perf_bench.py [seconds]      (default 20; keep it short on a one-core host)

Rooms: Riders and Sumo full of bots (server-simulated, 60 fps), plus four turn-based rooms played by bots
(replays and logs grow, so saves have real work). Each room also gets "viewer" threads that build and
encode a view on every bump, as an open SSE stream does. Rooms are saved to a scratch file, not data/.
"""
import json
import os
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["ROOMS_FILE"] = os.path.join(tempfile.mkdtemp(prefix="gn-bench-"), "rooms.pickle")
import server  # noqa: E402

SECS = float(next((a for a in sys.argv[1:] if not a.startswith("-")), 20))
stop = threading.Event()


def make(code, game, bots, human_plays=True):
    r = server.Room(code)
    me = r.add_player("Ann")
    r.switch_game(game)
    for _ in range(bots):
        r.add_bot("normal")
    if human_plays:
        me.bot = "normal"   # a bot plays the human's seat too, so turn-based rooms never wait
    r.start()
    server.ROOMS[code] = r
    return r, me


def viewer(room, p):
    last = -1
    while not stop.is_set():
        with room.cond:
            if room.version == last:
                room.cond.wait(1)
            if room.version == last:
                continue
            last = room.version
            v = room.view(p)
        json.dumps(v, separators=(",", ":"))


def keep_alive(players):
    while not stop.wait(1):
        for p in players:
            p.last_seen = time.time()


server.words()   # the live server loads the dictionary at start (warm_up); its objects weigh on the GC
if "--freeze" in sys.argv:
    server.settle_gc()
rooms = [make("RIDE", "riders", 2, human_plays=False), make("SUMO", "sumo", 3, human_plays=False)]
TURN_BASED = (("LAST", "lastcard"), ("CHKR", "checkers"), ("HRTS", "hearts"), ("YCHT", "yacht"),
              ("WSMT", "wordsmith"), ("GRID", "gridhunt"))
if "--light" in sys.argv:   # without the slow-thinking bots (Wordsmith, Checkers)
    TURN_BASED = tuple(t for t in TURN_BASED if t[1] not in ("wordsmith", "checkers"))
for code, game in TURN_BASED:
    rooms.append(make(code, game, 2 if game != "checkers" else 1))
for r, p in rooms:
    for _ in range(2):
        threading.Thread(target=viewer, args=(r, p), daemon=True).start()
threading.Thread(target=keep_alive, args=([p for _, p in rooms],), daemon=True).start()
threading.Thread(target=server.ticker, daemon=True).start()
threading.Thread(target=server.frame_ticker, daemon=True).start()
t0 = time.process_time()
time.sleep(SECS)
stop.set()
cpu = time.process_time() - t0
h = server.health()
replay_bytes = sum(sum(len(f) for f in r.replay) for r, _ in rooms)
print(json.dumps({"secs": SECS, "cpuPct": round(100 * cpu / SECS), "frameMs": h["frameMs"], "saveMs": h["saveMs"], "botMs": h["botMs"],
                  "gcMs": h["gcMs"], "rssMB": h["rssMB"], "replayKB": replay_bytes // 1024,
                  "versions": {r.code: r.version for r, _ in rooms}}, indent=1))
