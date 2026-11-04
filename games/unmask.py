"""Unmask: ask yes/no questions to find a hidden, procedurally generated face."""
import random

from .base import Game, GameError

HAIR_COLORS = ["black", "brown", "blonde", "red", "white", "blue"]
EYE_COLORS = ["brown", "blue", "green"]
SHIRTS = ["red", "blue", "green", "yellow", "purple"]
# Traits players can ask about. Skin tone and backgrounds are cosmetic only.
ASKABLE = ["gender", "hair_color", "hair_style", "eye_color", "glasses", "hat",
           "facial_hair", "earrings", "expression", "shirt"]
# Names follow the face (#15): women are drawn with lashes, blush and lip colour; only men have facial hair.
NAMES = {
    "woman": ["Ada", "Cleo", "Esme", "Hana", "Juno", "Lula", "Nell", "Pia", "Rosa", "Tess", "Uma", "Wren",
              "Yara", "Bea", "Dot", "Fern", "Iris", "Mae", "Olive", "Ivy", "Zoe", "Nora", "Lily", "Ruby",
              "Gwen", "Faye", "Opal", "Maya", "Lena", "Tara", "Vera", "Elsa"],
    "man": ["Bram", "Dax", "Finn", "Gus", "Ivo", "Kai", "Milo", "Otto", "Quin", "Sol", "Vik", "Xan",
            "Zed", "Cyd", "Eli", "Hugo", "Jax", "Lev", "Nico", "Pip", "Kit", "Abe", "Ben", "Cal",
            "Dev", "Ezra", "Gil", "Hal", "Jon", "Leo", "Max", "Rex"],
}


def weighted(rng, pairs):
    return rng.choices([v for v, _ in pairs], weights=[w for _, w in pairs])[0]


def make_face(rng):
    hat = weighted(rng, [("none", 6), ("cap", 1), ("beanie", 1), ("tophat", 1)])
    # Under a hat only styles with visible sides are allowed, so every trait stays readable.
    styles = ["short", "long", "curly"] if hat != "none" else ["bald", "short", "long", "curly", "mohawk", "bun"]
    hair_style = rng.choice(styles)
    gender = rng.choice(["woman", "man"])
    return {
        "gender": gender,
        "hair_color": "none" if hair_style == "bald" else rng.choice(HAIR_COLORS),
        "hair_style": hair_style,
        "eye_color": rng.choice(EYE_COLORS),
        "glasses": weighted(rng, [("none", 5), ("round", 2), ("shades", 1)]),
        "hat": hat,
        "facial_hair": "none" if gender == "woman" else weighted(rng, [("none", 3), ("mustache", 2), ("beard", 2)]),
        "earrings": weighted(rng, [("no", 3), ("yes", 1)]),
        "expression": rng.choice(["smile", "neutral", "surprised"]),
        "shirt": rng.choice(SHIRTS),
        "skin": rng.randrange(6),
        "bg": rng.randrange(8),
        "hat_color": rng.randrange(4),
    }


def make_board(size, rng):
    faces, seen = [], set()
    pools = {g: rng.sample(ns, len(ns)) for g, ns in NAMES.items()}
    while len(faces) < size:
        face = make_face(rng)
        key = tuple(face[a] for a in ASKABLE)
        if key in seen:
            continue
        seen.add(key)
        face["id"] = len(faces)
        face["name"] = pools[face["gender"]].pop()
        faces.append(face)
    return faces


def _catalog():
    items = []

    def add(group, attr, value, text):
        items.append({"id": f"{attr}:{value}", "group": group, "text": text})

    add("Person", "gender", "woman", "is a woman")
    add("Person", "gender", "man", "is a man")
    for c in HAIR_COLORS:
        add("Hair", "hair_color", c, f"has {c} hair")
    for v, t in [("bald", "is bald"), ("short", "has short hair"), ("long", "has long hair"),
                 ("curly", "has curly hair"), ("mohawk", "has a mohawk"), ("bun", "wears a bun")]:
        add("Hair", "hair_style", v, t)
    for c in EYE_COLORS:
        add("Face", "eye_color", c, f"has {c} eyes")
    for v, t in [("smile", "is smiling"), ("neutral", "looks serious"), ("surprised", "looks surprised")]:
        add("Face", "expression", v, t)
    for v, t in [("any", "has facial hair"), ("mustache", "has a mustache"), ("beard", "has a beard")]:
        add("Face", "facial_hair", v, t)
    for v, t in [("any", "wears glasses"), ("round", "wears round glasses"), ("shades", "wears sunglasses")]:
        add("Accessories", "glasses", v, t)
    for v, t in [("any", "wears a hat"), ("cap", "wears a cap"), ("beanie", "wears a beanie"),
                 ("tophat", "wears a top hat")]:
        add("Accessories", "hat", v, t)
    add("Accessories", "earrings", "yes", "wears earrings")
    for c in SHIRTS:
        add("Clothes", "shirt", c, f"wears a {c} shirt")
    return items


