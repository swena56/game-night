"""Backgammon: the traditional public-domain race game for two players.

Points are numbered 1–24 from White's side: White moves 24 → 1 and bears off from 1–6; Black moves
1 → 24 and bears off from 19–24. Roll two dice (doubles play four times). A checker may land on any
point not held by two or more enemy checkers; landing on a single enemy checker hits it to the bar,
and a player with a checker on the bar must enter it before anything else. Once all fifteen are home
you bear off. You must use as many dice as you can, and the larger die if only one can be played.
A win is 1 point, a gammon (loser bore nothing off) 2, a backgammon (…and still has a checker on the
bar or in the winner's home) 3. Matches are played to a points target. An optional doubling cube
multiplies the stakes: before rolling you may offer to double, and your rival takes (and owns the cube)
or drops (and loses at the current value)."""
import random
import time
from functools import lru_cache

from .base import Game, GameError

WHITE, BLACK = 1, -1
START = {24: 2, 13: 5, 8: 3, 6: 5}         # White's opening layout; Black mirrors it (point → 25 - point)
# roughly how many of the 36 rolls hit a blot at a given distance (for the bots)
SHOTS = {1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17, 7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3, 15: 1, 16: 1, 18: 1, 20: 1, 24: 1}


# A position is a tuple of 28 ints: [0] unused, [1..24] points (+White / −Black counts),
# [25] White's bar, [26] Black's bar, [27] packed borne-off counts (White + 16 × Black).

def new_position():
    pts = [0] * 28
    for p, n in START.items():
        pts[p] += n
        pts[25 - p] -= n
    return tuple(pts)


def bar(pos, side):
    return pos[25] if side == WHITE else pos[26]


def off(pos, side):
    return pos[27] % 16 if side == WHITE else pos[27] // 16


def home(point, side):
    return 1 <= point <= 6 if side == WHITE else 19 <= point <= 24


def all_home(pos, side):
    if bar(pos, side):
        return False
    return all(home(i, side) for i in range(1, 25) if pos[i] * side > 0)


def entry_point(side, die):
    return 25 - die if side == WHITE else die


def moves_for_die(pos, side, die):
    """Single legal moves (from, to) using one die; from 'bar' / to 'off' as strings."""
    out = []
    if bar(pos, side):
        to = entry_point(side, die)
        if pos[to] * side >= -1:
            out.append(("bar", to))
        return out
    bearing = all_home(pos, side)
    for i in range(1, 25):
        if pos[i] * side <= 0:
            continue
        to = i - die if side == WHITE else i + die
        if 1 <= to <= 24:
            if pos[to] * side >= -1:
                out.append((i, to))
        elif bearing:
            exact = (to == 0) if side == WHITE else (to == 25)
            # a higher die may bear off the farthest checker only
            farther = range(i + 1, 7) if side == WHITE else range(19, i)
            if exact or not any(pos[j] * side > 0 for j in farther):
                out.append((i, "off"))
    return out


def apply(pos, side, frm, to):
    p = list(pos)
    if frm == "bar":
        p[25 if side == WHITE else 26] -= 1
    else:
        p[frm] -= side
    if to == "off":
        p[27] += 1 if side == WHITE else 16
    else:
        if p[to] == -side:  # hit a blot
            p[to] = 0
            p[26 if side == WHITE else 25] += 1
        p[to] += side
    return tuple(p)


@lru_cache(maxsize=200000)
def max_len(pos, side, dice):
    """The most dice that can be played from here (dice: a sorted tuple)."""
    best = 0
    for d in set(dice):
        rest = list(dice)
        rest.remove(d)
        rest = tuple(rest)
        for frm, to in moves_for_die(pos, side, d):
            best = max(best, 1 + max_len(apply(pos, side, frm, to), side, rest))
            if best == len(dice):
                return best
    return best


def legal_moves(pos, side, dice, must_use_larger=True):
    """Legal next single moves [(from, to, die)] under the use-as-many-dice-as-possible rule."""
    dice = tuple(sorted(dice))
    need = max_len(pos, side, dice)
    if need == 0:
        return []
    out = []
    for d in sorted(set(dice), reverse=True):
        rest = list(dice)
        rest.remove(d)
        rest = tuple(rest)
        for frm, to in moves_for_die(pos, side, d):
            if 1 + max_len(apply(pos, side, frm, to), side, rest) == need:
                out.append((frm, to, d))
    # only one die can be played (from two different dice): it must be the larger if possible
    if must_use_larger and need == 1 and len(dice) == 2 and dice[0] != dice[1]:
        big = [m for m in out if m[2] == dice[1]]
        if big:
            out = big
    return out


