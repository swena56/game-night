"""Ship, Captain and Crew: the traditional tavern dice game (public domain).

Each turn you get three rolls of five dice. You need a 6 (the ship), then a 5 (the captain), then a 4
(the crew), set aside in that order — a 5 doesn't count until you have the 6. Once all three are in,
the last two dice are your cargo and score their total; use any rolls left to reroll one or both cargo
dice for more. No crew by the third roll and you score nothing this turn."""
import time
from functools import lru_cache
from itertools import product

from .base import Game, GameError

ROLLS = 3
NEED = (6, 5, 4)
NAMES = ("🚢 ship", "🧭 captain", "👥 crew")
SOLO_PER_ROUND = 5   # alone, average this much cargo a round to win (best play averages about 4.3)
PURSE = 10           # 🍺 pot games: coins each player starts with


@lru_cache(maxsize=None)
def cargo_value(rolls, a, b):
    """Expected final cargo with best play, holding a and b with `rolls` rerolls left."""
    best = a + b
    if rolls:
        both = sum(cargo_value(rolls - 1, x, y) for x in range(1, 7) for y in range(1, 7)) / 36
        keep = max(a, b)
        one = sum(cargo_value(rolls - 1, keep, x) for x in range(1, 7)) / 6
        best = max(best, both, one)
    return best


