"""🦋 Kindred: an original two-player piece-giving game on a 4×4 board (feedback #96 asked for Quarto; this
is our own take on the "your rival picks your piece" idea, with scoring instead of a first-line win).

There are 16 pieces, one of each mix of four traits: ☀️ sun or 🌙 moon, ● round or ■ square, big or small,
✦ starred or plain. A piece is a 4-bit number: 1 big, 2 moon, 4 square, 8 starred.

On your turn you place the piece your rival handed you on any empty square, then hand them one of the
pieces left. Each time a placement fills a line (a row, a column, a long diagonal, and with the "kin
squares" option any 2×2 block), the placer scores it trait by trait: 2 points when all four pieces share
the trait, 1 when three do, 0 for a 2–2 split. So a line is worth 0 to 8. The board always fills up; highest total after the rounds wins. The first player to give
alternates by round."""
import time

from .base import Game, GameError

N = 4
TRAITS = [(1, "big", "small"), (2, "moon", "sun"), (4, "square", "round"), (8, "starred", "plain")]
LINES = [[r * N + c for c in range(N)] for r in range(N)] + [[r * N + c for r in range(N)] for c in range(N)] \
    + [[i * N + i for i in range(N)], [i * N + N - 1 - i for i in range(N)]]
SQUARES = [[r * N + c, r * N + c + 1, (r + 1) * N + c, (r + 1) * N + c + 1] for r in range(N - 1) for c in range(N - 1)]
BETWEEN = 5  # seconds to look at a full board before the next round


def lines_for(variant):
    ls = LINES + (SQUARES if variant == "squares" else [])
    return [[ln for ln in ls if c in ln] for c in range(N * N)]


def shared(pieces):
    """A full line's points: per trait, 2 when all four pieces share it, 1 when three do, 0 for a 2–2 split."""
    pts = 0
    for bit, _, _ in TRAITS:
        k = sum(1 for p in pieces if p & bit)
        pts += abs(k - 2)
    return pts


def gain(board, through, cell, piece):
    """Points for placing `piece` at `cell`, and the lines it completes [(cells, points)]."""
    pts, done = 0, []
    for ln in through[cell]:
        if all(board[c] is not None or c == cell for c in ln):
            k = shared([piece if c == cell else board[c] for c in ln])
            pts += k
            done.append((ln, k))
    return pts, done


def piece_name(p):
    return " ".join(a if p & bit else b for bit, a, b in TRAITS)


def piece_icon(p):
    return ("🌙" if p & 2 else "☀️") + ("■" if p & 4 else "●") + ("✦" if p & 8 else "") + ("⬆" if p & 1 else "")


