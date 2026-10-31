"""Checkers (American rules): forced captures, multi-jumps, kings. Seat 0 = dark, moves first, starts at the bottom."""
import random
import time

from .base import Game, GameError

NO_PROGRESS_LIMIT = 80  # plies without a capture or promotion → draw


class Timeout(Exception):
    pass


def initial():
    b = [[None] * 8 for _ in range(8)]
    for r in range(8):
        for c in range(8):
            if (r + c) % 2:
                if r <= 2:
                    b[r][c] = "l"  # light men, top
                elif r >= 5:
                    b[r][c] = "d"  # dark men, bottom
    return b


def dirs(piece):
    if piece.isupper():
        return [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    return [(-1, -1), (-1, 1)] if piece == "d" else [(1, -1), (1, 1)]


def crown_row(piece):
    return 0 if piece.lower() == "d" else 7


def jumps_from(b, r, c, piece):
    """All maximal jump paths for one piece: [[(r,c), (r2,c2), ...], ...]."""
    paths = []

    def dfs(b, r, c, piece, path):
        extended = False
        for dr, dc in dirs(piece):
            mr, mc, tr, tc = r + dr, c + dc, r + 2 * dr, c + 2 * dc
            if not (0 <= tr < 8 and 0 <= tc < 8) or b[tr][tc] is not None:
                continue
            mid = b[mr][mc]
            if not mid or mid.lower() == piece.lower():
                continue
            nb = [row[:] for row in b]
            nb[r][c], nb[mr][mc] = None, None
            crowned = piece.islower() and tr == crown_row(piece)
            nb[tr][tc] = piece.upper() if crowned else piece
            extended = True
            if crowned:  # promotion ends the move
                paths.append(path + [(tr, tc)])
            else:
                dfs(nb, tr, tc, nb[tr][tc], path + [(tr, tc)])
        if not extended and len(path) > 1:
            paths.append(path)

    dfs(b, r, c, piece, [(r, c)])
    return paths


def moves_for(b, side):
    jumps, steps = [], []
    for r in range(8):
        for c in range(8):
            p = b[r][c]
            if not p or p.lower() != side:
                continue
            jumps += jumps_from(b, r, c, p)
            for dr, dc in dirs(p):
                tr, tc = r + dr, c + dc
                if 0 <= tr < 8 and 0 <= tc < 8 and b[tr][tc] is None:
                    steps.append([(r, c), (tr, tc)])
    return jumps or steps  # captures are compulsory


def apply(b, path):
    """Return (new board, pieces captured, promoted?)."""
    nb = [row[:] for row in b]
    (r, c) = path[0]
    piece = nb[r][c]
    nb[r][c] = None
    taken = 0
    for (r1, c1), (r2, c2) in zip(path, path[1:]):
        if abs(r2 - r1) == 2:
            nb[(r1 + r2) // 2][(c1 + c2) // 2] = None
            taken += 1
    tr, tc = path[-1]
    promoted = piece.islower() and tr == crown_row(piece)
    nb[tr][tc] = piece.upper() if promoted else piece
    return nb, taken, promoted


def evaluate(b, side):
    score = 0
    for r in range(8):
        for c in range(8):
            p = b[r][c]
            if not p:
                continue
            v = 160 if p.isupper() else 100 + (7 - r if p == "d" else r) * 3
            if 2 <= c <= 5 and 2 <= r <= 5:
                v += 4
            score += v if p.lower() == side else -v
    return score


def negamax(b, side, depth, alpha, beta, deadline):
    if time.time() > deadline:
        raise Timeout
    moves = moves_for(b, side)
    if not moves:
        return -10000 - depth  # no moves = loss (sooner is worse)
    if depth == 0:
        return evaluate(b, side)
    opp = "l" if side == "d" else "d"
    best = -10 ** 9
    for path in moves:
        nb, _, _ = apply(b, path)
        val = -negamax(nb, opp, depth - 1, -beta, -alpha, deadline)
        best = max(best, val)
        alpha = max(alpha, val)
        if alpha >= beta:
            break
    return best


def sq(rc):
    r, c = rc
    return f"{'abcdefgh'[c]}{8 - r}"


class Checkers(Game):
    id = "checkers"
    category = "board"
    howto = [
        'Pieces move diagonally forward onto dark squares.',
        'Jump an enemy piece to capture it. Captures are compulsory, and chains continue.',
        'Reach the far row to crown a king, which moves both ways.',
        'Win by taking every piece or leaving your opponent with no move.',
    ]
    name = "Checkers"
    icon = "⛀"
    blurb = "Jump to capture — captures are compulsory and chain together. Reach the far side to crown a king."
    settings_schema = {}

    def start(self, seated, rng):
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]  # seat 0 = dark (bottom, first)
        self.board = initial()
        self.quiet = 0
        self.last = None
        self.room.add_log(f"⚫ {seated[0].name} plays Dark and moves first; ⚪ {seated[1].name} plays Light.", "big")
        self.room.begin_turn(seated[0].id)

    def side(self, p):
        return "dl"[self.seats.index(p.id)] if p.id in self.seats else None

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        if t == "resign":
            opp = self.room.players.get(self.seats[1 - self.seats.index(p.id)])
            return self.room.finish(opp, f"🏳️ {p.name} resigned — {opp.name} wins!")
        if t != "move":
            raise GameError("Unknown action.")
        self.require_turn(p)
        path = [tuple(x) for x in a.get("path") or [] if isinstance(x, list) and len(x) == 2]
        if path not in moves_for(self.board, self.side(p)):
            raise GameError("That move isn't allowed (remember: captures are compulsory).")
        self.play(p, path)

    def play(self, p, path):
        r = self.room
        self.board, taken, promoted = apply(self.board, path)
        self.last = [list(x) for x in path]
        self.quiet = 0 if taken or promoted else self.quiet + 1
        sep = "×" if taken else "→"
        text = sep.join(sq(x) for x in path)
        extra = (f" — captured {taken}" if taken else "") + (" 👑 crowned!" if promoted else "")
        r.add_log(f"{p.name}: {text}{extra}", "question")
        opp_id = self.seats[1 - self.seats.index(p.id)]
        opp_side = "l" if self.side(p) == "d" else "d"
        if not moves_for(self.board, opp_side):
            return r.finish(p, f"🏆 {p.name} wins — {r.players[opp_id].name} has no moves left!")
        if self.quiet >= NO_PROGRESS_LIMIT:
            return r.finish(None, "🤝 Draw — 40 moves each with no capture or crowning.")
        r.advance()

    def meta(self, p):
        s = self.side(p)
        if not s:
            return ""
        count = sum(1 for row in self.board for x in row if x and x.lower() == s)
        return f"{'⚫' if s == 'd' else '⚪'} {count}"

    def view(self, p):
        s = self.side(p)
        moves = moves_for(self.board, s) if s and self.room.turn == p.id else []
        return {"checkers": {"board": self.board, "seats": self.seats, "me": s,
                             "moves": [[list(x) for x in m] for m in moves], "last": self.last}}

    def bot_turn(self, p):
        side = self.side(p)
        moves = moves_for(self.board, side)
        if p.bot == "easy" and random.random() < 0.4:
            return self.play(p, random.choice(moves))
        budget, max_depth = {"easy": (0.4, 2), "normal": (1.2, 4), "hard": (3.0, 8)}[p.bot]
        deadline = time.time() + budget
        opp = "l" if side == "d" else "d"
        best = random.choice(moves)
        for depth in range(1, max_depth + 1):
            try:
                scored = sorted(((-negamax(apply(self.board, m)[0], opp, depth - 1, -10 ** 9, 10 ** 9, deadline)
                                  + random.uniform(0, 3), m) for m in moves), key=lambda x: -x[0])
                best = scored[0][1]
                moves = [m for _, m in scored]
            except Timeout:
                break
        self.play(p, best)
