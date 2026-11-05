"""Contract Rummy: the traditional rummy game where each hand demands a "contract" (public domain;
it's the family that several branded games grew from).

Two decks plus four jokers (wild). Each hand everyone is dealt 10 cards (12 from the fourth hand) and
works on the same contract, e.g. "two sets of 3" or "a set of 3 and a run of 4". A set is 3+ cards
of one rank; a run is 4+ cards of one suit in sequence (ace low or high). Each meld needs at least two
real cards. On your turn draw from the deck or the discard pile, then you may lay down the whole
contract at once; after that you may also add cards to anyone's melds. End by discarding. The first
player with no cards ends the hand; everyone else scores their cards (2–9: 5, 10–K: 10, ace: 15,
joker: 25). Lowest total after the last hand wins.

Cards are 3-character ids: rank (A23456789TJQK, X = joker), suit (SHDC, J for jokers), deck number."""
import random
import time
from collections import Counter
from itertools import combinations, product

from .base import Game, GameError

RANKS = "A23456789TJQK"
SUITS = "SHDC"
CONTRACTS = [(2, 0), (1, 1), (0, 2), (3, 0), (2, 1), (1, 2), (0, 3)]  # (sets of 3, runs of 4)
TURN_CAP = 300   # turns in one hand before it's called off (nobody can go out)


def is_joker(c):
    return c[0] == "X"


def points(c):
    if is_joker(c):
        return 25
    if c[0] == "A":
        return 15
    return 10 if c[0] in "TJQK" else 5


def rank_value(r):
    return RANKS.index(r) + 1   # A = 1 … K = 13


def contract_text(k, m):
    parts = []
    if k:
        parts.append(f"{'one' if k == 1 else 'two' if k == 2 else 'three'} set{'s' if k > 1 else ''} of 3")
    if m:
        parts.append(f"{'one' if m == 1 else 'two' if m == 2 else 'three'} run{'s' if m > 1 else ''} of 4")
    return " and ".join(parts)


def valid_set(cards):
    nat = [c for c in cards if not is_joker(c)]
    return len(cards) >= 3 and len(nat) >= 2 and len({c[0] for c in nat}) == 1


def run_order(cards):
    """The run's cards in sequence (jokers filling gaps), or None if it isn't a valid run."""
    nat = [c for c in cards if not is_joker(c)]
    jokers = [c for c in cards if is_joker(c)]
    if len(cards) < 4 or len(nat) < 2 or len({c[1] for c in nat}) != 1 or len(cards) > 13:
        return None
    for ace_high in (False, True):
        vals = sorted((14 if ace_high and c[0] == "A" else rank_value(c[0]), c) for c in nat)
        nums = [v for v, _ in vals]
        if len(set(nums)) != len(nums):
            continue
        lo, hi = nums[0], nums[-1]
        gaps = hi - lo + 1 - len(nums)
        extra = len(jokers) - gaps
        if extra < 0:
            continue
        top = 14 if ace_high else 13
        up = min(extra, top - hi)
        down = extra - up
        if lo - down < (2 if ace_high else 1):
            continue
        seq, js, by = [], list(jokers), dict(vals)
        for v in range(lo - down, hi + up + 1):
            seq.append(by[v] if v in by else js.pop())
        return seq
    return None


def valid(kind, cards):
    return valid_set(cards) if kind == "set" else run_order(cards) is not None


WILD = "*"  # a placeholder for "any joker" in candidate melds


def candidate_melds(hand):
    """Minimal 3-card sets and 4-card runs makeable from the hand (fewest jokers first); jokers
    appear as WILD and get real joker cards in find_contract."""
    jokers = [WILD] * sum(1 for c in hand if is_joker(c))
    nat = [c for c in hand if not is_joker(c)]
    by_rank = {}
    for c in nat:
        by_rank.setdefault(c[0], []).append(c)
    sets, runs = [], []
    for r, cs in by_rank.items():
        cs = sorted(cs)[:6]
        sets += [tuple(t) for t in combinations(cs, 3)]
        if jokers:
            sets += [(a, b, WILD) for a, b in combinations(cs, 2)]
    for s in SUITS:
        have = {}  # value -> both copies of that card (two decks)
        for c in sorted(nat):
            if c[1] == s:
                have.setdefault(rank_value(c[0]), []).append(c)
                if c[0] == "A":
                    have.setdefault(14, []).append(c)
        for start in range(1, 12):
            window = [v for v in range(start, start + 4) if v in have]
            if len(window) < 2 or 4 - len(window) > len(jokers):
                continue
            for pick in product(*[have[v][:2] for v in window]):
                if len(set(pick)) == len(pick):
                    runs.append(tuple(pick) + (WILD,) * (4 - len(pick)))
    key = lambda m: m.count(WILD)
    return sorted(set(sets), key=key), sorted(set(runs), key=key)


