"""Snowball Scramble: an original real-time snowball fight for 2–6 players in a walled snowfield.

Steer with a virtual stick (or WASD). Tap ❄️ to lob a snowball at the nearest rival (the one you're
facing first); hold it to pack a big one (you move slowly while you pack). Snowballs fly in an arc and
land where the target stood when you threw, so keep moving: a shadow shows where each one will land.
Snow forts block throws at anyone sheltering behind them, and get knocked down by the hits they take
(they grow back). Three hits and you're snowed in for a few seconds, and the thrower scores a point.

⛄ Walk through a patch of fresh snow to roll a giant snowball in front of you; run it into a rival to
knock them flat (two hits' worth). Most points when the clock runs out wins.

Server-owned physics like Sumo Saucers: frame(now) steps the field 30 times a second, the stick and the
throw button arrive through on_input, and positions stream to browsers over the room's fast channel.
Hits, splats and knockdowns go out as numbered events, repeated for EVENT_KEEP seconds.

#178 "needs more depth": a 🗺️ field per game (Fort Meadow, Snow Village, or the Frozen Pond where you slide),
🎁 gifts to grab and spend (🧊 ice ball: fast, two hits and a chill; ☃️ decoy: a snowman rivals' throws lock on
to; 💦 slush bomb: a puddle that bogs rivals down), 👑 the crown on the hill at half time (outnumber rivals in it: +1
every few seconds; level, the holder fills at half speed), and 🔥 streaks (three snow-ins without being snowed in; whoever ends one scores a bonus).

#181–#183: the crown is a loop now. Fill the ring on the hill (5 s) to win it (+CROWN_PTS), then it flies to a new
hill elsewhere on the field (shown CROWN_MOVE s ahead, so everyone can regroup), and it moves on by itself if nobody
has gone near it for CROWN_IDLE s. Holding it is risky: every hit on a holder inside knocks the ring back, and being
snowed in on the hill halves the holder side's ring."""
import collections
import math
import random
import time

from .base import Game, GameError

AW, AH = 10.0, 7.0          # the field: x in [-AW, AW], y in [-AH, AH]
BODY = 0.45                 # a player's radius
SPEED, PACK_SPEED = 4.6, 2.0
STEP = 1 / 30               # the field moves 30 times a second (frame() is called at 60)
AMMO, RELOAD = 3, 1.1       # snowballs held, seconds to scoop another
COOLDOWN = 0.35
BIG_HOLD = 0.8              # hold this long to pack a big one
SPLASH, BIG_SPLASH = 0.75, 1.15
PIPS = 3                    # hits to be snowed in
FROZEN = 3.0
FLIGHT = (0.5, 1.0 / 14)    # seconds: base + per unit of distance
MISS_RANGE = 7.0            # a throw with nobody to aim at goes this far
FORT_HP, FORT_REGROW = 5, 18.0
FORTS = [(-6.0, -3.2, 0), (-6.0, 3.2, 0), (6.0, -3.2, 0), (6.0, 3.2, 0), (0.0, -4.4, 1), (0.0, 4.4, 1), (-2.4, 0.0, 0), (2.4, 0.0, 0)]
FORT_LEN, FORT_THICK = 2.4, 0.55
PATCHES = [(-3.5, -5.4), (3.5, 5.4), (0.0, 0.0)]
PATCH_R, PATCH_REGROW = 1.3, 10.0
GIANT_MAX, GIANT_GROW = 1.0, 0.45   # a giant's size 0..1 grows this much per second rolled in fresh snow
GIANT_R = 0.55              # a full giant's radius, in front of you
KNOCK_SECS = 1.6
COUNTDOWN, EVENT_KEEP = 3.0, 0.6
# 🗺️ fields (#178): forts (x, y, horizontal), fresh-snow patches, the hill the crown sits on, and a frozen pond
# (cx, cy, rx, ry) where you slide
MAPS = {
    "meadow": {"name": "🏰 Fort Meadow", "forts": FORTS, "patches": PATCHES, "hill": (0.0, 0.0), "ice": None},
    "village": {"name": "🏘️ Snow Village", "hill": (0.0, 0.0), "ice": None,
                "forts": [(-7.0, -2.8, 0), (-7.0, 2.8, 0), (7.0, -2.8, 0), (7.0, 2.8, 0), (-3.6, -4.3, 1), (3.6, 4.3, 1),
                          (-3.6, 4.3, 1), (3.6, -4.3, 1), (0.0, -2.6, 1), (0.0, 2.6, 1)],
                "patches": [(-8.4, 0.0), (8.4, 0.0), (0.0, 5.7)]},
    "pond": {"name": "⛸️ Frozen Pond", "hill": (0.0, 0.0), "ice": (0.0, 0.0, 3.6, 2.5),
             "forts": [(-6.8, -3.6, 0), (-6.8, 3.6, 0), (6.8, -3.6, 0), (6.8, 3.6, 0), (-3.0, -5.3, 1), (3.0, 5.3, 1),
                       (-5.0, 0.0, 0), (5.0, 0.0, 0)],
             "patches": [(-3.4, 5.3), (3.4, -5.3), (-8.6, 0.0), (8.6, 0.0)]},
}
ICE_GRIP, ICE_SPEED = 2.2, 1.15     # on the pond: you reach your speed slowly (and slide), a little faster
# 🎁 gifts: one appears every GIFT_EVERY s (two at most on the field); walk over one to carry it, ✨ to spend it
ITEMS = ("ice", "decoy", "slush")
GIFT_FIRST, GIFT_EVERY, GIFT_MAX, GIFT_REACH = 7.0, 10.0, 2, BODY + 0.4
ICE_FLIGHT, CHILL, CHILL_SPEED = 0.55, 2.5, 0.55      # an ice ball flies in this share of the time; a hit chills
DECOY_HP, DECOY_T, DECOY_PULL = 2, 10.0, 0.6          # a decoy soaks this many throws; auto-aim scores it ×0.6
SLUSH_R, SLUSH_T, SLUSH_SPEED = 1.6, 7.0, 0.45
# 👑 the crown: on the hill from half time; outnumber rivals in it for HILL_EVERY s → +CROWN_PTS (level: the holder at ½ speed)
HILL_R, HILL_EVERY = 1.5, 5.0
# with CROWD or more players a level hill doesn't freeze: the holder keeps it at CROWD_RATE (#178 follow-up: 6 kids
# nearly always had a rival inside, so the crown almost never scored)
CROWD, CROWD_RATE = 1, 0.5   # (#183 follow-up: every game size now; with 3 players a tie froze it nearly always)
# #181–#183: winning the crown scores CROWN_PTS, then it flies to a new hill (landing CROWN_MOVE s later, at least
# CROWN_HOP away); a hit on a holder inside knocks the ring back HILL_HIT a pip, snowed in there halves it; an untouched
# crown moves on after CROWN_IDLE s
CROWN_PTS, CROWN_MOVE, CROWN_HOP, HILL_HIT, CROWN_IDLE = 2, 4.0, 7.0, 0.15, 20.0
BANK_FADE = 0.04      # …and a side pushed off keeps its count, fading this much a second, for when it's back
STREAK, STREAK_BONUS = 3, 1          # snow-ins in a row for a streak; ending one scores this bonus
BOT_X = {  # 🎁 how far it goes for a gift, chance it plays for the crown, how readily it spends a gift
    "easy": (3.0, 0.15, 0.3),
    "normal": (6.0, 0.5, 1.0),
    "hard": (9.0, 0.9, 1.0),
}
BOT = {  # reaction (s), throw eagerness per second, aim error (units), dodges, uses cover
    "easy": (0.4, 0.5, 1.2, False, False),
    "normal": (0.2, 0.9, 0.5, True, False),
    "hard": (0.1, 1.4, 0.2, True, True),
}


