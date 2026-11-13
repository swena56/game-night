"""Trick-taking on the 🃏 card table: follow suit, trumps, who takes the trick, and a bot that knows
whether it wants tricks. Spades, Oh Hell, Euchre, Knock Out Whist, Whist, German Whist and Briscola
are subclasses that add their deal, bidding and scoring.

A subclass sets `order` (ranks low to high), may override `suit_of` / `power` (Euchre's bowers),
`lead_ok` (Spades can't lead spades until broken), `wants(i)` (does this seat want the trick?),
and must define `end_hand()`; it calls `start_tricks(leader)` once the hand is dealt."""
import random

from .cardbase import CardGame, GameError, RANKS, rank, suit, pretty, show, by_suit


class TrickGame(CardGame):
    order = RANKS
    follow = True           # must follow suit when able
    teams = False           # partners sit opposite (seat i and i + 2)
    trump = None

    # -- card strength

    def suit_of(self, c):
        return suit(c)

    def power(self, c):
        return self.order.index(rank(c))

    def beats(self, c, best, led):
        """Does card c beat the trick's best card so far?"""
        t = self.trump
        cs, bs = self.suit_of(c), self.suit_of(best)
        if t and cs == t and bs != t:
            return True
        if cs != bs:
            return False
        return self.power(c) > self.power(best)

    def best_of(self, trick):
        led = self.suit_of(trick[0][1])
        win = trick[0]
        for s, c in trick[1:]:
            if self.beats(c, win[1], led):
                win = (s, c)
        return win

    def sort_hand(self, i):
        t = getattr(self, "trump", None)
        suits = "".join(x for x in "CDSH" if x != t) + (t or "")
        self.hands[i].sort(key=lambda c: (suits.index(self.suit_of(c)) if self.suit_of(c) in suits else 9, self.power(c)))

    def partner(self, i):
        return (i + 2) % self.n if self.teams and self.n == 4 else None

    # -- the hand

    def start_tricks(self, leader):
        self.stage = "play"
        self.trick = []
        self.last = None
        self.tricks = [0] * self.n
        self.won = [[] for _ in range(self.n)]
        self.played = set()
        self.broken = False
        for i in range(self.n):
            self.sort_hand(i)
        self.to(leader)

    def in_hand(self):
        """Seats taking part in this hand."""
        return [i for i in range(self.n) if not self.is_out(i)]

    def lead_ok(self, i, c):
        return True

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick:
            ok = [c for c in hand if self.lead_ok(i, c)]
            return ok or hand[:]
        if not self.follow:
            return hand[:]
        led = self.suit_of(self.trick[0][1])
        same = [c for c in hand if self.suit_of(c) == led]
        return same or hand[:]

    def play(self, i, c):
        self.hands[i].remove(c)
        self.trick.append((i, c))
        if self.trump and self.suit_of(c) == self.trump:
            self.broken = True
        self.on_card(i, c)
        if len(self.trick) < len(self.in_hand()):
            return self.to(self.next_seat(i))
        w, _ = self.best_of(self.trick)
        cards = [c for _, c in self.trick]
        self.tricks[w] += 1
        self.won[w].extend(cards)
        self.played.update(cards)
        self.last = {"cards": [[s, c] for s, c in self.trick], "winner": w}
        self.room.add_log(f"🃏 {show(cards)} → {self.nm(w)}", "question")
        self.trick = []
        self.on_trick(w, cards)
        if self.room.phase != "playing":
            return
        if not any(self.hands[k] for k in self.in_hand()):
            return self.end_hand()
        self.next_lead(w)

    def next_lead(self, w):
        self.to(w)

    def on_card(self, i, c):
        pass

    def on_trick(self, w, cards):
        pass

    def end_hand(self):
        raise NotImplementedError

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        if t == "play":
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait for the next trick.")
            c = a.get("card")
            if not isinstance(c, str) or c not in self.hands[i]:
                raise GameError("That card isn't in your hand.")
            if c not in self.legal(i):
                raise GameError("You must follow suit." if self.trick else "You can't lead that yet.")
            return self.play(i, c)
        return self.act_other(p, i, t, a)

    def act_other(self, p, i, t, a):
        raise GameError("Unknown action.")

    def bot_move(self, i, level):
        if self.stage == "play":
            return self.play(i, self.bot_card(i, level))
        return self.bot_other(i, level)

    def bot_other(self, i, level):
        pass

    # -- the bot's card

    def wants(self, i):
        """Does seat i want to win tricks right now?"""
        return True

    def is_boss(self, i, c, level):
        """Is c the highest card left in its suit? Everyone sees the trick and their own hand; a hard bot
        also remembers every card played this hand."""
        s = self.suit_of(c)
        seen = set(self.hands[i]) | {x for _, x in self.trick}
        if level == "hard":
            seen |= self.played
        return all(x in seen for x in self.full_deck() if self.suit_of(x) == s and self.power(x) > self.power(c))

    def full_deck(self):
        if not hasattr(self, "_deck"):
            self._deck = set(self.make_deck())
        return self._deck

    def make_deck(self):
        return [r + s for s in "CDHS" for r in self.order]

    def bot_card(self, i, level):
        legal = self.legal(i)
        if len(legal) == 1:
            return legal[0]
        if level == "easy" and random.random() < 0.45:
            return random.choice(legal)
        want = self.wants(i)
        t = self.trump
        low = lambda cs: min(cs, key=lambda c: (self.suit_of(c) == t, self.power(c)))
        high = lambda cs: max(cs, key=lambda c: (self.suit_of(c) == t, self.power(c)))
        if not self.trick:
            if want:
                boss = [c for c in legal if self.suit_of(c) != t and self.is_boss(i, c, level)]
                if boss:
                    return high(boss)
                trumps = [c for c in legal if self.suit_of(c) == t]
                if level == "hard" and len(trumps) * 2 > len(self.hands[i]):
                    return high(trumps)
                # lead low from the longest side suit, keeping the trumps
                plain = [c for c in legal if self.suit_of(c) != t] or legal
                count = {}
                for c in plain:
                    count[self.suit_of(c)] = count.get(self.suit_of(c), 0) + 1
                longest = max(count, key=count.get)
                return min((c for c in plain if self.suit_of(c) == longest), key=self.power)
            return low(legal)
        led = self.suit_of(self.trick[0][1])
        bs, best = self.best_of(self.trick)
        last = len(self.trick) == len(self.in_hand()) - 1
        winners = [c for c in legal if self.beats(c, best, led)]
        losers = [c for c in legal if c not in winners]
        mate = self.partner(i)
        if want and mate is not None and bs == mate and (last or self.is_boss(i, best, level)):
            return low(losers or legal)       # partner has it: don't waste a card
        if want:
            if not winners:
                return low(legal)
            if last:
                return low(winners)
            sure = [c for c in winners if self.is_boss(i, c, level) and self.suit_of(c) == led]
            if sure:
                return low(sure)
            return low(winners) if any(self.suit_of(c) == t for c in winners) and led != t else high(winners)
        if losers:
            return high(losers)
        return high(winners) if last else low(winners)

    # -- view pieces

    def trick_view(self, p, i):
        mine = i is not None and self.stage == "play" and self.room.turn == p.id
        return {
            "trick": [[s, c] for s, c in self.trick], "last": self.last,
            "hand": self.hands[i] if i is not None else [],
            "moves": [{"card": c, "a": {"type": "play", "card": c}} for c in self.legal(i)] if mine else [],
        }
