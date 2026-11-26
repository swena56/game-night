"""Ninety-Nine: bid with your discards, then take exactly that many tricks. For three players.

A 36-card deck (six up to ace), twelve cards each. Everyone secretly lays aside three cards as their
bid: each ♣ counts 3, ♥ 2, ♠ 1 and ♦ 0, so the bid is 0 to 9 tricks. Then play the nine tricks,
following suit if you can. Score one point a trick, plus a bonus for landing your bid exactly: 30 if
you're the only one who does, 20 each if two do, 10 each if all three do. Trumps change every hand.
First to the target wins."""
import random
from itertools import combinations

from .cardbase import GameError, deck, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

WORTH = {"C": 3, "H": 2, "S": 1, "D": 0}
TRUMPS = ["D", "S", "H", "C", None]


class NinetyNine(TrickGame):
    id = "ninetynine"
    solo_bots = 2
    name = "Ninety-Nine"
    icon = "💯"
    blurb = "Bid by discarding three cards, then take exactly that many tricks. Three players, nine tricks."
    howto = [
        "36 cards (6 up to ace), twelve each. Lay aside three cards as your secret bid.",
        "Open Plan your bid to compare discard sets for your target trick count. The estimate uses your own cards and the current trump.",
        "Each bid card counts by suit: ♣ 3, ♥ 2, ♠ 1, ♦ 0. So you bid 0 to 9 tricks.",
        "Play nine tricks; follow suit if you can. Trumps change every hand (the last of each cycle has none).",
        "1 point a trick. Make your bid exactly: +30 if you're the only one, +20 each for two, +10 each for all three.",
        "🎰 Double or nothing (once a game): arm it while bidding. Make your bid and your bonus doubles; miss and you lose 10.",
        "First to the target wins.",
    ]
    min_players, max_players = 3, 3
    order = "6789TJQKA"
    badges = {**TrickGame.badges, "lone": ("🎯", "Lone sniper", "Be the only one to make your bid")}
    settings_schema = {"double": ("🎰 Double or nothing", [(1, "Once a game"), (0, "Off")], 1),
                       "target": ("Play to", [(100, "100 points"), (60, "60 (quick)"), (150, "150 points")], 100)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * 3
        self.hand_no = 0
        self.dealer = rng.randrange(3)
        self.dons = [1 if self.s.get("double", 1) else 0] * 3  # double-or-nothings left
        self.armed = set()
        self.dbl = set()  # seats that doubled this hand
        self.room.add_log(f"💯 Ninety-Nine to {self.s['target']}. Bid ♣3 ♥2 ♠1 ♦0.", "big")
        self.deal()

    def make_deck(self):
        return deck(self.order)

    def deal(self):
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % 3
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 12:(k + 1) * 12] for k in range(3)]
        self.trump = TRUMPS[(self.hand_no - 1) % len(TRUMPS)]
        self.bids = [None] * 3
        self.armed, self.dbl = set(), set()
        self.bidcards = [[] for _ in range(3)]
        self.result = None
        self.trick, self.last, self.tricks = [], None, [0] * 3
        for k in range(3):
            self.sort_hand(k)
        self.stage = "bid"
        self.room.add_log(f"🃏 Hand {self.hand_no}: " + (f"{SUIT_NAME[self.trump]} are trumps." if self.trump else "no trumps."))
        self.open_all(range(3))

    # -- bidding

    def place_bid(self, i, cards):
        for c in cards:
            self.hands[i].remove(c)
        self.bidcards[i] = cards
        self.bids[i] = sum(WORTH[suit(c)] for c in cards)
        if i in self.armed and self.can_double(i):
            self.dons[i] -= 1
            self.dbl.add(i)
            self.moment(f"🎰 {self.nm(i)} is going double or nothing!", "cool")
        self.armed.discard(i)
        self.waiting.discard(i)
        self.room.add_log(f"🤫 {self.nm(i)} lays aside a bid.")
        if not self.waiting:
            self.room.add_log("Bids are in. Play!")
            self.start_tricks((self.dealer + 1) % 3)

    def can_double(self, i):
        return bool(getattr(self, "dons", None)) and self.dons[i] > 0

    def act_other(self, p, i, t, a):
        if t == "double":
            if self.stage != "bid" or i not in self.waiting or not self.can_double(i):
                raise GameError("You can't double down now.")
            self.armed ^= {i}
            return
        if t != "bid" or self.stage != "bid" or i not in self.waiting:
            raise GameError("Not now.")
        cards = a.get("cards")
        if not isinstance(cards, list) or len(cards) != 3 or len(set(cards)) != 3 or any(c not in self.hands[i] for c in cards):
            raise GameError("Pick exactly three cards to bid with.")
        self.place_bid(i, cards)

    def strength(self, i, hand, level):
        """Roughly how many tricks this nine-card hand should take."""
        t = self.trump
        e = 0.0
        by = {}
        for c in hand:
            by.setdefault(suit(c), []).append(self.power(c))
        for s, ps in by.items():
            ps.sort(reverse=True)
            if s == t:
                e += sum(1 if p >= 6 else 0.6 if p >= 4 else 0.35 for p in ps)
            else:
                for j, p in enumerate(ps):
                    if p == 8 and j == 0:
                        e += 0.95
                    elif p == 7 and j <= 1 and len(ps) >= 2:
                        e += 0.6
                    elif p == 6 and len(ps) >= 3:
                        e += 0.3
                if t and len(ps) <= 1 and by.get(t):
                    e += 0.3
        return e

    def bid_plan(self, i):
        hand = self.hands[i]
        best = {}
        for cards in combinations(hand, 3):
            bid = sum(WORTH[suit(c)] for c in cards)
            estimate = self.strength(i, [c for c in hand if c not in cards], "hard")
            cost = abs(estimate - bid) + 0.05 * sum(self.power(c) for c in cards)
            if bid not in best or cost < best[bid][0]:
                best[bid] = (cost, {"bid": bid, "cards": [pretty(c) for c in cards],
                                    "estimate": round(estimate, 1)})
        return [best[bid][1] for bid in sorted(best)]

    def bot_bid(self, i, level):
        hand = self.hands[i]
        if level == "easy":
            return random.sample(hand, 3)
        best, pick = None, None
        tries = 220 if level == "hard" else 60
        combos = set()
        for _ in range(tries):
            combos.add(tuple(sorted(random.sample(hand, 3))))
        for cs in combos:
            rest = [c for c in hand if c not in cs]
            bid = sum(WORTH[suit(c)] for c in cs)
            e = self.strength(i, rest, level)
            # discarding high cards is a waste; matching the estimate is what matters
            miss = abs(e - bid) + 0.05 * sum(self.power(c) for c in cs)
            if best is None or miss < best:
                best, pick = miss, list(cs)
        return pick

    def bot_other(self, i, level):
        if self.stage == "bid" and i in self.waiting:
            if level != "easy" and self.can_double(i) and random.random() < 0.25:
                self.armed.add(i)
            self.place_bid(i, self.bot_bid(i, level))

    def wants(self, i):
        left = len(self.hands[i]) + (1 if any(s == i for s, _ in self.trick) else 0)
        need = self.bids[i] - self.tricks[i]
        if self.level(i) == "easy":
            return need > 0
        return need > 0 and (need >= left * 0.5 or random.random() < 0.85)

    # -- scoring

    def end_hand(self):
        made = [k for k in range(3) if self.tricks[k] == self.bids[k]]
        bonus = {1: 30, 2: 20, 3: 10}.get(len(made), 0)
        for k in range(3):
            self.scores[k] += self.tricks[k] + (bonus if k in made else 0)
            if k in self.dbl:
                if k in made:
                    self.scores[k] += bonus
                    self.moment(f"🎰 {self.nm(k)} doubled and made it: +{bonus} more!", "gold", "fanfare")
                else:
                    self.scores[k] -= 10
                    self.moment(f"🎰 {self.nm(k)} doubled and missed: -10", "bad")
        if len(made) == 1 and self.pl(made[0]):
            self.award(self.pl(made[0]), "lone")
        self.result = [{"bid": self.bids[k], "took": self.tricks[k], "made": k in made, "cards": self.bidcards[k]} for k in range(3)]
        self.room.add_log("🧮 " + ", ".join(f"{self.nm(k)} {self.tricks[k]}/{self.bids[k]}" + (" ✅" if k in made else "") for k in range(3)), "big")
        if made:
            self.moment(("🎯 " + " & ".join(self.nm(k) for k in made) + f" made it: +{bonus}!"), "gold", "fanfare")
        tgt = self.s["target"]
        if max(self.scores) >= tgt:
            return self.win_by_score(self.scores)
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(3):
            tags = []
            if self.stage == "play":
                tags.append(f"took {self.tricks[k]}")
            if k in self.dbl and self.stage != "bid":
                tags.append("🎰 double")
            if self.stage == "score" and self.result:
                r = self.result[k]
                tags = [f"{r['took']}/{r['bid']}" + (" ✅" if r["made"] else " ❌")]
            elif k == i and self.bids[k] is not None:
                tags.append(f"bid {self.bids[k]}")
            info.append({"count": len(self.hands[k]), "tags": tags,
                         "show": self.result[k]["cards"] if self.stage == "score" and self.result else []})
        t = {"info": info, "trump": self.trump, "trumpLabel": None if self.trump else "No trumps",
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(3), key=lambda k: -self.scores[k])],
                        "hint": f"Hand {self.hand_no} · to {self.s['target']} · bids ♣3 ♥2 ♠1 ♦0"}}
        t.update(self.trick_view(p, i))
        if i is None:
            return t
        if self.stage == "bid" and i in self.waiting:
            t["bidPlan"] = self.bid_plan(i)
            t["pick"] = {"act": "bid", "min": 3, "max": 3, "label": "Bid with these"}
            t["note"] = "Pick three cards to lay aside. ♣ = 3, ♥ = 2, ♠ = 1, ♦ = 0 tricks." + (" 🎰 Doubled: bonus x2 if you make it, -10 if not." if i in self.armed else "")
            if self.can_double(i):
                t["buttons"] = [{"label": "🎰 Double or nothing: ON" if i in self.armed else "🎰 Double or nothing", "a": {"type": "double"}}]
            t["turnText"] = "🤫 Lay aside your bid"
        elif self.bids[i] is not None and self.stage == "play":
            note = f"Your bid: {self.bids[i]} ({show(self.bidcards[i])}). You've taken {self.tricks[i]}."
            if self.room.phase == "playing":
                remaining = 9 - sum(self.tricks)
                need = self.bids[i] - self.tricks[i]
                if need < 0:
                    progress = "Bid missed. You took too many tricks."
                elif need == 0:
                    progress = "Avoid taking another trick."
                elif need > remaining:
                    progress = f"Bid out of reach. Only {remaining} trick{'s' if remaining != 1 else ''} left."
                else:
                    progress = f"Win {need} more trick{'s' if need != 1 else ''}."
                note += " " + progress
            t["note"] = note
        return t
