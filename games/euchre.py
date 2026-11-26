"""Euchre: the 24-card partnership game, for 4 players in two teams (partners sit opposite).

Five cards each from the 9s up; the next card is turned up. Going round once, each player may "order
it up": that suit becomes trumps and the dealer takes the card (discarding one). If everyone passes,
going round again each may name any other suit; with 🔒 stick the dealer, the dealer must then name
one. The jack of trumps (right bower) is the top trump, then the other jack of the same colour (left
bower, which counts as a trump), then A K Q 10 9. Follow suit if you can. The makers need 3 tricks:
1 point, or 2 for all five (4 going alone); fail and the other side scores 2 (euchred!). First to 10."""
import random

from .cardbase import GameError, rank, suit, show, pretty, SUIT_NAME, GLYPH
from .tricks import TrickGame

RANKS = "9TJQKA"
SAME = {"S": "C", "C": "S", "H": "D", "D": "H"}


class Euchre(TrickGame):
    id = "euchre"
    solo_bots = 3
    name = "Euchre"
    icon = "🃎"
    blurb = "Order up trumps with your partner; the two jacks rule. Take three of five tricks or get euchred."
    howto = [
        "Two teams, partners opposite. Five cards each from 9 to ace; one card is turned up.",
        "Round one: order it up (that suit is trumps, the dealer takes the card) or pass. Round two: name another suit or pass.",
        "Trumps: the jack of trumps is highest, then the other jack of the same colour, then A K Q 10 9.",
        "Makers take 3 or 4 tricks: 1 point. All five: 2 (4 alone). Fewer than 3: the other side scores 2.",
        "First team to 10 points wins.",
        "An option: a trick won with the 9 of trumps earns its team 1 extra point, whoever made trumps.",
    ]
    min_players, max_players = 4, 4
    teams = True
    order = RANKS
    badges = {**TrickGame.badges, "loner": ("🦅", "Lone wolf", "Go alone and take all five tricks"),
              "euchre": ("💥", "Euchred them", "Defend and stop the makers")}
    settings_schema = {
        "target": ("Game to", [(10, "10 points"), (5, "5 points (quick)")], 10),
        "stick": ("🔒 Stick the dealer", [(True, "Dealer must call in round two"), (False, "Redeal if all pass")], True),
        "nine": ("🪶 Nine lives", [(False, "Off"), (True, "On: 9 of trumps wins = +1")], False),
    }
    nine = None   # the team (0/1) whose 9 of trumps took a trick this hand (🪶 Nine lives)

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.team_score = [0, 0]
        self.dealer = rng.randrange(4)
        self.alone = None
        self.room.add_log(f"🃎 Euchre to {self.s['target']}: {self.nm(0)} & {self.nm(2)} against {self.nm(1)} & {self.nm(3)}.", "big")
        self.deal()

    # -- bowers

    def suit_of(self, c):
        if self.trump and rank(c) == "J" and suit(c) == SAME[self.trump]:
            return self.trump
        return suit(c)

    def power(self, c):
        if self.trump and rank(c) == "J":
            if suit(c) == self.trump:
                return 20
            if suit(c) == SAME[self.trump]:
                return 19
        return RANKS.index(rank(c))

    def make_deck(self):
        return [r + s for s in "CDHS" for r in RANKS]

    def full_deck(self):
        return set(self.make_deck())

    # -- the deal and the calling

    def deal(self):
        self.dealer = (self.dealer + 1) % 4
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 5:(k + 1) * 5] for k in range(4)]
        self.up = cards[20]
        self.trump = None
        self.maker = None
        self.alone = None
        self.nine = None
        self.round = 1
        self.passes = 0
        self.tricks = [0] * 4
        self.trick, self.last = [], None
        for k in range(4):
            self.sort_hand(k)
        self.stage = "call"
        self.room.add_log(f"🃏 {self.nm(self.dealer)} deals. {pretty(self.up)} is turned up.")
        self.to((self.dealer + 1) % 4)

    def call(self, i, s, alone=False):
        self.trump = s
        self.maker = i
        self.alone = i if alone else None
        how = "orders it up" if self.round == 1 else f"names {SUIT_NAME[s]}"
        self.room.add_log(f"🎺 {self.nm(i)} {how}: {GLYPH[s]} trumps{' and goes ALONE' if alone else ''}.", "big")
        if self.round == 1:
            self.hands[self.dealer].append(self.up)
            self.sort_hand(self.dealer)
            if self.alone is not None and self.dealer == (self.alone + 2) % 4:
                self.hands[self.dealer].remove(self.up)   # the lone hand's partner sits out: no pick-up
                return self.go()
            self.stage = "discard"
            return self.to(self.dealer)
        self.go()

    def go(self):
        for k in range(4):
            self.sort_hand(k)
        self.start_tricks((self.dealer + 1) % 4)
        lead = (self.dealer + 1) % 4
        if self.is_out(lead):
            lead = self.next_seat(lead)
        self.to(lead)

    def is_out(self, i):
        return self.alone is not None and i == (self.alone + 2) % 4 and self.stage in ("play", "score")

    def do_pass(self, i):
        self.room.add_log(f"✋ {self.nm(i)} passes.")
        self.passes += 1
        if self.passes < 4:
            return self.to((i + 1) % 4)
        if self.round == 1:
            self.round, self.passes = 2, 0
            self.room.add_log(f"Everyone passed on {GLYPH[suit(self.up)]}. Round two: name a suit.")
            return self.to((self.dealer + 1) % 4)
        self.room.add_log("Everyone passed again: a redeal.")
        self.stage = "score"
        self.pause(self.deal, 2.0)

    def can_pass(self, i):
        return not (self.round == 2 and i == self.dealer and self.s.get("stick", True))

    def discard(self, i, c):
        self.hands[i].remove(c)
        self.room.add_log(f"{self.nm(i)} picks up {pretty(self.up)} and discards a card.")
        self.go()

    # -- scoring

    def on_trick(self, w, cards):
        nine = "9" + (self.trump or "")
        if self.s.get("nine", False) and self.trump and any(s == w and c == nine for s, c in self.last["cards"]):
            self.nine = w % 2
            self.moment(f"🪶 Nine lives! {pretty(nine)} takes a trick: +1 for {self.team_name(self.nine)} at hand end", "gold", "sweep")

    def end_hand(self):
        t = self.maker % 2
        got = self.tricks[self.maker] + self.tricks[(self.maker + 2) % 4]
        if got >= 3:
            pts = (4 if self.alone is not None else 2) if got == 5 else 1
            self.team_score[t] += pts
            if got == 5 and self.alone is not None and self.pl(self.maker):
                self.award(self.pl(self.maker), "loner")
            self.room.add_log(f"✅ {self.team_name(t)} take {got}: +{pts}.", "big")
            if got == 5:
                self.moment(f"🌟 March! {self.team_name(t)} take all five (+{pts})", "gold", "fanfare")
        else:
            self.team_score[1 - t] += 2
            for k in (1 - t, 3 - t):
                if self.pl(k):
                    self.award(self.pl(k), "euchre")
            self.moment(f"💥 EUCHRED! {self.team_name(1 - t)} +2", "bad", "groan")
        if self.nine is not None:
            self.team_score[self.nine] += 1
            self.room.add_log(f"🪶 {self.team_name(self.nine)} +1 for the 9 of trumps.")
        self.room.add_log(f"🧮 {self.team_name(0)} {self.team_score[0]} · {self.team_name(1)} {self.team_score[1]}")
        if max(self.team_score) >= self.s["target"] and (self.team_score[0] != self.team_score[1] or not self.s.get("nine", False)):   # a 🪶 bonus can tie them: play on
            w = 0 if self.team_score[0] > self.team_score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.team_name(w)} win Euchre, {self.team_score[w]} to {self.team_score[1 - w]}!"
                                    + (" (🪶 incl. the 9 of trumps bonus)" if self.nine is not None else ""))
        self.stage = "score"
        self.pause(self.deal, 3.5)

    def team_name(self, t):
        return f"{self.nm(t)} & {self.nm(t + 2)}"

    # -- actions

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if t == "order" and self.stage == "call":
            s = suit(self.up) if self.round == 1 else a.get("suit")
            if s not in ("C", "D", "H", "S") or (self.round == 2 and s == suit(self.up)):
                raise GameError("Name a suit other than the turned-up one.")
            return self.call(i, s, bool(a.get("alone")))
        if t == "pass" and self.stage == "call":
            if not self.can_pass(i):
                raise GameError("Stick the dealer: you must name a suit.")
            return self.do_pass(i)
        if t == "discard" and self.stage == "discard":
            c = a.get("card")
            if c not in self.hands[i]:
                raise GameError("Pick a card to discard.")
            return self.discard(i, c)
        raise GameError("Unknown action.")

    # -- bots

    def strength(self, hand, s, level):
        """Roughly how many tricks this hand takes with s as trumps."""
        old = self.trump
        self.trump = s
        v = 0.0
        for c in hand:
            if self.suit_of(c) == s:
                v += {20: 1.0, 19: 0.9, 5: 0.75, 4: 0.6, 3: 0.5}.get(self.power(c), 0.4)
            elif rank(c) == "A":
                v += 0.7
        voids = sum(1 for x in "CDHS" if x != s and not any(self.suit_of(c) == x for c in hand))
        v += voids * 0.3 * (1 if level != "easy" else 0)
        self.trump = old
        return v

    def bot_other(self, i, level):
        if self.stage == "discard":
            self.trump = self.trump
            plain = [c for c in self.hands[i] if self.suit_of(c) != self.trump] or self.hands[i]
            # throw the lowest off-suit card, preferring to empty a short suit
            short = lambda c: sum(1 for x in plain if self.suit_of(x) == self.suit_of(c))
            return self.discard(i, min(plain, key=lambda c: (self.power(c) >= 5, short(c), self.power(c))))
        if self.stage != "call":
            return
        hand = list(self.hands[i])
        bar = {"easy": 2.2, "normal": 2.6, "hard": 2.45}[level]
        if self.round == 1:
            s = suit(self.up)
            if i == self.dealer:
                hand = hand + [self.up]
            v = self.strength(hand, s, level)
            mate_deals = (i + 2) % 4 == self.dealer
            if i == self.dealer or mate_deals:
                v += 0.35
            elif (i + 1) % 4 == self.dealer or (i + 3) % 4 == self.dealer:
                v -= 0.25 if level == "hard" else 0
            if level == "easy":
                v += random.uniform(-0.6, 0.6)
            if v >= bar:
                return self.call(i, s, alone=level == "hard" and v >= 4.2)
            return self.do_pass(i)
        options = [x for x in "CDHS" if x != suit(self.up)]
        best = max(options, key=lambda x: self.strength(hand, x, level))
        v = self.strength(hand, best, level) + (random.uniform(-0.6, 0.6) if level == "easy" else 0)
        if v >= bar or not self.can_pass(i):
            return self.call(i, best, alone=level == "hard" and v >= 4.2)
        return self.do_pass(i)

    def wants(self, i):
        return True

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.team_score[i % 2]} pts"

    def final_scores(self):
        return {pid: self.team_score[k % 2] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(4):
            tags = []
            if k == self.dealer:
                tags.append("🎴 dealer")
            if k == self.maker:
                tags.append("🎺 maker" + (" · alone" if self.alone == k else ""))
            if self.stage in ("play", "score"):
                tags.append(f"won {self.tricks[k]}")
            info.append({"count": len(self.hands[k]), "tags": [" · ".join(tags)] if tags else [], "badge": "🔵" if k % 2 == 0 else "🟠",
                         "out": self.is_out(k)})
        rows = [{"seat": t, "value": self.team_score[t], "sub": f"& {self.nm(t + 2)}"} for t in (0, 1)]
        t = {"info": info, "trump": self.trump, "trumpLabel": (f"{SUIT_NAME[self.trump].title()} trumps · right J{GLYPH[self.trump]} · left J{GLYPH[SAME[self.trump]]}" if self.trump else ""),
             "scores": {"title": "Teams", "rows": rows, "hint": f"Game to {self.s['target']}. 🔵 seats 1 & 3, 🟠 seats 2 & 4." + (" 🪶 A trick won with the 9 of trumps: +1." if self.s.get("nine", False) else "")}}
        t.update(self.trick_view(p, i))
        if self.stage in ("call", "discard"):
            t["hand"] = self.hands[i] if i is not None else []
            if self.stage == "call" and self.round == 1:
                t["piles"] = [{"cards": [self.up], "label": f"Turned up · {self.nm(self.dealer)} deals"}]
            elif self.stage == "call":
                t["piles"] = [{"cards": ["??"], "label": f"{GLYPH[suit(self.up)]} turned down"}]
        mine = i is not None and self.room.turn == p.id
        if mine and self.stage == "call":
            if self.round == 1:
                s = suit(self.up)
                t["buttons"] = [{"label": f"Order up {GLYPH[s]}", "a": {"type": "order"}, "kind": "primary"},
                                {"label": f"{GLYPH[s]} alone", "a": {"type": "order", "alone": True}},
                                {"label": "Pass", "a": {"type": "pass"}}]
                t["note"] = f"{'Pick it up' if i == self.dealer else 'Order it up'} and make {SUIT_NAME[s]} trumps, or pass."
            else:
                t["buttons"] = [{"label": f"{GLYPH[x]} {SUIT_NAME[x].title()}", "a": {"type": "order", "suit": x}, "kind": "primary"}
                                for x in "SHDC" if x != suit(self.up)] + ([{"label": "Pass", "a": {"type": "pass"}}] if self.can_pass(i) else [])
                t["note"] = "Name trumps, or pass." if self.can_pass(i) else "Stick the dealer: you must name trumps."
            t["turnText"] = "🎺 Call trumps?"
        elif mine and self.stage == "discard":
            t["moves"] = [{"card": c, "a": {"type": "discard", "card": c}} for c in self.hands[i]]
            t["note"] = f"You picked up {pretty(self.up)}. Tap a card to discard."
            t["turnText"] = "🗑️ Discard a card"
        return t
