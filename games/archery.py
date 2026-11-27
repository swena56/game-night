"""Wind Archery: an original turn-based archery game for 2–6 players.

Everyone shoots at the same target in the same wind, one arrow a turn. The sight is zeroed for the distance,
so only the wind moves an arrow: it drifts by K × wind × (flight time)², which grows fast with the range
(30 m, 50 m, 70 m). The flag shows the end's wind, but the real wind runs a little stronger or weaker than
the flag says for the whole end (the hidden `bias`), and every arrow meets its own small gust, so the way to
score is to watch where the arrows land (every shot shows where it was aimed) and correct.

🍎 An apple is pinned to the boss each end: the first arrow through it scores +5. 🧘 Once a game a player can
take a steady breath: no sight sway in the browser and no gust on that arrow.

#177 (round 2, "rather dull"): every end is a different course. 🍎 apple end (as above), 🎈 balloon end (four
balloons round the face, +3 each, a gold one right on the edge +6), 🪝 swinging end (the face hangs from a frame
and swings side to side: lead it). 🔥 Once an end each archer may loose a fire arrow: gold (9 or 10) scores
double, anything else scores nothing. ✨ From the third gold in a row on, each gold is worth +1. A tie on points
after the last end goes to a one-arrow 🏹 shoot-off at 70 m: closest to the middle wins. Big shots (✖, a prize,
a flaming gold, a split) play in slow motion; bots shoot sooner after the last arrow lands.

Nothing is simulated step by step: the server works out where the arrow lands and browsers draw the flight.
"""
import math
import random
import time

from .base import Game, GameError
from .bar_darts import DartMatch, MODES, X01

ARROW_V = 60.0        # m/s
K = 0.055             # drift = K × wind (m/s) × t²
RING = 0.061          # width of one scoring ring (a 122 cm face)
FACE = 10 * RING      # the face's radius
DISTS = (30, 50, 70)
ARROWS = 3            # arrows each per end
AIM = 1.5             # the sight can point this far from the centre, each way (the swinging end needs a little more)
APPLE_R = 0.06        # an arrow this close to the apple's centre hits it
APPLE_PTS = 5
SPLIT = 0.02          # landing this close to an arrow in the boss splits it
HOLD_STEADY, HOLD_GIVE, HOLD_SCATTER = 2.0, 9.0, 0.03   # #128: a draw is steady this long, gives out at this, wanders up to this much
HIT_PAUSE = 1.5       # seconds on the hit close-up before the next archer
BOT_GAP = 0.45        # a bot looses this long after the arrow before has landed and been looked at (#177: was 0.9)
END_PAUSE = 5.0
# wind setting -> (weakest, strongest wind in m/s, the end's hidden bias σ, each arrow's gust σ)
# #177 the course: what each end is, by the number of ends
COURSE = {2: ("apple", "swing"), 3: ("apple", "balloons", "swing"), 5: ("apple", "balloons", "swing", "balloons", "swing")}
KIND_NAMES = {"apple": "🍎 Apple end", "balloons": "🎈 Balloon end", "swing": "🪝 Swinging target", "shootoff": "🏹 Shoot-off"}
BALLOON_R, BALLOON_PTS, GOLD_BALLOON_PTS = 0.07, 3, 6
SWING_A, SWING_P = 0.32, 4.6    # the swinging face: metres each way, seconds for a full swing
SWING_SLACK = 0.8               # a browser's swing clock may be this far off the server's (latency) and still count
FIRE_GOLD = 9                   # 🔥 a fire arrow doubles a 9 or a 10 and scores nothing below
STREAK = 3                      # ✨ from the third gold (9+) in a row on, each gold is worth +1
SLOW = 0.8                      # extra seconds a big shot spends in slow motion on screen
SHOOTOFF_DIST = 70
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


def swing_x(a, p, age):
    """Where the swinging face's centre is (metres right of the middle) `age` seconds into the end."""
    return a * math.sin(2 * math.pi * age / p)


def kmh(wind):
    return round(math.hypot(*wind) * 3.6)


