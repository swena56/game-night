"""✨ XP, levels and unlocks (static/profile.js) and the server mirror of the lifetime record (server.py
/api/profile/get and /put, the `look` room action).

    python3 tests/profile_xp.py        # a few seconds (needs node)
"""
import http.client
import json
import os
import pickle
import re
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["ROOMS_FILE"] = os.path.join(tempfile.mkdtemp(prefix="gn-xp-"), "rooms.pickle")
import server  # noqa: E402
from games import GameError  # noqa: E402

server.PROFILE_DIR = tempfile.mkdtemp(prefix="gn-profiles-")
fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


# ---------- the browser side, in node
node = r"""
const fs = require('fs'); let mem = {};
global.load = (k) => (k in mem ? JSON.parse(mem[k]) : null);
global.store = (k, v) => { if (v == null) delete mem[k]; else mem[k] = JSON.stringify(v); };
global.SOLO_GAMES = [['chess', '♟️ Chess'], ['hearts', '♥️ Hearts'], ['yacht', '🎲 Yacht'], ['go', '⚫ Go'], ['oware', 'Oware'], ['speed', 'Speed']];
eval(fs.readFileSync(process.argv[1], 'utf8') + ';global.Profile = Profile;');
const out = {};
out.lv = [79, 80, 179, 180, 1439, 1440, 27439, 27440, 1e9].map((x) => Profile.levelOf(x).lvl);
out.xpFor = [Profile.xpFor(10), Profile.xpFor(50)];
// an old record (before XP) gets XP from its history, once, and no toasts for what it already had
mem['gn.profile'] = JSON.stringify({ since: '2026-11-01', seen: [], snap: {}, badges: { 'chess:giant': { n: 3, emo: '🧠', name: 'Giant', how: '' } },
  games: { chess: { played: 10, wins: 6, stars: 2 }, go: { played: 2, wins: 0 }, yacht: { played: 0, wins: 0, tried: true } } });
const m1 = Profile.migrate(load('gn.profile'));
out.migXp = m1.xp; out.migLvl = m1.lvl; out.migUnl = m1.unl;
out.migAgain = Profile.migrate(m1).xp;
store('gn.profile', null);
// multipliers: a win against hard bots ×2, against people ×1.5; a long game; badges during play join the next card
let t = 0;
const pl = (id, bot, won) => ({ id, bot, won, name: id, score: null });
const S = (game, players, extra = {}) => ({ code: 'WXYZ', phase: extra.phase || 'over', me: { id: 'me' },
  games: [{ id: 'chess', badges: { giant: ['🧠', 'Giant slayer', 'Win'], quick: ['⚡', 'Quick', 'Fast'] } }],
  players: [{ id: 'me', badges: extra.badges || {} }], history: [{ game, icon: '♟️', name: game, at: extra.at || ++t, secs: extra.secs, players }] });
Profile.onState(S('chess', [pl('me', null, true), pl('b', 'hard')], { secs: 200 }));
out.hard = load('gn.profile').last.lines;
Profile.onState({ ...S('chess', []), phase: 'playing', history: [], players: [{ id: 'me', badges: { 'chess:quick': 1 } }] });
out.pend = load('gn.profile').pend;
const xpBefore = load('gn.profile').xp;
Profile.onState(S('chess', [pl('me', null, true), pl('pal', null), pl('b', 'easy')], { badges: { 'chess:quick': 1, 'chess:giant': 1 } }));
const L = load('gn.profile').last;
out.people = L.lines; out.from = L.from; out.to = L.to; out.xpBefore = xpBefore; out.pendGone = load('gn.profile').pend;
// a badge that lands in a later state than the finish joins the same card
const at = t;
Profile.onState(S('chess', [pl('me', null, true), pl('pal', null), pl('b', 'easy')], { at, badges: { 'chess:quick': 2, 'chess:giant': 1 } }));
out.late = load('gn.profile').last.lines.length - L.lines.length;
// looks: '' = none, a locked pick falls back to the newest unlocked one
const p = load('gn.profile'); p.xp = Profile.xpFor(12) + 5; p.look = { frame: 'legend', title: '' }; store('gn.profile', p);
out.look = Profile.look();
out.unlocked = [Profile.unlocked('back', 'sunset'), Profile.unlocked('back', 'galaxy'), Profile.unlocked('pack', 'food'), Profile.unlocked('pack', 'space')];
// a level-up from just under the line
const q = load('gn.profile'); q.xp = Profile.xpFor(15) - 3; store('gn.profile', q);
out.up15 = Profile.onState(S('go', [pl('me', null, false), pl('b', 'easy', true)]));
out.unlocks = Profile.UNLOCKS; out.packs = Profile.PACKS;
console.log(JSON.stringify(out));
"""
r = subprocess.run(["node", "-e", node, os.path.join(ROOT, "static", "profile.js")], capture_output=True, text=True)
check("node ran", r.returncode == 0, r.stderr[-600:])
o = json.loads(r.stdout) if r.returncode == 0 else {}
if o:
    check("level curve: need(n) = 60 + 20n, capped at 50", o["lv"] == [1, 2, 2, 3, 9, 10, 49, 50, 50] and o["xpFor"] == [1440, 27440], (o["lv"], o["xpFor"]))
    # chess: 30 + 10·10 + 6·15 + 2·20 = 260; go: 30 + 20 = 50; badge: 25 + 2·10 = 45 → 355 (no milestone with 3 tried)
    check("an old record is back-filled with XP", o["migXp"] == 355 and o["migLvl"] == 4, (o["migXp"], o["migLvl"]))
    check("back-filled unlocks don't toast again", o["migUnl"] == ["title:rookie", "frame:bronze", "pack:animals"], o["migUnl"])
    check("migrate runs once", o["migAgain"] == o["migXp"])
    hard = dict(map(tuple, o["hard"]))
    check("win vs hard ×2, and a long game", hard.get("🏆 Win vs Hard ×2") == 30 and hard.get("⏳ A long game") == 5, o["hard"])
    check("a badge during play waits for the next card", o["pend"] and o["pend"][0][1] == 25, o["pend"])
    ppl = dict(map(tuple, o["people"]))
    check("win vs people ×1.5", ppl.get("🏆 Win vs Easy & vs people ×1.5") == 23, o["people"])
    check("pending badge and a first-time badge on the card", ppl.get("⚡ Quick (first!)") == 25 and ppl.get("🧠 Giant slayer (first!)") == 25 and not o.get("pendGone"), o["people"])
    check("the card starts before the badge XP earned in play", o["from"] == o["xpBefore"] - 25 and o["to"] > o["from"], (o["from"], o["to"], o["xpBefore"]))
    check("a badge after the finish joins the same card", o["late"] == 1)
    check("looks: '' hides the title, a locked frame falls back", o["look"] == {"lvl": 12, "frame": "gold", "title": None}, o["look"])
    check("unlocks by level", o["unlocked"] == [True, False, True, False], o["unlocked"])
    check("a level-up toasts what it opens", any(x.startswith("🆙 Level 15") and "Frost frame" in x for x in o["up15"]), o["up15"])
    frames = {u[2]: u[0] for u in o["unlocks"] if u[1] == "frame"}
    titles = {u[2]: u[0] for u in o["unlocks"] if u[1] == "title"}
    check("server allow-lists mirror UNLOCKS", frames == server.LOOK_FRAMES and titles == server.LOOK_TITLES, (frames, titles))
    room = server.Room("PACK")
    pp = room.add_player("Pat")
    bad = []
    for e in [e for lst in o["packs"].values() for e in lst]:
        try:
            room.set_icon(pp, e)
        except GameError:
            bad.append(e)
    check("every pack emoji is a valid icon", not bad, bad)
    data = "/usr/share/unicode/emoji/emoji-data.txt"
    if os.path.exists(data):
        ver = {}
        for line in open(data, encoding="utf-8"):
            mm = re.match(r"([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*Emoji\s*#\s*E(\d+\.\d+)", line)
            if mm:
                for c in range(int(mm[1], 16), int(mm[2] or mm[1], 16) + 1):
                    ver[c] = float(mm[3])
        new = [e for lst in o["packs"].values() for e in lst if max(ver.get(ord(c), 99) for c in e if ord(c) not in (0xFE0F, 0x200D)) > 12]
        check("pack emoji are Emoji 12 or older (old Android)", not new, new)

