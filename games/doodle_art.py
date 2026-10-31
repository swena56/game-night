"""Line drawings for Doodle Dash, on a 100×100 canvas. Each drawing is revealed stroke by stroke, so
strokes are ordered from vague outline to giveaway detail. Strokes are SVG path strings that use
only M, L, C, Q and Z (absolute), so the browser can animate them and tests can rasterise them."""
import math


def poly(*pts, close=False):
    d = "M" + " L".join(f"{x} {y}" for x, y in pts)
    return d + (" Z" if close else "")


def ellipse(cx, cy, rx, ry):
    k = 0.5523
    return (f"M{cx + rx} {cy} C{cx + rx} {cy + ry * k} {cx + rx * k} {cy + ry} {cx} {cy + ry} "
            f"C{cx - rx * k} {cy + ry} {cx - rx} {cy + ry * k} {cx - rx} {cy} "
            f"C{cx - rx} {cy - ry * k} {cx - rx * k} {cy - ry} {cx} {cy - ry} "
            f"C{cx + rx * k} {cy - ry} {cx + rx} {cy - ry * k} {cx + rx} {cy} Z")


def circle(cx, cy, r):
    return ellipse(cx, cy, r, r)


def arc(cx, cy, r, a0, a1, steps=12):
    """Polyline arc, angles in degrees (0 = right, 90 = down)."""
    pts = [(round(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)), 1),
            round(cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps)), 1)) for i in range(steps + 1)]
    return poly(*pts)


def rays(cx, cy, r0, r1, n, start=0):
    out = []
    for i in range(n):
        a = math.radians(start + 360 * i / n)
        out.append(poly((round(cx + r0 * math.cos(a), 1), round(cy + r0 * math.sin(a), 1)),
                        (round(cx + r1 * math.cos(a), 1), round(cy + r1 * math.sin(a), 1))))
    return out


