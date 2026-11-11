"""FreeCell, the traditional open patience: all 52 cards dealt face up to eight columns, four free cells
and four foundations built up by suit from the ace. Raced: everyone plays the same deal (games/patience.py).

Bots solve the deal: a greedy best-first search over whole-sequence moves with a time budget set by the
bot's level, then they play the plan out at a human pace. A bot whose search runs out of time plays the
best-looking move it can find and calls it a day when it's stuck."""
import heapq
import time

from .base import GameError
from .patience import SUITS, Patience, fits_on, rank, red, run_ok

FOUND = {s: i for i, s in enumerate(SUITS)}
SOLVE_SECS = {"easy": 0.03, "normal": 0.4, "hard": 1.8}   # easy bots barely plan ahead
GREEDY_SLIP = {"easy": 0.25, "normal": 0.1, "hard": 0.0}   # chance the fallback picks a random move


def capacity(cells_free, empty_cols, to_empty):
    """How many cards can move as one sequence (the free cells and empty columns used as stepping stones)."""
    return (1 + cells_free) * 2 ** max(0, empty_cols - (1 if to_empty else 0))


def safe_home(card, f):
    """A card that no tableau move could still need: aces and twos, or once both other-colour
    foundations have reached the rank below it."""
    r = rank(card)
    if f[card[1]] != r - 1:
        return False
    if r <= 2:
        return True
    other = "SC" if red(card) else "HD"
    return all(f[s] >= r - 1 for s in other)


# -- the solver works on tuples: cols (8 tuples), cells (4 slots, None for empty), f (4 ints, SUITS order)

def _key(cols, cells, f):
    return (tuple(sorted(cols)), tuple(sorted(c for c in cells if c)), f)


def _home(f, card):
    return f[FOUND[card[1]]] == rank(card) - 1


def _safe(f, card):
    r = rank(card)
    if not _home(f, card):
        return False
    if r <= 2:
        return True
    other = "SC" if red(card) else "HD"
    return all(f[FOUND[s]] >= r - 1 for s in other)


def _auto(cols, cells, f, moves):
    """Send every safe card home (as the server does after each move), recording the moves."""
    cols, cells, f = list(cols), list(cells), list(f)
    changed = True
    while changed:
        changed = False
        for i, c in enumerate(cells):
            if c and _safe(f, c):
                f[FOUND[c[1]]] += 1
                cells[i] = None
                moves.append((f"c{i}", 1, "f", c))
                changed = True
        for i, col in enumerate(cols):
            if col and _safe(f, col[-1]):
                c = col[-1]
                f[FOUND[c[1]]] += 1
                cols[i] = col[:-1]
                moves.append((f"t{i}", 1, "f", c))
                changed = True
    return tuple(cols), tuple(cells), tuple(f)


def _score(cols, cells, f):
    """Lower is better: cards still out, buried low cards, full cells; empty columns help."""
    home = sum(f)
    blocked = 0
    empty = 0
    for col in cols:
        if not col:
            empty += 1
            continue
        lo = 99
        for c in col:
            r = rank(c)
            if r > lo:
                blocked += 1
            lo = min(lo, r)
        # the card each foundation needs next: how deep it's buried
    need = 0
    for col in cols:
        for depth, c in enumerate(reversed(col)):
            if _home(f, c):
                need += depth
    used = sum(1 for c in cells if c)
    return 3 * (52 - home) + 2 * blocked + need + used - 2 * empty


