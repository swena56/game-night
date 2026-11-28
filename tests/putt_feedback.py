"""Regression checks for Putt Party course codes, practice, previews and scoring."""
import math
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from games import putt
from games.base import GameError
import server


def lobby():
    room = server.Room("TEST")
    host = room.add_player("Player")
    room.switch_game("putt")
    return room, host


def round_from(code=None):
    room, host = lobby()
    if code:
        room.change_settings(host, {"course_code": code})
    room.start()
    game = room.game
    holes = [game.hole]
    for _ in range(1, game.s["holes"]):
        game.new_hole()
        holes.append(game.hole)
    assert all(putt.valid_route(hole) for hole in holes)
    return game.course_code, holes


code, holes = round_from()
assert round_from(code) == (code, holes)
code, holes = round_from("p1-mixed-9-12345678")
assert code == "P1-mixed-9-12345678" and len(holes) == 9
assert round_from(code) == (code, holes)

room, host = lobby()
room.change_settings(host, {"course_code": code})
room.change_settings(host, {"holes": 3})
assert "course_code" not in room.settings
try:
    room.change_settings(host, {"course_code": "P2-water-9-12345678"})
except GameError:
    pass
else:
    raise AssertionError("Accepted an unknown course-code version")

room.start()
action = {"type": "preview", "angle": math.pi / 2, "power": 0.5}
try:
    room.game.act(host, action)
except GameError:
    pass
else:
    raise AssertionError("Preview bypassed the multiplayer setting")

room, host = lobby()
room.change_settings(host, {"course": "practice"})
room.start()
game = room.game
assert game.s["holes"] == 1 and room.settings["holes"] != 1
assert game.hole == putt.practice_hole() and putt.valid_route(game.hole)
game.act(host, action)
preview = game.view(host)["putt"]["preview"]
assert preview["point"] and preview["angle"] == action["angle"]
assert game.strokes == [0] and game.shot is None

with patch.object(putt, "simulate", return_value=(game.hole["tee"], "water", [game.hole["tee"]])):
    game.putt(0, math.pi / 2, 0.5)
assert game.shot["outcome"] and game.strokes == [2]
assert game.view(host)["putt"]["preview"] is None

with patch.object(putt, "simulate", return_value=(game.hole["cup"], "cup", [game.hole["cup"]])):
    game.putt(0, math.pi / 2, 0.5)
detail = game.view(host)["putt"]["scoreHistory"][0][0]
assert detail == {"status": "holed", "played": 2, "water": 1, "discount": 1, "score": 2, "adjustment": 0}
print("Putt Party feedback checks passed")
