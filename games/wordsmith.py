"""Wordsmith: crossword tile game on an 11×11 board with a rotating bounty letter."""
import os
import random
import threading
import time
from collections import Counter, defaultdict

from .base import Game, GameError

SIZE = 11
MID = SIZE // 2
RACK = 7
SWEEP_BONUS = 40
BOUNTY_BONUS = 10
WORDS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "words.txt")

# letter: (count, value) — 80 tiles, no blanks
TILES = {
    "E": (9, 1), "A": (7, 1), "I": (6, 1), "O": (6, 1), "U": (3, 1),
    "N": (5, 1), "R": (5, 1), "T": (5, 1), "S": (5, 1), "L": (4, 1), "D": (3, 2),
    "G": (2, 3), "H": (2, 2), "C": (2, 3), "M": (2, 3), "P": (2, 3), "B": (2, 3), "Y": (2, 3),
    "F": (1, 4), "W": (1, 3), "K": (1, 5), "V": (1, 6), "J": (1, 8), "X": (1, 8), "Q": (1, 10), "Z": (1, 8),
}
VALUES = {k: v for k, (_, v) in TILES.items()}
BLANK = "?"  # on a rack; on the board a blank is the lowercase of the letter it stands for, worth 0


def value(ch):
    return VALUES.get(ch, 0)
BOUNTY_POOL = "DGHCMPBYFWKV"


def premium(r, c):
    dr, dc = abs(r - MID), abs(c - MID)
    if dr == dc == 0:
        return "★"
    if {dr, dc} == {0, MID}:
        return "3W"
    if dr == dc and 2 <= dr <= 4:
        return "2W"
    if dr == dc == MID:
        return "3L"
    if dr + dc == 4 and dr and dc and dr != dc:
        return "3L"
    if dr + dc == 2 and 0 in (dr, dc):
        return "2L"
    if MID in (dr, dc) and min(dr, dc) == 3:
        return "2L"
    return ""


PREMIUMS = [[premium(r, c) for c in range(SIZE)] for r in range(SIZE)]

_lock = threading.Lock()
_words = None
_index = None


def mask(letters):
    m = 0
    for ch in letters:
        m |= 1 << (ord(ch) - 65)
    return m


def words():
    global _words, _index
    with _lock:
        if _words is None:
            with open(WORDS_FILE) as f:
                _words = {w.strip().upper() for w in f if 2 <= len(w.strip()) <= SIZE}
            # Bot search index: shuffled so a time budget samples fairly.
            _index = [(w, mask(w)) for w in _words if len(w) <= RACK + 1]
            random.shuffle(_index)
    return _words


def warm_up():
    threading.Thread(target=words, daemon=True).start()


def with_blanks(w, missing, skip):
    """The word with the letters the rack lacks in lowercase (played as blanks), never at index `skip`."""
    out, missing = list(w), list(missing)
    for j in range(len(w) - 1, -1, -1):
        if j != skip and out[j] in missing:
            missing.remove(out[j])
            out[j] = out[j].lower()
    return "".join(out)


