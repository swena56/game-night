// Start a Game Night server, then run BASE=http://localhost:8794 node tests/pinball_browser.js.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.BASE || 'http://localhost:8794';
const control = (page, value) => page.locator(`.pb-cabinet button[data-control="${value}"]`);
const charge = (page, low, high = 240) => page.waitForFunction(([lo, hi]) => {
  const meter = document.querySelector('.pb-charge');
  const amount = Number(meter?.getAttribute('aria-valuenow'));
  return meter && amount >= lo && amount <= hi;
}, [low, high]);
const text = (page, selector, value, timeout = 10000) => page.waitForFunction(([sel, expected]) =>
  document.querySelector(sel)?.textContent === expected, [selector, value], { timeout });

async function open(browser, { flat = false, low = false, mobile = false } = {}) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 320, height: 680 } : { width: 1000, height: 830 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(({ flat, low }) => {
    if (!localStorage.getItem('unmask.session')) localStorage.setItem('unmask.soloGame', JSON.stringify('pinball'));
    localStorage.setItem('unmask.prefs', JSON.stringify({ gfx: low ? 'low' : 'high' }));
    window.blockPinballGL = flat;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return window.blockPinballGL && type.includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  }, { flat, low });
  await page.goto(base);
  await page.locator('#name').fill('Pinball Player');
  assert.equal(await page.locator('#soloGame').inputValue(), 'pinball');
  await page.locator('#soloBtn').click();
  await page.locator(flat ? '.pb-flat' : '.pb-three').waitFor();
  await page.waitForFunction(() => document.querySelector('.pb-controls [data-control="4"]')?.disabled === false);
  return { page, errors };
}

