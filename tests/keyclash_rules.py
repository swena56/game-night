"""⌨️ Key Clash rules (#374), on real rooms.

    python3 tests/keyclash_rules.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import GameError  # noqa: E402
from games import keyclash as kc  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(names=("Ann", "Bo"), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in names]
    r.switch_game("keyclash")
    r.settings.update(settings)
    with r.cond:
        r.start()
    g = r.game
    for p in ps:
        p.g.last_at -= 60   # nobody is typing "too fast" in these tests
    return r, g, ps


def refused(fn):
    try:
        fn()
    except GameError:
        return True
    return False


def type_next(g, p, errs=0):
    p.g.last_at -= 60
    g.act(p, {"type": "word", "i": p.g.idx, "word": g.words[p.g.idx], "errs": errs})


# a word typed right is counted and hits the rival; longer words hit harder
r, g, (a, b) = room()
w = g.words[0]
type_next(g, a)
check("a right word moves on", a.g.idx == 1 and a.g.words == 1)
check("and hits the rival", b.g.hp == kc.HP - max(1, round(len(w) * 0.5 * 1.06)), f"hp {b.g.hp}, word {w!r}")
check("a wrong word is refused", refused(lambda: g.act(a, {"type": "word", "i": a.g.idx, "word": "zzzz", "errs": 0})))
check("an old word is refused", refused(lambda: g.act(a, {"type": "word", "i": 0, "word": g.words[0], "errs": 0})))
check("a bad typo count is refused", refused(lambda: g.act(a, {"type": "word", "i": a.g.idx, "word": g.words[a.g.idx], "errs": -1})))
a.g.last_at = g.now()
check("inhumanly fast typing is refused", refused(lambda: g.act(a, {"type": "word", "i": a.g.idx, "word": g.words[a.g.idx], "errs": 0})))

for mode in ("duel", "race", "hyper", "tug"):
    _, game, (player, rival) = room(mode=mode)
    game.words[:2] = ["test", "next"]
    type_next(game, player)
    stats = player.g
    stats.last_at -= 60
    skip = {"type": "skip", "rid": game.view(player)["keyclash"]["rid"],
            "number": 2, "i": 1, "word": "nexz", "errs": 4}
    if mode == "duel":
        invalid = ({"word": "nex"}, {"word": "next"}, {"word": "ne?t"}, {"rid": None},
                   {"rid": "another round"}, {"number": None}, {"number": 3}, {"i": 0},
                   {"power": "shield"})
        check("skip rejects invalid attempts and stale or missing bindings",
              all(refused(lambda: game.act(player, {**skip, **change})) for change in invalid))
    previous = (stats.chars, stats.charge, stats.dist, rival.g.hp, game.rope, len(game.events))
    game.act(player, skip)
    check(f"{mode}: skip advances the stream and acknowledgement, keeping accuracy errors",
          stats.idx == 2 and stats.words == 2 and stats.errs == 4 and stats.combo == 0)
    check(f"{mode}: skip grants no WPM, damage, energy or mode progress",
          previous == (stats.chars, stats.charge, stats.dist, rival.g.hp, game.rope, len(game.events)))
    check(f"{mode}: duplicate skip is refused", refused(lambda: game.act(player, skip)) and stats.errs == 4)

    game.words[2] = "test"
    stats.last_at -= 60
    game.act(player, {**skip, "number": 3, "i": 2, "word": "tastz", "errs": 0})
    check(f"{mode}: skip records unreported substitutions and extra letters", stats.errs == 6)
    game.round_over([player])
    check(f"{mode}: the round report only counts completed words",
          game.history[-1]["stats"][player.id]["words"] == 1)

# combo: perfect words build it, a typo breaks it
for _ in range(3):
    type_next(g, a)
check("perfect words build a combo", a.g.combo == 4, str(a.g.combo))
type_next(g, a, errs=2)
check("a typo breaks it", a.g.combo == 0 and a.g.errs == 2)

# a full charge offers power words; typing one fires it
a.g.charge = kc.CHARGE - 1
type_next(g, a)
check("a full charge offers three power words", a.g.offer and set(a.g.offer) == {"shield", "strike", "heal"})
a.g.hp = 50
a.g.last_at -= 60
g.act(a, {"type": "word", "word": a.g.offer["heal"], "errs": 0})
check("typing the heal word heals", a.g.hp == 50 + kc.HEAL and a.g.offer is None and a.g.charge == 0, str(a.g.hp))

# a shield soaks the next hits
b.g.shield = 5
hp = b.g.hp
g.hit(a, b, 8, "hit")
check("a shield soaks damage", b.g.hp == hp - 3 and b.g.shield == 0)
check("the screens see what the shield took", [e["kind"] for e in g.events[-2:]] == ["soak", "hit"] and g.events[-2]["dmg"] == 5)
b.g.shield = 10
g.hit(a, b, 4, "hit")
check("a shield that takes all of a hit is a block", g.events[-1]["kind"] == "block" and g.events[-1]["dmg"] == 4 and b.g.shield == 6)
b.g.shield = 0

# a knock-out ends the round; winning the match takes most rounds
b.g.hp = 1
type_next(g, a)
check("a knock-out ends the round", g.stage == "reveal" and a.g.wins == 1 and g.result["winner"] == a.id)
check("nobody can type in the reveal", refused(lambda: type_next(g, a)))
g.end = g.now()
g.process()
check("the next round starts fresh", g.stage == "play" and g.round == 2 and b.g.hp == kc.HP and a.g.idx == 0)
b.g.hp = 1
type_next(g, a)
g.end = g.now()
g.process()
check("two round wins take a best of three", r.phase == "over", r.phase)

# the clock: the healthiest fighter takes the round
r, g, (a, b) = room()
b.g.hp = 60
g.end = g.now()
g.process()
check("time up: more health wins", g.stage == "reveal" and g.result["winner"] == a.id)

# Pure Typing: no fighting, the most letters typed right wins
r, g, (a, b, c) = room(("Ann", "Bo", "Cy"), mode="race")
for _ in range(3):
    type_next(g, b)
check("pure typing deals no damage", all(p.g.hp == kc.HP for p in (a, b, c)) and not b.g.offer)
g.end = g.now()
g.process()
check("pure typing: most letters wins", g.result["winner"] == b.id)

# Last Typist Standing: you hit back whoever hit you last
r, g, (a, b, c) = room(("Ann", "Bo", "Cy"), mode="lms")
g.hit(c, a, 5, "hit")
check("revenge target", g.target(a).id == c.id)
c.g.ko = True
check("a knocked-out rival is no target", g.target(a).id == b.id)
check("knocked out can't type", refused(lambda: type_next(g, c)))

# 🏰 Castle Siege: a word sends soldiers; soldiers past halfway on their way to you are cut down first
r, g, (a, b) = room(mode="siege")
type_next(g, a)
check("siege: a word sends soldiers", len(g.armies) == 1 and g.armies[0]["to"] == b.id and b.g.hp == kc.HP)
g.skew += kc.MARCH * 0.6
p0 = g.armies[0]["power"]
type_next(g, b)
check("siege: a word cuts down close soldiers first", not g.armies or g.armies[0]["power"] < p0 or g.armies[0]["by"] == b.id)
r, g, (a, b) = room(mode="siege")
type_next(g, a)
g.skew += kc.MARCH + 0.1
g.process()
check("siege: soldiers that arrive hit the castle", b.g.hp < kc.HP and not [x for x in g.armies if x["by"] == a.id], str(b.g.hp))

# 🧟 Survival: the same enemies for everyone; words hit your front one; ones that arrive bite
r, g, (a, b) = room(mode="survival")
f0 = g.foes[0]
check("survival: waves are planned", len(g.foes) > 10 and f0["wave"] == 1)
g.skew += f0["spawn"] - g.now() + 0.1
type_next(g, a)
check("survival: a word hits the front enemy", a.g.foe_hp.get(0, f0["hp"]) < f0["hp"] and b.g.foe_hp == {})
a_stopped = a.g.foe_hp.get(0) == 0
g.skew += f0["arrive"] - g.now() + 0.01
g.process()
check("survival: an enemy that arrives bites whoever didn't stop it", b.g.hp < kc.HP and (a.g.hp == kc.HP) == a_stopped,
      f"a stopped it: {a_stopped}, a {a.g.hp}, b {b.g.hp}")

# 👹 Boss Rush: the boss hits back on a beat; beating it wins the round
r, g, (a, b) = room(mode="boss")
g.skew += kc.BOSS_EVERY + 0.01
g.process()
check("boss: the boss hits everyone on its beat", a.g.hp == b.g.hp == kc.HP - kc.BOSS_HIT)
a.g.boss = 1
type_next(g, a)
check("boss: beating your boss wins the round", g.stage == "reveal" and g.result["winner"] == a.id)

# 🚀 Hyperdrive: first over the line
r, g, (a, b) = room(mode="hyper")
type_next(g, a)
check("hyper: words fly you forward", 0 < a.g.dist < kc.TRACK and b.g.hp == kc.HP)
a.g.dist = kc.TRACK - 0.5
type_next(g, a)
check("hyper: crossing the line wins the round", g.stage == "reveal" and g.result["winner"] == a.id)

# 🪢 Tug-of-War: teams alternate; the rope over the line wins the round for the whole team
r, g, (a, b, c) = room(("Ann", "Bo", "Cy"), mode="tug")
check("tug: seats alternate teams", (a.g.team, b.g.team, c.g.team) == (0, 1, 0))
type_next(g, b)
pull_b = g.rope
r2, g2, (a2, b2, c2) = room(("Ann", "Bo", "Cy"), mode="tug")
g2.words[0] = g.words[0]
type_next(g2, a2)
check("tug: a team of one pulls as hard as a team of two", pull_b > 0 and abs(abs(g2.rope) * 2 - pull_b) < 0.01, f"{pull_b} vs {g2.rope}")
g.rope = -kc.ROPE + 0.1
type_next(g, a)
check("tug: over the line wins for the team", g.stage == "reveal" and set(g.result["winners"]) == {a.id, c.id} and a.g.wins == c.g.wins == 1)

# (#379) no time limit: rounds run to a winner; Pure Typing races to a goal; overtime breaks stalemates
r, g, (a, b) = room(mode="race", secs=0)
check("no limit: the round runs long", g.end - g.t0 >= kc.NO_LIMIT and g.view(a)["keyclash"]["unlimited"])
a.g.chars = kc.RACE_GOAL - 1
type_next(g, a)
check("no limit: pure typing is a race to the goal", g.stage == "reveal" and g.result["winner"] == a.id)
r, g, (a, b) = room(secs=0)
a.g.idx = len(g.words) - 5
n = len(g.words)
type_next(g, a)
check("no limit: the word stream goes on", len(g.words) > n and len(g.view(a)["keyclash"]["words"]) == kc.WINDOW)
r, g, (a, b) = room(mode="siege", secs=0)
check("no overtime yet", not g.overtime and g.surge() == 1)
g.skew += kc.OVERTIME + 60.01
g.process()
check("overtime starts on time and hits grow", g.overtime and abs(g.surge() - 1.5) < 0.01, str(g.surge()))
type_next(g, b)
g.skew += kc.MARCH * 0.6
p0 = [x["power"] for x in g.armies if x["by"] == b.id]
type_next(g, a)
check("overtime: castles stop cutting soldiers down", [x["power"] for x in g.armies if x["by"] == b.id] == p0)
r, g, (a, b) = room(mode="tug", secs=0)
g.skew += kc.OVERTIME + 120.01
g.process()
check("overtime: the tug lines creep in", abs(g.rope_line() - kc.ROPE * 0.5) < 0.1, str(g.rope_line()))
r, g, (a, b) = room(mode="tug")
check("a timed round has no overtime", not any(t[1] == "overtime" for t in g.timers))

# (#383) while paused the clock stands still in the view
r, g, (a, b) = room()
import time as _time
from unittest import mock
r.paused = _time.time()
left = g.view(a)["keyclash"]["left"]
with mock.patch.object(kc.time, "time", return_value=_time.time() + 5):   # five seconds pass on the wall clock
    check("paused: the clock stands still", abs(g.view(a)["keyclash"]["left"] - left) < 0.01)
    r.paused = 0
    check("unpaused: it runs", g.view(a)["keyclash"]["left"] < left - 4)

# a rematch is a new game: the screen keys on it
r, g, (a, b) = room()
rid = g.view(a)["keyclash"]["rid"]
g.gid = "later"
check("view: a new game changes the round key", g.view(a)["keyclash"]["rid"] != rid)

# a Duel is for two
r = server.Room("TEST")
for n in ("Ann", "Bo", "Cy"):
    r.add_player(n)
r.switch_game("keyclash")
check("a Duel refuses three", refused(lambda: kc.KeyClash(r).check_players(list(r.players.values()))))

# views never fail and send a window of the stream from where the viewer is
r, g, (a, b) = room()
type_next(g, a)
v = g.view(a)["keyclash"]
check("view: stream from the viewer's word", v["base"] == 1 and v["words"][0] == g.words[1] and len(v["words"]) == kc.WINDOW)

# Queued submissions cannot be replayed against a later round or consume two power offers.
r, g, (a, b) = room(rounds=3)
g.words[0] = "guard"
a.g.offer = {"shield": "guard"}
rid = g.view(a)["keyclash"]["rid"]
ordinary = {"type": "word", "rid": rid, "number": 1, "i": 0, "word": "guard", "errs": 1}
g.act(a, ordinary)
view = g.view(a)["keyclash"]
check("numbered stream word takes precedence when power was not requested", a.g.idx == 1 and a.g.offer and b.g.hp < kc.HP)
check("view exposes the exact recorded error count", view["fighters"][0]["errors"] == 1)
check("a duplicate numbered stream word is rejected", refused(lambda: g.act(a, ordinary)))
a.g.last_at -= 60
power = {**ordinary, "number": 2, "i": 1, "power": "shield", "errs": 0}
g.act(a, power)
check("a numbered power word does not advance the stream", a.g.idx == 1 and a.g.shield == kc.SHIELD)
a.g.offer = {"shield": "guard"}
a.g.last_at -= 60
check("a duplicate power word cannot consume another offer", refused(lambda: g.act(a, power)) and a.g.offer is not None)
g.next_round()
g.words[0] = "guard"
a.g.last_at -= 60
check("a queued word cannot land in a later round", refused(lambda: g.act(a, ordinary)) and a.g.idx == 0)

# Results and scheduled events reported in #401–#406.
r, g, team = room(("Ann", "Bo", "Cam", "Dee"), mode="tug", rounds=1)
with r.cond:
    g.round_over(team[::2])
    g.next_match_step()
check("each winning teammate earns win and streak credit",
      all(p.wins == p.streak == 1 and p.last_pts == server.POINTS_WIN for p in team[::2])
      and set(r.history[-1]["teamWinnerIds"]) == {p.id for p in team[::2]})

for reveal in (False, True):
    r, g, team = room(("Ann", "Bo", "Cam"), mode="tug", rounds=3)
    with r.cond:
        if reveal:
            g.round_over([])
        g.on_leave(team[1])
    check(f"team forfeit ends the match immediately (recap={reveal})",
          r.phase == "over" and g.round == 1 and "forfeit" in r.history[-1]["text"]
          and set(r.history[-1]["teamWinnerIds"]) == {team[0].id, team[2].id})

for event in ("boss", "army", "foe", "bot"):
    r, g, (a, b) = room(mode="boss")
    g.end = g.now() - 1
    g.timers = []
    processed = []
    g.fire = lambda kind, data: processed.append(kind)
    if event == "bot":
        g.plans = [(g.end + offset, a.id, (None, g.words[0]), False) for offset in (-0.1, 0, 0.1)]
        g.typed = lambda *args: processed.append("bot")
        g.plan = lambda p: None
    else:
        for offset in (-0.1, 0, 0.1):
            g.timer(g.end + offset, event, None)
    with r.cond:
        g.process()
    check(f"late tick counts only {event} events strictly before the deadline",
          processed == [event] and g.stage == "reveal")

for cutoff, attacks in ((2 * kc.BOSS_EVERY, 1), (2 * kc.BOSS_EVERY + 0.1, 2)):
    r, g, (a, b) = room(mode="boss")
    g.timers = [(g.t0 + kc.BOSS_EVERY, "boss", None)]
    g.end = g.t0 + cutoff
    g.skew += cutoff + 1
    g.process()
    check(f"late boss tick applies {attacks} scheduled attacks before the cutoff",
          a.g.hp == b.g.hp == kc.HP - attacks * kc.BOSS_HIT)

r, g, (a, b) = room(mode="boss", secs=0)
g.timers = []
g.timer(g.now() + 1, "overtime", None)
g.timer(g.now() + 5, "boss", None)
check("boss countdown ignores overtime", 4.5 < g.view(a)["keyclash"]["bossIn"] <= 5)

r, g, (a, b) = room(mode="race", rounds=1)
a.g.chars_total, a.g.errs_total, b.g.chars_total = 130, 5, 100
with r.cond:
    g.finish_game()
check("Pure Typing breaks a tie using typing totals", r.winner == a.id and "130 letters" in r.history[-1]["text"])
check("round status exposes the draw cutoff", g.view(a)["keyclash"]["maxRounds"] == 3)

r = server.Room("TEST")
a, b, c = [r.add_player(name) for name in ("Ann", "Bo", "Cam")]
r.switch_game("keyclash")
r.change_settings(a, {"mode": "tug"})
r.change_settings(a, {"tug_team": {"id": a.id, "side": 1}})
r.change_settings(a, {"tug_team": {"id": b.id, "side": 1}})
preview = r.view(a)["keyclashTeams"]
check("Tug lobby honors fixed teams and balances automatic seats",
      preview == {a.id: 1, b.id: 1, c.id: 0})
r.change_settings(a, {"tug_team": {"id": c.id, "side": 1}})
check("Tug rejects a roster with an empty team", refused(r.start))
r.change_settings(a, {"tug_team": {"id": c.id, "side": None}})
with r.cond:
    r.start()
check("the match uses the lobby's team preview", {p.id: p.g.team for p in (a, b, c)} == preview)

r, g, (a, b) = room(round_ready="ready")
ready_action = {"type": "clash_ready", "rid": g.view(a)["keyclash"]["rid"]}
check("ready stage has no active typing or running match clock",
      g.stage == "ready" and not g.view(a)["keyclash"]["playing"] and refused(lambda: type_next(g, a)))
g.act(a, ready_action)
check("one typist's confirmation leaves the other typist time to focus",
      g.stage == "ready" and g.view(b)["keyclash"]["readyCount"] == 1)
g.act(b, ready_action)
check("all typists ready starts the countdown", g.stage == "countdown")
g.skew += kc.COUNTDOWN_SECS + 1
g.process()
check("the round clock starts after the countdown",
      g.stage == "play" and g.view(a)["keyclash"]["left"] >= 59.9 and a.g.last_at == g.t0)
with r.cond:
    g.round_over([a])
    g.next_match_step()
check("the next round needs fresh confirmation", g.stage == "ready" and not g.round_ready)
check("confirmation from a prior round is rejected", refused(lambda: g.act(a, ready_action)))
g.skew += kc.READY_SECS + 1
g.process()
check("missing confirmations advance after the ready timeout", g.stage == "countdown")

print("\n" + ("keyclash rules OK" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
