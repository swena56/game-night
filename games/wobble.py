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
SNAP = 0.1            # positions snap to this grid (#125: finer than the 0.25 it was)
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
    """The distinct turns of a shape, in eighths (45° steps; #125). Every block but the ell looks the same turned
    half way round."""
    return tuple(range(8)) if shape == "ell" else (0, 1, 2, 3)


C45 = math.sqrt(0.5)


def rects(shape, r):
    """The block's parts as rectangles around its centre, turned r // 2 quarter turns (before any 45°)."""
    out = []
    for cx, cz, w, d in SHAPES[shape]["parts"]:
        for _ in range((r // 2) % 4):
            cx, cz, w, d = -cz, cx, d, w
        out.append((cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2))
    return out


def poly(rc, x, z, r):
    """A local rectangle as a counter-clockwise polygon on the table: turned 45° more for an odd r, then moved to (x, z)."""
    x0, z0, x1, z1 = rc
    pts = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    if r % 2:
        pts = [(px * C45 - pz * C45, px * C45 + pz * C45) for px, pz in pts]
    return [(x + px, z + pz) for px, pz in pts]


def parts(shape, x, z, r):
    """The block's footprint: one convex polygon per part."""
    return [poly(rc, x, z, r) for rc in rects(shape, r)]


def area(pg):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pg, pg[1:] + pg[:1]))


def squared(pg):
    """A rectangle square to the table, corners in poly()'s order (min corner first)."""
    return (abs(pg[0][1] - pg[1][1]) < 1e-9 and abs(pg[1][0] - pg[2][0]) < 1e-9 and abs(pg[2][1] - pg[3][1]) < 1e-9
            and pg[0][0] < pg[1][0] and pg[1][1] < pg[2][1])


def inter(subj, clipper):
    """Where two convex counter-clockwise polygons overlap (Sutherland–Hodgman), or None when they only touch.
    (Quick ways out for boxes that are far apart, or both square to the table, keep the bots' search cheap.)"""
    if (max(p[0] for p in subj) <= min(p[0] for p in clipper) + EPS or max(p[0] for p in clipper) <= min(p[0] for p in subj) + EPS
            or max(p[1] for p in subj) <= min(p[1] for p in clipper) + EPS or max(p[1] for p in clipper) <= min(p[1] for p in subj) + EPS):
        return None
    if len(subj) == 4 and len(clipper) == 4 and squared(subj) and squared(clipper):
        x0, z0 = max(subj[0][0], clipper[0][0]), max(subj[0][1], clipper[0][1])
        x1, z1 = min(subj[2][0], clipper[2][0]), min(subj[2][1], clipper[2][1])
        return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)] if x1 - x0 > EPS and z1 - z0 > EPS else None
    out = list(subj)
    n = len(clipper)
    for k in range(n):
        if not out:
            return None
        (ax, az), (bx, bz) = clipper[k], clipper[(k + 1) % n]
        side = lambda p: (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax)  # noqa: E731
        inp, out = out, []
        prev = inp[-1]
        sp = side(prev)
        for cur in inp:
            sc = side(cur)
            if (sc >= -EPS) != (sp >= -EPS):
                t = sp / (sp - sc)
                out.append((prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])))
            if sc >= -EPS:
                out.append(cur)
            prev, sp = cur, sc
    return out if len(out) >= 3 and area(out) > 1e-5 else None


def as_poly(p):
    """A support patch: a polygon (or, from towers saved before 45° turns, a rectangle)."""
    if p and not isinstance(p[0], (list, tuple)):
        x0, z0, x1, z1 = p
        return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    return [tuple(q) for q in p]


