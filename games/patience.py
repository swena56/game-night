"""The shared race for the patience (solitaire) games, FreeCell and Solitaire (Klondike).

Everyone plays their own copy of the same deal at the same time, as in Word Ladder. A deal ends when
the clock runs out or everyone has cleared it or called it a day (🏳️). A player scores 1 point for every
card on their foundations, +10 for clearing the deal and +5 for clearing it first. Most points after the
last deal wins; alone, clear every deal to win.

Cards are rank + suit strings ('AS', 'TD', 'KH'). The subclass owns the board layout and its rules
(`deal_board`, `legal`, `apply`, `bot_move`); this class owns the clock, the undo stack, scoring and the
view of everyone else's progress (never their cards)."""
import copy
import random
import time

from .base import Game, GameError

RANKS = "A23456789TJQK"
SUITS = "SHDC"            # foundation order
REVEAL_SECS = 7
CLEAR, FIRST, HINT = 10, 5, 1
UNDO_DEPTH = 300


def rank(c):
    return RANKS.index(c[0]) + 1


def red(c):
    return c[1] in "HD"


def fits_on(card, under):
    """Can `card` go on `under` in a tableau column: one rank lower, the other colour."""
    return rank(card) == rank(under) - 1 and red(card) != red(under)


def run_ok(cards):
    """Is `cards` (top of column last) a built sequence: each card one lower and the other colour?"""
    return all(fits_on(cards[i + 1], cards[i]) for i in range(len(cards) - 1))


def fresh_deck(rng):
    deck = [r + s for s in SUITS for r in RANKS]
    rng.shuffle(deck)
    return deck


