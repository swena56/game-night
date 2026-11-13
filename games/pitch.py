"""Pitch (Auction Pitch / Setback): bid for High, Low, Jack and Game. For 2-4 players, or 4 in pairs.

Six cards each. One round of bidding, starting left of the dealer: bid 2, 3 or 4, or pass. If everyone
passes, the dealer is stuck with 2. The winner pitches the first card, and its suit is trumps. When
trumps are led you must follow with a trump if you can; otherwise follow suit or trump, as you like;
if you can't follow, play anything. There are four points: High (whoever holds the highest trump in
play), Low (whoever holds the lowest trump in play), Jack (whoever takes the trump jack) and Game (most
card points taken: A 4, K 3, Q 2, J 1, 10 10). The bidder must make their bid or is set back by it.
First to the target wins; if two get there together, the bidder goes out first."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

GAME_PTS = {"A": 4, "K": 3, "Q": 2, "J": 1, "T": 10}


class Pitch(TrickGame):
    id = "pitch"
    name = "Pitch"
    icon = "⚾"
    blurb = "Bid for High, Low, Jack and Game, then pitch your trump. Make the bid or get set back."
    howto = [
        "Six cards each. Bid 2, 3 or 4 points, or pass; if everyone passes the dealer is stuck with 2.",
        "The bidder's first card (the pitch) sets trumps.",
        "Follow suit or trump as you like; when trumps are led you must follow with a trump.",
        "Points: High (top trump in play), Low (lowest trump in play), Jack (whoever takes the trump jack), Game (most A4 K3 Q2 J1 10s10).",
        "Make your bid or lose that many. First to the target wins.",
    ]
    min_players, max_players = 2, 4
    order = "23456789TJQKA"
    badges = {**TrickGame.badges, "shoot": ("🎯", "Shot the moon", "Bid 4 and take all four points")}
    settings_schema = {"target": ("Play to", [(11, "11 points"), (7, "7 (quick)"), (15, "15 points")], 11),
                       "teams": ("Partners", [(False, "Every player for themselves"), (True, "Pairs (4 players)")], False)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.teams = bool(self.s.get("teams")) and self.n == 4
        self.sides = 2 if self.teams else self.n
        self.score = [0] * self.sides
        self.dealer = rng.randrange(self.n)
        self.hand_no = 0
        self.room.add_log(f"⚾ Pitch to {self.s['target']}" + (" in pairs." if self.teams else "."), "big")
        self.deal()

    def side(self, k):
        return k % 2 if self.teams else k

    def side_name(self, s):
        return f"{self.nm(s)} & {self.nm(s + 2)}" if self.teams else self.nm(s)

    def deal(self):
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % self.n
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 6:(k + 1) * 6] for k in range(self.n)]
        self.trump = None
        self.trick, self.last, self.tricks = [], None, [0] * self.n
        self.won = [[] for _ in range(self.n)]
        self.bids = [None] * self.n
        self.bidder, self.bid = None, 0
        self.result = None
        for k in range(self.n):
            self.sort_hand(k)
        self.stage = "bid"
        self.to((self.dealer + 1) % self.n)

    # -- bidding

    def place_bid(self, i, b):
        self.bids[i] = b
        if b:
            self.bidder, self.bid = i, b
            self.room.add_log(f"🙋 {self.nm(i)} bids {b}.")
        else:
            self.room.add_log(f"{self.nm(i)} passes.")
        if i == self.dealer:
            if self.bidder is None:
                self.bidder, self.bid = i, 2
                self.room.add_log(f"😬 Everyone passed: {self.nm(i)} is stuck with 2.")
            self.room.add_log(f"⚾ {self.nm(self.bidder)} won the bid at {self.bid} and pitches.", "power")
            self.dealt = [h[:] for h in self.hands]
            return self.start_tricks(self.bidder)
        if b == 4:
            # nobody can top 4: skip ahead
            self.room.add_log(f"⚾ {self.nm(i)} bids the limit and pitches.", "power")
            self.dealt = [h[:] for h in self.hands]
            return self.start_tricks(i)
        self.to(self.next_seat(i))

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if t != "bid" or self.stage != "bid":
            raise GameError("Not now.")
        b = a.get("bid")
        if b not in self.bid_options(i):
            raise GameError("Bid higher than the current bid, or pass.")
        self.place_bid(i, b)

    def bid_options(self, i):
        opts = [b for b in (2, 3, 4) if b > self.bid]
        if i == self.dealer and self.bidder is None:
            return opts
        return [0] + opts

    def estimate(self, i, s, level):
        hand = self.hands[i]
        tr = sorted((self.power(c) for c in hand if suit(c) == s), reverse=True)
        if not tr:
            return 0
        e = 0.0
        hi = tr[0]
        e += 1 if hi == 12 else 0.75 if hi == 11 else 0.45 if hi == 10 else 0.15
        lo = tr[-1]
        e += 1 if lo == 0 else 0.7 if lo == 1 else 0.35 if lo == 2 else 0.1
        if ("J" + s) in hand:
            e += 0.85 if len(tr) >= 3 or hi >= 11 else 0.55
        tens = sum(1 for c in hand if rank(c) == "T") + sum(1 for c in hand if rank(c) == "A") * 0.4
        e += min(0.8, 0.25 + 0.2 * tens + 0.1 * len(tr))
        return e + 0.15 * (len(tr) - 2)

    def best_suit(self, i, level):
        return max("CDHS", key=lambda s: self.estimate(i, s, level))

    def bot_other(self, i, level):
        if self.stage != "bid":
            return
        opts = self.bid_options(i)
        e = self.estimate(i, self.best_suit(i, level), level)
        if level == "easy":
            e += random.uniform(-0.8, 0.8)
        elif level == "hard":
            # pairs: the partner may already be bidding
            if self.teams and self.bidder is not None and self.side(self.bidder) == self.side(i):
                e -= 0.6
            if i == self.dealer:
                e += 0.3            # last to speak: no one left to outbid
        want = int(e + 0.15)
        choice = max([b for b in opts if b and b <= want], default=0)
        if choice == 0 and 0 not in opts:
            choice = opts[0]
        self.place_bid(i, choice)

    # -- play

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick:
            return hand[:]
        led = suit(self.trick[0][1])
        same = [c for c in hand if suit(c) == led]
        if not same:
            return hand[:]
        if led == self.trump:
            return same
        return same + [c for c in hand if suit(c) == self.trump]

    def on_card(self, i, c):
        if self.trump is None:
            self.trump = suit(c)
            for k in range(self.n):
                self.sort_hand(k)
            self.moment(f"⚾ {self.nm(i)} pitches {pretty(c)}: {SUIT_NAME[self.trump]} are trumps!", "cool", "whoosh")

    def wants(self, i):
        return True

    def bot_card(self, i, level):
        if self.trump is None:
            s = self.best_suit(i, level)
            mine = [c for c in self.hands[i] if suit(c) == s]
            # lead the top trump to pull High, keeping a low one for Low
            return max(mine, key=self.power)
        legal = self.legal(i)
        t = self.trump
        jack = "J" + t
        # protect the trump jack and low trumps unless the trick is ours anyway
        if self.trick and level != "easy":
            led = suit(self.trick[0][1])
            bs, best = self.best_of(self.trick)
            mate = self.partner(i)
            last = len(self.trick) == self.n - 1
            pot = sum(GAME_PTS.get(rank(c), 0) for _, c in self.trick) + (5 if any(c == jack for _, c in self.trick) else 0)
            winners = [c for c in legal if self.beats(c, best, led)]
            if mate is not None and bs == mate and (last or self.is_boss(i, best, level)):
                tens = [c for c in legal if rank(c) == "T" or c == jack]
                if tens:
                    return tens[0]
            if winners and pot >= 3:
                return min(winners, key=lambda c: (suit(c) == t, self.power(c)))
            if not winners or pot < 3:
                throw = [c for c in legal if suit(c) != t and rank(c) != "T"] or [c for c in legal if c != jack and self.power(c) > 1] or legal
                return min(throw, key=lambda c: (suit(c) == t, GAME_PTS.get(rank(c), 0), self.power(c)))
        return super().bot_card(i, level)

    # -- scoring

    def end_hand(self):
        t = self.trump
        trumps = [(self.power(c), k) for k in range(self.n) for c in self.dealt[k] if suit(c) == t]
        pts = [0] * self.sides
        got = {}
        hi = max(trumps)[1]
        lo = min(trumps)[1]
        got["High"] = self.side(hi)
        got["Low"] = self.side(lo)
        jack = "J" + t
        for k in range(self.n):
            if jack in self.won[k]:
                got["Jack"] = self.side(k)
        gp = [0] * self.sides
        for k in range(self.n):
            gp[self.side(k)] += sum(GAME_PTS.get(rank(c), 0) for c in self.won[k])
        top = max(gp)
        if gp.count(top) == 1:
            got["Game"] = gp.index(top)
        for s in got.values():
            pts[s] += 1
        bs = self.side(self.bidder)
        made = pts[bs] >= self.bid
        for s in range(self.sides):
            if s == bs and not made:
                self.score[s] -= self.bid
            else:
                self.score[s] += pts[s]
        if made and self.bid == 4 and pts[bs] == 4:
            for k in range(self.n):
                if self.side(k) == bs and self.pl(k):
                    self.award(self.pl(k), "shoot")
        self.result = {"got": {k: self.side_name(v) for k, v in got.items()}, "made": made}
        line = ", ".join(f"{k}: {self.side_name(v)}" for k, v in got.items())
        self.room.add_log(f"🧮 {line}. " + (f"✅ {self.side_name(bs)} made {self.bid}." if made else f"❌ {self.side_name(bs)} set back {self.bid}!"), "big")
        if not made:
            self.moment(f"❌ {self.side_name(bs)} set back {self.bid}!", "bad", "boom")
        tgt = self.s["target"]
        over = [s for s in range(self.sides) if self.score[s] >= tgt]
        if over:
            w = bs if bs in over else max(over, key=lambda s: self.score[s])
            if w != bs and sum(1 for s in over if self.score[s] == self.score[w]) > 1:
                return self.room.finish(None, f"🤝 A tie at {self.score[w]}.")
            who = self.pl(w)
            return self.room.finish(who, f"🏆 {self.side_name(w)} win{'' if self.teams else 's'} Pitch with {self.score[w]} points!")
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[self.side(i)]} pts"

    def final_scores(self):
        return {pid: self.score[self.side(k)] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(self.n):
            tags = []
            if self.bids[k] is not None:
                tags.append(f"bid {self.bids[k]}" if self.bids[k] else "pass")
            if k == self.bidder and self.stage != "bid":
                tags = [f"⚾ bid {self.bid}"]
            if k == self.dealer:
                tags.append("dealer")
            if self.stage == "play":
                tags.append(f"{self.tricks[k]} tricks")
            info.append({"count": len(self.hands[k]), "tags": tags})
        rows = [{"seat": s, "value": self.score[s], "sub": f"& {self.nm(s + 2)}" if self.teams else ""} for s in sorted(range(self.sides), key=lambda s: -self.score[s])]
        t = {"info": info, "trump": self.trump, "trumpLabel": None if self.trump else "Trumps: the pitch",
             "banner": ("  ·  ".join(f"{k} → {v}" for k, v in self.result["got"].items()) + ("" if self.result["made"] else "  ·  ❌ set back")) if self.stage == "score" and self.result else None,
             "scores": {"title": "Points", "rows": rows, "hint": f"To {self.s['target']} · High · Low · Jack · Game"}}
        t.update(self.trick_view(p, i))
        if i is None:
            return t
        if self.stage == "bid" and self.room.turn == p.id:
            t["buttons"] = [{"label": "Pass" if b == 0 else f"Bid {b}", "a": {"type": "bid", "bid": b}, "kind": "" if b == 0 else "primary"} for b in self.bid_options(i)]
            t["note"] = "Bid how many of High, Low, Jack and Game you'll take with your best suit as trumps."
            t["turnText"] = "🙋 Your bid"
        elif self.stage == "play" and self.trump is None and self.room.turn == p.id:
            t["note"] = "Pitch a card: its suit becomes trumps."
            t["turnText"] = "⚾ Pitch!"
        return t
