// Start the game server and run BASE=http://localhost:8798 node tests/keyclash_browser.js.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:8767';
const roomAction = (page, type, extra) => page.evaluate(({ type, extra }) => act(type, extra), { type, extra });
const current = (page) => page.locator('#kcCurrent').textContent();
const state = (page) => page.evaluate(() => S.keyclash);
async function focus(page) {
  try {
    await page.waitForFunction(() => document.activeElement.id === 'kcInput', null, { polling: 100, timeout: 30000 });
  } catch (error) {
    const details = await page.evaluate(() => ({
      active: document.activeElement.id, phase: S?.phase, playing: S?.keyclash?.playing,
      inputDisabled: document.getElementById('kcInput')?.disabled,
      toast: document.getElementById('toast')?.textContent,
    }));
    throw new Error(`Typing focus was not restored: ${JSON.stringify(details)}`, { cause: error });
  }
}
const fighter = (page, n) => page.evaluate((index) => {
  const list = S.keyclash.fighters;
  return index === 0 ? list.find((f) => f.id === S.me.id) : list.find((f) => f.id !== S.me.id);
}, n);
const submit = async (page, word) => {
  await page.keyboard.type(word);
  await page.keyboard.press('Space');
};

async function layout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(() => {
    const hud = document.querySelector('.kc-top').getBoundingClientRect();
    const arena = document.querySelector('.kc-arena').getBoundingClientRect();
    const typing = document.querySelector('.kc-type').getBoundingClientRect();
    return hud.bottom <= arena.top && arena.bottom <= typing.top && typing.bottom <= innerHeight
      && document.documentElement.scrollWidth <= innerWidth;
  });
}

