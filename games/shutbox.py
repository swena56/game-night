"""Shut the Box: the traditional pub dice game.

Each player has a box of tiles numbered 1–9 (or 1–12). On your turn you roll two dice and shut any open
tiles that add up to the roll (5 + 3, 8, 6 + 2 or 1 + 3 + 4 for an 8), then roll again. Once every tile
from 7 up is shut you may roll a single die instead. When no open tiles add up to your roll, your turn
ends and the open tiles are your points for the round. Shutting every tile ("shutting the box") scores 0.
After the last round the lowest total wins. Playing alone is a score attack against a target."""
import random
import time
from functools import lru_cache
from itertools import combinations

from .base import Game, GameError

STUCK_PAUSE = 1.8   # seconds to look at a roll that fits nothing before the next box
ROUND_PAUSE = 3.5   # seconds on the round's results
TWO = {t: sum(1 for a in range(1, 7) for b in range(1, 7) if a + b == t) / 36 for t in range(2, 13)}
ONE = {t: 1 / 6 for t in range(1, 7)}
SOLO_TARGET = {9: 10, 12: 32}  # points per round to beat alone (perfect play averages 11.0 and 35.1)


def options(open_tiles, total):
    """Every set of open tiles that adds up to `total`."""
    out = []
    tiles = sorted(open_tiles)
    for k in range(1, len(tiles) + 1):
        for combo in combinations(tiles, k):
            if sum(combo) == total:
                out.append(list(combo))
    return out


def may_roll_one(open_tiles, one_die):
    return one_die and all(t < 7 for t in open_tiles)


@lru_cache(maxsize=4)
def expected(n, one_die):
    """Perfect play: E[mask] = lowest expected points from this box (bit i = tile i + 1 open), about to roll.
    Also best[mask][roll] = the tiles to shut for that roll (as a mask) under perfect play."""
    full = (1 << n) - 1
    tsum = [sum(i + 1 for i in range(n) if m >> i & 1) for m in range(full + 1)]
    E = [0.0] * (full + 1)
    best = [None] * (full + 1)
    for m in sorted(range(1, full + 1), key=lambda m: bin(m).count("1")):  # smaller boxes first
        pick = {}  # roll total -> (expected after, submask)
        sub = m
        while sub:
            s = tsum[sub]
            if s <= 12:
                e = E[m ^ sub]
                if s not in pick or e < pick[s][0]:
                    pick[s] = (e, sub)
            sub = (sub - 1) & m
        def value(dist):
            return sum(p * (pick[t][0] if t in pick else tsum[m]) for t, p in dist.items())
        e2 = value(TWO)
        one = one_die and all(not (m >> i & 1) for i in range(6, n))
        e1 = value(ONE) if one else None
        E[m] = min(e2, e1) if one else e2
        best[m] = ({t: v[1] for t, v in pick.items()}, one and e1 < e2)
    return E, best


def to_mask(tiles):
    return sum(1 << (t - 1) for t in tiles)


def from_mask(m):
    return [i + 1 for i in range(m.bit_length()) if m >> i & 1]


