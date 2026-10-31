"""Scribble Relay: everyone writes a phrase, then the chains go round the table, alternating
drawing and captioning, on everyone's own phone. At the end each chain is revealed and everyone
votes for their favourite entry."""
import random
import time

from .base import Game, GameError
from .doodle_art import DRAWINGS
from .textmatch import words

STEP_SECS = {"write": 50, "draw": 80, "caption": 40}
SHOW_SECS, SHOW_PER_ENTRY = 25, 3
COLORS = 6
MAX_STROKES, MAX_INTS = 300, 2400
ADJECTIVES = ["a sleepy", "a giant", "a tiny", "a dancing", "an angry", "a happy", "a flying", "a spooky",
              "a fancy", "a lonely", "a sneaky", "a royal", "a confused", "a brave", "a very fast"]
STOP = {"a", "an", "the", "of", "on", "in", "with", "and", "very", "my", "is", "at", "to"}


def mentions(text, name):
    """True if the words of `name` appear in order in `text` (ignoring plurals)."""
    tw, nw = words(text), words(name)
    return bool(nw) and any(tw[i:i + len(nw)] == nw for i in range(len(tw) - len(nw) + 1))


def stroke_path(pts):
    d = f"M{pts[0]} {pts[1]}"
    for k in range(2, len(pts), 2):
        d += f"L{pts[k]} {pts[k + 1]}"
    return d if len(pts) > 2 else d + f"L{pts[0]} {pts[1] + 0.1}"  # a dot


