"""Billiards: eight-ball pool on a top-down table. The traditional public-domain rules, a little simplified.

Shots are turn-based. The server simulates each shot (balls that skid then roll, spin,
cushions, ball-to-ball collisions, six pockets) and sends the recorded ball paths, so every phone animates the same shot.

Rules: break, then the first legally pocketed ball gives the shooter that group (solids 1–7 or
stripes 9–15). Pocket one of yours and you shoot again. Fouls (cue ball pocketed, hitting nothing,
or hitting the wrong ball first) give the other player ball in hand: they can place the cue ball
anywhere (behind the head line after a scratch on the break). Clear your group, then sink the 8 to win.
Sinking the 8 early, or with a foul, loses. The 8 on the break is put back on its spot.
Nine-ball: hit the lowest ball first, the 9 on any legal shot wins, the first shot after the break may be a
push-out, and three fouls in a row lose."""
import math
import random
import time

from .base import Game, GameError

TW, TH, R = 200.0, 100.0, 2.3        # table size and ball radius, in table units (1 unit ≈ 1.27 cm)
FRICTION = 70.0                      # rolling slow-down, units/s²
SLIDE = 130.0                        # sliding friction while a ball skids on the cloth, units/s²
BOUNCE = 0.95                        # speed kept in a ball-to-ball hit
CUSHION_SOFT, CUSHION_HARD = 0.88, 0.66  # cushion bounce: soft hits keep more, hard ones squash the rubber
CUSHION_V = 450.0                    # ... reaching CUSHION_HARD at this speed into the cushion
RAIL_GRIP = 0.2                      # cushion friction: sideways impulse at most this share of the bounce impulse
# ball-to-ball friction, by how fast the contact points slip (Alciatore's measured fit for phenolic balls):
# μ = THROW + THROW_SLOW·exp(−slip / THROW_V). Polished balls grip more when the slip is slow, so a soft cut
# throws the object ball ~4° off the line of centres and a hard one only ~1–2°.
THROW, THROW_SLOW, THROW_V = 0.01, 0.108, 72.0
TIP_K = 1.5                          # follow / draw: spin (as surface speed R·ω) per unit of cue speed at full offset
SIDE_TIP = 1.25                      # side spin: the same, for english (spin about the vertical axis)
SIDE_DECAY = 150.0                   # english wears off steadily (the contact patch's twisting friction), units/s²
SQUIRT = math.radians(2.0)           # english pushes the cue ball off the stick's line, away from the side struck
MAX_ELEV = 60.0                      # how far the cue's butt can be raised (degrees), for swerve and massé (#45)
MASSE_K = 2.0                        # an elevated side hit: sideways roll (R·ω) per unit of cue speed, × sin(elevation)
ELEV_LOSS = 0.35                     # ... and a steeper stroke drives more of it into the cloth: speed × (1 − this · sin)
MIN_SPEED, MAX_SPEED = 25.0, 520.0   # cue speed at power 0 and 1
# the break: a real break is about twice a hard shot, and a slow cloth (FRICTION is ~9x real, so position
# play stays on the table) would stop the rack dead. Breaks get their own top speed and a livelier cloth, so
# about half of them pot a ball (tests/billiards_physics.py measures it).
BREAK_MAX_SPEED, BREAK_FRICTION = 720.0, 18.0
STROKE_LEAD = 0.35                   # seconds of cue stroke the browsers show before the balls move
# the cloth setting: (rolling friction, top cue speed). Classic is the slow cloth the game started with; fast
# rolls about like a real table (rolling friction ~0.02 g), with a lower top speed so the power bar stays usable
CLOTHS = {"classic": (FRICTION, MAX_SPEED), "fast": (15.0, 320.0)}
DT, FRAME_EVERY = 1 / 120, 4         # simulation step; record every 4th step (30 fps)
MAX_STEPS = 120 * 14
MAX_MOVE = R                         # sub-step so no ball moves further than this at once (no tunnelling)
STOP = 1.0                           # a rolling ball slower than this stops
# a ball struck without spin skids, then rolls at 5/7 of its speed: how far it goes per unit of speed²
def reach_k(friction=FRICTION):
    return (24 / 49) / (2 * SLIDE) + (25 / 49) / (2 * friction)


REACH_K = reach_k()
# pockets: (x, y, hole radius); a ball drops once its centre is over the hole. The side pockets sit just
# outside the long rails.
POCKETS = [(0, 0, 4.4), (TW / 2, -0.8, 3.9), (TW, 0, 4.4), (0, TH, 4.4), (TW / 2, TH + 0.8, 3.9), (TW, TH, 4.4)]
CORNER_JAW, SIDE_JAW = 7.0, 5.4      # where the cushion ends (the jaw's point): from a corner / either side of a side pocket
CORNER_FACING, SIDE_FACING = 25, 45  # the jaw's facing runs from the point to the hole's edge this far round (degrees)
HEAD_X, FOOT = TW / 4, (TW * 0.73, TH / 2)
SOLIDS, STRIPES = set(range(1, 8)), set(range(9, 16))
GROUPS = {"solids": SOLIDS, "stripes": STRIPES}
RACK_PAUSE = 6.0                     # seconds between racks in a match: the score, then the next break
PUSH_TAKE = {"easy": -1e9, "normal": 30, "hard": 45}  # the bot shoots after a rival's push if its best pot scores this
GROUP_LABEL = {"solids": "🔵 solids", "stripes": "🟠 stripes"}


