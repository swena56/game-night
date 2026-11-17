"""Wind Archery: an original turn-based archery game for 2–6 players.

Everyone shoots at the same target in the same wind, one arrow a turn. The sight is zeroed for the distance,
so only the wind moves an arrow: it drifts by K × wind × (flight time)², which grows fast with the range
(30 m, 50 m, 70 m). The flag shows the end's wind, but the real wind runs a little stronger or weaker than
the flag says for the whole end (the hidden `bias`), and every arrow meets its own small gust, so the way to
score is to watch where the arrows land (every shot shows where it was aimed) and correct.

🍎 An apple is pinned to the boss each end: the first arrow through it scores +5. 🧘 Once a game a player can
take a steady breath: no sight sway in the browser and no gust on that arrow.

Nothing is simulated step by step: the server works out where the arrow lands and browsers draw the flight.
"""
import math
import random
import time

from .base import Game, GameError

ARROW_V = 60.0        # m/s
K = 0.055             # drift = K × wind (m/s) × t²
RING = 0.061          # width of one scoring ring (a 122 cm face)
FACE = 10 * RING      # the face's radius
DISTS = (30, 50, 70)
ARROWS = 3            # arrows each per end
AIM = 1.2             # the sight can point this far from the centre, each way
APPLE_R = 0.06        # an arrow this close to the apple's centre hits it
APPLE_PTS = 5
SPLIT = 0.02          # landing this close to an arrow in the boss splits it
HOLD_STEADY, HOLD_GIVE, HOLD_SCATTER = 2.0, 9.0, 0.03   # #128: a draw is steady this long, gives out at this, wanders up to this much
HIT_PAUSE = 1.7       # seconds on the hit close-up before the next archer
END_PAUSE = 5.0
# wind setting -> (weakest, strongest wind in m/s, the end's hidden bias σ, each arrow's gust σ)
WINDS = {"calm": (0.4, 2.0, 0.05, 0.03), "breezy": (2.0, 6.0, 0.12, 0.06), "gusty": (4.0, 9.0, 0.20, 0.14)}


def flight(dist):
    """Seconds an arrow is in the air."""
    return dist / ARROW_V


def drift(wind, dist):
    """How far the wind (wx, wy) in m/s carries an arrow over `dist` metres: (dx, dy) on the target."""
    t2 = flight(dist) ** 2
    return K * wind[0] * t2, K * wind[1] * t2


def land(ax, ay, wind, dist, factor=1.0):
    """Where an arrow aimed at (ax, ay) lands when the real wind is `factor` × the flag's wind."""
    dx, dy = drift(wind, dist)
    return ax + dx * factor, ay + dy * factor


def score_at(x, y):
    """(ring score 0–10, is it an X)."""
    d = math.hypot(x, y)
    if d >= FACE:
        return 0, False
    return 10 - int(d / RING), d < RING / 2


def show_time(dist):
    """Seconds the browsers take to show the flight (slower than the real thing so it can be followed)."""
    return round(0.9 + dist / 70, 2)


def kmh(wind):
    return round(math.hypot(*wind) * 3.6)


