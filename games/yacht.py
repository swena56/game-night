"""Yacht: the traditional public-domain dice game (the ancestor of several branded ones).

Each turn: roll five dice up to three times, holding any between rolls, then score them in
one of twelve boxes you haven't used (a zero if they don't fit). Classic scoring, no bonus:
Ones–Sixes (sum of that number), Full House (sum of all dice), Four of a Kind (sum of the four),
Little Straight 1-2-3-4-5 (30), Big Straight 2-3-4-5-6 (30), Choice (sum), Yacht (five alike, 50).
After twelve rounds the highest total wins. One player is a score attack.
Two optional bonuses: +35 when Ones–Sixes total 63 or more, and +50 for every further Yacht rolled once
the Yacht box already holds 50."""
import random
import time
from collections import Counter
from itertools import product

from .base import Game, GameError

CATS = ["ones", "twos", "threes", "fours", "fives", "sixes", "full", "four", "little", "big", "choice", "yacht"]
LABEL = {"ones": "Ones", "twos": "Twos", "threes": "Threes", "fours": "Fours", "fives": "Fives", "sixes": "Sixes",
         "full": "Full House", "four": "Four of a Kind", "little": "Little Straight", "big": "Big Straight",
         "choice": "Choice", "yacht": "Yacht"}
# roughly what a box is worth on average when filled sensibly: scoring below par "wastes" it
PAR = {"ones": 2, "twos": 5, "threes": 8, "fours": 11, "fives": 14, "sixes": 17,
       "full": 12, "four": 11, "little": 10, "big": 10, "choice": 22, "yacht": 12}


SOLO_TARGET = 150  # a strong solo score (the hard bot averages about 140)
UPPER_NEED, UPPER_BONUS, EXTRA_YACHT = 63, 35, 50  # the optional bonuses


def score(cat, dice):
    c = Counter(dice)
    if cat in CATS[:6]:
        face = CATS.index(cat) + 1
        return face * c[face]
    if cat == "full":
        return sum(dice) if sorted(c.values()) == [2, 3] else 0
    if cat == "four":
        face = next((f for f, n in c.items() if n >= 4), None)
        return 4 * face if face else 0
    if cat == "little":
        return 30 if sorted(dice) == [1, 2, 3, 4, 5] else 0
    if cat == "big":
        return 30 if sorted(dice) == [2, 3, 4, 5, 6] else 0
    if cat == "choice":
        return sum(dice)
    if cat == "yacht":
        return 50 if len(c) == 1 else 0
    raise ValueError(cat)


