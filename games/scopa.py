"""Scopa: the Italian fishing game, for 2-4 players, with the 40-card deck (A-7 and the J Q K, worth
8 9 10).

Three cards each and four face up on the table. Play a card: if it matches a table card's value you
must take one (a single match beats a sum); otherwise you may take a group adding up to its value; if
it takes nothing it stays on the table. Clearing the table is a scopa (1 point), except on the very last
play. When the deck is gone the last player to take something gets what's left. Then: 1 point each for
most cards, most diamonds, the 7♦ (settebello) and the best primiera (a high card per suit, 7s best).
🧮 Escoba (a setting): capture groups that add up to 15 with the card you play instead."""
import itertools
import random

from .cardbase import CardGame, GameError, rank, suit, pretty, show

RANKS = "A234567JQK"
VAL = {r: k + 1 for k, r in enumerate(RANKS)}            # J 8, Q 9, K 10
PRIME = {"7": 21, "6": 18, "A": 16, "5": 15, "4": 14, "3": 13, "2": 12, "J": 10, "Q": 10, "K": 10}
SORT = lambda c: (VAL[rank(c)], "DCHS".index(suit(c)))


class Scopa(CardGame):
    id = "scopa"
    name = "Scopa"
    icon = "🧹"
    blurb = "The Italian fishing game: capture table cards that match or add up to yours, and sweep the table."
    howto = [
        "40 cards: A–7 count their number, J 8, Q 9, K 10. Three cards each, four on the table.",
        "Play a card to take a table card of the same value, or a group that adds up to it. A single match must be taken first.",
        "Take nothing and your card stays on the table. Clear the table for a 🧹 scopa (1 point).",
        "Each round: 1 point each for most cards, most ♦, the 7♦, and the best primiera (7s best, then 6s, aces…).",
        "🧮 Escoba: instead, capture cards that add up to 15 together with the card you play.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "sette": ("💎", "Settebello", "Capture the 7♦ with a scopa")}
    settings_schema = {
        "target": ("Game to", [(11, "11 points"), (21, "21 points"), (6, "6 points (quick)")], 11),
        "mode": ("Capture by", [("scopa", "Scopa: match the card's value"), ("escoba", "🧮 Escoba: make 15 with your card")], "scopa"),
    }

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"🧹 {'Escoba' if self.escoba() else 'Scopa'} to {self.s['target']}.", "big")
        self.new_round()

    def escoba(self):
        return self.s.get("mode") == "escoba"

    def new_round(self):
        self.dealer = (self.dealer + 1) % self.n
        while True:
            cards = [r + s for s in "DCHS" for r in RANKS]
            self.rng.shuffle(cards)
            table = cards[:4]
            if sum(1 for c in table if rank(c) == "K") < 3 or self.escoba():
                break
        self.stock = cards[4:]
        self.table_cards = sorted(table, key=SORT)
        self.taken = [[] for _ in range(self.n)]
        self.scopas = [0] * self.n
        self.last_taker = None
        self.last_move = None
        if self.escoba() and sum(VAL[rank(c)] for c in table) == 15:
            # Escoba: a table that already makes 15 goes to the dealer as a sweep
            self.taken[self.dealer] += table
            self.scopas[self.dealer] += 1
            self.table_cards = []
            self.room.add_log(f"🧹 The deal makes 15: {self.nm(self.dealer)} sweeps it.")
        self.deal_hands()
        self.stage = "play"
        self.to((self.dealer + 1) % self.n)

    def deal_hands(self):
        self.hands = [sorted(self.stock[k * 3:(k + 1) * 3], key=SORT) for k in range(self.n)]
        self.stock = self.stock[3 * self.n:]

    # -- captures

    def captures(self, c, table=None):
        """Every legal capture with card c: a list of tuples of table cards (empty list = none)."""
        table = self.table_cards if table is None else table
        v = VAL[rank(c)]
        if self.escoba():
            want = 15 - v
            return [combo for k in range(1, len(table) + 1) for combo in itertools.combinations(table, k)
                    if sum(VAL[rank(x)] for x in combo) == want]
        singles = [(x,) for x in table if VAL[rank(x)] == v]
        if singles:
            return singles
        return [combo for k in range(2, len(table) + 1) for combo in itertools.combinations(table, k)
                if sum(VAL[rank(x)] for x in combo) == v]

    def moves_for(self, i):
        out = []
        for c in self.hands[i]:
            caps = self.captures(c)
            if caps:
                out += [(c, cap) for cap in caps]
            else:
                out.append((c, ()))
        return out

    def last_play(self, i):
        """Is seat i's next card the last play of the round (no scopa on it)?"""
        return not self.stock and all(len(h) <= (1 if k == i else 0) for k, h in enumerate(self.hands))

    def play(self, i, c, cap):
        final = self.last_play(i)
        self.hands[i].remove(c)
        if cap:
            for x in cap:
                self.table_cards.remove(x)
            self.taken[i] += [c, *cap]
            self.last_taker = i
            sweep = not self.table_cards and not final
            if sweep:
                self.scopas[i] += 1
                if (c == "7D" or "7D" in cap) and self.pl(i):
                    self.award(self.pl(i), "sette")
                self.moment(f"🧹 SCOPA! {self.nm(i)} sweeps the table", "gold", "fanfare")
            self.room.add_log(f"🃏 {self.nm(i)} plays {pretty(c)} and takes {show(cap)}" + (" — scopa!" if sweep else "."))
        else:
            self.table_cards.append(c)
            self.table_cards.sort(key=SORT)
            self.room.add_log(f"🃏 {self.nm(i)} lays {pretty(c)} on the table.")
        self.last_move = {"seat": i, "card": c, "took": list(cap)}
        if any(self.hands):
            return self.to((i + 1) % self.n)
        if self.stock:
            self.deal_hands()
            return self.to((i + 1) % self.n)
        self.end_round()

    def end_round(self):
        r = self.room
        if self.table_cards and self.last_taker is not None:
            self.taken[self.last_taker] += self.table_cards
            r.add_log(f"{self.nm(self.last_taker)} takes the last {len(self.table_cards)} table card{'s' if len(self.table_cards) > 1 else ''}.")
            self.table_cards = []
        pts = [self.scopas[k] for k in range(self.n)]
        why = [[f"🧹×{self.scopas[k]}"] if self.scopas[k] else [] for k in range(self.n)]

        def award(label, values):
            top = max(values)
            best = [k for k, v in enumerate(values) if v == top]
            if len(best) == 1 and top > 0:
                pts[best[0]] += 1
                why[best[0]].append(label)
        award("cards", [len(t) for t in self.taken])
        award("♦", [sum(1 for c in t if suit(c) == "D") for t in self.taken])
        award("7♦", [1 if "7D" in t else 0 for t in self.taken])
        award("primiera", [self.primiera(t) for t in self.taken])
        for k in range(self.n):
            self.scores[k] += pts[k]
        r.add_log("🧮 " + " · ".join(f"{self.nm(k)} +{pts[k]} ({', '.join(why[k]) or '—'})" for k in range(self.n)), "big")
        self.summary = [{"seat": k, "pts": pts[k], "why": why[k]} for k in range(self.n)]
        top = max(self.scores)
        if top >= self.s["target"] and self.scores.count(top) == 1:
            return self.win_by_score(self.scores)
        self.stage = "score"
        self.pause(self.new_round, 4.5)

    @staticmethod
    def primiera(cards):
        best = {}
        for c in cards:
            best[suit(c)] = max(best.get(suit(c), 0), PRIME[rank(c)])
        return sum(best.values()) if len(best) == 4 else 0

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        if a.get("type") != "play":
            raise GameError("Unknown action.")
        self.require_turn(p)
        if self.stage != "play":
            raise GameError("Wait a moment.")
        c, cap = a.get("card"), a.get("take") or []
        if c not in self.hands[i] or not isinstance(cap, list):
            raise GameError("That card isn't in your hand.")
        caps = self.captures(c)
        key = sorted(cap)
        if caps and not any(sorted(x) == key for x in caps):
            raise GameError("You must take a matching card (or a group that adds up).")
        if not caps and cap:
            raise GameError("That card can't take anything.")
        self.play(i, c, tuple(next(x for x in caps if sorted(x) == key)) if caps else ())

    # -- bots

    def bot_move(self, i, level):
        if self.stage != "play":
            return
        opts = self.moves_for(i)
        if level == "easy" and random.random() < 0.5:
            c, cap = random.choice(opts)
        else:
            c, cap = max(opts, key=lambda m: self.value(i, m, level) + random.random() * 0.01)
        self.play(i, c, cap)

    def value(self, i, m, level):
        c, cap = m
        def worth(cards):
            return sum(1 + (0.6 if suit(x) == "D" else 0) + (4 if x == "7D" else 0) + (1.2 if rank(x) == "7" else 0.6 if rank(x) == "6" else 0.3 if rank(x) == "A" else 0)
                       for x in cards)
        if cap:
            v = worth([c, *cap])
            left = [x for x in self.table_cards if x not in cap]
            if not left and not self.last_play(i):
                v += 6
        else:
            v = -worth([c]) * 0.8
            left = self.table_cards + [c]
        # leaving the table easy to sweep is a gift to the next player
        if left and level != "easy":
            total = sum(VAL[rank(x)] for x in left)
            sweepable = total <= 10 if not self.escoba() else any(total + k == 15 for k in range(1, 11))
            if sweepable:
                v -= 4 if level == "hard" else 2.5
            if level == "hard" and "7D" in left:
                v -= 2.5
        return v

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"🂠 {len(self.taken[k])}" + (f" · 🧹{self.scopas[k]}" if self.scopas[k] else "")]} for k in range(self.n)]
        lm = self.last_move
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": self.table_cards, "fan": len(self.table_cards) > 5, "label": "Table" if self.table_cards else "Table: empty"},
                       {"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Deck", "corner": True}],
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k], "sub": f"🂠{len(self.taken[k])} ♦{sum(1 for c in self.taken[k] if suit(c) == 'D')}" + (" 7♦" if "7D" in self.taken[k] else "")}
                                                    for k in sorted(range(self.n), key=lambda k: -self.scores[k])],
                        "hint": f"Game to {self.s['target']}. Points: 🧹 scopas, most cards, most ♦, 7♦, primiera."}}
        t["piles"][0]["small"] = len(self.table_cards) > 6
        if self.table_cards:
            t["piles"][0]["cards"] = self.table_cards
            t["piles"][0]["fan"] = True
        if lm and self.stage == "play":
            t["banner"] = f"{self.nm(lm['seat'])}: {pretty(lm['card'])}" + (f" takes {show(lm['took'])}" if lm["took"] else "")
        if self.stage == "score":
            t["banner"] = "Round over"
            t["note"] = " · ".join(f"{self.nm(x['seat'])} +{x['pts']} ({', '.join(x['why']) or '—'})" for x in self.summary)
        if i is not None and self.stage == "play" and self.room.turn == p.id:
            moves = []
            for c, cap in self.moves_for(i):
                label = f"Take {show(cap)}" if cap else "Lay it on the table"
                if cap and len(cap) == len(self.table_cards) and not self.last_play(i):
                    label += " 🧹"
                if cap and "7D" in (c, *cap):
                    label += " 🌟 7♦"
                elif not cap and c == "7D":
                    label += " ⚠️ gives away 7♦"
                moves.append({"card": c, "label": label, "a": {"type": "play", "card": c, "take": list(cap)}})
            t["moves"] = moves
            t["note"] = "Tap a card to play it." + (" Several captures: you'll pick one." if any(len(self.captures(c)) > 1 for c in self.hands[i]) else "")
        return t
