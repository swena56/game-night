"""Dice Derby: an original betting-race dice game.

Six horses, numbered 1–6, race down a track. At the start of each race everyone is dealt two secret
tickets (horse numbers). On your turn roll three dice and use all three: one die's horse gallops +2,
another's trots +1, and the third's stumbles back 1. The race ends the moment a horse crosses the line;
tickets on the 1st, 2nd and 3rd horses pay 5, 3 and 1. Everyone sees what you push and what you hold
back, so steer the race toward your tickets without giving them away."""
import time

from .base import Game, GameError

HORSES = 6
TRACK = 12
PAY = (5, 3, 1)
LAG = 6          # 🐴 Long shot: a horse that trailed the leader by this many squares...
LONG_BONUS = 3   # ...and then still wins adds this to each ticket on it
MOVES = (2, 1, -1)
PERMS = [(0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)]


def places(pos):
    """{horse: place 0, 1, 2…}; tied horses share the better place."""
    order = sorted(range(1, HORSES + 1), key=lambda h: -pos[h])
    out = {}
    for k, h in enumerate(order):
        out[h] = out[order[k - 1]] if k and pos[h] == pos[order[k - 1]] else k
    return out


def payout(pos, tickets, longs=()):
    pl = places(pos)
    return sum((PAY[pl[h]] if pl[h] < len(PAY) else 0) + (LONG_BONUS if h in longs and pl[h] == 0 else 0) for h in tickets)


def portfolio(pos, tickets, before=None, longs=()):
    """🎟️ One owner's tickets as things stand: each horse's place, what it would pay if the race ended
    now, the horses it should pass (knocking them back helps) and the ones that threaten it (pushing
    them on hurts), and what the last move did to the payout."""
    pl = places(pos)
    rows = []
    for h in tickets:
        x = pos[h]
        others = [k for k in pos if k not in tickets]
        above = [pos[k] for k in others if pos[k] > x]
        below = [pos[k] for k in others if pos[k] < x]
        tied = sorted(k for k in others if pos[k] == x)
        rows.append({
            "horse": h, "place": pl[h], "pays": payout(pos, [h], longs),
            "pass": sorted(k for k in others if above and pos[k] == min(above)),
            "threats": tied or sorted(k for k in others if below and pos[k] == max(below)),
        })
    now = payout(pos, tickets, longs)
    return {"rows": rows, "total": now, "last": None if before is None else now - payout(before, tickets, longs)}


def apply(pos, dice, order):
    pos = dict(pos)
    for d_i, step in zip(order, MOVES):
        h = dice[d_i]
        pos[h] = max(0, min(TRACK, pos[h] + step))
    return pos


