"""Oh Hell (Up and Down the River): bid exactly how many tricks you'll take, for 3-6 players.

The hands shrink from the biggest deal down to one card (or grow, or go down and back up). After the
deal the next card is turned for trumps. Everyone bids, and the dealer, bidding last, may not make the
bids add up to the number of tricks (so someone must miss). Follow suit if you can. Take exactly what
you bid for 10 points plus one a trick; miss by any amount and score nothing. Most points wins."""
import random

from .cardbase import GameError, deck, rank, suit, show, pretty, SUIT_NAME
from .tricks import TrickGame


class OhHell(TrickGame):
    id = "ohhell"
    name = "Oh Hell"
    icon = "🔥"
    blurb = "Bid exactly how many tricks you'll take. One too many is as bad as one too few."
    howto = [
        "Each hand has a different number of cards; the next card is turned up for trumps.",
        "Everyone bids how many tricks they'll take. The dealer bids last and can't make the total come out exact.",
        "Follow suit if you can. Highest trump wins, else the highest card of the suit led.",
        "Take exactly your bid: 10 + 1 per trick. Miss by any amount: 0.",
        "After the last hand, most points wins.",
    ]
    min_players, max_players = 3, 6
    badges = {**TrickGame.badges, "exact": ("🎯", "Sharpshooter", "Make every bid in a whole game")}
    settings_schema = {
        "shape": ("Hands", [("down", "Down: biggest to 1"), ("updown", "Down and back up (long)"), ("up", "Up: 1 to biggest")], "down"),
        "most": ("Biggest hand", [(7, "7 cards"), (10, "10 cards"), (5, "5 cards (quick)")], 7),
        "hook": ("Dealer's hook", [(True, "Bids can't add up exactly"), (False, "Any bid")], True),
    }

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        top = min(self.s.get("most", 7), 51 // self.n)
        down = list(range(top, 0, -1))
        self.plan = {"down": down, "up": down[::-1], "updown": down + down[::-1][1:]}[self.s.get("shape", "down")]
        self.scores = [0] * self.n
        self.made = [0] * self.n
        self.hand_no = 0
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"🔥 Oh Hell: {len(self.plan)} hands ({', '.join(map(str, self.plan))} cards).", "big")
        self.deal()

    def deal(self):
        self.size = self.plan[self.hand_no]
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % self.n
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * self.size:(k + 1) * self.size] for k in range(self.n)]
        rest = cards[self.n * self.size:]
        self.turned = rest[0] if rest else None
        self.trump = suit(self.turned) if self.turned else None
        for k in range(self.n):
            self.sort_hand(k)
        self.bids = [None] * self.n
        self.tricks = [0] * self.n
        self.trick, self.last = [], None
        self.stage = "bid"
        self.room.add_log(f"🃏 Hand {self.hand_no}: {self.size} card{'s' if self.size > 1 else ''}, "
                          + (f"{pretty(self.turned)} turned: {SUIT_NAME[self.trump]} trumps." if self.trump else "no trumps."))
        self.to((self.dealer + 1) % self.n)

    def banned(self, i):
        """The one bid the dealer may not make."""
        if i != self.dealer or not self.s.get("hook", True):
            return None
        b = self.size - sum(x for x in self.bids if x is not None)
        return b if b >= 0 else None

    def hook_note(self):
        """Public forecast of the dealer's hook while the bids are still coming in."""
        if self.stage != "bid" or not self.s.get("hook", True) or self.bids[self.dealer] is not None:
            return ""
        ban = self.banned(self.dealer)
        return f" 🪝 Dealer can't bid {ban}: the total can't reach {self.size}." if ban is not None else f" 🪝 Bids already pass {self.size}: the dealer is free."

    def do_bid(self, i, b):
        self.bids[i] = b
        self.room.add_log(f"📣 {self.nm(i)} bids {b}.")
        if None in self.bids:
            return self.to((i + 1) % self.n)
        total = sum(self.bids)
        self.room.add_log(f"Bids total {total} for {self.size} tricks: {'overbid' if total > self.size else 'underbid'}.")
        self.start_tricks((self.dealer + 1) % self.n)

    def end_hand(self):
        lines = []
        for k in range(self.n):
            ok = self.tricks[k] == self.bids[k]
            pts = 10 + self.tricks[k] if ok else 0
            self.made[k] += ok
            self.scores[k] += pts
            lines.append(f"{self.nm(k)} {self.tricks[k]}/{self.bids[k]} {'✓' if ok else '✗'}")
        self.room.add_log("🧮 " + " · ".join(lines), "big")
        if self.hand_no >= len(self.plan):
            for k in range(self.n):
                if self.made[k] == len(self.plan) and self.pl(k):
                    self.award(self.pl(k), "exact")
            return self.win_by_score(self.scores)
        self.stage = "score"
        self.pause(self.deal, 3.5)

    # -- actions

    def act_other(self, p, i, t, a):
        if t == "bid":
            self.require_turn(p)
            b = a.get("bid")
            if self.stage != "bid" or not isinstance(b, int) or isinstance(b, bool) or not 0 <= b <= self.size:
                raise GameError(f"Bid 0–{self.size}.")
            if b == self.banned(i):
                raise GameError(f"The dealer can't bid {b}: the bids would add up exactly.")
            return self.do_bid(i, b)
        raise GameError("Unknown action.")

    # -- bots

    def estimate(self, i, level):
        hand, t = self.hands[i], self.trump
        est = 0.0
        crowd = (self.n - 1) / 3
        for c in hand:
            r, s = rank(c), suit(c)
            same = sum(1 for x in hand if suit(x) == s)
            if s == t:
                est += {"A": 1, "K": 0.9, "Q": 0.7, "J": 0.5}.get(r, 0.3 if level == "hard" and same >= 3 else 0.15)
            else:
                est += {"A": 0.85, "K": 0.5 if same <= 3 else 0.25}.get(r, 0) / max(1, crowd ** 0.5)
        if t and level != "easy":
            trumps = sum(1 for x in hand if suit(x) == t)
            short = sum(1 for s in "CDHS" if s != t and not any(suit(x) == s for x in hand))
            est += min(trumps, short) * 0.4
        return est

    def bot_other(self, i, level):
        if self.stage != "bid":
            return
        est = self.estimate(i, level)
        if level == "easy":
            est += random.uniform(-1, 1)
        b = max(0, min(self.size, round(est)))
        if b == self.banned(i):
            b = b + 1 if b + 1 <= self.size and (est >= b or b == 0) else b - 1
        self.do_bid(i, b)

    def wants(self, i):
        return self.tricks[i] < self.bids[i]

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]),
                 "tags": [(f"{self.tricks[k]}/{self.bids[k]}" if self.bids[k] is not None and self.stage != "bid" else
                           f"bid {self.bids[k]}" if self.bids[k] is not None else "…") + (" ✓" if self.stage == "play" and self.bids[k] == self.tricks[k] else ""),
                          ] + (["🎴 dealer"] if k == self.dealer else [])} for k in range(self.n)]
        t = {"info": info, "trump": self.turned, "trumpLabel": "Trumps" if self.turned else "No trumps",
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k], "sub": f"made {self.made[k]}"} for k in sorted(range(self.n), key=lambda k: -self.scores[k])],
                        "hint": f"Hand {self.hand_no} of {len(self.plan)} · {self.size} card{'s' if self.size > 1 else ''}. Bids so far: {sum(b for b in self.bids if b is not None)}." + self.hook_note()}}
        t.update(self.trick_view(p, i))
        if self.stage == "bid" and i is not None:
            t["hand"] = self.hands[i]
            if self.room.turn == p.id:
                ban = self.banned(i)
                guess = max(0, min(self.size, round(self.estimate(i, "normal"))))
                t["buttons"] = [{"label": str(b), "a": {"type": "bid", "bid": b}, "kind": "primary" if b == guess else ""}
                                for b in range(self.size + 1) if b != ban]
                t["note"] = f"Bid your tricks (0–{self.size})." + (f" As dealer you can't bid {ban}." if ban is not None else "")
                t["turnText"] = "📣 Your bid"
        return t
