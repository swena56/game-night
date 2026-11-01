// Layout check in a real browser (headless Chromium), which jsdom can't do because it lays nothing out.
// For every game (or the ones named) at a phone width and a desktop width: start it solo, let it settle,
// and check that
//   - the page doesn't scroll sideways (scrollWidth fits the screen);
//   - the game area has a real size;
//   - nothing visible is squeezed to nothing: text, or a filled shape such as a die's pip (#44);
//   - the page throws no JavaScript errors.
// Usage: start a server (e.g. PORT=8767 python3 server.py), then in tests/:
//   npm install && BASE=http://localhost:8767 node layout.js [game ...]
//   SHOTS=/some/dir  also saves a screenshot per game and width;  WIDTHS=485,1280 (the default)
// It uses the system Chromium (CHROMIUM=/usr/bin/chromium by default) through playwright-core.
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:8767';
const WIDTHS = (process.env.WIDTHS || '485,1280').split(',').map(Number);
const SHOTS = process.env.SHOTS;
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: what's wrong with the layout right now.
function inspect() {
  const problems = [];
  const W = innerWidth;
  if (document.documentElement.scrollWidth > W + 1) {
    const wide = [...document.querySelectorAll('#game *')]
      .filter((e) => e.getBoundingClientRect().right > W + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('#players'))
      .slice(0, 3).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''));
    problems.push(`scrolls sideways: ${document.documentElement.scrollWidth}px on a ${W}px screen` + (wide.length ? ` (past the edge: ${wide.join(', ')})` : ''));
  }
  const arena = document.querySelector('#arena');
  const ar = arena?.getBoundingClientRect();
  if (!ar || ar.width < 100 || ar.height < 60) problems.push(`game area too small: ${ar ? Math.round(ar.width) + '×' + Math.round(ar.height) : 'missing'}`);
  const shown = (e) => {
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (x.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    return true;
  };
  const squashed = [];
  for (const e of arena ? arena.querySelectorAll('*') : []) {
    const r = e.getBoundingClientRect(), pr = e.parentElement.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1) continue;
    if (pr.width < 12 || pr.height < 12) continue;  // the whole parent is small: not a squeeze
    const cs = getComputedStyle(e);
    if (cs.position === 'absolute' || cs.position === 'fixed') continue;  // overlays size themselves
    if (/^0(\.0*)?(%|px)?$/.test(e.style.width) || /^0(\.0*)?(%|px)?$/.test(e.style.height)) continue;  // a bar at 0 on purpose
    const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const filled = !e.children.length && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    if ((text || filled) && shown(e)) squashed.push(e);
  }
  if (squashed.length) {
    const e = squashed[0];
    problems.push(`${squashed.length} visible element(s) squeezed to nothing, e.g. ${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join('.')}` +
      ` (${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}) "${e.textContent.trim().slice(0, 20)}"`);
  }
  return problems;
}

async function check(game, width) {
  // A fresh browser per game: several WebGL games in one browser (or several browsers at once) can crash it.
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width, height: width < 700 ? 900 : 860 } });
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource|WebGL|GPU stall/i.test(m.text()) && errors.push(m.text()));
    await page.goto(BASE + '/');
    await page.fill('#name', 'Layout');
    await page.selectOption('#soloGame', game);
    await page.click('#soloBtn');
    await page.waitForSelector('#arena', { state: 'attached', timeout: 15000 });
    await sleep(2500);  // let the board draw, the bots move and the first animations finish
    let problems = await page.evaluate(inspect);
    if (problems.length) { await sleep(1500); problems = await page.evaluate(inspect); }  // ignore a passing animation
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${game}-${width}.png` });
    return [...problems, ...errors.map((e) => 'JavaScript error: ' + e)];
  } catch (e) {
    return ['could not run: ' + String(e.message || e).split('\n')[0]];
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  let games = process.argv.slice(2);
  if (!games.length) {
    const r = await fetch(BASE + '/api/games').catch(() => null);
    games = r?.ok ? (await r.json()).map((g) => g.id) : [];
  }
  if (!games.length) {
    const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(BASE + '/');
    games = await page.$$eval('#soloGame option', (o) => o.map((x) => x.value));
    await browser.close();
  }
  if (SHOTS) require('fs').mkdirSync(SHOTS, { recursive: true });
  let bad = 0;
  for (const game of games) {
    for (const width of WIDTHS) {
      const problems = await check(game, width);
      bad += problems.length ? 1 : 0;
      console.log(`${problems.length ? '✗' : '✓'} ${game.padEnd(12)} ${String(width).padStart(4)}px` + (problems.length ? '\n    ' + problems.join('\n    ') : ''));
    }
  }
  console.log(`\n${games.length} games × ${WIDTHS.length} widths: ${bad ? bad + ' with problems' : 'all fit'}`);
  process.exit(bad ? 1 : 0);
})();
