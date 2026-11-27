// Run with node tests/darts_browser.js. Set CHROMIUM for a different executable or AXE_SCREENSHOTS for captures.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const textureNames = ['target', 'forged-steel', 'ground-steel', 'hickory'];
const screenshots = process.env.AXE_SCREENSHOTS;

async function check(browser, mobile, axe = false, reducedMotion = mobile, missingArt = false, cornerScoring = false) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 320, height: 650 } : { width: 1100, height: 850 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const errors = [];
  const textureResponses = new Map();
  page.on('response', (response) => {
    const match = /\/games\/axe-art\/([^/]+)\.jpg$/.exec(response.url());
    if (match) textureResponses.set(match[1], response.status());
  });
  const capture = async (phase) => {
    if (!screenshots || !axe || reducedMotion || missingArt) return;
    mkdirSync(screenshots, { recursive: true });
    const clip = await page.locator('.ar-darts-input').boundingBox();
    await page.screenshot({
      clip,
      path: join(screenshots, `${mobile ? 'svg' : 'webgl'}-${phase}.png`),
    });
  };
  page.on('pageerror', (error) => errors.push(error));
  const staticDir = join(__dirname, '../static');
  try {
    if (mobile) {
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type.includes('webgl') ? null : getContext.call(this, type, ...args);
        };
      });
    }
    await page.route('http://darts.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') {
        await route.fulfill({ contentType: 'text/html', body: `
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="stylesheet" href="/games/archery.css">
          <main></main><aside></aside>
          <script>window.UI = {};</script>
          <script src="/gl3.js"></script><script src="/games/archery.js"></script>` });
      } else if (missingArt && path.startsWith('/games/axe-art/')) {
        await route.fulfill({ status: 404 });
      } else await route.fulfill({ path: join(staticDir, path) });
    });
    if (axe && !reducedMotion) {
      await page.addInitScript(() => {
        let time = 0, nextId = 0;
        const frames = new Map();
        window.requestAnimationFrame = (callback) => {
          frames.set(++nextId, callback);
          return nextId;
        };
        window.cancelAnimationFrame = (id) => frames.delete(id);
        performance.now = () => time;
        window.stepDartsFrame = (elapsed) => {
          time += elapsed;
          const callbacks = [...frames.values()];
          frames.clear();
          for (const callback of callbacks) callback(time);
        };
      });
    }
    await page.goto(axe && !cornerScoring ? 'http://darts.test/?axeDebug=1' : 'http://darts.test/');
    await page.evaluate(({ axe, mobile, cornerScoring }) => {
      if (axe && !mobile) {
        const create = GL3.renderer;
        GL3.renderer = (...args) => {
          const renderer = create(...args);
          if (!renderer) return renderer;
          const draw = renderer.render.bind(renderer);
          renderer.render = (scene, camera) => {
            draw(scene, camera);
            window.readAxeHandleColors = () => scene.children
              .filter((object) => object.visible && object.userData.finMaterial)
              .map((object) => object.children[0].children[0].material.color.getHexString());
            window.readAxeEdge = () => {
              const axe = scene.children.filter((object) => object.visible && object.userData.finMaterial)
                .sort((a, b) => a.position.z - b.position.z)[0];
              if (!axe) return null;
              const local = new THREE.Vector3(-3.2 * 1.15, 32.4 - 2.3 * 1.10, 0);
              return axe.localToWorld(local).toArray();
            };
          };
          return renderer;
        };
      }
      const darts = {
        title: '301', mode: '301', x01: true, readyIn: 0, seats: ['a'], active: [0],
        me: 0, next: 0, left: 3, visit: 1, roundRecap: false, darts: [], points: [301],
        numbers: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5],
        radii: [0.037, 0.094, 0.582, 0.629, 0.953, 1], checkout: [],
        swipePace: 2.2, spreadBase: 0.03, spreadPerPace: 0.012, aimControl: true,
        hint: { x: 0, y: 0.6, label: 'T20', reason: 'Leaves 241 if you hit it.' },
      };
      if (axe) Object.assign(darts, {
        mode: 'axe', title: 'Axe Throwing', x01: false, seats: ['a', 'b'], active: [0, 1], points: [0, 0], visitsDone: [0, 0], visitLimit: 8, axesPerRound: 5, left: 5,
        axeRings: [[0.2, 5], [0.4, 4], [0.6, 3], [0.8, 2], [1, 1]],
        hint: { x: 0, y: 0, label: '5-point ring', reason: 'Aim at the center for five points.' },
      });
      if (cornerScoring) Object.assign(darts, {
        axeRings: [[0.2, 5], [0.6, 3], [1, 1]], axeCorners: [[-0.64, 0.64, 0.09], [0.64, 0.64, 0.09]],
        canCallCorner: true, left: 1,
      });
      const context = {
        myTurn: true, peek: true, player: (id) => ({ name: id === 'b' ? 'Rival' : 'Tester', color: id === 'b' ? '#4dcbe3' : '#ef865b' }),
        el: (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text }),
        act: async (type, payload) => { window.actions.push({ type, payload }); },
        quiet: () => {},
      };
      window.actions = [];
      window.renderShot = () => {
        darts.shot = { id: 1, o: 0, x: 0, y: 0, number: 25, multiplier: 2, label: 'Bull', value: 50 };
        if (axe) Object.assign(darts.shot, {
          number: 5, multiplier: 1, label: '5-point ring', value: 5,
          axeWindupMs: 153, axeFlightMs: 686, axeTurn: 322, axeAngle: 0, axeSpinRate: 322 / 0.533,
        });
        if (cornerScoring) {
          Object.assign(darts.shot, { x: 0.64, y: 0.64, number: 7, value: 7, label: '7-point corner' });
          darts.canCallCorner = false;
        }
        darts.darts = darts.visitDarts = [darts.shot];
        if (axe) darts.points[0] = darts.shot.value;
        darts.left = 2;
        UI.archery.render({ phase: 'playing', hintsOk: true, darts }, context);
      };
      window.addRivalAxe = () => {
        darts.darts = [...darts.darts, { ...darts.shot, id: 2, o: 1, x: 0.14 }];
        UI.archery.render({ phase: 'playing', hintsOk: true, darts }, context);
      };
      UI.archery.mount(document.querySelector('main'), document.querySelector('aside'));
      UI.archery.render({ phase: 'playing', hintsOk: true, darts }, context);
    }, { axe, mobile, cornerScoring });
    await page.waitForFunction(() => window.THREE, null, { polling: 20 });
    if (axe && !reducedMotion) await page.evaluate(() => stepDartsFrame(16));
    if (mobile) {
      assert.equal(await page.locator('.ar-darts-webgl').count(), 0);
      assert.ok(await page.locator('.ar-darts-board > circle').first().isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } else {
      await page.locator('canvas.ar-darts-webgl').waitFor();
    }

    if (axe) {
      const scoreboard = await page.locator('main .ar-darts-score-panel').boundingBox();
      const target = await page.locator('.ar-darts-board-wrap').boundingBox();
      // stacked above the target on a narrow page; in the column beside it from 1100px
      const wide = (await page.viewportSize()).width >= 1100;
      assert.ok(scoreboard.y >= 0 && (wide ? scoreboard.x >= target.x + target.width : scoreboard.y + scoreboard.height <= target.y));
      assert.ok(scoreboard.y + scoreboard.height <= (await page.viewportSize()).height);
    } else {
      assert.equal(await page.locator('aside .ar-darts-score-panel').count(), 1);
    }
    if (axe) {
      const decoded = await page.evaluate((names) => Promise.all(names.map(async (name) => {
        const image = new Image();
        image.src = `/games/axe-art/${name}.jpg`;
        try {
          await image.decode();
          return true;
        } catch {
          return false;
        }
      })), textureNames);
      assert.deepEqual(decoded, textureNames.map(() => !missingArt));
      assert.deepEqual(textureNames.map((name) => textureResponses.get(name)), textureNames.map(() => missingArt ? 404 : 200));
      if (missingArt) {
        assert.equal(await page.locator('.ar-darts-board text:visible').count(), 5);
        assert.equal(errors.length, 0, String(errors));
        return;
      }
      await capture('held');
    }

    if (cornerScoring) {
      assert.ok(await page.locator('.ar-darts-axe-debug').isHidden());
      const call = page.getByRole('button', { name: 'Call 7-point corner' });
      assert.equal(await page.locator('.ar-darts-board text').count(), 5);
      await call.click();
      assert.equal(await call.getAttribute('aria-pressed'), 'true');
      await call.click();
      assert.equal(await call.getAttribute('aria-pressed'), 'false');
      await call.click();
      await page.getByRole('button', { name: 'Release axe' }).press('Enter');
      assert.equal(await page.evaluate(() => actions[0].payload.axeCorner), true);
      await page.evaluate(() => renderShot());
      await call.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.ar-darts-result').textContent(), '7-point corner');
      assert.equal(await page.locator('.ar-darts-score .total').first().textContent(), '7');
      assert.equal(errors.length, 0, String(errors));
      return;
    }

    const focusOrder = [
      page.getByRole('button', { name: axe ? 'Inspect axe target at an angle' : 'Inspect dartboard at an angle' }),
      page.getByRole('button', { name: 'Strategy hint' }),
      page.getByRole('group', { name: axe ? /^Axe target/ : /^Dartboard/ }),
      page.getByRole('button', { name: axe ? /^Swipe to throw the axe/ : /^Swipe toward the board/ }),
      page.getByRole('slider', { name: 'Horizontal aim' }),
      page.getByRole('slider', { name: 'Vertical aim' }),
      page.getByRole('button', { name: axe ? 'Release axe' : 'Release dart' }),
    ];
    assert.match(await page.locator('.ar-darts-turn[role=status]').textContent(), axe ? /Your throw.*5 left/ : /Your visit.*3 left/);
    if (axe) assert.match(await page.locator('.ar-darts-hint').textContent(), /A clean stick scores 1–5 points.*8 rounds wins/);
    const grab = page.getByRole('group', { name: /^Axe starting position/ });
    const flash = page.getByRole('button', { name: 'Flash the section a dart hits' });
    const board = axe ? [focusOrder[2], grab] : [focusOrder[2]];
    const tabOrder = [...focusOrder.slice(0, 2), ...(await flash.isVisible() ? [flash] : []), ...board, ...focusOrder.slice(3)];
    for (const control of tabOrder) {
      await page.keyboard.press('Tab');
      assert.ok(await control.evaluate((element) => element === document.activeElement), await control.getAttribute('class'));
    }
    await focusOrder[4].press('ArrowRight');
    assert.match(await page.locator('.ar-darts-aim-status[role=status]').textContent(), axe ? /5-point ring.*Spread radius 6%/ : /Bull.*Spread radius 6%/);
    await focusOrder[1].click();
    assert.match(await page.locator('.ar-darts-advice[role=status]').textContent(), axe ? /5-point ring.*five points/ : /T20.*Leaves 241/);
    if (axe) {
      const from = await grab.boundingBox();
      const x = from.x + from.width / 2, y = from.y + from.height / 2;
      const handleUnderPointer = await grab.evaluate((element, [x, y]) => document.elementFromPoint(x, y) === element, [x, y]);
      assert.ok(handleUnderPointer, 'the visible axe has a pointer target');
      if (mobile) {
        const touch = await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 35, y: y - 15 }] });
        await page.waitForTimeout(90); // Let a placement drag settle before lifting.
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touch.detach();
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 35, y - 15, { steps: 3 });
        await page.waitForTimeout(90);
        await page.mouse.up();
      }
      if (!reducedMotion) await page.evaluate(() => stepDartsFrame(16));
      const to = await grab.boundingBox();
      assert.ok(to.x < from.x - 25 && to.y < from.y - 10);
      assert.equal(await page.evaluate(() => actions.length), 0);
    }
    await focusOrder[6].press('Enter');
    assert.equal(await page.evaluate(() => actions[0].payload.vx), 0);
    if (axe) assert.equal(await page.evaluate(() => actions[0].payload.axeOrigin.length), 2);
    await page.evaluate(() => renderShot());
    if (reducedMotion) assert.ok(await page.locator('.ar-darts-trail').getAttribute('hidden') !== null);
    if (axe && !reducedMotion) {
      assert.equal(await page.locator('.ar-darts-score .total').first().textContent(), '0');
      await page.evaluate(() => stepDartsFrame(153));
      await capture('release');
      await page.evaluate(() => stepDartsFrame(187));
      await capture('flight');
      const matrix = await page.locator('[data-shot="1"]').getAttribute('transform');
      const [, values] = /matrix\(([^)]+)\)/.exec(matrix);
      const [width, , sidewaysY, height] = values.split(' ').map(Number);
      assert.equal(sidewaysY, 0);
      assert.ok(width > 0 && height < 0, 'the axe pitches forward into depth');
      await page.evaluate(() => stepDartsFrame(345));
      if (!mobile) {
        const depth = await page.evaluate(() => readAxeEdge()[2]);
        assert.ok(depth > 0.1 && depth < 0.3, 'the leading edge is just in front of the board before impact');
      }
      await page.evaluate(() => stepDartsFrame(1));
      await capture('impact');
      assert.equal(await page.locator('.ar-darts-score .total').first().textContent(), '5');
      if (!mobile) {
        const [x, y, depth] = await page.evaluate(() => readAxeEdge());
        assert.ok(Math.hypot(x, y, depth - 0.1) < 0.098, 'the WebGL edge meets the scored point');
      }
      await page.evaluate(() => stepDartsFrame(60));
      if (!mobile) {
        const [x, y, depth] = await page.evaluate(() => readAxeEdge());
        assert.ok(Math.hypot(x, y, depth - 0.1) < 0.098, 'the WebGL edge stays fixed while the handle settles');
      }
    }
    await page.waitForFunction((label) => document.querySelector('.ar-darts-result').textContent.includes(label), axe ? '5-point ring' : 'Bull');
    await capture('lodged');
    if (axe) {
      assert.equal(await page.locator('.ar-darts-score .total').first().textContent(), '5');
      assert.ok(await page.locator('[data-shot="1"] polygon').count() > 0);
      await page.evaluate(() => addRivalAxe());
      if (!reducedMotion) await page.evaluate(() => stepDartsFrame(16));
      if (mobile) {
        for (const [id, color] of [[1, 'rgb(239, 134, 91)'], [2, 'rgb(77, 203, 227)']]) {
          const fill = await page.locator(`[data-shot="${id}"] path[fill^="var"]`)
            .evaluate((path) => getComputedStyle(path).fill);
          assert.equal(fill, color);
        }
      } else {
        await page.waitForFunction(() => ['ef865b', '4dcbe3'].every((color) => readAxeHandleColors().includes(color)));
      }
      assert.equal(await page.locator('.ar-darts-axe-trace tbody tr').count(), 7);
      assert.equal(await page.locator('.ar-darts-axe-trace tbody tr').nth(2).locator('td').first().textContent(), '153');
      const diagnostics = page.locator('.ar-darts-axe-debug');
      assert.equal(await diagnostics.getAttribute('open'), null);
      await diagnostics.locator('summary').click();
      if (!reducedMotion) await page.evaluate(() => stepDartsFrame(16));
      assert.ok(await page.getByRole('button', { name: 'Copy flight trace' }).isEnabled());
      assert.match(await page.locator('.ar-darts-axe-contact-summary').textContent(), /Contact · edge 2.*686 ms/);
      await page.locator('.ar-darts-axe-contact-marker').waitFor({ state: 'visible' });
      if (mobile) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    if (!mobile) assert.ok(await page.locator('canvas.ar-darts-webgl').isVisible());
    assert.equal(errors.length, 0, String(errors));
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    await check(browser, true);
    await check(browser, false);
    await check(browser, true, true);
    await check(browser, true, true, false);
    await check(browser, false, true);
    await check(browser, true, true, true, true);
    await check(browser, true, true, true, false, true);
    await check(browser, false, true, true, false, true);
    console.log('Darts browser checks passed with mobile SVG and desktop WebGL');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
