"""Custom pinball tables from the table editor.

A table is a short list of placed parts, each ``[kind, numbers..., colour]``. ``build`` checks every number and
colour (the browser is not trusted), clamps parts inside the playfield and returns a Layout plus the cleaned spec.
The cabinet itself (outer walls, shooter lane, flippers, drain) is fixed; only the parts inside it are yours.
"""
import math
import re

from .base import GameError
from .pinball_engine import Layout

COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
X_MIN, X_MAX = 0.45, 8.35        # the shooter lane wall is at x = 8.8
Y_MIN, Y_MAX = 0.45, 14.2        # flippers start near y = 14.95
SEGMENT = (0.25, 4.5)
GLYPHS = ("star", "heart", "bolt", "diamond", "moon", "ring")      # painted under the glass: no collision, no score
RADIUS = {"bump": (0.3, 1.0), "post": (0.07, 0.3), "saucer": (0.25, 0.6), "hole": (0.25, 0.6), "magnet": (0.6, 2.0), **{g: (0.25, 1.6) for g in GLYPHS}}
DEFAULT_RADIUS = {"bump": 0.6, "post": 0.11, "saucer": 0.3, "magnet": 1.1}
LIMITS = {"bump": 12, "sling": 6, "target": 8, "lane": 6, "post": 16, "wall": 16, "spinner": 1, "saucer": 1, "magnet": 1, "kick": 1,
          "ramp": 1, "subway": 1, "orbit": 1, "arc": 6, "flap": 4, "portal": 1, "rubber": 6, "mover": 3, "hole": 3, "flip": 4, **dict.fromkeys(GLYPHS, 4)}
# kind -> number layout: "p" a point, "r" a radius, "s" a segment, "w" a wire path of 2-6 points, "" nothing
SHAPE = {"bump": "pr", "post": "pr", "saucer": "pr", "magnet": "pr", "lane": "p", "spinner": "p",
         "sling": "s", "target": "s", "wall": "s", "kick": "", "ramp": "s", "subway": "s", "orbit": "w",
         "flap": "s", "portal": "s", "arc": "a", "rubber": "s", "mover": "s", "hole": "pr", "flip": "p", **dict.fromkeys(GLYPHS, "pr")}
SEGMENTS = {"ramp": (1.5, 9.0), "subway": (0.6, 9.0), "portal": (0.8, 9.0), "arc": (0.8, 6.0), "flap": (0.4, 2.5), "rubber": (0.3, 4.5), "mover": (0.8, 4.5)}      # long runs: the default 0.25-4.5 applies to everything else
Y_RANGE = {"flip": (5.0, 12.2)}                              # an extra flipper lives mid-table, clear of the lower pair
Y_FLOOR = {"ramp": 4.8}                                     # a ramp arcs 4.8 up the table, so its ends stay below that line
PATH_POINTS = (2, 6)
MOUTH = {"orbit": 0.4, "subway": 0.3}
MAX_ITEMS = 120
MODE_BIT = {"classic": 1, "zen": 2, "practice": 4, "timeattack": 8}      # a part can be limited to some play modes
TABLE_JSON_MAX = 80_000                                              # decompressed size of a table sent as a share code
ARC_STEPS = 10
NAME_MAX = 40


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise GameError("The table has an invalid number.")
    return round(min(high, max(low, float(value))), 2)


def segment(values, kind="wall"):
    y_min = Y_FLOOR.get(kind, Y_MIN)
    x1, y1, x2, y2 = (number(values[0], X_MIN, X_MAX), number(values[1], y_min, Y_MAX),
                      number(values[2], X_MIN, X_MAX), number(values[3], y_min, Y_MAX))
    length = math.hypot(x2 - x1, y2 - y1)
    low, high = SEGMENTS.get(kind, SEGMENT)
    if length < low:                     # too short to be a part: stretch it to the minimum, keeping its direction
        angle = math.atan2(y2 - y1, x2 - x1) if length else 0.0
        x2, y2 = x1 + low * math.cos(angle), y1 + low * math.sin(angle)
    elif length > high:
        x2, y2 = x1 + (x2 - x1) * high / length, y1 + (y2 - y1) * high / length
    return [x1, y1, round(min(X_MAX, max(X_MIN, x2)), 2), round(min(Y_MAX, max(y_min, y2)), 2)]


