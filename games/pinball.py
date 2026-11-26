"""Golden Hour: the Game Night pinball table, built on the reusable games.pinball_engine."""
import time
from uuid import uuid4

from .base import Game, GameError
from . import pinball_custom, pinball_tables
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
# Scoop on the upper left: holds the ball briefly, then kicks it back toward the bumpers.
SAUCER = (1.6, 4.7, 0.3)
# Left orbit: a wall-hugging wire lane from the left wall up and across the top, closed by a diverter after each use.
ORBIT = (0.5, 5.6, 0.4)
ORBIT_PATH = ((0.5, 5.6), (0.45, 3.2), (1.0, 1.2), (2.2, 0.7), (7.0, 0.8))
ORBIT_EXIT = (-1, 6)
# Right outlane special: lit at 2x or more, awards a ball save once per ball.
SPECIAL = (7.9, 13.9)
# Rubber posts cap the rollover dividers and guard the slingshot tips.
POSTS = ((3.25, 2.85, 0.11), (5.25, 2.85, 0.11), (3.55, 12.9, 0.11), (6.45, 12.9, 0.11),
         (0.9, 12.1, 0.09), (7.9, 12.3, 0.13))
# The magnet sits mid-table and only wakes during jackpot rounds and multiball.
MAGNET = (5.0, 9.6, 1.1)
# Subway: a mouth by the right wall drops the ball under the playfield; it comes back up on the left.
SUBWAY = (8.15, 4.8, 0.3)
SUBWAY_EXIT = (2.0, 8.9, 4, 5)
RAMP = (5.25, 6.02)
RAMP_EXIT = (7.75, 8.6)
GOLDEN_HOUR = Layout(
    rails=RAILS, gate=GATE, slings=SLINGS, bumps=BUMPS, targets=TARGETS, lanes=ROLLOVERS,
    spinner=SPINNER, ramp=RAMP, ramp_exit=RAMP_EXIT, flippers=FLIPPERS, launch=LAUNCH,
    outlane=OUTLANE, saucer=SAUCER, orbit=ORBIT, orbit_path=ORBIT_PATH, orbit_exit=ORBIT_EXIT, special=SPECIAL, posts=POSTS, magnet=MAGNET, subway=SUBWAY, subway_exit=SUBWAY_EXIT, width=WIDTH, height=HEIGHT, ball=BALL, flipper_length=LENGTH,
    flipper_radius=FLIP_RADIUS, skill_charge=SKILL_CHARGE)
LAYOUT = GOLDEN_HOUR.public()

# Neon Arcade: the same cabinet and outer walls with a busier field - four bumpers in a zig-zag, shifted
# inlane guides and a hotter rule set (more points, quicker hurry-up, extra balls come later).
NEON_BUMPS = ((2.7, 5.4, 0.6), (6.7, 4.95, 0.6), (3.0, 7.9, 0.5), (6.35, 8.15, 0.5))
NEON_FLIPPERS = flipper_pair(14.95, 3.22, 6.78, rest=0.46, up=0.70)   # a steeper bat for the busier table
NEON_RAILS = RAILS[:-2] + ((2.3, 9.4, 3.05, 10.3), (7.7, 9.4, 6.95, 10.3))
NEON_ARCADE = Layout(
    rails=NEON_RAILS, gate=GATE, slings=SLINGS, bumps=NEON_BUMPS, targets=TARGETS, lanes=ROLLOVERS,
    spinner=SPINNER, ramp=RAMP, ramp_exit=RAMP_EXIT, flippers=NEON_FLIPPERS, launch=LAUNCH,
    outlane=OUTLANE, saucer=SAUCER, orbit=ORBIT, orbit_path=ORBIT_PATH, orbit_exit=ORBIT_EXIT, special=SPECIAL, posts=POSTS, magnet=MAGNET, subway=SUBWAY, subway_exit=SUBWAY_EXIT, width=WIDTH, height=HEIGHT, ball=BALL, flipper_length=LENGTH,
    flipper_radius=FLIP_RADIUS, skill_charge=SKILL_CHARGE, theme="neon")


class Table(EngineTable):
    layout = GOLDEN_HOUR
    rules = Rules(lock_balls=2, center_post=True)


class NeonTable(EngineTable):
    layout = NEON_ARCADE
    rules = Rules(lock_balls=2, center_post=True, bumper=150, bumper_jackpot=300, sling=75, target=300,
                  lane=600, ramp=8000, jackpot=15000, hurry_ticks=6 * 240, hurry_max=20000,
                  extra_ball_scores=(60000, 160000), super_every=3, gravity=11.6)


