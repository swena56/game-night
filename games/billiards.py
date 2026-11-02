"""Billiards: eight-ball pool on a top-down table. The traditional public-domain rules, a little simplified.

Shots are turn-based. The server simulates each shot (friction, cushions, ball-to-ball
collisions, six pockets) and sends the recorded ball paths, so every phone animates the same shot.

Rules: break, then the first legally pocketed ball gives the shooter that group (solids 1–7 or
stripes 9–15). Pocket one of yours and you shoot again. Fouls (cue ball pocketed, hitting nothing,
or hitting the wrong ball first) give the other player ball in hand: they can place the cue ball
anywhere. Clear your group, then sink the 8 to win. Sinking the 8 early, or with a foul, loses.
The 8 on the break is put back on its spot."""
import math
import random
import time

from .base import Game, GameError

TW, TH, R = 200.0, 100.0, 2.3        # table size and ball radius, in table units
FRICTION = 70.0                      # rolling slow-down, units/s²
CUSHION, BOUNCE = 0.78, 0.95         # speed kept off a cushion / in a ball-to-ball hit
SPIN_K = 0.6                         # how much of the hit speed follow / draw gives back to the cue ball
SIDE_K, SIDE_KEEP = 0.22, 0.45       # side spin: sideways kick off a cushion (share of the strike speed), spin left after it
MIN_SPEED, MAX_SPEED = 25.0, 520.0   # cue speed at power 0 and 1
DT, FRAME_EVERY = 1 / 120, 4         # simulation step; record every 4th step (30 fps)
MAX_STEPS = 120 * 14
# pockets: (x, y, capture radius); the side pockets sit just outside the long rails
POCKETS = [(0, 0, 4.4), (TW / 2, -0.8, 3.9), (TW, 0, 4.4), (0, TH, 4.4), (TW / 2, TH + 0.8, 3.9), (TW, TH, 4.4)]
MOUTH = 3.4                          # how far past the capture radius the cushions open up
HEAD_X, FOOT = TW / 4, (TW * 0.73, TH / 2)
SOLIDS, STRIPES = set(range(1, 8)), set(range(9, 16))
GROUPS = {"solids": SOLIDS, "stripes": STRIPES}
GROUP_LABEL = {"solids": "🔵 solids", "stripes": "🟠 stripes"}


def near_mouth(x, y):
    return any(math.hypot(x - px, y - py) < cap + MOUTH for px, py, cap in POCKETS)