class Relay(Game):
    id = "relay"
    category = "party"
    howto = [
        "Everyone writes a phrase to start their own chain.",
        "Chains pass around the table: draw the phrase you get, then caption the drawing you get, and so on.",
        "You only ever see the entry just before yours.",
        "At the end, each chain is revealed. Vote for your favourite entry (not your own): +1 per vote.",
        "🎯 If a chain ends up close to where it started, everyone in it gets +1.",
    ]
    name = "Scribble Relay"
    icon = "🖍️"
    blurb = "Write, draw, caption, draw… on your own phone. Watch the phrases fall apart, then vote for the best bits."
    min_players = 3
    max_players = 6
    settings_schema = {
        "laps": ("Chain length", [(1, "Once round the table"), (2, "Twice round")], 1),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.ids = [p.id for p in seated]
        n = len(self.ids)
        self.steps = n * self.s["laps"]
        self.chains = [[] for _ in range(n)]
        self.used_art = set()
        for p in seated:
            p.g.score = 0
        self.room.add_log("🖍️ Scribble Relay! Write a phrase to start your chain.", "big")
        self.step = -1
        self.next_step()

    def live(self):
        return [p for p in self.room.contenders() if p.id in self.ids]

    def kind(self, step=None):
        step = self.step if step is None else step
        return "write" if step == 0 else "draw" if step % 2 else "caption"

    def chain_of(self, pid, step=None):
        step = self.step if step is None else step
        return (self.ids.index(pid) - step) % len(self.ids)

    def next_step(self):
        r = self.room
        self.step += 1
        if self.step >= self.steps:
            return self.start_show()
        self.subs = {}
        r.turn = None
        r.deadline = time.time() + STEP_SECS[self.kind()]
        r.bot_at = time.time() + random.uniform(3.0, 6.0) + (4 if self.kind() == "draw" else 0)
        if self.step:
            r.add_log({"draw": "🖍️ Draw what you got!", "caption": "🏷️ What is this drawing?"}[self.kind()])
        live = {p.id for p in self.live()}
        for pid in self.ids:
            if pid not in live:
                self.subs[pid] = dict(self.auto_entry(pid, "normal"), auto=True)
        self.maybe_next()

    # -- actions

    def act(self, p, a):
        if p.id not in self.ids or p.eliminated:
            raise GameError("You're watching this game.")
        t = a.get("type")
        if t == "submit":
            if self.stage() != "play":
                raise GameError("Not now.")
            if self.kind() == "draw":
                entry = {"kind": "draw", "v": self.check_drawing(a.get("strokes"))}
            else:
                text = a.get("text")
                if not isinstance(text, str) or not text.strip() or len(text.strip()) > 60:
                    raise GameError("Write something (up to 60 characters).")
                entry = {"kind": "text", "v": " ".join(text.split())}
            self.subs[p.id] = entry
            return self.maybe_next()
        if t == "vote":
            if self.stage() != "show":
                raise GameError("No voting right now.")
            i = a.get("i")
            chain = self.chains[self.show]
            if not isinstance(i, int) or not 0 <= i < len(chain):
                raise GameError("Vote for one of the entries.")
            if chain[i]["by"] == p.id:
                raise GameError("You can't vote for your own entry.")
            self.votes[p.id] = i
            return self.maybe_next_chain()
        raise GameError("Unknown action.")

    def check_drawing(self, strokes):
        if not isinstance(strokes, list) or not strokes or len(strokes) > MAX_STROKES:
            raise GameError("Draw something first!")
        out, total = [], 0
        for s in strokes:
            if not (isinstance(s, list) and len(s) == 2 and isinstance(s[0], int) and 0 <= s[0] < COLORS
                    and isinstance(s[1], list) and len(s[1]) >= 2 and len(s[1]) % 2 == 0):
                raise GameError("Bad drawing.")
            pts = s[1]
            if not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100 for v in pts):
                raise GameError("Bad drawing.")
            total += len(pts)
            out.append([s[0], stroke_path(pts)])
        if total > MAX_INTS:
            raise GameError("That drawing is too detailed. Try fewer lines.")
        return out

    def stage(self):
        return "play" if self.step < self.steps else "show"

    def maybe_next(self):
        if all(pid in self.subs for pid in self.ids):
            self.collect()

    def collect(self):
        for pid in self.ids:
            entry = dict(self.subs[pid], by=pid)
            self.chains[self.chain_of(pid)].append(entry)
        self.next_step()

    def on_timeout(self):
        r = self.room
        if self.stage() == "play":
            for pid in self.ids:
                if pid not in self.subs:
                    self.subs[pid] = dict(self.auto_entry(pid, "normal"), auto=True)
                    if pid in r.players:
                        r.add_log(f"⏰ Time! 🤖 Autopilot finished {r.players[pid].name}'s entry.", "power")
            return self.collect()
        self.end_chain()

    # -- the show

    def start_show(self):
        self.show = -1
        self.room.add_log("🎬 Time for the big reveal!", "big")
        self.next_chain()

    def next_chain(self):
        r = self.room
        self.show += 1
        if self.show >= len(self.chains):
            return self.finish()
        self.votes = {}
        chain = self.chains[self.show]
        r.turn = None
        r.deadline = time.time() + SHOW_SECS + SHOW_PER_ENTRY * len(chain)
        r.bot_at = time.time() + 2 + 1.2 * len(chain)
        starter = r.players.get(self.ids[self.show])
        r.add_log(f"📜 {starter.name if starter else 'Someone'}'s chain: “{chain[0]['v']}”. Vote for your favourite!")

    def voters(self):
        chain = self.chains[self.show]
        return [p for p in self.live() if any(e["by"] != p.id for e in chain)]

    def waiting_on(self):
        if self.room.phase != "playing":
            return []
        if self.stage() == "play":
            return [p for p in self.live() if p.id not in self.subs]
        return [p for p in self.voters() if p.id not in self.votes]

    def maybe_next_chain(self):
        if not self.waiting_on():
            self.end_chain()

    def end_chain(self):
        r = self.room
        chain = self.chains[self.show]
        for pid, i in self.votes.items():
            author = r.players.get(chain[i]["by"])
            if author and author.id in self.ids:
                author.g.score += 1
        texts = [e["v"] for e in chain if e["kind"] == "text"]
        start, end = texts[0], texts[-1]
        key = {w for w in words(start) if w not in STOP}
        if len(texts) > 1 and key & set(words(end)):
            for e in chain:
                p = r.players.get(e["by"])
                if p and p.id in self.ids:
                    p.g.score += 1
            r.add_log(f"🎯 Perfect relay! “{start}” came back as “{end}”. +1 to everyone in it.", "power")
        else:
            r.add_log(f"🌀 “{start}” ended up as “{end}”.", "question")
        tally = {}
        for i in self.votes.values():
            tally[i] = tally.get(i, 0) + 1
        if tally:
            best = max(tally.values())
            stars = [r.players[chain[i]["by"]].name for i, n in tally.items() if n == best and chain[i]["by"] in r.players]
            if stars:
                r.add_log(f"⭐ Crowd favourite: {', '.join(stars)} ({best} vote{'s' * (best > 1)})")
        self.next_chain()

    def finish(self):
        r = self.room
        self.show = len(self.chains) - 1
        ranked = sorted(self.live(), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 Tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Scribble Relay! {text}")

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left — 🤖 autopilot will fill in their part of the chains.")
        p.eliminated = True
        self.votes = {k: v for k, v in getattr(self, "votes", {}).items() if k != p.id}
        if len(self.live()) < 2:
            return self.finish()
        if self.stage() == "play":
            self.subs.setdefault(p.id, dict(self.auto_entry(p.id, "normal"), auto=True))
            self.maybe_next()
        else:
            self.maybe_next_chain()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        done = self.room.phase == "playing" and p.id in self.ids and p not in self.waiting_on() and not p.eliminated
        return f"{p.g.score} pts" + (" · ✅" if done else "")

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.seated() if hasattr(q.g, "score")}

    def public(self, e):
        return {"by": e["by"], "kind": e["kind"], "v": e["v"], "auto": e.get("auto", False)}

    def view(self, p):
        out = {"stage": self.stage(), "step": self.step, "steps": self.steps, "kind": None, "prompt": None,
               "sent": False, "waiting": [q.id for q in self.waiting_on()], "chain": None, "show": None,
               "chains": len(self.chains), "myVote": None, "starter": None}
        if self.stage() == "play":
            out["kind"] = self.kind()
            if p.id in self.ids and not p.eliminated:
                out["sent"] = p.id in self.subs
                if self.step:
                    prev = self.chains[self.chain_of(p.id)][-1]
                    out["prompt"] = self.public(prev)
        else:
            out["show"] = self.show
            out["chain"] = [self.public(e) for e in self.chains[self.show]]
            out["starter"] = self.ids[self.show]
            out["myVote"] = getattr(self, "votes", {}).get(p.id)
            out["tally"] = ({str(i): sum(1 for v in self.votes.values() if v == i) for i in set(self.votes.values())}
                            if self.room.phase == "over" or not self.waiting_on() else None)
        return {"relay": out}

    # -- bots

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())

    def bot_tick(self):
        p = random.choice([q for q in self.waiting_on() if q.bot])
        r = self.room
        if self.stage() == "play":
            self.subs[p.id] = dict(self.auto_entry(p.id, p.bot), auto=p.standin)
            r.bot_at = time.time() + random.uniform(1.0, 3.0)
            return self.maybe_next()
        self.votes[p.id] = self.bot_vote(p)
        r.bot_at = time.time() + random.uniform(0.8, 2.0)
        self.maybe_next_chain()

    def fresh_art(self):
        left = [i for i in range(len(DRAWINGS)) if i not in self.used_art] or list(range(len(DRAWINGS)))
        i = random.choice(left)
        self.used_art.add(i)
        return i

    def auto_entry(self, pid, level):
        """A bot's entry. Bots draw from the Doodle Dash picture book, so they can only draw things
        that are in it; anything else comes out as some other picture (which is half the fun)."""
        kind = self.kind()
        chain = self.chains[self.chain_of(pid)]
        if kind == "write":
            i = self.fresh_art()
            return {"kind": "text", "v": f"{random.choice(ADJECTIVES)} {DRAWINGS[i][0]}", "art": i}
        prev = chain[-1]
        if kind == "draw":
            match = [i for i, d in enumerate(DRAWINGS) if any(mentions(prev["v"], n) for n in [d[0], *d[2]])]
            i = random.choice(match) if match else self.fresh_art()
            strokes = DRAWINGS[i][3]
            keep = {"easy": 0.7, "normal": 0.9, "hard": 1.0}[level]
            strokes = strokes[:max(2, round(len(strokes) * keep))]
            return {"kind": "draw", "v": [[0, s] for s in strokes], "art": i}
        # caption: bots recognise their own picture book well; a human's drawing stands in for
        # human recognition by sometimes "seeing" the phrase that was drawn
        seen = {"easy": 0.55, "normal": 0.8, "hard": 0.95} if "art" in prev else {"easy": 0.3, "normal": 0.5, "hard": 0.65}
        if random.random() < seen[level]:
            if "art" in prev:
                d = DRAWINGS[prev["art"]]
                return {"kind": "text", "v": f"{random.choice(ADJECTIVES)} {random.choice([d[0], *d[2]])}"}
            return {"kind": "text", "v": chain[-2]["v"]}
        cat = DRAWINGS[prev["art"]][1] if "art" in prev else random.choice(DRAWINGS)[1]
        d = random.choice([d for d in DRAWINGS if d[1] == cat])
        return {"kind": "text", "v": f"{random.choice(ADJECTIVES)} {d[0]}"}

    def bot_vote(self, p):
        chain = self.chains[self.show]
        cands = [i for i, e in enumerate(chain) if e["by"] != p.id]
        weight = lambda i: (0.3 if chain[i].get("auto") else 1.0) * (2.0 if chain[i]["kind"] == "draw" else 1.0)
        return random.choices(cands, weights=[weight(i) for i in cands])[0]