class Patience(Game):
    category = "cards"
    min_players = 1
    max_players = 6
    replayable = False   # a deal is hundreds of small moves; the log keeps the story
    BOT = {"easy": 3.2, "normal": 1.9, "hard": 1.1}   # seconds per bot move (± 30%)

    # -- for subclasses
    def deal_board(self, rng):
        raise NotImplementedError

    def apply(self, b, a):
        """Apply action `a` to board `b` in place or raise GameError. Returns a log word or None."""
        raise NotImplementedError

    def bot_move(self, p, b):
        """The bot's next action dict, or None when it has nothing useful left (it then banks)."""
        raise NotImplementedError

    def public_board(self, b):
        return b

    def auto_moves(self, b):
        """Actions the ⏫ button may send to the foundations (all of them, in order)."""
        return []

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0
        self.ids = []
        self.round = 0
        self.solo = len(seated) == 1
        self.boards, self.undo, self.done, self.banked, self.moves, self.hints = {}, {}, {}, set(), {}, {}
        for p in seated:
            self.late_join(p)
        self.room.turn = None
        self.room.bot_at = 0
        today = time.strftime("%Y-%m-%d")
        self.prng = random.Random(f"{self.id} {today} {self.s.get('draw', '')}") if self.s.get("daily") else rng
        self.room.add_log(f"{self.icon} {self.name}! {self.s['rounds']} deal{'s' if self.s['rounds'] > 1 else ''}, "
                          f"everyone plays the same cards" + (f" (📅 the deals for {today})" if self.s.get("daily") else "") + ".", "big")
        self.next_round()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def late_join(self, p):
        p.g.score = 0
        p.g.cleared = 0
        p.g.secs = 0.0
        self.ids.append(p.id)
        if getattr(self, "deal", None):
            self.boards[p.id] = copy.deepcopy(self.deal)

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def next_round(self):
        self.round += 1
        self.deal_no = self.prng.randrange(1, 1_000_000)
        self.deal = self.deal_board(random.Random(self.deal_no))
        self.boards = {pid: copy.deepcopy(self.deal) for pid in self.ids}
        self.undo = {pid: [] for pid in self.ids}
        self.moves = {pid: 0 for pid in self.ids}
        self.hints = {}
        self.hint = {}
        self.done = {}         # pid -> seconds to clear
        self.banked = set()    # called it a day
        self.gained = {}
        self.plans = []
        self.bot_state = {}
        self.stage = "play"
        self.t0 = self.now()
        self.end = self.t0 + self.s["secs"]
        for p in self.live():
            if p.bot:
                self.plan(p)
        self.sync()
        self.room.add_log(f"{self.icon} Deal {self.round}/{self.s['rounds']} (#{self.deal_no}): go!", "question")

    # -- the clock (as Word Ladder)

    def plan(self, p, soon=False):
        pace = self.BOT.get(p.bot or "normal", 1.9)
        self.plans = [x for x in self.plans if x[1] != p.id]
        self.plans.append((self.now() + (0.6 if soon else pace * self.rng.uniform(0.7, 1.3)), p.id))
        self.plans.sort()

    def sync(self):
        self.room.deadline = self.next_event() - self.skew

    def next_event(self):
        return min([self.end] + [t for t, _ in self.plans[:1]])

    def bot_ready(self):
        return self.room.phase == "playing" and self.now() >= self.next_event()

    def bot_tick(self):
        self.process()

    def on_timeout(self):
        gap = self.next_event() - self.now()
        if gap > 0:
            self.skew += gap
        self.process()

    def process(self):
        now = self.now()
        if self.stage == "reveal":
            if now >= self.end:
                return self.finish_game() if self.round >= self.s["rounds"] else self.next_round()
            return
        while self.plans and self.plans[0][0] <= now and self.stage == "play":
            _, pid = self.plans.pop(0)
            p = self.room.players.get(pid)
            if not p or p not in self.live() or not self.playing(pid):
                continue
            b = self.boards[pid]
            a = None
            try:
                a = self.bot_move(p, b)
            except GameError:
                a = None
            if a is None:
                self.bank(p)
                continue
            try:
                self.do(p, a)
            except GameError:
                self.bot_state.pop(pid, None)   # its plan went stale; think again next time
            if self.stage == "play" and self.playing(pid):
                self.plan(p)
        if self.stage != "play":
            return
        if now >= self.end or not self.waiting_on():
            return self.reveal()
        self.sync()

    # -- actions

    def playing(self, pid):
        return pid not in self.done and pid not in self.banked

    def act(self, p, a):
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        if self.stage != "play" or self.now() >= self.end:
            raise GameError("This deal is over.")
        if p.id in self.done:
            raise GameError("You've cleared this deal.")
        kind = a.get("type")
        if kind == "bank":
            if p.id in self.banked:
                raise GameError("You've already called it.")
            return self.bank(p)
        if p.id in self.banked:
            raise GameError("You've called this deal a day.")
        if kind == "hint":
            b = self.boards[p.id]
            mv = self.find_hint(p, b)
            if not mv:
                raise GameError("No helpful move left: undo, draw, or call it a day (🏳️).")
            self.hints[p.id] = self.hints.get(p.id, 0) + 1
            self.hint[p.id] = mv
            return
        if kind == "undo":
            st = self.undo.get(p.id) or []
            if not st:
                raise GameError("Nothing to take back.")
            self.boards[p.id] = st.pop()
            self.moves[p.id] = self.moves.get(p.id, 0) + 1
            self.hint.pop(p.id, None)
            return
        if kind == "auto":
            b = self.boards[p.id]
            seq = self.auto_moves(b)
            if not seq:
                raise GameError("Nothing can go up to the foundations yet.")
            self.undo.setdefault(p.id, []).append(copy.deepcopy(b))
            for mv in seq:
                self.apply(b, mv)
            self.moves[p.id] = self.moves.get(p.id, 0) + 1
            self.after_move(p)
            return
        self.do(p, a)

    def do(self, p, a):
        b = self.boards[p.id]
        before = copy.deepcopy(b)
        self.apply(b, a)
        st = self.undo.setdefault(p.id, [])
        st.append(before)
        del st[:-UNDO_DEPTH]
        self.moves[p.id] = self.moves.get(p.id, 0) + 1
        self.hint.pop(p.id, None)
        self.after_move(p)

    def find_hint(self, p, b):
        """One useful move for the 💡 button: what a normal bot would do next."""
        fake = type("P", (), {"id": f"hint-{p.id}", "bot": "normal", "g": p.g})()
        saved = self.bot_state.pop(fake.id, None)
        try:
            mv = self.bot_move(fake, copy.deepcopy(b))
        except GameError:
            mv = None
        finally:
            self.bot_state.pop(fake.id, None)
            if saved is not None:
                self.bot_state[fake.id] = saved
        return mv

    @staticmethod
    def home(b):
        return sum(b["f"].values())

    def after_move(self, p):
        b = self.boards[p.id]
        if self.home(b) == 52 and p.id not in self.done:
            secs = self.now() - self.t0
            self.done[p.id] = secs
            first = len(self.done) == 1 and not self.solo
            p.g.cleared += 1
            p.g.secs += secs
            self.plans = [x for x in self.plans if x[1] != p.id]
            m, s = divmod(int(secs), 60)
            self.room.add_log(f"🏁 {p.name} cleared the deal in {m}:{s:02d} and {self.moves.get(p.id, 0)} moves"
                              + (" (first!)" if first else "") + ".", "power")
            if first:
                self.moment(f"🏁 {p.name} cleared it first!", "cool", "tag")
            elif self.solo:
                self.moment("🏁 Cleared!", "gold", "fanfare")
            self.cleared_badges(p, b)
            if not self.waiting_on():
                self.reveal()

    def cleared_badges(self, p, b):
        pass

    def bank(self, p):
        self.banked.add(p.id)
        self.plans = [x for x in self.plans if x[1] != p.id]
        self.room.add_log(f"🏳️ {p.name} calls it a day with {self.home(self.boards[p.id])} cards home.")
        if self.stage == "play" and not self.waiting_on():
            self.reveal()

    def waiting_on(self):
        return [p for p in self.live() if self.playing(p.id)] if self.stage == "play" else []

    def reveal(self):
        first = min(self.done, key=self.done.get) if self.done and not self.solo else None
        for p in self.live():
            b = self.boards.get(p.id)
            pts = self.home(b) if b else 0
            if p.id in self.done:
                pts += CLEAR + (FIRST if p.id == first else 0)
            else:
                p.g.secs += self.s["secs"]
            pts = max(0, pts - HINT * self.hints.get(p.id, 0))
            p.g.score += pts
            self.gained[p.id] = pts
        self.room.add_log(f"{self.icon} Deal {self.round}: " + " · ".join(
            f"{p.name} +{self.gained[p.id]}" for p in sorted(self.live(), key=lambda q: -self.gained[q.id])))
        self.stage = "reveal"
        self.plans = []
        self.end = self.now() + REVEAL_SECS
        self.sync()

    def finish_game(self):
        r = self.room
        live = self.live()
        if self.solo and len(live) == 1:
            p = live[0]
            text = f"{p.g.cleared}/{self.s['rounds']} deals cleared, {p.g.score} points"
            if p.g.cleared >= self.s["rounds"]:
                return r.finish(p, f"🏆 {p.name} cleared every deal: {text}!")
            return r.finish(None, f"{self.icon} {p.name}: {text}. Clear them all to win: try again!")
        if not live:
            return r.finish(None, "Everyone left.")
        ranked = sorted(live, key=lambda q: (-q.g.score, q.g.secs))
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score and abs(ranked[0].g.secs - ranked[1].g.secs) < 1:
            return r.finish(None, f"🤝 Tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins {self.name}! {text}")

    def on_leave(self, p):
        self.room.add_log(f"{p.name} left the game.")
        p.eliminated = True
        self.plans = [x for x in self.plans if x[1] != p.id]
        live = self.live()
        if not live or (not self.solo and len(live) < 2):
            return self.finish_game()
        if self.stage == "play" and not self.waiting_on():
            self.reveal()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        b = self.boards.get(p.id)
        if self.stage == "play" and b:
            return f"{self.home(b)}/52" + (" · 🏁" if p.id in self.done else " · 🏳️" if p.id in self.banked else "")
        return f"{p.g.score} pts"

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        b = self.boards.get(p.id) or self.deal
        out = {
            "stage": self.stage, "round": self.round, "rounds": self.s["rounds"], "deal": self.deal_no,
            "board": self.public_board(b),
            "moves": self.moves.get(p.id, 0),
            "undo": bool(self.undo.get(p.id)),
            "auto": bool(self.auto_moves(b)) if p.id in self.boards else False,
            "hint": self.hint.get(p.id),
            "hints": self.hints.get(p.id, 0),
            "done": p.id in self.done, "banked": p.id in self.banked,
            "playing": p.id in self.ids and not p.eliminated,
            "left": max(0.0, self.end - self.now()), "secs": self.s["secs"] if self.stage == "play" else REVEAL_SECS,
            "rivals": [{"id": q.id, "home": self.home(self.boards[q.id]) if q.id in self.boards else 0,
                        "done": round(self.done[q.id]) if q.id in self.done else None, "banked": q.id in self.banked,
                        "score": q.g.score}
                       for q in self.live()],
            "solo": self.solo,
            "gained": self.gained if self.stage == "reveal" else None,
        }
        return {self.id: out}
