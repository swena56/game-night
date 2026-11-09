"""Night Heist: a simultaneous bluffing game. Each night everyone secretly picks
Grab, Guard or Rest, then all choices are revealed at once."""
import random
import time

from .base import Game, GameError

CHOICES = {"grab": "🦹", "guard": "🛡️", "rest": "😴"}
FINE = 2
MAX_NIGHTS = 99  # ♾️ endless nights (#63) run until the host cashes out, or this night at the latest
LMS = -1  # 🔦 last thief standing: the "rounds" value for play-until-one-is-left
HEAT_OUT = 3  # 🔥 caught this many times and you're arrested
RENT_FROM = 6  # 🔦 rent starts on this night...
RENT_STEP = 4  # ...and goes up 💰1 every this many nights
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
        '🔦 Last thief standing: getting caught (or tailed by an informant while you grab) adds 🔥 heat, and 🔥3 means arrest. '
        'From night 6 everyone pays rising rent into the vault — can\'t pay and you\'re busted. Arrested players turn 👻 informant '
        'and publicly tail one player each night. The last thief free wins.',
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
        "rounds": ("Nights", [(6, "6 nights"), (8, "8 nights"), (10, "10 nights"), (0, "♾️ Endless (the host cashes out)"),
                             (LMS, "🔦 Last thief standing")], 8),
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
        self.heat = {p.id: 0 for p in seated}  # 🔦 last thief standing: catches so far
        self.tails = {}  # 👻 informant id -> the player they're tailing tonight
        self.tips = {p.id: 1 if self.s.get("tip") else 0 for p in seated}  # 🕵️ inside-man tip-offs left
        # each bot gets a personality, dealt so a table of bots doesn't all play alike
        kinds = list(PERSONAS)
        rng.shuffle(kinds)
        self.persona = {p.id: kinds[k % len(kinds)] for k, p in enumerate(q for q in seated if q.bot)}
        self.room.add_log("🌙 The heist begins. Everyone starts with 💰3.", "big")
        if self.lms:
            self.room.add_log(f"🔦 Last thief standing: 🔥{HEAT_OUT} catches and you're arrested; rent starts on night {RENT_FROM}.", "big")
        self.new_night()

    @property
    def lms(self):
        return self.s["rounds"] == LMS

    @property
    def limit(self):
        """The last night, or 0 when the game has none (♾️ endless, 🔦 last thief standing)."""
        return max(0, self.s["rounds"])

    def rent(self, night=None):
        night = self.night if night is None else night
        return 0 if not self.lms or night < RENT_FROM else 1 + (night - RENT_FROM) // RENT_STEP

    def new_night(self):
        r = self.room
        self.night += 1
        added = self.rng.randint(2, 6)
        self.pot += added
        self.choices = {}
        self.tails = {}
        r.turn = None
        r.deadline = time.time() + r.settings["timer"] if r.settings["timer"] else None
        r.bot_at = time.time() + random.uniform(1.0, 3.0)
        if self.lms and any(p.eliminated and not p.bot and p.id in self.gold for p in r.seated()):
            r.bot_at += 5  # 👻 give an arrested player time to pick whom to tail before the bots move
        of = f"/{self.limit}" if self.limit else ""
        rent = f" 🔦 Rent tonight: 💰{self.rent()}." if self.rent() else ""
        r.add_log(f"🌙 Night {self.night}{of}: 💰{added} more loot — the vault holds 💰{self.pot}.{rent}")

    def act(self, p, a):
        if a.get("type") == "cashout":  # ♾️ endless nights: the host ends the heist, most gold wins
            if self.limit:
                raise GameError("This heist ends after its last night.")
            if p.id != self.room.host:
                raise GameError("Only the host can cash out.")
            self.room.add_log(f"🏁 {p.name} calls it a night: everyone cashes out after {self.night - 1} nights.", "big")
            return self.finish()
        if a.get("type") == "tail":
            return self.tail(p, a.get("target"))
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

    def tail(self, p, target):
        """👻 An arrested player tails someone tonight, in plain sight: if they grab, it's 🔥1 heat."""
        if not self.lms or p.id not in self.gold or not p.eliminated:
            raise GameError("Only arrested players can tail someone.")
        if p.id in self.tails:
            raise GameError("You're already tailing someone tonight.")
        t = self.room.players.get(target)
        if not t or t.eliminated or t.id not in self.gold:
            raise GameError("Tail a player who's still free.")
        self.tails[p.id] = t.id
        if not p.bot:  # picked: no need to hold the bots any longer
            self.room.bot_at = min(self.room.bot_at, time.time() + random.uniform(1.0, 2.0))
        self.room.add_log(f"👻 {p.name} is tailing {t.name} tonight — grab and the cops hear of it.", "power")

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
        hot = set()  # 🔦 who picks up heat tonight
        if guard and grab:
            hot.update(grab)
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
        fallen = self.crackdown(grab, hot, names) if self.lms else []
        self.last = {"night": self.night, "choices": dict(self.choices), "text": outcome}
        self.nights = [*getattr(self, "nights", []),
                       {i: [c, self.gold[i] - before[i]] for i, c in self.choices.items()}]
        if self.lms and len(r.contenders()) <= 1:
            return self.finish(fallen)
        if self.over():
            return self.finish()
        self.new_night()

    def crackdown(self, grab, hot, names):
        """🔦 After the night: informants' tails, heat, rent, arrests. Returns who was arrested tonight."""
        r = self.room
        tailed = {t for t in self.tails.values() if t in grab}
        if tailed:
            r.add_log(f"👻 An informant saw {names(sorted(tailed, key=list(self.choices).index))} grab!", "power")
        for i in hot | tailed:
            self.heat[i] += 1
        rent = self.rent()
        broke = []
        if rent:
            for p in r.contenders():
                paid = min(rent, self.gold[p.id])
                self.gold[p.id] -= paid
                self.pot += paid
                if paid < rent:
                    broke.append(p.id)
            r.add_log(f"🔦 Everyone pays 💰{rent} rent into the vault.")
        out = []
        for p in r.contenders():
            why = ("🔥 too hot — arrested" if self.heat[p.id] >= HEAT_OUT
                   else "💸 couldn't make rent — busted" if p.id in broke else None)
            if why:
                out.append(p)
                r.add_log(f"🚔 {p.name}: {why}! They turn 👻 informant.", "big")
        for p in out:
            p.eliminated = True
        return out

    def over(self):
        return self.night >= (self.limit or MAX_NIGHTS)

    def finish(self, fallen=None):
        r = self.room
        live = r.contenders()
        if self.lms and len(live) == 1:
            p = live[0]
            return r.finish(p, f"🔦 {p.name} is the last thief standing, with 💰{self.gold[p.id]}!")
        if not live and fallen:  # 🔦 the last of them all fell on the same night: the richest of them wins
            r.add_log("🚔 The cops nabbed everyone left on the same night — the fattest purse wins.", "big")
            live = fallen
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
        heat = f" · 🔥{self.heat[p.id]}" if self.lms and getattr(self, "heat", {}).get(p.id) else ""
        if self.lms and p.eliminated:
            return f"🚔 💰{self.gold[p.id]}"
        return f"💰{self.gold[p.id]}{heat}{locked}" + (f" · {PERSONAS[kind][0]} {kind}" if kind else "")

    def final_scores(self):
        return dict(self.gold)

    def view(self, p):
        return {"heist": {
            "night": self.night, "rounds": self.limit, "lms": self.lms, "rent": self.rent(),
            "next_rent": self.rent(self.night + 1) if self.lms else 0, "heat": getattr(self, "heat", {}), "heat_out": HEAT_OUT,
            "out": [i for i in self.gold if self.room.players.get(i) and self.room.players[i].eliminated],
            "tails": getattr(self, "tails", {}), "my_tail": getattr(self, "tails", {}).get(p.id), "host": self.room.host == p.id, "crew": self.s.get("style") == "crew", "pot": self.pot,
            "mine": self.choices.get(p.id), "last": self.last, "nights": getattr(self, "nights", []),
            "gold": self.gold,
            "waiting": [o.id for o in self.waiting_on()],
            "tips": getattr(self, "tips", {}).get(p.id, 0),
        }}

    # -- bots: everyone moves at once, so all undecided bots choose together

    def idle_informants(self):
        return [p for p in self.room.seated() if self.lms and p.bot and p.eliminated
                and p.id in self.gold and p.id not in self.tails]

    def bot_ready(self):
        return any(p.bot for p in self.waiting_on()) or bool(self.idle_informants())

    def bot_tick(self):
        live = self.room.contenders()
        for p in self.idle_informants():  # 👻 a bot informant shadows the richest thief (mostly)
            if live:
                t = max(live, key=lambda o: self.gold[o.id]) if random.random() < 0.6 else random.choice(live)
                self.tail(p, t.id)
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
            if leader == p.id and self.limit and self.night >= self.limit - 1:
                return "rest" if self.pot < 6 else "guard"  # protect the lead
            if self.gold[p.id] < FINE:
                grab *= 1.3  # nothing to lose
        if self.lms:
            heat = self.heat[p.id]
            if p.id in self.tails.values():
                grab *= 0.35  # 👻 someone's watching
            if heat >= HEAT_OUT - 1:
                grab *= 0.3 if self.gold[p.id] >= self.rent(self.night + 1) * 2 else 0.8  # one more catch ends it
            if self.gold[p.id] < self.rent(self.night + 1) + 1:
                grab *= 1.6  # rent's due: need loot
        kind = getattr(self, "persona", {}).get(p.id)
        if kind:
            grab, guard = grab * PERSONAS[kind][1], guard * PERSONAS[kind][2]
        roll = random.random()
        return "grab" if roll < grab else "guard" if roll < grab + guard else "rest"
