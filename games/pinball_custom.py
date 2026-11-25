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
RADIUS = {"bump": (0.3, 1.0), "post": (0.07, 0.3), "saucer": (0.25, 0.6), "magnet": (0.6, 2.0)}
DEFAULT_RADIUS = {"bump": 0.6, "post": 0.11, "saucer": 0.3, "magnet": 1.1}
LIMITS = {"bump": 12, "sling": 6, "target": 8, "lane": 6, "post": 16, "wall": 16, "spinner": 1, "saucer": 1, "magnet": 1, "kick": 1,
          "ramp": 1, "subway": 1, "orbit": 1}
# kind -> number layout: "p" a point, "r" a radius, "s" a segment, "w" a wire path of 2-6 points, "" nothing
SHAPE = {"bump": "pr", "post": "pr", "saucer": "pr", "magnet": "pr", "lane": "p", "spinner": "p",
         "sling": "s", "target": "s", "wall": "s", "kick": "", "ramp": "s", "subway": "s", "orbit": "w"}
SEGMENTS = {"ramp": (1.5, 9.0), "subway": (0.6, 9.0)}      # long runs: the default 0.25-4.5 applies to everything else
Y_FLOOR = {"ramp": 4.8}                                     # a ramp arcs 4.8 up the table, so its ends stay below that line
PATH_POINTS = (2, 6)
MOUTH = {"orbit": 0.4, "subway": 0.3}
MAX_ITEMS = 80
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


def build(spec):
    """Return (Layout, cleaned spec) for an editor table, or raise GameError."""
    if not isinstance(spec, dict) or not isinstance(spec.get("items"), list):
        raise GameError("That isn't a table.")
    if len(spec["items"]) > MAX_ITEMS:
        raise GameError("That table has too many parts.")
    name = spec.get("name")
    name = " ".join(name.split())[:NAME_MAX] if isinstance(name, str) else ""
    counts = dict.fromkeys(LIMITS, 0)
    clean, parts, paint = [], {k: [] for k in LIMITS}, {k: [] for k in LIMITS}
    for item in spec["items"]:
        if not isinstance(item, list) or not item or item[0] not in SHAPE:
            raise GameError("The table has an unknown part.")
        kind, shape = item[0], SHAPE[item[0]]
        wide = shape == "w" and PATH_POINTS[0] * 2 <= len(item) - 2 <= PATH_POINTS[1] * 2 and len(item) % 2 == 0
        if not wide and (shape == "w" or len(item) != 2 + {"p": 2, "pr": 3, "s": 4, "": 0}[shape]) or type(item[-1]) is not str or not COLOR.match(item[-1]):
            raise GameError(f"A {kind} on the table is malformed.")
        counts[kind] += 1
        if counts[kind] > LIMITS[kind]:
            raise GameError(f"Too many of one part (a table can have {LIMITS[kind]} {kind}).")
        color = item[-1].lower()
        values = item[1:-1]
        if shape == "s":
            nums = segment(values, kind)
        elif shape == "w":
            nums = [number(v, X_MIN, X_MAX) if i % 2 == 0 else number(v, Y_MIN, Y_MAX) for i, v in enumerate(values)]
        elif shape == "":
            nums = []
        else:
            nums = [number(values[0], X_MIN, X_MAX), number(values[1], Y_MIN, Y_MAX)]
            if shape == "pr":
                nums.append(number(values[2], *RADIUS[kind]))
        clean.append([kind, *nums, color])
        parts[kind].append(tuple(nums))
        paint[kind].append(color)
    # imported late: pinball.py owns the cabinet constants and imports this module
    from . import pinball as cabinet
    walls = tuple(tuple(w) for w in parts["wall"])
    layout = Layout(
        rails=cabinet.SANDBOX_BASE + walls, flippers=cabinet.FLIPPERS, launch=cabinet.LAUNCH, gate=cabinet.GATE,
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
               "posts": paint["post"], "walls": paint["wall"], "ramp": paint["ramp"][0] if paint["ramp"] else None,
               "orbit": paint["orbit"][0] if paint["orbit"] else None, "subway": paint["subway"][0] if paint["subway"] else None, "spinner": paint["spinner"][0] if paint["spinner"] else None,
               "saucer": paint["saucer"][0] if paint["saucer"] else None, "magnet": paint["magnet"][0] if paint["magnet"] else None,
               "kick": paint["kick"][0] if paint["kick"] else None, "name": name})
    return layout, {"v": 1, "name": name, "items": clean}
