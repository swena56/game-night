"""Piquet: the old two-player game of exchanges, declarations and tricks. A partie of six deals.

A 32-card deck (ace high down to 7), twelve cards each and eight in the talon. The elder hand (not
the dealer) swaps one to five cards from the talon, then the younger may swap the rest. Then the
declarations, compared automatically: point (most cards in one suit; tie, higher card total) scores a
point a card; sequence (longest run of three or more in a suit; tie, the higher) scores 3 or 4, or
10 more than its length from five up, plus any other sequences; sets (four or three of A K Q J 10;
higher beats lower, fours beat threes) score 14 or 3 each. Only the better hand in each class scores.
Then twelve tricks, no trumps, follow suit: a point a trick, one more for the last, and ten for winning
most tricks (forty for all of them: capot). Reaching 30 on declarations before your rival scores
anything doubles to a repique (+60); reaching 30 in play first is a pique (+30). Highest after six
deals wins.

Option, Run bonus: winning eight tricks in a row in a deal scores 8 more (once a deal, counted at the end)."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, show, rname, SUIT_NAME
from .tricks import TrickGame

ORDER = "789TJQKA"
PIP = {"A": 11, "K": 10, "Q": 10, "J": 10, "T": 10, "9": 9, "8": 8, "7": 7}
SETS = "AKQJT"


def seq_value(n):
    return n if n <= 4 else n + 10


class Piquet(TrickGame):
    id = "piquet"
    name = "Piquet"
    icon = "⚜️"
    blurb = "Exchange from the talon, outdeclare your rival on point, sequence and sets, then win the tricks."
    howto = [
        "Twelve cards each from 32 (A high). The elder swaps 1–5 cards with the talon, then the younger swaps up to the rest.",
        "Declarations compare automatically: point (longest suit), sequences (runs of 3+) and sets (three or four of A K Q J 10).",
        "Only the better hand in each class scores. Reaching 30 on declarations alone before your rival scores: repique, +60.",
        "Play twelve tricks with no trumps; follow suit. 1 a trick, 1 for the last, 10 for most tricks (40 for all).",
        "Highest after six deals wins.",
        "An option adds a run bonus: eight tricks in a row in one deal is worth 8 more.",
    ]
    min_players, max_players = 2, 2
    order = ORDER
    badges = {**TrickGame.badges, "repique": ("⚜️", "Repique", "Score a repique")}
    settings_schema = {"deals": ("Deals", [(6, "6 (a partie)"), (2, "2 (quick)"), (4, "4")], 6),
                       "run": ("Run bonus", [(0, "Off"), (1, "On")], 0)}
    run_seat, run_n, run_pts = None, 0, (0, 0)    # current streak, and bonus earned this deal (Run bonus option)

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(2)
        self.deal_no = 0
        self.room.add_log(f"⚜️ Piquet: a partie of {self.s['deals']} deals.", "big")
        self.deal()

    def make_deck(self):
        return deck(ORDER)

    def deal(self):
        self.deal_no += 1
        self.dealer = 1 - self.dealer
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[:12], cards[12:24]]
        self.talon = cards[24:]
        self.elder = 1 - self.dealer
        self.hand_pts = [0, 0]
        self.decl = None
        self.pique_on = False
        self.run_seat, self.run_n, self.run_pts = None, 0, [0, 0]
        self.result = None
        self.trick, self.last, self.tricks = [], None, [0, 0]
        for k in (0, 1):
            self.sort_hand(k)
        self.stage = "exchange"
        self.room.add_log(f"🃏 Deal {self.deal_no}: {self.nm(self.elder)} is elder.")
        self.to(self.elder)

    # -- exchange

    def max_swap(self, i):
        return min(5, len(self.talon)) if i == self.elder else len(self.talon)

    def exchange(self, i, cards):
        n = len(cards)
        for c in cards:
            self.hands[i].remove(c)
        self.hands[i] += self.talon[:n]
        self.talon = self.talon[n:]
        self.sort_hand(i)
        self.room.add_log(f"🔄 {self.nm(i)} exchanges {n}.")
        if i == self.elder:
            self.to(1 - i)
        else:
            self.declare()

    # -- declarations

    def point(self, h):
        best = (0, 0)
        for s in "CDHS":
            cs = [c for c in h if suit(c) == s]
            best = max(best, (len(cs), sum(PIP[rank(c)] for c in cs)))
        return best

    def sequences(self, h):
        out = []
        for s in "CDHS":
            have = [r in [rank(c) for c in h if suit(c) == s] for r in ORDER]
            k = 0
            while k < len(ORDER):
                if have[k]:
                    j = k
                    while j < len(ORDER) and have[j]:
                        j += 1
                    if j - k >= 3:
                        out.append((j - k, j - 1, s))
                    k = j
                else:
                    k += 1
        return sorted(out, reverse=True)

    def sets(self, h):
        out = []
        for r in SETS:
            n = sum(1 for c in h if rank(c) == r)
            if n >= 3:
                out.append((n, SETS[::-1].index(r), r))
        return sorted(out, reverse=True)

    def declare(self):
        e, y = self.elder, 1 - self.elder
        h = self.hands
        lines = []
        got = [0, 0]
        # point: ties (equal length and total) score nothing
        pe, py = self.point(h[e]), self.point(h[y])
        if pe != py:
            w = e if pe > py else y
            got[w] += (pe if w == e else py)[0]
            lines.append(f"Point of {(pe if w == e else py)[0]}: {self.nm(w)}")
        se, sy = self.sequences(h[e]), self.sequences(h[y])
        te, ty = (se[0][:2] if se else (0, 0)), (sy[0][:2] if sy else (0, 0))
        if te != ty:
            w, seqs = (e, se) if te > ty else (y, sy)
            got[w] += sum(seq_value(n) for n, _, _ in seqs)
            lines.append(f"Sequence{'s' if len(seqs) > 1 else ''} ({', '.join(str(n) for n, _, _ in seqs)}): {self.nm(w)}")
        we, wy = self.sets(h[e]), self.sets(h[y])
        te, ty = (we[0][:2] if we else (0, 0)), (wy[0][:2] if wy else (0, 0))
        if te != ty:
            w, ss = (e, we) if te > ty else (y, wy)
            got[w] += sum(14 if n == 4 else 3 for n, _, _ in ss)
            lines.append(f"Sets ({', '.join(('four ' if n == 4 else 'three ') + rname(r) for n, _, r in ss)}): {self.nm(w)}")
        for k in (0, 1):
            if got[k] >= 30 and got[1 - k] == 0:
                got[k] += 60
                lines.append(f"⚜️ Repique for {self.nm(k)}! +60")
                self.moment(f"⚜️ {self.nm(k)}: repique! +60", "gold", "fanfare")
                if self.pl(k):
                    self.award(self.pl(k), "repique")
        self.hand_pts = got
        self.pique_on = got[1 - self.elder] == 0 and got[self.elder] < 30
        self.decl = lines or ["Nothing to declare."]
        self.room.add_log("📜 " + " · ".join(self.decl) + f" ({got[0]}–{got[1]})", "power")
        self.start_tricks(self.elder)

    # -- play

    def on_trick(self, w, cards):
        self.hand_pts[w] += 1
        self.run_n = self.run_n + 1 if w == self.run_seat else 1
        self.run_seat = w
        if self.s.get("run") and self.run_n == 8:
            self.run_pts[w] = 8
            self.moment(f"🔥 {self.nm(w)}: eight tricks in a row! +8", "gold", "fanfare")
        if self.pique_on:
            if w != self.elder:
                self.pique_on = False
            elif self.hand_pts[self.elder] >= 30:
                self.hand_pts[self.elder] += 30
                self.pique_on = False
                self.room.add_log(f"⚜️ Pique for {self.nm(self.elder)}! +30", "power")
                self.moment(f"⚜️ {self.nm(self.elder)}: pique! +30", "gold", "fanfare")

    def end_hand(self):
        w = self.last["winner"]
        self.hand_pts[w] += 1
        a, b = self.tricks
        if max(a, b) == 12:
            k = 0 if a == 12 else 1
            self.hand_pts[k] += 40
            self.room.add_log(f"💥 Capot! {self.nm(k)} takes every trick: +40.", "power")
        elif a != b:
            k = 0 if a > b else 1
            self.hand_pts[k] += 10
            self.room.add_log(f"🎴 {self.nm(k)} wins the cards: +10.")
        for k in (0, 1):
            if self.run_pts[k]:
                self.hand_pts[k] += self.run_pts[k]
                self.room.add_log(f"🔥 {self.nm(k)}'s run of eight: +{self.run_pts[k]}.", "power")
            self.score[k] += self.hand_pts[k]
        self.result = f"Deal {self.deal_no}: {self.nm(0)} +{self.hand_pts[0]}, {self.nm(1)} +{self.hand_pts[1]}" + \
            ("".join(f" · {self.nm(k)}'s run of eight +8" for k in (0, 1) if self.run_pts[k]))
        self.room.add_log(f"🧮 {self.result}", "big")
        if self.deal_no >= self.s["deals"]:
            return self.win_by_score(self.score)
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- actions

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if self.stage != "exchange":
            raise GameError("Not now.")
        if t == "keep":
            if i == self.elder:
                raise GameError("The elder must exchange at least one card.")
            return self.exchange(i, [])
        if t == "swap":
            cards = a.get("cards")
            if not isinstance(cards, list) or not 1 <= len(cards) <= self.max_swap(i) or len(set(cards)) != len(cards) or any(c not in self.hands[i] for c in cards):
                raise GameError(f"Swap one to {self.max_swap(i)} cards.")
            return self.exchange(i, cards)
        raise GameError("Unknown action.")

    def bot_other(self, i, level):
        if self.stage != "exchange":
            return
        h = self.hands[i]
        count = {s: sum(1 for c in h if suit(c) == s) for s in "CDHS"}
        longest = max(count, key=count.get)
        seqs = {(r + s) for n, top, s in self.sequences(h) for r in ORDER[top - n + 1:top + 1]}

        def keep(c):
            r, s = rank(c), suit(c)
            v = ORDER.index(r) * 2 + (12 if s == longest else 0) + (10 if c in seqs else 0)
            v += 8 * sum(1 for x in h if rank(x) == r and r in SETS) if r in SETS else 0
            return v + (random.uniform(0, 8) if level == "easy" else 0)
        n = self.max_swap(i)
        if i != self.elder:
            n = min(n, 2 if level != "hard" else n)
        out = sorted(h, key=keep)[:n]
        if i != self.elder and level != "easy":
            out = [c for c in out if keep(c) < 14] or ([] if i != self.elder else out[:1])
        if i == self.elder and not out:
            out = sorted(h, key=keep)[:1]
        self.exchange(i, out)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i]} pts"

    def final_scores(self):
        return {pid: self.score[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": (["elder"] if k == self.elder else ["dealer"]) +
                 ([f"{self.tricks[k]} tr"] if self.stage == "play" else [])} for k in (0, 1)]
        t = {"info": info, "trumpLabel": "No trumps",
             "piles": [{"cards": ["??"] if self.talon else [], "count": len(self.talon), "label": "Talon"}] if self.stage == "exchange" else [],
             "banner": self.result if self.stage == "score" else (" · ".join(self.decl) if self.decl else None),
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.score[k], "sub": f"this deal {self.hand_pts[k]}"} for k in (0, 1)],
                        "hint": f"Deal {self.deal_no} of {self.s['deals']}"}}
        t.update(self.trick_view(p, i))
        if i is None or self.room.turn != p.id or self.stage != "exchange":
            return t
        n = self.max_swap(i)
        t["pick"] = {"act": "swap", "min": 1, "max": n, "label": "Swap these"}
        if i != self.elder:
            t["buttons"] = [{"label": "Keep my hand", "a": {"type": "keep"}}]
        pt = self.point(self.hands[i])
        t["note"] = (f"You're elder: swap one to {n} cards" if i == self.elder else f"Swap up to {n} cards, or keep") + \
            f". Your point: {pt[0]} ({pt[1]}); aim for long suits, runs and sets of A K Q J 10."
        t["turnText"] = "🔄 Exchange"
        return t
