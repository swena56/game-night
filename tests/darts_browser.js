// Run with node tests/darts_browser.js. Set CHROMIUM to use a different executable.
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

async function check(browser, mobile) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 320, height: 650 } : { width: 1100, height: 850 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: mobile ? 'reduce' : 'no-preference',
  });
  const errors = [];
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
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="stylesheet" href="/games/archery.css">
          <main></main><aside></aside>
          <script>window.UI = {};</script>
          <script src="/gl3.js"></script><script src="/games/archery.js"></script>` });
      } else await route.fulfill({ path: join(staticDir, path) });
    });
    await page.goto('http://darts.test/');
    await page.evaluate(() => {
      const darts = {
        title: '301', mode: '301', x01: true, readyIn: 0, seats: ['a'], active: [0],
        me: 0, next: 0, left: 3, visit: 1, roundRecap: false, darts: [], points: [301],
        numbers: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5],
        radii: [0.037, 0.094, 0.582, 0.629, 0.953, 1], checkout: [],
        swipePace: 2.2, spreadBase: 0.03, spreadPerPace: 0.012, aimControl: true,
        hint: { x: 0, y: 0.6, label: 'T20', reason: 'Leaves 241 if you hit it.' },
      };
      const context = {
        myTurn: true, peek: true, player: () => ({ name: 'Tester', color: '#ef865b' }),
        el: (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text }),
        act: async (type, payload) => { window.actions.push({ type, payload }); },
        quiet: () => {},
      };
      window.actions = [];
      window.renderShot = () => {
        darts.shot = { id: 1, o: 0, x: 0, y: 0, number: 25, multiplier: 2, label: 'Bull', value: 50 };
        darts.darts = darts.visitDarts = [darts.shot];
        darts.left = 2;
        UI.archery.render({ phase: 'playing', darts }, context);
      };
      UI.archery.mount(document.querySelector('main'), document.querySelector('aside'));
      UI.archery.render({ phase: 'playing', darts }, context);
    });
    await page.waitForFunction(() => window.THREE);
    if (mobile) {
      assert.equal(await page.locator('.ar-darts-webgl').count(), 0);
      assert.ok(await page.locator('.ar-darts-board > circle').first().isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } else {
      await page.locator('canvas.ar-darts-webgl').waitFor();
    }

    const focusOrder = [
      page.getByRole('button', { name: 'Inspect dartboard at an angle' }),
      page.getByRole('button', { name: 'Strategy hint' }),
      page.getByRole('group', { name: /^Dartboard/ }),
      page.getByRole('button', { name: /^Swipe toward the board/ }),
      page.getByRole('slider', { name: 'Horizontal aim' }),
      page.getByRole('slider', { name: 'Vertical aim' }),
      page.getByRole('button', { name: 'Release dart' }),
    ];
    assert.match(await page.locator('.ar-darts-turn[role=status]').textContent(), /Your visit.*3 left/);
    for (const control of focusOrder) {
      await page.keyboard.press('Tab');
      assert.ok(await control.evaluate((element) => element === document.activeElement), await control.getAttribute('class'));
    }
    await focusOrder[4].press('ArrowRight');
    assert.match(await page.locator('.ar-darts-aim-status[role=status]').textContent(), /Bull.*Spread radius 6%/);
    await focusOrder[1].click();
    assert.match(await page.locator('.ar-darts-advice[role=status]').textContent(), /T20.*Leaves 241/);
    await focusOrder[6].press('Enter');
    assert.equal(await page.evaluate(() => actions[0].payload.vx), 0);
    await page.evaluate(() => renderShot());
    if (mobile) assert.ok(await page.locator('.ar-darts-trail').getAttribute('hidden') !== null);
    await page.waitForFunction(() => document.querySelector('.ar-darts-result').textContent.includes('Bull'));
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
    console.log('Darts browser checks passed with mobile SVG and desktop WebGL');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
