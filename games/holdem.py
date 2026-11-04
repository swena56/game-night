"""Texas Hold'em: no-limit poker, the traditional public-domain game.

Everyone starts with the same stack. Each hand: blinds, two private cards, then betting
preflop, on the flop (3 shared cards), the turn and the river. The best five-card hand from
your two cards and the five shared ones wins the pot; all-ins make side pots. Blinds rise
every few hands, and a player with no chips left is out. Last player with chips wins."""
import random
import time
from collections import Counter
from itertools import combinations

from .base import Game, GameError

RANKS = "23456789TJQKA"
SUITS = "SHDC"
VALUE = {r: i + 2 for i, r in enumerate(RANKS)}
BLINDS = [(10, 20), (15, 30), (25, 50), (50, 100), (75, 150), (100, 200), (150, 300), (200, 400),
          (300, 600), (500, 1000), (750, 1500), (1000, 2000), (1500, 3000), (2500, 5000)]
HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house",
              "Four of a kind", "Straight flush"]
STREETS = ["preflop", "flop", "turn", "river"]
PAUSE, SHOWDOWN_PAUSE = 2.5, 5.0     # seconds between hands (longer when cards are shown)
REBUY_WAIT = 12.0                    # how long the table waits when a buy-back would keep the game going
HISTORY = 8                          # past hands kept for the hand-history panel
TIME_BANK, BANK_STEP = 60, 20        # with a turn timer: extra seconds each player has for the game, used 20 s at a time


