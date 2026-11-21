"""Five Hundred: bid tricks and trumps, take the kitty, and race to 500. 4 players in pairs, or 3 alone.

Four players use a 43-card deck (5 up to ace, the red fours and a joker); three use 33 (7 up to ace and
the joker). Ten cards each and a three-card kitty. Each player in turn bids a number of tricks (6 to
10) and a trump suit (♠ < ♣ < ♦ < ♥ < no trumps), or passes for the rest of the auction. Misère (take no
tricks, playing alone) can be bid once the bidding has reached seven. The top bidder takes the kitty,
discards three and leads. Trumps rank joker, right bower (trump jack), left bower (the other jack of the
same colour), then A K Q 10 9 … Follow suit when you can. In no trumps the joker is the only trump.
Make the contract to score its value; miss it and lose that much. Opponents score 10 a trick. First
side to 500 wins; drop to −500 and you lose.

Option, Contra: after the discard an opponent may double a trick contract. Make it and the bidders score
twice the bid; go down and they lose twice the bid. Misère can't be doubled."""
import random

from .cardbase import GameError, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

JOKER = "JKR"
SAME = {"S": "C", "C": "S", "H": "D", "D": "H"}
BIDSUITS = "SCDHN"
GLY = {"S": "♠", "C": "♣", "D": "♦", "H": "♥", "N": "NT"}


def bid_value(b):
    if b == "M":
        return 250
    lvl, s = int(b[:-1]), b[-1]
    return 40 + 20 * BIDSUITS.index(s) + 100 * (lvl - 6)


def bid_name(b):
    if b == "M":
        return "Misère"
    return f"{b[:-1]} {'no trumps' if b[-1] == 'N' else GLY[b[-1]]}"


