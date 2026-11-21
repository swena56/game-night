"""Sky Drift: an original hot-air balloon race for 1–6 players, everyone moving at once.

The sky over the map has four layers of wind, each blowing its own way at its own speed. A balloon can't
steer: each turn everyone secretly picks Climb, Hold or Descend (and maybe fires the burner for one more
cell), then every balloon changes height and drifts with the wind of its new layer. Drift over a 🚩
pennant to take it (a new one appears somewhere else). The winds shift every few turns, with a forecast
one turn ahead. A 🌩 storm wanders the map and throws any balloon that ends its turn inside it. Two or
more balloons that start a turn together in the same cell and layer draft each other: +1 cell each.
Most pennants after the last turn wins; ties go to whoever is nearest a pennant.
"""
import math
import random
import time

from .base import Game, GameError

W, H = 12, 9           # the cosy map, in cells (the 'size' setting picks this or a bigger one, #107)
SIZES = {"cosy": (12, 9), "wide": (16, 12), "vast": (20, 15)}
LAYERS = 4              # wind layers, 0 (low) .. 3 (high)
PENNANTS = 5            # on the map at once
REACH = 1               # a balloon takes a pennant it passes within this many cells of
SHIFT = 3               # winds change every this many turns
FUEL = 3                # burner boosts per game
PLAY = 2.6              # seconds the browsers take to play a turn back
DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
CHOICES = {"up": 1, "hold": 0, "down": -1}


def make_winds(rng, prev=None):
    """[(dir index, speed)] per layer; a shift turns each layer a little from where it was."""
    out = []
    for z in range(LAYERS):
        if prev is None:
            d = rng.randrange(8)
        else:
            d = (prev[z][0] + rng.choice((-2, -1, -1, 0, 1, 1, 2))) % 8
        out.append((d, rng.choice((1, 1, 2)) if z < 2 else rng.choice((1, 2, 2, 3))))
    # never leave every layer blowing roughly the same way: give one layer the opposite of layer 0
    if len({o[0] for o in out}) <= 2:
        z = rng.randrange(1, LAYERS)
        out[z] = ((out[0][0] + 4) % 8, out[z][1])
    return out


def step_path(x, y, z, choice, burn, winds, draft=0, w=W, h=H):
    """The cells a balloon passes, start excluded: [[x, y, z], ...]. Balloons stop at the map's edge."""
    z = max(0, min(LAYERS - 1, z + CHOICES[choice]))
    d, sp = winds[z]
    dx, dy = DIRS[d]
    n = sp + (1 if burn else 0) + draft
    path = [[x, y, z]]
    for _ in range(n):
        nx, ny = max(0, min(w - 1, x + dx)), max(0, min(h - 1, y + dy))
        if (nx, ny) == (x, y):
            break
        x, y = nx, ny
        path.append([x, y, z])
    return path


def dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))   # king moves: winds blow diagonally too


