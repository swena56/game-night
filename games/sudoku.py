"""Sudoku: the public-domain number-place puzzle, raced. Everyone gets the same grid; each correct
digit scores, wrong guesses cost, and finishing first earns a bonus.

Grids are flat lists (row by row), 0 for blank. A 9×9 grid has 3×3 boxes; the 6×6 mini has 2×3 boxes
(two rows, three columns). Every puzzle has exactly one solution. Easy puzzles fall to "only one digit
fits this cell" alone; medium ones also need "this digit fits only one cell of this row/column/box";
hard ones may need more."""
import random

from .base import GameError
from .puzzlerace import PuzzleRace

LEVELS = {  # level -> (logic the puzzle must yield to: 1 naked singles, 2 + hidden singles, 9 any; fewest givens per size)
    "easy": (1, {9: 38, 6: 18}),
    "medium": (2, {9: 30, 6: 13}),
    "hard": (9, {9: 0, 6: 0}),
}
HINT_COST = 1


class Shape:
    """Rows, columns and boxes of an n×n grid, with each cell's peers."""

    _cache = {}

    def __new__(cls, n):
        if n not in cls._cache:
            self = super().__new__(cls)
            self.n = n
            self.bh, self.bw = (3, 3) if n == 9 else (2, 3)
            self.full = (1 << (n + 1)) - 2   # bits 1..n
            rows = [[r * n + c for c in range(n)] for r in range(n)]
            cols = [[r * n + c for r in range(n)] for c in range(n)]
            boxes = []
            for br in range(0, n, self.bh):
                for bc in range(0, n, self.bw):
                    boxes.append([(br + r) * n + bc + c for r in range(self.bh) for c in range(self.bw)])
            self.units = rows + cols + boxes
            self.peers = []
            for i in range(n * n):
                ps = set()
                for u in self.units:
                    if i in u:
                        ps.update(u)
                ps.discard(i)
                self.peers.append(tuple(sorted(ps)))
            cls._cache[n] = self
        return cls._cache[n]

    def cands(self, g, i):
        m = self.full
        for j in self.peers[i]:
            if g[j]:
                m &= ~(1 << g[j])
        return m


def bits(m):
    return [d for d in range(1, 10) if m >> d & 1]


def count_solutions(g, sh, limit=2, rng=None, out=None):
    """How many solutions `g` has, stopping at `limit`. With `rng`, tries digits in random order; with `out`
    (a list), the first solution found is stored in it."""
    g = list(g)
    found = 0

    def go():
        nonlocal found
        best, bm, bc = -1, 0, 99
        for i, v in enumerate(g):
            if not v:
                m = sh.cands(g, i)
                c = bin(m).count("1")
                if c < bc:
                    best, bm, bc = i, m, c
                    if c <= 1:
                        break
        if best < 0:
            found += 1
            if out is not None and not out:
                out.extend(g)
            return found >= limit
        if bc == 0:
            return False
        ds = bits(bm)
        if rng:
            rng.shuffle(ds)
        for d in ds:
            g[best] = d
            if go():
                return True
        g[best] = 0
        return False

    go()
    return found


def single_step(g, sh, level):
    """One cell that logic of this level can fill: (cell, digit, how) or None. how is 'naked' | 'hidden'."""
    cm = {i: sh.cands(g, i) for i, v in enumerate(g) if not v}
    for i, m in cm.items():
        if m and m & (m - 1) == 0:
            return i, m.bit_length() - 1, "naked"
    if level >= 2:
        for u in sh.units:
            for d in range(1, sh.n + 1):
                if any(g[i] == d for i in u):
                    continue
                spots = [i for i in u if i in cm and cm[i] >> d & 1]
                if len(spots) == 1:
                    return spots[0], d, "hidden"
    return None


