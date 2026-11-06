"""Cannon Hills: an original artillery duel for 2–6 players.

Everyone has a cannon on a side-on range of generated hills. On your turn you set an angle and a power,
pick a shell and fire; the server flies the shell (gravity and that turn's wind), blows a crater (or
builds a mound), hurts every cannon near the blast, and drops cannons whose ground was blown away onto
the new surface (a long drop hurts). Last cannon standing takes the round; most rounds wins.

Physics runs on the server in 2D (x across, y up, one unit per terrain column) at 120 steps a second.
Each shot's path is sent to every browser to play back at 30 frames a second, like Putt Party.

⚡ All at once (an option): everyone aims in secret and all the shells fly together."""
import math
import random
import time

from .base import Game, GameError

W, H = 320, 180          # the range: terrain columns across, units high
WATER = 8                # the sea: ground below this is water, and a cannon that sinks into it is out
G = 60.0                 # gravity, units/s²
VMAX = 140.0             # muzzle speed at full power, units/s
WIND_K = 2.2             # wind 1 = this much sideways acceleration, units/s²
DT = 1 / 120
FRAME = 4                # record every 4th step (30 fps)
MAX_T = 12.0             # a shell flies at most this long
TANK_R = 6.0             # a cannon's hitbox radius, centred TANK_UP above its feet
TANK_UP = 4.0
BARREL = 8.0
HP = 100
FALL_FREE = 6            # a drop this high (units) is harmless; more costs FALL_K a unit, up to FALL_MAX
FALL_K, FALL_MAX = 1.2, 40
ROUND_PAUSE = 4.0        # seconds to read the round's result, after the last shell has landed
SHOTS_PER_ROUND = 14     # each, before the round goes to whoever has the most ❤️ (a stalemate guard)
SPLIT_SPREAD = 14.0      # a splitter's outer bomblets leave this much faster / slower sideways

# key: (icon, name, blast radius, damage, per round (None = endless), what it does)
SHELLS = {
    "shell": ("🔵", "Shell", 16, 35, None, "A plain shell."),
    "big": ("💥", "Big Bang", 30, 55, 1, "A huge blast."),
    "split": ("✨", "Splitter", 12, 22, 1, "Splits into three at the top of its arc."),
    "dirt": ("🪨", "Dirt Bomb", 18, 0, 2, "Builds a mound instead of a crater: a wall, no damage."),
}
WIND = {"off": 0, "light": 5, "wild": 10}


def ground_at(terrain, x):
    """The surface a cannon at x stands on: the highest column under its tracks."""
    c = int(x)
    return max(terrain[max(0, c - 2):min(W, c + 3)])


def make_terrain(rng, style, n):
    """A range of hills and the x of each cannon's pad (left to right)."""
    amps = {"rolling": (20, 9, 4), "mountains": (38, 15, 5), "islands": (16, 8, 3)}[style]
    base = {"rolling": 48, "mountains": 42, "islands": 46}[style]
    waves = [(a, rng.uniform(0.8, 1.6) * (k + 1) * math.pi / W * (2 + k), rng.uniform(0, 2 * math.pi))
             for k, a in enumerate(amps)]
    hs = []
    for c in range(W):
        h = base + sum(a * math.sin(f * c + ph) for a, f, ph in waves)
        if style == "mountains":  # one big ridge somewhere near the middle
            h += 45 * math.exp(-((c - W / 2 - rng.uniform(-1, 1)) / 34) ** 2)
        hs.append(h)
    margin = 22
    span = (W - 2 * margin) / max(1, n - 1) if n > 1 else 0
    xs = [margin + k * span + rng.uniform(-0.14, 0.14) * span for k in range(n)] if n > 1 else [W / 2]
    xs = [min(W - margin, max(margin, x)) for x in xs]
    if style == "mountains" and n == 2:  # two cannons each side of the ridge, not on it
        xs = [margin + rng.uniform(0, 30), W - margin - rng.uniform(0, 30)]
    if style == "islands":  # a channel of sea between each pair of neighbours
        for a, b in zip(xs, xs[1:]):
            m, half = (a + b) / 2 + rng.uniform(-6, 6), min(16.0, (b - a) / 4)
            for c in range(max(0, int(m - half)), min(W, int(m + half) + 1)):
                k = abs(c - m) / half
                hs[c] = min(hs[c], 2 + k * k * (hs[c] - 2))
    terrain = [int(round(min(H - 40, max(0, h)))) for h in hs]
    for x in xs:  # a flat pad for each cannon, safely above the sea
        c = int(x)
        top = max(WATER + 14, min(H - 50, terrain[c]))
        for k in range(max(0, c - 6), min(W, c + 7)):
            terrain[k] = top
    return terrain, xs


