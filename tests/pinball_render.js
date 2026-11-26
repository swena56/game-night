// Draws the flat (Canvas) pinball renderer for real game rows: a bumper hit, a sling kick and a saucer eject must animate without errors.
// Run: node tests/pinball_render.js (needs the jsdom test dependency and python3).
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const root = join(__dirname, '..');
const fixture = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(root)})
from games.pinball_clone import clone_specs
from games.pinball_custom import build
from games.pinball import CustomTable
from games.pinball_custom import build_rules
spec = clone_specs()['golden']
layout, _ = build(spec)
table = CustomTable(layout_override=layout, rules_override=build_rules(spec), balls=3)
rows = {}
def snap(name, event=None, hold=False):
    if event:
        table.event, table.event_id = event, table.event_id + 1
    row = table.public()
    row[-1] = dict(row[-1], hold=int(hold))
    rows[name] = row
snap('rest'); snap('bumper', 'bumper0'); snap('sling', 'sling1'); snap('saucer', 'saucer', True); snap('eject', None, False)
print(json.dumps({'layout': layout.public(), 'rows': rows}))
`], { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => l.startsWith('{')).pop());

// A stand-in for Three.js: every constructor, method and property is a no-op that returns another stand-in, and values that are assigned are kept.
// It cannot check what the 3D scene looks like, but it runs every line of the 3D renderer's setup and per-frame update.
const ghost = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k in t ? t[k] : (t[k] = ghost())),
  set: (t, k, v) => { t[k] = v; return true; },
  apply: () => ghost(),
  construct: () => ghost(),
});

async function session(three) {
  const dom = new JSDOM('<div id="arena"></div>', { runScripts: 'outside-only', url: 'http://pinball.test/', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { arc: 0, stroke: 0 };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k in calls) calls[k]++; return k.startsWith('create') ? { addColorStop() {} } : k === 'measureText' ? { width: 10 } : undefined; }), set: (t, k, v) => { t[k] = v; return true; } });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
  window.matchMedia = () => ({ matches: false });
  Object.defineProperties(window.HTMLElement.prototype, { clientWidth: { get: () => 400 }, clientHeight: { get: () => 680 } });
  let frameCb = null;
  window.requestAnimationFrame = (f) => { frameCb = f; return 1; };
  window.cancelAnimationFrame = () => {};
  const warnings = [];
  let built = 0;
  window.console.warn = (...a) => warnings.push(a.join(' '));
  window.GL3 = { load: () => (three ? Promise.resolve(ghost()) : new Promise(() => {})), level: () => 'low', revive() {}, renderer: () => { built++; return ghost(); }, stage: () => ghost() };
  window.Snd = { bed: () => ({ set() {} }), play() {}, tone() {} };
  window.UI = {};
  window.load = () => null; window.save = () => {};     // app.js's storage helpers
  let now = 1000;
  window.performance.now = () => now;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  window.eval(readFileSync(join(root, 'static/games/pinballart.js'), 'utf8'));
  window.eval(readFileSync(join(root, 'static/games/pinball.js'), 'utf8'));
  const ui = window.UI.pinball, arena = window.document.getElementById('arena');
  ui.mount(arena, window.document.createElement('div'));
  const view = (row, tick) => ({ phase: 'playing', paused: false, me: {}, pinball: { pin: 1, tick, tables: { p1: row }, layout: fixture.layout, table: 'golden', extra: [], solo: true, me: 'p1', epoch: 'e' } });
  const ctxArg = { readOnly: false, sfx() {}, input() {}, el: (t) => window.document.createElement(t), player: () => ({}) };
  let tick = 1;
  const drawn = {};
  for (const name of ['rest', 'bumper', 'sling', 'saucer', 'eject']) {
    const before = { ...calls };
    ui.render(view(fixture.rows[name], tick++), ctxArg);
    await new Promise((r) => setTimeout(r, 5));          // the 3D bundle "loads" and replaces the flat renderer
    for (let frame = 0; frame < 6; frame++) { now += 90; ui.fast({ pin: 1, tick: tick++, tables: { p1: fixture.rows[name] } }); if (frameCb) { const f = frameCb; frameCb = null; f(now); } }
    drawn[name] = { arc: calls.arc - before.arc, stroke: calls.stroke - before.stroke };
  }
  ui.unmount();
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], 'the renderer fell back: ' + warnings.join(' | '));
  if (three) assert.ok(built > 0, 'the 3D renderer was never built');
  return { calls, drawn };
}

(async () => {
  const { calls, drawn } = await session(false);
  assert.ok(calls.arc > 100, `the renderer drew ${calls.arc} arcs`);
  // a bumper hit adds shock rings and rays on top of the resting table; a kick adds sparks
  assert.ok(drawn.bumper.arc > drawn.rest.arc && drawn.bumper.stroke > drawn.rest.stroke, JSON.stringify(drawn));
  assert.ok(drawn.sling.stroke > drawn.rest.stroke, JSON.stringify(drawn));
  await session(true);
  console.log('pinball render ok');
})().catch((e) => { console.error(e); process.exit(1); });