class Wordsmith(Game):
    by = None  # rooms saved before tiles had owners
    id = "wordsmith"
    category = "words"
    howto = [
        'Tap a rack tile, then a square. Words read left→right or top→bottom.',
        'The first word covers the ★. Every word after must connect to the board.',
        'DL/TL multiply a letter, DW/TW the whole word. Using the bounty letter scores +10.',
        'Use all 7 tiles in one go for a +40 clean sweep.',
        'With blank tiles on, a blank (?) can be any letter you choose, but it scores 0.',
    ]
    name = "Wordsmith"
    icon = "🔤"
    blurb = (f"Build crossing words on an 11×11 board. Use the bounty letter for +{BOUNTY_BONUS}, "
             f"all 7 tiles for +{SWEEP_BONUS}.")
    min_players = 2
    max_players = 4
    badges = {**Game.badges, "sweep": ("🧹", "Clean sweep", "Play all seven tiles in one turn"),
              "big_word": ("📜", "Wordsmith", "Score 60 or more with one play")}
    settings_schema = {
        "bounty": ("Bounty letter", [(True, "On"), (False, "Off")], True),
        "blanks": ("Blank tiles", [(0, "None"), (2, "2 blanks (any letter, 0 points)")], 0),
    }

    def start(self, seated, rng):
        words()
        self.rng = rng
        self.bag = [ch for ch, (n, _) in TILES.items() for _ in range(n)] + [BLANK] * self.s.get("blanks", 0)
        rng.shuffle(self.bag)
        self.grid = [[None] * SIZE for _ in range(SIZE)]
        self.by = [[None] * SIZE for _ in range(SIZE)]  # who played each tile
        self.scores = {p.id: 0 for p in seated}
        for p in seated:
            p.g.rack = self.draw(RACK)
        self.scoreless = 0
        self.last = []
        self.plays = []  # the turn history: [pid, words, points] ('—' words for a pass or swap)
        self.bounty = None
        first = rng.choice(seated)
        self.room.add_log(f"{first.name} opens. The first word must cover the ★.", "big")
        self.roll_bounty()
        self.room.begin_turn(first.id)

    def draw(self, n):
        out, self.bag = self.bag[:n], self.bag[n:]
        return out

    def roll_bounty(self):
        self.bounty = self.rng.choice(BOUNTY_POOL) if self.s["bounty"] else None

    # -- rules

    def check_play(self, placements):
        """placements: [(row, col, letter)]. Returns (score, words, notes) or raises GameError."""
        if not placements:
            raise GameError("Place some tiles first.")
        new = {}
        for r, c, ch in placements:
            if not (0 <= r < SIZE and 0 <= c < SIZE):
                raise GameError("That's off the board.")
            if self.grid[r][c] is not None or (r, c) in new:
                raise GameError("That square is taken.")
            new[(r, c)] = ch
        get = lambda r, c: new.get((r, c)) or (self.grid[r][c] if 0 <= r < SIZE and 0 <= c < SIZE else None)
        rows = {r for r, _ in new}
        cols = {c for _, c in new}
        if len(rows) == 1:
            main = (0, 1)
        elif len(cols) == 1:
            main = (1, 0)
        else:
            raise GameError("Tiles must go in a single row or column.")
        r0, c0 = min(new)
        r1, c1 = max(new)
        for k in range(max(r1 - r0, c1 - c0) + 1):
            if get(r0 + main[0] * k, c0 + main[1] * k) is None:
                raise GameError("No gaps allowed in a word.")
        board_empty = all(v is None for row in self.grid for v in row)
        if board_empty:
            if (MID, MID) not in new:
                raise GameError("The first word must cover the ★ in the middle.")
            if len(new) < 2:
                raise GameError("The first word needs at least 2 letters.")
        elif not any(self.grid[r + dr][c + dc] is not None
                     for r, c in new for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0))
                     if 0 <= r + dr < SIZE and 0 <= c + dc < SIZE):
            raise GameError("Your word must connect to tiles already on the board.")

        def word_at(r, c, dr, dc):
            while get(r - dr, c - dc):
                r, c = r - dr, c - dc
            cells = []
            while get(r, c):
                cells.append((r, c))
                r, c = r + dr, c + dc
            return cells

        found = [word_at(r0, c0, *main)]
        cross = (main[1], main[0])
        found += [word_at(r, c, *cross) for r, c in new]
        found = [w for w in found if len(w) >= 2]
        if not found:
            raise GameError("Make a word of at least 2 letters.")
        texts = ["".join(get(r, c) for r, c in w).upper() for w in found]
        bad = [t for t in texts if t not in words()]
        if bad:
            raise GameError(f"Not in the dictionary: {', '.join(bad)}")
        total = 0
        for cells in found:
            sub, mult = 0, 1
            for r, c in cells:
                v = value(get(r, c))
                if (r, c) in new:
                    prem = PREMIUMS[r][c]
                    v *= {"2L": 2, "3L": 3}.get(prem, 1)
                    mult *= {"2W": 2, "★": 2, "3W": 3}.get(prem, 1)
                sub += v
            total += sub * mult
        notes = []
        if len(new) == RACK:
            total += SWEEP_BONUS
            notes.append(f"🧹 clean sweep +{SWEEP_BONUS}")
        if self.bounty and self.bounty in new.values():
            total += BOUNTY_BONUS
            notes.append(f"🎯 bounty {self.bounty} +{BOUNTY_BONUS}")
        return total, texts, notes

    # -- actions

    def placements(self, p, tiles):
        """[{r, c, i (rack index)}] from the browser → ([(r, c, letter)], rack indices)."""
        rack = getattr(p.g, "rack", [])
        tiles = tiles if isinstance(tiles, list) else []
        idx = [x.get("i") for x in tiles if isinstance(x, dict)]
        if len(idx) != len(tiles) or len(set(idx)) != len(idx) or \
                not all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(rack) for i in idx):
            raise GameError("Those tiles aren't on your rack.")
        placements = []
        for x in tiles:
            ch = rack[x["i"]]
            if ch == BLANK:  # the browser says which letter the blank stands for
                ch = x.get("as")
                if not (isinstance(ch, str) and len(ch) == 1 and "A" <= ch.upper() <= "Z"):
                    raise GameError("Pick a letter for the blank tile.")
                ch = ch.lower()
            placements.append((x.get("r"), x.get("c"), ch))
        if not all(isinstance(r, int) and isinstance(c, int) for r, c, _ in placements):
            raise GameError("Bad tile position.")
        return placements, idx

    def peek(self, p, a):
        """What the tiles you've placed would score (live preview), or, alone against bots, a hint."""
        if a.get("what") == "hint":
            if len([o for o in self.room.contenders() if o.human()]) > 1:
                raise GameError("Hints are for solo games against bots.")
            moves = self.find_moves(getattr(p.g, "rack", []), 1.2)
            if not moves:
                return {"none": True}
            score, tiles, texts = max(moves, key=lambda m: m[0])
            return {"tiles": [list(t) for t in tiles], "words": texts, "score": score}
        try:
            score, texts, notes = self.check_play(self.placements(p, a.get("tiles"))[0])
        except GameError as e:
            return {"error": str(e)}
        return {"score": score, "words": texts, "notes": notes}

    def act(self, p, a):
        self.require_turn(p)
        t = a.get("type")
        rack = p.g.rack
        if t == "play":
            return self.play(p, *self.placements(p, a.get("tiles")))
        if t == "swap":
            idx = a.get("idx") or []
            if not idx or len(set(idx)) != len(idx) or \
                    not all(isinstance(i, int) and 0 <= i < len(rack) for i in idx):
                raise GameError("Pick tiles to swap.")
            if len(self.bag) < len(idx):
                raise GameError(f"Only {len(self.bag)} tiles left in the bag.")
            return self.swap(p, idx)
        if t == "pass":
            self.room.add_log(f"{p.name} passed.")
            self.note_play(p, "⏭ passed", 0)
            self.scoreless += 1
            return self.next_turn()
        raise GameError("Unknown action.")

    def play(self, p, placements, idx):
        score, texts, notes = self.check_play(placements)
        if self.by is None:  # a game saved before tiles remembered who played them
            self.by = [[None] * SIZE for _ in range(SIZE)]
        for r, c, ch in placements:
            self.grid[r][c] = ch
            self.by[r][c] = p.id
        p.g.rack = [ch for i, ch in enumerate(p.g.rack) if i not in idx]
        p.g.rack += self.draw(RACK - len(p.g.rack))
        self.scores[p.id] += score
        if len(placements) == RACK:
            self.award(p, "sweep")
        if score >= 60:
            self.award(p, "big_word")
        self.last = [[r, c] for r, c, _ in placements]
        self.scoreless = 0
        extra = f" ({', '.join(notes)})" if notes else ""
        self.room.add_log(f"{p.name} played {', '.join(texts)} for {score}{extra}.", "question")
        self.note_play(p, ", ".join(texts), score)
        if not p.g.rack and not self.bag:
            return self.end_game(p)
        self.next_turn()

    def swap(self, p, idx):
        back = [p.g.rack[i] for i in idx]
        p.g.rack = [ch for i, ch in enumerate(p.g.rack) if i not in idx] + self.draw(len(idx))
        self.bag += back
        self.rng.shuffle(self.bag)
        self.scoreless += 1
        self.room.add_log(f"{p.name} swapped {len(idx)} tile{'s' * (len(idx) > 1)}.")
        self.note_play(p, f"🔄 swapped {len(idx)}", 0)
        self.next_turn()

    def note_play(self, p, words, pts):
        if not hasattr(self, "plays"):
            self.plays = []
        self.plays = (self.plays + [[p.id, words, pts]])[-40:]

    def next_turn(self):
        if self.scoreless >= 2 * len(self.room.contenders()):
            return self.end_game(None)
        self.roll_bounty()
        self.room.advance()

    def on_timeout(self):
        r = self.room
        r.add_log(f"⏰ {r.players[r.turn].name} ran out of time!", "power")
        self.scoreless += 1
        self.next_turn()

    def end_game(self, out):
        r = self.room
        live = r.contenders()
        bonus = 0
        for p in live:
            left = sum(value(ch) for ch in p.g.rack)
            self.scores[p.id] -= left
            bonus += left
        if out:
            self.scores[out.id] += bonus
            r.add_log(f"{out.name} used their last tile and collects 💰{bonus} from the others' racks.")
        top = max(self.scores[p.id] for p in live)
        best = [p for p in live if self.scores[p.id] == top]
        if len(best) == 1:
            r.finish(best[0], f"🏆 {best[0].name} wins with {top} points!")
        else:
            r.finish(None, f"🤝 Tie at {top} between {' & '.join(p.name for p in best)}.")

    def meta(self, p):
        return f"{self.scores[p.id]} pts" if p.id in self.scores else ""

    def final_scores(self):
        return dict(self.scores)

    def view(self, p):
        return {"ws": {
            "grid": self.grid, "premiums": PREMIUMS, "values": {**VALUES, BLANK: 0}, "bag": len(self.bag),
            "bounty": self.bounty, "last": self.last, "scores": self.scores, "by": self.by,
            "rack": getattr(p.g, "rack", None), "plays": getattr(self, "plays", [])[-12:],
            "bonuses": {"sweep": SWEEP_BONUS, "bounty": BOUNTY_BONUS},
        }}

    # -- bot

    def find_moves(self, rack, budget):
        words()
        rc = Counter(rack)
        blanks = rc.pop(BLANK, 0)
        on_board = defaultdict(list)
        for r in range(SIZE):
            for c in range(SIZE):
                if self.grid[r][c]:
                    on_board[self.grid[r][c].upper()].append((r, c))
        empty = not on_board
        allowed = (1 << 26) - 1 if blanks else mask(rc) | mask(on_board)
        deadline = time.time() + budget
        moves, seen = [], set()

        def consider(tiles):
            key = frozenset(tiles)
            if key in seen:
                return
            seen.add(key)
            try:
                score, texts, _ = self.check_play(tiles)
            except GameError:
                return
            moves.append((score, tiles, texts))

        for n, (w, wm) in enumerate(_index):
            if n % 2000 == 0 and time.time() > deadline:
                break
            if wm & ~allowed or len(w) > len(rack) + (0 if empty else 1):
                continue
            need = Counter(w)
            need.subtract(rc)
            extra = [ch for ch, k in need.items() if k > 0 for _ in range(k)]
            if empty:
                if len(extra) <= blanks:
                    word = with_blanks(w, extra, None)
                    for start in range(max(0, MID - len(w) + 1), min(MID, SIZE - len(w)) + 1):
                        consider([(MID, start + k, word[k]) for k in range(len(w))])
                continue
            # one letter comes from the board; blanks cover any others the rack lacks
            if len(extra) > blanks + 1 or (not blanks and len(extra) != 1):
                continue
            anchors = set(extra) if len(extra) > blanks else set(w) & on_board.keys()
            for letter in anchors:
                missing = list(extra)
                if letter in missing:
                    missing.remove(letter)
                for r, c in on_board[letter]:
                    for k in (k for k, ch in enumerate(w) if ch == letter):
                        word = with_blanks(w, missing, k)
                        for dr, dc in ((0, 1), (1, 0)):
                            r0, c0 = r - dr * k, c - dc * k
                            r1, c1 = r0 + dr * (len(w) - 1), c0 + dc * (len(w) - 1)
                            if not (0 <= r0 and 0 <= c0 and r1 < SIZE and c1 < SIZE):
                                continue
                            tiles = [(r0 + dr * j, c0 + dc * j, word[j]) for j in range(len(w)) if j != k]
                            if all(self.grid[y][x] is None for y, x, _ in tiles):
                                consider(tiles)
        return moves

    def bot_turn(self, p):
        budget = {"easy": 0.8, "normal": 1.5, "hard": 2.5}[p.bot]
        moves = self.find_moves(p.g.rack, budget)
        if not moves:
            if len(self.bag) >= RACK:
                return self.swap(p, list(range(len(p.g.rack))))
            self.room.add_log(f"{p.name} passed.")
            self.note_play(p, "⏭ passed", 0)
            self.scoreless += 1
            return self.next_turn()
        moves.sort(key=lambda m: m[0])
        if p.bot == "hard":
            pick = moves[-1]
        elif p.bot == "normal":
            pick = random.choice(moves[len(moves) * 2 // 3:])
        else:
            pick = random.choice(moves[:max(1, len(moves) * 2 // 3)])
        _, tiles, _ = pick
        idx, used = [], set()
        for _, _, ch in tiles:
            i = next(i for i, x in enumerate(p.g.rack) if x == (BLANK if ch.islower() else ch) and i not in used)
            used.add(i)
            idx.append(i)
        self.play(p, tiles, idx)
