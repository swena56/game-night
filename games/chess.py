"""Chess with full rules: castling, en passant, promotion, check/mate, stalemate,
50-move rule, threefold repetition and insufficient material. White = seat 0."""
import random
import time

from .base import Game, GameError

VALUE = {"P": 100, "N": 320, "B": 330, "R": 500, "Q": 900, "K": 0}
GLYPH = {"K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘", "P": ""}
KNIGHT = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
KING = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
ROOK_D = [(-1, 0), (1, 0), (0, -1), (0, 1)]
BISHOP_D = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
SLIDES = {"R": ROOK_D, "B": BISHOP_D, "Q": ROOK_D + BISHOP_D}
FILES = "abcdefgh"
MATE = 100000


class Timeout(Exception):
    pass


def name(r, c):
    return f"{FILES[c]}{8 - r}"


def other(color):
    return "b" if color == "w" else "w"


class Pos:
    __slots__ = ("b", "turn", "castle", "ep", "half")

    def __init__(self, b, turn, castle, ep, half):
        self.b, self.turn, self.castle, self.ep, self.half = b, turn, castle, ep, half

    @classmethod
    def initial(cls):
        b = [[None] * 8 for _ in range(8)]
        for c, p in enumerate("RNBQKBNR"):
            b[0][c], b[7][c] = "b" + p, "w" + p
            b[1][c], b[6][c] = "bP", "wP"
        return cls(b, "w", {"wK", "wQ", "bK", "bQ"}, None, 0)

    def key(self):
        return (tuple(map(tuple, self.b)), self.turn, frozenset(self.castle), self.ep)


def attacked(b, r, c, by):
    d = 1 if by == "w" else -1  # a white pawn on (r+1, c±1) attacks (r, c)
    for dc in (-1, 1):
        rr, cc = r + d, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and b[rr][cc] == by + "P":
            return True
    for steps, kind in ((KNIGHT, "N"), (KING, "K")):
        for dr, dc in steps:
            rr, cc = r + dr, c + dc
            if 0 <= rr < 8 and 0 <= cc < 8 and b[rr][cc] == by + kind:
                return True
    for dirs, kinds in ((ROOK_D, "RQ"), (BISHOP_D, "BQ")):
        for dr, dc in dirs:
            rr, cc = r + dr, c + dc
            while 0 <= rr < 8 and 0 <= cc < 8:
                t = b[rr][cc]
                if t:
                    if t[0] == by and t[1] in kinds:
                        return True
                    break
                rr, cc = rr + dr, cc + dc
    return False


def find_king(b, color):
    for r in range(8):
        for c in range(8):
            if b[r][c] == color + "K":
                return r, c
    return None


def pseudo(pos):
    b, me = pos.b, pos.turn
    opp = other(me)
    out = []
    for r in range(8):
        for c in range(8):
            p = b[r][c]
            if not p or p[0] != me:
                continue
            k = p[1]
            if k == "P":
                d, start, last = (-1, 6, 0) if me == "w" else (1, 1, 7)
                rr = r + d

                def add(tr, tc):
                    if tr == last:
                        out.extend((r, c, tr, tc, pr) for pr in "QRBN")
                    else:
                        out.append((r, c, tr, tc, None))

                if b[rr][c] is None:
                    add(rr, c)
                    if r == start and b[r + 2 * d][c] is None:
                        out.append((r, c, r + 2 * d, c, None))
                for cc in (c - 1, c + 1):
                    if 0 <= cc < 8:
                        t = b[rr][cc]
                        if (t and t[0] == opp) or pos.ep == (rr, cc):
                            add(rr, cc)
            elif k in "NK":
                for dr, dc in (KNIGHT if k == "N" else KING):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < 8 and 0 <= cc < 8 and (b[rr][cc] is None or b[rr][cc][0] == opp):
                        out.append((r, c, rr, cc, None))
                if k == "K":
                    home = 7 if me == "w" else 0
                    if (r, c) == (home, 4):
                        if me + "K" in pos.castle and b[home][5] is None and b[home][6] is None \
                                and b[home][7] == me + "R":
                            out.append((r, c, home, 6, None))
                        if me + "Q" in pos.castle and b[home][3] is None and b[home][2] is None \
                                and b[home][1] is None and b[home][0] == me + "R":
                            out.append((r, c, home, 2, None))
            else:
                for dr, dc in SLIDES[k]:
                    rr, cc = r + dr, c + dc
                    while 0 <= rr < 8 and 0 <= cc < 8:
                        t = b[rr][cc]
                        if t is None:
                            out.append((r, c, rr, cc, None))
                        else:
                            if t[0] == opp:
                                out.append((r, c, rr, cc, None))
                            break
                        rr, cc = rr + dr, cc + dc
    return out


