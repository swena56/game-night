"""🧱 Wobble Tower: an original block-stacking game. Players take turns setting odd-shaped blocks on one
shared tower on a 4×4 plinth, then 🎁 gift the next player their block (one of the next three). The server
decides whether the tower holds with a small statics model (no physics engine): every block's load (its own
weight plus whatever rests on it) must fall inside the outline of what it stands on. Topple the tower and you
lose a life; the last builder standing wins. Hands shake more the higher you build, and 🌬 gusts lean the
tower every fourth turn (forecast a turn ahead).

The browser runs the same few lines of statics (static/games/wobble.js) for its wobble meter, and plays a
topple back from the `fall` the server sends.
"""
import math
import random
import time

from .base import Game, GameError

PLINTH = 2.0          # the plinth: x and z from -2 to 2, top at y = 0
REACH = 3.0           # a block's centre may be set this far out
SNAP = 0.25           # positions snap to this grid
RIDGE = 0.2           # a roof only carries what rests on its ridge (this wide)
SHAKE = 0.012         # hands shake: σ of the slip = SHAKE × the landing height
GUST_EVERY = 4        # every 4th placement is a gust turn
GUST_K = 0.035        # a gust pushes each block's weight GUST_K × its height sideways
EPS = 1e-6
NEAR = 0.05           # margins under this are "by a hair"
FALL_PAUSE = 3.2      # seconds for everyone to watch a topple
SKY = 10.0            # 🏙 Skyscraper: a block whose top reaches this height

# shape -> parts (cx, cz, w, d) around the block's centre, height, roof
SHAPES = {
    "cube":   {"parts": [(0, 0, 1, 1)], "h": 1.0, "name": "Cube"},
    "plank":  {"parts": [(0, 0, 3, 1)], "h": 0.5, "name": "Plank"},
    "slab":   {"parts": [(0, 0, 2, 2)], "h": 0.4, "name": "Slab"},
    "beam":   {"parts": [(0, 0, 4, 1)], "h": 0.4, "name": "Beam"},
    "pillar": {"parts": [(0, 0, 1, 1)], "h": 2.0, "name": "Pillar"},
    "ell":    {"parts": [(0, -0.5, 2, 1), (-0.5, 0.5, 1, 1)], "h": 0.6, "name": "Ell"},
    "roof":   {"parts": [(0, 0, 2, 1)], "h": 0.7, "name": "Roof", "roof": True},
}
MIXED = ["cube", "cube", "plank", "plank", "slab", "beam", "pillar", "pillar", "ell", "ell", "roof"]
SIMPLE = ["cube", "cube", "plank", "plank", "slab", "beam", "pillar", "pillar"]


def rots(shape):
    """The distinct rotations of a shape (quarter turns)."""
    return (0, 1, 2, 3) if shape == "ell" else (0, 1)


def parts(shape, x, z, r):
    """The block's footprint rectangles [(x0, z0, x1, z1)]."""
    out = []
    for cx, cz, w, d in SHAPES[shape]["parts"]:
        for _ in range(r % 4):
            cx, cz, w, d = -cz, cx, d, w
        out.append((x + cx - w / 2, z + cz - d / 2, x + cx + w / 2, z + cz + d / 2))
    return out


def inter(a, b):
    x0, z0, x1, z1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    return (x0, z0, x1, z1) if x1 - x0 > EPS and z1 - z0 > EPS else None


def tops(b):
    """[(rect, top y, rect that actually carries weight)] for a placed block."""
    sh = SHAPES[b["s"]]
    top = b["y"] + sh["h"]
    out = []
    for rc in parts(b["s"], b["x"], b["z"], b["r"]):
        if sh.get("roof"):  # only the ridge, along the long side, carries anything
            cx, cz = (rc[0] + rc[2]) / 2, (rc[1] + rc[3]) / 2
            if rc[2] - rc[0] >= rc[3] - rc[1]:
                ridge = (rc[0], cz - RIDGE / 2, rc[2], cz + RIDGE / 2)
            else:
                ridge = (cx - RIDGE / 2, rc[1], cx + RIDGE / 2, rc[3])
            out.append((rc, top, ridge))
        else:
            out.append((rc, top, rc))
    return out


