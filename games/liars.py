"""Liar's Dice: the traditional bluffing dice game, centuries old and public domain.

Everyone rolls five dice in secret. Taking turns, players raise a bid about all the dice on the table,
like "at least four 3s". Instead of raising you can call the last bid a lie: all dice are shown, and
whoever was wrong loses a die. Calling "exact" bets the count is spot on: if it is, everyone else loses
a die, otherwise the caller does. Lose all your dice and you're out; the last player with dice wins."""
import time
from math import comb

from .base import Game, GameError

DICE = 5
FACE = "⚀⚁⚂⚃⚄⚅"
# how sure a bot must be that the last bid is false before calling it, and how often it bluffs
BOT = {"easy": (0.6, 0.25), "normal": (0.5, 0.12), "hard": (0.45, 0.08)}


def say(q, f):
    return f"one {f}" if q == 1 else f"{q} {f}s"


def at_least(k, n, p):
    """P(at least k successes in n tries)."""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    return sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def exactly(k, n, p):
    return comb(n, k) * p ** k * (1 - p) ** (n - k) if 0 <= k <= n else 0.0


class LiarsDice(Game):
    id = "liars"
    category = "dice"
    howto = [
        "Everyone rolls five dice in secret. You see only your own.",
        "On your turn, raise the bid about ALL the dice on the table: more dice, or the same number of a higher face (\"four 3s\" → \"four 5s\" or \"five 2s\").",
        "Or call 🤥 Liar! on the last bid: the dice are shown, and whoever was wrong loses a die. 🎯 Exact bets the count is spot on: right, and everyone else loses a die; wrong, and you lose one.",
        "With wild 1s on, every 1 counts as any face (so you can't bid 1s).",
        "Lose all your dice and you're out. The last player with dice wins.",
    ]
    name = "Liar's Dice"
    icon = "🤥"
    blurb = "Bluff about the dice under everyone's cups, or call the last bid a lie."
    min_players = 2
    max_players = 6
    settings_schema = {
        "wild": ("1s", [(True, "Wild"), (False, "Not wild")], True),
        "exact": ("🎯 Exact calls", [(True, "Allowed"), (False, "Off")], True),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.dice = []
            p.g.count = DICE
        self.round = 0
        self.showdown = None   # the last reveal, shown until the next one
        first = rng.choice(seated)
        self.room.add_log(f"🤥 Liar's Dice! {DICE} dice each" + (", 1s are wild" if self.s["wild"] else "") + f". {first.name} bids first.", "big")
        self.new_round(first.id)

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def total(self):
        return sum(p.g.count for p in self.players())

    def lowest_face(self):
        return 2 if self.s["wild"] else 1

    def new_round(self, pid):
        self.round += 1
        for p in self.players():
            p.g.dice = sorted(self.rng.randint(1, 6) for _ in range(p.g.count))
        self.bid = None       # [quantity, face, pid]
        self.bids = []
        self.room.add_log(f"🎲 Round {self.round}: everyone rolls. {self.total()} dice on the table.")
        self.room.begin_turn(pid)

    def matches(self, face):
        return sum(1 for p in self.players() for d in p.g.dice if d == face or (self.s["wild"] and d == 1))

    def skip_turn(self, p):
        return p.id not in self.seats or p.eliminated or not getattr(p.g, "count", 0)

    # -- actions

    def legal(self, q, f):
        if not (self.lowest_face() <= f <= 6 and 1 <= q <= self.total()):
            return False
        return self.bid is None or q > self.bid[0] or (q == self.bid[0] and f > self.bid[1])

    def act(self, p, a):
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "bid":
            q, f = a.get("qty"), a.get("face")
            if not all(isinstance(x, int) and not isinstance(x, bool) for x in (q, f)):
                raise GameError("Pick a number and a face.")
            if not self.lowest_face() <= f <= 6:
                raise GameError("1s are wild, so bid on 2–6." if self.s["wild"] else "Pick a face from 1 to 6.")
            if not self.legal(q, f):
                raise GameError("Raise the bid: more dice, or the same number of a higher face.")
            return self.place(p, q, f)
        if t in ("liar", "exact"):
            if self.bid is None:
                raise GameError("There's no bid to call yet: make the first bid.")
            if t == "exact" and not self.s["exact"]:
                raise GameError("Exact calls are off in this game.")
            return self.call(p, t)
        raise GameError("Unknown action.")

    def place(self, p, q, f):
        self.bid = [q, f, p.id]
        self.bids.append(self.bid)
        self.room.add_log(f"🗣️ {p.name} bids {q} × {FACE[f - 1]} ({say(q, f)})")
        self.room.advance()

    def review(self, hands, q, f, by):
        """A bid seen from the bidder's seat afterwards: how likely it was from their own dice, and if it held."""
        wild = self.s["wild"] and f != 1
        count = lambda dice: sum(1 for d in dice if d == f or (wild and d == 1))
        mine = count(hands.get(by, []))
        hidden = sum(len(d) for pid, d in hands.items() if pid != by)
        odds = at_least(q - mine, hidden, 1 / 3 if wild else 1 / 6)
        return {"by": by, "bid": [q, f], "odds": round(100 * odds), "held": sum(map(count, hands.values())) >= q}

    def call(self, p, kind):
        r = self.room
        q, f, by = self.bid
        bidder = r.players.get(by)
        n = self.matches(f)
        hands = {x.id: list(x.g.dice) for x in self.players()}
        if kind == "liar":
            lie = n < q
            losers = [bidder] if lie and bidder else [p]
            verdict = f"there are {n} — " + (f"{bidder.name if bidder else '?'} was bluffing!" if lie else f"the bid holds, {p.name} was wrong!")
            r.add_log(f"🤥 {p.name} calls {bidder.name if bidder else '?'} a liar on {say(q, f)}: {verdict}", "power")
        else:
            hit = n == q
            losers = [x for x in self.players() if x.id != p.id] if hit else [p]
            r.add_log(f"🎯 {p.name} calls exactly {say(q, f)}: there are {n}" + (" — spot on! Everyone else loses a die." if hit else f". {p.name} loses a die."), "power")
        out = []
        for x in losers:
            x.g.count -= 1
            if x.g.count <= 0:
                x.g.dice = []
                x.eliminated = True
                out.append(x)
                r.add_log(f"💀 {x.name} is out of dice!", "big")
        self.showdown = {"round": self.round, "hands": hands, "bid": [q, f], "by": by, "caller": p.id, "kind": kind,
                         "count": n, "losers": [x.id for x in losers], "wild": self.s["wild"],
                         "review": [self.review(hands, *b) for b in self.bids]}
        left = self.players()
        if len(left) == 1:
            w = left[0]
            return r.finish(w, f"🏆 {w.name} wins Liar's Dice with {w.g.count} {'die' if w.g.count == 1 else 'dice'} left!")
        # the one who lost a die starts; if they're out (or many lost), the caller does
        nxt = losers[0] if len(losers) == 1 and not losers[0].eliminated else p
        if nxt.eliminated:
            nxt = left[0]
        self.new_round(nxt.id)

    def on_timeout(self):
        p = self.room.players.get(self.room.turn)
        if p:
            self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
            self.decide(p, "normal")

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and not p.eliminated:
            was_turn = r.turn == p.id
            p.eliminated = True
            p.g.count = 0
            r.add_log(f"{p.name} left the game.")
            left = self.players()
            if len(left) == 1:
                return r.finish(left[0], f"🏳️ {p.name} left — {left[0].name} wins!")
            if was_turn:
                r.advance()
            return
        super().on_leave(p)

    # -- bots

    def chance(self, p, q, f, level, exact=False):
        """How likely a bid is, from p's own dice and the number of hidden dice."""
        own = sum(1 for d in p.g.dice if d == f or (self.s["wild"] and d == 1))
        hidden = self.total() - len(p.g.dice)
        prob = 1 / 3 if self.s["wild"] and f != 1 else 1 / 6
        need = q - own
        if level == "hard" and self.bid and self.bid[2] != p.id and self.bid[1] == f and hidden:
            need -= 1      # the bidder probably holds at least one of the face they bid
            hidden -= 1
        return exactly(need, hidden, prob) if exact else at_least(need, hidden, prob)

    def bot_turn(self, p):
        self.decide(p, p.bot or "normal")

    def decide(self, p, level):
        doubt, bluff = BOT.get(level, BOT["normal"])
        rng = self.rng
        if self.bid:
            q, f, _ = self.bid
            true = self.chance(p, q, f, level)
            if level == "easy":
                true += rng.uniform(-0.2, 0.2)
            if self.s["exact"] and level != "easy" and self.chance(p, q, f, level, exact=True) > 0.42:
                return self.call(p, "exact")
            if true < 1 - doubt:
                return self.call(p, "liar")
        # bid: the most believable of the next few raises, leaning to faces we hold
        lo = self.lowest_face()
        start_q = self.bid[0] if self.bid else 1
        options = [(q, f) for q in range(start_q, min(start_q + 3, self.total()) + 1) for f in range(lo, 7) if self.legal(q, f)]
        if not options:
            return self.call(p, "liar")
        if rng.random() < bluff:
            q, f = min(options, key=lambda o: (o[0], rng.random()))
        else:
            def score(o):
                return self.chance(p, o[0], o[1], level) - 0.03 * (o[0] - start_q) + rng.random() * (0.15 if level == "easy" else 0.03)
            q, f = max(options, key=score)
            if self.bid and self.chance(p, q, f, level) < 0.3:
                return self.call(p, "liar")   # every raise is worse than calling
        self.place(p, q, f)

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "count"):
            return ""
        return "out" if p.eliminated and p.id in self.seats else f"{p.g.count} 🎲"

    def final_scores(self):
        return {i: self.room.players[i].g.count for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        return {"liars": {
            "seats": self.seats,
            "counts": {i: r.players[i].g.count for i in self.seats if i in r.players},
            "mine": list(getattr(p.g, "dice", [])) if p.id in self.seats else [],
            "bid": self.bid, "bids": self.bids[-8:], "round": self.round,
            "total": self.total(), "wild": self.s["wild"], "exact": self.s["exact"], "low": self.lowest_face(),
            "showdown": self.showdown,
            # at the end, everyone's dice are shown
            "hands": {x.id: x.g.dice for x in self.players()} if r.phase == "over" else None,
        }}
