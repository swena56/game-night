"""Nine Men's Morris: the traditional mill game (centuries old, public domain).

24 points on three nested squares. Each player places 9 men one at a time, then moves them along the
lines to a neighbouring empty point. Three in a row along a line is a mill: it lets you remove one
rival man (not one in a mill, unless all of them are). With only 3 men left you may fly to any empty
point (optional). You lose with fewer than 3 men or no legal move."""
from functools import partial

from .base import Game, GameError
from .search import WIN, best_move

MILLS = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (9, 10, 11), (12, 13, 14), (15, 16, 17), (18, 19, 20), (21, 22, 23),
         (0, 9, 21), (3, 10, 18), (6, 11, 15), (1, 4, 7), (16, 19, 22), (8, 12, 17), (5, 13, 20), (2, 14, 23)]
ADJ = {i: set() for i in range(24)}
for a, b, c in MILLS:
    ADJ[a].add(b); ADJ[b].update((a, c)); ADJ[c].add(b)
MILLS_AT = {i: [m for m in MILLS if i in m] for i in range(24)}
# Twelve Men's Morris adds the four corner diagonals as lines (and mills)
MILLS12 = MILLS + [(0, 3, 6), (2, 5, 8), (21, 18, 15), (23, 20, 17)]
ADJ12 = {i: set() for i in range(24)}
for a, b, c in MILLS12:
    ADJ12[a].add(b); ADJ12[b].update((a, c)); ADJ12[c].add(b)
MILLS_AT12 = {i: [m for m in MILLS12 if i in m] for i in range(24)}
GEO = {False: (MILLS, ADJ, MILLS_AT), True: (MILLS12, ADJ12, MILLS_AT12)}
QUIET_LIMIT = 60   # plies of moving with no man removed: a draw
MEN = 9


def in_mill(board, i, twelve=False):
    v = board[i]
    return v is not None and any(all(board[j] == v for j in m) for m in GEO[twelve][2][i])


def removable(board, rival, twelve=False):
    theirs = [i for i, v in enumerate(board) if v == rival]
    loose = [i for i in theirs if not in_mill(board, i, twelve)]
    return loose or theirs


def steps(state, me, fly=True, twelve=False):
    """(src, dst) pairs, src = -1 for a placement."""
    board, hand, _ = state
    empty = [i for i, v in enumerate(board) if v is None]
    if hand[me]:
        return [(-1, d) for d in empty]
    mine = [i for i, v in enumerate(board) if v == me]
    if fly and len(mine) == 3:
        return [(s, d) for s in mine for d in empty]
    return [(s, d) for s in mine for d in sorted(GEO[twelve][1][s]) if board[d] is None]


def moved(board, me, src, dst):
    b = list(board)
    if src >= 0:
        b[src] = None
    b[dst] = me
    return b


def legal(state, me, fly=True, twelve=False):
    board, hand, quiet = state
    if quiet >= QUIET_LIMIT:
        return []
    if not hand[me] and board.count(me) < 3:
        return []
    out = []
    for src, dst in steps(state, me, fly, twelve):
        b = moved(board, me, src, dst)
        if any(all(b[j] == me for j in m) for m in GEO[twelve][2][dst]):
            out += [(src, dst, r) for r in removable(b, 1 - me, twelve)]
        else:
            out.append((src, dst, -1))
    return out


def play(state, me, move):
    board, hand, quiet = state
    src, dst, rem = move
    b = moved(board, me, src, dst)
    if rem >= 0:
        b[rem] = None
    hand = list(hand)
    if src < 0:
        hand[me] -= 1
    placing = src < 0
    return (tuple(b), tuple(hand), 0 if rem >= 0 or placing else quiet + 1)


def evaluate(state, me, fly=True, twelve=False):
    board, hand, quiet = state
    if not legal(state, me, fly, twelve):
        return 0 if quiet >= QUIET_LIMIT or None not in board else -WIN
    men = lambda s: board.count(s) + hand[s]
    score = 30 * (men(me) - men(1 - me))
    for m in GEO[twelve][0]:
        vals = [board[j] for j in m]
        if vals.count(me) == 2 and vals.count(None) == 1:
            score += 6
        if vals.count(1 - me) == 2 and vals.count(None) == 1:
            score -= 7
    if not hand[me] and not hand[1 - me]:
        score += len(steps(state, me, fly, twelve)) - len(steps(state, 1 - me, fly, twelve))
    return score


