#!/usr/bin/env python3
"""Game night server: rooms, lobbies, bots and live updates for every game in games/.

Zero dependencies (Python 3 stdlib only). Run `python3 server.py` and open
http://localhost:8000. Friends on the same network join via your LAN IP.

Transport: clients POST actions to /api/action and receive their own
per-player view of the room over Server-Sent Events (/api/events).
"""
import gc
import hashlib
import ipaddress
import json
import os
import pickle
import random
import secrets
import socket
import ssl
import subprocess
import sys
import threading
import time
import traceback
import zlib
from collections import defaultdict, deque
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from games import FAMILIES, GAME_INFO, GAME_LIST, GAMES, GameError
from games.bar_darts import AXES_PER_ROUND
from games.base import shift_times
from games import garden, wordbomb
from games.wordsmith import warm_up, words

PORT = int(os.environ.get("PORT", 8000))
APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
DATA_DIR = os.path.join(APP_DIR, "data")
CONTENT_TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                 ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
                 ".woff2": "font/woff2", ".gz": "application/octet-stream"}  # .gz: the OCR model (static/vendor/tesseract)
MAX_PLAYERS = 6
# Overall points for the evening: a win, playing a game to the end, and walking out of a live game.
POINTS_WIN, POINTS_PLAYED, POINTS_QUIT = 3, 1, -2
ROOM_TTL = 3 * 3600
# Room-wide settings shown under every game's own settings in the lobby.
ROOM_SETTINGS = {
    "timer": ("Turn timer", [(0, "Off"), (30, "30s"), (60, "60s"), (90, "90s"), (120, "120s")], 0),
    "ghost_chat": ("Ghost & spectator chat", [("private", "👻 Ghosts only during play"), ("open", "💬 Everyone")], "private"),
    "locked": ("Room", [(False, "🔓 Open to join"), (True, "🔒 Locked")], False),
}
RECORD_SCORES = {"trivia": "points", "prism": "points", "yacht": "points", "lander": "points",
                 "shutbox": "lowPoints", "putt": "strokes", "marble": "time"}
ROOM_SETTINGS_INFO = [{"key": k, "label": lbl, "options": opts, "default": d} for k, (lbl, opts, d) in ROOM_SETTINGS.items()]
CHAT_KEEP = 100
BANTER = {
    "win": ["gg 😎", "beep boop, victory 🤖", "too easy", "I calculated that 0.3s ago"],
    "lose": ["gg!", "rematch? 🔁", "I demand a recount", "well played, human", "my circuits need a nap"],
}
# Ordered so the first seats stay far apart even with red-green or blue-yellow colour blindness (checked by
# simulating protanopia, deuteranopia and tritanopia); each colour also has its own shape in the client.
PLAYER_COLORS = ["#4dabf7", "#ff922b", "#ff6b6b", "#20c997", "#fcc419", "#cc5de8", "#f06595", "#51cf66"]
BOT_NAMES = ["Robo", "Beep", "Sprocket", "Nova", "Bolt", "Pixel"]
BOT_LEVELS = ("easy", "normal", "hard")
REACTIONS = ["😂", "😱", "🤔", "😏", "🔥", "👀", "🙈", "🎉"]
# Pages send a presence heartbeat every 10s. Dead connections often look alive to the
# server for minutes, so presence is judged by heartbeats, not by open streams.
AWAY_AFTER = 20                                            # seconds of silence before "away"
OFFLINE_GRACE = int(os.environ.get("OFFLINE_GRACE", 45))   # seconds before autopilot / host handover
# A server on another port (e.g. a test server) keeps its own rooms and inbox, so it can't overwrite the live ones.
_SUFFIX = "" if PORT == 8000 else f"-{PORT}"
SAVE_FILE = os.environ.get("ROOMS_FILE") or os.path.join(DATA_DIR, f"rooms{_SUFFIX}.pickle")
# Bug reports & suggestions: one JSON object per line, plus a small status map.
FEEDBACK_FILE = os.environ.get("FEEDBACK_FILE") or os.path.join(DATA_DIR, f"feedback{_SUFFIX}.jsonl")
AXE_DEBUG_FILE = os.environ.get("AXE_DEBUG_FILE") or os.path.join(DATA_DIR, f"axe-debug{_SUFFIX}.jsonl")
AXE_DEBUG_LOCK = threading.Lock()
FEEDBACK_STATUS = FEEDBACK_FILE.rsplit(".", 1)[0] + "-status.json"
FEEDBACK_KINDS = ("bug", "idea")
FEEDBACK_MAX_BYTES = 8 * 1024 * 1024
MAX_ROOMS = 32
MAX_STREAMS = 64
MAX_STREAMS_PER_CLIENT = 20
MAX_CONNECTIONS = 128
TRUST_CADDY = os.environ.get("TRUST_CADDY") == "1"
RELEASE = os.environ.get("GAME_NIGHT_RELEASE", "")
if len(RELEASE) != 16 or any(char not in "0123456789abcdef" for char in RELEASE):
    RELEASE = ""
REQUEST_LIMITS = {
    "/api/create": (6, 60),
    "/api/join": (40, 60),
    "/api/feedback": (5, 600),
    "/api/axe-debug": (180, 60),
    "/api/profile/put": (60, 60),
    "/api/events": (60, 60),
}


class CapacityError(GameError):
    pass


LIMIT_LOCK = threading.Lock()
REQUEST_HITS = {}
NEXT_LIMIT_CLEANUP = 0
STREAMS_PER_CLIENT = {}
STREAM_SLOTS = threading.BoundedSemaphore(MAX_STREAMS)


def allow_request(path, client):
    global NEXT_LIMIT_CLEANUP
    limit, window = REQUEST_LIMITS[path]
    now = time.monotonic()
    key = path, client
    with LIMIT_LOCK:
        if now >= NEXT_LIMIT_CLEANUP:
            for entry, hits in list(REQUEST_HITS.items()):
                if now - hits[-1] >= REQUEST_LIMITS[entry[0]][1]:
                    del REQUEST_HITS[entry]
            NEXT_LIMIT_CLEANUP = now + 10
        if key not in REQUEST_HITS and len(REQUEST_HITS) >= 4096:
            return 10
        hits = REQUEST_HITS.setdefault(key, deque())
        while hits and now - hits[0] >= window:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, int(window - (now - hits[0])) + 1)
        hits.append(now)
        return 0
# HTTPS: on by default (SSL=0 turns it off). Without CERT_FILE/KEY_FILE a self-signed certificate is made in data/.
LOG_REQUESTS = os.environ.get("LOG_REQUESTS") == "1"
USE_SSL = os.environ.get("SSL", "1").lower() not in ("0", "off", "no", "false")
CERT_FILE = os.environ.get("CERT_FILE") or os.path.join(DATA_DIR, "cert.pem")
KEY_FILE = os.environ.get("KEY_FILE") or os.path.join(DATA_DIR, "key.pem")
# ✨ Lifetime records (static/profile.js), mirrored per device: data/profiles/<device id>.json
PROFILE_DIR = os.environ.get("PROFILE_DIR") or os.path.join(DATA_DIR, "profiles")
PROFILE_MAX = 64_000       # bytes of profile JSON
PROFILE_POST_MAX = 70_000
BENCHMARK_MAX = 160_000
PROFILE_WITH_BENCHMARKS_MAX = PROFILE_POST_MAX + BENCHMARK_MAX
# the looks a level opens (mirrors UNLOCKS in static/profile.js): id -> level
LOOK_FRAMES = {"bronze": 3, "silver": 6, "gold": 10, "frost": 15, "ember": 20, "rainbow": 30, "crown": 40, "legend": 50}
LOOK_TITLES = {"rookie": 2, "regular": 5, "shark": 8, "devil": 12, "owl": 18, "veteran": 25, "champion": 35, "legend": 50}


def static_files():
    files = {"/": ("index.html", "text/html")}
    for root, _, names in os.walk(STATIC_DIR):
        for n in names:
            ext = os.path.splitext(n)[1]
            if ext in CONTENT_TYPES:
                rel = os.path.relpath(os.path.join(root, n), STATIC_DIR).replace(os.sep, "/")
                files["/" + rel] = (rel, CONTENT_TYPES[ext])
    return files


RECORD = ("wins", "played", "streak", "best_streak", "by_game", "points", "quits", "badges")  # survives leave + rejoin


class Player:
    def __init__(self, name, color, spectator=False):
        self.id = secrets.token_hex(4)
        self.token = secrets.token_urlsafe(16)
        self.name = name
        self.color = color
        self.spectator = spectator
        self.watching = False  # chose to sit out: stays a spectator from game to game (#71)
        self.wish = None  # the game this player asked the host for, in the lobby (#70)
        self.streams = 0
        self.wins = 0
        self.bot = None  # difficulty level for computer players
        self.standin = False  # a bot is playing for this human while they're offline
        self.icon = None  # #144 a picked avatar: 'f:<n>' (a generated face) or an emoji; None = the face from the name
        self.look = None  # ✨ {lvl, frame, title} from the player's lifetime record (Room.set_look)
        self.last_seen = time.time()
        self.shown_away = False
        self.last_chat = 0
        # scoreboard for the evening
        self.played = 0
        self.streak = 0
        self.best_streak = 0
        self.by_game = {}
        self.points = 0
        self.quits = 0
        self.badges = {}  # "game:key" -> times earned this evening (🏅, see Room.award)
        self.reset()

    def __setstate__(self, state):  # rooms saved by older versions lack newer fields
        self.__dict__.update({"last_chat": 0, "played": 0, "streak": 0, "best_streak": 0, "by_game": {},
                              "points": 0, "quits": 0, "watching": False, "wish": None, "badges": {}, "look": None})
        self.__dict__.update(state)

    def human(self):
        return not self.bot or self.standin

    def silent_for(self, now):
        return now - self.last_seen if self.human() else 0

    def reset(self):
        self.eliminated = False
        self.g = SimpleNamespace()  # per-game state, owned by the current Game