class Archery(Game):
    id = "archery"
    solo_bots = 2
    category = "action"
    family = None
    howto = [
        "In darts, start on the right half of the board or on the throw button, then swipe inward. Release when the aim ring is over your target. With a mouse, hold the button anywhere on the board and swipe the same way. The ring grows on faster swipes to show the extra scatter. Each visit has up to three darts, and the board clears automatically after the last visit of the round.",
        "301 and 501: count down to exactly zero; any dart can finish. Going below zero busts the whole visit. With the Double out setting you must finish on a double, and leaving one or hitting zero without a double busts too.",
        "Cricket: hit 15–20 and bull three times each. Extra marks score while a rival still has that target open. Close every target and at least tie the high score to win.",
        "Around the Clock: hit 1 through 20 in order, then either bull. A double or triple clears only that number.",
        "Count-Up: score as many points as you can in eight three-dart visits. Doubles and triples multiply each hit.",
        "Axe Throwing: swipe inward at a steady speed so the blade lines up. The wooden rings score 5 down to 1. Highest total after eight three-throw visits wins.",
        "Wind Archery: take turns shooting one arrow at the target. Drag the sight over the target and let go (or tap 🏹 Loose). The sight sways more the longer you hold.",
        "The wind carries every arrow: watch the flag and aim into the wind. The further the target (30 m, 50 m, 70 m), the more an arrow drifts.",
        "The flag is only a guide: the real wind is a bit stronger or weaker each end. Every shot shows where it was aimed, so learn from each arrow, rivals' too.",
        "Rings score 10 (gold) down to 1; off the face scores nothing. 🍎 The first arrow through the apple scores +5.",
        "Each end is a different course: 🍎 an apple (+5), 🎈 balloons (+3, the gold one on the edge +6), then a 🪝 swinging target you have to lead.",
        "🔥 Once an end, loose a fire arrow: the gold (9 or 10) scores double, anything else scores nothing. ✨ From your third gold in a row, every gold is +1.",
        "🧘 Once a game, take a steady breath: no sway and no gust on that arrow. Most points after the last end wins; a tie goes to a one-arrow 🏹 shoot-off, closest to the middle.",
    ]
    name = "Darts"
    icon = "🎯"
    blurb = "Swipe to throw on a 3D dartboard. Play 301, 501, Cricket, Around the Clock, Count-Up or Axe Throwing, or choose Wind Archery from Course."
    min_players = 1
    max_players = 6
    badges = {**Game.badges,
              "centre": ("🎯", "Dead centre", "Put an arrow in the ✖ at the very middle"),
              "apple": ("🍎", "Apple shot", "Shoot the apple off the boss"),
              "split": ("🏹", "Split the arrow", "Land an arrow on one already in the target"),
              "fire": ("🔥", "Gold on fire", "Put a fire arrow in the gold"),
              "streak": ("✨", "Golden streak", "Three golds in a row")}
    settings_schema = {
        "course": ("Course", [*MODES.items(), ("archery", "Wind Archery")], "301"),
        "axe_scoring": ("Axe scoring", [("corner", "5–3–1 + 7-point corners"), ("classic", "Classic 5–4–3–2–1")], "corner"),
        "aim_control": ("Darts controls", [("swipe", "Swipe first"), ("adjust", "Adjust and release")], "swipe"),
        "finish": ("Finish (301/501)", [("any", "Any finish"), ("double", "Double out")], "any"),
        "ends": ("Ends", [(3, "3"), (2, "2"), (5, "5")], 3),
        "wind": ("Wind", [("breezy", "🍃 Breezy"), ("gusty", "🌬 Gusty"), ("calm", "🪶 Calm")], "breezy"),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        mode = self.s.get("course", self.settings_schema["course"][2])
        self.darts = DartMatch(
            self.room, self.seats, rng, mode,
            axe_scoring=self.s.get("axe_scoring", self.settings_schema["axe_scoring"][2]),
            double_out=self.s.get("finish") == "double",
            aim_control=self.s.get("aim_control") == "adjust",
        ) if mode in MODES else None
        if self.darts:
            return
        n = len(self.seats)
        self.points = [0] * n
        self.xs = [0] * n               # dead-centre shots, the tie-break
        self.breath = [True] * n        # 🧘 still to use
        self.ends_log = []              # one row per end so far: points per seat
        self.end_no = 0
        self.shot, self.shot_id = None, 0
        self.between = False
        self.ready_at = 0.0
        self.streak = [0] * n           # golds in a row
        self.shootoff = None            # the seats in a shoot-off for first place
        self.so_winner = None
        ends = self.total_ends
        self.room.add_log(f"🎯 Wind Archery: {ends} end{'s' if ends != 1 else ''}, {ARROWS} arrows each per end. Aim into the wind!", "big")
        self.new_end()

    def __setstate__(self, st):   # games saved before #177: an apple end every end, no fire arrows or streaks
        self.__dict__.update(st)
        d = self.__dict__
        if d.setdefault("darts", None):
            return
        n = len(d.get("seats", []))
        if "prizes" not in d:
            a = d.get("apple")
            d["prizes"] = [{"k": "apple", "x": a["x"], "y": a["y"], "r": APPLE_R, "pts": APPLE_PTS, "id": 0}] if a else []
        d.setdefault("kind", "apple")
        d.setdefault("swing", None)
        d.setdefault("swing_t0", 0.0)
        d.setdefault("fire", [True] * n)
        d.setdefault("streak", [0] * n)
        d.setdefault("shootoff", None)
        d.setdefault("so_winner", None)

    @property
    def apple(self):
        """The apple still up this end, if any (old views and tests)."""
        return next(({"x": q["x"], "y": q["y"]} for q in self.prizes if q["k"] == "apple"), None)

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

    def course(self, end_no):
        c = COURSE.get(self.total_ends, COURSE[3])
        return c[(end_no - 1) % len(c)]

    def new_end(self, shootoff=None):
        self.between = False
        self.mark_round()
        n = len(self.seats)
        rng = self.rng
        if shootoff:
            # 🏹 one arrow each for the tied, at the long distance: closest to the middle wins
            self.shootoff = list(shootoff)
            self.kind = "shootoff"
            self.order = [i for i in shootoff if self.present(i)]
            self.dist = SHOOTOFF_DIST
        else:
            self.end_no += 1
            first = (self.end_no - 1) % n
            here = [i for i in ((first + k) % n for k in range(n)) if self.present(i)]
            self.order = here * ARROWS
            self.kind = self.course(self.end_no)
            self.dist = DISTS[(self.end_no - 1) % len(DISTS)]
        self.shots_done = 0
        self.arrows = []                 # {"o", "x", "y", "ax", "ay", "ring", "id"} (+ "cx" on a swinging end, "fire")
        self.end_pts = [0] * n
        self.fire = [True] * n           # 🔥 one fire arrow each an end
        lo, hi, bias, _ = self.wind_set
        speed = rng.uniform(lo, hi)
        ang = rng.choice((0.0, math.pi)) + rng.uniform(-0.45, 0.45)      # mostly across the range
        self.wind = (round(speed * math.cos(ang), 2), round(speed * math.sin(ang) * 0.6, 2))
        self.bias = max(-0.45, min(0.45, rng.gauss(0, bias)))            # hidden: how wrong the flag is this end
        self.prizes = []
        self.swing, self.swing_t0 = None, time.time()
        if self.kind == "apple":
            r = rng.uniform(0.2, 0.45)
            a = rng.uniform(0, 2 * math.pi)
            self.prizes = [{"k": "apple", "x": round(r * math.cos(a), 3), "y": round(r * math.sin(a), 3), "r": APPLE_R, "pts": APPLE_PTS, "id": 0}]
        elif self.kind == "balloons":
            a0 = rng.uniform(0, 2 * math.pi)
            for k in range(4):
                a = a0 + k * math.pi / 2 + rng.uniform(-0.35, 0.35)
                gold = k == 0
                r = rng.uniform(0.6, 0.68) if gold else rng.uniform(0.3, 0.52)
                self.prizes.append({"k": "gold" if gold else "balloon", "x": round(r * math.cos(a), 3), "y": round(r * math.sin(a), 3),
                                    "r": BALLOON_R * (0.8 if gold else 1), "pts": GOLD_BALLOON_PTS if gold else BALLOON_PTS, "id": k})
        elif self.kind == "swing":
            self.swing = {"a": SWING_A, "p": SWING_P}
        side = "→ left to right" if self.wind[0] > 0 else "← right to left"
        what = {"apple": "🍎 An apple is up.", "balloons": "🎈 Balloons are up: +3 each, the gold one +6.",
                "swing": "🪝 The target swings: lead it!", "shootoff": "One arrow each: closest to the middle wins."}[self.kind]
        if self.kind == "shootoff":
            self.room.add_log(f"🏹 Shoot-off: {' vs '.join(self.name_of(i) for i in self.order)} at {self.dist} m, wind {kmh(self.wind)} km/h {side}. {what}", "big")
            self.moment(f"🏹 SHOOT-OFF: {' vs '.join(self.name_of(i) for i in self.order)}", "gold", "fanfare")
        else:
            self.room.add_log(f"🚩 End {self.end_no} of {self.total_ends} · {KIND_NAMES[self.kind]}: {self.dist} m, wind {kmh(self.wind)} km/h {side}. {what}")
        self.next_turn(0.0)

    def swing_age(self):
        return time.time() - self.swing_t0

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
                r.bot_at = max(r.bot_at, self.ready_at + BOT_GAP)
            if r.deadline:
                r.deadline += wait

    # -- actions

    def act(self, p, a):
        if self.darts:
            return self.darts.act(p, a)
        if a.get("type") != "shoot":
            raise GameError("Unknown action.")
        if self.between:
            raise GameError("The next end is coming up.")
        self.require_turn(p)
        ax, ay, breath, fire = a.get("ax"), a.get("ay"), a.get("breath", False), a.get("fire", False)
        held = a.get("held", 0)
        if not isinstance(held, (int, float)) or isinstance(held, bool) or not math.isfinite(held):
            raise GameError("Bad shot.")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (ax, ay)):
            raise GameError("Bad shot.")
        if abs(ax) > AIM or abs(ay) > AIM or not isinstance(breath, bool) or not isinstance(fire, bool):
            raise GameError("Bad shot.")
        ph = a.get("ph")
        if ph is not None and (not isinstance(ph, (int, float)) or isinstance(ph, bool) or not math.isfinite(ph)):
            raise GameError("Bad shot.")
        i = self.seat(p)
        if breath and not self.breath[i]:
            raise GameError("You've already used your steady breath.")
        if fire and (not self.fire[i] or self.kind == "shootoff"):
            raise GameError("No fire arrow left this end.")
        if time.time() < self.ready_at - 0.3:
            raise GameError("Wait for the arrow to land.")
        # #128 tired arms: held past the steady couple of seconds, the release itself wanders a little more
        # (on top of the sway the page already added), so a long hold costs something here too
        held = max(0.0, min(float(held), HOLD_GIVE))
        if not breath and held > HOLD_STEADY:
            sig = HOLD_SCATTER * (held - HOLD_STEADY) / (HOLD_GIVE - HOLD_STEADY)
            ax = max(-AIM, min(AIM, ax + self.rng.gauss(0, sig)))
            ay = max(-AIM, min(AIM, ay + self.rng.gauss(0, sig)))
        # the swinging face: the page says when (in the end's swing clock) it loosed; a clock within the slack of
        # the server's counts (the network is slow), anything else gets the server's own
        age = self.swing_age()
        if ph is not None and abs(ph - age) <= SWING_SLACK:
            age = float(ph)
        self.shoot(i, float(ax), float(ay), breath, fire, age)

    def gust(self):
        """This arrow's own gust: a factor added to the end's bias."""
        return max(-0.4, min(0.4, self.rng.gauss(0, self.wind_set[3])))

    def shoot(self, i, ax, ay, breath=False, fire=False, age=None):
        """Loose seat i's arrow at (ax, ay) on the target plane. On a swinging end that's where the sight was,
        and the arrow is scored against where the face has swung to when it arrives (`age` is when it was loosed
        in the end's swing clock); its aim and landing are kept relative to the face, so x - ax is still the wind."""
        so = self.kind == "shootoff"
        fire = bool(fire) and not so
        factor = 1.0 + self.bias + (0.0 if breath else self.gust())
        fly = show_time(self.dist)
        cx = 0.0
        if self.swing:
            age = self.swing_age() if age is None else age
            cx = swing_x(self.swing["a"], self.swing["p"], age + fly)
        x, y = land(ax - cx, ay, self.wind, self.dist, factor)
        ax -= cx
        ring, is_x = score_at(x, y)
        nm = self.name_of(i)
        if breath:
            self.breath[i] = False
        if fire:
            self.fire[i] = False
        split = ring > 0 and any(math.hypot(x - s["x"], y - s["y"]) < SPLIT for s in self.arrows)
        hit = [q for q in self.prizes if math.hypot(x - q["x"], y - q["y"]) < q["r"]]
        gold = ring >= FIRE_GOLD
        base = (ring * 2 if gold else 0) if fire else ring
        bonus = 0
        if not so:
            self.streak[i] = self.streak[i] + 1 if gold else 0
            bonus = 1 if self.streak[i] >= STREAK else 0
        prize_pts = sum(q["pts"] for q in hit)
        pts = 0 if so else base + bonus + prize_pts
        self.shot_id += 1
        arrow = {"o": i, "x": round(x, 3), "y": round(y, 3), "ax": round(ax, 3), "ay": round(ay, 3), "ring": ring, "id": self.shot_id}
        if self.swing:
            arrow["cx"] = round(cx, 3)
        if fire:
            arrow["fire"] = True
        self.arrows.append(arrow)
        self.points[i] += pts
        self.end_pts[i] += pts
        self.shots_done += 1
        what = "the ✖ dead centre" if is_x else "the gold" if gold else f"the {ring}" if ring else "nothing but grass"
        calm = ("takes a steady breath 🧘 and " if breath else "") + ("looses a 🔥 fire arrow: " if fire else "")
        far = f" ({round(math.hypot(x, y) * 100)} cm out)" if so else ""
        burnt = " It burns out: 0." if fire and not gold else f" Doubled: {base}!" if fire else ""
        self.room.add_log(f"🏹 {nm} {calm}hits {what}{f' for {ring}' if gold and not fire else ''}{far}.{burnt}", "info")
        big = is_x or bool(hit) or split or (fire and gold)
        slow = SLOW if big else 0.0
        t = round(fly + slow, 2)
        at = time.time() + t       # callouts wait for the arrow to land on screen
        if is_x:
            self.xs[i] += 1
            self.award(self.seats[i], "centre")
        if fire and gold:
            self.award(self.seats[i], "fire")
            self.moment(f"🔥 {nm} sets the gold alight: {base}!", "gold", "fanfare", at=at)
        elif is_x:
            self.moment(f"🎯 {nm}: DEAD CENTRE", "gold", "good", at=at)
        for q in hit:
            if q["k"] == "apple":
                self.award(self.seats[i], "apple")
                self.moment(f"🍎 {nm} shoots the apple: +{q['pts']}", "gold", "fanfare", at=at)
            elif q["k"] == "gold":
                self.moment(f"🎈 {nm} pops the GOLD balloon: +{q['pts']}", "gold", "fanfare", at=at)
        if split:
            self.award(self.seats[i], "split")
            self.moment(f"🏹 {nm} SPLITS AN ARROW", "cool", "boom", at=at)
        if bonus and self.streak[i] == STREAK:
            self.award(self.seats[i], "streak")
            self.moment(f"✨ {nm}: three golds in a row! +1 a gold while it lasts", "good", None, at=at)
        self.shot = {**arrow, "pts": pts, "x10": is_x, "prizes": [dict(q) for q in hit], "split": split,
                     "apple": next(({"x": q["x"], "y": q["y"]} for q in hit if q["k"] == "apple"), None),
                     "breath": breath, "fire": fire, "bonus": bonus, "streak": self.streak[i], "t": t, "fly": fly, "slow": slow,
                     "ph": round(age, 3) if self.swing else None, "so": so}
        if hit:
            self.prizes = [q for q in self.prizes if q not in hit]
        self.next_turn(t + HIT_PAUSE)

    # -- ends

    def ranking(self, seats):
        return sorted(seats, key=lambda i: (self.points[i], self.xs[i]), reverse=True)

    def end_end(self, wait):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.present(i)]
        if self.kind == "shootoff":
            shot = {s["o"]: math.hypot(s["x"], s["y"]) for s in self.arrows if self.present(s["o"])}
            if shot:
                best = min(shot.values())
                win = [i for i, d in shot.items() if d - best < 1e-4]
                self.so_winner = win[0] if len(win) == 1 else None
                if self.so_winner is not None:
                    w = self.so_winner
                    r.add_log(f"🏹 {self.name_of(w)} wins the shoot-off, {round(best * 100)} cm from the middle.", "big")
                    self.moment(f"🏆 {self.name_of(w)} wins the shoot-off!", "gold", "fanfare", at=time.time() + wait)
            self.between = True
            r.turn = None
            r.deadline = time.time() + wait + END_PAUSE * 0.6
            return
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
        if self.end_no >= self.total_ends or (len(here) <= 1 and len(self.seats) > 1):
            if not here:
                return r.finish(None, "Everyone left.")
            if self.shootoff:
                w = self.so_winner
                if w is not None and self.present(w):
                    return r.finish(self.pl(w), f"🏆 {self.name_of(w)} wins Wind Archery with {self.points[w]} points and the 🏹 shoot-off!")
                left = [i for i in self.shootoff if self.present(i)]
                if len(left) == 1:
                    return r.finish(self.pl(left[0]), f"🏆 {self.name_of(left[0])} wins Wind Archery with {self.points[left[0]]} points!")
                return r.finish(None, f"🤝 A tie on {self.points[left[0]] if left else 0}, even after a shoot-off.")
            ranked = self.ranking(here)
            top = ranked[0]
            tied = [i for i in ranked if self.points[i] == self.points[top]]
            if len(tied) > 1:
                r.add_log(f"🤝 {' & '.join(self.name_of(i) for i in tied)} are level on {self.points[top]}: a shoot-off!", "big")
                return self.new_end(shootoff=tied)
            if len(self.seats) == 1:
                return r.finish(self.pl(top), f"🎯 {self.name_of(top)} scores {self.points[top]} points in Wind Archery.")
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Wind Archery with {self.points[top]} points!")
        self.new_end()

    def on_timeout(self):
        if self.darts:
            return self.darts.timeout()
        r = self.room
        if self.between:
            return self.after_end()
        if r.turn not in self.seats:
            return
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.name_of(i)} ran out of time and looses straight at the middle.", "power")
        self.shoot(i, 0.0, 0.0)

    def on_leave(self, p):
        if self.darts:
            return self.darts.leave(p)
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the range.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if self.shootoff and self.kind == "shootoff" and sum(1 for i in self.shootoff if self.present(i)) == 1 and not self.between:
            r.turn = None
            self.between = True
            r.deadline = time.time() + 1.0
            return
        if not self.between and r.turn == p.id:
            self.shots_done += 1
            self.next_turn(0.0)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if self.darts and i is not None:
            stat = "left" if self.darts.mode in X01 else "targets" if self.darts.mode == "clock" else "pts"
            return f"{self.darts.points[i]} {stat}"
        if i is None or not hasattr(self, "points"):
            return ""
        return f"{self.points[i]} pts" + (f" · ✖{self.xs[i]}" if self.xs[i] else "")

    def final_scores(self):
        if self.darts:
            scores = self.darts.points
            start = X01.get(self.darts.mode)
            return dict(zip(self.seats, (start - p for p in scores) if start else scores))
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        if self.darts:
            return {"darts": self.darts.view(p)}
        nxt = self.order[self.shots_done] if not self.between and self.shots_done < len(self.order) else None
        i = self.seat(p)
        return {"archery": {
            "seats": self.seats, "me": i, "end": self.end_no, "ends": self.total_ends,
            "dist": self.dist, "wind": list(self.wind), "kmh": kmh(self.wind), "apple": self.apple,
            "kind": self.kind, "prizes": self.prizes, "fire": self.fire, "streak": self.streak,
            "swing": {**self.swing, "age": round(self.swing_age(), 3)} if self.swing else None,
            "shootoff": self.shootoff if self.kind == "shootoff" else None,
            "arrows": self.arrows, "shot": self.shot, "points": self.points, "xs": self.xs,
            "endPts": self.end_pts, "endsLog": self.ends_log, "breath": self.breath,
            "order": self.order, "done": self.shots_done, "next": nxt, "between": self.between,
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)),
            "standings": self.standings() if self.between and len(self.seats) > 1 else None,
            "range": {"ring": RING, "face": FACE, "aim": AIM, "appleR": APPLE_R, "fireGold": FIRE_GOLD, "swingA": SWING_A, "swingP": SWING_P},
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
        """(ax, ay, breath, fire) for seat i: where on the target plane to point the sight right now."""
        rng = random
        sigma = {"easy": 0.12, "normal": 0.1, "hard": 0.075}.get(level, 0.1)
        so = self.kind == "shootoff"
        last_end = self.end_no == self.total_ends
        far_end = max(e for e in range(1, self.total_ends + 1) if DISTS[(e - 1) % len(DISTS)] == max(DISTS[(k - 1) % len(DISTS)] for k in range(1, self.total_ends + 1)))
        breath = self.breath[i] and (so or (level == "hard" and self.end_no == far_end) or (level == "normal" and last_end))
        if breath:
            sigma *= 0.5
        f = self.read_wind(i, level)
        dx, dy = drift(self.wind, self.dist)
        dl = math.hypot(dx, dy)
        # 🪝 a swinging face: aim where it will be when the arrow arrives; judging the timing is part of the hand
        lead, tsig = 0.0, 0.0
        if self.swing:
            lead = swing_x(self.swing["a"], self.swing["p"], self.swing_age() + show_time(self.dist))
            tsig = {"easy": 0.07, "normal": 0.05, "hard": 0.035}.get(level, 0.05)
        # how far off its arrow may land: the hand, the timing, the gust, and the bias it hasn't read yet
        seen = sum(1 for s in self.arrows if level == "hard" or s["o"] == i)
        unknown = self.wind_set[2] * (1.0 if level == "easy" else 1 / (1 + seen))
        spread = math.hypot(sigma, tsig, dl * math.hypot(0.0 if breath else self.wind_set[3], unknown))
        centre = max(0.0, 10 - 1.25 * spread / RING)
        p_gold = 1 - math.exp(-(2 * RING) ** 2 / (2 * spread ** 2)) if spread > 0 else 1.0
        tx = ty = 0.0
        best = centre
        if self.prizes and not so and (level != "easy" or rng.random() < 0.25):
            for q in self.prizes:
                p_hit = 1 - math.exp(-q["r"] ** 2 / (2 * spread ** 2)) if spread > 0 else 1.0
                ring_there = score_at(q["x"], q["y"])[0]
                ev = max(0, ring_there - 1) + q["pts"] * p_hit
                if level == "easy" or ev > best:
                    best, tx, ty = ev, q["x"], q["y"]
        # 🔥 the fire arrow: double the gold or nothing. Use it when the odds are good, or on the last arrow of the
        # end when it's still worth a gamble (easy gambles now and then, only when its odds
        # of gold are fair, #177 follow-up)
        fire = False
        if self.fire[i] and not so:
            mine_left = sum(1 for k in self.order[self.shots_done:] if k == i)
            ev_fire = p_gold * 2 * 9.6
            if level == "easy":
                fire = p_gold > 0.4 and rng.random() < 0.3
            elif ev_fire > max(best, centre) + (0.5 if mine_left == 1 else 2.5 if level == "hard" else 3.5):
                fire = True
            elif mine_left == 1 and ev_fire > centre - (0.5 if level == "hard" else 1.5):
                fire = True
            if fire:
                tx = ty = 0.0
        ax = max(-AIM, min(AIM, tx + lead + rng.gauss(0, tsig) - dx * f + rng.gauss(0, sigma)))
        ay = max(-AIM, min(AIM, ty - dy * f + rng.gauss(0, sigma)))
        return round(ax, 3), round(ay, 3), bool(breath), fire

    def bot_ready(self):
        if self.darts:
            return self.darts.grabbing is None and super().bot_ready()
        if self.between:
            return False
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_turn(self, p):
        if self.darts:
            return self.darts.bot(p)
        i = self.seat(p)
        ax, ay, breath, fire = self.plan(i, p.bot)
        self.shoot(i, ax, ay, breath, fire)
