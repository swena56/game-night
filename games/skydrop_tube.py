"""Sky Drop's 🌀 Tube Runner play style (report #334): you ride the inside of a round tube.

Steering turns you round the wall, all the way if you like. A jump lifts you toward the middle and the wall pulls you
back. Rings lie on the wall or float above it (jump for those), and hazards sit on the wall (steer round or jump over).

A diver still has a flat position (x, z) across the tube, worked out from its angle and height, so rings, coins,
hazards and slipstreams are scored by the same code as the free dive. Angle 0 is the bottom and z points up.
"""
import math

WALL = 6.0                       # how far from the middle a ship on the wall rides (the tube itself is drawn a bit wider)
TURN = 3.4                       # radians a second round the wall at full stick
JUMP_V, GRAVITY = 10.6, 22.0     # up toward the middle and back: 2.55 high, just under a second in the air
JUMP_EARLY = 0.18                # a jump pressed this soon before landing still happens when you touch down
HIGH = 2.4                       # how far above the wall a floating ring hangs (more than a ring's radius: you must jump)
GEM_HIGH = 2.5
RING_SCALE = 0.72                # rings are smaller than the free dive's: the tube is narrow
MAX_TURN = 1.7                   # the most the ring line turns between two rings, so every line is runnable
HOP_T = 0.46                     # seconds from take-off to the top of a jump

# bots: (seconds between decisions, steering noise in radians, chance to line up each ring properly, jumps hazards)
BOT = {"easy": (0.24, 0.14, 0.33, False), "normal": (0.16, 0.10, 0.57, True), "hard": (0.10, 0.05, 0.85, True)}


def spot(angle, height=0.0):
    """(x, z) of a point this far above the wall at this angle."""
    r = WALL - height
    return round(r * math.sin(angle), 2), round(-r * math.cos(angle), 2)


def polar(x, z):
    """(angle, height above the wall) of a point."""
    return math.atan2(x, -z), WALL - math.hypot(x, z)


def turn_to(a, b):
    """The short way round from angle a to angle b."""
    return (b - a + math.pi) % math.tau - math.pi