def simulate(pos, angle, speed, record=True, spin=0.0, holes=None, side=0.0):
    """Run one shot. pos: {ball: (x, y)} with the cue ball as 0. spin: -1 (draw) to 1 (follow): after the cue
    ball's first hit it rolls on (or back) along the aim line. side: -1 (left) to 1 (right english): the cue
    ball spins clockwise (seen from above) for right, and each cushion kicks it sideways against that spin,
    so right english comes off a rail to the ball's own right. holes, if given, gets {ball: pocket index}.
    Returns (final positions, pocketed balls in order, first ball the cue touched, frames)."""
    balls = {n: [x, y, 0.0, 0.0] for n, (x, y) in pos.items()}
    aim_x, aim_y = math.cos(angle), math.sin(angle)
    balls[0][2], balls[0][3] = aim_x * speed, aim_y * speed
    pocketed, first, frames = [], None, []
    order = sorted(pos)
    english = side * speed  # the cue ball's sideways spin, as a speed; it wears off with time and cushions
    for step in range(MAX_STEPS):
        english *= 1 - 1.2 * DT
        moving = False
        for b in balls.values():
            v = math.hypot(b[2], b[3])
            if v == 0:
                continue
            nv = v - FRICTION * DT
            if nv < 1.0:
                b[2] = b[3] = 0.0
                continue
            moving = True
            b[2] *= nv / v; b[3] *= nv / v
            b[0] += b[2] * DT; b[1] += b[3] * DT
        if not moving:
            break
        live = list(balls.items())
        for i, (n1, b1) in enumerate(live):
            for n2, b2 in live[i + 1:]:
                if not (b1[2] or b1[3] or b2[2] or b2[3]):
                    continue
                dx, dy = b2[0] - b1[0], b2[1] - b1[1]
                d2 = dx * dx + dy * dy
                if d2 >= 4 * R * R or d2 == 0:
                    continue
                d = math.sqrt(d2)
                nx, ny = dx / d, dy / d
                rel = (b1[2] - b2[2]) * nx + (b1[3] - b2[3]) * ny
                if rel > 0:  # closing in: equal-mass collision along the line of centres
                    j = rel * (1 + BOUNCE) / 2
                    b1[2] -= j * nx; b1[3] -= j * ny
                    b2[2] += j * nx; b2[3] += j * ny
                    if first is None and 0 in (n1, n2):
                        first = n2 if n1 == 0 else n1
                        if spin:  # the spin takes hold once the cue ball has struck
                            cb = b1 if n1 == 0 else b2
                            cb[2] += aim_x * spin * rel * SPIN_K; cb[3] += aim_y * spin * rel * SPIN_K
                push = (2 * R - d) / 2
                b1[0] -= nx * push; b1[1] -= ny * push
                b2[0] += nx * push; b2[1] += ny * push
        for n, b in list(balls.items()):
            hole = next((k for k, (px, py, cap) in enumerate(POCKETS) if math.hypot(b[0] - px, b[1] - py) < cap), None)
            if hole is not None:
                pocketed.append(n)
                if holes is not None:
                    holes[n] = hole
                del balls[n]
                continue
            mouth = near_mouth(b[0], b[1])
            for axis, size in ((0, TW), (1, TH)):
                lo, hi = (-R, size + R) if mouth else (R, size - R)
                into = -1 if b[axis] < lo else 1 if b[axis] > hi else 0  # which way the cushion lies
                if not into:
                    continue
                b[axis], b[axis + 2] = (lo, abs(b[axis + 2]) * CUSHION) if into < 0 else (hi, -abs(b[axis + 2]) * CUSHION)
                if n == 0 and english:
                    # the contact point's spin slides along the cushion; friction pushes the ball the other way.
                    # Clockwise spin at a contact in direction (nx, ny) moves that point along (-ny, nx).
                    nx, ny = (into, 0) if axis == 0 else (0, into)
                    b[2] -= -ny * english * SIDE_K; b[3] -= nx * english * SIDE_K
                    english *= SIDE_KEEP
        if record and step % FRAME_EVERY == 0:
            frame = []
            for n in order:
                b = balls.get(n)
                frame += [round(b[0] * 10), round(b[1] * 10)] if b else [-1, -1]
            frames.append(frame)
    final = {n: (b[0], b[1]) for n, b in balls.items()}
    if record:
        frames.append([v for n in order for v in ([round(final[n][0] * 10), round(final[n][1] * 10)] if n in final else [-1, -1])])
    return final, pocketed, first, frames


def rack(rng):
    """A triangle at the foot spot: the 8 in the middle, a solid and a stripe in the back corners."""
    rest = [n for n in range(1, 16) if n not in (1, 8)]
    rng.shuffle(rest)
    back = rng.sample([n for n in rest if n in SOLIDS], 1) + rng.sample([n for n in rest if n in STRIPES], 1)
    rest = [n for n in rest if n not in back]
    pos, gap = {}, 2 * R + 0.02
    slots = [(row, i) for row in range(5) for i in range(row + 1)]
    fill = iter(rest)
    for row, i in slots:
        x, y = FOOT[0] + row * gap * math.sqrt(3) / 2, FOOT[1] + (i - row / 2) * gap
        n = 1 if (row, i) == (0, 0) else 8 if (row, i) == (2, 1) else back[0] if (row, i) == (4, 0) \
            else back[1] if (row, i) == (4, 4) else next(fill)
        pos[n] = (x, y)
    return pos