def tops(b):
    """[(footprint, top y, what actually carries weight)] for a placed block."""
    sh = SHAPES[b["s"]]
    top = b["y"] + sh["h"]
    out = []
    for rc in rects(b["s"], b["r"]):
        pg = poly(rc, b["x"], b["z"], b["r"])
        if sh.get("roof"):  # only the ridge, along the long side, carries anything
            x0, z0, x1, z1 = rc
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            ridge = (x0, cz - RIDGE / 2, x1, cz + RIDGE / 2) if x1 - x0 >= z1 - z0 else (cx - RIDGE / 2, z0, cx + RIDGE / 2, z1)
            out.append((pg, top, poly(ridge, b["x"], b["z"], b["r"])))
        else:
            out.append((pg, top, pg))
    return out


PLINTH_POLY = [(-PLINTH, -PLINTH), (PLINTH, -PLINTH), (PLINTH, PLINTH), (-PLINTH, PLINTH)]


def land(tower, shape, x, z, r):
    """Where a block set here comes to rest: (y, [[supporter index or -1, patch polygon], ...]), or None when
    nothing is under it."""
    mine = parts(shape, x, z, r)
    surf = [(-1, PLINTH_POLY, 0.0, PLINTH_POLY)]
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
                        sup.append([k, [[round(v, 4) for v in q] for q in p]])
    return y, sup


def pcent(pg):
    """A polygon's area and centroid."""
    a = cx = cz = 0.0
    for (x0, z0), (x1, z1) in zip(pg, pg[1:] + pg[:1]):
        c = x0 * z1 - x1 * z0
        a += c
        cx += (x0 + x1) * c
        cz += (z0 + z1) * c
    if abs(a) < 1e-12:
        n = len(pg)
        return 0.0, sum(p[0] for p in pg) / n, sum(p[1] for p in pg) / n
    return abs(a) / 2, cx / (3 * a), cz / (3 * a)


def centroid(shape, x, z, r):
    m = cx = cz = 0.0
    for pg in parts(shape, x, z, r):
        a, px, pz = pcent(pg)
        m += a
        cx += a * px
        cz += a * pz
    h = SHAPES[shape]["h"] * (0.5 if SHAPES[shape].get("roof") else 1.0)
    return m * h, cx / m, cz / m


def nearest_in(pg, X, Z):
    """The point of polygon pg nearest (X, Z): the point itself when it's inside."""
    n = len(pg)
    if all((pg[(k + 1) % n][0] - pg[k][0]) * (Z - pg[k][1]) - (pg[(k + 1) % n][1] - pg[k][1]) * (X - pg[k][0]) >= -EPS for k in range(n)):
        return X, Z  # (patches are convex and counter-clockwise already)
    best, bp = 1e18, (X, Z)
    for (ax, az), (bx, bz) in zip(pg, pg[1:] + pg[:1]):
        ex, ez = bx - ax, bz - az
        l2 = ex * ex + ez * ez
        t = 0.0 if l2 < 1e-12 else max(0.0, min(1.0, ((X - ax) * ex + (Z - az) * ez) / l2))
        px, pz = ax + t * ex, az + t * ez
        d = (px - X) ** 2 + (pz - Z) ** 2
        if d < best:
            best, bp = d, (px, pz)
    return bp


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


def spread(sup, cents, X, Z):
    """🪵 Pull & Stack's load sharing over two or more supports in a row (a plank across planks): along the row
    the load splits between the two supports either side of it, like a lever; across the row every share keeps
    the load's offset. Returns [(weight, x, z)]."""
    n = len(cents)
    i, j = max(((i, j) for i in range(n) for j in range(i + 1, n)),
               key=lambda p: (cents[p[0]][0] - cents[p[1]][0]) ** 2 + (cents[p[0]][1] - cents[p[1]][1]) ** 2)
    (ax, az), (bx, bz) = cents[i], cents[j]
    ln = math.hypot(bx - ax, bz - az)
    if ln < EPS:
        return [(1.0 / n, *nearest_in(pg, X, Z)) for (_, pg) in sup]
    ux, uz = (bx - ax) / ln, (bz - az) / ln
    t = [(cx - ax) * ux + (cz - az) * uz for cx, cz in cents]
    tX = (X - ax) * ux + (Z - az) * uz
    px, pz = X - ax - tX * ux, Z - az - tX * uz      # the load's offset across the row
    order = sorted(range(n), key=lambda k: t[k])
    ws = [0.0] * n
    if tX <= t[order[0]]:
        ws[order[0]] = 1.0
    elif tX >= t[order[-1]]:
        ws[order[-1]] = 1.0
    else:
        for a, b in zip(order, order[1:]):
            if t[a] <= tX <= t[b]:
                f = 0.5 if t[b] - t[a] < EPS else (tX - t[a]) / (t[b] - t[a])
                ws[a], ws[b] = 1 - f, f
                break
    out = []
    for k, (_, pg) in enumerate(sup):
        if ws[k] <= 0:
            out.append((0.0, 0.0, 0.0))
            continue
        along = (tX - t[k]) if ws[k] == 1.0 else 0.0    # a lone carrier takes the load where it is along the row
        qx = ax + (t[k] + along) * ux + px
        qz = az + (t[k] + along) * uz + pz
        out.append((ws[k], *nearest_in(pg, qx, qz)))
    return out