# ---------- merge
a = {"xp": 500, "lvl": 5, "since": "2026-11-02", "seen": ["AB:3", "AB:1"], "unl": ["title:rookie"],
     "games": {"chess": {"played": 5, "wins": 2, "best": 10, "stars": 1, "lastAt": "2026-11-10"},
               "hearts": {"played": 3, "wins": 1, "best": 40, "low": True}},
     "badges": {"chess:giant": {"n": 2, "emo": "🧠"}}, "snap": {"AB": {"chess:giant": 2}}}
b = {"xp": 450, "lvl": 4, "since": "2026-11-05", "seen": ["AB:2", "CD:9"], "unl": ["frame:bronze"],
     "games": {"chess": {"played": 4, "wins": 3, "best": 12}, "hearts": {"played": 4, "best": 35}, "go": {"played": 1, "wins": 0}},
     "badges": {"chess:giant": {"n": 1, "emo": "🧠"}, "go:atari": {"n": 1, "emo": "⚫"}}, "snap": {}}
m = server.merge_profile(a, b)
check("merge keeps the larger counts", m["xp"] == 500 and m["games"]["chess"]["played"] == 5 and m["games"]["chess"]["wins"] == 3 and m["games"]["chess"]["stars"] == 1, m["games"]["chess"])
check("merge keeps the better best (low games: smaller)", m["games"]["chess"]["best"] == 12 and m["games"]["hearts"]["best"] == 35, m["games"])
check("merge unions badges, games, seen and unlocks", set(m["badges"]) == {"chess:giant", "go:atari"} and m["badges"]["chess:giant"]["n"] == 2
      and "go" in m["games"] and m["seen"] == ["AB:1", "AB:2", "AB:3", "CD:9"] and set(m["unl"]) == {"title:rookie", "frame:bronze"}, m)
