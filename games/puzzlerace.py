"""The shared race for pencil puzzles (Sudoku, Word Search): everyone gets the same puzzle at the same
time, as in Word Ladder and the patience games. A round ends when the clock runs out or nobody is
still working on it (finished or called it a day with 🏳️). Most points after the last round wins;
alone, finish every puzzle to win.

The subclass owns the puzzle (`new_puzzle`), each player's copy of it (`fresh`), its moves (`move`),
the bot's next move (`bot_move`), when a copy is finished (`finished`) and the points for a round
(`points`). This class owns the clock, rounds, bots' pacing, banking, the reveal and the final result."""
import random
import time

from .base import Game, GameError

REVEAL_SECS = 8
CLEAR, FIRST = 10, 5


class PuzzleRace(Game):
    min_players = 1
    max_players = 6
    replayable = False   # many small moves; the log keeps the story
    noun = "puzzle"
    BOT = {"easy": 9.0, "normal": 6.0, "hard": 3.5}   # seconds per bot move (± 30%)
    first_bonus = FIRST   # 0 for games with no race to finish first
    NO_CLOCK = 6 * 3600   # what a "secs" setting of 0 (no clock) means

    def round_secs(self):
        return self.s["secs"] or self.NO_CLOCK

    # -- for subclasses
    def new_puzzle(self, rng):
        """Set up this round's puzzle on self; return a short description for the log."""
        raise NotImplementedError

    def fresh(self):
        """A player's own copy of this round's puzzle (a JSON-able dict)."""
        raise NotImplementedError

    def move(self, p, st, a):
        """Apply a game action to player p's copy `st`, or raise GameError."""
        raise GameError("Unknown action.")

    def bot_move(self, p, st):
        """Make one move for bot p on `st`. Return False when it has nothing left to try (it then banks)."""
        raise NotImplementedError

    def finished(self, pid):
        raise NotImplementedError

    def points(self, p):
        """Points for this round, before the clear and first-finish bonuses."""
        return 0

    def progress(self, pid):
        """[done, total] for the progress bars of other players."""
        return [0, 1]

    def scored_live(self):
        """True when points() already reached the scores move by move (the reveal only reports them)."""
        return False

    def public(self, p):
        """This viewer's slice of the puzzle for view()."""
        return {}

    def bot_pace(self, p, st):
        """Seconds until bot p's next move."""
        return self.BOT.get(p.bot or "normal", 6.0) * self.rng.uniform(0.7, 1.3)

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0   # the bot simulator fast-forwards this virtual clock
        self.ids = []
        self.round = 0
        self.solo = len(seated) == 1
        self.st = {}
        for p in seated:
            self.late_join(p)
        self.room.turn = None
        self.room.bot_at = 0
        today = time.strftime("%Y-%m-%d")
        key = " ".join(str(v) for k, v in sorted(self.s.items()) if k not in ("rounds", "secs", "daily", "hints"))
        self.prng = random.Random(f"{self.id} {today} {key}") if self.s.get("daily") else rng
        n = self.s["rounds"]
        self.room.add_log(f"{self.icon} {self.name}! {n} {self.noun}{'s' if n > 1 else ''}, everyone gets the same one"
                          + (f" (📅 today's, {today})" if self.s.get("daily") else "") + ".", "big")
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
        if getattr(self, "stage", None) == "play":
            self.st[p.id] = self.fresh()

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def next_round(self):
        self.round += 1
        self.mark_round()
        about = self.new_puzzle(self.prng)
        self.st = {pid: self.fresh() for pid in self.ids}
        self.done = {}         # pid -> seconds to finish
        self.banked = set()
        self.gained = {}
        self.plans = []
        self.stage = "play"
        self.t0 = self.now()
        self.end = self.t0 + self.round_secs()
        for p in self.live():
            if p.bot:
                self.plan(p)
        self.sync()
        self.room.add_log(f"{self.icon} {self.noun.capitalize()} {self.round}/{self.s['rounds']}: {about}. Go!", "question")

    # -- the clock

    def plan(self, p):
        self.plans = [x for x in self.plans if x[1] != p.id]
        self.plans.append((self.now() + self.bot_pace(p, self.st.get(p.id)), p.id))
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
            try:
                ok = self.bot_move(p, self.st[pid])
            except GameError:
                ok = True   # a stale idea; think again next time
            if ok is False:
                self.bank(p)
                continue
            self.after_move(p)
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
            raise GameError(f"This {self.noun} is over.")
        if p.id in self.done:
            raise GameError(f"You've finished this {self.noun}.")
        if p.id in self.banked:
            raise GameError(f"You've called this {self.noun} a day.")
        if a.get("type") == "bank":
            return self.bank(p)
        st = self.st.setdefault(p.id, self.fresh())
        self.move(p, st, a)
        self.after_move(p)

    def after_move(self, p):
        if p.id in self.done or not self.finished(p.id):
            if self.stage == "play" and not self.waiting_on():
                self.reveal()
            return
        secs = self.now() - self.t0
        self.done[p.id] = secs
        first = len(self.done) == 1 and not self.solo and self.first_bonus
        p.g.cleared += 1
        p.g.secs += secs
        self.plans = [x for x in self.plans if x[1] != p.id]
        m, s = divmod(int(secs), 60)
        self.room.add_log(f"🏁 {p.name} finished in {m}:{s:02d}" + (" (first!)" if first else "") + ".", "power")
        if first:
            self.moment(f"🏁 {p.name} finished first!", "cool", "tag")
        elif self.solo:
            self.moment("🏁 Solved!", "gold", "fanfare")
        self.on_finish(p, secs)
        if not self.waiting_on():
            self.reveal()

    def on_finish(self, p, secs):
        pass

    def bank(self, p):
        if p.id in self.banked:
            raise GameError("You've already called it.")
        self.banked.add(p.id)
        self.plans = [x for x in self.plans if x[1] != p.id]
        self.room.add_log(f"🏳️ {p.name} calls it a day.")
        if self.stage == "play" and not self.waiting_on():
            self.reveal()

    def waiting_on(self):
        return [p for p in self.live() if self.playing(p.id)] if self.stage == "play" else []

    def reveal(self):
        first = min(self.done, key=self.done.get) if self.done and not self.solo else None
        for p in self.live():
            pts = self.points(p) if p.id in self.st else 0
            if p.id in self.done:
                pts += CLEAR + (self.first_bonus if p.id == first else 0)
            else:
                p.g.secs += self.round_secs()
            pts = max(0, pts)
            if not self.scored_live():
                p.g.score += pts
            self.gained[p.id] = pts
        self.room.add_log(f"{self.icon} {self.noun.capitalize()} {self.round}: " + " · ".join(
            f"{p.name} +{self.gained[p.id]}" for p in sorted(self.live(), key=lambda q: -self.gained[q.id])))
        self.stage = "reveal"
        self.plans = []
        self.end = self.now() + REVEAL_SECS
        self.sync()

    def finish_game(self):
        r = self.room
        live = self.live()
        n = self.s["rounds"]
        if self.solo and len(live) == 1:
            p = live[0]
            text = f"{p.g.cleared}/{n} {self.noun}s finished, {p.g.score} points"
            if p.g.cleared >= n:
                return r.finish(p, f"🏆 {p.name} finished every {self.noun}: {text}!")
            return r.finish(None, f"{self.icon} {p.name}: {text}. Finish them all to win: try again!")
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
        if self.stage == "play" and p.id in self.st:
            d, t = self.progress(p.id)
            return f"{p.g.score} pts · " + ("🏁" if p.id in self.done else "🏳️" if p.id in self.banked else f"{d}/{t}")
        return f"{p.g.score} pts"

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        out = {
            "stage": self.stage, "round": self.round, "rounds": self.s["rounds"],
            "done": p.id in self.done, "banked": p.id in self.banked,
            "playing": p.id in self.ids and not p.eliminated,
            "left": max(0.0, self.end - self.now()), "secs": self.round_secs() if self.stage == "play" else REVEAL_SECS,
            "clock": bool(self.s.get("secs")),
            "rivals": [{"id": q.id, "prog": self.progress(q.id) if q.id in self.st else [0, 1],
                        "done": round(self.done[q.id]) if q.id in self.done else None, "banked": q.id in self.banked,
                        "score": q.g.score}
                       for q in self.live()],
            "solo": self.solo,
            "gained": self.gained if self.stage == "reveal" else None,
        }
        out.update(self.public(p))
        return {self.id: out}
