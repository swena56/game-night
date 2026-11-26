"""Spoons (Pig): the passing-and-grabbing party game, for 3-6 players.

Everyone holds four cards. Each round everyone gets one more (from the player on their right, or the
stock for the dealer) and passes one card left, all at once. Collect four of a kind and quietly grab a
spoon from the middle. The moment one spoon goes, everyone grabs, but there's one spoon fewer than
players: whoever is left without one takes a letter (P-I-G, or S-P-O-O-N). Spell it and you're out;
the last player standing wins. Grab first without four of a kind and you take a letter yourself."""
import random
import time

from .cardbase import CardGame, GameError, deck, rank, suit, show, rname, by_suit

SORT = by_suit("A23456789TJQK")
REACT = {"easy": (1.8, 3.5), "normal": (1.1, 2.2), "hard": (0.7, 1.4)}   # seconds to notice a grab
GRAB_SECS = 6


class Spoons(CardGame):
    id = "spoons"
    solo_bots = 3
    name = "Spoons"
    icon = "🥄"
    blurb = "Pass cards round the table all at once; get four of a kind and grab a spoon. One spoon too few!"
    howto = [
        "Everyone holds four cards and gets a fifth each round. Tap a card to pass it left; everyone passes at once.",
        "Get four of a kind? Tap 🥄 Grab. Quietly: nobody is told.",
        "As soon as a spoon is gone, everyone else can grab too. There's one spoon fewer than players.",
        "Left without a spoon? Take a letter. Spell PIG (or SPOON) and you're out. Last one in wins.",
        "Grab first without four of a kind and you take a letter.",
    ]
    min_players, max_players = 3, 6
    badges = {**CardGame.badges, "quick": ("⚡", "Quick hands", "Grab the first spoon three times in one game")}
    settings_schema = {"word": ("Letters", [("PIG", "P-I-G (quick)"), ("SPOON", "S-P-O-O-N")], "PIG")}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.letters = [0] * self.n
        self.firsts = [0] * self.n
        self.dealer = 0
        self.room.add_log(f"🥄 Spoons: collect four of a kind, then grab! Spell {self.s['word']} and you're out.", "big")
        self.deal()

    def word(self):
        return self.s.get("word", "PIG")

    def is_out(self, i):
        return self.letters[i] >= len(self.word())

    def alive(self):
        return [k for k in range(self.n) if not self.is_out(k)]

    def deal(self):
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [[] for _ in range(self.n)]
        for k in self.alive():
            self.hands[k] = sorted(cards[:4], key=SORT)
            cards = cards[4:]
        self.stock = cards
        self.discard = []
        self.spoons = len(self.alive()) - 1
        self.grabbed = []          # seats in grab order
        self.react = {}
        self.result = None
        while self.is_out(self.dealer):
            self.dealer = (self.dealer + 1) % self.n
        self.passes = 0
        self.incoming = {k: None for k in self.alive()}
        self.feed()

    def feed(self):
        """The dealer draws the next card; then everyone passes."""
        if not self.stock:
            self.stock, self.discard = self.discard, []
            self.rng.shuffle(self.stock)
        self.incoming[self.dealer] = self.stock.pop()
        for k in self.alive():
            if self.incoming.get(k):
                self.hands[k].append(self.incoming[k])
                self.hands[k].sort(key=SORT)
            self.incoming[k] = None
        self.passed = {}
        self.stage = "pass"
        self.open_all(self.alive(), secs=12)

    def quads(self, i):
        count = {}
        for c in self.hands[i]:
            count[rank(c)] = count.get(rank(c), 0) + 1
        return any(v >= 4 for v in count.values())

    def do_pass(self, i, card):
        self.hands[i].remove(card)
        self.passed[i] = card
        self.waiting.discard(i)
        if self.waiting:
            return
        alive = self.alive()
        last = alive[(alive.index(self.dealer) - 1) % len(alive)]
        for k, c in self.passed.items():
            if k == last:
                self.discard.append(c)
            else:
                self.incoming[self.next_seat(k)] = c
        self.passes += 1
        self.feed()

    # -- grabbing

    def grab(self, i):
        now = time.time()
        if self.stage == "pass":
            if not self.quads(i):
                self.room.add_log(f"🙈 {self.nm(i)} grabbed a spoon without four of a kind: a letter!", "power")
                self.moment(f"🙈 False grab by {self.nm(i)}!", "bad", "wrong")
                self.letter(i)
                if self.room.phase != "playing":
                    return
                if self.is_out(i):
                    return self.next_round()
                return
            self.firsts[i] += 1
            if self.firsts[i] == 3 and self.pl(i):
                self.award(self.pl(i), "quick")
            self.stage = "grab"
            self.grab_at = now
            self.grabbed = [i]
            self.spoons -= 1
            if self.spoons <= 0:          # two left: one spoon, and it's gone
                return self.resolve()
            # everyone else notices after their own reaction time; humans race the bots for real
            self.react = {k: random.uniform(*REACT[self.level(k)]) for k in self.alive() if k != i and self.auto(k)}
            r = self.room
            r.turn = None
            self.waiting = {k for k in self.alive() if k != i}
            r.deadline = now + GRAB_SECS
            self.schedule()
            return
        if self.stage != "grab" or i in self.grabbed:
            raise GameError("No spoon to grab.")
        self.grabbed.append(i)
        self.waiting.discard(i)
        self.spoons -= 1
        if self.spoons <= 0:
            self.resolve()
        else:
            self.schedule()

    def schedule(self):
        left = [self.react[k] for k in self.waiting if k in self.react]
        if left:
            self.room.bot_at = self.grab_at + min(left)

    def resolve(self, slow=None):
        loser = slow if slow is not None else next(k for k in self.alive() if k not in self.grabbed)
        first = self.grabbed[0]
        self.result = {"first": first, "loser": loser, "order": self.grabbed[:]}
        self.room.add_log(f"🥄 {self.nm(first)} grabbed first ({show([c for c in self.hands[first]])}). {self.nm(loser)} is left without a spoon!", "big")
        self.moment(f"🥄 {self.nm(loser)} missed out: {self.word()[:self.letters[loser] + 1]}", "bad", "groan")
        self.letter(loser)
        if self.room.phase == "playing":
            self.stage = "result"
            self.pause(self.next_round, 3.5)

    def letter(self, i):
        self.letters[i] += 1
        if self.is_out(i):
            self.room.add_log(f"🐷 {self.nm(i)} spelled {self.word()} and is out.", "big")
        alive = self.alive()
        if len(alive) == 1:
            self.room.finish(self.pl(alive[0]), f"🏆 {self.nm(alive[0])} is the last one in and wins Spoons!")

    def next_round(self):
        self.dealer = self.next_seat(self.dealer)
        self.deal()

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        if t == "pass":
            if self.stage != "pass" or i not in self.waiting:
                raise GameError("Wait for the next card.")
            c = a.get("card")
            if c not in self.hands[i]:
                raise GameError("That card isn't in your hand.")
            return self.do_pass(i, c)
        if t == "grab":
            if self.stage not in ("pass", "grab"):
                raise GameError("Not now.")
            return self.grab(i)
        raise GameError("Unknown action.")

    def on_timeout(self):
        if self.after:
            return super().on_timeout()
        if self.stage == "grab":
            slow = [k for k in self.alive() if k not in self.grabbed]
            self.rng.shuffle(slow)
            while self.spoons > 0 and len(slow) > 1:
                self.grabbed.append(slow.pop())
                self.spoons -= 1
            return self.resolve(slow[0])
        if self.stage == "pass":
            for k in sorted(self.waiting):
                if k in self.waiting and self.stage == "pass":
                    if not self.auto(k):
                        self.room.add_log(f"⏰ {self.nm(k)} was slow; a card was passed for them.", "power")
                    self.bot_move(k, "easy")

    # -- bots

    def bot_ready(self):
        if self.stage == "grab" and not self.after:
            return any(k in self.react for k in self.waiting)
        return super().bot_ready()

    def bot_tick(self):
        if self.stage == "grab":
            k = min((k for k in self.waiting if k in self.react), key=lambda k: self.react[k])
            return self.grab(k)
        if self.stage == "pass":
            # the bots pass together, a beat after the new card arrives
            for k in [k for k in sorted(self.waiting) if self.auto(k)]:
                if self.stage == "pass" and k in self.waiting:
                    self.bot_move(k, self.level(k))
            self.room.bot_at = time.time() + random.uniform(0.7, 1.3)
            return
        return super().bot_tick()

    def bot_move(self, i, level):
        if self.stage != "pass":
            return
        if self.quads(i) and (level != "easy" or random.random() < 0.7):
            return self.grab(i)
        self.do_pass(i, self.bot_card(i, level))

    def bot_card(self, i, level):
        hand = self.hands[i]
        if level == "easy" and random.random() < 0.35:
            return random.choice(hand)
        count = {}
        for c in hand:
            count[rank(c)] = count.get(rank(c), 0) + 1
        # pass the card of the rank I hold least of; a hard bot breaks ties by keeping the rank it held longest
        return min(hand, key=lambda c: (count[rank(c)], hand.index(c) if level == "hard" else random.random()))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else (self.word()[:self.letters[i]] or "—")

    def final_scores(self):
        return {pid: -self.letters[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        w = self.word()
        info = [{"tags": [("🐷 " + w[:self.letters[k]]) if self.letters[k] else "no letters"]
                 + (["✓ passed"] if self.stage == "pass" and k in self.passed else [])
                 + (["🥄"] if k in self.grabbed and self.stage != "pass" else []),
                 "out": self.is_out(k)} for k in range(self.n)]
        spoons = "🥄" * max(0, self.spoons)
        t = {"info": info, "banner": spoons or "No spoons left!",
             "piles": [{"cards": ["??"], "count": len(self.stock), "label": "Stock"}],
             "hand": self.hands[i] if i is not None and not self.is_out(i) else [],
             "scores": {"title": "Letters", "rows": [{"seat": k, "value": w[:self.letters[k]] or "–", "sub": "out" if self.is_out(k) else ""}
                                                     for k in sorted(range(self.n), key=lambda k: self.letters[k])],
                        "hint": f"{len(self.alive()) - 1} spoons for {len(self.alive())} players."}}
        if self.result:
            r = self.result
            t["banner"] = f"{self.nm(r['loser'])} missed out!"
            t["piles"] = [{"cards": [c for c in self.hands[r['first']]], "fan": True, "glow": True, "label": f"{self.nm(r['first'])}'s hand"}]
        if i is None or self.is_out(i):
            return t
        if self.stage == "pass" and i in self.waiting:
            t["moves"] = [{"card": c, "a": {"type": "pass", "card": c}} for c in self.hands[i]]
            t["buttons"] = [{"label": "🥄 Grab!", "a": {"type": "grab"}, "kind": ""}]
            t["note"] = "Tap a card to pass it left, or 🥄 Grab with four of a kind."
            t["turnText"] = "👉 Pass a card left"
        elif self.stage == "pass":
            t["buttons"] = [{"label": "🥄 Grab!", "a": {"type": "grab"}}]
            t["note"] = "Waiting for everyone to pass…"
        elif self.stage == "grab" and i in self.waiting:
            t["buttons"] = [{"label": "🥄 GRAB!", "a": {"type": "grab"}, "kind": "slap"}]
            t["note"] = "A spoon is gone! Grab one!"
            t["turnText"] = "🥄 GRAB A SPOON!"
        elif self.stage == "grab":
            t["note"] = "Got one! 🥄"
        return t