check("an empty snapshot keeps the saved one", m["snap"] == a["snap"] and m["since"] == "2026-11-02")
check("merge is idempotent", server.merge_profile(m, b) == m and server.merge_profile(m, m) == m and server.merge_profile(m, a)["games"] == m["games"])
many = {"seen": [f"R:{i}" for i in range(60)]}
mm = server.merge_profile(many, {"seen": ["R:5"]})
check("seen keeps the 40 newest", len(mm["seen"]) == 40 and mm["seen"][0] == "R:20" and server.merge_profile(mm, {"seen": ["R:5"]}) == mm)

# ---------- the store: key check, size limit, atomic file
dev = {"id": "0123456789abcdef", "key": "k" * 24}
check("get with nothing saved", server.profile_get(dev) == {"profile": {}})
r1 = server.profile_put({**dev, "profile": a})["profile"]
r2 = server.profile_put({**dev, "profile": b})["profile"]
check("put merges with what's saved", r2 == server.merge_profile(r1, b) and r2["xp"] == 500 and "go" in r2["games"])
check("get round-trips", server.profile_get(dev)["profile"] == r2)
saved = json.load(open(os.path.join(server.PROFILE_DIR, dev["id"] + ".json")))
check("the file holds the key's hash, not the key", "k" * 24 not in json.dumps(saved) and len(saved["keyhash"]) == 64)
check("no temp file left", not any(n.endswith(".tmp") for n in os.listdir(server.PROFILE_DIR)))
for name, body in [("a wrong key can't write", {**dev, "key": "x" * 24, "profile": b}), ("or read", {**dev, "key": "x" * 24}),
                   ("a bad id is refused", {"id": "../etc/passwd", "key": "k" * 24, "profile": {}}),
                   ("a record over 64 KB is refused", {**dev, "profile": {"pad": "x" * 65_000}})]:
    try:
        (server.profile_put if "profile" in body else server.profile_get)(body)
        check(name, False)
    except GameError as e:
        check(name, True, str(e))

# ---------- the look action, and old saved rooms
room = server.Room("LOOK")
ann = room.add_player("Ann")
server.Room.ACTIONS["look"](room, ann, {"lvl": 99, "frame": "gold", "title": "legend"})
check("look: the level is clamped to 1–50", ann.look == {"lvl": 50, "frame": "gold", "title": "legend"}, ann.look)
server.Room.ACTIONS["look"](room, ann, {"lvl": 7, "frame": "crown", "title": "rookie"})
check("look: a frame the level hasn't opened is dropped", ann.look == {"lvl": 7, "frame": None, "title": "rookie"}, ann.look)
server.Room.ACTIONS["look"](room, ann, {"lvl": 3, "frame": "<script>", "title": None})
check("look: unknown ids are dropped", ann.look == {"lvl": 3, "frame": None, "title": None})
v = room.view(ann)
check("the player view carries look", v["players"][0]["look"] == ann.look)
del ann.__dict__["look"]
old = pickle.loads(pickle.dumps(room))
check("an old saved room loads with look = None", old.players[ann.id].look is None and old.view(old.players[ann.id])["players"][0]["look"] is None)

# ---------- over HTTP: the routes and the 70 KB body limit for put only
httpd = server.GameServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
port = httpd.server_address[1]


def post(path, body):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    c.request("POST", path, data, {"Content-Type": "application/json"})
    res = c.getresponse()
    out = res.status, json.loads(res.read() or b"{}")
    c.close()
    return out


dev2 = {"id": "fedcba9876543210", "key": "Z" * 24}
st, j = post("/api/profile/put", {**dev2, "profile": {"xp": 42, "games": {}, "pad": "x" * 30_000}})
check("put over HTTP takes a 30 KB record", st == 200 and j["profile"]["xp"] == 42, st)
st, j = post("/api/profile/get", dev2)
check("get over HTTP", st == 200 and j["profile"]["xp"] == 42, st)
st, j = post("/api/profile/get", {**dev2, "key": "Y" * 24})
check("wrong key over HTTP is an error", st == 400 and "another device" in j.get("error", ""), (st, j))
st, _ = post("/api/profile/put", b'{"pad": "' + b"x" * 71_000 + b'"}')
check("a 71 KB put is 413", st == 413, st)
st, _ = post("/api/status", b'{"pad": "' + b"x" * 20_000 + b'"}')
check("other routes keep the 10 KB limit", st == 413, st)
httpd.shutdown()

print("\n" + ("all good" if not fails else f"{len(fails)} failed: {fails}"))
sys.exit(1 if fails else 0)
