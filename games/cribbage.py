"""Cribbage: the traditional public-domain card game for 2 or 3 players.

Each deal: everyone discards to the dealer's crib (2 players: 6 dealt, 2 discarded; 3 players: 5
dealt, 1 discarded, plus one card from the deck). A starter card is cut (a jack scores 2 for the
dealer). The play: take turns laying cards, keeping the running count at 31 or less; 15 and 31 score
2, pairs/threes/fours 2/6/12, runs their length, and the last card before the count resets scores 1
(a "go"). The show: hands are counted with the starter (non-dealer first, then the dealer, then the
crib) for fifteens, pairs, runs, flushes and nobs. First to 121 (or 61) wins on the spot."""
import random
import time
from itertools import combinations

from .base import Game, GameError

RANKS = "A23456789TJQK"
SUITS = "SHDC"
SHOW_PAUSE, CUT_PAUSE = 7.0, 0.0
COUNT_SECS = 45  # 🦉 muggins: time to count your own hand


def rank(card):
    return RANKS.index(card[0]) + 1          # A=1 … K=13


def value(card):
    return min(rank(card), 10)                # counting value


def pretty(card):
    return ("10" if card[0] == "T" else card[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[card[1]]


def score_show(hand, starter, crib=False):
    """[(description, points)] for a four-card hand plus the starter."""
    cards = hand + [starter]
    items = []
    fifteens = sum(1 for n in range(2, 6) for combo in combinations(cards, n) if sum(value(c) for c in combo) == 15)
    if fifteens:
        items.append((f"Fifteen{'s' * (fifteens > 1)} ×{fifteens}", 2 * fifteens))
    ranks = [rank(c) for c in cards]
    pairs = sum(1 for a, b in combinations(ranks, 2) if a == b)
    if pairs:
        items.append(({1: "Pair", 2: "Two pairs", 3: "Three of a kind", 4: "Pair royal + pair",
                       6: "Four of a kind"}.get(pairs, f"{pairs} pairs"), 2 * pairs))
    for n in (5, 4, 3):
        runs = sum(1 for combo in combinations(ranks, n) if sorted(combo) == list(range(min(combo), min(combo) + n)))
        if runs:
            items.append((f"Run of {n}" + (f" ×{runs}" if runs > 1 else ""), n * runs))
            break
    if len({c[1] for c in hand}) == 1:
        if starter[1] == hand[0][1]:
            items.append(("Flush of 5", 5))
        elif not crib:
            items.append(("Flush", 4))
    if any(c[0] == "J" and c[1] == starter[1] for c in hand):
        items.append(("Nobs (jack of the starter's suit)", 1))
    return items


def score_peg(seq, count):
    """[(description, points)] for the card just played onto `seq` (the cards since the last reset)."""
    items = []
    if count == 15:
        items.append(("Fifteen", 2))
    if count == 31:
        items.append(("Thirty-one", 2))
    same = 1
    while same < len(seq) and rank(seq[-1 - same]) == rank(seq[-1]):
        same += 1
    if same >= 2:
        items.append(({2: "Pair", 3: "Pair royal", 4: "Double pair royal"}[same], {2: 2, 3: 6, 4: 12}[same]))
    for n in range(len(seq), 2, -1):
        last = sorted(rank(c) for c in seq[-n:])
        if last == list(range(last[0], last[0] + n)):
            items.append((f"Run of {n}", n))
            break
    return items


class Cribbage(Game):
    id = "cribbage"
    category = "cards"
    howto = [
        "Discard to the dealer's crib, then a starter card is cut (a jack: 2 for the dealer).",
        "The play: take turns laying cards, keeping the count at 31 or under. 15 and 31 score 2, pairs 2, runs their length, the last card 1.",
        "The show: score your hand with the starter: fifteens 2, pairs 2, runs, flushes, and nobs (jack of the starter's suit) 1.",
        "The dealer also scores the crib. First to the target wins the moment they reach it.",
        "🦉 Muggins (an option): count your own hand. Miss points and the next player takes them!",
    ]
    name = "Cribbage"
    icon = "📍"
    blurb = "The classic pegging card game: make fifteens, pairs and runs, and race your peg to 121."
    min_players = 2
    max_players = 3
    badges = {**Game.badges, "big_hand": ("🃏", "Twenty-plus", "Score 20 or more in one hand at the show"),
              "skunk": ("🦨", "Skunk", "Win before a rival reaches the skunk line (30 short of the finish)")}
    settings_schema = {
        "target": ("Game to", [(121, "121 (full)"), (61, "61 (short)")], 121),
        "muggins": ("Counting", [(False, "Hands counted for you"), (True, "🦉 Muggins: count your own")], False),
    }
    claims = None  # 🦉 muggins: what each person said their hand was worth

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.score = 0
            p.g.hand, p.g.peg_hand, p.g.pegged, p.g.discarded = [], [], [], False
        self.dealer = rng.randrange(len(self.seats))
        self.deal_no = 0
        self.show, self.last_peg, self.starter = [], "", None
        self.room.add_log(f"🃏 Cribbage to {self.s['target']}! {self.pl(self.seats[self.dealer]).name} deals first.", "big")
        self.deal()

    def pl(self, pid):
        return self.room.players.get(pid)

    def players(self):
        return [self.pl(i) for i in self.seats if self.pl(i)]

    def next_seat(self, pid, k=1):
        return self.seats[(self.seats.index(pid) + k) % len(self.seats)]

    # -- scoring

    def peg(self, p, points, why):
        """Add points; True if that wins the game (which ends at once)."""
        if not points:
            return False
        p.g.score += points
        if p.g.score >= self.s["target"]:
            p.g.score = min(p.g.score, self.s["target"])
            self.room.add_log(f"🎯 {p.name} scores {points} ({why}) and pegs out!", "big")
            line = self.s["target"] - 30  # the skunk line: a rival short of it was skunked
            skunked = [o for o in self.players() if o.id != p.id and o.g.score < line]
            if skunked:
                self.award(p, "skunk")
                self.room.add_log(f"🦨 Skunk! {' & '.join(o.name for o in skunked)} never reached {line}.", "power")
            self.room.finish(p, f"🏆 {p.name} reaches {self.s['target']} and wins Cribbage!" + (" 🦨 A skunk!" if skunked else ""))
            return True
        return False

    # -- the deal

    def deal(self):
        r = self.room
        self.deal_no += 1
        deck = [rk + s for rk in RANKS for s in SUITS]
        self.rng.shuffle(deck)
        self.deck = deck
        n = 6 if len(self.seats) == 2 else 5
        self.crib = [] if len(self.seats) == 2 else [self.deck.pop()]
        for p in self.players():
            p.g.hand = sorted((self.deck.pop() for _ in range(n)), key=lambda c: (rank(c), c[1]))
            p.g.peg_hand, p.g.pegged, p.g.discarded = [], [], False
        self.starter, self.show, self.last_peg = None, [], ""
        self.stage = "discard"
        self.count, self.seq, self.last_player = 0, [], None
        r.turn = None
        t = r.settings["timer"]
        r.deadline = time.time() + max(t, 30) if t else None
        dealer = self.pl(self.seats[self.dealer])
        r.add_log(f"🎴 Deal {self.deal_no}: {dealer.name} deals. Everyone discards {self.need()} to {dealer.name}'s crib.")

    def need(self):
        return 2 if len(self.seats) == 2 else 1

    def discard(self, p, cards):
        if self.stage != "discard":
            raise GameError("It's not time to discard.")
        if p.g.discarded:
            raise GameError("You've already discarded.")
        if not (isinstance(cards, list) and len(cards) == self.need() and len(set(cards)) == len(cards)
                and all(c in p.g.hand for c in cards)):
            raise GameError(f"Pick {self.need()} card{'s' * (self.need() > 1)} from your hand.")
        for c in cards:
            p.g.hand.remove(c)
            self.crib.append(c)
        p.g.discarded = True
        if all(o.g.discarded for o in self.players()):
            self.cut()

    def cut(self):
        r = self.room
        self.starter = self.deck.pop()
        dealer = self.pl(self.seats[self.dealer])
        r.add_log(f"✂️ The starter is {pretty(self.starter)}.")
        if self.starter[0] == "J":
            r.add_log(f"🎩 His heels! {dealer.name} scores 2.", "question")
            if self.peg(dealer, 2, "his heels"):
                return
        for p in self.players():
            p.g.peg_hand = list(p.g.hand)
        self.stage = "peg"
        self.count, self.seq, self.last_player = 0, [], None
        r.deadline = None
        self.turn_to(self.next_seat(self.seats[self.dealer]))

    # -- the play

    def can_play(self, p):
        return any(self.count + value(c) <= 31 for c in p.g.peg_hand)

    def turn_to(self, pid):
        self.room.begin_turn(pid)

    def play(self, p, card):
        r = self.room
        if self.stage != "peg":
            raise GameError("It's not time to play.")
        self.require_turn(p)
        if card not in p.g.peg_hand:
            raise GameError("That card isn't in your hand.")
        if self.count + value(card) > 31:
            raise GameError(f"That would take the count past 31 (it's {self.count}).")
        p.g.peg_hand.remove(card)
        p.g.pegged.append(card)
        self.count += value(card)
        self.seq.append(card)
        self.last_player = p.id
        items = score_peg(self.seq, self.count)
        pts = sum(v for _, v in items)
        why = ", ".join(f"{d} {v}" for d, v in items)
        self.last_peg = f"{p.name}: {pretty(card)} → {self.count}" + (f" · {why}" if items else "")
        r.add_log(f"{'🎯' if items else '🃏'} {self.last_peg}", "question" if items else "info")
        if self.peg(p, pts, why):
            return
        if self.count == 31:
            self.reset_count()
        self.next_peg(p.id)

    def reset_count(self):
        self.count, self.seq = 0, []

    def next_peg(self, after):
        """Pass the turn to the next player who can lay a card; handle go and the last card."""
        r = self.room
        if not any(o.g.peg_hand for o in self.players()):
            if self.count and self.last_player:  # last card of the play
                lp = self.pl(self.last_player)
                r.add_log(f"1️⃣ {lp.name}: last card, 1.", "question")
                if self.peg(lp, 1, "last card"):
                    return
            return self.start_show()
        for k in range(1, len(self.seats) + 1):
            cand = self.pl(self.next_seat(after, k))
            if cand and cand.g.peg_hand and self.can_play(cand):
                return self.turn_to(cand.id)
        # nobody can go: the last player to lay a card scores the go, and the count starts again
        if self.count and self.last_player:
            lp = self.pl(self.last_player)
            r.add_log(f"🙅 Go — {lp.name} scores 1.", "question")
            if self.peg(lp, 1, "go"):
                return
        self.reset_count()
        start = self.last_player or after
        for k in range(1, len(self.seats) + 1):
            cand = self.pl(self.next_seat(start, k))
            if cand and cand.g.peg_hand:
                return self.turn_to(cand.id)

    # -- the show

    def start_show(self):
        r = self.room
        r.turn = None
        if self.s.get("muggins") and any(not p.bot for p in self.players()):
            self.stage = "count"   # people count their own hands first; bots always count right
            self.claims = {}
            r.deadline = time.time() + COUNT_SECS
            return r.add_log("🦉 Muggins: count your hand (with the starter). Points you miss go to the next player!", "power")
        self.reveal_show()

    def claim(self, p, n):
        if self.stage != "count" or p.bot or p.id in self.claims:
            raise GameError("There's nothing to count right now.")
        if not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 29:
            raise GameError("A hand is worth 0 to 29.")
        self.claims[p.id] = n
        if all(o.bot or o.id in self.claims for o in self.players()):
            self.reveal_show()

    def reveal_show(self):
        r = self.room
        claims, self.claims = self.claims or {}, None
        self.stage = "show"
        self.show = []
        dealer_id = self.seats[self.dealer]
        order = [self.next_seat(dealer_id, k) for k in range(1, len(self.seats))] + [dealer_id]
        for pid in order:
            p = self.pl(pid)
            if not p:
                continue
            items = score_show(p.g.hand, self.starter)
            total = sum(v for _, v in items)
            if total >= 20:
                self.award(p, "big_hand")
            said = claims.get(pid, total)
            self.show.append({"who": pid, "crib": False, "cards": p.g.hand, "items": items, "total": total,
                              "said": said if pid in claims else None})
            r.add_log(f"🧮 {p.name}'s hand: {total}" + (f" ({', '.join(f'{d} {v}' for d, v in items)})" if items else ""))
            if said > total:
                r.add_log(f"🧮 {p.name} counted {said}, but it's {total}.")
            if self.peg(p, min(said, total), "hand"):
                return
            if said < total:  # 🦉 muggins: the next player takes what was missed
                thief = self.pl(self.next_seat(pid))
                r.add_log(f"🦉 Muggins! {p.name} counted {said} and missed {total - said}: {thief.name} takes them.", "power")
                if self.peg(thief, total - said, "muggins"):
                    return
        dealer = self.pl(dealer_id)
        items = score_show(self.crib, self.starter, crib=True)
        total = sum(v for _, v in items)
        self.show.append({"who": dealer_id, "crib": True, "cards": sorted(self.crib, key=lambda c: (rank(c), c[1])),
                          "items": items, "total": total})
        r.add_log(f"🧮 {dealer.name}'s crib: {total}" + (f" ({', '.join(f'{d} {v}' for d, v in items)})" if items else ""))
        if self.peg(dealer, total, "crib"):
            return
        r.deadline = time.time() + SHOW_PAUSE + 1.5 * len(self.show)

    def on_timeout(self):
        if self.stage == "count":  # anyone who didn't answer gets their true count
            return self.reveal_show()
        if self.stage == "show":
            self.dealer = (self.dealer + 1) % len(self.seats)
            return self.deal()
        if self.stage == "discard":  # the timer ran out: throw the least useful cards for whoever is slow
            for p in self.players():
                if not p.g.discarded:
                    self.room.add_log(f"⏰ {p.name} ran out of time; cards were discarded for them.", "power")
                    self.discard(p, self.choose_discard(p, "easy"))
            return
        p = self.pl(self.room.turn)
        self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
        self.play(p, min((c for c in p.g.peg_hand if self.count + value(c) <= 31), key=value))

    def on_leave(self, p):
        r = self.room
        left = [o for o in r.contenders() if o.id != p.id]
        r.add_log(f"{p.name} left the game.")
        p.eliminated = True
        if len(left) == 1:
            r.finish(left[0], f"🏳️ {p.name} left — {left[0].name} wins!")
        elif not left:
            r.finish(None, "Everyone left.")
        else:  # three players: carry on with two (their cards stay out of play)
            self.seats.remove(p.id)
            self.dealer %= len(self.seats)
            if self.stage == "discard" and all(o.g.discarded for o in self.players()):
                self.cut()
            elif self.stage == "peg" and r.turn == p.id:
                self.next_peg(p.id)

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        t = a.get("type")
        if t == "discard":
            return self.discard(p, a.get("cards"))
        if t == "play":
            return self.play(p, a.get("card"))
        if t == "count":
            return self.claim(p, a.get("n"))
        raise GameError("Unknown action.")

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"🎯 {p.g.score}/{self.s['target']}" + (" · 🔘 dealer" if self.seats and p.id == self.seats[self.dealer] else "")

    def final_scores(self):
        return {i: self.pl(i).g.score for i in self.seats if self.pl(i)}

    def view(self, p):
        mine = p.id in self.seats
        over = self.room.phase == "over"
        return {"cribbage": {
            "stage": self.stage, "target": self.s["target"], "seats": self.seats, "dealer": self.seats[self.dealer],
            "scores": {i: self.pl(i).g.score for i in self.seats if self.pl(i)},
            "discarded": {i: self.pl(i).g.discarded for i in self.seats if self.pl(i)},
            "pegged": {i: self.pl(i).g.pegged for i in self.seats if self.pl(i)},
            "left": {i: len(self.pl(i).g.peg_hand) for i in self.seats if self.pl(i)},
            "need": self.need(), "crib": len(self.crib), "starter": self.starter,
            "count": self.count, "seq": self.seq, "lastPeg": self.last_peg,
            "hand": (p.g.hand if self.stage == "discard" else p.g.peg_hand) if mine else [],
            "kept": p.g.hand if mine else [],
            "show": self.show if self.stage == "show" or over else [],
            "counting": self.stage == "count" and mine and not p.bot and p.id not in (self.claims or {}),
            "deal": self.deal_no,
            # during the play: what each of your cards would score if you laid it now
            "pegNow": {c: sum(v for _, v in score_peg(self.seq + [c], self.count + value(c)))
                       for c in p.g.peg_hand if self.count + value(c) <= 31}
            if mine and self.stage == "peg" and self.room.turn == p.id else {},
        }}

    # -- bots

    def bot_ready(self):
        now_ok = self.room.phase == "playing"
        if self.stage == "discard":
            return now_ok and any(o.bot and not o.g.discarded for o in self.players())
        if self.stage in ("show", "count"):
            return False
        return super().bot_ready()

    def bot_tick(self):
        if self.stage == "discard":
            for o in self.players():
                if o.bot and not o.g.discarded and self.stage == "discard":
                    self.discard(o, self.choose_discard(o, o.bot))
            return
        super().bot_tick()

    def peek(self, p, a):
        """💡 A learner's hint, alone against bots: the discard the hard bot would make, and what the
        four kept cards score on average."""
        if a.get("what") != "discard" or self.stage != "discard" or p.id not in self.seats or p.g.discarded:
            raise GameError("No hint right now.")
        if len([o for o in self.room.contenders() if o.human()]) > 1:
            raise GameError("Hints are for games against bots.")
        out = self.choose_discard(p, "hard")
        keep = [c for c in p.g.hand if c not in out]
        seen = set(p.g.hand)
        starters = [rk + s for rk in RANKS for s in SUITS if rk + s not in seen]
        avg = sum(sum(v for _, v in score_show(keep, st)) for st in starters) / len(starters)
        return {"cards": out, "avg": round(avg, 1)}

    def choose_discard(self, p, level):
        """Keep the four cards worth the most on average over every possible starter; the hard bot also
        values (or avoids feeding) the crib."""
        hand = p.g.hand
        options = list(combinations(hand, self.need()))
        if level == "easy" and random.random() < 0.5:
            return list(random.choice(options))
        mine = p.id == self.seats[self.dealer]
        seen = set(hand)
        starters = [rk + s for rk in RANKS for s in SUITS if rk + s not in seen]
        best, best_val = None, -1e9
        for out in options:
            keep = [c for c in hand if c not in out]
            avg = sum(sum(v for _, v in score_show(keep, st)) for st in starters) / len(starters)
            if level == "hard":
                toss = list(out)
                crib_val = sum(2 for a, b in combinations(toss, 2) if rank(a) == rank(b))
                crib_val += sum(2 for a, b in combinations(toss, 2) if value(a) + value(b) == 15)
                crib_val += sum(1 for c in toss if c[0] == "5") * 1.5
                avg += crib_val if mine else -crib_val
            if avg > best_val:
                best, best_val = list(out), avg
        return best

    def bot_turn(self, p):
        legal = [c for c in p.g.peg_hand if self.count + value(c) <= 31]
        if p.bot == "easy":
            card = random.choice(legal)
        else:
            def worth(c):
                count = self.count + value(c)
                pts = sum(v for _, v in score_peg(self.seq + [c], count))
                if p.bot == "hard":
                    if count in (5, 21):
                        pts -= 1.5  # an easy 15 or 31 for the next player
                    if count < 15 and 15 - count <= 10:
                        pts -= 0.4  # leaves a ten-card fifteen
                    if self.seq and abs(rank(c) - rank(self.seq[-1])) == 1:
                        pts -= 0.6  # invites a run
                    pts -= value(c) * 0.02  # keep low cards for later
                return pts + random.uniform(0, 0.05)
            card = max(legal, key=worth)
        self.play(p, card)
