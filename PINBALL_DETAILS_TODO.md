# Pinball realism: 100 small details

Details found on real machines (playfield hardware, rules conventions, cabinet, sound, attract and service behaviour),
checked against what Game Night pinball already does. `[x]` = already in the game, `[ ]` = to do.
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
11. [ ] S: Different bounce per material: rubber post 0.6, metal guide 0.85, plastic ramp, wood 0.3.
12. [ ] M: Dead bounces: a ball hit by a flipper and a slingshot in the same tick loses some energy.
13. [ ] M: Ball can be trapped (held) on a flipper with a still-ball timer for the nudge/recovery system.
14. [ ] M: Flipper "dribble" when the ball is rolled down the flipper tip while it is still moving.
15. [ ] S: Flipper dead-zone: ball resting on a lowered flipper rolls to the drain after a short wait.
16. [ ] M: Flipper bats vary in length and angle per table (Flipper pair spacing and "gap" for the drain).
17. [ ] M: Inlane guides feed the flipper at an angle; add a rubber "return" on inlane edges.
18. [ ] M: Slightly different left and right flipper strength (aging, wear).
19. [ ] S: Ball radius: real ball is 27 mm / 1 1/16 in; check the radius/table ratio looks right.
20. [ ] M: Ball mass in momentum transfer (80 g) so the bumper kick feels heavier than a nudge.

## Slingshots, bumpers and rubbers
21. [x] Slingshot fires only on a hard hit (switch needs force).
22. [x] Pop bumpers kick a minimum speed and score with levels.
23. [x] S: Slingshot has a short cooldown so it cannot fire twice in one hit.
24. [ ] M: Slingshot fires from the ball's contact point, not along the whole blade (kicker arm is shorter than the rubber).
25. [ ] S: Slingshot plastic and rubber both animate: the blade flashes and the rubber compresses.
26. [ ] S: Pop bumper skirt (ring) dips when hit and the cap light flashes.
27. [ ] S: Pop bumper lights flash in sequence when two or more are hit in a row.
28. [ ] M: Pop bumper kick strength decays when hit rapidly (coil heat / voltage drop).
29. [ ] S: Bumper cap colours match the table (red, white, blue) and light when lit.
30. [ ] S: Rubber ring posts glow when the ball touches them.
31. [ ] S: Rubber "bumper bands" around the playfield edge that bounce lightly.
32. [ ] M: Posts on the lane dividers (done) and on both sides of the outlane gap with different sizes.
33. [ ] S: Rubber post bounce has a small random variation so shots are not identical.
34. [ ] M: Rubber wear: bounciness slowly drops over a long session (optional "old table" mode).
35. [ ] S: Slingshots stay quiet while tilted.

## Targets, lanes and switches
36. [x] Drop targets go flush with the playfield until the bank resets.
37. [x] Rollover lanes with skill-shot lane that rotates.
38. [ ] S: Drop target bank resets with a rising sound and a short sweep light.
39. [ ] M: Stand-up targets score with a firm hit only (lighter touches bounce off).
40. [ ] S: Targets flash when the ball is nearby (lit shot) and when they complete a set.
41. [ ] M: Standup target bank with a "special" target that lights when others are down.
42. [ ] M: Spot target (lights a lane or award when hit).
43. [x] S: Lane change: flippers rotate the lit lanes left/right (every pinball machine has this).
44. [ ] S: Inlane/outlane lights (special on outlane, return lane value on inlanes).
45. [x] M: Outlane special: lit outlane awards a ball save or extra ball.
46. [ ] S: Rollover switch triggers only when the ball crosses fully (not on grazes).
47. [ ] S: Rollover lights stay off when the lane cannot be reached (tilt).
48. [ ] M: Roll-under switch (a ball that rolls under a gate counts once).
49. [ ] M: Ball can pass a one-way gate in one direction only, with a visible swinging flap.
50. [ ] M: Wire-form lane guides (a thin wire the ball can roll along on the inside) with separate bounce.

