"""Doodle Dash: the computer draws a picture one stroke at a time and everyone races to type what it
is. Earlier guesses score more; a wrong guess locks you out for a moment. Strokes are only sent to
browsers as they start, so nobody can peek ahead."""
import random
import re
import time

from .base import Game, GameError
from .doodle_art import DRAWINGS

DRAW_SECS = 18     # time to draw a whole picture
GRACE_SECS = 9     # extra guessing time once it's finished (hints get stronger)
REVEAL_SECS = 4.5  # pause on the answer before the next picture
LOCK_SECS = 3      # lockout after a wrong guess
HINT_AT, LETTER_AT = 0.5, 0.85  # fraction drawn when blanks / the first letter appear
EXTRA_LETTERS = 3  # once the picture is done, up to this many more letters show through the last-chance time (a point less each)


def norm(text):
    t = re.sub(r"[^a-z ]", "", text.lower().replace("-", " ")).strip()
    t = re.sub(r"^(an?|the|some) ", "", t)
    return re.sub(r"\s+", "", t)


def is_answer(guess, names):
    """Right if it matches one of the picture's names, or is a near miss that isn't another picture's
    name (so "mouse" never passes for a house, nor "lock" for a clock)."""
    return guess in names or (guess not in ALL_NAMES and any(close(guess, n) for n in names))


def close(a, b):
    """Exact, a plural, or one typo away (for answers of 5+ letters), counting swapped neighbours as one."""
    if a == b or a.rstrip("s") == b.rstrip("s"):
        return True
    if len(b) < 5 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [k for k in range(len(a)) if a[k] != b[k]]
        if len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]:
            return True
    i = j = edits = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1; j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(a) > len(b):
            i += 1
        elif len(b) > len(a):
            j += 1
        else:
            i += 1; j += 1
    return edits + (len(a) - i) + (len(b) - j) <= 1


ALL_NAMES = {norm(x) for d in DRAWINGS for x in [d[0], *d[2]]}


