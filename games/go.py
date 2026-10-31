"""Go with Tromp–Taylor area scoring: stones on the board plus empty areas that touch
only one colour. Positional superko, no suicide. Black (seat 0) moves first."""
import random
import time

from .base import Game, GameError

KOMI = 6.5
MC_SECONDS = 2.5  # hard bot thinking time per move (9×9 and 13×13)


def neighbors(n, r, c):
    for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
        if 0 <= rr < n and 0 <= cc < n:
            yield rr, cc


def group(b, r, c):
    """Return (stones, liberties) of the group containing (r, c)."""
    n, color = len(b), b[r][c]
    stones, libs, stack = {(r, c)}, set(), [(r, c)]
    while stack:
        y, x = stack.pop()
        for yy, xx in neighbors(n, y, x):
            v = b[yy][xx]
            if v is None:
                libs.add((yy, xx))
            elif v == color and (yy, xx) not in stones:
                stones.add((yy, xx))
                stack.append((yy, xx))
    return stones, libs


def place(b, r, c, color):
    """Return (new board, captured count) or None if the move is suicide."""
    n = len(b)
    nb = [row[:] for row in b]
    nb[r][c] = color
    opp = "w" if color == "b" else "b"
    captured = 0
    for rr, cc in neighbors(n, r, c):
        if nb[rr][cc] == opp:
            stones, libs = group(nb, rr, cc)
            if not libs:
                for y, x in stones:
                    nb[y][x] = None
                captured += len(stones)
    if not group(nb, r, c)[1]:
        return None
    return nb, captured


def key(b):
    return "".join(v or "." for row in b for v in row)


def regions(b):
    """Yield (empty region, owner colour or None) for every empty area."""
    n = len(b)
    seen = set()
    for r in range(n):
        for c in range(n):
            if b[r][c] is None and (r, c) not in seen:
                region, borders, stack = {(r, c)}, set(), [(r, c)]
                while stack:
                    y, x = stack.pop()
                    for yy, xx in neighbors(n, y, x):
                        w = b[yy][xx]
                        if w:
                            borders.add(w)
                        elif (yy, xx) not in region:
                            region.add((yy, xx))
                            stack.append((yy, xx))
                seen |= region
                yield region, borders.pop() if len(borders) == 1 else None


def area_score(b):
    score = {"b": 0, "w": 0}
    for row in b:
        for v in row:
            if v:
                score[v] += 1
    for region, owner in regions(b):
        if owner:
            score[owner] += len(region)
    return score


def is_eye(b, r, c, color):
    """An empty point surrounded by our own stones: filling it is almost always a mistake."""
    return all(b[y][x] == color for y, x in neighbors(len(b), r, c))


# -- Monte Carlo playouts for the hard bot (flat boards: 0 empty, 1 black, 2 white)

_NBRS = {}


def flat_neighbors(n):
    if n not in _NBRS:
        _NBRS[n] = [[j for j in (i - n if i >= n else -1, i + n if i < n * n - n else -1,
                                 i - 1 if i % n else -1, i + 1 if i % n < n - 1 else -1) if j >= 0]
                    for i in range(n * n)]
    return _NBRS[n]


def has_liberty(b, i, nbrs):
    """Return (stones, True) as soon as the group at i has a liberty, else (stones, False)."""
    c, stones, stack = b[i], {i}, [i]
    while stack:
        for j in nbrs[stack.pop()]:
            v = b[j]
            if v == 0:
                return stones, True
            if v == c and j not in stones:
                stones.add(j)
                stack.append(j)
    return stones, False


def playout(b, to, nbrs, rnd, limit):
    """Play random non-eye-filling moves until both pass; return black's area minus white's."""
    b = b[:]
    passes = moves = 0
    while passes < 2 and moves < limit:
        empties = [i for i, v in enumerate(b) if v == 0]
        rnd.shuffle(empties)
        opp, played = 3 - to, False
        for i in empties:
            if all(b[j] == to for j in nbrs[i]):
                continue  # our own eye
            b[i] = to
            dead = []
            for j in nbrs[i]:
                if b[j] == opp and j not in dead:
                    stones, alive = has_liberty(b, j, nbrs)
                    if not alive:
                        dead.extend(stones)
            for j in dead:
                b[j] = 0
            if not dead and not has_liberty(b, i, nbrs)[1]:
                b[i] = 0  # suicide
                continue
            played = True
            break
        moves += 1
        passes = 0 if played else passes + 1
        to = opp
    score = 0
    for i, v in enumerate(b):
        if v == 0:
            around = {b[j] for j in nbrs[i]}
            v = around.pop() if len(around) == 1 else 0
        score += 1 if v == 1 else -1 if v == 2 else 0
    return score