## Spinner, ramp and scoop family
51. [x] Spinner spins in proportion to ball speed and counts each rotation.
52. [x] Ramp with a lit shot and a jackpot.
53. [x] Scoop/saucer holds and ejects the ball.
54. [x] Subway sends the ball under the playfield.
55. [x] Magnet holds a ball in a jackpot round.
56. [ ] S: Spinner coasts and slows down by friction, with the sound slowing too.
57. [ ] S: Spinner scores only when hit from the front; backside hits spin it but do not score.
58. [x] M: Ramp diverter (lets the ball pass the ramp mouth or sends it to the lane).
59. [ ] M: Ramp has two or three exits (left orbit, right orbit, inner loop) with different scores.
60. [x] M: Orbit shots: full-table loop with a one-way gate and a "combo" lit shot.
61. [ ] S: Ramp "made" and "fall back" sound: ball can roll back down an under-powered shot.
62. [ ] M: Wire ramp (open sides): the ball is visible all the way and may jump out on a fast shot.
63. [ ] S: Saucer/ball-eject: lamp flashes during hold and the ball is kicked on a rhythm.
64. [ ] M: Second saucer / "ball lock saucer" for a real multiball lock sequence.
65. [ ] S: Subway has an in-playfield light that tracks the ball underneath.
66. [ ] M: Kickout hole (a hole in the playfield that kicks the ball out with a sound).
67. [ ] S: Magnet is silent when it is off and hums when on.
68. [ ] M: Vertical up-kicker (VUK) that lifts the ball to another level.
69. [ ] M: Toy/mini-playfield: a small second playfield with its own flippers.
70. [ ] M: Captive ball (a ball held in a short channel; hitting it scores).

## Ball handling and cabinet
71. [x] Plunger with variable pull and a skill-shot charge band.
72. [x] Ball trough: a ball save and re-serve.
73. [x] Nudge and tilt (with a plumb-bob warning count).
74. [ ] S: Plunger spring sound and a rattle when the ball rolls into the shooter lane.
75. [ ] S: Auto-plunger: a coil launches the ball for a ball save and multiball.
76. [x] M: Ball search: if the ball is stuck, the machine fires all coils to free it (replace the "recovery" teleport).
77. [ ] S: Trough shows balls remaining and a ball locked.
78. [ ] S: Ball counter, "BALL 2" display and "PLAYER 1 UP" lamp.
79. [ ] S: Slam tilt: a hard slam ends the game (separate from the plumb bob).
80. [ ] S: Tilt warning: a "DANGER" flash on the second nudge.
81. [ ] S: Outlane drain sound and a short pause before the bonus.
82. [ ] M: Ball may jump out of the playfield on a hard shot and go into the apron (counts as a drain).
83. [ ] S: Coin door sounds, credit counter and "free play" display.
84. [ ] M: Shake of the back box on a nudge (the cabinet moves slightly).
85. [ ] S: Apron instruction card (how to play) drawn under the flippers.

## Scoring rules and display
86. [x] End-of-ball bonus with a multiplier.
87. [x] Extra ball at score thresholds and skill shot.
88. [ ] S: Bonus count-down animation (counts up the bonus one tick at a time, press a flipper to skip).
89. [ ] S: Replay score and high-score entry with initials.
90. [ ] S: "Special" award (free game / extra ball) that can be won once per ball.
91. [ ] M: Bonus multiplier held by a lit "hold bonus" lamp (already partially, show the lamp).
92. [ ] S: Score reels or a dot-matrix showing ball save, multipliers and call-outs together.
93. [x] S: Ball-save light blinks fast and then slow before it ends.
94. [ ] S: Mode lamps: shot lamps blink while a mode is running and stay lit when finished.
95. [ ] M: Mode select via a saucer (a "choose your mode" hold and flipper select).

## Sound, lights and attract mode
96. [x] S: Attract mode: lamps chase and a "press start" demo when nobody is playing.
97. [x] S: Insert lamps flash in set patterns (chase, pulse, rotate) for each award.
98. [ ] S: Mechanical sounds: knocker on a replay, chime bank, coil buzz, relay clicks.
99. [ ] S: Backglass and back-box lamps flash with the score events (done partially).
100. [ ] S: Service/test mode: a page that lists each coil and switch and lets the user test each one.

## Suggested order
First the S items that touch only rules or rendering (5, 21-27, 38, 43-44, 56-57, 74, 78, 80, 88, 93, 96-98), then the M physics
items (6-10, 24, 28, 39, 58-60, 76), then the L components (69, 70, 68, 66).
