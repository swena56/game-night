"""Farkle: the traditional push-your-luck dice game (also known as Zilch or 10,000).

Roll six dice and set aside at least one scoring die or combination, then roll the rest or bank
the turn's points. A roll with nothing that scores is a farkle: the turn's points are lost.
Score all six dice and you roll all six again (hot dice). Scoring: single 1 = 100, single 5 = 50,
three of a kind = face × 100 (three 1s = 1,000), four / five / six of a kind = 1,000 / 2,000 / 3,000;
using all six dice: straight 1–6 = 1,500, three pairs = 1,500, four of a kind + a pair = 1,500,
two triplets = 2,500. Reaching the target starts a final round: everyone else gets one more turn."""
import random
import time
from collections import Counter
from functools import lru_cache
from itertools import combinations

from .base import Game, GameError

KIND = {3: None, 4: 1000, 5: 2000, 6: 3000}   # three of a kind depends on the face


@lru_cache(maxsize=None)
def best_score(dice):
    """Points for a set of kept dice (a sorted tuple) where every die must score, else None."""
    if not dice:
        return 0
    c = Counter(dice)
    options = []
    if len(dice) == 6:
        counts = sorted(c.values())
        if len(c) == 6:
            options.append(1500)                 # straight
        if counts == [2, 2, 2]:
            options.append(1500)                 # three pairs
        if counts == [2, 4]:
            options.append(1500)                 # four of a kind + a pair
        if counts == [3, 3]:
            options.append(2500)                 # two triplets
    for face, n in c.items():
        for k in range(3, n + 1):                # take k of a kind, then score the rest
            pts = (1000 if face == 1 else face * 100) if k == 3 else KIND[k]
            rest = list(dice)
            for _ in range(k):
                rest.remove(face)
            sub = best_score(tuple(rest))
            if sub is not None:
                options.append(pts + sub)
        if face in (1, 5):                       # one single 1 or 5, then the rest
            rest = list(dice)
            rest.remove(face)
            sub = best_score(tuple(rest))
            if sub is not None:
                options.append((100 if face == 1 else 50) + sub)
    return max(options) if options else None


def keep_options(roll):
    """Every scoring way to keep dice from a roll: [(points, indices)], best first."""
    out, seen = [], set()
    for n in range(len(roll), 0, -1):
        for idx in combinations(range(len(roll)), n):
            key = tuple(sorted(roll[i] for i in idx))
            if key in seen:
                continue
            seen.add(key)
            pts = best_score(key)
            if pts:
                out.append((pts, list(idx)))
    out.sort(key=lambda o: (-o[0], len(o[1])))
    return out


# farkle odds and the average best keep by number of dice, for the bots (measured once)
def _measure(n, trials=3000, rng=random.Random(7)):
    zero, total = 0, 0
    for _ in range(trials):
        roll = [rng.randint(1, 6) for _ in range(n)]
        opts = keep_options(roll)
        if not opts:
            zero += 1
        else:
            total += opts[0][0]
    return zero / trials, total / max(1, trials - zero)


ODDS = {n: _measure(n) for n in range(1, 7)}


