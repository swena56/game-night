"""Word Ladder: Lewis Carroll's public-domain "doublets" puzzle, raced. Everyone gets the same two
words and climbs from one to the other by changing one letter at a time, every step a real word.
Short ladders and quick finishes score most."""
import random
import time
from collections import deque

from .base import Game, GameError
from .ladder_words import BRIDGE, COMMON
from .wordsmith import words

ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
REVEAL_SECS = 7
PAR = {3: (3, 5), 4: (4, 6), 5: (4, 7)}   # the everyday-word ladder lengths a puzzle may have
FINISH, OVER_PAR, FIRST, HINT = 10, 2, 5, 3
PEEK = 1  # 🔎 shows which letter to change next, for a point
BOT = {  # chance each step heads the right way, and seconds per step
    "easy": (0.55, 6.0, 11.0),
    "normal": (0.72, 4.0, 8.0),
    "hard": (0.88, 2.5, 5.0),
}

_dist = {}   # target -> {word: steps to target}; a module cache, so it isn't saved with the room


def familiar(n):
    """Everyday words of length n (the bridges included): the pool for par, hints and bots."""
    dic = words()
    return {w for w in COMMON[n] | BRIDGE.get(n, frozenset()) if w in dic}


def neighbours(w, pool=None):
    """Words one letter away from `w`: from the whole dictionary, or only from `pool`."""
    pool = words() if pool is None else pool
    for i, ch in enumerate(w):
        for c in ALPHA:
            if c != ch:
                x = w[:i] + c + w[i + 1:]
                if x in pool:
                    yield x


def distances(target):
    """Steps from every everyday word to `target` using everyday words only (cached). Par, hints and
    bots all use this, so the ladders they show never lean on obscure words."""
    if target not in _dist:
        if len(_dist) > 40:
            _dist.clear()
        pool = familiar(len(target))
        seen = {target: 0}
        todo = deque([target])
        while todo:
            w = todo.popleft()
            for x in neighbours(w, pool):
                if x not in seen:
                    seen[x] = seen[w] + 1
                    todo.append(x)
        _dist[target] = seen
    return _dist[target]


def one_apart(a, b):
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1


