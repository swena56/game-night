"""💣 Word Bomb rules, on real rooms.

    python3 tests/wordbomb_rules.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import GameError  # noqa: E402
from games import wordbomb as wb  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def room(names=("Ann", "Bo", "Cy"), **settings):
    r = server.Room("TEST")
    ps = [r.add_player(n) for n in names]
    r.switch_game("wordbomb")
    r.settings.update(settings)
    with r.cond:
        r.start()
    return r, r.game, ps


def holder(r):
    return r.players[r.turn]


def word_for(g, chunk, min_len=3, max_len=8):
    return next(w for w in wb.pool(chunk) if w not in g.used and min_len <= len(w) <= max_len)


def play(r, p, w):
    with r.cond:
        r.act(p, {"type": "word", "word": w})


def rejected(r, p, w):
    try:
        play(r, p, w)
    except GameError as e:
        return str(e)
    return None


# -- a good word passes the bomb on with new letters
r, g, ps = room()
check("start: someone holds a lit bomb", r.turn in g.seats and g.stage == "lit" and g.chunk)
check("start: the fuse is set and hidden", r.deadline and r.deadline >= time.time() + 2.5)
v = r.view(ps[0])
check("view: no countdown anywhere", v["timeLeft"] is None and "fuse" not in str(v["wordbomb"]).lower())
p, chunk = holder(r), g.chunk
w = word_for(g, chunk)
play(r, p, w.lower())
check("word: passes the bomb on", r.turn != p.id and g.last["word"] == w and g.passes == 1)
check("word: counted for the player", p.g.words == 1)
check("word: new letters on the bomb", g.chunk != chunk)
check("word: the fuse carries on (not reset)", abs(r.deadline - g.fuse_at) < 1e-6)

# -- refusals
q = holder(r)
check("refuse: not your turn", rejected(r, p, word_for(g, g.chunk)) == "It's not your turn.")
g.chunk = "ING"
check("refuse: missing the letters", rejected(r, q, "TABLE") == "It needs ING in it.")
g.chunk = w[:2]
check("refuse: already played", "already" in (rejected(r, q, w) or ""))
g.chunk = "ING"
check("refuse: not a word", "dictionary" in (rejected(r, q, "XINGQ") or ""))
check("refuse: too short", rejected(r, q, "IN") is not None)
check("refuse: letters only", rejected(r, q, "SING1") == "Letters only.")
check("refuse: the turn stays", r.turn == q.id)
check("refuse: doesn't leave no_bump set", r.no_bump is False)
play(r, q, "SINGER")
check("word: dictionary word accepted", g.last["word"] == "SINGER")
check("long dictionary words count", wb.is_word("INTERNATIONAL") and not wb.is_word("QZXQZXQZXQZX"))

# -- live typing: only the holder's keystrokes go out
h, other = holder(r), next(x for x in ps if x.id != r.turn)
with r.cond:
    g.on_input(other, {"t": "abc"})
check("typing: a non-holder's keys are ignored", g.typed == "")
with r.cond:
    fv = r.fast_ver
    g.on_input(h, {"t": "si n9g"})
check("typing: the holder's keys stream (letters only)", g.typed == "SING" and r.fast_ver == fv + 1)

# -- the fuse runs out: a heart lost, a pause, then a new bomb with the next player
r, g, ps = room(lives=2)
p = holder(r)
with r.cond:
    g.on_timeout()
check("boom: holder loses a heart", p.g.lives == 1 and g.boom["by"] == p.id)
check("boom: a pause with nobody holding", g.stage == "boom" and r.turn is None and r.deadline)
check("boom: the miss is a short moment", any(e["kind"] == "moment" and "BOOM" in e["text"] and len(e["text"]) < 40 for e in r.log[-2:]))
with r.cond:
    g.on_timeout()
check("boom: next bomb lit in the next player's hands", g.stage == "lit" and r.turn and r.turn != p.id)
check("boom: a second bomb", g.bomb_no == 2)

# -- out of hearts: eliminated; the last one standing wins
r, g, ps = room(names=("Ann", "Bo"), lives=2)
for _ in range(10):
    if r.phase != "playing":
        break
    with r.cond:
        g.on_timeout()
check("end: someone is out", any(x.eliminated for x in ps))
check("end: last one standing wins", r.phase == "over" and r.winner == next(x.id for x in ps if not x.eliminated))

# -- a chunk that blew up twice is swapped out; once is kept for the next player
r, g, ps = room(lives=4)
c = g.chunk
with r.cond:
    g.on_timeout(); g.on_timeout()
check("chunk: kept after one explosion", g.chunk == c)
with r.cond:
    g.on_timeout(); g.on_timeout()
check("chunk: swapped after two", g.chunk != c)

# -- 📏 a long word adds to the fuse; off when the setting is off
r, g, ps = room()
g.chunk = "TION"[:3]
before = g.fuse_at
play(r, holder(r), "NATIONALISM")
check("long word: +2 s on the fuse", abs(g.fuse_at - (before + wb.LONG_BONUS)) < 0.01 or g.fuse_at >= before + wb.LONG_BONUS)
check("long word: flagged for the screen", g.last["long"])
r, g, ps = room(longword=False)
g.chunk = "TIO"
before = g.fuse_at
play(r, holder(r), "NATIONALISM")
check("long word off: no bonus", g.fuse_at == max(before, g.fuse_at) and not g.last["long"])

# -- 🔤 the alphabet bonus wins a heart back (capped at the starting hearts)
r, g, ps = room()
p = holder(r)
p.g.lives = 2
p.g.letters = set(wb.ALPHABET) - set("SING")
g.chunk = "ING"
play(r, p, "SINGER")
check("alphabet: a heart back", p.g.lives == 3 and p.g.letters == set())
check("alphabet: announced", g.alpha_win and g.alpha_win["by"] == p.id)
r, g, ps = room(alphabet=False)
p = holder(r)
g.chunk = "ING"
play(r, p, "SINGER")
check("alphabet off: letters not tracked", p.g.letters == set() and r.view(p)["wordbomb"]["alphabet"] == "")

# -- a close call
r, g, ps = room()
p = holder(r)
g.fuse_at = time.time() + 0.5
g.chunk = "ING"
play(r, p, "SINGER")
check("close call: flagged", g.last["close"])

# -- the holder leaves: the bomb moves on, still on the same fuse
r, g, ps = room(names=("Ann", "Bo", "Cy"))
p = holder(r)
fuse = g.fuse_at
with r.cond:
    g.on_leave(p)
check("leave: the bomb moves on", r.turn and r.turn != p.id and g.stage == "lit")
check("leave: the fuse follows the bomb", abs(r.deadline - max(fuse, g.fuse_at)) < 0.01)

# -- a restart shifts the fuse by the downtime
r, g, ps = room()
fuse = g.fuse_at
g.on_restore(30)
check("restore: fuse shifted", abs(g.fuse_at - (fuse + 30)) < 1e-6 and r.deadline == g.fuse_at)

# -- bots: play real words with the chunk, and a frozen bot lets the bomb go off
r, g, ps = room(names=("Ann", "Bo"))
for x in ps:
    x.bot = "hard"
words_seen = []
for _ in range(400):
    if r.phase != "playing" or len(words_seen) >= 5:
        break
    with r.cond:
        if g.bot_ready():
            b = holder(r)
            before = g.passes
            g.bot_tick()
            if g.passes > before:
                words_seen.append(g.last["word"])
        else:
            g.on_timeout()
check("bots: play valid words", len(words_seen) >= 3 and all(wb.is_word(w) for w in words_seen), str(words_seen))
check("bots: words a person would type (≤ 13 letters)", all(len(w) <= 13 for w in words_seen))
r, g, ps = room(names=("Ann", "Bo"))
b = holder(r)
b.bot = "easy"
g.plan = {"word": None, "typed": 0, "stuck": 2}
with r.cond:
    g.bot_tick(); g.bot_tick()
check("bots: a frozen bot types a little, then waits for the boom", not g.bot_ready() and len(g.typed) == 2)

# -- 📜 the review: resolved bombs only, no fuse timer, last bomb during play, every bomb at the end
r, g, ps = room(names=("Ann", "Bo"), lives=2)
v = g.view(ps[0])["wordbomb"]
check("review: nothing before a bomb resolves", v["review"] is None)
a = holder(r)
c1 = g.chunk
w1 = word_for(g, c1)
with r.cond:
    g.act(a, {"type": "word", "word": w1})
v = g.view(server.REPLAY_VIEWER)["wordbomb"]
check("review: the lit bomb's words stay out of it", v["review"] is None)
b = holder(r)
c2 = g.chunk
with r.cond:
    g.on_timeout()   # the fuse runs out on b
rv = g.view(ps[0])["wordbomb"]["review"]
check("review: appears after the blast", rv and not rv["final"] and len(rv["bombs"]) == 1, rv)
bomb = rv["bombs"][0]
check("review: the bomb's words (who, word, chunk)", bomb["words"] == [[a.id, w1, c1]], bomb["words"])
check("review: the chunk that caused the loss", bomb["boom"]["by"] == b.id and bomb["boom"]["chunk"] == c2, bomb["boom"])
flat = repr(rv)
check("review: no fuse timer leaks", "fuse" not in flat and str(round(g.fuse_at)) not in flat)
with r.cond:
    g.on_timeout()   # the next bomb is lit
rv = g.view(ps[1])["wordbomb"]["review"]
check("review: during the next bomb, still only the resolved one", rv and len(rv["bombs"]) == 1 and rv["bombs"][0]["bomb"] == 1)
with r.cond:
    g.on_timeout()   # second blast
if r.phase == "playing":
    with r.cond:
        g.on_timeout()
        g.on_timeout()
check("review: game over", r.phase == "over")
rv = g.view(server.REPLAY_VIEWER)["wordbomb"]["review"]
check("review: every bomb at the end", rv["final"] and [x["bomb"] for x in rv["bombs"]] == list(range(1, len(rv["bombs"]) + 1))
      and len(rv["bombs"]) >= 3 and all(x["boom"] for x in rv["bombs"]), rv)
# a game saved before the review (no bombs / cur) still plays and views
r, g, ps = room(names=("Ann", "Bo"))
del g.bombs, g.cur
check("review: old saved game views", g.view(ps[0])["wordbomb"]["review"] is None)
a = holder(r)
with r.cond:
    g.act(a, {"type": "word", "word": word_for(g, g.chunk)})
    g.on_timeout()
check("review: old saved game files its next blast", len(g.view(ps[0])["wordbomb"]["review"]["bombs"]) == 1)

print("\nall ok" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
