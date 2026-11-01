"""Sea Battle: the classic pencil-and-paper fleet hunt. Both players hide a fleet,
then take turns firing at grid squares. Variants: hit = fire again, or Salvo (one
shot per ship still afloat). Optional sonar: once per game, count the ship squares
in a 3×3 area instead of firing."""
import random
import time

from .base import Game, GameError

N = 10
FLEET = [("Carrier", 5), ("Battleship", 4), ("Cruiser", 3), ("Submarine", 3), ("Destroyer", 2)]
ROWS = "ABCDEFGHIJKL"
FLEET_BIG = FLEET + [("Frigate", 3)]  # the 12×12 board gets a sixth ship


def cell_name(r, c):
    return f"{ROWS[r]}{c + 1}"


def ship_cells(r, c, length, horizontal):
    return [(r, c + i) if horizontal else (r + i, c) for i in range(length)]


def random_fleet(rng, n=N, fleet_spec=FLEET):
    while True:
        taken, fleet = set(), []
        for name, length in fleet_spec:
            for _ in range(200):
                h = rng.random() < 0.5
                r = rng.randrange(n if h else n - length + 1)
                c = rng.randrange(n - length + 1 if h else n)
                cells = ship_cells(r, c, length, h)
                if not taken & set(cells):
                    taken |= set(cells)
                    fleet.append([r, c, length, h])
                    break
            else:
                break
        if len(fleet) == len(fleet_spec):
            return fleet


