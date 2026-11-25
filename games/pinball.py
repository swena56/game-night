"""Golden Hour: the Game Night pinball table, built on the reusable games.pinball_engine."""
import time
from uuid import uuid4

from .base import Game, GameError
from .pinball_engine import Layout, Rules, Table as EngineTable, flipper_pair

WIDTH, HEIGHT, BALL = 10, 17, 0.19
LAUNCH = (9.4, 15.8)
SKILL_CHARGE = (197, 228)
JACKPOT_TICKS = 20 * 240
FLIPPERS = flipper_pair(14.95, 3.22, 6.78)
LENGTH, FLIP_RADIUS = 1.56, 0.15
# Keep the shooter feed open above the rollover dividers.
# The lower guides direct rebounds toward the slings and flippers.
RAILS = (
    (0, 17, 0, 2.2), (0, 2.2, 1.5, 0), (1.5, 0, 7.8, 0),
    (7.8, 0, 10, 2.8), (10, 2.8, 10, 17), (8.8, 3.1, 8.8, 17),
    (8.8, 16.25, 10, 16.25), (0.9, 12.2, 0.9, 13.5), (0.9, 13.5, 3.22, 14.95),
    (7.9, 12.4, 7.9, 13.8), (7.9, 13.8, 6.78, 14.95),
    (3.25, 2.95, 3.25, 4.15), (5.25, 2.95, 5.25, 4.15),
    (2.55, 9.55, 3.15, 10.35), (7.45, 9.55, 6.85, 10.35),
)
# Outlanes run down the walls outside the inlane guides; the left one holds a one-time kickback.
OUTLANE = (0.9, 13.9)
# One-way gate: closed once the ball has left the shooter lane, so it cannot re-enter from the top.
GATE = (8.8, 1.2, 8.8, 3.1)
SLINGS = ((1.35, 10.75, 2.85, 12.5), (7.73, 10.75, 6.48, 12.6))
# Offset the lower bumper to clear a straight shot to the ramp mouth.
BUMPS = ((3.12, 5.65, 0.68), (6.62, 5.7, 0.68), (4.05, 7.64, 0.68))
TARGETS = ((1.25, 6.6, 1.25, 7.3), (1.25, 7.48, 1.25, 8.18), (1.25, 8.36, 1.25, 9.06))
ROLLOVERS = ((2.25, 3.5), (4.25, 3.5), (6.25, 3.5))
SPINNER = (7.95, 7.4)
RAMP = (5.25, 6.02)
RAMP_EXIT = (7.75, 8.6)
GOLDEN_HOUR = Layout(
    rails=RAILS, gate=GATE, slings=SLINGS, bumps=BUMPS, targets=TARGETS, lanes=ROLLOVERS,
    spinner=SPINNER, ramp=RAMP, ramp_exit=RAMP_EXIT, flippers=FLIPPERS, launch=LAUNCH,
    outlane=OUTLANE, width=WIDTH, height=HEIGHT, ball=BALL, flipper_length=LENGTH,
    flipper_radius=FLIP_RADIUS, skill_charge=SKILL_CHARGE)
LAYOUT = GOLDEN_HOUR.public()


class Table(EngineTable):
    layout = GOLDEN_HOUR
    rules = Rules(lock_balls=2)
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
        "Tap or click either half of the playfield to flip on that side. A and D, Z and /, either Shift key, the arrow keys, and the Flip buttons also work. Use Q, W, E or the nudge buttons to move the table.",
        "The fourth nudge tilts the table and ends scoring until that ball drains. Clear all three targets, then shoot the ramp for 6,000 and start a 20-second jackpot round. Repeat ramp shots for 12,000 each. The first lit ramp shot locks your ball and serves a new one; the second releases the locked ball and a spare for three-ball MULTIBALL, where every ramp shot is a jackpot and bumpers pay double.",
        "Each ball has one automatic save during its first four seconds on the playfield. Everyone plays three balls on a separate table. Reach 40,000 and 120,000 points for an extra ball. Highest score wins.",
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
                balls = [(table.x, table.y), *((o["x"], o["y"]) for o in table.others)]
                near = [x for x, y in balls if 13.3 < y < 15.15]   # multiball: cover every ball in reach
                held = (4 if table.charge < 200 else 0) if table.staged else (
                    (1 if near[0] < 5 else 2) if near and self.frames % 20 < 10 else 0)
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
        return {"pinball": {**self.snapshot(), "layout": LAYOUT, "extra": list(Table.rules.extra_ball_scores), "solo": self.solo,
                            "me": p.id if table and not table.departed else None,
                            "epoch": table.epoch if table else None}}