def default_settings(game_id):
    return {"game": game_id, **{k: d for k, (_, _, d) in ROOM_SETTINGS.items()}, **GAMES[game_id].defaults()}


# ---------------------------------------------------------------- health
# Timing numbers for GET /api/health (localhost only) and the "[slow]" log lines, so a lag report can be
# matched to a cause: frame-clock gaps, room saves and garbage-collector pauses.
SLOW_FRAME, SLOW_SAVE, SLOW_GC, SLOW_BOT = 0.060, 0.040, 0.040, 0.100
STATS = {"frame_gaps": deque(maxlen=3600), "frame_late": 0, "saves": deque(maxlen=100), "gc": deque(maxlen=200), "bots": deque(maxlen=300),
         "streams": 0, "started": time.time(), "slow_logged": 0.0}
_gc_t0 = [0.0]
STATS_LOCK = threading.Lock()


def slow(what):
    """One "[slow]" line, at most every 2 s (a stall shows several symptoms at once)."""
    now = time.time()
    if now - STATS["slow_logged"] > 2:
        STATS["slow_logged"] = now
        print(f"[slow] {time.strftime('%H:%M:%S')} {what}", flush=True)


def _gc_watch(phase, info):
    if phase == "start":
        _gc_t0[0] = time.perf_counter()
    else:
        dt = time.perf_counter() - _gc_t0[0]
        STATS["gc"].append((info.get("generation"), dt))
        if dt > SLOW_GC:
            slow(f"gc gen{info.get('generation')} {dt * 1000:.0f} ms")


gc.callbacks.append(_gc_watch)


def settle_gc():
    """Once the dictionary (and other start-up data) is loaded, move everything alive into the GC's permanent
    generation, so full collections skip the long-lived start-up objects (in tests/perf_bench.py the worst
    pause fell from ~24 ms to ~13 ms; every ms counts against the 16.7 ms frame clock)."""
    words()
    wordbomb.prepare()   # 💣 Word Bomb's chunk counts: also long-lived
    garden.bases()       # 🌻 Word Garden's letter rings
    gc.collect()
    gc.freeze()


def _pct(xs, q):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))] * 1000, 1) if xs else None


def health():
    try:
        with open("/proc/self/statm") as f:
            rss = int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") // (1 << 20)
    except (OSError, ValueError):
        rss = None
    gaps, saves, gcs, bots = list(STATS["frame_gaps"]), list(STATS["saves"]), list(STATS["gc"]), list(STATS["bots"])
    return {
        "uptime": round(time.time() - STATS["started"]),
        "rooms": len(ROOMS), "playing": sum(1 for r in list(ROOMS.values()) if r.phase == "playing"),
        "streams": STATS["streams"], "threads": threading.active_count(), "rssMB": rss,
        "frameMs": {"p50": _pct(gaps, .5), "p95": _pct(gaps, .95), "max": _pct(gaps, 1), "n": len(gaps),
                    "late": STATS["frame_late"]},
        "saveMs": {"last": round(saves[-1][0] * 1000, 1) if saves else None, "p95": _pct([s[0] for s in saves], .95),
                   "max": _pct([s[0] for s in saves], 1), "pickled": saves[-1][1] if saves else None,
                   "bytes": saves[-1][2] if saves else None},
        "botMs": {"p95": _pct([b[0] for b in bots], .95), "max": _pct([b[0] for b in bots], 1),
                  "slowest": max(bots, default=(0, None))[1]},
        "gcMs": {"p95": _pct([g[1] for g in gcs], .95), "max": _pct([g[1] for g in gcs], 1),
                 "gen2": sum(1 for g in gcs if g[0] == 2), "frozen": gc.get_freeze_count()},
    }


