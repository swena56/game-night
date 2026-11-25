"""Deterministic checks of the table, controllers and room lifecycle."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from games.pinball import (
    BALL, BUMPS, FLIP_RADIUS, FLIPPERS, JACKPOT_TICKS, LAUNCH, LAYOUT, RAMP, RAMP_EXIT, ROLLOVERS,
    SANDBOX_PARTS, SLINGS, SPINNER, TABLES, TARGETS, Table as GoldenHour,
)
from dataclasses import dataclass
from server import Room


@dataclass
class Table(GoldenHour):
    post_used: bool = True      # most checks want a plain drain, not the one-time centre post


def launch(charge):
    table = Table()
    table.input(4, 0, 0)
    for tick in range(charge):
        if tick % 24 == 0:
            table.input(4, 0, tick / 240)
        table.step()
    table.input(0, 0, charge / 240)
    return table


def placed(x, y, vx=0, vy=0):
    return Table(staged=False, x=x, y=y, vx=vx, vy=vy, still_origin=(x, y))


class PinballRules(unittest.TestCase):
    def test_progressive_jackpot_pool(self):
        table = Table()
        table.staged = False
        table.jackpot_ticks = 1000
        x, y, radius = BUMPS[0]
        table.x, table.y, table.vx, table.vy = x, y - BALL - radius + .01, 0, 5
        table.mechanisms(table.y)
        self.assertEqual(table.jackpot_pool, table.rules.jackpot_growth)
        table.jackpot_shot, table.ramp_ticks = True, 116
        before = table.score
        table.ride_ramp()
        self.assertGreaterEqual(table.score - before, table.rules.jackpot + table.rules.jackpot_growth)
        self.assertEqual(table.jackpot_pool, 0)

    def test_modes(self):
        from games.pinball import MODES
        attack = Table(**MODES["timeattack"])
        attack.staged, attack.clock = False, 10
        for _ in range(12):
            attack.step()
        self.assertEqual((attack.balls, attack.event, attack.clock), (0, "done", 0))
        zen = Table(**MODES["zen"])
        zen.staged = False
        for _ in range(10):
            zen.nudge(1)
        self.assertFalse(zen.tilt)
        practice = Table(**MODES["practice"])
        self.assertEqual(practice.balls, 99)
        self.assertEqual(practice.public()[-1]["mode"], "practice")

    def test_wizard_multiball_on_eighth_jackpot(self):
        table = Table()
        table.staged = False
        table.jackpots = 7
        table.jackpot_shot, table.ramp_ticks = True, 116
        before = table.score
        table.ride_ramp()
        self.assertEqual((table.jackpots, table.wizards, len(table.others)), (8, 1, 3))
        self.assertGreaterEqual(table.score - before, table.rules.wizard_points)
        table.others.clear()
        table.jackpot_shot, table.ramp_ticks = True, 116
        table.jackpots = 8
        table.ride_ramp()
        self.assertEqual(table.wizards, 1)      # only once per game

    def test_missions_skill_lane_and_final_bonus(self):
        table = Table()
        table.staged = False
        table.start_mission()
        title, shot, goal, reward = table.rules.missions[0]
        self.assertEqual(shot, "bumper")
        before = table.score
        for _ in range(goal):
            table.signal("bumper0", 100)
        self.assertEqual((table.mission, table.missions_done), (-1, 1))
        self.assertGreaterEqual(table.score - before, reward + goal * 100)
        table.start_mission()
        table.mission_ticks = 1
        table.step()
        self.assertEqual(table.mission, -1)      # timed out
        # the lit skill lane rotates every ball
        lane = table.skill_lane
        table.drain()
        self.assertNotEqual(table.skill_lane, lane)
        # the last ball pays a bonus for jackpots and multiballs
        end = Table(balls=1)
        end.jackpots, end.multiballs = 2, 1
        end.staged = False
        end.drain()
        self.assertEqual(end.bonus, 3 * end.rules.final_bonus)

    def test_plunge_and_skill_shot(self):
        weak = launch(10)
        self.assertFalse(weak.staged)
        self.assertLess(weak.vy, 0)
        for _ in range(800):
            weak.step()
        self.assertEqual((weak.staged, weak.balls, weak.score), (True, 3, 0))
        for charge in (197, 212, 228):
            a, b = launch(charge), launch(charge)
            seen = set()
            for _ in range(420):
                a.step()
                b.step()
                self.assertEqual(a.public(), b.public())
                seen.add(a.event)
            self.assertIn("skill", seen)
            self.assertGreaterEqual(a.score, a.rules.skill_miss)   # 5,000 in the lit lane, 1,000 in the others
        strong = launch(450)
        self.assertEqual(strong.vy, -32)
        self.assertFalse(strong.skill)

    def test_buffer_and_swept_flippers(self):
        for i, (x, y, rest, _) in enumerate(FLIPPERS):
            direction = 1 if i == 0 else -1
            table = placed(x + 1.26 * direction, y + .15)
            table.input(1 << i, 0, 0)
            table.input(0, 0, .001)
            table.step()
            self.assertLess(table.vy, -10)
            self.assertNotEqual(table.angles[i], rest)
            for _ in range(30):
                table.step()
            self.assertAlmostEqual(table.angles[i], rest)

    def test_rails_bumpers_and_slings(self):
        table = placed(BALL + .02, 4, -9)
        table.step()
        self.assertGreater(table.vx, 0)
        for i, (x, y, radius) in enumerate(BUMPS):
            table = placed(x + radius + BALL + .03, y, -12)
            table.step()
            self.assertEqual((table.event, table.score), (f"bumper{i}", 100))
            self.assertGreater(table.vx, 0)
        for i, (ax, ay, bx, by) in enumerate(SLINGS):
            dx, dy = bx - ax, by - ay
            n = math.hypot(dx, dy)
            nx, ny = dy / n, -dx / n
            table = placed((ax + bx) / 2 + .31 * nx, (ay + by) / 2 + .31 * ny, -12 * nx, -12 * ny)
            table.step()
            self.assertEqual((table.event, table.score), (f"sling{i}", 50))

    def test_slings_need_a_hard_hit_and_dropped_targets_are_flush(self):
        ax, ay, bx, by = SLINGS[0]
        n = math.hypot(bx - ax, by - ay)
        nx, ny = (by - ay) / n, -(bx - ax) / n
        table = placed((ax + bx) / 2 + .31 * nx, (ay + by) / 2 + .31 * ny, -1.5 * nx, -1.5 * ny)
        table.step()
        self.assertEqual(table.score, 0)
        x, y, _, end = TARGETS[0]
        table = placed(x + .29, (y + end) / 2, -10, 0)
        table.bank = 1
        table.step()
        self.assertLess(table.vx, 0)

    def test_saucer_holds_then_kicks_the_ball_out(self):
        from games.pinball import SAUCER
        x, y, radius = SAUCER
        table = placed(x, y + .1, 0, -3)
        table.step()
        self.assertEqual((table.event, table.score), ("saucer", 1000))
        for _ in range(table.rules.saucer_ticks - 2):
            table.step()
        self.assertEqual((table.x, table.y), (x, y))
        for _ in range(3):
            table.step()
        self.assertGreater(math.hypot(table.x - x, table.y - y), radius)
        self.assertGreater(table.vx, 0)
        self.assertEqual(table.score, 1000)

    def test_subway_hides_the_ball_then_fires_it_from_the_exit(self):
        from games.pinball import SUBWAY, SUBWAY_EXIT
        table = placed(SUBWAY[0], SUBWAY[1] + .1, 0, -3)
        table.step()
        self.assertEqual((table.event, table.score, table.height), ("subway", 2000, -1))
        self.assertEqual((table.x, table.y), SUBWAY_EXIT[:2])
        for _ in range(table.rules.subway_ticks):
            table.step()
        self.assertEqual((table.height, table.vx, table.vy), (0, SUBWAY_EXIT[2], SUBWAY_EXIT[3] + 0))
        self.assertEqual(table.score, 2000)

    def test_posts_bounce_and_magnet_only_grabs_when_armed(self):
        from games.pinball import MAGNET, POSTS
        x, y, r = POSTS[0]
        table = placed(x + r + BALL + .02, y, -6)
        table.step()
        self.assertGreater(table.vx, 0)
        self.assertEqual(table.score, 0)
        table = placed(MAGNET[0] + .6, MAGNET[1], 0, 0)
        table.step()
        self.assertEqual((table.magnet_ticks, table.score), (0, 0))   # idle outside a jackpot round
        table = placed(MAGNET[0] + .6, MAGNET[1], 0, 0)
        table.jackpot_ticks = 5000
        table.step()
        self.assertEqual((table.event, table.score), ("magnet", 1500))
        self.assertLess(table.vx, 0)
        for _ in range(table.rules.magnet_ticks):
            table.step()
        self.assertEqual(table.magnet_ticks, 0)
        self.assertGreater(table.magnet_cool, 0)

    def test_flippers_rotate_lit_lanes_and_slings_reset(self):
        table = placed(5, 11)
        table.staged = False
        table.lane_bits = 0b001
        table.input(2, 0, 0)          # right flipper: lit lane moves right
        self.assertEqual(table.lane_bits, 0b010)
        table.input(0, 0, 0)
        table.input(1, 0, 0)          # left flipper: moves back
        self.assertEqual(table.lane_bits, 0b001)
        table.input(0, 0, 0)
        table.input(1, 0, 0)
        self.assertEqual(table.lane_bits, 0b100)   # wraps around
        ax, ay, bx, by = SLINGS[0]
        n = math.hypot(bx - ax, by - ay)
        nx, ny = (by - ay) / n, -(bx - ax) / n
        table = placed((ax + bx) / 2 + .31 * nx, (ay + by) / 2 + .31 * ny, -12 * nx, -12 * ny)
        table.step()
        self.assertIn(0, table.sling_cool)
        table.x, table.y = (ax + bx) / 2 + .31 * nx, (ay + by) / 2 + .31 * ny
        table.vx, table.vy = -12 * nx, -12 * ny
        table.step()
        self.assertEqual(table.score, 50)         # the second hit inside the cooldown does not fire

    def test_ball_physics_details(self):
        # a faster ball is slowed more per tick, and a glancing hit on rubber spins it
        slow, fast = placed(5, 4, 0, 5), placed(5, 4, 0, 30)
        slow.step(); fast.step()
        self.assertGreater(abs(fast.vy - 30), abs(slow.vy - 5) - .5)
        table = placed(BALL + .02, 4, -6, -9)     # skims the left wall
        table.step()
        self.assertNotEqual(table.english, 0)
        # english curves the path; it is zeroed when the ball drains
        table = placed(5, 4, 0, 10)
        table.english = 2
        table.step()
        self.assertNotEqual(table.vx, 0)
        # a held flipper gives a dead catch; a swinging one throws the ball harder
        fx, fy, rest, up = FLIPPERS[0]
        reach = LAYOUT["length"] / 2
        ux, uy = math.sin(up), -math.cos(up)           # the bat's upward normal
        gap = BALL + FLIP_RADIUS - .02
        dead = placed(fx + reach * math.cos(up) + ux * gap, fy + reach * math.sin(up) + uy * gap, -8 * ux, -8 * uy)
        dead.angles[0] = up
        dead.held = 1
        dead.step()
        self.assertLess(math.hypot(dead.vx, dead.vy), 4)

    def test_right_outlane_special_and_ball_search(self):
        from games.pinball import SPECIAL
        table = placed(SPECIAL[0] + .4, SPECIAL[1] + .2, 0, 3)
        table.step()
        self.assertEqual(table.score, 0)           # unlit at 1x
        table = placed(SPECIAL[0] + .4, SPECIAL[1] + .2, 0, 3)
        table.mult = 2
        table.step()
        self.assertEqual((table.event, table.score, table.save_ticks > 0), ("special", 10000, True))
        table.y, table.vy = SPECIAL[1] + .2, 3
        table.step()
        self.assertEqual(table.score, 10000)       # once per ball
        table = placed(3, 4, 0, 0)
        events = set()
        for _ in range(table.rules.search_ticks + 5):
            table.x, table.y, table.vx, table.vy = 3, 4, 0, 0
            table.step()
            events.add(table.event)
        self.assertIn("search", events)

    def test_orbit_carries_the_ball_then_the_diverter_shuts(self):
        from games.pinball import ORBIT, ORBIT_EXIT, ORBIT_PATH
        table = placed(ORBIT[0], ORBIT[1] + .1, 0, -8)
        table.step()
        self.assertGreater(table.orbit_ticks, 0)
        seen = []
        for _ in range(table.rules.orbit_ticks + 2):
            table.step()
            seen.append((table.x, table.y, table.height))
        self.assertTrue(all(h == .45 for *_, h in seen[:table.rules.orbit_ticks - 2]))
        self.assertEqual((table.event, table.score), ("orbit", 3000))
        self.assertAlmostEqual(table.vx, ORBIT_EXIT[0], delta=2.1)
        self.assertAlmostEqual(table.vy, ORBIT_EXIT[1], delta=.2)
        self.assertGreater(table.orbit_cool, 0)
        # the diverter is shut: a second shot up the wall is just a wall hit
        table.x, table.y, table.vx, table.vy = ORBIT[0], ORBIT[1] + .1, 0, -8
        table.step()
        self.assertEqual(table.orbit_ticks, 0)

    def test_batch_of_small_realism_details(self):
        # danger on the last allowed nudge, slam tilt on a burst of nudges
        table = placed(5, 11)
        table.staged = False
        events = []
        for _ in range(3):
            table.nudge(1)
            events.append(table.event)
            table.ticks += 200
        self.assertEqual(events, ["nudge", "nudge", "danger"])
        slam = placed(5, 11)
        slam.staged = False
        for _ in range(4):
            slam.nudge(1)
        self.assertTrue(slam.tilt)
        # a light touch on a stand-up target bounces; a firm one drops it and spots its rollover lane
        x, y, _, end = TARGETS[0]
        light = placed(x + .29, (y + end) / 2, -1, 0)
        light.step()
        self.assertEqual((light.bank, light.score), (0, 0))
        firm = placed(x + .29, (y + end) / 2, -10, 0)
        firm.step()
        self.assertEqual((firm.bank, firm.lane_bits), (1, 1))
        # rapid bumper hits weaken the coil and set a streak; posts glow on contact
        table = placed(5, 11)
        bx, by, br = BUMPS[0]
        table.bumper_heat = .4
        table.x, table.y, table.vx, table.vy = bx + br + .2, by, -10, 0
        table.step()
        self.assertEqual(table.bumper_streak, 1)
        self.assertLess(table.vx, 16 * .7 + 10)
        from games.pinball import POSTS
        px, py, pr = POSTS[0]
        table = placed(px + pr + BALL + .02, py, -6)
        table.step()
        self.assertGreater(table.post_glow, 0)
        # an under-powered shot at the lit ramp rolls back instead of going up
        rx, ry = RAMP
        table = placed(rx, ry + .01, 0, -4)
        table.bank = 7
        table.step()
        self.assertEqual(table.event, "rampfall")
        self.assertGreater(table.vy, 0)

    def test_lanes_spinner_bank_and_ramp(self):
        table = placed(*ROLLOVERS[0])
        for _ in range(4):
            table.step()
        self.assertEqual(table.score, 500)
        x, y = SPINNER
        table = placed(x, y - .01, vy=13)
        for _ in range(100):
            table.step()
        # a ball dropping onto the back of the paddle pays half: two rotations at 50 each (the spinner coasts to a stop)
        self.assertEqual((table.event, table.score), ("spinner", 100))
        self.assertEqual(table.spins, 2)

        table = placed(*LAUNCH)
        table.lit = 0
        for i, (x, y, _, end) in enumerate(TARGETS):
            for _ in range(2):
                table.x, table.y, table.vx, table.vy = x + .29, (y + end) / 2, -10, 0
                table.step()
            self.assertEqual(table.score, (i + 1) * 250)
        self.assertEqual(table.bank, 7)
        table.x, table.y = RAMP[0], 9
        table.vx, table.vy = 0, -15
        for _ in range(100):
            table.step()
            if table.ramp_ticks:
                break
        self.assertTrue(table.ramp_ticks)
        for _ in range(58):
            table.step()
        self.assertGreater(table.height, 1.5)
        for _ in range(57):
            table.step()
        self.assertEqual((table.event, table.score, table.bank), ("lock", 7000, 0))
        self.assertEqual(table.jackpot_ticks, JACKPOT_TICKS)
        self.assertTrue(table.staged)            # the first ramp shot locks the ball and re-serves
        self.assertEqual((table.x, table.y), LAUNCH)

    def test_combo_lit_shot_and_kickback(self):
        table = placed(*ROLLOVERS[0])
        table.lit = 0
        for _ in range(4):
            table.step()
        self.assertEqual((table.score, table.lit, table.combo), (1000, 1, 1))  # lit lane pays double
        x, y, _, end = TARGETS[0]
        table.x, table.y, table.vx, table.vy = x + .29, (y + end) / 2, -10, 0
        table.step()
        self.assertEqual((table.combo, table.lit), (2, 2))
        self.assertEqual(table.score, 1000 + 250 + 250 + 250)  # target, lit double, combo bonus
        self.assertEqual(table.public()[23], 2)
        table.combo_ticks = 1
        table.step()
        self.assertEqual(table.public()[23], 0)
        table = placed(.4, 14.5, vy=6)
        table.step()
        self.assertEqual((table.event, table.kickback, table.vy < 0), ("kickback", False, True))
        table.x, table.y, table.vx, table.vy = .4, 14.5, 0, 6
        table.step()
        self.assertNotEqual(table.event_id, 0)
        self.assertGreater(table.vy, 0)  # only once per ball

    def test_jackpot_locks_in_at_ramp_entry(self):
        x, y = RAMP
        table = placed(x, y + .01, vy=-15)
        table.lit = 0
        table.jackpot_ticks = 2
        table.step()
        self.assertEqual(table.ramp_ticks, 1)
        for _ in range(115):
            table.step()
        self.assertEqual((table.event, table.score, table.jackpot_ticks), ("jackpot", 12000, 0))
        table.x, table.y, table.vx, table.vy = x, y + .01, 0, -15
        table.step()
        self.assertEqual(table.ramp_ticks, 0)

    def test_opening_save_relaunches_once(self):
        table = launch(212)
        self.assertEqual(table.save_ticks, 0)
        for _ in range(420):
            table.step()
            if table.save_ticks:
                break
        self.assertGreater(table.save_ticks, 0)
        for expected_balls in (3, 2):
            table.x, table.y = 5, 17.3
            table.vx = table.vy = 0
            table.step()
            self.assertEqual((table.balls, table.save_ticks), (expected_balls, 0))
            if expected_balls == 3:
                self.assertEqual((table.event, table.staged, table.vy), ("save", False, -30))
                for _ in range(420):
                    table.step()
                self.assertLess(table.x, 8.8)
                self.assertEqual(table.save_ticks, 0)
        self.assertFalse(table.save_used)

    def test_playfield_guides_collide_at_published_positions(self):
        for ax, ay, bx, by in LAYOUT["rails"][-4:]:
            with self.subTest(rail=(ax, ay, bx, by)):
                length = math.hypot(bx - ax, by - ay)
                nx, ny = (by - ay) / length, (ax - bx) / length
                x, y = (ax + bx) / 2, (ay + by) / 2
                table = placed(x + (BALL + .02) * nx, y + (BALL + .02) * ny, -12 * nx, -12 * ny)
                table.step()
                self.assertGreater(table.vx * nx + table.vy * ny, 0)
                self.assertAlmostEqual((table.x - x) * nx + (table.y - y) * ny, BALL, places=4)
                self.assertEqual(table.score, 0)

    def test_nudge_queue_tilt_and_ball_reset(self):
        table = placed(5, 11)
        for direction in (-1, 2, 1, 1):
            table.input(3, direction, 0)
        self.assertEqual(table.pending, [-1, 2, 1, 1])
        table.step()
        self.assertEqual((table.nudges, table.tilt, table.event), (3, True, "tilt"))
        self.assertEqual(table.angles, [f[2] for f in FLIPPERS])
        table.x, table.y = ROLLOVERS[0]
        table.step()
        self.assertEqual(table.score, 0)
        table.x, table.y = 5, 17.3
        table.step()
        self.assertEqual((table.balls, table.staged, table.tilt, table.nudges), (2, True, False, 0))

    def test_stuck_ball_recovery(self):
        table = placed(5, 12)
        for i in range(720):
            table.vx = table.vy = 0
            table.step()
            # the ball search fires once at 360 ticks, then the recovery at 720
            self.assertEqual(table.event_id, (i >= 359) + (i == 719))
        self.assertEqual((table.event, table.score, table.balls, table.vy), ("recovery", 0, 3, 4))

    def test_timeout_and_reset_do_not_release_plunger(self):
        table = Table()
        table.input(5, 0, 0)
        for _ in range(48):
            table.step()
        table.input(5, 0, .2)
        table.expire(.44)
        self.assertEqual(table.held, 5)
        table.expire(.46)
        table.input(0, 0, .46)
        self.assertTrue(table.staged)
        self.assertEqual((table.held, table.charge), (0, 0))

    @staticmethod
    def room(count):
        room = Room("PINTEST")
        players = [room.add_player(f"Player {i}") for i in range(count)]
        room.switch_game("pinball")
        room.start()
        return room, players

    def test_room_multiplayer_public_updates_and_departures(self):
        room, players = self.room(6)
        game = room.game
        a, b, c, *others = players
        ta, tb = game.tables[a.id], game.tables[b.id]
        send = lambda p, t, held: game.on_input(p, {"epoch": t.epoch, "ball": t.balls, "held": held})
        with room.cond, patch("games.pinball.time.time", return_value=1):
            send(a, ta, 4)
            send(b, tb, 5)
            self.assertFalse(game.frame(1))
            self.assertFalse(game.frame(1 + 1/60))
            self.assertEqual((ta.charge, tb.charge), (8, 8))
            self.assertNotEqual(ta.angles, tb.angles)
            self.assertEqual(room.fast_ver, 1)
            self.assertNotIn("epoch", room.fast)
            send(a, ta, 0)
            self.assertFalse(ta.staged)
            self.assertTrue(tb.staged)
            ta.score = 200
            ta.post_used = True
            for i in range(3):
                ta.x, ta.y, ta.staged = 5, 17.3, False
                self.assertFalse(game.frame(1 + i / 60))
            self.assertEqual(ta.balls, 0)
            for player in others + [c]:
                game.on_leave(player)
            self.assertEqual(room.phase, "playing")
            self.assertNotIn(c.id, game.snapshot()["tables"])
            game.on_leave(b)
            self.assertEqual((room.phase, room.winner, game.final_scores()), ("over", a.id, {a.id: 200}))

    def test_stale_inputs_on_pause_reconnect_and_drain(self):
        room, (player,) = self.room(1)
        game = room.game
        table = game.tables[player.id]
        action = {"epoch": table.epoch, "ball": 3, "held": 4}
        with room.cond:
            game.on_input(player, action)
            game.frame(table.last_input)
            room.pause(player)
            room.resume(player)
            game.on_input(player, action)
            self.assertEqual((table.held, table.charge), (0, 0))
            action["epoch"] = table.epoch
            game.on_input(player, action)
            room.connected(player)
            game.on_input(player, action)
            self.assertEqual(table.held, 0)
            action["epoch"] = table.epoch
            table.drain()
            game.on_input(player, action)
            self.assertEqual(table.held, 0)

    def test_lane_multiplier_and_bonus(self):
        table = placed(*ROLLOVERS[0])
        for i, (x, y) in enumerate(ROLLOVERS):
            table.x, table.y = x, y
            table.mechanisms(y)
            table.x, table.y = 5, 9
            table.mechanisms(9)
        self.assertEqual((table.mult, table.lane_bits, table.event), (2, 0, "mult"))
        table.bumper_hits, table.ramps = 5, 1
        before = table.score
        table.drain()
        self.assertEqual((table.bonus, table.score - before, table.mult, table.event), (2100, 2100, 1, "bonus"))
        self.assertEqual(len(table.public()), 31)

    def shoot_ramp(self, table):
        table.bank = 7
        rx, ry = RAMP
        table.x, table.y, table.vx, table.vy = rx, ry + .02, 0, -12
        for _ in range(130):
            table.step()

    def test_ramp_locks_then_starts_multiball(self):
        table = placed(5, 9)
        self.shoot_ramp(table)
        self.assertEqual((table.event, table.locked, table.staged, table.balls, len(table.others)),
                         ("lock", 1, True, 3, 0))
        table.staged, table.jackpot_ticks = False, 0
        table.x, table.y = 5, 9
        table.vx = table.vy = 0
        self.shoot_ramp(table)
        self.assertEqual((table.event, table.locked, table.balls, len(table.others)), ("multiball", 0, 3, 2))
        self.assertEqual(len(table.public()[26]), 2)
        self.assertGreater(table.jackpot_ticks, 30 * 240)

    def test_lock_reserve_has_no_skill_shot(self):
        table = Table()
        table.locked = 1
        table.input(4, 0, 0)
        for tick in range(212):
            if tick % 24 == 0:
                table.input(4, 0, tick / 240)
            table.step()
        table.input(0, 0, 212 / 240)
        self.assertFalse(table.skill)
        self.assertFalse(table.staged)

    def test_multiball_drains_balls_one_at_a_time(self):
        table = placed(5, 9)
        table.others = [table.free_ball(3, 8, 0, 0), table.free_ball(6, 8, 0, 0)]
        table.y = LAYOUT["height"] + 1          # the main ball drains first
        table.step()
        self.assertEqual((table.balls, len(table.others)), (3, 1))
        self.assertLess(table.y, 12)             # an extra took over as the main ball
        table.others[0]["y"] = LAYOUT["height"] + 1
        table.step()
        self.assertEqual((table.balls, len(table.others)), (3, 0))
        table.y = LAYOUT["height"] + 1
        table.step()
        self.assertEqual(table.balls, 2)         # only the last ball costs one

    def test_multiball_extras_score_and_nudge(self):
        table = placed(5, 11)
        x, y, r = BUMPS[0]
        table.others = [table.free_ball(x + r + .2, y, -10, 0)]
        table.step()
        self.assertEqual(table.score, table.rules.bumper_jackpot)
        table.nudge(1)
        self.assertGreater(table.others[0]["vx"], table.vx - 1)

    def test_multiball_jackpot_survives_timer_and_counts_with_extra_ball(self):
        x, y = RAMP
        table = placed(x, y + .02, vy=-10)
        table.score = table.rules.extra_ball_scores[0] - 1
        table.others = [table.free_ball(3, 8, 0, 0)]
        table.step()
        self.assertTrue(table.jackpot_shot)
        table.ramp_ticks = 115
        table.step()
        self.assertEqual(table.event, "extra")
        self.assertEqual(table.public()[30]["jackpot"], 1)
        self.assertEqual(table.public()[30]["extra"], 1)

    def test_mystery_super_spinner_bumper_levels_and_hold(self):
        table = Table()
        table.rng.seed(1)
        # every third lit-shot double pays a mystery prize
        for _ in range(3):
            table.lit = 1
            table.signal("target0", 250)
        self.assertTrue(table.event.startswith("mystery_"))
        table.hold, table.mult, table.bumper_hits, table.ramps = True, 2, 5, 1
        table.drain()
        self.assertEqual((table.mult, table.bumper_hits, table.ramps, table.hold), (2, 5, 1, False))
        table.drain()
        self.assertEqual((table.mult, table.bumper_hits, table.ramps), (1, 0, 0))
        # spinner and bumper levels grow with use
        table = Table()
        table.spins = 25
        table.spin, table.spin_left = .99, 1
        table.staged = False
        before = table.score
        table.step()
        self.assertEqual(table.score - before, 200)
        table.bumper_hits = 40
        x, y, r = BUMPS[0]
        table.x, table.y, table.vx, table.vy = x + r + .2, y, -10, 0
        before = table.score
        table.step()
        self.assertEqual(table.score - before, 200)
        # every fourth jackpot is a super jackpot
        table = Table()
        table.jackpots, table.lit, table.extras = 3, 0, 2
        table.jackpot_shot = True
        table.ramp_ticks = 115
        table.staged = False
        table.step()
        self.assertEqual((table.event, table.score), ("super", 50000))

    def test_hurry_up_decays_and_pays_on_the_spinner(self):
        table = Table(staged=False)
        table.hurry_ticks = table.rules.hurry_ticks
        table.spin, table.spin_left = .99, 1
        table.step()
        self.assertEqual(table.event, "hurry")
        self.assertGreater(table.last_points, 14000)
        self.assertEqual(table.hurry_ticks, 0)
        late = Table(staged=False)
        late.hurry_ticks = 24
        late.spin, late.spin_left = .99, 1
        late.step()
        self.assertLess(late.last_points, 2000)

    def test_centre_post_and_multiball_saves(self):
        table = GoldenHour(staged=False, x=5, y=LAYOUT["height"] + 1)
        table.step()
        self.assertEqual((table.event, table.balls, table.post_used), ("post", 3, True))
        table.x, table.y = 5, LAYOUT["height"] + 1
        table.step()
        self.assertEqual(table.balls, 2)         # only one post save per game
        table = placed(5, 9)
        table.others, table.mb_save_ticks = [table.free_ball(3, 8, 0, 0)], 100
        table.y = LAYOUT["height"] + 1
        table.step()
        self.assertEqual((table.event, len(table.others)), ("save", 1))
        self.assertLess(table.y, 12)

    def test_lanes_rearm_kickback(self):
        table = placed(5, 9)
        table.kickback = False
        table.lane_bits = 3
        x, y = ROLLOVERS[2]
        table.x, table.y = x, y
        table.mechanisms(y)
        self.assertTrue(table.kickback)

    def test_neon_arcade_table_is_playable(self):
        neon = TABLES["neon"][1]
        self.assertEqual(neon.layout.public()["theme"], "neon")
        self.assertEqual(len(neon.layout.bumps), 4)
        table = neon(staged=False, x=5, y=9, post_used=True)
        x, y, r = neon.layout.bumps[0]
        table.x, table.y, table.vx, table.vy = x + r + .2, y, -10, 0
        table.step()
        self.assertEqual(table.score, 150)       # Neon bumpers pay more
        for _ in range(240 * 20):
            table.step()
            if not table.balls:
                break
        self.assertTrue(math.isfinite(table.x))

    def test_tilt_forfeits_bonus(self):
        table = placed(5, 17.4)
        table.bumper_hits, table.tilt = 10, True
        table.drain()
        self.assertEqual((table.bonus, table.score, table.event), (0, 0, "drain"))

    def test_gate_blocks_launch_lane_reentry(self):
        table = placed(8.4, 2.2, vx=14, vy=0)
        for _ in range(240):
            table.step()
            self.assertLess(table.x, 8.8)
        saved = placed(*LAUNCH)
        saved.save_ticks, saved.y = 240, 17.4
        saved.step()
        for _ in range(600):
            saved.step()
            if saved.x < 8.8 and saved.y < 5:
                break
        self.assertLess(saved.y, 5)

    def test_tied_completion(self):
        room, players = self.room(2)
        game = room.game
        with room.cond:
            for player in players:
                table = game.tables[player.id]
                table.balls = 1
                table.staged = False
                table.post_used = True
                table.y = 17.4
            self.assertTrue(game.frame(1))
            self.assertEqual((room.phase, room.winner), ("over", None))
            self.assertEqual(game.final_scores(), dict.fromkeys((p.id for p in players), 0))


class SandboxTables(unittest.TestCase):
    """The sandbox keeps the cabinet but removes every playfield part except the one picked."""

    PARTS = ("bumps", "slings", "targets", "lanes", "spinner", "ramp", "orbit", "saucer", "subway", "magnet", "posts", "outlane", "special")

    def test_each_part_is_alone_and_runs(self):
        for part, (_, extra) in SANDBOX_PARTS.items():
            with self.subTest(part=part):
                table = TABLES["sandbox_" + part][1](balls=99)
                lay = table.layout
                present = {name for name in self.PARTS if getattr(lay, name)}
                self.assertLessEqual(present, set(extra) | {"rails"} | ({"posts"} if part == "lanes" else set()))
                for name in extra:
                    if name not in ("rails", "orbit_path", "orbit_exit", "ramp_exit", "subway_exit"):
                        self.assertTrue(getattr(lay, name), name)
                for tick in range(240 * 20):
                    if table.staged:
                        table.input(4 if table.charge < 150 else 0, 0, tick / 240)
                    else:
                        table.input((1, 2, 0, 3)[tick // 25 % 4], 0, tick / 240)
                    table.step()
                self.assertGreater(table.balls, 0)
                self.assertTrue(table.balls <= 99)
                self.assertEqual(len(table.public()), 31)

    def test_sandbox_rooms_survive_saving(self):
        import pickle
        for part in SANDBOX_PARTS:
            table = TABLES["sandbox_" + part][1](balls=99)
            clone = pickle.loads(pickle.dumps(table))
            self.assertIs(type(clone), type(table))

    def test_real_tables_are_untouched(self):
        for key in ("golden", "neon"):
            lay = TABLES[key][1].layout
            self.assertTrue(lay.bumps and lay.ramp and lay.spinner and lay.targets and lay.magnet and lay.subway)

    def test_magnet_is_live_on_its_own_table(self):
        table = TABLES["sandbox_magnet"][1](balls=99)
        self.assertEqual(table.public()[-1]["magnet"], 1)
        self.assertEqual(GoldenHour().public()[-1]["magnet"], 0)
        table.staged = False
        table.x, table.y, table.vx, table.vy = table.layout.magnet[0] + .3, table.layout.magnet[1], 0, 0
        for _ in range(5):
            table.step()
        self.assertGreater(table.magnet_ticks, 0)


class CustomTables(unittest.TestCase):
    """Tables from the editor are checked, clamped, playable, savable and kept with the room."""

    SPEC = {"v": 1, "name": "  My   table ", "items": [
        ["bump", 3, 5.5, .65, "#ff9b59"], ["sling", 1.35, 10.75, 2.85, 12.5, "#ff6854"], ["target", 1.2, 6.6, 1.2, 7.3, "#0000ff"],
        ["lane", 2.2, 3.5, "#59edd2"], ["post", 3.2, 2.8, .11, "#fff0ca"], ["wall", 3, 9, 4, 10, "#aaaaaa"],
        ["spinner", 7.9, 7.4, "#c1d2e5"], ["saucer", 1.6, 4.7, .3, "#ffd383"], ["magnet", 5, 9.6, 1.1, "#59edd2"], ["kick", "#ffffff"]]}

    def test_build_makes_a_layout_with_paint(self):
        from games.pinball_custom import build
        layout, clean = build(self.SPEC)
        self.assertEqual(layout.bumps, ((3.0, 5.5, .65),))
        self.assertEqual(layout.paint["bumps"], ["#ff9b59"])
        self.assertEqual(layout.paint["name"], "My table")
        self.assertEqual(len(layout.rails), 11 + 1)
        self.assertTrue(layout.outlane and layout.special and layout.spinner and layout.saucer and layout.magnet)
        self.assertEqual(build(clean)[1], clean)          # cleaning is stable

    def test_build_clamps_and_rejects(self):
        from games.pinball_custom import build
        from games.base import GameError
        layout, _ = build({"items": [["bump", -5, 99, 9, "#FFFFFF"], ["wall", 1, 1, 1, 1, "#ffffff"], ["wall", 1, 1, 9, 1, "#ffffff"]]})
        x, y, r = layout.bumps[0]
        self.assertTrue(.45 <= x <= 8.35 and .45 <= y <= 14.2 and r <= 1.0)
        for wall in layout.rails[11:]:
            self.assertTrue(.25 - 1e-6 <= math.hypot(wall[2] - wall[0], wall[3] - wall[1]) <= 4.5 + 1e-6)
        for bad in ({}, {"items": "x"}, {"items": [["nope"]]}, {"items": [["bump", 1, 1, .5, "red"]]}, {"items": [["bump", 1, "1", .5, "#ffffff"]]},
                    {"items": [["bump", 1, 1, .5, "#ffffff"]] * 13}, {"items": [["spinner", 1, 1, "#ffffff"]] * 2},
                    {"items": [["lane", 1, 1, "#ffffff"]] * 81}, {"items": [["bump", 1, 1, "#ffffff"]]}):
            with self.assertRaises(GameError, msg=str(bad)[:60]):
                build(bad)

    def test_random_tables_run_and_pickle(self):
        import pickle, random
        from games.pinball import CustomTable
        from games.pinball_custom import build, LIMITS
        for seed in range(12):
            rng = random.Random(seed)
            items = []
            for kind, limit in LIMITS.items():
                for _ in range(rng.randint(0, min(limit, 5))):
                    x, y, c = rng.uniform(.5, 8.3), rng.uniform(.5, 14.1), "#%06x" % rng.randrange(1 << 24)
                    if kind in ("bump", "post", "saucer", "magnet"):
                        items.append([kind, x, y, rng.uniform(.05, 2), c])
                    elif kind == "orbit":
                        items.append([kind, *[rng.uniform(.5, 8.3) for _ in range(rng.randint(2, 6) * 2)], c])
                    elif kind in ("sling", "target", "wall", "ramp", "subway"):
                        items.append([kind, x, y, rng.uniform(.5, 8), rng.uniform(.5, 14), c])
                    elif kind == "kick":
                        items.append([kind, c])
                    else:
                        items.append([kind, x, y, c])
            layout, _ = build({"items": items})
            table = CustomTable(balls=99, layout_override=layout)
            for tick in range(240 * 15):
                if table.staged:
                    table.input(4 if table.charge < 150 else 0, 0, tick / 240)
                else:
                    table.input((1, 2, 0, 3)[tick // 25 % 4], 0, tick / 240)
                table.step()
            self.assertGreater(table.balls, 0, seed)
            self.assertEqual(len(table.public()), 31)
            clone = pickle.loads(pickle.dumps(table))
            self.assertEqual(clone.layout.bumps, layout.bumps)

    def table_with(self, *items):
        from games.pinball import CustomTable
        from games.pinball_custom import build
        layout, _ = build({"items": list(items)})
        table = CustomTable(balls=99, layout_override=layout, post_used=True)
        table.staged = False
        return table

    def test_custom_ramp_scores_and_exits_where_placed(self):
        table = self.table_with(["ramp", 5.0, 6.0, 7.0, 9.0, "#59edd2"])
        table.x, table.y, table.vx, table.vy = 5.0, 7.0, 0, -9.5      # a hard shot up the middle of the mouth
        before = table.score
        for _ in range(240 * 3):
            table.step()
            if table.ramp_ticks:
                break
        self.assertTrue(table.ramp_ticks, "the shot entered the ramp")
        for _ in range(240 * 2):
            table.step()
            if not table.ramp_ticks:
                break
        self.assertGreater(table.score, before)
        self.assertEqual(table.event.startswith("ramp") or table.event in ("ramp", "lock"), True, table.event)

    def test_custom_subway_and_orbit_trigger(self):
        table = self.table_with(["subway", 6.0, 6.0, 2.0, 9.0, "#c699ff"])
        table.x, table.y, table.vx, table.vy = 6.0, 6.0, 0, 0
        table.step()
        self.assertTrue(table.subway_ticks)
        for _ in range(240):
            table.step()
        self.assertFalse(table.subway_ticks)
        self.assertGreater(table.vy, 0, "the exit fires the ball down the table")
        table = self.table_with(["orbit", 1.0, 6.0, 1.0, 3.0, 3.0, 1.0, "#9ce9ff"])
        table.x, table.y, table.vx, table.vy = 1.0, 6.0, 0, -6
        table.step()
        self.assertTrue(table.orbit_ticks)
        for _ in range(240 * 4):
            table.step()
            if not table.orbit_ticks:
                break
        self.assertFalse(table.orbit_ticks)
        self.assertGreater(table.score, 0)

    def test_room_keeps_the_table_and_plays_it(self):
        from games.base import GameError
        room = Room("PINCUST")
        host = room.add_player("Builder")
        room.switch_game("pinball")
        room.act(host, {"type": "settings", "settings": {"table": "custom"}})
        with self.assertRaises(GameError):                  # no table built yet
            room.act(host, {"type": "start"})
        room.act(host, {"type": "pinball_table", "table": self.SPEC})
        with self.assertRaises(GameError):
            room.act(host, {"type": "pinball_table", "table": {"items": [["bump"]]}})
        self.assertEqual(room.custom_table["name"], "My table")
        room.act(host, {"type": "start"})
        view = room.game.view(host)["pinball"]
        self.assertEqual(view["table"], "custom")
        self.assertEqual(len(view["layout"]["bumps"]), 1)
        self.assertEqual(view["layout"]["paint"]["bumps"], ["#ff9b59"])
        table = room.game.tables[host.id]
        self.assertEqual(table.balls, 99)
        self.assertIs(table.layout, room.game.custom_layout)
        import pickle
        pickle.dumps(room.game.tables)


if __name__ == "__main__":
    unittest.main()
