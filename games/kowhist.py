"""Knock Out Whist: the trick-taking game that knocks players out, for 2-6 players.

Hand one deals seven cards each and turns up the next card for trumps. Follow suit if you can; the
highest trump, or else the highest card of the suit led, takes the trick. Take no tricks in a hand and
you're knocked out. Whoever took the most tricks picks trumps for the next hand and leads it, and each
hand has one card fewer. Take every trick of a hand, or be the last one in, to win."""
import random

from .cardbase import GameError, deck, rank, suit, show, SUIT_NAME, GLYPH
from .tricks import TrickGame


class KnockOutWhist(TrickGame):
    id = "kowhist"
    solo_bots = 3
    name = "Knock Out Whist"
    icon = "🥊"
    blurb = "Win at least one trick or you're out. Each hand has one card fewer, and the most tricks picks trumps."
    howto = [
        "Seven cards each in the first hand; the next card turned up is trumps.",
        "Follow suit if you can. Highest trump wins the trick, else the highest card of the suit led.",
        "Win no tricks in a hand and you're knocked out 🥊.",
        "Most tricks picks trumps for the next hand and leads. Each hand has one card fewer.",
        "Take every trick of a hand, or be the last one in, and you win.",
    ]
    min_players, max_players = 2, 6
    badges = {**TrickGame.badges, "sweep": ("🧹", "Clean sweep", "Win every trick of a hand")}
    settings_schema = {"start": ("First hand", [(7, "7 cards"), (5, "5 cards (quick)")], 7)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.knocked = [False] * self.n
        self.size = self.s.get("start", 7)
        self.trump = None
        self.chooser = None
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"🥊 Knock Out Whist: {self.size} cards. Win a trick or you're out!", "big")
        self.deal()

    def is_out(self, i):
        return self.knocked[i]

    def deal(self):
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [[] for _ in range(self.n)]
        for k in self.in_hand():
            self.hands[k], cards = cards[:self.size], cards[self.size:]
        self.turned = None
        if self.chooser is None:
            self.turned = cards[0]
            self.trump = suit(self.turned)
            self.room.add_log(f"🃏 {self.size} cards each. {pretty_card(self.turned)} turned: {SUIT_NAME[self.trump]} are trumps.")
            self.start_tricks(self.next_seat(self.dealer))
        else:
            self.stage = "trump"
            for k in self.in_hand():
                self.sort_hand(k)
            self.room.add_log(f"🃏 {self.size} cards each. {self.nm(self.chooser)} picks trumps.")
            self.to(self.chooser)

    def pick_trump(self, i, s):
        self.trump = s
        self.room.add_log(f"🎺 {self.nm(i)} picks {SUIT_NAME[s]} {GLYPH[s]} as trumps.")
        self.start_tricks(i)

    def end_hand(self):
        r = self.room
        alive = self.in_hand()
        for k in alive:
            if self.tricks[k] == self.size and len(alive) > 1:
                if self.pl(k):
                    self.award(self.pl(k), "sweep")
                return r.finish(self.pl(k), f"🧹 {self.nm(k)} takes every trick and wins Knock Out Whist!")
        for k in alive:
            if self.tricks[k] == 0:
                self.knocked[k] = True
                self.moment(f"🥊 {self.nm(k)} is knocked out!", "bad", "groan")
        alive = self.in_hand()
        if len(alive) == 1:
            return r.finish(self.pl(alive[0]), f"🏆 {self.nm(alive[0])} is the last one standing and wins Knock Out Whist!")
        top = max(self.tricks[k] for k in alive)
        best = [k for k in alive if self.tricks[k] == top]
        self.chooser = self.rng.choice(best)
        self.size -= 1
        if self.size == 0:
            return r.finish(self.pl(self.chooser), f"🏆 {self.nm(self.chooser)} wins the last trick and Knock Out Whist!")
        self.room.add_log(" · ".join(f"{self.nm(k)} {self.tricks[k]}" for k in alive) + f". {self.nm(self.chooser)} picks trumps.")
        self.stage = "score"
        self.pause(self.deal, 2.5)

    # -- actions and bots

    def act_other(self, p, i, t, a):
        if t == "trump":
            self.require_turn(p)
            if self.stage != "trump" or a.get("suit") not in "CDHS" or len(str(a.get("suit"))) != 1:
                raise GameError("Pick a suit.")
            return self.pick_trump(i, a["suit"])
        raise GameError("Unknown action.")

    def bot_other(self, i, level):
        if self.stage == "trump":
            self.pick_trump(i, best_suit(self.hands[i], self.order, level))

    def wants(self, i):
        return True

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else ("🥊 out" if self.knocked[i] else f"🂠 {self.tricks[i] if hasattr(self, 'tricks') and self.stage == 'play' else 0} tricks")

    def final_scores(self):
        return {pid: (0 if self.knocked[k] else 1) for k, pid in enumerate(self.seats)}

    def safety(self, i):
        """Whether the viewer has already dodged the knock-out this hand."""
        if self.knocked[i]:
            return ""
        left = len(self.hands[i])
        if self.tricks[i]:
            return f" ✅ Safe: you've won {self.tricks[i]}."
        return " ⚠️ No trick yet: win one or you're out!" if left > 1 else " 🚨 Last card, no trick yet: win this or you're out!"

    def table(self, p, i):
        play = self.stage == "play"
        info = [{"count": len(self.hands[k]) if not self.knocked[k] else None, "out": self.knocked[k],
                 "tags": ["🥊 out"] if self.knocked[k] else [f"🂠 {self.tricks[k] if play else 0}"]} for k in range(self.n)]
        t = {"info": info, "trump": self.trump if self.stage != "trump" else None,
             "scores": {"title": "Still in", "rows": [{"seat": k, "value": "out" if self.knocked[k] else (self.tricks[k] if play else 0), "sub": ""}
                                                      for k in range(self.n)], "hint": f"This hand: {self.size} cards. No tricks = knocked out."}}
        t.update(self.trick_view(p, i))
        if self.turned and play and not any(self.tricks) and not self.trick:
            t["piles"] = [{"cards": [self.turned], "label": "Turned for trumps", "corner": True}]
        if self.stage == "trump" and i == self.chooser and self.room.turn == p.id:
            t["buttons"] = [{"label": f"{GLYPH[s]} {SUIT_NAME[s].title()}", "a": {"type": "trump", "suit": s}, "kind": "primary"} for s in "SHDC"]
            t["note"] = "You took the most tricks: pick trumps for this hand."
            t["turnText"] = "🎺 Pick trumps"
        elif self.stage == "trump":
            t["note"] = f"{self.nm(self.chooser)} is picking trumps…"
        elif play and i is not None and self.room.turn == p.id:
            t["note"] = ("Your lead." if not self.trick else "Follow suit if you can.") + self.safety(i)
        elif play and i is not None and not self.knocked[i]:
            t["note"] = self.safety(i).strip()
        return t


def pretty_card(c):
    from .cardbase import pretty
    return pretty(c)


def best_suit(hand, order, level):
    """The suit worth calling trumps: length first, then high cards."""
    if level == "easy" and random.random() < 0.4:
        return random.choice("CDHS")
    def worth(s):
        cs = [c for c in hand if suit(c) == s]
        return len(cs) * 2 + sum(max(0, order.index(rank(c)) - 7) for c in cs) * 0.5
    return max("SHDC", key=worth)
