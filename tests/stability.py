"""Stability: the server keeps going when a game misbehaves, a save fails or a visitor vanishes.

    python3 tests/stability.py

Covers: restored rooms whose game can't show itself go back to the lobby; an event stream survives a view
that raises; a POST that hits a bug answers 500 JSON; saves skip unchanged rooms and survive an unsaveable
one; replays round-trip through compressed frames; client disconnects aren't logged as tracebacks.
"""
import contextlib
import http.client
import io
import json
import os
import pickle
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["ROOMS_FILE"] = os.path.join(tempfile.mkdtemp(prefix="gn-stab-"), "rooms.pickle")
import server  # noqa: E402
from games import GAMES  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


@contextlib.contextmanager
def patched(obj, name, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)


def boom(*a, **k):
    raise RuntimeError("test bug")


def playing_room(code, game="tictactoe"):
    r = server.Room(code)
    r.add_player("Ann")
    r.switch_game(game)
    r.add_bot("normal")
    r.start()
    return r


quiet = contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO())

# -- a restored room whose game view raises goes back to the lobby; healthy ones are untouched
server.ROOMS.clear()
good, bad = playing_room("GOOD"), playing_room("BADD", "dropfour")
with open(server.SAVE_FILE, "wb") as f:
    pickle.dump({"GOOD": pickle.dumps(good), "BADD": pickle.dumps(bad)}, f)
server.ROOMS.clear()
with patched(GAMES["dropfour"], "view", boom), quiet[0], quiet[1]:
    server.load_rooms()
check("restore: healthy room keeps playing", server.ROOMS["GOOD"].phase == "playing")
b = server.ROOMS["BADD"]
check("restore: broken game goes back to the lobby", b.phase == "lobby" and b.game is None)
check("restore: players stay", len(b.players) == 2)
check("restore: the room says why", "updated" in b.log[-1]["text"])

# -- a room that won't unpickle is skipped, the rest load
with open(server.SAVE_FILE, "wb") as f:
    pickle.dump({"GOOD": pickle.dumps(good), "JUNK": b"not a pickle"}, f)
server.ROOMS.clear()
with quiet[0], quiet[1]:
    server.load_rooms()
check("restore: an unreadable room is skipped", set(server.ROOMS) == {"GOOD"})

# -- saves: unchanged rooms aren't pickled again; an unsaveable room keeps its last copy, the others save
server.ROOMS.clear()
server._SAVED.clear()
a, c = playing_room("AAAA"), playing_room("CCCC")
server.ROOMS.update({"AAAA": a, "CCCC": c})
server.save_rooms()
check("save: first save pickles both", server.STATS["saves"][-1][1] == 2)
server.save_rooms()
check("save: nothing changed, nothing pickled", server.STATS["saves"][-1][1] == 0)
a.junk = threading.Lock()   # can't be pickled
a.version += 1
c.version += 1
with quiet[0], quiet[1]:
    server.save_rooms()
with open(server.SAVE_FILE, "rb") as f:
    saved = pickle.load(f)
check("save: one bad room doesn't stop the save", set(saved) == {"AAAA", "CCCC"})
check("save: the good room was re-pickled", server.STATS["saves"][-1][1] == 1)
check("save: bad room keeps its last copy", pickle.loads(saved["AAAA"]).version == a.version - 1)
del a.junk

# -- replays round-trip through compressed frames, and old plain-JSON frames still load
r = playing_room("REPL")
me = next(p for p in r.players.values() if p.human())
me.bot = "normal"   # bots play both seats for a few moves
for _ in range(4):
    if r.phase != "playing":
        break
    r.game.bot_tick()
    r.snap()
me.bot = None
r.to_lobby()
server.ROOMS["REPL"] = r
frames = server.replay({"code": "REPL", "pid": me.id, "token": me.token})["frames"]
check("replay: frames are stored compressed", all(isinstance(f, bytes) for f in r.replay))
check("replay: frames decode", len(frames) == len(r.replay) and all("phase" in f for f in frames))
r.replay.insert(0, json.dumps({"phase": "old"}))
frames = server.replay({"code": "REPL", "pid": me.id, "token": me.token})["frames"]
check("replay: old plain-JSON frames still load", frames[0] == {"phase": "old"})

# -- over HTTP: a POST that hits a bug answers 500 JSON; a stream survives a view that raises
httpd = server.GameServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
port = httpd.server_address[1]


def post(path, body):
    h = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    h.request("POST", path, json.dumps(body), {"Content-Type": "application/json"})
    res = h.getresponse()
    out = res.status, json.loads(res.read() or b"{}")
    h.close()
    return out


me = server.create_room({"name": "Ann", "game": "tictactoe"})
room = server.ROOMS[me["code"]]
with patched(server.Room, "act", boom), quiet[0], quiet[1]:
    status, body = post("/api/action", {**me, "type": "react", "emoji": "🔥"})
check("POST bug: 500 with a message", status == 500 and "wrong" in body.get("error", ""), f"{status} {body}")
status, body = post("/api/action", {**me, "type": "react", "emoji": "🔥"})
check("POST: works again afterwards", status == 200, f"{status} {body}")

h = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
h.request("GET", f"/api/events?code={me['code']}&pid={me['pid']}&token={me['token']}")
res = h.getresponse()


def next_data():
    while True:
        line = res.fp.readline().decode()
        if line.startswith("data: ") and line[6:].strip() != "{}":
            return json.loads(line[6:])


first = next_data()
check("stream: first view arrives", first.get("code") == me["code"])
with patched(server.Room, "view", boom), quiet[0], quiet[1]:
    with room.cond:
        room.add_log("broken view coming")
        room.bump()
    threading.Event().wait(0.3)
with room.cond:
    room.add_log("fixed again")
    room.bump()
again = next_data()
check("stream: survives a view that raises", any(e["text"] == "fixed again" for e in again.get("log", [])))
h.close()

# -- routine client disconnects aren't logged as tracebacks; real errors still are
err = io.StringIO()
with contextlib.redirect_stderr(err):
    for e in (ConnectionResetError(104, "reset"), BrokenPipeError(32, "pipe"), RuntimeError("real")):
        try:
            raise e
        except Exception:
            httpd.handle_error(None, ("1.2.3.4", 5))
check("log: disconnects stay quiet", "ConnectionResetError" not in err.getvalue() and "BrokenPipe" not in err.getvalue())
check("log: real errors still print", "RuntimeError" in err.getvalue())
httpd.shutdown()

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
