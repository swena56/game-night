"""Safety checks for every shipped table. Slow (many minutes on a small machine), so run on demand, not with the quick suite:

    python3 -m unittest tests.pinball_levels

After changing a table on purpose, look at what moved, then save new shot counts: python3 tools/pinball_level.py baseline
"""
import contextlib
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.pinball_level import BASELINE, lost_shots, report, shipped      # noqa: E402
from games.pinball_tables.reach import reach                               # noqa: E402

# Faults that are already there and waiting for a decision. A table may only fail these; a new fault fails the test, and so does a
# listed one that has been fixed (take it off the list).
KNOWN = {}


class ShippedTables(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shots, cls.failed, cls.text = {}, {}, {}
        for name, spec in shipped().items():
            cls.shots[name] = reach(spec)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                cls.failed[name] = report(spec, quick=True, shots=cls.shots[name])
            cls.text[name] = out.getvalue()
            print(f"\n== {name}\n{cls.text[name]}", file=sys.__stdout__, flush=True)

    def check(self, check):
        for name, failed in self.failed.items():
            with self.subTest(table=name):
                if check in KNOWN.get(name, ()):
                    self.assertIn(check, failed, f"{name} no longer fails '{check}': take it off KNOWN")
                else:
                    self.assertNotIn(check, failed, self.text[name])

    def test_the_flipper_gap_lets_the_ball_through(self):
        self.check("gap")

    def test_a_ball_dropped_down_the_middle_drains(self):
        self.check("middle")

    def test_no_ball_comes_to_rest(self):
        self.check("rest")

    def test_slingshots_never_juggle_the_ball(self):
        self.check("sling")

    def test_every_part_can_be_hit_from_the_flippers(self):
        self.check("reach")

    def test_no_goal_lost_most_of_its_shots(self):
        with open(BASELINE, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(set(saved), set(self.shots), "a table was added or removed: python3 tools/pinball_level.py baseline")
        for name, before in saved.items():
            with self.subTest(table=name):
                self.assertEqual(lost_shots(self.shots[name], before), {}, "(hits saved, hits now)")


if __name__ == "__main__":
    unittest.main()
