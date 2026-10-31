"""Grid Hunt: an original timed word hunt. Everyone searches the same freshly shaken letter grid
at once, tracing words through touching tiles (diagonals count, no tile twice). When time runs out
the lists are compared: a word somebody else also found scores nothing, so the rare finds win.
A ⭐ star tile doubles every word that uses it. Words come from the Wordsmith dictionary."""
import random
import time
from bisect import bisect_left
from collections import Counter

from .base import Game, GameError
from .wordsmith import words

REVEAL_SECS = 10   # pause on the results between rounds
MAX_LEN = 11       # the dictionary's longest words
# English-ish letter weights; Q always comes as QU
WEIGHTS = {"E": 12, "A": 9, "I": 8, "O": 8, "T": 8, "N": 7, "R": 7, "S": 7, "L": 5, "U": 4, "D": 4, "C": 4,
           "H": 3, "M": 3, "P": 3, "G": 3, "B": 2, "Y": 2, "F": 2, "W": 2, "K": 1, "V": 1,
           "X": .5, "Z": .5, "J": .4, "Q": .4}
VOWELS = set("AEIOU")

_sorted = None


def sorted_words():
    global _sorted
    if _sorted is None:
        _sorted = sorted(words())
    return _sorted


def has_prefix(prefix):
    lst = sorted_words()
    i = bisect_left(lst, prefix)
    return i < len(lst) and lst[i].startswith(prefix)


def neighbours(i, n):
    r, c = divmod(i, n)
    return [rr * n + cc for rr in range(r - 1, r + 2) for cc in range(c - 1, c + 2)
            if (rr, cc) != (r, c) and 0 <= rr < n and 0 <= cc < n]


def solve(tiles, n, min_len, star=-1):
    """Every dictionary word that can be traced on the grid: {word: whether some tracing uses the star}."""
    dic, found = words(), {}
    adj = [neighbours(i, n) for i in range(n * n)]

    def walk(i, word, path):
        if len(word) > MAX_LEN or not has_prefix(word):
            return
        if len(word) >= min_len and word in dic:
            found[word] = found.get(word, False) or star in path
        for j in adj[i]:
            if j not in path:
                path.append(j)
                walk(j, word + tiles[j], path)
                path.pop()

    for i in range(n * n):
        walk(i, tiles[i], [i])
    return found


def value(word):
    return max(1, len(word) - 2)


