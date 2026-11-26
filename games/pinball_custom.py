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


def downward(x, y, speed):
    """Exit velocity for a wire or tunnel: always leaves heading down the table, toward the middle."""
    dx, dy = 5 - x, 6.0
    norm = math.hypot(dx, dy)
    return round(dx / norm * speed, 2), round(dy / norm * speed, 2)


def wires(parts):
    """Layout fields for the ramp, subway and orbit, which are placed as a start and an end (or a path of points)."""
    out = {}
    if parts["ramp"]:
        x1, y1, x2, y2 = parts["ramp"][0]
        out.update(ramp=(x1, y1), ramp_exit=(x2, y2))
    if parts["subway"]:
        x1, y1, x2, y2 = parts["subway"][0]
        out.update(subway=(x1, y1, MOUTH["subway"]), subway_exit=(x2, y2, *downward(x2, y2, 6.4)))
    if parts["orbit"]:
        flat = parts["orbit"][0]
        path = tuple((flat[i], flat[i + 1]) for i in range(0, len(flat), 2))
        out.update(orbit=(*path[0], MOUTH["orbit"]), orbit_path=path, orbit_exit=downward(*path[-1], 6.1))
    return out


PART_VALUE = {"bump": "bump", "sling": "sling", "target": "target", "lane": "lane", "mover": "mover"}      # parts that can carry their own score
POINTS = {"bumper": (100, "bump"), "sling": (50, "sling"), "target": (250, "target"), "lane": (500, "lane"), "spinner": (100, "spinner"),
          "ramp": (6000, "ramp"), "saucer": (1000, "saucer"), "portal": (250, "portal"), "mover": (300, "mover")}


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
    extra = {k: v for k, v in pts.items()}
    if "bumper" in extra:
        extra["bumper_jackpot"] = extra["bumper"] * 2
    return Rules(lock_balls=2, center_post=True, always_on=True, **extra)


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
        if not isinstance(item, list) or not item or item[0] not in SHAPE:
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
    layout = Layout(
        rails=cabinet.SANDBOX_BASE + walls, guides_from=cabinet.GUIDES_FROM, guide_run=len(cabinet.RIGHT_GUIDE),
        part_pts=part_pts, flaps=tuple(parts["flap"]), portals=portals, rubbers=tuple(parts["rubber"]), holes=holes,
        movers=tuple((*m, 1.0) for m in parts["mover"]), flippers=flippers, launch=cabinet.LAUNCH, gate=cabinet.GATE,
        bumps=tuple(parts["bump"]), slings=tuple(parts["sling"]), targets=tuple(parts["target"]),
        lanes=tuple(parts["lane"]), posts=tuple(parts["post"]),
        spinner=parts["spinner"][0] if parts["spinner"] else None,
        saucer=parts["saucer"][0] if parts["saucer"] else None,
        magnet=parts["magnet"][0] if parts["magnet"] else None,
        outlane=cabinet.OUTLANE if parts["kick"] else None, special=cabinet.SPECIAL if parts["kick"] else None,
        **wires(parts),
        width=cabinet.WIDTH, height=cabinet.HEIGHT, ball=cabinet.BALL, flipper_length=cabinet.LENGTH,
        flipper_radius=cabinet.FLIP_RADIUS, skill_charge=cabinet.SKILL_CHARGE, theme="custom",
        paint={"bumps": paint["bump"], "slings": paint["sling"], "targets": paint["target"], "lanes": paint["lane"],
               "posts": paint["post"], "walls": wall_paint, "base": len(cabinet.SANDBOX_BASE), "decals": decals,
               "flaps": paint["flap"], "rubbers": paint["rubber"], "movers": paint["mover"], "holes": paint["hole"], "flips": paint["flip"], "portal": paint["portal"][0] if paint["portal"] else None, "ramp": paint["ramp"][0] if paint["ramp"] else None,
               "orbit": paint["orbit"][0] if paint["orbit"] else None, "subway": paint["subway"][0] if paint["subway"] else None, "spinner": paint["spinner"][0] if paint["spinner"] else None,
               "saucer": paint["saucer"][0] if paint["saucer"] else None, "magnet": paint["magnet"][0] if paint["magnet"] else None,
               "kick": paint["kick"][0] if paint["kick"] else None, "name": name})
    clean_spec = {"v": 1, "name": name, "items": clean}
    if modes:
        clean_spec["modes"] = [[i, m] for i, m in sorted(modes.items()) if i < len(clean)]
    if clean_pv:
        clean_spec["pv"] = clean_pv
    if points(spec):
        clean_spec["pts"] = points(spec)
    return layout, clean_spec
