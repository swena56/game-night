#!/usr/bin/env python3
"""Game night server: rooms, lobbies, bots and live updates for every game in games/.

Zero dependencies (Python 3 stdlib only). Run `python3 server.py` and open
http://localhost:8000. Friends on the same network join via your LAN IP.

Transport: clients POST actions to /api/action and receive their own
per-player view of the room over Server-Sent Events (/api/events).
"""
import json
import os
import pickle
import random
import secrets
import socket
import threading
import time
import traceback
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from games import GAME_INFO, GAMES, GameError
from games.wordsmith import warm_up

PORT = int(os.environ.get("PORT", 8000))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
CONTENT_TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}
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
ROOM_SETTINGS_INFO = [{"key": k, "label": lbl, "options": opts} for k, (lbl, opts, _) in ROOM_SETTINGS.items()]
CHAT_KEEP = 100
BANTER = {
    "win": ["gg 😎", "beep boop, victory 🤖", "too easy", "I calculated that 0.3s ago"],
    "lose": ["gg!", "rematch? 🔁", "I demand a recount", "well played, human", "my circuits need a nap"],
}
PLAYER_COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419", "#cc5de8", "#ff922b", "#20c997", "#f06595"]
BOT_NAMES = ["Robo", "Beep", "Sprocket", "Nova", "Bolt", "Pixel"]
BOT_LEVELS = ("easy", "normal", "hard")
REACTIONS = ["😂", "😱", "🤔", "😏", "🔥", "👀", "🙈", "🎉"]
# Pages send a presence heartbeat every 10s. Dead connections often look alive to the
# server for minutes, so presence is judged by heartbeats, not by open streams.
AWAY_AFTER = 20                                            # seconds of silence before "away"
OFFLINE_GRACE = int(os.environ.get("OFFLINE_GRACE", 45))   # seconds before autopilot / host handover
# A server on another port (e.g. a test server) keeps its own rooms and inbox, so it can't overwrite the live ones.
_SUFFIX = "" if PORT == 8000 else f"-{PORT}"
SAVE_FILE = os.environ.get("ROOMS_FILE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", f"rooms{_SUFFIX}.pickle")
# Bug reports & suggestions: one JSON object per line, plus a small status map.
FEEDBACK_FILE = os.environ.get("FEEDBACK_FILE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", f"feedback{_SUFFIX}.jsonl")
FEEDBACK_STATUS = FEEDBACK_FILE.rsplit(".", 1)[0] + "-status.json"
FEEDBACK_KINDS = ("bug", "idea")
FEEDBACK_LIMIT = (5, 600)  # at most 5 reports per 10 minutes from one address


def static_files():
    files = {"/": ("index.html", "text/html")}
    for root, _, names in os.walk(STATIC_DIR):
        for n in names:
            ext = os.path.splitext(n)[1]
            if ext in CONTENT_TYPES:
                rel = os.path.relpath(os.path.join(root, n), STATIC_DIR).replace(os.sep, "/")
                files["/" + rel] = (rel, CONTENT_TYPES[ext])
    return files


RECORD = ("wins", "played", "streak", "best_streak", "by_game", "points", "quits")  # survives leave + rejoin


class Player:
    def __init__(self, name, color, spectator=False):
        self.id = secrets.token_hex(4)
        self.token = secrets.token_urlsafe(16)
        self.name = name
        self.color = color
        self.spectator = spectator
        self.streams = 0
        self.wins = 0
        self.bot = None  # difficulty level for computer players
        self.standin = False  # a bot is playing for this human while they're offline
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
        self.reset()

    def __setstate__(self, state):  # rooms saved by older versions lack newer fields
        self.__dict__.update({"last_chat": 0, "played": 0, "streak": 0, "best_streak": 0, "by_game": {},
                              "points": 0, "quits": 0})
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