class Room:
    def __init__(self, code):
        self.code = code
        self.cond = threading.Condition()
        self.version = 0
        self.fast, self.fast_ver = None, 0  # real-time side channel (see push_fast)
        self.no_bump = False  # a game sets this when an action only changed what push_fast already sent
        self.players = {}
        self.order = []
        self.host = None
        self.settings = default_settings("unmask")
        self.phase = "lobby"
        self.game = None
        self.turn = None
        self.deadline = None
        self.winner = None
        self.log = []
        self.later = []  # log lines held until a time (add_log at=)
        self.paused = 0  # ⏸ when the only human paused a game against bots (#119): the time it was paused
        self.reactions = []
        self.bot_at = 0
        self.touched = time.time()
        self.aids = {}  # pid -> {action id: result}, so retried requests apply once
        self.chat = []
        self.ready = set()     # players asking for another round
        self.votes = {}        # player id -> game id: what to play next (game over only)
        self.ledger = {}       # name -> evening record of a human who left, restored if they rejoin
        self.history = []      # finished games, oldest first
        self.replay = []       # JSON frames of the current/last game
        self._replay_key = None
        self.saved = {}        # game id -> that game's settings, restored when switching back
        self.game_no = 0       # counts games started; clients rebuild the game screen for each new one
        self._eid = 0

    def __getstate__(self):
        state = self.__dict__.copy()
        del state["cond"]
        state["_saved_at"] = time.time()
        return state

    def __setstate__(self, state):
        self.__dict__.update({"chat": [], "ready": set(), "votes": {}, "ledger": {}, "history": [], "replay": [],
                              "_replay_key": None, "saved": {}, "fast": None, "fast_ver": 0, "game_no": 0, "no_bump": False,
                              "later": [], "paused": 0})
        self.__dict__.update(state)
        for k, (_, _, d) in ROOM_SETTINGS.items():
            self.settings.setdefault(k, d)
        if self.settings["game"] == "archery":
            self.settings.setdefault("course", "301" if self.phase == "lobby" else "archery")
        self.cond = threading.Condition()
        now = time.time()
        for p in self.players.values():
            p.streams = 0
            p.last_seen = now
        # Time stood still while the server was down: shift deadlines (and the game's own clocks) forward,
        # and give a turn-timer turn its full time back.
        shift = max(0.0, now - self.__dict__.pop("_saved_at", now))
        if self.deadline:
            self.deadline = max(self.deadline + shift, now + self.settings["timer"])
        if self.paused:
            # Rebase the frozen game clock before starting a new pause interval.
            if self.game and self.phase == "playing":
                self.restore_clocks(max(0.0, now - self.paused), self.paused)
            self.paused = now
        elif self.game and self.phase == "playing":
            self.restore_clocks(shift, now - shift)
        darts = getattr(self.game, "darts", None)
        if self.phase == "playing" and darts and darts.grabbing is not None:
            self.deadline = darts.ready_at
        self.later = [(t + shift, e) for t, e in self.later]
        self.bot_at = now + 2

    # -- connection handling

    def seen(self, p):
        """Any sign of life from a player's page. Returns True if the view changed."""
        p.last_seen = time.time()
        changed = p.shown_away
        p.shown_away = False
        if p.standin:
            p.standin = False
            p.bot = None
            self.add_log(f"📡 {p.name} is back and takes over from autopilot.")
            changed = True
        return changed

    def connected(self, p):
        p.streams += 1
        self.seen(p)

    def disconnected(self, p):
        p.streams -= 1

    def check_offline(self, now):
        """Autopilot for players who dropped out mid-game; hand host to someone online."""
        changed = False
        for p in self.players.values():
            quiet = p.silent_for(now) > AWAY_AFTER
            if quiet != p.shown_away:
                p.shown_away = quiet
                changed = True
        away = lambda p: p.silent_for(now) > OFFLINE_GRACE
        # the only human in a game against bots went quiet: pause it for them instead of an autopilot (#119)
        if self.phase == "playing" and not self.paused:
            hs = self.humans()
            # (after the same grace as the autopilot: a busy page can miss a heartbeat or two; switching away is
            # caught by the page itself within seconds)
            if len(hs) == 1 and not hs[0].standin and hs[0].silent_for(now) > OFFLINE_GRACE:
                self.pause(hs[0], auto=True)
                changed = True
        if self.phase == "playing" and not self.paused:
            for p in self.contenders():
                if not p.bot and away(p):
                    self.record_interrupted = True
                    p.bot, p.standin = "normal", True
                    self.bot_at = max(self.bot_at, now + 1)
                    self.add_log(f"📡 {p.name} lost connection — 🤖 autopilot is covering until they're back.", "power")
                    changed = True
        host = self.players.get(self.host)
        if host and away(host):
            new = next((o for o in (self.players[i] for i in self.order)
                        if not o.bot and o.silent_for(now) < AWAY_AFTER), None)
            if new:
                self.host = new.id
                self.add_log(f"📡 {host.name} is away — {new.name} is now the host.")
                changed = True
        return changed

    # -- helpers

    def bump(self):
        self.version += 1
        self.touched = time.time()
        self.cond.notify_all()

    def push_fast(self, data):
        """Real-time games: send a small update to every stream without re-sending full views
        (no version bump, no replay frame). Browsers get it as an SSE "fast" event."""
        self.fast = json.dumps(data, separators=(",", ":"))
        self.fast_ver += 1
        self.cond.notify_all()

    def add_log(self, text, kind="info", to=None, check=None, helper=None, at=None, **extra):
        """A log line. at: a time.time() to hold it until (a game whose shot plays out on screen for a few
        seconds says its callouts when the animation lands, #129); the ticker lets it out (flush_later)."""
        entry = {"text": text, "kind": kind, "to": to, "check": check, "helper": helper, **extra}
        if at is not None and at > time.time():
            self.later.append((at, entry))
            return
        self._eid += 1
        self.log.append({"id": self._eid, **entry})
        self.log = self.log[-150:]

    def flush_later(self, now):
        """Let out held log lines whose time has come; True if any did (the room needs a bump)."""
        if not self.later:
            return False
        due = [e for e in self.later if e[0] <= now]
        if not due:
            return False
        self.later = [e for e in self.later if e[0] > now]
        for _, entry in sorted(due, key=lambda e: e[0]):
            self._eid += 1
            self.log.append({"id": self._eid, **entry})
        self.log = self.log[-150:]
        return True

    def moment(self, text, tone="gold", sound=None, to=None, at=None):
        """✨ A moment: logged like a big line and popped up as a callout across every screen that gets it
        (renderLog in app.js). tone: gold | good | bad | cool; sound: an SFX name or None. Keep the text short.
        at: hold it until then (see add_log)."""
        self.add_log(text, "moment", to=to, at=at, tone=tone, sound=sound)

    def seated(self):
        return [self.players[i] for i in self.order if not self.players[i].spectator]

    def contenders(self):
        return [p for p in self.seated() if not p.eliminated]

    def opponent(self, p):
        return next(o for o in self.seated() if o.id != p.id)

    def add_player(self, name):
        used = {p.color for p in self.players.values()}
        color = next((c for c in PLAYER_COLORS if c not in used), PLAYER_COLORS[0])
        spectator = self.phase != "lobby" or len(self.seated()) >= MAX_PLAYERS
        p = Player(name, color, spectator)
        self.players[p.id] = p
        self.order.append(p.id)
        if self.host is None:
            self.host = p.id
        back = self.ledger.pop(name.casefold(), None)
        if back:  # a returning player keeps their evening (penalties included)
            p.__dict__.update(back)
        self.add_log(f"{name} {'is back' if back else 'joined'}{' as a spectator' if spectator else ''}.")
        return p

    def remove_player(self, p):
        if p.human() and (p.played or p.points or p.quits):
            self.ledger[p.name.casefold()] = {k: getattr(p, k) for k in RECORD}
        del self.players[p.id]
        self.order.remove(p.id)
        if self.host == p.id:
            self.host = next((i for i in self.order if self.players[i].human()), None)
            if self.host:
                self.add_log(f"{self.players[self.host].name} is now the host.")

    # -- turn flow (used by games)

    def begin_turn(self, pid):
        self.turn = pid
        t = self.settings["timer"]
        self.deadline = time.time() + t if t else None
        if self.players[pid].bot:
            self.bot_at = time.time() + random.uniform(1.0, 2.2)

    def advance(self):
        n = len(self.order)
        start = self.order.index(self.turn) if self.turn in self.order else -1
        for step in range(1, 2 * n + 1):
            cand = self.players[self.order[(start + step) % n]]
            if cand.spectator or cand.eliminated or self.game.skip_turn(cand):
                continue
            self.begin_turn(cand.id)
            return

    def finish(self, winner, text, *, team_winner_ids=None):
        winners = set(team_winner_ids or ())
        if winner:
            winners.add(winner.id)
        self.phase = "over"
        self.winner = winner.id if winner else None
        self.turn = None
        self.deadline = None
        self.ready = set()
        self.votes = {}
        self.add_log(text, "big")
        gid = self.settings["game"]
        scores = self.game.final_scores() if self.game else {}
        seated = self.seated()
        if team_winner_ids is not None:
            winners.intersection_update(p.id for p in seated if p.human() and not getattr(p, "quitting", False))
        for p in seated:
            if getattr(p, "quitting", False):
                p.last_pts, p.streak = 0, 0
                continue
            p.played += 1
            p.last_pts = POINTS_WIN if p.id in winners else POINTS_PLAYED
            p.points += p.last_pts
            if p.id in winners:
                if any(o.bot == "hard" and not o.standin for o in seated):
                    self.award(p, gid, "giant")
                p.wins += 1
                p.streak += 1
                p.best_streak = max(p.best_streak, p.streak)
                p.by_game[gid] = p.by_game.get(gid, 0) + 1
            else:
                p.streak = 0
        info = GAMES[gid]
        self.history.append({
            "game": gid, "icon": info.icon, "name": info.name, "at": time.time(), "text": text, "no": self.game_no,
            "secs": round(time.time() - self.started_at) if getattr(self, "started_at", None) else None,
            "winner": winner.name if winner else None, "low": bool(getattr(info, "low_wins", False)),
            # id and bot level let each device keep its own lifetime record (static/profile.js)
            "players": [{"id": p.id, "bot": None if p.standin else p.bot,
                         "name": p.name, "color": p.color, "score": scores.get(p.id), "pts": p.last_pts,
                         "won": p.id in winners} for p in seated],
        })
        record = getattr(self, "round_record", None)
        if record:
            self.history[-1]["recordExcluded"] = True
        if record and not getattr(self, "record_interrupted", False):
            entry = self.history[-1]
            entry.pop("recordExcluded", None)
            entry["record"] = record
            for row in entry["players"]:
                score = row["score"]
                if gid == "marble" and any(board.get(row["id"], {}).get("dnf", True)
                                           for board in self.game.results):
                    score = None
                if not row["bot"] and record["kind"] not in ("wins", "crew", "progress"):
                    row["recordScore"] = score
            if record["kind"] not in ("wins", "crew", "progress"):
                room_records = self.room_records = getattr(self, "room_records", {})
                for row in entry["players"]:
                    value = row.get("recordScore")
                    if value is None:
                        continue
                    current = room_records.get(record["key"])
                    low = record["kind"] in ("lowPoints", "strokes", "time")
                    if current is None or (value < current["value"] if low else value > current["value"]):
                        room_records[record["key"]] = {
                            "value": value, "name": row["name"], "kind": record["kind"],
                            "label": record["label"], "game": gid, "id": row["id"], "at": entry["at"],
                        }
        if team_winner_ids is not None:
            self.history[-1]["teamWinnerIds"] = [p.id for p in seated if p.id in winners]
        self.history = self.history[-30:]
        for p in seated:
            if p.bot and not p.standin and random.random() < 0.6:
                lines = BANTER["win" if p.id in winners else "lose"]
                self.add_chat(p, random.choice(lines))

    def award(self, p, gid, key, at=None):
        """🏅 A badge for player `p` in game `gid` (key from that game's `badges`). Counted per evening;
        the first of each kind is announced in the log, and bots never earn them."""
        p = self.players.get(p) if isinstance(p, str) else p
        badge = GAMES[gid].badges.get(key) if gid in GAMES else None
        if not p or not badge or p.bot or p.standin:
            return
        k = f"{gid}:{key}"
        p.badges[k] = p.badges.get(k, 0) + 1
        if p.badges[k] == 1:
            self.add_log(f"🏅 {p.name} earned {badge[0]} {badge[1]}!", "badge", at=at)

    def add_chat(self, p, text, ghost=False):
        self._eid += 1
        self.chat.append({"id": self._eid, "pid": p.id, "name": p.name, "color": p.color,
                          "text": text, "ghost": ghost, "t": time.time()})
        self.chat = self.chat[-CHAT_KEEP:]

    def snap(self):
        """Record a replay frame: the full spectator view, if the game state changed."""
        if not self.game or not self.game.replayable:
            return
        v = self.view(REPLAY_VIEWER)
        for k in ("games", "roomSettings", "reactions", "chat", "ready", "votes", "history", "roomRecords", "hasReplay"):
            v.pop(k, None)
        v["log"] = v["log"][-2:]
        v["timeLeft"] = None
        key = json.dumps({k: x for k, x in v.items() if k not in ("players", "log")}, sort_keys=True)
        if key == self._replay_key:
            return
        self._replay_key = key
        # Kept compressed: a long game's 500 frames are mostly the same view again (~8x smaller).
        self.replay.append(zlib.compress(json.dumps(v, separators=(",", ":")).encode(), 6))
        self.replay = self.replay[-500:]

    # -- actions

    def act(self, p, a):
        """Apply one action from player `p`: a room action from ACTIONS, otherwise a move in the running game."""
        handler = self.ACTIONS.get(a.get("type"))
        if handler:
            return handler(self, p, a)
        if self.phase != "playing":
            raise GameError("The game isn't running.")
        if self.paused:
            raise GameError("The game is paused.")
        if p.spectator:
            raise GameError("Spectators can't play.")
        self.game.act(p, a)

    def require_host(self, p, phase=None):
        if p.id != self.host:
            raise GameError("Only the host can do that.")
        if phase and self.phase != phase:
            raise GameError("Not right now.")

    def react(self, p, emoji):
        if emoji not in REACTIONS:
            raise GameError("Unknown reaction.")
        self._eid += 1
        self.reactions = self.reactions[-19:] + [{"id": self._eid, "pid": p.id, "emoji": emoji}]

    def toggle_ready(self, p):
        if self.phase != "over":
            raise GameError("Not right now.")
        self.ready ^= {p.id}

    def reset_scores(self, p):
        self.require_host(p)
        for o in self.players.values():
            o.wins = o.played = o.streak = o.best_streak = o.points = o.quits = 0
            o.by_game = {}
        self.history = []
        self.room_records = {}
        self.ledger = {}
        self.add_log(f"{p.name} reset the scoreboard.")

    def remove_bot(self, p, bot_id):
        self.require_host(p, "lobby")
        bot = self.players.get(bot_id)
        if not bot or not bot.bot or bot.standin:
            raise GameError("No such bot.")
        self.add_log(f"{bot.name} was unplugged.")
        self.remove_player(bot)

    def set_watching(self, p, on):
        """Sit the next games out, or take a seat again (#71)."""
        if self.phase != "lobby":
            raise GameError("Switch between playing and watching in the lobby.")
        if p.bot:
            raise GameError("Bots always play.")
        if on:
            if not p.spectator:
                self.add_log(f"👁 {p.name} will watch.")
            p.spectator = p.watching = True
            return
        if p.spectator and len(self.seated()) >= MAX_PLAYERS:
            raise GameError("The table is full.")
        if p.spectator:
            self.add_log(f"🙋 {p.name} will play.")
        p.spectator = p.watching = False

    def wish(self, p, gid):
        """Ask the host for a game; asking for it again takes the request back (#70)."""
        if self.phase != "lobby":
            raise GameError("Ask for a game in the lobby.")
        if gid not in GAMES:
            raise GameError("Unknown game.")
        if p.wish == gid:
            p.wish = None
            return
        p.wish = gid
        self.add_log(f"🙏 {p.name} would like to play {GAMES[gid].icon} {GAMES[gid].name}.")

    def vote(self, p, gid):
        """Pick the next game (game over only); voting again for it takes the vote back, and a unanimous vote starts it."""
        if self.phase != "over":
            raise GameError("Voting opens when the game ends.")
        if gid not in GAMES or not self.fits(gid):
            raise GameError("That game doesn't fit this many players.")
        if self.votes.get(p.id) == gid:
            del self.votes[p.id]
            return
        self.votes[p.id] = gid
        if all(self.votes.get(o.id) == gid for o in self.players.values() if o.human()):
            self.play_vote()

    def host_play_vote(self, p):
        self.require_host(p, "over")
        if not self.votes:
            raise GameError("Nobody has voted yet.")
        self.play_vote()

    def join_game(self, p):
        """A spectator sits in mid-game, in games that allow it (Game.late_join)."""
        if self.phase != "playing":
            raise GameError("There's no game to join right now.")
        if not p.spectator:
            raise GameError("You're already in the game.")
        if len(self.seated()) >= min(MAX_PLAYERS, self.game.max_players):
            raise GameError("The table is full. You'll get a seat for the next game.")
        if not hasattr(self.game, "late_join"):
            raise GameError(f"{self.game.name} can't take new players mid-game. You'll get a seat for the next one.")
        p.reset()
        self.game.late_join(p)
        self.record_interrupted = True
        p.spectator = p.watching = False
        self.add_log(f"🙋 {p.name} joins the game!", "big")

    def end_game(self, p):
        """The host stops a running game for everyone; nobody gains or loses points."""
        self.require_host(p, "playing")
        self.add_log(f"🛑 {p.name} ended the game.", "big")
        self.to_lobby()

    def host_start(self, p, phase):
        self.require_host(p, phase)
        self.start()

    def back_to_lobby(self, p):
        self.require_host(p, "over")
        self.to_lobby()

    def host_add_bot(self, p, level):
        self.require_host(p, "lobby")
        if self.settings["game"] == "switchyard":
            raise GameError("Switchyard Scramble is for human players.")
        self.add_bot(level)

    # Room-level actions by type; anything else is a move in the current game.
    ACTIONS = {
        "react": lambda r, p, a: r.react(p, a.get("emoji")),
        "chat": lambda r, p, a: r.chat_message(p, a.get("text")),
        "profile": lambda r, p, a: r.set_profile(p, a.get("name"), a.get("color")),
        "icon": lambda r, p, a: r.set_icon(p, a.get("icon")),
        "look": lambda r, p, a: r.set_look(p, a),
        "ready": lambda r, p, a: r.toggle_ready(p),
        "kick": lambda r, p, a: r.kick(p, a.get("player")),
        "reset_scores": lambda r, p, a: r.reset_scores(p),
        "leave": lambda r, p, a: r.leave(p),
        "settings": lambda r, p, a: r.change_settings(p, a.get("settings") or {}),
        "add_bot": lambda r, p, a: r.host_add_bot(p, a.get("level")),
        "remove_bot": lambda r, p, a: r.remove_bot(p, a.get("bot")),
        "watch": lambda r, p, a: r.set_watching(p, a.get("on")),
        "wish": lambda r, p, a: r.wish(p, a.get("game")),
        "start": lambda r, p, a: r.host_start(p, "lobby"),
        "next_vote": lambda r, p, a: r.vote(p, a.get("game")),
        "play_vote": lambda r, p, a: r.host_play_vote(p),
        "join_game": lambda r, p, a: r.join_game(p),
        "rematch": lambda r, p, a: r.host_start(p, "over"),  # same game, same settings, straight back in
        "lobby": lambda r, p, a: r.back_to_lobby(p),
        "end_game": lambda r, p, a: r.end_game(p),
        "pause": lambda r, p, a: r.pause(p),
        "autopause": lambda r, p, a: r.pause(p, auto=True),
        "resume": lambda r, p, a: r.resume(p),
    }

    # -- ⏸ pause (#119): only in a game against bots, by its one human; everything stands still

    def humans(self):
        return [o for o in self.seated() if o.human()]

    def can_pause(self, p):
        return self.phase == "playing" and p in self.seated() and p.human() and len(self.humans()) == 1

    def restore_clocks(self, shift, ref):
        """Time stood still for `shift` seconds from `ref` (a pause, or the server down): move the game's clocks on."""
        if hasattr(self.game, "on_restore"):
            self.game.on_restore(shift)
        else:
            shift_times(self.game, shift, ref)

    def pause(self, p, auto=False):
        """auto: the page went to the background, or the player went quiet (the ticker): paused for them."""
        if self.paused:
            return
        if not self.can_pause(p):
            if auto:
                return
            raise GameError("Pause is for a game against bots, with nobody else playing.")
        self.paused = time.time()
        self.add_log(f"⏸ Paused while {p.name} is away." if auto else f"⏸ {p.name} paused the game.")

    def resume(self, p=None, why=None):
        if not self.paused:
            return
        now = time.time()
        shift, ref = now - self.paused, self.paused
        self.paused = 0
        if self.deadline:
            self.deadline += shift
        self.bot_at += shift
        self.later = [(t + shift, e) for t, e in self.later]
        if self.game and self.phase == "playing":
            self.restore_clocks(shift, ref)
        self.add_log(why or f"▶ {p.name if p else 'The game'} resumed.")

    def fits(self, gid):
        game = GAMES[gid](self)
        game.s = self.settings if gid == self.settings["game"] else self.settings_for(gid)  # what it would start with
        try:
            game.check_players(self.seated())
            return True
        except GameError:
            return False

    def settings_for(self, gid):
        return {**default_settings(gid), **self.saved.get(gid, {}), **{k: self.settings[k] for k in ROOM_SETTINGS}}

    def play_vote(self):
        """Start the game with the most votes. A tie goes to the host's pick, then lobby order."""
        tally = {}
        for gid in self.votes.values():
            tally[gid] = tally.get(gid, 0) + 1
        top = max(tally.values())
        tied = [g for g in GAMES if tally.get(g) == top]
        gid = self.votes.get(self.host) if self.votes.get(self.host) in tied else tied[0]
        info = GAMES[gid]
        self.add_log(f"🗳️ The vote picked {info.icon} {info.name} ({top} vote{'s' * (top > 1)})!", "big")
        self.switch_game(gid)
        self.start()

    def switch_game(self, gid):
        """Change the selected game, remembering each game's settings for next time."""
        if gid == self.settings["game"]:
            return
        old = self.settings
        self.saved[old["game"]] = {k: v for k, v in old.items() if k not in ROOM_SETTINGS}
        self.settings = self.settings_for(gid)

    def change_settings(self, p, s):
        self.require_host(p, "lobby")
        if "game" in s:
            if s["game"] not in GAMES:
                raise GameError("Unknown game.")
            if s["game"] != self.settings["game"]:
                return self.switch_game(s["game"])
        schema = {**GAMES[self.settings["game"]].settings_schema, **ROOM_SETTINGS}
        for k, v in s.items():
            if k == "game":
                continue
            if k not in schema or v not in [o for o, _ in schema[k][1]]:
                raise GameError(f"Bad setting: {k}")
            if self.settings.get(k) != v:
                label = dict(schema[k][1])[v]
                self.add_log(f"⚙️ {schema[k][0]}: {label}")
            self.settings[k] = v

    def start(self):
        cls = GAMES[self.settings["game"]]
        game = cls(self)
        seated = self.seated()
        game.check_players(seated)
        for p in self.players.values():
            p.reset()
            if p.wish == self.settings["game"]:
                p.wish = None  # granted
        self.log = []
        self.later = []
        self.paused = 0
        self.winner = None
        self.turn = None
        self.deadline = None
        self.game = game
        self.phase = "playing"
        self.ready = set()
        self.votes = {}
        self.replay = []
        self._replay_key = None
        self.game_no += 1
        self.started_at = time.time()
        gid = self.settings["game"]
        kind = RECORD_SCORES.get(gid, "wins")
        if gid == "switchyard":
            kind = "crew"
        elif gid == "prism" and self.settings.get("mode") == "levels":
            kind = "progress"
        elif gid == "shutbox" and self.settings.get("instant"):
            kind = "wins"
        elif gid == "starguard" and len(seated) > 1:
            kind = "progress"
        rules = {k: self.settings.get(k, schema[2]) for k, schema in cls.settings_schema.items()}
        if gid == "archery":
            if rules["course"] == "archery":
                del rules["course"]
                del rules["axe_scoring"]
            else:
                course = rules["course"]
                axe_scoring = rules["axe_scoring"]
                rules = {"course": course}
                if course == "axe":
                    rules["axes_per_round"] = AXES_PER_ROUND
                    if axe_scoring == "corner":
                        rules["axe_scoring"] = axe_scoring
        labels = []
        for k, (name, options, _) in cls.settings_schema.items():
            if k not in rules:
                continue
            option = next((label for value, label in options if value == rules[k]), rules[k])
            labels.append(f"{name} – {option}")
        if "axes_per_round" in rules:
            labels.append(f"{AXES_PER_ROUND} axes per round")
        levels = sorted(p.bot or "human" for p in seated)
        humans = levels.count("human")
        labels.append(f"{humans} human" + ("s" if humans != 1 else ""))
        labels.extend(level.title() + " bot" for level in levels if level != "human")
        if self.settings["timer"]:
            labels.append(f'{self.settings["timer"]}s turn timer')
        signature = json.dumps([gid, kind, rules, self.settings["timer"], levels], sort_keys=True)
        self.round_record = {"key": hashlib.sha256(signature.encode()).hexdigest()[:24],
                             "label": " · ".join(labels), "kind": kind,
                             "roster": sorted(p.id for p in seated)}
        self.record_interrupted = any(p.standin for p in seated)
        game.start(list(seated), random.Random())
        self.snap()

    def set_profile(self, p, name, color):
        """Rename yourself or pick a new colour, between games."""
        if self.phase == "playing":
            raise GameError("Change your name or colour between games.")
        name = clean_name(name if name is not None else p.name)
        if name.startswith("🤖"):
            raise GameError("That name is saved for bots.")
        if any(o is not p and o.name.casefold() == name.casefold() for o in self.players.values()):
            raise GameError("Someone here already has that name.")
        color = color or p.color
        if color not in PLAYER_COLORS:
            raise GameError("Pick one of the colours.")
        if any(o is not p and o.color == color for o in self.players.values()):
            raise GameError("Someone else has that colour.")
        if name != p.name:
            self.add_log(f"✏️ {p.name} is now {name}.")
        p.name, p.color = name, color

    def set_icon(self, p, icon):
        """#144 pick your avatar: a generated face ('f:<0–9999>') or one emoji; empty goes back to the face from your name."""
        if icon in (None, ""):
            p.icon = None
            return
        ok = isinstance(icon, str) and (
            (icon.startswith("f:") and icon[2:].isdigit() and 1 <= len(icon) - 2 <= 4)
            or (len(icon) <= 8 and not any(c.isascii() or c.isspace() for c in icon)))
        if not ok:
            raise GameError("Pick one of the icons.")
        p.icon = icon

    def set_look(self, p, a):
        """✨ show your level, avatar frame and title at the table. XP is worked out on the device (an honour
        system on a home LAN); the server only keeps the values in range and to looks that level opens."""
        try:
            lvl = max(1, min(50, int(a.get("lvl") or 1)))
        except (TypeError, ValueError):
            raise GameError("Bad level.")
        frame, title = a.get("frame") or None, a.get("title") or None
        if frame is not None and LOOK_FRAMES.get(frame, 99) > lvl:
            frame = None
        if title is not None and LOOK_TITLES.get(title, 99) > lvl:
            title = None
        p.look = {"lvl": lvl, "frame": frame, "title": title}

    def chat_message(self, p, text):
        text = " ".join(str(text or "").split())[:200]
        if not text:
            raise GameError("Type a message.")
        now = time.time()
        if now - p.last_chat < 0.6:
            raise GameError("Slow down a little.")
        p.last_chat = now
        ghost = (self.phase == "playing" and (p.spectator or p.eliminated)
                 and self.settings["ghost_chat"] == "private")
        self.add_chat(p, text, ghost)

    def kick(self, p, pid):
        self.require_host(p)
        target = self.players.get(pid)
        if not target or target.id == p.id or (target.bot and not target.standin):
            raise GameError("You can't remove that player.")
        if self.phase == "playing" and not target.spectator and not target.eliminated:
            self.game.on_leave(target)
        self.add_log(f"{target.name} was removed by the host.")
        self.remove_player(target)

    def to_lobby(self):
        self.phase = "lobby"
        self.game = None
        self.turn = None
        self.deadline = None
        self.votes = {}
        for p in self.players.values():
            p.reset()
        for p in [self.players[i] for i in self.order]:
            if p.spectator and not p.watching and len(self.seated()) < MAX_PLAYERS:
                p.spectator = False
        self.add_log("Back to the lobby for another round!", "big")

    def leave(self, p):
        if self.phase == "playing" and not p.spectator and not p.eliminated:
            p.points += POINTS_QUIT
            p.quits += 1
            self.add_log(f"🚪 {p.name} walked out mid-game ({POINTS_QUIT} ⭐).", "power")
            self.record_interrupted = True
            p.quitting = True  # if leaving ends the game, the walk-out doesn't count as playing it
            self.game.on_leave(p)
        else:
            self.add_log(f"{p.name} left.")
        self.remove_player(p)

    def add_bot(self, level):
        if level not in BOT_LEVELS:
            raise GameError("Unknown bot level.")
        if len(self.seated()) >= MAX_PLAYERS:
            raise GameError("The table is full.")
        used = {o.name for o in self.players.values()}
        name = next((f"🤖 {n}" for n in BOT_NAMES if f"🤖 {n}" not in used), "🤖 Bot")
        self.add_player(name).bot = level

    # -- view

    def view(self, p):
        ghost = p.spectator or p.eliminated
        see_all = ghost or self.phase == "over"
        v = {
            "code": self.code,
            "lan": lan_url(),
            "palette": PLAYER_COLORS,
            "phase": self.phase,
            "settings": self.settings,
            "gameId": self.settings["game"], "gameNo": self.game_no,
            "games": GAME_INFO,
            "roomSettings": ROOM_SETTINGS_INFO,
            "host": self.host,
            "turn": self.turn,
            "timeLeft": max(0.0, self.deadline - (self.paused or time.time())) if self.deadline else None,
            "paused": bool(self.paused), "canPause": self.can_pause(p),
            "winner": self.winner,
            "reactions": self.reactions,
            "log": [e for e in self.log if e["to"] is None or e["to"] == p.id or see_all][-80:],
            "players": [{
                "id": o.id, "name": o.name, "color": o.color, "icon": getattr(o, "icon", None), "look": getattr(o, "look", None), "spectator": o.spectator,
                "watching": o.watching, "wish": o.wish,
                "eliminated": o.eliminated, "online": not o.shown_away, "wins": o.wins,
                "bot": None if o.standin else o.bot, "meta": self.game.meta(o) if self.game else "",
                "standin": o.standin, "away": o.shown_away and not o.standin,
                "played": o.played, "streak": o.streak, "best": o.best_streak, "byGame": o.by_game,
                "points": o.points, "quits": o.quits, "badges": o.badges,
            } for o in (self.players[i] for i in self.order)],
            "me": {"id": p.id, "name": p.name, "spectator": p.spectator,
                   "eliminated": p.eliminated, "ghost": ghost},
        }
        hide_ghost_chat = self.phase == "playing" and not ghost
        v["chat"] = [m for m in self.chat if not (m["ghost"] and hide_ghost_chat)][-50:]
        v["ready"] = sorted(self.ready)
        v["votes"] = self.votes
        v["history"] = self.history[-15:]
        v["roomRecords"] = getattr(self, "room_records", {})
        v["roundRecord"] = getattr(self, "round_record", None)
        v["hasReplay"] = len(self.replay) > 1
        if self.game:
            gv = self.game.view(p)
            v["me"].update(gv.pop("me", {}))
            v.update(gv)
        return v


