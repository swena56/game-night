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


# -- Tiến Lên (Thirteen): suits ♠ < ♣ < ♦ < ♥; singles, pairs, threes, fours, runs of 3+ and runs of 3+ pairs
TL_SUITS = "SCDH"


def tval(c):
    return ORDER.index(rank(c)) * 4 + TL_SUITS.index(suit(c))


def tjudge(cards):
    """(type, length, key) for a legal Tiến Lên play, or None."""
    n = len(cards)
    if not n:
        return None
    rs = [rank(c) for c in cards]
    top = max(tval(c) for c in cards)
    if len(set(rs)) == 1 and n <= 4:
        return (["single", "pair", "three", "four"][n - 1], n, top)
    idx = sorted(ORDER.index(r) for r in rs)
    if "2" in rs:
        return None
    if n >= 3 and len(set(idx)) == n and idx[-1] - idx[0] == n - 1:
        return ("run", n, top)
    if n >= 6 and n % 2 == 0:
        pairs = idx[::2]
        if all(idx[2 * k] == idx[2 * k + 1] for k in range(n // 2)) and len(set(pairs)) == n // 2 and pairs[-1] - pairs[0] == n // 2 - 1:
            return ("pairs", n, top)
    return None


def tbeats(new, old):
    a, b = tjudge(new), tjudge(old)
    if not a or not b:
        return False
    if a[0] == b[0] and a[1] == b[1]:
        return a[2] > b[2]
    # bombs: a four or three pairs in a row beat a single 2; four pairs in a row beat a pair of 2s
    two = all(rank(c) == "2" for c in old)
    if two and b[0] == "single" and (a[0] == "four" or (a[0] == "pairs" and a[1] >= 6)):
        return True
    if two and b[0] == "pair" and a[0] == "pairs" and a[1] >= 8:
        return True
    return False


def tcombos(hand):
    hand = sorted(hand, key=tval)
    by = {}
    for c in hand:
        by.setdefault(rank(c), []).append(c)
    out = [[c] for c in hand]
    for cs in by.values():
        for k in (2, 3, 4):
            out += [list(x) for x in itertools.islice(itertools.combinations(cs, k), 6)]
    ranks = [r for r in ORDER[:-1] if r in by]
    for a in range(len(ORDER) - 1):
        for length in range(3, 13):
            rr = ORDER[a:a + length]
            if len(rr) < length or "2" in rr or not all(r in by for r in rr):
                break
            out.append([by[r][0] for r in rr])
            out.append([by[r][-1] for r in rr])
            if all(len(by[r]) >= 2 for r in rr):
                out.append([c for r in rr for c in by[r][:2]])
    seen, uniq = set(), []
    for c in out:
        key = tuple(sorted(c))
        if key not in seen and tjudge(c):
            seen.add(key)
            uniq.append(c)
    return uniq


def tdescribe(cards):
    j = tjudge(cards)
    if not j:
        return show(cards)
    name = {"run": f"run of {j[1]}", "pairs": f"{j[1] // 2} pairs in a row"}.get(j[0], j[0])
    return f"{name}: {show(cards)}"


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
        "🇻🇳 Tiến Lên: suits ♠ < ♣ < ♦ < ♥, the 3♠ leads; play singles to fours, runs of 3+ or 3+ pairs in a row (no 2s in runs). Beat the same kind and length. A four, or three pairs in a row, bombs a single 2. Pass and you sit out until the pile clears.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "dragon": ("🐉", "Dragon", "Play a straight flush")}
    settings_schema = {"rounds": ("Rounds", [(3, "3 rounds"), (1, "1 round"), (5, "5 rounds")], 3),
                       "rules": ("Rules", [("bigtwo", "Big Two: poker hands"), ("tienlen", "🇻🇳 Tiến Lên: runs and bombs")], "bigtwo")}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.round = 0
        self.room.add_log(f"🐉 Big Two: {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''}. 3♦ leads.", "big")
        self.deal()

    def tl(self):
        return self.s.get("rules") == "tienlen"

    def J(self, cards):
        return tjudge(cards) if self.tl() else judge(cards)

    def B(self, new, old):
        return tbeats(new, old) if self.tl() else beats(new, old)

    def D(self, cards):
        return tdescribe(cards) if self.tl() else describe(cards)

    def V(self, c):
        return tval(c) if self.tl() else val(c)

    def deal(self):
        self.round += 1
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [sorted(cards[k * 13:(k + 1) * 13], key=self.V) for k in range(self.n)]
        self.lastplay = None          # [seat, cards]
        self.passes = 0
        self.passed = set()
        self.first = True
        self.stage = "play"
        low = "3S" if self.tl() else "3D"
        lead = next((k for k in range(self.n) if low in self.hands[k]), None)
        if lead is None:   # fewer than four players: the lowest card leads
            lead = min(range(self.n), key=lambda k: self.V(self.hands[k][0]))
            self.opening = self.hands[lead][0]
        else:
            self.opening = low
        self.room.add_log(f"🃏 Round {self.round}: {self.nm(lead)} leads (holding {show([self.opening])}).")
        self.to(lead)

    def legal(self, i, cards):
        if not self.J(cards):
            return "That isn't a run, pairs in a row, or one to four of a kind." if self.tl() else "That isn't a single, pair, three or five-card hand."
        if self.first and self.opening not in cards:
            return f"The first play must include the {show([self.opening])}."
        if self.lastplay and not self.B(cards, self.lastplay[1]):
            return f"Beat {self.D(self.lastplay[1])} with {len(self.lastplay[1])} card{'s' if len(self.lastplay[1]) > 1 else ''}."
        return None

    def play(self, i, cards):
        for c in cards:
            self.hands[i].remove(c)
        self.first = False
        self.lastplay = [i, cards]
        self.passes = 0
        j = self.J(cards)
        if not self.tl() and j[0] == 5 and j[1] == 4:
            if self.pl(i):
                self.award(self.pl(i), "dragon")
            self.moment(f"🐉 Straight flush from {self.nm(i)}!", "gold", "fanfare")
        self.room.add_log(f"🂠 {self.nm(i)}: {self.D(cards)}")
        if not self.hands[i]:
            return self.end_round(i)
        if self.tl():
            nxt = next(((i + k) % self.n for k in range(1, self.n) if (i + k) % self.n not in self.passed), None)
            return self.clear(i) if nxt is None else self.to(nxt)
        self.to(self.next_seat(i))

    def do_pass(self, i):
        self.passes += 1
        self.passed.add(i)
        self.room.add_log(f"✋ {self.nm(i)} passes.")
        w = self.lastplay[0]
        if self.tl():
            # Tiến Lên: a pass sits you out until the pile clears
            nxt = next(((i + k) % self.n for k in range(1, self.n) if (i + k) % self.n not in self.passed and (i + k) % self.n != w), None)
            if nxt is None:
                return self.clear(w)
            return self.to(nxt)
        if self.passes >= self.n - 1:
            return self.clear(w)
        self.to(self.next_seat(i))

    def clear(self, w):
        self.lastplay = None
        self.passes = 0
        self.passed = set()
        self.room.add_log(f"🧹 {self.nm(w)} leads again.")
        self.to(w)

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
        opts = [c for c in (tcombos(hand) if self.tl() else combos(hand)) if not self.legal(i, c)]
        if not opts:
            return self.do_pass(i)
        if level == "easy":
            if self.lastplay and random.random() < 0.25:
                return self.do_pass(i)
            return self.play(i, random.choice(opts) if random.random() < 0.4 else min(opts, key=lambda c: (self.J(c)[1], self.J(c)[2])))
        count = {}
        for c in hand:
            count[rank(c)] = count.get(rank(c), 0) + 1

        def cost(cs):
            j = self.J(cs)
            broken = sum(1 for r in {rank(c) for c in cs} if count[r] > sum(1 for c in cs if rank(c) == r)) if len(cs) < 5 else 0
            twos = sum(1 for c in cs if rank(c) == "2")
            strength = (j[1] * 60 + j[2]) if not self.tl() else max(self.V(c) for c in cs)
            v = strength / (len(cs) ** 0.5) + broken * 25 + twos * (40 if level == "hard" and len(hand) > 6 else 10)
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
        info = [{"count": len(self.hands[k]), "tags": [f"{self.scores[k]} pen"] + (["✋"] if self.tl() and k in self.passed else [])} for k in range(self.n)]
        lp = self.lastplay
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": lp[1] if lp else [], "fan": True, "label": f"{self.nm(lp[0])}: {self.D(lp[1]).split(':')[0]}" if lp else "Lead anything"}],
             "scores": {"title": "Penalty points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(self.n), key=lambda k: self.scores[k])],
                        "hint": f"Round {self.round} of {self.s['rounds']}. {'♠ < ♣ < ♦ < ♥' if self.tl() else '♦ < ♣ < ♥ < ♠'}. Lowest total wins."}}
        if i is not None and self.stage == "play" and self.room.turn == p.id:
            t["pick"] = {"act": "play", "min": 1, "max": 13 if self.tl() else 5, "label": "Play"}
            if lp:
                t["buttons"] = [{"label": "✋ Pass", "a": {"type": "pass"}}]
                t["note"] = f"Beat the {self.D(lp[1]).split(':')[0]} with {len(lp[1])} card{'s' if len(lp[1]) > 1 else ''}, or pass."
            else:
                t["note"] = "Your lead: any single, pair, three or five-card hand" + (f" with the {show([self.opening])}." if self.first else ".")
            t["turnText"] = "🐉 Your play"
        return t