def pretty(card):
    return ("10" if card[0] == "T" else card[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[card[1]]


def straight_high(values):
    s = set(values)
    if 14 in s:
        s.add(1)
    for h in range(14, 4, -1):
        if all(h - i in s for i in range(5)):
            return h
    return 0


def evaluate(cards):
    """Best five-card hand out of 5–7 cards, as a comparable tuple (category, tie-breakers…)."""
    vals = sorted((VALUE[c[0]] for c in cards), reverse=True)
    suits = Counter(c[1] for c in cards)
    flush_suit = next((s for s, n in suits.items() if n >= 5), None)
    if flush_suit:
        fv = sorted((VALUE[c[0]] for c in cards if c[1] == flush_suit), reverse=True)
        sf = straight_high(fv)
        if sf:
            return (8, sf)
    counts = Counter(vals)
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    if groups[0][1] == 4:
        q = groups[0][0]
        return (7, q, max(v for v in vals if v != q))
    trips = [v for v, n in groups if n == 3]
    pairs = [v for v, n in groups if n == 2]
    if trips and (len(trips) > 1 or pairs):
        t = trips[0]
        p = max([v for v in trips[1:]] + pairs)
        return (6, t, p)
    if flush_suit:
        return (5, *fv[:5])
    st = straight_high(vals)
    if st:
        return (4, st)
    if trips:
        t = trips[0]
        return (3, t, *[v for v in vals if v != t][:2])
    if len(pairs) >= 2:
        a, b = pairs[0], pairs[1]
        return (2, a, b, max(v for v in vals if v not in (a, b)))
    if pairs:
        p = pairs[0]
        return (1, p, *[v for v in vals if v != p][:3])
    return (0, *vals[:5])


RANK_NAME = {2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "jack", 12: "queen",
             13: "king", 14: "ace"}


def plural(v):
    return "sixes" if v == 6 else RANK_NAME[v] + "s"


def describe(cards):
    """A friendly name for the best hand in these cards: "Pair of 7s", "Flush, ace high", "Kings full of 3s"."""
    e = evaluate(cards)
    cat, a = e[0], e[1] if len(e) > 1 else 0
    if cat == 8:
        return "Royal flush" if a == 14 else f"Straight flush, {RANK_NAME[a]} high"
    if cat == 7:
        return f"Four {plural(a)}"
    if cat == 6:
        return f"{plural(a).capitalize()} full of {plural(e[2])}"
    if cat == 5:
        return f"Flush, {RANK_NAME[a]} high"
    if cat == 4:
        return f"Straight, {RANK_NAME[a]} high"
    if cat == 3:
        return f"Three {plural(a)}"
    if cat == 2:
        return f"Two pair, {plural(a)} and {plural(e[2])}"
    if cat == 1:
        return f"Pair of {plural(a)}"
    return f"{RANK_NAME[a].capitalize()} high"


def equity(mine, board, opponents, trials, rng):
    """Monte Carlo share of the pot against `opponents` random hands (what a player could know)."""
    deck = [r + s for r in RANKS for s in SUITS if r + s not in mine and r + s not in board]
    need = 5 - len(board)
    won = 0.0
    for _ in range(trials):
        draw = rng.sample(deck, need + 2 * opponents)
        full = board + draw[:need]
        me = evaluate(mine + full)
        best, ties = True, 1
        for i in range(opponents):
            other = evaluate(draw[need + 2 * i: need + 2 * i + 2] + full)
            if other > me:
                best = False
                break
            if other == me:
                ties += 1
        if best:
            won += 1 / ties
    return won / trials


class Holdem(Game):
    id = "holdem"
    category = "cards"
    howto = [
        "You get two private cards. Five shared cards come out: the flop (3), the turn and the river.",
        "Each round you can fold, check, call, raise or go all-in. Best five-card hand at the end wins the pot.",
        "Hands, high to low: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair.",
        "Blinds rise every few hands. Run out of chips and you're out (unless you 💸 buy back in). Last player with chips wins.",
        "With a turn timer, everyone has a 60 s ⏳ time bank: run out of time and it adds 20 s before you're folded.",
    ]
    name = "Texas Hold'em"
    icon = "♠️"
    blurb = "No-limit poker: two cards each, five shared, bluff and bet your way to every chip on the table."
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "quads": ("💎", "Monster hand", "Win a showdown with four of a kind or a straight flush")}
    settings_schema = {
        "chips": ("Starting chips", [(1000, "1,000"), (2000, "2,000"), (5000, "5,000")], 1000),
        "pace": ("Blinds rise", [(6, "⚡ Every 6 hands"), (10, "Every 10 hands"), (15, "🐢 Every 15 hands")], 10),
        "rebuys": ("Buy back in", [(0, "Off"), (1, "💸 Once each"), (3, "💸 Up to 3 times")], 1),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.chips = self.s["chips"]
            p.g.cards, p.g.bet, p.g.put = [], 0, 0
            p.g.folded = p.g.allin = False
            p.g.rebuys = self.s.get("rebuys", 1)
            p.g.bank = TIME_BANK
        self.hand_no = 0
        self.dealer = rng.randrange(len(self.seats))
        self.board, self.shown, self.result, self.last_act = [], {}, "", {}
        self.best5, self.winners = [], []
        self.stage = "done"
        self.room.add_log(f"♠️ Texas Hold'em! Everyone starts with {self.s['chips']:,} chips.", "big")
        self.new_hand()

    # -- helpers

    def pl(self, pid):
        return self.room.players.get(pid)

    def alive(self):
        """Players still in the game (with chips), in seat order."""
        return [i for i in self.seats if self.pl(i) and not self.pl(i).eliminated]

    def live(self):
        """Players still in this hand (not folded)."""
        return [i for i in self.in_hand if self.pl(i) and not self.pl(i).g.folded]

    def can_act(self):
        return [i for i in self.live() if not self.pl(i).g.allin]

    def after(self, pid, pool):
        """The next player in seat order after `pid` who is in `pool`."""
        n = len(self.seats)
        start = self.seats.index(pid)
        for k in range(1, n + 1):
            cand = self.seats[(start + k) % n]
            if cand in pool:
                return cand
        return None

    def late_join(self, p):
        """Sit in with a full starting stack from the next hand."""
        p.g.chips = self.s["chips"]
        p.g.cards, p.g.bet, p.g.put = [], 0, 0
        p.g.folded = p.g.allin = False
        p.g.rebuys = self.s.get("rebuys", 1)
        p.g.bank = TIME_BANK
        self.seats.append(p.id)
        if self.stage == "done" and len(self.alive()) >= 2:  # a table waiting for a buy-back can deal now
            soon = time.time() + 1.5
            self.room.deadline = min(self.room.deadline, soon) if self.room.deadline else soon

    def can_rebuy(self, p):
        """Busted people (not bots) with buy-backs left. They join again from the next hand."""
        return bool(p and p.eliminated and p.human() and p.id in self.seats and getattr(p.g, "rebuys", 0) > 0)

    def waiting_rebuy(self):
        return [i for i in self.seats if self.can_rebuy(self.pl(i))]

    def blinds(self):
        return BLINDS[min(len(BLINDS) - 1, (self.hand_no - 1) // self.s["pace"])]

    def pot(self):
        return sum(self.pl(i).g.put for i in self.in_hand if self.pl(i)) + getattr(self, "dead", 0)

    def put_in(self, p, amount):
        amount = max(0, min(amount, p.g.chips))
        p.g.chips -= amount
        p.g.bet += amount
        p.g.put += amount
        if p.g.chips == 0:
            p.g.allin = True
        return amount

    # -- hand flow

    def new_hand(self):
        r = self.room
        alive = self.alive()
        if len(alive) < 2:
            return self.finish()
        self.hand_no += 1
        # move the button to the next player still in the game
        self.dealer = (self.dealer + 1) % len(self.seats)
        while self.seats[self.dealer] not in alive:
            self.dealer = (self.dealer + 1) % len(self.seats)
        button = self.seats[self.dealer]
        deck = [rk + s for rk in RANKS for s in SUITS]
        self.rng.shuffle(deck)
        self.deck = deck
        self.in_hand = list(alive)
        self.dead = 0  # chips from players who left mid-hand stay in the pot
        self.board, self.shown, self.result, self.last_act = [], {}, "", {}
        self.best5, self.winners = [], []
        for i in self.in_hand:
            p = self.pl(i)
            p.g.cards = [self.deck.pop(), self.deck.pop()]
            p.g.bet = p.g.put = 0
            p.g.folded = p.g.allin = False
        sb, bb = self.blinds()
        if self.hand_no > 1 and (self.hand_no - 1) % self.s["pace"] == 0:
            r.add_log(f"⏫ Blinds are now {sb:,}/{bb:,}.", "power")
        # heads-up the button posts the small blind; otherwise the next two players do
        sb_id = button if len(alive) == 2 else self.after(button, alive)
        bb_id = self.after(sb_id, alive)
        self.sb_id, self.bb_id = sb_id, bb_id
        self.put_in(self.pl(sb_id), sb)
        self.put_in(self.pl(bb_id), bb)
        self.stage = "preflop"
        # the bet to match is what was really posted (a short all-in blind can be less than the big blind)
        self.cur_bet, self.min_raise, self.acted = max(self.pl(i).g.bet for i in self.in_hand), bb, set()
        r.add_log(f"🃏 Hand {self.hand_no}: {self.pl(button).name} has the button. Blinds {sb:,}/{bb:,}.")
        first = self.after(bb_id, self.can_act())
        if first is None or (len(self.can_act()) == 1 and self.pl(first).g.bet >= self.cur_bet):
            return self.run_out()
        r.begin_turn(first)

    def round_done(self):
        return all(i in self.acted and self.pl(i).g.bet == self.cur_bet for i in self.can_act())

    def after_action(self, p):
        if len(self.live()) == 1:
            return self.award()
        if self.round_done():
            return self.next_street()
        nxt = self.after(p.id, self.can_act())
        self.room.begin_turn(nxt)

    def next_street(self):
        for i in self.in_hand:
            self.pl(i).g.bet = 0
        self.cur_bet, self.acted = 0, set()
        self.min_raise = self.blinds()[1]
        if self.stage == "river":
            return self.award()
        self.deal_street()
        acting = self.can_act()
        if len(acting) <= 1:  # everyone else is all-in: no more betting
            return self.run_out()
        self.room.begin_turn(self.after(self.seats[self.dealer], acting))

    def deal_street(self):
        self.stage = STREETS[STREETS.index(self.stage) + 1]
        n = 3 if self.stage == "flop" else 1
        self.deck.pop()  # burn
        new = [self.deck.pop() for _ in range(n)]
        self.board += new
        self.room.add_log(f"{'🎴' if n == 3 else '➕'} {self.stage.title()}: {' '.join(pretty(c) for c in new)}")

    def run_out(self):
        for i in self.in_hand:
            self.pl(i).g.bet = 0
        while self.stage != "river":
            self.deal_street()
        self.award()

    def award(self):
        r = self.room
        live = self.live()
        total = self.pot()
        winnings = {i: 0 for i in self.in_hand}
        if len(live) == 1:
            winnings[live[0]] = total
            self.result = f"{self.pl(live[0]).name} wins {total:,} (everyone else folded)."
        else:
            ranks = {i: evaluate(self.pl(i).g.cards + self.board) for i in live}
            self.shown = {i: {"cards": self.pl(i).g.cards, "hand": HAND_NAMES[ranks[i][0]]} for i in live}
            puts = {i: self.pl(i).g.put for i in self.in_hand}
            prev, paid, returned = 0, 0, {}
            levels = sorted({puts[i] for i in live})
            for li, lvl in enumerate(levels):
                layer = sum(min(v, lvl) - min(v, prev) for v in puts.values())
                if li == len(levels) - 1:
                    layer = total - paid  # folded money above the last all-in level goes here too
                eligible = [i for i in live if puts[i] >= lvl]
                if len(eligible) == 1:  # nobody matched this part of the bet: it just comes back
                    winnings[eligible[0]] += layer
                    returned[eligible[0]] = returned.get(eligible[0], 0) + layer
                    paid += layer
                    prev = lvl
                    continue
                best = max(ranks[i] for i in eligible)
                winners = [i for i in eligible if ranks[i] == best]
                share, odd = divmod(layer, len(winners))
                # odd chips go to the first winner after the button
                order = sorted(winners, key=lambda i: (self.seats.index(i) - self.dealer - 1) % len(self.seats))
                for k, i in enumerate(order):
                    winnings[i] += share + (1 if k < odd else 0)
                paid += layer
                prev = lvl
            parts = [f"{self.pl(i).name} wins {v - returned.get(i, 0):,} with {HAND_NAMES[ranks[i][0]].lower()}"
                     for i, v in winnings.items() if v - returned.get(i, 0)]
            parts += [f"{self.pl(i).name} gets {v:,} back" for i, v in returned.items()]
            self.result = "; ".join(parts) + "."
        self.winners = [i for i, v in winnings.items() if v - (returned.get(i, 0) if len(live) > 1 else 0) > 0]
        self.best5 = []
        if len(live) > 1 and self.winners:
            top = self.winners[0]
            cards = self.pl(top).g.cards + self.board
            self.best5 = list(max(combinations(cards, 5), key=evaluate))
            if ranks[top][0] >= 7:  # four of a kind or a straight flush
                self.award(top, "quads")
        for i, v in winnings.items():
            self.pl(i).g.chips += v
        r.add_log(f"💰 {self.result}", "big")
        # the hand history keeps everyone's hole cards so each player can look back at their own;
        # `shown` is the same dict as self.shown, so a winner who shows later appears here too
        entry = {"n": self.hand_no, "board": list(self.board), "result": self.result, "shown": self.shown,
                 "cards": {i: list(self.pl(i).g.cards) for i in self.in_hand if self.pl(i)}}
        self.history = [*getattr(self, "history", []), entry][-HISTORY:]
        for i in self.in_hand:
            p = self.pl(i)
            p.g.bet = 0
            if p.g.chips == 0 and not p.eliminated:
                p.eliminated = True
                r.add_log(f"💥 {p.name} is out of chips!", "power")
        self.stage = "done"
        r.turn = None
        if len(self.alive()) < 2:
            if not self.waiting_rebuy():
                return self.finish()
            # someone can still buy back in: give them a moment before the last player standing wins
            names = ", ".join(self.pl(i).name for i in self.waiting_rebuy())
            r.add_log(f"💸 {names} can buy back in — {int(REBUY_WAIT)}s before the game ends.", "power")
            r.deadline = time.time() + REBUY_WAIT
            return
        r.deadline = time.time() + (SHOWDOWN_PAUSE if self.shown else PAUSE)

    def finish(self):
        alive = self.alive()
        if alive:
            w = self.pl(alive[0])
            self.room.finish(w, f"🏆 {w.name} takes every chip and wins Texas Hold'em!")
        else:
            self.room.finish(None, "Nobody has any chips left.")

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if t == "rebuy":
            return self.rebuy(p)
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're out of this game.")
        if t == "show":
            return self.show(p)
        if self.stage == "done":
            raise GameError("The next hand is being dealt.")
        self.require_turn(p)
        to_call = self.cur_bet - p.g.bet
        if t == "fold":
            return self.fold(p)
        if t == "check":
            if to_call > 0:
                raise GameError(f"You need to call {to_call:,} or fold.")
            return self.check(p)
        if t == "call":
            if to_call <= 0:
                return self.check(p)
            return self.call(p)
        if t == "raise":
            to = a.get("to")
            if not isinstance(to, int) or isinstance(to, bool):
                raise GameError("Bad raise.")
            return self.raise_to(p, to)
        if t == "allin":
            return self.raise_to(p, p.g.bet + p.g.chips)
        raise GameError("Unknown action.")

    def show(self, p):
        """Everyone else folded: the winner may turn their cards over anyway."""
        if self.stage != "done" or self.shown or self.live() != [p.id]:
            raise GameError("Only a winner whose rivals all folded can show their cards.")
        self.shown[p.id] = {"cards": p.g.cards, "hand": "shown"}
        self.room.add_log(f"🙂 {p.name} shows {' '.join(map(pretty, p.g.cards))}.", "question")

    def rebuy(self, p):
        if not self.can_rebuy(p):
            raise GameError("You can't buy back in right now.")
        p.g.rebuys -= 1
        p.g.chips = self.s["chips"]
        p.g.cards, p.g.bet, p.g.put = [], 0, 0
        p.g.folded = p.g.allin = False
        p.eliminated = False
        self.room.add_log(f"💸 {p.name} buys back in for {self.s['chips']:,} chips!", "big")
        if self.stage == "done" and len(self.alive()) >= 2:  # the table was waiting: deal soon
            soon = time.time() + 1.5
            self.room.deadline = min(self.room.deadline, soon) if self.room.deadline else soon

    def note(self, p, text, kind="info"):
        self.last_act[p.id] = text
        self.room.add_log(f"{p.name} {text}.", kind)

    def fold(self, p):
        p.g.folded = True
        self.note(p, "folds")
        self.after_action(p)

    def check(self, p):
        self.acted.add(p.id)
        self.note(p, "checks")
        self.after_action(p)

    def call(self, p):
        paid = self.put_in(p, self.cur_bet - p.g.bet)
        self.acted.add(p.id)
        self.note(p, f"calls {paid:,}" + (" (all-in)" if p.g.allin else ""))
        self.after_action(p)

    def raise_to(self, p, to):
        most = p.g.bet + p.g.chips
        if to >= most:
            to = most  # all-in
        elif to < self.cur_bet + self.min_raise:
            raise GameError(f"Raise to at least {self.cur_bet + self.min_raise:,} (or go all-in).")
        if to <= self.cur_bet:  # an all-in that doesn't cover the bet is a call
            return self.call(p)
        raise_by = to - self.cur_bet
        self.put_in(p, to - p.g.bet)
        if raise_by >= self.min_raise:
            self.min_raise = raise_by
        opening = self.cur_bet == 0
        self.cur_bet = to
        self.acted = {p.id}
        word = "bets" if opening else "raises to"
        self.note(p, f"{word} {to:,}" + (" (all-in!)" if p.g.allin else ""), "question")
        self.after_action(p)

    def on_timeout(self):
        if self.stage == "done":
            return self.new_hand()
        p = self.pl(self.room.turn)
        bank = getattr(p.g, "bank", 0)
        if bank > 0 and not p.bot:  # dip into the time bank before folding them
            use = min(BANK_STEP, bank)
            p.g.bank = bank - use
            self.room.deadline = time.time() + use
            return self.room.add_log(f"⏳ {p.name} is thinking: {use} s from the time bank ({p.g.bank} s left).", "power")
        self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
        if self.cur_bet - p.g.bet > 0:
            self.fold(p)
        else:
            self.check(p)

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left the table.")
        was_turn = r.turn == p.id
        p.eliminated = True
        if self.stage != "done" and p.id in self.in_hand:
            p.g.folded = True
            self.dead += p.g.put  # the room removes the player next; their chips stay in the pot
            self.in_hand.remove(p.id)
            if len(self.alive()) < 2:
                return self.award() if len(self.live()) == 1 else self.finish()
            if len(self.live()) == 1:
                return self.award()
            if was_turn:
                return self.after_action(p)
        elif len(self.alive()) < 2:
            self.finish()

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "chips"):
            return ""
        tag = " · folded" if p.g.folded and self.stage != "done" else " · all-in" if p.g.allin and self.stage != "done" else ""
        return f"💰{p.g.chips:,}{tag}"

    def final_scores(self):
        return {i: self.pl(i).g.chips for i in self.seats if self.pl(i)}

    def view(self, p):
        over = self.room.phase == "over"
        seats = []
        for i in self.seats:
            o = self.pl(i)
            if not o:
                continue
            seats.append({
                "id": i, "chips": o.g.chips, "bet": o.g.bet, "folded": o.g.folded, "allin": o.g.allin,
                "out": o.eliminated, "inHand": i in getattr(self, "in_hand", []), "last": self.last_act.get(i, ""),
                "button": i == self.seats[self.dealer], "sb": i == getattr(self, "sb_id", None), "bb": i == getattr(self, "bb_id", None),
            })
        mine = p.id in self.seats and not p.eliminated
        me = p.g if mine else None
        sb, bb = self.blinds() if self.hand_no else BLINDS[0]
        return {"holdem": {
            "stage": self.stage, "hand": self.hand_no, "board": self.board, "pot": self.pot() if self.hand_no else 0,
            "seats": seats, "blinds": [sb, bb], "pace": self.s["pace"], "curBet": self.cur_bet if self.hand_no else 0,
            "shown": self.shown, "result": self.result,
            "best5": getattr(self, "best5", []), "winners": getattr(self, "winners", []),
            "canShow": self.stage == "done" and not self.shown and self.live() == [p.id] and self.room.phase == "playing",
            "history": [{"n": e["n"], "board": e["board"], "result": e["result"], "shown": e["shown"],
                         "mine": e["cards"].get(p.id, [])} for e in getattr(self, "history", [])],
            "myCards": p.g.cards if p.id in self.seats and hasattr(p.g, "cards") else [],
            "myHand": describe(p.g.cards + list(self.board)) if p.id in self.seats and getattr(p.g, "cards", None) else "",
            "myCat": evaluate(p.g.cards + list(self.board))[0] if p.id in self.seats and getattr(p.g, "cards", None) else None,
            "toCall": max(0, self.cur_bet - me.bet) if me and self.stage != "done" else 0,
            "minRaise": min(self.cur_bet + self.min_raise, me.bet + me.chips) if me and self.stage != "done" else 0,
            "maxRaise": me.bet + me.chips if me else 0, "myBet": me.bet if me else 0,
            "bank": getattr(p.g, "bank", 0) if mine and self.room.settings.get("timer") else None,
            "canRebuy": self.can_rebuy(p), "rebuysLeft": getattr(p.g, "rebuys", 0) if p.id in self.seats else 0,
            "rebuyWait": self.stage == "done" and len(self.alive()) < 2,
            "reveal": {i: self.pl(i).g.cards for i in self.seats if self.pl(i) and over and hasattr(self.pl(i).g, "cards")
                       and i in getattr(self, "in_hand", []) and not self.pl(i).g.folded},
        }}

    # -- bots: equity from their own cards and the board only, against pot odds

    def bot_ready(self):
        return self.stage != "done" and super().bot_ready()

    def bot_turn(self, p):
        level = p.bot
        opponents = len(self.live()) - 1
        trials = {"easy": 60, "normal": 220, "hard": 450}[level]
        eq = equity(p.g.cards, self.board, max(1, opponents), trials, random)
        if level == "easy":
            eq += random.uniform(-0.15, 0.15)
        to_call = self.cur_bet - p.g.bet
        pot = self.pot()
        odds = to_call / (pot + to_call) if to_call else 0
        fair = 1 / (opponents + 1)  # an average hand's share
        strong = eq > max(0.5, fair * {"easy": 2.2, "normal": 1.8, "hard": 1.6}[level])
        bluff = level != "easy" and to_call == 0 and random.random() < {"normal": 0.06, "hard": 0.12}[level] and opponents <= 2
        if (strong or bluff) and p.g.chips > to_call:
            frac = random.choice([0.5, 0.75, 1.0]) if level != "easy" else 1.0
            to = self.cur_bet + max(self.min_raise, int(pot * frac))
            if level == "hard" and eq > 0.85 and self.stage == "river":
                to = p.g.bet + p.g.chips  # shove the nuts on the river
            # don't keep re-raising forever: past three bets, just call strong hands
            if self.cur_bet >= 8 * self.blinds()[1] and eq < 0.8:
                return self.call(p) if to_call else self.check(p)
            return self.raise_to(p, to)
        margin = {"easy": -0.08, "normal": 0.0, "hard": 0.03}[level]
        if to_call == 0:
            return self.check(p)
        if eq >= odds + margin:
            return self.call(p)
        return self.fold(p)