class Room:
    def __init__(self, code):
        self.code = code
        self.cond = threading.Condition()
        self.version = 0
        self.fast, self.fast_ver = None, 0  # real-time side channel (see push_fast)
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
        self._eid = 0

    def __getstate__(self):
        state = self.__dict__.copy()
        del state["cond"]
        state["_saved_at"] = time.time()
        return state

    def __setstate__(self, state):
        self.__dict__.update({"chat": [], "ready": set(), "votes": {}, "ledger": {}, "history": [], "replay": [],
                              "_replay_key": None, "saved": {}, "fast": None, "fast_ver": 0})
        self.__dict__.update(state)
        for k, (_, _, d) in ROOM_SETTINGS.items():
            self.settings.setdefault(k, d)
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
        if self.game and self.phase == "playing" and hasattr(self.game, "on_restore"):
            self.game.on_restore(shift)
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
        if self.phase == "playing":
            for p in self.contenders():
                if not p.bot and away(p):
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

    def add_log(self, text, kind="info", to=None, check=None, helper=None):
        self._eid += 1
        self.log.append({"id": self._eid, "text": text, "kind": kind, "to": to,
                         "check": check, "helper": helper})
        self.log = self.log[-150:]

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

    def finish(self, winner, text):
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
        for p in seated:
            if getattr(p, "quitting", False):
                p.last_pts, p.streak = 0, 0
                continue
            p.played += 1
            p.last_pts = POINTS_WIN if winner and p.id == winner.id else POINTS_PLAYED
            p.points += p.last_pts
            if winner and p.id == winner.id:
                p.wins += 1
                p.streak += 1
                p.best_streak = max(p.best_streak, p.streak)
                p.by_game[gid] = p.by_game.get(gid, 0) + 1
            else:
                p.streak = 0
        info = GAMES[gid]
        self.history.append({
            "game": gid, "icon": info.icon, "name": info.name, "at": time.time(), "text": text,
            "winner": winner.name if winner else None,
            "players": [{"name": p.name, "color": p.color, "score": scores.get(p.id), "pts": p.last_pts,
                         "won": bool(winner and p.id == winner.id)} for p in seated],
        })
        self.history = self.history[-30:]
        for p in seated:
            if p.bot and not p.standin and random.random() < 0.6:
                lines = BANTER["win" if winner and p.id == winner.id else "lose"]
                self.add_chat(p, random.choice(lines))

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
        for k in ("games", "roomSettings", "reactions", "chat", "ready", "votes", "history", "hasReplay"):
            v.pop(k, None)
        v["log"] = v["log"][-2:]
        v["timeLeft"] = None
        key = json.dumps({k: x for k, x in v.items() if k not in ("players", "log")}, sort_keys=True)
        if key == self._replay_key:
            return
        self._replay_key = key
        self.replay.append(json.dumps(v))
        self.replay = self.replay[-500:]

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if t == "react":
            if a.get("emoji") not in REACTIONS:
                raise GameError("Unknown reaction.")
            self._eid += 1
            self.reactions = self.reactions[-19:] + [{"id": self._eid, "pid": p.id, "emoji": a["emoji"]}]
            return
        if t == "chat":
            return self.chat_message(p, a.get("text"))
        if t == "ready":
            if self.phase != "over":
                raise GameError("Not right now.")
            self.ready ^= {p.id}
            return
        if t == "kick":
            return self.kick(p, a.get("player"))
        if t == "reset_scores":
            if p.id != self.host:
                raise GameError("Only the host can do that.")
            for o in self.players.values():
                o.wins = o.played = o.streak = o.best_streak = o.points = o.quits = 0
                o.by_game = {}
            self.history = []
            self.ledger = {}
            self.add_log(f"{p.name} reset the scoreboard.")
            return
        if t == "leave":
            return self.leave(p)
        if t == "settings":
            return self.change_settings(p, a.get("settings") or {})
        if t == "add_bot":
            self.require_host(p, "lobby")
            return self.add_bot(a.get("level"))
        if t == "remove_bot":
            self.require_host(p, "lobby")
            bot = self.players.get(a.get("bot"))
            if not bot or not bot.bot or bot.standin:
                raise GameError("No such bot.")
            self.add_log(f"{bot.name} was unplugged.")
            return self.remove_player(bot)
        if t == "start":
            self.require_host(p, "lobby")
            return self.start()
        if t == "next_vote":  # pick the next game; toggles, and a unanimous vote starts it
            if self.phase != "over":
                raise GameError("Voting opens when the game ends.")
            gid = a.get("game")
            if gid not in GAMES or not self.fits(gid):
                raise GameError("That game doesn't fit this many players.")
            if self.votes.get(p.id) == gid:
                del self.votes[p.id]
                return
            self.votes[p.id] = gid
            voters = [o.id for o in self.players.values() if not o.bot or o.standin]
            if all(self.votes.get(i) == gid for i in voters):
                return self.play_vote()
            return
        if t == "play_vote":
            self.require_host(p, "over")
            if not self.votes:
                raise GameError("Nobody has voted yet.")
            return self.play_vote()
        if t == "join_game":  # a spectator sits in mid-game, in games that allow it (Game.late_join)
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
            p.spectator = False
            self.add_log(f"🙋 {p.name} joins the game!", "big")
            return
        if t == "rematch":  # same game, same settings, straight back in
            self.require_host(p, "over")
            return self.start()
        if t == "lobby":
            self.require_host(p, "over")
            return self.to_lobby()
        if t == "end_game":  # the host stops a running game for everyone; nobody gains or loses points
            self.require_host(p, "playing")
            self.add_log(f"🛑 {p.name} ended the game.", "big")
            return self.to_lobby()
        if self.phase != "playing":
            raise GameError("The game isn't running.")
        if p.spectator:
            raise GameError("Spectators can't play.")
        self.game.act(p, a)

    def require_host(self, p, phase):
        if p.id != self.host:
            raise GameError("Only the host can do that.")
        if self.phase != phase:
            raise GameError("Not right now.")

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
        self.log = []
        self.winner = None
        self.turn = None
        self.deadline = None
        self.game = game
        self.phase = "playing"
        self.ready = set()
        self.votes = {}
        self.replay = []
        self._replay_key = None
        game.start(list(seated), random.Random())
        self.snap()

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
        if p.id != self.host:
            raise GameError("Only the host can do that.")
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
            if p.spectator and len(self.seated()) < MAX_PLAYERS:
                p.spectator = False
        self.add_log("Back to the lobby for another round!", "big")

    def leave(self, p):
        if self.phase == "playing" and not p.spectator and not p.eliminated:
            p.points += POINTS_QUIT
            p.quits += 1
            self.add_log(f"🚪 {p.name} walked out mid-game ({POINTS_QUIT} ⭐).", "power")
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
            "phase": self.phase,
            "settings": self.settings,
            "gameId": self.settings["game"],
            "games": GAME_INFO,
            "roomSettings": ROOM_SETTINGS_INFO,
            "host": self.host,
            "turn": self.turn,
            "timeLeft": max(0.0, self.deadline - time.time()) if self.deadline else None,
            "winner": self.winner,
            "reactions": self.reactions,
            "log": [e for e in self.log if e["to"] is None or e["to"] == p.id or see_all][-80:],
            "players": [{
                "id": o.id, "name": o.name, "color": o.color, "spectator": o.spectator,
                "eliminated": o.eliminated, "online": not o.shown_away, "wins": o.wins,
                "bot": None if o.standin else o.bot, "meta": self.game.meta(o) if self.game else "",
                "standin": o.standin, "away": o.shown_away and not o.standin,
                "played": o.played, "streak": o.streak, "best": o.best_streak, "byGame": o.by_game,
                "points": o.points, "quits": o.quits,
            } for o in (self.players[i] for i in self.order)],
            "me": {"id": p.id, "name": p.name, "spectator": p.spectator,
                   "eliminated": p.eliminated, "ghost": ghost},
        }
        hide_ghost_chat = self.phase == "playing" and not ghost
        v["chat"] = [m for m in self.chat if not (m["ghost"] and hide_ghost_chat)][-50:]
        v["ready"] = sorted(self.ready)
        v["votes"] = self.votes
        v["history"] = self.history[-15:]
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