class Derby(Game):
    id = "derby"
    category = "dice"
    howto = [
        "Six horses, 1–6. Each race you're dealt two secret 🎟️ tickets: the horses you're backing.",
        "On your turn roll three dice and use all three: one die's horse gallops +2, another trots +1, and the third stumbles −1.",
        f"The race ends the moment a horse reaches the line ({TRACK}). Tickets on 1st, 2nd and 3rd pay 5, 3 and 1 (tied horses share the better place).",
        "Everyone sees what you push and what you hold back — help your horses without giving your tickets away.",
        "Your 🎟️ portfolio (only you see it) shows what each ticket pays right now, the horse to pass ▲ and the one to keep back ▼, and the points your picked jobs would add or cost.",
        "🐴 Long shot (an option): a horse that trailed the leader by 6 squares at any point and still wins adds +3 to every ticket on it.",
        "Most points after the last race wins.",
    ]
    name = "Dice Derby"
    icon = "🏇"
    blurb = "Secret tickets, six horses: each roll gallops one horse, trots another and trips a third."
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "exacta": ("🎟️", "Exacta", "Hold tickets on both the 1st and 2nd horse")}
    settings_schema = {
        "races": ("Races", [(3, "3"), (1, "1"), (5, "5")], 3),
        "longshot": ("Long shot", [(False, "Off"), (True, "🐴 +3")], False),
    }
    lag = {}   # old saves: no long-shot tracking

    def longs(self):
        """Horses that count as long shots right now (always empty with the option off)."""
        if not self.s.get("longshot"):
            return set()
        return {h for h, v in self.lag.items() if v >= LAG}

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.score = 0
        self.race = 0
        self.result = None     # the last finished race, tickets on show
        self.first = rng.randrange(len(seated))
        self.n = 0
        self.room.add_log(f"🏇 Dice Derby: {self.s['races']} race{'s' if self.s['races'] > 1 else ''}. Back your horses in secret!", "big")
        self.new_race()

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def skip_turn(self, p):
        return p.id not in self.seats

    def new_race(self):
        r = self.room
        self.race += 1
        self.pos = {h: 0 for h in range(1, HORSES + 1)}
        deck = [h for h in range(1, HORSES + 1) for _ in range(2)]
        self.rng.shuffle(deck)
        for p in self.players():
            p.g.tickets = sorted([deck.pop(), deck.pop()])
            p.g.pushed = {h: 0 for h in range(1, HORSES + 1)}   # what the table has seen them do, for the bots
            r.add_log(f"🎟️ Your tickets: horse {p.g.tickets[0]} and horse {p.g.tickets[1]}.", "private", to=p.id)
        self.trail = []
        self.prev_pos = None
        self.lag = {h: 0 for h in range(1, HORSES + 1)}
        r.add_log(f"🏁 Race {self.race} of {self.s['races']}: they're off!", "big")
        live = self.players()
        start = live[(self.first + self.race - 1) % len(live)]
        self.begin(start.id)

    def begin(self, pid):
        self.dice = []
        self.room.begin_turn(pid)

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "roll":
            if self.dice:
                raise GameError("Use the dice you rolled.")
            return self.do_roll(p)
        if t == "move":
            order = a.get("order")
            if not self.dice:
                raise GameError("Roll first.")
            if not (isinstance(order, list) and sorted(order) == [0, 1, 2] and all(isinstance(i, int) and not isinstance(i, bool) for i in order)):
                raise GameError("Give each die a job: +2, +1 and −1.")
            return self.do_move(p, tuple(order))
        raise GameError("Unknown action.")

    def do_roll(self, p):
        self.dice = [self.rng.randint(1, HORSES) for _ in range(3)]
        self.n += 1
        self.room.add_log(f"🎲 {p.name} rolls {' '.join(map(str, self.dice))}")

    def do_move(self, p, order):
        r = self.room
        dice = self.dice
        self.prev_pos = dict(self.pos)
        self.pos = apply(self.pos, dice, order)
        for d_i, step in zip(order, MOVES):
            p.g.pushed[dice[d_i]] = p.g.pushed.get(dice[d_i], 0) + step
        g, t, s = (dice[i] for i in order)
        self.trail = [[g, 2], [t, 1], [s, -1]]
        self.n += 1
        r.add_log(f"🏇 {p.name}: horse {g} gallops, {t} trots, {s} stumbles.")
        lead = max(self.pos.values())
        for h in self.lag:
            self.lag[h] = max(self.lag[h], lead - self.pos[h])
        if lead >= TRACK:
            return self.end_race()
        r.advance()
        self.begin(r.turn)

    def end_race(self):
        r = self.room
        pl = places(self.pos)
        winners = [h for h in pl if pl[h] == 0]
        r.add_log(f"🏁 Horse {' & '.join(map(str, winners))} wins race {self.race}!", "big")
        gains = {}
        longs = self.longs()
        won = sorted(h for h in winners if h in longs)
        for h in won:
            self.moment(f"🐴 Long shot! Horse {h} was {self.lag[h]} squares back and still wins: +{LONG_BONUS} a ticket.", "gold", "fanfare")
        for p in self.players():
            gain = payout(self.pos, p.g.tickets, longs)
            p.g.score += gain
            gains[p.id] = gain
            r.add_log(f"🎟️ {p.name} held {p.g.tickets[0]} & {p.g.tickets[1]}: +{gain} → {p.g.score}")
            if sorted(pl[h] for h in p.g.tickets) == [0, 1]:
                self.award(p, "exacta")
                self.moment(f"🎟️ {p.name} hits the exacta: horses {p.g.tickets[0]} and {p.g.tickets[1]} finish 1-2!", "gold", "fanfare")
        self.result = {"race": self.race, "pos": dict(self.pos), "places": pl,
                       "tickets": {p.id: p.g.tickets for p in self.players()}, "gains": gains, "n": self.n, "long": won}
        self.n += 1
        if self.race >= self.s["races"]:
            return self.finish()
        self.new_race()

    def finish(self):
        r = self.room
        live = self.players()
        top = max(q.g.score for q in live)
        best = [q for q in live if q.g.score == top]
        if len(best) == 1:
            return r.finish(best[0], f"🏆 {best[0].name} wins the meeting with {top} points!")
        r.finish(None, f"🤝 Tie at {top} points between {' & '.join(q.name for q in best)}.")

    def on_timeout(self):
        p = self.room.players.get(self.room.turn)
        if not p:
            return
        self.room.add_log(f"⏰ {p.name} ran out of time: the jockeys ride themselves.", "power")
        if not self.dice:
            self.do_roll(p)
        self.do_move(p, self.choose(p, "easy"))

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and r.phase == "playing" and len(self.seats) > 2:
            was_turn = r.turn == p.id
            self.seats.remove(p.id)
            p.eliminated = True
            r.add_log(f"{p.name} left the races.")
            if was_turn:
                r.advance()
                self.begin(r.turn)
            return
        super().on_leave(p)

    # -- bots

    def suspicion(self, p):
        """Hard: how much each horse looks like a rival's pick, from what they've pushed this race."""
        sus = {h: 0.0 for h in range(1, HORSES + 1)}
        for q in self.players():
            if q.id == p.id:
                continue
            pushed = getattr(q.g, "pushed", {})
            tot = sum(max(0, v) for v in pushed.values()) or 1
            for h, v in pushed.items():
                sus[h] = max(sus[h], max(0, v) / tot)
        return sus

    def playout(self, pos, tickets, weights, turns):
        """A quick random finish of the race from pos; my points minus what the suspected horses earn."""
        rng = self.rng
        pos = dict(pos)
        for _ in range(turns):
            if max(pos.values()) >= TRACK:
                break
            dice = [rng.randint(1, HORSES) for _ in range(3)]
            pos = apply(pos, dice, PERMS[rng.randrange(6)])
        pl = places(pos)
        mine = sum(PAY[pl[h]] if pl[h] < 3 else 0 for h in tickets)
        theirs = sum(w * (PAY[pl[h]] if pl[h] < 3 else 0) for h, w in weights.items())
        return mine - theirs

    def choose(self, p, level):
        tickets = getattr(p.g, "tickets", [])
        perms = {}
        for o in PERMS:
            key = tuple(self.dice[i] for i in o)
            perms.setdefault(key, o)
        if level == "easy":
            if self.rng.random() < 0.4:
                return self.rng.choice(list(perms.values()))
            def lin(o):
                pos = apply(self.pos, self.dice, o)
                return sum(pos[h] for h in tickets) + self.rng.random()
            return max(perms.values(), key=lin)
        weights = {}
        if level == "hard":
            sus = self.suspicion(p)
            weights = {h: 0.5 * s for h, s in sus.items() if h not in tickets and s > 0.2}
        samples = 14 if level == "normal" else 36
        best, pick = None, None
        for o in perms.values():
            pos = apply(self.pos, self.dice, o)
            v = sum(self.playout(pos, tickets, weights, 40) for _ in range(samples)) / samples
            if best is None or v > best:
                best, pick = v, o
        return pick

    def bot_turn(self, p):
        if not self.dice:
            self.do_roll(p)
            self.room.bot_at = time.time() + 1.3
            return
        self.do_move(p, self.choose(p, p.bot or "normal"))

    # -- view

    def meta(self, p):
        return f"{p.g.score} pts" if hasattr(p.g, "score") else ""

    def final_scores(self):
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        tickets = getattr(p.g, "tickets", None) if p.id in self.seats else None
        return {"derby": {
            "seats": self.seats, "race": self.race, "races": self.s["races"], "track": TRACK,
            "pos": self.pos, "dice": self.dice, "trail": self.trail, "n": self.n,
            "tickets": tickets,
            # 🎟️ the owner's portfolio only: built from their own tickets and the public track
            "portfolio": portfolio(self.pos, tickets, getattr(self, "prev_pos", None), self.longs()) if tickets else None,
            "longshot": bool(self.s.get("longshot")), "lag": self.lag if self.s.get("longshot") else None,
            "result": self.result, "places": places(self.pos),
            "scores": {i: r.players[i].g.score for i in self.seats if i in r.players},
        }}
