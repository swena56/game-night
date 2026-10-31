// Paint Blast: the server streams the whole (small) arena every tick; this module draws it on a 2D
// canvas, glides players between tiles, and sends held directions and bomb drops.
// Controls: swipe-and-hold on the arena (a quick tap drops a bomb), the pad, or arrows/WASD + Space.
UI.paintblast = (() => {
  let S, ctx, snap = null, canvas = null, g = null, raf = 0, ro = null, keyDown = null, keyUp = null;
  let glide = [], heldDir = -1, touch = null, countdownAt = 0, endsAt = 0;
  const ITEM = { b: '💣', r: '🔥', p: '🪣', k: '👟' };
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; snap = null; glide = []; heldDir = -1; touch = null;
    main.innerHTML = `<div class="pb"><div class="pb-hud"><span id="pbRound"></span><b id="pbClock"></b><span id="pbMe"></span></div>
      <div class="pb-cover" id="pbCover" aria-label="Paint coverage"></div>
      <div class="pb-stage" id="pbStage"><canvas id="pbCanvas"></canvas><div class="lr-banner" id="pbBanner" hidden></div></div>
      <div class="lr-pad pb-pad" id="pbPad">
        <span></span><button data-d="0">▲</button><span></span>
        <button data-d="3">◀</button><button id="pbBomb" class="primary">💣</button><button data-d="1">▶</button>
        <span></span><button data-d="2">▼</button><span></span></div></div>`;
    side.innerHTML = `<div class="panel"><div id="pbScores"></div>
      <p class="hint left">Swipe and hold on the arena to run; tap it to drop a bomb. Or use the pad, or arrows / WASD and Space.</p></div>`;
    main.querySelector('.pb').style.touchAction = 'none';
    for (const b of $('pbPad').querySelectorAll('button[data-d]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); hold(+b.dataset.d); });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, () => { if (heldDir === +b.dataset.d) hold(-1); });
    }
    $('pbBomb').addEventListener('pointerdown', (e) => { e.preventDefault(); bomb(); });
    const stage = $('pbStage');
    stage.addEventListener('pointerdown', (e) => {
      touch = { x: e.clientX, y: e.clientY, moved: false };
      try { stage.setPointerCapture(e.pointerId); } catch {}
    });
    stage.addEventListener('pointermove', (e) => {
      if (!touch) return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      if (Math.hypot(dx, dy) < 18) return;
      touch.moved = true;
      hold(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      touch.x = e.clientX - Math.sign(dx) * 9; touch.y = e.clientY - Math.sign(dy) * 9;  // stay responsive to a change of direction
    });
    const release = () => { if (!touch) return; if (touch.moved) hold(-1); else bomb(); touch = null; };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', () => { touch = null; hold(-1); });
    const KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
    keyDown = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      const k = KEYS[e.code];
      if (k != null) { e.preventDefault(); if (!e.repeat) hold(k); } else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) bomb(); }
    };
    keyUp = (e) => { if (KEYS[e.code] != null && KEYS[e.code] === heldDir) hold(-1); };
    addEventListener('keydown', keyDown);
    addEventListener('keyup', keyUp);
    canvas = $('pbCanvas');
    g = canvas.getContext?.('2d') || null;
    if (!g) stage.append('Your browser cannot draw this game.');
    ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe(stage);
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp);
  }

  const me = () => S?.paintblast?.me;
  const playing = () => me() != null && S.phase === 'playing';
  function hold(d) {
    if (!playing() || d === heldDir) return;
    heldDir = d;
    ctx.input({ dir: d }, true);
  }
  function bomb() { if (playing()) ctx.input({ bomb: true }, true); }
  const colorOf = (i) => ctx.player(S.paintblast.seats[i])?.color ?? '#888';

  // ---------- state: full views and fast updates carry the same snapshot
  function render(s, c) {
    S = s; ctx = c;
    take(s.paintblast);
    countdownAt = performance.now() + s.paintblast.countdown * 1000;
    renderSide();
  }

  function fast(data) {
    if (!S?.paintblast) return;
    if (data.rd !== S.paintblast.round) return;  // a new round arrives with a full view
    take(data);
    renderSide();
  }

  function take(d) {
    const now = performance.now();
    const i = me();
    if (i != null && snap?.rd === d.rd && d.p[i]?.[1] && !snap.p?.[i]?.[1]) buzz([60, 40, 120]);  // I was just caught
    d.p.forEach(([pos], i) => {
      const gl = glide[i];
      if (!gl || snap?.rd !== d.rd) glide[i] = { from: pos, to: pos, at: 0 };
      else if (gl.to !== pos) glide[i] = { from: gl.to, to: pos, at: now };
    });
    snap = { ...d };
    if (d.left != null) endsAt = now + d.left * 1000;
    if (S) Object.assign(S.paintblast, d);
  }

  function renderSide() {
    const r = S.paintblast, box = $('pbScores'); if (!box || !snap) return;
    box.innerHTML = '';
    box.append(ctx.el('div', 'hint left', `Round ${r.round} of ${r.rounds} · total so far`));
    const rows = r.seats.map((pid, i) => [i, r.total[i] + (snap.st === 'play' ? snap.p[i][6] : 0)]).sort((a, b) => b[1] - a[1]);
    for (const [i, pts] of rows) {
      const p = ctx.player(r.seats[i]);
      const row = ctx.el('div', 'seat-row lr-row' + (snap.p[i][1] ? ' out' : ''));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colorOf(i);
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}${snap.p[i][1] ? ' 💫' : ''}`), ctx.el('b', '', String(pts)));
      box.append(row);
    }
    $('pbRound').textContent = `🎨 Round ${r.round}/${r.rounds}`;
    paintCover();
    const mine = r.me != null ? snap.p[r.me] : null;
    $('pbMe').textContent = mine ? `💣${mine[4]} 🔥${mine[5]}${mine[7] ? ' 👟' : ''} · ${mine[6]} pts` : 'Watching';
    $('pbPad').hidden = r.me == null;
    $('pbBomb').disabled = !mine || !!mine[1] || snap.st !== 'play';
  }

  // one bar under the clock: each colour's share of the open floor, biggest first
  function paintCover() {
    const bar = $('pbCover'); if (!bar || !snap.c || !snap.t) return;
    const counts = new Array(S.paintblast.seats.length).fill(0);
    let floor = 0;
    for (let c = 0; c < snap.t.length; c++) {
      if (snap.t[c] !== '.') continue;
      floor++;
      const owner = parseInt(snap.c.substr(c * 2, 2), 16);
      if (owner) counts[owner - 1]++;
    }
    bar.innerHTML = '';
    if (!floor) return;
    counts.map((n, i) => [n, i]).filter(([n]) => n).sort((a, b) => b[0] - a[0]).forEach(([n, i]) => {
      const seg = ctx.el('span', i === S.paintblast.me ? 'me' : '');
      seg.style.width = `${(100 * n) / floor}%`;
      seg.style.background = colorOf(i);
      seg.title = `${ctx.player(S.paintblast.seats[i])?.name ?? '?'}: ${Math.round((100 * n) / floor)}%`;
      bar.append(seg);
    });
  }

  function resize() {
    if (!canvas || !g) return;
    const stage = $('pbStage'), dpr = Math.min(devicePixelRatio || 1, 2);
    const size = Math.max(160, Math.min(stage.clientWidth || 320, stage.clientHeight || 320));
    canvas.style.width = canvas.style.height = `${size}px`;
    canvas.width = canvas.height = Math.round(size * dpr);
  }

  // where player i is drawn: gliding from the previous tile for one step's time
  function where(i, now, n) {
    const gl = glide[i]; if (!gl) return null;
    const stepMs = (1000 * S.paintblast.move) / S.paintblast.tick;
    const f = gl.at ? Math.min(1, (now - gl.at) / stepMs) : 1;
    const fx = gl.from % n, fy = Math.floor(gl.from / n), tx = gl.to % n, ty = Math.floor(gl.to / n);
    if (Math.abs(fx - tx) + Math.abs(fy - ty) > 1) return [tx, ty];  // respawned: jump home
    return [fx + (tx - fx) * f, fy + (ty - fy) * f];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!snap || !S?.paintblast) return;
    const r = S.paintblast;
    const left = snap.st === 'play' ? Math.max(0, (endsAt - now) / 1000) : null;
    $('pbClock').textContent = left == null ? '' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    $('pbClock').classList.toggle('hurry', left != null && left < 10);
    const cd = (countdownAt - now) / 1000, mine = r.me != null ? snap.p[r.me] : null;
    let text = '';
    if (S.phase === 'playing' && snap.st === 'countdown') text = cd > 0 ? String(Math.ceil(cd)) : 'GO!';
    else if (S.phase === 'playing' && snap.st === 'over') text = 'Time!';
    else if (S.phase === 'playing' && mine?.[1]) text = `💫 Back in ${Math.ceil(mine[1] / r.tick)}`;
    $('pbBanner').hidden = !text; $('pbBanner').textContent = text;
    if (g) draw(now);
  }

  function draw(now) {
    const n = S.paintblast.n;
    if (!canvas.width) resize();
    const W = canvas.width, cell = W / n;
    g.fillStyle = '#17121f'; g.fillRect(0, 0, W, W);
    const paint = snap.c;
    for (let c = 0; c < n * n; c++) {
      const x = (c % n) * cell, y = Math.floor(c / n) * cell, t = snap.t[c];
      if (t === '#') {
        g.fillStyle = '#4a4063'; g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        g.fillStyle = '#6b5f8a'; g.fillRect(x + 1, y + 1, cell - 2, cell * 0.28);
        continue;
      }
      const owner = parseInt(paint.substr(c * 2, 2), 16);
      g.fillStyle = owner ? colorOf(owner - 1) : (((c % n) + Math.floor(c / n)) % 2 ? '#221b2f' : '#1e1829');
      g.globalAlpha = owner ? 0.6 : 1;
      g.fillRect(x, y, cell, cell);
      g.globalAlpha = 1;
      if (t === '+') {
        g.fillStyle = '#a0703c'; g.fillRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);
        g.strokeStyle = '#6e4a24'; g.lineWidth = Math.max(1, cell * 0.07);
        g.strokeRect(x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72);
        g.beginPath(); g.moveTo(x + cell * 0.14, y + cell * 0.14); g.lineTo(x + cell * 0.86, y + cell * 0.86); g.stroke();
      }
    }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(cell * 0.62)}px system-ui, sans-serif`;
    for (const [c, kind] of snap.i) g.fillText(ITEM[kind] || '?', (c % n + 0.5) * cell, (Math.floor(c / n) + 0.55) * cell);
    for (const [c, owner] of snap.f) {
      g.fillStyle = colorOf(owner); g.globalAlpha = 0.9;
      g.fillRect((c % n) * cell + 1, Math.floor(c / n) * cell + 1, cell - 2, cell - 2);
      g.fillStyle = '#fff'; g.globalAlpha = 0.55;
      g.fillRect((c % n + 0.25) * cell, (Math.floor(c / n) + 0.25) * cell, cell * 0.5, cell * 0.5);
      g.globalAlpha = 1;
    }
    for (const [c, fuse, owner] of snap.b) {
      const x = (c % n + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell;
      const pulse = 1 + 0.08 * Math.sin(now / (fuse < 12 ? 40 : 120));
      g.fillStyle = '#111'; g.beginPath(); g.arc(x, y, cell * 0.36 * pulse, 0, 7); g.fill();
      g.strokeStyle = colorOf(owner); g.lineWidth = cell * 0.1; g.stroke();
      g.fillStyle = fuse < 12 ? '#ff4d4d' : '#ffd166'; g.beginPath(); g.arc(x + cell * 0.22, y - cell * 0.26, cell * 0.09, 0, 7); g.fill();
    }
    snap.p.forEach(([pos, stun, shield], i) => {
      if (stun) return;
      const at = where(i, now, n); if (!at) return;
      if (shield && Math.floor(now / 120) % 2) return;  // blink while protected
      const x = (at[0] + 0.5) * cell, y = (at[1] + 0.5) * cell;
      g.fillStyle = colorOf(i); g.strokeStyle = i === S.paintblast.me ? '#fff' : '#000a'; g.lineWidth = cell * 0.09;
      g.beginPath(); g.arc(x, y, cell * 0.38, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - cell * 0.12, y - cell * 0.08, cell * 0.08, 0, 7); g.arc(x + cell * 0.12, y - cell * 0.08, cell * 0.08, 0, 7); g.fill();
    });
  }

  const turnText = (s) => (s.phase === 'playing' ? `🎨 Round ${s.paintblast.round} of ${s.paintblast.rounds}` : null);
  const myMove = (s) => s.phase === 'playing' && s.paintblast.st === 'play' && s.paintblast.me != null;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
