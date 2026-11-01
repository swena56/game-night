// Layout-jump check in a real browser (#18): does the board move while the game is played?
// For every game (or the ones named), start it solo at phone size, then let autopilot play your seat:
// the page's presence heartbeat is blocked, so the server hands your seat to a bot after OFFLINE_GRACE
// seconds while the page keeps receiving every update. Meanwhile the page is sampled every 120 ms, and
// every time a large element in the game area (the board, the dice, the hand…) moves up or down
// because something above it changed height, that's a jump. The report names the element that moved
// and the elements above it that grew or shrank.
// Usage: start a server with a short grace, e.g.  OFFLINE_GRACE=2 PORT=8767 python3 server.py
//   then in tests/:  BASE=http://localhost:8767 [SECONDS=25] [WIDTH=485] node jumps.js [game ...]
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:8767';
const SECONDS = +(process.env.SECONDS || 25);
const WIDTH = +(process.env.WIDTH || 485);
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed in the page: samples the game area and collects jumps.
function watch() {
  const arena = document.querySelector('#arena');
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  // the position in the page without transforms, so animations that slide or shake don't count
  const top = (e) => { let y = 0; for (let x = e; x && x !== document.body; x = x.offsetParent) y += x.offsetTop; return y; };
  const visible = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
  let prev = new Map();
  window.__jumps = [];
  setInterval(() => {
    if (!arena.isConnected) return;
    const now = new Map();
    // elements worth watching: a real size, in normal flow, at most 4 levels into the game area
    const walk = (e, depth) => {
      for (const c of e.children) {
        if (!(c instanceof HTMLElement) || !visible(c)) continue;   // SVG shapes have no offsetTop
        const cs = getComputedStyle(c);
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        now.set(c, { top: top(c), h: c.offsetHeight, w: c.offsetWidth });
        if (depth < 4) walk(c, depth + 1);
      }
    };
    walk(arena, 1);
    for (const [e, r] of now) {
      const p = prev.get(e);
      if (!p || r.h < 40 || r.w < 120) continue;          // only the big things: boards, dice, hands
      const dy = r.top - p.top;
      if (Math.abs(dy) < 3) continue;
      // who above it changed height?
      const causes = [];
      for (const [o, q] of now) {
        const op = prev.get(o);
        if (o === e || o.contains(e) || e.contains(o)) continue;
        if (!op && q.top < r.top && q.h > 2) causes.push('+' + name(o));
        else if (op && op.h !== q.h && q.top <= r.top && !(o.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING))
          causes.push(`${name(o)} ${op.h}→${q.h}`);
      }
      window.__jumps.push({ el: name(e), dy, causes: causes.slice(0, 4), t: Math.round(performance.now()) });
    }
    prev = now;
  }, 120);
}

async function check(game) {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.route('**/api/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(BASE + '/');
    await page.fill('#name', 'Jumps');
    await page.selectOption('#soloGame', game);
    await page.click('#soloBtn');
    await page.waitForSelector('#arena', { state: 'attached', timeout: 15000 });
    await sleep(1500);
    await page.evaluate(watch);
    await sleep(SECONDS * 1000);
    const jumps = await page.evaluate(() => window.__jumps);
    // a whole-arena move (e.g. the top bar changing) shows on every child; keep the outermost per moment
    const byT = new Map();
    for (const j of jumps) if (!byT.has(j.t)) byT.set(j.t, j);
    const list = [...byT.values()];
    const tally = new Map();
    for (const j of list) {
      const k = `${j.el} ← ${j.causes.join(', ') || '?'}`;
      const t = tally.get(k) || { n: 0, max: 0 };
      t.n++; t.max = Math.max(t.max, Math.abs(j.dy));
      tally.set(k, t);
    }
    return { jumps: list.length, tally: [...tally].sort((a, b) => b[1].n - a[1].n), errors };
  } catch (e) {
    return { jumps: -1, tally: [], errors: ['could not run: ' + String(e.message || e).split('\n')[0]] };
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
  let bad = 0;
  for (const game of games) {
    const { jumps, tally, errors } = await check(game);
    bad += jumps || errors.length ? 1 : 0;
    console.log(`${jumps || errors.length ? '✗' : '✓'} ${game.padEnd(12)} ${jumps < 0 ? '' : jumps + ' jump(s)'}`);
    for (const [k, t] of tally.slice(0, 6)) console.log(`    ${t.n}× up to ${t.max}px  ${k}`);
    for (const e of errors) console.log('    ERROR ' + e);
  }
  console.log(`\n${games.length} games: ${bad ? bad + ' jumped' : 'nothing jumped'}`);
  process.exit(bad ? 1 : 0);
})();
