"""Sky Drop: a server-authoritative 3D descent race through a generated sky shaft.

Players steer on two axes to collect rings, draft through air streams, and dodge
moving hazards. The browser renders the shared course; the server owns scoring.
"""
import math
import time

from .base import Game, GameError

LENGTH = 720.0
STEP = 1 / 30
SEND_EVERY = 2
COUNTDOWN = 3.0
RING_R = 2.05
COIN_PTS, GEM_PTS, COIN_R = 2, 10, 1.8   # 🪙 coins and 💎 gems hang between the rings: fly through them for points
MINE_PTS, MINE_STUN = 12, 2.2        # 💥 a mine is deadly: it blows you out of the dive for a couple of seconds and costs points
GRAZE, GRAZE_PTS = 0.8, 3   # skim a hazard within this much of its edge for a few points: risk for reward
# Bots: (seconds between steering decisions, steering noise, chance to line up each ring properly).
# A bot that loses focus on a ring aims for a spot beside it, so it usually misses that ring and
# then has to recover for the next one. Tuned for about 40% / 60% / 80% of the rings.
BOT = {"easy": (0.35, 0.8, 0.0), "normal": (0.25, 0.6, 0.35), "hard": (0.14, 0.4, 0.72)}


class Flyer:
    def __init__(self, lane):
        self.depth = 0.0
        self.x, self.z = lane, 0.0
        self.vx = self.vz = 0.0
        self.sx = self.sz = 0.0
        self.score = self.rings = self.combo = 0
        self.boosts = 3
        self.boost_until = self.boost_cool = 0.0
        self.stun_until = 0.0
        self.done_at = 0.0
        self.place = 0
        self.next_bot = 0.0
        self.last_ring = -1
        self.hits = 0
        self.grazes = 0
        self.hit_cool_until = 0.0
        self.coins = self.gems = self.mines = 0
        self.aim_ring = -1          # bots: the ring they're lining up and their offset from it
        self.aim_dx = self.aim_dz = 0.0


