"""Pub darts courses on the standard 20-segment board."""
import math
import time
from functools import lru_cache

from .base import GameError

NUMBERS = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)
TARGETS = (20, 19, 18, 17, 16, 15, 25)
# Radii relative to the outside of the double ring.
RADII = (6.35 / 170, 15.9 / 170, 99 / 170, 107 / 170, 162 / 170, 1)
MODES = {"301": "301", "501": "501", "cricket": "Cricket", "clock": "Around the Clock", "countup": "Count-Up"}
X01 = {"301": 301, "501": 501}
CLOCK_TARGETS = (*range(1, 21), 25)
COUNTUP_VISITS = 8
PAUSE = 0.85
VISIT_RECAP = 1.65
GRAB_TIME = 10      # a human has this long to pull their darts before they are collected for them
DART_ORIGIN = (1.04, -0.55)
SWIPE_PACE = 2.2
SCATTER = 1.0       # 0 turns off the hand's wobble (tests): fast flicks scatter more than steady throws


def hit_at(x, y):
    inner, outer, triple_in, triple_out, double_in, edge = RADII
    radius = math.hypot(x, y)
    if radius > edge:
        return 0, 0
    if radius <= outer:
        return 25, 2 if radius <= inner else 1
    step = math.tau / len(NUMBERS)
    number = NUMBERS[math.floor(math.atan2(x, y) / step + 0.5) % len(NUMBERS)]
    return number, 2 if radius >= double_in else 3 if triple_in <= radius <= triple_out else 1


def label(number, multiplier):
    if number == 25:
        return "Bull" if multiplier == 2 else "Outer bull"
    return f"{('', 'S', 'D', 'T')[multiplier]}{number}" if number else "Miss"


DOUBLES = ((25, 2), *((n, 2) for n in range(20, 0, -1)))
SETUP = tuple(sorted(
    [(n, m) for n in NUMBERS for m in (1, 2, 3)] + [(25, 1), (25, 2)],
    key=lambda hit: hit[0] * hit[1], reverse=True,
))


ANY_FINISH = tuple(sorted(
    [(n, m) for n in NUMBERS for m in (1, 2, 3)] + [(25, 1), (25, 2)],
    key=lambda hit: (hit[1] != 2, hit[1] == 3, -hit[0] * hit[1]),
))


@lru_cache(maxsize=1024)
def checkout(remaining, darts, double_out=True):
    """Find a legal finish, preferring direct doubles and high scoring setup darts.

    Without double-out any dart that reaches exactly zero finishes, so singles and triples count too.
    """
    if double_out:
        if not 2 <= remaining <= 60 * (darts - 1) + 50:
            return ()
        finishers = DOUBLES
    else:
        if not 1 <= remaining <= 60 * darts:
            return ()
        finishers = ANY_FINISH
    for hit in finishers:
        if hit[0] * hit[1] == remaining:
            return (hit,)
    if darts > 1:
        for hit in SETUP:
            rest = checkout(remaining - hit[0] * hit[1], darts - 1, double_out)
            if rest:
                return (hit, *rest)
    return ()


