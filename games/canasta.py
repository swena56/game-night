"""Canasta: meld sets of a rank, build canastas of seven, and go out. 2-4 players (four play in pairs).

Two decks and four jokers. Jokers and twos are wild; red threes are bonus cards, laid aside at once
and replaced; black threes block the pile and can't be melded. Deal 15 each (two players), 13 (three)
or 11 (four). On your turn draw from the stock (two cards with two players, one otherwise), or take the
whole discard pile, which needs two natural cards matching its top card to meld with it. Then meld:
three or more of a rank, with at least two natural cards and at most three wilds, or add to your
side's melds. Your side's first meld must be worth at least 50 points (15 when below zero, 90 from
1500, 120 from 3000). Seven cards make a canasta (500 natural, 300 with wilds). End your turn with a
discard. You can go out once your side has a canasta. Cards count joker 50, 2 and A 20, K–8 10, 7–4 and
black 3 5; melded cards score, cards left in hand count against you."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show, rname

ORDER = "3456789TJQKA2"


def wildc(c):
    return c.startswith("JK") or rank(c) == "2"


def red3(c):
    return rank(c) == "3" and suit(c) in "HD"


def black3(c):
    return rank(c) == "3" and suit(c) in "SC"


def val(c):
    if c.startswith("JK"):
        return 50
    r = rank(c)
    if r in "2A":
        return 20
    if r in "KQJT98":
        return 10
    return 5


def srt(c):
    return (2 if c.startswith("JK") else 1 if rank(c) == "2" else 0, ORDER.index(rank(c)) if not c.startswith("JK") else 99, suit(c))


class Canasta(CardGame):
    id = "canasta"
    name = "Canasta"
    icon = "🧺"
    blurb = "Meld sets, build canastas of seven with wild twos and jokers, and grab the pile when it's fat."
    howto = [
        "Draw (two cards with two players), or take the whole pile using two natural cards matching its top card.",
        "Meld three or more of a rank: at least two naturals, at most three wilds (jokers and 2s). Add to your side's melds.",
        "Your side's first meld must be worth 50+ points (more as your score grows). Red 3s score 100 as bonus cards.",
        "Seven cards make a canasta: 500 natural, 300 mixed. End each turn with a discard.",
        "Go out once you have a canasta (+100). Melded cards score; cards left in hand count against you.",
        "An option: the first side to complete a natural canasta in a hand earns a +100 race bonus.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "natural": ("🌿", "Natural", "Build a canasta without wild cards")}
    settings_schema = {"target": ("Play to", [(5000, "5000 (classic)"), (2500, "2500"), (1500, "1500 (quick)")], 2500),
                       "race": ("🏁 Race", [(False, "Off"), (True, "On: first natural canasta +100")], False)}
    race_side = None      # the side that completed the hand's first natural canasta (the option on)

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.teams = self.n == 4
        self.sides = 2 if self.teams else self.n
        self.score = [0] * self.sides
        self.hand_no = 0
        self.dealer = rng.randrange(self.n)
        self.room.add_log(f"🧺 Canasta to {self.s['target']}" + (" in pairs." if self.teams else "."), "big")
        self.deal()

    def side(self, k):
        return k % 2 if self.teams else k

    def side_name(self, s):
        return f"{self.nm(s)} & {self.nm(s + 2)}" if self.teams else self.nm(s)

    def deal(self):
        self.hand_no += 1
        self.dealer = (self.dealer + 1) % self.n
        cards = deck(copies=2) + ["JKR", "JKB", "JKR", "JKB"]
        self.rng.shuffle(cards)
        per = {2: 15, 3: 13, 4: 11}[self.n]
        self.stock = cards
        self.hands = [[] for _ in range(self.n)]
        self.melds = [{} for _ in range(self.sides)]
        self.red3s = [[] for _ in range(self.sides)]
        self.result = None
        self.drawn = False
        self.out_by = None
        self.race_side = None
        self.seen = [set() for _ in range(self.n)]        # ranks each player has discarded (a bot memory)
        for k in range(self.n):
            for _ in range(per):
                self.draw_one(k, quiet=True)
            self.hands[k].sort(key=srt)
        self.pile = [self.stock.pop()]
        while wildc(self.pile[-1]) or red3(self.pile[-1]):
            self.pile.append(self.stock.pop())
        self.room.add_log(f"🃏 Hand {self.hand_no}: {pretty(self.pile[-1])} starts the pile.")
        self.stage = "draw"
        self.to((self.dealer + 1) % self.n)

    def draw_one(self, k, quiet=False):
        while self.stock:
            c = self.stock.pop()
            if red3(c):
                self.red3s[self.side(k)].append(c)
                if not quiet:
                    self.room.add_log(f"🔴 {self.nm(k)} lays down a red three: +100.", "power")
                continue
            self.hands[k].append(c)
            return c
        return None

    # -- meld rules

    def need(self, s):
        sc = self.score[s]
        return 15 if sc < 0 else 50 if sc < 1500 else 90 if sc < 3000 else 120

    def opened(self, s):
        return bool(self.melds[s])

    def canastas(self, s):
        return sum(1 for m in self.melds[s].values() if len(m) >= 7)

    def plan(self, i, cards, top=None, extra=0):
        """Work out where the cards go (plus the pile's top card when taking the pile). Returns
        ({rank: added cards}, points) or raises GameError."""
        s = self.side(i)
        nat, wild = {}, []
        for c in cards:
            if black3(c) or red3(c):
                raise GameError("Threes can't be melded.")
            if wildc(c):
                wild.append(c)
            else:
                nat.setdefault(rank(c), []).append(c)
        if top is not None:
            nat.setdefault(rank(top), []).append(top)
        add = {r: list(cs) for r, cs in nat.items()}
        size = lambda r: len(self.melds[s].get(r, [])) + len(add.get(r, []))
        wilds_in = lambda r: sum(1 for c in self.melds[s].get(r, []) + add.get(r, []) if wildc(c))
        nats_in = lambda r: sum(1 for c in self.melds[s].get(r, []) + add.get(r, []) if not wildc(c))
        for r, cs in nat.items():
            if r not in self.melds[s] and len(cs) < 2:
                raise GameError(f"A new meld of {rname(r)} needs at least two natural {rname(r)}.")
        # wilds first fill new melds up to three, then go where there's room (largest meld first)
        for r in sorted(add, key=lambda r: size(r)):
            while wild and size(r) < 3:
                add[r].append(wild.pop())
        while wild:
            room = [r for r in set(add) | set(self.melds[s]) if wilds_in(r) < 3 and wilds_in(r) < nats_in(r) and (r in add or size(r) < 7)]
            if not room:
                raise GameError("Too many wild cards: a meld takes at most three, and fewer than its naturals.")
            r = max(room, key=lambda r: (r in add, size(r) if size(r) < 7 else -1))
            add.setdefault(r, []).append(wild.pop())
        for r in add:
            if size(r) < 3:
                raise GameError("A meld needs at least three cards.")
        pts = sum(val(c) for cs in add.values() for c in cs)
        if not self.opened(s) and pts < self.need(s):
            raise GameError(f"Your side's first meld must be worth {self.need(s)} points (this is {pts}).")
        left = len(self.hands[i]) + extra - len(cards)
        if left == 0 and not self.can_out(s, add):
            raise GameError("You can't go out without a canasta.")
        if left == 1 and not self.can_out(s, add):
            raise GameError("Keep two cards: you can't go out without a canasta.")
        return add, pts

    def can_out(self, s, add=None):
        add = add or {}
        return any(len(self.melds[s].get(r, [])) + len(add.get(r, [])) >= 7 for r in set(self.melds[s]) | set(add))

    def apply(self, i, add):
        s = self.side(i)
        before = {r: len(m) for r, m in self.melds[s].items()}
        for r, cs in add.items():
            for c in cs:
                if c in self.hands[i]:
                    self.hands[i].remove(c)
            self.melds[s].setdefault(r, []).extend(cs)
            m = self.melds[s][r]
            if len(m) >= 7 > before.get(r, 0):
                pure = not any(wildc(c) for c in m)
                self.moment(f"🧺 {self.nm(i)} completes a {'natural' if pure else 'mixed'} canasta of {rname(r)}!", "gold", "fanfare")
                if pure and self.s.get("race", False) and self.race_side is None:
                    self.race_side = s
                    self.moment(f"🏁 {self.side_name(s)} win the natural canasta race: +100!", "cool", "whoosh")
                if pure and self.pl(i):
                    self.award(self.pl(i), "natural")
        self.room.add_log(f"🃏 {self.nm(i)} melds " + ", ".join(f"{show(cs)}" for cs in add.values()) + ".")
        if not self.hands[i]:
            return self.go_out(i)

    # -- turn

    def draw(self, i):
        n = 2 if self.n == 2 else 1
        got = 0
        for _ in range(n):
            if self.draw_one(i):
                got += 1
        if not got:
            self.room.add_log("📭 The stock is empty: the hand ends.", "big")
            return self.end_hand()
        self.hands[i].sort(key=srt)
        self.drawn = True
        self.stage = "meld"
        self.room.add_log(f"{self.nm(i)} draws.")
        self.to(i)

    def can_take(self, i):
        if not self.pile:
            return False
        top = self.pile[-1]
        if wildc(top) or black3(top):
            return False
        return sum(1 for c in self.hands[i] if rank(c) == rank(top) and not wildc(c)) >= 2

    def take(self, i, cards):
        top = self.pile[-1]
        if not self.can_take(i):
            raise GameError(f"You need two natural {rname(rank(top))} to take the pile.")
        if sum(1 for c in cards if rank(c) == rank(top) and not wildc(c)) < 2:
            raise GameError(f"Pick two natural {rname(rank(top))} to meld with the top card.")
        add, _ = self.plan(i, cards, top, extra=len(self.pile) - 1)
        pile = self.pile[:-1]
        self.pile = []
        n = len(pile) + 1
        self.hands[i] += pile
        self.hands[i].sort(key=srt)
        self.room.add_log(f"🧺 {self.nm(i)} takes the pile ({n} card{"s" if n != 1 else ""})!", "power")
        if n >= 8:
            self.moment(f"🧺 {self.nm(i)} scoops up {n} cards!", "cool", "whoosh")
        self.stage = "meld"
        self.drawn = True
        self.apply(i, add)
        if self.room.phase == "playing" and self.stage == "meld":
            self.to(i)

    def meld(self, i, cards):
        add, _ = self.plan(i, cards)
        self.apply(i, add)
        if self.room.phase == "playing" and self.stage == "meld":
            self.to(i)

    def discard(self, i, c):
        if len(self.hands[i]) == 1 and not self.can_out(self.side(i)):
            raise GameError("You can't go out without a canasta: meld instead, or keep a card.")
        self.hands[i].remove(c)
        self.pile.append(c)
        self.seen[i].add(rank(c))
        self.room.add_log(f"{self.nm(i)} discards {pretty(c)}.")
        if not self.hands[i]:
            return self.go_out(i)
        self.stage = "draw"
        self.drawn = False
        self.to(self.next_seat(i))

    def go_out(self, i):
        self.out_by = i
        self.moment(f"🚪 {self.nm(i)} goes out!", "gold", "fanfare")
        self.end_hand()

    def end_hand(self):
        rows = []
        for s in range(self.sides):
            melded = sum(val(c) for m in self.melds[s].values() for c in m)
            bonus = sum(500 if not any(wildc(c) for c in m) else 300 for m in self.melds[s].values() if len(m) >= 7)
            r3 = 100 * len(self.red3s[s]) * (2 if len(self.red3s[s]) == 4 else 1)
            if not self.opened(s):
                r3 = -r3
            out = 100 if self.out_by is not None and self.side(self.out_by) == s else 0
            hand = sum(val(c) if not black3(c) else 5 for k in range(self.n) if self.side(k) == s for c in self.hands[k])
            race = 100 if self.race_side == s else 0
            total = melded + bonus + r3 + out + race - hand
            self.score[s] += total
            rows.append((s, total))
        self.result = "  ·  ".join(f"{self.side_name(s)} {'+' if v >= 0 else ''}{v}{' (🏁 +100)' if s == self.race_side else ''}" for s, v in rows)
        self.room.add_log(f"🧮 {self.result}", "big")
        tgt = self.s["target"]
        if max(self.score) >= tgt:
            top = max(self.score)
            win = [s for s in range(self.sides) if self.score[s] == top]
            if len(win) > 1:
                return self.room.finish(None, f"🤝 A tie at {top}!")
            w = win[0]
            return self.room.finish(self.pl(w), f"🏆 {self.side_name(w)} win{'' if self.teams else 's'} Canasta with {self.score[w]} points!")
        self.stage = "score"
        self.pause(self.deal, 5)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        cards = a.get("cards")
        if t == "draw" and self.stage == "draw":
            return self.draw(i)
        if t in ("take", "meld", "discard"):
            if not isinstance(cards, list) or not cards or len(cards) > len(self.hands[i]):
                raise GameError("Pick some cards first.")
            pool = list(self.hands[i])
            for c in cards:
                if c not in pool:
                    raise GameError("Those cards aren't all in your hand.")
                pool.remove(c)
            if t == "take" and self.stage == "draw":
                return self.take(i, cards)
            if t == "meld" and self.stage == "meld":
                return self.meld(i, cards)
            if t == "discard" and self.stage == "meld":
                if len(cards) != 1:
                    raise GameError("Discard one card.")
                return self.discard(i, cards[0])
        raise GameError("Not now.")

    # -- bots

    def bot_plan(self, i, level, top=None):
        """The cards to meld this turn (with the pile's top card if taking): sets of three, pairs and
        wilds, additions to our melds. Returns a list of cards that plan() accepts, or None."""
        s = self.side(i)
        hand = self.hands[i]
        by = {}
        for c in hand:
            if not wildc(c) and not black3(c):
                by.setdefault(rank(c), []).append(c)
        wilds = [c for c in hand if wildc(c)]
        pick = []
        if top is not None:
            pick += by.get(rank(top), [])[:2] if level == "easy" else by.get(rank(top), [])
            by.pop(rank(top), None)
        for r, cs in by.items():
            if r in self.melds[s] or len(cs) >= 3:
                pick += cs
        # pairs with a wild, and wilds onto melds near a canasta
        spare = list(wilds)
        if level != "easy":
            for r, cs in by.items():
                if len(cs) == 2 and r not in self.melds[s] and spare and (level == "normal" or not self.opened(s) or len(spare) >= 2):
                    pick += cs + [spare.pop()]
            for r, m in self.melds[s].items():
                if spare and 4 <= len(m) + sum(1 for c in pick if rank(c) == r) < 7 and sum(1 for c in m if wildc(c)) < 2:
                    pick.append(spare.pop())
        # keep a card to discard unless we can go out
        tries = [pick]
        if len(pick) >= len(hand):
            tries = [pick[:-1], pick[:-2]]
        for cand in tries:
            if not cand and top is None:
                continue
            for _ in range(6):
                try:
                    self.plan(i, cand, top, extra=len(self.pile) - 1 if top is not None else 0)
                    return cand
                except GameError:
                    # drop the last wild or the smallest group and try again
                    w = [c for c in cand if wildc(c)]
                    if w:
                        cand = [c for c in cand if c != w[-1]] if cand.count(w[-1]) == 1 else cand[:-1]
                        cand = list(cand)
                    elif cand:
                        cand = cand[:-1]
                    if not cand and top is None:
                        break
        return None

    def bot_discard(self, i, level):
        s = self.side(i)
        hand = self.hands[i]
        b3 = [c for c in hand if black3(c)]
        if b3:
            return b3[0]
        count = {}
        for c in hand:
            count[rank(c)] = count.get(rank(c), 0) + 1
        opp = set()
        for k in range(self.n):
            if self.side(k) != s:
                opp |= set(self.melds[self.side(k)])
        def cost(c):
            if wildc(c):
                return 1000
            x = val(c) + 15 * (count[rank(c)] - 1) + (30 if rank(c) in self.melds[s] else 0)
            if level == "hard":
                safe = any(rank(c) in self.seen[k] for k in range(self.n) if self.side(k) != s)
                x += (-20 if safe else 0) + (25 if len(self.pile) >= 5 else 0)
            return x + (random.random() * 20 if level == "easy" else 0)
        return min(hand, key=cost)

    def bot_move(self, i, level):
        s = self.side(i)
        if self.stage == "draw":
            if self.can_take(i) and (len(self.pile) >= 2 or level != "easy"):
                cand = self.bot_plan(i, level, self.pile[-1])
                if cand is not None:
                    try:
                        return self.take(i, cand)
                    except GameError:
                        pass
            return self.draw(i)
        if self.stage != "meld":
            return
        # go out when everything left can be melded
        cand = self.bot_plan(i, level)
        if cand:
            try:
                return self.meld(i, cand)
            except GameError:
                pass
        self.discard(i, self.bot_discard(i, level))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[self.side(i)]} pts"

    def final_scores(self):
        return {pid: self.score[self.side(k)] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": ([f"🔴×{len(self.red3s[self.side(k)])}"] if self.red3s[self.side(k)] and (not self.teams or k < 2) else []) +
                 [f"🧺 {self.canastas(self.side(k))}" if self.canastas(self.side(k)) else ""]} for k in range(self.n)]
        piles = [{"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Stock"},
                 {"cards": [self.pile[-1]] if self.pile else [], "count": len(self.pile), "label": "Pile (frozen)" if self.pile else "Pile", "glow": i is not None and self.stage == "draw" and self.room.turn == p.id and self.can_take(i)}]
        my = self.side(i) if i is not None else None
        order = ([my] if my is not None else []) + [s for s in range(self.sides) if s != my]
        for s in order:
            who = "Us" if s == my and self.teams else "You" if s == my else self.side_name(s)
            for r, m in sorted(self.melds[s].items(), key=lambda x: -len(x[1])):
                can = len(m) >= 7
                piles.append({"cards": sorted(m, key=srt), "fan": True, "small": True,
                              "label": f"{who}: {rname(r)} ×{len(m)}" + (" 🧺" if can else "")})
        t = {"info": info, "piles": piles, "hand": self.hands[i] if i is not None else [],
             "banner": self.result if self.stage == "score" else None,
             "scores": {"title": "Points", "rows": [{"seat": s, "value": self.score[s], "sub": f"& {self.nm(s + 2)}" if self.teams else ""} for s in sorted(range(self.sides), key=lambda s: -self.score[s])],
                        "hint": f"To {self.s['target']}{' · 🏁 first natural canasta +100' if self.s.get('race', False) else ''} · first meld {self.need(my) if my is not None else 50}+ · joker 50, 2/A 20, K–8 10, 7–4 5"}}
        if i is None or self.room.turn != p.id:
            return t
        need = "" if self.opened(my) else f" Your side's first meld needs {self.need(my)}+ points."
        if self.stage == "draw":
            t["buttons"] = [{"label": "🂠 Draw" + (" two" if self.n == 2 else ""), "a": {"type": "draw"}, "kind": "primary"}]
            if self.can_take(i):
                top = self.pile[-1]
                t["pick"] = {"act": "take", "min": 2, "max": len(self.hands[i]), "label": f"🧺 Take the pile ({len(self.pile)})"}
                t["note"] = f"Draw, or pick two {rname(rank(top))} (plus anything else to meld) and take the pile." + need
            else:
                t["note"] = "Draw from the stock." + need
            t["turnText"] = "🂠 Draw or take the pile"
        elif self.stage == "meld":
            t["pick"] = {"act": "meld", "min": 1, "max": len(self.hands[i]), "label": "Meld",
                         "alts": [{"act": "discard", "label": "Discard (end turn)", "min": 1, "max": 1}]}
            t["note"] = "Pick cards to meld (or add to your melds), then pick one card to discard." + need
            t["turnText"] = "🧺 Meld, then discard"
        return t
