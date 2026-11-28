"""Bingo Bash: 75-ball bingo on 5×5 cards with a FREE centre. Everyone plays 1–8 cards. The caller draws a ball
every few seconds and you daub the numbers you hold. Four styles:

  🎉 Bash      BINGO! claims every finished row, column, diagonal and the corners on all your cards at once, so one
               card scores again and again. Combos, first-of-a-kind and speed bonuses, golden balls; a blackout or
               the last ball ends it. Most points wins.
  🏁 Race      First to Bingo: the first claim of any line wins the round (claims within 2 s share it); fresh cards
               each round, best of N rounds.
  🎯 Hunt      The same rounds, but each round has a target shape (X, plus, frame, postage stamp, …).
  📈 Ladder    One game in stages: one line → two lines → four corners → blackout, each won by its first claim.

Options: ⚡ power-ups on the ⭐ cells (wild daub, peek, ×2, freeze a rival), a false-claim penalty, strict
"sleeper" claims (claim before the next ball or lose it), up to 8 cards, Lightning pace.

Clock-driven like Doodle Dash: no turns; bot_ready/bot_tick run the caller, the claim windows and the bots;
on_timeout fast-forwards the virtual clock (self.skew) so the simulator can play whole games."""
import random
import time

from .base import Game, GameError
from .bingo_patterns import ALL, CORNERS, FREE, HUNT_ORDER, LADDER, LINES, PATTERNS, SHAPES

LETTERS = "BINGO"
DEAL_SECS, REDEAL_SECS = 12, 6  # the card-picking stage (first round / later rounds)
GRACE_BALLS = 1.6               # Bash, after the last ball: this many paces to make final claims
WINDOW = 2.0                    # race styles: claims this soon after the first valid one share the win
BETWEEN = 6.0                   # race styles: the winning cards stay up this long
LINE_PTS, CORNER_PTS, BLACKOUT_PTS = 100, 100, 500
FIRST_BONUS, SPEED_BONUS, FALSE_COST = 150, 50, 50
COLD_AFTER = 3                  # Bash: a pattern finished this many balls before its claim scores half
LOCK_BALLS = 2                  # the false-claim lock and the freeze last this many balls
COMBO_NAMES = {2: "DOUBLE", 3: "TRIPLE"}
BASE = {"line": LINE_PTS, "corners": CORNER_PTS, "blackout": BLACKOUT_PTS}
POWERS = {"wild": "🪄 Wild daub", "peek": "👁️ Peek", "double": "✖️2 Double", "freeze": "❄️ Freeze"}
STYLE_NAMES = {"bash": "🎉 Bash", "race": "🏁 First to Bingo", "hunt": "🎯 Pattern hunt", "ladder": "📈 Ladder"}


