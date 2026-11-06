"""Checkers (American rules): forced captures, multi-jumps, kings. Seat 0 = dark, moves first, starts at the bottom."""
import random
import time

from .base import Game, GameError
from .undo import Undo

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


def on_board(r, c):
    return 0 <= r < 8 and 0 <= c < 8


def jumps_from(b, r, c, piece, flying=False):
    """All maximal jump paths for one piece: [[(r,c), (r2,c2), ...], ...]. A flying king jumps a piece
    any distance away along an open diagonal and may land on any empty square beyond it."""
    paths = []

    def dfs(b, r, c, piece, path):
        extended = False
        far = flying and piece.isupper()
        for dr, dc in dirs(piece):
            mr, mc = r + dr, c + dc
            while far and on_board(mr, mc) and b[mr][mc] is None:
                mr, mc = mr + dr, mc + dc
            if not on_board(mr, mc):
                continue
            mid = b[mr][mc]
            if not mid or mid.lower() == piece.lower():
                continue
            tr, tc = mr + dr, mc + dc
            while on_board(tr, tc) and b[tr][tc] is None:
                nb = [row[:] for row in b]
                nb[r][c], nb[mr][mc] = None, None
                crowned = piece.islower() and tr == crown_row(piece)
                nb[tr][tc] = piece.upper() if crowned else piece
                extended = True
                if crowned:  # promotion ends the move
                    paths.append(path + [(tr, tc)])
                else:
                    dfs(nb, tr, tc, nb[tr][tc], path + [(tr, tc)])
                if not far:
                    break
                tr, tc = tr + dr, tc + dc
        if not extended and len(path) > 1:
            paths.append(path)

    dfs(b, r, c, piece, [(r, c)])
    return paths


def moves_for(b, side, flying=False):
    jumps, steps = [], []
    for r in range(8):
        for c in range(8):
            p = b[r][c]
            if not p or p.lower() != side:
                continue
            jumps += jumps_from(b, r, c, p, flying)
            for dr, dc in dirs(p):
                tr, tc = r + dr, c + dc
                while on_board(tr, tc) and b[tr][tc] is None:
                    steps.append([(r, c), (tr, tc)])
                    if not (flying and p.isupper()):
                        break
                    tr, tc = tr + dr, tc + dc
    return jumps or steps  # captures are compulsory


def apply(b, path):
    """Return (new board, pieces captured, promoted?)."""
    nb = [row[:] for row in b]
    (r, c) = path[0]
    piece = nb[r][c]
    nb[r][c] = None
    taken = 0
    for (r1, c1), (r2, c2) in zip(path, path[1:]):
        dr, dc = (r2 > r1) - (r2 < r1), (c2 > c1) - (c2 < c1)
        for k in range(1, abs(r2 - r1)):
            if nb[r1 + k * dr][c1 + k * dc]:
                nb[r1 + k * dr][c1 + k * dc] = None
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


def negamax(b, side, depth, alpha, beta, deadline, flying=False, give=False):
    """Give: Giveaway checkers, where running out of pieces or moves wins, so everything is turned round."""
    if time.time() > deadline:
        raise Timeout
    moves = moves_for(b, side, flying)
    if not moves:
        return (10000 + depth) if give else (-10000 - depth)  # no moves = loss (a win in Giveaway); sooner counts more
    if depth == 0:
        return -evaluate(b, side) if give else evaluate(b, side)
    opp = "l" if side == "d" else "d"
    best = -10 ** 9
    for path in moves:
        nb, _, _ = apply(b, path)
        val = -negamax(nb, opp, depth - 1, -beta, -alpha, deadline, flying, give)
        best = max(best, val)
        alpha = max(alpha, val)
        if alpha >= beta:
            break
    return best


def sq(rc):
    r, c = rc
    return f"{'abcdefgh'[c]}{8 - r}"