def find_contract(hand, k, m):
    """A list of (kind, cards) meeting the contract, or None."""
    sets, runs = candidate_melds(hand)
    need = ["set"] * k + ["run"] * m
    count = Counter(hand)
    count[WILD] = sum(1 for c in hand if is_joker(c))

    def dfs(i, used, out):
        if i == len(need):
            return out
        pool = sets if need[i] == "set" else runs
        for meld in pool:
            u = used + Counter(meld)
            if all(u[c] <= count[c] for c in u):
                got = dfs(i + 1, u, out + [(need[i], list(meld))])
                if got:
                    return got
        return None
    found = dfs(0, Counter(), [])
    if not found:
        return None
    jokers = [c for c in hand if is_joker(c)]
    return [(kind, [jokers.pop() if c == WILD else c for c in cs]) for kind, cs in found]


class Rummy(Game):
    id = "rummy"
    category = "cards"
    howto = [
        "Every hand has a contract, like two sets of 3 or a set of 3 and a run of 4. Sets: same rank. Runs: same suit in sequence. Jokers are wild (each meld needs two real cards).",
        "Your turn: draw from the deck or take the top discard, then end by discarding one card.",
        "Lay down the whole contract at once (select cards, tap Set or Run, then Lay down). After that you can add cards to any meld on the table.",
        "Empty your hand to end it. Everyone else scores what they hold: 2–9 = 5, 10–K = 10, A = 15, joker = 25.",
        "Lowest total after the last hand wins.",
        "With 🙋 May I? on, before the next player draws you can buy the top discard out of turn; you take a penalty card from the deck with it (3 buys a hand).",
    ]
    name = "Contract Rummy"
    icon = "🀄"
    blurb = "Rummy with a new contract every hand: sets, runs, jokers, and the lowest score wins."
    min_players = 2
    max_players = 6
    settings_schema = {
        "hands": ("Hands", [(7, "All 7 contracts"), (4, "First 4 (quick)")], 7),
        "mayi": ("🙋 May I?", [(False, "Off"), (True, "On: buy the discard out of turn (+1 penalty card, 3 a hand)")], False),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.scores = [0] * len(seated)
        self.hand_no = 0
        self.dealer = len(seated) - 1
        self.room.add_log(f"🀄 Contract Rummy: {self.s['hands']} hands. Lowest total wins.", "big")
        self.deal()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def deal(self):
        n = len(self.seats)
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % n
        self.k, self.m = CONTRACTS[self.hand_no - 1]
        deck = [r + s + str(d) for d in (0, 1) for s in SUITS for r in RANKS] + [f"XJ{j}" for j in range(4)]
        self.rng.shuffle(deck)
        size = 10 if self.hand_no <= 3 else 12
        self.hands = [[deck.pop() for _ in range(size)] for _ in range(n)]
        self.deck = deck
        self.discard = [self.deck.pop()]
        self.melds = []      # [{"kind", "cards", "owner"}]
        self.down = [False] * n
        self.drawn = False
        self.turns = 0
        self.last_hand = None
        self.buys = [0] * n         # 🙋 May I? buys this hand
        self.thrower = None         # who threw the top discard (they can't buy it back)
        self.room.add_log(f"🀄 Hand {self.hand_no}: {contract_text(self.k, self.m)}.", "big")
        self.room.begin_turn(self.seats[(self.dealer + 1) % n])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- moves

    def draw(self, i, source):
        p = self.pl(i)
        if source == "discard" and self.discard:
            c = self.discard.pop()
            self.room.add_log(f"🃏 {p.name if p else '?'} takes the {self.pretty(c)}.", "question")
        else:
            self.bots_buy()  # passing the discard up gives the bots a chance to call May I?
            if not self.deck:
                if not self.discard:
                    raise GameError("No cards left to draw.")
                top = self.discard.pop()
                self.deck = self.discard
                self.rng.shuffle(self.deck)
                self.discard = [top]
                self.room.add_log("🔀 The discards are shuffled into a new deck.")
            c = self.deck.pop()
            self.room.add_log(f"🃏 {p.name if p else '?'} draws from the deck.", "question")
        self.hands[i].append(c)
        self.drawn = True
        return c

    def lay_down(self, i, groups):
        hand = Counter(self.hands[i])
        used = Counter(c for _, cs in groups for c in cs)
        if any(used[c] > hand[c] for c in used):
            raise GameError("Those cards aren't all in your hand.")
        kinds = Counter(kind for kind, _ in groups)
        if kinds["set"] != self.k or kinds["run"] != self.m:
            raise GameError(f"This hand's contract is {contract_text(self.k, self.m)}.")
        for kind, cs in groups:
            if not valid(kind, cs):
                raise GameError(f"That {kind} isn't valid.")
            if kind == "set" and len(cs) < 3 or kind == "run" and len(cs) < 4:
                raise GameError("Sets need 3 cards and runs 4.")
        for kind, cs in groups:
            for c in cs:
                self.hands[i].remove(c)
            self.melds.append({"kind": kind, "cards": run_order(cs) if kind == "run" else cs, "owner": i})
        self.down[i] = True
        p = self.pl(i)
        self.room.add_log(f"🎉 {p.name if p else '?'} lays down the contract!", "power")

    def add_to(self, i, idx, cards):
        meld = self.melds[idx]
        new = meld["cards"] + cards
        if not valid(meld["kind"], new):
            raise GameError(f"Those cards don't fit that {meld['kind']}.")
        for c in cards:
            self.hands[i].remove(c)
        meld["cards"] = run_order(new) if meld["kind"] == "run" else new
        p = self.pl(i)
        self.room.add_log(f"➕ {p.name if p else '?'} adds {' '.join(self.pretty(c) for c in cards)} to a {meld['kind']}.")

    def throw(self, i, card):
        self.hands[i].remove(card)
        self.discard.append(card)
        self.thrower = i
        p = self.pl(i)
        self.room.add_log(f"🗑️ {p.name if p else '?'} discards the {self.pretty(card)}.", "question")
        self.end_turn(i)

    def end_turn(self, i):
        self.drawn = False
        self.turns += 1
        if not self.hands[i]:
            return self.end_hand(i)
        if self.turns >= TURN_CAP:
            self.room.add_log("⏳ Nobody can go out — the hand is called off.", "power")
            return self.end_hand(None)
        self.room.advance()

    def end_hand(self, out):
        r = self.room
        got = [sum(points(c) for c in h) for h in self.hands]
        for j, g in enumerate(got):
            self.scores[j] += g
        names = [self.pl(j).name if self.pl(j) else "?" for j in range(len(self.seats))]
        if out is not None:
            r.add_log(f"🏁 {names[out]} goes out!", "big")
        r.add_log("🧮 " + " · ".join(f"{names[j]} +{got[j]} ({self.scores[j]})" for j in range(len(got))))
        self.last_hand = got
        # what everyone was caught holding, for the recap between hands (deal() starts the next hand at once)
        self.recap = {"hand": self.hand_no, "out": out, "got": got,
                      "cards": [sorted(h, key=self.sort_key) for h in self.hands], "totals": list(self.scores)}
        if self.hand_no >= self.s["hands"]:
            low = min(self.scores)
            best = [j for j, v in enumerate(self.scores) if v == low]
            if len(best) == 1:
                return r.finish(self.pl(best[0]), f"🏆 {names[best[0]]} wins Contract Rummy with {low}!")
            return r.finish(None, f"🤝 A tie at {low} between {' & '.join(names[j] for j in best)}.")
        self.deal()

    @staticmethod
    def pretty(c):
        if is_joker(c):
            return "🃏"
        return ("10" if c[0] == "T" else c[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[c[1]]

    # -- actions

    def act(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        if a.get("type") == "mayi":
            return self.may_i(i)
        self.require_turn(p)
        t = a.get("type")
        hand = self.hands[i]
        cards_ok = lambda cs: isinstance(cs, list) and cs and all(isinstance(c, str) for c in cs) and all(
            Counter(cs)[c] <= Counter(hand)[c] for c in cs)
        if t == "draw":
            if self.drawn:
                raise GameError("You've already drawn.")
            src = a.get("from")
            if src not in ("deck", "discard") or (src == "discard" and not self.discard):
                raise GameError("Draw from the deck or the discard pile.")
            return self.draw(i, src)
        if not self.drawn:
            raise GameError("Draw a card first.")
        if t == "laydown":
            if self.down[i]:
                raise GameError("You've already laid down this hand.")
            groups = a.get("groups")
            if not isinstance(groups, list) or not all(isinstance(g, dict) and g.get("kind") in ("set", "run")
                                                       and cards_ok(g.get("cards")) for g in groups):
                raise GameError("Bad melds.")
            self.lay_down(i, [(g["kind"], list(g["cards"])) for g in groups])
            if not self.hands[i]:
                self.end_turn(i)
            return
        if t == "add":
            if not self.down[i]:
                raise GameError("Lay down your contract first.")
            idx, cs = a.get("meld"), a.get("cards")
            if not isinstance(idx, int) or not 0 <= idx < len(self.melds) or not cards_ok(cs):
                raise GameError("Pick cards and a meld.")
            self.add_to(i, idx, list(cs))
            if not self.hands[i]:
                self.end_turn(i)
            return
        if t == "discard":
            c = a.get("card")
            if c not in hand:
                raise GameError("Pick a card to discard.")
            return self.throw(i, c)
        raise GameError("Unknown action.")

    def can_buy(self, i):
        turn = self.seats.index(self.room.turn) if self.room.turn in self.seats else None
        return (self.s.get("mayi") and turn is not None and i != turn and not self.drawn and self.discard
                and getattr(self, "thrower", None) != i and getattr(self, "buys", [0] * len(self.seats))[i] < 3)

    def may_i(self, i):
        """🙋 May I? Out of turn, before the next player draws: take the top discard, plus a penalty card."""
        if not self.s.get("mayi"):
            raise GameError("May I? is off in this game.")
        if not self.can_buy(i):
            raise GameError("You can't buy the discard right now.")
        c = self.discard.pop()
        self.hands[i].append(c)
        if not self.deck:
            self.deck, self.discard = self.discard, []
            self.rng.shuffle(self.deck)
        if self.deck:
            self.hands[i].append(self.deck.pop())
        self.buys[i] += 1
        self.thrower = None  # what's left on the pile is an older card
        p = self.pl(i)
        self.room.add_log(f"🙋 {p.name if p else '?'}: May I? Buys the {self.pretty(c)} (+1 penalty card).", "power")

    def bots_buy(self):
        """Before the player whose turn it is draws from the deck, a bot may buy the discard they passed up."""
        top = self.discard[-1] if self.discard else None
        if not self.s.get("mayi") or top is None:
            return
        for j in range(len(self.seats)):
            if self.auto(j) and self.pl(j) and self.can_buy(j) and not self.down[j]:
                level = self.pl(j).bot or "normal"
                if (is_joker(top) or self.wants(j, top, level)) and random.random() < {"easy": 0.3, "normal": 0.6, "hard": 0.85}[level]:
                    return self.may_i(j)

    def peek(self, p, a):
        """💡 Find my contract: the melds in your hand that meet this hand's contract, if there are any."""
        i = self.seat(p)
        if a.get("what") != "contract" or i is None or self.down[i]:
            raise GameError("No hint right now.")
        found = find_contract(self.hands[i], self.k, self.m)
        return {"groups": [{"kind": k, "cards": cs} for k, cs in found] if found else None}

    def on_timeout(self):
        r = self.room
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.pl(i).name} ran out of time.", "power")
        if not self.drawn:
            self.draw(i, "deck")
        self.throw(i, self.choose_discard(i, "easy"))

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left; their seat plays on by itself.")
        left = r.contenders()
        if len(left) < 2:
            return r.finish(left[0] if left else None, "🏳️ Everyone else left.")

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🀄 {self.scores[i]}" + (" ✅" if self.down[i] else "")

    def final_scores(self):
        return {pid: self.scores[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        mine = i is not None and self.room.turn == p.id
        return {"rummy": {
            "seats": self.seats, "me": i, "hand": sorted(self.hands[i], key=self.sort_key) if i is not None else [],
            "counts": [len(h) for h in self.hands], "top": self.discard[-1] if self.discard else None,
            "deck": len(self.deck), "melds": self.melds, "down": self.down, "scores": self.scores,
            "handNo": self.hand_no, "hands": self.s["hands"], "contract": [self.k, self.m],
            "contractText": contract_text(self.k, self.m), "drawn": self.drawn and mine, "last": self.last_hand,
            "recap": getattr(self, "recap", None), "mayi": bool(self.s.get("mayi")),
            "canBuy": bool(i is not None and self.can_buy(i)), "buysLeft": 3 - getattr(self, "buys", [0] * len(self.seats))[i] if i is not None else 0,
        }}

    @staticmethod
    def sort_key(c):
        return (1, 0, c) if is_joker(c) else (0, SUITS.index(c[1]), rank_value(c[0]), c)

    # -- bots

    def auto(self, i):
        p = self.pl(i)
        return p is None or bool(p.bot) or p.eliminated

    def bot_ready(self):
        if self.room.phase != "playing" or self.room.turn not in self.seats:
            return False
        return self.auto(self.seats.index(self.room.turn))

    def bot_tick(self):
        i = self.seats.index(self.room.turn)
        p = self.pl(i)
        level = p.bot if p and p.bot else "normal"
        hand = self.hands[i]
        if not self.drawn:
            top = self.discard[-1] if self.discard else None
            take = top is not None and not is_joker(top) and self.wants(i, top, level) or (top is not None and is_joker(top))
            self.draw(i, "discard" if take else "deck")
            self.room.bot_at = time.time() + 0.7
            return
        if not self.down[i]:
            found = find_contract(hand, self.k, self.m)
            if found and (level != "easy" or random.random() < 0.8):
                self.lay_down(i, found)
                if not self.hands[i]:
                    return self.end_turn(i)
        if self.down[i]:
            progress = True
            while progress and self.hands[i]:
                progress = False
                for c in list(self.hands[i]):
                    if len(self.hands[i]) == 1 and not is_joker(c):
                        break  # keep a card to discard and go out with
                    for idx, meld in enumerate(self.melds):
                        if valid(meld["kind"], meld["cards"] + [c]):
                            self.add_to(i, idx, [c])
                            progress = True
                            break
            if not self.hands[i]:
                return self.end_turn(i)
        self.throw(i, self.choose_discard(i, level))

    def usefulness(self, hand, c, level):
        """How much a card helps toward the contract: a pair or trio of its rank (more copies add
        nothing), and same-suit neighbours for runs. An exact duplicate is worth less."""
        if is_joker(c):
            return 100
        others = [x for x in hand if x != c and not is_joker(x)]
        same_rank = min(2, sum(1 for x in others if x[0] == c[0]))
        v = rank_value(c[0])
        vals = {14 if x[0] == "A" and v > 7 else rank_value(x[0]) for x in others if x[1] == c[1] and x[0] != c[0]}
        if c[0] == "A" and any(rank_value(x[0]) > 9 for x in others if x[1] == c[1]):
            v = 14
        near = min(4, sum({1: 2, 2: 1, 3: 0.5}.get(abs(w - v), 0) for w in vals))
        dup = any(x[:2] == c[:2] for x in others)
        # weight pairs when the contract wants sets, and neighbours when it wants runs
        ws, wr = (0.3 + self.k, 0.3 + self.m) if level == "hard" else (0.5 + (self.k > 0), 0.5 + (self.m > 0))
        return 3 * same_rank * ws + near * wr - (1.5 if dup else 0)

    def wants(self, i, card, level):
        hand = self.hands[i]
        if level == "easy":
            return random.random() < 0.25
        if self.down[i]:
            return any(valid(m["kind"], m["cards"] + [card]) for m in self.melds)
        if not find_contract(hand, self.k, self.m) and find_contract(hand + [card], self.k, self.m):
            return True
        if self.usefulness(hand + [card], card, level) < (4 if level == "hard" else 5):
            return False
        # don't take a card you'd throw straight back (two bots would pass it back and forth forever)
        self.hands[i] = hand + [card]
        try:
            return self.choose_discard(i, level) != card
        finally:
            self.hands[i] = hand

    def choose_discard(self, i, level):
        hand = self.hands[i]
        if level == "easy" and random.random() < 0.4:
            plain = [c for c in hand if not is_joker(c)] or hand
            return random.choice(plain)
        if self.down[i]:
            fits = lambda c: any(valid(m["kind"], m["cards"] + [c]) for m in self.melds)
            loose = [c for c in hand if not fits(c)] or hand
            return max(loose, key=lambda c: (not is_joker(c), points(c)))
        keep = set()
        found = find_contract(hand, self.k, self.m)
        if found:
            keep = {c for _, cs in found for c in cs}
        options = [c for c in hand if c not in keep] or hand
        return min(options, key=lambda c: (self.usefulness(hand, c, level), -points(c)))