ROOMS = {}
ROOMS_LOCK = threading.Lock()
REPLAY_VIEWER = Player("Replay", "#888", spectator=True)


def clean_name(name):
    name = " ".join(str(name or "").split())[:16]
    if not name:
        raise GameError("Enter a name.")
    return name


def create_room(body):
    name = clean_name(body.get("name"))
    with ROOMS_LOCK:
        if len(ROOMS) >= MAX_ROOMS:
            raise CapacityError("The server has reached its room limit. Try again later.")
        while True:
            code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=4))
            if code not in ROOMS:
                break
        room = ROOMS[code] = Room(code)
    with room.cond:
        if body.get("game") in GAMES:
            room.settings = default_settings(body["game"])
        p = room.add_player(name)
        room.bump()
    return {"code": code, "pid": p.id, "token": p.token}


def get_room(code):
    room = ROOMS.get(str(code or "").upper())
    if not room:
        raise GameError("Room not found.")
    return room


def join_room(body):
    name = clean_name(body.get("name"))
    room = get_room(body.get("code"))
    with room.cond:
        if room.settings["locked"]:
            raise GameError("This room is locked.")
        if len(room.players) >= 16:
            raise GameError("Room is full.")
        p = room.add_player(name)
        room.bump()
    return {"code": room.code, "pid": p.id, "token": p.token}


