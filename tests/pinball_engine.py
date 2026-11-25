"""The engine runs tables other than Golden Hour: a minimal custom layout with its own rules."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from games.pinball_engine import Layout, Rules, Table, closest, flipper_pair


class Mini(Table):
    layout = Layout(
        rails=((0, 8, 0, 0), (0, 0, 6, 0), (6, 0, 6, 8), (0, 6, 1.5, 7.5), (4.8, 7.5, 6, 6)),
        flippers=flipper_pair(7.5, 1.5, 4.5), launch=(5.5, 7),
        bumps=((3, 3, 0.5),), lanes=((3, 1),), width=6, height=8,
        flipper_zone=(6, 8), center=(3, 4))
    rules = Rules(balls=2, bumper=7, lane=40, first_lit=3)


def drop(table, x, y, vx=0, vy=0):
    table.staged = False
    table.x, table.y, table.vx, table.vy, table.still_origin = x, y, vx, vy, (x, y)
    return table


class EngineTests(unittest.TestCase):
    def test_defaults_come_from_layout_and_rules(self):
        table = Mini()
        self.assertEqual((table.balls, table.x, table.y), (2, 5.5, 7))
        self.assertEqual(len(table.angles), 2)
        self.assertEqual(len(table.public()), 31)
        self.assertEqual(Mini.layout.public()["launch"], (5.5, 7))

    def test_custom_points_and_optional_parts(self):
        table = drop(Mini(), 3 + 0.5 + 0.19 + 0.03, 3, -12)
        table.step()
        self.assertEqual((table.event, table.score), ("bumper0", 7))
        table = drop(Mini(), 3, 1)
        table.step()
        self.assertEqual((table.event, table.score, table.lane_bits), ("mult", 40, 0))
        self.assertEqual(table.mult, 2)  # the only lane completes the multiplier set
        table.vy = 0
        for _ in range(240 * 20):  # no ramp, spinner, gate or outlane: nothing should crash
            table.step()

    def test_ball_count_comes_from_rules(self):
        table = drop(Mini(), 3, 8.3, vy=20)
        for _ in range(240 * 3):
            table.step()
        self.assertEqual(table.balls, 1)

    def test_closest_clamps_to_the_segment(self):
        self.assertEqual(closest(5, 5, 0, 0, 2, 0), (2, 0))
        self.assertEqual(closest(1, 5, 0, 0, 2, 0), (1, 0))


if __name__ == "__main__":
    unittest.main()