def table_edges():
    """The cushion line as segments [(x1, y1, x2, y2)], clockwise on screen from the top-left pocket: each
    rail's cushion runs from one jaw point to the next, and each jaw has a facing angled from its point to
    the edge of the hole, so the pocket is a funnel. A ball straight at a pocket drops; one coming in at a
    slant or off line hits a point or a facing and can rattle out, more so the harder it's going."""
    c25, s25 = math.cos(math.radians(CORNER_FACING)), math.sin(math.radians(CORNER_FACING))
    c45, s45 = math.cos(math.radians(SIDE_FACING)), math.sin(math.radians(SIDE_FACING))
    jaws = []  # per pocket, in order: (in point, in facing end, out facing end, out point)
    for (px, py, cap), shape in zip(
            [POCKETS[0], POCKETS[1], POCKETS[2], POCKETS[5], POCKETS[4], POCKETS[3]],
            [((0, 1), (1, 0)), ("side", (1, 0), (0, -1), 0.0), ((-1, 0), (0, 1)), ((0, -1), (-1, 0)),
             ("side", (-1, 0), (0, 1), TH), ((1, 0), (0, -1))]):
        if shape[0] == "side":
            _, (ax, ay), (ox, oy), rail_y = shape  # along the direction of travel; out of the table
            jaws.append(((px - ax * SIDE_JAW, rail_y), (px + cap * (-c45 * ax + s45 * ox), py + cap * (-c45 * ay + s45 * oy)),
                         (px + cap * (c45 * ax + s45 * ox), py + cap * (c45 * ay + s45 * oy)), (px + ax * SIDE_JAW, rail_y)))
        else:
            (ax, ay), (bx, by) = shape  # towards the jaw we arrive at / the one we leave by
            jaws.append(((px + ax * CORNER_JAW, py + ay * CORNER_JAW), (px + cap * (c25 * ax - s25 * bx), py + cap * (c25 * ay - s25 * by)),
                         (px + cap * (c25 * bx - s25 * ax), py + cap * (c25 * by - s25 * ay)), (px + bx * CORNER_JAW, py + by * CORNER_JAW)))
    edges = []
    for i, (p_in, f_in, f_out, p_out) in enumerate(jaws):
        edges += [(*p_in, *f_in), (*f_out, *p_out), (*p_out, *jaws[(i + 1) % len(jaws)][0])]
    return [tuple(round(v, 4) for v in e) for e in edges]


EDGES = table_edges()
NEAR_EDGE = CORNER_JAW + R           # balls further than this inside the cushion line can't touch any edge


def cushion_e(vn):
    """How much of its speed into the cushion a ball keeps: a soft hit more, a hard one less."""
    return CUSHION_SOFT - (CUSHION_SOFT - CUSHION_HARD) * min(1.0, vn / CUSHION_V)


def cloth(b, h, friction=FRICTION):
    """Advance one ball by h seconds of table friction. b = [x, y, vx, vy, sx, sy, sz]: (sx, sy) is the
    rolling spin as the speed it gives the contact point with the cloth (R·ω), sz the english (R·ω about
    the vertical). While the contact point slips (v ≠ s) sliding friction pulls v and s together, the
    ball's 2/5·m·R² inertia making s move 5/2 as fast as v, until it rolls (v = s) at 5/7 of the way from
    v to s. Rolling, it just slows down. Returns whether it is still moving."""
    vx, vy, sx, sy = b[2], b[3], b[4], b[5]
    if b[6]:
        b[6] = 0.0 if abs(b[6]) <= SIDE_DECAY * h else b[6] - math.copysign(SIDE_DECAY * h, b[6])
    ux, uy = vx - sx, vy - sy  # slip of the contact point
    u = math.hypot(ux, uy)
    if u > 0.5:
        a = min(SLIDE * h, u / 3.5)  # don't overshoot: slip falls at 7/2 of the speed change
        ux, uy = ux / u * a, uy / u * a
        vx -= ux; vy -= uy
        sx += 2.5 * ux; sy += 2.5 * uy
        b[2], b[3], b[4], b[5] = vx, vy, sx, sy
        b[0] += vx * h; b[1] += vy * h
        return True
    v = math.hypot(vx, vy)
    nv = v - friction * h
    if nv < STOP:
        b[2] = b[3] = b[4] = b[5] = 0.0
        return False
    b[2] = b[4] = vx * nv / v; b[3] = b[5] = vy * nv / v
    b[0] += b[2] * h; b[1] += b[3] * h
    return True


def rail(b, nx, ny):
    """Bounce off a cushion lying in direction (nx, ny) from the ball's centre. The cushion's nose meets
    the ball at natural-roll height (7/5 R off the cloth), where a push changes the ball's speed and its
    rolling spin alike: a rolling ball comes off still rolling, a skidding one comes off with topspin.
    Cushion friction pushes against the contact point's sideways slip (sideways speed plus english), up
    to RAIL_GRIP of the bounce impulse, changing both the path and the english (7/2: the same
    slip-to-speed ratio as on the cloth). Right english (clockwise) comes off to the ball's own right."""
    vn = b[2] * nx + b[3] * ny
    if vn <= 0:  # already on its way out
        return
    jn = vn * (1 + cushion_e(vn))
    tx, ty = -ny, nx  # along the cushion: the way the english moves the contact point
    slip = b[2] * tx + b[3] * ty + b[6]
    jt = max(-RAIL_GRIP * jn, min(RAIL_GRIP * jn, slip / 3.5))
    jx, jy = -jn * nx - jt * tx, -jn * ny - jt * ty
    b[2] += jx; b[3] += jy
    b[4] += jx; b[5] += jy
    b[6] -= 2.5 * jt


