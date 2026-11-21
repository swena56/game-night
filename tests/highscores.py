"""Exercise comparable round history, persistence, profile merging, and replay goals."""
import pickle
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Room, default_settings, merge_profile

room = Room("TEST")
room.settings = default_settings("shutbox")
player = room.add_player("Ann")
room.start()
room.game.final_scores = lambda: {player.id: 12}
room.finish(None, "Done")
first = room.history[-1]
key = first["record"]["key"]
assert first["players"][0]["recordScore"] == 12
del room.game.final_scores
room = pickle.loads(pickle.dumps(room))
player = room.players[player.id]
assert room.room_records[key]["value"] == 12
room.start()
room.game.final_scores = lambda: {player.id: 15}
room.finish(None, "Done")
assert room.room_records[key]["value"] == 12
room.start()
room.game.final_scores = lambda: {player.id: 2}
room.record_interrupted = True
room.finish(None, "Interrupted")
assert room.history[-1]["recordExcluded"]
assert room.room_records[key]["value"] == 12
for _ in range(33):
    room.start()
    room.game.final_scores = lambda: {player.id: 15}
    room.finish(None, "Done")
assert first not in room.history
assert room.view(player)["roomRecords"][key]["value"] == 12
room.to_lobby()
room.add_bot("hard")
room.start()
assert room.round_record["key"] != key
room.to_lobby()
room.remove_bot(player, next(p.id for p in room.seated() if p.bot))
room.settings["rounds"] = 1
room.start()
assert room.round_record["key"] != key
room.reset_scores(player)
assert room.room_records == {}

base = {"kind": "strokes", "game": "putt", "label": "Classic"}
old = {"benchmarks": {"putt": {**base, "best": 7, "recent": [["1", 1, 7], ["2", 2, 10]]}}}
new = {"benchmarks": {"putt": {**base, "best": 9, "recent": [[str(i), i, 9] for i in range(2, 8)]}}}
merged = merge_profile(old, new)
assert merged["benchmarks"]["putt"]["best"] == 7
assert [row[0] for row in merged["benchmarks"]["putt"]["recent"]] == list("34567")
assert merge_profile(merged, new) == merged

node = r"""
const assert = require('node:assert/strict'), fs = require('node:fs');
const data = new Map();
global.load = (k) => JSON.parse(data.get(k) || 'null');
global.store = (k, value) => data.set(k, JSON.stringify(value));
global.SOLO_GAMES = [['putt', 'Putt Party'], ['chess', 'Chess']];
eval(fs.readFileSync('static/profile.js', 'utf8') + ';global.Profile = Profile;');
let at = 0;
function finish(game, key, kind, value) {
  const last = { game, at: ++at, name: game, record: {key, label: key, kind},
    players: [{id: 'me', recordScore: value, won: value === true}] };
  const state = { code: 'ROOM', phase: 'over', me: {id: 'me'}, players: last.players, history: [last] };
  Profile.onState(state);
  Profile.onState(state);
  return Profile.replayGoal(state);
}
assert.match(finish('putt', 'classic', 'strokes', 10), /First mark/);
assert.match(finish('putt', 'classic', 'strokes', 10), /Matched/);
assert.match(finish('putt', 'classic', 'strokes', 7), /New all-time best/);
assert.match(finish('putt', 'water', 'strokes', 15), /First mark/);
for (let i = 0; i < 5; i++) finish('putt', 'classic', 'strokes', 12);
assert.equal(load('gn.profile').benchmarks.classic.best, 7);
assert.equal(load('gn.profile').benchmarks.classic.recent.length, 5);
assert.match(load('gn.profile').last.goal, /beat 12 strokes/);
for (let i = 0; i < 5; i++) finish('chess', 'chess', 'wins', true);
assert.equal(load('gn.profile').benchmarks.chess.best, 5);
assert.match(load('gn.profile').last.goal, /match your five-game best/);
assert.match(finish('chess', 'chess', 'wins', false), /4 wins in your last 5/);
"""
subprocess.run(["node", "-e", node], cwd=Path(__file__).resolve().parents[1], check=True)
print("High-score checks passed")