async function duel(browser, errors) {
  const host = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const guest = await browser.newPage({ viewport: { width: 1024, height: 620 }, reducedMotion: 'reduce' });
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await host.goto(BASE);
    await host.bringToFront();
    await host.locator('#name').fill('Key Host');
    await host.locator('#createBtn').click();
    await host.locator('#lobbyCode').waitFor();
    await host.locator('#shareBtn').click();
    const invite = await host.locator('#modalBody input').inputValue();
    await host.locator('#modalOk').click();
    await guest.goto(new URL(new URL(invite).search, BASE).href);
    await guest.locator('#name').fill('Key Guest');
    await guest.locator('#joinBtn').click();
    await host.waitForFunction(() => S.players.length === 2);
    await roomAction(host, 'settings', { settings: { game: 'keyclash', mode: 'duel', secs: 120, words: 'easy' } });
    await host.waitForFunction(() => S.gameId === 'keyclash');
    await host.locator('#startBtn').click();
    await focus(host);
    await guest.locator('#kcFocus').waitFor({ state: 'attached' });
    await guest.bringToFront();
    if (await guest.locator('#kcFocus').isVisible()) await guest.locator('#kcFocus').click();
    await focus(guest);
    await layout(guest, 390, 650);
    await layout(guest, 1024, 620);
    await host.bringToFront();
    if (await host.locator('#kcFocus').isVisible()) await host.locator('#kcFocus').click();
    await layout(host, 1280, 720);
    await layout(host, 1024, 540);

    const { words, hp } = await state(host);
    assert.equal(await current(host), words[0]);
    assert.equal(await current(guest), words[0]);
    const caret = host.locator('#kcCaret');
    const caretLeft = (await caret.boundingBox()).x;
    const stillAligned = async (letter) => {
      assert.equal((await caret.boundingBox()).x, caretLeft);
      if (letter) assert.ok(Math.abs((await letter.boundingBox()).x - caretLeft) < 1);
    };
    const letters = host.locator('#kcCurrent .kc-letter');
    assert.equal(await letters.first().getAttribute('class'), 'kc-letter untyped');
    assert.equal(await host.locator('#kcInput').evaluate((input) => getComputedStyle(input).opacity), '0');

    await host.keyboard.press('Space');
    await host.keyboard.type(words[0][0]);
    assert.match(await letters.nth(0).getAttribute('class'), / ok$/);
    await stillAligned(letters.nth(1));
    await host.keyboard.press('Space');
    assert.equal(await current(host), words[0]);
    await host.keyboard.type(words[0][1] === 'z' ? 'x' : 'z');
    assert.match(await letters.nth(1).getAttribute('class'), / bad$/);
    await stillAligned();
    const firstCell = await letters.first().boundingBox();
    assert.ok(Math.abs(firstCell.x + 2 * firstCell.width - caretLeft) < 1);
    assert.equal(await letters.nth(1).textContent(), words[0][1]);
    assert.equal(await letters.nth(1).evaluate((cell) => getComputedStyle(cell).textDecorationLine), 'underline');
    await host.keyboard.press('Space');
    assert.equal(await current(host), words[0]);
    await host.keyboard.press('Backspace');
    await stillAligned(letters.nth(1));
    assert.equal(await host.locator('#kcInput').evaluate((input) => {
      const event = new ClipboardEvent('paste', { cancelable: true, bubbles: true });
      input.dispatchEvent(event);
      input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'fast', cancelable: true, bubbles: true }));
      return event.defaultPrevented;
    }), true);
    assert.equal(await host.locator('#kcCurrent .ok').count(), 1);

    await host.locator('#kcChat').click();
    await host.waitForFunction(() => document.activeElement.id === 'chatInput');
    await host.keyboard.type('chat space stays here');
    assert.equal(await host.locator('#chatInput').inputValue(), 'chat space stays here');
    assert.equal(await host.locator('#kcCurrent .ok').count(), 1);
    await host.locator('#chatClose').click();
    await host.locator('#kcFocus').click();
    await focus(host);
    await host.locator('#helpBtn').click();
    await host.locator('#modalOk').click();
    if (await host.locator('#kcFocus').isVisible()) await host.locator('#kcFocus').click();
    await focus(host);
    await host.locator('#kcActivity').click();
    assert.equal(await host.locator('#kcActivity').getAttribute('aria-expanded'), 'true');
    await host.locator('#kcActivity').click();
    await host.locator('#kcFocus').click();

    // Keep a request open so several words and their local attack effects overlap.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const submitted = [];
    await host.route('**/api/action', async (route) => {
      const body = route.request().postDataJSON();
      if (body.type === 'word') {
        submitted.push(body);
        if (submitted.length === 1) await held;
      }
      await route.continue();
    });
    await submit(host, words[0].slice(1));
    assert.equal(await current(host), words[1]);
    await stillAligned();
    assert.equal(await host.locator('#kcCompleted').textContent(), words[0]);
    for (const word of words.slice(1, 5)) await submit(host, word);
    assert.equal(await current(host), words[5]);
    assert.equal(await host.locator('#kcCombo').textContent(), '4 combo');
    assert.match(await host.locator('#kcMilestone').textContent(), /Heating Up/);
    assert.equal((await fighter(host, 0)).words, 0);
    release();
    await host.waitForFunction(() => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 5);
    await guest.waitForFunction(() => S.keyclash.fighters.find((f) => f.id !== S.me.id).words === 5);
    assert.equal(submitted.length, 5);
    assert.deepEqual(submitted.map((entry) => entry.i), [0, 1, 2, 3, 4]);
    assert.deepEqual(submitted.map((entry) => entry.errs), [1, 0, 0, 0, 0]);
    const me = await fighter(host, 0);
    assert.equal(me.combo, 4);
    assert.equal(me.acc, Math.round(100 * me.chars / (me.chars + 1)));
    assert.equal((await state(host)).events.filter((e) => e.kind === 'hit').length, 5);
    assert.ok((await fighter(guest, 0)).hp < hp);
    await assert.rejects(roomAction(host, 'word', submitted[0]), /already counted/);
    assert.equal((await fighter(host, 0)).words, 5);

    await host.keyboard.type(words[5][0] === 'z' ? 'x' : 'z');
    assert.equal(await host.locator('#kcCombo').textContent(), '0 combo');
    await host.keyboard.press('Backspace');
    assert.equal(await host.locator('#kcCombo').textContent(), '0 combo');
    await submit(host, words[5]);
    await host.waitForFunction(() => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 6);
    assert.equal((await fighter(host, 0)).combo, 0);
    assert.equal((await fighter(host, 0)).errors, 2);

    await guest.bringToFront();
    if (await guest.locator('#kcFocus').isVisible()) await guest.locator('#kcFocus').click();
    await focus(guest);
    assert.equal(await guest.locator('.kc').evaluate((board) => board.classList.contains('kc-reduced')), true);
    await submit(guest, words[0]);
    assert.equal(await current(guest), words[1]);
    assert.equal(await guest.locator('#kcTrack').evaluate((track) => track.getAnimations().length), 0);
    await host.waitForFunction(() => S.keyclash.fighters.find((f) => f.id !== S.me.id).words === 1);
  } finally {
    if (errors.length) console.error(errors);
    await host.close();
    await guest.close();
  }
}

async function pause(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1150, height: 680 } });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE);
    await page.locator('#name').fill('Key Solo');
    await page.selectOption('#soloGame', 'keyclash', { force: true });
    await page.locator('#soloBtn').click();
    await focus(page);
    const word = await current(page);
    await page.keyboard.type(word[0]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => S.paused);
    await page.keyboard.type('abc');
    assert.equal(await page.locator('#kcCurrent .ok').count(), 1);
    await page.keyboard.press('p');
    await page.waitForFunction(() => !S.paused);
    await focus(page);
    await submit(page, word.slice(1));
    await page.waitForFunction(() => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 1);

    await page.locator('#kcOptions').click();
    await page.getByLabel('Typing size').selectOption('large');
    await page.getByLabel('Reduce motion').check();
    await page.getByLabel('High contrast').check();
    await page.getByLabel('Colorblind feedback').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await focus(page);
    assert.equal(await page.locator('.kc').getAttribute('data-size'), 'large');
    assert.match(await page.locator('.kc').getAttribute('class'), /kc-reduced kc-contrast kc-colorblind/);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--headless=new', '--no-sandbox'] });
  const errors = [];
  try {
    await duel(browser, errors);
    await pause(browser, errors);
    assert.deepEqual(errors, []);
    console.log('Key Clash browser checks passed');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