def edges(b):
    """Keep a ball off the cushions, jaw points and facings, bouncing it off any it has run into."""
    x, y = b[0], b[1]
    if NEAR_EDGE < x < TW - NEAR_EDGE and NEAR_EDGE < y < TH - NEAR_EDGE:
        return
    for x1, y1, x2, y2 in EDGES:
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        qx, qy = x1 + t * dx - x, y1 + t * dy - y  # from the centre to the nearest point of this edge
        d = math.hypot(qx, qy)
        if d >= R or d == 0:
            continue
        nx, ny = qx / d, qy / d
        x -= nx * (R - d); y -= ny * (R - d)
        b[0], b[1] = x, y
        rail(b, nx, ny)


def throw_mu(slip):
    """Ball-to-ball friction at this slip speed (units/s) between the contact points."""
    return THROW + THROW_SLOW * math.exp(-slip / THROW_V)


def collide(balls, first, h):
    """Ball-to-ball hits: equal masses, along the line of centres, so the balls swap speed but keep their
    own roll, with a little friction between them (THROW). Returns the first ball the cue ball touched."""
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
            if rel <= 0:  # touching but not closing: just ease them apart
                push = (2 * R - d) / 2
                b1[0] -= nx * push; b1[1] -= ny * push
                b2[0] += nx * push; b2[1] += ny * push
                continue
            # wind both back to the moment they touched, so the hit goes along the true line of centres
            wx, wy = b2[2] - b1[2], b2[3] - b1[3]
            w2, dw = wx * wx + wy * wy, dx * wx + dy * wy
            back = min(h, (dw + math.sqrt(max(0.0, dw * dw - w2 * (d2 - 4 * R * R)))) / w2) if w2 else 0.0
            for b in (b1, b2):
                b[0] -= b[2] * back; b[1] -= b[3] * back
            dx, dy = b2[0] - b1[0], b2[1] - b1[1]
            d = math.hypot(dx, dy) or 2 * R
            nx, ny = dx / d, dy / d
            rel = (b1[2] - b2[2]) * nx + (b1[3] - b2[3]) * ny
            j = max(0.0, rel) * (1 + BOUNCE) / 2
            b1[2] -= j * nx; b1[3] -= j * ny
            b2[2] += j * nx; b2[3] += j * ny
            # friction between the balls: the contact points slip sideways (a cut, and their english) and
            # up-down (their roll), and friction against the sideways part throws the object ball off the
            # line of centres, toward where the cue ball was heading, and turns each ball's english
            tx, ty = -ny, nx
            sh = (b1[2] - b2[2]) * tx + (b1[3] - b2[3]) * ty + b1[6] + b2[6]
            slip = math.hypot(sh, (b1[4] + b2[4]) * nx + (b1[5] + b2[5]) * ny)
            if j and slip > 1e-9:
                jt = math.copysign(min(throw_mu(slip) * j * abs(sh) / slip, abs(sh) / 7), sh)  # 7: both balls' 1 + 5/2
                b1[2] -= jt * tx; b1[3] -= jt * ty
                b2[2] += jt * tx; b2[3] += jt * ty
                b1[6] -= 2.5 * jt; b2[6] -= 2.5 * jt
            for b in (b1, b2):
                b[0] += b[2] * back; b[1] += b[3] * back
            if first is None and 0 in (n1, n2):
                first = n2 if n1 == 0 else n1
    return first


