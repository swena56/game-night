# Axe Throwing blade contact development plan

The fixed-heading throw keeps the blade facing the target. The next milestone is to make the leading point on the cutting edge meet the scored position, then use contact measurements to evaluate future scoring changes.

## 1. Anchor the blade

- Use the same cutting-edge outline as the SVG and WebGL models. Select the leading edge point at the impact orientation. If an adjacent segment lies parallel to the board, use its midpoint.
- Fit the center-of-mass endpoint so that the selected point reaches the server's scored X and Y at the rendered board face. Retain the release pose, fixed heading, and scheduled impact time. Correct early board-plane intersections with the smallest necessary shift along depth.
- Use the selected point as the pivot for handle settling. Carry the same impact pose into a rebound. Continue off-board misses past the target. The current server result supplies points and selects the reaction.
- Derive the resting contact from saved impact orientation so restored shots and reduced-motion views agree with animated throws.

## 2. Record contact and compare predicted surfaces

- Show a contact marker and a Contact summary in the axe debug panel. Include the local edge point, board point, time, terminal pitch and heading, and maximum depth correction. Copy the summary with the existing trace.
- Add a versioned contact record to the JSONL trace metadata. Keep the sample columns stable. Label the animated path as the blade reference point and log the actual contact point separately.
- Sample cutting-edge, head-face, poll, and handle landmarks along the uncorrected flight. Refine plane crossings and classify the first point over the circular target. Estimate the contact approach speed from the center velocity and the rotational term `ω × r`. Compare the provisional blade-first result with the existing scorer in the log.
- Use new traces and visual review to calibrate collision scoring. Verify disagreements on steady, slow, fast, and glancing throws from several start positions before making geometry authoritative.

## 3. Verify and run

| Scenario | Acceptance check |
| --- | --- |
| Center hit | The selected edge reaches the scored point within 0.001 board radii. The handle settles around that point. |
| Early and late rotation | The selected point moves along the edge with pitch. The axe transitions continuously through impact. |
| Bounce | The rebound begins at the impact pose and moves away from the board. |
| Rim and miss | A scored rim hit centers the contact marker on the scored point. A miss continues past the board plane. |
| Placed axe | The chosen pickup changes the launch coordinates and the blade holds its heading. |
| Reduced motion and restored shots | The resting blade uses the same contact calculation as an animated throw. |

Run the Darts input, rules, and browser suites. Review release, impact, and settling in mobile SVG and desktop WebGL. Restart the dev server and verify its health endpoint.

## Implementation and calibration status

Blade anchoring, settling, rebound continuity, and contact logging are implemented. Browser checks exercise the visible marker and verify the WebGL edge position before impact, at impact, and during settling.

The first replay used 21 earlier fixed-heading throws. The estimator reported blade-first contact on all 16 sticks, glancing contact on all three bounces, and no target contact on both misses. A synthetic fast throw also exercised the handle-first path. Fresh logged throws and visual labels are the next calibration input for a scoring change.