def auth(room, pid, token):
    p = room.players.get(pid)
    if not p or not p.human() or not secrets.compare_digest(p.token, str(token or "")):
        raise GameError("Not in this room.")
    return p


@contextmanager
def player_session(body):
    """Find the room, hold its lock and check the player's token: `with player_session(body) as (room, p):`."""
    room = get_room(body.get("code"))
    with room.cond:
        yield room, auth(room, body.get("pid"), body.get("token"))


def do_action(body):
    with player_session(body) as (room, p):
        back = room.seen(p)
        aid = str(body.get("aid") or "")[:40]
        seen = room.aids.setdefault(p.id, {})
        if aid in seen:  # a retry of a request we already handled
            if seen[aid]:
                raise GameError(seen[aid])
            return {"ok": True, "repeat": True}
        try:
            room.act(p, body)
        except GameError as e:
            if aid:
                seen[aid] = str(e)
            raise
        room.snap()
        if aid:
            seen[aid] = None
            while len(seen) > 30:
                seen.pop(next(iter(seen)))
        if not any(o.human() for o in room.players.values()):
            with ROOMS_LOCK:
                ROOMS.pop(room.code, None)
        if back or not room.no_bump:
            room.bump()
        room.no_bump = False
    return {"ok": True}


def log_axe_debug(body):
    shot_id = body.get("shotId")
    trace = body.get("trace")
    swipe = body.get("swipe")
    if (type(shot_id) is not int or not isinstance(swipe, dict) or not isinstance(trace, dict)
            or not isinstance(trace.get("rows"), list) or len(trace["rows"]) not in (7, 9)
            or any(not isinstance(row, list) or len(row) != 10 for row in trace["rows"])):
        raise GameError("Bad axe debug record.")
    with player_session(body) as (room, player):
        match = getattr(room.game, "darts", None)
        if not match or match.mode != "axe" or player.id not in match.seats:
            raise GameError("No axe throw to record.")
        shot = next((shot for shot in [match.shot, *match.darts, *match.last_darts]
                     if shot and shot["id"] == shot_id and match.seats[shot["o"]] == player.id), None)
        if not shot:
            raise GameError("Axe throw is no longer available.")
        logged = getattr(match, "debug_logged", None)
        if logged is None:
            match.debug_logged = logged = set()
        if shot_id in logged:
            return {"ok": True}
        entry = {
            "at": time.time(), "room": room.code, "matchStartedAt": getattr(room, "started_at", None),
            "shot": shot, "swipe": swipe, "trace": trace,
        }
        try:
            line = json.dumps(entry, allow_nan=False, separators=(",", ":"))
        except (ValueError, RecursionError):
            raise GameError("Bad axe debug values.") from None
        with AXE_DEBUG_LOCK, open(AXE_DEBUG_FILE, "a", encoding="utf-8") as log:
            log.write(line + "\n")
        logged.add(shot_id)
    return {"ok": True}


