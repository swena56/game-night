"""Sixty-Six (and Schnapsen): race to 66 card points in a two-player trick game with a stock.

Sixty-Six uses 24 cards (9 to ace), six each; Schnapsen uses 20 (jack to ace), five each. The next
card is turned for trumps and goes under the stock. Cards count A 11, 10 10, K 4, Q 3, J 2, 9 0.
While the stock lasts you may play anything; after each trick the winner draws first. Leading a king
or queen while holding its partner scores a marriage: 20, or 40 in trumps. The lowest trump can be
swapped for the turned card. When the stock runs out, or someone closes it, you must follow suit and
win the trick if you can, and trump if you can't follow. The first to 66 wins the hand: 1 game point,
2 if the other has under 33, 3 if they took no tricks. In Sixty-Six the last trick is worth 10. Close
and miss 66 and your rival scores 2. First to 7 game points wins."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

PTS = {"A": 11, "T": 10, "K": 4, "Q": 3, "J": 2, "9": 0}


def pts(c):
    return PTS[rank(c)]


class SixtySix(TrickGame):
    id = "sixtysix"
    name = "Sixty-Six"
    icon = "6️⃣"
    blurb = "Two-player race to 66 card points: draw from the stock, call marriages, close the stock and squeeze."
    howto = [
        "Cards count A 11, 10 10, K 4, Q 3, J 2, 9 0. Reach 66 to win the hand. The turned card sets trumps.",
        "While the stock lasts play anything; the trick winner draws first.",
        "Lead a K or Q holding its partner to score a marriage: 20, or 40 in trumps. Swap your lowest trump for the turned card.",
        "Once the stock is gone or closed: follow suit, win the trick if you can, trump if you can't follow.",
        "Win the hand for 1 game point, 2 if they have under 33, 3 if they took no tricks. First to 7.",
    ]
    min_players, max_players = 2, 2
    order = "9JQKTA"
    follow = True
    badges = {**TrickGame.badges, "closer": ("🔒", "Lock-out", "Close the stock and make 66")}
    settings_schema = {"rules": ("Rules", [("66", "Sixty-Six (24 cards)"), ("schnapsen", "Schnapsen (20 cards)")], "66"),
                       "target": ("Game points", [(7, "First to 7"), (3, "First to 3 (quick)"), (11, "First to 11")], 7)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.hand_no = 0
        self.dealer = rng.randrange(2)
        self.room.add_log(f"6️⃣ {self.label()} to {self.s['target']} game points.", "big")
        self.deal()

    def label(self):
        return "Schnapsen" if self.schn() else "Sixty-Six"

    def schn(self):
        return self.s.get("rules") == "schnapsen"

    def make_deck(self):
        return deck("JQKTA" if self.schn() else self.order)

    def deal(self):
        self.hand_no += 1
        self.dealer = 1 - self.dealer
        cards = self.make_deck()
        self.rng.shuffle(cards)
        per = 5 if self.schn() else 6
        self.hands = [cards[:per], cards[per:2 * per]]
        self.turned = cards[2 * per]
        self.trump = suit(self.turned)
        self.stock = cards[2 * per + 1:] + [self.turned]     # the turned card is drawn last
        self.closed = None
        self.points = [0, 0]
        self.held = [0, 0]           # marriages called before taking a trick
        self.marr = []
        self.taken = [0, 0]
        self.result = None
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.turned)} turned, {SUIT_NAME[self.trump]} are trumps.")
        self.start_tricks(1 - self.dealer)

    def low_trump(self):
        return ("J" if self.schn() else "9") + self.trump

    def strict(self):
        return self.closed is not None or not self.stock

    # -- rules

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick or not self.strict():
            return hand[:]
        led = self.trick[0][1]
        same = [c for c in hand if suit(c) == suit(led)]
        if same:
            over = [c for c in same if self.power(c) > self.power(led)]
            return over or same
        trumps = [c for c in hand if suit(c) == self.trump]
        return trumps or hand[:]

    def marriage_ok(self, i, c):
        if self.trick or rank(c) not in "KQ":
            return False
        other = ("Q" if rank(c) == "K" else "K") + suit(c)
        return other in self.hands[i]

    def do_play(self, i, c, marry=False):
        if marry:
            v = 40 if suit(c) == self.trump else 20
            self.marr.append(suit(c))
            if self.taken[i]:
                self.points[i] += v
            else:
                self.held[i] += v
            self.moment(f"💍 {self.nm(i)} calls a marriage in {SUIT_NAME[suit(c)]}: {v}!", "gold", "fanfare")
            self.room.add_log(f"💍 {self.nm(i)} shows {show(['K' + suit(c), 'Q' + suit(c)])}: +{v}.", "power")
            if self.points[i] >= 66:
                return self.hand_over(i, "marriage")
        self.play(i, c)

    def on_trick(self, w, cards):
        self.taken[w] += 1
        self.points[w] += sum(pts(c) for c in cards) + self.held[w]
        self.held[w] = 0
        if not self.schn() and not any(self.hands) and not self.stock:
            self.points[w] += 10
            self.room.add_log(f"🏁 {self.nm(w)} takes the last trick: +10.")
        if self.points[w] >= 66:
            return self.hand_over(w, "66")
        if self.stock and self.closed is None:
            self.hands[w].append(self.stock.pop(0))
            self.hands[1 - w].append(self.stock.pop(0))
            self.sort_hand(0)
            self.sort_hand(1)
            if not self.stock:
                self.room.add_log("📭 The stock is gone: follow suit and head the trick from now on.")

    def next_lead(self, w):
        if self.stage == "play":
            self.to(w)

    def end_hand(self):
        if self.stage != "play":
            return
        # all cards played and nobody got to 66
        if self.closed is not None:
            return self.hand_over(1 - self.closed, "failed")
        if self.schn():
            w = self.last["winner"]
            return self.hand_over(w, "last")
        a, b = self.points
        if a == b:
            self.result = {"text": f"🤝 {a}–{b}: nobody scores this hand."}
            self.room.add_log(self.result["text"], "big")
            return self.next_hand()
        self.hand_over(0 if a > b else 1, "most")

    def hand_over(self, w, why):
        lose = 1 - w
        if why == "failed":
            gp = 2 if self.taken[w] else 3
            text = f"🔓 {self.nm(lose)} closed but missed 66: {self.nm(w)} +{gp}."
        else:
            gp = 1 if self.points[lose] >= 33 else (3 if not self.taken[lose] else 2)
            if self.closed is not None and self.closed != w:
                gp = max(gp, 2)          # beat the closer to it
            text = f"🏅 {self.nm(w)} wins the hand {self.points[w]}–{self.points[lose]}: +{gp} game point{'s' if gp > 1 else ''}."
            if self.closed == w and self.pl(w):
                self.award(self.pl(w), "closer")
        self.score[w] += gp
        self.result = {"text": text, "winner": w}
        self.room.add_log(text, "big")
        if gp >= 2:
            self.moment(text, "gold", "fanfare")
        self.next_hand()

    def next_hand(self):
        self.trick = []
        if max(self.score) >= self.s["target"]:
            w = 0 if self.score[0] > self.score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} wins {self.label()} {self.score[w]}–{self.score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 3.5)

    # -- actions

    def can_swap(self, i):
        return not self.trick and self.closed is None and len(self.stock) >= 3 and self.low_trump() in self.hands[i]

    def can_close(self, i):
        return not self.trick and self.closed is None and len(self.stock) >= 3 and self.taken[0] + self.taken[1] > 0

    def swap(self, i):
        lt = self.low_trump()
        self.hands[i].remove(lt)
        self.hands[i].append(self.turned)
        self.stock[-1] = lt
        self.room.add_log(f"🔁 {self.nm(i)} swaps {pretty(lt)} for {pretty(self.turned)}.")
        self.turned = lt
        self.sort_hand(i)

    def close(self, i):
        self.closed = i
        self.moment(f"🔒 {self.nm(i)} closes the stock!", "cool", "whoosh")
        self.room.add_log(f"🔒 {self.nm(i)} closes the stock: follow suit and head the trick now.", "power")

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        if t in ("play", "marry"):
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait for the next hand.")
            c = a.get("card")
            if not isinstance(c, str) or c not in self.hands[i] or c not in self.legal(i):
                raise GameError("You must follow suit and head the trick." if self.strict() else "That card isn't in your hand.")
            if t == "marry" and not self.marriage_ok(i, c):
                raise GameError("You need the king and queen of that suit, and must be leading.")
            return self.do_play(i, c, t == "marry")
        if t in ("swap", "close"):
            self.require_turn(p)
            if self.stage != "play" or self.trick:
                raise GameError("Only before you lead.")
            if t == "swap":
                if not self.can_swap(i):
                    raise GameError(f"You need {pretty(self.low_trump())} and an open stock.")
                return self.swap(i)
            if not self.can_close(i):
                raise GameError("You can't close the stock now.")
            return self.close(i)
        raise GameError("Unknown action.")

    # -- bot

    def bot_move(self, i, level):
        if self.stage != "play":
            return
        hand = self.hands[i]
        legal = self.legal(i)
        t = self.trump
        if not self.trick:
            if level != "easy" and self.can_swap(i):
                return self.swap(i)
            if level == "hard" and self.can_close(i):
                trumps = [c for c in hand if suit(c) == t]
                sure = sum(pts(c) for c in trumps if self.is_boss(i, c, level))
                if self.points[i] + sure + len(trumps) * 4 >= 66 and len(trumps) >= 3:
                    return self.close(i)
            marry = [c for c in legal if self.marriage_ok(i, c)]
            if marry and (level != "easy" or random.random() < 0.6):
                c = max(marry, key=lambda c: (suit(c) == t, rank(c) == "Q"))
                return self.do_play(i, c, True)
            if self.strict():
                boss = [c for c in legal if self.is_boss(i, c, level)]
                if boss:
                    return self.do_play(i, max(boss, key=lambda c: (suit(c) != t, pts(c))))
            keep = lambda c: any(rank(x) in "KQ" and suit(x) == suit(c) and x != c and rank(c) in "KQ" for x in hand)
            plain = [c for c in legal if suit(c) != t and not keep(c)] or [c for c in legal if suit(c) != t] or legal
            return self.do_play(i, min(plain, key=lambda c: (pts(c), self.power(c))))
        led = self.trick[0][1]
        wins = [c for c in legal if self.beats(c, led, suit(led))]
        value = pts(led)
        need = 66 - self.points[i]
        if wins:
            same = [c for c in wins if suit(c) == suit(led)]
            if same:
                c = min(same, key=self.power) if level == "easy" else max(same, key=lambda c: pts(c))
                return self.do_play(i, c)
            trumps = sorted(wins, key=lambda c: (pts(c), self.power(c)))
            if value >= 10 or self.strict() or value + pts(trumps[0]) >= need:
                return self.do_play(i, trumps[0])
        losers = [c for c in legal if c not in wins] or legal
        keep = lambda c: rank(c) in "KQ" and any(rank(x) in "KQ" and suit(x) == suit(c) and x != c for x in hand)
        throw = [c for c in losers if suit(c) != t and not keep(c)] or [c for c in losers if suit(c) != t] or losers
        return self.do_play(i, min(throw, key=lambda c: (pts(c), self.power(c))))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i]} game pts"

    def final_scores(self):
        return {pid: self.score[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"{self.taken[k]} tricks"] + (["🔒 closed"] if self.closed == k else [])} for k in range(2)]
        piles = []
        if self.stock:
            piles.append({"cards": [self.turned], "count": len(self.stock), "label": "🔒 Closed" if self.closed is not None else "Stock (turned card)", "corner": True})
        t = {"info": info, "trump": self.trump, "piles": piles,
             "banner": self.result["text"] if self.stage == "score" and self.result else None,
             "scores": {"title": "Game points", "rows": [{"seat": k, "value": self.score[k],
                                                           "sub": f"this hand {self.points[k]}" + (f" (+{self.held[k]})" if self.held[k] else "") if k == i or self.stage == "score" else ""} for k in range(2)],
                        "hint": f"{self.label()} · first to {self.s['target']} · A11 T10 K4 Q3 J2"}}
        t.update(self.trick_view(p, i))
        if i is None or self.stage != "play" or self.room.turn != p.id:
            return t
        moves = []
        for c in self.legal(i):
            moves.append({"card": c, "label": "Play", "a": {"type": "play", "card": c}})
            if self.marriage_ok(i, c):
                v = 40 if suit(c) == self.trump else 20
                moves.append({"card": c, "label": f"💍 Play + marriage ({v})", "a": {"type": "marry", "card": c}})
        t["moves"] = moves
        btn = []
        if self.can_swap(i):
            btn.append({"label": f"🔁 Swap {pretty(self.low_trump())} for {pretty(self.turned)}", "a": {"type": "swap"}})
        if self.can_close(i):
            btn.append({"label": "🔒 Close the stock", "a": {"type": "close"}})
        if btn:
            t["buttons"] = btn
        t["note"] = f"You have {self.points[i]} points" + (f" (+{self.held[i]} once you take a trick)" if self.held[i] else "") + ". " + \
            ("Follow suit and head the trick." if self.strict() and self.trick else "")
        return t
