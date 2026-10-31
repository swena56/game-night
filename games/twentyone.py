"""Twenty-One: the traditional casino card game, everyone against a dealer bot.

Each hand: everyone bets at once, then takes turns to hit, stand or double down (one card, doubled
bet) on two cards. Go over 21 and you bust. The dealer then reveals the hole card and draws to 17
(standing on every 17). Beat the dealer and you win your bet; a two-card 21 pays 3 to 2; a tie gets
your bet back. Four decks, reshuffled when they run low; no splitting. Most chips after the last
hand wins (playing alone, finish ahead of the 100 you started with)."""
import random
import time

from .base import Game, GameError

RANKS = "A23456789TJQK"
SUITS = "SHDC"
START_CHIPS = 100
BETS = (5, 10, 25)
DEALER_STEP = 0.9   # seconds between dealer cards
SETTLE_SECS = 3.5   # pause on the results


def total(cards):
    """(best total, soft) — soft when an ace counts as 11."""
    t = sum(10 if c[0] in "TJQK" else 1 if c[0] == "A" else int(c[0]) for c in cards)
    if any(c[0] == "A" for c in cards) and t + 10 <= 21:
        return t + 10, True
    return t, False


def natural(cards):
    return len(cards) == 2 and total(cards)[0] == 21


def pretty(c):
    return ("10" if c[0] == "T" else c[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[c[1]]


class TwentyOne(Game):
    id = "twentyone"
    category = "dice"
    howto = [
        "Everyone bets at once, then plays against the dealer: Hit for a card, Stand to stop, or Double (one card, double bet) on your first two.",
        "Get closer to 21 than the dealer without going over. Picture cards are 10, aces 1 or 11.",
        "The dealer draws to 17. Beat them to win your bet; a two-card 21 pays 3 to 2; a tie gives your bet back.",
        "Most chips after the last hand wins. Alone, finish ahead of your starting 100.",
    ]
    name = "Twenty-One"
    icon = "🂡"
    blurb = "The classic against-the-dealer card game: hit, stand or double, and leave with the most chips."
    min_players = 1
    max_players = 6
    settings_schema = {
        "hands": ("Hands", [(8, "8"), (5, "5 (quick)"), (12, "12")], 8),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.chips = [START_CHIPS] * len(seated)
        self.shoe = []
        self.hand_no = 0
        self.room.add_log(f"🂡 Twenty-One! {self.s['hands']} hands, {START_CHIPS} chips each.", "big")
        self.new_hand()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def draw(self):
        if len(self.shoe) < 52:
            self.shoe = [r + s for _ in range(4) for s in SUITS for r in RANKS]
            self.rng.shuffle(self.shoe)
            self.room.add_log("🔀 Fresh shoe.")
        return self.shoe.pop()

    def live(self, i):
        p = self.pl(i)
        return p is not None and not p.eliminated and self.chips[i] > 0

    def new_hand(self):
        r = self.room
        self.hand_no += 1
        n = len(self.seats)
        self.bets = [0] * n
        self.cards = [[] for _ in range(n)]
        self.done = [False] * n
        self.result = [None] * n   # text per seat once settled
        self.dealer = []
        self.stage = "bet"
        r.turn = None
        r.deadline = time.time() + r.settings["timer"] if r.settings["timer"] else None
        r.bot_at = time.time() + random.uniform(0.8, 1.6)
        r.add_log(f"🂡 Hand {self.hand_no}/{self.s['hands']}: place your bets.")

    # -- betting

    def bet(self, i, amount):
        self.bets[i] = min(amount, self.chips[i])
        if all(self.bets[j] or not self.live(j) for j in range(len(self.seats))):
            self.deal()

    def deal(self):
        n = len(self.seats)
        for _ in range(2):
            for i in range(n):
                if self.bets[i]:
                    self.cards[i].append(self.draw())
            self.dealer.append(self.draw())
        self.stage = "play"
        if natural(self.dealer):
            self.room.add_log(f"😮 The dealer has twenty-one: {' '.join(pretty(c) for c in self.dealer)}.", "power")
            return self.settle()
        for i in range(n):
            if self.bets[i] and natural(self.cards[i]):
                self.done[i] = True
                p = self.pl(i)
                self.room.add_log(f"🎉 {p.name if p else '?'} has twenty-one!", "power")
        self.next_player(-1)

    # -- playing

    def next_player(self, after):
        for i in range(after + 1, len(self.seats)):
            if self.bets[i] and not self.done[i]:
                return self.room.begin_turn(self.seats[i])
        self.dealer_turn()

    def hit(self, i):
        p = self.pl(i)
        c = self.draw()
        self.cards[i].append(c)
        t, _ = total(self.cards[i])
        self.room.add_log(f"🃏 {p.name if p else '?'} hits: {pretty(c)} → {t}" + (" — bust!" if t > 21 else ""),
                          "power" if t > 21 else "question")
        if t >= 21:
            self.done[i] = True
            self.next_player(i)

    def stand(self, i):
        p = self.pl(i)
        self.done[i] = True
        self.room.add_log(f"✋ {p.name if p else '?'} stands on {total(self.cards[i])[0]}.", "question")
        self.next_player(i)

    def double(self, i):
        p = self.pl(i)
        self.bets[i] *= 2
        c = self.draw()
        self.cards[i].append(c)
        t, _ = total(self.cards[i])
        self.room.add_log(f"💰 {p.name if p else '?'} doubles: {pretty(c)} → {t}" + (" — bust!" if t > 21 else ""), "power")
        self.done[i] = True
        self.next_player(i)

    def can_double(self, i):
        return len(self.cards[i]) == 2 and self.chips[i] >= 2 * self.bets[i]

    def dealer_turn(self):
        r = self.room
        self.stage = "dealer"
        r.turn = None
        r.add_log(f"🎩 Dealer shows {' '.join(pretty(c) for c in self.dealer)} ({total(self.dealer)[0]}).")
        if all(total(self.cards[i])[0] > 21 or natural(self.cards[i]) for i in range(len(self.seats)) if self.bets[i]):
            return self.settle()  # nothing left to play for
        r.deadline = time.time() + DEALER_STEP

    def dealer_step(self):
        if total(self.dealer)[0] < 17:
            c = self.draw()
            self.dealer.append(c)
            t = total(self.dealer)[0]
            self.room.add_log(f"🎩 Dealer draws {pretty(c)} → {t}" + (" — bust!" if t > 21 else ""))
            if t < 17:
                self.room.deadline = time.time() + DEALER_STEP
                return
        self.settle()

    def settle(self):
        r = self.room
        d, dnat = total(self.dealer)[0], natural(self.dealer)
        parts = []
        for i in range(len(self.seats)):
            b = self.bets[i]
            if not b:
                continue
            t = total(self.cards[i])[0]
            if t > 21:
                delta, text = -b, "bust"
            elif natural(self.cards[i]) and not dnat:
                delta, text = b * 3 // 2, "twenty-one!"
            elif dnat and not natural(self.cards[i]):
                delta, text = -b, "lost"
            elif d > 21 or t > d:
                delta, text = b, "won"
            elif t == d:
                delta, text = 0, "push"
            else:
                delta, text = -b, "lost"
            self.chips[i] += delta
            self.result[i] = [text, delta]
            p = self.pl(i)
            parts.append(f"{p.name if p else '?'} {'+' if delta >= 0 else ''}{delta}")
        r.add_log(f"🧮 Dealer {d}{' (bust)' if d > 21 else ''}: " + " · ".join(parts), "big")
        self.stage = "settle"
        r.turn = None
        r.deadline = time.time() + SETTLE_SECS

    def finish_game(self):
        r = self.room
        names = [self.pl(i).name if self.pl(i) else "?" for i in range(len(self.seats))]
        if len(self.seats) == 1:
            c = self.chips[0]
            if c > START_CHIPS:
                return r.finish(self.pl(0), f"🏆 {names[0]} leaves the table with {c} chips (+{c - START_CHIPS})!")
            return r.finish(None, f"🎩 The house wins: {names[0]} leaves with {c} chips.")
        order = sorted(range(len(self.seats)), key=lambda i: -self.chips[i])
        text = " · ".join(f"{names[i]} {self.chips[i]}" for i in order)
        if self.chips[order[0]] == self.chips[order[1]]:
            return r.finish(None, f"🤝 A tie at the top! {text}")
        r.finish(self.pl(order[0]), f"🏆 {names[order[0]]} wins with {self.chips[order[0]]} chips! {text}")

    # -- actions

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        t = a.get("type")
        if t == "bet":
            amount = a.get("amount")
            if self.stage != "bet" or self.bets[i]:
                raise GameError("Bets are in.")
            if amount not in BETS or not self.chips[i]:
                raise GameError("Bet 5, 10 or 25.")
            return self.bet(i, amount)
        if t in ("hit", "stand", "double"):
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait for your turn.")
            if t == "double" and not self.can_double(i):
                raise GameError("You can only double on your first two cards, with enough chips.")
            return getattr(self, t)(i)
        raise GameError("Unknown action.")

    def on_timeout(self):
        r = self.room
        if self.stage == "settle":
            busted = [i for i in range(len(self.seats)) if self.chips[i] <= 0 and self.pl(i) and not self.pl(i).eliminated]
            if self.hand_no >= self.s["hands"] or not any(self.live(i) for i in range(len(self.seats))):
                return self.finish_game()
            for i in busted:
                if self.result[i]:
                    r.add_log(f"💸 {self.pl(i).name} is out of chips.", "power")
            return self.new_hand()
        if self.stage == "dealer":
            return self.dealer_step()
        if self.stage == "bet":
            for i in range(len(self.seats)):
                if self.live(i) and not self.bets[i]:
                    self.bet(i, BETS[0] if not self.auto(i) else self.bot_bet(i))
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.pl(i).name} ran out of time and stands.", "power")
        self.stand(i)

    def on_leave(self, p):
        r = self.room
        i = self.seat(p)
        p.eliminated = True
        r.add_log(f"{p.name} left the table.")
        left = r.contenders()
        if len(self.seats) > 1 and len(left) < 1:
            return r.finish(None, "Everyone left.")
        if i is None:
            return
        if self.stage == "bet" and not self.bets[i]:
            if all(self.bets[j] or not self.live(j) for j in range(len(self.seats))) and any(self.bets):
                self.deal()
        elif self.stage == "play" and r.turn == p.id:
            self.stand(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🪙 {self.chips[i]}"

    def final_scores(self):
        return {pid: self.chips[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        reveal = self.stage in ("dealer", "settle") or self.room.phase == "over"
        dealer = self.dealer if reveal else self.dealer[:1] + (["??"] if len(self.dealer) > 1 else [])
        mine = self.room.turn == p.id and self.stage == "play"
        return {"twentyone": {
            "seats": self.seats, "me": i, "stage": self.stage, "hand": self.hand_no, "hands": self.s["hands"],
            "chips": self.chips, "bets": self.bets, "cards": self.cards, "dealer": dealer,
            "totals": [total(c)[0] if c else 0 for c in self.cards],
            "dealerTotal": total(self.dealer)[0] if reveal and self.dealer else (total(self.dealer[:1])[0] if self.dealer else 0),
            "result": self.result, "canDouble": mine and self.can_double(i), "betOptions": list(BETS),
        }}

    # -- bots

    def auto(self, i):
        p = self.pl(i)
        return p is None or bool(p.bot) or p.eliminated

    def level(self, i):
        p = self.pl(i)
        return p.bot if p and p.bot else "normal"

    def bot_ready(self):
        if self.room.phase != "playing":
            return False
        if self.stage == "bet":
            return any(self.live(i) and self.auto(i) and not self.bets[i] for i in range(len(self.seats)))
        if self.stage == "play" and self.room.turn in self.seats:
            return self.auto(self.seats.index(self.room.turn))
        return False

    def bot_tick(self):
        if self.stage == "bet":
            for i in range(len(self.seats)):
                if self.stage == "bet" and self.live(i) and self.auto(i) and not self.bets[i]:
                    self.bet(i, self.bot_bet(i))
            return
        i = self.seats.index(self.room.turn)
        move = self.bot_move(i, self.level(i))
        if move == "double" and not self.can_double(i):
            move = "hit"
        getattr(self, move)(i)

    def bot_bet(self, i):
        lv = self.level(i)
        if lv == "easy":
            return random.choice(BETS)
        return 10 if self.chips[i] >= 40 or lv == "normal" else 5

    def bot_move(self, i, level):
        t, soft = total(self.cards[i])
        up = self.dealer[0][0]
        d = 11 if up == "A" else 10 if up in "TJQK" else int(up)
        if level == "easy":
            return "hit" if t < 15 else "stand"
        if level == "normal":
            if t <= 11:
                return "double" if t == 11 and len(self.cards[i]) == 2 else "hit"
            if soft and t <= 17:
                return "hit"
            if t >= 17 or (t >= 13 and d <= 6):
                return "stand"
            return "hit"
        # hard: basic strategy (no splits)
        two = len(self.cards[i]) == 2
        if soft:
            if t >= 19:
                return "stand"
            if t == 18:
                if two and 3 <= d <= 6:
                    return "double"
                return "stand" if d in (2, 7, 8) or 3 <= d <= 6 else "hit"
            if two and ((t == 17 and 3 <= d <= 6) or (t in (15, 16) and 4 <= d <= 6) or (t in (13, 14) and 5 <= d <= 6)):
                return "double"
            return "hit"
        if t >= 17:
            return "stand"
        if t >= 13:
            return "stand" if d <= 6 else "hit"
        if t == 12:
            return "stand" if 4 <= d <= 6 else "hit"
        if two and (t == 11 or (t == 10 and d <= 9) or (t == 9 and 3 <= d <= 6)):
            return "double"
        return "hit"
