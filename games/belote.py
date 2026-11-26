"""Belote: France's favourite, from the Jass family. Four players in pairs, 32 cards.

Five cards each and one turned up. In the first round each player may take the turned card's suit as
trumps or pass; in the second, name another suit or pass (all pass: a new deal). The taker gets the
turned card and everyone is dealt up to eight. In trumps the jack (20) and nine (14) are top, then
A 11, 10 10, K 4, Q 3, 8, 7; in other suits A 11, 10 10, K 4, Q 3, J 2, then 9 8 7. Follow suit; if you
can't, you must trump (unless your partner is winning the trick), and you must beat a trump already
played if you can. King and queen of trumps together score 20 (belote, rebelote). The last trick is worth
10. The taking side must score more than half (82 of 162), or the defenders take all 162. First to 1000."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

PLAIN = "789JQKTA"
TRUMP = "78QKTA9J"
PTS_PLAIN = {"A": 11, "T": 10, "K": 4, "Q": 3, "J": 2}
PTS_TRUMP = {"J": 20, "9": 14, "A": 11, "T": 10, "K": 4, "Q": 3}


class Belote(TrickGame):
    id = "belote"
    solo_bots = 3
    name = "Belote"
    icon = "🥖"
    blurb = "The French classic: take trumps, ride the jack and nine, and call belote. Four players in pairs."
    howto = [
        "Five cards each, one turned up. Take its suit as trumps, or pass; second round, name a suit or pass.",
        "Trumps rank J (20) 9 (14) A K… Elsewhere A 11, 10 10, K 4, Q 3, J 2. The last trick is worth 10.",
        "Follow suit. Can't? You must trump unless your partner is winning, and beat any trump already played.",
        "King and queen of trumps: belote, +20. The takers must score over 81 of 162, or the defenders take it all.",
        "First pair to the target wins.",
        "An option: win the last trick with the trump jack for a bonus 20.",
    ]
    min_players, max_players = 4, 4
    teams = True
    badges = {**TrickGame.badges, "capot": ("🧹", "Capot", "Take all eight tricks")}
    settings_schema = {"target": ("Play to", [(1000, "1000"), (501, "501 (quick)")], 1000),
                       "lastjack": ("🃏 Last jack", [(False, "Off"), (True, "On: +20")], False)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(4)
        self.hand_no = 0
        self.room.add_log(f"🥖 Belote to {self.s['target']}: {self.side_name(0)} vs {self.side_name(1)}.", "big")
        self.deal()

    def side_name(self, s):
        return f"{self.nm(s)} & {self.nm(s + 2)}"

    def make_deck(self):
        return deck("789TJQKA")

    def power(self, c):
        if self.trump and suit(c) == self.trump:
            return 10 + TRUMP.index(rank(c))
        return PLAIN.index(rank(c))

    def pts(self, c):
        return (PTS_TRUMP if suit(c) == self.trump else PTS_PLAIN).get(rank(c), 0)

    def deal(self):
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % 4
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.trump = None
        self.hands = [cards[k * 5:(k + 1) * 5] for k in range(4)]
        self.turned = cards[20]
        self.rest = cards[21:]
        self.round = 1
        self.taker = None
        self.trick, self.last, self.tricks = [], None, [0] * 4
        self.said = [None] * 4
        self.result = None
        self.belote = None
        self.stage = "bid"
        for k in range(4):
            self.sort_hand(k)
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.turned)} turned.")
        self.to((self.dealer + 1) % 4)

    # -- the bidding

    def take(self, i, s):
        self.taker, self.trump = i, s
        self.moment(f"🥖 {self.nm(i)} takes: {SUIT_NAME[s]} are trumps!", "cool", "whoosh")
        self.hands[i].append(self.turned)
        rest = self.rest
        for k in range(4):
            need = 8 - len(self.hands[k])
            self.hands[k] += rest[:need]
            rest = rest[need:]
        for k in range(4):
            self.sort_hand(k)
            if ("K" + s) in self.hands[k] and ("Q" + s) in self.hands[k]:
                self.belote = k
        self.won = [[] for _ in range(4)]
        self.start_tricks((self.dealer + 1) % 4)

    def pass_(self, i):
        self.said[i] = "pass"
        self.room.add_log(f"{self.nm(i)} passes.")
        if i == self.dealer:
            if self.round == 1:
                self.round = 2
                self.said = [None] * 4
            else:
                self.room.add_log("😶 Nobody takes: a new deal.")
                self.stage = "score"
                return self.pause(self.deal, 2)
        self.to((i + 1) % 4)

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if self.stage != "bid":
            raise GameError("Not now.")
        if t == "pass":
            return self.pass_(i)
        if t == "take":
            s = a.get("suit")
            if self.round == 1 and s != suit(self.turned):
                raise GameError("First round: take the turned suit, or pass.")
            if self.round == 2 and (s not in "CDHS" or s == suit(self.turned) or len(s) != 1):
                raise GameError("Second round: name a different suit.")
            self.room.add_log(f"🙋 {self.nm(i)} takes {SUIT_NAME[s]}.")
            return self.take(i, s)
        raise GameError("Unknown action.")

    def value(self, i, s, level):
        hand = self.hands[i] + [self.turned]
        e = 0.0
        for c in hand:
            r = rank(c)
            if suit(c) == s:
                e += {"J": 3.2, "9": 2.2, "A": 1.4, "T": 1.0}.get(r, 0.7)
            elif r == "A":
                e += 1.1
            elif r == "T":
                e += 0.4
        if ("K" + s) in hand and ("Q" + s) in hand:
            e += 1
        return e

    def bot_other(self, i, level):
        if self.stage != "bid":
            return
        bar = {"easy": 6.2, "normal": 5.6, "hard": 5.3}[level]
        if self.round == 1:
            s = suit(self.turned)
            v = self.value(i, s, level) + (random.uniform(-1, 1) if level == "easy" else 0)
            return self.act_bid(i, s if v >= bar else None)
        best = max((x for x in "CDHS" if x != suit(self.turned)), key=lambda x: self.value(i, x, level))
        v = self.value(i, best, level) - 0.6 + (random.uniform(-1, 1) if level == "easy" else 0)  # no turned card for us now
        self.act_bid(i, best if v >= bar else None)

    def act_bid(self, i, s):
        if s is None:
            return self.pass_(i)
        self.room.add_log(f"🙋 {self.nm(i)} takes {SUIT_NAME[s]}.")
        self.take(i, s)

    # -- play

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick:
            return hand[:]
        t = self.trump
        led = suit(self.trick[0][1])
        bs, best = self.best_of(self.trick)
        same = [c for c in hand if suit(c) == led]
        trumps = [c for c in hand if suit(c) == t]
        over = lambda cs: [c for c in cs if self.beats(c, best, led)]
        if same:
            if led == t:
                return over(same) or same
            return same
        if not trumps:
            return hand[:]
        if self.partner(i) == bs:
            return hand[:]        # partner is master: free to discard
        return over(trumps) or (trumps if suit(best) != t else hand[:])

    def on_card(self, i, c):
        if self.belote == i and suit(c) == self.trump and rank(c) in "KQ":
            other = ("Q" if rank(c) == "K" else "K") + self.trump
            if other in self.hands[i]:
                self.room.add_log(f"👑 {self.nm(i)}: belote!", "power")
            else:
                self.room.add_log(f"👑 {self.nm(i)}: rebelote! (+20)", "power")

    def end_hand(self):
        side = lambda k: k % 2
        pts = [0, 0]
        tr = [0, 0]
        for k in range(4):
            pts[side(k)] += sum(self.pts(c) for c in self.won[k])
            tr[side(k)] += self.tricks[k]
        pts[side(self.last["winner"])] += 10
        ts = side(self.taker)
        if tr[ts] == 8 or tr[1 - ts] == 8:
            w = ts if tr[ts] == 8 else 1 - ts
            pts[w], pts[1 - w] = 252, 0
            for k in (w, w + 2):
                if self.pl(k):
                    self.award(self.pl(k), "capot")
        bel = [0, 0]
        if self.belote is not None:
            bel[side(self.belote)] = 20
        jack = ""
        if self.s.get("lastjack", False):
            w = self.last["winner"]
            if any(sd == w and c == "J" + self.trump for sd, c in self.last["cards"]):
                bel[side(w)] += 20
                jack = " (+20 last jack)"
                self.moment(f"🃏 {self.nm(w)} takes the last trick with the jack: +20!", "gold", "chime")
        if pts[ts] + bel[ts] > pts[1 - ts] + bel[1 - ts]:
            gain = [pts[0] + bel[0], pts[1] + bel[1]]
            text = f"✅ {self.side_name(ts)} make it: {pts[ts]} to {pts[1 - ts]}{jack}"
        else:
            gain = [0, 0]
            gain[1 - ts] = max(162, pts[0] + pts[1]) + bel[0] + bel[1]
            text = f"❌ {self.side_name(ts)} are dedans ({pts[ts]}): all to the defenders{jack}"
            self.moment(text, "bad", "boom")
        for s in (0, 1):
            self.score[s] += gain[s]
        self.result = text
        self.room.add_log(f"🧮 {text}. +{gain[0]} / +{gain[1]}", "big")
        tgt = self.s["target"]
        if max(self.score) >= tgt and self.score[0] != self.score[1]:
            w = 0 if self.score[0] > self.score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.side_name(w)} win Belote, {self.score[w]} to {self.score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 4)

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
            if self.stage == "bid" and self.said[k]:
                tags.append("pass")
            if k == self.taker:
                tags.append("🙋 taker")
            if k == self.dealer:
                tags.append("dealer")
            if self.stage == "play":
                tags.append(f"{self.tricks[k]} tricks")
            info.append({"count": len(self.hands[k]), "tags": tags})
        t = {"info": info, "trump": self.trump,
             "piles": [{"cards": [self.turned], "label": "Turned" + (" (2nd round)" if self.round == 2 else ""), "glow": True}] if self.stage == "bid" else [],
             "banner": self.result if self.stage == "score" else None,
             "scores": {"title": "Points", "rows": [{"seat": s, "value": self.score[s], "sub": f"& {self.nm(s + 2)}"} for s in (0, 1)],
                        "hint": f"To {self.s['target']} · trumps J 20, 9 14, A 11, 10 10"}}
        t.update(self.trick_view(p, i))
        if i is None or self.room.turn != p.id or self.stage != "bid":
            return t
        if self.round == 1:
            s = suit(self.turned)
            t["buttons"] = [{"label": f"🙋 Take {SUIT_NAME[s]}", "a": {"type": "take", "suit": s}, "kind": "primary"}, {"label": "Pass", "a": {"type": "pass"}}]
            t["note"] = f"Take {pretty(self.turned)}, making {SUIT_NAME[s]} trumps?"
        else:
            t["buttons"] = [{"label": f"🙋 {SUIT_NAME[s].title()}", "a": {"type": "take", "suit": s}, "kind": "primary"} for s in "CDHS" if s != suit(self.turned)] + [{"label": "Pass", "a": {"type": "pass"}}]
            t["note"] = "Second round: name another suit as trumps, or pass."
        t["turnText"] = "🙋 Take or pass?"
        return t