class Drift(Game):
    id = "drift"
    category = "strategy"
    family = None
    howto = [
        "Balloons can't steer: each turn pick ⬆ Climb, ⏸ Hold or ⬇ Descend, then every balloon drifts with the wind of its new layer. Everyone moves at once.",
        "Each of the four layers has its own wind (the arrows). Pick the layer that carries you over a 🚩 pennant to take it; a new one appears elsewhere.",
        "🔥 The burner adds one cell to your drift (3 per game). Two balloons that start a turn in the same cell and layer draft: +1 cell each.",
        "The winds shift every 3 turns; the forecast shows the next winds a turn ahead. Ending a turn in the 🌩 storm throws you a cell and drops you a layer.",
        "🔥 Take a pennant three turns running and you earn a spare burner charge. A miss or a storm throw resets the streak.",
        "Most pennants after the last turn wins. A tie goes to whoever is nearest a pennant.",
    ]
    name = "Sky Drift"
    icon = "🎈"
    blurb = "Ride the wind layers in a hot-air balloon: climb or sink into the right breeze to sweep up pennants, and dodge the storm."
    min_players = 1
    max_players = 6
    badges = {**Game.badges,
              "double": ("🎏", "Double sweep", "Take two pennants in one turn"),
              "storm": ("🌪️", "Storm chaser", "Take a pennant on the turn the storm threw you")}
    settings_schema = {
        "turns": ("Turns", [(15, "15"), (10, "10"), (20, "20")], 15),
        "storm": ("Storm", [(1, "🌩 On"), (0, "Off")], 1),
        "size": ("Sky", [("wide", "🗺️ Wide"), ("cosy", "🏡 Cosy"), ("vast", "🌍 Vast")], "wide"),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.turns = int(self.s.get("turns", 15))
        self.w, self.h = SIZES.get(self.s.get("size", "wide"), SIZES["wide"])
        self.npen = round(PENNANTS * self.w * self.h / (W * H))  # same density on every size
        self.turn_no = 1
        self.winds = make_winds(rng)
        self.next_winds = make_winds(rng, self.winds)
        self.pennants = []
        self.score = {pid: 0 for pid in self.seats}
        self.fuel = {pid: FUEL for pid in self.seats}
        self.pos = {}
        spots = [(x, y) for x in range(1, 4) for y in range(1, self.h - 1)]
        rng.shuffle(spots)
        for k, pid in enumerate(self.seats):
            x, y = spots[k % len(spots)]
            self.pos[pid] = [x, y, rng.randrange(LAYERS)]
        for _ in range(self.npen):
            self.place_pennant()
        self.storm = None
        if self.s.get("storm", 1):
            self.storm = {"x": self.w // 2, "y": rng.randrange(2, self.h - 2), "d": rng.choice((0, 2, 4, 6))}
        self.terrain = [[round(rng.random(), 2) for _ in range(self.w)] for _ in range(self.h)]
        self.last = None
        self.choices = {}
        self.ready_at = 0.0
        self.room.add_log(f"🎈 Sky Drift: {self.turns} turns. Pick a layer, ride its wind, sweep up the 🚩 pennants.", "big")
        self.open_turn(0.0)

    def path(self, *a):
        return step_path(*a, w=self.w, h=self.h)

    def place_pennant(self):
        taken = {(p[0], p[1]) for p in self.pennants} | {(v[0], v[1]) for v in self.pos.values()}
        free = [(x, y) for x in range(self.w) for y in range(self.h) if (x, y) not in taken
                and all(dist((x, y), (v[0], v[1])) >= 3 for v in self.pos.values())]
        if not free:
            free = [(x, y) for x in range(self.w) for y in range(self.h) if (x, y) not in taken]
        x, y = self.rng.choice(free)
        self.pennants.append([x, y])

    def pl(self, pid):
        return self.room.players.get(pid)

    def flyers(self):
        return [p for p in (self.pl(i) for i in self.seats) if p and not p.eliminated]

    def waiting_on(self):
        return [p for p in self.flyers() if p.id not in self.choices]

    def open_turn(self, wait):
        r = self.room
        r.turn = None
        self.choices = {}
        self.ready_at = time.time() + wait
        t = r.settings.get("timer")
        r.deadline = self.ready_at + t if t else None
        r.bot_at = max(r.bot_at, self.ready_at + random.uniform(0.8, 1.8))

    def drafts(self):
        """Players who start this turn sharing a cell and a layer with another balloon."""
        at = {}
        for p in self.flyers():
            at.setdefault(tuple(self.pos[p.id]), []).append(p.id)
        return {pid for ids in at.values() if len(ids) > 1 for pid in ids}

    # -- actions

    def act(self, p, a):
        if a.get("type") != "fly":
            raise GameError("Unknown action.")
        if p.id not in self.seats or p.eliminated:
            raise GameError("You're not flying.")
        if p.id in self.choices:
            raise GameError("You've already locked in.")
        if time.time() < self.ready_at - 0.3:
            raise GameError("Wait for the balloons to land their drift.")
        ch, burn = a.get("choice"), a.get("burn", False)
        if ch not in CHOICES or not isinstance(burn, bool):
            raise GameError("Bad move.")
        if burn and self.fuel[p.id] <= 0:
            raise GameError("Your burner is out of fuel.")
        self.choices[p.id] = (ch, burn)
        if not self.waiting_on():
            self.resolve()

    def resolve(self):
        r = self.room
        drafts = self.drafts()
        before = {pid: list(v) for pid, v in self.pos.items()}
        paths = {}
        for p in self.flyers():
            ch, burn = self.choices.get(p.id, ("hold", False))
            if burn:
                self.fuel[p.id] -= 1
            x, y, z = self.pos[p.id]
            paths[p.id] = self.path(x, y, z, ch, burn, self.winds, 1 if p.id in drafts else 0)
        # step everyone together so two balloons reaching a pennant on the same step both take it
        taken = {pid: 0 for pid in paths}
        events = []
        longest = max([len(v) for v in paths.values()] + [1])
        for k in range(1, longest):
            hits = {}
            for pid, path in paths.items():
                if k < len(path):
                    for j, pn in enumerate(self.pennants):
                        if dist(path[k], pn) <= REACH and pid not in hits.get(j, []):
                            hits.setdefault(j, []).append(pid)
            for j in sorted(hits, reverse=True):
                pn = self.pennants.pop(j)
                for pid in hits[j]:
                    self.score[pid] += 1
                    taken[pid] += 1
                events.append({"k": k, "kind": "pennant", "at": pn, "by": hits[j]})
                names = " & ".join(self.pl(pid).name for pid in hits[j] if self.pl(pid))
                r.add_log(f"🚩 {names} {'take' if len(hits[j]) > 1 else 'takes'} a pennant.", "power")
        for _ in range(self.npen - len(self.pennants)):
            self.place_pennant()
        for pid, path in paths.items():
            self.pos[pid] = list(path[-1])
        # the storm moves, then throws whoever it catches
        flung = {}
        if self.storm:
            st = self.storm
            dx, dy = DIRS[st["d"]]
            nx, ny = st["x"] + dx, st["y"] + dy
            if not (1 <= nx <= self.w - 2 and 1 <= ny <= self.h - 2) or self.rng.random() < 0.25:
                st["d"] = (st["d"] + self.rng.choice((2, 3, 5, 6))) % 8
                dx, dy = DIRS[st["d"]]
                nx, ny = max(1, min(self.w - 2, st["x"] + dx)), max(1, min(self.h - 2, st["y"] + dy))
            st["x"], st["y"] = nx, ny
            for pid, v in self.pos.items():
                if self.pl(pid) and not self.pl(pid).eliminated and dist(v, (st["x"], st["y"])) <= 1:
                    d = DIRS[self.rng.randrange(8)]
                    v[0] = max(0, min(self.w - 1, v[0] + d[0] * 2))
                    v[1] = max(0, min(self.h - 1, v[1] + d[1] * 2))
                    v[2] = max(0, v[2] - 1)
                    flung[pid] = list(v)
                    events.append({"k": longest, "kind": "storm", "by": [pid], "at": list(v)})
                    r.add_log(f"🌩 The storm throws {self.pl(pid).name}!", "power")
                    if taken.get(pid):
                        self.award(pid, "storm")
        self.update_streaks(taken, flung)
        for pid, n in taken.items():
            if n >= 2:
                self.award(pid, "double")
                self.moment(f"🎏 {self.pl(pid).name}: DOUBLE SWEEP", "gold", "fanfare")
        self.last = {"turn": self.turn_no, "paths": paths, "from": before, "events": events, "flung": flung,
                     "drafts": sorted(drafts), "choices": {pid: list(c) for pid, c in self.choices.items()},
                     "id": self.turn_no, "steps": longest}
        if self.turn_no >= self.turns:
            return self.end()
        self.turn_no += 1
        if (self.turn_no - 1) % SHIFT == 0:
            self.winds = self.next_winds
            self.next_winds = make_winds(self.rng, self.winds)
            r.add_log("🌬️ The winds shift.", "info")
        self.open_turn(PLAY)

    STREAK = 3   # 🔥 pennants on this many turns running earn a spare burner charge

    def update_streaks(self, taken, flung=()):
        """A pennant on consecutive turns builds a streak (a miss or a storm throw ends it); every STREAK-th turn
        in a row refuels the burner by one."""
        st = getattr(self, "streaks", None)
        if st is None:
            st = self.streaks = {}
        for pid, n in taken.items():
            st[pid] = st.get(pid, 0) + 1 if n and pid not in flung else 0
            if st[pid] and st[pid] % self.STREAK == 0 and self.pl(pid):
                self.fuel[pid] += 1
                self.moment(f"🔥 {self.pl(pid).name}: {st[pid]} turns running, +1 burner!", "gold", "good")

    def shift_soon(self):
        return self.turn_no % SHIFT == 0

    def end(self):
        r = self.room
        ps = self.flyers()
        if not ps:
            return r.finish(None, "Everyone left.")

        def near(p):
            v = self.pos[p.id]
            return min(dist(v, pn) for pn in self.pennants)

        ranked = sorted(ps, key=lambda p: (-self.score[p.id], near(p)))
        top = ranked[0]
        tied = [p for p in ranked if self.score[p.id] == self.score[top.id] and near(p) == near(top)]
        n = self.score[top.id]
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {n} pennant{'s' if n != 1 else ''} between {' & '.join(p.name for p in tied)}.")
        how = "" if len(ranked) < 2 or self.score[ranked[1].id] < n else " (nearest a pennant)"
        if len(ps) == 1:
            return r.finish(top, f"🎈 {top.name} sweeps up {n} pennant{'s' if n != 1 else ''}!")
        return r.finish(top, f"🏆 {top.name} wins Sky Drift with {n} pennant{'s' if n != 1 else ''}{how}!")

    def on_timeout(self):
        for p in self.waiting_on():
            self.choices[p.id] = ("hold", False)
            self.room.add_log(f"⏰ {p.name} holds height.", "power")
        self.resolve()

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} floated away.")
        self.choices.pop(p.id, None)
        if not self.flyers():
            return r.finish(None, "Everyone left.")
        if r.phase == "playing" and not self.waiting_on():
            self.resolve()

    # -- view

    def options(self, pid):
        """Where each choice would carry this balloon (storm and drafting aside: drafting is shown though)."""
        if pid not in self.pos:
            return {}
        x, y, z = self.pos[pid]
        d = 1 if pid in self.drafts() else 0
        out = {}
        for ch in CHOICES:
            out[ch] = self.path(x, y, z, ch, False, self.winds, d)
            if self.fuel[pid] > 0:
                out[ch + "+"] = self.path(x, y, z, ch, True, self.winds, d)
        return out

    def meta(self, p):
        if p.id not in getattr(self, "score", {}):
            return ""
        lock = " · ✅" if p.id in self.choices and self.room.phase == "playing" else ""
        return f"🚩{self.score[p.id]} · 🔥{self.fuel[p.id]}{lock}"

    def final_scores(self):
        return dict(self.score)

    def view(self, p):
        mine = p.id in self.seats and not p.eliminated
        return {"drift": {
            "w": self.w, "h": self.h, "layers": LAYERS, "turn": self.turn_no, "turns": self.turns,
            "winds": self.winds, "next": self.next_winds if self.shift_soon() else None, "dirs": DIRS,
            "pennants": self.pennants, "storm": self.storm, "pos": self.pos, "score": self.score, "fuel": self.fuel,
            "terrain": self.terrain, "last": self.last, "seats": self.seats,
            "locked": [pid for pid in self.choices], "mine": list(self.choices[p.id]) if p.id in self.choices else None,
            "options": self.options(p.id) if mine else {}, "drafts": sorted(self.drafts()),
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)),
        }}

    # -- bots: try every choice (and, for hard, every follow-up) in the known winds

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())

    def bot_tick(self):
        for p in [p for p in self.waiting_on() if p.bot]:
            self.choices[p.id] = self.bot_choice(p)
        if self.room.phase == "playing" and not self.waiting_on():
            self.resolve()

    def value(self, path, pennants, storm):
        got = [pn for pn in pennants if any(dist(c, pn) <= REACH for c in path[1:])]
        end = path[-1]
        left = [pn for pn in pennants if pn not in got]
        near = min((dist(end, pn) for pn in left), default=0)
        v = 10 * len(got) - near
        if storm and dist(end, (storm["x"], storm["y"])) <= 2:
            v -= 3
        return v, got

    def bot_choice(self, p):
        level = p.bot
        x, y, z = self.pos[p.id]
        draft = 1 if p.id in self.drafts() else 0
        opts = [(ch, False) for ch in CHOICES] + ([(ch, True) for ch in CHOICES] if self.fuel[p.id] > 0 else [])
        if level == "easy" and random.random() < 0.3:
            return random.choice(opts[:3])
        later = self.next_winds if self.shift_soon() else self.winds
        best, best_v = None, -1e9
        for ch, burn in opts:
            path = self.path(x, y, z, ch, burn, self.winds, draft)
            v, got = self.value(path, self.pennants, self.storm if level != "easy" else None)
            if burn:
                v -= 1.5 if level == "hard" else 0.8   # fuel is worth keeping
            if level == "hard":
                ex, ey, ez = path[-1]
                rest = [pn for pn in self.pennants if pn not in got]
                v2 = max(self.value(self.path(ex, ey, ez, c2, False, later), rest, None)[0] for c2 in CHOICES)
                v += 0.8 * v2
            if level == "easy":
                v += random.uniform(-3, 3)
            elif level == "normal":
                v += random.uniform(-1, 1)
            if v > best_v:
                best, best_v = (ch, burn), v
        return best
