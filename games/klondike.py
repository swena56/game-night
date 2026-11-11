"""Solitaire (Klondike), the traditional patience: seven columns with their top cards face up, a stock
to draw from (one or three at a time), and four foundations built up by suit from the ace. Raced:
everyone plays the same deal (games/patience.py).

Bots play fair: they only use what a player could see (the face-up cards, the waste, how many cards are
face down). They follow the usual rules of thumb: play aces and twos at once, uncover face-down cards
from the deepest column first, keep empty columns for kings, and draw when there's nothing better.
A full pass through the stock with nothing to play means they're stuck, and they call it a day."""
from .base import GameError
from .patience import RANKS, SUITS, Patience, fits_on, rank, red

SLIP = {"easy": 0.35, "normal": 0.25, "hard": 0.0}   # chance of missing a good move and drawing instead


class Klondike(Patience):
    id = "klondike"
    name = "Solitaire"
    icon = "♣️"
    blurb = "The classic patience (Klondike): turn the stock, uncover the columns, build the suits up from the aces. Raced on the same deal."
    howto = [
        "Build the four foundations up by suit, ace to king. Seven columns are dealt with only their top card face up.",
        "Move a face-up card (with everything on it) onto a card one higher of the other colour; only a king may fill an empty column.",
        "Tap the stock to turn cards onto the waste, one or three at a time; when it runs out, tap it to turn the waste over again.",
        "Everyone plays the same deal at once: 1 point per card home, +10 for clearing it, +5 for clearing it first.",
        "Drag, or tap a card then tap where it goes; double-tap sends a card home. ↩ undo is free, 💡 costs a point, 🏳️ ends your deal.",
    ]
    settings_schema = {
        "draw": ("Draw", [(1, "1 card (easier)"), (3, "3 cards (classic)")], 1),
        "rounds": ("Deals", [(1, "1"), (3, "3")], 1),
        "secs": ("Time per deal", [(480, "8 min"), (300, "5 min"), (720, "12 min")], 480),
        "daily": ("Deals", [(False, "🎲 Random"), (True, "📅 Today's deals (the same everywhere)")], False),
    }
    BOT = {"easy": 3.0, "normal": 2.2, "hard": 1.5}
    badges = {**Patience.badges, "three": ("🎩", "Three's company", "Clear a Solitaire deal drawing three")}

    def deal_board(self, rng):
        deck = [r + s for s in SUITS for r in RANKS]
        rng.shuffle(deck)
        cols = []
        for i in range(7):
            cols.append(deck[:i + 1])
            deck = deck[i + 1:]
        return {"t": cols, "down": list(range(7)), "stock": deck, "waste": [], "f": {s: 0 for s in SUITS}, "passes": 0}

    def public_board(self, b):
        return {
            "t": [["??"] * b["down"][i] + col[b["down"][i]:] for i, col in enumerate(b["t"])],
            "stock": len(b["stock"]), "waste": b["waste"][-3:], "wasted": len(b["waste"]),
            "f": b["f"], "draw": self.s["draw"], "passes": b["passes"],
            "clear": self.all_open(b),
        }

    @staticmethod
    def all_open(b):
        return not b["stock"] and not any(b["down"])

    # -- rules

    def lift(self, b, src, n):
        if not isinstance(src, str) or not src:
            raise GameError("Pick a card to move.")
        if src == "w":
            if not b["waste"]:
                raise GameError("The waste is empty.")
            if n != 1:
                raise GameError("Only the top waste card moves.")
            return [b["waste"][-1]]
        if len(src) != 2 or not src[1].isdigit():
            raise GameError("Pick a card to move.")
        i = int(src[1])
        if src[0] == "f":
            if i > 3 or not b["f"][SUITS[i]]:
                raise GameError("That foundation is empty.")
            if n != 1:
                raise GameError("Foundations give back one card at a time.")
            return [RANKS[b["f"][SUITS[i]] - 1] + SUITS[i]]
        if src[0] != "t" or i > 6 or not b["t"][i]:
            raise GameError("That column is empty.")
        open_n = len(b["t"][i]) - b["down"][i]
        if not 1 <= n <= open_n:
            raise GameError("That card is face down.")
        return b["t"][i][-n:]

    def apply(self, b, a):
        kind = a.get("type")
        if kind == "draw":
            if b["stock"]:
                for _ in range(min(self.s["draw"], len(b["stock"]))):
                    b["waste"].append(b["stock"].pop())
            elif b["waste"]:
                b["stock"] = b["waste"][::-1]
                b["waste"] = []
                b["passes"] += 1
            else:
                raise GameError("The stock and the waste are both empty.")
            return
        if kind != "move":
            raise GameError("Unknown action.")
        src, dst, n = a.get("src"), a.get("dst"), a.get("n", 1)
        if not isinstance(n, int) or isinstance(n, bool):
            raise GameError("Pick a card to move.")
        cards = self.lift(b, src, n)
        if dst == "f":
            c = cards[0]
            if n != 1 or src[0] == "f":
                raise GameError("One card at a time goes home.")
            if b["f"][c[1]] != rank(c) - 1:
                need = b["f"][c[1]]
                raise GameError(f"The {c[1]} foundation needs a{'n' if need in (0, 7) else ''} {RANKS[need]} next." if need < 13 else "That suit is complete.")
            b["f"][c[1]] += 1
        elif isinstance(dst, str) and len(dst) == 2 and dst[0] == "t" and dst[1].isdigit() and int(dst[1]) <= 6:
            j = int(dst[1])
            if src == dst:
                raise GameError("It's already there.")
            col = b["t"][j]
            if not col and cards[0][0] != "K":
                raise GameError("Only a king can fill an empty column.")
            if col and not fits_on(cards[0], col[-1]):
                raise GameError("It goes on a card one higher of the other colour.")
            col.extend(cards)
        else:
            raise GameError("Drop it on a column or a foundation.")
        if src == "w":
            b["waste"].pop()
        elif src[0] == "f":
            b["f"][SUITS[int(src[1])]] -= 1
        else:
            i = int(src[1])
            del b["t"][i][-n:]
            if b["t"][i] and b["down"][i] >= len(b["t"][i]):
                b["down"][i] = len(b["t"][i]) - 1   # turn the new top card face up

    def auto_moves(self, b):
        """⏫: every card that can go home from the waste and the column tops (all of them once the
        whole deal is face up, the auto-finish)."""
        f = dict(b["f"])
        cols = [list(c) for c in b["t"]]
        down = list(b["down"])
        waste = list(b["waste"])
        seq = []
        changed = True
        while changed:
            changed = False
            if waste and f[waste[-1][1]] == rank(waste[-1]) - 1:
                f[waste[-1][1]] += 1
                waste.pop()
                seq.append({"type": "move", "src": "w", "n": 1, "dst": "f"})
                changed = True
            for i, col in enumerate(cols):
                if len(col) > down[i] and f[col[-1][1]] == rank(col[-1]) - 1:
                    f[col[-1][1]] += 1
                    col.pop()
                    if col and down[i] >= len(col):
                        down[i] = len(col) - 1
                    seq.append({"type": "move", "src": f"t{i}", "n": 1, "dst": "f"})
                    changed = True
        return seq

    def next_round(self):
        self.draws = {}
        super().next_round()

    def do(self, p, a):
        super().do(p, a)
        # draws in a row with nothing else played: a whole pass of them means the 💡 hint has nothing left
        self.draws = getattr(self, "draws", {})
        self.draws[p.id] = self.draws.get(p.id, 0) + 1 if a.get("type") == "draw" else 0

    def find_hint(self, p, b):
        mv = self.best(b, "hard")
        if mv:
            return mv
        if not (b["stock"] or b["waste"]):
            return None
        cycle = (len(b["stock"]) + len(b["waste"]) + self.s["draw"] - 1) // self.s["draw"] + 1
        return None if getattr(self, "draws", {}).get(p.id, 0) > cycle else {"type": "draw"}

    def cleared_badges(self, p, b):
        if self.s["draw"] == 3:
            self.award(p, "three")

    # -- bots (and the 💡 hint)

    def bot_move(self, p, b):
        st = self.bot_state.setdefault(p.id, {"idle": 0})
        level = getattr(p, "bot", None) or "normal"
        if self.all_open(b) and sum(b["f"].values()) < 52:
            seq = self.auto_moves(b)
            if seq:
                return seq[0]
        mv = self.best(b, level, st)
        st["last"] = (mv["src"], mv["dst"]) if mv else None
        if mv and (level == "hard" or self.rng.random() >= SLIP.get(level, 0.1) or not (b["stock"] or b["waste"])):
            st["idle"] = 0
            return mv
        st["last"] = None
        if b["stock"] or b["waste"]:
            st["idle"] = st.get("idle", 0) + 1
            # a whole pass through the stock (and the turn-over) with nothing to play: stuck
            if st["idle"] > (len(b["stock"]) + len(b["waste"])) // max(1, self.s["draw"]) + 2:
                return mv
            return {"type": "draw"}
        return mv

    def best(self, b, level, st=None):
        f = b["f"]
        cols, down = b["t"], b["down"]

        def safe(c):
            r = rank(c)
            if f[c[1]] != r - 1:
                return False
            if r <= 2:
                return True
            other = "SC" if red(c) else "HD"
            return all(f[s] >= r - 1 for s in other)

        def home(c):
            return f[c[1]] == rank(c) - 1

        moves = []   # (priority, move): lower goes first
        waste = b["waste"][-1] if b["waste"] else None
        if waste and safe(waste):
            moves.append((0, {"type": "move", "src": "w", "n": 1, "dst": "f"}))
        for i, col in enumerate(cols):
            if len(col) > down[i] and safe(col[-1]):
                moves.append((0, {"type": "move", "src": f"t{i}", "n": 1, "dst": "f"}))
        empty = [j for j, col in enumerate(cols) if not col]
        for i, col in enumerate(cols):
            open_n = len(col) - down[i]
            if not open_n:
                continue
            base = col[down[i]]          # the deepest face-up card: moving it uncovers a card or empties the column
            if down[i]:
                for j, dst in enumerate(cols):
                    if j != i and dst and fits_on(base, dst[-1]):
                        moves.append((1 - down[i] / 10 if level != "easy" else 1.5, {"type": "move", "src": f"t{i}", "n": open_n, "dst": f"t{j}"}))
                        break
                if base[0] == "K" and empty:
                    moves.append((1.2 - down[i] / 10, {"type": "move", "src": f"t{i}", "n": open_n, "dst": f"t{empty[0]}"}))
                if open_n == 1 and home(col[-1]):
                    moves.append((1.1 - down[i] / 10, {"type": "move", "src": f"t{i}", "n": 1, "dst": "f"}))
        # part of a run moves off so the card under it can go home, or so the waste card fits under it
        king_waiting = (waste and waste[0] == "K") or any(down[i] and len(c) > down[i] and c[down[i]][0] == "K" for i, c in enumerate(cols))
        for i, col in enumerate(cols):
            for k in range(down[i] + 1, len(col)):
                under = col[k - 1]
                if home(under):
                    pri = 1.5
                elif waste and fits_on(waste, under) and level != "easy":
                    pri = 2.4
                else:
                    continue
                for j, dst in enumerate(cols):
                    if j != i and dst and fits_on(col[k], dst[-1]):
                        moves.append((pri, {"type": "move", "src": f"t{i}", "n": len(col) - k, "dst": f"t{j}"}))
                        break
            # empty a column that has no face-down cards when a king is waiting for it
            if not down[i] and col and col[0][0] != "K" and king_waiting and level != "easy":
                for j, dst in enumerate(cols):
                    if j != i and dst and fits_on(col[0], dst[-1]):
                        moves.append((1.3, {"type": "move", "src": f"t{i}", "n": len(col), "dst": f"t{j}"}))
                        break
        if waste:
            for j, dst in enumerate(cols):
                if dst and fits_on(waste, dst[-1]):
                    moves.append((2, {"type": "move", "src": "w", "n": 1, "dst": f"t{j}"}))
                    break
            if waste[0] == "K" and empty:
                moves.append((2.2, {"type": "move", "src": "w", "n": 1, "dst": f"t{empty[0]}"}))
            if home(waste):
                moves.append((2.5, {"type": "move", "src": "w", "n": 1, "dst": "f"}))
        # a card that's next for its foundation, when nothing better turned up
        for i, col in enumerate(cols):
            if len(col) > down[i] and home(col[-1]):
                moves.append((1.4 if level != "easy" else 3, {"type": "move", "src": f"t{i}", "n": 1, "dst": "f"}))
        # never undo the last move (a run shuffled back and forth between two columns)
        last = (st or {}).get("last")
        moves = [m for m in moves if not (last and m[1].get("src") == last[1] and m[1].get("dst") == last[0])]
        if not moves:
            return None
        moves.sort(key=lambda x: x[0])
        return moves[0][1]
