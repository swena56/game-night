"""Lantern Market: a sealed-bid auction for 2–6. Each round one lot comes up at the night market and everyone
secretly plays one of their bid tiles. The highest bid that nobody else matched wins the lot, and matching bids
cancel each other out. If no bid is unique the lot stays on the table and the next one joins it. Once a game you
can light your 🏮 lantern on a bid: if it wins, the lots count double."""
import math
import random
import time

from .base import Game, GameError

# the goods on sale, by value
GOODS = {1: ("🥚", "Eggs"), 2: ("🍋", "Lemons"), 3: ("🧄", "Garlic"), 4: ("🍯", "Honey"), 5: ("🧶", "Yarn"),
         6: ("🫖", "Teapot"), 7: ("🪁", "Kite"), 8: ("🏺", "Vase"), 9: ("🪔", "Oil lamp"), 10: ("🧭", "Compass"),
         11: ("🪞", "Mirror"), 12: ("💍", "Ring"), 13: ("👑", "Crown")}


def lot_name(v):
    e, n = GOODS[v]
    return f"{e} {n} ({v})"


def winner_of(bids):
    """The pid with the highest bid nobody matched, or None."""
    count = {}
    for b in bids.values():
        count[b] = count.get(b, 0) + 1
    unique = [b for b, n in count.items() if n == 1]
    if not unique:
        return None
    top = max(unique)
    return next(pid for pid, b in bids.items() if b == top)


