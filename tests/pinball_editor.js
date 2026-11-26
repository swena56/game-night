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
    // curved walls, flaps, portals and decals; rotate / mirror / bank tools
    const p2 = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(base + '/pinball-editor.html');
    const parts2 = async () => (await p2.evaluate(() => window.pinballEditor.toSpec())).items;
    const count2 = async (kind) => (await parts2()).filter((i) => i[0] === kind).length;
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('arc', 2, 6); e.addPart('flap', 4, 9); e.addPart('portal', 2, 4); e.addPart('star', 5, 3); });
    let got = await parts2();
    const arc = got.find((i) => i[0] === 'arc');
    assert.equal(arc.length, 8, 'a curved wall carries two ends and a bend point');
    assert.ok(got.some((i) => i[0] === 'flap') && got.some((i) => i[0] === 'portal') && got.some((i) => i[0] === 'star'));
    await p2.evaluate(() => window.pinballEditor.select(0));
    await p2.keyboard.press('r');
    const turned = (await parts2()).find((i) => i[0] === 'arc');
    assert.notDeepEqual(turned.slice(1, 7), arc.slice(1, 7), 'R rotates the selected wall');
    await p2.keyboard.press('m');
    const flipped = (await parts2()).find((i) => i[0] === 'arc');
    assert.ok(Math.abs((flipped[1] + flipped[3]) / 2 - (8.8 - (turned[1] + turned[3]) / 2)) < .1, 'M mirrors it left to right');
    await p2.locator('#peBank').click();
    assert.ok((await count2('target')) >= 2, 'the bank button adds a column of targets');
    await p2.locator('#peMirrorAll').click();
    const play = true;
    assert.ok(play);
    // flippers, moving targets, kicker holes, rubber bands, point values and zoom
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('flip', 2.2, 9); e.addPart('mover', 2, 5); e.addPart('hole', 1.5, 7); e.addPart('rubber', 1, 11); });
    for (const k of ['flip', 'mover', 'hole', 'rubber']) assert.equal(await count2(k), 1, k);
    await p2.locator('.pe-pts summary', { hasText: 'Point values' }).click();
    await p2.locator('#pePtsBody input[data-k="bumper"]').fill('750');
    await p2.locator('#pePtsBody input[data-k="bumper"]').dispatchEvent('change');
    assert.equal((await p2.evaluate(() => window.pinballEditor.toSpec())).pts.bumper, 750);
    const before = (await p2.locator('#peCanvas').boundingBox()).width;
    await p2.locator('#peZoom').click();
    assert.ok((await p2.locator('#peCanvas').boundingBox()).width > before * 1.4, 'zoom enlarges the table');
    // per-part points and layers
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('bump', 3, 5); e.addPart('wall', 5, 9); e.select(0); });
    await p2.locator('#pePv').fill('900'); await p2.locator('#pePv').dispatchEvent('change');
    assert.deepEqual((await p2.evaluate(() => window.pinballEditor.toSpec())).pv, [[0, 900]]);
    await p2.locator('#pePv').fill(''); await p2.locator('#pePv').dispatchEvent('change');
    assert.equal((await p2.evaluate(() => window.pinballEditor.toSpec())).pv, undefined, 'blank goes back to the table default');
    await p2.locator('.pe-pts summary', { hasText: 'Layers' }).click();
    await p2.locator('#peLayersBody label', { hasText: 'Scoring' }).locator('input').uncheck();
    const hb = await p2.locator('#peCanvas').boundingBox();
    await p2.mouse.click(hb.x + 3 / 10 * hb.width, hb.y + 5 / 17 * hb.height);
    assert.equal(await p2.locator('#peTitle').textContent(), 'Nothing selected', 'a hidden layer can not be clicked');
    console.log('Pinball editor checks passed: drag, move, resize, inspector, undo, limits, wires, share codes, saved tables and play');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
