"""Drop Four: gravity four-in-a-row for 2–4 players, with optional bomb discs and pull-outs (take one of
your own discs out of the bottom row instead of dropping; the column slides down)."""
import random

from .base import Game, GameError

DIRS = [(0, 1), (1, 0), (1, 1), (1, -1)]


def drop_row(grid, col):
    for row in range(len(grid) - 1, -1, -1):
        if grid[row][col] is None:
            return row
    return None


def find_line(grid, seat):
    rows, cols = len(grid), len(grid[0])
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != seat:
                continue
            for dr, dc in DIRS:
                cells = [(r + dr * k, c + dc * k) for k in range(4)]
                if all(0 <= y < rows and 0 <= x < cols and grid[y][x] == seat for y, x in cells):
                    return cells
    return None


def apply_drop(grid, col, seat, bomb=False):
    """Return (new grid, landing row) or (None, None) if the column is full."""
    row = drop_row(grid, col)
    if row is None:
        return None, None
    g = [list(r) for r in grid]
    g[row][col] = seat
    if bomb:
        for y in range(row - 1, row + 2):
            for x in range(col - 1, col + 2):
                if (y, x) != (row, col) and 0 <= y < len(g) and 0 <= x < len(g[0]):
                    g[y][x] = None
        for x in range(len(g[0])):  # let everything fall back down
            stack = [g[y][x] for y in range(len(g)) if g[y][x] is not None]
            for y in range(len(g)):
                g[y][x] = None
            for i, v in enumerate(reversed(stack)):
                g[len(g) - 1 - i][x] = v
    return g, row


def apply_pull(grid, col):
    """Take the bottom disc out of a column; everything above slides down one."""
    g = [list(r) for r in grid]
    for y in range(len(g) - 1, 0, -1):
        g[y][col] = g[y - 1][col]
    g[0][col] = None
    return g


def pulls_for(grid, seat):
    return [c for c in range(len(grid[0])) if grid[-1][c] == seat]


MOVE_CAP = 160  # with pull-outs a game could circle forever: call it a draw here


def score_grid(grid, seat):
    """Heuristic: reward open windows of 2–3 of my discs, punish the same for others."""
    rows, cols = len(grid), len(grid[0])
    total = 0
    for c in range(cols):  # centre preference
        weight = cols // 2 - abs(c - cols // 2)
        total += sum(weight for r in range(rows) if grid[r][c] == seat)
    for r in range(rows):
        for c in range(cols):
            for dr, dc in DIRS:
                end_r, end_c = r + dr * 3, c + dc * 3
                if not (0 <= end_r < rows and 0 <= end_c < cols):
                    continue
                window = [grid[r + dr * k][c + dc * k] for k in range(4)]
                owners = {v for v in window if v is not None}
                if len(owners) != 1:
                    continue
                n = sum(v is not None for v in window)
                val = {2: 2, 3: 9, 4: 1000}.get(n, 0)
                total += val if seat in owners else -val * 1.2
    return total


