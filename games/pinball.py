"""Pinball's fixed-step simulation. Coordinates are in playfield units, down-table is +y."""
from dataclasses import dataclass, field
import math
import time
from uuid import uuid4

from .base import Game, GameError

WIDTH, HEIGHT, BALL = 10, 17, 0.19
STEP = 1 / 240
LAUNCH = (9.4, 15.8)
SKILL_CHARGE = (197, 228)
SAVE_TICKS = 4 * 240
JACKPOT_TICKS = 20 * 240
FLIPPERS = ((3.22, 14.95, 0.42, -0.66), (6.78, 14.95, math.pi - 0.42, math.pi + 0.66))
LENGTH, FLIP_RADIUS = 1.56, 0.12
# Keep the shooter feed open above the rollover dividers.
# The lower guides direct rebounds toward the slings and flippers.
RAILS = (
    (0, 17, 0, 2.2), (0, 2.2, 1.5, 0), (1.5, 0, 7.8, 0),
    (7.8, 0, 10, 2.8), (10, 2.8, 10, 17), (8.8, 3.1, 8.8, 17),
    (8.8, 16.25, 10, 16.25), (0, 12.3, 3.22, 14.95), (8.8, 13.25, 6.78, 14.95),
    (3.25, 2.95, 3.25, 4.15), (5.25, 2.95, 5.25, 4.15),
    (2.55, 9.55, 3.15, 10.35), (7.45, 9.55, 6.85, 10.35),
)
SLINGS = ((1.35, 10.75, 2.85, 12.5), (7.73, 10.75, 6.48, 12.6))
# Offset the lower bumper to clear a straight shot to the ramp mouth.
BUMPS = ((3.12, 5.65, 0.68), (6.62, 5.7, 0.68), (4.05, 7.64, 0.68))
TARGETS = ((1.25, 6.6, 1.25, 7.3), (1.25, 7.48, 1.25, 8.18), (1.25, 8.36, 1.25, 9.06))
ROLLOVERS = ((2.25, 3.5), (4.25, 3.5), (6.25, 3.5))
SPINNER = (7.95, 7.4)
RAMP = (5.25, 6.02)
RAMP_EXIT = (7.75, 8.6)
LAYOUT = dict(rails=RAILS, slings=SLINGS, bumps=BUMPS, targets=TARGETS, lanes=ROLLOVERS,
              spinner=SPINNER, ramp=RAMP, exit=RAMP_EXIT, flips=FLIPPERS, length=LENGTH,
              radius=BALL, skill=SKILL_CHARGE, width=WIDTH, height=HEIGHT, launch=LAUNCH)


