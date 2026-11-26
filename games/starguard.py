"""Star Guard: a co-op arcade shooter. Everyone's ship slides along the bottom of one shared sky and
fires automatically; waves of aliens march down in formation, dive-bomb and shoot back, and every fifth
wave a boss arrives. Lives are shared, power-ups drop from aliens, and each player has one smart bomb.

The server owns the simulation (like Air Hockey): ships steer toward the finger's x at a capped speed,
frame(now) runs the world at 60 fps and the full snapshot streams ~20 times a second on the fast channel.
Sky: x 0..W, y 0..H (aliens at the top, ships at the bottom)."""
import math
import random
import time

from .base import Game, GameError

W, H = 1.0, 1.6
SHIP_Y = 1.5
SHIP_SPEED = 1.1
SHIP_R = 0.035
BULLET_SPEED = 1.9
ENEMY_BULLET = 0.62
FIRE_EVERY = 0.3
RAPID_EVERY = 0.17
POWER_SECS = 9.0
RESPAWN = 2.0
INVULN = 2.0
INTRO = 2.4
GRID_COLS, GRID_STEP_X, GRID_STEP_Y = 7, 0.105, 0.095
BOTTOM_LINE = 1.36           # an alien that gets this low ends the game
POINTS = {"grunt": 10, "tough": 20, "diver": 30}
UFO_Y, UFO_SPEED, UFO_POINTS = 0.065, 0.24, 100   # 🛸 a bonus saucer crosses the top now and then: shoot it for points and a power-up
UFO_EVERY = (14.0, 24.0)
GRAZE_R, GRAZE_PTS, GRAZE_CALL = 0.075, 3, 10   # 🌀 an enemy bullet slipping past a ship (not hitting) scores; a callout every 10
SUPPLY_SECS = 5.0                                # 🎁 a cleared wave arms every live ship with rapid fire or spread for this long
BOT = {  # reaction interval (s), dodge radius, uses bombs
    "easy": (0.22, 0.05, False),
    "normal": (0.12, 0.08, False),
    "hard": (0.05, 0.11, True),
}


class Alien:
    __slots__ = ("gx", "gy", "hp", "kind", "dive")

    def __init__(self, gx, gy, hp, kind):
        self.gx, self.gy, self.hp, self.kind, self.dive = gx, gy, hp, kind, None  # dive: [x, y, vx]


class Ship:
    def __init__(self, x):
        self.x = self.tx = x
        self.alive = True
        self.respawn = 0.0
        self.invuln = 0.0
        self.shield = False
        self.rapid = 0.0
        self.spread = 0.0
        self.fire_at = 0.0
        self.score = 0
        self.bombs = 1
        self.kills = 0
        self.deaths = 0
        self.grazes = 0
        self.bot_at = 0.0
        self.bot_x = x
        self.combo = 0
        self.combo_at = 0.0


