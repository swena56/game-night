"""Meteor Shot: arc a comet into a glowing ring; the server flies and scores each launch.

Each player fires `shots` comets, one each per round, in turn. A launch has an angle (up), a power and an aim
(left/right); wind bends the comet sideways the longer it flies. The ring drifts during flight, and the ring, wind
and gravity change every round. Each round also hangs ⭐ stars along one route to the ring (fly through them
for points; all of them and the ring is a constellation) and, from round 2, 🪨 asteroids that stop a comet.
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


STAR_PTS, CONSTELLATION = 20, 40      # each star flown through; all of them in one shot that also scores on the ring
STAR_R, ROCK_R = 0.75, 0.8            # how close the comet has to pass to a star, or to hit an asteroid


def at(angle, power, aim, wind, gravity, t):
    """The comet t seconds after launch: (x, y, distance down-range)."""
    rad = math.radians(angle)
    vz, vy = power * math.cos(rad), power * math.sin(rad)
    return math.tan(math.radians(aim)) * vz * t + wind * t * t * 0.8, vy * t - gravity * t * t, vz * t


def along(shot, target, wind, gravity, stars, rocks, steps=90):
    """What a shot meets on the way to the ring's plane: (stars flown through [[index, seconds]], when it hits an
    asteroid or None). Nothing past an asteroid counts."""
    angle, power, aim = shot
    total = target[1] / (power * math.cos(math.radians(angle)))
    got = {}
    for k in range(1, steps + 1):
        t = total * k / steps
        p = at(angle, power, aim, wind, gravity, t)
        if any(math.dist(p, rock) < ROCK_R for rock in rocks):
            return [[i, s] for i, s in got.items()], round(t, 3)
        for i, star in enumerate(stars):
            if i not in got and math.dist(p, star) < STAR_R:
                got[i] = round(t, 3)
    return [[i, s] for i, s in got.items()], None


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
        "Set the angle (how high), power (how far) and aim (left or right), then lead the drifting ring. The guide shows only the first part of the arc.",
        "⭐ Fly through stars on the way: +20 each. All three in a shot that also scores on the ring is a 🌌 constellation: +40 more. One arc can take them all.",
        "🪨 From round 2, asteroids hang in the way: a comet that hits one breaks up and misses the ring (stars it already took still count).",
        "Wind pushes the comet sideways, more the longer it flies. Aim into the wind.",
        "The ring drifts while your comet is in flight, so time your shot.",
        "The ring and wind change every round. Score 80+ to build a streak: each follow-up streak hit adds 15 points (up to +45).",
        "Once per game, fire a Nova shot for 1.5× points. Save it for your best aim—or use it to catch the leader.",
        "🏁 The final round is the Finale: every shot scores double, so nobody is out of it until the last comet.",
        "⚔️ Tied at the top? The tied players get a sudden-death shoot-off: one shot each at a fresh ring, best shot wins (up to three tries).",
        "Gravity shifts between rounds, changing the comet's arc. The current gravity is shown in the HUD and shot preview.",
        "🌀 Some rounds have a twist: a 🌪️ gale doubles the wind, a 🍀 lucky ring pays ×1.5.",
        "The best-scoring shot each round earns a 25-point Round MVP bonus. Tied best shots all earn it.",
    ]
    settings_schema = {"shots": ("Shots", [(3, "3 shots"), (5, "5 shots")], 3),
                       "guide": ("Aim help", [("part", "Start of the arc"), ("full", "Whole path and score estimate (easy)")], "part")}
    stars, rocks, route = (), (), None  # games saved before the star field have none

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
        # 🌀 from round 2 a twist changes the rules of the round: a gale doubles the wind, a lucky ring pays half again
        self.twist = None if getattr(self, "round", 0) == 0 else self.rng.choice((None, "gale", "lucky"))
        if self.twist == "gale":
            self.wind = round(math.copysign(max(0.9, min(1.4, abs(self.wind) * 2)), self.wind or 1), 2)
        self.new_field()

    def new_field(self):
        """Hang this round's stars along one shot that reaches the ring, and asteroids clear of that route."""
        routes = []
        for _ in range(60):
            angle, power = self.rng.uniform(28, 66), self.rng.uniform(10, 19)
            t = self.target[1] / (power * math.cos(math.radians(angle)))
            drift = self.wind * t * t * 0.8
            aim = math.degrees(math.atan((self.target[0] - drift) / self.target[1]))
            x, y = fly(angle, power, aim, self.target, self.wind, self.gravity)
            if AIM[0] <= aim <= AIM[1]:
                routes.append((abs(y - RING_Y), angle, power, aim))
            if routes and routes[-1][0] < 0.5:
                break
        self.stars, self.rocks, self.route = [], [], None
        if not routes:
            return
        _, angle, power, aim = min(routes)
        self.route = [round(angle, 1), round(power, 1), round(aim, 1)]
        total = self.target[1] / (power * math.cos(math.radians(angle)))
        self.stars = [[round(v, 2) for v in at(angle, power, aim, self.wind, self.gravity, total * f)] for f in (0.3, 0.52, 0.74)]
        want = 0 if getattr(self, "round", 0) == 0 else 2 if self.round >= getattr(self, "shots", 3) - 1 else 1
        way = [at(angle, power, aim, self.wind, self.gravity, total * k / 40) for k in range(41)]
        for _ in range(80):
            if len(self.rocks) >= want:
                break
            rock = [round(self.rng.uniform(-2.2, 2.2), 2), round(self.rng.uniform(1.2, 4.8), 2),
                    round(self.target[1] * self.rng.uniform(0.35, 0.75), 2)]
            if all(math.dist(rock, p) > ROCK_R + 0.8 for p in way) and all(math.dist(rock, o) > 1.8 for o in self.rocks):
                self.rocks.append(rock)

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
        if getattr(self, "sd", None):
            return self.shoot_off_shot(p, angle, power, aim, x, y, pts, impact_target, elapsed)
        got, broke = along((angle, power, aim), self.target, self.wind, self.gravity, self.stars, self.rocks)
        if broke is not None:
            pts = 0
        constellation = len(got) >= 3 and pts > 0
        star_pts = STAR_PTS * len(got) + (CONSTELLATION if constellation else 0)
        finale = self.round == self.shots - 1     # 🏁 the last round counts double: a trailing player can still catch up
        lucky = getattr(self, "twist", None) == "lucky"
        scored = int(pts * (1.5 if nova else 1.0) * (2 if finale else 1) * (1.5 if lucky else 1)) + star_pts
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
                     "stars": [list(s) for s in self.stars], "rocks": [list(r) for r in self.rocks],
                     "got": got, "broke": broke, "starPts": star_pts,
                     "n": getattr(self, "fired_total", 0) + 1}
        self.fired_total = self.last["n"]
        tag = " 🎯 Bullseye!" if pts >= 90 else ""
        combo = f" (+{bonus} streak bonus!)" if bonus else ""
        mult = (" 🌟 NOVA ×1.5!" if nova else "") + (" 🏁 FINALE ×2!" if finale else "")
        extra = (" 🪨 broke up on an asteroid!" if broke is not None else "") + (f" ⭐×{len(got)}" if got else "")
        self.room.add_log(f"☄️ {p.name} scores {scored + bonus}{mult}{combo}{tag}{extra} ({p.g.shots}/{self.shots}).", "info")
        if constellation:
            self.moment(f"🌌 {p.name}: CONSTELLATION!", "gold", "fanfare")
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
            if self.twist:
                self.moment("🌪️ GALE: the wind is doubled this round!" if self.twist == "gale" else "🍀 LUCKY RING: every hit pays ×1.5 this round!", "gold", "fanfare")
        elif live and all(self.room.players[i].g.shots >= self.shots for i in live):
            return self.end()
        self.room.advance()

    def wind_text(self):
        w = self.wind
        return "calm" if abs(w) < 0.1 else f"{'→' if w > 0 else '←'} {abs(w):.1f}"

    def gravity_text(self):
        return {3.4: "🌕 low-G", 4.9: "🪐 standard-G", 6.4: "🪨 heavy-G"}.get(self.gravity, "🪐 standard-G")

    SHOOT_OFFS = 3   # ⚔️ a tie at the top is settled by up to this many one-shot shoot-offs between the tied players

    def end(self):
        scores = self.final_scores()
        top = max(scores.values())
        winners = [self.room.players[i] for i, s in scores.items() if s == top]
        if len(winners) == 1:
            return self.room.finish(winners[0], f"🏆 {winners[0].name} wins Meteor Shot with {top} points!")
        if getattr(self, "shootoffs", 0) < self.SHOOT_OFFS:
            return self.start_shoot_off(winners, top)
        return self.room.finish(None, f"🤝 Meteor Shot tied at {top} points!")

    def start_shoot_off(self, tied, top):
        """⚔️ Sudden death: each tied player takes one more shot at a fresh ring; the best shot wins."""
        self.shootoffs = getattr(self, "shootoffs", 0) + 1
        self.sd = [p.id for p in tied]
        self.sd_scores = {}
        self.round += 1
        self.started_at = time.time()
        self.new_target()
        self.twist = None
        self.stars, self.rocks, self.route = [], [], None  # a shoot-off is about the ring alone
        self.last = None
        self.moment(f"⚔️ SHOOT-OFF! {' vs '.join(p.name for p in tied)} tied on {top}: one shot each.", "gold", "alarm")
        self.room.begin_turn(self.sd[0])

    def shoot_off_shot(self, p, angle, power, aim, x, y, pts, impact_target, elapsed):
        self.sd_scores[p.id] = pts
        self.fired_total = getattr(self, "fired_total", 0) + 1
        self.last = {"pid": p.id, "angle": angle, "power": power, "aim": aim, "landing": [round(x, 3), round(y, 3)],
                     "points": pts, "base": pts, "nova": False, "finale": False, "bonus": 0, "streak": 0,
                     "target": list(self.target), "targetImpact": [round(impact_target[0], 3), round(impact_target[1], 3)],
                     "elapsed": elapsed, "wind": self.wind, "gravity": self.gravity, "n": self.fired_total}
        self.room.add_log(f"⚔️ {p.name} shoots off: {pts}.", "info")
        return self.sd_next()

    def sd_next(self):
        if len(self.sd_scores) < len(self.sd):
            return self.room.advance()
        best = max(self.sd_scores.values())
        top = [pid for pid, v in self.sd_scores.items() if v == best]
        if len(top) == 1:
            w = self.room.players[top[0]]
            self.sd = None
            return self.room.finish(w, f"🏆 {w.name} wins the shoot-off ({best} to {max([v for k, v in self.sd_scores.items() if k != top[0]] or [0])}) and Meteor Shot!")
        tied = [self.room.players[i] for i in top]
        self.sd = None
        self.moment("⚔️ Still level!", "gold", None)
        return self.end_tied(tied)

    def end_tied(self, tied):
        if self.shootoffs < self.SHOOT_OFFS:
            return self.start_shoot_off(tied, max(self.final_scores().values()))
        self.sd = None
        return self.room.finish(None, f"🤝 Meteor Shot tied at {max(self.final_scores().values())} points, even after {self.SHOOT_OFFS} shoot-offs!")

    def on_timeout(self):
        r = self.room
        if getattr(self, "sd", None):   # ⚔️ a shoot-off shot that never came scores nothing
            self.sd_scores[r.turn] = 0
            r.add_log(f"⏰ {r.players[r.turn].name} ran out of time in the shoot-off!", "power")
            return self.sd_next()
        super().on_timeout()

    def skip_turn(self, p):
        if getattr(self, "sd", None):
            return p.id not in self.sd or p.id in self.sd_scores
        return p.id not in self.seats or getattr(p.g, "shots", 0) >= self.shots

    def view(self, p):
        g = p.g
        seated = p.id in getattr(self, "seats", [])
        return {"meteor": {"score": getattr(g, "score", 0) if seated else None, "shots": getattr(g, "shots", 0) if seated else 0,
                "shotsMax": self.shots, "finale": getattr(self, "round", 0) == self.shots - 1, "round": getattr(self, "round", 0) + 1, "target": self.target, "wind": self.wind, "twist": getattr(self, "twist", None),
                "stars": [list(s) for s in self.stars], "rocks": [list(r) for r in self.rocks], "guide": self.s.get("guide", "part"),
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

    def worth(self, angle, power, aim, elapsed):
        """What a launch would score from the ring and the star field, for the bots."""
        gravity = getattr(self, "gravity", 4.9)
        impact = self.target_at(elapsed + self.target[1] / (power * math.cos(math.radians(angle))))
        x, y = fly(angle, power, aim, self.target, self.wind, gravity)
        pts = points_for(x, y, self.target, impact[1], impact[0])
        if not self.stars and not self.rocks:
            return pts
        got, broke = along((angle, power, aim), self.target, self.wind, gravity, self.stars, self.rocks, steps=45)
        if broke is not None:
            pts = 0
        return pts + STAR_PTS * len(got) + (CONSTELLATION if len(got) >= 3 and pts else 0)

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
                value = self.worth(angle, power, aim, elapsed)
                if value > best[0]:
                    best = (value, angle, power, aim)
        if self.route and (p.bot or "normal") != "easy":   # the starry route, for a bot good enough to spot it
            value = self.worth(*self.route, elapsed)
            if value > best[0]:
                best = (value, *self.route)
        sa, sp, sm = BOT_ERR.get(p.bot or "normal", BOT_ERR["normal"])
        g = self.rng.gauss
        # Bots hold their one Nova for halfway through, unless they are chasing the leader.
        scores = [self.room.players[i].g.score for i in self.live_seats()]
        trailing = p.g.score < max(scores, default=0)
        use_nova = getattr(p.g, "nova", True) and (p.g.shots >= self.shots // 2 or trailing)
        self.act(p, {"type": "fire", "angle": best[1] + g(0, sa), "power": best[2] + g(0, sp), "aim": best[3] + g(0, sm), "nova": use_nova})
