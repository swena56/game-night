"""💣 Word Bomb: an original take on the "word bomb" party genre.

A 2–3 letter chunk (ING, PL, OUS…) shows on the bomb. Whoever holds it types a real word containing that
chunk, never played before this game, and the bomb moves on to the next player with a fresh chunk. The
fuse is hidden and random: when it runs out, the bomb goes off in the holder's hands and they lose a ♥.
The last player with a heart left wins.

Twists: 🔤 use every letter of the alphabet bonus (J, Q, X and Z don't count) to earn a ♥ back; 📏 a word
of 9+ letters adds two seconds to the fuse for whoever gets the bomb next; a chunk that has blown up
twice is swapped for a new one. Everyone sees the holder's typing as it happens (push_fast)."""
import json
import os
import threading
import time

from .base import Game, GameError
from .wordsmith import WORDS_FILE, words

MIN_LEN = 3
CACHE_FILE = os.path.join(os.path.dirname(WORDS_FILE), "wordbomb-chunks.json")
MIN_TURN = 3.0        # whoever gets the bomb always has at least this long, whatever the fuse says
LONG_WORD, LONG_BONUS = 9, 2.0
BOOM_PAUSE = 2.4      # the explosion plays out before the next bomb is lit
ALPHABET = "ABCDEFGHIKLMNOPRSTUVWY"   # J, Q, X and Z don't count towards the bonus
MAX_TYPED = 24
FUSES = {"short": (6, 12), "normal": (10, 20), "long": (16, 28)}
# chunk difficulty: how many dictionary words contain it (more words = easier)
BANDS = {"easy": (600, 10 ** 9), "normal": (150, 3000), "hard": (40, 400)}
# bots: seconds to think, seconds per letter typed, chance to freeze on a chunk (doubled on rare chunks)
# Tuned with a turn-time model against a human averaging ~4.5 s a word (2 bots + you, 3 hearts): you win
# ~70% against easy bots, ~50% against normal and ~25% against hard (fair share: 33%).
BOT = {"easy": ((3.0, 7.5), 0.18, 0.18), "normal": ((2.5, 5.5), 0.14, 0.09), "hard": ((1.8, 3.8), 0.10, 0.05)}

# -- the dictionary side: chunk counts, words longer than Wordsmith's 11 letters, words per chunk

_lock = threading.Lock()
_long = None      # dictionary words of 12+ letters (wordsmith.words() stops at 11)
_counts = None    # chunk -> number of words containing it
_pools = {}       # chunk -> [words containing it], filled on demand (a small cache)


def prepare():
    """Count every 2- and 3-letter chunk once (a background job at server start; a few seconds on a phone)."""
    global _long, _counts
    with _lock:
        if _counts is not None:
            return
        short = words()
        with open(WORDS_FILE) as f:
            long_words = {w for w in (line.strip().upper() for line in f) if len(w) > 11 and w.isalpha()}
        # Counting takes seconds of CPU on a phone (and would stutter real-time games after a restart), so the
        # counts are kept next to the dictionary and only redone when the dictionary changes.
        st = os.stat(WORDS_FILE)
        stamp = f"{st.st_size}:{st.st_mtime_ns}:{MIN_LEN}"
        counts = None
        try:
            with open(CACHE_FILE) as f:
                saved = json.load(f)
            if saved.get("stamp") == stamp:
                counts = saved["counts"]
        except (OSError, ValueError, KeyError):
            pass
        if counts is None:
            counts = {}
            for w in (*short, *long_words):
                if len(w) < MIN_LEN:
                    continue
                seen = {w[i:i + 2] for i in range(len(w) - 1)} | {w[i:i + 3] for i in range(len(w) - 2)}
                for c in seen:
                    counts[c] = counts.get(c, 0) + 1
            try:
                tmp = CACHE_FILE + ".tmp"
                with open(tmp, "w") as f:
                    json.dump({"stamp": stamp, "counts": counts}, f)
                os.replace(tmp, CACHE_FILE)
            except OSError:
                pass
        _long, _counts = long_words, counts


