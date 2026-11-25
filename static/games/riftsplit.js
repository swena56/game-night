// Rift Split: grow walls to seal off bouncing orbs. three.js field (flat canvas fallback); the server owns the physics.
(() => {
  const MSG = {
    seal: 'Sealed!', close: '⚡ Close call! +25', big: 'Huge seal!', hit: 'Wall shattered · life lost', shield: 'Shield absorbed it',
    'shield+': 'Shield ready', life: 'Giant seal · +1 life', slow: 'Orbs slowed', clear: 'Level clear!', over: 'Out of lives',
  };
  const POWER = { slow: ['⏳', 'SLOW DOWN', 'Every orb crawls for 8 seconds'], 'shield+': ['🛡️', 'SHIELD READY', 'Blocks the next hit'], life: ['❤️', 'EXTRA LIFE', '+1 life'] };
  const SND = { seal: 'lock', close: 'cheer', big: 'cheer', hit: 'wrong', shield: 'lock', 'shield+': 'pop', slow: 'pop', clear: 'cheer', life: 'cheer', over: 'groan' };
  // Rift Split's own sounds, synthesised on the shared Snd kit: pitched glass-and-chime tones instead of the app's generic blips
  const NOTE = (n) => 220 * 2 ** (n / 12);
  const VOICE = {
    lock: (t, K) => { const d = K.at({ send: 0.3 }); K.sweep(d, t, { f0: 160, f1: 60, dur: 0.16, vol: 0.2 }); K.mode(d, t, 1800, 0.1, 0.03); K.mode(d, t + 0.02, 950, 0.09, 0.06); K.burst(d, t, { type: 'bandpass', f: 2600, q: 2, vol: 0.1, tau: 0.012 }); },
    place: (t, K) => { const d = K.at({ send: 0.15 }); K.sweep(d, t, { f0: 300, f1: 620, dur: 0.14, vol: 0.09, type: 'triangle' }); K.burst(d, t, { type: 'highpass', f: 4000, vol: 0.04, tau: 0.01 }); },
    seal: (t, K) => { const d = K.at({ send: 0.5 }); [0, 4, 7].forEach((n, i) => K.mode(d, t + i * 0.055, NOTE(n + 12), 0.13, 0.16)); K.sweep(d, t, { f0: 180, f1: 70, dur: 0.18, vol: 0.12 }); },
    big: (t, K) => { const d = K.at({ send: 0.7 }); [0, 4, 7, 12, 16].forEach((n, i) => { K.mode(d, t + i * 0.06, NOTE(n + 12), 0.14, 0.24); K.mode(d, t + i * 0.06, NOTE(n + 24), 0.05, 0.3); }); K.burst(d, t, { f: 2500, f1: 9000, q: 1.2, vol: 0.06, dur: 0.35, tau: 0.08 }); },
    hit: (t, K) => { const d = K.at({ send: 0.4 }); K.sweep(d, t, { f0: 420, f1: 70, dur: 0.3, vol: 0.2, type: 'sawtooth' }); K.burst(d, t, { type: 'lowpass', f: 3000, f1: 300, vol: 0.2, dur: 0.25, tau: 0.06 }); K.mode(d, t, 1400, 0.1, 0.05); },
    shield: (t, K) => { const d = K.at({ send: 0.5 }); [7, 12, 19].forEach((n, i) => K.mode(d, t + i * 0.05, NOTE(n), 0.12, 0.3)); },
    'shield+': (t, K) => { const d = K.at({ send: 0.5 }); [0, 7, 12].forEach((n, i) => K.mode(d, t + i * 0.05, NOTE(n + 12), 0.1, 0.22)); K.sweep(d, t, { f0: 400, f1: 1200, dur: 0.2, vol: 0.06, type: 'triangle' }); },
    slow: (t, K) => { const d = K.at({ send: 0.6, room: 'hall' }); K.sweep(d, t, { f0: 900, f1: 180, dur: 0.6, vol: 0.12, type: 'sine', attack: 0.03 }); K.sweep(d, t, { f0: 905, f1: 187, dur: 0.6, vol: 0.08, type: 'triangle', attack: 0.03 }); },
    life: (t, K) => { const d = K.at({ send: 0.7 }); [0, 7, 12, 16, 19].forEach((n, i) => K.mode(d, t + i * 0.05, NOTE(n + 12), 0.13, 0.26)); K.sweep(d, t, { f0: 300, f1: 900, dur: 0.3, vol: 0.07, type: 'triangle' }); },
    clear: (t, K) => { const d = K.at({ send: 0.8 }); [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => { K.mode(d, t + i * 0.075, NOTE(n + 12), 0.14, 0.3); }); K.burst(d, t + 0.4, { f: 3000, f1: 11000, q: 1, vol: 0.07, dur: 0.5, tau: 0.1 }); },
    over: (t, K) => { const d = K.at({ send: 0.7, room: 'hall' }); [7, 3, 0, -5].forEach((n, i) => { K.mode(d, t + i * 0.16, NOTE(n), 0.16, 0.28, { type: 'triangle' }); K.sweep(d, t + i * 0.16, { f0: NOTE(n), f1: NOTE(n) * 0.97, dur: 0.3, vol: 0.06, type: 'sawtooth' }); }); },
  };
  const voice = (name) => { if (VOICE[name] && window.Snd) { Snd.play(VOICE[name]); return true; } return false; };
  const COLORS = ['#3cf5e0', '#ff6fb5', '#ffd166', '#9d8bff', '#7dff8a', '#ff9a4d'];
  const bestKey = 'riftsplit.best';
  // colour themes: the field, grid, frame and the two sides of a growing wall (orbs stay red/white, sealed cells keep each player's colour)
  const THEMES = {
    neon: { name: 'Neon', floor: '#15245a', grid: '#3d62c4', flatGrid: '#3358b8', bgA: '#24367d', bgM: '#121c52', bgB: '#070b22', frame: 0x1a2650, half: ['#3cf5e0', '#ffd166'], glow: '#3cf5e0' },
    ember: { name: 'Ember', floor: '#3a1a14', grid: '#c2603d', flatGrid: '#a2502f', bgA: '#6a2a1c', bgM: '#3a150f', bgB: '#1a0806', frame: 0x3a1a14, half: ['#ffb347', '#ff5e7e'], glow: '#ff8a4d' },
    forest: { name: 'Forest', floor: '#123a2a', grid: '#3da36a', flatGrid: '#2f8a58', bgA: '#1d6046', bgM: '#0e3224', bgB: '#05140d', frame: 0x123a2a, half: ['#9dff7a', '#fff27a'], glow: '#6dff9a' },
    ocean: { name: 'Ocean', floor: '#0f3350', grid: '#3d9ac4', flatGrid: '#3086b0', bgA: '#1a5a7d', bgM: '#0d3048', bgB: '#04121d', frame: 0x0f3350, half: ['#7df0ff', '#ffe08a'], glow: '#4dd2ff' },
    violet: { name: 'Violet', floor: '#2a1650', grid: '#9a62d8', flatGrid: '#8450c0', bgA: '#4a2a86', bgM: '#26134a', bgB: '#0e0620', frame: 0x2a1650, half: ['#d9a0ff', '#ffd166'], glow: '#b86dff' },
    mono: { name: 'Mono', floor: '#262a33', grid: '#7b8394', flatGrid: '#677086', bgA: '#454b5a', bgM: '#252932', bgB: '#0c0e12', frame: 0x262a33, half: ['#ffffff', '#9ad1ff'], glow: '#c8d4ff' },
  };
  const THEME_KEYS = ['auto', ...Object.keys(THEMES)];   // Auto: the field changes colour every few levels
  const TIERS = ['neon', 'ocean', 'forest', 'ember', 'violet', 'mono'], TIER_LEN = 4;   // levels 1-4 neon, 5-8 ocean, ...
  const tierTheme = (lv) => TIERS[Math.floor(Math.max(0, (lv || 1) - 1) / TIER_LEN) % TIERS.length];
  const effTheme = () => (g?.theme === 'auto' ? tierTheme(g.lv) : g?.theme);
  const THM = () => THEMES[effTheme()] || THEMES.neon;
  let HALF = THEMES.neon.half;
  const RED = '#ff4d4d';                  // orbs are red on one hemisphere and white on the other
  let g;

  const store = {
    get() { try { const v = Number(localStorage.getItem(bestKey)); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; } },
    set(v) { try { localStorage.setItem(bestKey, String(v)); } catch { /* private mode */ } },
  };

  // ---------- shared geometry ----------
  // A wall: [vertical, cx, cy, len0, room0, st0, len1, room1, st1]. Returns board-space rects [x0, x1, y0, y1, state].
  function wallRects(w) {
    if (!w || !w.length) return [];
    const v = w[0], cx = w[1], cy = w[2], c = v ? cy : cx, out = [];
    for (let i = 0; i < 2; i++) {
      const len = w[3 + i * 3], st = w[5 + i * 3];
      if (!len || st === 'd' || st === 'x') continue;   // locked into the grid, or shattered
      const lo = i === 0 ? c + 1 - len : c + 1, hi = i === 0 ? c + 1 : c + 1 + len;
      out.push(v ? [cx, cx + 1, lo, hi, st, i] : [lo, hi, cy, cy + 1, st, i]);   // i: which half
    }
    return out;
  }
  const cellFree = (grid, x, y) => x >= 0 && y >= 0 && x < g.W && y < g.H && grid[y * g.W + x] === '0';


  // The seal ripples inward: each new cell waits in proportion to its distance from the cells that were already solid.
  // Sets born[] (ms timestamps) and returns when the animation ends plus sparks to fire: [time, x, y, count].
  function ripple(prev, grid, now, born) {
    const dist = new Int16Array(grid.length).fill(-1), queue = [];
    for (let i = 0; i < grid.length; i++) if (prev[i] === '1') { dist[i] = 0; queue.push(i); }
    let far = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.W, y = (i - x) / g.W;
      for (const j of [x > 0 ? i - 1 : -1, x < g.W - 1 ? i + 1 : -1, y > 0 ? i - g.W : -1, y < g.H - 1 ? i + g.W : -1]) {
        if (j < 0 || dist[j] >= 0 || grid[j] !== '1') continue;
        dist[j] = dist[i] + 1; far = Math.max(far, dist[j]); queue.push(j);
      }
    }
    const step = Math.min(24, 420 / Math.max(1, far)), fresh = [];
    for (let i = 0; i < grid.length; i++) if (grid[i] === '1' && prev[i] !== '1') { born[i] = now + Math.max(0, dist[i]) * step; fresh.push(i); }
    const every = Math.max(1, Math.floor(fresh.length / 40)), big = fresh.length >= 90, sparks = [];
    for (let q = 0; q < fresh.length; q += every) sparks.push([born[fresh[q]], fresh[q] % g.W + 0.5, Math.floor(fresh[q] / g.W) + 0.5, big ? 5 : 3]);
    return { until: now + far * step + 450, sparks };
  }

  // A wall half that was growing and is now gone was struck by an orb. Updates `prev` and returns the head [x, y] of each shattered half.
  const wallList = (s) => [s.w || [], s.w2 || []];   // up to two walls grow at once
  const shattersAll = (prev, s) => wallList(s).flatMap((w, k) => shatters(prev[k], w).map((q) => [...q, k]));
  // a struck wall flashes red where it was: strikes hold the rect it had on its last frame
  const STRIKE_MS = 520;
  function trackStrikes(strikes, lastRects, s, now, hits) {
    for (const [, , i, k] of hits) { const r = lastRects[k * 2 + i]; if (r) strikes.push({ r, t: now }); }
    lastRects.length = 0;
    wallList(s).forEach((w, k) => { for (const r of wallRects(w)) lastRects[k * 2 + r[5]] = r; });
    for (let q = strikes.length - 1; q >= 0; q--) if (now - strikes[q].t > STRIKE_MS) strikes.splice(q, 1);
  }
  // cells on the lines of the growing walls: a second wall can't start on, or cross, them
  function lineCells(s) {
    const out = new Set();
    for (const w of wallList(s)) {
      if (!w.length) continue;
      const v = w[0], c = v ? w[2] : w[1];
      for (let i = 0; i < w[4]; i++) { const k = c - i; out.add(v ? `${w[1]},${k}` : `${k},${w[2]}`); }
      for (let i = 0; i < w[7]; i++) { const k = c + 1 + i; out.add(v ? `${w[1]},${k}` : `${k},${w[2]}`); }
    }
    return out;
  }
  function shatters(prev, w) {
    const out = [];
    for (let i = 0; i < 2; i++) {
      const st = w.length ? w[5 + i * 3] : '';
      if (prev[i] === 'g' && (st === 'd' || st === '') && g) g.lockFx = true;   // grew to the barrier and locked in
      if (prev[i] === 'g' && st === 'x') {
        const v = w[0], c = v ? w[2] : w[1], head = i === 0 ? c + 1 - w[3 + i * 3] : c + 1 + w[3 + i * 3];
        out.push(v ? [w[1] + 0.5, head, i] : [head, w[2] + 0.5, i]);
      }
      prev[i] = st;
    }
    return out;
  }

  // Pickup icons drawn with canvas paths (no emoji font needed): a shield with a check, an hourglass. 128x128 box.
  function drawPickupIcon(x, kind) {
    // a flat colour disc with a single bold white glyph: readable at a glance, no gradients or outlines to clutter it
    const col = kind === 'shield' ? '#17b36a' : kind === 'heart' ? '#e0245e' : '#f2a516';
    x.save(); x.translate(64, 64); x.lineJoin = x.lineCap = 'round';
    x.beginPath(); x.arc(0, 0, 58, 0, 6.283); x.fillStyle = col; x.fill();
    x.lineWidth = 5; x.strokeStyle = '#ffffffcc'; x.stroke();
    x.fillStyle = '#fff'; x.strokeStyle = '#fff';
    if (kind === 'shield') {
      x.beginPath(); x.moveTo(0, -32); x.lineTo(26, -22); x.lineTo(26, 2); x.quadraticCurveTo(24, 24, 0, 36); x.quadraticCurveTo(-24, 24, -26, 2); x.lineTo(-26, -22); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(-11, 2); x.lineTo(-3, 11); x.lineTo(12, -8); x.lineWidth = 8; x.strokeStyle = col; x.stroke();
    } else if (kind === 'heart') {
      x.beginPath(); x.moveTo(0, 32); x.bezierCurveTo(-46, 4, -34, -34, -1, -16); x.bezierCurveTo(34, -34, 46, 4, 0, 32); x.closePath(); x.fill();
    } else {
      x.beginPath(); x.moveTo(-20, -32); x.lineTo(20, -32); x.lineTo(4, -2); x.lineTo(20, 32); x.lineTo(-20, 32); x.lineTo(-4, -2); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(-11, 28); x.lineTo(11, 28); x.lineTo(0, 12); x.closePath(); x.fillStyle = col; x.fill();
    }
    x.restore();
  }

  // ---------- flat renderer ----------
  function flatRenderer(stage) {
    const canvas = document.createElement('canvas');
    canvas.className = 'rs-canvas';
    stage.append(canvas);
    const c = canvas.getContext('2d');
    if (!c) { canvas.remove(); return null; }
    const fx = true;   // glow is core to the look: only the Sharp toggle turns it off
    const flatRoll = [], strikes = [], lastRects = [], bounceFx = [];
    let bgLayer = null, cellLayer = null, cellKey = null, bgTheme = null;
    let size = [0, 0], lastGrid = '0'.repeat(g.W * g.H), animUntil = 0, last = 0, shake = 0;
    const born = new Float32Array(g.W * g.H), pending = [], parts = [], hist = [], prevHalf = [['', ''], ['', '']];
    const icons = {};
    const icon = (kind) => icons[kind] ||= (() => { const k = document.createElement('canvas'); k.width = k.height = 128; const x = k.getContext('2d'); if (x) drawPickupIcon(x, kind); return k; })();
    const burst = (x, y, n, color, speed = 6) => {
      if (!fx) return;
      for (let i = 0; i < n && parts.length < 240; i++) {
        const a = Math.random() * 6.283, v = speed * (0.35 + Math.random() * 0.8);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 0.5 + Math.random() * 0.5, c: Math.random() < 0.35 ? '#fff' : color });
      }
    };
    return {
      pick(e) {
        const r = canvas.getBoundingClientRect();
        return { x: Math.floor((e.clientX - r.left) / r.width * g.W), y: Math.floor((e.clientY - r.top) / r.height * g.H) };
      },
      draw(s, now) {
        const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
        if (!w || !h) return;   // mid-zoom or hidden: nothing to draw into
        if (size[0] !== w || size[1] !== h || size[2] !== dpr) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); size = [w, h, dpr]; }
        const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000)); last = now;
        const k = canvas.width / g.W;
        c.setTransform(k, 0, 0, k, 0, 0);
        if (shake > 0.02) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.exp(-dt * 7); } else shake = 0;
        // the backdrop and grid never change: paint them once per size and blit
        if (!bgLayer || bgLayer.width !== canvas.width || bgLayer.height !== canvas.height || bgTheme !== effTheme()) {
          bgTheme = effTheme();
          bgLayer = document.createElement('canvas'); bgLayer.width = canvas.width; bgLayer.height = canvas.height;
          const b = bgLayer.getContext('2d'); b.setTransform(k, 0, 0, k, 0, 0);
          const bg = b.createRadialGradient(g.W / 2, g.H / 2, 2, g.W / 2, g.H / 2, g.W * 0.65);
          bg.addColorStop(0, THM().bgA); bg.addColorStop(1, THM().bgB);
          b.fillStyle = bg; b.fillRect(0, 0, g.W, g.H);
          b.strokeStyle = THM().flatGrid; b.lineWidth = 0.04; b.beginPath();
          for (let x = 0; x <= g.W; x++) { b.moveTo(x, 0); b.lineTo(x, g.H); }
          for (let y = 0; y <= g.H; y++) { b.moveTo(0, y); b.lineTo(g.W, y); }
          b.stroke(); cellKey = null;
        }
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(bgLayer, 0, 0); c.restore();
        if (s.grid !== lastGrid) {
          const r = ripple(lastGrid, s.grid, now, born);
          if (fx) pending.push(...r.sparks);
          lastGrid = s.grid; animUntil = r.until;
        }
        // sealed cells: interior darker, cells touching open space lit like a rim; new ones rise in
        const open = (i, x, y) => (x > 0 && s.grid[i - 1] === '0') || (x < g.W - 1 && s.grid[i + 1] === '0') || (y > 0 && s.grid[i - g.W] === '0') || (y < g.H - 1 && s.grid[i + g.W] === '0');
        const settled = now >= animUntil + 60;
        if (settled) {   // at rest: one cached layer instead of ~2 fills per sealed cell per frame
          if (cellKey?.[0] !== s.grid || cellKey[1] !== s.color || cellKey[2] !== canvas.width) {
            cellKey = [s.grid, s.color, canvas.width];
            if (!cellLayer || cellLayer.width !== canvas.width || cellLayer.height !== canvas.height) { cellLayer = document.createElement('canvas'); cellLayer.width = canvas.width; cellLayer.height = canvas.height; }
            const lc = cellLayer.getContext('2d'); lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, cellLayer.width, cellLayer.height); lc.setTransform(k, 0, 0, k, 0, 0);
            for (let i = 0; i < s.grid.length; i++) {
              if (s.grid[i] !== '1') continue;
              const x = i % g.W, y = (i - x) / g.W;
              lc.fillStyle = s.color; lc.fillRect(x, y, 1, 1);
              lc.fillStyle = open(i, x, y) ? '#ffffff55' : '#00000030'; lc.fillRect(x, y, 1, 1);
            }
          }
          c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(cellLayer, 0, 0); c.restore();
        } else {
          for (let i = 0; i < s.grid.length; i++) {
            if (s.grid[i] !== '1') continue;
            const x = i % g.W, y = (i - x) / g.W, t = now < animUntil + 60 ? Math.max(0, Math.min(1, (now - born[i]) / 350)) : 1;
            if (t <= 0) continue;
            const e = 1 - (1 - t) ** 3, inset = (1 - e) * 0.4;
            c.globalAlpha = e;
            c.fillStyle = s.color;
            c.fillRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
            c.fillStyle = open(i, x, y) ? '#ffffff55' : '#00000030';
            c.fillRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
          }

        }
        c.globalAlpha = 1;
        for (const p of s.p) {
          const sz = 1.35 + 0.12 * Math.sin(now / 260 + p[0]), tint = p[2] === 'shield' ? '#59ff9a' : p[2] === 'heart' ? '#ff6fa0' : '#ffd84a';
          if (!g.nofx) {
            const gl = c.createRadialGradient(p[0] + 0.5, p[1] + 0.5, 0, p[0] + 0.5, p[1] + 0.5, 1.3);
            gl.addColorStop(0, tint + '88'); gl.addColorStop(1, tint + '00');
            c.fillStyle = gl; c.fillRect(p[0] - 1, p[1] - 1, 3, 3);
          }
          c.drawImage(icon(p[2]), p[0] + 0.5 - sz / 2, p[1] + 0.5 - sz / 2, sz, sz);
        }
        // growing walls: a bright core inside a pulsing glow
        c.save();
                for (const [x0, x1, y0, y1, st, i] of wallList(s).flatMap(wallRects)) {
          const wide = x1 - x0 >= y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hc = HALF[i];
          c.globalAlpha = 0.3 + 0.2 * Math.sin(now / 90); c.fillStyle = hc; if (!g.nofx) c.fillRect(x0 - 0.2, y0 - 0.2, x1 - x0 + 0.4, y1 - y0 + 0.4);   // glow without shadowBlur (slow on phones)
          c.globalAlpha = 0.5; c.fillRect(x0, y0, x1 - x0, y1 - y0);
          c.globalAlpha = 1; c.fillStyle = '#fff';
          c.fillRect(x0, y0, x1 - x0, y1 - y0);   // the growing line is as wide as a finished one
          const hx = wide ? (i === 0 ? x0 : x1) : cx, hy = wide ? cy : (i === 0 ? y0 : y1);
          if (fx && Math.random() < 0.4) burst(hx, hy, 1, hc, 2);
          if (!g.nofx) {
            const tip = c.createRadialGradient(hx, hy, 0, hx, hy, 1.4);
            tip.addColorStop(0, '#ffffffee'); tip.addColorStop(0.4, hc + 'aa'); tip.addColorStop(1, hc + '00');
            c.fillStyle = tip; c.fillRect(hx - 1.5, hy - 1.5, 3, 3);
          }
        }
        c.restore();
        const hits = shattersAll(prevHalf, s);
        for (const [x, y, i] of hits) { burst(x, y, 34, '#ff4d4d', 8); shake = 0.3; }
        trackStrikes(strikes, lastRects, s, now, hits);
        for (const q of strikes) {   // the struck line flashes white, then red, and fades
          const a = 1 - (now - q.t) / STRIKE_MS, on = Math.floor((now - q.t) / 70) % 2 === 0;
          c.globalAlpha = Math.max(0, a) * (on ? 1 : 0.55); c.fillStyle = on ? '#ff2a4d' : '#ffb3bf';
          c.fillRect(q.r[0] - 0.1, q.r[2] - 0.1, q.r[1] - q.r[0] + 0.2, q.r[3] - q.r[2] + 0.2);
        }
        c.globalAlpha = 1;
        if (s.ghost) {   // where the wall would run: a faint fill with a dashed outline
          const pulse = 0.65 + 0.25 * Math.sin(now / 180);
          c.fillStyle = s.ghost[4] ? `rgba(255,64,80,${0.12 * pulse})` : `rgba(109,240,200,${0.13 * pulse})`;
          c.shadowColor = s.ghost[4] ? '#ff4050' : '#6df0c8'; c.shadowBlur = 0.25 + pulse * 0.3; c.fillRect(...s.ghost.slice(0, 4)); c.shadowBlur = 0;
          c.setLineDash([0.35, 0.22]); c.lineWidth = 0.09; c.strokeStyle = s.ghost[4] ? '#ff6677' : '#9dffe0'; c.strokeRect(s.ghost[0] + 0.045, s.ghost[1] + 0.045, s.ghost[2] - 0.09, s.ghost[3] - 0.09); c.setLineDash([]);
        }
        // orbs: tail, glow, core
        s.b.forEach((b, i) => {
          const hh = hist[i] ||= [];
          if (!hh.at || now - hh.at > 22) { hh.unshift([b[0], b[1]]); hh.length = Math.min(hh.length, 7); hh.at = now; }
          if (fx && !g.nofx && i < 16) hh.forEach((q, j) => {
            const f = 1 - (j + 1) / 8, gl = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], 0.75 * f);
            gl.addColorStop(0, RED + '77'); gl.addColorStop(1, RED + '00');
            c.fillStyle = gl; c.fillRect(q[0] - 1, q[1] - 1, 2, 2);
          });
          if (!g.nofx) {
            const gl = c.createRadialGradient(b[0], b[1], 0, b[0], b[1], 1.2);
            gl.addColorStop(0, '#ffffffcc'); gl.addColorStop(0.35, RED + '55'); gl.addColorStop(1, RED + '00');
            c.fillStyle = gl; c.fillRect(b[0] - 1.3, b[1] - 1.3, 2.6, 2.6);
          }
          // two hemispheres, red and white, turning as the orb travels
          // it rolls: the turn follows the distance travelled, so a fast orb spins fast and a slowed one barely turns;
          // the split swings between edge-on and pole-on (one colour) as it rolls
          const fs = (flatRoll[i] ||= { x: b[0], y: b[1], ph: i * 1.3, hd: 0 });
          const mvx = b[0] - fs.x, mvy = b[1] - fs.y, dist = Math.hypot(mvx, mvy);
          if ((Math.abs(mvx) > 0.012 && Math.abs(fs.dx || 0) > 0.012 && mvx * fs.dx < 0)
              || (Math.abs(mvy) > 0.012 && Math.abs(fs.dy || 0) > 0.012 && mvy * fs.dy < 0)) {
            if (!g.nofx) { burst(b[0], b[1], 9, RED, 4.5); bounceFx.push({ x: b[0], y: b[1], age: 0 }); }
          }
          if (Math.abs(mvx) + Math.abs(mvy) > 0.002) { fs.dx = mvx; fs.dy = mvy; }
          if (dist > 1e-4 && dist < 3) { fs.ph += dist / 0.36; fs.hd = Math.atan2(mvy, mvx) + Math.PI / 2; }
          fs.x = b[0]; fs.y = b[1];
          const tt = Math.cos(fs.ph);
          c.save(); c.translate(b[0], b[1]); c.rotate(fs.hd);
          c.fillStyle = RED; c.beginPath(); c.arc(0, 0, 0.36, Math.PI, 0); c.fill();
          c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 0.36, 0, Math.PI); c.fill();
          if (Math.abs(tt) > 0.02) { c.fillStyle = tt > 0 ? RED : '#fff'; c.beginPath(); c.ellipse(0, 0, 0.36, 0.36 * Math.abs(tt), 0, tt > 0 ? 0 : Math.PI, tt > 0 ? Math.PI : 2 * Math.PI); c.fill(); }
          c.restore();
        });
        hist.length = s.b.length;
        for (let i = bounceFx.length - 1; i >= 0; i--) {
          const fx = bounceFx[i]; fx.age += dt;
          if (fx.age >= 0.34) { bounceFx.splice(i, 1); continue; }
          const p = fx.age / 0.34;
          c.globalAlpha = 1 - p; c.strokeStyle = '#fff2f2'; c.lineWidth = 0.08 * (1 - p * 0.45);
          c.beginPath(); c.arc(fx.x, fx.y, 0.35 + p * 0.8, 0, Math.PI * 2); c.stroke();
        }
        for (let q = pending.length - 1; q >= 0; q--) if (pending[q][0] <= now) { burst(pending[q][1], pending[q][2], pending[q][3], s.color, 4); pending.splice(q, 1); }
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i]; q.l -= dt;
          if (q.l <= 0) { parts.splice(i, 1); continue; }
          q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= Math.exp(-3 * dt); q.vy *= Math.exp(-3 * dt);
          c.globalAlpha = Math.min(1, q.l * 2); c.fillStyle = q.c; c.fillRect(q.x - 0.07, q.y - 0.07, 0.14, 0.14);
        }
        c.globalAlpha = 1;
      },
      view() { canvas.style.transform = g.zoom > 1 ? `scale(${g.zoom}) translate(${(-g.panX / g.W * 100).toFixed(2)}%, ${(g.panY / g.H * 100).toFixed(2)}%)` : ''; },
      dispose() { canvas.remove(); },
    };
  }

  // ---------- three.js renderer ----------
  function threeRenderer(T, stage, onLost) {
    const renderer = GL3.renderer({}, { onLost });
    if (!renderer) return null;
    // GL3 stores every colour linear and marks canvas textures sRGB; the output has to be sRGB too (as GL3.stage does)
    // or the whole scene, sealed cells included, comes out dark. No tone mapping, so colours stay as authored.
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x060a1c, 1);
    const canvas = renderer.domElement;
    canvas.className = 'rs-canvas';
    stage.append(canvas);
    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(34, 1, 1, 200);
    const gx = (x) => x - g.W / 2, gy = (y) => g.H / 2 - y;
    // cool sky / warm floor bounce, one soft key from the upper left, and a faint rim from the opposite side
    scene.add(new T.HemisphereLight(0x8fb4ff, 0x1a1030, 0.6));
    const sun = new T.DirectionalLight(0xfff1dc, 0.85); sun.position.set(-12, 10, 22); scene.add(sun);
    const rim = new T.DirectionalLight(0x4aa8ff, 0.35); rim.position.set(14, -8, 10); scene.add(rim);
    // the first few orbs light the field around them (skipped on the Low graphics setting)
    const orbLights = GL3.level() === 'low' ? [] : [0, 1, 2].map(() => { const l = new T.PointLight(0xffffff, 0, 9, 1.6); l.position.z = 1.4; scene.add(l); return l; });

    // Floor with a grid.
    const tex = document.createElement('canvas'); tex.width = g.W * 48; tex.height = g.H * 48;   // 48 px per cell: grid lines stay crisp when the camera zooms in
    const TW = tex.width, TH = tex.height;
    const t = tex.getContext('2d');
    t.fillStyle = THM().floor; t.fillRect(0, 0, TW, TH);
    t.strokeStyle = THM().grid; t.lineWidth = 2.5;
    for (let i = 0; i <= g.W; i++) { t.beginPath(); t.moveTo(i * TW / g.W, 0); t.lineTo(i * TW / g.W, TH); t.stroke(); }
    for (let i = 0; i <= g.H; i++) { t.beginPath(); t.moveTo(0, i * TH / g.H); t.lineTo(TW, i * TH / g.H); t.stroke(); }
    const vg = t.createRadialGradient(TW / 2, TH / 2, TH * 0.3, TW / 2, TH / 2, TW * 0.6);   // darken the corners so the field glows from the middle
    vg.addColorStop(0, '#0000'); vg.addColorStop(1, '#02061a99');
    t.fillStyle = vg; t.fillRect(0, 0, TW, TH);
    const floorTex = new T.CanvasTexture(tex); floorTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const floor = new T.Mesh(new T.PlaneGeometry(g.W, g.H), new T.MeshStandardMaterial({ map: floorTex, emissive: 0xffffff, emissiveMap: floorTex, emissiveIntensity: 0.85, roughness: 0.85, metalness: 0 }));
    scene.add(floor);
    const frame = new T.Mesh(new T.BoxGeometry(g.W + 1, g.H + 1, 0.5), new T.MeshStandardMaterial({ color: THM().frame, roughness: 0.6 }));
    frame.position.z = -0.4; scene.add(frame);
    // a deep gradient backdrop with a scatter of faint stars behind the field
    const bgc = document.createElement('canvas'); bgc.width = 256; bgc.height = 160;
    const bgx = bgc.getContext('2d'), bgg = bgx.createRadialGradient(128, 80, 10, 128, 80, 150);
    bgg.addColorStop(0, THM().bgA); bgg.addColorStop(0.6, THM().bgM); bgg.addColorStop(1, THM().bgB);
    bgx.fillStyle = bgg; bgx.fillRect(0, 0, 256, 160);
    const backdrop = new T.Mesh(new T.PlaneGeometry(g.W * 3.2, g.H * 3.2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(bgc) }));
    backdrop.position.z = -3; scene.add(backdrop);
    if (GL3.level() !== 'low') {
      const n = 140, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * g.W * 2.6, (Math.random() - 0.5) * g.H * 2.6, -2.5], i * 3);
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3));
      scene.add(new T.Points(sg, new T.PointsMaterial({ size: 0.28, color: 0x9bb8ff, transparent: true, opacity: 0.55, depthWrite: false })));
    }
    // lit edges: four thin bars in the board colour, pulsing softly
    const edgeMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const edges = [[g.W + 1, 0.16, 0, g.H / 2 + 0.5], [g.W + 1, 0.16, 0, -g.H / 2 - 0.5], [0.16, g.H + 1, g.W / 2 + 0.5, 0], [0.16, g.H + 1, -g.W / 2 - 0.5, 0]]
      .map(([ew, eh, ex, ey]) => { const m = new T.Mesh(new T.BoxGeometry(ew, eh, 0.3), edgeMat); m.position.set(ex, ey, -0.1); scene.add(m); return m; });

    // Sealed cells: one instanced mesh; new cells rise up.
    const blocks = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff, map: (() => {   // a soft bevel: light top-left edge, shaded bottom-right, flat centre
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      if (x) {
        x.fillStyle = '#e6e6e6'; x.fillRect(0, 0, 64, 64);
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 5); x.fillRect(0, 0, 5, 64);
        x.fillStyle = '#b4b4b4'; x.fillRect(0, 59, 64, 5); x.fillRect(59, 0, 5, 64);
        x.fillStyle = '#ffffff'; x.fillRect(10, 10, 44, 44);
      }
      return new T.CanvasTexture(c);
    })() }), g.W * g.H);   // unlit: colour is exactly what is set per cell
    blocks.setColorAt(0, new T.Color(0xffffff));   // allocates the per-cell colour buffer; this three.js sizes it from .count, so it must run before count is zeroed
    blocks.count = 0; scene.add(blocks);
    const rimCol = new T.Color(), pending = [];   // pending: seal sparks waiting for the ripple to reach their cell
    const born = new Float32Array(g.W * g.H);
    let lastGrid = '0'.repeat(g.W * g.H), animUntil = 0;
    const rollAxis = new T.Vector3(), zAxis = new T.Vector3(0, 0, 1);
    const dummy = new T.Object3D(), white = new T.Color(0xffffff), rimF = new Uint8Array(g.W * g.H);
    let rimFor = null;

    // Effects (glow, trails, sparks) are skipped on the app's Low graphics setting.
    const fx = true;
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, '#fff'); grad.addColorStop(0.3, '#ffffffaa'); grad.addColorStop(1, '#fff0');
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();
    const sprite = (opacity) => {
      const m = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false }));
      m.visible = false; scene.add(m); return m;
    };
    // One pooled Points object carries every spark; dead slots sit far off-screen.
    const CAP = 320, pPos = new Float32Array(CAP * 3).fill(-999), pCol = new Float32Array(CAP * 3);
    const pVel = new Float32Array(CAP * 3), pLife = new Float32Array(CAP);
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const sparks = new T.Points(pGeo, new T.PointsMaterial({ size: 0.38, map: glowTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; scene.add(sparks);
    let pNext = 0;
    const tmpCol = new T.Color();
    const burst = (x, y, n, color, speed = 6) => {
      if (!fx) return;
      tmpCol.set(color);
      for (let k = 0; k < n; k++) {
        const i = pNext++ % CAP, a = Math.random() * 6.283, v = speed * (0.35 + Math.random() * 0.8);
        pPos.set([gx(x), gy(y), 0.6], i * 3);
        pVel.set([Math.cos(a) * v, -Math.sin(a) * v, (Math.random() - 0.3) * v * 0.5], i * 3);
        const white = Math.random() < 0.35;
        pCol.set(white ? [1, 1, 1] : [tmpCol.r, tmpCol.g, tmpCol.b], i * 3);
        pLife[i] = 0.5 + Math.random() * 0.5;
      }
    };
    const stepSparks = (dt) => {
      let live = false;
      for (let i = 0; i < CAP; i++) {
        if (pLife[i] <= 0) continue;
        pLife[i] -= dt; live = true;
        const k = i * 3;
        if (pLife[i] <= 0) { pPos[k + 2] = -999; continue; }
        pPos[k] += pVel[k] * dt; pPos[k + 1] += pVel[k + 1] * dt; pPos[k + 2] += pVel[k + 2] * dt;
        const d = Math.exp(-3 * dt); pVel[k] *= d; pVel[k + 1] *= d; pVel[k + 2] *= d;
      }
      if (live || sparks.userData.live) pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = true;
      sparks.userData.live = live;
    };
    // bounce shockwave: a pooled set of expanding rings
    const ringTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 14, 32, 32, 31);
      gr.addColorStop(0, '#fff0'); gr.addColorStop(0.7, '#ffffffee'); gr.addColorStop(1, '#fff0');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();
    const rings = Array.from({ length: 10 }, () => { const m = new T.Sprite(new T.SpriteMaterial({ map: ringTex, color: 0xff8a8a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); m.visible = false; m.userData = { t: 1 }; scene.add(m); return m; });
    let ringNext = 0;
    const ring = (x, y) => { const m = rings[ringNext++ % rings.length]; m.position.set(gx(x), gy(y), 0.55); m.userData.t = 0; m.visible = true; };
    const stepRings = (dt) => { for (const m of rings) { if (m.userData.t >= 1) continue; m.userData.t = Math.min(1, m.userData.t + dt * 3.2); const k = m.userData.t; m.scale.set(0.8 + k * 3.4, 0.8 + k * 3.4, 1); m.material.opacity = 0.9 * (1 - k); if (k >= 1) m.visible = false; } };
    const mats = {
      ball: (() => {   // red upper hemisphere, white lower; the mesh spins so the split turns. Mostly self-lit, with a glossy highlight
        const c = document.createElement('canvas'); c.width = 64; c.height = 128;
        const x = c.getContext('2d');
        if (x) { x.fillStyle = '#e8262b'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ffffff'; x.fillRect(0, 64, 64, 64); }
        const tx = new T.CanvasTexture(c);
        return new T.MeshPhongMaterial({ map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0.55, specular: 0xffffff, shininess: 70 });
      })(),
      core: HALF.map((hex) => new T.MeshBasicMaterial({ color: new T.Color(hex).lerp(new T.Color(0xffffff), 0.55) })),
      glow: HALF.map((hex) => new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false })),
      ghost: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
    };
    const balls = [], trails = [];
    const beamGeo = new T.BoxGeometry(1, 1, 0.9);
    const halves = [0, 1, 2, 3].map((i) => { const m = new T.Mesh(beamGeo, mats.core[i & 1]); m.visible = false; scene.add(m); return m; });
    const glows = [0, 1, 2, 3].map((i) => { const m = new T.Mesh(beamGeo, mats.glow[i & 1]); m.visible = false; scene.add(m); return m; });
    const strikes = [], lastRects = [];
    const strikeMeshes = [0, 1, 2, 3].map(() => { const m = new T.Mesh(beamGeo, new T.MeshBasicMaterial({ color: 0xff2a4d, transparent: true, depthWrite: false })); m.visible = false; scene.add(m); return m; });
    const tips = [sprite(0.9), sprite(0.9), sprite(0.9), sprite(0.9)];
    const prevHalf = [['', ''], ['', '']];
    const ghost = new T.Mesh(new T.BoxGeometry(1, 1, 0.3), mats.ghost); ghost.visible = false; scene.add(ghost);
    ghost.add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: 0xffffff })));   // the outline hint
    const pickMeshes = new Map();
    const pickTexs = {};
    const pickTex = (kind) => pickTexs[kind] ||= (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      if (x) drawPickupIcon(x, kind);
      return new T.CanvasTexture(c);
    })();
    const sphere = new T.SphereGeometry(0.34, 20, 14);
    let lastNow = 0;
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 0, 1), 0), hit = new T.Vector3();
    let w = 0, h = 0, lastDpr = 0, lastTilt = null;
    const camBase = new T.Vector3();

    function resize() {
      const cw = stage.clientWidth, ch = stage.clientHeight, dpr = devicePixelRatio || 1;
      if (!cw || !ch || (cw === w && ch === h && dpr === lastDpr && g.tilt === lastTilt)) return;   // zooming changes the pixel ratio even when the CSS size holds
      w = cw; h = ch; lastDpr = dpr; lastTilt = g.tilt; renderer.setSize(w, h, false);
      cam.aspect = w / h;
      const need = Math.max((g.H / 2 + 1.2) / Math.tan(cam.fov * Math.PI / 360), (g.W / 2 + 1.2) / (Math.tan(cam.fov * Math.PI / 360) * cam.aspect));
      const tilt = g.tilt && cam.aspect <= g.W / g.H ? 0.22 : 0;   // straight down by default; a very wide stage has no spare height for the tilt
      cam.position.set(0, -need * tilt, need * (tilt ? 0.97 : 1)); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      camBase.copy(cam.position);
    }
    // cross < 1 thins the box across its short side (a bright core inside a wider glow)
    const box = (m, x0, x1, y0, y1, z, cross = 1) => {
      const wide = x1 - x0 >= y1 - y0;
      m.visible = true; m.scale.set(wide ? x1 - x0 : cross * (x1 - x0), wide ? cross * (y1 - y0) : y1 - y0, 0.9);
      m.position.set(gx((x0 + x1) / 2), gy((y0 + y1) / 2), z);
    };
    return {
      pick(e) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1)), cam);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return { x: Math.floor(hit.x + g.W / 2), y: Math.floor(g.H / 2 - hit.y) };
      },
      draw(s, now) {
        resize();
        const col = new T.Color(s.color);
        mats.ghost.color.set(s.ghost?.[4] ? 0xff4050 : 0xffffff);
        mats.ghost.opacity = s.ghost?.[4] ? 0.22 : 0.12;
        edgeMat.color.copy(col); edgeMat.opacity = 0.6 + 0.2 * Math.sin(now / 700);
        const dt = Math.min(0.05, Math.max(0, (now - (lastNow || now)) / 1000)); lastNow = now;
        if (s.grid !== lastGrid) {
          const r = ripple(lastGrid, s.grid, now, born);
          if (fx) pending.push(...r.sparks);
          lastGrid = s.grid; animUntil = r.until;
        }
        if (now < animUntil + 60 || blocks.userData.col !== s.color) {
          // no allocations in here: it runs for every sealed cell on every frame of the rise animation
          if (rimFor !== s.grid) {   // which cells touch open space only changes with the grid, not per frame
            rimFor = s.grid;
            for (let i = 0; i < s.grid.length; i++) {
              const x = i % g.W, y = (i - x) / g.W;
              rimF[i] = (x > 0 && s.grid[i - 1] === '0') || (x < g.W - 1 && s.grid[i + 1] === '0') || (y > 0 && s.grid[i - g.W] === '0') || (y < g.H - 1 && s.grid[i + g.W] === '0') ? 1 : 0;
            }
          }
          let n = 0;
          const settled = now >= animUntil;
          for (let i = 0; i < s.grid.length; i++) {
            if (s.grid[i] !== '1') continue;
            const x = i % g.W, y = (i - x) / g.W, k = settled ? 1 : Math.max(0, Math.min(1, (now - born[i]) / 350)), z = 0.15 + 0.35 * (1 - (1 - k) ** 3);
            dummy.position.set(x + 0.5 - g.W / 2, g.H / 2 - (y + 0.5), z / 2 - 0.05);
            dummy.scale.set(1, 1, z); dummy.updateMatrix();
            if (rimF[i]) rimCol.copy(col).lerp(white, 0.3); else rimCol.copy(col).multiplyScalar(0.62 + 0.06 * ((x + y) & 1));   // deep, faintly checkered interior; bright lit rim
            blocks.setColorAt(n, rimCol);
            blocks.setMatrixAt(n++, dummy.matrix);
          }
          if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
          blocks.count = n; blocks.instanceMatrix.needsUpdate = true;
          blocks.userData.col = s.color;
        }
        while (balls.length < s.b.length) {
          const m = new T.Mesh(sphere, mats.ball), halo = sprite(0.55);
          halo.material.opacity = 0.8; halo.visible = true; halo.scale.set(3.2, 3.2, 1); m.add(halo);
          const sh = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));   // soft contact shadow on the floor
          sh.scale.set(1.5, 1.5, 1); scene.add(sh);
          m.userData = { halo, sh, pulse: 0, last: null };
          scene.add(m); balls.push(m);
          if (fx && balls.length <= 16) trails[balls.length - 1] = Array.from({ length: 7 }, () => sprite(0));
        }
        balls.forEach((m, i) => {
          m.visible = i < s.b.length; m.userData.sh.visible = m.visible;
          if (orbLights[i]) orbLights[i].intensity = 0;
          if (!m.visible) return;
          const bx = s.b[i][0], by = s.b[i][1], u = m.userData;
          // a flip in direction is a bounce: flare the glow and throw a few sparks
          if (u.last && u.dir) {
            const dx = bx - u.last[0], dy = by - u.last[1];
            if (Math.abs(dx) > 0.004 && Math.abs(u.dir[0]) > 0.004 && dx * u.dir[0] < 0 || Math.abs(dy) > 0.004 && Math.abs(u.dir[1]) > 0.004 && dy * u.dir[1] < 0) {
              u.pulse = 1; burst(bx, by, 9, RED, 4.5); ring(bx, by); if (window.Snd && now - (g.bounceT ?? 0) > 90) { g.bounceT = now; Snd.play((t, K) => { const d = K.at({ send: 0.15 }); K.mode(d, t, 1500, 0.05, 0.05); }); }
            }
            if (Math.abs(dx) + Math.abs(dy) > 0.002) u.dir = [dx, dy];
          } else if (u.last) u.dir = [bx - u.last[0], by - u.last[1]];
          u.last = [bx, by]; u.pulse = Math.max(0, u.pulse - dt * 4);
          m.position.set(gx(bx), gy(by), 0.5); m.userData.sh.position.set(gx(bx) + 0.12, gy(by) - 0.12, 0.06);
          // the ball rolls: it turns about the axis across its path, at the rate that matches how fast it is moving
          // (distance / radius), with a little wobble so a pole sometimes faces the camera and one colour shows
          if (u.px !== undefined && dt > 0) {
            const mx = bx - u.px, my = -(by - u.py), dist = Math.hypot(mx, my);
            if (dist > 1e-5 && dist < 3) { rollAxis.set(-my, mx, 0).normalize(); m.rotateOnWorldAxis(rollAxis, dist / 0.34); }
            u.wob = (u.wob || 0) + dt;
            m.rotateOnWorldAxis(zAxis, Math.sin(u.wob * 1.7 + i) * 0.012);
          }
          u.px = bx; u.py = by;
          const light = orbLights[i];
          if (light) { light.position.set(gx(bx), gy(by), 1.4); light.color.set('#ff8a8a'); light.intensity = 1.1 + u.pulse * 1.2; }
          const gs = 3.2 + u.pulse * 2.4;
          u.halo.scale.set(gs, gs, 1); u.halo.material.color.set('#ff6a6a');
          const tr = trails[i];
          if (tr) {   // a fading tail: each sprite follows the one ahead of it
            u.hist = u.hist || [];
            if (!u.histAt || now - u.histAt > 22) { u.hist.unshift([bx, by]); u.hist.length = Math.min(u.hist.length, tr.length); u.histAt = now; }
            tr.forEach((sp, j) => {
              const q = u.hist[j];
              sp.visible = !!q;
              if (!q) return;
              sp.position.set(gx(q[0]), gy(q[1]), 0.45);
              const k = 1 - (j + 1) / (tr.length + 1);
              sp.scale.set(1.5 * k, 1.5 * k, 1); sp.material.opacity = 0.4 * k; sp.material.color.set('#ff6a6a');
            });
          }
        });
        const rects = [], wl = wallList(s);
        wl.forEach((w, wi) => { for (const r of wallRects(w)) rects[wi * 2 + r[5]] = r; });
        const pulse = 0.35 + 0.15 * Math.sin(now / 90);
        halves.forEach((m, k) => {
          m.visible = glows[k].visible = tips[k].visible = false;
          const r = rects[k], i = k & 1, w = wl[k >> 1];
          if (r) {
            box(m, r[0], r[1], r[2], r[3], 0.45, 1.0);   // as wide as a finished line
            box(glows[k], r[0], r[1], r[2], r[3], 0.45, 1.5);
            mats.glow[i].opacity = 0.3 + 0.2 * Math.sin(now / 90);
            const v = w[0], head = i === 0 ? [v ? r[2] : r[0]] : [v ? r[3] : r[1]];
            tips[k].visible = true;
            tips[k].position.set(gx(v ? w[1] + 0.5 : head[0]), gy(v ? head[0] : w[2] + 0.5), 0.8);
            tips[k].scale.set(2.6 + pulse, 2.6 + pulse, 1); tips[k].material.color.set(HALF[i]);
            if (fx && Math.random() < 0.4) burst(v ? w[1] + 0.5 : head[0], v ? head[0] : w[2] + 0.5, 1, HALF[i], 2);
          }
        });
        const hits = shattersAll(prevHalf, s);
        for (const [x, y] of hits) { burst(x, y, 34, 0xff4d4d, 8); GL3.shake(cam, 0.32); }
        trackStrikes(strikes, lastRects, s, now, hits);
        strikeMeshes.forEach((m, j) => {   // the struck line flashes white, then red, and fades
          const q = strikes[j];
          if (!q) { m.visible = false; return; }
          const on = Math.floor((now - q.t) / 70) % 2 === 0;
          box(m, q.r[0] - 0.1, q.r[1] + 0.1, q.r[2] - 0.1, q.r[3] + 0.1, 0.6, 1);
          m.material.color.set(on ? 0xff2a4d : 0xffb3bf); m.material.opacity = Math.max(0, 1 - (now - q.t) / STRIKE_MS) * (on ? 1 : 0.6);
        });
        if (s.ghost) box(ghost, s.ghost[0], s.ghost[0] + s.ghost[2], s.ghost[1], s.ghost[1] + s.ghost[3], 0.2); else ghost.visible = false;
        ghost.material.color.set(s.ghost?.[4] ? 0xff4050 : 0xffffff);
        ghost.children[0].material.color.set(s.ghost?.[4] ? 0xff6677 : 0xffffff);
        // pickups persist between frames (keyed by cell) and only spin
        const keep = new Set();
        for (const p of s.p) {
          const key = `${p[0]},${p[1]},${p[2]}`;
          keep.add(key);
          let m = pickMeshes.get(key);
          if (!m) {
            m = new T.Sprite(new T.SpriteMaterial({ map: pickTex(p[2]), transparent: true, depthWrite: false }));
            m.position.set(gx(p[0] + 0.5), gy(p[1] + 0.5), 0.7);
            m.userData = { pos: [p[0] + 0.5, p[1] + 0.5], tint: p[2] === 'shield' ? 0x59ff9a : p[2] === 'heart' ? 0xff6fa0 : 0xffd84a };
            const halo = sprite(0.5); halo.visible = true; halo.material.color.set(m.userData.tint); halo.scale.set(2.6, 2.6, 1); m.add(halo);
            scene.add(m); pickMeshes.set(key, m);
          }
          const bob = 1.35 + 0.12 * Math.sin(now / 260 + p[0]);
          m.scale.set(bob, bob, 1);
        }
        for (const [key, m] of pickMeshes) {
          if (keep.has(key)) continue;
          burst(m.userData.pos[0], m.userData.pos[1], 22, m.userData.tint, 6);   // collected (sealed in)
          scene.remove(m); m.material.dispose(); pickMeshes.delete(key);
        }
        for (let q = pending.length - 1; q >= 0; q--) if (pending[q][0] <= now) { burst(pending[q][1], pending[q][2], pending[q][3], s.color, 4); pending.splice(q, 1); }
        stepSparks(dt); stepRings(dt);
        cam.position.copy(camBase);
        if (g.zoom > 1 || g.panX || g.panY) { cam.position.set(camBase.x + g.panX, camBase.y + g.panY, camBase.z / g.zoom); cam.lookAt(g.panX, g.panY, 0); }   // zoom = dolly in, so it stays crisp
        else cam.lookAt(0, 0, 0);
        GL3.tickShake(cam, dt);
        if (g.nofx) {   // 'sharp' mode: no additive glows, halos, trails or sparks
          scene.traverse((o) => { if (o.isSprite && o.material.blending === T.AdditiveBlending) o.visible = false; });
          sparks.visible = false; glows.forEach((m) => { m.visible = false; });
        } else sparks.visible = true;
        renderer.render(scene, cam);
      },
      dispose() { renderer.dispose(); canvas.remove(); },
    };
  }

  // ---------- state ----------
  function receive(data) {
    if (!g || !data?.boards) return;
    if (data.tick < g.tick && data.rift === g.run) return;
    g.tick = data.tick; g.receivedAt = performance.now();
    Object.entries(data.boards).forEach(([pid, b], i) => {
      const prev = g.boards[pid] || (g.boards[pid] = { grid: '0'.repeat(g.W * g.H), color: COLORS[g.order.indexOf(pid) % 6] || COLORS[i % 6], b: [], bs: [], evSeen: b.ev[0], lv: b.lv });
      if (b.g) prev.grid = b.g;
      else if (b.rev !== prev.rev) prev.stale = true;
      prev.rev = b.rev;
      const before = prev.pct ?? 0;
      Object.assign(prev, { goal: b.goal || 0.75, w: b.w, p: b.p, lives: b.lives, score: b.score, pct: b.pct, st: b.st, lv: b.lv, mu: b.mu || 1, sh: b.sh, slow: b.slow, hd: b.hd || 0, w2: b.w2 || [], b: b.b });
      if (!prev.bs || prev.bs.length !== b.b.length) { prev.bs = b.b.map((q) => q.slice()); prev.bv = b.b.map(() => [0, 0]); }
      // orb velocity from the last two packets, so the drawn orbs keep moving between the ~30 Hz updates
      const dt = (g.receivedAt - (prev.at ?? 0)) / 1000;
      if (prev.last && prev.last.length === b.b.length && dt > 0.01 && dt < 0.2) {
        prev.bv = b.b.map((q, j) => [Math.max(-20, Math.min(20, (q[0] - prev.last[j][0]) / dt)), Math.max(-20, Math.min(20, (q[1] - prev.last[j][1]) / dt))]);
      }
      if (dt > 0.01 || !prev.at) { prev.last = b.b; prev.at = g.receivedAt; }
      if (b.ev[0] !== prev.evSeen) {
        prev.evSeen = b.ev[0];
        if (pid === g.me && g.ctx && !g.ctx.readOnly) { if (!voice(b.ev[1])) g.ctx.sfx(SND[b.ev[1]] || 'pop'); {
          const pw = POWER[b.ev[1]], gain = Math.round((b.pct - before) * 100), tot = Math.floor(b.pct * 100);
          if (pw) g.power(...pw);
          else if ((b.ev[1] === 'seal' || b.ev[1] === 'big') && gain > 0) {   // how much that wall took, and where the level stands
            const gl = b.goal || 0.75, goal = before < gl && b.pct >= gl, half = before < 0.5 && b.pct >= 0.5, q = before < 0.25 && b.pct >= 0.25;
            g.msg(goal ? `🎯 ${tot}% · goal reached! every extra % scores` : half ? `Halfway there · +${gain}% (${tot}%)` : q ? `A quarter done · +${gain}% (${tot}%)` : `${b.ev[1] === 'big' ? 'Huge seal' : 'Sealed'} +${gain}% · ${tot}% of the field`);
          } else g.msg(MSG[b.ev[1]] || '');
        } g.fx(b.ev[1]); try { const v = { hit: [60, 40, 90], over: [200], big: [30, 30, 30], life: [30, 30, 30], clear: [40, 40, 80] }[b.ev[1]]; if (v && (typeof prefs === 'undefined' || prefs.sound !== false)) navigator.vibrate?.(v); } catch { /* no haptics */ } }
      }
    });
    paint();
  }

  function mine() { return g.boards[g.me] || g.boards[g.watch]; }

  function paint() {
    const s = mine();
    if (!s) return;
    const sc = g.find('score'), scText = s.score.toLocaleString();
    if (sc.textContent !== scText) { sc.textContent = scText; sc.classList.remove('rs-bump'); void sc.offsetWidth; sc.classList.add('rs-bump'); }
    g.find('level').textContent = s.lv;
    const gp = Math.round((s.goal || 0.75) * 100) + '%';
    if (g.goalTxt !== gp) { g.goalTxt = gp; const gm = g.find('goal'); gm.style.left = gp; gm.dataset.g = gp; gm.title = gp + ' to clear'; }
    if (s === g.boards[g.me]) {
      if (g.lastLv != null && s.lv > g.lastLv && s.st === 'play') g.banner('LEVEL ' + s.lv + ' · ' + s.b.length + (s.b.length === 1 ? ' ORB' : ' ORBS') + ' · SEAL ' + Math.round((s.goal || 0.75) * 100) + '%', 'rs-banner-lv');
      g.lastLv = s.lv;
      if (g.syncTheme?.(s.lv)) g.banner('NEW WORLD · ' + THM().name.toUpperCase(), 'rs-banner-lv');
      if (g.solo && g.best > 0 && !g.beat && s.score > g.best && g.startBest > 0) { g.beat = true; g.banner('NEW BEST!', 'rs-banner-lv'); }
    }
    if (s === g.boards[g.me] && g.lastLives != null && s.lives < g.lastLives) {
      const el = g.find('lives'); el.classList.remove('rs-lost'); void el.offsetWidth; el.classList.add('rs-lost');
    }
    if (s === g.boards[g.me]) g.lastLives = s.lives;
    g.find('lives').textContent = (s.lives > 4 ? '❤️×' + s.lives : '❤️'.repeat(Math.max(0, s.lives))) + (s.sh ? '🛡️' : '');   // many lives collapse to ❤️×N so the HUD never grows tall
    const cb = g.find('combo');
    cb.hidden = !(s.mu > 1 && s.st === 'play');
    if (!cb.hidden && cb.dataset.mu !== String(s.mu)) { cb.dataset.mu = s.mu; cb.textContent = '🔥 ×' + s.mu + ' combo'; cb.classList.remove('rs-bump'); void cb.offsetWidth; cb.classList.add('rs-bump'); }
    g.find('slow').hidden = !(s.slow > 0);
    if (s.slow > 0) g.find('slow').textContent = '⏳ ' + Math.ceil(s.slow);
    if (s === g.boards[g.me] && g.lastScore != null && s.score > g.lastScore && s.st === 'play') g.pop('+' + (s.score - g.lastScore).toLocaleString());
    if (s === g.boards[g.me]) g.lastScore = s.score;
    if (g.me && s.score > g.best && g.solo) { g.best = s.score; store.set(g.best); }
    g.find('best').textContent = g.best ? g.best.toLocaleString() : '—';
    const list = g.find('standings');
    list.hidden = Object.keys(g.boards).length < 2;
    if (!list.hidden) {
      list.replaceChildren(...Object.entries(g.boards).sort((a, b) => b[1].score - a[1].score).map(([pid, b]) => {
        const li = document.createElement('li');
        li.style.setProperty('--rs-c', b.color);
        const cell = (cls, t) => { const e = document.createElement('span'); e.className = cls; e.textContent = t; return e; };
        li.append(cell('rs-n', g.ctx.player(pid)?.name || '?'), cell('rs-m', `Lv ${b.lv} · ${Math.floor(b.pct * 100)}%`), cell('rs-v', b.score.toLocaleString() + (b.st === 'over' ? ' ✖' : '')));
        if (pid === g.me) li.className = 'rs-me';
        return li;
      }));
    }
  }

  function place(cell, vertical) {
    const s = g.boards[g.me];
    if (!cell || !s || !g.enabled || s.st !== 'play' || s.w2?.length) return;
    if (!cellFree(s.grid, cell.x, cell.y) || lineCells(s).has(`${cell.x},${cell.y}`)) return;
    g.root.querySelector('.rs-coach')?.remove();
    clearTimeout(g.placeTimer);
    if (!g.nofx && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      g.stage.style.setProperty('--rs-place-x', `${(cell.x + 0.5) / g.W * 100}%`);
      g.stage.style.setProperty('--rs-place-y', `${(cell.y + 0.5) / g.H * 100}%`);
      g.stage.classList.remove('rs-place'); void g.stage.offsetWidth; g.stage.classList.add('rs-place');
      g.placeTimer = setTimeout(() => g.stage?.classList.remove('rs-place'), 420);
    }
    g.ctx.input({ x: cell.x, y: cell.y, v: vertical });
    if (!voice('place')) g.ctx.sfx('pop');
  }

  function ghostFor(cell) {
    const s = mine();
    if (!cell || !s || s.st !== 'play' || s.w2?.length || !g.enabled) return null;
    const cacheKey = `${g.tick}:${s.rev}:${cell.x}:${cell.y}:${g.vertical}`;
    if (g.ghostCache?.key === cacheKey) return g.ghostCache.value;
    const occ = lineCells(s), free = (x, y) => cellFree(s.grid, x, y) && !occ.has(`${x},${y}`);
    if (!free(cell.x, cell.y)) return null;
    const sealedEstimate = (cells) => {
      const grid = s.grid.split('');
      occ.forEach((key) => { const [x, y] = key.split(',').map(Number); grid[y * g.W + x] = '1'; });
      cells.forEach(([x, y]) => { if (x >= 0 && y >= 0 && x < g.W && y < g.H) grid[y * g.W + x] = '1'; });
      const seen = new Uint8Array(grid.length), occupied = new Set(s.b.map(([x, y]) => Math.floor(y) * g.W + Math.floor(x)));
      let total = 0;
      for (let start = 0; start < grid.length; start++) {
        if (grid[start] === '1' || seen[start]) continue;
        let region = 0, alive = false, stack = [start]; seen[start] = 1;
        while (stack.length) {
          const at = stack.pop(), x = at % g.W, y = Math.floor(at / g.W); region++; alive ||= occupied.has(at);
          for (const next of [x ? at - 1 : -1, x + 1 < g.W ? at + 1 : -1, y ? at - g.W : -1, y + 1 < g.H ? at + g.W : -1]) {
            if (next >= 0 && grid[next] === '0' && !seen[next]) { seen[next] = 1; stack.push(next); }
          }
        }
        if (!alive) total += region;
      }
      return total;
    };
    const danger = (x0, x1, y0, y1) => s.b.some(([x, y], i) => {
      const [vx, vy] = s.bv?.[i] || [0, 0];
      let px = x, py = y, dx = vx, dy = vy;
      for (let t = 0.1; t <= 1.4; t += 0.1) {
        const step = 0.1;
        const blocked = (bx, by) => [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]].some(([ox, oy]) => {
          const cx = Math.floor(bx + ox), cy = Math.floor(by + oy);
          return cx < 0 || cy < 0 || cx >= g.W || cy >= g.H || s.grid[cy * g.W + cx] === '1';
        });
        if (blocked(px + dx * step, py)) dx = -dx; else px += dx * step;
        if (blocked(px, py + dy * step)) dy = -dy; else py += dy * step;
        const grown = Math.min(t * 15, 20);
        const loX = g.vertical ? cell.x : Math.max(x0, cell.x + 0.5 - grown);
        const hiX = g.vertical ? cell.x + 1 : Math.min(x1, cell.x + 0.5 + grown);
        const loY = g.vertical ? Math.max(y0, cell.y + 0.5 - grown) : cell.y;
        const hiY = g.vertical ? Math.min(y1, cell.y + 0.5 + grown) : cell.y + 1;
        if (px >= loX - 0.42 && px <= hiX + 0.42 && py >= loY - 0.42 && py <= hiY + 0.42) return true;
      }
      return false;
    });
    // Preview the whole line until it meets a sealed cell, another wall or the edge.
    let a = cell.x, b = cell.x, c = cell.y, d = cell.y;
    if (g.vertical) {
      while (free(cell.x, c - 1)) c--; while (free(cell.x, d + 1)) d++;
      const cells = Array.from({ length: d - c + 1 }, (_, i) => [cell.x, c + i]);
      const preview = [cell.x, c, 1, d - c + 1, danger(cell.x, cell.x + 1, c, d + 1), sealedEstimate(cells)];
      g.ghostCache = { key: cacheKey, value: preview };
      return preview;
    }
    while (free(a - 1, cell.y)) a--; while (free(b + 1, cell.y)) b++;
    const cells = Array.from({ length: b - a + 1 }, (_, i) => [a + i, cell.y]);
    const preview = [a, cell.y, b - a + 1, 1, danger(a, b + 1, cell.y, cell.y + 1), sealedEstimate(cells)];
    g.ghostCache = { key: cacheKey, value: preview };
    return preview;
  }

  function setDirection(vertical) {
    g.vertical = vertical;
    for (const b of g.root.querySelectorAll('.rs-dir')) b.setAttribute('aria-pressed', String((b.dataset.v === '1') === vertical));
  }
  const toggle = () => setDirection(!g.vertical);

  function loop(now) {
    g.raf = requestAnimationFrame(loop);
    const s = mine();
    const r = g.three || g.flat;
    if (!s || !r) return;
    g.root.querySelector('.rs-bar-x').classList.toggle('rs-goal-hit', s.pct >= (s.goal || 0.75));
    g.stage.classList.toggle('rs-last', s === g.boards[g.me] && s.lives === 1 && s.st === 'play');   // the only haze: red, on the last life
    const sp = g.find('slowpill');
    sp.hidden = !(s.slow > 0);
    if (s.slow > 0) { sp.firstChild.textContent = '⏳ SLOW ' + Math.ceil(s.slow) + 's'; sp.lastChild.style.width = Math.min(100, s.slow / 8 * 100) + '%'; }
    const rd = g.find('ready'), hd = s.hd || 0;   // a slow 3-2-1 before each level
    rd.hidden = !(hd > 0 && s.st === 'play');
    if (!rd.hidden) { const n = String(Math.ceil(hd / 0.7)); if (rd.textContent !== n) { rd.textContent = n; rd.classList.remove('rs-tick'); void rd.offsetWidth; rd.classList.add('rs-tick'); if (window.Snd) Snd.play((t, K) => { const d = K.at({ send: 0.2 }); K.mode(d, t, n === '1' ? 880 : 660, 0.12, 0.12, { type: 'triangle' }); }); } }
    if (g.glow !== s.color) { g.glow = s.color; g.stage.style.setProperty('--rs-glow', s.color); }
    const k = 1 - Math.exp(-Math.min(60, now - (g.drawn ?? now)) / 38);
    g.drawn = now;
    const lead = Math.min(0.06, Math.max(0, (now - (s.at ?? now)) / 1000));
    s.bs.forEach((q, i) => {
      const t = s.b[i] || q, v = s.bv?.[i] || [0, 0];
      q[0] += (t[0] + v[0] * lead - q[0]) * k; q[1] += (t[1] + v[1] * lead - q[1]) * k;
    });
    // the sealed-percent readout and bar glide to the new value instead of stepping
    s.shown = (s.shown ?? s.pct) + (s.pct - (s.shown ?? s.pct)) * (1 - Math.exp(-Math.min(60, now - (g.pctAt ?? now)) / 160));
    g.pctAt = now;
    // a bright chime on crossing the goal (no ticks while the bar fills)
    if (s === g.boards[g.me]) {
      if (s.shown < (g.tickAt ?? 0) - 0.02) g.tickAt = s.shown;   // a new level restarts the bar
      if (s.shown - (g.tickAt ?? 0) > 0.003) g.tickAt = s.shown;   // (the climbing tick sound was removed: it was annoying)
      const over = s.shown >= (s.goal || 0.75);
      if (over && g.goalSeen === false && window.Snd) Snd.play((t, K) => { const d = K.at({ send: 0.6 }); [0, 7, 12].forEach((n, i) => K.mode(d, t + i * 0.07, NOTE(n + 24), 0.1, 0.3)); });
      g.goalSeen = over;
    }
    const pct = Math.floor(s.shown * 100 + 0.001) + '%', fill = Math.min(100, s.shown * 100).toFixed(1) + '%';
    if (g.pctText !== pct) { g.find('pct').textContent = g.pctText = pct; g.root.querySelector('.rs-bar-x').setAttribute('aria-valuenow', String(parseInt(pct, 10))); }
    if (g.pctFill !== fill) g.find('fill').style.width = g.pctFill = fill;
    const ghost = g.hover ? ghostFor(g.hover) : null;
    const aim = g.find('aim');
    aim.hidden = !ghost;
    if (ghost) {
      const scoreEstimate = ghost[5] * 10 * (s.mu || 1);
      const fieldPercent = (ghost[5] * 100 / (g.W * g.H)).toFixed(1);
      const text = `${ghost[4] ? '⚠ Risk · ' : ''}+${fieldPercent}% · ~${scoreEstimate.toLocaleString()} pts`;
      if (aim.textContent !== text) aim.textContent = text;
      aim.classList.toggle('rs-risk', ghost[4]);
      const detail = `${ghost[4] ? 'Risk of orb collision. ' : ''}Estimated seal ${fieldPercent} percent of the field for about ${scoreEstimate.toLocaleString()} points.`;
      if (aim.getAttribute('aria-label') !== detail) aim.setAttribute('aria-label', detail);
      aim.title = detail;
    }
    r.draw({ ...s, b: s.bs, ghost }, now);
    if (g.lockFx) { g.lockFx = false; if (s === g.boards[g.me]) voice('lock'); }
  }

  function mount(arena) {
    arena.innerHTML = `
      <section class="rs-cabinet" aria-label="Rift Split">
        <div class="rs-hud">
          <div><span class="rs-cap">Score</span><strong class="rs-score">0</strong></div>
          <div><span class="rs-cap">Level</span><strong class="rs-level">1</strong></div>
          <div><span class="rs-cap">Lives</span><strong class="rs-lives"></strong></div>
          <div class="rs-best-tile"><span class="rs-cap">Best</span><strong class="rs-best">—</strong></div>
        </div>
        <div class="rs-bar rs-bar-x" role="meter" aria-label="Field sealed" aria-valuemin="0" aria-valuemax="100"><div class="rs-fill"></div><div class="rs-goal" title="70% to clear"></div><span class="rs-pct">0%</span><span class="rs-combo" hidden></span><span class="rs-slow" hidden></span></div>
        <div class="rs-stage" aria-label="Rift Split field"><span class="rs-msg" role="status"></span><span class="rs-aim" aria-live="off" hidden></span><span class="rs-power" role="status" hidden></span><span class="rs-slowpill" hidden><span></span><i></i></span><span class="rs-ready" aria-hidden="true" hidden></span><div class="rs-coach" aria-hidden="true"><b>Tap</b> or <b>swipe</b> to grow a wall<small>Seal off the orbs; don't let them hit a growing wall. Two walls can grow at once.</small></div></div>
        <div class="rs-controls"><div class="rs-dirs" role="group" aria-label="Wall direction"><button type="button" class="rs-dir" data-v="0" aria-pressed="true"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20M4 14l5-5M4 14l5 5M24 14l-5-5M24 14l-5 5"/></svg><span>Across</span></button><button type="button" class="rs-dir rs-v" data-v="1" aria-pressed="false"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20M4 14l5-5M4 14l5 5M24 14l-5-5M24 14l-5 5"/></svg><span>Down</span></button><button type="button" class="rs-swipe" aria-pressed="false" title="Swipe to draw: the wall runs the way you drag"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 22C8 8 16 6 24 8M24 8l-6-3M24 8l-4 5"/></svg><span>Swipe</span></button></div><button type="button" class="rs-gear" aria-label="More options" title="More options" aria-expanded="false">⚙</button><div class="rs-more" hidden><button type="button" class="rs-bright" aria-label="Brightness" title="Brightness">☀</button><button type="button" class="rs-fxbtn" aria-label="Glow and blur effects" title="Glow and blur effects">✨</button><button type="button" class="rs-themebtn" aria-label="Colour theme" title="Colour theme">🎨</button></div></div>
        <ol class="rs-standings" aria-label="Scores" hidden></ol>
      </section>`;
    const root = arena.querySelector('.rs-cabinet');
    const stage = root.querySelector('.rs-stage');
    const listeners = new AbortController();
    const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: listeners.signal });
    g = {
      root, stage, listeners, W: 40, H: 24, boards: {}, order: [], tick: -1, vertical: false, best: store.get(), msgTimer: 0,
      find: (c) => root.querySelector('.rs-' + c),
      pop(text) {
        const el = document.createElement('span');
        el.className = 'rs-pop'; el.textContent = text;
        stage.append(el);
        setTimeout(() => el.remove(), 1200);
      },
      // full-field feedback: a red flash when a wall shatters, a glow on a seal, a banner for a cleared level
      fx(kind) {
        const cls = { over: 'rs-flash-hit', hit: 'rs-flash-hit', seal: 'rs-flash-seal', close: 'rs-flash-seal', big: 'rs-flash-seal', life: 'rs-flash-seal', clear: 'rs-flash-clear' }[kind];
        if (!cls) return;
        stage.classList.remove('rs-flash-hit', 'rs-flash-seal', 'rs-flash-clear');
        void stage.offsetWidth;   // restart the animation if one is still running
        stage.classList.add(cls);
        if (kind === 'clear' || kind === 'over') {
          g.banner(kind === 'clear' ? 'LEVEL CLEAR' : 'GAME OVER');
        }
      },
      banner(text, cls = '') {
        stage.querySelectorAll('.rs-banner').forEach((o) => o.remove());   // one banner at a time
        const el = document.createElement('div');
        el.className = 'rs-banner ' + cls; el.textContent = text;
        stage.append(el); setTimeout(() => el.remove(), 1800);
      },
      power(icon, title, sub) {   // a bigger, longer toast for pickups
        const el = stage.querySelector('.rs-power');
        el.innerHTML = '<b></b><small></small>'; el.firstChild.textContent = icon + ' ' + title; el.lastChild.textContent = sub;
        el.hidden = false; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
        clearTimeout(g.powerTimer); g.powerTimer = setTimeout(() => { el.hidden = true; }, 2600);
      },
      msg(text) {
        const el = stage.querySelector('.rs-msg');
        el.textContent = text; el.classList.toggle('on', !!text);
        clearTimeout(g.msgTimer); g.msgTimer = setTimeout(() => el.classList.remove('on'), 1600);
      },
    };
    g.tilt = false;   // always straight down
    const pref = (k, d) => { try { return localStorage.getItem('riftsplit.' + k) ?? d; } catch { return d; } };
    const setPref = (k, v) => { try { localStorage.setItem('riftsplit.' + k, v); } catch { /* private mode */ } };
    g.nofx = pref('nofx', '0') === '1';
    g.theme = THEME_KEYS.includes(pref('theme', 'auto')) ? pref('theme', 'auto') : 'auto';
    const applyLook = () => {
      HALF = THM().half;
      stage.style.setProperty('--rs-glow', THM().glow);
      stage.classList.toggle('rs-sharp', g.nofx);
      g.find('fxbtn').setAttribute('aria-pressed', String(!g.nofx));
      g.find('fxbtn').classList.toggle('rs-off', g.nofx);
    };
    applyLook();
    g.syncTheme = (lv) => {   // Auto theme: a new colour world every TIER_LEN levels
      const was = effTheme(); g.lv = lv;
      if (g.theme !== 'auto' || effTheme() === was) return false;
      applyLook();
      if (g.three) { g.three.dispose(); g.three = null; g.rebuild?.(); }
      return true;
    };
    on(g.find('fxbtn'), 'click', () => { g.nofx = !g.nofx; setPref('nofx', g.nofx ? '1' : '0'); applyLook(); g.msg(g.nofx ? 'Sharp mode: glow and blur off' : 'Glow effects on'); });
    on(g.find('themebtn'), 'click', () => {
      g.theme = THEME_KEYS[(THEME_KEYS.indexOf(g.theme) + 1) % THEME_KEYS.length]; setPref('theme', g.theme); applyLook();
      if (g.three) { g.three.dispose(); g.three = null; g.rebuild?.(); }   // the 3D floor and frame are built from the theme
      g.msg('Theme: ' + (g.theme === 'auto' ? 'Auto (changes every ' + TIER_LEN + ' levels)' : THEMES[g.theme].name));
    });
    const BRIGHT = [1, 1.1, 1.3, 1.6, 2];
    const loadB = () => { try { const v = Number(localStorage.getItem('riftsplit.bright')); return BRIGHT.includes(v) ? v : 1.1; } catch { return 1.1; } };
    g.bright = loadB();
    stage.style.setProperty('--rs-bright', g.bright);
    on(g.find('bright'), 'click', () => {
      g.bright = BRIGHT[(BRIGHT.indexOf(g.bright) + 1) % BRIGHT.length];
      stage.style.setProperty('--rs-bright', g.bright);
      try { localStorage.setItem('riftsplit.bright', String(g.bright)); } catch { /* private mode */ }
      g.msg('Brightness ' + Math.round(g.bright * 100) + '%');
    });
    for (const b of root.querySelectorAll('.rs-dir')) on(b, 'click', () => setDirection(b.dataset.v === '1'));
    g.zoom = 1; g.panX = 0; g.panY = 0;
    try { g.swipe = localStorage.getItem('riftsplit.swipe') === '1'; } catch { g.swipe = false; }
    const syncSwipe = () => { g.find('swipe').setAttribute('aria-pressed', String(g.swipe)); g.root.classList.toggle('rs-swiping', g.swipe); };
    syncSwipe();
    on(g.find('swipe'), 'click', () => {
      g.swipe = !g.swipe; syncSwipe();
      try { localStorage.setItem('riftsplit.swipe', g.swipe ? '1' : '0'); } catch { /* private mode */ }
      g.msg(g.swipe ? 'Swipe: drag the way the wall should run' : 'Tap mode: pick Across or Down');
    });
    on(g.find('gear'), 'click', () => { const m = g.find('more'); m.hidden = !m.hidden; g.find('gear').setAttribute('aria-expanded', String(!m.hidden)); });
    on(stage, 'wheel', (e) => e.preventDefault(), { passive: false });
    let swipeFrom = null;   // swipe mode: where the finger landed and where the wall will start
    let down = false;
    // Hold to see where the wall would run, slide to aim, release to place it (a mouse previews on hover).
    const fingers = new Set();
    let pinched = false;   // a second finger landed: ignore the gesture rather than place a wall
    on(stage, 'pointerdown', (e) => {
      if (e.button === 2) return;
      e.preventDefault();
      fingers.add(e.pointerId);
      if (fingers.size > 1) { pinched = true; down = false; g.hover = null; swipeFrom = null; return; }
      stage.setPointerCapture?.(e.pointerId);
      g.touching = e.pointerType !== 'mouse';
      down = true;
      g.hover = (g.three || g.flat)?.pick(e);
      swipeFrom = g.swipe && g.hover ? { x: e.clientX, y: e.clientY, cell: g.hover } : null;
    });
    on(stage, 'pointermove', (e) => {
      if (swipeFrom && down && !pinched) {   // the drag picks the direction; the wall starts where the finger landed
        const dx = e.clientX - swipeFrom.x, dy = e.clientY - swipeFrom.y;
        if (Math.hypot(dx, dy) > 12 && g.vertical !== (Math.abs(dy) > Math.abs(dx))) setDirection(Math.abs(dy) > Math.abs(dx));
        g.hover = swipeFrom.cell;
        return;
      }
      const r = g.three || g.flat;
      if (r && !pinched && (down || e.pointerType === 'mouse')) g.hover = r.pick(e);
    });
    const lift = (e, placeIt) => {
      fingers.delete(e.pointerId);
      if (placeIt && down && !pinched) place(swipeFrom ? swipeFrom.cell : ((g.three || g.flat)?.pick(e) || g.hover), g.vertical);
      swipeFrom = null;
      if (!fingers.size) { down = false; pinched = false; if (g.touching || !placeIt) g.hover = null; }
    };
    on(stage, 'pointerup', (e) => lift(e, true));
    on(stage, 'pointercancel', (e) => lift(e, false));
    on(stage, 'pointerleave', () => { if (!down) g.hover = null; });
    on(stage, 'contextmenu', (e) => { e.preventDefault(); toggle(); });
    on(window, 'keydown', (e) => {
      if (e.code !== 'Space' || e.target.closest?.('input, textarea, select, button, [contenteditable], dialog[open]')) return;
      e.preventDefault();
      toggle();
    });
    g.flat = flatRenderer(stage);
    GL3.load().then((T) => {
      const me = g;
      if (g !== me) return;
      const build = () => {
        if (g !== me) return false;
        me.three = threeRenderer(T, stage, () => { me.three?.dispose(); me.three = null; GL3.revive(stage, { build, flat, unflat }); });
        return me.three;
      };
      me.rebuild = () => { try { build(); } catch (err) { console.warn('Rift Split could not rebuild 3D', err); } };
      const flat = () => { me.flat ||= flatRenderer(stage); me.flat?.view?.(); };
      const unflat = () => { me.flat?.dispose(); me.flat = null; };
      try { if (build()) { unflat(); return; } } catch (err) { console.warn('Rift Split could not start 3D', err); }
      unflat(); flat();
      GL3.revive(stage, { build, flat, unflat });
    }).catch(() => {});
    g.raf = requestAnimationFrame(loop);
  }

  UI.riftsplit = {
    focus: true,
    mount,
    turnText: (view) => view.phase === 'over' ? 'Rift Split results' : 'Seal the goal % of the field',
    render(view, ctx) {
      const d = view.riftsplit;
      if (!g || !d) return;
      g.ctx = ctx;
      if (g.run !== d.rift) {
        g.run = d.rift; g.tick = -1; g.syncTheme?.(1); g.ghostCache = null; g.lastScore = null; g.lastLives = null; g.lastLv = null; g.beat = false; g.startBest = g.best; g.W = d.layout.w; g.H = d.layout.h; g.solo = d.solo; g.boards = {};
        g.order = Object.keys(d.boards);
      }
      g.me = d.me;
      g.watch = g.watch || Object.keys(d.boards)[0];
      g.enabled = view.phase === 'playing' && !view.paused && !ctx.readOnly && !view.me?.eliminated && !!d.me;
      receive(d);
    },
    fast(data) { receive(data); },
    testPlace(x, y, v) { place({ x, y }, v); },
    disconnect() { if (g) g.enabled = false; },
    unmount() {
      if (!g) return;
      g.listeners.abort();
      cancelAnimationFrame(g.raf);
      clearTimeout(g.msgTimer);
      clearTimeout(g.placeTimer);
      g.three?.dispose(); g.flat?.dispose();
      g.root.remove();
      g = null;
    },
  };
})();
