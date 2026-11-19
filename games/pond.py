"""Frozen Pond: an original ice-fishing game for 2–6 players, everyone fishing at once against the clock.

Drill up to three holes anywhere on the shared pond (it takes a couple of seconds) and drop your line in one.
Schools of fish drift under the ice on slow paths: shallow ones show as shadows, deep ones only as bubbles.
A line near a school gets bites. When the bobber dips, hook it quickly (about a second); then the fight:
hold to reel while the fish is tired, ease off when it lunges, or the line snaps. Reel it all the way in to land it.

🐟 Perch 10 (easy), 🐠 trout 25, 🦈 pike 60 (pulls hard, long line), ✨ the golden char 150 (once a pond, fast and
fierce, it shows up partway through). ❄️ Snow squalls hide the shadows for a while.
Most points when the time runs out wins.

The server runs everything on its own clock (bites, the fish's lunges, snaps and landings), so `simulate.py` can
fast-forward: on_timeout jumps the game's clock to the next event.
"""
import math
import random
import time

from .base import Game, GameError

R = 12.0              # pond radius (m)
HOLE_GAP = 1.6
HOLES = 3
DRILL = 2.0
WINDOW = 1.0          # seconds to hook a bite
RETIE = 1.6           # after a snap or a landing, the line goes back in after this
MISS_REST = 0.8
FIGHT_DT = 0.05
FIGHT_MAX = 30.0
BITE_SIGMA = 2.3      # how far (m) a school's pull on a line reaches
BITE_STEP = 0.25
# species: points, line to reel (m), tension per second reeling into a lunge, lunge seconds, rest seconds, pull rate
FISH = {
    "perch": {"pts": 10, "L": 4.0, "k": 0.8, "pull": (0.5, 1.1), "rest": (1.2, 2.4), "icon": "🐟", "name": "perch"},
    "trout": {"pts": 25, "L": 7.0, "k": 1.05, "pull": (0.6, 1.4), "rest": (1.0, 2.2), "icon": "🐠", "name": "trout"},
    "pike":  {"pts": 60, "L": 11.0, "k": 1.35, "pull": (0.9, 2.0), "rest": (1.0, 2.0), "icon": "🦈", "name": "pike"},
    "char":  {"pts": 150, "L": 9.0, "k": 1.7, "pull": (0.5, 1.0), "rest": (0.7, 1.4), "icon": "✨", "name": "golden char"},
}
REEL_V, SLACK_V, LUNGE_TAKE, LUNGE_REEL = 2.4, 0.9, 0.8, 0.4
BOT_HOOK = {"easy": (0.78, 0.25), "normal": (0.5, 0.15), "hard": (0.34, 0.08)}
BOT_LAG = {"easy": 0.42, "normal": 0.26, "hard": 0.13}
BOT_FORGET = {"easy": 0.22, "normal": 0.07, "hard": 0.0}


def school_pos(s, t):
    """Where a school's centre is at game time t."""
    x = s["cx"] + s["a1"] * math.cos(s["w1"] * t + s["p1"]) + s["a2"] * math.cos(s["w2"] * t + s["p2"])
    y = s["cy"] + s["b1"] * math.sin(s["w1"] * t + s["p1"]) + s["b2"] * math.sin(s["w2"] * t + s["p2"])
    return x, y


def school_live(s, t):
    return s.get("t0", -1e9) <= t <= s.get("t1", 1e9) and not s.get("gone")


def bite_rate(schools, x, y, t):
    """Bites per second at (x, y) at time t, and each school's share."""
    parts = []
    for s in schools:
        if not school_live(s, t):
            parts.append(0.0)
            continue
        sx, sy = school_pos(s, t)
        d2 = (x - sx) ** 2 + (y - sy) ** 2
        parts.append(s["rate"] * math.exp(-d2 / (2 * BITE_SIGMA ** 2)))
    return sum(parts), parts


