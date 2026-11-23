// Basketball replay checks: runs the real trajectory code out of static/games/midway.js on the server's own flights.
const fs = require('fs');
const { execFileSync } = require('child_process');
const src = fs.readFileSync(__dirname + '/../static/games/midway.js', 'utf8');
const body = src.slice(src.indexOf('  const HIT = {'), src.indexOf('  function loop(now)'));
const P = new Function('clamp', body + '\nreturn { basketballTrajectory, basketballPath, hoopRampY, hoopRadius, hoopDepth };')(
  (v, a, b) => Math.min(b, Math.max(a, v)));
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

// the server's simulation for a spread of shots: [start_x, x, y]
const cases = [];
for (const sx of [-0.68, 0, 0.68]) for (const x of [-0.75, -0.3, -0.12, 0, 0.12, 0.3, 0.75]) for (const y of [0.0, 0.3, 0.45, 0.66, 0.9, 1.1]) cases.push([sx, x, y]);
const sims = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, '.')
import games.midway as M
print(json.dumps([M.hoop_sim(sx, x, y, 0.0, 0) for sx, x, y in ${JSON.stringify(cases)}]))
`], { cwd: __dirname + '/..' }).toString());

const WALL = 0.92 - P.hoopRadius;
let walls = 0, ramp = 0, ends = 0, nan = 0, made = 0;
sims.forEach((sim, i) => {
  const shot = { id: i + 1, t: 1.1, x: cases[i][1], y: cases[i][2], startX: cases[i][0], hoop: sim.good ? 0 : null, path: sim.path, landAt: sim.landAt };
  const frames = P.basketballTrajectory(shot);
  made += sim.good;
  if (!frames.every((b) => Math.abs(b.x) <= WALL + 0.02)) walls++;
  if (!frames.every((b) => b.y >= P.hoopRampY(b.z) - 1e-6 || b.z > -2.0 && b.y < 0)) ramp++;
  if (frames.length > 720) ends++;
  if (frames.some((b) => [b.x, b.y, b.z].some(Number.isNaN))) nan++;
});
check(`${sims.length} flights replay without NaNs`, nan === 0);
check('no replay leaves the side walls', walls === 0);
check('every replay ends before the frame cap (the ball gets back to the rack)', ends === 0);
check('a spread of shots makes some and misses some', made > 5 && made < sims.length - 5);

// the replay follows the server's keyframes exactly
const swish = sims[cases.findIndex(([sx, x, y]) => sx === 0 && x === 0 && y === 0.66)];
check('a centered swish is made', swish.good && swish.path.length === 2);
const shot = { id: 1, t: 1.1, x: 0, y: 0.66, startX: 0, hoop: 0, path: swish.path, landAt: swish.landAt };
const frames = P.basketballTrajectory(shot);
const at = Math.round(swish.landAt * 120);
const lens = sims.map((sim, i) => P.basketballTrajectory({ id: i + 1, t: 1.1, x: cases[i][1], y: cases[i][2], startX: cases[i][0], hoop: sim.good ? 0 : null, path: sim.path, landAt: sim.landAt }).length / 120);
check(`balls are home within ${Math.max(...lens).toFixed(1)}s (slowest of ${lens.length})`, Math.max(...lens) < 4.5);
const k = swish.path.at(-1);
check('the replay passes through the net keyframe', Math.hypot(frames[at].x - k[1], frames[at].y - k[2], frames[at].z - k[3]) < 0.02);
const legacy = P.basketballPath({ t: 1.1, x: 0.1, y: 0.7, startX: 0, aim: 0, hoop: null });
check('a shot without a path still gets a plain arc', legacy.length === 2 && legacy[0][7] === 'launch');
process.exit(failed ? 1 : 0);