class FiveHundred(TrickGame):
    id = "fivehundred"
    name = "Five Hundred"
    icon = "5️⃣"
    blurb = "Bid tricks and trumps, grab the kitty, ride the joker and bowers to 500."
    howto = [
        "Ten cards each, three in the kitty. Bid tricks (6–10) and trumps (♠ < ♣ < ♦ < ♥ < NT), or pass for good.",
        "Misère (take no tricks, alone) can be bid once the bidding reaches seven.",
        "The winner takes the kitty, discards three and leads. Follow suit when you can.",
        "Trumps: joker, then the trump jack, then the other jack of that colour, then A K Q 10…",
        "Make it: score the bid (6♠ 40 up to 10NT 520). Miss: lose it. Opponents get 10 a trick. First to 500.",
        "An option, Contra: after the discard an opponent may double the bid, so making or missing it counts twice.",
    ]
    min_players, max_players = 3, 4
    doubled = None      # seat that doubled this hand's contract (Contra option)
    contra_q = ()       # opponents still to say double or pass
    order = "456789TJQKA"
    badges = {**TrickGame.badges, "slam": ("💥", "Slam", "Take all ten tricks as the bidder")}
    settings_schema = {"target": ("Play to", [(500, "500"), (300, "300 (quick)")], 500),
                       "contra": ("Contra", [(0, "Off"), (1, "On")], 0)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.teams = self.n == 4
        self.sides = 2 if self.teams else self.n
        self.score = [0] * self.sides
        self.dealer = rng.randrange(self.n)
        self.hand_no = 0
        self.room.add_log(f"5️⃣ Five Hundred to {self.s['target']}" + (" in pairs." if self.teams else ", every player for themselves."), "big")
        self.deal()

    def side(self, k):
        return k % 2 if self.teams else k

    def side_name(self, s):
        return f"{self.nm(s)} & {self.nm(s + 2)}" if self.teams else self.nm(s)

    def verb(self):
        return "reach" if self.teams else "reaches"

    def s_(self):
        return "" if self.teams else "s"

    def make_deck(self):
        if self.n == 4:
            cards = [r + s for s in "CDHS" for r in "56789TJQKA"] + ["4H", "4D"]
        else:
            cards = [r + s for s in "CDHS" for r in "789TJQKA"]
        return cards + [JOKER]

    def full_deck(self):
        return set(self.make_deck())

    # -- card strength

    def suit_of(self, c):
        if c == JOKER:
            return self.trump or "X"
        if self.trump and self.trump in SAME and rank(c) == "J" and suit(c) == SAME[self.trump]:
            return self.trump
        return suit(c)

    def power(self, c):
        if c == JOKER:
            return 30
        if self.trump in SAME and rank(c) == "J":
            if suit(c) == self.trump:
                return 21
            if suit(c) == SAME[self.trump]:
                return 20
        return self.order.index(rank(c))

    def is_out(self, i):
        return self.stage in ("play", "score") and self.contract == "M" and self.teams and i == (self.bidder + 2) % 4

    # -- the deal and auction

    def deal(self):
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % self.n
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.trump = None
        self.hands = [cards[k * 10:(k + 1) * 10] for k in range(self.n)]
        self.kitty = cards[self.n * 10:]
        self.trick, self.last, self.tricks = [], None, [0] * self.n
        self.passed = [False] * self.n
        self.said = [None] * self.n
        self.contract, self.bidder = None, None
        self.doubled, self.contra_q = None, ()
        self.result = None
        self.stage = "bid"
        for k in range(self.n):
            self.sort_hand(k)
        self.to((self.dealer + 1) % self.n)

    def bid_options(self):
        cur = bid_value(self.contract) if self.contract else 0
        opts = [f"{l}{s}" for l in range(6, 11) for s in BIDSUITS if bid_value(f"{l}{s}") > cur]
        if self.contract and self.contract != "M" and int(self.contract[:-1]) >= 7 and cur < 250:
            opts.append("M")
        return sorted(opts, key=bid_value)

    def place_bid(self, i, b):
        if b == "pass":
            self.passed[i] = True
            self.said[i] = "pass"
            self.room.add_log(f"{self.nm(i)} passes.")
        else:
            self.contract, self.bidder = b, i
            self.said[i] = b
            self.room.add_log(f"🙋 {self.nm(i)} bids {bid_name(b)}.")
        live = [k for k in range(self.n) if not self.passed[k]]
        if not live:
            self.room.add_log("😶 Everyone passed: a new deal.")
            self.stage = "score"
            return self.pause(self.deal, 2)
        if self.contract and live == [self.bidder]:
            return self.win_auction()
        if self.contract == "10N" and self.bidder is not None:
            return self.win_auction()
        k = i
        for _ in range(self.n):
            k = (k + 1) % self.n
            if not self.passed[k]:
                return self.to(k)

    def win_auction(self):
        i = self.bidder
        b = self.contract
        self.trump = None if b in ("M",) or b.endswith("N") else b[-1]
        if self.trump is None:
            self.trump = "X"     # the joker's own suit: the only trump
        self.moment(f"🙋 {self.nm(i)} wins the bid: {bid_name(b)}!", "cool", "whoosh")
        self.hands[i] += self.kitty
        self.kitty = []
        for k in range(self.n):
            self.sort_hand(k)
        self.stage = "kitty"
        self.to(i)

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if self.stage == "bid" and t == "bid":
            b = a.get("bid")
            if b != "pass" and b not in self.bid_options():
                raise GameError("Bid higher, or pass.")
            return self.place_bid(i, b)
        if self.stage == "kitty" and t == "discard":
            cards = a.get("cards")
            if not isinstance(cards, list) or len(cards) != 3 or len(set(cards)) != 3 or any(c not in self.hands[i] for c in cards):
                raise GameError("Discard exactly three cards.")
            return self.drop(i, cards)
        if self.stage == "contra" and t == "contra":
            return self.say_contra(i, bool(a.get("double")))
        raise GameError("Not now.")

    def drop(self, i, cards):
        for c in cards:
            self.hands[i].remove(c)
        self.room.add_log(f"🗑️ {self.nm(i)} takes the kitty and discards three.")
        if self.s.get("contra") and self.contract != "M":
            bs = self.side(i)
            self.contra_q = [k for k in range(self.n) if self.side(k) != bs]
            self.stage = "contra"
            return self.to(self.contra_q[0])
        self.start_tricks(i)

    def say_contra(self, i, yes):
        if yes:
            self.doubled, self.contra_q = i, ()
            self.moment(f"🔥 {self.nm(i)} doubles {self.nm(self.bidder)}'s {bid_name(self.contract)}: double or quits!", "bad", "boom")
        else:
            self.contra_q = self.contra_q[1:]
            if self.contra_q:
                return self.to(self.contra_q[0])
            self.room.add_log("Nobody doubles.")
        self.start_tricks(self.bidder)

    def bot_contra(self, i, level):
        """Double when this hand alone nearly sinks the bid; the partner, kitty and a hard bot's margin vary."""
        if level == "easy":
            return False
        t = "N" if self.trump == "X" else self.trump
        need = 11 - int(self.contract[:-1])         # tricks that set the bid
        e = self.est(i, t) + (1.0 if self.teams else 0.4)
        return e >= need + (0.0 if level == "hard" else 0.3)

    # -- bot

    def est(self, i, s, hand=None):
        """Tricks this hand should take with trumps s ('N' = no trumps)."""
        hand = hand or self.hands[i]
        old = self.trump
        self.trump = "X" if s == "N" else s
        e = 0.0
        tr = sorted((self.power(c) for c in hand if self.suit_of(c) == self.trump), reverse=True)
        for k, p in enumerate(tr):
            e += 1 if p >= 20 or p == 30 else 0.85 if p >= 9 else 0.6 if k >= 2 else 0.4
        for c in hand:
            if self.suit_of(c) != self.trump:
                if rank(c) == "A":
                    e += 0.9 if s != "N" else 1
                elif rank(c) == "K":
                    e += 0.4 if s != "N" else 0.6
        if s == "N" and len(tr) == 0:
            e -= 0.5
        self.trump = old
        return e

    def bot_bid(self, i, level):
        opts = self.bid_options()
        best = max("SCDHN", key=lambda s: self.est(i, s))
        e = self.est(i, best) + (1.6 if self.teams else 0.8)        # the partner and kitty help
        if level == "easy":
            e += random.uniform(-1, 1)
        elif level == "hard" and self.teams and self.contract and self.side(self.bidder) == self.side(i):
            e -= 0.7     # don't outbid the partner without reason
        lvl = int(e)
        for b in opts:
            if b != "M" and b[-1] == best and int(b[:-1]) <= lvl:
                return b
        if level == "hard" and "M" in opts and max(self.power(c) for c in self.hands[i] if c != JOKER) <= 7 and JOKER not in self.hands[i]:
            return "M"
        return "pass"

    def bot_drop(self, i, level):
        hand = self.hands[i]
        t = self.trump
        if self.contract == "M":
            return sorted(hand, key=lambda c: -self.power(c))[:3]
        side = [c for c in hand if self.suit_of(c) != t and rank(c) != "A"]
        count = {}
        for c in side:
            count[self.suit_of(c)] = count.get(self.suit_of(c), 0) + 1
        side.sort(key=lambda c: (count[self.suit_of(c)], self.power(c)) if level != "easy" else self.power(c))
        out = side[:3]
        if len(out) < 3:
            rest = sorted((c for c in hand if c not in out), key=lambda c: (self.suit_of(c) == t, self.power(c)))
            out += rest[:3 - len(out)]
        return out

    def bot_other(self, i, level):
        if self.stage == "bid":
            return self.place_bid(i, self.bot_bid(i, level))
        if self.stage == "kitty":
            return self.drop(i, self.bot_drop(i, level))
        if self.stage == "contra":
            return self.say_contra(i, self.bot_contra(i, level))

    def wants(self, i):
        if self.contract == "M":
            return i != self.bidder
        return True

    # -- scoring

    def end_hand(self):
        bs = self.side(self.bidder)
        took = [0] * self.sides
        for k in range(self.n):
            took[self.side(k)] += self.tricks[k]
        v = bid_value(self.contract)
        if self.contract == "M":
            made = took[bs] == 0
        else:
            made = took[bs] >= int(self.contract[:-1])
            if took[bs] == 10 and v < 250:
                v = 250
        if self.doubled is not None:
            v *= 2
        if made:
            self.score[bs] += v
            if took[bs] == 10 and self.contract != "M":
                for k in range(self.n):
                    if self.side(k) == bs and self.pl(k):
                        self.award(self.pl(k), "slam")
        else:
            self.score[bs] -= v
        if self.contract != "M":
            for s in range(self.sides):
                if s != bs:
                    self.score[s] += 10 * took[s]
        x2 = " (doubled by " + self.nm(self.doubled) + ")" if self.doubled is not None else ""
        text = (f"✅ {self.side_name(bs)} made {bid_name(self.contract)}{x2}: +{v}" if made else f"❌ {self.side_name(bs)} went down in {bid_name(self.contract)}{x2}: −{v}")
        self.result = text
        self.room.add_log(f"🧮 {text}. Tricks: " + ", ".join(f"{self.side_name(s)} {took[s]}" for s in range(self.sides)), "big")
        self.moment(text, "gold" if made else "bad", "fanfare" if made else "boom")
        tgt = self.s["target"]
        if self.score[bs] >= tgt and made:
            return self.room.finish(self.pl(bs), f"🏆 {self.side_name(bs)} {self.verb()} {self.score[bs]} and win{self.s_()} Five Hundred!")
        if self.score[bs] <= -tgt:
            others = [s for s in range(self.sides) if s != bs]
            w = max(others, key=lambda s: self.score[s])
            return self.room.finish(self.pl(w), f"🏆 {self.side_name(bs)} sink to {self.score[bs]}: {self.side_name(w)} win{'' if self.teams else 's'}!")
        over = [s for s in range(self.sides) if self.score[s] >= tgt]
        if over:
            w = max(over, key=lambda s: self.score[s])
            return self.room.finish(self.pl(w), f"🏆 {self.side_name(w)} {self.verb()} {self.score[w]} and win{self.s_()} Five Hundred!")
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[self.side(i)]} pts"

    def final_scores(self):
        return {pid: self.score[self.side(k)] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(self.n):
            tags = []
            if self.stage == "bid" and self.said[k]:
                tags.append("pass" if self.said[k] == "pass" else bid_name(self.said[k]))
            if k == self.bidder and self.stage != "bid":
                tags.append(f"🙋 {bid_name(self.contract)}" + (" ×2" if self.doubled is not None else ""))
            if self.stage in ("play", "score") and self.contract:
                tags.append("sits out" if self.is_out(k) else f"{self.tricks[k]} tricks")
            info.append({"count": len(self.hands[k]), "tags": tags, "out": self.is_out(k)})
        nt = self.trump == "X"
        rows = [{"seat": s, "value": self.score[s], "sub": f"& {self.nm(s + 2)}" if self.teams else ""} for s in sorted(range(self.sides), key=lambda s: -self.score[s])]
        t = {"info": info, "trump": None if nt else self.trump, "trumpLabel": "No trumps (joker high)" if nt else None,
             "piles": [{"cards": ["??"] * len(self.kitty), "label": "Kitty", "small": True}] if self.kitty else [],
             "banner": self.result if self.stage == "score" else None,
             "scores": {"title": "Points", "rows": rows, "hint": f"To {self.s['target']} · 6♠ 40 · 6NT 120 · each trick up +100 · Misère 250"}}
        t.update(self.trick_view(p, i))
        if i is None or self.room.turn != p.id:
            return t
        if self.stage == "bid":
            allb = self.bid_options()
            opts = []
            for s in BIDSUITS:
                mine = [b for b in allb if b != "M" and b[-1] == s][:2]
                opts += mine
            if "M" in allb:
                opts.append("M")
            opts.sort(key=bid_value)
            t["buttons"] = [{"label": "Pass", "a": {"type": "bid", "bid": "pass"}}] + \
                [{"label": f"{bid_name(b)} ({bid_value(b)})", "a": {"type": "bid", "bid": b}, "kind": "primary"} for b in opts]
            t["note"] = "Bid tricks and trumps, or pass for the rest of this auction."
            t["turnText"] = "🙋 Your bid"
        elif self.stage == "kitty":
            t["pick"] = {"act": "discard", "min": 3, "max": 3, "label": "Discard these"}
            t["note"] = "You took the kitty: discard three."
            t["turnText"] = "🗑️ Discard three"
        elif self.stage == "contra":
            t["buttons"] = [{"label": "Pass", "a": {"type": "contra", "double": False}},
                            {"label": "🔥 Double", "a": {"type": "contra", "double": True}, "kind": "primary"}]
            t["note"] = f"{self.nm(self.bidder)} bid {bid_name(self.contract)}. Double to make the bid count twice, win or lose."
            t["turnText"] = "🔥 Double the bid?"
        return t
