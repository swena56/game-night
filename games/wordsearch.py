"""Word Search: the public-domain puzzle-page game, raced. Everyone gets the same themed grid of
letters with words hidden in straight lines. Drag (or tap the first and last letter) to circle a word.

🏴 Grab (the default with company): one shared puzzle, and a word belongs to whoever circles it first.
🏁 Race: everyone has their own copy and tries to find every word first."""
import random

from .base import GameError
from .puzzlerace import PuzzleRace

THEMES = {
    "Animals": "TIGER ZEBRA OTTER MOOSE BADGER BEAVER RABBIT DONKEY GIRAFFE PANDA KOALA LLAMA CAMEL WALRUS FERRET "
               "HAMSTER JAGUAR LEOPARD MONKEY TURTLE LIZARD GORILLA BISON HIPPO SKUNK WOMBAT",
    "Fruit": "APPLE MANGO PEACH PLUM GRAPE LEMON LIME CHERRY BANANA MELON KIWI PAPAYA GUAVA APRICOT ORANGE "
             "COCONUT FIG DATE PEAR QUINCE LYCHEE RAISIN BERRY OLIVE",
    "Space": "PLANET COMET ORBIT ROCKET GALAXY NEBULA METEOR SATURN VENUS MARS PLUTO ASTEROID MOON STAR "
             "ECLIPSE COSMOS QUASAR PULSAR LUNAR SOLAR ALIEN SHUTTLE CRATER JUPITER",
    "Ocean": "WHALE SHARK CORAL REEF TIDE WAVE SQUID OCTOPUS DOLPHIN SEAL CRAB LOBSTER SHRIMP KELP ANCHOR "
             "HARBOR SAILOR ISLAND LAGOON PEARL SHELL STARFISH SALMON TUNA",
    "Sports": "SOCCER TENNIS HOCKEY RUGBY GOLF BOXING ROWING SKIING CYCLING KARATE CRICKET DARTS BOWLING "
              "ARCHERY FENCING SURFING DIVING SPRINT RELAY DISCUS JAVELIN SQUASH",
    "Kitchen": "SPOON FORK KNIFE LADLE WHISK KETTLE TOASTER OVEN STOVE PLATE BOWL GRATER SKILLET SPATULA "
               "BLENDER APRON PANTRY TONGS COLANDER TEAPOT MUG SIEVE",
    "Weather": "RAIN SNOW SLEET HAIL STORM THUNDER CLOUD FOG MIST BREEZE GALE SUNNY FROST DRIZZLE TORNADO "
               "RAINBOW HUMID CHILLY MONSOON BLIZZARD CYCLONE DEW",
    "Music": "PIANO GUITAR VIOLIN CELLO FLUTE DRUMS TRUMPET BANJO HARP TUBA OBOE CHORD MELODY RHYTHM TEMPO "
             "OPERA CHOIR LYRIC BASS VIOLA TROMBONE CLARINET SONG",
    "Garden": "ROSE TULIP DAISY LILY ORCHID POPPY IRIS SEED SOIL SHOVEL HOSE RAKE HEDGE LAWN SHED "
              "COMPOST SPROUT BLOSSOM PETAL VINE FERN MOSS BULB WEED",
    "Camping": "TENT LANTERN COMPASS CANOE TRAIL HIKING CAMPFIRE KINDLING SLEEPING BACKPACK MAP FLASHLIGHT "
               "MARSHMALLOW FOREST CABIN PADDLE ROPE KNOT WOODS STREAM",
    "Colours": "RED BLUE GREEN YELLOW PURPLE ORANGE PINK BROWN BLACK WHITE GREY SILVER GOLD VIOLET INDIGO "
               "CRIMSON SCARLET TEAL AMBER IVORY MAROON NAVY CORAL BEIGE",
    "Breakfast": "TOAST BACON EGGS WAFFLE PANCAKE CEREAL MUFFIN BAGEL CROISSANT OATMEAL YOGURT HONEY JAM "
                 "BUTTER JUICE COFFEE SYRUP SAUSAGE OMELET GRANOLA",
    "Body": "HEART LUNGS BRAIN ELBOW KNEE ANKLE WRIST THUMB FINGER SHOULDER SPINE SKULL TOOTH TONGUE "
            "EYEBROW NOSE CHIN CHEEK HIP STOMACH LIVER MUSCLE",
    "Travel": "TICKET PASSPORT LUGGAGE AIRPORT HOTEL TRAIN FERRY CRUISE BEACH MUSEUM SUITCASE POSTCARD "
              "JOURNEY VOYAGE TOURIST BORDER CASTLE SOUVENIR",
}
THEMES = {k: sorted(set(v.split())) for k, v in THEMES.items()}
DIRS = {   # which way words may run
    "easy": [(0, 1), (1, 0)],
    "normal": [(0, 1), (1, 0), (1, 1), (-1, 1)],
    "hard": [(0, 1), (1, 0), (1, 1), (-1, 1), (0, -1), (-1, 0), (-1, -1), (1, -1)],
}
COUNT = {8: 8, 10: 11, 12: 14}
HINT_COST = 2