class SeaBattle(Game):
    id = "seabattle"
    category = "classic"
    howto = [
        'Place your ships (five, or six on the 12×12 sea), or tap Random, then tap Ready.',
        'Take turns firing at the enemy grid: 💦 miss, 🔥 hit, ✖ sunk.',
        'Depending on the rule, a hit fires again or you fire one shot per ship afloat.',
        'Sonar (once): counts the ship squares in a 3×3 area. Sink every ship to win.',
    ]
    name = "Sea Battle"
    icon = "🚢"
    blurb = "Hide your fleet, then hunt theirs square by square. Sink every ship to win."
    settings_schema = {
        "shots": ("Firing rule", [("classic", "1 shot per turn"), ("chain", "Hit = fire again"),
                                  ("salvo", "Salvo: 1 shot per ship afloat")], "chain"),
        "sonar": ("Sonar", [(True, "📡 One scan each"), (False, "Off")], True),
        "size": ("Sea", [(10, "10×10, 5 ships"), (12, "12×12, 6 ships")], 10),
    }
    n = N  # games saved before the 12×12 sea

    def fleet_spec(self):
        return FLEET_BIG if self.n == 12 else FLEET

    def start(self, seated, rng):
        self.rng = rng
        self.n = self.s.get("size", N)
        self.seats = [p.id for p in seated]
        self.stage = "placing"
        self.shots_left = 0
        self.last = None
        for p in seated:
            p.g.ships = None   # [{name, cells, hits}]
            p.g.shots = {}     # (r, c) -> "miss" | "hit" | "sunk"  (my shots at the enemy)
            p.g.sonar = 1 if self.s["sonar"] else 0
            p.g.scans = []     # [r, c, count]
        t = self.s["timer"]
        self.room.deadline = time.time() + max(60, 2 * t) if t else None
        self.room.add_log("🚢 Place your fleet — tap Random for a quick layout, then Ready.", "big")

    def opponent(self, p):
        return self.room.players.get(self.seats[1 - self.seats.index(p.id)])

    def set_fleet(self, p, layout):
        if not isinstance(layout, list) or len(layout) != len(self.fleet_spec()):
            raise GameError("Place all your ships.")
        taken, ships = set(), []
        for (name, length), item in zip(self.fleet_spec(), layout):
            if not (isinstance(item, list) and len(item) == 4 and item[2] == length):
                raise GameError(f"Bad position for the {name}.")
            r, c, _, h = item
            if not (isinstance(r, int) and isinstance(c, int)):
                raise GameError(f"Bad position for the {name}.")
            cells = ship_cells(r, c, length, bool(h))
            if any(not (0 <= y < self.n and 0 <= x < self.n) for y, x in cells):
                raise GameError(f"The {name} doesn't fit there.")
            if taken & set(cells):
                raise GameError(f"The {name} overlaps another ship.")
            taken |= set(cells)
            ships.append({"name": name, "cells": cells, "hits": set()})
        p.g.ships = ships

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if p.id not in self.seats:
            raise GameError("You're not playing.")
        if t == "place":
            if self.stage != "placing":
                raise GameError("The battle has already started.")
            self.set_fleet(p, a.get("ships"))
            self.room.add_log(f"⚓ {p.name} is ready.")
            return self.maybe_begin()
        if self.stage != "firing":
            raise GameError("Still placing fleets.")
        self.require_turn(p)
        r, c = a.get("r"), a.get("c")
        if not (isinstance(r, int) and isinstance(c, int) and 0 <= r < self.n and 0 <= c < self.n):
            raise GameError("Pick a square.")
        if t == "fire":
            if (r, c) in p.g.shots:
                raise GameError("You already fired there.")
            return self.fire(p, r, c)
        if t == "sonar":
            if not p.g.sonar:
                raise GameError("No sonar left.")
            return self.scan(p, r, c)
        raise GameError("Unknown action.")

    def maybe_begin(self):
        players = [self.room.players[i] for i in self.seats if i in self.room.players]
        if all(p.g.ships for p in players):
            self.stage = "firing"
            first = self.rng.choice(players)
            self.room.add_log(f"🔥 All fleets are hidden. {first.name} fires first!", "big")
            self.begin(first)

    def begin(self, p):
        self.room.begin_turn(p.id)
        self.shots_left = self.shot_count(p)

    def shot_count(self, p):
        if self.s["shots"] == "salvo":
            return sum(1 for s in p.g.ships if len(s["hits"]) < len(s["cells"]))
        return 1

    def fire(self, p, r, c):
        room = self.room
        opp = self.opponent(p)
        self.last = [r, c]
        ship = next((s for s in opp.g.ships if (r, c) in s["cells"]), None)
        if not ship:
            p.g.shots[(r, c)] = "miss"
            room.add_log(f"{p.name} fires at {cell_name(r, c)} — 💦 miss.")
            hit = False
        else:
            ship["hits"].add((r, c))
            hit = True
            if len(ship["hits"]) == len(ship["cells"]):
                for cell in ship["cells"]:
                    p.g.shots[cell] = "sunk"
                room.add_log(f"{p.name} fires at {cell_name(r, c)} — 💥 sank the {ship['name']}!", "big")
                if all(len(s["hits"]) == len(s["cells"]) for s in opp.g.ships):
                    return room.finish(p, f"🏆 {p.name} sank the whole fleet!")
            else:
                p.g.shots[(r, c)] = "hit"
                room.add_log(f"{p.name} fires at {cell_name(r, c)} — 🔥 hit!", "question")
        self.after_shot(p, hit)

    def scan(self, p, r, c):
        opp = self.opponent(p)
        p.g.sonar -= 1
        cells = {(y, x) for y in range(r - 1, r + 2) for x in range(c - 1, c + 2) if 0 <= y < self.n and 0 <= x < self.n}
        count = sum(1 for s in opp.g.ships for cell in s["cells"] if cell in cells)
        p.g.scans.append([r, c, count])
        self.room.add_log(f"📡 {p.name} used sonar around {cell_name(r, c)}.", "power")
        self.room.add_log(f"📡 Sonar: {count} ship square{'s' * (count != 1)} in the 3×3 around {cell_name(r, c)}.",
                          "private", to=p.id)
        self.after_shot(p, False)

    def after_shot(self, p, hit):
        self.shots_left -= 1
        if self.s["shots"] == "chain" and hit:
            self.shots_left = 1
        if self.shots_left > 0:
            if p.bot:
                self.room.bot_at = time.time() + 0.8
            return
        self.begin(self.opponent(p))

    def on_timeout(self):
        room = self.room
        if self.stage == "placing":
            for i in self.seats:
                p = room.players.get(i)
                if p and not p.g.ships:
                    self.set_fleet(p, random_fleet(self.rng, self.n, self.fleet_spec()))
                    room.add_log(f"⏰ {p.name}'s fleet was placed automatically.", "power")
            return self.maybe_begin()
        p = room.players[room.turn]
        room.add_log(f"⏰ {p.name} ran out of time.", "power")
        self.shots_left = 0
        self.begin(self.opponent(p))

    # -- view

    def meta(self, p):
        ships = getattr(p.g, "ships", None)
        if self.stage == "placing":
            return "⚓ ready" if ships else "placing…" if p.id in self.seats else ""
        if not ships:
            return ""
        return f"🚢 {sum(1 for s in ships if len(s['hits']) < len(s['cells']))} afloat"

    def view(self, p):
        room = self.room
        me = room.players.get(p.id if p.id in self.seats else self.seats[0])
        opp = self.opponent(me) if me else None
        see_all = p.spectator or p.eliminated or room.phase == "over"

        def fleet(owner, reveal):
            out = []
            for s in owner.g.ships or []:
                sunk = len(s["hits"]) == len(s["cells"])
                out.append({"name": s["name"], "size": len(s["cells"]), "sunk": sunk,
                            "cells": [list(x) for x in s["cells"]] if reveal or sunk else None})
            return out

        shots = lambda owner: [[r, c, v] for (r, c), v in owner.g.shots.items()] if owner else []
        return {"sea": {
            "stage": self.stage, "n": self.n, "fleetSpec": self.fleet_spec(), "seats": self.seats,
            "mine": fleet(me, True) if me else [], "enemy": fleet(opp, see_all) if opp else [],
            "myShots": shots(me), "theirShots": shots(opp), "ready": {i: bool(room.players[i].g.ships)
                                                                     for i in self.seats if i in room.players},
            "shotsLeft": self.shots_left if room.turn == p.id else 0,
            "sonar": getattr(me.g, "sonar", 0) if me and me.id == p.id else 0,
            "scans": me.g.scans if me and (me.id == p.id or see_all) else [],
            "last": self.last, "player": me.id if me else None,
        }}

    # -- bot

    def unplaced_bots(self):
        return [p for p in self.room.contenders() if p.bot and not p.g.ships]

    def bot_ready(self):
        if self.stage == "placing":  # bots and autopilot stand-ins hide their fleets too
            return bool(self.unplaced_bots())
        return super().bot_ready()

    def bot_tick(self):
        if self.stage != "placing":
            return super().bot_tick()
        for p in self.unplaced_bots():
            self.set_fleet(p, random_fleet(self.rng, self.n, self.fleet_spec()))
            self.room.add_log(f"⚓ {p.name} is ready.")
        self.maybe_begin()

    def bot_turn(self, p):
        opp = self.opponent(p)
        shots = p.g.shots
        open_cells = [(r, c) for r in range(self.n) for c in range(self.n) if (r, c) not in shots]
        hits = [cell for cell, v in shots.items() if v == "hit"]
        if p.bot == "easy":
            target = self.adjacent_target(hits, shots) if hits and random.random() < 0.5 else None
            r, c = target or random.choice(open_cells)
        elif p.bot == "normal":
            target = self.adjacent_target(hits, shots)
            if not target:
                parity = [x for x in open_cells if (x[0] + x[1]) % 2 == 0] or open_cells
                target = random.choice(parity)
            r, c = target
        else:
            remaining = [len(s["cells"]) for s in opp.g.ships if len(s["hits"]) < len(s["cells"])]
            r, c = self.density_target(shots, hits, remaining, open_cells)
        self.fire(p, r, c)

    def adjacent_target(self, hits, shots):
        if not hits:
            return None
        hs = set(hits)
        lines = []
        for r, c in hits:  # extend a line of two or more hits first
            for dr, dc in ((0, 1), (1, 0)):
                if (r + dr, c + dc) in hs:
                    lines += [(r - dr, c - dc), (r + 2 * dr, c + 2 * dc)]
        near = [(r + dr, c + dc) for r, c in hits for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0))]
        for options in (lines, near):
            ok = [x for x in options if 0 <= x[0] < self.n and 0 <= x[1] < self.n and x not in shots]
            if ok:
                return random.choice(ok)
        return None

    def density_target(self, shots, hits, remaining, open_cells):
        hs = set(hits)
        blocked = {cell for cell, v in shots.items() if v in ("miss", "sunk")}
        score = {}
        for length in remaining:
            for r in range(self.n):
                for c in range(self.n):
                    for h in (True, False):
                        cells = ship_cells(r, c, length, h)
                        if any(not (0 <= y < self.n and 0 <= x < self.n) or (y, x) in blocked for y, x in cells):
                            continue
                        through = sum(1 for x in cells if x in hs)
                        if hs and not through:
                            weight = 1
                        else:
                            weight = 1 + 30 * through
                        for x in cells:
                            if x not in shots:
                                score[x] = score.get(x, 0) + weight
        if not score:
            return random.choice(open_cells)
        top = max(score.values())
        return random.choice([x for x, v in score.items() if v == top])
