"""Base class every game plugs into. The Room owns players, turns, timer and log;
a Game owns its rules, its slice of the view, and its bot."""


class GameError(Exception):
    pass


class Game:
    id = ""
    category = ""   # board | cards | dice | party | words | action
    howto = []      # a few short how-to-play lines
    name = ""
    icon = ""
    blurb = ""
    min_players = 2
    max_players = 2
    # key -> (label, [(value, option label), ...], default)
    settings_schema = {}
    replayable = True  # real-time games opt out of move-by-move replays

    def __init__(self, room):
        self.room = room
        self.s = room.settings

    @classmethod
    def info(cls):
        return {
            "id": cls.id, "name": cls.name, "icon": cls.icon, "blurb": cls.blurb,
            "category": cls.category, "howto": cls.howto,
            "min": cls.min_players, "max": cls.max_players, "lateJoin": hasattr(cls, "late_join"),
            "settings": [{"key": k, "label": lbl, "options": opts}
                         for k, (lbl, opts, _) in cls.settings_schema.items()],
        }

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
