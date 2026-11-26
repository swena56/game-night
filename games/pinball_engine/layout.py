"""Static description of a pinball table. Coordinates are playfield units, down-table is +y."""
from dataclasses import dataclass, field
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
    subway: tuple | None = None       # (x, y, radius) mouth; the ball travels under the playfield to subway_exit
    subway_exit: tuple | None = None  # (x, y, vx, vy): where the ball reappears and how it is fired
    special: tuple | None = None      # (x, y): inner edge of the right outlane; lights while the multiplier is 2x or more
    orbit: tuple | None = None        # (x, y, radius) mouth of an orbit lane the ball rides along orbit_path
    orbit_path: tuple = ()            # waypoints (x, y) from the mouth to the exit
    orbit_exit: tuple = (0, 5)        # (vx, vy) the ball leaves with
    guides_from: int = 9              # rails from this index on are metal guides (livelier than the walls)
    posts: tuple = ()                 # (x, y, radius) passive rubber posts: they bounce the ball, no score
    magnet: tuple | None = None       # (x, y, pull radius): grabs and holds the ball while energised
    saucer: tuple | None = None   # (x, y, radius) scoop: captures a slow ball, holds it, then kicks it back out
    rubbers: tuple = ()               # (x1, y1, x2, y2) dead-rubber bands: bouncy, no score
    movers: tuple = ()                # (x1, y1, x2, y2, speed) a target that slides along a track
    holes: tuple = ()                 # (x, y, radius, angle in degrees) extra kicker holes: hold the ball, then fire it out
    part_pts: dict = field(default_factory=dict, hash=False, compare=False)   # custom tables: {'bump': {index: points}} overrides the rules' score for one part
    portals: tuple | None = None      # (x1, y1, x2, y2, radius): a linked pair of holes; a ball entering one leaves from the other
    flaps: tuple = ()                 # (x1, y1, x2, y2) one-way flaps: solid from the left of a->b, the ball passes from the right
    guide_run: int = 2                # how many of the guide rails (from guides_from) are the violet inlane guides
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
    paint: dict = field(default_factory=dict, hash=False, compare=False)   # custom tables: part name -> colours, e.g. {"bumps": ["#ff0000", ...]}

    @property
    def lane_x(self):
        """Inner wall of the shooter lane."""
        return self.gate[0] if self.gate else self.width - 1.2

    def resting_angles(self):
        return [f[2] for f in self.flippers]

    def public(self):
        """The layout dict sent to the browser renderers."""
        return dict(rails=self.rails, gate=self.gate, slings=self.slings, bumps=self.bumps,
                    targets=self.targets, lanes=self.lanes, spinner=self.spinner, ramp=self.ramp, saucer=self.saucer, posts=self.posts, orbit=self.orbit, orbit_path=self.orbit_path, special=self.special, magnet=self.magnet, subway=self.subway, subway_exit=self.subway_exit,
                    exit=self.ramp_exit, flips=self.flippers, length=self.flipper_length,
                    radius=self.ball, skill=self.skill_charge, width=self.width,
                    height=self.height, launch=self.launch, theme=self.theme, paint=self.paint,
                    outlane=self.outlane, portals=self.portals, flaps=self.flaps, rubbers=self.rubbers, movers=self.movers, holes=self.holes, guides=self.guides_from, guide_run=self.guide_run)


def flipper_pair(y, left_x, right_x, rest=0.42, up=0.66):
    """Mirrored left/right flippers, the usual pair at the bottom of the playfield."""
    return ((left_x, y, rest, -up), (right_x, y, math.pi - rest, math.pi + up))
