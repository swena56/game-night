"""Dots & Boxes, the pencil-and-paper classic, for 2–4 players. Draw one line per turn; close a box
to claim it and move again. Optional 💎 gem boxes are worth 3."""
import random
import time

from .base import Game, GameError

GEM = 3


class Boxes(Game):
    id = "boxes"
    category = "classic"
    howto = [
        "Take turns drawing one line between two neighbouring dots.",
        "Draw the 4th side of a box to claim it — then you move again.",
        "Careful: drawing a box's 3rd side hands it to the next player.",
        "💎 Gem boxes are worth 3. Most points when the grid is full wins.",
    ]
    name = "Dots & Boxes"
    icon = "🔳"
    blurb = "Draw lines, close boxes, chain your captures. Don't draw the third side!"
    min_players = 2
    max_players = 6
    settings_schema = {
        "size": ("Grid", [(3, "3×3 (quick)"), (4, "4×4"), (5, "5×5"), (6, "6×6 (long)"),
                          ("4x6", "4×6 wide"), ("5x8", "5×8 wide (long)")], 4),
        "gems": ("Gem boxes", [(True, "💎 On"), (False, "Off")], True),
    }

    # -- setup

    def __setstate__(self, state):  # games saved before wide grids had only a square size n
        self.__dict__.update(state)
        if "rows" not in state and "n" in state:
            self.rows = self.cols = state["n"]

    def start(self, seated, rng):
        self.rng = rng
        size = self.s["size"]
        rows, cols = self.rows, self.cols = (size, size) if isinstance(size, int) else tuple(map(int, size.split("x")))
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.h = [[None] * cols for _ in range(rows + 1)]  # seat that drew each horizontal line
        self.v = [[None] * (cols + 1) for _ in range(rows)]
        self.owner = [[None] * cols for _ in range(rows)]
        cells = [(r, c) for r in range(rows) for c in range(cols)]
        self.gems = [list(b) for b in sorted(rng.sample(cells, max(1, len(cells) // 6)))] if self.s["gems"] else []
        self.last = None
        self.claimed_last = []
        for p in seated:
            p.g.score = 0
            p.g.boxes = 0
        self.room.add_log(f"🔳 {rows}×{cols} boxes. {seated[0].name} draws first.", "big")
        self.room.begin_turn(seated[0].id)

    # -- geometry (lines are tuples ("h"|"v", r, c); boxes are (r, c))

    def lines(self):
        rows, cols = self.rows, self.cols
        return ([("h", r, c) for r in range(rows + 1) for c in range(cols)]
                + [("v", r, c) for r in range(rows) for c in range(cols + 1)])

    def cells(self):
        return [(r, c) for r in range(self.rows) for c in range(self.cols)]

    def boxes_of(self, line):
        d, r, c = line
        if d == "h":
            return [(rr, c) for rr in (r - 1, r) if 0 <= rr < self.rows]
        return [(r, cc) for cc in (c - 1, c) if 0 <= cc < self.cols]

    @staticmethod
    def sides_of(box):
        r, c = box
        return [("h", r, c), ("h", r + 1, c), ("v", r, c), ("v", r, c + 1)]

    def value(self, box):
        return GEM if list(box) in self.gems else 1

    def drawn(self):
        return {ln for ln in self.lines() if self.is_drawn(ln)}

    def is_drawn(self, line):
        d, r, c = line
        return (self.h if d == "h" else self.v)[r][c] is not None

    # -- actions

    def act(self, p, a):
        if a.get("type") != "line":
            raise GameError("Unknown action.")
        self.require_turn(p)
        d, r, c = a.get("d"), a.get("r"), a.get("c")
        rows, cols = self.rows, self.cols
        ok = (isinstance(r, int) and isinstance(c, int) and
              ((d == "h" and 0 <= r <= rows and 0 <= c < cols) or (d == "v" and 0 <= r < rows and 0 <= c <= cols)))
        if not ok:
            raise GameError("That's not a line on this grid.")
        if self.is_drawn((d, r, c)):
            raise GameError("That line is already drawn.")
        self.draw(p, (d, r, c))

    def draw(self, p, line):
        d, r, c = line
        seat = self.seats.index(p.id)
        (self.h if d == "h" else self.v)[r][c] = seat
        self.last = [d, r, c]
        drawn = self.drawn()
        won = [b for b in self.boxes_of(line) if all(s in drawn for s in self.sides_of(b))]
        self.claimed_last = [list(b) for b in won]
        for br, bc in won:
            self.owner[br][bc] = seat
            p.g.score += self.value((br, bc))
            p.g.boxes += 1
        where = f"{'—' if d == 'h' else '|'} {r + 1}·{c + 1}"
        if won:
            pts = sum(self.value(b) for b in won)
            gem = " 💎" if any(self.value(b) > 1 for b in won) else ""
            self.room.add_log(f"{p.name} closes {len(won)} box{'es' if len(won) > 1 else ''}{gem} (+{pts}) and goes again.", "question")
        else:
            self.room.add_log(f"{p.name} draws {where}", "question")
        if all(v is not None for row in self.owner for v in row):
            return self.finish_game()
        if won:
            self.room.begin_turn(p.id)
            if p.bot:
                self.room.bot_at = time.time() + 0.7
        else:
            self.room.advance()

    def finish_game(self):
        r = self.room
        ranked = sorted((r.players[i] for i in self.seats if i in r.players), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 Tie at the top! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins! {text}")

    def final_scores(self):
        return {pid: self.room.players[pid].g.score for pid in self.seats if pid in self.room.players}

    def on_timeout(self):
        """Out of time: draw a random line for them (passing would stall a full grid)."""
        p = self.room.players[self.room.turn]
        self.room.add_log(f"⏰ {p.name} ran out of time — a random line is drawn.", "power")
        free = [ln for ln in self.lines() if not self.is_drawn(ln)]
        self.draw(p, random.choice(free))

    # -- what each player sees

    def meta(self, p):
        return f"{p.g.score} pts" if hasattr(p.g, "score") else ""

    def view(self, p):
        return {"boxes": {"rows": self.rows, "cols": self.cols, "h": self.h, "v": self.v, "owner": self.owner, "gems": self.gems,
                          "seats": self.seats, "last": self.last, "claimed": self.claimed_last}}

    # -- bot

    def three_sided(self, drawn):
        return [(r, c) for r, c in self.cells()
                if sum(s in drawn for s in self.sides_of((r, c))) == 3]

    def gives(self, drawn, line):
        """Boxes (by value) the next player can grab greedily after `line` is drawn."""
        drawn = drawn | {line}
        total = 0
        while True:
            ready = self.three_sided(drawn)
            if not ready:
                return total
            box = ready[0]
            gap = next(s for s in self.sides_of(box) if s not in drawn)
            drawn.add(gap)
            total += sum(self.value(b) for b in self.boxes_of(gap)
                         if all(s in drawn for s in self.sides_of(b)))

    def safe(self, drawn, line):
        return all(sum(s in drawn for s in self.sides_of(b)) < 2 for b in self.boxes_of(line))

    def double_deal(self, drawn, free):
        """If only the last two boxes of a chain are left to take and the rest of the board is all
        sacrifices, leave those two for the opponent (one line takes both) to keep control."""
        ready = self.three_sided(drawn)
        if len(ready) != 1:
            return None
        a = ready[0]
        gap = next(s for s in self.sides_of(a) if s not in drawn)
        nxt = [b for b in self.boxes_of(gap) if b != a]
        if not nxt:
            return None
        b = nxt[0]
        b_missing = [s for s in self.sides_of(b) if s not in drawn]
        if len(b_missing) != 2:
            return None
        far = next(s for s in b_missing if s != gap)
        if any(sum(s in drawn for s in self.sides_of(o)) >= 2 for o in self.boxes_of(far) if o != b):
            return None  # the chain keeps going past b
        rest = [ln for ln in free if ln not in (gap, far)]
        if not rest or any(self.safe(drawn, ln) for ln in rest):
            return None
        left = sum(self.value((r, c)) for r, c in self.cells()
                   if self.owner[r][c] is None and (r, c) not in (a, b))
        return far if left > self.value(a) + self.value(b) + 2 else None

    def bot_turn(self, p):
        drawn = self.drawn()
        free = [ln for ln in self.lines() if ln not in drawn]
        ready = self.three_sided(drawn)
        level = p.bot
        if level == "easy" and random.random() < 0.35:
            return self.draw(p, random.choice(free))
        if ready:
            if level == "hard" and len(self.seats) == 2:  # with more players, control passes to someone else
                deal = self.double_deal(drawn, free)
                if deal:
                    self.room.add_log(f"🤝 {p.name} hands over two boxes to keep control…", "power")
                    return self.draw(p, deal)
            box = max(ready, key=self.value)
            return self.draw(p, next(s for s in self.sides_of(box) if s not in drawn))
        safe = [ln for ln in free if self.safe(drawn, ln)]
        if safe:
            return self.draw(p, random.choice(safe))
        if level == "easy":
            return self.draw(p, random.choice(free))
        costs = {ln: self.gives(drawn, ln) for ln in free}
        least = min(costs.values())
        best = [ln for ln in free if costs[ln] == least]
        if level == "hard":
            # Hard-hearted handout: in a two-box chain, draw the middle line so it can't be double-dealt.
            middle = [ln for ln in best if len(self.boxes_of(ln)) == 2 and
                      all(sum(s in drawn for s in self.sides_of(b)) == 2 for b in self.boxes_of(ln))]
            best = middle or best
        self.draw(p, random.choice(best))