def simulate(pos, angle, speed, record=True, spin=0.0, holes=None, side=0.0, friction=FRICTION, elev=0.0):
    """Run one shot. pos: {ball: (x, y)} with the cue ball as 0. spin: -1 (draw) to 1 (follow): where the tip
    strikes, top to bottom. Struck high the cue ball turns over faster than it rolls, struck low it spins
    backwards; struck in the middle it skids (a stun). The spin only shows after the cue ball hits a ball,
    which takes its speed but not its spin: the cloth then drives it on, stops it dead or pulls it back, and
    on a cut shot bends its path. side: -1 (left) to 1 (right english), spin about the vertical that bends
    the bounce off each cushion. elev: how far the cue's butt is raised (0 to MAX_ELEV degrees). An elevated
    side hit tilts the spin's axis, so the ball also rolls sideways while it skids: the cloth bends its path
    toward the side struck (a swerve, or a massé when steep), and less of the spin is left for the cushions.
    holes, if given, gets {ball: pocket index}.
    Returns (final positions, pocketed balls in order, first ball the cue touched, frames)."""
    balls = {n: [x, y, 0.0, 0.0, 0.0, 0.0, 0.0] for n, (x, y) in pos.items()}
    side = max(-1.0, min(1.0, side))
    angle -= SQUIRT * side  # right english (side > 0) squirts the ball to the left of the aim
    aim_x, aim_y = math.cos(angle), math.sin(angle)
    tilt = math.radians(max(0.0, min(MAX_ELEV, elev)))
    speed *= 1 - ELEV_LOSS * math.sin(tilt)
    top = TIP_K * max(-1.0, min(1.0, spin)) * speed
    curve = MASSE_K * side * speed * math.sin(tilt)  # sideways roll, toward the ball's right for right english
    balls[0][2:] = [aim_x * speed, aim_y * speed, aim_x * top - aim_y * curve, aim_y * top + aim_x * curve,
                    SIDE_TIP * side * speed * math.cos(tilt)]
    pocketed, first, frames = [], None, []
    order = sorted(pos)
    for step in range(MAX_STEPS):
        fastest = max((abs(b[2]) + abs(b[3]) for b in balls.values()), default=0.0)
        subs = max(1, math.ceil(fastest * DT / MAX_MOVE))
        h = DT / subs
        moving = False
        for _ in range(subs):
            moving = False
            for b in balls.values():
                if (b[2] or b[3] or b[4] or b[5]) and cloth(b, h, friction):
                    moving = True
            if not moving:
                break
            first = collide(balls, first, h)
            for n, b in list(balls.items()):
                hole = next((k for k, (px, py, cap) in enumerate(POCKETS) if math.hypot(b[0] - px, b[1] - py) < cap), None)
                if hole is None and not (-8 < b[0] < TW + 8 and -8 < b[1] < TH + 8):  # off the table somehow: it went in
                    hole = min(range(len(POCKETS)), key=lambda k: math.hypot(b[0] - POCKETS[k][0], b[1] - POCKETS[k][1]))
                if hole is not None:
                    pocketed.append(n)
                    if holes is not None:
                        holes[n] = hole
                    del balls[n]
                    continue
                edges(b)
        if not moving:
            break
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


def cue_speed(dist, arrive, skid=False, friction=FRICTION):
    """The cue speed (struck in the middle) that is still `arrive` after `dist`: it skids, losing SLIDE
    per second, until it rolls at 5/7 of its start speed, which takes 24/49·v²/(2·SLIDE) of cloth.
    With skid=True, also whether it is still skidding when it gets there."""
    v0 = math.sqrt(arrive * arrive + 2 * SLIDE * dist)
    if (24 / 49) * v0 * v0 / (2 * SLIDE) >= dist:
        return (v0, True) if skid else v0  # still skidding when it gets there
    # rolling by then: (5/7·v0)² − 2·friction·(dist − skid) = arrive²
    v0 = math.sqrt((arrive * arrive + 2 * friction * dist) / (25 / 49 + friction * 24 / (49 * SLIDE)))
    return (v0, False) if skid else v0


def throw_angle(cos, skidding, arrive=150.0):
    """How far (radians) a cut at this cosine throws the object ball off the line of centres, when the cue
    ball arrives at `arrive`, by the engine's ball-to-ball friction: all the slip is sideways for a skidding
    cue ball; a rolling one also slips up-down, so less of the friction goes sideways (but it slips faster,
    so the balls grip less)."""
    sin = math.sqrt(max(0.0, 1 - cos * cos))
    j = cos * (1 + BOUNCE) / 2
    mu = throw_mu(arrive * (sin if skidding else 1.0))
    return math.atan(min(mu * j * (1 if skidding else sin), sin / 7) / j) if j else 0.0


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