class Morris(Game):
    id = "morris"
    category = "classic"
    howto = [
        "Take turns placing your 9 men (12 in Twelve Men's Morris) on empty points. Then move one man per turn along a line to a neighbouring empty point.",
        "Three of your men in a row along a line make a mill: remove one rival man (not from a mill, unless that's all they have).",
        "With only 3 men left you can fly to any empty point (if flying is on).",
        "A player with fewer than 3 men, or no legal move, loses.",
        "Twelve Men's Morris (an option): 12 men each, and the corner diagonals are lines too. If the board fills up, it's a draw.",
    ]
    name = "Nine Men's Morris"
    icon = "⚫"
    blurb = "The ancient mill game: place, slide and make lines of three to take your rival's men."
    min_players = 2
    max_players = 2
    badges = {**Game.badges, "untouched": ("🛡️", "Untouched", "Win without losing a single man")}
    settings_schema = {
        "fly": ("Flying with 3 men", [(True, "On"), (False, "Off")], True),
        "men": ("Men", [(9, "Nine Men's Morris"), (12, "Twelve Men's Morris (diagonals)")], 9),
    }
    twelve = False  # games saved before Twelve Men's Morris

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.fly = self.s["fly"]
        self.twelve = self.s.get("men") == 12
        men = 12 if self.twelve else MEN
        self.state = ((None,) * 24, (men, men), 0)
        self.last = None
        self.room.add_log(f"⚫ {seated[0].name} (dark) places first; ⚪ {seated[1].name} plays light.", "big")
        self.room.begin_turn(seated[0].id)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        if a.get("type") != "move":
            raise GameError("Unknown action.")
        self.require_turn(p)
        mv = a.get("move")
        if not (isinstance(mv, list) and len(mv) == 3 and all(isinstance(v, int) and not isinstance(v, bool) for v in mv)):
            raise GameError("Bad move.")
        if tuple(mv) not in legal(self.state, self.seat(p), self.fly, self.twelve):
            raise GameError("That move isn't allowed.")
        self.move(p, tuple(mv))

    def move(self, p, mv):
        me = self.seat(p)
        self.state = play(self.state, me, mv)
        self.last = list(mv)
        src, dst, rem = mv
        r = self.room
        name = lambda i: f"{'abcdefg'[POS[i][0]]}{7 - POS[i][1]}"
        text = f"places at {name(dst)}" if src < 0 else f"moves {name(src)}→{name(dst)}"
        r.add_log(f"{'⚫⚪'[me]} {p.name} {text}" + (f" — mill! Takes {name(rem)}." if rem >= 0 else "."),
                  "power" if rem >= 0 else "question")
        nxt = 1 - me
        if not legal(self.state, nxt, self.fly, self.twelve):
            if self.state[2] >= QUIET_LIMIT:
                return r.finish(None, f"🤝 {QUIET_LIMIT} moves without a capture — a draw.")
            if None not in self.state[0]:
                return r.finish(None, "🤝 The board is full — a draw.")
            q = r.players.get(self.seats[nxt])
            why = "is down to two men" if not self.state[1][nxt] and self.state[0].count(nxt) < 3 else "has no move"
            if self.state[0].count(me) + self.state[1][me] == (12 if self.twelve else 9):
                self.award(p, "untouched")
            return r.finish(p, f"🏆 {q.name if q else '?'} {why} — {p.name} wins!")
        r.begin_turn(self.seats[nxt])

    def meta(self, p):
        i = self.seat(p)
        if i is None:
            return ""
        board, hand, _ = self.state
        return f"{board.count(i)} on board" + (f" · {hand[i]} to place" if hand[i] else "")

    def view(self, p):
        i = self.seat(p)
        mine = self.room.turn == p.id
        return {"morris": {
            "board": self.state[0], "hand": self.state[1], "seats": self.seats, "me": i, "last": self.last,
            "legal": [list(m) for m in legal(self.state, i, self.fly, self.twelve)] if mine and i is not None else [],
            "quiet": self.state[2], "limit": QUIET_LIMIT, "twelve": self.twelve,
        }}

    def bot_turn(self, p):
        me = self.seat(p)
        depth, budget, noise = {"easy": (1, 0.3, 40), "normal": (3, 1.0, 6), "hard": (6, 2.5, 0)}[p.bot]
        self.move(p, best_move(self.state, me, partial(legal, fly=self.fly, twelve=self.twelve), play,
                               partial(evaluate, fly=self.fly, twelve=self.twelve),
                               depth, budget, self.rng, noise))


# grid positions (column, row on a 7×7 grid) for move names and the board drawing
POS = [(0, 0), (3, 0), (6, 0), (1, 1), (3, 1), (5, 1), (2, 2), (3, 2), (4, 2), (0, 3), (1, 3), (2, 3),
       (4, 3), (5, 3), (6, 3), (2, 4), (3, 4), (4, 4), (1, 5), (3, 5), (5, 5), (0, 6), (3, 6), (6, 6)]