def peek(body):
    """A read-only question for the current game (e.g. what a half-placed word would score): no state
    changes, no broadcast."""
    with player_session(body) as (room, p):
        game = room.game if room.phase == "playing" else None
        if game is None or not hasattr(game, "peek"):
            raise GameError("Nothing to check right now.")
        return game.peek(p, body)


def realtime_input(body):
    """High-rate input for real-time games (paddle positions): no replay frame, no full broadcast."""
    with player_session(body) as (room, p):
        p.last_seen = time.time()
        game = room.game if room.phase == "playing" else None
        if not game or not hasattr(game, "on_input"):
            raise GameError("Not right now.")
        if room.paused:
            return {"ok": True, "paused": True}
        game.on_input(p, body)
    return {"ok": True}


def status(body):
    with player_session(body) as (room, p):
        if room.seen(p):
            room.bump()
    return {"ok": True}


def replay(body):
    with player_session(body) as (room, _):
        if room.phase == "playing":
            raise GameError("Replays unlock when the game ends.")
        # rooms saved before frames were compressed hold plain JSON strings
        return {"frames": [json.loads(zlib.decompress(f) if isinstance(f, bytes) else f) for f in room.replay]}


PROFILE_LOCK = threading.Lock()


def _profile_path(body):
    pid, key = body.get("id"), body.get("key")
    if not (isinstance(pid, str) and len(pid) == 16 and all(c in "0123456789abcdef" for c in pid)):
        raise GameError("Bad device id.")
    if not (isinstance(key, str) and 16 <= len(key) <= 64 and key.replace("-", "").replace("_", "").isalnum() and key.isascii()):
        raise GameError("Bad device key.")
    return os.path.join(PROFILE_DIR, pid + ".json"), hashlib.sha256(key.encode()).hexdigest()


def _profile_read(path, keyhash):
    try:
        with open(path, encoding="utf-8") as f:
            saved = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return None  # a broken file: the next write replaces it
    if not secrets.compare_digest(str(saved.get("keyhash", "")), keyhash):
        raise GameError("That record belongs to another device.")
    return saved.get("profile") if isinstance(saved.get("profile"), dict) else {}


def _seen_time(k):
    try:
        return float(str(k).rsplit(":", 1)[1])
    except (IndexError, ValueError):
        return 0.0


def merge_profile(old, new):
    """Merge two copies of one device's record: the larger of each count (the smaller best for low-score games),
    the union of badges, finished games and unlocks; anything else from the newer copy. Idempotent:
    merging the result with either side again changes nothing."""
    old = old if isinstance(old, dict) else {}
    new = new if isinstance(new, dict) else {}
    out = {**old, **new}
    num = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    for k in ("xp", "lvl"):
        vals = [v for v in (num(old.get(k)), num(new.get(k))) if v is not None]
        if vals:
            out[k] = max(vals)
    if old.get("since") and new.get("since"):
        out["since"] = min(str(old["since"]), str(new["since"]))
    games = {}
    og, ng = old.get("games") if isinstance(old.get("games"), dict) else {}, new.get("games") if isinstance(new.get("games"), dict) else {}
    for gid in {**og, **ng}:
        a, b = og.get(gid) if isinstance(og.get(gid), dict) else {}, ng.get(gid) if isinstance(ng.get(gid), dict) else {}
        g = {**a, **b}
        for k in ("played", "wins", "stars"):
            vals = [v for v in (num(a.get(k)), num(b.get(k))) if v is not None]
            if vals:
                g[k] = max(vals)
        if a.get("low") or b.get("low"):
            g["low"] = True
        if a.get("tried") or b.get("tried"):
            g["tried"] = True
        bests = [v for v in (num(a.get("best")), num(b.get("best"))) if v is not None]
        if bests:
            g["best"] = min(bests) if g.get("low") else max(bests)
        if a.get("lastAt") or b.get("lastAt"):
            g["lastAt"] = max(str(a.get("lastAt") or ""), str(b.get("lastAt") or ""))
        if isinstance(a.get("data"), dict) or isinstance(b.get("data"), dict):
            g["data"] = {**(a.get("data") if isinstance(a.get("data"), dict) else {}), **(b.get("data") if isinstance(b.get("data"), dict) else {})}
        games[gid] = g
    out["games"] = games
    def benchmarks(profile):
        value = profile.get("benchmarks")
        return value if isinstance(value, dict) else {}

    a_records, b_records = benchmarks(old), benchmarks(new)
    records = {}
    for key in a_records.keys() | b_records.keys():
        sources = [value for value in (a_records.get(key), b_records.get(key)) if isinstance(value, dict)]
        if not sources:
            continue
        valid = [source for source in sources if isinstance(source.get("recent"), list)]
        if not valid:
            continue
        record = dict(valid[-1])
        recent = {row[0]: row for source in valid for row in source["recent"]
                  if isinstance(row, list) and len(row) == 3 and isinstance(row[0], str)
                  and num(row[1]) is not None and num(row[2]) is not None}
        record["recent"] = sorted(recent.values(), key=lambda row: (row[1], row[0]))[-5:]
        if not record["recent"]:
            continue
        bests = [source["best"] for source in valid if num(source.get("best")) is not None]
        if record.get("kind") in ("wins", "crew") and len(record["recent"]) == 5:
            bests.append(sum(row[2] for row in record["recent"]))
        if bests:
            choose = min if record.get("kind") in ("lowPoints", "strokes", "time") else max
            record["best"] = choose(bests)
        records[key] = record
    if records:
        out["benchmarks"] = dict(sorted(records.items(), key=lambda pair:
                                        (pair[1]["recent"][-1][1], pair[0]))[-256:])

    ob, nb = old.get("badges") if isinstance(old.get("badges"), dict) else {}, new.get("badges") if isinstance(new.get("badges"), dict) else {}
    badges = {}
    for k in {**ob, **nb}:
        a, b = ob.get(k) if isinstance(ob.get(k), dict) else {}, nb.get(k) if isinstance(nb.get(k), dict) else {}
        badges[k] = {**a, **b, "n": max(num(a.get("n")) or 0, num(b.get("n")) or 0)}
    out["badges"] = badges
    seen = {str(k) for x in (old, new) for k in (x.get("seen") if isinstance(x.get("seen"), list) else [])}
    out["seen"] = sorted(seen, key=lambda k: (_seen_time(k), k))[-40:]
    unl = [str(u) for x in (old, new) for u in (x.get("unl") if isinstance(x.get("unl"), list) else [])]
    out["unl"] = list(dict.fromkeys(unl))
    # per-room badge snapshots: this device's own copy, else the saved one (a cleared browser doesn't count badges twice)
    if not (isinstance(new.get("snap"), dict) and new["snap"]) and isinstance(old.get("snap"), dict):
        out["snap"] = old["snap"]
    return out


def profile_get(body):
    path, keyhash = _profile_path(body)
    with PROFILE_LOCK:
        return {"profile": _profile_read(path, keyhash) or {}}


def profile_fits(profile):
    base = {key: value for key, value in profile.items() if key != "benchmarks"}
    size = lambda value: len(json.dumps(value, separators=(",", ":")))
    return size(base) <= PROFILE_MAX and size(profile.get("benchmarks", {})) <= BENCHMARK_MAX


def profile_put(body):
    path, keyhash = _profile_path(body)
    prof = body.get("profile")
    if not isinstance(prof, dict):
        raise GameError("Send a record.")
    if not profile_fits(prof):
        raise GameError("That record is too big.")
    with PROFILE_LOCK:
        merged = merge_profile(_profile_read(path, keyhash), prof)
        if not profile_fits(merged):
            raise GameError("That record is too big.")
        os.makedirs(PROFILE_DIR, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"keyhash": keyhash, "at": time.time(), "profile": merged}, f, separators=(",", ":"))
        os.replace(tmp, path)
    return {"profile": merged}


FEEDBACK_LOCK = threading.Lock()
def submit_feedback(body):
    kind = body.get("kind")
    if kind not in FEEDBACK_KINDS:
        raise GameError("Pick bug or suggestion.")
    text = str(body.get("text") or "").strip()[:2000]
    if len(text) < 5:
        raise GameError("Please describe it in a few words.")
    context = body.get("context") if isinstance(body.get("context"), dict) else {}
    if len(json.dumps(context)) > 6000:
        context = {"note": "details too large, dropped"}
    now = time.time()
    with FEEDBACK_LOCK:
        try:
            if os.path.getsize(FEEDBACK_FILE) >= FEEDBACK_MAX_BYTES:
                raise CapacityError("The feedback inbox is full.")
            with open(FEEDBACK_FILE, encoding="utf-8") as f:
                next_id = sum(1 for _ in f) + 1
        except FileNotFoundError:
            next_id = 1
        entry = {"id": next_id, "at": now, "kind": kind, "text": text,
                 "name": " ".join(str(body.get("name") or "").split())[:16] or None, "context": context}
        with open(FEEDBACK_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"{'🐞' if kind == 'bug' else '💡'} Feedback #{next_id}: {text[:80]}")
    return {"ok": True, "id": next_id}


