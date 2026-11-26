"""Exercise the Darts courses through the room."""
import json
import math
import tempfile
import random
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
import pickle

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from games.bar_darts import COUNTUP_VISITS, DART_ORIGIN, NUMBERS, RADII, SWIPE_PACE, checkout, hit_at
import games.bar_darts as bar_darts
from games.base import GameError
from server import Room, check_restored, log_axe_debug

bar_darts.SCATTER = 0  # tests aim exactly


def aim(number, multiplier):
    if number == 25:
        return (0, 0 if multiplier == 2 else 0.06)
    angle = math.tau * NUMBERS.index(number) / 20
    radius = {1: 0.4, 2: 0.975, 3: 0.605}[multiplier]
    return radius * math.sin(angle), radius * math.cos(angle)


class DartsTests(unittest.TestCase):
    def start(self, mode, players=2, finish="double", axe_scoring="classic"):
        self.room = room = Room("DART")
        self.players = [room.add_player(name) for name in ("Ada", "Ben", "Cory")[:players]]
        room.switch_game("archery")
        room.settings["assist"] = "on"  # several people here, and some checks read the 💡 hint
        if mode is not None:
            settings = {"course": mode, "finish": finish}
            if axe_scoring is not None:
                settings["axe_scoring"] = axe_scoring
            room.change_settings(self.players[0], settings)
        room.start()
        self.match = room.game.darts
        self.match.rng = random.Random(24)

    def finish_recap(self):
        self.room.game.on_timeout()

    def skip_rival(self):
        """Pull any darts left on the board, then let the second player's turn time out."""
        if self.match.grabbing is not None:
            self.finish_recap()
        if self.room.turn == self.players[1].id:
            self.room.game.on_timeout()

    def throw(self, number, multiplier):
        if self.match.grabbing is not None:
            self.finish_recap()
        self.match.ready_at = 0
        x, y = aim(number, multiplier)
        self.room.act(self.room.players[self.room.turn], {"type": "throw", "dx": x - DART_ORIGIN[0], "dy": y - DART_ORIGIN[1], "vx": -SWIPE_PACE, "vy": 0})

    def test_darts_is_the_default_catalogue_entry(self):
        self.start(None)
        self.assertEqual(self.room.game.info()["name"], "Darts")
        self.assertEqual(self.room.settings["course"], "301")
        self.assertEqual(self.match.points, [301, 301])

    def test_501_uses_the_same_double_out(self):
        self.start("501")
        self.assertEqual(self.match.points, [501, 501])
        self.match.points[0] = 80
        self.match.visit_start = 80
        self.throw(20, 3)
        self.assertEqual(self.match.points[0], 20)
        self.assertEqual(self.match.view(self.players[0])["checkout"], ["D10"])
        self.throw(10, 2)
        self.room.game.on_timeout()
        self.assertEqual(self.room.winner, self.players[0].id)
        self.assertEqual(self.room.history[-1]["players"][0]["score"], 501)

    def test_around_the_clock_ignores_out_of_order_hits_and_counts_once(self):
        self.start("clock")
        self.throw(2, 3)
        self.assertEqual(self.match.points[0], 0)
        self.throw(1, 3)
        self.assertEqual(self.match.view(self.players[0])["nextNumbers"], [2, 1])
        for number in range(2, 21):
            self.skip_rival()
            self.throw(number, 2)
        self.skip_rival()
        self.assertEqual(self.match.view(self.players[0])["nextNumbers"][0], 25)
        self.throw(25, 1)
        self.room.game.on_timeout()
        self.assertEqual(self.room.winner, self.players[0].id)

    def test_countup_gives_each_seat_eight_visits_and_resolves_ties(self):
        for tie in (False, True):
            with self.subTest(tie=tie):
                self.start("countup")
                for visit in range(COUNTUP_VISITS * 2):
                    for _ in range(3):
                        self.throw(20, 1 if tie or visit % 2 else 2)
                self.finish_recap()
                self.assertEqual(self.match.visits_done, [COUNTUP_VISITS] * 2)
                self.assertIsNone(self.room.turn)
                self.room.game.on_timeout()
                self.assertEqual(self.room.phase, "over")
                self.assertEqual(self.room.winner, None if tie else self.players[0].id)
                self.assertEqual(self.match.points, [480 if tie else 960, 480])

    def test_axe_target_and_spectator_view(self):
        self.start("axe")
        for edge, points in bar_darts.AXE_RINGS:
            self.assertEqual(bar_darts.axe_hit(edge, 0), points)
            self.assertEqual(bar_darts.axe_hit(math.nextafter(edge, math.inf), 0), points - 1)
        spectator = type("Spectator", (), {"id": "spectator"})()
        view = self.match.view(spectator)
        self.assertEqual(view["axeRings"], bar_darts.AXE_RINGS)
        self.assertIsNone(view["hint"])
        self.assertIn("5-point", self.match.view(self.players[0])["hint"]["label"])

    def test_axe_defaults_to_corner_scoring(self):
        self.start("axe", axe_scoring=None)
        view = self.match.view(self.players[0])
        self.assertEqual(view["axeRings"], bar_darts.AXE_CORNER_RINGS)
        self.assertEqual(view["axeCorners"], bar_darts.AXE_CORNERS)

    def test_axe_corner_scoring_requires_a_final_throw_call(self):
        for final_xy, call_corner, vx, expected in (
            ((0.64, 0.64), True, 0, 7),
            ((-0.64, 0.64), True, 0, 7),
            ((0.64, 0.64), False, 0, 0),
            ((0, 0), True, 0, 0),
            ((0.64, 0.64), True, -0.001, 0),
            ((0.7, 0), False, 0, 1),
        ):
            with self.subTest(final_xy=final_xy, call_corner=call_corner, vx=vx):
                self.start("axe", players=1, axe_scoring="corner")
                player = self.players[0]

                def throw(x, y, call=False, speed=0):
                    self.match.ready_at = 0
                    self.room.act(player, {"type": "throw", "dx": x - DART_ORIGIN[0],
                                           "dy": y - DART_ORIGIN[1], "vx": speed, "vy": 0, "axeCorner": call})

                self.assertFalse(self.match.view(player)["canCallCorner"])
                with self.assertRaises(GameError):
                    throw(0.64, 0.64, True)
                throw(0, 0)
                throw(0.4, 0)
                self.assertEqual(self.match.points[0], 8)
                throw(0, 0)
                throw(0, 0)
                self.assertTrue(self.match.view(player)["canCallCorner"])
                throw(*final_xy, call_corner, vx)
                self.assertEqual(self.match.shot["value"], expected)
                self.assertEqual(self.match.points[0], 18 + expected)

    def test_axe_stick_speed_boundaries(self):
        for speed, x, points, bounce in (
            (1.44, 0, 0, True), (1.5, 0, 5, False),
            (6.25, 0, 5, False), (6.5, 0, 0, True),
            (6.5, -1.1, 0, False), (0, 0, 5, False), (SWIPE_PACE, 0, 5, False),
        ):
            with self.subTest(speed=speed, x=x):
                self.start("axe")
                vx = min(speed, 6)
                self.room.act(self.players[0], {
                    "type": "throw", "dx": x - DART_ORIGIN[0], "dy": -DART_ORIGIN[1],
                    "vx": -vx, "vy": math.sqrt(max(0, speed ** 2 - vx ** 2)),
                })
                self.assertEqual(self.match.shot["axeBounce"], bounce)
                self.assertEqual(self.match.shot["value"], points)
                self.assertEqual(self.match.points[0], points)
                self.assertEqual(self.room.turn, self.players[1].id)
                self.assertEqual(self.match.view(self.players[0])["left"], 5)
                self.assertEqual(self.match.throws_left(0), 4)

    def test_axe_spin_uses_total_release_speed(self):
        def release(vx, vy):
            self.start("axe")
            self.room.act(self.players[0], {
                "type": "throw", "dx": -DART_ORIGIN[0], "dy": -DART_ORIGIN[1],
                "vx": vx, "vy": vy,
            })
            return self.match.shot

        steady = release(-3.5, 0)
        diagonal = release(-3, 4)
        straight = release(-5, 0)
        self.assertEqual(diagonal["axeSpinSpeed"], 5)
        self.assertEqual(diagonal["axeTurn"], straight["axeTurn"])
        self.assertEqual(diagonal["axeFlightMs"], straight["axeFlightMs"])
        airborne_seconds = (diagonal["axeFlightMs"] - diagonal["axeWindupMs"]) / 1000
        self.assertAlmostEqual(diagonal["axeTurn"], diagonal["axeSpinRate"] * airborne_seconds)
        self.assertAlmostEqual(steady["axeAngle"], 0)
        self.assertGreater(diagonal["axeWindupMs"], 140)
        self.assertGreater(diagonal["axeTurn"], steady["axeTurn"])
        self.assertLess(diagonal["axeFlightMs"], steady["axeFlightMs"])
        self.assertFalse(diagonal["axeBounce"])
        self.assertTrue(release(-3.5, 6)["axeBounce"])

    def test_axe_debug_log_records_the_owned_shot_once(self):
        self.start("axe")
        self.throw(25, 2)
        player, other = self.players
        body = {
            "code": self.room.code, "pid": player.id, "token": player.token,
            "shotId": self.match.shot["id"], "swipe": {"durationMs": 180},
            "trace": {"rows": [[0] * 10 for _ in range(7)],
                      "contact": {"version": 1, "serverResult": "stick", "predictedResult": "blade-first"}},
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "axe-debug.jsonl")
            with patch("server.get_room", return_value=self.room), patch("server.AXE_DEBUG_FILE", path):
                with self.assertRaises(GameError):
                    log_axe_debug({**body, "pid": other.id, "token": other.token})
                log_axe_debug(body)
                log_axe_debug(body)
            (entry,) = map(json.loads, path.read_text().splitlines())
            self.assertEqual(entry["shot"], self.match.shot)
            self.assertEqual(entry["swipe"]["durationMs"], 180)
            self.assertEqual(entry["trace"]["contact"], body["trace"]["contact"])
            self.assertNotIn("token", entry)

    def test_axe_can_throw_right_from_a_placed_origin(self):
        self.start("axe")
        move = {"type": "throw", "dx": 0.75, "dy": -0.25, "vx": 3.5, "vy": 0}
        with self.assertRaises(GameError):
            self.room.act(self.players[0], {**move, "axeOrigin": [2, 0]})
        self.room.act(self.players[0], {**move, "axeOrigin": [-0.75, 0.25]})
        self.assertEqual(self.match.shot["axeOrigin"], [-0.75, 0.25])
        self.assertEqual((self.match.shot["x"], self.match.shot["y"]), (0, 0))
        self.assertEqual(self.match.shot["value"], 5)

    def test_axe_visit_limit_and_results(self):
        for players, tie in ((1, False), (2, False), (2, True)):
            with self.subTest(players=players, tie=tie):
                self.start("axe", players)
                for round_index in range(COUNTUP_VISITS):
                    for throw_index in range(5):
                        for seat in range(players):
                            self.assertEqual(self.room.turn, self.players[seat].id)
                            self.assertEqual(self.match.view(self.players[seat])["left"], 5 - throw_index)
                            self.match.ready_at = 0
                            self.room.act(self.players[seat], {
                                "type": "throw", "dx": (0 if tie or not seat else 0.3) - DART_ORIGIN[0],
                                "dy": -DART_ORIGIN[1], "vx": 0, "vy": 0,
                            })
                            self.assertEqual(len(self.match.view(self.players[seat])["darts"]), throw_index * players + seat + 1)
                    if round_index < COUNTUP_VISITS - 1:
                        self.assertTrue(self.match.view(self.players[0])["roundRecap"])
                        self.finish_recap()
                        self.assertEqual(self.match.view(self.players[0])["darts"], [])
                self.finish_recap()
                self.assertEqual(self.match.visits_done, [8] * players)
                self.assertEqual(self.room.winner, None if tie else self.players[0].id)
                self.assertEqual(self.match.points, [200] if players == 1 else [200, 200 if tie else 160])
                self.assertEqual(len(self.match.darts), 5 * players)

    def test_legacy_axe_match_upgrades_at_round_boundary(self):
        for in_progress in (False, True):
            with self.subTest(in_progress=in_progress):
                self.start("axe")
                del self.match.axe_round_throws
                self.match.points[:] = [30, 25]
                self.match.visits_done[:] = [4, 4]
                expected = [30, 25]
                rounds = 4
                if in_progress:
                    self.throw(25, 2)
                    expected = [45, 40]
                    rounds = 5
                check_restored(self.room)
                if in_progress:
                    self.assertFalse(self.match.alternating_axes)
                    for _ in range(5):
                        self.throw(25, 2)
                    self.finish_recap()
                self.assertEqual(self.match.points, expected)
                self.assertEqual(self.match.visits_done, [rounds, rounds])
                self.assertTrue(self.match.alternating_axes)
                for turn in range(10):
                    self.assertEqual(self.room.turn, self.players[turn % 2].id)
                    self.throw(25, 2)
                    self.assertEqual(len(self.match.darts), turn + 1)
                self.assertTrue(self.match.view(self.players[0])["roundRecap"])

    def test_axe_skip_and_departure_keep_axes_until_round_end(self):
        self.start("axe", players=3)
        self.throw(25, 2)
        self.match.timeout()
        self.assertEqual(self.room.turn, self.players[2].id)
        self.assertEqual(self.match.throws_left(1), 4)
        self.match.leave(self.players[2])
        self.assertEqual(self.room.turn, self.players[0].id)
        self.assertEqual(len(self.match.view(self.players[0])["darts"]), 1)

    def test_checkout_prefers_shortest_legal_route(self):
        self.assertEqual(len(checkout(60, 3)), 2)
        self.assertEqual(checkout(170, 3), ((20, 3), (20, 3), (25, 2)))
        for double_out in (False, True):
            for remaining in range(1, 181):
                for darts in range(1, 4):
                    route = checkout(remaining, darts, double_out)
                    if route:
                        self.assertLessEqual(len(route), darts)
                        self.assertEqual(sum(n * m for n, m in route), remaining)
                        if double_out:
                            self.assertEqual(route[-1][1], 2)

    def test_board(self):
        for number in NUMBERS:
            for multiplier in (1, 2, 3):
                self.assertEqual(hit_at(*aim(number, multiplier)), (number, multiplier))
        self.assertEqual(hit_at(*aim(25, 1)), (25, 1))
        self.assertEqual(hit_at(*aim(25, 2)), (25, 2))
        self.assertEqual(hit_at(0, RADII[-1] + .01), (0, 0))

    def test_visit_bust_and_checkout(self):
        self.start("301")
        first, second = self.players
        for _ in range(2):
            self.throw(20, 3)
            self.assertEqual(self.match.shot["recap"], 0)
        self.throw(20, 3)
        v = self.room.game.view(second)["darts"]
        self.assertEqual((self.room.turn, v["points"], v["roundRecap"], len(v["darts"])),
                         (second.id, [121, 301], False, 3))
        self.assertEqual([d["label"] for d in v["darts"]], ["T20"] * 3)
        self.assertGreater(v["shot"]["recap"], 0)
        with self.assertRaises(GameError):
            self.room.act(second, {"type": "grab"})
        for count in range(4, 7):
            self.throw(20, 1)
            v = self.room.game.view(second)["darts"]
            self.assertEqual(len(v["darts"]), count)
            self.assertEqual(v["roundRecap"], count == 6)
        self.assertEqual(self.room.turn, second.id)
        with self.assertRaises(GameError):
            self.room.act(second, {"type": "throw", "dx": -1, "dy": 0, "vx": -2, "vy": 0})
        self.finish_recap()
        v = self.room.game.view(first)["darts"]
        self.assertEqual((self.room.turn, v["left"], v["darts"], v["roundRecap"]), (first.id, 3, [], False))
        self.throw(20, 3)
        self.throw(20, 3)
        self.assertTrue(self.match.shot["bust"])
        self.assertEqual(self.match.points[0], 121)
        self.assertEqual(self.room.turn, second.id)
        self.skip_rival()
        self.assertTrue(checkout(121, 3))
        self.throw(20, 3)
        self.throw(17, 3)
        self.assertEqual(self.match.points[0], 10)
        self.assertEqual(self.match.view(first)["checkout"], ["D5"])
        self.throw(5, 2)
        self.assertEqual(self.match.points[0], 0)
        self.assertIsNone(self.room.turn)
        self.room.game.on_timeout()
        self.assertEqual((self.room.phase, self.room.winner), ("over", first.id))
        self.assertEqual(self.room.history[-1]["players"][0]["score"], 301)

    def test_bust_on_zero_without_double_or_below_zero(self):
        for number, multiplier in [(20, 1), (20, 3)]:
            with self.subTest(multiplier=multiplier):
                self.start("301")
                self.match.points[0] = 20
                self.match.visit_start = 20
                self.throw(number, multiplier)
                self.assertTrue(self.match.shot["bust"])
                self.assertEqual(self.match.points[0], 20)
                self.assertIsNone(self.match.grabbing)
                self.assertEqual(self.room.turn, self.players[1].id)

    def test_any_finish_is_the_default_and_double_out_is_an_option(self):
        self.start(None)
        self.assertEqual((self.room.settings["finish"], self.match.double_out), ("any", False))
        self.start("301", finish="any")
        self.match.points[0] = 20
        self.match.visit_start = 20
        self.throw(20, 1)
        self.assertEqual((self.match.points[0], self.match.shot["win"], self.match.shot["bust"]), (0, True, False))
        self.start("301", finish="any")
        self.match.points[0] = 20
        self.match.visit_start = 20
        self.throw(19, 3)
        self.assertTrue(self.match.shot["bust"])
        self.assertEqual(checkout(20, 1, False), ((20, 1),) if checkout(20, 1, False)[0][1] != 2 else checkout(20, 1, False))
        self.assertEqual(len(checkout(57, 1, False)), 1)
        self.assertEqual(checkout(57, 1, True), ())
        self.start("301", finish="double")
        self.match.points[0] = 20
        self.match.visit_start = 20
        self.throw(20, 1)
        self.assertTrue(self.match.shot["bust"])

    def test_hint_points_at_the_recommended_spot_for_the_thrower_only(self):
        self.start("301")
        view = self.match.view(self.players[0])
        self.assertEqual(view["hint"]["label"], "T20")
        self.assertIsNone(self.match.view(self.players[1])["hint"])
        self.match.points[0] = 40
        self.assertEqual(self.match.view(self.players[0])["hint"]["label"], "D20")

    def test_round_recap_clears_automatically(self):
        self.start("301")
        for _ in range(6):
            self.throw(20, 1)
        self.assertEqual(self.match.grabbing, 1)
        self.assertEqual(self.room.deadline, self.match.ready_at)
        self.assertEqual(self.match.completed_visit["after"], 241)
        self.assertEqual(len(self.match.completed_visit["darts"]), 3)
        restored = pickle.loads(pickle.dumps(self.room))
        self.assertEqual(restored.deadline, restored.game.darts.ready_at)
        self.match.timeout()
        self.assertEqual((self.match.grabbing, self.room.turn, self.match.darts), (None, self.players[0].id, []))
        self.assertEqual(self.match.view(self.players[0])["darts"], [])

    def test_round_recap_pause_restore_and_full_turn_timer(self):
        self.start("countup", players=1)
        self.room.settings["timer"] = 30
        with patch("time.time", return_value=1000000.0) as clock:
            for _ in range(3):
                self.throw(20, 1)
            due = self.match.ready_at
            self.room.deadline = due + 10  # legacy manual collection deadline
            restored = pickle.loads(pickle.dumps(self.room))
            self.assertEqual(restored.deadline, due)
            self.room.deadline = due
            self.room.pause(self.players[0])
            clock.return_value += 100
            self.room.resume(self.players[0])
            self.assertEqual(self.room.deadline, due + 100)
            self.assertEqual(self.match.ready_at, self.room.deadline)
            clock.return_value = self.room.deadline
            self.finish_recap()
            self.assertEqual(self.room.deadline, clock.return_value + 30)
            self.assertEqual(self.match.visits_done, [1])

    def test_cricket_marks_excess_and_closed_target(self):
        self.start("cricket", 3)
        self.throw(20, 2)
        self.throw(20, 3)
        self.assertEqual(self.match.marks[0][0], 3)
        self.assertEqual(self.match.points[0], 40)
        self.throw(1, 3)
        self.throw(20, 3)
        self.throw(20, 3)
        self.assertEqual(self.match.points[1], 60)
        self.room.game.on_timeout()
        self.throw(20, 3)
        self.throw(20, 3)
        self.assertEqual(self.match.points[2], 0)

    def test_cricket_winner_must_close_and_match_high_score(self):
        self.start("cricket")
        self.match.marks[0] = [3, 3, 3, 3, 3, 3, 1]
        self.match.points[1] = 25
        self.throw(25, 2)
        self.assertIsNone(self.match.winner)
        self.throw(25, 1)
        self.assertEqual(self.match.winner, 0)
        self.room.game.on_timeout()
        self.assertEqual(self.room.winner, self.players[0].id)

    def test_validation_save_and_leave(self):
        self.start("301", 3)
        first, second, third = self.players
        for args in [
            (second, "throw", 0, 0), (first, "shoot", 0, 0),
            (first, "throw", True, 0), (first, "throw", float("nan"), 0),
            (first, "throw", -2.51, 0.38),
        ]:
            p, kind, x, y = args
            with self.assertRaises(GameError):
                self.room.act(p, {"type": kind, "dx": x, "dy": y, "vx": 0, "vy": SWIPE_PACE})
        self.throw(25, 2)
        with self.assertRaises(GameError):
            self.room.act(first, {"type": "throw", "dx": -DART_ORIGIN[0], "dy": -DART_ORIGIN[1], "vx": -SWIPE_PACE, "vy": 0})
        saved = pickle.loads(pickle.dumps(self.room))
        self.assertEqual(saved.game.darts.points, [251, 301, 301])
        self.assertEqual(saved.game.view(first)["darts"]["left"], 2)
        self.room.leave(first)
        self.assertEqual(self.room.turn, second.id)
        self.room.leave(second)
        self.assertEqual(self.room.winner, third.id)

    def test_swipe_motion(self):
        self.start("301")
        first = self.players[0]
        neutral = {"type": "throw", "dx": -DART_ORIGIN[0], "dy": -DART_ORIGIN[1], "vx": -SWIPE_PACE, "vy": 0}
        for invalid in ({"vx": None}, {"vx": True}, {"vy": float("nan")}, {"vx": -6.1}, {"dx": -0.04}):
            with self.assertRaises(GameError):
                self.room.act(first, {**neutral, **invalid})
        for vector, x, y in [
            ({"vx": -3.2}, 0, 0),    # speed never moves where the swipe ends
            ({"vy": 2, "vx": -1.2, "dx": -DART_ORIGIN[0] + 0.1}, 0.1, 0),
            ({}, 0, 0),
        ]:
            self.match.ready_at = 0
            self.room.act(first, {**neutral, **vector})
            self.assertAlmostEqual(self.match.shot["x"], x)
            self.assertAlmostEqual(self.match.shot["y"], y)
            self.assertAlmostEqual(self.match.shot["pace"], math.hypot(vector.get("vx", -SWIPE_PACE), vector.get("vy", 0)))
        self.assertEqual(self.match.shot["label"], "Bull")

    def test_wobble_grows_with_pace(self):
        self.assertLess(bar_darts.spread(1), bar_darts.spread(6))
        bar_darts.SCATTER = 1
        try:
            def miss_distance(pace):
                total = 0
                for seed in range(200):
                    self.start("301")
                    self.match.rng = random.Random(seed)
                    self.match.ready_at = 0
                    self.room.act(self.players[0], {"type": "throw", "dx": -DART_ORIGIN[0], "dy": -DART_ORIGIN[1], "vx": -pace, "vy": 0})
                    total += math.hypot(self.match.shot["x"], self.match.shot["y"])
                return total / 200
            self.assertLess(miss_distance(1), miss_distance(6))
        finally:
            bar_darts.SCATTER = 0

    def test_expected_value_checkout_and_finish_rule(self):
        self.start("301")
        self.match.points[0] = self.match.visit_start = 18
        self.match.darts = [{}, {}]
        x, y, _ = self.match.recommend(0, 0.056)
        self.assertEqual(hit_at(x, y), (9, 2))
        self.match.double_out = False
        x, y, _ = self.match.recommend(0, 0.056)
        self.assertEqual(hit_at(x, y), (18, 1))
        self.match.double_out = True
        self.match.points[0] = self.match.visit_start = 62
        self.match.darts = [{}]
        x, y, _ = self.match.recommend(0, 0.056)
        self.assertTrue(checkout(62 - math.prod(hit_at(x, y)), 1))

    def test_expected_value_cricket_closes_or_scores(self):
        self.start("cricket")
        self.match.marks[0] = [3, 3, 3, 3, 3, 0, 3]
        self.assertEqual(hit_at(*self.match.recommend(0, 0.03)[:2])[0], 15)
        self.match.marks[1] = [0, 3, 3, 3, 3, 3, 3]
        self.match.points[1] = 100
        x, y, reason = self.match.recommend(0, 0.03)
        self.assertEqual(hit_at(x, y)[0], 20)
        self.assertIn("rival", reason)

    def test_expected_value_countup_and_clock(self):
        self.start("countup")
        self.assertEqual(hit_at(*self.match.recommend(0, 0.02)[:2]), (20, 3))
        sigma = 0.13
        x, y, _ = self.match.recommend(0, sigma)
        candidates = {(ax, ay): sum(n * m * p for (n, m), p in outcomes)
                      for ax, ay, outcomes in bar_darts.aim_outcomes(sigma)}
        self.assertEqual(candidates[x, y], max(candidates.values()))
        self.assertGreater(candidates[x, y], candidates[self.match.point(20, 3)])
        self.start("clock")
        self.match.points[0] = 17
        self.assertEqual(hit_at(*self.match.recommend(0, 0.08)[:2]), (18, 1))

    def test_adjust_control_persistence_and_private_hint(self):
        self.start("countup")
        self.assertFalse(self.match.view(self.players[0])["aimControl"])
        room = Room("AIM")
        player = room.add_player("Ada")
        room.switch_game("archery")
        room.change_settings(player, {"aim_control": "adjust"})
        room.start()
        saved = pickle.loads(pickle.dumps(room))
        view = saved.game.darts.view(saved.players[player.id])
        self.assertTrue(view["aimControl"])
        self.assertIn("reason", view["hint"])
        self.assertIsNone(self.match.view(self.players[1])["hint"])

    @patch.object(bar_darts, "SCATTER", 1)
    def test_bot_accuracy_order(self):
        self.start("countup")
        player = self.players[0]
        distances = []
        for level in ("easy", "normal", "hard"):
            player.bot = level
            self.match.rng = random.Random(24)
            x, y, _ = self.match.recommend(0, bar_darts.spread(SWIPE_PACE) * bar_darts.BOT_SPREAD_MULTIPLIER[level])
            with patch.object(self.match, "throw") as throw:
                self.match.bot(player)
            _, actual_x, actual_y = throw.call_args.args
            distances.append(math.hypot(actual_x - x, actual_y - y))
        self.assertGreater(distances[0], distances[1])
        self.assertGreater(distances[1], distances[2])

    @patch.object(bar_darts, "SCATTER", 1)
    def test_bots_finish(self):
        for mode in ("301", "501", "cricket", "clock", "countup", "axe"):
            with self.subTest(mode=mode):
                self.start(mode, 3)
                self.match.rng = random.Random(24)
                for p, level in zip(self.players, ("easy", "normal", "hard")):
                    p.bot = level
                for _ in range(300):
                    if self.room.phase == "over":
                        break
                    if self.room.game.bot_ready():
                        self.room.game.bot_tick()
                    else:
                        self.room.game.on_timeout()
                self.assertEqual(self.room.phase, "over")
                self.assertIn(self.room.winner, [p.id for p in self.players])


if __name__ == "__main__":
    unittest.main()
