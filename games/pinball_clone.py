"""Editor copies of the production tables.

``clone_specs()`` reads the real Golden Hour and Neon Arcade constants in games/pinball.py and returns each as an editor table, so the
copy you load in the editor is the board that is in the game today and can never drift from it. Every part of a production table can be
placed in the editor, and the table-wide choices that make them what they are (the original cabinet, the printed art, the gravity,
flipper pitch, scoring and jackpot timing) are part of the table format too. tests/pinball_rules.py compares each copy with the real layout.
"""
from . import pinball as p

RED, TEAL, STEEL, GOLD, IVORY, DARK = "#ff6854", "#59edd2", "#c1d2e5", "#ffd383", "#f2ecdd", "#252049"
BUMPER_COLOURS = ("#ff9b59", "#c699ff", "#58e5d5", "#ff78bc")           # the colours the game paints production bumpers in
GUIDE_GOLD = "#ffcf76"


def _items(bumps, walls):
    items = []
    for i, (x, y, r) in enumerate(bumps):
        items.append(["bump", x, y, r, BUMPER_COLOURS[i % 4]])
    items += [["sling", *s, RED] for s in p.SLINGS]
    items += [["target", *t, RED] for t in p.TARGETS]
    items += [["lane", *l, TEAL] for l in p.ROLLOVERS]
    items += [["wall", *w, GUIDE_GOLD] for w in walls]
    items += [["post", *q, IVORY] for q in p.POSTS]
    items += [["spinner", *p.SPINNER, STEEL], ["saucer", *p.SAUCER, GOLD], ["magnet", *p.MAGNET, TEAL],
              ["ramp", *p.RAMP, *p.RAMP_EXIT, STEEL],
              ["subway", p.SUBWAY[0], p.SUBWAY[1], p.SUBWAY_EXIT[0], p.SUBWAY_EXIT[1], DARK],
              ["orbit", *[v for pt in p.ORBIT_PATH for v in pt], STEEL],
              ["kick", "#ffffff"]]
    return items


def clone_specs():
    """{"golden": spec, "neon": spec}: the production boards as editor tables."""
    golden = {"v": 1, "name": "Golden Hour", "cabinet": "classic", "look": "golden", "lock": True,
              "feel": {"classic_lamps": True}, "items": _items(p.BUMPS, p.RAILS[11:15])}
    neon = {"v": 1, "name": "Neon Arcade", "cabinet": "classic", "look": "neon", "lock": True,
            "feel": {"classic_lamps": True, "steep_flippers": True, "gravity": p.NeonTable.rules.gravity,
                     "hurry_seconds": p.NeonTable.rules.hurry_ticks // 240, "super_every": p.NeonTable.rules.super_every,
                     "extra_balls": list(p.NeonTable.rules.extra_ball_scores)},
            "pts": {"bumper": p.NeonTable.rules.bumper, "sling": p.NeonTable.rules.sling, "target": p.NeonTable.rules.target,
                    "lane": p.NeonTable.rules.lane, "ramp": p.NeonTable.rules.ramp, "jackpot": p.NeonTable.rules.jackpot,
                    "hurry": p.NeonTable.rules.hurry_max},
            "items": _items(p.NEON_BUMPS, p.NEON_RAILS[11:15])}
    return {"golden": golden, "neon": neon}


BLURBS = {"golden": "The Golden Hour table, rebuilt part for part. Change anything and make it yours.",
          "neon": "Neon Arcade: four zig-zag bumpers, steeper flippers, hotter scoring and faster jackpots."}
