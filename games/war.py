"""War: flip, compare, and go to war on a tie, for 2-4 players.

The deck is dealt out evenly. Everyone flips their top card at once and the highest takes them all
(aces high, suits don't matter). When the top cards tie, those players go to war: three cards face
down and one face up, and the highest of those takes everything. Won cards go to the bottom of your
pile. Run out of cards and you're out. The last player holding cards wins. A battle limit (setting)
ends a long game: most cards wins.

🎲 Gamble (default on): everyone has 2 gambles a game. Spend one before a flip: win the battle and you also
take the top card of every rival's pile; lose it and the winner takes the top card of yours. A gamble never
takes a pile's last card, so it can't knock anyone out."""
from .cardbase import CardGame, GameError, deck, rank, pretty, show

ORDER = "23456789TJQKA"


def val(c):
    return ORDER.index(rank(c))


class War(CardGame):
    id = "war"
    name = "War"
    icon = "🪖"
    blurb = "Flip your top card, highest takes all. Tie? It's war: three down, one up, winner takes the lot."
    howto = [
        "The deck is dealt out. Everyone flips their top card together: highest takes them all (aces high).",
        "A tie at the top means war: three cards face down, one face up, highest takes everything.",
        "Open Recent battles to see the flips, face-down war cards and cards awarded after each battle resolves.",
        "Won cards go under your pile. Run out and you're out.",
        "Last player with cards wins, or most cards when the battle limit runs out.",
        "🎲 You have 2 gambles a game. Press Gamble instead of Flip: if you win the battle you also take the top card of every rival's pile; if you lose, the winner takes one of yours.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "warlord": ("🪖", "Warlord", "Win a double war"), "gambler": ("🎲", "High roller", "Win a battle you gambled on")}
    settings_schema = {"limit": ("Battle limit", [(60, "60 battles"), (30, "30 (quick)"), (150, "150 battles"), (0, "No limit")], 60),
                       "gamble": ("Gambles", [(2, "🎲 2 a game"), (0, "Off")], 2)}
    GAMBLES = 2  # per player per game (the setting turns them off)
    gambles = None   # games saved before 🎲 have none
    bets = None
    last_bets = ()

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck()
        rng.shuffle(cards)
        per = 52 // self.n
        self.piles = [cards[k * per:(k + 1) * per] for k in range(self.n)]
        self.battle = 0
        self.shown = None
        self.battle_history = []
        self.gambles = [self.GAMBLES if self.s.get("gamble", 2) else 0] * self.n
        self.bets = set()
        self.last_bets = ()
        self.room.add_log("⚔️ War! Flip together; highest card takes the lot.", "big")
        self.next_battle()

    def is_out(self, i):
        return not self.piles[i]

    def live(self):
        return [k for k in range(self.n) if self.piles[k]]

    def next_battle(self):
        live = self.live()
        lim = self.s.get("limit", 60)
        if len(live) == 1:
            w = live[0]
            return self.room.finish(self.pl(w), f"🏆 {self.nm(w)} holds the whole deck and wins War!")
        if lim and self.battle >= lim:
            return self.win_by_score([len(p) for p in self.piles], what="cards")
        self.battle += 1
        self.stage = "flip"
        self.bets = set()
        self.open_all(live)

    def act(self, p, a):
        i = self.act_seat(p)
        if a.get("type") != "flip" or self.stage != "flip" or i not in self.waiting:
            raise GameError("Wait for the next battle.")
        if a.get("gamble"):
            self.gamble(i)
        self.flip(i)

    def left(self, i):
        return (self.gambles or [0] * self.n)[i]

    def gamble(self, i):
        if self.left(i) <= 0:
            raise GameError("You're out of gambles.")
        self.gambles[i] -= 1
        self.bets = (self.bets or set()) | {i}
        self.room.add_log(f"🎲 {self.nm(i)} gambles!", "power")

    def bot_move(self, i, level):
        if self.stage == "flip" and i in self.waiting:
            # bots gamble when they're behind (hard: more eagerly), never with a pile too thin to pay
            mine, best = len(self.piles[i]), max(len(p) for p in self.piles)
            chance = {"easy": 0.05, "normal": 0.2, "hard": 0.4}.get(level, 0.2) if mine < best else 0.03
            if self.left(i) > 0 and mine > 2 and self.rng.random() < chance:
                self.gamble(i)
            self.flip(i)

    def flip(self, i):
        self.waiting.discard(i)
        if not self.waiting:
            self.resolve()

    def resolve(self):
        pot = []
        fighters = self.live()
        rounds = []
        face_down = []
        wars = 0
        while True:
            up = {}
            stakes = {}
            for k in fighters:
                if wars:
                    down = self.piles[k][:3] if len(self.piles[k]) > 1 else []
                    down = down[:max(0, len(self.piles[k]) - 1)]
                    if down:
                        stakes[k] = down
                    pot += down
                    self.piles[k] = self.piles[k][len(down):]
                if self.piles[k]:
                    up[k] = self.piles[k].pop(0)
                    pot.append(up[k])
            rounds.append(up)
            face_down.append(stakes)
            if not up:
                break
            top = max(val(c) for c in up.values())
            best = [k for k, c in up.items() if val(c) == top]
            if len(best) == 1:
                w = best[0]
                break
            fighters = [k for k in best if self.piles[k]]
            wars += 1
            self.room.add_log(f"💥 {' & '.join(self.nm(k) for k in best)} tie with {pretty(up[best[0]])}: WAR!", "power")
            if len(fighters) <= 1:
                w = fighters[0] if fighters else best[0]
                break
        bets = set(self.bets or ())
        # 🎲 the winner's gamble makes every rival pay a card; a rival's lost gamble makes that rival pay one
        payers = ({k for k in range(self.n) if k != w} if w in bets else set()) | (bets - {w})
        extra = 0
        for k in sorted(payers):
            if len(self.piles[k]) > 1:  # a gamble never takes a pile's last card
                pot.append(self.piles[k].pop(0))
                extra += 1
        if not hasattr(self, "battle_history"):
            self.battle_history = []
        self.battle_history.append({
            "battle": self.battle, "winner": w, "ties": wars,
            "rounds": [{"up": up, "down": down} for up, down in zip(rounds, face_down)],
            "won": sorted(pot), "extra": extra,
        })
        del self.battle_history[:-12]
        self.last_bets = sorted(bets)
        self.rng.shuffle(pot)
        self.piles[w] += pot
        self.shown = {"rounds": [{str(k): c for k, c in r.items()} for r in rounds], "winner": w, "pot": len(pot), "wars": wars}
        if wars >= 2 and self.pl(w):
            self.award(self.pl(w), "warlord")
        if w in bets and self.pl(w):
            self.award(self.pl(w), "gambler")
        if bets and not wars:
            who = " & ".join(self.nm(k) for k in sorted(bets))
            msg = f"pays off: +{extra} card{'s' * (extra != 1)}!" if w in bets else f"fails: {self.nm(w)} collects!"
            self.moment(f"🎲 {who}'s gamble {msg}", "gold" if w in bets else "red", "fanfare")
        if wars:
            self.moment(f"⚔️ {self.nm(w)} wins the war and {len(pot)} cards!", "gold", "fanfare")
        self.room.add_log(f"{show(list(rounds[-1].values()))} → {self.nm(w)} takes {len(pot)}.")
        for k in range(self.n):
            if not self.piles[k] and k != w and k in rounds[0]:
                self.room.add_log(f"💀 {self.nm(k)} is out of cards.")
        self.stage = "show"
        self.pause(self.next_battle, 1.6 if not wars else 2.6)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🂠 {len(self.piles[i])}"

    def final_scores(self):
        return {pid: len(self.piles[k]) for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        sh = self.shown
        last = sh["rounds"][-1] if sh else {}
        info = [{"count": len(self.piles[k]), "out": not self.piles[k],
                 "show": [last[str(k)]] if str(k) in last and self.stage == "show" else [],
                 "tags": [("🏆 took it" if sh and sh["winner"] == k and self.stage == "show" else "")
                          + (" 🎲" if self.stage == "show" and k in (self.last_bets or ()) else "")
                          + (f" · 🎲{self.left(k)}" if self.left(k) and self.stage == "flip" else "")]} for k in range(self.n)]
        lim = self.s.get("limit", 60)
        t = {"info": info, "battleHistory": getattr(self, "battle_history", []),
             "trick": [[int(k), c] for k, c in last.items()] if self.stage == "show" else [],
             "banner": (f"{'⚔️ ' * sh['wars']}{self.nm(sh['winner'])} takes {sh['pot']}" if sh and self.stage == "show" else None),
             "scores": {"title": "Cards", "rows": [{"seat": k, "value": len(self.piles[k])} for k in sorted(range(self.n), key=lambda k: -len(self.piles[k]))],
                        "hint": f"Battle {self.battle}" + (f" of {lim}" if lim else "")}}
        if i is not None and self.piles[i]:
            t["piles"] = [{"cards": ["??"], "count": len(self.piles[i]), "label": "Your pile"}]
            if self.stage == "flip" and i in self.waiting:
                t["buttons"] = [{"label": "⚔️ Flip!", "a": {"type": "flip"}, "kind": "slap"}]
                if self.left(i) and len(self.piles[i]) > 1:
                    t["buttons"].append({"label": f"🎲 Gamble ({self.left(i)} left)", "a": {"type": "flip", "gamble": True}})
                t["turnText"] = "⚔️ Flip your card"
        return t
