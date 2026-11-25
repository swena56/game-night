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
    extra_ball_scores: tuple = (40000, 120000)
    shots: tuple = ("lane", "target", "spinner", "ramp")
    first_lit: int = 3