class StarGuard(Game):
    id = "starguard"
    solo_bots = 2
    category = "action"
    howto = [
        "Drag left and right to slide your ship along the bottom. It fires on its own.",
        "Shoot the alien waves before they reach the bottom, and dodge their shots. Lives are shared: when the team runs out, it's over.",
        "Catch falling power-ups: ⚡ rapid fire, 🔱 spread shot, 🛡️ shield, ❤️ extra life.",
        "🔥 Quick kills build a combo (x2 at 10, x3 at 20). A wave with no ship lost is Flawless: +50 each.",
        "💣 Tap Bomb to wipe the shots and hurt every alien: you start with one, and a dropped 💣 gives a spare (up to 3). Every 5th wave is a boss!",
    ]
    name = "Star Guard"
    icon = "🛸"
    blurb = "Co-op arcade shooter. Defend the sky together against alien waves, power-ups and bosses."
    min_players = 1
    max_players = 6
    replayable = False
    badges = {**Game.badges, "boss": ("👾", "Boss slayer", "Land the finishing shot on a boss"),
              "untouched": ("🛡️", "Untouched", "Win without losing a ship")}
    settings_schema = {
        "waves": ("Waves", [(5, "5 waves (one boss)"), (10, "10 waves"), (15, "15 waves")], 5),
        "lives": ("Shared lives", [(5, "5 lives"), (3, "3 lives (hard)"), (8, "8 lives (easy)")], 5),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        n = len(self.seats)
        self.ships = [Ship(W * (k + 1) / (n + 1)) for k in range(n)]
        self.lives = self.s["lives"]
        self.wave = 0
        self.aliens = []
        self.boss = None
        self.ufo = None     # [x, direction] while a bonus saucer is crossing
        self.ufo_at = 0.0
        self.pbul = []      # [x, y, seat, vx, dmg]
        self.ebul = []      # [x, y, vx, vy]
        self.pups = []      # [x, y, kind]
        self.fx = self.fy = 0.0
        self.fdir = 1
        self.fspeed = 0.1
        self.stage = "intro"
        self.stage_until = 0.0
        self.alien_fire = 0.0
        self.dive_at = 0.0
        self.dry = 0          # kills since the last power-up drop (a pity timer)
        self.clean = True     # no ship lost this wave
        self.last_frame = None
        self.frames = 0
        self.over = False
        self.room.turn = None
        self.room.deadline = None
        names = " & ".join(p.name for p in seated[:3]) + ("…" if n > 3 else "")
        self.room.add_log(f"🛸 Star Guard: {names} defend the sky. {self.s['waves']} waves, {self.lives} shared lives.", "big")
        self.next_wave(time.time())

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def players_alive(self):
        return sum(1 for s in self.ships if s.alive)

    # -- waves

    def next_wave(self, now):
        self.wave += 1
        self.aliens = []
        self.boss = None
        self.pbul.clear()
        self.ebul.clear()
        self.ufo = None
        self.ufo_at = now + INTRO + self.rng.uniform(*UFO_EVERY)
        n = len(self.seats)
        w = self.wave
        if w % 5 == 0:
            hp = 30 + 10 * n + 4 * w
            self.boss = {"x": W / 2, "y": 0.28, "hp": hp, "max": hp, "dir": 1, "fire": 0.0, "phase": 0.0}
            self.lives += 1
            self.moment(f"👾 BOSS INCOMING — wave {w}! (+1 life)", "bad", "alarm")
        else:
            rows = min(5, 2 + w // 2) + (1 if n >= 4 else -1 if n == 1 and w > 2 else 0)
            for r in range(rows):
                for c in range(GRID_COLS):
                    tough = w >= 3 and r == 0
                    kind = "tough" if tough else "diver" if (w >= 4 and r == rows - 1 and c % 3 == 1) else "grunt"
                    self.aliens.append(Alien((c - (GRID_COLS - 1) / 2) * GRID_STEP_X, r * GRID_STEP_Y,
                                             2 if tough else 1, kind))
            self.room.add_log(f"🛸 Wave {w} of {self.s['waves']}: {len(self.aliens)} aliens!", "power")
        self.total = len(self.aliens)
        self.clean = True
        self.fx, self.fy, self.fdir = W / 2, 0.16, 1
        self.fspeed = (0.09 + 0.012 * w) * (0.8 if n == 1 else 1.0)
        self.stage = "intro"
        self.stage_until = now + INTRO
        self.alien_fire = now + INTRO + 0.8
        self.dive_at = now + INTRO + 4.0
        for s in self.ships:
            if s.alive:
                s.invuln = max(s.invuln, 1.0)

    def apos(self, a):
        return (a.dive[0], a.dive[1]) if a.dive else (self.fx + a.gx, self.fy + a.gy)

    # -- input

    def on_input(self, p, a):
        i = self.seat(p)
        x = a.get("x")
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        if not isinstance(x, (int, float)) or not math.isfinite(x):
            raise GameError("Bad position.")
        self.ships[i].tx = min(W - SHIP_R, max(SHIP_R, float(x)))

    def act(self, p, a):
        if a.get("type") != "bomb":
            raise GameError("Drag to move; tap Bomb to use your bomb.")
        i = self.seat(p)
        if i is None:
            raise GameError("You're watching this game.")
        self.bomb(i, time.time())

    def bomb(self, i, now):
        s = self.ships[i]
        if not s.alive or s.bombs <= 0 or self.stage != "fight":
            return
        s.bombs -= 1
        self.ebul.clear()
        for a in list(self.aliens):
            self.hurt(a, 2, i)
        if self.boss:
            self.boss["hp"] -= max(8, self.boss["max"] * 0.12)
            if self.boss["hp"] <= 0:
                self.kill_boss(i, now)
        self.room.add_log(f"💣 {self.name_of(i)} drops the smart bomb!", "power")
        self.moment(f"💣 {self.name_of(i)}: BOMB!", "gold", "boom")

    def name_of(self, i):
        p = self.room.players.get(self.seats[i])
        return p.name if p else "?"

    # -- the world

    def frame(self, now):
        if self.over:
            return False
        if self.last_frame is None:
            self.last_frame = now
            return False
        dt = min(0.05, max(0.0, now - self.last_frame))
        self.last_frame = now
        self.frames += 1
        changed = False
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot:
                self.bot_think(i, p.bot, now)
        self.move_ships(dt, now)
        if self.stage == "intro":
            if now >= self.stage_until:
                self.stage = "fight"
                changed = True
        else:
            changed = self.fight(dt, now)
        if self.frames % 3 == 0 and not self.over:
            self.broadcast(now)
        return changed

    def move_ships(self, dt, now):
        for s in self.ships:
            if not s.alive:
                continue
            d = s.tx - s.x
            step = min(abs(d), SHIP_SPEED * dt)
            s.x += math.copysign(step, d) if d else 0
            s.invuln = max(0.0, s.invuln - dt)
            s.rapid = max(0.0, s.rapid - dt)
            s.spread = max(0.0, s.spread - dt)
            if self.stage == "fight" and now >= s.fire_at:
                s.fire_at = now + (RAPID_EVERY if s.rapid else FIRE_EVERY)
                i = self.ships.index(s)
                self.pbul.append([s.x, SHIP_Y - 0.04, i, 0.0, 1])
                if s.spread:
                    self.pbul.append([s.x - 0.02, SHIP_Y - 0.04, i, -0.22, 1])
                    self.pbul.append([s.x + 0.02, SHIP_Y - 0.04, i, 0.22, 1])

    def fight(self, dt, now):
        changed = False
        # ships that were hit come back after a pause
        for i, s in enumerate(self.ships):
            if not s.alive and s.respawn and now >= s.respawn and self.lives > 0:
                s.alive, s.respawn, s.invuln = True, 0.0, INVULN
                s.x = s.tx = W * (i + 1) / (len(self.ships) + 1)
        # my bullets
        for b in self.pbul:
            b[1] -= BULLET_SPEED * dt
            b[0] += b[3] * dt
        self.pbul = [b for b in self.pbul if b[1] > -0.05 and -0.05 < b[0] < W + 0.05]
        # formation
        if self.aliens:
            xs = [self.fx + a.gx for a in self.aliens if not a.dive]
            if xs:
                speed = self.fspeed * (1 + 1.6 * (1 - len(self.aliens) / max(1, self.total)))
                self.fx += self.fdir * speed * dt
                if max(xs) + self.fdir * speed * dt > W - 0.06 or min(xs) + self.fdir * speed * dt < 0.06:
                    self.fdir = -self.fdir
                    self.fy += 0.034
            for a in self.aliens:
                if a.dive:
                    a.dive[1] += 0.5 * dt
                    a.dive[0] += a.dive[2] * dt
                    if a.dive[1] > H + 0.05:
                        a.dive = None  # it flew past: back to formation, up top
                        a.gy = -0.1
            if now >= self.dive_at and self.wave >= 4:
                self.dive_at = now + max(2.0, 6.0 - 0.3 * self.wave)
                divers = [a for a in self.aliens if a.kind == "diver" and not a.dive]
                if divers:
                    a = self.rng.choice(divers)
                    x, y = self.apos(a)
                    tgt = [s for s in self.ships if s.alive]
                    tx = self.rng.choice(tgt).x if tgt else W / 2
                    a.dive = [x, y, (tx - x) * 0.45]
            if now >= self.alien_fire:
                self.alien_fire = now + max(0.35, 1.3 - 0.07 * self.wave) * self.rng.uniform(0.6, 1.2)
                front = {}
                for a in self.aliens:
                    x, y = self.apos(a)
                    k = round(x / 0.08)
                    if k not in front or y > front[k][1]:
                        front[k] = (x, y)
                if front:
                    x, y = self.rng.choice(list(front.values()))
                    self.ebul.append([x, y + 0.03, 0.0, ENEMY_BULLET])
            low = max((self.apos(a)[1] for a in self.aliens if not a.dive), default=0)
            if low >= BOTTOM_LINE:
                return self.lose("👽 The aliens broke through!")
        if self.boss:
            changed = self.boss_step(dt, now) or changed
        # 🛸 the bonus saucer
        if getattr(self, "ufo", None):
            self.ufo[0] += self.ufo[1] * UFO_SPEED * dt
            if not -0.08 < self.ufo[0] < W + 0.08:
                self.ufo = None
                self.ufo_at = now + self.rng.uniform(*UFO_EVERY)
        elif self.aliens and not self.boss and now >= getattr(self, "ufo_at", 1e18):
            d = self.rng.choice((-1, 1))
            self.ufo = [-0.07 if d > 0 else W + 0.07, d]
        # enemy bullets and pickups
        for b in self.ebul:
            b[0] += b[2] * dt
            b[1] += b[3] * dt
        self.ebul = [b for b in self.ebul if b[1] < H + 0.05 and -0.1 < b[0] < W + 0.1]
        for u in self.pups:
            u[1] += 0.32 * dt
        self.pups = [u for u in self.pups if u[1] < H + 0.05]
        # hits: my bullets on aliens / boss
        keep = []
        for b in self.pbul:
            hit = False
            if getattr(self, "ufo", None) and abs(b[0] - self.ufo[0]) < 0.06 and abs(b[1] - UFO_Y) < 0.045:
                self.ufo_down(b[2], now)
                changed = True
                continue
            if self.boss and abs(b[0] - self.boss["x"]) < 0.14 and abs(b[1] - self.boss["y"]) < 0.07:
                self.boss["hp"] -= b[4]
                hit = True
                if self.boss["hp"] <= 0:
                    self.kill_boss(b[2], now)
                    changed = True
            else:
                for a in self.aliens:
                    x, y = self.apos(a)
                    if abs(b[0] - x) < 0.04 and abs(b[1] - y) < 0.036:
                        self.hurt(a, b[4], b[2])
                        hit = True
                        break
            if not hit:
                keep.append(b)
        self.pbul = keep
        # hits on ships
        for i, s in enumerate(self.ships):
            if not s.alive:
                continue
            for u in list(self.pups):
                if abs(u[0] - s.x) < 0.06 and abs(u[1] - SHIP_Y) < 0.06:
                    self.pups.remove(u)
                    self.take(i, u[2])
            if s.invuln > 0:
                continue
            for b in self.ebul:
                if len(b) == 4 and SHIP_R <= abs(b[0] - s.x) < GRAZE_R and abs(b[1] - SHIP_Y) < 0.04:
                    b.append(True)  # one graze per bullet
                    s.score += GRAZE_PTS
                    s.grazes += 1
                    if s.grazes % GRAZE_CALL == 0:
                        self.moment(f"🌀 {self.name_of(i)}: close shave x{s.grazes}", "good", "pop")
            for b in self.ebul:
                if abs(b[0] - s.x) < SHIP_R and abs(b[1] - SHIP_Y) < 0.04:
                    self.ebul.remove(b)
                    if self.ship_hit(i, now):
                        return True
                    changed = True
                    break
            else:
                for a in self.aliens:
                    if a.dive:
                        x, y = a.dive[0], a.dive[1]
                        if abs(x - s.x) < 0.05 and abs(y - SHIP_Y) < 0.05:
                            self.hurt(a, 9, i)
                            if self.ship_hit(i, now):
                                return True
                            changed = True
                            break
        if not self.aliens and not self.boss and self.stage == "fight":
            return self.wave_clear(now)
        return changed

    def hurt(self, a, dmg, seat):
        a.hp -= dmg
        if a.hp > 0:
            return
        if a in self.aliens:
            self.aliens.remove(a)
        s = self.ships[seat]
        # 🔥 combo: kills in quick succession build a multiplier (x2 at 10, x3 at 20); a pause or a hit resets it
        now = self.last_frame or 0.0
        s.combo = s.combo + 1 if now - s.combo_at < 2.0 else 1
        s.combo_at = now
        s.score += POINTS[a.kind] * (1 + min(2, s.combo // 10))
        if s.combo in (10, 20):
            self.moment(f"🔥 {self.name_of(seat)}: x{1 + s.combo // 10} combo!", "gold", "pop")
        s.kills += 1
        self.dry += 1
        if self.rng.random() < 0.12 or self.dry >= 18:
            self.dry = 0
            x, y = self.apos(a)
            self.pups.append([x, y, self.rng.choice(["rapid", "spread", "shield", "shield", "life", "bomb"])])

    def ufo_down(self, seat, now):
        x = self.ufo[0]
        self.ufo = None
        self.ufo_at = now + self.rng.uniform(*UFO_EVERY)
        self.ships[seat].score += UFO_POINTS
        self.pups.append([max(0.06, min(W - 0.06, x)), UFO_Y + 0.03, self.rng.choice(["rapid", "spread", "shield", "bomb"])])
        self.moment(f"🛸 {self.name_of(seat)} downs the bonus saucer! +{UFO_POINTS}", "gold", "pop")

    def take(self, i, kind):
        s = self.ships[i]
        if kind == "rapid":
            s.rapid = POWER_SECS
        elif kind == "spread":
            s.spread = POWER_SECS
        elif kind == "shield":
            s.shield = True
        elif kind == "bomb":
            s.bombs = min(3, s.bombs + 1)
            self.room.add_log(f"💣 {self.name_of(i)} picks up a spare smart bomb.", "power")
        elif kind == "life":
            self.lives += 1
            self.room.add_log(f"❤️ {self.name_of(i)} grabs an extra life: {self.lives} left.", "power")
        s.score += 5

    def ship_hit(self, i, now):
        """A ship is hit. Returns True if that ended the game."""
        s = self.ships[i]
        if s.shield:
            s.shield = False
            s.invuln = 1.0
            return False
        s.alive = False
        s.combo = 0
        self.clean = False
        s.deaths += 1
        s.rapid = s.spread = 0.0
        self.lives -= 1
        self.room.add_log(f"💥 {self.name_of(i)}'s ship is hit! {max(0, self.lives)} {'life' if self.lives == 1 else 'lives'} left.", "power")
        if self.lives <= 0:
            return self.lose("💥 The team ran out of lives.")
        s.respawn = now + RESPAWN
        return False

    def kill_boss(self, seat, now):
        self.boss = None
        self.ebul.clear()
        s = self.ships[seat]
        s.score += 200
        s.bombs += 1
        p = self.room.players.get(self.seats[seat])
        if p:
            self.award(p, "boss")
        self.moment(f"👾 BOSS DOWN — {self.name_of(seat)} lands the shot!", "gold", "fanfare")
        for k in range(3):
            self.pups.append([self.rng.uniform(0.2, 0.8), 0.3 + 0.05 * k, self.rng.choice(["rapid", "spread", "life", "shield"])])

    def boss_step(self, dt, now):
        b = self.boss
        b["phase"] += dt
        if b["hp"] <= b["max"] / 2 and not b.get("rage"):
            b["rage"] = True  # 😡 the second half of the fight: faster, and everyone is told
            self.moment("😡 The boss is enraged!", "bad", "alarm")
        b["x"] += b["dir"] * (0.25 + 0.15 * (1 - b["hp"] / b["max"])) * (1.25 if b.get("rage") else 1.0) * dt
        if b["x"] > W - 0.16 or b["x"] < 0.16:
            b["dir"] = -b["dir"]
        b["y"] = 0.28 + 0.03 * math.sin(b["phase"] * 1.3)
        if now >= self.alien_fire:
            frac = b["hp"] / b["max"]
            self.alien_fire = now + (2.0 if frac > 0.5 else 1.3)
            n = 3 if frac > 0.5 else 4
            tgt = [s for s in self.ships if s.alive]
            aim = self.rng.choice(tgt).x if tgt else W / 2
            for k in range(n):
                spread = (k - (n - 1) / 2) * 0.16
                vx = (aim - b["x"]) * 0.12 + spread
                self.ebul.append([b["x"], b["y"] + 0.07, vx, ENEMY_BULLET * 0.58])
        return False

    def wave_clear(self, now):
        w = self.wave
        for s in self.ships:
            if s.alive:
                s.score += 25 * w + (50 if self.clean else 0)
        if self.clean:
            self.moment("✨ Flawless wave! +50 each", "gold", "pop")
        if w >= self.s["waves"]:
            return self.win()
        self.moment(f"✅ Wave {w} cleared!", "good", "fanfare")
        self.next_wave(now)
        kind = self.rng.choice(("rapid", "spread"))
        for s in self.ships:
            if s.alive:
                setattr(s, kind, max(getattr(s, kind), SUPPLY_SECS))
        self.room.add_log(f"🎁 Supply drop: {'rapid fire' if kind == 'rapid' else 'spread shot'} for everyone.", "power")
        return True

    def win(self):
        self.over = True
        best = max(range(len(self.ships)), key=lambda k: self.ships[k].score)
        p = self.room.players.get(self.seats[best])
        if all(s.deaths == 0 for s in self.ships):
            for pid in self.seats:
                q = self.room.players.get(pid)
                if q and not q.bot:
                    self.award(q, "untouched")
        self.room.finish(p, f"🏆 The sky is saved! MVP {self.name_of(best)} with {self.ships[best].score}.")
        return True

    def lose(self, why):
        self.over = True
        self.room.finish(None, f"{why} Reached wave {self.wave} of {self.s['waves']}.")
        return True

    # -- bots: line up under a target, dodge shots, grab pickups

    def bot_think(self, i, level, now):
        s = self.ships[i]
        react, dodge, bombs = BOT[level]
        if not s.alive or now < s.bot_at:
            return
        s.bot_at = now + react
        if self.stage != "fight":
            s.tx = s.bot_x = W * (i + 1) / (len(self.ships) + 1)
            return
        def lands(b):  # where a shot will cross the ships' line, and how soon
            t = (SHIP_Y - b[1]) / b[3]
            return b[0] + b[2] * t, t
        threats = [b for b in self.ebul if b[1] < SHIP_Y and lands(b)[1] < 1.3 and abs(lands(b)[0] - s.x) < dodge]
        goal = None
        near = [u for u in self.pups if abs(u[0] - s.x) < 0.3 and u[1] > 0.9]
        if near and not threats:
            goal = min(near, key=lambda u: abs(u[0] - s.x))[0]
        elif self.boss:
            goal = self.boss["x"] + (i - (len(self.ships) - 1) / 2) * 0.2 + 0.1
        elif self.aliens:
            xs = [self.apos(a)[0] for a in self.aliens]
            # spread the team out: each bot favours the targets nearest its own lane
            lane = W * (i + 1) / (len(self.ships) + 1)
            goal = min(xs, key=lambda x: abs(x - lane) + 0.25 * abs(x - s.x))
            if level != "easy":
                goal += self.fdir * self.fspeed * 0.7
        if threats:
            # slip into the safest gap: score each spot by the shots that will cross it soon, then by distance from where I wanted to be
            incoming = [lands(b) for b in self.ebul if b[1] < SHIP_Y and lands(b)[1] < 1.6]
            want = goal if goal is not None else s.x
            best = None
            for k in range(21):
                x = SHIP_R + (W - 2 * SHIP_R) * k / 20
                reach = abs(x - s.x) / SHIP_SPEED
                danger = sum(1 for lx, t in incoming if abs(lx - x) < dodge + 0.02 and t > reach * 0.8)
                cost = danger * 10 + abs(x - want) + 0.6 * abs(x - s.x)
                if best is None or cost < best[0]:
                    best = (cost, x)
            goal = best[1]
        if goal is not None:
            goal += self.rng.gauss(0, 0.012 if level == "hard" else 0.03)
            s.tx = min(W - SHIP_R, max(SHIP_R, goal))
        if bombs and s.bombs and (len(self.ebul) > 9 or (self.boss and self.boss["hp"] < self.boss["max"] * 0.2)):
            self.bomb(i, now)

    # -- the rest of the game contract

    def bot_ready(self):
        return False  # bots play inside frame()

    def on_leave(self, p):
        i = self.seat(p)
        p.eliminated = True
        if i is not None:
            self.ships[i].alive = False
            self.ships[i].respawn = 0.0
        if not any((q := self.room.players.get(pid)) and not q.bot and not q.eliminated for pid in self.seats):
            self.over = True
            self.room.finish(None, "Everyone left.")

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.ships[i].score} pts"

    def final_scores(self):
        return {pid: self.ships[i].score for i, pid in enumerate(self.seats)}

    def ship_data(self):
        return [[round(s.x, 3), int(s.alive), round(s.invuln, 1), int(s.shield), int(s.rapid > 0), int(s.spread > 0), s.score, s.bombs, s.combo if self.last_frame and self.last_frame - s.combo_at < 2.0 else 0]
                for s in self.ships]

    def snapshot(self, now=None):
        r = lambda v: round(v, 3)
        t = time.time() if now is None else now
        return {
            "sh": self.ship_data(),
            "al": [[r(self.apos(a)[0]), r(self.apos(a)[1]), a.hp, 0 if a.kind == "grunt" else 1 if a.kind == "tough" else 2] for a in self.aliens],
            "pb": [[r(b[0]), r(b[1]), b[2]] for b in self.pbul],
            "eb": [[r(b[0]), r(b[1])] for b in self.ebul],
            "pu": [[r(u[0]), r(u[1]), u[2]] for u in self.pups],
            "uf": r(self.ufo[0]) if getattr(self, "ufo", None) else None,
            "bo": [r(self.boss["x"]), r(self.boss["y"]), round(self.boss["hp"]), self.boss["max"], int(bool(self.boss.get("rage")))] if self.boss else None,
            "lv": self.lives, "wv": self.wave, "st": self.stage, "intro": round(max(0.0, self.stage_until - t), 1) if self.stage == "intro" else 0,
        }

    def broadcast(self, now):
        self.room.push_fast(self.snapshot(now))

    def view(self, p):
        return {"starguard": {"W": W, "H": H, "shipY": SHIP_Y, "seats": self.seats, "me": self.seat(p), "waves": self.s["waves"],
                              **self.snapshot()}}
