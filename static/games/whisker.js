// Whisker Run: the server runs the maze; this module keeps a local copy of the crumbs (full views replace
// them, fast updates remove the newly nibbled ones), glides each critter between the cells the server
// reports, and sends turns. Turns are held by the server until the corner comes, so pressing early works.
// Steer by swiping anywhere, tapping the maze (toward the tap from your critter), the arrow pad or the keys.
UI.whisker = (() => {
  let S, ctx, root = null, canvas = null, g = null, fx = null, raf = 0, stopObs = null, keyHandler = null;
  const trails = [];
  let walls = null, food = new Map(), ents = [], pos = [], round = 0, lastEv = 0, lastTick = 0;
  let mazeImg = null, foodImg = null, foodDirty = true, cell = 16, offX = 0, offY = 0, cssW = 0, cssH = 0, ratio = 1, last = 0;
  let pend = null, swipe = null, showPad = true, timeLeft = null, timeAt = 0, lastCount = '', nibbleAt = 0, sentDir = null, sentAt = 0;
  const RESEND_MS = 400;  // the same direction again is worth sending after this long (a lost one, a new round)
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const $ = (id) => document.getElementById(id);
  const ICON = { m: '🐭', c: '🐱', a: '🐈‍⬛', spook: '🙀', basket: '😾' };

  function mount(main, side) {
    trails.length = 0; S = null; walls = null; food = new Map(); ents = []; pos = []; round = 0; lastEv = 0; lastTick = 0;
    mazeImg = foodImg = null; foodDirty = true; pend = null; swipe = null; sentDir = null; timeLeft = null; lastCount = ''; sprites.clear(); hudCache = null;
    showPad = load('whisker.pad') ?? true;
    main.innerHTML = `<div class="wk" id="wkRoot"><div class="wk-stage" id="wkStage">
        <div class="wk-hud" id="wkHud"></div>
        <div class="wk-banner" id="wkBanner" hidden></div>
        <canvas id="wkCanvas" aria-label="The maze"></canvas>
      </div>
      <div class="wk-pad" id="wkPad">
        <span></span><button data-d="0" aria-label="Up">▲</button><span></span>
        <button data-d="3" aria-label="Left">◀</button><span class="wk-me" id="wkMe"></span><button data-d="1" aria-label="Right">▶</button>
        <span></span><button data-d="2" aria-label="Down">▼</button><span></span></div></div>`;
    side.innerHTML = `<div class="panel"><div id="wkRows"></div>
      <label class="check"><input type="checkbox" id="wkPadOn"> Show the arrow pad</label>
      <p class="hint left">Swipe anywhere, tap the maze toward where you want to go, or use the arrows / WASD. Press early to turn at the next corner.</p>
      <p class="hint left">🧀 crumb +1 · ⚡ zoomies +3 and a burst of speed · 🔔 bell +5 and the cats panic · bump a 🙀 panicking cat +20 · a cat that catches a mouse snatches half of what it nibbled this round.</p>
      <p class="hint left">🕳️ Mouse holes in the hedge let mice through but not cats — though a cat at either end can reach in with a paw.</p></div>`;
    $('wkPadOn').checked = showPad;
    $('wkPadOn').addEventListener('change', (e) => { showPad = e.target.checked; store('whisker.pad', showPad ? null : false); renderSide(); });
    for (const b of $('wkPad').querySelectorAll('button[data-d]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); steer(+b.dataset.d); });
    root = $('wkRoot'); canvas = $('wkCanvas');
    g = canvas.getContext?.('2d') || null;
    fx = typeof Fx2D !== 'undefined' ? Fx2D.create({ cap: 160 }) : null;
    const stage = $('wkStage');
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, label')) return;
      swipe = { x: e.clientX, y: e.clientY, moved: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
    });
    stage.addEventListener('pointermove', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.hypot(dx, dy) < Math.max(10, Math.min(24, cssW * 0.03))) return;
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      swipe = { x: e.clientX, y: e.clientY, moved: true };
    });
    stage.addEventListener('pointerup', (e) => {
      if (swipe && !swipe.moved) tapToward(e.clientX, e.clientY);
      swipe = null;
    });
    stage.addEventListener('pointercancel', () => { swipe = null; });
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select') && e.target.type !== 'checkbox') return;
      const k = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 }[e.code];
      if (k != null) { e.preventDefault(); steer(k); }
    };
    addEventListener('keydown', keyHandler);
    stopObs = typeof Fx2D !== 'undefined' ? Fx2D.observe(stage, resize) : null;
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); stopObs?.(); removeEventListener('keydown', keyHandler);
    root = canvas = g = null; mazeImg = foodImg = null; hudCache = null;
  }

  const W = () => S.whisker.w, Hh = () => S.whisker.h;
  const myEnt = () => (S?.whisker?.mine != null ? ents[S.whisker.mine] : null);
  const canSteer = () => S?.phase === 'playing' && myEnt() && S.whisker.stage !== 'over' && myEnt().st !== 5;
  function steer(d) {
    if (!canSteer()) return;
    const now = performance.now();
    // a held key or a long swipe says the same thing over and over: sending each one put the next turn behind them all
    if (d === sentDir && now - sentAt < RESEND_MS) return;
    sentDir = d; sentAt = now;
    pend = d;
    buzz(8);
    ctx.input({ dir: d });   // not kept: if one is still on its way, only the newest direction waits behind it
    renderPadMe();
  }
  // a tap on the maze: head that way from where your critter is (the longer axis wins)
  function tapToward(x, y) {
    const i = S?.whisker?.mine; if (i == null || !canvas) return;
    const r = canvas.getBoundingClientRect(), p = drawPos(i, performance.now()); if (!p || !r.width) return;
    const px = r.left + offX + (p[0] + 0.5) * cell, py = r.top + offY + (p[1] + 0.5) * cell;
    const dx = x - px, dy = y - py;
    if (Math.hypot(dx, dy) < cell * 0.6) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  }

  // ---------- state

  function render(s, c) {
    S = s; ctx = c;
    const k = s.whisker;
    const fresh = k.round !== round;
    if (fresh || !walls) {
      walls = new Uint8Array(k.walls.match(/../g).map((h) => parseInt(h, 16)));
      round = k.round; mazeImg = null; pos = []; pend = null; sentDir = null; hudCache = null;
      lastEv = Math.max(lastEv, ...k.ev.map((e) => e[0]), 0);
    }
    food = new Map(k.food); foodDirty = true;
    const old = ents;
    ents = k.ents.map((e) => ({ ...e, spookEnd: performance.now() + (e.spook || 0) * 1000 }));
    // a full view comes every few seconds and on every catch or bell: only a critter that has really moved (or is
    // new) gets a new glide, or each one would restart its step and hitch
    ents.forEach((e, i) => {
      const o = old[i], same = o && o.seat === e.seat && o.role === e.role;
      if (fresh || !same || o.cell !== e.cell || !pos[i]) place(i, e.cell, e.v, fresh || !same);
    });
    lastTick = k.tick;
    if (k.timeLeft != null) { timeLeft = k.timeLeft; timeAt = performance.now(); }
    S.countAt = performance.now() + k.countdown * 1000;
    events(k.ev, fresh);
    if (!mazeImg) resize();
    renderSide();
  }

  function fast(data) {
    if (!S || data.k < lastTick) return;
    lastTick = data.k;
    const k = S.whisker, me = k.mine;
    for (const [, c] of data.e || []) {
      if (!food.delete(c)) continue;
      foodDirty = true;
      if (me != null && ents[me] && ents[me].role === 'm' && data.p[me]?.[0] === c) nibble(c);
    }
    data.p.forEach(([c, dir, st, v, lives, sp, lead], i) => {
      const e = ents[i]; if (!e) return;
      const was = e.st;
      if (c !== e.cell) place(i, c, v, false, lead);
      Object.assign(e, { cell: c, dir, st, v, lives, spookEnd: performance.now() + (sp || 0) * 100 });
      if (i === me && was !== st && st === 0 && was === 1) { Kit.callout('🐭 Back in the maze!', 'good', { ms: 900 }); }
    });
    if (data.sc) k.score = data.sc;
    if (data.t != null) { timeLeft = data.t; timeAt = performance.now(); }
    k.stage = data.st;
    const my = myEnt();
    if (my && pend != null && my.dir === pend) pend = null;
    events(data.ev);
    renderSide();
  }

  function nibble(c) {
    const now = performance.now();
    if (now - nibbleAt > 90) { ctx.sfx('tick'); nibbleAt = now; }
    if (fx) { const [x, y] = px(c % W() + 0.5, Math.floor(c / W()) + 0.5); fx.spark(x, y, 3, { color: '#ffd166', speed: [20, 60], size: 3 }); }
  }

  // what happened since the last update: bells, catches, bumps
  function events(list, quietly) {
    for (const [id, kind, c, seat] of list || []) {
      if (id <= lastEv) continue;
      lastEv = id;
      if (quietly) continue;
      const k = S.whisker, mine = k.me != null && seat === k.me, my = myEnt();
      const name = ctx.player(k.seats[seat])?.name ?? '?';
      const [x, y] = px(c % W() + 0.5, Math.floor(c / W()) + 0.5);
      if (kind === 'bell') {
        fx?.ring(x, y, { r0: 6 * ratio, r1: cell * 6 * ratio, color: '#ffd166', width: 4 * ratio, life: 0.7 });
        ctx.sfx('pickup');
        if (my?.role === 'c') { Kit.callout('🙀 A bell! Run from the mice!', 'bad', { ms: 1300 }); buzz([40, 40, 40]); }
        else Kit.callout(mine ? '🔔 Ding! Chase the cats!' : `🔔 ${name} rang a bell — chase the cats!`, 'gold', { ms: 1300 });
      } else if (kind === 'zoom') {
        fx?.ring(x, y, { r0: 4 * ratio, r1: cell * 3 * ratio, color: '#7cdcff', width: 3 * ratio, life: 0.5 });
        ctx.sfx('pickup');
        if (mine) { Kit.callout('⚡ Zoomies!', 'gold', { ms: 1000 }); buzz(25); }
      } else if (kind === 'catch') {
        fx?.burst(x, y, 14, { colors: ['#ffd166', '#c9a227', '#fff'], speed: [60, 200] , size: 4 * ratio, life: [0.4, 0.8] });
        fx?.shake(mine ? 8 : 3);
        if (mine) { ctx.sfx('crack'); buzz([80, 40, 140]); Kit.callout('🐾 Caught! Half your crumbs are gone', 'bad', { ms: 1300 }); }
        else ctx.sfx('capture');
      } else if (kind === 'pounce') {
        fx?.ring(x, y, { r0: 3 * ratio, r1: cell * 2 * ratio, color: '#ff8a5b', width: 3 * ratio, life: 0.4 });
        if (mine) { ctx.sfx('tag'); buzz(20); Kit.callout('🐾 Pounce!', 'gold', { ms: 700 }); }
        else if (my?.role === 'm') { ctx.sfx('tick'); buzz([15, 20, 15]); }
      } else if (kind === 'bonk') {
        fx?.ring(x, y, { r0: 4 * ratio, r1: cell * 2.5 * ratio, color: '#8ce99a', width: 4 * ratio, life: 0.5 });
        fx?.text(x, y, '+20', { color: '#8ce99a', size: 20 * ratio, big: 1 });
        ctx.sfx('tag');
        if (mine) { Kit.callout('🧹 Bump! Back to the basket, cat!', 'gold', { ms: 1100 }); buzz(30); }
        else if (my?.role !== 'm' && my) { buzz([60, 30, 60]); }
      }
    }
  }

  // ---------- motion: each critter glides from where it was drawn to its new cell over one step

  // lead: how far (hundredths of a step) the server's critter already is into its next step. Moves land on
  // 15 Hz ticks, so without it a glide of one fixed length stalls for a moment every few steps; with it each
  // glide ends just as the next move is due (sooner if this one arrived late, later after a nibble).
  function place(i, c, v, snap, lead = 0) {
    const now = performance.now(), w = S.whisker.w;
    const x = c % w, y = Math.floor(c / w), cur = pos[i] && drawPos(i, now);
    const far = !cur || Math.abs(cur[0] - x) + Math.abs(cur[1] - y) > 1.6;
    const step = 1000 / Math.max(1, (v || 70) / 10);
    const dur = Math.max(40, step * (1 - Math.max(-0.6, Math.min(0.8, (lead || 0) / 100))));
    pos[i] = { fx: snap || far ? x : cur[0], fy: snap || far ? y : cur[1], tx: x, ty: y, at: now, dur };
  }
  function drawPos(i, now) {
    const p = pos[i]; if (!p) return null;
    const raw = (now - p.at) / p.dur, f = Math.min(1, raw);
    let x = p.fx + (p.tx - p.fx) * f, y = p.fy + (p.ty - p.fy) * f;
    if (raw > 1) {   // the next step is late (a slow network): drift on towards the next cell if the way is clear
      const d = ahead(i, p);
      if (d) { const more = Math.min(COAST, raw - 1); x += d[0] * more; y += d[1] * more; }
    }
    return [x, y];
  }
  const COAST = 0.3;   // of a cell: enough to hide a late update, short enough that a surprise turn barely shows
  function ahead(i, p) {
    const e = ents[i], k = S.whisker;
    if (!e || !walls || k.stage !== 'play' || S.paused || (e.st !== 0 && e.st !== 2 && e.st !== 4)) return null;
    const d = DIRS[e.dir]; if (!d) return null;
    // only on from a step it was making that way, and never while my own turn is waiting to happen
    if (Math.sign(p.tx - p.fx) !== d[0] || Math.sign(p.ty - p.fy) !== d[1] || (i === k.mine && pend != null && pend !== e.dir)) return null;
    const x = p.tx + d[0], y = p.ty + d[1];
    if (x < 0 || y < 0 || x >= k.w || y >= k.h) return null;
    const there = walls[y * k.w + x];
    return there === 0 || (there === 2 && e.role === 'm') ? d : null;
  }

  // ---------- drawing

  function resize() {
    const stage = $('wkStage'); if (!stage || !canvas || !S) return;
    const w = W(), h = Hh();
    const bw = stage.clientWidth || 320, bh = stage.clientHeight || 300;
    cell = Math.max(8, Math.floor(Math.min(bw / w, bh / h)));
    cssW = bw; cssH = bh;
    offX = Math.floor((bw - cell * w) / 2); offY = Math.floor((bh - cell * h) / 2);
    ratio = typeof Fx2D !== 'undefined' ? Fx2D.fit(canvas, bw, bh) : 1;
    mazeImg = foodImg = null; foodDirty = true; sprites.clear();
  }
  const px = (x, y) => [(offX + x * cell) * ratio, (offY + y * cell) * ratio];

  // each round's theme: floor, floor checks, wall base, wall crown, wall flecks, the den rug and its stitching
  const THEME = {
    garden: { art: 'leaves', light: '#b6f29a55', bg: '#16100a', floor: '#3a2a1c', check: '#ffffff08', base: '#1d4a2a', crown: '#3f8f4a', fleck: '#6cc070', rug: '#7a3b2e', stitch: '#c0703f' },
    pantry: { art: 'jars', light: '#ffe8bd66', bg: '#140d07', floor: '#33251a', check: '#ffffff06', base: '#6b4423', crown: '#b57d45', fleck: '#f2d28c', rug: '#2f5d7a', stitch: '#a9d3ef', planks: '#00000030' },
    cellar: { art: 'bricks', light: '#e4e4f455', flags: '#00000040', bg: '#0b0b10', floor: '#23232b', check: '#ffffff07', base: '#3e3e4b', crown: '#77778c', fleck: '#a9a9bd', rug: '#5a2a4a', stitch: '#c27aa6' },
  };
  const theme = () => THEME[S?.whisker?.theme] || THEME.garden;

  // a steady pseudo-random 0–1 for a cell, so the scatter is the same every time the maze is redrawn
  const noise = (x, y, n = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453; return v - Math.floor(v); };
  function dot(m, x, y, rx, ry, a, color) { m.fillStyle = color; m.beginPath(); m.ellipse(x, y, rx, ry, a, 0, 6.3); m.fill(); }

  function buildMaze() {
    const w = W(), h = Hh(), k = S.whisker, T = theme();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * cell * ratio)); c.height = Math.max(1, Math.round(h * cell * ratio));
    const m = c.getContext?.('2d'); if (!m) return null;
    m.scale(ratio, ratio);
    m.fillStyle = T.floor; m.fillRect(0, 0, w * cell, h * cell);
    m.fillStyle = T.check;
    for (let y = 0; y < h; y++) for (let x = (y % 2); x < w; x += 2) m.fillRect(x * cell, y * cell, cell, cell);
    // grit on the ground: soil and pebbles, flour on the boards, chips on the flags
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let n = 0; n < 3; n++) {
      const r = cell * (0.025 + 0.035 * noise(x, y, n + 6));
      dot(m, (x + noise(x, y, n)) * cell, (y + noise(x, y, n + 3)) * cell, r, r * 0.7, noise(x, y, n + 9) * 3, noise(x, y, n + 12) > 0.5 ? '#ffffff12' : '#00000030');
    }
    if (T.planks) {  // pantry floorboards, with the ends of the boards staggered
      m.fillStyle = T.planks;
      for (let y = 0; y < h; y++) {
        m.fillRect(0, y * cell + cell - 1, w * cell, 1);
        for (let x = (y * 2) % 5; x < w; x += 5) m.fillRect(x * cell, y * cell, 1, cell);
      }
    }
    if (T.flags) {  // cellar flagstones
      m.strokeStyle = T.flags; m.lineWidth = Math.max(1, cell * 0.05);
      for (let y = 0; y < h; y += 2) for (let x = (y % 4) ? -1 : 0; x < w; x += 2) m.strokeRect(x * cell + 0.5, y * cell + 0.5, cell * 2, cell * 2);
    }
    const [x0, y0, x1, y1] = k.den;  // the cats' basket: a rug
    m.fillStyle = T.rug; rounded(m, x0 * cell + 2, y0 * cell + 2, (x1 - x0 + 1) * cell - 4, (y1 - y0 + 1) * cell - 4, cell * 0.5); m.fill();
    m.strokeStyle = T.stitch; m.lineWidth = Math.max(1, cell * 0.08); m.setLineDash([cell * 0.25, cell * 0.18]); m.stroke(); m.setLineDash([]);
    // walls (1) and mouse holes (2) are drawn alike — a dark base with a lighter crown that joins up with its
    // neighbours, rounded where it ends — and then each hole gets its opening
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? walls[y * w + x] : 0);
    const wall = (x, y) => at(x, y) > 0;
    // one cell of wall, pulled in by `ins` on its open sides and rounded on the corners where both sides are open
    const block = (x, y, ins, round, dy = 0) => {
      const L = wall(x - 1, y), R = wall(x + 1, y), U = wall(x, y - 1), D = wall(x, y + 1);
      const px0 = x * cell + (L ? -0.5 : ins), px1 = (x + 1) * cell + (R ? 0.5 : -ins);
      const py0 = y * cell + (U ? -0.5 : ins) + dy, py1 = (y + 1) * cell + (D ? 0.5 : -ins) + dy;
      const corner = (a, b) => (a || b ? 0 : round);
      const tl = corner(L, U), tr = corner(R, U), br = corner(R, D), bl = corner(L, D);
      m.moveTo(px0 + tl, py0); m.lineTo(px1 - tr, py0); m.quadraticCurveTo(px1, py0, px1, py0 + tr);
      m.lineTo(px1, py1 - br); m.quadraticCurveTo(px1, py1, px1 - br, py1);
      m.lineTo(px0 + bl, py1); m.quadraticCurveTo(px0, py1, px0, py1 - bl);
      m.lineTo(px0, py0 + tl); m.quadraticCurveTo(px0, py0, px0 + tl, py0); m.closePath();
    };
    const layer = (color, ins, round, dy) => {
      m.fillStyle = color; m.beginPath();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (wall(x, y)) block(x, y, ins, round, dy);
      m.fill();
    };
    layer('#00000030', 0, cell * 0.45, cell * 0.26);   // the shadow each wall casts on the floor
    layer('#00000038', 0, cell * 0.45, cell * 0.14);
    layer(T.base, 0, cell * 0.42, 0);
    layer(T.crown, cell * 0.16, cell * 0.3, -cell * 0.05);
    // light along the top edge of every wall that has open floor above it
    m.fillStyle = T.light;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!wall(x, y) || wall(x, y - 1)) continue;
      const l = wall(x - 1, y) ? 0 : cell * 0.3, r = wall(x + 1, y) ? 0 : cell * 0.3;
      m.fillRect(x * cell + l, y * cell + cell * 0.13, cell - l - r, Math.max(1, cell * 0.09));
    }
    // each theme's walls: leaves and blossom in the garden, jars on the pantry shelves, brickwork in the cellar
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (at(x, y) !== 1) continue;
      const cx = (x + 0.5) * cell, cy = (y + 0.45) * cell;
      if (T.art === 'leaves') {
        for (let n = 0; n < 5; n++) {
          dot(m, cx + (noise(x, y, n) - 0.5) * cell * 0.62, cy + (noise(x, y, n + 5) - 0.5) * cell * 0.56, cell * 0.13, cell * 0.07,
            noise(x, y, n + 10) * 3.1, n % 2 ? T.fleck : T.base);
        }
        if (noise(x, y, 40) > 0.88) {
          const fx0 = cx + (noise(x, y, 41) - 0.5) * cell * 0.4, fy0 = cy + (noise(x, y, 42) - 0.5) * cell * 0.4, petal = noise(x, y, 43) > 0.5 ? '#ffd9ec' : '#fff3b0';
          for (let n = 0; n < 4; n++) dot(m, fx0 + Math.cos(n * 1.57) * cell * 0.07, fy0 + Math.sin(n * 1.57) * cell * 0.07, cell * 0.055, cell * 0.055, 0, petal);
          dot(m, fx0, fy0, cell * 0.045, cell * 0.045, 0, '#e8940c');
        }
      } else if (T.art === 'jars') {
        m.strokeStyle = '#00000030'; m.lineWidth = Math.max(1, cell * 0.04);
        m.beginPath(); m.moveTo(x * cell + cell * 0.2, cy - cell * 0.1); m.quadraticCurveTo(cx, cy - cell * (0.2 * noise(x, y, 1)), x * cell + cell * 0.8, cy - cell * 0.08); m.stroke();
        if (noise(x, y, 2) > 0.62) {
          dot(m, cx, cy + cell * 0.04, cell * 0.21, cell * 0.21, 0, '#00000040');
          dot(m, cx, cy, cell * 0.2, cell * 0.2, 0, ['#c2463c', '#e0a52e', '#6f9e4c', '#7b5aa6'][Math.floor(noise(x, y, 3) * 4)]);
          dot(m, cx, cy, cell * 0.11, cell * 0.11, 0, T.fleck);
          dot(m, cx - cell * 0.09, cy - cell * 0.1, cell * 0.05, cell * 0.035, -0.6, '#ffffffaa');
        }
      } else {
        m.strokeStyle = '#00000045'; m.lineWidth = Math.max(1, cell * 0.05);
        m.beginPath();
        m.moveTo(x * cell + cell * 0.18, cy + cell * 0.03); m.lineTo(x * cell + cell * 0.82, cy + cell * 0.03);
        const j = x * cell + cell * (0.35 + 0.3 * noise(x, y, 1)), j2 = x * cell + cell * (0.25 + 0.5 * noise(x, y, 2));
        m.moveTo(j, cy - cell * 0.25); m.lineTo(j, cy + cell * 0.03); m.moveTo(j2, cy + cell * 0.03); m.lineTo(j2, cy + cell * 0.31);
        m.stroke();
        if (noise(x, y, 4) > 0.8) dot(m, cx + (noise(x, y, 5) - 0.5) * cell * 0.4, cy + cell * 0.18, cell * 0.14, cell * 0.08, noise(x, y, 6), '#5f7f4a99');  // moss
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (at(x, y) !== 2) continue;
      const across = !wall(x - 1, y);  // the opening runs between the two open cells
      const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell, rl = cell * 0.62, rs = cell * 0.3;
      m.fillStyle = '#0b0705';
      m.beginPath(); m.ellipse(cx, cy, across ? rl : rs, across ? rs : rl, 0, 0, 6.3); m.fill();
      m.fillStyle = T.floor;
      m.beginPath(); m.ellipse(cx, cy, across ? rl : rs * 0.55, across ? rs * 0.55 : rl, 0, 0, 6.3); m.fill();
      m.strokeStyle = '#ffd16688'; m.lineWidth = Math.max(1, cell * 0.06);  // a faint rim so holes are easy to spot
      m.beginPath(); m.ellipse(cx, cy, across ? rl * 0.8 : rs, across ? rs : rl * 0.8, 0, 0, 6.3); m.stroke();
    }
    // the tunnel mouths
    m.fillStyle = '#00000088';
    for (const x of [0, w - 1]) { m.beginPath(); m.ellipse((x + 0.5) * cell, (k.tunnel + 0.5) * cell, cell * 0.45, cell * 0.38, 0, 0, 6.3); m.fill(); }
    const lamp = m.createRadialGradient(w * cell / 2, h * cell / 2, Math.min(w, h) * cell * 0.2, w * cell / 2, h * cell / 2, Math.max(w, h) * cell * 0.68);
    lamp.addColorStop(0, '#ffffff0c'); lamp.addColorStop(0.5, '#00000000'); lamp.addColorStop(1, '#0000004d');
    m.fillStyle = lamp; m.fillRect(0, 0, w * cell, h * cell);
    return c;
  }

  // the crumbs, redrawn into their own layer only when one is nibbled (not 200 arcs every frame)
  function buildFood() {
    const w = W(), h = Hh();
    const c = foodImg || document.createElement('canvas');
    const cw = Math.max(1, Math.round(w * cell * ratio)), ch = Math.max(1, Math.round(h * cell * ratio));
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    const m = c.getContext?.('2d'); if (!m) return null;
    m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, c.width, c.height); m.scale(ratio, ratio);
    const cr = Math.max(1.5, cell * 0.13);
    // the shadow, the crumb, then its highlight: one path each
    for (const [color, ox, oy, r] of [['#00000066', 0, cr * 0.45, cr * 1.15], ['#ffd166', 0, 0, cr], ['#fff6cf', -cr * 0.3, -cr * 0.3, cr * 0.42]]) {
      m.fillStyle = color; m.beginPath();
      for (const [f, kind] of food) {
        if (kind !== 'c') continue;
        const x = (f % w + 0.5) * cell + ox, y = (Math.floor(f / w) + 0.5) * cell + oy;
        m.moveTo(x + r, y); m.arc(x, y, r, 0, 6.3);
      }
      m.fill();
    }
    foodDirty = false;
    return c;
  }
  function rounded(m, x, y, w, h, r) {
    m.beginPath(); m.moveTo(x + r, y); m.arcTo(x + w, y, x + w, y + h, r); m.arcTo(x + w, y + h, x, y + h, r);
    m.arcTo(x, y + h, x, y, r); m.arcTo(x, y, x + w, y, r); m.closePath();
  }

  // emoji drawn once per size into a small canvas (fillText every frame is slow on phones)
  const sprites = new Map();
  function sprite(ch, size) {
    const key = ch + size;
    let s = sprites.get(key);
    if (!s) {
      s = document.createElement('canvas'); const n = Math.ceil(size * 1.3 * ratio);
      s.width = s.height = Math.max(1, n);
      const t = s.getContext?.('2d');
      if (t) { t.font = `${size * ratio}px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif`; t.textAlign = 'center'; t.textBaseline = 'middle'; t.fillText(ch, n / 2, n / 2 + size * ratio * 0.06); }
      sprites.set(key, s);
    }
    return s;
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (!S || !g || !walls || !cssW) { banner(); return; }
    if (!mazeImg) mazeImg = buildMaze();
    if (foodDirty || !foodImg) foodImg = buildFood();
    fx?.step(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = theme().bg; g.fillRect(0, 0, canvas.width, canvas.height);
    fx?.begin(g);
    if (mazeImg) g.drawImage(mazeImg, offX * ratio, offY * ratio);
    if (foodImg) g.drawImage(foodImg, offX * ratio, offY * ratio);
    g.save(); g.scale(ratio, ratio); g.translate(offX, offY);
    const w = W(), now = performance.now(), pulse = 0.5 + 0.5 * Math.sin(t / 220);
    for (const [c, kind] of food) {  // bells pulse, so they're drawn each frame (there are only a few)
      if (kind !== 'b' && kind !== 'z') continue;
      const x = (c % w + 0.5) * cell, y = (Math.floor(c / w) + 0.5) * cell;
      g.fillStyle = kind === 'z' ? `rgba(120, 220, 255, ${0.15 + 0.25 * pulse})` : `rgba(255, 209, 102, ${0.15 + 0.25 * pulse})`;
      g.beginPath(); g.arc(x, y, cell * (0.5 + 0.15 * pulse), 0, 6.3); g.fill();
      const sp = sprite(kind === 'z' ? '⚡' : '🔔', Math.round(cell * 0.85)), sz = sp.width / ratio;
      g.drawImage(sp, x - sz / 2, y - sz / 2, sz, sz);
    }
    // 🐾 a fading trail of paw prints in each mouse's colour, so you can read who went where
    const kk = S.whisker;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]; if (e.role !== 'm') continue;
      const tr = trails[i] || (trails[i] = []), p = drawPos(i, now);
      if (e.st !== 0 && e.st !== 4) { tr.length = 0; continue; }
      if (p && (!tr.length || now - tr[tr.length - 1][2] > 90)) { tr.push([p[0], p[1], now]); if (tr.length > 9) tr.shift(); }
      const pc = e.seat != null ? ctx.player(kk.seats[e.seat])?.color ?? '#888' : '#888';
      for (const [tx, ty, ta] of tr) {
        const age = (now - ta) / 800; if (age >= 1) continue;
        g.globalAlpha = 0.35 * (1 - age); g.fillStyle = pc;
        g.beginPath(); g.arc((tx + 0.5) * cell, (ty + 0.5) * cell, cell * 0.14 * (1 - age * 0.5), 0, 6.3); g.fill();
      }
      g.globalAlpha = 1;
    }
    // critters: mice under cats
    const k = S.whisker;
    const order = ents.map((_, i) => i).sort((a, b) => (ents[a].role === 'm') - (ents[b].role === 'm')).reverse();
    for (const i of order) {
      const e = ents[i], p = drawPos(i, now);
      if (!p || e.st === 1 || e.st === 5) continue;
      if (e.st === 4 && Math.floor(t / 120) % 2) continue;  // a fresh mouse blinks: untouchable for now
      const x = (p[0] + 0.5) * cell, y = (p[1] + 0.5) * cell;
      const pc = e.seat != null ? ctx.player(k.seats[e.seat])?.color ?? '#888' : '#555';
      const bob = (e.st === 0 || e.st === 2) && k.stage === 'play' ? Math.sin(t / 70 + i) * cell * 0.05 : 0;
      g.fillStyle = pc + 'aa';
      g.beginPath(); g.ellipse(x, y + cell * 0.32, cell * 0.42, cell * 0.16, 0, 0, 6.3); g.fill();
      if (i === k.mine) {
        g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, cell * 0.08); g.globalAlpha = 0.5 + 0.5 * pulse;
        g.beginPath(); g.arc(x, y, cell * 0.62, 0, 6.3); g.stroke(); g.globalAlpha = 1;
        const d = pend ?? e.dir, [dx, dy] = DIRS[d];  // the way you're heading (or about to turn)
        g.fillStyle = pend != null ? '#ffd166' : '#ffffffcc';
        g.beginPath();
        const ax = x + dx * cell * 0.85, ay = y + dy * cell * 0.85;
        g.moveTo(ax + dx * cell * 0.22, ay + dy * cell * 0.22);
        g.lineTo(ax - dy * cell * 0.17, ay + dx * cell * 0.17); g.lineTo(ax + dy * cell * 0.17, ay - dx * cell * 0.17); g.fill();
      }
      let ch = ICON[e.role];
      if (e.st === 2) {  // panicking; the last stretch flickers back to a cat
        ch = e.spookEnd - now < 1500 && Math.floor(t / 150) % 2 ? ICON[e.role] : ICON.spook;
      } else if (e.st === 3) ch = ICON.basket;
      const sp = sprite(ch, Math.round(cell * 1.05)), sz = sp.width / ratio;
      g.globalAlpha = e.st === 3 ? 0.6 : 1;
      g.drawImage(sp, x - sz / 2, y - sz / 2 + bob, sz, sz);
      g.globalAlpha = 1;
    }
    // 😨 danger pulse: a red ring (and a ! once it is very close) round your mouse when a hunting cat is near
    const me = k.mine != null ? ents[k.mine] : null, mp = me && me.role === 'm' && me.st !== 5 && me.st !== 1 && k.stage === 'play' ? drawPos(k.mine, now) : null;
    if (mp) {
      let best = 99;
      for (let i = 0; i < ents.length; i++) {
        const c = ents[i]; if (c.role !== 'c' || c.st !== 0) continue;
        const cp = drawPos(i, now); if (!cp) continue;
        best = Math.min(best, Math.hypot(cp[0] - mp[0], cp[1] - mp[1]));
      }
      if (best < 5) {
        const near = 1 - best / 5, x = (mp[0] + 0.5) * cell, y = (mp[1] + 0.5) * cell, beat = 0.5 + 0.5 * Math.sin(t / (260 - 140 * near));
        g.strokeStyle = `rgba(255, 70, 70, ${(0.25 + 0.5 * near) * (0.5 + 0.5 * beat)})`;
        g.lineWidth = Math.max(2, cell * (0.1 + 0.12 * near));
        g.beginPath(); g.arc(x, y, cell * (0.8 + 0.5 * near * beat), 0, 6.3); g.stroke();
        if (best < 2.5) { g.font = `bold ${Math.round(cell * 0.9)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ff4d4d'; g.fillText('!', x, y - cell * 1.15 - beat * cell * 0.1); }
      }
    }
    g.restore();
    fx?.draw(g); fx?.end(g);
    banner();
  }

  function banner() {
    const b = $('wkBanner'); if (!b || !S) return;
    const k = S.whisker;
    let text = '';
    if (S.phase === 'playing' && k.stage === 'countdown') {
      const s = Math.ceil((S.countAt - performance.now()) / 1000);
      text = s > 0 ? String(s) : 'GO';
      const my = myEnt();
      const who = my ? (my.role === 'c' ? "🐱 You're a cat: catch the mice" : "🐭 You're a mouse: nibble, don't get caught") : `Round ${k.round} of ${k.rounds}`;
      b.dataset.sub = k.themeName ? `${k.themeName} · ${who}` : who;
    } else if (S.phase === 'playing' && k.stage === 'over') {
      text = `Round ${k.round} done`;
      const nx = k.next?.[k.me];
      b.dataset.sub = nx ? (nx === 'c' ? 'Next round you hunt 🐱' : "Next round you're a mouse 🐭") : '';
    }
    if (text !== lastCount) {
      if (S.phase === 'playing' && k.stage === 'countdown' && text && myEnt()) ctx.sfx(text === 'GO' ? 'good' : 'tick');
      lastCount = text;
      b.hidden = !text; b.textContent = text;
      const sub = b.dataset.sub; if (sub) b.append(ctx.el('small', '', sub));
    }
  }

  // ---------- panels

  // The HUD and side list change many times a second (every crumb is a point), so they're built once per
  // shape (round, ranking, who's out, hearts) and otherwise only their text is touched.
  let hudCache = null;
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  function renderSide() {
    const k = S.whisker, rows = $('wkRows'), hud = $('wkHud'); if (!rows || !hud) return;
    const t = timeLeft == null ? null : Math.max(0, Math.ceil(timeLeft - (performance.now() - timeAt) / 1000));
    renderPadMe();
    const padOff = !showPad || k.mine == null || S.phase !== 'playing', pad = $('wkPad');
    if (pad.hidden !== padOff) pad.hidden = padOff;
    const bySeat = new Map(ents.filter((e) => e.seat != null).map((e) => [e.seat, e]));
    const order = k.seats.map((_, i) => i).sort((a, b) => k.score[b] - k.score[a]);
    const shape = JSON.stringify([k.round, k.stage, order, ents.map((e) => [e.seat, e.role, e.st === 5 || e.st === 1, e.lives])]);
    if (!hudCache || hudCache.shape !== shape || !rows.childElementCount) {
      hudCache = { shape, pill: ctx.el('span', 'wk-chip wk-time'), scores: [], chips: [] };
      hud.replaceChildren(hudCache.pill);
      rows.replaceChildren(ctx.el('div', 'hint left', `Round ${k.round} of ${k.rounds}${k.themeName ? ` · ${k.themeName}` : ''}`));
      for (const i of order) {
        const p = ctx.player(k.seats[i]), e = bySeat.get(i);
        const role = e ? ICON[e.role] : '👀';
        const hearts = e?.role === 'm' ? ' ' + '♥'.repeat(Math.max(0, e.lives)) : '';
        const row = ctx.el('div', 'seat-row wk-row' + (e && e.st === 5 ? ' out' : ''));
        const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
        const sc = ctx.el('b', '', String(k.score[i]));
        row.append(dot, ctx.el('span', 'grow', `${role} ${p?.name ?? 'left'}${i === k.me ? ' (you)' : ''}${hearts}`), sc);
        rows.append(row);
        const chip = ctx.el('span', 'wk-chip' + (i === k.me ? ' me' : '') + (e && (e.st === 5 || e.st === 1) ? ' out' : ''));
        hud.append(chip);
        hudCache.scores.push([i, sc]);
        hudCache.chips.push([i, chip, `${role} ${i === k.me ? 'You' : (p?.name ?? '—').slice(0, 8)} `, hearts]);
      }
      const alley = ents.filter((e) => e.role === 'a').length;
      if (alley) rows.append(ctx.el('div', 'hint left', `🐈‍⬛ ${alley} alley cat${alley > 1 ? 's' : ''} prowl for nobody.`));
    }
    let crumbs = 0;
    for (const v of food.values()) if (v === 'c') crumbs++;
    const play = t != null && k.stage === 'play';
    setText(hudCache.pill, `${play ? `⏱ ${t}s · ` : ''}🧀 ${crumbs}`);
    hudCache.pill.classList.toggle('low', play && t <= 10);
    for (const [i, el] of hudCache.scores) setText(el, String(k.score[i]));
    for (const [i, el, head, hearts] of hudCache.chips) setText(el, `${head}${k.score[i]}${hearts}`);
  }
  function renderPadMe() {
    const el = $('wkMe'); if (!el) return;
    const e = myEnt();
    el.textContent = e ? ICON[e.role] : '';
  }

  function turnText(s) {
    const k = s.whisker, e = k.mine != null ? k.ents[k.mine] : null;
    if (s.phase !== 'playing' || !e) return null;
    if (k.stage === 'countdown') return `Round ${k.round} — get ready!`;
    if (k.stage === 'over') return `Round ${k.round} done`;
    return e.role === 'c' ? '🐱 Hunt the mice!' : '🐭 Nibble and dodge!';
  }

  return { mount, render, fast, unmount, turnText };
})();
