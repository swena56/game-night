"""Dice Brawl: an original last-one-standing combat dice game.

Five combat dice, up to three rolls a turn (tap dice to hold them). Faces: 💀 skull, ⚔️ sword ×2,
💥 smash, 🛡️ shield, ❤️ heart. Skulls lock where they land, and a third skull backfires: you lose 2
health and your turn. Stop when you like: swords hit 1 and smashes 2 on the rival you pick (three or
more 💥 hit everyone), shields guard you until your next turn, hearts heal. Last brawler standing wins."""
import time
from collections import Counter
from functools import lru_cache
from itertools import combinations_with_replacement, product
from math import factorial

from .base import Game, GameError

SKULL, SWORD, SWORD2, SMASH, SHIELD, HEART = 1, 2, 3, 4, 5, 6
FACES = {SKULL: "💀", SWORD: "⚔️", SWORD2: "⚔️", SMASH: "💥", SHIELD: "🛡️", HEART: "❤️"}
DICE, ROLLS = 5, 3
BACKFIRE = 2
LAST_STAND = 3   # 🩸 at this health or less you get a fourth roll: a comeback chance
PARRY = 1        # 🛡️ a shield that soaks a whole hit bites back: the attacker loses this much health


KINDS = (SKULL, SWORD, SMASH, SHIELD, HEART)
KIND_P = (1 / 6, 2 / 6, 1 / 6, 1 / 6, 1 / 6)


def counts(dice):
    return tuple(sum(1 for d in dice if (SWORD if d == SWORD2 else d) == k) for k in KINDS)


@lru_cache(maxsize=None)
def outcomes(k):
    """[(counts, probability)] for k fresh dice."""
    out = []
    for combo in combinations_with_replacement(range(len(KINDS)), k):
        c = Counter(combo)
        ways = factorial(k)
        pr = 1.0
        for i, n in c.items():
            ways //= factorial(n)
            pr *= KIND_P[i] ** n
        out.append((tuple(c.get(i, 0) for i in range(len(KINDS))), ways * pr))
    return out


def holds(c):
    """Every way to keep some of a hand (skulls always stay), leaving at least one die to reroll."""
    out = []
    for h in product(*(range(n + 1) for n in c[1:])):
        if sum(h) < sum(c[1:]):
            out.append((c[0],) + h)
    return out


def tally(dice):
    dmg = sum(1 for d in dice if d in (SWORD, SWORD2)) + 2 * sum(1 for d in dice if d == SMASH)
    return {
        "dmg": dmg, "smash": sum(d == SMASH for d in dice), "shield": sum(d == SHIELD for d in dice),
        "heal": sum(d == HEART for d in dice), "skulls": sum(d == SKULL for d in dice),
    }


def outcome(dice, guards, target, missing):
    """What fighting on these dice does: damage that sticks (on the target, or on every rival in a quake),
    guard raised and health healed; a third skull is a backfire instead."""
    t = tally(dice)
    if t["skulls"] >= 3:
        return {"backfire": 1, "quake": 0, "dmg": 0, "guard": 0, "heal": 0}
    quake = t["smash"] >= 3
    hit = list(guards) if quake else [target] if t["dmg"] and target in guards else []
    return {"backfire": 0, "quake": int(quake), "dmg": sum(max(0, t["dmg"] - guards[q]) for q in hit),
            "guard": t["shield"], "heal": min(t["heal"], missing)}


def preview(dice, hold, guards, target, missing):
    """⚔️ Combat preview for the player on turn: `now` is fighting on these dice; `reroll` averages every
    way the unheld dice can land (skulls always stay), with the chance of a backfire and of a quake.
    `guards` is each live rival's shield, `missing` the health a heart could still restore. The browser
    mirrors this (static/games/brawl.js) so it can follow the dice you tap and the rival you pick."""
    now = outcome(dice, guards, target, missing)
    free = [i for i, d in enumerate(dice) if d != SKULL and i not in hold]
    if not free:
        return {"now": now, "reroll": None}
    tot = dict.fromkeys(now, 0.0)
    rolls = list(product(range(1, 7), repeat=len(free)))
    for faces in rolls:
        d = list(dice)
        for i, f in zip(free, faces):
            d[i] = f
        for k, v in outcome(d, guards, target, missing).items():
            tot[k] += v
    return {"now": now, "reroll": {k: v / len(rolls) for k, v in tot.items()}}


