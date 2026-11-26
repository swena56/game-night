"""Can everything on a table be hit? Shots from the start, middle and end of each main flipper, with the ball resting on the bat or
dropping onto it. Each shot is followed for a few seconds, so rebounds count. Half the shots start with every target already down,
which opens the ramp. Everything is seeded: the same table always gives the same answer."""
import math
import random

from ..pinball import CustomTable
from ..pinball_custom import build, build_rules

SPOTS = (("start", 0.2), ("middle", 0.55), ("end", 0.9))
SHOTS = 20                    # per flipper, spot and way of arriving
SECONDS = 6
WEAK_UP = 40                  # a spot that gets fewer shots than this (percent) up the table is worth a look
RARE = 3                      # a part hit by this many shots or fewer is hard to reach


def parts_of(layout):
    """{key: label} for every part a ball can hit or enter. The key matches the game's event for that part."""
    def where(x, y):
        across = "left" if x < 3.2 else "right" if x > 5.6 else "centre"
        down = "top" if y < 5 else "middle" if y < 10 else "bottom"
        return f"{down} {across}"

    out = {}
    for kind, label, items in (("bumper", "Bumper", layout.bumps), ("sling", "Slingshot", layout.slings), ("target", "Target", layout.targets),
                               ("lane", "Rollover", layout.lanes), ("mover", "Moving target", layout.movers), ("hole", "Kicker hole", layout.holes)):
        for i, p in enumerate(items):
            segment = kind in ("sling", "target", "mover")
            x, y = ((p[0] + p[2]) / 2, (p[1] + p[3]) / 2) if segment else p[:2]
            out[f"{kind}{i}"] = f"{label} ({where(x, y)})"
    for kind, label, spot in (("spinner", "Spinner", layout.spinner), ("ramp", "Ramp", layout.ramp), ("orbit", "Wire lane", layout.orbit),
                              ("saucer", "Saucer", layout.saucer), ("subway", "Subway", layout.subway), ("magnet", "Magnet", layout.magnet),
                              ("portal", "Portal", layout.portals)):
        if spot:
            out[kind] = f"{label} ({where(*spot[:2])})"
    return out


def _shot(layout, rules, parts, side, fraction, dropping, lit, seed):
    rng = random.Random(seed)
    table = CustomTable(layout_override=layout, rules_override=rules, balls=3)
    table.rng = random.Random(seed)
    table.staged = False
    table.bank = (1 << len(layout.targets)) - 1 if lit else 0
    px, py, rest, _ = layout.flippers[side]
    ux, uy = math.cos(rest), math.sin(rest)
    nx, ny = (-uy, ux) if ux < 0 else (uy, -ux)              # the bat's upper face
    along = layout.flipper_length * (fraction + rng.uniform(-0.04, 0.04))
    gap = layout.ball + layout.flipper_radius + 0.01
    bx, by = px + ux * along + nx * gap, py + uy * along + ny * gap
    table.x, table.y, table.vx, table.vy = (bx, by - 0.8, 0, 1.0) if dropping else (bx, by, 0, 0)
    start = None if dropping else rng.randint(0, 2)
    hit, top, drained, event_id = set(), layout.height, False, table.event_id
    for tick in range(240 * SECONDS):
        if start is None and by - table.y < rng.uniform(0.05, 0.2):
            start = tick
        held = 1 << side if start is not None and start <= tick < start + 72 else 0
        table.input(held, 0, tick / 240)
        table.step()
        if table.event_id != event_id:
            event_id = table.event_id
            event = {"hurry": "spinner", "jackpot": "ramp", "super": "ramp"}.get(table.event, table.event)
            hit.add(event)
        if table.ramp_ticks:
            hit.add("ramp")
        if table.orbit_ticks:
            hit.add("orbit")
        if table.hole_ticks:
            hit.add(f"hole{table.hole_at}")
        if layout.magnet and not table.height and math.hypot(table.x - layout.magnet[0], table.y - layout.magnet[1]) < layout.magnet[2]:
            hit.add("magnet")                               # passing through its field: the magnet only grabs while it is lit
        top = min(top, table.y)
        if table.balls < 3 or table.staged:
            drained = table.balls < 3
            break
    return hit & parts.keys(), top < layout.height / 2, drained


def reach(spec, shots=SHOTS):
    """{"shots": n, "parts": [{"key", "label", "hits"}] (least hit first), "spots": [{"flipper", "spot", "ball", "up", "drains"}]}."""
    layout, _ = build(spec)
    rules = build_rules(spec)
    parts = parts_of(layout)
    counts = dict.fromkeys(parts, 0)
    spots, total = [], 0
    for side, flipper in enumerate(("Left", "Right")):
        for name, fraction in SPOTS:
            for dropping in (False, True):
                up = drains = 0
                for n in range(shots):
                    hit, went_up, drained = _shot(layout, rules, parts, side, fraction, dropping, n % 2 == 1, n)
                    for key in hit:
                        counts[key] += 1
                    up += went_up
                    drains += drained
                    total += 1
                spots.append({"flipper": flipper, "spot": name, "ball": "dropping" if dropping else "resting",
                              "up": round(100 * up / shots), "drains": drains})
    return {"shots": total, "spots": spots,
            "parts": sorted(({"key": k, "label": parts[k], "hits": counts[k]} for k in parts), key=lambda p: p["hits"])}
