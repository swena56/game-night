"""Deterministic checks of the table, controllers and room lifecycle."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from games.pinball import (
    BALL, BUMPS, FLIPPERS, JACKPOT_TICKS, LAUNCH, LAYOUT, RAMP, RAMP_EXIT, ROLLOVERS,
    SLINGS, SPINNER, TARGETS, Table,
)
from server import Room


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
            self.assertGreaterEqual(a.score, 5000)
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

    def test_lanes_spinner_bank_and_ramp(self):
        table = placed(*ROLLOVERS[0])
        for _ in range(4):
            table.step()
        self.assertEqual(table.score, 500)
        x, y = SPINNER
        table = placed(x, y - .01, vy=13)
        for _ in range(85):
            table.step()
        self.assertEqual((table.event, table.score), ("spinner", 250))
        self.assertEqual(int(table.spin), 2)  # two rotations plus a slingshot on the way down

        table = placed(*LAUNCH)
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
        self.assertEqual((table.event, table.score, table.bank), ("ramp", 6750, 0))
        self.assertEqual(table.jackpot_ticks, JACKPOT_TICKS)
        self.assertAlmostEqual(table.x, RAMP_EXIT[0])
        self.assertAlmostEqual(table.y, RAMP_EXIT[1])

    def test_jackpot_locks_in_at_ramp_entry(self):
        x, y = RAMP
        table = placed(x, y + .01, vy=-15)
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
            self.assertEqual(table.event_id, int(i == 719))
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
        self.assertEqual(len(table.public()), 22)

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
                table.y = 17.4
            self.assertTrue(game.frame(1))
            self.assertEqual((room.phase, room.winner), ("over", None))
            self.assertEqual(game.final_scores(), dict.fromkeys((p.id for p in players), 0))


if __name__ == "__main__":
    unittest.main()
