"""Whist: the classic partnership trick-taking game, for 4 players in two teams (partners opposite).

Thirteen cards each; the dealer's last card is turned up for trumps. Follow suit if you can; the
highest trump, or else the highest card of the suit led, wins the trick. Each trick a team takes over
six scores a point. First team to the target (5 for short whist) wins."""
from .cardbase import GameError, deck, rank, suit, pretty, SUIT_NAME
from .tricks import TrickGame


class Whist(TrickGame):
    id = "whist"
    name = "Whist"
    icon = "🎩"
    blurb = "The grand old partnership trick-taker: thirteen tricks, trumps turned up, every trick over six scores."
    howto = [
        "Two teams, partners sit opposite. Thirteen cards each; the dealer's last card shows trumps.",
        "Follow suit if you can. Highest trump wins, else the highest card of the suit led.",
        "Each trick your team takes over six scores 1 point.",
        "First team to the target wins.",
    ]
    min_players, max_players = 4, 4
    teams = True
    badges = {**TrickGame.badges, "slam": ("💫", "Grand slam", "Your team takes all thirteen tricks")}
    settings_schema = {"target": ("Game to", [(5, "5 points (short whist)"), (7, "7 points"), (3, "3 points (quick)")], 5)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        self.team_score = [0, 0]
        self.dealer = rng.randrange(4)
        self.room.add_log(f"🎩 Whist to {self.s['target']}: {self.nm(0)} & {self.nm(2)} against {self.nm(1)} & {self.nm(3)}.", "big")
        self.deal()

    def deal(self):
        self.dealer = (self.dealer + 1) % 4
        cards = deck()
        self.rng.shuffle(cards)
        self.hands = [cards[k * 13:(k + 1) * 13] for k in range(4)]
        self.turned = self.hands[self.dealer][-1]
        self.trump = suit(self.turned)
        self.room.add_log(f"🃏 {self.nm(self.dealer)} deals and turns {pretty(self.turned)}: {SUIT_NAME[self.trump]} are trumps.")
        self.start_tricks((self.dealer + 1) % 4)

    def end_hand(self):
        got = [self.tricks[0] + self.tricks[2], self.tricks[1] + self.tricks[3]]
        w = 0 if got[0] > got[1] else 1
        pts = got[w] - 6
        self.team_score[w] += pts
        if got[w] == 13:
            for k in (w, w + 2):
                if self.pl(k):
                    self.award(self.pl(k), "slam")
        self.room.add_log(f"🧮 {self.team_name(0)} {got[0]} – {got[1]} {self.team_name(1)}: {self.team_name(w)} +{pts} "
                          f"({self.team_score[0]}–{self.team_score[1]})", "big")
        if max(self.team_score) >= self.s["target"]:
            return self.room.finish(self.pl(w), f"🏆 {self.team_name(w)} win Whist, {self.team_score[w]} to {self.team_score[1 - w]}!")
        self.stage = "score"
        self.pause(self.deal, 3.5)

    def team_name(self, t):
        return f"{self.nm(t)} & {self.nm(t + 2)}"

    def wants(self, i):
        return True

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"{self.team_score[i % 2]} pts"

    def final_scores(self):
        return {pid: self.team_score[k % 2] for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        play = self.stage in ("play", "score")
        info = [{"count": len(self.hands[k]), "badge": "🔵" if k % 2 == 0 else "🟠",
                 "tags": [f"won {self.tricks[k]}" if play else ""] + (["🎴 dealer"] if k == self.dealer else [])} for k in range(4)]
        team = [self.tricks[0] + self.tricks[2], self.tricks[1] + self.tricks[3]] if play else [0, 0]
        t = {"info": info, "trump": self.turned, "trumpLabel": f"{SUIT_NAME[self.trump].title()} trumps",
             "scores": {"title": "Teams", "rows": [{"seat": t_, "value": self.team_score[t_], "sub": f"& {self.nm(t_ + 2)} · {team[t_]} tricks"} for t_ in (0, 1)],
                        "hint": f"Game to {self.s['target']}. Tricks over six score. 🔵 seats 1 & 3, 🟠 seats 2 & 4."}}
        t.update(self.trick_view(p, i))
        return t