# (answer, category, other accepted answers, strokes)
DRAWINGS = [
    # ---------- animals
    ("cat", "Animal", ["kitten", "kitty"], [
        circle(50, 55, 24), poly((32, 39), (30, 18), (44, 32)), poly((56, 32), (70, 18), (68, 39)),
        circle(41, 52, 3), circle(59, 52, 3), poly((47, 61), (53, 61), (50, 65), close=True),
        poly((48, 64), (22, 60)), poly((48, 66), (22, 70)), poly((52, 64), (78, 60)), poly((52, 66), (78, 70))]),
    ("fish", "Animal", ["goldfish"], [
        "M20 50 Q45 22 70 50 Q45 78 20 50 Z", poly((70, 50), (88, 34), (88, 66), close=True),
        circle(32, 46, 3), "M44 36 Q50 50 44 64", poly((45, 30), (55, 22), (60, 34))]),
    ("snail", "Animal", ["slug"], [
        poly((14, 74), (86, 74)), circle(50, 52, 22),
        "M50 52 Q58 50 56 44 Q52 36 44 40 Q36 46 40 56 Q46 66 58 62", "M72 70 Q82 70 84 58",
        poly((80, 60), (78, 44)), poly((84, 58), (88, 44)), circle(78, 42, 2), circle(88, 42, 2)]),
    ("bird", "Animal", ["chick", "robin", "sparrow"], [
        "M30 60 Q30 36 52 36 Q74 36 74 58 Q70 76 50 76 Q34 76 30 60 Z", circle(66, 32, 12),
        poly((77, 30), (90, 34), (77, 38)), circle(68, 29, 2), "M40 58 Q50 48 60 60",
        poly((30, 60), (14, 52), (20, 64), close=True), poly((46, 76), (44, 88)), poly((56, 76), (58, 88))]),
    ("snake", "Animal", ["serpent", "cobra"], [
        "M14 78 Q30 60 46 72 Q62 84 72 66 Q80 50 66 40 Q54 32 62 22",
        "M22 84 Q36 70 48 80 Q66 92 80 70 Q90 48 74 36 Q66 30 72 22",
        "M62 22 Q66 12 74 14 Q80 18 72 22", circle(70, 17, 1.5), poly((76, 18), (84, 16), (82, 20)), poly((84, 16), (86, 12))]),
    ("rabbit", "Animal", ["bunny", "hare"], [
        circle(50, 66, 20), circle(50, 40, 13), "M44 29 Q36 4 44 6 Q50 10 48 28", "M56 28 Q60 4 66 8 Q70 14 56 30",
        circle(45, 38, 2), circle(55, 38, 2), poly((48, 44), (52, 44), (50, 47), close=True), circle(70, 74, 5)]),
    ("turtle", "Animal", ["tortoise"], [
        "M22 62 Q24 30 50 30 Q76 30 78 62 Z", poly((22, 62), (78, 62)),
        poly((40, 40), (50, 34), (60, 40), (58, 52), (42, 52), close=True), circle(88, 54, 7),
        poly((30, 62), (28, 72)), poly((70, 62), (72, 72)), poly((22, 58), (12, 64)), circle(90, 52, 1.5)]),
    ("butterfly", "Animal", ["moth"], [
        poly((50, 30), (50, 74)), "M50 40 Q20 10 16 36 Q14 54 50 50", "M50 40 Q80 10 84 36 Q86 54 50 50",
        "M50 52 Q24 56 28 74 Q36 84 50 60", "M50 52 Q76 56 72 74 Q64 84 50 60",
        "M50 30 Q46 18 40 16", "M50 30 Q54 18 60 16"]),
    ("spider", "Animal", [], [
        circle(50, 56, 12), circle(50, 38, 7), *[poly((40, 52 + i * 4), (24, 44 + i * 9), (14, 54 + i * 9)) for i in range(4)],
        *[poly((60, 52 + i * 4), (76, 44 + i * 9), (86, 54 + i * 9)) for i in range(4)], poly((50, 31), (50, 8))]),
    ("whale", "Animal", ["dolphin"], [
        "M12 56 Q16 32 48 34 Q80 36 80 60 Q72 74 44 72 Q20 72 12 56 Z", "M80 60 Q90 52 92 40",
        poly((92, 40), (84, 38)), poly((92, 40), (96, 32)), circle(26, 50, 2), "M14 60 Q30 64 44 60",
        "M40 34 Q36 24 30 20", "M40 34 Q44 22 50 18"]),
    # ---------- food
    ("apple", "Food", [], [
        "M50 34 Q30 22 22 44 Q18 70 40 82 Q50 86 60 82 Q82 70 78 44 Q70 22 50 34 Z",
        "M50 34 Q50 24 54 16", "M54 22 Q66 12 72 20 Q62 28 54 22 Z"]),
    ("banana", "Food", [], [
        "M22 30 Q20 70 60 78 Q82 78 86 66 Q60 70 40 54 Q30 42 30 28 Z", "M30 32 Q34 58 60 70",
        poly((22, 30), (24, 22), (30, 24), (30, 28))]),
    ("ice cream", "Food", ["ice cream cone", "icecream", "cone", "gelato"], [
        poly((32, 46), (50, 90), (68, 46)), "M30 46 Q26 24 50 22 Q74 24 70 46 Z",
        poly((38, 54), (60, 66)), poly((62, 54), (42, 70)), circle(50, 16, 5)]),
    ("pizza", "Food", ["pizza slice", "slice of pizza"], [
        poly((50, 88), (18, 22), (82, 22), close=True), "M18 22 Q50 10 82 22",
        circle(42, 36, 5), circle(60, 40, 5), circle(50, 58, 4), circle(38, 26, 2), circle(66, 28, 2)]),
    ("carrot", "Food", [], [
        "M40 30 Q60 26 62 34 Q58 60 34 88 Q32 60 40 30 Z", "M50 28 Q46 14 40 10", "M52 28 Q54 12 60 8", "M54 30 Q66 18 72 18",
        poly((44, 46), (52, 48)), poly((40, 62), (48, 64))]),
    ("cherries", "Food", ["cherry"], [
        circle(34, 72, 12), circle(64, 76, 12), "M34 60 Q40 34 56 20", "M64 64 Q64 36 56 20",
        "M56 20 Q70 10 78 18 Q68 24 56 20 Z"]),
    ("cupcake", "Food", ["muffin", "cake"], [
        poly((28, 56), (36, 86), (64, 86), (72, 56)), "M26 56 Q22 40 36 38 Q38 24 50 26 Q62 24 64 38 Q78 40 74 56 Z",
        poly((40, 56), (42, 86)), poly((50, 56), (50, 86)), poly((60, 56), (58, 86)), circle(50, 20, 5)]),
    ("mushroom", "Food", ["toadstool"], [
        "M14 50 Q16 18 50 16 Q84 18 86 50 Z", "M38 50 Q34 76 38 86 L62 86 Q66 76 62 50",
        circle(34, 34, 5), circle(58, 28, 6), circle(72, 42, 4)]),
    ("pear", "Food", [], [
        "M50 22 Q40 22 40 40 Q24 58 32 76 Q42 90 58 86 Q76 80 70 58 Q62 42 60 34 Q58 22 50 22 Z",
        poly((50, 22), (52, 10)), "M52 14 Q60 6 66 12 Q58 16 52 14 Z"]),
    # ---------- things
    ("umbrella", "Thing", ["parasol"], [
        "M12 48 Q50 2 88 48", poly((12, 48), (25, 42), (37, 48), (50, 42), (63, 48), (75, 42), (88, 48)),
        poly((50, 42), (50, 80)), "M50 80 Q50 88 42 88 Q36 88 36 82"]),
    ("key", "Thing", [], [
        circle(28, 50, 14), circle(28, 50, 5), poly((42, 50), (88, 50)), poly((74, 50), (74, 62)), poly((84, 50), (84, 60))]),
    ("light bulb", "Thing", ["lightbulb", "bulb", "lamp", "idea"], [
        "M38 64 Q22 50 28 32 Q36 14 50 14 Q64 14 72 32 Q78 50 62 64 Z", poly((38, 64), (38, 76), (62, 76), (62, 64)),
        poly((38, 70), (62, 70)), poly((44, 80), (56, 80)), poly((44, 64), (46, 44), (50, 50), (54, 44), (56, 64))]),
    ("glasses", "Thing", ["spectacles", "sunglasses", "eyeglasses"], [
        circle(30, 52, 14), circle(70, 52, 14), "M44 50 Q50 44 56 50", poly((16, 48), (6, 40)), poly((84, 48), (94, 40))]),
    ("mug", "Thing", ["cup", "coffee", "coffee cup", "tea", "teacup"], [
        poly((26, 30), (30, 80), (66, 80), (70, 30)), poly((26, 30), (70, 30)), "M68 42 Q86 42 84 56 Q82 68 66 66",
        "M40 22 Q36 14 42 8", "M54 22 Q50 14 56 8"]),
    ("clock", "Thing", ["watch", "alarm clock"], [
        circle(50, 54, 30), poly((50, 54), (50, 34)), poly((50, 54), (64, 62)),
        *rays(50, 54, 25, 29, 12, -90), circle(28, 24, 8), circle(72, 24, 8)]),
    ("guitar", "Thing", ["ukulele", "violin"], [
        "M40 62 Q24 64 26 78 Q30 92 50 90 Q70 92 74 78 Q76 64 60 62 Q66 52 58 46 Q50 42 42 46 Q34 52 40 62 Z",
        circle(50, 70, 6), poly((48, 46), (48, 10), (52, 10), (52, 46)), poly((46, 10), (46, 4), (54, 4), (54, 10)),
        poly((44, 82), (56, 82))]),
    ("scissors", "Thing", [], [
        circle(28, 74, 10), circle(52, 80, 10), poly((34, 66), (82, 18)), poly((46, 72), (74, 14)), circle(54, 47, 2)]),
    ("lock", "Thing", ["padlock"], [
        poly((24, 48), (76, 48), (76, 88), (24, 88), close=True), "M34 48 L34 32 Q34 14 50 14 Q66 14 66 32 L66 48",
        circle(50, 64, 5), poly((50, 68), (50, 78))]),
    ("crown", "Thing", ["tiara"], [
        poly((18, 74), (82, 74)), poly((18, 74), (14, 34), (34, 54), (50, 26), (66, 54), (86, 34), (82, 74)),
        circle(14, 30, 4), circle(50, 22, 4), circle(86, 30, 4), circle(50, 62, 5)]),
    ("kite", "Thing", [], [
        poly((50, 8), (78, 38), (50, 70), (22, 38), close=True), poly((50, 8), (50, 70)), poly((22, 38), (78, 38)),
        "M50 70 Q40 80 52 84 Q64 88 54 96", poly((48, 78), (42, 74), (44, 82), close=True)]),
    # ---------- nature
    ("tree", "Nature", ["oak"], [
        "M30 62 Q12 60 16 44 Q10 28 28 24 Q32 8 50 10 Q68 8 72 24 Q90 28 84 44 Q88 60 70 62 Z",
        poly((44, 90), (46, 62)), poly((56, 90), (54, 62)), poly((50, 72), (62, 64)), poly((28, 90), (72, 90))]),
    ("sun", "Nature", ["sunshine"], [circle(50, 50, 18), *rays(50, 50, 24, 38, 10), "M42 54 Q50 62 58 54", circle(43, 45, 2), circle(57, 45, 2)]),
    ("cloud", "Nature", ["rain", "rain cloud", "raincloud"], [
        "M24 56 Q10 54 14 42 Q18 32 30 34 Q34 18 50 20 Q64 18 68 32 Q84 30 86 44 Q88 58 72 58 Z",
        poly((34, 66), (30, 78)), poly((50, 66), (46, 80)), poly((66, 66), (62, 78))]),
    ("flower", "Nature", ["daisy", "sunflower"], [
        poly((50, 54), (50, 92)), circle(50, 40, 8), *[circle(round(50 + 14 * math.cos(math.radians(a)), 1), round(40 + 14 * math.sin(math.radians(a)), 1), 7)
                                                       for a in range(0, 360, 60)],
        "M50 76 Q34 62 30 72 Q36 80 50 76 Z"]),
    ("moon", "Nature", ["crescent", "crescent moon"], [
        "M58 12 Q20 22 24 58 Q30 90 66 86 Q38 76 38 50 Q38 24 58 12 Z", poly((74, 22), (78, 30), (86, 30), (80, 36), (82, 44), (74, 40), (66, 44), (68, 36), (62, 30), (70, 30), close=True)]),
    ("mountain", "Nature", ["mountains", "volcano", "hill"], [
        poly((6, 84), (38, 26), (58, 62), (70, 46), (94, 84), close=True), poly((28, 44), (34, 48), (38, 42), (42, 48), (46, 42))]),
    ("palm tree", "Nature", ["palm", "island", "coconut tree"], [
        "M50 90 Q52 60 46 34", "M46 34 Q30 20 12 30", "M46 34 Q56 16 76 18", "M46 34 Q66 30 80 44", "M46 34 Q28 34 22 50",
        circle(48, 38, 3), circle(54, 38, 3), "M20 90 Q50 80 80 90"]),
    ("rainbow", "Nature", [], [arc(50, 70, 40, 180, 360, 16), arc(50, 70, 32, 180, 360, 16), arc(50, 70, 24, 180, 360, 16),
                               "M4 74 Q2 64 12 66 Q20 62 22 72 Z", "M78 74 Q78 64 88 66 Q98 64 96 74 Z"]),
    ("leaf", "Nature", [], ["M20 80 Q20 26 80 18 Q82 72 20 80 Z", poly((20, 80), (66, 34)), poly((34, 66), (34, 50)), poly((46, 54), (60, 56)),
                            poly((20, 80), (12, 88))]),
    # ---------- vehicles
    ("car", "Vehicle", ["auto", "automobile"], [
        poly((10, 64), (10, 50), (24, 48), (34, 32), (66, 32), (78, 48), (90, 52), (90, 64), close=True),
        circle(28, 66, 9), circle(72, 66, 9), poly((38, 36), (38, 48)), poly((60, 36), (72, 48), (40, 48))]),
    ("sailboat", "Vehicle", ["boat", "ship", "yacht", "sailing boat"], [
        poly((14, 66), (86, 66), (74, 80), (26, 80), close=True), poly((50, 66), (50, 12)), poly((50, 14), (80, 58), (50, 58)),
        poly((48, 22), (24, 58), (48, 58)), "M4 88 Q14 84 24 88 Q34 92 44 88 Q54 84 64 88 Q74 92 84 88 Q90 85 96 88"]),
    ("rocket", "Vehicle", ["spaceship", "rocket ship"], [
        "M50 8 Q70 24 64 64 L36 64 Q30 24 50 8 Z", circle(50, 34, 7), poly((36, 52), (24, 70), (36, 66)), poly((64, 52), (76, 70), (64, 66)),
        "M42 66 Q50 92 58 66"]),
    ("airplane", "Vehicle", ["plane", "aeroplane", "jet"], [
        "M10 50 Q14 44 30 44 L84 44 Q94 48 84 54 L30 54 Q14 54 10 50 Z", poly((44, 46), (60, 16), (66, 16), (60, 46)),
        poly((44, 54), (60, 82), (66, 82), (60, 54)), poly((18, 46), (10, 30), (16, 30), (28, 44))]),
    ("bicycle", "Vehicle", ["bike", "cycle"], [
        circle(26, 66, 16), circle(74, 66, 16), poly((26, 66), (42, 44), (66, 44), (74, 66)), poly((42, 44), (50, 66), (66, 44)),
        poly((40, 38), (46, 38)), poly((66, 44), (62, 32), (70, 30))]),
    ("hot air balloon", "Vehicle", ["balloon", "air balloon"], [
        "M50 8 Q84 8 80 40 Q76 58 60 66 L40 66 Q24 58 20 40 Q16 8 50 8 Z", poly((40, 76), (60, 76), (58, 90), (42, 90), close=True),
        poly((40, 66), (40, 76)), poly((60, 66), (60, 76)), "M50 8 Q36 30 42 66", "M50 8 Q64 30 58 66"]),
    ("train", "Vehicle", ["locomotive", "steam train", "engine"], [
        poly((14, 34), (40, 34), (40, 70), (14, 70), close=True), poly((40, 46), (86, 46), (86, 70), (40, 70)), circle(28, 74, 7),
        circle(54, 74, 7), circle(74, 74, 7), poly((70, 46), (70, 30), (78, 30), (78, 46)), circle(78, 20, 5), circle(88, 12, 4)]),
    # ---------- places & buildings
    ("house", "Place", ["home", "cottage"], [
        poly((22, 48), (22, 86), (78, 86), (78, 48)), poly((14, 50), (50, 18), (86, 50)), poly((44, 86), (44, 64), (56, 64), (56, 86)),
        poly((28, 56), (38, 56), (38, 66), (28, 66), close=True), poly((66, 34), (66, 22), (72, 22), (72, 40))]),
    ("castle", "Place", ["fort", "fortress", "palace"], [
        poly((14, 88), (14, 36), (30, 36), (30, 88)), poly((70, 88), (70, 36), (86, 36), (86, 88)), poly((30, 52), (70, 52)),
        poly((14, 88), (86, 88)), "M42 88 L42 70 Q50 60 58 70 L58 88", poly((14, 36), (14, 28), (19, 28), (19, 36), (25, 36), (25, 28), (30, 28), (30, 36)),
        poly((70, 36), (70, 28), (75, 28), (75, 36), (81, 36), (81, 28), (86, 28), (86, 36)), poly((50, 52), (50, 30), (62, 34), (50, 38))]),
    ("lighthouse", "Place", ["tower"], [
        poly((36, 90), (42, 34), (58, 34), (64, 90), close=True), poly((40, 34), (40, 24), (60, 24), (60, 34)), poly((38, 24), (50, 14), (62, 24)),
        poly((40, 52), (60, 52)), poly((38, 70), (62, 70)), poly((62, 28), (90, 20)), poly((62, 30), (90, 40))]),
    ("tent", "Place", ["camping", "campsite"], [
        poly((10, 82), (50, 20), (90, 82), close=True), poly((50, 20), (50, 82)), poly((50, 82), (40, 82), (50, 50)), poly((50, 20), (44, 10)),
        poly((50, 20), (56, 10))]),
    ("igloo", "Place", [], [
        "M10 80 Q12 26 50 24 Q88 26 90 80 Z", "M38 80 Q38 62 50 62 Q62 62 62 80", poly((14, 62), (86, 62)), poly((22, 44), (78, 44)),
        poly((30, 44), (30, 62)), poly((70, 44), (70, 62)), poly((50, 24), (50, 44))]),
    ("pyramid", "Place", ["pyramids", "egypt"], [
        poly((6, 84), (50, 18), (94, 84), close=True), poly((50, 18), (60, 84)), poly((22, 60), (78, 60)), poly((34, 42), (66, 42)),
        circle(84, 18, 7)]),
]
