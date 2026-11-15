"""Dice Squares: an original roll-and-place race (in the spirit of the old Poker Squares patience).

Everyone has their own empty grid, 4×4 or 5×5. Each turn one die is rolled for the whole table (or two,
and you pick one), and everybody writes it into any empty square of their own grid at the same time.
When the grids are full, every row and column scores as a dice hand: pairs, threes, runs, full houses,
four or five of a kind. Same rolls for everyone, so the best placer wins."""
import random
import time
from collections import Counter
from functools import lru_cache
from itertools import product

from .base import Game, GameError

# points per line: 4×4 lines are four dice, 5×5 lines five
HANDS = {
    4: [("four", "Four of a kind", 20), ("run", "Run of 4", 12), ("two", "Two pairs", 6), ("three", "Three of a kind", 8), ("pair", "Pair", 2)],
    5: [("five", "Five of a kind", 30), ("four", "Four of a kind", 18), ("full", "Full house", 12), ("run", "Run of 5", 14),
        ("three", "Three of a kind", 8), ("two", "Two pairs", 5), ("pair", "Pair", 2)],
}
SOLO_GOAL = {(4, False): 55, (5, False): 118, (4, True): 78, (5, True): 140}   # about a normal bot's average


def hand(vals):
    """(key, label, points) for a full line of dice."""
    n = len(vals)
    c = sorted(Counter(vals).values(), reverse=True)
    s = sorted(vals)
    run = len(set(vals)) == n and s[-1] - s[0] == n - 1
    table = {k: (k, lbl, pts) for k, lbl, pts in HANDS[n]}
    if c[0] == 5:
        return table["five"]
    if c[0] == 4:
        return table["four"]
    if n == 5 and c[:2] == [3, 2]:
        return table["full"]
    if run:
        return table["run"]
    if c[0] == 3:
        return table["three"]
    if c[:2] == [2, 2]:
        return table["two"]
    if c[0] == 2:
        return table["pair"]
    return (None, "Nothing", 0)


@lru_cache(maxsize=None)
def potential(filled, blanks, n):
    """How promising a part-filled line is: a mix of the average and the best hand it can still become."""
    if not blanks:
        return float(hand(filled)[2])
    scores = [hand(filled + extra)[2] for extra in product(range(1, 7), repeat=blanks)]
    return 0.5 * sum(scores) / len(scores) + 0.5 * max(scores) * (0.75 ** blanks)


def lines(n):
    return [[r * n + c for c in range(n)] for r in range(n)] + [[r * n + c for r in range(n)] for c in range(n)]


def line_pot(grid, line, n):
    vals = tuple(sorted(grid[i] for i in line if grid[i]))
    return potential(vals, n - len(vals), n)


def total(grid, n):
    return sum(hand([grid[i] for i in ln])[2] for ln in lines(n) if all(grid[i] for i in ln))


