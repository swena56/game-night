"""Skat: Germany's national card game. Three players, 32 cards, one declarer against two.

Ten cards each and two face down (the skat). The auction is in game values (18, 20, 22, 23, 24, 27,
30…): bid higher or pass for good, until one bidder is left. The declarer may pick up the skat and
discard two, or play "hand" (worth more), then names the game: a suit (the four jacks ♣ ♠ ♥ ♦ are the
top trumps, then A 10 K Q 9 8 7 of that suit), grand (only the jacks are trumps) or null (no trumps,
natural order, and the declarer must take no tricks at all). Follow suit (the jacks belong to trumps).
Cards count A 11, 10 10, K 4, Q 3, J 2; the declarer needs 61 of 120, the skat included. A suit or
grand game is worth its base (♦ 9, ♥ 10, ♠ 11, ♣ 12, grand 24) times its multiplier: one per top trump
held or missing in a row from the ♣ jack ("with" or "without"), plus one for game, hand, schneider
(90+) and schwarz (every trick). Null is 23 (35 hand). Win and score the value; lose (or bid more than
the game is worth) and lose twice that. Highest total after the deals wins."""
import random

from .cardbase import GameError, deck, rank, suit, pretty, show, SUIT_NAME
from .tricks import TrickGame

PTS = {"A": 11, "T": 10, "K": 4, "Q": 3, "J": 2}
JACKS = ["JC", "JS", "JH", "JD"]
BASE = {"D": 9, "H": 10, "S": 11, "C": 12, "G": 24}
PLAIN = "789QKTA"
NULL_ORDER = "789TJQKA"
VALUES = sorted({b * m for b in (9, 10, 11, 12) for m in range(2, 19)} | {24 * m for m in range(2, 9)} | {23, 35, 46, 59})
VALUES = [v for v in VALUES if v >= 18]
GAME_NAME = {"D": "♦ diamonds", "H": "♥ hearts", "S": "♠ spades", "C": "♣ clubs", "G": "grand", "N": "null"}


