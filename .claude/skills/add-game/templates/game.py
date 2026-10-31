"""Race to 21: players take turns adding 1, 2 or 3 to a shared counter; whoever makes it 21 wins.

TEMPLATE for new Game Night games: a complete, working turn-based game with a bot. Copy this file
to games/<id>.py, rename the class and id, then replace the rules. See SKILL.md for the contract."""
import random

from .base import Game, GameError

TARGET = 21


class RaceTo21(Game):
    id = "race21"
    category = "classic"
    howto = [
        "Take turns adding 1, 2 or 3 to the counter.",
        f"Whoever brings the counter to exactly {TARGET} wins.",
        "Tip: think backwards from the target.",
    ]
    name = "Race to 21"
    icon = "🔢"
    blurb = f"Add 1, 2 or 3 to the counter. Hit {TARGET} first to win."
    min_players = 2
    max_players = 4
    settings_schema = {
        "target": ("Target", [(21, "21"), (31, "31")], 21),
    }

    # -- setup

    def start(self, seated, rng):
        self.rng = rng
        self.target = self.s["target"]
        self.count = 0
        self.last = None
        for p in seated:
            p.g.adds = 0  # per-player state lives in p.g (reset before every game)
        first = rng.choice(seated)
        self.room.add_log(f"🔢 Race to {self.target}! {first.name} goes first.", "big")
        self.room.begin_turn(first.id)

    # -- actions

    def act(self, p, a):
        if a.get("type") != "add":
            raise GameError("Unknown action.")
        self.require_turn(p)
        n = a.get("n")
        if n not in (1, 2, 3) or self.count + n > self.target:
            raise GameError(f"Add 1, 2 or 3 without going past {self.target}.")
        self.add(p, n)

    def add(self, p, n):
        self.count += n
        p.g.adds += 1
        self.last = {"by": p.id, "n": n}
        self.room.add_log(f"{p.name} adds {n} → {self.count}", "question")
        if self.count == self.target:
            return self.room.finish(p, f"🏆 {p.name} hits {self.target} and wins!")
        self.room.advance()

    # -- what each player sees

    def meta(self, p):
        return f"{p.g.adds} moves" if hasattr(p.g, "adds") else ""

    def view(self, p):
        return {"race21": {"count": self.count, "target": self.target, "last": self.last}}

    # -- bot: one decision per call

    def bot_turn(self, p):
        options = [n for n in (1, 2, 3) if self.count + n <= self.target]
        # Perfect play leaves the counter at target - 4k; weaker bots only sometimes manage it.
        winning = [n for n in options if (self.target - self.count - n) % 4 == 0]
        skill = {"easy": 0.2, "normal": 0.6, "hard": 1.0}[p.bot]
        n = winning[0] if winning and random.random() < skill else random.choice(options)
        self.add(p, n)
