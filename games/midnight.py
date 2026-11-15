"""Midnight (1-4-24): the traditional dice game (public domain).

Six dice. Roll them, then set aside at least one; roll the rest, set aside at least one more, and so on
until all six are kept. You must keep a 1 and a 4 to qualify; the other four dice are your score, so the
best there is (four 6s) is 24, "midnight". No 1 or no 4 scores nothing."""
import time
from functools import lru_cache
from itertools import combinations_with_replacement
from math import factorial
from collections import Counter

from .base import Game, GameError

DICE = 6
SOLO_PER_ROUND = 17   # alone, average this much a round to win (best play averages about 18.7)


@lru_cache(maxsize=None)
def rolls_of(n):
    """[(sorted descending tuple, probability)] for every roll of n dice."""
    out = []
    for combo in combinations_with_replacement(range(6, 0, -1), n):
        ways = factorial(n)
        for c in Counter(combo).values():
            ways //= factorial(c)
        out.append((combo, ways / 6 ** n))
    return out


def keep_score(kept, h1, h4):
    """(new h1, new h4, points) for setting aside `kept` when you already hold h1/h4."""
    pts = sum(kept)
    n1, n4 = h1, h4
    if not h1 and 1 in kept:
        n1, pts = True, pts - 1
    if not h4 and 4 in kept:
        n4, pts = True, pts - 4
    return n1, n4, pts


def choices(roll, h1, h4):
    """Sensible ways to set aside dice from `roll` (descending): the needed 1 and/or 4, then the k best."""
    seen = set()
    for t1 in ((False, True) if not h1 and 1 in roll else (False,)):
        for t4 in ((False, True) if not h4 and 4 in roll else (False,)):
            rest = list(roll)
            q = []
            if t1:
                rest.remove(1); q.append(1)
            if t4:
                rest.remove(4); q.append(4)
            for k in range(len(rest) + 1):
                kept = tuple(sorted(q + rest[:k], reverse=True))
                if kept and kept not in seen:
                    seen.add(kept)
                    yield kept


@lru_cache(maxsize=None)
def value(n, h1, h4, s):
    """Expected final score with best play: n dice still to roll, holding h1/h4 and s points."""
    if n == 0:
        return s if h1 and h4 else 0
    total = 0.0
    for roll, pr in rolls_of(n):
        total += pr * max(after(roll, kept, h1, h4, s) for kept in choices(roll, h1, h4))
    return total


def after(roll, kept, h1, h4, s):
    n1, n4, pts = keep_score(kept, h1, h4)
    return value(len(roll) - len(kept), n1, n4, s + pts)


def best_keep(roll, h1, h4, s):
    roll = tuple(sorted(roll, reverse=True))
    return max(choices(roll, h1, h4), key=lambda k: after(roll, k, h1, h4, s))


