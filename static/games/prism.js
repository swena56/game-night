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
  let raf = 0, resizeObs = null, keyHandler = null, clock = null, hintTimer = null;

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
      // the table facet: a smaller, lighter copy of the shape, and lines out to the rim
      p.save(); shapePath(p, k, cx, cy, r); p.clip();
      p.globalAlpha = 0.28; p.fillStyle = light; shapePath(p, k, cx - r * 0.06, cy - r * 0.08, r * 0.52); p.fill();
      p.globalAlpha = 0.18; p.strokeStyle = '#fff'; p.lineWidth = Math.max(1, s * 0.015);
      for (let t = 0; t < 8; t++) { const a = t * Math.PI / 4 + 0.3; p.beginPath(); p.moveTo(cx, cy); p.lineTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 1.4); p.stroke(); }
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
  const vis = () => Array.from({ length: N * N }, () => ({ ox: 0, oy: 0, vy: 0, land: 0, born: 0, ice: 0 }));
  let cells = vis();
  let pops = [], fx = [], parts = [], texts = [], shake = 0, flash = 0, sel = null, cursor = null, hint = null, lastAct = 0;
  let falling = null, swapAnim = null;
  const motion = () => (typeof motionOK === 'function' ? motionOK() : true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, motion() ? ms : Math.min(ms, 60)));
  const cellXY = (i) => [(i % N + 0.5) * cs, (((i / N) | 0) + 0.5) * cs];
  const now = () => performance.now();

  function burstParts(i, ch, big = 1) {
    if (!motion() || !c2) return;
    const [x, y] = cellXY(i), k = kind(ch), col = k == null ? ['#bbb', '#fff', '#555'] : COLORS[k];
    const n = Math.round(10 * big);
    for (let t = 0; t < n && parts.length < 320; t++) {
      const a = Math.random() * Math.PI * 2, v = cs * (2.5 + Math.random() * 4.5) * big;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs * 2, life: 0, max: 0.5 + Math.random() * 0.45,
        size: cs * (0.07 + Math.random() * 0.08), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
        color: Math.random() < 0.3 ? col[1] : col[0], kind: 'shard' });
    }
    for (let t = 0; t < 5 * big && parts.length < 320; t++) {
      const a = Math.random() * Math.PI * 2, v = cs * (1 + Math.random() * 2.5);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + Math.random() * 0.4, size: cs * (0.05 + Math.random() * 0.06), color: col[1], kind: 'spark' });
    }
  }
  function iceParts(i, color = '#d8f3ff') {
    if (!motion()) return;
    const [x, y] = cellXY(i);
    for (let t = 0; t < 9 && parts.length < 320; t++) {
      const a = Math.random() * Math.PI * 2, v = cs * (2 + Math.random() * 3);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs, life: 0, max: 0.55, size: cs * 0.09, rot: Math.random() * 6, vr: 8, color, kind: 'shard' });
    }
  }
  function floatText(i, text, step) {
    const [x, y] = Array.isArray(i) ? i : cellXY(i);
    texts.push({ x, y, text, color: HEAT[Math.min(step, HEAT.length - 1)], t0: now(), big: step >= 3 ? 1.35 : 1 });
  }
  function doShake(n) { if (motion()) shake = Math.max(shake, cs * 0.12 * n); }

  // ---------- drawing
  function drawGem(p, ch, x, y, scale, t, i) {
    const half = cs * scale / 2;
    if (ch === EMPTY) return;
    if (ch === STONE) { if (stoneSprite) p.drawImage(stoneSprite, x - half, y - half, cs * scale, cs * scale); return; }
    if (ch === PRISM) { drawPrism(p, x, y, cs * 0.36 * scale, t); return; }
    const k = kind(ch), sp = special(ch), [base, light] = COLORS[k];
    const sprite = (sp && specSprites[sp]?.[k]) || sprites[k];
    if (sprite) p.drawImage(sprite, x - half, y - half, cs * scale, cs * scale);
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
    if (!motion()) return;
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
          c.vy += 38 * dt; c.oy = Math.min(0, c.oy + c.vy * dt);
          if (c.oy === 0) { c.vy = 0; c.land = t; } else moving = true;
        }
      }
      if (!moving) { const done = falling; falling = null; done(); }
      busy = true;
    }
    const p = c2;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, cv.width, cv.height);
    if (shake > 0.3) { p.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.002, dt); busy = true; } else shake = 0;
    drawBoardBg(p);
    drawMotes(p, t, dt);
    // a slow diagonal sheen across the board while things are moving
    const sx = ((t / 9) % (cv.width * 3)) - cv.width;
    const sheen = p.createLinearGradient(sx, 0, sx + cv.width * 0.5, cv.height);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.04)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    p.fillStyle = sheen; p.fillRect(0, 0, cv.width, cv.height);
    // hint shimmer and selection glow
    const glowAt = (i, color, a) => {
      const [x, y] = cellXY(i);
      const rg = p.createRadialGradient(x, y, cs * 0.1, x, y, cs * 0.62);
      rg.addColorStop(0, color.replace('A', a)); rg.addColorStop(1, color.replace('A', 0));
      p.fillStyle = rg; p.fillRect(x - cs * 0.62, y - cs * 0.62, cs * 1.24, cs * 1.24);
    };
    if (hint) { const a = 0.25 + 0.25 * Math.sin(t / 180); hint.forEach((i) => glowAt(i, 'rgba(255,255,255,A)', a)); busy = true; }
    if (sel != null) {
      glowAt(sel, 'rgba(255,230,140,A)', 0.4 + 0.2 * Math.sin(t / 120));
      const [x, y] = cellXY(sel);
      p.save(); p.strokeStyle = '#ffe48c'; p.lineWidth = Math.max(2, cs * 0.05); p.setLineDash([cs * 0.16, cs * 0.1]); p.lineDashOffset = -t / 30;
      p.beginPath(); p.arc(x, y, cs * 0.47, 0, Math.PI * 2); p.stroke(); p.restore();
      busy = true;
    }
    // gems
    for (let i = 0; i < N * N; i++) {
      const ch = g[i], c = cells[i];
      if (ch === EMPTY) continue;
      let [x, y] = cellXY(i);
      x += c.ox * cs; y += c.oy * cs;
      let sxs = 1, sys = 1;
      const since = t - c.land;
      if (c.land && since < 220) { const q = Math.sin(since / 220 * Math.PI) * 0.14; sxs = 1 + q; sys = 1 - q; busy = true; }
      const born = t - c.born;
      let scale = 1;
      if (c.born && born < 420) { scale = 1 + 0.35 * Math.sin(born / 420 * Math.PI); busy = true; }
      if (sel === i) scale *= 1.06 + 0.04 * Math.sin(t / 120);
      p.save();
      p.translate(x, y + (1 - sys) * cs * 0.35); p.scale(sxs, sys);
      drawGem(p, ch, 0, 0, scale, t, i);
      if (FROZEN.includes(ch)) { const grow = c.ice ? Math.min(1, (t - c.ice) / 380) : 1; if (grow < 1) busy = true; drawIce(p, 0, 0, 0.6 + 0.4 * grow); }
      p.restore();
      if (special(ch) || ch === PRISM) busy = true; // specials shimmer
    }
    // twinkle: now and then a resting gem catches the light
    if (motion() && st) {
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
    // shards (fall) and sparks (glow)
    if (parts.length) {
      busy = true;
      parts = parts.filter((q) => (q.life += dt) < q.max);
      for (const q of parts) {
        const k = q.life / q.max;
        q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.kind === 'shard') {
          q.vy += cs * 22 * dt; q.vx *= 0.985; q.rot += q.vr * dt;
          p.save(); p.globalAlpha = 1 - k * k; p.fillStyle = q.color; p.translate(q.x, q.y); p.rotate(q.rot);
          p.beginPath(); p.moveTo(0, -q.size); p.lineTo(q.size * 0.7, q.size * 0.6); p.lineTo(-q.size * 0.7, q.size * 0.6); p.closePath(); p.fill();
          p.restore();
        } else {
          q.vx *= 0.94; q.vy *= 0.94;
          p.save(); p.globalCompositeOperation = 'lighter'; p.globalAlpha = 1 - k; p.fillStyle = q.color;
          const r = q.size * (1 + k);
          p.beginPath(); p.moveTo(q.x, q.y - r * 2); p.lineTo(q.x + r * 0.5, q.y); p.lineTo(q.x, q.y + r * 2); p.lineTo(q.x - r * 0.5, q.y); p.closePath(); p.fill();
          p.beginPath(); p.moveTo(q.x - r * 2, q.y); p.lineTo(q.x, q.y + r * 0.5); p.lineTo(q.x + r * 2, q.y); p.lineTo(q.x, q.y - r * 0.5); p.closePath(); p.fill();
          p.restore();
        }
      }
    }
    // floating points
    texts = texts.filter((q) => t - q.t0 < 900);
    for (const q of texts) {
      const k = (t - q.t0) / 900, pop = k < 0.15 ? 0.6 + k / 0.15 * 0.6 : 1.2 - Math.min(0.2, (k - 0.15));
      p.save();
      p.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      p.font = `900 ${Math.round(cs * 0.42 * q.big * pop)}px system-ui, sans-serif`; p.textAlign = 'center'; p.textBaseline = 'middle';
      p.lineWidth = cs * 0.09; p.strokeStyle = 'rgba(10,8,30,0.85)'; p.lineJoin = 'round';
      const y = q.y - k * cs * 0.9;
      p.strokeText(q.text, q.x, y); p.fillStyle = q.color; p.fillText(q.text, q.x, y);
      p.restore();
      busy = true;
    }
    // keyboard cursor
    if (cursor != null) {
      const x = (cursor % N) * cs, y = ((cursor / N) | 0) * cs;
      p.save(); p.strokeStyle = 'rgba(255,255,255,0.9)'; p.lineWidth = Math.max(2, cs * 0.05); p.setLineDash([cs * 0.12, cs * 0.08]);
      p.strokeRect(x + cs * 0.06, y + cs * 0.06, cs * 0.88, cs * 0.88); p.restore();
    }
    if (flash > 0.02) { p.setTransform(1, 0, 0, 1, 0, 0); p.fillStyle = `rgba(255,255,255,${flash})`; p.fillRect(0, 0, cv.width, cv.height); flash *= Math.pow(0.004, dt); busy = true; } else flash = 0;
    if (busy || st.busy) kick();
    else if (motion() && !st.over) { clearTimeout(idleT); idleT = setTimeout(kick, 50); }  // ~20 fps while idle: motes and glints
  }
  let idleT = 0;
  function kick() { if (!raf && c2) { clearTimeout(idleT); raf = requestAnimationFrame(frame); } }

  // ---------- moves, step by step with effects
  function waitFall(drop) {
    let any = false;
    drop.forEach((d, i) => { if (d > 0) { cells[i].oy = -d; cells[i].vy = 2; any = true; } else { cells[i].oy = 0; } });
    if (!any || !motion() || !c2) { cells.forEach((c) => { c.oy = 0; }); return Promise.resolve(); }
    return new Promise((res) => { falling = res; kick(); });
  }
  function showBlasts(blasts, t) {
    for (const b of blasts) {
      const k = kind(b.ch);
      if (b.sp === 'h' || b.sp === 'v') { fx.push({ type: 'beam', i: b.i, dir: b.sp, k, t0: t, dur: 520 }); ctx.sfx?.('sweep'); }
      else if (b.sp === 'n') { fx.push({ type: 'ring', i: b.i, r: 1.9, color: COLORS[k][0], t0: t, dur: 520 }); doShake(1.2); ctx.sfx?.('boom'); }
      else if (b.sp === 'p') { fx.push({ type: 'arc', i: b.i, to: b.area.filter((j) => j !== b.i).slice(0, 24), t0: t, dur: 700 }); flash = Math.max(flash, 0.35); ctx.sfx?.('tag'); }
    }
  }
  async function animStep(out, step, pts, center) {
    const t = now();
    for (const [i, ch] of out.popped) { pops.push({ i, ch, t0: t + (out.order?.get(i) || 0), dur: 260 }); }
    out.popped.forEach(([i, ch], n) => n < 40 && burstParts(i, ch, out.popped.length > 20 ? 0.6 : 1));
    out.broke.forEach((i) => { burstParts(i, STONE, 1.2); ctx.sfx?.('crack'); });
    out.thawed.forEach((i) => { iceParts(i); ctx.sfx?.('crack'); });
    out.born.forEach(([i, ch]) => {
      cells[i].born = t;
      fx.push({ type: 'birth', i, color: ch === PRISM ? 'rgba(255,255,255,0.5)' : COLORS[kind(ch)][0], t0: t, dur: 600 });
    });
    if (out.born.length) ctx.sfx?.('pickup');
    if (pts) floatText(center, `+${pts}`, step);
    ctx.sfx?.('rise', Math.min(12, step * 2));
    heat(step);
    if (step >= 2 && out.popped.length) buzz?.(step >= 4 ? [30, 20, 50] : 18);
    if (step >= 3) {
      const word = step >= 6 ? 'PRISMATIC!' : step >= 5 ? 'DAZZLING!' : step >= 4 ? 'BRILLIANT!' : 'SPARKLING!';
      try { Kit.callout(`${word} ×${step}`, step >= 5 ? 'gold' : 'good'); } catch {}
      doShake(step - 1.5);
    }
    kick();
    await sleep(260);
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

  async function animSwap(a, b, bounce) {
    if (!motion() || !c2) return;
    const ax = a % N, ay = (a / N) | 0, bx = b % N, by = (b / N) | 0;
    const dur = 150, t0 = now();
    await new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (now() - t0) / dur), e = bounce ? Math.sin(k * Math.PI) * 0.45 : k * k * (3 - 2 * k);
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

  async function runMove(a, b) {
    if (!st || st.busy || !canPlay()) return;
    hint = null; lastAct = now();
    const what = swapKind(a, b);
    st.busy = true;
    try {
      ctx.sfx?.('flip');
      if (!what) { ctx.sfx?.('wrong'); await animSwap(a, b, true); return; }
      if (st.lv) st.lv.left--;
      const m = mult();
      await animSwap(a, b, false);
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
          if (pair.has('p')) { for (let i = 0; i < N * N; i++) area.add(i); flash = 0.8; }
          else if (pair.size === 1 && pair.has('n')) box(2);
          else if (pair.has('n')) { for (let t = 0; t < N; t++) for (let d = -1; d <= 1; d++) { if (x + d >= 0 && x + d < N) area.add(t * N + x + d); if (y + d >= 0 && y + d < N) area.add((y + d) * N + t); } }
          else { for (let t = 0; t < N; t++) { area.add(y * N + t); area.add(t * N + x); } }
          const k = kind(g[a]) ?? kind(g[b]) ?? 5;
          fx.push({ type: 'ring', i: b, r: 3.4, color: COLORS[k][1], t0: now(), dur: 650 });
          fx.push({ type: 'beam', i: b, dir: 'h', k, t0: now(), dur: 560 }, { type: 'beam', i: b, dir: 'v', k, t0: now(), dur: 560 });
          g[a] = g[b] = EMPTY;
          fired.push('combo');
          doShake(3); ctx.sfx?.('boom'); flash = Math.max(flash, 0.4);
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
        const gs = groups();
        if (!gs.length) break;
        step++;
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
      if (!moves().length) await reshuffle();
      st.score += pts;
      scoreTo(st.score);
      afterMove(step, fired, madeList);
      push();
      if (step >= 3 || fired.length || madeList.length) {
        ctx.quiet(ctx.act('burst', { cascade: step, specials: fired, made: madeList }));
        const [frost, stones] = S?.prism?.attacks && Object.keys(S.prism.boards).length > 1 ? attackFor(step, fired) : [0, 0];
        if ((frost || stones) && now() >= (st.attackAt || 0)) {
          st.attackAt = now() + 5000;
          st.stats.sent += frost + stones;
          const w = [frost && `🧊×${frost}`, stones && `🪨×${stones}`].filter(Boolean).join(' ');
          try { Kit.flyText($('pzScore'), `${w} sent!`, 'gold'); } catch {}
          ctx.sfx?.('whoosh');
        }
      }
    } finally {
      if (st) { st.busy = false; flushEvents(); }
      kick();
      armHint();
    }
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
    flash = Math.max(flash, 0.5);
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
        const spots = g.map((c, i) => (PLAIN.includes(c) ? i : -1)).filter((i) => i >= 0).sort(() => Math.random() - 0.5).slice(0, n);
        spots.forEach((i) => { g[i] = FROZEN[PLAIN.indexOf(g[i])]; cells[i].ice = t; });
        if (sel != null && FROZEN.includes(g[sel])) sel = null;
        ctx.toast(`🧊 ${ev.from} froze ${spots.length} of your gems! Match next to them to thaw.`);
        ctx.sfx?.('crack'); buzz?.([40, 30, 40]);
      } else if (ev.kind === 'stone') {
        let spots = g.map((c, i) => (PLAIN.includes(c) && i < N * 3 ? i : -1)).filter((i) => i >= 0);
        if (!spots.length) spots = g.map((c, i) => (PLAIN.includes(c) ? i : -1)).filter((i) => i >= 0);
        spots = spots.sort(() => Math.random() - 0.5).slice(0, n);
        spots.forEach((i) => { g[i] = STONE; cells[i].oy = -2 - ((i / N) | 0); cells[i].vy = 4; });
        if (spots.length && motion() && c2) falling ||= (() => { doShake(2.5); ctx.sfx?.('thud'); });
        else { spots.forEach((i) => { cells[i].oy = 0; }); ctx.sfx?.('thud'); }
        ctx.toast(`🪨 ${ev.from} dropped ${spots.length} stones on you! Match next to them to break them.`);
        buzz?.([60, 40, 60]);
      }
      const ban = $('pzBanner');
      if (ban) { ban.textContent = ev.kind === 'frost' ? `🧊 Frost from ${ev.from}!` : `🪨 Stones from ${ev.from}!`; ban.className = 'pz-hit ' + ev.kind; void ban.offsetWidth; ban.classList.add('on'); }
    }
    if (!moves().length) shuffle();
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
    box.innerHTML = '';
    const t = now();
    for (const e of st.incoming) {
      const chip = ctx.el('div', 'pz-warn-chip ' + e.kind, `${e.kind === 'frost' ? '🧊' : '🪨'}×${e.n} from ${e.from}`);
      const bar = document.createElement('i');
      bar.style.animationDuration = Math.max(0, e.at - t) + 'ms';
      chip.append(bar);
      box.append(chip);
    }
    if (st.incoming.length) box.append(ctx.el('div', 'pz-warn-tip', 'Chain ×3 or set off a special to shatter it!'));
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
      if (!st || st.busy || !canPlay()) return;
      const m = moves();
      if (m.length) { hint = m[Math.floor(Math.random() * m.length)]; kick(); }
    }, 5000);
  }

  // ---------- input
  function tap(i) {
    if (!st || !canPlay()) return;
    lastAct = now(); hint = null; armHint();
    if (st.busy) return;
    if (sel == null) { if (movable(i)) { sel = i; ctx.sfx?.('tick'); } }
    else if (i === sel) sel = null;
    else if (neighbours(sel).includes(i)) { const a = sel; sel = null; runMove(a, i); }
    else sel = movable(i) ? i : null;
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
      b.classList.toggle('ice', FROZEN.includes(ch));
    });
  }

  // ---------- layout
  function resize() {
    if (!cv) return;
    const stage = $('pzStage');
    const w = Math.max(160, Math.floor(stage.clientWidth || 320));
    size = w;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(size * dpr);
    cv.style.width = cv.style.height = size + 'px';
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
    try { pb = Profile.best('prism'); } catch {}
    st = { seed: pz.seed, score: mine?.score || 0, applied: applied != null ? +applied : Math.max(0, ...pz.events.map((e) => e.id)),
      appliedKey, queue: [], incoming: [], busy: false, pushed: mine?.rows, pushedScore: mine?.score || 0, endAt: now() + pz.timeLeft * 1000, over: false, lastT: 0,
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
    cells = vis(); pops = []; fx = []; parts = []; texts = []; sel = null; hint = null;
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
    if (hb) { const left = st.hintAt - now(); hb.disabled = left > 0 || !canPlay(); hb.style.setProperty('--cd', Math.max(0, left / 15000)); }
    const rk = $('pzRank');
    if (rk) { const r = rankOf(pdata().xp || 0); rk.textContent = `${RANKS[r][2]} ${RANKS[r][1]}`; }
  }
  function useHint() {
    if (!st || !canPlay() || st.busy || now() < st.hintAt) return;
    const m = moves();
    if (!m.length) return;
    hint = m[Math.floor(Math.random() * m.length)];
    st.hintAt = now() + 15000;
    ctx.sfx?.('tick'); updateHud(); kick();
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
  function renderRivals() {
    const box = $('pzRivals');
    if (!box) return;
    box.innerHTML = '';
    const entries = Object.entries(S.prism.boards).sort((a, b) => b[1].score - a[1].score);
    const hitNow = [];
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
    if (left <= 0 && !st.over) { st.over = true; sel = null; hint = null; kick(); }
    landDue();
    updateHud();
  }

  function mount(main, side) {
    S = null; st = null; c2 = null; themeNow = null;
    main.innerHTML = `<div class="pz-wrap">
      <div class="pz-top"><span class="pz-clock" id="pzClock">0:00</span><div class="pz-timebar"><i id="pzTime"></i></div>
        <button class="pz-hintbtn" id="pzHintBtn" title="Show me a move (every 15 s)" aria-label="Show me a move">💡</button>
        <div class="pz-scorebox"><span class="pz-score" id="pzScore">0</span><small class="pz-pb" id="pzPB"></small></div></div>
      <div class="pz-sub"><span class="pz-rank" id="pzRank"></span><div class="pz-fever" id="pzFever" title="🔥 Fever: quick matches fill it; full = double points for 6 s"><i></i></div><span class="pz-mult" id="pzMult"></span></div>
      <div id="pzGoal" class="pz-goal" hidden></div>
      <div id="pzStage" class="pz-stage"><canvas id="pzCanvas" tabindex="0" aria-label="Your gem board"></canvas><div id="pzGrid" class="pz-grid" hidden></div>
        <div id="pzWarn" class="pz-warn"></div><div id="pzMap" class="pz-map" hidden></div>
        <div id="pzCount" class="pz-count" hidden></div><div id="pzBanner" class="pz-hit"></div><div id="pzOver" class="pz-over" hidden></div></div></div>`;
    side.innerHTML = `<div class="panel">
      <div id="pzStatus" class="seat-row"></div>
      <div id="pzRivals" class="pz-rivals"></div>
      <div id="pzLevelSide"></div>
      <div id="pzThemes" class="pz-themes"></div>
      <p class="hint left">Tap a gem, then a neighbour, or swipe it. ⌨️ Arrows move, Enter/Space picks, H shows a move.<br>
      4 in a row ⚡ · L or T 💥 · 5 in a row 🌈 · swap two specials for a bigger blast. Quick matches fill 🔥 fever: double points.</p></div>`;
    cv = $('pzCanvas');
    c2 = cv.getContext?.('2d') || null;
    if (!c2) { cv.hidden = true; $('pzGrid').hidden = false; }
    $('pzHintBtn').onclick = useHint;
    let start = null;
    cv.onpointerdown = (e) => {
      const i = cellAt(e); if (i == null) return;
      start = { i, x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch {}
    };
    cv.onpointermove = (e) => {
      if (!start || !st || st.busy) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y, cell = size / N;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.4) return;
      const x = start.i % N, y = (start.i / N) | 0;
      const [nx, ny] = Math.abs(dx) > Math.abs(dy) ? [x + Math.sign(dx), y] : [x, y + Math.sign(dy)];
      const a = start.i;
      start = null;
      if (nx < 0 || nx >= N || ny < 0 || ny >= N || !canPlay()) return;
      sel = null; runMove(a, ny * N + nx);
    };
    cv.onpointerup = () => { if (start) tap(start.i); start = null; };
    cv.onpointercancel = () => { start = null; };
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
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
    resize();
    clock = setInterval(tickClock, 250);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0;
    cancelAnimationFrame(scoreRaf);
    clearInterval(clock); clearTimeout(hintTimer); clearTimeout(idleT); clearTimeout(heatT);
    if (keyHandler) removeEventListener('keydown', keyHandler);
    resizeObs?.disconnect();
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
    if (!pz.playing) { st.over = true; sel = null; hint = null; }
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
    if (!levels) renderRivals(); else $('pzRivals').innerHTML = '';
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
    level: st?.lv ? { n: st.lv.n, left: st.lv.left, over: st.lv.over, have: goalProgress(), want: goalTarget() } : null,
    fever: st ? { meter: feverMeter(), on: feverOn() } : null, incoming: st?.incoming.length || 0, stats: st?.stats });
  const testHit = (kind_, n, warn = false) => st && applyEvents([{ id: st.applied + 1, kind: kind_, n, from: 'Test' }], !warn);
  const testBoard = (rows) => { if (st && rows.length === N * N) { g = rows.split(''); kick(); } };
  return { mount, render, unmount, turnText, focus: true, testState, testHit, testBoard };
})();
