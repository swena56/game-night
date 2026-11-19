"""Tide Castles: an original sand-castle building game for 1–6 players, everyone building at once.

Each player has their own strip of beach: a grid with the sea along the far edge and their 🏰 keep in the back row.
There are three tides. Before each one, everyone gets a bucket of sand and builds at the same time (the others'
beaches are hidden until the tide comes in): 🧱 walls, 🗼 towers, 🕳️ moats and 🐚 shells for points. Then the same
five waves roll up every beach.

A wave comes in from the sea with some force and loses one with every square it runs across, flowing round
whatever stands in its way. It stops at walls and towers, but wears one down a level when it hits at least four
harder than the thing is tall (#157/#184: so a tall tower really holds). Towers can be piled up to 4 high. A dry moat
soaks up the water that reaches it (once a tide). Water that reaches your keep knocks a third of its force off
the keep's 10 strength; at 0 the keep falls for the rest of that tide. Each wave your keep is still standing after
scores 6, the keep's strength left at the end of the tide scores that much again, and each shell still on the beach
scores 3. What's left of your walls stays for the next tide. Most points after the third tide wins.

The forecast (every wave's force) is shown while you build, so plan for the big ones.

#184/#185 (more satisfying building and tide loop): 🚩 flags go on towers 2+ high and score 3 every tide their tower
isn't worn (a worn tower drops its flag); three or more walls/towers side by side in a row make a 🧱 rampart, braced
(a wave must hit one 5 harder than it's tall to wear it); three or more moats side by side make a channel that soaks
two waves a tide. Every wall or tower still standing after a tide scores 1 (and 1 more in a rampart), and each tide
has a 🎯 goal worth GOAL_PTS. The waves now start after a short LEAD on screen (the swell building out at sea).
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
COST = {"wall": 1, "tower": 2, "moat": 1, "shell": 1, "flag": 1}
HEIGHT = {"wall": 1, "tower": 2}
MAX_H = 4                     # a tower piles up to this (1 sand a level)
WEAR = 4                      # a wave wears a level off when it hits at least height + WEAR (#184: was 2, and 1 more
                              # level for every 3 harder: everything washed away, nothing to show for a tide)
KEEP_HP = 10
BUILD_T = 45.0
WAVE_T = 2.2                  # seconds each wave plays out on screen
BETWEEN = 7.0                 # (#184: long enough for the tally to play out)
LEAD = 1.5                    # the swell building out at sea before the first wave
WAVE_PTS, SHELL_PTS = 6, 3
FLAG_PTS = 3                  # a flag flying at the end of a tide
STAND_PTS = 1                 # each wall/tower standing at the end of a tide (1 more in a rampart)
RUN = 3                       # side by side in a row: a rampart (braced) / a moat channel (soaks twice)
BRACE = 1                     # a rampart piece needs a wave this much harder to wear
GOAL_PTS = 8
# a goal per tide, judged at the end of it: (key, label, test on the tally)
GOALS = {
    "towers": ("🗼 3 towers standing", lambda t: t["towers"] >= 3),
    "rampart": ("🧱 A rampart of 4 standing", lambda t: t["longest"] >= 4),
    "dry": ("🏰 Keep your keep dry", lambda t: t["hp"] == KEEP_HP),
    "shells": ("🐚 2 shells left", lambda t: t["shells"] >= 2),
    "flags": ("🚩 2 flags flying", lambda t: t["flags"] >= 2),
    "moats": ("🕳️ Moats soak 3 waves", lambda t: t["soaked"] >= 3),
}
BOT_TRIES = {"easy": 2, "normal": 25, "hard": 70}
BOT_PACE = {"easy": (6, 14), "normal": (5, 12), "hard": (4, 10)}


RAMP = 1
SWELL_LO, SWELL = 6, 2   # (#184) the tide swells: each wave about SWELL bigger than the last, from SWELL_LO


def forecast(rng, tide):
    """Five wave forces for a tide: rising through the tide and from tide to tide."""
    waves = [rng.randint(SWELL_LO + SWELL * k, SWELL_LO + SWELL * k + 1) + RAMP * tide for k in range(WAVES - 1)]
    waves.append(waves[-1] + rng.randint(1, 2))      # the big one comes last
    return waves


def new_plot():
    return {"g": [[None] * COLS for _ in range(ROWS)], "keep": COLS // 2, "flags": set()}


def runs(g, kinds):
    """Rows of RUN or more side-by-side squares holding one of `kinds`: a list of [(r, c)…] runs."""
    out = []
    for r in range(ROWS):
        cur = []
        for c in range(COLS + 1):
            cell = g[r][c] if c < COLS else None
            if cell and cell[0] in kinds and (cell[0] not in HEIGHT or cell[1] > 0):
                cur.append((r, c))
                continue
            if len(cur) >= RUN:
                out.append(cur)
            cur = []
    return out


def braced(g):
    return {rc for run in runs(g, HEIGHT) for rc in run}


def run_tide(plot, waves):
    """Roll the waves up a plot (changed in place: worn structures, washed shells, moats drain after).
    Returns (per-wave records, waves the keep stood through, the keep's strength left).
    A record: {"wet": [[r, c, force]…], "hit": [[r, c, force, worn]…], "soak": [[r, c]…], "keep": bool (water
    reached it), "dmg": strength knocked off, "hp": strength after}."""
    g = plot["g"]
    kc = plot["keep"]
    flags = plot.setdefault("flags", set())
    cap = {rc: 2 for run in runs(g, ("moat",)) for rc in run}      # a channel soaks twice
    filled = {}
    out = []
    survived = None
    hp = KEEP_HP
    for w, F in enumerate(waves):
        best = {}
        pq = []
        for c in range(COLS):
            heapq.heappush(pq, (-F, 0, c))
        wet, hits, soak, washed = [], {}, [], []
        keep_hit = False
        keep_f = 0
        while pq:
            nf, r, c = heapq.heappop(pq)
            f = -nf
            if best.get((r, c), 0) >= f:
                continue
            best[(r, c)] = f
            cell = g[r][c]
            if r == KEEP_ROW and c == kc:
                keep_hit = True
                keep_f = max(keep_f, f)
                continue
            if cell and cell[0] in HEIGHT and cell[1] > 0:
                hits[(r, c)] = max(hits.get((r, c), 0), f)
                continue
            if cell and cell[0] == "moat" and filled.get((r, c), 0) < cap.get((r, c), 1):
                soak.append([r, c])
                filled[(r, c)] = filled.get((r, c), 0) + 1
                continue
            wet.append([r, c, f])
            if cell and cell[0] == "shell":
                washed.append([r, c])
                g[r][c] = None
            if f - 1 >= 1:
                for dr, dc in ((1, 0), (0, 1), (0, -1), (-1, 0)):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < ROWS and 0 <= cc < COLS and best.get((rr, cc), 0) < f - 1:
                        heapq.heappush(pq, (-(f - 1), rr, cc))
        worn = []
        brace = braced(g)
        for (r, c), f in sorted(hits.items()):
            kind, h = g[r][c]
            braced_hit = (r, c) in brace
            lost = wear(f, h, BRACE if braced_hit else 0)
            if lost:
                h -= lost
                g[r][c] = None if h <= 0 else ("wall" if h == 1 else "tower", h)
                flags.discard((r, c))
            worn.append([r, c, f, lost, kind, h + lost, braced_hit])
        dmg = min(hp, keep_dmg(keep_f)) if hp > 0 else 0
        hp -= dmg
        out.append({"wet": wet, "hit": worn, "soak": soak, "washed": washed,
                    "keep": keep_hit, "dmg": dmg, "hp": hp})
        if hp <= 0 and survived is None:
            survived = w
    # moats drain between tides
    return out, WAVES if survived is None else survived, hp


def keep_dmg(f):
    """Strength a keep loses to water arriving with force f: a third of it, rounded (a trickle does nothing)."""
    return (f + 1) // 3


def wear(f, h, brace=0):
    """Levels a wave of force f knocks off something h tall: a level if it hits at least WEAR harder (+1 braced in a
    rampart), else none."""
    return 1 if h > 0 and f - h - WEAR - brace >= 0 else 0


def tally(plot, survived, hp, recs=(), goal=None):
    """What a beach scores after its tide, part by part (shown as the tally on screen)."""
    g = plot["g"]
    shells = sum(1 for row in g for cell in row if cell and cell[0] == "shell")
    pieces = [(r, c) for r in range(ROWS) for c in range(COLS) if g[r][c] and g[r][c][0] in HEIGHT]
    rr = runs(g, HEIGHT)
    flags = sum(1 for rc in plot.get("flags", ()) if g[rc[0]][rc[1]] and g[rc[0]][rc[1]][0] == "tower")
    t = {"waves": survived * WAVE_PTS, "keep": hp, "shells": shells * SHELL_PTS, "flags": flags * FLAG_PTS,
         "standing": len(pieces) * STAND_PTS, "rampart": sum(len(x) for x in rr) * STAND_PTS, "goal": 0}
    if goal in GOALS:
        facts = {"towers": sum(1 for r, c in pieces if g[r][c][1] >= 2), "longest": max((len(x) for x in rr), default=0),
                 "hp": hp, "shells": shells, "flags": flags, "soaked": sum(len(w["soak"]) for w in recs)}
        t["goal"] = GOAL_PTS if GOALS[goal][1](facts) else 0
    return t, shells


def score_tide(plot, survived, hp, recs=(), goal=None):
    t, shells = tally(plot, survived, hp, recs, goal)
    return sum(t.values()), shells


def place_cost(cell, item):
    """Sand to build `item` on a square holding `cell` (None if it can't go there): a tower on a wall or a tower
    piles one more level on, up to MAX_H."""
    if item == "flag":
        return COST["flag"] if cell and cell[0] == "tower" and cell[1] >= 2 else None
    if not cell:
        return COST[item]
    if item == "tower" and cell[0] in HEIGHT and cell[1] < MAX_H:
        return 1
    return None


def placed_cell(cell, item):
    if item == "flag":
        return cell
    if cell and item == "tower":
        return ("tower", cell[1] + 1)
    return (item, HEIGHT.get(item, 0))


def copy_plot(plot):
    return {"g": [[(c[0], c[1]) if c else None for c in row] for row in plot["g"]], "keep": plot["keep"],
            "flags": set(plot.get("flags", ()))}


class Tide(Game):
    id = "tide"
    category = "strategy"
    family = None
    howto = [
        "Everyone builds on their own beach at once, then the same five waves roll up every beach. Three tides.",
        "Spend your bucket of sand: 🧱 wall 1, 🗼 tower 2 (tap it again to pile it higher, 1 a level, up to 4), 🕳️ moat 1 (soaks up one wave), 🐚 shell 1, 🚩 flag 1 (on a tower 2+ high).",
        "Three or more walls/towers side by side make a 🧱 rampart: braced, so waves need to hit 1 harder to wear them. Three moats side by side soak two waves each.",
        "Each tide's waves swell, the last the biggest. A wave loses 1 force with every square it crosses and flows round things. It wears a wall or tower down a level only when it hits at least 4 harder than it's tall.",
        "Your 🏰 keep has 10 strength: water reaching it knocks off a third of the wave's force. Each wave it's still standing scores 6, its strength left scores too, each shell left 3, each flag still flying 3.",
        "Every wall or tower still standing scores 1 (2 in a rampart), and each tide's 🎯 goal scores 8. What's left stands for the next tide. Check the forecast: the last wave is the big one. After each tide, open the wave report to see which pieces held or wore, where moats soaked water, what reached your keep, and how the score was made.",
    ]
    name = "Tide Castles"
    icon = "🏖️"
    blurb = "Build sand castles at the same time, then the same waves hit every beach. Pile your towers high and keep your keep standing for three tides."
    min_players = 1
    max_players = 6
    badges = {**Game.badges,
              "fortress": ("🏰", "Fortress", "Keep your keep dry through all five waves of the last tide"),
              "beachcomber": ("🐚", "Beachcomber", "Score 5 shells in one tide"),
              "standard": ("🚩", "Standard Bearer", "Keep 3 flags flying through a tide")}
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
        self.wave_history = []
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
        done = set(getattr(self, "goals", []))
        self.goal = self.rng.choice([k for k in GOALS if k not in done] or list(GOALS))
        self.goals = getattr(self, "goals", []) + [self.goal]
        self.stage = "build"
        self.left = [self.sand] * len(self.seats)
        # squares built on this tide: {(r, c): [sand spent, what stood there before]} (taken back whole)
        self.spent = [{} for _ in self.seats]
        self.moved = [False] * len(self.seats)
        self.ready = [False] * len(self.seats)
        self.result = None
        self.bot_next = [now + random.uniform(*BOT_PACE.get(getattr(self.pl(i), "bot", None) or "normal", (5, 12)))
                         for i in range(len(self.seats))]
        secs = int(self.s.get("build", BUILD_T))
        self.room.deadline = now + secs
        self.room.add_log(f"🌊 Tide {self.tide} of {TIDES}: waves of {', '.join(map(str, self.waves))}. 🎯 {GOALS[self.goal][0]}. Build!", "info")

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

    def __setstate__(self, st):
        # a room saved before #157 kept a set of built squares instead of what each one cost
        if "spent" not in st and "placed" in st:
            st["spent"] = [{rc: [0, None] for rc in pl} for pl in st.pop("placed")]
        # … and before #184 there were no flags or goals
        for pl in st.get("plots", []):
            pl.setdefault("flags", set())
        st.setdefault("goal", None)
        st.setdefault("goals", [])
        st.setdefault("wave_history", [])
        self.__dict__.update(st)

    def build(self, i, r, c, item):
        plot = self.plots[i]
        if item not in COST:
            raise GameError("Build what?")
        if r == KEEP_ROW and c == plot["keep"]:
            raise GameError("That's your keep.")
        cell = plot["g"][r][c]
        flags = plot.setdefault("flags", set())
        cost = place_cost(cell, item)
        if item == "flag" and (r, c) in flags:
            raise GameError("A flag's already flying there.")
        if cost is None:
            if item == "flag":
                raise GameError("Flags go on towers 2 or more high.")
            if cell and cell[0] in HEIGHT and item == "tower":
                raise GameError(f"That's as tall as sand will stand ({MAX_H}).")
            raise GameError("Something's already there (tap it to take it back).")
        if self.left[i] < cost:
            raise GameError("Not enough sand left in your bucket.")
        self.left[i] -= cost
        sp = self.spent[i].setdefault((r, c), [0, cell, (r, c) in flags])
        sp[0] += cost
        plot["g"][r][c] = placed_cell(cell, item)
        if item == "flag":
            flags.add((r, c))

    def clear(self, i, r, c):
        """Take back everything built on a square this tide: its sand back, and whatever stood there before."""
        plot = self.plots[i]
        sp = self.spent[i].get((r, c))
        if not plot["g"][r][c] or not sp:
            raise GameError("Only what you built this tide can come back.")
        self.left[i] = min(self.sand, self.left[i] + sp[0])
        plot["g"][r][c] = sp[1]
        flags = plot.setdefault("flags", set())
        if len(sp) > 2 and sp[2] and sp[1]:
            flags.add((r, c))
        else:
            flags.discard((r, c))
        del self.spent[i][(r, c)]

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
            waves, survived, hp = run_tide(plot, self.waves)
            parts, shells = tally(plot, survived, hp, waves, self.goal)
            pts = sum(parts.values())
            self.points[i] += pts
            self.result.append({"waves": waves, "survived": survived, "hp": hp, "pts": pts, "shells": shells, "parts": parts})
            lines.append(f"{self.name_of(i)} {pts}")
            if shells >= 5 and self.pl(i):
                self.award(self.seats[i], "beachcomber", at=now + LEAD + WAVE_T * WAVES)
            if self.tide == TIDES and hp == KEEP_HP and self.pl(i):
                self.award(self.seats[i], "fortress", at=now + LEAD + WAVE_T * WAVES)
            if parts["flags"] >= 3 * FLAG_PTS and self.pl(i):
                self.award(self.seats[i], "standard", at=now + LEAD + WAVE_T * WAVES)
        self.wave_history.append({"tide": self.tide, "forces": list(self.waves),
                                  "before": self.before, "result": self.result})
        self.history.append([res["pts"] if res else 0 for res in self.result])
        self.standing = [self.plot_view(i) for i in range(len(self.seats))]   # what rivals see while everyone builds next
        dur = LEAD + WAVE_T * WAVES + 1.0
        r.deadline = now + dur
        self.tide_at = now
        dry = [i for i, res in enumerate(self.result) if res and res["hp"] == KEEP_HP]
        r.add_log(f"🌊 Tide {self.tide}: " + ", ".join(lines) + ".", "big", at=now + dur - 0.5)
        if dry and len(self.seats) > 1:
            names = " & ".join(self.name_of(i) for i in dry)
            self.moment(f"🏰 {names} kept {'their keeps' if len(dry) > 1 else 'their keep'} dry all tide!", "gold", "good", at=now + dur - 0.5)
        if self.goal in GOALS and len(self.seats) > 1:
            hit = [i for i, res in enumerate(self.result) if res and res["parts"]["goal"]]
            if hit and len(hit) < len([x for x in self.result if x]):
                self.moment(f"🎯 {' & '.join(self.name_of(i) for i in hit)}: {GOALS[self.goal][0]} +{GOAL_PTS}", "good", None, at=now + dur)

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
                # (#184) a tie goes to the tallest castle still standing (every level of every wall and tower)
                tall = {i: sum(c[1] for row in self.plots[i]["g"] for c in row if c and c[0] in HEIGHT) for i in tied}
                top = max(tall.values())
                if list(tall.values()).count(top) == 1:
                    w = next(i for i in tied if tall[i] == top)
                    return r.finish(self.pl(w), f"🏆 {self.name_of(w)} wins Tide Castles with {best} points and the tallest castle left standing ({top} levels)!")
                return r.finish(None, f"🤝 A tie on {best} points between {' & '.join(self.name_of(i) for i in tied)}.")
            return r.finish(self.pl(tied[0]), f"🏆 {self.name_of(tied[0])} wins Tide Castles with {best} points!")
        self.new_tide(now)

    # -- bots: try layouts against the forecast on a copy of their beach and keep the best

    def bot_build(self, i, level):
        plot = self.plots[i]
        # take back anything built this tide (an autopilot taking over half-way starts clean)
        for (r, c) in list(self.spent[i]):
            self.clear(i, r, c)
        tries = BOT_TRIES.get(level, 25)
        best, best_v = None, -1e9
        for k in range(tries):
            lay = self.layout(plot, self.left[i], level, k)
            trial = copy_plot(plot)
            trial["keep"] = lay["keep"]
            for (r, c, item) in lay["items"]:
                trial["g"][r][c] = placed_cell(trial["g"][r][c], item)
                if item == "flag":
                    trial["flags"].add((r, c))
            # easy plans for gentler waves than forecast
            waves = [w + {"easy": -2}.get(level, 0) for w in self.waves]
            recs, survived, hp = run_tide(trial, waves)
            pts, _ = score_tide(trial, survived, hp, recs, self.goal if level != "easy" else None)
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
        items, used, now = [], 0, {}
        flags = set(plot.get("flags", ()))

        def add(r, c, item):
            nonlocal used
            if not (0 <= r < ROWS and 0 <= c < COLS) or (r == KEEP_ROW and c == kc):
                return False
            cell = now.get((r, c), g[r][c])
            cost = place_cost(cell, item)
            if cost is None or used + cost > sand or (item == "flag" and (r, c) in flags):
                return False
            used += cost
            now[(r, c)] = placed_cell(cell, item)
            if item == "flag":
                flags.add((r, c))
            items.append((r, c, item))
            return True

        def raise_to(r, c, h):
            if not (0 <= r < ROWS and 0 <= c < COLS):
                return
            cell = now.get((r, c), g[r][c])
            if not cell:
                if not add(r, c, "tower" if h >= 2 else "wall"):
                    return
            while (now.get((r, c), g[r][c]) or ("", 9))[1] < h and add(r, c, "tower"):
                pass
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
        tall = rng.choice((1, 2, 2, 3, 3, 4, 4)) if level != "easy" else rng.choice((1, 2, 2, 3))
        for (r, c) in sorted(ring, key=lambda q: (abs(q[1] - kc) + (KEEP_ROW - q[0]))):
            raise_to(r, c, max(1, tall - (1 if r == KEEP_ROW and rng.random() < 0.5 else 0)))
        for _ in range(rng.randint(0, 3)):
            add(rng.randint(KEEP_ROW - depth - 2, KEEP_ROW - depth - 1), kc + rng.randint(-2, 2), "moat")
        if level != "easy" and k % 2 == 0:
            # a rampart: a straight run of walls across the front of the ring
            fr = rng.randint(KEEP_ROW - depth - 2, KEEP_ROW - depth - 1)
            for c in range(kc - 2, kc + 3):
                add(fr, c, "wall")
        extra = ("wall", "tower", "moat", "shell", "flag")
        for _ in range(30):
            if used >= sand:
                break
            item = rng.choice(extra)
            if item == "flag":
                tall_ones = [(r, c) for (r, c), cell in now.items() if cell and cell[0] == "tower" and cell[1] >= 2]
                tall_ones += [(r, c) for r in range(ROWS) for c in range(COLS) if (r, c) not in now and g[r][c] and g[r][c][0] == "tower" and g[r][c][1] >= 2]
                if tall_ones:
                    add(*rng.choice(tall_ones), "flag")
            elif item == "shell":
                add(rng.randint(ROWS - 2, ROWS - 1), rng.randrange(COLS), "shell")
            elif item == "tower" and items and rng.random() < 0.5:
                r, c, _ = rng.choice(items)     # pile one of mine higher
                add(r, c, "tower")
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
        return {"g": [[[c[0], c[1]] if c else None for c in row] for row in plot["g"]], "keep": plot["keep"],
                "flags": sorted([r, c] for r, c in plot.get("flags", ()))}

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
            "placed": [[r, c] for (r, c) in self.spent[me]] if me is not None and sealed else [],
            "result": self.result if self.stage in ("tide", "between") else None,
            "before": getattr(self, "before", None) if self.stage in ("tide", "between") else None,
            "since": round(now - getattr(self, "tide_at", now), 2) if self.stage == "tide" else 0,
            "timeLeft": max(0.0, round((self.room.deadline or now) - now, 2)),
            "history": self.history, "waveHistory": getattr(self, "wave_history", [])[-TIDES:], "sand": self.sand,
            "goal": [self.goal, GOALS[self.goal][0], GOAL_PTS] if getattr(self, "goal", None) in GOALS else None,
            "geo": {"cols": COLS, "rows": ROWS, "keepRow": KEEP_ROW, "waves": WAVES, "waveT": WAVE_T, "cost": COST,
                    "height": HEIGHT, "wavePts": WAVE_PTS, "shellPts": SHELL_PTS, "flagPts": FLAG_PTS,
                    "standPts": STAND_PTS, "run": RUN, "brace": BRACE, "lead": LEAD,
                    "maxH": MAX_H, "wear": WEAR, "keepHp": KEEP_HP},
        }}
