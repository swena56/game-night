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

print("\n" + ("keyclash rules OK" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