class Skat(TrickGame):
    id = "skat"
    solo_bots = 2
    name = "Skat"
    icon = "🍺"
    blurb = "One declarer against two: bid your game's value, take the skat, and make 61 with the jacks on top."
    howto = [
        "Ten cards each, two in the skat. Bid game values (18, 20, 22…) or pass; the last bidder declares.",
        "Pick up the skat and discard two, or play hand. Name a suit, grand (jacks only) or null (take no tricks).",
        "In suit games the four jacks (♣ ♠ ♥ ♦) top the trumps. Follow suit; jacks count as trumps.",
        "The declarer needs 61 of the 120 card points (A 11, 10 10, K 4, Q 3, J 2). The skat counts for them.",
        "Win: + the game's value. Lose or overbid: − twice that. Highest after all deals wins.",
        "An option: after a lost game the next deal is a Bock deal and every score in it counts double.",
    ]
    min_players, max_players = 3, 3
    badges = {**TrickGame.badges, "grand": ("🍺", "Grand", "Win a grand")}
    settings_schema = {"deals": ("Deals", [(6, "6 deals"), (3, "3 (quick)"), (9, "9 deals")], 6),
                       "bock": ("🍺 Bock", [(False, "Off"), (True, "On: x2 after a loss")], False)}
    bock = False       # this deal counts double (a lost game just before it, with the option on)

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.score = [0, 0, 0]
        self.dealer = rng.randrange(3)
        self.deal_no = 0
        self.bock = False
        self.room.add_log(f"🍺 Skat: {self.s['deals']} deals, one declarer against two.", "big")
        self.deal()

    def make_deck(self):
        return deck("789TJQKA")

    def full_deck(self):
        return set(self.make_deck())

    # -- card order for the current game

    def suit_of(self, c):
        g = getattr(self, "game", None)
        if g in (None, "N"):
            return suit(c)
        if rank(c) == "J" or suit(c) == g:
            return "T"
        return suit(c)

    def power(self, c):
        g = getattr(self, "game", None)
        if g == "N":
            return NULL_ORDER.index(rank(c))
        if rank(c) == "J":
            return 30 - JACKS.index(c)
        base = PLAIN.index(rank(c))
        return base + (10 if g not in (None, "G") and suit(c) == g else 0)

    def partner(self, i):
        if self.declarer is None or i == self.declarer:
            return None
        return 3 - i - self.declarer

    # -- the deal and auction

    def deal(self):
        self.deal_no += 1
        self.dealer = (self.dealer + 1) % 3
        cards = self.make_deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 10:(k + 1) * 10] for k in range(3)]
        self.skat = cards[30:]
        self.game = None
        self.trump = None
        self.declarer = None
        self.bid = 0
        self.passed = [False] * 3
        self.said = [None] * 3
        self.hand_game = False
        self.put_away = []
        self.trick, self.last, self.tricks = [], None, [0] * 3
        self.result = None
        for k in range(3):
            self.sort_hand(k)
        self.stage = "bid"
        self.to((self.dealer + 1) % 3)

    def next_values(self):
        return [v for v in VALUES if v > self.bid]

    def place(self, i, v):
        if v is None:
            self.passed[i] = True
            self.said[i] = "pass"
            self.room.add_log(f"{self.nm(i)} passes.")
        else:
            self.bid, self.declarer = v, i
            self.said[i] = v
            self.room.add_log(f"🙋 {self.nm(i)}: {v}.")
        live = [k for k in range(3) if not self.passed[k]]
        if not live or (self.declarer is not None and live == [self.declarer]):
            if self.declarer is None:
                self.room.add_log("😶 Everyone passed: a new deal.", "big")
                self.result = "All passed"
                self.deal_no -= 1
                self.stage = "score"
                return self.pause(self.deal, 2)
            self.room.add_log(f"🍺 {self.nm(self.declarer)} declares at {self.bid}.", "power")
            self.stage = "skat"
            return self.to(self.declarer)
        k = i
        for _ in range(3):
            k = (k + 1) % 3
            if not self.passed[k]:
                return self.to(k)

    def pick_up(self, i):
        self.hands[i] += self.skat
        self.skat = []
        self.room.add_log(f"🍺 {self.nm(i)} picks up the skat.")
        self.stage = "discard"
        self.sort_hand(i)
        self.to(i)

    def go_hand(self, i):
        self.hand_game = True
        self.put_away = self.skat
        self.skat = []
        self.room.add_log(f"✋ {self.nm(i)} plays hand.", "power")
        self.stage = "name"
        self.to(i)

    def discard(self, i, cards):
        for c in cards:
            self.hands[i].remove(c)
        self.put_away = list(cards)
        self.stage = "name"
        self.to(i)

    def matadors(self, cards, g):
        """'With' or 'without' count: top trumps in an unbroken run from the ♣ jack (held or missing)."""
        order = JACKS + ([] if g == "G" else [r + g for r in "AT" "KQ" "987"])
        have = [c in cards for c in order]
        k = 0
        while k < len(order) and have[k] == have[0]:
            k += 1
        return k

    def value(self, g, cards, hand=False, schneider=False, schwarz=False):
        if g == "N":
            return 35 if hand else 23
        m = self.matadors(cards, g) + 1 + hand + schneider + schwarz
        return BASE[g] * m

    def name_game(self, i, g):
        self.game = g
        self.trump = None if g == "N" else "T"
        held = self.hands[i] + self.put_away
        v = self.value(g, held, self.hand_game)
        self.moment(f"🍺 {self.nm(i)} plays {GAME_NAME[g]}" + (" hand" if self.hand_game else "") + f" (bid {self.bid})", "cool", "whoosh")
        self.room.add_log(f"🍺 {self.nm(i)} names {GAME_NAME[g]}{' hand' if self.hand_game else ''}: worth at least {v}.", "power")
        for k in range(3):
            self.sort_hand(k)
        self.start_tricks((self.dealer + 1) % 3)

    # -- play

    def wants(self, i):
        if self.game == "N":
            return False
        return True

    def on_trick(self, w, cards):
        if self.game == "N" and w == self.declarer:
            # null is lost at the first trick taken
            for k in range(3):
                self.hands[k] = []

    # -- scoring

    def end_hand(self):
        d = self.declarer
        g = self.game
        held = self.won[d] + self.put_away
        if g == "N":
            won = self.tricks[d] == 0
            v = self.value("N", [], self.hand_game)
            text = f"{GAME_NAME[g]}: {'no tricks!' if won else 'took a trick'}"
        else:
            pts = sum(PTS.get(rank(c), 0) for c in held)
            schwarz = self.tricks[d] == 10
            schneider = pts >= 90
            won = pts >= 61
            if not won:
                schneider = pts <= 30
                schwarz = self.tricks[d] == 0
            v = self.value(g, self.orig, self.hand_game, schneider, schwarz)
            text = f"{GAME_NAME[g]}: {pts} points" + (" schneider" if schneider else "") + (" schwarz" if schwarz else "")
        if v < self.bid:
            won = False
            base = 23 if g == "N" else BASE[g]
            v = max(v, ((self.bid + base - 1) // base) * base)
            text += f" (overbid at {self.bid})"
        gain = v if won else -2 * v
        if self.bock:
            gain *= 2
            text += " (Bock: x2)"
        self.bock = bool(self.s.get("bock", False)) and not won and self.deal_no < self.s["deals"]
        self.score[d] += gain
        if won and g == "G" and self.pl(d):
            self.award(self.pl(d), "grand")
        self.result = f"{'✅' if won else '❌'} {self.nm(d)} {text}: {gain:+d}"
        self.room.add_log(f"🧮 {self.result}", "big")
        self.moment(self.result, "gold" if won else "bad", "fanfare" if won else "boom")
        if self.bock:
            self.moment("🍺 Bock! The next deal counts double", "cool", "whoosh")
        if self.deal_no >= self.s["deals"]:
            return self.win_by_score(self.score)
        self.stage = "score"
        self.pause(self.deal, 4.5)

    def start_tricks(self, leader):
        self.orig = self.hands[self.declarer] + self.put_away     # for the matadors at the end
        super().start_tricks(leader)

    # -- actions

    def act_other(self, p, i, t, a):
        self.require_turn(p)
        if self.stage == "bid" and t == "bid":
            v = a.get("value")
            if v is not None and v not in self.next_values():
                raise GameError("Bid one of the next values, or pass.")
            return self.place(i, v)
        if self.stage == "skat" and i == self.declarer:
            if t == "pickup":
                return self.pick_up(i)
            if t == "hand":
                return self.go_hand(i)
        if self.stage == "discard" and i == self.declarer and t == "discard":
            cards = a.get("cards")
            if not isinstance(cards, list) or len(cards) != 2 or len(set(cards)) != 2 or any(c not in self.hands[i] for c in cards):
                raise GameError("Put two cards back.")
            return self.discard(i, cards)
        if self.stage == "name" and i == self.declarer and t == "game":
            g = a.get("game")
            if g not in GAME_NAME:
                raise GameError("Pick a game.")
            return self.name_game(i, g)
        raise GameError("Not now.")

    # -- bots

    def judge(self, cards, g):
        """Is this a winnable game? Rough declarer points expected, or for null a safety score."""
        if g == "N":
            danger = sum({"A": 3, "K": 2, "Q": 1.2, "J": 0.8, "T": 0.6}.get(rank(c), 0) for c in cards)
            return 70 - danger * 6
        jacks = [c for c in cards if rank(c) == "J"]
        tr = [c for c in cards if rank(c) == "J" or (g != "G" and suit(c) == g)]
        e = 0.0
        e += sum({"JC": 16, "JS": 13, "JH": 10, "JD": 8}[c] for c in jacks)
        e += 4.5 * max(0, len(tr) - len(jacks)) if g != "G" else 0
        if not jacks:
            e -= 15
        elif "JC" not in jacks and "JS" not in jacks:
            e -= 6
        for c in cards:
            if c in tr:
                continue
            if rank(c) == "A":
                e += 15
            elif rank(c) == "T" and ("A" + suit(c)) in cards:
                e += 10
        if g == "G":
            e += 8 * max(0, len(jacks) - 2)
        else:
            e += 4 * max(0, len(tr) - 5)
        return e

    def best_game(self, cards, level):
        opts = []
        for g in "DHSCGN":
            j = self.judge(cards, g) + (7 if len(cards) == 10 and g != "N" else 0)    # the skat usually helps
            v = self.value(g, cards)
            opts.append((j, v, g))
        need = {"easy": 52, "normal": 58, "hard": 61}[level]
        good = [(v, g, j) for j, v, g in opts if j >= need]
        if not good:
            return None, 0
        v, g, j = max(good)
        return g, v

    def bot_other(self, i, level):
        if self.stage == "bid":
            g, v = self.best_game(self.hands[i], level)
            if level == "easy":
                v += random.choice([0, 0, 2, -2]) * 2
            nxt = self.next_values()
            if g and nxt and nxt[0] <= v:
                return self.place(i, nxt[0])
            return self.place(i, None)
        if self.stage == "skat":
            g, v = self.best_game(self.hands[i], "hard")
            if level == "hard" and g and self.judge(self.hands[i], g) >= 80 and self.value(g, self.hands[i], True) >= self.bid:
                return self.go_hand(i)
            return self.pick_up(i)
        if self.stage == "discard":
            return self.discard(i, self.bot_discard(i, level))
        if self.stage == "name":
            cards = self.hands[i] + self.put_away
            best, bv = None, -1
            for g in "DHSCGN":
                v = self.value(g, cards, self.hand_game)
                j = self.judge(self.hands[i] + self.put_away, g)
                if v >= self.bid and j > bv:
                    best, bv = g, j
            if best is None:
                best = max("DHSC", key=lambda g: self.judge(cards, g))
            return self.name_game(i, best)

    def bot_discard(self, i, level):
        hand = self.hands[i]
        g, _ = self.best_game(hand, level)
        g = g or max("DHSC", key=lambda x: self.judge(hand, x))
        if g == "N":
            return sorted(hand, key=lambda c: -NULL_ORDER.index(rank(c)))[:2]
        trumps = lambda c: rank(c) == "J" or (g != "G" and suit(c) == g)
        side = [c for c in hand if not trumps(c)]
        count = {}
        for c in side:
            count[suit(c)] = count.get(suit(c), 0) + 1

        def keep(c):
            r = rank(c)
            if r == "A":
                return 50
            if r == "T":
                # a bare ten goes in the skat (its points count for us)
                return 40 if ("A" + suit(c)) in hand else -5
            return PTS.get(r, 0) + 3 * count[suit(c)]
        pool = side if len(side) >= 2 else hand
        return sorted(pool, key=keep)[:2]

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.score[i]} pts"

    def final_scores(self):
        return {pid: self.score[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = []
        for k in range(3):
            tags = []
            if self.stage == "bid" and self.said[k] is not None:
                tags.append("pass" if self.said[k] == "pass" else str(self.said[k]))
            if k == self.declarer and self.stage != "bid":
                tags.append("🍺 declarer")
            if self.stage == "play":
                tags.append(f"{self.tricks[k]} tr")
            info.append({"count": len(self.hands[k]), "tags": tags})
        g = self.game
        t = {"info": info, "trump": g if g in ("C", "D", "H", "S") else None,
             "trumpLabel": {"G": "Grand: jacks only", "N": "Null: no trumps"}.get(g),
             "piles": [{"cards": ["??", "??"], "label": "Skat", "small": True}] if self.skat else [],
             "banner": self.result if self.stage == "score" else (f"{self.nm(self.declarer)}: {GAME_NAME[g]}, bid {self.bid}" if g else None),
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.score[k]} for k in sorted(range(3), key=lambda k: -self.score[k])],
                        "hint": f"Deal {self.deal_no} of {self.s['deals']}{' · 🍺 Bock x2' if self.bock else ''} · A 11, 10 10, K 4, Q 3, J 2 · 61 wins"}}
        t.update(self.trick_view(p, i))
        if i is None or self.room.turn != p.id:
            return t
        if self.stage == "bid":
            nxt = self.next_values()[:4]
            t["buttons"] = [{"label": "Pass", "a": {"type": "bid", "value": None}}] + [{"label": str(v), "a": {"type": "bid", "value": v}, "kind": "primary"} for v in nxt]
            sug = {x: self.value(x, self.hands[i]) for x in "DHSCG"}
            t["note"] = "With your jacks, games are worth: " + ", ".join(f"{GAME_NAME[x]} {sug[x]}" for x in "CSHDG") + ", null 23."
            t["turnText"] = "🙋 Bid or pass"
        elif self.stage == "skat":
            t["buttons"] = [{"label": "🍺 Pick up the skat", "a": {"type": "pickup"}, "kind": "primary"}, {"label": "✋ Play hand (+1)", "a": {"type": "hand"}}]
            t["turnText"] = "🍺 The skat"
        elif self.stage == "discard":
            t["pick"] = {"act": "discard", "min": 2, "max": 2, "label": "Put these two away"}
            t["note"] = "Put two cards back in the skat (their points count for you)."
            t["turnText"] = "🍺 Discard two"
        elif self.stage == "name":
            cards = self.hands[i] + self.put_away
            t["buttons"] = [{"label": f"{GAME_NAME[x]} ({self.value(x, cards, self.hand_game)})", "a": {"type": "game", "game": x},
                             "kind": "primary" if self.value(x, cards, self.hand_game) >= self.bid else ""} for x in "CSHDGN"]
            t["note"] = f"You bid {self.bid}: pick a game worth at least that (schneider and schwarz can add more)."
            t["turnText"] = "🍺 Name the game"
        return t