def fort_rect(f):
    x, y, horiz = f
    hw, hh = (FORT_LEN / 2, FORT_THICK / 2) if horiz else (FORT_THICK / 2, FORT_LEN / 2)
    return x - hw, y - hh, x + hw, y + hh


def seg_hits_rect(x0, y0, x1, y1, r, pad=0.0):
    """Where the segment first enters the rectangle (grown by pad), as a fraction 0..1, or None."""
    a0, b0, a1, b1 = r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - a0), (dx, a1 - x0), (-dy, y0 - b0), (dy, b1 - y0)):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return t0


class Kid:
    # (#178: kids saved before gifts, chills, streaks and the crown)
    item = None          # the gift carried: "ice" | "decoy" | "slush"
    chill_until = 0.0
    slow = 1.0           # this frame's speed factor (chilled, in slush), sent so the browser predicts the same
    streak = 0           # snow-ins since you were last snowed in
    crowns = 0           # points from the hill
    soaks = 0            # throws your decoys soaked up

    def __init__(self, x, y):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.fx, self.fy = 1.0, 0.0      # facing
        self.sx = self.sy = 0.0
        self.ammo, self.reload_at, self.cool_until = AMMO, 0.0, 0.0
        self.pips, self.frozen_until, self.knock_until = 0, 0.0, 0.0
        self.pack_at = 0.0               # when the throw button went down (0 = not packing)
        self.giant = 0.0
        self.points = 0
        self.hits = 0