class Doodle(Game):
    id = "doodle"
    category = "party"
    howto = [
        "The computer draws a picture, one line at a time.",
        "Type what you think it is — everyone guesses at once.",
        "The sooner you get it, the more points. Wrong guesses lock you out for 3 seconds.",
        "Letter blanks appear halfway through the drawing, then the first letter.",
    ]
    name = "Doodle Dash"
    icon = "✏️"
    blurb = "A picture draws itself line by line. Shout it — well, type it — before anyone else."
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "quick": ("⚡", "Quick draw", "Name a picture before a quarter of it is drawn")}
    settings_schema = {
        "pictures": ("Pictures", [(6, "6"), (10, "10"), (15, "15")], 10),
        "mode": ("Scoring", [("all", "🙌 Everyone can score"), ("race", "⚡ First correct only")], "all"),
        "drawtime": ("Drawing speed", [(18, "Normal (18 s)"), (12, "⚡ Quick (12 s)"), (25, "🐢 Slow (25 s)")], 18),
    }

    def draw_secs(self):
        """How long each picture takes to draw (the setting; rooms saved before it: 18 s)."""
        return self.s.get("drawtime", DRAW_SECS)

    # -- setup and clock

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0  # the bot simulator fast-forwards this virtual clock
        self.queue = rng.sample(range(len(DRAWINGS)), min(self.s["pictures"], len(DRAWINGS)))
        self.round = 0
        for p in seated:
            p.g.score = 0
            p.g.got = 0
            p.g.locked = 0.0
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"✏️ Doodle Dash! {len(self.queue)} pictures. Type your guesses as they draw.", "big")
        self.new_picture()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift  # the picture resumes where it was when the server stopped

    def late_join(self, p):
        """Start guessing straight away, at 0 points."""
        p.g.score = 0
        p.g.got = 0
        p.g.locked = 0.0

    def new_picture(self):
        self.mark_round()
        self.round += 1
        self.pic = DRAWINGS[self.queue[self.round - 1]]
        self.stage = "draw"
        self.t0 = self.now() + 1.0  # a beat to read the category
        self.per = self.draw_secs() / len(self.pic[3])
        self.end = self.t0 + self.draw_secs() + GRACE_SECS
        self.solvers = []  # [(pid, points)] in order
        self.sent = 0  # strokes browsers have been told about; each new one is a clock event
        self.room.deadline = self.end - self.skew
        self.plan_bots()
        self.room.add_log(f"🖍️ Picture {self.round}/{len(self.queue)} — category: {self.pic[1]}.")

    def plan_bots(self):
        """Each bot 'recognises' the picture at a random point in the drawing (sooner when harder), types
        for a moment, and sometimes blurts out a wrong guess first."""
        self.plans = []
        answer, cat = self.pic[0], self.pic[1]
        decoys = [d[0] for d in DRAWINGS if d[1] == cat and d[0] != answer]
        for p in self.room.contenders():
            if not p.bot:
                continue
            mu, wrong = {"easy": (0.85, 0.35), "normal": (0.62, 0.25), "hard": (0.42, 0.15)}[p.bot]
            f = random.gauss(mu, 0.17)
            at = self.t0 + max(0.12, f) * self.draw_secs() + random.uniform(1.2, 2.8)
            if random.random() < wrong and decoys:
                self.plans.append((max(self.t0 + 2, at - random.uniform(2, 5)), p.id, random.choice(decoys)))
            if at < self.end - 0.5:
                self.plans.append((at, p.id, answer))
        self.plans.sort()

    def shown(self):
        """How many strokes have started."""
        return max(0, min(len(self.pic[3]), int((self.now() - self.t0) // self.per) + 1)) if self.now() >= self.t0 else 0

    def next_event(self):
        if self.stage == "reveal":
            return self.end
        times = [self.end]
        n = getattr(self, "sent", 0)  # rooms saved before this field existed
        if n < len(self.pic[3]):
            times.append(self.t0 + n * self.per)
        times += [t for t, _, _ in self.plans[:1]]
        for frac in (HINT_AT, LETTER_AT):
            at = self.t0 + frac * self.draw_secs()
            if at > self.now():
                times.append(at)
        for k in range(1, EXTRA_LETTERS + 1):  # the late letters, spread through the last-chance time
            at = self.t0 + self.draw_secs() + k * GRACE_SECS / (EXTRA_LETTERS + 1)
            if at > self.now():
                times.append(at)
                break
        return min(times)

    # -- clock hooks: the room polls bot_ready/bot_tick; on_timeout fast-forwards (and ends pictures)

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
                if self.round >= len(self.queue):
                    return self.finish_game()
                self.new_picture()
            return
        self.sent = self.shown()
        while self.plans and self.plans[0][0] <= now and self.stage == "draw":
            _, pid, text = self.plans.pop(0)
            p = self.room.players.get(pid)
            if p and not p.eliminated and pid not in dict(self.solvers):
                self.guess(p, text)
        if self.stage == "draw" and now >= self.end:
            self.reveal(None)

    # -- guesses

    def act(self, p, a):
        if a.get("type") != "guess":
            raise GameError("Unknown action.")
        if p.spectator or p.eliminated or not hasattr(p.g, "score"):
            raise GameError("You're watching this game.")
        text = a.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 40:
            raise GameError("Type a guess (up to 40 letters).")
        if self.stage != "draw" or self.now() < self.t0:
            raise GameError("Wait for the next picture.")
        if p.id in dict(self.solvers):
            raise GameError("You already got this one!")
        left = p.g.locked - self.now()
        if left > 0:
            raise GameError(f"Locked out for {left:.0f}s after a wrong guess.")
        self.guess(p, text.strip())

    def guess(self, p, text):
        answer, _, aliases, _ = self.pic
        g = norm(text)
        if g and is_answer(g, {norm(x) for x in [answer, *aliases]}):
            frac = min(1.0, max(0.0, (self.now() - self.t0) / self.draw_secs()))
            pts = 3 + round(7 * (1 - frac)) + (2 if self.s["mode"] == "all" and not self.solvers else 0)
            pts = max(1, pts - len(self.extra_letters()))  # the late letters make it easier, so it's worth less
            self.solvers.append((p.id, pts))
            if frac < 0.25:
                self.award(p, "quick")
            p.g.score += pts
            p.g.got += 1
            if self.s["mode"] == "race":
                return self.reveal(p)
            self.room.add_log(f"✅ {p.name} got it! +{pts}", "power")
            if all(q.id in dict(self.solvers) for q in self.room.contenders()):
                self.reveal(p)
        else:
            p.g.locked = self.now() + LOCK_SECS
            self.room.add_log(f"❌ {p.name}: “{text[:40]}”")

    def reveal(self, winner):
        answer = self.pic[0]
        if self.s["mode"] == "race" and winner:
            pts = dict(self.solvers)[winner.id]
            self.room.add_log(f"⚡ {winner.name} got it first — it's a {answer}! +{pts}", "big")
        elif self.solvers:
            self.room.add_log(f"🎨 It was a {answer}! {len(self.solvers)} got it.", "big")
        else:
            self.room.add_log(f"🎨 Nobody got it — it was a {answer}.", "big")
        self.stage = "reveal"
        self.end = self.now() + REVEAL_SECS
        self.plans = []
        self.room.deadline = self.end - self.skew

    def finish_game(self):
        r = self.room
        ranked = sorted(r.contenders(), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 It's a tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Doodle Dash! {text}")

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.contenders() if hasattr(q.g, "score")}

    # -- view

    def meta(self, p):
        return f"{p.g.score} pts" if hasattr(p.g, "score") else ""

    def extra_letters(self):
        """Letters shown after the picture is finished: one more every quarter of the last-chance time, at
        spots fixed for the picture, never the whole word."""
        if self.stage != "draw":
            return []
        late = self.now() - (self.t0 + self.draw_secs())
        if late <= 0:
            return []
        answer = self.pic[0].upper()
        spots = [i for i, ch in enumerate(answer) if ch != " " and i > 0]
        random.Random(f"{self.round} {answer}").shuffle(spots)
        n = min(int(late // (GRACE_SECS / (EXTRA_LETTERS + 1))), EXTRA_LETTERS, max(0, len(spots) - 2))
        return spots[:n]

    def hint(self, frac):
        answer = self.pic[0].upper()
        if self.stage == "reveal":
            return answer
        if frac < HINT_AT:
            return ""
        extra = set(self.extra_letters())
        return "".join(ch if (ch == " " or (i == 0 and frac >= LETTER_AT) or i in extra) else "_" for i, ch in enumerate(answer))

    def view(self, p):
        now = self.now()
        n = len(self.pic[3]) if self.stage == "reveal" else self.shown()
        frac = (now - self.t0) / self.draw_secs()
        solved = dict(self.solvers)
        return {"doodle": {
            "stage": self.stage, "round": self.round, "rounds": len(self.queue), "category": self.pic[1],
            "strokes": self.pic[3][:n], "age": max(0.0, now - (self.t0 + (n - 1) * self.per)) if n else 0,
            "per": self.per, "hint": self.hint(frac),
            "answer": self.pic[0] if self.stage == "reveal" or p.id in solved else None,
            "solvers": [[pid, pts] for pid, pts in self.solvers], "mode": self.s["mode"],
            "standings": self.standings() if self.stage == "reveal" else None,
            "locked": max(0.0, getattr(p.g, "locked", 0) - now), "left": max(0.0, self.end - now),
            "drawn": min(1.0, max(0.0, frac)) if self.stage == "draw" else 1.0, "secs": self.draw_secs(), "grace": GRACE_SECS,
        }}