def pips(pos, side):
    total = bar(pos, side) * 25
    for i in range(1, 25):
        if pos[i] * side > 0:
            total += pos[i] * side * (i if side == WHITE else 25 - i)
    return total


def finals(pos, side, dice):
    """Every distinct end-of-turn position reachable with a legal full move: {pos: [moves]}."""
    out = {}
    seen = set()

    def walk(p, remaining, path, first):
        key = (p, remaining)
        if key in seen:
            return
        seen.add(key)
        nxt = legal_moves(p, side, remaining, must_use_larger=first)
        if not nxt:
            out.setdefault(p, path)
            return
        for frm, to, d in nxt:
            rest = list(remaining)
            rest.remove(d)
            walk(apply(p, side, frm, to), tuple(sorted(rest)), path + [(frm, to, d)], False)

    walk(pos, tuple(sorted(dice)), [], True)
    return out


def contact(pos):
    """Can the two sides still hit each other? (False once it's a pure race.)"""
    white_back = 25 if pos[25] else max((i for i in range(1, 25) if pos[i] > 0), default=0)
    black_back = 0 if pos[26] else min((i for i in range(1, 25) if pos[i] < 0), default=25)
    return white_back > black_back


def race_eval(pos, side):
    """A pure race: pips, checkers off, and smooth bear-offs (gaps and tall stacks waste rolls)."""
    them = -side
    score = (pips(pos, them) - pips(pos, side)) * 1.2 + (off(pos, side) - off(pos, them)) * 4
    for i in range(1, 25):
        n = pos[i] * side
        if n > 3 and home(i, side):
            score -= (n - 3) * 0.6
    return score


def evaluate(pos, side, level):
    """Higher is better for `side`."""
    them = -side
    score = (pips(pos, them) - pips(pos, side)) * 1.0
    score += (off(pos, side) - off(pos, them)) * 6
    score += (bar(pos, them) - bar(pos, side)) * 12
    # points made, weighted toward our home board and a prime in front of their back checkers
    for i in range(1, 25):
        n = pos[i] * side
        homeish = (7 - i if side == WHITE else i - 18)  # 1..6 inside our home, larger = deeper
        if n >= 2:
            score += 2.0 + (1.6 if 1 <= homeish <= 6 else 0) * (1 if level != "easy" else 0.5)
        elif n == 1:
            # a blot: how many enemy rolls hit it, and how costly a hit is (farther along = worse)
            risk = 0
            for j in range(1, 25):
                if pos[j] * them > 0:
                    dist = (j - i) if them == WHITE else (i - j)  # White moves down, Black up
                    if dist > 0:
                        risk += SHOTS.get(dist, 0)
            if bar(pos, them):
                d = (25 - i) if them == WHITE else i
                risk += SHOTS.get(d, 0) if 1 <= d <= 6 else 0
            progress = (25 - i) if side == WHITE else i
            weight = 0.25 if level == "hard" else 0.12
            score -= min(36, risk) * weight * (0.5 + progress / 24)
    if level == "hard":
        made = [i for i in range(1, 25) if pos[i] * side >= 2]
        run = best = 0
        for i in range(1, 25):
            run = run + 1 if i in made else 0
            best = max(best, run)
        score += best * best * 0.8  # primes
        # an anchor (a made point in their home board) is a safe landing spot for our back checkers
        anchors = sum(1 for i in range(1, 25) if pos[i] * side >= 2 and home(i, them))
        score += min(anchors, 2) * 3.0
        # a hit checker of theirs facing a strong home board: each point we hold there may cost them a turn
        if bar(pos, them):
            closed = sum(1 for i in range(1, 25) if pos[i] * side >= 2 and home(i, side))
            score += bar(pos, them) * closed * closed * 0.45
        # tall stacks waste checkers that could be making points
        for i in range(1, 25):
            n = pos[i] * side
            if n > 4:
                score -= (n - 4) * 1.2
    return score


ROLLS = [((a, b), 1 if a == b else 2) for a in range(1, 7) for b in range(a, 7)]  # 21 distinct rolls, weighted


