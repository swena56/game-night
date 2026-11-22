"""Lane Night: tenpin bowling for 1–6 players, everyone on their own lane at once.

Each player bowls their own frames as fast as they like (nobody may get more than two frames ahead of the
slowest player still bowling). A roll sets where you stand on the foul line, the line you send the ball
down, its speed and how much it hooks. The server rolls the ball through the oil and into the pins in 2D
(x across the lane, y down it, metres) and sends the ball's and the moving pins' tracks back for the
browser to play in 3D. Scoring is standard tenpin scoring (strikes, spares, bonus balls in the last frame).

🌟 Cosmic frame: one frame of the game is lit up for everyone, and a strike or spare in it scores +10 more.
🎯 Spare saver: once a game, arm it on a spare ball: if that ball leaves exactly one pin, the pin falls too.
"""
import math
import random
import time

from .base import Game, GameError

LANE = 1.05           # lane width; gutters lie beyond ±LANE/2
HEAD = 18.29          # the head pin, from the foul line
PIT = HEAD + 0.95     # the ball and any pin past this drop into the pit
SPACE = 0.3048        # pin spacing
ROW = SPACE * math.sqrt(3) / 2
PIN_R, BALL_R = 0.06, 0.109
M_BALL, M_PIN = 7.0, 1.6
REST_BP, REST_PP = 0.55, 0.7
PIN_DECEL = 2.0       # a knocked pin slides and tumbles to a stop
PIN_FALL = 0.10       # a falling pin sweeps a wider circle than a standing one (it is 38 cm tall)
BALL_DECEL = 0.25
LIP = 0.02           # a grazing ball can hook back before it falls into the channel
GUTTER_DECEL = 0.55
HOOK = 2.2            # m/s² sideways at full spin on dry boards
VMIN, VMAX = 5.5, 9.5
DT = 1 / 120
FRAME = 4
MAX_T = 7.0
OIL = {"dry": 9.0, "medium": 12.0, "slick": 14.5}   # oil length: the ball only hooks past it
LEAD = 2              # frames a player may get ahead of the slowest one still bowling
BOT_LEAD = 0          # bots never get ahead of the slowest human still bowling (#110)
WEAR = 0.18           # 🛢️ each ball you roll carries some oil off your lane (metres of oil length)
WEAR_MAX = 3.0        # ...down to this much below where it started (never under WEAR_MIN)
WEAR_MIN = 6.0
WEIGHTS = [(5.2, 1.06, 1.25), (7.0, 1.0, 1.0), (8.6, 0.95, 0.8)]   # ⚖️ light / medium / heavy ball: (mass kg, speed factor, hook factor)
IDLE = 75             # seconds before a bowler who's ready but idle gets an automatic roll


def pin_spots():
    out = []
    for r in range(4):
        for c in range(r + 1):
            out.append((round((-r / 2 + c) * SPACE, 4), round(HEAD + r * ROW, 4)))
    return out


SPOTS = pin_spots()


