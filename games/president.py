"""President (Scum): the classic climbing game, for 3-6 players.

All the cards are dealt; 3 is low and 2 is high. The leader plays a single, a pair, three or four of a
kind; each player in turn must beat it with the same number of a higher rank, or pass (and sit out until
the pile is cleared). When everyone else has passed, whoever played last clears the pile and leads.
The order players go out sets the next hand's ranks: the President takes the Scum's two best cards and
hands back any two; the Vice-President and Vice-Scum swap one. Points per hand (President most), and
after the last hand the most points wins.

💣 Fours clear (a setting): four of a kind can be played on anything and clears the pile."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, show, rname, by_suit

ORDER = "3456789TJQKA2"
SORT = lambda c: (ORDER.index(rank(c)), "CDHS".index(suit(c)))


def titles(n):
    """The ranks, best first, for n players."""
    if n == 3:
        return ["👑 President", "😐 Citizen", "🪣 Scum"]
    mid = ["😐 Citizen"] * (n - 4)
    return ["👑 President", "🎩 Vice-President", *mid, "🧹 Vice-Scum", "🪣 Scum"]


class President(CardGame):
    id = "president"
    solo_bots = 3
    name = "President"
    icon = "👑"
    blurb = "Climb out of your hand first: beat the pile with higher pairs and sets, and become President."
    howto = [
        "3 is low, 2 is high. Lead a single, pair, three or four of a kind.",
        "Each player must beat it with the same number of a higher rank, or pass (and sit out until the pile clears).",
        "When everyone else passes, the last to play clears the pile and leads again.",
        "Go out first to be 👑 President, last is 🪣 Scum. Next hand the Scum hands over their two best cards and gets two back.",
        "Points each hand (President most). After the last hand, most points wins.",
        "💣 Fours clear (a setting): four of a kind beats anything and clears the pile.",
    ]
    min_players, max_players = 3, 6
    badges = {**CardGame.badges, "coup": ("✊", "Revolution", "Go from Scum to President in one hand"),
              "reign": ("👑", "Long reign", "Be President three hands running")}
    settings_schema = {
        "hands": ("Hands", [(4, "4 hands"), (2, "2 hands (quick)"), (6, "6 hands")], 4),
        "bomb": ("💣 Fours clear", [(False, "Off"), (True, "On: four of a kind beats anything")], False),
    }

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.hand_no = 0
        self.ranks = None          # seat -> place (0 = President) from the last hand
        self.streak = [0] * self.n
        self.room.add_log(f"👑 President: {self.s['hands']} hands. 3 is low, 2 is high.", "big")
        self.deal()

    # -- the deal and the swap

    def deal(self):
        self.hand_no += 1
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [sorted(cards[k::self.n], key=SORT) for k in range(self.n)]
        self.out_order = []
        self.pile = []            # list of plays: [seat, [cards]]
        self.passed = set()
        self.swap = {}
        self.got = {}
        self.room.add_log(f"🃏 Hand {self.hand_no} of {self.s['hands']}.")
        if self.ranks is None:
            lead = next(k for k in range(self.n) if "3C" in self.hands[k])
            return self.begin(lead)
        # the Scum (and Vice-Scum) give their best; the President (and VP) choose what to give back
        order = sorted(range(self.n), key=lambda k: self.ranks[k])
        pairs = [(order[0], order[-1], 2)] + ([(order[1], order[-2], 1)] if self.n >= 4 else [])
        self.swaps = pairs
        for top, low, k in pairs:
            best = sorted(self.hands[low], key=SORT)[-k:]
            for c in best:
                self.hands[low].remove(c)
            self.hands[top] += best
            self.hands[top].sort(key=SORT)
            self.got[top] = best
            self.room.add_log(f"🔁 {self.nm(low)} hands {self.nm(top)} their best: {show(best)}.")
        self.stage = "swap"
        self.open_all([top for top, _, _ in pairs])

    def give_back(self, i, cards):
        top, low, k = next(p for p in self.swaps if p[0] == i)
        for c in cards:
            self.hands[i].remove(c)
        self.hands[low] += cards
        self.hands[low].sort(key=SORT)
        self.got[low] = cards
        self.waiting.discard(i)
        self.room.add_log(f"🔁 {self.nm(i)} gives {self.nm(low)} {len(cards)} card{'s' if k > 1 else ''}.")
        if not self.waiting:
            self.begin(min(range(self.n), key=lambda s: -self.ranks[s]))   # the Scum leads

    def begin(self, lead):
        self.stage = "play"
        self.to(lead)

    # -- play

    def top(self):
        return self.pile[-1][1] if self.pile else None

    def beats(self, cards):
        top = self.top()
        bomb = self.s.get("bomb") and len(cards) == 4
        if top is None:
            return True
        if bomb and not (len(top) == 4 and ORDER.index(rank(top[0])) >= ORDER.index(rank(cards[0]))):
            return True
        return len(cards) == len(top) and ORDER.index(rank(cards[0])) > ORDER.index(rank(top[0]))

    def options(self, i):
        """Every legal play: a list of card lists."""
        groups = {}
        for c in self.hands[i]:
            groups.setdefault(rank(c), []).append(c)
        top = self.top()
        sizes = [len(top)] if top else [1, 2, 3, 4]
        if top and self.s.get("bomb"):
            sizes = sorted({len(top), 4})
        out = []
        for r, cs in groups.items():
            for k in sizes:
                if len(cs) >= k and self.beats(cs[:k]):
                    out.append(cs[:k])
        return out

    def is_out(self, i):
        return False

    def active(self):
        return [k for k in range(self.n) if self.hands[k]]

    def do_play(self, i, cards):
        for c in cards:
            self.hands[i].remove(c)
        self.pile.append([i, cards])
        what = {1: "", 2: "a pair: ", 3: "three: ", 4: "four: "}[len(cards)]
        self.room.add_log(f"🂠 {self.nm(i)} plays {what}{show(cards)}")
        if not self.hands[i]:
            self.out_order.append(i)
            place = titles(self.n)[len(self.out_order) - 1]
            self.moment(f"{place.split()[0]} {self.nm(i)} is out: {' '.join(place.split()[1:])}!", "gold" if len(self.out_order) == 1 else "cool", "good")
            if len(self.active()) <= 1:
                self.out_order += self.active()
                return self.end_hand()
        bomb = self.s.get("bomb") and len(cards) == 4
        if bomb or self.nothing_beats(cards):
            if bomb:
                self.moment(f"💣 {self.nm(i)} clears the pile!", "bad", "boom")
            return self.clear(i)
        self.next_turn(i)

    def nothing_beats(self, cards):
        return ORDER.index(rank(cards[0])) == len(ORDER) - 1 and not self.s.get("bomb")

    def next_turn(self, i):
        for k in range(1, self.n + 1):
            j = (i + k) % self.n
            if j == self.pile[-1][0]:
                return self.clear(j)
            if self.hands[j] and j not in self.passed:
                return self.to(j)
        self.clear(self.pile[-1][0])

    def clear(self, w):
        self.pile = []
        self.passed = set()
        if self.hands[w]:
            self.room.add_log(f"🧹 Pile cleared. {self.nm(w)} leads.")
            return self.to(w)
        nxt = next((w + k) % self.n for k in range(1, self.n + 1) if self.hands[(w + k) % self.n])
        self.room.add_log(f"🧹 Pile cleared. {self.nm(nxt)} leads.")
        self.to(nxt)

    def do_pass(self, i):
        self.passed.add(i)
        self.room.add_log(f"✋ {self.nm(i)} passes.")
        self.next_turn(i)

    def end_hand(self):
        order = self.out_order
        was = self.ranks
        self.ranks = [0] * self.n
        names = titles(self.n)
        for place, k in enumerate(order):
            self.ranks[k] = place
            self.scores[k] += self.n - 1 - place
        pres = order[0]
        if was is not None and was[pres] == self.n - 1 and self.pl(pres):
            self.award(self.pl(pres), "coup")
        self.streak = [self.streak[k] + 1 if k == pres else 0 for k in range(self.n)]
        if self.streak[pres] == 3 and self.pl(pres):
            self.award(self.pl(pres), "reign")
        self.room.add_log("📜 " + " · ".join(f"{names[p].split()[0]} {self.nm(k)}" for p, k in enumerate(order)), "big")
        if self.hand_no >= self.s["hands"]:
            # ties go to whoever placed higher in the last hand
            best = max(range(self.n), key=lambda k: (self.scores[k], -self.ranks[k]))
            return self.room.finish(self.pl(best), f"🏆 {self.nm(best)} wins President with {self.scores[best]} points!")
        self.stage = "score"
        self.pause(self.deal, 4.0)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        cards = a.get("cards")
        ok_cards = isinstance(cards, list) and len(set(map(str, cards))) == len(cards) and all(c in self.hands[i] for c in cards)
        if t == "give":
            if self.stage != "swap" or i not in self.waiting:
                raise GameError("Nothing to give now.")
            k = next(p[2] for p in self.swaps if p[0] == i)
            if not ok_cards or len(cards) != k:
                raise GameError(f"Pick {k} card{'s' if k > 1 else ''} to give back.")
            return self.give_back(i, cards)
        if t == "play":
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait a moment.")
            if not ok_cards or not 1 <= len(cards) <= 4 or len({rank(c) for c in cards}) != 1:
                raise GameError("Play one to four cards of the same rank.")
            if not self.beats(cards):
                top = self.top()
                raise GameError(f"Beat the {show(top)} with {len(top)} higher card{'s' if len(top) > 1 else ''}.")
            return self.do_play(i, cards)
        if t == "pass":
            self.require_turn(p)
            if self.stage != "play" or not self.pile:
                raise GameError("You're leading: play something.")
            return self.do_pass(i)
        raise GameError("Unknown action.")

    # -- bots

    def bot_move(self, i, level):
        if self.stage == "swap":
            k = next(p[2] for p in self.swaps if p[0] == i)
            return self.give_back(i, self.junk(i, k, level))
        if self.stage != "play":
            return
        opts = self.options(i)
        if not opts:
            return self.do_pass(i)
        if level == "easy":
            if self.pile and random.random() < 0.2:
                return self.do_pass(i)
            return self.do_play(i, random.choice(opts) if random.random() < 0.4 else min(opts, key=lambda o: ORDER.index(rank(o[0]))))
        pick = self.choose(i, opts, level)
        return self.do_play(i, pick) if pick else self.do_pass(i)

    def junk(self, i, k, level):
        """The cards to give away: the lowest, preferring ones that don't break a set."""
        hand = self.hands[i]
        count = {}
        for c in hand:
            count[rank(c)] = count.get(rank(c), 0) + 1
        if level == "easy":
            return random.sample(hand, k)
        return sorted(hand, key=lambda c: (count[rank(c)] > 1, ORDER.index(rank(c))))[:k]

    def choose(self, i, opts, level):
        hand = self.hands[i]
        count = {}
        for c in hand:
            count[rank(c)] = count.get(rank(c), 0) + 1
        hi = lambda o: ORDER.index(rank(o[0]))
        # can I go out in two plays? then take the big play now
        groups = len(count)
        if groups <= 2:
            return max(opts, key=lambda o: (len(o) == count[rank(o[0])], hi(o)))
        if not self.pile:
            # lead the lowest whole set (getting rid of awkward low cards)
            whole = [o for o in opts if len(o) == count[rank(o[0])]]
            return min(whole or opts, key=lambda o: (hi(o), -len(o)))
        # follow: the lowest play that doesn't break a set; break one only when cheap
        clean = [o for o in opts if len(o) == count[rank(o[0])]]
        pick = min(clean, key=hi) if clean else None
        if pick is None:
            broken = min(opts, key=hi)
            pick = broken
        return pick

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i])} · {self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        names = titles(self.n)
        info = []
        for k in range(self.n):
            tags = []
            if k in self.out_order:
                tags.append(names[self.out_order.index(k)])
            elif self.ranks is not None:
                tags.append(names[self.ranks[k]].split()[0])
            if k in self.passed:
                tags.append("✋ passed")
            info.append({"count": len(self.hands[k]), "tags": tags, "out": k in self.out_order})
        top = self.top()
        piles = [{"cards": top or [], "fan": True, "label": (f"{self.nm(self.pile[-1][0])} · beat with {len(top)}" if top else "Empty: any lead")}]
        t = {"info": info, "piles": piles, "hand": self.hands[i] if i is not None else [],
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(self.n), key=lambda k: -self.scores[k])],
                        "hint": f"Hand {self.hand_no} of {self.s['hands']}. President scores {self.n - 1}, Scum 0."}}
        if i is None:
            return t
        if self.stage == "swap" and i in self.waiting:
            _, low, k = next(p for p in self.swaps if p[0] == i)
            junk = [c for c in sorted(self.hands[i], key=SORT) if c not in self.got.get(i, [])][:k]
            t["pick"] = {"act": "give", "min": k, "max": k, "label": f"Give {k} back"}
            t["note"] = (f"You got {show(self.got.get(i, []))} from {self.nm(low)}. Pick {k} card{'s' if k > 1 else ''} to give back"
                         f" (your weakest: {show(junk)}).")
            t["turnText"] = "🔁 Pick cards to give back"
        elif self.stage == "swap":
            t["note"] = "Waiting for the swap…"
        elif self.stage == "play" and self.room.turn == p.id:
            opts = self.options(i)
            need = len(top) if top and not self.s.get("bomb") else None
            t["pick"] = {"act": "play", "min": need or 1, "max": need or 4, "label": "Play", "same": True,
                         "from": sorted({c for o in opts for c in o}, key=SORT)}
            if self.pile:
                t["buttons"] = [{"label": "✋ Pass", "a": {"type": "pass"}}]
                t["note"] = f"Beat {show(top)} with {len(top)} higher, or pass."
            else:
                t["note"] = "Your lead: any single, pair, three or four."
            if self.got.get(i) and self.hand_no > 1 and not self.out_order and len(self.hands[i]) >= 52 // self.n - 1:
                t["note"] += f" (Swapped in: {show(self.got[i])})"
        return t
