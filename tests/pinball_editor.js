// Start a Game Night server, then run BASE=http://localhost:8794 node tests/pinball_editor.js.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.BASE || 'http://localhost:8794';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--headless=new', '--no-sandbox', `--use-angle=${process.env.CHROMIUM_ANGLE || 'swiftshader'}`, '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('unmask.name', JSON.stringify('Table Builder'));
      localStorage.setItem('unmask.prefs', JSON.stringify({ gfx: 'low' }));
      const getContext = HTMLCanvasElement.prototype.getContext;     // the game falls back to its Canvas renderer
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return location.pathname === '/' && type.includes('webgl') ? null : getContext.call(this, type, ...args);
      };
    });
    await page.goto(base + '/pinball-editor.html');
    const spec = () => page.evaluate(() => window.pinballEditor.toSpec());
    const parts = async () => (await spec()).items;
    const count = async (kind) => (await parts()).filter((i) => i[0] === kind).length;

    // the editor opens with the demo table and the canvas fills in
    assert.equal(await count('bump'), 3);
    assert.match(await page.locator('#peCount').textContent(), /parts/);
    const box = await page.locator('#peCanvas').boundingBox();
    assert.ok(box.width > 200 && Math.abs(box.height / box.width - 1.7) < .02, 'canvas keeps the cabinet proportions');
    const at = (x, y) => ({ x: box.x + x / 10 * box.width, y: box.y + y / 17 * box.height });

    // drag a bumper from the palette to an empty spot: it lands there, snapped to the grid, and is selected
    const bumper = page.locator('.pe-part[data-kind="bump"]');
    const from = await bumper.boundingBox();
    const drop = at(5, 9);
    await page.mouse.move(from.x + 20, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 6 });
    await page.mouse.up();
    assert.equal(await count('bump'), 4);
    let added = (await parts()).filter((i) => i[0] === 'bump').at(-1);
    assert.deepEqual([added[1], added[2]], [5, 9]);
    assert.equal(await page.locator('#peTitle').textContent(), '🔴 Pop bumper');

    // drag it with the mouse to a new place
    const to = at(6, 11);
    await page.mouse.move(drop.x, drop.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    added = (await parts()).filter((i) => i[0] === 'bump').at(-1);
    assert.deepEqual([added[1], added[2]], [6, 11]);

    // drag the round handle to make it bigger
    const handle = at(6 + added[3], 11);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(at(6.9, 11).x, handle.y, { steps: 4 });
    await page.mouse.up();
    added = (await parts()).filter((i) => i[0] === 'bump').at(-1);
    assert.ok(added[3] > .8 && added[3] <= 1, `radius grew to ${added[3]}`);

    // the inspector edits position, size and colour
    await page.locator('#peX').fill('4.25');
    await page.locator('#peX').dispatchEvent('change');
    await page.locator('#peSize').fill('0.4');
    await page.locator('#peSize').dispatchEvent('change');
    await page.locator('#peColor').evaluate((input) => { input.value = '#12ab34'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); });
    added = (await parts()).filter((i) => i[0] === 'bump').at(-1);
    assert.deepEqual(added, ['bump', 4.25, 11, .4, '#12ab34']);

    // undo and redo
    const lastBump = async () => (await parts()).filter((i) => i[0] === 'bump').at(-1);
    await page.locator('#peUndo').click();
    assert.equal((await lastBump())[4], '#ff9b59', 'undo reverts the colour change');
    await page.locator('#peRedo').click();
    assert.deepEqual(await lastBump(), added);

    // single parts: one spinner only, so its palette button is disabled
    assert.equal(await page.locator('.pe-part[data-kind="spinner"]').isDisabled(), true);
    // a segment part: tap to add a wall, then turn it with the angle box
    await page.locator('.pe-part[data-kind="wall"]').click();
    await page.locator('#peAngle').fill('90');
    await page.locator('#peAngle').dispatchEvent('change');
    const wall = (await parts()).find((i) => i[0] === 'wall');
    assert.ok(Math.abs(wall[1] - wall[3]) < .05 && Math.abs(wall[4] - wall[2]) > 1.5, 'wall turned vertical');
    // delete it with the keyboard
    await page.evaluate(() => document.activeElement.blur());   // Delete is ignored while typing in a box
    await page.keyboard.press('Delete');
    assert.equal(await count('wall'), 0);

    // refusing too many: the 12th bumper is the last
    for (let i = 0; i < 12; i++) await page.locator('.pe-part[data-kind="bump"]').click({ force: true });
    assert.equal(await count('bump'), 12);

    // wires: ramp, subway and orbit are placed as ends or a path, and the ramp stays below its arc line
    await page.locator('#peClear').evaluate((b) => { window.confirm = () => true; b.click(); });
    for (const kind of ['ramp', 'subway', 'orbit']) await page.locator(`.pe-part[data-kind="${kind}"]`).click();
    const ramp = (await parts()).find((i) => i[0] === 'ramp');
    assert.ok(ramp[2] >= 4.8 && ramp[4] >= 4.8, 'ramp ends stay below y = 4.8');
    assert.equal(await page.locator('.pe-part[data-kind="ramp"]').isDisabled(), true, 'one ramp only');
    assert.equal((await parts()).find((i) => i[0] === 'orbit').length, 2 + 6, 'new orbit has three points');
    await page.locator('#peAddPt').click();
    await page.locator('#peAddPt').click();
    assert.equal((await parts()).find((i) => i[0] === 'orbit').length, 2 + 10);
    await page.locator('#peAddPt').click();
    assert.equal(await page.locator('#peAddPt').isDisabled(), true, 'at most six points');
    await page.locator('#peDelPt').click();
    assert.equal((await parts()).find((i) => i[0] === 'orbit').length, 2 + 10, 'a point was removed');

    // share code round trip (compressed), and a pasted table loads back the same
    const wires = await spec();
    const code = await page.evaluate(() => window.pinballEditor.shareCode(window.pinballEditor.toSpec()));
    assert.match(code, /^PT1\.[\w-]+$/);
    await page.locator('#peClear').evaluate((b) => { window.confirm = () => true; b.click(); });
    assert.equal((await parts()).length, 0);
    await page.locator('#peShare').click();
    await page.locator('#peShareText').fill(code);
    await page.locator('#peLoad').click();
    await page.waitForFunction(() => window.pinballEditor.toSpec().items.length === 3);   // decompressing is asynchronous
    assert.deepEqual(await spec(), wires);
    await page.locator('#peShare').click();
    await page.locator('#peShareText').fill('PT1.not-a-table!!');
    await page.locator('#peLoad').click();
    await page.waitForFunction(() => /isn't a table/.test(document.querySelector('#peMsg').textContent));
    await page.keyboard.press('Escape');

    // save it as a named table, wipe the editor, then open it from the gallery
    await page.locator('#peName').fill('Wire test');
    await page.locator('#peName').dispatchEvent('change');
    await page.locator('#peTables').click();
    await page.locator('#peSaveAs').click();
    assert.match(await page.locator('#peSaved').textContent(), /Wire test/);
    await page.locator('#peTablesDlg button[value="close"]').click();
    await page.locator('#peClear').evaluate((b) => { window.confirm = () => true; b.click(); });
    await page.locator('#peTables').click();
    await page.locator('#peSaved .pe-item', { hasText: 'Wire test' }).locator('text=Open').click();
    assert.deepEqual((await spec()).items, wires.items);

    // the Golden Hour copy template has every kind of part; recolour a bumper and play it
    await page.locator('#peTables').click();
    await page.locator('#peTemplates .pe-item', { hasText: 'Golden Hour copy' }).locator('text=Use').click();
    assert.equal(await count('bump'), 3);
    assert.equal(await count('ramp') + await count('subway') + await count('orbit') + await count('saucer') + await count('magnet'), 5);
    await page.evaluate(() => window.pinballEditor.select(0));
    await page.locator('#peColor').evaluate((input) => { input.value = '#12ab34'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); });
    await page.locator('#peName').fill('Green Machine');
    await page.locator('#peName').dispatchEvent('change');
    await page.locator('#pePlay').click();
    await page.waitForURL(base + '/');
    await page.locator('.pb-flat').waitFor();
    await page.waitForFunction(() => S?.pinball?.layout);
    const game = await page.evaluate(() => { const l = S.pinball.layout; return { table: S.pinball.table, bumps: l.bumps.length, paint: l.paint.bumps[0],
      name: l.paint.name, targets: l.targets.length, ramp: !!l.ramp, exit: !!l.exit, subway: !!l.subway, orbit: l.orbit_path.length, spinner: !!l.spinner, magnet: !!l.magnet, saucer: !!l.saucer }; });
    assert.deepEqual(game, { table: 'custom', bumps: 3, paint: '#12ab34', name: 'Green Machine', targets: 3, ramp: true, exit: true, subway: true, orbit: 5, spinner: true, magnet: true, saucer: true });
    await page.waitForTimeout(1500);
    assert.deepEqual(errors, []);
    console.log('Pinball editor checks passed: drag, move, resize, inspector, undo, limits, wires, share codes, saved tables and play');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
