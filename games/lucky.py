"""Lucky Letters: spin a prize wheel, call letters, solve the hidden phrase.

Wedges: points, 💀 Bust (lose your round bank and turn), ⛔ Skip, 🎁 Wild (a random letter is
revealed for you), 🦊 Steal (call right and take 500 from the leader), ⚡ Jackpot (call right
and win the growing pot), ✨ Vowel (the only way to call a vowel). Solve on your turn to bank
your round winnings (minimum 1000). Most points after the last round wins."""
import random
import re
import time
from collections import defaultdict

from .base import Game, GameError
from . import wordsmith

VOWELS = "AEIOU"
CONSONANTS = "BCDFGHJKLMNPQRSTVWXYZ"
FREQ = "TNSRHLDCMFPGWYBVKXJQZ"  # common English consonants first
WEDGES = [500, 250, 700, "bust", 300, 600, "vowel", 400, 800, "skip", 350, 450, "wild", 900, "steal", "jackpot"]
WEDGE_LABEL = {"bust": "💀 BUST", "skip": "⛔ SKIP", "wild": "🎁 WILD", "steal": "🦊 STEAL",
               "jackpot": "⚡ JACKPOT", "vowel": "✨ VOWEL"}
SPIN_SECS = 4.0
STEAL = 500
SOLVE_MIN = 1000
REVEAL_SECS = 4.5  # a solved puzzle stays up (and is celebrated) before the next round

PUZZLES = {
    "Food & Drink": ["PEANUT BUTTER AND JELLY", "HOT CHOCOLATE WITH MARSHMALLOWS", "FRESHLY SQUEEZED ORANGE JUICE",
                     "SPAGHETTI AND MEATBALLS", "GRILLED CHEESE SANDWICH", "BLUEBERRY PANCAKES",
                     "STRAWBERRY SHORTCAKE", "BUTTERED POPCORN", "CHOCOLATE CHIP COOKIES", "VEGETABLE SOUP"],
    "Around the House": ["KITCHEN TABLE", "FLUFFY BATH TOWELS", "WASHING MACHINE", "ROCKING CHAIR",
                         "COFFEE MAKER", "VACUUM CLEANER", "SPARE BEDROOM", "BOOKSHELF FULL OF NOVELS",
                         "WELCOME MAT", "GRANDFATHER CLOCK"],
    "Phrase": ["BETTER LATE THAN NEVER", "PIECE OF CAKE", "BREAK A LEG", "ACTIONS SPEAK LOUDER THAN WORDS",
               "EVERY CLOUD HAS A SILVER LINING", "ONCE IN A BLUE MOON", "HIT THE NAIL ON THE HEAD",
               "BACK TO SQUARE ONE", "THE BALL IS IN YOUR COURT", "WHEN PIGS FLY", "KEEP YOUR CHIN UP",
               "SLOW AND STEADY WINS THE RACE"],
    "Nature": ["RAINBOW AFTER THE STORM", "FALLING AUTUMN LEAVES", "SNOWCAPPED MOUNTAINS", "BUBBLING BROOK",
               "THUNDER AND LIGHTNING", "FIELD OF SUNFLOWERS", "CORAL REEF", "WILDFLOWER MEADOW",
               "MORNING DEW", "FOREST TRAIL"],
    "Fun & Games": ["HIDE AND SEEK", "JUMP ROPE", "BOARD GAME NIGHT", "MUSICAL CHAIRS", "TREASURE HUNT",
                    "WATER BALLOON FIGHT", "CROSSWORD PUZZLE", "PILLOW FORT", "KITE FLYING", "CARD TRICKS"],
    "Space": ["SHOOTING STAR", "ROCKET LAUNCH", "THE MILKY WAY", "FULL MOON", "SOLAR SYSTEM",
              "ASTRONAUT TRAINING", "SPACE STATION", "RINGS OF SATURN"],
    "Things": ["PAPER AIRPLANE", "BICYCLE HELMET", "ALARM CLOCK", "SUNGLASSES", "BIRTHDAY CANDLES",
               "UMBRELLA STAND", "POCKET KNIFE", "TELESCOPE", "SNOW GLOBE", "ROLLER SKATES"],
    "On the Job": ["FIREFIGHTER", "PASTRY CHEF", "SCHOOL TEACHER", "AIRLINE PILOT", "LIGHTHOUSE KEEPER",
                   "VETERINARIAN", "MARINE BIOLOGIST", "TAXI DRIVER"],
}


def norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", "", str(text).upper())).strip()


_by_len = None


def words_by_len():
    global _by_len
    if _by_len is None:
        _by_len = defaultdict(list)
        for w in wordsmith.words():
            _by_len[len(w)].append(w)
    return _by_len


class Lucky(Game):
    id = "lucky"
    category = "words"
    howto = [
        "Spin the wheel, then call a consonant. Each time it appears, you earn the wedge's value.",
        "Right? Keep going: spin again or solve. Wrong or already called? Next player.",
        "Vowels can only be called by landing on ✨ VOWEL. 💀 BUST wipes your round bank.",
        "🎁 WILD reveals a free letter, 🦊 STEAL takes 500 from the leader, ⚡ JACKPOT wins the pot.",
        "Solve on your turn to bank your round (at least 1000). Most points after the last round wins.",
    ]
    name = "Lucky Letters"
    icon = "🎡"
    blurb = "Spin the 3D prize wheel, call letters and solve the hidden phrase before your rivals do."
    min_players = 2
    max_players = 6
    settings_schema = {
        "rounds": ("Rounds", [(2, "2 puzzles"), (3, "3 puzzles"), (5, "5 puzzles")], 3),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.total = {p.id: 0 for p in seated}
        self.bank = {p.id: 0 for p in seated}
        pool = [(cat, phrase) for cat, phrases in PUZZLES.items() for phrase in phrases]
        self.queue = rng.sample(pool, self.s["rounds"])
        self.round = 0
        self.jackpot = 1000
        self.spin = None
        self.spin_seq = 0
        self.last_answer = None
        self.starter = rng.randrange(len(seated))
        self.new_round()

    def late_join(self, p):
        """Join with 0 points; turns come round in seat order."""
        self.seats.append(p.id)
        self.total[p.id] = 0
        self.bank[p.id] = 0

    # -- rounds & turns

    def new_round(self):
        r = self.room
        self.category, self.answer = self.queue[self.round]
        self.round += 1
        self.called = set()
        self.bank = {i: 0 for i in self.seats}
        self.stage = "spin"
        self.value = 0
        self.wedge = None
        first = self.room.players.get(self.seats[(self.starter + self.round - 1) % len(self.seats)])
        if not first or first.eliminated:
            first = r.contenders()[0]
        r.add_log(f"🎡 Round {self.round}/{self.s['rounds']} — category: {self.category}. {first.name} spins first.", "big")
        self.begin(first)

    def begin(self, p):
        self.stage = "spin"
        self.room.begin_turn(p.id)

    def next_player(self):
        self.stage = "spin"
        self.room.advance()

    def hidden(self):
        return [ch for ch in set(self.answer) if ch.isalpha() and ch not in self.called]

    def masked(self):
        return "".join(ch if not ch.isalpha() or ch in self.called else "_" for ch in self.answer)

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        if self.stage == "wheel":
            raise GameError("The wheel is still spinning!")
        if self.stage == "solved":
            raise GameError("The next puzzle is on its way!")
        if t == "spin":
            if self.stage != "spin":
                raise GameError("Call a letter first.")
            return self.do_spin(p)
        if t == "letter":
            return self.call_letter(p, str(a.get("letter") or "").upper())
        if t == "solve":
            if self.stage != "spin":
                raise GameError("You can solve at the start of your turn or after a correct letter.")
            return self.solve(p, a.get("guess"))
        raise GameError("Unknown action.")

    def do_spin(self, p):
        r = self.room
        self.spin_seq += 1
        idx = self.rng.randrange(len(WEDGES))
        self.spin = {"id": self.spin_seq, "wedge": idx, "turns": self.rng.randint(3, 5),
                     "end": time.time() + SPIN_SECS, "by": p.id}
        self.stage = "wheel"
        if WEDGES[idx] != "jackpot":
            self.jackpot += 100
        r.deadline = self.spin["end"]  # on_timeout resolves the spin when the wheel stops
        r.bot_at = self.spin["end"] + 1.0

    def resolve_spin(self):
        r = self.room
        p = r.players[r.turn]
        w = WEDGES[self.spin["wedge"]]
        self.wedge = w
        t = r.settings["timer"]
        r.deadline = time.time() + t if t else None
        if isinstance(w, int):
            self.value, self.stage = w, "letter"
            r.add_log(f"🎡 {p.name} spun {w:,}.")
        elif w == "bust":
            lost = self.bank[p.id]
            self.bank[p.id] = 0
            r.add_log(f"💀 BUST! {p.name} loses {lost:,} and their turn.", "power")
            self.next_player()
        elif w == "skip":
            r.add_log(f"⛔ {p.name} lands on SKIP.", "power")
            self.next_player()
        elif w == "wild":
            hidden = [c for c in self.hidden() if c in CONSONANTS] or self.hidden()
            if hidden:
                ch = self.rng.choice(hidden)
                n = self.answer.count(ch)
                self.called.add(ch)
                self.bank[p.id] += 250 * n
                r.add_log(f"🎁 WILD! The {ch}{'s' if n > 1 else ''} light up for {p.name} (+{250 * n:,}). Spin again or solve!", "power")
            self.stage = "spin"
        elif w == "vowel":
            self.value, self.stage = 100, "vowel"
            r.add_log(f"✨ {p.name} may call a vowel.", "power")
        elif w == "steal":
            self.value, self.stage = 300, "letter"
            r.add_log(f"🦊 {p.name} spun STEAL — call a letter right to take {STEAL:,} from the leader!", "power")
        elif w == "jackpot":
            self.value, self.stage = 500, "letter"
            r.add_log(f"⚡ JACKPOT wedge! {p.name} wins 💰{self.jackpot:,} with a correct letter.", "power")

    def call_letter(self, p, ch):
        r = self.room
        if self.stage not in ("letter", "vowel"):
            raise GameError("Spin first.")
        allowed = VOWELS if self.stage == "vowel" else CONSONANTS
        if len(ch) != 1 or ch not in allowed:
            raise GameError("Pick a vowel." if self.stage == "vowel" else "Pick a consonant.")
        if ch in self.called:
            r.add_log(f"🔁 {ch} was already called — {p.name}'s turn ends.")
            return self.next_player()
        self.called.add(ch)
        n = self.answer.count(ch)
        if not n:
            r.add_log(f"❌ No {ch}. {p.name}'s turn ends.")
            return self.next_player()
        gain = self.value * n
        extra = ""
        if self.wedge == "jackpot":
            gain += self.jackpot
            extra = f" plus the ⚡ jackpot of {self.jackpot:,}!"
            self.jackpot = 1000
        if self.wedge == "steal":
            others = [i for i in self.seats if i != p.id and i in r.players]
            if others:
                leader = max(others, key=lambda i: self.total[i])
                taken = min(STEAL, self.total[leader])
                self.total[leader] -= taken
                self.bank[p.id] += taken
                if taken:
                    extra = f" and stole {taken:,} from {r.players[leader].name}! 🦊"
        self.bank[p.id] += gain
        r.add_log(f"✅ {n} × {ch} — {p.name} earns {gain:,}{extra}", "question")
        self.stage = "spin"
        t = r.settings["timer"]
        r.deadline = time.time() + t if t else None

    def solve(self, p, guess):
        r = self.room
        if norm(guess) != norm(self.answer):
            r.add_log(f"🙅 {p.name} guessed “{str(guess)[:60]}” — not quite.", "power")
            return self.next_player()
        won = max(self.bank[p.id], SOLVE_MIN)
        self.total[p.id] += won
        self.last_answer = {"category": self.category, "answer": self.answer, "by": p.name, "won": won}
        self.called |= set(self.answer)
        r.add_log(f"🎉 {p.name} solved it: “{self.answer}” and banks {won:,}!", "big")
        if self.round >= self.s["rounds"]:
            return self.finish()
        self.stage = "solved"  # on_timeout starts the next round once everyone has seen the answer
        r.deadline = time.time() + REVEAL_SECS

    def finish(self):
        r = self.room
        live = [r.players[i] for i in self.seats if i in r.players]
        top = max(self.total[p.id] for p in live)
        best = [p for p in live if self.total[p.id] == top]
        if len(best) == 1:
            r.finish(best[0], f"🏆 {best[0].name} wins Lucky Letters with {top:,} points!")
        else:
            r.finish(None, f"🤝 Tie at {top:,} between {' & '.join(p.name for p in best)}.")

    def on_timeout(self):
        if self.stage == "wheel":
            return self.resolve_spin()
        if self.stage == "solved":
            return self.new_round()
        r = self.room
        r.add_log(f"⏰ {r.players[r.turn].name} ran out of time.", "power")
        self.next_player()

    # -- view

    def meta(self, p):
        if p.id not in self.total:
            return ""
        bank = self.bank.get(p.id, 0)
        return f"💰{self.total[p.id]:,}" + (f" (+{bank:,})" if bank else "")

    def final_scores(self):
        return dict(self.total)

    def view(self, p):
        now = time.time()
        spin = None
        if self.spin:
            spin = {k: self.spin[k] for k in ("id", "wedge", "turns", "by")}
            spin["left"] = max(0.0, self.spin["end"] - now)
            spin["secs"] = SPIN_SECS
        over = self.room.phase == "over"
        return {"lucky": {
            "wedges": [{"value": w, "label": WEDGE_LABEL.get(w, str(w))} for w in WEDGES],
            "board": self.answer if over else self.masked(), "category": self.category,
            "called": sorted(self.called), "stage": self.stage, "value": self.value, "wedge": self.wedge,
            "spin": spin, "round": self.round, "rounds": self.s["rounds"], "jackpot": self.jackpot,
            "bank": self.bank, "total": self.total, "seats": self.seats, "last": self.last_answer,
        }}

    # -- bots

    def bot_ready(self):
        return self.stage not in ("wheel", "solved") and super().bot_ready()

    def bot_turn(self, p):
        if self.stage == "letter":
            self.call_letter(p, self.pick_consonant(p))
        elif self.stage == "vowel":
            left = [v for v in "EAOIU" if v not in self.called]
            self.call_letter(p, left[0] if left else "E")
        else:
            guess = self.try_solve(p)
            if guess:
                return self.solve(p, guess)
            return self.do_spin(p)
        if self.room.turn == p.id and self.stage == "spin":
            self.room.bot_at = time.time() + 1.3  # let humans read the reveal before the next spin

    def fits(self, phrase):
        mask = self.masked()
        return len(phrase) == len(mask) and all(
            (m == "_" and c.isalpha() and c not in self.called) or c == m for c, m in zip(phrase, mask))

    def try_solve(self, p):
        letters = [c for c in self.answer if c.isalpha()]
        shown = sum(1 for c in letters if c in self.called) / len(letters)
        # Like people, bots know lots of familiar phrases and spot one once enough shows.
        known = [ph for ph in PUZZLES[self.category] if self.fits(ph)]
        need, notice = {"easy": (0.6, 0.5), "normal": (0.45, 0.8), "hard": (0.35, 1.0)}[p.bot]
        if len(known) == 1 and shown >= need and random.random() < notice:
            return known[0]
        if p.bot == "hard":
            guess = self.deduce()
            if guess:
                return guess
        threshold = {"easy": 0.8, "normal": 0.7, "hard": 0.65}[p.bot]
        if shown >= threshold or not [c for c in self.hidden() if c in CONSONANTS]:
            return self.answer  # recognising a nearly-complete phrase
        return None

    def candidates(self):
        """Dictionary words that fit each partially hidden word of the puzzle."""
        out = []
        for word, mask in zip(self.answer.split(), self.masked().split()):
            if "_" not in mask:
                continue
            fits = [w for w in words_by_len().get(len(word), [])
                    if all((m == "_" and c not in self.called) or c == m for c, m in zip(w, mask))]
            out.append((mask, fits))
        return out

    def deduce(self):
        parts = self.candidates()
        if not parts or any(len(fits) != 1 for _, fits in parts):
            return None
        solved = iter(fits[0] for _, fits in parts)
        return " ".join(m if "_" not in m else next(solved) for m in self.masked().split())

    def pick_consonant(self, p):
        open_letters = [c for c in FREQ if c not in self.called]
        if not open_letters:
            return "Z"
        if p.bot == "easy":
            return random.choice(open_letters[:12] or open_letters)
        if p.bot == "hard":
            score = defaultdict(float)
            for mask, fits in self.candidates():
                if not fits or len(fits) > 4000:
                    continue
                for w in fits:
                    for c in set(w[i] for i, m in enumerate(mask) if m == "_"):
                        score[c] += 1 / len(fits)
            best = [c for c in sorted(score, key=score.get, reverse=True) if c in open_letters]
            if best:
                return best[0]
        return open_letters[0]
