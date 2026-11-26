"""Pub darts courses on the standard 20-segment board."""
import math
import time
from collections import Counter
from statistics import NormalDist
from functools import lru_cache

from .base import GameError

NUMBERS = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)
TARGETS = (20, 19, 18, 17, 16, 15, 25)
# Radii relative to the outside of the double ring.
RADII = (6.35 / 170, 15.9 / 170, 99 / 170, 107 / 170, 162 / 170, 1)
MODES = {"301": "301", "501": "501", "cricket": "Cricket", "clock": "Around the Clock", "countup": "Count-Up", "axe": "Axe Throwing"}
FIXED_VISITS = ("countup", "axe")
AXE_LODGED_ANGLE = 38
AXE_STICK_ANGLE = 30
# Keep the successful release calibration across the change to a forward-only axis.
AXE_WINDUP_MS = 153
AXE_SPIN = {
    "referenceSpeed": 3.5,
    "referenceRate": (360 - AXE_LODGED_ANGLE) / 0.533,
    "rateGain": 51,
    "airBaseMs": 620,
    "airMinMs": 470,
    "airMsPerSpeed": 25,
}

AXE_POSITION_LIMIT = 125 / 98
AXE_RINGS = tuple(zip((0.2, 0.4, 0.6, 0.8, 1.0), (5, 4, 3, 2, 1)))


AXE_CORNER_RINGS = ((0.2, 5), (0.6, 3), (1.0, 1))
AXE_CORNERS = ((-0.64, 0.64, 0.09), (0.64, 0.64, 0.09))


def axe_flight(drive):
    air_ms = math.floor(max(AXE_SPIN["airMinMs"], AXE_SPIN["airBaseMs"] - drive * AXE_SPIN["airMsPerSpeed"]) + 0.5)
    rate = AXE_SPIN["referenceRate"] + AXE_SPIN["rateGain"] * (drive - AXE_SPIN["referenceSpeed"])
    return air_ms, rate, rate * air_ms / 1000

def axe_hit(x, y, rings=AXE_RINGS):
    radius = math.hypot(x, y)
    return next((points for edge, points in rings if radius <= edge), 0)


def axe_label(points):
    return f"{points}-point ring" if points else "Miss"

X01 = {"301": 301, "501": 501}
CLOCK_TARGETS = (*range(1, 21), 25)
COUNTUP_VISITS = 8
AXES_PER_ROUND = 5
PAUSE = 0.85
VISIT_RECAP = 1.65
ROUND_LOOK = 4.0   # the round's darts stay up this much longer before they're pulled, for a look at the board (#279)
DART_ORIGIN = (1.04, -0.55)
SWIPE_PACE = 2.2
SCATTER = 1.0       # 0 turns off the hand's wobble (tests): fast flicks scatter more than steady throws


def spread(pace):
    """Standard deviation of the wobble, in board radii: a steady swipe is tight, a rushed flick strays."""
    return 0.03 + 0.012 * pace


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
        shorter = checkout(remaining, darts - 1, double_out)
        if shorter:
            return shorter
        for hit in SETUP:
            rest = checkout(remaining - hit[0] * hit[1], darts - 1, double_out)
            if rest:
                return (hit, *rest)
    return ()


# Midpoint quantiles give a deterministic approximation of the same independent
# Gaussian axes used for actual throws. The chooser never consumes match RNG.
QUANTILES = tuple(NormalDist().inv_cdf((i + 0.5) / 19) for i in range(19))
BOT_SPREAD_MULTIPLIER = {"easy": 2.4, "normal": 1.45, "hard": 0.8}


