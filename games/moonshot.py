"""Moon Shot: a push-your-luck dice race along a track full of space hazards."""
import random
import time

from .base import Game, GameError

TILE_TEXT = {"star": "⭐ boost +5", "meteor": "☄️ meteor −5", "wormhole": "🌀 wormhole: swap with the leader"}
MAX_SHIELDS = 2
SOLO_TURNS = {30: 4, 50: 6, 75: 9}  # alone: reach the moon within this many turns


class MoonShot(Game):
    id = "moonshot"
    category = "dice"
    howto = [
        'Roll two dice to build fuel, then Fly to move that far.',
        "Any 1 loses this turn's fuel; double 1s crash you back to the start.",
        'Doubles earn a 🛡️ shield. Stopping on ⭐ +5, ☄️ −5, 🌀 swaps you with the leader.',
        'First to the moon wins. Alone, reach it within a turn limit (4, 6 or 9 turns by distance).',
    ]
    name = "Moon Shot"
    icon = "🚀"
    blurb = ("Roll two dice to build fuel, then bank it to fly. A 1 loses this turn's fuel, double 1s crash you "
             "back to the start. Stars boost, meteors knock you back, wormholes swap you with the leader.")
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "wormhole": ("🌀", "Shortcut", "Swap places with the leader through a wormhole"),
              "one_shot": ("🌕", "Straight to the moon", "Fly from the launch pad to the moon in one go")}
    settings_schema = {
        "goal": ("Distance", [(30, "Short (30)"), (50, "Classic (50)"), (75, "Long (75)")], 50),
        "hazards": ("Space hazards", [(True, "On"), (False, "Off")], True),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.goal = self.s["goal"]
        self.seats = [p.id for p in seated]
        self.pos = {p.id: 0 for p in seated}
        self.shields = {p.id: 0 for p in seated}
        self.fuel = 0
        self.dice = None
        self.tiles = {}
        if self.s["hazards"]:
            cells = rng.sample(range(4, self.goal - 1), self.goal // 5)
            for c in cells:
                self.tiles[c] = rng.choices(["star", "meteor", "wormhole"], weights=[4, 4, 2])[0]
        self.turns = 0  # turns finished (counted alone, for the solo limit)
        first = rng.choice(seated)
        if len(seated) == 1:
            self.room.add_log(f"🚀 Reach the moon ({self.goal}) within {self.limit()} turns!", "big")
            return self.room.begin_turn(first.id)
        self.room.add_log(f"🚀 Race to {self.goal}! {first.name} launches first.", "big")
        self.room.begin_turn(first.id)

    turns = 0  # games saved before the solo mode

    def limit(self):
        return SOLO_TURNS.get(self.goal, 6)

    def solo(self):
        return len(self.seats) == 1

    def late_join(self, p):
        """Launch from the start; turns come round in seat order."""
        self.seats.append(p.id)
        self.pos[p.id] = 0
        self.shields[p.id] = 0

    def act(self, p, a):
        self.require_turn(p)
        t = a.get("type")
        if t == "roll":
            return self.roll(p)
        if t == "bank":
            if not self.fuel:
                raise GameError("Roll first — you have no fuel to bank.")
            return self.bank(p)
        raise GameError("Unknown action.")

    def roll(self, p):
        r = self.room
        d = sorted((self.rng.randint(1, 6), self.rng.randint(1, 6)))
        self.dice = d
        if d == [1, 1]:
            lost = self.fuel
            self.fuel = 0
            if self.shields[p.id]:
                self.shields[p.id] -= 1
                r.add_log(f"💥 {p.name} rolled double 1s — the 🛡️ shield saved their rocket (lost {lost} fuel).", "power")
            else:
                self.pos[p.id] = 0
                r.add_log(f"💥 {p.name} rolled double 1s and crashed back to the launch pad!", "big")
            return self.end_turn()
        if 1 in d:
            r.add_log(f"🎲 {p.name} rolled {d[0]}+{d[1]} — a 1! Lost {self.fuel} fuel.", "power")
            self.fuel = 0
            return self.end_turn()
        self.fuel += sum(d)
        extra = ""
        if d[0] == d[1] and self.shields[p.id] < MAX_SHIELDS:
            self.shields[p.id] += 1
            extra = " Doubles: +🛡️ shield!"
        r.add_log(f"🎲 {p.name} rolled {d[0]}+{d[1]} → {self.fuel} fuel.{extra}")
        if self.pos[p.id] + self.fuel >= self.goal:
            self.bank(p)  # nothing to gain by rolling on

    def bank(self, p):
        r = self.room
        fuel, self.fuel = self.fuel, 0
        land = self.pos[p.id] + fuel
        self.pos[p.id] = land
        msg = f"🚀 {p.name} flew {fuel} to {min(land, self.goal)}"
        kind = self.tiles.get(land)
        if kind == "star":
            self.pos[p.id] += 5
            msg += f" and hit a ⭐ boost → {self.pos[p.id]}"
        elif kind == "meteor":
            if self.shields[p.id]:
                self.shields[p.id] -= 1
                msg += ", where the 🛡️ shield blocked a ☄️ meteor"
            else:
                self.pos[p.id] = max(0, land - 5)
                msg += f" — ☄️ meteor! Knocked back to {self.pos[p.id]}"
        elif kind == "wormhole":
            leader = max(self.seats, key=lambda i: self.pos[i] if i in r.players else -1)
            if leader != p.id and self.pos[leader] > land:
                self.pos[p.id], self.pos[leader] = self.pos[leader], land
                self.award(p, "wormhole")
                msg += f" — 🌀 wormhole! Swapped places with {r.players[leader].name}"
            else:
                msg += " — 🌀 wormhole, but they're already in the lead"
        r.add_log(msg + ".", "question")
        if self.pos[p.id] >= self.goal:
            self.pos[p.id] = self.goal
            if fuel >= self.goal:
                self.award(p, "one_shot")
            if self.solo():
                return r.finish(p, f"🌕 {p.name} reached the moon on turn {self.turns + 1} of {self.limit()}!")
            return r.finish(p, f"🌕 {p.name} reached the moon!")
        self.end_turn()

    def end_turn(self):
        self.fuel = 0
        self.turns += 1
        if self.solo() and self.turns >= self.limit():
            p = self.room.players.get(self.seats[0])
            return self.room.finish(None, f"🌑 Out of turns: {p.name if p else '?'} got to {self.pos[self.seats[0]]} of {self.goal}.")
        self.room.advance()

    def on_timeout(self):
        p = self.room.players[self.room.turn]
        if self.fuel:
            self.room.add_log(f"⏰ {p.name} ran out of time — auto-banking.", "power")
            return self.bank(p)
        super().on_timeout()

    def meta(self, p):
        if p.id not in self.pos:
            return ""
        return f"🚀{self.pos[p.id]}/{self.goal}" + "🛡️" * self.shields[p.id]

    def final_scores(self):
        return dict(self.pos)

    def view(self, p):
        turn = self.room.turn
        preview = None
        if turn in self.pos and self.fuel:
            land = self.pos[turn] + self.fuel
            preview = {"cell": land, "tile": self.tiles.get(land)}
        return {"moon": {
            "goal": self.goal, "seats": self.seats, "turnsLeft": self.limit() - self.turns if self.solo() else None, "pos": self.pos, "shields": self.shields,
            "tiles": {str(k): v for k, v in self.tiles.items()}, "fuel": self.fuel, "dice": self.dice,
            "preview": preview, "tileText": TILE_TEXT,
        }}

    # -- bot: one roll or bank per tick so humans can follow along

    def bot_turn(self, p):
        if self.should_roll(p):
            self.roll(p)
            if self.room.turn == p.id and self.room.phase == "playing":
                self.room.bot_at = time.time() + 0.9
        else:
            self.bank(p)

    def should_roll(self, p):
        if not self.fuel:
            return True
        me = self.pos[p.id]
        land = me + self.fuel
        if land >= self.goal:
            return False
        if p.bot == "easy":
            return self.fuel < random.choice([8, 10, 12, 16])
        kind = self.tiles.get(land)
        if kind == "star":
            return False
        if kind == "meteor" and not self.shields[p.id]:
            return True
        others = [self.pos[i] for i in self.seats if i != p.id and i in self.room.players]
        lead = max(others, default=0)
        threshold = 15
        if p.bot == "hard":
            if kind == "wormhole" and lead > land:
                return False
            threshold += max(0, lead - me) // 4          # behind: take more risk
            if lead >= self.goal - 12:
                threshold = self.goal - me              # someone's about to win: go for it
        return self.fuel < threshold