def smooth_path(points, step=0.3):
    """A wire's waypoints as a smooth curve of evenly spaced points (a Catmull-Rom spline through the dots you placed), so the ball
    rides at an even pace around the bends and the wire has no corners."""
    pts = [tuple(p) for p in points]
    if len(pts) < 3:
        return pts
    ext = [pts[0], *pts, pts[-1]]
    dense = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(16):
            t = k / 16
            dense.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                        + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    dense.append(pts[-1])
    out, carried = [dense[0]], 0.0
    for a, b in zip(dense, dense[1:]):                      # resample at a fixed spacing along the curve
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        while seg and carried + seg >= step:
            f = (step - carried) / seg
            a = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
            out.append(a)
            seg = math.hypot(b[0] - a[0], b[1] - a[1])
            carried = 0.0
        carried += seg
    if math.hypot(out[-1][0] - dense[-1][0], out[-1][1] - dense[-1][1]) > 0.05:
        out.append(dense[-1])
    else:
        out[-1] = dense[-1]
    return [(round(x, 3), round(y, 3)) for x, y in out]


def exit_velocity(path, speed):
    """Leave the wire the way it points, bent toward the table's middle so the ball always heads down-table."""
    (ax, ay), (bx, by) = path[-2], path[-1]
    tx, ty = bx - ax, by - ay
    tn = math.hypot(tx, ty) or 1
    dx, dy = downward(bx, by, 1)
    vx, vy = 0.5 * tx / tn + 0.5 * dx, 0.5 * ty / tn + 0.5 * dy
    vy = max(vy, 0.45)
    n = math.hypot(vx, vy)
    return round(vx / n * speed, 2), round(vy / n * speed, 2)


def downward(x, y, speed):
    """Exit velocity for a wire or tunnel: always leaves heading down the table, toward the middle."""
    dx, dy = 5 - x, 6.0
    norm = math.hypot(dx, dy)
    return round(dx / norm * speed, 2), round(dy / norm * speed, 2)