def letter(n):
    return LETTERS[(n - 1) // 15]


def ball_name(n):
    return f"{letter(n)}-{n}"


def new_card(rng, stars=1):
    """Numbers stored row by row (cell = row*5 + col); column c holds 15c+1..15c+15; 0 is the FREE centre."""
    cols = [sorted(rng.sample(range(15 * c + 1, 15 * c + 16), 5)) for c in range(5)]
    nums = [cols[c][r] for r in range(5) for c in range(5)]
    nums[FREE] = 0
    daub = [False] * 25
    daub[FREE] = True
    return {"nums": nums, "daub": daub, "at": [-1] * 25,  # at: the ball index that let each cell be daubed
            "stars": rng.sample([i for i in range(25) if i != FREE], stars),
            "got": [], "slept": []}


def done(card, cells):
    return all(card["daub"][c] for c in cells)


class Bingo(Game):
    id = "bingo"
    solo_bots = 3
    category = "party"
    howto = [
        "Pick your cards. The caller draws a ball every few seconds: tap that number wherever you hold it. A card glows and names the pattern when one daub remains.",
        "🎉 Bash: BINGO! claims every finished row, column, diagonal and the corners on all your cards at once, so lines keep scoring. Combos ×1.5, first of a kind +150, on the ball +50.",
        "🏁 First to Bingo: the first to claim a line wins the round. 🎯 Pattern hunt: fill the round's shape first. 📈 Ladder: one line → two lines → corners → blackout.",
        "⭐ cells give a free daub, or a power-up when they're on: 👁️ peek at the next ball, ✖️2, ❄️ freeze a rival's BINGO! button.",
        "Settings can add a false-claim penalty and strict claims (💤 sleepers: claim before the next ball or lose it).",
    ]
    name = "Bingo Bash"
    icon = "🎟️"
    blurb = "75-ball bingo on up to eight cards: rack up lines, race to the first bingo, hunt shapes or climb the ladder."
    min_players = 2
    max_players = 6
    badges = {**Game.badges,
              "combo": ("💥", "Combo caller", "Claim two or more patterns with one BINGO!"),
              "blackout": ("⬛", "Blackout", "Daub a whole card"),
              "first": ("🏁", "Quick dabber", "Win a First-to-Bingo or Pattern-hunt round")}
    settings_schema = {
        "style": ("Style", [("bash", "🎉 Bash (every line scores)"), ("race", "🏁 First to Bingo"),
                            ("hunt", "🎯 Pattern hunt"), ("ladder", "📈 Ladder (line → blackout)")], "bash"),
        "rounds": ("Rounds (race styles)", [(3, "Best of 3"), (1, "1"), (5, "Best of 5")], 3),
        "pace": ("Caller pace", [(4.5, "Normal (4.5 s)"), (6, "🐢 Relaxed (6 s)"), (3, "⚡ Quick (3 s)"), (2, "⚡⚡ Lightning (2 s)")], 4.5),
        "maxcards": ("Cards each (max)", [(4, "Up to 4"), (6, "Up to 6"), (8, "Up to 8")], 4),
        "powerups": ("⭐ Power-ups", [(False, "Off (⭐ = free daub)"), (True, "On")], False),
        "penalty": ("False BINGO!", [("off", "No penalty"), ("lock", "⛔ Locked for 2 balls"), ("points", "−50 points")], "off"),
        "claims": ("Late claims", [("cold", "🧊 Score half after 3 balls"), ("sleep", "💤 Sleepers: claim before the next ball")], "cold"),
        "balls": ("Balls (Bash)", [(60, "60"), (45, "45 (short)"), (75, "All 75")], 60),
        "daub": ("Daubing", [("tap", "👆 Tap to daub"), ("auto", "🤖 Auto-daub")], "tap"),
        "assist": ("Called-number glow", [(True, "On"), (False, "Off")], True),
    }

    # -- setup and clock

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0
        self.style = self.s.get("style", "bash")
        self.points = self.style in ("bash", "ladder")
        self.rounds = int(self.s.get("rounds", 3)) if not self.points else 1
        self.maxcards = int(self.s.get("maxcards", 4))
        self.pace = float(self.s.get("pace", 4.5))
        self.auto = self.s.get("daub") == "auto"
        self.power = bool(self.s.get("powerups", False))
        self.penalty = self.s.get("penalty", "off")
        self.sleepers = self.s.get("claims") == "sleep"
        self.round = 0
        self.lstage = 0                       # Ladder stage
        self.ladder_won = []                  # [[pid names…] per finished stage]
        self.hunt = rng.sample(HUNT_ORDER, len(HUNT_ORDER))
        self.firsts = {}                      # Bash: pattern kind -> pid who claimed it first
        self.feed = []                        # recent claims, for the browsers' animations
        self.seq = 0
        self.result = None                    # race styles: the last round's winners, shown between rounds
        for p in seated:
            p.g.ncards = min(self.maxcards, {"easy": rng.choice([1, 2]), "normal": rng.choice([2, 3]),
                                             "hard": max(4, self.maxcards)}.get(p.bot, 2))
            p.g.score = 0
            p.g.rounds = 0
            p.g.bingos = 0
            p.g.free = 0
            p.g.pw = {"peek": 0, "double": 0, "freeze": 0}
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🔵 Bingo Bash: {STYLE_NAMES[self.style]}"
                          + (f", {self.rounds} round{'s' if self.rounds > 1 else ''}" if not self.points else "")
                          + f". A ball every {self.pace:g} s. Pick your cards.", "big")
        self.new_round()

    def new_round(self):
        """Fresh balls and cards (Bash and Ladder have just the one round)."""
        self.round += 1
        self.balls = list(range(1, 76))
        self.rng.shuffle(self.balls)
        self.cap = int(self.s.get("balls", 60)) if self.style == "bash" else 75
        gold = self.points and self.style == "bash" or self.style == "ladder"
        self.golden = {min(self.cap - 1, k * 8 + self.rng.randint(-2, 2)) for k in range(1, self.cap // 8 + 1)} if gold else set()
        self.called, self.calledset = [], set()
        self.plans = []                       # [(time, pid, what)] bot reactions
        self.window = None                    # {"end": t, "claims": [{pid, card, keys}]}
        self.target = self.make_target()
        for p in self.room.contenders():
            if hasattr(p.g, "score"):
                self.deal(p, getattr(p.g, "ncards", 2))
        self.stage = "deal"
        self.next_at = self.now() + (DEAL_SECS if self.round == 1 else REDEAL_SECS)
        self.end_at = None
        self.set_deadline()
        if self.round > 1:
            self.room.add_log(f"🃏 Round {self.round}{'/' + str(self.rounds) if self.round <= self.rounds else ' (sudden death!)'}: "
                              f"fresh cards. {self.target['goal']}", "big")

    def deal(self, p, n):
        p.g.cards = [new_card(self.rng, 2 if self.power else 1) for _ in range(n)]
        p.g.rerolls = 1
        p.g.ready = bool(p.bot)
        p.g.last = None
        p.g.locked = 0        # claims refused until this many balls have been called (penalty)
        p.g.frozen = 0        # … (a rival's ❄️)
        p.g.peek = None       # the ball index a 👁️ peek shows
        p.g.double = False

    def make_target(self):
        """What a claim must show in this round/stage: {kind, name, goal, masks}."""
        if self.style == "race":
            return {"kind": "line", "name": "Any line", "goal": "🏁 First to claim any line wins the round!",
                    "masks": list(LINES.values())}
        if self.style == "hunt":
            last = self.round >= 5 and self.round == self.rounds
            key = "blackout" if last else self.hunt[(self.round - 1) % len(self.hunt)]
            name, masks = SHAPES[key]
            return {"kind": "shape", "shape": key, "name": name, "goal": f"🎯 First to fill the {name} wins the round!", "masks": masks}
        if self.style == "ladder":
            key, name, prize = LADDER[self.lstage]
            masks = {"line": list(LINES.values()), "two": list(LINES.values()), "corners": [CORNERS], "blackout": [ALL]}[key]
            return {"kind": key, "name": name, "goal": f"📈 Stage {self.lstage + 1}: {name} for {prize}", "masks": masks, "prize": prize}
        return {"kind": "bash", "name": "Every line", "goal": "🎉 Every line scores!", "masks": []}

    def late_join(self, p):
        p.g.ncards = 1
        p.g.score = p.g.rounds = p.g.bingos = p.g.free = 0
        p.g.pw = {"peek": 0, "double": 0, "freeze": 0}
        self.deal(p, 1)
        p.g.ready = True
        if self.auto:
            for c in p.g.cards:
                self.auto_daub(p, c)

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def next_event(self):
        times = [t for t in (self.next_at, self.end_at) if t]
        if self.window:
            times.append(self.window["end"])
        if self.plans:
            times.append(self.plans[0][0])
        return min(times) if times else self.now() + 60

    def bot_ready(self):
        return self.room.phase == "playing" and self.now() >= self.next_event()

    def bot_tick(self):
        self.process()

    def on_timeout(self):
        gap = self.next_event() - self.now()
        if gap > 0:
            self.skew += gap
        self.process()

    def set_deadline(self):
        self.room.deadline = self.next_event() - self.skew

    def players(self):
        return [q for q in self.room.contenders() if hasattr(q.g, "cards")]

    def process(self):
        now = self.now()
        if self.stage == "deal":
            if now >= self.next_at or all(q.g.ready for q in self.players()):
                self.begin_calls()
            return self.set_deadline()
        if self.stage == "between":
            if now >= self.next_at:
                self.after_round()
            if self.room.phase == "playing":
                self.set_deadline()
            return
        while self.plans and self.plans[0][0] <= now and self.room.phase == "playing" and self.stage == "call":
            _, pid, what = self.plans.pop(0)
            p = self.room.players.get(pid)
            if p and p.bot and not p.eliminated and hasattr(p.g, "cards"):
                self.bot_act(p, what)
        if self.room.phase != "playing" or self.stage != "call":
            return self.set_deadline() if self.room.phase == "playing" else None
        if self.window and now >= self.window["end"]:
            self.resolve()
            if self.room.phase != "playing":
                return
        if self.stage == "call" and not self.window and self.next_at and now >= self.next_at:
            self.draw()
        if self.end_at and now >= self.end_at and self.stage == "call":
            return self.finish_game()
        if self.room.phase == "playing":
            self.set_deadline()

    def begin_calls(self):
        self.stage = "call"
        n = sum(len(q.g.cards) for q in self.players())
        self.room.add_log(f"🎱 Eyes down! {n} cards in play. {self.target['goal']}", "big")
        self.next_at = self.now() + 1.2
        self.mark_round()

    # -- the caller

    def draw(self):
        if self.sleepers:
            self.sleep_unclaimed()
        k = len(self.called)
        if k >= len(self.balls):
            return self.finish_game()
        n = self.balls[k]
        self.called.append(n)
        self.calledset.add(n)
        gold = k in self.golden
        self.room.add_log(f"{'✨ Golden ball' if gold else '🎱'} {ball_name(n)}" + (" — what it finishes scores double!" if gold else ""),
                          "power" if gold else "info")
        if gold:
            self.moment(f"✨ GOLDEN BALL {ball_name(n)}!", "gold", "rise")
        if self.style == "bash" and len(self.called) >= self.cap:
            self.next_at = None
            self.end_at = self.now() + self.pace * GRACE_BALLS + 1
            self.room.add_log("🔚 That was the last ball: final claims!", "power")
        else:
            self.next_at = self.now() + self.pace
        for p in self.players():
            if self.auto:
                self.auto_turn(p)
            elif p.bot:
                self.plan_bot(p)
            if self.room.phase != "playing" or self.stage != "call":
                return

    def sleep_unclaimed(self):
        """💤 Anything you could have claimed before this ball and didn't is gone."""
        for p in self.players():
            if self.window and any(c["pid"] == p.id for c in self.window["claims"]):
                continue
            for card in p.g.cards:
                keys = self.claim_keys(card) if self.style == "bash" else (self.target_keys(card) or [])
                fresh = [k for k in keys if k not in card["slept"]]
                if fresh:
                    card["slept"] += fresh
                    if not p.bot:
                        self.room.add_log("💤 Too slow: that bingo went to sleep. Claim before the next ball!", "private", to=p.id)

    def auto_daub(self, p, card):
        for i, v in enumerate(card["nums"]):
            if v and not card["daub"][i] and v in self.calledset:
                self.mark(p, card, i)

    def auto_turn(self, p):
        for c in p.g.cards:
            self.auto_daub(p, c)
        self.use_powers(p, smart=True, others=bool(p.bot))
        if self.claimable(p) and self.can_claim(p) is None:
            self.claim(p)

    # -- daubing

    def mark(self, p, card, i):
        card["daub"][i] = True
        card["at"][i] = len(self.called) - 1
        if i in card["stars"]:
            if not self.power:
                p.g.free += 1
                if not p.bot:
                    self.room.add_log("⭐ Lucky star! You earned a free daub: tap any number on your cards.", "private", to=p.id)
                return
            pool = ["wild", "peek", "freeze"] + (["double"] if self.points else [])
            if len(self.players()) < 2:
                pool.remove("freeze")
            got = self.rng.choice(pool)
            if got == "wild":
                p.g.free += 1
            else:
                p.g.pw[got] += 1
            if not p.bot:
                self.room.add_log(f"⭐ Power-up: {POWERS[got]}!", "private", to=p.id)

    def daub(self, p, ci, i):
        card = p.g.cards[ci]
        v = card["nums"][i]
        if card["daub"][i]:
            raise GameError("Already daubed.")
        if v not in self.calledset:
            if p.g.free <= 0:
                raise GameError(f"{ball_name(v)} hasn't been called yet.")
            p.g.free -= 1
        self.mark(p, card, i)

    def daub_all(self, p):
        if not self.called:
            raise GameError("No balls yet.")
        n = self.called[-1]
        hit = 0
        for card in p.g.cards:
            for i, v in enumerate(card["nums"]):
                if v == n and not card["daub"][i]:
                    self.mark(p, card, i)
                    hit += 1
        if not hit:
            raise GameError(f"No {ball_name(n)} left to daub.")

    # -- what can be claimed

    def claim_keys(self, card):
        """Bash: complete, unscored, awake patterns on this card."""
        return [key for key, _, cells in PATTERNS if key not in card["got"] and key not in card["slept"] and done(card, cells)]

    def target_keys(self, card):
        """Race styles and Ladder: the pattern keys on this card that meet the target, or None."""
        t = self.target
        awake = lambda key: key not in card["slept"]
        lines = [k for k, cells in LINES.items() if awake(k) and done(card, cells)]
        if t["kind"] == "line":
            return lines[:1] or None
        if t["kind"] == "two":
            return lines[:2] if len(lines) >= 2 else None
        if t["kind"] == "corners":
            return ["x4"] if awake("x4") and done(card, CORNERS) else None
        if t["kind"] == "blackout":
            return ["all"] if awake("all") and done(card, ALL) else None
        if t["kind"] == "shape":
            key = f"s:{t['shape']}"
            return [key] if awake(key) and any(done(card, m) for m in t["masks"]) else None
        return None

    def ready_patterns(self, p):
        """Bash: [(card index, key, kind, finished-at ball index)]."""
        out = []
        kinds = {k: kind for k, kind, _ in PATTERNS}
        cells = {k: c for k, _, c in PATTERNS}
        for ci, card in enumerate(p.g.cards):
            for key in self.claim_keys(card):
                out.append((ci, key, kinds[key], max(card["at"][c] for c in cells[key])))
        return out

    def claimable(self, p):
        if self.stage != "call":
            return False
        if self.style == "bash":
            return bool(self.ready_patterns(p))
        if self.window and any(c["pid"] == p.id for c in self.window["claims"]):
            return False
        return any(self.target_keys(c) for c in p.g.cards)

    def can_claim(self, p):
        """Why p can't claim right now, or None."""
        k = len(self.called)
        if p.g.frozen > k:
            return f"❄️ Frozen! You can claim again in {p.g.frozen - k} ball{'s' if p.g.frozen - k > 1 else ''}."
        if p.g.locked > k:
            return f"⛔ Locked after a false BINGO! Wait {p.g.locked - k} ball{'s' if p.g.locked - k > 1 else ''}."
        return None

    # -- claiming

    def false_claim(self, p):
        why = "No bingo yet! Daub every number in a line first."
        if self.penalty == "lock" or (self.penalty == "points" and not self.points):
            p.g.locked = len(self.called) + LOCK_BALLS
            why = f"No bingo! ⛔ Your BINGO! button is locked for {LOCK_BALLS} balls."
            self.room.add_log(f"⛔ {p.name} shouted a false BINGO!")
        elif self.penalty == "points":
            p.g.score -= FALSE_COST
            why = f"No bingo! −{FALSE_COST} points."
            self.room.add_log(f"⛔ {p.name} shouted a false BINGO! −{FALSE_COST}")
        return why

    def claim(self, p):
        if self.style == "bash":
            return self.claim_bash(p)
        if self.window and any(c["pid"] == p.id for c in self.window["claims"]):
            return None
        for ci, card in enumerate(p.g.cards):
            keys = self.target_keys(card)
            if keys:
                break
        else:
            return None
        if not self.window:
            self.window = {"end": self.now() + WINDOW, "claims": []}
            self.next_at = None  # the caller waits while the claim is checked
            self.moment(f"🔵 {p.name} shouts BINGO!", "gold", "fanfare")
        else:
            self.room.add_log(f"🔵 {p.name} shouts BINGO too!", "power")
        self.window["claims"].append({"pid": p.id, "card": ci, "keys": keys})
        return {"pid": p.id}

    def claim_bash(self, p):
        found = self.ready_patterns(p)
        if not found:
            return None
        k = len(self.called) - 1
        total, parts, kinds = 0, [], set()
        for ci, key, kind, at in found:
            pts = BASE[kind]
            tags = []
            if at in self.golden:
                pts *= 2
                tags.append("✨×2")
            if not self.auto and at == k:
                pts += SPEED_BONUS
                tags.append("⚡+50")
            elif not self.auto and not self.sleepers and k - at >= COLD_AFTER:
                pts //= 2
                tags.append("🧊½")
            if kind not in self.firsts and kind not in kinds:
                pts += FIRST_BONUS
                tags.append("🥇+150")
                kinds.add(kind)
            p.g.cards[ci]["got"].append(key)
            total += pts
            parts.append({"card": ci, "key": key, "kind": kind, "pts": pts, "tags": tags})
        for kind in kinds:
            self.firsts[kind] = p.id
        lines = sum(1 for x in parts if x["kind"] != "blackout")
        combo = len(parts) >= 2
        if combo:
            total = int(total * 1.5)
            self.award(p, "combo")
        if p.g.double:
            p.g.double = False
            total *= 2
        p.g.score += total
        p.g.bingos += lines
        blackout = any(x["kind"] == "blackout" for x in parts)
        name = "BLACKOUT" if blackout else (COMBO_NAMES.get(len(parts), "MEGA") + " BINGO" if combo else "BINGO")
        ev = self.post(p, name, total, parts)
        what = ", ".join(self.describe(x) for x in parts)
        self.room.add_log(f"🎉 {p.name}: {name}! {what} — +{total}", "big")
        if blackout:
            self.award(p, "blackout")
            self.moment(f"⬛ {p.name}: BLACKOUT! +{total}", "gold", "fanfare")
            self.finish_game(blackout=p)
        elif combo:
            self.moment(f"💥 {p.name}: {name}! +{total}", "gold", "cheer")
        elif "line" in kinds or "corners" in kinds:
            self.moment(f"🥇 {p.name} calls the first {'corners' if 'corners' in kinds else 'bingo'}! +{total}", "good", "tag")
        return ev

    def post(self, p, name, pts, parts):
        self.seq += 1
        ev = {"id": self.seq, "pid": p.id, "name": name, "pts": pts, "parts": parts, "ball": len(self.called) - 1}
        self.feed = (self.feed + [ev])[-8:]
        p.g.last = ev
        return ev

    def resolve(self):
        """The claim window closed: everyone in it shares the round (race styles) or the stage prize (Ladder)."""
        claims, self.window = self.window["claims"], None
        winners = [(self.room.players[c["pid"]], c) for c in claims if c["pid"] in self.room.players]
        names = " & ".join(w.name for w, _ in winners)
        for w, c in winners:
            card = w.g.cards[c["card"]]
            card["got"] += [k for k in c["keys"] if k not in card["got"]]
            w.g.bingos += 1
        if self.style == "ladder":
            key, name, prize = LADDER[self.lstage]
            share = prize // max(1, len(winners))
            for w, c in winners:
                pts = share * (2 if w.g.double else 1)
                w.g.double = False
                w.g.score += pts
                self.post(w, "BLACKOUT" if key == "blackout" else "BINGO", pts,
                          [{"card": c["card"], "key": k, "kind": key, "pts": pts, "tags": []} for k in c["keys"]])
            self.ladder_won.append([w.id for w, _ in winners])
            self.room.add_log(f"🪜 {name}: {names} {'share' if len(winners) > 1 else 'takes'} {prize}!", "big")
            if key == "blackout":
                return self.finish_game(blackout=winners[0][0] if winners else None)
            self.lstage += 1
            self.target = self.make_target()
            self.moment(f"🪜 {names} wins {name}! Next: {self.target['name']}", "good", "tag")
            self.next_at = self.now() + self.pace
            return
        # race / hunt
        for w, c in winners:
            w.g.rounds += 1
            self.award(w, "first")
            self.post(w, "BINGO", 1, [{"card": c["card"], "key": k, "kind": self.target["kind"], "pts": 1, "tags": []} for k in c["keys"]])
        self.result = {"round": self.round, "target": self.target["name"], "masks": self.target["masks"],
                       "winners": [{"pid": w.id, "nums": w.g.cards[c["card"]]["nums"], "daub": w.g.cards[c["card"]]["daub"],
                                    "keys": c["keys"]} for w, c in winners]}
        self.moment(f"🏁 {names} win{'s' if len(winners) == 1 else ''} round {self.round}!", "gold", "cheer")
        self.room.add_log(f"🏁 Round {self.round}: {names} — {self.target['name']} after {len(self.called)} balls.", "big")
        self.stage = "between"
        self.plans = []
        self.next_at = self.now() + BETWEEN

    def after_round(self):
        ps = self.players()
        best = max((q.g.rounds for q in ps), default=0)
        leaders = [q for q in ps if q.g.rounds == best]
        lead = sorted(q.g.rounds for q in ps)
        left = self.rounds - self.round
        clinched = len(lead) > 1 and lead[-1] - lead[-2] > left
        if (self.round >= self.rounds and len(leaders) == 1) or clinched:
            return self.finish_game()
        if self.round >= self.rounds:
            self.room.add_log(f"🤝 {' & '.join(q.name for q in leaders)} are level: sudden death!", "big")
        self.result = None
        self.new_round()

    @staticmethod
    def describe(x):
        k = x["key"]
        label = {"r": f"row {k[1:] and int(k[1:]) + 1}", "c": f"column {k[1:] and int(k[1:]) + 1}"}.get(k[0]) if k[0] in "rc" else (
            "diagonal" if k[0] == "d" else ("corners" if k == "x4" else "blackout"))
        tags = f" {' '.join(x['tags'])}" if x["tags"] else ""
        return f"{label} on card {x['card'] + 1}{tags}"

    # -- power-ups

    def use_power(self, p, kind, target=None):
        if kind not in p.g.pw or p.g.pw[kind] <= 0:
            raise GameError("You don't have that power-up.")
        k = len(self.called)
        if kind == "peek":
            if k >= len(self.balls):
                raise GameError("No balls left to peek at.")
            p.g.peek = k
            self.room.add_log(f"👁️ Next ball: {ball_name(self.balls[k])}", "private", to=p.id)
        elif kind == "double":
            if p.g.double:
                raise GameError("Your next claim is already doubled.")
            p.g.double = True
        elif kind == "freeze":
            q = self.room.players.get(target) if isinstance(target, str) else None
            if not q or q is p or not hasattr(q.g, "cards") or q.eliminated:
                raise GameError("Pick a rival to freeze.")
            q.g.frozen = max(q.g.frozen, k + LOCK_BALLS)
            self.moment(f"❄️ {p.name} froze {q.name}'s BINGO! button for {LOCK_BALLS} balls!", "cool", "crack")
        p.g.pw[kind] -= 1

    def use_powers(self, p, smart, others=True):
        """Bots and auto-daub: spend wild daubs well, double at once, freeze the leader."""
        while p.g.free > 0:
            pick = self.best_free(p) if smart else self.any_free(p)
            if not pick:
                break
            p.g.free -= 1
            self.mark(p, p.g.cards[pick[0]], pick[1])
        if not others:
            return
        if p.g.pw["double"] and not p.g.double:
            self.use_power(p, "double")
        if p.g.pw["peek"]:
            self.use_power(p, "peek")
        if p.g.pw["freeze"] and smart:
            rivals = [q for q in self.players() if q is not p]
            if rivals:
                key = (lambda q: q.g.score) if self.points else (lambda q: (q.g.rounds, sum(len(self.one_to_go(c)) for c in q.g.cards)))
                self.use_power(p, "freeze", max(rivals, key=key).id)

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if p.spectator or p.eliminated or not hasattr(p.g, "cards"):
            raise GameError("You're watching this game.")
        if t in ("cards", "reroll", "go"):
            if self.stage != "deal":
                raise GameError("The cards are already in play.")
            if t == "cards":
                n = a.get("n")
                if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= self.maxcards:
                    raise GameError(f"Pick 1 to {self.maxcards} cards.")
                cards = p.g.cards[:n]
                while len(cards) < n:
                    cards.append(new_card(self.rng, 2 if self.power else 1))
                p.g.cards = cards
                p.g.ncards = n
            elif t == "reroll":
                ci = self.card_index(p, a.get("card"))
                if p.g.rerolls <= 0:
                    raise GameError("You've used your swap.")
                p.g.rerolls -= 1
                p.g.cards[ci] = new_card(self.rng, 2 if self.power else 1)
            else:
                p.g.ready = True
                if all(q.g.ready for q in self.players()):
                    self.begin_calls()
                    self.set_deadline()
            return
        if self.stage != "call":
            raise GameError("Wait for the next ball.")
        if t == "daub":
            if self.auto:
                raise GameError("Auto-daub is on: your cards mark themselves.")
            ci = self.card_index(p, a.get("card"))
            i = a.get("cell")
            if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < 25 or i == FREE:
                raise GameError("Pick a square on your card.")
            self.daub(p, ci, i)
        elif t == "daub_all":
            if self.auto:
                raise GameError("Auto-daub is on: your cards mark themselves.")
            self.daub_all(p)
        elif t == "power":
            self.use_power(p, a.get("kind"), a.get("target"))
        elif t == "claim":
            why = self.can_claim(p)
            if why:
                raise GameError(why)
            if self.window and any(c["pid"] == p.id for c in self.window["claims"]):
                raise GameError("Your claim is in: checking…")
            if not self.claim(p):
                why = self.false_claim(p)
                bump = getattr(self.room, "bump", None)
                if bump and why.startswith("No bingo!"):  # the penalty sticks, so show it to the table
                    try:
                        bump()
                    except RuntimeError:  # the rules tests call act() without holding the room lock
                        pass
                raise GameError(why)
        else:
            raise GameError("Unknown action.")

    def card_index(self, p, ci):
        if not isinstance(ci, int) or isinstance(ci, bool) or not 0 <= ci < len(p.g.cards):
            raise GameError("Pick one of your cards.")
        return ci

    # -- bots: they react to each ball after a human-ish delay, and only know what's been called

    SKILL = {  # (look delay range s, chance to miss a number per look, claim lag range in balls)
        "easy": ((1.5, 4.0), 0.2, (0.3, 3.5)),
        "normal": ((0.8, 2.0), 0.05, (0.1, 1.0)),
        "hard": ((0.3, 0.8), 0.0, (0.0, 0.15)),
    }

    def skill(self, p):
        return self.SKILL.get(p.bot, self.SKILL["normal"])

    def plan_bot(self, p):
        (lo, hi), _, _ = self.skill(p)
        self.plans.append((self.now() + random.uniform(lo, hi) * min(1.0, self.pace / 4.5), p.id, "look"))
        self.plans.sort(key=lambda x: x[0])

    def bot_act(self, p, what):
        if self.stage != "call":
            return
        if what == "claim":
            if self.claimable(p) and self.can_claim(p) is None:
                self.claim(p)
            return
        _, miss, (c0, c1) = self.skill(p)
        for card in p.g.cards:
            for i, v in enumerate(card["nums"]):
                if v and not card["daub"][i] and v in self.calledset and random.random() >= miss:
                    self.mark(p, card, i)
        self.use_powers(p, smart=p.bot != "easy")
        if self.can_claim(p) is not None:
            return
        if self.claimable(p):
            if not any(pid == p.id and w == "claim" for _, pid, w in self.plans):
                lag = random.uniform(c0, c1) * min(self.pace, 4.5)
                if self.sleepers:
                    lag = min(lag, self.pace * random.uniform(0.5, 1.3))  # easy bots still sometimes sleep through it
                if lag < 0.05:
                    self.claim(p)
                else:
                    self.plans.append((self.now() + lag, p.id, "claim"))
                    self.plans.sort(key=lambda x: x[0])
        elif p.bot == "easy" and self.penalty != "off" and random.random() < 0.03:
            self.false_claim(p)

    def best_free(self, p):
        """The undaubed cell that leaves some wanted pattern closest to done (ties: most patterns helped)."""
        masks = self.target["masks"] or [cells for _, kind, cells in PATTERNS if kind != "blackout"]
        best, pick = None, None
        for ci, card in enumerate(p.g.cards):
            left = [(sum(1 for c in m if not card["daub"][c]), m) for m in masks]
            for i in range(25):
                if card["daub"][i]:
                    continue
                need = [n for n, m in left if i in m]
                if not need:
                    continue
                score = (min(need), -len(need))
                if best is None or score < best:
                    best, pick = score, (ci, i)
        return pick

    def any_free(self, p):
        opts = [(ci, i) for ci, card in enumerate(p.g.cards) for i in range(25) if not card["daub"][i]]
        return random.choice(opts) if opts else None

    # -- the end

    def finish_game(self, blackout=None):
        r = self.room
        if r.phase != "playing":
            return
        self.stage = "over"
        self.next_at = self.end_at = None
        self.window = None
        self.plans = []
        key = (lambda q: getattr(q.g, "score", 0)) if self.points else (lambda q: getattr(q.g, "rounds", 0))
        unit = "" if self.points else " 🏁"
        ranked = sorted(r.contenders(), key=lambda q: -key(q))
        text = " · ".join(f"{q.name} {key(q)}{unit}" for q in ranked)
        head = f"⬛ {blackout.name} blacked out a card! " if blackout else ""
        if len(ranked) > 1 and key(ranked[0]) == key(ranked[1]):
            return r.finish(None, f"{head}🤝 It's a tie! {text}")
        r.finish(ranked[0], f"{head}🏆 {ranked[0].name} wins Bingo Bash! {text}")

    def final_scores(self):
        if not self.points:
            return {q.id: q.g.rounds for q in self.room.contenders() if hasattr(q.g, "rounds")}
        return {q.id: q.g.score for q in self.room.contenders() if hasattr(q.g, "score")}

    # -- views

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        if not getattr(self, "points", True):
            return f"{p.g.rounds} 🏁"
        return f"{p.g.score} pts" + (f" · {p.g.bingos}🎉" if p.g.bingos else "")

    def one_to_go(self, card):
        """Cells that would finish something worth claiming."""
        return sorted({row["cell"] for row in self.near_patterns(card)})

    def near_patterns(self, card):
        """Named valid claim patterns with exactly one missing daub on this card."""
        def line_name(key):
            if key.startswith("r"):
                return f"Row {int(key[1:]) + 1}"
            if key.startswith("c"):
                return f"Column {int(key[1:]) + 1}"
            return "Diagonal"

        if self.style == "bash":
            masks = [("Four corners" if key == "x4" else line_name(key), cells)
                     for key, kind, cells in PATTERNS
                     if kind != "blackout" and key not in card["got"] and key not in card["slept"]]
        elif self.target["kind"] == "two":
            open_lines = [m for k, m in LINES.items() if k not in card["slept"] and not done(card, m)]
            if sum(1 for k, m in LINES.items() if k not in card["slept"] and done(card, m)) < 1:
                return []
            masks = [("Second line", cells) for cells in open_lines]
        elif self.target["kind"] == "line":
            masks = [(line_name(key), cells) for key, cells in LINES.items() if key not in card["slept"]]
        else:
            masks = [(self.target["name"], cells) for cells in self.target["masks"]]
        out, seen = [], set()
        for name, cells in masks:
            open_ = [c for c in cells if not card["daub"][c]]
            if len(open_) == 1:
                item = (name, open_[0])
                if item not in seen:
                    out.append({"name": name, "cell": open_[0]})
                    seen.add(item)
        return out

    def view(self, p):
        now = self.now()
        mine = hasattr(p.g, "cards")
        k = len(self.called)
        table = [{"id": q.id, "score": q.g.score, "rounds": q.g.rounds, "bingos": q.g.bingos, "cards": len(q.g.cards),
                  "close": sum(1 for c in q.g.cards if self.one_to_go(c)) if self.stage == "call" else 0, "ready": q.g.ready,
                  "frozen": max(0, q.g.frozen - k)} for q in self.players()]
        t = self.target
        v = {
            "stage": self.stage, "style": self.style, "points": self.points, "round": self.round, "rounds": self.rounds,
            "target": {"kind": t["kind"], "name": t["name"], "goal": t["goal"], "masks": t["masks"], "prize": t.get("prize")},
            "ladder": [[name, prize, self.ladder_won[i] if i < len(self.ladder_won) else None] for i, (_, name, prize) in enumerate(LADDER)]
            if self.style == "ladder" else None,
            "lstage": self.lstage, "called": self.called, "cap": self.cap, "pace": self.pace,
            "golden": [i for i in sorted(self.golden) if i < k], "auto": self.auto, "power": self.power,
            "penalty": self.penalty, "sleepers": self.sleepers, "maxcards": self.maxcards,
            "assist": bool(self.s.get("assist", True)),
            "next": max(0.0, self.next_at - now) if self.next_at else None,
            "endIn": max(0.0, self.end_at - now) if self.end_at else None,
            "window": {"left": max(0.0, self.window["end"] - now), "who": [c["pid"] for c in self.window["claims"]]} if self.window else None,
            "result": self.result if self.stage == "between" else None,
            "firsts": self.firsts, "feed": self.feed, "table": table,
        }
        if mine:
            v["cards"] = [{"nums": c["nums"], "daub": c["daub"], "stars": c["stars"], "got": c["got"], "slept": c["slept"],
                           "near": self.one_to_go(c) if self.stage == "call" else [],
                           "nearPatterns": self.near_patterns(c) if self.stage == "call" else []} for c in p.g.cards]
            v["free"] = p.g.free
            v["pw"] = p.g.pw
            v["double"] = p.g.double
            v["peek"] = self.balls[p.g.peek] if p.g.peek is not None and p.g.peek == k and k < len(self.balls) else None
            v["locked"] = max(0, p.g.locked - k)
            v["frozen"] = max(0, p.g.frozen - k)
            v["rerolls"] = p.g.rerolls
            v["ready"] = p.g.ready
            v["can"] = bool(self.s.get("assist", True)) and self.claimable(p)
        return {"bingo": v}
