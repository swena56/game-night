"""Standalone timed or free-play basketball, using Midway Night's hoop simulation."""

from .midway import Midway, THROW_CLOCKS, DEFAULT_THROW_CLOCK, HOT_AT


class Basketball(Midway):
    id = "basketball"
    name = "Basketball"
    icon = "🏀"
    blurb = "Shoot at the hoop, work the glass, and build a hot hand. Play against the clock or take all the time you need."
    howto = [
        "Tap a ball and flick up to shoot. A steeper flick makes a floater; a diagonal flick aims for the backboard. Dip down at release for backspin, or add a sideways hook for spin.",
        "Make a swish, then bank your next shot for a bonus in Swish & Bank mode. Reuse balls as they roll back to the rack. The highest score wins when the clock runs out, or play without a limit.",
    ]
    settings_schema = {
        "hoop_movement": ("Hoop", [("fixed", "Fixed hoop"), ("moving", "Moving hoop")], "fixed"),
        "hoop_scoring": ("Scoring", [("combo", "Swish & Bank"), ("classic", "Classic")], "combo"),
        "clock": ("Time limit", [(seconds, f"{seconds} s") for seconds in THROW_CLOCKS] + [(0, "No time limit")], DEFAULT_THROW_CLOCK),
    }

    @property
    def total(self):
        return 1

    def start(self, seated, rng):
        # Midway's round setup chooses the booth from room settings. Pin it to
        # hoops only while constructing the round, then keep room settings clean.
        missing = object()
        previous = self.s.get("booth_type", missing)
        self.s["booth_type"] = "hoops"
        try:
            super().start(seated, rng)
        finally:
            if previous is missing:
                self.s.pop("booth_type", None)
            else:
                self.s["booth_type"] = previous

    def view(self, p):
        view = super().view(p)
        view["basketball"] = view.pop("midway")
        return view

    def meta(self, p):
        if not hasattr(p.g, "tickets"):
            return ""
        return f"🏀 {p.g.tickets}" + (" · 🔥" if getattr(p.g, "streak", 0) >= HOT_AT else "")
