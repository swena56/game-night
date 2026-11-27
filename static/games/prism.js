// Prism Pop: a match-3 race. Your board runs here, in the browser; the server keeps a copy of everyone's
// board (the rival minis), routes 🧊 frost and 🪨 stones (S.prism.events) and ends the round on the clock.
// Drawn on one 2D canvas: gems are pre-rendered sprites, matches pop into shards and sparks, beams sweep,
// novas send out shockwaves, prisms throw rainbow arcs. A plain button grid stands in if canvas is missing.
UI.prism = (() => {
  // ---------- rules (mirrors games/prism.py)
  const N = 8;
  const PLAIN = 'abcdef', FROZEN = 'ABCDEF', BEAM_H = 'ghijkl', BEAM_V = 'mnopqr', NOVA = 'stuvwx';
  const PRISM = '*', STONE = '#', EMPTY = '.';
  const GEM_PTS = 10, STONE_PTS = 20, MAKE_PTS = { beam: 60, nova: 100, prism: 200 };
  const kind = (ch) => { for (const grp of [PLAIN, FROZEN, BEAM_H, BEAM_V, NOVA]) { const i = grp.indexOf(ch); if (i >= 0) return i; } return null; };
  const special = (ch) => BEAM_H.includes(ch) ? 'h' : BEAM_V.includes(ch) ? 'v' : NOVA.includes(ch) ? 'n' : ch === PRISM ? 'p' : null;
  const matchable = (ch) => !FROZEN.includes(ch) && ch !== PRISM && ch !== STONE && ch !== EMPTY;
  const movable = (i) => { const ch = g[i]; return !FROZEN.includes(ch) && ch !== STONE && ch !== EMPTY; };
  const neighbours = (i) => {
    const x = i % N, y = (i / N) | 0;
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && a < N && b >= 0 && b < N).map(([a, b]) => b * N + a);
  };
  function attackFor(cascade, specials) {   // the server also spaces each player's attacks 5 s apart
    let frost = cascade >= 3 ? Math.min(4, cascade - 1) : 0;
    if (specials.includes('nova')) frost = Math.max(frost, 2);
    let stones = 0;
    if (specials.includes('prism') || specials.includes('combo') || cascade >= 5) { stones = 2 + (cascade >= 6 ? 1 : 0); if (cascade < 5) frost = 0; }
    return [frost, stones];
  }
  // 🔥 fever, ⏱ rush and 🛡 parry (mirrors games/prism.py)
  const FEVER_DRAIN = 6, FEVER_MS = 6000, RUSH_MS = 10000, PARRY_MS = 3000;
  const feverFill = (cascade) => (cascade >= 1 ? 22 + 10 * (cascade - 1) : 0);
  const bursts = (cascade, fired) => cascade >= 3 || fired.length > 0;
  // 💠 rank from lifetime XP; each rank unlocks the board theme at the same index
  const RANKS = [[0, 'Quartz', '🤍'], [1000, 'Topaz', '🧡'], [3000, 'Amethyst', '💜'], [7000, 'Sapphire', '💙'],
    [15000, 'Emerald', '💚'], [30000, 'Ruby', '❤️'], [60000, 'Diamond', '💎']];
  const THEMES = [
    { name: 'Night', bg: ['#24204a', '#101326'], mote: '#b8a6ff', glow: '#7b5cff' },
    { name: 'Topaz Dawn', bg: ['#4a2a1a', '#1c1020'], mote: '#ffd08a', glow: '#ffb21a' },
    { name: 'Amethyst Haze', bg: ['#3a1550', '#140a26'], mote: '#e0a8ff', glow: '#a64dff' },
    { name: 'Deep Sea', bg: ['#0c3550', '#06121f'], mote: '#8be9ff', glow: '#2fd0ff' },
    { name: 'Emerald Grove', bg: ['#0f3d2a', '#06140f'], mote: '#9dff8a', glow: '#16c66b' },
    { name: 'Ruby Ember', bg: ['#4a0f1c', '#160609'], mote: '#ffb09a', glow: '#ff3b5c' },
    { name: 'Diamond Starfield', bg: ['#1a1a2e', '#000008'], mote: '#ffffff', glow: '#e3e7f5' },
  ];
  const rankOf = (xp) => { let r = 0; RANKS.forEach(([min], i) => { if (xp >= min) r = i; }); return r; };
  const pdata = () => { try { return Profile.gameData('prism'); } catch { return {}; } };
  const psave = (d) => { try { Profile.saveGameData('prism', d); } catch {} };
  let themeNow = null;   // cached: the frame loop asks every frame
  const theme = () => themeNow ||= (() => { const d = pdata(), i = d.theme | 0; return THEMES[i <= rankOf(d.xp || 0) ? i : 0]; })();
  const GOAL_TEXT = { score: ['Score', '💎'], colour: ['Pop', ''], thaw: ['Thaw', '🧊'], stones: ['Break', '🪨'], make: ['Make', '⚡💥🌈'], prism: ['Make', '🌈'] };
  const NAMES = ['ruby', 'sapphire', 'emerald', 'topaz', 'amethyst', 'pearl'];
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  let g = [];            // the board: 64 one-character cells, row by row from the top
  let rng = Math.random, kinds = 6;
  const newGem = () => PLAIN[Math.floor(rng() * kinds)];

  function runs() {
    const out = [];
    for (const horiz of [true, false]) {
      for (let a = 0; a < N; a++) {
        const idx = (t) => horiz ? a * N + t : t * N + a;
        let b = 0;
        while (b < N) {
          const ch = g[idx(b)], k = matchable(ch) ? kind(ch) : null;
          let e = b + 1;
          while (k != null && e < N && matchable(g[idx(e)]) && kind(g[idx(e)]) === k) e++;
          if (k != null && e - b >= 3) { const cells = []; for (let t = b; t < e; t++) cells.push(idx(t)); out.push([cells, horiz ? 'h' : 'v']); }
          b = e;
        }
      }
    }
    return out;
  }
  function groups() {
    let gs = [];
    for (const run of runs()) {
      let cells = new Set(run[0]), rs = [run];
      const joined = gs.filter((gr) => [...gr.cells].some((c) => cells.has(c)));
      gs = gs.filter((gr) => !joined.includes(gr));
      for (const gr of joined) { gr.cells.forEach((c) => cells.add(c)); rs = rs.concat(gr.runs); }
      gs.push({ cells, runs: rs });
    }
    return gs;
  }
  function made({ cells, runs: rs }, prefer) {
    const k = kind(g[[...cells][0]]);
    const longest = Math.max(...rs.map((r) => r[0].length)), dirs = new Set(rs.map((r) => r[1]));
    let ch;
    if (longest >= 5) ch = PRISM;
    else if (dirs.size === 2) ch = NOVA[k];
    else if (longest === 4) ch = (rs[0][1] === 'h' ? BEAM_H : BEAM_V)[k];
    else return null;
    let spot = prefer.find((i) => cells.has(i));
    if (spot == null && dirs.size === 2) {
      const h = new Set(rs.filter((r) => r[1] === 'h').flatMap((r) => r[0]));
      const both = rs.filter((r) => r[1] === 'v').flatMap((r) => r[0]).filter((i) => h.has(i));
      if (both.length) spot = Math.min(...both);
    }
    if (spot == null) { const run = rs.reduce((a, b) => (b[0].length > a[0].length ? b : a))[0]; spot = run[run.length >> 1]; }
    return [ch, spot];
  }
  function blastArea(i, sp, hitKind = null) {
    const x = i % N, y = (i / N) | 0, out = new Set();
    if (sp === 'h') for (let t = 0; t < N; t++) out.add(y * N + t);
    else if (sp === 'v') for (let t = 0; t < N; t++) out.add(t * N + x);
    else if (sp === 'n') { for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (xx >= 0 && xx < N && yy >= 0 && yy < N) out.add(yy * N + xx); }
    else if (sp === 'p') {
      if (hitKind == null) {
        const counts = Array.from({ length: kinds }, (_, k) => g.filter((c) => kind(c) === k && !FROZEN.includes(c)).length);
        hitKind = counts.indexOf(Math.max(...counts));
      }
      g.forEach((c, j) => { if (kind(c) === hitKind && !FROZEN.includes(c)) out.add(j); });
      out.add(i);
    }
    return out;
  }
  // grow `clear` with every special inside it, chaining; each one that goes off is noted for the effects
  function explode(clear, fired, fx) {
    const todo = [...clear], done = new Set();
    while (todo.length) {
      const i = todo.pop();
      if (done.has(i)) continue;
      done.add(i);
      const sp = special(g[i]);
      if (sp) {
        fired.push({ h: 'beam', v: 'beam', n: 'nova', p: 'prism' }[sp]);
        const area = blastArea(i, sp);
        fx.push({ sp, i, ch: g[i], area: [...area] });
        for (const j of area) if (!done.has(j)) todo.push(j);
      }
      clear.add(i);
    }
    return clear;
  }
  // clear cells; frozen gems thaw and stones break instead (also next to anything cleared)
  function remove(clear, step, created, out) {
    let pts = 0;
    const hits = new Set(clear);
    for (const i of clear) for (const j of neighbours(i)) hits.add(j);
    for (const i of hits) {
      const ch = g[i];
      if (FROZEN.includes(ch)) { g[i] = PLAIN[FROZEN.indexOf(ch)]; out.thawed.push(i); }
      else if (ch === STONE) { g[i] = EMPTY; pts += STONE_PTS * step; out.broke.push(i); }
      else if (clear.has(i) && ch !== EMPTY) { out.popped.push([i, ch]); g[i] = EMPTY; pts += GEM_PTS * step; }
    }
    for (const [ch, spot] of created) {
      g[spot] = ch;
      out.born.push([spot, ch]);
      pts += MAKE_PTS[ch === PRISM ? 'prism' : NOVA.includes(ch) ? 'nova' : 'beam'] * step;
    }
    return pts;
  }
  // gravity with refill: returns how far each cell's gem fell (new gems fall in from above the board)
  function gravity() {
    const drop = Array(N * N).fill(0);
    for (let x = 0; x < N; x++) {
      const col = [];
      for (let y = 0; y < N; y++) if (g[y * N + x] !== EMPTY) col.push([g[y * N + x], y]);
      const gaps = N - col.length;
      const full = Array.from({ length: gaps }, (_, k) => [newGem(), k - gaps]).concat(col);
      full.forEach(([ch, from], y) => { g[y * N + x] = ch; drop[y * N + x] = y - from; });
    }
    return drop;
  }
  function lined(i) {
    const ch = g[i];
    if (!matchable(ch)) return false;
    const k = kind(ch), x = i % N, y = (i / N) | 0;
    const same = (xx, yy) => xx >= 0 && xx < N && yy >= 0 && yy < N && matchable(g[yy * N + xx]) && kind(g[yy * N + xx]) === k;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      let n = 1, t = 1;
      while (same(x + dx * t, y + dy * t)) { n++; t++; }
      t = 1;
      while (same(x - dx * t, y - dy * t)) { n++; t++; }
      if (n >= 3) return true;
    }
    return false;
  }
  function swapKind(a, b) {
    if (!neighbours(a).includes(b) || !movable(a) || !movable(b)) return null;
    const sa = special(g[a]), sb = special(g[b]);
    if (sa && sb) return 'combo';
    if (sa === 'p' || sb === 'p') return 'prism';
    [g[a], g[b]] = [g[b], g[a]];
    const ok = lined(a) || lined(b);
    [g[a], g[b]] = [g[b], g[a]];
    return ok ? 'match' : null;
  }
  function moves() {
    const out = [];
    for (let i = 0; i < N * N; i++) for (const j of [i + 1, i + N]) {
      if ((j === i + 1 && i % N === N - 1) || j >= N * N) continue;
      if (swapKind(i, j)) out.push([i, j]);
    }
    return out;
  }
  function shuffle() {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (attempt === 40) g = g.map((c) => FROZEN.includes(c) ? PLAIN[FROZEN.indexOf(c)] : c === STONE ? newGem() : c);
      const loose = g.map((_, i) => i).filter(movable), vals = loose.map((i) => g[i]);
      for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
      loose.forEach((i, k) => { g[i] = vals[k]; });
      if (!runs().length && moves().length) return;
    }
    g = g.map(() => newGem());
  }

  // ---------- look
  const COLORS = [   // base, light, dark: ruby ▲, sapphire ◆, emerald ■, topaz ●, amethyst ⬢, pearl ★
    ['#ff3b5c', '#ffd0d8', '#7d0b25'], ['#2f7bff', '#c7dcff', '#0a2670'], ['#16c66b', '#c0f7da', '#05542c'],
    ['#ffb21a', '#fff2c0', '#8a4f00'], ['#a64dff', '#ead3ff', '#46108a'], ['#e3e7f5', '#ffffff', '#7d84a3'],
  ];
  const GLYPH = ['▲', '◆', '■', '●', '⬢', '★'];
  const HEAT = ['#ffffff', '#ffffff', '#8be9ff', '#9dff8a', '#ffd166', '#ff8a3d', '#ff4d6d', '#ff5cf4'];
  const $ = (id) => document.getElementById(id);

  let S, ctx, st = null, cv = null, c2 = null, dpr = 1, cs = 40, size = 320, sprites = [], stoneSprite = null, specSprites = { h: [], v: [], n: [] };
  let attackQueue = [], attackTimer = 0;
  let raf = 0, resizeObs = null, keyHandler = null, clock = null, hintTimer = null;
  let renderVisible = true, viewIntersecting = true, viewObs = null, visibilityHandler = null;

  // the outline of gem k as points (a circle as 16), for cutting facets (#138)
  function shapeVerts(k, cx, cy, r) {
    const poly = (n, rad, rot) => Array.from({ length: n }, (_, t) => [cx + Math.cos(rot + t * 2 * Math.PI / n) * rad, cy + Math.sin(rot + t * 2 * Math.PI / n) * rad]);
    if (k === 0) return poly(3, r * 1.12, -Math.PI / 2);
    if (k === 1) return [[cx, cy - r * 1.05], [cx + r * 0.85, cy], [cx, cy + r * 1.05], [cx - r * 0.85, cy]];
    if (k === 2) return poly(8, r * 0.98, Math.PI / 8);
    if (k === 3) return poly(16, r * 0.9, 0);
    if (k === 4) return poly(6, r * 0.98, 0);
    return Array.from({ length: 10 }, (_, t) => { const a = -Math.PI / 2 + t * Math.PI / 5, rad = t % 2 ? r * 0.52 : r * 1.05; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; });
  }
  function shapePath(p, k, cx, cy, r) {
    p.beginPath();
    const poly = (n, rad, rot, sy = 1) => { for (let t = 0; t < n; t++) { const a = rot + t * 2 * Math.PI / n; p[t ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * sy); } p.closePath(); };
    if (k === 0) { poly(3, r * 1.12, -Math.PI / 2); }
    else if (k === 1) { p.moveTo(cx, cy - r * 1.05); p.lineTo(cx + r * 0.85, cy); p.lineTo(cx, cy + r * 1.05); p.lineTo(cx - r * 0.85, cy); p.closePath(); }
    else if (k === 2) { poly(8, r * 0.98, Math.PI / 8); }
    else if (k === 3) { p.arc(cx, cy, r * 0.9, 0, Math.PI * 2); }
    else if (k === 4) { poly(6, r * 0.98, 0); }
    else { for (let t = 0; t < 10; t++) { const a = -Math.PI / 2 + t * Math.PI / 5, rad = t % 2 ? r * 0.52 : r * 1.05; p[t ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } p.closePath(); }
  }
  // one sprite per gem colour: a faceted, lit gem with a glint and a soft shadow
  function buildSprites() {
    sprites = [];
    const s = Math.max(8, Math.round(cs));
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas'); c.width = c.height = s;
      const p = c.getContext('2d');
      if (!p) { sprites = []; return; }
      const [base, light, dark] = COLORS[k], cx = s / 2, cy = s / 2 + (k === 0 ? s * 0.05 : 0), r = s * 0.36;
      p.save();
      p.shadowColor = 'rgba(0,0,0,0.5)'; p.shadowBlur = s * 0.09; p.shadowOffsetY = s * 0.05;
      shapePath(p, k, cx, cy, r);
      const grad = p.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.08, cx, cy, r * 1.25);
      grad.addColorStop(0, light); grad.addColorStop(0.45, base); grad.addColorStop(1, dark);
      p.fillStyle = grad; p.fill();
      p.restore();
      p.lineWidth = Math.max(1, s * 0.03); p.strokeStyle = dark; shapePath(p, k, cx, cy, r); p.stroke();
      // #138 cut facets: the crown is a ring of facets from the rim to a smaller table, each lit by how much it faces
      // the light (up and to the left), then the table itself, bright, and a soft glow inside the stone
      const outer = shapeVerts(k, cx, cy, r), tx = cx - r * 0.05, ty = cy - r * 0.07;
      const inner = outer.map(([x, y]) => [tx + (x - cx) * 0.52, ty + (y - cy) * 0.52]);
      p.save(); shapePath(p, k, cx, cy, r); p.clip();
      for (let t = 0; t < outer.length; t++) {
        const a = outer[t], b = outer[(t + 1) % outer.length], c = inner[(t + 1) % outer.length], d = inner[t];
        const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy, len = Math.hypot(mx, my) || 1;
        const lit = (-mx * 0.6 - my * 0.8) / len;   // 1 facing the light, -1 facing away
        p.globalAlpha = 0.16 + 0.34 * Math.abs(lit); p.fillStyle = lit > 0 ? light : dark;
        p.beginPath(); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(c[0], c[1]); p.lineTo(d[0], d[1]); p.closePath(); p.fill();
        p.globalAlpha = 0.22; p.strokeStyle = '#fff'; p.lineWidth = Math.max(0.6, s * 0.01); p.stroke();
      }
      const tg = p.createLinearGradient(tx - r * 0.5, ty - r * 0.5, tx + r * 0.5, ty + r * 0.5);
      tg.addColorStop(0, light); tg.addColorStop(1, base);
      p.globalAlpha = 0.7; p.fillStyle = tg; p.beginPath(); inner.forEach(([x, y], t) => p[t ? 'lineTo' : 'moveTo'](x, y)); p.closePath(); p.fill();
      const ig = p.createRadialGradient(cx + r * 0.2, cy + r * 0.3, 0, cx + r * 0.2, cy + r * 0.3, r * 0.7);
      ig.addColorStop(0, 'rgba(255,255,255,.35)'); ig.addColorStop(1, 'rgba(255,255,255,0)');
      p.globalAlpha = 1; p.fillStyle = ig; p.fillRect(0, 0, s, s);
      p.restore();
      // a bright rim along the edges that catch the light
      p.save(); p.lineWidth = Math.max(1, s * 0.022); p.strokeStyle = 'rgba(255,255,255,.55)';
      for (let t = 0; t < outer.length; t++) {
        const a = outer[t], b = outer[(t + 1) % outer.length], mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
        if (-mx * 0.6 - my * 0.8 > r * 0.25) { p.beginPath(); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.stroke(); }
      }
      p.restore();
      // glint
      p.globalAlpha = 0.85; p.fillStyle = '#fff';
      p.beginPath(); p.ellipse(cx - r * 0.38, cy - r * 0.42, r * 0.2, r * 0.11, -0.7, 0, Math.PI * 2); p.fill();
      p.globalAlpha = 0.6; p.beginPath(); p.arc(cx - r * 0.12, cy - r * 0.62, r * 0.06, 0, Math.PI * 2); p.fill();
      sprites.push(c);
    }
    const c = document.createElement('canvas'); c.width = c.height = s;
    const p = c.getContext('2d');
    p.save(); p.shadowColor = 'rgba(0,0,0,0.55)'; p.shadowBlur = s * 0.08; p.shadowOffsetY = s * 0.05;
    p.beginPath();
    for (let t = 0; t < 9; t++) { const a = t * 2 * Math.PI / 9, rad = s * (0.37 + ((t * 7) % 3) * 0.025); p[t ? 'lineTo' : 'moveTo'](s / 2 + Math.cos(a) * rad, s / 2 + Math.sin(a) * rad); }
    p.closePath();
    const sg = p.createRadialGradient(s * 0.38, s * 0.35, s * 0.05, s / 2, s / 2, s * 0.5);
    sg.addColorStop(0, '#b9b3ad'); sg.addColorStop(0.6, '#77706b'); sg.addColorStop(1, '#3d3835');
    p.fillStyle = sg; p.fill(); p.restore();
    p.fillStyle = 'rgba(40,35,32,0.5)';
    [[0.4, 0.58, 0.06], [0.62, 0.44, 0.05], [0.55, 0.66, 0.035]].forEach(([x, y, r]) => { p.beginPath(); p.arc(s * x, s * y, s * r, 0, Math.PI * 2); p.fill(); });
    stoneSprite = c;
    // ⚡ beams: a bright band with arrow tips across the gem; 💥 novas: a white star core in a ring
    specSprites = { h: [], v: [], n: [] };
    for (let k = 0; k < 6; k++) {
      const [base, light, dark] = COLORS[k];
      for (const sp of ['h', 'v']) {
        const b = document.createElement('canvas'); b.width = b.height = s;
        const q = b.getContext('2d');
        q.drawImage(sprites[k], 0, 0);
        q.translate(s / 2, s / 2); if (sp === 'v') q.rotate(Math.PI / 2);
        const w = s * 0.44, h = s * 0.13;
        const band = q.createLinearGradient(0, -h, 0, h);
        band.addColorStop(0, light); band.addColorStop(0.5, '#ffffff'); band.addColorStop(1, light);
        q.fillStyle = band; q.strokeStyle = dark; q.lineWidth = Math.max(1, s * 0.02);
        q.beginPath(); q.moveTo(-w, 0); q.lineTo(-w + h * 1.3, -h); q.lineTo(w - h * 1.3, -h); q.lineTo(w, 0); q.lineTo(w - h * 1.3, h); q.lineTo(-w + h * 1.3, h); q.closePath();
        q.fill(); q.stroke();
        q.fillStyle = base; q.globalAlpha = 0.8;
        for (const t of [-0.5, 0, 0.5]) { q.beginPath(); q.moveTo(w * t + h * 0.45, 0); q.lineTo(w * t - h * 0.2, -h * 0.6); q.lineTo(w * t - h * 0.2, h * 0.6); q.closePath(); q.fill(); }
        specSprites[sp].push(b);
      }
      const n = document.createElement('canvas'); n.width = n.height = s;
      const q = n.getContext('2d');
      q.drawImage(sprites[k], 0, 0);
      const cx = s / 2, cy = s / 2, glow = q.createRadialGradient(cx, cy, 0, cx, cy, s * 0.3);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.35, light); glow.addColorStop(1, 'rgba(255,255,255,0)');
      q.fillStyle = glow; q.beginPath(); q.arc(cx, cy, s * 0.3, 0, Math.PI * 2); q.fill();
      q.fillStyle = '#fff'; q.beginPath();
      for (let t = 0; t < 16; t++) { const a = -Math.PI / 2 + t * Math.PI / 8, r = t % 2 ? s * 0.07 : s * (t % 4 ? 0.15 : 0.22); q[t ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      q.closePath(); q.fill();
      q.strokeStyle = dark; q.lineWidth = Math.max(1, s * 0.025); q.beginPath(); q.arc(cx, cy, s * 0.4, 0, Math.PI * 2); q.stroke();
      q.strokeStyle = light; q.lineWidth = Math.max(1, s * 0.015); q.stroke();
      specSprites.n.push(n);
    }
  }

  // ---------- animation state
  const vis = () => Array.from({ length: N * N }, () => ({ ox: 0, oy: 0, sx: 0, sy: 0, lx: 0, ly: 0, tx: 0, ty: 0, vy: 0, land: 0, born: 0, ice: 0 }));
  let cells = vis();
  let pops = [], fx = [], pfx = Fx2D.create({ cap: 320 }), sel = null, cursor = null, hint = null, lastAct = 0;
  let falling = null, swapAnim = null;
  const motion = () => (typeof motionOK === 'function' ? motionOK() : true);
  // the large view plays swaps, falls and cascades at two thirds of the phone's speed, so they can be followed
  const pace = () => (window.matchMedia?.('(min-width: 861px)')?.matches ? 1.5 : 1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, motion() ? ms : Math.min(ms, 60)));
  const cellXY = (i) => [(i % N + 0.5) * cs, (((i / N) | 0) + 0.5) * cs];
  const now = () => performance.now();

  function burstParts(i, ch, big = 1) {
    if (!c2) return;
    const [x, y] = cellXY(i), k = kind(ch), col = k == null ? ['#bbb', '#fff', '#555'] : COLORS[k];
    pfx.burst(x, y, Math.round(10 * big), { colors: [col[0], col[0], col[1]], speed: [cs * 2.5 * big, cs * 7 * big], up: cs * 2, gravity: cs * 22, drag: 0.9,
      size: [cs * 0.07, cs * 0.15], life: [0.5, 0.95] });
    pfx.spark(x, y, Math.round(5 * big), { color: col[1], speed: [cs, cs * 3.5], size: [cs * 0.05, cs * 0.11] });
  }
  function iceParts(i, color = '#d8f3ff') {
    const [x, y] = cellXY(i);
    pfx.burst(x, y, 9, { color, speed: [cs * 2, cs * 5], up: cs, gravity: cs * 22, size: cs * 0.09, life: 0.55, spin: 8 });
  }
  function floatText(i, text, step) {
    const [x, y] = Array.isArray(i) ? i : cellXY(i);
    pfx.text(x, y, text, { color: HEAT[Math.min(step, HEAT.length - 1)], size: cs * 0.42, big: step >= 3 ? 1.35 : 1, rise: cs * 0.9 });
  }
  function doShake(n) { pfx.shake(cs * 0.12 * n); }

  // ---------- drawing
  function drawGem(p, ch, x, y, scale, t, i) {
    const half = cs * scale / 2;
    if (ch === EMPTY) return;
    if (ch === STONE) { if (stoneSprite) p.drawImage(stoneSprite, x - half, y - half, cs * scale, cs * scale); return; }
    if (ch === PRISM) { drawPrism(p, x, y, cs * 0.36 * scale, t); return; }
    const k = kind(ch), sp = special(ch), [base, light] = COLORS[k];
    const sprite = (sp && specSprites[sp]?.[k]) || sprites[k];
    if (sprite) p.drawImage(sprite, x - half, y - half, cs * scale, cs * scale);
    // #138 now and then a glint runs across a gem
    const gp = ((t / 1000 + ((i * 2654435761) >>> 0) % 997 / 97) % 7) / 0.45;
    if (gp < 1 && i != null) {
      p.save(); p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.55 * Math.sin(Math.PI * gp);
      p.fillStyle = '#fff'; p.beginPath(); p.ellipse(x - half * 0.6 + gp * half * 1.2, y - half * 0.6 + gp * half * 1.2, cs * 0.05 * scale, cs * 0.16 * scale, -Math.PI / 4, 0, Math.PI * 2); p.fill();
      p.restore();
    }
    if (sp === 'h' || sp === 'v') {
      // a light pulse running along the band
      p.save(); p.translate(x, y); if (sp === 'v') p.rotate(Math.PI / 2);
      const w = cs * 0.42 * scale, run = ((t / 500 + i * 0.13) % 1) * 2 - 1;
      p.globalCompositeOperation = 'lighter';
      const g2 = p.createRadialGradient(run * w, 0, 0, run * w, 0, cs * 0.2 * scale);
      g2.addColorStop(0, 'rgba(255,255,255,0.8)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
      p.fillStyle = g2; p.fillRect(-w, -cs * 0.2 * scale, w * 2, cs * 0.4 * scale);
      p.restore();
    } else if (sp === 'n') {
      const pulse = 0.5 + 0.5 * Math.sin(t / 220 + i);
      p.save(); p.globalCompositeOperation = 'lighter';
      p.strokeStyle = light; p.globalAlpha = 0.45 + 0.4 * pulse; p.lineWidth = cs * 0.05;
      p.beginPath(); p.arc(x, y, cs * (0.4 + 0.05 * pulse) * scale, 0, Math.PI * 2); p.stroke();
      p.fillStyle = '#fff';
      for (let s = 0; s < 4; s++) { const a = t / 500 + s * Math.PI / 2; p.beginPath(); p.arc(x + Math.cos(a) * cs * 0.42 * scale, y + Math.sin(a) * cs * 0.42 * scale, cs * 0.035, 0, Math.PI * 2); p.fill(); }
      p.restore();
    }
    if (sp) {
      const badge = sp === 'h' || sp === 'v' ? '⚡' : '✦';
      p.save(); p.font = `900 ${Math.max(9, cs * 0.22 * scale)}px sans-serif`; p.textAlign = 'right'; p.textBaseline = 'top';
      p.lineWidth = Math.max(2, cs * 0.055); p.strokeStyle = 'rgba(20,12,35,.9)'; p.fillStyle = '#fff';
      p.strokeText(badge, x + half * 0.68, y - half * 0.72); p.fillText(badge, x + half * 0.68, y - half * 0.72); p.restore();
    }
    void base;
  }
  function drawPrism(p, x, y, r, t) {
    p.save();
    p.shadowColor = 'rgba(255,255,255,0.6)'; p.shadowBlur = r * 0.6;
    let fill;
    if (p.createConicGradient) {
      fill = p.createConicGradient(t / 600, x, y);
      ['#ff4d6d', '#ffb21a', '#fff36b', '#16c66b', '#2fd0ff', '#2f7bff', '#a64dff', '#ff4d6d'].forEach((c, k, a) => fill.addColorStop(k / (a.length - 1), c));
    } else {
      fill = p.createLinearGradient(x - r, y - r, x + r, y + r);
      ['#ff4d6d', '#ffb21a', '#16c66b', '#2f7bff', '#a64dff'].forEach((c, k, a) => fill.addColorStop(k / (a.length - 1), c));
    }
    p.fillStyle = fill; p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.fill();
    p.shadowBlur = 0;
    const shine = p.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
    shine.addColorStop(0, 'rgba(255,255,255,0.95)'); shine.addColorStop(0.35, 'rgba(255,255,255,0.15)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
    p.fillStyle = shine; p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.fill();
    p.strokeStyle = 'rgba(255,255,255,0.85)'; p.lineWidth = r * 0.1; p.stroke();
    p.restore();
  }
  function drawIce(p, x, y, grow) {
    const h = cs * 0.46 * grow;
    p.save();
    p.fillStyle = 'rgba(170,225,255,0.42)'; p.strokeStyle = 'rgba(235,250,255,0.9)'; p.lineWidth = Math.max(1, cs * 0.035);
    p.beginPath();
    if (p.roundRect) p.roundRect(x - h, y - h, h * 2, h * 2, cs * 0.12); else p.rect(x - h, y - h, h * 2, h * 2);
    p.fill(); p.stroke();
    p.strokeStyle = 'rgba(255,255,255,0.7)'; p.lineWidth = Math.max(1, cs * 0.02);
    p.beginPath(); p.moveTo(x - h * 0.7, y - h * 0.2); p.lineTo(x - h * 0.2, y - h * 0.7); p.moveTo(x - h * 0.6, y + h * 0.3); p.lineTo(x + h * 0.3, y - h * 0.6); p.stroke();
    p.restore();
  }
  let bgCache = null, bgTheme = null, motes = [];
  function drawBoardBg(p) {
    const th = theme();
    if (!bgCache || bgCache.width !== cv.width || bgTheme !== th) {
      bgTheme = th;
      $('pzStage')?.style.setProperty('--pz-glow', th.glow);
      bgCache = document.createElement('canvas'); bgCache.width = cv.width; bgCache.height = cv.height;
      const b = bgCache.getContext('2d');
      if (b) {
        const grad = b.createLinearGradient(0, 0, cv.width, cv.height);
        grad.addColorStop(0, th.bg[0]); grad.addColorStop(1, th.bg[1]);
        b.fillStyle = grad; b.fillRect(0, 0, cv.width, cv.height);
        for (let i = 0; i < N * N; i++) {
          const x = (i % N) * cs, y = ((i / N) | 0) * cs;
          b.fillStyle = (i % N + ((i / N) | 0)) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.075)';
          b.beginPath();
          if (b.roundRect) b.roundRect(x + cs * 0.04, y + cs * 0.04, cs * 0.92, cs * 0.92, cs * 0.14); else b.rect(x + cs * 0.04, y + cs * 0.04, cs * 0.92, cs * 0.92);
          b.fill();
        }
      }
    }
    p.drawImage(bgCache, 0, 0);
  }
  // drifting light motes behind the gems (the board is never quite still)
  function drawMotes(p, t, dt) {
    if (!motion() || window.gfxLevel?.() === 'low') return;
    if (motes.length !== 24) {
      motes = Array.from({ length: 24 }, () => ({ x: Math.random(), y: Math.random(), r: 0.02 + Math.random() * 0.05,
        vx: (Math.random() - 0.5) * 0.02, vy: -0.01 - Math.random() * 0.025, ph: Math.random() * 6 }));
    }
    const fever = st && now() < st.fever.until;
    p.save(); p.globalCompositeOperation = 'lighter'; p.fillStyle = fever ? '#ff8fd8' : bgTheme?.mote || '#fff';
    for (const m of motes) {
      m.x += m.vx * dt * (fever ? 4 : 1); m.y += m.vy * dt * (fever ? 4 : 1);
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      if (m.x < -0.05) m.x = 1.05; else if (m.x > 1.05) m.x = -0.05;
      p.globalAlpha = 0.12 + 0.12 * Math.sin(t / 700 + m.ph);
      p.beginPath(); p.arc(m.x * cv.width, m.y * cv.height, m.r * cs, 0, Math.PI * 2); p.fill();
    }
    p.restore();
  }
  // a 4-point star glint
  function glint(p, x, y, r, a) {
    p.save(); p.globalCompositeOperation = 'lighter'; p.globalAlpha = a; p.fillStyle = '#fff';
    p.beginPath(); p.moveTo(x, y - r); p.quadraticCurveTo(x, y, x + r, y); p.quadraticCurveTo(x, y, x, y + r);
    p.quadraticCurveTo(x, y, x - r, y); p.quadraticCurveTo(x, y, x, y - r); p.fill(); p.restore();
  }

  function frame(t) {
    raf = 0;
    if (!st || !c2) return;
    const dt = Math.min(0.05, (t - (st.lastT || t)) / 1000);
    st.lastT = t;
    let busy = false;
    // falling gems: gravity, then a little squash when they land
    if (falling) {
      let moving = false;
      for (const c of cells) {
        if (c.oy < 0) {
          c.vy += 38 / pace() ** 2 * dt; c.oy = Math.min(0, c.oy + c.vy * dt);
          if (c.oy === 0) { c.vy = 0; c.land = t; } else moving = true;
        }
      }
      if (!moving) { const done = falling; falling = null; done(); }
      busy = true;
    }
    // drag offsets glide to their targets, so a short release or a change of direction never jumps
    if (leaning.length && st.busy && !leaning.every(still)) drop();
    const eased = (tau) => 1 - Math.exp(-Math.max(0, Math.min(dt, 0.034)) / tau);
    const held = eased(0.016), home = eased(0.045 * pace());   // under the finger they keep right up; let go, they glide back
    for (const c of cells) {
      if (c.lx === c.tx && c.ly === c.ty) continue;
      const glide = c.tx || c.ty ? held : home;
      c.lx += (c.tx - c.lx) * glide; c.ly += (c.ty - c.ly) * glide;
      if (Math.abs(c.tx - c.lx) + Math.abs(c.ty - c.ly) < 0.004) { c.lx = c.tx; c.ly = c.ty; }
      busy = true;
    }
    const p = c2;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, cv.width, cv.height);
    if (pfx.step(dt)) busy = true;
    pfx.begin(p);
    drawBoardBg(p);
    drawMotes(p, t, dt);
    // a slow diagonal sheen across the board while things are moving
    const ambient = motion() && window.gfxLevel?.() !== 'low';
    if (ambient) {
      const sx = ((t / 9) % (cv.width * 3)) - cv.width;
      const sheen = p.createLinearGradient(sx, 0, sx + cv.width * 0.5, cv.height);
      sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.035)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      p.fillStyle = sheen; p.fillRect(0, 0, cv.width, cv.height);
    }
    // hint shimmer and selection glow
    const glowAt = (i, color, a) => {
      const [x, y] = cellXY(i);
      const rg = p.createRadialGradient(x, y, cs * 0.1, x, y, cs * 0.62);
      rg.addColorStop(0, color.replace('A', a)); rg.addColorStop(1, color.replace('A', 0));
      p.fillStyle = rg; p.fillRect(x - cs * 0.62, y - cs * 0.62, cs * 1.24, cs * 1.24);
    };
    if (hint) { const a = 0.25 + 0.25 * Math.sin(t / 180); hint.forEach((i) => glowAt(i, 'rgba(255,255,255,A)', a)); }
    if (sel != null) {
      glowAt(sel, 'rgba(255,230,140,A)', 0.4 + 0.2 * Math.sin(t / 120));
      const [x, y] = cellXY(sel);
      p.save(); p.strokeStyle = '#ffe48c'; p.lineWidth = Math.max(2, cs * 0.05); p.setLineDash([cs * 0.16, cs * 0.1]); p.lineDashOffset = -t / 30;
      p.beginPath(); p.arc(x, y, cs * 0.47, 0, Math.PI * 2); p.stroke(); p.restore();
      for (const j of neighbours(sel)) if (swapKind(sel, j)) {
        const [nx, ny] = cellXY(j);
        p.save(); p.globalAlpha = 0.72; p.strokeStyle = '#b9ffd9'; p.lineWidth = Math.max(2, cs * 0.045);
        p.setLineDash([cs * 0.08, cs * 0.08]); p.strokeRect(nx - cs * 0.4, ny - cs * 0.4, cs * 0.8, cs * 0.8); p.restore();
      }
    }
    // gems, the one being dragged last so it passes over the others
    for (let n = 0; n <= N * N; n++) {
      const i = n === N * N ? grab : n === grab ? null : n;
      if (i == null) continue;
      const ch = g[i], c = cells[i];
      if (ch === EMPTY) continue;
      let [x, y] = cellXY(i);
      x += (c.ox + c.sx + c.lx) * cs; y += (c.oy + c.sy + c.ly) * cs;
      let sxs = 1, sys = 1;
      const since = t - c.land;
      const squash = 220 * pace();
      if (c.land && since < squash) { const q = Math.sin(since / squash * Math.PI) * 0.14; sxs = 1 + q; sys = 1 - q; busy = true; }
      const born = t - c.born;
      let scale = 1;
      if (c.born && born < 420) { scale = 1 + 0.35 * Math.sin(born / 420 * Math.PI); busy = true; }
      if (sel === i) scale *= 1.06 + 0.04 * Math.sin(t / 120);
      if (grab === i) {
        scale *= 1.16;
        p.save(); p.fillStyle = '#00000070'; p.beginPath(); p.ellipse(x + cs * 0.05, y + cs * 0.3, cs * 0.34, cs * 0.17, 0, 0, Math.PI * 2); p.fill(); p.restore();
        y -= cs * 0.08;
      }
      p.save();
      p.translate(x, y + (1 - sys) * cs * 0.35); p.scale(sxs, sys);
      drawGem(p, ch, 0, 0, scale, ambient ? t : 0, i);
      if (FROZEN.includes(ch)) { const grow = c.ice ? Math.min(1, (t - c.ice) / 380) : 1; if (grow < 1) busy = true; drawIce(p, 0, 0, 0.6 + 0.4 * grow); }
      p.restore();
      // Specials shimmer on the slower idle cadence; they do not force a continuous frame loop.
    }
    const incomingAt = new Map();
    for (const e of st?.incoming || []) for (const i of e.cells || []) incomingAt.set(i, e.kind);
    if (incomingAt.size) {
      const pulse = 0.72 + 0.18 * Math.sin(t / 110);
      for (const [i, kind_] of incomingAt) {
        const [x, y] = cellXY(i), color = kind_ === 'frost' ? '#83e8ff' : '#e9c7a7';
        p.save(); p.globalAlpha = pulse; p.strokeStyle = color; p.lineWidth = Math.max(2, cs * 0.065);
        p.setLineDash([cs * 0.12, cs * 0.08]); p.lineDashOffset = -t / 22;
        p.strokeRect(x - cs * 0.43, y - cs * 0.43, cs * 0.86, cs * 0.86);
        p.setLineDash([]); p.fillStyle = color; p.font = `900 ${Math.max(10, cs * 0.25)}px sans-serif`;
        p.textAlign = 'right'; p.textBaseline = 'top'; p.fillText(kind_ === 'frost' ? '❄' : '🪨', x + cs * 0.37, y - cs * 0.38);
        p.restore();
      }
      // The incoming marker is refreshed at the idle cadence; the server timer resolves it independently.
    }
    // twinkle: now and then a resting gem catches the light
    if (ambient && st) {
      if (!st.tw || t - st.tw.t0 > 700) {
        const i = Math.floor(Math.random() * N * N);
        st.tw = { i: PLAIN.includes(g[i]) && !cells[i].oy ? i : null, t0: t };
      }
      const k = (t - st.tw.t0) / 320;
      if (st.tw.i != null && k < 1) { const [x, y] = cellXY(st.tw.i); glint(p, x - cs * 0.14, y - cs * 0.16, cs * 0.2 * Math.sin(k * Math.PI), 0.9); }
    }
    // popping gems: swell and burn white, then vanish into shards
    pops = pops.filter((q) => t - q.t0 < q.dur);
    for (const q of pops) {
      const k = Math.max(0, (t - q.t0) / q.dur), [x, y] = cellXY(q.i);
      p.save(); p.globalAlpha = 1 - k;
      drawGem(p, q.ch, x, y, 1 + 0.45 * k, t, q.i);
      p.globalCompositeOperation = 'lighter'; p.globalAlpha = (1 - k) * 0.9;
      const rg = p.createRadialGradient(x, y, 0, x, y, cs * 0.55);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      p.fillStyle = rg; p.beginPath(); p.arc(x, y, cs * 0.55, 0, Math.PI * 2); p.fill();
      p.restore();
      busy = true;
    }
    // blasts: beams, shockwaves, rainbow arcs, births
    fx = fx.filter((f) => t - f.t0 < f.dur);
    for (const f of fx) {
      const k = (t - f.t0) / f.dur;
      p.save(); p.globalCompositeOperation = 'lighter';
      if (f.type === 'beam') {
        const [x, y] = cellXY(f.i), w = cs * 0.8 * (1 - k) + cs * 0.08, reach = Math.min(1, k * 2.4);
        const col = COLORS[f.k ?? 5][0];
        p.globalAlpha = 1 - k * 0.8;
        p.fillStyle = col; p.shadowColor = col; p.shadowBlur = cs * 0.5;
        if (f.dir === 'h') p.fillRect(x - reach * cv.width, y - w / 2, reach * cv.width * 2, w);
        else p.fillRect(x - w / 2, y - reach * cv.height, w, reach * cv.height * 2);
        p.fillStyle = '#fff'; p.shadowBlur = 0;
        if (f.dir === 'h') p.fillRect(x - reach * cv.width, y - w / 6, reach * cv.width * 2, w / 3);
        else p.fillRect(x - w / 6, y - reach * cv.height, w / 3, reach * cv.height * 2);
      } else if (f.type === 'ring') {
        const [x, y] = f.xy || cellXY(f.i), r = cs * f.r * (0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
        p.globalAlpha = 1 - k; p.strokeStyle = f.color; p.lineWidth = cs * 0.22 * (1 - k) + 1;
        p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.stroke();
        p.globalAlpha = (1 - k) * 0.35; p.fillStyle = f.color; p.fill();
      } else if (f.type === 'arc') {
        const [x0, y0] = cellXY(f.i);
        f.to.forEach((j, n) => {
          const [x1, y1] = cellXY(j), part = Math.min(1, k * 2.2 - n * 0.04);
          if (part <= 0) return;
          const mx = (x0 + x1) / 2 + (y1 - y0) * 0.25, my = (y0 + y1) / 2 - (x1 - x0) * 0.25 - cs * 0.6;
          p.globalAlpha = 1 - k; p.strokeStyle = `hsl(${(n * 47 + t / 4) % 360},100%,65%)`; p.lineWidth = cs * 0.09;
          p.beginPath(); p.moveTo(x0, y0);
          const ex = (1 - part) ** 2 * x0 + 2 * (1 - part) * part * mx + part ** 2 * x1, ey = (1 - part) ** 2 * y0 + 2 * (1 - part) * part * my + part ** 2 * y1;
          const cx = x0 + (mx - x0) * part, cy = y0 + (my - y0) * part;
          p.quadraticCurveTo(cx, cy, ex, ey); p.stroke();
        });
      } else if (f.type === 'zap') {
        // lightning through the matched gems, re-jagged every frame
        p.globalAlpha = 1 - k; p.lineJoin = 'round';
        for (const [w, col] of [[cs * 0.09, '#6fd3ff'], [cs * 0.035, '#ffffff']]) {
          p.strokeStyle = col; p.lineWidth = w; p.beginPath();
          f.pts.forEach(([x, y], n) => {
            if (!n) { p.moveTo(x, y); return; }
            const [px, py] = f.pts[n - 1];
            p.lineTo((px + x) / 2 + (Math.random() - 0.5) * cs * 0.35, (py + y) / 2 + (Math.random() - 0.5) * cs * 0.35); p.lineTo(x, y);
          });
          p.stroke();
        }
      } else if (f.type === 'birth') {
        const [x, y] = cellXY(f.i), r = cs * (0.3 + 1.1 * k);
        const rg = p.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k)})`); rg.addColorStop(0.4, f.color); rg.addColorStop(1, 'rgba(0,0,0,0)');
        p.globalAlpha = 1 - k; p.fillStyle = rg; p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.fill();
        for (let s = 0; s < 8; s++) {
          const a = s * Math.PI / 4 + k, l = cs * (0.4 + 1.2 * k);
          p.strokeStyle = '#fff'; p.lineWidth = cs * 0.03; p.beginPath();
          p.moveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5); p.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); p.stroke();
        }
      }
      p.restore();
      busy = true;
    }
    pfx.draw(p);  // shards, sparks and the floating points
    // (#252) a swap that has to wait is marked on its two gems straight away, so the tap visibly registered
    (st.pendingMoves || []).forEach(([a, b], n) => {
      const [x0, y0] = cellXY(a), [x1, y1] = cellXY(b);
      p.save(); p.strokeStyle = '#ffe48c'; p.fillStyle = '#ffe48c2e'; p.lineWidth = Math.max(2, cs * 0.06);
      p.beginPath(); p.rect(Math.min(x0, x1) - cs * 0.45, Math.min(y0, y1) - cs * 0.45, Math.abs(x1 - x0) + cs * 0.9, Math.abs(y1 - y0) + cs * 0.9); p.fill(); p.stroke();
      const bx = Math.max(x0, x1) + cs * 0.31, by = Math.min(y0, y1) - cs * 0.31;
      p.fillStyle = '#ffe48c'; p.beginPath(); p.arc(bx, by, cs * 0.17, 0, Math.PI * 2); p.fill();
      p.fillStyle = '#231a00'; p.font = `900 ${Math.max(9, cs * 0.24)}px sans-serif`; p.textAlign = 'center'; p.textBaseline = 'middle'; p.fillText(String(n + 1), bx, by + 1);
      p.restore();
    });
    // keyboard cursor
    if (cursor != null) {
      const x = (cursor % N) * cs, y = ((cursor / N) | 0) * cs;
      p.save(); p.strokeStyle = 'rgba(255,255,255,0.9)'; p.lineWidth = Math.max(2, cs * 0.05); p.setLineDash([cs * 0.12, cs * 0.08]);
      p.strokeRect(x + cs * 0.06, y + cs * 0.06, cs * 0.88, cs * 0.88); p.restore();
    }
    pfx.end(p);  // the flash
    if (busy || st.busy) kick();
    else if (motion() && !st.over && renderVisible && !document.hidden) {
      clearTimeout(idleT);
      idleT = setTimeout(kick, window.gfxLevel?.() === 'low' ? 500 : 125); // low-cost ambient refresh; no continuous 60 Hz idle loop
    }
  }
  let idleT = 0;
  function kick() { if (!raf && c2 && renderVisible && !document.hidden) { clearTimeout(idleT); raf = requestAnimationFrame(frame); } }

  function updateRenderVisibility() {
    if (!viewObs) {
      const r = $('pzStage')?.getBoundingClientRect();
      viewIntersecting = !r || (r.bottom > 0 && r.top < window.innerHeight);
    }
    renderVisible = !document.hidden && viewIntersecting;
    if (!renderVisible) { cancelAnimationFrame(raf); raf = 0; clearTimeout(idleT); }
    else kick();
  }

  // ---------- moves, step by step with effects
  function waitFall(drop) {
    let any = false;
    drop.forEach((d, i) => { if (d > 0) { cells[i].oy = -d; cells[i].vy = 2 / pace(); any = true; } else { cells[i].oy = 0; } });
    if (!any || !motion() || !c2) { cells.forEach((c) => { c.oy = 0; }); return Promise.resolve(); }
    return new Promise((res) => { falling = res; kick(); });
  }
  function showBlasts(blasts, t) {
    for (const b of blasts) {
      const k = kind(b.ch);
      if (b.sp === 'h' || b.sp === 'v') { fx.push({ type: 'beam', i: b.i, dir: b.sp, k, t0: t, dur: 520 }); ctx.sfx?.('sweep'); }
      else if (b.sp === 'n') { fx.push({ type: 'ring', i: b.i, r: 1.9, color: COLORS[k][0], t0: t, dur: 520 }); doShake(1.2); ctx.sfx?.('boom'); }
      else if (b.sp === 'p') { fx.push({ type: 'arc', i: b.i, to: b.area.filter((j) => j !== b.i).slice(0, 24), t0: t, dur: 700 }); pfx.flash('#fff', 0.35, 700); ctx.sfx?.('tag'); }
    }
  }
  async function animStep(out, step, pts, center) {
    const t = now();
    for (const [i, ch] of out.popped) { pops.push({ i, ch, t0: t + (out.order?.get(i) || 0), dur: 260 * pace() }); }
    const lowG = window.gfxLevel?.() === 'low', more = (lowG ? 0.5 : 1) * (1 + 0.15 * Math.min(step - 1, 5));
    out.popped.forEach(([i, ch], n) => n < 40 && burstParts(i, ch, (out.popped.length > 20 ? 0.6 : 1) * more));
    out.broke.forEach((i) => { burstParts(i, STONE, 1.2); ctx.sfx?.('crack'); });
    out.thawed.forEach((i) => { iceParts(i); ctx.sfx?.('crack'); });
    out.born.forEach(([i, ch]) => {
      cells[i].born = t;
      fx.push({ type: 'birth', i, color: ch === PRISM ? 'rgba(255,255,255,0.5)' : COLORS[kind(ch)][0], t0: t, dur: 600 });
      const label = ch === PRISM ? '🌈 PRISM' : NOVA.includes(ch) ? '💥 NOVA' : '⚡ BEAM';
      pfx.text(...cellXY(i), label, { color: ch === PRISM ? '#fff' : '#ffd166', size: cs * 0.25, big: 1.1, rise: cs * 0.55, ms: 760 });
    });
    if (out.born.length) ctx.sfx?.('pickup');
    if (pts) floatText(center, `+${pts}`, step);
    // #138 the cascade builds: a shock ring in the step's heat colour from the middle of what popped, a ×N that
    // grows with each step, and from ×4 a tinted flash over the board
    if (step >= 2 && c2) {
      const lowG = window.gfxLevel?.() === 'low', hc = HEAT_COL[Math.min(step, HEAT_COL.length - 1)];
      const ci = Array.isArray(center) ? null : center;
      if (ci != null) fx.push({ type: 'ring', i: ci, r: 1.2 + step * 0.45, color: hc, t0: t, dur: 480 + step * 40 });
      const [x, y] = Array.isArray(center) ? center : cellXY(center);
      pfx.text(x, y - cs * 0.55, `×${step}`, { color: hc, size: cs * (0.5 + 0.12 * Math.min(step, 7)), big: 1.4, rise: cs * 1.3 });
      if (!lowG) pfx.spark(x, y, 6 + step * 3, { color: hc, speed: [cs * 2, cs * (4 + step)], size: [cs * 0.05, cs * 0.12] });
      if (step >= 4) pfx.flash(hc, Math.min(0.32, 0.08 * (step - 3)), 500);
    }
    ctx.sfx?.('rise', Math.min(12, step * 2));
    heat(step);
    if (step >= 2 && out.popped.length) buzz?.(step >= 4 ? [30, 20, 50] : 18);
    if (step >= 3) {
      const word = step >= 6 ? 'PRISMATIC!' : step >= 5 ? 'DAZZLING!' : step >= 4 ? 'BRILLIANT!' : 'SPARKLING!';
      try { Kit.callout(`${word} ×${step}`, step >= 5 ? 'gold' : 'good'); } catch {}
      doShake(step - 1.5);
    }
    kick();
    await sleep(260 * pace());
  }
  // the board's frame glows hotter with each cascade step, then cools
  const HEAT_COL = ['', '#7b5cff', '#2fd0ff', '#16c66b', '#ffd166', '#ff8a3d', '#ff4d6d', '#ff5cf4'];
  let heatT = 0;
  function heat(step) {
    const stage = $('pzStage');
    if (!stage || !motion()) return;
    stage.style.setProperty('--pz-heat', HEAT_COL[Math.min(step, HEAT_COL.length - 1)]);
    stage.classList.add('heat');
    clearTimeout(heatT); heatT = setTimeout(() => stage.classList.remove('heat'), 900);
  }
  const centerOf = (list) => {
    if (!list.length) return [cv ? cv.width / 2 : 0, cv ? cv.height / 2 : 0];
    let x = 0, y = 0;
    for (const i of list) { const [a, b] = cellXY(i); x += a; y += b; }
    return [x / list.length, y / list.length];
  };

  const SWAP_AT = 0.4;   // of a cell: let go past this and the two gems swap
  // while a swipe is short of swapping, the gem and the neighbour it's heading for follow the finger or mouse
  let leaning = [], grab = null;   // grab: the gem under the finger or mouse button, drawn picked up
  function unlean() {
    if (!leaning.length) return;
    for (const i of leaning) cells[i].tx = cells[i].ty = 0;
    leaning = []; kick();
  }
  const drop = () => { unlean(); if (grab != null) { grab = null; kick(); } };
  function lean(a, b, k) {
    unlean();
    // mid-cascade, only gems that are sitting still can be dragged (the same ones that can join in)
    if (!motion() || !c2 || (st.busy && !st.open) || !still(a) || !still(b) || !movable(a) || !movable(b)) return;
    const dx = b % N - a % N, dy = ((b / N) | 0) - ((a / N) | 0);
    cells[a].tx = dx * k; cells[a].ty = dy * k; cells[b].tx = -dx * k; cells[b].ty = -dy * k;
    leaning = [a, b]; grab = a; kick();
  }
  // how far (0–1 of a cell) a drag has visibly carried a and b towards each other; the swap animation takes
  // that over, so it starts exactly where the gems are drawn
  function takeLean(a, b) {
    const dx = b % N - a % N, dy = ((b / N) | 0) - ((a / N) | 0);
    const along = (c, sign) => sign * (c.lx * dx + c.ly * dy);
    const from = Math.max(0, Math.min(along(cells[a], 1), along(cells[b], -1)));
    for (const [c, sign] of [[cells[a], 1], [cells[b], -1]]) { c.lx -= sign * dx * from; c.ly -= sign * dy * from; }
    return from;
  }
  // from a standstill a swap eases in and out; mid-drag the gems are already moving, so they only slow down
  const swapEase = (k, from) => from + (1 - from) * (from > 0.15 ? k * (2 - k) : k * k * (3 - 2 * k));

  async function animSwap(a, b, bounce) {
    if (!motion() || !c2) return;
    const ax = a % N, ay = (a / N) | 0, bx = b % N, by = (b / N) | 0;
    const from = takeLean(a, b), t0 = now(), dur = bounce ? 220 * pace() : Math.max(90, 220 * pace() * (1 - from));
    await new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (now() - t0) / dur);
        const e = bounce ? from * (1 - k) + Math.sin(k * Math.PI) * Math.max(0, 0.45 - from / 2) : swapEase(k, from);
        cells[a].ox = (bx - ax) * e; cells[a].oy = (by - ay) * e; cells[b].ox = (ax - bx) * e; cells[b].oy = (ay - by) * e;
        kick();
        if (k < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
    for (const c of [cells[a], cells[b]]) { c.ox = 0; c.oy = 0; }
  }

  // points multiplier: 🔥 fever ×2, the final ⏱ RUSH ×2 (they stack)
  const feverOn = () => !!st && now() < st.fever.until;
  const rushOn = () => !!st && S?.prism?.mode !== 'levels' && st.endAt - now() < RUSH_MS && st.endAt - now() > 0;
  const mult = () => (feverOn() ? 2 : 1) * (rushOn() ? 2 : 1);
  function feverMeter() {
    const f = st.fever, t = now();
    f.meter = Math.max(0, f.meter - FEVER_DRAIN * (t - f.t) / 1000); f.t = t;
    return f.meter;
  }
  // what a move did, for the recap and the level goals
  function track(out) {
    st.stats.popped += out.popped.length;
    if (st.lv?.def.goal === 'colour') st.lv.colour += out.popped.filter(([, ch]) => kind(ch) === st.lv.def.colour).length;
  }

  const MAX_PENDING_MOVES = 4;
  function renderPendingMoves() {
    const badge = $('pzQueue');
    if (!badge) return;
    const n = st?.pendingMoves?.length || 0;
    badge.hidden = !n;
    badge.textContent = n === 1 ? '⌛ Move queued' : `⌛ ${n} moves queued`;
  }
  function queueMove(a, b) {
    if (!st) return;
    const q = st.pendingMoves;
    if (q.length >= MAX_PENDING_MOVES) {
      ctx.sfx?.('wrong');
      return;
    }
    if (q.length && q[q.length - 1][0] === a && q[q.length - 1][1] === b) return;
    q.push([a, b]);
    renderPendingMoves();
    ctx.sfx?.('tick');
    buzz?.(8);
    kick();
  }

  // (#249) match while a cascade plays: a swap of two gems that are sitting still happens at once, and the
  // cascade's next step clears it
  const MAX_JOINS = 6;   // per cascade, so a chain can't hold off incoming attacks for ever
  function still(i) {   // not empty, not falling, and nothing under it is about to drop it
    if (g[i] === EMPTY || cells[i].oy || cells[i].sx || cells[i].sy) return false;
    for (let j = i + N; j < N * N; j += N) if (g[j] === EMPTY) return false;
    return true;
  }
  function joinMove(a, b) {
    if (!st?.open || st.joins >= MAX_JOINS || !canPlay() || (st.lv && st.lv.left <= 0)) return false;
    // a gem already in a line is about to clear: it can't be pulled out
    if (!still(a) || !still(b) || lined(a) || lined(b) || swapKind(a, b) !== 'match') return false;
    [g[a], g[b]] = [g[b], g[a]];
    st.joined.push(a, b);
    st.joins++; st.stats.moves++;
    if (st.lv) { st.lv.left--; renderGoal(); }
    hint = null; lastAct = now();
    ctx.sfx?.('flip');
    slideIn(a, b);
    renderGrid();
    return true;
  }
  // slides on its own offsets (sx, sy): ox and oy belong to the falling gems
  function slideIn(a, b) {
    if (!motion() || !c2) return;
    const dx = b % N - a % N, dy = ((b / N) | 0) - ((a / N) | 0), t0 = now(), A = cells[a], B = cells[b];
    const from = takeLean(a, b), dur = Math.max(80, 200 * pace() * (1 - from));
    const step = () => {
      const left = 1 - swapEase(Math.min(1, (now() - t0) / dur), from);
      A.sx = dx * left; A.sy = dy * left; B.sx = -dx * left; B.sy = -dy * left;
      kick();
      if (left > 0) requestAnimationFrame(step);
    };
    step();
  }
  function joinQueued() {   // swaps that had to wait go in as soon as their gems come to rest
    const before = st.pendingMoves.length;
    st.pendingMoves = st.pendingMoves.filter(([a, b]) => !joinMove(a, b));
    if (st.pendingMoves.length !== before) renderPendingMoves();
  }

  async function runMove(a, b) {
    if (!st || !canPlay()) return;
    if (st.busy) { if (!joinMove(a, b)) queueMove(a, b); return; }
    hint = null; lastAct = now();
    const what = swapKind(a, b);
    st.busy = true;
    try {
      ctx.sfx?.('flip');
      if (!what) { ctx.sfx?.('wrong'); await animSwap(a, b, true); return; }
      if (what === 'combo') { try { Kit.callout('💥 SPECIAL COMBO!', 'gold'); } catch {} }
      else if (what === 'prism') { try { Kit.callout('🌈 PRISM SWEEP!', 'cool'); } catch {} }
      if (st.lv) st.lv.left--;
      const m = mult();
      await animSwap(a, b, false);
      st.joined = []; st.joins = 0; st.open = true;   // from here until the board settles, more swaps can join in
      const fired = [], madeList = [];
      let pts = 0, step = 0;
      if (what === 'prism' || what === 'combo') {
        const sa = special(g[a]), sb = special(g[b]), x = b % N, y = (b / N) | 0;
        let area;
        const blasts = [];
        if (what === 'prism') {
          const prism = sa === 'p' ? a : b, other = prism === a ? b : a;
          area = blastArea(prism, 'p', kind(g[other]));
          blasts.push({ sp: 'p', i: prism, ch: g[prism], area: [...area] });
          g[prism] = EMPTY;
          fired.push('prism');
        } else {
          const pair = new Set([sa, sb]);
          area = new Set();
          const box = (r) => { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (xx >= 0 && xx < N && yy >= 0 && yy < N) area.add(yy * N + xx); };
          if (pair.has('p')) { for (let i = 0; i < N * N; i++) area.add(i); pfx.flash('#fff', 0.8, 700); }
          else if (pair.size === 1 && pair.has('n')) box(2);
          else if (pair.has('n')) { for (let t = 0; t < N; t++) for (let d = -1; d <= 1; d++) { if (x + d >= 0 && x + d < N) area.add(t * N + x + d); if (y + d >= 0 && y + d < N) area.add((y + d) * N + t); } }
          else { for (let t = 0; t < N; t++) { area.add(y * N + t); area.add(t * N + x); } }
          const k = kind(g[a]) ?? kind(g[b]) ?? 5;
          fx.push({ type: 'ring', i: b, r: 3.4, color: COLORS[k][1], t0: now(), dur: 650 });
          fx.push({ type: 'beam', i: b, dir: 'h', k, t0: now(), dur: 560 }, { type: 'beam', i: b, dir: 'v', k, t0: now(), dur: 560 });
          g[a] = g[b] = EMPTY;
          fired.push('combo');
          doShake(3); ctx.sfx?.('boom'); pfx.flash('#fff', 0.4, 700);
        }
        const fxl = [];
        area = explode(area, fired, fxl);
        showBlasts(blasts.concat(fxl), now());
        const out = { popped: [], broke: [], thawed: [], born: [] };
        // a prism blast pops its colour one by one, outward from the prism
        if (what === 'prism') { const pr = blasts[0].i; out.order = new Map([...area].map((j) => [j, Math.hypot(j % N - pr % N, ((j / N) | 0) - ((pr / N) | 0)) * 45])); }
        step = 1;
        const p = remove(area, step, [], out) * m;
        pts += p;
        track(out);
        await animStep(out, step, p, centerOf([...area]));
        if (what === 'prism') await sleep(200);
        await waitFall(gravity());
      } else {
        [g[a], g[b]] = [g[b], g[a]];
      }
      let prefer = [a, b];
      for (;;) {
        joinQueued();
        const gs = groups();
        if (!gs.length) break;
        // your own mid-cascade match scores at the current step: only matches that fall into place raise ×N
        const mine = st.joined.splice(0);
        if (!step || !mine.length || !gs.every((gr) => mine.some((i) => gr.cells.has(i)))) step++;
        prefer = prefer.concat(mine);
        let clear = new Set();
        const created = [];
        for (const gr of gs) {
          const md = made(gr, prefer);
          if (md) { created.push(md); madeList.push(md[0] === PRISM ? 'prism' : NOVA.includes(md[0]) ? 'nova' : 'beam'); }
          gr.cells.forEach((c) => clear.add(c));
          if (motion()) for (const [run] of gr.runs) fx.push({ type: 'zap', pts: run.map(cellXY), t0: now(), dur: 200 });
        }
        const fxl = [];
        clear = explode(clear, fired, fxl);
        showBlasts(fxl, now());
        const out = { popped: [], broke: [], thawed: [], born: [] };
        const p = remove(clear, step, created, out) * m;
        pts += p;
        track(out);
        await animStep(out, step, p, centerOf([...clear]));
        await waitFall(gravity());
        prefer = [];
      }
      st.open = false;
      if (!moves().length) await reshuffle();
      st.score += pts;
      scoreTo(st.score);
      if (!st.lv) renderStanding(Object.entries(S.prism.boards).sort((x, y) => y[1].score - x[1].score));
      afterMove(step, fired, madeList);
      push();
      if (step >= 3 || fired.length || madeList.length) {
        const [frost, stones] = S?.prism?.attacks && Object.keys(S.prism.boards).length > 1 ? attackFor(step, fired) : [0, 0];
        const burst = { cascade: step, specials: fired, made: madeList };
        const sends = (frost || stones) && now() >= (st.attackAt || 0);
        if (sends) {
          st.attackAt = now() + 5000;
          queueTarget(burst);
          st.stats.sent += frost + stones;
          const w = [frost && `🧊×${frost}`, stones && `🪨×${stones}`].filter(Boolean).join(' ');
          try { Kit.flyText($('pzScore'), `${w} sent!`, 'gold'); } catch {}
          ctx.sfx?.('whoosh');
        } else ctx.quiet(ctx.act('burst', burst));
      }
    } finally {
      if (st) { st.busy = false; st.open = false; flushEvents(); }
      kick();
      armHint();
      const nx = st?.pendingMoves.shift();
      renderPendingMoves();
      if (nx) void runMove(nx[0], nx[1]);
    }
  }

  // Target selection stays outside the board's move loop; attacks resolve in the same order as clears.
  function queueTarget(burst) {
    const rivals = Object.entries(S?.prism?.boards || {}).filter(([id, b]) => id !== S.me.id && b.alive);
    if (rivals.length <= 1) {
      ctx.quiet(ctx.act('burst', { ...burst, ...(rivals.length ? { target: rivals[0][0] } : {}) }));
      return;
    }
    attackQueue.push({ burst, until: now() + 4000 });
    renderTargetPrompt();
  }
  function settleTarget(target) {
    const item = attackQueue.shift();
    if (!item) return;
    clearTimeout(attackTimer);
    if (st) st.attackAt = now() + 5000;
    ctx.quiet(ctx.act('burst', { ...item.burst, ...(target ? { target } : {}) }));
    renderTargetPrompt();
  }
  function renderTargetPrompt() {
    const box = $('pzTarget');
    if (!box) return;
    clearTimeout(attackTimer);
    const item = attackQueue[0];
    box.replaceChildren();
    box.hidden = !item;
    if (!item) return;
    box.append(ctx.el('span', '', '🎯 Send attack to'));
    for (const [id, b] of Object.entries(S?.prism?.boards || {}).filter(([id, b]) => id !== S.me.id && b.alive)) {
      const p = ctx.player(id), btn = ctx.el('button', 'pz-target', `${p?.name ?? 'Rival'} · ${b.score.toLocaleString()}`);
      btn.type = 'button'; btn.setAttribute('aria-label', `Target ${p?.name ?? 'rival'}, score ${b.score}`);
      btn.onclick = () => settleTarget(id);
      box.append(btn);
    }
    const left = Math.max(0, item.until - now());
    box.style.setProperty('--tgt', `${left}ms`); box.classList.remove('go'); void box.offsetWidth; box.classList.add('go');
    attackTimer = setTimeout(() => settleTarget(null), left);
  }

  // after each move: stats, 🔥 fever, 🛡 parry, personal best, 🎯 level goal
  function afterMove(step, fired, madeList) {
    const s = st.stats;
    s.best = Math.max(s.best, step); s.made += madeList.length; s.moves++;
    if (!feverOn() && step >= 1) {
      st.fever.meter = feverMeter() + feverFill(step);
      if (st.fever.meter >= 100) {
        st.fever.meter = 0; st.fever.until = now() + FEVER_MS; s.fevers++;
        try { Kit.callout('🔥 FEVER ×2!', 'gold'); } catch {}
        ctx.sfx?.('fanfare');
      }
    }
    if (bursts(step, fired) && st.incoming.length) parry();
    if (!st.lv && st.pb > 0 && !st.pbShown && st.score > st.pb) {
      st.pbShown = true;
      try { Kit.callout('🏅 New best!', 'gold'); } catch {}
      ctx.sfx?.('pickup');
    }
    if (st.lv) {
      const lv = st.lv;
      lv.made += madeList.length; lv.prisms += madeList.filter((x) => x === 'prism').length;
      renderGoal();
      if (goalProgress() >= lv.def.target) endLevel(true);
      else if (lv.left <= 0) endLevel(false);
    }
    updateHud();
  }

  async function reshuffle() {
    shuffle();
    pfx.flash('#fff', 0.5, 700);
    for (let i = 0; i < N * N; i++) { cells[i].born = now() + Math.random() * 200; }
    floatText([cv ? cv.width / 2 : 0, cv ? cv.height / 2 : 0], 'No moves — shuffle!', 2);
    ctx.sfx?.('whoosh');
    kick();
    await sleep(500);
  }

  // ---------- attacks arriving from rivals
  function flushEvents() {
    if (!st || st.busy || !st.queue.length) return;
    const q = st.queue.splice(0);
    const t = now();
    for (const ev of q) {
      const n = Math.max(0, Math.min(6, ev.n | 0));
      if (ev.kind === 'frost') {
        const spots = Array.isArray(ev.cells)
          ? ev.cells.filter((i) => Number.isInteger(i) && i >= 0 && i < N * N && PLAIN.includes(g[i]))
          : g.map((c, i) => (PLAIN.includes(c) ? i : -1)).filter((i) => i >= 0).sort(() => Math.random() - 0.5).slice(0, n);
        spots.forEach((i) => { g[i] = FROZEN[PLAIN.indexOf(g[i])]; cells[i].ice = t; });
        if (sel != null && FROZEN.includes(g[sel])) sel = null;
        ctx.toast(`🧊 ${ev.from} froze ${spots.length} of your gems! Match next to them to thaw.`);
        ctx.sfx?.('crack'); buzz?.([40, 30, 40]);
      } else if (ev.kind === 'stone') {
        let spots;
        if (Array.isArray(ev.cells)) spots = ev.cells.filter((i) => Number.isInteger(i) && i >= 0 && i < N * N && PLAIN.includes(g[i]));
        else {
          spots = g.map((c, i) => (PLAIN.includes(c) && i < N * 3 ? i : -1)).filter((i) => i >= 0);
          if (!spots.length) spots = g.map((c, i) => (PLAIN.includes(c) ? i : -1)).filter((i) => i >= 0);
          spots = spots.sort(() => Math.random() - 0.5).slice(0, n);
        }
        spots.forEach((i) => { g[i] = STONE; cells[i].oy = -2 - ((i / N) | 0); cells[i].vy = 4 / pace(); });
        if (spots.length && motion() && c2) falling ||= (() => { doShake(2.5); ctx.sfx?.('thud'); });
        else { spots.forEach((i) => { cells[i].oy = 0; }); ctx.sfx?.('thud'); }
        ctx.toast(`🪨 ${ev.from} dropped ${spots.length} stones on you! Match next to them to break them.`);
        buzz?.([60, 40, 60]);
      }
      const ban = $('pzBanner');
      if (ban) { ban.textContent = ev.kind === 'frost' ? `🧊 Frost from ${ev.from}!` : `🪨 Stones from ${ev.from}!`; ban.className = 'pz-hit ' + ev.kind; void ban.offsetWidth; ban.classList.add('on'); }
    }
    if (!moves().length) shuffle();
    hint = null;
    renderGrid();
    push();
    kick();
  }
  // an attack first hangs over the board for PARRY_MS: a ×3 cascade or a special in time shatters it
  function applyEvents(events, land = false) {
    let any = false;
    for (const ev of events) {
      if (ev.id <= st.applied) continue;
      st.applied = ev.id;
      st.incoming.push({ ...ev, at: now() + (land ? 0 : PARRY_MS) });
      st.stats.got += Math.max(0, ev.n | 0);
      any = true;
    }
    try { sessionStorage.setItem(st.appliedKey, st.applied); } catch {}
    if (!any) return;
    renderWarn();
    if (!land) { ctx.sfx?.('tickfast'); buzz?.(25); }
    setTimeout(landDue, land ? 0 : PARRY_MS + 30);
  }
  function landDue() {
    if (!st) return;
    const t = now(), due = st.incoming.filter((e) => e.at <= t);
    if (!due.length) return;
    st.incoming = st.incoming.filter((e) => e.at > t);
    st.queue.push(...due);
    renderWarn();
    flushEvents();
  }
  function parry() {
    const q = st.incoming.splice(0), n = q.reduce((a, e) => a + (e.n | 0), 0);
    st.stats.parried += n;
    renderWarn();
    try { Kit.callout('🛡 PARRIED!', 'good'); } catch {}
    ctx.sfx?.('crack'); buzz?.(30);
    for (let x = 0; x < N; x++) iceParts(x, q.some((e) => e.kind === 'stone') ? '#cfc6bd' : '#d8f3ff');
    ctx.quiet(ctx.act('parry', { n: q.length, from: q.map((e) => e.fromId).filter(Boolean) }));
  }
  function renderWarn() {
    const box = $('pzWarn');
    if (!box) return;
    renderGrid(); kick();
    box.innerHTML = '';
    const t = now();
    for (const e of st.incoming) {
      const chip = ctx.el('div', 'pz-warn-chip ' + e.kind, `${e.kind === 'frost' ? '🧊' : '🪨'}×${e.n} from ${e.from}`);
      const bar = document.createElement('i');
      bar.style.animationDuration = Math.max(0, e.at - t) + 'ms';
      chip.append(bar);
      box.append(chip);
    }
    if (st.incoming.length) box.append(ctx.el('div', 'pz-warn-tip', 'Outlined cells are the exact targets. Chain ×3 or set off a special to shatter the attack.'));
  }

  // ---------- sync with the server
  function push() {
    if (!st || !S?.prism?.playing) return;
    const rows = g.join('');
    if (rows === st.pushed && st.score === st.pushedScore) return;
    st.pushed = rows; st.pushedScore = st.score;
    ctx.quiet(ctx.act('board', { rows, score: st.score }));
  }
  const canPlay = () => !!(S?.prism?.playing && st && !st.over
    && (S.prism.mode === 'levels' ? st.lv && !st.lv.over : now() >= (st.startAt || 0) - 50 && st.endAt - now() > 0));

  let shownScore = 0, scoreRaf = 0;
  function scoreTo(v) {
    const node = $('pzScore');
    if (!node) return;
    cancelAnimationFrame(scoreRaf);
    const from = shownScore, t0 = now();
    const stepF = () => {
      const k = Math.min(1, (now() - t0) / 500);
      shownScore = Math.round(from + (v - from) * (1 - (1 - k) ** 3));
      node.textContent = shownScore.toLocaleString();
      if (k < 1) scoreRaf = requestAnimationFrame(stepF);
    };
    if (!motion()) { shownScore = v; node.textContent = v.toLocaleString(); return; }
    stepF();
    node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump');
  }

  function armHint() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (!st || st.busy || !canPlay() || !S.hintsOk) return;
      const m = moves();
      if (m.length) { hint = m[Math.floor(Math.random() * m.length)]; renderGrid(); kick(); }
    }, 5000);
  }

  // ---------- input
  function tap(i) {
    if (!st || !canPlay()) return;
    lastAct = now(); hint = null; armHint();
    if (sel == null) { if (st.busy || movable(i)) { sel = i; ctx.sfx?.('tick'); } }
    else if (i === sel) sel = null;
    else if (neighbours(sel).includes(i)) { const a = sel; sel = null; runMove(a, i); }
    else sel = st.busy || movable(i) ? i : null;
    renderGrid();
    kick();
  }
  function cellAt(e) {
    const r = cv.getBoundingClientRect();
    if (!r.width) return null;
    const x = Math.floor((e.clientX - r.left) / r.width * N), y = Math.floor((e.clientY - r.top) / r.height * N);
    return x >= 0 && x < N && y >= 0 && y < N ? y * N + x : null;
  }

  // ---------- fallback grid (no canvas)
  function renderGrid() {
    const box = $('pzGrid');
    if (!box || c2) return;
    if (box.children.length !== N * N) {
      box.innerHTML = '';
      for (let i = 0; i < N * N; i++) { const b = document.createElement('button'); b.className = 'pz-cell'; b.dataset.i = i; b.onclick = () => tap(i); box.append(b); }
    }
    [...box.children].forEach((b, i) => {
      const ch = g[i], k = kind(ch), sp = special(ch);
      b.textContent = ch === STONE ? '🪨' : ch === PRISM ? '🌈' : ch === EMPTY ? '' : (sp === 'n' ? '💥' : sp ? (sp === 'h' ? '↔' : '↕') : GLYPH[k]);
      b.style.color = k != null ? COLORS[k][0] : '';
      b.classList.toggle('sel', sel === i);
      b.classList.toggle('hinted', hint?.includes(i) ?? false);
      b.classList.toggle('possible', sel != null && neighbours(sel).includes(i) && !!swapKind(sel, i));
      b.classList.toggle('ice', FROZEN.includes(ch));
      const target = st?.incoming.find((e) => (e.cells || []).includes(i));
      b.classList.toggle('incoming-frost', target?.kind === 'frost');
      b.classList.toggle('incoming-stone', target?.kind === 'stone');
    });
  }

  // ---------- layout
  function resize() {
    if (!cv) return;
    const stage = $('pzStage');
    const w = Math.max(160, Math.floor(stage.clientWidth || 320));
    size = w;
    dpr = Fx2D.fit(cv, size, size);
    cs = cv.width / N;
    bgCache = null;
    buildSprites();
    kick();
  }

  function newState(pz) {
    kinds = pz.kinds || 6;
    const mine = pz.boards[S.me.id];
    const appliedKey = `pz.applied.${S.code || ''}.${pz.seed}`;
    let applied = null, pb = null;
    try { applied = sessionStorage.getItem(appliedKey); } catch {}
    try { pb = Profile.best('prism', S.roundRecord); } catch {}
    st = { seed: pz.seed, score: mine?.score || 0, applied: applied != null ? +applied : Math.max(0, ...pz.events.map((e) => e.id)),
      appliedKey, queue: [], incoming: [], busy: false, pushed: mine?.rows, pushedScore: mine?.score || 0, endAt: now() + pz.timeLeft * 1000, over: false, lastT: 0,
      pendingMoves: [], open: false, joined: [], joins: 0,
      fever: { meter: 0, until: 0, t: now() }, hintAt: 0, pb, pbShown: false, rushShown: false, lv: null,
      stats: { best: 0, popped: 0, made: 0, fevers: 0, sent: 0, got: 0, parried: 0, moves: 0 } };
    rng = mulberry32((pz.seed ^ (st.score * 2654435761)) >>> 0);
    g = (mine?.rows || ''.padEnd(N * N, 'a')).split('');
    if (g.length !== N * N) g = Array(N * N).fill('a');
    if (g.includes(EMPTY)) g = g.map((c) => (c === EMPTY ? newGem() : c));
    if (pz.mode === 'levels' && pz.level) {
      const def = pz.levels[pz.level - 1];
      st.lv = { n: pz.level, def, left: def.moves, frozen0: count(FROZEN), stones0: count(STONE), colour: 0, made: 0, prisms: 0, over: false };
    }
    cells = vis(); pops = []; fx = []; pfx.clear(); sel = null; hint = null; leaning = []; grab = null;
    renderPendingMoves();
    for (const k of Object.keys(prevHits)) delete prevHits[k];
    for (const k of Object.keys(prevScore)) delete prevScore[k];
    shownScore = st.score;
    const sc = $('pzScore'); if (sc) sc.textContent = st.score.toLocaleString();
    const over = $('pzOver'); if (over) { over.hidden = true; over.className = 'pz-over'; over.innerHTML = ''; }
    renderWarn();
    renderGrid();
    renderGoal();
    armHint();
  }
  const count = (chars) => g.filter((c) => chars.includes(c)).length;

  // ---------- 🎯 levels
  function goalTarget() {
    const lv = st.lv;
    return lv.def.goal === 'thaw' ? lv.frozen0 : lv.def.goal === 'stones' ? lv.stones0 : lv.def.target;
  }
  function goalProgress() {
    const lv = st.lv, goal = lv.def.goal;
    const v = goal === 'score' ? st.score : goal === 'colour' ? lv.colour : goal === 'thaw' ? lv.frozen0 - count(FROZEN)
      : goal === 'stones' ? lv.stones0 - count(STONE) : goal === 'make' ? lv.made : lv.prisms;
    return Math.min(goalTarget(), Math.max(0, v));
  }
  function goalLabel(def, target = def.target) {
    const [verb, icon] = GOAL_TEXT[def.goal];
    if (def.goal === 'colour') return `${verb} ${target} ${NAMES[def.colour]} ${GLYPH[def.colour]}`;
    if (def.goal === 'score') return `${verb} ${target.toLocaleString()} ${icon}`;
    if (def.goal === 'make') return `${verb} ${target} specials ${icon}`;
    if (def.goal === 'prism') return `${verb} ${target} prism${target > 1 ? 's' : ''} ${icon}`;
    return `${verb} ${target} ${icon}`;
  }
  function renderGoal() {
    const box = $('pzGoal');
    if (!box) return;
    box.hidden = !st?.lv;
    if (!st?.lv) return;
    const lv = st.lv, have = goalProgress(), want = goalTarget();
    box.innerHTML = '';
    box.append(ctx.el('b', '', `🎯 ${lv.n}`), ctx.el('span', '', goalLabel(lv.def, want)), ctx.el('b', 'pz-goal-n', `${have.toLocaleString()} / ${want.toLocaleString()}`));
    box.style.setProperty('--p', Math.round(100 * have / Math.max(1, want)) + '%');
    if (lv.def.goal === 'colour') box.querySelector('span').style.color = COLORS[lv.def.colour][0];
  }
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  function endLevel(won) {
    const lv = st.lv;
    lv.over = true; sel = null; hint = null;
    renderGrid();
    st.pendingMoves.length = 0; renderPendingMoves();
    const frac = lv.left / lv.def.moves, stars = won ? (frac >= 0.4 ? 3 : frac >= 0.15 ? 2 : 1) : 0;
    const d = pdata(); d.levels ||= {};
    const old = d.levels[lv.n] || 0;
    let xp = 0;
    if (stars > old) { d.levels[lv.n] = stars; xp = 100 * (stars - old); }
    psave(d);
    if (xp) addXP(xp);
    ctx.quiet(ctx.act('levelEnd', { n: lv.n, stars, score: st.score }));
    ctx.sfx?.(won ? 'fanfare' : 'wrong');
    const over = $('pzOver');
    over.hidden = false; over.className = 'pz-over pz-card';
    over.innerHTML = '';
    over.append(ctx.el('h3', '', won ? `🎯 Level ${lv.n} cleared!` : `So close! Level ${lv.n}`));
    if (won) over.append(ctx.el('div', 'pz-stars', starStr(stars)));
    over.append(ctx.el('p', '', won ? `${lv.left} move${lv.left === 1 ? '' : 's'} to spare · ${st.score.toLocaleString()} points`
      : `${goalProgress().toLocaleString()} of ${goalTarget().toLocaleString()} — out of moves`));
    if (xp) over.append(ctx.el('p', 'pz-xpline', `+${xp} XP`));
    const row = ctx.el('div', 'pz-btns');
    const go = (label, cls, fn) => { const b = ctx.el('button', cls, label); b.onclick = fn; row.append(b); return b; };
    if (won && lv.n < S.prism.levels.length) go(`Next ▶`, 'primary', () => ctx.act('level', { n: lv.n + 1 }));
    go('↻ Retry', won ? '' : 'primary', () => ctx.act('level', { n: lv.n }));
    go('🗺 Levels', '', () => ctx.act('map'));
    over.append(row);
    updateHud(); kick();
  }
  function renderMap(pz) {
    const box = $('pzMap');
    if (!box) return;
    box.hidden = !(pz.mode === 'levels' && !pz.level && pz.playing);
    if (box.hidden) return;
    const done = pdata().levels || {};
    box.innerHTML = '';
    const total = Object.values(done).reduce((a, b) => a + b, 0);
    box.append(ctx.el('h3', '', `🎯 Pick a level · ${total}/${pz.levels.length * 3}★`));
    const WORLDS = ['🌱 Sprout', '🌊 Tide', '🔥 Ember', '💎 Crown'];
    pz.levels.forEach((def, k) => {
      const n = k + 1;
      if (k % 6 === 0) box.append(ctx.el('div', 'pz-world', WORLDS[k / 6] || ''));
      const open = n === 1 || (done[n - 1] || 0) > 0 || (done[n] || 0) > 0;
      const b = ctx.el('button', 'pz-lv' + (open ? '' : ' locked') + (done[n] ? ' done' : ''));
      b.append(ctx.el('b', '', open ? String(n) : '🔒'), ctx.el('small', '', done[n] ? starStr(done[n]) : open ? goalLabel(def).replace(/^\S+ /, '') : ''));
      b.title = goalLabel(def) + ` in ${def.moves} moves`;
      b.disabled = !open;
      b.onclick = () => ctx.act('level', { n });
      box.append(b);
    });
  }

  // ---------- 💠 XP and board themes
  function addXP(n) {
    if (!(n > 0)) return;
    const d = pdata(), before = rankOf(d.xp || 0);
    d.xp = (d.xp || 0) + n;
    psave(d);
    const after = rankOf(d.xp);
    if (after > before) {
      const [, name, emo] = RANKS[after];
      setTimeout(() => { try { Kit.callout(`${emo} Rank up: ${name}!`, 'gold'); } catch {} ctx.sfx?.('fanfare'); ctx.toast?.(`${emo} ${name} rank — the ${THEMES[after].name} board is yours. Pick it under the rivals.`); }, 1600);
    }
    renderThemes(); updateHud();
  }
  function renderThemes() {
    const box = $('pzThemes');
    if (!box) return;
    const d = pdata(), r = rankOf(d.xp || 0), cur = THEMES.indexOf(theme());
    box.innerHTML = '';
    box.append(ctx.el('div', 'pz-themes-h', `${RANKS[r][2]} ${RANKS[r][1]} · ${(d.xp || 0).toLocaleString()} XP` + (r < RANKS.length - 1 ? ` · next ${RANKS[r + 1][1]} at ${RANKS[r + 1][0].toLocaleString()}` : '')));
    const row = ctx.el('div', 'pz-swatches');
    THEMES.forEach((th, i) => {
      const b = ctx.el('button', 'pz-swatch' + (i === cur ? ' on' : '') + (i > r ? ' locked' : ''), i > r ? '🔒' : '');
      b.style.background = `linear-gradient(135deg, ${th.bg[0]}, ${th.bg[1]})`;
      b.style.borderColor = th.glow;
      b.title = i > r ? `${th.name}: reach ${RANKS[i][1]} (${RANKS[i][0].toLocaleString()} XP)` : th.name;
      b.setAttribute('aria-label', b.title);
      b.disabled = i > r;
      b.onclick = () => { const dd = pdata(); dd.theme = i; psave(dd); themeNow = null; renderThemes(); kick(); };
      row.append(b);
    });
    box.append(row);
  }

  // ---------- race recap
  function buildRecap(pz, me) {
    const over = $('pzOver');
    if (st.recapped) return;
    st.recapped = true;
    const xp = Math.round(st.score / 10);
    const ranked = Object.entries(pz.boards).sort((a, b) => b[1].score - a[1].score), place = ranked.findIndex(([id]) => id === S.me.id) + 1;
    const ord = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
    over.hidden = false; over.className = 'pz-over pz-card';
    over.innerHTML = '';
    const fold = ctx.el('button', 'pz-fold', '▾');
    fold.title = 'Fold the recap'; fold.setAttribute('aria-label', fold.title);
    fold.onclick = () => { over.classList.toggle('folded'); fold.textContent = over.classList.contains('folded') ? '▴' : '▾'; };
    over.append(fold, ctx.el('h3', '', S.winner === S.me.id ? '🏆 You win!' : ranked.length > 1 ? `⏱️ Time! ${ord(place)} of ${ranked.length}` : '⏱️ Time!'));
    over.append(ctx.el('div', 'pz-big', me.score.toLocaleString()));
    if (st.pb != null && me.score > st.pb) over.append(ctx.el('div', 'pz-xpline', `🏅 New best (was ${st.pb.toLocaleString()})`));
    const s = st.stats, grid = ctx.el('div', 'pz-stats');
    const rows = [['Best cascade', s.best ? `×${s.best}` : '—'], ['Gems popped', s.popped], ['Specials made', s.made], ['🔥 Fevers', s.fevers]];
    if (pz.attacks && ranked.length > 1) rows.push(['Attacks sent', s.sent], ['Attacks taken', s.got], ['🛡 Shattered', s.parried]);
    for (const [k, v] of rows) grid.append(ctx.el('span', '', k), ctx.el('b', '', String(v)));
    over.append(grid);
    // XP once per round, even if the page reloads on the recap
    const d = pdata(), key = `${S.code || ''}.${pz.seed}`, before = d.xp || 0, fresh = d.xpKey !== key;
    if (fresh) { d.xpKey = key; psave(d); addXP(xp); }
    const after = before + (fresh ? xp : 0), r = rankOf(after), lo = RANKS[r][0], hi = RANKS[r + 1]?.[0];
    const bar = ctx.el('div', 'pz-xpbar'); const fill = document.createElement('i');
    fill.style.width = (hi ? Math.round(100 * (after - lo) / (hi - lo)) : 100) + '%'; bar.append(fill);
    over.append(ctx.el('div', 'pz-xpline', `+${xp.toLocaleString()} XP · ${RANKS[r][2]} ${RANKS[r][1]}`), bar);
  }

  // ---------- HUD
  function updateHud() {
    if (!st) return;
    const pz = S?.prism, fe = $('pzFever'), stage = $('pzStage');
    const on = feverOn(), meter = on ? 100 * (st.fever.until - now()) / FEVER_MS : feverMeter();
    if (fe) { fe.firstChild.style.width = Math.max(0, Math.min(100, meter)) + '%'; fe.classList.toggle('on', on); }
    const rush = rushOn() && pz?.playing;
    if (rush && !st.rushShown && !st.over) { st.rushShown = true; try { Kit.callout('⏱ RUSH! ×2', 'gold'); } catch {} ctx.sfx?.('rise', 10); }
    stage?.classList.toggle('fever', on); stage?.classList.toggle('rush', !!rush);
    const m = mult(), mt = $('pzMult');
    if (mt) mt.textContent = m > 1 && canPlay() ? `×${m}` : on ? '🔥' : '';
    const pb = $('pzPB');
    if (pb) pb.textContent = st.lv || pz?.mode === 'levels' ? '' : st.pb ? `best ${st.pb.toLocaleString()}` : '';
    const hb = $('pzHintBtn');
    if (hb) { hb.hidden = !S.hintsOk; const left = st.hintAt - now(); hb.disabled = left > 0 || !canPlay(); hb.style.setProperty('--cd', Math.max(0, left / 15000)); }
    const rk = $('pzRank');
    if (rk) { const r = rankOf(pdata().xp || 0); rk.textContent = `${RANKS[r][2]} ${RANKS[r][1]}`; }
  }
  function useHint() {
    if (!st || !S.hintsOk || !canPlay() || st.busy || now() < st.hintAt) return;
    const m = moves();
    if (!m.length) return;
    hint = m[Math.floor(Math.random() * m.length)];
    st.hintAt = now() + 15000;
    ctx.sfx?.('tick'); updateHud(); renderGrid(); kick();
  }

  // ---------- side panel: rival minis
  const prevHits = {}, prevScore = {};
  function comet(from, to, text) {
    if (!from || !to || !motion() || !Element.prototype.animate) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const c = ctx.el('div', 'pz-comet', text);
    c.style.left = x0 + 'px'; c.style.top = y0 + 'px';
    document.body.append(c);
    const anim = c.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(x1 - x0) * 0.5}px), calc(-50% + ${(y1 - y0) * 0.5 - 40}px)) scale(1.3)`, opacity: 1, offset: 0.5 },
      { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.8)`, opacity: 0.2 },
    ], { duration: 700, easing: 'ease-in-out' });
    anim.onfinish = () => c.remove();
    setTimeout(() => c.remove(), 1200);
  }
  // (#250) where I stand, right above the board: the rival cards are below it, out of sight on a phone
  function renderStanding(entries) {
    const el = $('pzStand'), mine = entries?.find(([pid]) => pid === S.me.id);
    if (!el) return;
    el.hidden = !mine || entries.length < 2 || !S.prism.playing;
    if (el.hidden) return;
    const score = Math.max(mine[1].score, st?.score || 0);
    const [rid, best] = entries.filter(([pid]) => pid !== S.me.id).reduce((a, b) => (b[1].score > a[1].score ? b : a));
    const gap = score - best.score, place = 1 + entries.filter(([pid, b]) => pid !== S.me.id && b.score > score).length;
    const who = ctx.player(rid)?.name ?? '?', suffix = ['th', 'st', 'nd', 'rd'][place < 4 ? place : 0];
    const text = gap < 0 ? `▼ ${place}${suffix} · ${(-gap).toLocaleString()} behind ${who}` : gap > 0 ? `👑 1st · ${gap.toLocaleString()} ahead of ${who}` : `🤝 Level with ${who}`;
    if (el.textContent !== text) el.textContent = text;
    el.className = 'pz-stand ' + (gap < 0 ? 'behind' : gap > 0 ? 'ahead' : '');
  }

  function renderRivals() {
    const box = $('pzRivals');
    if (!box) return;
    box.innerHTML = '';
    const entries = Object.entries(S.prism.boards).sort((a, b) => b[1].score - a[1].score);
    const hitNow = [];
    // 👑 the lead changes hands (after the opening seconds, and only while the race is on)
    const lead = entries[0]?.[1].score > 0 ? entries[0][0] : null;
    if (lead && renderRivals.lead && lead !== renderRivals.lead && S.phase === 'playing' && S.prism.playing && entries.length > 1) {
      const lp = ctx.player(lead);
      try { Kit.callout(lead === S.me.id ? '👑 You take the lead!' : `👑 ${lp?.name ?? '?'} takes the lead`, lead === S.me.id ? 'gold' : 'cool', { ms: 1300 }); } catch {}
    }
    renderRivals.lead = lead;
    renderStanding(entries);
    entries.forEach(([pid, b], rank) => {
      const p = ctx.player(pid);
      const card = ctx.el('div', 'pz-rival' + (pid === S.me.id ? ' me' : '') + (b.alive ? '' : ' down'));
      card.dataset.pid = pid;
      if (prevHits[pid] != null && b.hits > prevHits[pid]) { card.classList.add('hit'); hitNow.push([pid, b.lastFrom]); }
      prevHits[pid] = b.hits;
      if (prevScore[pid] != null && b.score > prevScore[pid] && pid !== S.me.id && motion()) card.append(ctx.el('span', 'pz-plus', `+${(b.score - prevScore[pid]).toLocaleString()}`));
      prevScore[pid] = b.score;
      const c = document.createElement('canvas'); c.width = c.height = N * 7;
      const m = c.getContext('2d');
      if (m) {
        m.fillStyle = '#16172e'; m.fillRect(0, 0, c.width, c.height);
        for (let i = 0; i < N * N; i++) {
          const ch = b.rows[i], k = kind(ch), x = (i % N) * 7 + 3.5, y = ((i / N) | 0) * 7 + 3.5;
          m.fillStyle = ch === STONE ? '#8a837d' : ch === PRISM ? '#fff' : k != null ? COLORS[k][0] : '#333';
          m.beginPath(); m.arc(x, y, special(ch) ? 3.4 : 2.6, 0, Math.PI * 2); m.fill();
          if (FROZEN.includes(ch)) { m.strokeStyle = '#bfeaff'; m.lineWidth = 1; m.strokeRect(x - 3, y - 3, 6, 6); }
        }
      }
      const label = ctx.el('div', 'pz-name', `${rank === 0 && b.score > 0 ? '👑 ' : ''}${p?.name ?? '?'}`);
      label.style.color = p?.color ?? '';
      card.append(c, ctx.el('div', 'pz-info'));
      card.lastChild.append(label, ctx.el('b', '', b.score.toLocaleString()),
        ctx.el('small', '', [b.sent ? `sent ${b.sent}` : '', b.parried ? `🛡 ${b.parried}` : ''].filter(Boolean).join(' · ')));
      box.append(card);
    });
    // attacks fly from the sender to the target (my own board stands in for my card)
    const at = (pid) => (pid === S.me.id && S.prism.playing ? $('pzStage') : [...box.children].find((c) => c.dataset.pid === pid));
    for (const [pid, from] of hitNow) if (from) comet(at(from), at(pid), '☄️');
  }

  function tickClock() {
    if (!st || !S?.prism) return;
    const pz = S.prism;
    if (pz.mode === 'levels') {
      const cnt = $('pzCount'); if (cnt) cnt.hidden = true;
      const txt = $('pzClock'), bar = $('pzTime');
      if (txt) txt.textContent = st.lv ? `👣 ${st.lv.left}` : '🎯';
      if (bar) { bar.style.width = st.lv ? (100 * goalProgress() / Math.max(1, goalTarget())) + '%' : '0%'; bar.classList.remove('low'); }
      updateHud();
      return;
    }
    const left = Math.max(0, (st.endAt - now()) / 1000);
    const bar = $('pzTime'), txt = $('pzClock'), cnt = $('pzCount');
    const startIn = Math.max(0, st.startAt - now()) / 1000;
    if (cnt) { cnt.hidden = !(startIn > 0 && pz.playing); cnt.textContent = startIn > 0 ? String(Math.ceil(startIn)) : ''; }
    if (bar) { bar.style.width = (100 * Math.min(1, left / (pz.length || 90))) + '%'; bar.classList.toggle('low', left < 10); }
    if (txt) txt.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    if (left < 10 && left > 0 && pz.playing && Math.floor(left) !== st.lastBeep) { st.lastBeep = Math.floor(left); ctx.sfx?.('tickfast'); }
    if (left <= 0 && !st.over) { st.over = true; sel = null; hint = null; st.pendingMoves.length = 0; renderPendingMoves(); renderGrid(); kick(); }
    landDue();
    updateHud();
  }

  function mount(main, side) {
    S = null; st = null; c2 = null; themeNow = null; attackQueue = []; clearTimeout(attackTimer);
    main.innerHTML = `<div class="pz-wrap">
      <div class="pz-top"><span class="pz-clock" id="pzClock">0:00</span><div class="pz-timebar"><i id="pzTime"></i></div>
        <button class="pz-hintbtn" id="pzHintBtn" title="Show me a move (every 15 s)" aria-label="Show me a move">💡</button>
        <div class="pz-scorebox"><span class="pz-score" id="pzScore">0</span><small class="pz-pb" id="pzPB"></small></div></div>
      <div class="pz-sub"><span class="pz-rank" id="pzRank"></span><div class="pz-fever" id="pzFever" title="🔥 Fever: quick matches fill it; full = double points for 6 s"><i></i></div><span class="pz-mult" id="pzMult"></span></div>
      <div id="pzGoal" class="pz-goal" hidden></div>
      <div id="pzStand" class="pz-stand" role="status" hidden></div>
      <div id="pzStage" class="pz-stage"><canvas id="pzCanvas" tabindex="0" aria-label="Your gem board"></canvas><div id="pzGrid" class="pz-grid" hidden></div>
        <div id="pzWarn" class="pz-warn"></div><div id="pzMap" class="pz-map" hidden></div>
        <div id="pzCount" class="pz-count" hidden></div><div id="pzBanner" class="pz-hit"></div><div id="pzQueue" class="pz-queue" aria-live="polite" hidden></div><div id="pzTarget" class="pz-target-prompt" role="group" aria-label="Choose attack target" hidden></div><div id="pzOver" class="pz-over" hidden></div></div></div>`;
    side.innerHTML = `<div class="panel">
      <div id="pzStatus" class="seat-row"></div>
      <div id="pzRivals" class="pz-rivals"></div>
      <div id="pzLevelSide"></div>
      <div id="pzThemes" class="pz-themes"></div>
      <p class="hint left"><b>Swap to make a line of 3.</b> Swipe a gem, or tap it and a neighbour. You can keep matching while a cascade plays; a swap on gems that are still falling waits for them (up to 4). ⌨️ Arrows move; Enter/Space selects; H gives a hint.<br>
      4 makes a row/column ⚡ · L/T makes a 3×3 💥 · 5 makes a colour-clearing 🌈. Match beside 🧊 or 🪨 to clear them. Chain matches for bigger scores; a special or ×3 chain can parry an incoming hit.</p></div>`;
    cv = $('pzCanvas');
    c2 = cv.getContext?.('2d') || null;
    if (!c2) { cv.hidden = true; $('pzGrid').hidden = false; }
    $('pzHintBtn').onclick = useHint;
    let start = null;
    // where a drag from the grabbed gem points: how far (in cells, along one axis) and at which neighbour
    const aim = (e) => {
      const dx = e.clientX - start.x, dy = e.clientY - start.y, far = Math.max(Math.abs(dx), Math.abs(dy)) / (size / N);
      const x = start.i % N, y = (start.i / N) | 0;
      const [nx, ny] = Math.abs(dx) > Math.abs(dy) ? [x + Math.sign(dx), y] : [x, y + Math.sign(dy)];
      return { far, b: ny * N + nx, off: nx < 0 || nx >= N || ny < 0 || ny >= N };
    };
    const swipe = (a, b) => {   // the drag is done: swap, from wherever the gems have got to
      start = null;
      drop();   // they glide home unless the swap takes them over first
      if (!canPlay()) return;
      sel = null; runMove(a, b);
    };
    cv.onpointerdown = (e) => {
      const i = cellAt(e); if (i == null) return;
      start = { i, x: e.clientX, y: e.clientY, far: 0 };
      if (motion() && st && canPlay() && !st.busy && still(i) && movable(i)) { grab = i; kick(); }
      try { cv.setPointerCapture(e.pointerId); } catch {}
    };
    cv.onpointermove = (e) => {
      if (!start || !st) return;
      const { far, b, off } = aim(e), a = start.i;
      start.far = Math.max(start.far, far);
      if (off || far < 0.04 || !canPlay()) { unlean(); if (off && far >= SWAP_AT) { start = null; drop(); } return; }
      lean(a, b, Math.min(1, far));   // the gem goes where the finger goes, and its neighbour makes way
      // it swaps when you let go, or on arriving; gems that can't be dragged just now (still falling) swap as before
      if (far >= 1 || (far >= SWAP_AT && leaning[0] !== a)) swipe(a, b);
    };
    cv.onpointerup = (e) => {
      if (!start || !st) { drop(); start = null; return; }
      const { far, b, off } = aim(e), a = start.i, wandered = Math.max(start.far, far);
      if (!off && far >= SWAP_AT) return swipe(a, b);
      drop(); start = null;
      if (wandered < 0.2) tap(a);   // a tap; a drag taken back just puts the gem down
    };
    cv.onpointercancel = () => { drop(); start = null; };
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select, button, [role="button"]')) return;
      if (!st || !canPlay()) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        if (cursor == null) cursor = sel ?? 27;
        else { const x = Math.max(0, Math.min(N - 1, cursor % N + d[0])), y = Math.max(0, Math.min(N - 1, ((cursor / N) | 0) + d[1])); cursor = y * N + x; }
        kick();
      } else if ((e.key === 'Enter' || e.key === ' ') && cursor != null) { e.preventDefault(); tap(cursor); }
      else if (e.key === 'h' || e.key === 'H') useHint();
      else if (e.key === 'Escape') { sel = null; kick(); }
    };
    addEventListener('keydown', keyHandler);
    resizeObs = window.ResizeObserver ? new ResizeObserver(resize) : null;
    resizeObs?.observe($('pzStage'));
    viewObs = window.IntersectionObserver ? new IntersectionObserver((entries) => {
      viewIntersecting = !!entries[0]?.isIntersecting;
      updateRenderVisibility();
    }, { threshold: 0.01 }) : null;
    viewObs?.observe($('pzStage'));
    visibilityHandler = updateRenderVisibility;
    document.addEventListener('visibilitychange', visibilityHandler);
    resize();
    clock = setInterval(tickClock, 250);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0;
    cancelAnimationFrame(scoreRaf);
    clearTimeout(attackTimer); attackQueue = [];
    clearInterval(clock); clearTimeout(hintTimer); clearTimeout(idleT); clearTimeout(heatT);
    if (keyHandler) removeEventListener('keydown', keyHandler);
    resizeObs?.disconnect();
    viewObs?.disconnect(); viewObs = null;
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null; renderVisible = true; viewIntersecting = true;
    falling = null; st = null; c2 = null; cv = null;
  }

  function render(s, c) {
    S = s; ctx = c;
    const pz = S.prism, levels = pz.mode === 'levels';
    if (!st || st.seed !== pz.seed) newState(pz);
    if (!levels) {
      st.endAt = now() + pz.timeLeft * 1000;
      st.startAt = now() + pz.startIn * 1000;
      if (pz.startIn > 0 && !st.countdown) { st.countdown = true; setTimeout(() => { kick(); armHint(); }, pz.startIn * 1000); }
    }
    if (pz.playing) applyEvents(pz.events);
    if (!pz.playing) { st.over = true; sel = null; hint = null; st.pendingMoves.length = 0; renderPendingMoves(); renderGrid(); }
    const me = pz.boards[S.me.id];
    if (levels) {
      const done = pdata().levels || {}, total = Object.values(done).reduce((a, b) => a + b, 0);
      $('pzStatus').textContent = `🎯 ${total}★ of ${pz.levels.length * 3} · ` + (pz.level ? `level ${pz.level}` : 'choosing a level');
    } else $('pzStatus').textContent = me ? `💎 ${me.score.toLocaleString()} points${me.sent ? ` · sent ${me.sent} attacks` : ''}` : '👁 Watching the race';
    if (!me) { // spectators see the leader's board
      const lead = Object.entries(pz.boards).sort((a, b) => b[1].score - a[1].score)[0];
      if (lead && !st.busy) { g = lead[1].rows.split(''); $('pzScore').textContent = lead[1].score.toLocaleString(); renderGrid(); }
    }
    const over = $('pzOver');
    if (levels && !pz.level) st.lv = null;   // back on the map
    if (levels) {
      if (!st.lv?.over) { over.hidden = true; over.innerHTML = ''; }
      renderMap(pz);
      const ls = $('pzLevelSide');
      if (ls && !ls.firstChild && me && pz.playing) {
        const b = ctx.el('button', '', '✅ Done for now');
        b.onclick = () => ctx.act('quit');
        ls.append(b);
      }
      if (ls && !pz.playing) ls.innerHTML = '';
    } else if (S.phase === 'over' && me) buildRecap(pz, me);
    else { over.hidden = true; }
    tickClock();
    if (!levels) renderRivals(); else { $('pzRivals').innerHTML = ''; renderStanding(null); }
    if (!$('pzThemes').firstChild) renderThemes();
    renderGoal();
    kick();
  }

  const turnText = (s) => s.phase !== 'playing' ? null
    : !s.prism.playing ? '💎 Watching the race'
    : s.prism.mode === 'levels' ? (s.prism.level ? `🎯 Level ${s.prism.level}` : '🎯 Pick a level')
    : s.prism.startIn > 0 ? '💎 Get ready…' : '💎 Match fast — chain cascades!';

  // test hooks: a legal move and the keyboard cursor; an attack as if a rival had sent it (lands at once, or
  // after the parry warning with warn=true)
  const testState = () => ({ move: st && !st.busy ? moves()[0] || null : null, cursor, busy: !!st?.busy, rows: g.join(''), score: st?.score,
    queued: st?.pendingMoves?.length || 0, joinable: st?.open ? moves().find(([a, b]) => still(a) && still(b) && !lined(a) && !lined(b) && swapKind(a, b) === 'match') || null : null, joins: st?.joins || 0,
    level: st?.lv ? { n: st.lv.n, left: st.lv.left, over: st.lv.over, have: goalProgress(), want: goalTarget() } : null,
    fever: st ? { meter: feverMeter(), on: feverOn() } : null, incoming: st?.incoming.length || 0, stats: st?.stats });
  const testHit = (kind_, n, warn = false) => st && applyEvents([{ id: st.applied + 1, kind: kind_, n, from: 'Test' }], !warn);
  const testBoard = (rows) => { if (st && rows.length === N * N) { g = rows.split(''); kick(); } };
  return { mount, render, unmount, turnText, focus: true, keepTip: true, testTap: tap, testState, testHit, testBoard };
})();
