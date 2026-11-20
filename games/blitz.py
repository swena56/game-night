"""Blitz (Thirty-One, Scat): get closest to 31 in one suit, for 2-6 players.

Three cards each and one face up to start the discard pile. On your turn take the top of the stock or
the discard, then throw one away. Your hand is worth the total of its cards in one suit (ace 11, faces
10). Think you're ahead? Knock instead of drawing: everyone else gets one last turn, then the lowest
hand loses a life (a knocker caught lowest loses two). Make exactly 31 and show it at once: Blitz!
everyone else loses a life. Three lives each; the last player with a life left wins."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show, GLYPH

VAL = {**{r: int(r) for r in "23456789"}, "T": 10, "J": 10, "Q": 10, "K": 10, "A": 11}


def is_trips(hand):
    return len(hand) == 3 and len({rank(c) for c in hand}) == 1


def value(hand, trips=False):
    best = 0
    for s in "CDHS":
        best = max(best, sum(VAL[rank(c)] for c in hand if suit(c) == s))
    if trips and is_trips(hand):
        best = max(best, 30)
    return best


class Blitz(CardGame):
    id = "blitz"
    name = "Blitz"
    icon = "⚡"
    blurb = "Thirty-One: draw and discard toward 31 in one suit, knock when you're ahead, and hang on to your lives."
    howto = [
        "Three cards each. Take the top of the stock or the discard, then throw one away.",
        "Your hand counts the cards of one suit: ace 11, faces 10, others their number.",
        "Knock instead of drawing: everyone else gets one more turn, then the lowest hand loses a life (a knocker caught lowest loses two).",
        "An option: three of a kind counts as 30, whatever the suits.",
        "Hit exactly 31: ⚡ Blitz! Everyone else loses a life on the spot.",
        "Three lives each. Last player with a life wins.",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "blitz": ("⚡", "Blitz!", "Hit exactly 31")}
    settings_schema = {"lives": ("Lives", [(3, "3 lives"), (2, "2 lives (quick)"), (4, "4 lives")], 3),
                       "trips": ("Three of a kind", [(1, "Counts 30"), (0, "Off")], 1)}

    def val(self, hand):
        return value(hand, self.s.get("trips", 1) != 0)

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.lives = [self.s.get("lives", 3)] * self.n
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"⚡ Blitz: {self.lives[0]} lives each. Get closest to 31 in one suit!", "big")
        self.deal()

    def is_out(self, i):
        return self.lives[i] <= 0

    def deal(self):
        self.dealer = self.next_seat(self.dealer)
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [[] for _ in range(self.n)]
        for k in range(self.n):
            if not self.is_out(k):
                self.hands[k], cards = cards[:3], cards[3:]
        self.discard = [cards[0]]
        self.stock = cards[1:]
        self.knocker = None
        self.last_turns = None
        self.reveal = None
        self.took = None
        self.stage = "draw"
        self.room.add_log(f"🃏 New hand. {self.nm(self.next_seat(self.dealer))} starts.")
        self.to(self.next_seat(self.dealer))
        for k in range(self.n):
            if not self.is_out(k) and self.val(self.hands[k]) == 31:
                return self.blitz(k)

    def draw(self, i, src):
        if src == "discard":
            c = self.discard.pop()
            self.took = c
        else:
            if not self.stock:
                self.stock = self.discard[:-1]
                self.discard = self.discard[-1:]
                self.rng.shuffle(self.stock)
            c = self.stock.pop()
            self.took = None
        self.hands[i].append(c)
        self.room.add_log(f"{self.nm(i)} takes {'the ' + pretty(c) if src == 'discard' else 'from the stock'}.")
        self.stage = "discard"

    def throw(self, i, c):
        self.hands[i].remove(c)
        self.discard.append(c)
        self.room.add_log(f"{self.nm(i)} throws {pretty(c)}.")
        if self.val(self.hands[i]) == 31:
            return self.blitz(i)
        self.next_turn(i)

    def knock(self, i):
        self.knocker = i
        self.moment(f"✊ {self.nm(i)} knocks! One last turn each.", "cool", "thud")
        self.next_turn(i)

    def next_turn(self, i):
        nxt = self.next_seat(i)
        if self.knocker is not None and nxt == self.knocker:
            return self.showdown()
        self.stage = "draw"
        self.took = None
        self.to(nxt)

    def blitz(self, i):
        if self.pl(i):
            self.award(self.pl(i), "blitz")
        self.moment(f"⚡ BLITZ! {self.nm(i)} has 31!", "gold", "fanfare")
        losers = [k for k in range(self.n) if k != i and not self.is_out(k)]
        for k in losers:
            self.lives[k] -= 1
        self.after_hand({k: 1 for k in losers}, f"Everyone else loses a life.")

    def showdown(self):
        vals = {k: self.val(self.hands[k]) for k in range(self.n) if not self.is_out(k)}
        low = min(vals.values())
        losers = [k for k, v in vals.items() if v == low]
        hit = {}
        for k in losers:
            n = 2 if k == self.knocker else 1
            self.lives[k] -= n
            hit[k] = n
        for k, v in vals.items():
            if is_trips(self.hands[k]) and v == 30 and value(self.hands[k]) < 30:
                self.moment(f"🎰 {self.nm(k)} shows three {rank(self.hands[k][0])}s: that counts 30!", "gold", "chime")
        self.room.add_log("🂠 " + " · ".join(f"{self.nm(k)} {v}" for k, v in vals.items()), "big")
        self.after_hand(hit, " & ".join(self.nm(k) + (" (the knocker!)" if k == self.knocker else "") for k in losers) + f" lose{'s' if len(losers) == 1 else ''} a life with {low}.")

    def after_hand(self, hit, text):
        self.reveal = {"hands": {k: self.hands[k][:] for k in range(self.n) if self.hands[k]}, "hit": hit, "text": text}
        self.room.add_log(text, "power")
        for k in hit:
            if self.lives[k] <= 0:
                self.moment(f"💀 {self.nm(k)} is out!", "bad", "groan")
        alive = [k for k in range(self.n) if not self.is_out(k)]
        if len(alive) <= 1:
            if alive:
                return self.room.finish(self.pl(alive[0]), f"🏆 {self.nm(alive[0])} is the last one with a life and wins Blitz!")
            best = max(range(self.n), key=lambda k: (self.lives[k], self.val(self.hands[k])))
            return self.room.finish(self.pl(best), f"🏆 {self.nm(best)} wins Blitz!")
        self.stage = "show"
        self.pause(self.deal, 4)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        if t == "draw" and self.stage == "draw":
            src = a.get("from")
            if src not in ("stock", "discard"):
                raise GameError("Draw from the stock or the discard.")
            return self.draw(i, src)
        if t == "knock" and self.stage == "draw":
            if self.knocker is not None:
                raise GameError("Someone already knocked.")
            return self.knock(i)
        if t == "discard" and self.stage == "discard":
            c = a.get("card")
            if c not in self.hands[i]:
                raise GameError("That card isn't in your hand.")
            if c == self.took:
                raise GameError("You can't throw back the card you just took.")
            return self.throw(i, c)
        raise GameError("Not now.")

    # -- bots

    def bot_move(self, i, level):
        hand = self.hands[i]
        if self.stage == "draw":
            v = self.val(hand)
            bar = {"easy": random.randint(20, 27), "normal": 26, "hard": 25 if self.alive_count() > 3 else 27}[level]
            if self.knocker is None and v >= bar and (level != "hard" or self.turns_in() > 0):
                return self.knock(i)
            top = self.discard[-1]
            best_with = max(self.val([x for x in hand + [top] if x != d]) for d in hand)
            if best_with > v + (0 if level == "hard" else 2) and (level != "easy" or random.random() < 0.6):
                return self.draw(i, "discard")
            return self.draw(i, "stock")
        if self.stage == "discard":
            opts = [c for c in hand if c != self.took]
            if level == "easy" and random.random() < 0.3:
                return self.throw(i, random.choice(opts))
            return self.throw(i, max(opts, key=lambda c: (self.val([x for x in hand if x != c]), -VAL[rank(c)])))

    def alive_count(self):
        return sum(1 for k in range(self.n) if not self.is_out(k))

    def turns_in(self):
        return len(self.discard) - 1

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else "❤️" * max(0, self.lives[i]) or "💀"

    def final_scores(self):
        return {pid: self.lives[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]) if not self.is_out(k) else None, "out": self.is_out(k),
                 "tags": ["❤️" * max(0, self.lives[k]) or "💀 out"] + (["✊ knocked"] if k == self.knocker else []),
                 "show": self.reveal["hands"].get(k, []) if self.reveal and self.stage == "show" else []} for k in range(self.n)]
        mine = i is not None and self.room.turn == p.id
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": ["??"], "count": len(self.stock), "label": "Stock", "act": {"type": "draw", "from": "stock"} if mine and self.stage == "draw" else None},
                       {"cards": self.discard[-1:], "label": "Discard", "act": {"type": "draw", "from": "discard"} if mine and self.stage == "draw" else None}],
             "scores": {"title": "Lives", "rows": [{"seat": k, "value": "❤️" * max(0, self.lives[k]) or "💀"} for k in sorted(range(self.n), key=lambda k: -self.lives[k])],
                        "hint": "Ace 11, faces 10. Only one suit counts" + (" (three of a kind = 30)." if self.s.get("trips", 1) != 0 else ".")}}
        if self.reveal and self.stage == "show":
            t["banner"] = self.reveal["text"]
        if self.knocker is not None and self.stage != "show":
            t["banner"] = f"✊ {self.nm(self.knocker)} knocked: last turns!"
        if i is not None and self.hands[i]:
            v = self.val(self.hands[i])
            best = max("CDHS", key=lambda s: sum(VAL[rank(c)] for c in self.hands[i] if suit(c) == s))
            if self.s.get("trips", 1) != 0 and is_trips(self.hands[i]) and v == 30 and value(self.hands[i]) < 30:
                t["note"] = f"Your hand: 30 (three {rank(self.hands[i][0])}s)."
            else:
                t["note"] = f"Your hand: {v} in {GLYPH[best]}."
        if mine and self.stage == "draw":
            t["buttons"] = [{"label": "✊ Knock", "a": {"type": "knock"}}] if self.knocker is None else []
            t["turnText"] = "🃏 Draw, or knock"
            t["note"] = (t.get("note") or "") + " Take the stock or the discard."
        elif mine and self.stage == "discard":
            t["moves"] = [{"card": c, "a": {"type": "discard", "card": c}} for c in self.hands[i] if c != self.took]
            t["turnText"] = "🗑️ Throw one away"
        return t
