"""Trivia Rush: an original quick-fire quiz. Everyone sees the same question with four answers and
picks at once; right answers score more the faster they come in. Questions live in trivia_qs.py."""
import time

from .base import Game, GameError
from .trivia_qs import QUESTIONS, TOPICS

REVEAL_SECS = 5
BASE_PTS, SPEED_PTS = 100, 100
SOLO_GOAL = 0.7   # alone, get this share right to win
BOT = {  # chance of knowing the answer, and how many seconds they take
    "easy": (0.45, 5.0, 12.0),
    "normal": (0.62, 3.5, 9.0),
    "hard": (0.8, 2.5, 7.0),
}


class Trivia(Game):
    id = "trivia"
    category = "party"
    howto = [
        "Everyone gets the same question at the same time, with four answers to pick from.",
        f"A right answer scores {BASE_PTS}, plus up to {SPEED_PTS} more the faster you are. A wrong one scores nothing.",
        "You can't change your answer, so be quick but sure. The last question counts double.",
        f"Most points wins. Alone, get {round(SOLO_GOAL * 100)}% right to win.",
    ]
    name = "Trivia Rush"
    icon = "🧠"
    blurb = "Quick-fire quiz: four answers, one right, and faster right answers score more."
    min_players = 1
    max_players = 6
    settings_schema = {
        "questions": ("Questions", [(10, "10"), (15, "15"), (20, "20")], 10),
        "secs": ("Time to answer", [(15, "15 s"), (20, "20 s"), (10, "10 s")], 15),
        "topic": ("Topic", [("all", "🎲 Everything")] + [(k, v) for k, v in TOPICS.items()], "all"),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0  # the bot simulator fast-forwards this virtual clock
        pool = [q for q in QUESTIONS if self.s["topic"] in ("all", q[0])]
        self.queue = rng.sample(pool, min(self.s["questions"], len(pool)))
        self.ids = []
        for p in seated:
            self.late_join(p)
        self.solo = len(seated) == 1
        self.n = 0
        self.room.turn = None
        self.room.bot_at = 0
        topic = TOPICS.get(self.s["topic"], "🎲 Everything")
        self.room.add_log(f"🧠 Trivia Rush! {len(self.queue)} questions · {topic}. Faster right answers score more.", "big")
        self.next_question()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def late_join(self, p):
        p.g.score = 0
        p.g.right = 0
        p.g.streak = 0
        self.ids.append(p.id)

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def final(self):
        return self.n == len(self.queue)

    def next_question(self):
        self.n += 1
        topic, text, right, wrong = self.queue[self.n - 1]
        opts = [right, *wrong]
        self.rng.shuffle(opts)
        self.q = {"topic": topic, "text": text, "options": opts, "right": opts.index(right)}
        self.answers = {}   # pid -> (option index, seconds taken)
        self.gained = {}
        self.stage = "ask"
        self.t0 = self.now()
        self.end = self.t0 + self.s["secs"]
        self.plans = []
        for p in self.live():
            if p.bot:
                know, lo, hi = BOT.get(p.bot, BOT["normal"])
                pick = self.q["right"] if self.rng.random() < know else self.rng.randrange(4)
                self.plans.append((self.t0 + min(self.s["secs"] - 0.5, self.rng.uniform(lo, hi) * self.s["secs"] / 15), p.id, pick))
        self.plans.sort()
        self.sync()
        final = " 🔥 Double points!" if self.final() else ""
        self.room.add_log(f"❓ Q{self.n}/{len(self.queue)} · {TOPICS[topic]}: {text}{final}", "question")

    def sync(self):
        self.room.deadline = self.next_event() - self.skew

    def next_event(self):
        return min([self.end] + [t for t, _, _ in self.plans[:1]])

    # -- the clock

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
                return self.finish_game() if self.final() else self.next_question()
            return
        while self.plans and self.plans[0][0] <= now:
            t, pid, pick = self.plans.pop(0)
            p = self.room.players.get(pid)
            if p and pid not in self.answers and p in self.live():
                self.answers[pid] = (pick, t - self.t0)
        if now >= self.end or not self.waiting_on():
            return self.reveal()
        self.sync()

    # -- actions

    def act(self, p, a):
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        if a.get("type") != "answer":
            raise GameError("Unknown action.")
        if self.stage != "ask" or self.now() >= self.end:
            raise GameError("Too late for this one!")
        if p.id in self.answers:
            raise GameError("You've already answered.")
        i = a.get("i")
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(self.q["options"]):
            raise GameError("Pick one of the answers.")
        self.answers[p.id] = (i, self.now() - self.t0)
        if not self.waiting_on():
            self.reveal()

    def waiting_on(self):
        return [p for p in self.live() if p.id not in self.answers] if self.stage == "ask" else []

    def reveal(self):
        r = self.room
        mult = 2 if self.final() else 1
        secs = self.s["secs"]
        right = self.q["right"]
        got = []
        for p in self.live():
            ans = self.answers.get(p.id)
            if ans and ans[0] == right:
                pts = (BASE_PTS + round(SPEED_PTS * max(0.0, 1 - ans[1] / secs) / 10) * 10) * mult
                p.g.score += pts
                p.g.right += 1
                p.g.streak += 1
                self.gained[p.id] = pts
                got.append(f"{p.name} +{pts}")
            else:
                p.g.streak = 0
                self.gained[p.id] = 0
        answer = self.q["options"][right]
        fast = [(ans[1], pid) for pid, ans in self.answers.items() if ans[0] == right]
        self.fastest = min(fast)[1] if fast and len(self.live()) > 1 else None
        quick = r.players.get(self.fastest)
        r.add_log(f"✅ {answer}. " + (" · ".join(got) if got else "Nobody got it!") + (f" ⚡ {quick.name} was quickest." if quick else ""), "power")
        self.stage = "reveal"
        self.plans = []
        self.end = self.now() + REVEAL_SECS
        self.sync()

    def finish_game(self):
        r = self.room
        live = self.live()
        if self.solo and len(live) == 1:
            p = live[0]
            need = -(-len(self.queue) * SOLO_GOAL // 1)
            text = f"{p.g.right}/{len(self.queue)} right, {p.g.score} points"
            if p.g.right >= need:
                return r.finish(p, f"🏆 {p.name} aces it: {text}!")
            return r.finish(None, f"🧠 {p.name}: {text}. {int(need)} right wins — try again!")
        ranked = sorted(live, key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if not ranked:
            return r.finish(None, "Everyone left.")
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 Tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Trivia Rush! {text}")

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left the game.")
        p.eliminated = True
        live = self.live()
        if not live or (not self.solo and len(live) < 2):
            return self.finish_game()
        if self.stage == "ask" and not self.waiting_on():
            self.reveal()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        tick = " · ✅" if self.stage == "ask" and p.id in self.answers else ""
        return f"{p.g.score} pts" + tick

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        reveal = self.stage == "reveal" or self.room.phase == "over"
        mine = self.answers.get(p.id)
        out = {
            "stage": self.stage, "n": self.n, "total": len(self.queue), "final": self.final(),
            "topic": TOPICS[self.q["topic"]], "text": self.q["text"], "options": self.q["options"],
            "mine": mine[0] if mine else None,
            "answered": list(self.answers) if not reveal else [],
            "left": max(0.0, self.end - self.now()), "secs": self.s["secs"] if self.stage == "ask" else REVEAL_SECS,
            "playing": p.id in self.ids and not p.eliminated,
            "streak": getattr(p.g, "streak", 0), "right": getattr(p.g, "right", 0),
            "solo": self.solo, "goal": int(-(-len(self.queue) * SOLO_GOAL // 1)),
            "reveal": None,
        }
        if reveal:
            out["reveal"] = {
                "right": self.q["right"],
                "picks": {pid: i for pid, (i, _) in self.answers.items()},
                "gained": self.gained,
                "fastest": getattr(self, "fastest", None),
            }
        return {"trivia": out}