class Snowball(Game):
    id = "snowball"
    solo_bots = 3
    category = "action"
    family = None
    howto = [
        "Drag anywhere to run (or WASD / arrows). Tap ❄️ (or Space) to lob a snowball at the nearest rival, the one you're facing first. Three hits snow someone in: +1 to the thrower.",
        "🎁 Walk over a gift to carry it, then tap ✨ (or E): 🧊 ice ball = a fast throw worth two hits that slows them; ☃️ decoy = a snowman that rivals' throws go for; 💦 slush bomb = a puddle that bogs rivals down.",
        "👑 From half time a crown sits on a hill: stand in its ring with more of you than rivals until it fills (5 s) for +2 (level: the holder fills at half speed), then it flies to a new hill (you see where 4 s ahead). Hits on the holder knock the ring back; snowed in on the hill, half the ring is lost.",
        "Hold ❄️ to pack a big one (two hits, wider splash); you move slowly while you pack. You carry 3 and scoop more as you go.",
        "Snowballs land where the target stood when they were thrown: a shadow shows where. Keep moving! Forts block throws at whoever hides behind them, and crumble. Snowed in lasts 3 s.",
        "⛄ Walk through fresh snow to roll a giant; run it into a rival to knock them flat. 🔥 Three snow-ins in a row is a streak; end someone's streak for +1.",
        "👑 More of you than rivals on the hill holds it (team-mates count together); level, the holder keeps filling at half speed (⚔️) until outnumbered. Nobody near it for 20 s and it moves on.",
        "Most points when the clock runs out wins.",
    ]
    tip_lines = 3
    name = "Snowball Scramble"
    icon = "❄️"
    blurb = "A real-time 3D snowball fight: lob, dodge the shadows, hide behind forts, roll a giant, grab gifts, hold the crown."
    min_players = 2
    max_players = 6
    replayable = False
    badges = {**Game.badges,
              "avalanche": ("🏔️", "Avalanche", "Flatten a rival with a giant snowball"),
              "untouched": ("🧊", "Untouchable", "Win without being snowed in"),
              "crown": ("👑", "King of the Hill", "Win the crown 3 times in one game"),
              "shutdown": ("🧯", "Shutdown", "End a rival's streak of three or more"),
              "decoy": ("☃️", "Snow Double", "Your decoys soak up 3 throws in one game")}
    settings_schema = {
        "time": ("Length", [(120, "2 min"), (90, "90 s"), (180, "3 min")], 120),
        "giants": ("⛄ Giant snowballs", [(True, "On"), (False, "Off")], True),
        "teams": ("Teams", [(False, "Everyone for themselves"), (True, "🔴🔵 Two teams")], False),
        "map": ("🗺️ Field", [("mix", "A different one each game"), ("meadow", "🏰 Fort Meadow"), ("village", "🏘️ Snow Village"),
                             ("pond", "⛸️ Frozen Pond")], "mix"),
        "extras": ("🎁 Gifts, 👑 crown & streaks", [(True, "On"), (False, "Off (classic)")], True),
    }
    TEAM_NAMES = ("🔴 Red", "🔵 Blue")

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(seated)
        self.kids = []
        # 🔴🔵 teams (#126): seats alternate red, blue; each team starts on its own end of the field
        self.teams = bool(self.s.get("teams", False)) and n >= 2
        self.team = [i % 2 if self.teams else i for i in range(n)]
        off = rng.random() * math.tau
        for i in range(n):
            if self.teams:
                side, row, per = (-1 if i % 2 == 0 else 1), i // 2, (n + 1 - i % 2) // 2
                y = (row + 0.5 - per / 2) * (AH * 1.5 / max(1, per))
                self.kids.append(Kid(side * AW * 0.82, y))
                self.kids[-1].fx = -side
            else:
                a = off + math.tau * i / n
                self.kids.append(Kid(math.cos(a) * AW * 0.8, math.sin(a) * AH * 0.75))
        # 🗺️ the field (#178): chosen, or a different one each game (not the last one played in this room)
        m = self.s.get("map", "mix")
        if m not in MAPS:
            last = getattr(self.room, "_snow_map", None)
            m = rng.choice([k for k in MAPS if k != last] or list(MAPS))
        try:
            self.room._snow_map = m
        except Exception:
            pass
        self.map = m
        mp = MAPS[m]
        self.fort_xy, self.patch_xy, self.hill_xy, self.ice = list(mp["forts"]), list(mp["patches"]), mp["hill"], mp["ice"]
        self.extras = bool(self.s.get("extras", True))
        self.forts = [FORT_HP] * len(self.fort_xy)
        self.fort_down = [0.0] * len(self.fort_xy)
        self.patches = [1.0] * len(self.patch_xy)  # fresh snow left in each patch, 0..1
        self.balls = []                            # [x0, y0, x1, y1, t0, t1, big, by, fort index or -1, id, kind]
        self.gifts, self.decoys, self.slush = [], [], []   # [id, x, y, kind]; [id, x, y, owner, hp, until]; [x, y, until, owner]
        self.item_id = 0
        self.said = {}
        self.crown_open, self.crown_side, self.crown_prog, self.crown_contest = False, -1, 0.0, 0   # contest: 0 clear, 1 frozen, 2 challenged (half speed)
        self.crown_bank = {}   # side → its count while someone else holds the hill (big games)
        self.crown_holder = -1  # the kid wearing it (the holding side's kid nearest the middle), or -1
        self.crown_move_at, self.crown_from, self.crown_next = 0.0, None, None   # in flight to a new hill until then
        self.crown_seen = 0.0   # when someone last stood on the hill (an untouched crown moves on)
        self.crown_wins = 0
        self.hill_in = {}   # kid → when they stepped onto the hill (still standing, not snowed in)
        self.bot_hill = [False] * n
        self.ball_id = 0
        self.events, self.ev_seq = [], 0
        self.bot_next = [0.0] * n
        self.frozen_ever = [False] * n
        r = self.room
        r.turn = None
        r.deadline = None
        now = time.time()
        self.stage = "countdown"
        self.go_at = now + COUNTDOWN
        self.end_at = self.go_at + int(self.s.get("time", 120))
        self.gift_at = self.go_at + GIFT_FIRST if self.extras else math.inf
        self.crown_at = self.go_at + int(self.s.get("time", 120)) / 2 if self.extras else math.inf
        self.last = now
        self.acc = 0.0
        self.frames = 0
        where = f" on {MAPS[m]['name']}"
        if self.teams:
            roster = lambda t: ", ".join(self.name_of(i) for i in range(n) if self.team[i] == t)  # noqa: E731
            r.add_log(f"❄️ Snowball Scramble, {self.TEAM_NAMES[0]} ({roster(0)}) v {self.TEAM_NAMES[1]} ({roster(1)}): "
                      f"{int(self.s.get('time', 120))} seconds{where}. No hitting your own side.", "big")
        else:
            r.add_log(f"❄️ Snowball Scramble{where}: {int(self.s.get('time', 120))} seconds. Three hits snow someone in.", "big")

    def __setstate__(self, st):   # games saved before #178: the classic field, no gifts or crown
        self.__dict__.update(st)
        d = self.__dict__
        d.setdefault("map", "meadow")
        d.setdefault("fort_xy", list(FORTS))
        d.setdefault("patch_xy", list(PATCHES))
        d.setdefault("hill_xy", (0.0, 0.0))
        d.setdefault("ice", None)
        d.setdefault("extras", False)
        for k in ("gifts", "decoys", "slush"):
            d.setdefault(k, [])
        d.setdefault("item_id", 0)
        d.setdefault("said", {})
        d.setdefault("gift_at", math.inf)
        d.setdefault("crown_at", math.inf)
        d.setdefault("crown_open", False)
        d.setdefault("crown_side", -1)
        d.setdefault("crown_prog", 0.0)
        d.setdefault("crown_contest", 0)
        d.setdefault("hill_in", {})
        d.setdefault("crown_bank", {})
        d.setdefault("crown_holder", -1)
        d.setdefault("crown_move_at", 0.0)
        d.setdefault("crown_from", None)
        d.setdefault("crown_next", None)
        d.setdefault("crown_seen", 0.0)
        d.setdefault("crown_wins", 0)
        if "bot_hill" not in d and "seats" in d:
            d["bot_hill"] = [False] * len(d["seats"])
        for b in d.get("balls", []):
            if len(b) < 11:
                b.append(0)

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    team = None  # (games saved before teams: everyone their own side)

    def side(self, i):
        return self.team[i] if self.team else i

    def foes(self, i, j):
        return self.side(i) != self.side(j)

    def team_points(self, t):
        return sum(k.points for i, k in enumerate(self.kids) if self.side(i) == t and self.active(i))

    def pl(self, i):
        return self.room.players.get(self.seats[i])

    def name_of(self, i):
        p = self.pl(i)
        return p.name if p else "?"

    def active(self, i):
        p = self.pl(i)
        return bool(p and not p.eliminated)

    def crowd(self):
        """👑 a big game: a level hill keeps counting (slowly) for whoever held it."""
        return sum(1 for i in range(len(self.kids)) if self.active(i)) >= CROWD

    def event(self, now, *e):
        self.ev_seq += 1
        self.events.append((self.ev_seq, now, e))

    # -- input

    def act(self, p, a):
        raise GameError("Run by dragging, and tap ❄️ to throw.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        k = self.kids[i]
        sx, sy = a.get("sx"), a.get("sy")
        if sx is not None or sy is not None:
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (sx, sy)):
                raise GameError("Bad stick.")
            m = math.hypot(sx, sy)
            if m > 1:
                sx, sy = sx / m, sy / m
            k.sx, k.sy = sx, sy
        if a.get("use") is not None:
            if a.get("use") is not True:
                raise GameError("Bad gift.")
            self.use(i, time.time())
        t = a.get("throw")
        if t is not None:
            if t not in ("down", "up", "tap"):
                raise GameError("Bad throw.")
            now = time.time()
            if t == "down":
                if not k.pack_at:
                    k.pack_at = now
            else:
                big = t == "up" and k.pack_at and now - k.pack_at >= BIG_HOLD
                k.pack_at = 0.0
                self.throw(i, now, bool(big))

    # -- the field

    def can_act(self, k, now):
        return self.stage == "play" and now >= k.frozen_until and now >= k.knock_until

    def target_of(self, i):
        """The rival to lob at: the nearest one roughly in front of you, else the nearest."""
        k = self.kids[i]
        best, best_s = None, 1e9
        for j, o in enumerate(self.kids):
            if j == i or not self.active(j) or not self.foes(i, j):
                continue
            dx, dy = o.x - k.x, o.y - k.y
            d = math.hypot(dx, dy) or 1e-6
            facing = (dx * k.fx + dy * k.fy) / d
            score = d * (1.0 if facing > 0.5 else 1.8)
            if score < best_s:
                best, best_s = j, score
        return best

    def aim_point(self, i, now=None):
        """Where an auto-aimed throw goes: the target_of rival, or a rival's ☃️ decoy when that scores better
        (a decoy pulls: its distance counts ×DECOY_PULL). Returns (x, y) or None."""
        k = self.kids[i]
        best, best_s = None, 1e9
        cands = [(o.x, o.y, 1.0) for j, o in enumerate(self.kids) if j != i and self.active(j) and self.foes(i, j)]
        cands += [(d[1], d[2], DECOY_PULL) for d in self.decoys if self.foes(i, d[3])]
        for x, y, pull in cands:
            dx, dy = x - k.x, y - k.y
            d = math.hypot(dx, dy) or 1e-6
            facing = (dx * k.fx + dy * k.fy) / d
            score = d * (1.0 if facing > 0.5 else 1.8) * pull
            if score < best_s:
                best, best_s = (x, y), score
        return best

    def throw(self, i, now, big, at=None, kind=0):
        """kind: 0 a snowball (costs one you carry), 1 a 🧊 ice ball, 2 a 💦 slush bomb (gifts: free)."""
        k = self.kids[i]
        if not self.can_act(k, now) or now < k.cool_until or (k.ammo <= 0 and not kind):
            return False
        if at is None:
            at = self.aim_point(i)
            if at is None:
                at = (k.x + k.fx * MISS_RANGE, k.y + k.fy * MISS_RANGE)
        x1 = max(-AW, min(AW, at[0]))
        y1 = max(-AH, min(AH, at[1]))
        if not kind:
            k.ammo -= 1
            if k.ammo < AMMO and k.reload_at <= now:
                k.reload_at = now + RELOAD
        k.cool_until = now + COOLDOWN
        dx, dy = x1 - k.x, y1 - k.y
        d = math.hypot(dx, dy)
        if d > 0.1:
            k.fx, k.fy = dx / d, dy / d
        # a fort between you and the landing spot takes the hit if the target is sheltering close behind it
        fort = -1
        best = 2.0
        for fi, f in enumerate(self.fort_xy):
            if self.forts[fi] <= 0:
                continue
            t = seg_hits_rect(k.x, k.y, x1, y1, fort_rect(f), 0.1)
            if t is not None and t > 0.05 and d * (1 - t) < 1.8 and t < best:
                best, fort = t, fi
        if fort >= 0:
            x1, y1 = k.x + dx * best, k.y + dy * best
            d *= best
        self.ball_id += 1
        fly = (FLIGHT[0] + d * FLIGHT[1]) * (ICE_FLIGHT if kind == 1 else 1.0)
        self.balls.append([round(k.x, 2), round(k.y, 2), round(x1, 2), round(y1, 2), now, now + fly, big, i, fort, self.ball_id, kind])
        self.event(now, "throw", i, int(big), kind)
        return True

    def use(self, i, now):
        """✨ Spend the gift you carry: an ice ball or slush bomb thrown at once (auto-aimed), or a decoy dropped."""
        k = self.kids[i]
        if not k.item or not self.can_act(k, now):
            return False
        kind = k.item
        if kind == "decoy":
            x = max(-AW + BODY, min(AW - BODY, k.x + k.fx * 0.9))
            y = max(-AH + BODY, min(AH - BODY, k.y + k.fy * 0.9))
            self.decoys = [d for d in self.decoys if d[3] != i]   # one each
            self.item_id += 1
            self.decoys.append([self.item_id, round(x, 2), round(y, 2), i, DECOY_HP, now + DECOY_T])
            self.event(now, "decoy", i, round(x, 2), round(y, 2))
        else:
            if now < k.cool_until:
                k.cool_until = now   # a gift never waits on the throw cooldown
            if not self.throw(i, now, False, kind=1 if kind == "ice" else 2):
                return False
        k.item = None
        return True

    def frame(self, now):
        """Advance to `now`. Returns True when every viewer needs a full view."""
        if self.room.phase != "playing":
            return False
        if self.stage == "countdown":
            if now >= self.go_at:
                self.stage = "play"
                self.last = now
                return True
            self.frames += 1
            if self.frames % 6 == 0:
                self.broadcast(now)
            return False
        self.acc += max(0.0, min(0.1, now - self.last))
        self.last = now
        if self.acc < STEP:
            return False
        dt = min(0.05, self.acc)
        self.acc = 0.0
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated:
                self.bot_think(i, p.bot, now)
        self.move(dt, now)
        self.land(now)
        self.tick_world(dt, now)
        if now >= self.end_at:
            self.broadcast(now)
            self.end()
            return True
        self.broadcast(now)
        return False

    def move(self, dt, now):
        giants = self.s.get("giants", True)
        for i, k in enumerate(self.kids):
            if not self.active(i):
                continue
            if k.pack_at and now - k.pack_at > 3.0:   # a button held down too long throws itself
                k.pack_at = 0.0
                self.throw(i, now, True)
            k.slow = self.slow_of(i, k, now)
            iced = self.on_ice(k.x, k.y)
            if self.can_act(k, now):
                sp = (PACK_SPEED if k.pack_at else SPEED) * k.slow * (ICE_SPEED if iced else 1.0)
                tx, ty = k.sx * sp, k.sy * sp
            else:
                tx = ty = 0.0
            # a little momentum: reach the stick's speed quickly, slide a bit when knocked (and on the pond)
            blend = min(1.0, dt * (2 if now < k.knock_until else ICE_GRIP if iced else 14))
            k.vx += (tx - k.vx) * blend
            k.vy += (ty - k.vy) * blend
            k.x += k.vx * dt
            k.y += k.vy * dt
            if math.hypot(k.sx, k.sy) > 0.2 and self.can_act(k, now):
                m = math.hypot(k.sx, k.sy)
                k.fx, k.fy = k.sx / m, k.sy / m
            k.x = max(-AW + BODY, min(AW - BODY, k.x))
            k.y = max(-AH + BODY, min(AH - BODY, k.y))
            for fi, f in enumerate(self.fort_xy):
                if self.forts[fi] > 0:
                    self.push_out(k, fort_rect(f))
            # ⛄ rolling a giant through fresh snow
            if giants and math.hypot(k.vx, k.vy) > 1.0 and k.giant < GIANT_MAX:
                for pi, (px, py) in enumerate(self.patch_xy):
                    if self.patches[pi] > 0.05 and math.hypot(k.x - px, k.y - py) < PATCH_R:
                        grow = min(GIANT_GROW * dt, GIANT_MAX - k.giant, self.patches[pi])
                        k.giant += grow
                        self.patches[pi] -= grow * 0.8
                        if k.giant >= GIANT_MAX - 1e-6:
                            self.event(now, "giant", i)
        # bodies bump apart; a full giant flattens whoever it rolls into
        for i, a in enumerate(self.kids):
            if not self.active(i):
                continue
            for j in range(i + 1, len(self.kids)):
                if not self.active(j):
                    continue
                b = self.kids[j]
                dx, dy = b.x - a.x, b.y - a.y
                d = math.hypot(dx, dy)
                if 0 < d < 2 * BODY:
                    push = (2 * BODY - d) / 2
                    a.x -= dx / d * push
                    a.y -= dy / d * push
                    b.x += dx / d * push
                    b.y += dy / d * push
            if a.giant >= 0.5:
                gx, gy = a.x + a.fx * (BODY + GIANT_R * a.giant), a.y + a.fy * (BODY + GIANT_R * a.giant)
                for j, b in enumerate(self.kids):
                    if j == i or not self.active(j) or now < b.frozen_until or now < b.knock_until or not self.foes(i, j):
                        continue
                    if math.hypot(b.x - gx, b.y - gy) < BODY + GIANT_R * a.giant:
                        b.knock_until = now + KNOCK_SECS
                        b.vx, b.vy = a.fx * 7, a.fy * 7
                        self.event(now, "flat", j, i, round(gx, 2), round(gy, 2))
                        self.room.add_log(f"⛄ {self.name_of(i)} flattens {self.name_of(j)} with a giant snowball!", "power")
                        if self.pl(i):
                            self.award(self.seats[i], "avalanche")
                        self.hit(j, i, 2, now)
                        a.giant = 0.0
                        break

    def on_ice(self, x, y):
        if not self.ice:
            return False
        cx, cy, rx, ry = self.ice
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1.0

    def slow_of(self, i, k, now):
        """🧊 chilled and 💦 slush (a rival's puddle) slow you; the worst one counts."""
        f = CHILL_SPEED if now < k.chill_until else 1.0
        for x, y, until, owner in self.slush:
            if now < until and self.foes(i, owner) and math.hypot(k.x - x, k.y - y) < SLUSH_R:
                f = min(f, SLUSH_SPEED)
                break
        return f

    @staticmethod
    def push_out(k, r):
        cx = max(r[0], min(r[2], k.x))
        cy = max(r[1], min(r[3], k.y))
        dx, dy = k.x - cx, k.y - cy
        d = math.hypot(dx, dy)
        if d < BODY:
            if d < 1e-6:   # inside: out the nearest side
                opts = [(k.x - r[0], -1, 0), (r[2] - k.x, 1, 0), (k.y - r[1], 0, -1), (r[3] - k.y, 0, 1)]
                m, nx, ny = min(opts)
                k.x += nx * (m + BODY)
                k.y += ny * (m + BODY)
            else:
                k.x += dx / d * (BODY - d)
                k.y += dy / d * (BODY - d)

    def land(self, now):
        keep = []
        for b in self.balls:
            x0, y0, x1, y1, t0, t1, big, by, fort, bid = b[:10]
            kind = b[10] if len(b) > 10 else 0
            if now < t1:
                keep.append(b)
                continue
            heavy = big or kind == 1
            if fort >= 0 and self.forts[fort] > 0:
                self.forts[fort] = max(0, self.forts[fort] - (2 if heavy else 1))
                self.event(now, "fort", fort, x1, y1, int(big))
                if self.forts[fort] == 0:
                    self.fort_down[fort] = now
                    self.event(now, "crumble", fort)
                continue
            reach = BIG_SPLASH if big else SPLASH
            if kind == 2:   # 💦 the slush bomb leaves a puddle wherever it lands
                self.slush = [p for p in self.slush if p[3] != by] + [[x1, y1, now + SLUSH_T, by]]
                self.event(now, "slush", x1, y1, by)
            # ☃️ a rival's decoy standing there soaks it up
            dec = next((d for d in self.decoys if self.foes(by, d[3]) and math.hypot(d[1] - x1, d[2] - y1) < reach + 0.3), None)
            if dec is not None and kind != 2:
                dec[4] -= 2 if heavy else 1
                owner = self.kids[dec[3]]
                owner.soaks += 1
                self.event(now, "soak", dec[0], x1, y1, int(heavy))
                if owner.soaks == 3 and self.pl(dec[3]):
                    self.award(self.seats[dec[3]], "decoy")
                if dec[4] <= 0:
                    self.decoys.remove(dec)
                    self.event(now, "poof", dec[0], dec[1], dec[2])
                    self.say("decoy", 12, now, f"☃️ {self.name_of(by)} knocks the head off {self.name_of(dec[3])}'s decoy!", "cool")
                continue
            hit = False
            for j, o in enumerate(self.kids):
                if j == by or not self.active(j) or now < o.frozen_until or not self.foes(j, by):
                    continue
                if math.hypot(o.x - x1, o.y - y1) < reach + BODY * 0.5:
                    hit = True
                    self.event(now, "hit", j, by, x1, y1, int(big), kind)
                    if kind == 1:
                        o.chill_until = now + CHILL
                    self.hit(j, by, 2 if heavy else 1, now)
            if not hit and kind != 2:
                self.event(now, "splat", x1, y1, int(big))
        self.balls = keep

    def hit(self, j, by, n, now):
        o = self.kids[j]
        o.pips += n
        self.kids[by].hits += 1
        self.crown_hit(j, by, n, o.pips >= PIPS, now)
        if o.pips >= PIPS:
            o.pips = 0
            o.frozen_until = now + FROZEN
            o.pack_at = 0.0
            o.giant = 0.0
            self.frozen_ever[j] = True
            k = self.kids[by]
            k.points += 1
            self.event(now, "frozen", j, by)
            self.room.add_log(f"❄️ {self.name_of(by)} snows in {self.name_of(j)}!", "power")
            if not self.extras:
                pts = k.points
                if pts and pts % 5 == 0:
                    self.moment(f"❄️ {self.name_of(by)}: {pts} snow-ins!", "cool", "good")
                return
            # 🔥 streaks: ending one scores a bonus
            if o.streak >= STREAK:
                k.points += STREAK_BONUS
                self.event(now, "shutdown", by, j, o.streak)
                self.say("shutdown", 4, now, f"🧯 {self.name_of(by)} ends {self.name_of(j)}'s streak of {o.streak}! +{STREAK_BONUS}", "good", "good")
                if self.pl(by):
                    self.award(self.seats[by], "shutdown")
            o.streak = 0
            k.streak += 1
            if k.streak in (STREAK, STREAK + 2) or (k.streak > STREAK + 2 and k.streak % 3 == 0):
                self.event(now, "streak", by, k.streak)
                self.say(f"streak{by}", 5, now, f"🔥 {self.name_of(by)}: {k.streak} snow-ins in a row!"
                         + (" Stop them!" if k.streak == STREAK else ""), "bad", "good")

    def tick_world(self, dt, now):
        for i, k in enumerate(self.kids):
            if k.ammo < AMMO and now >= k.reload_at:
                if k.reload_at:
                    k.ammo += 1
                k.reload_at = now + RELOAD if k.ammo < AMMO else 0.0
        for fi in range(len(self.fort_xy)):
            if self.forts[fi] <= 0 and now - self.fort_down[fi] > FORT_REGROW:
                # only grow back once nobody is standing in it
                if all(not self.active(i) or seg_hits_rect(k.x, k.y, k.x, k.y, fort_rect(self.fort_xy[fi]), BODY) is None for i, k in enumerate(self.kids)):
                    self.forts[fi] = FORT_HP
                    self.event(now, "regrow", fi)
        for pi in range(len(self.patch_xy)):
            self.patches[pi] = min(1.0, self.patches[pi] + dt / PATCH_REGROW)
        if self.extras:
            self.tick_gifts(now)
            self.tick_crown(dt, now)
        self.events = [e for e in self.events if now - e[1] < EVENT_KEEP]

    # -- 🎁 gifts, ☃️ decoys, 💦 slush, 👑 the crown (#178)

    def gift_spot(self):
        rng = self.rng
        for _ in range(40):
            x, y = rng.uniform(-AW + 1.2, AW - 1.2), rng.uniform(-AH + 1.2, AH - 1.2)
            if any(seg_hits_rect(x, y, x, y, fort_rect(f), 0.7) is not None for f in self.fort_xy):
                continue
            if any(math.hypot(k.x - x, k.y - y) < 2.2 for i, k in enumerate(self.kids) if self.active(i)):
                continue
            if any(math.hypot(g[1] - x, g[2] - y) < 3 for g in self.gifts) or any(math.hypot(x - h[0], y - h[1]) < HILL_R + 0.6 for h in (self.hill_xy, self.crown_next) if h):
                continue
            return round(x, 2), round(y, 2)
        return None

    def tick_gifts(self, now):
        if now >= self.gift_at:
            self.gift_at = now + GIFT_EVERY
            spot = self.gift_spot() if len(self.gifts) < GIFT_MAX else None
            if spot:
                self.item_id += 1
                kind = self.rng.choice(ITEMS)
                self.gifts.append([self.item_id, spot[0], spot[1], kind])
                self.event(now, "gift", self.item_id, spot[0], spot[1], ITEMS.index(kind) + 1)
        for g in list(self.gifts):
            for i, k in enumerate(self.kids):
                if k.item or not self.active(i) or not self.can_act(k, now) or math.hypot(k.x - g[1], k.y - g[2]) > GIFT_REACH:
                    continue
                k.item = g[3]
                self.gifts.remove(g)
                self.event(now, "pick", i, ITEMS.index(g[3]) + 1, g[0])
                break
        if self.decoys:
            for d in [d for d in self.decoys if now >= d[5] or not self.active(d[3])]:
                self.decoys.remove(d)
                self.event(now, "poof", d[0], d[1], d[2])
        if self.slush:
            self.slush = [p for p in self.slush if now < p[2]]

    def hill_spot(self):
        """👑 a new hill (#183): clear of forts and the walls, at least CROWN_HOP from the last one, and away from
        everyone (no one gets it for free); a few candidates, the emptiest wins."""
        rng, (ox, oy) = self.rng, self.hill_xy
        best = None
        for _ in range(80):
            x, y = rng.uniform(-AW + HILL_R + 0.8, AW - HILL_R - 0.8), rng.uniform(-AH + HILL_R + 0.8, AH - HILL_R - 0.8)
            if math.hypot(x - ox, y - oy) < CROWN_HOP:
                continue
            if any(seg_hits_rect(x, y, x, y, fort_rect(f), HILL_R * 0.75) is not None for f in self.fort_xy):
                continue
            room = min([math.hypot(k.x - x, k.y - y) for i, k in enumerate(self.kids) if self.active(i)] or [9.0])
            score = min(room, 5.0) + rng.random()
            if best is None or score > best[0]:
                best = (score, round(x, 2), round(y, 2))
            if best[0] >= 5.0:
                break
        return (best[1], best[2]) if best else (0.0, 0.0) if math.hypot(ox, oy) >= CROWN_HOP else (-ox, -oy)

    def move_crown(self, now):
        """👑 off to a new hill: it shows where at once and lands CROWN_MOVE s later."""
        self.crown_from, self.crown_next = self.hill_xy, self.hill_spot()
        self.crown_move_at = now + CROWN_MOVE
        self.crown_side, self.crown_prog, self.crown_contest, self.crown_holder = -1, 0.0, 0, -1
        self.crown_bank, self.hill_in = {}, {}
        self.event(now, "crownmove", self.crown_from[0], self.crown_from[1], self.crown_next[0], self.crown_next[1])

    def tick_crown(self, dt, now):
        if not self.crown_open:
            if now < self.crown_at:
                return
            self.crown_open = True
            self.crown_seen = now
            self.event(now, "crown")
            self.moment(f"👑 A crown lands on the hill! Outnumber rivals in its ring until it fills: +{CROWN_PTS}, then it flies off", "gold", "fanfare")
        if self.crown_move_at:   # in flight to its next hill
            if now < self.crown_move_at:
                return
            self.hill_xy, self.crown_move_at, self.crown_from, self.crown_seen = self.crown_next, 0.0, None, now
            self.event(now, "crownland", self.hill_xy[0], self.hill_xy[1])
        hx, hy = self.hill_xy
        inside = [i for i, k in enumerate(self.kids) if self.active(i) and self.can_act(k, now) and math.hypot(k.x - hx, k.y - hy) < HILL_R]
        for i in list(self.hill_in):
            if i not in inside:
                del self.hill_in[i]
        for i in inside:
            self.hill_in.setdefault(i, now)
        self.crown_holder = -1
        if not inside:
            self.crown_contest = 0
            self.crown_prog = max(0.0, self.crown_prog - dt * 0.25)
            if now - self.crown_seen > CROWN_IDLE:   # nobody's been near it: it moves on
                self.move_crown(now)
            return
        self.crown_seen = now
        # the side with the most kids inside holds it; level at the top (CROWD is 1 now, so any game size)
        # where whoever held it last keeps filling at half speed until they're outnumbered or snowed out (#178 follow-up)
        count = collections.Counter(self.side(i) for i in inside)
        most = max(count.values())
        top = [sd for sd, c in count.items() if c == most]
        rate = 1.0
        if len(top) == 1:
            sd = top[0]
            self.crown_contest = 0
        elif self.crowd():   # level in a big game: the holder keeps it, else whoever has been up there longest takes it
            sd = self.crown_side if self.crown_side in top else min(top, key=lambda sd: min(self.hill_in[i] for i in inside if self.side(i) == sd))
            rate = CROWD_RATE
            self.crown_contest = 2
        else:
            self.crown_contest = 1
            if self.crown_side in top:
                self.crown_holder = self.nearest_in(inside, self.crown_side)
            return
        if sd != self.crown_side:
            if self.crowd():   # in a big game a side that loses the hill keeps (most of) its count for when it's back
                if self.crown_side >= 0:
                    self.crown_bank[self.crown_side] = self.crown_prog
                self.crown_side, self.crown_prog = sd, self.crown_bank.pop(sd, 0.0)
            else:
                self.crown_side, self.crown_prog = sd, 0.0
        for b in self.crown_bank:
            self.crown_bank[b] = max(0.0, self.crown_bank[b] - dt * BANK_FADE)
        self.crown_holder = i = self.nearest_in(inside, sd)
        self.crown_prog += dt * rate / HILL_EVERY
        if self.crown_prog >= 1.0:
            k = self.kids[i]
            k.points += CROWN_PTS
            k.crowns += 1
            self.crown_wins += 1
            self.event(now, "crownpt", i, CROWN_PTS)
            self.room.add_log(f"👑 {self.name_of(i)} wins the crown: +{CROWN_PTS}", "power")
            if k.crowns == 3:
                self.say("crown3", 30, now, f"👑 {self.name_of(i)} is King of the Hill: 3 crowns!", "gold", "good")
                if self.pl(i):
                    self.award(self.seats[i], "crown")
            else:
                self.say("crownpt", 8, now, f"👑 {self.name_of(i)} wins the crown: +{CROWN_PTS}! It flies to a new hill…", "gold")
            self.move_crown(now)

    def nearest_in(self, inside, sd):
        hx, hy = self.hill_xy
        return min((i for i in inside if self.side(i) == sd), key=lambda i: math.hypot(self.kids[i].x - hx, self.kids[i].y - hy))

    def on_hill(self, j):
        return self.crown_open and not self.crown_move_at and self.crown_side >= 0 and self.side(j) == self.crown_side and j in self.hill_in

    def crown_hit(self, j, by, n, frozen, now):
        """👑 #181: a hit on a holder standing on the hill knocks the ring back; snowed in there halves it."""
        if not self.extras or not self.on_hill(j):
            return
        if frozen:   # (#181 follow-up: halved, not cleared; clearing it made the crown nearly unwinnable in big games)
            lost = self.crown_prog * 0.5
            self.crown_prog -= lost
            self.event(now, "crowndrop", j, by)
            if lost > 0.15:
                self.say("crowndrop", 6, now, f"👑 {self.name_of(by)} snows {self.name_of(j)} off the hill: crown half lost!", "bad", "bad")
        else:
            self.crown_prog = max(0.0, self.crown_prog - HILL_HIT * n)
            self.event(now, "crownhit", j, by)

    def say(self, key, gap, now, text, tone="gold", sound=None):
        """A moment, at most once per `gap` seconds for this key, and one every 3 s in all."""
        if now < self.said.get(key, 0) or now < self.said.get("", 0):
            return
        self.said[key] = now + gap
        self.said[""] = now + 3.0
        self.moment(text, tone, sound)

    def end(self):
        r = self.room
        here = [i for i in range(len(self.seats)) if self.active(i)]
        if not here:
            return r.finish(None, "Everyone left.")
        if getattr(self, "teams", False):
            return self.end_teams(here)
        ranked = sorted(here, key=lambda i: (self.kids[i].points, self.kids[i].hits), reverse=True)
        top = ranked[0]
        tied = [i for i in ranked if (self.kids[i].points, self.kids[i].hits) == (self.kids[top].points, self.kids[top].hits)]
        self.stage = "done"
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {self.kids[top].points} between {' & '.join(self.name_of(i) for i in tied)}.")
        if not self.frozen_ever[top] and self.pl(top):
            self.award(self.seats[top], "untouched")
        pts = self.kids[top].points
        more = "" if len(ranked) < 2 or pts > self.kids[ranked[1]].points else f" (most hits: {self.kids[top].hits})"
        unit = ("point" if self.extras else "snow-in") + ("s" if pts != 1 else "")
        return r.finish(self.pl(top), f"🏆 {self.name_of(top)} wins the snowball fight with {pts} {unit}{more}!")

    def end_teams(self, here):
        r = self.room
        self.stage = "done"
        pts = [self.team_points(0), self.team_points(1)]
        hits = [sum(self.kids[i].hits for i in here if self.side(i) == t) for t in (0, 1)]
        if (pts[0], hits[0]) == (pts[1], hits[1]):
            return r.finish(None, f"🤝 A draw: {self.TEAM_NAMES[0]} {pts[0]}, {self.TEAM_NAMES[1]} {pts[1]}.")
        w = 0 if (pts[0], hits[0]) > (pts[1], hits[1]) else 1
        team = [i for i in here if self.side(i) == w]
        best = max(team, key=lambda i: (self.kids[i].points, self.kids[i].hits))
        if not self.frozen_ever[best] and self.pl(best):
            self.award(self.seats[best], "untouched")
        names = " & ".join(self.name_of(i) for i in team)
        return r.finish(self.pl(best), f"🏆 {self.TEAM_NAMES[w]} wins the snowball fight {pts[w]}–{pts[1 - w]} ({names})!")

    # -- streaming

    def state(self, now):
        r = lambda v: round(v, 2)  # noqa: E731
        return {
            "st": self.stage, "tl": r(max(0.0, self.end_at - now)), "go": r(max(0.0, self.go_at - now)),
            "k": [[r(k.x), r(k.y), r(k.vx), r(k.vy), r(k.fx), r(k.fy), k.ammo, k.pips,
                   r(max(0.0, k.frozen_until - now)), r(max(0.0, k.knock_until - now)), int(bool(k.pack_at)),
                   r(k.giant), k.points, ITEMS.index(k.item) + 1 if k.item in ITEMS else 0, r(k.slow),
                   k.streak, k.crowns, r(max(0.0, k.chill_until - now))] for k in self.kids],
            "b": [[b[0], b[1], b[2], b[3], r(max(0.0, b[5] - now)), r(b[5] - b[4]), int(b[6]), b[7], b[9], b[10] if len(b) > 10 else 0]
                  for b in self.balls],
            "f": self.forts, "p": [r(v) for v in self.patches],
            **({"g": [[g[0], g[1], g[2], ITEMS.index(g[3]) + 1] for g in self.gifts],
                "dc": [[d[0], d[1], d[2], d[3], d[4]] for d in self.decoys],
                "sl": [[p[0], p[1], r(max(0.0, p[2] - now)), p[3]] for p in self.slush],
                "h": [int(self.crown_open), self.crown_side, r(self.crown_prog), int(self.crown_contest), r(max(0.0, self.crown_at - now))
                      if self.crown_at < math.inf else 0, self.hill_xy[0], self.hill_xy[1], self.crown_holder,
                      r(max(0.0, self.crown_move_at - now)) if self.crown_move_at else 0, *(self.crown_next or self.hill_xy)]} if self.extras else {}),
            **({"tp": [self.team_points(0), self.team_points(1)]} if getattr(self, "teams", False) else {}),
        }

    def broadcast(self, now):
        d = self.state(now)
        d["ev"] = [[n, *e] for n, _, e in self.events]
        self.room.push_fast(d)

    # -- bots

    def bot_think(self, i, level, now):
        if now < self.bot_next[i]:
            return
        react, eager, err, dodge, cover = BOT.get(level, BOT["normal"])
        self.bot_next[i] = now + react * random.uniform(0.7, 1.3)
        k = self.kids[i]
        if not self.can_act(k, now):
            k.sx = k.sy = 0.0
            return
        j = self.target_of(i)
        hold = self.crown_holder if self.extras else -1
        if 0 <= hold != i and level != "easy" and self.foes(i, hold) and self.active(hold) and math.hypot(self.kids[hold].x - k.x, self.kids[hold].y - k.y) < (9 if level == "hard" else 5):
            j = hold   # #181: knock the crown holder back
        gx, gy = k.x, k.y
        if j is not None:
            t = self.kids[j]
            d = math.hypot(t.x - k.x, t.y - k.y) or 1e-6
            # keep a lobbing distance
            want = 5.5
            gx = k.x + (t.x - k.x) / d * (d - want)
            gy = k.y + (t.y - k.y) / d * (d - want)
            if cover:   # hard: a spot behind the fort nearest to it, away from the target
                best = None
                for fi, f in enumerate(self.fort_xy):
                    if self.forts[fi] <= 0:
                        continue
                    fx, fy = f[0], f[1]
                    ax, ay = fx - t.x, fy - t.y
                    m = math.hypot(ax, ay) or 1
                    sx, sy = fx + ax / m * 0.9, fy + ay / m * 0.9
                    c = math.hypot(sx - k.x, sy - k.y) + 0.3 * abs(math.hypot(sx - t.x, sy - t.y) - want)
                    if best is None or c < best[0]:
                        best = (c, sx, sy)
                if best and best[0] < 6:
                    gx, gy = best[1], best[2]
            # roll a giant when a patch is near and fresh
            if self.s.get("giants", True) and k.giant < GIANT_MAX and level != "easy":
                for pi, (px, py) in enumerate(self.patch_xy):
                    if self.patches[pi] > 0.5 and math.hypot(px - k.x, py - k.y) < 3.5:
                        gx, gy = px + math.cos(now * 2) * 0.9, py + math.sin(now * 2) * 0.9
            if k.giant >= GIANT_MAX - 0.05:   # charge at the target with it
                gx, gy = t.x, t.y
        if self.extras and k.giant < GIANT_MAX - 0.05:
            gx, gy = self.bot_extras(i, level, now, j, gx, gy)
        # dodge shadows that will land on me soon
        if dodge:
            for b in self.balls:
                if b[7] == i or b[8] >= 0:
                    continue
                if math.hypot(b[2] - k.x, b[3] - k.y) < (BIG_SPLASH if b[6] else SPLASH) + BODY and b[5] - now < 0.7:
                    ax, ay = k.x - b[2], k.y - b[3]
                    m = math.hypot(ax, ay) or 1e-6
                    if m < 1e-3:
                        ax, ay = -k.fy, k.fx
                        m = 1
                    gx, gy = k.x + ax / m * 3, k.y + ay / m * 3
                    break
        dx, dy = gx - k.x, gy - k.y
        m = math.hypot(dx, dy)
        k.sx, k.sy = (dx / m, dy / m) if m > 0.3 else (0.0, 0.0)
        if m <= 0.3 and j is not None:  # face the target while standing
            t = self.kids[j]
            d = math.hypot(t.x - k.x, t.y - k.y) or 1e-6
            k.fx, k.fy = (t.x - k.x) / d, (t.y - k.y) / d
        # throw now and then (with aim error)
        if j is not None and k.ammo > 0 and now >= k.cool_until and random.random() < eager * react:
            ax, ay = (self.kids[j].x, self.kids[j].y) if j == hold else self.aim_point(i) or (self.kids[j].x, self.kids[j].y)   # ☃️ decoys fool bots too
            big = level != "easy" and k.ammo >= 2 and random.random() < 0.25
            self.throw(i, now, big, (ax + random.gauss(0, err), ay + random.gauss(0, err)))

    def bot_extras(self, i, level, now, j, gx, gy):
        """#178: a bot grabs gifts within its reach, plays for the crown, steps out of slush, and spends gifts:
        ice and slush at a rival in range, a decoy when a snowball is coming or it's carrying hits."""
        reach, hill_p, use_rate = BOT_X.get(level, BOT_X["normal"])
        k = self.kids[i]
        if int(now / 4) != int((now - 0.5) / 4) or not self.bot_hill:   # re-decide about the crown every 4 s
            if not self.bot_hill:
                self.bot_hill = [False] * len(self.kids)
            self.bot_hill[i] = random.random() < hill_p
        hx, hy = self.crown_next if self.crown_move_at and self.crown_next else self.hill_xy   # regroup where it lands
        dh = math.hypot(hx - k.x, hy - k.y)
        if self.crown_open and (self.bot_hill[i] or dh < 3.0):
            a = now * 1.3 + i
            gx, gy = hx + math.cos(a) * 0.6, hy + math.sin(a) * 0.6
        elif not self.crown_open and level == "hard" and 0 < self.crown_at - now < 4:
            gx, gy = hx + (k.x - hx) * 0.3, hy + (k.y - hy) * 0.3   # be there when it lands
        if not k.item and self.gifts:
            g = min(self.gifts, key=lambda g: math.hypot(g[1] - k.x, g[2] - k.y))
            dg = math.hypot(g[1] - k.x, g[2] - k.y)
            if dg < reach and (dg < 3.0 or not (self.crown_open and self.bot_hill[i] and dh < HILL_R)):
                gx, gy = g[1], g[2]
        if level != "easy":   # out of a rival's slush
            for x, y, until, owner in self.slush:
                if self.foes(i, owner) and math.hypot(k.x - x, k.y - y) < SLUSH_R + 0.2:
                    ax, ay = k.x - x, k.y - y
                    m = math.hypot(ax, ay) or 1.0
                    gx, gy = x + ax / m * (SLUSH_R + 1.0), y + ay / m * (SLUSH_R + 1.0)
                    break
        if k.item and random.random() < use_rate:
            if k.item == "decoy":
                danger = any(b[7] != i and self.foes(i, b[7]) and math.hypot(b[2] - k.x, b[3] - k.y) < BIG_SPLASH + BODY for b in self.balls)
                if danger or k.pips >= 1 or (self.crown_open and dh < HILL_R) or level == "easy":
                    self.use(i, now)
            elif j is not None:
                t = self.kids[j]
                if math.hypot(t.x - k.x, t.y - k.y) < 8 and now >= t.frozen_until and (level == "easy" or k.item != "slush" or self.crown_open or t.pips >= 1 or level == "normal"):
                    self.use(i, now)
        return gx, gy

    def bot_ready(self):
        return False   # bots think inside frame()

    # -- the rest of the contract

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        r = self.room
        r.add_log(f"{p.name} went home to dry off.")
        left = r.contenders()
        if getattr(self, "teams", False) and r.phase == "playing" and left and len({self.side(self.seat(o)) for o in left}) == 1:
            r.add_log("The other side has gone home.")
            self.end()
        elif len(left) == 1 and r.phase == "playing":
            r.finish(left[0], f"🏳️ Everyone else left — {left[0].name} wins!")
        elif not left and r.phase == "playing":
            r.finish(None, "Everyone left.")
        elif i is not None:
            self.kids[i].sx = self.kids[i].sy = 0.0

    def meta(self, p):
        i = self.seat(p)
        if i is None or not hasattr(self, "kids"):
            return ""
        return f"{self.TEAM_NAMES[self.side(i)][:1]} ❄️ {self.kids[i].points}" if getattr(self, "teams", False) else f"❄️ {self.kids[i].points}"

    def final_scores(self):
        return {pid: self.kids[i].points for i, pid in enumerate(self.seats)}

    def view(self, p):
        now = time.time()
        return {"snowball": {
            **self.state(now), "seats": self.seats, "me": self.seat(p), "len": int(self.s.get("time", 120)),
            "aw": AW, "ah": AH, "body": BODY, "forts": self.fort_xy, "fortLen": FORT_LEN, "fortThick": FORT_THICK, "fortHp": FORT_HP,
            "patches": self.patch_xy, "patchR": PATCH_R, "ammoMax": AMMO, "pips": PIPS, "frozenT": FROZEN, "bigHold": BIG_HOLD, "giantR": GIANT_R,
            "giants": bool(self.s.get("giants", True)), "seq": self.ev_seq, "splash": [SPLASH, BIG_SPLASH],
            "teams": bool(getattr(self, "teams", False)), "team": self.team or list(range(len(self.seats))),
            "speed": [SPEED, PACK_SPEED], "step": STEP,
            "map": self.map, "mapName": MAPS.get(self.map, MAPS["meadow"])["name"], "ice": self.ice, "iceSpeed": [ICE_GRIP, ICE_SPEED],
            "extras": self.extras, "hill": self.hill_xy, "hillR": HILL_R, "hillEvery": HILL_EVERY, "slushR": SLUSH_R,
            "crownPts": CROWN_PTS, "crownMove": CROWN_MOVE, "splashR": [SPLASH, BIG_SPLASH],
            "giftReach": GIFT_REACH, "items": list(ITEMS), "streak": STREAK,
        }}
