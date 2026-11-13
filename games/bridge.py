"""Contract Bridge, Chicago scoring: four players in pairs, a round of four deals.

Thirteen cards each. The auction goes round from the dealer: bid a number of tricks over six (1 to 7)
and a strain (♣ < ♦ < ♥ < ♠ < no trumps), pass, double the opponents' bid, or redouble their double.
Three passes after a bid end it; four passes and the deal is thrown in. The declarer is whoever on the
winning side first named the strain; their partner is dummy. The player on the declarer's left leads,
then dummy's hand goes face up and the declarer plays it too. Follow suit if you can. Score the contract
if you make it (trick points, game or part-score bonus, slams, overtricks); if not, the defenders score
for each undertrick. Vulnerability follows Chicago: none, dealer's side, dealer's side, both."""
import random

from .cardbase import GameError, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

STRAINS = "CDHSN"
GLY = {"C": "♣", "D": "♦", "H": "♥", "S": "♠", "N": "NT"}
HCP = {"A": 4, "K": 3, "Q": 2, "J": 1}


def bid_rank(b):
    return (int(b[0]) - 1) * 5 + STRAINS.index(b[1])


def bname(b):
    return {"P": "Pass", "X": "Double", "XX": "Redouble"}.get(b) or f"{b[0]}{GLY[b[1]]}"


def contract_score(level, strain, dbl, vul, took):
    """Points to the declaring side (positive) or the defenders (negative)."""
    need = level + 6
    mult = {0: 1, 1: 2, 2: 4}[dbl]
    if took >= need:
        per = 20 if strain in "CD" else 30
        tp = (per * level + (10 if strain == "N" else 0)) * mult
        s = tp
        s += (500 if vul else 300) if tp >= 100 else 50
        if level == 6:
            s += 750 if vul else 500
        if level == 7:
            s += 1500 if vul else 1000
        over = took - need
        if dbl == 0:
            s += over * per
        else:
            s += over * (200 if vul else 100) * (2 if dbl == 2 else 1)
            s += 50 * dbl
        return s
    down = need - took
    if dbl == 0:
        return -down * (100 if vul else 50)
    if vul:
        pen = 200 + 300 * (down - 1)
    else:
        pen = 100 + 200 * min(down - 1, 2) + 300 * max(0, down - 3)
    return -pen * (2 if dbl == 2 else 1)