@lru_cache(maxsize=16)
def aim_outcomes(sigma):
    candidates = []
    for number, multiplier in SETUP:
        x, y = DartMatch.point(number, multiplier)
        candidates.append((x, y))
        if number != 25 and multiplier == 1:
            # The outer single trades a narrower radial margin for a wider wedge.
            candidates.append((x * 0.75 / 0.47, y * 0.75 / 0.47))
    results = []
    for x, y in candidates:
        hits = Counter(hit_at(x + sigma * a, y + sigma * b) for a in QUANTILES for b in QUANTILES)
        results.append((x, y, tuple((hit, count / len(QUANTILES) ** 2) for hit, count in hits.items())))
    return tuple(results)


def x01_result(remaining, hit, double_out):
    number, multiplier = hit
    after = remaining - number * multiplier
    if after < 0 or (double_out and (after == 1 or (after == 0 and multiplier != 2))):
        return None
    return after


@lru_cache(maxsize=8192)
def x01_choice(remaining, darts, visit_start, double_out, sigma):
    """Minimize estimated darts to finish, looking ahead through the current visit."""
    candidates = aim_outcomes(sigma)
    scoring_rate = max(sum(n * m * p for (n, m), p in outcomes) for _, _, outcomes in candidates)
    @lru_cache(maxsize=None)
    def tail(score):
        # Beyond the current visit, estimate the scoring phase and then the finish.
        direct = max(sum(p for (n, m), p in outcomes
                         if n * m == score and (not double_out or m == 2))
                     for _, _, outcomes in candidates)
        # Allow for setup when repeatedly attempting the direct finish is costly.
        return min(1 / direct if direct else math.inf,
                   2.8 + max(0, score - (40 if double_out else 20)) / scoring_rate)

    @lru_cache(maxsize=None)
    def best(score, left):
        costs = {}
        for hit in SETUP + ((0, 0),):
            after = x01_result(score, hit, double_out)
            if after is None:
                costs[hit] = tail(visit_start)
            elif after == 0:
                costs[hit] = 0
            else:
                costs[hit] = best(after, left - 1)[0] if left > 1 else tail(after)
        value, x, y = min(
            (sum(p * costs[hit] for hit, p in outcomes), x, y)
            for x, y, outcomes in candidates
        )
        return 1 + value, x, y

    return best(remaining, darts)[1:]


