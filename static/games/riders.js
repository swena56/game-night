// Light Riders: the server simulates the grid; this module keeps a local copy of every trail (full
// views replace it, fast updates append recent cells), draws it in 3D (three.js) or 2D, and sends
// turns. Bikes glide between server ticks so motion looks smooth at any tick rate.
// The arena fills the room; scores and the boost button float on top of it. Swipe anywhere (or, in
// tap mode, tap the left/right half to turn relative to your bike); your bike turns on screen at
// once, before the server confirms. Crashes cost a life: the wreck clears and you respawn.
// 🐍 Snake mode draws the same trails as snake bodies that eat orbs. A body can cross itself, so fast
// updates are lined up by each snake's count of cells moved (`sq`) instead of by looking cells up.
UI.riders = (() => {
  let S, ctx, trails = [], live = [], lastTick = 0, tickAt = 0, round = 0, ring = 0, lastTwo = 0;  // ring: 🧱 closed bands
  let shape = '', fitFor = 0;  // the board's size, and the round whose countdown has had our screen's shape
  let meals = [], spilled = new Map(), closing = new Set(), follow_ = null;  // 🐍 meals on their way down bodies, new white orbs, who's been called as close, the zoomed view (null: by itself)
  let prior = [], steerBy = 'auto', point = null;  // each snake's heading before its last turn; how to steer; where the finger or mouse points
  const CLEAR = 11, CLOSE = 17;  // 🐍 squares smaller than CLEAR px zoom the view, to about CLOSE px each
  const squarePx = () => { const s_ = $('lrStage'); return s_ ? Math.min(s_.clientWidth / cols(), s_.clientHeight / rows()) : CLOSE; };
  const zooming = () => isSnake() && (follow_ ?? squarePx() < CLEAR);
  // how much of the whole-board view the zoomed one covers (1: all of it)
  const zoomPart = () => Math.max(0.18, Math.min(follow_ === true ? 0.55 : 1, squarePx() / CLOSE));
  let gl = null, flat = null, raf = 0, ro = null, keyHandler = null, swipe = null, root = null;
  let preds = [], recent = [], turnNo = 0, tapTurn = false, lastCount = '';  // preds: turns drawn before the server confirms them, oldest first
  let items = new Map(), slow = [], grabsSeen = new Set();  // 🎁 power-ups on the grid (cell → kind), 🐌 slowed riders
  const ITEM = { bolt: ['⚡', '#ffd166'], slow: ['🐌', '#8ce99a'], life: ['❤️', '#ff6b8b'], cut: ['✂️', '#a5d8ff'] };
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let orbs = new Map(), seq = [], size = [];  // 🐍 orbs on the grid (cell → worth), cells each snake has moved, body lengths
  let orbTick = 0;  // the tick our orbs are right up to
  let faces = [];  // 🐍 the way each head is drawn facing, which swings round to its heading (#356)
  let gapes = [], gapeAt = [];  // 🐍 how wide each mouth is open (0 to 1), and when that was last worked out
  let gilded = new Map(), trapped = 0, myTop = 0, recapFor = 0;  // new gold orbs, my traps so far, my longest yet to save, the recap shown
  let swipeScale = 1;  // how far a swipe has to go, against the usual distance
  // 🐍 what an orb is worth decides its look (#346): white (spilled by a crashed snake), green, and the rare gold
  const ORBS = { 1: { color: '#e8f0ff', r: 0.28, name: 'white' }, 2: { color: '#69f08c', r: 0.38, name: 'green' }, 10: { color: '#ffc933', r: 0.62, name: 'gold' } };
  const orbKind = (worth) => ORBS[worth] || ORBS[worth > 2 ? 10 : 2];
  // an orb's picture (#351): a soft glow, a glossy bead lit from the upper left, a glint; gold has rays too.
  // The bead's radius is ORB_BEAD of half the picture, so a view draws it `kind.r / ORB_BEAD` cells out.
  const ORB_BEAD = 0.42, orbArt = {};
  function orbPicture(worth) {
    const kind = orbKind(worth);
    if (orbArt[kind.name]) return orbArt[kind.name];
    const c = document.createElement('canvas'), S_ = 128, mid_ = S_ / 2, r = mid_ * ORB_BEAD;
    c.width = c.height = S_;
    const g = c.getContext('2d');
    if (!g) return c;
    const [light, body, deep] = { white: ['#ffffff', '#cfdcf5', '#7d90b8'], green: ['#d6ffe0', '#3fe071', '#0e8a3c'], gold: ['#fff6bf', '#ffbf1f', '#b86a00'] }[kind.name];
    const fill = (style, radius, x = mid_, y = mid_) => { g.fillStyle = style; g.beginPath(); g.arc(x, y, radius, 0, 6.283); g.fill(); };
    const glow = g.createRadialGradient(mid_, mid_, r * 0.7, mid_, mid_, mid_);
    glow.addColorStop(0, body + 'aa'); glow.addColorStop(0.45, body + '3d'); glow.addColorStop(1, body + '00');
    fill(glow, mid_);
    if (kind.name === 'gold') {  // eight rays, long and short
      g.save(); g.translate(mid_, mid_);
      for (let k = 0; k < 8; k++) {
        const long = k % 2 ? r * 1.65 : r * 2.3;
        g.fillStyle = '#ffe58acc'; g.beginPath(); g.moveTo(-3.5, -r * 0.6); g.lineTo(0, -long); g.lineTo(3.5, -r * 0.6); g.closePath(); g.fill();
        g.rotate(Math.PI / 4);
      }
      g.restore();
    }
    const bead = g.createRadialGradient(mid_ - r * 0.35, mid_ - r * 0.4, r * 0.08, mid_, mid_, r);
    bead.addColorStop(0, light); bead.addColorStop(0.5, body); bead.addColorStop(1, deep);
    fill(bead, r);
    g.strokeStyle = '#00000040'; g.lineWidth = 2; g.beginPath(); g.arc(mid_, mid_, r - 1, 0, 6.283); g.stroke();
    // light coming back up inside the bead, and the glint
    g.strokeStyle = light + 'b0'; g.lineWidth = 3; g.beginPath(); g.arc(mid_, mid_, r * 0.72, 0.35, 2.0); g.stroke();
    fill('#ffffffe6', r * 0.2, mid_ - r * 0.36, mid_ - r * 0.42);
    fill('#ffffffb0', r * 0.09, mid_ - r * 0.04, mid_ - r * 0.56);
    return (orbArt[kind.name] = c);
  }
  const ROOM = 160;  // 🐍 the points a body's buffers start with room for; there's no longest snake, so they grow
  // how thick a body is, `fromTail` and `fromHead` cells in from its ends: a pointed tail and a slight neck
  const girth = (fromTail, fromHead) => Math.min(0.16 + 0.84 * Math.min(1, fromTail / 7), fromHead < 2 ? 0.84 + 0.08 * fromHead : 1);
  // 🐍 the line a body follows (#345): through the points tail to head, with every bend rounded off instead of a
  // square corner. Writes x, y, along (points counted from the tail) into `line` and returns how many samples. Only
  // bends need several: a straight stretch gets one a point, which cuts the work and the geometry several times over.
  let line = new Float32Array(ROOM * 6 * 3);
  function curve(pts, per) {
    const last = pts.length - 1;
    if (line.length < (last * (per + 1) + 3) * 3) line = new Float32Array((last * (per + 1) + 3) * 6);
    let count = 0;
    const add = (x, y, along) => {
      const o = count * 3;
      if (count && Math.abs(x - line[o - 3]) + Math.abs(y - line[o - 2]) <= 1e-3) return;
      line[o] = x; line[o + 1] = y; line[o + 2] = along; count++;
    };
    add(pts[0][0], pts[0][1], 0);
    for (let j = 1; j < last; j++) {
      const [ax, ay] = pts[j - 1], [bx, by] = pts[j], [cx, cy] = pts[j + 1];
      // straight on: the same direction in and out
      if (Math.abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) < 1e-6 && (bx - ax) * (cx - bx) + (by - ay) * (cy - by) >= 0) {
        add(bx, by, j); continue;
      }
      for (let k = 0; k <= per; k++) {  // a quadratic bend from halfway in to halfway out
        const t = k / per, u = 1 - t;
        add(u * u * (ax + bx) / 2 + 2 * u * t * bx + t * t * (bx + cx) / 2, u * u * (ay + by) / 2 + 2 * u * t * by + t * t * (by + cy) / 2, j - 0.5 + t);
      }
    }
    add(pts[last][0], pts[last][1], last);
    return count;
  }
  // 🐍 slithering (#354): the body weaves a little from side to side. The wave belongs to the ground, not the clock:
  // it's worked out from how far along its travels each part of the body is, so the whole snake winds forward along
  // the same curves its head laid down. It fades out toward the head, which only sways. (Drawing only: the snake
  // is still on its squares.) Cells; 0 for anyone who asks their device for less motion.
  const WAVE = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 0.26, WAVE_LONG = 5.2;
  const weave = (travelled, fromHead) => WAVE * Math.sin((travelled * 2 * Math.PI) / WAVE_LONG) * Math.min(1, Math.max(0, (fromHead - 0.6) / 3.5));
  const sway = (travelled) => (WAVE ? 0.16 * Math.cos((travelled * 2 * Math.PI) / WAVE_LONG) : 0);
  // push each of the `count` samples in `line` sideways; `unit` is the size of a cell in the samples' own measure
  function slither(count, first, last, unit) {
    let px = line[0], py = line[1];  // the sample before, where it was
    for (let k = 0; k < count; k++) {
      const o = k * 3, x = line[o], y = line[o + 1], next = Math.min(count - 1, k + 1) * 3;
      const dx = line[next] - px, dy = line[next + 1] - py, len = Math.hypot(dx, dy) || 1;
      const by = weave(first + line[o + 2], last - line[o + 2]) * unit;
      line[o] = x - (dy / len) * by; line[o + 1] = y + (dx / len) * by;
      px = x; py = y;
    }
  }
  // how dark the soft bands along a body are at `n` cells from where they started (0 to 1)
  const band = (n) => (0.5 + 0.5 * Math.cos((n * Math.PI) / 3)) ** 2;
  // the board is n × n until it's fitted to the host's screen
  const cols = () => S?.riders?.w ?? S?.riders?.n ?? 40, rows = () => S?.riders?.h ?? S?.riders?.n ?? 40;

  const isSnake = () => S?.riders?.mode === 'snake';
  const paysLength = () => isSnake() && S.riders.boostCost > 0;  // (a server from before this has charges instead)
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; trails = []; live = []; round = 0; shape = ''; fitFor = 0; meals = []; spilled = new Map(); closing = new Set(); follow_ = load('snake.follow'); prior = []; point = null; faces = []; gapes = []; gapeAt = []; gilded = new Map(); trapped = 0; myTop = 0; recapFor = 0; gl = null; flat = null; preds = []; recent = []; lastCount = '';
    items = new Map(); slow = []; grabsSeen = new Set(); orbs = new Map(); seq = []; size = []; sideKey = '';
    tapTurn = !!load('riders.tapTurn');
    main.innerHTML = `<div class="lr" id="lrRoot"><div class="lr-stage" id="lrStage">
        <div class="lr-hud" id="lrHud"></div>
        <div class="lr-banner" id="lrBanner" hidden></div>
        <div class="lr-pops" id="lrPops" aria-hidden="true"></div>
        <div class="lr-mine" id="lrMine" role="status" hidden></div>
        <div class="lr-recap" id="lrRecap" hidden></div>
        <canvas class="lr-map" id="lrMap" width="192" height="192" aria-hidden="true" hidden></canvas>
        <div class="lr-pad" id="lrPad">
          <span></span><button data-d="0" aria-label="Up">▲</button><span></span>
          <button data-d="3" aria-label="Left">◀</button><span></span><button data-d="1" aria-label="Right">▶</button>
          <span></span><button data-d="2" aria-label="Down">▼</button><span></span></div>
        <button id="lrBoost" class="lr-boost" aria-label="Boost">⚡</button>
        <button id="lrBrake" class="lr-brake" aria-label="Brake">🛑</button>
      </div></div>`;
    side.innerHTML = `<div class="panel"><div id="lrRiders"></div>
      <label class="check"><input type="checkbox" id="lrTap"> Tap left / right side to turn</label>
      <label class="lr-swipe">Swipe sensitivity <select id="lrSwipe"><option value="1.6">Low</option><option value="1">Normal</option><option value="0.65">High</option></select></label>
      <label class="check lr-follow" hidden><input type="checkbox" id="lrFollow"> 🔍 Zoom in on my snake, with a small map of the board</label>
      <label class="lr-swipe">Steering <select id="lrSteer"><option value="auto">Mouse points, finger swipes</option><option value="swipe">Swipe or drag</option><option value="point">Point: head for my finger or mouse</option></select></label>
      <p class="hint left" id="lrHow"></p></div>`;
    $('lrTap').checked = tapTurn;
    swipeScale = +load('riders.swipe') || 1;
    $('lrSwipe').value = String(swipeScale);
    $('lrSwipe').addEventListener('change', (e) => { swipeScale = +e.target.value || 1; store('riders.swipe', swipeScale === 1 ? null : swipeScale); });
    $('lrFollow').addEventListener('change', (e) => { follow_ = e.target.checked; store('snake.follow', follow_); });
    steerBy = load('riders.steer') || 'auto';
    $('lrSteer').value = steerBy;
    $('lrSteer').addEventListener('change', (e) => { steerBy = e.target.value; point = null; store('riders.steer', steerBy === 'auto' ? null : steerBy); how(); });
    $('lrTap').addEventListener('change', (e) => { tapTurn = e.target.checked; store('riders.tapTurn', tapTurn || null); how(); });
    how();
    for (const b of $('lrPad').querySelectorAll('button[data-d]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); steer(+b.dataset.d); });
    $('lrBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); boost(); });
    $('lrBrake').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); brake(); });
    root = $('lrRoot');
    const stage = $('lrStage');
    // The whole game area ignores browser panning, so a swipe can't scroll the page; the pointer is
    // captured so the swipe keeps steering wherever the finger goes.
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, label, select')) return;
      if (!tapTurn && pointsWith(e)) {
        point = { x: e.clientX, y: e.clientY, held: true, cell: null };
        try { root.setPointerCapture(e.pointerId); } catch {}
        aimPoint();
        return;
      }
      if (tapTurn) {  // turn on touch-down: no waiting to tell a tap from a swipe
        const r = root.getBoundingClientRect();
        turn(e.clientX < r.left + r.width / 2 ? 3 : 1);
        return;
      }
      swipe = { x: e.clientX, y: e.clientY };
      try { root.setPointerCapture(e.pointerId); } catch {}
    });
    root.addEventListener('pointermove', (e) => {
      if (point?.held) { point.x = e.clientX; point.y = e.clientY; point.cell = null; aimPoint(); return; }
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      // about 6% of the arena's width: small enough for a phone, not twitchy on a tablet
      if (Math.hypot(dx, dy) < Math.max(18, Math.min(48, root.clientWidth * 0.06)) * swipeScale) return;
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      swipe = { x: e.clientX, y: e.clientY };  // keep swiping in the same gesture
    });
    for (const t of ['pointerup', 'pointercancel']) {
      root.addEventListener(t, () => {
        swipe = null;
        if (point) { point.held = false; point.cell ??= cellUnder(point.x, point.y); }  // a click: carry on to that spot
      });
    }
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select') && e.target.type !== 'checkbox') return;
      const k = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 }[e.code];
      const rel = { KeyQ: 3, Comma: 3, KeyE: 1, Period: 1 }[e.code];
      if (k != null || rel != null) { root?.classList.add('keys'); point = null; }  // keys take over from pointing  // a keyboard player: the arrows can leave the board
      if (k != null) { e.preventDefault(); steer(k); }
      else if (rel != null) { e.preventDefault(); turn(rel); }
      else if (['Space', 'ShiftLeft', 'ShiftRight', 'Enter'].includes(e.code)) { e.preventDefault(); boost(); }
      else if (e.code === 'KeyX') { e.preventDefault(); if (!e.repeat) brake(); }
    };
    addEventListener('keydown', keyHandler);
    ro = window.ResizeObserver ? new ResizeObserver(() => { gl?.resize(); flat?.resize(); }) : null;
    ro?.observe(stage);
    const ready = GL3.load();
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); if (S) (gl || flat)?.reset(); });
    raf = requestAnimationFrame(loop);
  }

  function how() {
    const el = $('lrHow'); if (!el) return;
    const keys = paysLength() ? 'Space boosts' : 'Space boosts, X brakes';
    el.textContent = (tapTurn
      ? `Tap the left or right half of the screen to turn left or right from where your ${isSnake() ? 'snake' : 'bike'} is heading. Keys: arrows / WASD, Q/E turn, ${keys}.`
      : `${isSnake() && steerBy !== 'swipe' ? (steerBy === 'point' ? 'Point or tap where to go.' : 'With a mouse, click or hold where to go; on a touch screen, swipe.') + ' Or use' : 'Swipe anywhere to steer, or use'} the keyboard (arrows / WASD, Q/E turn, ${keys}).`)
      + (paysLength() ? ` A boost costs ${S.riders.boostCost} length and drops it behind you.` : isSnake() || tapTurn ? '' : ' Ride beside a trail to grind a boost back.');
  }

  function unmount() {
    keepLongest();
    cancelAnimationFrame(raf); ro?.disconnect(); removeEventListener('keydown', keyHandler);
    gl?.dispose(); gl = null; flat = null; root = null;
    snd.stop();
  }

  const mine = () => S?.riders?.me;
  const riding = () => S?.phase === 'playing' && S.riders.stage === 'ride';
  const canSteer = () => mine() != null && S.phase === 'playing' && S.riders.stage !== 'over' && live[mine()]?.alive;
  // the way I'll be heading once every turn I've sent has happened (what the next turn is measured from)
  const myDir = () => preds[preds.length - 1]?.dir ?? live[mine()]?.dir ?? 0;
  // the way my head is drawn: turns happen one a tick, so the oldest one still waiting is the one in sight
  const drawnDir = () => preds[0]?.dir ?? live[mine()]?.dir ?? 0;
  // an update confirms or drops the turns waiting
  function settleTurns() {
    const L = live[mine()];
    if (!L) return;
    if (preds.length && L.dir === preds[0].dir) preds.shift();
    while (preds.length && lastTick > preds[0].k + 3) preds.shift();
  }
  function steer(d) {
    if (!canSteer()) return;
    const cur = myDir();
    if (d === cur) return;
    if (d === (cur + 2) % 4) return noTurn();  // the server ignores these too (no U-turns)
    if (preds.length >= 3) return;  // the server keeps three
    // the new heading puts the head somewhere else at once: carry the difference and let it fade, as for a late update
    const was_ = performance.now(), drawn = noteHeads(was_);
    preds.push({ dir: d, k: lastTick + preds.length });
    if (isSnake()) nudgeHeads(drawn, was_);
    buzz(10); snd.play('turn');
    // sent at once, with the turns of the last second: each has a number, so crossed or lost requests do no harm
    const now = performance.now();
    turnNo = Math.max(turnNo + 1, Date.now());
    recent = [...recent.filter((t) => now - t.at < 1000), { n: turnNo, d, at: now }].slice(-3);
    ctx.input({ dir: d, turns: recent.map((t) => [t.n, t.d]) }, true, true);  // (dir: for a server from before numbers)
  }
  // a swipe or key straight back: a short buzz and a mark, so it doesn't feel as if nothing was heard
  function noTurn() {
    buzz(30);
    const stage = $('lrStage'); if (!stage) return;
    stage.classList.remove('nope'); void stage.offsetWidth; stage.classList.add('nope');
  }
  const pointsWith = (e) => isSnake() && (steerBy === 'point' || (steerBy === 'auto' && e.pointerType === 'mouse'));
  const cellUnder = (clientX, clientY) => {
    const stage = $('lrStage'), view = gl || flat;
    if (!stage || !view?.unproject) return null;
    const box = stage.getBoundingClientRect();
    return view.unproject(clientX - box.left, clientY - box.top);
  };
  // turn toward the spot pointed at: along the longer way there, holding a line until the other is clearly longer
  // (so a diagonal isn't a staircase), never back over the neck. Asked each tick, and as the pointer moves.
  function aimPoint() {
    if (!point || !canSteer() || preds.length) return;
    const to = point.held ? cellUnder(point.x, point.y) : point.cell, t = trails[mine()];
    if (!to || !t?.length) return;
    const w = cols(), at = (c) => [c % w, Math.floor(c / w)], [x, y] = at(t[t.length - 1]);
    const dx = Math.max(0, Math.min(w - 1, Math.round(to[0]))) - x, dy = Math.max(0, Math.min(rows() - 1, Math.round(to[1]))) - y;
    if (Math.abs(dx) + Math.abs(dy) <= 1) { if (!point.held) point = null; return; }
    const cur = myDir(), toward = (d) => DIRS[d][0] * dx + DIRS[d][1] * dy;
    // the neck: the cells that would still be just behind the head after one more step (#347)
    const neck = new Set(t.slice(-5));
    const open = (d) => {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      return d !== (cur + 2) % 4 && nx >= 0 && ny >= 0 && nx < w && ny < rows() && !neck.has(ny * w + nx);
    };
    const ranked = [0, 1, 2, 3].filter(open).sort((a, b) => toward(b) + (b === cur ? 3 : 0) - toward(a) - (a === cur ? 3 : 0));
    if (ranked.length && ranked[0] !== cur) steer(ranked[0]);
  }
  const turn = (side) => steer((myDir() + side) % 4);  // 1 = right, 3 = left, relative to the bike
  function boost() {
    const L = live[mine()];
    if (!canSteer() || S.riders.stage !== 'ride' || L.boosting || (paysLength() ? (size[mine()] ?? 0) < S.riders.boostMin : !L.boosts)) return;
    snd.play('boost');
    ctx.input({ boost: true }, true);
  }
  function brake() {
    const L = live[mine()];
    if (paysLength() || !canSteer() || S.riders.stage !== 'ride' || !L.brakes || L.braking) return;
    snd.play('turn');
    ctx.input({ brake: true }, true);
  }
  const colorOf = (i) => ctx.player(S.riders.seats[i])?.color ?? '#888';

  // ---------- state: full views replace the trails, fast updates append the newest cells
  // what changed for rider i between two states: crash, respawn, a boost earned by grinding
  function events(i, was, now) {
    if (!was) return;
    const me = i === mine();
    if (was.alive && !now.alive) {
      (gl || flat)?.crash?.(i);
      snd.play(me ? 'crashMe' : 'crash');
      if (me) { buzz([80, 50, 160]); preds = []; point = null; keepLongest(); }
      if (me && S.riders.maxLives > 1 && now.lives > 0) Kit.callout(`💔 Lost a life: ${now.lives} left`, 'bad', { ms: 1500 });
    } else if (!was.alive && now.alive && S.riders.stage === 'ride') {
      (gl || flat)?.pulse?.(i);
      if (me) { snd.play('respawn'); buzz(20); preds = []; }
    }
    if (now.alive && now.grind > was.grind) (gl || flat)?.grind?.(i);
    if (me && now.alive && was.alive && now.boosts > was.boosts && !now.boosting) { snd.play('earn'); (gl || flat)?.grind?.(i); }
  }

  // 🎁 someone rode over a power-up: say so (loudest when it's yours, or when it slows you)
  function grabs(list, quietly) {
    for (const [k, i, kind] of list || []) {
      const key = `${round}:${k}:${i}:${kind}`;
      if (grabsSeen.has(key)) continue;
      grabsSeen.add(key);
      if (quietly) continue;
      const me = mine(), name = i === me ? 'You' : ctx.player(S.riders.seats[i])?.name ?? '?';
      (gl || flat)?.grab?.(i, kind);
      if (i === me) {
        Kit.callout({ bolt: '⚡ Boosts refilled!', slow: '🐌 Slow-mo! Everyone else crawls', life: '❤️ Extra life!', cut: '✂️ Trail cut in half!' }[kind], 'gold', { ms: 1300 });
        snd.play('earn'); buzz(25);
      } else if (kind === 'slow' && me != null && live[me]?.alive) {
        Kit.callout(`🐌 ${name} slowed you down!`, 'bad', { ms: 1300 });
        snd.play('slow');
      } else snd.play('ping');
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const r = s.riders;
    const size_ = `${r.w ?? r.n}x${r.h ?? r.n}`, fresh = r.round !== round || size_ !== shape;
    shape = size_;
    ring = r.ring || 0;  // a full view carries the closed band (a new round opens it again)
    round = r.round;
    trails = r.trails.map((t) => [...t]);
    const old = live;
    live = r.alive.map((a, i) => ({ alive: a, dir: r.dirs[i], boosts: r.boosts[i], boosting: false,
      brakes: r.brakes?.[i] ?? 0, braking: !!r.braking?.[i],
      lives: r.lives?.[i] ?? 1, grind: r.grind?.[i] ?? 0, respawnAt: r.respawning?.[i] != null ? performance.now() + r.respawning[i] * 1000 : null }));
    if (!fresh) live.forEach((L, i) => { events(i, old[i], L); if (old[i]?.boosting) L.boosting = true; });
    else { preds = []; prior = []; point = null; grabsSeen = new Set(); }
    nudges = [];
    const ate = !fresh && r.mode === 'snake' && r.me != null && r.size[r.me] > (size[r.me] ?? Infinity);
    const grew = !fresh && r.mode === 'snake' ? gains(r.size) : [];
    const nextOrbs = new Map(r.orbs || []);
    noteSpill(nextOrbs, fresh || !old.length);
    orbs = nextOrbs; orbTick = r.tick; seq = [...(r.sq || [])]; size = [...(r.size || [])];
    if (ate) snd.play('ping');
    const mineNow = r.me != null ? r.kills?.[r.me] ?? 0 : 0;
    if (r.mode === 'snake' && old.length && mineNow > trapped) snd.play('trap');
    trapped = mineNow;
    how();
    items = new Map(r.items || []); slow = r.slow || [];
    grabs(r.grabs, fresh || !old.length);
    lastTick = r.tick; tickAt = performance.now();
    if (fresh) (gl || flat)?.reset(); else (gl || flat)?.sync();
    S.countdownAt = performance.now() + r.countdown * 1000;
    if (fresh) S.roundAt = performance.now();
    root.classList.toggle('is-snake', r.mode === 'snake');
    renderSide();
    pops(grew);
  }

  // 🐍 eating (#353): the mouth opens as an orb comes up ahead, snaps shut on it with a bounce of the head,
  // crumbs fly, and then the bulge goes down the body
  const lastMeal = (i, now) => { let at = -1e9, big = 1; for (const m of meals) if (m.i === i && m.at > at) { at = m.at; big = m.big; } return { age: now - at, big }; };
  function foodAhead(i) {
    const t = trails[i]; if (!t?.length || !live[i]?.alive) return false;
    const w = cols(), [dx, dy] = DIRS[headDir(i)];
    let x = t[t.length - 1] % w, y = Math.floor(t[t.length - 1] / w);
    for (let k = 0; k < 3; k++) {
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= w || y >= rows()) return false;
      if (orbs.has(y * w + x)) return true;
    }
    return false;
  }
  // how open snake i's mouth is now (0 to 1), and how much its head is swollen by a gulp
  function mouth(i, now) {
    const { age, big } = lastMeal(i, now);
    const gulp = age < 320 ? 1 + 0.2 * big * Math.sin((Math.max(0, age) / 320) * Math.PI) : 1;
    const want = age < 90 ? 1 - Math.max(0, age) / 90 : age < 200 ? 0 : foodAhead(i) ? 1 : 0;
    const dt = Math.min(100, Math.max(0, now - (gapeAt[i] ?? now)));
    gapeAt[i] = now;
    gapes[i] = (gapes[i] || 0) + (want - (gapes[i] || 0)) * Math.min(1, dt / (age < 200 ? 22 : 60));
    return { open: gapes[i], gulp };
  }
  // the orb breaks up where it was eaten: a flash and a spray of its colour
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  function crumbs(layer, x, y, worth) {
    if (calm?.matches || x < 0 || y < 0 || x > layer.clientWidth || y > layer.clientHeight || layer.childElementCount > 40) return;
    const burst = ctx.el('span', `lr-crumbs ${orbKind(worth).name}`), many = worth >= 5 ? 12 : worth > 1 ? 7 : 4;
    burst.style.left = `${x}px`; burst.style.top = `${y}px`; burst.style.setProperty('--orb', orbKind(worth).color);
    for (let k = 0; k < many; k++) {
      const bit = ctx.el('i'), turn_ = (k / many) * 6.283 + Math.random(), far = (worth >= 5 ? 34 : 20) + Math.random() * 14;
      bit.style.setProperty('--x', `${Math.cos(turn_) * far}px`); bit.style.setProperty('--y', `${Math.sin(turn_) * far}px`);
      burst.append(bit);
    }
    layer.append(burst);
    setTimeout(() => burst.remove(), 520);
  }
  // 🐍 how much fatter snake i is `fromHead` cells back: each recent meal is a bulge sliding toward the tail
  function swell(i, fromHead, now) {
    let by = 1;
    for (const m of meals) {
      if (m.i !== i) continue;
      const gone = ((now - m.at) / 1000) * 26, d = (fromHead - 1.5 - gone) / 1.2;
      if (Math.abs(d) < 3) by += 0.34 * m.big * Math.exp(-d * d) * Math.max(0, 1 - gone / 60);
    }
    return by;
  }
  // new white orbs (a crash, or a boost's price) pop into view
  function noteSpill(next, quietly) {
    const now = performance.now();
    if (!quietly) {
      let gold = false;
      for (const [c, worth] of next) {
        if (orbs.has(c)) continue;
        if (worth === 1) spilled.set(c, now);
        if (worth >= 5) { gilded.set(c, now); gold = true; }
      }
      if (gold) snd.play('gleam');
    }
    for (const [c, at] of gilded) if (now - at > 1300 || !next.has(c)) gilded.delete(c);
    for (const [c, at] of spilled) if (now - at > 900 || !next.has(c)) spilled.delete(c);
  }
  const popIn = (c, now) => (spilled.has(c) ? 1 + 1.6 * Math.exp(-Math.max(0, now - spilled.get(c)) / 170) : 1);
  // 🐍 an update carries what changed among the orbs since a tick a little way back (`oc`: [that tick, [cell, worth;
  // 0 is gone]]). A browser that has fallen further behind than that keeps what it has until the next full view.
  function nextFood(data) {
    if (data.or) return new Map(data.or);  // (a server from before this sends them all)
    if (!data.oc || data.oc[0] > orbTick) return null;
    const next = new Map(orbs);
    for (const [c, worth] of data.oc[1]) { if (worth) next.set(c, worth); else next.delete(c); }
    orbTick = data.k;
    return next;
  }
  // 🐍 who just ate, and how much: [snake, length gained]
  const gains = (next) => (next || []).map((s, i) => [i, s - (size[i] ?? s)]).filter(([i, d]) => d > 0 && live[i]?.alive);
  // float each meal's value up from the head that ate it
  function pops(list) {
    const layer = $('lrPops'), view = gl || flat;
    if (!layer || !view?.project) return;
    for (const [i, worth] of list) {
      meals = [...meals.filter((m) => performance.now() - m.at < 2500), { i, at: performance.now(), big: Math.min(1.6, 0.7 + worth * 0.18) }];
      const at = headPos(i, performance.now()); if (!at) continue;
      const [x, y] = view.project(at[0], at[1]);
      crumbs(layer, x, y, worth);
      const tag = ctx.el('span', `lr-pop ${orbKind(worth).name}${i === mine() ? ' me' : ''}`, `+${worth}`);
      tag.style.left = `${x}px`; tag.style.top = `${y}px`;
      layer.append(tag);
      setTimeout(() => tag.remove(), 1100);
      if (i === mine() && worth >= 5) { snd.play('gold'); buzz(40); }
    }
  }

  function fast(data) {
    if (!S || data.k < lastTick) return;  // a new round starts with a full view
    const t0 = performance.now(), drawn = noteHeads(t0);
    data.p.forEach(([len, alive, dir, boosts, boosting, lives, grind, braking, brakes, ...tail], i) => {
      const t = trails[i]; if (!t) return;
      if (data.sq) follow(t, i, len, data.sq[i], tail);
      else {
        // the newest cells line up with what we hold (cells never repeat within a trail), so this also
        // follows a ✂️ cut, which drops cells from the start
        const at = tail.length ? t.lastIndexOf(tail[0]) : -1;
        if (at >= 0 && t.length - at <= tail.length + 1) { t.length = at; t.push(...tail); if (t.length > len) t.splice(0, t.length - len); }
        else {
          if (len < t.length) t.length = 0;  // the trail was wiped (a crash with lives left, or a respawn)
          for (let idx = Math.max(t.length, len - tail.length); idx < len; idx++) t.push(tail[idx - (len - tail.length)]);
        }
      }
      const was = live[i];
      if (was && was.dir !== dir) prior[i] = was.dir;
      live[i] = { alive: !!alive, dir, boosts, boosting: !!boosting, brakes, braking: !!braking, lives, grind, respawnAt: was?.respawnAt ?? null };
      if (alive) live[i].respawnAt = null;
      events(i, was, live[i]);
    });
    if (data.k !== lastTick) { lastTick = data.k; tickAt = performance.now(); }
    settleTurns();
    nudgeHeads(drawn, t0);
    if (data.sq) {
      const me = mine();
      if (me != null && data.sz[me] > (size[me] ?? Infinity)) snd.play('ping');
      const grew = gains(data.sz);
      size = data.sz;
      const nextOrbs = nextFood(data);
      if (nextOrbs) { noteSpill(nextOrbs, false); orbs = nextOrbs; }
      pops(grew);
      S.riders.won = data.wn;
    }
    if (data.it) items = new Map(data.it);
    if (data.sl) slow = data.sl;
    grabs(data.gr);
    // three or more started and two are left riding: the showdown
    const riding = live.filter((L) => L?.alive || L?.respawnAt).length;
    if (trails.length > 2 && riding === 2 && lastTwo !== round && data.st === 'ride') { lastTwo = round; Kit.callout(isSnake() ? '⚔️ Last two snakes!' : '⚔️ Last two riders!', 'gold', { ms: 1400 }); ctx.sfx('rise', 8); }
    if ((data.w || 0) > ring) { if (!ring) { Kit.callout('🧱 The walls are closing in!', 'bad', { ms: 1500 }); ctx.sfx('alarm'); } ring = data.w; }
    const L = live[mine()];
    aimPoint();
    S.riders.stage = data.st;
    (gl || flat)?.sync();
    renderSide();
  }

  // 🐍 append the cells snake i has moved since the last update, then draw its tail in to the new length.
  // (A gap longer than the update carries is put right by the next full view.)
  function follow(t, i, len, count, tail) {
    const moved = count - (seq[i] ?? 0);
    if (moved < 0) return;
    seq[i] = count;
    if (!len) { t.length = 0; return; }
    if (moved > tail.length) t.length = 0;
    if (moved) t.push(...tail.slice(-moved));
    if (t.length > len) t.splice(0, t.length - len);
  }
  // 🐍 once you're out: the clear leader, or anyone still going
  const watched = () => { const top = leaderOf(); return top >= 0 ? top : live.findIndex((L) => L?.alive); };
  const isOut = () => isSnake() && mine() != null && !live[mine()]?.alive && !live[mine()]?.lives;
  // your longest snake ever on this device, kept with the game's own data in your profile
  const longestEver = () => (typeof Profile === 'undefined' ? 0 : Profile.gameData('snake').longest || 0);
  function keepLongest() {
    if (typeof Profile === 'undefined' || !ctx || ctx.readOnly || !myTop) return;
    const was = longestEver();
    if (myTop > was) {
      Profile.saveGameData('snake', { ...Profile.gameData('snake'), longest: myTop });
      if (was) ctx.toast(`📈 Your longest snake yet: ${myTop} (was ${was})`);
    }
    myTop = 0;
  }
  // between rounds: how everyone did
  function recap() {
    const r = S.riders, box = $('lrRecap'); if (!box) return;
    const show = isSnake() && S.phase === 'playing' && r.stage === 'over' && !!r.recap?.best;
    box.hidden = !show;
    if (!show || recapFor === r.round) return;
    recapFor = r.round;
    keepLongest();
    const rows = r.seats.map((pid, i) => ({ i, name: i === r.me ? 'You' : ctx.player(pid)?.name ?? '—', best: r.recap.best[i], traps: r.recap.traps[i] }))
      .sort((a, b) => (b.i === r.won) - (a.i === r.won) || b.best - a.best);
    const table = ctx.el('table'), head = ctx.el('tr');
    for (const t of ['', 'Longest', '🪤 Trapped']) head.append(ctx.el('th', '', t));
    table.append(head);
    for (const row of rows) {
      const tr = ctx.el('tr', row.i === r.me ? 'me' : ''), who = ctx.el('td'), dot = ctx.el('i');
      dot.style.background = colorOf(row.i);
      who.append(dot, ctx.el('span', '', `${row.i === r.won ? '🏆 ' : ''}${row.name}`));
      tr.append(who, ctx.el('td', '', String(row.best)), ctx.el('td', '', String(row.traps)));
      table.append(tr);
    }
    box.replaceChildren(table);
  }
  // 🐍 the one clear longest snake alive, once anyone has grown (-1: nobody leads)
  function leaderOf() {
    const ranked = size.map((s, i) => [live[i]?.alive ? s : 0, i]).sort((a, b) => b[0] - a[0]);
    return ranked.length > 1 && ranked[0][0] > ranked[1][0] && ranked[0][0] > 8 ? ranked[0][1] : -1;
  }
  // once a round for each snake: it's nearly at the goal, so go and stop it (or hurry)
  function callClose() {
    const r = S.riders;
    if (!r.goal || r.stage !== 'ride' || S.phase !== 'playing') return;
    size.forEach((s, i) => {
      if (!live[i]?.alive || s < r.goal * 0.8 || s >= r.goal || closing.has(`${r.round}:${i}`)) return;
      closing.add(`${r.round}:${i}`);
      if (i !== r.me) snd.play('near');
      Kit.callout(i === r.me ? `🔥 Almost there: ${s} of ${r.goal}` : `🔥 ${ctx.player(r.seats[i])?.name ?? '?'} is close: ${s} of ${r.goal}`, i === r.me ? 'gold' : 'bad', { ms: 1500 });
    });
  }
  let sideKey = '';
  function renderSide() {
    const r = S.riders, box = $('lrRiders'); if (!box) return;
    const me = r.me != null ? live[r.me] : null;
    const b = $('lrBoost');
    const paid = paysLength();  // 🐍 a boost is bought with length
    b.textContent = paid ? `⚡−${r.boostCost}` : me ? `⚡${me.boosts}` : '⚡';
    b.title = b.ariaLabel = paid ? `Boost: costs ${r.boostCost} length` : 'Boost';
    b.classList.toggle('paid', paid);
    b.style.setProperty('--g', me && !paid ? Math.min(1, me.grind / (r.grindFull || 25)) : 0);
    b.disabled = !me || !me.alive || r.stage !== 'ride' || (paid ? (size[r.me] ?? 0) < r.boostMin : !me.boosts);
    b.hidden = r.me == null;
    const br = $('lrBrake');
    br.textContent = me ? `🛑${me.brakes}` : '🛑';
    br.disabled = !me || !me.alive || !me.brakes || me.braking || r.stage !== 'ride';
    br.hidden = r.me == null || paid;
    $('lrPad').hidden = r.me == null;
    // fast updates arrive every tick: only rebuild the panels when something on them changed (#32)
    const snake = isSnake();
    if (snake) callClose();
    document.querySelector('.lr-follow').hidden = !snake;
    if (snake) $('lrFollow').checked = zooming();
    $('lrSteer').parentElement.hidden = !snake;
    const key = JSON.stringify([r.round, r.stage, r.wins, r.seats, r.me, slow, size, live.map((L) => [L?.alive, L?.lives, L?.respawnAt != null])]);
    if (key === sideKey && box.childElementCount) return;
    sideKey = key;
    // lives as hearts: red for each one left, a dim outline for each one gone (#346)
    const hearts = (i) => {
      const left = Math.max(0, live[i]?.lives ?? 0), box_ = ctx.el('span', 'lr-hearts');
      if (r.maxLives < 2) return box_;
      box_.title = box_.ariaLabel = `${left} ${left === 1 ? 'life' : 'lives'} left`;
      for (let k = 0; k < Math.max(r.maxLives, left); k++) box_.append(ctx.el('span', k < left ? 'on' : 'off', k < left ? '♥' : '♡'));
      return box_;
    };
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} · first to ${r.target}${r.maxLives > 1 ? ` · ${r.maxLives} lives` : ''}`));
    if (snake) {
      box.append(ctx.el('div', 'hint left', `🐍 ${r.goal ? `First to length ${r.goal} takes the round, or the last snake with lives left.` : 'The last snake with lives left takes the round.'} Running into another snake, or the 5 blocks behind your own head, costs a life. Farther back you can cross yourself; the edge just turns you.`));
      const key_ = ctx.el('div', 'lr-key');
      for (const [worth, what] of [[1, 'from a crash'], [2, ''], [10, 'rare']]) {
        const item = ctx.el('span', ''), dot = ctx.el('i'); dot.style.background = ORBS[worth].color;
        item.append(dot, ctx.el('b', '', `+${worth}`), ctx.el('small', '', what)); key_.append(item);
      }
      box.append(key_);
    }
    if (r.pickups) box.append(ctx.el('div', 'hint left', '🎁 Ride over power-ups: ⚡ boosts back · 🐌 rivals crawl · ❤️ a life · ✂️ half your trail gone'));
    const hud = $('lrHud'); hud.innerHTML = '';
    const leader = snake ? leaderOf() : -1;
    const reach = (i) => (r.goal ? `${size[i]}/${r.goal}` : `${size[i]}`);
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), L = live[i];
      const out = !L?.alive && L?.respawnAt == null;
      const row = ctx.el('div', 'seat-row lr-row' + (L?.alive ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i); dot.style.boxShadow = `0 0 8px ${colorOf(i)}`;
      const long = snake && L?.alive ? ` · ${reach(i)} long${i === leader ? ' 👑' : ''}` : '';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${L?.alive ? '' : out ? ' 💥' : ' ⟳'}${long}`),
        hearts(i), ctx.el('b', '', '★'.repeat(r.wins[i]) || '·'));
      box.append(row);
      const chip = ctx.el('span', 'lr-chip' + (i === r.me ? ' me' : '') + (out ? ' out' : ''));
      const c = ctx.el('i'); c.style.background = colorOf(i); c.style.boxShadow = `0 0 6px ${colorOf(i)}`;
      chip.append(c, ctx.el('span', '', `${i === r.me ? 'You' : (p?.name ?? '—').slice(0, 8)}${snake && L?.alive ? ` ${i === leader ? '👑' : '🐍'}${reach(i)}` : ''} ${'★'.repeat(r.wins[i])}`), hearts(i),
        ctx.el('span', '', L?.alive ? (slow[i] ? ' 🐌' : '') : out ? ' 💥' : ' ⟳'));
      hud.append(chip);
    });
    // your own lives (and length), large at the foot of the arena
    const own = $('lrMine');
    own.hidden = r.me == null || (r.maxLives < 2 && !snake);
    if (!own.hidden) {
      const left = Math.max(0, live[r.me]?.lives ?? 0);
      const was = Number(own.dataset.lives ?? left); own.dataset.lives = left;
      const eye = snake && !live[r.me]?.alive && !left ? watched() : -1;
      const record = snake ? longestEver() : 0;
      own.replaceChildren(hearts(r.me), ctx.el('small', '', eye >= 0 ? `👀 Watching ${ctx.player(r.seats[eye])?.name ?? '?'}` : [r.maxLives > 1 ? (left ? `${left} ${left === 1 ? 'life' : 'lives'} left` : 'Out of lives') : '', snake ? `🐍 ${size[r.me] ?? 0}${r.goal ? ` / ${r.goal}` : ' long'}` : '', record > (size[r.me] ?? 0) ? `best ${record}` : ''].filter(Boolean).join(' · ')));
      if (snake && live[r.me]?.alive) myTop = Math.max(myTop, size[r.me] ?? 0);
      if (snake && r.goal) {  // how far to the goal
        const bar = ctx.el('span', 'lr-goal'), fill = ctx.el('i');
        fill.style.width = `${Math.min(100, ((size[r.me] ?? 0) / r.goal) * 100)}%`; bar.append(fill); own.append(bar);
      }
      own.classList.toggle('last', r.maxLives > 1 && left === 1);
      if (left < was) { own.classList.remove('hit'); void own.offsetWidth; own.classList.add('hit'); }
    }
  }

  // where a rider's bike is drawn: past its last cell by the fraction of a tick that has elapsed
  function rawHead(i, now) {
    const t = trails[i]; if (!t?.length) return null;
    const w = cols(), c = t[t.length - 1], x = c % w, y = Math.floor(c / w);
    const L = live[i];
    if (!L?.alive || S.riders.stage !== 'ride') return [x, y];
    const per = 1000 / S.riders.speed, step = (now - tickAt) / per;
    // 🐌 a slowed rider moves on even ticks only: spread its glide over two ticks
    const f = slow[i] || L.braking ? ((lastTick % 2) + step) / 2 : step * (L.boosting ? 2 : 1);
    // A late update (#87, "lag spikes"): keep gliding instead of freezing at the cell's edge, easing to a stop
    // a little way into the next cell, so a short hiccup reads as a stumble rather than a stop-and-jump.
    const g = f < 0.8 ? f : 0.8 + 0.6 * (1 - Math.exp(-(f - 0.8) / 0.6));
    const [dx, dy] = DIRS[headDir(i)];
    if (!isSnake()) return [x + dx * g, y + dy * g];
    const clamp = (v, most) => Math.min(most - 1, Math.max(0, v));
    return [clamp(x + dx * g, w), clamp(y + dy * g, rows())];
  }
  // 🐍 where a body ends: a full-grown snake's last cell slides toward the next one as the head moves on
  function tailPos(i, now) {
    const t = trails[i], w = cols(), at = (c) => [c % w, Math.floor(c / w)];
    const a = at(t[0]), head = headPos(i, now);
    if (t.length < 2 || t.length < size[i] || !head) return a;
    const [hx, hy] = at(t[t.length - 1]), b = at(t[1]);
    const g = Math.min(1, Math.hypot(head[0] - hx, head[1] - hy));
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  }
  // When an update lands, the head's true spot can differ from where it was drawn a moment ago (a late or
  // bunched-up packet). Rather than snap, carry the difference and let it fade out over ~70 ms.
  let nudges = [];
  function noteHeads(now) { return trails.map((_, i) => headPos(i, now)); }
  function nudgeHeads(before, now) {
    nudges = trails.map((_, i) => {
      const a = before[i], b = rawHead(i, now);
      if (!a || !b || !live[i]?.alive) return null;
      const ox = a[0] - b[0], oy = a[1] - b[1];
      return Math.abs(ox) + Math.abs(oy) < 2.5 ? { ox, oy, at: now } : null;  // a respawn or wipe: jump
    });
  }
  function headPos(i, now) {
    const p = rawHead(i, now), k = nudges[i];
    if (!p || !k) return p;
    const w = Math.exp(-(now - k.at) / 70);
    if (w < 0.02) { nudges[i] = null; return p; }
    const at = [p[0] + k.ox * w, p[1] + k.oy * w];
    if (!isSnake()) return at;
    // 🐍 the carried-over difference mustn't take a head through the fence
    return [Math.min(cols() - 1, Math.max(0, at[0])), Math.min(rows() - 1, Math.max(0, at[1]))];
  }
  // 🐍 which way head i is drawn facing (radians, 0 = right): it swings to its heading over a few frames
  function facing(i, now) {
    const [dx, dy] = DIRS[headDir(i)], want = Math.atan2(dy, dx);
    const was = faces[i];
    if (!was || !isSnake() || S.riders.stage !== 'ride' || !live[i]?.alive || now - was.t > 300) { faces[i] = { a: want, t: now }; return want; }
    const turn_ = Math.atan2(Math.sin(want - was.a), Math.cos(want - was.a));
    const a = was.a + turn_ * (1 - Math.exp(-Math.max(0, now - was.t) / 45));
    faces[i] = { a, t: Math.max(now, was.t) };
    return a;
  }
  const headDir = (i) => {
    const d = i === mine() ? drawnDir() : live[i]?.dir ?? 0;
    return isSnake() && S.riders.stage === 'ride' && live[i]?.alive ? wallTurn(i, d) : d;
  };
  function wallTurn(i, d) {
    const t = trails[i]; if (!t?.length) return d;
    const w = cols(), h = rows(), x = t[t.length - 1] % w, y = Math.floor(t[t.length - 1] / w);
    const inside = (o) => { const a = x + DIRS[o][0], b = y + DIRS[o][1]; return a >= 0 && b >= 0 && a < w && b < h; };
    if (inside(d)) return d;
    const was = live[i]?.dir !== d ? live[i]?.dir : null;
    const room = (o) => (DIRS[o][0] ? (DIRS[o][0] > 0 ? w - 1 - x : x) : (DIRS[o][1] > 0 ? h - 1 - y : y));
    const rank = (o) => (o === was ? 4e6 : 0) + (o === prior[i] ? 2e6 : 0) + room(o);
    const options = [(d + 1) % 4, (d + 3) % 4, was].filter((o) => o != null && inside(o));
    return options.sort((a, b) => rank(b) - rank(a))[0] ?? d;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.riders) return;
    (gl || flat)?.draw(now);
    recap();
    const r = S.riders, banner = $('lrBanner'), me = r.me != null ? live[r.me] : null;
    const left = ((S.countdownAt ?? 0) - now) / 1000;
    let text = '', small = false;
    if (S.phase === 'playing' && r.stage === 'countdown') text = left > 0 ? String(Math.ceil(left)) : 'GO!';
    else if (S.phase === 'playing' && r.stage === 'over') {
      // 🐍 a round that is called early leaves several snakes alive, so the server names the winner
      const w = isSnake() ? r.won : live.findIndex((L) => L?.alive);
      text = w == null ? '' : w < 0 ? '🤝 Draw' : w === r.me ? '🏁 You take the round!' : `🏁 ${ctx.player(r.seats[w])?.name ?? '?'} takes it`;
      small = text.length > 14;
    }
    else if (S.phase === 'playing' && me && !me.alive) {
      small = true;
      text = me.respawnAt != null ? `💥 Respawning in ${Math.max(0, (me.respawnAt - now) / 1000).toFixed(1)}` : '💥 Out — watching';
    }
    banner.hidden = !text; banner.textContent = text; banner.classList.toggle('small', small);
    if (S.phase === 'playing' && r.stage === 'countdown' && fitFor !== r.round && S.host === S.me?.id) {
      const stage = $('lrStage');
      if (stage?.clientWidth && stage.clientHeight) { fitFor = r.round; ctx.input({ fit: (stage.clientWidth / stage.clientHeight) * (isSnake() ? 1.1 : 0.96) }, true); }  // (snakes leave the top for the chips)
    }
    // countdown beeps and the GO, once each
    const count = S.phase !== 'playing' ? '' : r.stage === 'countdown' && left > 0 ? String(Math.ceil(left)) : r.stage === 'ride' ? 'GO' : '';
    if (count !== lastCount) {
      if (me && count && (count !== 'GO' || lastCount)) snd.play(count === 'GO' ? 'go' : 'beep');  // no GO when joining mid-ride
      lastCount = count;
    }
    snd.engine(S.phase === 'playing' && r.stage === 'ride' && !isSnake() && me?.alive ? (me.braking ? 0.5 : me.boosting ? 2 : 1) : null);
  }

  // ---------- sound: an engine hum while you ride and short synthesized hits (no files)
  const snd = (() => {
    let a = null, eng = null;
    const on = () => (typeof prefs === 'undefined' || prefs.sound) && !document.hidden;
    // through the app's output, so the volume setting applies (its own context only if that's missing)
    const shared = () => typeof out === 'function';
    function ac() { a ||= shared() ? out().context : new (window.AudioContext || window.webkitAudioContext)(); if (a.state === 'suspended') a.resume(); return a; }
    const dest = () => (shared() ? out() : a.destination);
    function tone(f0, f1, dur, type, vol, at = 0) {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest()); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, f0, f1, q, vol, at = 0) {
      const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin(Math.PI * k / len);
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
      src.buffer = buf; fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.value = vol; src.connect(fl).connect(g).connect(dest()); src.start(t);
    }
    const HITS = {
      turn: () => tone(900, 700, 0.05, 'square', 0.025),
      boost: () => { noise(0.6, 300, 2600, 1.2, 0.5); tone(110, 330, 0.5, 'sawtooth', 0.04); },
      crash: () => { noise(0.35, 900, 200, 0.8, 0.3); tone(110, 50, 0.3, 'sine', 0.1); },
      crashMe: () => { noise(0.7, 1400, 100, 0.7, 1); tone(90, 30, 0.6, 'sine', 0.35); },
      respawn: () => [0, 1, 2, 3].forEach((k) => tone(330 + k * 165, 360 + k * 180, 0.16, 'triangle', 0.06, k * 0.06)),
      earn: () => [880, 1320].forEach((f, k) => tone(f, f, 0.09, 'triangle', 0.08, k * 0.06)),
      beep: () => tone(660, 660, 0.14, 'square', 0.05),
      go: () => tone(1320, 1320, 0.35, 'square', 0.06),
      slow: () => tone(500, 140, 0.5, 'sawtooth', 0.05),
      ping: () => tone(1180, 1180, 0.07, 'triangle', 0.03),
      gold: () => [988, 1319, 1976].forEach((f, k) => tone(f, f, 0.12, 'triangle', 0.09, k * 0.055)),  // 🐍 you ate gold
      gleam: () => tone(1760, 2350, 0.18, 'sine', 0.025),  // a gold orb has appeared
      trap: () => { noise(0.18, 2500, 600, 2, 0.35); [523, 784, 1047].forEach((f, k) => tone(f, f, 0.13, 'square', 0.05, 0.08 + k * 0.08)); },  // someone ran into you
      near: () => [740, 622].forEach((f, k) => tone(f, f, 0.16, 'sawtooth', 0.04, k * 0.18)),  // a rival is close to the goal
    };
    function play(kind) { if (on()) try { ac(); HITS[kind](); } catch {} }
    // the hum: two detuned saws through a low-pass, higher while boosting; silent unless you're riding
    function engine(level) {
      if (!on() || level == null) { stop(); return; }
      try {
        if (!eng) {
          ac();
          const g = a.createGain(), fl = a.createBiquadFilter(); g.gain.value = 0; fl.type = 'lowpass'; fl.Q.value = 4;
          const os = [0, 9].map((cents) => { const o = a.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; o.connect(fl); o.start(); return o; });
          fl.connect(g).connect(dest()); eng = { g, fl, os, level: 0 };
        }
        if (eng.level === level) return;
        eng.level = level;
        const t = a.currentTime;
        for (const o of eng.os) o.frequency.setTargetAtTime(level > 1 ? 120 : 70, t, 0.1);
        eng.fl.frequency.setTargetAtTime(level > 1 ? 1600 : 650, t, 0.1);
        eng.g.gain.setTargetAtTime(level > 1 ? 0.035 : 0.02, t, 0.15);
      } catch {}
    }
    function stop() {
      if (!eng) return;
      const e = eng; eng = null;
      try { e.g.gain.setTargetAtTime(0, a.currentTime, 0.05); setTimeout(() => e.os.forEach((o) => o.stop()), 300); } catch {}
    }
    return { play, engine, stop };
  })();

  // ---------- three.js arena
  // the phone threw the GPU context away (app switch, memory): start a fresh 3D view
  function lost(stage) {
    if (!stage.isConnected) return;
    gl?.dispose(); gl = make3d(stage);
    if (!gl) flat ||= make2d(stage); if (S) (gl || flat)?.reset();
  }

  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    renderer = GL3.renderer({}, { onLost: () => lost(stage) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(38, 1, 0.5, 500);
    // a night sky that rides with the camera, the arena floor fading into it
    const stg = GL3.stage(renderer, scene, { exposure: 1.15, sky: { bottom: 0x0b1030, horizon: 0x24357a, top: 0x050820, stars: 500, radius: 300 },
      fog: [0x0b1030, 110, 260], hemi: [0xdbe6ff, 0x3a3f6e, 0.95], key: { i: 0.75, pos: [-20, 60, 30], shadow: false } });
    let n = 0, high = 0, mode = null, orbMeshes = null, world = null, ribbons = [], bikes = [], tips = [], drawn = [], pend = [], you = null, arrow = null, sparks = null, walls = [];
    const segGeo = new T.BoxGeometry(1, 1, 1);
    // 🎁 power-ups: a floating badge per item (one texture per kind)
    const itemTex = {}, itemSprites = new Map();
    function badge(kind) {
      if (itemTex[kind]) return itemTex[kind];
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), [icon, col] = ITEM[kind];
      if (g) {
        g.fillStyle = col; g.beginPath(); g.arc(64, 64, 56, 0, 6.283); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 8; g.stroke();
        g.font = '70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, 64, 70);
      }
      return (itemTex[kind] = new T.CanvasTexture(c));
    }
    function drawItems(now) {
      for (const [c, sp] of itemSprites) {
        if (items.get(c) === sp.userData.kind) continue;
        world.remove(sp); sp.material.dispose(); itemSprites.delete(c);
      }
      for (const [c, kind] of items) {
        let sp = itemSprites.get(c);
        if (!sp) {
          sp = new T.Sprite(new T.SpriteMaterial({ map: badge(kind), depthWrite: false, transparent: true }));
          sp.userData.kind = kind; const [x, z] = at(c); sp.position.set(x, 1.3, z);
          world.add(sp); itemSprites.set(c, sp);
        }
        sp.position.y = 1.4 + 0.3 * Math.sin(now / 300 + c);
        sp.scale.setScalar(3.2 + 0.3 * Math.sin(now / 170 + c));
      }
    }

    function build() {
      if (world) scene.remove(world);
      for (const m of ribbons) if (m.userData.dark) m.geometry.dispose();  // each snake has a body of its own
      for (const sp of itemSprites.values()) sp.material.dispose();
      itemSprites.clear();
      world = new T.Group(); scene.add(world);
      n = cols(); high = rows(); mode = S.riders.mode;
      const half = n / 2, deep = high / 2;
      // floor with a glowing grid texture
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const g = c.getContext('2d');
      let mat = new T.MeshStandardMaterial({ color: 0x1b2a66, roughness: 0.9 });
      const garden = isSnake();  // 🐍 a lawn of two greens with a wooden fence, so the snakes and orbs stand out
      if (g) {
        g.fillStyle = '#16214f'; g.fillRect(0, 0, 512, 512);
        g.strokeStyle = '#5b9dff66'; g.lineWidth = 3;
        for (let k = 0; k <= 8; k++) { const p = (k * 512) / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
        if (garden) {
          for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#16482f' : '#1b5437'; g.fillRect(x * 128, y * 128, 128, 128); }
          for (let k = 0; k < 900; k++) {  // blades of grass, the same every time
            const x = (k * 197) % 512, y = (k * 331) % 512;
            g.strokeStyle = k % 3 ? '#2f7a4e55' : '#0c2c1c66'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (k % 5) - 2, y - 7); g.stroke();
          }
        }
        const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(n / 8, high / 8);
        tex.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);  // the grid stays visible at the far edge
        // the floor's own picture glows, so the grid lines light up and not just the lamps' share of them
        mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: garden ? 0.18 : 0.32 });
      }
      const floor = new T.Mesh(new T.PlaneGeometry(n, high), mat); floor.rotation.x = -Math.PI / 2; world.add(floor);
      const wallMat = garden ? new T.MeshStandardMaterial({ color: 0xb98a52, emissive: 0x4a2f14, emissiveIntensity: 0.6, roughness: 0.7 })
        : new T.MeshStandardMaterial({ color: 0x8ecae6, emissive: 0x8ecae6, emissiveIntensity: 0.9 });
      walls = [];
      for (const [w, d, x, z] of [[n + 1, 0.5, 0, -deep - 0.25], [n + 1, 0.5, 0, deep + 0.25], [0.5, high + 1, -half - 0.25, 0], [0.5, high + 1, half + 0.25, 0]]) {
        const m = new T.Mesh(new T.BoxGeometry(w, 1.2, d), wallMat); m.position.set(x, 0.6, z); world.add(m); walls.push(m);
      }
      ribbons = []; bikes = []; tips = []; drawn = []; pend = [];
      orbMeshes = null;
      if (isSnake()) {
        orbMeshes = {};
        const flat_ = new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
        for (const worth of [1, 2, 10]) {
          const art = new T.CanvasTexture(orbPicture(worth));
          art.encoding = T.sRGBEncoding; art.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
          const mesh = new T.InstancedMesh(flat_, new T.MeshBasicMaterial({ map: art, transparent: true, depthWrite: false, toneMapped: false, fog: false }), orbRoom());
          mesh.count = 0; mesh.frustumCulled = false; mesh.userData.name = ORBS[worth].name; world.add(mesh);
          orbMeshes[mesh.userData.name] = mesh;
        }
      }
      S.riders.seats.forEach((_, i) => {
        const color = new T.Color(colorOf(i));
        if (isSnake()) return buildSnake(color);
        // (no tone mapping here either: the trails keep their full colour against the lit floor)
        const rm = new T.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.3), emissive: color, emissiveIntensity: 0.85, transparent: true, opacity: 0.9, toneMapped: false });
        const inst = new T.InstancedMesh(segGeo, rm, n * high); inst.count = 0; world.add(inst); ribbons.push(inst);
        const tip = new T.Mesh(segGeo, rm); world.add(tip); tips.push(tip);
        const bike = new T.Group();
        const body = new T.Mesh(new T.BoxGeometry(0.7, 0.55, 1.5), new T.MeshStandardMaterial({ color: 0x111122, emissive: color, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.3 }));
        body.position.y = 0.45; bike.add(body);
        const stripe = new T.Mesh(new T.BoxGeometry(0.74, 0.12, 1.55), new T.MeshBasicMaterial({ color })); stripe.position.y = 0.45; bike.add(stripe);
        for (const z of [-0.55, 0.55]) {
          const wheel = new T.Mesh(new T.TorusGeometry(0.28, 0.08, 8, 18), new T.MeshBasicMaterial({ color }));
          wheel.rotation.y = Math.PI / 2; wheel.position.set(0, 0.3, z); bike.add(wheel);
        }
        bike.scale.setScalar(1.35);  // readable from the steep, phone-shaped view
        world.add(bike); bikes.push(bike); drawn.push(0);
      });
      // you: a pulsing ring under your bike, and a big arrow showing your heading during the countdown
      you = new T.Mesh(new T.RingGeometry(0.95, 1.25, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false }));
      you.rotation.x = -Math.PI / 2; world.add(you);
      const sh = new T.Shape();
      [[-0.45, 0], [0.45, 0], [0.45, 1.4], [1.1, 1.4], [0, 2.7], [-1.1, 1.4], [-0.45, 1.4]].forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
      const am = new T.Mesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
      am.rotation.x = Math.PI / 2; am.position.set(0, 0.12, 1.3);
      arrow = new T.Group(); arrow.add(am); world.add(arrow);
      // grind sparks: one recycled pool of points
      const SP = 160, sp = new Float32Array(SP * 3).fill(-999), col = new Float32Array(SP * 3);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(sp, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      sparks = { pts: new T.Points(geo, new T.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })), vel: Array.from({ length: SP }, () => [0, 0, 0, 0]), next: 0 };
      sparks.pts.frustumCulled = false; world.add(sparks.pts);
      if (scene.fog) { const far = Math.max(1, Math.max(n, high) / 62); scene.fog.near = 110 * far; scene.fog.far = 260 * far; camera.far = 500 * far; }  // a big board mustn't fade into the haze
      resize();
    }
    // 🐍 the skin (#350): scales and diamonds down the back, drawn in greys that each snake's own colour is
    // multiplied by. Across: 6 cells of body, repeating; down: once round it (the back is 3/4 of the way down).
    let skinMap = null;
    function skinTexture() {
      if (skinMap) return skinMap;
      const W = 384, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      if (!g) return null;
      g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, W, H);
      for (let row = 0; row <= 16; row++) {  // rows of overlapping scales, every other one set half a scale along
        for (let col = -1; col <= 32; col++) {
          const x = col * 12 + (row % 2) * 6, y = row * 8;
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 5.5, -1.57, 1.57); g.fill();
          g.strokeStyle = '#9a9a9a'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 6.2, -1.45, 1.45); g.stroke();
        }
      }
      const back = H * 0.75;  // (a texture's v runs bottom up, so this row lands a quarter of the way round: the spine)
      const diamond = (x, y, rx, ry, fill) => { g.fillStyle = fill; g.beginPath(); g.moveTo(x - rx, y); g.lineTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.closePath(); g.fill(); };
      for (let k = -1; k <= 4; k++) {
        const x = k * 96 + 48;
        diamond(x, back, 44, 27, '#ffffff'); diamond(x, back, 36, 21, '#4c4c4c'); diamond(x, back, 15, 9, '#d0d0d0');
        for (const side of [-1, 1]) diamond(x + 48, back + side * 25, 13, 8, '#6a6a6a');  // spots down each flank
      }
      skinMap = new T.CanvasTexture(c);
      skinMap.wrapS = T.RepeatWrapping; skinMap.encoding = T.sRGBEncoding;
      skinMap.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
      return skinMap;
    }
    // a body's buffers: `most` rings of `around` points each (and one more, so the skin joins up), joined up
    function tubeGeo(most, around) {
      const geo = new T.BufferGeometry(), each = around + 1, verts = most * each;
      for (const key of ['position', 'normal', 'color']) geo.setAttribute(key, new T.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('uv', new T.BufferAttribute(new Float32Array(verts * 2), 2).setUsage(T.DynamicDrawUsage));
      const index = [];
      for (let r = 0; r + 1 < most; r++) {
        for (let a = 0; a < around; a++) {
          const p = r * each + a;
          index.push(p, p + each, p + 1, p + 1, p + each, p + each + 1);
        }
      }
      geo.setIndex(index); geo.setDrawRange(0, 0);
      return geo;
    }
    // 🐍 one smooth softly-banded body that bends round its corners, and a wedge head with eyes and a flicking tongue
    // (the head stands in for the bike in every effect)
    function buildSnake(color) {
      // no tone mapping on the snake: it washes bright player colours out to pastel
      const tone = color.clone().multiplyScalar(0.8);  // (the skin's greys darken it again)
      const skin = new T.MeshStandardMaterial({ vertexColors: true, map: skinTexture(), emissive: color, emissiveIntensity: 0.07, roughness: 0.34, metalness: 0.12, toneMapped: false });
      // a tube of rings along the body's line: room for the longest snake, drawn as far as it reaches
      const per = stg.low ? 3 : 5, around = stg.low ? 8 : 14, most = ROOM * 2;
      const geo = tubeGeo(most, around);
      const body = new T.Mesh(geo, skin);
      body.frustumCulled = false; world.add(body);
      let pendingShadow = null;
      // its shadow: the same shape pressed flat, a little to one side (not on low graphics: it draws every body twice)
      if (!stg.low) {
      const shadow = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      shadow.scale.y = 0.02; shadow.position.set(0.3, 0.03, 0.35); shadow.frustumCulled = false; world.add(shadow);
      pendingShadow = shadow;
      }
      const pale = color.clone().lerp(new T.Color(0xffffff), 0.45), dark = tone.clone().multiplyScalar(0.55);
      body.userData = { color: tone, dark, pale, per, around, most, shadow: pendingShadow };
      ribbons.push(body);
      const none = new T.Group(); world.add(none); tips.push(none);
      const head = new T.Group();
      const ball = new T.SphereGeometry(1, 20, 14);
      const part = (mat, sx, sy, sz, x, y, z, parent = head) => {
        const m = new T.Mesh(ball, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m;
      };
      const flesh = new T.MeshStandardMaterial({ color: tone, emissive: color, emissiveIntensity: 0.14, roughness: 0.38, metalness: 0.1, toneMapped: false });
      const white = new T.MeshBasicMaterial({ color: 0xfff7c2 }), black = new T.MeshBasicMaterial({ color: 0x05060f });
      part(flesh, 0.68, 0.44, 0.82, 0, 0.56, 0.1);   // skull, wide at the jaws
      part(flesh, 0.45, 0.32, 0.62, 0, 0.52, 0.62);  // snout
      part(new T.MeshStandardMaterial({ color: pale, emissive: pale, emissiveIntensity: 0.15, roughness: 0.45, toneMapped: false }), 0.13, 0.07, 0.3, 0, 0.98, -0.1);  // a pale flash on the crown
      for (const x of [-1, 1]) {
        part(flesh, 0.27, 0.22, 0.3, x * 0.37, 0.84, 0.3);        // brow
        part(white, 0.2, 0.17, 0.21, x * 0.39, 0.94, 0.38);       // eye
        part(black, 0.065, 0.1, 0.15, x * 0.4, 1.08, 0.43);       // slit pupil
        part(white, 0.035, 0.03, 0.035, x * 0.37, 1.18, 0.49);    // glint
        part(black, 0.05, 0.04, 0.07, x * 0.16, 0.82, 1.0);       // nostril
      }
      // the open mouth (#353): a dark throat and two fangs in front of the snout, grown as it opens
      const gape = new T.Group(); gape.position.set(0, 0.5, 0.9); gape.visible = false; head.add(gape);
      part(new T.MeshBasicMaterial({ color: 0x5c0a1c }), 0.5, 0.12, 0.46, 0, 0, 0.14, gape);
      part(new T.MeshBasicMaterial({ color: 0xff6f8c }), 0.24, 0.13, 0.26, 0, 0.02, 0.1, gape);
      const ivory = new T.MeshBasicMaterial({ color: 0xffffff });
      for (const x of [-1, 1]) {
        const fang = new T.Mesh(new T.ConeGeometry(0.075, 0.34, 8), ivory);
        fang.rotation.x = Math.PI / 2; fang.position.set(x * 0.3, 0.14, 0.42); gape.add(fang);
      }
      head.userData.gape = gape; head.userData.size = 1.55;
      const tongue = new T.Group(); tongue.position.set(0, 0.42, 1.15); head.add(tongue);
      const red = new T.MeshBasicMaterial({ color: 0xff3b5c });
      const stem = new T.Mesh(new T.BoxGeometry(0.11, 0.05, 0.5), red); stem.position.z = 0.2; tongue.add(stem);
      for (const x of [-1, 1]) {
        const fork = new T.Mesh(new T.BoxGeometry(0.08, 0.05, 0.34), red);
        fork.position.set(x * 0.1, 0, 0.57); fork.rotation.y = x * 0.55; tongue.add(fork);
      }
      head.userData.tongue = tongue;
      // dark cheek stripes back from the eyes, and the skin's diamond on the crown
      const stripe_ = new T.MeshBasicMaterial({ color: dark });
      for (const x of [-1, 1]) part(stripe_, 0.07, 0.07, 0.42, x * 0.6, 0.72, 0.02);
      head.scale.setScalar(1.55);  // in proportion to the fuller body
      world.add(head); bikes.push(head); drawn.push(0);
    }
    // out and back about once every 1.6 s, each snake in its own time
    function flick(i, now) {
      const head_ = bikes[i], tongue = head_?.userData.tongue;
      if (!tongue) return;
      const { open, gulp } = mouth(i, now), gape = head_.userData.gape;
      gape.visible = open > 0.06;
      gape.scale.set(0.35 + 0.65 * open, 1, Math.max(0.05, open));
      head_.scale.setScalar(head_.userData.size * gulp);
      const t = (now + i * 530) % 1600;
      tongue.visible = t < 420 && open < 0.2;  // no flicking with its mouth full
      if (tongue.visible) tongue.scale.z = 0.35 + 0.65 * Math.abs(Math.sin((t / 420) * Math.PI * 2));
    }
    function drawBody(i, now) {
      const body = ribbons[i], t = trails[i], { color, dark, pale, per, around } = body.userData;
      let geo = body.geometry;
      const head = headPos(i, now);
      if (!t.length || !head) { geo.setDrawRange(0, 0); body.userData.same = ''; return; }
      const halfX = n / 2 - 0.5, halfZ = high / 2 - 0.5, end = tailPos(i, now);
      // tail end, then every cell, then the gliding head
      const pts = [[end[0] - halfX, end[1] - halfZ]];
      for (let j = 1; j < t.length; j++) pts.push(at(t[j]));
      pts.push([head[0] - halfX, head[1] - halfZ]);
      // bands are counted from the first cell the snake ever moved onto, so they stay put as it slides
      const first = (seq[i] ?? t.length) - t.length;
      // nothing moved (the countdown, a round just over) and no meal on its way down: last frame's body still stands
      const same = `${head[0].toFixed(3)},${head[1].toFixed(3)},${end[0].toFixed(3)},${end[1].toFixed(3)},${t.length},${first}`;
      const eating = meals.some((m) => m.i === i && now - m.at < 2500);
      if (!eating && body.userData.same === same) return;
      body.userData.same = eating ? '' : same;
      const last = pts.length - 1, count = curve(pts, per);
      slither(count, first, last, 1);
      const rings = count;
      if (rings > body.userData.most) {  // longer than ever: make room for half as much again
        body.userData.most = Math.ceil(rings * 1.5);
        const bigger = tubeGeo(body.userData.most, around);
        if (body.userData.shadow) body.userData.shadow.geometry = bigger;
        geo.dispose(); geo = body.geometry = bigger;
      }
      const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, col = geo.attributes.color.array, uv = geo.attributes.uv.array;
      let o = 0, u = 0;
      for (let k = 0; k < rings; k++) {
        const at_ = k * 3, x = line[at_], z = line[at_ + 1], along = line[at_ + 2];
        const a = Math.max(0, k - 1) * 3, b = Math.min(count - 1, k + 1) * 3;
        const dx = line[b] - line[a], dz = line[b + 1] - line[a + 1], len = Math.hypot(dx, dz) || 1, tx = dx / len, tz = dz / len;
        // fuller than a plain tube, flatter underneath than it is wide
        const r = girth(along, last - along) * swell(i, last - along, now), wide = 0.7 * r, tall = 0.52 * r, shade = 0.5 * band(first + along);
        const y = 0.5 * r + 0.05 + along * 0.0004;  // nearer the head lies a hair higher, so a crossing doesn't flicker
        for (let v_ = 0; v_ <= around; v_++, o += 3, u += 2) {
          const turn_ = (v_ / around) * Math.PI * 2, c = Math.cos(turn_), s = Math.sin(turn_);
          pos[o] = x - tz * c * wide; pos[o + 1] = y + s * tall; pos[o + 2] = z + tx * c * wide;
          const nx = -tz * c / 0.7, ny = s / 0.52, nz = tx * c / 0.7, m = Math.hypot(nx, ny, nz) || 1;
          nor[o] = nx / m; nor[o + 1] = ny / m; nor[o + 2] = nz / m;
          uv[u] = (first + along) / 6; uv[u + 1] = v_ / around;  // the skin stays put on the body as the snake moves
          const flank = Math.max(0, 1 - Math.abs(s - 0.28) / 0.2) * 0.55 + (s < -0.1 ? 0.6 : 0);  // pale side lines and belly
          col[o] = color.r + (dark.r - color.r) * shade; col[o + 1] = color.g + (dark.g - color.g) * shade; col[o + 2] = color.b + (dark.b - color.b) * shade;
          col[o] += (pale.r - col[o]) * flank; col[o + 1] += (pale.g - col[o + 1]) * flank; col[o + 2] += (pale.b - col[o + 2]) * flank;
        }
      }
      geo.setDrawRange(0, Math.max(0, rings - 1) * around * 6);
      for (const [key, used] of [['position', o], ['normal', o], ['color', o], ['uv', u]]) {
        const attr = geo.attributes[key];
        attr.updateRange.offset = 0; attr.updateRange.count = used;  // only the rings in use, not room for the longest snake
        attr.needsUpdate = true;
      }
    }
    // gold orbs carry their value over them
    const goldTags = new Map();
    const goldTex = {};
    function goldLabel(worth) {
      if (goldTex[worth]) return goldTex[worth];
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      if (g) {
        g.font = '900 46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 9; g.strokeStyle = '#3b2600'; g.strokeText(`+${worth}`, 64, 34); g.fillStyle = '#ffe27a'; g.fillText(`+${worth}`, 64, 34);
      }
      return (goldTex[worth] = new T.CanvasTexture(c));
    }
    function drawOrbs(now) {
      if (!orbMeshes) return;
      const used = { white: 0, green: 0, gold: 0 };
      for (const [c, worth] of orbs) {
        const [x, z] = at(c), kind = orbKind(worth), gold = worth >= 5, mesh = orbMeshes[kind.name], k = used[kind.name];
        if (k >= mesh.instanceMatrix.count) continue;
        // each breathes in its own time; a gold one turns its rays, and one that has just appeared flares wide
        const pulse_ = 1 + (gold ? 0.14 : 0.07) * Math.sin(now / (gold ? 190 : 300) + c);
        const flare = gilded.has(c) ? 1 + 1.8 * Math.max(0, 1 - (now - gilded.get(c)) / 1300) : 1;
        sc.setScalar((kind.r * 1.15 * pulse_ * popIn(c, now) * flare) / ORB_BEAD); v.set(x, 0.42 + (k % 7) * 0.002, z);
        if (gold) q.setFromAxisAngle(up, now / 1400 + c); else q.identity();
        mtx.compose(v, q, sc); mesh.setMatrixAt(k, mtx); used[kind.name]++;
        if (gold && !goldTags.has(c)) {
          const tag = new T.Sprite(new T.SpriteMaterial({ map: goldLabel(worth), transparent: true, depthWrite: false }));
          tag.scale.set(3.6, 1.8, 1); goldTags.set(c, tag);
        }
      }
      for (const [c, tag] of goldTags) {
        if ((orbs.get(c) ?? 0) < 5) { tag.parent?.remove(tag); tag.material.dispose(); goldTags.delete(c); continue; }
        if (tag.parent !== world) world.add(tag);
        const [x, z] = at(c); tag.position.set(x, 2.2 + 0.25 * Math.sin(now / 300 + c), z);
      }
      for (const mesh of Object.values(orbMeshes)) {
        mesh.count = used[mesh.userData.name];
        mesh.instanceMatrix.updateRange.offset = 0; mesh.instanceMatrix.updateRange.count = Math.max(1, mesh.count) * 16;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // twice the board's usual share of orbs (spills add to them), with some over
    const orbRoom = () => Math.ceil((n * high) / 45) * 2 + 80;
    const at = (c) => [(c % n) - n / 2 + 0.5, Math.floor(c / n) - high / 2 + 0.5];
    const mtx = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3();
    function segment(a, b, setMatrix) {  // a thin glowing wall from point a to point b (x, z)
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) + 0.3;
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      v.set((a[0] + b[0]) / 2, 0.45, (a[1] + b[1]) / 2); sc.set(0.3, 0.9, len);
      mtx.compose(v, q, sc);
      setMatrix(mtx);
    }
    function sync() {
      if (!world || cols() !== n || rows() !== high || S.riders.mode !== mode || ribbons.length !== trails.length) return build();
      if (isSnake()) return;  // bodies are redrawn every frame
      trails.forEach((t, i) => {
        const inst = ribbons[i];
        inst.material.opacity = live[i]?.alive || !riding() ? 0.9 : 0.3;  // the final board stays lit (#79)
        if (t.length < drawn[i]) { drawn[i] = 0; inst.count = 0; }
        if (t.length === drawn[i]) return;
        const from = Math.max(1, drawn[i]);
        for (let k = from; k < t.length; k++) segment(at(t[k - 1]), at(t[k]), (m) => inst.setMatrixAt(k - 1, m));
        inst.count = Math.max(0, t.length - 1);
        // upload only the new segments, not the whole n×n buffer (#32)
        const attr = inst.instanceMatrix;
        pend[i] = Math.min(pend[i] ?? Infinity, from - 1);  // two updates between frames: upload both
        if (attr.updateRange) { attr.updateRange.offset = pend[i] * 16; attr.updateRange.count = Math.max(0, t.length - 1 - pend[i]) * 16; }
        attr.needsUpdate = true;
        drawn[i] = t.length;
      });
    }
    function reset() { build(); drawn = drawn.map(() => 0); sync(); }
    // Fit the whole arena. A tall (portrait) box looks almost straight down so the board fills its
    // width; a wide box keeps a slight angle. Then back off until all four corners fit.
    const base = new T.Vector3(), target = new T.Vector3();
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const halfX = (n || 40) / 2 + 0.8, halfZ = (high || 40) / 2 + 0.8;
      const k = Math.min(1, Math.max(0, (camera.aspect - 0.7) / 0.8));   // 0 portrait … 1 wide
      const back = isSnake() ? 0.08 + 0.1 * k : 0.12 + 0.2 * k;           // snakes: near overhead, so the board is bigger
      target.set(0, 0, halfZ * 0.04 * k);
      let dist = Math.max(halfX, halfZ) * 0.6;
      for (let j = 0; j < 140; j++) {
        camera.position.set(0, dist * 0.9, dist * back); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        const fits = [[-halfX, -halfZ], [halfX, -halfZ], [-halfX, halfZ], [halfX, halfZ]].every(([x, z]) => {
          // (Orb Snakes keeps the board's far edge clear of the score chips along the top)
          const p = new T.Vector3(x, 0, z).project(camera); return Math.abs(p.x) < 0.99 && p.y > -0.98 && p.y < (isSnake() ? 0.86 : 0.98);
        });
        if (fits) break;
        dist *= 1.02;
      }
      base.copy(camera.position);
    }
    // 💥 a crash: sparks in the rider's colour, a shockwave ring, and a shake when it's you
    const booms = [];
    let lastDraw = 0;
    function ringFx(x, z, color, grow) {
      const m = new T.Mesh(new T.RingGeometry(0.6, 0.9, 40), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.userData.grow = grow;
      world.add(m); return m;
    }
    function crash(i) {
      const bike = bikes[i]; if (!bike || !world) return;
      const color = new T.Color(colorOf(i)), N = 70, pos = new Float32Array(N * 3), vel = [];
      for (let k = 0; k < N; k++) {
        pos.set([bike.position.x, 0.5, bike.position.z], k * 3);
        const a = Math.random() * 6.283, up = 2 + Math.random() * 6, sp = 3 + Math.random() * 9;
        vel.push([Math.cos(a) * sp, up, Math.sin(a) * sp]);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color, size: 0.45, transparent: true }));
      world.add(pts);
      booms.push({ pts, ring: ringFx(bike.position.x, bike.position.z, color, 9), vel, t: 0 });
      if (i === S.riders.me) GL3.shake(camera, 1.1);
    }
    // ⟳ a respawn: a ring that closes in on the new spot
    function pulse(i) {
      const t = trails[i]; if (!world || !t?.length) return;
      const [x, z] = at(t[t.length - 1]);
      booms.push({ pts: null, ring: ringFx(x, z, new T.Color(colorOf(i)), -0.6), vel: [], t: 0 });
      booms.at(-1).ring.scale.setScalar(6);
    }
    function grind(i) {
      const bike = bikes[i]; if (!sparks || !bike?.visible) return;
      const a = sparks.pts.geometry.attributes, color = new T.Color(colorOf(i)).lerp(new T.Color(0xffffff), 0.5);
      for (let k = 0; k < 6; k++) {
        const j = sparks.next; sparks.next = (j + 1) % sparks.vel.length;
        a.position.array.set([bike.position.x + (Math.random() - 0.5) * 0.6, 0.3, bike.position.z + (Math.random() - 0.5) * 0.6], j * 3);
        a.color.array.set([color.r, color.g, color.b], j * 3);
        const ang = Math.random() * 6.283, sp = 1 + Math.random() * 3;
        sparks.vel[j] = [Math.cos(ang) * sp, 2 + Math.random() * 3, Math.sin(ang) * sp, 0.5];
      }
    }
    // 🎁 a grab: a burst and a ring in the item's colour
    function grab3d(i, kind) {
      const bike = bikes[i]; if (!sparks || !bike) return;
      const a = sparks.pts.geometry.attributes, color = new T.Color(ITEM[kind][1]);
      for (let k = 0; k < 24; k++) {
        const j = sparks.next; sparks.next = (j + 1) % sparks.vel.length;
        a.position.array.set([bike.position.x, 0.8, bike.position.z], j * 3);
        a.color.array.set([color.r, color.g, color.b], j * 3);
        const ang = Math.random() * 6.283, sp = 3 + Math.random() * 5;
        sparks.vel[j] = [Math.cos(ang) * sp, 4 + Math.random() * 5, Math.sin(ang) * sp, 0.8];
      }
      booms.push({ pts: null, ring: ringFx(bike.position.x, bike.position.z, color, 7), vel: [], t: 0 });
    }
    function tickSparks(dt) {
      if (!sparks) return;
      const p = sparks.pts.geometry.attributes.position;
      let any = false;
      sparks.vel.forEach((v, j) => {
        if (v[3] <= 0) return;
        any = true; v[3] -= dt; v[1] -= 14 * dt;
        p.array[j * 3] += v[0] * dt; p.array[j * 3 + 1] = Math.max(0.05, p.array[j * 3 + 1] + v[1] * dt); p.array[j * 3 + 2] += v[2] * dt;
        if (v[3] <= 0) p.array[j * 3 + 1] = -999;
      });
      if (any) p.needsUpdate = true;
    }
    function tickBooms(dt) {
      for (const b of booms) {
        b.t += dt;
        if (b.pts) {
          const a = b.pts.geometry.attributes.position;
          for (let k = 0; k < b.vel.length; k++) {
            const v = b.vel[k]; v[1] -= 18 * dt;
            a.array[k * 3] += v[0] * dt; a.array[k * 3 + 1] = Math.max(0.05, a.array[k * 3 + 1] + v[1] * dt); a.array[k * 3 + 2] += v[2] * dt;
            if (a.array[k * 3 + 1] <= 0.05) { v[0] *= 0.8; v[2] *= 0.8; v[1] = Math.abs(v[1]) * 0.3; }
          }
          a.needsUpdate = true;
          b.pts.material.opacity = Math.max(0, 1 - b.t / 1.4);
        }
        const g = b.ring.userData.grow;
        b.ring.scale.setScalar(g > 0 ? 1 + b.t * g : Math.max(0.3, 6 * (1 - b.t / 0.6)));
        b.ring.material.opacity = Math.max(0, 0.9 - b.t * 1.5);
      }
      while (booms.length && booms[0].t > 1.4) {
        const b = booms.shift();
        if (b.pts) { world?.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); }
        world?.remove(b.ring); b.ring.geometry.dispose(); b.ring.material.dispose();
      }
    }
    const close = new T.Vector3(), look = new T.Vector3(), focus = new T.Vector3();
    let zoomed = false;
    function draw(now) {
      if (!world) return;
      const dt = Math.min(0.1, (now - lastDraw) / 1000); lastDraw = now;
      // 🧱 the walls move in, ring by ring
      if (walls.length === 4 && walls.ring !== ring) {
        walls.ring = ring;
        const hx = n / 2 - ring, hz = high / 2 - ring, spanX = (n - 2 * ring + 1) / (n + 1), spanZ = (high - 2 * ring + 1) / (high + 1);
        walls[0].position.z = -hz - 0.25; walls[1].position.z = hz + 0.25; walls[2].position.x = -hx - 0.25; walls[3].position.x = hx + 0.25;
        walls.forEach((m) => {
          m.scale.set(m.geometry.parameters.width > 1 ? spanX : 1, 1, m.geometry.parameters.depth > 1 ? spanZ : 1);
          if (isSnake()) return;  // 🐍 the wooden fence keeps its colour (the arena never closes in)
          m.material.color.setHex(ring ? 0xff6b6b : 0x8ecae6); m.material.emissive.setHex(ring ? 0xff6b6b : 0x8ecae6);
        });
      }
      tickBooms(dt); tickSparks(dt); drawItems(now); drawOrbs(now);
      const me = S.riders.me;
      trails.forEach((t, i) => {
        const pos = headPos(i, now), bike = bikes[i], tip = tips[i];
        if (isSnake()) { drawBody(i, now); flick(i, now); }
        if (!pos) { bike.visible = tip.visible = false; return; }
        const p = [pos[0] - n / 2 + 0.5, pos[1] - high / 2 + 0.5];
        bike.visible = !!live[i]?.alive;
        bike.position.set(p[0], 0, p[1]);
        const [dx, dy] = DIRS[headDir(i)];
        bike.rotation.y = isSnake() ? Math.PI / 2 - facing(i, now) : Math.atan2(dx, dy);
        if (isSnake() && riding() && live[i]?.alive && t.length) bike.rotation.y += sway((seq[i] ?? t.length) - t.length + t.length - 1 + Math.hypot(pos[0] - (t[t.length - 1] % n), pos[1] - Math.floor(t[t.length - 1] / n)));
        tip.visible = bike.visible && t.length > 0;
        if (tip.visible) segment(at(t[t.length - 1]), p, (m) => { tip.matrixAutoUpdate = false; tip.matrix.copy(m); });
      });
      const myBike = me != null ? bikes[me] : null, counting = S.riders.stage === 'countdown';
      you.visible = !!myBike?.visible;
      if (you.visible) {
        you.position.set(myBike.position.x, 0.06, myBike.position.z);
        you.scale.setScalar((counting ? 1.6 : 1) + 0.15 * Math.sin(now / 160));
      }
      arrow.visible = !!myBike?.visible && counting;
      if (arrow.visible) {
        arrow.position.copy(myBike.position); arrow.rotation.y = myBike.rotation.y;
        arrow.children[0].position.z = 1.3 + 0.35 * Math.abs(Math.sin(now / 220));
      }
      // the first moments of a round: start close over your bike, then pull back to the whole arena
      camera.position.copy(base); look.copy(target);
      const since = (now - (S.roundAt ?? -1e9)) / 1000;
      if (counting && myBike?.visible && since < 2.4) {
        const e = Math.min(1, Math.max(0, (since - 0.5) / 1.6)), s = e * e * (3 - 2 * e);
        close.set(myBike.position.x, 14, myBike.position.z + 6);
        camera.position.lerpVectors(close, base, s);
        look.lerpVectors(myBike.position, target, s);
      }
      // 🔍 zoom: stay over your own snake, without looking far past the fence. Out of lives, follow the longest.
      let eye = myBike?.visible ? myBike : null;
      if (!eye && isOut()) eye = bikes[watched()]?.visible ? bikes[watched()] : null;
      const watching = isOut() && follow_ !== false;  // out of lives: watch the leader up close
      const zoom = (zooming() || watching) && !!eye && !counting;
      if (zoom) {
        const part = zooming() ? zoomPart() : 0.55, clampTo = (v_, most) => Math.max(-most, Math.min(most, v_));
        close.set(clampTo(eye.position.x, (n / 2) * (1 - part)), 0, clampTo(eye.position.z, (high / 2) * (1 - part)));
        if (!zoomed) focus.copy(close); else focus.lerp(close, Math.min(1, dt * 8));
        camera.position.copy(base).sub(target).multiplyScalar(part).add(focus);
        look.copy(focus);
      }
      zoomed = zoom;
      drawMap(zoom);
      camera.lookAt(look);
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      renderer.render(scene, camera);
      pend = [];
    }
    // the whole board in a corner while zoomed in: gold orbs, every snake, and you ringed
    function drawMap(show) {
      const map = $('lrMap'); if (!map) return;
      map.hidden = !show;
      const g = show && map.getContext('2d'); if (!g) return;
      const cell = 192 / Math.max(n, high), w = Math.round(n * cell), h = Math.round(high * cell);
      if (map.width !== w || map.height !== h) { map.width = w; map.height = h; map.style.aspectRatio = `${w} / ${h}`; }
      g.fillStyle = '#10331fe6'; g.fillRect(0, 0, w, h);
      g.fillStyle = ORBS[10].color;
      for (const [c, worth] of orbs) if (worth >= 5) g.fillRect((c % n) * cell - 1, Math.floor(c / n) * cell - 1, cell + 2, cell + 2);
      trails.forEach((t, i) => {
        if (!live[i]?.alive || !t.length) return;
        g.strokeStyle = colorOf(i); g.lineWidth = Math.max(2, cell * 1.2); g.beginPath();
        t.forEach((c, k) => g[k ? 'lineTo' : 'moveTo'](((c % n) + 0.5) * cell, (Math.floor(c / n) + 0.5) * cell));
        g.stroke();
        if (i === mine()) { const c = t[t.length - 1]; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(((c % n) + 0.5) * cell, (Math.floor(c / n) + 0.5) * cell, 7, 0, 6.283); g.stroke(); }
      });
    }
    function dispose() { stg.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    if (S) build();
    // where board cell (x, y) is on screen, in the stage's own pixels
    const spot = new T.Vector3();
    // the board cell under a point on screen (the stage's own pixels)
    const ray = new T.Raycaster(), floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), ndc = new T.Vector2();
    function unproject(px, py) {
      ndc.set((px / stage.clientWidth) * 2 - 1, 1 - (py / stage.clientHeight) * 2);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(floorPlane, hit) ? [hit.x + n / 2 - 0.5, hit.z + high / 2 - 0.5] : null;
    }
    function project(x, y) {
      spot.set(x - n / 2 + 0.5, 0.8, y - high / 2 + 0.5).project(camera);
      return [((spot.x + 1) / 2) * stage.clientWidth, ((1 - spot.y) / 2) * stage.clientHeight];
    }
    return { sync, reset, resize, draw, dispose, crash, pulse, grind, grab: grab3d, project, unproject };
  }

  // ---------- flat fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let cell = 8;
    const glints = [];  // grind sparks: [x, y, born]
    function resize() {
      const w = cols(), h = rows(), dpr = Math.min(devicePixelRatio || 1, 2);
      const side = Math.min((stage.clientWidth || 320) / w, (stage.clientHeight || 320) / h);  // one cell on screen
      canvas.style.width = `${side * w}px`; canvas.style.height = `${side * h}px`;
      canvas.width = Math.round(side * w * dpr); canvas.height = Math.round(side * h * dpr);
      cell = canvas.width / w;
    }
    let view = { z: 1, x: 0, y: 0 };  // the zoom: the board is drawn z times as big, shifted by x, y canvas pixels
    function aim() {
      const i = mine(), who = i != null && live[i]?.alive ? i : isOut() && follow_ !== false ? watched() : -1;
      const head = who >= 0 ? headPos(who, performance.now()) : null;
      if (!(zooming() || isOut()) || !head || S.riders.stage === 'countdown') return { z: 1, x: 0, y: 0 };
      const z = 1 / (zooming() ? zoomPart() : 0.55), most = (v, size) => Math.min(0, Math.max(size * (1 - z), v));
      return { z, x: most(canvas.width / 2 - (head[0] + 0.5) * cell * z, canvas.width), y: most(canvas.height / 2 - (head[1] + 0.5) * cell * z, canvas.height) };
    }
    function draw(now) {
      const n = cols(), high = rows();
      if (!canvas.width) resize();
      view = aim();
      g.setTransform(view.z, 0, 0, view.z, view.x, view.y);
      const garden = isSnake();
      g.fillStyle = garden ? '#16482f' : '#131c45'; g.fillRect(0, 0, canvas.width, canvas.height);
      if (garden) {
        g.fillStyle = '#1b5437';
        for (let x = 0; x < n; x += 4) for (let y = (x / 4) % 2 ? 4 : 0; y < high; y += 8) g.fillRect(x * cell, y * cell, 4 * cell, 4 * cell);
      }
      if (ring) {  // 🧱 the closed band round the edge
        g.fillStyle = '#ff6b6b33';
        g.fillRect(0, 0, canvas.width, ring * cell); g.fillRect(0, canvas.height - ring * cell, canvas.width, ring * cell);
        g.fillRect(0, 0, ring * cell, canvas.height); g.fillRect(canvas.width - ring * cell, 0, ring * cell, canvas.height);
        g.strokeStyle = '#ff6b6b'; g.lineWidth = 2; g.strokeRect(ring * cell, ring * cell, canvas.width - 2 * ring * cell, canvas.height - 2 * ring * cell);
      }
      g.strokeStyle = garden ? '#ffffff0d' : '#5b9dff44'; g.lineWidth = 1;
      for (let k = 0; k <= n; k += 4) { g.beginPath(); g.moveTo(k * cell, 0); g.lineTo(k * cell, canvas.height); g.stroke(); }
      for (let k = 0; k <= high; k += 4) { g.beginPath(); g.moveTo(0, k * cell); g.lineTo(canvas.width, k * cell); g.stroke(); }
      if (garden) {  // 🐍 orbs lie under the snakes, sized and coloured by what they're worth
        for (const [c, worth] of orbs) {
          const kind = orbKind(worth), x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell;
          const pulse_ = 1 + (worth >= 5 ? 0.14 : 0.07) * Math.sin(now / (worth >= 5 ? 190 : 300) + c);
          const half_ = (cell * kind.r * 1.15 * pulse_ * popIn(c, now)) / ORB_BEAD;
          g.drawImage(orbPicture(worth), x - half_, y - half_, half_ * 2, half_ * 2);
          if (gilded.has(c)) {  // just appeared: a ring closing in on it
            const left = Math.max(0, 1 - (now - gilded.get(c)) / 1300);
            g.strokeStyle = kind.color; g.lineWidth = Math.max(2, cell * 0.2); g.beginPath(); g.arc(x, y, cell * (1 + 4 * left), 0, 6.283); g.stroke();
          }
          if (worth >= 5) {
            g.save(); g.font = `900 ${Math.max(10, Math.round(cell * 0.85))}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.lineWidth = Math.max(2, cell * 0.16); g.strokeStyle = '#3b2600'; g.strokeText(`+${worth}`, x, y - cell * 1.1);
            g.fillStyle = '#ffe27a'; g.fillText(`+${worth}`, x, y - cell * 1.1); g.restore();
          }
        }
      }
      trails.forEach((t, i) => {
        if (!t.length) return;
        const color = colorOf(i), alive = live[i]?.alive;
        if (isSnake()) { drawSnake2d(i, t, color, now); return ring2d(i, now); }
        g.save(); g.strokeStyle = color; g.globalAlpha = alive || !riding() ? 1 : 0.35; g.lineWidth = cell * 0.45; g.lineJoin = g.lineCap = 'round';
        g.shadowColor = color; g.shadowBlur = cell * 1.5;
        g.beginPath();
        t.forEach((c, k) => { const x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell; k ? g.lineTo(x, y) : g.moveTo(x, y); });
        const pos = headPos(i, now);
        if (pos && alive) g.lineTo((pos[0] + 0.5) * cell, (pos[1] + 0.5) * cell);
        g.stroke();
        if (pos && alive) { g.fillStyle = '#fff'; g.fillRect((pos[0] + 0.15) * cell, (pos[1] + 0.15) * cell, cell * 0.7, cell * 0.7); }
        g.restore();
        ring2d(i, now);
      });
      drawRest(now);
    }
    // `color` darkened toward black by `by` (0 to 1)
    const darker = (color, by) => {
      const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1, 7);
      const v = parseInt(hex, 16);
      return Number.isNaN(v) ? color : `rgb(${[v >> 16, (v >> 8) & 255, v & 255].map((c) => Math.round(c * (1 - by))).join(',')})`;
    };
    function drawSnake2d(i, t, color, now) {
      const n = cols(), mid = (v) => (v + 0.5) * cell;
      const head = headPos(i, now), end = tailPos(i, now);
      const pts = [[mid(end[0]), mid(end[1])]];
      for (let k = 1; k < t.length; k++) pts.push([mid(t[k] % n), mid(Math.floor(t[k] / n))]);
      pts.push([mid(head[0]), mid(head[1])]);
      const last = pts.length - 1, first = (seq[i] ?? t.length) - t.length, count = curve(pts, 4);
      slither(count, first, last, cell);
      g.save(); g.lineJoin = g.lineCap = 'round';
      // short strokes along the rounded line so the body can taper: a dark rim all along first, then the banded skin
      // Neighbours that share a width (to the half pixel) and a shade (one of six) are drawn as one path: a
      // stroke for every sample took most of a frame with long snakes.
      const shades = [0, 1, 2, 3, 4, 5].map((k) => darker(color, 0.09 * k));
      const pass = (width, shaded) => {
        let open = false, wide = -1, shade = -1;
        for (let j = 1; j < count; j++) {
          const o = j * 3, at_ = (line[o + 2] + line[o - 1]) / 2;
          const w_ = Math.round(2 * cell * width * girth(at_, last - at_) * swell(i, last - at_, now)) / 2;
          const s_ = shaded ? Math.round(5 * band(first + at_)) : 0;
          if (!open || w_ !== wide || s_ !== shade) {
            if (open) g.stroke();
            wide = w_; shade = s_; open = true;
            g.lineWidth = wide; g.strokeStyle = shaded ? shades[shade] : '#000a';
            g.beginPath(); g.moveTo(line[o - 3], line[o - 2]);
          }
          g.lineTo(line[o], line[o + 1]);
        }
        if (open) g.stroke();
      };
      pass(1.28, false);
      pass(1.04, true);
      // diamonds down the back, every third cell, counted from the first cell the snake ever moved onto (#350)
      const mark = darker(color, 0.62);
      g.lineWidth = Math.max(1, cell * 0.09);
      for (let j = last - 2; j > 2; j--) {
        if ((first + j) % 3) continue;
        const [x, y] = pts[j], [px, py] = pts[j - 1], len = Math.hypot(x - px, y - py);
        if (!len) continue;
        const ux = (x - px) / len, uy = (y - py) / len, r = cell * girth(j, last - j) * swell(i, last - j, now);
        const off = weave(first + j, last - j) * cell;  // the mark rides the wave with the body
        const point_ = (along, across) => [x + ux * along * r - uy * (across * r + off), y + uy * along * r + ux * (across * r + off)];
        g.beginPath(); g.moveTo(...point_(0.72, 0)); g.lineTo(...point_(0, 0.36)); g.lineTo(...point_(-0.72, 0)); g.lineTo(...point_(0, -0.36)); g.closePath();
        g.fillStyle = mark; g.strokeStyle = '#ffffff8c'; g.fill(); g.stroke();
      }
      // the head, drawn facing right and turned to the heading
      g.translate(...pts[last]); g.rotate(facing(i, now) - (riding() && live[i]?.alive ? sway(first + last) : 0)); g.scale(cell, cell);
      const { open, gulp } = mouth(i, now);
      g.scale(gulp, gulp);
      const flick = (now + i * 530) % 1600;
      if (flick < 420 && open < 0.2 && live[i]?.alive) {
        const out = 1.2 + 0.7 * Math.abs(Math.sin((flick / 420) * Math.PI * 2));
        g.strokeStyle = '#ff3b5c'; g.lineWidth = 0.16;
        g.beginPath(); g.moveTo(0.9, 0); g.lineTo(out, 0); g.lineTo(out + 0.4, -0.3); g.moveTo(out, 0); g.lineTo(out + 0.4, 0.3); g.stroke();
      }
      g.beginPath(); g.moveTo(-0.5, -0.6);
      g.bezierCurveTo(0.35, -1.1, 0.8, -0.5, 1.2, -0.28); g.quadraticCurveTo(1.38, 0, 1.2, 0.28);
      g.bezierCurveTo(0.8, 0.5, 0.35, 1.1, -0.5, 0.6); g.closePath();
      g.fillStyle = color; g.strokeStyle = '#000a'; g.lineWidth = 0.14; g.fill(); g.stroke();
      if (open > 0.06) {  // the open mouth: a throat, then a fang at each side
        g.fillStyle = '#5c0a1c'; g.beginPath(); g.ellipse(1.28, 0, 0.62 * open, 0.2 + 0.46 * open, 0, 0, 6.283); g.fill();
        g.fillStyle = '#ff6f8c'; g.beginPath(); g.ellipse(1.22, 0, 0.32 * open, 0.1 + 0.22 * open, 0, 0, 6.283); g.fill();
        g.fillStyle = '#fff';
        for (const side of [-1, 1]) { const y_ = side * (0.14 + 0.38 * open); g.beginPath(); g.moveTo(1.15, y_); g.lineTo(1.2 + 0.75 * open, y_ - side * 0.1); g.lineTo(1.15, y_ - side * 0.22); g.closePath(); g.fill(); }
      }
      for (const side of [-1, 1]) {
        g.fillStyle = '#fff7c2'; g.beginPath(); g.arc(0.3, side * 0.44, 0.27, 0, 6.283); g.fill();
        g.fillStyle = '#05060f'; g.beginPath(); g.ellipse(0.38, side * 0.44, 0.18, 0.08, 0, 0, 6.283); g.fill();
        g.beginPath(); g.arc(1.05, side * 0.15, 0.07, 0, 6.283); g.fill();
      }
      g.restore();
    }
    function ring2d(i, now) {
      const pos = headPos(i, now), alive = live[i]?.alive;
      if (pos && alive && i === S.riders.me) {  // you: a pulsing ring, and an arrow during the countdown
        const cx = (pos[0] + 0.5) * cell, cy = (pos[1] + 0.5) * cell, counting = S.riders.stage === 'countdown';
        g.save(); g.strokeStyle = '#fff'; g.globalAlpha = 0.85; g.lineWidth = Math.max(2, cell * 0.2);
        g.beginPath(); g.arc(cx, cy, cell * ((counting ? 2.2 : 1.4) + 0.2 * Math.sin(now / 160)), 0, 6.283); g.stroke();
        if (counting) {
          const [dx, dy] = DIRS[headDir(i)], L = cell * (3 + 0.6 * Math.abs(Math.sin(now / 220)));
          g.lineWidth = cell * 0.5; g.lineCap = 'round';
          g.beginPath(); g.moveTo(cx + dx * cell * 1.5, cy + dy * cell * 1.5); g.lineTo(cx + dx * L, cy + dy * L);
          g.moveTo(cx + dx * L - dy * cell - dx * cell, cy + dy * L + dx * cell - dy * cell); g.lineTo(cx + dx * L, cy + dy * L);
          g.lineTo(cx + dx * L + dy * cell - dx * cell, cy + dy * L - dx * cell - dy * cell); g.stroke();
        }
        g.restore();
      }
    }
    function drawRest(now) {
      const n = cols();
      if (items.size) {  // 🎁 power-ups
        g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(cell * 1.5)}px sans-serif`;
        for (const [c, kind] of items) {
          const x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell, r = cell * (1.1 + 0.12 * Math.sin(now / 170 + c));
          g.fillStyle = ITEM[kind][1]; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, cell * 0.15);
          g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); g.stroke();
          g.fillText(ITEM[kind][0], x, y + cell * 0.08);
        }
        g.restore();
      }
      for (let k = glints.length - 1; k >= 0; k--) {
        const [x, y, born] = glints[k], age = Math.max(0, now - born) / 400;  // a frame's clock can trail performance.now()
        if (age > 1) { glints.splice(k, 1); continue; }
        g.fillStyle = `rgba(255,255,255,${1 - age})`; g.beginPath(); g.arc(x, y, cell * 0.25 * (1 + age), 0, 6.283); g.fill();
      }
      g.strokeStyle = isSnake() ? '#b98a52' : '#8ecae6'; g.lineWidth = isSnake() ? Math.max(4, cell * 0.5) : 3; g.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }
    function grind(i) {
      const pos = headPos(i, performance.now()); if (!pos) return;
      for (let k = 0; k < 3; k++) glints.push([(pos[0] + 0.5 + (Math.random() - 0.5)) * cell, (pos[1] + 0.5 + (Math.random() - 0.5)) * cell, performance.now()]);
    }
    resize();
    const grab = (i) => { for (let k = 0; k < 4; k++) grind(i); };
    // where board cell (x, y) is on screen, in the stage's own pixels (the canvas sits centred in the stage)
    const project = (x, y) => {
      const side = canvas.clientWidth / cols(), css = canvas.clientWidth / canvas.width;
      return [canvas.offsetLeft + (x + 0.5) * side * view.z + view.x * css, canvas.offsetTop + (y + 0.5) * side * view.z + view.y * css];
    };
    const unproject = (px, py) => {
      const side = canvas.clientWidth / cols(), css = canvas.clientWidth / canvas.width;
      return [(px - canvas.offsetLeft - view.x * css) / view.z / side - 0.5, (py - canvas.offsetTop - view.y * css) / view.z / side - 0.5];
    };
    return { sync() {}, reset: resize, resize, draw, grind, grab, project, unproject };
  }

  const turnText = (s) => (s.phase === 'playing' ? `${s.riders.mode === 'snake' ? '🐍' : '🏍️'} Round ${s.riders.round} — first to ${s.riders.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.riders.stage === 'ride' && s.riders.me != null && s.riders.alive[s.riders.me];

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
