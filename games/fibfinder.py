"""Fib Finder: a strange-but-true fact appears with a word missing. Everyone writes a believable fake
answer, then everyone tries to pick the truth from the pile. You score for finding the truth and for
every player your fib fools."""
import random
import time

from .base import Game, GameError
from .fib_facts import FACTS, TOPICS
from .fib_notes import NOTES
from .textmatch import norm, same

WRITE_SECS = 75
PICK_SECS = 45
REVEAL_SECS = 12  # time to read the fact card too
MIN_OPTIONS = 4
TRUTH_PTS, FOOL_PTS = 3, 2
SURE_WIN, SURE_LOSS = 5, 2  # ✌️ a "sure" pick: the truth pays this instead of TRUTH_PTS, a miss costs this


class FibFinder(Game):
    id = "fibfinder"
    category = "words"
    howto = [
        "A strange-but-true fact appears with a word missing.",
        "Everyone secretly writes a fake answer that sounds true.",
        f"Then pick which answer you think is real: +{TRUTH_PTS} for the truth. ✌️ Sure of it? Double down: +{SURE_WIN} if you're right, −{SURE_LOSS} if you're fooled.",
        f"+{FOOL_PTS} for every player who falls for your fib. The last round counts double.",
        "📖 Once the picks are in, a fact card explains the truth and says where to read more.",
    ]
    name = "Fib Finder"
    icon = "🤥"
    blurb = "Real facts, fake answers. Write a fib that fools your friends, then sniff out the truth."
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "silver_tongue": ("👅", "Silver tongue", "Fool two or more players with one fib"),
              "master_liar": ("🎭", "Master liar", "Fool every other player with one fib (three or more players)")}
    settings_schema = {
        "rounds": ("Rounds", [(5, "5"), (7, "7"), (10, "10")], 7),
        "topic": ("Facts", [("all", "🌍 Everything"), ("animals", "🐾 Animals"), ("science", "🔬 Science & nature"),
                            ("history", "🏛️ History & inventions"), ("words", "🔤 Words & names")], "all"),
        "pace": ("Pace", [("normal", "Normal (75 s to write, 45 s to pick)"), ("quick", "⚡ Quick (45 s, 25 s)"),
                          ("relaxed", "🐢 Relaxed (2 min, 1 min)")], "normal"),
    }
    PACES = {"normal": (WRITE_SECS, PICK_SECS), "quick": (45, 25), "relaxed": (120, 60)}

    def secs(self, stage):
        """Seconds to write or to pick, by the Pace setting (rooms saved before it: normal)."""
        write, pick = self.PACES[self.s.get("pace", "normal")]
        return write if stage == "write" else pick

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.ids = [p.id for p in seated]
        pool = TOPICS.get(self.s.get("topic"), range(len(FACTS)))
        self.queue = rng.sample(pool, min(self.s["rounds"], len(pool)))
        self.round = 0
        for p in seated:
            p.g.score = 0
            p.g.fooled = 0
        self.room.add_log("🤥 Fib Finder! Write a fake answer, then find the real one.", "big")
        self.new_round()

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def late_join(self, p):
        """Join at 0; you can write or pick in the round that's running."""
        p.g.score = 0
        p.g.fooled = 0
        self.ids.append(p.id)

    def new_round(self):
        self.sure = set()
        r = self.room
        self.round += 1
        self.fact = FACTS[self.queue[self.round - 1]]
        self.fibs = {}      # pid -> text
        self.options = []   # [{"text", "authors", "truth", "house"}]
        self.picks = {}     # pid -> option index
        self.stage = "write"
        r.turn = None
        r.deadline = time.time() + self.secs("write")
        r.bot_at = time.time() + random.uniform(3.0, 6.0)
        final = " 🔥 Final round: double points!" if self.final() else ""
        r.add_log(f"📜 Fact {self.round}/{len(self.queue)}: {self.fact[0]}{final}", "big")

    def final(self):
        return self.round == len(self.queue)

    def truths(self):
        return [self.fact[1], *self.fact[2]]

    # -- actions

    def act(self, p, a):
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        t = a.get("type")
        if t == "fib":
            if self.stage != "write":
                raise GameError("Writing time is over.")
            text = a.get("text")
            if not isinstance(text, str) or not text.strip() or len(text.strip()) > 40:
                raise GameError("Write a fake answer (up to 40 characters).")
            text = self.house_style(" ".join(text.split()))
            if not text:
                raise GameError("Write a fake answer (up to 40 characters).")
            if any(same(text, x) for x in self.truths()):
                raise GameError("🤫 That's actually the real answer! Write a fake one.")
            self.fibs[p.id] = text
            return self.maybe_next()
        if t == "pick":
            if self.stage != "pick":
                raise GameError("It's not time to pick.")
            i = a.get("i")
            if not isinstance(i, int) or not 0 <= i < len(self.options):
                raise GameError("Pick one of the answers.")
            if p.id in self.options[i]["authors"]:
                raise GameError("That's your own fib!")
            self.picks[p.id] = i
            sure = getattr(self, "sure", set())
            self.sure = (sure | {p.id}) if a.get("sure") else (sure - {p.id})
            return self.maybe_next()
        raise GameError("Unknown action.")

    def house_style(self, text):
        """Make a typed fib look like the truth and the decoys, so a phone's auto-capital or a full stop
        doesn't give away which answers people wrote (#85): the first letter follows the truth's case,
        and closing full stops / exclamation marks go. Words like 'NASA' or 'iPhone' are left alone."""
        text = text.rstrip(" .!")
        truth = self.fact[1]
        first = text.split(" ")[0] if text else ""
        if first[:1].isalpha() and truth[:1].isalpha() and (first[1:] == first[1:].lower()):
            text = (text[0].upper() if truth[0].isupper() else text[0].lower()) + text[1:]
        return text

    def waiting_on(self):
        done = self.fibs if self.stage == "write" else self.picks if self.stage == "pick" else None
        return [] if done is None else [p for p in self.live() if p.id not in done]

    def maybe_next(self):
        if not self.waiting_on():
            self.start_pick() if self.stage == "write" else self.reveal()

    def start_pick(self):
        r = self.room
        opts = [{"text": self.fact[1], "authors": [], "truth": True, "house": False}]
        for pid, text in self.fibs.items():
            twin = next((o for o in opts if not o["truth"] and norm(o["text"]) == norm(text)), None)
            if twin:
                twin["authors"].append(pid)
            else:
                opts.append({"text": text, "authors": [pid], "truth": False, "house": False})
        decoys = [d for d in self.fact[3] if all(norm(d) != norm(o["text"]) for o in opts)]
        self.rng.shuffle(decoys)
        while len(opts) < MIN_OPTIONS and decoys:
            opts.append({"text": decoys.pop(), "authors": [], "truth": False, "house": True})
        self.rng.shuffle(opts)
        self.options = opts
        self.stage = "pick"
        r.deadline = time.time() + self.secs("pick")
        r.bot_at = time.time() + random.uniform(2.5, 5.0)
        r.add_log(f"🔍 {len(opts)} answers are in. Which one is true?")

    def reveal(self):
        r = self.room
        mult = 2 if self.final() else 1
        truth = next(i for i, o in enumerate(self.options) if o["truth"])
        found = []
        sure = getattr(self, "sure", set())
        burned = []
        for pid, i in self.picks.items():
            p = r.players.get(pid)
            if not p:
                continue
            if i == truth:
                p.g.score += (SURE_WIN if pid in sure else TRUTH_PTS) * mult
                found.append(p.name + (" ✌️" if pid in sure else ""))
            elif pid in sure:
                p.g.score -= SURE_LOSS * mult
                burned.append(p.name)
            for aid in self.options[i]["authors"]:
                a = r.players.get(aid)
                if a:
                    a.g.score += FOOL_PTS * mult
                    a.g.fooled += 1
        r.add_log(f"✅ The truth: “{self.fact[1]}”. " + (f"Found by {', '.join(found)}." if found else "Nobody found it!")
                  + (f" ✌️ {', '.join(burned)} doubled down and lost {SURE_LOSS * mult}." if burned else ""), "power")
        if burned:
            self.moment(f"✌️💥 {', '.join(burned)}: so sure, so wrong", "bad", "wrong")
        for o in self.options:
            fooled = [r.players[pid].name for pid, i in self.picks.items() if self.options[i] is o and pid in r.players]
            if o["authors"] and fooled:
                if len(fooled) >= 2:
                    for a in o["authors"]:
                        self.award(a, "silver_tongue")
                # 🎭 everyone but the author(s) fell for it
                others = [q for q in self.live() if q.id not in o["authors"]]
                if len(others) >= 2 and all(self.picks.get(q.id) is not None and self.options[self.picks[q.id]] is o for q in others):
                    for a in o["authors"]:
                        self.award(a, "master_liar")
                names = " & ".join(r.players[a].name for a in o["authors"] if a in r.players)
                r.add_log(f"🤥 {names}'s “{o['text']}” fooled {', '.join(fooled)}.", "question")
        self.stage = "reveal"
        r.deadline = time.time() + REVEAL_SECS

    def on_timeout(self):
        r = self.room
        if self.stage == "write":
            for p in self.waiting_on():
                r.add_log(f"⏰ {p.name} didn't write a fib.", "power")
            self.start_pick()
        elif self.stage == "pick":
            for p in self.waiting_on():
                r.add_log(f"⏰ {p.name} didn't pick.", "power")
            self.reveal()
        elif self.final():
            self.finish()
        else:
            self.new_round()

    def finish(self):
        r = self.room
        ranked = sorted(self.live(), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 Tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Fib Finder! {text}")

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left the game.")
        p.eliminated = True
        self.fibs.pop(p.id, None)
        self.picks.pop(p.id, None)
        if len(self.live()) < 2:
            return self.finish()
        if self.stage in ("write", "pick"):
            self.maybe_next()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        done = self.fibs if self.stage == "write" else self.picks if self.stage == "pick" else {}
        return f"{p.g.score} pts" + (" · ✅" if p.id in done else "")

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        r = self.room
        out = {
            "stage": self.stage, "round": self.round, "rounds": len(self.queue), "final": self.final(),
            "fact": self.fact[0], "mine": self.fibs.get(p.id), "myPick": self.picks.get(p.id), "mySure": p.id in getattr(self, "sure", set()),
            "sure": sorted(getattr(self, "sure", set())) if self.stage == "reveal" or r.phase == "over" else [],
            "waiting": [q.id for q in self.waiting_on()],
            "options": [], "mineIdx": [], "reveal": None,
        }
        if self.stage in ("pick", "reveal"):
            out["options"] = [o["text"] for o in self.options]
            out["mineIdx"] = [i for i, o in enumerate(self.options) if p.id in o["authors"]]
        if self.stage == "reveal" or r.phase == "over":
            out["reveal"] = [{
                "text": o["text"], "truth": o["truth"], "house": o["house"], "authors": o["authors"],
                "pickers": [pid for pid, i in self.picks.items() if i == k],
            } for k, o in enumerate(self.options)]
            # 📖 the fact card: why the truth is true and where to read more; only once the picks are in
            context, source = NOTES.get(self.fact[0], ("", ""))
            out["card"] = {"fact": self.fact[0], "truth": self.fact[1], "context": context, "source": source}
        return {"fibfinder": out}

    # -- bots: everyone moves at once; undecided bots trickle in one at a time

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())

    def bot_tick(self):
        p = random.choice([q for q in self.waiting_on() if q.bot])
        if self.stage == "write":
            taken = {norm(t) for t in self.fibs.values()}
            decoys = [d for d in self.fact[3] if norm(d) not in taken] or self.fact[3]
            self.fibs[p.id] = random.choice(decoys)
        else:
            self.picks[p.id] = self.bot_pick(p)
        self.room.bot_at = time.time() + random.uniform(0.8, 2.5)
        self.maybe_next()

    def bot_pick(self, p):
        """Bots 'just know' some facts, as people do; otherwise they go with what sounds plausible.
        Hard bots are suspicious of answers that sound like nobody's real guess."""
        cands = [i for i, o in enumerate(self.options) if p.id not in o["authors"]]
        truth = next(i for i, o in enumerate(self.options) if o["truth"])
        self.sure = getattr(self, "sure", set()) - {p.id}
        if random.random() < {"easy": 0.2, "normal": 0.35, "hard": 0.5}[p.bot]:
            if random.random() < {"easy": 0.15, "normal": 0.3, "hard": 0.45}[p.bot]:
                self.sure = self.sure | {p.id}  # ✌️ sure of it
            return truth
        if p.bot == "easy" and random.random() < 0.12:
            self.sure = self.sure | {p.id}  # ✌️ sure of the wrong thing
        if p.bot == "hard":
            known = {norm(x) for x in [self.fact[1], *self.fact[3]]}
            plausible = [i for i in cands if norm(self.options[i]["text"]) in known]
            cands = plausible or cands
        return random.choice(cands)