def explain_step(g, sh, i, d, how):
    """A short, spoiler-free reason for a hint: names the row, column or box that forces the digit."""
    n = sh.n
    r, c = i // n + 1, i % n + 1
    where = f"Row {r}, column {c}"
    if how == "naked":
        return (f"{where}: the digits already in its row, column and box rule out every other number, "
                f"so only {d} fits.")
    if how == "hidden":
        for k, u in enumerate(sh.units):
            if i not in u or any(g[j] == d for j in u):
                continue
            if sum(1 for j in u if not g[j] and sh.cands(g, j) >> d & 1) == 1:
                kind = "row" if k < n else "column" if k < 2 * n else "box"
                label = k + 1 if k < n else k - n + 1 if k < 2 * n else k - 2 * n + 1
                return (f"In {kind} {label}, {d} has nowhere else to go: every other empty cell there "
                        f"is blocked by a {d} in its own row, column or box. So {where} must be {d}.")
    return (f"{where}: no single cell was forced by simple logic here, so this one was filled in "
            f"from the solution. Try the cells with the fewest candidates next.")


def logic_solves(g, sh, level):
    g = list(g)
    while 0 in g:
        s = single_step(g, sh, level)
        if not s:
            return False
        g[s[0]] = s[1]
    return True


def make_puzzle(rng, n, level):
    """(puzzle, solution) with exactly one solution, as hard as `level` allows."""
    sh = Shape(n)
    sol = []
    count_solutions([0] * (n * n), sh, 1, rng, sol)
    need, floor = LEVELS[level][0], LEVELS[level][1][n]
    g = list(sol)
    order = list(range(n * n))
    rng.shuffle(order)
    givens = n * n
    for i in order:
        if givens <= floor:
            break
        keep = g[i]
        g[i] = 0
        if count_solutions(g, sh, 2) != 1 or (need < 9 and not logic_solves(g, sh, need)):
            g[i] = keep
        else:
            givens -= 1
    return g, sol


