"""Mia: the traditional bluffing dice game (public domain; Mäxchen in Germany).

Two dice under a cup. Read them high die first (a 3 and a 5 is 53); doubles beat every plain number, and
2-1, "Mia", beats everything. On your turn you roll in secret and announce a value that beats the last
announcement, true or not. The next player either believes you and takes the cup to roll and beat it,
or lifts the cup: a lie costs the liar a life, a true call costs the lifter. Any lift over a Mia claim
costs two lives, and facing a Mia you may also concede one life without lifting. Last player with lives
wins."""
import time

from .base import Game, GameError

# every value from lowest to highest
PLAIN = [h * 10 + l for h in range(3, 7) for l in range(1, h) if (h, l) != (2, 1)]
DOUBLES = [d * 11 for d in range(1, 7)]
MIA = 21
ORDER = PLAIN + DOUBLES + [MIA]
RANK = {v: i for i, v in enumerate(ORDER)}
CHANCE = {v: (1 if v in DOUBLES else 2) / 36 for v in ORDER}


def read(a, b):
    hi, lo = max(a, b), min(a, b)
    return hi * 10 + lo


def name(v):
    if v == MIA:
        return "Mia (21)"
    if v in DOUBLES:
        return f"double {v // 11}s"
    return str(v)


def p_at_least(v):
    """Chance a fresh roll is worth v or more."""
    return sum(CHANCE[w] for w in ORDER[RANK[v]:])


def p_above(v):
    return sum(CHANCE[w] for w in ORDER[RANK[v] + 1:])


