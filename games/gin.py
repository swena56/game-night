"""Gin Rummy: the two-player draw-and-discard classic.

Ten cards each. On your turn take the top of the stock or the discard pile, then discard. Arrange your
hand into melds: sets (three or four of a rank) and runs (three or more in a row of one suit, ace low).
Cards in no meld are deadwood (ace 1, faces 10). With 10 or less deadwood you may knock as you discard:
both hands are shown, the other player lays off what they can on your melds, and the lower deadwood
scores the difference. Knock with no deadwood at all for gin (+25, nothing laid off). Knock and get
undercut (they have as little or less) and they score the difference +25. When the stock is down to two
cards the hand is a draw. First to the target wins."""
import random
import time

from .cardbase import CardGame, GameError, rank, suit, pretty, show, deck

ORDER = "A23456789TJQK"
VAL = {r: min(10, k + 1) for k, r in enumerate(ORDER)}
SORT = lambda c: ("SHCD".index(suit(c)), ORDER.index(rank(c)))
GIN, UNDERCUT = 25, 25


def dw(cards):
    return sum(VAL[rank(c)] for c in cards)


def candidates(hand):
    out = []
    by_rank = {}
    for c in hand:
        by_rank.setdefault(rank(c), []).append(c)
    for cs in by_rank.values():
        if len(cs) >= 3:
            out.append(tuple(cs))
            if len(cs) == 4:
                out += [tuple(x for x in cs if x != y) for y in cs]
    for s in "SHCD":
        idx = sorted(ORDER.index(rank(c)) for c in hand if suit(c) == s)
        have = set(idx)
        for a in idx:
            b = a
            while b + 1 in have:
                b += 1
                if b - a >= 2:
                    out.append(tuple(ORDER[k] + s for k in range(a, b + 1)))
    return out


def best(hand):
    """(deadwood value, melds, deadwood cards) for the best arrangement of hand."""
    hand = list(hand)
    cands = candidates(hand)
    result = [dw(hand), [], hand]

    def go(k, used, melds):
        left = [c for c in hand if c not in used]
        v = dw(left)
        if v < result[0]:
            result[:] = [v, [list(m) for m in melds], left]
        for j in range(k, len(cands)):
            m = cands[j]
            if not used.intersection(m):
                go(j + 1, used | set(m), melds + [m])
    go(0, set(), [])
    return result[0], result[1], sorted(result[2], key=SORT)


def lay_off(melds, cards):
    """Lay as many of `cards` as possible on `melds`; returns (laid, left)."""
    melds = [list(m) for m in melds]
    left = list(cards)
    laid = []
    changed = True
    while changed:
        changed = False
        for c in list(left):
            for m in melds:
                ranks = {rank(x) for x in m}
                if len(ranks) == 1 and rank(c) in ranks:
                    ok = True
                else:
                    ss = {suit(x) for x in m}
                    idx = sorted(ORDER.index(rank(x)) for x in m)
                    ok = len(ss) == 1 and suit(c) in ss and len(ranks) > 1 and ORDER.index(rank(c)) in (idx[0] - 1, idx[-1] + 1)
                if ok:
                    m.append(c)
                    left.remove(c)
                    laid.append(c)
                    changed = True
                    break
    return laid, left


