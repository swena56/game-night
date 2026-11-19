"""Eleusis: work out the secret rule from which cards it accepts. For 2-6 players.

The game picks a secret rule about which card may follow the last one in the line (one of twenty
listed in the rules). Everyone gets twelve cards. On your turn play a card: if the rule accepts it,
it joins the main line and you're a card lighter; if not, it's shown under the line and you draw two.
If you think nothing in your hand fits, say "no play": right, and you swap your hand for one four
cards smaller; wrong, and one of your cards that fits is played for you and you draw three. Or name
the rule from the list (once): right, and you shed three cards and the answer stays your secret; wrong,
and that rule is crossed off for everyone and you draw three. Empty your hand to win, or have the fewest cards when the stock runs out."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show

VAL = {r: k + 1 for k, r in enumerate("A23456789TJQK")}
SUITS4 = "CDHS"


def v(c):
    return VAL[rank(c)]


def red(c):
    return suit(c) in "HD"


RULES = [
    ("colour", "Alternate red and black", lambda p, c: red(p) != red(c)),
    ("match", "Same suit or same rank as the last card", lambda p, c: suit(p) == suit(c) or rank(p) == rank(c)),
    ("near", "Within two ranks of the last card (K wraps to A)", lambda p, c: min((v(c) - v(p)) % 13, (v(p) - v(c)) % 13) <= 2),
    ("parity", "Alternate odd and even ranks (A 1, J 11, Q 12, K 13)", lambda p, c: v(p) % 2 != v(c) % 2),
    ("cycle", "Suits go in order ♣ ♦ ♥ ♠ ♣ …", lambda p, c: SUITS4.index(suit(c)) == (SUITS4.index(suit(p)) + 1) % 4),
    ("updown", "After red play equal or higher; after black, equal or lower", lambda p, c: v(c) >= v(p) if red(p) else v(c) <= v(p)),
    ("faces", "Face cards (J Q K) and number cards alternate", lambda p, c: (rank(p) in "JQK") != (rank(c) in "JQK")),
    ("same", "Same colour as the last card", lambda p, c: red(p) == red(c)),
    ("differ", "A different suit from the last card", lambda p, c: suit(p) != suit(c)),
    ("climb", "Higher than the last card, or the same suit", lambda p, c: v(c) > v(p) or suit(p) == suit(c)),
    ("evenred", "Even after red, odd after black", lambda p, c: v(c) % 2 == (0 if red(p) else 1)),
    ("bigsmall", "High (8+) and low (7 or less) alternate", lambda p, c: (v(p) >= 8) != (v(c) >= 8)),
    ("up", "Higher than the last card (anything after a K)", lambda p, c: v(c) > v(p) or v(p) == 13),
    ("down", "Lower than the last card (anything after an A)", lambda p, c: v(c) < v(p) or v(p) == 1),
    ("nofaces", "No face cards (J Q K) at all", lambda p, c: rank(c) not in "JQK"),
    ("pairs", "♥♠ and ♣♦ alternate", lambda p, c: (suit(p) in "HS") != (suit(c) in "HS")),
    ("sum", "Your rank plus the last card's makes 14 or more", lambda p, c: v(p) + v(c) >= 14),
    ("facecolour", "After a face card keep the colour; otherwise switch it", lambda p, c: (red(p) == red(c)) == (rank(p) in "JQK")),
    ("suitorface", "Same suit as the last card, or any face card", lambda p, c: suit(p) == suit(c) or rank(c) in "JQK"),
    ("redhigh", "Red cards must be 7 or higher; black, anything", lambda p, c: not red(c) or v(c) >= 7),
]
RULE = {k: (name, f) for k, name, f in RULES}


class Eleusis(CardGame):
    id = "eleusis"
    name = "Eleusis"
    icon = "🔮"
    blurb = "Crack the secret rule from the cards it accepts and rejects. Shed your hand, or name the rule."
    howto = [
        "Nobody knows the rule: the game picks one secretly, from the list under \"Cards left\". It looks at your card and the last accepted card in the line.",
        "Example: if the rule is \"Alternate red and black\", after 7♠ a 4♥ is accepted, then 9♥ is rejected (red after red).",
        "On your turn, play a card as a guess. Accepted: it joins the line. Rejected: it's shown under the line and you draw two. Each answer is a clue that rules some of the list out.",
        "\"No play\" if nothing fits: right, and your hand shrinks by four; wrong, and you draw three.",
        "🔮 Name the rule (once): right, you shed three cards and keep it secret. Wrong: it's crossed off and you draw three.",
        "Empty your hand to win, or have the fewest cards when the stock runs out.",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "oracle": ("🔮", "Oracle", "Name the rule before 6 cards are in the line")}
    settings_schema = {"hand": ("Hand", [(12, "12 cards"), (8, "8 cards (quick)")], 12)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.rule = rng.choice([k for k, _, _ in RULES])
        self.stock = deck(copies=2)
        rng.shuffle(self.stock)
        h = self.s.get("hand", 12)
        self.hands = [[self.stock.pop() for _ in range(h)] for _ in range(self.n)]
        for k in range(self.n):
            self.sort(k)
        self.line = [{"card": self.stock.pop(), "no": []}]
        self.crossed = []
        self.guessing = set()
        self.knows = set()
        self.last = None
        self.room.add_log("🔮 Eleusis: the rule is secret. Play cards and watch what it accepts.", "big")
        self.room.add_log(f"The line starts with {pretty(self.line[0]['card'])}.")
        self.stage = "play"
        self.to(rng.randrange(self.n))

    def sort(self, k):
        self.hands[k].sort(key=lambda c: (SUITS4.index(suit(c)), v(c)))

    def ok(self, c, rule=None):
        return RULE[rule or self.rule][1](self.line[-1]["card"], c)

    def draw(self, i, n):
        for _ in range(n):
            if not self.stock:
                return False
            self.hands[i].append(self.stock.pop())
        self.sort(i)
        return True

    def stock_out(self):
        return self.win_by_score([len(h) for h in self.hands], high=False, what="cards")

    # -- moves

    def play(self, i, c):
        self.hands[i].remove(c)
        if self.ok(c):
            self.line.append({"card": c, "no": []})
            self.last = {"seat": i, "card": c, "ok": True}
            self.room.add_log(f"✅ {self.nm(i)} plays {pretty(c)}: accepted.")
            if not self.hands[i]:
                return self.room.finish(self.pl(i), f"🏆 {self.nm(i)} empties their hand and wins Eleusis! The rule: {RULE[self.rule][0]}.")
        else:
            self.line[-1]["no"].append(c)
            self.last = {"seat": i, "card": c, "ok": False}
            self.room.add_log(f"❌ {self.nm(i)} plays {pretty(c)}: rejected. Draw two.")
            if not self.draw(i, 2):
                return self.stock_out()
        self.end_turn(i)

    def no_play(self, i):
        fits = [c for c in self.hands[i] if self.ok(c)]
        if not fits:
            n = max(1, len(self.hands[i]) - 4)
            self.stock = self.hands[i] + self.stock
            self.hands[i] = []
            self.room.add_log(f"🙌 {self.nm(i)} calls no play, and is right! Their hand: {n} cards.", "power")
            self.moment(f"🙌 {self.nm(i)} was right: nothing fits!", "cool", "whoosh")
            if not self.draw(i, n):
                return self.stock_out()
            self.last = {"seat": i, "card": None, "ok": True}
        else:
            c = random.choice(fits)
            self.hands[i].remove(c)
            self.line.append({"card": c, "no": []})
            self.room.add_log(f"🙈 {self.nm(i)} calls no play, but {pretty(c)} fits. It's played; draw three.")
            self.last = {"seat": i, "card": c, "ok": True, "forced": True}
            if not self.draw(i, 3):
                return self.stock_out()
        self.end_turn(i)

    def guess(self, i, r):
        self.guessing.discard(i)
        if r == self.rule:
            if len(self.line) < 6 and self.pl(i):
                self.award(self.pl(i), "oracle")
            self.knows.add(i)
            shed = sorted(self.hands[i], key=lambda c: (self.ok(c), random.random()))[:3]
            for c in shed:
                self.hands[i].remove(c)
            self.stock = shed + self.stock
            self.moment(f"🔮 {self.nm(i)} names the rule! (It's their secret.)", "gold", "fanfare")
            self.room.add_log(f"🔮 {self.nm(i)} names the rule correctly and sheds {len(shed)} cards.", "power")
            if pl := self.pl(i):
                self.room.add_log(f"🔮 The rule: {RULE[r][0]}.", "private", to=pl.id)
            if not self.hands[i]:
                return self.room.finish(self.pl(i), f"🏆 {self.nm(i)} empties their hand and wins Eleusis! The rule: {RULE[self.rule][0]}.")
            return self.end_turn(i)
        self.crossed.append(r)
        self.room.add_log(f"🔮 {self.nm(i)} guesses \"{RULE[r][0]}\": wrong! Crossed off; draw three.", "power")
        self.moment(f"❌ Not \"{RULE[r][0]}\"", "bad", "boom")
        if not self.draw(i, 3):
            return self.stock_out()
        self.end_turn(i)

    def end_turn(self, i):
        self.to(self.next_seat(i))

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        t = a.get("type")
        if t == "play":
            c = a.get("card")
            if c not in self.hands[i]:
                raise GameError("That card isn't in your hand.")
            self.guessing.discard(i)
            return self.play(i, c)
        if t == "noplay":
            self.guessing.discard(i)
            return self.no_play(i)
        if t == "guessmode":
            if i in self.knows:
                raise GameError("You've already named it.")
            (self.guessing.discard if i in self.guessing else self.guessing.add)(i)
            return
        if t == "guess":
            r = a.get("rule")
            if r not in RULE or r in self.crossed:
                raise GameError("Pick a rule from the list.")
            if i in self.knows:
                raise GameError("You've already named it.")
            return self.guess(i, r)
        raise GameError("Unknown action.")

    # -- bots: keep every listed rule that fits all the evidence so far

    def evidence(self):
        out = []
        for k in range(1, len(self.line)):
            out.append((self.line[k - 1]["card"], self.line[k]["card"], True))
        for k, step in enumerate(self.line):
            for c in step["no"]:
                out.append((step["card"], c, False))
        return out

    def alive(self, level):
        ev = self.evidence()
        if level == "easy":
            ev = ev[-4:]
        return [k for k, _, f in RULES if k not in self.crossed and all(f(p, c) == want for p, c, want in ev)]

    def bot_move(self, i, level):
        live = [self.rule] if i in self.knows else self.alive(level) or [k for k, _, _ in RULES if k not in self.crossed]
        if i not in self.knows and len(live) == 1 and (level == "hard" or random.random() < (0.6 if level == "normal" else 0.3)):
            return self.guess(i, live[0])
        if level == "hard" and i not in self.knows and len(live) == 2 and len(self.hands[i]) > 4 and random.random() < 0.5:
            return self.guess(i, random.choice(live))
        prob = {c: sum(1 for r in live if self.ok(c, r)) / len(live) for c in self.hands[i]}
        best = max(prob.values())
        if best == 0 and level != "easy":
            return self.no_play(i)
        if level == "easy" and i not in self.knows and random.random() < 0.35:
            return self.play(i, random.choice(self.hands[i]))
        top = [c for c in self.hands[i] if prob[c] == best]
        self.play(i, random.choice(top))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i])}"

    def final_scores(self):
        return {pid: -len(self.hands[k]) for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"count": len(self.hands[k]), "tags": ["🔮 knows"] if k in self.knows else []} for k in range(self.n)]
        piles = []
        for k, step in enumerate(self.line[-8:]):
            lbl = "start" if len(self.line) <= 8 and k == 0 else f"#{len(self.line) - min(8, len(self.line)) + k + 1}"
            piles.append({"cards": [step["card"]] + step["no"][-6:], "fan": True, "small": bool(step["no"]),
                          "label": lbl + (f" · then ❌×{len(step['no'])}" if step["no"] else ""), "glow": k == min(8, len(self.line)) - 1})
        lst = self.last
        t = {"info": info, "piles": piles, "hand": self.hands[i] if i is not None else [],
             "banner": (f"{self.nm(lst['seat'])}: " + ("no play, right!" if lst["card"] is None else f"{pretty(lst['card'])} {'✅' if lst['ok'] else '❌'}")) if lst else None,
             "scores": {"title": "Cards left", "rows": [{"seat": k, "value": len(self.hands[k])} for k in sorted(range(self.n), key=lambda k: len(self.hands[k]))],
                        "hint": "The rule is one of: " + " / ".join(name for k, name, _ in RULES if k not in self.crossed)},
             "note": f"Line: {len(self.line)} accepted · stock {len(self.stock)}. The first card of each column was accepted; the rest (❌) were rejected after it."}
        if i is None or self.room.turn != p.id:
            return t
        if i in self.guessing:
            t["buttons"] = [{"label": name, "a": {"type": "guess", "rule": k}, "kind": "primary"} for k, name, _ in RULES if k not in self.crossed] + \
                [{"label": "Cancel", "a": {"type": "guessmode"}}]
            t["note"] = "Which rule is it? Right: shed three cards. Wrong: draw three."
            t["turnText"] = "🔮 Name the rule"
            return t
        t["moves"] = [{"card": c, "a": {"type": "play", "card": c}} for c in self.hands[i]]
        t["buttons"] = [{"label": "🙅 No play", "a": {"type": "noplay"}}] + ([] if i in self.knows else [{"label": "🔮 Name the rule", "a": {"type": "guessmode"}}])
        if i in self.knows:
            t["note"] = f"🔮 You know the rule: {RULE[self.rule][0]}."
        elif self.line:
            t["note"] = (f"Play a card after {pretty(self.line[-1]['card'])}. If the secret rule allows it, it joins the line "
                         f"and your hand shrinks; if not, it goes under the line (❌) and you draw 2. Stuck? 🙅 No play.")
        t["turnText"] = "🔮 Play a card"
        return t