class DartMatch:
    def __init__(self, room, seats, rng, mode, double_out=False, aim_control=False, axe_scoring=None):
        self.room, self.seats, self.rng, self.mode = room, seats, rng, mode
        self.double_out = double_out
        self.aim_control = aim_control
        self.axe_scoring = axe_scoring
        self.points = [X01.get(mode, 0) for _ in seats]
        self.marks = [[0] * len(TARGETS) for _ in seats]
        self.visits_done = [0] * len(seats)
        self.visit = 0
        self.darts = []
        self.last_darts = []             # completed visits still on the board this round
        self.completed_visit = None
        self.shot = None
        self.shot_id = 0
        self.ready_at = 0.0
        self.winner = None
        self.finishing = False
        self.grabbing = None            # seat whose round recap is pending
        self.axe_round_throws = [0] * len(seats) if mode == "axe" else None
        rules = "Five axes per player each round, alternating throws." if mode == "axe" else "Three darts per visit."
        room.add_log(f"🎯 Darts · {MODES[mode]}. {rules}", "big")
        self.begin(0)

    def __setstate__(self, state):
        self.__dict__.update(state)
        self.__dict__.setdefault("visits_done", [0] * len(self.seats))
        self.__dict__.setdefault("finishing", self.winner is not None)
        self.__dict__.setdefault("grabbing", None)
        self.__dict__.setdefault("completed_visit", None)
        self.__dict__.setdefault("double_out", True)   # games saved before the option always needed a double

    @property
    def solo(self):
        return len(self.seats) == 1

    def active(self):
        return [i for i, pid in enumerate(self.seats)
                if pid in self.room.players and not self.room.players[pid].eliminated]

    def begin(self, i, delay=0):
        self.visit += 1
        self.last_darts.extend(self.darts)
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
        if self.mode in FIXED_VISITS:
            if i in active:
                self.visits_done[i] += 1
            eligible = [j for j in active if self.visits_done[j] < COUNTUP_VISITS]
            if not eligible:
                return self.finish_later(self.countup_winner(active), delay)
            active = eligible
        self.begin(next((seat for seat in active if seat > i), active[0]), delay)

    @property
    def corner_scoring(self):
        return self.mode == "axe" and getattr(self, "axe_scoring", None) == "corner"

    @property
    def alternating_axes(self):
        return getattr(self, "axe_round_throws", None) is not None

    def upgrade_axe_round(self):
        if (self.mode != "axe" or self.alternating_axes or self.finishing or self.grabbing is not None
                or self.darts or self.last_darts):
            return
        active = self.active()
        if (not active or self.room.turn != self.seats[active[0]]
                or len({self.visits_done[seat] for seat in active}) != 1):
            return
        self.axe_round_throws = [0] * len(self.seats)
        # A game played under both formats should not set a scoring record.
        self.room.record_interrupted = True

    def throws_left(self, seat):
        return AXES_PER_ROUND - self.axe_round_throws[seat] if self.alternating_axes else 3 - len(self.darts)

    def can_call_corner(self):
        return (self.corner_scoring and self.grabbing is None and self.room.turn in self.seats
                and self.throws_left(self.seats.index(self.room.turn)) == 1)

    def advance_axe_round(self, i, delay):
        active = self.active()
        eligible = [seat for seat in active if self.throws_left(seat)]
        if eligible:
            self.turn(next((seat for seat in eligible if seat > i), eligible[0]), delay)
            return
        for seat in active:
            self.visits_done[seat] += 1
        if not active or self.visits_done[active[0]] >= COUNTUP_VISITS:
            self.finish_later(self.countup_winner(active) if active else None, delay + VISIT_RECAP)
            return
        self.grabbing = i
        self.ready_at = time.time() + delay + VISIT_RECAP
        self.room.deadline = self.ready_at

    def act(self, p, action):
        if action.get("type") != "throw":
            raise GameError("Unknown darts action.")
        if self.room.turn != p.id:
            raise GameError("It's not your turn.")
        if self.grabbing is not None:
            raise GameError("Wait for the round recap.")
        dx, dy, vx, vy = (action.get(key) for key in ("dx", "dy", "vx", "vy"))
        if not all(type(v) in (int, float) and abs(v) <= limit
                   for v, limit in zip((dx, dy, vx, vy), (2.5, 3.2, 6, 6))):
            raise GameError("Bad swipe.")
        placed = action.get("axeOrigin") if self.mode == "axe" else None
        if placed is not None:
            if (not isinstance(placed, list) or len(placed) != 2
                    or any(type(axis) not in (int, float) or not abs(axis) <= AXE_POSITION_LIMIT for axis in placed)):
                raise GameError("Place the axe inside the board area.")
        elif dx > -0.05 or math.hypot(dx, dy) < 0.1:
            raise GameError("Swipe toward the board.")
        if time.time() < self.ready_at - 0.05:
            raise GameError("Wait for the throw to land.")
        call_corner = action.get("axeCorner", False)
        if type(call_corner) is not bool or (call_corner and not self.can_call_corner()):
            raise GameError("Call a corner on the final axe of your visit.")
        # The endpoint sets aim. Release speed sets scatter and drives axe spin.
        start_x, start_y = placed if placed is not None else DART_ORIGIN
        x, y = start_x + dx, start_y + dy
        pace = math.hypot(vx, vy)
        sigma = SCATTER * spread(pace)
        self.throw(self.seats.index(p.id), x + self.rng.gauss(0, sigma), y + self.rng.gauss(0, sigma),
                   pace=pace, spin_speed=pace or None, axe_origin=placed, call_corner=call_corner)

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

    def throw(self, i, x, y, pace=SWIPE_PACE, spin_speed=None, axe_origin=None, call_corner=False):
        number, multiplier = hit_at(x, y) if self.mode != "axe" else (axe_hit(x, y), 1)
        axe_result = {}
        corner_hit = False
        if self.corner_scoring:
            corner_hit = any(math.hypot(x - cx, y - cy) <= r for cx, cy, r in AXE_CORNERS)
            number = 7 if corner_hit else axe_hit(x, y, AXE_CORNER_RINGS)
        if self.mode == "axe":
            # Virtual release calibration. For a given impulse increment, higher inertia means less added spin.
            drive = AXE_SPIN["referenceSpeed"] if spin_speed is None else spin_speed
            air_ms, rate, turn = axe_flight(drive)
            impact_angle = turn - (360 - AXE_LODGED_ANGLE)
            bounce = bool(number and abs(impact_angle) > AXE_STICK_ANGLE)
            axe_result = {
                "axeAngle": impact_angle, "axeTurn": turn, "axeFlightMs": AXE_WINDUP_MS + air_ms,
                "axeWindupMs": AXE_WINDUP_MS, "axeSpinRate": rate, "axeSpinSpeed": drive, "axeBounce": bounce,
            }
            if axe_origin is not None:
                axe_result["axeOrigin"] = axe_origin
            if bounce:
                number, multiplier = 0, 0
        value = number * multiplier
        if self.corner_scoring and call_corner != corner_hit:
            value = 0
        before = self.points[i]
        bust, winner, added_marks = False, None, 0
        if self.mode in X01:
            remaining = x01_result(before, (number, multiplier), self.double_out)
            bust = remaining is None
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
            self.points[i] += value
        self.shot_id += 1
        self.shot = {
            "id": self.shot_id, "o": i, "x": x, "y": y, "pace": pace, "number": number,
            "multiplier": multiplier, "label": ("Under-rotated" if impact_angle < 0 else "Over-rotated") if axe_result.get("axeBounce")
            else "7-point corner" if value == 7 else "Corner uncalled" if corner_hit
            else "Corner missed" if call_corner else axe_label(number) if self.mode == "axe" else label(number, multiplier),
            **axe_result,
            "value": value, "bust": bust, "win": winner == i,
            "marks": added_marks, "points": self.points[i], "gain": self.points[i] - before,
            "recap": VISIT_RECAP if not self.alternating_axes and len(self.darts) == 2 else 0,
        }
        self.darts.append(self.shot)
        delay = PAUSE + self.shot["recap"]
        player = self.room.players[self.seats[i]]
        result = " · Bust, visit score restored" if bust else " · Checkout!" if self.mode in X01 and winner == i else ""
        self.room.add_log(f"🎯 {player.name} hits {self.shot['label']}{result}.")
        if self.alternating_axes:
            self.axe_round_throws[i] += 1
            self.advance_axe_round(i, delay)
        elif winner is not None:
            self.record_visit(i, "finish")
            self.finish_later(winner, delay)
        elif bust or len(self.darts) == 3:
            self.end_visit(i, delay, reason="bust" if bust else "complete")
        else:
            self.turn(i, PAUSE)

    def record_visit(self, i, reason):
        if self.completed_visit and self.completed_visit["visit"] == self.visit:
            return
        self.completed_visit = {
            "visit": self.visit, "seat": i, "reason": reason, "darts": list(self.darts),
            "before": self.visit_start, "after": self.points[i],
            "marks": sum(dart["marks"] for dart in self.darts),
        }

    def end_visit(self, i, delay=0, *, collect=True, reason="departure"):
        self.record_visit(i, reason)
        if any(seat > i for seat in self.active()):
            return self.advance(i, delay)
        if collect and (self.darts or self.last_darts):
            self.grabbing = i
            delay += ROUND_LOOK
            self.ready_at = time.time() + delay
            self.room.deadline = self.ready_at
            return
        self.darts, self.last_darts = [], []
        self.advance(i, delay)

    def clear_round(self, i):
        self.grabbing = None
        self.darts, self.last_darts = [], []
        if self.alternating_axes:
            self.axe_round_throws = [0] * len(self.seats)
            self.begin(self.active()[0])
        else:
            self.advance(i)
            self.upgrade_axe_round()

    def finish_later(self, winner, delay):
        self.winner = winner
        self.finishing = True
        self.room.turn = None
        self.room.deadline = time.time() + delay

    def finish(self, winner):
        player = self.room.players.get(self.seats[winner]) if winner is not None else None
        name = MODES[self.mode]
        if player and self.solo:
            text = f"🎯 {player.name} finishes {name} in {self.visit} visits." if self.mode not in FIXED_VISITS \
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
            return self.clear_round(self.grabbing)
        if self.room.turn in self.seats:
            i = self.seats.index(self.room.turn)
            if self.alternating_axes:
                self.room.add_log(f"⏰ {self.room.players[self.seats[i]].name} ran out of time. Throw skipped.", "power")
                self.axe_round_throws[i] += 1
                return self.advance_axe_round(i, 0)
            self.room.add_log(f"⏰ {self.room.players[self.seats[i]].name} ran out of time. Visit over.", "power")
            self.end_visit(i, reason="timeout")

    def leave(self, p):
        if self.alternating_axes:
            p.eliminated = True
            active = self.active()
            if len(active) <= 1:
                return self.finish(active[0] if active else None)
            if self.finishing:
                self.winner = self.countup_winner(active)
            elif self.grabbing is None and self.room.turn == p.id:
                self.advance_axe_round(self.seats.index(p.id), PAUSE)
            return
        if self.room.turn == p.id:
            self.record_visit(self.seats.index(p.id), "departure")
        p.eliminated = True
        active = self.active()
        if self.winner in active:
            return self.finish(self.winner)
        self.winner = None
        if self.grabbing == self.seats.index(p.id):
            self.grabbing, self.darts, self.last_darts = None, [], []
        if len(active) <= 1:
            return self.finish(active[0] if active else None)
        if self.finishing and self.mode in FIXED_VISITS:
            self.winner = self.countup_winner(active)
            return
        self.finishing = False
        if self.mode == "cricket":
            winner = self.cricket_winner(active)
            if winner is not None:
                return self.finish(winner)
        if self.room.turn == p.id or self.room.turn is None:
            self.end_visit(self.seats.index(p.id), collect=False)

    def bot(self, p):
        i = self.seats.index(p.id)
        sigma = SCATTER * spread(SWIPE_PACE) * BOT_SPREAD_MULTIPLIER.get(p.bot, BOT_SPREAD_MULTIPLIER["normal"])
        x, y, _ = self.recommend(i, sigma)
        call_corner = False
        if self.can_call_corner():
            cx, cy, radius = AXE_CORNERS[1]
            # For centered isotropic scatter, this is the chance of landing within the dot.
            expected = 7 * (1 - math.exp(-0.5 * (radius / sigma) ** 2)) if sigma else 7
            call_corner = expected > 5
            if call_corner:
                x, y = cx, cy
        self.throw(i, x + self.rng.gauss(0, sigma), y + self.rng.gauss(0, sigma), call_corner=call_corner)

    def recommend(self, i, sigma):
        if self.mode == "axe":
            return 0, 0, "Aim at the center for five points."
        candidates = aim_outcomes(sigma)
        if self.mode in X01:
            points = self.points[i]
            x, y = x01_choice(points, 3 - len(self.darts), self.visit_start, self.double_out, sigma)
            after = x01_result(points, hit_at(x, y), self.double_out)
            reason = ("Gives you a chance to check out now." if after == 0
                      else f"Leaves {after} if you hit it." if after is not None
                      else "Nearby hits give you a better route to a finish.")
            return x, y, reason
        if self.mode == "cricket":
            rivals = [j for j in self.active() if j != i]
            gap = max((self.points[j] - self.points[i] for j in rivals), default=0)
            needed = dict(zip(TARGETS, (3 - m for m in self.marks[i])))
            scores = {n for t, n in enumerate(TARGETS) if any(self.marks[j][t] < 3 for j in rivals)}

            def utility(n, m):
                if n not in needed:
                    return 0
                marks = min(needed[n], m)
                points = (m - marks) * n if n in scores else 0
                win = marks == sum(needed.values()) and points >= gap
                return marks + points / (16 if gap > 0 else 36) + (8 if win else 0)
        elif self.mode == "clock":
            target = self.next_number(i)

            def utility(n, m):
                return n == target
        else:
            def utility(n, m):
                return n * m

        x, y, _ = max(candidates, key=lambda aim: sum(p * utility(*hit) for hit, p in aim[2]))
        number, _ = hit_at(x, y)
        if self.mode == "cricket":
            reason = ("Builds marks toward closing a target." if needed.get(number)
                      else "Scores while a rival still has this target open." if number in scores
                      else "Nearby hits can build marks or score points.")
        elif self.mode == "clock":
            reason = "Best chance of hitting the next required number."
        else:
            reason = "Highest average score with this spread."
        return x, y, reason

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
        darts = self.last_darts + self.darts
        left = self.throws_left(next_seat) if next_seat is not None and self.grabbing is None else 0
        route = checkout(self.points[next_seat], left, self.double_out) if self.mode in X01 and left else ()
        hint = None
        if next_seat is not None and p.id in self.seats and next_seat == self.seats.index(p.id) and left:
            pace = 0 if getattr(self, "aim_control", False) else SWIPE_PACE
            x, y, reason = self.recommend(next_seat, SCATTER * spread(pace))
            hint = {"label": axe_label(axe_hit(x, y)) if self.mode == "axe" else label(*hit_at(x, y)), "x": x, "y": y, "reason": reason}
        viewer = self.seats.index(p.id) if p.id in self.seats else None
        round_seat = viewer if viewer is not None else next_seat
        return {
            "mode": self.mode, "title": MODES[self.mode], "x01": self.mode in X01,
            "nextNumbers": [self.next_number(i) for i in range(len(self.seats))] if self.mode == "clock" else None,
            "visitsDone": self.visits_done if self.mode in FIXED_VISITS else None,
            "visitLimit": COUNTUP_VISITS if self.mode in FIXED_VISITS else None,
            "seats": self.seats, "me": self.seats.index(p.id) if p.id in self.seats else None,
            "next": next_seat, "visit": self.visit, "darts": darts, "shot": self.shot,
            "points": self.points, "marks": self.marks, "targets": TARGETS, "active": self.active(),
            "axeSpin": AXE_SPIN if self.mode == "axe" else None,
            "axeStickAngle": AXE_STICK_ANGLE if self.mode == "axe" else None,
            "axeLodgedAngle": AXE_LODGED_ANGLE if self.mode == "axe" else None,
            "axeRings": (AXE_CORNER_RINGS if self.corner_scoring else AXE_RINGS) if self.mode == "axe" else None,
            "axeCorners": AXE_CORNERS if self.corner_scoring else None,
            "axesPerRound": AXES_PER_ROUND if self.alternating_axes else None,
            "canCallCorner": bool(left and self.can_call_corner()),
            "numbers": NUMBERS, "radii": RADII, "left": left,
            "dartOrigin": DART_ORIGIN, "swipePace": SWIPE_PACE,
            "spreadBase": spread(0), "spreadPerPace": spread(1) - spread(0),
            "checkout": [label(*hit) for hit in route],
            "doubleOut": self.double_out, "hint": hint,
            "aimControl": getattr(self, "aim_control", False),
            "roundRecap": self.grabbing is not None,
            "visitDarts": [shot for shot in self.darts if shot["o"] == round_seat] if self.alternating_axes else self.darts,
            "completedVisit": self.completed_visit,
            "readyIn": max(0.0, self.ready_at - time.time()),
        }