def _moves(cols, cells, f):
    free = [i for i, c in enumerate(cells) if not c]
    empties = [i for i, col in enumerate(cols) if not col]
    out = []
    # home first
    for i, c in enumerate(cells):
        if c and _home(f, c):
            out.append((f"c{i}", 1, "f", c))
    for i, col in enumerate(cols):
        if col and _home(f, col[-1]):
            out.append((f"t{i}", 1, "f", col[-1]))
    # cells down to columns
    for i, c in enumerate(cells):
        if not c:
            continue
        for j, col in enumerate(cols):
            if col and fits_on(c, col[-1]):
                out.append((f"c{i}", 1, f"t{j}", c))
        if empties:
            out.append((f"c{i}", 1, f"t{empties[0]}", c))
    # sequences between columns
    for i, col in enumerate(cols):
        if not col:
            continue
        run = 1
        while run < len(col) and fits_on(col[-run], col[-run - 1]):
            run += 1
        for j, dst in enumerate(cols):
            if i == j or not dst:
                continue
            top = dst[-1]
            for n in range(1, run + 1):
                if fits_on(col[-n], top):
                    if n <= capacity(len(free), len(empties), False):
                        out.append((f"t{i}", n, f"t{j}", col[-n]))
                    break
        if empties and len(col) > 1:
            cap = capacity(len(free), len(empties), True)
            n = min(run, cap)
            if n < len(col):
                out.append((f"t{i}", n, f"t{empties[0]}", col[-n]))
                if n > 1:
                    out.append((f"t{i}", 1, f"t{empties[0]}", col[-1]))
        if free:
            out.append((f"t{i}", 1, f"c{free[0]}", col[-1]))
    return out


def _apply(cols, cells, f, mv):
    src, n, dst, _ = mv
    cols, cells, f = list(cols), list(cells), list(f)
    if src[0] == "c":
        i = int(src[1:])
        moving = (cells[i],)
        cells[i] = None
    else:
        i = int(src[1:])
        moving = cols[i][-n:]
        cols[i] = cols[i][:-n]
    if dst == "f":
        f[FOUND[moving[0][1]]] += 1
    elif dst[0] == "c":
        cells[int(dst[1:])] = moving[0]
    else:
        j = int(dst[1:])
        cols[j] = cols[j] + tuple(moving)
    return tuple(cols), tuple(cells), tuple(f)


def solve(b, secs, max_nodes=60000):
    """A list of moves (src, n, dst, card) that clears board `b`, or None if the search ran out of time."""
    cols = tuple(tuple(c) for c in b["t"])
    cells = tuple(b["c"])
    f = tuple(b["f"][s] for s in SUITS)
    pre = []
    cols, cells, f = _auto(cols, cells, f, pre)
    start = (cols, cells, f)
    seen = {_key(*start): None}
    parent = {}
    heap = [(_score(*start), 0, start)]
    tick = 0
    stop = time.time() + secs
    while heap and tick < max_nodes:
        tick += 1
        if tick % 128 == 0 and time.time() > stop:
            return None
        _, _, st = heapq.heappop(heap)
        if sum(st[2]) == 52:
            path = []
            k = _key(*st)
            while parent.get(k):
                pk, mvs = parent[k]
                path[:0] = mvs
                k = pk
            return pre + path
        k0 = _key(*st)
        for mv in _moves(*st):
            nxt = _apply(*st, mv)
            autos = []
            nxt = _auto(*nxt, autos)
            k = _key(*nxt)
            if k in seen:
                continue
            seen[k] = 1
            parent[k] = (k0, [mv] + autos)
            heapq.heappush(heap, (_score(*nxt), tick * 64 + len(heap) % 64, nxt))
    return None