def do_action(body):
    room = get_room(body.get("code"))
    with room.cond:
        p = auth(room, body.get("pid"), body.get("token"))
        room.seen(p)
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
        room.bump()
    return {"ok": True}


def realtime_input(body):
    """High-rate input for real-time games (paddle positions): no replay frame, no full broadcast."""
    room = get_room(body.get("code"))
    with room.cond:
        p = auth(room, body.get("pid"), body.get("token"))
        p.last_seen = time.time()
        game = room.game if room.phase == "playing" else None
        if not game or not hasattr(game, "on_input"):
            raise GameError("Not right now.")
        game.on_input(p, body)
    return {"ok": True}


def status(body):
    room = get_room(body.get("code"))
    with room.cond:
        p = auth(room, body.get("pid"), body.get("token"))
        if room.seen(p):
            room.bump()
    return {"ok": True}


def replay(body):
    room = get_room(body.get("code"))
    with room.cond:
        auth(room, body.get("pid"), body.get("token"))
        if room.phase == "playing":
            raise GameError("Replays unlock when the game ends.")
        return {"frames": [json.loads(f) for f in room.replay]}


FEEDBACK_LOCK = threading.Lock()
FEEDBACK_HITS = defaultdict(deque)


def submit_feedback(body, ip):
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
        hits = FEEDBACK_HITS[ip]
        while hits and now - hits[0] > FEEDBACK_LIMIT[1]:
            hits.popleft()
        if len(hits) >= FEEDBACK_LIMIT[0]:
            raise GameError("Thanks! That's a lot of reports — please try again in a few minutes.")
        hits.append(now)
        try:
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


