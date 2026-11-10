// Paint Blast: the server streams the whole (small) arena every tick; this module draws it on a 2D
// canvas, glides players between tiles, and sends held directions and bomb drops.
// Controls: swipe-and-hold on the arena (a quick tap drops a bomb), the pad, or arrows/WASD + Space.
UI.paintblast = (() => {
  let S, ctx, snap = null, canvas = null, g = null, raf = 0, ro = null, keyDown = null, keyUp = null;
  let glide = [], heldDir = -1, touch = null, countdownAt = 0, endsAt = 0;
  const ITEM = { b: '💣', r: '🔥', p: '🖌️', k: '👟' };
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; snap = null; glide = []; heldDir = -1; touch = null;
    main.innerHTML = `<div class="pb"><div class="pb-hud"><span id="pbRound"></span><b id="pbClock"></b><span id="pbMe"></span></div>
      <div class="pb-cover" id="pbCover" aria-label="Paint coverage"></div>
      <div class="pb-stage" id="pbStage"><canvas id="pbCanvas"></canvas><div class="lr-banner" id="pbBanner" hidden></div></div>
      <div class="pb-controls"><div class="pb-dpad" id="pbPad" role="group" aria-label="Move">
        <span data-d="0">▲</span><span data-d="3">◀</span><span data-d="1">▶</span><span data-d="2">▼</span></div>
        <button id="pbBomb" class="primary pb-bomb" aria-label="Drop a bomb">💣</button></div></div>`;
    side.innerHTML = `<div class="panel"><div id="pbScores"></div>
      <p class="hint left">Swipe and hold on the arena to run; tap it to drop a bomb. Or use the pad, or arrows / WASD and Space.</p></div>`;
    main.querySelector('.pb').style.touchAction = 'none';
    // the d-pad steers by where the thumb is from its centre, so sliding round it turns without lifting (#54)
    const pad = $('pbPad');
    let padId = null;
    const steer = (e) => {
      const r = pad.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.12) return;  // the centre is a dead zone: keep going the same way
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      if (d !== heldDir) hold(d);
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); padId = e.pointerId;
      try { pad.setPointerCapture(e.pointerId); } catch {}
      steer(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) steer(e); });
    for (const t of ['pointerup', 'pointercancel']) pad.addEventListener(t, (e) => { if (e.pointerId === padId) { padId = null; hold(-1); } });
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
    for (const x of $('pbPad')?.querySelectorAll('[data-d]') ?? []) x.classList.toggle('on', +x.dataset.d === d);
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

  // ---------- juice (#6): sounds, paint splatter, a shake for a blast close by, +10 when you catch someone
  let pfx = Fx2D.create({ cap: 400 }), lastFrame = 0;
  function events(prev, d, now) {
    const i = me(), n = S?.paintblast?.n;
    if (!n || prev?.rd !== d.rd) return;
    const cell = (canvas?.width || 0) / n;
    const sfx = (k) => ctx?.sfx?.(k);
    const had = (list, c) => list?.some((x) => x[0] === c);
    if (d.b.some(([c]) => !had(prev.b, c))) sfx('drop');
    const lit = d.f.filter(([c]) => !had(prev.f, c));
    if (lit.length) {
      sfx('boom');
      const mine = i != null ? d.p[i][0] : null;
      for (const [c, owner] of lit) {
        const x = ((c % n) + 0.5) * cell, y = (Math.floor(c / n) + 0.5) * cell;
        // paint splatter flying out of the blast, skidding to a stop
        pfx.splat(x, y, 4, { color: colorOf(owner), speed: [cell * 1.5, cell * 4.5], drag: 3, size: [cell * 0.06, cell * 0.14], life: [0.38, 0.68] });
        if (mine != null && Math.abs((mine % n) - (c % n)) + Math.abs(Math.floor(mine / n) - Math.floor(c / n)) <= 2) pfx.shake(0.12 * cell);
      }
    }
    if (i != null && d.p[i]?.[1] && !prev.p?.[i]?.[1]) { sfx('splash'); ctx?.buzz?.([60, 40, 60]); }  // I got splatted
    if (i != null) {
      const [pos] = d.p[i];
      if (prev.i?.some(([c]) => c === pos) && !d.i.some(([c]) => c === pos)) sfx('pickup');
      d.p.forEach((p, j) => {  // a rival caught in my blast
        if (j === i || !p[1] || prev.p[j]?.[1]) return;
        const fire = d.f.find(([c]) => c === prev.p[j][0] || c === p[0]);
        if (fire?.[1] !== i) return;
        sfx('tag');
        const c = prev.p[j][0];
        pfx.text(((c % n) + 0.5) * cell, (Math.floor(c / n) + 0.3) * cell, '+10', { kind: 'gold', size: cell * 0.6, rise: cell * 0.8 });
      });
    }
  }

  function take(d) {
    const now = performance.now();
    const i = me();
    if (snap && S) events(snap, d, now);
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
    const stage = $('pbStage');
    const size = Math.max(160, Math.min(stage.clientWidth || 320, stage.clientHeight || 320));
    Fx2D.fit(canvas, size, size);
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
    pfx.step((now - lastFrame) / 1000); lastFrame = now;
    g.setTransform(1, 0, 0, 1, 0, 0);
    pfx.begin(g);
    g.fillStyle = '#17121f'; g.fillRect(-W, -W, 3 * W, 3 * W);
    const paint = snap.c, gold = new Set(S.paintblast.gold || []);
    for (let c = 0; c < n * n; c++) {
      const x = (c % n) * cell, y = Math.floor(c / n) * cell, t = snap.t[c];
      if (t === '#') {  // a pillar: lit top, shaded sides, a dark foot
        g.fillStyle = '#4a4063'; g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        g.fillStyle = '#7a6d9c'; g.fillRect(x + 1, y + 1, cell - 2, cell * 0.26);
        g.fillStyle = '#5a4f78'; g.fillRect(x + 1, y + cell * 0.27, cell * 0.12, cell * 0.73);
        g.fillStyle = '#2f2745'; g.fillRect(x + 1, y + cell * 0.86, cell - 2, cell * 0.14);
        continue;
      }
      const owner = parseInt(paint.substr(c * 2, 2), 16);
      g.fillStyle = ((c % n) + Math.floor(c / n)) % 2 ? '#221b2f' : '#1e1829';
      g.fillRect(x, y, cell, cell);
      g.fillStyle = '#ffffff07'; g.fillRect(x, y, cell, 1.5);  // a hairline of light on each tile
      if (owner) {  // a splat, not a square: a blob with a few drops round it, the same shape every time
        g.fillStyle = colorOf(owner - 1); g.globalAlpha = 0.72;
        g.beginPath(); g.arc(x + cell / 2, y + cell / 2, cell * 0.5, 0, 7); g.fill();
        for (let k = 0; k < 3; k++) {
          const a = ((c * 7 + k * 13) % 12) * 0.52, rr = cell * (0.48 + ((c + k) % 3) * 0.05);
          g.beginPath(); g.arc(x + cell / 2 + Math.cos(a) * rr, y + cell / 2 + Math.sin(a) * rr, cell * (0.09 + ((c * k) % 3) * 0.03), 0, 7); g.fill();
        }
        g.globalAlpha = 1;
      }
      if (gold.has(c)) {  // ⭐ worth 3: a gold frame and star
        g.strokeStyle = '#ffd166'; g.lineWidth = Math.max(1.5, cell * 0.08); g.strokeRect(x + cell * 0.1, y + cell * 0.1, cell * 0.8, cell * 0.8);
        g.fillStyle = '#ffd166'; g.font = `${Math.round(cell * 0.4)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', x + cell / 2, y + cell / 2);
      }
      if (t === '+') {  // a crate: planks with a lit top edge, a frame and a brace
        g.fillStyle = '#a0703c'; g.fillRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);
        g.fillStyle = '#7c5428'; for (let k = 1; k < 4; k++) g.fillRect(x + cell * 0.08, y + cell * (0.08 + k * 0.21), cell * 0.84, Math.max(1, cell * 0.025));
        g.fillStyle = '#c99358'; g.fillRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, Math.max(1, cell * 0.05));
        g.strokeStyle = '#6e4a24'; g.lineWidth = Math.max(1, cell * 0.07);
        g.strokeRect(x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72);
        g.beginPath(); g.moveTo(x + cell * 0.14, y + cell * 0.14); g.lineTo(x + cell * 0.86, y + cell * 0.86); g.stroke();
      }
    }
    // where the bombs will blast: a faint red at first, pulsing harder as the fuse runs down (#6)
    for (const [c, f] of snap.w || []) {
      if (snap.t[c] === '#') continue;
      const soon = Math.max(0, 1 - f / 18);
      const x = (c % n) * cell, y = Math.floor(c / n) * cell, beat = 0.6 + 0.4 * Math.sin(now / 70);
      g.fillStyle = '#ff2d55';
      g.globalAlpha = soon ? 0.2 + 0.4 * soon * beat : 0.12;
      g.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      if (soon > 0.4) {  // under a second to go: a bright edge too
        g.globalAlpha = 0.5 + 0.5 * beat; g.strokeStyle = '#ff5a7a'; g.lineWidth = Math.max(1, cell * 0.06);
        g.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
      }
    }
    g.globalAlpha = 1;
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
      const glow = g.createRadialGradient(x, y, cell * 0.2, x, y, cell * 0.75 * pulse);  // the fuse light on the floor
      glow.addColorStop(0, fuse < 12 ? 'rgba(255,77,77,0.45)' : 'rgba(255,209,102,0.3)'); glow.addColorStop(1, 'rgba(255,160,80,0)');
      g.fillStyle = glow; g.fillRect(x - cell, y - cell, cell * 2, cell * 2);
      g.fillStyle = '#111'; g.beginPath(); g.arc(x, y, cell * 0.36 * pulse, 0, 7); g.fill();
      g.strokeStyle = colorOf(owner); g.lineWidth = cell * 0.1; g.stroke();
      g.fillStyle = fuse < 12 ? '#ff4d4d' : '#ffd166'; g.beginPath(); g.arc(x + cell * 0.22, y - cell * 0.26, cell * 0.09, 0, 7); g.fill();
    }
    snap.p.forEach(([pos, stun, shield], i) => {
      if (stun) return;
      const at = where(i, now, n); if (!at) return;
      if (shield && Math.floor(now / 120) % 2) return;  // blink while protected
      const x = (at[0] + 0.5) * cell, y = (at[1] + 0.5) * cell;
      const under = g.createRadialGradient(x, y + cell * 0.1, cell * 0.2, x, y + cell * 0.1, cell * 0.7);  // underglow in the player's colour
      under.addColorStop(0, colorOf(i) + '66'); under.addColorStop(1, colorOf(i) + '00');
      g.fillStyle = under; g.fillRect(x - cell, y - cell, cell * 2, cell * 2);
      g.fillStyle = colorOf(i); g.strokeStyle = i === S.paintblast.me ? '#fff' : '#000a'; g.lineWidth = cell * 0.09;
      g.beginPath(); g.arc(x, y, cell * 0.38, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - cell * 0.12, y - cell * 0.08, cell * 0.08, 0, 7); g.arc(x + cell * 0.12, y - cell * 0.08, cell * 0.08, 0, 7); g.fill();
    });
    pfx.draw(g); pfx.end(g);  // paint splatter and +10s
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  const turnText = (s) => (s.phase === 'playing' ? `🎨 Round ${s.paintblast.round} of ${s.paintblast.rounds}` : null);
  const myMove = (s) => s.phase === 'playing' && s.paintblast.st === 'play' && s.paintblast.me != null;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