# Sandbox: the same cabinet, flippers and shooter lane with every playfield part removed except the one you pick,
# so each component can be play tested on its own. (Golden Hour and Neon Arcade are untouched.)
def fillet(points, radii, steps=7):
    """A polyline with every interior corner swapped for a circular arc, returned as short rail segments (no sharp edges)."""
    import math
    out = [points[0]]
    for i in range(1, len(points) - 1):
        (ax, ay), (bx, by), (cx, cy) = points[i - 1], points[i], points[i + 1]
        r = radii[i - 1]
        v1, v2 = (ax - bx, ay - by), (cx - bx, cy - by)
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        u1, u2 = (v1[0] / l1, v1[1] / l1), (v2[0] / l2, v2[1] / l2)
        ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
        if r <= 0 or ang > math.pi - 1e-3:
            out.append((bx, by)); continue
        d = min(r / math.tan(ang / 2), l1 / 2 if i > 1 else l1 * .9, l2 / 2 if i < len(points) - 2 else l2 * .9)
        r = d * math.tan(ang / 2)
        p1, p2 = (bx + u1[0] * d, by + u1[1] * d), (bx + u2[0] * d, by + u2[1] * d)
        bis = (u1[0] + u2[0], u1[1] + u2[1]); bl = math.hypot(*bis)
        cd = r / math.sin(ang / 2)
        ctr = (bx + bis[0] / bl * cd, by + bis[1] / bl * cd)
        a1, a2 = math.atan2(p1[1] - ctr[1], p1[0] - ctr[0]), math.atan2(p2[1] - ctr[1], p2[0] - ctr[0])
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for k in range(steps + 1):
            a = a1 + da * k / steps
            out.append((round(ctr[0] + r * math.cos(a), 3), round(ctr[1] + r * math.sin(a), 3)))
    out.append(points[-1])
    return tuple((*a, *b) for a, b in zip(out, out[1:]))


# Empty-table cabinet: the outer wall as one smooth sweep (round top corners, a soft shooter-lane turn) and gently
# rounded inlane/outlane guide bends.
SMOOTH_WALL = fillet(((0, 17), (0, 2.2), (1.5, 0), (7.8, 0), (10, 2.8), (10, 17)), (1.9, 1.3, 1.6, 1.9))
LEFT_GUIDE = fillet(((0.9, 12.2), (0.9, 13.5), (3.22, 14.95)), (0.5,))
RIGHT_GUIDE = fillet(((7.9, 12.4), (7.9, 13.8), (6.78, 14.95)), (0.5,))
SMOOTH_GUIDES = LEFT_GUIDE + RIGHT_GUIDE
BASE_RAILS = SMOOTH_WALL + ((8.8, 3.1, 8.8, 17), (8.8, 16.25, 10, 16.25)) + SMOOTH_GUIDES
# rails from here on are the livelier metal guides: the right inlane guide, then anything the table adds
GUIDES_FROM = len(BASE_RAILS) - len(RIGHT_GUIDE)
BARE_TABLE = Layout(rails=BASE_RAILS, flippers=FLIPPERS, launch=LAUNCH, gate=GATE, width=WIDTH, height=HEIGHT, ball=BALL,
                    flipper_length=LENGTH, flipper_radius=FLIP_RADIUS, skill_charge=SKILL_CHARGE, theme="custom",
                    guides_from=GUIDES_FROM, guide_run=len(RIGHT_GUIDE))


# per-mode starting state: practice and time attack never run out of balls; time attack is three minutes of play
MODES = {"classic": {}, "zen": dict(mode="zen"), "practice": dict(mode="practice", balls=99),
         "timeattack": dict(mode="timeattack", balls=99, clock=180 * 240)}
class CustomTable(EngineTable):
    """A table from the editor: the layout arrives with each game (layout_override); this one is only the fallback."""
    layout = BARE_TABLE
    rules = Rules(lock_balls=0, center_post=True, always_on=True)


# Player-made tables that were added to the curated list (see docs/pinball-tables.md): one folder of JSON files, one lobby entry each.
CURATED = pinball_tables.load()


_OFFICIAL = {}


def official_spec(key):
    """The editor table the official Golden Hour / Neon Arcade is played from (games/pinball_official/*.json, read once)."""
    if not _OFFICIAL:
        from .pinball_clone import clone_specs
        _OFFICIAL.update(clone_specs())
    return _OFFICIAL[key]


TABLES = {"golden": ("Golden Hour", Table), "neon": ("Neon Arcade", NeonTable), "custom": ("My table", CustomTable),
          **{table_id: (entry["name"], CustomTable) for table_id, entry in CURATED.items()}}