def fight_state(f, upto):
    """Run a fight from its start to `upto` seconds in: (p, tension, outcome, at). outcome: None | land | snap | escape."""
    toggles = f["toggles"]
    segs = f["segs"]
    fish = FISH[f["kind"]]
    p = tau = 0.0
    reel = False
    ti = 0
    si, seg_end = 0, segs[0][0]
    n = int(min(upto, FIGHT_MAX) / FIGHT_DT + 1e-9)
    for step in range(n):
        while ti < len(toggles) and toggles[ti] <= step:
            reel = not reel
            ti += 1
        t = step * FIGHT_DT
        while t >= seg_end and si < len(segs) - 1:
            si += 1
            seg_end += segs[si][0]
        lunge = segs[si][1]
        if reel and not lunge:
            p += REEL_V * FIGHT_DT
            tau += 0.04 * FIGHT_DT
        elif reel and lunge:
            p += LUNGE_REEL * FIGHT_DT
            tau += fish["k"] * FIGHT_DT
        else:
            tau = max(0.0, tau - SLACK_V * FIGHT_DT)
            if lunge:
                p = max(0.0, p - LUNGE_TAKE * FIGHT_DT)
        if tau >= 1.0:
            return p, 1.0, "snap", (step + 1) * FIGHT_DT
        if p >= fish["L"]:
            return fish["L"], tau, "land", (step + 1) * FIGHT_DT
    if upto >= FIGHT_MAX:
        return p, tau, "escape", FIGHT_MAX
    return p, tau, None, n * FIGHT_DT


def lunging(f, t):
    """Is the fish lunging t seconds into the fight, and when does that phase end?"""
    acc = 0.0
    for d, lunge in f["segs"]:
        if t < acc + d:
            return lunge, acc + d
        acc += d
    return f["segs"][-1][1], FIGHT_MAX


