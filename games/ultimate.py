"""Ultimate Tic-Tac-Toe: the folk game of nine tic-tac-toe boards inside one big one.

Your move's square inside a small board sends your rival to the matching small board. If that board
is already won or full, they may play anywhere. Win a small board with three in a row; win the
game with three small boards in a row. With no line left to make, the game is a draw."""
from .base import Game, GameError
from .search import WIN, best_move
from .undo import Undo

LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]
DRAWN = 2  # a small board with no winner and no space


def board_result(cells):
    """0/1 for a winner, DRAWN when full, else None."""
    for a, b, c in LINES:
        if cells[a] is not None and cells[a] == cells[b] == cells[c]:
            return cells[a]
    return DRAWN if all(v is not None for v in cells) else None


def big_result(boards):
    for a, b, c in LINES:
        if boards[a] in (0, 1) and boards[a] == boards[b] == boards[c]:
            return boards[a]
    if all(v is not None for v in boards):
        return DRAWN
    return None


def legal(state, me):
    cells, boards, forced = state
    if big_result(boards) is not None:
        return []
    targets = [forced] if forced is not None and boards[forced] is None else [b for b in range(9) if boards[b] is None]
    return [b * 9 + k for b in targets for k in range(9) if cells[b * 9 + k] is None]


def play(state, me, move):
    cells, boards, _ = state
    cells = list(cells)
    cells[move] = me
    b, k = divmod(move, 9)
    boards = list(boards)
    if boards[b] is None:
        boards[b] = board_result(cells[b * 9:b * 9 + 9])
    return (tuple(cells), tuple(boards), k)


def line_score(vals, me):
    """Two of mine and an open third: a threat; the same for the rival counts against."""
    s = 0
    for a, b, c in LINES:
        trio = (vals[a], vals[b], vals[c])
        if 1 - me not in trio and DRAWN not in trio:
            s += (0, 1, 6)[min(2, trio.count(me))]
        if me not in trio and DRAWN not in trio:
            s -= (0, 1, 6)[min(2, trio.count(1 - me))]
    return s


def evaluate(state, me):
    cells, boards, forced = state
    res = big_result(boards)
    if res is not None:
        return WIN if res == me else -WIN if res == 1 - me else 0
    score = 12 * line_score(boards, me)
    for b in range(9):
        if boards[b] is None:
            score += line_score(cells[b * 9:b * 9 + 9], me) * (2 if b == 4 else 1)
    # being sent to a board where you can play anywhere is a gift to the player to move
    if forced is None or boards[forced] is not None:
        score += 4
    return score


class Ultimate(Undo, Game):
    id = "ultimate"
    category = "classic"
    howto = [
        "Nine small tic-tac-toe boards make one big board. Win a small board with three in a row.",
        "Where you play inside a small board sends your rival to that same board on the big grid.",
        "If that board is already won or full, they can play anywhere.",
        "Win three small boards in a row to win the game.",
        "↶ Undo asks your rival to take back your last move.",
        "If nobody can make a line, it's a draw, or, with the 🏆 Most small boards setting, a win for whoever took more boards.",
    ]
    name = "Ultimate Tic-Tac-Toe"
    icon = "#️⃣"
    blurb = "Nine tic-tac-toe boards in one: every move decides where your rival plays next."
    min_players = 2
    max_players = 2
    badges = {**Game.badges, "sniper": ("🎯", "No wasted boards", "Win with exactly three small boards")}
    settings_schema = {
        "tiebreak": ("When no line is left", [("draw", "🤝 It's a draw"), ("boards", "🏆 Most small boards wins")], "draw"),
    }

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.state = ((None,) * 81, (None,) * 9, None)
        self.last = None
        self.room.add_log(f"#️⃣ {seated[0].name} plays ✕ and goes first; {seated[1].name} plays ◯.", "big")
        self.room.begin_turn(seated[0].id)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're watching this game.")
        if self.undo_act(p, a.get("type")):
            return
        if a.get("type") != "mark":
            raise GameError("Unknown action.")
        self.require_turn(p)
        c = a.get("cell")
        if not isinstance(c, int) or isinstance(c, bool) or c not in legal(self.state, self.seat(p)):
            raise GameError("Play in the highlighted board.")
        self.mark(p, c)

    def undo_state(self):
        return self.state, self.last

    def undo_restore(self, state):
        self.state, self.last = state

    def mark(self, p, c):
        self.snapshot(p)
        me = self.seat(p)
        before = self.state[1]
        self.state = play(self.state, me, c)
        self.last = c
        r = self.room
        b = c // 9
        if before[b] is None and self.state[1][b] in (0, 1):
            r.add_log(f"{'✕◯'[me]} {p.name} wins board {b + 1}!", "power")
        else:
            r.add_log(f"{'✕◯'[me]} {p.name} plays board {b + 1}, square {c % 9 + 1}.", "question")
        res = big_result(self.state[1])
        if res in (0, 1):
            if self.state[1].count(me) == 3:
                self.award(p, "sniper")
            return r.finish(p, f"🏆 {p.name} wins three boards in a row!")
        if not legal(self.state, 1 - me):
            won = [self.state[1].count(k) for k in (0, 1)]
            if self.s.get("tiebreak") == "boards" and won[0] != won[1]:
                k = 0 if won[0] > won[1] else 1
                w = self.room.players.get(self.seats[k])
                return r.finish(w, f"🏆 No lines left: {w.name if w else '?'} wins on boards, {max(won)} to {min(won)}!")
            return r.finish(None, "🤝 No lines left to win — a draw.")
        r.begin_turn(self.seats[1 - me])

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{'✕◯'[i]} {self.state[1].count(i)} boards"

    def view(self, p):
        i = self.seat(p)
        mine = self.room.turn == p.id
        nxt = self.seats.index(self.room.turn) if self.room.turn in self.seats else None
        return {"ultimate": {
            "cells": self.state[0], "boards": self.state[1], "seats": self.seats, "me": i, "last": self.last,
            "open": sorted({m // 9 for m in legal(self.state, nxt)}) if nxt is not None else [],
            "legal": legal(self.state, i) if mine and i is not None else [],
            "undo": self.undo_view(p),
        }}

    def bot_turn(self, p):
        me = self.seat(p)
        depth, budget, noise = {"easy": (1, 0.3, 30), "normal": (3, 1.0, 6), "hard": (8, 2.5, 0)}[p.bot]
        self.mark(p, best_move(self.state, me, legal, play, evaluate, depth, budget, self.rng, noise))