CATALOG = _catalog()
QTEXT = {q["id"]: q["text"] for q in CATALOG}


def holds(face, qid):
    attr, value = qid.split(":", 1)
    have = face.get(attr, "none")  # boards saved before a trait existed
    if value == "any":
        return have != "none"
    return have == value


def evaluate(face, q):
    a = holds(face, q["a"])
    if not q.get("op"):
        return a
    b = holds(face, q["b"])
    return (a and b) if q["op"] == "and" else (a or b)


def qtext(q):
    t = QTEXT[q["a"]]
    if q.get("op"):
        t += f" {q['op'].upper()} {QTEXT[q['b']]}"
    return t[0].upper() + t[1:] + "?"


def yn(ans):
    return "YES" if ans else "NO"


def reveal_trait(face, attr):
    """Turn one true trait of a face into a (question, answer) pair, or None."""
    value = face.get(attr, "none")
    if f"{attr}:{value}" in QTEXT:
        return {"a": f"{attr}:{value}"}, True
    if value == "none" and f"{attr}:any" in QTEXT:
        return {"a": f"{attr}:any"}, False
    if attr == "earrings":
        return {"a": "earrings:yes"}, False
    return None


CARDS = {
    "combo": {"name": "Combo", "icon": "🔗", "modes": {"duel", "manhunt"},
              "desc": "Ask about two traits at once, joined by AND / OR."},
    "spyglass": {"name": "Spyglass", "icon": "🔍", "modes": {"duel", "manhunt"},
                 "desc": "Secretly learn one true trait of your target. Free action."},
    "jam": {"name": "Jam", "icon": "🧲", "modes": {"duel", "manhunt"},
            "desc": "The next opponent in line skips their turn. Free action."},
    "shapeshift": {"name": "Shapeshift", "icon": "🎭", "modes": {"duel"},
                   "desc": "Swap your secret face for another that still matches every answer you've given. Free action."},
    "eavesdrop": {"name": "Eavesdrop", "icon": "👂", "modes": {"manhunt"},
                  "desc": "Secretly hear the answer to the last question someone else asked. Free action."},
}


