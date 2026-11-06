"""Air Hockey: real-time, server-side physics at 60 fps. Each player drags a mallet in their own half;
the server moves mallets toward where fingers are (with a speed cap, so nobody can teleport), bounces
the puck, and streams positions ~30 times a second over the room's fast channel.

Table: x 0..W (left→right), y 0..H. Seat 0 defends the bottom goal (y = H), seat 1 the top (y = 0).
Each browser draws the table from its own side."""
import math
import random
import time

from .base import Game, GameError

W, H = 1.0, 1.6
MALLET, PUCK = 0.075, 0.042
GOAL = 0.34              # goal mouth width
MALLET_SPEED = 4.0       # table units per second
MAX_PUCK = 2.6
FRICTION = 0.35          # fraction of speed lost per second
WALL_BOUNCE, HIT_BOUNCE = 0.9, 0.95
SUBSTEPS = 4
SERVE_PAUSE = 1.2
GOAL_PAUSE = 2.8         # after a goal: time for every screen to show the replay
STUCK_SECS = 5          # a puck that stays in one spot this long is re-served in its half
BOT = {  # reaction interval (s), mallet speed, aim noise
    "easy": (0.3, 1.6, 0.2),
    "normal": (0.14, 2.5, 0.1),
    "hard": (0.05, 3.6, 0.03),
}


class Puck:
    def __init__(self, x, y):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0