class Brawl(Game):
    id = "brawl"
    max_rolls = ROLLS   # a turn's rolls (a last stand adds one); a class default so older saves still load
    category = "dice"
    howto = [
        "Roll five combat dice up to three times; tap dice to hold them between rolls.",
        "💀 Skulls lock where they land. A third skull backfires: you lose 2 ❤️ and your turn.",
        "Stop whenever you like: ⚔️ hits 1 and 💥 hits 2 on the rival you pick. Three or more 💥 hit everyone!",
        "🛡️ guards 1 damage each until your next turn; ❤️ heals 1 each (up to your starting health).",
        "Before you bank a roll, the ⚔️ preview shows what fighting now does to your target, and what rerolling the dice you haven't held is likely to do — with the chance of a 💀 backfire and of a 🌋 quake.",
        "🩸 Down to 3 ❤️ or less? You get a fourth roll: a comeback chance. 🛡️ A shield that soaks a whole hit parries it: the attacker loses 1 ❤️.",
        "Last brawler standing wins.",
    ]
    name = "Dice Brawl"
    icon = "⚔️"
    blurb = "Roll, hold and smash: swords, shields and hearts on five dice, and a third skull blows up in your face."
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "quake": ("🌋", "Quake", "Hit everyone with three or more 💥")}
    settings_schema = {
        "hp": ("Health", [(12, "12 ❤️"), (8, "8 ❤️ (quick)"), (18, "18 ❤️ (long)")], 12),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.seats = [p.id for p in seated]
        for p in seated:
            p.g.hp = self.s["hp"]
            p.g.guard = 0
            p.g.dealt = 0
        self.last = None
        self.n = 0
        self.room.add_log(f"⚔️ Dice Brawl: {self.s['hp']} ❤️ each. Last one standing wins!", "big")
        self.begin(rng.choice(seated).id)

    def begin(self, pid):
        self.dice = []
        self.held = [False] * DICE
        self.rolls = 0
        self.max_rolls = ROLLS
        p = self.room.players.get(pid)
        if p:
            p.g.guard = 0   # your shields last until your own next turn
            if 0 < p.g.hp <= LAST_STAND and len(self.alive()) > 1:
                self.max_rolls = ROLLS + 1
                self.moment(f"🩸 {p.name}: last stand! A fourth roll.", "gold", "good")
        self.room.begin_turn(pid)

    def alive(self):
        return [self.room.players[i] for i in self.seats if i in self.room.players and not self.room.players[i].eliminated]

    def skip_turn(self, p):
        return p.id not in self.seats

    # -- actions

    def act(self, p, a):
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        self.require_turn(p)
        t = a.get("type")
        if t == "roll":
            hold = a.get("hold", [])
            if not (isinstance(hold, list) and all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < DICE for i in hold)):
                raise GameError("Bad dice.")
            return self.do_roll(p, hold)
        if t == "fight":
            target = a.get("target")
            return self.do_fight(p, target)
        raise GameError("Unknown action.")

    def do_roll(self, p, hold=()):
        if self.rolls >= self.max_rolls:
            raise GameError("No rolls left — fight!")
        if self.dice:
            self.held = [i in hold or self.dice[i] == SKULL for i in range(DICE)]
            if all(self.held):
                raise GameError("Every die is held — fight!")
        self.dice = [d if self.dice and self.held[i] else self.rng.randint(1, 6) for i, d in enumerate(self.dice or [0] * DICE)]
        self.held = [self.held[i] or self.dice[i] == SKULL for i in range(DICE)] if self.rolls else [d == SKULL for d in self.dice]
        self.rolls += 1
        self.n += 1
        self.room.add_log(f"🎲 {p.name} rolls {' '.join(FACES[d] for d in self.dice)}")
        if tally(self.dice)["skulls"] >= 3:
            return self.backfire(p)

    def backfire(self, p):
        r = self.room
        p.g.hp = max(0, p.g.hp - BACKFIRE)
        self.moment(f"💀 Three skulls! {p.name}'s dice backfire: −{BACKFIRE} ❤️", "bad", "bad")
        self.last = {"by": p.id, "dice": list(self.dice), "backfire": True, "hits": {}, "n": self.n}
        self.n += 1
        if p.g.hp <= 0:
            self.knock_out(p, None)
        self.next_turn()

    def do_fight(self, p, target):
        r = self.room
        if not self.dice:
            raise GameError("Roll first.")
        t = tally(self.dice)
        rivals = [q for q in self.alive() if q.id != p.id]
        quake = t["smash"] >= 3
        if t["dmg"] and not quake:
            q = r.players.get(target) if isinstance(target, str) else None
            if not q or q not in rivals:
                raise GameError("Pick a rival to hit.")
            hit = [q]
        else:
            hit = rivals if quake else []
        hits = {}
        for q in hit:
            blocked = min(q.g.guard, t["dmg"])
            q.g.guard -= blocked
            dmg = t["dmg"] - blocked
            q.g.hp = max(0, q.g.hp - dmg)
            p.g.dealt += dmg
            hits[q.id] = [dmg, blocked]
            if blocked and not dmg:   # 🛡️ parry: the whole hit was soaked, and it stings
                p.g.hp = max(0, p.g.hp - PARRY)
                self.moment(f"🛡️ {q.name} parries {p.name}! −{PARRY} ❤️", "good", "tag")
        healed = min(t["heal"], self.s["hp"] - p.g.hp)
        p.g.hp += healed
        p.g.guard = t["shield"]
        parts = []
        if hits:
            parts.append(", ".join(f"hits {r.players[i].name} for {d}" + (f" ({b} blocked)" if b else "") for i, (d, b) in hits.items()))
        if healed:
            parts.append(f"heals {healed}")
        if t["shield"]:
            parts.append(f"raises 🛡️{t['shield']}")
        r.add_log(f"👊 {p.name} {' and '.join(parts) if parts else 'does nothing much'}.", "question")
        if quake:
            self.award(p, "quake")
            self.moment(f"🌋 {p.name} QUAKES the whole table for {t['dmg']}!", "gold", "boom")
        self.last = {"by": p.id, "dice": list(self.dice), "backfire": False, "hits": hits, "heal": healed,
                     "shield": t["shield"], "quake": quake, "n": self.n}
        self.n += 1
        for q in hit:
            if q.g.hp <= 0:
                self.knock_out(q, p)
        if p.g.hp <= 0 and not p.eliminated:   # a parry can finish the attacker
            self.knock_out(p, None)
        if r.phase == "playing":
            self.next_turn()

    def knock_out(self, q, by):
        r = self.room
        q.eliminated = True
        r.add_log(f"☠️ {q.name} is knocked out{f' by {by.name}' if by else ''}!", "power")
        self.moment(f"☠️ {q.name} is out!" + (f" ({by.name} lands the blow)" if by else ""), "bad", "boom")
        live = self.alive()
        if len(live) == 1:
            r.finish(live[0], f"🏆 {live[0].name} is the last brawler standing!")
        elif not live:
            r.finish(None, "Everyone's down!")

    def next_turn(self):
        r = self.room
        if r.phase != "playing":
            return
        r.advance()
        self.begin(r.turn)

    def on_timeout(self):
        p = self.room.players.get(self.room.turn)
        if not p:
            return
        self.room.add_log(f"⏰ {p.name} ran out of time.", "power")
        if not self.dice:
            self.do_roll(p)
            if self.room.turn != p.id or self.room.phase != "playing":
                return
        self.do_fight(p, self.pick_target(p, "normal"))

    def on_leave(self, p):
        r = self.room
        if p.id in self.seats and r.phase == "playing":
            was_turn = r.turn == p.id
            p.eliminated = True
            r.add_log(f"{p.name} left the brawl.")
            live = self.alive()
            if len(live) == 1:
                return r.finish(live[0], f"🏳️ {p.name} left — {live[0].name} wins!")
            if was_turn:
                self.next_turn()
            return
        super().on_leave(p)

    # -- bots

    def worth(self, p, dice, level):
        """How good stopping on these dice would be for p."""
        t = tally(dice)
        if t["skulls"] >= 3:
            return -BACKFIRE - (1.5 if p.g.hp <= BACKFIRE else 0)
        rivals = [q for q in self.alive() if q.id != p.id]
        if t["smash"] >= 3:
            dmg = sum(min(q.g.hp, max(0, t["dmg"] - q.g.guard)) for q in rivals)
            kills = sum(1 for q in rivals if t["dmg"] - q.g.guard >= q.g.hp)
        else:
            best = max(((min(q.g.hp, max(0, t["dmg"] - q.g.guard)), t["dmg"] - q.g.guard >= q.g.hp) for q in rivals), default=(0, False))
            dmg, kills = best[0], int(best[1])
        missing = self.s["hp"] - p.g.hp
        heal = min(t["heal"], missing) * (1.2 if p.g.hp <= 4 else 1.0)
        guard = min(t["shield"], 3) * (0.7 + 0.1 * min(3, len(rivals)))   # the next attack rarely tops 3
        return dmg + 3 * kills + heal + guard

    def pick_target(self, p, level):
        rivals = [q for q in self.alive() if q.id != p.id]
        if not rivals:
            return None
        if level == "easy":
            return self.rng.choice(rivals).id
        dmg = tally(self.dice)["dmg"] if self.dice else 0
        killable = [q for q in rivals if dmg - q.g.guard >= q.g.hp]
        if killable:
            return max(killable, key=lambda q: q.g.hp).id
        if level == "hard":
            # the most damage that sticks, and then the weakest
            return max(rivals, key=lambda q: (min(q.g.hp, max(0, dmg - q.g.guard)), -q.g.hp)).id
        return min(rivals, key=lambda q: q.g.hp).id

    def bot_turn(self, p):
        r = self.room
        level = p.bot or "normal"
        if not self.dice:
            self.do_roll(p)
            r.bot_at = time.time() + 1.0
            return
        free = [i for i in range(DICE) if self.dice[i] != SKULL]
        hold = None
        if self.rolls < self.max_rolls and free:
            if level == "easy":
                hold = [i for i in free if self.dice[i] in (SWORD, SWORD2, SMASH) or self.rng.random() < 0.3]
                if len(hold) == len(free):
                    hold = None
            elif level == "normal":
                want = {SMASH, SWORD, SWORD2} | ({HEART} if p.g.hp <= self.s["hp"] // 2 else set()) | {SHIELD}
                hold = [i for i in free if self.dice[i] in want and (self.dice[i] != SHIELD or self.rng.random() < 0.5)]
                skulls = tally(self.dice)["skulls"]
                if len(hold) == len(free) or (skulls >= 2 and self.rolls >= 2) or self.worth(p, self.dice, level) >= 8:
                    hold = None
            else:
                hold = self.best_hold(p, free)
        if hold is not None:
            self.do_roll(p, hold)
            if r.turn == p.id and r.phase == "playing":
                r.bot_at = time.time() + 1.0
            return
        self.do_fight(p, self.pick_target(p, level))

    def best_hold(self, p, free):
        """Hard: an exact search over every hold and reroll left this turn (the two sword faces count as one
        kind, so a hand is just how many of each kind); None means stop here."""
        worth = {}

        def stop(c):
            if c not in worth:
                worth[c] = self.worth(p, [k for k, n in zip(KINDS, c) for _ in range(n)], "hard")
            return worth[c]

        memo = {}

        def value(c, left):
            if c[0] >= 3 or not left:
                return stop(c)
            key = (c, left)
            if key not in memo:
                memo[key] = max([stop(c)] + [ev(h, left) for h in holds(c)])
            return memo[key]

        def ev(h, left):
            k = DICE - sum(h)
            return sum(pr * value(tuple(a + b for a, b in zip(h, o)), left - 1) for o, pr in outcomes(k))

        c = counts(self.dice)
        left = self.max_rolls - self.rolls
        best, pick = stop(c) + 0.05, None
        for h in holds(c):
            v = ev(h, left)
            if v > best:
                best, pick = v, h
        if pick is None:
            return None
        want = list(pick)
        hold = []
        for i, d in enumerate(self.dice):
            k = KINDS.index(SWORD if d == SWORD2 else d)
            if want[k] and d != SKULL:
                want[k] -= 1
                hold.append(i)
        return hold

    # -- view

    def meta(self, p):
        hp = getattr(p.g, "hp", None)
        if hp is None:
            return ""
        return "☠️ out" if hp <= 0 else f"❤️{hp}" + (f" 🛡️{p.g.guard}" if p.g.guard else "")

    def final_scores(self):
        return {i: self.room.players[i].g.dealt for i in self.seats if i in self.room.players}

    def view(self, p):
        r = self.room
        return {"brawl": {
            "seats": self.seats, "dice": self.dice, "held": self.held, "rolls": self.rolls, "maxRolls": getattr(self, "max_rolls", ROLLS),
            "tally": tally(self.dice) if self.dice else None, "maxHp": self.s["hp"], "last": self.last, "n": self.n,
            "hp": {i: r.players[i].g.hp for i in self.seats if i in r.players},
            "guard": {i: r.players[i].g.guard for i in self.seats if i in r.players},
        }}