def roll(standing, start, angle, speed, spin, oil, record=True, weight=1):
    """Roll a ball from (start, 0) at `angle` (radians, + is to the right) with `speed` 0..1 and `spin` -1..1
    (+ hooks to the left) at the pins still `standing` (a list of pin indices). Returns (knocked pin indices,
    tracks, gutter): tracks has "ball": [[x, y], ...] and "pins": [{k, s, f}] for each pin that moved."""
    m_ball, vk, hk = WEIGHTS[weight]
    v = (VMIN + (VMAX - VMIN) * speed) * vk
    bx, by = start, 0.0
    vx, vy = v * math.sin(angle), v * math.cos(angle)
    pins = {k: [SPOTS[k][0], SPOTS[k][1], 0.0, 0.0] for k in standing}
    hit = set()
    gone = set()      # pins off the deck (pit or gutter)
    gutter = False
    ball_on = True
    ball_f = [[round(bx, 3), round(by, 3)]]
    tracks = {}
    t, step = 0.0, 0
    while t < MAX_T:
        t += DT
        step += 1
        if ball_on:
            sp = math.hypot(vx, vy)
            if sp > 0:
                k = max(0.0, sp - (GUTTER_DECEL if gutter else BALL_DECEL) * DT) / sp
                vx, vy = vx * k, vy * k
            if not gutter and by > oil:
                vx -= spin * HOOK * hk * DT * min(1.0, (by - oil) / 2 + 0.3)
            bx += vx * DT
            by += vy * DT
            if not gutter and abs(bx) > LANE / 2:
                can_hook_back = by > oil and bx * spin > 0 and abs(bx) < LANE / 2 + LIP
                if not can_hook_back:
                    gutter = True
            if gutter:
                channel = math.copysign(LANE / 2 + BALL_R * 0.9, bx)
                bx += (channel - bx) * min(1, 28 * DT)
                vx = 0.0
            if by > PIT:
                ball_on = False
        # ball against pins
        if ball_on and not gutter and abs(bx) <= LANE / 2:
            for k, p in pins.items():
                if k in gone:
                    continue
                dx, dy = p[0] - bx, p[1] - by
                d = math.hypot(dx, dy)
                if 0 < d < PIN_R + BALL_R:
                    nx, ny = dx / d, dy / d
                    over = PIN_R + BALL_R - d
                    p[0] += nx * over
                    p[1] += ny * over
                    rel = (vx - p[2]) * nx + (vy - p[3]) * ny
                    if rel > 0:
                        j = (1 + REST_BP) * rel / (1 / m_ball + 1 / M_PIN)
                        vx -= j / m_ball * nx
                        vy -= j / m_ball * ny
                        p[2] += j / M_PIN * nx
                        p[3] += j / M_PIN * ny
                    hit.add(k)
                    if record and k not in tracks:
                        tracks[k] = {"k": k, "s": step // FRAME, "f": [[round(p[0], 3), round(p[1], 3)]]}
        # pins move and knock each other
        ks = [k for k in pins if k not in gone]
        for k in ks:
            p = pins[k]
            sp = math.hypot(p[2], p[3])
            if sp > 0:
                m = max(0.0, sp - PIN_DECEL * DT) / sp
                p[2] *= m
                p[3] *= m
                p[0] += p[2] * DT
                p[1] += p[3] * DT
                if abs(p[0]) > LANE / 2 + 0.12 or p[1] > PIT + 0.2:
                    gone.add(k)
        for a in range(len(ks)):
            pa = pins[ks[a]]
            for b in range(a + 1, len(ks)):
                pb = pins[ks[b]]
                dx, dy = pb[0] - pa[0], pb[1] - pa[1]
                d = math.hypot(dx, dy)
                reach = (PIN_FALL if ks[a] in hit else PIN_R) + (PIN_FALL if ks[b] in hit else PIN_R)
                if 0 < d < reach:
                    nx, ny = dx / d, dy / d
                    rel = (pa[2] - pb[2]) * nx + (pa[3] - pb[3]) * ny
                    over = (reach - d) * 0.5
                    pa[0] -= nx * over / 2
                    pa[1] -= ny * over / 2
                    pb[0] += nx * over / 2
                    pb[1] += ny * over / 2
                    if rel > 0:
                        j = (1 + REST_PP) * rel / 2
                        pa[2] -= j * nx
                        pa[3] -= j * ny
                        pb[2] += j * nx
                        pb[3] += j * ny
                    for k, p in ((ks[a], pa), (ks[b], pb)):
                        if k not in hit and math.hypot(p[2], p[3]) > 0.05:
                            hit.add(k)
                            if record and k not in tracks:
                                tracks[k] = {"k": k, "s": step // FRAME, "f": [[round(p[0], 3), round(p[1], 3)]]}
        if record and step % FRAME == 0:
            if ball_on:
                ball_f.append([round(bx, 3), round(by, 3)])
            for k, tr in tracks.items():
                if tr.get("out"):
                    continue
                p = pins[k]
                tr["f"].append([round(p[0], 3), round(p[1], 3)])
                if k in gone:
                    tr["out"] = True
        if not ball_on and all(math.hypot(pins[k][2], pins[k][3]) < 1e-3 or k in gone for k in pins):
            break
    if record and ball_on:
        ball_f.append([round(bx, 3), round(by, 3)])
    knocked = sorted(hit)
    return knocked, {"ball": ball_f, "pins": list(tracks.values())}, gutter


def frame_rolls(rolls, nframes):
    """Split a flat list of pin counts into frames: [[r1, r2?], ..., [last frame's up to 3]]."""
    frames, i = [], 0
    while i < len(rolls) and len(frames) < nframes - 1:
        if rolls[i] == 10:
            frames.append([10])
            i += 1
        else:
            frames.append(rolls[i:i + 2])
            i += 2
    if i < len(rolls):
        frames.append(rolls[i:i + 3])
    return frames


def score(rolls, nframes, cosmic=None):
    """Cumulative score after each frame (None while a bonus is still to come)."""
    frames = frame_rolls(rolls, nframes)
    out, total, i = [], 0, 0
    for f, fr in enumerate(frames):
        last = f == nframes - 1
        if last:
            done = len(fr) == 3 or (len(fr) == 2 and sum(fr) < 10)
            if not done:
                out.append(None)
                break
            total += sum(fr)
            mark = fr[0] == 10 or fr[0] + fr[1] == 10
        elif fr[0] == 10:
            nxt = rolls[i + 1:i + 3]
            if len(nxt) < 2:
                out.append(None)
                break
            total += 10 + sum(nxt)
            mark = True
            i += 1
        else:
            if len(fr) < 2:
                out.append(None)
                break
            if sum(fr) == 10:
                if len(rolls) <= i + 2:
                    out.append(None)
                    break
                total += 10 + rolls[i + 2]
                mark = True
            else:
                total += sum(fr)
                mark = False
            i += 2
        if f == cosmic and mark:
            total += 10
        out.append(total)
    return out


class Lanes(Game):
    id = "lanes"
    category = "action"
    family = None
    howto = [
        "Everyone bowls their own lane at the same time. Set where you stand (◀ ▶) and the hook, then drag back from the ball and let go: the drag sets the line and the speed.",
        "The ball skids straight through the oil, then hooks the way you spun it. Aim for the pocket, just beside the head pin.",
        "📉 Your lane's oil breaks down as you bowl, so the hook starts earlier and earlier: ease the spin, or move your start and aim, to keep finding the pocket.",
        "Standard scoring: a strike (all 10 with the first ball) scores 10 + your next two balls, a spare 10 + your next ball. Bonus balls in the last frame.",
        "🌟 The cosmic frame is lit up for everyone: a strike or spare in it scores +10 more. 🎯 Once a game, arm the spare saver on a spare ball: if it leaves exactly one pin, that pin falls too.",
        "Highest total wins. Nobody can get more than two frames ahead of the slowest bowler.",
    ]
    name = "Lane Night"
    icon = "🎳"
    blurb = "Bowl your own 3D lane while everyone else bowls theirs: hook it into the pocket, chase strikes, light up the cosmic frame."
    min_players = 1
    max_players = 6
    badges = {**Game.badges,
              "turkey": ("🦃", "Turkey", "Three strikes in a row"),
              "split": ("🪓", "Split converted", "Pick up a spare with pins left on both sides")}
    settings_schema = {
        "frames": ("Frames", [(10, "10"), (5, "5")], 10),
        "oil": ("Oil", [("medium", "🛢️ Medium"), ("dry", "🏜️ Dry (big hook)"), ("slick", "💧 Slick (little hook)")], "medium"),
        "wear": ("Lane oil", [("on", "📉 Breaks down"), ("off", "Steady")], "on"),
    }

    finish_at = 0

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.nframes = int(self.s.get("frames", 10))
        self.oil = OIL.get(self.s.get("oil", "medium"), 12.0)
        self.wear = self.s.get("wear", "on") != "off"
        self.cosmic = rng.randrange(1, self.nframes - 1) if self.nframes > 3 else 0
        self.shot_id = 0
        self.finish_at = 0  # everyone's done: the game ends once the last roll has played out (#130)
        r = self.room
        r.turn = None
        now = time.time()
        for p in seated:
            g = p.g
            g.rolls, g.standing, g.frame, g.ball = [], list(range(10)), 0, 0
            g.done, g.busy, g.shot, g.saver, g.last = False, now, None, True, None
            g.woke = True
            g.next_at = now + random.uniform(1.5, 3.0)
            g.streak = 0
            g.splits, g.saved = [], []  # roll numbers: a first ball that left a split, a ball the spare saver finished
            g.oil = self.oil
        r.deadline = now + IDLE
        r.bot_at = 0
        r.add_log(f"🎳 Lane Night: {self.nframes} frames each, everyone at once. 🌟 Frame {self.cosmic + 1} is the cosmic frame.", "big")

    def players(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players]

    def bowlers(self):
        return [p for p in self.players() if not p.eliminated and not getattr(p.g, "done", True)]

    def can_bowl(self, p):
        g = p.g
        if g.done or p.eliminated:
            return "You've finished your frames."
        if time.time() < g.busy - 0.3:
            return "Wait for the pins to settle."
        if g.ball == 0:
            others = [o.g.frame for o in self.bowlers() if o is not p]
            if others and g.frame > min(others) + LEAD:
                return "Wait for the others to catch up."
            if p.bot:
                humans = [o.g.frame for o in self.bowlers() if not o.bot]
                if humans and g.frame > min(humans) + BOT_LEAD:
                    g.held = True
                    return "Wait for the others to catch up."
        return None

    def fresh_rack(self, g, last_frame):
        """True when this ball is the first at a full rack: ball 1 of a frame, or a last-frame bonus ball after a mark."""
        if not last_frame:
            return g.ball == 0
        fr = frame_rolls(g.rolls, self.nframes)
        r = fr[-1] if len(fr) == self.nframes else []
        if len(r) == 0:
            return True
        if len(r) == 1:
            return r[0] == 10
        return r[1] == 10 if r[0] == 10 else r[0] + r[1] == 10

    def spare_ball(self, g):
        """True when this ball is a try at a spare (pins already down in this frame)."""
        return len(g.standing) < 10 and g.ball > 0

    def act(self, p, a):
        if a.get("type") != "bowl":
            raise GameError("Unknown action.")
        if p.id not in self.seats:
            raise GameError("You're not in this game.")
        why = self.can_bowl(p)
        if why:
            raise GameError(why)
        vals = [a.get(k) for k in ("start", "angle", "speed", "spin")]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in vals):
            raise GameError("Bad roll.")
        start, angle, speed, spin = (float(v) for v in vals)
        if not (-LANE / 2 + BALL_R <= start <= LANE / 2 - BALL_R and -0.12 <= angle <= 0.12 and 0 <= speed <= 1 and -1 <= spin <= 1):
            raise GameError("Bad roll.")
        wt = a.get("weight", 1)
        if wt not in (0, 1, 2) or isinstance(wt, bool):
            raise GameError("Bad roll.")
        saver = a.get("saver", False)
        if not isinstance(saver, bool):
            raise GameError("Bad roll.")
        if saver and not (p.g.saver and self.spare_ball(p.g)):
            raise GameError("The spare saver can't be used now.")
        self.bowl(p, start, angle, speed, spin, saver, wt)

    def oil_for(self, p):
        """🛢️ Your lane's oil length right now: it wears off ball by ball, so the hook starts earlier as you go."""
        return getattr(p.g, "oil", self.oil)

    def bowl(self, p, start, angle, speed, spin, saver=False, weight=1):
        g = p.g
        before = list(g.standing)
        knocked, tracks, gutter = roll(before, start, angle, speed, spin, self.oil_for(p), weight=weight)
        left = [k for k in before if k not in knocked]
        saved = None
        if saver and len(left) == 1:
            saved = left[0]
            knocked = sorted(knocked + left)
            left = []
            g.saver = False
        n = len(knocked)
        frames = max([len(tracks["ball"])] + [tr["s"] + len(tr["f"]) for tr in tracks["pins"]])
        lands = time.time() + frames / 30  # the shot plays out on screen: say its callouts when the pins land (#129)
        last_frame = g.frame == self.nframes - 1
        first = self.fresh_rack(g, last_frame)  # (not "all ten standing": a gutter first ball leaves ten too)
        g.rolls.append(n)
        if first and left and self.is_split(left):
            getattr(g, "splits", None) is None and setattr(g, "splits", [])
            g.splits.append(len(g.rolls) - 1)
        if saved is not None:
            getattr(g, "saved", None) is None and setattr(g, "saved", [])
            g.saved.append(len(g.rolls) - 1)
        nm = p.name
        word = None
        if first and n == 10:
            word = "strike"
            g.streak += 1
        elif not first and not left:
            word = "spare"
            g.streak = 0
            if self.is_split(before):
                self.award(p, "split", at=lands)
                self.moment(f"🪓 {nm} picks up the split!", "gold", "good", at=lands)
        elif first:
            pass
        else:
            g.streak = 0
        if word == "strike":
            if g.streak == 3:
                self.award(p, "turkey", at=lands)
                self.moment(f"🦃 {nm}: TURKEY!", "gold", "fanfare", at=lands)
            elif g.streak > 3:
                self.moment(f"🔥 {nm}: {g.streak} strikes in a row!", "gold", "fanfare", at=lands)
            self.room.add_log(f"🎳 {nm}: STRIKE{' 🌟' if g.frame == self.cosmic else ''}!", "power", at=lands)
        elif word == "spare":
            self.room.add_log(f"🎳 {nm}: spare{' with the 🎯 saver' if saved is not None else ''}{' 🌟' if g.frame == self.cosmic else ''}.", "info", at=lands)
        elif gutter and n == 0:
            self.room.add_log(f"🎳 {nm}: gutter ball.", "info", at=lands)
        # advance the frame
        if self.wear:   # this ball took some oil with it: the next one hooks a little earlier
            floor = max(min(self.oil, WEAR_MIN), self.oil - WEAR_MAX)
            g.oil = max(floor, round(self.oil_for(p) - WEAR, 3))
        g.ball += 1
        if last_frame:
            rolls = frame_rolls(g.rolls, self.nframes)[-1]
            if len(rolls) == 3 or (len(rolls) == 2 and sum(rolls) < 10):
                g.done = True
            elif not left:
                g.standing = list(range(10))
            else:
                g.standing = left
        elif (first and n == 10) or not first:
            g.frame += 1
            g.ball = 0
            g.standing = list(range(10))
        else:
            g.standing = left
        self.shot_id += 1
        g.shot = {"id": self.shot_id, "before": before, "knocked": knocked, "tracks": tracks, "frames": frames,
                  "word": word, "saved": saved, "gutter": gutter}
        kmh = round((VMIN + (VMAX - VMIN) * speed) * WEIGHTS[weight][1] * 3.6, 1)  # the ball speed metric (#131)
        g.last = {"n": n, "word": word, "at": time.time(), "kmh": kmh}
        g.top = max(getattr(g, "top", 0), kmh)
        g.busy = time.time() + frames / 30 + 1.2
        g.woke = False
        g.next_at = g.busy + random.uniform(0.6, 2.0)
        self.room.deadline = time.time() + IDLE
        self.after_roll(p, lands)
        if g.done:
            total = self.total(p)
            self.room.add_log(f"🏁 {nm} finishes on {total}.", "big", at=lands)
            if all(o.g.done for o in self.players() if not o.eliminated):
                # not yet: let the last roll play, then the final scoresheet sit a moment (#130)
                self.finish_at = g.busy + 1.6

    LEAD_FROM = 3   # 👑 lead calls start once everyone has bowled about this many balls

    def after_roll(self, p, lands):
        """👑 Call a new outright leader (once the game has settled in) and 💯 a perfect game (every ball a strike)."""
        g = p.g
        ps = [q for q in self.players() if not q.eliminated and getattr(q.g, "rolls", None)]
        if len(ps) >= 2 and min(len(q.g.rolls) for q in ps) >= self.LEAD_FROM:
            tot = {q.id: self.total(q) for q in ps}
            top = max(tot.values())
            lead = [q for q in ps if tot[q.id] == top]
            if len(lead) == 1:
                cur = getattr(self, "leader", None)
                self.leader = lead[0].id
                if cur is not None and cur != lead[0].id:
                    self.moment(f"👑 {lead[0].name} takes the lead with {top}!", "cool", "tag", at=lands)
        if g.done and len(g.rolls) == self.nframes + 2 and all(r == 10 for r in g.rolls):
            self.moment(f"💯 {p.name}: PERFECT GAME!", "gold", "fanfare", at=lands)

    @staticmethod
    def is_split(standing):
        """Pins left after the first ball with the head pin down and a gap between them across the lane."""
        if 0 in standing or len(standing) < 2:
            return False
        xs = sorted(SPOTS[k][0] for k in standing)
        return any(b - a > SPACE * 1.4 for a, b in zip(xs, xs[1:]))

    def total(self, p):
        s = [v for v in score(p.g.rolls, self.nframes, self.cosmic) if v is not None]
        return s[-1] if s else 0

    def finish_game(self):
        r = self.room
        ps = [p for p in self.players() if not p.eliminated]
        if not ps:
            return r.finish(None, "Everyone left.")
        ranked = sorted(ps, key=self.total, reverse=True)
        top = self.total(ranked[0])
        tied = [p for p in ranked if self.total(p) == top]
        if len(tied) > 1:
            return r.finish(None, f"🤝 A tie on {top} between {' & '.join(p.name for p in tied)}.")
        if len(ps) == 1:
            return r.finish(ranked[0], f"🎳 {ranked[0].name} bowls a {top}!")
        return r.finish(ranked[0], f"🏆 {ranked[0].name} wins Lane Night with {top}!")

    def on_timeout(self):
        # someone's been idle: roll a plain ball for every human who could bowl (the pins have long
        # settled by now; settling them here also lets simulate.py fast-forward)
        now = time.time()
        if self.finish_at:
            self.finish_at = 0
            return self.finish_game()
        for p in self.bowlers():
            p.g.busy = min(p.g.busy, now)
        for p in self.bowlers():
            if not p.bot and not self.can_bowl(p):
                self.room.add_log(f"⏰ {p.name} was idle: an automatic roll.", "power")
                self.bowl(p, *self.plan(p, "easy"))
        if self.room.phase == "playing":
            self.room.deadline = time.time() + IDLE

    def on_restore(self, shift):
        """The server was down (or the room paused) for `shift` seconds: move every clock on with it."""
        for p in self.players():
            g = getattr(p, "g", None)
            if g is None or not hasattr(g, "busy"):
                continue
            g.busy += shift
            g.next_at = getattr(g, "next_at", 0) + shift
        if self.finish_at:
            self.finish_at += shift

    def on_leave(self, p):
        r = self.room
        p.eliminated = True
        r.add_log(f"{p.name} left the lanes.")
        left = [o for o in self.players() if not o.eliminated]
        if not left:
            return r.finish(None, "Everyone left.")
        if all(o.g.done for o in left):
            self.finish_game()

    # -- bots: aim for the pocket (or the middle of a spare leave), with error by level

    def plan(self, p, level):
        g = p.g
        standing = g.standing
        rng = random
        hand = getattr(g, "hand", None)
        if hand is None:
            hand = g.hand = rng.choice((1, 1, 1, -1))   # most bowlers hook it to the left
        if len(standing) == 10:
            tx = 0.07 * hand      # the pocket
            spin = 0.55 * hand
        else:
            xs = [SPOTS[k][0] for k in standing]
            tx = sum(xs) / len(xs)
            spin = 0.2 * hand
        best, best_n = None, -1
        tries = {"easy": 3, "normal": 10, "hard": 22}.get(level, 10)
        for _ in range(tries):
            start = max(-0.4, min(0.4, 0.22 * hand + rng.uniform(-0.15, 0.15)))
            sp = rng.uniform(0.45, 0.8)
            s = max(-1.0, min(1.0, spin + rng.uniform(-0.25, 0.25)))
            # aim at the target allowing for the hook (found by a short search on the real roll)
            ang = math.atan2(tx - start, HEAD) + rng.uniform(-0.02, 0.02)
            for _ in range(3):
                knocked, tr, _ = roll(standing, start, ang, sp, s, self.oil_for(p), record=True)
                path = tr["ball"]
                at = next((b for b in path if b[1] >= HEAD - 0.3), path[-1])
                ang = max(-0.12, min(0.12, ang + (tx - at[0]) / HEAD))
            knocked, _, _ = roll(standing, start, ang, sp, s, self.oil_for(p), record=False)
            if len(knocked) > best_n:
                best, best_n = (start, ang, sp, s), len(knocked)
        start, ang, sp, s = best
        na, ns = {"easy": (0.012, 0.25), "normal": (0.005, 0.12), "hard": (0.0024, 0.06)}.get(level, (0.005, 0.12))
        ang = max(-0.12, min(0.12, ang + rng.gauss(0, na)))
        s = max(-1.0, min(1.0, s + rng.gauss(0, ns)))
        sp = max(0.0, min(1.0, sp + rng.gauss(0, ns / 3)))
        return round(start, 3), round(ang, 4), round(sp, 3), round(s, 3)

    def sleepers(self, now):
        """Humans whose pins have settled since the last update: their view still says "wait" (#105/#108)."""
        return [p for p in self.bowlers() if not p.bot and not getattr(p.g, "woke", True) and now >= p.g.busy - 0.3]

    def bot_ready(self):
        now = time.time()
        if self.finish_at:
            return now >= self.finish_at
        return bool(self.sleepers(now)) or any(p.bot and now >= p.g.next_at and not self.can_bowl(p) for p in self.bowlers())

    def bot_tick(self):
        now = time.time()
        if self.finish_at:
            if now >= self.finish_at:
                self.finish_at = 0
                self.finish_game()
            return
        for p in self.sleepers(now):
            p.g.woke = True  # the server bumps the room after this, which sends everyone a fresh view
        for p in self.bowlers():
            if self.room.phase != "playing":
                return
            if p.bot and now >= p.g.next_at and not self.can_bowl(p):
                if getattr(p.g, "held", False):  # just let go by a human catching up: don't all fire at once
                    p.g.held = False
                    p.g.next_at = now + random.uniform(0.6, 1.6)
                    continue
                saver = p.g.saver and self.spare_ball(p.g) and len(p.g.standing) <= 2 and p.bot != "easy"
                self.bowl(p, *self.plan(p, p.bot), saver)
                return

    # -- view

    def meta(self, p):
        if p.id not in self.seats or not hasattr(p.g, "rolls"):
            return ""
        g = p.g
        return f"{self.total(p)} · {'🏁' if g.done else f'F{g.frame + 1}'}"

    def final_scores(self):
        return {p.id: self.total(p) for p in self.players()}

    def view(self, p):
        rows = []
        for o in self.players():
            g = o.g
            rows.append({"id": o.id, "frames": frame_rolls(g.rolls, self.nframes), "cum": score(g.rolls, self.nframes, self.cosmic),
                         "frame": g.frame, "ball": g.ball, "done": g.done, "standing": g.standing, "saver": g.saver,
                         "last": g.last, "splits": list(getattr(g, "splits", None) or []), "saved": list(getattr(g, "saved", None) or []), "total": self.total(o), "top": getattr(g, "top", 0)})
        me = p.g if p.id in self.seats else None
        why = self.can_bowl(p) if me is not None else "Watching."
        return {"lanes": {
            "seats": self.seats, "nframes": self.nframes, "cosmic": self.cosmic, "oil": round(self.oil_for(p), 1) if me is not None else self.oil, "oil0": self.oil, "rows": rows,
            "me": self.seats.index(p.id) if me is not None else None,
            "shot": me.shot if me is not None else None,
            "standing": me.standing if me is not None else list(range(10)),
            "spare": bool(me is not None and self.spare_ball(me)), "saver": bool(me is not None and me.saver),
            "wait": why, "busyIn": max(0.0, round(me.busy - time.time(), 2)) if me is not None else 0,
            "lane": {"w": LANE, "head": HEAD, "pit": PIT, "pinR": PIN_R, "ballR": BALL_R, "spots": SPOTS},
        }}