class DropFour(Game):
    id = "dropfour"
    category = "classic"
    howto = [
        'Drop discs into columns; they fall to the lowest free space.',
        'Line up four in a row — across, down or diagonally — to win.',
        'With bombs on, a 💣 disc clears its 3×3 area and the stack falls.',
        'With ⬇️ pull-outs on, you may instead take one of your own discs out of the bottom row; the column slides down. A pull that lines up four for you and a rival wins for you.',
        '3–4 players get a bigger board; two players can pick one too (7 × 8 or 7 × 9).',
    ]
    name = "Drop Four"
    icon = "🔴"
    blurb = "Drop discs, line up four. 3–4 players get a bigger board. Bombs blow a hole in the stack."
    min_players = 2
    max_players = 4
    settings_schema = {
        "bombs": ("Bomb discs", [(False, "Off"), (True, "💣 One each")], False),
        "pull": ("Pull-outs", [(False, "Off"), (True, "⬇️ Pull your own disc from the bottom")], False),
        "board": ("Board (2 players)", [("6x7", "6 × 7 (classic)"), ("7x8", "7 × 8"), ("7x9", "7 × 9 (wide)")], "6x7"),
    }
    badges = {**Game.badges, "demolition": ("💥", "Demolition", "Connect four with your own bomb or pull-out"),
              "gift": ("🎁", "Thanks for that", "Win because a rival's bomb or pull-out connected your four")}
    moves = ()  # [seat, column, bomb?] in order; games saved before the history have none

    def start(self, seated, rng):
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        rows, cols = tuple(map(int, self.s.get("board", "6x7").split("x"))) if len(seated) == 2 else (7, 9)
        self.grid = [[None] * cols for _ in range(rows)]
        self.bombs = {p.id: 1 if self.s["bombs"] else 0 for p in seated}
        self.last = None
        self.line = None
        self.moves = []
        self.room.add_log(f"{seated[0].name} drops first.", "big")
        self.room.begin_turn(seated[0].id)

    def in_play(self, seat):
        o = self.room.players.get(self.seats[seat])
        return bool(o and not o.eliminated)

    def act(self, p, a):
        if a.get("type") == "pull":
            self.require_turn(p)
            col = a.get("col")
            if not self.s.get("pull"):
                raise GameError("Pull-outs are off in this game.")
            if not isinstance(col, int) or isinstance(col, bool) or col not in pulls_for(self.grid, self.seats.index(p.id)):
                raise GameError("Pull one of your own discs from the bottom row.")
            return self.pull(p, col)
        if a.get("type") != "drop":
            raise GameError("Unknown action.")
        self.require_turn(p)
        col = a.get("col")
        if not isinstance(col, int) or not 0 <= col < len(self.grid[0]):
            raise GameError("Pick a column.")
        bomb = bool(a.get("bomb"))
        if bomb and not self.bombs.get(p.id):
            raise GameError("No bombs left.")
        if drop_row(self.grid, col) is None:
            raise GameError("That column is full.")
        self.drop(p, col, bomb)

    def drop(self, p, col, bomb=False):
        r = self.room
        seat = self.seats.index(p.id)
        self.grid, row = apply_drop(self.grid, col, seat, bomb)
        self.last = [row, col] if not bomb else None
        self.moves = [*self.moves, [seat, col, bomb]]
        if bomb:
            self.bombs[p.id] -= 1
            r.add_log(f"💣 {p.name} bombed column {col + 1}!", "power")
        self.check_end(p, seat, "bomb" if bomb else "drop")

    def pull(self, p, col):
        seat = self.seats.index(p.id)
        self.grid = apply_pull(self.grid, col)
        self.last = None
        self.moves = [*self.moves, [seat, col, "pull"]]
        self.room.add_log(f"⬇️ {p.name} pulls a disc out of column {col + 1}.", "power")
        self.check_end(p, seat, "pull")

    def check_end(self, p, seat, how):
        r = self.room
        # A bomb or a pull can complete someone else's line; the mover wins ties.
        order = [seat] + [s for s in range(len(self.seats)) if s != seat]
        for s in order:
            line = find_line(self.grid, s)
            if line and self.in_play(s):
                self.line = line
                w = r.players[self.seats[s]]
                if how != "drop" and s == seat:
                    self.award(w, "demolition")
                elif s != seat:
                    self.award(w, "gift")
                text = (f"🏆 {w.name} connects four!" if s == seat else
                        f"💥 {p.name}'s {'bomb' if how == 'bomb' else 'pull'} backfired — {w.name} connects four!")
                return r.finish(w, text)
        if all(v is not None for v in self.grid[0]):
            nxt = self.next_seat(seat)
            if not (self.s.get("pull") and nxt is not None and pulls_for(self.grid, nxt)):
                return r.finish(None, "🤝 The board is full — it's a draw.")
        if len(self.moves) >= MOVE_CAP:
            return r.finish(None, f"🤝 {MOVE_CAP} moves and nobody connected — it's a draw.")
        r.advance()

    def next_seat(self, seat):
        n = len(self.seats)
        for k in range(1, n + 1):
            s = (seat + k) % n
            if self.in_play(s):
                return s
        return None

    def meta(self, p):
        return "💣" * self.bombs.get(p.id, 0)

    def view(self, p):
        return {"d4": {"grid": self.grid, "seats": self.seats, "last": self.last, "line": self.line,
                       "me": self.seats.index(p.id) if p.id in self.seats else None,
                       "moves": list(self.moves), "bombs": self.bombs.get(p.id, 0),
                       "pulls": pulls_for(self.grid, self.seats.index(p.id)) if self.s.get("pull") and p.id in self.seats else []}}

    # -- bot

    def bot_turn(self, p):
        seat = self.seats.index(p.id)
        cols = [c for c in range(len(self.grid[0])) if drop_row(self.grid, c) is not None]
        n = len(self.seats)
        others = [s for s in range(n) if s != seat and self.in_play(s)]

        def wins(grid, s, c):
            g, _ = apply_drop(grid, c, s)
            return g is not None and find_line(g, s) is not None

        def gives_away(c):
            g, _ = apply_drop(self.grid, c, seat)
            return any(wins(g, s, c) for s in others)

        # 1. win now (bombs and pulls too, if it's clean)
        for c in cols:
            if wins(self.grid, seat, c):
                return self.drop(p, c)
        pulls = pulls_for(self.grid, seat) if self.s.get("pull") else []
        for c in pulls:
            g = apply_pull(self.grid, c)
            if find_line(g, seat) and p.bot != "easy":
                return self.pull(p, c)
        if not cols:  # a full board: only a pull is left
            return self.pull(p, random.choice(pulls))
        if self.bombs.get(p.id) and p.bot != "easy":
            for c in cols:
                g, _ = apply_drop(self.grid, c, seat, True)
                if find_line(g, seat) and not any(find_line(g, s) for s in others):
                    return self.drop(p, c, True)
        if p.bot == "easy" and random.random() < 0.5:
            return self.drop(p, random.choice(cols))
        # 2. block anyone's immediate win
        for s in others:
            for c in cols:
                if wins(self.grid, s, c):
                    return self.drop(p, c)
        # 3. don't hand out a win on top of my disc
        safe = [c for c in cols if not gives_away(c)] or cols
        if n == 2 and p.bot == "hard":
            return self.drop(p, self.search(seat, safe))
        noise = {"easy": 25, "normal": 6, "hard": 0}[p.bot]
        best = max(safe, key=lambda c: score_grid(apply_drop(self.grid, c, seat)[0], seat)
                   + random.uniform(0, noise))
        # a pull that leaves nobody a line and scores clearly better than the best drop
        if pulls and p.bot != "easy":
            def pull_ok(c):
                g = apply_pull(self.grid, c)
                return not any(find_line(g, s) for s in others)
            ok = [c for c in pulls if pull_ok(c)]
            if ok:
                pc = max(ok, key=lambda c: score_grid(apply_pull(self.grid, c), seat))
                if score_grid(apply_pull(self.grid, pc), seat) > score_grid(apply_drop(self.grid, best, seat)[0], seat) + 8:
                    return self.pull(p, pc)
        self.drop(p, best)

    def search(self, seat, candidates, depth=4):
        """Two-player negamax with alpha-beta, centre-first ordering."""
        cols_n = len(self.grid[0])
        order = sorted(range(cols_n), key=lambda c: abs(c - cols_n // 2))

        def negamax(grid, me, d, alpha, beta):
            moves = [c for c in order if drop_row(grid, c) is not None]
            if not moves:
                return 0
            if d == 0:
                return score_grid(grid, me)
            best = -10 ** 9
            for c in moves:
                g, _ = apply_drop(grid, c, me)
                val = 100000 + d if find_line(g, me) else -negamax(g, 1 - me, d - 1, -beta, -alpha)
                best = max(best, val)
                alpha = max(alpha, val)
                if alpha >= beta:
                    break
            return best

        scored = []
        for c in sorted(candidates, key=lambda c: abs(c - cols_n // 2)):
            g, _ = apply_drop(self.grid, c, seat)
            scored.append((-negamax(g, 1 - seat, depth - 1, -10 ** 9, 10 ** 9), c))
        return max(scored)[1]