class SkyDrop(Game):
    id = "skydrop"
    category = "action"
    name = "Sky Drop"
    icon = "🪂"
    blurb = "Dive through a shifting sky shaft, thread the rings, and race to the landing deck."
    min_players, max_players = 2, 6
    replayable = False
    howto = [
        "Everyone dives the same course at once. Drag from anywhere to steer with the floating stick, or use WASD / arrow keys.",
        "Fly through glowing rings to score. Consecutive rings build a combo; missing one resets it.",
        "Steering is stabilized, so you can make small corrections without drifting away. Avoid turbines and storm gates, and keep well clear of the red 💥 mines: they blow you out of the dive for two seconds. Checkpoints refill boosts.",
        "Tap ⚡ or Space for one of three short boosts. The boost refills at the checkpoint.",
        "😮‍💨 Skim past a hazard without touching it for a +3 close-call bonus. 🪙 Coins between the rings are +2 each and a 💎 gem is +10.",
        "Ring points plus a finish-place bonus decide the winner.",
    ]
    settings_schema = {
        "course": ("Course", [("spire", "🏙️ Cloud Spire"), ("storm", "⛈️ Stormwell"), ("aurora", "🌌 Aurora Shaft")], "spire"),
        "runs": ("Runs", [(1, "1 run"), (3, "3 runs")], 1),
        "hazards": ("Hazards", [(True, "On"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.runs = int(self.s.get("runs", 1))
        self.run = 0
        self.points = [0] * len(seated)
        self.ring_totals = [0] * len(seated)
        self.last = time.time()
        self.frames = 0
        self.room.turn = self.room.deadline = None
        self.new_run(self.last)
        self.room.add_log(f"🪂 Sky Drop: {self.runs} run{'s' if self.runs != 1 else ''} through the {self.s.get('course', 'spire')} course. Ring points plus finish bonus win.", "big")

    def new_run(self, now):
        self.run += 1
        self.seed = self.rng.randrange(1 << 30)
        r = self.rng
        # Every course element is shared and immutable for the whole run.
        self.rings = []
        theme = self.s.get("course", "spire")
        for j, d in enumerate(range(28, int(LENGTH), 18)):
            mult = (1.2 if j % 4 == 3 else 1.0) if theme == "aurora" else (0.85 if j % 4 == 3 else 1.0)
            self.rings.append([d, r.uniform(-4.8, 4.8), r.uniform(-3.1, 3.1), mult])
        # 🪙 a short arc of coins just past most rings, and now and then a 💎 gem off the line
        self.coins = []
        for j, (d, rx, rz, _) in enumerate(self.rings[:-1]):
            nd, nx, nz, _ = self.rings[j + 1]
            if r.random() < 0.7:
                for k in (1, 2, 3):
                    t = k / 4
                    self.coins.append([round(d + (nd - d) * t, 2), round(rx + (nx - rx) * t, 2), round(rz + (nz - rz) * t, 2), 0])
            if j % 5 == 2:
                self.coins.append([round((d + nd) / 2, 2), round(r.uniform(-5.6, 5.6), 2), round(r.uniform(-3.4, 3.4), 2), 1])
        self.hazards = []
        if self.s.get("hazards", True):
            hazard_gap = 27 if theme == "storm" else 36
            for d in range(48, int(LENGTH) - 20, hazard_gap):
                kind = 3 if r.random() < 0.22 else r.randrange(3)
                self.hazards.append([d, r.uniform(-5.4, 5.4), r.uniform(-3.4, 3.4), kind, r.uniform(0, math.tau)])
        self.streams = []
        for d in range(42, int(LENGTH) - 30, 54):
            self.streams.append([d, r.uniform(-5, 5), r.uniform(-3, 3), r.choice([-1, 1]), r.uniform(-1, 1)])
        lanes = [(-2.2 + i * 4.4 / max(1, len(self.seats) - 1)) for i in range(len(self.seats))]
        self.flyers = [Flyer(lanes[i]) for i in range(len(self.seats))]
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if not p or p.eliminated:
                self.flyers[i].done_at = -1
        self.stage = "countdown"
        self.go_at = now + COUNTDOWN
        self.last = now
        self.frames = 0
        self.finished = []
        self.events = []
        self.ev_seq = 0
        self.race_started = self.go_at
        self.room.deadline = None
        self.chip_key, self.chip_at = None, 0.0

    def seat(self, p):
        return self.seats.index(p.id) if p.id in self.seats else None

    def act(self, p, a):
        raise GameError("Steer by dragging and tap ⚡ to boost.")

    def on_input(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this run.")
        f = self.flyers[i]
        for key in ("sx", "sz"):
            value = a.get(key)
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise GameError("Bad steering input.")
                setattr(f, key, max(-1.0, min(1.0, float(value))))
        if a.get("boost") is True:
            now = time.time()
            if self.stage == "race" and f.done_at == 0 and now >= f.boost_cool and f.boosts:
                f.boosts -= 1
                f.boost_until = now + 1.25
                f.boost_cool = now + 2.5
                self.event(now, "boost", i)

    def event(self, now, kind, i):
        self.ev_seq += 1
        self.events.append([self.ev_seq, kind, i, now])
        self.events = self.events[-30:]

    def hazard_position(self, d, x, z, kind, phase, at):
        if kind == 2:
            elapsed = max(0.0, at - self.race_started)
            x += math.sin(elapsed * 1.5 + phase) * 1.5
            z += math.cos(elapsed * 1.1 + phase) * 1.1
        return x, z

    def frame(self, now):
        if self.room.phase != "playing":
            return False
        if self.stage == "results":
            if now >= self.next_at:
                if self.run >= self.runs:
                    self.finish_match()
                else:
                    self.new_run(now)
                return True
            self.frames += 1
            if self.frames % 8 == 0:
                self.broadcast(now)
            return False
        if self.stage == "countdown":
            if now >= self.go_at:
                self.stage = "race"
                self.last = now
                self.race_started = now
                return True
            if int(now * 4) != int(self.last * 4):
                self.last = now
                self.broadcast(now)
            return False
        dt = min(0.05, max(0.0, now - self.last))
        self.last = now
        for i, pid in enumerate(self.seats):
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated and not self.flyers[i].done_at:
                self.bot_think(i, p.bot, now)
        self.simulate(dt, now)
        self.frames += 1
        if self.frames % SEND_EVERY == 0:
            self.broadcast(now)
        if all(f.done_at or not self.active(i) for i, f in enumerate(self.flyers)) or now - self.race_started > 100:
            self.end_run(now)
            return True
        # The seat chips show live points (meta); refresh the full views when they change, at most once a second.
        key = [self.live_points(i) for i in range(len(self.seats))]
        if key != self.chip_key and now - self.chip_at >= 1.0:
            self.chip_key, self.chip_at = key, now
            return True
        return False

    def live_points(self, i):
        """Match points so far plus the run in progress (end_run adds the run to points, so not twice)."""
        return self.points[i] + (self.flyers[i].score if self.stage != "results" else 0)

    def active(self, i):
        p = self.room.players.get(self.seats[i])
        return bool(p and not p.eliminated)

    def simulate(self, dt, now):
        for i, f in enumerate(self.flyers):
            if not self.active(i) or f.done_at:
                continue
            prev_depth, prev_x, prev_z = f.depth, f.x, f.z
            if now < f.stun_until:
                f.depth = min(LENGTH, f.depth + 4.2 * dt)
            else:
                # Course currents are local force fields, with a small oscillation for movement.
                # Steering is a velocity target with gentle damping. This keeps a release or
                # direction change predictable on touch screens, while currents still matter.
                target_vx, target_vz = f.sx * 8.0, f.sz * 6.6
                response = min(1.0, dt * 9.0)   # snappy: ~110 ms to reach the stick's speed (was ~240 ms)
                f.vx += (target_vx - f.vx) * response
                f.vz += (target_vz - f.vz) * response
                ax = az = 0.0
                current_scale = 1.45 if self.s.get("course") == "storm" else 1.0
                for d, x, z, dx, dz in self.streams:
                    dd = abs(f.depth - d)
                    dist = math.hypot(f.x - x, f.z - z)
                    if dd < 9 and dist < 4:
                        k = (1 - dd / 9) * (1 - dist / 4) * current_scale
                        ax += dx * 8 * k
                        az += dz * 8 * k
                f.vx = max(-9, min(9, (f.vx + ax * dt) * (1 - 1.2 * dt)))
                f.vz = max(-7.5, min(7.5, (f.vz + az * dt) * (1 - 1.35 * dt)))
                speed = 12.5 + (4.0 if now < f.boost_until else 0)
                f.depth = min(LENGTH, f.depth + speed * dt)
                f.x += f.vx * dt
                f.z += f.vz * dt
                if abs(f.x) > 8.5 or abs(f.z) > 5.5:
                    f.x = max(-8.5, min(8.5, f.x))
                    f.z = max(-5.5, min(5.5, f.z))
                    f.vx *= -0.45
                    f.vz *= -0.45
            for ri, ring in enumerate(self.rings):
                d, x, z, mult = ring
                if f.last_ring < ri and prev_depth < d <= f.depth:
                    f.last_ring = ri
                    t = (d - prev_depth) / max(1e-9, f.depth - prev_depth)
                    cross_x = prev_x + (f.x - prev_x) * t
                    cross_z = prev_z + (f.z - prev_z) * t
                    if math.hypot(cross_x - x, cross_z - z) <= RING_R:
                        f.combo += 1
                        f.rings += 1
                        pts = (10 + min(10, (f.combo - 1) * 2)) * mult
                        if math.hypot(cross_x - x, cross_z - z) <= RING_R * 0.3:   # 🎯 dead centre pays half again
                            pts *= 1.5
                            self.event(now, "bullseye", i)
                        f.score += round(pts)
                        self.event(now, "ring", i)
                    else:
                        f.combo = 0
            for d, x, z, kind in self.coins:
                if prev_depth < d <= f.depth:
                    t = (d - prev_depth) / max(1e-9, f.depth - prev_depth)
                    if math.hypot(prev_x + (f.x - prev_x) * t - x, prev_z + (f.z - prev_z) * t - z) <= COIN_R:
                        if kind:
                            f.gems += 1
                            f.score += GEM_PTS
                            self.event(now, "gem", i)
                        else:
                            f.coins += 1
                            f.score += COIN_PTS
                            self.event(now, "coin", i)
            for d, x, z, kind, phase in self.hazards:
                crossed = prev_depth < d <= f.depth
                t = (d - prev_depth) / max(1e-9, f.depth - prev_depth) if crossed else 1.0
                hit_x = prev_x + (f.x - prev_x) * t
                hit_z = prev_z + (f.z - prev_z) * t
                hazard_x, hazard_z = self.hazard_position(d, x, z, kind, phase, now - dt + t * dt)
                hz_r = 1.55 if kind == 0 else 1.15 if kind == 3 else 1.25
                hz_d = math.hypot(hit_x - hazard_x, hit_z - hazard_z)
                if crossed and now >= f.stun_until and hz_r <= hz_d < hz_r + GRAZE:   # 😮‍💨 a close call pays
                    f.score += GRAZE_PTS
                    f.grazes += 1
                    self.event(now, "graze", i)
                if now >= f.hit_cool_until and crossed and hz_d < hz_r:
                    f.stun_until = now + (MINE_STUN if kind == 3 else 0.55 if kind == 1 else 0.8)
                    f.hit_cool_until = now + 1.0
                    f.vx += (1 if f.x < x else -1) * 4.5
                    f.vz += (1 if f.z < z else -1) * 3.0
                    f.combo = 0
                    f.score = max(0, f.score - (MINE_PTS if kind == 3 else 4))
                    f.hits += 1
                    self.event(now, "boom" if kind == 3 else "hit", i)
                    break
            # Checkpoints restore the boost charges, while the finish registers exact time.
            if int(f.depth // 180) > getattr(f, "checkpoint", 0):
                f.checkpoint = int(f.depth // 180)
                f.boosts = 3
                self.event(now, "checkpoint", i)
            if f.depth >= LENGTH:
                f.depth = LENGTH
                f.done_at = now - dt + max(0.0, LENGTH - prev_depth) / max(1e-9, f.depth - prev_depth) * dt
                self.finished.append(i)
                self.event(now, "finish", i)

    def bot_think(self, i, level, now):
        f = self.flyers[i]
        interval, noise, focus = BOT.get(level, BOT["normal"])
        if now < f.next_bot:
            return
        f.next_bot = now + interval
        ri = next((j for j, ring in enumerate(self.rings) if ring[0] > f.depth), None)
        if ri is not None:
            _, x, z, _ = self.rings[ri]
            if f.aim_ring != ri:
                f.aim_ring = ri
                if self.rng.random() < focus:
                    f.aim_dx = f.aim_dz = 0.0
                else:   # distracted: heads for a spot well beside the ring
                    a = self.rng.uniform(0, math.tau)
                    off = self.rng.uniform(2.2, 3.6)
                    f.aim_dx, f.aim_dz = math.cos(a) * off, math.sin(a) * off * 0.7
            x += f.aim_dx
            z += f.aim_dz
            # Lead toward ring to account for steering inertia.
            f.sx = max(-1, min(1, (x - f.x - f.vx * 0.45) / 3.0 + self.rng.uniform(-noise, noise)))
            f.sz = max(-1, min(1, (z - f.z - f.vz * 0.45) / 2.5 + self.rng.uniform(-noise, noise)))
        if f.boosts and now >= f.boost_cool and ri is not None and abs(self.rings[ri][0] - f.depth) < 14:
            f.boosts -= 1
            f.boost_until, f.boost_cool = now + 1.25, now + 2.5

    def end_run(self, now):
        # Timeout finish order uses depth, then actual finish times.
        remaining = sorted((i for i, f in enumerate(self.flyers) if not f.done_at and self.active(i)),
                           key=lambda i: (-self.flyers[i].depth, self.seats[i]))
        for place, i in enumerate(remaining):
            f = self.flyers[i]
            f.done_at, f.place = now + place * 1e-4, len(self.finished) + place + 1
            self.finished.append(i)
        self.finished.sort(key=lambda i: (self.flyers[i].done_at, self.seats[i]))
        for place, i in enumerate(self.finished, 1):
            f = self.flyers[i]
            f.place = place
            f.score += max(0, 18 - 3 * (place - 1))
        for i, f in enumerate(self.flyers):
            if not self.active(i):
                continue
            self.points[i] += f.score
            self.ring_totals[i] += f.rings
        self.stage = "results"
        self.next_at = now + 4.5
        order = ", ".join(self.player_name(i) for i in self.finished)
        self.room.add_log(f"🪂 Run {self.run}: {order}. Ring points and finish bonuses added.", "big")

    def player_name(self, i):
        p = self.room.players.get(self.seats[i])
        return p.name if p else "?"

    def finish_match(self):
        live = [i for i in range(len(self.seats)) if self.active(i)] or list(range(len(self.seats)))
        top = max(self.points[i] for i in live)
        winners = [i for i in live if self.points[i] == top]
        winner = self.room.players.get(self.seats[winners[0]]) if len(winners) == 1 else None
        self.room.finish(winner, f"🏆 {', '.join(self.player_name(i) for i in winners)} wins Sky Drop with {top} points!")

    def broadcast(self, now=None):
        self.room.push_fast({"skydrop": self.fast_view(now or time.time())})

    def fast_view(self, now, full=False):
        return {"stage": self.stage, "run": self.run, "runs": self.runs, "go": self.go_at,
                "time": now, "raceStarted": self.race_started, "length": LENGTH, "seed": self.seed, "course": self.s.get("course", "spire"),
                "rings": self.rings, "hazards": self.hazards, "streams": self.streams, **({"coins": self.coins} if full else {}),
                "finished": self.finished, "events": self.events,
                "flyers": [[f.depth, f.x, f.z, f.vx, f.vz, f.score, f.rings, f.combo,
                            f.boosts, f.done_at, f.place, f.stun_until, f.hits, f.boost_until] for f in self.flyers],
                "points": self.points, "ringTotals": self.ring_totals}

    def view(self, p):
        i = self.seat(p)
        return {"skydrop": {**self.fast_view(time.time(), True), "me": i, "seats": self.seats}}

    def meta(self, p):
        i = self.seat(p)
        return f"{self.live_points(i)} pts" if i is not None else "Watching"

    def final_scores(self):
        return {pid: self.points[i] for i, pid in enumerate(self.seats)}
