"""Deterministic checks of the table, controllers and room lifecycle."""
import math
import random
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from games.pinball import (
    BALL, BUMPS, FLIP_RADIUS, FLIPPERS, JACKPOT_TICKS, LAUNCH, LAYOUT, RAMP, RAMP_EXIT, ROLLOVERS,
    CustomTable, SLINGS, SPINNER, TABLES, TARGETS, Table as GoldenHour,
)
from dataclasses import dataclass, replace
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
    def test_a_held_ball_is_counted_down_for_the_screen(self):
        table = placed(5, 8)
        self.assertEqual(table.public()[-1]["held"], 0)
        x, y, radius = table.layout.saucer
        table.x, table.y, table.saucer_ticks = x, y, table.rules.saucer_ticks // 2
        self.assertEqual(table.public()[-1]["held"], [x, y, radius, 0.5])

    def test_a_quick_run_of_bumper_hits_pays_a_frenzy(self):
        table = placed(5, 8)
        bx, by, radius = table.layout.bumps[0]
        seen = []
        for hit in range(10):
            table.x, table.y, table.vx, table.vy = bx, by - radius - table.layout.ball + 0.02, 0, 5
            before = table.score
            table.mechanisms(table.y)
            seen.append((table.event, table.score - before))
        self.assertEqual([i for i, (event, _) in enumerate(seen) if event == "frenzy"], [4, 9])
        self.assertGreater(seen[9][1], seen[4][1])      # the longer the run, the bigger the frenzy
        table.streak_ticks = 0                           # a pause ends the run
        table.x, table.y, table.vx, table.vy = bx, by - radius - table.layout.ball + 0.02, 0, 5
        table.mechanisms(table.y)
        self.assertEqual(table.bumper_streak, 1)

    def test_every_ball_has_its_own_portal_cooldown(self):
        table = placed(5, 8)
        table.portal_cool = 90
        table.others.append(table.free_ball(2, 6, 0, 0))
        table.swap(0)
        self.assertEqual(table.portal_cool, 0)
        table.swap(0)
        self.assertEqual(table.portal_cool, 90)
        self.assertEqual(table.public()[-1]["targets"], len(table.layout.targets))      # the screen needs the bank's size
        self.assertEqual(table.public()[-1]["ramp"], 1)                                      # ...and whether there is a ramp to light
        self.assertEqual(CustomTable(layout_override=replace(table.layout, ramp=None)).public()[-1]["ramp"], 0)

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


def flush_guides(layout):
    """The hand-written production boards end their inlane guides at the flipper pivots; built tables end them on top of the bats."""
    import dataclasses
    from games.pinball_custom import flush_end
    ends = {flipper[:2]: flush_end(flipper, layout.flipper_radius) for flipper in layout.flippers[:2]}
    return dataclasses.replace(layout, rails=tuple((*r[:2], *ends.get(tuple(r[2:]), r[2:])) for r in layout.rails))