class FreeCell(Patience):
    id = "freecell"
    name = "FreeCell"
    icon = "🗃️"
    blurb = "The open patience: every card face up, four free cells, and nearly every deal can be won. Raced on the same deal."
    howto = [
        "Build the four foundations up by suit, ace to king. All 52 cards start face up in eight columns.",
        "Move a column's top card onto a card one higher of the other colour, into a free cell (one card each), or into an empty column.",
        "A run moves in one go when there's room for it: (free cells + 1), doubled for each empty column. Safe cards fly home on their own.",
        "Everyone plays the same deal at once: 1 point per card home, +10 for clearing it, +5 for clearing it first.",
        "Drag, or tap a card then tap where it goes; double-tap sends a card home. ↩ undo is free, 💡 costs a point, 🏳️ ends your deal.",
    ]
    settings_schema = {
        "rounds": ("Deals", [(1, "1"), (3, "3")], 1),
        "secs": ("Time per deal", [(480, "8 min"), (300, "5 min"), (720, "12 min")], 480),
        "daily": ("Deals", [(False, "🎲 Random"), (True, "📅 Today's deals (the same everywhere)")], False),
        "automove": ("Safe cards", [(True, "Fly home on their own"), (False, "Stay until I move them")], True),
    }
    BOT = {"easy": 3.4, "normal": 2.6, "hard": 1.6}   # seconds per move
    badges = {**Patience.badges, "nocell": ("🧊", "Cold cells", "Clear a FreeCell deal without using a free cell")}

    def deal_board(self, rng):
        deck = [r + s for s in SUITS for r in "A23456789TJQK"]
        rng.shuffle(deck)
        cols = [[] for _ in range(8)]
        for i, c in enumerate(deck):
            cols[i % 8].append(c)
        b = {"t": cols, "c": [None] * 4, "f": {s: 0 for s in SUITS}}
        if self.s.get("automove", True):
            self.fly_home(b)    # an ace dealt on top goes straight home
        return b

    # -- rules

    def take(self, b, src, n):
        """The cards a move would lift from `src` (validated), without lifting them."""
        if not isinstance(src, str) or len(src) != 2 or src[0] not in "tc" or not src[1].isdigit():
            raise GameError("Pick a card to move.")
        i = int(src[1])
        if src[0] == "c":
            if i > 3 or not b["c"][i]:
                raise GameError("That free cell is empty.")
            if n != 1:
                raise GameError("A free cell holds one card.")
            return [b["c"][i]]
        if i > 7 or not b["t"][i]:
            raise GameError("That column is empty.")
        col = b["t"][i]
        if not 1 <= n <= len(col):
            raise GameError("That's not a card in the column.")
        cards = col[-n:]
        if not run_ok(cards):
            raise GameError("Only a run (down by one, alternating colours) moves together.")
        return cards

    def apply(self, b, a):
        kind = a.get("type")
        if kind != "move":
            raise GameError("Unknown action.")
        src, dst, n = a.get("src"), a.get("dst"), a.get("n", 1)
        if not isinstance(n, int) or isinstance(n, bool):
            raise GameError("Pick a card to move.")
        cards = self.take(b, src, n)
        if not isinstance(dst, str) or not dst or dst[0] not in "tcf":
            raise GameError("Drop it on a column, a free cell or a foundation.")
        if dst == "f":
            c = cards[0]
            if n != 1 or b["f"][c[1]] != rank(c) - 1:
                raise GameError(f"The {c[1]} foundation needs a {'A23456789TJQK'[b['f'][c[1]]] if b['f'][c[1]] < 13 else '—'} next.")
            b["f"][c[1]] += 1
        elif dst[0] == "c":
            free = [i for i, x in enumerate(b["c"]) if not x]
            if n != 1:
                raise GameError("A free cell holds one card.")
            if dst == "c":
                if not free:
                    raise GameError("The free cells are full.")
                j = free[0]
            else:
                if len(dst) != 2 or not dst[1].isdigit() or int(dst[1]) > 3:
                    raise GameError("No such free cell.")
                j = int(dst[1])
                if b["c"][j]:
                    raise GameError("That free cell is taken.")
            if src[0] == "c" and int(src[1]) == j:
                raise GameError("It's already there.")
            b["c"][j] = cards[0]
        else:
            if len(dst) != 2 or not dst[1].isdigit() or int(dst[1]) > 7:
                raise GameError("No such column.")
            j = int(dst[1])
            if src == dst:
                raise GameError("It's already there.")
            col = b["t"][j]
            if col and not fits_on(cards[0], col[-1]):
                raise GameError("It goes on a card one higher of the other colour.")
            free = sum(1 for x in b["c"] if not x)
            empty = sum(1 for k, x in enumerate(b["t"]) if not x and k != j)
            cap = capacity(free, empty + (0 if col else 1), not col)
            if n > cap:
                raise GameError(f"Room to move {cap} card{'s' if cap > 1 else ''} at once: free a cell or a column.")
            col.extend(cards)
        # lift
        i = int(src[1])
        if src[0] == "c":
            b["c"][i] = None
        else:
            del b["t"][i][-n:]
        if self.s.get("automove", True):
            self.fly_home(b)

    def fly_home(self, b):
        changed = True
        while changed:
            changed = False
            for i, c in enumerate(b["c"]):
                if c and safe_home(c, b["f"]):
                    b["f"][c[1]] += 1
                    b["c"][i] = None
                    changed = True
            for col in b["t"]:
                if col and safe_home(col[-1], b["f"]):
                    b["f"][col[-1][1]] += 1
                    col.pop()
                    changed = True

    def auto_moves(self, b):
        """⏫: everything that can go home, safe or not."""
        f = dict(b["f"])
        cells = list(b["c"])
        cols = [list(c) for c in b["t"]]
        seq = []
        changed = True
        while changed:
            changed = False
            for i, c in enumerate(cells):
                if c and f[c[1]] == rank(c) - 1:
                    seq.append({"type": "move", "src": f"c{i}", "n": 1, "dst": "f"})
                    f[c[1]] += 1
                    cells[i] = None
                    changed = True
            for i, col in enumerate(cols):
                if col and f[col[-1][1]] == rank(col[-1]) - 1:
                    seq.append({"type": "move", "src": f"t{i}", "n": 1, "dst": "f"})
                    f[col[-1][1]] += 1
                    col.pop()
                    changed = True
        return seq

    def do(self, p, a):
        if isinstance(a.get("dst"), str) and a["dst"][:1] == "c":
            self.cell_used = getattr(self, "cell_used", set()) | {p.id}
        super().do(p, a)

    def next_round(self):
        self.cell_used = set()
        super().next_round()

    def cleared_badges(self, p, b):
        if p.id not in getattr(self, "cell_used", set()):
            self.award(p, "nocell")

    # -- bots

    def bot_move(self, p, b):
        st = self.bot_state.setdefault(p.id, {})
        level = getattr(p, "bot", None) or "normal"
        plan = st.get("plan")
        if plan is None and not st.get("gave_up"):
            plan = solve(b, SOLVE_SECS.get(level, 0.4)) if SOLVE_SECS.get(level, 0.4) else None
            if plan is None:
                st["gave_up"] = True
            st["plan"] = plan
        while plan:
            src, n, dst, card = plan[0]
            here = (b["c"][int(src[1])] if src[0] == "c" else
                    (b["t"][int(src[1])][-n] if len(b["t"][int(src[1])]) >= n else None))
            if here != card:
                if dst == "f" and b["f"][card[1]] >= rank(card):   # it already flew home
                    plan.pop(0)
                    continue
                st.pop("plan", None)    # the board changed under the plan (an undo, an autopilot handover)
                st.pop("gave_up", None)
                return self.greedy(p, b, st)
            plan.pop(0)
            return {"type": "move", "src": src, "n": n, "dst": dst}
        if plan is not None and not plan:
            st.pop("plan", None)
        return self.greedy(p, b, st)

    def greedy(self, p, b, st):
        """No plan: the move whose result scores best, never returning to a position seen before."""
        cols = tuple(tuple(c) for c in b["t"])
        cells = tuple(b["c"])
        f = tuple(b["f"][s] for s in SUITS)
        seen = st.setdefault("seen", set())
        seen.add(_key(cols, cells, f))
        if len(seen) > 4000:
            return None
        options = []
        for mv in _moves(cols, cells, f):
            nxt = _apply(cols, cells, f, mv)
            k = _key(*nxt)
            if k in seen:
                continue
            options.append((_score(*_auto(*nxt, [])), mv))
        if not options:
            return None
        options.sort(key=lambda x: x[0])
        level = getattr(p, "bot", None) or "normal"
        pick = options[0][1]
        if len(options) > 1 and self.rng.random() < GREEDY_SLIP.get(level, 0.1):
            pick = self.rng.choice(options)[1]
        src, n, dst, _ = pick
        return {"type": "move", "src": src, "n": n, "dst": dst}
