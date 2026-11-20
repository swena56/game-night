"""Meteor Shot: arc a comet into a glowing ring; the server flies and scores each launch.

Each player fires `shots` comets, one each per round, in turn. A launch has an angle (up), a power and an aim
(left/right); wind bends the comet sideways the longer it flies. The ring drifts during flight, and the ring, wind
and gravity change every round.
"""
import math
import time

from .base import Game, GameError

RING_Y = 2.2                      # the ring's height in the scene (the client draws it at the same height)
ANGLE, POWER, AIM = (18, 72), (8, 20), (-16, 16)
BOT_ERR = {"easy": (7.0, 2.2, 4.0), "normal": (3.5, 1.1, 2.0), "hard": (1.5, 0.45, 0.8)}  # σ angle°, power, aim°


def clamp(v, lo_hi):
    return max(lo_hi[0], min(lo_hi[1], v))


def fly(angle, power, aim, target, wind, gravity=4.9):
    """Where a launch crosses the ring's plane: (x, y). Same maths on the client for the flight path."""
    rad = math.radians(angle)
    vz, vy = power * math.cos(rad), power * math.sin(rad)
    t = target[1] / max(0.01, vz)
    x = math.tan(math.radians(aim)) * target[1] + wind * t * t * 0.8
    return x, vy * t - gravity * t * t


def points_for(x, y, target, center_y=RING_Y, center_x=None):
    center_x = target[0] if center_x is None else center_x
    return max(0, 100 - int(math.hypot(x - center_x, y - center_y) * 22))