class GridHunt(Game):
    id = "gridhunt"
    category = "words"
    howto = [
        "Everyone hunts in the same letter grid at the same time.",
        "Trace a word through touching tiles (diagonals too, no tile twice): drag across them, or tap them one by one and tap the last tile again to send. On a keyboard, just type.",
        "Words need 3+ letters on the 4×4 grid, 4+ on the 5×5. Points: length − 2. A word through the ⭐ star tile scores double.",
        "When time is up, a word anyone else also found scores nothing. Find the words nobody else sees!",
        "Alone, every word counts: reach the target score to win.",
    ]
    name = "Grid Hunt"
    icon = "🔎"
    blurb = "Race the clock to find words in a shaken letter grid. Words a rival also found don't count."
    min_players = 1
    max_players = 6
    settings_schema = {
        "size": ("Grid", [(4, "4×4"), (5, "5×5")], 4),
        "secs": ("Time per round", [(60, "1 min"), (90, "1½ min"), (120, "2 min"), (180, "3 min")], 90),
        "rounds": ("Rounds", [(1, "1"), (2, "2"), (3, "3")], 2),
    }

    # -- setup and clock

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0  # the bot simulator fast-forwards this virtual clock
        self.n = self.s["size"]
        self.min_len = 3 if self.n == 4 else 4
        self.round = 0
        for p in seated:
            self.late_join(p)
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🔎 Grid Hunt! {self.s['rounds']} round{'s' if self.s['rounds'] > 1 else ''} on a "
                          f"{self.n}×{self.n} grid. Words a rival also finds score nothing.", "big")
        self.new_round()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift  # the round resumes where it was when the server stopped

    def late_join(self, p):
        """Start hunting straight away, at 0 points."""
        p.g.score = 0
        p.g.words = []
        p.g.round_pts = 0

    def shake(self):
        letters, weights = list(WEIGHTS), list(WEIGHTS.values())
        cells = self.n * self.n
        while True:
            tiles = self.rng.choices(letters, weights, k=cells)
            v = sum(t in VOWELS for t in tiles)
            if cells * 0.25 <= v <= cells * 0.45:
                return ["QU" if t == "Q" else t for t in tiles]

    def new_round(self):
        self.round += 1
        best = None
        for _ in range(25):  # keep shaking until the grid is rich enough
            tiles, star = self.shake(), self.rng.randrange(self.n * self.n)
            found = solve(tiles, self.n, self.min_len, star)
            if best is None or len(found) > len(best[1]):
                best = (tiles, found, star)
            if len(found) >= (45 if self.n == 4 else 70):
                break
        self.tiles, self.all, self.star = best
        self.stage = "hunt"
        self.t0 = self.now()
        self.end = self.t0 + self.s["secs"]
        self.room.deadline = self.end - self.skew
        self.results = None
        for p in self.room.contenders():
            p.g.words = []
            p.g.round_pts = 0
        self.plan_bots()
        self.room.add_log(f"🔀 Round {self.round}/{self.s['rounds']}: a new grid with {len(self.all)} words in it. Go!")

    def plan_bots(self):
        """Each bot spots a share of the grid's words (more when harder, fewer long ones) at random moments."""
        self.plans = []
        span = self.s["secs"] / 90
        for p in self.room.contenders():
            if not p.bot:
                continue
            share = {"easy": 0.05, "normal": 0.09, "hard": 0.15}[p.bot] * min(1.6, span)
            for w in self.all:
                fall = 1.0 if len(w) <= 4 else 0.7 if len(w) == 5 else 0.45 if len(w) == 6 else 0.25
                if random.random() < share * fall:
                    self.plans.append((self.t0 + random.uniform(3, self.s["secs"] - 1), p.id, w))
        self.plans.sort()

    def next_event(self):
        return min([self.end] + [t for t, _, _ in self.plans[:1]])

    # -- clock hooks: the room polls bot_ready/bot_tick; on_timeout fast-forwards (and ends rounds)

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
                if self.round >= self.s["rounds"]:
                    return self.finish_game()
                self.new_round()
            return
        while self.plans and self.plans[0][0] <= now:
            _, pid, w = self.plans.pop(0)
            p = self.room.players.get(pid)
            if p and not p.eliminated and w not in p.g.words:
                p.g.words.append(w)
        if now >= self.end:
            self.reveal()

    # -- words

    def act(self, p, a):
        if a.get("type") != "word":
            raise GameError("Unknown action.")
        if p.spectator or p.eliminated or not hasattr(p.g, "words"):
            raise GameError("You're watching this game.")
        if self.stage != "hunt" or self.now() >= self.end:
            raise GameError("Wait for the next grid.")
        w = a.get("word")
        if not isinstance(w, str) or not w.isascii() or not w.isalpha() or len(w) > 25:
            raise GameError("Letters only.")
        w = w.upper()
        if len(w) < self.min_len:
            raise GameError(f"Words need at least {self.min_len} letters here.")
        if w in p.g.words:
            raise GameError(f"You already have {w}.")
        if w not in self.all:
            raise GameError(f"{w} isn't in the dictionary." if w not in words() else f"{w} can't be traced on this grid.")
        p.g.words.append(w)

    def points(self, w):
        return value(w) * (2 if self.all[w] else 1)

    def reveal(self):
        live = self.room.contenders()
        counts = Counter(w for p in live for w in set(p.g.words))
        for p in live:
            p.g.round_pts = sum(self.points(w) for w in p.g.words if counts[w] == 1)
            p.g.score += p.g.round_pts
        missed = sorted((w for w in self.all if not counts[w]), key=lambda w: (-len(w), w))[:8]
        self.results = {
            "lists": {p.id: [[w, self.points(w), counts[w] > 1] for w in sorted(p.g.words, key=lambda w: (-len(w), w))]
                      for p in live},
            "pts": {p.id: p.g.round_pts for p in live},
            "missed": [[w, self.points(w)] for w in missed],
        }
        ranked = sorted(live, key=lambda q: -q.g.round_pts)
        self.room.add_log(f"⏱️ Time! Round {self.round}: " + " · ".join(f"{q.name} +{q.g.round_pts}" for q in ranked)
                          + (f". Longest missed: {missed[0]}." if missed else ""), "big")
        self.stage = "reveal"
        self.plans = []
        self.end = self.now() + REVEAL_SECS
        self.room.deadline = self.end - self.skew

    def target(self):
        """The solo goal: about what a quick human finds (20 a round on 4×4, 30 on 5×5, for 90 s)."""
        return round((20 if self.n == 4 else 30) * self.s["rounds"] * self.s["secs"] / 90)

    def finish_game(self):
        r = self.room
        if len(r.seated()) == 1:
            p = r.seated()[0]
            goal = self.target()
            if p.g.score >= goal:
                return r.finish(p, f"🏆 {p.name} scores {p.g.score} — past the {goal}-point target!")
            return r.finish(None, f"🔎 {p.name} scores {p.g.score}; the target was {goal}.")
        ranked = sorted(r.contenders(), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 It's a tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Grid Hunt! {text}")

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.contenders() if hasattr(q.g, "score")}

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return f"{p.g.score} pts · {len(p.g.words)} words" if self.stage == "hunt" else f"{p.g.score} pts"

    def lengths(self, mine):
        """[[word length (7 means 7+), how many such words you haven't found yet], ...], shortest first."""
        left = {}
        have = set(mine)
        for w in self.all:
            if w not in have:
                k = min(len(w), 7)
                left[k] = left.get(k, 0) + 1
        return sorted(left.items())

    def view(self, p):
        mine = getattr(p.g, "words", [])
        open_ = self.stage == "reveal" or self.room.phase == "over"
        return {"gridhunt": {
            "stage": self.stage, "round": self.round, "rounds": self.s["rounds"], "n": self.n,
            "tiles": self.tiles, "star": self.star, "minLen": self.min_len, "total": len(self.all),
            "left": max(0.0, self.end - self.now()), "secs": self.s["secs"],
            "mine": [[w, self.points(w)] for w in mine],
            "lengths": self.lengths(mine),
            "counts": {q.id: len(q.g.words) for q in self.room.contenders() if hasattr(q.g, "words")},
            "results": self.results if open_ else None,
            "target": self.target() if len(self.room.seated()) == 1 else None,
        }}