def feedback_status():
    try:
        with open(FEEDBACK_STATUS, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def list_feedback():
    status = feedback_status()
    items = []
    with FEEDBACK_LOCK:
        try:
            with open(FEEDBACK_FILE, encoding="utf-8") as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    e["status"] = status.get(str(e["id"]), "open")
                    items.append(e)
        except FileNotFoundError:
            pass
    return {"items": items[::-1]}


def set_feedback_status(body):
    if body.get("status") not in ("open", "done") or not isinstance(body.get("id"), int):
        raise GameError("Bad status.")
    with FEEDBACK_LOCK:
        status = feedback_status()
        status[str(body["id"])] = body["status"]
        tmp = FEEDBACK_STATUS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(status, f)
        os.replace(tmp, FEEDBACK_STATUS)
    return {"ok": True}


_SAVED = {}   # code -> (room version, pickled room): an unchanged room isn't pickled again


def save_rooms():
    t0 = time.perf_counter()
    data, fresh = {}, 0
    for code, room in list(ROOMS.items()):
        hit = _SAVED.get(code)
        if hit and hit[0] == room.version:
            data[code] = hit[1]
            continue
        try:
            with room.cond:
                ver, blob = room.version, pickle.dumps(room)
        except Exception:
            # One room that can't be saved mustn't stop the others being saved: keep its last good copy.
            traceback.print_exc()
            print(f"Could not save room {code} ({room.settings.get('game')}); keeping its last saved copy.")
            if hit:
                data[code] = hit[1]
            continue
        _SAVED[code] = (ver, blob)
        data[code] = blob
        fresh += 1
    for code in set(_SAVED) - set(data):
        del _SAVED[code]
    tmp = SAVE_FILE + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(data, f)
    os.replace(tmp, SAVE_FILE)
    dt = time.perf_counter() - t0
    STATS["saves"].append((dt, fresh, sum(map(len, data.values()))))
    if dt > SLOW_SAVE:
        slow(f"save {dt * 1000:.0f} ms ({len(data)} rooms)")


def check_restored(room):
    """A game saved by older code can lack state the new code expects. Try every player's view now: if the game
    can't show itself, send the room back to the lobby (players, scores and history stay) instead of letting it
    crash every update."""
    if room.phase != "playing" or not room.game:
        return
    try:
        match = getattr(room.game, "darts", None)
        if match is not None:
            match.upgrade_axe_round()
        for p in [*room.players.values(), REPLAY_VIEWER]:
            room.view(p)
    except Exception:
        traceback.print_exc()
        print(f"Room {room.code}: its {room.settings.get('game')} game doesn't fit the new code; back to the lobby.")
        room.to_lobby()
        room.add_log("♻️ Game Night was updated, so this game couldn't carry on. Start a new one!", "big")
        room.version += 1


def load_rooms():
    """Restore rooms saved by a previous run (our own file, written by save_rooms)."""
    try:
        with open(SAVE_FILE, "rb") as f:
            data = pickle.load(f)
        for code, blob in data.items():
            try:
                room = pickle.loads(blob)
            except Exception:
                traceback.print_exc()
                print(f"Could not restore room {code}; skipping it.")
                continue
            ROOMS[code] = room
            check_restored(room)
    except FileNotFoundError:
        pass
    except Exception:
        traceback.print_exc()
        print("Could not restore saved rooms; starting fresh.")


def ticker():
    last_saved, last_save_at = None, 0
    while True:
        time.sleep(0.25)
        now = time.time()
        if now - last_save_at > 3:
            snapshot = sorted((c, r.version) for c, r in list(ROOMS.items()))
            if snapshot != last_saved:
                try:
                    save_rooms()
                    last_saved = snapshot
                except Exception:
                    traceback.print_exc()
            last_save_at = now
        for room in list(ROOMS.values()):
            with room.cond:
                if room.check_offline(now):
                    room.bump()
                if room.paused and (room.phase != "playing" or len(room.humans()) != 1):
                    if room.phase == "playing":
                        room.resume(why="▶ Someone joined: the game goes on.")
                    else:
                        room.paused = 0
                    room.bump()
                if not room.paused and room.flush_later(now):
                    room.bump()
                game = room.game if room.phase == "playing" and not room.paused else None
                if game:
                    try:
                        if now >= room.bot_at and game.bot_ready():
                            t0 = time.perf_counter()
                            game.bot_tick()
                            dt = time.perf_counter() - t0
                            STATS["bots"].append((dt, game.id))
                            if dt > SLOW_BOT:
                                slow(f"bot move {game.id} {dt * 1000:.0f} ms")
                            room.snap()
                            if not room.no_bump:
                                room.bump()
                            room.no_bump = False
                        elif room.deadline and now > room.deadline:
                            game.on_timeout()
                            room.snap()
                            room.bump()
                    except Exception:
                        # Never let one broken move freeze the room: skip the turn.
                        traceback.print_exc()
                        room.add_log("⚠️ Something went wrong — skipping that move.", "power")
                        if room.turn:
                            room.advance()
                        room.bot_at = now + 1
                        room.bump()
                idle = now - room.touched > ROOM_TTL
                if idle and not any(p.streams for p in room.players.values()):
                    with ROOMS_LOCK:
                        ROOMS.pop(room.code, None)
                    room.bump()


def frame_ticker():
    """60 fps for real-time games that define frame(now) (server-side physics, e.g. Air Hockey)."""
    step = 1 / 60
    last = due = time.time()
    while True:
        # Sleep to an absolute schedule: time spent on frames doesn't push every later frame back. After a
        # long stall, start the schedule again from now rather than running the missed frames in a burst.
        due += step
        now = time.time()
        if due < now - 0.1:
            due = now
        if due > now:
            time.sleep(due - now)
        now = time.time()
        gap, last = now - last, now
        STATS["frame_gaps"].append(gap)
        if gap > SLOW_FRAME:
            STATS["frame_late"] += 1
            if any(r.phase == "playing" and hasattr(r.game, "frame") for r in list(ROOMS.values())):
                slow(f"frame gap {gap * 1000:.0f} ms")
        for room in list(ROOMS.values()):
            game = room.game if room.phase == "playing" and not room.paused else None
            if game is None or not hasattr(game, "frame"):
                continue
            with room.cond:
                try:
                    if room.phase == "playing" and not room.paused and room.game is game and game.frame(now):
                        room.snap()
                        room.bump()
                except Exception:
                    traceback.print_exc()


# ---------------------------------------------------------------- http

# Text files are worth gzipping (three.min.js: 600 KB → ~150 KB); images are already compressed.
COMPRESSIBLE = ("text/", "application/json", "application/javascript", "application/manifest+json", "image/svg+xml")
_STATIC_CACHE = {}  # path → (mtime, size, etag, raw bytes, gzipped bytes or None)


def static_body(fname, ctype):
    """A static file's bytes, ETag and gzipped copy, read and compressed once per change of the file."""
    path = os.path.join(STATIC_DIR, fname)
    st = os.stat(path)
    hit = _STATIC_CACHE.get(path)
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2:]
    with open(path, "rb") as f:
        raw = f.read()
    gz = zlib.compress(raw, 9, wbits=31) if ctype.startswith(COMPRESSIBLE) and len(raw) > 512 else None
    entry = (st.st_mtime_ns, st.st_size, f'"{st.st_mtime_ns:x}-{st.st_size:x}"', raw, gz)
    _STATIC_CACHE[path] = entry
    return entry[2:]


