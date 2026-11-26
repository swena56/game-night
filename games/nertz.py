"""Nertz (Racing Demon, Pounce): competitive real-time solitaire, for 2-6 players, each with their own deck.

Everyone deals themselves a Nertz pile of 13 (top card up), four work piles of one card each, and keeps
the rest as a stock to turn three at a time onto a waste pile. Then everyone plays at once, no turns:
aces go to the shared middle, where anyone builds them up by suit (A 2 3 … K). Your work piles build
down in alternating colours, and an empty one takes any card. Your goal is to empty your Nertz pile:
the moment someone does, the round stops. Score +1 for each of your cards in the middle and −2 for each
card left in your Nertz pile. First to the target wins."""
import random
import time

from .cardbase import CardGame, GameError, deck, rank, suit, pretty, show

ORDER = "A23456789TJQK"
IDX = {r: k for k, r in enumerate(ORDER)}
RED = set("HD")
PACE = {"easy": (2.6, 3.8), "normal": (1.6, 2.5), "hard": (1.0, 1.6)}   # seconds per bot move


class Nertz(CardGame):
    id = "nertz"
    solo_bots = 2
    name = "Nertz"
    icon = "🏁"
    blurb = "Real-time racing solitaire: everyone plays at once onto shared aces. Empty your Nertz pile first!"
    howto = [
        "Everyone plays at once, no turns. Your Nertz pile (13 cards) is the one to empty.",
        "Aces go to the middle, and anyone builds them up by suit: A 2 3 … K.",
        "Your four work piles build down in alternating colours; an empty one takes any card.",
        "Stuck? Flip three from your stock onto your waste pile and play its top card.",
        "The round stops when someone empties their Nertz pile. +1 per card of yours in the middle, −2 per card left in your Nertz pile.",
    ]
    min_players, max_players = 2, 6
    replayable = False
    badges = {**CardGame.badges, "nertz": ("🏁", "Nertz!", "Empty your Nertz pile first")}
    settings_schema = {
        "target": ("Game to", [(50, "50 points"), (25, "25 points (quick)"), (100, "100 points")], 50),
        "secs": ("Round time", [(180, "3 minutes"), (120, "2 minutes"), (300, "5 minutes")], 180),
    }

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.scores = [0] * self.n
        self.round = 0
        self.room.add_log(f"🏁 Nertz to {self.s['target']}! Everyone plays at once.", "big")
        self.deal()

    def deal(self):
        self.round += 1
        self.nz, self.work, self.stock, self.waste = [], [], [], []
        for k in range(self.n):
            cards = deck()
            self.rng.shuffle(cards)
            self.nz.append(cards[:13])
            self.work.append([[c] for c in cards[13:17]])
            self.stock.append(cards[17:])
            self.waste.append([])
        self.found = []                 # [[(card, owner), ...], ...]
        self.played = [0] * self.n      # cards each put in the middle this round
        self.last = None
        self.idle = 0
        self.stage = "play"
        r = self.room
        r.turn = None
        self.after = None
        self.waiting = set(range(self.n))
        self.ends = time.time() + self.s.get("secs", 180)
        r.deadline = self.ends
        now = time.time()
        for k in range(self.n):
            p = self.pl(k)
            if p and self.auto(k):
                p.g.next_at = now + 2 + random.uniform(*PACE[self.level(k)])
        self.sync_bot_at()
        self.room.add_log(f"🃏 Round {self.round}: go!")

    def sync_bot_at(self):
        times = [getattr(self.pl(k).g, "next_at", 0) for k in range(self.n) if self.pl(k) and self.auto(k)]
        if times:
            self.room.bot_at = min(times)

    # -- the cards

    def top(self, i, src):
        if src == "n":
            return self.nz[i][0] if self.nz[i] else None
        if src == "x":
            return self.waste[i][-1] if self.waste[i] else None
        if src[0] == "w":
            pile = self.work[i][int(src[1])]
            return pile[-1] if pile else None
        return None

    def fits_found(self, c):
        """The foundation index c can go on, -1 for a new one (an ace), or None."""
        if rank(c) == "A":
            return -1
        for f, pile in enumerate(self.found):
            t = pile[-1][0]
            if suit(t) == suit(c) and IDX[rank(t)] + 1 == IDX[rank(c)]:
                return f
        return None

    def fits_work(self, i, c, k, src=None):
        if src == f"w{k}":
            return False
        pile = self.work[i][k]
        if not pile:
            return True
        t = pile[-1]
        return (suit(t) in RED) != (suit(c) in RED) and IDX[rank(t)] == IDX[rank(c)] + 1

    def options(self, i):
        """Every move: (source key, destination key, label)."""
        out = []
        for src in ["n", "x"] + [f"w{k}" for k in range(4)]:
            c = self.top(i, src)
            if not c:
                continue
            f = self.fits_found(c)
            if f is not None:
                out.append((src, "f", "→ the middle"))
            for k in range(4):
                if self.fits_work(i, c, k, src) and not (src[0] == "w" and len(self.work[i][int(src[1])]) == 1 and not self.work[i][k]):
                    out.append((src, f"w{k}", f"→ pile {k + 1}"))
        return out

    def take(self, i, src):
        if src == "n":
            return self.nz[i].pop(0)
        if src == "x":
            return self.waste[i].pop()
        return self.work[i][int(src[1])].pop()

    def move(self, i, src, dst):
        c = self.top(i, src)
        if not c:
            raise GameError("Nothing there.")
        if dst == "f":
            f = self.fits_found(c)
            if f is None:
                raise GameError("Someone got there first!" if rank(c) != "A" else "That doesn't go in the middle.")
            self.take(i, src)
            if f == -1:
                self.found.append([(c, i)])
            else:
                self.found[f].append((c, i))
            self.played[i] += 1
            self.idle = 0
            self.last = {"seat": i, "card": c}
        else:
            k = int(dst[1])
            if not self.fits_work(i, c, k, src):
                raise GameError("Work piles go down in alternating colours.")
            self.take(i, src)
            self.work[i][k].append(c)
        if src == "n" and not self.nz[i]:
            return self.call_nertz(i)

    def flip(self, i):
        self.idle += 1
        if self.idle > 60 * self.n:
            self.room.add_log("😵 Everyone's stuck: the round ends.", "big")
            return self.end_round()
        if not self.stock[i]:
            if not self.waste[i]:
                raise GameError("Nothing left to flip.")
            self.stock[i] = self.waste[i]
            self.waste[i] = []
            return
        self.waste[i] += self.stock[i][:3]
        self.stock[i] = self.stock[i][3:]

    # -- the round

    def call_nertz(self, i):
        if self.pl(i):
            self.award(self.pl(i), "nertz")
        self.moment(f"🏁 NERTZ! {self.nm(i)} empties their pile!", "gold", "fanfare")
        self.end_round()

    def end_round(self):
        gains = [self.played[k] - 2 * len(self.nz[k]) for k in range(self.n)]
        for k in range(self.n):
            self.scores[k] += gains[k]
        self.gains = gains
        self.room.add_log("🧮 " + " · ".join(f"{self.nm(k)} {gains[k]:+} ({self.scores[k]})" for k in range(self.n)), "big")
        self.waiting = set()
        if max(self.scores) >= self.s["target"]:
            return self.win_by_score(self.scores)
        self.stage = "score"
        self.pause(self.deal, 5)

    # -- actions, clock, bots

    def act(self, p, a):
        i = self.act_seat(p)
        if self.stage != "play":
            raise GameError("Wait for the next round.")
        t = a.get("type")
        if t == "flip":
            return self.flip(i)
        if t == "move":
            src, dst = a.get("from"), a.get("to")
            if src not in ("n", "x", "w0", "w1", "w2", "w3") or dst not in ("f", "w0", "w1", "w2", "w3"):
                raise GameError("Pick a card and where it goes.")
            return self.move(i, src, dst)
        raise GameError("Unknown action.")

    def on_timeout(self):
        if self.after:
            return super().on_timeout()
        if self.stage == "play":
            self.room.add_log("⏱️ Time! The round ends.", "big")
            self.end_round()

    def bot_ready(self):
        if self.stage != "play" or self.room.phase != "playing":
            return False
        now = time.time()
        return any(self.auto(k) and self.pl(k) and getattr(self.pl(k).g, "next_at", 0) <= now for k in range(self.n))

    def bot_tick(self):
        now = time.time()
        due = [k for k in range(self.n) if self.auto(k) and self.pl(k) and getattr(self.pl(k).g, "next_at", 0) <= now]
        if not due:
            return
        # the earliest due; ties (the simulator zeroes every clock) go by each bot's speed
        first = min(getattr(self.pl(k).g, "next_at", 0) for k in due)
        due = [k for k in due if getattr(self.pl(k).g, "next_at", 0) == first]
        k = random.choices(due, weights=[1 / sum(PACE[self.level(k)]) for k in due])[0]
        lvl = self.level(k)
        self.pl(k).g.next_at = now + random.uniform(*PACE[lvl])
        self.bot_move(k, lvl)
        if self.stage == "play":
            self.sync_bot_at()

    def bot_move(self, i, level):
        if self.stage != "play":
            return
        opts = self.options(i)
        def rank_opt(o):
            src, dst, _ = o
            v = 0
            if dst == "f":
                v += 50 + (10 if src == "n" else 5 if src[0] == "w" else 0)
            elif src == "n":
                v += 30
            elif src == "x":
                v += 12
            elif src[0] == "w" and dst[0] == "w":
                v -= 5 if self.work[i][int(src[1])][:-1] else 100     # shuffling work piles rarely helps
            if level == "easy":
                v += random.uniform(-20, 20)
            return v
        good = [o for o in opts if rank_opt(o) > 0]
        if good and not (level == "easy" and random.random() < 0.15):
            src, dst, _ = max(good, key=rank_opt)
            try:
                return self.move(i, src, dst)
            except GameError:
                pass
        if self.stock[i] or self.waste[i]:
            self.flip(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🏁 {len(self.nz[i])} · {self.scores[i]} pts"

    def final_scores(self):
        return {pid: self.scores[k] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"tags": [f"🏁 {len(self.nz[k])} left · ⬆ {self.played[k]}"], "show": [self.nz[k][0]] if self.nz[k] else []} for k in range(self.n)]
        tops = [pile[-1][0] for pile in self.found]
        t = {"info": info,
             "piles": [{"cards": tops[:24], "fan": len(tops) > 1, "small": True,
                        "label": f"The middle: {len(self.found)} pile{'s' if len(self.found) != 1 else ''}" if self.found else "The middle: aces start piles here"}],
             "banner": f"Round {self.round}" if self.stage == "play" else "Round over",
             "scores": {"title": "Points", "rows": [{"seat": k, "value": self.scores[k], "sub": f"{self.gains[k]:+} last round" if hasattr(self, 'gains') else ""}
                                                    for k in sorted(range(self.n), key=lambda k: -self.scores[k])],
                        "hint": f"Game to {self.s['target']}. +1 per card in the middle, −2 per Nertz card left."}}
        if self.stage == "play":
            left = max(0, int(self.ends - time.time()))
            t["scores"]["hint"] += f" ⏱ {left // 60}:{left % 60:02d}"
        if i is None:
            return t
        work = [self.work[i][k][-1] if self.work[i][k] else None for k in range(4)]
        t["rows"] = [
            {"label": f"Nertz ({len(self.nz[i])})", "cards": [self.nz[i][0]] if self.nz[i] else [], "keys": ["n"]},
            {"label": "Work", "cards": [c or "" for c in work], "keys": ["w0", "w1", "w2", "w3"]},
            {"label": f"Waste ({len(self.waste[i])})", "cards": self.waste[i][-1:], "keys": ["x"]},
        ]
        t["hint_counts"] = [len(p) for p in self.work[i]]
        if self.stage == "play":
            t["moves"] = [{"card": s, "label": label, "a": {"type": "move", "from": s, "to": d}} for s, d, label in self.options(i)]
            t["buttons"] = [{"label": f"🔄 Flip 3 ({len(self.stock[i])})" if self.stock[i] else "↩ Turn the waste over", "a": {"type": "flip"}, "kind": "primary"}]
            t["note"] = "Tap a card to move it; empty work piles take anything."
            t["turnText"] = f"🏁 Go! {len(self.nz[i])} left in your Nertz pile"
            t["mine"] = True
        return t
