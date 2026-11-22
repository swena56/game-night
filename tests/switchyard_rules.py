"""Run with python3 tests/switchyard_rules.py."""
import pickle
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from games.base import GameError
from games.switchyard import BEAT, COUNTDOWN, WAVE_PATTERNS


class SwitchyardRules(unittest.TestCase):
    def setUp(self):
        self.clock = patch("time.time", return_value=1_000_000)
        self.now = self.clock.start()
        self.addCleanup(self.clock.stop)
        self.room = server.Room("RAIL")
        self.player = self.room.add_player("Dispatcher")
        self.room.switch_game("switchyard")
        self.room.settings["rules"] = "classic"

    def tick(self):
        game = self.room.game
        self.now.return_value = game.next_beat
        return game.frame(self.now.return_value)

    def switch(self, node, position, player=None, **overrides):
        game = self.room.game
        action = {"type": "set_switch", "switch": node, "position": position,
                  "gameNo": self.room.game_no, "wave": game.wave + 1, "beat": game.beat}
        self.room.no_bump = False  # The HTTP action handler resets this between requests.
        self.room.act(player or self.player, {**action, **overrides})

    def test_wave_timing_routes_and_team_rematch(self):
        partner = self.room.add_player("Signalman")
        self.room.start()
        game = self.room.game
        watcher = self.room.add_player("Watcher")
        self.assertFalse(self.room.view(watcher)["switchyard"]["canSwitch"])
        self.assertEqual(game.next_beat - self.now.return_value, COUNTDOWN)
        launches, visited, peak = {}, set(), 0
        while self.room.phase == "playing":
            for train in game.trains:
                target = train["target"]
                if train["node"] == "entry":
                    self.switch("main", target // 2)
                elif train["node"] == "main":
                    self.switch(train["route"], target % 2, partner)
            peak = max(peak, len(game.trains))
            before = {t["id"] for t in game.trains}
            wave = game.wave
            self.tick()
            for train in game.trains:
                if train["id"] not in before:
                    launches.setdefault(wave, []).append(self.now.return_value)
            if game.feedback:
                visited.add(game.feedback["depot"])
        for wave, spacing in enumerate((3, 2, 1)):
            times = launches[wave]
            self.assertEqual(len(times), 6)
            self.assertEqual([b - a for a, b in zip(times, times[1:])], [spacing * BEAT] * 5)
        self.assertEqual(visited, {0, 1, 2, 3})
        self.assertEqual(peak, 3)
        self.assertEqual(game.delivered, 18)
        self.assertEqual(self.player.wins, 1)
        self.assertEqual(partner.wins, 1)
        self.assertEqual(watcher.wins, 0)
        self.room.act(self.player, {"type": "rematch"})
        fresh = self.room.game
        self.assertEqual((fresh.wave, fresh.delivered, fresh.strikes, fresh.trains), (0, 0, 0, []))
        self.assertIsNone(fresh.last_switch)

    def test_party_crew_survives_four_misses_and_tracks_streak(self):
        self.room.settings["rules"] = "party"
        self.room.start()
        game = self.room.game
        self.tick()
        self.assertEqual(game.next_beat - self.now.return_value, 3)
        while self.room.phase == "playing":
            for train in game.trains:
                target = train["target"]
                if train["node"] == "entry":
                    if game.wave == 0:
                        self.assertEqual(game.view(self.player)["switchyard"]["hints"]["main"], target // 2)
                    self.switch("main", target // 2 if train["id"] >= 4 else 1 - target // 2)
                elif train["node"] == "main":
                    self.switch(train["route"], target % 2)
            self.tick()
        self.assertTrue(game.won)
        self.assertEqual((game.delivered, game.strikes, game.best_streak), (14, 4, 14))

    def test_cutoff_pause_and_idempotency(self):
        self.room.start()
        game = self.room.game
        watcher = self.room.add_player("Watcher")
        for node, position in (("missing", 0), ("main", True), ("main", 2)):
            with self.assertRaises(GameError):
                self.switch(node, position)
        with self.assertRaises(GameError):
            self.switch("main", 1, watcher)
        self.tick()
        self.now.return_value += 1
        self.room.pause(self.player)
        self.assertFalse(game.frame(game.next_beat + 10))
        self.assertEqual(game.trains[0]["node"], "entry")
        self.now.return_value += 8
        self.room.resume(self.player)
        self.assertEqual(game.next_beat - self.now.return_value, 1)
        self.switch("main", 1)
        note = game.last_switch
        self.switch("main", 1)
        self.assertIs(game.last_switch, note)
        # A request at the exact routing beat resolves the old setting first.
        self.now.return_value = game.next_beat
        self.switch("main", 0)
        self.assertEqual(game.trains[0]["route"], "east")
        self.assertEqual(game.switches["main"], 1)
        self.assertFalse(self.room.no_bump)
        self.switch("main", 0, beat=1)
        self.assertEqual(game.switches["main"], 1)
        self.switch("east", 1)
        self.tick()
        self.switch("east", 0)
        self.assertEqual(game.trains[0]["route"], 3)

    def test_wave_three_has_two_separated_double_flip_beats(self):
        for pattern in WAVE_PATTERNS[-1]:
            for mirror in range(4):
                ends = [target ^ mirror for target in pattern]
                switches = [0, 0, 0]
                flips = []
                for beat in range(len(ends) + 1):
                    settings = {}
                    if beat < len(ends):
                        settings[0] = ends[beat] // 2
                    if beat:
                        branch, position = divmod(ends[beat - 1], 2)
                        settings[branch + 1] = position
                    flips.append(sum(switches[i] != position for i, position in settings.items()))
                    for i, position in settings.items():
                        switches[i] = position
                self.assertEqual(flips.count(2), 2)
                self.assertNotIn((2, 2), zip(flips, flips[1:]))
                self.assertIn(0, flips)

    def test_route_calls_are_shared_advice_until_launch(self):
        partner = self.room.add_player("Signalman")
        self.room.start()
        game = self.room.game
        watcher = self.room.add_player("Watcher")
        call = {"type": "call_route", "train": 0, "branch": "east", "gameNo": self.room.game_no}
        self.room.act(partner, call)
        view = self.room.view(watcher)["switchyard"]
        self.assertEqual(view["upcoming"][0]["call"], {"name": partner.name, "branch": "east"})
        self.assertFalse(view["canCall"])
        self.assertEqual(game.switches["main"], 0)
        with self.assertRaises(GameError):
            self.room.act(watcher, call)
        with self.assertRaises(GameError):
            self.room.act(partner, {**call, "branch": "north"})
        self.tick()
        self.room.act(partner, call)
        self.assertEqual(game.route_calls, {})
        self.assertEqual(game.trains[0]["node"], "entry")

    def test_old_match_requests_and_missing_context(self):
        partner = self.room.add_player("Signalman")
        self.room.start()
        old = self.room.game_no
        self.room.game.finish(True)
        self.room.act(self.player, {"type": "rematch"})
        self.switch("main", 1, gameNo=old)
        self.room.act(partner, {"type": "call_route", "train": 0, "branch": "east", "gameNo": old})
        self.assertEqual(self.room.game.switches["main"], 0)
        self.assertEqual(self.room.game.route_calls, {})
        with self.assertRaisesRegex(GameError, "Refresh"):
            self.switch("main", 1, beat=None)

    def test_start_requires_humans(self):
        self.room.switch_game("unmask")
        self.room.add_bot("hard")
        self.room.switch_game("switchyard")
        self.assertFalse(self.room.fits("switchyard"))
        with self.assertRaisesRegex(GameError, "Remove computer players"):
            self.room.start()
        with self.assertRaisesRegex(GameError, "human players"):
            self.room.host_add_bot(self.player, "normal")
        bot = next(p for p in self.room.seated() if p.bot)
        self.room.remove_bot(self.player, bot.id)
        self.assertTrue(self.room.fits("switchyard"))
        self.room.start()
        self.assertEqual(self.room.game.crew, {self.player.id})

    def test_miss_identifies_first_incorrect_junction(self):
        for target, miss_at in ((1, "west"), (2, "main")):
            self.room.start()
            game = self.room.game
            game.schedule[0] = target
            for _ in range(4):
                self.tick()
            self.assertEqual(game.feedback["missAt"], miss_at)
            self.assertEqual(game.feedback["depot"], 0)
            self.assertEqual(game.strikes, 1)

    def test_restore_while_paused_preserves_time_to_next_beat(self):
        self.room.start()
        self.tick()
        self.now.return_value += 1
        self.room.pause(self.player)
        self.now.return_value += 5
        saved = pickle.dumps(self.room)
        self.now.return_value += 20
        restored = pickle.loads(saved)
        player = restored.players[self.player.id]
        self.assertEqual(restored.view(player)["switchyard"]["timeLeft"], 1)
        self.assertEqual(restored.game.trains[0]["node"], "entry")
        self.now.return_value += 10
        restored.resume(player)
        self.assertEqual(restored.game.next_beat - self.now.return_value, 1)

    def test_strikes_carry_and_stop_on_three(self):
        self.room.start()
        game = self.room.game
        game.schedule = [1] + [0] * 5 + [1] * 12
        while game.wave == 0:
            self.tick()
        self.assertEqual(game.strikes, 1)
        while self.room.phase == "playing":
            self.tick()
        self.assertEqual(game.strikes, 3)
        self.assertEqual(game.delivered, 5)
        self.assertEqual(self.room.history[-1]["teamWinnerIds"], [])
        self.assertIn("5/18 delivered", self.room.history[-1]["text"])


if __name__ == "__main__":
    unittest.main()