def lookahead(pos, side, candidates, budget=2.5):
    """Hard bot: for each candidate end position, average over every enemy roll of the enemy's best reply
    (scored from our side), and keep the candidate that holds up best."""
    start = time.time()
    best, best_val = candidates[0], -1e9
    for cand in candidates:
        total = 0.0
        for (a, b), w in ROLLS:
            dice = (a, a, a, a) if a == b else (a, b)
            replies = finals(cand, -side, dice)
            # the reply is judged with the plainer evaluation: it beat judging with the hard one 116–84
            worst = min((evaluate(rp, side, "normal") for rp in replies), default=evaluate(cand, side, "normal"))
            total += worst * w
        val = total / 36
        if val > best_val:
            best, best_val = cand, val
        if time.time() - start > budget:
            break
    return best


class Backgammon(Game):
    id = "backgammon"
    category = "strategy"
    howto = [
        "Move all fifteen checkers around and off the board. White moves 24 → 1, Black 1 → 24 (both shown heading to your bottom right).",
        "Each die is a move. Doubles play four times. Tap a checker, then where it goes. You can undo until you end your turn.",
        "Land on a lone enemy checker to hit it to the bar. A checker on the bar must come back in first.",
        "With all fifteen in your home board, bear them off. You must use as many dice as you can.",
        "Win 1 point, a gammon 2 (they bore none off), a backgammon 3. Play one game or a match.",
        "🎲 Doubling cube: before you roll, offer to double the stakes. Your rival takes (and may redouble later) or drops and loses now.",
    ]
    name = "Backgammon"
    icon = "🔺"
    blurb = "The ancient race game: run, hit, block and bear off all fifteen checkers before your rival."
    min_players = 2
    max_players = 2
    badges = {**Game.badges, "backgammon": ("🎯", "Backgammon!", "Win the deciding game with a backgammon")}
    settings_schema = {
        "match": ("Play", [(1, "One game"), (3, "Match to 3"), (5, "Match to 5")], 1),
        "cube": ("Doubling cube", [(True, "🎲 On"), (False, "Off")], True),
    }
    cube, owner, offer = 1, None, None  # stakes, who may double next (None = either), a double waiting
    crawford, crawford_done = False, False  # the one game after someone first reaches match point: no doubling

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.side = {seated[0].id: WHITE, seated[1].id: BLACK}
        self.ids = {WHITE: seated[0].id, BLACK: seated[1].id}
        self.points = {WHITE: 0, BLACK: 0}
        self.game_no = 0
        self.room.add_log(f"🎲 Backgammon! {seated[0].name} plays ⚪ White, {seated[1].name} plays ⚫ Black.", "big")
        self.new_game()

    def new_game(self):
        r = self.room
        self.game_no += 1
        self.pos = new_position()
        self.last_moves, self.plan = [], []
        self.cube, self.owner, self.offer = 1, None, None
        target = self.s["match"]
        self.crawford = target > 1 and not self.crawford_done and target - 1 in self.points.values()
        if self.crawford:
            self.crawford_done = True
            r.add_log("🎲 Crawford game: someone is one point from the match, so no doubling this game.")
        # opening roll: one die each, re-rolled on a tie; the higher plays both
        while True:
            a, b = self.rng.randint(1, 6), self.rng.randint(1, 6)
            if a != b:
                break
        first = WHITE if a > b else BLACK
        r.add_log(f"🎲 Game {self.game_no}: opening roll ⚪ {a} vs ⚫ {b}. {self.name_of(first)} starts with {max(a, b)}-{min(a, b)}.")
        self.begin(first, [a, b])

    def name_of(self, side):
        p = self.room.players.get(self.ids[side])
        return p.name if p else ("White" if side == WHITE else "Black")

    def begin(self, side, dice=None):
        self.turn_side = side
        self.rolled = list(dice) if dice else []
        self.dice = list(dice) if dice else []
        self.turn_start = self.pos
        self.turn_moves = []
        self.plan = []
        self.room.begin_turn(self.ids[side])

    # -- helpers

    def legal(self):
        if not self.rolled:
            return []
        return legal_moves(self.pos, self.turn_side, self.dice, must_use_larger=not self.turn_moves)

    # -- actions

    def act(self, p, a):
        if p.id not in self.side:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "double":
            return self.double()
        if t in ("take", "drop"):
            if self.offer != -self.side[p.id]:
                raise GameError("There's no double to answer.")
            return self.answer(t == "take")
        if self.offer:
            raise GameError("Take or drop the double first.")
        if t == "roll":
            return self.roll()
        if t == "move":
            frm, to = a.get("from"), a.get("to")
            return self.move(frm, to)
        if t == "undo":
            if not self.turn_moves:
                raise GameError("Nothing to undo.")
            self.pos, self.dice, self.turn_moves = self.turn_start, list(self.rolled), []
            return
        if t == "end":
            if not self.rolled:
                raise GameError("Roll first.")
            if self.legal():
                raise GameError("You still have a move to make.")
            return self.end_turn()
        raise GameError("Unknown action.")

    # -- the doubling cube

    def can_double(self):
        return (bool(self.s.get("cube")) and not self.crawford and not self.rolled and not self.offer and self.cube < 64
                and self.owner in (None, self.turn_side) and self.room.phase == "playing")

    def double(self):
        if not self.can_double():
            raise GameError("You can't double right now.")
        self.offer = self.turn_side
        self.room.add_log(f"🎲 {self.name_of(self.turn_side)} doubles: the game is now worth {self.cube * 2}. Take or drop?", "power")
        self.room.begin_turn(self.ids[-self.turn_side])

    def answer(self, take):
        side = -self.offer
        self.offer = None
        if not take:
            self.room.add_log(f"🏳️ {self.name_of(side)} drops the double.", "power")
            return self.win(-side, dropped=True)
        self.cube *= 2
        self.owner = side
        self.room.add_log(f"✋ {self.name_of(side)} takes: the cube is at {self.cube}.", "power")
        self.room.begin_turn(self.ids[self.turn_side])

    def cube_call(self, side, level, offered):
        """A bot's doubling decisions, from the race: double with a clear lead, take unless far behind."""
        mine, theirs = pips(self.pos, side), pips(self.pos, -side)
        if offered:  # take or drop
            return level == "easy" or mine <= theirs * (1.2 if level == "hard" else 1.25)
        return level != "easy" and mine <= theirs * (0.9 if level == "hard" else 0.85)

    def roll(self):
        if self.rolled:
            raise GameError("You've already rolled.")
        d1, d2 = self.rng.randint(1, 6), self.rng.randint(1, 6)
        self.rolled = [d1, d2] * (2 if d1 == d2 else 1)
        self.dice = list(self.rolled)
        self.room.add_log(f"🎲 {self.name_of(self.turn_side)} rolls {d1}-{d2}{' (doubles!)' if d1 == d2 else ''}.")
        if not self.legal():
            self.room.add_log(f"🚫 {self.name_of(self.turn_side)} can't move.", "power")

    def move(self, frm, to):
        if isinstance(frm, bool) or isinstance(to, bool):
            raise GameError("Bad move.")
        match = [m for m in self.legal() if m[0] == frm and m[1] == to]
        if not match:
            raise GameError("That move isn't allowed.")
        frm, to, die = match[0]
        side = self.turn_side
        hit = to != "off" and self.pos[to] == -side
        self.pos = apply(self.pos, side, frm, to)
        self.dice.remove(die)
        self.turn_moves.append([frm, to, die, hit])
        if off(self.pos, side) == 15:
            return self.win(side)

    def end_turn(self):
        side = self.turn_side
        if self.turn_moves:
            desc = " ".join(f"{self.label(f, side)}/{self.label(t, side)}{'*' if h else ''}" for f, t, _, h in self.turn_moves)
            self.room.add_log(f"{'⚪' if side == WHITE else '⚫'} {self.name_of(side)}: {desc}",
                              "question" if any(m[3] for m in self.turn_moves) else "info")
        self.last_moves = self.turn_moves
        self.begin(-side)

    def label(self, x, side):
        """Point numbers as the mover counts them (each side numbers its own home 1–6)."""
        if x == "bar":
            return "bar"
        if x == "off":
            return "off"
        return str(x if side == WHITE else 25 - x)

    def win(self, side, dropped=False):
        r = self.room
        loser = -side
        pts = 1
        kind = ""
        if dropped:
            pts, kind = self.cube, " a dropped double"
        elif off(self.pos, loser) == 0:
            pts, kind = 2, " a gammon"
            back = bar(self.pos, loser) or any(self.pos[i] * loser > 0 and home(i, side) for i in range(1, 25))
            if back:
                pts, kind = 3, " a backgammon"
        if not dropped:
            pts *= self.cube
        self.points[side] += pts
        self.last_moves = self.turn_moves
        how = "wins as the double is dropped" if dropped else "bears off the last checker"
        cubed = f" (cube ×{self.cube})" if self.cube > 1 and not dropped else ""
        r.add_log(f"🏁 {self.name_of(side)} {how}:{'' if dropped else kind or ' a win'}{cubed}, {pts} point{'s' * (pts > 1)}!", "big")
        target = self.s["match"]
        if self.points[side] >= target:
            w = r.players.get(self.ids[side])
            if pts >= 3 and not dropped:
                self.award(w, "backgammon")
            score = f" ({self.points[WHITE]}–{self.points[BLACK]})" if target > 1 else ""
            return r.finish(w, f"🏆 {self.name_of(side)} wins Backgammon{kind and ' with' + kind}{score}!")
        r.add_log(f"📊 Match score: ⚪ {self.points[WHITE]} – ⚫ {self.points[BLACK]} (to {target}).")
        self.new_game()

    def on_timeout(self):
        r = self.room
        if self.offer:
            r.add_log(f"⏰ {self.name_of(-self.offer)} ran out of time and takes the double.", "power")
            return self.answer(True)
        r.add_log(f"⏰ {self.name_of(self.turn_side)} ran out of time; the moves were played for them.", "power")
        if not self.rolled:
            self.roll()
        while self.legal() and r.phase == "playing":
            frm, to, _ = self.legal()[0]
            self.move(frm, to)
        if r.phase == "playing":
            self.end_turn()

    # -- what each player sees

    def meta(self, p):
        if not hasattr(self, "side") or p.id not in self.side:
            return ""
        s = self.side[p.id]
        bits = ["⚪" if s == WHITE else "⚫", f"{pips(self.pos, s)} pips"]
        if self.s["match"] > 1:
            bits.append(f"{self.points[s]} pts")
        if self.cube > 1 and self.owner == s:
            bits.append(f"🎲 {self.cube}")
        return " · ".join(bits)

    def final_scores(self):
        return {self.ids[s]: self.points[s] for s in (WHITE, BLACK)}

    def view(self, p):
        mine = self.side.get(p.id)
        legal = self.legal() if p.id == self.room.turn else []
        return {"backgammon": {
            "points": list(self.pos[1:25]), "bar": {"w": bar(self.pos, WHITE), "b": bar(self.pos, BLACK)},
            "off": {"w": off(self.pos, WHITE), "b": off(self.pos, BLACK)},
            "me": "w" if mine == WHITE else "b" if mine == BLACK else None,
            "turn": "w" if self.turn_side == WHITE else "b",
            "rolled": self.rolled, "dice": self.dice, "moves": self.turn_moves, "last": self.last_moves,
            "legal": [[f, t] for f, t, _ in legal], "canEnd": bool(self.rolled) and not legal,
            "pips": {"w": pips(self.pos, WHITE), "b": pips(self.pos, BLACK)},
            "match": self.s["match"], "score": {"w": self.points[WHITE], "b": self.points[BLACK]}, "game": self.game_no,
            "names": {"w": self.ids[WHITE], "b": self.ids[BLACK]},
            "cube": self.cube, "owner": {WHITE: "w", BLACK: "b"}.get(self.owner),
            "offer": {WHITE: "w", BLACK: "b"}.get(self.offer), "canDouble": self.can_double() and p.id == self.room.turn,
            "cubeOn": bool(self.s.get("cube")), "crawford": self.crawford,
        }}

    # -- bots: pick the best end-of-turn position, then play it one checker at a time

    def bot_turn(self, p):
        r = self.room
        side = self.side[p.id]
        if self.offer:
            return self.answer(self.cube_call(side, p.bot, True))
        if self.can_double() and self.cube_call(side, p.bot, False):
            return self.double()
        if not self.rolled:
            self.roll()
            r.bot_at = time.time() + 0.8
            return
        if not self.plan:
            ends = finals(self.pos, self.turn_side, self.dice)
            if p.bot == "easy" and random.random() < 0.5:
                self.plan = list(random.choice(list(ends.values()))) if ends else []
            elif ends:
                level = p.bot
                ranked = sorted(ends, key=lambda e: evaluate(e, self.turn_side, level) + random.uniform(0, 0.01), reverse=True)
                if level == "hard" and not contact(self.pos):  # a pure race: just bear in and off efficiently
                    pick = max(ends, key=lambda e: race_eval(e, self.turn_side))
                elif level == "hard" and len(ranked) > 1:
                    pick = lookahead(self.pos, self.turn_side, ranked[:4])
                elif level == "normal" and len(ranked) > 1 and random.random() < 0.3:
                    pick = ranked[1]  # a decent casual player: sometimes the second-best play
                else:
                    pick = ranked[0]
                self.plan = list(ends[pick])
        if self.plan:
            frm, to, _ = self.plan.pop(0)
            self.move(frm, to)
            r.bot_at = time.time() + 0.45
            return
        if r.phase == "playing":
            self.end_turn()