def rack9(rng):
    """Nine-ball's diamond at the foot spot: the 1 at the front, the 9 in the middle, the rest anywhere."""
    rest = list(range(2, 9))
    rng.shuffle(rest)
    fill, pos, gap = iter(rest), {}, 2 * R + 0.02
    for row, count in enumerate((1, 2, 3, 2, 1)):
        for i in range(count):
            x, y = FOOT[0] + row * gap * math.sqrt(3) / 2, FOOT[1] + (i - (count - 1) / 2) * gap
            pos[1 if row == 0 else 9 if (row, i) == (2, 1) else next(fill)] = (x, y)
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
        "Drag anywhere on the table to turn the cue around the ball. ◀ ▶ fine-tune. Pull the power bar back and let go to shoot (or set it and press Shoot).",
        "The first ball you pocket after the break picks your group: 🔵 solids (1–7) or 🟠 stripes (9–15).",
        "Pocket one of yours and you shoot again. Hit your own group first.",
        "The cue-ball pad by Shoot picks where the cue strikes: high to follow through, low to draw back, the middle to stop dead on a close straight hit, left or right to bend the bounce off a cushion. Side spin also pushes the cue ball a touch off the line "
        "⤴ under the pad raises the butt of the cue: with left or right on the pad, the cue ball curves toward that side (a swerve; steep, a massé) and goes a little slower.",
        "(the full aim guide shows where it really goes). Spin wears off as the ball travels.",
        "Pockets have jaws: a ball straight in drops, one coming in at a slant can catch the point and rattle out. Side pockets want straight-in shots.",
        "The Cloth setting: 🐢 Classic is slow, so balls stop soon; 🏎️ Fast rolls like a real table, so play softer.",
        "Fouls (cue ball in a pocket, missing everything, wrong ball first) give your rival ✋ ball in hand: anywhere, "
        "or behind the line after a scratch on an 8-ball break.",
        "Clear your group, then sink the 8 to win. The 8 too early, or with a foul, loses.",
        "9️⃣ 9-ball (pick it in the settings): balls 1–9. Always hit the lowest ball first; sink any ball and you go again. "
        "Sink the 9 on a legal shot (even on the break, or knocked in off another ball) to win.",
        "🔀 9-ball push-out: the first shot after the break may be a push. It needn't hit anything (only a scratch is a foul), "
        "then your rival shoots from there or hands it back to you. Three fouls in a row lose.",
    ]
    name = "Billiards"
    icon = "🎱"
    blurb = "Eight-ball or nine-ball pool with real physics. Clear your group and sink the 8, or run the balls to the 9."
    min_players = 2
    max_players = 2
    settings_schema = {
        "rules": ("Game", [("8", "🎱 8-ball"), ("9", "9️⃣ 9-ball")], "8"),
        "guide": ("Aim guide", [("full", "🎯 Full (where both balls go)"), ("light", "Light (ghost ball and a hint of the angle)"), ("short", "Short"), ("off", "Off")], "full"),
        "call8": ("The 8 ball", [(True, "📣 Call its pocket"), (False, "Any pocket")], True),
        "cloth": ("Cloth", [("classic", "🐢 Classic (slow, short rolls)"), ("fast", "🏎️ Fast (rolls like a real table)")], "classic"),
        "race": ("Match", [(1, "1 rack"), (2, "🏁 Race to 2"), (3, "🏁 Race to 3"), (5, "🏁 Race to 5")], 1),
    }

    @property
    def table(self):
        """(rolling friction, top cue speed) for normal shots on this game's cloth."""
        return CLOTHS.get(getattr(self, "s", {}).get("cloth"), CLOTHS["classic"])

    @property
    def nine(self):
        return self.s.get("rules") == "9"

    def calling(self, pid):
        """Shooting at the 8 with calls on: the shot must name a pocket."""
        return bool(self.s.get("call8")) and not self.nine and not self.breaking and self.legal_targets(pid) == [8]

    # -- setup

    @property
    def race(self):
        return self.s.get("race") or 1

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        self.racks = {p.id: 0 for p in seated}  # racks won, for a race to several
        self.rack_no = 0
        self.shot_seq = 0                # never restarts, so every shot of a match has its own id
        for p in seated:
            p.g.sunk = 0
        self.breaker = rng.choice(seated).id
        self.new_rack()

    def new_rack(self):
        """Rack the balls and break. In a match the break alternates."""
        r, rng = self.room, self.rng
        self.rack_no += 1
        self.between = False
        self.rack_winner = None
        self.pos = rack9(rng) if self.nine else rack(rng)
        self.pos[0] = (HEAD_X, TH / 2)
        self.groups = {}                 # player id -> "solids" | "stripes"
        self.breaking = True
        self.in_hand = "kitchen"         # None | "kitchen" (behind the head line) | "anywhere"
        self.shot = None
        self.busy_until = 0.0
        self.last = ""
        self.ending = None               # (winner id, text): the 8 decided it, shown once the balls stop (#46)
        self.push_ok = False             # 9-ball: the first shot after the break may be a push-out
        self.push_choice = None          # 9-ball: after a push, the player who picks: shoot from there or hand it back
        self.fouls = {i: 0 for i in self.seats}  # 9-ball: fouls in a row; the third loses
        self.mark_round()
        if self.breaker not in r.players:  # the breaker left: the other player breaks
            self.breaker = next((i for i in self.seats if i in r.players), self.breaker)
        first = r.players[self.breaker]
        game = '9️⃣ Nine-ball' if self.nine else '🎱 Billiards'
        if self.race > 1:
            r.add_log(f"{game}, race to {self.race}: rack {self.rack_no}. {first.name} breaks.", "big")
        else:
            r.add_log(f"{game}! {first.name} breaks.", "big")
        r.begin_turn(first.id)

    # -- helpers

    def mine(self, pid):
        g = self.groups.get(pid)
        return {n for n in GROUPS[g] if n in self.pos} if g else None

    def legal_targets(self, pid):
        if self.nine:  # always the lowest ball on the table
            low = [n for n in self.pos if n]
            return [min(low)] if low else []
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
        kind = a.get("type")
        if kind not in ("shoot", "pass"):
            raise GameError("Unknown action.")
        self.require_turn(p)
        if time.time() < self.busy_until:
            raise GameError("Wait for the balls to stop.")
        if kind == "pass":
            return self.hand_back(p)
        push = a.get("push") is True
        if push and not (self.nine and self.push_ok):
            raise GameError("A push-out is only allowed on the first shot after the break.")
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
        spin, side, elev = a.get("spin", 0), a.get("side", 0), a.get("elev", 0)
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and -1 <= v <= 1 for v in (spin, side)):
            raise GameError("Bad spin.")
        if not (isinstance(elev, (int, float)) and not isinstance(elev, bool) and math.isfinite(elev) and 0 <= elev <= MAX_ELEV):
            raise GameError("Bad cue elevation.")
        pocket = a.get("pocket")
        if self.calling(p.id) and (not isinstance(pocket, int) or isinstance(pocket, bool) or not 0 <= pocket < len(POCKETS)):
            raise GameError("Call a pocket for the 8 first.")
        self.shoot(p, float(angle), float(power), tuple(cue) if cue else None, float(spin), pocket if self.calling(p.id) else None,
                   float(side), push, float(elev))

    def hand_back(self, p):
        """9-ball, after a rival's push-out: make the pusher shoot from where the balls lie."""
        r = self.room
        if self.push_choice != p.id:
            raise GameError("You can only hand the table back after a push-out.")
        self.push_choice = None
        other = next((i for i in self.seats if i != p.id), None)
        self.last = f"↩️ {p.name} hands it back."
        r.add_log(f"↩️ {p.name} hands the table back: {r.players[other].name if other in r.players else 'their rival'} shoots from there.")
        r.begin_turn(other)

    def shoot(self, p, angle, power, cue=None, spin=0.0, pocket=None, side=0.0, push=False, elev=0.0):
        r = self.room
        if cue:
            self.pos[0] = cue
        self.push_ok, self.push_choice = False, None  # shooting after a rival's push takes the table as it lies
        before = self.mine(p.id)
        targets = self.legal_targets(p.id)
        fric, top = (BREAK_FRICTION, BREAK_MAX_SPEED) if self.breaking else self.table
        speed = MIN_SPEED + (top - MIN_SPEED) * power
        order = sorted(self.pos)
        holes = {}
        cx, cy = self.pos[0]
        final, sunk, first, frames = simulate(self.pos, angle, speed, spin=spin, holes=holes, side=side, friction=fric, elev=elev)
        breaking, self.breaking, self.in_hand = self.breaking, False, None
        self.pos = final
        self.shot_seq += 1
        dur = STROKE_LEAD + len(frames) / 30  # the stroke, then the balls
        self.shot = {"id": self.shot_seq, "by": p.id, "order": order, "frames": frames, "at": time.time(), "called": pocket,
                     "stroke": [round(angle, 5), round(power, 3), round(spin, 2), round(side, 2), round(cx, 2), round(cy, 2)]}
        self.busy_until = time.time() + dur

        foul = None
        if 0 in sunk:
            foul = "the cue ball went in"
        elif push:
            pass  # a push-out needn't hit anything
        elif first is None:
            foul = "no ball was hit"
        elif not breaking and first not in targets:
            foul = f"the {first} was hit first"
        if self.nine:
            return self.after_nine(p, sunk, foul, breaking, push)
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
            # a scratch on the break: ball in hand behind the head line; any other foul: anywhere
            self.in_hand = "kitchen" if breaking and 0 in sunk else "anywhere"
            if 0 in sunk:
                self.pos.pop(0, None)
            self.last = f"⚠️ Foul: {foul}."
            where = " behind the line" if self.in_hand == "kitchen" else ""
            r.add_log(f"⚠️ {p.name}: foul, {foul}{f' (sank {names})' if objects else ''}. Ball in hand{where} for the other player.", "power")
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

    def after_nine(self, p, sunk, foul, breaking, push=False):
        """Nine-ball: hit the lowest ball first; pocket anything on a legal shot and you shoot again; the 9 on a
        legal shot (the break and combinations count) wins. A foul gives ball in hand and brings the 9 back up.
        The first shot after the break may be a push-out: no need to hit anything, and the rival then picks
        who shoots next. Three fouls in a row lose."""
        r = self.room
        objects = [n for n in sunk if n]
        p.g.sunk += len([n for n in objects if n != 9])
        names = ", ".join(str(n) for n in objects)
        other_id = next((i for i in self.seats if i != p.id), None)
        if foul:
            self.fouls[p.id] = self.fouls.get(p.id, 0) + 1
            if self.fouls[p.id] >= 3:
                other = r.players.get(other_id)
                self.last = f"💥 {p.name} fouled three times in a row."
                r.add_log(f"⚠️ {p.name}: foul, {foul}.", "power")
                return self.finish(other, f"💥 {p.name} fouled three times in a row. {other.name if other else 'Their rival'} wins!")
        else:
            self.fouls[p.id] = 0
        if push and not foul:
            if 9 in sunk:
                self.pos[9] = free_spot(self.pos, *FOOT)
            self.push_choice = other_id
            self.last = f"🔀 {p.name} pushes out."
            r.add_log(f"🔀 {p.name} pushes out{f' (sank {names})' if objects else ''}"
                      f"{'. The 9 goes back on its spot' if 9 in sunk else ''}. "
                      f"{r.players[other_id].name if other_id in r.players else 'Their rival'} shoots from there or hands it back.", "question")
            r.advance()
            r.bot_at = max(r.bot_at, self.busy_until + 0.7)
            return
        if 9 in sunk and not foul:
            self.last = f"🏆 {p.name} sinks the 9!"
            return self.finish(p, f"🏆 {p.name} sinks the 9{' on the break' if breaking else ''} and wins!")
        if 9 in sunk:
            self.pos[9] = free_spot(self.pos, *FOOT)
        if breaking:
            self.push_ok = True  # whoever shoots next may push out
        if foul:
            self.in_hand = "anywhere"
            if 0 in sunk:
                self.pos.pop(0, None)
            self.last = f"⚠️ Foul: {foul}."
            warn = " ⚠️ Two fouls in a row: one more loses." if self.fouls[p.id] == 2 else ""
            r.add_log(f"⚠️ {p.name}: foul, {foul}{f' (sank {names})' if objects else ''}"
                      f"{'. The 9 goes back on its spot' if 9 in sunk else ''}. Ball in hand for the other player.{warn}", "power")
            r.advance()
        elif objects:
            self.last = f"✅ {p.name} sank {names}."
            r.add_log(f"✅ {p.name} sank {names}{' on the break' if breaking else ''} and shoots again.", "question")
            r.begin_turn(p.id)
        else:
            self.last = f"{p.name} missed."
            r.add_log(f"🎱 {p.name} potted nothing.")
            r.advance()
        r.bot_at = max(r.bot_at, self.busy_until + 0.7)

    def finish(self, winner, text):
        """The game is decided, but the shot is still rolling on everyone's screen: hold the result
        until the balls stop (bot_ready / bot_tick below), so no one sees the win before the 8 drops."""
        r = self.room
        self.ending = (winner.id if winner else None, text)
        r.turn = None
        r.deadline = None
        r.bot_at = self.busy_until + 0.4

    def bot_ready(self):
        if getattr(self, "ending", None):
            return True  # the ticker also waits for room.bot_at, set to just after the balls stop
        if getattr(self, "between", False):
            return False  # the pause between racks runs on the clock (on_timeout)
        return super().bot_ready()

    def bot_tick(self):
        if getattr(self, "ending", None):
            wid, text = self.ending
            self.ending = None
            return self.end_rack(wid, text)
        return super().bot_tick()

    def end_rack(self, wid, text):
        """A rack is decided and its last shot has stopped rolling. One rack, or the race is won: game over.
        Otherwise a pause with the match score, then the next rack, broken by the other player."""
        r = self.room
        racks = getattr(self, "racks", None)
        winner = r.players.get(wid)
        if racks is None or self.race <= 1 or wid not in racks:
            return r.finish(winner, text)
        racks[wid] += 1
        score = "–".join(str(racks[i]) for i in sorted(racks, key=lambda i: -racks[i]))
        if racks[wid] >= self.race:
            return r.finish(winner, f"{text} 🏁 {winner.name if winner else '?'} takes the match {score}.")
        r.add_log(f"{text} Rack {self.rack_no} to {winner.name if winner else '?'}: {score}.", "big")
        self.between = True
        self.rack_winner = wid
        self.breaker = next((i for i in self.seats if i != self.breaker), self.breaker)
        r.turn = None
        r.deadline = time.time() + RACK_PAUSE

    def on_timeout(self):
        r = self.room
        if getattr(self, "between", False):
            return self.new_rack()
        r.add_log(f"⏰ {r.players[r.turn].name} ran out of time. Ball in hand for the other player.", "power")
        self.in_hand = self.in_hand or "anywhere"
        self.push_ok, self.push_choice = False, None
        r.advance()

    # -- what each player sees

    def meta(self, p):
        if not hasattr(p.g, "sunk"):
            return ""
        if self.nine:
            return f"{p.g.sunk} sunk"
        g = self.groups.get(p.id)
        if not g:
            return "open table"
        left = len(self.mine(p.id))
        return f"{GROUP_LABEL[g]} · {left} left" if left else f"{GROUP_LABEL[g]} · on the 8!"

    def final_scores(self):
        if self.race > 1 and hasattr(self, "racks"):
            return {i: self.racks[i] for i in self.seats if i in self.room.players}
        return {i: self.room.players[i].g.sunk for i in self.seats if i in self.room.players}

    def view(self, p):
        shot = None
        if self.shot:
            shot = {k: self.shot.get(k) for k in ("id", "by", "order", "frames", "called", "stroke")}
            shot["age"] = max(0.0, time.time() - self.shot["at"])
        return {"billiards": {
            "W": TW, "H": TH, "R": R, "headX": HEAD_X, "pockets": [[x, y, c] for x, y, c in POCKETS],
            "balls": [[n, round(x, 2), round(y, 2)] for n, (x, y) in sorted(self.pos.items())],
            "rules": "9" if self.nine else "8", "groups": self.groups, "inHand": self.in_hand, "breaking": self.breaking,
            "targets": self.legal_targets(self.room.turn) if self.room.turn else [],
            "shot": shot, "last": self.last, "guide": self.s["guide"],
            "lead": STROKE_LEAD, "minSpeed": MIN_SPEED, "maxSpeed": self.table[1], "friction": self.table[0],
            "breakMaxSpeed": BREAK_MAX_SPEED, "breakFriction": BREAK_FRICTION,
            # the engine's constants, so the aim guide runs the same physics in the browser
            "phys": {"slide": SLIDE, "bounce": BOUNCE, "railGrip": RAIL_GRIP, "tipK": TIP_K,
                     "sideTip": SIDE_TIP, "sideDecay": SIDE_DECAY, "dt": DT, "stop": STOP, "throw": THROW,
                     "throwSlow": THROW_SLOW, "throwV": THROW_V, "squirt": SQUIRT,
                     "masseK": MASSE_K, "elevLoss": ELEV_LOSS, "maxElev": MAX_ELEV,
                     "cushionSoft": CUSHION_SOFT, "cushionHard": CUSHION_HARD, "cushionV": CUSHION_V, "near": NEAR_EDGE},
            "edges": [list(e) for e in EDGES],
            "calling": self.calling(self.room.turn) if self.room.turn and self.room.phase == "playing" else False,
            "pushOk": bool(getattr(self, "push_ok", False)), "pushChoice": getattr(self, "push_choice", None),
            "fouls": getattr(self, "fouls", {}),
            "race": self.race, "racks": getattr(self, "racks", {}), "rackNo": getattr(self, "rack_no", 1),
            "between": getattr(self, "between", False), "rackWinner": getattr(self, "rack_winner", None),
            "standings": self.standings() if getattr(self, "between", False) else None,
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
        if self.push_choice == p.id and (not shots or shots[0][0] < PUSH_TAKE[p.bot]):
            return self.hand_back(p)  # the rival pushed out to a poor spot: make them shoot it
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
        _, angle, power, hole, *rest = pick
        if not self.calling(p.id):
            hole = None
        self.shoot(p, angle + random.gauss(0, noise), min(1.0, power * random.uniform(0.95, 1.1)), cue,
                   spin=rest[0] if rest else 0.0, pocket=hole)

    def candidates(self, cx, cy, targets):
        """[(score, angle, power)] for direct pots, best first."""
        pos = dict(self.pos)
        pos[0] = (cx, cy)
        fric, top = self.table
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
                vx, vy = gx - cx, gy - cy
                dist1 = math.hypot(vx, vy)
                if dist1 < 1e-6:
                    continue
                cos = (vx * ux + vy * uy) / dist1
                if cos < 0.25:
                    continue
                v_obj = math.sqrt((dist2 + 25) / reach_k(fric))  # the object ball leaves skidding, then rolls
                arrive = v_obj / (cos * (1 + BOUNCE) / 2)
                v0, skidding = cue_speed(dist1, arrive, True, fric)
                # throw: the cut drags the object ball toward the cue ball's line, so cut a little thinner
                k = math.tan(throw_angle(cos, skidding, arrive))
                ax, ay = vx / dist1 - cos * ux, vy / dist1 - cos * uy  # the cue ball's sideways motion
                am = math.hypot(ax, ay)
                if am > 1e-9:
                    nx, ny = ux - k * ax / am, uy - k * ay / am
                    nm = math.hypot(nx, ny)
                    gx, gy = tx - nx / nm * 2 * R, ty - ny / nm * 2 * R
                    vx, vy = gx - cx, gy - cy
                    dist1 = math.hypot(vx, vy)
                if not (R * 0.5 <= gx <= TW - R * 0.5 and R * 0.5 <= gy <= TH - R * 0.5):
                    continue
                if not seg_clear(cx, cy, gx, gy, pos, {0, t}) or not seg_clear(tx, ty, aim_x, aim_y, pos, {0, t}):
                    continue
                power = max(0.03, min(1.0, (v0 - MIN_SPEED) / (top - MIN_SPEED)))
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
        fric, top = self.table  # enough to reach it and push it on a little, on either cloth
        v0 = cue_speed(math.hypot(tx - cx, ty - cy), 70, friction=fric)
        return math.atan2(ty - cy, tx - cx), max(0.05, min(1.0, (v0 - MIN_SPEED) / (top - MIN_SPEED)))

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
        if self.nine:
            mine = set(range(1, 9))
        targets = set(self.legal_targets(p.id))
        pos = dict(self.pos)
        if cue:
            pos[0] = cue
        best, best_val = shots[0], -1e9
        for shot in shots:
            for nudge in (0.0, 0.004, -0.004):
                if time.time() - start > 2.5:
                    return best
                val = shot[0] * 0.1 + self.try_shot(pos, shot[1] + nudge, shot[2], 0.0, targets, mine)
                if val > best_val:
                    best, best_val = (shot[0], shot[1] + nudge, shot[2], shot[3]), val
        # then play position: the same shot with follow or draw, if that leaves a better next shot
        if best_val > 0:
            for spin in (0.6, -0.6):
                if time.time() - start > 2.5:
                    break
                val = best[0] * 0.1 + self.try_shot(pos, best[1], best[2], spin, targets, mine)
                if val > best_val + 2:
                    best, best_val = (*best[:4], spin), val
        return best

    def try_shot(self, pos, angle, power, spin, targets, mine):
        """Hard bot: how well a shot works out in the real engine, including the next shot it leaves."""
        fric, top = self.table
        final, sunk, first, _ = simulate(pos, angle, MIN_SPEED + (top - MIN_SPEED) * power, record=False, spin=spin, friction=fric)
        val = 0.0
        if 0 in sunk or first is None or first not in targets:
            val -= 120
        if self.nine:
            if 9 in sunk:
                val += 1000 if 0 not in sunk and first in targets else -200
        elif 8 in sunk:
            val += 1000 if targets == {8} and 0 not in sunk and first == 8 else -1000
        good = [n for n in sunk if n not in (0, 8) and (mine is None or n in mine)]
        val += 60 * len(good)
        if good and 0 in final:  # leave: is there a next pot from here?
            nxt = [t for t in (sorted(mine & set(final)) if mine else []) if t in final]
            if self.nine:
                nxt = [min(n for n in final if n)] if any(final.keys() - {0}) else []
            saved = self.pos
            self.pos = final
            follow = self.candidates(*final[0], nxt or [8]) if (nxt or 8 in final) else []
            self.pos = saved
            val += 0.2 * follow[0][0] if follow else 0
        return val
