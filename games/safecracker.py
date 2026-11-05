"""Safecracker: an original code-breaking race. The server hides one colour code and everybody
cracks the same safe at the same time. Each round everyone secretly locks in a guess, then all the
guesses are revealed together with their hints: ● (right colour, right spot) and ○ (right colour,
wrong spot). So you learn from your rivals' guesses as well as your own, and nobody gains from
going last. A match is several safes: cracking one alone scores 3, sharing the crack scores 2. Once
per safe your 🔍 probe privately tells you how many of one colour the code holds, for a point less.
In a ⚔️ duel (two players) each secretly sets a code and both race to crack the other's."""
import random
import time
from collections import Counter
from itertools import product

from .base import Game, GameError

REVEAL_SECS = 5  # pause on an opened safe before the next one


def pegs(code, guess):
    """(exact, near): exact = right colour in the right spot, near = right colour elsewhere."""
    exact = sum(a == b for a, b in zip(code, guess))
    common = sum((Counter(code) & Counter(guess)).values())
    return exact, common - exact


class Safecracker(Game):
    id = "safecracker"
    category = "words"
    howto = [
        "Everyone cracks the same hidden colour code. Each round, tap colours to build a guess and lock it in.",
        "When everyone has locked in, all guesses are revealed: ● a right colour in the right spot, ○ a right colour in the wrong spot.",
        "Use your rivals' clues as well as your own.",
        "Crack it alone for 3 points, or 2 if others crack it in the same round. If nobody does before the rounds run out, the closest guess gets 1.",
        "Once per safe, 🔍 Probe a colour to learn privately how many of it the code holds. It costs a point if you crack that safe.",
        "Most points after the last safe wins. Alone, crack every safe.",
        "⚔️ Duel (2 players): each of you secretly sets a code, then you race to crack each other's.",
    ]
    name = "Safecracker"
    icon = "🔐"
    blurb = "Everyone cracks the same colour code at once, and every guess is revealed to the table."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "quick": ("⚡", "Light fingers", "Crack a safe within three guesses")}
    settings_schema = {
        "mode": ("Mode", [("race", "🏁 Race: one shared safe"), ("duel", "⚔️ Duel: set each other's code (2 players)")], "race"),
        "length": ("Code length", [(4, "4 pegs"), (5, "5 pegs")], 4),
        "colors": ("Colours", [(6, "6"), (8, "8")], 6),
        "repeats": ("Repeated colours", [(True, "Allowed"), (False, "No repeats")], True),
        "safes": ("Safes", [(1, "1"), (3, "3"), (5, "5")], 3),
        "guesses": ("Guesses per safe", [(8, "8"), (10, "10"), (12, "12")], 10),
        "daily": ("Codes", [(False, "🎲 Random"), (True, "📅 Today's safes (the same everywhere)")], False),
    }

    duel = False  # rooms saved before duels existed

    # -- setup

    def __setstate__(self, state):
        self.__dict__.update(state)
        if not isinstance(self.__dict__.get("cands"), dict):  # it was one shared list (or None)
            self.cands = {}
        self.__dict__.setdefault("codes", {})

    def start(self, seated, rng):
        self.rng = rng
        self.length, self.colors, self.repeats = self.s["length"], self.s["colors"], self.s["repeats"]
        self.rounds, self.safes = self.s["guesses"], self.s["safes"]
        self.safe = 0
        for p in seated:
            p.g.score = 0
            p.g.cracks = 0
        self.opened = None  # the last safe's code, shown between safes
        self.duel = self.s["mode"] == "duel" and len(seated) == 2
        if self.s["mode"] == "duel" and not self.duel:
            self.room.add_log("⚔️ A duel needs exactly two players, so this is a race for one shared safe.")
        self.room.add_log(f"🔐 Safecracker! {self.safes} safe{'s' if self.safes > 1 else ''}, each a {self.length}-peg "
                          f"code from {self.colors} colours{'' if self.repeats else ' (no repeats)'}.", "big")
        self.new_safe()

    def late_join(self, p):
        """Join at 0 and lock in guesses from the round that's running (races only: a duel is two people)."""
        if self.duel:
            raise GameError("A duel is just the two of you. You'll get a seat for the next game.")
        p.g.score = 0
        p.g.cracks = 0
        p.g.best = (0, 0)
        p.g.probe = None

    def new_safe(self):
        self.mark_round()
        self.safe += 1
        if self.s.get("daily") and not self.duel:  # 📅 the code comes from the date and the settings alone
            seed = f"safe {time.strftime('%Y-%m-%d')} {self.length} {self.colors} {self.repeats} {self.safe}"
            self.code = self.random_code(random.Random(seed))
        else:
            self.code = self.random_code(self.rng)
        self.codes = {}  # duel: each player's own secret code, the one their rival cracks
        self.history = []  # one list per finished round: [{"by", "code", "exact", "near"}]
        self.round = 0
        self.stage = "set" if self.duel else "crack"
        self.cands = {}  # per cracker (None in a race): codes that fit the revealed guesses, built when a bot needs them
        for p in self.room.contenders():
            p.g.best = (0, 0)
            p.g.probe = None  # (colour, count)
        if self.safes > 1:
            self.room.add_log(f"🔐 Safe {self.safe}/{self.safes}.")
        if self.duel:
            self.locked = {}
            self.room.turn = None
            self.room.deadline = time.time() + self.room.settings["timer"] if self.room.settings["timer"] else None
            self.room.bot_at = time.time() + random.uniform(1, 2.5)
            self.room.add_log("⚔️ Set a secret code for your rival to crack.")
            return
        self.new_round()

    def random_code(self, rng):
        pool = list(range(self.colors))
        return [rng.choice(pool) for _ in range(self.length)] if self.repeats else rng.sample(pool, self.length)

    def target(self, p):
        """The code p is cracking: the shared safe, or in a duel the rival's code."""
        if not self.duel:
            return self.code
        return next(c for pid, c in self.codes.items() if pid != p.id)

    def set_code(self, p, code):
        self.codes[p.id] = code
        if len(self.codes) == len(self.room.contenders()):
            self.room.add_log("⚔️ Both codes are set. Crack!", "big")
            self.stage = "crack"
            self.new_round()

    def new_round(self):
        r = self.room
        self.round += 1
        self.locked = {}  # pid -> code
        r.turn = None
        r.deadline = time.time() + r.settings["timer"] if r.settings["timer"] else None
        r.bot_at = time.time() + random.uniform(1.5, 3.5)

    def waiting_on(self):
        if self.stage == "set":
            return [p for p in self.room.contenders() if p.id not in self.codes]
        if self.stage != "crack":
            return []
        return [p for p in self.room.contenders() if p.id not in self.locked]

    # -- actions

    def check_code(self, code):
        if (not isinstance(code, list) or len(code) != self.length
                or not all(isinstance(c, int) and not isinstance(c, bool) and 0 <= c < self.colors for c in code)):
            raise GameError(f"Pick {self.length} colours.")
        if not self.repeats and len(set(code)) != len(code):
            raise GameError("No repeated colours in this game.")
        return code

    def act(self, p, a):
        if p.spectator or p.eliminated or not hasattr(p.g, "score"):
            raise GameError("You're watching this game.")
        kind = a.get("type")
        if kind == "set" and self.stage == "set":
            if p.id in self.codes:
                raise GameError("Your code is set.")
            return self.set_code(p, self.check_code(a.get("pegs")))
        if self.stage == "set":
            raise GameError("Set your secret code first.")
        if self.stage != "crack":
            raise GameError("Wait for the next safe.")
        if kind == "guess":
            if p.id in self.locked:
                raise GameError("You've locked in this round.")
            self.locked[p.id] = self.check_code(a.get("pegs"))
            self.maybe_resolve()
        elif kind == "probe":
            c = a.get("color")
            if not isinstance(c, int) or isinstance(c, bool) or not 0 <= c < self.colors:
                raise GameError("Pick a colour to probe.")
            self.probe(p, c)
        else:
            raise GameError("Unknown action.")

    def probe(self, p, c):
        if p.g.probe is not None:
            raise GameError("You've already used your probe on this safe.")
        n = self.target(p).count(c)
        p.g.probe = (c, n)
        self.room.add_log(f"🔍 {p.name} used their probe.")
        self.room.add_log(f"🔍 The code holds {n} of colour {c + 1}.", "private", to=p.id)

    def maybe_resolve(self):
        if self.stage == "crack" and not self.waiting_on():
            self.resolve()

    def resolve(self):
        r = self.room
        shown = []
        for pid, code in self.locked.items():
            p = r.players[pid]
            exact, near = pegs(self.target(p), code)
            p.g.best = max(p.g.best, (exact, near))
            shown.append({"by": pid, "code": code, "exact": exact, "near": near})
            r.add_log(f"🔐 {p.name}: {'·'.join(str(c + 1) for c in code)} → {'●' * exact + '○' * near or '—'}", "question")
        self.history.append(shown)
        for key, cands in self.cands.items():
            self.cands[key] = [c for c in cands if all(pegs(c, h["code"]) == (h["exact"], h["near"])
                                                         for h in shown if key is None or h["by"] == key)]
        crackers = [r.players[h["by"]] for h in shown if h["exact"] == self.length]
        if crackers:
            return self.cracked(crackers)
        if self.round >= self.rounds:
            return self.out_of_guesses()
        self.new_round()

    def cracked(self, crackers):
        rounds = f"{self.round} guess{'es' if self.round > 1 else ''}"
        alone = len(crackers) == 1
        parts = []
        for p in crackers:
            p.g.cracks += 1
            if self.round <= 3:
                self.award(p, "quick")
            pts = (3 if alone else 2) - (1 if p.g.probe else 0)
            p.g.score += pts
            parts.append(f"{p.name} +{pts}{' (probed)' if p.g.probe else ''}")
        self.end_safe(f"🔓 {' & '.join(p.name for p in crackers)} cracked safe {self.safe} in {rounds}! "
                      + ("" if len(self.room.seated()) == 1 else " · ".join(parts)))

    def out_of_guesses(self):
        dots = lambda code: "·".join(str(c + 1) for c in code)
        ranked = sorted(self.room.contenders(), key=lambda q: q.g.best, reverse=True)
        text = (f"🔒 Nobody cracked safe {self.safe}: it was {dots(self.code)}." if not self.duel else
                "🔒 Neither code was cracked: " + " · ".join(f"{self.room.players[pid].name}'s was {dots(c)}"
                                                            for pid, c in self.codes.items() if pid in self.room.players) + ".")
        if len(ranked) > 1 and ranked[0].g.best > ranked[1].g.best:
            ranked[0].g.score += 1
            b = ranked[0].g.best
            text += f" {ranked[0].name} came closest ({'●' * b[0]}{'○' * b[1]}) +1."
        self.end_safe(text)

    def end_safe(self, text):
        r = self.room
        self.opened = list(self.code) if not self.duel else [[pid, c] for pid, c in self.codes.items()]
        r.add_log(text, "big")
        if self.safe >= self.safes:
            return self.finish_game()
        self.stage = "open"
        r.deadline = time.time() + REVEAL_SECS
        r.bot_at = r.deadline

    def finish_game(self):
        r = self.room
        live = r.contenders()
        if len(r.seated()) == 1:
            p = live[0] if live else r.seated()[0]
            cracked = p.g.cracks
            if cracked == self.safes:
                return r.finish(p, f"🏆 {p.name} cracked every safe! {p.g.score} points.")
            return r.finish(None, f"🔒 {p.name} cracked {cracked} of {self.safes} safes ({p.g.score} points).")
        ranked = sorted(live, key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 It's a tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Safecracker! {text}")

    def on_timeout(self):
        if self.stage == "open":
            return self.new_safe()
        if self.stage == "set":
            for p in self.waiting_on():
                if not p.bot:
                    self.room.add_log(f"⏰ {p.name} didn't set a code, so a random one is set.", "power")
                self.set_code(p, self.random_code(random))
            return
        for p in self.waiting_on():
            if p.bot:
                self.locked[p.id] = self.bot_guess(p)
            else:
                self.room.add_log(f"⏰ {p.name} didn't lock in a guess.", "power")
        self.resolve()

    def on_leave(self, p):
        super().on_leave(p)
        self.locked.pop(p.id, None)
        if self.room.phase == "playing" and self.duel and len(self.room.contenders()) < 2:
            return self.finish_game()
        if self.room.phase == "playing":
            self.maybe_resolve()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        b = p.g.best
        done = self.codes if self.stage == "set" else self.locked
        locked = " ✅" if p.id in done and self.stage in ("set", "crack") and self.room.phase == "playing" else ""
        pegs_ = "●" * b[0] + "○" * b[1]
        return f"{p.g.score} pts" + (f" · {pegs_}" if pegs_ and self.stage == "crack" else "") + (" 🔍" if p.g.probe else "") + locked

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        probe = getattr(p.g, "probe", None)
        return {"safecracker": {
            "length": self.length, "colors": self.colors, "repeats": self.repeats,
            "rounds": self.rounds, "round": self.round, "history": self.history, "stage": self.stage,
            "safe": self.safe, "safes": self.safes, "opened": self.opened if self.stage == "open" else None,
            "standings": self.standings() if self.stage == "open" else None,
            "waiting": [o.id for o in self.waiting_on()],
            "mine": self.codes.get(p.id) if self.stage == "set" else self.locked.get(p.id),
            "duel": self.duel, "mySet": self.codes.get(p.id) if self.duel else None,
            "daily": bool(self.s.get("daily")) and not self.duel,
            "probed": [q.id for q in self.room.seated() if getattr(q.g, "probe", None) is not None],
            "myProbe": list(probe) if probe else None,
            # 🔐 how many codes still fit every clue revealed so far (the bots' own list)
            "fit": len(self.consistent(p)) if self.stage == "crack" and self.history and (not self.duel or p.id in self.codes) else None,
            "code": (self.code if not self.duel else [[pid, c] for pid, c in self.codes.items()])
            if self.room.phase == "over" else None,
        }}

    # -- bots: everyone moves at once, so all undecided bots lock in together

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())  # nobody is waited on between safes

    def bot_tick(self):
        if self.stage == "set":
            for p in [p for p in self.waiting_on() if p.bot]:
                self.set_code(p, self.random_code(random))
            return
        for p in [p for p in self.waiting_on() if p.bot]:
            self.locked[p.id] = self.bot_guess(p)
        self.maybe_resolve()

    def all_codes(self):
        codes = product(range(self.colors), repeat=self.length)
        return [list(c) for c in codes if self.repeats or len(set(c)) == self.length]

    def consistent(self, p):
        """Codes that fit every revealed guess at p's target so far (kept up to date after each round)."""
        key = p.id if self.duel else None
        if key not in self.cands:
            self.cands[key] = [c for c in self.all_codes()
                               if all(pegs(c, h["code"]) == (h["exact"], h["near"])
                                      for rnd in self.history for h in rnd if key is None or h["by"] == key)]
        return self.cands[key]

    @staticmethod
    def spread(guess, sample):
        """Expected number of codes left after playing guess, if the code is one of sample."""
        sizes = Counter(pegs(c, guess) for c in sample)
        return sum(n * n for n in sizes.values()) / len(sample)

    def bot_guess(self, p):
        level = p.bot or "normal"  # autopilot stand-ins play like a normal bot
        if level == "easy" and random.random() < 0.6:
            # Easy bots mostly keep track of their own clues only.
            mine = [h for rnd in self.history for h in rnd if h["by"] == p.id]
            for _ in range(400):
                g = [random.randrange(self.colors) for _ in range(self.length)]
                if (self.repeats or len(set(g)) == len(g)) and all(
                        pegs(g, h["code"]) == (h["exact"], h["near"]) for h in mine):
                    return g
        cands = self.consistent(p)
        # The hard bot probes only when the answer should all but pin the code down (a probe costs a point).
        if level == "hard" and p.g.probe is None and 2 < len(cands) <= 40:
            left = {col: sum(v * v for v in Counter(x.count(col) for x in cands).values()) / len(cands)
                    for col in range(self.colors)}
            best = min(left, key=left.get)
            if left[best] <= 1.6:
                self.probe(p, best)
        if p.g.probe is not None:
            c, n = p.g.probe
            cands = [x for x in cands if x.count(c) == n] or cands
        if level == "hard" and 2 < len(cands) <= 3000:
            sample = cands if len(cands) <= 250 else random.sample(cands, 250)
            options = cands if len(cands) <= 80 else random.sample(cands, 80)
            # one of its three most telling guesses, so two hard bots don't keep guessing (and sharing) alike
            return list(random.choice(sorted(options, key=lambda g: self.spread(g, sample))[:3]))
        return list(random.choice(cands))