def build(rng, size, dirs, theme):
    """(grid rows, {word: [r1, c1, r2, c2]}) with as many of the theme's words placed as fit."""
    pool = [w for w in THEMES[theme] if 3 <= len(w) <= size]
    rng.shuffle(pool)
    pick = []
    for w in pool:   # no word inside another (CAT in CATERPILLAR would be found twice)
        if not any(w in x or x in w for x in pick):
            pick.append(w)
        if len(pick) >= COUNT[size] + 3:
            break
    pick.sort(key=len, reverse=True)
    grid = [[""] * size for _ in range(size)]
    where = {}
    for w in pick:
        if len(where) >= COUNT[size]:
            break
        spots = []
        for dr, dc in dirs:
            for r in range(size):
                for c in range(size):
                    r2, c2 = r + dr * (len(w) - 1), c + dc * (len(w) - 1)
                    if not (0 <= r2 < size and 0 <= c2 < size):
                        continue
                    cross = 0
                    for k, ch in enumerate(w):
                        g = grid[r + dr * k][c + dc * k]
                        if g and g != ch:
                            break
                        cross += g == ch
                    else:
                        spots.append((cross, rng.random(), r, c, dr, dc))
        if not spots:
            continue
        # prefer crossing an already placed word a little, as printed puzzles do
        spots.sort(reverse=True)
        cross, _, r, c, dr, dc = spots[0] if spots[0][0] and rng.random() < 0.4 else rng.choice(spots)
        for k, ch in enumerate(w):
            grid[r + dr * k][c + dc * k] = ch
        where[w] = [r, c, r + dr * (len(w) - 1), c + dc * (len(w) - 1)]
    letters = "".join(where)
    blank = [(r, c) for r in range(size) for c in range(size) if not grid[r][c]]
    for _ in range(40):
        for r, c in blank:
            grid[r][c] = rng.choice(letters)   # filler from the same letters, so words don't stand out
        rows = ["".join(row) for row in grid]
        if all(occurrences(rows, w) == 1 for w in where):   # each word hides exactly once
            break
    return rows, where


def lines(rows):
    """Every straight line of the grid, read both ways."""
    n = len(rows)
    out = list(rows) + ["".join(rows[r][c] for r in range(n)) for c in range(n)]
    for k in range(-n + 1, n):
        out.append("".join(rows[r][r - k] for r in range(n) if 0 <= r - k < n))
        out.append("".join(rows[r][k + n - 1 - r] for r in range(n) if 0 <= k + n - 1 - r < n))
    return out + [x[::-1] for x in out]


def occurrences(rows, w):
    count = 0
    for line in lines(rows):
        i = line.find(w)
        while i >= 0:
            count += 1
            i = line.find(w, i + 1)
    return count if w != w[::-1] else count // 2


