// Start the game server and run BASE=http://localhost:8798 node tests/keyclash_browser.js.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:8767';
const TIMEOUT = Number(process.env.BROWSER_TIMEOUT || 30000);
const roomAction = (page, type, extra) => page.evaluate(({ type, extra }) => act(type, extra), { type, extra });
const current = (page) => page.locator('#kcCurrent').textContent();
const state = (page) => page.evaluate(() => S.keyclash);
const until = (page, predicate) => page.waitForFunction(predicate, null, { polling: 100 });
async function focus(page) {
  try {
    await until(page, () => document.activeElement.id === 'kcInput');
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
  await until(page, () => {
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
  for (const page of [host, guest]) {
    page.setDefaultTimeout(TIMEOUT);
    page.on('pageerror', (error) => errors.push(error.message));
  }
  try {
    await host.goto(BASE, { waitUntil: 'domcontentloaded' });
    await host.bringToFront();
    await host.locator('#name').fill('Key Host');
    await host.locator('#createBtn').click();
    await host.locator('#lobbyCode').waitFor();
    await host.locator('#shareBtn').click();
    const invite = await host.locator('#modalBody input').inputValue();
    await host.locator('#modalOk').click();
    await guest.goto(new URL(new URL(invite).search, BASE).href, { waitUntil: 'domcontentloaded' });
    await guest.locator('#name').fill('Key Guest');
    await guest.locator('#joinBtn').click();
    await until(host, () => S.players.length === 2);
    await roomAction(host, 'settings', { settings: { game: 'keyclash' } });
    await host.waitForFunction(() => S.gameId === 'keyclash');
    await roomAction(host, 'settings', { settings: { mode: 'tug' } });
    await until(host, () => !!S.keyclashTeams);
    const teams = host.locator('.kc-team-setup');
    await teams.getByLabel('Key Host').selectOption('1');
    await until(host, () => Object.values(S.settings.tug_teams || {}).includes(1));
    await teams.getByLabel('Key Guest').selectOption('1');
    await until(host, () => document.querySelector('#startBtn').disabled);
    await teams.getByLabel('Key Guest').selectOption('');
    await until(host, () => !document.querySelector('#startBtn').disabled);
    await roomAction(host, 'settings', { settings: { mode: 'duel', secs: 0, words: 'easy', rounds: 3 } });
    await until(host, () => S.settings.rounds === 3 && S.settings.secs === 0 && S.settings.words === 'easy');
    await host.getByRole('button', { name: 'Solo typing practice' }).click();
    const practice = host.getByRole('textbox', { name: 'Practice word' });
    await practice.press('z');
    assert.match(await host.locator('.kc-practice .kc-correction').textContent(), /Expected h/);
    await practice.press('Backspace');
    await submit(host, 'home');
    await submit(host, 'lake');
    await submit(host, 'tree');
    await submit(host, 'rain');
    await host.locator('.kc-practice').getByRole('button', { name: 'Shield' }).click();
    await submit(host, 'guard');
    assert.equal(await host.locator('.kc-practice .kc-correction').textContent(), 'Shield practiced');
    await host.getByRole('button', { name: 'Skip word' }).click();
    assert.match(await host.locator('.kc-practice-stats').textContent(), /1 skipped/);
    await host.getByRole('button', { name: 'Restart drill' }).click();
    assert.equal(await host.locator('.kc-practice-word').textContent(), 'home');
    await host.getByRole('button', { name: 'Close practice' }).click();
    assert.equal(await host.evaluate(() => S.phase), 'lobby');
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
    const correction = host.locator('#kcCorrection');
    const feedback = host.locator('.kc-feedback');
    const correctionBox = await feedback.boundingBox();
    const arenaBox = await host.locator('.kc-arena').boundingBox();
    assert.equal(correctionBox.x, caretLeft);
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
    const wrong = words[0][1] === 'z' ? 'x' : 'z';
    await host.keyboard.type(wrong);
    assert.match(await letters.nth(1).getAttribute('class'), / bad$/);
    await stillAligned();
    const firstCell = await letters.first().boundingBox();
    assert.ok(Math.abs(firstCell.x + 2 * firstCell.width - caretLeft) < 1);
    assert.equal(await letters.nth(1).textContent(), wrong);
    assert.equal(await letters.nth(1).evaluate((cell) => getComputedStyle(cell).textDecorationLine), 'underline');
    assert.equal(await correction.textContent(), `Expected ${words[0][1]} · 1 Backspace`);
    await host.keyboard.type(words[0].slice(2));
    const range = words[0].length - 1;
    assert.equal(await correction.textContent(), `Expected ${words[0][1]} · ${range} Backspace${range === 1 ? '' : 's'}`);
    for (const [actual, before] of [[await feedback.boundingBox(), correctionBox],
      [await host.locator('.kc-arena').boundingBox(), arenaBox]]) {
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - before[key]) < 1);
    }
    await host.keyboard.press('Space');
    assert.equal(await letters.nth(1).textContent(), wrong);
    assert.equal((await fighter(host, 0)).words, 0);
    for (let i = 0; i < range; i++) await host.keyboard.press('Backspace');
    assert.equal(await current(host), words[0]);
    assert.equal(await correction.textContent(), '');
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

    await host.locator('#kcOptions').click();
    const skipOption = host.getByLabel('Allow skipping mistyped words');
    assert.equal(await skipOption.isChecked(), false);
    await skipOption.check();
    await host.getByRole('button', { name: 'Done' }).click();
    await focus(host);
    await host.keyboard.type(wrong + words[0].slice(2, -1));
    if (words[0].length > 2) {
      assert.doesNotMatch(await correction.textContent(), /Space to skip/);
      await host.keyboard.press('Space');
      assert.equal(await letters.nth(1).textContent(), wrong);
      await host.keyboard.type(words[0].at(-1));
    }
    assert.match(await correction.textContent(), /Space to skip/);
    await host.keyboard.press('Enter');
    assert.equal(await letters.nth(1).textContent(), wrong);

    // Hold the skip response after the server accepts it, then type several attacks locally.
    const submitted = [];
    const record = (request) => {
      if (!request.url().endsWith('/api/action')) return;
      const body = request.postDataJSON();
      if (body.type === 'word' || body.type === 'skip') submitted.push(body);
    };
    host.on('request', record);
    await host.evaluate(() => {
      const fetchAction = window.fetch;
      const held = new Promise((resolve) => { window.releaseSkip = resolve; });
      window.fetch = async (url, options) => {
        const response = await fetchAction(url, options);
        if (String(url).endsWith('/api/action') && JSON.parse(options.body).type === 'skip') await held;
        return response;
      };
    });
    await host.keyboard.press('Space');
    assert.equal(await current(host), words[1]);
    assert.equal(await host.locator('#kcSkipped').isVisible(), true);
    assert.equal(await correction.textContent(), '');
    await stillAligned();
    assert.equal(await host.locator('#kcCompleted').textContent(), '');
    for (const word of words.slice(1, 5)) await submit(host, word);
    assert.equal(await current(host), words[5]);
    assert.equal(await host.locator('#kcCombo').textContent(), '4 combo');
    assert.match(await host.locator('#kcMilestone').textContent(), /Heating Up/);
    await host.waitForFunction(() => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 1);
    const skipped = await fighter(host, 0);
    assert.equal(skipped.chars, 0);
    assert.equal(skipped.charge, 0);
    assert.equal(skipped.errors, 2);
    assert.equal((await fighter(host, 1)).hp, hp);
    assert.equal(submitted.length, 1);
    await host.evaluate(() => window.releaseSkip());
    await host.waitForFunction(() => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 5);
    await until(guest, () => S.keyclash.fighters.find((f) => f.id !== S.me.id).words === 5);
    assert.equal(submitted.length, 5);
    assert.deepEqual(submitted.map((entry) => entry.i), [0, 1, 2, 3, 4]);
    assert.deepEqual(submitted.map((entry) => entry.type), ['skip', 'word', 'word', 'word', 'word']);
    assert.deepEqual(submitted.map((entry) => entry.errs), [2, 0, 0, 0, 0]);
    const me = await fighter(host, 0);
    assert.equal(me.combo, 4);
    assert.equal(me.acc, Math.round(100 * me.chars / (me.chars + 2)));
    assert.equal((await state(host)).events.filter((e) => e.kind === 'hit').length, 4);
    assert.ok((await fighter(guest, 0)).hp < hp);
    host.off('request', record);
    await assert.rejects(roomAction(host, 'skip', submitted[0]), /already counted/);
    assert.equal((await fighter(host, 0)).words, 5);

    await host.keyboard.type(words[5][0] === 'z' ? 'x' : 'z');
    assert.equal(await host.locator('#kcCombo').textContent(), '0 combo');
    await host.keyboard.press('Backspace');
    assert.equal(await host.locator('#kcCombo').textContent(), '0 combo');
    await submit(host, words[5]);
    await host.waitForFunction(() => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 6);
    assert.equal((await fighter(host, 0)).combo, 0);
    assert.equal((await fighter(host, 0)).errors, 3);

    await guest.bringToFront();
    if (await guest.locator('#kcFocus').isVisible()) await guest.locator('#kcFocus').click();
    await focus(guest);
    assert.equal(await guest.locator('.kc').evaluate((board) => board.classList.contains('kc-reduced')), true);
    await submit(guest, words[0]);
    assert.equal(await current(guest), words[1]);
    assert.equal(await guest.locator('#kcTrack').evaluate((track) => track.getAnimations().length), 0);
    await until(host, () => S.keyclash.fighters.find((f) => f.id !== S.me.id).words === 1);
    await host.bringToFront();
    if (await host.locator('#kcFocus').isVisible()) await host.locator('#kcFocus').click();
    await focus(host);
    const beforeRejection = await fighter(host, 0);
    const [retryWord, savedWord, secondSavedWord, draftWord] = (await state(host)).words;
    let rejectWord;
    const rejection = new Promise((resolve) => { rejectWord = resolve; });
    let intercept = true;
    const rejectFirst = async (route) => {
      if (intercept && route.request().postDataJSON().type === 'word') {
        intercept = false;
        await rejection;
        return route.fulfill({ status: 400, json: { error: "That's not the word." } });
      }
      return route.continue();
    };
    await host.route('**/api/action', rejectFirst);
    await submit(host, retryWord);
    await submit(host, savedWord);
    await submit(host, secondSavedWord);
    await host.keyboard.type(draftWord[0]);
    rejectWord();
    await host.getByText(`Retype “${retryWord}” to continue. Later words are saved.`).waitFor();
    await submit(host, retryWord);
    assert.equal(await current(host), draftWord);
    assert.equal(await host.locator('#kcCurrent .ok').count(), 1);
    await host.waitForFunction((n) => S.keyclash.fighters.find((f) => f.id === S.me.id).words === n, beforeRejection.words + 3);
    await host.keyboard.press('Backspace');
    await host.unroute('**/api/action', rejectFirst);
    for (let i = 0; !(await state(host)).offer && i < 20; i++) {
      const number = (await fighter(host, 0)).words + 1;
      await submit(host, await current(host));
      await host.waitForFunction((n) => S.keyclash.fighters.find((f) => f.id === S.me.id).words === n, number);
    }
    const streamWord = await current(host), powers = (await state(host)).offer;
    assert.ok(powers?.shield);
    await host.keyboard.type(streamWord[0]);
    await host.keyboard.press('Alt+1');
    assert.equal(await current(host), powers.shield);
    await host.keyboard.press('Escape');
    assert.equal(await current(host), streamWord);
    assert.equal(await host.locator('#kcCurrent .ok').count(), 1);
    await host.getByRole('button', { name: /Shield/ }).click();
    assert.equal(await current(host), powers.shield);
    await focus(host);
    await submit(host, powers.shield);
    assert.equal(await current(host), streamWord);
    assert.equal(await host.locator('#kcCurrent .ok').count(), 1);
    await until(host, () => S.keyclash.fighters.find((f) => f.id === S.me.id).shield > 0);
    await host.reload({ waitUntil: 'domcontentloaded' });
    await host.locator('#kcOptions').click();
    assert.equal(await skipOption.isChecked(), true);
    await host.getByRole('button', { name: 'Done' }).click();
    await focus(host);
    for (let round = 1; round <= 2; round++) {
      await host.waitForFunction((n) => S.keyclash.round === n && S.keyclash.playing, round);
      await focus(host);
      for (let i = 0; (await state(host)).playing && i < 60; i++) {
        const number = (await fighter(host, 0)).words + 1;
        await submit(host, await current(host));
        await host.waitForFunction((n) => S.keyclash.fighters.find((f) => f.id === S.me.id).words === n, number);
      }
    }
    await until(host, () => S.phase === 'over');
    await host.locator('#overFold').click();
    const chart = host.locator('#kcReport');
    const summaries = await host.evaluate(() => S.keyclash.history.map((h) => h.stats[S.me.id]));
    assert.equal(summaries.length, 2);
    const chars = summaries.reduce((n, row) => n + row.chars, 0);
    const errors = summaries.reduce((n, row) => n + row.errors, 0);
    const secs = summaries.reduce((n, row) => n + row.secs, 0);
    const matchCell = await chart.locator('.kc-rep-total td').first().textContent();
    assert.match(matchCell, new RegExp(`^${Math.round(12 * chars / secs)} wpm · ${Math.round(100 * chars / (chars + errors))}%`));
    await chart.getByLabel('Chart time').press('End');
    assert.match(await chart.getByLabel('Chart time').getAttribute('aria-valuetext'), /seconds.*wpm/);
    await chart.getByRole('button', { name: 'Hide the charts' }).click();
    assert.equal(await chart.isVisible(), false);
    await roomAction(guest, 'ready');
    await until(host, () => S.ready.length > 0);
    assert.equal(await chart.isVisible(), false);
    await host.getByRole('button', { name: 'Match charts' }).click();
    assert.equal(await chart.isVisible(), true);
    await chart.getByRole('button', { name: 'Practice missed words' }).click();
    assert.equal(await host.locator('.kc-practice-word').textContent(), words[0]);
    await host.getByRole('button', { name: 'Close practice' }).click();
  } finally {
    if (errors.length) console.error(errors);
    await host.close();
    await guest.close();
  }
}

async function pause(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1150, height: 680 } });
  page.setDefaultTimeout(TIMEOUT);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
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
    const next = await current(page);
    await page.keyboard.type(next + 'z');
    assert.equal(await page.locator('.kc-overflow').textContent(), 'z');
    assert.equal(await page.locator('#kcCorrection').textContent(), 'Backspace to remove the extra letter');
    await page.keyboard.press('Backspace');
    assert.equal(await page.locator('#kcCorrection').textContent(), '');
    await page.keyboard.press('Space');
    await page.setViewportSize({ width: 390, height: 410 });
    await page.locator('#kcOptions').click();
    await page.getByLabel('Focus layout').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await focus(page);
    assert.equal(await page.locator('#kcCanvas').isVisible(), false);
    assert.equal(await page.locator('#kcPreview .kc-next').count(), 2);
    const firstX = (await page.locator('#kcCurrent').boundingBox()).x;
    const focusWord = await current(page);
    await page.keyboard.type(focusWord[0]);
    assert.equal((await page.locator('#kcCurrent').boundingBox()).x, firstX);
    await page.keyboard.type(focusWord[1] === 'x' ? 'z' : 'x');
    assert.match(await page.locator('#kcCorrection').textContent(), /Expected . · 1 Backspace/);
    assert.equal(await page.locator('#kcCaret').isVisible(), true);
  } finally {
    await page.close();
  }
}