class Pond(Game):
    id = "pond"
    category = "party"
    family = None
    howto = [
        "Where to drill: tap the ice near the fish shadows, the bubbles or a pulsing ⛏ sonar ping (or press ⛏ Drill here). Up to 3 holes, 2 seconds each, any time you haven't a fish on. Tap one of your holes to move your line there.",
        "Your line is the thick yellow one, the ring round your hole is its reach and the sonar box shows your lure's depth and the fish near it. Nibbles are fish looking: wait. When it STRIKES (flag up, red button, buzz), tap within about a second to hook it (the button or Space).",
        "Then fight it: hold to reel while the fish is tired, let go when it lunges (the line goes taut and red), or the line snaps. Reel it all the way in to land it.",
        "Everyone fishes the same frozen pond at once. 🐟 Perch 10, 🐠 trout 25, 🦈 pike 60, ✨ the golden char 150 (once a pond). ❄️ Squalls hide the shadows and the pings. Most points when time runs out wins.",
    ]
    name = "Frozen Pond"
    icon = "🎣"
    blurb = "Drill a hole → drop your line → wait for a nibble → reel when it strikes (hold to reel, ease off when it lunges)."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "pike": ("🦈", "Pike wrangler", "Land a pike"),
              "char": ("✨", "Golden char", "Land the golden char"),
              "creel": ("🧺", "Full creel", "Land 8 fish in one pond")}
    settings_schema = {
        "minutes": ("Time", [(3, "3 minutes"), (2, "2 minutes"), (4, "4 minutes")], 3),
    }

    # -- the clock: game time T (seconds since the start); on_timeout may jump it forward (simulate.py)

    def T(self):
        return time.time() + self.skew - self.t_start

    def real(self, t):
        return self.t_start + t - self.skew

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.t_start = time.time() + 3.0       # a short countdown
        self.skew = 0.0
        self.t_end = self.total
        self.char_by = None
        self.catch_id = 0
        self.holes = []                         # {"x", "y", "o": seat, "at": ready time}
        self.make_schools(rng, len(seated))
        sq = []
        t = rng.uniform(35, 60)
        while t < self.t_end - 20:
            sq.append([round(t, 1), round(t + rng.uniform(8, 12), 1)])
            t += rng.uniform(55, 80)
        self.squalls = sq
        for p in seated:
            g = p.g
            g.points, g.catches, g.biggest = 0, [], 0
            g.line = {"st": "idle"}
            g.drilling = None
            g.act_at = rng.uniform(0.3, 1.5) if p.bot else None
            g.hook_ok = True
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🎣 Frozen Pond: {int(self.total // 60)} minutes on the ice. Drill, drop, hook and reel!", "big")
        self.schedule()

    @property
    def total(self):
        v = self.s.get("minutes", 3)
        return (v if v in (2, 3, 4) else 3) * 60.0

    def make_schools(self, rng, n):
        sch = []
        kinds = ["perch", "perch", "trout", "perch", "trout", "pike"] + ["perch", "trout"] * 2
        for k in range(4 + min(n, 4)):
            kind = kinds[k % len(kinds)]
            deep = kind == "pike" or rng.random() < 0.3
            cx, cy = rng.uniform(-3, 3), rng.uniform(-3, 3)
            room = R - 2.0 - math.hypot(cx, cy)
            a1 = rng.uniform(0.35, 0.6) * room
            a2 = rng.uniform(0.15, 0.35) * room
            b1 = rng.uniform(0.35, 0.6) * room
            b2 = rng.uniform(0.1, 0.3) * room
            sp = {"perch": 1.0, "trout": 0.8, "pike": 0.55}[kind]
            sch.append({"kind": kind, "deep": deep, "n": {"perch": 9, "trout": 6, "pike": 1}[kind],
                        "rate": {"perch": 0.3, "trout": 0.3, "pike": 0.2}[kind],
                        "cx": round(cx, 2), "cy": round(cy, 2), "a1": round(a1, 2), "a2": round(a2, 2),
                        "b1": round(b1, 2), "b2": round(b2, 2),
                        "w1": round(rng.uniform(0.035, 0.07) * sp * rng.choice((1, -1)), 4),
                        "w2": round(rng.uniform(0.08, 0.15) * sp * rng.choice((1, -1)), 4),
                        "p1": round(rng.uniform(0, 6.28), 3), "p2": round(rng.uniform(0, 6.28), 3)})
        # the golden char: one fish, quick, around for a while in the middle of the game
        t0 = rng.uniform(0.3, 0.5) * self.t_end
        room = R - 2.5
        sch.append({"kind": "char", "deep": False, "n": 1, "rate": 0.45, "cx": 0.0, "cy": 0.0,
                    "a1": round(room * 0.6, 2), "a2": round(room * 0.3, 2), "b1": round(room * 0.55, 2), "b2": round(room * 0.3, 2),
                    "w1": round(rng.uniform(0.12, 0.16), 4), "w2": round(-rng.uniform(0.2, 0.28), 4),
                    "p1": round(rng.uniform(0, 6.28), 3), "p2": round(rng.uniform(0, 6.28), 3),
                    "t0": round(t0, 1), "t1": round(t0 + rng.uniform(40, 55), 1)})
        self.schools = sch

    def on_restore(self, shift):
        self.t_start += shift

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players]

    def present(self):
        return [p for p in self.players() if not p.eliminated]

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- events

    def plan_bite(self, p, t0):
        """When the next bite comes at the line's hole, from t0 on (thinning against the moving schools)."""
        h = self.holes[p.g.line["h"]]
        rng = self.rng
        t = t0
        while t < min(self.t_end, t0 + 45):
            lam, _ = bite_rate(self.schools, h["x"], h["y"], t)
            if lam > 0 and rng.random() < 1 - math.exp(-lam * BITE_STEP):
                return round(t + rng.uniform(0, BITE_STEP), 3)
            t += BITE_STEP
        return round(t, 3)          # nothing yet: look again then

    def schedule(self):
        """Point the room's deadline at the next thing that happens."""
        ts = [self.t_end]
        if self.T() < 0:
            ts.append(0.0)
        for p in self.present():
            g = p.g
            ln = g.line
            if ln["st"] == "wait":
                ts.append(ln["bite_at"])
            elif ln["st"] == "bite":
                ts.append(ln["until"])
            elif ln["st"] == "fight":
                ts.append(ln["next"])
            elif ln["st"] == "retie":
                ts.append(ln["until"])
            if p.bot and g.act_at is not None:
                ts.append(g.act_at)
        self.room.deadline = self.real(max(min(ts), self.T() if self.T() >= 0 else -1e9))

    def on_timeout(self):
        r = self.room
        if r.phase != "playing":
            return
        # jump the game's clock to the event (the live ticker is late, never early; simulate.py calls straight away)
        due = r.deadline - self.t_start + self.skew if r.deadline else self.T()
        if due > self.T():
            self.skew += due - self.T()
        self.advance(self.T())
        if r.phase == "playing":
            self.schedule()

    def advance(self, now):
        if now >= self.t_end:
            return self.finish_pond()
        for p in self.present():
            g, ln = p.g, p.g.line
            if ln["st"] == "wait" and now >= ln["bite_at"]:
                h = self.holes[ln["h"]]
                lam, parts = bite_rate(self.schools, h["x"], h["y"], ln["bite_at"])
                if lam <= 0:
                    ln["bite_at"] = self.plan_bite(p, now)
                    continue
                k = self.rng.choices(range(len(parts)), weights=parts)[0]
                kind = self.schools[k]["kind"]
                g.line = {"st": "bite", "h": ln["h"], "kind": kind, "school": k, "at": round(now, 3), "until": round(now + WINDOW, 3)}
                if p.bot:
                    mu, sd = BOT_HOOK.get(p.bot, BOT_HOOK["normal"])
                    rt = random.gauss(mu, sd)
                    g.hook_ok = rt < WINDOW - 0.05
                    g.act_at = now + max(0.12, rt) if g.hook_ok else None
            elif ln["st"] == "bite" and now >= ln["until"]:
                self.room.add_log(f"💨 {p.name} was too slow: the {FISH[ln['kind']]['name']} got away.", "info")
                self.back_in(p, now, MISS_REST)
            elif ln["st"] == "fight" and now >= ln["next"]:
                self.fight_tick(p, now)
            elif ln["st"] == "retie" and now >= ln["until"]:
                g.line = {"st": "wait", "h": ln["h"], "since": round(now, 3)}
                g.line["bite_at"] = self.plan_bite(p, now)

    def back_in(self, p, now, rest):
        h = p.g.line.get("h")
        if h is None:
            p.g.line = {"st": "idle"}
            return
        p.g.line = {"st": "retie", "h": h, "until": round(now + rest, 3)}
        if p.bot:
            p.g.act_at = now + rest + random.uniform(0.5, 1.5)

    def fight_tick(self, p, now):
        """Bring a fight up to `now`: settle it if it's over, else find its next moment."""
        ln = p.g.line
        el = now - ln["t0"]
        pos, tau, out, at = fight_state(ln, el)
        ln["p"], ln["tau"] = round(pos, 3), round(tau, 3)
        if out:
            return self.end_fight(p, out, ln["t0"] + at)
        # the next moment: a lunge starts or ends, or (if the reel stays as it is) a snap / a landing
        reel = len(ln["toggles"]) % 2 == 1
        _, seg_end = lunging(ln, el)
        horizon = min(seg_end, FIGHT_MAX)
        probe = dict(ln, toggles=list(ln["toggles"]))
        _, _, out2, at2 = fight_state(probe, horizon + FIGHT_DT)
        nxt = at2 if out2 else horizon
        ln["next"] = round(ln["t0"] + max(nxt, el + FIGHT_DT), 3)
        ln["reel"] = reel

    def end_fight(self, p, out, at):
        ln, g = p.g.line, p.g
        fish = FISH[ln["kind"]]
        nm = p.name
        when = self.real(at) + 0.05
        if out == "land":
            if ln["kind"] == "char" and self.char_by is None:
                self.char_by = p.id
                self.schools[ln["school"]]["gone"] = True
            self.catch_id += 1
            g.points += fish["pts"]
            g.catches.append({"id": self.catch_id, "kind": ln["kind"], "pts": fish["pts"], "h": ln["h"]})
            g.biggest = max(g.biggest, fish["pts"])
            self.room.add_log(f"{fish['icon']} {nm} lands a {fish['name']}! +{fish['pts']}", "big" if fish["pts"] >= 60 else "info")
            if ln["kind"] == "pike":
                self.award(p, "pike", at=when)
                self.moment(f"🦈 {nm} lands a PIKE: +60!", "good", "good", at=when)
            if ln["kind"] == "char":
                self.award(p, "char", at=when)
                self.moment(f"✨ {nm} lands the GOLDEN CHAR: +150!", "gold", "fanfare", at=when)
            if len(g.catches) == 8:
                self.award(p, "creel", at=when)
                self.moment(f"🧺 {nm} has a full creel: 8 fish!", "cool", "good", at=when)
            g.last = {"what": "land", "kind": ln["kind"], "id": self.catch_id}
        elif out == "snap":
            self.room.add_log(f"💥 {nm}'s line snaps: the {fish['name']} is gone.", "info")
            g.last = {"what": "snap", "kind": ln["kind"], "id": -self.catch_id - 1}
            self.catch_id += 1
        else:
            self.room.add_log(f"💨 The {fish['name']} wriggles off {nm}'s hook.", "info")
            g.last = {"what": "escape", "kind": ln["kind"], "id": -self.catch_id - 1}
            self.catch_id += 1
        self.back_in(p, at, RETIE)

    def finish_pond(self):
        r = self.room
        here = self.present()
        if not here:
            return r.finish(None, "Everyone left.")
        ranked = sorted(here, key=lambda o: (o.g.points, o.g.biggest, len(o.g.catches)), reverse=True)
        top = ranked[0]
        tied = [o for o in ranked if (o.g.points, o.g.biggest, len(o.g.catches)) == (top.g.points, top.g.biggest, len(top.g.catches))]
        r.add_log("📯 Lines up! " + ", ".join(f"{o.name} {o.g.points}" for o in ranked) + ".", "big")
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {top.g.points} points between {' & '.join(o.name for o in tied)}.")
        n = len(top.g.catches)
        return r.finish(top, f"🏆 {top.name} wins Frozen Pond with {top.g.points} points ({n} fish)!")

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're watching this one.")
        now = self.T()
        if now < 0:
            raise GameError("Wait for the horn!")
        if now >= self.t_end:
            raise GameError("Time's up.")
        self.advance(now)
        if self.room.phase != "playing":
            return
        kind = a.get("type")
        if kind == "drill":
            self.drill(p, a.get("x"), a.get("y"), now)
        elif kind == "drop":
            self.drop(p, a.get("hole"), now)
        elif kind == "hook":
            self.hook(p, now)
        elif kind == "reel":
            self.reel(p, a.get("on"), now)
        elif kind == "lift":
            if p.g.line["st"] in ("fight", "bite"):
                raise GameError("You've got a fish on!")
            p.g.line = {"st": "idle"}
        else:
            raise GameError("Unknown action.")
        self.schedule()

    def drill(self, p, x, y, now):
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (x, y)):
            raise GameError("Bad spot.")
        if math.hypot(x, y) > R - 0.8:
            raise GameError("Too close to the shore.")
        i = self.seat(p)
        mine = [h for h in self.holes if h["o"] == i]
        if len(mine) >= HOLES:
            raise GameError(f"You have {HOLES} holes already.")
        if any(h["at"] > now for h in mine):
            raise GameError("Finish drilling the first one.")
        if p.g.line["st"] in ("bite", "fight"):
            raise GameError("You've got a fish on!")
        if any(math.hypot(h["x"] - x, h["y"] - y) < HOLE_GAP for h in self.holes):
            raise GameError("Too close to another hole.")
        self.holes.append({"x": round(float(x), 2), "y": round(float(y), 2), "o": i, "at": round(now + DRILL, 2)})
        k = len(self.holes) - 1
        if p.g.line["st"] == "idle":
            # the line goes in as soon as the hole is through
            p.g.line = {"st": "retie", "h": k, "until": round(now + DRILL, 3)}

    def drop(self, p, k, now):
        if not isinstance(k, int) or isinstance(k, bool) or not 0 <= k < len(self.holes):
            raise GameError("Bad hole.")
        h = self.holes[k]
        if h["o"] != self.seat(p):
            raise GameError("That's someone else's hole.")
        if h["at"] > now + 0.05:
            raise GameError("Still drilling.")
        if p.g.line["st"] in ("bite", "fight"):
            raise GameError("You've got a fish on!")
        if p.g.line.get("h") == k and p.g.line["st"] == "wait":
            return
        p.g.line = {"st": "wait", "h": k, "since": round(now, 3)}
        p.g.line["bite_at"] = self.plan_bite(p, now + 0.6)

    def hook(self, p, now):
        ln = p.g.line
        if ln["st"] != "bite":
            raise GameError("Nothing's biting yet.")
        rng = self.rng
        fish = FISH[ln["kind"]]
        segs = []
        tot = 0.0
        while tot < FIGHT_MAX:
            rest = round(rng.uniform(*fish["rest"]), 2)
            pull = round(rng.uniform(*fish["pull"]), 2)
            if not segs:
                rest = round(rest * 0.6, 2)      # it's a little stunned at first
            segs += [[rest, False], [pull, True]]
            tot += rest + pull
        p.g.line = {"st": "fight", "h": ln["h"], "kind": ln["kind"], "school": ln["school"], "t0": round(now, 3),
                    "segs": segs, "toggles": [], "p": 0.0, "tau": 0.0, "L": fish["L"], "k": fish["k"], "reel": False}
        self.fight_tick(p, now)
        if p.bot:
            p.g.act_at = now + BOT_LAG.get(p.bot, 0.26)

    def reel(self, p, on, now):
        if not isinstance(on, bool):
            raise GameError("Bad reel.")
        ln = p.g.line
        if ln["st"] != "fight":
            return          # a late release after the fish is landed or gone: nothing to do
        step = int((now - ln["t0"]) / FIGHT_DT + 1e-9)
        cur = len(ln["toggles"]) % 2 == 1
        if on == cur:
            return
        if ln["toggles"] and step < ln["toggles"][-1]:
            step = ln["toggles"][-1]
        ln["toggles"].append(step)
        self.fight_tick(p, now)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the ice.")
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        self.schedule()

    # -- bots: drill where the shadows (or the bubbles) drift, hook with a human's reactions, reel when the fish rests

    def bot_ready(self):
        now = self.T()
        if now < 0 or now >= self.t_end:
            return False
        return any(o.bot and o.g.act_at is not None and now >= o.g.act_at for o in self.present())

    def bot_tick(self):
        now = self.T()
        self.advance(now)
        if self.room.phase != "playing":
            return
        for o in self.present():
            if o.bot and o.g.act_at is not None and now >= o.g.act_at:
                o.g.act_at = None
                self.bot_step(o, now)
                if o.g.act_at is not None and o.g.act_at <= now:
                    o.g.act_at = now + 0.3
        self.schedule()

    def squall(self, t):
        return any(a <= t < b for a, b in self.squalls)

    def spot_value(self, x, y, t0, level):
        """How good a spot looks over the next while (from what a person could see: shadows, bubbles)."""
        tot = 0.0
        ahead = (0, 4, 8, 12, 16) if level == "hard" else (0, 5) if level == "normal" else (0,)
        for dt in ahead:
            lam, _ = bite_rate(self.schools, x, y, t0 + dt)
            tot += lam
        return tot / len(ahead)

    def best_spot(self, o, now, level):
        rng = random
        if level == "easy" or self.squall(now):
            for _ in range(30):
                a, r = rng.uniform(0, 6.28), rng.uniform(1, R - 1.5)
                x, y = r * math.cos(a), r * math.sin(a)
                if all(math.hypot(h["x"] - x, h["y"] - y) >= HOLE_GAP for h in self.holes):
                    return x, y
            return None
        best, bv = None, -1
        lead = 10 if level == "hard" else 5
        for s in self.schools:
            if not school_live(s, now + lead):
                continue
            sx, sy = school_pos(s, now + lead)
            for _ in range(5):
                x, y = sx + rng.gauss(0, 1.2), sy + rng.gauss(0, 1.2)
                if math.hypot(x, y) > R - 1.2 or any(math.hypot(h["x"] - x, h["y"] - y) < HOLE_GAP for h in self.holes):
                    continue
                v = self.spot_value(x, y, now + 2, level) * (FISH[s["kind"]]["pts"] / 25) ** (0.5 if level == "hard" else 0)
                if v > bv:
                    best, bv = (x, y), v
        return best

    def bot_step(self, o, now):
        g, ln = o.g, o.g.line
        level = o.bot or "normal"
        i = self.seat(o)
        if ln["st"] == "bite":
            if g.hook_ok:
                self.hook(o, now)
            return
        if ln["st"] == "fight":
            el = now - ln["t0"]
            lag = BOT_LAG.get(level, 0.26)
            lunge, seg_end = lunging(ln, max(0.0, el - lag))
            want = not lunge and ln["tau"] < 0.75
            if lunge and random.random() < BOT_FORGET.get(level, 0.0):
                want = True        # gets greedy and keeps reeling into the lunge
            cur = len(ln["toggles"]) % 2 == 1
            if want != cur:
                self.reel(o, want, now)
            ln = o.g.line
            if ln.get("st") == "fight":
                g.act_at = ln["t0"] + seg_end + lag
            return
        mine = [k for k, h in enumerate(self.holes) if h["o"] == i]
        drilling = any(self.holes[k]["at"] > now for k in mine)
        # where to fish: the best of my ready holes right now
        ready = [k for k in mine if self.holes[k]["at"] <= now]
        vals = {k: self.spot_value(self.holes[k]["x"], self.holes[k]["y"], now, level) for k in ready}
        cur = ln.get("h") if ln["st"] in ("wait", "retie") else None
        best = max(ready, key=lambda k: vals[k]) if ready else None
        # drill another hole when there's room and the current spots look thin
        if len(mine) < HOLES and not drilling and (not ready or vals[best] < (0.12 if level == "hard" else 0.08) or (len(mine) < 2 and level != "easy")):
            spot = self.best_spot(o, now, level)
            if spot:
                try:
                    self.drill(o, spot[0], spot[1], now)
                except GameError:
                    pass
                g.act_at = now + DRILL + random.uniform(0.3, 1.0)
                return
        if best is not None and (cur is None or (level != "easy" and vals[best] > 1.6 * vals.get(cur, 0) + 0.02 and best != cur)):
            self.drop(o, best, now)
        g.act_at = now + random.uniform(3.0, 6.0) * (1.4 if level == "easy" else 1.0)

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "points"):
            return ""
        return f"{p.g.points} pts · {len(p.g.catches)} 🐟"

    def final_scores(self):
        return {o.id: o.g.points for o in self.players()}

    def view(self, p):
        now = self.T()
        anglers = {}
        for o in self.players():
            g = o.g
            ln = dict(g.line)
            if ln.get("st") == "wait":
                ln.pop("bite_at", None)          # nobody gets to know when the bite comes
            if ln.get("st") == "fight":
                ln["age"] = round(now - ln["t0"], 3)
            anglers[o.id] = {"points": g.points, "catches": g.catches[-12:], "n": len(g.catches), "line": ln,
                             "last": getattr(g, "last", None), "out": o.eliminated, "seat": self.seat(o)}
        return {"pond": {
            "seats": self.seats, "me": p.id if p.id in self.seats else None, "t": round(now, 3), "end": self.t_end,
            "R": R, "holes": self.holes, "schools": self.schools, "squalls": self.squalls, "anglers": anglers,
            "charBy": (self.room.players[self.char_by].name if self.char_by in self.room.players else None),
            "fish": {k: {"pts": v["pts"], "L": v["L"], "k": v["k"], "icon": v["icon"], "name": v["name"]} for k, v in FISH.items()},
            "geo": {"sigma": BITE_SIGMA, "holes": HOLES, "gap": HOLE_GAP, "drill": DRILL, "window": WINDOW, "dt": FIGHT_DT, "max": FIGHT_MAX,
                    "reel": REEL_V, "slack": SLACK_V, "take": LUNGE_TAKE, "lreel": LUNGE_REEL},
        }}
