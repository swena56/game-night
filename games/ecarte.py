"""Écarté: the French two-player trick game of five tricks, with exchanges. Two players.

A 32-card deck where the king is top: K Q J A 10 9 8 7. Five cards each, and the next is turned for
trumps (a turned king scores the dealer a point). Before play the non-dealer may play as dealt, or
propose an exchange; if the dealer accepts, both discard what they like and draw fresh cards, and the
non-dealer may propose again. Holding the trump king scores a point. In play you must follow suit and
win the trick if you can, and trump if you can't follow. Take three tricks for a point, all five (the
vole) for two. Play without proposing and lose, or refuse a proposal and lose, and your rival scores
two. First to five points wins."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame


class Ecarte(TrickGame):
    id = "ecarte"
    name = "Écarté"
    icon = "🤵"
    blurb = "Five cards, five tricks, king high. Propose an exchange, or dare to play as dealt."
    howto = [
        "32 cards, king high: K Q J A 10 9 8 7. Five each; the turned card sets trumps (a turned king: dealer +1).",
        "The non-dealer plays as dealt or proposes; if the dealer accepts, both swap any cards for fresh ones.",
        "Holding the trump king scores 1. Follow suit and win the trick if you can; trump if you can't follow.",
        "Three tricks score 1, all five score 2. Lose after playing as dealt, or after refusing, and they score 2.",
        "An option: Bold, play as dealt and win the hand and you score 1 extra.",
        "First to five points wins.",
    ]
    min_players, max_players = 2, 2
    order = "789TAJQK"
    badges = {**TrickGame.badges, "vole": ("🕊️", "La vole", "Take all five tricks")}
    settings_schema = {"target": ("Play to", [(5, "5 points"), (3, "3 (quick)"), (7, "7 points")], 5),
                       "bold": ("🎩 Bold bonus", [(1, "On"), (0, "Off")], 1)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(2)
        self.hand_no = 0
        self.room.add_log(f"🎩 Écarté to {self.s['target']}. King is high.", "big")
        self.deal()

    def make_deck(self):
        return deck(self.order)

    def deal(self):
        self.hand_no += 1
        self.dealer = 1 - self.dealer
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[:5], cards[5:10]]
        self.turned = cards[10]
        self.stock = cards[11:]
        self.trump = suit(self.turned)
        self.trick, self.last, self.tricks = [], None, [0, 0]
        self.proposed = False
        self.refused = None
        self.played_dealt = None
        self.result = None
        self.chosen = [None, None]
        for k in (0, 1):
            self.sort_hand(k)
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.turned)} turned, {SUIT_NAME[self.trump]} are trumps.")
        if rank(self.turned) == "K":
            self.add(self.dealer, 1, "the turned king")
            if self.room.phase != "playing":
                return
        self.stage = "propose"
        self.to(1 - self.dealer)

    def add(self, k, n, why):
        self.score[k] += n
        self.room.add_log(f"👑 {self.nm(k)} +{n} for {why}.", "power")
        if self.score[k] >= self.s["target"]:
            self.room.finish(self.pl(k), f"🏆 {self.nm(k)} wins Écarté {self.score[k]}–{self.score[1 - k]}!")

    # -- the exchange

    def begin_play(self):
        for k in (0, 1):
            if ("K" + self.trump) in self.hands[k]:
                self.add(k, 1, "the king of trumps")
                if self.room.phase != "playing":
                    return
        self.start_tricks(1 - self.dealer)

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        nd = 1 - self.dealer
        if self.stage == "propose" and i == nd and t in ("play_dealt", "propose"):
            return self.decide(i, t == "propose")
        if self.stage == "accept" and i == self.dealer and t in ("accept", "refuse"):
            return self.answer(i, t == "accept")
        if self.stage == "discard" and t == "discard":
            cards = a.get("cards")
            if not isinstance(cards, list) or not 1 <= len(cards) <= 5 or len(set(cards)) != len(cards) or any(c not in self.hands[i] for c in cards):
                raise GameError("Pick one to five cards to swap.")
            return self.discard(i, cards)
        raise GameError("Not now.")

    def decide(self, i, propose):
        if not propose:
            if not self.proposed:
                self.played_dealt = i
            self.room.add_log(f"✋ {self.nm(i)} plays" + (" as dealt!" if not self.proposed else "."))
            return self.begin_play()
        self.proposed = True
        self.room.add_log(f"🔄 {self.nm(i)} proposes an exchange.")
        self.stage = "accept"
        self.to(self.dealer)

    def answer(self, i, ok):
        if not ok:
            self.refused = i
            self.room.add_log(f"🙅 {self.nm(i)} refuses!", "power")
            return self.begin_play()
        self.room.add_log(f"👍 {self.nm(i)} accepts.")
        self.stage = "discard"
        self.to(1 - self.dealer)

    def discard(self, i, cards):
        if len(cards) > len(self.stock):
            raise GameError(f"Only {len(self.stock)} cards are left in the stock.")
        for c in cards:
            self.hands[i].remove(c)
        self.hands[i] += self.stock[:len(cards)]
        self.stock = self.stock[len(cards):]
        self.sort_hand(i)
        self.room.add_log(f"🔄 {self.nm(i)} swaps {len(cards)}.")
        if i != self.dealer:
            if not self.stock:
                return self.begin_play()
            self.to(self.dealer)
            return
        if not self.stock:
            self.room.add_log("📭 The stock is empty: play!")
            return self.begin_play()
        self.stage = "propose"
        self.to(1 - self.dealer)

    # -- rules

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick:
            return hand[:]
        led = self.trick[0][1]
        same = [c for c in hand if suit(c) == suit(led)]
        if same:
            return [c for c in same if self.power(c) > self.power(led)] or same
        return [c for c in hand if suit(c) == self.trump] or hand[:]

    def end_hand(self):
        w = 0 if self.tricks[0] > self.tricks[1] else 1
        lose = 1 - w
        if self.tricks[w] == 5:
            pts, why = 2, "la vole (all five)"
            if self.pl(w):
                self.award(self.pl(w), "vole")
        elif self.played_dealt == lose or self.refused == lose:
            pts, why = 2, f"{self.tricks[w]} tricks; {self.nm(lose)} " + ("played as dealt" if self.played_dealt == lose else "refused")
        else:
            pts, why = 1, f"{self.tricks[w]} tricks"
        bold = w == self.played_dealt and self.s.get("bold", 1)  # old rooms have no setting: on
        if bold:
            pts, why = pts + 1, why + ", bold bonus for playing as dealt"
        self.result = f"🏅 {self.nm(w)} +{pts}: {why}"
        self.room.add_log(self.result, "big")
        if bold:
            self.moment(f"🎩 Bold! {self.nm(w)} played as dealt and won: +1 extra", "gold", "fanfare")
        elif pts == 2:
            self.moment(self.result, "gold", "fanfare")
        self.score[w] += pts
        if self.score[w] >= self.s["target"]:
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} wins Écarté {self.score[w]}–{self.score[lose]}!")
        self.stage = "score"
        self.pause(self.deal, 3.5)

    # -- bot

    def worth(self, i, hand=None):
        hand = hand or self.hands[i]
        t = self.trump
        v = 0.0
        for c in hand:
            p = self.power(c)
            if suit(c) == t:
                v += 1.0 if p >= 6 else 0.75 if p >= 4 else 0.55
            else:
                v += 0.6 if p == 7 else 0.4 if p == 6 else 0.2 if p >= 4 else 0.05
        return v

    def keepers(self, i):
        t = self.trump
        return [c for c in self.hands[i] if suit(c) == t or self.power(c) >= 5]

    def bot_other(self, i, level):
        w = self.worth(i) + (random.uniform(-0.6, 0.6) if level == "easy" else 0)
        bar = 2.7 if level == "hard" else 3.0
        if self.stage == "propose":
            return self.decide(i, w < bar)
        if self.stage == "accept":
            return self.answer(i, w < bar + (0.2 if level == "hard" else 0))
        if self.stage == "discard":
            keep = self.keepers(i)
            out = [c for c in self.hands[i] if c not in keep][:len(self.stock)]
            if not out:
                out = [min(self.hands[i], key=lambda c: (suit(c) == self.trump, self.power(c)))]
            return self.discard(i, out[:max(1, len(self.stock))])

    def bot_card(self, i, level):
        legal = self.legal(i)
        t = self.trump
        if self.trick or level == "easy":
            return super().bot_card(i, level)
        # leading: a king or boss card first, else trumps when long in them, else the lowest
        boss = [c for c in legal if self.is_boss(i, c, level)]
        if boss:
            return max(boss, key=lambda c: (suit(c) == t, self.power(c)))
        trumps = [c for c in legal if suit(c) == t]
        if len(trumps) >= 3:
            return max(trumps, key=self.power)
        plain = [c for c in legal if suit(c) != t] or legal
        return max(plain, key=self.power) if level == "hard" else min(plain, key=self.power)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i]} pts"

    def final_scores(self):
        return {pid: self.score[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": (["dealer"] if k == self.dealer else []) +
                 ([f"{self.tricks[k]} tricks"] if self.stage in ("play", "score") else [])} for k in (0, 1)]
        t = {"info": info, "trump": self.trump,
             "piles": [{"cards": [self.turned], "label": "Turned"}, {"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Stock"}],
             "banner": self.result if self.stage == "score" else None,
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.score[k]} for k in (0, 1)],
                        "hint": f"To {self.s['target']} · K Q J A 10 9 8 7"}}
        t.update(self.trick_view(p, i))
        if i is None or self.room.turn != p.id:
            return t
        if self.stage == "propose":
            t["buttons"] = [{"label": "🔄 Propose an exchange", "a": {"type": "propose"}, "kind": "primary"},
                            {"label": "✋ Play" + (" as dealt" if not self.proposed else ""), "a": {"type": "play_dealt"}}]
            t["note"] = "Happy with your cards? Play as dealt; but lose and they score 2."
            t["turnText"] = "🎩 Play or propose?"
        elif self.stage == "accept":
            t["buttons"] = [{"label": "👍 Accept", "a": {"type": "accept"}, "kind": "primary"},
                            {"label": "🙅 Refuse", "a": {"type": "refuse"}}]
            t["note"] = "They want to swap cards. Refuse and lose, and they score 2."
            t["turnText"] = "🎩 Accept the exchange?"
        elif self.stage == "discard":
            t["pick"] = {"act": "discard", "min": 1, "max": min(5, len(self.stock)), "label": "Swap these"}
            t["note"] = f"Pick the cards to swap ({len(self.stock)} left in the stock)."
            t["turnText"] = "🔄 Swap cards"
        return t
