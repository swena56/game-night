"""Moon Shot: a push-your-luck dice race along a track full of space hazards."""
import random
import time

from .base import Game, GameError

TILE_TEXT = {"star": "⭐ boost +5", "meteor": "☄️ meteor −5", "wormhole": "🌀 wormhole: swap with the leader"}
MAX_SHIELDS = 2
SOLO_TURNS = {30: 4, 50: 6, 75: 9}  # alone: reach the moon within this many turns


class MoonShot(Game):
    id = "moonshot"
    solo_bots = 2
    category = "dice"
    howto = [
        'Roll two dice to build fuel, then Fly to move that far. The route forecast shows where Fly or each possible next roll could take you.',
        "Any 1 loses this turn's fuel; double 1s crash you back to the start.",
        'Doubles earn a 🛡️ shield. Stopping on ⭐ +5, ☄️ −5, 🌀 swaps you with the leader.',
        'With 💥 Bumping on, landing exactly on a rival knocks them back 3.',
        '🌬️ An option: stop 1 or 2 squares behind a rival and you slipstream onto their square.',
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
        "slip": ("🌬️ Slipstream", [(True, "On: 1-2 behind a rival, draft up"), (False, "Off")], True),
        "bump": ("💥 Bumping", [(False, "Off"), (True, "On: land on a rival to knock them back 3")], False),
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

    def route(self, pid, fuel, shield):
        """Resolve where a flight would end using only the current public track."""
        cell = self.pos[pid] + fuel
        tile = self.tiles.get(cell)
        rivals = {i: self.pos[i] for i in self.seats if i != pid and i in self.room.players}
        destination = cell
        swap = None
        shielded = False
        if tile == "star":
            destination += 5
        elif tile == "meteor":
            shielded = bool(shield)
            if not shielded:
                destination = max(0, cell - 5)
        elif tile == "wormhole":
            leader = max(rivals, key=rivals.get, default=None)
            if leader is not None and rivals[leader] > cell:
                swap, destination = leader, rivals[leader]
                rivals[leader] = cell
        draft = None
        if self.s.get("slip", True) and 0 < destination < self.goal:
            draft = min((pos for pos in rivals.values() if 1 <= pos - destination <= 2), default=None)
            if draft is not None:
                destination = draft
        bumped = [i for i, pos in rivals.items() if pos == destination] if (
            self.s.get("bump") and 0 < destination < self.goal
        ) else []
        return {"cell": cell, "tile": tile, "end": min(destination, self.goal), "swap": swap,
                "shielded": shielded, "draft": draft, "bumped": bumped}

    def bank(self, p):
        r = self.room
        fuel, self.fuel = self.fuel, 0
        route = self.route(p.id, fuel, self.shields[p.id])
        land, kind, here = route["cell"], route["tile"], route["end"]
        self.pos[p.id] = here
        msg = f"🚀 {p.name} flew {fuel} to {min(land, self.goal)}"
        if fuel >= 15 and land < self.goal:
            self.moment(f"🚀 {p.name} flies {fuel}!", "gold", "whoosh")
        if kind == "star":
            msg += f" and hit a ⭐ boost → {land + 5}"
        elif kind == "meteor":
            if route["shielded"]:
                self.shields[p.id] -= 1
                msg += ", where the 🛡️ shield blocked a ☄️ meteor"
            else:
                msg += f" — ☄️ meteor! Knocked back to {max(0, land - 5)}"
        elif kind == "wormhole":
            leader = route["swap"]
            if leader is not None:
                self.pos[leader] = land
                self.award(p, "wormhole")
                self.moment(f"🌀 {p.name} swaps places with {r.players[leader].name}!", "gold", "whoosh")
                msg += f" — 🌀 wormhole! Swapped places with {r.players[leader].name}"
            else:
                msg += " — 🌀 wormhole, but they're already in the lead"
        if route["draft"] is not None:
            msg += f" and 🌬️ slipstreamed up to {here}"
            self.moment(f"🌬️ {p.name} slipstreams to {here}!", "gold", "whoosh")
        if route["bumped"]:
            for i in route["bumped"]:
                self.pos[i] = max(0, here - 3)
            msg += f" and 💥 bumped {' & '.join(r.players[i].name for i in route['bumped'])} back to {max(0, here - 3)}"
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
            preview = self.route(turn, self.fuel, self.shields[turn])
        rolls = []
        if turn == p.id and turn in self.pos:
            for first in range(1, 7):
                for second in range(first, 7):
                    if first == 1:
                        route = {"end": 0 if second == 1 and not self.shields[turn] else self.pos[turn],
                                 "lost": True, "shielded": second == 1 and bool(self.shields[turn])}
                    else:
                        shield = min(MAX_SHIELDS, self.shields[turn] + (first == second))
                        route = self.route(turn, self.fuel + first + second, shield)
                    rolls.append({"dice": [first, second], **route})
        return {"moon": {
            "goal": self.goal, "seats": self.seats, "turnsLeft": self.limit() - self.turns if self.solo() else None, "pos": self.pos, "shields": self.shields,
            "tiles": {str(k): v for k, v in self.tiles.items()}, "fuel": self.fuel, "dice": self.dice,
            "preview": preview, "rolls": rolls, "tileText": TILE_TEXT,
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
