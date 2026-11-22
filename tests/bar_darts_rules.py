"""Exercise the Darts courses through the room."""
import math
import random
import sys
import unittest
from pathlib import Path
import pickle

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from games.bar_darts import COUNTUP_VISITS, DART_ORIGIN, NUMBERS, RADII, SWIPE_PACE, checkout, hit_at
from games.base import GameError
from server import Room


def aim(number, multiplier):
    if number == 25:
        return (0, 0 if multiplier == 2 else 0.06)
    angle = math.tau * NUMBERS.index(number) / 20
    radius = {1: 0.4, 2: 0.975, 3: 0.605}[multiplier]
    return radius * math.sin(angle), radius * math.cos(angle)


class DartsTests(unittest.TestCase):
    def start(self, mode, players=2):
        self.room = room = Room("DART")
        self.players = [room.add_player(name) for name in ("Ada", "Ben", "Cory")[:players]]
        room.switch_game("archery")
        if mode is not None:
            room.change_settings(self.players[0], {"course": mode})
        room.start()
        self.match = room.game.darts
        self.match.rng = random.Random(24)

    def throw(self, number, multiplier):
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
            if self.room.turn == self.players[1].id:
                self.room.game.on_timeout()
            self.throw(number, 2)
        if self.room.turn == self.players[1].id:
            self.room.game.on_timeout()
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
                self.assertEqual(self.match.visits_done, [COUNTUP_VISITS] * 2)
                self.assertIsNone(self.room.turn)
                self.room.game.on_timeout()
                self.assertEqual(self.room.phase, "over")
                self.assertEqual(self.room.winner, None if tie else self.players[0].id)
                self.assertEqual(self.match.points, [480 if tie else 960, 480])

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
        self.assertEqual((self.room.turn, v["points"], v["left"]), (second.id, [121, 301], 3))
        self.assertEqual([d["label"] for d in v["darts"]], ["T20"] * 3)
        self.assertGreater(v["shot"]["recap"], 0)
        self.assertGreater(v["readyIn"], v["shot"]["recap"])
        self.room.game.on_timeout()
        self.assertEqual(self.room.turn, first.id)
        self.throw(20, 3)
        self.throw(20, 3)
        self.assertTrue(self.match.shot["bust"])
        self.assertEqual(self.match.points[0], 121)
        self.assertEqual(self.room.turn, second.id)
        self.room.game.on_timeout()
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
                self.assertEqual(self.room.turn, self.players[1].id)

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
            ({"vx": -3.2}, -0.14, 0),
            ({"vy": 2, "vx": -1.2, "dx": -DART_ORIGIN[0] + 0.1}, 0.24, 0.17),
            ({}, 0, 0),
        ]:
            self.match.ready_at = 0
            self.room.act(first, {**neutral, **vector})
            self.assertAlmostEqual(self.match.shot["x"], x)
            self.assertAlmostEqual(self.match.shot["y"], y)
            self.assertAlmostEqual(self.match.shot["pace"], math.hypot(vector.get("vx", -SWIPE_PACE), vector.get("vy", 0)))
        self.assertEqual(self.match.shot["label"], "Bull")

    def test_bots_finish(self):
        for mode in ("301", "501", "cricket", "clock", "countup"):
            with self.subTest(mode=mode):
                self.start(mode, 3)
                self.match.rng = random.Random(24)
                for p, level in zip(self.players, ("easy", "normal", "hard")):
                    p.bot = level
                for _ in range(300):
                    if not self.room.game.bot_ready():
                        self.room.game.on_timeout()
                        break
                    self.room.game.bot_tick()
                self.assertEqual(self.room.phase, "over")
                self.assertIn(self.room.winner, [p.id for p in self.players])


if __name__ == "__main__":
    unittest.main()
