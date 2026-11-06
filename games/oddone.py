"""Odd One Out: everyone gets the same secret word except one player, who gets a similar one and
doesn't know it. Give one-word clues, then vote out whoever seems off. A caught odd one can still
steal points by guessing everyone else's word."""
import random
import re
import time

from .base import Game, GameError
from .oddone_words import PAIRS, PARTNER, WORDS
from .textmatch import norm, same

VOTE_SECS = 60
REVEAL_SECS = 7
CLUE_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]{0,19}$")


BLANK = "🫥"  # the odd one's "word" in 🫥 Blank mode

class OddOne(Game):
    id = "oddone"
    category = "party"
    howto = [
        "Everyone gets a secret word, but one player's word is slightly different. Nobody knows who.",
        "Take turns giving a one-word clue about your word. Don't make it too obvious!",
        "Then everyone votes for the player they think has the odd word.",
        "Catch the odd one: +2 each. If they escape, they get +4.",
        "A caught odd one can still guess the real word for +3.",
        "🫥 Blank (an option): the odd one gets no word at all and knows it, so they have to bluff their clues.",
    ]
    name = "Odd One Out"
    icon = "🕵️"
    blurb = "Everyone shares a secret word except one player, who doesn't even know they're odd. Clue, suspect, vote."
    min_players = 3
    max_players = 6
    badges = {**Game.badges, "ghost": ("🫥", "Invisible", "Be the odd one and get no votes at all")}
    settings_schema = {
        "rounds": ("Rounds", [(3, "3"), (4, "4"), (6, "6")], 4),
        "laps": ("Clues each", [(1, "1"), (2, "2")], 2),
        "blank": ("🫥 Blank", [(False, "Off: the odd one has a close word"), (True, "On: the odd one has no word, and knows it")], False),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.ids = [p.id for p in seated]
        # pairs this room has played tonight wait until the rest have had a turn
        seen = getattr(self.room, "oddone_seen", set())
        fresh = [p for p in PAIRS if tuple(p) not in seen]
        if len(fresh) < self.s["rounds"]:
            seen, fresh = set(), list(PAIRS)
        self.pairs = rng.sample(fresh, len(fresh))
        self.room.oddone_seen = seen | {tuple(p) for p in self.pairs[:self.s["rounds"]]}
        self.round = 0
        self.result = None
        for p in seated:
            p.g.score = 0
            p.g.word = None
        self.room.add_log("🕵️ Odd One Out! One of you has a different word, and they don't know it.", "big")
        self.new_round()

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids and p.id not in self.joining]

    joining = frozenset()  # games saved before late joining

    def late_join(self, p):
        """Watchers have seen this round's secret words, so a newcomer plays from the next round, at 0."""
        p.g.score = 0
        p.g.word = None
        self.ids.append(p.id)
        self.joining = {*self.joining, p.id}
        self.room.add_log(f"🕵️ {p.name} plays from the next round.")

    def new_round(self):
        r = self.room
        self.joining = set()
        self.round += 1
        pair = list(self.pairs[(self.round - 1) % len(self.pairs)])
        self.rng.shuffle(pair)
        self.common, self.odd_word = pair
        if self.s.get("blank"):
            self.odd_word = BLANK
        players = self.live()
        self.odd = self.rng.choice(players).id
        for p in players:
            p.g.word = self.odd_word if p.id == self.odd else self.common
        shift = (self.round - 1) % len(players)
        self.order = [p.id for p in players[shift:] + players[:shift]]
        self.clues = []
        self.votes = {}
        self.result = None
        self.stage = "clue"
        r.add_log(f"🔎 Round {self.round}/{self.s['rounds']}: check your word and give a clue.")
        r.begin_turn(self.order[0])

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this round.")
        if p.id in self.joining:
            raise GameError("You play from the next round: this one's words were on show while you watched.")
        if t == "clue":
            if self.stage != "clue":
                raise GameError("It's not clue time.")
            self.require_turn(p)
            text = a.get("text")
            if not isinstance(text, str) or not CLUE_RE.match(text.strip()):
                raise GameError("One word only (letters, up to 20).")
            text = text.strip()
            w = norm(p.g.word)
            if w in norm(text) or same(text, p.g.word):
                raise GameError("That's your secret word! Try another.")
            if any(norm(text) == norm(c["text"]) for c in self.clues):
                raise GameError("Someone already said that.")
            return self.give_clue(p, text)
        if t == "vote":
            if self.stage != "vote":
                raise GameError("It's not time to vote.")
            target = a.get("target")
            if target == p.id or target not in [q.id for q in self.live()]:
                raise GameError("Vote for another player.")
            self.votes[p.id] = target
            return self.maybe_count()
        if t == "guess":
            if self.stage != "guess":
                raise GameError("No guessing right now.")
            self.require_turn(p)
            text = a.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 30:
                raise GameError("Type one word.")
            return self.guess(p, text.strip())
        raise GameError("Unknown action.")

    def give_clue(self, p, text):
        self.clues.append({"by": p.id, "text": text})
        self.room.add_log(f"💬 {p.name}: {text}", "question")
        self.next_clue()

    def next_clue(self):
        total = len(self.order) * self.s["laps"]
        alive = {q.id for q in self.live()}
        while len(self.clues) < total:
            pid = self.order[len(self.clues) % len(self.order)]
            if pid in alive:
                return self.room.begin_turn(pid)
            self.clues.append({"by": pid, "text": "—"})  # a player who left
        self.start_vote()

    def start_vote(self):
        r = self.room
        self.stage = "vote"
        r.turn = None
        r.deadline = time.time() + VOTE_SECS
        r.bot_at = time.time() + random.uniform(2.0, 4.0)
        r.add_log("🗳️ Vote! Who has the odd word?", "big")

    def waiting_on(self):
        return [p for p in self.live() if p.id not in self.votes] if self.stage == "vote" else []

    def maybe_count(self):
        if not self.waiting_on():
            self.count_votes()

    def count_votes(self):
        r = self.room
        tally = {}
        for target in self.votes.values():
            tally[target] = tally.get(target, 0) + 1
        top = max(tally.values(), default=0)
        leaders = [pid for pid, n in tally.items() if n == top]
        caught = len(leaders) == 1 and leaders[0] == self.odd
        oddp = r.players.get(self.odd)
        right = [pid for pid, t in self.votes.items() if t == self.odd]
        for pid in right:
            if pid in r.players:
                r.players[pid].g.score += 2 if caught else 1
        shown = ", ".join(f"{r.players[pid].name} {n}" for pid, n in sorted(tally.items(), key=lambda x: -x[1]) if pid in r.players)
        r.add_log(f"🗳️ Votes: {shown or 'none'}", "question")
        self.result = {"votes": tally, "caught": caught, "guess": None, "guessed": False}
        if caught and oddp:
            r.add_log(f"🎯 Caught! {oddp.name} had the odd word “{self.odd_word}”. Last chance: guess the real word.", "power")
            self.stage = "guess"
            r.begin_turn(oddp.id)
        else:
            if oddp:
                oddp.g.score += 4
                if not tally.get(self.odd):
                    self.award(oddp, "ghost")
                r.add_log(f"🏃 {oddp.name} slipped away with “{self.odd_word}” (everyone else had “{self.common}”). +4", "power")
            self.reveal()

    def guess(self, p, text):
        ok = same(text, self.common)
        self.result.update(guess=text, guessed=ok)
        if ok:
            p.g.score += 3
            self.room.add_log(f"💡 {p.name} guessed “{self.common}”! +3", "power")
        else:
            self.room.add_log(f"❌ {p.name} guessed “{text}”. The word was “{self.common}”.", "power")
        self.reveal()

    def reveal(self):
        r = self.room
        self.stage = "reveal"
        r.turn = None
        r.deadline = time.time() + REVEAL_SECS

    def on_timeout(self):
        r = self.room
        if self.stage == "clue":
            p = r.players[r.turn]
            r.add_log(f"⏰ {p.name} ran out of time.", "power")
            self.clues.append({"by": p.id, "text": "🤐"})
            self.next_clue()
        elif self.stage == "vote":
            for p in self.waiting_on():
                r.add_log(f"⏰ {p.name} didn't vote.", "power")
            self.count_votes()
        elif self.stage == "guess":
            self.guess(r.players[r.turn], "…")
        elif self.round >= self.s["rounds"]:
            self.finish()
        else:
            self.new_round()

    def finish(self):
        r = self.room
        ranked = sorted(self.live(), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 Tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Odd One Out! {text}")

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left the game.")
        p.eliminated = True
        self.votes = {k: v for k, v in self.votes.items() if k != p.id and v != p.id}
        if len(self.live()) < 2:
            return self.finish()
        if p.id == self.odd and self.stage in ("clue", "vote", "guess"):
            r.add_log(f"🚪 The odd one left — the words were “{self.common}” and “{self.odd_word}”.", "power")
            self.result = {"votes": {}, "caught": False, "guess": None, "guessed": False}
            return self.reveal()
        if self.stage == "clue" and r.turn == p.id:
            self.next_clue()
        elif self.stage == "vote":
            self.maybe_count()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        voted = " · ✅" if self.stage == "vote" and p.id in self.votes else ""
        return f"{p.g.score} pts{voted}"

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def view(self, p):
        see_all = p.spectator or p.eliminated or self.room.phase == "over" or self.stage == "reveal"
        out = {
            "stage": self.stage, "round": self.round, "rounds": self.s["rounds"],
            "word": getattr(p.g, "word", None), "clues": [[c["by"], c["text"]] for c in self.clues],
            "order": self.order, "laps": self.s["laps"],
            "voted": [pid for pid in self.votes], "myVote": self.votes.get(p.id),
            "waiting": [q.id for q in self.waiting_on()],
            "odd": None, "common": None, "oddWord": None, "result": None,
        }
        if see_all or self.stage == "guess":
            out.update(odd=self.odd, oddWord=self.odd_word, result=self.result)
        if see_all:
            out.update(common=self.common)
        if self.stage in ("guess", "reveal") or see_all:
            out["votes"] = dict(self.votes)
        return {"oddone": out}

    # -- bots

    def bot_ready(self):
        r = self.room
        if self.stage == "vote":
            return any(p.bot for p in self.waiting_on())
        if self.stage in ("clue", "guess"):
            p = r.players.get(r.turn)
            return bool(p and p.bot)
        return False

    def bot_tick(self):
        r = self.room
        if self.stage == "vote":
            p = random.choice([q for q in self.waiting_on() if q.bot])
            self.votes[p.id] = self.bot_vote(p)
            r.bot_at = time.time() + random.uniform(0.6, 2.0)
            return self.maybe_count()
        p = r.players[r.turn]
        if self.stage == "clue":
            self.give_clue(p, self.bot_clue(p))
        elif self.stage == "guess":
            self.guess(p, self.bot_guess(p))

    def lists(self, p):
        if p.g.word == BLANK:  # the blank: guess the word from everyone else's clues
            return WORDS.get(self.best_guess(p), []), []
        mine = WORDS.get(p.g.word, [])
        other = WORDS.get(PARTNER.get(p.g.word), [])
        return mine, [c for c in other if c not in mine]

    def thinks_odd(self, p):
        """True when the table's clues fit the partner word better than mine."""
        mine, theirs = self.lists(p)
        others = [c["text"].lower() for c in self.clues if c["by"] != p.id]
        return sum(c in theirs for c in others) > sum(c in mine for c in others) + 1

    def bot_clue(self, p):
        mine, theirs = self.lists(p)
        used = {norm(c["text"]) for c in self.clues}
        w = norm(p.g.word)
        cands = [c for c in mine if norm(c) not in used and w not in norm(c)]
        if not cands:
            return random.choice(["thing", "stuff", "hmm", "maybe"])
        if p.bot == "easy":
            return random.choice(cands)
        if p.bot == "normal":
            return random.choice(cands[:max(1, len(cands) * 3 // 5)])
        partner = WORDS.get(PARTNER.get(p.g.word), [])
        shared = [c for c in cands if c in partner]
        if shared and (self.thinks_odd(p) or random.random() < 0.6):
            return random.choice(shared)
        return random.choice(cands[:max(1, len(cands) // 2)])

    def bot_vote(self, p):
        mine, theirs = self.lists(p)
        noise = {"easy": 3.0, "normal": 1.0, "hard": 0.3}[p.bot]
        others = [q for q in self.live() if q.id != p.id]
        flip = -1 if p.bot != "easy" and self.thinks_odd(p) else 1

        def suspicion(q):
            s = 0.0
            for c in self.clues:
                if c["by"] == q.id:
                    t = c["text"].lower()
                    s += (t in theirs) - (t in mine and t not in WORDS.get(PARTNER.get(p.g.word), []))
            return flip * s + random.uniform(0, noise)
        return max(others, key=suspicion).id

    def best_guess(self, p):
        """The word whose clue list matches the table's clues best."""
        others = [c["text"].lower() for c in self.clues if c["by"] != p.id]
        return max(WORDS, key=lambda w: (sum(c in WORDS[w] for c in others), random.random()))

    def bot_guess(self, p):
        if p.g.word == BLANK:
            return self.best_guess(p) if random.random() < {"easy": 0.3, "normal": 0.55, "hard": 0.8}[p.bot] else random.choice(list(WORDS))
        if random.random() < {"easy": 0.35, "normal": 0.6, "hard": 0.85}[p.bot]:
            return PARTNER.get(p.g.word, "something")
        return random.choice(list(WORDS))
