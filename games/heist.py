"""Night Heist: a simultaneous bluffing game. Each night everyone secretly picks
Grab, Guard or Rest, then all choices are revealed at once."""
import random
import time

from .base import Game, GameError

CHOICES = {"grab": "🦹", "guard": "🛡️", "rest": "😴"}
FINE = 2
MAX_NIGHTS = 99  # ♾️ endless nights (#63) run until the host cashes out, or this night at the latest
# bot personalities: how much more (or less) often than a plain bot they grab and guard
PERSONAS = {"greedy": ("🦊", 1.6, 0.7), "cautious": ("🐢", 0.5, 0.9), "watchful": ("🦉", 0.8, 1.6)}


class Heist(Game):
    id = "heist"
    category = "party"
    howto = [
        'Each night, everyone secretly chooses Grab, Guard or Rest.',
        'A lone grabber steals the whole vault; two grabbers trip the alarm.',
        'Guards fine every grabber 💰2 — but guarding an empty hall costs 💰1. Resting earns 💰1.',
        'Most gold after the last night wins. With ♾️ endless nights, play on until the host taps 🏁 Cash out.',
        'With 🤝 Crews, two grabbers split the vault between them; three or more trip the alarm.',
        'Bots have a personality on their chip: 🦊 greedy grabs more, 🐢 cautious rests, 🦉 watchful guards.',
        'With 🕵️ Inside man on, once a game you can ask, before you choose, how many of the players who have already chosen are grabbing tonight.',
    ]
    name = "Night Heist"
    icon = "🦹"
    blurb = ("Everyone secretly picks Grab, Guard or Rest. A lone grabber steals the loot, "
             "two grabbers trip the alarm, and guards fine anyone they catch.")
    min_players = 2
    max_players = 6
    badges = {**Game.badges, "mastermind": ("💎", "Mastermind", "Steal a vault holding 💰20 or more"),
              "hawk": ("🦅", "Hawk-eyed", "Guard on a night when two or more players grab")}
    settings_schema = {
        "rounds": ("Nights", [(6, "6 nights"), (8, "8 nights"), (10, "10 nights"), (0, "♾️ Endless (the host cashes out)")], 8),
        "style": ("Heist style", [("solo", "🦹 Lone wolves (2 grabbers trip the alarm)"),
                                  ("crew", "🤝 Crews (2 grabbers split the vault, 3 trip it)")], "solo"),
        "tip": ("Inside man", [(False, "Off"), (True, "🕵️ One tip-off each")], False),
    }

    def start(self, seated, rng):
        self.rng = rng
        self.night = 0
        self.pot = 0
        self.gold = {p.id: 3 for p in seated}
        self.choices = {}
        self.last = None
        self.nights = []  # every revealed night: {pid: [choice, gold change]}
        self.tips = {p.id: 1 if self.s.get("tip") else 0 for p in seated}  # 🕵️ inside-man tip-offs left
        # each bot gets a personality, dealt so a table of bots doesn't all play alike
        kinds = list(PERSONAS)
        rng.shuffle(kinds)
        self.persona = {p.id: kinds[k % len(kinds)] for k, p in enumerate(q for q in seated if q.bot)}
        self.room.add_log("🌙 The heist begins. Everyone starts with 💰3.", "big")
        self.new_night()

    def new_night(self):
        r = self.room
        self.night += 1
        added = self.rng.randint(2, 6)
        self.pot += added
        self.choices = {}
        r.turn = None
        r.deadline = time.time() + r.settings["timer"] if r.settings["timer"] else None
        r.bot_at = time.time() + random.uniform(1.0, 3.0)
        of = f"/{self.s['rounds']}" if self.s["rounds"] else ""
        r.add_log(f"🌙 Night {self.night}{of}: 💰{added} more loot — the vault holds 💰{self.pot}.")

    def act(self, p, a):
        if a.get("type") == "cashout":  # ♾️ endless nights: the host ends the heist, most gold wins
            if self.s["rounds"]:
                raise GameError("This heist ends after its last night.")
            if p.id != self.room.host:
                raise GameError("Only the host can cash out.")
            self.room.add_log(f"🏁 {p.name} calls it a night: everyone cashes out after {self.night - 1} nights.", "big")
            return self.finish()
        if a.get("type") not in ("choose", "tip"):
            raise GameError("Unknown action.")
        if p.id not in self.gold or p.eliminated:
            raise GameError("You're not in this heist.")
        if a.get("type") == "tip":
            return self.tip(p)
        choice = a.get("choice")
        if choice not in CHOICES:
            raise GameError("Pick Grab, Guard or Rest.")
        self.choices[p.id] = choice
        self.maybe_resolve()

    def tip(self, p):
        """🕵️ The inside man: how many of those who've already chosen tonight are grabbing (once a game)."""
        tips = getattr(self, "tips", {})
        if not tips.get(p.id):
            raise GameError("Your inside man has nothing more to tell you.")
        if p.id in self.choices:
            raise GameError("Ask before you choose.")
        chosen = [c for pid, c in self.choices.items() if pid != p.id]
        if not chosen:
            raise GameError("Nobody has chosen yet tonight — ask again in a moment.")
        grabs = chosen.count("grab")
        tips[p.id] -= 1
        self.tips = tips
        self.room.add_log(f"🕵️ Your inside man whispers: {grabs} of the {len(chosen)} who've chosen tonight "
                          f"{'is' if grabs == 1 else 'are'} grabbing.", "private", to=p.id)
        self.room.add_log(f"🕵️ {p.name} talked to their inside man.")

    def waiting_on(self):
        return [p for p in self.room.contenders() if p.id not in self.choices]

    def maybe_resolve(self):
        if not self.waiting_on():
            self.resolve()

    def resolve(self):
        r = self.room
        names = lambda ids: " & ".join(r.players[i].name for i in ids)
        grab = [i for i, c in self.choices.items() if c == "grab"]
        guard = [i for i, c in self.choices.items() if c == "guard"]
        rest = [i for i, c in self.choices.items() if c == "rest"]
        before = dict(self.gold)
        for i in rest:
            self.gold[i] += 1
        if guard and grab:
            fines = 0
            for i in grab:
                paid = min(FINE, self.gold[i])
                self.gold[i] -= paid
                fines += paid
            share, leftover = divmod(fines, len(guard))
            for i in guard:
                self.gold[i] += share
            self.pot += leftover
            outcome = f"🚨 {names(guard)} caught {names(grab)}! Fines paid: 💰{fines}."
            if len(grab) >= 2:
                for i in guard:
                    self.award(i, "hawk")
        elif guard:
            for i in guard:
                if self.gold[i]:
                    self.gold[i] -= 1
                    self.pot += 1
            outcome = f"🥱 {names(guard)} guarded an empty hallway and dropped 💰1 into the vault."
        elif len(grab) == 1:
            outcome = f"💎 {names(grab)} slipped in alone and stole 💰{self.pot}!"
            if self.pot >= 20:
                self.award(grab[0], "mastermind")
            self.gold[grab[0]] += self.pot
            self.pot = 0
        elif len(grab) == 2 and self.s.get("style") == "crew":
            share, left = divmod(self.pot, 2)
            outcome = f"🤝 {names(grab)} pulled it off together and split 💰{self.pot}: 💰{share} each!"
            for i in grab:
                self.gold[i] += share
            self.pot = left
        elif grab:
            outcome = f"🔔 {names(grab)} bumped into each other — alarm! The loot stays put."
        else:
            outcome = "😴 A quiet night. Nobody tried anything."
        reveal = ", ".join(f"{r.players[i].name} {CHOICES[c]}" for i, c in self.choices.items())
        r.add_log(f"Night {self.night}: {reveal}", "question")
        r.add_log(outcome, "power")
        self.last = {"night": self.night, "choices": dict(self.choices), "text": outcome}
        self.nights = [*getattr(self, "nights", []),
                       {i: [c, self.gold[i] - before[i]] for i, c in self.choices.items()}]
        if self.over():
            return self.finish()
        self.new_night()

    def over(self):
        return self.night >= (self.s["rounds"] or MAX_NIGHTS)

    def finish(self):
        r = self.room
        live = [p for p in r.contenders()]
        top = max(self.gold[p.id] for p in live)
        best = [p for p in live if self.gold[p.id] == top]
        if len(best) == 1:
            r.finish(best[0], f"🏆 {best[0].name} escapes with 💰{top}!")
        else:
            r.finish(None, f"🤝 Tie at 💰{top} between {' & '.join(p.name for p in best)}.")

    def on_timeout(self):
        for p in self.waiting_on():
            self.choices[p.id] = "rest"
            self.room.add_log(f"⏰ {p.name} dozed off (Rest).", "power")
        self.resolve()

    def on_leave(self, p):
        super().on_leave(p)
        self.choices.pop(p.id, None)
        if self.room.phase == "playing":
            self.maybe_resolve()

    def meta(self, p):
        if p.id not in self.gold:
            return ""
        locked = " · ✅" if p.id in self.choices and self.room.phase == "playing" else ""
        kind = getattr(self, "persona", {}).get(p.id)
        return f"💰{self.gold[p.id]}{locked}" + (f" · {PERSONAS[kind][0]} {kind}" if kind else "")

    def final_scores(self):
        return dict(self.gold)

    def view(self, p):
        return {"heist": {
            "night": self.night, "rounds": self.s["rounds"], "host": self.room.host == p.id, "crew": self.s.get("style") == "crew", "pot": self.pot,
            "mine": self.choices.get(p.id), "last": self.last, "nights": getattr(self, "nights", []),
            "gold": self.gold,
            "waiting": [o.id for o in self.waiting_on()],
            "tips": getattr(self, "tips", {}).get(p.id, 0),
        }}

    # -- bots: everyone moves at once, so all undecided bots choose together

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on())

    def bot_tick(self):
        for p in [p for p in self.waiting_on() if p.bot]:
            self.choices[p.id] = self.bot_choice(p)
        self.maybe_resolve()

    def bot_choice(self, p):
        n = len(self.room.contenders())
        if p.bot == "easy":
            return random.choice(list(CHOICES))
        # Bigger pot → more tempting; more players → more collisions and more guards.
        grab = min(0.65, 0.12 + self.pot / 18) / (1 + 0.25 * (n - 2))
        if self.s.get("style") == "crew" and n >= 3:
            grab *= 1.25  # a partner is welcome, so grabbing is less of a gamble
        guard = 0.22 + 0.06 * (n - 2) + (0.1 if self.pot >= 8 else 0)
        if p.bot == "hard":
            leader = max(self.gold, key=self.gold.get)
            if leader == p.id and self.s["rounds"] and self.night >= self.s["rounds"] - 1:
                return "rest" if self.pot < 6 else "guard"  # protect the lead
            if self.gold[p.id] < FINE:
                grab *= 1.3  # nothing to lose
        kind = getattr(self, "persona", {}).get(p.id)
        if kind:
            grab, guard = grab * PERSONAS[kind][1], guard * PERSONAS[kind][2]
        roll = random.random()
        return "grab" if roll < grab else "guard" if roll < grab + guard else "rest"