def free_spot(pos, x, y):
    """The point nearest (x, y), searching along the table's length, where a ball fits."""
    for k in range(200):
        for sx in ((x + k * 0.5,) if k == 0 else (x + k * 0.5, x - k * 0.5)):
            if R <= sx <= TW - R and all(math.hypot(sx - bx, y - by) >= 2 * R + 0.05 for bx, by in pos.values()):
                return sx, y
    return x, y


def seg_clear(ax, ay, bx, by, pos, skip, width=2 * R):
    """No ball (other than `skip`) within `width` of the segment a→b."""
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-9
    for n, (x, y) in pos.items():
        if n in skip:
            continue
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        if math.hypot(ax + t * dx - x, ay + t * dy - y) < width - 0.05:
            return False
    return True


class Billiards(Game):
    id = "billiards"
    category = "action"
    howto = [
        "Drag anywhere on the table to turn the cue around the ball, set the power, then Shoot. ◀ ▶ fine-tune.",
        "The first ball you pocket after the break picks your group: 🔵 solids (1–7) or 🟠 stripes (9–15).",
        "Pocket one of yours and you shoot again. Hit your own group first.",
        "The cue-ball pad by Shoot picks where the cue strikes: high to follow through, low to draw back, left or right to bend the bounce off a cushion.",
        "Fouls (cue ball in a pocket, missing everything, wrong ball first) give your rival ✋ ball in hand.",
        "Clear your group, then sink the 8 to win. The 8 too early, or with a foul, loses.",
    ]
    name = "Billiards"
    icon = "🎱"
    blurb = "Eight-ball pool on a top-down table with real physics. Clear your group, then sink the 8."
    min_players = 2
    max_players = 2
    settings_schema = {
        "guide": ("Aim guide", [("full", "🎯 Full (where both balls go)"), ("short", "Short"), ("off", "Off")], "full"),
        "call8": ("The 8 ball", [(True, "📣 Call its pocket"), (False, "Any pocket")], True),
    }

    def calling(self, pid):
        """Shooting at the 8 with calls on: the shot must name a pocket."""
        return bool(self.s.get("call8")) and not self.breaking and self.legal_targets(pid) == [8]

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.pos = rack(rng)
        self.pos[0] = (HEAD_X, TH / 2)
        self.groups = {}                 # player id -> "solids" | "stripes"
        self.breaking = True
        self.in_hand = "kitchen"         # None | "kitchen" (behind the head line) | "anywhere"
        self.shot = None
        self.shot_seq = 0
        self.busy_until = 0.0
        self.last = ""
        for p in seated:
            p.g.sunk = 0
        first = rng.choice(seated)
        self.room.add_log(f"🎱 Billiards! {first.name} breaks.", "big")
        self.room.begin_turn(first.id)

    # -- helpers

    def mine(self, pid):
        g = self.groups.get(pid)
        return {n for n in GROUPS[g] if n in self.pos} if g else None

    def legal_targets(self, pid):
        left = self.mine(pid)
        if left is None:
            return [n for n in self.pos if n not in (0, 8)]
        return sorted(left) or [8]

    def place_ok(self, x, y, zone):
        if not (R <= x <= TW - R and R <= y <= TH - R):
            return False
        if zone == "kitchen" and x > HEAD_X:
            return False
        return all(math.hypot(x - bx, y - by) >= 2 * R + 0.05 for n, (bx, by) in self.pos.items() if n != 0)

    # -- actions

    def act(self, p, a):
        if a.get("type") != "shoot":
            raise GameError("Unknown action.")
        self.require_turn(p)
        if time.time() < self.busy_until:
            raise GameError("Wait for the balls to stop.")
        angle, power = a.get("angle"), a.get("power")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (angle, power)) or not 0 <= power <= 1:
            raise GameError("Bad shot.")
        cue = a.get("cue")
        if cue is not None:
            if not self.in_hand:
                raise GameError("You don't have ball in hand.")
            if not (isinstance(cue, list) and len(cue) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in cue)):
                raise GameError("Bad cue ball spot.")
            if not self.place_ok(cue[0], cue[1], self.in_hand):
                raise GameError("The cue ball can't go there." + (" Keep it behind the line for the break." if self.in_hand == "kitchen" else ""))
        elif 0 not in self.pos:
            raise GameError("Place the cue ball first.")
        spin, side = a.get("spin", 0), a.get("side", 0)
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and -1 <= v <= 1 for v in (spin, side)):
            raise GameError("Bad spin.")
        pocket = a.get("pocket")
        if self.calling(p.id) and (not isinstance(pocket, int) or isinstance(pocket, bool) or not 0 <= pocket < len(POCKETS)):
            raise GameError("Call a pocket for the 8 first.")
        self.shoot(p, float(angle), float(power), tuple(cue) if cue else None, float(spin), pocket if self.calling(p.id) else None,
                   float(side))

    def shoot(self, p, angle, power, cue=None, spin=0.0, pocket=None, side=0.0):
        r = self.room
        if cue:
            self.pos[0] = cue
        before = self.mine(p.id)
        targets = self.legal_targets(p.id)
        speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power
        order = sorted(self.pos)
        holes = {}
        final, sunk, first, frames = simulate(self.pos, angle, speed, spin=spin, holes=holes, side=side)
        breaking, self.breaking, self.in_hand = self.breaking, False, None
        self.pos = final
        self.shot_seq += 1
        dur = len(frames) / 30
        self.shot = {"id": self.shot_seq, "by": p.id, "order": order, "frames": frames, "at": time.time(), "called": pocket}
        self.busy_until = time.time() + dur

        foul = None
        if 0 in sunk:
            foul = "the cue ball went in"
        elif first is None:
            foul = "no ball was hit"
        elif not breaking and first not in targets:
            foul = f"the {first} was hit first"
        objects = [n for n in sunk if n not in (0, 8)]
        p.g.sunk += len(objects)

        if 8 in sunk:
            if breaking:
                self.pos[8] = free_spot(self.pos, *FOOT)
                r.add_log("🎱 The 8 dropped on the break, so it goes back on its spot.", "power")
            else:
                other = r.players.get(next((i for i in self.seats if i != p.id), None))
                if before == set() and not foul and pocket is not None and holes.get(8) != pocket:
                    foul = "in a pocket they didn't call"
                if before == set() and not foul:
                    self.last = f"🏆 {p.name} sinks the 8!"
                    return self.finish(p, f"🏆 {p.name} sinks the 8 and wins!")
                why = foul or ("before clearing their group" if before is not None else "on an open table")
                self.last = f"💥 {p.name} sank the 8 too early."
                return self.finish(other, f"💥 {p.name} sank the 8 ({why}). {other.name if other else 'Their rival'} wins!")

        if not foul and not breaking and p.id not in self.groups and objects:
            g = "solids" if objects[0] in SOLIDS else "stripes"
            self.groups[p.id] = g
            for i in self.seats:
                if i != p.id:
                    self.groups[i] = "stripes" if g == "solids" else "solids"
            r.add_log(f"🎱 {p.name} takes {GROUP_LABEL[g]}.", "big")

        own = GROUPS[self.groups[p.id]] if p.id in self.groups else None
        scored = [n for n in objects if own is None or n in own]
        names = ", ".join(str(n) for n in objects)
        if foul:
            self.in_hand = "anywhere"
            if 0 in sunk:
                self.pos.pop(0, None)
            self.last = f"⚠️ Foul: {foul}."
            r.add_log(f"⚠️ {p.name}: foul, {foul}{f' (sank {names})' if objects else ''}. Ball in hand for the other player.", "power")
            r.advance()
        elif scored:
            self.last = f"✅ {p.name} sank {names}."
            r.add_log(f"✅ {p.name} sank {names}{' on the break' if breaking else ''} and shoots again.", "question")
            r.begin_turn(p.id)
        else:
            self.last = f"{p.name} sank {names}, not theirs." if objects else f"{p.name} missed."
            r.add_log(f"🎱 {p.name} {'sank ' + names + ' (not theirs)' if objects else 'potted nothing'}.")
            r.advance()
        r.bot_at = max(r.bot_at, self.busy_until + 0.7)

    def finish(self, winner, text):
        self.room.finish(winner, text)

    def on_timeout(self):
        r = self.room
        r.add_log(f"⏰ {r.players[r.turn].name} ran out of time. Ball in hand for the other player.", "power")
        self.in_hand = self.in_hand or "anywhere"
        r.advance()

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "sunk"):
            return ""
        g = self.groups.get(p.id)
        if not g:
            return "open table"
        left = len(self.mine(p.id))
        return f"{GROUP_LABEL[g]} · {left} left" if left else f"{GROUP_LABEL[g]} · on the 8!"

    def final_scores(self):
        return {i: self.room.players[i].g.sunk for i in self.seats if i in self.room.players}

    def view(self, p):
        shot = None
        if self.shot:
            shot = {k: self.shot.get(k) for k in ("id", "by", "order", "frames", "called")}
            shot["age"] = max(0.0, time.time() - self.shot["at"])
        return {"billiards": {
            "W": TW, "H": TH, "R": R, "headX": HEAD_X, "pockets": [[x, y, c] for x, y, c in POCKETS],
            "balls": [[n, round(x, 2), round(y, 2)] for n, (x, y) in sorted(self.pos.items())],
            "groups": self.groups, "inHand": self.in_hand, "breaking": self.breaking,
            "targets": self.legal_targets(self.room.turn) if self.room.turn else [],
            "shot": shot, "last": self.last, "guide": self.s["guide"],
            "minSpeed": MIN_SPEED, "maxSpeed": MAX_SPEED, "friction": FRICTION,
            "calling": self.calling(self.room.turn) if self.room.turn and self.room.phase == "playing" else False,
        }}

    # -- bots: ghost-ball aiming; the hard bot test-runs its best ideas in the real engine

    def bot_turn(self, p):
        # room.bot_at already waits for the balls to stop (set at the end of shoot)
        noise = {"easy": 0.022, "normal": 0.007, "hard": 0.0015}[p.bot]
        if self.breaking:
            cue = (HEAD_X, TH / 2 + random.uniform(-6, 6)) if self.in_hand else None
            sx, sy = cue or self.pos[0]
            angle = math.atan2(FOOT[1] - sy, FOOT[0] - sx) + random.gauss(0, noise)
            return self.shoot(p, angle, 1.0 if p.bot != "easy" else 0.8, cue)
        targets = self.legal_targets(p.id)
        cue = None
        if self.in_hand:
            cue = self.place_cue(p, targets)
        cx, cy = cue or self.pos[0]
        shots = self.candidates(cx, cy, targets)
        if not shots:
            angle, power = self.safety(cx, cy, targets)
            hole = None
            if self.calling(p.id):  # a safety on the 8 still names a pocket: the one nearest the 8
                ex, ey = self.pos[8]
                hole = min(range(len(POCKETS)), key=lambda k: math.hypot(POCKETS[k][0] - ex, POCKETS[k][1] - ey))
            return self.shoot(p, angle + random.gauss(0, noise * 2), power, cue, pocket=hole)
        if p.bot == "easy":
            pick = random.choice(shots[:3])
        elif p.bot == "normal":
            pick = shots[0]
        else:
            pick = self.test_run(p, shots[:5], cue)
        _, angle, power, hole = pick
        if not self.calling(p.id):
            hole = None
        self.shoot(p, angle + random.gauss(0, noise), min(1.0, power * random.uniform(0.95, 1.1)), cue, pocket=hole)

    def candidates(self, cx, cy, targets):
        """[(score, angle, power)] for direct pots, best first."""
        pos = dict(self.pos)
        pos[0] = (cx, cy)
        out = []
        for t in targets:
            tx, ty = pos[t]
            for hole, (px, py, _) in enumerate(POCKETS):
                side = px == TW / 2
                aim_x, aim_y = px, (py + (2.0 if py < 0 else -2.0)) if side else py
                d1x, d1y = aim_x - tx, aim_y - ty
                dist2 = math.hypot(d1x, d1y)
                if dist2 < 1e-6:
                    continue
                ux, uy = d1x / dist2, d1y / dist2
                if side and abs(uy) < 0.55:
                    continue  # side pockets only take balls coming in fairly straight
                gx, gy = tx - ux * 2 * R, ty - uy * 2 * R
                if not (R * 0.5 <= gx <= TW - R * 0.5 and R * 0.5 <= gy <= TH - R * 0.5):
                    continue
                vx, vy = gx - cx, gy - cy
                dist1 = math.hypot(vx, vy)
                if dist1 < 1e-6:
                    continue
                cos = (vx * ux + vy * uy) / dist1
                if cos < 0.25:
                    continue
                if not seg_clear(cx, cy, gx, gy, pos, {0, t}) or not seg_clear(tx, ty, aim_x, aim_y, pos, {0, t}):
                    continue
                v_obj2 = 2 * FRICTION * (dist2 + 25)
                v0 = math.sqrt(2 * FRICTION * dist1 + v_obj2 / (cos * cos * ((1 + BOUNCE) / 2) ** 2))
                power = max(0.08, min(1.0, (v0 - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)))
                score = 100 * cos * cos - 0.12 * dist1 - 0.18 * dist2 - (8 if side else 0)
                out.append((score, math.atan2(vy, vx), power, hole))
        out.sort(reverse=True)
        return out

    def safety(self, cx, cy, targets):
        """No clear pot: roll softly into the nearest legal ball we can see (or any legal ball)."""
        pos = dict(self.pos)
        pos[0] = (cx, cy)
        seen = [t for t in targets if seg_clear(cx, cy, *pos[t], pos, {0, t})] or targets
        t = min(seen, key=lambda n: math.hypot(pos[n][0] - cx, pos[n][1] - cy))
        tx, ty = pos[t]
        return math.atan2(ty - cy, tx - cx), 0.35

    def place_cue(self, p, targets):
        best, best_score = None, -1e9
        zone = self.in_hand
        xs = [HEAD_X * k / 6 for k in range(1, 7)] if zone == "kitchen" else [TW * k / 12 for k in range(1, 12)]
        for x in xs:
            for y in (TH * k / 7 for k in range(1, 7)):
                if not self.place_ok(x, y, zone):
                    continue
                c = self.candidates(x, y, targets)
                score = c[0][0] if c else -500
                if score > best_score:
                    best, best_score = (x, y), score
        if best is None:  # crowded table: the first legal spot
            best = next(((x, y) for x in xs for y in (TH * k / 14 for k in range(1, 14)) if self.place_ok(x, y, zone)), (HEAD_X / 2, TH / 2))
        return best

    def test_run(self, p, shots, cue):
        """Hard bot: run its top ideas through the real engine and keep the one that works out best."""
        start, mine = time.time(), GROUPS.get(self.groups.get(p.id), None)
        targets = set(self.legal_targets(p.id))
        pos = dict(self.pos)
        if cue:
            pos[0] = cue
        best, best_val = shots[0], -1e9
        for shot in shots:
            for nudge in (0.0, 0.004, -0.004):
                if time.time() - start > 2.5:
                    return best
                final, sunk, first, _ = simulate(pos, shot[1] + nudge, MIN_SPEED + (MAX_SPEED - MIN_SPEED) * shot[2], record=False)
                val = shot[0] * 0.1
                if 0 in sunk or first is None or first not in targets:
                    val -= 120
                if 8 in sunk:
                    val += 1000 if targets == {8} and 0 not in sunk and first == 8 else -1000
                good = [n for n in sunk if n not in (0, 8) and (mine is None or n in mine)]
                val += 60 * len(good)
                if good and 0 in final:  # leave: is there a next pot from here?
                    nxt = [t for t in (sorted(mine & set(final)) if mine else []) if t in final]
                    saved = self.pos
                    self.pos = final
                    follow = self.candidates(*final[0], nxt or [8]) if (nxt or 8 in final) else []
                    self.pos = saved
                    val += 0.2 * follow[0][0] if follow else 0
                if val > best_val:
                    best, best_val = (shot[0], shot[1] + nudge, shot[2], shot[3]), val
        return best
