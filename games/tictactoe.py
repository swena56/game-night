"""Tic-Tac-Toe, plus a Vanishing variant where you only keep your 3 newest marks."""
import random
from functools import lru_cache

from .base import Game, GameError

LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]
MARKS = ["✖", "◯"]
MOVE_LIMIT = 60  # Vanishing games can't fill the board, so call a draw eventually


def winner_of(cells):
    for a, b, c in LINES:
        if cells[a] is not None and cells[a] == cells[b] == cells[c]:
            return cells[a], (a, b, c)
    return None, None


@lru_cache(maxsize=None)
def minimax(cells, me):
    """Classic perfect play: returns (score for `me`, best cell)."""
    w, _ = winner_of(cells)
    if w is not None:
        return (1 if w == me else -1), None
    free = [i for i, v in enumerate(cells) if v is None]
    if not free:
        return 0, None
    best = (-2, None)
    for i in free:
        nxt = list(cells)
        nxt[i] = me
        score = -minimax(tuple(nxt), 1 - me)[0]
        if score > best[0]:
            best = (score, i)
    return best


class TicTacToe(Game):
    id = "tictactoe"
    category = "board"
    howto = [
        'Take turns placing your mark.',
        'Three in a row wins.',
        '👻 Vanishing: you keep only your 3 newest marks — the faded one disappears next.',
    ]
    name = "Tic-Tac-Toe"
    icon = "❌"
    blurb = "Three in a row. Try Vanishing mode: only your 3 newest marks stay on the board."
    settings_schema = {
        "variant": ("Variant", [("classic", "Classic"), ("vanishing", "👻 Vanishing")], "classic"),
    }

    def start(self, seated, rng):
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.cells = [None] * 9
        self.history = [[], []]  # per seat, oldest first
        self.moves = 0
        self.line = None
        self.room.add_log(f"{seated[0].name} plays {MARKS[0]} and goes first.", "big")
        self.room.begin_turn(seated[0].id)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def vanishing(self):
        return self.s["variant"] == "vanishing"

    def place(self, cells, history, seat, cell):
        """Apply a move to copies of the state; returns (cells, history)."""
        cells, history = list(cells), [list(h) for h in history]
        cells[cell] = seat
        history[seat].append(cell)
        if self.vanishing() and len(history[seat]) > 3:
            cells[history[seat].pop(0)] = None
        return cells, history

    def act(self, p, a):
        if a.get("type") != "move":
            raise GameError("Unknown action.")
        self.require_turn(p)
        cell = a.get("cell")
        if not isinstance(cell, int) or not 0 <= cell < 9 or self.cells[cell] is not None:
            raise GameError("Pick an empty square.")
        self.move(p, cell)

    def move(self, p, cell):
        r = self.room
        seat = self.seat(p)
        self.cells, self.history = self.place(self.cells, self.history, seat, cell)
        self.moves += 1
        w, line = winner_of(self.cells)
        if w is not None:
            self.line = line
            r.finish(p, f"🏆 {p.name} gets three in a row!")
        elif None not in self.cells or self.moves >= MOVE_LIMIT:
            r.finish(None, "🤝 It's a draw.")
        else:
            r.advance()

    def meta(self, p):
        seat = self.seat(p)
        return "" if seat is None else MARKS[seat]

    def view(self, p):
        fading = []
        if self.vanishing():
            fading = [h[0] for h in self.history if len(h) == 3]
        return {"ttt": {"cells": self.cells, "seats": self.seats, "marks": MARKS,
                        "fading": fading, "line": self.line}}

    # -- bot

    def bot_turn(self, p):
        seat = self.seat(p)
        free = [i for i, v in enumerate(self.cells) if v is None]
        if p.bot == "hard" and not self.vanishing():
            return self.move(p, minimax(tuple(self.cells), seat)[1])

        def wins_with(s, i, cells=None, history=None):
            cells, _ = self.place(cells or self.cells, history or self.history, s, i)
            return winner_of(cells)[0] == s

        def gives_away(i):
            cells, history = self.place(self.cells, self.history, seat, i)
            return any(wins_with(1 - seat, j, cells, history)
                       for j, v in enumerate(cells) if v is None)

        smart = {"easy": 0.35, "normal": 0.85, "hard": 1.0}[p.bot]
        if random.random() < smart:
            for s in (seat, 1 - seat):  # win if possible, otherwise block
                for i in free:
                    if wins_with(s, i):
                        return self.move(p, i)
            if p.bot != "easy":
                safe = [i for i in free if not gives_away(i)] or free
                for pref in (4, 0, 2, 6, 8):
                    if pref in safe:
                        return self.move(p, pref)
                return self.move(p, random.choice(safe))
        self.move(p, random.choice(free))
