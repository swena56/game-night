"""Last Card: a shedding game from the Crazy Eights / Mau-Mau family, played with a
standard 52-card deck. Match the suit or rank; first to empty their hand wins.

Action cards (optional): 7 = next player draws 2 (stackable with 7s), 8 = skip,
Q = reverse, J = wild (choose the suit). Call "Last card!" before going down to one
card — anyone who catches you first makes you draw 2."""
import random
import time

from .base import Game, GameError

SUITS = "SHDC"
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUIT_NAME = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}
CATCH_PENALTY = 2


def rank(card):
    return card[:-1]


def suit(card):
    return card[-1]


def pretty(card):
    return rank(card) + SUIT_NAME[suit(card)]


class LastCard(Game):
    id = "lastcard"
    category = "cards"
    howto = [
        "Play a card matching the top card's suit or rank — or draw one.",
        '7 = next player draws 2 (stack 7s!), 8 = skip, Q = reverse, J = wild suit.',
        'With 2 or fewer cards, tap “Last card!” — anyone can catch you for +2 if you forget.',
        'First to empty their hand wins.',
    ]
    name = "Last Card"
    icon = "🃏"
    blurb = ("Match the suit or rank and empty your hand first. 7s make the next player draw, 8s skip, "
             "Queens reverse, Jacks are wild. Call “Last card!” — or get caught.")
    min_players = 2
    max_players = 6
    settings_schema = {
        "hand": ("Starting hand", [(5, "5 cards"), (7, "7 cards")], 7),
        "actions": ("Action cards", [(True, "On (7·8·Q·J)"), (False, "Off (plain)")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.deck = [r + s for s in SUITS for r in RANKS]
        rng.shuffle(self.deck)
        for p in seated:
            p.g.hand = [self.deck.pop() for _ in range(self.s["hand"])]
            p.g.declared = False
            p.g.exposed_at = None  # set when someone hits one card without calling it
        while self.s["actions"] and rank(self.deck[-1]) in ("7", "8", "Q", "J"):
            self.deck.insert(0, self.deck.pop())  # start on a plain card
        self.discard = [self.deck.pop()]
        self.suit = suit(self.discard[-1])
        self.penalty = 0
        self.direction = 1
        self.drew = False  # current player drew this turn and may now play it or pass
        first = rng.choice(seated)
        self.room.add_log(f"🃏 First card: {pretty(self.discard[-1])}. {first.name} starts.", "big")
        self.room.begin_turn(first.id)

    # -- helpers

    def top(self):
        return self.discard[-1]

    def playable(self, card):
        if self.penalty:
            return rank(card) == "7"
        if self.s["actions"] and rank(card) == "J":
            return True
        return suit(card) == self.suit or rank(card) == rank(self.top())

    def draw_cards(self, p, n):
        got = []
        for _ in range(n):
            if not self.deck:
                if len(self.discard) <= 1:
                    break
                self.deck = self.discard[:-1]
                self.rng.shuffle(self.deck)
                self.discard = self.discard[-1:]
                self.room.add_log("🔄 The discard pile was shuffled back into the deck.")
            got.append(self.deck.pop())
        p.g.hand += got
        return got

    def next_player(self, step=1):
        """Seat `step` places along the current direction from the current player."""
        live = [i for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]
        i = live.index(self.room.turn)
        return self.room.players[live[(i + self.direction * step) % len(live)]]

    def end_turn(self, skip=False):
        nxt = self.next_player(2 if skip else 1)
        self.drew = False
        self.room.begin_turn(nxt.id)

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        if t == "declare":
            return self.declare(p)
        if t == "catch":
            return self.catch(p, self.room.players.get(a.get("player")))
        self.require_turn(p)
        if t == "play":
            card = a.get("card")
            if card not in p.g.hand:
                raise GameError("That card isn't in your hand.")
            if not self.playable(card):
                raise GameError("You can't play that card now.")
            choose = a.get("suit")
            if self.s["actions"] and rank(card) == "J" and choose not in SUITS:
                raise GameError("Pick a suit for your Jack.")
            return self.play(p, card, choose)
        if t == "draw":
            if self.drew:
                raise GameError("You already drew — play the card or pass.")
            return self.draw(p)
        if t == "pass":
            if not self.drew:
                raise GameError("Draw a card first.")
            self.room.add_log(f"{p.name} keeps it and passes.")
            return self.end_turn()
        raise GameError("Unknown action.")

    def declare(self, p):
        if len(p.g.hand) > 2:
            raise GameError("You can only call it with two cards or fewer.")
        if p.g.declared and not p.g.exposed_at:
            raise GameError("You already called it.")
        p.g.declared = True
        p.g.exposed_at = None
        self.room.add_log(f"📣 {p.name}: “Last card!”", "power")

    def catch(self, p, target):
        if not target or target.id == p.id or not getattr(target.g, "exposed_at", None):
            raise GameError("Nobody to catch right now.")
        target.g.exposed_at = None
        self.draw_cards(target, CATCH_PENALTY)
        self.room.add_log(f"🚨 {p.name} caught {target.name} not calling “Last card!” — {target.name} draws {CATCH_PENALTY}.", "big")

    def play(self, p, card, choose=None):
        r = self.room
        p.g.hand.remove(card)
        self.discard.append(card)
        self.suit = suit(card)
        extra, skip = "", False
        if self.s["actions"]:
            k = rank(card)
            if k == "7":
                self.penalty += 2
                extra = f" — next player draws {self.penalty} (or plays a 7)"
            elif k == "8":
                skip = True
                extra = f" — {self.next_player().name} is skipped"
            elif k == "Q" and len(self.seats) > 2:
                self.direction *= -1
                extra = " — direction reversed 🔄"
            elif k == "Q":
                skip = True
                extra = " — reverse! (acts as a skip with 2 players)"
            elif k == "J":
                self.suit = choose
                extra = f" — suit is now {SUIT_NAME[choose]}"
        r.add_log(f"{p.name} played {pretty(card)}{extra}.", "question")
        if not p.g.hand:
            return r.finish(p, f"🏆 {p.name} played their last card and wins!")
        if len(p.g.hand) == 1 and not p.g.declared:
            p.g.exposed_at = time.time()
        if len(p.g.hand) > 1:
            p.g.declared = False
        self.end_turn(skip)

    def draw(self, p):
        r = self.room
        if self.penalty:
            n, self.penalty = self.penalty, 0
            self.draw_cards(p, n)
            r.add_log(f"{p.name} draws {n} cards.", "power")
            p.g.declared, p.g.exposed_at = False, None
            return self.end_turn()
        got = self.draw_cards(p, 1)
        p.g.declared, p.g.exposed_at = False, None
        if got and self.playable(got[0]):
            self.drew = True
            r.add_log(f"{p.name} draws a card… and could play it.")
            return
        r.add_log(f"{p.name} draws a card.")
        self.end_turn()

    def on_timeout(self):
        p = self.room.players[self.room.turn]
        self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
        if self.drew:
            return self.end_turn()
        self.draw(p)
        if self.drew:
            self.end_turn()

    def on_leave(self, p):
        if self.room.turn == p.id and len(self.room.contenders()) > 2:
            self.end_turn()
        super().on_leave(p)

    # -- view

    def meta(self, p):
        hand = getattr(p.g, "hand", None)
        if hand is None:
            return ""
        flag = " · 📣" if p.g.declared and len(hand) <= 2 else (" · 🚨" if p.g.exposed_at else "")
        return f"🃏 {len(hand)}{flag}"

    def final_scores(self):
        return {i: len(self.room.players[i].g.hand) for i in self.seats if i in self.room.players}

    def view(self, p):
        hand = getattr(p.g, "hand", None)
        my_turn = self.room.turn == p.id
        playable = [c for c in (hand or []) if my_turn and self.playable(c)]
        if self.drew and my_turn:
            playable = [c for c in playable if c == hand[-1]]  # only the card just drawn
        return {"cards": {
            "top": self.top(), "suit": self.suit, "penalty": self.penalty, "direction": self.direction,
            "deck": len(self.deck), "hand": sorted(hand, key=lambda c: (SUITS.index(suit(c)), RANKS.index(rank(c))))
            if hand is not None else None,
            "playable": playable, "drew": self.drew and my_turn, "actions": self.s["actions"],
            "exposed": [i for i in self.seats if i in self.room.players and getattr(self.room.players[i].g, "exposed_at", None)],
            "seats": self.seats,
        }}

    # -- bots

    def catchable(self):
        now = time.time()
        bots = [b for b in self.room.contenders() if b.bot and not b.standin]
        targets = [t for t in self.room.contenders() if getattr(t.g, "exposed_at", None)
                   and now - t.g.exposed_at > 2.5]
        for b in bots:
            for t in targets:
                if t.id != b.id and b.bot != "easy":
                    return b, t
        return None

    def bot_ready(self):
        return super().bot_ready() or self.catchable() is not None

    def bot_tick(self):
        pair = self.catchable()
        if pair:
            return self.catch(*pair)
        super().bot_tick()

    def bot_turn(self, p):
        hand = p.g.hand
        if len(hand) <= 2 and not p.g.declared and (p.bot != "easy" or random.random() < 0.6):
            self.declare(p)
        options = [c for c in hand if self.playable(c)]
        if self.drew:
            options = [c for c in options if c == hand[-1]]
            if not options:
                return self.end_turn()
        if not options:
            self.draw(p)
            if self.drew:  # drew something playable: decide on the next tick
                self.room.bot_at = time.time() + 0.8
            return
        nxt = self.next_player()
        threat = len(getattr(nxt.g, "hand", [])) <= 2

        def value(card):
            k = rank(card)
            v = sum(1 for c in hand if suit(c) == suit(card))  # keep flexibility in our long suit
            if self.s["actions"]:
                if k == "J":
                    v -= 6  # save wilds
                if k in ("7", "8") and threat:
                    v += 8
            return v + (random.uniform(0, 4) if p.bot == "easy" else random.uniform(0, 0.5))

        card = max(options, key=value)
        choose = None
        if self.s["actions"] and rank(card) == "J":
            rest = [c for c in hand if c != card]
            choose = max(SUITS, key=lambda s: sum(1 for c in rest if suit(c) == s))
        self.play(p, card, choose)
