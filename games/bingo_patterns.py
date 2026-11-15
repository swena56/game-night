"""Bingo Bash's patterns, shared by the rules (games/bingo.py) and, through the view, the browser: the 12 lines,
the four corners, the blackout, the Pattern-hunt shapes and the Ladder stages. A card is 25 cells, row by row
(cell = row*5 + col), with the FREE centre at 12."""

FREE = 12


def draw(*rows):
    """Cells marked '#' in five 5-character rows."""
    return [r * 5 + c for r, row in enumerate(rows) for c, ch in enumerate(row) if ch == "#"]


LINES = {f"r{r}": [r * 5 + c for c in range(5)] for r in range(5)}
LINES.update({f"c{c}": [r * 5 + c for r in range(5)] for c in range(5)})
LINES["d0"] = [i * 6 for i in range(5)]
LINES["d1"] = [4 + i * 4 for i in range(5)]
CORNERS = [0, 4, 20, 24]
ALL = list(range(25))

# Bash scores every one of these on every card: [(key, kind, cells)]
PATTERNS = [(k, "line", v) for k, v in LINES.items()] + [("x4", "corners", CORNERS), ("all", "blackout", ALL)]

# 🎯 Pattern hunt: key -> (name, [variants]); a shape is done when any one variant is fully daubed
SHAPES = {
    "x": ("X", [draw("#...#", ".#.#.", "..#..", ".#.#.", "#...#")]),
    "plus": ("Plus", [draw("..#..", "..#..", "#####", "..#..", "..#..")]),
    "t": ("Letter T", [draw("#####", "..#..", "..#..", "..#..", "..#..")]),
    "l": ("Letter L", [draw("#....", "#....", "#....", "#....", "#####")]),
    "h": ("Letter H", [draw("#...#", "#...#", "#####", "#...#", "#...#")]),
    "frame": ("Picture frame", [draw("#####", "#...#", "#...#", "#...#", "#####")]),
    "inner": ("Inner square", [draw(".....", ".###.", ".#.#.", ".###.", ".....")]),
    "diamond": ("Diamond", [draw("..#..", ".#.#.", "#...#", ".#.#.", "..#..")]),
    "stamp": ("Postage stamp", [draw("##...", "##...", ".....", ".....", "....."),
                                draw("...##", "...##", ".....", ".....", "....."),
                                draw(".....", ".....", ".....", "##...", "##..."),
                                draw(".....", ".....", ".....", "...##", "...##")]),
    "kite": ("Kite", [draw("###..", "###..", "###..", "...#.", "....#")]),
    "arrow": ("Arrow", [draw("..###", "...##", "..#.#", ".#...", "#....")]),
    "blackout": ("Blackout", [ALL]),
}
HUNT_ORDER = [k for k in SHAPES if k != "blackout"]

# 📈 Ladder: (key, name, prize); each stage's first claim takes the prize, then the next stage opens
LADDER = [("line", "One line", 100), ("two", "Two lines", 200), ("corners", "Four corners", 150), ("blackout", "Blackout", 500)]
