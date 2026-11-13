"""Big Two (Deuces): the climbing game with poker hands, for 2-4 players (13 cards each).

Cards rank 3 low up to 2 high, and suits break ties: ♦ < ♣ < ♥ < ♠. Whoever holds the 3♦ leads it
(alone or in a combination). Then each in turn must beat the last play with the same number of cards,
or pass: singles, pairs, threes, or five-card hands (straight < flush < full house < four of a kind
with any fifth card < straight flush). Passing doesn't stop you playing next time round. When everyone
else passes, the last player leads anything. First to shed every card wins the round; the others score
a penalty for each card left (double with 10 or more, triple with all 13). Lowest total wins."""
import itertools
import random

from .cardbase import CardGame, GameError, deck, rank, suit, show

ORDER = "3456789TJQKA2"
SUITS = "DCHS"
KINDS = ["straight", "flush", "full house", "four of a kind", "straight flush"]
NAMES = {1: "single", 2: "pair", 3: "three"}


def val(c):
    return ORDER.index(rank(c)) * 4 + SUITS.index(suit(c))


SORT = val


def straight_top(cards):
    idx = sorted(ORDER.index(rank(c)) for c in cards)
    if len(set(idx)) == 5 and idx[-1] - idx[0] == 4 and idx[-1] <= ORDER.index("A"):
        return max(cards, key=val)
    return None


def judge(cards):
    """(size, kind rank, key) for a legal combination, or None."""
    n = len(cards)
    rs = [rank(c) for c in cards]
    top = max(cards, key=val)
    if n in (1, 2, 3):
        return (n, 0, val(top)) if len(set(rs)) == 1 else None
    if n != 5:
        return None
    count = {r: rs.count(r) for r in set(rs)}
    flush = len({suit(c) for c in cards}) == 1
    st = straight_top(cards)
    if st and flush:
        return (5, 4, val(st))
    if sorted(count.values()) == [1, 4]:
        return (5, 3, ORDER.index(max(count, key=count.get)))
    if sorted(count.values()) == [2, 3]:
        return (5, 2, ORDER.index(max(count, key=count.get)))
    if flush:
        return (5, 1, val(top))
    if st:
        return (5, 0, val(st))
    return None


def combos(hand):
    """Every legal play from a hand (five-card hands trimmed to a sensible number)."""
    hand = sorted(hand, key=val)
    out = [[c] for c in hand]
    by = {}
    for c in hand:
        by.setdefault(rank(c), []).append(c)
    for cs in by.values():
        for k in (2, 3):
            out += [list(x) for x in itertools.combinations(cs, k)]
    fives = []
    # straights: one card per rank, lowest suit first (and every suit mix when small)
    for a in range(ORDER.index("A") - 3):
        run = [by.get(ORDER[a + k], []) for k in range(5)]
        if all(run):
            for pick in itertools.islice(itertools.product(*run), 24):
                fives.append(list(pick))
    for s in SUITS:
        cs = [c for c in hand if suit(c) == s]
        if len(cs) >= 5:
            fives += [list(x) for x in itertools.islice(itertools.combinations(cs, 5), 40)]
    trips = [list(x) for cs in by.values() if len(cs) >= 3 for x in itertools.combinations(cs, 3)]
    pairs = [list(x) for cs in by.values() if len(cs) >= 2 for x in itertools.combinations(cs, 2)]
    for t in trips:
        for p in pairs:
            if rank(p[0]) != rank(t[0]):
                fives.append(t + p)
    for cs in by.values():
        if len(cs) == 4:
            for k in hand:
                if k not in cs:
                    fives.append(cs + [k])
    seen = set()
    for f in fives:
        key = tuple(sorted(f))
        if key not in seen and judge(f):
            seen.add(key)
            out.append(f)
    return out


def beats(new, old):
    a, b = judge(new), judge(old)
    if not a or not b or a[0] != b[0]:
        return False
    return (a[1], a[2]) > (b[1], b[2])


def describe(cards):
    j = judge(cards)
    if not j:
        return show(cards)
    return (KINDS[j[1]] if j[0] == 5 else NAMES[j[0]]) + ": " + show(cards)