class Pinball(Game):
    id = "pinball"
    name = "Pinball"
    category = "action"
    icon = "🕹️"
    min_players, max_players = 1, 6
    replayable = False
    # curated tables are listed after the built-in ones so records for Golden Hour and Neon keep their keys
    settings_schema = {"table": ("Table", [("golden", "🌇 Golden Hour"), ("neon", "🌃 Neon Arcade"),
                                           *((table_id, f"⭐ {entry['name']}") for table_id, entry in CURATED.items()),
                                           ("custom", "🛠️ My table (from the editor)")], "golden"),
                       "mode": ("Mode", [("classic", "🎱 Classic"), ("timeattack", "⏱️ Time attack (3 min)"),
                                         ("zen", "🧘 Zen (no tilt)"), ("practice", "🎯 Practice (endless)")], "classic")}
    blurb = "Three balls on a colorful chrome-trimmed table. Bank shots off the bumpers, light the ramp, and chase a high score."
    tip_lines = 2
    howto = [
        "Pull down on the plunger shaft at the right side of the playfield and release to launch. You can also hold and release Space or Launch. Aim for the gold charge band for a skill shot: the lit gold lane pays 5,000 and changes every ball.",
        "Tap or click either half of the playfield to flip on that side. A and D, Z and /, either Shift key, the arrow keys, and the Flip buttons also work. On a gamepad use the triggers, bumpers or d-pad to flip, A to launch, and X, Y and B to nudge. Use Q, W, E or the nudge buttons to move the table; the fourth nudge tilts it and ends scoring until that ball drains.",
        "Clear all three targets, then shoot the ramp for 6,000 and start a 20-second jackpot round (12,000 per ramp shot; every fourth is a 50,000 super jackpot). The first ramp shot also locks your ball; the second releases it plus a spare for three-ball MULTIBALL, where every ramp shot is a jackpot and bumpers pay double. Each ramp shot also starts a 30-second mission (bumpers, spinner, slings or rollovers) worth a bonus. Eight jackpots in a game start a free four-ball Wizard multiball.",
        "Complete all rollover lanes for a multiplier, a re-armed left kickback and an 8-second spinner hurry-up worth up to 15,000. The spinner and bumpers pay more the more you hit them. Every third hit on the lit 2× shot awards a mystery prize: bonus points, a ball save, a multiplier, or a held bonus that carries to your next ball.",
        "Each ball has one automatic save during its first four seconds on the playfield, and once per game a centre post catches a draining ball. Neon Arcade is a busier table with four bumpers and bigger scores; its extra balls come at 60,000 and 160,000. Reach 40,000 and 120,000 on Golden Hour for an extra ball. Everyone plays three balls on a separate table. Highest score wins.",
    ]

    def check_players(self, seated):
        super().check_players(seated)
        # checked before the room changes phase, so a refused start leaves the lobby as it was
        if self.s.get("table") == "custom" and not getattr(self.room, "custom_table", None):
            raise GameError("Build a table in the table editor first (home screen, 🛠️ Pinball table editor).")

    def start(self, seated, rng):
        self.table_id = self.s.get("table") if self.s.get("table") in TABLES else "golden"
        table_class = TABLES[self.table_id][1]
        self.mode = self.s.get("mode") if self.s.get("mode") in MODES else "classic"
        start = dict(MODES[self.mode])
        spec = None
        if self.table_id == "custom":
            start["balls"] = 99        # a table you are building never runs out of balls
            spec = getattr(self.room, "custom_table", None)
            if not spec:
                raise GameError("Build a table in the table editor first.")
        elif self.table_id in CURATED:
            spec = CURATED[self.table_id]["spec"]
        elif self.table_id in ("golden", "neon"):      # the official tables are editor tables too: games/pinball_official/*.json
            spec = official_spec(self.table_id)
        if spec:
            self.custom_layout = pinball_custom.build(spec, self.mode)[0]
            start["layout_override"] = self.custom_layout
            start["rules_override"] = pinball_custom.build_rules(spec)
        self.tables = {p.id: table_class(**start) for p in seated}
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

    def layout_public(self):
        if getattr(self, "custom_layout", None) is not None:
            return self.custom_layout.public()
        return TABLES[getattr(self, "table_id", "golden")][1].layout.public()

    def view(self, p):
        table = self.tables.get(p.id)
        return {"pinball": {**self.snapshot(), "layout": self.layout_public(), "table": getattr(self, "table_id", "golden"),
                            "extra": list(TABLES[getattr(self, "table_id", "golden")][1].rules.extra_ball_scores), "solo": self.solo,
                            "me": p.id if table and not table.departed else None,
                            "epoch": table.epoch if table else None}}
