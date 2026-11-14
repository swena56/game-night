"""Word Garden rules on real rooms: crossword layouts are valid, the view never shows letters you haven't
found, garden and bonus words score, wrong words cost nothing, 💧 hints reveal letters (and complete words
for no points), drops are earned by bonus words, finishers keep hunting bonus words, no-clock rounds wait.

    python3 tests/garden_rules.py        # a few seconds
"""
import json
import os
import random
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402
from games import garden as G  # noqa: E402
from games.base import GameError  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        fails.append(name)


def refused(name, fn):
    try:
        fn()
        check(name, False, "was allowed")
    except GameError as e:
        check(name, True, str(e))


def room_for(bots=(), **settings):
    room = server.Room("TEST")
    ann = room.add_player("Ann")
    for lvl in bots:
        room.add_bot(lvl)
    room.switch_game("garden")
    room.settings.update(settings)
    room.start()
    return room, ann


def valid_layout(slots):
    """Every run of 2+ letters in the grid is exactly one of the slots."""
    cells = {}
    for s in slots:
        for k, at in enumerate(G.slot_cells(s)):
            if cells.setdefault(at, s[0][k]) != s[0][k]:
                return False
    runs = set()
    for across in (True, False):
        for (r, c) in cells:
            prev = (r, c - 1) if across else (r - 1, c)
            if prev in cells:
                continue
            w, at = "", (r, c)
            while at in cells:
                w += cells[at]
                at = (at[0], at[1] + 1) if across else (at[0] + 1, at[1])
            if len(w) > 1:
                runs.add((w, r, c, across))
    return runs == {tuple(s) for s in slots}


# -- layouts
rng = random.Random(7)
bad = 0
for n in (5, 6, 7):
    for base, subs in G.bases()[n][:40]:
        slots, h, w = G.layout(rng, base, subs, G.TARGET[n])
        if not valid_layout(slots) or h > G.MAX_SIDE or w > G.MAX_SIDE or slots[0][0] != base:
            bad += 1
        if any(not G.can_make(s[0], Counter(base)) for s in slots):
            bad += 1
check("layouts are proper crosswords within 10×10 from the ring's letters", bad == 0, f"{bad} bad")
sizes = [len(G.layout(rng, b, s, G.TARGET[6])[0]) for b, s in G.bases()[6][:30]]
check("6-letter gardens usually reach their target", sum(x >= G.TARGET[6] for x in sizes) >= 24, str(sizes))

# -- a solo garden
room, ann = room_for()
g = room.game
st = g.st[ann.id]
v = g.view(ann)["garden"]
known = {ch for row in v["grid"] for ch in row if ch}
check("nothing shows before any word is found", not known, str(known))
check("ring is the base word scrambled", sorted(v["ring"]) == sorted(g.base) and v["ring"] != g.base)
check("answers aren't in the view", all(s[4] is None for s in v["slots"]) and v["base"] is None)
check("no clock by default", not v["clock"] and g.end - g.now() > 3600)

short = min(g.answers, key=len)
room.act(ann, {"type": "word", "word": short.lower()})
check("garden word fills in and scores a point a letter", short in st["found"] and st["pts"][short] == len(short))
before = json.dumps(st)
room.act(ann, {"type": "word", "word": short})
check("saying it again is gentle", st["last"]["kind"] == "again")
refused("non-word refused", lambda: room.act(ann, {"type": "word", "word": g.ring[:3][::-1] + "QQ"}))
fake = "".join(sorted(g.ring))
if fake not in G.words():
    room.act(ann, {"type": "word", "word": fake})
    check("a jumble of the ring gets a quiet 'not a word' note", st["last"]["kind"] == "nope" and fake not in st["bonus"])
refused("two letters is too short", lambda: room.act(ann, {"type": "word", "word": g.ring[:2]}))
refused("junk input refused", lambda: room.act(ann, {"type": "word", "word": ["X"]}))
refused("non-letters refused", lambda: room.act(ann, {"type": "word", "word": "AB1"}))

bonus = sorted(g.bonus_all)[:G.DROP_EVERY]
drops = ann.g.drops
for w in bonus:
    room.act(ann, {"type": "word", "word": w})
check("bonus words are kept", st["bonus"] == bonus, str(bonus))
check(f"{G.DROP_EVERY} bonus words earn a drop", ann.g.drops == drops + 1)

drops = ann.g.drops
room.act(ann, {"type": "hint"})
check("hint spends a drop and shows a letter", ann.g.drops == drops - 1 and len(st["shown"]) == 1)
r, c = st["shown"][0]
v = g.view(ann)["garden"]
check("hinted letter is in the view", v["grid"][r][c] == g.letter(r, c))
hinted_word = next(s[0] for s in g.slots if (r, c) in G.slot_cells(s) and s[0] not in st["found"])
room.act(ann, {"type": "word", "word": hinted_word})
check("a hinted letter scores nothing", st["pts"][hinted_word] == len(hinted_word) - 1)
ann.g.drops = 0
refused("no drops, no hint", lambda: room.act(ann, {"type": "hint"}))

for w in g.answers:
    if w not in st["found"]:
        room.act(ann, {"type": "word", "word": w})
check("finishing the garden ends a solo round", g.stage == "reveal" and ann.id in g.done)

# -- hints that complete a word count it as found, for no points
room, ann = room_for()
g, st = room.game, room.game.st[ann.id]
ann.g.drops = 99
for _ in range(200):
    if g.stage != "play":
        break
    room.act(ann, {"type": "hint"})
check("hints alone can grow the garden", g.stage == "reveal" and all(v == 0 for v in st["pts"].values()))
check("a fully hinted round scores only the clear bonus", g.gained[ann.id] == 10, str(g.gained))

# -- with company: finishers keep finding bonus words, the round waits for the rest
room, ann = room_for(bots=("easy",))
g = room.game
bot = next(p for p in room.seated() if p.bot)
g.plans = []
for w in g.answers:
    room.act(ann, {"type": "word", "word": w})
check("round waits for the others (no clock)", g.stage == "play" and ann.id in g.done)
extra = next(w for w in sorted(g.bonus_all))
room.act(ann, {"type": "word", "word": extra})
check("a finisher can still find bonus words", extra in g.st[ann.id]["bonus"])
refused("a finisher can't use hints", lambda: room.act(ann, {"type": "hint"}))
check("no first-finisher bonus", g.first_bonus == 0)
v = g.view(bot)["garden"]
check("a rival's view doesn't show my letters", not any(ch for row in v["grid"] for ch in row))
check("missing bot plan gets rescheduled", g.bot_ready())
g.process()
check("bot is back on the schedule", any(pid == bot.id for _, pid in g.plans))
for _ in range(400):
    if g.stage != "play":
        break
    g.on_timeout()
check("the bot finishes and the garden is revealed", g.stage == "reveal")
v = g.view(ann)["garden"]
check("after the round every word shows", all(s[4] for s in v["slots"]) and v["base"] == g.base)
json.dumps(room.state_for(ann) if hasattr(room, "state_for") else v)

print("\nALL OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
