"""A shared rail yard, advanced by the room's real-time frame ticker."""
import time

from .base import Game, GameError

BEAT = 2
COUNTDOWN = 4
WAVE_SPACING = (3, 2, 1)
TRAINS_PER_WAVE = 6
TOTAL = len(WAVE_SPACING) * TRAINS_PER_WAVE
SWITCHES = ("main", "west", "east")
BRANCHES = SWITCHES[1:]
DEPOTS = ("Circle", "Diamond", "Triangle", "Square")
WAVE_PATTERNS = (
    ((0, 1, 2, 3, 0, 2), (0, 1, 3, 2, 1, 3)),
    ((1, 2, 3, 0, 2, 1), (1, 3, 2, 0, 1, 3)),
    # All variants have two separated beats requiring two flips.
    ((0, 0, 1, 2, 3, 1), (0, 1, 2, 2, 3, 0)),
)


class Switchyard(Game):
    id = "switchyard"
    category = "action"
    name = "Switchyard Scramble"
    icon = "🚦"
    blurb = "Work together to route trains to four matching depots as arrivals speed up."
    min_players = 1
    max_players = 6
    replayable = False
    howto = [
        "Match each train's color and symbol to its depot. Anyone on the crew can flip any switch.",
        "Trains move one segment every two seconds. Set a switch before a train reaches it.",
        "Check the next two arrivals. Three waves send trains in faster, and three wrong deliveries end the match.",
    ]

    def check_players(self, seated):
        super().check_players(seated)
        if any(not p.human() for p in seated):
            raise GameError("Remove computer players before starting Switchyard Scramble.")

    def start(self, seated, rng):
        self.crew = {p.id for p in seated if p.human()}
        # Swap branches and depot pairs while preserving the decisions in each pattern.
        mirror = rng.randrange(4)
        self.schedule = [
            depot ^ mirror for patterns in WAVE_PATTERNS for depot in rng.choice(patterns)
        ]
        self.wave = 0
        self.delivered = self.strikes = 0
        self.feedback = None
        self.route_calls = {}
        self.won = False
        self.start_wave(time.time())

    def start_wave(self, now):
        self.switches = dict.fromkeys(SWITCHES, 0)
        self.last_switch = None
        self.trains = []
        self.beat = 0
        self.launched = 0
        self.next_beat = now + COUNTDOWN

    def on_restore(self, shift):
        self.next_beat += shift

    def on_leave(self, p):
        p.eliminated = True
        self.room.add_log(f"{p.name} left the yard.")
        if not any(o.id in self.crew for o in self.room.contenders()):
            self.room.finish(None, self.result_text("The crew left the yard."))

    def result_text(self, result):
        return f"{result} {self.delivered}/{TOTAL} delivered · {self.strikes}/3 strikes used"

    def finish(self, won):
        self.won = won
        result = "The crew wins!" if won else "The yard is shut down."
        self.room.finish(None, self.result_text(result), team_winner_ids=self.crew if won else ())

    def upcoming(self):
        first = self.wave * TRAINS_PER_WAVE + self.launched
        return range(first, min(first + 2, TOTAL))

    def call_route(self, p, a):
        train, branch = a.get("train"), a.get("branch")
        if type(train) is not int or branch not in BRANCHES:
            raise GameError("Choose an upcoming train and a branch.")
        advanced = self.frame(time.time())
        if self.room.phase == "playing" and train in self.upcoming():
            call = {"branch": branch, "name": p.name}
            if not hasattr(self, "route_calls"):
                self.route_calls = {}  # rooms saved before route calls
            if self.route_calls.get(train) != call:
                self.route_calls[train] = call
                return
        if not advanced:
            self.room.no_bump = True

    def act(self, p, a):
        if p.spectator or p.eliminated or p.id not in self.crew:
            raise GameError("Only the crew can set switches.")
        fields = ("gameNo",) if a.get("type") == "call_route" else ("gameNo", "wave", "beat")
        if any(type(a.get(field)) is not int for field in fields):
            raise GameError("Refresh the page to use the Switchyard controls.")
        if a["gameNo"] != self.room.game_no:
            self.room.no_bump = True
            return
        if a.get("type") == "call_route":
            return self.call_route(p, a)
        switch, position = a.get("switch"), a.get("position")
        if (a.get("type") != "set_switch" or switch not in SWITCHES
                or type(position) is not int or position not in (0, 1)):
            raise GameError("Choose a valid switch and position.")

        # Resolve due beats under the same room lock as the action. A late
        # request cannot change a route even if the frame ticker hasn't run yet.
        advanced = self.frame(time.time())
        if self.room.phase != "playing":
            return
        if (a["wave"], a["beat"]) != (self.wave + 1, self.beat) or self.switches[switch] == position:
            if not advanced:
                self.room.no_bump = True
            return
        self.switches[switch] = position
        self.last_switch = {"switch": switch, "position": position, "name": p.name}

    def frame(self, now):
        if self.room.paused or now < self.next_beat:
            return False
        while self.room.phase == "playing" and now >= self.next_beat:
            at = self.next_beat
            self.next_beat += BEAT
            self.step(at)
        return True

    def step(self, at):
        for train in self.trains[:]:
            node = train["node"]
            if node == "entry":
                train["node"] = "main"
                train["route"] = BRANCHES[self.switches["main"]]
                if self.switches["main"] != train["target"] // 2:
                    train["missAt"] = "main"
            elif node == "main":
                branch = train["route"]
                train["node"] = branch
                train["route"] = (0 if branch == "west" else 2) + self.switches[branch]
                if train["route"] != train["target"]:
                    train.setdefault("missAt", branch if BRANCHES[train["target"] // 2] == branch else "main")
            else:
                depot = train["route"]
                correct = depot == train["target"]
                self.trains.remove(train)
                self.feedback = {"id": train["id"], "target": train["target"], "depot": depot,
                                 "correct": correct, "missAt": train.get("missAt")}
                if correct:
                    self.delivered += 1
                else:
                    self.strikes += 1
                    if self.strikes == 3:
                        self.finish(False)
                        return

        if self.launched < TRAINS_PER_WAVE and self.beat % WAVE_SPACING[self.wave] == 0:
            index = self.wave * TRAINS_PER_WAVE + self.launched
            self.trains.append({"id": index, "target": self.schedule[index], "node": "entry"})
            getattr(self, "route_calls", {}).pop(index, None)
            self.launched += 1
        self.beat += 1
        if not self.trains and self.launched == TRAINS_PER_WAVE:
            if self.wave == len(WAVE_SPACING) - 1:
                self.finish(True)
            else:
                self.wave += 1
                self.start_wave(at)

    def view(self, p):
        now = self.room.paused or time.time()
        playing = self.room.phase == "playing"
        can_switch = playing and not (self.room.paused or p.spectator or p.eliminated) and p.id in self.crew
        upcoming = self.upcoming() if playing else ()
        calls = getattr(self, "route_calls", {})
        return {"switchyard": {
            "wave": self.wave + 1, "waves": len(WAVE_SPACING), "countdown": self.beat == 0,
            "timeLeft": max(0, self.next_beat - now) if playing else 0,
            "beat": self.beat, "beatLength": COUNTDOWN if self.beat == 0 else BEAT,
            "lastSwitch": getattr(self, "last_switch", None),
            "switches": dict(self.switches), "trains": [dict(t) for t in self.trains],
            "incoming": [self.schedule[i] for i in upcoming],
            "upcoming": [{"id": i, "target": self.schedule[i], "call": calls.get(i)} for i in upcoming],
            "canCall": can_switch and sum(o.id in self.crew for o in self.room.contenders()) > 1,
            "delivered": self.delivered, "total": TOTAL, "strikes": self.strikes,
            "feedback": self.feedback, "won": self.won,
            "canSwitch": can_switch,
        }}