def wires(parts, classic=False):
    """Layout fields for the ramp, subway and orbit, which are placed as a start and an end (or a path of points).
    On the classic cabinet a wire that is still exactly where the production table has it keeps the production table's hand-tuned
    ride (the raw five-point orbit and its exit, the subway's exit speed), so a clone plays identically until you move that wire."""
    from . import pinball as cabinet
    out = {}
    if parts["ramp"]:
        x1, y1, x2, y2 = parts["ramp"][0]
        out.update(ramp=(x1, y1), ramp_exit=(x2, y2))
    if parts["subway"]:
        x1, y1, x2, y2 = parts["subway"][0]
        out.update(subway=(x1, y1, MOUTH["subway"]), subway_exit=(x2, y2, *downward(x2, y2, 6.4)))
        if classic and (x1, y1, x2, y2) == (cabinet.SUBWAY[0], cabinet.SUBWAY[1], *cabinet.SUBWAY_EXIT[:2]):
            out["subway_exit"] = cabinet.SUBWAY_EXIT
    if parts["orbit"]:
        flat = parts["orbit"][0]
        path = tuple(smooth_path([(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]))
        out.update(orbit=(*path[0], MOUTH["orbit"]), orbit_path=path, orbit_exit=exit_velocity(path, 6.1))
        if classic and tuple(flat) == tuple(v for pt in cabinet.ORBIT_PATH for v in pt):
            out.update(orbit_path=tuple(cabinet.ORBIT_PATH), orbit_exit=cabinet.ORBIT_EXIT)
    return out


PART_VALUE = {"bump": "bump", "sling": "sling", "target": "target", "lane": "lane", "mover": "mover"}      # parts that can carry their own score
POINTS = {"bumper": (100, "bump"), "sling": (50, "sling"), "target": (250, "target"), "lane": (500, "lane"), "spinner": (100, "spinner"),
          "ramp": (6000, "ramp"), "saucer": (1000, "saucer"), "portal": (250, "portal"), "mover": (300, "mover"),
          "jackpot": (12000, ""), "hurry": (15000, "")}
CABINETS = ("smooth", "classic")           # classic = the original sharp-cornered cabinet of Golden Hour and Neon Arcade
LOOKS = {"custom": "custom", "golden": "", "neon": "neon"}      # which printed art the playfield wears
FEEL_RANGES = {"gravity": (8.0, 16.0), "hurry_seconds": (0, 20), "super_every": (1, 10)}


def setup(spec):
    """The table-wide choices: cabinet shape, art and feel (gravity, flipper pitch, lamp rules, jackpot timing). Defaults are dropped."""
    out = {}
    if not isinstance(spec, dict):
        return out
    if spec.get("cabinet") in CABINETS and spec["cabinet"] != "smooth":
        out["cabinet"] = spec["cabinet"]
    if spec.get("look") in LOOKS and spec["look"] != "custom":
        out["look"] = spec["look"]
    raw, feel = spec.get("feel"), {}
    if isinstance(raw, dict):
        for key, (low, high) in FEEL_RANGES.items():
            v = raw.get(key)
            if type(v) in (int, float) and math.isfinite(v):
                feel[key] = round(min(high, max(low, v)), 2) if key == "gravity" else int(round(min(high, max(low, v))))
        for key in ("classic_lamps", "steep_flippers"):
            if raw.get(key) is True:
                feel[key] = True
        eb = raw.get("extra_balls")
        if isinstance(eb, list) and len(eb) == 2 and all(type(v) in (int, float) and math.isfinite(v) for v in eb):
            feel["extra_balls"] = sorted(int(round(min(1_000_000, max(1000, v)))) for v in eb)
    if feel:
        out["feel"] = feel
    return out


def points(spec):
    """The table's own point values: only known keys, whole numbers 0-20,000, anything at its default is dropped."""
    raw = spec.get("pts") if isinstance(spec, dict) else None
    out = {}
    if isinstance(raw, dict):
        for key, (default, _) in POINTS.items():
            v = raw.get(key)
            if type(v) in (int, float) and math.isfinite(v) and round(min(20000, max(0, v))) != default:
                out[key] = int(round(min(20000, max(0, v))))
    return out


def build_rules(spec):
    from .pinball_engine import Rules
    pts = points(spec)
    extra = {k: v for k, v in pts.items() if k not in ("hurry",)}
    if "bumper" in extra:
        extra["bumper_jackpot"] = extra["bumper"] * 2
    if "hurry" in pts:
        extra["hurry_max"] = pts["hurry"]
    feel = setup(spec).get("feel", {})
    if "gravity" in feel:
        extra["gravity"] = feel["gravity"]
    if "hurry_seconds" in feel:
        extra["hurry_ticks"] = feel["hurry_seconds"] * 240
    if "super_every" in feel:
        extra["super_every"] = feel["super_every"]
    if "extra_balls" in feel:
        extra["extra_ball_scores"] = tuple(feel["extra_balls"])
    # a ramp shot normally locks the ball and serves a fresh one (multiball after two locks): confusing on a table you built,
    # so it is off unless the table asks for it
    return Rules(lock_balls=2 if isinstance(spec, dict) and spec.get("lock") is True else 0, center_post=True, always_on=not feel.get("classic_lamps"), **extra)


def decode_table(table):
    """A table arrives either as a dict or as a share code (PT0. = base64 JSON, PT1. = deflated); big tables use the code
    because requests are capped at 10,000 bytes. Decompression is size-capped."""
    if not isinstance(table, str):
        return table
    import base64, binascii, json, zlib
    if len(table) > 12_000 or table[:4] not in ("PT0.", "PT1."):
        raise GameError("That isn't a table code.")
    try:
        raw = base64.urlsafe_b64decode(table[4:] + "=" * (-len(table[4:]) % 4))
        if table[:4] == "PT1.":
            inflater = zlib.decompressobj(-15)
            raw = inflater.decompress(raw, TABLE_JSON_MAX)
            if inflater.unconsumed_tail:
                raise GameError("That table is too big.")
        return json.loads(raw.decode("utf-8"))
    except (binascii.Error, zlib.error, ValueError, UnicodeDecodeError):
        raise GameError("That isn't a table code.")


def build(spec, mode="classic"):
    """Return (Layout, cleaned spec) for an editor table, or raise GameError. Parts limited to other play modes are left out of the Layout."""
    if not isinstance(spec, dict) or not isinstance(spec.get("items"), list):
        raise GameError("That isn't a table.")
    if len(spec["items"]) > MAX_ITEMS:
        raise GameError("That table has too many parts.")
    name = spec.get("name")
    name = " ".join(name.split())[:NAME_MAX] if isinstance(name, str) else ""
    counts = dict.fromkeys(LIMITS, 0)
    raw_pv = spec.get("pv") if isinstance(spec.get("pv"), list) else []
    own = {}
    for pair in raw_pv:
        if isinstance(pair, list) and len(pair) == 2 and type(pair[0]) is int and type(pair[1]) in (int, float) and math.isfinite(pair[1]):
            own[pair[0]] = int(round(min(20000, max(0, pair[1]))))
    modes = {}
    for pair in spec.get("modes") if isinstance(spec.get("modes"), list) else []:
        if isinstance(pair, list) and len(pair) == 2 and type(pair[0]) is int and type(pair[1]) is int and 1 <= pair[1] <= 14:
            modes[pair[0]] = pair[1]
    bit = MODE_BIT.get(mode, 1)
    part_pts, clean_pv = {}, []
    clean, parts, paint = [], {k: [] for k in LIMITS}, {k: [] for k in LIMITS}
    for index, item in enumerate(spec["items"]):
        if not isinstance(item, list) or not item or not isinstance(item[0], str) or item[0] not in SHAPE:
            raise GameError("The table has an unknown part.")
        kind, shape = item[0], SHAPE[item[0]]
        wide = shape == "w" and PATH_POINTS[0] * 2 <= len(item) - 2 <= PATH_POINTS[1] * 2 and len(item) % 2 == 0
        if not wide and (shape == "w" or len(item) != 2 + {"p": 2, "pr": 3, "s": 4, "a": 6, "": 0}[shape]) or type(item[-1]) is not str or not COLOR.match(item[-1]):
            raise GameError(f"A {kind} on the table is malformed.")
        counts[kind] += 1
        if kind in PART_VALUE and index in own:
            clean_pv.append([index, own[index]])
        if counts[kind] > LIMITS[kind]:
            raise GameError(f"Too many of one part (a table can have {LIMITS[kind]} {kind}).")
        color = item[-1].lower()
        values = item[1:-1]
        if shape == "s":
            nums = segment(values, kind)
        elif shape == "a":                # a curved wall: two ends and the point the curve bends toward
            nums = segment(values[:4], kind) + [number(values[4], X_MIN, X_MAX), number(values[5], Y_MIN, Y_MAX)]
        elif shape == "w":
            nums = [number(v, X_MIN, X_MAX) if i % 2 == 0 else number(v, Y_MIN, Y_MAX) for i, v in enumerate(values)]
        elif shape == "":
            nums = []
        else:
            nums = [number(values[0], X_MIN, X_MAX), number(values[1], *Y_RANGE.get(kind, (Y_MIN, Y_MAX)))]
            if shape == "pr":
                nums.append(number(values[2], *RADIUS[kind]))
        clean.append([kind, *nums, color])
        if not modes.get(index, 15) & bit:
            continue                       # kept in the saved table, absent in this mode
        if kind in PART_VALUE and index in own:
            part_pts.setdefault(PART_VALUE[kind], {})[len(parts[kind])] = own[index]
        parts[kind].append(tuple(nums))
        paint[kind].append(color)
    # imported late: pinball.py owns the cabinet constants and imports this module
    from . import pinball as cabinet
    walls = [tuple(w) for w in parts["wall"]]
    wall_paint = list(paint["wall"])
    for (x1, y1, x2, y2, cx, cy), color in zip(parts["arc"], paint["arc"]):      # a quadratic curve, cut into short rails
        pts = [((1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2)
               for t in (i / ARC_STEPS for i in range(ARC_STEPS + 1))]
        for a, b in zip(pts, pts[1:]):
            if math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01:
                walls.append((round(a[0], 3), round(a[1], 3), round(b[0], 3), round(b[1], 3)))
                wall_paint.append(color)
    walls = tuple(walls)
    portals = (*parts["portal"][0], 0.32) if parts["portal"] else None
    holes = tuple((x, y, r, round(math.degrees(math.atan2(6.0, 5 - x)), 1)) for x, y, r in parts["hole"])    # fired down toward the middle
    middle = cabinet.WIDTH * 0.44
    flippers = cabinet.FLIPPERS + tuple((x, y, 0.3, -0.75) if x < middle else (x, y, math.pi - 0.3, math.pi + 0.75) for x, y in parts["flip"])
    decals = [[g, *p, c] for g in GLYPHS for p, c in zip(parts[g], paint[g])]
    choice = setup(spec)
    classic = choice.get("cabinet") == "classic"
    base = cabinet.RAILS[:11] if classic else cabinet.BASE_RAILS
    if choice.get("feel", {}).get("steep_flippers"):
        flippers = cabinet.NEON_FLIPPERS + flippers[2:]
    layout = Layout(
        rails=base + walls, guides_from=9 if classic else cabinet.GUIDES_FROM, guide_run=2 if classic else len(cabinet.RIGHT_GUIDE),
        part_pts=part_pts, flaps=tuple(parts["flap"]), portals=portals, rubbers=tuple(parts["rubber"]), holes=holes,
        movers=tuple((*m, 1.0) for m in parts["mover"]), flippers=flippers, launch=cabinet.LAUNCH, gate=cabinet.GATE,
        bumps=tuple(parts["bump"]), slings=tuple(parts["sling"]), targets=tuple(parts["target"]),
        lanes=tuple(parts["lane"]), posts=tuple(parts["post"]),
        spinner=parts["spinner"][0] if parts["spinner"] else None,
        saucer=parts["saucer"][0] if parts["saucer"] else None,
        magnet=parts["magnet"][0] if parts["magnet"] else None,
        outlane=cabinet.OUTLANE if parts["kick"] else None, special=cabinet.SPECIAL if parts["kick"] else None,
        **wires(parts, classic),
        width=cabinet.WIDTH, height=cabinet.HEIGHT, ball=cabinet.BALL, flipper_length=cabinet.LENGTH,
        flipper_radius=cabinet.FLIP_RADIUS, skill_charge=cabinet.SKILL_CHARGE, theme=LOOKS[choice.get("look", "custom")],
        paint={"bumps": paint["bump"], "slings": paint["sling"], "targets": paint["target"], "lanes": paint["lane"],
               "posts": paint["post"], "walls": wall_paint, "base": len(base), "decals": decals,
               "flaps": paint["flap"], "rubbers": paint["rubber"], "movers": paint["mover"], "holes": paint["hole"], "flips": paint["flip"], "portal": paint["portal"][0] if paint["portal"] else None, "ramp": paint["ramp"][0] if paint["ramp"] else None,
               "orbit": paint["orbit"][0] if paint["orbit"] else None, "subway": paint["subway"][0] if paint["subway"] else None, "spinner": paint["spinner"][0] if paint["spinner"] else None,
               "saucer": paint["saucer"][0] if paint["saucer"] else None, "magnet": paint["magnet"][0] if paint["magnet"] else None,
               "kick": paint["kick"][0] if paint["kick"] else None, "name": name})
    clean_spec = {"v": 1, "name": name, "items": clean}
    if spec.get("lock") is True:
        clean_spec["lock"] = True
    clean_spec.update(choice)
    if modes:
        clean_spec["modes"] = [[i, m] for i, m in sorted(modes.items()) if i < len(clean)]
    if clean_pv:
        clean_spec["pv"] = clean_pv
    if points(spec):
        clean_spec["pts"] = points(spec)
    return layout, clean_spec