class Farkle(Game):
    id = "farkle"
    category = "dice"
    howto = [
        "Roll six dice, then tap scoring dice to set them aside. Roll the rest to push your luck, or bank.",
        "1 = 100 · 5 = 50 · three of a kind = face × 100 (three 1s = 1,000) · four / five / six of a kind = 1,000 / 2,000 / 3,000.",
        "With all six dice: straight 1–6 or three pairs = 1,500, four of a kind + a pair = 1,500, two triplets = 2,500.",
        "A roll with nothing scoring is a FARKLE: you lose the turn's points. Score all six dice and you roll all six again.",
        "Reach the target and everyone else gets one last turn to beat you.",
    ]
    name = "Farkle"
    icon = "🎯"
    blurb = "Push-your-luck dice: keep the scoring dice, roll again or bank, and don't farkle it all away."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "vault": ("🏦", "Bank vault", "Bank 3,000 points or more in a single turn")}
    settings_schema = {
        "target": ("Play to", [(10000, "10,000"), (5000, "5,000")], 10000),
        "opening": ("Get on the board", [(500, "500 in one turn"), (0, "Any score")], 500),
        "triple": ("Three farkles in a row", [(True, "−1,000"), (False, "No penalty")], True),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.score, p.g.farkles, p.g.on_board = 0, 0, False
        self.final_from = None
        self.solo_turns = 0
        self.event, self.event_id = None, 0  # the last farkle or bank, so every screen can show it
        first = rng.choice(seated)
        self.room.add_log(f"🎯 Farkle to {self.s['target']:,}! {first.name} rolls first.", "big")
        self.begin(first.id)

    def begin(self, pid):
        self.roll, self.turn_pts, self.dice_left, self.rolled, self.kept = [], 0, 6, False, []
        self.aside = []  # every die set aside this turn, for the table to see (cleared on hot dice)
        self.farkled = False
        self.room.begin_turn(pid)

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        keep = a.get("keep")
        if keep is not None and not (isinstance(keep, list) and all(isinstance(i, int) and not isinstance(i, bool) for i in keep)):
            raise GameError("Bad dice.")
        if t == "roll":
            return self.do_roll(p, keep or [])
        if t == "bank":
            return self.bank(p, keep or [])
        raise GameError("Unknown action.")

    def take(self, keep):
        """Validate and score the dice set aside from the current roll."""
        if not self.rolled:
            return 0
        if len(set(keep)) != len(keep) or any(not 0 <= i < len(self.roll) for i in keep):
            raise GameError("Pick dice from this roll.")
        if not keep:
            raise GameError("Set aside at least one scoring die first.")
        pts = best_score(tuple(sorted(self.roll[i] for i in keep)))
        if not pts:
            raise GameError("Every die you set aside must score.")
        return pts

    def do_roll(self, p, keep):
        r = self.room
        pts = self.take(keep)
        if self.rolled:
            self.turn_pts += pts
            self.kept = [self.roll[i] for i in keep]
            self.aside = getattr(self, "aside", []) + self.kept
            self.dice_left -= len(keep)
            if self.dice_left == 0:
                self.dice_left = 6
                self.aside = []
                r.add_log(f"🔥 Hot dice! {p.name} rolls all six again with {self.turn_pts:,} on the line.", "power")
                self.event_id += 1
                self.event = {"id": self.event_id, "kind": "hot", "by": p.id, "pts": self.turn_pts}
        self.roll = [self.rng.randint(1, 6) for _ in range(self.dice_left)]
        self.rolled = True
        if not keep_options(self.roll):
            return self.farkle(p)
        r.add_log(f"🎲 {p.name} rolls {' '.join(map(str, self.roll))}" + (f" ({self.turn_pts:,} so far)" if self.turn_pts else ""))

    def farkle(self, p):
        r = self.room
        p.g.farkles += 1
        lost = self.turn_pts
        r.add_log(f"💥 FARKLE! {p.name} rolls {' '.join(map(str, self.roll))}" + (f" and loses {lost:,}." if lost else "."), "power")
        self.farkled = True
        self.event_id += 1
        self.event = {"id": self.event_id, "kind": "farkle", "by": p.id, "roll": self.roll, "lost": lost}
        if self.s["triple"] and p.g.farkles >= 3:
            p.g.score -= 1000
            p.g.farkles = 0
            r.add_log(f"😵 Three farkles in a row: {p.name} loses 1,000.", "power")
        self.turn_pts = 0
        self.end_turn(p)

    def bank(self, p, keep):
        r = self.room
        if not self.rolled:
            raise GameError("Roll first.")
        pts = self.turn_pts + self.take(keep)
        if not p.g.on_board and pts < self.s["opening"]:
            raise GameError(f"You need {self.s['opening']:,} in one turn to get on the board (you have {pts:,}). Keep rolling!")
        p.g.on_board = True
        p.g.score += pts
        p.g.farkles = 0
        r.add_log(f"🏦 {p.name} banks {pts:,} → {p.g.score:,}.", "question")
        self.event_id += 1
        self.event = {"id": self.event_id, "kind": "bank", "by": p.id, "pts": pts}
        if pts >= 3000:
            self.award(p, "vault")
        if p.g.score >= self.s["target"] and self.final_from is None and len(self.seats) > 1:
            self.final_from = p.id
            r.add_log(f"🏁 {p.name} reaches {self.s['target']:,}! Everyone else gets one last turn.", "big")
        self.end_turn(p)

    def end_turn(self, p):
        r = self.room
        if len(self.seats) == 1:
            self.solo_turns += 1
            if p.g.score >= self.s["target"]:
                return r.finish(p, f"🏆 {p.name} reaches {self.s['target']:,} in {self.solo_turns} turns!")
            if self.solo_turns >= 25:
                return r.finish(None, f"🎯 {p.name} made {p.g.score:,} in 25 turns. Reach {self.s['target']:,} to win solo!")
            return self.begin(p.id)
        r.advance()
        if self.final_from and r.turn == self.final_from:
            return self.finish()
        self.begin(r.turn)

    def finish(self):
        r = self.room
        live = [r.players[i] for i in self.seats if i in r.players]
        top = max(q.g.score for q in live)
        best = [q for q in live if q.g.score == top]
        if len(best) == 1:
            r.finish(best[0], f"🏆 {best[0].name} wins Farkle with {top:,}!")
        else:
            r.finish(None, f"🤝 Tie at {top:,} between {' & '.join(q.name for q in best)}.")

    def on_timeout(self):
        r = self.room
        p = r.players[r.turn]
        r.add_log(f"⏰ {p.name} ran out of time.", "power")
        if self.rolled and self.turn_pts + keep_options(self.roll)[0][0] >= (0 if p.g.on_board else self.s["opening"]):
            return self.bank(p, keep_options(self.roll)[0][1])
        self.turn_pts = 0
        self.end_turn(p)

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and len(self.seats) > 1:
            was_turn = r.turn == p.id
            self.seats.remove(p.id)
            if self.final_from == p.id:
                self.final_from = None
            if len(self.seats) == 1:
                w = r.players[self.seats[0]]
                return r.finish(w, f"🏳️ {p.name} left — {w.name} wins!")
            r.add_log(f"{p.name} left the game.")
            p.eliminated = True
            if was_turn:
                self.end_turn(p)
            return
        super().on_leave(p)

    def skip_turn(self, p):
        return p.id not in self.seats

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"{p.g.score:,}" + ("" if p.g.on_board or not self.s["opening"] else " · not on board")

    def final_scores(self):
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        return {"farkle": {
            "seats": self.seats, "target": self.s["target"], "opening": self.s["opening"],
            "scores": {i: r.players[i].g.score for i in self.seats if i in r.players},
            "onBoard": {i: r.players[i].g.on_board for i in self.seats if i in r.players},
            "farkles": {i: r.players[i].g.farkles for i in self.seats if i in r.players},
            "roll": self.roll, "rolled": self.rolled, "turnPts": self.turn_pts, "diceLeft": self.dice_left,
            "kept": self.kept, "aside": getattr(self, "aside", []), "farkled": self.farkled, "final": bool(self.final_from),
            "options": [[pts, idx] for pts, idx in keep_options(self.roll)] if self.rolled else [],
            "event": self.event,
        }}

    # -- bots

    def bot_turn(self, p):
        r = self.room
        if not self.rolled:
            self.do_roll(p, [])
            r.bot_at = time.time() + 1.0
            return
        opts = keep_options(self.roll)
        level = p.bot
        pts, keep = opts[0]
        if level == "hard" and len(self.roll) - len(keep) < 3 and len(self.roll) >= 4:
            # keep just the best single scoring die if that leaves many more dice to roll
            singles = [o for o in opts if len(o[1]) == 1]
            if singles and pts < 300:
                pts, keep = singles[0]
        if level == "easy" and random.random() < 0.3:
            pts, keep = random.choice(opts)
        total = self.turn_pts + pts
        left = len(self.roll) - len(keep) or 6
        must = 0 if p.g.on_board else self.s["opening"]
        leader = max((r.players[i].g.score for i in self.seats if i != p.id and i in r.players), default=0)
        chasing = self.final_from and p.g.score + total <= leader  # last turn: must beat the leader
        if level == "easy":
            stop = total >= random.choice([250, 300, 400, 600])
        else:
            pf, avg = ODDS[left]
            # keep rolling while the expected gain beats the expected loss
            # (tuned by simulation: a slightly bold 0.8 does best; Farkle is mostly luck past that)
            stop = (1 - pf) * avg < pf * total * 0.8
        if total < must or chasing or (p.g.score + total < self.s["target"] and len(self.seats) == 1 and left >= 5):
            stop = False
        if stop:
            return self.bank(p, keep)
        self.do_roll(p, keep)
        r.bot_at = time.time() + 1.0