async function mobileRun(browser) {
  const { page, errors } = await open(browser, { flat: true, mobile: true });
  const packets = [];
  let dropHeld = false, block = null;
  await page.route('**/api/input', async (route) => {
    const body = route.request().postDataJSON();
    packets.push(body);
    if (block) {
      const wait = block;
      block = null;
      await wait;
    }
    if (dropHeld && body.held) await route.abort();
    else await route.continue();
  });
  try {
    const cabinet = await page.locator('.pb-cabinet').boundingBox();
    assert.ok(cabinet.width <= 320 && cabinet.x >= 0);
    assert.ok(cabinet.y + cabinet.height <= 680, 'whole table and controls fit the phone viewport');
    const client = await page.context().newCDPSession(page);
    const flips = await Promise.all([control(page, 1).boundingBox(), control(page, 2).boundingBox()]);
    const touchPoints = flips.map((rect, id) => ({ id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }));
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
    await page.waitForFunction(() => [...document.querySelectorAll('.pb-controls button[aria-pressed="true"]')].length === 2);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => !document.querySelector('.pb-controls button[aria-pressed="true"]'));
    await control(page, 4).scrollIntoViewIfNeeded();
    const launch = await control(page, 4).boundingBox();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: launch.x + launch.width / 2, y: launch.y + launch.height / 2 }] });
    await charge(page, 30);
    assert.ok(packets.filter(p => p.held === 4).length >= 2, 'hold sends heartbeats');
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await charge(page, 0, 0);
    assert.ok(packets.some(p => p.reset && p.held === 0), 'touch cancellation clears the plunger');

    await page.keyboard.down('Space');
    await charge(page, 16);
    dropHeld = true;
    await charge(page, 0, 0);
    await page.keyboard.up('Space');
    dropHeld = false;
    assert.equal(await control(page, 4).isEnabled(), true, 'timed-out release did not launch');

    await page.keyboard.down('Space');
    await charge(page, 16);
    const epoch = packets.at(-1).epoch;
    await page.evaluate(() => { es.onerror(); connect(); });
    await charge(page, 0, 0);
    await page.keyboard.up('Space');
    await page.waitForFunction((old) => S?.pinball?.epoch && S.pinball.epoch !== old, epoch);
    assert.equal(await control(page, 4).getAttribute('aria-pressed'), 'false');

    await page.keyboard.down('Space');
    await charge(page, 23);
    await page.locator('#pauseBtn').evaluate(button => button.click());
    await page.waitForFunction(() => S?.paused);
    await page.locator('#resumeBtn').click();
    await page.waitForFunction(() => !S?.paused);
    await charge(page, 0, 0);
    await page.keyboard.up('Space');

    await page.keyboard.down('Space');
    await charge(page, 200, 220);
    await page.keyboard.up('Space');
    await text(page, '.pb-message', 'Skill shot +5,000');
    const score = Number((await page.locator('.pb-score').textContent()).replaceAll(',', ''));
    assert.ok(score >= 5000);

    let release;
    block = new Promise(resolve => { release = resolve; });
    await page.keyboard.down('KeyA');
    const afterFlip = packets.length;
    for (const key of ['KeyQ', 'KeyW', 'KeyE', 'KeyE']) await page.keyboard.press(key);
    release();
    await text(page, '.pb-nudges', 'Tilted');
    assert.deepEqual(packets.slice(afterFlip).filter(p => p.nudge).map(p => p.nudge), [-1, 2, 1, 1]);
    assert.ok(packets.slice(afterFlip).filter(p => p.nudge).every(p => p.held === 1));
    assert.ok(await control(page, 1).isDisabled());
    await page.keyboard.up('KeyA');
    await text(page, '.pb-balls', '2', 25000);
    await text(page, '.pb-nudges', 'Nudges 3');
    for (const balls of ['1', '0']) {
      await page.keyboard.down('Space');
      await charge(page, 120, 140);
      await page.keyboard.up('Space');
      await text(page, '.pb-balls', balls, 25000);
    }
    await text(page, '.pb-message', 'New personal best');
    const best = await page.evaluate(() => JSON.parse(localStorage.getItem('pinball.best')));
    assert.ok(best >= score);
    await page.reload();
    await text(page, '.pb-best', best.toLocaleString());
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function threeRun(browser, low) {
  const { page, errors } = await open(browser, { low });
  try {
    const canvas = page.locator('.pb-three');
    const size = () => canvas.evaluate(c => [c.width, c.height, c.clientWidth, !!(c.getContext('webgl2') || c.getContext('webgl'))]);
    const before = await size();
    assert.equal(before[0], before[2] * (low ? 1 : 2), 'pixel ratio reflects graphics quality');
    assert.equal(before[3], true);
    await page.setViewportSize({ width: 480, height: 620 });
    await page.waitForFunction(width => document.querySelector('.pb-three')?.width !== width, before[0]);
    const shot = await page.locator('.pb-stage').screenshot();
    assert.ok(shot.length > 4000, 'non-empty playfield');
    if (process.env.PINBALL_SCREENSHOT && !low) await page.locator('.pb-stage').screenshot({ path: process.env.PINBALL_SCREENSHOT });
    if (!low) {
      await canvas.evaluate(c => {
        const extension = (c.getContext('webgl2') || c.getContext('webgl')).getExtension('WEBGL_lose_context');
        if (!extension) throw Error('Context loss extension missing');
        window.blockPinballGL = true;
        extension.loseContext();
      });
      await page.locator('.pb-flat').waitFor();
      await page.evaluate(() => { window.blockPinballGL = false; });
      await page.locator('.gl3-retry').click();
      await canvas.waitFor();
      await page.locator('.pb-flat').waitFor({ state: 'detached' });
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--headless=new', '--no-sandbox', `--use-angle=${process.env.CHROMIUM_ANGLE || 'swiftshader'}`, '--enable-unsafe-swiftshader'],
  });
  try {
    await threeRun(browser, false);
    await threeRun(browser, true);
    await mobileRun(browser);
    console.log('Pinball browser checks passed with live controls, Canvas fallback, and WebGL recovery');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
