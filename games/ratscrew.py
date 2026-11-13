"""Egyptian Ratscrew: flip, challenge and slap, for 2-6 players.

The whole deck is dealt face down. In turn everyone flips their top card onto the middle pile. Flip a
face card or ace and the next player must answer with one within that many tries (J 1, Q 2, K 3, A 4);
if they don't, whoever flipped the face card takes the pile. Anyone may slap the pile when the top two
cards match (a double) or the top card matches the one under the one below it (a sandwich): the first
slap takes the pile. Slap wrongly and you burn a card under the pile. Run out of cards and you're out;
whoever ends up with every card wins."""
import random
import time

from .cardbase import CardGame, GameError, deck, rank, pretty, show

TRIES = {"J": 1, "Q": 2, "K": 3, "A": 4}
REACT = {"easy": (0.9, 1.7), "normal": (0.6, 1.1), "hard": (0.38, 0.75)}
WINDOW = 1.5          # seconds after each flip before the next one may come
MISS = {"easy": 0.35, "normal": 0.15, "hard": 0.04}   # a bot misses a slap this often


class Ratscrew(CardGame):
    id = "ratscrew"
    name = "Egyptian Ratscrew"
    icon = "🐀"
    blurb = "Flip cards onto the pile and slap doubles and sandwiches first. Face cards demand an answer."
    howto = [
        "Everyone has a face-down stack. In turn, flip your top card onto the pile.",
        "Flip a J, Q, K or A and the next player gets 1, 2, 3 or 4 flips to answer with a face card or ace, or you take the pile.",
        "👋 Slap when the top two match (double) or the top card matches the one two below (sandwich). First slap takes the pile.",
        "Slap wrong and you burn a card under the pile.",
        "Run out and you're out. Collect every card to win.",
        "Variants: Beggar My Neighbour (face cards, no slaps), Slap Jack (no face cards; slap every jack), Snap (no face cards; slap pairs).",
    ]
    min_players, max_players = 2, 6
    badges = {**CardGame.badges, "fast": ("👋", "Fastest hand", "Win five slaps in one game")}
    settings_schema = {"variant": ("Game", [("ratscrew", "Egyptian Ratscrew"), ("beggar", "Beggar My Neighbour: face cards, no slaps"),
                                            ("slapjack", "Slap Jack: slap the jacks"), ("snap", "Snap: slap pairs, no face cards")], "ratscrew"),
                       "slaps": ("Slaps", [("both", "Doubles and sandwiches"), ("doubles", "Doubles only")], "both"),
                       "limit": ("Time limit", [(300, "5 minutes, then most cards"), (600, "10 minutes"), (0, "None")], 300)}

    def start(self, seated, rng):
        self.seat_up(seated, rng)
        cards = deck()
        rng.shuffle(cards)
        self.piles = [cards[k::self.n] for k in range(self.n)]
        self.pile = []
        self.slaps = [0] * self.n
        self.challenge = None      # {by, left}
        self.flash = None
        self.react = {}
        self.flips = 0
        self.ends = time.time() + self.s["limit"] if self.s.get("limit") else None
        self.room.add_log({"beggar": "🐀 Beggar My Neighbour: flip, and answer the face cards!", "slapjack": "🐀 Slap Jack: flip, and 👋 slap every jack!",
                           "snap": "🐀 Snap: flip, and 👋 slap two of a kind!"}.get(self.variant(), "🐀 Egyptian Ratscrew: flip, answer face cards, and 👋 slap doubles and sandwiches!"), "big")
        self.stage = "flip"
        self.to(rng.randrange(self.n))

    def is_out(self, i):
        return not self.piles[i] and self.stage != "start"

    def alive(self):
        return [k for k in range(self.n) if self.piles[k]]

    def variant(self):
        return self.s.get("variant", "ratscrew")

    def slappable(self):
        p = self.pile
        v = self.variant()
        if v == "beggar":
            return None
        if v == "slapjack":
            return "jack" if p and rank(p[-1]) == "J" else None
        if v == "snap":
            return "pair" if len(p) >= 2 and rank(p[-1]) == rank(p[-2]) else None
        if len(p) >= 2 and rank(p[-1]) == rank(p[-2]):
            return "double"
        if self.s.get("slaps", "both") == "both" and len(p) >= 3 and rank(p[-1]) == rank(p[-3]):
            return "sandwich"
        return None

    # -- flipping

    def flip(self, i):
        self.flips += 1
        c = self.piles[i].pop(0)
        self.pile.append(c)
        self.flash = None
        self.last_flip = time.time()
        self.flipper = i
        r = rank(c)
        if r in TRIES and self.variant() in ("ratscrew", "beggar"):
            self.challenge = {"by": i, "left": TRIES[r]}
            nxt = self.next_alive(i)
        elif self.challenge:
            self.challenge["left"] -= 1
            nxt = i if self.challenge["left"] > 0 and self.piles[i] else None
        else:
            nxt = self.next_alive(i)
        # a short window to slap before anything else happens; bots notice at their own speed
        kind = self.slappable()
        self.react = {}
        for k in self.alive() + ([i] if not self.piles[i] else []):
            if self.auto(k):
                lvl = self.level(k)
                if kind and random.random() > MISS[lvl]:
                    self.react[k] = random.uniform(*REACT[lvl])
        self.stage = "window"
        self.pending_next = nxt
        self.room.turn = None
        self.waiting = set()
        self.room.deadline = self.last_flip + WINDOW
        if self.react:
            self.room.bot_at = self.last_flip + min(self.react.values())
        if not self.piles[i] and nxt == i:
            self.pending_next = None

    def next_alive(self, i):
        for k in range(1, self.n + 1):
            j = (i + k) % self.n
            if self.piles[j]:
                return j
        return i

    def after_window(self):
        """Nobody slapped: the challenge resolves or play moves on."""
        self.react = {}
        ch = self.challenge
        if ch and self.pending_next is None:
            w = ch["by"]
            self.take(w, f"🃏 {self.nm(w)}'s face card wins: they take the pile ({len(self.pile)}).")
            return
        if self.end_check():
            return
        nxt = self.pending_next
        if nxt is None or not self.piles[nxt]:
            nxt = self.next_alive(self.flipper)
        if not self.piles[nxt]:
            return self.end_check(force=True)
        self.stage = "flip"
        self.to(nxt)
        if self.auto(nxt):
            self.room.bot_at = time.time() + random.uniform(0.3, 0.7)

    def take(self, w, text):
        self.piles[w] += self.pile
        self.pile = []
        self.challenge = None
        self.room.add_log(text)
        if self.end_check():
            return
        self.stage = "flip"
        self.to(w if self.piles[w] else self.next_alive(w))

    def end_check(self, force=False):
        alive = self.alive()
        if len(alive) == 1 and not self.pile:
            self.room.finish(self.pl(alive[0]), f"🏆 {self.nm(alive[0])} has every card and wins Egyptian Ratscrew!")
            return True
        if (self.ends and time.time() > self.ends) or force or self.flips > 2000:
            counts = [len(p) for p in self.piles]
            self.room.add_log("⏱️ Time! Most cards wins.", "big")
            self.win_by_score(counts, what="cards")
            return True
        return False

    # -- slapping

    def slap(self, i):
        kind = self.slappable() if self.stage in ("window", "flip") else None
        if kind:
            self.slaps[i] += 1
            if self.slaps[i] == 5 and self.pl(i):
                self.award(self.pl(i), "fast")
            self.moment(f"👋 {self.nm(i)} slaps the {kind}!", "good", "crack")
            self.room.deadline = None
            return self.take(i, f"👋 {self.nm(i)} slaps the {kind} and takes {len(self.pile)} cards.")
        if not self.piles[i]:
            raise GameError("Nothing to burn: wait for a real slap.")
        c = self.piles[i].pop(0)
        self.pile.insert(0, c)
        self.flash = f"🔥 {self.nm(i)} burned a card"
        self.room.add_log(f"✋ {self.nm(i)} slapped wrong and burns a card.", "power")
        if not self.piles[i] and self.room.turn == self.seats[i]:
            self.after_window() if self.stage == "window" else self.to(self.next_alive(i))

    # -- actions, clock, bots

    def act(self, p, a):
        i = self.seat(p)
        if i is None or p.eliminated:
            raise GameError("You're watching this game.")
        t = a.get("type")
        if t == "slap":
            return self.slap(i)
        if t == "flip":
            self.require_turn(p)
            if self.stage != "flip" or not self.piles[i]:
                raise GameError("Wait a moment.")
            return self.flip(i)
        raise GameError("Unknown action.")

    def on_timeout(self):
        if self.stage == "window":
            return self.after_window()
        if self.stage == "flip" and self.room.turn in self.seats:
            i = self.seats.index(self.room.turn)
            return self.flip(i)

    def bot_ready(self):
        if self.room.phase != "playing":
            return False
        if self.stage == "window":
            return bool(self.react)
        return self.stage == "flip" and self.room.turn in self.seats and self.auto(self.seats.index(self.room.turn))

    def bot_tick(self):
        if self.stage == "window" and self.react:
            k = min(self.react, key=self.react.get)
            self.react = {}
            return self.slap(k)
        if self.stage == "flip":
            i = self.seats.index(self.room.turn)
            self.flip(i)

    def bot_move(self, i, level):
        if self.stage == "flip":
            self.flip(i)

    # -- view

    def meta(self, p):
        i = self.seat(p)
        return "" if i is None else f"🎴 {len(self.piles[i])}"

    def final_scores(self):
        return {pid: len(self.piles[k]) for k, pid in enumerate(self.seats)}

    def table(self, p, i):
        info = [{"tags": [f"🎴 {len(self.piles[k])}" + (f" · 👋{self.slaps[k]}" if self.slaps[k] else "")], "out": not self.piles[k]} for k in range(self.n)]
        ch = self.challenge
        label = f"{len(self.pile)} cards"
        if ch:
            label += f" · {self.nm(ch['by'])}'s {rank(self.pile[-1]) if rank(self.pile[-1]) in TRIES else 'face card'} challenge"
        t = {"info": info, "piles": [{"cards": self.pile[-3:], "fan": True, "label": label}],
             "banner": self.flash or (f"Answer within {ch['left']}!" if ch and self.stage == "flip" else None),
             "scores": {"title": "Cards", "rows": [{"seat": k, "value": len(self.piles[k])} for k in sorted(range(self.n), key=lambda k: -len(self.piles[k]))],
                        "hint": {"beggar": "Face cards demand an answer: J 1, Q 2, K 3, A 4.", "slapjack": "Slap every jack!", "snap": "Slap two of a kind in a row!"}.get(
                            self.variant(), "Slap doubles (7 7)" + (" and sandwiches (7 4 7)" if self.s.get("slaps", "both") == "both" else "") + ".")}}
        if self.ends:
            t["scores"]["hint"] += f" {max(0, int(self.ends - time.time())) // 60}:{max(0, int(self.ends - time.time())) % 60:02d} left."
        if i is None:
            return t
        btns = []
        if self.stage == "flip" and self.room.turn == p.id and self.piles[i]:
            btns.append({"label": "🂠 Flip", "a": {"type": "flip"}, "kind": "primary big"})
            t["turnText"] = "🂠 Flip!" if not ch else f"🂠 Answer the face card ({ch['left']} left)"
        if (self.piles[i] or self.slappable()) and self.variant() != "beggar":
            btns.append({"label": "👋 SLAP", "a": {"type": "slap"}, "kind": "slap"})
        t["buttons"] = btns
        t["piles"].insert(0, {"cards": ["??"] if self.piles[i] else [], "count": len(self.piles[i]), "label": "Your stack", "corner": True})
        return t
