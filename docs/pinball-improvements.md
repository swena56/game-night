# Pinball: subtle improvements per part, and what is still missing

Written after the bigger ball and the new launch spring. Everything here is a plan, not a promise: each item says what a player would
notice, where it lives, and how big it is (S = an evening, M = a few evenings, L = a week).

## Done in this round
- **Bigger ball** (radius 0.19 to 0.21, about 10% wider): easier to follow on a phone, and it fills the lanes the way a real ball does.
  The cabinet still fits it (ball 0.42 across; drain gap 0.5 to 1.5 units, shooter lane 1.2 wide, flipper reach unchanged). The test
  bot scores less with a bigger ball: Golden Hour about 5% lower, Neon Arcade about 12% lower (0.22 was 20% and 27% lower, and the small
  test table in `tests/pinball_rules.py` fell under the 2,000-point check, so 0.21 is the size used). Extra-ball scores were left alone.
- **Check table button** in the editor toolbar (and **⭐ Feature**): both work when the editor is open on the device running the server
  (http://localhost:8000); elsewhere they say so instead of vanishing. Check table plays the bot for a few games and shows score, ball
  time, where balls drained and which parts were never used.
- **Bigger hit animations**: a bumper hit pops the whole bumper out and rings it back (damped spring), with two expanding shock rings, a
  starburst and a bloom; a slingshot squashes, springs past its rest width and throws sparks off the bar; a target flashes and sparks;
  saucers and kicker holes pulse a ring closing in on a catch and burst out on the kick. Flat and 3D renderers both do this, and it is
  skipped when the player asks for reduced motion.
- **Plunger release**: the head springs past rest and settles when you let go.
- **Launch spring**: a coil that squeezes as the plunger is pulled back, a rod down its middle, a brass head and a warm glow when the pull is
  strong (flat renderer in `static/games/pinball.js`, 3D renderer builds ten chrome rings that follow the head).

## Fewer balls down the sides (plan, with measurements)

**How to measure.** The editor's **🔍 Check table** button (on the device running the server) and `tools`-style scripts both use
`games/pinball_tables/check.py`, which now reports where balls drained (left outlane, left flipper, right flipper, right outlane) and what
event came just before a side drain. It is the test bot, not a person, and a run is 30 balls, so read it as a rough guide.

**Baseline (Golden Hour, 10 bot games, 30 balls):** 29% of balls drain down the outlanes, and almost all of that is the right one
(right outlane 26%, left 3%). Neon Arcade: 20% (right 17%, left 3%).

**What did not help (measured, so do not repeat):**
- A narrower outlane entrance (post nudged in): 26% side drains but the bot's score halved. Not worth it.
- A bigger post above the right outlane: 32%, slightly worse.
- Moving the ramp exit toward the middle: no change at all (the bot almost never shoots the ramp, so this is not where its balls come from).

**Why the right side loses more.** The playfield runs from the left wall (x = 0) to the shooter lane wall (x = 8.8), centre 4.4, but the
flipper pivots sit at 3.22 and 6.78, centre 5.0. The right inlane and outlane are about 2.0 wide, the left about 3.2. Everything that
carries speed down the right wall (the spinner at 7.95, the subway mouth at 8.15, the right sling's outer end at 7.73) lands in the narrower
channel. The left side also has the kickback and the saucer to soak up a fast ball.

**Levers to try next, in order (each is a one-file change you can re-measure with Check table):**
1. A right-side **kickback** like the left one (an outlane save that fires the ball back up once per ball). The special lamp pays a ball
   save today but does not return the ball. Expected: most of the right outlane's 26% drops. M
2. **Re-centre the cabinet**: move both flipper pivots 0.6 to the right of their current x only if the guides, slings and outlanes move
   with them; or narrow the outlane walls symmetrically. L (touches every table, so it needs a re-test of all clones)
3. **Soften the right sling's kick** toward the outlane (its direction is fixed by the bar's angle; a shorter bar or a post at its outer end
   sends the ball inward). S
4. **Outlane rollover lights** (lit lanes that tell a player a ball is heading outside) and a **ball-save light** that stays on a little
   longer after launch. S
5. Keep the tilt/nudge rule that lets a player rescue a ball heading into an outlane; show a nudge hint when the ball is within 1 unit of an
   outlane entrance and moving toward it. S

## Subtle improvements, part by part

### The ball
- Rolling spin: show the ball's rotation (a faint stripe or highlight that turns with its speed) so a slow roll reads as a roll. S
- Contact shadow that stretches with height on ramps and after a bumper pop. S
- Brief squash along the impact direction on a hard hit (one frame, 6%). S

### Flippers
- Rubber colour per side and a visible tip bevel; a soft shadow under the bat. S
- A short "hold" settle (a few degrees of give) when held up against a ball. M
- Flip button feedback: the bat lights a rim for the first 80 ms after a press. S
- Extra (mid-table) flippers: draw a small L or R tag so players know which button moves them. S

### Pop bumpers
- Per-bumper lamp ring that flickers on a hit; the skirt dip already exists. S
- Kick direction jitter of about 3 degrees so a ball cannot be trapped in a perfect loop between two bumpers. S
- Score pop floats from the bumper (+100) instead of only the HUD. S

### Slingshots
- Kick strength and direction should follow where on the rubber the ball hit, and a slow roll should not fire it (already so: keep tested). S
- Lamp flash on the bar and a brief squash of the rubber (exists for the rubber; add the lamp). S

### Targets (stand-ups)
- Hit recoil (2 px) and a spark; lit state eases instead of snapping. S
- Bank completion: a sweep of light along the bank, then reset with a delay so players see the award. S

### Rollover lanes
- Light pulse as the ball passes, and a chase when all lanes complete. S
- Lane change: the flipper buttons rotate which lanes are lit, as on a real table (see missing parts). M

### Posts, walls, curved walls, rubber bands
- Walls: a chrome bevel highlight on the lit side and a soft inner shadow, so walls read as raised. S
- Rubber bands: slight give (deadens a fast ball more than a slow one) and a visible stretch. M
- Posts: a rubber sleeve ring and a quieter thud than bumpers. S

### Spinner
- Blade angle drawn from the real spin phase with motion blur at speed; click pitch follows spin rate. S
- Score a fraction per quarter turn so a hard spin keeps paying after the ball leaves. M

### Saucer and kicker holes
- Ball sinks (scales down) as it is captured, then rises with a small bounce when kicked out; the arrow shows the eject direction. S
- Eject jitter of about 2 degrees so the same shot is not identical every time. S

### Magnet
- Strength ramps up over about 0.3 s and the field ring pulses with it, instead of switching on. S
- Release flicker so a held ball visibly drops. S

### Ramp, subway and orbit
- Ramp: entry flap, a little ball shrink and shadow on the way up, a rail shadow on the playfield. M
- Subway: a ghost ball moving under the glass (a faint circle) while it travels. S
- Orbit: a travelling light along the wire when the ball is on it; diverter click when it closes. S

### One-way flaps and portals
- Flap hinge animation when the ball pushes through; portals get a swirl and a matching exit pulse. S

### Moving target
- Show its track as a faint groove; a hit slows it for half a second. S

### Plunger, gate and shooter lane
- Release overshoot: the head springs past rest and settles (two small bounces). S
- The skill-shot gold band glows brighter as the pull reaches it. S
- Sound: spring creak that rises in pitch with the pull, thwack on release (the thwack exists). S

### Decals and lights
- A light show tab in the editor: all lights and their triggers in one list. M
- Lights that react to the *ball speed* (brighter when fast), and a global "attract" pattern between balls. S

### Cabinet and backglass
- Apron card tilts its text with the table; drain lane gets a faint pulse when the ball is close. S
- Ball save lamp: always visible, blinks in the last second (the HUD does this; mirror it on the playfield). S

## Critical missing parts

Ranked by how much they limit what a table builder can make. An audit of the engine corrected the first version of this list: **lane
change already exists** (a flipper press rotates the lit rollover lanes, `Table.lane_change`), and the editor's targets already behave as
drop targets (a firm hit drops one flush with the playfield until the bank resets).

0. **Fixed: a cleared target bank on a table with no ramp never reset.** On Golden Hour the ramp shot resets the bank; on a table
   built in the editor without a ramp the targets stayed down for the rest of the game and paid nothing for finishing them. A cleared bank
   now pays 2,000 (editable under *Point values*), raises a `bank` event that lights can follow, and pops back up after 3 seconds.
1. **Repeatable stand-up target**: one that scores on every firm hit and never drops, next to the drop targets. Today a table cannot
   have a target that is always there. M
2. **Solenoid diverter / gate**: a flap that the game opens and closes (shot-driven or timed). The one-way flap is passive, so tables
   cannot send the ball down two different routes depending on state (the orbit's diverter is built in, not a part). M
3. **In-editor table check**: the stuck-ball and bot-play checks run only on suggestions. A *Check table* button that plays six bot
   games and draws a heat map of where balls spend time (and which parts never fire) would stop the most common frustration: a table
   that traps the ball. M
4. **Captive ball** and **kickout with a lit lock**: a ball held behind a gate that a ramp shot frees, for multiball setups. M
5. **Collect / bonus letters** (spell a word with targets or lanes, a lit award when complete). Tables currently cannot give a goal
   beyond the fixed missions. M
6. **Light triggers for the remaining parts**: bumper, sling, target, lane, mover, spinner and ramp hits, and the saucer, subway and
   magnet events, are available. Hits on portals, kicker holes, flaps and rubber bands are not. S

Not missing, checked in the engine: tilt and nudge, lane change, ball save, end-of-ball bonus, multiball, ball search (a stuck ball is
freed), skill shot, extra balls, modes (classic, zen, practice, time attack), undo and mirror in the editor, share codes, and a feedback
route for table suggestions.
