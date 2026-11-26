"""Cheat (I Doubt It): the traditional bluffing game, for 3-6 players.

The whole deck is dealt. Each turn the next rank in order (A, 2, 3 … K, then A again) must be played:
put one to four cards face down and say "three sevens". They don't have to be sevens. After every
play anyone may call "Cheat!": the cards are turned up; if any isn't the rank called the player takes
the whole pile, otherwise the caller does. Empty your hand (and survive the call) to win.

🎲 Free claims (a setting): instead of the fixed order you may claim the same rank as the last play,
or one above or below it."""
import math
import random
import time

from .cardbase import CardGame, GameError, RANKS, deck, rank, pretty, show, rname, by_suit

ORDER = "A23456789TJQK"
SORT = by_suit("A23456789TJQK")


def word(n, r):
    return f"{['', 'one', 'two', 'three', 'four'][n] if n <= 4 else n} {rname(r, n)}"


class Cheat(CardGame):
    id = "cheat"
    solo_bots = 3
    name = "Cheat"
    icon = "🙊"
    blurb = "Play face down and say what they are. Lie when you must, and call out the liars."
    howto = [
        "Ranks go in order: aces, twos, threes … kings, then aces again. On your turn put 1–4 cards face down as that rank.",
        "You may lie. After each play anyone can call 🚨 Cheat!",
        "Caught lying? You take the whole pile. Called but honest? The caller takes it.",
        "First to empty their hand, and survive the call on that last play, wins.",
        "🎲 Free claims: claim the same rank as the last play, or one above or below it.",
    ]
    min_players, max_players = 3, 6
    badges = {**CardGame.badges, "liar": ("🎭", "Smooth liar", "Win with a bluff nobody called"),
              "sniffer": ("🐽", "Lie detector", "Catch three cheats in one game")}
    settings_schema = {
        "claims": ("Claims", [("order", "Fixed order: A, 2, 3 … K"), ("free", "🎲 Free: same, one up or one down")], "order"),
        "window": ("Time to call", [(6, "6 seconds"), (4, "4 seconds (quick)"), (10, "10 seconds")], 6),
    }

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck()
        rng.shuffle(cards)
        self.hands = [sorted(cards[k::self.n], key=SORT) for k in range(self.n)]
        self.pile = []
        self.claim = None          # {seat, rank, n, cards}
        self.need = "A"
        self.reveal = None         # {cards, liar, caller, loser}
        self.catches = [0] * self.n
        self.mine_in_pile = [[] for _ in range(self.n)]
        self.known = [set() for _ in range(self.n)]
        self.room.add_log("🙊 Cheat: aces first. Lie when you must; call 🚨 Cheat! when you smell a lie.", "big")
        self.stage = "play"
        self.to(rng.randrange(self.n))

    # -- rules

    def claimable(self):
        if self.s.get("claims") == "free" and self.claim:
            k = ORDER.index(self.claim["rank"])
            return [ORDER[(k + d) % 13] for d in (-1, 0, 1)]
        return [self.need]

    def do_play(self, i, cards, r):
        for c in cards:
            self.hands[i].remove(c)
            self.known[i].discard(c)
        self.mine_in_pile[i] += cards
        self.pile += cards
        self.claim = {"seat": i, "rank": r, "n": len(cards), "cards": cards}
        self.need = ORDER[(ORDER.index(r) + 1) % 13]
        self.room.add_log(f"🂠 {self.nm(i)} plays {word(len(cards), r)}." + (" Last cards!" if not self.hands[i] else ""))
        self.stage = "call"
        others = [k for k in range(self.n) if k != i]
        self.open_all(others, secs=self.s.get("window", 6))
        self.believed = set()

    def do_call(self, k):
        c = self.claim
        i = c["seat"]
        lie = any(rank(x) != c["rank"] for x in c["cards"])
        loser = i if lie else k
        self.hands[loser] += self.pile
        self.known[loser] |= set(c["cards"])
        self.mine_in_pile = [[] for _ in range(self.n)]
        self.hands[loser].sort(key=SORT)
        self.reveal = {"cards": c["cards"], "liar": lie, "caller": k, "seat": i, "loser": loser, "n": len(self.pile)}
        self.pile = []
        self.waiting = set()
        if lie:
            self.catches[k] += 1
            if self.catches[k] == 3 and self.pl(k):
                self.award(self.pl(k), "sniffer")
            self.moment(f"🚨 {self.nm(k)} caught {self.nm(i)}: {show(c['cards'])}. {self.nm(i)} takes {self.reveal['n']}!", "bad", "groan")
        else:
            self.moment(f"😇 {self.nm(i)} told the truth ({show(c['cards'])}). {self.nm(k)} takes {self.reveal['n']}.", "good", "good")
        self.stage = "reveal"
        self.pause(lambda: self.after_call(i), 3.0)

    def after_call(self, i):
        self.reveal = None
        if not self.hands[i]:
            return self.win(i)
        self.stage = "play"
        self.to(self.next_seat(i))

    def window_closed(self):
        i = self.claim["seat"]
        self.waiting = set()
        if not self.hands[i]:
            lie = any(rank(x) != self.claim["rank"] for x in self.claim["cards"])
            if lie and self.pl(i):
                self.award(self.pl(i), "liar")
            return self.win(i)
        self.stage = "play"
        self.to(self.next_seat(i))

    def win(self, i):
        self.room.finish(self.pl(i), f"🏆 {self.nm(i)} empties their hand and wins Cheat!")

    # -- actions

    def act(self, p, a):
        i = self.act_seat(p)
        t = a.get("type")
        if t == "play":
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait a moment.")
            cards = a.get("cards")
            r = a.get("rank", self.claimable()[0])
            if (not isinstance(cards, list) or not 1 <= len(cards) <= 4 or len(set(map(str, cards))) != len(cards)
                    or not all(c in self.hands[i] for c in cards)):
                raise GameError("Pick one to four of your cards.")
            if r not in self.claimable():
                raise GameError("You can't claim that rank now.")
            return self.do_play(i, cards, r)
        if t in ("call", "believe"):
            if self.stage != "call" or i not in self.waiting:
                raise GameError("Too late to call.")
            if t == "call":
                return self.do_call(i)
            self.waiting.discard(i)
            if not self.waiting:
                self.window_closed()
            return
        if t == "set_claim":
            self.require_turn(p)
            if a.get("rank") not in self.claimable():
                raise GameError("You can't claim that rank now.")
            return self.act_set_claim(i, a["rank"])
        raise GameError("Unknown action.")

    def on_timeout(self):
        if self.stage == "call" and not self.after:
            return self.window_closed()
        if self.stage == "play" and not self.after:
            i = self.seats.index(self.room.turn)
            self.room.add_log(f"⏰ {self.nm(i)} ran out of time.", "power")
            return self.bot_move(i, "easy")
        return super().on_timeout()

    # -- bots

    def bot_ready(self):
        if self.stage == "call" and not self.after:
            # bots don't all jump in at once: each waits its own beat
            return any(self.auto(k) for k in self.waiting)
        return super().bot_ready()

    def bot_move(self, i, level):
        if self.stage == "play":
            cards, r = self.bot_play(i, level)
            return self.do_play(i, cards, r)
        if self.stage == "call":
            if self.bot_calls(i, level):
                return self.do_call(i)
            self.waiting.discard(i)
            if not self.waiting:
                self.window_closed()

    def bot_play(self, i, level):
        hand = self.hands[i]
        options = self.claimable()
        # free claims: claim the rank I hold most of
        r = max(options, key=lambda x: (sum(1 for c in hand if rank(c) == x), random.random()))
        true = [c for c in hand if rank(c) == r][:4]
        if true:
            extra = []
            spare = [c for c in hand if rank(c) != r]
            if level != "easy" and spare and len(true) < 4 and len(hand) > len(true) + 1 and random.random() < (0.0 if level == "hard" else 0.2) and len(self.pile) < 3:
                extra = [self.far_card(i, spare)]
            return true + extra, r
        if not hand:
            return [], r
        # nothing true: bluff with the card I'll need least soon (one card, or two late in the game)
        n = 2 if level == "hard" and len(hand) <= 4 and len(hand) >= 2 and random.random() < 0.4 else 1
        out = []
        pool = hand[:]
        for _ in range(n):
            c = self.far_card(i, pool) if level != "easy" else random.choice(pool)
            out.append(c)
            pool.remove(c)
        return out, r

    def far_card(self, i, cards):
        """The card whose rank comes round again last."""
        start = ORDER.index(self.need)
        return max(cards, key=lambda c: ((ORDER.index(rank(c)) - start) % 13, random.random()))

    def odds_true(self, i, level):
        """Seat i's chance that the last claim is true: can the claimer even hold that many of the rank
        (counting my hand, what I put in the pile, and for a hard bot the cards turned up on calls), and
        how likely a hand that size is to hold them."""
        c = self.claim
        r, n = c["rank"], c["n"]
        h = len(self.hands[c["seat"]]) + n
        mine = sum(1 for x in self.hands[i] if rank(x) == r) + sum(1 for x in self.mine_in_pile[i] if rank(x) == r)
        known = 0
        if level == "hard":
            known = sum(1 for k in range(self.n) if k not in (i, c["seat"]) for x in self.known[k] if rank(x) == r)
            held = sum(1 for x in self.known[c["seat"]] if rank(x) == r)
            if held >= n:
                return 1.0
        u = 4 - mine - known                    # unseen cards of the rank
        U = 52 - len(self.hands[i]) - len(self.mine_in_pile[i])
        if n > u:
            return 0.0
        h = min(h, U)
        exact = lambda k: math.comb(u, k) * math.comb(U - u, h - k) if 0 <= k <= min(u, h) else 0
        # people play every card of the rank they hold, and bluff (one card, or one extra) when short
        true = exact(n)
        lie = exact(0) * (1.0 if n == 1 else 0.15) + exact(n - 1) * 0.25
        return true / max(1e-9, true + lie)

    def bot_calls(self, i, level):
        c = self.claim
        last = not self.hands[c["seat"]]
        if level == "easy":
            mine = sum(1 for x in self.hands[i] if rank(x) == c["rank"])
            if mine + c["n"] > 4:
                return random.random() < 0.7
            return random.random() < (0.4 if last else 0.06)
        p = self.odds_true(i, level)
        if p == 0.0:
            return True
        if last:
            return p < (0.7 if level == "hard" else 0.5)
        # a wrong call costs the whole pile, a right one only hands it to one rival: call on near-certain lies
        return p < (0.1 if level == "hard" else 0.06)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.hands[i])}"

    def final_scores(self):
        return {pid: -len(self.hands[i]) for i, pid in enumerate(self.seats)}

    def table(self, p, i):
        c, rv = self.claim, self.reveal
        info = [{"count": len(self.hands[k]), "tags": [f"🐽 {self.catches[k]}"] if self.catches[k] else []} for k in range(self.n)]
        piles = []
        banner = None
        if rv:
            piles.append({"cards": rv["cards"], "fan": True, "glow": True,
                          "label": f"{'🚨 CHEAT!' if rv['liar'] else '😇 Honest!'} {self.nm(rv['loser'])} takes {rv['n']}"})
            banner = f"{'Caught!' if rv['liar'] else 'Truth!'}"
        else:
            piles.append({"cards": ["??"] * min(3, len(self.pile)), "count": len(self.pile), "label": "The pile"})
            if c:
                banner = f"{self.nm(c['seat'])}: “{word(c['n'], c['rank'])}”"
        t = {"info": info, "piles": piles, "banner": banner, "hand": self.hands[i] if i is not None else [],
             "scores": {"title": "Cards left", "rows": [{"seat": k, "value": len(self.hands[k])} for k in sorted(range(self.n), key=lambda k: len(self.hands[k]))],
                        "hint": "Fewest cards is closest to winning."}}
        mine = i is not None and self.room.turn == p.id and self.stage == "play"
        opts = self.claimable()
        if mine:
            if len(opts) == 1:
                t["pick"] = {"act": "play", "min": 1, "max": 4, "label": f"Play as {rname(opts[0])}", "extra": {"rank": opts[0]}}
                t["note"] = f"Your turn: play 1–4 cards as {rname(opts[0])} (truthfully or not)."
            else:
                t["pick"] = {"act": "play", "min": 1, "max": 4, "label": f"Play as {rname(self.pick_rank(i))}", "extra": {"rank": self.pick_rank(i)}}
                t["buttons"] = [{"label": f"Claim {rname(r)}", "a": {"type": "set_claim", "rank": r}} for r in opts if r != self.pick_rank(i)]
                t["note"] = "Pick your cards and what to call them."
            t["turnText"] = f"🂠 Your turn: {rname(opts[0]) if len(opts) == 1 else 'pick a rank'}"
        elif self.stage == "call" and i in self.waiting:
            t["buttons"] = [{"label": "🚨 Cheat!", "a": {"type": "call"}, "kind": "danger big"},
                            {"label": "✓ Believe", "a": {"type": "believe"}}]
            held = sum(1 for x in self.hands[i] if rank(x) == c["rank"])
            gone = held + sum(1 for x in self.mine_in_pile[i] if rank(x) == c["rank"])
            left = 4 - gone
            t["note"] = (f"Do you believe {self.nm(c['seat'])}? You hold {held} {rname(c['rank'])}"
                         + (f" and only {left} can be out there, so {c['n']} is impossible: it's a lie!" if c["n"] > left
                            else f"; at most {left} are left for them to hold ({c['n']} claimed)."))
            t["turnText"] = "🚨 Call Cheat, or believe it?"
        elif self.stage == "play" and self.room.turn in self.seats:
            t["note"] = f"{self.nm(self.seats.index(self.room.turn))} is playing {' / '.join(rname(r) for r in opts)}."
        return t

    def pick_rank(self, i):
        sel = getattr(self, "chosen", {}).get(i)
        return sel if sel in self.claimable() else self.claimable()[1 if len(self.claimable()) == 3 else 0]

    def act_set_claim(self, i, r):
        self.chosen = getattr(self, "chosen", {})
        self.chosen[i] = r
