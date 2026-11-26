// Decal light logic (static/games/pinballart.js): triggers, delay, hold, game states, reduced motion. Run: node tests/pinball_lights.js
const assert = require('node:assert/strict');
global.window = {};
global.document = { createElement: () => ({ getContext: () => ({}) }) };
require('../static/games/pinballart.js');
const { lights } = window.PinballArt;
const lamp = (fx) => lights({ paint: { decals: [['dot', 5, 5, .2, '#ff0000', fx]] } });
const dim = (l) => l.alpha < .3;

{ // a hit lights it, holds for 'ho', then it goes dim
  const l = lamp({ m: 'flash', c2: '#00ff00', r: 1, ho: 1, tr: [{ on: 'hit', tag: 'bumper*' }] });
  assert.ok(dim(l.update(1000)[0]));
  assert.ok(!dim(l.update(1010, { flash: 'bumper2' })[0]));
  assert.ok(!dim(l.update(1500)[0]));
  assert.ok(dim(l.update(2200)[0]));
  assert.ok(dim(l.update(2300, { flash: 'sling1' })[0]));
}
{ // delay: starts after dl seconds, even while the trigger keeps being seen
  const l = lamp({ m: 'steady', c2: '#fff', r: 1, dl: .5, ho: 5, tr: [{ on: 'event', gv: 'jackpot' }] });
  const states = new Set(['jackpot']);
  assert.ok(dim(l.update(1000, { states })[0]));
  assert.ok(dim(l.update(1200, { states })[0]));
  assert.ok(dim(l.update(1400, { states })[0]));
  assert.ok(!dim(l.update(1600, { states })[0]));
}
{ // any of several triggers; motion uses the ball distance plus the decal radius
  const l = lamp({ m: 'steady', c2: '#fff', r: 1, tr: [{ on: 'motion', nr: 1 }, { on: 'event', gv: 'tilt' }] });
  assert.ok(dim(l.update(1000, { balls: [[9, 9]] })[0]));
  assert.ok(!dim(l.update(1010, { balls: [[5.5, 5]] })[0]));
  const m = lamp({ m: 'steady', c2: '#fff', r: 1, tr: [{ on: 'motion', nr: 1 }, { on: 'event', gv: 'tilt' }] });
  assert.ok(!dim(m.update(1000, { states: new Set(['tilt']) })[0]));
}
{ // flashing never changes colour more than three times a second, and reduced motion holds a steady colour
  const l = lamp({ m: 'flash', c2: '#00ff00', c3: '#0000ff', c4: '#ffff00', r: .2, tr: [{ on: 'always' }] });
  const start = performance.now();
  const colours = []; for (let ms = 0; ms < 4000; ms += 10) colours.push(l.update(start + ms)[0].color);
  const changes = colours.filter((c, i) => i && c !== colours[i - 1]).length;
  assert.ok(changes <= 13, `${changes} changes in 4 s`);
  const calm = new Set(); for (let ms = 0; ms < 2000; ms += 50) calm.add(l.update(start + ms, { calm: true })[0].color);
  assert.equal(calm.size, 1);
}
{ // a timer, and an effect written with its trigger beside the colours (the editor's single-trigger form)
  const l = lamp({ m: 'steady', c2: '#fff', r: 1, tr: [{ on: 'timer', ev: 10, du: 2 }] });
  const t0 = performance.now();
  assert.ok(!dim(l.update(t0 + 500)[0]));
  assert.ok(dim(l.update(t0 + 5000)[0]));
  const old = lamp({ m: 'steady', c2: '#fff', r: 1, on: 'timer', ev: 10, du: 2 });
  assert.ok(dim(old.update(performance.now() + 5000)[0]));
}
console.log('pinball lights ok');