def closest(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    fraction = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return ax + dx * fraction, ay + dy * fraction


@dataclass
class Table:
    score: int = 0
    balls: int = 3
    bank: int = 0
    event: str = ""
    event_id: int = 0
    departed: bool = False
    epoch: str = field(default_factory=lambda: uuid4().hex)
    held: int = 0
    last_input: float = -math.inf
    buffer: list = field(default_factory=lambda: [0, 0])
    angles: list = field(default_factory=lambda: [f[2] for f in FLIPPERS])
    nudges: int = 0
    pending: list = field(default_factory=list)
    tilt: bool = False
    staged: bool = True
    charge: int = 0
    smooth_launch: bool = False
    skill: bool = False
    x: float = LAUNCH[0]
    y: float = LAUNCH[1]
    vx: float = 0
    vy: float = 0
    height: float = 0
    ramp_ticks: int = 0
    spin: float = 0
    spin_left: float = 0
    still: int = 0
    still_origin: tuple = LAUNCH
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

    def signal(self, event, points=0, scaled=True):
        self.score += points * (self.mult if scaled else 1)
        self.event = event
        self.event_id += 1

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
            self.skill = SKILL_CHARGE[0] <= self.charge <= SKILL_CHARGE[1]
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
        if self.nudges == 3:
            self.tilt = True
            self.skill = False
            self.save_ticks = self.jackpot_ticks = 0
            self.signal("tilt")
            return
        self.nudges += 1
        self.vx += 4.8 * direction
        self.vy -= 3.4 if not direction else 1.8
        self.signal("nudge")

    def drain(self):
        self.balls -= 1
        self.bonus = (self.bumper_hits * 10 + self.ramps * 1000) * self.mult
        self.score += self.bonus
        self.bumper_hits = self.ramps = self.lane_bits = 0
        self.mult = 1
        self.save_used = self.jackpot_shot = False
        self.save_ticks = self.jackpot_ticks = 0
        self.reset_controls()
        self.staged = bool(self.balls)
        self.x, self.y = LAUNCH
        self.vx = self.vy = self.height = self.spin = self.spin_left = 0
        self.nudges = self.still = self.ramp_ticks = self.rollovers = 0
        self.still_origin = LAUNCH
        self.tilt = self.skill = self.smooth_launch = False
        self.angles[:] = [flip[2] for flip in FLIPPERS]
        self.signal("bonus" if self.bonus and self.balls else "drain" if self.balls else "done", scaled=False)

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

    def segment(self, rail, radius=BALL, bounce=0.77, kick=0):
        cx, cy = closest(self.x, self.y, *rail)
        return self.contact(cx, cy, radius, bounce, kick)

    def move_flippers(self):
        previous = self.angles[:]
        for i, (_, _, rest, up) in enumerate(FLIPPERS):
            active = not self.tilt and (self.held & (1 << i) or self.buffer[i])
            target = up if active else rest
            speed = (31 if active else 20) * STEP
            self.angles[i] += max(-speed, min(speed, target - self.angles[i]))
            self.buffer[i] = max(0, self.buffer[i] - 1)
        return previous

    def flipper_contact(self, i, start, elapsed):
        ax, ay, _, _ = FLIPPERS[i]
        travel = self.angles[i] - start
        angle = start + travel * elapsed
        bx, by = ax + LENGTH * math.cos(angle), ay + LENGTH * math.sin(angle)
        cx, cy = closest(self.x, self.y, ax, ay, bx, by)
        speed = travel / STEP
        self.contact(cx, cy, BALL + FLIP_RADIUS, 0.55, 0,
                     -(cy - ay) * speed, (cx - ax) * speed)

    def mechanisms(self, old_y):
        for rail in RAILS:
            self.segment(rail)
        for i, rail in enumerate(SLINGS):
            if self.segment(rail, BALL + 0.09, kick=0 if self.tilt else 13) and not self.tilt:
                self.signal(f"sling{i}", 50)
        for i, (x, y, radius) in enumerate(BUMPS):
            if self.contact(x, y, BALL + radius, 0.86, 0 if self.tilt else 16) and not self.tilt:
                self.bumper_hits += 1
                self.signal(f"bumper{i}", 200 if self.jackpot_ticks else 100)
        for i, rail in enumerate(TARGETS):
            if self.segment(rail, BALL + 0.08) and not self.tilt and not self.bank & (1 << i):
                self.bank |= 1 << i
                self.signal(f"target{i}", 250)
        if self.tilt:
            return
        current = sum(1 << i for i, (x, y) in enumerate(ROLLOVERS) if math.hypot(self.x - x, self.y - y) < 0.44)
        for i in range(3):
            if current & ~self.rollovers & (1 << i):
                points = 5000 if self.skill else 500
                self.signal("skill" if self.skill else f"lane{i}", points)
                self.skill = False
                self.lane_bits |= 1 << i
                if self.lane_bits == 7:
                    self.lane_bits = 0
                    self.mult = min(5, self.mult + 1)
                    self.signal("mult")
        self.rollovers = current
        if self.x < 8.8 and self.y > 5:
            self.skill = False
        sx, sy = SPINNER
        if abs(self.x - sx) < 0.55 and (old_y < sy <= self.y or self.y <= sy < old_y):
            self.spin_left += max(1, min(5, int(abs(self.vy) / 5)))
        rx, ry = RAMP
        if (self.bank == 7 or self.jackpot_ticks) and self.vy < -7 and self.y <= ry < old_y and abs(self.x - rx) < 0.65:
            self.ramp_ticks = 1
            self.jackpot_shot = bool(self.jackpot_ticks)

    def step(self):
        if not self.balls or self.departed:
            return
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
        if self.spin_left:
            turn = min(self.spin_left, 8 * STEP)
            old_spin = self.spin
            self.spin += turn
            self.spin_left -= turn
            if int(self.spin + 1e-8) > int(old_spin + 1e-8) and not self.tilt:
                self.signal("spinner", 100)
        if self.ramp_ticks:
            t = self.ramp_ticks / 115
            self.x = RAMP[0] + (RAMP_EXIT[0] - RAMP[0]) * t
            self.y = RAMP[1] + (RAMP_EXIT[1] - RAMP[1]) * t - 4.8 * math.sin(math.pi * t)
            self.height = 1.6 * math.sin(math.pi * t)
            self.ramp_ticks += 1
            if self.ramp_ticks > 115:
                self.ramp_ticks = 0
                self.vx, self.vy = -4, 9
                if not self.tilt:
                    if self.jackpot_shot:
                        self.ramps += 1
                        self.signal("jackpot", 12000)
                    else:
                        self.ramps += 1
                        self.bank = 0
                        self.jackpot_ticks = JACKPOT_TICKS
                        self.signal("ramp", 6000)
            return
        old_y = self.y
        self.vx *= 0.999
        self.vy = self.vy * 0.999 + 11 * STEP
        speed = math.hypot(self.vx, self.vy)
        if speed > 42:
            self.vx *= 42 / speed
            self.vy *= 42 / speed
        near_flippers = 13.6 < self.y < 16.2 and self.x < 8.8
        # Sweep moving capsules through intermediate angles and ball positions. At the speed cap
        # each sample advances the relative surfaces by less than a ball radius.
        samples = 3 if near_flippers else 1
        for sample in range(1, samples + 1):
            self.x += self.vx * STEP / samples
            self.y += self.vy * STEP / samples
            if near_flippers:
                for i in range(2):
                    self.flipper_contact(i, previous[i], sample / samples)
        self.mechanisms(old_y)
        if self.smooth_launch and self.x < 8.8 and self.y < 5:
            self.smooth_launch = False
            if not self.save_used and not self.tilt:
                self.save_ticks = SAVE_TICKS
                self.save_used = True
        if self.smooth_launch and self.x > 9 and self.y > 15.7 and self.vy > 0:
            self.x, self.y = LAUNCH
            self.vx = self.vy = 0
            self.staged = True
            self.smooth_launch = self.skill = False
        elif self.y > HEIGHT + BALL:
            if self.save_ticks:
                self.save_ticks = 0
                self.x, self.y = LAUNCH
                self.vx, self.vy = 0, -30
                self.still = 0
                self.still_origin = LAUNCH
                self.skill = False
                self.signal("save")
            else:
                self.drain()
        elif math.hypot(self.x - self.still_origin[0], self.y - self.still_origin[1]) < BALL:
            self.still += 1
            if self.still == 480 and self.y < 13.6:
                self.vx += 2.5 * (1 if self.x < 5 else -1)
                self.vy -= 2
            if self.still >= 720:
                self.x, self.y, self.vx, self.vy = 5, 12, 0, 4
                self.still = 0
                self.still_origin = (self.x, self.y)
                self.skill = False
                self.signal("recovery")
        else:
            self.still = 0
            self.still_origin = (self.x, self.y)

    def public(self):
        """Packed renderer state shared by full views and 30 Hz snapshots."""
        return [*[round(v, 3) for v in (self.x, self.y, self.vx, self.vy, self.height, *self.angles)],
                self.score, self.balls, self.bank, self.nudges, int(self.tilt), int(self.staged),
                self.charge, self.event_id, self.event, round(self.spin % 1, 3),
                math.ceil(self.save_ticks / 240), math.ceil(self.jackpot_ticks / 240),
                self.mult, self.bonus, self.lane_bits]


class Pinball(Game):
    id = "pinball"
    name = "Pinball"
    category = "action"
    icon = "🕹️"
    min_players, max_players = 1, 6
    replayable = False
    blurb = "Three balls on a colorful chrome-trimmed table. Bank shots off the bumpers, light the ramp, and chase a high score."
    howto = [
        "Pull down on the plunger shaft at the right side of the playfield and release to launch. You can also hold and release Space or Launch. Aim for the gold charge band.",
        "Tap or click either half of the playfield to flip on that side. A and D, arrow keys, and the Flip buttons also work. Use Q, W, E or the nudge buttons to move the table.",
        "The fourth nudge tilts the table and ends scoring until that ball drains. Clear all three targets, then shoot the ramp for 6,000 and start a 20-second jackpot round. Repeat ramp shots for 12,000 each.",
        "Each ball has one automatic save during its first four seconds on the playfield. Everyone plays three balls on a separate table. Highest score wins.",
    ]

    def start(self, seated, rng):
        self.tables = {p.id: Table() for p in seated}
        self.run = uuid4().hex
        self.frames = 0
        self.solo = len(seated) == 1 and not seated[0].bot
        self.room.turn = self.room.deadline = None

    def on_restore(self, shift):
        for table in self.tables.values():
            table.invalidate_controls()

    def on_connect(self, p):
        if p.id in self.tables:
            self.tables[p.id].invalidate_controls()

    def on_input(self, p, action):
        table = self.tables.get(p.id)
        if table is None or p.eliminated:
            raise GameError("You're watching this game.")
        if not table.balls or action.get("epoch") != table.epoch or action.get("ball") != table.balls:
            return
        held, nudge = action.get("held"), action.get("nudge", 0)
        if type(held) is not int or not 0 <= held <= 7 or type(nudge) is not int or nudge not in (-1, 0, 1, 2):
            raise GameError("Invalid pinball controls.")
        if action.get("reset") is True:
            table.reset_controls()
        else:
            table.input(held, nudge, time.time())

    def frame(self, now):
        for pid, table in self.tables.items():
            if table.departed or not table.balls:
                continue
            player = self.room.players.get(pid)
            if player and player.bot:
                # Bots and stand-ins launch and pulse the flippers while the ball is in reach.
                held = (4 if table.charge < 200 else 0) if table.staged else (
                    (1 if table.x < 5 else 2) if 13.3 < table.y < 15.15 and self.frames % 20 < 10 else 0)
                table.input(held, 0, now)
            else:
                table.expire(now)
        for _ in range(4):
            for table in self.tables.values():
                table.step()
        self.frames += 1
        if self.complete():
            return True
        if self.frames % 2 == 0:
            self.room.push_fast(self.snapshot())
        return False

    def complete(self):
        remaining = [(pid, t) for pid, t in self.tables.items() if not t.departed and pid in self.room.players]
        if any(t.balls for _, t in remaining):
            return False
        if not remaining:
            self.room.finish(None, "Everyone left.")
            return True
        best = max(t.score for _, t in remaining)
        winners = [self.room.players[pid] for pid, t in remaining if t.score == best]
        if len(winners) == 1:
            player = winners[0]
            message = f"{player.name} scores {best:,}!" if self.solo else f"{player.name} wins with {best:,}!"
            self.room.finish(player, message)
        else:
            self.room.finish(None, f"Tied at {best:,}!", draw=True)
        return True

    def on_leave(self, p):
        table = self.tables[p.id]
        table.departed = p.eliminated = True
        table.reset_controls()
        self.complete()

    def final_scores(self):
        return {pid: table.score for pid, table in self.tables.items() if not table.departed}

    def snapshot(self):
        return {"pin": self.run, "tick": self.frames,
                "tables": {pid: t.public() for pid, t in self.tables.items() if not t.departed}}

    def view(self, p):
        table = self.tables.get(p.id)
        return {"pinball": {**self.snapshot(), "layout": LAYOUT, "solo": self.solo,
                            "me": p.id if table and not table.departed else None,
                            "epoch": table.epoch if table else None}}
