"""Spades: the partnership bidding game, for 4 players in two teams (partners sit opposite).

Thirteen cards each. Everyone bids how many tricks they'll take (or Nil: none at all); partners' bids
add up to the team's contract. Spades are always trumps and can't be led until one has been played
(unless you hold nothing else). Make the contract: 10 a trick bid plus 1 for each extra trick (a
"bag"); every 10 bags costs 100. Miss it: lose 10 a trick bid. Nil scores ±100. First team to the
target wins."""
import random

from .cardbase import GameError, deck, rank, suit, show, by_suit
from .tricks import TrickGame

NIL = 0


class Spades(TrickGame):
    id = "spades"
    name = "Spades"
    icon = "♠️"
    blurb = "Bid your tricks with a partner, spades always trump. Make your contract, mind the bags."
    howto = [
        "Two teams: partners sit opposite. Everyone bids how many tricks they'll take; partners' bids add up.",
        "Spades are always trumps, and can't be led until one has been played.",
        "Make it: 10 points per trick bid, +1 per extra trick (a bag). Every 10 bags: −100.",
        "Miss it: −10 per trick bid. Bid Nil and take no tricks: +100 (or −100 if you take one).",
        "First team to the target wins.",
    ]
    min_players, max_players = 4, 4
    teams = True
    trump = "S"
    badges = {**TrickGame.badges, "nil": ("🕳️", "Nil made", "Bid Nil and take no tricks")}
    settings_schema = {
        "target": ("Game to", [(300, "300 points"), (500, "500 points"), (150, "150 points (quick)")], 300),
        "nil": ("Nil bids", [(True, "Allowed"), (False, "No nil")], True),
    }

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.team_score = [0, 0]
        self.bags = [0, 0]
        self.dealer = rng.randrange(4)
        self.hand_no = 0
        self.room.add_log(f"♠️ Spades to {self.s['target']}: {self.nm(0)} & {self.nm(2)} against {self.nm(1)} & {self.nm(3)}.", "big")
        self.deal()

    def team(self, i):
        return i % 2

    def deal(self):
        self.hand_no += 1
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 13:(k + 1) * 13] for k in range(4)]
        for k in range(4):
            self.sort_hand(k)
        self.bids = [None] * 4
        self.tricks = [0] * 4
        self.trick, self.last = [], None
        self.broken = False
        self.stage = "bid"
        self.dealer = (self.dealer + 1) % 4
        self.room.add_log(f"🃏 Hand {self.hand_no}: bid your tricks.")
        self.to((self.dealer + 1) % 4)

    def lead_ok(self, i, c):
        return suit(c) != "S" or self.broken

    def do_bid(self, i, b):
        self.bids[i] = b
        self.room.add_log(f"📣 {self.nm(i)} bids {'Nil' if b == NIL else b}.")
        if None in self.bids:
            return self.to((i + 1) % 4)
        self.start_tricks((self.dealer + 1) % 4)

    def contract(self, t):
        return sum(self.bids[k] for k in (t, t + 2) if self.bids[k])

    def end_hand(self):
        lines = []
        for t in (0, 1):
            got = sum(self.tricks[k] for k in (t, t + 2) if self.bids[k] != NIL)
            pts = 0
            for k in (t, t + 2):
                if self.bids[k] == NIL:
                    ok = self.tricks[k] == 0
                    pts += 100 if ok else -100
                    lines.append(f"{self.nm(k)} {'made' if ok else 'missed'} Nil")
                    if ok and self.pl(k):
                        self.award(self.pl(k), "nil")
                    if not ok:
                        got += self.tricks[k]   # a failed nil's tricks count toward the partner's bid
            bid = self.contract(t)
            if bid:
                if got >= bid:
                    over = got - bid
                    pts += 10 * bid + over
                    self.bags[t] += over
                    if self.bags[t] >= 10:
                        self.bags[t] -= 10
                        pts -= 100
                        self.moment(f"👜 {self.team_name(t)} hit 10 bags: −100!", "bad", "groan")
                else:
                    pts -= 10 * bid
                    self.moment(f"💥 {self.team_name(t)} set! ({got} of {bid})", "bad", "groan")
            self.team_score[t] += pts
            lines.append(f"{self.team_name(t)} {pts:+} ({self.team_score[t]})")
        self.room.add_log("🧮 " + " · ".join(lines), "big")
        target = self.s["target"]
        if max(self.team_score) >= target and self.team_score[0] != self.team_score[1]:
            w = 0 if self.team_score[0] > self.team_score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.team_name(w)} win Spades, {self.team_score[w]} to {self.team_score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 4.0)

    def team_name(self, t):
        return f"{self.nm(t)} & {self.nm(t + 2)}"

    # -- actions

    def act_other(self, p, i, t, a):
        if t == "bid":
            self.require_turn(p)
            b = a.get("bid")
            if self.stage != "bid" or not isinstance(b, int) or isinstance(b, bool) or not 0 <= b <= 13 or (b == NIL and not self.s.get("nil")):
                raise GameError("Bid 1–13 (or Nil).")
            return self.do_bid(i, b)
        raise GameError("Unknown action.")

    # -- bots

    def estimate(self, i, level):
        hand = self.hands[i]
        est = 0.0
        sp = [c for c in hand if suit(c) == "S"]
        for s in "HDC":
            cs = sorted((c for c in hand if suit(c) == s), key=self.power, reverse=True)
            ranks = [rank(c) for c in cs]
            if "A" in ranks:
                est += 1 if len(cs) <= 5 else 0.7
            if "K" in ranks and len(cs) >= 2:
                est += 0.75 if len(cs) <= 4 else 0.4
            if "Q" in ranks and len(cs) >= 3 and level == "hard":
                est += 0.25
            if len(cs) <= 1 and len(sp) >= 3:
                est += 0.6 if not cs else 0.35        # ruffing a short suit
        for c in sp:
            r = rank(c)
            est += 1 if r in "AK" else 0.75 if r == "Q" and len(sp) >= 3 else 0
        est += max(0, len(sp) - 3) * 0.8
        return est

    def bot_other(self, i, level):
        if self.stage != "bid":
            return
        est = self.estimate(i, level)
        sp_high = any(c in self.hands[i] for c in ("AS", "KS", "QS"))
        if self.s.get("nil") and level != "easy" and est < 1.2 and not sp_high and len([c for c in self.hands[i] if suit(c) == "S"]) <= 3:
            return self.do_bid(i, NIL)
        b = round(est + (random.uniform(-1, 1) if level == "easy" else 0))
        mate = self.bids[(i + 2) % 4]
        if level == "hard" and mate is not None and mate + b > 10:
            b = max(1, 10 - mate)
        return self.do_bid(i, max(1, min(13, b)))

    def wants(self, i):
        if self.bids[i] == NIL:
            return False
        mate = (i + 2) % 4
        if self.bids[mate] == NIL and self.level(i) != "easy":
            # cover a nil partner: take tricks so they don't have to
            return True
        t = self.team(i)
        got = sum(self.tricks[k] for k in (t, t + 2))
        if got < self.contract(t):
            return True
        # contract made: a hard bot ducks bags, and spoils the other side's contract when it can
        if self.level(i) == "hard":
            o = 1 - t
            theirs = sum(self.tricks[k] for k in (o, o + 2))
            return theirs + 1 >= self.contract(o) and theirs < self.contract(o)
        return self.level(i) == "easy"

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.team_score[i % 2]} pts"

    def final_scores(self):
        return {pid: self.team_score[k % 2] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(4):
            b = self.bids[k]
            tags = [("Nil" if b == NIL else f"bid {b}") if b is not None else "…"] + ([f"won {self.tricks[k]}"] if self.stage in ("play", "score") else [])
            info.append({"count": len(self.hands[k]), "tags": [" · ".join(tags)], "badge": "🔵" if k % 2 == 0 else "🟠"})
        rows = [{"seat": t, "value": self.team_score[t], "sub": f"& {self.nm(t + 2)} · bid {self.contract(t)} · 👜 {self.bags[t]}"} for t in (0, 1)]
        t = {"info": info, "trump": "S", "trumpLabel": "♠ trumps" if self.broken or self.stage != "play" else "♠ not broken",
             "scores": {"title": "Teams", "rows": rows, "hint": f"Game to {self.s['target']}. 🔵 seats 1 & 3, 🟠 seats 2 & 4."}}
        t.update(self.trick_view(p, i))
        if self.stage == "bid":
            t["hand"] = self.hands[i] if i is not None else []
            if i is not None and self.room.turn == p.id:
                mate = self.bids[(i + 2) % 4]
                t["buttons"] = ([{"label": "Nil", "a": {"type": "bid", "bid": 0}}] if self.s.get("nil") else []) + \
                    [{"label": str(b), "a": {"type": "bid", "bid": b}, "kind": "primary" if b == round(self.estimate(i, 'normal')) else ""} for b in range(1, 14)]
                t["note"] = "How many tricks will you take?" + (f" Your partner bid {'Nil' if mate == 0 else mate}." if mate is not None else "")
                t["turnText"] = "📣 Your bid"
        return t