class ShutBox(Game):
    id = "shutbox"
    category = "dice"
    howto = [
        "Roll two dice, then tap open tiles that add up to the roll (an 8 could be 8, 6 + 2, 5 + 3 or 1 + 3 + 4) and Shut them.",
        "Keep rolling and shutting. Once every tile from 7 up is shut you may roll just one die.",
        "When no open tiles add up to your roll, your turn ends: the open tiles are your points.",
        "Shut every tile to shut the box: 0 points. Lowest total after the last round wins. Alone, beat the target.",
    ]
    name = "Shut the Box"
    icon = "📦"
    blurb = "The traditional pub dice game: shut the numbered tiles that match your roll, and leave as little open as you can."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "shut": ("📦", "Shut it!", "Shut every tile in the box")}
    settings_schema = {
        "tiles": ("Tiles", [(9, "1–9 (classic)"), (12, "1–12 (long)")], 9),
        "rounds": ("Rounds", [(3, "3"), (1, "1"), (5, "5")], 3),
        "onedie": ("One die", [(True, "Allowed once 7 and up are shut"), (False, "Always roll two")], True),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.n = self.s["tiles"]
        for p in seated:
            p.g.scores = []
            p.g.tiles = list(range(1, self.n + 1))
            p.g.shut_count = 0  # boxes shut over the game
        self.round = 0
        self.first = rng.randrange(len(seated))
        self.room.add_log(f"📦 Shut the Box! {self.s['rounds']} round{'s' * (self.s['rounds'] != 1)}, tiles 1–{self.n}. "
                          "Lowest total wins.", "big")
        self.new_round()

    def late_join(self, p):
        """Play from the next round. Lowest total wins, so each round you missed counts as its worst score."""
        p.g.tiles = list(range(1, self.n + 1))
        p.g.scores = [self.worst(k) for k in range(len(self.done_rounds()))]
        p.g.shut_count = 0
        self.seats.append(p.id)
        self.room.add_log(f"📦 {p.name} plays from the next round; missed rounds count as that round's worst score.")

    def done_rounds(self):
        """Rounds already scored (the current one counts once everyone has played it)."""
        return range(self.round if self.stage == "between" else self.round - 1)

    def worst(self, k):
        got = [self.pl(pid).g.scores[k] for pid in self.seats if self.pl(pid) and len(getattr(self.pl(pid).g, "scores", [])) > k]
        return max(got) if got else sum(range(1, self.n + 1))

    def pl(self, pid):
        return self.room.players.get(pid)

    low_wins = True

    def new_round(self):
        self.mark_round()
        self.round += 1
        self.done = []          # who has played their box this round
        self.stage = "play"
        self.dice, self.rolled, self.roll_id, self.last = [], False, getattr(self, "roll_id", 0), None
        for pid in self.seats:
            p = self.pl(pid)
            if p:
                p.g.tiles = list(range(1, self.n + 1))
        self.room.add_log(f"🔁 Round {self.round} of {self.s['rounds']}.")
        order = self.seats[self.first:] + self.seats[:self.first]
        self.first = (self.first + 1) % len(self.seats)  # a different opener every round
        self.order = [pid for pid in order if self.live(pid)]
        self.next_box()

    def live(self, pid):
        p = self.pl(pid)
        return p is not None and not p.eliminated and not p.spectator

    def next_box(self):
        todo = [pid for pid in self.order if pid not in self.done and self.live(pid)]
        if not todo:
            return self.end_round()
        self.dice, self.rolled, self.stage = [], False, "play"
        self.room.begin_turn(todo[0])

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're watching this game.")
        self.require_turn(p)
        if self.stage != "play":
            raise GameError("Wait a moment.")
        t = a.get("type")
        if t == "roll":
            n = a.get("dice", 2)
            if self.rolled:
                raise GameError("Shut tiles that add up to your roll first.")
            if n not in (1, 2) or (n == 1 and not may_roll_one(p.g.tiles, self.s["onedie"])):
                raise GameError("You may roll one die only once every tile from 7 up is shut.")
            return self.roll(p, n)
        if t == "shut":
            tiles = a.get("tiles")
            if not self.rolled:
                raise GameError("Roll first.")
            if not (isinstance(tiles, list) and tiles and all(isinstance(x, int) and not isinstance(x, bool) for x in tiles)
                    and len(set(tiles)) == len(tiles) and set(tiles) <= set(p.g.tiles)):
                raise GameError("Pick open tiles.")
            if sum(tiles) != sum(self.dice):
                raise GameError(f"Those add up to {sum(tiles)}; you rolled {sum(self.dice)}.")
            return self.shut(p, tiles)
        raise GameError("Unknown action.")

    def roll(self, p, n):
        self.dice = [self.rng.randint(1, 6) for _ in range(n)]
        self.rolled = True
        self.roll_id += 1
        total = sum(self.dice)
        if options(p.g.tiles, total):
            self.room.add_log(f"🎲 {p.name} rolls {' + '.join(map(str, self.dice))} = {total}." if n == 2 else f"🎲 {p.name} rolls one die: {total}.")
            return
        pts = sum(p.g.tiles)
        self.last = {"by": p.id, "pts": pts, "shut": False}
        self.room.add_log(f"🎲 {p.name} rolls {total}: nothing fits. {pts} point{'s' * (pts != 1)} "
                          f"({' '.join(map(str, p.g.tiles))}).", "power")
        self.stage = "stuck"
        self.room.deadline = time.time() + STUCK_PAUSE  # the pause, not the bot, moves on

    def shut(self, p, tiles):
        p.g.tiles = [t for t in p.g.tiles if t not in tiles]
        self.rolled = False
        if p.g.tiles:
            self.room.add_log(f"📦 {p.name} shuts {' + '.join(map(str, sorted(tiles, reverse=True)))}.", "question")
            if self.room.settings["timer"]:
                self.room.begin_turn(p.id)  # a fresh clock for the next roll
            return
        p.g.shut_count = getattr(p.g, "shut_count", 0) + 1
        self.last = {"by": p.id, "pts": 0, "shut": True}
        self.award(p, "shut")
        self.room.add_log(f"🎉 {p.name} SHUTS THE BOX! 0 points.", "big")
        self.end_box(p)

    def end_box(self, p):
        p.g.scores.append(sum(p.g.tiles))
        self.done.append(p.id)
        self.next_box()

    def end_round(self):
        r = self.room
        live = [self.pl(pid) for pid in self.seats if self.live(pid)]
        if not live:
            return r.finish(None, "Everyone left.")
        worst = self.worst(self.round - 1)
        for p in live:  # someone who joined during this round missed it
            if len(p.g.scores) < self.round:
                p.g.scores.append(worst)
        r.add_log("🧮 Round " + str(self.round) + ": " + " · ".join(
            f"{p.name} {p.g.scores[-1] if len(p.g.scores) == self.round else '—'} ({self.total(p)})" for p in live), "big")
        if self.round >= self.s["rounds"]:
            return self.finish_game(live)
        self.stage = "between"
        r.turn = None
        r.deadline = time.time() + ROUND_PAUSE

    def total(self, p):
        return sum(getattr(p.g, "scores", []))

    def target(self):
        return SOLO_TARGET[self.n] * self.s["rounds"]

    def finish_game(self, live):
        r = self.room
        if len(self.seats) == 1:
            p = live[0]
            t, goal = self.total(p), self.target()
            if t <= goal:
                return r.finish(p, f"🏆 {p.name} finishes on {t} points, at or under the target of {goal}!")
            return r.finish(None, f"📦 {p.name} finishes on {t} points. Get to {goal} or less to win alone.")
        low = min(self.total(p) for p in live)
        best = [p for p in live if self.total(p) == low]
        if len(best) == 1:
            return r.finish(best[0], f"🏆 {best[0].name} wins Shut the Box with {low} point{'s' * (low != 1)}!")
        r.finish(None, f"🤝 A tie at {low} between {' & '.join(p.name for p in best)}.")

    def on_timeout(self):
        r = self.room
        if self.stage == "stuck":
            return self.end_box(self.pl(r.turn))
        if self.stage == "between":
            return self.new_round()
        p = self.pl(r.turn)
        r.add_log(f"⏰ {p.name} ran out of time; the autopilot plays the box.", "power")
        while r.turn == p.id and self.stage == "play":
            self.step(p, "normal")
        if self.stage == "stuck":
            self.end_box(p)

    def skip_turn(self, p):
        return p.id not in self.seats or p.id in self.done

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the table.")
        live = [pid for pid in self.seats if self.live(pid)]
        if len(self.seats) > 1 and len(live) < 2:
            if live:
                return r.finish(self.pl(live[0]), f"🏆 {self.pl(live[0]).name} wins: everyone else left.")
            return r.finish(None, "Everyone left.")
        if r.turn == p.id:
            self.stage = "play"
            self.next_box()

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "scores"):
            return ""
        return f"{self.total(p)} pts · 📦 {len(p.g.tiles)} open"

    def final_scores(self):
        return {pid: self.total(self.pl(pid)) for pid in self.seats if self.pl(pid)}

    def view(self, p):
        r = self.room
        cur = self.pl(r.turn) if r.turn else None
        boxes = {pid: {"tiles": getattr(self.pl(pid).g, "tiles", []), "scores": getattr(self.pl(pid).g, "scores", []),
                       "total": self.total(self.pl(pid))} for pid in self.seats if self.pl(pid)}
        open_now = cur.g.tiles if cur else []
        opts = options(open_now, sum(self.dice)) if cur and self.rolled and self.stage == "play" else []
        return {"shutbox": {
            "seats": self.seats, "n": self.n, "round": self.round, "rounds": self.s["rounds"], "stage": self.stage,
            "boxes": boxes, "dice": self.dice, "rolled": self.rolled, "rollId": self.roll_id,
            "options": opts, "canOne": bool(cur) and not self.rolled and may_roll_one(open_now, self.s["onedie"]),
            "done": self.done, "last": self.last, "target": self.target() if len(self.seats) == 1 else None,
            "standings": self.standings() if self.stage == "between" and len(self.seats) > 1 else None,
        }}

    # -- bots: one decision per call

    def choose(self, p, level):
        """('roll', dice) or ('shut', tiles) for this player's box."""
        if not self.rolled:
            one = may_roll_one(p.g.tiles, self.s["onedie"])
            if not one:
                return "roll", 2
            if level == "easy":
                return "roll", random.choice((1, 2))
            if level == "normal":
                return "roll", 1 if sum(p.g.tiles) <= 6 else 2
            _, best = expected(self.n, self.s["onedie"])
            return "roll", 1 if best[to_mask(p.g.tiles)][1] else 2
        opts = options(p.g.tiles, sum(self.dice))
        if level == "easy":
            return "shut", random.choice(opts)
        if level == "normal":  # fewest tiles, then the highest ones (high tiles are the hard ones to shut later)
            return "shut", min(opts, key=lambda o: (len(o), -max(o)))
        _, best = expected(self.n, self.s["onedie"])
        return "shut", from_mask(best[to_mask(p.g.tiles)][0][sum(self.dice)])

    def step(self, p, level):
        kind, arg = self.choose(p, level)
        if kind == "roll":
            self.roll(p, arg)
        else:
            self.shut(p, arg)

    def bot_ready(self):
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot) and self.stage == "play"  # the stuck and round pauses run on the clock

    def bot_turn(self, p):
        self.step(p, p.bot)
        if self.room.turn == p.id and self.stage == "play":
            self.room.bot_at = time.time() + 0.9
