"""Old Maid: pair up and pass on the odd queen, for 2-6 players.

One queen is taken out, so its partner can never pair: that's the Old Maid. All the cards are dealt
and everyone puts down their pairs. Then in turn you draw a card, unseen, from the player on your left
and put down any pair it makes. Get rid of all your cards and you're safe; whoever is left holding the
Old Maid loses. The first player out wins.

🔍 Peek (default: once a game each): on your turn, before you draw, flip one random card of your neighbour's
face-up for yourself only. It stays on that spot until you draw; nobody else sees it, and the log only says that
you peeked."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, rname

ORDER = "A23456789TJQK"
SORT = lambda c: (ORDER.index(rank(c)), suit(c))


class OldMaid(CardGame):
    id = "oldmaid"
    name = "Old Maid"
    icon = "👵"
    blurb = "Pair up your cards and pass the odd queen along. Don't be left holding the Old Maid!"
    howto = [
        "One queen is removed, so one queen can never pair: the Old Maid.",
        "Put down your pairs. Then take turns drawing a hidden card from the player on your left, pairing what you can.",
        "Empty your hand and you're safe. The first out wins; whoever is stuck with the Old Maid loses.",
        "🔍 Once a game, press Peek before you draw to see one random card of your neighbour's, just for you. It stays put until you draw.",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "dodge": ("🫣", "Dodged her", "Pass the Old Maid on and still go out first"),
              "sidestep": ("👀", "Sidestep", "Peek at the Old Maid and leave her alone")}
    settings_schema = {"peek": ("🔍 Peek", [(1, "Once a game"), (0, "Off")], 1)}
    peeks = None   # games saved before 🔍 have none
    peek = None    # (seat, neighbour, index, card) while that player is deciding

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck()
        cards.remove("QC")
        rng.shuffle(cards)
        self.maid = "QS"
        self.hands = [sorted(cards[k::self.n], key=SORT) for k in range(self.n)]
        self.out = []
        self.had = [False] * self.n
        self.last = None
        self.peeks = [self.s.get("peek", 1)] * self.n
        self.peek = None
        self.room.add_log("👵 Old Maid: one queen has no partner. Don't get stuck with her!", "big")
        for k in range(self.n):
            self.pair_off(k, quiet=True)
            self.had[k] = self.maid in self.hands[k]
        self.stage = "draw"
        live = [k for k in range(self.n) if self.hands[k]]
        self.to(self.rng.choice(live))

    def pair_off(self, i, quiet=False):
        count = {}
        for c in self.hands[i]:
            count.setdefault(rank(c), []).append(c)
        made = 0
        for r, cs in count.items():
            while len(cs) >= 2:
                a, b = cs.pop(), cs.pop()
                self.hands[i].remove(a)
                self.hands[i].remove(b)
                made += 1
        if made and not quiet:
            self.room.add_log(f"🃏 {self.nm(i)} puts down a pair.")
        return made

    def is_out(self, i):
        return not self.hands[i]

    def source(self, i):
        """The player to draw from: the next on the left with cards."""
        for k in range(1, self.n):
            j = (i + k) % self.n
            if self.hands[j]:
                return j
        return None

    def can_peek(self, i):
        j = self.source(i)
        return bool(self.peeks and self.peeks[i] > 0 and not self.peek and j is not None and self.hands[j])

    def do_peek(self, i):
        j = self.source(i)
        k = self.rng.randrange(len(self.hands[j]))
        self.peeks[i] -= 1
        self.peek = (i, j, k, self.hands[j][k])
        self.room.add_log(f"🔍 {self.nm(i)} peeks at one of {self.nm(j)}'s cards.")

    def draw(self, i, k):
        j = self.source(i)
        c = self.hands[j].pop(k)
        if self.peek and self.peek[0] == i and self.peek[3] == self.maid and c != self.maid and self.pl(i):
            self.award(self.pl(i), "sidestep")   # peeked the Old Maid and left her alone
        self.peek = None
        self.rng.shuffle(self.hands[j])
        self.hands[i].append(c)
        self.hands[i].sort(key=SORT)
        self.last = {"seat": i, "from": j}
        self.room.add_log(f"🤏 {self.nm(i)} draws from {self.nm(j)}.")
        if c == self.maid:
            self.had[i] = True
        self.pair_off(i)
        for x in (i, j):
            if not self.hands[x] and x not in self.out:
                self.out.append(x)
                if len(self.out) == 1:
                    if self.had[x] and self.pl(x):
                        self.award(self.pl(x), "dodge")
                    self.moment(f"🎉 {self.nm(x)} is out first!", "gold", "fanfare")
                else:
                    self.room.add_log(f"😌 {self.nm(x)} is out.")
        live = [x for x in range(self.n) if self.hands[x]]
        if len(live) <= 1:
            loser = live[0] if live else None
            if loser is not None:
                self.room.add_log(f"👵 {self.nm(loser)} is left holding the Old Maid!", "big")
            w = self.out[0]
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} went out first and wins Old Maid!" + (f" ({self.nm(loser)} got the Old Maid.)" if loser is not None else ""))
        self.to(self.next_seat(i))

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        if a.get("type") == "peek":
            if not self.can_peek(i):
                raise GameError("No peek left, or you've already peeked this turn.")
            return self.do_peek(i)
        if a.get("type") != "draw":
            raise GameError("Unknown action.")
        k = a.get("k")
        j = self.source(i)
        if j is None or not isinstance(k, int) or not 0 <= k < len(self.hands[j]):
            raise GameError("Pick one of their cards.")
        self.draw(i, k)

    def bot_move(self, i, level):
        j = self.source(i)
        k = random.randrange(len(self.hands[j]))
        # 🔍 normal and hard bots peek sometimes, and then won't take the Old Maid when there's another card to take
        if level != "easy" and self.can_peek(i) and random.random() < (0.7 if level == "hard" else 0.4):
            self.do_peek(i)
            k = self.peek[2]
            if self.peek[3] == self.maid and len(self.hands[j]) > 1:
                k = random.choice([x for x in range(len(self.hands[j])) if x != k])
        self.draw(i, k)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else ("😌 out" if not self.hands[i] else f"🎴 {len(self.hands[i])}")

    def final_scores(self):
        return {pid: (self.n - self.out.index(k)) if k in self.out else 0 for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "out": not self.hands[k], "tags": [f"#{self.out.index(k) + 1} out"] if k in self.out else []} for k in range(self.n)]
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "banner": f"{self.nm(self.last['seat'])} drew from {self.nm(self.last['from'])}" if self.last else None,
             "scores": {"title": "Cards", "rows": [{"seat": k, "value": len(self.hands[k]) if self.hands[k] else "out"} for k in sorted(range(self.n), key=lambda k: len(self.hands[k]))],
                        "hint": "The queen of spades has no partner."}}
        if i is not None and self.room.turn == p.id and self.hands[i]:
            j = self.source(i)
            seen = self.peek[2] if self.peek and self.peek[0] == i else None   # 🔍 only you, only this turn
            t["rows"] = [{"label": f"{self.nm(j)}'s", "cards": [self.peek[3] if k == seen else "??" for k in range(len(self.hands[j]))],
                          "keys": [f"o{k}" for k in range(len(self.hands[j]))]}]
            t["moves"] = [{"card": f"o{k}", "a": {"type": "draw", "k": k}} for k in range(len(self.hands[j]))]
            t["note"] = f"Draw one of {self.nm(j)}'s cards."
            if seen is not None:
                t["note"] = f"🔍 You peeked: their card #{seen + 1} is {pretty(self.peek[3])}" + (" — the Old Maid!" if self.peek[3] == self.maid else ".")
            elif self.can_peek(i):
                t["buttons"] = [{"label": f"🔍 Peek ({self.peeks[i]} left)", "a": {"type": "peek"}}]
            t["turnText"] = f"🤏 Draw from {self.nm(j)}"
        return t