def build(game, r, depths, level):
    """Fill the run's rings, coins, forks and hazards. level: the LEVELS entry's number, 1-8."""
    game.rings, game.coins, game.forks, game.hazards = [], [], {}, []
    line = []                     # (angle, height) of each ring
    angle, heading = 0.0, r.choice((-1, 1))
    high_left = 0
    for j, d in enumerate(depths):
        if j:
            if r.random() < 0.28:
                heading = -heading
            angle += heading * r.uniform(0.15, min(MAX_TURN, 0.8 + 0.12 * level))
        if not high_left and j > 1 and not line[-1][1] and r.random() < 0.3 + 0.025 * level:
            high_left = r.choice((1, 1, 2))
        height = HIGH if high_left else 0.0
        high_left = max(0, high_left - 1)
        line.append((angle, height))
        x, z = spot(angle, height)
        game.rings.append([d, x, z, 1.3 if height else 1.0])   # a ring you have to jump for pays more
    for j in range(len(depths) - 1):
        (a, h), (b, hb) = line[j], line[j + 1]
        d, nd = depths[j], depths[j + 1]
        if r.random() < 0.7:   # a trail of coins along the way to the next ring
            for k in (1, 2, 3):
                t = k / 4
                x, z = spot(a + (b - a) * t, h if t < 0.3 and h else hb if t > 0.7 and hb else 0.0)
                game.coins.append([round(d + (nd - d) * t, 2), x, z, 0])
        if j % 3 == 1:         # 💎 a gem floating well to one side
            gd = round((d + nd) / 2, 2)
            x, z = spot((a + b) / 2 + r.choice((-1, 1)) * 1.5, GEM_HIGH)
            game.coins.append([gd, x, z, 1])
            game.forks[j] = (gd, x, z)
    if game.s.get("hazards", True):
        gap = max(20, 40 - 2.5 * level)
        d = 46.0
        while d < depths[-1]:
            # where the ring line is at this depth, so a hazard can be put beside it or squarely on a flat stretch
            j = max(0, min(len(depths) - 2, int((d - depths[0]) // (depths[1] - depths[0]))))
            t = max(0.0, min(1.0, (d - depths[j]) / (depths[j + 1] - depths[j])))
            on = line[j][0] + (line[j + 1][0] - line[j][0]) * t
            flat = not line[j][1] and not line[j + 1][1] and 0.3 < t < 0.7
            kind = 3 if r.random() < 0.2 else r.choice((0, 1))
            if flat and r.random() < 0.25 + 0.04 * level:
                offs = [0.0]                                      # right across your path: jump it
                kind = r.choice((0, 1))
            else:
                offs = [r.choice((-1, 1)) * r.uniform(0.9, 2.6)]  # beside the line: stay on course
                if level >= 3 and r.random() < 0.5:
                    offs.append(-offs[0] * r.uniform(0.9, 1.3))
            for off in offs:
                x, z = spot(on + off)
                game.hazards.append([round(d, 1), x, z, kind, round(r.uniform(0, math.tau), 2)])
            d += gap * (1 - 0.35 * d / depths[-1])


def jump(f, now):
    """The jump button: off the wall now, or as soon as you land if you're nearly down."""
    f.jump_at = now


def move(f, dt, now, stunned):
    """Turn and hop. Sets f.x, f.z and their speeds (browsers glide between updates with those)."""
    old_x, old_z = f.x, f.z
    target = 0.0 if stunned else f.sx * TURN
    f.spin += (target - f.spin) * min(1.0, dt * 10.0)
    f.angle = (f.angle + f.spin * dt + math.pi) % math.tau - math.pi
    if f.height <= 0 and not stunned and now - f.jump_at <= JUMP_EARLY:
        f.rise, f.jump_at = JUMP_V, -9.0
    if f.height > 0 or f.rise > 0:
        f.height += f.rise * dt - GRAVITY * dt * dt / 2
        f.rise -= GRAVITY * dt
        if f.height <= 0:
            f.height, f.rise = 0.0, 0.0
    r = WALL - f.height
    f.x, f.z = r * math.sin(f.angle), -r * math.cos(f.angle)
    f.vx, f.vz = ((f.x - old_x) / dt, (f.z - old_z) / dt) if dt > 0 else (0.0, 0.0)


def bot_think(game, f, level, now, speed):
    interval, noise, focus, hops = BOT.get(level, BOT["normal"])
    if now < f.next_bot:
        return
    f.next_bot = now + interval
    ri = next((j for j, ring in enumerate(game.rings) if ring[0] > f.depth), None)
    if ri is None:
        f.sx = 0.0
        return
    d, x, z, _ = game.rings[ri]
    angle, height = polar(x, z)
    if f.aim_ring != ri:
        f.aim_ring = ri
        f.aim_dx = 0.0 if game.rng.random() < focus else game.rng.choice((-1, 1)) * game.rng.uniform(0.35, 0.8)
    miss = turn_to(f.angle, angle + f.aim_dx)
    dodge = False
    if hops:   # a hazard on the wall dead ahead: hop it, or lean away if a hop would be too late
        for hd, hx, hz, _, _ in game.hazards:
            ahead = (hd - f.depth) / speed
            if 0 < ahead < 0.55 and abs(turn_to(f.angle, polar(hx, hz)[0])) < 0.26:
                if f.height <= 0 and ahead > 0.12:
                    dodge = True
                break
    f.sx = max(-1.0, min(1.0, miss * 2.6 + game.rng.uniform(-noise, noise)))
    wants = height > 1 and (d - f.depth) / speed <= HOP_T + interval / 2 and (not f.aim_dx or level == "hard")
    if (wants or dodge) and f.height <= 0:
        jump(f, now)
    if f.boosts and now >= f.boost_cool and abs(d - f.depth) < 14 and abs(miss) < 0.2 and not height:
        f.boosts -= 1
        f.boost_until, f.boost_cool = now + 1.25, now + 2.5
