"""Tide Castles: an original sand-castle building game for 1–6 players, everyone building at once.

Each player has their own strip of beach: a grid with the sea along the far edge and their 🏰 keep in the back row.
There are three tides. Before each one, everyone gets a bucket of sand and builds at the same time (the others'
beaches are hidden until the tide comes in): 🧱 walls, 🗼 towers, 🕳️ moats and 🐚 shells for points. Then the same
five waves roll up every beach.

A wave comes in from the sea with some force and loses one with every square it runs across, flowing round
whatever stands in its way. It stops at walls and towers, but wears one down a level when it hits harder than the
thing is tall. A dry moat soaks up the water that reaches it (once a tide). If water reaches your keep, your castle
falls for the rest of that tide. Each wave your keep stays dry scores 10; each shell still on the beach after the
tide scores 3. What's left of your walls stays for the next tide. Most points after the third tide wins.

The forecast (every wave's force) is shown while you build, so plan for the big ones.
"""
import heapq
import random
import time

from .base import Game, GameError

COLS, ROWS = 7, 6             # row 0 meets the sea; the keep sits in the back row
KEEP_ROW = ROWS - 1
WAVES = 5
TIDES = 3
SAND = 12                     # a bucket per tide
COST = {"wall": 1, "tower": 2, "moat": 1, "shell": 1}
HEIGHT = {"wall": 1, "tower": 2}
BUILD_T = 45.0
WAVE_T = 2.2                  # seconds each wave plays out on screen
BETWEEN = 6.0
WAVE_PTS, SHELL_PTS = 10, 3
BOT_TRIES = {"easy": 2, "normal": 25, "hard": 70}
BOT_PACE = {"easy": (6, 14), "normal": (5, 12), "hard": (4, 10)}


def forecast(rng, tide):
    """Five wave forces for a tide: rising through the tide and from tide to tide."""
    waves = sorted(rng.randint(6 + tide, 9 + tide) for _ in range(WAVES - 1))
    waves.append(waves[-1] + rng.randint(1, 2))      # the big one comes last
    return waves