class BigTwo(CardGame):
    id = "bigtwo"
    name = "Big Two"
    icon = "🐉"
    blurb = "Climb with singles, pairs and poker hands. 2 is top, spades break ties. Shed all thirteen first."
    howto = [
        "3 is low, 2 is high; suits break ties ♦ < ♣ < ♥ < ♠. The 3♦ leads first.",
        "Beat the last play with the same number of cards: singles, pairs, threes or five-card hands.",
        "Five-card hands: straight < flush < full house < four of a kind (+1) < straight flush.",
        "Pass if you can't or won't (you can still play next time round). Everyone passes: the last player leads anything.",
        "First out wins the round. Cards left are penalties (×2 with 10+, ×3 with 13). Lowest total wins.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "dragon": ("🐉", "Dragon", "Play a straight flush")}
    settings_schema = {"rounds": ("Rounds", [(3, "3 rounds"), (1, "1 round"), (5, "5 rounds")], 3)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.round = 0
        self.room.add_log(f"🐉 Big Two: {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''}. 3♦ leads.", "big")
        self.deal()

    def deal(self):
        self.round += 1
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [sorted(cards[k * 13:(k + 1) * 13], key=val) for k in range(self.n)]
        self.lastplay = None          # [seat, cards]
        self.passes = 0
        self.first = True
        self.stage = "play"
        lead = next((k for k in range(self.n) if "3D" in self.hands[k]), None)
        if lead is None:   # fewer than four players: the lowest card leads
            lead = min(range(self.n), key=lambda k: val(self.hands[k][0]))
            self.opening = self.hands[lead][0]
        else:
            self.opening = "3D"
        self.room.add_log(f"🃏 Round {self.round}: {self.nm(lead)} leads (holding {show([self.opening])}).")
        self.to(lead)

    def legal(self, i, cards):
        if not judge(cards):
            return "That isn't a single, pair, three or five-card hand."
        if self.first and self.opening not in cards:
            return f"The first play must include the {show([self.opening])}."
        if self.lastplay and not beats(cards, self.lastplay[1]):
            return f"Beat {describe(self.lastplay[1])} with {len(self.lastplay[1])} card{'s' if len(self.lastplay[1]) > 1 else ''}."
        return None

    def play(self, i, cards):
        for c in cards:
            self.hands[i].remove(c)
        self.first = False
        self.lastplay = [i, cards]
        self.passes = 0
        j = judge(cards)
        if j[0] == 5 and j[1] == 4:
            if self.pl(i):
                self.award(self.pl(i), "dragon")
            self.moment(f"🐉 Straight flush from {self.nm(i)}!", "gold", "fanfare")
        self.room.add_log(f"🂠 {self.nm(i)}: {describe(cards)}")
        if not self.hands[i]:
            return self.end_round(i)
        self.to(self.next_seat(i))

    def do_pass(self, i):
        self.passes += 1
        self.room.add_log(f"✋ {self.nm(i)} passes.")
        if self.passes >= self.n - 1:
            w = self.lastplay[0]
            self.lastplay = None
            self.passes = 0
            self.room.add_log(f"🧹 {self.nm(w)} leads again.")
            return self.to(w)
        self.to(self.next_seat(i))

    def end_round(self, w):
        pen = []
        for k in range(self.n):
            c = len(self.hands[k])
            pen.append(c * (3 if c == 13 else 2 if c >= 10 else 1))
            self.scores[k] += pen[k]
        self.moment(f"🐉 {self.nm(w)} is out!", "gold", "fanfare")
        self.room.add_log("🧮 " + " · ".join(f"{self.nm(k)} +{pen[k]}" for k in range(self.n)), "big")
        if self.round >= self.s["rounds"]:
            return self.win_by_score(self.scores, high=False, what="penalty points")
        self.stage = "score"
        self.pause(self.deal, 4)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        if self.stage != "play":
            raise GameError("Wait a moment.")
        t = a.get("type")
        if t == "pass":
            if not self.lastplay:
                raise GameError("You're leading: play something.")
            return self.do_pass(i)
        if t == "play":
            cards = a.get("cards")
            if not isinstance(cards, list) or len(set(map(str, cards))) != len(cards) or not all(c in self.hands[i] for c in cards):
                raise GameError("Pick cards from your hand.")
            why = self.legal(i, cards)
            if why:
                raise GameError(why)
            return self.play(i, cards)
        raise GameError("Unknown action.")

    # -- bots

    def bot_move(self, i, level):
        if self.stage != "play":
            return
        hand = self.hands[i]
        opts = [c for c in combos(hand) if not self.legal(i, c)]
        if not opts:
            return self.do_pass(i)
        if level == "easy":
            if self.lastplay and random.random() < 0.25:
                return self.do_pass(i)
            return self.play(i, random.choice(opts) if random.random() < 0.4 else min(opts, key=lambda c: (judge(c)[1], judge(c)[2])))
        count = {}
        for c in hand:
            count[rank(c)] = count.get(rank(c), 0) + 1

        def cost(cs):
            j = judge(cs)
            broken = sum(1 for r in {rank(c) for c in cs} if count[r] > sum(1 for c in cs if rank(c) == r)) if len(cs) < 5 else 0
            twos = sum(1 for c in cs if rank(c) == "2")
            v = (j[1] * 60 + j[2]) / (len(cs) ** 0.5) + broken * 25 + twos * (40 if level == "hard" and len(hand) > 6 else 10)
            return v - len(cs) * (8 if not self.lastplay else 0)
        best = min(opts, key=cost)
        if self.lastplay and level == "hard" and len(hand) > 5 and all(rank(c) == "2" for c in best) and len(self.lastplay[1]) == 1:
            others_low = min(len(self.hands[k]) for k in range(self.n) if k != i)
            if others_low > 3:
                return self.do_pass(i)
        return self.play(i, best)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i])}"

    def final_scores(self):
        return {pid: -self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"{self.scores[k]} pen"]} for k in range(self.n)]
        lp = self.lastplay
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": lp[1] if lp else [], "fan": True, "label": f"{self.nm(lp[0])}: {describe(lp[1]).split(':')[0]}" if lp else "Lead anything"}],
             "scores": {"title": "Penalty points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(self.n), key=lambda k: self.scores[k])],
                        "hint": f"Round {self.round} of {self.s['rounds']}. ♦ < ♣ < ♥ < ♠. Lowest total wins."}}
        if i is not None and self.stage == "play" and self.room.turn == p.id:
            t["pick"] = {"act": "play", "min": 1, "max": 5, "label": "Play"}
            if lp:
                t["buttons"] = [{"label": "✋ Pass", "a": {"type": "pass"}}]
                t["note"] = f"Beat the {describe(lp[1]).split(':')[0]} with {len(lp[1])} card{'s' if len(lp[1]) > 1 else ''}, or pass."
            else:
                t["note"] = "Your lead: any single, pair, three or five-card hand" + (f" with the {show([self.opening])}." if self.first else ".")
            t["turnText"] = "🐉 Your play"
        return t