def check(tower, gust=(0.0, 0.0), spread_rows=False):
    """The statics pass. Returns {"margin": the smallest margin of any block, "fail": None or
    {"i": index, "pivot": [[x, z], [x, z]], "dir": [x, z], "y": height, "falls": [indices that come down]},
    "carry": the weight resting on each block}. spread_rows: share loads over supports in a row with spread()
    (🪵 Pull & Stack's plank tower)."""
    n = len(tower)
    loads = [[] for _ in range(n)]
    carry = [0.0] * n     # the weight resting on each block (🪵 Pull & Stack reads how snug a block is from this)
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
        carry[i] = M - m
        patches = [(k, as_poly(p)) for k, p in b["sup"]]
        pts = [q for _, pg in patches for q in pg]
        ph = hull(pts)
        if len(ph) >= 3:
            d, edge = inside(ph, X, Z)
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
        sup = patches
        if not sup:
            continue
        cents = [pcent(pg)[1:] for _, pg in sup]
        if spread_rows and len(sup) >= 2:
            for (k, _), (w, lx, lz) in zip(sup, spread(sup, cents, X, Z)):
                if k >= 0 and w > 0:
                    loads[k].append((M * w, lx, lz))
            continue
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
        for (k, pg), w in zip(sup, ws):
            if k >= 0 and w > 0:
                loads[k].append((M * w, *nearest_in(pg, X, Z)))
    fail = None
    if fails:
        f = min(fails, key=lambda f: (f["y"], f["d"]))
        falls = {f["i"]}
        for j in range(f["i"] + 1, n):
            if any(k in falls for k, _ in tower[j]["sup"]):
                falls.add(j)
        fail = {"i": f["i"], "pivot": f["pivot"], "dir": f["dir"], "falls": sorted(falls)}
    return {"margin": 1.0 if worst == 1e9 else worst, "fail": fail, "carry": carry}


def height(tower):
    return max((b["y"] + SHAPES[b["s"]]["h"] for b in tower), default=0.0)


def a_n(name):
    return ("an " if name[0] in "aeiou" else "a ") + name


def snapped(v):
    return abs(v / SNAP - round(v / SNAP)) < 1e-6


# -- 🪵 Pull & Stack: a ready-built tower of planks, three to a layer, each layer crossed over the one below. Slide a
# block out of the tower, then set it on top. The tower stands in the same statics model; what makes it go over is
# the lean: every pull drags the tower a little (more for a block that's held tight), the lean adds up, and the
# tower is checked sheared by it. Pull a block that holds the layer above up and it goes at once.
LAYERS = 12           # the tower starts this many layers high
PLANK_H = SHAPES["plank"]["h"]
LEAN_BASE = 0.015     # σ of the lean one pull adds: LEAN_BASE + LEAN_K × grip²
LEAN_K = 0.18
LEAN_PUSH = 0.5       # the lean goes this many σ the way you pull, on average
TIGHT = 0.6           # grip from here up: a tight block (⭐ for pulling one and living)
LOOSE = 0.3           # grip under this: a loose one