class Archery(Game):
    id = "archery"
    category = "action"
    family = None
    howto = [
        "Take turns shooting one arrow at the target. Drag the sight over the target and let go (or tap 🏹 Loose). The sight sways more the longer you hold.",
        "The wind carries every arrow: watch the flag and aim into the wind. The further the target (30 m, 50 m, 70 m), the more an arrow drifts.",
        "The flag is only a guide: the real wind is a bit stronger or weaker each end. Every shot shows where it was aimed, so learn from each arrow, rivals' too.",
        "Rings score 10 (gold) down to 1; off the face scores nothing. 🍎 The first arrow through the apple scores +5.",
        "🧘 Once a game, take a steady breath: no sway and no gust on that arrow. Most points after the last end wins; ties go to the most dead-centre ✖ shots.",
    ]
    name = "Wind Archery"
    icon = "🎯"
    blurb = "Read the flag, aim into the wind and loose. Gold scores 10, the 🍎 apple +5, and every arrow teaches you the wind."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "centre": ("🎯", "Dead centre", "Put an arrow in the ✖ at the very middle"),
              "apple": ("🍎", "Apple shot", "Shoot the apple off the boss"),
              "split": ("🏹", "Split the arrow", "Land an arrow on one already in the target")}
    settings_schema = {
        "ends": ("Ends", [(3, "3"), (2, "2"), (5, "5")], 3),
        "wind": ("Wind", [("breezy", "🍃 Breezy"), ("gusty", "🌬 Gusty"), ("calm", "🪶 Calm")], "breezy"),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.points = [0] * n
        self.xs = [0] * n               # dead-centre shots, the tie-break
        self.breath = [True] * n        # 🧘 still to use
        self.ends_log = []              # one row per end so far: points per seat
        self.end_no = 0
        self.shot, self.shot_id = None, 0
        self.between = False
        self.ready_at = 0.0
        ends = self.total_ends
        self.room.add_log(f"🎯 Wind Archery: {ends} end{'s' if ends != 1 else ''}, {ARROWS} arrows each per end. Aim into the wind!", "big")
        self.new_end()

    @property
    def total_ends(self):
        v = self.s.get("ends", 3)
        return v if v in (2, 3, 5) else 3

    @property
    def wind_set(self):
        return WINDS.get(self.s.get("wind", "breezy"), WINDS["breezy"])

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def present(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    def new_end(self):
        self.between = False
        self.mark_round()
        self.end_no += 1
        n = len(self.seats)
        rng = self.rng
        first = (self.end_no - 1) % n
        here = [i for i in ((first + k) % n for k in range(n)) if self.present(i)]
        self.order = here * ARROWS
        self.shots_done = 0
        self.arrows = []                 # {"o", "x", "y", "ax", "ay", "ring", "id"}
        self.end_pts = [0] * n
        self.dist = DISTS[(self.end_no - 1) % len(DISTS)]
        lo, hi, bias, _ = self.wind_set
        speed = rng.uniform(lo, hi)
        ang = rng.choice((0.0, math.pi)) + rng.uniform(-0.45, 0.45)      # mostly across the range
        self.wind = (round(speed * math.cos(ang), 2), round(speed * math.sin(ang) * 0.6, 2))
        self.bias = max(-0.45, min(0.45, rng.gauss(0, bias)))            # hidden: how wrong the flag is this end
        r = rng.uniform(0.2, 0.45)
        a = rng.uniform(0, 2 * math.pi)
        self.apple = {"x": round(r * math.cos(a), 3), "y": round(r * math.sin(a), 3)}
        side = "→ left to right" if self.wind[0] > 0 else "← right to left"
        self.room.add_log(f"🚩 End {self.end_no} of {self.total_ends}: {self.dist} m, wind {kmh(self.wind)} km/h {side}. 🍎 An apple is up.")
        self.next_turn(0.0)

    def next_turn(self, wait):
        while self.shots_done < len(self.order) and not self.present(self.order[self.shots_done]):
            self.shots_done += 1
        if self.shots_done >= len(self.order):
            return self.end_end(wait)
        i = self.order[self.shots_done]
        r = self.room
        r.begin_turn(self.seats[i])
        self.ready_at = time.time() + wait
        if wait:
            if self.pl(i).bot:
                r.bot_at = max(r.bot_at, self.ready_at + 0.9)
            if r.deadline:
                r.deadline += wait

    # -- actions

    def act(self, p, a):
        if a.get("type") != "shoot":
            raise GameError("Unknown action.")
        if self.between:
            raise GameError("The next end is coming up.")
        self.require_turn(p)
        ax, ay, breath = a.get("ax"), a.get("ay"), a.get("breath", False)
        held = a.get("held", 0)
        if not isinstance(held, (int, float)) or isinstance(held, bool) or not math.isfinite(held):
            raise GameError("Bad shot.")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (ax, ay)):
            raise GameError("Bad shot.")
        if abs(ax) > AIM or abs(ay) > AIM or not isinstance(breath, bool):
            raise GameError("Bad shot.")
        i = self.seat(p)
        if breath and not self.breath[i]:
            raise GameError("You've already used your steady breath.")
        if time.time() < self.ready_at - 0.3:
            raise GameError("Wait for the arrow to land.")
        # #128 tired arms: held past the steady couple of seconds, the release itself wanders a little more
        # (on top of the sway the page already added), so a long hold costs something here too
        held = max(0.0, min(float(held), HOLD_GIVE))
        if not breath and held > HOLD_STEADY:
            sig = HOLD_SCATTER * (held - HOLD_STEADY) / (HOLD_GIVE - HOLD_STEADY)
            ax = max(-AIM, min(AIM, ax + self.rng.gauss(0, sig)))
            ay = max(-AIM, min(AIM, ay + self.rng.gauss(0, sig)))
        self.shoot(i, float(ax), float(ay), breath)

    def gust(self):
        """This arrow's own gust: a factor added to the end's bias."""
        return max(-0.4, min(0.4, self.rng.gauss(0, self.wind_set[3])))

    def shoot(self, i, ax, ay, breath=False):
        factor = 1.0 + self.bias + (0.0 if breath else self.gust())
        x, y = land(ax, ay, self.wind, self.dist, factor)
        ring, is_x = score_at(x, y)
        nm = self.name_of(i)
        pts = ring
        if breath:
            self.breath[i] = False
        split = ring > 0 and any(math.hypot(x - s["x"], y - s["y"]) < SPLIT for s in self.arrows)
        apple = bool(self.apple) and math.hypot(x - self.apple["x"], y - self.apple["y"]) < APPLE_R
        if apple:
            pts += APPLE_PTS
        self.shot_id += 1
        arrow = {"o": i, "x": round(x, 3), "y": round(y, 3), "ax": round(ax, 3), "ay": round(ay, 3), "ring": ring, "id": self.shot_id}
        self.arrows.append(arrow)
        self.points[i] += pts
        self.end_pts[i] += pts
        self.shots_done += 1
        what = "the ✖ dead centre" if is_x else "the gold" if ring >= 9 else f"the {ring}" if ring else "nothing but grass"
        calm = "takes a steady breath 🧘 and hits" if breath else "hits"
        self.room.add_log(f"🏹 {nm} {calm} {what}{f' for {ring}' if ring >= 9 else ''}.", "info")
        if is_x:
            self.xs[i] += 1
            self.award(self.seats[i], "centre")
            self.moment(f"🎯 {nm}: DEAD CENTRE", "gold", "good")
        if apple:
            self.award(self.seats[i], "apple")
            self.moment(f"🍎 {nm} shoots the apple: +{APPLE_PTS}", "gold", "fanfare")
        if split:
            self.award(self.seats[i], "split")
            self.moment(f"🏹 {nm} SPLITS AN ARROW", "cool", "boom")
        t = show_time(self.dist)
        self.shot = {**arrow, "pts": pts, "x10": is_x, "apple": dict(self.apple) if apple else None, "split": split,
                     "breath": breath, "t": t}
        if apple:
            self.apple = None
        self.next_turn(t + HIT_PAUSE)

    # -- ends

    def ranking(self, seats):
        return sorted(seats, key=lambda i: (self.points[i], self.xs[i]), reverse=True)

    def end_end(self, wait):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.present(i)]
        self.ends_log.append(list(self.end_pts))
        if here:
            best = max(here, key=lambda i: self.end_pts[i])
            r.add_log(f"🏁 End {self.end_no} ({self.dist} m): " + ", ".join(f"{self.name_of(i)} {self.end_pts[i]}" for i in here) + ".", "big")
            if self.end_pts[best] >= 27 and sum(1 for i in here if self.end_pts[i] == self.end_pts[best]) == 1:
                self.moment(f"🔥 {self.name_of(best)} shoots {self.end_pts[best]} in one end!", "gold", "fanfare")
        self.between = True
        r.turn = None
        r.deadline = time.time() + wait + END_PAUSE

    def after_end(self):
        r = self.room
        self.between = False
        here = [i for i in range(len(self.seats)) if self.present(i)]
        if self.end_no >= self.total_ends or len(here) <= 1:
            if not here:
                return r.finish(None, "Everyone left.")
            ranked = self.ranking(here)
            top = ranked[0]
            key = (self.points[top], self.xs[top])
            tied = [i for i in ranked if (self.points[i], self.xs[i]) == key]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {self.points[top]} between {' & '.join(self.name_of(i) for i in tied)}.")
            second = ranked[1] if len(ranked) > 1 else None
            by_x = second is not None and self.points[second] == self.points[top]
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Wind Archery with {self.points[top]} points"
                            + (f", {self.xs[top]} ✖ to {self.xs[second]}!" if by_x else "!"))
        self.new_end()

    def on_timeout(self):
        r = self.room
        if self.between:
            return self.after_end()
        if r.turn not in self.seats:
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.name_of(i)} ran out of time and looses straight at the middle.", "power")
        self.shoot(i, 0.0, 0.0)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the range.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if not self.between and r.turn == p.id:
            self.shots_done += 1
            self.next_turn(0.0)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "points"):
            return ""
        return f"{self.points[i]} pts" + (f" · ✖{self.xs[i]}" if self.xs[i] else "")

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        nxt = self.order[self.shots_done] if not self.between and self.shots_done < len(self.order) else None
        i = self.seat(p)
        return {"archery": {
            "seats": self.seats, "me": i, "end": self.end_no, "ends": self.total_ends,
            "dist": self.dist, "wind": list(self.wind), "kmh": kmh(self.wind), "apple": self.apple,
            "arrows": self.arrows, "shot": self.shot, "points": self.points, "xs": self.xs,
            "endPts": self.end_pts, "endsLog": self.ends_log, "breath": self.breath,
            "order": self.order, "done": self.shots_done, "next": nxt, "between": self.between,
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)),
            "standings": self.standings() if self.between and len(self.seats) > 1 else None,
            "range": {"ring": RING, "face": FACE, "aim": AIM, "appleR": APPLE_R},
        }}

    # -- bots: aim against the wind they expect, with a hand that shakes less the better they are

    def read_wind(self, i, level):
        """The factor (real wind ÷ flag wind) a bot believes in, from the arrows it has watched land this end.
        Every shot shows its aim, so this is what a person at the table could work out too."""
        dx, dy = drift(self.wind, self.dist)
        d2 = dx * dx + dy * dy
        if level == "easy" or d2 < 1e-6:
            return 0.6 if level == "easy" else 1.0
        seen = [s for s in self.arrows if level == "hard" or s["o"] == i]
        if not seen:
            return 1.0
        est = sum(((s["x"] - s["ax"]) * dx + (s["y"] - s["ay"]) * dy) / d2 for s in seen) / len(seen)
        trust = len(seen) / (len(seen) + (0.6 if level == "hard" else 2.0))
        return 1.0 + (est - 1.0) * trust

    def plan(self, i, level):
        """(ax, ay, breath) for seat i."""
        rng = random
        sigma = {"easy": 0.15, "normal": 0.075, "hard": 0.035}.get(level, 0.075)
        last_end = self.end_no == self.total_ends
        far_end = max(e for e in range(1, self.total_ends + 1) if DISTS[(e - 1) % len(DISTS)] == max(DISTS[(k - 1) % len(DISTS)] for k in range(1, self.total_ends + 1)))
        breath = self.breath[i] and ((level == "hard" and self.end_no == far_end) or (level == "normal" and last_end))
        if breath:
            sigma *= 0.5
        f = self.read_wind(i, level)
        dx, dy = drift(self.wind, self.dist)
        tx = ty = 0.0
        if self.apple and level != "easy":
            # the apple is worth it when the bot's hand and the gusts are steady enough to hit it
            spread = math.hypot(sigma, math.hypot(dx, dy) * (0.0 if breath else self.wind_set[3]))
            p_hit = 1 - math.exp(-APPLE_R ** 2 / (2 * spread ** 2)) if spread > 0 else 1.0
            ring_there = score_at(self.apple["x"], self.apple["y"])[0]
            centre = max(0.0, 10 - 1.25 * spread / RING)
            if ring_there - 1 + APPLE_PTS * p_hit > centre:
                tx, ty = self.apple["x"], self.apple["y"]
        ax = max(-AIM, min(AIM, tx - dx * f + rng.gauss(0, sigma)))
        ay = max(-AIM, min(AIM, ty - dy * f + rng.gauss(0, sigma)))
        return round(ax, 3), round(ay, 3), bool(breath)

    def bot_ready(self):
        if self.between:
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_turn(self, p):
        i = self.seat(p)
        self.shoot(i, *self.plan(i, p.bot))
