"""Speed: the traditional two-player race card game (also called Spit), played in real time.

Each player has a five-card hand fed from their own face-down stock. There's no turn order: both
players slap cards onto either of the two centre piles as fast as they can. A card fits a pile when
it is one rank above or below the top card (suits don't matter, and King and Ace wrap round). When
neither player can play, a card from each side pile is flipped onto the centre piles. The first to
get rid of every card in their hand and stock wins the round."""
import time

from .base import Game, GameError

RANKS = "A23456789TJQK"
SUITS = "SHDC"
HAND = 5
STOCK = 15
SIDE = 5
STALL_SECS = 1.8    # the pause before fresh cards are flipped when nobody can play
BETWEEN_SECS = 5.0  # the pause on the round result
REACT = {"easy": (1.5, 2.4), "normal": (0.95, 1.5), "hard": (0.6, 0.95)}  # seconds per bot play


def rank(c):
    return RANKS.index(c[0])


def fits(card, top, pairs=False):
    """One rank up or down (K and A wrap); with 👯 Pairs on, the same rank fits too."""
    return (rank(card) - rank(top)) % 13 in ((0, 1, 12) if pairs else (1, 12))


def pretty(c):
    return ("10" if c[0] == "T" else c[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[c[1]]


class Speed(Game):
    id = "speed"
    category = "cards"
    howto = [
        "No turns: both players play at the same time, as fast as they can.",
        "Tap a card in your hand to play it onto a centre pile one rank above or below the top card (suits don't matter; K and A wrap round). If it fits both piles, tap the pile you want.",
        "Your hand refills to 5 from your stock. When nobody can play, fresh cards flip onto both piles.",
        "Empty your hand and stock first to win the round.",
        "With 👯 Pairs on, a card of the same rank fits as well (a 7 on a 7).",
    ]
    name = "Speed"
    icon = "⚡"
    blurb = "The two-player race card game: slap cards one up or down onto the piles before your rival does."
    min_players = 2
    max_players = 2
    replayable = False
    settings_schema = {
        "rounds": ("Match", [(1, "One round"), (2, "Best of 3")], 1),
        "pairs": ("👯 Pairs", [(False, "Off"), (True, "On: the same rank fits too")], False),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0  # the bot simulator fast-forwards this virtual clock
        self.seats = [p.id for p in seated]
        self.wins = [0, 0]
        self.round = 0
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log("⚡ Speed! Play cards one rank up or down onto either pile. No turns — just be quick.", "big")
        self.new_round()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def new_round(self):
        self.round += 1
        deck = [r + s for s in SUITS for r in RANKS]
        self.rng.shuffle(deck)
        self.stock = [deck[0:STOCK], deck[STOCK:2 * STOCK]]
        self.hand = [deck[30:35], deck[35:40]]
        self.side = [deck[40:45], deck[45:50]]
        self.piles = [[deck[50]], [deck[51]]]
        self.stage = "play"
        self.next_at = None   # the flip (stall) or the next round (between)
        self.ready = [None, None]
        self.last = None      # [seat, card, pile] of the latest play, for the animation
        self.seq = 0
        self.result = ""
        self.room.add_log(f"🃏 Round {self.round}: {pretty(self.piles[0][-1])} and {pretty(self.piles[1][-1])} start the piles.")
        self.settle()

    # -- the rules

    def playable(self, i):
        return [c for c in self.hand[i] if any(fits(c, pile[-1], self.s.get("pairs")) for pile in self.piles)]

    def left(self, i):
        return len(self.hand[i]) + len(self.stock[i])

    def react(self, i):
        p = self.pl(i)
        lo, hi = REACT.get(p.bot if p and p.bot else "normal", REACT["normal"])
        return self.rng.uniform(lo, hi)

    def settle(self):
        """After any change: start a stall when nobody can play, and line up the bots' next plays."""
        if self.stage != "play":
            return self.sync_deadline()
        now = self.now()
        can = [bool(self.playable(i)) for i in (0, 1)]
        if not any(can):
            if self.next_at is None:
                self.next_at = now + STALL_SECS
        else:
            self.next_at = None
        for i in (0, 1):
            p = self.pl(i)
            if not (p and (p.bot or p.standin)) or not can[i]:
                self.ready[i] = None
            elif self.ready[i] is None:
                self.ready[i] = now + self.react(i)
        self.sync_deadline()

    def events(self):
        return [t for t in [self.next_at] + self.ready if t is not None]

    def sync_deadline(self):
        ev = self.events()
        self.room.deadline = min(ev) - self.skew if ev else None

    def play(self, i, card, pile):
        top = self.piles[pile][-1]
        if not fits(card, top, self.s.get("pairs")):
            raise GameError(f"{pretty(card)} doesn't fit on {pretty(top)}.")
        self.hand[i].remove(card)
        self.piles[pile].append(card)
        if self.stock[i]:
            self.hand[i].append(self.stock[i].pop())
        self.seq += 1
        self.last = [i, card, pile]
        if not self.left(i):
            return self.round_won(i)
        self.settle()

    def flip(self):
        if not self.side[0] and not self.side[1]:
            # Out of side cards: everything under the two top cards is shuffled into new side piles.
            under = self.piles[0][:-1] + self.piles[1][:-1]
            if len(under) < 2:
                return self.round_stuck()
            self.rng.shuffle(under)
            half = len(under) // 2
            self.side = [under[:half], under[half:2 * half]]
            self.piles = [self.piles[0][-1:], self.piles[1][-1:]]
            self.room.add_log("🔀 The side piles ran out, so the centre piles were shuffled into new ones.")
        for k in (0, 1):
            src = self.side[k] or self.side[1 - k]
            self.piles[k].append(src.pop())
        self.seq += 1
        self.last = None
        self.next_at = None
        self.room.add_log(f"🔄 Nobody can play: flip! {pretty(self.piles[0][-1])} and {pretty(self.piles[1][-1])}.")
        self.settle()

    def round_won(self, i):
        p = self.pl(i)
        self.wins[i] += 1
        self.end_round(f"⚡ {p.name if p else '?'} is out of cards and wins round {self.round}!", i)

    def round_stuck(self):
        a, b = self.left(0), self.left(1)
        if a == b:
            self.end_round(f"🤝 Round {self.round} is stuck with {a} cards each — no winner.", None)
        else:
            i = 0 if a < b else 1
            self.wins[i] += 1
            p = self.pl(i)
            self.end_round(f"🧱 Round {self.round} is stuck; {p.name if p else '?'} has fewer cards and takes it.", i)

    def end_round(self, text, i):
        self.room.add_log(text, "big")
        self.result = text
        target = self.s["rounds"]
        if i is not None and self.wins[i] >= target:
            p = self.pl(i)
            return self.room.finish(p, f"🏆 {p.name} wins Speed!" + (f" ({self.wins[i]}–{self.wins[1 - i]})" if target > 1 else ""))
        self.stage = "between"
        self.ready = [None, None]
        self.next_at = self.now() + BETWEEN_SECS
        self.sync_deadline()

    # -- the clock

    def bot_ready(self):
        if self.stage == "play" and any(self.ready[i] is None and self.pl(i) and self.pl(i).standin for i in (0, 1)):
            self.settle()  # someone dropped out: autopilot takes over their hand
        ev = self.events()
        return self.room.phase == "playing" and bool(ev) and self.now() >= min(ev)

    def bot_tick(self):
        self.process()

    def on_timeout(self):
        ev = self.events()
        if ev:
            gap = min(ev) - self.now()
            if gap > 0:
                self.skew += gap
        self.process()

    def process(self):
        now = self.now()
        if self.stage == "between":
            if self.next_at is not None and now >= self.next_at:
                self.new_round()
            return
        if self.next_at is not None and now >= self.next_at:
            return self.flip()
        for i in (0, 1):
            if self.ready[i] is not None and now >= self.ready[i]:
                self.ready[i] = None
                self.bot_play(i)
                if self.stage != "play" or self.room.phase != "playing":
                    return
        self.settle()

    def bot_play(self, i):
        p = self.pl(i)
        options = [(c, k) for c in self.hand[i] for k in (0, 1) if fits(c, self.piles[k][-1], self.s.get("pairs"))]
        if not options:
            return
        if p and p.bot == "easy":
            card, pile = self.rng.choice(options)
        else:
            def score(opt):
                # Prefer a play that leaves another card of ours playable straight after (a run).
                c, k = opt
                rest = [x for x in self.hand[i] if x != c]
                tops = [c if j == k else self.piles[j][-1] for j in (0, 1)]
                follow = sum(1 for x in rest if any(fits(x, t, self.s.get("pairs")) for t in tops))
                return follow + self.rng.random() * (0.5 if p and p.bot == "hard" else 2)
            card, pile = max(options, key=score)
        self.play(i, card, pile)

    # -- players

    def act(self, p, a):
        i = self.seat(p)
        if i is None or p.spectator:
            raise GameError("You're watching this game.")
        if a.get("type") != "play":
            raise GameError("Unknown action.")
        if self.stage != "play":
            raise GameError("Wait for the next round.")
        card, pile = a.get("card"), a.get("pile")
        if not isinstance(card, str) or card not in self.hand[i]:
            raise GameError("That card isn't in your hand.")
        if pile not in (0, 1):
            raise GameError("Pick a pile.")
        self.play(i, card, pile)

    def view(self, p):
        i = self.seat(p)
        me = i if i is not None else 0
        now = self.now()
        return {"speed": {
            "me": i, "pairs": bool(self.s.get("pairs")),
            "seats": self.seats,
            "hand": self.hand[me] if i is not None else [],
            "stock": [len(s) for s in self.stock],
            "hands": [len(h) for h in self.hand],
            "side": [len(s) for s in self.side],
            "piles": [pile[-1] for pile in self.piles],
            "depth": [len(pile) for pile in self.piles],
            "stage": self.stage,
            "wait": max(0.0, self.next_at - now) if self.next_at is not None else None,
            "stuck": self.stage == "play" and self.next_at is not None,
            "wins": self.wins,
            "rounds": self.s["rounds"],
            "round": self.round,
            "last": self.last,
            "seq": self.seq,
            "result": self.result,
        }}

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "hand"):
            return ""
        w = f" · {self.wins[i]} won" if self.s["rounds"] > 1 else ""
        return f"{self.left(i)} cards{w}"

    def final_scores(self):
        return {pid: self.wins[i] for i, pid in enumerate(self.seats)}
