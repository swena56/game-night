"""Briscola: the Italian point-trick game with the 40-card deck, for 2-4 players (four play as two teams).

Three cards each; the next card is turned face up under the stock and its suit (the briscola) is trumps.
There's no need to follow suit: the highest trump takes the trick, or else the highest card of the suit
led. Everyone then draws back up to three, the trick's winner first. Points are in the cards taken:
ace 11, three 10, king 4, queen 3, jack 2 (120 in all); over 60 wins the hand."""
import random

from .cardbase import GameError, rank, suit, pretty, SUIT_NAME
from .tricks import TrickGame

ORDER = "24567JQK3A"      # weakest to strongest
POINTS = {"A": 11, "3": 10, "K": 4, "Q": 3, "J": 2}


def pts(c):
    return POINTS.get(rank(c), 0)


class Briscola(TrickGame):
    id = "briscola"
    name = "Briscola"
    icon = "🍷"
    blurb = "Italy's favourite: three cards in hand, no need to follow suit, and the aces and threes carry the points."
    howto = [
        "40 cards. Three in hand; the card under the stock shows the briscola (trumps).",
        "You don't have to follow suit. Highest briscola wins, else the highest of the suit led.",
        "On your turn, the trick preview shows which cards would lead against the cards already played.",
        "Order, high to low: A 3 K Q J 7 6 5 4 2. Draw back up to three after each trick, winner first.",
        "Points: ace 11, three 10, king 4, queen 3, jack 2. Over 60 of the 120 wins the hand.",
        "With four players, partners sit opposite and pool their points.",
        "🔄 Swap (on your turn): hold the 7 of briscola while a stronger card is turned up and the stock still has cards behind it? Trade your 7 for it.",
    ]
    min_players, max_players = 2, 4
    follow = False
    order = ORDER
    badges = {**TrickGame.badges, "carico": ("🎯", "Carico", "Take an opponent's ace with a briscola")}
    settings_schema = {"hands": ("Hands", [(1, "1 hand"), (3, "Best of 3")], 1),
                       "swap": ("🔄 Swap the 7", [(1, "Allowed"), (0, "Off")], 1)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.teams = self.n == 4
        self.wins = [0] * self.n
        self.hand_no = 0
        self.room.add_log("🍷 Briscola! " + (f"{self.nm(0)} & {self.nm(2)} against {self.nm(1)} & {self.nm(3)}." if self.teams else "Over 60 points wins."), "big")
        self.deal()

    def make_deck(self):
        return [r + s for s in "CDHS" for r in "A234567JQK"]

    def deal(self):
        self.hand_no += 1
        cards = self.make_deck()
        if self.n == 3:
            cards.remove("2C")             # 39 cards share out evenly
        self.rng.shuffle(cards)
        self.hands = [cards[k * 3:(k + 1) * 3] for k in range(self.n)]
        self.stock = cards[self.n * 3:]
        self.brisc = self.stock[0]           # turned under the stock: drawn last
        self.stock = self.stock[1:] + [self.brisc]
        self.trump = suit(self.brisc)
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.brisc)} turned, {SUIT_NAME[self.trump]} are briscola.")
        self.first = self.rng.randrange(self.n) if self.hand_no == 1 else (self.first + 1) % self.n
        self.start_tricks(self.first)

    def can_swap(self, i):
        """The trump 7 in hand, on your turn, for a stronger turned-up card with the stock still behind it."""
        if not self.s.get("swap", 1) or self.stage != "play" or self.room.turn != self.pid(i) or len(self.stock) < 2:
            return False
        seven = self.trump_seven()
        return seven in self.hands[i] and ORDER.index(rank(self.brisc)) > ORDER.index("7")

    def pid(self, i):
        return self.seats[i]

    def trump_seven(self):
        return "7" + self.trump

    def swap(self, i):
        seven, up = self.trump_seven(), self.brisc
        self.hands[i].remove(seven)
        self.hands[i].append(up)
        self.sort_hand(i)
        self.brisc = seven
        self.stock[-1] = seven
        self.moment(f"🔄 {self.nm(i)} swapped the 7 for the {pretty(up)}!", "gold", "fanfare")

    def act_other(self, p, i, t, a):
        if t == "swap":
            if not self.can_swap(i):
                raise GameError("You can't swap now.")
            return self.swap(i)
        raise GameError("Unknown action.")

    def bot_move(self, i, level):
        if self.stage == "play" and level != "easy" and self.can_swap(i):
            self.swap(i)
        return super().bot_move(i, level)

    def on_trick(self, w, cards):
        led = self.suit_of(self.last["cards"][0][1])
        for s, c in self.last["cards"]:
            if rank(c) == "A" and s != w and suit(c) != self.trump and any(suit(x) == self.trump for _, x in self.last["cards"] if _ == w):
                if self.pl(w) and (not self.teams or s % 2 != w % 2):
                    self.award(self.pl(w), "carico")
        order = [(w + k) % self.n for k in range(self.n)]
        for k in order:
            if self.stock:
                self.hands[k].append(self.stock.pop(0))
                self.sort_hand(k)

    def score(self, k):
        return sum(pts(c) for c in self.won[k])

    def side_scores(self):
        if self.teams:
            a, b = self.score(0) + self.score(2), self.score(1) + self.score(3)
            return [a, b, a, b]
        return [self.score(k) for k in range(self.n)]

    def end_hand(self):
        sc = self.side_scores()
        top = max(sc)
        best = [k for k in range(self.n) if sc[k] == top]
        if self.teams:
            best = [best[0] % 2]
        if len(best) == 1:
            w = best[0]
            for k in ([w, w + 2] if self.teams else [w]):
                self.wins[k] += 1
            who = f"{self.nm(w)} & {self.nm(w + 2)}" if self.teams else self.nm(w)
            self.room.add_log(f"🧮 {who} take the hand with {top} points.", "big")
        else:
            self.room.add_log(f"🤝 A tie at {top}: nobody takes the hand.", "big")
        need = self.s["hands"] // 2 + 1
        if max(self.wins) >= need or self.hand_no >= self.s["hands"] + 2:
            w = max(range(self.n), key=lambda k: (self.wins[k], sc[k]))
            who = f"{self.nm(w)} & {self.nm((w + 2) % 4)} win" if self.teams else f"{self.nm(w)} wins"
            return self.room.finish(self.pl(w), f"🏆 {who} Briscola with {sc[w]} points!")
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- the bot: points, not just tricks

    def bot_card(self, i, level):
        hand = self.hands[i]
        if level == "easy" and random.random() < 0.5:
            return random.choice(hand)
        t = self.trump
        cost = lambda c: pts(c) * 2 + (8 if suit(c) == t else 0) + self.power(c) * 0.2
        if not self.trick:
            return min(hand, key=cost)
        led = self.suit_of(self.trick[0][1])
        bs, best = self.best_of(self.trick)
        on = sum(pts(c) for _, c in self.trick)
        mate = self.partner(i)
        if mate is not None and bs == mate:
            # partner's winning: feed them points if it's safe (last to play), else play cheap
            last = len(self.trick) == self.n - 1
            if last:
                return max((c for c in hand if suit(c) != t), key=pts, default=min(hand, key=cost))
            return min(hand, key=cost)
        win = [c for c in hand if self.beats(c, best, led)]
        last = len(self.trick) == self.n - 1
        cheap_win = min(win, key=cost) if win else None
        if cheap_win and (on >= 10 or (on >= 3 and suit(cheap_win) != t) or (last and suit(cheap_win) != t and pts(cheap_win) > 0)):
            return cheap_win
        if level == "hard" and cheap_win and on + pts(cheap_win) >= 10 and suit(cheap_win) != t:
            return cheap_win
        return min(hand, key=cost)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None or not hasattr(self, "won") else f"{self.side_scores()[i]} pts"

    def final_scores(self):
        return {pid: self.side_scores()[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        sc = self.side_scores()
        info = [{"count": len(self.hands[k]), "tags": [f"{self.score(k)} pts"], "badge": ("🔵" if k % 2 == 0 else "🟠") if self.teams else ""} for k in range(self.n)]
        rows = [{"seat": k, "value": sc[k], "sub": (f"& {self.nm(k + 2)}" if self.teams else "") + (f" · hands {self.wins[k]}" if self.s["hands"] > 1 else "")}
                for k in (range(2) if self.teams else sorted(range(self.n), key=lambda k: -sc[k]))]
        t = {"info": info, "trump": self.trump, "trumpLabel": f"Briscola: {SUIT_NAME[self.trump]}",
             "piles": [{"cards": [self.brisc] if self.stock else [], "count": len(self.stock), "label": "Stock", "corner": True}],
             "scores": {"title": "Points", "rows": rows, "hint": "A 11 · 3 10 · K 4 · Q 3 · J 2. Over 60 wins."}}
        t.update(self.trick_view(p, i))
        if t["moves"]:
            led = self.suit_of(self.trick[0][1]) if self.trick else None
            t["trickPreview"] = {
                "led": SUIT_NAME[led] if led else None,
                "trump": SUIT_NAME[self.trump],
                "cards": [{"card": pretty(move["card"]),
                           "trump": self.suit_of(move["card"]) == self.trump,
                           "follows": self.suit_of(move["card"]) == led,
                           "leads": self.best_of([*self.trick, (i, move["card"])])[0] == i}
                          for move in t["moves"]],
            }
        if i is not None and self.can_swap(i):
            t["buttons"] = [{"label": f"🔄 Swap 7 for {pretty(self.brisc)}", "a": {"type": "swap"}}]
        return t
