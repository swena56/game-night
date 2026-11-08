"""🏆 My record: finished games go into the history with each player's id and bot level (and whether the
lowest score wins), and static/profile.js turns them into a lifetime record (stars, bests, badges,
milestones), checked here in Node against fake states.

    python3 tests/profile_record.py        # a second or two (needs node)
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


room = server.Room("TEST")
room.settings["game"] = "shutbox"
ann = room.add_player("Ann")
room.add_bot("hard")
room.add_bot("easy")
room.finish(ann, "Ann wins")
h = room.history[-1]
check("history players carry id and bot level",
      [(p["id"] == ann.id, p["bot"]) for p in h["players"]][:1] == [(True, None)]
      and sorted(p["bot"] or "" for p in h["players"]) == ["", "easy", "hard"], h["players"])
check("history says when the lowest score wins", h["low"] is True and "at" in h)

node = r"""
const fs = require('fs'); let mem = {};
global.load = (k) => (k in mem ? JSON.parse(mem[k]) : null);
global.store = (k, v) => { if (v == null) delete mem[k]; else mem[k] = JSON.stringify(v); };
global.SOLO_GAMES = [['chess', '♟️ Chess'], ['hearts', '♥️ Hearts'], ['yacht', '🎲 Yacht'], ['go', '⚫ Go'], ['oware', 'Oware'], ['speed', 'Speed']];
eval(fs.readFileSync(process.argv[1], 'utf8') + ';global.Profile = Profile;');
const out = {};
const pl = (id, bot, score, won) => ({ id, bot, score, won, name: id });
let t = 0;
const S = (game, players, extra = {}) => ({ code: 'ABCD', phase: 'over', me: { id: 'me' }, games: [{ id: 'chess', badges: { giant: ['🧠', 'Giant slayer', 'Win'] } }],
  players: [{ id: 'me', badges: extra.badges || {} }], history: [{ game, icon: '', name: game, at: ++t, low: !!extra.low, players }] });
// win alone against a normal + hard bot: the star is for the weakest (normal → ★★)
mem['recentGames'] = JSON.stringify(['go']);
out.seeded = Profile.tried('go') && !Profile.showNew();
let s = S('chess', [pl('me', null, null, true), pl('b1', 'normal'), pl('b2', 'hard')]);
out.news1 = Profile.onState(s); out.again = Profile.onState(s);  // the same finish counts once
out.stars = Profile.stars('chess');
// a win with another person at the table earns no star
Profile.onState(S('yacht', [pl('me', null, 200, true), pl('pal', null, 150), pl('b', 'hard', 100)]));
out.yachtStars = Profile.stars('yacht');
// Hearts: lowest wins (inferred from the winner), a lower score is a new best
Profile.onState(S('hearts', [pl('me', null, 40, false), pl('b', 'easy', 20, true), pl('c', 'easy', 90)]));
out.heartsBest = Profile.onState(S('hearts', [pl('me', null, 30, true), pl('b', 'easy', 50), pl('c', 'easy', 90)]));
// badges grow across states and survive a scoreboard reset
Profile.onState({ ...S('chess', []), phase: 'lobby', players: [{ id: 'me', badges: { 'chess:giant': 1 } }] });
Profile.onState({ ...S('chess', []), phase: 'lobby', players: [{ id: 'me', badges: {} }] });
Profile.onState({ ...S('chess', []), phase: 'lobby', players: [{ id: 'me', badges: { 'chess:giant': 1 } }] });
out.suggestFresh = Profile.suggest();
out.newTags = Profile.showNew();
Profile.onState(S('go', [pl('me', null, null, false), pl('b', 'easy', null, true)]));
out.mile = Profile.onState(S('oware', [pl('me', null, null, false), pl('b', 'easy', null, true)]));
out.all = Profile.onState(S('speed', [pl('me', null, null, false), pl('b', 'easy', null, true)]));
out.p = load('gn.profile');
out.suggest = Profile.suggest();
console.log(JSON.stringify(out));
"""
r = subprocess.run(["node", "-e", node, os.path.join(ROOT, "static", "profile.js")], capture_output=True, text=True)
check("node ran", r.returncode == 0, r.stderr[-400:])
if r.returncode == 0:
    o = json.loads(r.stdout)
    p = o["p"]
    check("a new record starts from Played lately, tags hidden until 3 tried", o["seeded"] and o["newTags"])
    check("a solo win earns the star for the weakest bot", o["stars"] == 2 and "★★☆" in o["news1"][0], o["news1"])
    check("a finished game counts once", o["again"] == [] and p["games"]["chess"]["played"] == 1)
    check("no star with another person at the table", o["yachtStars"] == 0 and p["games"]["yacht"]["wins"] == 1)
    check("lowest-wins best", p["games"]["hearts"]["best"] == 30 and p["games"]["hearts"]["low"] and "Personal best" in o["heartsBest"][0], o["heartsBest"])
    check("badges collected once across a reset", p["badges"]["chess:giant"]["n"] == 2 and p["badges"]["chess:giant"]["emo"] == "🧠", p["badges"])
    check("milestone at 5 different games", any("Explorer" in x for x in o["mile"]), o["mile"])
    check("and when every game is played", any("Played them all" in x for x in o["all"]), o["all"])
    check("suggests a game not played yet", o["suggestFresh"] in ("oware", "speed"), o["suggestFresh"])
    check("then one with the fewest stars", o["suggest"] in ("yacht", "go", "oware", "speed"), o["suggest"])

print("\n" + ("all good" if not fails else f"{len(fails)} failed: {fails}"))
sys.exit(1 if fails else 0)
