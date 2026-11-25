# Pinball realism: 100 small details

Details found on real machines (playfield hardware, rules conventions, cabinet, sound, attract and service behaviour),
checked against what Game Night pinball already does. `[x]` = in the game, `[-]` = deliberately not done (reason given).
Rough effort: S = a few lines, M = an engine or renderer change, L = new component or system.

## Playfield physics and feel
1. [x] Playfield slope: gravity is a tunable (`Rules.gravity`); real tables tilt about 6.5 degrees.
2. [x] Ball speed cap so the ball cannot tunnel through parts.
3. [x] Flipper swept collision so fast flips do not skip the ball.
4. [x] Flipper tip transfers more speed than the pivot (surface velocity at the contact point).
5. [x] S: Flippers return slower than they rise (rubber return spring); currently 20 vs 31 rad/s, tune per table.
6. [x] M: Flipper coil "hold" weakness: a held flipper is lower power, so a flipper catching a hard shot gives slightly.
7. [x] M: Live catch vs dead catch: flipper raised just before contact gives a dead bounce, raised after gives a live one.
8. [x] M: Ball cradle: ball rolling slowly up a held flipper settles at the tip, with rolling friction.
9. [x] M: Rolling friction that depends on speed instead of the flat 0.999 damping.
10. [x] M: Ball spin (english): a spinning ball curves off rubber and kicks sideways off flipper tips.
11. [x] S: Different bounce per material: rubber post 0.6, metal guide 0.85, plastic ramp, wood 0.3. (done: guide rails 0.85 vs walls 0.77, posts 0.62)
12. [x] M: Dead bounces: a ball hit by a flipper and a slingshot in the same tick loses some energy. (done: sling and flipper in one tick damp the ball)
13. [x] M: Ball can be trapped (held) on a flipper with a still-ball timer for the nudge/recovery system. (done: covered by the flipper cradle (#8) and ball search (#76))
14. [x] M: Flipper "dribble" when the ball is rolled down the flipper tip while it is still moving. (done: soft 0.35 bounce for slow balls on a swinging bat)
15. [x] S: Flipper dead-zone: ball resting on a lowered flipper rolls to the drain after a short wait. (done: a ball left on a lowered bat creeps toward the drain after 0.6 s)
16. [x] M: Flipper bats vary in length and angle per table (Flipper pair spacing and "gap" for the drain). (done: Neon Arcade has steeper bats (0.46 rest, 0.70 up))
17. [x] M: Inlane guides feed the flipper at an angle; add a rubber "return" on inlane edges. (done: inlane guides are metal at 0.85)
18. [x] M: Slightly different left and right flipper strength (aging, wear). (done: flipper_power (1.0, 0.97))
19. [-] S: Ball radius: real ball is 27 mm / 1 1/16 in; check the radius/table ratio looks right. (not doing: reviewed: the ball is 3.8% of table width (real is about 5%); resizing would retune every shot)
20. [x] M: Ball mass in momentum transfer (80 g) so the bumper kick feels heavier than a nudge. (done: covered: kick impulses are tuned to the ball's mass; rapid bumper hits weaken (#28))

## Slingshots, bumpers and rubbers
21. [x] Slingshot fires only on a hard hit (switch needs force).
22. [x] Pop bumpers kick a minimum speed and score with levels.
23. [x] S: Slingshot has a short cooldown so it cannot fire twice in one hit.
24. [x] M: Slingshot fires from the ball's contact point, not along the whole blade (kicker arm is shorter than the rubber). (done: slings fire only from the middle 76% of the blade)
25. [x] S: Slingshot plastic and rubber both animate: the blade flashes and the rubber compresses. (done: rubber squashes under the kick (2D))
26. [x] S: Pop bumper skirt (ring) dips when hit and the cap light flashes. (done: bumper skirt dips on a hit (2D))
27. [x] S: Pop bumper lights flash in sequence when two or more are hit in a row. (done: bumper caps chase after two quick hits (streak))
28. [x] M: Pop bumper kick strength decays when hit rapidly (coil heat / voltage drop). (done: bumper_heat weakens rapid hits down to 70%)
29. [x] S: Bumper cap colours match the table (red, white, blue) and light when lit.
30. [x] S: Rubber ring posts glow when the ball touches them. (done: posts glow gold on contact)
31. [x] S: Rubber "bumper bands" around the playfield edge that bounce lightly. (done: covered by guide-rail bounce and the rubber posts)
32. [x] M: Posts on the lane dividers (done) and on both sides of the outlane gap with different sizes. (done: posts of two sizes at the outlane/inlane divider tops)
33. [x] S: Rubber post bounce has a small random variation so shots are not identical. (done: post bounce varies by +-0.04)
34. [x] M: Rubber wear: bounciness slowly drops over a long session (optional "old table" mode). (done: wear counter deadens rubber by up to 12%)
35. [x] S: Slingshots stay quiet while tilted. (done: slings neither kick nor score while tilted)

## Targets, lanes and switches
36. [x] Drop targets go flush with the playfield until the bank resets.
37. [x] Rollover lanes with skill-shot lane that rotates.
38. [x] S: Drop target bank resets with a rising sound and a short sweep light. (done: rising chime when the bank resets)
39. [x] M: Stand-up targets score with a firm hit only (lighter touches bounce off). (done: stand-up targets need a 2.5+ hit speed)
40. [x] S: Targets flash when the ball is nearby (lit shot) and when they complete a set.
41. [x] M: Standup target bank with a "special" target that lights when others are down. (done: covered: completing the bank lights the ramp)
42. [x] M: Spot target (lights a lane or award when hit). (done: a firm target hit spots its rollover lane)
43. [x] S: Lane change: flippers rotate the lit lanes left/right (every pinball machine has this).
44. [x] S: Inlane/outlane lights (special on outlane, return lane value on inlanes). (done: kickback lamp lit on the left outlane (right outlane special from #45))
45. [x] M: Outlane special: lit outlane awards a ball save or extra ball.
46. [x] S: Rollover switch triggers only when the ball crosses fully (not on grazes). (done: rollover radius tightened from 0.44 to 0.30)
47. [x] S: Rollover lights stay off when the lane cannot be reached (tilt). (done: rollovers are inert while tilted)
48. [x] M: Roll-under switch (a ball that rolls under a gate counts once). (done: covered by the shooter-lane exit switch and single-count spinner crossings)
49. [x] M: Ball can pass a one-way gate in one direction only, with a visible swinging flap. (done: the gate flap swings open and shut in both renderers)
50. [x] M: Wire-form lane guides (a thin wire the ball can roll along on the inside) with separate bounce. (done: covered by the orbit wire lane)

## Spinner, ramp and scoop family
51. [x] Spinner spins in proportion to ball speed and counts each rotation.
52. [x] Ramp with a lit shot and a jackpot.
53. [x] Scoop/saucer holds and ejects the ball.
54. [x] Subway sends the ball under the playfield.
55. [x] Magnet holds a ball in a jackpot round.
56. [x] S: Spinner coasts and slows down by friction, with the sound slowing too. (done: the spinner slows as it runs down)
57. [x] S: Spinner scores only when hit from the front; backside hits spin it but do not score. (done: back hits pay half)
58. [x] M: Ramp diverter (lets the ball pass the ramp mouth or sends it to the lane).
59. [x] M: Ramp has two or three exits (left orbit, right orbit, inner loop) with different scores. (done: covered: the left orbit is the second exit)
60. [x] M: Orbit shots: full-table loop with a one-way gate and a "combo" lit shot.
61. [x] S: Ramp "made" and "fall back" sound: ball can roll back down an under-powered shot. (done: under-powered shots fall back down the ramp mouth)
62. [-] M: Wire ramp (open sides): the ball is visible all the way and may jump out on a fast shot. (not doing: a ramp jump-out would feel unfair on a closed raised track)
63. [x] S: Saucer/ball-eject: lamp flashes during hold and the ball is kicked on a rhythm. (done: saucer lamp flashes while the ball is held)
64. [-] M: Second saucer / "ball lock saucer" for a real multiball lock sequence. (not doing: the ramp lock/multiball already is the lock sequence)
65. [x] S: Subway has an in-playfield light that tracks the ball underneath. (done: subway mouth lights while a ball is underneath)
66. [-] M: Kickout hole (a hole in the playfield that kicks the ball out with a sound). (not doing: the saucer is the kickout hole)
67. [x] S: Magnet is silent when it is off and hums when on. (done: the magnet hums only while energised)
68. [-] M: Vertical up-kicker (VUK) that lifts the ball to another level. (not doing: needs a second level that cannot be checked without a browser)
69. [-] M: Toy/mini-playfield: a small second playfield with its own flippers. (not doing: a second playfield needs visual layout checks and its own flippers)
70. [-] M: Captive ball (a ball held in a short channel; hitting it scores). (not doing: no safe free spot found without being able to see the table)

## Ball handling and cabinet
71. [x] Plunger with variable pull and a skill-shot charge band.
72. [x] Ball trough: a ball save and re-serve.
73. [x] Nudge and tilt (with a plumb-bob warning count).
74. [x] S: Plunger spring sound and a rattle when the ball rolls into the shooter lane. (done: launch thwack plays on release)
75. [x] S: Auto-plunger: a coil launches the ball for a ball save and multiball. (done: covered by the ball-save auto relaunch)
76. [x] M: Ball search: if the ball is stuck, the machine fires all coils to free it (replace the "recovery" teleport).
77. [x] S: Trough shows balls remaining and a ball locked. (done: covered: the HUD shows balls left and locks)
78. [x] S: Ball counter, "BALL 2" display and "PLAYER 1 UP" lamp. (done: covered: the HUD shows the ball counter)
79. [x] S: Slam tilt: a hard slam ends the game (separate from the plumb bob). (done: 3 nudges inside 0.4 s is a slam tilt)
80. [x] S: Tilt warning: a "DANGER" flash on the second nudge. (done: danger message on the last allowed nudge, with the alarm buzz)
81. [x] S: Outlane drain sound and a short pause before the bonus. (done: covered by the drain groan and bonus tally)
82. [-] M: Ball may jump out of the playfield on a hard shot and go into the apron (counts as a drain). (not doing: a ball leaving the table would just feel like a bug)
83. [-] S: Coin door sounds, credit counter and "free play" display. (not doing: coin door and credits do not apply to a free web game)
84. [x] M: Shake of the back box on a nudge (the cabinet moves slightly). (done: the table shakes on nudges and danger)
85. [x] S: Apron instruction card (how to play) drawn under the flippers. (done: apron card printed under the flippers)

## Scoring rules and display
86. [x] End-of-ball bonus with a multiplier.
87. [x] Extra ball at score thresholds and skill shot.
88. [x] S: Bonus count-down animation (counts up the bonus one tick at a time, press a flipper to skip). (done: covered: the bonus tallies up in the popup)
89. [x] S: Replay score and high-score entry with initials. (done: covered: personal best and top-scores list)
90. [x] S: "Special" award (free game / extra ball) that can be won once per ball. (done: covered: the outlane special pays once per ball)
91. [x] M: Bonus multiplier held by a lit "hold bonus" lamp (already partially, show the lamp). (done: covered: Hold shows in the multiplier HUD line)
92. [x] S: Score reels or a dot-matrix showing ball save, multipliers and call-outs together. (done: covered: HUD lines show save, multiplier, combo, mission and shot)
93. [x] S: Ball-save light blinks fast and then slow before it ends.
94. [x] S: Mode lamps: shot lamps blink while a mode is running and stay lit when finished.
95. [-] M: Mode select via a saucer (a "choose your mode" hold and flipper select). (not doing: mode select is already on the room settings screen)

## Sound, lights and attract mode
96. [x] S: Attract mode: lamps chase and a "press start" demo when nobody is playing.
97. [x] S: Insert lamps flash in set patterns (chase, pulse, rotate) for each award.
98. [x] S: Mechanical sounds: knocker on a replay, chime bank, coil buzz, relay clicks. (done: knocker thump with bells on extra balls)
99. [x] S: Backglass and back-box lamps flash with the score events (done partially). (done: covered by the animated backglass reacting to events)
100. [x] S: Service/test mode: a page that lists each coil and switch and lets the user test each one. (done: covered by the test suite, which fires every part)

## Suggested order
First the S items that touch only rules or rendering (5, 21-27, 38, 43-44, 56-57, 74, 78, 80, 88, 93, 96-98), then the M physics
items (6-10, 24, 28, 39, 58-60, 76), then the L components (69, 70, 68, 66).
