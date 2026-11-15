// BingoKit: what Bingo Bash's game screen (bingo.js) and the real-life 🔵 Bingo tools (bingotools.js) share.
// The tumbling glass ball machine on a canvas, the CSS balls, the ink splats, claimed lines drawn over a card,
// the Pattern-hunt shapes (a copy of games/bingo_patterns.py; tests/bingo_rules.py checks they match) and the
// pure win checks the tools use. Loaded before both screens (UI_EXTRA in app.js); reads app.js globals only
// when called.
const BingoKit = (() => {
  const COLS = ['#3a86ff', '#ef476f', '#aab4c3', '#06d6a0', '#ffb703'];  // B I N G O
  const GOLD = '#ffd166';
  const L = 'BINGO';
  const FREE = 12;
  const letter = (n) => L[((n - 1) / 15) | 0];
  const colOf = (n) => COLS[((n - 1) / 15) | 0];
  const name = (n) => `${letter(n)}-${n}`;
  const motion = () => (typeof motionOK === 'function' ? motionOK() : true);
  const low = () => (typeof gfxLevel === 'function' ? gfxLevel() === 'low' : false);
  const hasFx = () => typeof Fx2D !== 'undefined';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- patterns (cell = row*5 + col)
  const draw = (...rows) => rows.flatMap((row, r) => [...row].map((ch, c) => (ch === '#' ? r * 5 + c : -1))).filter((i) => i >= 0);
  const LINES = {};
  for (let r = 0; r < 5; r++) LINES[`r${r}`] = [0, 1, 2, 3, 4].map((c) => r * 5 + c);
  for (let c = 0; c < 5; c++) LINES[`c${c}`] = [0, 1, 2, 3, 4].map((r) => r * 5 + c);
  LINES.d0 = [0, 6, 12, 18, 24];
  LINES.d1 = [4, 8, 12, 16, 20];
  const CORNERS = [0, 4, 20, 24];
  const ALL = [...Array(25).keys()];
  const SHAPES = {
    x: ['X', [draw('#...#', '.#.#.', '..#..', '.#.#.', '#...#')]],
    plus: ['Plus', [draw('..#..', '..#..', '#####', '..#..', '..#..')]],
    t: ['Letter T', [draw('#####', '..#..', '..#..', '..#..', '..#..')]],
    l: ['Letter L', [draw('#....', '#....', '#....', '#....', '#####')]],
    h: ['Letter H', [draw('#...#', '#...#', '#####', '#...#', '#...#')]],
    frame: ['Picture frame', [draw('#####', '#...#', '#...#', '#...#', '#####')]],
    inner: ['Inner square', [draw('.....', '.###.', '.#.#.', '.###.', '.....')]],
    diamond: ['Diamond', [draw('..#..', '.#.#.', '#...#', '.#.#.', '..#..')]],
    stamp: ['Postage stamp', [draw('##...', '##...', '.....', '.....', '.....'), draw('...##', '...##', '.....', '.....', '.....'),
      draw('.....', '.....', '.....', '##...', '##...'), draw('.....', '.....', '.....', '...##', '...##')]],
    kite: ['Kite', [draw('###..', '###..', '###..', '...#.', '....#')]],
    arrow: ['Arrow', [draw('..###', '...##', '..#.#', '.#...', '#....')]],
    blackout: ['Blackout', [ALL]],
  };
  const done = (daub, cells) => cells.every((c) => daub[c]);
  const doneLines = (daub) => Object.keys(LINES).filter((k) => done(daub, LINES[k]));

  /** What wins with a win pattern: 'line' | 'two' | 'corners' | 'blackout' | a SHAPES key | {custom: [cells]}.
   *  Returns {keys, cells} for the first way the card wins, or null. */
  function wins(daub, pattern) {
    if (pattern === 'line' || pattern === 'two') {
      const ks = doneLines(daub);
      const need = pattern === 'two' ? 2 : 1;
      return ks.length >= need ? { keys: ks.slice(0, need), cells: [...new Set(ks.slice(0, need).flatMap((k) => LINES[k]))] } : null;
    }
    if (pattern === 'corners') return done(daub, CORNERS) ? { keys: ['x4'], cells: CORNERS } : null;
    const masks = pattern?.custom ? [pattern.custom] : SHAPES[pattern]?.[1];
    if (!masks) return null;
    const m = masks.find((cells) => cells.length && done(daub, cells));
    return m ? { keys: [], cells: m } : null;
  }
  /** The cells that would each finish the pattern (one number to go). */
  function oneToGo(daub, pattern) {
    if (pattern === 'two') {
      if (doneLines(daub).length < 1) return [];
      pattern = 'line';
    }
    const masks = pattern === 'line' ? Object.values(LINES) : pattern === 'corners' ? [CORNERS] : pattern?.custom ? [pattern.custom] : SHAPES[pattern]?.[1] || [];
    const out = new Set();
    for (const m of masks) {
      const open = m.filter((c) => !daub[c]);
      if (open.length === 1) out.add(open[0]);
    }
    return [...out];
  }
  /** "B12", "b 12", "12" → 12; anything else (or a letter that doesn't match the number) → null. */
  function parseCall(text) {
    const m = String(text).trim().toUpperCase().match(/^([BINGO])?\s*-?\s*(\d{1,2})$/);
    if (!m) return null;
    const n = +m[2];
    if (n < 1 || n > 75) return null;
    if (m[1] && letter(n) !== m[1]) return null;
    return n;
  }
  /** Column-range problems on a 5×5 card of numbers (0 or null = FREE/empty): {bad: Set, dup: Set, empty: [...]} */
  function checkCard(nums) {
    const bad = new Set(), dup = new Set(), seen = {}, empty = [];
    nums.forEach((n, i) => {
      if (i === FREE) return;
      if (!n) { empty.push(i); return; }
      const c = i % 5;
      if (n < c * 15 + 1 || n > c * 15 + 15) bad.add(i);
      if (seen[n] != null) { dup.add(i); dup.add(seen[n]); } else seen[n] = i;
    });
    return { bad, dup, empty };
  }

  // ---------- the look

  function ballEl(n, cls = '', gold = false) {
    const b = el('div', `bgo-ball ${cls}${gold ? ' gold' : ''}`);
    b.style.setProperty('--bc', gold ? GOLD : colOf(n));
    const t = el('span'); t.append(el('i', '', letter(n)), el('b', '', String(n)));
    b.append(t);
    return b;
  }

  // an ink splat blob, stable for each seed
  function splat(seed, drops = true) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const pts = [], n = 13;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 30 + rnd() * 12 + (rnd() < 0.25 ? 8 : 0);
      pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
    }
    let d = `M${((pts[0][0] + pts[n - 1][0]) / 2).toFixed(1)},${((pts[0][1] + pts[n - 1][1]) / 2).toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      d += `Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${((p[0] + q[0]) / 2).toFixed(1)},${((p[1] + q[1]) / 2).toFixed(1)}`;
    }
    let dots = '';
    for (let i = 0; i < 3 && drops; i++) {
      const a = rnd() * Math.PI * 2, r = 44 + rnd() * 8;
      dots += `<circle cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}" r="${(3 + rnd() * 4).toFixed(1)}"/>`;
    }
    return `<svg viewBox="0 0 100 100" aria-hidden="true" style="--rot:${Math.round(rnd() * 360)}deg"><path d="${d}Z"/>${dots}</svg>`;
  }

  // claimed lines over a card's grid (an <svg viewBox="0 0 5 5">): lines, corner rings, or shape cells
  const NS = 'http://www.w3.org/2000/svg';
  function linesSvg() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bgo-lines');
    svg.setAttribute('viewBox', '0 0 5 5');
    svg.setAttribute('preserveAspectRatio', 'none');
    return svg;
  }
  /** keys: line keys, 'x4', 'all', 's:<shape>'; cellsFor: extra highlighted cells (shapes); slept: keys drawn grey */
  function drawLines(svg, keys, { fresh = [], slept = [], cells = [] } = {}) {
    const sig = `${keys.join()}|${slept.join()}|${cells.join()}|${fresh.join()}`;
    if (svg.dataset.k === sig) return;
    svg.dataset.k = sig;
    svg.textContent = '';
    const xy = (i) => [(i % 5) + 0.5, ((i / 5) | 0) + 0.5];
    const anim = (k) => fresh.includes(k) && motion();
    for (const i of cells) {
      const [x, y] = xy(i), r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x - 0.44); r.setAttribute('y', y - 0.44); r.setAttribute('width', 0.88); r.setAttribute('height', 0.88);
      r.setAttribute('rx', 0.14); r.setAttribute('class', `cellwin${fresh.length && motion() ? ' new' : ''}`);
      svg.append(r);
    }
    for (const k of [...keys.map((k) => [k, false]), ...slept.map((k) => [k, true])]) {
      const [key, zz] = k;
      if (key === 'x4') {
        for (const i of CORNERS) {
          const [x, y] = xy(i), c = document.createElementNS(NS, 'circle');
          c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 0.42);
          c.setAttribute('class', `ring${anim(key) ? ' new' : ''}${zz ? ' zz' : ''}`);
          svg.append(c);
        }
        continue;
      }
      if (!LINES[key]) continue;
      const cl = LINES[key], [x1, y1] = xy(cl[0]), [x2, y2] = xy(cl[4]), ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', x1 - (x2 - x1) * 0.08); ln.setAttribute('y1', y1 - (y2 - y1) * 0.08);
      ln.setAttribute('x2', x2 + (x2 - x1) * 0.08); ln.setAttribute('y2', y2 + (y2 - y1) * 0.08);
      ln.setAttribute('pathLength', '1');
      ln.setAttribute('class', `${anim(key) ? 'new' : ''}${zz ? ' zz' : ''}`);
      svg.append(ln);
    }
  }

  /** A little 5×5 picture of a pattern (for the style banner and the pattern picker). */
  function miniShape(cells, cls = '') {
    const g = el('span', `bgo-shape ${cls}`);
    const on = new Set(cells);
    for (let i = 0; i < 25; i++) g.append(el('i', on.has(i) ? 'on' : i === FREE ? 'free' : ''));
    return g;
  }

  /** The BINGO! letters popping over a card (or the screen). */
  function wordPop(box, { combo = false, top = '', black = false } = {}) {
    box.textContent = '';
    box.className = `bgo-word${combo ? ' combo' : ''}${black ? ' black' : ''}`;
    if (top) box.append(el('small', '', top));
    const letters = el('div', 'bgo-letters');
    [...L].forEach((ch, i) => { const s = el('span', '', ch); s.style.setProperty('--d', `${i * 0.08}s`); s.style.setProperty('--c', COLS[i]); letters.append(s); });
    letters.append(el('span', 'bang', '!'));
    box.append(letters);
    if (motion()) { void box.offsetWidth; box.classList.add('go'); setTimeout(() => box.classList.remove('go'), 2400); }
  }

  // ---------- the ball machine: glossy balls tumbling in a glass dome on an air jet; launch() sends one up the chute

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function ballSprite(color, px, gold) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(px * 2 + 4);
    const q = c.getContext?.('2d');
    if (!q) return null;
    const r = px, o = r + 2;
    const gr = q.createRadialGradient(o - r * 0.35, o - r * 0.4, r * 0.1, o, o, r);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, gold ? '#fff3c4' : color); gr.addColorStop(1, shade(color, -0.45));
    q.fillStyle = gr; q.beginPath(); q.arc(o, o, r, 0, Math.PI * 2); q.fill();
    q.fillStyle = 'rgba(255,255,255,.92)'; q.beginPath(); q.arc(o, o, r * 0.48, 0, Math.PI * 2); q.fill();
    q.fillStyle = 'rgba(255,255,255,.55)'; q.beginPath(); q.ellipse(o - r * 0.32, o - r * 0.45, r * 0.28, r * 0.15, -0.6, 0, Math.PI * 2); q.fill();
    return c;
  }

  /** machine(canvas, box, {onTop}) → {size(), frame(dt), launch(n, gold), stop()}; onTop(gold) fires when a launched
   *  ball leaves the top of the dome (for a burst). */
  function machine(cv, box, { onTop } = {}) {
    const g2 = cv?.getContext?.('2d') || null;
    const m = { w: 0, r: 0 };
    let sprites = null, riser = null, stopObs = () => {};
    const balls = Array.from({ length: low() ? 10 : 18 }, (_, i) => ({
      x: (Math.random() - 0.5) * 0.6, y: 0.2 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, c: i % 5,
    }));
    function size() {
      if (!g2 || !hasFx()) return;
      const w = Math.max(80, Math.round(box?.clientWidth || 120));
      const dpr = Fx2D.fit(cv, w, w);
      m.w = w * dpr; m.r = m.w * 0.42;
      sprites = null;
      if (!motion()) paint();
    }
    function step(dt) {
      const jet = riser ? 40 : 28;
      for (const b of balls) {
        b.vy += 6 * dt;                                                                      // gravity (radii/s²)
        if (b.y > 0.2 && Math.abs(b.x) < 0.45) b.vy -= jet * dt * (0.5 + Math.random());    // the air jet
        b.vx += (Math.random() - 0.5) * 14 * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 3.2) { b.vx *= 3.2 / sp; b.vy *= 3.2 / sp; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        const d = Math.hypot(b.x, b.y), lim = 0.87;
        if (d > lim) {
          const nx = b.x / d, ny = b.y / d, dot = b.vx * nx + b.vy * ny;
          if (dot > 0) { b.vx -= 1.7 * dot * nx; b.vy -= 1.7 * dot * ny; }
          b.x = nx * lim; b.y = ny * lim;
        }
      }
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), mm = 0.25;
        if (d > 0 && d < mm) {
          const push = (mm - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) { a.vx += rv * nx * 0.9; a.vy += rv * ny * 0.9; b.vx -= rv * nx * 0.9; b.vy -= rv * ny * 0.9; }
        }
      }
      if (riser) {
        riser.t += dt / 0.7;
        if (riser.t >= 1) { const gold = riser.gold; riser = null; onTop?.(gold); }
      }
    }
    function paint() {
      if (!g2 || !m.w) return;
      const W = m.w, cx = W / 2, cy = W * 0.47, R = m.r, br = R * 0.13;
      if (!sprites) sprites = { cols: COLS.map((c) => ballSprite(c, br, false)), gold: ballSprite(GOLD, br * 1.25, true) };
      g2.setTransform(1, 0, 0, 1, 0, 0);
      g2.clearRect(0, 0, W, W);
      g2.fillStyle = '#5b3a8c';
      g2.beginPath(); g2.moveTo(cx - R * 0.55, cy + R * 0.92); g2.lineTo(cx + R * 0.55, cy + R * 0.92); g2.lineTo(cx + R * 0.75, W - 2); g2.lineTo(cx - R * 0.75, W - 2); g2.closePath(); g2.fill();
      g2.fillStyle = GOLD; g2.fillRect(cx - R * 0.75, W - R * 0.12 - 2, R * 1.5, R * 0.12);
      g2.fillStyle = 'rgba(200,220,255,.25)'; g2.fillRect(cx - br * 1.3, cy - R * 1.12, br * 2.6, R * 0.2);
      const inner = g2.createRadialGradient(cx, cy + R * 0.3, R * 0.1, cx, cy, R);
      inner.addColorStop(0, 'rgba(120,160,255,.28)'); inner.addColorStop(1, 'rgba(20,30,70,.55)');
      g2.fillStyle = inner; g2.beginPath(); g2.arc(cx, cy, R, 0, Math.PI * 2); g2.fill();
      for (const b of balls) { const s = sprites.cols[b.c]; if (s) g2.drawImage(s, cx + b.x * R - s.width / 2, cy + b.y * R - s.height / 2); }
      if (riser) {
        const t = riser.t, s = riser.gold ? sprites.gold : sprites.cols[COLS.indexOf(colOf(riser.n))] || sprites.cols[0];
        const y = cy + R * 0.6 - t * R * 2.1, sc = 1 + t * 0.6;
        if (s) g2.drawImage(s, cx - (s.width * sc) / 2, y - (s.height * sc) / 2, s.width * sc, s.height * sc);
      }
      g2.strokeStyle = 'rgba(255,255,255,.55)'; g2.lineWidth = Math.max(1.5, R * 0.035);
      g2.beginPath(); g2.arc(cx, cy, R, 0, Math.PI * 2); g2.stroke();
      g2.strokeStyle = 'rgba(255,255,255,.35)'; g2.lineWidth = R * 0.07;
      g2.beginPath(); g2.arc(cx, cy, R * 0.82, Math.PI * 1.1, Math.PI * 1.45); g2.stroke();
      g2.fillStyle = 'rgba(255,255,255,.18)'; g2.beginPath(); g2.ellipse(cx + R * 0.35, cy - R * 0.5, R * 0.18, R * 0.08, 0.7, 0, Math.PI * 2); g2.fill();
    }
    size();
    if (hasFx()) stopObs = Fx2D.observe(box, size);
    return {
      size,
      frame(dt) { if (g2 && !document.hidden) { step(dt); paint(); } },
      launch(n, gold) { if (motion()) riser = { t: 0, n, gold }; },
      stop() { stopObs(); },
    };
  }

  /** The [x, y, width] of an element's centre in an Fx2D overlay canvas's pixels. */
  function rectPx(e, fy = 0.5) {
    const r = e?.getBoundingClientRect?.();
    const d = hasFx() ? Fx2D.dpr() : 1;
    return r ? [(r.left + r.width / 2) * d, (r.top + r.height * fy) * d, r.width * d] : [0, 0, 0];
  }
  function confettiAt(fx, e, n = 24) {
    if (!fx || !motion()) return;
    const [x, y, w] = rectPx(e);
    fx.burst(x, y, n, { colors: COLS.concat([GOLD, '#fff']), speed: [w * 0.8, w * 2.4], up: w * 0.8, gravity: w * 3, size: [4, 8], life: [0.8, 1.4], drag: 0.6 });
  }

  return { COLS, GOLD, L, FREE, LINES, CORNERS, ALL, SHAPES, letter, colOf, name, el, motion, low, hasFx,
    done, doneLines, wins, oneToGo, parseCall, checkCard, ballEl, splat, linesSvg, drawLines, miniShape, wordPop,
    machine, rectPx, confettiAt };
})();
if (typeof module !== 'undefined') module.exports = BingoKit;  // node tests (tests/bingo_kit.js)