class Lantern(Game):
    id = "lantern"
    category = "cards"
    howto = [
        "Each round a lot goes up for sale. Everyone secretly plays one of their bid tiles, then all bids are shown together.",
        "The highest bid that nobody else matched wins. Matching bids cancel each other out.",
        "If every bid is matched, nobody buys: the lot stays on the table and the next lot joins it.",
        "Every tile is used once, win or lose. Most points after the last lot wins.",
        "🏮 Once a game, light your lantern on a bid: if it wins, the lots count double. It burns out either way, "
        "and an unused lantern lights itself on the last lot.",
    ]
    name = "Lantern Market"
    icon = "🏮"
    blurb = ("A night-market auction: everyone bids a tile in secret, and the highest bid nobody matched "
             "takes the lot. Tied bids cancel out, so unsold lots pile up.")
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "bargain": ("🪙", "Bargain hunter", "Win lots worth 10 or more with a bid of 3 or less"),
              "bonfire": ("🔥", "Bonfire", "Win 20 or more points in one go with your lantern lit")}
    settings_schema = {
        "lots": ("Lots", [(10, "10 lots (tiles 1–10)"), (13, "13 lots (tiles 1–13)")], 10),
        "peek": ("Next lot", [(True, "👀 Shown"), (False, "Hidden")], True),
        "lamp": ("Lanterns", [(True, "🏮 One each"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        n = self.s["lots"]
        self.deck = list(range(1, n + 1))
        rng.shuffle(self.deck)  # the last item is the next lot up
        self.table = []
        self.hands = {p.id: list(range(1, n + 1)) for p in seated}
        self.score = {p.id: 0 for p in seated}
        self.bought = {p.id: 0 for p in seated}
        self.lamps = {p.id: 1 if self.s.get("lamp", True) else 0 for p in seated}
        self.choices = {}  # pid -> [bid, lit]
        self.rounds = []   # every revealed round: {"table": [...], "bids": {pid: [bid, lit, gain]}, "winner": pid}
        self.last = None
        self.round = 0
        self.room.add_log(f"🏮 The night market opens: {n} lots, and everyone holds bid tiles 1–{n}.", "big")
        self.new_round()

    # -- flow

    def new_round(self):
        r = self.room
        if not self.deck:
            return self.finish()
        self.round += 1
        lot = self.deck.pop()
        self.table.append(lot)
        self.choices = {}
        r.turn = None
        pot = sum(self.table)
        extra = f" — with {len(self.table) - 1} unsold, the table is worth {pot}" if len(self.table) > 1 else ""
        r.add_log(f"🏮 Lot {self.round}: {lot_name(lot)}{extra}.")
        live = self.room.contenders()
        if live and all(len(self.hands[p.id]) == 1 for p in live):  # the last lot: everyone's last tile goes in
            for p in live:
                self.choices[p.id] = [self.hands[p.id][0], bool(self.lamps.get(p.id))]
            r.add_log("Last lot: everyone's last tile goes in" + (", and any unused lantern lights itself." if any(self.lamps.values()) else "."))
            return self.resolve()
        r.deadline = time.time() + r.settings["timer"] if r.settings.get("timer") else None
        r.bot_at = time.time() + random.uniform(1.2, 2.8)

    def act(self, p, a):
        if a.get("type") != "bid":
            raise GameError("Unknown action.")
        if p.id not in self.hands or p.eliminated:
            raise GameError("You're not bidding in this market.")
        bid, lit = a.get("bid"), a.get("lit", False)
        if type(bid) is not int or bid not in self.hands[p.id]:
            raise GameError("Play one of your own bid tiles.")
        if type(lit) is not bool:
            raise GameError("Bad lantern.")
        if lit and not self.lamps.get(p.id):
            raise GameError("Your lantern has already burned out.")
        self.choices[p.id] = [bid, lit]
        self.maybe_resolve()

    def waiting_on(self):
        return [p for p in self.room.contenders() if p.id not in self.choices]

    def maybe_resolve(self):
        if not self.waiting_on():
            self.resolve()

    def resolve(self):
        r = self.room
        bids = {pid: c[0] for pid, c in self.choices.items()}
        win = winner_of(bids)
        pot = sum(self.table)
        rec = {"table": list(self.table), "bids": {}, "winner": win}
        self.reads = getattr(self, "reads", {})
        reads = getattr(self, "reads", {})
        rest = self.deck + [pot]
        q = sum(v < pot for v in rest) / max(1, len(rest) - 1)
        for pid, (bid, lit) in self.choices.items():
            h = self.hands[pid]
            if len(h) > 1:  # how far from a plain bid this was: public, and what the hard bot reads its rivals by
                reads.setdefault(pid, []).append(abs(h.index(bid) / (len(h) - 1) - q))
            self.hands[pid].remove(bid)
            if lit:
                self.lamps[pid] = 0
            rec["bids"][pid] = [bid, lit, 0]
        reveal = ", ".join(f"{r.players[pid].name} {b}{'🏮' if lit else ''}" for pid, (b, lit) in self.choices.items())
        r.add_log(f"Lot {self.round} bids: {reveal}", "question")
        clashed = sorted({b for b in bids.values() if list(bids.values()).count(b) > 1})
        clash = f" ({' and '.join(map(str, clashed))} clashed)" if clashed else ""
        if win:
            bid, lit = self.choices[win]
            gain = pot * 2 if lit else pot
            self.score[win] += gain
            self.bought[win] += len(self.table)
            rec["bids"][win][2] = gain
            goods = " + ".join(GOODS[v][0] for v in self.table)
            text = (f"🏮 {r.players[win].name} buys {goods} with a {bid}{clash}: "
                    + (f"lantern lit, {pot} doubled to {gain}!" if lit else f"+{gain}."))
            if pot >= 10 and bid <= 3:
                self.award(win, "bargain")
            if lit and gain >= 20:
                self.award(win, "bonfire")
            self.table = []
        else:
            text = f"🤝 Every bid was matched{clash} — nobody buys, and the lot stays on the table."
        r.add_log(text, "power")
        self.last = {"round": self.round, "text": text, "winner": win, "pot": pot, "lots": rec["table"],
                     "bids": {pid: c[:] for pid, c in self.choices.items()}}
        self.rounds.append(rec)
        self.choices = {}
        if not self.deck:
            if self.table:
                r.add_log(f"🌅 The market closes; nobody takes {' + '.join(lot_name(v) for v in self.table)}.")
            return self.finish()
        self.new_round()

    def finish(self):
        r = self.room
        if r.phase != "playing":
            return
        live = r.contenders()
        if not live:
            return r.finish(None, "Everyone left.")
        key = lambda p: (self.score[p.id], self.bought[p.id])
        top = max(key(p) for p in live)
        best = [p for p in live if key(p) == top]
        if len(best) == 1:
            r.finish(best[0], f"🏆 {best[0].name} takes the market with {top[0]} points!")
        else:
            r.finish(None, f"🤝 Tie at {top[0]} points between {' & '.join(p.name for p in best)}.")

    def on_timeout(self):
        for p in self.waiting_on():
            self.choices[p.id] = [min(self.hands[p.id]), False]
            self.room.add_log(f"⏰ {p.name} ran out of time and plays their lowest tile.", "power")
        self.resolve()

    def on_leave(self, p):
        super().on_leave(p)
        self.choices.pop(p.id, None)
        if self.room.phase == "playing":
            self.maybe_resolve()

    # -- views

    def meta(self, p):
        if p.id not in getattr(self, "score", {}):
            return ""
        locked = " · ✅" if p.id in self.choices and self.room.phase == "playing" else ""
        lamp = " · 🏮" if self.lamps.get(p.id) else ""
        return f"⭐{self.score[p.id]}{lamp}{locked}"

    def final_scores(self):
        return dict(getattr(self, "score", {}))

    def view(self, p):
        return {"lantern": {
            "round": self.round, "lots": self.s["lots"], "table": self.table,
            "next": self.deck[-1] if self.deck and self.s.get("peek", True) else None, "left": len(self.deck),
            "hands": self.hands, "score": self.score, "bought": self.bought, "lamps": self.lamps,
            "mine": self.choices.get(p.id), "waiting": [o.id for o in self.waiting_on()],
            "last": self.last, "rounds": self.rounds[-13:],
        }}

    # -- bots: everyone bids at once, so all undecided bots choose together. Hard-bot tuning (from simulate.py runs):
    KAPPA, KAPPA2, LAMP = 1.4, 0.6, 0.5  # how dear a tile is kept (3+ players, head to head), and a lantern
    DEV = 0.1  # 3+ players: how much better (a share of the pot) a move must be to leave the plain bid
    SPAN = 1  # 3+ players: how many tiles either side of the plain bid it considers
    TEMP, TEMP2 = 0.15, 0.03  # how loosely it picks among good moves, as a share of the pot
    MIX, NOISE = 0.3, 1.6  # its first picture of a rival: this share bids at random, the rest plainly with this much noise

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())

    def bot_tick(self):
        for p in [p for p in self.waiting_on() if p.bot]:
            self.choices[p.id] = self.bot_choice(p)
        self.maybe_resolve()

    def guess(self, hand, pot, rng, noise=1.2, deck=None):
        """A plain bidder: the richer the pot compared with the lots still to come, the higher up their own tiles."""
        rest = (self.deck if deck is None else deck) + [pot]
        q = sum(v < pot for v in rest) / max(1, len(rest) - 1)
        i = round(q * (len(hand) - 1) + rng.gauss(0, noise))
        return hand[max(0, min(len(hand) - 1, i))]

    def wildness(self, pid):
        """The share of a rival's bids the hard bot treats as random, read from how far their past bids strayed
        from a plain bid (a plain bidder strays ~0.1 of their hand, a random one ~0.35)."""
        seen = getattr(self, "reads", {}).get(pid, [])
        if len(seen) < 2:
            return self.MIX
        stray = sum(seen) / len(seen)
        return max(0.05, min(0.95, (stray - 0.08) / 0.25))

    def rival_bid(self, hand, pot, rng, deck, wild=None):
        """How the hard bot expects a rival to bid: like a plain bidder, or at random as often as they have so far."""
        return rng.choice(hand) if rng.random() < (self.MIX if wild is None else wild) else self.guess(hand, pot, rng, self.NOISE, deck)

    def plain_lamp(self, hand, bid, pot, deck):
        return pot >= 0.75 * max(deck + [pot]) and bid >= hand[-min(2, len(hand))]

    def bot_choice(self, p):
        hand, pot, lamp = self.hands[p.id], sum(self.table), self.lamps.get(p.id)
        rng = random.Random()
        if p.bot == "easy":
            return [rng.choice(hand), bool(lamp and rng.random() < 0.12)]
        if p.bot == "normal":
            bid = self.guess(hand, pot, rng, 1.0)
            return [bid, bool(lamp and self.plain_lamp(hand, bid, pot, self.deck))]
        return self.lookahead_choice(p, rng)

    def lookahead_choice(self, p, rng):
        """Hard: for every tile, the chance it wins this lot against rivals bidding the way they have so far
        (sampled), weighed against what the tile is worth later: its share of the market still to come."""
        me, hand, lamp, pot = p.id, self.hands[p.id], self.lamps.get(p.id), sum(self.table)
        rivals = [o.id for o in self.room.contenders() if o.id != me]
        wild = {o: self.wildness(o) for o in rivals}
        tries, wins = 400, {b: 0 for b in hand}
        for _ in range(tries):
            others = {o: self.rival_bid(self.hands[o], pot, rng, self.deck, wild[o]) for o in rivals}
            for b in hand:
                wins[b] += winner_of({**others, me: b}) == me
        style = 0.8 + 0.4 * random.Random(me).random()  # each hard bot prices its tiles a little differently
        worth = style * (self.KAPPA if rivals[1:] else self.KAPPA2) * (sum(self.deck) + pot) / max(1, sum(hand))  # points a tile-pip buys, on average
        lamp_worth = self.LAMP * max(self.deck, default=0)
        moves = []
        pick = hand
        if rivals[1:]:  # 3+ players: stay near the plain bid (bidding to the lot holds up well in a crowd), or dump the lowest tile
            rest = self.deck + [pot]
            i0 = round(sum(v < pot for v in rest) / max(1, len(rest) - 1) * (len(hand) - 1))
            pick = sorted({hand[0], *hand[max(0, i0 - self.SPAN):i0 + self.SPAN + 1]})
        for b in pick:
            pw = wins[b] / tries
            moves.append((pw * pot - worth * b, b, False))
            if lamp:
                moves.append((pw * pot * 2 - worth * b - lamp_worth, b, True))
        if rivals[1:]:  # in a crowd, bid plainly unless the lookahead finds something clearly better
            b0 = self.guess(hand, pot, rng, 0.8)
            l0 = bool(lamp and self.plain_lamp(hand, b0, pot, self.deck))
            base = next((m[0] for m in moves if m[1:] == (b0, l0)), None)
            if base is None:
                pw = wins[b0] / tries
                base = pw * pot * (2 if l0 else 1) - worth * b0 - (lamp_worth if l0 else 0)
            if len(rivals) >= 4 or max(m[0] for m in moves) - base < self.DEV * max(2, pot):  # 5–6 is a lottery: stay plain
                return [b0, l0]
        # a mixed strategy (softmax): a predictable bidder gets matched, and two hard bots would clash every time
        temp = (self.TEMP if rivals[1:] else self.TEMP2) * max(2, pot)  # head to head it pays to be sharper
        top = max(m[0] for m in moves)
        weights = [math.exp((m[0] - top) / temp) for m in moves]
        _, b, lit = rng.choices(moves, weights)[0]
        return [b, lit]