def layer_rot(L):
    return 0 if L % 2 == 0 else 2


def slot_xz(L, s):
    """The centre of slot s (0, 1, 2) in layer L: even layers run along x, odd ones along z."""
    return (0.0, float(s - 1)) if L % 2 == 0 else (float(s - 1), 0.0)


def resup(tower, lean=(0.0, 0.0)):
    """The tower sorted by layer, sheared by the lean (a block at height y moves lean × y), with what each block
    rests on worked out afresh: the blocks of the layer under it, or the plinth."""
    t = sorted((dict(b) for b in tower), key=lambda b: (b["L"], b["slot"]))
    foot = []
    for b in t:
        b["y"] = round(b["L"] * PLANK_H, 4)
        b["x"] = round(b["x"] + lean[0] * b["y"], 4)
        b["z"] = round(b["z"] + lean[1] * b["y"], 4)
        foot.append(parts(b["s"], b["x"], b["z"], b["r"])[0])
    by_layer = {}
    for i, b in enumerate(t):
        by_layer.setdefault(b["L"], []).append(i)
    for i, b in enumerate(t):
        sup = []
        if b["L"] == 0:
            p = inter(foot[i], PLINTH_POLY)
            if p:
                sup.append([-1, p])
        else:
            for k in by_layer.get(b["L"] - 1, ()):
                p = inter(foot[i], foot[k])
                if p:
                    sup.append([k, p])
        b["sup"] = [[k, [[round(v, 4) for v in q] for q in p]] for k, p in sup]
    return t


def stand(tower, lean):
    """The statics pass on the tower leaning this much: check()'s result plus the sheared tower."""
    t = resup(tower, lean)
    return check(t, spread_rows=True), t


def grips(tower, lean):
    """How tightly each block is held (0 loose … 1 tight), by id: half its share of the weight its layer carries,
    half how snugly it happened to be made."""
    res, t = stand(tower, lean)
    tot = {}
    for b, c in zip(t, res["carry"]):
        tot[b["L"]] = tot.get(b["L"], 0.0) + c
    return {b["id"]: round(max(0.0, min(1.0, 0.5 * (c / tot[b["L"]] if tot[b["L"]] > EPS else 0.0) + 0.5 * b.get("snug", 0.5))), 3)
            for b, c in zip(t, res["carry"])}


def sigma(g):
    return LEAN_BASE + LEAN_K * g * g


def axis_of(b):
    return (1.0, 0.0) if b["r"] % 4 == 0 else (0.0, 1.0)


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def pullable(tower):
    """The ids you may pull: not from the top layer, nor the one under it while the top isn't finished."""
    if not tower:
        return []
    top = max(b["L"] for b in tower)
    full = sum(1 for b in tower if b["L"] == top) == 3
    lim = top if full else top - 1
    return [b["id"] for b in tower if b["L"] < lim]


def target(tower):
    """The layer a block goes on next and its open slots."""
    top = max((b["L"] for b in tower), default=-1)
    have = {b["slot"] for b in tower if b["L"] == top}
    if top < 0 or len(have) == 3:
        return top + 1, [0, 1, 2]
    return top, [s for s in range(3) if s not in have]


def pull_risk(tower, lean, bid, g):
    """What pulling block bid would do: the tower's margin straight after (m, < 0: it holds the tower up) and
    the chance it goes over pulled towards -axis and +axis ([risk-, risk+]), from the margin with the lean pushed
    2σ each way along the pull (taken as straight lines between)."""
    after = [b for b in tower if b["id"] != bid]
    b = next(b for b in tower if b["id"] == bid)
    m0 = stand(after, lean)[0]["margin"]
    if m0 < 0:
        return m0, [1.0, 1.0]
    s = sigma(g)
    ax, az = axis_of(b)
    ms = [stand(after, (lean[0] + d * 2 * s * ax, lean[1] + d * 2 * s * az))[0]["margin"] for d in (-1, 1)]
    out = []
    for side in (-1, 1):
        mu = side * LEAN_PUSH * s   # the lean the pull adds, along +axis: ~ N(mu, s)
        p = 0.0
        for d, m in zip((-1, 1), ms):
            slope = (m0 - m) / (2 * s)    # margin lost per unit of lean that way
            if slope > EPS:
                need = m0 / slope          # this much lean that way brings it over
                p += 1 - phi((need - d * mu) / s)
        out.append(round(min(1.0, p), 3))
    return m0, out


