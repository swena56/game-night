"""Oware: the traditional West African mancala game (the common "abapa" rules), in the public domain.

Twelve pits, four seeds in each. Pits 0-5 are seat 0's row (left to right), 6-11 seat 1's (continuing
counter-clockwise). On your turn you lift every seed from one of your pits and sow them one by one
counter-clockwise, skipping the pit you emptied. If the last seed lands in a rival pit and makes it
2 or 3, you capture it, and the pits before it too while they are rival pits holding 2 or 3.
A capture that would take every rival seed captures nothing (grand slam). If your rival has no
seeds you must give them some; if you can't, you keep the seeds on your side and the game ends.
25 seeds wins; 24 each is a draw."""
from .base import Game, GameError
from .search import WIN, best_move
from .undo import Undo

QUIET_LIMIT = 80   # plies with no capture: the seeds left are endlessly circling, so each side keeps its own


def sow(pits, pit):
    """(new pits, last pit) after sowing from `pit`."""
    pits = list(pits)
    seeds, pits[pit], i = pits[pit], 0, pit
    while seeds:
        i = (i + 1) % 12
        if i == pit:
            continue
        pits[i] += 1
        seeds -= 1
    return pits, i


def side(seat):
    return range(0, 6) if seat == 0 else range(6, 12)


def apply(state, me, pit):
    """state = (pits, stores, quiet). Returns the new state; captures are scored here."""
    pits, stores, quiet = state
    new, last = sow(pits, pit)
    taken = []
    i = last
    while i in side(1 - me) and new[i] in (2, 3):
        taken.append(i)
        i -= 1
    if taken and sum(new[j] for j in side(1 - me)) == sum(new[j] for j in taken):
        taken = []  # grand slam: capturing everything captures nothing
    stores = list(stores)
    for j in taken:
        stores[me] += new[j]
        new[j] = 0
    return (tuple(new), tuple(stores), 0 if taken else quiet + 1)


def legal(state, me):
    pits, stores, quiet = state
    if max(stores) > 24 or stores == (24, 24) or quiet >= QUIET_LIMIT:
        return []
    mine = [p for p in side(me) if pits[p]]
    if sum(pits[j] for j in side(1 - me)) == 0:  # rival is empty: you must feed them
        mine = [p for p in mine if any(sow(pits, p)[0][j] for j in side(1 - me))]
    return mine


def final(state, me):
    """Stores when the game ends with `me` to move and no legal move: each side keeps its own seeds."""
    pits, stores, _ = state
    stores = list(stores)
    if max(stores) <= 24 and stores != [24, 24]:
        for s in (0, 1):
            stores[s] += sum(pits[j] for j in side(s))
    return stores


def evaluate(state, me):
    if not legal(state, me):
        st = final(state, me)
        return WIN if st[me] > st[1 - me] else -WIN if st[me] < st[1 - me] else 0
    pits, stores, _ = state
    score = (stores[me] - stores[1 - me]) * 10
    # seeds on your side are mobility; rival pits sitting on 1-2 seeds are capture chances
    score += sum(pits[j] for j in side(me)) - sum(pits[j] for j in side(1 - me))
    score += 2 * sum(1 for j in side(1 - me) if pits[j] in (1, 2)) - 2 * sum(1 for j in side(me) if pits[j] in (1, 2))
    return score


class Oware(Undo, Game):
    id = "oware"
    category = "strategy"
    howto = [
        "Your row is the bottom one; the seeds you capture go in your store on the right.",
        "Tap one of your pits: all its seeds are dropped one per pit, rightward along your row, then leftward along your rival's row and round again (skipping the pit you emptied).",
        "If your last seed lands in a rival pit and makes it 2 or 3, you capture those seeds, plus the rival pits just before it that now hold 2 or 3.",
        "With a mouse, point at a pit to see where its seeds would go and what it would capture.",
        "You can't capture every rival seed at once (that captures nothing). If your rival has no seeds, you must give them some.",
        "25 seeds wins. If nobody can capture any more, each side keeps the seeds in its row.",
        "↶ Undo asks your rival to take back your last move.",
    ]
    name = "Oware"
    icon = "🌰"
    blurb = "The traditional mancala game: sow seeds round the board and capture pits of 2 and 3."
    min_players = 2
    max_players = 2
    settings_schema = {}

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.state = ((4,) * 12, (0, 0), 0)
        self.last = None   # [pit, [captured pits], seeds sown]
        self.room.add_log(f"🌰 Oware! {seated[0].name} sows first.", "big")
        self.room.begin_turn(seated[0].id)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're watching this game.")
        if self.undo_act(p, a.get("type")):
            return
        if a.get("type") != "sow":
            raise GameError("Unknown action.")
        self.require_turn(p)
        pit = a.get("pit")
        if not isinstance(pit, int) or isinstance(pit, bool) or pit not in legal(self.state, self.seat(p)):
            raise GameError("Pick one of your pits with seeds (and feed your rival if they're empty).")
        self.sow(p, pit)

    def undo_state(self):
        return self.state, self.last

    def undo_restore(self, state):
        self.state, self.last = state

    def sow(self, p, pit):
        self.snapshot(p)
        me = self.seat(p)
        before = self.state[1][me]
        seeds = self.state[0][pit]
        new = apply(self.state, me, pit)
        took = new[1][me] - before
        sown, _ = sow(self.state[0], pit)
        captured = [j for j in side(1 - me) if sown[j] and not new[0][j]]
        self.state = new
        self.last = [pit, captured, seeds]  # the client replays the sowing from these
        num = pit + 1 if me == 0 else pit - 5
        self.room.add_log(f"🌰 {p.name} sows {seeds} from pit {num}" + (f" and captures {took}!" if took else "."),
                          "power" if took else "question")
        nxt = 1 - me
        if not legal(self.state, nxt):
            return self.end(nxt)
        self.room.begin_turn(self.seats[nxt])

    def end(self, to_move):
        st = final(self.state, to_move)
        if st != list(self.state[1]):  # the seeds left on the board went to their own sides
            self.state = ((0,) * 12, tuple(st), self.state[2])
        r = self.room
        names = [r.players[pid].name if pid in r.players else "?" for pid in self.seats]
        if st[0] == st[1]:
            return r.finish(None, f"🤝 A draw, {st[0]}–{st[1]}.")
        w = 0 if st[0] > st[1] else 1
        r.finish(r.players.get(self.seats[w]), f"🏆 {names[w]} wins Oware, {st[w]}–{st[1 - w]}!")

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🌰 {self.state[1][i]}"

    def final_scores(self):
        return {pid: self.state[1][i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        i = self.seat(p)
        mine = self.room.turn == p.id
        return {"oware": {
            "pits": self.state[0], "stores": self.state[1], "seats": self.seats,
            "me": i, "last": self.last,
            "legal": legal(self.state, i) if mine and i is not None else [],
            "undo": self.undo_view(p),
        }}

    def bot_turn(self, p):
        me = self.seat(p)
        depth, budget, noise = {"easy": (1, 0.3, 25), "normal": (4, 1.0, 4), "hard": (9, 2.5, 0)}[p.bot]
        pit = best_move(self.state, me, legal, apply, evaluate, depth, budget, self.rng, noise)
        self.sow(p, pit)
