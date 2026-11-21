"""Spite & Malice (Cat & Mouse): competitive patience, for 2-4 players, with two decks (three for 3-4).

Everyone has a pay-off pile (top card up), a hand of five and four discard piles of their own. Up to
four building piles in the middle are shared: each starts with an ace and builds up, suit doesn't
matter, to the queen, and a finished pile goes back into the stock. Kings are wild. On your turn draw
back up to five, then play what you can onto the middle from your hand, your pay-off pile and the tops
of your discard piles; empty your hand and you draw five more. End the turn by discarding one hand
card onto one of your discard piles. First to empty their pay-off pile wins."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show

ORDER = "A23456789TJQ"
VAL = {r: k + 1 for k, r in enumerate(ORDER)}


def v(c):
    return VAL.get(rank(c))


def wild(c):
    return rank(c) == "K"


class Spite(CardGame):
    id = "spite"
    name = "Spite & Malice"
    icon = "😈"
    blurb = "Race to empty your pay-off pile onto shared aces-up piles, and block your rival out of spite."
    howto = [
        "Your pay-off pile is the one to empty. Build the middle piles up from ace to queen (suits don't matter). Kings are wild.",
        "On your turn draw up to five, then play from your hand, your pay-off pile and your discard-pile tops onto the middle.",
        "Empty your hand? Draw five more and keep going.",
        "End your turn by putting a hand card on one of your four discard piles.",
        "👑 An option: finish a pile up to the queen and you draw a bonus card from the stock.",
        "First to empty their pay-off pile wins. Your private pay-off hint shows where the top card can go and which of your cards it would uncover.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "chain": ("⛓️", "Chain", "Play five pay-off cards in one turn")}
    settings_schema = {"payoff": ("Pay-off pile", [(20, "20 cards"), (13, "13 cards (quick)"), (26, "26 cards")], 20),
                       "crown": ("👑 Queen bonus", [(True, "On: finish a pile, draw 1"), (False, "Off")], True)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck(copies=2 if self.n == 2 else 3)
        rng.shuffle(cards)
        k = self.s.get("payoff", 20)
        self.payoff = [cards[j * k:(j + 1) * k] for j in range(self.n)]
        cards = cards[self.n * k:]
        self.hands = [[] for _ in range(self.n)]
        self.discards = [[[] for _ in range(4)] for _ in range(self.n)]
        self.stock = cards
        self.center = []           # each: list of (card, as-value)
        self.done = []
        self.turn_pay = 0
        self.turns = 0
        self.room.add_log(f"😈 Spite & Malice: {k}-card pay-off piles. Kings are wild.", "big")
        first = max(range(self.n), key=lambda j: (v(self.payoff[j][0]) or 13, random.random()))
        self.begin(first)

    def begin(self, i):
        self.turns += 1
        if self.turns > 60 * self.n and not self.stock and not self.done:
            return self.win_by_score([len(x) for x in self.payoff], high=False, what="pay-off cards")
        self.refill(i)
        self.turn_pay = 0
        self.stage = "play"
        self.to(i)

    def refill(self, i):
        while len(self.hands[i]) < 5:
            if not self.stock:
                if not self.done:
                    break
                self.stock = self.done
                self.done = []
                self.rng.shuffle(self.stock)
            self.hands[i].append(self.stock.pop())
        self.hands[i].sort(key=lambda c: (v(c) or 13, suit(c)))

    # -- the middle

    def next_of(self, p):
        return len(p) + 1

    def fits(self, c):
        """The centre piles card c can go on: indices, plus 'new' when an ace (or a king) may start one."""
        out = [k for k, p in enumerate(self.center) if (wild(c) or v(c) == self.next_of(p))]
        if len(self.center) < 4 and (rank(c) == "A" or wild(c)):
            out.append("new")
        return out

    def top(self, i, src):
        if src == "p":
            return self.payoff[i][0] if self.payoff[i] else None
        if src[0] == "d":
            pile = self.discards[i][int(src[1])]
            return pile[-1] if pile else None
        return src if src in self.hands[i] else None

    def take(self, i, src):
        if src == "p":
            return self.payoff[i].pop(0)
        if src[0] == "d":
            return self.discards[i][int(src[1])].pop()
        self.hands[i].remove(src)
        return src

    def build(self, i, src, dst):
        c = self.top(i, src)
        if not c or dst not in self.fits(c):
            raise GameError("That doesn't go there: build up from ace to queen.")
        self.take(i, src)
        if dst == "new":
            self.center.append([(c, 1)])
            k = len(self.center) - 1
        else:
            k = dst
            self.center[k].append((c, self.next_of(self.center[k])))
        if src == "p":
            self.turn_pay += 1
            if self.turn_pay == 5 and self.pl(i):
                self.award(self.pl(i), "chain")
            if not self.payoff[i]:
                return self.room.finish(self.pl(i), f"🏆 {self.nm(i)} empties their pay-off pile and wins Spite & Malice!")
            self.room.add_log(f"⭐ {self.nm(i)} plays {pretty(c)} from their pay-off pile ({len(self.payoff[i])} left).")
        cleared = len(self.center[k]) == 12
        if cleared:
            self.done += [x for x, _ in self.center[k]]
            self.center.pop(k)
            self.room.add_log("✅ A pile reaches the queen and is cleared.")
        if not self.hands[i]:
            self.refill(i)
        if self.s.get("crown", True) and cleared and self.stock:
            self.hands[i].append(self.stock.pop())
            self.hands[i].sort(key=lambda c: (v(c) or 13, suit(c)))
            self.moment(f"👑 {self.nm(i)} finishes a pile: bonus card", "gold", "good")

    def discard(self, i, c, k):
        if c is not None:
            self.hands[i].remove(c)
            self.discards[i][k].append(c)
        self.room.add_log(f"{self.nm(i)} ends their turn.")
        self.begin(self.next_seat(i))

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        src = a.get("from")
        if t == "build":
            dst = a.get("to")
            if not (src == "p" or src in ("d0", "d1", "d2", "d3") or src in self.hands[i]):
                raise GameError("Pick a card to play.")
            if dst != "new" and not (isinstance(dst, int) and 0 <= dst < len(self.center)):
                raise GameError("Pick a pile in the middle.")
            return self.build(i, src, dst)
        if t == "end":
            if self.hands[i]:
                raise GameError("End your turn by discarding a hand card.")
            return self.discard(i, None, 0)
        if t == "discard":
            k = a.get("pile")
            if src not in self.hands[i] or not isinstance(k, int) or not 0 <= k < 4:
                raise GameError("Discard a hand card onto one of your piles.")
            return self.discard(i, src, k)
        raise GameError("Unknown action.")

    def sources(self, i):
        return ["p"] + [f"d{k}" for k in range(4) if self.discards[i][k]] + list(dict.fromkeys(self.hands[i]))

    # -- bots

    def bot_move(self, i, level):
        if self.stage != "play":
            return
        pay = self.top(i, "p")
        # 1. the pay-off card, if it goes (not wasting a wild on it unless the pile is low)
        if pay and self.fits(pay):
            return self.build(i, "p", self.fits(pay)[0])
        # 2. play cards that bring a middle pile up to just under the pay-off card
        if pay and not wild(pay):
            need = v(pay)
            for k, pile in enumerate(self.center):
                nxt = self.next_of(pile)
                if nxt < need:
                    for src in self.sources(i)[1:]:
                        c = self.top(i, src)
                        if c and not wild(c) and v(c) == nxt:
                            return self.build(i, src, k)
                    if level != "easy" and need - nxt == 1:
                        for src in self.sources(i)[1:]:
                            c = self.top(i, src)
                            if c and wild(c):
                                return self.build(i, src, k)
            if "A" != rank(pay) and len(self.center) < 4 and need <= 3:
                for src in self.sources(i)[1:]:
                    c = self.top(i, src)
                    if c and rank(c) == "A":
                        return self.build(i, src, "new")
        # 3. empty the hand of plain cards that go (aces always; others unless they help a rival's pay-off)
        rivals = [self.top(k, "p") for k in range(self.n) if k != i]
        for src in self.sources(i)[1:]:
            c = self.top(i, src)
            if not c or wild(c):
                continue
            for dst in self.fits(c):
                after = 1 if dst == "new" else self.next_of(self.center[dst]) + 1
                if level == "hard" and any(r and not wild(r) and v(r) == after for r in rivals):
                    continue
                if src[0] == "d" or rank(c) == "A" or level == "easy" or len(self.hands[i]) <= 2:
                    return self.build(i, src, dst)
                if level == "normal":
                    return self.build(i, src, dst)
        # 4. discard: stack on an equal or next-higher card, else an empty pile, else the highest pile top
        if not self.hands[i]:
            return self.discard(i, None, 0)
        hand = [c for c in self.hands[i] if not wild(c)] or self.hands[i]
        c = max(hand, key=lambda c: (v(c) or 13))
        best = None
        for k, pile in enumerate(self.discards[i]):
            if pile and v(pile[-1]) and v(c) and v(pile[-1]) in (v(c), v(c) + 1):
                best = k
                break
        if best is None:
            empties = [k for k, pile in enumerate(self.discards[i]) if not pile]
            best = empties[0] if empties else max(range(4), key=lambda k: v(self.discards[i][k][-1]) or 13)
        self.discard(i, c, best)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"⭐ {len(self.payoff[i])}"

    def final_scores(self):
        return {pid: -len(self.payoff[k]) for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"⭐ {len(self.payoff[k])} to go"],
                 "show": ([self.payoff[k][0]] if self.payoff[k] else []) + [d[-1] for d in self.discards[k] if d]} for k in range(self.n)]
        piles = [{"cards": [pile[-1][0]], "label": f"{len(pile)} · next {ORDER[len(pile)] if len(pile) < 12 else '—'}"} for pile in self.center]
        if len(self.center) < 4:
            piles.append({"cards": [], "label": "Ace starts a pile"})
        piles.append({"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Stock", "corner": True})
        t = {"info": info, "piles": piles, "hand": self.hands[i] if i is not None else [],
             "scores": {"title": "Pay-off left", "rows": [{"seat": k, "value": len(self.payoff[k])} for k in sorted(range(self.n), key=lambda k: len(self.payoff[k]))],
                        "hint": "Build A → Q, any suits. Kings are wild."}}
        if i is None:
            return t
        tops = [d[-1] if d else "" for d in self.discards[i]]
        t["rows"] = [{"label": f"Pay-off ({len(self.payoff[i])})", "cards": self.payoff[i][:1], "keys": ["p"]},
                     {"label": "Discards", "cards": tops, "keys": ["d0", "d1", "d2", "d3"]}]
        if self.room.turn == p.id and self.stage == "play":
            moves = []
            for src in self.sources(i):
                c = self.top(i, src)
                if not c:
                    continue
                for dst in self.fits(c):
                    lbl = "→ a new pile" if dst == "new" else f"→ middle pile {dst + 1} (as {ORDER[self.next_of(self.center[dst]) - 1]})"
                    moves.append({"card": src, "label": lbl, "a": {"type": "build", "from": src, "to": dst}})
                if src in self.hands[i]:
                    for k in range(4):
                        moves.append({"card": src, "label": f"🗑️ Discard on pile {k + 1} (ends turn)", "a": {"type": "discard", "from": src, "pile": k}})
            t["moves"] = moves
            payoff = self.payoff[i]
            if payoff:
                t["payoffHint"] = {
                    "top": pretty(payoff[0]),
                    "next": pretty(payoff[1]) if len(payoff) > 1 else None,
                    "destinations": [move["label"].removeprefix("→ ") for move in moves
                                     if move["card"] == "p"],
                }
            if not self.hands[i]:
                t["buttons"] = [{"label": "End turn (no cards to draw)", "a": {"type": "end"}}]
            t["note"] = "Play onto the middle; end your turn by discarding a hand card."
            t["turnText"] = "😈 Your turn"
        return t