def fly(terrain, tanks, owner, x, y, vx, vy, ax, split=False, record=True, step0=0, at=0, by=None, shell="shell"):
    """Fly one shell; returns a list of segments {f: frames, at: first frame's index, boom: {...} | None}.
    A splitter's segment ends at the top of its arc and three more segments carry on from there.
    `tanks` is [[x, y, hp], ...]; the shooter's own cannon can't stop the shell until it has left it."""
    frames, t, step = [], 0.0, step0
    armed = owner is None
    end = None
    while t < MAX_T:
        pvy = vy
        vx += ax * DT
        vy -= G * DT
        x += vx * DT
        y += vy * DT
        t += DT
        step += 1
        if record and step % FRAME == 0:
            frames.append([round(x, 1), round(y, 1)])
        if x < 0 or x >= W:
            end = {"kind": "off", "x": x, "y": y, "hit": None}
            break
        if split and pvy > 0 >= vy:
            seg = {"f": frames, "at": at, "boom": None, "by": by, "shell": shell, "t": t}
            out = [seg]
            for dvx in (-SPLIT_SPREAD, 0.0, SPLIT_SPREAD):
                for s in fly(terrain, tanks, owner, x, y, vx + dvx, vy, ax, False, record, step,
                             at + len(frames), by, shell):
                    s["t"] = s.get("t", 0) + t
                    out.append(s)
            return out
        hit = None
        for j, (tx, ty, hp) in enumerate(tanks):
            if hp <= 0:
                continue
            d = math.hypot(x - tx, y - (ty + TANK_UP))
            if j == owner and not armed:
                if d > TANK_R + 3:
                    armed = True
                continue
            if d < TANK_R:
                hit = j
                break
        if hit is not None:
            end = {"kind": "tank", "x": x, "y": y, "hit": hit}
            break
        surface = max(terrain[int(x)], WATER)
        if y <= surface:
            end = {"kind": "water" if terrain[int(x)] < WATER else "ground", "x": x, "y": float(surface), "hit": None}
            break
    if end is None:
        end = {"kind": "lost", "x": x, "y": y, "hit": None}
    if record and (not frames or frames[-1] != [round(end["x"], 1), round(end["y"], 1)]):
        frames.append([round(end["x"], 1), round(end["y"], 1)])
    end["x"], end["y"] = round(end["x"], 1), round(end["y"], 1)
    return [{"f": frames, "at": at, "boom": end if end["kind"] not in ("off", "lost") else None, "end": end,
             "by": by, "shell": shell, "t": t, "n": step - step0}]


def launch(tank, angle, power):
    """Where the shell leaves the barrel, and its velocity: angle in degrees (0 = right, 90 = straight up)."""
    a = math.radians(angle)
    x, y = tank[0] + BARREL * math.cos(a), tank[1] + TANK_UP + BARREL * math.sin(a)
    v = VMAX * power
    return x, y, v * math.cos(a), v * math.sin(a)


def carve(terrain, x, y, r):
    """Blow a circle out of the ground; earth above the hole slumps down into it."""
    for c in range(max(0, int(x - r)), min(W, int(x + r) + 1)):
        dx = c + 0.5 - x
        if abs(dx) >= r:
            continue
        dy = math.sqrt(r * r - dx * dx)
        h = terrain[c]
        removed = max(0.0, min(h, y + dy) - max(0.0, y - dy))
        terrain[c] = max(0, int(round(h - removed)))


def mound(terrain, x, y, r):
    """Heap a circle of earth up where the dirt bomb landed."""
    for c in range(max(0, int(x - r)), min(W, int(x + r) + 1)):
        dx = c + 0.5 - x
        if abs(dx) >= r:
            continue
        top = y + math.sqrt(r * r - dx * dx) * 0.9
        terrain[c] = max(terrain[c], int(round(min(H - 12, top))))