class WordSearch(PuzzleRace):
    id = "wordsearch"
    category = "words"
    name = "Word Search"
    icon = "🔍"
    noun = "grid"
    blurb = "Hunt the hidden words in a themed letter grid. Grab them before your friends do."
    howto = [
        "Words from the theme hide in the grid in straight lines. Drag across one, or tap its first and last letter.",
        "🏴 Grab: one shared grid, and each word belongs to whoever circles it first. 🏁 Race: everyone has their own copy.",
        "A word scores a point per letter. 💡 shows where a word starts, for 2 points.",
        "In 🏁 Race, finding every word scores +10, and +5 more for being first. Most points after the last grid wins.",
        "Alone, find every word before the clock runs out to win.",
    ]
    settings_schema = {
        "mode": ("Mode", [("grab", "🏴 Grab: first to find a word takes it"), ("race", "🏁 Race: everyone finds every word")], "grab"),
        "size": ("Grid", [(10, "10×10"), (8, "8×8"), (12, "12×12")], 10),
        "dirs": ("Words run", [("normal", "Across, down and diagonally"), ("easy", "Only across and down"), ("hard", "Any way, backwards too")], "normal"),
        "rounds": ("Grids", [(3, "3"), (1, "1"), (5, "5")], 3),
        "secs": ("Time per grid", [(180, "3 min"), (120, "2 min"), (300, "5 min")], 180),
        "daily": ("Puzzles", [(False, "🎲 Random"), (True, "📅 Today's grids (the same everywhere)")], False),
    }
    badges = {**PuzzleRace.badges, "sweep": ("🧹", "Clean sweep", "Grab more than half the words of a shared grid")}
    BOT = {"easy": 16.0, "normal": 10.0, "hard": 6.5}   # seconds per word found

    def start(self, seated, rng):
        self.claims = {}
        self.used_themes = []
        super().start(seated, rng)

    def grab(self):
        return self.s.get("mode") == "grab" and not self.solo

    def new_puzzle(self, rng):
        self.size = self.s.get("size", 10) if self.s.get("size") in COUNT else 10
        dirs = DIRS.get(self.s.get("dirs"), DIRS["normal"])
        left = [t for t in sorted(THEMES) if t not in self.used_themes] or sorted(THEMES)
        self.theme = rng.choice(left)
        self.used_themes.append(self.theme)
        self.grid, self.where = build(random.Random(rng.random()), self.size, dirs, self.theme)
        self.words = sorted(self.where)
        self.claims = {}   # 🏴 grab: word -> pid
        return f"{self.theme}, {len(self.words)} words"

    def fresh(self):
        return {"found": [], "hints": [], "seq": 0}

    def finished(self, pid):
        if self.grab():
            return False
        st = self.st.get(pid)
        return bool(st) and len(st["found"]) == len(self.words)

    def waiting_on(self):
        if self.grab() and self.stage == "play" and len(self.claims) == len(self.words):
            return []
        return super().waiting_on()

    def progress(self, pid):
        return [len(self.st[pid]["found"]), len(self.words)]

    def points(self, p):
        st = self.st[p.id]
        return sum(len(w) for w in st["found"]) - HINT_COST * len(st["hints"])

    def scored_live(self):
        return self.grab()   # grab points (and hint costs) land as they happen

    def reveal(self):
        if self.grab() and self.claims:
            for p in self.live():
                if len(self.st.get(p.id, {}).get("found", [])) * 2 > len(self.words):
                    self.award(p, "sweep")
        super().reveal()

    # -- moves

    def move(self, p, st, a):
        kind = a.get("type")
        if kind == "find":
            cells = a.get("cells")
            if (not isinstance(cells, list) or len(cells) != 4
                    or not all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < self.size for x in cells)):
                raise GameError("Circle a word from its first letter to its last.")
            r1, c1, r2, c2 = cells
            dr, dc = r2 - r1, c2 - c1
            n = max(abs(dr), abs(dc))
            if n == 0 or (dr and dc and abs(dr) != abs(dc)):
                raise GameError("Words run in straight lines: across, down or diagonally.")
            dr, dc = (dr > 0) - (dr < 0), (dc > 0) - (dc < 0)
            text = "".join(self.grid[r1 + dr * k][c1 + dc * k] for k in range(n + 1))
            # any copy counts (a short word can turn up twice by chance); it's circled where it was found
            if text in self.where:
                return self.take(p, st, text, [r1, c1, r2, c2])
            if text[::-1] in self.where:
                return self.take(p, st, text[::-1], [r2, c2, r1, c1])
            raise GameError(f"{text} isn't one of the words.")
        if kind == "hint":
            left = [w for w in self.words if w not in st["found"] and w not in self.claims
                    and not any(h == self.where[w][:2] for h in st["hints"])]
            if not left:
                raise GameError("No words left to hint at.")
            w = self.rng.choice(left)
            st["hints"].append(self.where[w][:2])
            st["seq"] += 1
            if self.grab():
                p.g.score = max(0, p.g.score - HINT_COST)
            return
        raise GameError("Unknown action.")

    def take(self, p, st, w, pos):
        if w in st["found"]:
            raise GameError(f"You've already found {w}.")
        if self.grab() and w in self.claims:
            q = self.room.players.get(self.claims[w])
            raise GameError(f"{q.name if q else 'Someone'} already grabbed {w}.")
        st["found"].append(w)
        st.setdefault("at", {})[w] = pos
        st["seq"] += 1
        if self.grab():
            self.claims[w] = p.id
            p.g.score += len(w)   # grab points land at once, so the scoreboard moves
            left = len(self.words) - len(self.claims)
            self.room.add_log(f"🔍 {p.name} grabbed {w} (+{len(w)})" + (f", {left} left." if left else "."))
            if len(w) >= 8:
                self.moment(f"🔍 {p.name} spotted {w}!", "good", "chime")
        else:
            self.room.add_log(f"🔍 {p.name} found {w}.", "private", to=p.id)

    # -- bots: they find a word every so often (longer, straighter words come quicker)

    def bot_pace(self, p, st):
        base = self.BOT.get(p.bot or "normal", 10.0)
        base *= {"easy": 0.8, "normal": 1.0, "hard": 1.35}.get(self.s.get("dirs"), 1.0)
        base *= {8: 0.75, 10: 1.0, 12: 1.3}.get(getattr(self, "size", 10), 1.0)
        return base * self.rng.uniform(0.6, 1.4)

    def bot_move(self, p, st):
        left = [w for w in self.words if w not in st["found"] and w not in self.claims]
        if not left:
            return False if not self.grab() else None
        w = max(self.rng.sample(left, min(2, len(left))), key=len)   # long words catch the eye first
        pos = self.where[w]
        self.take(p, st, w, list(pos))

    # -- view

    def public(self, p):
        st = self.st.get(p.id) or self.fresh()
        over = self.stage == "reveal" or self.room.phase == "over"
        if self.grab():
            owners = dict(self.claims)
        else:
            owners = {w: p.id for w in st["found"]}
        shown = self.words if over else list(owners)
        at = {w: self.st.get(pid, {}).get("at", {}).get(w) for w, pid in owners.items()}
        return {"size": self.size, "grid": self.grid, "theme": self.theme, "words": self.words,
                "grab": self.grab(), "owners": owners, "found": st["found"],
                "lines": {w: at.get(w) or self.where[w] for w in shown},
                "hints": st["hints"], "hintCost": HINT_COST, "seq": st["seq"]}
