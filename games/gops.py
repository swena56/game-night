"""GOPS (Game of Pure Strategy): a sealed-bid card duel, for 2-3 players.

The diamonds are the prizes, shuffled face down; each player holds one whole other suit. Each round a
prize is turned up and everyone bids one card from their hand at once. The highest bid takes the prize
(ace 1 up to king 13 points). A tie at the top carries the prize over to the next round, so the next
winner takes both. Bids are spent either way. After thirteen prizes, most points wins."""
import random

from .cardbase import CardGame, GameError, rank, suit, pretty, show

ORDER = "A23456789TJQK"
VAL = {r: k + 1 for k, r in enumerate(ORDER)}


class Gops(CardGame):
    id = "gops"
    name = "GOPS"
    icon = "🏷️"
    blurb = "Bid for each prize card with a card of your own, all at once. No luck, just nerve."
    howto = [
        "The diamonds are prizes (ace 1 … king 13). Everyone holds a whole suit of their own.",
        "Each round a prize is turned up and everyone bids one card at once, face down.",
        "Highest bid takes the prize. A tie at the top carries it over: the next winner takes both.",
        "✌️ Double down (once a game): win the prize for 2x, but lose the round and you drop 3 points.",
        "The bid history shows each resolved prize, the bids spent on it, and what was won or carried over.",
        "Every card bid is spent. After thirteen prizes, most points wins.",
    ]
    min_players, max_players = 2, 3
    badges = {**CardGame.badges, "steal": ("🦊", "Bargain", "Take the king prize with a bid of 5 or less")}
    settings_schema = {"double": ("✌️ Double down", [(1, "Once a game"), (0, "Off")], 1),
                       "order": ("Prizes", [("shuffled", "Shuffled"), ("open", "🔓 Open: the whole prize order is shown")], "shuffled")}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.hands = [[r + "CSH"[k] for r in ORDER] for k in range(self.n)]
        prizes = [r + "D" for r in ORDER]
        rng.shuffle(prizes)
        self.prizes = prizes
        self.pot = []
        self.scores = [0] * self.n
        self.bids = {}
        self.history = []
        self.result = None
        self.doubles = [1 if self.s.get("double", 1) else 0] * self.n  # double-downs left
        self.armed = set()  # seats that have armed a double for this round's bid
        self.dbl = set()  # seats whose bid this round was a double
        self.room.add_log("🎯 GOPS: bid for each prize. Ties carry the prize over.", "big")
        self.next_prize()

    def next_prize(self):
        self.result = None
        if not self.prizes:
            return self.win_by_score(self.scores)
        self.pot.append(self.prizes.pop(0))
        self.bids = {}
        self.armed = set()
        self.dbl = set()
        self.stage = "bid"
        self.open_all(range(self.n))

    def worth(self):
        return sum(VAL[rank(c)] for c in self.pot)

    def bid(self, i, c):
        self.hands[i].remove(c)
        self.bids[i] = c
        if i in self.armed and self.can_double(i):
            self.doubles[i] -= 1
            self.dbl.add(i)
        self.armed.discard(i)
        self.waiting.discard(i)
        if self.waiting:
            return
        top = max(VAL[rank(c)] for c in self.bids.values())
        best = [k for k, c in self.bids.items() if VAL[rank(c)] == top]
        bids = " · ".join(f"{self.nm(k)} {pretty(c)}" for k, c in sorted(self.bids.items()))
        reveal = {"prize": self.pot[:], "bids": dict(self.bids),
                  "winner": best[0] if len(best) == 1 else None, "worth": self.worth(),
                  "points": 0, "carry": len(best) > 1 and bool(self.prizes)}
        self.history.append(reveal)
        if len(best) == 1:
            w = best[0]
            got = self.worth()
            if w in self.dbl:
                got *= 2
                self.moment(f"✌️ {self.nm(w)} doubled down and it paid: +{got}!", "gold", "fanfare")
            reveal["points"] = got
            self.scores[w] += got
            self.room.add_log(f"🎯 {bids} → {self.nm(w)} takes {show(self.pot)} (+{got}).")
            if "K" in [rank(c) for c in self.pot] and top <= 5 and self.pl(w):
                self.award(self.pl(w), "steal")
            for k in self.dbl:
                if k != w:
                    self.scores[k] = max(0, self.scores[k] - 3)
                    self.moment(f"✌️ {self.nm(k)} doubled down and lost: -3", "bad")
            self.result = {"winner": w, "pot": self.pot[:], "bids": [[k, c] for k, c in sorted(self.bids.items())]}
            self.pot = []
        else:
            self.room.add_log(f"🤝 {bids}: a tie! The prize carries over.")
            self.result = {"winner": None, "pot": self.pot[:], "bids": [[k, c] for k, c in sorted(self.bids.items())]}
            if not self.prizes:
                self.room.add_log("The last prize is tied: nobody takes it.")
        self.stage = "show"
        self.pause(self.next_prize, 2.2)

    def can_double(self, i):
        return bool(getattr(self, "doubles", None)) and self.doubles[i] > 0

    def act(self, p, a):
        i = self.act_seat(p)
        if a.get("type") == "double":
            if self.stage != "bid" or i not in self.waiting or not self.can_double(i):
                raise GameError("You can't double down now.")
            self.armed ^= {i}
            return
        if a.get("type") != "bid":
            raise GameError("Unknown action.")
        if self.stage != "bid" or i not in self.waiting:
            raise GameError("Wait for the next prize.")
        c = a.get("card")
        if c not in self.hands[i]:
            raise GameError("That card isn't in your hand.")
        self.bid(i, c)

    # -- bots

    def bot_move(self, i, level):
        if self.stage == "bid":
            c = self.choose(i, level)
            if level != "easy" and self.can_double(i) and self.worth() >= 9 and VAL[rank(c)] >= 10 and random.random() < 0.6:
                self.armed.add(i)
            self.bid(i, c)

    def choose(self, i, level):
        hand = sorted(self.hands[i], key=lambda c: VAL[rank(c)])
        if level == "easy":
            return random.choice(hand)
        prize = self.worth()
        left = len(self.hands[i])
        if level == "normal":
            # bid about the prize's rank among the prizes still to come
            future = sorted([VAL[rank(c)] for c in self.prizes] + [prize])
            k = future.index(prize)
            return hand[min(left - 1, max(0, round(k + random.uniform(-1, 1))))]
        # hard: try each card against the rivals' likely bids (sampled from their hands, weighted toward
        # the prize's place), scoring the prize won minus what the card would be worth later
        rivals = [k for k in range(self.n) if k != i]
        future = sorted([VAL[rank(c)] for c in self.prizes] + [prize])
        place = future.index(prize) / max(1, len(future) - 1)
        def guess(k):
            # what a player can know: the cards this rival hasn't shown yet (a bid already in is still hidden)
            h = sorted(VAL[rank(c)] for c in self.hands[k] + ([self.bids[k]] if k in self.bids else []))
            if len(h) == 1:
                return h[0]
            j = min(len(h) - 1, max(0, round(place * (len(h) - 1) + random.gauss(0, 1.6))))
            return h[j]
        best, best_v = hand[0], -1e9
        for c in hand:
            v = VAL[rank(c)]
            gain = 0.0
            for _ in range(60):
                tops = [guess(k) for k in rivals]
                m = max(tops)
                if v > m:
                    gain += prize
                elif v == m:
                    gain += prize * 0.15
            gain /= 60
            cost = v * (sum(future) / max(1, sum(VAL[rank(x)] for x in hand))) * 0.55
            if gain - cost > best_v:
                best, best_v = c, gain - cost
        return best

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"tags": [f"{self.scores[k]} pts"] + (["✓ bid"] if self.stage == "bid" and k in self.bids else [])
                 + (["✌️ doubled"] if self.stage == "show" and k in self.dbl else [])} for k in range(self.n)]
        pot = self.result["pot"] if self.result else self.pot
        t = {"info": info, "piles": [{"cards": pot, "fan": True, "glow": True,
                                       "label": f"Prize: {sum(VAL[rank(c)] for c in pot)} pt{'s' if sum(VAL[rank(c)] for c in pot) != 1 else ''}"
                                       + (" (carried over)" if len(pot) > 1 else "")},
                                      {"cards": ["??"] if self.prizes else [], "count": len(self.prizes), "label": "Prizes left"}],
             "bidHistory": self.history,
             "hand": self.hands[i] if i is not None else [],
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(self.n), key=lambda k: -self.scores[k])],
                        "hint": f"{len(self.prizes)} prizes to come" + (": " + " ".join(rank(c) for c in self.prizes) if self.s.get("order") == "open" else ".")}}
        if self.result:
            t["trick"] = self.result["bids"]
            w = self.result["winner"]
            t["banner"] = f"{self.nm(w)} takes it!" if w is not None else "Tie: carried over!"
        if i is not None and self.stage == "bid" and i in self.waiting:
            t["moves"] = [{"card": c, "a": {"type": "bid", "card": c}} for c in self.hands[i]]
            t["note"] = f"Bid a card for {self.worth()} point{'s' if self.worth() != 1 else ''}." + (" ✌️ Doubled: win for 2x, lose -3." if i in self.armed else "")
            if self.can_double(i):
                t["buttons"] = [{"label": "✌️ Double down: ON" if i in self.armed else "✌️ Double down", "a": {"type": "double"}}]
            t["turnText"] = f"🎯 Bid for {self.worth()}"
        elif self.stage == "bid" and i is not None:
            t["note"] = "Bid in. Waiting for the others…"
        return t
