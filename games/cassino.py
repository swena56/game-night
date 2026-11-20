"""Cassino: the classic fishing game with builds, for 2-4 players.

Four cards each, four face up on the table, and fresh hands of four from the deck until it's gone.
Play one card a turn:
  • Capture: take table cards of the same rank, and (with a number card, ace 1) groups that add up to
    it, and builds of its value.
  • Build: put a number card on table cards so they add up to the value of another card you hold; you
    must take it with that card later (anyone may take it first with the right card, or build it up).
  • Trail: lay a card on the table (not while you own a build).
Clearing the table is a sweep. When the deck is out the last to capture takes what's left. Scoring each
deal: most cards 3, most spades 1, the 10♦ (big casino) 2, the 2♠ (little casino) 1, each ace 1, each
sweep 1 (an option: a sweep of 3+ piles counts 2). First to 21 wins."""
import itertools
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show

ORDER = "A23456789TJQK"
NUM = {**{r: int(r) for r in "23456789"}, "A": 1, "T": 10}
SORT = lambda c: (ORDER.index(rank(c)), suit(c))


def num(c):
    return NUM.get(rank(c))


class Cassino(CardGame):
    id = "cassino"
    name = "Cassino"
    icon = "🎰"
    blurb = "Capture and build: pair cards, take sums, make builds for later, and chase big and little casino."
    howto = [
        "Four cards each, four on the table. Each turn play one card to capture, build or trail.",
        "Capture: same rank, or number cards (ace 1) and builds that add up to your card.",
        "Build: add a card to table cards so they total a value you hold; take it later with that card.",
        "Trail: just lay a card down (not while you own a build). Clearing the table is a sweep.",
        "Each deal: most cards 3, most ♠ 1, 10♦ 2, 2♠ 1, each ace 1, each sweep 1 (an option: 3+ piles at once counts 2). First to 21.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "bigcasino": ("💰", "Big casino", "Take the 10♦ with a build")}
    settings_schema = {"target": ("Game to", [(21, "21 points"), (11, "11 points (quick)")], 21),
                       "bigsweep": ("🧹 Big sweep", [(True, "On: 3+ piles = 2"), (False, "Off")], True)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"🎰 Cassino to {self.s['target']}.", "big")
        self.new_deal()

    def new_deal(self):
        self.dealer = (self.dealer + 1) % self.n
        cards = deck()
        self.rng.shuffle(cards)
        self.table_items = [{"cards": [c], "value": num(c), "owner": None, "rank": rank(c)} for c in cards[:4]]
        self.stock = cards[4:]
        self.taken = [[] for _ in range(self.n)]
        self.sweeps = [0] * self.n
        self.last_taker = None
        self.last_move = None
        self.deal_hands()
        self.stage = "play"
        self.to((self.dealer + 1) % self.n)

    def deal_hands(self):
        self.hands = [sorted(self.stock[k * 4:(k + 1) * 4], key=SORT) for k in range(self.n)]
        self.stock = self.stock[4 * self.n:]

    # -- moves

    def owns_build(self, i):
        return any(it["owner"] == i for it in self.table_items)

    def moves_for(self, i):
        out = []
        hand = self.hands[i]
        items = self.table_items
        idx = range(len(items))
        for c in hand:
            v = num(c)
            # captures: same-rank cards, plus (for numbers) groups and builds adding up to v
            pairs = [k for k in idx if items[k]["owner"] is None and len(items[k]["cards"]) == 1 and items[k]["rank"] == rank(c)]
            sums = []
            if v:
                singles = [k for k in idx if items[k]["value"] and k not in pairs and (items[k]["owner"] is not None or len(items[k]["cards"]) == 1)]
                for n in range(1, min(len(singles), 5) + 1):
                    for combo in itertools.combinations(singles, n):
                        if sum(items[k]["value"] for k in combo) == v and all(items[k]["value"] <= v for k in combo):
                            sums.append(combo)
            caps = set()
            if pairs or sums:
                # take every matching card at once, plus any one of the sum groups (or none)
                for g in (sums or [()]):
                    caps.add(tuple(sorted(set(pairs) | set(g))))
                if pairs and sums:
                    caps.add(tuple(sorted(pairs)))
            for cap in caps:
                if cap:
                    out.append({"card": c, "kind": "take", "items": list(cap)})
            # builds: c plus loose number cards (or one build) to a total I can take with another card
            if v:
                loose = [k for k in idx if items[k]["value"] and (len(items[k]["cards"]) == 1 or items[k]["owner"] is not None)]
                targets = {num(x) for x in hand if x != c and num(x)}
                for n in range(1, min(len(loose), 3) + 1):
                    for combo in itertools.combinations(loose, n):
                        total = v + sum(items[k]["value"] for k in combo)
                        if total in targets and total <= 10 and not any(items[k]["value"] >= total for k in combo):
                            if sum(1 for k in combo if items[k]["owner"] is not None) <= 1:
                                out.append({"card": c, "kind": "build", "items": list(combo), "value": total})
            if not self.owns_build(i):
                out.append({"card": c, "kind": "trail", "items": []})
        if not out:      # owns a build but holds nothing else useful: trailing is the only way on
            out = [{"card": c, "kind": "trail", "items": []} for c in hand]
        return out

    def label(self, m):
        items = self.table_items
        what = " + ".join(show(items[k]["cards"]) if len(items[k]["cards"]) == 1 else f"build {items[k]['value']}" for k in m["items"])
        if m["kind"] == "take":
            return f"Take {what}" + (" 🧹" if len(m["items"]) == len(items) else "")
        if m["kind"] == "build":
            return f"Build {m['value']} on {what}"
        return "Trail (lay it down)"

    def apply(self, i, m):
        c = m["card"]
        self.hands[i].remove(c)
        items = self.table_items
        chosen = [items[k] for k in m["items"]]
        if m["kind"] == "take":
            got = [c] + [x for it in chosen for x in it["cards"]]
            self.taken[i] += got
            self.table_items = [it for it in items if it not in chosen]
            self.last_taker = i
            sweep = not self.table_items and (self.stock or any(self.hands))
            if sweep:
                big = len(chosen) >= 3 and self.s.get("bigsweep", True)
                self.sweeps[i] += 2 if big else 1
                if big:
                    self.moment(f"🧹🧹 BIG SWEEP! {self.nm(i)} clears {len(chosen)} piles, worth 2", "gold", "fanfare")
                else:
                    self.moment(f"🧹 SWEEP! {self.nm(i)} clears the table", "gold", "fanfare")
            if "TD" in got and any(it["owner"] is not None for it in chosen) and self.pl(i):
                self.award(self.pl(i), "bigcasino")
            self.room.add_log(f"🃏 {self.nm(i)} plays {pretty(c)} and takes {show(got[1:])}.")
        elif m["kind"] == "build":
            cards = [x for it in chosen for x in it["cards"]] + [c]
            self.table_items = [it for it in items if it not in chosen]
            self.table_items.append({"cards": cards, "value": m["value"], "owner": i, "rank": None})
            self.room.add_log(f"🧱 {self.nm(i)} builds {m['value']} ({show(cards)}).")
        else:
            self.table_items.append({"cards": [c], "value": num(c), "owner": None, "rank": rank(c)})
            self.room.add_log(f"🃏 {self.nm(i)} trails {pretty(c)}.")
        self.last_move = {"seat": i, "card": c, "kind": m["kind"]}
        if any(self.hands):
            return self.to((i + 1) % self.n)
        if self.stock:
            self.deal_hands()
            return self.to((i + 1) % self.n)
        self.end_deal()

    def end_deal(self):
        if self.table_items and self.last_taker is not None:
            rest = [x for it in self.table_items for x in it["cards"]]
            self.taken[self.last_taker] += rest
            self.room.add_log(f"{self.nm(self.last_taker)} takes the last {len(rest)} card{'s' if len(rest) != 1 else ''}.")
            self.table_items = []
        pts = [self.sweeps[k] for k in range(self.n)]
        why = [[f"🧹×{self.sweeps[k]}"] if self.sweeps[k] else [] for k in range(self.n)]

        def most(label, values, p):
            top = max(values)
            best = [k for k, v in enumerate(values) if v == top]
            if len(best) == 1:
                pts[best[0]] += p
                why[best[0]].append(label)
        most("cards", [len(t) for t in self.taken], 3)
        most("♠", [sum(1 for c in t if suit(c) == "S") for t in self.taken], 1)
        for k, t in enumerate(self.taken):
            if "TD" in t:
                pts[k] += 2
                why[k].append("10♦")
            if "2S" in t:
                pts[k] += 1
                why[k].append("2♠")
            aces = sum(1 for c in t if rank(c) == "A")
            if aces:
                pts[k] += aces
                why[k].append(f"A×{aces}")
        for k in range(self.n):
            self.scores[k] += pts[k]
        self.summary = [{"seat": k, "pts": pts[k], "why": why[k]} for k in range(self.n)]
        self.room.add_log("🧮 " + " · ".join(f"{self.nm(k)} +{pts[k]} ({', '.join(why[k]) or '—'})" for k in range(self.n)), "big")
        top = max(self.scores)
        if top >= self.s["target"] and self.scores.count(top) == 1:
            return self.win_by_score(self.scores)
        self.stage = "score"
        self.pause(self.new_deal, 5)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        if self.stage != "play" or a.get("type") != "play":
            raise GameError("Not now.")
        c, kind, items = a.get("card"), a.get("kind"), a.get("items")
        for m in self.moves_for(i):
            if m["card"] == c and m["kind"] == kind and m["items"] == items and m.get("value") == a.get("value"):
                return self.apply(i, m)
        raise GameError("That move isn't allowed.")

    # -- bots

    def worth(self, cards):
        return sum(1 + (0.4 if suit(c) == "S" else 0) + (6 if c == "TD" else 0) + (3 if c == "2S" else 0) + (3 if rank(c) == "A" else 0) for c in cards)

    def bot_move(self, i, level):
        moves = self.moves_for(i)
        if level == "easy" and random.random() < 0.4:
            return self.apply(i, random.choice(moves))
        items = self.table_items

        def score(m):
            chosen = [x for k in m["items"] for x in items[k]["cards"]]
            if m["kind"] == "take":
                v = self.worth([m["card"]] + chosen)
                if len(m["items"]) == len(items):
                    v += 5
                return v + 2
            left = [it for k, it in enumerate(items) if k not in m["items"]]
            if m["kind"] == "build":
                return self.worth(chosen + [m["card"]]) * 0.7 - (0 if level == "hard" else 1)
            # trailing: give away as little as possible
            v = -self.worth([m["card"]]) - (3 if rank(m["card"]) not in "JQK" else 0)
            if level != "easy" and sum(it["value"] or 0 for it in left) + (num(m["card"]) or 0) <= 10 and len(left) <= 2:
                v -= 2
            return v
        self.apply(i, max(moves, key=lambda m: (score(m), random.random())))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"🂠 {len(self.taken[k])}" + (f" · 🧹{self.sweeps[k]}" if self.sweeps[k] else "")]} for k in range(self.n)]
        piles = []
        for it in self.table_items:
            if len(it["cards"]) > 1 or it["owner"] is not None:
                piles.append({"cards": it["cards"], "fan": True, "small": True, "glow": True, "label": f"🧱 {it['value']} ({self.nm(it['owner'])})"})
            else:
                piles.append({"cards": it["cards"], "small": True})
        piles.append({"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Deck", "corner": True})
        lm = self.last_move
        t = {"info": info, "piles": piles, "hand": self.hands[i] if i is not None else [],
             "banner": f"{self.nm(lm['seat'])}: {pretty(lm['card'])} ({lm['kind']})" if lm and self.stage == "play" else None,
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(self.n), key=lambda k: -self.scores[k])],
                        "hint": f"Game to {self.s['target']}. Cards 3 · ♠ 1 · 10♦ 2 · 2♠ 1 · aces 1 · sweeps 1."}}
        if self.stage == "score":
            t["banner"] = "Deal over"
            t["note"] = " · ".join(f"{self.nm(x['seat'])} +{x['pts']} ({', '.join(x['why']) or '—'})" for x in self.summary)
        if i is not None and self.stage == "play" and self.room.turn == p.id:
            t["moves"] = [{"card": m["card"], "label": self.label(m),
                           "a": {"type": "play", "card": m["card"], "kind": m["kind"], "items": m["items"], **({"value": m["value"]} if "value" in m else {})}}
                          for m in self.moves_for(i)]
            t["note"] = "Tap a card: take, build or trail." + (" You own a build: you can't trail." if self.owns_build(i) else "")
        return t
