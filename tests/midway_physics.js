// Basketball replay checks: runs the real trajectory code out of static/games/midway.js on the server's own flights.
const fs = require('fs');
const { execFileSync } = require('child_process');
const src = fs.readFileSync(__dirname + '/../static/games/midway.js', 'utf8');
const body = src.slice(src.indexOf('  const HIT = {'), src.indexOf('  function loop(now)'));
const P = new Function('clamp', body + '\nreturn { basketballSample, basketballPath, basketballNet, netCordPoint, hoopRampY, hoopRadius, hoopRackZ, beginBasketballReturn, rackBall, takeRackBall, stepBasketballReturn, advanceBasketballReturn, cabinetDepthScale, cabinetHeightScale };')(
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

const gap = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * P.cabinetHeightScale,
  (a.z - b.z) * P.cabinetDepthScale);
let invalid = 0, slowest = 0;
sims.forEach((sim, i) => {
  const shot = { path: sim.path, hoop: sim.good ? 0 : null };
  const last = sim.path.at(-1);
  const flightEnd = P.basketballSample(sim.path, last[0]);
  const ball = P.beginBasketballReturn({}, shot, last);
  if (gap(ball, flightEnd) > 1e-8) invalid++;
  let step = 0;
  for (; step < 540 && !ball.ready; step++) {
    P.stepBasketballReturn([ball]);
    if (!Number.isFinite(ball.x + ball.y + ball.z) || Math.abs(ball.x) > 0.92 - P.hoopRadius + 1e-6 ||
        ball.z > P.hoopRackZ + 1e-6 || ball.y < P.hoopRampY(ball.z) - 1e-6) invalid++;
  }
  slowest = Math.max(slowest, step / 120);
});
check(`${sims.length} server flights hand off continuously to a bounded return`, invalid === 0);
check(`all balls settle within 4.5s of handoff (slowest ${slowest.toFixed(2)}s)`, slowest < 4.5);

const legacy = P.basketballPath({ t: 1.1, x: 0.1, y: 0.7, startX: 0, aim: 0, hoop: null });
check('a shot without a path still gets a plain arc', legacy.length === 2 && legacy[0][7] === 'launch');

const returning = (x, z, vx, vz) => P.beginBasketballReturn({}, {}, [0, x, P.hoopRampY(z), z, vx, 0, vz]);
const parked = P.rackBall(0);
const fast = returning(-0.65, P.hoopRackZ, 100, 0);
P.stepBasketballReturn([fast, parked]);
check('swept sphere contact transfers momentum without tunneling', fast.x < parked.x && parked.velocity[0] > 0 &&
  gap(fast, parked) >= 2 * P.hoopRadius - 1e-5);
const glancing = returning(-0.5, -1.3, 38, 0);
const struck = returning(0, -1.18, 0, 0);
glancing.y = struck.y = 1.5;
P.stepBasketballReturn([glancing, struck]);
check('a glancing hit deflects both balls along their contact normal',
  struck.velocity[0] > 0 && struck.velocity[2] > 0 && glancing.velocity[2] < 0 &&
  gap(glancing, struck) >= 2 * P.hoopRadius - 1e-5);
const front = P.rackBall(0);
const behind = returning(0.29, P.hoopRackZ - 0.065, 0, 0);
for (let i = 0; i < 240; i++) P.stepBasketballReturn([front, behind]);
const blockedZ = behind.z, rested = behind.ready;
const freed = P.takeRackBall([front, behind], front);
for (let i = 0; i < 120; i++) P.stepBasketballReturn(freed);
check('removing the blocker lets a parked ball roll to the backstop',
  rested && blockedZ < P.hoopRackZ - 0.005 && behind.ready && Math.abs(behind.z - P.hoopRackZ) < 1e-6);

