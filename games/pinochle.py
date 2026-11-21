"""Pinochle: partnership auction pinochle with a 48-card deck. Four players in pairs.

Two of each 9, J, Q, K, 10 and A in every suit (ranked A 10 K Q J 9), twelve cards each. Bid how many
points your side will make (from 20, going up by one, or pass for good). The winner names trumps, then
everyone lays down meld: a run (A 10 K Q J of trumps) 15, a royal marriage (K Q of trumps) 4, other
marriages 2, the nine of trumps (dix) 1, pinochle (J♦ Q♠) 4, double pinochle 30, aces around 10,
kings around 8, queens around 6, jacks around 4. Then play twelve tricks: follow suit and beat the
trick if you can; if you can't follow you must trump. Aces, tens and kings count a point each, and the
last trick one more. The bidders must make their bid with meld plus points, or lose it; the other side
keeps its meld only if it takes a trick. First pair to 150 wins."""
import random

from .cardbase import GameError, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame


def meld_of(hand, t):
    """(points, [descriptions]) for this hand with trumps t."""
    n = lambda c: hand.count(c)
    pts, what = 0, []
    run = min(n(r + t) for r in "ATKQJ")
    if run:
        pts += 150 if run == 2 else 15
        what.append("double run" if run == 2 else "run")
    for s in "CDHS":
        m = min(n("K" + s), n("Q" + s))
        if s == t:
            m -= run
        if m > 0:
            v = 4 if s == t else 2
            pts += v * m
            what.append(f"{'royal ' if s == t else ''}marriage{' ×2' if m == 2 else ''}")
    dix = n("9" + t)
    if dix:
        pts += dix
        what.append(f"dix{' ×2' if dix == 2 else ''}")
    p = min(n("JD"), n("QS"))
    if p:
        pts += 30 if p == 2 else 4
        what.append("double pinochle" if p == 2 else "pinochle")
    for r, v, name in (("A", 10, "aces"), ("K", 8, "kings"), ("Q", 6, "queens"), ("J", 4, "jacks")):
        k = min(n(r + s) for s in "CDHS")
        if k:
            pts += v * 10 if k == 2 else v
            what.append(f"{'double ' if k == 2 else ''}{name} around")
    return pts, what