def warm_up():
    threading.Thread(target=prepare, daemon=True).start()


def is_word(w):
    prepare()
    return len(w) >= MIN_LEN and (w in words() or w in _long)


def pool(chunk):
    """Every dictionary word containing `chunk` (cached for the most recent chunks)."""
    prepare()
    hit = _pools.get(chunk)
    if hit is None:
        hit = [w for w in words() if chunk in w and len(w) >= MIN_LEN] + [w for w in _long if chunk in w]
        if len(_pools) > 48:
            _pools.pop(next(iter(_pools)))
        _pools[chunk] = hit
    return hit


def chunks(level):
    prepare()
    lo, hi = BANDS[level]
    return sorted(c for c, n in _counts.items() if lo <= n < hi)


def chunk_count(c):
    prepare()
    return _counts.get(c, 0)


class WordBomb(Game):
    id = "wordbomb"
    category = "words"
    name = "Word Bomb"
    icon = "💣"
    blurb = "Type a word containing the letters on the bomb before its hidden fuse runs out, then pass it on."
    howto = [
        "The bomb shows a few letters, like ING. When it's yours, type any real word containing them (CLINGY, SINGER…) and press Enter.",
        f"Words need {MIN_LEN}+ letters and can't repeat in a game. A good word passes the bomb on with new letters.",
        "The fuse is hidden and different every time. If the bomb goes off in your hands, you lose a ♥. The last player with a heart wins.",
        "🔤 Use every letter A–Y in your words (J, Q, X, Z don't count) to win a ♥ back. 📏 A word of 9+ letters adds two seconds to the fuse.",
        "📜 After each blast, the review shows that bomb's words and the letters that blew it up. When the game ends, it lists every bomb.",
    ]
    min_players, max_players = 2, 6
    settings_schema = {
        "lives": ("Hearts", [(3, "♥♥♥ 3"), (2, "♥♥ 2"), (4, "♥♥♥♥ 4")], 3),
        "fuse": ("Fuse", [("normal", "🕯️ Normal (10–20 s)"), ("short", "🧨 Short (6–12 s)"), ("long", "🐢 Long (16–28 s)")], "normal"),
        "level": ("Letters", [("normal", "Normal"), ("easy", "Easy (common chunks)"), ("hard", "Hard (rare chunks)")], "normal"),
        "alphabet": ("🔤 Alphabet bonus", [(True, "On: every letter wins a ♥ back"), (False, "Off")], True),
        "longword": ("📏 Long words", [(True, "On: 9+ letters add 2 s to the fuse"), (False, "Off")], True),
    }
    badges = {**Game.badges,
              "close": ("😅", "Close call", "Pass the bomb with under a second of fuse left"),
              "alpha": ("🔤", "Alphabet", "Win a heart back by using every letter"),
              "long": ("📏", "Long fuse", "Play a word of 12 or more letters")}

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.max_lives = int(self.s.get("lives", 3))
        for p in seated:
            p.g.lives = self.max_lives
            p.g.letters = set()
            p.g.words = 0
            p.g.longest = ""
        self.used = set()
        self.misses = {}         # chunk -> explosions on it
        self.bomb_no = 0
        self.passes = 0
        self.chunk = ""
        self.fuse_at = 0.0
        self.stage = "lit"       # lit | boom
        self.typed = ""
        self.seq = 0             # counts events, so screens animate each one once
        self.last = None         # the last word played {by, word, seq, long, close}
        self.boom = None         # the last explosion {by, seq, chunk, example, out}
        self.alpha_win = None    # {by, seq}
        self.plan = None         # the bot's plan for this turn {word or None, typed}
        self.longest = ("", None)
        self.bombs = []          # 📜 every resolved bomb: {bomb, words [[pid, word, chunk]], boom {by, chunk, example}}
        self.cur = []            # the words played on the bomb that's lit now (kept out of views until it resolves)
        self.room.add_log(f"💣 Word Bomb! {self.max_lives} ♥ each. Type a word containing the letters on the bomb "
                          "before it goes off.", "big")
        self.light(rng.choice(self.seats), fresh=True)

    def on_restore(self, shift):
        self.fuse_at += shift
        self.room.deadline = (self.room.deadline or 0) + shift if self.stage == "boom" else self.fuse_at

    # -- the bomb

    def pick_chunk(self):
        options = chunks(self.s.get("level", "normal")) or chunks("normal")
        recent = {self.chunk}
        for _ in range(20):
            c = self.rng.choice(options)
            if c not in recent and any(w not in self.used for w in pool(c)[:400]):
                return c
        return self.rng.choice(options)

    def light(self, pid, fresh=False):
        """A new bomb, lit in `pid`'s hands."""
        lo, hi = FUSES.get(self.s.get("fuse"), FUSES["normal"])
        self.bomb_no += 1
        self.stage = "lit"
        self.fuse_at = time.time() + self.rng.uniform(lo, hi)
        if fresh or self.misses.get(self.chunk, 0) >= 2 or not self.chunk:
            self.chunk = self.pick_chunk()
        self.hand_to(pid)

    def hand_to(self, pid):
        r = self.room
        r.begin_turn(pid)
        self.fuse_at = max(self.fuse_at, time.time() + MIN_TURN)
        r.deadline = self.fuse_at
        self.typed = ""
        self.plan_bot(r.players[pid])

    def pass_on(self):
        r = self.room
        r.advance()
        self.hand_to(r.turn)

    def on_timeout(self):
        r = self.room
        if self.stage == "boom":
            nxt = self.boom["by"]
            r.turn = nxt
            r.advance()
            self.light(r.turn)
            return
        p = r.players.get(r.turn)
        if not p:
            return self.pass_on()
        self.explode(p)

    def explode(self, p):
        r = self.room
        self.seq += 1
        p.g.lives = max(0, getattr(p.g, "lives", 1) - 1)
        self.misses[self.chunk] = self.misses.get(self.chunk, 0) + 1
        free = [w for w in pool(self.chunk) if w not in self.used and len(w) <= 8]
        example = self.rng.choice(free) if free else ""
        out = p.g.lives == 0
        self.boom = {"by": p.id, "seq": self.seq, "chunk": self.chunk, "example": example, "out": out}
        self.close_bomb({"by": p.id, "chunk": self.chunk, "example": example, "out": out})
        if out:
            p.eliminated = True
            self.moment(f"💥 BOOM! {p.name} is out!", "bad", "boom")
        else:
            self.moment(f"💥 BOOM! {p.name} loses a ♥", "bad", "boom")
        if example:   # kept out of the callout, which must stay short on a phone
            r.add_log(f"💡 {example} would have worked for {self.chunk}.")
        alive = [o for o in r.contenders() if o.id in self.seats]
        if len(alive) <= 1:
            w = alive[0] if alive else None
            r.finish(w, f"🏆 {w.name} is the last one standing!" if w else "💥 Nobody survived the bomb.")
            return
        # the next bomb is lit after the blast, in the next player's hands
        self.stage = "boom"
        self.plan = None
        self.typed = ""
        r.turn = None
        r.deadline = time.time() + BOOM_PAUSE

    # -- moves

    def act(self, p, a):
        if a.get("type") != "word":
            raise GameError("Unknown action.")
        self.require_turn(p)
        if self.stage != "lit":
            raise GameError("Wait for the next bomb.")
        w = str(a.get("word") or "").strip().upper()
        why = self.check(w)
        if why:
            # the table sees the miss too (the request itself fails, so nothing else is re-sent)
            self.room.push_fast({"no": why, "by": p.id, "w": w[:MAX_TYPED], "k": self.seq})
            raise GameError(why)
        self.play(p, w)

    def check(self, w):
        if not w.isalpha() or len(w) > 30:
            return "Letters only."
        if self.chunk not in w:
            return f"It needs {self.chunk} in it."
        if len(w) < MIN_LEN:
            return f"At least {MIN_LEN} letters."
        if w in self.used:
            return f"{w} was already played."
        if not is_word(w):
            return f"{w} isn't in the dictionary."
        return None

    def play(self, p, w):
        r, now = self.room, time.time()
        self.seq += 1
        self.used.add(w)
        p.g.words = getattr(p.g, "words", 0) + 1
        if len(w) > len(getattr(p.g, "longest", "")):
            p.g.longest = w
        left = self.fuse_at - now
        close = left < 1.0
        long_word = self.s.get("longword", True) and len(w) >= LONG_WORD
        self.last = {"by": p.id, "word": w, "chunk": self.chunk, "seq": self.seq, "long": bool(long_word), "close": close}
        self.cur = getattr(self, "cur", [])  # games saved before the review
        self.cur.append([p.id, w, self.chunk])
        r.add_log(f"💣 {p.name}: {w}" + (" 📏 +2 s" if long_word else ""))
        if close:
            self.moment(f"😅 {p.name} passed it with a split second to spare!", "good", "whoosh")
            self.award(p, "close")
        if len(w) >= 12:
            self.award(p, "long")
        if len(w) > len(self.longest[0]) and len(w) >= 8:
            if self.longest[1] is not None and self.longest[1] != p.id:
                self.moment(f"📏 {w}: {p.name} has the longest word now!", "cool", "rise")
            self.longest = (w, p.id)
        if long_word:
            self.fuse_at += LONG_BONUS
        if self.s.get("alphabet", True):
            p.g.letters = getattr(p.g, "letters", set()) | (set(w) & set(ALPHABET))
            if len(p.g.letters) == len(ALPHABET):
                p.g.letters = set()
                gained = p.g.lives < self.max_lives
                p.g.lives = min(self.max_lives, p.g.lives + 1)
                self.alpha_win = {"by": p.id, "seq": self.seq}
                self.moment(f"🔤 {p.name} used the whole alphabet" + (" and wins a ♥ back!" if gained else "!"), "gold", "fanfare")
                self.award(p, "alpha")
        self.passes += 1
        self.chunk = self.pick_chunk()
        self.pass_on()

    def close_bomb(self, boom):
        """📜 The bomb has resolved: file its words and the chunk that blew up, for the review."""
        self.bombs = getattr(self, "bombs", [])
        self.bombs.append({"bomb": self.bomb_no, "words": getattr(self, "cur", []), "boom": boom})
        self.cur = []

    def review(self):
        """Resolved bombs only (never the lit one, and no fuse times): the last one during play, all at the end."""
        bombs = list(getattr(self, "bombs", []))
        if self.room.phase == "over":
            if getattr(self, "cur", None):  # the game ended without a blast (players left)
                bombs.append({"bomb": self.bomb_no, "words": self.cur, "boom": None})
            return {"final": True, "bombs": bombs}
        return {"final": False, "bombs": bombs[-1:]} if bombs else None

    def on_input(self, p, a):
        """The holder's keystrokes, shown live to the table."""
        if self.room.turn != p.id or self.stage != "lit":
            return
        t = "".join(ch for ch in str(a.get("t") or "").upper() if ch.isalpha())[:MAX_TYPED]
        if t != self.typed:
            self.typed = t
            self.room.push_fast({"ty": t, "by": p.id, "k": self.seq})

    def on_leave(self, p):
        holding = self.room.turn == p.id
        super().on_leave(p)
        if self.room.phase == "playing" and holding and self.room.turn and self.stage == "lit":
            self.hand_to(self.room.turn)

    # -- bots

    def plan_bot(self, p):
        if not p.bot:
            self.plan = None
            return
        think, _, freeze = BOT.get(p.bot, BOT["normal"])
        rare = chunk_count(self.chunk) < 150
        if self.rng.random() < freeze * (2 if rare else 1):
            word = None
        else:
            word = self.bot_word(p)
        self.plan = {"word": word, "typed": 0, "stuck": self.rng.randint(1, 3)}
        self.room.bot_at = time.time() + self.rng.uniform(*think) * (1.4 if rare else 1)

    def bot_word(self, p):
        free = [w for w in pool(self.chunk) if w not in self.used]
        if not free:
            return None
        sample = self.rng.sample(free, min(len(free), 300))
        need = set(ALPHABET) - getattr(p.g, "letters", set()) if self.s.get("alphabet", True) else set()

        def score(w):
            n = len(w)
            if p.bot == "easy":
                return -abs(n - 5) + self.rng.random() * 2
            if p.bot == "normal":
                return -abs(n - 6) + len(set(w) & need) * 0.5 + self.rng.random() * 3
            # long words (and letters still needed for 🔤) are worth it, up to what a person would type
            return len(set(w) & need) * 1.2 + min(n, 10) * 0.4 - max(0, n - 11) * 1.5 + self.rng.random() * 2

        return max(sample, key=score)

    def bot_ready(self):
        p = self.room.players.get(self.room.turn)
        if not (p and p.bot and self.stage == "lit"):
            return False
        if self.plan is None:
            self.plan_bot(p)
        # a frozen bot types a letter or two, then stares at the bomb until it goes off
        return bool(self.plan["word"]) or self.plan["typed"] < self.plan["stuck"]

    def bot_turn(self, p):
        plan, now = self.plan, time.time()
        _, per, _ = BOT.get(p.bot, BOT["normal"])
        word = plan["word"]
        if word and plan["typed"] >= len(word):
            self.plan = None
            if self.check(word):   # someone took it meanwhile (can't happen in turns, but be safe)
                word = self.bot_word(p)
                if not word:
                    return
            self.play(p, word)
            return
        target = word or "".join(self.rng.choice("AEIOURSTLN") for _ in range(plan["stuck"]))
        plan["typed"] += 1
        self.typed = target[:plan["typed"]]
        self.room.push_fast({"ty": self.typed, "by": p.id, "k": self.seq})
        self.room.no_bump = True
        self.room.bot_at = now + per * self.rng.uniform(0.6, 1.5)

    # -- views

    def view(self, p):
        r = self.room
        seats = [i for i in self.seats if i in r.players]
        return {
            "timeLeft": None,   # the fuse is a secret: no countdown anywhere
            "wordbomb": {
                "chunk": self.chunk, "stage": self.stage, "holder": r.turn, "seats": seats,
                "lives": {i: getattr(r.players[i].g, "lives", 0) for i in seats}, "maxLives": self.max_lives,
                "letters": {i: "".join(sorted(getattr(r.players[i].g, "letters", set()))) for i in seats},
                "words": {i: getattr(r.players[i].g, "words", 0) for i in seats},
                "alphabet": ALPHABET if self.s.get("alphabet", True) else "",
                "typed": self.typed, "last": self.last, "boom": self.boom, "alphaWin": self.alpha_win,
                "bomb": self.bomb_no, "used": len(self.used), "seq": self.seq, "minLen": MIN_LEN,
                "longest": {"word": self.longest[0], "by": self.longest[1]} if self.longest[0] else None,
                "review": self.review(),
            },
        }

    def meta(self, p):
        lives = getattr(p.g, "lives", None)
        if lives is None:
            return ""
        return ("♥" * lives if lives else "💀") + f" · {getattr(p.g, 'words', 0)} words"

    def final_scores(self):
        return {i: getattr(self.room.players[i].g, "words", 0) for i in self.seats if i in self.room.players}
