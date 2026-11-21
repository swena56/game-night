"""Bezique: the two-player meld-and-trick classic with a 64-card double pack.

Two packs of 7 up to ace (ranked A 10 K Q J 9 8 7), eight cards each, and the next card turned for
trumps (a turned seven: the dealer scores 10). While the stock lasts you may play any card; the trick
goes to the higher card of the suit led or a trump, and the leader wins ties. The trick winner may then
declare one meld, laying it face up (those cards can still be played): bezique (Q♠ J♦) 40, double
bezique 500, royal marriage (K Q of trumps) 40, other marriages 20, trump sequence (A 10 K Q J) 250,
any four aces 100, kings 80, queens 60, jacks 40, or show a seven of trumps for 10 (the first also swaps
for the turned card). A card can't be used twice in the same kind of meld, and every meld needs a
card from your hand. Then the winner draws, then the loser. When the stock is gone, take your melds
back in hand and play the last eight tricks: follow suit and win if you can, trump if you can't follow.
Aces and tens taken (brisques) count 10 each, the last trick 10. Most points after the target wins."""
import random

from .cardbase import GameError, rank, suit, pretty, show, rname, SUIT_NAME
from .tricks import TrickGame

FOURS = {"A": 100, "K": 80, "Q": 60, "J": 40}
KIND_NAME = {"marriage": "marriage", "royal": "royal marriage", "bezique": "bezique", "double": "double bezique",
             "seq": "sequence", "four": "four of a kind", "seven": "seven of trumps"}