class Pinochle(TrickGame):
    id = "pinochle"
    name = "Pinochle"
    icon = "💍"
    blurb = "Bid your side's meld and tricks, name trumps, show your pinochles and marriages. Four players in pairs."
    howto = [
        "48 cards (two of each 9 J Q K 10 A), twelve each. Bid what your side will make, from 20, or pass for good.",
        "The bid winner names trumps. Everyone shows meld: runs, marriages, pinochle (J♦ Q♠), aces around…",
        "Play twelve tricks: follow suit and beat the trick if you can; can't follow? Trump. Ranks: A 10 K Q J 9.",
        "Aces, tens and kings won count 1 each, the last trick 1 more (25 in all).",
        "Bidders need meld + points ≥ bid, or lose the bid. First pair to 150 wins.",
        "An option: a side that takes ten or more of the twelve tricks (a romp) scores 20 extra.",
    ]
    min_players, max_players = 4, 4
    teams = True
    order = "9JQKTA"
    badges = {**TrickGame.badges, "pinochle": ("💍", "Double pinochle", "Hold both J♦ and both Q♠")}
    settings_schema = {"target": ("Play to", [(150, "150"), (100, "100 (quick)"), (250, "250")], 150),
                       "romp": ("🧹 Romp", [(False, "Off"), (True, "On: +20")], False)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(4)
        self.hand_no = 0
        self.room.add_log(f"💍 Pinochle to {self.s['target']}: {self.side_name(0)} vs {self.side_name(1)}.", "big")
        self.deal()

    def side_name(self, s):
        return f"{self.nm(s)} & {self.nm(s + 2)}"

    def make_deck(self):
        return [r + s for s in "CDHS" for r in self.order] * 2

    def full_deck(self):
        return set(self.make_deck())

    def deal(self):
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % 4
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 12:(k + 1) * 12] for k in range(4)]
        self.trump = None
        self.trick, self.last, self.tricks = [], None, [0] * 4
        self.bid, self.bidder = 19, None
        self.passed = [False] * 4
        self.said = [None] * 4
        self.melds = None
        self.result = None
        for k in range(4):
            self.sort_hand(k)
        self.stage = "bid"
        self.to((self.dealer + 1) % 4)

    # -- auction

    def place(self, i, b):
        if b is None:
            self.passed[i] = True
            self.said[i] = "pass"
            self.room.add_log(f"{self.nm(i)} passes.")
        else:
            self.bid, self.bidder = b, i
            self.said[i] = b
            self.room.add_log(f"🙋 {self.nm(i)} bids {b}.")
        live = [k for k in range(4) if not self.passed[k]]
        if self.bidder is None and len(live) == 1 and live[0] == self.dealer:
            # everyone passed to the dealer: stuck at 20
            self.bid, self.bidder = 20, self.dealer
            self.room.add_log(f"😬 {self.nm(self.dealer)} is stuck with 20.")
            return self.won_bid()
        if self.bidder is not None and live == [self.bidder]:
            return self.won_bid()
        if not live:
            return self.won_bid()
        k = i
        for _ in range(4):
            k = (k + 1) % 4
            if not self.passed[k]:
                return self.to(k)

    def won_bid(self):
        self.stage = "trump"
        self.to(self.bidder)

    def name_trump(self, i, s):
        self.trump = s
        self.moment(f"💍 {self.nm(i)} names {SUIT_NAME[s]} for {self.bid}!", "cool", "whoosh")
        self.melds = [meld_of(self.hands[k], s) for k in range(4)]
        for k in range(4):
            m, what = self.melds[k]
            if m:
                self.room.add_log(f"💍 {self.nm(k)} melds {m}: {', '.join(what)}.")
            if "double pinochle" in what and self.pl(k):
                self.award(self.pl(k), "pinochle")
        for k in range(4):
            self.sort_hand(k)
        self.start_tricks(self.bidder)

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if self.stage == "bid" and t == "bid":
            b = a.get("bid")
            if b is not None and (not isinstance(b, int) or b <= self.bid or b > 200):
                raise GameError("Bid higher, or pass.")
            return self.place(i, b)
        if self.stage == "trump" and t == "trump" and a.get("suit") in ("C", "D", "H", "S"):
            return self.name_trump(i, a["suit"])
        raise GameError("Not now.")

    def guess(self, i, level):
        """Best trump and what our side should make with it."""
        best, bv = None, -1
        for s in "CDHS":
            m, _ = meld_of(self.hands[i], s)
            length = sum(1 for c in self.hands[i] if suit(c) == s)
            power = sum(1 for c in self.hands[i] if rank(c) in "AT")
            v = m + 1.2 * length + 0.6 * power
            if v > bv:
                best, bv = s, v
        m, _ = meld_of(self.hands[i], best)
        length = sum(1 for c in self.hands[i] if suit(c) == best)
        tricks = 8 + 1.2 * max(0, length - 3) + 0.5 * sum(1 for c in self.hands[i] if rank(c) == "A")
        partner = 6 if level != "easy" else 8
        return best, m + tricks + partner

    def bot_other(self, i, level):
        if self.stage == "bid":
            _, v = self.guess(i, level)
            if level == "easy":
                v += random.uniform(-4, 4)
            if self.bidder is not None and self.bidder % 2 == i % 2 and level == "hard":
                v -= 4      # partner already carries it
            nxt = self.bid + 1
            if nxt <= v:
                return self.place(i, nxt if level != "hard" or nxt + 2 > v else nxt)
            return self.place(i, None)
        if self.stage == "trump":
            s, _ = self.guess(i, level)
            return self.name_trump(i, s)

    # -- play

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick:
            return hand[:]
        led = suit(self.trick[0][1])
        bs, best = self.best_of(self.trick)
        same = [c for c in hand if suit(c) == led]
        if same:
            if suit(best) == led:
                return [c for c in same if self.power(c) > self.power(best)] or same
            return same
        trumps = [c for c in hand if suit(c) == self.trump]
        if trumps:
            if suit(best) == self.trump:
                return [c for c in trumps if self.power(c) > self.power(best)] or trumps
            return trumps
        return hand[:]

    def end_hand(self):
        cnt = [0, 0]
        took = [0, 0]
        for k in range(4):
            cnt[k % 2] += sum(1 for c in self.won[k] if rank(c) in "ATK")
            took[k % 2] += self.tricks[k]
        cnt[self.last["winner"] % 2] += 1
        meld = [self.melds[0][0] + self.melds[2][0], self.melds[1][0] + self.melds[3][0]]
        bs = self.bidder % 2
        gain = [0, 0]
        made = meld[bs] + cnt[bs] >= self.bid and took[bs] > 0
        gain[bs] = meld[bs] + cnt[bs] if made else -self.bid
        gain[1 - bs] = (meld[1 - bs] if took[1 - bs] else 0) + cnt[1 - bs]
        romp = ""
        if self.s.get("romp", False) and max(took) >= 10 and (took[1 - bs] >= 10 or made):
            rw = 0 if took[0] >= 10 else 1
            gain[rw] += 20
            romp = f" (+20 romp for {self.side_name(rw)})"
            self.moment(f"🧹 {self.side_name(rw)} romp home with {took[rw]} tricks: +20!", "gold", "sweep")
        for s in (0, 1):
            self.score[s] += gain[s]
        text = (f"✅ {self.side_name(bs)} make {meld[bs]}+{cnt[bs]} on a bid of {self.bid}" if made
                else f"❌ {self.side_name(bs)} go set: {meld[bs]}+{cnt[bs]} of {self.bid}") + romp
        self.result = text
        self.room.add_log(f"🧮 {text}. {gain[0]:+d} / {gain[1]:+d}", "big")
        self.moment(text, "gold" if made else "bad", "fanfare" if made else "boom")
        tgt = self.s["target"]
        over = [s for s in (0, 1) if self.score[s] >= tgt]
        if over:
            w = bs if bs in over else over[0]
            if len(over) == 2 and bs not in over:
                w = 0 if self.score[0] > self.score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.side_name(w)} win Pinochle, {self.score[w]} to {self.score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 4.5)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i % 2]} pts"

    def final_scores(self):
        return {pid: self.score[k % 2] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(4):
            tags = []
            if self.stage == "bid" and self.said[k] is not None:
                tags.append("pass" if self.said[k] == "pass" else f"bid {self.said[k]}")
            if k == self.bidder and self.stage != "bid":
                tags.append(f"🙋 {self.bid}")
            if self.melds and self.stage in ("play", "score"):
                tags.append(f"💍 {self.melds[k][0]}")
            if self.stage == "play":
                tags.append(f"{self.tricks[k]} tr")
            info.append({"count": len(self.hands[k]), "tags": tags})
        t = {"info": info, "trump": self.trump,
             "banner": self.result if self.stage == "score" else None,
             "scores": {"title": "Points", "rows": [{"seat": s, "value": self.score[s], "sub": f"& {self.nm(s + 2)}"} for s in (0, 1)],
                        "hint": f"To {self.s['target']} · A 10 K count 1 · last trick 1"}}
        t.update(self.trick_view(p, i))
        if i is None:
            return t
        if self.melds and self.stage == "play":
            m, what = self.melds[i]
            t["note"] = f"Your meld: {m}" + (f" ({', '.join(what)})" if what else "") + "."
        if self.room.turn != p.id:
            return t
        if self.stage == "bid":
            b = self.bid + 1
            t["buttons"] = [{"label": "Pass", "a": {"type": "bid", "bid": None}}] + \
                [{"label": f"Bid {x}", "a": {"type": "bid", "bid": x}, "kind": "primary"} for x in (b, b + 1, b + 2, b + 5)]
            sug = {s: meld_of(self.hands[i], s)[0] for s in "CDHS"}
            t["note"] = "Your meld by trump: " + ", ".join(f"{g} {sug[s]}" for s, g in zip("CDHS", "♣♦♥♠")) + ". Tricks bring up to 25 more."
            t["turnText"] = "🙋 Your bid"
        elif self.stage == "trump":
            t["buttons"] = [{"label": f"{g} {SUIT_NAME[s].title()} (meld {meld_of(self.hands[i], s)[0]})", "a": {"type": "trump", "suit": s}, "kind": "primary"} for s, g in zip("CDHS", "♣♦♥♠")]
            t["turnText"] = "💍 Name trumps"
        return t