class Kindred(Game):
    id = "kindred"
    category = "strategy"
    name = "Kindred"
    icon = "🦋"
    blurb = "Place the piece your rival hands you, then pick theirs. Fill a line of look-alikes to score."
    howto = [
        "16 pieces, each a mix of four traits: ☀️ sun or 🌙 moon, ● round or ■ square, big or small, ✦ starred or plain.",
        "Your turn: place the piece your rival handed you on any empty square, then tap the piece they must place next.",
        "Fill the last gap of a row, column or long diagonal and you score it, trait by trait: all four alike 2 points, three alike 1, a 2–2 split 0.",
        "Example: big ☀️●, small ☀️■, big ☀️■✦, big ☀️● → sun 4 alike (2) + big 3 alike (1) + round 3 alike (1) + plain 3 alike (1) = 5 points.",
        "So hand your rival a piece that splits the traits 2–2 wherever they could finish a line, and keep the good ones for yourself.",
        "The board always fills up. Highest total after the rounds wins; who gives first takes turns.",
    ]
    min_players = 2
    max_players = 2
    badges = {**Game.badges, "kin": ("🦋", "True kin", "Finish a line worth 7 or 8 points"),
              "triple": ("✨", "Big finish", "Score 10 points or more with one piece")}
    settings_schema = {
        "rounds": ("Rounds", [(1, "1 board"), (2, "2 boards (each gives first once)"), (4, "4 boards")], 2),
        "variant": ("Lines", [("classic", "Rows, columns, diagonals"), ("squares", "➕ 2×2 kin squares score too")], "classic"),
    }

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.rounds = int(self.s.get("rounds") or 2)
        self.variant = self.s.get("variant") or "classic"
        self.through = lines_for(self.variant)
        self.scores = [0, 0]
        self.round = -1
        self.room.add_log(f"🦋 Kindred: {self.rounds} board{'s' * (self.rounds > 1)}. Place the piece you're handed, then pick your rival's.", "big")
        self.new_round()

    def new_round(self):
        self.round += 1
        self.mark_round()
        self.board = [None] * (N * N)
        self.hand = None          # the piece the player to move must place
        self.stage = "give"       # give (first move of a board) | place | between
        self.last, self.scored = None, []
        giver = self.seats[self.round % 2]
        p = self.room.players.get(giver)
        if self.round:
            self.room.add_log(f"🦋 Board {self.round + 1} of {self.rounds}: {p.name if p else '?'} gives first.", "big")
        self.room.begin_turn(giver)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def pool(self):
        used = {x for x in self.board if x is not None} | ({self.hand} if self.hand is not None else set())
        return [x for x in range(16) if x not in used]

    def empties(self):
        return [c for c in range(N * N) if self.board[c] is None]

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're watching this game.")
        if a.get("type") == "resign":
            opp = self.room.players.get(self.seats[1 - self.seat(p)])
            return self.room.finish(opp, f"🏳️ {p.name} resigned — {opp.name if opp else 'their rival'} wins!")
        if a.get("type") != "move":
            raise GameError("Unknown action.")
        self.require_turn(p)
        cell, give = a.get("cell"), a.get("give")
        ok_int = lambda v: isinstance(v, int) and not isinstance(v, bool)
        if self.stage == "place":
            if not ok_int(cell) or not 0 <= cell < N * N or self.board[cell] is not None:
                raise GameError("Pick an empty square.")
        elif self.stage != "give":
            raise GameError("Wait for the next board.")
        last = self.stage == "place" and len(self.empties()) == 1
        if not last and (not ok_int(give) or give not in self.pool()):
            raise GameError("Pick a piece to hand over.")
        self.move(p, cell if self.stage == "place" else None, None if last else give)

    def move(self, p, cell, give):
        r = self.room
        me = self.seat(p)
        if cell is not None:
            pts, done = gain(self.board, self.through, cell, self.hand)
            self.board[cell] = self.hand
            self.last, self.scored = cell, [{"cells": ln, "pts": k} for ln, k in done]
            self.scores[me] += pts
            where = "abcd"[cell % N] + str(cell // N + 1)
            line = f"{p.name} places {piece_icon(self.hand)} at {where}"
            if done:
                line += ", finishing " + " + ".join(f"{k}" for _, k in done) + f" → +{pts}"
            r.add_log(line + ".", "question")
            if pts >= 10:
                self.award(p, "triple")
                self.moment(f"✨ {p.name} scores {pts} with one piece!", "gold", "fanfare")
            elif any(k >= 7 for _, k in done):
                self.award(p, "kin")
                self.moment(f"🦋 True kin! {p.name} finishes a {max(k for _, k in done)}-point line", "gold", "fanfare")
            elif pts >= 5:
                self.moment(f"🦋 +{pts} for {p.name}", "good", "coin")
            self.hand = None
        if give is not None:
            self.hand = give
            self.stage = "place"
            q = r.players.get(self.seats[1 - me])
            r.add_log(f"🎁 {p.name} hands {q.name if q else '?'} {piece_icon(give)} ({piece_name(give)}).", "info")
            return r.begin_turn(self.seats[1 - me])
        self.end_round()

    def end_round(self):
        r = self.room
        names = [r.players[i].name if i in r.players else "?" for i in self.seats]
        if self.round + 1 < self.rounds:
            self.stage = "between"
            r.turn = None
            r.deadline = time.time() + BETWEEN
            r.add_log(f"📊 Board {self.round + 1} full: {names[0]} {self.scores[0]}, {names[1]} {self.scores[1]}.", "big")
            return
        self.stage = "over"
        a, b = self.scores
        if a == b:
            return r.finish(None, f"🤝 A draw, {a}–{b}.")
        w = 0 if a > b else 1
        r.finish(r.players.get(self.seats[w]), f"🏆 {names[w]} wins Kindred, {self.scores[w]}–{self.scores[1 - w]}!")

    def on_timeout(self):
        r = self.room
        if self.stage == "between":
            return self.new_round()
        p = r.players.get(r.turn)
        if p:
            r.add_log(f"⏰ {p.name} ran out of time: a random move.", "power")
            self.move(p, *self.choose(p, "easy", random_only=True))

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left the game.")
        opp = r.players.get(self.seats[1 - self.seat(p)]) if self.seat(p) is not None else None
        r.finish(opp, f"🏳️ {p.name} left — {opp.name if opp else 'their rival'} wins!")

    # -- bots

    def bot_ready(self):
        if self.stage not in ("give", "place"):
            return False
        return super().bot_ready()

    def bot_turn(self, p):
        if self.room.turn != p.id or self.stage not in ("give", "place"):
            return
        self.move(p, *self.choose(p, p.bot or "normal"))

    def choose(self, p, level, random_only=False):
        """(cell or None, give or None). easy: half random, else greedy; normal: greedy, and hands over the
        piece whose best reply scores least, and plays the last 4 squares perfectly; hard: the last 6."""
        board, hand, rng = self.board, self.hand, self.rng
        cells = self.empties() if self.stage == "place" else [None]
        last = self.stage == "place" and len(cells) == 1
        pool = [] if last else [x for x in self.pool()]
        if random_only or (level == "easy" and rng.random() < 0.5):
            return rng.choice(cells), (rng.choice(pool) if pool else None)
        if self.stage == "place" and len(cells) <= {"hard": 6, "normal": 4}.get(level, 0):
            return exact_best(tuple(board), hand, self.through)
        best, best_v = None, None
        for c in cells:
            b = list(board)
            mine = 0
            if c is not None:
                mine, _ = gain(board, self.through, c, hand)
                b[c] = hand
            for gv in pool or [None]:
                if gv is None:
                    v = mine
                else:
                    # the rival's best placement of this piece, and (hard) what's left for me after
                    reply = max(gain(b, self.through, c2, gv)[0] for c2 in range(N * N) if b[c2] is None) if any(x is None for x in b) else 0
                    v = mine - reply * (1.0 if level != "easy" else 0.5)
                v += rng.random() * (0.3 if level == "easy" else 0.01)
                if best_v is None or v > best_v:
                    best, best_v = (c, gv), v
        return best

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🦋 {self.scores[i]}"

    def final_scores(self):
        return {pid: self.scores[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        return {"kindred": {
            "board": self.board, "hand": self.hand, "pool": self.pool(), "stage": self.stage, "seats": self.seats,
            "me": i, "scores": self.scores, "round": self.round, "rounds": self.rounds, "variant": self.variant,
            "last": self.last, "scored": self.scored,
            "lines": LINES + (SQUARES if self.variant == "squares" else []),
            "standings": self.standings() if self.stage == "between" else None,
        }}


def exact_best(board, hand, through):
    """The move with the best final score difference for the player holding `hand`, by full search
    (memoised on board + hand: about 0.1 s at 6 empty squares, 2 s at 7 on a slow host)."""
    memo = {}

    def nm(b, h):
        key = (b, h)
        if key in memo:
            return memo[key]
        empties = [c for c in range(N * N) if b[c] is None]
        used = {x for x in b if x is not None} | {h}
        pool = [x for x in range(16) if x not in used]
        best, move = None, None
        for c in empties:
            pts, _ = gain(b, through, c, h)
            nb = b[:c] + (h,) + b[c + 1:]
            if not pool or len(empties) == 1:
                v = pts
                if best is None or v > best:
                    best, move = v, (c, None)
                continue
            for g in pool:
                v = pts - nm(nb, g)[0]
                if best is None or v > best:
                    best, move = v, (c, g)
        memo[key] = (best, move)
        return memo[key]

    return nm(tuple(board), hand)[1]