async function ready(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 390, height: 650 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(TIMEOUT);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('#name').fill('Mobile Typist');
    await page.selectOption('#soloGame', 'keyclash', { force: true });
    await page.locator('#soloSetupBtn').tap();
    await until(page, () => S?.phase === 'lobby' && S.players.length === 2);
    await roomAction(page, 'settings', { settings: { round_ready: 'ready' } });
    await until(page, () => S.settings.round_ready === 'ready');
    await page.locator('#startBtn').tap();
    await until(page, () => S.keyclash?.stage === 'ready');
    assert.equal((await state(page)).elapsed, null);
    await page.getByRole('button', { name: 'Ready to type' }).tap();
    await focus(page);
    await page.setViewportSize({ width: 390, height: 410 });
    await until(page, () => S.keyclash?.stage === 'countdown');
    assert.equal((await state(page)).elapsed, null);
    await page.keyboard.type('abc');
    assert.equal(await page.locator('#kcCurrent .ok').count(), 0);
    await until(page, () => S.keyclash?.stage === 'play');
    assert.ok((await state(page)).left >= 59);
    await focus(page);
    await submit(page, await current(page));
    await until(page, () => S.keyclash.fighters.find((f) => f.id === S.me.id).words === 1);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--headless=new', '--no-sandbox', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  });
  const errors = [];
  try {
    await duel(browser, errors);
    await pause(browser, errors);
    await ready(browser, errors);
    assert.deepEqual(errors, []);
    console.log('Key Clash browser checks passed');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