class MeteorShot(Game):
    id = "meteorshot"
    category = "action"
    name = "Meteor Shot"
    icon = "☄️"
    blurb = "Shape a comet's arc and thread it through a 3D cosmic target."
    min_players = 1
    max_players = 6
    howto = [
        "Set the angle (how high), power (how far) and aim (left or right), then lead the drifting ring.",
        "Wind pushes the comet sideways, more the longer it flies. Aim into the wind.",
        "The ring drifts while your comet is in flight. Lead its ghost ring and time your shot using the live score estimate.",
        "The ring and wind change every round. Score 80+ to build a streak: each follow-up streak hit adds 15 points (up to +45).",
        "Once per game, fire a Nova shot for 1.5× points. Save it for your best aim—or use it to catch the leader.",
        "🏁 The final round is the Finale: every shot scores double, so nobody is out of it until the last comet.",
        "Gravity shifts between rounds, changing the comet's arc. The current gravity is shown in the HUD and shot preview.",
        "The best-scoring shot each round earns a 25-point Round MVP bonus. Tied best shots all earn it.",
    ]
    settings_schema = {"shots": ("Shots", [(3, "3 shots"), (5, "5 shots")], 3)}

    def start(self, seated, rng):
        self.rng = rng
        self.started_at = time.time()
        self.seats = [p.id for p in seated]
        self.shots = int(self.s.get("shots", 3))
        self.round = 0
        self.fired = 0                # launches this round
        self.round_scores = {}
        self.mvp = None
        self.last = None
        self.new_target()
        self.room.turn = self.seats[0]
        timer = self.room.settings.get("timer")
        self.room.deadline = time.time() + timer if timer else None
        for p in seated:
            p.g.score = 0
            p.g.shots = 0
            p.g.best = 0
            p.g.nova = True
        self.room.add_log(f"☄️ Meteor Shot! {self.shots} launches each: lead the drifting ring. {self.gravity_text()} this round.", "big")

    def new_target(self):
        self.target = [round(self.rng.uniform(-2.45, 2.45), 2), round(self.rng.uniform(8.5, 12.0), 2)]
        self.target_phase = self.rng.uniform(0, math.tau)
        self.target_drift = self.rng.uniform(0.35, 0.7)
        self.target_speed = self.rng.uniform(0.75, 1.05)
        self.wind = round(self.rng.uniform(-0.7, 0.7), 2)
        self.gravity = self.rng.choice((3.4, 4.9, 6.4))

    def target_at(self, elapsed):
        phase = getattr(self, "target_phase", 0) + elapsed * getattr(self, "target_speed", 0)
        drift = getattr(self, "target_drift", 0)
        return (self.target[0] + drift * math.sin(phase), RING_Y + drift * 0.2 * math.cos(phase * 0.8))

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
        nova = a.get("nova", False)
        if not isinstance(nova, bool):
            raise GameError("Invalid Nova shot.")
        if nova and not getattr(p.g, "nova", True):
            raise GameError("Your Nova shot has already been used.")
        angle, power, aim = round(clamp(angle, ANGLE), 1), round(clamp(power, POWER), 1), round(clamp(aim, AIM), 1)
        elapsed = time.time() - getattr(self, "started_at", time.time())
        flight = self.target[1] / (power * math.cos(math.radians(angle)))
        impact_target = self.target_at(elapsed + flight)
        x, y = fly(angle, power, aim, self.target, self.wind, self.gravity)
        pts = points_for(x, y, self.target, impact_target[1], impact_target[0])
        finale = self.round == self.shots - 1     # 🏁 the last round counts double: a trailing player can still catch up
        scored = int(pts * (1.5 if nova else 1.0) * (2 if finale else 1))
        p.g.score += scored
        p.g.shots += 1
        p.g.best = max(getattr(p.g, "best", 0), scored)
        p.g.streak = getattr(p.g, "streak", 0) + 1 if pts >= 80 else 0
        bonus = min(45, max(0, p.g.streak - 1) * 15)
        p.g.score += bonus
        if nova:
            p.g.nova = False
        self.last = {"pid": p.id, "angle": angle, "power": power, "aim": aim, "landing": [round(x, 3), round(y, 3)],
                     "points": scored + bonus, "base": pts, "nova": nova, "finale": finale, "bonus": bonus, "streak": p.g.streak,
                     "target": list(self.target), "targetImpact": [round(impact_target[0], 3), round(impact_target[1], 3)],
                     "elapsed": elapsed, "wind": self.wind, "gravity": self.gravity,
                     "n": getattr(self, "fired_total", 0) + 1}
        self.fired_total = self.last["n"]
        tag = " 🎯 Bullseye!" if pts >= 90 else ""
        combo = f" (+{bonus} streak bonus!)" if bonus else ""
        mult = (" 🌟 NOVA ×1.5!" if nova else "") + (" 🏁 FINALE ×2!" if finale else "")
        self.room.add_log(f"☄️ {p.name} scores {scored + bonus}{mult}{combo}{tag} ({p.g.shots}/{self.shots}).", "info")
        if pts >= 90:
            self.moment(f"🎯 {p.name}: {scored + bonus}!", "gold", "fanfare")
        live = self.live_seats()
        self.fired = getattr(self, "fired", 0) + 1
        self.round_scores = getattr(self, "round_scores", {})
        self.round_scores[p.id] = scored + bonus
        if live and self.fired >= len(live):   # everyone's shot is in: award the round's best hit
            top = max(self.round_scores.values())
            winners = [i for i, score in self.round_scores.items() if score == top]
            for pid in winners:
                self.room.players[pid].g.score += 25
            self.mvp = {"round": self.round + 1, "pids": winners, "points": top, "bonus": 25}
            names = [self.room.players[i].name for i in winners]
            if len(names) == 1:
                self.room.add_log(f"🏅 {names[0]} wins Round MVP (+25)!", "big")
                self.moment(f"🏅 Round MVP: {names[0]} +25", "gold", "fanfare")
            else:
                self.room.add_log(f"🏅 Round MVP tie: {', '.join(names)} each earn +25!", "big")
            self.fired = 0
            self.round_scores = {}
            if all(self.room.players[i].g.shots >= self.shots for i in live):
                return self.end()
            self.round += 1
            self.new_target()
            if self.round == self.shots - 1:
                self.moment("🏁 FINALE: every point counts double!", "gold", "fanfare")
            self.room.add_log(f"🌠 Round {self.round + 1}: the ring moves; wind {self.wind_text()}, gravity {self.gravity_text()}.", "info")
        elif live and all(self.room.players[i].g.shots >= self.shots for i in live):
            return self.end()
        self.room.advance()

    def wind_text(self):
        w = self.wind
        return "calm" if abs(w) < 0.1 else f"{'→' if w > 0 else '←'} {abs(w):.1f}"

    def gravity_text(self):
        return {3.4: "🌕 low-G", 4.9: "🪐 standard-G", 6.4: "🪨 heavy-G"}.get(self.gravity, "🪐 standard-G")

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
                "shotsMax": self.shots, "finale": getattr(self, "round", 0) == self.shots - 1, "round": getattr(self, "round", 0) + 1, "target": self.target, "wind": self.wind,
                "gravity": getattr(self, "gravity", 4.9), "elapsed": time.time() - getattr(self, "started_at", time.time()),
                "motion": {"phase": getattr(self, "target_phase", 0), "drift": getattr(self, "target_drift", 0),
                           "speed": getattr(self, "target_speed", 0)},
                "last": self.last, "board": [{"id": i, "name": self.room.players[i].name, "score": self.room.players[i].g.score,
                                              "shots": self.room.players[i].g.shots, "streak": getattr(self.room.players[i].g, "streak", 0),
                                              "nova": getattr(self.room.players[i].g, "nova", True)}
                                             for i in self.seats if i in self.room.players], "mvp": getattr(self, "mvp", None)}}

    def meta(self, p):
        return f"☄️{p.g.score}" if hasattr(p.g, "score") else ""

    def final_scores(self):
        return {i: self.room.players[i].g.score for i in self.seats if i in self.room.players}

    def bot_turn(self, p):
        # the best launch on a coarse grid, then a level-sized wobble in the hand
        best = (-1, 45, 14, 0)
        elapsed = time.time() - getattr(self, "started_at", time.time())
        for angle in range(18, 73, 2):
            for power in range(8, 21):
                rad = math.radians(angle)
                t = self.target[1] / (power * math.cos(rad))
                drift = self.wind * t * t * 0.8
                impact = self.target_at(elapsed + t)
                aim = clamp(math.degrees(math.atan((impact[0] - drift) / self.target[1])), AIM)
                x, y = fly(angle, power, aim, self.target, self.wind, getattr(self, "gravity", 4.9))
                pts = points_for(x, y, self.target, impact[1], impact[0])
                if pts > best[0]:
                    best = (pts, angle, power, aim)
        sa, sp, sm = BOT_ERR.get(p.bot or "normal", BOT_ERR["normal"])
        g = self.rng.gauss
        # Bots hold their one Nova for halfway through, unless they are chasing the leader.
        scores = [self.room.players[i].g.score for i in self.live_seats()]
        trailing = p.g.score < max(scores, default=0)
        use_nova = getattr(p.g, "nova", True) and (p.g.shots >= self.shots // 2 or trailing)
        self.act(p, {"type": "fire", "angle": best[1] + g(0, sa), "power": best[2] + g(0, sp), "aim": best[3] + g(0, sm), "nova": use_nova})
