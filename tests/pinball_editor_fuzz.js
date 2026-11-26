// Randomised stress test of the pinball editor UI (slow on a small host; not part of the quick suite).
//   node tests/pinball_editor_fuzz.js <seed> <steps> [phone]     with a Game Night server on :8794
// After every random action it checks: no page errors, every number finite, colours valid, per-kind limits kept. The final
// tables are written to $FUZZ_OUT/fuzz-<seed>.json so they can be run through games.pinball_custom.build.
const { chromium } = require('playwright-core');
const fs = require('fs');
const out = (process.env.FUZZ_OUT || require('os').tmpdir()) + '/';
const seed = +process.argv[2] || 1, steps = +process.argv[3] || 250, phone = process.argv[4] === 'phone';
let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
const pick = (a) => a[Math.floor(rnd() * a.length)];
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--headless=new', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: phone ? { width: 390, height: 800 } : { width: 1200, height: 800 }, hasTouch: phone, isMobile: phone });
  const p = await ctx.newPage();
  const errors = [], specs = [], log = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:8794/pinball-editor.html'); await p.waitForTimeout(300);
  const box = async () => p.locator('#peCanvas').boundingBox();
  const at = async (x, y) => { const r = await box(); return { x: r.x + x / 10 * r.width, y: r.y + y / 17 * r.height }; };
  const rx = () => .5 + rnd() * 7.8, ry = () => .5 + rnd() * 13.5;
  const click = async (sel, force) => { const l = p.locator(sel).first(); if (await l.count() && await l.isEnabled().catch(() => false) && await l.isVisible().catch(() => false)) await l.click({ timeout: 2000, force: !!force }).catch(() => {}); };
  const ops = {
    tile: async () => { const t = p.locator('.pe-part:not([disabled])'); const n = await t.count(); if (n) await t.nth(Math.floor(rnd() * n)).click({ timeout: 2000 }).catch(() => {}); },
    tapBoard: async () => { const a = await at(rx(), ry()); await p.mouse.click(a.x, a.y); },
    dragBoard: async () => { const a = await at(rx(), ry()), c = await at(rx(), ry()); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 4 }); await p.mouse.up(); },
    shiftTap: async () => { const a = await at(rx(), ry()); await p.keyboard.down('Shift'); await p.mouse.click(a.x, a.y); await p.keyboard.up('Shift'); },
    key: async () => p.keyboard.press(pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift+ArrowLeft', 'r', 'R', 'm', 'd', 'Delete', 'Backspace', '[', ']', 'Control+z', 'Control+Shift+z', 'Control+a', 'Escape'])),
    rot: () => click(pick(['#peRotL', '#peRotR'])), mirror: () => click('#peMirror'), dup: () => click('#peDup'), del: () => click('#peDel'),
    bank: () => click('#peBank'), mirrorAll: () => click('#peMirrorAll'), zoom: () => click('#peZoom'), snap: () => click('#peSnap'),
    undo: () => click('#peUndo'), redo: () => click('#peRedo'), prev: () => click('#pePrev'), next: () => click('#peNext'),
    tab: async () => { const t = p.locator('.pe-tab'); await t.nth(Math.floor(rnd() * await t.count())).click().catch(() => {}); },
    search: async () => { await p.locator('#peSearch').fill(pick(['', 'bump', 'wall', 'zzz', 'flip'])); },
    list: async () => { const t = p.locator('.pe-pitem'); const n = await t.count(); if (n) await t.nth(Math.floor(rnd() * n)).click({ modifiers: rnd() < .3 ? ['Shift'] : [] }).catch(() => {}); },
    layer: async () => { await p.evaluate(() => document.querySelectorAll('details.pe-pts').forEach((d) => (d.open = true))); const c = p.locator('#peLayersBody input'); await c.nth(Math.floor(rnd() * await c.count())).click().catch(() => {}); },
    pv: async () => { await p.locator('#pePv').fill(pick(['', '900', '-5', '999999', 'abc'])).catch(() => {}); await p.locator('#pePv').dispatchEvent('change').catch(() => {}); },
    mode: async () => { await p.locator('#peModes input').nth(Math.floor(rnd() * 4)).click({ timeout: 1000 }).catch(() => {}); },
    pts: async () => { await p.evaluate(() => document.querySelectorAll('details.pe-pts').forEach((d) => (d.open = true))); const i = p.locator('#pePtsBody input').nth(Math.floor(rnd() * 9)); await i.fill(pick(['0', '123', '30000', '', '-1'])).catch(() => {}); await i.dispatchEvent('change').catch(() => {}); },
    field: async () => { const id = pick(['#peX', '#peY', '#peSize', '#peAngle']); const f = p.locator(id); if (await f.isVisible().catch(() => false)) { await f.fill(pick(['0', '4.4', '99', '-3', '', '1e9', '12.345', '45'])).catch(() => {}); await f.dispatchEvent('change').catch(() => {}); } },
    lock: () => click(pick(['#peLock', '#peKick']), true),
    addPt: () => click(pick(['#peAddPt', '#peDelPt'])),
    swatch: async () => { const c = p.locator('#peSwatches button'); const n = await c.count(); if (n) await c.nth(Math.floor(rnd() * n)).click({ timeout: 1000 }).catch(() => {}); },
    template: async () => { await click('#peTables'); const r = p.locator('#peTemplates .pe-item button'); const n = await r.count(); if (n) await r.nth(Math.floor(rnd() * n)).click().catch(() => {}); await p.evaluate(() => document.getElementById('peTablesDlg').open && document.getElementById('peTablesDlg').close()); },
    clear: () => rnd() < .15 && click('#peClear'),
  };
  const names = Object.keys(ops);
  const MAXN = { bump: 12, sling: 6, target: 8, lane: 6, post: 16, wall: 16, spinner: 1, saucer: 1, magnet: 1, ramp: 1, subway: 1, orbit: 1, arc: 6, flap: 4, portal: 1, rubber: 6, mover: 3, hole: 3, flip: 4, star: 4, heart: 4, bolt: 4, diamond: 4, moon: 4, ring: 4, kick: 1 };
  for (let i = 0; i < steps; i++) {
    const op = pick(names); log.push(op);
    try { await ops[op](); } catch (e) { errors.push(`op ${op}: ${e.message.split('\n')[0]}`); }
    const spec = await p.evaluate(() => window.pinballEditor.toSpec());
    specs.push(spec);
    const bad = [];
    const counts = {};
    for (const it of spec.items) {
      counts[it[0]] = (counts[it[0]] || 0) + 1;
      for (const v of it.slice(1, -1)) if (typeof v !== 'number' || !isFinite(v)) bad.push(`non-number in ${it[0]}`);
      if (!/^#[0-9a-f]{6}$/i.test(it.at(-1))) bad.push('colour ' + it.at(-1));
    }
    for (const [k, n] of Object.entries(counts)) if (n > (MAXN[k] ?? 0)) bad.push(`limit ${k} ${n}`);
    if (spec.items.length > 120) bad.push('too many');
    const sel = await p.evaluate(() => { const e = window.pinballEditor; return { n: e.state.items.length }; });
    if (bad.length) errors.push(`step ${i} after ${op}: ${[...new Set(bad)].join(', ')}`);
    if (errors.length > 3) break;
  }
  fs.writeFileSync(out + `fuzz-${seed}.json`, JSON.stringify(specs));
  console.log(`seed ${seed}${phone ? ' phone' : ''}: ${specs.length} steps, errors:`, errors.slice(0, 6));
  await b.close();
})();
