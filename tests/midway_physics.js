// Basketball flight checks: runs the real trajectory code out of static/games/midway.js.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../static/games/midway.js', 'utf8');
const body = src.slice(src.indexOf('  const HIT = {'), src.indexOf('  function loop(now)'));
const P = new Function('clamp', body + '\nreturn { basketballTrajectory, basketballRimContact, hoopRampY, hoopRadius };')(
  (v, a, b) => Math.min(b, Math.max(a, v)));
const TARGET = [[0, 0.66, 0.29, 0.30]];
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

function fly(x, y, hoop) {
  const shot = { id: 3, t: 1.1, x, y, startX: 0, aim: 0, hoop, k: 'hoops' };
  const rim = P.basketballRimContact(shot, TARGET);
  return { rim, frames: P.basketballTrajectory(shot, rim) };
}
check('a shot inside the clear opening never touches the rim', fly(0.15, 0.66, 0).rim === null);
check('a shot outside the clear opening clips the rim', fly(0.22, 0.66, null).rim !== null);
for (const x of [-0.4, -0.25, 0.22, 0.3, 0.4]) {
  const { frames } = fly(x, 0.66, null);
  const end = frames.at(-1);
  check(`clip at x=${x}: ball stays on the ramp and inside the walls`,
    frames.every((b) => b.y >= P.hoopRampY(b.z) - 1e-6 && Math.abs(b.x) <= 0.92 - P.hoopRadius + 1e-6));
  check(`clip at x=${x}: rebound ends within 0.8m of the rim`, Math.abs(end.x - x) < 0.8 + 1e-9);
}
process.exit(failed ? 1 : 0);
