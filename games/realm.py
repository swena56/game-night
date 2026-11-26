"""Realm Wars: an original conquest game for 2–6 players on made-up archipelagos.

Each turn: draft troops (your lands ÷ 3, at least 3, plus a bonus for every whole island you hold), attack
neighbouring lands with dice (up to 3 attacking dice against up to 2 defending, highest dice compared, the
defender wins ties), then make one fortifying move along a chain of your own lands. Taking at least one
land in a turn earns a banner card; three of a kind or one of each trade in for a growing troop bonus.
Goals: rule the whole map, or (an option) hold every capital. A round limit (an option) ends long games:
the most lands wins.

Twists (options, on by default): ⛈️ storms close a random sea lane each round, and 🏰 forts (4 troops from
the draft) add +1 to the defender's best die. Maps: Six Isles (30 lands) or the Grand Archipelago (44).
Starting lands are dealt at random, or picked one at a time."""
import math
import time
from functools import lru_cache
from itertools import product
from types import SimpleNamespace

from .base import Game, GameError

# -- maps. Lands are (name, island, x, y) on the map's sheet; links are pairs of land names.
_ISLANDS6 = [  # (name, bonus, land colour)
    ("Frostmere", 3, "#c9dbe6"),
    ("Skyreef", 2, "#d9cfee"),
    ("Tidewatch", 3, "#bfe0c9"),
    ("Verdant", 5, "#a9d18e"),
    ("Ashlands", 3, "#d9b7a0"),
    ("Sunreach", 3, "#ecd79c"),
]
_LANDS6 = [
    ("Icefang", 0, 140, 62), ("Whitepeak", 0, 245, 46), ("Rimeholt", 0, 350, 70), ("Glacier Bay", 0, 190, 140), ("Snowmarch", 0, 305, 148),
    ("Cloudtop", 1, 470, 52), ("Starfall", 1, 555, 108), ("Mistpeak", 1, 462, 142), ("Windward", 1, 545, 196),
    ("Gullcliff", 2, 58, 232), ("Saltmarsh", 2, 128, 282), ("Driftport", 2, 48, 338), ("Kelpwood", 2, 120, 386), ("Coralhaven", 2, 62, 448),
    ("Mossvale", 3, 232, 252), ("Thornwood", 3, 352, 238), ("Oakheart", 3, 296, 318), ("Greenhollow", 3, 222, 372), ("Fernbrook", 3, 388, 330), ("Willowmere", 3, 300, 410),
    ("Cinder Gate", 4, 478, 272), ("Ember Fields", 4, 552, 300), ("Smokewell", 4, 476, 362), ("Obsidian Spire", 4, 552, 392), ("Magma Reach", 4, 494, 456),
    ("Dunehold", 5, 206, 508), ("Oasis", 5, 312, 502), ("Mirage", 5, 418, 524), ("Sandscar", 5, 254, 596), ("Scorchpoint", 5, 372, 604),
]
_LAND6 = [
    ("Icefang", "Whitepeak"), ("Whitepeak", "Rimeholt"), ("Icefang", "Glacier Bay"), ("Whitepeak", "Glacier Bay"), ("Whitepeak", "Snowmarch"),
    ("Rimeholt", "Snowmarch"), ("Glacier Bay", "Snowmarch"),
    ("Cloudtop", "Starfall"), ("Cloudtop", "Mistpeak"), ("Starfall", "Mistpeak"), ("Starfall", "Windward"), ("Mistpeak", "Windward"),
    ("Gullcliff", "Saltmarsh"), ("Gullcliff", "Driftport"), ("Saltmarsh", "Driftport"), ("Saltmarsh", "Kelpwood"), ("Driftport", "Kelpwood"),
    ("Kelpwood", "Coralhaven"), ("Driftport", "Coralhaven"),
    ("Mossvale", "Thornwood"), ("Mossvale", "Oakheart"), ("Thornwood", "Oakheart"), ("Thornwood", "Fernbrook"), ("Oakheart", "Fernbrook"),
    ("Oakheart", "Greenhollow"), ("Mossvale", "Greenhollow"), ("Greenhollow", "Willowmere"), ("Oakheart", "Willowmere"), ("Fernbrook", "Willowmere"),
    ("Cinder Gate", "Ember Fields"), ("Cinder Gate", "Smokewell"), ("Ember Fields", "Smokewell"), ("Ember Fields", "Obsidian Spire"),
    ("Smokewell", "Obsidian Spire"), ("Smokewell", "Magma Reach"), ("Obsidian Spire", "Magma Reach"),
    ("Dunehold", "Oasis"), ("Oasis", "Mirage"), ("Dunehold", "Sandscar"), ("Oasis", "Sandscar"), ("Oasis", "Scorchpoint"),
    ("Mirage", "Scorchpoint"), ("Sandscar", "Scorchpoint"),
]
_SEA6 = [  # sea lanes between islands (drawn dashed)
    ("Glacier Bay", "Gullcliff"), ("Glacier Bay", "Mossvale"), ("Snowmarch", "Thornwood"), ("Rimeholt", "Cloudtop"),
    ("Mistpeak", "Thornwood"), ("Windward", "Cinder Gate"), ("Saltmarsh", "Mossvale"), ("Kelpwood", "Greenhollow"),
    ("Coralhaven", "Dunehold"), ("Fernbrook", "Cinder Gate"), ("Fernbrook", "Smokewell"), ("Willowmere", "Oasis"),
    ("Magma Reach", "Mirage"),
]

# the Grand Archipelago: the six isles spread out, plus Stormholt (rocky, east) and Mirefen (fen, south-west)
_ISLANDS8 = _ISLANDS6 + [("Stormholt", 4, "#bdb6ac"), ("Mirefen", 4, "#b9c79c")]
_LANDS8 = [(n, k, round(x * 1.1), round(y * 1.1) + 4) for n, k, x, y in _LANDS6] + [
    ("Ironcrag", 6, 712, 72), ("Gale Point", 6, 772, 152), ("Thunderhold", 6, 708, 226), ("Basalt Bay", 6, 772, 304),
    ("Wreckers' Rest", 6, 710, 380), ("Grimtide", 6, 772, 456), ("Stonewatch", 6, 712, 530),
    ("Reedwater", 7, 62, 640), ("Bogmoor", 7, 66, 734), ("Fogbank", 7, 70, 836), ("Wisp Hollow", 7, 160, 790),
    ("Peat Downs", 7, 262, 818), ("Lilyreach", 7, 368, 840), ("Heron Isle", 7, 470, 806),
]
_LAND8 = _LAND6 + [
    ("Ironcrag", "Gale Point"), ("Ironcrag", "Thunderhold"), ("Gale Point", "Thunderhold"), ("Gale Point", "Basalt Bay"),
    ("Thunderhold", "Basalt Bay"), ("Thunderhold", "Wreckers' Rest"), ("Basalt Bay", "Wreckers' Rest"), ("Basalt Bay", "Grimtide"),
    ("Wreckers' Rest", "Grimtide"), ("Wreckers' Rest", "Stonewatch"), ("Grimtide", "Stonewatch"),
    ("Reedwater", "Bogmoor"), ("Bogmoor", "Fogbank"), ("Bogmoor", "Wisp Hollow"), ("Fogbank", "Wisp Hollow"),
    ("Wisp Hollow", "Peat Downs"), ("Peat Downs", "Lilyreach"), ("Lilyreach", "Heron Isle"),
]
_SEA8 = _SEA6 + [
    ("Starfall", "Ironcrag"), ("Ember Fields", "Basalt Bay"), ("Magma Reach", "Stonewatch"),
    ("Coralhaven", "Reedwater"), ("Sandscar", "Peat Downs"), ("Scorchpoint", "Lilyreach"),
]


