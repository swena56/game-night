"""Reversi: the 19th-century public-domain disc-flipping game on an 8×8 board.

Place a disc so that it closes a straight line (any of eight directions) of rival discs between it
and one of yours; every disc in each closed line flips to your colour. If you can't move you pass;
when neither player can, the most discs wins. Dark moves first."""
from .base import Game, GameError
from .search import WIN, best_move

N = 8
DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
# classic square weights: corners are gold, the squares next to them are traps
WEIGHTS = [
    100, -20, 10, 5, 5, 10, -20, 100,
    -20, -40, -2, -2, -2, -2, -40, -20,
    10, -2, 1, 1, 1, 1, -2, 10,
    5, -2, 1, 0, 0, 1, -2, 5,
    5, -2, 1, 0, 0, 1, -2, 5,
    10, -2, 1, 1, 1, 1, -2, 10,
    -20, -40, -2, -2, -2, -2, -40, -20,
    100, -20, 10, 5, 5, 10, -20, 100,
]
CORNERS = {0: (1, 8, 9), 7: (6, 14, 15), 56: (48, 49, 57), 63: (54, 55, 62)}
PASS = -1


def flips(board, me, c):
    """Discs flipped if `me` (0/1) plays at cell c; [] if illegal."""
    if board[c] is not None:
        return []
    r0, c0 = divmod(c, N)
    out = []
    for dr, dc in DIRS:
        r, k, line = r0 + dr, c0 + dc, []
        while 0 <= r < N and 0 <= k < N and board[r * N + k] == 1 - me:
            line.append(r * N + k)
            r, k = r + dr, k + dc
        if line and 0 <= r < N and 0 <= k < N and board[r * N + k] == me:
            out += line
    return out


def placements(board, me):
    return [c for c in range(N * N) if board[c] is None and flips(board, me, c)]


def legal(board, me):
    """Moves for `me`: placements, or a pass when only the rival can move; [] when the game is over."""
    mine = placements(board, me)
    if mine:
        return mine
    return [PASS] if placements(board, 1 - me) else []


def play(board, me, c):
    if c == PASS:
        return board
    b = list(board)
    b[c] = me
    for f in flips(board, me, c):
        b[f] = me
    return tuple(b)


def evaluate(board, me):
    mine, theirs = board.count(me), board.count(1 - me)
    if not placements(board, me) and not placements(board, 1 - me):
        return WIN if mine > theirs else -WIN if mine < theirs else 0
    empties = board.count(None)
    pos = 0
    for c, v in enumerate(board):
        if v is None:
            continue
        w = WEIGHTS[c]
        # a trap square stops being one once its corner is taken
        for corner, near in CORNERS.items():
            if c in near and board[corner] is not None:
                w = 5
        pos += w if v == me else -w
    mob = len(placements(board, me)) - len(placements(board, 1 - me))
    disc = mine - theirs
    return pos + 8 * mob + (disc * 4 if empties < 12 else 0)


class Reversi(Game):
    id = "reversi"
    category = "strategy"
    howto = [
        "Place a disc so it traps a straight line of rival discs between it and one of yours (across, down or diagonally).",
        "Every trapped disc flips to your colour. Glowing squares show where you can play.",
        "If you can't move, you pass. When neither player can move, the most discs wins.",
        "Corners can never be flipped back, so they're worth fighting for.",
    ]
    name = "Reversi"
    icon = "⚪"
    blurb = "The classic disc-flipping game: trap rival discs in a line and flip them to your colour."
    min_players = 2
    max_players = 2
    settings_schema = {}

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        b = [None] * (N * N)
        b[27], b[36], b[28], b[35] = 1, 1, 0, 0
        self.board = tuple(b)
        self.last, self.flipped = None, []
        self.room.add_log(f"⚫ {seated[0].name} plays dark and moves first; ⚪ {seated[1].name} plays light.", "big")
        self.room.begin_turn(seated[0].id)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        if a.get("type") != "place":
            raise GameError("Unknown action.")
        self.require_turn(p)
        c = a.get("cell")
        if not isinstance(c, int) or isinstance(c, bool) or c not in placements(self.board, self.seat(p)):
            raise GameError("That square doesn't trap any discs.")
        self.place(p, c)

    def place(self, p, c):
        me = self.seat(p)
        self.flipped = flips(self.board, me, c)
        self.board = play(self.board, me, c)
        self.last = c
        self.room.add_log(f"{'⚫⚪'[me]} {p.name}: {'abcdefgh'[c % N]}{c // N + 1}, flipping {len(self.flipped)}.", "question")
        self.next_turn(me)

    def next_turn(self, me):
        r = self.room
        nxt = 1 - me
        if placements(self.board, nxt):
            return r.begin_turn(self.seats[nxt])
        if placements(self.board, me):
            q = r.players.get(self.seats[nxt])
            r.add_log(f"🚫 {q.name if q else '?'} has no move and passes.", "power")
            return r.begin_turn(self.seats[me])
        counts = [self.board.count(0), self.board.count(1)]
        names = [r.players[pid].name if pid in r.players else "?" for pid in self.seats]
        if counts[0] == counts[1]:
            return r.finish(None, f"🤝 A draw, {counts[0]}–{counts[1]}.")
        w = 0 if counts[0] > counts[1] else 1
        r.finish(r.players.get(self.seats[w]), f"🏆 {names[w]} wins Reversi, {counts[w]}–{counts[1 - w]}!")

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{'⚫⚪'[i]} {self.board.count(i)}"

    def final_scores(self):
        return {pid: self.board.count(i) for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        mine = self.room.turn == p.id
        return {"reversi": {
            "board": self.board, "seats": self.seats, "me": i, "last": self.last, "flipped": self.flipped,
            "legal": placements(self.board, i) if mine and i is not None else [],
            "counts": [self.board.count(0), self.board.count(1)],
        }}

    def bot_turn(self, p):
        me = self.seat(p)
        depth, budget, noise = {"easy": (1, 0.3, 60), "normal": (3, 1.0, 8), "hard": (7, 2.5, 0)}[p.bot]
        self.place(p, best_move(self.board, me, legal, play, evaluate, depth, budget, self.rng, noise))