class Bezique(TrickGame):
    id = "bezique"
    name = "Bezique"
    icon = "🎴"
    blurb = "Two packs, eight cards: win tricks to declare beziques, marriages and sequences, then the last eight count."
    howto = [
        "Eight cards each from a 64-card pack (A 10 K Q J 9 8 7); the turned card sets trumps. Any card can be played.",
        "Win a trick and you may declare one meld: bezique (Q♠ J♦) 40, double 500, sequence 250, marriages 20/40, four aces 100…",
        "Melds lie face up and can still be played. A card can't repeat the same kind of meld; each meld needs a hand card.",
        "When the stock is gone: take melds back, follow suit and win if you can, trump if you can't.",
        "Aces and tens taken score 10 each, the last trick 10. First to the target wins.",
        "An option: trump a plain ace or ten with a low trump (7, 8 or 9) for a bonus 10.",
    ]
    min_players, max_players = 2, 2
    order = "789JQKTA"
    badges = {**TrickGame.badges, "double": ("💎", "Double bezique", "Declare double bezique (500)")}
    settings_schema = {"target": ("Play to", [(1000, "1000"), (500, "500 (quick)"), (2000, "2000")], 1000),
                       "giant": ("🗡️ Giant killer", [(False, "Off"), (True, "On: +10")], False)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0]
        self.dealer = rng.randrange(2)
        self.hand_no = 0
        self.room.add_log(f"🎴 Bezique to {self.s['target']}.", "big")
        self.deal()

    def make_deck(self):
        return [r + s for s in "CDHS" for r in self.order] * 2

    def full_deck(self):
        return set(self.make_deck())

    def deal(self):
        self.hand_no += 1
        self.dealer = 1 - self.dealer
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[:8], cards[8:16]]
        self.turned = cards[16]
        self.trump = suit(self.turned)
        self.stock = cards[17:] + [self.turned]
        self.laid = [[], []]          # melded cards: {"card", "kinds"}
        self.sevens = [0, 0]
        self.phase = 1
        self.trick, self.last, self.tricks = [], None, [0, 0]
        self.won = [[], []]
        self.played = set()
        self.melder = None
        self.result = None
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.turned)} turned, {SUIT_NAME[self.trump]} are trumps.")
        if rank(self.turned) == "7":
            self.score[self.dealer] += 10
            self.room.add_log(f"7️⃣ {self.nm(self.dealer)} +10 for the turned seven.")
        for k in (0, 1):
            self.sort_hand(k)
        self.stage = "play"
        self.to(1 - self.dealer)

    # -- cards from hand or table

    def mine(self, i):
        """Every playable card as key -> card: hand cards by code, table cards as t<index>."""
        out = {c: c for c in self.hands[i]}
        for k, e in enumerate(self.laid[i]):
            out[f"t{k}"] = e["card"]
        return out

    def take_card(self, i, key):
        if key.startswith("t"):
            return self.laid[i].pop(int(key[1:]))["card"]
        self.hands[i].remove(key)
        return key

    def legal_keys(self, i):
        keys = self.mine(i)
        if not self.trick or self.phase == 1:
            return list(keys)
        led = self.trick[0][1]
        same = [k for k, c in keys.items() if suit(c) == suit(led)]
        if same:
            return [k for k in same if self.power(keys[k]) > self.power(led)] or same
        tr = [k for k, c in keys.items() if suit(c) == self.trump]
        return tr or list(keys)

    def legal(self, i):
        keys = self.mine(i)
        return [keys[k] for k in self.legal_keys(i)]

    # -- tricks

    def play_key(self, i, key):
        c = self.take_card(i, key)
        self.trick.append((i, c))
        if len(self.trick) < 2:
            return self.to(1 - i)
        (a, ca), (b, cb) = self.trick
        w = b if self.beats(cb, ca, suit(ca)) else a
        cards = [ca, cb]
        self.tricks[w] += 1
        self.won[w] += cards
        self.played.update(cards)
        self.last = {"cards": [[s, c] for s, c in self.trick], "winner": w}
        self.trick = []
        self.room.add_log(f"🃏 {show(cards)} → {self.nm(w)}", "question")
        if self.s.get("giant", False):
            cw, cl = (cb, ca) if w == b else (ca, cb)
            if suit(cw) == self.trump and rank(cw) in "789" and suit(cl) != self.trump and rank(cl) in "AT":
                self.score[w] += 10
                self.moment(f"🗡️ {self.nm(w)} trumps the {rname(rank(cl), 1)} with a {rname(rank(cw), 1)}: +10!", "gold", "chime")
        if self.phase == 1:
            self.melder = w
            self.stage = "meld"
            return self.to(w)
        if not self.hands[0] and not self.hands[1]:
            self.score[w] += 10
            self.room.add_log(f"🏁 {self.nm(w)} takes the last trick: +10.")
            return self.end_hand()
        self.to(w)

    def after_meld(self, w):
        # draw: winner first; the loser gets the turned card last
        self.hands[w].append(self.stock.pop(0))
        self.hands[1 - w].append(self.stock.pop(0))
        if not self.stock:
            self.phase = 2
            for k in (0, 1):
                self.hands[k] += [e["card"] for e in self.laid[k]]
                self.laid[k] = []
            self.moment("📭 The stock is gone: the last eight tricks. Follow suit and win if you can!", "cool", "whoosh")
            self.played = set()
        for k in (0, 1):
            self.sort_hand(k)
        self.stage = "play"
        self.melder = None
        self.to(w)

    # -- melds

    def classify(self, cards):
        cs = sorted(cards)
        t = self.trump
        if len(cs) == 2:
            a, b = cs
            if {rank(a), rank(b)} == {"K", "Q"} and suit(a) == suit(b):
                return ("royal", 40) if suit(a) == t else ("marriage", 20)
            if set(cs) == {"QS", "JD"}:
                return ("bezique", 40)
        if len(cs) == 4:
            if cs == ["JD", "JD", "QS", "QS"]:
                return ("double", 500)
            if len({rank(c) for c in cs}) == 1 and rank(cs[0]) in FOURS:
                return ("four", FOURS[rank(cs[0])])
        if len(cs) == 5 and sorted(rank(c) for c in cs) == sorted("ATKQJ") and all(suit(c) == t for c in cs):
            return ("seq", 250)
        return None

    def check(self, i, keys):
        """Validate a meld given as keys (hand codes / t<index>); returns (kind, points, hand cards, table idxs)."""
        if not isinstance(keys, list) or not 2 <= len(keys) <= 5:
            raise GameError("A meld is two to five cards.")
        hand = list(self.hands[i])
        from_hand, from_table = [], []
        for k in keys:
            if isinstance(k, str) and k.startswith("t") and k[1:].isdigit() and int(k[1:]) < len(self.laid[i]):
                if int(k[1:]) in from_table:
                    raise GameError("Pick each card once.")
                from_table.append(int(k[1:]))
            elif k in hand:
                hand.remove(k)
                from_hand.append(k)
            else:
                raise GameError("Those cards aren't yours.")
        if not from_hand:
            raise GameError("Every meld needs at least one card from your hand.")
        cards = from_hand + [self.laid[i][x]["card"] for x in from_table]
        got = self.classify(cards)
        if not got:
            raise GameError("That isn't a meld.")
        kind, pts = got
        fam = "marriage" if kind == "royal" else kind
        for x in from_table:
            if fam in self.laid[i][x]["kinds"]:
                raise GameError(f"One of those cards was already in a {KIND_NAME[kind]}.")
        return kind, pts, from_hand, from_table

    def declare(self, i, keys):
        kind, pts, hand, tab = self.check(i, keys)
        fam = "marriage" if kind == "royal" else kind
        for x in tab:
            self.laid[i][x]["kinds"].add(fam)
        for c in hand:
            self.hands[i].remove(c)
            self.laid[i].append({"card": c, "kinds": {fam}})
        self.score[i] += pts
        cards = hand + [self.laid[i][x]["card"] for x in tab]
        what = f"four {rname(rank(cards[0]))}" if kind == "four" else KIND_NAME[kind]
        self.room.add_log(f"🎴 {self.nm(i)} declares {what}: {show(cards)} +{pts}.", "power")
        if pts >= 100:
            self.moment(f"🎴 {self.nm(i)}: {what}! +{pts}", "gold", "fanfare")
        if kind == "double" and self.pl(i):
            self.award(self.pl(i), "double")
        self.after_meld(i)

    def seven(self, i):
        s7 = "7" + self.trump
        if not self.can_seven(i):
            raise GameError("You need a seven of trumps in your hand.")
        self.score[i] += 10
        self.hands[i].remove(s7)
        if rank(self.turned) != "7" and self.stock and self.stock[-1] == self.turned:
            self.hands[i].append(self.turned)
            self.stock[-1] = s7
            self.room.add_log(f"7️⃣ {self.nm(i)} swaps the seven of trumps for {pretty(self.turned)}: +10.")
            self.turned = s7
            self.sort_hand(i)
        else:
            self.laid[i].append({"card": s7, "kinds": {"seven"}})
            self.room.add_log(f"7️⃣ {self.nm(i)} shows the seven of trumps: +10.")
        self.after_meld(i)

    def can_seven(self, i):
        return ("7" + self.trump) in self.hands[i]

    def options(self, i):
        """All melds this player could declare now (for the bot)."""
        keys = self.mine(i)
        items = list(keys.items())
        out = []
        groups = {}
        for k, c in items:
            groups.setdefault(c, []).append(k)
        t = self.trump

        def first(code, avoid=()):
            for k in groups.get(code, []):
                if k not in avoid:
                    return k
            return None

        def tryit(sel):
            if None in sel:
                return
            try:
                kind, pts, _, _ = self.check(i, list(sel))
                out.append((pts, list(sel), kind))
            except GameError:
                pass
        for s in "CDHS":
            for kk in groups.get("K" + s, []):
                for qk in groups.get("Q" + s, []):
                    tryit([kk, qk])
        for qk in groups.get("QS", []):
            for jk in groups.get("JD", []):
                tryit([qk, jk])
        if len(groups.get("QS", [])) >= 2 and len(groups.get("JD", [])) >= 2:
            tryit(groups["QS"][:2] + groups["JD"][:2])
        for r in FOURS:
            ks = [k for k, c in items if rank(c) == r]
            if len(ks) >= 4:
                fresh = sorted(ks, key=lambda k: k.startswith("t"))
                tryit(fresh[:4])
        seq = [first(r + t) for r in "ATKQJ"]
        tryit(seq)
        return out

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        if t == "play" and self.stage == "play":
            key = a.get("card")
            if key not in self.legal_keys(i):
                raise GameError("Follow suit and win the trick if you can." if self.phase == 2 else "That card isn't yours.")
            return self.play_key(i, key)
        if self.stage == "meld" and i == self.melder:
            if t == "meld":
                return self.declare(i, a.get("cards"))
            if t == "seven":
                return self.seven(i)
            if t == "nomeld":
                return self.after_meld(i)
        raise GameError("Not now.")

    def bot_move(self, i, level):
        if self.stage == "meld":
            opts = self.options(i)
            if opts and (level != "easy" or random.random() < 0.7):
                pts, sel, kind = max(opts, key=lambda o: o[0])
                return self.declare(i, sel)
            if self.can_seven(i):
                return self.seven(i)
            return self.after_meld(i)
        if self.stage != "play":
            return
        keys = self.mine(i)
        legal = self.legal_keys(i)
        t = self.trump
        if self.phase == 2 or level == "easy":
            c = self.bot_card(i, level)
            return self.play_key(i, next(k for k in legal if keys[k] == c))
        valuable = {"QS", "JD", "K" + t, "Q" + t, "A" + t, "T" + t, "J" + t}
        def keep(k):
            c = keys[k]
            return (c in valuable) * 3 + (rank(c) in "AT") * 2 + (rank(c) in "KQ") + (k.startswith("t") * -1)
        if not self.trick:
            plain = [k for k in legal if suit(keys[k]) != t] or legal
            return self.play_key(i, min(plain, key=lambda k: (keep(k), self.power(keys[k]))))
        led = self.trick[0][1]
        wins = [k for k in legal if self.beats(keys[k], led, suit(led))]
        if rank(led) in "AT" and wins:
            return self.play_key(i, min(wins, key=lambda k: (keep(k), self.power(keys[k]))))
        if wins and level == "hard":
            cheap = [k for k in wins if keep(k) == 0 or (rank(keys[k]) in "AT" and suit(keys[k]) == suit(led))]
            if self.s.get("giant", False):
                # a low trump is worth +10 on a plain ace or ten: don't spend it on a lesser card
                cheap = [k for k in cheap if not (suit(keys[k]) == t and rank(keys[k]) in "789")]
            if cheap:
                return self.play_key(i, min(cheap, key=lambda k: keep(k)))
        lose = [k for k in legal if k not in wins] or legal
        return self.play_key(i, min(lose, key=lambda k: (keep(k), self.power(keys[k]))))

    # -- scoring

    def end_hand(self):
        for k in (0, 1):
            b = sum(10 for c in self.won[k] if rank(c) in "AT")
            self.score[k] += b
            self.room.add_log(f"✨ {self.nm(k)}: brisques +{b}.")
        self.result = f"{self.nm(0)} {self.score[0]} · {self.nm(1)} {self.score[1]}"
        self.room.add_log(f"🧮 {self.result}", "big")
        tgt = self.s["target"]
        if max(self.score) >= tgt and self.score[0] != self.score[1]:
            w = 0 if self.score[0] > self.score[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} wins Bezique, {self.score[w]} to {self.score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i]} pts"

    def final_scores(self):
        return {pid: self.score[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "show": [e["card"] for e in self.laid[k]] if k != i else [],
                 "tags": [f"{self.tricks[k]} tricks"]} for k in (0, 1)]
        piles = []
        if self.stock:
            piles.append({"cards": [self.turned], "count": len(self.stock), "label": "Stock (turned card last)", "corner": True})
        t = {"info": info, "trump": self.trump, "piles": piles, "trick": [[s, c] for s, c in self.trick], "last": self.last,
             "hand": self.hands[i] if i is not None else [],
             "banner": self.result if self.stage == "score" else None,
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.score[k]} for k in (0, 1)],
                        "hint": f"To {self.s['target']} · " + ("tricks don't need to follow yet" if self.phase == 1 else "last eight: follow and win")}}
        if i is None:
            return t
        if self.laid[i]:
            t["rows"] = [{"label": "Your melds (still playable)", "cards": [e["card"] for e in self.laid[i]], "keys": [f"t{k}" for k in range(len(self.laid[i]))]}]
        if self.room.turn != p.id:
            return t
        if self.stage == "play":
            t["moves"] = [{"card": k, "a": {"type": "play", "card": k}} for k in self.legal_keys(i)]
            t["turnText"] = "🎴 Your card"
        elif self.stage == "meld":
            t["pick"] = {"act": "meld", "min": 2, "max": 5, "label": "Declare meld"}
            t["buttons"] = ([{"label": "7️⃣ Show the seven of trumps (+10)", "a": {"type": "seven"}}] if self.can_seven(i) else []) + \
                [{"label": "No meld", "a": {"type": "nomeld"}}]
            hint = self.options(i)
            t["note"] = "You won the trick: pick cards to declare a meld" + (f" (you have {len(hint)} possible)" if hint else "") + ", or skip."
            t["turnText"] = "🎴 Declare a meld?"
        return t
