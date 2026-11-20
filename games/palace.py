"""Palace (Karma): the three-row shedding game, for 2-6 players.

Everyone gets three cards face down, three face up on top of them, and a hand of three. Before play you
may swap hand cards with your face-up ones. On your turn play one or more cards of the same rank, equal
to or higher than the top of the pile (ace high), then draw back up to three while the stock lasts.
A 2 goes on anything and resets the pile; a 10 goes on anything and burns the pile away (as do four of a
rank in a row), and you go again. Can't play? Pick up the whole pile. With your hand and the stock gone,
play your face-up cards, then the face-down ones blind: if a blind card can't go, you pick up the pile
with it. First to get rid of every card wins."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show, rname

ORDER = "3456789JQKA"          # 2 and 10 are wild
SORT = lambda c: ("3456789JQKA2T".index(rank(c)), suit(c))


def strength(c):
    r = rank(c)
    return 20 if r == "T" else 15 if r == "2" else ORDER.index(r)


class Palace(CardGame):
    id = "palace"
    name = "Palace"
    icon = "🏰"
    blurb = "Shed your hand, then your face-up cards, then the blind ones. 2 resets, 10 burns, can't play? Take the pile."
    howto = [
        "Three cards face down, three face up on them, three in hand. First, swap hand cards with your face-ups if you like.",
        "Play one or more of a rank, equal or higher than the pile (ace high). Draw back up to three.",
        "2 goes on anything and resets. 10 goes on anything and burns the pile, as do four of a rank in a row: play again.",
        "Can't play? Pick up the whole pile.",
        "An 8 skips the next player (an option).",
        "Hand and stock gone: play your face-ups, then your face-downs blind. First with no cards wins.",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "blind": ("🙈", "Blind luck", "Win by playing your last face-down card")}
    settings_schema = {"seven": ("7s", [(False, "Normal"), (True, "🔻 7: the next player must play 7 or lower")], False),
                       "eight": ("8s", [(True, "⏭ 8 skips the next player"), (False, "Normal")], True)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck(copies=2 if self.n > 4 else 1)
        rng.shuffle(cards)
        self.down = [cards[k * 9:k * 9 + 3] for k in range(self.n)]
        self.up = [sorted(cards[k * 9 + 3:k * 9 + 6], key=SORT) for k in range(self.n)]
        self.hands = [sorted(cards[k * 9 + 6:k * 9 + 9], key=SORT) for k in range(self.n)]
        self.stock = cards[self.n * 9:]
        self.pile = []
        self.burned = 0
        self.flash = None
        self.room.add_log("🏰 Palace: swap your face-up cards, then shed everything. 2 resets, 10 burns.", "big")
        self.stage = "swap"
        self.open_all(range(self.n), secs=40)

    # -- the swap

    def swap(self, i, h, u):
        self.hands[i][self.hands[i].index(h)] = u
        self.up[i][self.up[i].index(u)] = h
        self.hands[i].sort(key=SORT)
        self.up[i].sort(key=SORT)

    def ready(self, i):
        self.waiting.discard(i)
        if not self.waiting:
            self.stage = "play"
            first = min(range(self.n), key=lambda k: (min(SORT(c) for c in self.hands[k]), k))
            self.room.add_log(f"{self.nm(first)} has the lowest card and starts.")
            self.to(first)

    # -- play

    def source(self, i):
        if self.hands[i]:
            return "hand"
        if self.up[i]:
            return "up"
        return "down" if self.down[i] else None

    def top(self):
        for c in reversed(self.pile):
            return c
        return None

    def ok(self, c):
        top = self.top()
        if top is None or rank(c) in "2T":
            return True
        if self.s.get("seven") and rank(top) == "7":
            return strength(c) <= ORDER.index("7")
        if rank(top) == "2":
            return True
        return strength(c) >= strength(top)

    def playable(self, i):
        src = self.source(i)
        cards = self.hands[i] if src == "hand" else self.up[i] if src == "up" else []
        return [c for c in cards if self.ok(c)]

    def play(self, i, cards, blind=False):
        src = self.source(i)
        if not blind:
            for c in cards:
                (self.hands[i] if src == "hand" else self.up[i]).remove(c)
        self.pile += cards
        self.room.add_log(f"🃏 {self.nm(i)} plays {show(cards)}" + (" blind" if blind else "") + ".")
        while len(self.hands[i]) < 3 and self.stock:
            self.hands[i].append(self.stock.pop())
        self.hands[i].sort(key=SORT)
        r = rank(cards[0])
        four = len(self.pile) >= 4 and len({rank(c) for c in self.pile[-4:]}) == 1
        if not (self.hands[i] or self.up[i] or self.down[i]):
            if blind and self.pl(i):
                self.award(self.pl(i), "blind")
            return self.room.finish(self.pl(i), f"🏆 {self.nm(i)} plays their last card and wins Palace!")
        if r == "T" or four:
            self.burned += len(self.pile)
            self.pile = []
            self.flash = "🔥"
            self.moment(f"🔥 {self.nm(i)} burns the pile!", "bad", "boom")
            return self.to(i)                     # and goes again
        self.flash = "↺" if r == "2" else None
        nxt = self.next_seat(i)
        if r == "8" and self.s.get("eight", True):
            self.moment(f"⏭ {self.nm(i)}'s 8 skips {self.nm(nxt)}!", "good", "good")
            nxt = self.next_seat(nxt)             # in a 2-player game that is the 8 player again
            self.flash = "⏭"
        self.to(nxt)

    def pick_up(self, i, extra=()):
        got = self.pile + list(extra)
        self.hands[i] += got
        self.hands[i].sort(key=SORT)
        self.pile = []
        self.flash = None
        self.room.add_log(f"😩 {self.nm(i)} picks up the pile ({len(got)} card{'s' if len(got) != 1 else ''}).", "power")
        self.to(self.next_seat(i))

    def blind(self, i, k):
        c = self.down[i].pop(k)
        if self.ok(c):
            return self.play(i, [c], blind=True)
        self.room.add_log(f"🙈 {self.nm(i)} turns up {pretty(c)}: it doesn't go!", "power")
        self.pick_up(i, [c])

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        if self.stage == "swap":
            if i not in self.waiting:
                raise GameError("You're ready.")
            if t == "swap":
                h, u = a.get("hand"), a.get("up")
                if h not in self.hands[i] or u not in self.up[i]:
                    raise GameError("Pick a hand card and a face-up card.")
                return self.swap(i, h, u)
            if t == "go":
                return self.ready(i)
            raise GameError("Swap cards or say you're ready.")
        self.require_turn(p)
        if t == "play":
            cards = a.get("cards")
            src = self.source(i)
            pool = self.hands[i] if src == "hand" else self.up[i] if src == "up" else []
            if (not isinstance(cards, list) or not cards or len(set(map(str, cards))) != len(cards)
                    or any(pool.count(c) < cards.count(c) for c in cards) or len({rank(c) for c in cards}) != 1):
                raise GameError("Play one or more cards of the same rank" + (" from your hand." if src == "hand" else " from your face-up cards."))
            if not self.ok(cards[0]):
                raise GameError(f"Play a {'7 or lower' if self.s.get('seven') and rank(self.top()) == '7' else 'card as high as the ' + pretty(self.top())}, a 2 or a 10.")
            return self.play(i, cards)
        if t == "blind":
            k = a.get("k")
            if self.source(i) != "down" or not isinstance(k, int) or not 0 <= k < len(self.down[i]):
                raise GameError("Not yet.")
            return self.blind(i, k)
        if t == "take":
            if not self.pile:
                raise GameError("The pile is empty: play anything.")
            if self.playable(i):
                raise GameError("You can play, so you must.")
            return self.pick_up(i)
        raise GameError("Unknown action.")

    # -- bots

    def bot_move(self, i, level):
        if self.stage == "swap":
            if level != "easy":
                for _ in range(3):
                    lo_up = min(self.up[i], key=strength)
                    hi_h = max(self.hands[i], key=strength)
                    if strength(hi_h) > strength(lo_up):
                        self.swap(i, hi_h, lo_up)
            return self.ready(i)
        src = self.source(i)
        if src == "down":
            return self.blind(i, random.randrange(len(self.down[i])))
        opts = self.playable(i)
        if not opts:
            return self.pick_up(i)
        if level == "easy":
            c = random.choice(opts)
        else:
            plain = [c for c in opts if rank(c) not in "2T"]
            nxt = self.next_seat(i)
            if plain and level == "hard" and self.s.get("eight", True) and nxt != i and any(rank(x) == "8" for x in plain) \
                    and len(self.hands[nxt]) + len(self.up[nxt]) + len(self.down[nxt]) <= 4:
                c = next(x for x in plain if rank(x) == "8")      # skip a player who is close to out
            elif plain:
                c = min(plain, key=strength)
            elif level == "hard" and len(self.pile) >= 6 and any(rank(x) == "T" for x in opts):
                c = next(x for x in opts if rank(x) == "T")
            else:
                c = min(opts, key=strength)
            if level == "hard" and rank(c) not in "2T" and strength(c) >= ORDER.index("K") and len(self.pile) <= 2 and src == "hand" and self.stock \
                    and any(rank(x) == "2" for x in opts):
                c = next(x for x in opts if rank(x) == "2")
        pool = self.hands[i] if src == "hand" else self.up[i]
        same = [x for x in pool if rank(x) == rank(c)]
        n = len(same) if level != "easy" else random.randint(1, len(same))
        self.play(i, same[:n])

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i]) + len(self.up[i]) + len(self.down[i])}"

    def final_scores(self):
        return {pid: -(len(self.hands[k]) + len(self.up[k]) + len(self.down[k])) for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "show": self.up[k], "tags": [f"🂠 {len(self.down[k])} down"]} for k in range(self.n)]
        top = self.pile[-3:]
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Stock", "corner": True},
                       {"cards": top, "fan": True, "count": len(self.pile) or None,
                        "label": ("↺ reset by a 2" if self.flash == "↺" and self.pile else
                                  f"⏭ 8 skipped a player: play {pretty(self.top())} or higher" if self.flash == "⏭" and self.pile else
                                  f"Play {pretty(self.top())} or higher" if self.pile else "🔥 Burned: play anything" if self.flash == "🔥" else "Empty: play anything")}],
             "scores": {"title": "Cards left", "rows": [{"seat": k, "value": len(self.hands[k]) + len(self.up[k]) + len(self.down[k])}
                                                        for k in sorted(range(self.n), key=lambda k: len(self.hands[k]) + len(self.up[k]) + len(self.down[k]))],
                        "hint": f"2 resets · 10 burns · {self.burned} burned so far."}}
        if i is None:
            return t
        t["rows"] = [{"label": "Face up", "cards": self.up[i]}, {"label": "Face down", "cards": ["??"] * len(self.down[i]), "keys": [f"d{k}" for k in range(len(self.down[i]))]}]
        if self.stage == "swap":
            if i in self.waiting:
                t["moves"] = [{"card": h, "label": f"Swap for {pretty(u)}", "a": {"type": "swap", "hand": h, "up": u}} for h in self.hands[i] for u in self.up[i]]
                t["buttons"] = [{"label": "✓ Ready", "a": {"type": "go"}, "kind": "primary"}]
                t["note"] = "Tap a hand card to swap it with a face-up card (good cards face up!), then Ready."
                t["turnText"] = "🔁 Swap, then Ready"
            return t
        if self.room.turn != p.id:
            return t
        src = self.source(i)
        if src == "down":
            t["moves"] = [{"card": f"d{k}", "a": {"type": "blind", "k": k}} for k in range(len(self.down[i]))]
            t["note"] = "Your face-down cards: tap one, blind!"
            t["turnText"] = "🙈 Play blind"
            return t
        opts = self.playable(i)
        if opts:
            t["pick"] = {"act": "play", "min": 1, "max": 8, "label": "Play", "same": True, "from": opts}
            t["note"] = "Play one or more of a rank" + (" from your face-up cards." if src == "up" else ".")
        else:
            t["buttons"] = [{"label": f"😩 Pick up the pile ({len(self.pile)})", "a": {"type": "take"}, "kind": "primary"}]
            t["note"] = "Nothing goes: pick up the pile."
        return t
