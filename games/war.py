"""War: flip, compare, and go to war on a tie, for 2-4 players.

The deck is dealt out evenly. Everyone flips their top card at once and the highest takes them all
(aces high, suits don't matter). When the top cards tie, those players go to war: three cards face
down and one face up, and the highest of those takes everything. Won cards go to the bottom of your
pile. Run out of cards and you're out. The last player holding cards wins. A battle limit (setting)
ends a long game: most cards wins."""
from .cardbase import CardGame, GameError, deck, rank, pretty, show

ORDER = "23456789TJQKA"


def val(c):
    return ORDER.index(rank(c))


class War(CardGame):
    id = "war"
    name = "War"
    icon = "⚔️"
    blurb = "Flip your top card, highest takes all. Tie? It's war: three down, one up, winner takes the lot."
    howto = [
        "The deck is dealt out. Everyone flips their top card together: highest takes them all (aces high).",
        "A tie at the top means war: three cards face down, one face up, highest takes everything.",
        "Won cards go under your pile. Run out and you're out.",
        "Last player with cards wins, or most cards when the battle limit runs out.",
    ]
    min_players, max_players = 2, 4
    badges = {**CardGame.badges, "warlord": ("🪖", "Warlord", "Win a double war")}
    settings_schema = {"limit": ("Battle limit", [(60, "60 battles"), (30, "30 (quick)"), (150, "150 battles"), (0, "No limit")], 60)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck()
        rng.shuffle(cards)
        per = 52 // self.n
        self.piles = [cards[k * per:(k + 1) * per] for k in range(self.n)]
        self.battle = 0
        self.shown = None
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
        self.open_all(live)

    def act(self, p, a):
        i = self.act_seat(p)
        if a.get("type") != "flip" or self.stage != "flip" or i not in self.waiting:
            raise GameError("Wait for the next battle.")
        self.flip(i)

    def bot_move(self, i, level):
        if self.stage == "flip" and i in self.waiting:
            self.flip(i)

    def flip(self, i):
        self.waiting.discard(i)
        if not self.waiting:
            self.resolve()

    def resolve(self):
        pot = []
        fighters = self.live()
        rounds = []
        wars = 0
        while True:
            up = {}
            for k in fighters:
                if wars:
                    down = self.piles[k][:3] if len(self.piles[k]) > 1 else []
                    down = down[:max(0, len(self.piles[k]) - 1)]
                    pot += down
                    self.piles[k] = self.piles[k][len(down):]
                if self.piles[k]:
                    up[k] = self.piles[k].pop(0)
                    pot.append(up[k])
            rounds.append(up)
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
        self.rng.shuffle(pot)
        self.piles[w] += pot
        self.shown = {"rounds": [{str(k): c for k, c in r.items()} for r in rounds], "winner": w, "pot": len(pot), "wars": wars}
        if wars >= 2 and self.pl(w):
            self.award(self.pl(w), "warlord")
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
                 "tags": ["🏆 took it" if sh and sh["winner"] == k and self.stage == "show" else ""]} for k in range(self.n)]
        lim = self.s.get("limit", 60)
        t = {"info": info,
             "trick": [[int(k), c] for k, c in last.items()] if self.stage == "show" else [],
             "banner": (f"{'⚔️ ' * sh['wars']}{self.nm(sh['winner'])} takes {sh['pot']}" if sh and self.stage == "show" else None),
             "scores": {"title": "Cards", "rows": [{"seat": k, "value": len(self.piles[k])} for k in sorted(range(self.n), key=lambda k: -len(self.piles[k]))],
                        "hint": f"Battle {self.battle}" + (f" of {lim}" if lim else "")}}
        if i is not None and self.piles[i]:
            t["piles"] = [{"cards": ["??"], "count": len(self.piles[i]), "label": "Your pile"}]
            if self.stage == "flip" and i in self.waiting:
                t["buttons"] = [{"label": "⚔️ Flip!", "a": {"type": "flip"}, "kind": "slap"}]
                t["turnText"] = "⚔️ Flip your card"
        return t
