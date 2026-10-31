"""Qork: a reaction dice game. The Cupper keeps rolling two dice; on doubles or a sum of seven the
Corkers yank their Qorks off the mat and the Cupper slams the cup down to trap them.

Reaction times are measured in each browser from the moment the dice appear there, so a slow
network doesn't cost anyone the race. Bots get reaction times drawn by difficulty."""
import random
import time

from .base import Game, GameError

TUMBLE = 0.8      # dice tumble before they land
WINDOW = 1.6      # seconds to react to a trigger
SLACK = 0.5       # extra time for the last reactions to arrive over the network
GAP = 0.7         # a non-trigger roll stays up at least this long
AUTO_ROLL = 4.0   # an idle human Cupper rolls automatically
RESULT = 3.2      # the trapped/escaped reveal

REACT = {"easy": (640, 130), "normal": (480, 90), "hard": (350, 60)}   # ms mean, spread
FLINCH = {"easy": 0.10, "normal": 0.07, "hard": 0.02}                  # on a near miss (6 or 8, or 1 apart)


def trigger(dice):
    a, b = dice
    return "doubles" if a == b else "seven" if a + b == 7 else None


def near(dice):
    a, b = dice
    return a + b in (6, 8) or abs(a - b) == 1


class Qork(Game):
    id = "qork"
    category = "dice"
    howto = [
        "One player is the 🥤 Cupper and keeps rolling two dice; everyone else is a Corker with a Qork on the mat.",
        "On doubles or a total of 7, Corkers tap YANK to pull their Qork away, and the Cupper taps SLAM.",
        "Yank before the cup lands: +1. Too slow: you're trapped and the Cupper gets +1 (all trapped: +1 more).",
        "Jumping early on any other roll costs you 1 point — Cuppers too.",
        "The cup passes each round. Most points after everyone has been Cupper wins.",
    ]
    name = "Qork"
    icon = "🥤"
    blurb = "Doubles or seven? Yank your Qork before the cup slams down."
    min_players = 2
    max_players = 6
    settings_schema = {
        "laps": ("Turns as Cupper", [(1, "1 each"), (2, "2 each"), (3, "3 each")], 2),
    }

    # -- setup and clock

    def start(self, seated, rng):
        self.rng = rng
        self.skew = 0.0  # the bot simulator fast-forwards this virtual clock
        self.seats = [p.id for p in seated]
        rng.shuffle(self.seats)
        self.rounds = self.s["laps"] * len(self.seats)
        self.round = 0
        for p in seated:
            p.g.score = 0
            p.g.escapes = 0
            p.g.traps = 0
        self.room.turn = None
        self.room.bot_at = 0
        self.room.add_log(f"🥤 Qork! {self.rounds} rounds — watch for doubles and sevens.", "big")
        self.new_round()

    def now(self):
        return time.time() + self.skew

    def on_restore(self, shift):
        self.skew -= shift

    def new_round(self):
        alive = [pid for pid in self.seats if not self.room.players[pid].eliminated]
        self.round += 1
        self.cupper = alive[(self.round - 1) % len(alive)]
        self.rolls = []        # this round's dice, oldest first
        self.roll_no = 0
        self.dice = None
        self.acted = {}        # pid -> ms (negative: jumped before the dice landed) this roll
        self.result = None
        self.plans = []
        self.wait_roll()
        self.room.add_log(f"🥤 Round {self.round}/{self.rounds}: {self.room.players[self.cupper].name} holds the cup.")

    def wait_roll(self, after=0.0):
        """Waiting for the Cupper to roll (allowed from ok_at)."""
        self.stage = "wait" if self.dice is None else "dice"
        self.ok_at = self.now() + after
        bot = self.room.players[self.cupper].bot
        self.auto_at = self.ok_at + (random.uniform(0.5, 1.3) if bot else AUTO_ROLL)
        self.sched()

    def next_event(self):
        if self.stage in ("wait", "dice"):
            times = [self.auto_at]
        elif self.stage == "tumble":
            times = [self.show_at]
        elif self.stage == "snap":
            times = [self.close_at]
        else:
            times = [self.end]
        return min(times + [t for t, _ in self.plans[:1]])

    def sched(self):
        self.room.deadline = self.next_event() - self.skew

    # -- clock hooks

    def bot_ready(self):
        return self.room.phase == "playing" and self.now() >= self.next_event()

    def bot_tick(self):
        self.process()

    def on_timeout(self):
        gap = self.next_event() - self.now()
        if gap > 0:
            self.skew += gap
        self.process()

    def process(self):
        now = self.now()
        while self.plans and self.plans[0][0] <= now:
            t, pid = self.plans.pop(0)
            p = self.room.players.get(pid)
            if p and not p.eliminated and pid not in self.acted:
                self.react(p, round((t - self.show_at) * 1000))
            if self.stage == "result":
                break
        if self.stage in ("wait", "dice") and now >= self.auto_at:
            self.roll()
        elif self.stage == "tumble" and now >= self.show_at:
            self.land()
        elif self.stage == "snap" and now >= self.close_at:
            self.resolve()
        elif self.stage == "result" and now >= self.end:
            if self.round >= self.rounds:
                return self.finish_game()
            self.new_round()
        self.sched()

    # -- rolling

    def roll(self):
        self.roll_no += 1
        self.dice = None
        self.acted = {}
        self.plans = []
        self.stage = "tumble"
        self.show_at = self.now() + TUMBLE
        self.pending = (self.rng.randint(1, 6), self.rng.randint(1, 6))
        self.sched()

    def land(self):
        self.dice = self.pending
        self.rolls = (self.rolls + [list(self.dice)])[-8:]
        kind = trigger(self.dice)
        a, b = self.dice
        if kind:
            self.stage = "snap"
            self.close_at = self.show_at + WINDOW + SLACK
            self.room.add_log(f"🎲 {a} + {b} — {'DOUBLES' if kind == 'doubles' else 'SEVEN'}!", "power")
        else:
            self.room.add_log(f"🎲 {a} + {b}")
            self.wait_roll(GAP)
        self.plan_bots(kind)

    def plan_bots(self, kind):
        """Bots react after a human-like delay, and sometimes flinch at a near miss."""
        self.plans = []
        for p in self.room.contenders():
            if not p.bot or p.id in self.acted:
                continue
            mu, sd = REACT[p.bot]
            ms = max(190, random.gauss(mu, sd))
            if kind or (near(self.dice) and random.random() < FLINCH[p.bot] * (0.4 if p.id == self.cupper else 1)):
                self.plans.append((self.show_at + ms / 1000, p.id))
        self.plans.sort()

    # -- reactions

    def act(self, p, a):
        if a.get("type") == "roll":
            if p.id != self.cupper:
                raise GameError("Only the Cupper rolls.")
            if self.stage not in ("wait", "dice") or self.now() < self.ok_at:
                raise GameError("Not yet!")
            self.roll()
            return
        if a.get("type") != "react":
            raise GameError("Unknown action.")
        if p.spectator or p.eliminated or not hasattr(p.g, "score"):
            raise GameError("You're watching this game.")
        ms = a.get("ms")
        if not isinstance(ms, (int, float)) or isinstance(ms, bool) or not -60000 < ms < 60000:
            raise GameError("Bad reaction time.")
        if self.stage in ("wait", "result"):
            raise GameError("Wait for the dice!")
        if p.id in self.acted:
            return
        if self.stage == "tumble":
            ms = -1
        else:
            # Nobody can be faster than the time since the dice landed here, plus a little clock fuzz.
            ms = min(ms, (self.now() - self.show_at) * 1000 + 150)
        self.react(p, round(ms))
        self.sched()

    def react(self, p, ms):
        self.acted[p.id] = ms
        cup = p.id == self.cupper
        if self.stage != "snap" or ms < 0:
            p.g.score -= 1
            what = "slammed the cup on nothing" if cup else "yanked too early"
            self.room.add_log(f"😬 {p.name} {what} — −1.", "info")
            return
        if all(q.id in self.acted for q in self.room.contenders()):
            self.resolve()

    def resolve(self):
        r = self.room
        cup = r.players[self.cupper]
        slam = self.acted.get(self.cupper)
        corkers = [q for q in r.contenders() if q.id != self.cupper]
        escaped, trapped, frozen = [], [], []
        for q in corkers:
            y = self.acted.get(q.id)
            if y is not None and (slam is None or y < slam):
                escaped.append(q)
                q.g.score += 1
                q.g.escapes += 1
            elif slam is not None:
                trapped.append(q)
            else:
                frozen.append(q)
        gain = len(trapped) + (1 if trapped and len(trapped) == len(corkers) and len(corkers) > 1 else 0)
        cup.g.score += gain
        cup.g.traps += len(trapped)
        names = lambda qs: ", ".join(q.name for q in qs)
        if slam is None:
            r.add_log(f"🐢 {cup.name} never slammed the cup!" + (f" Escaped: {names(escaped)}." if escaped else ""), "big")
        elif trapped:
            sweep = " Clean sweep!" if gain > len(trapped) else ""
            r.add_log(f"🥤 SLAM! {cup.name} traps {names(trapped)} (+{gain}).{sweep}"
                      + (f" Escaped: {names(escaped)}." if escaped else ""), "big")
        else:
            r.add_log(f"💨 Everyone escaped {cup.name}'s cup!", "big")
        self.result = {"slam": slam, "times": dict(self.acted),
                       "escaped": [q.id for q in escaped], "trapped": [q.id for q in trapped], "gain": gain}
        self.stage = "result"
        self.plans = []
        self.end = self.now() + RESULT

    def finish_game(self):
        r = self.room
        ranked = sorted(r.contenders(), key=lambda q: -q.g.score)
        text = " · ".join(f"{q.name} {q.g.score}" for q in ranked)
        if len(ranked) > 1 and ranked[0].g.score == ranked[1].g.score:
            return r.finish(None, f"🤝 It's a tie! {text}")
        r.finish(ranked[0], f"🏆 {ranked[0].name} wins Qork! {text}")

    def final_scores(self):
        return {q.id: q.g.score for q in self.room.contenders() if hasattr(q.g, "score")}

    def on_leave(self, p):
        r = self.room
        r.add_log(f"{p.name} left the game.")
        p.eliminated = True
        left = r.contenders()
        if len(left) < 2:
            return r.finish(left[0] if left else None, f"🏳️ {p.name} left — {left[0].name} wins!" if left else "Everyone left.")
        self.plans = [(t, pid) for t, pid in self.plans if pid != p.id]
        if p.id == self.cupper and self.stage != "result":
            self.stage, self.end, self.result = "result", self.now(), None
        elif self.stage == "snap" and all(q.id in self.acted for q in left):
            self.resolve()
        self.sched()

    # -- view

    def meta(self, p):
        if not hasattr(p.g, "score"):
            return ""
        return ("🥤 " if p.id == getattr(self, "cupper", None) else "") + f"{p.g.score} pts"

    def view(self, p):
        now = self.now()
        return {"qork": {
            "stage": self.stage, "round": self.round, "rounds": self.rounds, "cupper": self.cupper,
            "rollNo": self.roll_no, "dice": list(self.dice) if self.dice else None,
            "trigger": trigger(self.dice) if self.dice else None, "rolls": self.rolls,
            "acted": {pid: ms >= 0 and self.stage in ("snap", "result") for pid, ms in self.acted.items()},
            "canRoll": max(0.0, self.ok_at - now) if self.stage in ("wait", "dice") else None,
            "auto": max(0.0, self.auto_at - now) if self.stage in ("wait", "dice") else None,
            "window": WINDOW, "result": self.result,
            "corkers": [q.id for q in self.room.contenders() if q.id != self.cupper],
            "scores": {q.id: q.g.score for q in self.room.contenders() if hasattr(q.g, "score")},
        }}
