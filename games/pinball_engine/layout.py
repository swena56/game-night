"""Static description of a pinball table. Coordinates are playfield units, down-table is +y."""
from dataclasses import dataclass
import math

STEP = 1 / 240  # the simulation advances in fixed 240 Hz ticks


def closest(x, y, ax, ay, bx, by):
    """Closest point to (x, y) on the segment a-b."""
    dx, dy = bx - ax, by - ay
    fraction = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return ax + dx * fraction, ay + dy * fraction


@dataclass(frozen=True)
class Layout:
    """Everything a table needs: walls, scoring parts, flippers and the shooter lane.

    rails, slings and targets are (x1, y1, x2, y2) segments. bumps are (x, y, radius), lanes are
    (x, y) rollover sensors, and flippers are (pivot x, pivot y, rest angle, raised angle).
    The one-way gate and the outlane trigger are optional (None disables them).
    """
    rails: tuple
    flippers: tuple
    launch: tuple
    slings: tuple = ()
    bumps: tuple = ()
    targets: tuple = ()
    lanes: tuple = ()
    gate: tuple | None = None
    spinner: tuple | None = None
    ramp: tuple | None = None
    ramp_exit: tuple | None = None
    outlane: tuple | None = None
    saucer: tuple | None = None   # (x, y, radius) scoop: captures a slow ball, holds it, then kicks it back out
    width: float = 10
    height: float = 17
    ball: float = 0.19
    flipper_length: float = 1.56
    flipper_radius: float = 0.15
    skill_charge: tuple = (197, 228)
    flipper_zone: tuple = (13.6, 16.2)
    lane_exit_y: float = 5
    center: tuple = (5, 12)
    theme: str = ""          # lets a renderer restyle the shared artwork (e.g. "neon")

    @property
    def lane_x(self):
        """Inner wall of the shooter lane."""
        return self.gate[0] if self.gate else self.width - 1.2

    def resting_angles(self):
        return [f[2] for f in self.flippers]

    def public(self):
        """The layout dict sent to the browser renderers."""
        return dict(rails=self.rails, gate=self.gate, slings=self.slings, bumps=self.bumps,
                    targets=self.targets, lanes=self.lanes, spinner=self.spinner, ramp=self.ramp, saucer=self.saucer,
                    exit=self.ramp_exit, flips=self.flippers, length=self.flipper_length,
                    radius=self.ball, skill=self.skill_charge, width=self.width,
                    height=self.height, launch=self.launch, theme=self.theme)


def flipper_pair(y, left_x, right_x, rest=0.42, up=0.66):
    """Mirrored left/right flippers, the usual pair at the bottom of the playfield."""
    return ((left_x, y, rest, -up), (right_x, y, math.pi - rest, math.pi + up))
