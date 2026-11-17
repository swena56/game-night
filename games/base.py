"""Base class every game plugs into. The Room owns players, turns, timer and log;
a Game owns its rules, its slice of the view, and its bot."""


class GameError(Exception):
    pass


class Game:
    id = ""
    category = ""   # party | action | strategy | classic | cards | dice | words (lobby groups)
    family = ""     # an optional subgroup inside a big category (Cards: trick-taking, shedding…); see games/__init__.py
    howto = []      # a few short how-to-play lines
    name = ""
    icon = ""
    blurb = ""
    min_players = 2
    max_players = 2
    # key -> (label, [(value, option label), ...], default)
    settings_schema = {}
    replayable = True  # real-time games opt out of move-by-move replays
    # 🏅 badges a player can earn in this game: key -> (emoji, name, how to earn it); see award().
    # Every game has "giant" (the room awards it); a game adds its own with badges = {**Game.badges, ...}.
    badges = {"giant": ("🧠", "Giant slayer", "Win against a hard bot")}

    def __init__(self, room):
        self.room = room
        self.s = room.settings

    @classmethod
    def info(cls):
        return {
            "id": cls.id, "name": cls.name, "icon": cls.icon, "blurb": cls.blurb,
            "category": cls.category, "family": cls.family, "howto": cls.howto,
            "tipLines": getattr(cls, "tip_lines", None),
            "min": cls.min_players, "max": cls.max_players, "lateJoin": hasattr(cls, "late_join"),
            "badges": {k: list(v) for k, v in cls.badges.items()},
            "settings": [{"key": k, "label": lbl, "options": opts, "default": d}
                         for k, (lbl, opts, d) in cls.settings_schema.items()],
        }

    def award(self, p, key, at=None):
        """Give player `p` (a Player or an id) this game's badge `key`; the room counts it for the evening
        and announces the first one (at: hold the announcement until then, see Room.add_log)."""
        award = getattr(self.room, "award", None)  # the rules tests run on small fake rooms
        if award:
            award(p, self.id, key, **({"at": at} if at is not None else {}))

    def moment(self, text, tone="gold", sound=None, to=None, at=None):
        """✨ A moment for the table: a log line that also pops up as a callout on every screen
        (Room.moment). tone: gold | good | bad | cool; sound: an SFX name or None. at: hold it until then
        (a shot still playing out on screen, #129)."""
        m = getattr(self.room, "moment", None)  # the rules tests run on small fake rooms
        if m:
            m(text, tone, sound, to, **({"at": at} if at is not None else {}))
        else:
            self.room.add_log(text, "big")

    @classmethod
    def defaults(cls):
        return {k: d for k, (_, _, d) in cls.settings_schema.items()}

    def check_players(self, seated):
        n = len(seated)
        if not self.min_players <= n <= self.max_players:
            span = (f"{self.min_players}" if self.min_players == self.max_players
                    else f"{self.min_players}–{self.max_players}")
            raise GameError(f"{self.name} needs {span} players (extra people can watch).")

    # -- to override

    def start(self, seated, rng):
        raise NotImplementedError

    def act(self, p, a):
        raise GameError("Unknown action.")

    def view(self, p):
        return {}

    def meta(self, p):
        """Short status shown on a player's chip."""
        return ""

    def final_scores(self):
        """{player id: number} for score-based games, recorded in the match history."""
        return {}

    # -- standings between rounds (the shared results card, `standingsCard` in app.js)

    low_wins = False  # True when the lowest score wins (Shut the Box)

    def mark_round(self):
        """Call when a round starts: the standings shown after it count gains from here."""
        self.round_start = dict(self.final_scores() or {})

    def standings(self):
        """[{id, total, gain, rank, was}] best first; `was` is the rank before this round."""
        now = self.final_scores() or {}
        before = getattr(self, "round_start", {})
        def ranks(scores):
            order = sorted(scores, key=lambda i: scores[i], reverse=not self.low_wins)
            out = {}
            for k, pid in enumerate(order):  # ties share a rank
                out[pid] = out[order[k - 1]] if k and scores[pid] == scores[order[k - 1]] else k + 1
            return out
        prev = {pid: before.get(pid, 0) for pid in now}
        rn = ranks(now)
        rb = rn if len(set(prev.values())) <= 1 else ranks(prev)  # all level before (round 1): nobody "moved"
        return [{"id": pid, "total": now[pid], "gain": now[pid] - before.get(pid, 0), "rank": rn[pid], "was": rb[pid]}
                for pid in sorted(now, key=lambda i: rn[i])]

    def skip_turn(self, p):
        return False

    def bot_turn(self, p):
        pass

    # -- shared behaviour

    def require_turn(self, p):
        if self.room.turn != p.id:
            raise GameError("It's not your turn.")

    def bot_ready(self):
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_tick(self):
        self.bot_turn(self.room.players[self.room.turn])

    def on_timeout(self):
        r = self.room
        r.add_log(f"⏰ {r.players[r.turn].name} ran out of time!", "power")
        r.advance()

    def on_leave(self, p):
        r = self.room
        left = [o for o in r.contenders() if o.id != p.id]
        r.add_log(f"{p.name} left the game.")
        if len(left) == 1:
            r.finish(left[0], f"🏳️ {p.name} left — {left[0].name} wins!")
        elif not left:
            r.finish(None, "Everyone left.")
        elif r.turn == p.id:
            r.advance()
        p.eliminated = True


def shift_times(game, shift, ref):
    """Move every clock a game keeps on by `shift` seconds: the game was paused (or the server was down) at
    `ref`. For games without their own on_restore. A clock is any number within two days of `ref` (a
    time.time() stamp), found in the game's fields, its players' state (p.g) and the lists, dicts and small
    objects inside them (a snowball's flight t0/t1, a bot's next move)."""
    lo, hi = ref - 172800, ref + 172800
    seen = set()

    def walk(x, depth):
        if depth > 5 or id(x) in seen:
            return x
        if isinstance(x, bool):
            return x
        if isinstance(x, (int, float)):
            return x + shift if lo < x < hi else x
        if isinstance(x, (str, bytes)) or x is None:
            return x
        seen.add(id(x))
        if isinstance(x, list):
            for i, v in enumerate(x):
                x[i] = walk(v, depth + 1)
        elif isinstance(x, dict):
            for k in list(x):
                x[k] = walk(x[k], depth + 1)
        elif isinstance(x, tuple):
            return tuple(walk(v, depth + 1) for v in x)
        elif hasattr(x, "__dict__") and not callable(x) and type(x).__module__ != "random":
            for k, v in list(vars(x).items()):
                if k in ("room", "rng", "s", "streams", "cond") or k.startswith("__"):
                    continue
                setattr(x, k, walk(v, depth + 1))
        return x

    for k, v in list(vars(game).items()):
        if k in ("room", "rng", "s"):
            continue
        setattr(game, k, walk(v, 1))
    for p in getattr(game.room, "players", {}).values():
        g = getattr(p, "g", None)
        if g is not None:
            p.g = walk(g, 1)

