// End-to-end check of the 🔵 Bingo tools card scanner (static/games/bingoscan.js) in headless Chromium: draw a
// paper-style 75-ball card on a canvas (slightly rotated, on a grey "table", with a header and grid lines), save it
// as a photo, and a 6-on sheet as a second photo; pick both at once in "Scan cards" (two pages in the tray, read in
// the background), open page 1 and move its corners onto the true grid anyway, then check the review: 7 cards
// under two page headers, and how many numbers came back right. Needs a running server (BASE, default http://localhost:8767).
//   cd tests && BASE=http://localhost:8767 node bingo_scan.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8767';
const CARD = [7, 21, 38, 52, 66, 12, 17, 44, 49, 70, 3, 29, 0, 60, 61, 14, 25, 31, 55, 73, 9, 30, 41, 47, 68];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 485, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/');
  // 1. paint the photo in the page and pull it out as a PNG; returns the grid's corners in photo pixels
  const { png, quad } = await p.evaluate((nums) => {
    const W = 900, H = 1100, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, W, H);
    const ang = 0.05, cx = W / 2, cy = H / 2, cw = 620, cell = cw / 5, top = -330;
    g.translate(cx, cy); g.rotate(ang);
    g.fillStyle = '#fbf7ee'; g.fillRect(-cw / 2 - 30, top - 20, cw + 60, cw + 150);
    g.fillStyle = '#c1121f'; g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    'BINGO'.split('').forEach((ch, i) => g.fillText(ch, -cw / 2 + cell * (i + 0.5), top + 45));
    const gy = top + 100;
    g.strokeStyle = '#222'; g.lineWidth = 3;
    for (let i = 0; i <= 5; i++) {
      g.beginPath(); g.moveTo(-cw / 2 + i * cell, gy); g.lineTo(-cw / 2 + i * cell, gy + cw); g.stroke();
      g.beginPath(); g.moveTo(-cw / 2, gy + i * cell); g.lineTo(cw / 2, gy + i * cell); g.stroke();
    }
    g.fillStyle = '#111'; g.font = 'bold 56px sans-serif';
    nums.forEach((n, i) => { if (n) g.fillText(String(n), -cw / 2 + (i % 5 + 0.5) * cell, gy + (((i / 5) | 0) + 0.5) * cell + 2); });
    g.fillStyle = '#c1121f'; g.font = 'bold 26px sans-serif'; g.fillText('FREE', 0, gy + 2.5 * cell);
    const rot = (x, y) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)];
    const quad = [rot(-cw / 2, gy), rot(cw / 2, gy), rot(cw / 2, gy + cw), rot(-cw / 2, gy + cw)];
    return { png: c.toDataURL('image/png').split(',')[1], quad };
  }, CARD);
  // a whole sheet: six frameless cards (lines stop short of the edge, like a 6-on book page), slightly rotated
  const sheet = await p.evaluate(async () => {
    await needUI('bingoscan');
    const W = 1000, H = 1300, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#6b5a48'; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2); g.rotate(-0.04); g.translate(-W / 2, -H / 2);
    g.fillStyle = '#2aa7df'; g.fillRect(60, 60, 880, 1180);
    const truth = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) {
      const x = 80 + k * 430, y = 140 + r * 380, cw = 400, chh = 320, cx = cw / 5, cy = chh / 5;
      g.fillStyle = '#fff'; g.fillRect(x, y, cw, chh + 18);
      g.strokeStyle = '#111'; g.lineWidth = 2;
      for (let i = 1; i < 5; i++) {
        g.beginPath(); g.moveTo(x + i * cx, y); g.lineTo(x + i * cx, y + chh); g.stroke();
        g.beginPath(); g.moveTo(x + 4, y + i * cy); g.lineTo(x + cw - 4, y + i * cy); g.stroke();
      }
      g.fillStyle = '#111'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const nums = [];
      for (let i = 0; i < 25; i++) {
        const n = i === 12 ? 0 : (i % 5) * 15 + 1 + ((i * 7 + r * 3 + k) % 15);
        nums.push(n);
        if (n) g.fillText(String(n), x + (i % 5 + 0.5) * cx, y + (((i / 5) | 0) + 0.5) * cy);
      }
      truth.push(nums);
    }
    const found = UI.bingoscan._test.findCards(c);
    const mid = (q) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
    return { n: found.length, mids: found.map(mid).map((m) => m.map(Math.round)), truth, png: c.toDataURL('image/png').split(',')[1] };
  });
  console.log(`sheet: found ${sheet.n}/6 cards`, JSON.stringify(sheet.mids));
  const file = path.join(os.tmpdir(), `bingo-scan-${process.pid}.png`), file2 = path.join(os.tmpdir(), `bingo-sheet-${process.pid}.png`);
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
  fs.writeFileSync(file2, Buffer.from(sheet.png, 'base64'));
  fs.utimesSync(file, new Date(Date.now() - 60000), new Date(Date.now() - 60000));  // taken first: page 1
  // 2. open the tools → Scan cards → pick both photos at once (a page each)
  await p.fill('#name', 'Tester');
  await p.click('#utilsBtn');
  await p.click('#bingoToolsBtn');
  await p.waitForSelector('.bgt-tabs');
  await p.click('text=📷 Scan cards');
  await p.waitForSelector('.bgt-scan');
  const t0 = Date.now();
  await p.setInputFiles('.bgt-scan input[type=file]', [file, file2]);
  await p.waitForFunction(() => document.querySelectorAll('.bgt-shot').length === 2 && !document.querySelector('.bgt-shot.find'), null, { timeout: 30000 });
  const tray = await p.$$eval('.bgt-shot small', (xs) => xs.map((x) => x.textContent));
  console.log('tray', JSON.stringify(tray));
  // 3. open page 1 and drag the four dots onto the grid corners anyway, then read it again
  await p.click('.bgt-shot:nth-child(1) .bgt-pagebtn');
  await p.waitForSelector('.bgt-adjust canvas', { timeout: 10000 });
  const k = await p.evaluate(() => { const c = document.querySelector('.bgt-adjust canvas'); return c.width / 900; });
  const dots = await p.$$('.bgt-dot');
  const box = await (await p.$('.bgt-adjust canvas')).boundingBox();
  for (let i = 0; i < 4; i++) {
    const d = await dots[i].boundingBox();
    await p.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + quad[i][0] * k, box.y + quad[i][1] * k, { steps: 4 });
    await p.mouse.up();
  }
  await p.click('text=/🔎 Read/');
  await p.waitForSelector('.bgt-tray');
  await p.click('text=/✅ Check/');
  await p.waitForSelector('.bgt-review', { timeout: 300000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const rows = await p.$$eval('.bgt-revrow', (xs) => xs.map((x) => [...x.querySelectorAll('.mg i')].map((i) => i.textContent)));
  const heads = await p.$$eval('.bgt-revpage', (xs) => xs.map((x) => x.textContent));
  const saveTo = await p.$eval('.bgt-addto', (x) => x.textContent);
  console.log(`review: ${rows.length} cards, headers ${JSON.stringify(heads)}, "${saveTo}" in ${secs}s`);
  const show = (n) => (n ? String(n) : '★');
  const sheetRight = sheet.truth.reduce((s, t, ci) => s + (rows[ci + 1] || []).filter((v, i) => i !== 12 && v === show(t[i])).length, 0);
  console.log(`sheet read ${sheetRight}/144 right`);
  await p.click('.bgt-revrow .bgt-cardbtns button');
  await p.waitForSelector('.bgt-ed', { timeout: 10000 });
  const got = await p.$$eval('.bgt-ed input', (xs) => xs.map((x) => x.value));
  const want = CARD.filter((_, i) => i !== 12).map(String);
  const right = got.filter((v, i) => v === want[i]).length;
  console.log(`card read ${right}/24 right`);
  console.log('got ', got.join(' '));
  console.log('want', want.join(' '));
  console.log('errors', JSON.stringify(errs));
  fs.unlinkSync(file); fs.unlinkSync(file2);
  await b.close();
  process.exit(right >= 22 && sheet.n === 6 && rows.length === 7 && heads.length === 2 && sheetRight >= 130 && !errs.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
