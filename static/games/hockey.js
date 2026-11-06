// Air Hockey: the server runs the physics and streams positions over the fast channel (~30/s).
// This module draws the table from the viewer's side, predicts the viewer's own mallet so it feels
// instant, extrapolates the puck between updates, and sends finger positions (~30/s).
UI.hockey = (() => {
  let goalsKey = '', prevSc = null;
  let S, ctx, canvas, g2, table = null, raf = 0, ro = null;
  let net = null, me = null, own = null, target = null, oppShown = null, lastSent = 0, lastScore = '', flash = 0;
  let hist = [], replay = null;  // recent frames, and a goal replay being shown
  const trail = [];
  const SPEED = 4.0;  // must match MALLET_SPEED in games/hockey.py
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; net = null; own = null; target = null; oppShown = null; lastScore = ''; trail.length = 0; hist = []; replay = null;
    main.innerHTML = `<div class="hk"><div class="hk-stage" id="hkStage"><canvas id="hkCanvas"></canvas>
      <div class="hk-banner" id="hkBanner" hidden></div></div></div>`;
    side.innerHTML = `<div class="panel"><div id="hkScore" class="hk-score"></div>
      <p class="hint left" id="hkHint">Drag anywhere on your half to move your mallet. Bank shots off the side walls!</p></div>`;
    canvas = $('hkCanvas');
    g2 = canvas.getContext('2d');
    if (!g2) { $('hkStage').append('Your browser cannot draw this game.'); return; }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture?.(e.pointerId); point(e); });
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) point(e); });
    ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe($('hkStage'));
    resize();
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); ro?.disconnect(); }

  // ---------- coordinates: the table is W×H; seat 1 sees it rotated 180° so their goal is at the bottom
  const flip = () => S?.hockey?.me === 1;
  function toScreen(x, y) {
    const h = S.hockey, sx = canvas.width / h.W, sy = canvas.height / h.H;
    return flip() ? [(h.W - x) * sx, (h.H - y) * sy] : [x * sx, y * sy];
  }
  function clampMine(x, y) {
    const h = S.hockey, m = h.mallet;
    x = Math.min(h.W - m, Math.max(m, x));
    const [lo, hi] = h.me === 0 ? [h.H / 2 + m, h.H - m] : [m, h.H / 2 - m];
    return [x, Math.min(hi, Math.max(lo, y))];
  }

  function point(e) {
    const h = S?.hockey;
    if (!h || h.me == null || S.phase !== 'playing') return;
    const r = canvas.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * h.W, y = ((e.clientY - r.top) / r.height) * h.H;
    if (flip()) { x = h.W - x; y = h.H - y; }
    target = clampMine(x, y);
    const now = performance.now();
    if (now - lastSent > 33) { lastSent = now; ctx.input({ x: +target[0].toFixed(4), y: +target[1].toFixed(4) }); }
    e.preventDefault?.();
  }

  function resize() {
    const stage = $('hkStage');
    if (!stage || !S?.hockey) return;
    const h = S.hockey, ratio = h.H / h.W;
    const width = Math.min(stage.clientWidth || 320, (window.innerHeight - (document.body.classList.contains('focus') ? 70 : 150)) / ratio, 520);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${width}px`; canvas.style.height = `${width * ratio}px`;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(width * ratio * dpr);
    table = null;  // redraw the static table art at the new size
  }

  // ---------- static table art (cached on an offscreen canvas)
  function drawTable() {
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const t = c.getContext('2d'); if (!t) return null;
    const w = c.width, hgt = c.height, h = S.hockey, u = w / h.W;
    const bg = t.createLinearGradient(0, 0, w, hgt);
    bg.addColorStop(0, '#0d2a4a'); bg.addColorStop(1, '#081a30');
    t.fillStyle = bg; t.fillRect(0, 0, w, hgt);
    t.fillStyle = '#ffffff10';  // air holes
    const step = u * 0.05;
    for (let y = step / 2; y < hgt; y += step) for (let x = step / 2; x < w; x += step) { t.beginPath(); t.arc(x, y, u * 0.004, 0, 7); t.fill(); }
    const neon = (color, width, draw) => { t.save(); t.strokeStyle = color; t.lineWidth = width; t.shadowColor = color; t.shadowBlur = width * 4; t.beginPath(); draw(); t.stroke(); t.restore(); };
    neon('#ef476f', u * 0.008, () => { t.moveTo(0, hgt / 2); t.lineTo(w, hgt / 2); });
    neon('#ef476f', u * 0.008, () => t.arc(w / 2, hgt / 2, u * 0.16, 0, 7));
    for (const end of [0, hgt]) neon('#8ecae6', u * 0.007, () => t.arc(w / 2, end, u * 0.24, end ? Math.PI : 0, end ? 2 * Math.PI : Math.PI));
    neon('#8ecae6', u * 0.02, () => t.rect(0, 0, w, hgt));
    for (const [end, mine] of [[0, false], [hgt, true]]) {  // goals: mine at the bottom (each can widen for a leader)
      const seat = mine ? (h.me ?? 0) : 1 - (h.me ?? 0), gw = (h.goals?.[seat] ?? h.goal) * u;
      t.save(); t.fillStyle = mine ? '#06d6a0' : '#ffb703'; t.shadowColor = t.fillStyle; t.shadowBlur = u * 0.06;
      t.fillRect(w / 2 - gw / 2, end ? hgt - u * 0.018 : 0, gw, u * 0.018); t.restore();
    }
    return c;
  }

  // ---------- per-frame drawing
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.hockey || !g2 || !canvas.width) return;
    const h = S.hockey;
    const gk = String(S.hockey.goals);
    if (gk !== goalsKey) { goalsKey = gk; table = null; }  // a goal widened: redraw the table
    if (!table) table = drawTable();
    if (replay && drawReplay(now)) return;
    const src = net || { pk: h.pk, ml: h.ml, at: now, pause: 0 };
    const dt = Math.min(0.12, (now - src.at) / 1000);

    // my mallet: same speed cap as the server, gently corrected toward the server's position
    if (h.me != null) {
      const server = src.ml[h.me];
      if (!own) own = [...server];
      if (target) {
        const dx = target[0] - own[0], dy = target[1] - own[1], d = Math.hypot(dx, dy), stepLen = Math.min(d, SPEED / 60);
        if (d > 1e-6) { own[0] += (dx / d) * stepLen; own[1] += (dy / d) * stepLen; }
      }
      own[0] += (server[0] - own[0]) * 0.08; own[1] += (server[1] - own[1]) * 0.08;
    }
    const oppIdx = h.me === 0 ? 1 : 0, opp = src.ml[h.me == null ? 1 : oppIdx];
    oppShown = oppShown ? [oppShown[0] + (opp[0] - oppShown[0]) * 0.35, oppShown[1] + (opp[1] - oppShown[1]) * 0.35] : [...opp];

    g2.clearRect(0, 0, canvas.width, canvas.height);
    if (table) g2.drawImage(table, 0, 0);
    const u = canvas.width / h.W;
    for (const [i, pk] of src.pk.entries()) {
      let x = pk[0], y = pk[1];
      if (!src.pause) { x += pk[2] * dt; y += pk[3] * dt; }
      x = Math.min(h.W - h.puck, Math.max(h.puck, x));
      const [sx, sy] = toScreen(x, y);
      const tr = trail[i] || (trail[i] = []);
      tr.push([sx, sy]); if (tr.length > 8) tr.shift();
      tr.forEach(([tx, ty], k) => { g2.fillStyle = `rgba(255,255,255,${(k / tr.length) * 0.18})`; g2.beginPath(); g2.arc(tx, ty, h.puck * u * (k / tr.length), 0, 7); g2.fill(); });
      g2.save(); g2.shadowColor = '#fff'; g2.shadowBlur = u * 0.04;
      g2.fillStyle = '#111'; g2.beginPath(); g2.arc(sx, sy, h.puck * u, 0, 7); g2.fill();
      g2.lineWidth = u * 0.008; g2.strokeStyle = '#f3eefc'; g2.stroke(); g2.restore();
    }
    const drawMallet = (pos, color) => {
      const [sx, sy] = toScreen(pos[0], pos[1]), r = h.mallet * u;
      g2.save(); g2.shadowColor = color; g2.shadowBlur = r * 0.8;
      const grad = g2.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r);
      grad.addColorStop(0, '#ffffffcc'); grad.addColorStop(0.35, color); grad.addColorStop(1, '#00000066');
      g2.fillStyle = grad; g2.beginPath(); g2.arc(sx, sy, r, 0, 7); g2.fill();
      g2.shadowBlur = 0; g2.fillStyle = color; g2.strokeStyle = '#0006'; g2.lineWidth = r * 0.12;
      g2.beginPath(); g2.arc(sx, sy, r * 0.45, 0, 7); g2.fill(); g2.stroke(); g2.restore();
    };
    const colorOf = (i) => ctx.player(h.seats[i])?.color ?? '#888';
    drawMallet(oppShown, colorOf(h.me == null ? 1 : oppIdx));
    drawMallet(h.me != null ? own : src.ml[0], colorOf(h.me ?? 0));

    if (flash > now) {  // goal flash
      g2.fillStyle = `rgba(255,183,3,${((flash - now) / 600) * 0.35})`; g2.fillRect(0, 0, canvas.width, canvas.height);
    }
    const banner = $('hkBanner');
    const pause = src.pause ? src.pause - (now - src.at) / 1000 : 0;
    banner.hidden = !(pause > 0 && S.phase === 'playing');
    banner.textContent = pause > 0.6 ? 'Ready…' : 'Go!';
  }

  // ⏪ the last 1.4 s before a goal, at 60% speed, while the server pauses for the next serve
  function drawReplay(now) {
    const h = S.hockey, f = replay.frames, t = f[0].t + (now - replay.start) * 0.6;
    if (t > f.at(-1).t || !motionOK()) { replay = null; trail.length = 0; return false; }
    const frame = f.findLast((x) => x.t <= t) || f[0];
    g2.clearRect(0, 0, canvas.width, canvas.height);
    if (table) g2.drawImage(table, 0, 0);
    const u = canvas.width / h.W;
    for (const pk of frame.pk) {
      const [sx, sy] = toScreen(pk[0], pk[1]);
      g2.fillStyle = '#111'; g2.strokeStyle = '#ffd166'; g2.lineWidth = u * 0.01;
      g2.beginPath(); g2.arc(sx, sy, h.puck * u, 0, 7); g2.fill(); g2.stroke();
    }
    frame.ml.forEach((m, i) => {
      const [sx, sy] = toScreen(m[0], m[1]);
      g2.fillStyle = ctx.player(h.seats[i])?.color ?? '#888';
      g2.beginPath(); g2.arc(sx, sy, h.mallet * u, 0, 7); g2.fill();
    });
    g2.fillStyle = '#0008'; g2.fillRect(0, 0, canvas.width, canvas.height);  // dim it so it reads as a replay
    const banner = $('hkBanner');
    banner.hidden = false; banner.textContent = '⏪ Replay';
    return true;
  }

  function fast(data) {
    const h = S?.hockey;
    const sc0 = data.sc.join(':');
    if (lastScore && sc0 !== lastScore && hist.length > 4) {
      const now = performance.now();
      replay = { frames: hist.filter((x) => x.t >= now - 1400), start: now };
      if (replay.frames.length < 4) replay = null;
    }
    hist.push({ t: performance.now(), pk: data.pk, ml: data.ml });
    while (hist.length && hist[0].t < performance.now() - 1600) hist.shift();
    if (h && net?.pk) {
      // a mallet hit (a clack, louder for a harder hit; a buzz when it's mine) or a wall (a tick)
      data.pk.forEach(([x, y, vx, vy], k) => {
        const old = net.pk[k];
        if (!old) return;
        const jump = Math.hypot(vx - old[2], vy - old[3]);
        const near = data.ml.findIndex(([mx, my]) => Math.hypot(x - mx, y - my) < (h.mallet + h.puck) * 1.6);
        if (near >= 0 && jump > 0.8) { ctx.sfx('puck', Math.min(1, jump / 4)); if (near === h.me) buzz(25); }
        else if ((Math.sign(vx) !== Math.sign(old[2]) && Math.abs(old[2]) > 0.3) || (Math.sign(vy) !== Math.sign(old[3]) && Math.abs(old[3]) > 0.3)) ctx.sfx('rail');
      });
    }
    net = { ...data, at: performance.now() };
    const sc = data.sc.join(':');
    if (lastScore && sc !== lastScore) {
      flash = performance.now() + 600; buzz(120);
      // the goal horn, and a cheer when it's mine
      const was = lastScore.split(':').map(Number), scorer = data.sc.findIndex((v, i) => v > was[i]);
      // a cheer for the scorer, a groan for the one scored on; watchers get the neutral horn
      ctx.sfx(h?.me == null || h.me < 0 ? 'alarm' : scorer === h.me ? 'cheer' : 'groan');
      if (h && Math.max(...data.sc) === h.target - 1 && Math.max(...was) < h.target - 1) setTimeout(() => Kit.callout('🔥 Match point', 'gold', { ms: 1400 }), 900);
    }
    lastScore = sc;
    renderScore(data.sc);
  }

  function renderScore(sc) {
    const h = S.hockey, box = $('hkScore'); if (!box) return;
    box.innerHTML = '';
    const order = h.me === 1 ? [1, 0] : [0, 1];
    for (const i of order) {
      const p = ctx.player(h.seats[i]);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
      // a new goal slams the scorer's number in
      const slam = prevSc && sc[i] > prevSc[i];
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === h.me ? ' (you)' : ''}`), ctx.el('b', 'hk-num' + (slam ? ' slam' : ''), String(sc[i])));
      box.append(row);
    }
    prevSc = [...sc];
    if (h.goals && h.goals[0] !== h.goals[1] && h.goal) {
      const lead = h.goals[0] > h.goals[1] ? 0 : 1;
      box.append(ctx.el('p', 'hint left', `🥅 ${lead === h.me ? 'Your' : `${ctx.player(h.seats[lead])?.name ?? '?'}'s`} goal is ${Math.round((h.goals[lead] / h.goal - 1) * 100)}% wider.`));
    }
    const hot = Math.max(...sc) >= h.target - 1 && Math.max(...sc) < h.target;
    box.append(ctx.el('p', 'hint left' + (hot ? ' hk-hot' : ''), hot ? `🔥 Match point: the puck is faster! First to ${h.target}.` : `First to ${h.target}.`));
  }

  function render(s, c) {
    const first = !S;
    S = s; ctx = c;
    if (first || !canvas.width) resize();
    if (!net) lastScore = s.hockey.score.join(':');
    renderScore(net ? net.sc : s.hockey.score);
    $('hkHint').hidden = s.hockey.me == null;
  }

  const turnText = (s) => (s.phase === 'playing' ? `🏒 ${s.hockey.score.join(' : ')} — first to ${s.hockey.target}` : null);
  const myMove = (s) => s.phase === 'playing' && s.hockey.me != null;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