class Midnight(Game):
    id = "midnight"
    category = "dice"
    howto = [
        "Roll six dice, then set aside at least one. Roll the rest, set aside at least one more, until all six are kept.",
        "You need a 1 and a 4 among your kept dice to qualify. The other four dice are your score.",
        "Four 6s with your 1 and 4 is 24: 🕛 Midnight, the best there is. No 1 or no 4 scores nothing.",
        "Everyone takes one turn a round. Most points after the last round wins.",
        f"Alone, average {SOLO_PER_ROUND} a round to win.",
        "🌙 Round wins (an option): each round's best score takes a moon; most moons wins.",
    ]
    name = "Midnight"
    icon = "🕛"
    blurb = "The traditional 1-4-24 dice game: keep a 1 and a 4, and push the other four dice toward midnight."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "midnight": ("🕛", "Midnight", "Score the perfect 24")}
    settings_schema = {
        "rounds": ("Rounds", [(3, "3"), (5, "5"), (1, "1")], 3),
        "moons": ("Scoring", [(False, "Total points"), (True, "🌙 Round wins")], False),
    }

    def mooned(self):
        return bool(self.s.get("moons")) and len(self.seats) > 1

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.score = 0
            p.g.moons = 0
            p.g.this = None   # this round's score
        self.round = 1
        self.turns = 0
        self.last = None
        self.n = 0
        self.room.add_log(f"🕛 Midnight: {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''}. Keep a 1 and a 4, then go for 6s!", "big")
        self.begin(rng.choice(seated).id)

    def begin(self, pid):
        self.kept = []
        self.dice = []
        self.room.begin_turn(pid)

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def skip_turn(self, p):
        return p.id not in self.seats

    def status(self):
        h1 = 1 in self.kept
        h4 = 4 in self.kept
        pts = sum(self.kept) - (1 if h1 else 0) - (4 if h4 else 0)
        return h1, h4, pts

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "roll":
            if self.dice:
                raise GameError("Set some dice aside first.")
            return self.do_roll(p)
        if t == "keep":
            pick = a.get("dice")
            if not (isinstance(pick, list) and all(isinstance(i, int) and not isinstance(i, bool) for i in pick)):
                raise GameError("Bad dice.")
            return self.do_keep(p, pick)
        raise GameError("Unknown action.")

    def do_roll(self, p):
        self.dice = sorted((self.rng.randint(1, 6) for _ in range(DICE - len(self.kept))), reverse=True)
        self.n += 1
        self.room.add_log(f"🎲 {p.name} rolls {' '.join(map(str, self.dice))}")

    def do_keep(self, p, pick):
        if not self.dice:
            raise GameError("Roll first.")
        pick = sorted(set(pick))
        if not pick:
            raise GameError("Keep at least one die.")
        if any(not 0 <= i < len(self.dice) for i in pick):
            raise GameError("Bad dice.")
        got = [self.dice[i] for i in pick]
        self.kept = sorted(self.kept + got, reverse=True)
        self.dice = []
        self.n += 1
        self.room.add_log(f"✋ {p.name} keeps {' '.join(map(str, sorted(got, reverse=True)))}")
        if len(self.kept) >= DICE:
            return self.end_turn(p)
        self.do_roll(p)

    def end_turn(self, p):
        r = self.room
        h1, h4, pts = self.status()
        if self.kept and len(self.kept) < DICE:   # ran out of time: the dice still on the table count as kept
            self.kept = sorted(self.kept + self.dice, reverse=True)
            h1, h4, pts = self.status()
        ok = h1 and h4 and len(self.kept) == DICE
        score = pts if ok else 0
        p.g.score += score
        p.g.this = score
        if ok:
            r.add_log(f"🕛 {p.name} scores {score} → {p.g.score}.", "question")
            if score == 24:
                self.award(p, "midnight")
                self.moment(f"🕛 {p.name} hits MIDNIGHT: 24!", "gold", "fanfare")
        else:
            miss = " and ".join(str(x) for x, h in ((1, h1), (4, h4)) if not h)
            r.add_log(f"💤 {p.name} has no {miss}: 0 this turn.", "power")
        self.last = {"by": p.id, "kept": list(self.kept), "pts": score, "ok": ok, "n": self.n}
        self.n += 1
        self.turns += 1
        if self.turns >= len(self.players()):
            self.settle()
            if self.round >= self.s["rounds"]:
                return self.finish()
            self.round += 1
            self.turns = 0
            for q in self.players():
                q.g.this = None
            r.add_log(f"🔔 Round {self.round} of {self.s['rounds']}.")
        r.advance()
        self.begin(r.turn)

    def settle(self):
        if not self.mooned():
            return
        live = [q for q in self.players() if q.g.this is not None]
        top = max((q.g.this for q in live), default=0)
        best = [q for q in live if q.g.this == top]
        if top and len(best) == 1:
            best[0].g.moons += 1
            self.room.add_log(f"🌙 {best[0].name} takes the round's moon with {top}.", "question")
        elif top:
            for q in best:
                q.g.moons += 1
            self.room.add_log(f"🌙 A tie at {top}: {' & '.join(q.name for q in best)} each take a moon.", "question")

    def finish(self):
        r = self.room
        live = self.players()
        if len(self.seats) == 1 and live:
            p = live[0]
            need = SOLO_PER_ROUND * self.s["rounds"]
            if p.g.score >= need:
                return r.finish(p, f"🏆 {p.name} scores {p.g.score} in {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''}!")
            return r.finish(None, f"🕛 {p.name} scored {p.g.score}. {need} wins solo — try again!")
        rank = (lambda q: (q.g.moons, q.g.score)) if self.mooned() else (lambda q: (q.g.score,))
        top = max(map(rank, live))
        best = [q for q in live if rank(q) == top]
        unit = f"{top[0]} 🌙" if self.mooned() else f"{top[0]} points"
        if len(best) == 1:
            return r.finish(best[0], f"🏆 {best[0].name} wins with {unit}!")
        r.finish(None, f"🤝 Tie at {unit} between {' & '.join(q.name for q in best)}.")

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

    def bot_keep(self, p):
        h1, h4, s = self.status()
        dice = self.dice
        level = p.bot or "normal"
        if level == "hard":
            kept = list(best_keep(dice, h1, h4, s))
        else:
            kept, rest = [], list(dice)
            for need, have in ((1, h1), (4, h4)):
                if not have and need in rest:
                    rest.remove(need); kept.append(need)
            left = len(dice) - len(kept)   # dice that would still be rolled
            if level == "easy":
                take = [d for d in rest if d >= 5]           # greedy: grabs 5s too
            else:
                take = [d for d in rest if d == 6 or (d == 5 and left <= 2)]
            kept += take
            if not kept:
                kept = [max(dice)]
        pick, used = [], set()
        for v in kept:
            i = next(i for i, d in enumerate(dice) if d == v and i not in used)
            used.add(i)
            pick.append(i)
        return pick

    def bot_turn(self, p):
        if not self.dice:
            self.do_roll(p)
        else:
            self.do_keep(p, self.bot_keep(p))
        if self.room.turn == p.id:
            self.room.bot_at = time.time() + 1.1

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"{p.g.moons} 🌙 · {p.g.score}" if self.mooned() else f"{p.g.score} pts"

    def final_scores(self):
        key = "moons" if self.mooned() else "score"
        return {i: getattr(self.room.players[i].g, key) for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        h1, h4, pts = self.status()
        return {"midnight": {
            "seats": self.seats, "round": self.round, "rounds": self.s["rounds"],
            "dice": self.dice, "kept": self.kept, "h1": h1, "h4": h4, "pts": pts, "n": self.n,
            "last": self.last,
            "scores": {i: r.players[i].g.score for i in self.seats if i in r.players},
            "moons": {i: r.players[i].g.moons for i in self.seats if i in r.players} if self.mooned() else None,
            "solo": len(self.seats) == 1, "goal": SOLO_PER_ROUND * self.s["rounds"],
        }}