def _make_map(key, title, size, islands, lands, land_links, sea_links, reach, labels, compass, start, storms):
    idx = {n: i for i, (n, *_r) in enumerate(lands)}
    n = len(lands)
    adj = [set() for _ in range(n)]
    for a, b in land_links + sea_links:
        adj[idx[a]].add(idx[b]); adj[idx[b]].add(idx[a])
    links = [[idx[a], idx[b], 0] for a, b in land_links] + [[idx[a], idx[b], 1] for a, b in sea_links]
    return SimpleNamespace(
        key=key, title=title, n=n, lands=lands, islands=islands, adj=adj, start=start, storms=storms,
        isle_lands=[[i for i, l in enumerate(lands) if l[1] == k] for k in range(len(islands))],
        sea=[(idx[a], idx[b]) for a, b in sea_links],
        view={"key": key, "size": list(size), "reach": reach, "lands": [[nm, k, x, y] for nm, k, x, y in lands],
              "islands": [[nm, b, c] for nm, b, c in islands], "links": links, "labels": labels, "compass": compass},
    )


MAPS = {
    "isles": _make_map(
        "isles", "Six Isles", (600, 660), _ISLANDS6, _LANDS6, _LAND6, _SEA6, 58,
        [[8, 20, "start"], [592, 20, "end"], [8, 545, "start"], [395, 447, "middle"], [592, 535, "end"], [120, 628, "middle"]],
        [548, 602], {2: 26, 3: 22, 4: 18, 5: 14, 6: 11}, 1),
    "grand": _make_map(
        "grand", "Grand Archipelago", (800, 900), _ISLANDS8, _LANDS8, _LAND8, _SEA8, 63,
        [[8, 20, "start"], [618, 20, "middle"], [8, 172, "start"], [440, 500, "middle"], [600, 594, "middle"],
         [425, 752, "middle"], [792, 616, "end"], [600, 878, "middle"]],
        [736, 818], {2: 36, 3: 30, 4: 25, 5: 20, 6: 16}, 2),
}
# the classic map, for the rules tests
LANDS = _LANDS6
N = len(LANDS)
ADJ = MAPS["isles"].adj

TRADES = [4, 6, 8, 10, 12, 15]  # then +5 each
KINDS = ("⚔️", "🛡️", "🏹", "⭐")  # a ⭐ banner is wild
ROUND_CAP = 80  # with no round limit set, a stalemate still ends here
FORT_COST = 4
GOALS = {"dominion": "Hold two thirds of the map", "world": "Rule the whole map", "capitals": "Hold every capital"}
DOMINION = 2 / 3  # hold this share at the start of your turn to win (the dominion goal)
BOUNTY_TROOPS = 3
GAMBITS = {  # once-a-game moves: name -> (icon, title, what it does)
    "muster": ("📯", "Muster", "+50% troops in this draft"),
    "shield": ("🛡️", "Shield wall", "until your next turn, every land of yours defends as if forted"),
    "march": ("🎺", "Forced march", "two fortify moves this turn"),
    "runner": ("⛵", "Storm runner", "this turn, attack and move across stormy lanes"),
}
AMBITION_REWARD = 6
AMBITIONS_TO_WIN = 3


def trade_value(n):
    return TRADES[n] if n < len(TRADES) else TRADES[-1] + 5 * (n - len(TRADES) + 1)


def find_set(hand):
    """Indices of a tradeable set in `hand` (wilds used last), or None."""
    by = {k: [i for i, c in enumerate(hand) if c == k] for k in range(4)}
    for k in range(3):
        if len(by[k]) >= 3:
            return by[k][:3]
    if all(by[k] for k in range(3)):
        return [by[0][0], by[1][0], by[2][0]]
    if by[3]:
        w = by[3][0]
        for k in range(3):
            if len(by[k]) >= 2:
                return by[k][:2] + [w]
        have = [by[k][0] for k in range(3) if by[k]]
        if len(have) + len(by[3]) >= 3:
            return (have + by[3])[:3]
    return None


def resolve(at, de, fort=False):
    """(attacker losses, defender losses) for sorted dice; a fort adds 1 to the defender's best die."""
    de = list(de)
    if fort and de:
        de[0] += 1
    la = sum(1 for x, y in zip(at, de) if x <= y)
    return la, min(len(at), len(de)) - la


# -- odds: the chance an attack with `a` spare troops takes a land held by `d`, rolling until done
def _roll_odds():
    out = {}
    for fort in (False, True):
        for na in (1, 2, 3):
            for nd in (1, 2):
                tally = {}
                for dice in product(range(1, 7), repeat=na + nd):
                    key = resolve(sorted(dice[:na], reverse=True), sorted(dice[na:], reverse=True), fort)
                    tally[key] = tally.get(key, 0) + 1
                total = 6 ** (na + nd)
                out[(na, nd, fort)] = [(la, ld, c / total) for (la, ld), c in tally.items()]
    return out


ROLL_ODDS = _roll_odds()


@lru_cache(maxsize=None)
def win_chance(a, d, fort=False):
    """a = attacking troops (beyond the one that stays home), d = defenders."""
    if d <= 0:
        return 1.0
    if a <= 0:
        return 0.0
    return sum(pr * win_chance(a - la, d - ld, fort) for la, ld, pr in ROLL_ODDS[(min(3, a), min(2, d), fort)])


