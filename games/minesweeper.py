"""Minesweeper: the public-domain mine-clearing puzzle, raced. Everyone gets the same minefield with the same
opening already cleared. Each safe square you uncover scores a point; a mine costs points but does not end
your game, so the race stays on. Clearing every safe square scores a bonus, and finishing first more.

A board is a flat list, row by row. Per player: `o` (0 hidden, 1 open, 2 a mine you set off) and `f` (a flag
you planted, 0/1). The mines are only sent to the browsers when the puzzle is over."""
import random

from .base import GameError
from .puzzlerace import PuzzleRace

LEVELS = {"easy": (9, 10), "medium": (12, 22), "hard": (14, 38)}   # side, mines
MINE_COST = 4
HINT_COST = 1


def neighbours(n):
    out = []
    for i in range(n * n):
        r, c = divmod(i, n)
        out.append(tuple((r + dr) * n + c + dc for dr in (-1, 0, 1) for dc in (-1, 0, 1)
                         if (dr or dc) and 0 <= r + dr < n and 0 <= c + dc < n))
    return out


def make_board(rng, n, mines):
    """(mine flags, start cell): the start cell and its neighbours are mine-free, so it opens a patch."""
    nb = neighbours(n)
    start = rng.choice([i for i in range(n * n) if 1 < i // n < n - 2 and 1 < i % n < n - 2] or [0])
    ban = {start, *nb[start]}
    cells = [i for i in range(n * n) if i not in ban]
    rng.shuffle(cells)
    mine = [0] * (n * n)
    for i in cells[:mines]:
        mine[i] = 1
    return mine, start


def counts(mine, nb):
    return [sum(mine[j] for j in nb[i]) for i in range(len(mine))]


def flood(o, mine, cnt, nb, i):
    """Open cell i (a safe one); a 0 opens its neighbours too. Returns how many cells opened."""
    opened, stack = 0, [i]
    while stack:
        k = stack.pop()
        if o[k] or mine[k]:
            continue
        o[k] = 1
        opened += 1
        if cnt[k] == 0:
            stack.extend(j for j in nb[k] if not o[j])
    return opened


class Minesweeper(PuzzleRace):
    id = "minesweeper"
    category = "classic"
    name = "Minesweeper"
    icon = "💣"
    noun = "minefield"
    blurb = "The mine-clearing puzzle as a race: same minefield for everyone, every safe square scores."
    howto = [
        "Numbers say how many of the 8 squares around them hide a mine. Uncover every safe square and none of the mines. Everyone gets the same field, with a patch already open.",
        "Tap a square to uncover it (+1 each). Hit a mine and you lose 4 points, but you play on. 🚩 switches to flags: tap to mark a mine you've worked out. Tap a number whose flags are all placed to uncover the rest around it.",
        "💡 uncovers a square that is safe, for 1 point (3 per field unless the host changes it).",
        "Clearing every safe square scores +10, and +5 more for finishing first. Most points after the last field wins.",
        "Alone, clear every field before the clock runs out to win (or just clear them, with 🌿 No clock).",
    ]
    settings_schema = {
        "level": ("Field", [("easy", "Easy: 9×9, 10 mines"), ("medium", "Medium: 12×12, 22 mines"), ("hard", "Hard: 14×14, 38 mines")], "easy"),
        "rounds": ("Fields", [(1, "1"), (2, "2"), (3, "3")], 1),
        "secs": ("Time per field", [(300, "5 min"), (180, "3 min"), (600, "10 min"), (0, "🌿 No clock")], 300),
        "hints": ("💡 Hints per field", [(3, "3"), (1, "1"), (5, "5"), (0, "None"), (-1, "Unlimited")], 3),
        "daily": ("Fields", [(False, "🎲 Random"), (True, "📅 Today's fields (the same everywhere)")], False),
    }
    badges = {**PuzzleRace.badges, "clean": ("🧹", "Clean sweep", "Clear a field without setting off a mine or using a hint")}
    BOT = {"easy": 6.0, "normal": 4.0, "hard": 2.4}   # seconds per square

    def new_puzzle(self, rng):
        lv = self.s.get("level", "easy")
        self.level = lv if lv in LEVELS else "easy"
        self.n, self.k = LEVELS[self.level]
        self.nb = neighbours(self.n)
        self.mine, self.start = make_board(random.Random(rng.random()), self.n, self.k)
        self.cnt = counts(self.mine, self.nb)
        self.safe = self.n * self.n - self.k
        self.o0 = [0] * (self.n * self.n)
        flood(self.o0, self.mine, self.cnt, self.nb, self.start)
        return f"{self.n}×{self.n}, {self.k} mines, {self.safe - sum(self.o0)} safe squares to find"

    def fresh(self):
        return {"o": list(self.o0), "f": [0] * (self.n * self.n), "mine": 0, "boom": 0, "hints": 0,
                "miss": None, "hint": None, "seq": 0}

    def opened(self, st):
        return sum(1 for v in st["o"] if v == 1)

    def finished(self, pid):
        st = self.st.get(pid)
        return bool(st) and self.opened(st) >= self.safe

    def progress(self, pid):
        return [self.opened(self.st[pid]), self.safe]

    def points(self, p):
        st = self.st[p.id]
        return st["mine"] - MINE_COST * st["boom"] - HINT_COST * st["hints"]

    def on_finish(self, p, secs):
        st = self.st[p.id]
        if not st["boom"] and not st["hints"]:
            self.award(p, "clean")

    # -- moves

    def cell_of(self, a):
        i = a.get("cell")
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < self.n * self.n:
            raise GameError("Pick a square.")
        return i

    def move(self, p, st, a):
        kind = a.get("type")
        if kind == "open":
            self.open(st, self.cell_of(a))
        elif kind == "flag":
            i = self.cell_of(a)
            if st["o"][i]:
                raise GameError("That square is already open.")
            st["f"][i] ^= 1
            st["seq"] += 1
        elif kind == "chord":
            i = self.cell_of(a)
            if st["o"][i] != 1 or not self.cnt[i]:
                raise GameError("Tap an open number.")
            around = self.nb[i]
            if sum(st["f"][j] for j in around) != self.cnt[i]:
                raise GameError("Place that many flags around it first.")
            for j in around:
                if not st["o"][j] and not st["f"][j]:
                    self.open(st, j)
        elif kind == "hint":
            if self.hints_left(st) == 0:
                raise GameError("No hints left for this field." if self.s.get("hints", 3) else "Hints are off in this game.")
            i = self.hint_cell(st)
            if i is None:
                raise GameError("Nothing left to uncover.")
            st["f"][i] = 0
            self.open(st, i, hint=True)
            st["hints"] += 1
            st["hint"] = i
        else:
            raise GameError("Unknown action.")

    def hints_left(self, st):
        cap = self.s.get("hints", 3)
        return None if cap is None or cap < 0 else max(0, cap - st["hints"])

    def hint_cell(self, st):
        """A safe hidden square next to an open one if there is one (else any safe hidden square)."""
        safe = [i for i in range(self.n * self.n) if not st["o"][i] and not self.mine[i]]
        edge = [i for i in safe if any(st["o"][j] == 1 for j in self.nb[i])]
        return self.rng.choice(edge or safe) if safe else None

    def open(self, st, i, hint=False):
        if st["o"][i]:
            raise GameError("That square is already open.")
        if st["f"][i]:
            raise GameError("Take the flag off first.")
        st["seq"] += 1
        st["hint"] = None
        if self.mine[i]:
            st["o"][i] = 2
            st["boom"] += 1
            st["miss"] = i
            return
        st["miss"] = None
        got = flood(st["o"], self.mine, self.cnt, self.nb, i)
        for j in range(self.n * self.n):
            if st["o"][j] == 1:
                st["f"][j] = 0
        st["mine"] += got

    # -- bots: they reason from the numbers like a person, and only guess when they're stuck

    def deduce(self, st, subsets):
        """(safe squares, mine squares) the open numbers prove. Hidden squares and set-off mines are all unknown or known."""
        o, nb = st["o"], self.nb
        known = {i for i in range(self.n * self.n) if o[i] == 2}
        safe, mines = set(), set()
        rules = []
        for i in range(self.n * self.n):
            if o[i] != 1 or not self.cnt[i]:
                continue
            hid = {j for j in nb[i] if o[j] == 0}
            need = self.cnt[i] - sum(1 for j in nb[i] if j in known)
            if not hid:
                continue
            if need == 0:
                safe |= hid
            elif need == len(hid):
                mines |= hid
            else:
                rules.append((frozenset(hid), need))
        if not safe and subsets:   # the "1-1" style: one number's squares sit inside another's
            for a, na in rules:
                for b, nb2 in rules:
                    if a != b and a < b:
                        diff, dn = b - a, nb2 - na
                        if dn == 0:
                            safe |= diff
                        elif dn == len(diff):
                            mines |= diff
        return safe - mines, mines

    def bot_move(self, p, st):
        if self.opened(st) >= self.safe:
            return False
        safe, mines = self.deduce(st, p.bot != "easy")
        for j in mines:   # it marks what it has proved, as a tidy player would
            st["f"][j] = 1
        if safe:
            i = min(safe)
            st["f"][i] = 0
            return self.open(st, i)
        i = self.guess(st)
        st["f"][i] = 0
        return self.open(st, i)

    def guess(self, st):
        """The hidden square least likely to hold a mine, judging by the numbers that touch it (else a random one)."""
        o, nb = st["o"], self.nb
        hidden = [i for i in range(self.n * self.n) if o[i] == 0]
        known = sum(1 for v in o if v == 2) + sum(1 for i in hidden if st["f"][i])
        density = max(0.0, (self.k - known) / max(1, len(hidden)))
        best, bp = None, 2.0
        for i in hidden:
            ps = []
            for j in nb[i]:
                if o[j] == 1 and self.cnt[j]:
                    hid = [x for x in nb[j] if o[x] == 0]
                    need = self.cnt[j] - sum(1 for x in nb[j] if o[x] == 2)
                    ps.append(need / max(1, len(hid)))
            pr = max(ps) if ps else density
            pr += self.rng.random() * 0.02
            if pr < bp:
                best, bp = i, pr
        return best

    # -- view

    def public(self, p):
        st = self.st.get(p.id)
        n2 = self.n * self.n
        if st:
            grid = [(self.cnt[i] if st["o"][i] == 1 else 9 if st["o"][i] == 2 else -2 if st["f"][i] else -1) for i in range(n2)]
            flags = sum(st["f"])
        else:
            grid = [(self.cnt[i] if self.o0[i] else -1) for i in range(n2)]
            flags = 0
        out = {"n": self.n, "mines": self.k, "level": self.level, "grid": grid, "flags": flags,
               "boom": st["boom"] if st else 0, "hints": st["hints"] if st else 0, "mine": st["mine"] if st else 0,
               "miss": st["miss"] if st else None, "hint": st["hint"] if st else None, "seq": st["seq"] if st else 0,
               "hintsLeft": self.hints_left(st) if st else None, "safe": self.safe, "show": None}
        if self.stage == "reveal" or self.room.phase == "over":
            out["show"] = self.mine
        return out
