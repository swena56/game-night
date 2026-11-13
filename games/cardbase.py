"""The 🃏 card table: shared pieces for the card games drawn by static/cardtable.js.

A game built on CardGame describes its table in one generic shape (see `view`), and the one browser
screen draws it: everyone round an oval felt table, the cards in the middle (a trick, or piles), your
hand fanned along the bottom, and buttons. Taps come back as ordinary actions.

The table shape (what `table(p, i)` returns, merged over seats/me/n/stage):
  info:    one dict per seat: {tags: [short lines], out: bool, badge: "🥄", show: [face-up cards],
           count: cards in hand (shown as 🎴 n; None to hide)}
  trick:   [[seat, card], ...] played in front of each player; last: {cards: [[seat, card]], winner}
  piles:   [{label, cards: [shown cards, '??' = a back], count, act: {type, ...} | None, glow}]
  trump:   'S' or a card code shown in the corner, with trumpLabel
  hand:    my cards; rows: [{label, cards}] of my other cards (Palace's face-up/down rows)
  moves:   [{card, label, a: {type, ...}}]: tap the card to send `a` (several with one card: a choice)
  pick:    {act, min, max, label, same}: choose cards, then the button sends {type: act, cards: [...]}
  buttons: [{label, a: {type, ...}, kind: 'primary' | 'danger' | ''}]
  note, banner, scores: {title, rows: [{seat, value, sub}], hint}, mine (my move in a simultaneous stage)

Flow: turn-based stages use room.begin_turn (self.to(i)); simultaneous stages put seats in
self.waiting; a pause (self.pause(fn, secs)) shows a result and then calls fn. The bots, timeouts and
seats whose player left all go through `bot_move(i, level)`, one decision per call."""
import random
import time

from .base import Game, GameError

RANKS = "23456789TJQKA"
SUITS = "CDHS"
GLYPH = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}
SUIT_NAME = {"S": "spades", "H": "hearts", "D": "diamonds", "C": "clubs"}
RANK_NAME = {"A": "aces", "K": "kings", "Q": "queens", "J": "jacks", "T": "tens", "9": "nines", "8": "eights",
             "7": "sevens", "6": "sixes", "5": "fives", "4": "fours", "3": "threes", "2": "twos"}


def rank(c):
    return c[:-1]


def suit(c):
    return c[-1]


def pretty(c):
    if c.startswith("JK"):
        return "🃏"
    r = rank(c)
    return ("10" if r == "T" else r) + GLYPH.get(suit(c), "")


def show(cards):
    return " ".join(pretty(c) for c in cards)


def rname(r, n=2):
    """'kings' (or 'king' for one)."""
    w = RANK_NAME.get(r, r)
    return w if n != 1 else {"sixes": "six"}.get(w, w[:-1])


def deck(ranks=RANKS, suits=SUITS, copies=1):
    return [r + s for _ in range(copies) for s in suits for r in ranks]


def by_suit(order=RANKS, suits=SUITS):
    """A sort key for a hand: suit by suit, then by rank in `order`."""
    return lambda c: (suits.index(suit(c)) if suit(c) in suits else 9, order.index(rank(c)) if rank(c) in order else 99)


class CardGame(Game):
    category = "cards"
    PAUSE = 3.5          # seconds a result stays up between hands

    # -- seats

    def seat_up(self, seated, rng, shuffle=True):
        self.rng = rng
        if shuffle:
            rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.n = len(seated)
        self.stage = "start"
        self.after = None
        self.waiting = set()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def nm(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def auto(self, i):
        """Bots, and seats whose player left, play themselves."""
        p = self.pl(i)
        return p is None or bool(p.bot) or p.eliminated

    def level(self, i):
        p = self.pl(i)
        return p.bot if p and p.bot in ("easy", "normal", "hard") else "normal"

    def is_out(self, i):
        """Seats knocked out of the game (skipped by next_seat)."""
        return False

    def next_seat(self, i, step=1):
        for k in range(1, self.n + 1):
            j = (i + k * step) % self.n
            if not self.is_out(j):
                return j
        return i

    def to(self, i):
        self.waiting = set()
        self.after = None
        self.room.begin_turn(self.seats[i])

    def open_all(self, seats, secs=None):
        """A simultaneous stage: everyone in `seats` acts, in any order."""
        r = self.room
        r.turn = None
        self.after = None
        self.waiting = set(seats)
        t = secs if secs is not None else r.settings.get("timer")
        r.deadline = time.time() + t if t else None
        r.bot_at = time.time() + random.uniform(0.8, 1.8)

    def pause(self, then, secs=None):
        r = self.room
        r.turn = None
        self.waiting = set()
        self.after = then
        r.deadline = time.time() + (self.PAUSE if secs is None else secs)

    def pending(self):
        if self.after or self.room.phase != "playing":
            return []
        if self.waiting:
            return sorted(self.waiting)
        if self.room.turn in self.seats:
            return [self.seats.index(self.room.turn)]
        return []

    def act_seat(self, p):
        i = self.seat(p)
        if i is None or p.eliminated or self.is_out(i):
            raise GameError("You're watching this game.")
        return i

    def must(self, i):
        if i not in self.pending():
            raise GameError("It's not your move.")

    # -- bots and the clock

    def bot_move(self, i, level):
        raise NotImplementedError

    def bot_ready(self):
        return any(self.auto(i) for i in self.pending())

    def bot_tick(self):
        now = time.time()
        for i in self.pending():
            if self.auto(i):
                self.bot_move(i, self.level(i))
                if self.room.bot_at <= now and (self.waiting or self.room.turn is None or self.pending() == [i]):
                    self.room.bot_at = now + random.uniform(0.5, 1.2)
                return

    def on_timeout(self):
        if self.after:
            f, self.after = self.after, None
            self.room.deadline = None
            return f()
        for i in self.pending():
            if i in self.pending():
                self.room.add_log(f"⏰ {self.nm(i)} ran out of time.", "power")
                self.bot_move(i, "easy")

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left; their seat plays on by itself.")
        left = r.contenders()
        if len(left) < 2 and r.phase == "playing":
            r.finish(left[0] if left else None, "🏳️ Everyone else left.")

    # -- view

    def table(self, p, i):
        return {}

    def view(self, p):
        i = self.seat(p)
        t = {"seats": self.seats, "me": i, "n": self.n, "stage": self.stage,
             "mine": i is not None and i in self.waiting, "waiting": sorted(self.waiting)}
        t.update(self.table(p, i))
        if self.room.turn is None and "turnText" not in t and self.room.phase == "playing":
            if self.waiting:
                t["turnText"] = "⏳ Waiting for " + ", ".join(self.nm(k) for k in sorted(self.waiting))
            else:
                t["turnText"] = "…"
        return {self.id: t}

    def win_by_score(self, scores, high=True, what="points"):
        """Finish with the best of `scores` (one per seat), or a tie."""
        best = max(scores) if high else min(scores)
        top = [k for k, v in enumerate(scores) if v == best]
        if len(top) == 1:
            unit = what[:-1] if best in (1, -1) and what.endswith("s") else what
            return self.room.finish(self.pl(top[0]), f"🏆 {self.nm(top[0])} wins {self.name} with {best} {unit}!")
        return self.room.finish(None, f"🤝 A tie at {best} between {' & '.join(self.nm(k) for k in top)}.")