const leader = P.rackBall(0);
const follower = returning(0.29, P.hoopRackZ - 0.067, 0, 0);
const tail = returning(0.58, P.hoopRackZ - 0.133, 0, 0);
for (let i = 0; i < 240; i++) P.stepBasketballReturn([leader, follower, tail]);
const runner = returning(-0.65, -2.1, 0, 0.4);
const soloRunner = returning(-0.65, -2.1, 0, 0.4);
for (let i = 0; i < 30; i++) {
  P.stepBasketballReturn([leader, follower, tail, runner]);
  P.stepBasketballReturn([soloRunner]);
}
check('a resting pile does not slow an unrelated returning ball', gap(runner, soloRunner) < 1e-7);
const followerZ = follower.z, tailZ = tail.z;
const freedChain = P.takeRackBall([leader, follower, tail], leader);
// 2 s: the tail comes to rest leaning on the follower, and counts as ready after a second of that
for (let i = 0; i < 240; i++) P.stepBasketballReturn(freedChain);
check('removing the first ball releases a chain without merging the followers',
  follower.z > followerZ + 0.02 && tail.z > tailZ + 0.02 &&
  follower.ready && tail.ready && gap(follower, tail) >= 2 * P.hoopRadius - 1e-5);

function runReturn(hz, duration = 3) {
  const balls = [P.rackBall(0), returning(-0.19, -1.25, 0.4, 2.1), returning(0.35, -1.3, -0.52, 1.7)];
  let debt = 0, minGap = Infinity;
  for (let i = 0; i < hz * duration; i++) {
    ({ debt } = P.advanceBasketballReturn(balls, debt, 1 / hz));
    for (let j = 0; j < balls.length; j++) for (let k = j + 1; k < balls.length; k++) {
      minGap = Math.min(minGap, gap(balls[j], balls[k]));
    }
  }
  return { balls, minGap };
}
const at4 = runReturn(4), at120 = runReturn(120);
check('simultaneous returns settle without persistent overlap', at120.balls.every((ball) => ball.ready) &&
  at120.minGap >= 2 * P.hoopRadius - 0.001);
const early4 = runReturn(4, 0.5), early120 = runReturn(120, 0.5);
check('moving and settled balls agree at 4 and 120 render frames per second',
  early4.balls.every((ball, i) => gap(ball, early120.balls[i]) < 1e-8) &&
  at4.balls.every((ball, i) => gap(ball, at120.balls[i]) < 1e-8));
// a full rack shot over and over: balls that end up leaning on others must still come to rest and be shootable
let stuck = 0;
for (const seed of [3, 11, 29, 101]) {
  let r = seed;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let rack = [-2, -1, 0, 1, 2].map((i) => P.rackBall(i * 0.34));
  const flying = [];
  for (let step = 0; step < 52 * 120; step++) {
    if (step < 40 * 120 && step % 108 === 0) {
      const free = rack.filter((ball) => ball.ready);
      if (free.length) {
        const ball = free[Math.floor(rnd() * free.length)];
        rack = P.takeRackBall(rack, ball);
        flying.push([step + 108, ball]);
      }
    }
    while (flying.length && flying[0][0] <= step) {
      const made = rnd() < 0.5;
      rack.push(P.beginBasketballReturn(flying.shift()[1], { hoop: made ? 0 : null },
        [1, (rnd() - 0.5) * 1.2, made ? 1.5 : 1.2 + rnd(), -2.4, rnd() - 0.5, -1 - rnd(), made ? -0.3 : 1 + rnd(), 'end']));
    }
    P.stepBasketballReturn(rack);
  }
  stuck += rack.filter((ball) => !ball.ready || !ball.sleeping).length + (P.stepBasketballReturn(rack) ? 1 : 0);
}
check('after a long round every ball is back in the rack and still', stuck === 0);
const afterResume = returning(0, -1.6, 0, 0), afterShortFrame = returning(0, -1.6, 0, 0);
P.advanceBasketballReturn([afterResume], 0, 30);
P.advanceBasketballReturn([afterShortFrame], 0, 0.125);
check('a long suspension only advances a bounded number of return steps', gap(afterResume, afterShortFrame) < 1e-8);
const net = P.basketballNet(0.19, null);
const swayingNet = P.basketballNet(0.19, { age: 0.22, offset: 0.1 }, 0.02);
check('the net flows below fixed rim attachments',
  net.slice(0, 12).every((point, i) => gap(point, swayingNet[i]) < 1e-10) &&
  gap(net.at(-1), swayingNet.at(-1)) > 0.025);
check('a net cord curves while keeping its endpoints attached',
  gap(P.netCordPoint(net[0], net[12], 0), net[0]) < 1e-10 &&
  gap(P.netCordPoint(net[0], net[12], 1), net[12]) < 1e-10 &&
  P.netCordPoint(net[0], net[12], 0.5).y < (net[0].y + net[12].y) / 2);
process.exit(failed ? 1 : 0);
