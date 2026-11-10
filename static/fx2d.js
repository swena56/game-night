// Fx2D: shared effects for the games drawn on a 2D canvas (Prism Pop, Paint Blast, Cannon Hills, Air Hockey,
// Billiards): a particle pool (shards, sparks, smoke, splats, rings), floating score text, a screen shake and a
// white flash, and the pixel-ratio-aware canvas sizing every game used to write for itself. Loaded before the
// games; like kit.js it reads app.js globals (motionOK, gfxLevel) only when called, never on load.
//
//   const fx = Fx2D.create({ cap: 320 });               once per game instance
//   fx.burst(x, y, 12, { colors: ['#f00', '#fff'], speed: [80, 240], gravity: 600, size: 6, life: [0.5, 0.9] });
//   fx.spark(x, y, 6, { color: '#fff', speed: [40, 120], size: 4 });        additive glints
//   fx.smoke(x, y, 8, { color: '#5a3d22', size: 8, rise: 30 });            puffs that grow and fade
//   fx.splat(x, y, 4, { color, speed: [60, 180], size: 5 });               drops that skid to a stop
//   fx.ring(x, y, { r0: 10, r1: 60, color: '#ffd166', width: 4, life: 0.5 });
//   fx.text(x, y, '+10', { color: '#ffd166', size: 22, big: 1 });
//   fx.shake(px); fx.flash('#fff', 0.35, 400);
//   each frame:  const live = fx.step(dt);  g.setTransform(…); fx.begin(g); …draw the game…; fx.draw(g); fx.end(g);
// Positions and sizes are in the canvas's own pixels (its backing store). Nothing is emitted when animations
// are off, and the pool halves on 🎨 Graphics: Low.
const Fx2D = (() => {
  const motion = () => (typeof motionOK === 'function' ? motionOK() : true);
  const low = () => (typeof gfxLevel === 'function' ? gfxLevel() === 'low' : false);
  const dpr = () => Math.min(window.devicePixelRatio || 1, low() ? 1 : 2);
  // size a canvas: CSS w×h, the backing store at the pixel ratio; returns the ratio used
  function fit(canvas, w, h = w) {
    const r = dpr(), W = Math.max(1, Math.round(w * r)), H = Math.max(1, Math.round(h * r));
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    return r;
  }
  // run fn (at most once a frame) whenever el changes size; returns a stop function
  function observe(el, fn) {
    if (!el || !window.ResizeObserver) return () => {};
    let raf = 0;
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fn(); }); });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); raf = 0; };
  }
  // the display font (style.css --font-display), for text drawn on a canvas
  let fam = null;
  function font(weight, px) {
    if (fam == null) { try { fam = getComputedStyle(document.body).getPropertyValue('--font-display').trim(); } catch {} fam ||= 'system-ui, sans-serif'; }
    return `${weight} ${Math.round(px)}px ${fam}`;
  }
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const range = (v, d) => (Array.isArray(v) ? rnd(v[0], v[1]) : v == null ? rnd(d[0], d[1]) : v);

  // the pool: one typed array for the numbers, a parallel array for the colour strings
  const F = 12, X = 0, Y = 1, VX = 2, VY = 3, LIFE = 4, MAX = 5, SIZE = 6, ROT = 7, VR = 8, GROW = 9, DRAG = 10, GRAV = 11;
  const SHARD = 0, SPARK = 1, SMOKE = 2, SPLAT = 3, RING = 4;
  function create({ cap = 320 } = {}) {
    const a = new Float32Array(cap * F), kind = new Uint8Array(cap), col = new Array(cap), extra = new Float32Array(cap);
    let n = 0, texts = [], shakeAmt = 0, sx = 0, sy = 0, flashA = 0, flashCol = '#fff', flashRate = 0;
    const room = () => n < (low() ? Math.ceil(cap / 2) : cap);
    function add(k, x, y, o, vx, vy) {
      if (!room()) return;
      const p = n++ * F;
      a[p + X] = x; a[p + Y] = y; a[p + VX] = vx; a[p + VY] = vy; a[p + LIFE] = 0;
      a[p + MAX] = range(o.life, [0.5, 0.9]); a[p + SIZE] = range(o.size, [4, 7]);
      a[p + ROT] = Math.random() * 6.3; a[p + VR] = o.spin ?? rnd(-14, 14);
      a[p + GROW] = o.grow ?? 0; a[p + DRAG] = o.drag ?? 0; a[p + GRAV] = o.gravity ?? 0;
      kind[n - 1] = k; col[n - 1] = o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : (o.color || '#fff');
      extra[n - 1] = o.width ?? 0;
    }
    // count particles flying out from (x, y): angle `spread` wide around `dir` (radians; default all round)
    function scatter(k, x, y, count, o, defaults) {
      if (!motion()) return;
      const o2 = { ...defaults, ...o };
      for (let i = 0; i < count; i++) {
        const ang = o2.dir == null ? Math.random() * Math.PI * 2 : o2.dir + (Math.random() - 0.5) * (o2.spread ?? Math.PI / 2);
        const v = range(o2.speed, [60, 200]);
        add(k, x, y, o2, Math.cos(ang) * v, Math.sin(ang) * v - (o2.up ?? 0));
      }
    }
    const burst = (x, y, count, o = {}) => scatter(SHARD, x, y, count, o, { gravity: 500, drag: 0.6, life: [0.5, 0.95] });
    const spark = (x, y, count, o = {}) => scatter(SPARK, x, y, count, o, { drag: 3.5, life: [0.35, 0.75], size: [3, 5], spin: 0 });
    const smoke = (x, y, count, o = {}) => scatter(SMOKE, x, y, count, o, { drag: 2.5, life: [0.6, 1.1], size: [6, 10], grow: 1.6, speed: [20, 60], up: o.rise ?? 30 });
    const splat = (x, y, count, o = {}) => scatter(SPLAT, x, y, count, o, { drag: 3, life: [0.4, 0.7], size: [3, 6] });
    function ring(x, y, o = {}) {
      if (!motion() || !room()) return;
      add(RING, x, y, { life: o.life ?? 0.5, size: o.r0 ?? 4, color: o.color || '#fff', width: o.width ?? 3, grow: (o.r1 ?? 60) - (o.r0 ?? 4), spin: 0 }, 0, 0);
    }
    // "+10" rising from (x, y): size in px; kind good | bad | gold | info picks a colour unless one is given
    const TONE = { good: '#06d6a0', bad: '#ff5d5d', gold: '#ffd166', info: '#fff' };
    function text(x, y, str, o = {}) {
      if (texts.length > 24) texts.shift();
      texts.push({ x, y, str, color: o.color || TONE[o.kind] || TONE.gold, size: o.size ?? 22, big: o.big ?? 1, t: 0, max: (o.ms ?? 900) / 1000, rise: o.rise ?? (o.size ?? 22) * 2, still: !motion() });
    }
    function shake(px) { if (motion()) shakeAmt = Math.max(shakeAmt, px); }
    function flash(color = '#fff', alpha = 0.35, ms = 400) { if (!motion()) return; flashCol = color; flashA = Math.max(flashA, alpha); flashRate = 5 / (ms / 1000); }

    // advance everything by dt seconds; true while anything is still showing
    function step(dt) {
      dt = Math.min(0.05, Math.max(0, dt || 0));
      for (let i = 0; i < n;) {
        const p = i * F;
        if ((a[p + LIFE] += dt) >= a[p + MAX]) {  // dead: move the last one here
          n--;
          if (i < n) { a.copyWithin(p, n * F, n * F + F); kind[i] = kind[n]; col[i] = col[n]; extra[i] = extra[n]; }
          continue;
        }
        const drag = a[p + DRAG] ? Math.exp(-a[p + DRAG] * dt) : 1;
        a[p + VY] += a[p + GRAV] * dt;
        a[p + VX] *= drag; a[p + VY] *= drag;
        a[p + X] += a[p + VX] * dt; a[p + Y] += a[p + VY] * dt;
        a[p + ROT] += a[p + VR] * dt;
        i++;
      }
      for (let i = texts.length - 1; i >= 0; i--) if ((texts[i].t += dt) >= texts[i].max) texts.splice(i, 1);
      if (shakeAmt > 0.3) { sx = (Math.random() - 0.5) * 2 * shakeAmt; sy = (Math.random() - 0.5) * 2 * shakeAmt; shakeAmt *= Math.exp(-6.5 * dt); } else { shakeAmt = sx = sy = 0; }
      if (flashA > 0.015) flashA *= Math.exp(-flashRate * dt); else flashA = 0;
      return n > 0 || texts.length > 0 || shakeAmt > 0 || flashA > 0;
    }
    // apply the shake on top of whatever transform the game set (call after setTransform / translate)
    function begin(g) { g.save(); if (sx || sy) g.translate(sx, sy); }
    function draw(g) {
      if (!n && !texts.length) return;
      g.save();
      g.lineJoin = 'round';
      let additive = false;
      for (let i = 0; i < n; i++) {
        const p = i * F, k = a[p + LIFE] / a[p + MAX], x = a[p + X], y = a[p + Y], s = a[p + SIZE], kd = kind[i];
        if ((kd === SPARK) !== additive) { additive = kd === SPARK; g.globalCompositeOperation = additive ? 'lighter' : 'source-over'; }
        g.fillStyle = col[i];
        if (kd === SHARD) {
          g.globalAlpha = 1 - k * k;
          g.translate(x, y); g.rotate(a[p + ROT]);
          g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.7, s * 0.6); g.lineTo(-s * 0.7, s * 0.6); g.closePath(); g.fill();
          g.rotate(-a[p + ROT]); g.translate(-x, -y);
        } else if (kd === SPARK) {
          g.globalAlpha = 1 - k;
          const r = s * (1 + k);
          g.beginPath(); g.moveTo(x, y - r * 2); g.lineTo(x + r * 0.5, y); g.lineTo(x, y + r * 2); g.lineTo(x - r * 0.5, y); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(x - r * 2, y); g.lineTo(x, y + r * 0.5); g.lineTo(x + r * 2, y); g.lineTo(x, y - r * 0.5); g.closePath(); g.fill();
        } else if (kd === SMOKE) {
          g.globalAlpha = 0.55 * (1 - k);
          g.beginPath(); g.arc(x, y, s * (1 + a[p + GROW] * k), 0, 7); g.fill();
        } else if (kd === SPLAT) {
          g.globalAlpha = 0.9 * (1 - k * k);
          g.beginPath(); g.arc(x, y, s * (0.6 + 0.4 * (1 - k)), 0, 7); g.fill();
        } else {  // RING
          g.globalAlpha = 1 - k;
          g.strokeStyle = col[i]; g.lineWidth = Math.max(1, extra[i] * (1 - k * 0.6));
          g.beginPath(); g.arc(x, y, s + a[p + GROW] * (1 - (1 - k) ** 2), 0, 7); g.stroke();
        }
      }
      g.globalCompositeOperation = 'source-over';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const t of texts) {
        const k = t.t / t.max, pop = t.still ? 1 : k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, k - 0.15);
        g.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        g.font = font(900, t.size * t.big * pop);
        const y = t.y - (t.still ? 0 : k * t.rise);
        g.lineWidth = Math.max(2, t.size * 0.2); g.strokeStyle = 'rgba(10,8,30,0.85)';
        g.strokeText(t.str, t.x, y); g.fillStyle = t.color; g.fillText(t.str, t.x, y);
      }
      g.restore();
    }
    // the flash over the whole canvas, then undo begin()'s save
    function end(g) {
      if (flashA > 0) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = flashA; g.fillStyle = flashCol; g.fillRect(0, 0, g.canvas.width, g.canvas.height); g.restore(); }
      g.restore();
    }
    function clear() { n = 0; texts = []; shakeAmt = sx = sy = 0; flashA = 0; }
    return { burst, spark, smoke, splat, ring, text, shake, flash, step, begin, draw, end, clear,
      get active() { return n > 0 || texts.length > 0 || shakeAmt > 0 || flashA > 0; }, get offset() { return [sx, sy]; } };
  }
  return { create, fit, observe, dpr, font };
})();