def new_plot():
    return {"g": [[None] * COLS for _ in range(ROWS)], "keep": COLS // 2}


def run_tide(plot, waves):
    """Roll the waves up a plot (changed in place: worn structures, washed shells, moats drain after).
    Returns (per-wave records, waves survived before the keep fell (WAVES if it never did)).
    A record: {"wet": [[r, c, force]…], "hit": [[r, c, force, worn]…], "soak": [[r, c]…], "keep": bool}."""
    g = plot["g"]
    kc = plot["keep"]
    filled = set()
    out = []
    survived = None
    for w, F in enumerate(waves):
        best = {}
        pq = []
        for c in range(COLS):
            heapq.heappush(pq, (-F, 0, c))
        wet, hits, soak = [], {}, []
        keep_hit = False
        while pq:
            nf, r, c = heapq.heappop(pq)
            f = -nf
            if best.get((r, c), 0) >= f:
                continue
            best[(r, c)] = f
            cell = g[r][c]
            if r == KEEP_ROW and c == kc:
                keep_hit = True
                continue
            if cell and cell[0] in HEIGHT and cell[1] > 0:
                hits[(r, c)] = max(hits.get((r, c), 0), f)
                continue
            if cell and cell[0] == "moat" and (r, c) not in filled:
                soak.append([r, c])
                filled.add((r, c))
                continue
            wet.append([r, c, f])
            if cell and cell[0] == "shell":
                g[r][c] = None
            if f - 1 >= 1:
                for dr, dc in ((1, 0), (0, 1), (0, -1), (-1, 0)):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < ROWS and 0 <= cc < COLS and best.get((rr, cc), 0) < f - 1:
                        heapq.heappush(pq, (-(f - 1), rr, cc))
        worn = []
        for (r, c), f in sorted(hits.items()):
            kind, h = g[r][c]
            gone = f > h
            if gone:
                h -= 1
                g[r][c] = None if h <= 0 else ("wall", h)
            worn.append([r, c, f, int(gone)])
        out.append({"wet": wet, "hit": worn, "soak": soak, "keep": keep_hit})
        if keep_hit and survived is None:
            survived = w
    # moats drain between tides
    return out, WAVES if survived is None else survived


def score_tide(plot, survived):
    shells = sum(1 for row in plot["g"] for cell in row if cell and cell[0] == "shell")
    return survived * WAVE_PTS + shells * SHELL_PTS, shells


def copy_plot(plot):
    return {"g": [[(c[0], c[1]) if c else None for c in row] for row in plot["g"]], "keep": plot["keep"]}


class Tide(Game):
    id = "tide"
    category = "strategy"
    family = None
    howto = [
        "Everyone builds on their own beach at once, then the same five waves roll up every beach. Three tides.",
        "Spend your bucket of sand: 🧱 wall 1, 🗼 tower 2 (twice as tall), 🕳️ moat 1 (soaks up one wave), 🐚 shell 1.",
        "A wave loses force with every square it crosses and flows round things. It wears walls and towers down a level when it hits harder than they're tall.",
        "Water on your 🏰 keep and your castle falls for the tide. Each dry wave scores 10; each shell left scores 3.",
        "What's left stands for the next tide. Check the forecast: the last wave is the big one.",
    ]
    name = "Tide Castles"
    icon = "🏖️"
    blurb = "Build sand castles at the same time, then the same waves hit every beach. Keep your keep dry for three tides."
    min_players = 1
    max_players = 6
    badges = {**Game.badges,
              "fortress": ("🏰", "Fortress", "Keep your keep dry through all five waves of the last tide"),
              "beachcomber": ("🐚", "Beachcomber", "Score 5 shells in one tide")}
    settings_schema = {
        "sand": ("Sand per tide", [(12, "12"), (9, "9 (tight)"), (16, "16 (generous)")], 12),
        "build": ("Build time", [(45, "45 s"), (60, "60 s"), (30, "30 s")], 45),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.tide = 0
        self.plots = [new_plot() for _ in seated]
        self.points = [0] * len(seated)
        self.history = []
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🏖️ Tide Castles: {TIDES} tides of {WAVES} waves. Keep your keep dry!", "big")
        self.new_tide(time.time())

    @property
    def sand(self):
        v = self.s.get("sand", SAND)
        return v if v in (9, 12, 16) else SAND

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def present(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    def new_tide(self, now):
        self.tide += 1
        self.mark_round()
        self.waves = forecast(self.rng, self.tide - 1)
        self.stage = "build"
        self.left = [self.sand] * len(self.seats)
        self.placed = [set() for _ in self.seats]        # squares built this tide (can be taken back)
        self.moved = [False] * len(self.seats)
        self.ready = [False] * len(self.seats)
        self.result = None
        self.bot_next = [now + random.uniform(*BOT_PACE.get(getattr(self.pl(i), "bot", None) or "normal", (5, 12)))
                         for i in range(len(self.seats))]
        secs = int(self.s.get("build", BUILD_T))
        self.room.deadline = now + secs
        self.room.add_log(f"🌊 Tide {self.tide} of {TIDES}: waves of {', '.join(map(str, self.waves))}. Build!", "info")

    # -- building

    def act(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this one.")
        t = a.get("type")
        if self.stage != "build":
            raise GameError("Wait for the tide to go out.")
        if t == "done":
            self.ready[i] = True
            self.maybe_tide(time.time())
            return
        if self.ready[i] and t in ("build", "clear", "keep"):
            self.ready[i] = False          # changed your mind: back to building
        r, c = a.get("r"), a.get("c")
        if not (isinstance(r, int) and isinstance(c, int) and not isinstance(r, bool) and not isinstance(c, bool)
                and 0 <= r < ROWS and 0 <= c < COLS):
            raise GameError("That's off your beach.")
        if t == "build":
            self.build(i, r, c, a.get("item"))
        elif t == "clear":
            self.clear(i, r, c)
        elif t == "keep":
            self.move_keep(i, r, c)
        else:
            raise GameError("Unknown action.")

    def build(self, i, r, c, item):
        plot = self.plots[i]
        if item not in COST:
            raise GameError("Build what?")
        if r == KEEP_ROW and c == plot["keep"]:
            raise GameError("That's your keep.")
        cell = plot["g"][r][c]
        cost = COST[item]
        if cell:
            if cell[0] == "wall" and item == "tower":
                cost = 1                      # pile another level on a wall
            else:
                raise GameError("Something's already there (tap it to take it back).")
        if self.left[i] < cost:
            raise GameError("Not enough sand left in your bucket.")
        self.left[i] -= cost
        plot["g"][r][c] = (item, HEIGHT.get(item, 0))
        self.placed[i].add((r, c))

    def clear(self, i, r, c):
        plot = self.plots[i]
        cell = plot["g"][r][c]
        if not cell or (r, c) not in self.placed[i]:
            raise GameError("Only what you built this tide can come back.")
        self.left[i] += COST[cell[0]]
        plot["g"][r][c] = None
        self.placed[i].discard((r, c))
        self.left[i] = min(self.left[i], self.sand)

    def move_keep(self, i, r, c):
        plot = self.plots[i]
        if r != KEEP_ROW:
            raise GameError("The keep sits in the back row.")
        if self.moved[i] and c != plot["keep"]:
            raise GameError("You've already moved your keep this tide.")
        if plot["g"][r][c]:
            raise GameError("Clear that square first.")
        if c != plot["keep"]:
            plot["keep"] = c
            self.moved[i] = True

    def maybe_tide(self, now):
        if all(self.ready[i] or not self.present(i) for i in range(len(self.seats))):
            self.roll(now)

    def roll(self, now):
        r = self.room
        self.stage = "tide"
        self.result = []
        lines = []
        self.before = [self.plot_view(i) for i in range(len(self.seats))]     # (for the browsers to play the waves over)
        for i, plot in enumerate(self.plots):
            if not self.present(i):
                self.result.append(None)
                continue
            waves, survived = run_tide(plot, self.waves)
            pts, shells = score_tide(plot, survived)
            self.points[i] += pts
            self.result.append({"waves": waves, "survived": survived, "pts": pts, "shells": shells})
            lines.append(f"{self.name_of(i)} {pts}")
            if shells >= 5 and self.pl(i):
                self.award(self.seats[i], "beachcomber", at=now + WAVE_T * WAVES)
            if self.tide == TIDES and survived == WAVES and self.pl(i):
                self.award(self.seats[i], "fortress", at=now + WAVE_T * WAVES)
        self.history.append([res["pts"] if res else 0 for res in self.result])
        self.standing = [self.plot_view(i) for i in range(len(self.seats))]   # what rivals see while everyone builds next
        dur = WAVE_T * WAVES + 1.0
        r.deadline = now + dur
        self.tide_at = now
        dry = [i for i, res in enumerate(self.result) if res and res["survived"] == WAVES]
        r.add_log(f"🌊 Tide {self.tide}: " + ", ".join(lines) + ".", "big", at=now + dur - 0.5)
        if dry and len(self.seats) > 1:
            names = " & ".join(self.name_of(i) for i in dry)
            self.moment(f"🏰 {names} kept {'their keeps' if len(dry) > 1 else 'their keep'} dry all tide!", "gold", "good", at=now + dur - 0.5)

    def on_timeout(self):
        now = time.time()
        if self.stage == "build":
            for i in range(len(self.seats)):
                p = self.pl(i)
                if p and p.bot and not p.eliminated and not self.ready[i]:
                    self.bot_build(i, p.bot)
            return self.roll(now)
        if self.stage == "tide":
            self.stage = "between"
            self.room.deadline = now + BETWEEN
            return
        return self.after(now)

    def after(self, now):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.present(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        if self.tide >= TIDES:
            self.stage = "done"
            best = max(self.points[i] for i in here)
            tied = [i for i in here if self.points[i] == best]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie on {best} points between {' & '.join(self.name_of(i) for i in tied)}.")
            return r.finish(self.pl(tied[0]), f"🏆 {self.name_of(tied[0])} wins Tide Castles with {best} points!")
        self.new_tide(now)

    # -- bots: try layouts against the forecast on a copy of their beach and keep the best

    def bot_build(self, i, level):
        plot = self.plots[i]
        # take back anything built this tide (an autopilot taking over half-way starts clean)
        for (r, c) in list(self.placed[i]):
            self.clear(i, r, c)
        tries = BOT_TRIES.get(level, 25)
        best, best_v = None, -1e9
        for k in range(tries):
            lay = self.layout(plot, self.left[i], level, k)
            trial = copy_plot(plot)
            trial["keep"] = lay["keep"]
            for (r, c, item) in lay["items"]:
                trial["g"][r][c] = (item, HEIGHT.get(item, 0)) if not trial["g"][r][c] else ("tower", 2)
            waves = self.waves if level != "easy" else [w - 1 for w in self.waves]
            _, survived = run_tide(trial, waves)
            pts, _ = score_tide(trial, survived)
            # (hard) what's left standing is worth something for the next tide
            if level == "hard" and self.tide < TIDES:
                pts += 0.6 * sum(cell[1] for row in trial["g"] for cell in row if cell and cell[0] in HEIGHT)
            v = pts + random.uniform(0, 0.5)
            if v > best_v:
                best, best_v = lay, v
        if best["keep"] != plot["keep"] and not self.moved[i] and not plot["g"][KEEP_ROW][best["keep"]]:
            self.move_keep(i, KEEP_ROW, best["keep"])
        for (r, c, item) in best["items"]:
            try:
                self.build(i, r, c, item)
            except GameError:
                pass
        self.ready[i] = True

    def layout(self, plot, sand, level, k):
        """A candidate build: a keep column and a list of (r, c, item) within the sand."""
        rng = random
        g = plot["g"]
        kc = plot["keep"]
        if level != "easy" and k % 3 == 1:
            kc = rng.randrange(COLS)
            if g[KEEP_ROW][kc]:
                kc = plot["keep"]
        items, used, taken = [], 0, set()

        def add(r, c, item):
            nonlocal used
            if not (0 <= r < ROWS and 0 <= c < COLS) or (r, c) in taken or (r == KEEP_ROW and c == kc):
                return False
            cell = g[r][c]
            cost = COST[item]
            if cell:
                if cell[0] == "wall" and item == "tower" and cell[1] == 1:
                    cost = 1
                else:
                    return False
            if used + cost > sand:
                return False
            used += cost
            taken.add((r, c))
            items.append((r, c, item))
            return True
        if level == "easy" and k % 2 == 0:
            for _ in range(40):
                add(rng.randrange(ROWS), rng.randrange(COLS), rng.choice(("wall", "wall", "tower", "moat", "shell")))
            return {"keep": kc, "items": items}
        # a ring round the keep (deeper rings and towers in some), then moats in front, then the rest at random
        depth = rng.choice((1, 1, 2))
        ring = []
        for d in range(1, depth + 1):
            for dc in range(-d, d + 1):
                ring.append((KEEP_ROW - d, kc + dc))
            ring.append((KEEP_ROW, kc - d))
            ring.append((KEEP_ROW, kc + d))
        rng.shuffle(ring) if k % 4 == 3 else None
        towers = rng.random()
        for (r, c) in sorted(ring, key=lambda q: (abs(q[1] - kc) + (KEEP_ROW - q[0]))):
            add(r, c, "tower" if rng.random() < towers else "wall")
        for _ in range(rng.randint(0, 3)):
            add(rng.randint(KEEP_ROW - depth - 2, KEEP_ROW - depth - 1), kc + rng.randint(-2, 2), "moat")
        extra = ("wall", "tower", "moat", "shell")
        for _ in range(30):
            if used >= sand:
                break
            item = rng.choice(extra)
            if item == "shell":
                add(rng.randint(ROWS - 2, ROWS - 1), rng.randrange(COLS), "shell")
            else:
                add(rng.randrange(ROWS), rng.randrange(COLS), item)
        return {"keep": kc, "items": items}

    def bot_ready(self):
        if self.stage != "build":
            return False
        now = time.time()
        return any(self.pl(i) and self.pl(i).bot and not self.pl(i).eliminated and not self.ready[i] and now >= self.bot_next[i]
                   for i in range(len(self.seats)))

    def bot_tick(self):
        now = time.time()
        for i in range(len(self.seats)):
            p = self.pl(i)
            if p and p.bot and not p.eliminated and not self.ready[i] and now >= self.bot_next[i]:
                self.bot_build(i, p.bot)
        self.maybe_tide(now)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} packed up their bucket and spade.")
        left = r.contenders()
        if not left:
            return r.finish(None, "Everyone left.")
        if len(left) == 1 and len(self.seats) > 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if self.stage == "build":
            self.maybe_tide(time.time())

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "points"):
            return ""
        return f"🏖️ {self.points[i]}" + (" ✅" if self.stage == "build" and self.ready[i] else "")

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}

    def plot_view(self, i):
        plot = self.plots[i]
        return {"g": [[[c[0], c[1]] if c else None for c in row] for row in plot["g"]], "keep": plot["keep"]}

    def view(self, p):
        me = self.seat(p)
        now = time.time()
        sealed = self.stage == "build"
        plots = []
        for i in range(len(self.seats)):
            # rivals' beaches are hidden while everyone builds (you see what stood after the last tide)
            if sealed and i != me:
                st = getattr(self, "standing", None)
                plots.append(st[i] if st and i < len(st) else None)
            else:
                plots.append(self.plot_view(i))
        return {"tide": {
            "seats": self.seats, "me": me, "tide": self.tide, "tides": TIDES, "stage": self.stage, "waves": self.waves,
            "plots": plots, "points": self.points, "left": self.left, "ready": self.ready, "moved": self.moved,
            "placed": [[r, c] for (r, c) in self.placed[me]] if me is not None and sealed else [],
            "result": self.result if self.stage in ("tide", "between") else None,
            "before": getattr(self, "before", None) if self.stage in ("tide", "between") else None,
            "since": round(now - getattr(self, "tide_at", now), 2) if self.stage == "tide" else 0,
            "timeLeft": max(0.0, round((self.room.deadline or now) - now, 2)),
            "history": self.history, "sand": self.sand,
            "geo": {"cols": COLS, "rows": ROWS, "keepRow": KEEP_ROW, "waves": WAVES, "waveT": WAVE_T, "cost": COST,
                    "height": HEIGHT, "wavePts": WAVE_PTS, "shellPts": SHELL_PTS},
        }}