def apply(pos, m):
    """Return (new position, captured piece or None)."""
    fr, fc, tr, tc, promo = m
    b = [row[:] for row in pos.b]
    p = b[fr][fc]
    me, k = p[0], p[1]
    captured = b[tr][tc]
    if k == "P" and fc != tc and captured is None:  # en passant
        captured = b[fr][tc]
        b[fr][tc] = None
    b[tr][tc] = me + promo if promo else p
    b[fr][fc] = None
    if k == "K" and abs(tc - fc) == 2:  # castle: bring the rook across
        rook_from, rook_to = (7, 5) if tc == 6 else (0, 3)
        b[fr][rook_to], b[fr][rook_from] = b[fr][rook_from], None
    castle = set(pos.castle)
    if k == "K":
        castle -= {me + "K", me + "Q"}
    for rr, cc, right in ((7, 0, "wQ"), (7, 7, "wK"), (0, 0, "bQ"), (0, 7, "bK")):
        if (fr, fc) == (rr, cc) or (tr, tc) == (rr, cc):
            castle.discard(right)
    ep = ((fr + tr) // 2, fc) if k == "P" and abs(tr - fr) == 2 else None
    half = 0 if k == "P" or captured else pos.half + 1
    return Pos(b, other(me), castle, ep, half), captured


def legal(pos):
    me, opp = pos.turn, other(pos.turn)
    res = []
    for m in pseudo(pos):
        fr, fc, tr, tc, _ = m
        if pos.b[fr][fc][1] == "K" and abs(tc - fc) == 2:
            if attacked(pos.b, fr, fc, opp) or attacked(pos.b, fr, (fc + tc) // 2, opp):
                continue
        n, _ = apply(pos, m)
        kr, kc = find_king(n.b, me)
        if not attacked(n.b, kr, kc, opp):
            res.append(m)
    return res


def in_check(pos):
    k = find_king(pos.b, pos.turn)
    return k is not None and attacked(pos.b, *k, other(pos.turn))


def insufficient(b):
    minors = []
    for row in b:
        for p in row:
            if p and p[1] != "K":
                if p[1] in "PRQ":
                    return False
                minors.append(p)
    return len(minors) <= 1


def evaluate(b, me):
    score = 0
    kings, pieces = {}, {"w": 0, "b": 0}
    for r in range(8):
        for c in range(8):
            p = b[r][c]
            if not p:
                continue
            if p[1] == "K":
                kings[p[0]] = (r, c)
            else:
                pieces[p[0]] += 1
            v = VALUE[p[1]]
            if p[1] == "P":
                v += (6 - r if p[0] == "w" else r - 1) * 6 + (8 if 2 <= c <= 5 else 0)
            elif p[1] in "NB":
                v += 12 - 3 * (abs(3.5 - r) + abs(3.5 - c))
            score += v if p[0] == me else -v
    # Mop-up: with the enemy down to a bare king, drive it to the edge and walk ours closer.
    for side, sign in ((me, 1), (other(me), -1)):
        foe = other(side)
        if pieces[side] and not pieces[foe] and side in kings and foe in kings:
            (kr, kc), (fr, fc) = kings[side], kings[foe]
            edge = abs(3.5 - fr) + abs(3.5 - fc)
            score += sign * (10 * edge + 4 * (14 - abs(kr - fr) - abs(kc - fc)))
    return score


def search(pos, depth, alpha, beta, deadline):
    if time.time() > deadline:
        raise Timeout
    if depth == 0:
        return evaluate(pos.b, pos.turn)
    moves = pseudo(pos)
    moves.sort(key=lambda m: -VALUE[pos.b[m[2]][m[3]][1]] if pos.b[m[2]][m[3]] else 0)
    best = -MATE * 2
    for m in moves:
        target = pos.b[m[2]][m[3]]
        if target and target[1] == "K":
            return MATE  # the previous move left a king en prise
        n, _ = apply(pos, m)
        val = -search(n, depth - 1, -beta, -alpha, deadline)
        if val > best:
            best = val
        alpha = max(alpha, val)
        if alpha >= beta:
            break
    return best if moves else 0


def move_text(pos, m, captured):
    fr, fc, tr, tc, promo = m
    k = pos.b[fr][fc][1]
    if k == "K" and abs(tc - fc) == 2:
        return "O-O" if tc == 6 else "O-O-O"
    sep = "×" if captured else "→"
    text = f"{GLYPH[k]}{name(fr, fc)}{sep}{name(tr, tc)}"
    if promo:
        text += f"={GLYPH[promo]}"
    return text


def san(pos, m, after, replies):
    """Standard algebraic notation (Nf3, exd5, O-O, e8=Q+), from the position before the move."""
    fr, fc, tr, tc, promo = m
    k = pos.b[fr][fc][1]
    if k == "K" and abs(tc - fc) == 2:
        text = "O-O" if tc == 6 else "O-O-O"
    else:
        takes = pos.b[tr][tc] is not None or (k == "P" and fc != tc)
        if k == "P":
            text = (FILES[fc] + "x" if takes else "") + name(tr, tc) + (f"={promo}" if promo else "")
        else:
            rivals = [o for o in legal(pos) if o[2:4] == (tr, tc) and o[:2] != (fr, fc)
                      and pos.b[o[0]][o[1]][1] == k]
            hint = ""
            if rivals:
                if all(o[1] != fc for o in rivals):
                    hint = FILES[fc]
                elif all(o[0] != fr for o in rivals):
                    hint = str(8 - fr)
                else:
                    hint = name(fr, fc)
            text = k + hint + ("x" if takes else "") + name(tr, tc)
    if in_check(after):
        text += "+" if replies else "#"
    return text


class Chess(Game):
    id = "chess"
    category = "strategy"
    howto = [
        'Tap a piece to see where it can go, then tap the destination.',
        'Checkmate the enemy king to win. Stalemate, repetition and the 50-move rule are draws.',
        'Castling, en passant and promotion all work — you pick the promotion piece.',
        'You can offer a draw or resign from the side panel.',
        'With a clock, your time runs only on your turn; run out and you lose (a draw if your opponent has only a king).',
    ]
    name = "Chess"
    icon = "♟️"
    blurb = "The classic, with every rule: castling, en passant, promotion, and draws by stalemate or repetition."
    settings_schema = {
        "clock": ("Clock", [(0, "Untimed"), (180, "⚡ 3 min + 2s"), (300, "5 min"), (600, "10 min + 5s")], 0),
    }
    INCREMENT = {180: 2, 300: 0, 600: 5}
    clock, inc, turn_at = None, 0, 0.0  # games saved before clocks existed have none
    sans = ()  # nor a move list

    def start(self, seated, rng):
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]  # seat 0 = white
        self.pos = Pos.initial()
        self.seen = {self.pos.key(): 1}
        self.last = None
        self.sans = []
        self.captured = {"w": [], "b": []}  # pieces each side has lost
        self.draw_offer = None
        base = self.s.get("clock", 0)
        self.clock = {pid: float(base) for pid in self.seats} if base else None
        self.inc = self.INCREMENT.get(base, 0)
        self.room.add_log(f"♔ {seated[0].name} plays White, ♚ {seated[1].name} plays Black.", "big")
        self.room.begin_turn(seated[0].id)
        self.start_clock()

    # -- clock: the mover's time runs from turn_at; the room deadline is their flag-fall

    def start_clock(self):
        if self.clock and self.room.phase == "playing":
            self.turn_at = time.time()
            self.room.deadline = self.turn_at + self.clock[self.room.turn]

    def left(self, pid):
        t = self.clock[pid]
        if pid == self.room.turn and self.room.phase == "playing":
            t -= time.time() - self.turn_at
        return max(0.0, t)

    def on_restore(self, shift):
        if self.clock:
            self.turn_at += shift  # downtime doesn't count against the mover
            self.room.deadline = self.turn_at + self.clock[self.room.turn]

    def on_timeout(self):
        if not self.clock:
            return super().on_timeout()
        r = self.room
        p = r.players[r.turn]
        opp = r.players.get(self.seats[1 - self.seats.index(p.id)])
        self.clock[p.id] = 0.0
        foe = "wb"[self.seats.index(opp.id)]
        if all(not x or x[0] != foe or x[1] == "K" for row in self.pos.b for x in row):
            return r.finish(None, f"⏰ {p.name} ran out of time, but {opp.name} can't checkmate — draw.")
        r.finish(opp, f"⏰ {p.name} ran out of time — {opp.name} wins!")

    def color(self, p):
        return "wb"[self.seats.index(p.id)] if p.id in self.seats else None

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        opp = self.room.players.get(self.seats[1 - self.seats.index(p.id)])
        if t == "resign":
            return self.room.finish(opp, f"🏳️ {p.name} resigned — {opp.name} wins!")
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
        m = a.get("move") or []
        if len(m) != 5:
            raise GameError("Bad move.")
        move = (m[0], m[1], m[2], m[3], m[4] or None)
        if move not in legal(self.pos):
            raise GameError("That move isn't legal.")
        self.play(p, move)

    def answer_draw(self, p, accept):
        self.draw_offer = None
        if accept:
            return self.room.finish(None, f"🤝 {p.name} accepted the draw.")
        self.room.add_log(f"{p.name} declined the draw.")

    def play(self, p, move):
        r = self.room
        if self.draw_offer and self.draw_offer != p.id:
            self.draw_offer = None  # moving on counts as declining
        if self.clock:
            self.clock[p.id] = self.left(p.id) + self.inc
        before = self.pos
        self.pos, captured = apply(before, move)
        text = move_text(before, move, captured)
        if captured:
            self.captured[captured[0]].append(captured[1])
        self.last = list(move[:4])
        key = self.pos.key()
        self.seen[key] = self.seen.get(key, 0) + 1
        replies = legal(self.pos)
        check = in_check(self.pos)
        self.sans = [*self.sans, san(before, move, self.pos, replies)]
        opp = r.players.get(self.seats[1 - self.seats.index(p.id)])
        if not replies:
            r.add_log(f"{p.name}: {text}{'#' if check else ''}", "question")
            if check:
                return r.finish(p, f"♚ Checkmate! {p.name} wins.")
            return r.finish(None, "🤝 Stalemate — it's a draw.")
        r.add_log(f"{p.name}: {text}{'+' if check else ''}", "question")
        if self.pos.half >= 100:
            return r.finish(None, "🤝 Draw by the 50-move rule.")
        if self.seen[key] >= 3:
            return r.finish(None, "🤝 Draw by threefold repetition.")
        if insufficient(self.pos.b):
            return r.finish(None, "🤝 Draw — not enough material to checkmate.")
        r.advance()
        self.start_clock()

    def meta(self, p):
        c = self.color(p)
        return {"w": "♔ White", "b": "♚ Black"}.get(c, "")

    def view(self, p):
        mine = self.color(p)
        moves = legal(self.pos) if mine == self.pos.turn and self.room.turn == p.id else []
        check = find_king(self.pos.b, self.pos.turn) if in_check(self.pos) else None
        return {"chess": {
            "board": self.pos.b, "seats": self.seats, "turnColor": self.pos.turn, "me": mine,
            "moves": [list(m) for m in moves], "last": self.last, "check": check,
            "captured": self.captured, "drawOffer": self.draw_offer, "sans": list(self.sans),
            "clock": {pid: round(self.left(pid), 1) for pid in self.seats} if self.clock else None, "inc": self.inc,
        }}

    # -- bot

    def bot_turn(self, p):
        if self.draw_offer and self.draw_offer != p.id:
            accept = evaluate(self.pos.b, self.pos.turn) < -250
            self.answer_draw(p, accept)
            if accept:
                return
        moves = legal(self.pos)
        if p.bot == "easy" and random.random() < 0.3:
            return self.play(p, random.choice(moves))
        budget, max_depth = {"easy": (0.5, 1), "normal": (1.5, 2), "hard": (4.0, 4)}[p.bot]
        if self.clock:
            budget = min(budget, max(0.2, self.left(p.id) / 25))  # don't flag while thinking
        deadline = time.time() + budget
        best = random.choice(moves)
        noise = 60 if p.bot == "easy" else 8
        for depth in range(1, max_depth + 1):
            try:
                scored = []
                ahead = evaluate(self.pos.b, self.pos.turn) > 50
                for m in moves:
                    n, _ = apply(self.pos, m)
                    repeat = 150 if ahead and n.key() in self.seen else 0  # don't drift into a draw
                    scored.append((-search(n, depth - 1, -MATE * 2, MATE * 2, deadline)
                                   - repeat + random.uniform(0, noise), m))
                scored.sort(key=lambda x: -x[0])
                best = scored[0][1]
                moves = [m for _, m in scored]  # best-first ordering for the next depth
            except Timeout:
                break
        self.play(p, best)