class Mia(Game):
    id = "mia"
    category = "dice"
    howto = [
        "Roll two dice in secret and read the high die first: 3 and 5 is 53. Doubles beat plain numbers, and 2-1 (🎭 Mia) beats everything.",
        "Announce a value higher than the last one — the truth, or a bluff.",
        "Next player: 🤝 believe it and roll to beat it, or 🫳 lift the cup. A lie costs the liar a life; a true call costs the lifter.",
        "A lift over a Mia claim costs 2 lives. Facing a Mia you can also concede 1 life without looking.",
        "Last player with lives left wins.",
    ]
    name = "Mia"
    icon = "🎭"
    blurb = "The traditional two-dice bluffing game: always beat the last call, or lift the cup on a liar."
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "real_mia": ("🎭", "The real Mia", "Get lifted on a true Mia")}
    settings_schema = {
        "lives": ("Lives", [(3, "3"), (5, "5"), (2, "2")], 3),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.lives = self.s["lives"]
        self.reveal = None
        self.n = 0
        self.room.add_log(f"🎭 Mia: {self.s['lives']} lives each. Beat the last call, or lift the cup!", "big")
        self.new_round(rng.choice(seated).id)

    def new_round(self, pid):
        self.claim = None      # the value on the table
        self.claimer = None
        self.truth = None      # the claimer's real dice, under the cup
        self.calls = []        # [(pid, value)] this round, for every screen
        self.begin(pid)

    def begin(self, pid):
        self.dice = None       # the current holder's own roll
        self.room.begin_turn(pid)

    def alive(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def skip_turn(self, p):
        return p.id not in self.seats

    def stage(self):
        if self.dice:
            return "claim"
        return "decide" if self.claim else "open"

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        st = self.stage()
        if t == "roll":
            if st == "claim":
                raise GameError("Announce your roll first.")
            if self.claim == MIA:
                raise GameError("Nothing beats a Mia: lift the cup or concede.")
            return self.do_roll(p)
        if t == "lift":
            if st != "decide":
                raise GameError("There's nothing to lift.")
            return self.do_lift(p)
        if t == "concede":
            if st != "decide" or self.claim != MIA:
                raise GameError("You can only concede to a Mia.")
            return self.do_concede(p)
        if t == "claim":
            v = a.get("value")
            if st != "claim":
                raise GameError("Roll first.")
            if not isinstance(v, int) or isinstance(v, bool) or v not in RANK:
                raise GameError("That's not a dice value.")
            if self.claim and RANK[v] <= RANK[self.claim]:
                raise GameError(f"You must beat {name(self.claim)}.")
            return self.do_claim(p, v)
        raise GameError("Unknown action.")

    def do_roll(self, p):
        self.dice = [self.rng.randint(1, 6), self.rng.randint(1, 6)]
        self.n += 1
        self.room.add_log(f"🥤 {p.name} {'believes it and ' if self.claim else ''}shakes the cup.")
        self.room.add_log(f"🎲 You rolled {name(read(*self.dice))}.", "private", to=p.id)

    def do_claim(self, p, v):
        self.claim, self.claimer, self.truth = v, p.id, list(self.dice)
        self.calls.append([p.id, v])
        self.n += 1
        self.room.add_log(f"📣 {p.name}: “{name(v)}!”", "question")
        self.room.advance()
        self.begin(self.room.turn)

    def do_lift(self, p):
        r = self.room
        c = r.players.get(self.claimer)
        real = read(*self.truth)
        honest = RANK[real] >= RANK[self.claim]
        loser = p if honest else c
        cost = 2 if self.claim == MIA else 1
        r.add_log(f"🫳 {p.name} lifts the cup: {name(real)}. {'True' if honest else 'A bluff'}!", "big")
        if honest and real == MIA and c:
            self.award(c, "real_mia")
            self.moment(f"🎭 {c.name} really had the Mia!", "gold", "fanfare")
        elif not honest and self.claim == MIA and c:
            self.moment(f"🫳 {p.name} catches {c.name}'s fake Mia!", "good", "whoosh")
        self.reveal = {"dice": list(self.truth), "claim": self.claim, "by": self.claimer, "lifter": p.id,
                       "loser": loser.id if loser else None, "cost": cost, "honest": honest, "n": self.n}
        self.lose(loser, cost)

    def do_concede(self, p):
        self.room.add_log(f"🏳️ {p.name} won't lift the Mia and gives up a life.", "power")
        self.reveal = {"dice": None, "claim": self.claim, "by": self.claimer, "lifter": p.id,
                       "loser": p.id, "cost": 1, "honest": None, "n": self.n}
        self.lose(p, 1)

    def lose(self, loser, cost):
        r = self.room
        self.n += 1
        if loser is None:
            # the claimer left the room: nobody pays, the lifter opens
            return self.new_round(r.turn)
        loser.g.lives = max(0, loser.g.lives - cost)
        if loser.g.lives:
            r.add_log(f"💔 {loser.name} loses {cost} {'lives' if cost > 1 else 'life'} ({loser.g.lives} left).", "power")
        else:
            loser.eliminated = True
            r.add_log(f"☠️ {loser.name} is out of lives!", "power")
        live = self.alive()
        if len(live) <= 1:
            w = live[0] if live else None
            return r.finish(w, f"🏆 {w.name} is the last one standing!" if w else "Nobody's left.")
        if loser.g.lives:
            return self.new_round(loser.id)
        # the next player still in, after the one who just went out
        i = self.seats.index(loser.id)
        nxt = next(self.seats[(i + k) % len(self.seats)] for k in range(1, len(self.seats) + 1)
                   if not r.players[self.seats[(i + k) % len(self.seats)]].eliminated)
        self.new_round(nxt)

    def on_timeout(self):
        p = self.room.players.get(self.room.turn)
        if not p:
            return
        self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
        st = self.stage()
        if st == "claim":
            self.do_claim(p, self.honest_or_least())
        elif self.claim == MIA:
            self.do_concede(p)
        else:
            self.do_roll(p)

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and r.phase == "playing":
            was_turn = r.turn == p.id
            p.eliminated = True
            r.add_log(f"{p.name} left the game.")
            live = self.alive()
            if len(live) == 1:
                return r.finish(live[0], f"🏳️ {p.name} left — {live[0].name} wins!")
            if was_turn:
                r.advance()
                self.new_round(r.turn)
            elif self.claimer == p.id:
                self.new_round(r.turn)
            return
        super().on_leave(p)

    # -- bots

    def honest_or_least(self):
        real = read(*self.dice)
        if not self.claim or RANK[real] > RANK[self.claim]:
            return real
        return ORDER[RANK[self.claim] + 1]

    def believe_chance(self):
        """How likely the claim on the table is true, judged from the odds and the call before it."""
        prev = self.calls[-2][1] if len(self.calls) > 1 else None
        c = self.claim
        if not prev:   # an opening call can be anything; bluffs here are rarer but a big one is suspicious
            return 0.4 + 0.6 * p_at_least(c)
        lo = RANK[prev] + 1 if prev else 0
        # an honest claimer rolled exactly c; a liar rolled anything below the bar, then picked c among the lies
        honest = CHANCE[c]
        could_lie = sum(CHANCE[w] for w in ORDER[:lo])
        steps = len(ORDER) - lo
        liar = could_lie * (0.5 if c == ORDER[min(lo, len(ORDER) - 1)] else 0.5 / max(1, steps - 1))
        return honest / (honest + liar) if honest + liar else 1.0

    def bot_turn(self, p):
        r = self.room
        level = p.bot or "normal"
        st = self.stage()
        if st == "claim":
            real = read(*self.dice)
            if not self.claim or RANK[real] > RANK[self.claim]:
                v = real
                if level == "hard" and real not in DOUBLES and real != MIA and self.rng.random() < 0.2:
                    v = ORDER[min(RANK[real] + 1, len(ORDER) - 2)]   # now and then claim one above a true roll
            else:
                base = RANK[self.claim] + 1
                spread = {"easy": 4, "normal": 1, "hard": 3}[level]
                k = min(len(ORDER) - 1, base + self.rng.randrange(spread))
                if level == "hard":
                    k = min(k, len(ORDER) - 2) if self.rng.random() < 0.8 else k   # a fake Mia is a big risk
                v = ORDER[k]
            self.do_claim(p, v)
            return
        if st == "open":
            self.do_roll(p)
            r.bot_at = time.time() + 1.2
            return
        # believe or lift?
        c = self.claim
        if level == "easy":
            pt = p_at_least(c)
        else:
            pt = self.believe_chance() if level == "hard" else p_at_least(c)
        if c == MIA:
            lift = pt < (0.5 if level != "easy" else self.rng.random())
            self.do_lift(p) if lift else self.do_concede(p)
            return
        beat = p_above(c)
        risk_believe = (1 - beat) * (0.45 if level == "hard" else 0.5)
        noise = {"easy": 0.25, "normal": 0.08, "hard": 0.03}[level]
        if pt + self.rng.uniform(-noise, noise) < risk_believe:
            self.do_lift(p)
        else:
            self.do_roll(p)
            r.bot_at = time.time() + 1.2

    # -- view

    def meta(self, p):
        lives = getattr(p.g, "lives", None)
        return "" if lives is None else ("☠️ out" if lives == 0 else "❤️" * lives if lives <= 5 else f"❤️×{lives}")

    def final_scores(self):
        return {i: self.room.players[i].g.lives for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        mine = r.turn == p.id
        need = None
        if self.claim:
            need = ORDER[RANK[self.claim] + 1] if self.claim != MIA else None
        return {"mia": {
            "seats": self.seats, "order": ORDER, "claim": self.claim, "claimer": self.claimer,
            "calls": self.calls[-8:], "stage": self.stage(), "need": need, "n": self.n,
            "dice": self.dice if mine else None, "rolled": bool(self.dice),
            "lives": {i: r.players[i].g.lives for i in self.seats if i in r.players},
            "maxLives": self.s["lives"], "reveal": self.reveal,
        }}
