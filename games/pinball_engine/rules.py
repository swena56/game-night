"""Tunable scoring and timing for a table. Tick counts are 240 Hz simulation steps."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rules:
    balls: int = 3
    bumper: int = 100
    bumper_jackpot: int = 200
    sling: int = 50
    target: int = 250
    lane: int = 500
    skill: int = 5000
    spinner: int = 100
    ramp: int = 6000
    jackpot: int = 12000
    jackpot_growth: int = 100     # each bumper hit while the jackpot is lit adds this to the next jackpot
    bumper_bonus: int = 10
    ramp_bonus: int = 1000
    save_ticks: int = 4 * 240
    jackpot_ticks: int = 20 * 240
    combo_ticks: int = 3 * 240
    combo_step: int = 250
    max_mult: int = 5
    max_nudges: int = 3
    lock_balls: int = 0          # ramp locks needed to start multiball (0 disables it)
    multiball_ticks: int = 40 * 240
    multiball_start: int = 5000
    mystery_every: int = 3        # every Nth lit-shot double awards a mystery prize (0 disables)
    mystery_points: int = 10000
    mystery_save_ticks: int = 10 * 240
    super_every: int = 4          # every Nth jackpot is a super jackpot
    super_jackpot: int = 50000
    spinner_step: int = 25        # spins per spinner level (up to +4 levels)
    bumper_step: int = 40         # bumper hits per ball per bumper level (up to +2 levels)
    hurry_ticks: int = 8 * 240    # spinner hurry-up after completing the rollover lanes
    hurry_max: int = 15000
    hurry_min: int = 1500
    multiball_save_ticks: int = 8 * 240   # drained multiball balls are returned for this long after the start
    center_post: bool = False             # one drain per game is saved by a pop-up centre post
    extra_ball_scores: tuple = (40000, 120000)
    shots: tuple = ("lane", "target", "spinner", "ramp")
    first_lit: int = 3
    saucer: int = 1000
    subway: int = 2000
    subway_ticks: int = 100       # time the ball spends under the playfield
    saucer_ticks: int = 150       # how long the saucer holds the ball before kicking it out
    sling_threshold: float = 4.0  # ball speed into the blade needed to fire a slingshot
    gravity: float = 11.0        # table slope: higher plays faster
    wizard_at: int = 8            # the Nth jackpot of a game starts a free four-ball Wizard multiball (0 disables it)
    wizard_points: int = 25000
    # timed missions, started by a ramp shot: (title, shot prefix to count, goal, reward)
    missions: tuple = (("Bumper bash", "bumper", 6, 6000), ("Spin it", "spinner", 8, 5000),
                       ("Slingshots", "sling", 5, 4000), ("Rollovers", "lane", 4, 4000))
    mission_ticks: int = 30 * 240
    skill_miss: int = 1000        # a skill shot into the wrong lane pays this much
    last_ball_save: int = 3 * 240 # extra ball-save time on the final ball
    final_bonus: int = 2500       # end of game: per jackpot and per multiball won