class Handler(BaseHTTPRequestHandler):
    files, scanned = static_files(), 0.0
    # Keep-alive: a phone reuses one TLS connection for its requests instead of a fresh handshake each time.
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True   # small live updates go out at once instead of waiting to batch
    timeout = 75                     # an idle keep-alive connection is closed after this many seconds

    def gzip_ok(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "").lower()

    def log_message(self, fmt, *args):
        if LOG_REQUESTS:
            tls = "tls" if isinstance(self.connection, ssl.SSLSocket) else "plain"
            print(f"{self.client_address[0]} {tls} {fmt % args} host={self.headers.get('Host') if self.headers else None}")

    def send_json(self, status, data, *, retry_after=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def rate_limit_client(self):
        peer = ipaddress.ip_address(self.client_address[0])
        if TRUST_CADDY and not peer.is_loopback:
            try:
                peer = ipaddress.ip_address(self.headers.get("X-Game-Night-Client", ""))
            except ValueError:
                pass
        if isinstance(peer, ipaddress.IPv6Address):
            peer = peer.ipv4_mapped or ipaddress.ip_network((peer, 64), strict=False).network_address
        return str(peer)

    def parse_request(self):
        """Plain HTTP from another device is sent to HTTPS on the same port (old invite links and QR codes keep working).
        Localhost may stay on plain HTTP: it is already a secure context, and start.sh and the tests use it."""
        if not super().parse_request():
            return False
        # A proxy or tunnel that handles HTTPS itself forwards plain HTTP, and says so in X-Forwarded-Proto.
        proxied_https = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower() == "https"
        if self.server.ssl_context and not isinstance(self.connection, ssl.SSLSocket) and not self.local() and not proxied_https:
            host = self.headers.get("Host") or f"{lan_ip()}:{PORT}"
            print(f"↪ https redirect: {self.client_address[0]} {self.command} {host}{self.path} "
                  f"via={self.headers.get('Via')} fwd={self.headers.get('X-Forwarded-For')} ua={self.headers.get('User-Agent')}")
            self.send_response(301 if self.command in ("GET", "HEAD") else 308)
            self.send_header("Location", f"https://{host}{self.path}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            self.close_connection = True
            return False
        return True

    def local(self):
        """The feedback inbox is only for whoever runs the server, on that device."""
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/feedback":
            if not self.local():
                return self.send_json(403, {"error": "Open the feedback inbox on the device running the server."})
            return self.send_json(200, list_feedback())
        if url.path == "/api/health":
            if not self.local():
                return self.send_json(403, {"error": "Health numbers are for the device running the server."})
            return self.send_json(200, health())
        if url.path == "/api/games":  # the catalogue for the home screen's game picker (#98)
            return self.send_json(200, {"games": GAME_LIST, "families": {c: [f for f, _ in fs] for c, fs in FAMILIES.items()}})
        if url.path == "/games/css.js":  # which games have their own stylesheet (static/games/*.css): app.js needUI loads only those
            if time.time() - Handler.scanned > 5:
                Handler.files, Handler.scanned = static_files(), time.time()
            names = sorted(p[7:-4] for p in self.files if p.startswith("/games/") and p.endswith(".css"))
            body = ("window.GAME_CSS = " + json.dumps(names) + ";\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return self.wfile.write(body)
        if url.path == "/api/events":
            return self.events(parse_qs(url.query))
        if url.path not in self.files:
            # a file added since the server started (e.g. a new static/gl3.js): rescan before giving up,
            # at most every few seconds (a scanner probing random paths mustn't make every miss a disk walk)
            if time.time() - Handler.scanned > 5:
                Handler.files, Handler.scanned = static_files(), time.time()
            if url.path not in self.files:
                return self.send_json(404, {"error": "Not found"})
        fname, ctype = self.files[url.path]
        etag, body, gz = static_body(fname, ctype)
        # no-cache = the browser revalidates every time, but an unchanged file costs a tiny 304, not a download.
        if etag in (self.headers.get("If-None-Match") or ""):
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        if gz is not None and self.gzip_ok():
            body = gz
        self.send_response(200)
        self.send_header("Content-Type", ctype if ctype.startswith(("image/", "font/")) else ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        if RELEASE and url.path == "/":
            self.send_header("X-Game-Night-Release", RELEASE)
        self.send_header("Vary", "Accept-Encoding")
        if body is gz:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        routes = {"/api/create": create_room, "/api/join": join_room, "/api/action": do_action, "/api/input": realtime_input,
                  "/api/status": status, "/api/replay": replay, "/api/peek": peek,
                  "/api/profile/get": profile_get, "/api/profile/put": profile_put,
                  "/api/feedback": submit_feedback, "/api/axe-debug": log_axe_debug}
        if self.local():
            routes["/api/feedback/status"] = set_feedback_status
        path = urlparse(self.path).path
        route = routes.get(path)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or self.headers.get("Transfer-Encoding"):
                raise ValueError
        except ValueError:
            self.close_connection = True
            return self.send_json(400, {"error": "Invalid request body length."})
        if not route or length > (PROFILE_WITH_BENCHMARKS_MAX if path == "/api/profile/put" else 10_000):
            self.close_connection = True   # the unread body would otherwise be parsed as the next request
            return self.send_json(404 if not route else 413, {"error": "Not found" if not route else "Too large"})
        if path in REQUEST_LIMITS:
            retry_after = allow_request(path, self.rate_limit_client())
            if retry_after:
                self.close_connection = True
                return self.send_json(429, {"error": "Too many requests. Try again shortly."},
                                      retry_after=retry_after)
        body = None
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise GameError("Bad request.")
            if path == "/api/profile/put" and length > PROFILE_POST_MAX:
                profile = body.get("profile")
                if not isinstance(profile, dict) or not isinstance(profile.get("benchmarks"), dict) or not profile_fits(profile):
                    return self.send_json(413, {"error": "Too large"})
            self.send_json(200, route(body))
        except CapacityError as e:
            self.send_json(503, {"error": str(e)}, retry_after=30)
        except GameError as e:
            self.send_json(400, {"error": str(e)})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Bad JSON."})
        except (ConnectionError, TimeoutError):
            raise
        except Exception:
            # A bug in a game: say so (the page shows the message) rather than dropping the connection.
            report_bug(f"POST {urlparse(self.path).path} code={body.get('code') if isinstance(body, dict) else None}")
            self.send_json(500, {"error": "Something went wrong — try again.", "bug": True})

    def events(self, q):
        client = self.rate_limit_client()
        retry_after = allow_request("/api/events", client)
        if retry_after:
            return self.send_json(429, {"error": "Too many stream attempts."}, retry_after=retry_after)
        first = lambda k: (q.get(k) or [""])[0]
        try:
            room = get_room(first("code"))
            with room.cond:
                p = auth(room, first("pid"), first("token"))
        except GameError as e:
            return self.send_json(403, {"error": str(e)})
        with LIMIT_LOCK:
            count = STREAMS_PER_CLIENT.get(client, 0)
            if count < MAX_STREAMS_PER_CLIENT and STREAM_SLOTS.acquire(blocking=False):
                STREAMS_PER_CLIENT[client] = count + 1
            else:
                count = None
        if count is None:
            return self.send_json(503, {"error": "Too many live streams. Try again shortly."}, retry_after=5)
        try:
            return self.stream_events(room, p)
        finally:
            with LIMIT_LOCK:
                STREAMS_PER_CLIENT[client] -= 1
                if not STREAMS_PER_CLIENT[client]:
                    del STREAMS_PER_CLIENT[client]
                STREAM_SLOTS.release()

    def stream_events(self, room, p):
        # The stream has no length: it ends when the connection closes.
        self.close_connection = True
        # One gzip stream for the whole connection, flushed after every event: each view is mostly the same
        # as the one before, so after the first one an update costs a few dozen bytes instead of kilobytes.
        gz = zlib.compressobj(6, zlib.DEFLATED, 31) if self.gzip_ok() else None
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")   # a reverse proxy must pass events through as they come
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        with room.cond:
            room.connected(p)
            room.bump()
        with STATS_LOCK:
            STATS["streams"] += 1
        last, last_fast = -1, room.fast_ver
        sent_games = False
        try:
            while True:
                with room.cond:
                    if room.version == last and room.fast_ver == last_fast:
                        room.cond.wait(10)
                    if room.code not in ROOMS or p.id not in room.players:
                        break
                    payload = None
                    if room.version != last:
                        try:
                            v = room.view(p)
                        except Exception:
                            # A game's view is broken (e.g. a room saved by older code): keep the stream open and
                            # wait for the next version instead of dying and being reopened into the same crash.
                            report_bug(f"view room={room.code} game={room.settings.get('game')}")
                            last = room.version
                            continue
                        # The game catalogue (~45 KB) never changes while the server runs: send it once per
                        # stream, and the page keeps it (app.js onState).
                        if sent_games:
                            del v["games"]
                        sent_games = True
                        payload = json.dumps(v, separators=(",", ":"))
                    fast = room.fast if room.fast_ver != last_fast and room.phase == "playing" else None
                    last, last_fast = room.version, room.fast_ver
                out = b""
                if payload:
                    out += f"data: {payload}\n\n".encode()
                if fast:
                    out += f"event: fast\ndata: {fast}\n\n".encode()
                # Named heartbeat so the page can tell a live connection from a dead one.
                out = out or b"event: ping\ndata: {}\n\n"
                if gz:
                    out = gz.compress(out) + gz.flush(zlib.Z_SYNC_FLUSH)
                self.wfile.write(out)
                self.wfile.flush()
        except OSError:
            pass
        finally:
            with STATS_LOCK:
                STATS["streams"] -= 1
            with room.cond:
                room.disconnected(p)
                room.bump()


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "localhost"


_LAN = [0.0, ""]


def lan_url():
    """The address friends on the same Wi-Fi use, rechecked every minute (the phone may change networks)."""
    if time.time() - _LAN[0] > 60:
        _LAN[:] = [time.time(), f"{SCHEME}://{lan_ip()}:{PORT}"]
    return _LAN[1]


_BUGS = {}   # where a bug was raised -> last time its traceback was printed


def report_bug(where):
    """Print the current exception's traceback, at most once a minute per spot (a broken view is hit by every
    update to every player, and the log must stay readable)."""
    tb = traceback.extract_tb(sys.exc_info()[2])
    key = (where.split(" ")[0], tb[-1].filename, tb[-1].lineno) if tb else where
    now = time.time()
    if now - _BUGS.get(key, 0) > 60:
        _BUGS[key] = now
        print(f"⚠️  {time.strftime('%H:%M:%S')} bug in {where}:", flush=True)
        traceback.print_exc()


# A visitor closing the tab or losing signal mid-request: routine, not worth a traceback in the log.
CLIENT_GONE = (ConnectionError, TimeoutError, ssl.SSLError)


class GameServer(ThreadingHTTPServer):
    """Serves HTTPS and plain HTTP on one port: each connection's first byte says which (0x16 starts a TLS handshake)."""
    daemon_threads = True
    ssl_context = None

    def __init__(self, *args, **kwargs):
        self.connection_slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connection_slots.release()

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], CLIENT_GONE):
            return
        super().handle_error(request, client_address)

    def finish_request(self, request, client_address):
        if not self.ssl_context:
            return super().finish_request(request, client_address)
        try:
            request.settimeout(10)   # a silent client mustn't hold its thread forever
            if request.recv(1, socket.MSG_PEEK) == b"\x16":
                request = self.ssl_context.wrap_socket(request, server_side=True)
            request.settimeout(None)
        except (OSError, ssl.SSLError) as e:
            if LOG_REQUESTS:
                print(f"{client_address[0]} TLS handshake failed: {e!r}")
            return   # handshake failed, e.g. the visitor declined the certificate warning
        try:
            super().finish_request(request, client_address)
        finally:
            if isinstance(request, ssl.SSLSocket):
                request.close()


def make_ssl_context():
    """A TLS context from CERT_FILE/KEY_FILE, making a self-signed pair with openssl the first time. None → plain HTTP."""
    if not USE_SSL:
        return None
    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
        names = ",".join(["DNS:localhost", "IP:127.0.0.1"] + ([f"IP:{lan_ip()}"] if lan_ip() != "localhost" else []))
        try:
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
                            "-subj", "/CN=Game Night", "-addext", f"subjectAltName={names}",
                            "-keyout", KEY_FILE, "-out", CERT_FILE], check=True, capture_output=True)
            os.chmod(KEY_FILE, 0o600)
            print(f"Made a self-signed certificate: {CERT_FILE}")
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"⚠️  No certificate and couldn't make one ({e}); serving plain HTTP. "
                  "Install openssl (Termux: pkg install openssl-tool) or set CERT_FILE and KEY_FILE.")
            return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT_FILE, KEY_FILE)
    return ctx


SSL_CONTEXT = make_ssl_context() if __name__ == "__main__" else None
SCHEME = "https" if SSL_CONTEXT else "http"


if __name__ == "__main__":
    warm_up()
    threading.Thread(target=settle_gc, daemon=True).start()
    load_rooms()
    if ROOMS:
        print(f"Restored {len(ROOMS)} room(s) from the last run.")
    threading.Thread(target=ticker, daemon=True).start()
    threading.Thread(target=frame_ticker, daemon=True).start()
    server = GameServer(("0.0.0.0", PORT), Handler)
    server.ssl_context = SSL_CONTEXT
    print(f"Game night running → {SCHEME}://localhost:{PORT}  (friends: {SCHEME}://{lan_ip()}:{PORT})")
    server.serve_forever()