class Ladder(Game):
    id = "ladder"
    category = "words"
    howto = [
        "Everyone gets the same two words. Climb from the top word to the bottom one.",
        "Each step changes exactly one letter and must be a real word: COLD → CORD → CARD → WARD → WARM.",
        f"Par is the shortest ladder of everyday words. Finishing scores {FINISH}, minus {OVER_PAR} for every step over par; the first to finish gets +{FIRST}.",
        f"Stuck? ↩ takes back a step for free, 🔎 shows which letter to change next for {PEEK} point, and 💡 fills in the next step for {HINT} points.",
        "Most points after the last ladder wins. Alone, finish every ladder to win.",
    ]
    name = "Word Ladder"
    icon = "🧗"
    blurb = "Change one letter at a time to climb from word to word: Lewis Carroll's puzzle, as a race."
    min_players = 1
    max_players = 6
    settings_schema = {
        "size": ("Word length", [(4, "4 letters"), (3, "3 letters"), (5, "5 letters (harder)")], 4),
        "rounds": ("Ladders", [(3, "3"), (5, "5"), (1, "1")], 3),
        "secs": ("Time per ladder", [(90, "90 s"), (120, "2 min"), (60, "60 s")], 90),
        "daily": ("Puzzles", [(False, "🎲 Random"), (True, "📅 Today's ladders (the same everywhere)")], False),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0  # the bot simulator fast-forwards this virtual clock
        self.n_len = self.s["size"]
        self.used = set()
        # 📅 daily: the puzzles come from the date alone, so every room plays the same ladders today
        today = time.strftime("%Y-%m-%d")
        self.prng = random.Random(f"ladder {today} {self.n_len}") if self.s.get("daily") else rng
        self.ids = []
        self.round = 0
        self.solo = len(seated) == 1
        for p in seated:
            self.late_join(p)
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🧗 Word Ladder! {self.s['rounds']} ladders of {self.n_len}-letter words"
                          + (f" (📅 the ladders for {today})" if self.s.get("daily") else "") + ". Change one letter at a time.", "big")
        self.next_round()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def late_join(self, p):
        p.g.score = 0
        p.g.finished = 0
        self.ids.append(p.id)
        if getattr(self, "start_word", None):
            self.paths[p.id] = [self.start_word]

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def puzzle_rng(self):
        return getattr(self, "prng", None) or self.rng

    def pick_puzzle(self):
        bridge = BRIDGE.get(self.n_len, frozenset())  # plurals and past tenses are steps, never ends
        pool = sorted(w for w in familiar(self.n_len) if w not in self.used and w not in bridge)
        lo, hi = PAR[self.n_len]
        for _ in range(400):
            a = self.puzzle_rng().choice(pool)
            d = distances(a)
            ends = [b for b in pool if lo <= d.get(b, 0) <= hi and b not in self.used]
            if ends:
                b = self.puzzle_rng().choice(ends)
                return a, b, d[b]
        a, b = self.puzzle_rng().sample(pool, 2)   # practically unreachable; keep the game going
        return a, b, distances(b).get(a, 9)

    def next_round(self):
        self.round += 1
        a, b, par = self.pick_puzzle()
        self.used |= {a, b}
        self.start_word, self.target, self.par = a, b, par
        self.paths = {pid: [a] for pid in self.ids}
        self.done = {}      # pid -> seconds taken
        self.hints = {}     # pid -> hints used this round
        self.peeks = {}     # pid -> peeks used this round
        self.peek = {}      # pid -> [word, spot]: the letter of `word` to change next
        self.gained = {}
        self.stage = "climb"
        self.t0 = self.now()
        self.end = self.t0 + self.s["secs"]
        self.plans = []
        for p in self.live():
            if p.bot:
                self.plan(p)
        self.sync()
        self.room.add_log(f"🧗 Ladder {self.round}/{self.s['rounds']}: {a} → {b} (par {par} steps).", "question")

    # -- bots

    def plan(self, p):
        _, lo, hi = BOT.get(p.bot, BOT["normal"])
        self.plans = [x for x in self.plans if x[1] != p.id]
        self.plans.append((self.now() + self.rng.uniform(lo, hi), p.id))
        self.plans.sort()

    def best_step(self, w, avoid=()):
        """The next everyday word on a shortest everyday-word ladder from `w` (which may itself be an
        unusual word a player typed)."""
        d = distances(self.target)
        options = [x for x in neighbours(w, d) if x not in avoid]
        if not options:
            return None
        if w in d:
            options = [x for x in options if d[x] == d[w] - 1] or options
        low = min(d[x] for x in options)
        return self.rng.choice(sorted(x for x in options if d[x] == low))

    def bot_step(self, p):
        path = self.paths[p.id]
        know = BOT.get(p.bot, BOT["normal"])[0]
        nxt = None
        if self.rng.random() < know:
            nxt = self.best_step(path[-1], path)
        if nxt is None:
            d = distances(self.target)
            here = d.get(path[-1], 99)
            # A wrong turn: an everyday word that doesn't get closer. Back up instead if that leads nowhere.
            wander = sorted(x for x in neighbours(path[-1], d) if x not in path and d[x] <= here + 1)
            if wander:
                nxt = self.rng.choice(wander)
            elif len(path) > 1:
                path.pop()
                return
            else:
                nxt = self.best_step(path[-1], path)
        if nxt:
            self.add_step(p, nxt)

    # -- the clock

    def sync(self):
        self.room.deadline = self.next_event() - self.skew

    def next_event(self):
        return min([self.end] + [t for t, _ in self.plans[:1]])

    def bot_ready(self):
        return self.room.phase == "playing" and self.now() >= self.next_event()

    def bot_tick(self):
        self.process()

    def on_timeout(self):
        gap = self.next_event() - self.now()
        if gap > 0:
            self.skew += gap
        self.process()

    def process(self):
        now = self.now()
        if self.stage == "reveal":
            if now >= self.end:
                return self.finish_game() if self.round >= self.s["rounds"] else self.next_round()
            return
        while self.plans and self.plans[0][0] <= now and self.stage == "climb":
            _, pid = self.plans.pop(0)
            p = self.room.players.get(pid)
            if p and p in self.live() and pid not in self.done:
                self.bot_step(p)
                if pid not in self.done and self.stage == "climb":
                    self.plan(p)
        if self.stage != "climb":
            return
        if now >= self.end or not self.waiting_on():
            return self.reveal()
        self.sync()

    # -- actions

    def act(self, p, a):
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        kind = a.get("type")
        if self.stage != "climb" or self.now() >= self.end:
            raise GameError("Time's up for this ladder.")
        if p.id in self.done:
            raise GameError("You've already finished this one.")
        path = self.paths.setdefault(p.id, [self.start_word])
        if kind == "step":
            w = a.get("word")
            if not isinstance(w, str):
                raise GameError("Type a word.")
            w = w.strip().upper()
            if len(w) != self.n_len or not w.isalpha() or not w.isascii():
                raise GameError(f"Words here have {self.n_len} letters.")
            if not one_apart(w, path[-1]):
                raise GameError(f"Change exactly one letter of {path[-1]}.")
            if w in path:
                raise GameError(f"{w} is already on your ladder.")
            if w not in words():
                raise GameError(f"{w} isn't in the dictionary.")
            self.add_step(p, w)
        elif kind == "undo":
            if len(path) < 2:
                raise GameError("Nothing to take back.")
            path.pop()
        elif kind == "hint":
            nxt = self.best_step(path[-1], path)
            if nxt is None:   # the ladder doubled back on itself: undo to get unstuck
                raise GameError("No way on from here without repeating — take a step back.")
            self.hints[p.id] = self.hints.get(p.id, 0) + 1
            self.add_step(p, nxt)
        elif kind == "peek":
            peek = getattr(self, "peek", {})
            if peek.get(p.id, [None])[0] == path[-1]:
                raise GameError("You've already peeked at this step.")
            nxt = self.best_step(path[-1], path)
            if nxt is None:
                raise GameError("No way on from here without repeating — take a step back.")
            spot = next(i for i, (x, y) in enumerate(zip(path[-1], nxt)) if x != y)
            self.peek = {**peek, p.id: [path[-1], spot]}
            self.peeks = {**getattr(self, "peeks", {}), p.id: getattr(self, "peeks", {}).get(p.id, 0) + 1}
        else:
            raise GameError("Unknown action.")

    def add_step(self, p, w):
        path = self.paths[p.id]
        path.append(w)
        if w != self.target:
            return
        self.done[p.id] = self.now() - self.t0
        first = len(self.done) == 1 and not self.solo
        steps = len(path) - 1
        pts = max(2, FINISH - OVER_PAR * max(0, steps - self.par)) + (FIRST if first else 0)
        pts = max(0, pts - HINT * self.hints.get(p.id, 0) - PEEK * getattr(self, "peeks", {}).get(p.id, 0))
        p.g.score += pts
        p.g.finished += 1
        self.gained[p.id] = pts
        self.plans = [x for x in self.plans if x[1] != p.id]
        extra = f", {steps - self.par} over par" if steps > self.par else ", on par!"
        self.room.add_log(f"🏁 {p.name} reached {self.target} in {steps} steps{extra} +{pts}" + (" (first!)" if first else ""), "power")
        if not self.waiting_on():
            self.reveal()

    def waiting_on(self):
        return [p for p in self.live() if p.id not in self.done] if self.stage == "climb" else []

    def reveal(self):
        self.solution = [self.start_word]
        while self.solution[-1] != self.target and len(self.solution) < 20:
            nxt = self.best_step(self.solution[-1], self.solution)
            if not nxt:
                break
            self.solution.append(nxt)
        for p in self.live():
            self.gained.setdefault(p.id, 0)
        self.room.add_log(f"🧗 One shortest ladder: {' → '.join(self.solution)}")
        self.stage = "reveal"
        self.plans = []
        self.end = self.now() + REVEAL_SECS
        self.sync()

    def finish_game(self):
        r = self.room
        live = self.live()
        if self.solo and len(live) == 1:
            p = live[0]
            text = f"{p.g.finished}/{self.s['rounds']} ladders, {p.g.score} points"
            if p.g.finished >= self.s["rounds"]:
                return r.finish(p, f"🏆 {p.name} climbed every ladder: {text}!")
            return r.finish(None, f"🧗 {p.name}: {text}. Finish them all to win — try again!")
        if not live:
            return r.finish(None, "Everyone left.")
        ranked = sorted(live, key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 Tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Word Ladder! {text}")

    def on_leave(self, p):
        self.room.add_log(f"{p.name} left the game.")
        p.eliminated = True
        self.plans = [x for x in self.plans if x[1] != p.id]
        live = self.live()
        if not live or (not self.solo and len(live) < 2):
            return self.finish_game()
        if self.stage == "climb" and not self.waiting_on():
            self.reveal()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"{p.g.score} pts" + (" · 🏁" if self.stage == "climb" and p.id in self.done else "")

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        reveal = self.stage == "reveal" or self.room.phase == "over"
        out = {
            "stage": self.stage, "round": self.round, "rounds": self.s["rounds"], "len": self.n_len,
            "start": self.start_word, "target": self.target, "par": self.par,
            "path": self.paths.get(p.id, [self.start_word]),
            "done": p.id in self.done,
            "playing": p.id in self.ids and not p.eliminated,
            "left": max(0.0, self.end - self.now()), "secs": self.s["secs"] if self.stage == "climb" else REVEAL_SECS,
            "progress": {pid: [len(path) - 1, pid in self.done] for pid, path in self.paths.items()},
            "solo": self.solo,
            "peek": next((x[1] for x in [getattr(self, "peek", {}).get(p.id)] if x and x[0] == self.paths.get(p.id, [self.start_word])[-1]), None),
            "reveal": None,
        }
        if reveal:
            out["reveal"] = {"paths": self.paths, "solution": getattr(self, "solution", []), "gained": self.gained}
        return {"ladder": out}