def save_rooms():
    data = {}
    for code, room in list(ROOMS.items()):
        with room.cond:
            data[code] = pickle.dumps(room)
    tmp = SAVE_FILE + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(data, f)
    os.replace(tmp, SAVE_FILE)


def load_rooms():
    """Restore rooms saved by a previous run (our own file, written by save_rooms)."""
    try:
        with open(SAVE_FILE, "rb") as f:
            data = pickle.load(f)
        for code, blob in data.items():
            ROOMS[code] = pickle.loads(blob)
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
                game = room.game if room.phase == "playing" else None
                if game:
                    try:
                        if now >= room.bot_at and game.bot_ready():
                            game.bot_tick()
                            room.snap()
                            room.bump()
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
    while True:
        time.sleep(1 / 60)
        now = time.time()
        for room in list(ROOMS.values()):
            game = room.game if room.phase == "playing" else None
            if game is None or not hasattr(game, "frame"):
                continue
            with room.cond:
                try:
                    if room.phase == "playing" and room.game is game and game.frame(now):
                        room.snap()
                        room.bump()
                except Exception:
                    traceback.print_exc()


# ---------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    files = static_files()

    def log_message(self, *args):
        pass

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def local(self):
        """The feedback inbox is only for whoever runs the server, on that device."""
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/feedback":
            if not self.local():
                return self.send_json(403, {"error": "Open the feedback inbox on the device running the server."})
            return self.send_json(200, list_feedback())
        if url.path == "/api/events":
            return self.events(parse_qs(url.query))
        if url.path not in self.files:
            return self.send_json(404, {"error": "Not found"})
        fname, ctype = self.files[url.path]
        with open(os.path.join(STATIC_DIR, fname), "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        routes = {"/api/create": create_room, "/api/join": join_room, "/api/action": do_action, "/api/input": realtime_input,
                  "/api/status": status, "/api/replay": replay,
                  "/api/feedback": lambda body: submit_feedback(body, self.client_address[0])}
        if self.local():
            routes["/api/feedback/status"] = set_feedback_status
        route = routes.get(urlparse(self.path).path)
        if not route:
            return self.send_json(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > 10_000:
            return self.send_json(413, {"error": "Too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise GameError("Bad request.")
            self.send_json(200, route(body))
        except GameError as e:
            self.send_json(400, {"error": str(e)})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Bad JSON."})

    def events(self, q):
        first = lambda k: (q.get(k) or [""])[0]
        try:
            room = get_room(first("code"))
            with room.cond:
                p = auth(room, first("pid"), first("token"))
        except GameError as e:
            return self.send_json(403, {"error": str(e)})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with room.cond:
            room.connected(p)
            room.bump()
        last, last_fast = -1, room.fast_ver
        try:
            while True:
                with room.cond:
                    if room.version == last and room.fast_ver == last_fast:
                        room.cond.wait(10)
                    if room.code not in ROOMS or p.id not in room.players:
                        break
                    payload = None if room.version == last else json.dumps(room.view(p))
                    fast = room.fast if room.fast_ver != last_fast and room.phase == "playing" else None
                    last, last_fast = room.version, room.fast_ver
                out = b""
                if payload:
                    out += f"data: {payload}\n\n".encode()
                if fast:
                    out += f"event: fast\ndata: {fast}\n\n".encode()
                # Named heartbeat so the page can tell a live connection from a dead one.
                self.wfile.write(out or b"event: ping\ndata: {}\n\n")
                self.wfile.flush()
        except OSError:
            pass
        finally:
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


if __name__ == "__main__":
    warm_up()
    load_rooms()
    if ROOMS:
        print(f"Restored {len(ROOMS)} room(s) from the last run.")
    threading.Thread(target=ticker, daemon=True).start()
    threading.Thread(target=frame_ticker, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"Game night running → http://localhost:{PORT}  (friends: http://{lan_ip()}:{PORT})")
    server.serve_forever()