class Realm(Game):
    id = "realm"
    category = "strategy"
    howto = [
        "Draft: you get troops for your lands (÷3, at least 3) plus a bonus for each whole island you hold. Tap your lands to place them (↶ takes one back).",
        "Attack: tap one of your lands (2+ troops), then a neighbouring rival land, and roll. Up to 3 dice attack, up to 2 defend; highest dice are compared and the defender wins ties.",
        "Take a land and move troops in; it becomes your next attacker. Lands link by coast or by dashed sea lanes.",
        "Fortify: one move per turn, from one of your lands to another joined through your own lands. Then your turn ends.",
        "Take at least one land in a turn to earn a banner. Trade three alike (or one of each; ⭐ is wild) for more troops; the bonus grows with every trade. Holding 5 banners, you must trade.",
        "⛈️ Storms (an option): each round a storm closes a sea lane until the next round.",
        "🏰 Forts (an option): while drafting, spend 4 troops to fort a land. Its defender's best die gets +1. A fort falls with its land.",
        "🎺 Gambits (an option): once a game each — 📯 Muster (+50% draft), 🛡️ Shield wall (your lands defend as if forted until your next turn), 🎺 Forced march (two fortify moves), ⛵ Storm runner (cross stormy lanes this turn).",
        "🎯 Ambitions (an option): a secret goal each. Fulfil one for +6 troops and a ⭐ banner, then draw another; three fulfilled wins.",
        "💡 The advisor suggests a move and says why; 🧭 lenses show threats to your lands and your progress on each island.",
        "🏁 Dominion (the default goal): start your turn holding two thirds of the map and you win, so when someone gets there, everyone else has one round to break them.",
        "💰 Bounties (an option): each round one of the leader's border lands carries a bounty: take it for +3 troops next draft and a banner.",
        "🔥 Take 3 lands in one turn for a bonus banner.",
        "Or win by ruling every land, or (an option) holding every capital 👑. With a round limit, the most lands wins when time's up. Press and hold a land to see its details.",
    ]
    name = "Realm Wars"
    icon = "⚔️"
    blurb = "Conquer an archipelago: draft troops, roll for battles, hold whole islands for bonuses, brave the storms."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "isles": ("🏝️", "Island lord", "Hold three whole islands at once"),
              "comeback": ("🔥", "Last stand", "Win a battle with one attacking die against two defenders… five times in one game")}
    settings_schema = {
        "map": ("Map", [("isles", "Six Isles · 30 lands"), ("grand", "Grand Archipelago · 44 lands")], "isles"),
        "goal": ("Goal", [("dominion", "🏁 Dominion: hold ⅔ of the map"), ("world", "Rule the whole map"), ("capitals", "Hold every capital 👑")], "dominion"),
        "bounties": ("💰 Bounties", [(True, "On: a price on the leader's land each round"), (False, "Off")], True),
        "start": ("Starting lands", [("deal", "Dealt at random"), ("pick", "Picked in turn")], "deal"),
        "storms": ("⛈️ Storms", [(True, "On: a sea lane closes each round"), (False, "Off")], True),
        "forts": ("🏰 Forts", [(True, "On"), (False, "Off")], True),
        "gambits": ("🎺 Gambits", [(True, "On: four once-a-game moves each"), (False, "Off")], True),
        "ambitions": ("🎯 Ambitions", [(False, "Off"), (True, "On: three secret goals win")], False),
        "rounds": ("Round limit", [(0, "None"), (12, "12 rounds"), (20, "20 rounds")], 20),
        "pace": ("🤖 Bot pace", [(0.3, "Quick"), (0.6, "Relaxed"), (0.15, "Brisk")], 0.3),
    }
    # games saved before these existed
    mapkey = "isles"
    forts = frozenset()
    storms = ()
    placed = ()
    hist = ()
    fort_built = False
    use_forts = False
    use_storms = False
    use_gambits = False
    use_ambitions = False
    shield = frozenset()
    runner = False
    marches = 1
    mustered = False
    drafted = 0
    capital_of = {}
    bounty = None
    use_bounties = False
    pace = 0.45

    @property
    def mp(self):
        return MAPS[self.mapkey]

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.mapkey = self.s.get("map") if self.s.get("map") in MAPS else "isles"
        mp = self.mp
        n = len(seated)
        self.owner = [-1] * mp.n
        self.troops = [0] * mp.n
        self.forts = set()
        self.storms = []
        self.use_storms = bool(self.s.get("storms", True))
        self.use_forts = bool(self.s.get("forts", True))
        self.pace = float(self.s.get("pace", 0.3) or 0.3)
        self.use_gambits = bool(self.s.get("gambits", True))
        self.use_ambitions = bool(self.s.get("ambitions", False))
        self.use_bounties = bool(self.s.get("bounties", True))
        self.bounty = None
        self.shield = set()
        self.runner = False
        self.marches = 1
        self.capital_of = {}
        for p in seated:
            p.g.cards = []
            p.g.taken = 0
            p.g.lone = 0
            p.g.bonus = 0
            p.g.gambits = ([k for k in GAMBITS if k != "runner" or self.use_storms]) if self.use_gambits else []
            p.g.amb = None
            p.g.amb_done = 0
            p.g.turn_taken = 0
        self.goal = self.s.get("goal", "dominion") if self.s.get("goal", "dominion") in GOALS else "dominion"
        self.capitals = None
        self.limit = int(self.s.get("rounds", 20) or 0)
        self.round = 1
        self.trades = 0
        self.roll = None
        self.last = None
        self.ev = 0  # counts events, so screens animate each one once
        self.hist = []
        self.placed = []
        self.pending = None
        self.reserve = 0
        self.conquered = False
        self.fort_built = False
        self.first_claims = {}
        self.room.add_log(f"⚔️ Realm Wars on the {mp.title}: {n} realms, {mp.n} lands, {len(mp.islands)} islands. "
                          f"Goal: {GOALS[self.goal].lower()}" + (f", {self.limit} rounds." if self.limit else "."), "big")
        if self.s.get("start") == "pick":
            self.phase = "claim"
            self.room.add_log("🚩 Pick your lands: one each, in turn, until the map is claimed.", "info")
            self.room.begin_turn(self.seats[0])
            return
        lands = list(range(mp.n))
        rng.shuffle(lands)
        for k, t in enumerate(lands):
            self.owner[t] = k % n
            self.troops[t] = 1
        for s in range(n):
            mine = self.lands_of(s)
            for _ in range(self.leftover(s)):
                self.troops[rng.choice(mine)] += 1
        self.kickoff()

    def leftover(self, s):
        """Starting troops still to place beyond one per land (evens out a map that doesn't split evenly)."""
        n = len(self.seats)
        return max(0, self.mp.start[n] + (self.mp.n // n - len(self.lands_of(s))))

    def kickoff(self, first_claims=None):
        """Lands are out: crown capitals, roll the first storm, start round one."""
        if self.goal == "capitals":
            self.capitals = []
            for s in range(len(self.seats)):
                mine = self.lands_of(s)
                if not mine:
                    continue
                best = first_claims[s] if first_claims and first_claims.get(s) in mine else \
                    max(mine, key=lambda t: (self.troops[t], self.rng.random()))
                self.troops[best] += 2
                self.capitals.append(best)
                self.capital_of = {**self.capital_of, s: best}
                if self.use_forts:
                    self.forts.add(best)
        self.phase = "draft"
        self.hist = [self.counts()]
        if self.use_ambitions:
            for k, pid in enumerate(self.seats):
                q = self.room.players.get(pid)
                if q:
                    self.draw_ambition(q, k)
        self.new_storms()
        self.new_bounty()
        first = next((pid for k, pid in enumerate(self.seats) if self.lands_of(k)
                      and not getattr(self.room.players.get(pid), "eliminated", True)), self.seats[0])
        self.begin(first)

    def counts(self):
        return [len(self.lands_of(k)) for k in range(len(self.seats))]

    def seat(self, p):
        pid = p if isinstance(p, str) else p.id
        return self.seats.index(pid) if pid in self.seats else None

    def lands_of(self, s):
        return [t for t in range(self.mp.n) if self.owner[t] == s]

    def isles_of(self, s):
        return [k for k, ls in enumerate(self.mp.isle_lands) if all(self.owner[t] == s for t in ls)]

    def stormed(self, a, b):
        return not self.runner and [min(a, b), max(a, b)] in self.storms

    def links(self, a):
        return [b for b in self.mp.adj[a] if not self.stormed(a, b)]

    def new_storms(self):
        if not self.use_storms:
            self.storms = []
            return
        lanes = list(self.mp.sea)
        self.rng.shuffle(lanes)
        self.storms = [[min(a, b), max(a, b)] for a, b in lanes[:self.mp.storms]]
        L = self.mp.lands
        text = " and ".join(f"{L[a][0]}–{L[b][0]}" for a, b in self.storms)
        self.room.add_log(f"⛈️ Round {self.round}: a storm closes the {text} lane{'s' if len(self.storms) > 1 else ''}.", "power")

    def new_bounty(self):
        """A price on one of the leader's border lands for this round."""
        if not self.use_bounties:
            self.bounty = None
            return
        counts = self.counts()
        top = max(counts) if counts else 0
        leaders = [k for k, c in enumerate(counts) if c == top and c > 0]
        if not leaders:
            self.bounty = None
            return
        lead = self.rng.choice(leaders)
        border = [t for t in self.lands_of(lead) if any(self.owner[y] not in (lead, -1) for y in self.mp.adj[t])]
        self.bounty = self.rng.choice(border) if border else None
        if self.bounty is not None:
            q = self.room.players.get(self.seats[lead])
            self.room.add_log(f"💰 Round {self.round} bounty: {self.mp.lands[self.bounty][0]} ({q.name if q else '?'}, who leads with {top} lands).", "power")

    def income(self, s):
        n = len(self.lands_of(s))
        inc = max(3, n // 3) + sum(self.mp.islands[k][1] for k in self.isles_of(s))
        if self.capitals:
            inc += sum(2 for c in self.capitals if self.owner[c] == s)
        return inc

    def dominion_need(self):
        return -(-self.mp.n * 2 // 3)  # ceil(n * 2/3)

    def begin(self, pid):
        s = self.seat(pid)
        p = self.room.players[pid]
        if self.goal == "dominion" and len(self.lands_of(s)) >= self.dominion_need():
            self.hist = list(self.hist) + [self.counts()]
            return self.room.finish(p, f"🏁 {p.name} held two thirds of the map for a whole round: dominion!")
        self.phase = "draft"
        self.reserve = self.income(s)
        extra = getattr(p.g, "bonus", 0)
        if extra:
            self.reserve += extra
            p.g.bonus = 0
        self.drafted = self.reserve
        self.pending = None
        self.conquered = False
        self.fort_built = False
        self.placed = []
        self.runner = False
        self.marches = 1
        self.mustered = False
        p.g.turn_taken = 0
        if s in self.shield:
            self.shield = set(self.shield) - {s}
            self.room.add_log(f"🛡️ {p.name}'s shield wall comes down.", "info")
        isl = self.isles_of(s)
        bits = ([', '.join(self.mp.islands[k][0] for k in isl)] if isl else []) + ([f"{extra} starting troops"] if extra else [])
        self.room.add_log(f"🪖 {p.name} drafts {self.reserve} troops" + (f" (incl. {'; '.join(bits)})" if bits else "") + ".", "info")
        self.room.begin_turn(pid)

    # -- actions

    def act(self, p, a):
        self.require_turn(p)
        kind = a.get("type")
        s = self.seat(p)
        if s is None:
            raise GameError("You're watching this game.")
        handler = {"claim": self.do_claim, "trade": self.do_trade, "place": self.do_place, "unplace": self.do_unplace,
                   "fort": self.do_fort, "attack": self.do_attack, "occupy": self.do_occupy,
                   "fortify": self.do_fortify, "stop": self.do_stop, "end": self.do_end, "gambit": self.do_gambit}.get(kind)
        if not handler:
            raise GameError("Unknown action.")
        handler(p, s, a)

    @staticmethod
    def num(a, key, lo, hi):
        v = a.get(key)
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise GameError("Bad move.")
        return v

    def must_trade(self, p):
        return len(p.g.cards) >= 5

    def do_claim(self, p, s, a):
        if self.phase != "claim":
            raise GameError("The lands are already claimed.")
        t = self.num(a, "land", 0, self.mp.n - 1)
        if self.owner[t] != -1:
            raise GameError("That land is taken.")
        self.owner[t] = s
        self.troops[t] = 1
        self.first_claims.setdefault(s, t)
        self.ev += 1
        self.last = {"kind": "claim", "to": t, "ev": self.ev, "by": p.id}
        self.room.add_log(f"🚩 {p.name} claims {self.mp.lands[t][0]}.", "question")
        if -1 in self.owner:
            return self.next_claimer(s)
        for k, pid in enumerate(self.seats):
            q = self.room.players.get(pid)
            if q:
                q.g.bonus = self.leftover(k)
        self.room.add_log("🗺️ Every land is claimed. Starting troops arrive with each first draft.", "big")
        self.kickoff(self.first_claims)

    def next_claimer(self, s):
        n = len(self.seats)
        for k in range(1, n + 1):
            q = self.room.players.get(self.seats[(s + k) % n])
            if q and not q.eliminated:
                return self.room.begin_turn(q.id)

    def do_trade(self, p, s, a):
        if self.phase != "draft":
            raise GameError("Trade banners while drafting.")
        pick = find_set(p.g.cards)
        if pick is None:
            raise GameError("You don't have a set to trade.")
        got = trade_value(self.trades)
        self.trades += 1
        shown = " ".join(KINDS[p.g.cards[i]] for i in pick)
        for i in sorted(pick, reverse=True):
            p.g.cards.pop(i)
        self.reserve += got
        self.placed = []  # a trade can't be taken back, nor anything placed before it
        self.room.add_log(f"🎴 {p.name} trades {shown} for {got} troops.", "power")
        if got >= 12:
            self.moment(f"🎴 {p.name} cashes in banners for {got} troops!", "gold", "chip")

    def do_place(self, p, s, a):
        if self.phase != "draft":
            raise GameError("You're not drafting now.")
        if self.must_trade(p):
            raise GameError("You hold 5 banners: trade a set first.")
        t = self.num(a, "land", 0, self.mp.n - 1)
        n = self.num(a, "n", 1, 999)
        if self.owner[t] != s:
            raise GameError("Place troops on your own lands.")
        n = min(n, self.reserve)
        self.troops[t] += n
        self.reserve -= n
        self.placed = list(self.placed) + [["place", t, n]]
        self.ev += 1
        self.last = {"kind": "place", "to": t, "n": n, "ev": self.ev, "by": p.id}
        self.room.add_log(f"➕ {p.name} places {n} on {self.mp.lands[t][0]}.", "question")
        if not self.reserve:
            self.phase = "attack"

    def do_fort(self, p, s, a):
        if not self.use_forts:
            raise GameError("Forts are off in this game.")
        if self.phase != "draft":
            raise GameError("Build forts while drafting.")
        if self.must_trade(p):
            raise GameError("You hold 5 banners: trade a set first.")
        if self.fort_built:
            raise GameError("One fort per turn.")
        t = self.num(a, "land", 0, self.mp.n - 1)
        if self.owner[t] != s:
            raise GameError("Fort one of your own lands.")
        if t in self.forts:
            raise GameError("That land already has a fort.")
        if self.reserve < FORT_COST:
            raise GameError(f"A fort costs {FORT_COST} troops from your draft.")
        self.forts = set(self.forts) | {t}
        self.reserve -= FORT_COST
        self.fort_built = True
        self.placed = list(self.placed) + [["fort", t, FORT_COST]]
        self.ev += 1
        self.last = {"kind": "fort", "to": t, "ev": self.ev, "by": p.id}
        self.room.add_log(f"🏰 {p.name} builds a fort on {self.mp.lands[t][0]}.", "power")
        if not self.reserve:
            self.phase = "attack"
        self.check_ambition(p, s)

    def do_unplace(self, p, s, a):
        if self.phase not in ("draft", "attack") or not self.placed:
            raise GameError("Nothing to take back.")
        kind, t, n = self.placed[-1]
        self.placed = list(self.placed[:-1])
        if kind == "fort":
            self.forts = set(self.forts) - {t}
            self.fort_built = False
        else:
            self.troops[t] -= n
        self.reserve += n
        self.phase = "draft"
        self.ev += 1
        self.last = {"kind": "unplace", "to": t, "n": n, "ev": self.ev, "by": p.id}
        what = f"the fort on {self.mp.lands[t][0]}" if kind == "fort" else f"{n} from {self.mp.lands[t][0]}"
        self.room.add_log(f"↶ {p.name} takes back {what}.", "question")

    def do_attack(self, p, s, a):
        if self.phase != "attack":
            raise GameError("You can't attack now.")
        f = self.num(a, "from", 0, self.mp.n - 1)
        t = self.num(a, "to", 0, self.mp.n - 1)
        if self.owner[f] != s or self.troops[f] < 2:
            raise GameError("Attack from your own land with 2 or more troops.")
        if self.owner[t] == s or t not in self.mp.adj[f]:
            raise GameError("Attack a neighbouring rival land.")
        if self.stormed(f, t):
            raise GameError("⛈️ A storm closes that sea lane this round.")
        self.battle(p, s, f, t, bool(a.get("blitz")))

    def battle(self, p, s, f, t, blitz):
        r = self.room
        L = self.mp.lands
        self.placed = []
        d_seat = self.owner[t]
        q = r.players.get(self.seats[d_seat]) if d_seat >= 0 else None
        fort = t in self.forts or d_seat in self.shield
        a0, d0 = self.troops[f], self.troops[t]
        lost_a = lost_d = rolls = 0
        seq = []
        while True:
            na, nd = min(3, self.troops[f] - 1), min(2, self.troops[t])
            at = sorted((self.rng.randint(1, 6) for _ in range(na)), reverse=True)
            de = sorted((self.rng.randint(1, 6) for _ in range(nd)), reverse=True)
            la, ld = resolve(at, de, fort)
            self.troops[f] -= la; self.troops[t] -= ld
            lost_a += la; lost_d += ld; rolls += 1
            seq = (seq + [[at, de, la, ld]])[-12:]
            if na == 1 and nd == 2 and ld:
                p.g.lone += 1
                if p.g.lone == 5:
                    self.award(p, "comeback")
            if self.troops[t] == 0 or self.troops[f] < 2 or not blitz:
                break
        self.ev += 1
        won = self.troops[t] == 0
        self.roll = {"ev": self.ev, "from": f, "to": t, "a": at, "d": de, "la": lost_a, "ld": lost_d, "rolls": rolls,
                     "by": p.id, "vs": q.id if q else None, "won": won, "fort": fort,
                     "shield": d_seat in self.shield, "seq": seq, "a0": a0, "d0": d0}
        self.last = {"kind": "attack", "from": f, "to": t, "ev": self.ev, "by": p.id}
        how = f"{rolls} rolls" if rolls > 1 else f"{''.join('⚀⚁⚂⚃⚄⚅'[x - 1] for x in at)} vs {''.join('⚀⚁⚂⚃⚄⚅'[x - 1] for x in de)}"
        r.add_log(f"⚔️ {p.name} → {L[t][0]} ({q.name if q else 'unclaimed'}{', 🏰' if fort else ''}): {how}, lost {lost_a}, killed {lost_d}"
                  + (" — taken!" if won else "."), "power" if won else "question")
        if not won:
            return
        # conquest: the land is ours; troops move in (at least as many as the dice just rolled)
        self.owner[t] = s
        self.conquered = True
        p.g.taken += 1
        p.g.turn_taken = getattr(p.g, "turn_taken", 0) + 1
        if self.bounty == t:
            self.bounty = None
            p.g.bonus = getattr(p.g, "bonus", 0) + BOUNTY_TROOPS
            p.g.cards.append(self.rng.randrange(3))
            self.moment(f"💰 {p.name} claims the bounty on {L[t][0]}: +{BOUNTY_TROOPS} troops next draft and a banner!", "gold", "chip")
        n_taken = p.g.turn_taken
        if n_taken == 3:
            p.g.cards.append(self.rng.randrange(3))
            self.moment(f"🔥 {p.name} is on a rampage: three lands this turn, a bonus banner!", "gold", "fanfare")
        elif n_taken == 5:
            self.moment(f"⚡ {p.name} is unstoppable: five lands in one turn!", "gold", "fanfare")
        elif n_taken == 2:
            r.add_log(f"⚔️⚔️ {p.name}: a double conquest!", "big")
        if t in self.forts:
            self.forts = set(self.forts) - {t}
            r.add_log(f"🏰 The fort on {L[t][0]} falls.", "info")
        lo, hi = min(na, self.troops[f] - 1), self.troops[f] - 1
        if self.capitals and t in self.capitals:
            self.moment(f"👑 {p.name} seizes the capital {L[t][0]}!", "gold", "capture")
        isle = L[t][1]
        if all(self.owner[x] == s for x in self.mp.isle_lands[isle]):
            self.moment(f"🏝️ {p.name} holds all of {self.mp.islands[isle][0]} (+{self.mp.islands[isle][1]})", "good", "fanfare")
            if len(self.isles_of(s)) >= 3:
                self.award(p, "isles")
        if q and not self.lands_of(d_seat):
            self.knock_out(p, q)
            if r.phase != "playing":
                return
        if self.check_win(p, s):
            return
        if self.check_ambition(p, s):
            return
        if lo >= hi:
            self.move_in(p, f, t, hi)
        else:
            self.phase = "occupy"
            self.pending = {"from": f, "to": t, "min": lo, "max": hi}

    def move_in(self, p, f, t, n):
        self.troops[f] -= n
        self.troops[t] += n
        self.ev += 1
        self.last = {"kind": "move", "from": f, "to": t, "n": n, "ev": self.ev, "by": p.id}
        self.after_move(p)

    def knock_out(self, p, q):
        q.eliminated = True
        got = q.g.cards
        p.g.cards += got
        q.g.cards = []
        self.moment(f"💀 {p.name} wipes {q.name} off the map" + (f" and takes {len(got)} banners" if got else "") + "!", "bad", "capture")

    def check_win(self, p, s):
        r = self.room
        alive = [k for k in range(len(self.seats)) if self.lands_of(k)]
        won = alive == [s] and f"🏆 {p.name} rules all {self.mp.n} lands!"
        if not won and self.capitals and all(self.owner[c] == s for c in self.capitals):
            won = f"👑 {p.name} holds every capital and wins!"
        if won:
            self.hist = list(self.hist) + [self.counts()]
            r.finish(p, won)
            return True
        return False

    def after_move(self, p):
        self.pending = None
        if len(p.g.cards) >= 6:  # a knockout's banners: trade now and place the troops
            self.phase = "draft"
            self.reserve = 0
            self.room.add_log(f"🎴 {p.name} holds {len(p.g.cards)} banners and must trade now.", "info")
        else:
            self.phase = "attack"

    def do_occupy(self, p, s, a):
        if self.phase != "occupy":
            raise GameError("Nothing to move in.")
        pd = self.pending
        n = self.num(a, "n", pd["min"], pd["max"])
        self.room.add_log(f"🚶 {p.name} moves {n} into {self.mp.lands[pd['to']][0]}.", "question")
        self.move_in(p, pd["from"], pd["to"], n)

    def do_stop(self, p, s, a):
        if self.phase != "attack":
            raise GameError("You're not attacking.")
        self.placed = []
        self.phase = "fortify"

    def reach(self, s, f):
        seen, todo = {f}, [f]
        while todo:
            x = todo.pop()
            for y in self.links(x):
                if y not in seen and self.owner[y] == s:
                    seen.add(y); todo.append(y)
        seen.discard(f)
        return seen

    def do_fortify(self, p, s, a):
        if self.phase not in ("attack", "fortify"):
            raise GameError("You can't fortify now.")
        f = self.num(a, "from", 0, self.mp.n - 1)
        t = self.num(a, "to", 0, self.mp.n - 1)
        n = self.num(a, "n", 1, 999)
        if self.owner[f] != s or self.owner[t] != s or t not in self.reach(s, f):
            raise GameError("Move between your own joined lands.")
        if n > self.troops[f] - 1:
            raise GameError("One troop must stay behind.")
        self.troops[f] -= n
        self.troops[t] += n
        self.ev += 1
        self.last = {"kind": "fortify", "from": f, "to": t, "n": n, "ev": self.ev, "by": p.id}
        self.room.add_log(f"🛡️ {p.name} fortifies {self.mp.lands[t][0]} with {n} from {self.mp.lands[f][0]}.", "question")
        self.placed = []
        self.marches -= 1
        if self.marches > 0:
            self.phase = "fortify"
            return
        self.end_turn(p)

    def do_end(self, p, s, a):
        if self.phase not in ("attack", "fortify"):
            raise GameError("Place your troops first.")
        self.end_turn(p)

    def end_turn(self, p):
        r = self.room
        self.placed = []
        s0 = self.seat(p)
        if s0 is not None and not p.eliminated and self.check_ambition(p, s0):
            return
        self.runner = False
        if self.goal == "dominion" and s0 is not None and len(self.lands_of(s0)) >= self.dominion_need():
            self.moment(f"⚠️ {p.name} holds two thirds of the map! Break their hold before their next turn or they win.", "bad", "alarm")
        if self.conquered:
            card = 3 if self.rng.random() < 0.08 else self.rng.randrange(3)
            p.g.cards.append(card)
            r.add_log(f"🎴 {p.name} earns a banner.", "info")
            r.add_log(f"🎴 Your new banner: {KINDS[card]}", "private", to=p.id)
        s = self.seat(p)
        order = len(self.seats)
        for k in range(1, order + 1):
            nxt = (s + k) % order
            q = r.players.get(self.seats[nxt])
            if q and not q.eliminated and self.lands_of(nxt):
                if s + k >= order:  # back round to the first seat: a new round
                    self.round += 1
                    self.hist = list(self.hist) + [self.counts()]
                    if self.round > (self.limit or ROUND_CAP):
                        return self.time_up()
                    if self.limit and self.round == self.limit:
                        r.add_log("⏳ Last round! The most lands wins.", "big")
                    self.new_storms()
                    self.new_bounty()
                return self.begin(q.id)
        r.finish(p, f"🏆 {p.name} wins!")

    def time_up(self):
        r = self.room
        def key(k):
            return (len(self.lands_of(k)), sum(self.troops[t] for t in self.lands_of(k)))
        best = max(range(len(self.seats)), key=key)
        w = r.players.get(self.seats[best])
        n, tr = key(best)
        r.finish(w, f"⏳ Time's up! {w.name if w else '?'} holds the most lands ({n}, {tr} troops) and wins.")

    # -- gambits: once-a-game moves

    def do_gambit(self, p, s, a):
        name = a.get("name")
        if not self.use_gambits:
            raise GameError("Gambits are off in this game.")
        if name not in GAMBITS or name not in getattr(p.g, "gambits", []):
            raise GameError("You don't hold that gambit any more.")
        if self.phase in ("claim", "occupy"):
            raise GameError("Not now.")
        L = self.mp.lands
        if name == "muster":
            if self.phase != "draft" or self.mustered:
                raise GameError("Muster while drafting.")
            extra = math.ceil(self.drafted * 0.5)
            self.reserve += extra
            self.mustered = True
            self.placed = []
            text = f"📯 {p.name} musters {extra} more troops!"
        elif name == "shield":
            self.shield = set(self.shield) | {s}
            text = f"🛡️ {p.name} raises a shield wall: every land defends as if forted until their next turn!"
        elif name == "march":
            if self.phase not in ("draft", "attack", "fortify"):
                raise GameError("Call a forced march before you fortify.")
            self.marches = 2
            text = f"🎺 {p.name} calls a forced march: two fortify moves this turn."
        else:  # runner
            if not self.storms:
                raise GameError("There's no storm to run.")
            self.runner = True
            lanes = ", ".join(f"{L[x][0]}–{L[y][0]}" for x, y in self.storms)
            text = f"⛵ {p.name} runs the storm: {lanes} is open to them this turn!"
        p.g.gambits = [g for g in p.g.gambits if g != name]
        self.ev += 1
        self.last = {"kind": "gambit", "name": name, "ev": self.ev, "by": p.id}
        self.moment(text, "cool", "whoosh")

    # -- ambitions: secret goals; three fulfilled wins

    def draw_ambition(self, p, s):
        mp = self.mp
        pool = [{"kind": "isle", "k": k} for k, (nm, b, _c) in enumerate(mp.islands) if b >= 3]
        pool += [{"kind": "lands", "n": math.ceil(0.45 * mp.n)},
                 {"kind": "spread", "n": 5 if len(mp.islands) <= 6 else 6},
                 {"kind": "spree", "n": 4}]
        if self.use_forts:
            pool.append({"kind": "forts", "n": 3})
        if self.capitals and len(self.capitals) > 1:
            pool.append({"kind": "capital"})
        old = getattr(p.g, "amb", None)
        pool = [a for a in pool if not old or a["kind"] != old["kind"]] or pool
        p.g.amb = self.rng.choice(pool)

    def amb_text(self, a):
        mp = self.mp
        k = a["kind"]
        if k == "isle":
            nm, b, _c = mp.islands[a["k"]]
            return f"Hold all of {nm}"
        return {"lands": f"Hold {a.get('n')} lands", "spread": f"Hold lands on {a.get('n')} islands",
                "spree": f"Take {a.get('n')} lands in one turn", "forts": f"Hold {a.get('n')} forts",
                "capital": "Hold a rival's capital 👑"}[k]

    def amb_progress(self, p, s, a):
        mp = self.mp
        k = a["kind"]
        if k == "isle":
            ls = mp.isle_lands[a["k"]]
            return sum(1 for t in ls if self.owner[t] == s), len(ls)
        if k == "lands":
            return len(self.lands_of(s)), a["n"]
        if k == "spread":
            return len({mp.lands[t][1] for t in self.lands_of(s)}), a["n"]
        if k == "spree":
            return getattr(p.g, "turn_taken", 0), a["n"]
        if k == "forts":
            return sum(1 for t in self.forts if self.owner[t] == s), a["n"]
        own = self.capital_of.get(s)
        return min(1, sum(1 for c in (self.capitals or []) if c != own and self.owner[c] == s)), 1

    def check_ambition(self, p, s):
        """Fulfilled? Reward, draw the next, and return True if that wins the game."""
        a = getattr(p.g, "amb", None) if self.use_ambitions else None
        if not a:
            return False
        have, need = self.amb_progress(p, s, a)
        if have < need:
            return False
        p.g.amb_done = getattr(p.g, "amb_done", 0) + 1
        self.ev += 1
        self.last = {"kind": "ambition", "ev": self.ev, "by": p.id, "n": p.g.amb_done}
        if p.g.amb_done >= AMBITIONS_TO_WIN:
            self.hist = list(self.hist) + [self.counts()]
            self.room.finish(p, f"🎯 {p.name} fulfils a third ambition ({self.amb_text(a).lower()}) and wins!")
            return True
        p.g.bonus = getattr(p.g, "bonus", 0) + AMBITION_REWARD
        p.g.cards.append(3)
        self.moment(f"🎯 {p.name} fulfils an ambition: {self.amb_text(a)}! (+{AMBITION_REWARD} troops next draft, ⭐ banner · {p.g.amb_done}/{AMBITIONS_TO_WIN})", "gold", "fanfare")
        self.draw_ambition(p, s)
        self.room.add_log(f"🎯 Your next ambition: {self.amb_text(p.g.amb)}", "private", to=p.id)
        return False

    # -- the advisor: the hard bot's reasoning, in words

    def reasons(self, s, t, pw):
        mp = self.mp
        r = self.room
        out = []
        o = self.owner[t]
        isle = mp.lands[t][1]
        nm, bonus, _c = mp.islands[isle]
        if [x for x in mp.isle_lands[isle] if self.owner[x] != s] == [t]:
            out.append(f"completes {nm} (+{bonus} a turn)")
        if o >= 0 and all(self.owner[x] == o for x in mp.isle_lands[isle]):
            q = r.players.get(self.seats[o])
            out.append(f"breaks {q.name if q else '?'}'s hold on {nm}")
        if o >= 0 and len(self.lands_of(o)) == 1:
            q = r.players.get(self.seats[o])
            n = len(getattr(q.g, "cards", [])) if q else 0
            out.append(f"knocks {q.name if q else '?'} out" + (f": their {n} banners are yours" if n else ""))
        if self.capitals and t in self.capitals:
            out.append("seizes a capital 👑")
        if self.bounty == t:
            out.append(f"claims the 💰 bounty (+{BOUNTY_TROOPS} troops and a banner)")
        if self.goal == "dominion" and o >= 0 and len(self.lands_of(o)) >= self.dominion_need() - 1:
            q = r.players.get(self.seats[o])
            out.append(f"stops {q.name if q else '?'} reaching dominion")
        if not self.conquered:
            out.append("your first land this turn earns a banner")
        if t in self.forts or o in self.shield:
            out.append("🏰 they get +1 on defence")
        out.append(f"{round(pw * 100)}% to take it")
        text = " · ".join(out)
        return text[:1].upper() + text[1:]

    def plan_draft(self, s):
        """(land, attack target or None, odds) for stacking the whole draft, as the hard bot would."""
        opts = self.attack_options(s, "hard")
        if opts:
            def after(o):
                _, _, f, tt = o
                return win_chance(self.troops[f] - 1 + self.reserve, self.troops[tt], self.def_bonus(tt)) + o[0] - o[1]
            best = max(opts, key=after)
            f, tt = best[2], best[3]
            return f, tt, win_chance(self.troops[f] - 1 + self.reserve, self.troops[tt], self.def_bonus(tt))
        return self.best_front(s, quiet=True), None, 0

    def def_bonus(self, t):
        return t in self.forts or self.owner[t] in self.shield

    def gambit_hint(self, p, s):
        have = getattr(p.g, "gambits", []) if self.use_gambits else []
        if not have:
            return None
        front = [t for t in self.lands_of(s) if self.threat(s, t) > 0]
        if "shield" in have and s not in self.shield and self.phase in ("attack", "fortify") and front \
                and self.round >= 3 and len(self.lands_of(s)) >= 5:
            if sum(self.threat(s, t) for t in front) > 2.0 * sum(self.troops[t] for t in front):
                return {"name": "shield", "why": "Your borders face far more troops than they hold: a shield wall buys a round."}
        if "muster" in have and self.phase == "draft" and not self.mustered and self.drafted >= 6:
            f, tt, pw = self.plan_draft(s)
            if tt is not None and pw >= 0.6:
                return {"name": "muster", "why": f"A big draft and a good target ({self.mp.lands[tt][0]}): muster now for {math.ceil(self.drafted * 0.5)} more."}
        if "runner" in have and self.storms and not self.runner and self.phase in ("draft", "attack"):
            for a_, b_ in self.storms:
                for f, t in ((a_, b_), (b_, a_)):
                    if self.owner[f] == s and self.owner[t] != s and self.troops[f] >= 4 and \
                            win_chance(self.troops[f] - 1, self.troops[t], self.def_bonus(t)) >= 0.7:
                        return {"name": "runner", "why": f"The storm shields {self.mp.lands[t][0]}, but you'd win {round(100 * win_chance(self.troops[f] - 1, self.troops[t], self.def_bonus(t)))}%: run it."}
        if "march" in have and self.marches < 2 and self.phase in ("attack", "fortify"):
            inner = [t for t in self.lands_of(s) if self.troops[t] > 2 and self.threat(s, t) == 0]
            if len(inner) >= 2:
                return {"name": "march", "why": "Two stacks sit idle inland: a forced march brings both to the front."}
        return None

    def advice(self, p, s):
        """A suggestion for the player whose turn it is, with the reason in words."""
        mp = self.mp
        L = mp.lands
        ph = self.phase
        if ph == "claim":
            t = self.best_claim(s, "advice")
            k = L[t][1]
            have = sum(1 for x in mp.isle_lands[k] if self.owner[x] == s)
            return {"kind": "claim", "land": t, "why": f"Builds toward {mp.islands[k][0]} (+{mp.islands[k][1]}): you hold {have}/{len(mp.isle_lands[k])}."}
        if ph == "draft":
            if self.must_trade(p):
                return {"kind": "trade", "why": "You hold 5 banners: trade a set first."}
            if find_set(p.g.cards) and (len(p.g.cards) >= 4 or self.trades >= 3):
                return {"kind": "trade", "why": f"A set is worth {trade_value(self.trades)} troops now."}
            if self.use_forts and not self.fort_built and self.reserve >= 6:
                t = self.fort_spot(s)
                if t is not None:
                    return {"kind": "fort", "land": t, "why": f"{L[t][0]} guards {mp.islands[L[t][1]][0]} and {self.threat(s, t)} enemy troops can reach it: fort it."}
            f, tt, pw = self.plan_draft(s)
            if tt is not None:
                return {"kind": "place", "land": f, "n": self.reserve, "to": tt,
                        "why": f"Stack all {self.reserve} on {L[f][0]} to strike {L[tt][0]}: " + self.reasons(s, tt, pw)[0].lower() + self.reasons(s, tt, pw)[1:]}
            return {"kind": "place", "land": f, "n": self.reserve, "why": f"{L[f][0]} is your most pressed border ({self.threat(s, f)} enemy troops can reach it)."}
        if ph == "attack":
            opts = self.attack_options(s, "hard")
            good = [o for o in opts if o[0] >= 0.7]
            if good:
                sc, pw, f, t = max(good)
                return {"kind": "attack", "from": f, "to": t, "odds": round(pw * 100), "why": self.reasons(s, t, pw)}
            best = max((o[1] for o in opts), default=0)
            return {"kind": "stop", "why": (f"The best odds left are {round(best * 100)}%: time to fortify." if opts else "No attacks left from here: time to fortify.")}
        if ph == "occupy" and self.pending:
            pd = self.pending
            f, t = pd["from"], pd["to"]
            if self.threat(s, f) == 0:
                return {"kind": "occupy", "n": pd["max"], "why": f"Nothing threatens {L[f][0]} any more: move everyone forward."}
            tf, tt = self.threat(s, f) + 1, self.threat(s, t) + 1
            n = max(pd["min"], min(pd["max"], round((self.troops[f] - 1) * tt / (tf + tt))))
            return {"kind": "occupy", "n": n, "why": f"Split by the danger on each side: {L[f][0]} still faces {self.threat(s, f)}, {L[t][0]} faces {self.threat(s, t)}."}
        if ph == "fortify":
            inner = [t for t in self.lands_of(s) if self.troops[t] > 1 and self.threat(s, t) == 0]
            if inner:
                f = max(inner, key=lambda t: self.troops[t])
                dest = [t for t in self.reach(s, f) if self.threat(s, t) > 0]
                if dest:
                    t = max(dest, key=lambda x: self.threat(s, x) - self.troops[x])
                    return {"kind": "fortify", "from": f, "to": t, "n": self.troops[f] - 1,
                            "why": f"{self.troops[f] - 1} troops sit idle on {L[f][0]}; {L[t][0]} faces {self.threat(s, t)} enemy troops."}
            return {"kind": "end", "why": "Nothing idle to move: end your turn."}
        return None

    # -- timer and leaving

    def on_timeout(self):
        r = self.room
        p = r.players[r.turn]
        r.add_log(f"⏰ {p.name} ran out of time!", "power")
        self.autopilot(p)

    def autopilot(self, p):
        """Wrap up the turn of someone who ran out of time: claim, place leftovers, settle a move-in, end."""
        s = self.seat(p)
        for _ in range(20):
            if self.room.phase != "playing" or self.room.turn != p.id:
                return
            if self.phase == "claim":
                return self.do_claim(p, s, {"land": self.best_claim(s, "normal")})
            if self.phase == "draft":
                if self.must_trade(p) or (find_set(p.g.cards) and self.reserve == 0):
                    self.do_trade(p, s, {})
                    continue
                t = self.best_front(s)
                self.do_place(p, s, {"land": t, "n": self.reserve})
            elif self.phase == "occupy":
                self.do_occupy(p, s, {"n": self.pending["max"]})
            else:
                return self.end_turn(p)

    def on_leave(self, p):
        r = self.room
        s = self.seat(p)
        r.add_log(f"{p.name} left the game.")
        was_turn = r.turn == p.id
        p.eliminated = True
        left = [o for o in r.contenders() if o.id != p.id]
        if len(left) == 1:
            return r.finish(left[0], f"🏳️ {p.name} left — {left[0].name} wins!")
        if not left:
            return r.finish(None, "Everyone left.")
        if s is not None:
            for t in self.lands_of(s):
                if self.phase == "claim":  # back into the pool
                    self.owner[t] = -1
                    self.troops[t] = 0
                else:  # unclaimed garrisons nobody moves
                    self.owner[t] = -1
        if was_turn:
            if self.phase == "claim":
                return self.next_claimer(s)
            self.conquered = False
            self.end_turn(p)

    # -- views

    def meta(self, p):
        s = self.seat(p)
        if s is None or not hasattr(self, "owner"):
            return ""
        lands = self.lands_of(s)
        if self.phase == "claim":
            return f"{len(lands)} lands"
        if not lands:
            return "💀 out"
        return f"{len(lands)} lands · {sum(self.troops[t] for t in lands)} troops · 🎴{len(getattr(p.g, 'cards', []))}"

    def final_scores(self):
        return {pid: len(self.lands_of(k)) for k, pid in enumerate(self.seats)}

    def view(self, p):
        s = self.seat(p)
        r = self.room
        hand = list(getattr(p.g, "cards", [])) if s is not None else []
        cards = [len(getattr(r.players[pid].g, "cards", [])) if pid in r.players else 0 for pid in self.seats]
        mine = r.turn == p.id and s is not None
        claiming = self.phase == "claim"
        return {"realm": {
            "map": self.mp.view, "owner": self.owner, "troops": self.troops, "seats": self.seats, "me": s,
            "phase": self.phase, "reserve": self.reserve, "pending": self.pending if mine else None,
            "hand": hand, "cards": cards, "canTrade": bool(find_set(hand)), "mustTrade": len(hand) >= 5,
            "tradeValue": trade_value(self.trades), "roll": self.roll, "last": self.last,
            "capitals": self.capitals, "goal": self.goal, "round": self.round, "limit": self.limit,
            "income": [0 if claiming else self.income(k) for k in range(len(self.seats))],
            "isles": [[k for k, ls in enumerate(self.mp.isle_lands) if all(self.owner[t] == j for t in ls)] for j in range(len(self.seats))],
            "conquered": self.conquered, "forts": sorted(self.forts), "storms": list(self.storms),
            "fortsOn": bool(self.use_forts), "fortCost": FORT_COST, "fortBuilt": self.fort_built,
            "canUndo": bool(self.placed) and mine, "hist": list(self.hist),
            "bounty": self.bounty, "bountyTroops": BOUNTY_TROOPS,
            "dominion": self.dominion_need() if self.goal == "dominion" else None,
            "gambitsOn": bool(self.use_gambits), "runner": self.runner, "marches": self.marches, "mustered": self.mustered,
            "gambits": [list(getattr(r.players[pid].g, "gambits", [])) if pid in r.players else [] for pid in self.seats],
            "shield": sorted(self.shield),
            "ambitionsOn": bool(self.use_ambitions),
            "ambDone": [getattr(r.players[pid].g, "amb_done", 0) if pid in r.players else 0 for pid in self.seats],
            "ambition": self.amb_view(p, s),
            "advice": self.advice(p, s) if mine and r.phase == "playing" and r.hints_ok() else None,
            "gambitHint": self.gambit_hint(p, s) if mine and r.phase == "playing" and self.phase != "claim" and r.hints_ok() else None,
        }}

    def amb_view(self, p, s):
        a = getattr(p.g, "amb", None) if self.use_ambitions and s is not None else None
        if not a:
            return None
        have, need = self.amb_progress(p, s, a)
        return {"text": self.amb_text(a), "have": have, "need": need, "done": getattr(p.g, "amb_done", 0), "of": AMBITIONS_TO_WIN}

    # -- bot: one decision per call

    def threat(self, s, t):
        """Enemy troops that can reach land t this round."""
        return sum(self.troops[y] - 1 for y in self.links(t) if self.owner[y] not in (s, -1))

    def best_front(self, s, quiet=False):
        mine = self.lands_of(s)
        front = [t for t in mine if any(self.owner[y] != s for y in self.links(t))] or mine
        return max(front, key=lambda t: (self.threat(s, t) - self.troops[t] + self.island_pull(s, t), 0 if quiet else self.rng.random(), -t))

    def island_pull(self, s, t):
        """How much land t helps toward an island: more when the island is nearly ours."""
        mp = self.mp
        best = 0
        for k in {mp.lands[t][1]} | {mp.lands[y][1] for y in mp.adj[t]}:
            ls = mp.isle_lands[k]
            have = sum(1 for x in ls if self.owner[x] == s)
            if have < len(ls):
                best = max(best, 6 * have / len(ls) + mp.islands[k][1] - (len(ls) - have))
        return best

    def best_claim(self, s, level):
        mp = self.mp
        free = [t for t in range(mp.n) if self.owner[t] == -1]
        if level == "easy":
            return self.rng.choice(free)
        def score(t):
            k = mp.lands[t][1]
            ls = mp.isle_lands[k]
            mine = sum(1 for x in ls if self.owner[x] == s)
            theirs = sum(1 for x in ls if self.owner[x] not in (s, -1))
            near = sum(1 for y in mp.adj[t] if self.owner[y] == s)
            noise = 0 if level == "advice" else self.rng.random() * (0.5 if level == "hard" else 2)
            return 3 * mine - 2.5 * theirs + near + mp.islands[k][1] / len(ls) * 2 + noise
        return max(free, key=lambda t: (score(t), -t))

    def fort_spot(self, s):
        """A threatened land guarding an island we hold (or nearly hold), worth a fort."""
        best, best_v = None, 0
        for t in self.lands_of(s):
            if t in self.forts:
                continue
            th = self.threat(s, t)
            if th < 2:
                continue
            ls = self.mp.isle_lands[self.mp.lands[t][1]]
            missing = sum(1 for x in ls if self.owner[x] != s)
            if missing > 1:
                continue
            v = th + (3 if missing == 0 else 0) + (4 if self.capitals and t in self.capitals else 0)
            if v > best_v:
                best, best_v = t, v
        return best

    def ambition_pull(self, s, t):
        """A nudge toward the attacker's own secret ambition (bots only know their own)."""
        if not self.use_ambitions:
            return 0.0
        q = self.room.players.get(self.seats[s])
        a = getattr(q.g, "amb", None) if q else None
        if not a:
            return 0.0
        k = a["kind"]
        isle = self.mp.lands[t][1]
        if k == "isle":
            return 0.15 if isle == a["k"] else 0.0
        if k == "spread":
            return 0.15 if not any(self.owner[x] == s for x in self.mp.isle_lands[isle]) else 0.0
        if k == "capital":
            return 0.2 if self.capitals and t in self.capitals and self.capital_of.get(s) != t else 0.0
        return 0.05 if k in ("lands", "spree") else 0.0

    def attack_options(self, s, level):
        mp = self.mp
        out = []
        for f in self.lands_of(s):
            if self.troops[f] < 2:
                continue
            for t in self.links(f):
                o = self.owner[t]
                if o == s:
                    continue
                pw = win_chance(self.troops[f] - 1, self.troops[t], self.def_bonus(t))
                gain = 0.0
                isle = mp.lands[t][1]
                missing = [x for x in mp.isle_lands[isle] if self.owner[x] != s]
                if missing == [t]:
                    gain += 0.25
                if o >= 0 and all(self.owner[x] == o for x in mp.isle_lands[isle]):
                    gain += 0.15  # break a rival's island
                if o >= 0 and len(self.lands_of(o)) == 1:
                    gain += 0.3
                if self.capitals and t in self.capitals:
                    gain += 0.3
                if not self.conquered:
                    gain += 0.1  # a banner is waiting for the first land taken
                gain += self.ambition_pull(s, t)
                if self.bounty == t:
                    gain += 0.25
                if self.goal == "dominion" and o >= 0 and len(self.lands_of(o)) >= self.dominion_need() - 1:
                    gain += 0.35  # they're about to win: break their hold
                out.append((pw + gain, pw, f, t))
        return out

    def bot_turn(self, p):
        s = self.seat(p)
        lvl = p.bot or "normal"
        rng = self.rng
        self.room.bot_at = time.time() + (self.pace * 0.8 if self.phase in ("draft", "claim") else self.pace)
        if self.phase not in ("claim", "occupy") and self.use_gambits and getattr(p.g, "gambits", None):
            hint = self.gambit_hint(p, s)
            if hint and (lvl != "easy" or rng.random() < 0.25):
                return self.do_gambit(p, s, {"name": hint["name"]})
        if self.phase == "claim":
            return self.do_claim(p, s, {"land": self.best_claim(s, lvl)})
        if self.phase == "draft":
            if self.must_trade(p) or (find_set(p.g.cards) and (lvl != "hard" or self.trades >= 3 or len(p.g.cards) >= 4)):
                return self.do_trade(p, s, {})
            if self.use_forts and not self.fort_built and self.reserve >= FORT_COST:
                want = (lvl != "easy" and self.reserve >= 6) or (lvl == "easy" and rng.random() < 0.1)
                spot = self.fort_spot(s) if want else None
                if spot is not None:
                    return self.do_fort(p, s, {"land": spot})
            if lvl == "easy":
                t = rng.choice([t for t in self.lands_of(s) if any(self.owner[y] != s for y in self.links(t))] or self.lands_of(s))
                n = rng.randint(1, self.reserve)
            else:
                # stack on the land with the best attack (hard) or the most pressing front (normal)
                opts = self.attack_options(s, lvl)
                t = None
                if lvl == "hard" and opts:
                    def after(o):
                        _, _, f, tt = o
                        return win_chance(self.troops[f] - 1 + self.reserve, self.troops[tt], tt in self.forts) + o[0] - o[1]
                    t = max(opts, key=after)[2]
                t = t if t is not None else self.best_front(s)
                n = self.reserve if lvl == "hard" or self.reserve <= 3 else max(1, (self.reserve + 1) // 2)
            return self.do_place(p, s, {"land": t, "n": n})
        if self.phase == "occupy":
            pd = self.pending
            f, t = pd["from"], pd["to"]
            if self.threat(s, f) == 0:
                n = pd["max"]
            elif lvl == "easy":
                n = rng.randint(pd["min"], pd["max"])
            else:
                tf, tt = self.threat(s, f) + 1, self.threat(s, t) + 1
                n = round((self.troops[f] - 1) * tt / (tf + tt))
                n = max(pd["min"], min(pd["max"], n))
            return self.do_occupy(p, s, {"n": n})
        if self.phase == "attack":
            opts = self.attack_options(s, lvl)
            bar = {"easy": 0.45, "normal": 0.62, "hard": 0.7}[lvl]
            if lvl == "easy":
                opts = [(sc + rng.uniform(-0.3, 0.3), pw, f, t) for sc, pw, f, t in opts]
            good = [o for o in opts if o[0] >= bar]
            if good:
                _, _, f, t = max(good)
                return self.battle(p, s, f, t, blitz=True)
            self.phase = "fortify"
            return
        if self.phase == "fortify":
            if lvl == "easy" and rng.random() < 0.5:
                return self.end_turn(p)
            mine = self.lands_of(s)
            inner = [t for t in mine if self.troops[t] > 1 and self.threat(s, t) == 0]
            if inner:
                f = max(inner, key=lambda t: self.troops[t])
                dest = [t for t in self.reach(s, f) if self.threat(s, t) > 0]
                if dest:
                    t = max(dest, key=lambda x: self.threat(s, x) - self.troops[x])
                    return self.do_fortify(p, s, {"from": f, "to": t, "n": self.troops[f] - 1})
            return self.end_turn(p)
