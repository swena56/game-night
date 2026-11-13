"""German Whist: two-player whist with a stock to fight over.

Thirteen cards each; the rest is the stock, its top card face up, and that first card's suit is trumps
for the hand. In the first half you play tricks for the face-up card: the winner takes it, the loser
takes the next (unseen) card, and a new card is turned. These tricks don't count. Once the stock is
gone the last thirteen tricks do: take the most to win the hand, scoring the difference. Follow suit
whenever you can. Most points after the last hand wins."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, SUIT_NAME
from .tricks import TrickGame


class GermanWhist(TrickGame):
    id = "germanwhist"
    name = "German Whist"
    icon = "🦅"
    blurb = "Two-player whist: win tricks to pick your cards from the stock, then play the thirteen that count."
    howto = [
        "Thirteen cards each. The stock's top card is face up; the first one's suit is trumps.",
        "First half: the trick winner takes the face-up card, the loser takes the hidden next card. These tricks don't count.",
        "Follow suit if you can. Highest trump wins, else the highest card of the suit led.",
        "When the stock runs out, play the last thirteen tricks: they count. Most tricks wins the hand by the difference.",
        "After the last hand, most points wins.",
    ]
    min_players, max_players = 2, 2
    badges = {**TrickGame.badges, "slam": ("💫", "Grand slam", "Take all thirteen tricks of the second half")}
    settings_schema = {"hands": ("Hands", [(3, "3 hands"), (1, "1 hand (quick)"), (5, "5 hands")], 3)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0, 0]
        self.hand_no = 0
        self.leader = rng.randrange(2)
        self.room.add_log(f"🦅 German Whist: {self.s['hands']} hand{'s' if self.s['hands'] > 1 else ''}.", "big")
        self.deal()

    def deal(self):
        self.hand_no += 1
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [cards[:13], cards[13:26]]
        self.stock = cards[26:]
        self.trump = suit(self.stock[0])
        self.counted = [0, 0]
        self.phase = 1
        self.got = None
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.stock[0])} turned, {SUIT_NAME[self.trump]} are trumps.")
        self.leader = 1 - self.leader
        self.start_tricks(self.leader)

    def wants(self, i):
        if self.phase == 2:
            return True
        # first half: is the face-up card worth winning a trick for?
        up = self.stock[0]
        lvl = self.level(i)
        worth = self.power(up) + (6 if suit(up) == self.trump else 0)
        return worth >= (9 if lvl == "hard" else 10)

    def on_trick(self, w, cards):
        if self.phase == 1:
            up, hidden = self.stock[0], self.stock[1]
            self.stock = self.stock[2:]
            self.hands[w].append(up)
            self.hands[1 - w].append(hidden)
            self.sort_hand(0)
            self.sort_hand(1)
            self.got = {"seat": w, "card": up}
            self.room.add_log(f"{self.nm(w)} takes {pretty(up)}.")
            if not self.stock:
                self.phase = 2
                self.tricks = [0, 0]
                self.played = set()    # the counting half: a hard bot starts its memory afresh
                self.moment("🦅 The stock is gone: these tricks count!", "cool", "whoosh")
        else:
            self.counted[w] += 1

    def end_hand(self):
        a, b = self.counted
        w = 0 if a > b else 1
        diff = abs(a - b)
        self.scores[w] += diff
        if max(a, b) == 13 and self.pl(w):
            self.award(self.pl(w), "slam")
        self.room.add_log(f"🧮 {self.nm(0)} {a} – {b} {self.nm(1)}: {self.nm(w)} +{diff}.", "big")
        if self.hand_no >= self.s["hands"]:
            return self.win_by_score(self.scores)
        self.stage = "score"
        self.pause(self.deal, 3.5)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"tricks {self.counted[k]}" if self.phase == 2 else "first half"]} for k in range(2)]
        t = {"info": info, "trump": self.trump,
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k], "sub": f"this hand {self.counted[k]}"} for k in (0, 1)],
                        "hint": f"Hand {self.hand_no} of {self.s['hands']}. Only the second-half tricks count."}}
        t.update(self.trick_view(p, i))
        if self.phase == 1 and self.stock:
            t["piles"] = [{"cards": [self.stock[0]], "count": len(self.stock), "glow": True, "label": "Up for grabs", "corner": True}]
            t["note"] = f"Win this trick to take {pretty(self.stock[0])}; the loser gets a hidden card."
        elif self.phase == 2:
            t["note"] = f"These tricks count: you {self.counted[i] if i is not None else '-'}, them {self.counted[1 - i] if i is not None else '-'}."
        if self.got and i is not None and self.got["seat"] != i and self.phase == 1:
            pass
        return t