def land(tower, shape, x, z, r):
    """Where a block set here comes to rest: (y, [[supporter index or -1, patch rect], ...]), or None when
    nothing is under it."""
    mine = parts(shape, x, z, r)
    surf = [(-1, (-PLINTH, -PLINTH, PLINTH, PLINTH), 0.0, (-PLINTH, -PLINTH, PLINTH, PLINTH))]
    for k, b in enumerate(tower):
        surf += [(k, rc, top, carry) for rc, top, carry in tops(b)]
    y = None
    for _, rc, top, _ in surf:
        if any(inter(m, rc) for m in mine):
            y = top if y is None else max(y, top)
    if y is None:
        return None
    sup = []
    for k, rc, top, carry in surf:
        if abs(top - y) < EPS:
            for m in mine:
                if inter(m, rc):
                    p = inter(m, carry)
                    if p:
                        sup.append([k, [round(v, 4) for v in p]])
    return y, sup


def centroid(shape, x, z, r):
    m = cx = cz = 0.0
    for x0, z0, x1, z1 in parts(shape, x, z, r):
        a = (x1 - x0) * (z1 - z0)
        m += a
        cx += a * (x0 + x1) / 2
        cz += a * (z0 + z1) / 2
    h = SHAPES[shape]["h"] * (0.5 if SHAPES[shape].get("roof") else 1.0)
    return m * h, cx / m, cz / m


def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]   # counter-clockwise


def inside(poly, px, pz):
    """Signed distance from the point to the polygon's edge (positive inside) and the nearest edge."""
    best, edge = 1e9, None
    n = len(poly)
    for k in range(n):
        ax, az = poly[k]
        bx, bz = poly[(k + 1) % n]
        ex, ez = bx - ax, bz - az
        ln = math.hypot(ex, ez) or 1.0
        d = (-ez * (px - ax) + ex * (pz - az)) / ln
        if d < best:
            best, edge = d, (k, (ax, az), (bx, bz), (ez / ln, -ex / ln))   # outward normal
    return best, edge


