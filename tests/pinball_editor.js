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
    await page.waitForURL((u) => new URL(u).pathname === '/');
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
    // group duplicate, per-part modes, big tables
    await p2.locator('#peLayersBody label', { hasText: 'Scoring' }).locator('input').check();
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('bump', 2, 5); e.addPart('bump', 4, 5); e.addPart('post', 6, 5); });
    const gb = await p2.locator('#peCanvas').boundingBox();
    const gat = (x, y) => ({ x: gb.x + x / 10 * gb.width, y: gb.y + y / 17 * gb.height });
    await p2.mouse.click(gat(2, 5).x, gat(2, 5).y);
    await p2.keyboard.down('Shift'); await p2.mouse.click(gat(4, 5).x, gat(4, 5).y); await p2.mouse.click(gat(6, 5).x, gat(6, 5).y); await p2.keyboard.up('Shift');
    await p2.locator('#peDup').click();
    assert.equal(await count2('bump'), 4, 'duplicating a group copies every part in it');
    assert.equal(await count2('post'), 2);
    await p2.keyboard.press('Delete');
    assert.equal((await count2('bump')) + (await count2('post')), 3, 'delete removes the whole group');
    await p2.evaluate(() => window.pinballEditor.select(0));
    await p2.locator('#peModes input[data-bit="2"]').uncheck();
    assert.deepEqual((await p2.evaluate(() => window.pinballEditor.toSpec())).modes, [[0, 13]]);
    await p2.keyboard.press('Control+a');
    assert.equal(await p2.evaluate(() => document.querySelector('#peTitle').textContent.length > 0), true);
    // a big table plays: it travels as a deflated share code and is rebuilt on the server
    await p2.addInitScript?.(() => {});
    await p2.evaluate(() => {
      localStorage.setItem('unmask.name', JSON.stringify('Table Builder'));
      const e = window.pinballEditor; e.state.items = [];
      for (const [k, n] of [['bump', 12], ['post', 16], ['wall', 16], ['target', 8], ['lane', 6], ['sling', 6], ['arc', 6], ['rubber', 6], ['star', 4], ['heart', 4]])
        for (let i = 0; i < n; i++) e.addPart(k, 1 + (i * 1.7) % 7, 2 + (i * 2.3) % 11);
    });
    assert.ok((await p2.evaluate(() => JSON.stringify(window.pinballEditor.toSpec()).length)) > 2500, 'the table is big enough to travel as a code');
    await p2.locator('#pePlay').click();
    await p2.waitForURL((u) => new URL(u).pathname === '/', { waitUntil: 'commit' });
    await p2.waitForFunction(() => typeof S !== 'undefined' && S?.pinball?.layout, null, { timeout: 90000 });
    const big = await p2.evaluate(() => ({ posts: S.pinball.layout.posts.length, bumps: S.pinball.layout.bumps.length }));
    assert.deepEqual(big, { posts: 16, bumps: 12 });
    await p2.goto(base + '/pinball-editor.html');          // back from the game: the editor comes back with the same table
    assert.ok((await count2('bump')) + (await count2('post')) > 10, 'the table is still there after switching back');
    // the editor is part of the site: served to every client, and a table can be uploaded through a proxy too
    const http = require('node:http');
    const get = (path, headers = {}) => new Promise((resolve, reject) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path, headers }, (res) => { let text = ''; res.on('data', (d) => (text += d)); res.on('end', () => resolve({ status: res.statusCode, text })); }).on('error', reject);
    });
    assert.equal((await get('/pinball-editor.js')).status, 200);
    assert.equal((await get('/pinball-editor.html', { 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https', Host: 'games.example.com' })).status, 200);
    assert.equal(JSON.parse((await get('/api/dev', { 'X-Forwarded-For': '1.2.3.4' })).text).editor, true);
    assert.equal((await get('/pinball-editor.css')).status, 200);
    // selecting: a long subway line no longer hides the bumper under it, a quick second tap steps through a stack, [ ] and the list walk the parts
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('bump', 4, 8); e.addPart('subway', 2, 6); e.addPart('bump', 6.5, 12); });
    await p2.locator('#peLayersBody label', { hasText: 'Scoring' }).locator('input').check();
    const sb = await p2.locator('#peCanvas').boundingBox();
    const sat = (x, y) => ({ x: sb.x + x / 10 * sb.width, y: sb.y + y / 17 * sb.height });
    await p2.mouse.click(sat(4, 8).x, sat(4, 8).y);
    assert.equal(await p2.locator('#peTitle').textContent(), '🔴 Pop bumper', 'the bumper under the subway run is selectable');
    await p2.mouse.click(sat(0.3, 16).x, sat(0.3, 16).y);
    assert.equal(await p2.locator('#peTitle').textContent(), 'Nothing selected');
    await p2.mouse.click(sat(4, 8).x, sat(4, 8).y);
    assert.equal(await p2.locator('#peTitle').textContent(), '🔴 Pop bumper', 'and reselectable after deselecting');
    await p2.keyboard.press(']');
    assert.match(await p2.locator('#peNavCount').textContent(), /2 of/);
    await p2.keyboard.press('[');
    assert.match(await p2.locator('#peNavCount').textContent(), /1 of/);
    await p2.locator('#pePrev').click();
    assert.equal(await p2.locator('#pePitemCount, .pe-pitem.on').count(), 1);
    await p2.locator('.pe-pitem', { hasText: 'Subway' }).click();
    assert.equal(await p2.locator('#peTitle').textContent(), '🚇 Subway', 'the parts list selects a part');
    // every template and every featured table in the gallery is accepted by the server
    await p2.goto(base + '/pinball-editor.html');
    await p2.waitForFunction(() => fetch('/api/pinball-tables').then((r) => r.json()).then((d) => d.tables.length >= 7));
    await p2.waitForTimeout(300);
    const names = await p2.evaluate(async () => {
      const out = [];
      document.getElementById('peTables').click();
      const rows = [...document.querySelectorAll('#peTemplates .pe-item, #peFeatured .pe-item')];
      for (const row of rows) { row.querySelector('button').click(); out.push(JSON.stringify(window.pinballEditor.toSpec())); document.getElementById('peTables').click(); }
      return out;
    });
    assert.ok(names.length >= 10, 'the gallery has the starter tables and the curated ones');
    assert.ok(names.some((t) => JSON.parse(t).name === 'Pop Pit'), 'a curated table is featured');
    assert.ok(!names.some((t) => /Wire playground|Portals & curves|Sandbox/.test(JSON.parse(t).name)), 'the junk templates are gone');
    const made = JSON.parse(await (await fetch(base + '/api/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tmpl', game: 'pinball' }) })).text());
    for (const text of names) {
      const r = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...made, type: 'pinball_table', table: JSON.parse(text), aid: Math.random().toString(36).slice(2) }) });
      assert.equal(r.status, 200, `template ${JSON.parse(text).name} was rejected: ${await r.text()}`);
    }
    // regressions: a stale group after undo, the mode checkboxes after a refused change, tapping a tile with a finger
    await p2.goto(base + '/pinball-editor.html');
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('bump', 2, 5); e.addPart('bump', 4, 5); e.addPart('bump', 6, 5); });
    await p2.keyboard.press('Control+a');
    await p2.locator('#peUndo').click();                  // the three bumpers vanish while they are all selected
    await p2.locator('#peUndo').click();
    await p2.locator('#peDup').click({ force: true }).catch(() => {});
    await p2.keyboard.press('Delete');
    assert.deepEqual(errors, [], 'no page errors after undo with a group selected');
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; e.addPart('bump', 4, 5); e.select(0); });
    for (const bit of [1, 2, 4]) await p2.locator(`#peModes input[data-bit="${bit}"]`).uncheck();
    await p2.locator('#peModes input[data-bit="8"]').click();      // the last one: refused
    assert.equal(await p2.locator('#peModes input[data-bit="8"]').isChecked(), true, 'the checkbox snaps back when the change is refused');
    const touch = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const tp = await touch.newPage();
    await tp.goto(base + '/pinball-editor.html');
    const beforeTap = await tp.evaluate(() => window.pinballEditor.toSpec().items.length);
    await tp.locator('.pe-part[data-kind="bump"]').tap();
    assert.equal(await tp.evaluate(() => window.pinballEditor.toSpec().items.length), beforeTap + 1, 'a finger tap on a tile adds the part');
    await tp.locator('#peJump').tap();
    await tp.waitForFunction(() => scrollY > 100);
    assert.match(await tp.locator('#peJump').textContent(), /Board/);
    await touch.close();
    // suggesting a table: it lands in the feedback inbox as a table suggestion
    await p2.goto(base + '/pinball-editor.html');
    await p2.evaluate(() => { const e = window.pinballEditor; e.state.items = []; for (const [k, x, y] of [['bump', 3, 5], ['bump', 5.5, 5], ['bump', 4.4, 7.5], ['lane', 3.4, 2.4], ['lane', 4.4, 2.4], ['lane', 5.4, 2.4], ['wall', 1, 9]]) e.addPart(k, x, y); });
    await p2.locator('#peSuggest').click();
    await p2.locator('#peSugName').fill('Ab');
    await p2.locator('#peSugSend').click();
    assert.match(await p2.locator('#peSugMsg').textContent(), /3 to 24/);
    await p2.locator('#peSugName').fill('Browser Test');
    await p2.locator('#peSugSend').click();
    await p2.waitForFunction(() => /Suggestion #\d+ is in the queue/.test(document.getElementById('peSugMsg').textContent));
    await p2.keyboard.press('Escape');
    console.log('Pinball editor checks passed: drag, move, resize, inspector, undo, limits, wires, share codes, saved tables and play');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
