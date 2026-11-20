// Star Guard: the server runs the sky (aliens, shots, power-ups) and streams snapshots ~20 times a second over
// the fast channel. This module draws the sky on a canvas, predicts the viewer's own ship so steering feels
// instant, and sends the finger's x position (~30/s). Drag to steer; the ship fires by itself.
UI.starguard = (() => {
  let S, ctx, canvas, g2, raf = 0, ro = null, net = null, stars = [];
  let own = null, target = null, lastSent = 0, shown = [], bossShown = null, keys = {}, keyHandler = null, keyUp = null;
  let lastLives = null, flash = 0, prevAl = [], hadBoss = false, lastSnap = null, lastFrame = 0;
  const fx = Fx2D.create({ cap: 260 }), KIND_COLOR = ['#7bd88f', '#ffb703', '#ef476f'];
  const SPEED = 1.1;  // must match SHIP_SPEED in games/starguard.py
  const $ = (id) => document.getElementById(id);
  const POWERS = { rapid: '⚡', spread: '🔱', shield: '🛡️', life: '❤️', bomb: '💣' };

  function mount(main, side) {
    S = null; net = null; own = null; target = null; shown = []; bossShown = null; keys = {}; lastLives = null; flash = 0; prevAl = []; hadBoss = false; lastSnap = null; fx.clear?.();
    main.innerHTML = `<div class="sg"><div class="sg-stage" id="sgStage"><canvas id="sgCanvas"></canvas></div></div>`;
    side.innerHTML = `<div class="panel"><div id="sgHud" class="sg-hud"></div><div id="sgCrew"></div>
      <button id="sgBomb" class="primary sg-bomb" type="button">💣 Bomb</button>
      <p class="hint left" id="sgHint">Drag to slide your ship (or use ← →). It fires on its own. Space or 💣 drops your bomb.</p></div>`;
    canvas = $('sgCanvas');
    g2 = canvas.getContext?.('2d');
    if (!g2) { $('sgStage').append('Your browser cannot draw this game.'); return; }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture?.(e.pointerId); point(e); });
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) point(e); });
    $('sgBomb').onclick = () => ctx?.quiet(ctx.act('bomb'));
    keyHandler = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = true;
      else if (e.key === 'ArrowRight' || e.key === 'd') keys.r = true;
      else if (e.key === ' ') { e.preventDefault(); ctx?.quiet(ctx.act('bomb')); }
      else return;
      e.preventDefault();
    };
    keyUp = (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = false; if (e.key === 'ArrowRight' || e.key === 'd') keys.r = false; };
    addEventListener('keydown', keyHandler); addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe($('sgStage'));
    resize();
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    removeEventListener('keydown', keyHandler); removeEventListener('keyup', keyUp);
  }

  function resize() {
    const stage = $('sgStage');
    if (!stage || !canvas || !S?.starguard) return;
    const h = S.starguard, ratio = h.H / h.W;
    const width = Math.min(stage.clientWidth || 320, (window.innerHeight - (document.body.classList.contains('focus') ? 70 : 150)) / ratio, 520);
    Fx2D.fit(canvas, width, width * ratio);
    stars = Array.from({ length: 50 }, () => [Math.random(), Math.random(), 0.4 + Math.random() * 1.2]);
  }

  function point(e) {
    const h = S?.starguard;
    if (!h || h.me == null || S.phase !== 'playing') return;
    const r = canvas.getBoundingClientRect();
    target = Math.min(h.W - 0.035, Math.max(0.035, ((e.clientX - r.left) / r.width) * h.W));
    const now = performance.now();
    if (now - lastSent > 33) { lastSent = now; ctx.input({ x: +target.toFixed(4) }); }
    e.preventDefault?.();
  }

  function fast(data) { net = { ...data, at: performance.now() }; }

  // ---------- drawing
  const colorOf = (i) => ctx?.player(S.starguard.seats[i])?.color || '#8ecae6';

  function ship(x, y, color, u, alpha = 1, shield = false, me = false) {
    g2.save(); g2.globalAlpha = alpha; g2.translate(x, y);
    g2.shadowColor = color; g2.shadowBlur = u * 0.04;
    g2.fillStyle = color; g2.beginPath();
    g2.moveTo(0, -u * 0.05); g2.lineTo(u * 0.04, u * 0.035); g2.lineTo(u * 0.014, u * 0.02); g2.lineTo(-u * 0.014, u * 0.02); g2.lineTo(-u * 0.04, u * 0.035); g2.closePath(); g2.fill();
    g2.fillStyle = '#fff'; g2.beginPath(); g2.arc(0, -u * 0.005, u * 0.012, 0, 7); g2.fill();
    if (me) { g2.strokeStyle = '#fff'; g2.lineWidth = u * 0.004; g2.beginPath(); g2.moveTo(-u * 0.025, u * 0.05); g2.lineTo(u * 0.025, u * 0.05); g2.stroke(); }
    if (shield) { g2.strokeStyle = '#7bdff2'; g2.lineWidth = u * 0.006; g2.beginPath(); g2.arc(0, 0, u * 0.06, 0, 7); g2.stroke(); }
    g2.restore();
  }

  function alien(x, y, kind, hp, u, t) {
    const c = ['#7bd88f', '#ffb703', '#ef476f'][kind], w = u * 0.036, wob = Math.sin(t * 6 + x * 30) * u * 0.004;
    g2.save(); g2.translate(x, y); g2.fillStyle = hp > 1 ? '#fff' : c; g2.shadowColor = c; g2.shadowBlur = u * 0.02;
    g2.beginPath(); g2.ellipse(0, 0, w, w * 0.62, 0, Math.PI, 0); g2.lineTo(w, w * 0.45 + wob); g2.lineTo(w * 0.4, w * 0.2); g2.lineTo(0, w * 0.5 - wob); g2.lineTo(-w * 0.4, w * 0.2); g2.lineTo(-w, w * 0.45 + wob); g2.closePath(); g2.fill();
    g2.fillStyle = '#10121c'; g2.beginPath(); g2.arc(-w * 0.35, -w * 0.1, w * 0.14, 0, 7); g2.arc(w * 0.35, -w * 0.1, w * 0.14, 0, 7); g2.fill();
    g2.restore();
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.starguard || !g2 || !canvas.width) return;
    const h = S.starguard, src = net || { ...h, at: now };
    const dt = Math.min(0.1, (now - src.at) / 1000), frameDt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    const u = canvas.width / h.W, t = now / 1000, X = (x) => x * u, Y = (y) => y * u;
    // my own ship: same speed cap as the server, gently corrected toward it
    if (h.me != null) {
      const srv = src.sh[h.me]?.[0] ?? 0.5;
      if (own == null) own = srv;
      if (keys.l || keys.r) { target = Math.min(h.W - 0.035, Math.max(0.035, (target ?? own) + (keys.r ? 1 : 0) * 0.04 - (keys.l ? 1 : 0) * 0.04)); if (now - lastSent > 33) { lastSent = now; ctx.input({ x: +target.toFixed(4) }); } }
      if (target != null) { const d = target - own; own += Math.sign(d) * Math.min(Math.abs(d), SPEED * frameDt); }
      own += (srv - own) * 0.08;
    }
    g2.clearRect(0, 0, canvas.width, canvas.height);
    fx.step(frameDt);
    fx.begin(g2);
    const bg = g2.createLinearGradient(0, 0, 0, canvas.height); bg.addColorStop(0, '#060a1c'); bg.addColorStop(1, '#14103a');
    g2.fillStyle = bg; g2.fillRect(0, 0, canvas.width, canvas.height);
    g2.fillStyle = '#ffffff';
    for (const [sx, sy, sp] of stars) { g2.globalAlpha = 0.25 + sp * 0.2; g2.fillRect(sx * canvas.width, ((sy + t * 0.02 * sp) % 1) * canvas.height, sp, sp); }
    g2.globalAlpha = 1;
    // the line the aliens must not cross
    g2.strokeStyle = '#ef476f33'; g2.setLineDash([u * 0.02, u * 0.02]); g2.beginPath(); g2.moveTo(0, Y(1.38)); g2.lineTo(canvas.width, Y(1.38)); g2.stroke(); g2.setLineDash([]);
    // aliens
    for (const a of src.al) alien(X(a[0]), Y(a[1]), a[3], a[2], u, t);
    // 💥 an alien that has vanished since the last snapshot burst where it was (nothing near it any more)
    if (src !== lastSnap) {
      for (const a of prevAl) if (!src.al.some((b) => Math.abs(b[0] - a[0]) < 0.15 && Math.abs(b[1] - a[1]) < 0.15)) {
        const c = KIND_COLOR[a[3]] || '#fff';
        fx.burst(X(a[0]), Y(a[1]), 12, { colors: [c, '#ffffff'], speed: [u * 0.12, u * 0.4], size: u * 0.012, life: [0.3, 0.7] });
        fx.ring(X(a[0]), Y(a[1]), { r0: u * 0.02, r1: u * 0.09, color: c, width: u * 0.006, life: 0.4 });
      }
      prevAl = src.al.map((a) => [a[0], a[1], a[2], a[3]]);
      if (hadBoss && !src.bo) {   // the boss goes down: a big blast
        fx.burst(X(bossShown?.[0] ?? 0.5), Y(bossShown?.[1] ?? 0.2), 40, { colors: ['#ffd166', '#ef476f', '#fff'], speed: [u * 0.15, u * 0.7], size: u * 0.016, life: [0.5, 1.1] });
        fx.shake(u * 0.03); fx.flash('#ffd166', 0.3, 400);
      }
      hadBoss = !!src.bo; lastSnap = src;
    }
    // boss
    if (src.bo) {
      bossShown = bossShown ? [bossShown[0] + (src.bo[0] - bossShown[0]) * 0.3, bossShown[1] + (src.bo[1] - bossShown[1]) * 0.3] : [src.bo[0], src.bo[1]];
      const bx = X(bossShown[0]), by = Y(bossShown[1]), w = u * 0.14;
      g2.save(); g2.translate(bx, by); g2.shadowColor = '#ef476f'; g2.shadowBlur = u * 0.06;
      g2.fillStyle = '#8e3b9b'; g2.beginPath(); g2.ellipse(0, 0, w, w * 0.55, 0, Math.PI, 0); g2.lineTo(w, w * 0.4); g2.lineTo(w * 0.5, w * 0.2); g2.lineTo(0, w * 0.45); g2.lineTo(-w * 0.5, w * 0.2); g2.lineTo(-w, w * 0.4); g2.closePath(); g2.fill();
      g2.fillStyle = '#ffd166'; g2.beginPath(); g2.arc(-w * 0.35, -w * 0.1, w * 0.12, 0, 7); g2.arc(w * 0.35, -w * 0.1, w * 0.12, 0, 7); g2.arc(0, -w * 0.25, w * 0.12, 0, 7); g2.fill(); g2.restore();
      g2.fillStyle = '#0006'; g2.fillRect(canvas.width * 0.15, u * 0.02, canvas.width * 0.7, u * 0.018);
      g2.fillStyle = '#ef476f'; g2.fillRect(canvas.width * 0.15, u * 0.02, canvas.width * 0.7 * Math.max(0, src.bo[2] / src.bo[3]), u * 0.018);
    } else bossShown = null;
    // power-ups and shots
    g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.font = `${u * 0.06}px system-ui, "Noto Color Emoji", sans-serif`;
    for (const p of src.pu) g2.fillText(POWERS[p[2]] || '✨', X(p[0]), Y(p[1]));
    g2.lineCap = 'round';
    for (const b of src.pb) { g2.strokeStyle = colorOf(b[2]); g2.lineWidth = u * 0.008; const y = Y(b[1] - 1.9 * dt); g2.beginPath(); g2.moveTo(X(b[0]), y); g2.lineTo(X(b[0]), y + u * 0.04); g2.stroke(); }
    g2.fillStyle = '#ff6b6b'; g2.shadowColor = '#ff6b6b'; g2.shadowBlur = u * 0.02;
    for (const b of src.eb) { g2.beginPath(); g2.arc(X(b[0]), Y(b[1] + 0.62 * dt), u * 0.012, 0, 7); g2.fill(); }
    g2.shadowBlur = 0;
    // ships
    src.sh.forEach((s, i) => {
      if (!s[1]) return;
      shown[i] = shown[i] == null ? s[0] : shown[i] + (s[0] - shown[i]) * 0.35;
      const x = i === h.me && own != null ? own : shown[i];
      ship(X(x), Y(h.shipY), colorOf(i), u, s[2] > 0 && Math.floor(t * 10) % 2 ? 0.45 : 1, !!s[3], i === h.me);
    });
    // lost-a-life flash
    if (lastLives != null && src.lv < lastLives) { flash = 1; ctx.sfx?.('groan'); fx.shake(u * 0.02); }
    lastLives = src.lv;
    if (flash > 0) { g2.fillStyle = `rgba(239,71,111,${flash * 0.3})`; g2.fillRect(0, 0, canvas.width, canvas.height); flash = Math.max(0, flash - 0.05); }
    fx.draw(g2); fx.end(g2);
    // HUD on the sky
    g2.textAlign = 'left'; g2.fillStyle = '#fff'; g2.font = `700 ${u * 0.05}px system-ui, sans-serif`;
    g2.fillText(`Wave ${src.wv}/${h.waves}`, u * 0.03, canvas.height - u * 0.035);
    g2.textAlign = 'right'; g2.fillText('❤️'.repeat(Math.min(src.lv, 8)) + (src.lv > 8 ? '+' : '') || '💀', canvas.width - u * 0.03, canvas.height - u * 0.035);
    if (src.st === 'intro') {
      g2.textAlign = 'center'; g2.fillStyle = '#ffd166'; g2.font = `800 ${u * 0.1}px system-ui, sans-serif`;
      g2.fillText(src.bo ? '👾 BOSS' : `Wave ${src.wv}`, canvas.width / 2, canvas.height * 0.42);
    }
    if (S.phase === 'over') { g2.fillStyle = '#0008'; g2.fillRect(0, 0, canvas.width, canvas.height); }
    updateSide(src);
  }

  let sideKey = '';
  function updateSide(src) {
    const h = S.starguard, key = JSON.stringify([src.sh.map((s) => [s[6], s[7], s[1]]), src.lv, src.wv]);
    if (key === sideKey) return;
    sideKey = key;
    const crew = $('sgCrew'); crew.innerHTML = '';
    src.sh.forEach((s, i) => {
      const p = ctx.player(h.seats[i]);
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === h.me ? ' (you)' : ''}${s[1] ? '' : ' 💥'}`), ctx.el('span', '', s[7] ? '💣'.repeat(Math.min(3, s[7])) : ''), ctx.el('b', '', String(s[6])));
      crew.append(row);
    });
    $('sgHud').textContent = `Wave ${src.wv} of ${h.waves} · ${src.lv} ${src.lv === 1 ? 'life' : 'lives'} shared`;
    const me = h.me != null ? src.sh[h.me] : null;
    if (me?.[8] >= 3) $('sgHud').textContent += ` · 🔥 ${me[8]} combo${me[8] >= 10 ? ` x${1 + Math.min(2, Math.floor(me[8] / 10))}` : ''}`;
    $('sgBomb').disabled = !me || !me[1] || !me[7] || S.phase !== 'playing';
  }

  function render(s, c) {
    const first = !S;
    S = s; ctx = c;
    if (first || !canvas.width) resize();
    sideKey = '';
    $('sgHint').hidden = s.starguard.me == null;
  }

  const turnText = (s) => (s.phase === 'playing' ? `🛸 Wave ${net?.wv ?? s.starguard.wv}/${s.starguard.waves} — ${net?.lv ?? s.starguard.lv} lives` : null);
  const myMove = (s) => s.phase === 'playing' && s.starguard.me != null;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
