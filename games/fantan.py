"""Fan Tan (Sevens, Parliament): build the suits out from the sevens, for 3-6 players.

All the cards are dealt. Whoever holds the 7♦ starts by playing it. On your turn play a 7, or the next
card up or down from a suit already on the table (a 6 or 8 next to its 7, and so on out to the ace and
king). If you can't, you knock and pass, and with 🪙 Pay or Play you put a chip in the pot. First to
play all their cards wins the round (and the pot). Over several rounds, the cards left in your hand are
penalty points; the lowest total wins.

🛑 Hold back (default on): once a round you may knock even though you hold a playable card, to keep a
blocker in your hand. It costs 2 penalty points, so use it where it hurts a rival more than you."""
import random

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show, by_suit, GLYPH

ORDER = "A23456789TJQK"
IDX = {r: k for k, r in enumerate(ORDER)}
SORT = by_suit(ORDER, "SHDC")


class FanTan(CardGame):
    id = "fantan"
    name = "Fan Tan"
    icon = "🪭"
    blurb = "Sevens: build each suit up and down from its seven. Block your rivals, and run out first."
    howto = [
        "All cards are dealt. The 7♦ starts.",
        "On your turn play any 7, or the next card up or down on a suit that's started (6 or 8 by its 7, and so on).",
        "Can't play? You pass. You must play if you can.",
        "First to empty their hand wins the round. Cards left count against you; after the last round, lowest total wins.",
        "🪙 Pay or Play: each pass puts a chip in the pot, and the round's winner takes it (+ 1 point off per chip).",
        "🛑 Hold back: once a round you may pass even with a playable card, to keep a blocker. It costs you 2 penalty points.",
    ]
    min_players, max_players = 3, 6
    badges = {**CardGame.badges, "blocker": ("🧱", "Blocker", "Win a round without ever passing")}
    settings_schema = {
        "rounds": ("Rounds", [(3, "3 rounds"), (1, "1 round"), (5, "5 rounds")], 3),
        "pay": ("🪙 Pay or Play", [(False, "Off"), (True, "On: each pass costs a chip")], False),
        "hold": ("🛑 Hold back", [(True, "On: pass once a round for +2"), (False, "Off")], True),
    }
    HOLD_COST = 2
    sneaks = None  # games saved before 🛑 have none

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.round = 0
        self.room.add_log(f"🪭 Fan Tan: {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''}. The 7♦ starts.", "big")
        self.deal()

    def deal(self):
        self.round += 1
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [sorted(cards[k::self.n], key=SORT) for k in range(self.n)]
        self.lo = {}       # suit -> lowest rank index on the table
        self.hi = {}
        self.pot = 0
        self.passes = [0] * self.n
        self.sneaks = [1 if self.s.get("hold", True) else 0] * self.n
        self.last = None
        self.stage = "play"
        first = next(k for k in range(self.n) if "7D" in self.hands[k])
        self.room.add_log(f"🃏 Round {self.round}: {self.nm(first)} has the 7♦.")
        self.to(first)

    def legal(self, i):
        if not self.lo:
            return ["7D"] if "7D" in self.hands[i] else []
        out = []
        for c in self.hands[i]:
            s, k = suit(c), IDX[rank(c)]
            if s not in self.lo:
                if rank(c) == "7":
                    out.append(c)
            elif k == self.lo[s] - 1 or k == self.hi[s] + 1:
                out.append(c)
        return out

    def play(self, i, c):
        self.hands[i].remove(c)
        s, k = suit(c), IDX[rank(c)]
        if s not in self.lo:
            self.lo[s] = self.hi[s] = k
        else:
            self.lo[s] = min(self.lo[s], k)
            self.hi[s] = max(self.hi[s], k)
        self.last = {"seat": i, "card": c}
        self.room.add_log(f"🃏 {self.nm(i)} plays {pretty(c)}.")
        if not self.hands[i]:
            return self.end_round(i)
        self.to(self.next_seat(i))

    def can_hold(self, i):
        """🛑 a voluntary pass: once a round, with a playable card, after the 7♦ is down."""
        return bool(self.sneaks and self.sneaks[i] > 0 and self.lo and self.legal(i))

    def hold_back(self, i):
        self.sneaks[i] -= 1
        self.scores[i] += self.HOLD_COST
        self.moment(f"🛑 {self.nm(i)} holds back! (+{self.HOLD_COST})", "red", "pop")
        self.knock(i, held=True)

    def knock(self, i, held=False):
        self.passes[i] += 1
        if self.s.get("pay"):
            self.pot += 1
        self.last = {"seat": i, "card": None}
        self.room.add_log(f"{'🛑' if held else '✊'} {self.nm(i)} {'holds back a playable card' if held else 'knocks and passes'}" + (" (a chip in the pot)." if self.s.get("pay") else "."))
        self.to(self.next_seat(i))

    def end_round(self, w):
        pen = [len(h) for h in self.hands]
        for k in range(self.n):
            self.scores[k] += pen[k]
        if self.s.get("pay") and self.pot:
            self.scores[w] -= self.pot
        if self.passes[w] == 0 and self.pl(w):
            self.award(self.pl(w), "blocker")
        self.moment(f"🪭 {self.nm(w)} is out first!", "gold", "fanfare")
        self.room.add_log("🧮 " + " · ".join(f"{self.nm(k)} +{pen[k]}" for k in range(self.n) if pen[k]) + (f". {self.nm(w)} takes the pot (−{self.pot})." if self.s.get("pay") and self.pot else ""), "big")
        if self.round >= self.s["rounds"]:
            return self.win_by_score(self.scores, high=False, what="penalty points")
        self.stage = "score"
        self.pause(self.deal, 3.5)

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        self.require_turn(p)
        if self.stage != "play":
            raise GameError("Wait a moment.")
        t = a.get("type")
        if t == "play":
            c = a.get("card")
            if c not in self.legal(i):
                raise GameError("That card doesn't fit: play a 7 or the next card on a suit.")
            return self.play(i, c)
        if t == "hold":
            if not self.can_hold(i):
                raise GameError("You can't hold back now: once a round, and only with a card you could play.")
            return self.hold_back(i)
        if t == "pass":
            if self.legal(i):
                raise GameError("You can play, so you must.")
            return self.knock(i)
        raise GameError("Unknown action.")

    # -- bots

    def bot_move(self, i, level):
        if self.stage != "play":
            return
        legal = self.legal(i)
        if not legal:
            return self.knock(i)
        if level == "easy":
            return self.play(i, random.choice(legal))
        hand = self.hands[i]
        # 🛑 hard bots sit on a card that's about to open a suit for rivals, late in a round, when it's cheap enough
        if level == "hard" and self.can_hold(i) and len(hand) <= 6 and all(rank(c) == "7" and suit(c) not in self.lo for c in legal) \
                and self.rng.random() < 0.35:
            return self.hold_back(i)

        def score(c):
            s, k = suit(c), IDX[rank(c)]
            mine = [IDX[rank(x)] for x in hand if suit(x) == s and x != c]
            # how far my own cards run on past this one: playing toward them keeps my road open
            if rank(c) == "7":
                reach = max([abs(m - 6) for m in mine] + [0])
                gift = 12 - len(mine)        # opening a suit helps everyone else holding it
            else:
                beyond = [m for m in mine if (m < k if k < 6 else m > k)]
                reach = max([abs(m - k) for m in beyond] + [0])
                gift = 2 if not beyond else 0
            v = reach * 2 - (gift * (0.6 if level == "hard" else 0.2))
            if level == "hard" and not [m for m in mine if (m < k if k < 6 else m > k)] and rank(c) in "AK":
                v += 1          # an end card blocks nobody
            return v
        self.play(i, max(legal, key=lambda c: (score(c), random.random())))

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i])}"

    def final_scores(self):
        return {pid: -self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        piles = []
        for s in "SHDC":
            if s in self.lo:
                lo, hi = ORDER[self.lo[s]] + s, ORDER[self.hi[s]] + s
                cards = [lo] + (["7" + s] if lo != "7" + s and hi != "7" + s else []) + ([hi] if hi != lo else [])
                piles.append({"cards": cards, "fan": True, "small": True,
                              "label": f"{GLYPH[s]} {('10' if ORDER[self.lo[s]] == 'T' else ORDER[self.lo[s]])}–{('10' if ORDER[self.hi[s]] == 'T' else ORDER[self.hi[s]])}"})
            else:
                piles.append({"cards": [], "small": True, "label": f"{GLYPH[s]} waits for its 7"})
        info = [{"count": len(self.hands[k]), "tags": [f"✊ {self.passes[k]}"] if self.passes[k] else []} for k in range(self.n)]
        t = {"info": info, "piles": piles, "hand": self.hands[i] if i is not None else [],
             "banner": (f"🪙 Pot: {self.pot}" if self.s.get("pay") else None),
             "scores": {"title": "Penalty points", "rows": [{"seat": k, "value": self.scores[k]} for k in sorted(range(self.n), key=lambda k: self.scores[k])],
                        "hint": f"Round {self.round} of {self.s['rounds']}. Lowest total wins."}}
        if i is not None and self.stage == "play" and self.room.turn == p.id:
            legal = self.legal(i)
            t["moves"] = [{"card": c, "a": {"type": "play", "card": c}} for c in legal]
            if not legal:
                t["buttons"] = [{"label": "✊ Knock (pass)", "a": {"type": "pass"}, "kind": "primary"}]
                t["note"] = "Nothing fits: knock to pass."
                t["turnText"] = "✊ No play: knock"
            else:
                t["note"] = "Play a 7, or the next card on a started suit."
                if self.can_hold(i):
                    t["buttons"] = [{"label": f"🛑 Hold back (+{self.HOLD_COST})", "a": {"type": "hold"}}]
        return t