class CuratedTables(unittest.TestCase):
    """The curated list: player-made tables that were reviewed and added to games/pinball_tables."""

    def test_real_tables_are_untouched(self):
        for key in ("golden", "neon"):
            lay = TABLES[key][1].layout
            self.assertTrue(lay.bumps and lay.ramp and lay.spinner and lay.targets and lay.magnet and lay.subway)

    def test_no_test_sandbox_tables_are_left(self):
        from games.pinball import Pinball
        ids = [k for k, _ in Pinball.settings_schema["table"][1]]
        self.assertFalse([i for i in ids + list(TABLES) if "sandbox" in i])

    def test_every_curated_table_is_listed_and_builds(self):
        from games.pinball import CURATED, Pinball
        from games.pinball_custom import build
        self.assertGreaterEqual(len(CURATED), 7)
        listed = [k for k, _ in Pinball.settings_schema["table"][1]]
        for table_id, entry in CURATED.items():
            with self.subTest(table=table_id):
                self.assertTrue(table_id.startswith("t_"))
                self.assertIn(table_id, listed)
                self.assertIn(table_id, TABLES)
                layout, _ = build(entry["spec"])
                self.assertTrue(entry["name"] and entry["blurb"])
                self.assertLessEqual(len(layout.rails), 400)

    def test_a_curated_table_plays_in_a_room_and_survives_saving(self):
        import pickle
        from games.pinball import CURATED
        for table_id in CURATED:
            with self.subTest(table=table_id):
                players = [type("P", (), {"id": "p1", "name": "A", "bot": False})()]
                room = type("R", (), {"turn": None, "deadline": None, "custom_table": None, "settings": {}})()
                game = Pinball_for(room, table_id)
                game.start(players, random.Random(1))
                table = game.tables["p1"]
                self.assertEqual(table.balls, 3)                  # a listed table is a real game, not the endless test table
                self.assertEqual(game.layout_public()["theme"], "custom")
                for tick in range(240 * 10):
                    table.input(4 if table.staged and table.charge < 150 else (1, 2, 0, 3)[tick // 25 % 4], 0, tick / 240)
                    table.step()
                self.assertIs(type(pickle.loads(pickle.dumps(table))), type(table))

    def test_the_loader_skips_broken_files(self):
        import json, tempfile, os
        from games import pinball_tables
        with tempfile.TemporaryDirectory() as folder:
            good = {"name": "Fine Table", "blurb": "ok", "spec": {"items": [["bump", 4, 5, .6, "#ffffff"]]}}
            for name, entry in {"fine-table": good, "bad-spec": {"name": "Bad Spec", "spec": {"items": [["nope"]]}},
                                "no-name": {"spec": good["spec"]}, "Bad Slug!": good}.items():
                with open(os.path.join(folder, name + ".json"), "w") as f:
                    json.dump(entry, f)
            with open(os.path.join(folder, "broken.json"), "w") as f:
                f.write("{not json")
            self.assertEqual(list(pinball_tables.load(folder)), ["t_fine-table"])

    def test_the_table_check_accepts_good_tables_and_rejects_bad_ones(self):
        from games.pinball import CURATED
        from games.pinball_tables.check import check
        self.assertTrue(check(CURATED["t_pop-pit"]["spec"])["ok"])
        empty = check({"items": []})
        self.assertFalse(empty["ok"])
        self.assertTrue(any("parts" in p for p in empty["problems"]))
        self.assertFalse(check({"items": [["nope"]]})["ok"])
        self.assertFalse(check("PT1.not-a-code")["ok"])
        # parts that do not score: a table of posts and walls
        dull = check({"items": [["post", 1 + i, 3, .2, "#ffffff"] for i in range(7)]})
        self.assertFalse(dull["ok"])
        self.assertTrue(any("scores" in p for p in dull["problems"]))

    def test_magnet_is_live_on_a_table_with_one(self):
        from games.pinball_custom import build, build_rules
        layout, _ = build({"items": [["magnet", 4, 8, 1.2, "#59edd2"]]})
        table = CustomTable(layout_override=layout, rules_override=build_rules({}), balls=99)
        self.assertEqual(table.public()[-1]["magnet"], 1)
        self.assertEqual(GoldenHour().public()[-1]["magnet"], 0)
        table.staged = False
        table.x, table.y, table.vx, table.vy = table.layout.magnet[0] + .3, table.layout.magnet[1], 0, 0
        for _ in range(5):
            table.step()
        self.assertGreater(table.magnet_ticks, 0)


def Pinball_for(room, table_id):
    from games.pinball import Pinball
    game = Pinball(room)
    game.s = {"table": table_id, "mode": "classic"}
    return game


class ProductionClones(unittest.TestCase):
    """Golden Hour and Neon Arcade can be rebuilt part for part in the editor, and the copy is the production board."""

    def test_clones_match_the_production_layouts_and_rules(self):
        import dataclasses
        from games.pinball import GOLDEN_HOUR, NEON_ARCADE, NeonTable
        from games.pinball import Table as Golden
        from games.pinball_clone import legacy_specs as clone_specs
        from games.pinball_custom import build, build_rules
        from games.pinball_engine import Rules
        for key, real, rules in (("golden", GOLDEN_HOUR, Golden.rules), ("neon", NEON_ARCADE, NeonTable.rules)):
            spec = clone_specs()[key]
            layout, clean = build(spec)
            real = flush_guides(real)
            for f in dataclasses.fields(real):
                if f.name not in ("paint", "part_pts"):
                    self.assertEqual(getattr(layout, f.name), getattr(real, f.name), f"{key}.{f.name}")
            clone_rules = build_rules(spec)
            for f in Rules.__dataclass_fields__:
                self.assertEqual(getattr(clone_rules, f), getattr(rules, f), f"{key} rules.{f}")
            for k in ("cabinet", "look", "feel"):
                self.assertIn(k, clean)                                       # the table-wide choices survive a round trip
            self.assertEqual(build(clean)[0].rails, layout.rails)

    def test_clones_play_like_the_originals(self):
        import random
        from games.pinball import NeonTable
        from games.pinball import Table as Golden
        from games.pinball_clone import legacy_specs as clone_specs
        from games.pinball_custom import build, build_rules
        for key, original in (("golden", Golden), ("neon", NeonTable)):
            spec = clone_specs()[key]
            layout, _ = build(spec)
            a = original(balls=3, layout_override=flush_guides(original.layout))
            b = original(balls=3, layout_override=layout, rules_override=build_rules(spec))
            for t in (a, b):
                t.rng = random.Random(5)
            for tick in range(240 * 20):                                       # the same inputs give the same ball, tick for tick
                held = 4 if (a.staged and a.charge < 190) else 0 if a.staged else (1, 2, 0, 3)[tick // 25 % 4]
                for t in (a, b):
                    t.input(held, 0, tick / 240)
                    t.step()
            self.assertEqual((a.score, a.balls, round(a.x, 3), round(a.y, 3)), (b.score, b.balls, round(b.x, 3), round(b.y, 3)), key)

    def test_a_moved_wire_gets_the_editor_ride_again(self):
        from games.pinball_clone import legacy_specs as clone_specs
        from games.pinball_custom import build
        spec = clone_specs()["golden"]
        for item in spec["items"]:
            if item[0] == "orbit":
                item[2] += .5                                                  # nudge the mouth: now it is your own wire
        layout, _ = build(spec)
        self.assertGreater(len(layout.orbit_path), 10)


class TableSuggestionsAndTool(unittest.TestCase):
    """A player's suggestion reaches the inbox only if it builds, and the maintainer tool turns it into a curated file."""

    GOOD = {"v": 1, "name": "Tool Test", "items": [["bump", 3, 5, .6, "#ff9b59"], ["bump", 5.5, 5, .6, "#c699ff"], ["bump", 4.4, 7.5, .6, "#58e5d5"],
                                                    ["lane", 3.4, 2.4, "#59edd2"], ["lane", 4.4, 2.4, "#59edd2"], ["lane", 5.4, 2.4, "#59edd2"],
                                                    ["sling", 1.35, 10.75, 2.85, 12.5, "#ff6854"], ["sling", 7.73, 10.75, 6.48, 12.6, "#ff6854"]]}

    @staticmethod
    def code(spec):
        import base64, json, zlib
        packer = zlib.compressobj(wbits=-15)
        return "PT1." + base64.urlsafe_b64encode(packer.compress(json.dumps(spec).encode()) + packer.flush()).decode().rstrip("=")

    def test_check_reports_where_balls_drain(self):
        from games.pinball_tables import check
        stats = check.check(self.GOOD, games=2)["stats"]
        self.assertEqual(set(stats["drains"]), {"left_outlane", "left", "right", "right_outlane"})
        self.assertAlmostEqual(sum(stats["drains"].values()), 100, delta=4)       # rounded shares of every ball that drained
        from games.pinball_engine import Layout
        flippers = ((3.22, 14.95, .42, -.66), (6.78, 14.95, 2.72, 3.8))
        layout = Layout(rails=(), flippers=flippers, launch=(9, 15))
        self.assertEqual([check.drain_lane(x, layout) for x in (.5, 3, 6, 8.2)], ["left_outlane", "left", "right", "right_outlane"])

    def test_suggestions_are_checked_on_arrival_and_the_tool_reads_them(self):
        import contextlib, io, json, os, tempfile
        import server
        from games import pinball_tables
        from games.base import GameError
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
        import pinball_table as tool
        with tempfile.TemporaryDirectory() as folder:
            inbox = os.path.join(folder, "feedback.jsonl")
            with patch.object(server, "FEEDBACK_FILE", inbox), patch.object(pinball_tables, "FOLDER", folder):
                result = server.submit_feedback({"kind": "table", "text": 'Table suggestion: "Tool Test" (8 parts)', "name": "Sam",
                                                 "context": {"pinball_table": self.code(self.GOOD)}})
                self.assertEqual(result["id"], 1)
                for bad in ({"pinball_table": "PT1.nonsense"}, {"pinball_table": 5}, {}, {"pinball_table": "PT1." + "A" * 9000},
                            {"pinball_table": self.code({"items": [["nope"]]})}):
                    with self.assertRaises(GameError, msg=repr(bad)[:40]):
                        server.submit_feedback({"kind": "table", "text": "Table suggestion: nope", "context": bad})
                with open(inbox, encoding="utf-8") as f:
                    saved = [json.loads(line) for line in f]
                self.assertEqual(len(saved), 1)                                     # only the good one was stored
                self.assertEqual((saved[0]["kind"], saved[0]["context"]["parts"], saved[0]["name"]), ("table", 8, "Sam"))
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    self.assertEqual(tool.main(["inbox", "--inbox", inbox]), 0)
                    self.assertEqual(tool.main(["check", "#1", "--inbox", inbox]), 0)
                self.assertIn("#1", out.getvalue())
                self.assertIn("PASS", out.getvalue())
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(tool.main(["add", "#1", "--inbox", inbox, "--name", "Tool Test", "--blurb", "Three bumpers."]), 0)
                    with self.assertRaises(SystemExit):                                   # the name is taken
                        tool.main(["add", "#1", "--inbox", inbox, "--name", "Tool Test"])
                listed = pinball_tables.load(folder)
                self.assertEqual(list(listed), ["t_tool-test"])
                self.assertEqual((listed["t_tool-test"]["author"], listed["t_tool-test"]["blurb"]), ("Sam", "Three bumpers."))
                with contextlib.redirect_stdout(io.StringIO()):
                    tool.main(["remove", "tool-test"])
                self.assertEqual(pinball_tables.load(folder), {})

    def test_the_tool_refuses_a_failing_table_unless_forced(self):
        import contextlib, io, os, tempfile
        from games import pinball_tables
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
        import pinball_table as tool
        dull = self.code({"items": [["post", 1 + i, 3, .2, "#ffffff"] for i in range(7)]})
        with tempfile.TemporaryDirectory() as folder, patch.object(pinball_tables, "FOLDER", folder), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                tool.main(["add", dull, "--name", "Dull One"])
            self.assertEqual(os.listdir(folder), [])
            self.assertEqual(tool.main(["add", dull, "--name", "Dull One", "--force"]), 0)
            self.assertEqual(os.listdir(folder), ["dull-one.json"])


class CustomTables(unittest.TestCase):
    """Tables from the editor are checked, clamped, playable, savable and kept with the room."""

    SPEC = {"v": 1, "name": "  My   table ", "items": [
        ["bump", 3, 5.5, .65, "#ff9b59"], ["sling", 1.35, 10.75, 2.85, 12.5, "#ff6854"], ["target", 1.2, 6.6, 1.2, 7.3, "#0000ff"],
        ["lane", 2.2, 3.5, "#59edd2"], ["post", 3.2, 2.8, .11, "#fff0ca"], ["wall", 3, 9, 4, 10, "#aaaaaa"],
        ["spinner", 7.9, 7.4, "#c1d2e5"], ["saucer", 1.6, 4.7, .3, "#ffd383"], ["magnet", 5, 9.6, 1.1, "#59edd2"], ["kick", "#ffffff"]]}

    def test_build_makes_a_layout_with_paint(self):
        from games import pinball as cabinet
        from games.pinball_custom import build
        layout, clean = build(self.SPEC)
        self.assertEqual(layout.bumps, ((3.0, 5.5, .65),))
        self.assertEqual(layout.paint["bumps"], ["#ff9b59"])
        self.assertEqual(layout.paint["name"], "My table")
        self.assertEqual(len(layout.rails), len(cabinet.BASE_RAILS) + 1)
        self.assertTrue(layout.outlane and layout.special and layout.spinner and layout.saucer and layout.magnet)
        self.assertEqual(build(clean)[1], clean)          # cleaning is stable

    def test_build_clamps_and_rejects(self):
        from games.pinball_custom import build
        from games import pinball as cabinet
        from games.base import GameError
        layout, _ = build({"items": [["bump", -5, 99, 9, "#FFFFFF"], ["wall", 1, 1, 1, 1, "#ffffff"], ["wall", 1, 1, 9, 1, "#ffffff"]]})
        x, y, r = layout.bumps[0]
        self.assertTrue(.45 <= x <= 8.35 and .45 <= y <= 14.2 and r <= 1.0)
        for wall in layout.rails[len(cabinet.BASE_RAILS):]:
            self.assertTrue(.25 - 1e-6 <= math.hypot(wall[2] - wall[0], wall[3] - wall[1]) <= 4.5 + 1e-6)
        for bad in ({}, {"items": "x"}, {"items": [["nope"]]}, {"items": [["bump", 1, 1, .5, "red"]]}, {"items": [["bump", 1, "1", .5, "#ffffff"]]},
                    {"items": [["bump", 1, 1, .5, "#ffffff"]] * 13}, {"items": [["spinner", 1, 1, "#ffffff"]] * 2},
                    {"items": [["lane", 1, 1, "#ffffff"]] * 81}, {"items": [["bump", 1, 1, "#ffffff"]]}):
            with self.assertRaises(GameError, msg=str(bad)[:60]):
                build(bad)

    def test_new_parts_build(self):
        from games.pinball_custom import build
        from games import pinball as cabinet
        layout, clean = build({"items": [["arc", 1, 5, 4, 5, 2.5, 3, "#ff0000"], ["flap", 3, 8, 4, 8, "#ffffff"],
                                         ["portal", 1, 9, 5, 9, "#00ff00"], ["star", 3, 3, .5, "#ffffff"], ["moon", 6, 3, 9, "#ffffff"]]})
        self.assertGreater(len(layout.rails), len(cabinet.BASE_RAILS) + 5)
        self.assertEqual(len(layout.paint["walls"]), len(layout.rails) - len(cabinet.BASE_RAILS))
        self.assertEqual(layout.flaps, ((3.0, 8.0, 4.0, 8.0),))
        self.assertEqual(layout.portals, (1.0, 9.0, 5.0, 9.0, .32))
        self.assertEqual([d[0] for d in layout.paint["decals"]], ["star", "moon"])
        self.assertLessEqual(layout.paint["decals"][1][3], 1.6)
        self.assertTrue(layout.public()["portals"])
        # a degenerate curve is stretched, never a zero-length rail
        layout, _ = build({"items": [["arc", 3, 3, 3, 3, 3, 3, "#ff0000"]]})
        self.assertTrue(all(r[:2] != r[2:] for r in layout.rails))
        with self.assertRaises(Exception):
            build({"items": [["arc", 1, 2, 3, 4, "#ff0000"]]})

    def test_extra_flippers_movers_holes_and_points(self):
        from games.pinball import CustomTable
        from games.pinball_custom import build, build_rules
        W = "#ffffff"
        spec = {"pts": {"bumper": 500, "bogus": 9, "target": 250}, "items": [["flip", 2, 8, W], ["flip", 7, 8, W], ["mover", 2, 5, 5, 5, "#ff0000"],
                                                                         ["hole", 3, 6, .3, "#ffff00"], ["rubber", 1, 6, 2, 7, "#00ff00"]]}
        layout, clean = build(spec)
        self.assertEqual(len(layout.flippers), 4)
        self.assertLess(layout.flippers[2][2], 1.5)          # left of the middle: left-button flipper
        self.assertGreater(layout.flippers[3][2], 1.5)       # right of the middle: right-button flipper
        self.assertEqual(clean["pts"], {"bumper": 500})      # defaults and unknown keys are dropped
        self.assertEqual(build_rules(spec).bumper, 500)
        t = CustomTable(layout_override=layout, rules_override=build_rules(spec), balls=9)
        t.staged = False
        t.input(1, 0, 0)                                     # hold the left button: the extra left flipper rises too
        for _ in range(120):
            t.step()
        self.assertLess(t.angles[2], .3)
        self.assertEqual(len(t.public()[-1]["flips2"]), 2)
        self.assertEqual(len(t.public()[-1]["movers"]), 1)
        # a ball dropped into the hole is held, then fired out
        t.x, t.y, t.vx, t.vy = 3.0, 6.0, 0, 0
        t.step()
        self.assertGreater(t.hole_ticks, 0)
        for _ in range(200):
            t.step()
        self.assertEqual(t.hole_ticks, 0)

    def test_modes_and_table_codes(self):
        import base64, json, zlib
        from games.pinball_custom import build, decode_table
        from games.base import GameError
        W = "#ffffff"
        spec = {"items": [["bump", 3, 5, .6, W], ["bump", 5, 8, .6, W], ["star", 4, 4, .5, W]], "modes": [[1, 2], [2, 99], ["x", 1]], "pv": [[1, 700]]}
        classic, clean = build(spec, "classic")
        zen, _ = build(spec, "zen")
        self.assertEqual(len(classic.bumps), 1)             # the second bumper is Zen-only
        self.assertEqual(len(zen.bumps), 2)
        self.assertEqual(zen.part_pts, {"bump": {1: 700}})
        self.assertEqual(clean["modes"], [[1, 2]])
        self.assertEqual(len(clean["items"]), 3)            # the saved table keeps every part
        big = {"items": [["bump", 1 + i % 7, 1 + i % 13, .5, W] for i in range(12)] + [["post", 1 + i % 7, 1 + i % 13, .1, W] for i in range(16)]}
        raw = json.dumps(big).encode()
        packer = zlib.compressobj(wbits=-15)
        code = "PT1." + base64.urlsafe_b64encode(packer.compress(raw) + packer.flush()).decode().rstrip("=")
        self.assertEqual(decode_table(code)["items"][0], big["items"][0])
        self.assertEqual(decode_table(big), big)
        for bad in ("PT1.@@@", "PT2.abc", "nope", "PT0." + base64.urlsafe_b64encode(b"[").decode()):
            with self.assertRaises(GameError):
                decode_table(bad)
        bomb = zlib.compressobj(wbits=-15)
        boom = "PT1." + base64.urlsafe_b64encode(bomb.compress(b" " * 5_000_000) + bomb.flush()).decode().rstrip("=")
        with self.assertRaises(GameError):                  # a decompression bomb is refused
            decode_table(boom)

    def test_ramp_does_not_swallow_the_ball_unless_lock_is_on(self):
        from games.pinball import CustomTable
        from games.pinball_custom import build, build_rules
        spec = {"items": [["ramp", 4, 8, 6, 10, "#59edd2"]]}
        self.assertEqual(build_rules(spec).lock_balls, 0)
        self.assertEqual(build_rules({**spec, "lock": True}).lock_balls, 2)
        self.assertTrue(build({**spec, "lock": True})[1]["lock"])
        layout, _ = build(spec)
        t = CustomTable(layout_override=layout, rules_override=build_rules(spec), balls=9)
        t.staged = False
        t.x, t.y, t.vx, t.vy = 4.0, 8.4, 0, -12            # a firm shot up the ramp mouth
        for _ in range(240 * 2):
            t.step()
            self.assertFalse(t.staged, "the ball was taken back to the plunger")
            self.assertEqual(t.locked, 0)
        self.assertEqual(t.ramps, 1)                        # the ride finished and scored

    def test_hostile_tables_get_clean_errors(self):
        from games.pinball_custom import build, decode_table
        from games.base import GameError
        for bad in ({"items": [[[1], 2, "#ffffff"]]}, {"items": [[{"a": 1}, "#ffffff"]]}, {"items": [["bump", [1], [2], [3], "#ffffff"]]},
                    {"items": [["bump", float("nan"), 1, .5, "#ffffff"]]}, {"items": "x"}, {"items": [None]}, [], 5):
            with self.assertRaises(GameError, msg=repr(bad)):
                build(bad)
        for odd in ({"items": [], "pv": "z"}, {"items": [], "modes": [[1]]}, {"items": [], "pts": [1]}, {"items": [], "name": [1]}):
            build(odd)                                      # junk in the optional fields is ignored, never an error
        with self.assertRaises(GameError):
            decode_table("PT1." + "A" * 20000)

    def test_orbit_wire_is_smooth_even_and_exits_downward(self):
        from games.pinball_custom import build, smooth_path, exit_velocity
        W = "#ffffff"
        layout, _ = build({"items": [["orbit", .6, 8.5, .5, 4.0, 1.2, 1.8, 3.0, 1.2, 6.9, 1.4, W]]})
        path = layout.orbit_path
        self.assertGreater(len(path), 20)                                    # a spline, not the five dots
        self.assertEqual(path[0], (.6, 8.5))
        self.assertEqual(path[-1], (6.9, 1.4))
        gaps = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(path, path[1:])]
        self.assertLess(max(gaps), .31)                                      # even steps: the ball rides at a steady pace
        for a, b, c in zip(path, path[1:], path[2:]):                        # no corners: the direction turns gently
            d1, d2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
            n1, n2 = math.hypot(*d1), math.hypot(*d2)
            if n1 > .05 and n2 > .05:
                self.assertGreater((d1[0] * d2[0] + d1[1] * d2[1]) / (n1 * n2), .8)
        # whatever way the wire ends, the ball leaves heading down the table
        for pts in ([(1, 5), (1, 2)], [(1, 2), (6, 1)], [(2, 8), (2, 3), (7, 3)], [(7, 6), (4, 1), (1, 6)]):
            vx, vy = exit_velocity(smooth_path(pts), 6.1)
            self.assertGreater(vy, 1)
            self.assertAlmostEqual(math.hypot(vx, vy), 6.1, places=1)
        # a two-dot wire stays a straight line
        self.assertEqual(smooth_path([(1, 5), (3, 2)]), [(1, 5), (3, 2)])
        # and the ball really completes the ride
        t = CustomTable(layout_override=layout, rules_override=__import__("games.pinball_custom", fromlist=["x"]).build_rules({}), balls=9)
        t.staged = False
        t.x, t.y, t.vx, t.vy = .6, 8.6, 0, -8
        rode = False
        for _ in range(240 * 8):
            t.step()
            rode = rode or t.event == "orbit"
        self.assertTrue(rode)                                                 # the ball completed the ride and scored it

    def test_outlane_lamps_report_used_state(self):
        t = GoldenHour()
        stats = t.public()[-1]
        self.assertEqual((stats["special_used"], t.public()[22]), (0, 1))     # nothing used yet, kickback armed
        t.special_used = True
        t.kickback = False
        self.assertEqual((t.public()[-1]["special_used"], t.public()[22]), (1, 0))

    def test_a_ball_trapped_in_a_closed_pocket_is_rescued(self):
        from games.pinball_custom import build, build_rules
        W = "#ffffff"
        # four rubber bands box in a patch of playfield: the ball can bounce around in there for ever
        box = [["rubber", 3.0, 4.0, 5.8, 4.0, W], ["rubber", 5.8, 4.0, 5.8, 6.4, W], ["rubber", 5.8, 6.4, 3.0, 6.4, W], ["rubber", 3.0, 6.4, 3.0, 4.0, W]]
        layout, _ = build({"items": box})
        table = CustomTable(layout_override=layout, rules_override=build_rules({}), balls=3)
        table.staged = False
        table.x, table.y, table.vx, table.vy = 4.4, 5.2, 3, 2
        events = []
        for tick in range(240 * 40):
            table.step()
            if table.event == "recovery" and not events:
                events.append((tick / 240, table.balls, table.y))
        self.assertTrue(events, "the trapped ball was never rescued")
        seconds, balls, y = events[0]
        self.assertLess(seconds, 35)                                          # the first rescue comes after about 30 s
        self.assertEqual(balls, 3)                                            # it costs no ball
        self.assertGreater(y, 9)                                              # and puts the ball back near the flippers

    def test_a_second_rescue_serves_a_fresh_ball(self):
        from games.pinball_custom import build, build_rules
        W = "#ffffff"
        box = [["rubber", 3.0, 4.0, 5.8, 4.0, W], ["rubber", 5.8, 4.0, 5.8, 6.4, W], ["rubber", 5.8, 6.4, 3.0, 6.4, W], ["rubber", 3.0, 6.4, 3.0, 4.0, W]]
        layout, _ = build({"items": box})
        table = CustomTable(layout_override=layout, rules_override=build_rules({}), balls=3)
        table.staged = False
        table.rescues = 1
        table.x, table.y, table.vx, table.vy = 4.4, 5.2, 3, 2
        for _ in range(240 * 32):
            table.step()
        self.assertTrue(table.staged)                                         # back at the plunger, ready to launch again
        self.assertEqual((table.balls, table.rescues), (3, 0))

    def test_the_watchdog_leaves_normal_play_alone(self):
        t = Table(balls=3)
        t.staged = False
        t.x, t.y, t.vx, t.vy = 4.4, 9, 0, 0
        for _ in range(240 * 3):
            t.step()
        self.assertEqual(t.rescues, 0)

    def test_per_part_points(self):
        from games.pinball import CustomTable
        from games.pinball_custom import build
        W = "#ffffff"
        layout, clean = build({"items": [["bump", 3, 5, .6, W], ["bump", 5, 8, .6, W]], "pv": [[1, 900], [0, 99999], ["x", 5], [7, 5]]})
        self.assertEqual(layout.part_pts, {"bump": {0: 20000, 1: 900}})
        self.assertEqual(clean["pv"], [[0, 20000], [1, 900]])      # clamped; junk and out-of-range entries are dropped
        t = CustomTable(layout_override=layout, balls=9)
        t.staged = False
        t.x, t.y, t.vx, t.vy = 5, 8 + .6 + .19 + .05, 0, -6     # roll into the second bumper
        before = t.score
        for _ in range(30):
            t.step()
            if t.score > before:
                break
        self.assertEqual(t.score - before, 900)

    def test_portal_teleports_and_flap_is_one_way(self):
        from games.pinball import CustomTable
        from games.pinball_custom import build
        layout, _ = build({"items": [["portal", 2, 5, 6, 5, "#00ff00"]]})
        t = CustomTable(layout_override=layout)
        t.staged = False
        t.x, t.y, t.vx, t.vy = 2.05, 5.0, 0, 0
        t.step()
        self.assertGreater(t.x, 5)
        before = t.x
        for _ in range(10):                 # the cooldown stops it bouncing straight back
            t.step()
        self.assertGreater(t.x, 5)
        layout, _ = build({"items": [["flap", 3, 8, 5, 8, "#ffffff"]]})
        wrong, right = [], []
        for y0, vy, out in ((7.5, 6, wrong), (8.5, -6, right)):
            t = CustomTable(layout_override=layout)
            t.staged = False
            t.x, t.y, t.vx, t.vy = 4, y0, 0, vy
            for _ in range(240):
                t.step()
                out.append(t.y)
        # one side is a wall (the ball never crosses it), the other lets it through
        crossed = (max(wrong) > 8.2) != (min(right) < 7.8)
        self.assertTrue(crossed)

    def test_random_tables_run_and_pickle(self):
        import pickle, random
        from games.pinball import CustomTable
        from games.pinball_custom import build, LIMITS, GLYPHS
        for seed in range(12):
            rng = random.Random(seed)
            items = []
            for kind, limit in LIMITS.items():
                for _ in range(rng.randint(0, min(limit, 5))):
                    x, y, c = rng.uniform(.5, 8.3), rng.uniform(.5, 14.1), "#%06x" % rng.randrange(1 << 24)
                    if kind in ("bump", "post", "saucer", "magnet", "hole") or kind in GLYPHS:
                        items.append([kind, x, y, rng.uniform(.05, 2), c])
                    elif kind == "arc":
                        items.append([kind, x, y, rng.uniform(.5, 8), rng.uniform(.5, 14), rng.uniform(.5, 8), rng.uniform(.5, 14), c])
                    elif kind == "orbit":
                        items.append([kind, *[rng.uniform(.5, 8.3) for _ in range(rng.randint(2, 6) * 2)], c])
                    elif kind in ("sling", "target", "wall", "ramp", "subway", "flap", "portal", "rubber", "mover"):
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

    def test_main_flippers_can_be_repositioned_and_the_guides_follow(self):
        from games.pinball_custom import build
        layout, clean = build({"items": [["bump", 4, 5, .6, "#ff0000"]], "fl": [3.9, 15.2, 6.1, 14.6]})
        left, right = layout.flippers[:2]
        self.assertEqual((left[1], right[1]), (15.2, 14.6))
        self.assertGreaterEqual(right[0] - left[0] - 2 * 1.56 * math.cos(left[2]), .5 - .02)       # too close together: pushed apart so the ball can drain
        self.assertEqual(clean["fl"], [left[0], 15.2, right[0], 14.6])
        from games.pinball_custom import flush_end
        self.assertEqual(layout.rails[-1][2:], flush_end(right, layout.flipper_radius))              # the right inlane guide runs onto the moved bat
        for classic in (False, True):
            layout, _ = build({"items": [], "cabinet": "classic" if classic else "smooth", "fl": [2.4, 14.3, 7.6, 14.3]})
            self.assertEqual((layout.flippers[0][:2], layout.flippers[1][:2]), ((layout.flippers[0][0], 14.3), (layout.flippers[1][0], 14.3)))
            self.assertLessEqual(layout.flippers[1][0] - layout.flippers[0][0] - 2 * 1.56 * math.cos(layout.flippers[0][2]), 1.5 + .02)
        self.assertNotIn("fl", build({"items": [], "fl": [3.22, 14.95, 6.78, 14.95]})[1])
        self.assertNotIn("fl", build({"items": [], "fl": ["x", 1, 2, 3]})[1])

    def test_decal_lights_are_cleaned_and_name_the_part_that_triggers_them(self):
        from games.pinball_custom import build
        spec = {"items": [["bump", 4, 5, .6, "#ff0000"], ["star", 2, 3, .6, "#ffd383"], ["moon", 6, 3, .6, "#ffd383"], ["heart", 5, 9, .6, "#ffd383"],
                          ["ring", 5, 11, .6, "#ffd383"]],
                "fx": [[1, {"m": "bogus", "c2": "nope", "r": 99, "on": "hit", "src": 0}], [2, {"m": "cycle", "c2": "#00FF00", "on": "timer", "ev": 5, "du": 50}],
                       [3, {"on": "motion", "nr": 0}], [0, {"m": "flash"}], [9, {}], "x"]}
        layout, clean = build(spec)
        decals = {d[0]: d for d in layout.paint["decals"]}
        self.assertEqual(decals["star"][5], {"m": "flash", "c2": "#ffffff", "r": 10.0, "tr": [{"on": "hit", "tag": "bumper0"}]})
        self.assertEqual(decals["moon"][5], {"m": "cycle", "c2": "#00ff00", "r": 1.0, "tr": [{"on": "timer", "ev": 5.0, "du": 5.0}]})
        self.assertEqual(decals["heart"][5]["tr"], [{"on": "motion", "nr": 0.3}])
        self.assertEqual(len(decals["ring"]), 5)                                                   # no effect: painted into the art as before
        self.assertEqual([i for i, _ in clean["fx"]], [1, 2, 3])                                 # only decals keep an effect
        self.assertEqual(build(clean)[1]["fx"], clean["fx"])

    def test_a_light_can_have_several_triggers_a_delay_and_game_events(self):
        from games.pinball_custom import build
        spec = {"items": [["bump", 4, 5, .6, "#ff0000"], ["dot", 2, 3, .2, "#ffffff"]],
                "fx": [[1, {"m": "flash", "on": "event", "gv": "jackpot", "dl": 99, "ho": 3,
                            "x": [{"on": "hit", "src": "bump"}, {"on": "timer", "ev": 10, "du": 1}, {"on": "motion"}, {"on": "bogus"}, "x"]}]]}
        layout, clean = build(spec)
        fx = layout.paint["decals"][0][5]
        self.assertEqual(fx["tr"], [{"on": "event", "gv": "jackpot"}, {"on": "hit", "tag": "bumper*"}, {"on": "timer", "ev": 10.0, "du": 1.0}])   # three at most
        self.assertEqual((fx["dl"], fx["ho"]), (10.0, 3.0))
        self.assertEqual(clean["fx"][0][1]["x"][0], {"on": "hit", "src": "bump"})                  # the saved table keeps the part kind, not the tag
        self.assertEqual(build(clean)[1]["fx"], clean["fx"])
        bad = build({"items": [["dot", 2, 3, .2, "#ffffff"]], "fx": [[0, {"on": "event", "gv": "nope"}]]})[0].paint["decals"][0][5]
        self.assertEqual(bad["tr"], [{"on": "event", "gv": "multiball"}])

    def test_many_dot_lamps_with_up_to_four_colours(self):
        from games.pinball_custom import build
        items = [["dot", 1 + i * .6, 2, .15, "#ff0000"] for i in range(12)]
        fx = [[0, {"m": "flash", "c2": "#00ff00", "c3": "#0000FF", "c4": "#ffff00"}], [1, {"m": "twinkle", "c2": "#00ff00", "c4": "#ffff00"}], [2, {"m": "cycle", "c2": "#00ff00", "c3": "nope"}]]
        layout, clean = build({"items": items, "fx": fx})
        lamps = layout.paint["decals"]
        self.assertEqual(len(lamps), 12)
        self.assertEqual((lamps[0][3], lamps[0][5]["c3"], lamps[0][5]["c4"]), (.15, "#0000ff", "#ffff00"))
        self.assertNotIn("c4", lamps[1][5])               # a fourth colour needs a third
        self.assertNotIn("c3", lamps[2][5])
        self.assertEqual(lamps[1][5]["m"], "twinkle")
        from games.base import GameError
        with self.assertRaises(GameError):
            build({"items": items + [["dot", 5, 5, .2, "#ffffff"]]})
        self.assertEqual(build(clean)[1]["fx"], clean["fx"])

    def test_a_cleared_target_bank_pays_and_resets_on_a_table_without_a_ramp(self):
        from games.pinball_custom import build, build_rules
        from games.pinball_engine import Table as EngineTable
        spec = {"items": [["target", 1.2, 6.6, 1.2, 7.3, "#ff0000"], ["target", 1.2, 7.5, 1.2, 8.2, "#ff0000"]]}
        layout, _ = build(spec)

        class Plain(EngineTable):
            pass
        Plain.layout, Plain.rules = layout, build_rules(spec)
        table = Plain(staged=False, x=1.49, y=7.65, vx=-10, vy=0, still_origin=(1.49, 7.65))
        table.bank = 1                                   # the first target is already down
        table.step()
        self.assertEqual((table.event, table.bank), ("bank", 3))
        self.assertEqual(table.score, 250 + 2000)
        for _ in range(3 * 240 - 1):
            table.step()
        self.assertEqual(table.bank, 3)
        table.step()
        self.assertEqual(table.bank, 0)
        # Golden Hour has a ramp: its bank is reset by the ramp shot, as before
        self.assertEqual(Table().bank_ticks, 0)

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