class Squares(Game):
    id = "squares"
    category = "dice"
    howto = [
        "Everyone has their own empty grid. Each turn a die is rolled for the whole table.",
        "Everybody writes the roll into any empty square of their own grid at the same time — no take-backs.",
        "When the grids are full, every row and column scores as a dice hand: pair, two pairs, three of a kind, run, full house, four or five of a kind.",
        "Same rolls for everyone, so the best placer wins. Alone, beat the goal score.",
        "✌️ Two dice (an option): two dice are rolled and you pick which one to write in.",
    ]
    name = "Dice Squares"
    icon = "🧮"
    blurb = "Everyone writes the same rolls into their own grid; rows and columns score as dice hands."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "jackpot": ("🎰", "Jackpot line", "Fill a line with four (or five) of a kind")}
    settings_schema = {
        "size": ("Grid", [(4, "4×4 (16 rolls)"), (5, "5×5 (25 rolls)")], 4),
        "two": ("Dice", [(False, "One die a turn"), (True, "✌️ Two dice: pick one")], False),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.n = self.s["size"]
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.grid = [0] * (self.n * self.n)
            p.g.score = 0
        self.t = 0
        self.dice = []
        self.placed = {}    # pid -> cell placed this roll (hidden from the others until everyone's in)
        self.recent = {}    # pid -> the cell placed last roll, for a highlight
        self.room.turn = None
        self.room.add_log(f"🧮 Dice Squares: a {self.n}×{self.n} grid, {self.n * self.n} rolls. Same dice for everyone!", "big")
        self.next_roll()

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def next_roll(self):
        r = self.room
        self.t += 1
        self.dice = [self.rng.randint(1, 6) for _ in range(2 if self.s.get("two") else 1)]
        self.placed = {}
        r.turn = None
        r.add_log(f"🎲 Roll {self.t} of {self.n * self.n}: {' or '.join(map(str, self.dice))}")
        r.deadline = time.time() + r.settings["timer"] if r.settings.get("timer") else None
        r.bot_at = time.time() + random.uniform(0.9, 1.8)

    def waiting_on(self):
        return [p for p in self.players() if p.id not in self.placed]

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        if a.get("type") != "place":
            raise GameError("Unknown action.")
        if p.id in self.placed:
            raise GameError("You've placed this roll — waiting for the others.")
        cell, d = a.get("cell"), a.get("die", 0)
        if not isinstance(cell, int) or isinstance(cell, bool) or not 0 <= cell < self.n * self.n:
            raise GameError("Bad square.")
        if not isinstance(d, int) or isinstance(d, bool) or not 0 <= d < len(self.dice):
            raise GameError("Bad die.")
        if p.g.grid[cell]:
            raise GameError("That square is taken.")
        self.place(p, cell, d)
        self.maybe_next()

    def place(self, p, cell, d):
        p.g.grid[cell] = self.dice[d]
        self.placed[p.id] = cell
        before = p.g.score
        p.g.score = total(p.g.grid, self.n)
        n = self.n
        for ln in lines(n):
            if cell in ln and all(p.g.grid[i] for i in ln):
                k, lbl, pts = hand([p.g.grid[i] for i in ln])
                if k in ("four", "five"):
                    self.award(p, "jackpot")
                    self.moment(f"🎰 {p.name} fills a line: {lbl.lower()}!", "gold", "fanfare")
        if p.g.score > before:
            self.room.add_log(f"✏️ {p.name} completes a line: +{p.g.score - before}", "info")

    def maybe_next(self):
        if self.waiting_on():
            return
        self.recent = dict(self.placed)
        if self.t >= self.n * self.n:
            return self.finish()
        self.next_roll()

    def finish(self):
        r = self.room
        live = self.players()
        r.deadline = None
        if len(self.seats) == 1 and live:
            p = live[0]
            goal = SOLO_GOAL[self.n, bool(self.s.get("two"))]
            if p.g.score >= goal:
                return r.finish(p, f"🏆 {p.name} scores {p.g.score} — beats the goal of {goal}!")
            return r.finish(None, f"🧮 {p.name} scored {p.g.score}. {goal} wins solo — try again!")
        top = max(q.g.score for q in live)
        best = [q for q in live if q.g.score == top]
        if len(best) == 1:
            return r.finish(best[0], f"🏆 {best[0].name} wins with {top} points!")
        r.finish(None, f"🤝 Tie at {top} points between {' & '.join(q.name for q in best)}.")

    def on_timeout(self):
        for p in self.waiting_on():
            cell, d = self.choose(p, "normal")
            self.room.add_log(f"⏰ {p.name} ran out of time: the die goes in for them.", "power")
            self.place(p, cell, d)
        self.maybe_next()

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and r.phase == "playing" and len(self.seats) > 1:
            self.seats.remove(p.id)
            p.eliminated = True
            r.add_log(f"{p.name} left the game.")
            if len(self.seats) == 1:
                w = r.players[self.seats[0]]
                return r.finish(w, f"🏳️ {p.name} left — {w.name} wins!")
            return self.maybe_next()
        super().on_leave(p)

    # -- bots

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())

    def bot_tick(self):
        for p in [p for p in self.waiting_on() if p.bot]:
            cell, d = self.choose(p, p.bot)
            self.place(p, cell, d)
        self.maybe_next()

    def choose(self, p, level):
        if level == "hard":
            return self.lookahead(p)
        return self.greedy(p.g.grid, self.dice, level)

    def lookahead(self, p):
        """Hard: the greedy shortlist, each judged with the best follow-up for every possible next roll."""
        grid = list(p.g.grid)
        ranked = self.greedy(grid, self.dice, "hard", top=5, gains=True)
        if grid.count(0) <= 1:
            return ranked[0][1:]
        best, pick = None, ranked[0][1:]
        for gain, cell, d in ranked:
            grid[cell] = self.dice[d]
            follow = sum(self.greedy(grid, [v], "hard", top=1, gains=True)[0][0] for v in range(1, 7)) / 6
            grid[cell] = 0
            if best is None or gain + follow > best:
                best, pick = gain + follow, (cell, d)
        return pick

    def greedy(self, grid, dice, level, top=1, gains=False):
        """Score every (square, die) by how much it lifts the two lines through it."""
        n = self.n
        grid = list(grid)
        noise = {"easy": 3.0, "normal": 1.5, "hard": 0.0}.get(level, 0.6)
        ranked = []
        ls = lines(n)
        for cell in range(n * n):
            if grid[cell]:
                continue
            mine = [ln for ln in ls if cell in ln]
            base = sum(line_pot(grid, ln, n) for ln in mine)
            for d, v in enumerate(dice):
                grid[cell] = v
                gain = sum(line_pot(grid, ln, n) for ln in mine) - base
                grid[cell] = 0
                if level == "easy" and self.rng.random() < 0.25:
                    gain = self.rng.random() * 5
                gain += self.rng.gauss(0, noise) if noise else 0
                ranked.append((gain, cell, d))
        ranked.sort(reverse=True)
        if gains:
            return ranked[:top]
        return ranked[0][1:] if top == 1 else [x[1:] for x in ranked[:top]]

    # -- view

    def meta(self, p):
        return f"{p.g.score} pts" if hasattr(p.g, "score") else ""

    def final_scores(self):
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        over = r.phase != "playing"
        n = self.n
        mine = getattr(p.g, "grid", None)
        rivals = {}
        for q in self.players():
            if q.id == p.id:
                continue
            g = list(q.g.grid)
            if not over and q.id in self.placed:
                g[self.placed[q.id]] = 0   # this roll's square stays hidden until everyone's in
            rivals[q.id] = g
        mylines = None
        if mine:
            mylines = []
            for ln in lines(n):
                vals = [mine[i] for i in ln]
                mylines.append(list(hand(vals)[1:]) if all(vals) else None)
        return {"squares": {
            "n": n, "t": self.t, "of": n * n, "dice": self.dice, "seats": self.seats,
            "grid": mine, "lines": mylines, "placed": p.id in self.placed, "mine": p.id in self.placed or p.id not in self.seats,
            "waiting": [q.id for q in self.waiting_on()], "recent": self.recent.get(p.id),
            "rivals": rivals, "scores": {i: r.players[i].g.score for i in self.seats if i in r.players},
            "hands": [[lbl, pts] for _, lbl, pts in HANDS[n]], "solo": len(self.seats) == 1, "goal": SOLO_GOAL[n, bool(self.s.get("two"))],
        }}
