"""Blackjack (Twenty-One): the casino card game, everyone against a dealer bot.

Each hand: everyone builds a bet from chips (any multiple of 5 up to their stack) at once, then takes turns to hit, stand or double down (one card, doubled
bet) on two cards, or split a pair into two hands (up to four). Go over 21 and you bust. The dealer then reveals the hole card and draws to 17
(standing on every 17). Beat the dealer and you win your bet; a two-card 21 pays 3 to 2; a tie gets
your bet back. Split aces get one card each, and a 21 after a split pays even money. Four decks,
reshuffled when they run low. Most chips after the last
hand wins (playing alone, finish ahead of the 100 you started with)."""
import random
import time

from .base import Game, GameError

RANKS = "A23456789TJQK"
SUITS = "SHDC"
START_CHIPS = 100
BETS = (5, 10, 25, 50, 100)  # the chips a bet is built from
MIN_BET = 5
MAX_HANDS = 4      # a seat can split up to three times
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


def value(c):
    return 10 if c[0] in "TJQK" else 11 if c[0] == "A" else int(c[0])


def pretty(c):
    return ("10" if c[0] == "T" else c[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[c[1]]


class TwentyOne(Game):
    id = "twentyone"
    category = "dice"
    howto = [
        "Everyone stacks up a bet at once (tap chips, then Deal; ↺ repeats your last bet), then plays against the dealer: Hit for a card, Stand to stop, or Double (one card, double bet) on your first two.",
        "Two cards of the same value? ✂️ Split them into two hands, each with its own bet (up to four hands). Split aces get one card each.",
        "Get closer to 21 than the dealer without going over. Picture cards are 10, aces 1 or 11.",
        "The dealer draws to 17. Beat them to win your bet; a two-card 21 pays 3 to 2; a tie gives your bet back.",
        "Most chips after the last hand wins. Alone, finish ahead of your starting 100.",
    ]
    name = "Blackjack"
    badges = {**Game.badges, "charlie": ("🎩", "Five-card Charlie", "Win a hand holding five cards or more")}
    icon = "♦️"
    blurb = "Twenty-One against the dealer: build your bet, then hit, stand, double or split, and leave with the most chips."
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
        self.last_bet = [0] * len(seated)
        self.room.add_log(f"♦️ Blackjack! {self.s['hands']} hands, {START_CHIPS} chips each.", "big")
        self.new_hand()

    def __setstate__(self, state):  # games saved before splitting kept one card list per seat
        if "hands" not in state and "cards" in state:
            state["hands"] = [[{"cards": c, "bet": b, "done": d, "res": None}] if c else []
                              for c, b, d in zip(state.pop("cards"), state["bets"], state.pop("done"))]
            state["cur"] = [0] * len(state["hands"])
        state.setdefault("last_bet", list(state.get("bets", [])))
        self.__dict__.update(state)

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
        self.bets = [0] * n          # the bet placed this hand
        self.hands = [[] for _ in range(n)]  # per seat: [{"cards", "bet", "done", "res"}], more than one after a split
        self.cur = [0] * n           # the hand each seat is playing
        self.result = [None] * n   # text per seat once settled
        self.dealer = []
        self.stage = "bet"
        r.turn = None
        r.deadline = time.time() + r.settings["timer"] if r.settings["timer"] else None
        r.bot_at = time.time() + random.uniform(0.8, 1.6)
        r.add_log(f"♦️ Hand {self.hand_no}/{self.s['hands']}: place your bets.")

    # -- betting

    def bet(self, i, amount):
        self.bets[i] = min(amount, self.chips[i])
        self.last_bet[i] = self.bets[i]
        if all(self.bets[j] or not self.live(j) for j in range(len(self.seats))):
            self.deal()

    def valid_bet(self, i, amount):
        if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0 or amount > self.chips[i]:
            return False
        return amount == self.chips[i] or (amount >= MIN_BET and amount % MIN_BET == 0)  # all-in is always allowed

    def deal(self):
        n = len(self.seats)
        for _ in range(2):
            for i in range(n):
                if self.bets[i]:
                    if not self.hands[i]:
                        self.hands[i].append({"cards": [], "bet": self.bets[i], "done": False, "res": None})
                    self.hands[i][0]["cards"].append(self.draw())
            self.dealer.append(self.draw())
        self.stage = "play"
        if natural(self.dealer):
            self.room.add_log(f"😮 The dealer has blackjack: {' '.join(pretty(c) for c in self.dealer)}.", "power")
            return self.settle()
        for i in range(n):
            if self.bets[i] and natural(self.hands[i][0]["cards"]):
                self.hands[i][0]["done"] = True
                p = self.pl(i)
                self.room.add_log(f"🎉 {p.name if p else '?'} has blackjack!", "power")
        self.next_player(-1)

    # -- playing

    def hand(self, i):
        return self.hands[i][self.cur[i]]

    def committed(self, i):
        return sum(h["bet"] for h in self.hands[i])

    def is_natural(self, i, h):
        return len(self.hands[i]) == 1 and natural(h["cards"])  # a 21 after a split is just 21

    def next_player(self, after):
        for i in range(after + 1, len(self.seats)):
            if self.bets[i] and not all(h["done"] for h in self.hands[i]):
                self.cur[i] = next(k for k, h in enumerate(self.hands[i]) if not h["done"])
                return self.room.begin_turn(self.seats[i])
        self.dealer_turn()

    def advance(self, i):
        """The current hand is done: play this seat's next split hand, or pass to the next seat."""
        for k, h in enumerate(self.hands[i]):
            if not h["done"]:
                if total(h["cards"])[0] >= 21:  # a split hand dealt to 21 plays itself
                    h["done"] = True
                    continue
                self.cur[i] = k
                return self.room.begin_turn(self.seats[i])  # a fresh clock for each hand
        self.next_player(i)

    def label(self, i):
        p = self.pl(i)
        name = p.name if p else "?"
        return f"{name} (hand {self.cur[i] + 1})" if len(self.hands[i]) > 1 else name

    def hit(self, i):
        h = self.hand(i)
        c = self.draw()
        h["cards"].append(c)
        t, _ = total(h["cards"])
        self.room.add_log(f"🃏 {self.label(i)} hits: {pretty(c)} → {t}" + (" — bust!" if t > 21 else ""),
                          "power" if t > 21 else "question")
        if t >= 21:
            h["done"] = True
            self.advance(i)

    def stand(self, i):
        h = self.hand(i)
        h["done"] = True
        self.room.add_log(f"✋ {self.label(i)} stands on {total(h['cards'])[0]}.", "question")
        self.advance(i)

    def double(self, i):
        h = self.hand(i)
        h["bet"] *= 2
        c = self.draw()
        h["cards"].append(c)
        t, _ = total(h["cards"])
        self.room.add_log(f"💰 {self.label(i)} doubles: {pretty(c)} → {t}" + (" — bust!" if t > 21 else ""), "power")
        h["done"] = True
        self.advance(i)

    def split(self, i):
        h = self.hand(i)
        aces = h["cards"][0][0] == "A"
        new = {"cards": [h["cards"].pop()], "bet": h["bet"], "done": False, "res": None}
        self.hands[i].insert(self.cur[i] + 1, new)
        h["cards"].append(self.draw())
        new["cards"].append(self.draw())
        p = self.pl(i)
        self.room.add_log(f"✂️ {p.name if p else '?'} splits: {' '.join(pretty(c) for c in h['cards'])} and "
                          f"{' '.join(pretty(c) for c in new['cards'])}" + (" (one card each on aces)" if aces else ""), "power")
        if aces:
            h["done"] = new["done"] = True
        if h["done"] or total(h["cards"])[0] >= 21:
            h["done"] = True
            self.advance(i)

    def can_double(self, i):
        h = self.hand(i)
        return len(h["cards"]) == 2 and self.chips[i] >= self.committed(i) + h["bet"]

    def can_split(self, i):
        h = self.hand(i)
        c = h["cards"]
        return (len(c) == 2 and value(c[0]) == value(c[1]) and len(self.hands[i]) < MAX_HANDS
                and self.chips[i] >= self.committed(i) + h["bet"])

    def dealer_turn(self):
        r = self.room
        self.stage = "dealer"
        r.turn = None
        r.add_log(f"🎩 Dealer shows {' '.join(pretty(c) for c in self.dealer)} ({total(self.dealer)[0]}).")
        if all(total(h["cards"])[0] > 21 or self.is_natural(i, h) for i in range(len(self.seats)) if self.bets[i] for h in self.hands[i]):
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
            if not self.bets[i]:
                continue
            texts, delta = [], 0
            for h in self.hands[i]:
                b, t, nat = h["bet"], total(h["cards"])[0], self.is_natural(i, h)
                if t > 21:
                    dh, text = -b, "bust"
                elif nat and not dnat:
                    dh, text = b * 3 // 2, "blackjack!"
                elif dnat and not nat:
                    dh, text = -b, "lost"
                elif d > 21 or t > d:
                    dh, text = b, "won"
                elif t == d:
                    dh, text = 0, "push"
                else:
                    dh, text = -b, "lost"
                h["res"] = [text, dh]
                if dh > 0 and len(h["cards"]) >= 5 and self.pl(i):
                    self.award(self.pl(i), "charlie")
                texts.append(text)
                delta += dh
            self.chips[i] += delta
            self.result[i] = [" · ".join(texts), delta]
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
            if not self.chips[i]:
                raise GameError("You're out of chips.")
            if not self.valid_bet(i, amount):
                raise GameError(f"Bet a multiple of {MIN_BET}, up to your {self.chips[i]} chips.")
            return self.bet(i, amount)
        if t in ("hit", "stand", "double", "split"):
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait for your turn.")
            if t == "double" and not self.can_double(i):
                raise GameError("You can only double on your first two cards, with enough chips.")
            if t == "split" and not self.can_split(i):
                raise GameError(f"You can split two cards of the same value, up to {MAX_HANDS} hands, with enough chips.")
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
                    self.bet(i, self.bot_bet(i) if self.auto(i) else (self.last_bet[i] or MIN_BET))  # the clock repeats your last bet
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
            for h in self.hands[i]:
                h["done"] = True
            self.next_player(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"💰 {self.chips[i]}"

    def final_scores(self):
        return {pid: self.chips[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        reveal = self.stage in ("dealer", "settle") or self.room.phase == "over"
        dealer = self.dealer if reveal else self.dealer[:1] + (["??"] if len(self.dealer) > 1 else [])
        mine = self.room.turn == p.id and self.stage == "play"
        hands = [[{"cards": h["cards"], "total": total(h["cards"])[0], "bet": h["bet"], "res": h["res"]} for h in hs]
                 for hs in self.hands]
        return {"twentyone": {
            "seats": self.seats, "me": i, "stage": self.stage, "hand": self.hand_no, "hands": self.s["hands"],
            "chips": self.chips, "bets": self.bets, "seatHands": hands, "cur": self.cur, "dealer": dealer,
            "dealerTotal": total(self.dealer)[0] if reveal and self.dealer else (total(self.dealer[:1])[0] if self.dealer else 0),
            "result": self.result, "lastBets": self.last_bet, "minBet": MIN_BET, "canDouble": mine and self.can_double(i), "canSplit": mine and self.can_split(i), "betOptions": list(BETS),
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
        if move == "split" and not self.can_split(i):
            move = self.bot_move(i, self.level(i), split=False)
        if move == "double" and not self.can_double(i):
            move = "hit"
        getattr(self, move)(i)

    def bot_bet(self, i):
        lv = self.level(i)
        if lv == "easy":
            return random.choice(BETS[:3])
        if lv == "hard":  # about a tenth of the stack, in fives
            return max(MIN_BET, min(self.chips[i], self.chips[i] // 10 // MIN_BET * MIN_BET))
        return min(self.chips[i], 10)

    def bot_move(self, i, level, split=True):
        cards = self.hand(i)["cards"]
        t, soft = total(cards)
        d = value(self.dealer[0])
        if split and len(cards) == 2 and value(cards[0]) == value(cards[1]):
            v = value(cards[0])
            if level == "normal" and v in (8, 11):
                return "split"
            if level == "hard" and (v in (8, 11) or (v == 9 and d not in (7, 10, 11)) or (v in (2, 3, 7) and d <= 7)
                                    or (v == 6 and d <= 6) or (v == 4 and d in (5, 6))):
                return "split"
        if level == "easy":
            return "hit" if t < 15 else "stand"
        if level == "normal":
            if t <= 11:
                return "double" if t == 11 and len(cards) == 2 else "hit"
            if soft and t <= 17:
                return "hit"
            if t >= 17 or (t >= 13 and d <= 6):
                return "stand"
            return "hit"
        # hard: basic strategy
        two = len(cards) == 2
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