class Go(Game):
    id = "go"
    category = "strategy"
    howto = [
        'Take turns placing stones on the intersections.',
        'A group with no empty points next to it is captured.',
        "Surround empty areas to make territory. You can't repeat a previous position (ko).",
        'Two passes in a row end the game. Stones + territory count; White gets 6.5 komi.',
    ]
    name = "Go"
    icon = "⚫"
    blurb = (f"Surround territory and capture stones. Area scoring, White gets {KOMI} komi. "
             "Capture dead stones before you both pass — what's on the board is what counts.")
    settings_schema = {
        "size": ("Board", [(9, "9×9 (quick)"), (13, "13×13"), (19, "19×19 (full)")], 9),
    }

    def start(self, seated, rng):
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]  # seat 0 = black
        n = self.s["size"]
        self.board = [[None] * n for _ in range(n)]
        self.history = {key(self.board)}
        self.captures = {"b": 0, "w": 0}
        self.passes = 0
        self.moves = 0
        self.last = None
        self.room.add_log(f"⚫ {seated[0].name} plays Black and goes first; ⚪ {seated[1].name} plays White (+{KOMI}).", "big")
        self.room.begin_turn(seated[0].id)

    def color(self, p):
        return "bw"[self.seats.index(p.id)] if p.id in self.seats else None

    def try_move(self, r, c, color):
        if self.board[r][c] is not None:
            return None
        res = place(self.board, r, c, color)
        if not res or key(res[0]) in self.history:  # suicide or repeats a position (ko)
            return None
        return res

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        if t == "resign":
            opp = self.room.players.get(self.seats[1 - self.seats.index(p.id)])
            return self.room.finish(opp, f"🏳️ {p.name} resigned — {opp.name} wins!")
        self.require_turn(p)
        if t == "pass":
            return self.do_pass(p)
        if t != "move":
            raise GameError("Unknown action.")
        r, c, n = a.get("r"), a.get("c"), len(self.board)
        if not (isinstance(r, int) and isinstance(c, int) and 0 <= r < n and 0 <= c < n):
            raise GameError("That's off the board.")
        res = self.try_move(r, c, self.color(p))
        if not res:
            raise GameError("You can't play there (occupied, suicide, or ko).")
        self.play(p, r, c, res)

    def play(self, p, r, c, res):
        self.board, captured = res
        self.history.add(key(self.board))
        color = self.color(p)
        self.captures[color] += captured
        self.passes = 0
        self.moves += 1
        self.last = [r, c]
        coord = f"{'ABCDEFGHJKLMNOPQRST'[c]}{len(self.board) - r}"
        self.room.add_log(f"{p.name}: {coord}" + (f" — captured {captured}" if captured else ""), "question")
        self.room.advance()

    def do_pass(self, p):
        self.passes += 1
        self.last = None
        self.room.add_log(f"{p.name} passed.")
        if self.passes >= 2:
            return self.finish_game()
        self.room.advance()

    def scores(self):
        s = area_score(self.board)
        return {"b": s["b"], "w": s["w"] + KOMI}

    def finish_game(self):
        r = self.room
        s = self.scores()
        black, white = (r.players.get(i) for i in self.seats)
        text = f"Final score — ⚫ {s['b']} : ⚪ {s['w']}."
        winner = black if s["b"] > s["w"] else white
        r.finish(winner, f"🏆 {winner.name} wins! {text}")

    def final_scores(self):
        s = self.scores()
        return {self.seats[0]: s["b"], self.seats[1]: s["w"]}

    def meta(self, p):
        c = self.color(p)
        return "" if not c else f"{'⚫' if c == 'b' else '⚪'} {self.captures[c]} caught"

    def view(self, p):
        return {"go": {"board": self.board, "seats": self.seats, "me": self.color(p), "last": self.last,
                       "captures": self.captures, "score": self.scores(), "passes": self.passes, "komi": KOMI}}

    # -- bot: heuristic move scoring

    def urgent(self, r, c, color):
        """Does a move here capture something or touch a group in atari?"""
        for y, x in neighbors(len(self.board), r, c):
            if self.board[y][x] is not None and len(group(self.board, y, x)[1]) == 1:
                return True
        return False

    def candidates(self, color, noise):
        """Score every sensible move with local heuristics; return [(score, r, c, res)], best first."""
        opp = "w" if color == "b" else "b"
        n = len(self.board)
        b = self.board
        found = []
        # Settled areas: don't fill our own territory or throw stones into small enemy pockets.
        skip = set()
        for region, owner in regions(b):
            if owner == color or (owner == opp and len(region) < 8 and self.moves > n):
                skip |= region
        for r in range(n):
            for c in range(n):
                if b[r][c] is not None or is_eye(b, r, c, color):
                    continue
                if (r, c) in skip and not self.urgent(r, c, color):
                    continue
                res = self.try_move(r, c, color)
                if not res:
                    continue
                nb, captured = res
                score = captured * 10
                stones, libs = group(nb, r, c)
                if len(libs) == 1 and not captured:
                    score -= 12 + 3 * len(stones)  # self-atari
                for y, x in neighbors(n, r, c):
                    v = b[y][x]
                    if v == color:
                        _, old_libs = group(b, y, x)
                        if len(old_libs) == 1 and len(libs) > 1:
                            score += 8 + 2 * len(stones)  # rescue a group in atari
                    elif v == opp and nb[y][x] == opp:
                        o_stones, o_libs = group(nb, y, x)
                        if len(o_libs) == 1:
                            score += 4 + len(o_stones)  # put them in atari
                        score += 1.5 / len(o_libs)
                    elif v is None:
                        score += 0.3
                edge = min(r, c, n - 1 - r, n - 1 - c)
                if self.moves < n * 2:
                    score += {0: -3, 1: -1, 2: 2, 3: 2}.get(edge, 0.5)
                elif edge == 0:
                    score -= 1
                if any(b[y][x] for y in range(max(0, r - 2), min(n, r + 3))
                       for x in range(max(0, c - 2), min(n, c + 3))):
                    score += 1
                score += random.uniform(0, noise)
                found.append((score, r, c, res))
        found.sort(key=lambda m: -m[0])
        return found

    def monte_carlo(self, color, moves, budget):
        """Return the index of the candidate move that wins most random playouts within the time budget."""
        n = len(self.board)
        nbrs, rnd = flat_neighbors(n), random.Random()
        code = {"b": 1, "w": 2}
        opp = 3 - code[color]
        sign = 1 if color == "b" else -1
        boards = [[code.get(v, 0) for row in m[3][0] for v in row] for m in moves]
        wins, margin, tries = [0] * len(moves), [0.0] * len(moves), [0] * len(moves)
        rate = lambda k: (wins[k] / tries[k], margin[k] / tries[k], moves[k][0]) if tries[k] else (0, 0, moves[k][0])
        alive = list(range(len(moves)))
        start = time.time()
        for share in (0.25, 0.5, 1.0):  # successive halving: drop the weaker half twice
            while time.time() < start + budget * share:
                for k in alive:
                    result = sign * (playout(boards[k], opp, nbrs, rnd, n * n * 2) - KOMI)
                    wins[k] += result > 0
                    margin[k] += result
                    tries[k] += 1
            alive = sorted(alive, key=rate, reverse=True)[:max(2, len(alive) // 2)]
        return alive[0]

    def bot_turn(self, p):
        color = self.color(p)
        opp = "w" if color == "b" else "b"
        n = len(self.board)
        noise = {"easy": 12, "normal": 4, "hard": 1.5}[p.bot]
        found = self.candidates(color, noise)
        best, best_score = (found[0][1:], found[0][0]) if found else (None, -1e9)
        shortlist = {9: 12, 13: 6}.get(n, 0) if p.bot == "hard" else 0
        if shortlist and best_score >= 1.5 and self.moves < n * n * 2:
            top = [m for m in found if m[0] >= 1.5][:shortlist]
            if len(top) > 1:
                pick = self.monte_carlo(color, top, MC_SECONDS)
                best = top[pick][1:]
        s = self.scores()
        ahead = s[color] > s[opp]
        if best is None and self.moves < 2:  # empty board, nothing scored yet: take the centre
            res = self.try_move(n // 2, n // 2, color)
            if res:
                return self.play(p, n // 2, n // 2, res)
        if best is None or best_score < 1.5 or (self.passes and ahead) or self.moves > n * n * 2:
            return self.do_pass(p)
        self.play(p, *best)