class Wobble(Game):
    id = "wobble"
    solo_bots = 2
    category = "party"
    family = None
    howto = [
        "Take turns setting a block on the tower: drag it (or nudge ◀ ▶ ▲ ▼), ⟳ turn it (in 45° steps), then 🧱 Place. It drops onto whatever is highest under it.",
        "Every block's weight, and everything resting on it, must sit over what holds it up. The 📏 wobble meter shows how close the tower is to going over.",
        "🎁 After you place, pick which of the next three blocks the next player has to set. Hand them something awkward!",
        "Topple the tower and you lose a ❤️ (the tower starts again). Hands shake more the higher it gets, and 🌬 gusts lean it every fourth turn.",
        "The last builder standing wins. ⭐ Every block that makes the tower its tallest yet earns a star (ties go to stars).",
        "🪵 Pull & Stack mode: the tower starts built, 12 layers of 3 planks. Tap a plank and drag it out (or 🪵 Pull), then tap a spot on top to set it there. Topple it and lose a ❤️.",
        "🪵 Tap a plank to feel it: 🟢 loose ones barely move the tower, 🔴 tight ones drag it and it leans more each time. Pull toward the high side to straighten it. ⭐ for every tight plank you get out.",
    ]
    name = "Wobble Tower"
    icon = "🧱"
    blurb = ("Stack odd blocks on one shaky 3D tower and gift the next player an awkward one, or 🪵 pull planks out of a "
             "built tower and set them on top. Topple it and lose a life.")
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "steady": ("🤲", "Steady hands", "Make 5 placements in a row on a tower close to tipping"),
              "sky": ("🏙️", "Skyscraper", f"Set a block whose top reaches height {int(SKY)}")}
    settings_schema = {
        "mode": ("Mode", [("build", "🧱 Build: odd blocks, gift the next one"), ("pull", "🪵 Pull & Stack: pull a plank, put it on top")], "build"),
        "lives": ("Lives", [(2, "❤️❤️ 2"), (1, "❤️ 1"), (3, "❤️❤️❤️ 3")], 2),
        "gusts": ("Gusts (Build)", [("on", "🌬 On"), ("off", "Off")], "on"),
        "blocks": ("Blocks (Build)", [("mixed", "🎲 Mixed"), ("simple", "🧊 Boxes only")], "mixed"),
    }

    # -- setup

    @property
    def pullm(self):
        return self.s.get("mode", "build") == "pull"

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
        self.ver, self.info_c = 0, None
        if self.pullm:
            self.current, self.next3, self.gust = "plank", [], None
            self.new_tower()
            self.phase = "pull"
            self.room.add_log(f"🪵 Pull & Stack: {lives} {'life' if lives == 1 else 'lives'} each. Pull a plank, set it on top, don't topple it!", "big")
        else:
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
        if self.pullm:
            return self.act_pull(p, a, t)
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
            if not isinstance(r, int) or isinstance(r, bool) or r not in range(8):
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
        if self.pullm:
            self.ready_at = 0
            if self.phase == "stack":
                r.add_log(f"⏰ {self.name_of(i)} ran out of time: the plank is set for them.", "power")
                return self.stack(i, self.plan_stack("easy"))
            r.add_log(f"⏰ {self.name_of(i)} ran out of time: a plank is pulled for them.", "power")
            return self.pull(i, *self.plan_pull("normal"))
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
            if self.pullm:
                if self.phase == "stack":
                    return self.stack(i, self.plan_stack("easy"))
                return self.pass_turn(i)
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
        if self.pullm:
            return self.view_pull(p)
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

    def spots(self, shape, tower, step, eighths=False):
        """Every spot on a grid of `step`, each turn (only quarter turns unless eighths: the 45° ones double the
        search, so only the hard bot and its finishing touch look at them)."""
        out = []
        top = height(tower)
        k = int(REACH / step)
        for r in rots(shape):
            if r % 2 and not eighths:
                continue
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
        cands, _ = self.spots(shape, self.tower, 0.5, eighths=level == "hard" and len(self.tower) < 6)
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
            for r1 in ((r0 + 1) % 8, (r0 - 1) % 8):  # the best spot turned an eighth either way
                got = land(self.tower, shape, x0, z0, r1)
                if got:
                    c = (*self.rate(self.tower, shape, x0, z0, r1, got, gust, True), x0, z0, r1)
                    if val(c) > bv:
                        pick, bv = c, val(c)
            m0, top0, x0, z0, r0 = pick
            for dx in (-0.2, 0, 0.2):
                for dz in (-0.2, 0, 0.2):
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
        if self.pullm:
            if self.phase == "stack":
                return self.stack(i, self.plan_stack(p.bot))
            return self.pull(i, *self.plan_pull(p.bot))
        if self.phase == "gift":
            return self.gift(i, self.pick_gift(i, p.bot))
        self.place(i, *self.plan(i, p.bot))

    # -- 🪵 Pull & Stack

    def new_tower(self):
        t = []
        for L in range(LAYERS):
            for sl in range(3):
                x, z = slot_xz(L, sl)
                self.bid += 1
                t.append({"id": self.bid, "s": "plank", "x": x, "z": z, "y": 0.0, "r": layer_rot(L), "o": -1, "L": L,
                          "slot": sl, "snug": round(self.rng.random(), 2)})
        self.tower = resup(t)
        self.lean = [0.0, 0.0]
        self.peak = height(self.tower)
        self.hand = None
        self.ver += 1

    def pinfo(self):
        """Per pullable block: grip, the margin straight after pulling it, and the chance it goes over pulled each
        way; per open slot on top: the margin with a plank set there. Worked out once per tower."""
        if self.info_c and self.info_c[0] == self.ver:
            return self.info_c[1]
        lean = tuple(self.lean)
        gr = grips(self.tower, lean)
        ids = set(pullable(self.tower))
        blocks = {}
        if self.phase == "pull":
            for b in self.tower:
                if b["id"] in ids:
                    m, rk = pull_risk(self.tower, lean, b["id"], gr[b["id"]])
                    blocks[b["id"]] = {"g": gr[b["id"]], "m": round(m, 3), "rk": rk}
        L, open_ = target(self.tower)
        slots = {}
        if self.phase == "stack":
            for sl in open_:
                x, z = slot_xz(L, sl)
                t2 = self.tower + [{"id": -1, "s": "plank", "x": x, "z": z, "y": 0, "r": layer_rot(L), "o": -1, "L": L, "slot": sl}]
                slots[sl] = round(stand(t2, lean)[0]["margin"], 3)
        res = {"grip": gr, "blocks": blocks, "layer": L, "open": open_, "slots": slots,
               "margin": round(stand(self.tower, lean)[0]["margin"], 3)}
        self.info_c = (self.ver, res)
        return res

    def act_pull(self, p, a, t):
        if t not in ("pull", "stack"):
            raise GameError("Unknown action.")
        self.require_turn(p)
        i = self.seat(p)
        if time.time() < self.ready_at - 0.3:
            raise GameError("Wait for the tower to settle.")
        if t == "pull":
            if self.phase != "pull":
                raise GameError("Set your plank on top first.")
            bid, side = a.get("id"), a.get("side", 1)
            if not isinstance(bid, int) or isinstance(bid, bool) or not any(b["id"] == bid for b in self.tower):
                raise GameError("Pick a plank in the tower.")
            if bid not in pullable(self.tower):
                raise GameError("Not from the top layers: pull one from lower down.")
            if side not in (1, -1) or isinstance(side, bool):
                raise GameError("Bad side.")
            return self.pull(i, bid, side)
        if self.phase != "stack":
            raise GameError("Pull a plank out first.")
        sl = a.get("slot")
        if not isinstance(sl, int) or isinstance(sl, bool) or sl not in target(self.tower)[1]:
            raise GameError("Pick an open spot on top.")
        self.stack(i, sl)

    def pull(self, i, bid, side):
        lean = tuple(self.lean)
        gr = grips(self.tower, lean)
        b = next(b for b in self.tower if b["id"] == bid)
        g = gr[bid]
        s = sigma(g)
        ax, az = axis_of(b)
        along = self.rng.gauss(side * LEAN_PUSH * s, s)
        across = self.rng.gauss(0, 0.3 * s)
        self.lean = [round(lean[0] + along * ax - across * az, 4), round(lean[1] + along * az + across * ax, 4)]
        after = [c for c in self.tower if c["id"] != bid]
        res, sheared = stand(after, tuple(self.lean))
        nm = self.name_of(i)
        feel = "a tight" if g >= TIGHT else "a loose" if g < LOOSE else "a snug"
        self.places += 1
        self.last_id += 1
        self.ver += 1
        self.last = {"id": self.last_id, "by": i, "kind": "pull", "block": b,
                     "side": side, "g": g, "margin": round(res["margin"], 3), "fall": None}
        if res["fail"]:
            return self.topple(i, res, sheared, f"pulls {feel} plank from layer {b['L'] + 1} and")
        self.tower = resup(after)
        self.hand = {"from": b["L"], "g": g}
        self.phase = "stack"
        self.room.add_log(f"🪵 {nm} slides {feel} plank out of layer {b['L'] + 1}.", "info")
        if g >= TIGHT:
            self.stars[i] += 1
            self.moment(f"💪 {nm}: a tight one, out!", "gold", "good")
        elif res["margin"] < NEAR:
            self.moment(f"😰 {nm}: by a hair!", "cool", "good")
        self.ready_at = time.time() + 0.7
        r = self.room
        if r.settings.get("timer"):
            r.deadline = time.time() + max(12, r.settings["timer"] / 2)
        p = self.pl(i)
        if p and p.bot:
            r.bot_at = time.time() + 1.0

    def stack(self, i, sl):
        L, _ = target(self.tower)
        x, z = slot_xz(L, sl)
        y = L * PLANK_H
        sig = SHAKE * y
        jx = max(-2.5 * sig, min(2.5 * sig, self.rng.gauss(0, sig))) if sig else 0.0
        jz = max(-2.5 * sig, min(2.5 * sig, self.rng.gauss(0, sig))) if sig else 0.0
        self.bid += 1
        b = {"id": self.bid, "s": "plank", "x": round(x + jx, 4), "z": round(z + jz, 4), "y": y, "r": layer_rot(L), "o": i,
             "L": L, "slot": sl, "snug": round(self.rng.random(), 2)}
        tower = self.tower + [b]
        res, sheared = stand(tower, tuple(self.lean))
        nm = self.name_of(i)
        self.places += 1
        self.last_id += 1
        self.ver += 1
        self.hand = None
        self.last = {"id": self.last_id, "by": i, "kind": "stack", "block": b, "margin": round(res["margin"], 3), "fall": None}
        if res["fail"]:
            return self.topple(i, res, sheared, "sets a plank on top and")
        self.tower = resup(tower)
        done = sum(1 for c in self.tower if c["L"] == L) == 3
        self.room.add_log(f"🪵 {nm} sets the plank on top{' and finishes layer ' + str(L + 1) if done else ''}.", "info")
        if res["margin"] < NEAR:
            self.moment(f"😰 {nm}: by a hair!", "cool", "good")
        self.ready_at = time.time() + 0.6
        if self.places >= 60 * len(self.seats):   # (a pull and a stack each count)
            return self.finish_by_score("🪵 The builders ran out of turns.")
        self.pass_turn(i)

    def topple(self, i, res, sheared, what):
        nm = self.name_of(i)
        self.lives[i] -= 1
        self.last["fall"] = {**res["fail"], "tower": sheared}
        n = len(sheared)
        self.towers += 1
        out = self.lives[i] <= 0
        self.room.add_log(f"💥 {nm} {what} brings the tower down ({n} planks)."
                          f"{' ' + nm + ' is out!' if out else f' ❤️ {self.lives[i]} left.'}", "big")
        self.moment(f"💥 {nm} {'is OUT' if out else 'topples it'}!", "bad", "boom")
        self.new_tower()
        self.phase = "pull"
        self.ready_at = time.time() + FALL_PAUSE
        if out and sum(1 for k in range(len(self.seats)) if self.alive(k)) <= 1:
            return self.finish_by_score(None)
        self.pass_turn(i)

    def pass_turn(self, i):
        self.phase = "pull"
        self.hand = None
        r = self.room
        r.turn = self.seats[i]
        r.advance()
        wait = max(0.0, self.ready_at - time.time())
        if wait:
            if r.turn and r.players[r.turn].bot:
                r.bot_at = max(r.bot_at, self.ready_at + 0.4)
            if r.deadline:
                r.deadline += wait

    def view_pull(self, p):
        inf = self.pinfo()
        return {"wobble": {
            "mode": "pull", "seats": self.seats, "me": self.seat(p), "lives": self.lives, "maxLives": self.s.get("lives", 2),
            "stars": self.stars, "tower": self.tower, "current": "plank", "next3": [], "phase": self.phase, "placer": None,
            "last": self.last, "places": self.places, "gust": None, "peak": round(self.peak, 2),
            "height": round(height(self.tower), 2), "margin": inf["margin"], "lean": self.lean, "hand": self.hand,
            "readyIn": max(0.0, round(self.ready_at - time.time(), 2)), "towers": self.towers,
            "grip": inf["grip"], "blocks": inf["blocks"], "layer": inf["layer"], "open": inf["open"], "slots": inf["slots"],
            "shapes": SHAPES, "k": {"plinth": PLINTH, "reach": REACH, "snap": SNAP, "ridge": RIDGE, "shake": SHAKE,
                                    "gustK": GUST_K, "near": NEAR, "tight": TIGHT, "loose": LOOSE, "layerH": PLANK_H},
        }}

    def plan_pull(self, level):
        """(id, side): easy goes by feel (loose-looking planks, not one that plainly holds the tower up); normal and
        hard weigh the chance it goes over, the way they'd pull it (hard also keeps tight planks for later)."""
        inf = self.pinfo()
        bl = inf["blocks"]
        ids = list(bl)
        if not ids:
            return self.tower[0]["id"], 1
        if level == "easy":
            ok = [k for k in ids if bl[k]["m"] > 0] or ids
            if random.random() < 0.6:
                pick = min(random.sample(ok, min(4, len(ok))), key=lambda k: bl[k]["g"])
            else:
                pick = random.choice(ok)
            return pick, random.choice((1, -1))
        noise = 0.05 if level == "normal" else 0.005
        wg = 0.02 if level == "normal" else 0.05
        best = min(ids, key=lambda k: min(bl[k]["rk"]) + wg * bl[k]["g"] + random.uniform(0, noise) + (5 if bl[k]["m"] < 0 else 0))
        rk = bl[best]["rk"]
        return best, (-1 if rk[0] < rk[1] else 1 if rk[1] < rk[0] else random.choice((1, -1)))

    def plan_stack(self, level):
        inf = self.pinfo()
        slots = inf["slots"] or {s: 0 for s in inf["open"]}
        if level == "easy":
            return random.choice(list(slots))
        return max(slots, key=lambda s: slots[s] + random.uniform(0, 0.02 if level == "normal" else 0.001))