class ShipCrew(Game):
    id = "shipcrew"
    category = "dice"
    howto = [
        "Three rolls of five dice per turn. Find a 6 (🚢 ship), then a 5 (🧭 captain), then a 4 (👥 crew), in that order. They're set aside for you.",
        "With all three, the other two dice are your cargo: their total is your score for the turn.",
        "Rolls left? Tap cargo dice to reroll them (one or both), or ⚓ Dock to keep the cargo.",
        "No crew after three rolls scores 0. Most cargo after the last round wins.",
        f"Alone, average {SOLO_PER_ROUND} cargo a round to win.",
        "🍺 Pub pot: everyone antes 1 💰 a round and the round's best cargo takes the pot (a tie rolls it over). Most coins wins.",
        "🏴‍☠️ Raids: dock with 11 or 12 cargo and you plunder 2 from whoever leads (not you).",
    ]
    name = "Ship, Captain & Crew"
    icon = "🚢"
    blurb = "The old tavern dice game: roll a 6, 5 and 4 in order, then gamble on your cargo."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "full_hold": ("📦", "Full hold", "Dock with the best cargo there is: 12")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5"), (3, "3"), (8, "8")], 5),
        "pot": ("Scoring", [(False, "Total cargo"), (True, "🍺 Pub pot")], False),
        "raid": ("🏴‍☠️ Raids", [(False, "Off"), (True, "On: dock 11 or more to plunder 2 cargo from the leader")], False),
    }

    def potted(self):
        return bool(self.s.get("pot")) and len(self.seats) > 1

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.score = 0
            p.g.best = 0
            p.g.coins = PURSE
            p.g.haul = None  # this round's cargo, for the pot
        self.pot = 0
        self.round = 1
        self.turns = 0          # turns taken this round
        self.last = None        # the latest finished turn, for every screen
        self.first = rng.choice(seated).id
        self.room.add_log(f"🚢 Ship, Captain & Crew: {self.s['rounds']} rounds. Roll a 6, then a 5, then a 4!", "big")
        self.ante()
        self.begin(self.first)

    # -- 🍺 pub pot

    def ante(self):
        if not self.potted():
            return
        for q in self.players():
            q.g.haul = None
            if q.g.coins > 0:
                q.g.coins -= 1
                self.pot += 1
        self.room.add_log(f"🍺 Everyone antes: {self.pot} 💰 in the pot.")

    def settle(self):
        if not self.potted():
            return
        live = [q for q in self.players() if q.g.haul is not None]
        top = max((q.g.haul for q in live), default=0)
        best = [q for q in live if q.g.haul == top]
        if top and len(best) == 1:
            best[0].g.coins += self.pot
            self.room.add_log(f"🍺 {best[0].name} takes the pot: {self.pot} 💰 for {top} cargo!", "question")
            self.pot = 0
        elif self.round >= self.s["rounds"] and best and top:
            share, self.pot = divmod(self.pot, len(best))
            for q in best:
                q.g.coins += share
            self.room.add_log(f"🍺 A tie on the last round: {' & '.join(q.name for q in best)} split the pot.", "question")
        else:
            self.room.add_log(f"🍺 No single best cargo: the pot ({self.pot} 💰) rolls over.")

    def begin(self, pid):
        self.found = []          # the needed faces found so far, in order
        self.free = []           # the other dice; once all three are found, these are the cargo
        self.rolls = 0
        self.room.begin_turn(pid)

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def loaded(self):
        return len(self.found) == 3

    def skip_turn(self, p):
        return p.id not in self.seats

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "roll":
            pick = a.get("reroll")
            if pick is not None and not (isinstance(pick, list) and all(isinstance(i, int) and not isinstance(i, bool) for i in pick)):
                raise GameError("Bad dice.")
            return self.do_roll(p, pick)
        if t == "dock":
            if not self.loaded():
                raise GameError("You need a ship, a captain and a crew before you can dock.")
            return self.end_turn(p)
        raise GameError("Unknown action.")

    def do_roll(self, p, pick=None):
        if self.rolls >= ROLLS:
            raise GameError("No rolls left.")
        if self.loaded():
            pick = sorted(set(pick if pick is not None else [0, 1]))
            if not pick or any(not 0 <= i < 2 for i in pick):
                raise GameError("Tap the cargo dice you want to reroll.")
            for i in pick:
                self.free[i] = self.rng.randint(1, 6)
            self.rolls += 1
            self.room.add_log(f"🎲 {p.name} rerolls cargo: {self.free[0]} + {self.free[1]} = {sum(self.free)}")
        else:
            self.free = [self.rng.randint(1, 6) for _ in range(5 - len(self.found))]
            self.rolls += 1
            got = []
            while len(self.found) < 3 and NEED[len(self.found)] in self.free:
                self.free.remove(NEED[len(self.found)])
                got.append(NAMES[len(self.found)])
                self.found.append(NEED[len(self.found)])
            text = " ".join(map(str, sorted(self.found + self.free, reverse=True)))
            self.room.add_log(f"🎲 {p.name} rolls {text}" + (f": {', '.join(got)}!" if got else "") + (f" Cargo {sum(self.free)}." if self.loaded() else ""))
        if self.rolls >= ROLLS:
            self.end_turn(p)

    def end_turn(self, p):
        r = self.room
        pts = sum(self.free) if self.loaded() else 0
        p.g.score += pts
        p.g.best = max(p.g.best, pts)
        p.g.haul = pts
        raided = None
        if self.loaded():
            r.add_log(f"⚓ {p.name} docks with {pts} cargo → {p.g.score}.", "question")
            if self.s.get("raid") and pts >= 11 and not self.potted():
                rivals = [o for o in self.players() if o.id != p.id and o.g.score > 0]
                leader = max(rivals, key=lambda o: o.g.score, default=None)
                if leader and leader.g.score >= p.g.score - pts:  # only raid someone ahead of where you were
                    took = min(2, leader.g.score)
                    leader.g.score -= took
                    p.g.score += took
                    raided = leader.id
                    r.add_log(f"🏴‍☠️ {p.name} raids {leader.name} for {took} cargo!", "power")
        else:
            r.add_log(f"🌊 {p.name} never found a {NAMES[len(self.found)]}: 0 this turn.", "power")
        self.last = {"by": p.id, "raid": raided, "found": list(self.found), "cargo": list(self.free) if self.loaded() else [], "pts": pts, "n": self.round * 10 + self.turns}
        if pts == 12:
            self.award(p, "full_hold")
        self.turns += 1
        live = self.players()
        if self.turns >= len(live):
            self.settle()
            if self.round >= self.s["rounds"]:
                return self.finish()
            self.round += 1
            self.turns = 0
            r.add_log(f"🔔 Round {self.round} of {self.s['rounds']}.")
            self.ante()
        r.advance()
        self.begin(r.turn)

    def finish(self):
        r = self.room
        live = self.players()
        if len(self.seats) == 1 and live:
            p = live[0]
            need = SOLO_PER_ROUND * self.s["rounds"]
            if p.g.score >= need:
                return r.finish(p, f"🏆 {p.name} hauls {p.g.score} cargo in {self.s['rounds']} rounds!")
            return r.finish(None, f"🚢 {p.name} hauled {p.g.score} cargo. {need} wins solo — try again!")
        if self.potted():
            rank = lambda q: (q.g.coins, q.g.score)
            top = max(map(rank, live))
            best = [q for q in live if rank(q) == top]
            if len(best) == 1:
                return r.finish(best[0], f"🏆 {best[0].name} wins with {top[0]} 💰!")
            return r.finish(None, f"🤝 Tie at {top[0]} 💰 and {top[1]} cargo between {' & '.join(q.name for q in best)}.")
        top = max(q.g.score for q in live)
        best = [q for q in live if q.g.score == top]
        if len(best) == 1:
            return r.finish(best[0], f"🏆 {best[0].name} wins with {top} cargo!")
        r.finish(None, f"🤝 Tie at {top} cargo between {' & '.join(q.name for q in best)}.")

    def on_timeout(self):
        p = self.room.players.get(self.room.turn)
        if not p:
            return
        self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
        self.end_turn(p)

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and len(self.seats) > 1:
            was_turn = r.turn == p.id
            self.seats.remove(p.id)
            p.eliminated = True
            r.add_log(f"{p.name} left the game.")
            if len(self.seats) == 1:
                w = r.players[self.seats[0]]
                return r.finish(w, f"🏳️ {p.name} left — {w.name} wins!")
            if was_turn:
                r.advance()
                self.begin(r.turn)
            return
        super().on_leave(p)

    # -- bots

    def bot_turn(self, p):
        r = self.room
        if not self.loaded():
            self.do_roll(p)
            r.bot_at = time.time() + 1.1
            return
        left = ROLLS - self.rolls
        a, b = self.free
        cargo = a + b
        level = p.bot or "normal"
        if level == "easy":
            choice = [0, 1] if cargo < 6 and self.rng.random() < 0.8 else None
        elif level == "normal":
            choice = [0, 1] if cargo < 7 else None
        else:
            hi = 0 if a >= b else 1
            stay = cargo
            both = sum(cargo_value(left - 1, x, y) for x, y in product(range(1, 7), repeat=2)) / 36
            one = sum(cargo_value(left - 1, self.free[hi], x) for x in range(1, 7)) / 6
            choice = None if stay >= max(both, one) else [0, 1] if both >= one else [1 - hi]
        if level != "easy" and self.round == self.s["rounds"] and len(self.seats) > 1:
            # the last round: if this cargo can't catch the leader, gamble
            lead = max((q.g.score for q in self.players() if q.id != p.id), default=0)
            if p.g.score + cargo <= lead:
                choice = choice or [0, 1]
        if choice:
            self.do_roll(p, choice)
            r.bot_at = time.time() + 1.1
        else:
            self.end_turn(p)

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"{p.g.coins} 💰 · {p.g.score} cargo" if self.potted() else f"{p.g.score} cargo"

    def final_scores(self):
        key = "coins" if self.potted() else "score"
        return {i: getattr(self.room.players[i].g, key) for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        return {"shipcrew": {
            "seats": self.seats, "round": self.round, "rounds": self.s["rounds"],
            "found": self.found, "free": self.free, "rolls": self.rolls, "maxRolls": ROLLS,
            "loaded": self.loaded(), "last": self.last,
            "scores": {i: r.players[i].g.score for i in self.seats if i in r.players},
            "solo": len(self.seats) == 1, "goal": SOLO_PER_ROUND * self.s["rounds"],
            "pot": self.pot if self.potted() else None,
            "coins": {i: r.players[i].g.coins for i in self.seats if i in r.players} if self.potted() else None,
        }}