class Gin(CardGame):
    id = "gin"
    name = "Gin Rummy"
    icon = "🍸"
    blurb = "Draw, discard, and arrange ten cards into sets and runs. Knock low, or go gin."
    howto = [
        "Knock options show an estimate of which unseen cards could be laid off onto your melds.",
        "Ten cards each. Take the top of the stock or the discard pile, then discard one.",
        "Melds: three or four of a rank, or three+ in a row of one suit (ace low). Other cards are deadwood (faces 10, ace 1).",
        "With 10 or less deadwood you can knock as you discard. The other player lays off cards on your melds.",
        "Lower deadwood scores the difference. No deadwood is 🍸 gin: +25. Get undercut and they score +25.",
        "Stock down to two cards: the hand is a draw. First to the target wins.",
    ]
    min_players, max_players = 2, 2
    badges = {**CardGame.badges, "gin": ("🍸", "Gin!", "Go gin"), "undercut": ("🗡️", "Undercut", "Undercut a knock")}
    settings_schema = {"target": ("Game to", [(100, "100 points"), (50, "50 points (quick)"), (150, "150 points")], 100)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0, 0]
        self.dealer = rng.randrange(2)
        self.room.add_log(f"🍸 Gin Rummy to {self.s['target']}.", "big")
        self.deal()

    def deal(self):
        self.dealer = 1 - self.dealer
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [sorted(cards[:10], key=SORT), sorted(cards[10:20], key=SORT)]
        self.discard = [cards[20]]
        self.stock = cards[21:]
        self.took = None                 # the card just taken from the discard pile (can't go straight back)
        self.taken_up = [[], []]         # cards each player took from the discard pile (everyone saw)
        self.reveal = None
        self.stage = "draw"
        self.turns = 0
        self.room.add_log(f"🃏 New hand. {self.nm(1 - self.dealer)} starts.")
        self.to(1 - self.dealer)

    # -- turn

    def draw(self, i, src):
        if src == "discard":
            c = self.discard.pop()
            self.took = c
            self.taken_up[i].append(c)
            self.room.add_log(f"{self.nm(i)} takes {pretty(c)} from the discard pile.")
        else:
            c = self.stock.pop()
            self.took = None
            self.room.add_log(f"{self.nm(i)} draws from the stock.")
        self.hands[i].append(c)
        self.hands[i].sort(key=SORT)
        self.drawn = c
        self.stage = "discard"
        self.room.bot_at = max(self.room.bot_at, time.time() + 0.8)

    def throw(self, i, c, knock=False):
        self.hands[i].remove(c)
        self.discard.append(c)
        self.turns += 1
        if knock:
            return self.do_knock(i)
        self.room.add_log(f"{self.nm(i)} discards {pretty(c)}.")
        if len(self.stock) <= 2:
            self.room.add_log("📭 The stock is down to two: this hand is a draw.", "big")
            self.reveal = {"draw": True, "hands": [best(h)[1:] for h in self.hands]}
            self.stage = "show"
            return self.pause(self.deal, 4)
        self.stage = "draw"
        self.to(1 - i)

    def do_knock(self, i):
        o = 1 - i
        kv, km, kd = best(self.hands[i])
        ov, om, od = best(self.hands[o])
        gin = kv == 0
        laid = []
        if not gin:
            laid, od = lay_off(km, od)
            ov = dw(od)
        if gin:
            pts, w = ov + GIN, i
            self.moment(f"🍸 GIN! {self.nm(i)} +{pts}", "gold", "fanfare")
            if self.pl(i):
                self.award(self.pl(i), "gin")
        elif kv < ov:
            pts, w = ov - kv, i
            self.room.add_log(f"👊 {self.nm(i)} knocks with {kv}: {self.nm(o)} has {ov}" + (f" after laying off {show(laid)}" if laid else "") + f". +{pts}", "big")
        else:
            pts, w = kv - ov + UNDERCUT, o
            self.moment(f"🗡️ UNDERCUT! {self.nm(o)} +{pts}", "bad", "groan")
            if self.pl(o):
                self.award(self.pl(o), "undercut")
        self.scores[w] += pts
        self.reveal = {"knocker": i, "gin": gin, "winner": w, "pts": pts, "laid": laid,
                       "hands": {i: [km, kd], o: [om, od]}, "dw": {i: kv, o: ov}}
        self.room.add_log(f"🧮 {self.nm(0)} {self.scores[0]} · {self.nm(1)} {self.scores[1]}")
        if max(self.scores) >= self.s["target"]:
            w = 0 if self.scores[0] > self.scores[1] else 1
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} wins Gin Rummy, {self.scores[w]} to {self.scores[1 - w]}!")
        self.stage = "show"
        self.pause(self.deal, 6)

    @staticmethod
    def risk_tag(left):
        """A rough, hand-free estimate of undercut danger: the lower your deadwood, the harder you are to undercut."""
        return " · ⚠️ undercut risk" if left >= 8 else " · some risk" if left >= 5 else ""

    def knock_label(self, hand, discard):
        left, melds, _ = best([card for card in hand if card != discard])
        if left > 10:
            return None
        if not left:
            return "🍸 Gin! No layoffs"
        known = set(hand) | set(self.discard)
        possible, _ = lay_off(melds, [card for card in deck() if card not in known])
        exposure = f"possible layoffs: {show(possible)}" if possible else "no unseen layoffs fit"
        return f"👊 Knock ({left}){self.risk_tag(left)} · Estimate: {exposure}"

    def can_knock(self, i, c):
        return best([x for x in self.hands[i] if x != c])[0] <= 10

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        if t == "draw" and self.stage == "draw":
            src = a.get("from")
            if src not in ("stock", "discard") or (src == "discard" and not self.discard):
                raise GameError("Draw from the stock or the discard pile.")
            return self.draw(i, src)
        if t == "discard" and self.stage == "discard":
            c = a.get("card")
            if c not in self.hands[i]:
                raise GameError("That card isn't in your hand.")
            if c == self.took:
                raise GameError("You can't throw back the card you just took.")
            knock = bool(a.get("knock"))
            if knock and not self.can_knock(i, c):
                raise GameError("You need 10 or less deadwood to knock.")
            return self.throw(i, c, knock)
        raise GameError("Not now.")

    # -- bots

    def bot_move(self, i, level):
        if self.stage == "draw":
            top = self.discard[-1] if self.discard else None
            if top and (level != "easy" or random.random() < 0.5):
                now = best(self.hands[i])[0]
                with_top = min(best([x for x in self.hands[i] + [top] if x != d])[0] for d in self.hands[i])
                if with_top < now - (1 if level == "hard" else 3) or (with_top < now and VAL[rank(top)] <= 3):
                    return self.draw(i, "discard")
            return self.draw(i, "stock")
        if self.stage != "discard":
            return
        hand = self.hands[i]
        opts = [c for c in hand if c != self.took]
        if level == "easy" and random.random() < 0.3:
            c = random.choice(opts)
        else:
            def cost(c):
                v = best([x for x in hand if x != c])[0]
                danger = 0
                if level == "hard":
                    for t in self.taken_up[1 - i]:   # don't feed what the other player is collecting
                        if rank(t) == rank(c) or (suit(t) == suit(c) and abs(ORDER.index(rank(t)) - ORDER.index(rank(c))) <= 2):
                            danger += 3
                return (v + danger, -VAL[rank(c)])
            c = min(opts, key=cost)
        left = best([x for x in hand if x != c])[0]
        knock = left <= 10 and (level == "normal" or left == 0 or (level == "hard" and (left <= 4 or self.turns < 8)) or (level == "easy" and random.random() < 0.5))
        self.throw(i, c, knock)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"{self.scores[k]} pts"]} for k in range(2)]
        mine = i is not None and self.room.turn == p.id
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k]} for k in (0, 1)],
                        "hint": f"Game to {self.s['target']}. Gin +{GIN}, undercut +{UNDERCUT}."}}
        draw_now = mine and self.stage == "draw"
        t["piles"] = [{"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Stock",
                       "act": {"type": "draw", "from": "stock"} if draw_now else None},
                      {"cards": self.discard[-1:], "label": "Discard",
                       "act": {"type": "draw", "from": "discard"} if draw_now and self.discard else None}]
        rv = self.reveal
        if rv and self.stage == "show":
            if rv.get("draw"):
                t["banner"] = "A draw: the stock ran out"
            else:
                k, o = rv["knocker"], 1 - rv["knocker"]
                t["banner"] = (f"🍸 {self.nm(k)} goes gin!" if rv["gin"] else f"👊 {self.nm(k)} knocks") + f" · {self.nm(rv['winner'])} +{rv['pts']}"
                t["piles"] = [{"cards": [c for m in rv["hands"][s][0] for c in m] + rv["hands"][s][1], "fan": True, "small": True,
                               "label": f"{self.nm(s)}: {len(rv['hands'][s][0])} meld{'s' if len(rv['hands'][s][0]) != 1 else ''}, deadwood {rv['dw'][s]}"
                               + (f" (laid off {show(rv['laid'])})" if s == o and rv["laid"] else "")} for s in (k, o)]
            return t
        if i is not None:
            v, melds, dead = best(self.hands[i])
            t["note"] = f"Deadwood {v}" + (f": {show(dead)}" if dead and len(dead) <= 6 else "") + (f" · melds: {' | '.join(show(m) for m in melds)}" if melds else "")
        if draw_now:
            t["turnText"] = "🃏 Draw a card"
            t["note"] = "Take the stock or the discard. " + (t.get("note") or "")
        elif mine and self.stage == "discard":
            moves = []
            for c in self.hands[i]:
                if c == self.took:
                    continue
                moves.append({"card": c, "label": "Discard", "a": {"type": "discard", "card": c}})
                label = self.knock_label(self.hands[i], c)
                if label:
                    moves.append({"card": c, "label": label, "a": {"type": "discard", "card": c, "knock": True}})
            t["moves"] = moves
            t["turnText"] = "🗑️ Discard (or knock)"
        return t