def blast_damage(dmg, r, d):
    """Damage at distance d from a blast's centre (to a cannon's centre): full near the middle, none past r + TANK_R."""
    reach = r + TANK_R
    if d >= reach:
        return 0
    return int(round(dmg * min(1.0, 1.25 * (1 - d / reach))))


class Cannon(Game):
    id = "cannon"
    category = "action"
    howto = [
        "On your turn, aim your cannon: drag back from it like a slingshot, or use ◀ ▶ for the angle and − + for the power. Pick a shell and 🔥 Fire.",
        "The wind (top corner) changes every turn and pushes shells sideways. Your last shot's trail stays as a dashed line, to help you adjust.",
        "Blasts hurt every cannon nearby (yours too) and blow craters. A cannon whose ground is blown away drops, and a long drop hurts. Sink into the sea and you're out.",
        "Shells: 🔵 plain (endless), 💥 Big Bang (huge blast), ✨ Splitter (splits in three at the top of its arc), 🪨 Dirt Bomb (builds a wall). Big Bang and Splitter once a round, Dirt Bomb twice.",
        "Last cannon standing wins the round; most rounds wins. ⚡ All at once (an option): everyone aims in secret and the shells fly together.",
    ]
    name = "Cannon Hills"
    icon = "💥"
    blurb = "Lob shells over the hills: allow for the wind, blow craters, last cannon standing wins."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "direct": ("🎯", "Direct hit", "Land a shell right on a rival's cannon"),
              "comeback": ("🪃", "Comeback", "Win a round on under 20 ❤️")}
    settings_schema = {
        "rounds": ("Rounds", [(3, "3"), (1, "1"), (5, "5")], 3),
        "wind": ("Wind", [("light", "🍃 Light"), ("wild", "🌪️ Wild"), ("off", "Off")], "light"),
        "terrain": ("Terrain", [("rolling", "🎲 Rolling hills"), ("mountains", "⛰️ Mountains"), ("islands", "🏝️ Islands")], "rolling"),
        "volley": ("Firing", [(0, "Take turns"), (1, "⚡ All at once")], 0),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.wins = [0] * n
        self.dealt = [0] * n
        self.round_no = 0
        self.shot, self.shot_id = None, 0
        self.between = False
        style = {"rolling": "Rolling hills", "mountains": "Mountains", "islands": "Islands"}[self.s.get("terrain", "rolling")]
        rounds = self.s.get("rounds", 3)
        self.room.add_log(f"💥 Cannon Hills: {rounds} round{'s' if rounds != 1 else ''} on {style}. Last cannon standing takes each round.", "big")
        self.new_round()

    @property
    def volley(self):
        return bool(self.s.get("volley"))

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

    def alive(self):
        return [i for i in range(len(self.seats)) if self.tanks[i][2] > 0 and self.present(i)]

    def new_round(self):
        self.between = False
        self.mark_round()
        self.round_no += 1
        n = len(self.seats)
        self.terrain, xs = make_terrain(self.rng, self.s.get("terrain", "rolling"), n)
        order = list(range(n))
        self.rng.shuffle(order)
        self.tanks = [None] * n
        for slot, i in enumerate(order):
            x = xs[slot]
            self.tanks[i] = [round(x, 1), float(ground_at(self.terrain, x)), HP if self.present(i) else 0]
        self.ammo = [{k: v[4] for k, v in SHELLS.items() if v[4] is not None} for _ in range(n)]
        self.trails = [None] * n
        self.fired = [0] * n
        self.shot = None
        self.locked = {}
        self.ready_at = 0.0
        self.new_wind()
        self.room.add_log(f"🏔️ Round {self.round_no} of {self.s.get('rounds', 3)}.")
        if self.volley:
            self.open_volley(0.0)
        else:
            # who starts moves round the table each round
            self.next_turn((self.round_no - 2) % n)

    def new_wind(self):
        top = WIND.get(self.s.get("wind", "light"), 5)
        self.wind = self.rng.randint(-top, top) if top else 0

    # -- turns

    def next_turn(self, after, wait=0.0):
        n = len(self.seats)
        for k in range(1, n + 1):
            i = (after + k) % n
            if self.tanks[i][2] > 0 and self.present(i):
                self.room.begin_turn(self.seats[i])
                r = self.room
                if wait:  # nobody fires again until this shell has landed on screen
                    if self.pl(i).bot:
                        r.bot_at = max(r.bot_at, time.time() + wait + 0.6)
                    if r.deadline:
                        r.deadline += wait
                return
        self.end_round()

    def open_volley(self, wait):
        """⚡ All at once: everyone still standing aims in secret; the shells fly when all are locked in."""
        r = self.room
        r.turn = None
        self.locked = {}
        self.ready_at = time.time() + wait
        t = r.settings.get("timer")
        r.deadline = self.ready_at + t if t else None
        r.bot_at = max(r.bot_at, self.ready_at + random.uniform(0.6, 1.4))

    def waiting_on(self):
        return [i for i in self.alive() if i not in self.locked]

    # -- actions

    def act(self, p, a):
        if a.get("type") != "fire":
            raise GameError("Unknown action.")
        i = self.seat(p)
        if i is None:
            raise GameError("You're not in this game.")
        if self.between:
            raise GameError("The next round is coming up.")
        ang, pw, shell = a.get("angle"), a.get("power"), a.get("shell", "shell")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (ang, pw)):
            raise GameError("Bad shot.")
        if not 0 <= ang <= 180 or not 0 <= pw <= 1:
            raise GameError("Bad shot.")
        if shell not in SHELLS:
            raise GameError("Unknown shell.")
        if self.tanks[i][2] <= 0:
            raise GameError("Your cannon is out this round.")
        if SHELLS[shell][4] is not None and self.ammo[i].get(shell, 0) <= 0:
            raise GameError(f"No {SHELLS[shell][1]} left this round.")
        if self.volley:
            if i in self.locked:
                raise GameError("You've already locked in.")
            if time.time() < self.ready_at - 0.3:
                raise GameError("Wait for the shells to land.")
            self.locked[i] = (float(ang), float(pw), shell)
            if not self.waiting_on():
                self.volley_fire()
            return
        self.require_turn(p)
        self.fire_turn(i, float(ang), float(pw), shell)

    def fire_turn(self, i, ang, pw, shell):
        wait = self.resolve([(i, ang, pw, shell)])
        self.new_wind()
        if not self.round_over():
            self.next_turn(i, wait)

    def volley_fire(self):
        shots = [(i, *self.locked[i]) for i in sorted(self.locked)]
        wait = self.resolve(shots) if shots else 0.0
        self.locked = {}
        self.new_wind()
        if not self.round_over():
            self.open_volley(wait)

    def resolve(self, shots):
        """Fly every shot against the ground as it is now, then set off the blasts in the order they land.
        Returns how long the shot takes to play back in the browsers."""
        before = list(self.terrain)
        tanks_before = [list(t) for t in self.tanks]
        segs = []
        for i, ang, pw, shell in shots:
            if SHELLS[shell][4] is not None:
                self.ammo[i][shell] -= 1
            self.fired[i] += 1
            x, y, vx, vy = launch(self.tanks[i], ang, pw)
            path = fly(self.terrain, self.tanks, i, x, y, vx, vy, self.wind * WIND_K, split=shell == "split", by=i, shell=shell)
            segs.extend(path)
            first = path[0]["f"]
            self.trails[i] = [[round(x, 1), round(y, 1)]] + first[::2] + ([first[-1]] if first and len(first) % 2 == 0 else [])
            icon, nm = SHELLS[shell][0], SHELLS[shell][1]
            if shell != "shell":
                self.room.add_log(f"{icon} {self.name_of(i)} fires a {nm}.", "question")
            if not any(s["boom"] for s in path):
                end = path[-1].get("end") or {}
                self.room.add_log(f"💨 {self.name_of(i)}'s shell sails {'off the range' if end.get('kind') == 'off' else 'away'}.", "info")
        booms = []
        for s in sorted((s for s in segs if s["boom"]), key=lambda s: s["t"]):
            b = s["boom"]
            booms.append(self.blast(s["by"], s["shell"], b, s["at"] + len(s["f"]) - 1))
        self.shot_id += 1
        self.shot = {
            "id": self.shot_id, "by": [sh[0] for sh in shots], "wind": self.wind,
            "paths": [{"f": s["f"], "at": s["at"], "by": s["by"], "shell": s["shell"]} for s in segs],
            "booms": booms, "before": before, "tanksBefore": tanks_before, "t0": round(time.time(), 3),
        }
        last = max([s["at"] + len(s["f"]) for s in segs] + [0])
        return last / 30 + (1.0 if booms else 0.3)

    def blast(self, by, shell, b, at):
        icon, nm, r, dmg, _, _ = SHELLS[shell]
        x, y = b["x"], b["y"]
        hurt = []
        if shell == "dirt":
            mound(self.terrain, x, y, r)
        else:
            carve(self.terrain, x, y, r)
            for j, t in enumerate(self.tanks):
                if t[2] <= 0:
                    continue
                n = dmg if b["hit"] == j else blast_damage(dmg, r, math.hypot(x - t[0], y - (t[1] + TANK_UP)))
                if n <= 0:
                    continue
                n = min(n, t[2])
                t[2] -= n
                hurt.append([j, n])
                if j != by:
                    self.dealt[by] += n
            if b["hit"] is not None and b["hit"] != by and self.present(by):
                self.award(self.seats[by], "direct")
        falls = self.settle()
        names = []
        for j, n in hurt:
            names.append(f"{'themselves' if j == by else self.name_of(j)} −{n}")
        if hurt:
            self.room.add_log(f"💥 {self.name_of(by)} hits " + ", ".join(names) + ("  🎯 Direct hit!" if b["hit"] is not None and b["hit"] != by else ""), "power")
        elif shell == "dirt":
            self.room.add_log(f"🪨 {self.name_of(by)} heaps up a mound.", "info")
        elif b["kind"] == "water":
            self.room.add_log(f"🌊 {self.name_of(by)}'s shell splashes into the sea.", "info")
        else:
            self.room.add_log(f"🕳️ {self.name_of(by)} blows a crater.", "info")
        for j, n, drown in falls:
            if drown:
                self.room.add_log(f"🌊 {self.name_of(j)} slides into the sea!", "power")
            elif n:
                self.room.add_log(f"🪂 {self.name_of(j)} drops and takes {n}.", "power")
        for j, t in enumerate(self.tanks):
            if t[2] <= 0 and any(h[0] == j for h in hurt + [[f[0]] for f in falls]):
                self.room.add_log(f"💀 {self.name_of(j)}'s cannon is out!", "big")
        return {"at": at, "x": x, "y": y, "r": r, "shell": shell, "by": by, "kind": b["kind"], "hit": b["hit"],
                "dmg": hurt + [[j, n] for j, n, _ in falls if n], "terrain": list(self.terrain),
                "tanks": [list(t) for t in self.tanks]}

    def settle(self):
        """Drop cannons whose ground has gone onto the new surface (and lift any a mound has covered)."""
        falls = []
        for j, t in enumerate(self.tanks):
            if t[2] <= 0:
                continue
            g = ground_at(self.terrain, t[0])
            if g < WATER:
                t[1] = float(WATER - 3)
                falls.append((j, t[2], True))
                t[2] = 0
                continue
            drop = t[1] - g
            t[1] = float(g)
            if drop > FALL_FREE:
                n = min(t[2], FALL_MAX, int(round((drop - FALL_FREE) * FALL_K)))
                if n:
                    t[2] -= n
                    falls.append((j, n, False))
        return falls

    # -- rounds

    def round_over(self):
        alive = self.alive()
        capped = self.volley and max(self.fired) >= SHOTS_PER_ROUND or not self.volley and sum(self.fired) >= SHOTS_PER_ROUND * len(self.seats)
        if len(alive) <= 1 or capped:
            self.end_round(alive)
            return True
        return False

    def end_round(self, alive=None):
        r = self.room
        alive = self.alive() if alive is None else alive
        win = None
        if len(alive) == 1:
            win = alive[0]
        elif alive:
            top = max(self.tanks[i][2] for i in alive)
            best = [i for i in alive if self.tanks[i][2] == top]
            if len(best) == 1:
                win = best[0]
            r.add_log("⏳ Out of shells for this round: the most ❤️ takes it.", "info")
        if win is not None:
            self.wins[win] += 1
            hp = self.tanks[win][2]
            r.add_log(f"🏆 {self.name_of(win)} takes round {self.round_no} with ❤️ {hp} left.", "big")
            if hp < 20 and self.present(win):
                self.award(self.seats[win], "comeback")
        else:
            r.add_log(f"🤝 Round {self.round_no} is a draw: no cannon left standing.", "big")
        self.round_winner = win
        self.between = True
        r.turn = None
        wait = self.play_time()
        r.deadline = time.time() + wait + ROUND_PAUSE

    def play_time(self):
        if not self.shot:
            return 0.0
        last = max([p["at"] + len(p["f"]) for p in self.shot["paths"]] + [0])
        return last / 30 + 1.0

    def after_round(self):
        r = self.room
        self.between = False
        total = self.s.get("rounds", 3)
        left = total - self.round_no
        here = [i for i in range(len(self.seats)) if self.present(i)]
        ranked = sorted(here, key=lambda i: (self.wins[i], self.dealt[i]), reverse=True)
        clinched = len(ranked) > 1 and self.wins[ranked[0]] > self.wins[ranked[1]] + left
        if left <= 0 or clinched or len(here) <= 1:
            if not ranked:
                return r.finish(None, "Everyone left.")
            top = ranked[0]
            tied = [i for i in ranked if (self.wins[i], self.dealt[i]) == (self.wins[top], self.dealt[top])]
            if len(tied) > 1:
                return r.finish(None, f"🤝 A tie between {' & '.join(self.name_of(i) for i in tied)}.")
            w = self.wins[top]
            extra = "" if len(ranked) < 2 or w > self.wins[ranked[1]] else f" (most damage dealt: {self.dealt[top]})"
            return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins Cannon Hills with {w} round{'s' if w != 1 else ''}{extra}!")
        self.new_round()

    def on_timeout(self):
        r = self.room
        if self.between:
            return self.after_round()
        if self.volley:
            for i in self.waiting_on():
                r.add_log(f"⏰ {self.name_of(i)} holds fire.", "power")
            return self.volley_fire()
        i = self.seats.index(r.turn)
        r.add_log(f"⏰ {self.name_of(i)} holds fire.", "power")
        self.fired[i] += 1  # a turn used, so a table of sleepers still reaches the round's end
        self.new_wind()
        if not self.round_over():
            self.next_turn(i)

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the hills.")
        i = self.seat(p)
        if i is not None:
            self.locked.pop(i, None)
        left = r.contenders()
        if len(left) == 1 and r.phase == "playing":
            return r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if self.between:
            return
        if self.round_over():
            return
        if self.volley:
            if not self.waiting_on():
                self.volley_fire()
        elif r.turn == p.id:
            self.next_turn(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "tanks"):
            return ""
        hp = self.tanks[i][2]
        lock = " · ✅" if self.volley and i in getattr(self, "locked", {}) and not self.between else ""
        return f"{'❤️ ' + str(hp) if hp > 0 else '💀'} · 🏆{self.wins[i]}{lock}"

    def final_scores(self):
        return {pid: self.wins[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        between = self.between
        return {"cannon": {
            "seats": self.seats, "me": self.seat(p), "w": W, "h": H, "water": WATER,
            "round": self.round_no, "rounds": self.s.get("rounds", 3), "style": self.s.get("terrain", "rolling"),
            "terrain": self.terrain, "tanks": self.tanks, "ammo": self.ammo, "wind": self.wind, "windMax": WIND.get(self.s.get("wind", "light"), 5),
            "wins": self.wins, "dealt": self.dealt, "shot": self.shot, "trails": self.trails,
            "between": between, "roundWinner": getattr(self, "round_winner", None) if between else None,
            "volley": self.volley, "locked": sorted(self.locked) if self.volley else [],
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)) if self.volley else 0,
            "shells": [[k, v[0], v[1], v[4], v[5]] for k, v in SHELLS.items()],
            "standings": self.standings() if between and len(self.seats) > 1 else None,
        }}

    # -- bots: try lots of shots in the real physics (the wind is on screen for everyone), keep the best

    def plan_shot(self, i, level):
        me = self.tanks[i]
        rivals = [j for j in self.alive() if j != i]
        if not rivals:
            return 60.0, 0.5, "shell"
        rng = random
        ammo = self.ammo[i]
        ax = self.wind * WIND_K

        def aim_at(tx, ty, tries):
            right = tx >= me[0]
            best, best_d = None, float("inf")
            cands = []
            for _ in range(tries):
                a = rng.uniform(12, 84) if rng.random() < 0.7 else rng.uniform(50, 88)
                cands.append((a if right else 180 - a, rng.uniform(0.25, 1.0)))
            def score(c):
                x, y, vx, vy = launch(me, *c)
                seg = fly(self.terrain, self.tanks, i, x, y, vx, vy, ax, record=False)[-1]
                e = seg["end"]
                if e["kind"] in ("off", "lost"):
                    return 400.0
                d = math.hypot(e["x"] - tx, e["y"] - ty)
                if math.hypot(e["x"] - me[0], e["y"] - me[1]) < 30:
                    d += 120  # don't blow yourself up
                return d
            for c in cands:
                d = score(c)
                if d < best_d:
                    best, best_d = c, d
            if level == "hard" or level == "normal":  # polish the best one
                for _ in range(tries // 3):
                    c = (min(180.0, max(0.0, best[0] + rng.gauss(0, 2.5))), min(1.0, max(0.1, best[1] + rng.gauss(0, 0.04))))
                    d = score(c)
                    if d < best_d:
                        best, best_d = c, d
            return best, best_d

        tries = {"easy": 25, "normal": 60, "hard": 120}.get(level, 60)
        # a hard bot low on ❤️ walls itself off with a dirt bomb now and then
        if level == "hard" and me[2] <= 30 and ammo.get("dirt", 0) and random.random() < 0.35:
            near = min(rivals, key=lambda j: abs(self.tanks[j][0] - me[0]))
            side = 1 if self.tanks[near][0] > me[0] else -1
            wx = min(W - 2, max(1, me[0] + side * 18))
            (a, pw), d = aim_at(wx, ground_at(self.terrain, wx), tries // 2)
            if d < 12:
                return a, pw, "dirt"
        if level == "easy":
            targets = [min(rivals, key=lambda j: abs(self.tanks[j][0] - me[0]))]
        elif level == "normal":
            targets = [min(rivals, key=lambda j: (self.tanks[j][2], abs(self.tanks[j][0] - me[0])))]
        else:
            targets = rivals
        best = None
        for j in targets:
            tx, ty, thp = self.tanks[j]
            shot, d = aim_at(tx, ty + TANK_UP, tries if len(targets) == 1 else max(30, tries * 2 // len(targets)))
            value = d - (100 - thp) * 0.15  # finish off the wounded
            if best is None or value < best[0]:
                best = (value, shot, d, j)
        _, (a, pw), d, j = best
        shell = "shell"
        thp = self.tanks[j][2]
        if level == "easy":
            if random.random() < 0.2:
                shell = random.choice([k for k in ("big", "split") if ammo.get(k, 0)] or ["shell"])
        elif d < 14:
            if ammo.get("big", 0) and (thp > 35 or level == "normal"):
                shell = "big"
            elif ammo.get("split", 0) and level == "hard" and d > 6:
                shell = "split"
        noise_a, noise_p = {"easy": (4.0, 0.07), "normal": (1.4, 0.025), "hard": (0.5, 0.01)}.get(level, (1.4, 0.025))
        a = min(180.0, max(0.0, a + random.gauss(0, noise_a)))
        pw = min(1.0, max(0.05, pw * (1 + random.gauss(0, noise_p))))
        return round(a, 1), round(pw, 3), shell

    def bot_ready(self):
        if self.between:
            return False  # the pause between rounds runs on the clock
        if self.volley:
            return any(self.pl(i).bot for i in self.waiting_on())  # open_volley holds room.bot_at back until the shells land
        p = self.room.players.get(self.room.turn)
        return bool(p and p.bot)

    def bot_tick(self):
        if self.volley:
            for i in [i for i in self.waiting_on() if self.pl(i).bot]:
                self.locked[i] = self.plan_shot(i, self.pl(i).bot)
            if not self.waiting_on():
                self.volley_fire()
            return
        self.bot_turn(self.room.players[self.room.turn])

    def bot_turn(self, p):
        i = self.seat(p)
        self.fire_turn(i, *self.plan_shot(i, p.bot))
