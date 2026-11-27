"""🐍 Orb Snakes: Light Riders' grid played as a snake game, as a game of its own (#345, #346).

Every player is a snake that eats orbs to grow: white +1 (spilled by a crashed snake), green +2 and the rare
gold +5. Running into another snake costs a life, and so does biting the blocks just behind its own head (#347);
farther back its own body is safe to cross, and the edge only turns it.
There is no clock and no longest snake: a round goes to the last one with lives left, or, if a goal length is
chosen, to the first to reach it.
A boost is paid for in length, left behind as white orbs. The rules live in games/riders.py (`snake`
switches them on) and the screen is static/games/riders.js.
"""
from .riders import BOOST_COST, GOLD_GROW, NECK, ORB_GROW, DROP_GROW, Riders


class OrbSnakes(Riders):
    id = "snake"
    snake = True
    name = "Orb Snakes"
    icon = "🐍"
    blurb = "Eat orbs, grow as long as you like, and make the other snakes run into you until you're the last one left."
    howto = [
        "Your snake never stops. Swipe, use the arrows or the arrow keys to turn.",
        f"Eat orbs to grow: green +{ORB_GROW}, gold +{GOLD_GROW}, and the white +{DROP_GROW} ones a crashed snake leaves behind.",
        f"Running into another snake costs a life, and so does biting your own {NECK} blocks just behind your head. "
        "Farther back, your body is safe to cross, and the edge just turns you.",
        f"⚡ Boost doubles your speed for a moment, but costs {BOOST_COST} length: it drops behind you as white orbs.",
        "A crash costs a ❤️ life and sends you back to your starting length.",
        "Be the last snake with lives left to win a round (or reach the goal length, if one is set). First to the target wins the match.",
    ]
    settings_schema = {
        "goal": ("Win a round by", [(0, "Last snake alive (no length limit)"), (60, "Reach length 60"), (100, "Reach length 100")], 0),
        "target": ("Rounds to win", [(3, "3"), (2, "2"), (5, "5")], 3),
        "arena": ("Arena", [(52, "Medium"), (40, "Small"), (68, "Large")], 52),
        "speed": ("Speed", [(10, "Normal"), (7, "Chill"), (14, "Fast")], 10),
        "lives": ("Lives", [(3, "3"), (1, "1 (classic)"), (5, "5")], 3),
    }
