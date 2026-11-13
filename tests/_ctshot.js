// screenshot a card-table game on a phone: node _ctshot.js <game> [waitMs]
const { chromium } = require('playwright-core');
const out = process.env.OUT;
(async () => {
  const g = process.argv[2], wait = +(process.argv[3] || 6000);
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(process.env.BASE || 'http://localhost:8767/');
  await p.fill('#name', 'Tester'); await p.selectOption('#soloGame', g); await p.click('#soloBtn');
  await p.waitForFunction(() => typeof S !== 'undefined' && S?.phase === 'playing', null, { timeout: 30000 });
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${out}/${g}.png`, fullPage: true });
  console.log(g, 'errors:', errs);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
