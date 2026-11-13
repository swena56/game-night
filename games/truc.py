"""Truc (and Put): three cards, best two tricks of three, and a stake you can keep raising. Two players.

A 32-card deck ranked 3 2 A K Q J 10 9 8 7 (suits don't matter, so the 3 is the top card). Three cards
each. Win two tricks to win the hand; a tied trick counts for nobody and the same player leads again.
Before playing a card you may call "Truc!": your rival must accept, raising the stake by one, or fold
and give you the stake as it stood. They can raise back. A hand starts worth 1. In Put, a "Put!" isn't
one step up: accept and the hand decides the whole game. First to 12 (Truc) or 5 (Put) wins."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show

TRUC_ORDER = "789TJQKA23"


def pw(c):
    return TRUC_ORDER.index(rank(c))


class Truc(CardGame):
    id = "truc"
    name = "Truc"
    icon = "🗡️"
    blurb = "Three cards, best of three tricks, and a stake you can keep raising. Bluff them into folding."
    howto = [
        "Three cards each. Cards rank 3 2 A K Q J 10 9 8 7; suits don't matter. Win two tricks to win the hand.",
        "Before you play, call \"Truc!\": your rival accepts (the stake goes up by one) or folds and pays the old stake.",
        "They can raise you back. A tied trick counts for nobody.",
        "Truc: first to 12. Put: a call means the hand decides the game; first to 5.",
    ]
    min_players, max_players = 2, 2
    badges = {**CardGame.badges, "bluff": ("🃏", "Bluffer", "Win a hand by a fold while holding no 3, 2 or ace")}
    settings_schema = {"rules": ("Rules", [("truc", "Truc (to 12)"), ("put", "Put (to 5)")], "truc")}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(2)
        self.hand_no = 0
        self.room.add_log(f"🗡️ {self.label()} to {self.target()}.", "big")
        self.deal()

    def put(self):
        return self.s.get("rules") == "put"

    def label(self):
        return "Put" if self.put() else "Truc"

    def target(self):
        return 5 if self.put() else 12

    def deal(self):
        self.hand_no += 1
        self.dealer = 1 - self.dealer
        cards = deck(TRUC_ORDER)
        self.rng.shuffle(cards)
        self.hands = [cards[:3], cards[3:6]]
        for k in (0, 1):
            self.hands[k].sort(key=pw)
        self.stake = 1
        self.raiser = None           # who made the last call (can't raise their own)
        self.pending_call = None
        self.trick = []
        self.won = [0, 0]
        self.first = None
        self.history = []
        self.result = None
        self.leader = 1 - self.dealer
        self.stage = "play"
        self.to(self.leader)

    # -- the stake

    def can_call(self, i):
        if self.stage != "play" or self.raiser == i:
            return False
        if self.put():
            return self.stake == 1
        return self.stake < self.target()

    def call(self, i):
        self.pending_call = i
        self.stage = "answer"
        word = "Put!" if self.put() else "Truc!"
        self.moment(f"🗡️ {self.nm(i)}: {word}", "cool", "whoosh")
        self.room.add_log(f"🗡️ {self.nm(i)} calls {word}" + ("" if self.put() else f" (for {self.stake + 1})"), "power")
        self.to(1 - i)

    def answer(self, i, yes):
        caller = self.pending_call
        self.pending_call = None
        if not yes:
            self.room.add_log(f"🏳️ {self.nm(i)} folds: {self.nm(caller)} takes {self.stake}.", "power")
            if self.pl(caller) and all(rank(c) not in "32A" for c in self.hands[caller]):
                self.award(self.pl(caller), "bluff")
            return self.hand_over(caller, f"{self.nm(i)} folded")
        if self.put():
            self.stake = self.target()
        else:
            self.stake += 1
        self.raiser = caller
        self.room.add_log(f"✊ {self.nm(i)} accepts: the hand is worth {self.stake}.")
        self.stage = "play"
        self.to(self.turn_seat)

    # -- tricks

    @property
    def turn_seat(self):
        if not self.trick:
            return self.leader
        return 1 - self.trick[0][0]

    def play(self, i, c):
        self.hands[i].remove(c)
        self.trick.append((i, c))
        if len(self.trick) == 1:
            return self.to(1 - i)
        (a, ca), (b, cb) = self.trick
        if pw(ca) == pw(cb):
            w = None
            self.room.add_log(f"🃏 {show([ca, cb])}: a tie.")
        else:
            w = a if pw(ca) > pw(cb) else b
            self.won[w] += 1
            if self.first is None:
                self.first = w
            self.room.add_log(f"🃏 {show([ca, cb])} → {self.nm(w)}", "question")
        self.history.append({"cards": [[a, ca], [b, cb]], "winner": w})
        self.trick = []
        if w is not None:
            self.leader = w
        if max(self.won) == 2:
            return self.hand_over(0 if self.won[0] == 2 else 1, "two tricks")
        if not self.hands[0]:
            if self.won[0] == self.won[1]:
                if self.first is None:
                    self.result = "All tricks tied: no score."
                    self.room.add_log("🤝 Every trick tied: nobody scores.")
                    return self.next_hand()
                return self.hand_over(self.first, "the first trick")
            return self.hand_over(0 if self.won[0] > self.won[1] else 1, "more tricks")
        self.to(self.leader)

    def hand_over(self, w, why):
        self.score[w] += self.stake
        self.result = f"🏅 {self.nm(w)} +{self.stake} ({why})"
        self.room.add_log(self.result, "big")
        self.next_hand()

    def next_hand(self):
        tgt = self.target()
        if max(self.score) >= tgt:
            w = 0 if self.score[0] > self.score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} wins {self.label()}, {self.score[w]} to {self.score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 3)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        if self.stage == "answer" and t in ("accept", "fold"):
            return self.answer(i, t == "accept")
        if self.stage == "answer" and t == "call" and not self.put() and self.stake + 1 < self.target():
            # raise back: accept and call again in one go
            self.answer(i, True)
            return self.call(i)
        if self.stage == "play":
            if t == "call":
                if not self.can_call(i):
                    raise GameError("You can't raise now.")
                return self.call(i)
            if t == "play":
                c = a.get("card")
                if c not in self.hands[i]:
                    raise GameError("That card isn't in your hand.")
                return self.play(i, c)
        raise GameError("Not now.")

    # -- bot

    def strength(self, i):
        """Chance-ish of winning the hand from here."""
        hand = self.hands[i]
        mine = sorted((pw(c) for c in hand), reverse=True)
        need = 2 - self.won[i]
        lost = self.won[1 - i]
        if not mine:
            return 0.5
        score = sum(p / 9 for p in mine[:max(1, need)]) / max(1, need)
        if self.trick:
            led = pw(self.trick[0][1])
            if any(p > led for p in mine):
                score += 0.2
            else:
                score -= 0.3
        score += 0.25 * self.won[i] - 0.25 * lost
        return max(0.0, min(1.0, score))

    def bot_move(self, i, level):
        st = self.strength(i)
        bluff = {"easy": 0.03, "normal": 0.08, "hard": 0.14}[level]
        if self.stage == "answer":
            # fold when weak; raise back when strong
            cut = {"easy": 0.45, "normal": 0.5, "hard": 0.48}[level] + 0.02 * self.stake
            if self.put():
                # the whole game rides on it: fold cheap hands, and accept when they're about to win anyway
                cut = {"easy": 0.42, "normal": 0.5, "hard": 0.52}[level]
                if self.score[1 - i] >= self.target() - 1:
                    cut -= 0.3
            if level == "hard" and st > 0.85 and not self.put() and self.stake + 1 < self.target():
                self.answer(i, True)
                return self.call(i)
            return self.answer(i, st >= cut or random.random() < (0.15 if level == "easy" else 0.05))
        if self.stage != "play":
            return
        if self.put():
            bluff = 0.04 if level == "hard" and self.score[1 - i] > self.score[i] + 1 else 0
        if self.can_call(i) and (st > (0.8 if self.put() else 0.78) or random.random() < bluff):
            return self.call(i)
        hand = self.hands[i]
        if self.trick:
            led = pw(self.trick[0][1])
            wins = [c for c in hand if pw(c) > led]
            if wins:
                return self.play(i, min(wins, key=pw))
            ties = [c for c in hand if pw(c) == led]
            if ties and level == "hard" and self.won[i] > self.won[1 - i]:
                return self.play(i, ties[0])
            return self.play(i, min(hand, key=pw))
        # leading: middle card first with three, else the top
        if len(hand) == 3 and level != "easy":
            return self.play(i, sorted(hand, key=pw)[1])
        return self.play(i, max(hand, key=pw) if level != "easy" else random.choice(hand))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i]} pts"

    def final_scores(self):
        return {pid: self.score[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"tricks {self.won[k]}"] + (["dealer"] if k == self.dealer else [])} for k in (0, 1)]
        last = self.history[-1] if self.history else None
        t = {"info": info, "trick": [[s, c] for s, c in self.trick], "last": last,
             "hand": self.hands[i] if i is not None else [],
             "banner": self.result if self.stage == "score" else f"Stake: {self.stake}" + (" (the game!)" if self.put() and self.stake > 1 else ""),
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.score[k]} for k in (0, 1)],
                        "hint": f"{self.label()} to {self.target()} · 3 2 A K Q J 10 9 8 7"}}
        if i is None or self.room.turn != p.id:
            return t
        word = "Put" if self.put() else "Truc"
        if self.stage == "answer":
            t["buttons"] = [{"label": "✊ Accept" + ("" if self.put() else f" (play for {self.stake + 1})"), "a": {"type": "accept"}, "kind": "primary"},
                            {"label": f"🏳️ Fold (they take {self.stake})", "a": {"type": "fold"}}]
            if not self.put() and self.stake + 2 <= self.target():
                t["buttons"].append({"label": f"🗡️ Raise back ({self.stake + 2})", "a": {"type": "call"}})
            t["turnText"] = f"🗡️ {word}! Accept?"
        elif self.stage == "play":
            t["moves"] = [{"card": c, "a": {"type": "play", "card": c}} for c in self.hands[i]]
            if self.can_call(i):
                t["buttons"] = [{"label": f"🗡️ {word}!" + ("" if self.put() else f" (raise to {self.stake + 1})"), "a": {"type": "call"}}]
            t["turnText"] = "🗡️ Your card"
        return t