class Unmask(Game):
    id = "unmask"
    category = "party"
    howto = [
        'Everyone sees the same board of faces; a secret one is hidden from you.',
        'On your turn, ask a yes/no question — the server answers truthfully.',
        "Flip down faces that don't fit. Think you know? Accuse — but a wrong guess costs you.",
        'Manhunt: questions are public, answers are private. Power cards bend the rules.',
    ]
    name = "Unmask"
    icon = "🎭"
    blurb = "Ask yes/no questions to find the hidden face. Power cards, private answers, ghosts."
    min_players = 1
    max_players = 6
    badges = {**Game.badges, "sharp": ("🔍", "Sharp eye", "Unmask the right face after three questions or fewer"),
              "bold": ("🎲", "Bold guess", "Unmask the right face with a third of your board still face-up")}
    settings_schema = {
        "mode": ("Mode", [("duel", "⚔️ Duel (1v1)"), ("manhunt", "🕵️ Manhunt (1–6)")], "duel"),
        "size": ("Board", [(16, "16 faces"), (24, "24 faces"), (30, "30 faces")], 24),
        "powers": ("Power cards", [(True, "On"), (False, "Off")], True),
    }

    def check_players(self, seated):
        if self.s["mode"] == "duel" and len(seated) != 2:
            raise GameError("Duel needs exactly 2 players — switch to Manhunt for groups.")
        super().check_players(seated)

    def start(self, seated, rng):
        size = self.s["size"]
        self.board = make_board(size, rng)
        self.questions = []
        for p in seated:
            g = p.g
            g.secret, g.flipped, g.cards, g.jammed = None, set(), [], False
            g.about_me = []          # (question, answer) pairs revealed about my secret
            g.learned = []           # (question, answer) pairs I learned about my target
            g.revealed_attrs = set()  # traits my Spyglass already showed me
        if self.s["mode"] == "duel":
            for p, face in zip(seated, rng.sample(range(size), 2)):
                p.g.secret = face
            self.culprit = None
        else:
            self.culprit = rng.randrange(size)
        if self.s["powers"]:
            pool = [c for c, d in CARDS.items() if self.s["mode"] in d["modes"]]
            for p in seated:
                p.g.cards = rng.sample(pool, 2)
        first = rng.choice(seated)
        self.room.add_log(f"Game on! {first.name} goes first.", "big")
        self.room.begin_turn(first.id)

    def target_face(self, p):
        if self.s["mode"] == "duel":
            return self.board[self.room.opponent(p).g.secret]
        return self.board[self.culprit]

    def skip_turn(self, p):
        if p.g.jammed:
            p.g.jammed = False
            self.room.add_log(f"🧲 {p.name} is jammed and skips a turn!", "power")
            return True
        return False

    def meta(self, p):
        if not hasattr(p.g, "flipped"):
            return ""
        jam = " · 🧲" if p.g.jammed else ""
        return f"{len(self.board) - len(p.g.flipped)} left · 🃏{len(p.g.cards)}{jam}"

    # -- actions

    def act(self, p, a):
        t = a.get("type")
        if t == "flip":
            if p.eliminated or not hasattr(p.g, "flipped"):
                raise GameError("You can't flip right now.")
            ids = {i for i in a.get("ids", []) if isinstance(i, int) and 0 <= i < len(self.board)}
            if a.get("down"):
                p.g.flipped |= ids
            else:
                p.g.flipped -= ids
            return
        self.require_turn(p)
        if t == "ask":
            return self.ask(p, a.get("q") or {})
        if t == "accuse":
            return self.accuse(p, a.get("face"))
        if t == "card":
            return self.use_card(p, a.get("card"))
        raise GameError("Unknown action.")

    def ask(self, p, q):
        r = self.room
        q = {"a": q.get("a"), "op": q.get("op") or None, "b": q.get("b")}
        if q["a"] not in QTEXT:
            raise GameError("Pick a question.")
        if q["op"]:
            if q["op"] not in ("and", "or") or q["b"] not in QTEXT or q["b"] == q["a"]:
                raise GameError("That combo question doesn't make sense.")
            if "combo" not in p.g.cards:
                raise GameError("You need a Combo card for that.")
            p.g.cards.remove("combo")
        else:
            q.pop("b")
        text = qtext(q)
        ans = evaluate(self.target_face(p), q)
        p.g.learned.append((q, ans))
        check = {"q": q, "ans": ans}
        if self.s["mode"] == "duel":
            r.opponent(p).g.about_me.append((q, ans))
            r.add_log(f"{p.name}: “{text}” → {yn(ans)}", "question", check=check, helper=p.id)
        else:
            self.questions.append({"asker": p.id, "text": text, "check": check})
            r.add_log(f"{p.name} asked: “{text}”", "question")
            r.add_log(f"🤫 Only you hear it: {yn(ans)}", "private", to=p.id, check=check, helper=p.id)
        r.advance()

    def accuse(self, p, face):
        r = self.room
        if not isinstance(face, int) or not 0 <= face < len(self.board):
            raise GameError("Pick a face to accuse.")
        name = self.board[face]["name"]
        if self.s["mode"] == "duel":
            opp = r.opponent(p)
            truth = self.board[opp.g.secret]["name"]
            if face == opp.g.secret:
                if len(getattr(p.g, "learned", [])) <= 3:
                    self.award(p, "sharp")
                self.bold(p)
                r.finish(p, f"🎯 {p.name} unmasked {opp.name}: it was {truth}! {p.name} wins!")
            else:
                r.finish(opp, f"💥 {p.name} accused {name}, but it was {truth}. {opp.name} wins!")
            return
        if face == self.culprit:
            if len(getattr(p.g, "learned", [])) <= 3:
                self.award(p, "sharp")
            self.bold(p)
            r.finish(p, f"🎯 {p.name} caught the culprit, {name}! {p.name} wins!")
            return
        p.eliminated = True
        r.add_log(f"💥 {p.name} accused {name} — wrong! {p.name} is out and becomes a ghost 👻.", "big")
        left = r.contenders()
        culprit = self.board[self.culprit]["name"]
        if not left:
            r.finish(None, f"The culprit, {culprit}, got away!")
        elif len(left) == 1 and len(r.seated()) > 1:
            r.finish(left[0], f"🏆 {left[0].name} is the last hunter standing! (It was {culprit}.)")
        else:
            r.advance()

    def bold(self, p):
        """A right accusation with a third of your board still face-up is a bold guess."""
        up = len(self.board) - len(getattr(p.g, "flipped", ()))
        if up * 3 >= len(self.board):
            self.award(p, "bold")
            self.room.add_log(f"🎲 A bold guess — {p.name} still had {up} faces up!", "power")

    def use_card(self, p, card):
        r = self.room
        if card not in p.g.cards:
            raise GameError("You don't have that card.")
        mode = self.s["mode"]
        if card == "combo":
            raise GameError("Combo is used by ticking it when you ask.")
        if card == "spyglass":
            face = self.target_face(p)
            options = [a for a in ASKABLE if a not in p.g.revealed_attrs and reveal_trait(face, a)]
            if not options:
                raise GameError("Nothing left to spy on.")
            attr = random.choice(options)
            p.g.revealed_attrs.add(attr)
            q, ans = reveal_trait(face, attr)
            check = {"q": q, "ans": ans}
            p.g.learned.append((q, ans))
            if mode == "duel":
                r.opponent(p).g.about_me.append((q, ans))
            r.add_log(f"🔍 {p.name} peeked through a Spyglass…", "power")
            r.add_log(f"🔍 Spyglass: “{qtext(q)}” → {yn(ans)}", "private", to=p.id, check=check, helper=p.id)
        elif card == "jam":
            if mode == "duel":
                target = r.opponent(p)
            else:
                i = r.order.index(p.id)
                rest = r.order[i + 1:] + r.order[:i]
                target = next((r.players[x] for x in rest
                               if not r.players[x].spectator and not r.players[x].eliminated), None)
                if not target:
                    raise GameError("There's nobody to jam.")
            target.g.jammed = True
            r.add_log(f"🧲 {p.name} jammed {target.name}! They'll skip their next turn.", "power")
        elif card == "shapeshift":
            candidates = [f["id"] for f in self.board if f["id"] != p.g.secret
                          and all(evaluate(f, q) == ans for q, ans in p.g.about_me)]
            if not candidates:
                raise GameError("No other face fits the answers you've given — can't shapeshift.")
            p.g.secret = random.choice(candidates)
            r.add_log(f"🎭 {p.name} shapeshifted! Their secret face changed — but it still matches every answer so far.", "power")
            r.add_log(f"🎭 You are now {self.board[p.g.secret]['name']}.", "private", to=p.id)
        elif card == "eavesdrop":
            last = next((q for q in reversed(self.questions) if q["asker"] != p.id), None)
            if not last:
                raise GameError("Nobody else has asked anything yet.")
            p.g.learned.append((last["check"]["q"], last["check"]["ans"]))
            who = r.players[last["asker"]].name if last["asker"] in r.players else "Someone"
            r.add_log(f"👂 {p.name} is eavesdropping…", "power")
            r.add_log(f"👂 {who} asked “{last['text']}” → {yn(last['check']['ans'])}", "private",
                      to=p.id, check=last["check"], helper=p.id)
        p.g.cards.remove(card)

    # -- bot

    def candidates(self, p):
        return [f for f in self.board if all(evaluate(f, q) == ans for q, ans in p.g.learned)]

    def bot_turn(self, p):
        r = self.room
        mode = self.s["mode"]
        for card, wanted in [
            ("spyglass", True),
            ("jam", random.random() < 0.35),
            ("shapeshift", mode == "duel" and len(self.board) - len(r.opponent(p).g.flipped) <= 3),
        ]:
            if wanted and card in p.g.cards and p.bot != "easy":
                try:
                    self.use_card(p, card)
                except GameError:
                    pass
        cands = self.candidates(p) or [f for f in self.board if f["id"] not in p.g.flipped]
        p.g.flipped = {f["id"] for f in self.board} - {f["id"] for f in cands}
        # Easy bots get impatient and gamble on a short list.
        if len(cands) == 1 or (p.bot == "easy" and len(cands) <= 4 and random.random() < 0.6):
            return self.accuse(p, random.choice(cands)["id"])
        splits = []
        for item in CATALOG:
            yes = sum(holds(f, item["id"]) for f in cands)
            if 0 < yes < len(cands):
                splits.append((min(yes, len(cands) - yes), item["id"]))
        best = max(splits)[1]
        smart = {"easy": 0.0, "normal": 0.4, "hard": 1.0}[p.bot]
        qid = best if random.random() < smart else random.choice(splits)[1]
        self.ask(p, {"a": qid})
        p.g.flipped = {f["id"] for f in self.board} - {f["id"] for f in self.candidates(p)}

    # -- view

    def notes(self, p):
        """What I've learned, in order: each question, its answer, how many faces it ruled out and the question itself."""
        left, out = list(self.board), []
        for q, ans in getattr(p.g, "learned", []):
            keep = [f for f in left if evaluate(f, q) == ans]
            out.append([qtext(q), ans, len(left) - len(keep), q])
            left = keep
        return {"rows": out, "left": len(left)}

    def view(self, p):
        r = self.room
        see_all = p.spectator or p.eliminated or r.phase == "over"
        reveal = None
        if see_all:
            reveal = {"culprit": self.culprit,
                      "secrets": {o.id: o.g.secret for o in r.seated()
                                  if getattr(o.g, "secret", None) is not None}}
        g = p.g
        return {
            "board": self.board,
            "catalog": CATALOG,
            "reveal": reveal,
            "me": {
                "secret": getattr(g, "secret", None),
                "flipped": sorted(getattr(g, "flipped", ())),
                "cards": [{"id": c, "name": CARDS[c]["name"], "icon": CARDS[c]["icon"], "desc": CARDS[c]["desc"]}
                          for c in getattr(g, "cards", [])],
                "notes": self.notes(p),
            },
        }