class DartMatch:
    def __init__(self, room, seats, rng, mode, double_out=False):
        self.room, self.seats, self.rng, self.mode = room, seats, rng, mode
        self.double_out = double_out
        self.points = [X01.get(mode, 0) for _ in seats]
        self.marks = [[0] * len(TARGETS) for _ in seats]
        self.visits_done = [0] * len(seats)
        self.visit = 0
        self.darts = []
        self.last_darts = []
        self.shot = None
        self.shot_id = 0
        self.ready_at = 0.0
        self.winner = None
        self.finishing = False
        self.grabbing = None            # the seat that must pull its darts before the next player goes
        room.add_log(f"🎯 Darts · {MODES[mode]}. Three darts per visit.", "big")
        self.begin(0)

    def __setstate__(self, state):
        self.__dict__.update(state)
        self.__dict__.setdefault("visits_done", [0] * len(self.seats))
        self.__dict__.setdefault("finishing", self.winner is not None)
        self.__dict__.setdefault("grabbing", None)
        self.__dict__.setdefault("double_out", True)   # games saved before the option always needed a double

    @property
    def solo(self):
        return len(self.seats) == 1

    def active(self):
        return [i for i, pid in enumerate(self.seats)
                if pid in self.room.players and not self.room.players[pid].eliminated]

    def begin(self, i, delay=0):
        self.visit += 1
        if self.darts:
            self.last_darts = self.darts
        self.darts = []
        self.visit_start = self.points[i]
        self.turn(i, delay)

    def turn(self, i, delay):
        room = self.room
        room.begin_turn(self.seats[i])
        self.ready_at = time.time() + delay
        if room.deadline:
            room.deadline += delay
        if room.players[self.seats[i]].bot:
            room.bot_at = max(room.bot_at, self.ready_at + 0.25)

    def advance(self, i, delay=0):
        active = self.active()
        if len(active) <= 1 and not self.solo:
            return self.finish(active[0] if active else None)
        if not active:
            return self.finish(None)
        if self.mode == "countup":
            if i in active:
                self.visits_done[i] += 1
            eligible = [j for j in active if self.visits_done[j] < COUNTUP_VISITS]
            if not eligible:
                return self.finish_later(self.countup_winner(active), delay)
            active = eligible
        self.begin(next((seat for seat in active if seat > i), active[0]), delay)

    def act(self, p, action):
        if action.get("type") == "grab":
            if self.grabbing is None or self.room.turn != p.id:
                raise GameError("No darts to grab.")
            return self.grab(self.grabbing)
        if action.get("type") != "throw":
            raise GameError("Unknown darts action.")
        if self.room.turn != p.id:
            raise GameError("It's not your turn.")
        if self.grabbing is not None:
            raise GameError("Grab your darts first.")
        dx, dy, vx, vy = (action.get(key) for key in ("dx", "dy", "vx", "vy"))
        if not all(type(v) in (int, float) and abs(v) <= limit
                   for v, limit in zip((dx, dy, vx, vy), (2.5, 3.2, 6, 6))):
            raise GameError("Bad swipe.")
        if dx > -0.05 or math.hypot(dx, dy) < 0.1:
            raise GameError("Swipe toward the board.")
        if time.time() < self.ready_at - 0.05:
            raise GameError("Wait for the dart to land.")
        x = DART_ORIGIN[0] + dx + 0.14 * (vx + SWIPE_PACE)
        y = DART_ORIGIN[1] + dy + 0.085 * vy
        pace = math.hypot(vx, vy)
        sigma = SCATTER * (0.03 + 0.012 * pace)
        self.throw(self.seats.index(p.id), x + self.rng.gauss(0, sigma), y + self.rng.gauss(0, sigma), pace=pace)

    def cricket_winner(self, active):
        high = max((self.points[i] for i in active), default=0)
        return next((i for i in active if self.points[i] == high and all(m == 3 for m in self.marks[i])), None)

    def countup_winner(self, active):
        best = max(self.points[i] for i in active)
        leaders = [i for i in active if self.points[i] == best]
        return leaders[0] if len(leaders) == 1 else None

    def next_number(self, i):
        done = self.points[i]
        return CLOCK_TARGETS[done] if done < len(CLOCK_TARGETS) else None

    def throw(self, i, x, y, pace=SWIPE_PACE):
        number, multiplier = hit_at(x, y)
        before = self.points[i]
        bust, winner, added_marks = False, None, 0
        if self.mode in X01:
            remaining = before - number * multiplier
            bust = remaining < 0 or (self.double_out and (remaining == 1 or (remaining == 0 and multiplier != 2)))
            self.points[i] = self.visit_start if bust else remaining
            if not bust and remaining == 0:
                winner = i
        elif self.mode == "cricket":
            active = self.active()
            if number in TARGETS:
                target = TARGETS.index(number)
                added_marks = min(3 - self.marks[i][target], multiplier)
                self.marks[i][target] += added_marks
                if any(j != i and self.marks[j][target] < 3 for j in active):
                    self.points[i] += (multiplier - added_marks) * number
            winner = self.cricket_winner([i, *(j for j in active if j != i)])
        elif self.mode == "clock":
            if number == self.next_number(i):
                self.points[i] += 1
                if self.next_number(i) is None:
                    winner = i
        else:
            self.points[i] += number * multiplier
        self.shot_id += 1
        self.shot = {
            "id": self.shot_id, "o": i, "x": x, "y": y, "pace": pace, "number": number,
            "multiplier": multiplier, "label": label(number, multiplier),
            "value": number * multiplier, "bust": bust, "win": winner == i,
            "marks": added_marks, "points": self.points[i], "gain": self.points[i] - before,
            "recap": VISIT_RECAP if len(self.darts) == 2 else 0,
        }
        self.darts.append(self.shot)
        delay = PAUSE + self.shot["recap"]
        player = self.room.players[self.seats[i]]
        result = " · Bust, visit score restored" if bust else " · Checkout!" if self.mode in X01 and winner == i else ""
        self.room.add_log(f"🎯 {player.name} hits {self.shot['label']}{result}.")
        if winner is not None:
            self.finish_later(winner, delay)
        elif bust or len(self.darts) == 3:
            if player.bot:
                self.advance(i, delay)
            else:
                self.collect(i, delay)
        else:
            self.turn(i, PAUSE)

    def collect(self, i, delay):
        """The visit is over: the player keeps the turn until they pull their darts (or the timer does it)."""
        self.grabbing = i
        self.ready_at = time.time() + delay
        self.room.deadline = self.ready_at + GRAB_TIME

    def grab(self, i):
        self.grabbing = None
        self.darts, self.last_darts = [], []
        self.advance(i)

    def finish_later(self, winner, delay):
        self.winner = winner
        self.finishing = True
        self.room.turn = None
        self.room.deadline = time.time() + delay

    def finish(self, winner):
        player = self.room.players.get(self.seats[winner]) if winner is not None else None
        name = MODES[self.mode]
        if player and self.solo:
            text = f"🎯 {player.name} finishes {name} in {self.visit} visits." if self.mode != "countup" \
                else f"🎯 {player.name} scores {self.points[0]} in {name}."
        elif player:
            text = f"🏆 {player.name} wins {name}!"
        elif self.active():
            text = f"🤝 {name} ends in a tie at {max(self.points[i] for i in self.active())} points."
        else:
            text = "Everyone left."
        self.room.finish(player, text)

    def timeout(self):
        if self.finishing:
            return self.finish(self.winner)
        if self.grabbing is not None:
            return self.grab(self.grabbing)
        if self.room.turn in self.seats:
            i = self.seats.index(self.room.turn)
            self.room.add_log(f"⏰ {self.room.players[self.seats[i]].name} ran out of time. Visit over.", "power")
            self.advance(i)

    def leave(self, p):
        p.eliminated = True
        active = self.active()
        if self.winner in active:
            return self.finish(self.winner)
        self.winner = None
        if self.grabbing == self.seats.index(p.id):
            self.grabbing, self.darts, self.last_darts = None, [], []
        if len(active) <= 1:
            return self.finish(active[0] if active else None)
        if self.finishing and self.mode == "countup":
            self.winner = self.countup_winner(active)
            return
        self.finishing = False
        if self.mode == "cricket":
            winner = self.cricket_winner(active)
            if winner is not None:
                return self.finish(winner)
        if self.room.turn == p.id or self.room.turn is None:
            self.advance(self.seats.index(p.id))

    def bot(self, p):
        i = self.seats.index(p.id)
        sigma = {"easy": 0.105, "normal": 0.065, "hard": 0.034}.get(p.bot, 0.065)
        number, multiplier = self.target(i, p.bot)
        x, y = self.point(number, multiplier)
        self.throw(i, x + self.rng.gauss(0, sigma), y + self.rng.gauss(0, sigma))

    def target(self, i, level):
        """The dart worth throwing next for seat i: a bot's choice, and the hint a player can ask for."""
        if self.mode in X01:
            remaining = self.points[i]
            route = checkout(remaining, 3 - len(self.darts), self.double_out)
            if route:
                number, multiplier = route[0]
            elif remaining <= 50:
                number = next(n for n in range(1, 21) if 2 <= remaining - n <= 40 and (remaining - n) % 2 == 0)
                multiplier = 1
            else:
                number, multiplier = 20, 3 if remaining > 70 and level != "easy" else 1
        elif self.mode == "clock":
            number, multiplier = self.next_number(i), 1
        elif self.mode == "countup":
            number, multiplier = 20, 1 if level == "easy" else 3
        else:
            open_targets = [n for n, marks in zip(TARGETS, self.marks[i]) if marks < 3]
            scoring = [n for n in TARGETS if any(
                j != i and self.marks[j][TARGETS.index(n)] < 3 for j in self.active()
            )]
            number = next(iter(open_targets or scoring), 20)
            if scoring and any(self.points[j] > self.points[i] for j in self.active()):
                number = next((n for n in scoring if n not in open_targets), number)
            multiplier = 2 if number == 25 else 3
        return number, multiplier

    @staticmethod
    def point(number, multiplier):
        inner, _, triple_in, triple_out, double_in, edge = RADII
        if number == 25:
            return 0, 0 if multiplier == 2 else inner * 1.75
        theta = math.tau * NUMBERS.index(number) / len(NUMBERS)
        radius = {1: 0.47, 2: (double_in + edge) / 2, 3: (triple_in + triple_out) / 2}[multiplier]
        return radius * math.sin(theta), radius * math.cos(theta)

    def view(self, p):
        next_seat = self.seats.index(self.room.turn) if self.room.turn in self.seats else None
        left = 3 - len(self.darts) if next_seat is not None else 0
        route = checkout(self.points[next_seat], left, self.double_out) if self.mode in X01 and left else ()
        hint = None
        if next_seat is not None and p.id in self.seats and next_seat == self.seats.index(p.id) and left:
            number, multiplier = self.target(next_seat, "hard")
            x, y = self.point(number, multiplier)
            hint = {"label": label(number, multiplier), "x": x, "y": y}
        return {
            "mode": self.mode, "title": MODES[self.mode], "x01": self.mode in X01,
            "nextNumbers": [self.next_number(i) for i in range(len(self.seats))] if self.mode == "clock" else None,
            "visitsDone": self.visits_done if self.mode == "countup" else None,
            "visitLimit": COUNTUP_VISITS if self.mode == "countup" else None,
            "seats": self.seats, "me": self.seats.index(p.id) if p.id in self.seats else None,
            "next": next_seat, "visit": self.visit, "darts": self.darts or self.last_darts, "shot": self.shot,
            "points": self.points, "marks": self.marks, "targets": TARGETS, "active": self.active(),
            "numbers": NUMBERS, "radii": RADII, "left": left,
            "dartOrigin": DART_ORIGIN, "swipePace": SWIPE_PACE,
            "checkout": [label(*hit) for hit in route],
            "doubleOut": self.double_out, "hint": hint,
            "grab": next_seat is not None and self.grabbing == next_seat,
            "grabIn": max(0.0, (self.room.deadline or 0) - time.time()) if self.grabbing is not None else 0,
            "readyIn": max(0.0, self.ready_at - time.time()),
        }