class Sudoku(PuzzleRace):
    id = "sudoku"
    category = "classic"
    name = "Sudoku"
    icon = "🔢"
    noun = "puzzle"
    blurb = "The number-place puzzle as a race: everyone gets the same grid, and every right digit scores."
    howto = [
        "Fill every row, column and box with each digit once. Everyone gets the same puzzle.",
        "Tap a cell, then a digit. A right digit scores 1 point and stays; a wrong one costs 1 point and bounces off.",
        "✏️ switches to pencil marks: small notes only you can see. 💡 fills in a cell that can be worked out, for 1 point (3 per puzzle unless the host changes it).",
        "Finishing the grid scores +10, and +5 more for finishing first. Most points after the last puzzle wins.",
        "Alone, finish every puzzle before the clock runs out to win (or just finish them, with 🌿 No clock).",
    ]
    settings_schema = {
        "size": ("Grid", [(9, "9×9"), (6, "6×6 mini")], 9),
        "level": ("Difficulty", [("easy", "Easy"), ("medium", "Medium"), ("hard", "Hard")], "easy"),
        "rounds": ("Puzzles", [(1, "1"), (2, "2"), (3, "3")], 1),
        "secs": ("Time per puzzle", [(900, "15 min"), (600, "10 min"), (1200, "20 min"), (300, "5 min"), (0, "🌿 No clock")], 900),
        "hints": ("💡 Hints per puzzle", [(3, "3"), (1, "1"), (5, "5"), (0, "None"), (-1, "Unlimited")], 3),
        "daily": ("Puzzles", [(False, "🎲 Random"), (True, "📅 Today's puzzles (the same everywhere)")], False),
    }
    badges = {**PuzzleRace.badges, "clean": ("✨", "Clean sheet", "Finish a 9×9 grid with no mistakes and no hints")}
    # seconds a bot spends per digit, before the puzzle's difficulty and size
    BOT = {"easy": 18.0, "normal": 11.0, "hard": 6.0}
    SLOW = {"easy": 1.0, "medium": 1.35, "hard": 1.8}

    def new_puzzle(self, rng):
        self.n = self.s.get("size", 9)
        if self.n not in (6, 9):
            self.n = 9
        level = self.s.get("level", "easy")
        self.level = level if level in LEVELS else "easy"
        self.puzzle, self.sol = make_puzzle(random.Random(rng.random()), self.n, self.level)
        self.blanks = self.puzzle.count(0)
        return f"{self.n}×{self.n}, {self.level}, {self.blanks} cells to fill"

    def fresh(self):
        return {"g": list(self.puzzle), "mine": 0, "wrong": 0, "hints": 0, "miss": None, "hint": None, "seq": 0}

    def finished(self, pid):
        st = self.st.get(pid)
        return bool(st) and 0 not in st["g"]

    def progress(self, pid):
        st = self.st[pid]
        return [self.blanks - st["g"].count(0), self.blanks]

    def points(self, p):
        st = self.st[p.id]
        return st["mine"] - st["wrong"] - HINT_COST * st["hints"]

    def on_finish(self, p, secs):
        st = self.st[p.id]
        if self.n == 9 and not st["wrong"] and not st["hints"]:
            self.award(p, "clean")

    # -- moves

    def move(self, p, st, a):
        kind = a.get("type")
        if kind == "put":
            i, d = a.get("cell"), a.get("digit")
            if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < self.n * self.n:
                raise GameError("Pick a cell.")
            if not isinstance(d, int) or isinstance(d, bool) or not 1 <= d <= self.n:
                raise GameError(f"Digits go from 1 to {self.n}.")
            self.put(st, i, d)
        elif kind == "hint":
            if self.hints_left(st) == 0:
                raise GameError("No hints left for this puzzle." if self.s.get("hints", 3) else "Hints are off in this game.")
            s = single_step(st["g"], Shape(self.n), 2)
            i = s[0] if s else next(k for k, v in enumerate(st["g"]) if not v)
            st["why"] = explain_step(st["g"], Shape(self.n), i, self.sol[i], s[2] if s else None)
            st["g"][i] = self.sol[i]
            st["hints"] += 1
            st["hint"] = i
            st["seq"] += 1
        else:
            raise GameError("Unknown action.")

    def hints_left(self, st):
        """Hints this player can still take on this puzzle; None = unlimited."""
        cap = self.s.get("hints", 3)
        return None if cap is None or cap < 0 else max(0, cap - st["hints"])

    def put(self, st, i, d):
        if st["g"][i]:
            raise GameError("That cell is already filled.")
        st["seq"] += 1
        st["hint"] = None
        st["why"] = None
        if self.sol[i] == d:
            st["g"][i] = d
            st["mine"] += 1
            st["miss"] = None
        else:
            st["wrong"] += 1
            st["miss"] = [i, d]

    # -- bots: they work the grid with the same logic a person would

    def bot_pace(self, p, st):
        base = self.BOT.get(p.bot or "normal", 11.0) * self.SLOW.get(getattr(self, "level", "easy"), 1.0)
        if getattr(self, "n", 9) == 6:
            base *= 0.7
        return base * self.rng.uniform(0.7, 1.3)

    def bot_move(self, p, st):
        g, sh = st["g"], Shape(self.n)
        if 0 not in g:
            return False
        level = 1 if p.bot == "easy" else 2
        s = single_step(g, sh, level)
        if s and p.bot == "easy" and self.rng.random() < 0.06:
            s = None   # an easy bot slips now and then
        if s:
            return self.put(st, s[0], s[1])
        if p.bot == "hard":
            # stands in for the harder techniques a strong solver knows: the most constrained cell, solved
            i = min((k for k, v in enumerate(g) if not v), key=lambda k: bin(sh.cands(g, k)).count("1"))
            return self.put(st, i, self.sol[i])
        # stuck: guess between the candidates of the tightest cell, as a person would
        i = min((k for k, v in enumerate(g) if not v), key=lambda k: bin(sh.cands(g, k)).count("1"))
        options = bits(sh.cands(g, i)) or [self.rng.randint(1, self.n)]
        return self.put(st, i, self.rng.choice(options))

    # -- view

    def public(self, p):
        st = self.st.get(p.id)
        out = {"n": self.n, "bh": Shape(self.n).bh, "bw": Shape(self.n).bw, "level": self.level,
               "puzzle": self.puzzle, "blanks": self.blanks,
               "grid": st["g"] if st else self.puzzle,
               "wrong": st["wrong"] if st else 0, "hints": st["hints"] if st else 0, "mine": st["mine"] if st else 0,
               "miss": st["miss"] if st else None, "hint": st["hint"] if st else None, "why": st.get("why") if st else None, "seq": st["seq"] if st else 0,
               "hintsLeft": self.hints_left(st) if st else None,
               "sol": None}
        if self.stage == "reveal" or self.room.phase == "over":
            out["sol"] = self.sol
        return out