class Yacht(Game):
    id = "yacht"
    category = "dice"
    howto = [
        "Roll five dice up to three times. Tap dice to hold them between rolls.",
        "Then score the roll in one empty box. If it doesn't fit, you must still pick one (it scores 0).",
        "Ones–Sixes: that number's total. Full House: all dice. Four of a Kind: the four. Straights 1–5 or 2–6: 30. Choice: all dice. Yacht (five alike): 50.",
        "Twelve rounds; the highest total wins. Alone, reach 150 to win (175 with the upper bonus on).",
        "Optional bonuses: +35 when Ones–Sixes add up to 63 or more, and +50 for each extra Yacht once your Yacht box holds 50.",
    ]
    name = "Yacht"
    icon = "🎲"
    blurb = "The classic dice game: three rolls, hold what you like, and fill twelve boxes for the best total."
    min_players = 1
    max_players = 6
    settings_schema = {
        "bonus": ("Upper bonus", [(False, "Off (classic)"), (True, "+35 for 63 in Ones–Sixes")], False),
        "extra": ("Extra Yachts", [(False, "Off (classic)"), (True, "+50 each")], False),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.card = {c: None for c in CATS}
            p.g.extra = 0  # extra Yachts scored
        self.dice, self.held, self.rolls_left, self.roll_id = [1, 2, 3, 4, 5], [False] * 5, 3, 0
        self.last = ""
        first = rng.choice(seated)
        self.room.add_log(f"🎲 Yacht! Twelve rounds, twelve boxes. {first.name} rolls first.", "big")
        self.begin(first.id)

    def begin(self, pid):
        self.held, self.rolls_left = [False] * 5, 3
        self.room.begin_turn(pid)

    def upper(self, p):
        return sum(p.g.card[c] or 0 for c in CATS[:6])

    def upper_bonus(self, p):
        return UPPER_BONUS if self.s.get("bonus") and self.upper(p) >= UPPER_NEED else 0

    def total(self, p):
        return (sum(v for v in p.g.card.values() if v is not None) + self.upper_bonus(p)
                + EXTRA_YACHT * getattr(p.g, "extra", 0))

    def target(self):
        return SOLO_TARGET + (UPPER_BONUS if self.s.get("bonus") else 0)

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "roll":
            hold = a.get("hold") or [False] * 5
            if not (isinstance(hold, list) and len(hold) == 5 and all(isinstance(h, bool) for h in hold)):
                raise GameError("Bad hold.")
            return self.roll(p, hold)
        if t == "score":
            return self.fill(p, a.get("cat"))
        raise GameError("Unknown action.")

    def roll(self, p, hold):
        if self.rolls_left <= 0:
            raise GameError("No rolls left: pick a box to score.")
        first = self.rolls_left == 3
        if first:
            hold = [False] * 5
        self.dice = [d if h else self.rng.randint(1, 6) for d, h in zip(self.dice, hold)]
        self.held = list(hold)
        self.rolls_left -= 1
        self.roll_id += 1
        kept = sum(hold)
        self.room.add_log(f"🎲 {p.name} {'rolls' if first else f'keeps {kept} and rerolls'}: {' '.join(map(str, self.dice))}")

    def fill(self, p, cat):
        if self.rolls_left == 3:
            raise GameError("Roll first.")
        if cat not in CATS or p.g.card[cat] is not None:
            raise GameError("Pick an empty box.")
        pts = score(cat, self.dice)
        extra = self.s.get("extra") and len(set(self.dice)) == 1 and p.g.card["yacht"] == 50
        had_bonus = self.upper_bonus(p)
        p.g.card[cat] = pts
        if extra:
            p.g.extra = getattr(p.g, "extra", 0) + 1
            self.room.add_log(f"⛵⛵ Another Yacht for {p.name}: +{EXTRA_YACHT}!", "big")
        if self.upper_bonus(p) and not had_bonus:
            self.room.add_log(f"🎁 {p.name} makes {UPPER_NEED} in Ones–Sixes: +{UPPER_BONUS} bonus!", "big")
        self.last = f"{p.name}: {LABEL[cat]} {pts}"
        big = cat == "yacht" and pts
        self.room.add_log(f"{'⛵ YACHT! ' if big else '📝 '}{p.name} scores {pts} in {LABEL[cat]} ({' '.join(map(str, self.dice))}).",
                          "big" if big else "question" if pts else "info")
        if all(all(v is not None for v in self.room.players[i].g.card.values()) for i in self.seats if i in self.room.players):
            return self.finish()
        self.rolls_left = 3
        self.room.advance()
        self.held = [False] * 5

    def finish(self):
        r = self.room
        live = [r.players[i] for i in self.seats if i in r.players]
        if len(live) == 1:
            p = live[0]
            won = self.total(p) >= self.target()
            return r.finish(p if won else None, f"🎲 {p.name} finishes with {self.total(p)} points" +
                            (" — a fine voyage! 🏆" if won else f". Reach {self.target()} to win solo!"))
        top = max(self.total(p) for p in live)
        best = [p for p in live if self.total(p) == top]
        if len(best) == 1:
            r.finish(best[0], f"🏆 {best[0].name} wins Yacht with {top} points!")
        else:
            r.finish(None, f"🤝 Tie at {top} between {' & '.join(p.name for p in best)}.")

    def on_timeout(self):
        r = self.room
        p = r.players[r.turn]
        r.add_log(f"⏰ {p.name} ran out of time.", "power")
        if self.rolls_left == 3:
            self.roll(p, [False] * 5)
        self.fill(p, self.best_box(p, "easy"))

    def skip_turn(self, p):
        return p.id not in self.seats

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "card"):
            return ""
        left = sum(v is None for v in p.g.card.values())
        return f"{self.total(p)} pts · {left} box{'es' * (left != 1)} left"

    def final_scores(self):
        return {i: self.total(self.room.players[i]) for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        cur = r.players.get(r.turn)
        return {"yacht": {
            "cats": [[c, LABEL[c]] for c in CATS], "seats": self.seats,
            "cards": {i: r.players[i].g.card for i in self.seats if i in r.players},
            "totals": {i: self.total(r.players[i]) for i in self.seats if i in r.players},
            "dice": self.dice, "held": self.held, "rollsLeft": self.rolls_left, "rollId": self.roll_id,
            "rolled": self.rolls_left < 3,
            "preview": {c: score(c, self.dice) for c in CATS if cur.g.card[c] is None} if cur and self.rolls_left < 3 else {},
            "last": self.last,
            "bonus": bool(self.s.get("bonus")), "extraOn": bool(self.s.get("extra")), "need": UPPER_NEED,
            "upper": {i: self.upper(r.players[i]) for i in self.seats if i in r.players},
            "upperBonus": {i: self.upper_bonus(r.players[i]) for i in self.seats if i in r.players},
            "extra": {i: EXTRA_YACHT * getattr(r.players[i].g, "extra", 0) for i in self.seats if i in r.players},
            "target": self.target(),
        }}

    # -- bots

    def best_box(self, p, level, dice=None):
        dice = dice or self.dice
        open_ = [c for c in CATS if p.g.card[c] is None]
        if level == "easy":
            return max(open_, key=lambda c: (score(c, dice), random.random()))
        return max(open_, key=lambda c: score(c, dice) - PAR[c] + (8 if c == "yacht" and score(c, dice) else 0)
                   + self.bonus_pull(p, c, dice))

    def bonus_pull(self, p, cat, dice):
        """With the upper bonus on, three or more of a face up top is worth extra (it keeps 63 in reach)."""
        if not self.s.get("bonus") or cat not in CATS[:6] or self.upper(p) >= UPPER_NEED:
            return 0
        face = CATS.index(cat) + 1
        return (score(cat, dice) - 3 * face) * 0.8 + (4 if score(cat, dice) >= 3 * face else 0)

    def box_value(self, p, dice):
        """How good a final roll is for this player: the best (score - par) over open boxes."""
        extra = EXTRA_YACHT if self.s.get("extra") and len(set(dice)) == 1 and p.g.card["yacht"] == 50 else 0
        return extra + max(score(c, dice) - PAR[c] + self.bonus_pull(p, c, dice) for c in CATS if p.g.card[c] is None)

    def choose_hold(self, p, level):
        dice = self.dice
        if level == "normal":  # keep the most common face (or a straight run)
            c = Counter(dice)
            face, n = max(c.items(), key=lambda kv: (kv[1], kv[0]))
            uniq = sorted(set(dice))
            run = max((uniq[i:j] for i in range(len(uniq)) for j in range(i + 1, len(uniq) + 1)
                       if uniq[i:j] == list(range(uniq[i], uniq[i] + j - i))), key=len)
            want_run = len(run) >= 4 and n < 3 and (p.g.card["little"] is None or p.g.card["big"] is None)
            keep = set(run) if want_run else {face}
            seen = set()
            out = []
            for d in dice:
                ok = d in keep and (not want_run or d not in seen)
                seen.add(d)
                out.append(ok)
            return out
        # hard: estimate every hold pattern by sampling the remaining rolls
        best, best_val = None, -1e9
        samples = 40
        for hold in product([False, True], repeat=5):
            total = 0.0
            for _ in range(samples):
                d = [x if h else random.randint(1, 6) for x, h in zip(dice, hold)]
                if self.rolls_left >= 2:  # one more roll after this: greedily keep the commonest face
                    c = Counter(d)
                    face = max(c, key=lambda f: (c[f], f))
                    d = [x if x == face else random.randint(1, 6) for x in d]
                total += self.box_value(p, d)
            if total > best_val:
                best, best_val = list(hold), total
        return best

    def bot_turn(self, p):
        r = self.room
        if self.rolls_left == 3:
            self.roll(p, [False] * 5)
            r.bot_at = time.time() + 0.9
            return
        level = p.bot
        stop = self.rolls_left == 0 or self.box_value(p, self.dice) >= (18 if level == "hard" else 12)
        if level == "easy":
            stop = self.rolls_left == 0 or random.random() < 0.35
        if not stop:
            hold = [random.random() < 0.5 for _ in range(5)] if level == "easy" else self.choose_hold(p, level)
            if not all(hold):
                self.roll(p, hold)
                r.bot_at = time.time() + 0.9
                return
        self.fill(p, self.best_box(p, level))
