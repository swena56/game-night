"""Hearts: the traditional trick-avoiding card game, for 3-6 players (best with 4).

Each hand everyone passes three cards (left, right, across with four players, then a hand with no
passing), then plays thirteen-ish tricks. The 2♣ leads the first trick. Follow suit if you can.
No hearts or Q♠ on the first trick unless you have nothing else, and hearts can't be led until one
has been played. Every heart taken is 1 point and the Q♠ is 13; take all of them ("shoot the moon")
and everyone else gets 26 instead. When someone reaches the target, the lowest score wins.
With 3, 5 or 6 players, low diamonds and clubs (never the 2♣) are removed so the deal comes out even."""
import random
import time

from .base import Game, GameError

RANKS = "23456789TJQKA"
SUITS = "CDSH"   # sort order in hand: clubs, diamonds, spades, hearts
VALUE = {r: i + 2 for i, r in enumerate(RANKS)}
QUEEN = "QS"
JACK = "JD"        # with the jack option, taking the J♦ is −10
REMOVE = ["2D", "3D", "3C", "4D"]  # taken out so the deck divides evenly
HAND_PAUSE = 5.0   # pause on the hand's points


def points(card):
    return 13 if card == QUEEN else 1 if card[1] == "H" else 0


def pretty(card):
    return ("10" if card[0] == "T" else card[0]) + {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[card[1]]


def sort_key(card):
    return (SUITS.index(card[1]), VALUE[card[0]])


class Hearts(Game):
    id = "hearts"
    category = "cards"
    howto = [
        "Each hand, pass three cards (left, right, across with four players, then no pass), then play tricks.",
        "The 2♣ leads first. Follow suit if you can; the highest card of the suit led takes the trick.",
        "Each heart you take is 1 point and the Q♠ is 13. Take them all to shoot the moon: everyone else gets 26.",
        "No points on the first trick, and no leading hearts until one has been played.",
        "Optional 💎 J♦: whoever takes the jack of diamonds scores −10 (it counts even when someone shoots the moon).",
        "When someone reaches the target, the lowest score wins.",
    ]
    name = "Hearts"
    icon = "♥️"
    blurb = "The classic trick-dodging game: avoid hearts and the queen of spades, or take them all."
    min_players = 3
    max_players = 6
    settings_schema = {
        "target": ("Game to", [(100, "100 points"), (50, "50 points (quick)")], 100),
        "jack": ("Jack of diamonds", [(False, "No bonus"), (True, "💎 J♦ is −10")], False),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.scores = [0] * len(seated)
        self.hand_no = 0
        self.room.add_log(f"♥️ Hearts to {self.s['target']}. Lowest score wins.", "big")
        self.deal()

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def passing(self):
        """Pass offset this hand (1 = left), or 0 for no pass."""
        n = len(self.seats)
        cycle = [1, n - 1, 2, 0] if n == 4 else [1, n - 1, 0]
        return cycle[(self.hand_no - 1) % len(cycle)]

    def deal(self):
        n = len(self.seats)
        self.hand_no += 1
        deck = [r + s for s in SUITS for r in RANKS if r + s not in REMOVE[:52 % n]]
        self.rng.shuffle(deck)
        per = len(deck) // n
        self.hands = [sorted(deck[i * per:(i + 1) * per], key=sort_key) for i in range(n)]
        self.taken = [[] for _ in range(n)]
        self.trick, self.lead = [], None   # trick: [(seat, card)]
        self.broken = False
        self.first = True
        self.last_trick = None
        self.hand_points = None
        self.passes = {}
        self.received = {}
        off = self.passing()
        r = self.room
        r.turn = None
        if off:
            self.stage = "pass"
            where = {1: "left", n - 1: "right", 2: "across"}[off]
            r.add_log(f"♥️ Hand {self.hand_no}: pass three cards {where}.")
            r.deadline = time.time() + r.settings["timer"] if r.settings["timer"] else None
            r.bot_at = time.time() + random.uniform(0.8, 1.8)
        else:
            r.add_log(f"♥️ Hand {self.hand_no}: no passing this time.")
            self.begin_play()

    def begin_play(self):
        self.stage = "play"
        lead = next(i for i, h in enumerate(self.hands) if "2C" in h)
        self.room.begin_turn(self.seats[lead])

    # -- passing

    def do_pass(self, i, cards):
        self.passes[i] = cards
        if len(self.passes) < len(self.seats):
            return
        n, off = len(self.seats), self.passing()
        for j, cs in self.passes.items():
            for c in cs:
                self.hands[j].remove(c)
            self.hands[(j + off) % n] += cs
        for j in range(n):
            self.hands[j].sort(key=sort_key)
        self.received = {(j + off) % n: cs for j, cs in self.passes.items()}
        self.room.add_log("🔁 Cards passed.")
        self.begin_play()

    # -- tricks

    def legal(self, i):
        hand = self.hands[i]
        if not self.trick:
            if self.first:
                return ["2C"] if "2C" in hand else hand[:]
            if not self.broken:
                safe = [c for c in hand if c[1] != "H"]
                return safe or hand[:]
            return hand[:]
        suit = self.trick[0][1][1]
        follow = [c for c in hand if c[1] == suit]
        if follow:
            return follow
        if self.first:
            clean = [c for c in hand if not points(c)]
            return clean or hand[:]
        return hand[:]

    def play(self, i, card):
        p = self.pl(i)
        self.hands[i].remove(card)
        self.trick.append((i, card))
        if card[1] == "H" or card == QUEEN:
            self.broken = self.broken or card[1] == "H"
        n = len(self.seats)
        r = self.room
        if len(self.trick) < n:
            return r.begin_turn(self.seats[(i + 1) % n])
        suit = self.trick[0][1][1]
        win = max((t for t in self.trick if t[1][1] == suit), key=lambda t: VALUE[t[1][0]])[0]
        cards = [c for _, c in self.trick]
        self.taken[win].extend(cards)
        pts = sum(points(c) for c in cards) - (10 if self.jack() and JACK in cards else 0)
        w = self.pl(win)
        r.add_log(f"🃏 {' '.join(pretty(c) for c in cards)} → {w.name if w else '?'}" + (f" ({pts:+})" if pts else ""),
                  "power" if pts else "question")
        self.last_trick = {"cards": [[s, c] for s, c in self.trick], "winner": win}
        self.trick = []
        self.first = False
        if not self.hands[win]:
            return self.end_hand()
        r.begin_turn(self.seats[win])

    def jack(self):
        return bool(self.s.get("jack"))

    def took(self, i):
        """Points taken this hand so far: hearts and the queen, less 10 for the J♦ when that option is on."""
        return sum(points(c) for c in self.taken[i]) - (10 if self.jack() and JACK in self.taken[i] else 0)

    def end_hand(self):
        r = self.room
        got = [sum(points(c) for c in t) for t in self.taken]
        moon = next((i for i, g in enumerate(got) if g == 26), None)
        if moon is not None:
            got = [0 if i == moon else 26 for i in range(len(got))]
            m = self.pl(moon)
            r.add_log(f"🌙 {m.name if m else '?'} shot the moon! Everyone else takes 26.", "big")
        if self.jack():
            for i, t in enumerate(self.taken):
                if JACK in t:
                    got[i] -= 10
                    j = self.pl(i)
                    r.add_log(f"💎 {j.name if j else '?'} took the J♦: −10.", "power")
        for i, g in enumerate(got):
            self.scores[i] += g
        self.hand_points = got
        names = [self.pl(i).name if self.pl(i) else "?" for i in range(len(self.seats))]
        r.add_log("🧮 " + " · ".join(f"{names[i]} {got[i]:+} ({self.scores[i]})" for i in range(len(got))), "big")
        if max(self.scores) >= self.s["target"]:
            low = min(self.scores)
            best = [i for i, v in enumerate(self.scores) if v == low]
            if len(best) == 1:
                return r.finish(self.pl(best[0]), f"🏆 {names[best[0]]} wins Hearts with {low} points!")
            return r.finish(None, f"🤝 A tie at {low} between {' & '.join(names[i] for i in best)}.")
        self.stage = "score"
        r.turn = None
        r.deadline = time.time() + HAND_PAUSE

    # -- actions

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        t = a.get("type")
        if t == "pass":
            if self.stage != "pass" or i in self.passes:
                raise GameError("Not passing now.")
            cards = a.get("cards")
            if (not isinstance(cards, list) or len(cards) != 3 or len(set(map(str, cards))) != 3
                    or not all(c in self.hands[i] for c in cards)):
                raise GameError("Pick three of your cards to pass.")
            return self.do_pass(i, cards)
        if t == "play":
            self.require_turn(p)
            if self.stage != "play":
                raise GameError("Wait for the next trick.")
            card = a.get("card")
            if card not in self.legal(i):
                raise GameError("You must follow suit (and no hearts or Q♠ early).")
            return self.play(i, card)
        raise GameError("Unknown action.")

    def on_timeout(self):
        r = self.room
        if self.stage == "score":
            return self.deal()
        if self.stage == "pass":
            for i in range(len(self.seats)):
                if i not in self.passes:
                    p = self.pl(i)
                    r.add_log(f"⏰ {p.name if p else '?'} ran out of time; three cards were passed for them.", "power")
                    self.do_pass(i, self.choose_pass(i, "easy"))
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.pl(i).name} ran out of time.", "power")
        self.play(i, self.choose_play(i, "easy"))

    def on_leave(self, p):
        # a seat can't vanish mid-hand in a trick game: the game plays it out (see auto)
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left; their seat plays on by itself.")
        left = r.contenders()
        if len(left) < 2:
            return r.finish(left[0] if left else None, "🏳️ Everyone else left.")

    def auto(self, i):
        """Bots, and seats whose player left, play themselves."""
        p = self.pl(i)
        return p is None or bool(p.bot) or p.eliminated

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"♥ {self.scores[i]}"

    def final_scores(self):
        return {pid: self.scores[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        n = len(self.seats)
        mine = i is not None
        return {"hearts": {
            "seats": self.seats, "me": i, "stage": self.stage, "hand": self.hands[i] if mine else [],
            "counts": [len(h) for h in self.hands], "trick": [[s, c] for s, c in self.trick],
            "last": self.last_trick, "scores": self.scores, "handNo": self.hand_no,
            "taken": [self.took(k) for k in range(n)], "broken": self.broken, "jack": self.jack(),
            "pass": self.passing(), "passed": sorted(self.passes), "myPass": self.passes.get(i) if mine else None,
            "received": getattr(self, "received", {}).get(i) if mine and self.stage == "play" and self.first else None,
            "legal": self.legal(i) if mine and self.stage == "play" and self.room.turn == p.id else [],
            "handPoints": self.hand_points if self.stage == "score" else None, "target": self.s["target"],
            "n": n,
        }}

    # -- bots

    def bot_ready(self):
        if self.room.phase != "playing":
            return False
        if self.stage == "pass":
            return any(self.auto(i) and i not in self.passes for i in range(len(self.seats)))
        if self.stage == "score" or self.room.turn not in self.seats:
            return False
        return self.auto(self.seats.index(self.room.turn))

    def bot_tick(self):
        if self.stage == "pass":
            for i in range(len(self.seats)):
                if self.auto(i) and i not in self.passes and self.stage == "pass":
                    self.do_pass(i, self.choose_pass(i, self.level(i)))
            return
        i = self.seats.index(self.room.turn)
        self.play(i, self.choose_play(i, self.level(i)))

    def level(self, i):
        p = self.pl(i)
        return p.bot if p and p.bot else "normal"

    def choose_pass(self, i, level):
        hand = self.hands[i]
        if level == "easy":
            return random.sample(hand, 3)

        def danger(c):
            v = VALUE[c[0]]
            d = v
            if c == QUEEN or (c[1] == "S" and c[0] in "KA"):
                d += 30
            if c[1] == "H":
                d += 6
            # short suits are worth emptying (a void lets you dump points)
            d += 4 * max(0, 4 - sum(1 for x in hand if x[1] == c[1]))
            if c[1] == "S" and VALUE[c[0]] < 12:
                d -= 15  # low spades protect against the queen
            if c == JACK and self.jack():
                d -= 40  # keep the −10 jack
            return d
        return sorted(hand, key=danger, reverse=True)[:3]

    def choose_play(self, i, level):
        legal = self.legal(i)
        if len(legal) == 1:
            return legal[0]
        if level == "easy" and random.random() < 0.5:
            return random.choice(legal)
        hand = self.hands[i]
        queen_out = all(QUEEN not in t for t in self.taken) and QUEEN not in hand
        if not self.trick:  # leading: lead low, from a suit where low cards are safe
            def lead_cost(c):
                cost = VALUE[c[0]]
                if c[1] == "S" and queen_out and c[0] in "KA":
                    cost += 40  # leading a high spade may catch the queen
                if c[1] == "H":
                    cost += 4
                if c == QUEEN:
                    cost += 50
                return cost
            return min(legal, key=lead_cost)
        suit = self.trick[0][1][1]
        top = max((VALUE[c[0]] for _, c in self.trick if c[1] == suit))
        pts = sum(points(c) for _, c in self.trick)
        following = legal[0][1] == suit
        last = len(self.trick) == len(self.seats) - 1
        if following and self.jack() and level != "easy":
            # the J♦ is worth taking when it outweighs the hearts in the trick
            jack_here = JACK in [c for _, c in self.trick] or JACK in legal
            winners = [c for c in legal if VALUE[c[0]] > top and c != QUEEN]
            if jack_here and winners and pts < 10 and (last or suit == "D"):
                return JACK if JACK in winners else max(winners, key=lambda c: VALUE[c[0]])
        if following:
            under = [c for c in legal if VALUE[c[0]] < top]
            if under:  # duck with the highest card that still loses
                return max(under, key=lambda c: VALUE[c[0]])
            if last and not pts and not (level == "hard" and suit == "S" and queen_out):
                # last to play, a clean trick: win it with the highest card (and dump it)
                return max(legal, key=lambda c: (c != QUEEN, VALUE[c[0]]))
            # must win: win with the lowest, except never volunteer the queen
            safe = [c for c in legal if c != QUEEN] or legal
            return min(safe, key=lambda c: VALUE[c[0]]) if not last else max(safe, key=lambda c: VALUE[c[0]])
        # void in the suit led: dump the worst card (never the −10 jack)
        if self.jack() and level != "easy" and len(legal) > 1 and JACK in legal:
            legal = [c for c in legal if c != JACK]
        if QUEEN in legal:
            return QUEEN
        high_spades = [c for c in legal if c[1] == "S" and c[0] in "KA"]
        if high_spades and queen_out:
            return high_spades[0]
        hearts = [c for c in legal if c[1] == "H"]
        if hearts:
            return max(hearts, key=lambda c: VALUE[c[0]])
        return max(legal, key=lambda c: VALUE[c[0]])
