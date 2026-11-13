"""Mao: a shedding game with secret rules you only learn from the penalties. For 2-6 players.

This is our own take on the folk game. Seven cards each. Play a card matching the top card's suit or
rank, or draw one. Aces skip the next player, eights reverse the direction, and a jack lets you name
the next suit. The secret part: each game, three "say it" rules are drawn from a hidden list (say
"Spades" when you play a spade, "Have a nice day" on a seven, …). After playing you may say things;
miss a rule, or say something you didn't need to, and you draw a penalty card, with the reason given
out loud. Everyone always must say "Mao" when down to one card. First to empty their hand wins."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show, SUIT_NAME

PHRASES = {
    "spades": ("♠️ Spades", "playing a spade", lambda c, prev: suit(c) == "S"),
    "nice": ("🌞 Have a nice day", "playing a seven", lambda c, prev: rank(c) == "7"),
    "king": ("👑 All hail the king", "playing a king", lambda c, prev: rank(c) == "K"),
    "pair": ("👯 Pair", "matching the rank", lambda c, prev: prev is not None and rank(c) == rank(prev)),
    "hearts": ("💘 I love you", "playing a heart", lambda c, prev: suit(c) == "H"),
    "queen": ("💃 Long live the queen", "playing a queen", lambda c, prev: rank(c) == "Q"),
}
SAYS = ["spades", "nice", "king", "pair", "hearts", "queen", "mao"]


class Mao(CardGame):
    id = "mao"
    name = "Mao"
    icon = "🤐"
    blurb = "Shed your cards, but the rules are secret: learn them from the penalties, and say the right things."
    howto = [
        "Match the top card's suit or rank, or draw one. A skips the next player, 8 reverses, J names the next suit.",
        "Three secret \"say it\" rules are in play each game. After playing, say what you think the card needs.",
        "Miss a rule, or say something you didn't need to: draw a penalty card. The reason is announced.",
        "Down to one card? Always say \"Mao\".",
        "First to empty their hand wins.",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "clean": ("😇", "Clean sheet", "Win without a single penalty")}
    settings_schema = {"secret": ("Secret rules", [(3, "Three"), (2, "Two (gentler)"), (4, "Four")], 3)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.rules = rng.sample(list(PHRASES), self.s.get("secret", 3))
        cards = deck()
        rng.shuffle(cards)
        self.hands = [sorted(cards[k * 7:(k + 1) * 7], key=self.key) for k in range(self.n)]
        self.stock = cards[self.n * 7:]
        self.pile = [self.stock.pop()]
        self.want_suit = None
        self.dir = 1
        self.said = set()
        self.pens = [0] * self.n
        self.learned = [set() for _ in range(self.n)]     # rules each seat has seen penalised
        self.last = None
        self.played = None
        self.room.add_log("🤐 Mao. There are secret rules. Penalties will tell you what they are.", "big")
        self.stage = "play"
        self.to(rng.randrange(self.n))

    def key(self, c):
        return ("CDHS".index(suit(c)), "A23456789TJQK".index(rank(c)))

    def top(self):
        return self.pile[-1]

    def fits(self, c):
        t = self.top()
        s = self.want_suit or suit(t)
        return suit(c) == s or (rank(c) == rank(t) and not self.want_suit) or rank(c) == "J"

    def nxt(self, i, skip=0):
        k = i
        for _ in range(1 + skip):
            k = (k + self.dir) % self.n
        return k

    def draw(self, i, n=1):
        for _ in range(n):
            if not self.stock:
                if len(self.pile) <= 1:
                    return
                keep = self.pile[-1]
                self.stock = self.pile[:-1]
                self.pile = [keep]
                self.rng.shuffle(self.stock)
            self.hands[i].append(self.stock.pop())
        self.hands[i].sort(key=self.key)

    def penalty(self, i, why, rule=None):
        self.pens[i] += 1
        self.draw(i)
        self.room.add_log(f"🚨 {self.nm(i)}: penalty card for {why}.", "power")
        self.moment(f"🚨 {self.nm(i)}: {why}!", "bad", "boom")
        if rule:
            for k in range(self.n):
                lvl = self.level(k)
                if self.pl(k) is None or self.auto(k):
                    if random.random() < {"hard": 1, "normal": 0.75, "easy": 0.4}.get(lvl, 1):
                        self.learned[k].add(rule)
                else:
                    self.learned[k].add(rule)

    # -- turn

    def play(self, i, c):
        prev = self.top()
        self.hands[i].remove(c)
        self.pile.append(c)
        self.want_suit = None
        self.played = {"card": c, "prev": prev, "seat": i}
        self.said = set()
        self.room.add_log(f"{self.nm(i)} plays {pretty(c)}.")
        self.stage = "say" if rank(c) != "J" else "suit"
        self.to(i)

    def name_suit(self, i, s):
        self.want_suit = s
        self.room.add_log(f"🃏 {self.nm(i)} names {SUIT_NAME[s]}.")
        self.stage = "say"
        self.to(i)

    def needed(self, i):
        c, prev = self.played["card"], self.played["prev"]
        need = {r for r in self.rules if PHRASES[r][2](c, prev)}
        if len(self.hands[i]) == 1:
            need.add("mao")
        return need

    def done(self, i):
        need = self.needed(i)
        for r in sorted(need - self.said):
            if r == "mao":
                self.penalty(i, "failure to say \"Mao\"", "mao")
            else:
                self.penalty(i, f"failure to say \"{PHRASES[r][0].split(' ', 1)[1]}\" when {PHRASES[r][1]}", r)
        extra = self.said - need
        if extra:
            self.penalty(i, "talking", None)
        if self.said:
            self.room.add_log(f"🗣️ {self.nm(i)}: " + ", ".join("Mao" if r == "mao" else PHRASES[r][0].split(" ", 1)[1] for r in sorted(self.said)) + ".")
        self.last = {"seat": i, "card": self.played["card"], "said": sorted(self.said)}
        if not self.hands[i]:
            if not self.pens[i] and self.pl(i):
                self.award(self.pl(i), "clean")
            return self.room.finish(self.pl(i), f"🏆 {self.nm(i)} empties their hand and wins Mao! The secret rules: " +
                                    ", ".join(f"\"{PHRASES[r][0].split(' ', 1)[1]}\" for {PHRASES[r][1]}" for r in self.rules) + ".")
        c = self.played["card"]
        skip = 0
        if rank(c) == "8" and self.n > 2:
            self.dir = -self.dir
            self.room.add_log("🔁 Direction reverses.")
        if rank(c) == "A" or (rank(c) == "8" and self.n == 2):
            skip = 1
            self.room.add_log(f"⏭️ {self.nm(self.nxt(i))} is skipped.")
        self.stage = "play"
        self.said = set()
        self.to(self.nxt(i, skip))

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        if self.stage == "play":
            if t == "draw":
                self.draw(i)
                self.room.add_log(f"{self.nm(i)} draws.")
                return self.to(self.nxt(i))
            if t == "play":
                c = a.get("card")
                if c not in self.hands[i]:
                    raise GameError("That card isn't in your hand.")
                if not self.fits(c):
                    # a wrong card is itself a penalty, and it goes back to your hand
                    self.penalty(i, f"a card that doesn't match ({pretty(c)})")
                    return self.to(self.nxt(i))
                return self.play(i, c)
        if self.stage == "suit" and t == "suit" and a.get("suit") in ("C", "D", "H", "S"):
            return self.name_suit(i, a["suit"])
        if self.stage == "say":
            if t == "say" and a.get("what") in SAYS:
                w = a["what"]
                self.said ^= {w}
                return
            if t == "done":
                return self.done(i)
        raise GameError("Not now.")

    # -- bot

    def bot_move(self, i, level):
        if self.stage == "play":
            ok = [c for c in self.hands[i] if self.fits(c)]
            if not ok:
                self.draw(i)
                self.room.add_log(f"{self.nm(i)} draws.")
                return self.to(self.nxt(i))
            if level == "easy":
                return self.play(i, random.choice(ok))
            # keep jacks for when stuck; prefer cards that dodge the rules we don't know yet
            plain = [c for c in ok if rank(c) != "J"] or ok
            return self.play(i, max(plain, key=lambda c: ("CDHS".index(suit(c)) == 0, sum(1 for x in self.hands[i] if suit(x) == suit(c)), random.random())))
        if self.stage == "suit":
            count = {}
            for c in self.hands[i]:
                count[suit(c)] = count.get(suit(c), 0) + 1
            return self.name_suit(i, max(count, key=count.get) if count else "S")
        if self.stage == "say":
            know = self.learned[i] | ({"mao"} if level != "easy" or random.random() < 0.85 else set())
            self.said = self.needed(i) & know
            return self.done(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i])}"

    def final_scores(self):
        return {pid: -len(self.hands[k]) for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": [f"🚨 {self.pens[k]}"] if self.pens[k] else []} for k in range(self.n)]
        top = self.top()
        lst = self.last
        t = {"info": info, "hand": self.hands[i] if i is not None else [],
             "piles": [{"cards": ["??"] if self.stock else [], "count": len(self.stock), "label": "Stock"},
                       {"cards": [top], "count": len(self.pile), "label": f"Named: {SUIT_NAME[self.want_suit]}" if self.want_suit else "Pile"}],
             "banner": (f"{self.nm(lst['seat'])} said: " + (", ".join("Mao" if r == "mao" else PHRASES[r][0] for r in lst["said"]) or "nothing")) if lst else None,
             "scores": {"title": "Cards", "rows": [{"seat": k, "value": len(self.hands[k]), "sub": f"{self.pens[k]} penalties" if self.pens[k] else ""} for k in sorted(range(self.n), key=lambda k: len(self.hands[k]))],
                        "hint": f"{len(self.rules)} secret rules in play. {'→' if self.dir == 1 else '←'} direction."}}
        if i is None or self.room.turn != p.id:
            return t
        if self.stage == "play":
            t["moves"] = [{"card": c, "a": {"type": "play", "card": c}} for c in self.hands[i]]
            t["buttons"] = [{"label": "🂠 Draw", "a": {"type": "draw"}}]
            t["note"] = "Match suit or rank (J names a suit). A wrong card costs a penalty."
            t["turnText"] = "🤐 Your turn"
        elif self.stage == "suit":
            t["buttons"] = [{"label": f"{g} {SUIT_NAME[s].title()}", "a": {"type": "suit", "suit": s}, "kind": "primary"} for s, g in zip("CDHS", "♣♦♥♠")]
            t["turnText"] = "🃏 Name a suit"
        elif self.stage == "say":
            opts = [(k, PHRASES[k][0]) for k in SAYS if k != "mao"] + [("mao", "🤐 Mao")]
            t["buttons"] = [{"label": ("☑ " if k in self.said else "☐ ") + lbl, "a": {"type": "say", "what": k}, "kind": "primary" if k in self.said else ""} for k, lbl in opts] + \
                [{"label": "✅ Done", "a": {"type": "done"}, "kind": "primary", "big": True}]
            t["note"] = f"You played {pretty(self.played['card'])}. Say anything it needs, then tap Done."
            t["turnText"] = "🗣️ Say it?"
        return t