class Bridge(TrickGame):
    id = "bridge"
    name = "Bridge"
    icon = "🌉"
    blurb = "Contract Bridge with Chicago scoring: bid with your partner, declare, and play dummy's hand too."
    howto = [
        "Thirteen cards each. Bid tricks over six and a strain (♣ ♦ ♥ ♠ NT), pass, double or redouble. Three passes end it.",
        "The declarer's partner is dummy: after the opening lead dummy's cards go face up and the declarer plays them.",
        "Follow suit if you can. Highest trump wins, else the highest card of the suit led.",
        "Make your contract for trick points plus bonuses (game, slam, overtricks); fail and the defenders score.",
        "Chicago: four deals with set vulnerability. Highest total wins.",
    ]
    min_players, max_players = 4, 4
    teams = True
    badges = {**TrickGame.badges, "slam": ("🌉", "Slam", "Bid and make a slam")}
    settings_schema = {"deals": ("Deals", [(4, "4 (one Chicago)"), (8, "8 (two rounds)"), (2, "2 (quick)")], 4)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(4)
        self.deal_no = 0
        self.cur = None
        self.room.add_log(f"🌉 Bridge, Chicago scoring: {self.side_name(0)} vs {self.side_name(1)}.", "big")
        self.deal()

    def side_name(self, s):
        return f"{self.nm(s)} & {self.nm(s + 2)}"

    def vul(self, side):
        k = (self.deal_no - 1) % 4
        return k == 3 or (k in (1, 2) and self.dealer % 2 == side)

    def deal(self):
        self.deal_no += 1
        if self.deal_no > 1:
            self.dealer = (self.dealer + 1) % 4
        cards = [r + s for s in "CDHS" for r in "23456789TJQKA"]
        self.rng.shuffle(cards)
        self.hands = [cards[k * 13:(k + 1) * 13] for k in range(4)]
        self.trump = None
        self.calls = []
        self.contract = None
        self.declarer = self.dummy = None
        self.dbl = 0
        self.open = False
        self.trick, self.last, self.tricks = [], None, [0] * 4
        self.result = None
        for k in range(4):
            self.sort_hand(k)
        self.stage = "bid"
        v = [s for s in (0, 1) if self.vul(s)]
        self.room.add_log(f"🃏 Deal {self.deal_no}: {self.nm(self.dealer)} deals. Vulnerable: " +
                          ("nobody" if not v else "both" if len(v) == 2 else self.side_name(v[0])) + ".")
        self.to(self.dealer)

    # -- whose card: the declarer plays for dummy

    def to(self, i):
        self.cur = i
        if self.stage == "play" and i == self.dummy:
            i = self.declarer
        super().to(i)

    def controls(self, i):
        return self.declarer if self.stage == "play" and i == self.dummy else i

    # -- the auction

    def last_bid(self):
        for s, c in reversed(self.calls):
            if c not in ("P", "X", "XX"):
                return s, c
        return None, None

    def options(self, i):
        s, b = self.last_bid()
        opts = ["P"]
        lo = bid_rank(b) + 1 if b else 0
        opts += [f"{l}{x}" for l in range(1, 8) for x in STRAINS if bid_rank(f"{l}{x}") >= lo]
        nonpass = [(t, c) for t, c in self.calls if c != "P"]
        if nonpass:
            t, c = nonpass[-1]
            if c not in ("X", "XX") and t % 2 != i % 2:
                opts.append("X")
            if c == "X" and t % 2 != i % 2:
                opts.append("XX")
        return opts

    def call(self, i, c):
        self.calls.append((i, c))
        self.room.add_log(f"{self.nm(i)}: {bname(c)}.")
        s, b = self.last_bid()
        tail = [x for _, x in self.calls[-3:]]
        if not b and len(self.calls) == 4 and all(x == "P" for _, x in self.calls):
            self.room.add_log("😶 Passed out: no score, next deal.", "big")
            self.result = "Passed out"
            return self.next_deal()
        if b and len(self.calls) >= 4 and tail == ["P", "P", "P"]:
            return self.won_auction()
        self.to((i + 1) % 4)

    def won_auction(self):
        s, b = self.last_bid()
        side = s % 2
        strain = b[1]
        self.declarer = next(t for t, c in self.calls if t % 2 == side and c not in ("P", "X", "XX") and c[1] == strain)
        self.dummy = (self.declarer + 2) % 4
        self.dbl = 0
        for t, c in self.calls:
            if c not in ("P", "X", "XX"):
                self.dbl = 0
            elif c == "X":
                self.dbl = 1
            elif c == "XX":
                self.dbl = 2
        self.contract = b
        self.trump = None if strain == "N" else strain
        txt = f"{bname(b)}{' doubled' if self.dbl == 1 else ' redoubled' if self.dbl == 2 else ''} by {self.nm(self.declarer)}"
        self.moment(f"🌉 {txt}", "cool", "whoosh")
        self.room.add_log(f"🌉 The contract: {txt}. {self.nm(self.dummy)} is dummy.", "big")
        for k in range(4):
            self.sort_hand(k)
        self.start_tricks((self.declarer + 1) % 4)

    def on_card(self, i, c):
        if not self.open:
            self.open = True
            self.room.add_log(f"🪟 Dummy goes down: {show(self.hands[self.dummy])}.")

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        self.require_turn(p)
        if self.stage == "bid" and t == "call":
            c = a.get("call")
            if c not in self.options(i):
                raise GameError("That call isn't allowed now.")
            return self.call(i, c)
        if self.stage == "play" and t == "play":
            s = self.cur
            if self.controls(s) != i:
                raise GameError("It's not your card to play.")
            c = a.get("card")
            if not isinstance(c, str) or c not in self.hands[s]:
                raise GameError("Play a card from " + ("dummy." if s != i else "your hand."))
            if c not in self.legal(s):
                raise GameError("You must follow suit.")
            return self.play(s, c)
        raise GameError("Not now.")

    def bot_move(self, i, level):
        if self.stage == "bid":
            return self.call(i, self.bot_call(i, level))
        if self.stage == "play":
            s = self.cur
            return self.play(s, self.bot_card(s, level))

    # -- bidding bot: points, fit and level

    def points(self, i):
        h = self.hands[i]
        hcp = sum(HCP.get(rank(c), 0) for c in h)
        length = {s: sum(1 for c in h if suit(c) == s) for s in "CDHS"}
        return hcp, length

    def partner_shows(self, i):
        """Rough points and suit the partner has shown in the auction."""
        mate = (i + 2) % 4
        mine = [c for t, c in self.calls if t == mate]
        bids = [c for c in mine if c not in ("P", "X", "XX")]
        if not mine:
            return 8, None
        if not bids:
            return 5, None
        first = bids[0]
        pts = {"1N": 16, "2N": 20}.get(first, 13 if first[0] == "1" else 10)
        if len(bids) > 1:
            pts += 2
        return pts, (bids[-1][1] if bids[-1][1] != "N" else None)

    def bot_call(self, i, level):
        hcp, length = self.points(i)
        dist = sum(max(0, n - 4) for n in length.values())
        mine = hcp + (dist if level != "easy" else 0)
        if level == "easy":
            mine += random.randint(-3, 3)
        pp, psuit = self.partner_shows(i)
        s, b = self.last_bid()
        opts = self.options(i)
        opened = b is not None
        balanced = all(n >= 2 for n in length.values()) and max(length.values()) <= 5
        # opening
        if not any(c not in ("P",) for _, c in self.calls):
            if 15 <= hcp <= 17 and balanced:
                return "1N"
            if 20 <= hcp <= 21 and balanced:
                return "2N"
            if mine >= 12 + (0 if level != "hard" else 0):
                best = max("SHDC", key=lambda x: (length[x] >= 5 and x in "SH", length[x], "CDHS".index(x)))
                if length[best] < 5 and best in "SH":
                    best = "D" if length["D"] > length["C"] else "C"
                return "1" + best
            return "P"
        team = mine + pp
        # what the opponents have shown caps what we can have
        opp = 0
        for k in ((i + 1) % 4, (i + 3) % 4):
            theirs = [c for t, c in self.calls if t == k and c not in ("P", "X", "XX")]
            if theirs:
                opp += 12 if theirs[0][0] == "1" else 9
                opp += 2 * (len(theirs) - 1)
        team = min(team, 40 - opp - (0 if level == "easy" else 2))
        # strain: a known 8-card fit, else our long suit, else no trumps
        fits = {x: length[x] + (5 if x == psuit else 3 if pp >= 9 else 2) for x in "CDHS"}
        strain = max(fits, key=lambda x: (fits[x], x in "SH"))
        if fits[strain] < 8 and balanced and team >= 20:
            strain = "N"
        # how high: rough tricks from team points
        if strain == "N":
            lvl = 1 if team >= 20 else 0
            lvl = 2 if team >= 23 else lvl
            lvl = 3 if team >= 25 else lvl
            lvl = 6 if team >= 33 else lvl
            lvl = 7 if team >= 37 else lvl
        else:
            major = strain in "SH"
            lvl = 1 if team >= 18 else 0
            lvl = 2 if team >= 21 else lvl
            lvl = 3 if team >= 23 else lvl
            lvl = (4 if major else 3) if team >= 25 else lvl
            lvl = 5 if team >= 28 and not major else lvl
            lvl = 6 if team >= 33 else lvl
            lvl = 7 if team >= 37 else lvl
        if strain != "N" and fits[strain] < 7:
            lvl = min(lvl, 2)
        want = f"{lvl}{strain}" if lvl else None
        if want and want in opts:
            # bid one step at a time below game, jump straight to the target when partner has shown a fit
            cheapest = next((o for o in opts if o not in ("P", "X", "XX") and o[1] == strain), None)
            if cheapest and level != "hard" and int(cheapest[0]) < int(want[0]) and psuit != strain:
                return cheapest
            return want
        # double the opponents when they've clearly overreached
        if "X" in opts and s is not None and s % 2 != i % 2 and level != "easy":
            their = int(b[0]) + 6
            if team >= 23 and their >= 9 and (mine >= 12 or level == "hard" and mine >= 10):
                return "X"
        return "P"

    # -- end of deal

    def end_hand(self):
        side = self.declarer % 2
        took = self.tricks[self.declarer] + self.tricks[self.dummy]
        lvl, strain = int(self.contract[0]), self.contract[1]
        sc = contract_score(lvl, strain, self.dbl, self.vul(side), took)
        need = lvl + 6
        if sc >= 0:
            self.score[side] += sc
            text = f"✅ {bname(self.contract)} made" + (f" +{took - need}" if took > need else "") + f" by {self.nm(self.declarer)}: {self.side_name(side)} +{sc}"
            if lvl >= 6:
                for k in (self.declarer, self.dummy):
                    if self.pl(k):
                        self.award(self.pl(k), "slam")
            self.moment(text, "gold", "fanfare")
        else:
            self.score[1 - side] += -sc
            text = f"❌ {bname(self.contract)} down {need - took}: {self.side_name(1 - side)} +{-sc}"
            self.moment(text, "bad", "boom")
        self.result = text
        self.room.add_log(f"🧮 {text}.", "big")
        self.next_deal()

    def next_deal(self):
        if self.deal_no >= self.s["deals"]:
            if self.score[0] == self.score[1]:
                return self.room.finish(None, f"🤝 A tie at {self.score[0]}!")
            w = 0 if self.score[0] > self.score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.side_name(w)} win the Chicago, {self.score[w]} to {self.score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 5)

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
            if self.stage == "bid":
                said = [c for t, c in self.calls if t == k]
                if said:
                    tags.append(bname(said[-1]))
                if k == self.dealer:
                    tags.append("dealer")
            else:
                if k == self.declarer:
                    tags.append("🌉 declarer")
                if k == self.dummy:
                    tags.append("🪟 dummy")
                if self.stage == "play":
                    tags.append(f"{self.tricks[k]} tr")
            if self.vul(k % 2):
                tags.append("vul")
            show_dummy = k == self.dummy and self.open and k != i
            info.append({"count": len(self.hands[k]), "tags": tags, "show": self.hands[k] if show_dummy else []})
        contract = None
        if self.contract:
            took = self.tricks[self.declarer] + self.tricks[self.dummy]
            contract = f"{bname(self.contract)}{' X' if self.dbl == 1 else ' XX' if self.dbl == 2 else ''} by {self.nm(self.declarer)} · {took}/{int(self.contract[0]) + 6}"
        auction = " · ".join(f"{self.nm(t)[:8]} {bname(c)}" for t, c in self.calls[-8:])
        t = {"info": info, "trump": self.trump, "trumpLabel": "No trumps" if self.contract and not self.trump else None,
             "banner": self.result if self.stage == "score" else contract,
             "trick": [[s, c] for s, c in self.trick], "last": self.last, "hand": self.hands[i] if i is not None else [],
             "scores": {"title": "Points", "rows": [{"seat": s, "value": self.score[s], "sub": f"& {self.nm(s + 2)}"} for s in (0, 1)],
                        "hint": f"Deal {self.deal_no} of {self.s['deals']} · " + (auction if self.stage == "bid" else "Chicago scoring")}}
        if i is None:
            return t
        if self.stage == "play" and self.open and i == self.declarer:
            t["rows"] = [{"label": f"Dummy ({self.nm(self.dummy)})", "cards": self.hands[self.dummy], "keys": self.hands[self.dummy]}]
        if self.stage == "play" and i == self.dummy:
            t["note"] = f"You're dummy: {self.nm(self.declarer)} plays your cards."
        if self.room.turn != p.id:
            return t
        if self.stage == "bid":
            opts = self.options(i)
            s, b = self.last_bid()
            bids = [o for o in opts if o not in ("P", "X", "XX")]
            # the next level up in each strain, plus a jump, so the list stays short
            shown = []
            for x in STRAINS:
                mine = [o for o in bids if o[1] == x][:3]
                shown += mine
            shown.sort(key=bid_rank)
            t["buttons"] = [{"label": "Pass", "a": {"type": "call", "call": "P"}}] + \
                [{"label": bname(c), "a": {"type": "call", "call": c}, "kind": ""} for c in ("X", "XX") if c in opts] + \
                [{"label": bname(o), "a": {"type": "call", "call": o}, "kind": "primary"} for o in shown]
            hcp, length = self.points(i)
            t["note"] = f"You have {hcp} high-card points (A4 K3 Q2 J1). Auction: " + (auction or "you open.")
            t["turnText"] = "🌉 Your call"
        elif self.stage == "play":
            s = self.cur
            t["moves"] = [{"card": c, "a": {"type": "play", "card": c}} for c in self.legal(s)]
            t["turnText"] = "🪟 Play from dummy" if s != i else "🌉 Your card"
        return t
