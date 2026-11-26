---
name: make-pinball-level
description: Design, test and ship a new pinball table (level) for Game Night, including one copied from a picture of another table, or fix how an existing table plays (side drains, stuck or looping ball, unreachable parts, dead rails). Use when the user asks for a pinball level, table or layout.
---

# Making a pinball level

Star Cadet (`games/pinball_official/star.json`, now an official table), built from a player's screenshot, was called the best level in the game.
Start from it. Every rule below fixes something that went wrong while building it.

A level is one JSON file, `games/pinball_tables/<slug>.json`: `{"name", "blurb", "author", "spec"}`. The spec is an editor
table (parts in `games/pinball_custom.py`: `SHAPE`, `LIMITS`, `RADIUS`). No code is needed for a new level.
How a table gets listed: `docs/pinball-tables.md`.

## Coordinates
x runs 0 → 8.8 (shooter lane wall), so the **playfield centre is 4.4**, not 5. y runs 0 (top) → 17. The ball is 0.42 wide.
Parts are clamped to x 0.45–8.35 and y ≤ 14.2, silently: compare `build(spec)[1]["items"]` with what you wrote.

## 1. Lay it out
From a picture: list its main features first (flippers, slings, lanes, bumper groups, ramps, centre toy), map each to a part
kind, and tell the user what you left out. If the picture did not arrive, ask for it; never guess a layout.
Draw your own art and name: no logos, brand names or copied artwork. A raised deck can become a small bumper group.

## 2. Get the lower third right (copy these)
| Setting | Value | Why |
|---|---|---|
| `"even_guides": true` | | the right lane guide matches the left (smooth cabinet only) |
| `"fl"` | `[2.48, 14.95, 6.32, 14.95]` | centred on 4.4, with a 0.69 gap. The editor's old `FLIP_GAP` limits count tip centres, not free space: `[2.62, …, 6.18, …]` passed them and the ball could not fit through |
| slings | `(1.45,10.65)-(2.55,12.4)`, mirrored (`x → 8.8 - x`) | slings facing each other closely juggled the ball for 30 s |
| posts | `(0.9,12.15,r .09)`, mirrored, on top of each guide | **never** a post beside a cabinet wall (x 0.45 or 8.35): the gap is 0.38, the ball 0.42. It caught balls and blocked the shot into left-hand wire lanes (Golden Hour: 26 of 240 shots down to 5) |
| `["kick", …]` | | left outlane save plus the side-lane lamps |

Guides end on top of the resting bats by themselves (`flush_end`): ending at the pivot left a lip the ball hopped on. They are
drawn 0.30 thick, hung under the line the ball rolls on. Official tables made before this recipe (Golden Hour, Neon Arcade) only
got the wider gap (`"fl": [3.08, 14.95, 6.92, 14.95]`). Check any table with `python3 -m unittest tests.pinball_levels`.

Mirror everything below y 11. The flippers on the older tables are centred on 5.0, which is why one side drains so much.

## 3. Rails: put mouths where the ball really goes
Never place a ramp or wire lane (`orbit`) by eye. Run `python3 tools/pinball_level.py mouths TABLE.json` and put each mouth
near a top spot that is clear of other parts. Star Cadet's wire lane went from 5% of flipper shots to 19% just by moving it.
- A ramp only opens once **every** drop target is down. Two targets together work; one far across the table is a chore.
- Leave `"lock"` off. A locked ball vanishes and a new one appears at the plunger, which players report as a bug.
- A ramp's exit should leave the ball rolling toward the middle, clear of a side lane.

## 4. Lights and feel
Lights are decals (`dot`, `ring`, `diamond`, `star` …) with an entry in `spec["fx"]`: `[item index, {"m": "pulse"|"flash"|"cycle",
"c2": colour, "r": seconds, "on": "always"|"hit", "src": "bump"|"lane"…, "ho": hold}]`. Useful ones: rings under the bumpers
that flash on a hit, markers on posts that protect a lane, arrows leading to the ramp, a slow pulse on the centre toy.
`"feel": {"classic_lamps": true}` keeps the magnet off until a jackpot round.

**Look and screen.** On phones the table is as wide as it can be while the buttons stay on screen. Do not size it with `vw`, do not
zoom the camera during play (players reported pulsing), and keep the ball one size.

## 5. Measure
    python3 tools/pinball_level.py report TABLE.json --quick     # while editing
    python3 tools/pinball_level.py report TABLE.json             # before shipping: all lines must pass
    python3 tools/pinball_level.py games TABLE.json games/pinball_official/star.json --games 40
    python3 tools/pinball_table.py check TABLE.json              # the gate for the curated list

The report checks the flipper gap, drains down the middle and sides, resting balls, slingshot loops, parts no flipper shot
hits and weak flipper spots (start, middle and end of each bat, resting and dropping). The editor's **Check table** button
shows the same flipper-shot test. A weak spot usually means one part sits right in that shot: trace the first contact and
move it (moving one small bumper 0.4 took a spot from 32% to 100%).

**Read numbers carefully**
- A few dozen balls prove nothing: the same geometry once measured 24% and 48% side drains over 20 games.
- Only compare figures from the same test. Rolled-ball, full-game and Check-table drain shares are different things.
  For scale (full games): Star Cadet 27% ±8, Neon Arcade 52% ±11, Golden Hour 63% ±9.
- Unfinished test games mean long balls or a stuck test player, not necessarily a good or a bad table.
- If the ball "will not fit" or reappears, remember the saves: ball save, centre post (once a game), kickback.
- This machine has one core. Long runs go in the background with `nice`, and slow any game in progress.

## 6. Look at it, then let the user play
Play it in headless Chromium on a test port (see the `verify` skill; from the editor: Tables → Star Cadet-style row → ▶ Play,
after setting `localStorage['unmask.name']`). Screenshot at 485 px. Then `bash start.sh restart` (tables load only at start)
and have the user play. Their reports found what the first tests missed: dead rails, a vanishing ball, a sling loop, a gap
too narrow, a ball that changed size. Add a check to the tool when a new kind of fault turns up.

## 7. Ship
Run `python3 -m unittest tests.pinball_rules tests.pinball_engine` and `node tests/pinball_editor_toolbar.js`. If anything in
`static/` changed, bump `CACHE` in `static/sw.js`. Commit only when asked; push only when asked.