def check(tower, gust=(0.0, 0.0)):
    """The statics pass. Returns {"margin": the smallest margin of any block, "fail": None or
    {"i": index, "pivot": [[x, z], [x, z]], "dir": [x, z], "y": height, "falls": [indices that come down]}}."""
    n = len(tower)
    loads = [[] for _ in range(n)]
    worst, fails = 1e9, []
    for i in range(n - 1, -1, -1):
        b = tower[i]
        m, cx, cz = centroid(b["s"], b["x"], b["z"], b["r"])
        ymid = b["y"] + SHAPES[b["s"]]["h"] / 2
        cx += gust[0] * GUST_K * ymid
        cz += gust[1] * GUST_K * ymid
        M, X, Z = m, m * cx, m * cz
        for lm, lx, lz in loads[i]:
            M += lm
            X += lm * lx
            Z += lm * lz
        X /= M
        Z /= M
        pts = []
        for _, (x0, z0, x1, z1) in b["sup"]:
            pts += [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        poly = hull(pts)
        if len(poly) >= 3:
            d, edge = inside(poly, X, Z)
        else:   # nothing carries it: it slides off a roof
            d, edge = -1.0, None
        worst = min(worst, d)
        if d < 0:
            if edge:
                _, a, bb, nrm = edge
                pivot, dr = [list(a), list(bb)], list(nrm)
            else:
                pivot, dr = [[X, Z], [X, Z]], [1.0, 0.0]
            fails.append({"i": i, "pivot": [[round(v, 3) for v in p] for p in pivot], "dir": [round(v, 3) for v in dr],
                          "y": b["y"], "d": d})
        # hand the load down to whatever carries it
        sup = b["sup"]
        if not sup:
            continue
        cents = [((r[0] + r[2]) / 2, (r[1] + r[3]) / 2) for _, r in sup]
        if len(sup) == 1:
            ws = [1.0]
        elif len(sup) == 2:
            (ax, az), (bx, bz) = cents
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez
            t = 0.5 if l2 < EPS else min(1.0, max(0.0, ((X - ax) * ex + (Z - az) * ez) / l2))
            ws = [1 - t, t]
        else:
            inv = [1 / (math.hypot(X - px, Z - pz) + 0.05) for px, pz in cents]
            s = sum(inv)
            ws = [v / s for v in inv]
        for (k, r), w in zip(sup, ws):
            if k >= 0 and w > 0:
                loads[k].append((M * w, min(r[2], max(r[0], X)), min(r[3], max(r[1], Z))))
    fail = None
    if fails:
        f = min(fails, key=lambda f: (f["y"], f["d"]))
        falls = {f["i"]}
        for j in range(f["i"] + 1, n):
            if any(k in falls for k, _ in tower[j]["sup"]):
                falls.add(j)
        fail = {"i": f["i"], "pivot": f["pivot"], "dir": f["dir"], "falls": sorted(falls)}
    return {"margin": 1.0 if worst == 1e9 else worst, "fail": fail}


def height(tower):
    return max((b["y"] + SHAPES[b["s"]]["h"] for b in tower), default=0.0)


def a_n(name):
    return ("an " if name[0] in "aeiou" else "a ") + name


def snapped(v):
    return abs(v / SNAP - round(v / SNAP)) < 1e-6


class Wobble(Game):
    id = "wobble"
    category = "party"
    family = None
    howto = [
        "Take turns setting a block on the tower: drag it (or nudge ◀ ▶ ▲ ▼), ⟳ turn it, then 🧱 Place. It drops onto whatever is highest under it.",
        "Every block's weight, and everything resting on it, must sit over what holds it up. The 📏 wobble meter shows how close the tower is to going over.",
        "🎁 After you place, pick which of the next three blocks the next player has to set. Hand them something awkward!",
        "Topple the tower and you lose a ❤️ (the tower starts again). Hands shake more the higher it gets, and 🌬 gusts lean it every fourth turn.",
        "The last builder standing wins. ⭐ Every block that makes the tower its tallest yet earns a star (ties go to stars).",
    ]
    name = "Wobble Tower"
    icon = "🧱"
    blurb = "Stack odd blocks on one shaky 3D tower, then gift the next player an awkward one. Topple it and lose a life."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "steady": ("🤲", "Steady hands", "Make 5 placements in a row on a tower close to tipping"),
              "sky": ("🏙️", "Skyscraper", f"Set a block whose top reaches height {int(SKY)}")}
    settings_schema = {
        "lives": ("Lives", [(2, "❤️❤️ 2"), (1, "❤️ 1"), (3, "❤️❤️❤️ 3")], 2),
        "gusts": ("Gusts", [("on", "🌬 On"), ("off", "Off")], "on"),
        "blocks": ("Blocks", [("mixed", "🎲 Mixed"), ("simple", "🧊 Boxes only")], "mixed"),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        lives = self.s.get("lives", 2)
        self.lives = [lives] * n
        self.stars = [0] * n
        self.steady = [0] * n
        self.tower, self.peak, self.bid = [], 0.0, 0
        self.places = 0
        self.towers = 1
        self.last, self.last_id = None, 0
        self.phase = "place"
        self.placer = None
        self.ready_at = 0.0
        self.bag = []
        self.current = self.draw()
        self.next3 = [self.draw() for _ in range(3)]
        self.gust = self.new_gust(GUST_EVERY - 1) if self.s.get("gusts", "on") == "on" else None
        self.room.add_log(f"🧱 Wobble Tower: {lives} {'life' if lives == 1 else 'lives'} each. Don't be the one who topples it!", "big")
        first = self.rng.randrange(n)
        self.room.begin_turn(self.seats[first])

    def draw(self):
        if not self.bag:
            self.bag = list(SIMPLE if self.s.get("blocks", "mixed") == "simple" else MIXED)
            self.rng.shuffle(self.bag)
        return self.bag.pop()

    def new_gust(self, at):
        d = self.rng.choice([(1, 0), (-1, 0), (0, 1), (0, -1), (0.71, 0.71), (-0.71, 0.71), (0.71, -0.71), (-0.71, -0.71)])
        return {"at": at, "dir": list(d)}

    def gust_now(self):
        g = self.gust
        return tuple(g["dir"]) if g and g["at"] == self.places else (0.0, 0.0)

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def alive(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated and self.lives[i] > 0)

    def skip_turn(self, p):
        i = self.seat(p)
        return i is None or not self.alive(i)

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if t not in ("place", "gift"):
            raise GameError("Unknown action.")
        self.require_turn(p)
        i = self.seat(p)
        if t == "place":
            if self.phase != "place":
                raise GameError("Pick a block for the next player first.")
            x, z, r = a.get("x"), a.get("z"), a.get("rot", 0)
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (x, z)):
                raise GameError("Bad spot.")
            if not isinstance(r, int) or isinstance(r, bool) or r not in range(4):
                raise GameError("Bad turn.")
            if abs(x) > REACH or abs(z) > REACH or not snapped(x) or not snapped(z):
                raise GameError("Bad spot.")
            if time.time() < self.ready_at - 0.3:
                raise GameError("Wait for the tower to settle.")
            if land(self.tower, self.current, float(x), float(z), r) is None:
                raise GameError("Set it over the plinth or the tower.")
            return self.place(i, float(x), float(z), r)
        if self.phase != "gift" or self.placer != i:
            raise GameError("It's not time to pick a block.")
        k = a.get("pick")
        if not isinstance(k, int) or isinstance(k, bool) or k not in range(len(self.next3)):
            raise GameError("Pick one of the three blocks.")
        self.gift(i, k)

    def place(self, i, x, z, r):
        shape = self.current
        y0, _ = land(self.tower, shape, x, z, r)
        sig = SHAKE * y0
        jx = max(-2.5 * sig, min(2.5 * sig, self.rng.gauss(0, sig))) if sig else 0.0
        jz = max(-2.5 * sig, min(2.5 * sig, self.rng.gauss(0, sig))) if sig else 0.0
        got = land(self.tower, shape, x + jx, z + jz, r)
        if got is None:
            jx = jz = 0.0
            got = land(self.tower, shape, x, z, r)
        y, sup = got
        self.bid += 1
        b = {"id": self.bid, "s": shape, "x": round(x + jx, 4), "z": round(z + jz, 4), "y": round(y, 4), "r": r, "o": i, "sup": sup}
        before = self.tower
        tower = before + [b]
        gust = self.gust_now()
        res = check(tower, gust)
        nm = self.name_of(i)
        sh = SHAPES[shape]["name"].lower()
        top = y + SHAPES[shape]["h"]
        self.places += 1
        self.last_id += 1
        self.last = {"id": self.last_id, "by": i, "block": b, "jit": [round(jx, 3), round(jz, 3)], "margin": round(res["margin"], 3),
                     "gust": list(gust) if gust != (0.0, 0.0) else None, "fall": None}
        if gust != (0.0, 0.0):
            self.room.add_log("🌬 A gust leans on the tower!", "power")
        if self.gust and self.gust["at"] < self.places:
            self.gust = self.new_gust(self.places + GUST_EVERY - 1)
        if res["fail"]:
            self.lives[i] -= 1
            self.steady[i] = 0
            self.last["fall"] = {**res["fail"], "tower": tower}
            self.tower, self.peak = [], 0.0
            self.towers += 1
            out = self.lives[i] <= 0
            self.room.add_log(f"💥 {nm}'s {sh} topples the tower ({len(tower)} block{'s' if len(tower) != 1 else ''}, {top:.1f} high)."
                              f"{' ' + nm + ' is out!' if out else f' ❤️ {self.lives[i]} left.'}", "big")
            self.moment(f"💥 {nm} {'is OUT' if out else 'topples it'}!", "bad", "boom")
            self.ready_at = time.time() + FALL_PAUSE
            if out:
                return self.after_out(i)
        else:
            self.tower = tower
            star = top > self.peak + EPS and top >= 2.0
            if star:
                self.stars[i] += 1
                self.peak = top
            words = f" ⭐ new height {top:.1f}" if star else ""
            self.room.add_log(f"🧱 {nm} sets {a_n(sh)}{' (hands shook)' if abs(jx) + abs(jz) > 0.08 else ''}.{words}", "info")
            if res["margin"] < NEAR:
                self.moment(f"😰 {nm}: by a hair!", "cool", "good")
            if res["margin"] < 0.15:
                self.steady[i] += 1
                if self.steady[i] == 5:
                    self.award(self.seats[i], "steady")
                    self.moment(f"🤲 {nm}: steady hands!", "gold", "good")
            else:
                self.steady[i] = 0
            if top >= SKY and not any(o["y"] + SHAPES[o["s"]]["h"] >= SKY for o in before):
                self.award(self.seats[i], "sky")
                self.moment(f"🏙️ {nm}: a skyscraper!", "gold", "fanfare")
            self.ready_at = time.time() + 0.9
        if self.places >= 25 * len(self.seats):
            return self.finish_by_score("🧱 The builders ran out of blocks.")
        self.phase, self.placer = "gift", i
        r = self.room
        if r.settings.get("timer"):
            r.deadline = time.time() + max(12, r.settings["timer"] / 2) + (FALL_PAUSE if res["fail"] else 0)
        p = self.pl(i)
        if p and p.bot:
            r.bot_at = max(time.time() + 1.0, self.ready_at - 1.5)

    def after_out(self, i):
        here = [k for k in range(len(self.seats)) if self.alive(k)]
        if len(here) <= 1:
            return self.finish_by_score(None)
        self.placer = i
        self.gift(i, self.rng.randrange(len(self.next3)), auto=True)

    def gift(self, i, k, auto=False):
        shape = self.next3.pop(k)
        self.next3.append(self.draw())
        self.current = shape
        self.phase, self.placer = "place", None
        r = self.room
        r.turn = self.seats[i]
        r.advance()
        nxt = self.seat(r.players[r.turn])
        if not auto:
            self.room.add_log(f"🎁 {self.name_of(i)} hands {self.name_of(nxt)} {a_n(SHAPES[shape]['name'].lower())}.", "info")
        else:
            self.room.add_log(f"🎁 {self.name_of(nxt)} gets {a_n(SHAPES[shape]['name'].lower())}.", "info")
        wait = max(0.0, self.ready_at - time.time())
        if wait:
            if r.players[r.turn].bot:
                r.bot_at = max(r.bot_at, self.ready_at + 0.4)
            if r.deadline:
                r.deadline += wait

    def finish_by_score(self, why):
        r = self.room
        here = [k for k in range(len(self.seats)) if self.pl(k) and not self.pl(k).eliminated]
        if not here:
            return r.finish(None, "Everyone left.")
        if why:
            r.add_log(why, "big")
        key = lambda k: (self.lives[k], self.stars[k])
        here.sort(key=key, reverse=True)
        top = here[0]
        tied = [k for k in here if key(k) == key(top)]
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie between {' & '.join(self.name_of(k) for k in tied)}.")
        st = self.stars[top]
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} is the last builder standing ({st} ⭐)!"
                        if sum(1 for k in here if self.lives[k] > 0) <= 1 else
                        f"🏆 {self.name_of(top)} wins Wobble Tower ({self.lives[top]} ❤️, {st} ⭐)!")

    def on_timeout(self):
        r = self.room
        if r.turn not in self.seats:
            return
        i = self.seats.index(r.turn)
        if self.phase == "gift":
            return self.gift(i, self.rng.randrange(len(self.next3)), auto=True)
        r.add_log(f"⏰ {self.name_of(i)} ran out of time: the block is set for them.", "power")
        self.ready_at = 0
        self.place(i, *self.plan(i, "easy"))

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the tower.")
        left = [k for k in range(len(self.seats)) if self.alive(k)]
        if r.phase != "playing":
            return
        if len(left) <= 1:
            return self.finish_by_score(None)
        if r.turn == p.id:
            i = self.seat(p)
            self.gift(i, self.rng.randrange(len(self.next3)), auto=True)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "lives"):
            return ""
        return f"{'❤️' * self.lives[i] if self.lives[i] else '💀 out'} · ⭐{self.stars[i]}"

    def final_scores(self):
        return {pid: self.stars[i] + 10 * self.lives[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        g = self.gust
        return {"wobble": {
            "seats": self.seats, "me": self.seat(p), "lives": self.lives, "maxLives": self.s.get("lives", 2),
            "stars": self.stars, "tower": self.tower, "current": self.current, "next3": self.next3,
            "phase": self.phase, "placer": self.placer, "last": self.last, "places": self.places,
            "gust": {"in": g["at"] - self.places, "dir": g["dir"]} if g else None,
            "peak": round(self.peak, 2), "height": round(height(self.tower), 2),
            "margin": round(check(self.tower)["margin"], 3) if self.tower else 1.0,
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)), "towers": self.towers,
            "shapes": SHAPES, "k": {"plinth": PLINTH, "reach": REACH, "snap": SNAP, "ridge": RIDGE, "shake": SHAKE,
                                    "gustK": GUST_K, "near": NEAR},
        }}

    # -- bots: try every snapped spot and turn, keep the steadiest (or a star when it's safe enough)

    def spots(self, shape, tower, step):
        out = []
        top = height(tower)
        k = int(REACH / step)
        for r in rots(shape):
            for ix in range(-k, k + 1):
                for iz in range(-k, k + 1):
                    x, z = ix * step, iz * step
                    got = land(tower, shape, x, z, r)
                    if got is None:
                        continue
                    out.append((x, z, r, got))
        return out, top

    def rate(self, tower, shape, x, z, r, got, gust, robust):
        y, sup = got
        b = {"id": -1, "s": shape, "x": x, "z": z, "y": y, "r": r, "o": -1, "sup": sup}
        m = check(tower + [b], gust)["margin"]
        if robust and m > 0:  # the hand slips: try the spot nudged each way
            s = SHAKE * y * 1.5
            if s > 0.02:
                for dx, dz in ((s, 0), (-s, 0), (0, s), (0, -s)):
                    g2 = land(tower, shape, x + dx, z + dz, r)
                    if g2 is None:
                        continue
                    b2 = {**b, "x": x + dx, "z": z + dz, "y": g2[0], "sup": g2[1]}
                    m = min(m, check(tower + [b2], gust)["margin"])
        return m, y + SHAPES[shape]["h"]

    def best_margin(self, tower, shape, gust, step=0.5):
        best = -9
        for x, z, r, got in self.spots(shape, tower, step)[0]:
            best = max(best, self.rate(tower, shape, x, z, r, got, gust, False)[0])
        return best

    def plan(self, i, level):
        rng = random
        shape = self.current
        gust = self.gust_now() if level != "easy" else (0.0, 0.0)
        cands, _ = self.spots(shape, self.tower, 0.5)
        robust = level == "hard"
        rated = []
        for x, z, r, got in cands:
            m, top = self.rate(self.tower, shape, x, z, r, got, gust, robust)
            rated.append((m, top, x, z, r))
        if not rated:
            return 0.0, 0.0, 0
        star_w = {"easy": 0.0, "normal": 0.06, "hard": 0.12}.get(level, 0.06)
        def val(c):
            m, top, *_ = c
            if m < 0:
                return -10 + m
            v = min(m, 0.5)
            if top > self.peak + EPS and top >= 2.0 and m > 0.12:
                v += star_w
            return v
        rated.sort(key=val, reverse=True)
        if level == "easy":
            ok = [c for c in rated if c[0] > 0.02] or rated
            pick = rng.choice(ok[:max(1, len(ok) // 2)]) if rng.random() < 0.7 else rng.choice(ok)
        elif level == "normal":
            pick = rng.choice(rated[:4])
        else:
            pick = rated[0]
            # refine on the fine grid around the best coarse spot
            m0, top0, x0, z0, r0 = pick
            bv = val(pick)
            for dx in (-0.25, 0, 0.25):
                for dz in (-0.25, 0, 0.25):
                    x, z = x0 + dx, z0 + dz
                    if (dx or dz) and abs(x) <= REACH and abs(z) <= REACH:
                        got = land(self.tower, shape, x, z, r0)
                        if got:
                            c = (*self.rate(self.tower, shape, x, z, r0, got, gust, True), x, z, r0)
                            if val(c) > bv:
                                pick, bv = c, val(c)
        _, _, x, z, r = pick
        return float(x), float(z), r

    def pick_gift(self, i, level):
        if level == "easy" or len(self.next3) < 2:
            return random.randrange(len(self.next3))
        g = self.gust
        gust = tuple(g["dir"]) if g and g["at"] == self.places else (0.0, 0.0)
        step = 1.0 if level == "normal" else 0.5
        scores = []
        seen = {}
        for k, shape in enumerate(self.next3):
            if shape not in seen:
                seen[shape] = self.best_margin(self.tower, shape, gust, step)
            scores.append(seen[shape] + random.uniform(0, 0.08 if level == "normal" else 0.01))
        return min(range(len(scores)), key=lambda k: scores[k])

    def bot_ready(self):
        p = self.room.players.get(self.room.turn)
        if not (p and p.bot) or time.time() < self.ready_at - 1.6:
            return False
        return True

    def bot_turn(self, p):
        i = self.seat(p)
        if self.phase == "gift":
            return self.gift(i, self.pick_gift(i, p.bot))
        self.place(i, *self.plan(i, p.bot))
