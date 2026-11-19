"""Meteor Shot: arc a comet into a glowing ring; the server flies and scores each launch.

Each player fires `shots` comets, one each per round, in turn. A launch has an angle (up), a power and an aim
(left/right); wind bends the comet sideways the longer it flies. The ring and the wind change every round.
"""
import math
import time

from .base import Game, GameError

RING_Y = 2.2                      # the ring's height in the scene (the client draws it at the same height)
ANGLE, POWER, AIM = (18, 72), (8, 20), (-16, 16)
BOT_ERR = {"easy": (7.0, 2.2, 4.0), "normal": (3.5, 1.1, 2.0), "hard": (1.5, 0.45, 0.8)}  # σ angle°, power, aim°


def clamp(v, lo_hi):
    return max(lo_hi[0], min(lo_hi[1], v))


def fly(angle, power, aim, target, wind):
    """Where a launch crosses the ring's plane: (x, y). Same maths on the client for the flight path."""
    rad = math.radians(angle)
    vz, vy = power * math.cos(rad), power * math.sin(rad)
    t = target[1] / max(0.01, vz)
    x = math.tan(math.radians(aim)) * target[1] + wind * t * t * 0.8
    return x, vy * t - 4.9 * t * t


def points_for(x, y, target):
    return max(0, 100 - int(math.hypot(x - target[0], y - RING_Y) * 22))


class MeteorShot(Game):
    id = "meteorshot"
    category = "action"
    name = "Meteor Shot"
    icon = "☄️"
    blurb = "Shape a comet's arc and thread it through a 3D cosmic target."
    min_players = 1
    max_players = 6
    howto = [
        "Set the angle (how high), power (how far) and aim (left or right), then fire a comet at the ring.",
        "Wind pushes the comet sideways, more the longer it flies. Aim into the wind.",
        "The ring and the wind change every round. Closer hits score more (100 dead centre); highest total wins.",
    ]
    settings_schema = {"shots": ("Shots", [(3, "3 shots"), (5, "5 shots")], 3)}

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.shots = int(self.s.get("shots", 3))
        self.round = 0
        self.fired = 0                # launches this round
        self.last = None
        self.new_target()
        self.room.turn = self.seats[0]
        timer = self.room.settings.get("timer")
        self.room.deadline = time.time() + timer if timer else None
        for p in seated:
            p.g.score = 0
            p.g.shots = 0
            p.g.best = 0
        self.room.add_log(f"☄️ Meteor Shot! {self.shots} launches each: thread the ring.", "big")

    def new_target(self):
        self.target = [round(self.rng.uniform(-2.8, 2.8), 2), round(self.rng.uniform(8.5, 12.0), 2)]
        self.wind = round(self.rng.uniform(-0.7, 0.7), 2)

    def live_seats(self):
        return [i for i in self.seats if i in self.room.players and not self.room.players[i].spectator]

    def act(self, p, a):
        self.require_turn(p)
        if a.get("type") != "fire":
            raise GameError("Unknown action.")
        angle, power, aim = a.get("angle"), a.get("power"), a.get("aim", 0)
        nums = (angle, power, aim)
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in nums):
            raise GameError("Set an angle and power first.")
        angle, power, aim = round(clamp(angle, ANGLE), 1), round(clamp(power, POWER), 1), round(clamp(aim, AIM), 1)
        x, y = fly(angle, power, aim, self.target, self.wind)
        pts = points_for(x, y, self.target)
        p.g.score += pts
        p.g.shots += 1
        p.g.best = max(getattr(p.g, "best", 0), pts)
        self.last = {"pid": p.id, "angle": angle, "power": power, "aim": aim, "landing": [round(x, 3), round(y, 3)],
                     "points": pts, "target": list(self.target), "wind": self.wind, "n": getattr(self, "fired_total", 0) + 1}
        self.fired_total = self.last["n"]
        tag = " 🎯 Bullseye!" if pts >= 90 else ""
        self.room.add_log(f"☄️ {p.name} scores {pts}{tag} ({p.g.shots}/{self.shots}).", "info")
        if pts >= 90:
            self.moment(f"🎯 {p.name}: {pts}!", "gold", "fanfare")
        live = self.live_seats()
        if all(self.room.players[i].g.shots >= self.shots for i in live):
            return self.end()
        self.fired = getattr(self, "fired", 0) + 1
        if self.fired >= len(live):   # everyone has fired this round: a new ring and new wind
            self.fired = 0
            self.round += 1
            self.new_target()
            self.room.add_log(f"🌠 Round {self.round + 1}: the ring moves; wind {self.wind_text()}.", "info")
        self.room.advance()

    def wind_text(self):
        w = self.wind
        return "calm" if abs(w) < 0.1 else f"{'→' if w > 0 else '←'} {abs(w):.1f}"

    def end(self):
        scores = self.final_scores()
        top = max(scores.values())
        winners = [self.room.players[i] for i, s in scores.items() if s == top]
        if len(winners) == 1:
            return self.room.finish(winners[0], f"🏆 {winners[0].name} wins Meteor Shot with {top} points!")
        return self.room.finish(None, f"🤝 Meteor Shot tied at {top} points!")

    def skip_turn(self, p):
        return p.id not in self.seats or getattr(p.g, "shots", 0) >= self.shots

    def view(self, p):
        g = p.g
        seated = p.id in getattr(self, "seats", [])
        return {"meteor": {"score": getattr(g, "score", 0) if seated else None, "shots": getattr(g, "shots", 0) if seated else 0,
                "shotsMax": self.shots, "round": getattr(self, "round", 0) + 1, "target": self.target, "wind": self.wind,
                "last": self.last, "board": [{"id": i, "name": self.room.players[i].name, "score": self.room.players[i].g.score,
                                              "shots": self.room.players[i].g.shots}
                                             for i in self.seats if i in self.room.players]}}

    def meta(self, p):
        return f"☄️{p.g.score}" if hasattr(p.g, "score") else ""

    def final_scores(self):
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def bot_turn(self, p):
        # the best launch on a coarse grid, then a level-sized wobble in the hand
        best = (-1, 45, 14, 0)
        for angle in range(18, 73, 2):
            for power in range(8, 21):
                rad = math.radians(angle)
                t = self.target[1] / (power * math.cos(rad))
                drift = self.wind * t * t * 0.8
                aim = clamp(math.degrees(math.atan((self.target[0] - drift) / self.target[1])), AIM)
                pts = points_for(*fly(angle, power, aim, self.target, self.wind), self.target)
                if pts > best[0]:
                    best = (pts, angle, power, aim)
        sa, sp, sm = BOT_ERR.get(p.bot or "normal", BOT_ERR["normal"])
        g = self.rng.gauss
        self.act(p, {"type": "fire", "angle": best[1] + g(0, sa), "power": best[2] + g(0, sp), "aim": best[3] + g(0, sm)})
