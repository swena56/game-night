"""Go Fish: ask for cards and collect books of four, for 2-6 players.

Seven cards each (five with four or more players), the rest a face-down pond. On your turn ask any one
player for a rank you hold. If they have any, they hand them all over and you go again. If not: go
fish! Draw from the pond; if it's the rank you asked for, show it and go again. Four of a rank make a
book, laid down at once. Run out of cards and you draw five more. When all thirteen books are down,
most books wins.

📝 Table notes (default on): under each rival you see the ranks everyone has watched them ask for or take and
not yet give up or lay down as a book (only public history). 🔥 Three asks in a row that bring cards in is a streak."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, rname, by_suit

ORDER = "A23456789TJQK"
SORT = by_suit(ORDER, "CDHS")
SORT = lambda c: (ORDER.index(rank(c)), suit(c))


class GoFish(CardGame):
    id = "gofish"
    solo_bots = 2
    name = "Go Fish"
    icon = "🐟"
    blurb = "Ask for the cards you need, remember who has what, and collect books of four. Go fish!"
    howto = [
        "Seven cards each (five with four or more players). On your turn ask a player for a rank you hold.",
        "They hand over every card of that rank, and you go again.",
        "If they have none: 🐟 go fish! Draw from the pond; draw the rank you asked for and you go again.",
        "Four of a rank make a book. Most books when all thirteen are down wins.",
        "📝 Table notes show publicly known ranks. Your memory panel lists ranks rivals asked for or denied earlier in this hand. 🔥 Three good asks in a row is a streak.",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "haul": ("🎣", "Big haul", "Get three cards in one ask"), "streak": ("🔥", "Hot streak", "Three successful asks in a row")}
    settings_schema = {"notes": ("📝 Table notes", [(True, "On: show who's known to hold what"), (False, "Off: pure memory")], True)}
    streak = None  # games saved before 🔥 have none

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck()
        rng.shuffle(cards)
        per = 7 if self.n <= 3 else 5
        self.hands = [sorted(cards[k * per:(k + 1) * per], key=SORT) for k in range(self.n)]
        self.pond = cards[self.n * per:]
        self.books = [[] for _ in range(self.n)]
        self.known = [set() for _ in range(self.n)]     # ranks everyone saw each player ask for or receive
        self.asked = [set() for _ in range(self.n)]
        self.denied = [set() for _ in range(self.n)]
        self.last = None
        self.streak = [0] * self.n
        self.room.add_log("🐟 Go Fish: ask for what you need. Books of four score.", "big")
        for k in range(self.n):
            self.check_books(k)
        self.stage = "ask"
        self.to(rng.randrange(self.n))

    def check_books(self, i):
        count = {}
        for c in self.hands[i]:
            count[rank(c)] = count.get(rank(c), 0) + 1
        for r, n in count.items():
            if n == 4:
                self.hands[i] = [c for c in self.hands[i] if rank(c) != r]
                self.books[i].append(r)
                self.known[i].discard(r)
                self.room.add_log(f"📚 {self.nm(i)} lays down a book of {rname(r)}!", "power")

    def refill(self, i):
        if not self.hands[i] and self.pond:
            take = self.pond[:5]
            self.pond = self.pond[5:]
            self.hands[i] = sorted(take, key=SORT)
            self.check_books(i)

    def done(self):
        return sum(len(b) for b in self.books) == 13

    def ask(self, i, j, r):
        got = [c for c in self.hands[j] if rank(c) == r]
        self.known[i].add(r)
        if not hasattr(self, "asked"):
            self.asked = [set() for _ in range(self.n)]
            self.denied = [set() for _ in range(self.n)]
        self.asked[i].add(r)
        if not got:
            self.denied[j].add(r)
        if got:
            self.hands[j] = [c for c in self.hands[j] if rank(c) != r]
            self.known[j].discard(r)
            self.hands[i] = sorted(self.hands[i] + got, key=SORT)
            self.last = {"seat": i, "from": j, "rank": r, "got": len(got)}
            self.room.add_log(f"🙋 {self.nm(i)} asks {self.nm(j)} for {rname(r)}: gets {len(got)}!")
            if len(got) >= 3 and self.pl(i):
                self.award(self.pl(i), "haul")
            if self.streak:
                self.streak[i] += 1
                if self.streak[i] == 3:
                    self.moment(f"🔥 {self.nm(i)} is on a streak!", "gold", "fanfare")
                    if self.pl(i):
                        self.award(self.pl(i), "streak")
            self.check_books(i)
            self.refill(i)
            self.refill(j)
            return self.after_ask(i, again=True)
        self.room.add_log(f"🙋 {self.nm(i)} asks {self.nm(j)} for {rname(r)}: 🐟 Go fish!")
        self.last = {"seat": i, "from": j, "rank": r, "got": 0}
        if self.streak:
            self.streak[i] = 0
        again = False
        if self.pond:
            c = self.pond.pop()
            self.hands[i] = sorted(self.hands[i] + [c], key=SORT)
            if rank(c) == r:
                again = True
                self.room.add_log(f"🎣 {self.nm(i)} fishes up the {rname(r, 1)} and goes again!")
                self.last["fished"] = True
            self.check_books(i)
        self.refill(i)
        self.after_ask(i, again)

    def after_ask(self, i, again):
        if self.done():
            return self.win_by_score([len(b) for b in self.books], what="books")
        if again and self.hands[i]:
            return self.to(i)
        nxt = i
        for _ in range(self.n):
            nxt = (nxt + 1) % self.n
            self.refill(nxt)
            if self.hands[nxt]:
                return self.to(nxt)
        return self.win_by_score([len(b) for b in self.books], what="books")

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        if a.get("type") != "ask":
            raise GameError("Unknown action.")
        j, r = a.get("who"), a.get("rank")
        if not isinstance(j, int) or not 0 <= j < self.n or j == i or not self.hands[j]:
            raise GameError("Ask a player who still has cards.")
        if r not in [rank(c) for c in self.hands[i]]:
            raise GameError("You can only ask for a rank you hold.")
        self.ask(i, j, r)

    # -- bots

    def bot_move(self, i, level):
        others = [k for k in range(self.n) if k != i and self.hands[k]]
        if not others:
            return self.after_ask(i, False)
        mine = {}
        for c in self.hands[i]:
            mine[rank(c)] = mine.get(rank(c), 0) + 1
        if level != "easy":
            # someone known to hold a rank I have: ask them (hard remembers everything, normal only the latest)
            mem = self.known if level == "hard" else [({self.last["rank"]} if self.last and self.last["seat"] == k and not self.last["got"] else set()) for k in range(self.n)]
            hits = [(mine[r], k, r) for k in others for r in mem[k] if r in mine]
            if hits:
                _, k, r = max(hits)
                return self.ask(i, k, r)
        r = max(mine, key=lambda r: (mine[r], random.random())) if level != "easy" else random.choice(list(mine))
        k = max(others, key=lambda k: (len(self.hands[k]), random.random())) if level == "hard" else random.choice(others)
        self.ask(i, k, r)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"📚 {len(self.books[i])}"

    def final_scores(self):
        return {pid: len(self.books[k]) for k, pid in enumerate(self.seats)}

    def notes(self, k):
        """📝 ranks everyone has seen player k ask for or take and not yet lose (public history only)."""
        return sorted(self.known[k], key=ORDER.index)

    def table(self, p, i):
        show = self.s.get("notes", True)
        info = [{"count": len(self.hands[k]),
                 "tags": [f"📚 {len(self.books[k])}"] + ([f"📝 {' '.join('10' if r == 'T' else r for r in self.notes(k))}"] if show and k != i and self.notes(k) else []),
                 "show": [r + "S" for r in self.books[k]][-6:]} for k in range(self.n)]
        lst = self.last
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": ["??"] if self.pond else [], "count": len(self.pond), "label": "🐟 The pond"}],
             "banner": (f"{self.nm(lst['seat'])} → {self.nm(lst['from'])}: {rname(lst['rank'])}? " + (f"Got {lst['got']}!" if lst["got"] else "Go fish! 🐟")) if lst else None,
             "scores": {"title": "Books", "rows": [{"seat": k, "value": len(self.books[k])} for k in sorted(range(self.n), key=lambda k: -len(self.books[k]))],
                        "hint": f"{13 - sum(len(b) for b in self.books)} books still out there."}}
        if show and i is not None and hasattr(self, "asked"):
            t["memory"] = [{"seat": k, "asked": sorted(self.asked[k], key=ORDER.index),
                            "denied": sorted(self.denied[k], key=ORDER.index)}
                           for k in range(self.n) if k != i and (self.asked[k] or self.denied[k])]
        if i is not None and self.room.turn == p.id:
            others = [k for k in range(self.n) if k != i and self.hands[k]]
            t["moves"] = [{"card": c, "label": f"Ask {self.nm(k)} for {rname(rank(c))}", "a": {"type": "ask", "who": k, "rank": rank(c)}}
                          for c in self.hands[i] for k in others]
            t["note"] = "Tap a card, then pick who to ask for that rank."
            t["turnText"] = "🙋 Ask someone"
        return t