class Checkers(Undo, Game):
    id = "checkers"
    category = "strategy"
    howto = [
        'Pieces move diagonally forward onto dark squares.',
        'Jump an enemy piece to capture it. Captures are compulsory, and chains continue.',
        'Reach the far row to crown a king, which moves both ways.',
        '🦅 Flying kings: a king glides any distance along an open diagonal and can jump a piece from afar.',
        'Win by taking every piece or leaving your opponent with no move.',
        '↶ Undo asks your rival to take back your last move; 🤝 you can also offer a draw.',
        '🎁 Giveaway (an option): everything turned round. The first side with no pieces or no move left wins, and captures are still compulsory.',
    ]
    name = "Checkers"
    icon = "⛀"
    blurb = "Jump to capture — captures are compulsory and chain together. Reach the far side to crown a king."
    badges = {**Game.badges, "triple": ("🦘", "Hop to it", "Win with a triple jump")}
    settings_schema = {
        "kings": ("Kings", [("short", "Classic (one step)"), ("flying", "🦅 Flying")], "short"),
        "win": ("To win", [("classic", "Take every piece"), ("give", "🎁 Giveaway: lose all your pieces first")], "classic"),
    }

    draw_offer = None  # games saved before draw offers existed

    def give(self):
        return self.s.get("win") == "give"

    def flying(self):
        return self.s.get("kings") == "flying"

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
        if self.undo_act(p, t):
            return
        if t == "draw_offer":
            if self.draw_offer:
                raise GameError("A draw offer is already on the table.")
            self.draw_offer = p.id
            return self.room.add_log(f"🤝 {p.name} offers a draw.", "power")
        if t in ("draw_accept", "draw_decline"):
            if not self.draw_offer or self.draw_offer == p.id:
                raise GameError("There's no draw offer to answer.")
            return self.answer_draw(p, t == "draw_accept")
        if t != "move":
            raise GameError("Unknown action.")
        self.require_turn(p)
        path = [tuple(x) for x in a.get("path") or [] if isinstance(x, list) and len(x) == 2]
        if path not in moves_for(self.board, self.side(p), self.flying()):
            raise GameError("That move isn't allowed (remember: captures are compulsory).")
        self.play(p, path)

    def answer_draw(self, p, accept):
        self.draw_offer = None
        if accept:
            return self.room.finish(None, f"🤝 {p.name} accepted the draw.")
        self.room.add_log(f"{p.name} declined the draw.")

    def undo_state(self):
        return self.board, self.quiet, self.last

    def undo_restore(self, state):
        self.board, self.quiet, self.last = state

    def play(self, p, path):
        r = self.room
        if self.draw_offer and self.draw_offer != p.id:
            self.draw_offer = None  # moving on counts as declining
        self.snapshot(p)
        self.board, taken, promoted = apply(self.board, path)
        self.last = [list(x) for x in path]
        self.quiet = 0 if taken or promoted else self.quiet + 1
        sep = "×" if taken else "→"
        text = sep.join(sq(x) for x in path)
        extra = (f" — captured {taken}" if taken else "") + (" 👑 crowned!" if promoted else "")
        r.add_log(f"{p.name}: {text}{extra}", "question")
        opp_id = self.seats[1 - self.seats.index(p.id)]
        opp_side = "l" if self.side(p) == "d" else "d"
        if not moves_for(self.board, opp_side, self.flying()):
            if self.give():  # 🎁 giveaway: the side that can't move has got rid of everything, and wins
                o = r.players[opp_id]
                return r.finish(o, f"🎁 {o.name} wins Giveaway — no pieces or moves left!")
            if len(path) >= 4:
                self.award(p, "triple")
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
        moves = moves_for(self.board, s, self.flying()) if s and self.room.turn == p.id else []
        return {"checkers": {"board": self.board, "seats": self.seats, "me": s,
                             "moves": [[list(x) for x in m] for m in moves], "last": self.last,
                             "forced": bool(moves) and apply(self.board, moves[0])[1] > 0,
                             "drawOffer": self.draw_offer, "undo": self.undo_view(p)}}

    def bot_turn(self, p):
        side = self.side(p)
        if self.draw_offer and self.draw_offer != p.id:
            accept = (-1 if self.give() else 1) * evaluate(self.board, side) < -90  # about a man behind
            self.answer_draw(p, accept)
            if accept:
                return
        flying = self.flying()
        moves = moves_for(self.board, side, flying)
        if p.bot == "easy" and random.random() < 0.4:
            return self.play(p, random.choice(moves))
        budget, max_depth = {"easy": (0.4, 2), "normal": (1.2, 4), "hard": (3.0, 8)}[p.bot]
        deadline = time.time() + budget
        opp = "l" if side == "d" else "d"
        best = random.choice(moves)
        for depth in range(1, max_depth + 1):
            try:
                scored = sorted(((-negamax(apply(self.board, m)[0], opp, depth - 1, -10 ** 9, 10 ** 9, deadline, flying, self.give())
                                  + random.uniform(0, 3), m) for m in moves), key=lambda x: -x[0])
                best = scored[0][1]
                moves = [m for _, m in scored]
            except Timeout:
                break
        self.play(p, best)