class Hockey(Game):
    id = "hockey"
    category = "action"
    howto = [
        "Drag your mallet around your half of the table.",
        "Smash the puck into the goal at the far end. Bank shots off the walls count!",
        "First to the target score wins. 🔥 At match point the puck gets faster.",
        "🏒🏒 Double Trouble puts two pucks on the table.",
    ]
    name = "Air Hockey"
    icon = "🏒"
    blurb = "Real-time table hockey. Drag your mallet, bank it off the walls, defend your goal."
    min_players = 2
    max_players = 2
    replayable = False
    settings_schema = {
        "target": ("First to", [(5, "5 goals"), (7, "7 goals"), (3, "3 goals (quick)")], 5),
        "pucks": ("Pucks", [(1, "🏒 One"), (2, "🏒🏒 Double Trouble")], 1),
        "widen": ("🥅 Leader's goal widens", [(False, "Off"), (True, "On: each goal of lead widens your goal")], False),
    }

    def goal_w(self, seat):
        """The goal `seat` defends: wider for the leader with 🥅 on (+15% per goal of lead, up to +50%)."""
        if not self.s.get("widen"):
            return GOAL
        lead = self.score[seat] - self.score[1 - seat]
        return GOAL * min(1.5, 1 + 0.15 * max(0, lead))

    # -- setup

    def start(self, seated, rng):
        rng.shuffle(seated)
        self.seats = [p.id for p in seated]
        self.score = [0, 0]
        self.mallets = [[W / 2, H - 0.18], [W / 2, 0.18]]
        self.mvel = [[0.0, 0.0], [0.0, 0.0]]
        self.targets = [list(m) for m in self.mallets]
        self.pucks = []
        self.last_frame = None
        self.paused_until = 0.0
        self.frames = 0
        self.hits = 0
        self.bot_next = [0.0, 0.0]
        self.caps = [MALLET_SPEED, MALLET_SPEED]  # bots get their level's speed
        self.aims = [None, None]
        self.still = []  # per puck: [x, y, seconds] it has stayed within 6 cm of that spot
        self.room.turn = None
        self.room.deadline = None
        self.room.add_log(f"🏒 Face-off! {seated[0].name} (bottom) vs {seated[1].name} (top). First to {self.s['target']}.", "big")
        for i in range(self.s["pucks"]):
            self.serve(i, rng.choice([0, 1]), time.time())

    def serve(self, idx, side, now):
        """Put puck idx on `side`'s half (the side that conceded) and pause briefly."""
        x = W / 2 + (0.18 if idx else -0.18 if self.s["pucks"] > 1 else 0)
        y = H * (0.68 if side == 0 else 0.32)
        p = Puck(x, y)
        if idx < len(self.pucks):
            self.pucks[idx] = p
            self.still[idx] = [x, y, 0.0]
        else:
            self.pucks.append(p)
            self.still.append([x, y, 0.0])
        self.paused_until = now + SERVE_PAUSE

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    # -- input

    def act(self, p, a):
        raise GameError("Drag your mallet to play.")

    def on_input(self, p, a):
        i = self.seat(p)
        x, y = a.get("x"), a.get("y")
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)):
            raise GameError("Bad position.")
        self.targets[i] = self.clamp(i, x, y)
        self.caps[i] = MALLET_SPEED

    @staticmethod
    def clamp(i, x, y):
        x = min(W - MALLET, max(MALLET, x))
        lo, hi = (H / 2 + MALLET, H - MALLET) if i == 0 else (MALLET, H / 2 - MALLET)
        return [x, min(hi, max(lo, y))]

    # -- physics

    def frame(self, now):
        """Advance the simulation to `now`. Returns True when the full view must be re-sent."""
        if self.last_frame is None:
            self.last_frame = now
            return False
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot:
                self.bot_think(i, p.bot, now)
        changed = False
        h = dt / SUBSTEPS
        for _ in range(SUBSTEPS):
            self.move_mallets(h)
            if now >= self.paused_until:
                for k, pk in enumerate(self.pucks):
                    scorer = self.move_puck(pk, h)
                    if scorer is not None:
                        changed = True
                        if self.goal(scorer, k, now):
                            return True
        if now >= self.paused_until:
            for k, pk in enumerate(self.pucks):
                st = self.still[k]
                if math.hypot(pk.x - st[0], pk.y - st[1]) < 0.06:
                    st[2] += dt
                else:
                    self.still[k] = [pk.x, pk.y, 0.0]
                if st[2] > STUCK_SECS:
                    self.room.add_log("🧊 Stuck puck — re-serving it.")
                    self.serve(k, 0 if pk.y > H / 2 else 1, now)
                    changed = True
        if self.frames % 2 == 0:
            self.broadcast(now)
        return changed

    def move_mallets(self, h):
        for i in range(2):
            (mx, my), (tx, ty) = self.mallets[i], self.targets[i]
            dx, dy = tx - mx, ty - my
            d = math.hypot(dx, dy)
            step = min(d, self.caps[i] * h)
            nx, ny = (mx + dx / d * step, my + dy / d * step) if d > 1e-9 else (mx, my)
            self.mvel[i] = [(nx - mx) / h, (ny - my) / h]
            self.mallets[i] = [nx, ny]

    def match_point(self):
        """Either player one goal from winning: the puck runs faster and slows down less."""
        return max(self.score) >= self.s["target"] - 1

    def move_puck(self, pk, h):
        """Move one puck a substep. Returns the scoring seat if it went into a goal."""
        decay = max(0.0, 1 - FRICTION * (0.6 if self.match_point() else 1) * h)
        pk.vx *= decay
        pk.vy *= decay
        pk.x += pk.vx * h
        pk.y += pk.vy * h
        in_mouth = abs(pk.x - W / 2) < self.goal_w(1 if pk.y < H / 2 else 0) / 2  # the top goal is seat 1's
        if pk.y < -PUCK:
            return 0
        if pk.y > H + PUCK:
            return 1
        for i in range(2):
            mx, my = self.mallets[i]
            dx, dy = pk.x - mx, pk.y - my
            d = math.hypot(dx, dy)
            if 0 < d < MALLET + PUCK:
                nx, ny = dx / d, dy / d
                pk.x, pk.y = mx + nx * (MALLET + PUCK), my + ny * (MALLET + PUCK)
                rvx, rvy = pk.vx - self.mvel[i][0], pk.vy - self.mvel[i][1]
                dot = rvx * nx + rvy * ny
                if dot < 0:
                    pk.vx -= (1 + HIT_BOUNCE) * dot * nx
                    pk.vy -= (1 + HIT_BOUNCE) * dot * ny
                    self.hits += 1
        if pk.x < PUCK:
            pk.x, pk.vx = PUCK, abs(pk.vx) * WALL_BOUNCE
        elif pk.x > W - PUCK:
            pk.x, pk.vx = W - PUCK, -abs(pk.vx) * WALL_BOUNCE
        if not in_mouth:
            if pk.y < PUCK:
                pk.y, pk.vy = PUCK, abs(pk.vy) * WALL_BOUNCE
            elif pk.y > H - PUCK:
                pk.y, pk.vy = H - PUCK, -abs(pk.vy) * WALL_BOUNCE
        for i in range(2):  # a puck pinned against a wall pushes the mallet back, not through the wall
            mx, my = self.mallets[i]
            dx, dy = pk.x - mx, pk.y - my
            d = math.hypot(dx, dy)
            if 0 < d < MALLET + PUCK:
                self.mallets[i] = self.clamp(i, pk.x - dx / d * (MALLET + PUCK), pk.y - dy / d * (MALLET + PUCK))
        sp = math.hypot(pk.vx, pk.vy)
        top = MAX_PUCK * (1.25 if self.match_point() else 1)  # 🔥 match point: a livelier puck
        if sp > top:
            pk.vx, pk.vy = pk.vx / sp * top, pk.vy / sp * top
        return None

    def goal(self, scorer, k, now):
        """Returns True if the game ended."""
        self.score[scorer] += 1
        r = self.room
        who = r.players.get(self.seats[scorer])
        name = who.name if who else "?"
        r.add_log(f"🚨 GOAL! {name} scores — {self.score[0]} : {self.score[1]}", "big" if max(self.score) >= self.s["target"] else "power")
        if self.score[scorer] >= self.s["target"]:
            r.finish(who, f"🏆 {name} wins {max(self.score)}–{min(self.score)}!")
            return True
        self.serve(k, 1 - scorer, now)
        self.paused_until = now + GOAL_PAUSE
        self.broadcast(now)
        return False

    def broadcast(self, now):
        r2 = lambda v: round(v, 4)
        self.room.push_fast({
            "pk": [[r2(p.x), r2(p.y), r2(p.vx), r2(p.vy)] for p in self.pucks],
            "ml": [[r2(x), r2(y)] for x, y in self.mallets],
            "sc": self.score, "pause": round(max(0.0, self.paused_until - now), 2),
        })

    # -- bots: line up behind the puck on the line to a chosen aim point, then strike through it

    def bot_think(self, i, level, now):
        react, speed, noise = BOT[level]
        if now < self.bot_next[i]:
            return
        self.bot_next[i] = now + react
        self.caps[i] = speed
        home_y = H - 0.12 if i == 0 else 0.12
        goal_y = -0.05 if i == 0 else H + 0.05  # the goal this bot attacks
        toward_me = lambda q: q.vy > 0 if i == 0 else q.vy < 0
        mine = [pk for pk in self.pucks if (pk.y > H / 2) == (i == 0)]
        mx, my = self.mallets[i]
        if not mine or now < self.paused_until:
            # guard: shadow the most dangerous puck between it and our goal
            pk = min(self.pucks, key=lambda q: abs(q.y - home_y) - (0.3 if toward_me(q) else 0))
            target = (W / 2 + (pk.x - W / 2) * 0.5, home_y)
            self.aims[i] = None
        else:
            pk = min(mine, key=lambda q: math.hypot(q.x - mx, q.y - my))
            behind_puck = (pk.y > my + 0.01) if i == 0 else (pk.y < my - 0.01)
            if self.aims[i] is None:  # pick a spot in (or banked toward) the goal once per attack
                bank = random.random() < (0.15 if level == "easy" else 0.3)
                aim = random.choice([-0.9, 1.9]) * W if bank else W / 2 + random.uniform(-0.6, 0.6) * GOAL / 2
                self.aims[i] = aim + random.gauss(0, noise)
            lead = {"easy": 0.0, "normal": 0.08, "hard": 0.14}[level]
            px, py = pk.x + pk.vx * lead, pk.y + pk.vy * lead
            ax, ay = self.aims[i] - px, goal_y - py
            d = math.hypot(ax, ay) or 1
            ux, uy = ax / d, ay / d
            if behind_puck and math.hypot(pk.vx, pk.vy) < 0.4:  # slow puck behind us (often in a corner): jab it
                target = (pk.x, pk.y)
            elif behind_puck:  # it got past us: swing round it, back toward our goal
                target = (px + (0.16 if px < W / 2 else -0.16), home_y)
            else:
                line_x, line_y = px - ux * (MALLET + PUCK + 0.03), py - uy * (MALLET + PUCK + 0.03)
                # how well we're lined up: close to the approach point = strike through the puck
                if math.hypot(mx - line_x, my - line_y) < 0.06 or toward_me(pk) and math.hypot(pk.x - mx, pk.y - my) < 0.25:
                    target = (px + ux * 0.25, py + uy * 0.25)
                else:
                    target = (line_x, line_y)
        tx = target[0] + random.gauss(0, noise * 0.15)
        ty = target[1] + random.gauss(0, noise * 0.15)
        self.targets[i] = self.clamp(i, tx, ty)

    # -- the rest of the game contract

    def bot_ready(self):
        return False  # bots play inside frame()

    def on_leave(self, p):
        r = self.room
        i = self.seat(p)
        other = r.players.get(self.seats[1 - i]) if i is not None else None
        p.eliminated = True
        if other:
            r.finish(other, f"🏳️ {p.name} left — {other.name} wins!")
        else:
            r.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{'⬇️' if i == 0 else '⬆️'} {self.score[i]}"

    def final_scores(self):
        return {pid: self.score[i] for i, pid in enumerate(self.seats)}

    def view(self, p):
        return {"hockey": {
            "W": W, "H": H, "mallet": MALLET, "puck": PUCK, "goal": GOAL, "goals": [self.goal_w(0), self.goal_w(1)], "seats": self.seats, "me": self.seat(p),
            "score": self.score, "target": self.s["target"],
            "pk": [[pk.x, pk.y, pk.vx, pk.vy] for pk in self.pucks], "ml": self.mallets,
        }}
