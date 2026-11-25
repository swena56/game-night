"""Fixed-step pinball physics and rules for one ball on one table.

Subclass Table and set `layout` (and optionally `rules`) to define a machine:

    class MyTable(Table):
        layout = Layout(rails=..., flippers=..., launch=...)
"""
from dataclasses import dataclass, field
import math
import random
from typing import ClassVar
from uuid import uuid4

from .layout import STEP, Layout, closest
from .rules import Rules

SHOT_OF = dict(lane="lane", skill="lane", target="target", spinner="spinner", ramp="ramp", jackpot="ramp", super="ramp", hurry="spinner")
SPEED_CAP = 42
# Per-ball state: the table swaps these between the main ball and each extra multiball ball.
BALL_STATE = ("x", "y", "vx", "vy", "height", "ramp_ticks", "rollovers", "skill", "smooth_launch",
              "still", "still_origin", "jackpot_shot")


@dataclass
class Table:
    layout: ClassVar[Layout]
    rules: ClassVar[Rules] = Rules()

    score: int = 0
    balls: int = None
    bank: int = 0
    event: str = ""
    event_id: int = 0
    departed: bool = False
    epoch: str = field(default_factory=lambda: uuid4().hex)
    held: int = 0
    last_input: float = -math.inf
    buffer: list = field(default_factory=lambda: [0, 0])
    angles: list = None
    nudges: int = 0
    pending: list = field(default_factory=list)
    tilt: bool = False
    staged: bool = True
    charge: int = 0
    smooth_launch: bool = False
    skill: bool = False
    x: float = None
    y: float = None
    vx: float = 0
    vy: float = 0
    height: float = 0
    ramp_ticks: int = 0
    spin: float = 0
    spin_left: float = 0
    still: int = 0
    still_origin: tuple = None
    rollovers: int = 0
    save_ticks: int = 0
    save_used: bool = False
    jackpot_ticks: int = 0
    jackpot_shot: bool = False
    lane_bits: int = 0
    mult: int = 1
    bumper_hits: int = 0
    ramps: int = 0
    bonus: int = 0
    kickback: bool = True
    combo: int = 0
    combo_ticks: int = 0
    last_shot: str = ""
    lit: int = None
    extras: int = 0
    others: list = field(default_factory=list)   # state dicts of the other balls in play
    locked: int = 0
    lit_hits: int = 0
    jackpots: int = 0
    jackpot_pool: int = 0
    multiballs: int = 0
    hurry_wins: int = 0
    mysteries: int = 0
    wizards: int = 0
    best_combo: int = 0
    spins: int = 0
    hold: bool = False
    last_points: int = 0
    mystery_due: bool = False
    hurry_ticks: int = 0
    mb_save_ticks: int = 0
    post_used: bool = False
    mode: str = "classic"      # classic | zen (no tilt) | practice (endless balls) | timeattack (a clock ends the run)
    clock: int = 0              # time attack: ticks of play left
    rng: random.Random = field(default_factory=random.Random, repr=False)
    gone: bool = False

    def __post_init__(self):
        lay, rules = self.layout, self.rules
        self.balls = rules.balls if self.balls is None else self.balls
        self.angles = lay.resting_angles() if self.angles is None else self.angles
        self.x = lay.launch[0] if self.x is None else self.x
        self.y = lay.launch[1] if self.y is None else self.y
        self.still_origin = lay.launch if self.still_origin is None else self.still_origin
        self.lit = rules.first_lit if self.lit is None else self.lit

    # -- scoring ---------------------------------------------------------------------------------

    def signal(self, event, points=0, scaled=True):
        before = self.score
        if event == "multiball":
            self.multiballs += 1
        elif event == "hurry":
            self.hurry_wins += 1
        self.score += points * (self.mult if scaled else 1)
        kind = SHOT_OF.get(event.rstrip("0123456789"))
        if kind and points and not self.tilt:
            self.chain(kind, points)
        self.last_points = self.score - before
        self.event = event
        self.event_id += 1
        if self.mystery_due:
            self.mystery_due = False
            self.mystery()
        scores = self.rules.extra_ball_scores
        if self.extras < len(scores) and self.score >= scores[self.extras] and not self.tilt \
                and event not in ("bonus", "drain", "done", "tilt"):
            self.extras += 1
            self.balls += 1
            self.event = "extra"
            self.event_id += 1

    def chain(self, kind, points):
        """Pay combos for different shots in quick succession and double the lit shot."""
        rules = self.rules
        if not self.combo_ticks:
            self.combo = 1
        elif kind != self.last_shot:
            self.combo += 1
        self.combo_ticks, self.last_shot = rules.combo_ticks, kind
        self.best_combo = max(self.best_combo, self.combo)
        extra = rules.combo_step * (self.combo - 1)
        if rules.shots[self.lit] == kind:
            extra += points
            self.lit = (self.lit + 1) % len(rules.shots)
            self.lit_hits += 1
            self.mystery_due = bool(rules.mystery_every) and self.lit_hits % rules.mystery_every == 0
        self.score += extra * self.mult

    def mystery(self):
        """A random prize for every few lit-shot doubles."""
        self.mysteries += 1
        rules = self.rules
        prizes = ["points", "save"]
        if self.mult < rules.max_mult:
            prizes.append("mult")
        if not self.hold:
            prizes.append("hold")
        prize = self.rng.choice(prizes)
        if prize == "points":
            self.score += rules.mystery_points
            self.last_points += rules.mystery_points
        elif prize == "save":
            self.save_ticks = max(self.save_ticks, rules.mystery_save_ticks)
        elif prize == "mult":
            self.mult += 1
        else:
            self.hold = True
        self.event = f"mystery_{prize}"
        self.event_id += 1

    # -- controls --------------------------------------------------------------------------------

    def reset_controls(self):
        self.held = self.charge = 0
        self.buffer[:] = [0, 0]
        self.pending.clear()

    def invalidate_controls(self):
        self.reset_controls()
        self.epoch = uuid4().hex

    def input(self, held, nudge, now):
        self.expire(now)
        self.last_input = now
        for i in range(2):
            if held & (1 << i) and not self.held & (1 << i):
                self.buffer[i] = 12
        if self.held & 4 and not held & 4 and self.staged and self.charge:
            strength = self.charge / 240
            self.staged = False
            self.smooth_launch = True
            low, high = self.layout.skill_charge
            self.skill = low <= self.charge <= high and not self.locked   # a lock re-serve pays no skill shot
            self.vy = -(13 + 19 * strength)
            self.charge = 0
        self.held = held
        if nudge and not self.staged and not self.tilt and len(self.pending) < 4:
            self.pending.append(nudge)

    def expire(self, now):
        if now - self.last_input >= 0.25:
            self.reset_controls()

    def nudge(self, direction):
        if self.tilt or self.staged:
            return
        if self.nudges >= self.rules.max_nudges and self.mode == "zen":
            self.nudges = 0                # zen: the table never tilts; the nudge counter just refills
        if self.nudges == self.rules.max_nudges:
            self.tilt = True
            self.skill = False
            self.save_ticks = self.jackpot_ticks = 0
            self.signal("tilt")
            return
        self.nudges += 1
        for ball in self.others:
            ball["vx"] += 4.8 * direction
            ball["vy"] -= 3.4 if not direction else 1.8
        self.vx += 4.8 * direction
        self.vy -= 3.4 if not direction else 1.8
        self.signal("nudge")

    def time_up(self):
        """Time attack: the clock ends the run on the spot; the ball in play still banks its bonus."""
        self.bonus = self.live_bonus()
        self.score += self.bonus
        self.balls = 0
        self.others.clear()
        self.reset_controls()
        self.signal("done", scaled=False)

    def drain(self):
        rules = self.rules
        self.balls -= 1
        self.bonus = self.live_bonus()
        self.score += self.bonus
        self.lane_bits = self.locked = 0
        self.others.clear()
        self.hurry_ticks = 0
        if self.hold and not self.tilt:
            self.hold = False                  # the bonus and its multiplier carry to the next ball
        else:
            self.bumper_hits = self.ramps = 0
            self.mult = 1
            self.hold = False
        self.kickback = True
        self.combo = self.combo_ticks = 0
        self.save_used = self.jackpot_shot = False
        self.jackpot_pool = 0
        self.save_ticks = self.jackpot_ticks = 0
        self.reset_controls()
        self.staged = bool(self.balls)
        self.x, self.y = self.layout.launch
        self.vx = self.vy = self.height = self.spin = self.spin_left = 0
        self.nudges = self.still = self.ramp_ticks = self.rollovers = 0
        self.still_origin = self.layout.launch
        self.tilt = self.skill = self.smooth_launch = False
        self.angles[:] = self.layout.resting_angles()
        self.signal("bonus" if self.bonus and self.balls else "drain" if self.balls else "done", scaled=False)

    # -- collisions ------------------------------------------------------------------------------

    def contact(self, cx, cy, radius, bounce, kick=0, sx=0, sy=0):
        dx, dy = self.x - cx, self.y - cy
        distance = math.hypot(dx, dy)
        if distance >= radius:
            return False
        if distance > 1e-8:
            nx, ny = dx / distance, dy / distance
        else:
            nx, ny = 0, -1
        self.x, self.y = cx + nx * (radius + 1e-5), cy + ny * (radius + 1e-5)
        approach = (self.vx - sx) * nx + (self.vy - sy) * ny
        if approach >= 0:
            return False
        impulse = max(kick, -(1 + bounce) * approach)
        self.vx += impulse * nx
        self.vy += impulse * ny
        return True

    def segment(self, rail, radius=None, bounce=0.77, kick=0):
        cx, cy = closest(self.x, self.y, *rail)
        return self.contact(cx, cy, self.layout.ball if radius is None else radius, bounce, kick)

    def move_flippers(self):
        previous = self.angles[:]
        for i, (_, _, rest, up) in enumerate(self.layout.flippers):
            active = not self.tilt and (self.held & (1 << i) or self.buffer[i])
            target = up if active else rest
            speed = (31 if active else 20) * STEP
            self.angles[i] += max(-speed, min(speed, target - self.angles[i]))
            self.buffer[i] = max(0, self.buffer[i] - 1)
        return previous

    def flipper_contact(self, i, start, elapsed):
        lay = self.layout
        ax, ay, _, _ = lay.flippers[i]
        travel = self.angles[i] - start
        angle = start + travel * elapsed
        bx, by = ax + lay.flipper_length * math.cos(angle), ay + lay.flipper_length * math.sin(angle)
        cx, cy = closest(self.x, self.y, ax, ay, bx, by)
        speed = travel / STEP
        self.contact(cx, cy, lay.ball + lay.flipper_radius, 0.55, 0,
                     -(cy - ay) * speed, (cx - ax) * speed)

    def mechanisms(self, old_y):
        lay, rules = self.layout, self.rules
        ball = lay.ball
        for rail in lay.rails:
            self.segment(rail)
        if lay.gate and not self.smooth_launch:
            self.segment(lay.gate, bounce=0.5)
        for i, rail in enumerate(lay.slings):
            if self.segment(rail, ball + 0.09, kick=0 if self.tilt else 13) and not self.tilt:
                self.signal(f"sling{i}", rules.sling)
        for i, (x, y, radius) in enumerate(lay.bumps):
            if self.contact(x, y, ball + radius, 0.86, 0 if self.tilt else 16) and not self.tilt:
                self.bumper_hits += 1
                level = 1 + min(2, self.bumper_hits // rules.bumper_step)
                if self.jackpot_ticks or self.others:
                    self.jackpot_pool += rules.jackpot_growth
                self.signal(f"bumper{i}", (rules.bumper_jackpot if self.jackpot_ticks or self.others else rules.bumper) * level)
        for i, rail in enumerate(lay.targets):
            if self.segment(rail, ball + 0.08) and not self.tilt and not self.bank & (1 << i):
                self.bank |= 1 << i
                self.signal(f"target{i}", rules.target)
        if lay.outlane and self.kickback and not self.tilt and self.vy > 0 \
                and self.x < lay.outlane[0] and self.y > lay.outlane[1]:
            self.kickback = False
            self.vx, self.vy = 1.5, -34
            self.signal("kickback")
        if self.tilt:
            return
        current = sum(1 << i for i, (x, y) in enumerate(lay.lanes) if math.hypot(self.x - x, self.y - y) < 0.44)
        for i in range(len(lay.lanes)):
            if current & ~self.rollovers & (1 << i):
                self.signal("skill" if self.skill else f"lane{i}", rules.skill if self.skill else rules.lane)
                self.skill = False
                self.lane_bits |= 1 << i
                if self.lane_bits == (1 << len(lay.lanes)) - 1:
                    self.lane_bits = 0
                    self.mult = min(rules.max_mult, self.mult + 1)
                    self.kickback = True       # a full set of lanes re-arms the outlane kickback
                    self.signal("mult")
                    if lay.spinner and rules.hurry_ticks:
                        self.hurry_ticks = rules.hurry_ticks
        self.rollovers = current
        if self.x < lay.lane_x and self.y > lay.lane_exit_y:
            self.skill = False
        if lay.spinner:
            sx, sy = lay.spinner
            if abs(self.x - sx) < 0.55 and (old_y < sy <= self.y or self.y <= sy < old_y):
                self.spin_left += max(1, min(5, int(abs(self.vy) / 5)))
        if lay.ramp:
            rx, ry = lay.ramp
            jackpot = bool(self.jackpot_ticks or self.others)
            lit = jackpot or self.bank == (1 << len(lay.targets)) - 1
            if lit and self.vy < -7 and self.y <= ry < old_y and abs(self.x - rx) < 0.65:
                self.ramp_ticks = 1
                self.jackpot_shot = jackpot

    # -- simulation ------------------------------------------------------------------------------

    def step(self):
        if not self.balls or self.departed:
            return
        lay, rules = self.layout, self.rules
        while self.pending:
            direction = self.pending.pop(0)
            self.nudge(0 if direction == 2 else direction)
        previous = self.move_flippers()
        if self.staged:
            if self.held & 4:
                self.charge = min(240, self.charge + 1)
            return
        self.save_ticks = max(0, self.save_ticks - 1)
        self.jackpot_ticks = max(0, self.jackpot_ticks - 1)
        self.combo_ticks = max(0, self.combo_ticks - 1)
        self.hurry_ticks = max(0, self.hurry_ticks - 1)
        self.mb_save_ticks = max(0, self.mb_save_ticks - 1)
        if self.clock:
            self.clock -= 1
            if not self.clock:
                self.time_up()
                return
        if self.spin_left:
            turn = min(self.spin_left, 8 * STEP)
            old_spin = self.spin
            self.spin += turn
            self.spin_left -= turn
            if int(self.spin + 1e-8) > int(old_spin + 1e-8) and not self.tilt:
                self.spins += 1
                if self.hurry_ticks:       # collect the decaying hurry-up on this spin
                    value = rules.hurry_min + (rules.hurry_max - rules.hurry_min) * self.hurry_ticks // rules.hurry_ticks
                    self.hurry_ticks = 0
                    self.signal("hurry", value)
                else:
                    self.signal("spinner", rules.spinner * (1 + min(4, self.spins // rules.spinner_step)))
        self.run_ball(previous)
        if self.gone:      # the main ball drained while others are in play: another takes over
            self.gone = False
            self.load(self.others.pop(0))
        k = 0
        while k < len(self.others):
            self.swap(k)
            self.run_ball(previous)
            if self.gone:  # this extra drained; the main ball (parked in others[k]) comes back
                self.gone = False
                self.load(self.others.pop(k))
            else:
                self.swap(k)
                k += 1

    # -- multiball: extra balls are kept as state dicts and swapped in to reuse the one-ball physics ----

    def state(self):
        return {name: getattr(self, name) for name in BALL_STATE}

    def load(self, state):
        for name, value in state.items():
            setattr(self, name, value)

    def swap(self, k):
        mine = self.state()
        self.load(self.others[k])
        self.others[k] = mine

    def free_ball(self, x, y, vx, vy):
        return dict(x=x, y=y, vx=vx, vy=vy, height=0, ramp_ticks=0, rollovers=0, skill=False,
                    smooth_launch=False, still=0, still_origin=(x, y), jackpot_shot=False)

    def run_ball(self, previous):
        lay = self.layout
        if self.ramp_ticks:
            self.ride_ramp()
            return
        old_y = self.y
        self.vx *= 0.999
        self.vy = self.vy * 0.999 + self.rules.gravity * STEP
        speed = math.hypot(self.vx, self.vy)
        if speed > SPEED_CAP:
            self.vx *= SPEED_CAP / speed
            self.vy *= SPEED_CAP / speed
        near_flippers = lay.flipper_zone[0] < self.y < lay.flipper_zone[1] and self.x < lay.lane_x
        # Sweep moving capsules through intermediate angles and ball positions. At the speed cap
        # each sample advances the relative surfaces by less than a ball radius.
        samples = 3 if near_flippers else 1
        for sample in range(1, samples + 1):
            self.x += self.vx * STEP / samples
            self.y += self.vy * STEP / samples
            if near_flippers:
                for i in range(len(lay.flippers)):
                    self.flipper_contact(i, previous[i], sample / samples)
        self.mechanisms(old_y)
        self.lane_and_drain()

    def ride_ramp(self):
        lay, rules = self.layout, self.rules
        t = self.ramp_ticks / 115
        self.x = lay.ramp[0] + (lay.ramp_exit[0] - lay.ramp[0]) * t
        self.y = lay.ramp[1] + (lay.ramp_exit[1] - lay.ramp[1]) * t - 4.8 * math.sin(math.pi * t)
        self.height = 1.6 * math.sin(math.pi * t)
        self.ramp_ticks += 1
        if self.ramp_ticks > 115:
            self.ramp_ticks = 0
            self.vx, self.vy = -4, 9
            if not self.tilt:
                self.ramps += 1
                if self.jackpot_shot:
                    self.jackpots += 1
                    if rules.super_every and self.jackpots % rules.super_every == 0:
                        self.signal("super", rules.super_jackpot + self.jackpot_pool)
                    else:
                        self.signal("jackpot", rules.jackpot + self.jackpot_pool)
                    self.jackpot_pool = 0
                    if rules.wizard_at and self.jackpots == rules.wizard_at and not self.wizards:
                        self.wizard()
                else:
                    self.bank = 0
                    self.jackpot_ticks = rules.jackpot_ticks
                    self.signal("ramp", rules.ramp)
                    if rules.lock_balls and not self.others:
                        self.lock_ball()

    def wizard(self):
        """The reward for a run of jackpots: three extra balls, a full jackpot window and a big bonus."""
        lay, rules = self.layout, self.rules
        self.wizards += 1
        ex, ey = lay.ramp_exit
        for i in range(3):
            side = -1 if i % 2 else 1
            self.others.append(self.free_ball(ex + 0.45 * side * (i // 2 + 1), ey, -4 + 2.6 * side * (i // 2 + 1), 8))
        self.jackpot_ticks = max(self.jackpot_ticks, rules.multiball_ticks)
        self.mb_save_ticks = rules.multiball_save_ticks
        self.signal("wizard", rules.wizard_points)

    def lock_ball(self):
        """A ramp shot locks the ball; the last lock releases every locked ball at once."""
        lay, rules = self.layout, self.rules
        self.locked += 1
        if self.locked < rules.lock_balls:
            # the ball is held in the lock and a fresh one waits in the shooter lane
            self.x, self.y = lay.launch
            self.vx = self.vy = self.height = 0
            self.staged = True
            self.smooth_launch = self.skill = False
            self.still = 0
            self.still_origin = lay.launch
            self.reset_controls()
            self.signal("lock")
            return
        ex, ey = lay.ramp_exit
        for i in range(rules.lock_balls):
            side = -1 if i % 2 else 1
            self.others.append(self.free_ball(ex + 0.45 * side * (i // 2 + 1), ey, -4 + 2.6 * side * (i // 2 + 1), 8))
        self.jackpot_ticks = max(self.jackpot_ticks, rules.multiball_ticks)
        self.mb_save_ticks = rules.multiball_save_ticks
        self.locked = 0
        self.signal("multiball", rules.multiball_start)

    def lane_and_drain(self):
        lay = self.layout
        if self.smooth_launch and self.x < lay.lane_x and self.y < lay.lane_exit_y:
            self.smooth_launch = False
            if not self.save_used and not self.tilt:
                self.save_ticks = self.rules.save_ticks
                self.save_used = True
        if self.smooth_launch and self.x > lay.lane_x + 0.2 and self.y > lay.launch[1] - 0.1 and self.vy > 0:
            self.x, self.y = lay.launch
            self.vx = self.vy = 0
            self.staged = True
            self.smooth_launch = self.skill = False
        elif self.y > lay.height + lay.ball:
            if self.others and self.mb_save_ticks and not self.tilt:
                # early in multiball a drained ball is fed straight back from the ramp exit
                self.x, self.y = self.layout.ramp_exit
                self.vx, self.vy = -3, 8
                self.still = 0
                self.still_origin = (self.x, self.y)
                self.signal("save")
            elif self.others:
                self.gone = True
            elif not self.save_ticks and self.rules.center_post and not self.post_used and not self.tilt:
                # a one-time centre post pops up and bounces the ball back into play
                self.post_used = True
                self.x, self.y = self.layout.center
                self.vx, self.vy = 0, -9
                self.still = 0
                self.still_origin = (self.x, self.y)
                self.signal("post")
            elif self.save_ticks:
                self.save_ticks = 0
                self.x, self.y = lay.launch
                self.vx, self.vy = 0, -30
                self.smooth_launch = True
                self.still = 0
                self.still_origin = lay.launch
                self.skill = False
                self.signal("save")
            else:
                self.drain()
        elif math.hypot(self.x - self.still_origin[0], self.y - self.still_origin[1]) < lay.ball:
            self.still += 1
            if self.still == 480 and self.y < lay.flipper_zone[0]:
                self.vx += 2.5 * (1 if self.x < lay.center[0] else -1)
                self.vy -= 2
            if self.still >= 720:
                self.x, self.y, self.vx, self.vy = *lay.center, 0, 4
                self.still = 0
                self.still_origin = (self.x, self.y)
                self.skill = False
                self.signal("recovery")
        else:
            self.still = 0
            self.still_origin = (self.x, self.y)

    def live_bonus(self):
        """The end-of-ball bonus as it stands now (the packed BONUS slot while a ball is in play)."""
        if self.tilt:
            return 0
        return (self.bumper_hits * self.rules.bumper_bonus + self.ramps * self.rules.ramp_bonus) * self.mult

    def public(self):
        """Packed renderer state shared by full views and 30 Hz snapshots."""
        return [*[round(v, 3) for v in (self.x, self.y, self.vx, self.vy, self.height, *self.angles)],
                self.score, self.balls, self.bank, self.nudges, int(self.tilt), int(self.staged),
                self.charge, self.event_id, self.event, round(self.spin % 1, 3),
                math.ceil(self.save_ticks / 240), math.ceil(self.jackpot_ticks / 240),
                self.mult, self.bonus if self.staged else self.live_bonus(), self.lane_bits, int(self.kickback),
                self.combo if self.combo_ticks else 0, self.lit, self.locked,
                [[round(o["x"], 3), round(o["y"], 3), round(o["vx"], 2), round(o["vy"], 2), round(o["height"], 2)]
                 for o in self.others], self.last_points, int(self.hold), math.ceil(self.hurry_ticks / 240),
                {"jackpot": self.jackpots, "multiball": self.multiballs, "hurry": self.hurry_wins,
                 "mystery": self.mysteries, "extra": self.extras, "combo": self.best_combo,
                 "wizard": self.wizards, "mode": self.mode, "clock": math.ceil(self.clock / 240)}]
