"""Ranter-Go-Round (Chase the Ace, Cuckoo): one card each, swap or keep, and don't be lowest. 3-6 players.

Everyone gets one card, face down. Starting left of the dealer, each player may keep it or swap it
with the player on their left. A king can't be taken: whoever holds one shows it and the swap is
refused. The dealer, last, may swap with the top of the deck instead. Then all cards are shown and the
lowest (ace is low) loses a life. Three lives; the last player in wins."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty

ORDER = "A23456789TJQK"


def low(c):
    return ORDER.index(rank(c))


class Ranter(CardGame):
    id = "ranter"
    solo_bots = 3
    name = "Ranter-Go-Round"
    icon = "🔄"
    blurb = "Chase the Ace: one card each, swap it with your neighbour or keep it, and don't be the lowest."
    howto = [
        "Everyone gets one card. Starting left of the dealer, keep it or swap with the player on your left.",
        "A king blocks: you can't take it, and its holder shows it.",
        "The dealer goes last and may swap with the top of the deck.",
        "Cards up: the lowest (ace is low) loses a life. Ties all lose one.",
        "Last player with a life wins.",
        "An option, Ace of Doom: if the lowest card is an ace, its holders lose two lives.",
    ]
    min_players, max_players = 3, 6
    badges = {**CardGame.badges, "escape": ("🏃", "Great escape", "Swap away an ace")}
    settings_schema = {"doom": ("Ace of Doom", [(0, "Off"), (1, "On: lowest ace costs 2 lives")], 0),
                       "lives": ("Lives", [(3, "3 lives"), (2, "2 lives (quick)"), (5, "5 lives")], 3)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.lives = [self.s.get("lives", 3)] * self.n
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"🔄 Ranter-Go-Round: {self.lives[0]} lives. Don't hold the lowest card!", "big")
        self.deal()

    def is_out(self, i):
        return self.lives[i] <= 0

    def deal(self):
        self.dealer = self.next_seat(self.dealer)
        cards = deck()
        self.rng.shuffle(cards)
        self.card = [None] * self.n
        for k in range(self.n):
            if not self.is_out(k):
                self.card[k] = cards.pop()
        self.deck = cards
        self.shown = set()           # kings shown, and cards everyone has seen
        self.seen = [set() for _ in range(self.n)]   # what each seat has seen (cards passed to them)
        self.reveal = None
        self.log = []
        self.stage = "swap"
        self.room.add_log("🃏 One card each.")
        self.to(self.next_seat(self.dealer))

    def left(self, i):
        return self.next_seat(i)

    def keep(self, i):
        self.log.append(f"{self.nm(i)} keeps")
        self.room.add_log(f"✋ {self.nm(i)} keeps their card.")
        self.advance(i)

    def swap(self, i):
        if i == self.dealer:
            c = self.deck.pop()
            if rank(c) == "A" and rank(self.card[i]) != "A":
                pass
            self.room.add_log(f"🔄 {self.nm(i)} swaps with the deck and gets {pretty(c)}.")
            self.card[i] = c
            return self.advance(i)
        j = self.left(i)
        if rank(self.card[j]) == "K":
            self.shown.add(j)
            self.room.add_log(f"👑 {self.nm(j)} shows a king: no swap for {self.nm(i)}!", "power")
            return self.advance(i)
        mine, theirs = self.card[i], self.card[j]
        if rank(mine) == "A" and self.pl(i):
            self.award(self.pl(i), "escape")
        self.card[i], self.card[j] = theirs, mine
        self.seen[j].add(mine)
        self.seen[i].add(theirs)
        self.room.add_log(f"🔄 {self.nm(i)} swaps with {self.nm(j)}.")
        self.advance(i)

    def advance(self, i):
        if i == self.dealer:
            return self.showdown()
        self.to(self.next_seat(i))

    def showdown(self):
        alive = [k for k in range(self.n) if not self.is_out(k)]
        lo = min(low(self.card[k]) for k in alive)
        losers = [k for k in alive if low(self.card[k]) == lo]
        doom = bool(self.s.get("doom")) and lo == 0
        for k in losers:
            self.lives[k] = max(0, self.lives[k] - (2 if doom else 1))
        self.reveal = {"cards": {k: self.card[k] for k in alive}, "losers": losers, "doom": doom}
        self.room.add_log("🂠 " + " · ".join(f"{self.nm(k)} {pretty(self.card[k])}" for k in alive) + (" (Ace of Doom: -2)" if doom else ""), "big")
        who = " & ".join(self.nm(k) for k in losers)
        if doom:
            self.moment(f"☠️ Ace of Doom! {who} lose{'s' if len(losers) == 1 else ''} two lives", "bad", "groan")
        else:
            self.moment(f"💔 {who} lose{'s' if len(losers) == 1 else ''} a life", "bad", "groan")
        left = [k for k in range(self.n) if not self.is_out(k)]
        if len(left) <= 1:
            w = left[0] if left else max(range(self.n), key=lambda k: low(self.card[k]) if self.card[k] else -1)
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} is the last one in and wins Ranter-Go-Round!")
        self.stage = "show"
        self.pause(self.deal, 3.5)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        if self.stage != "swap":
            raise GameError("Wait a moment.")
        t = a.get("type")
        if t == "keep":
            return self.keep(i)
        if t == "swap":
            return self.swap(i)
        raise GameError("Unknown action.")

    # -- bots

    def bot_move(self, i, level):
        if self.stage != "swap":
            return
        v = low(self.card[i])
        if rank(self.card[i]) == "K":
            return self.keep(i)
        if level == "easy":
            return self.swap(i) if v < 5 + random.randint(-2, 2) else self.keep(i)
        bar = 6
        if level == "hard":
            # what's been passed to me tells me the left neighbour holds something worse
            if self.seen[i] and any(low(c) < v for c in self.seen[i]) and i != self.dealer:
                return self.keep(i)
            alive = sum(1 for k in range(self.n) if not self.is_out(k))
            bar = 5 if alive >= 5 else 6 if alive >= 3 else 7
        return self.swap(i) if v < bar else self.keep(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else "❤️" * max(0, self.lives[i]) or "💀"

    def final_scores(self):
        return {pid: self.lives[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        rv = self.reveal if self.stage == "show" else None
        info = []
        for k in range(self.n):
            show = []
            if rv and k in rv["cards"]:
                show = [rv["cards"][k]]
            elif k in self.shown and self.card[k]:
                show = [self.card[k]]
            info.append({"tags": ["❤️" * max(0, self.lives[k]) or "💀 out"] + (["🎴 dealer"] if k == self.dealer else [])
                         + (["💔"] if rv and k in rv["losers"] else []), "show": show, "out": self.is_out(k)})
        t = {"info": info, "hand": [self.card[i]] if i is not None and self.card[i] else [],
             "piles": [{"cards": ["??"], "count": len(self.deck), "label": "Deck"}],
             "banner": ("Lowest: " + " & ".join(self.nm(k) for k in rv["losers"]) + (" (Ace of Doom: -2)" if rv.get("doom") else "")) if rv else None,
             "scores": {"title": "Lives", "rows": [{"seat": k, "value": "❤️" * max(0, self.lives[k]) or "💀"} for k in sorted(range(self.n), key=lambda k: -self.lives[k])],
                        "hint": "Ace is low, king is high. Kings block swaps."}}
        if i is not None and self.stage == "swap" and self.room.turn == p.id:
            who = "the deck" if i == self.dealer else self.nm(self.left(i))
            t["buttons"] = [{"label": "✋ Keep", "a": {"type": "keep"}}, {"label": f"🔄 Swap with {who}", "a": {"type": "swap"}, "kind": "primary"}]
            t["note"] = f"You hold {pretty(self.card[i])}. Keep it, or swap with {who}?"
            t["turnText"] = "🔄 Keep or swap?"
        return t
