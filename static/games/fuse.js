// Fuse Frenzy: the server runs the chase and streams positions over the fast channel (~30/s).
// This module draws the arena, smooths the runners between updates and sends where a finger (or key) points.
UI.fuse = (() => {
  let S, ctx, canvas, g2, raf = 0, ro = null, net = null, shown = [], keys = {}, keyDown = null, keyUp = null;
  let lastItems = [], lastShield = null, lastSent = 0, lastCarrier = -1, lastRound = 0, lastAlive = null, lastTickSec = -1, lastFrame = 0, flash = 0;
  const pfx = Fx2D.create({ cap: 160 });
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; net = null; shown = []; keys = {}; lastItems = []; lastShield = null; lastCarrier = -1; lastRound = 0; lastAlive = null; lastTickSec = -1;
    main.innerHTML = `<div class="fz"><div class="fz-stage" id="fzStage"><canvas id="fzCanvas"></canvas>
      <div class="fz-banner" id="fzBanner" hidden></div></div></div>`;
    side.innerHTML = `<div class="panel"><div id="fzSeats"></div>
      <button class="btn fz-dash" id="fzDash" type="button">⚡ Dash</button>
      <p class="hint left" id="fzHint">Drag to run (or WASD / arrows). Touching a rival with the bomb passes it on. Tap ⚡ Dash (or Space) for a burst.</p></div>`;
    canvas = $('fzCanvas');
    g2 = canvas.getContext('2d');
    if (!g2) { $('fzStage').append('Your browser cannot draw this game.'); return; }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture?.(e.pointerId); point(e); });
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' ? e.buttons : (e.buttons || e.pressure > 0)) point(e); });
    $('fzDash').addEventListener('click', dash);
    keyDown = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); dash(); return; }
      if (KEYS[e.code]) { keys[e.code] = true; e.preventDefault(); sendKeys(true); }
    };
    keyUp = (e) => { if (KEYS[e.code]) { delete keys[e.code]; sendKeys(true); } };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe($('fzStage'));
    resize();
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
  }

  const KEYS = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const mine = () => (S?.fuse?.me != null && S.fuse.me >= 0 ? S.fuse.me : null);
  const alive = (i) => (net ? net.a : S.fuse.a)[i];

  function sendKeys(force) {
    const f = S?.fuse, me = mine();
    if (!f || me == null || S.phase !== 'playing' || !alive(me)) return;
    let dx = 0, dy = 0;
    for (const k of Object.keys(keys)) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
    const now = performance.now();
    if (!force && now - lastSent < 33) return;
    const cur = shown[me] || (net || f).p[me];
    lastSent = now;
    ctx.input(dx || dy ? { x: +(cur[0] + dx * 0.5).toFixed(3), y: +(cur[1] + dy * 0.5).toFixed(3) } : { x: +cur[0].toFixed(3), y: +cur[1].toFixed(3) });
  }

  function dash() {
    const me = mine();
    if (me == null || S?.phase !== 'playing' || !alive(me)) return;
    ctx.input({ dash: true });
    ctx.sfx?.('whoosh');
  }

  function point(e) {
    const f = S?.fuse, me = mine();
    if (!f || me == null || S.phase !== 'playing' || !alive(me)) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * f.W, y = ((e.clientY - r.top) / r.height) * f.H;
    const now = performance.now();
    if (now - lastSent > 33) { lastSent = now; ctx.input({ x: +x.toFixed(3), y: +y.toFixed(3) }); }
    e.preventDefault?.();
  }

  function resize() {
    const stage = $('fzStage');
    if (!stage || !S?.fuse) return;
    const ratio = S.fuse.H / S.fuse.W;
    const width = Math.min(stage.clientWidth || 320, (window.innerHeight - (document.body.classList.contains('focus') ? 70 : 150)) / ratio, 520);
    Fx2D.fit(canvas, width, width * ratio);
  }

  const colorOf = (i) => ctx.player(S.fuse.seats[i])?.color ?? '#888';

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.fuse || !g2 || !canvas.width) return;
    const f = S.fuse, src = net || { ...f, at: now, im: [], dn: [] };
    const u = canvas.width / f.W, k = (i) => [src.p[i][0] * u, src.p[i][1] * u];
    sendKeys(false);
    for (let i = 0; i < src.p.length; i++) {   // ease each runner toward its server position
      shown[i] = shown[i] ? [shown[i][0] + (src.p[i][0] - shown[i][0]) * 0.4, shown[i][1] + (src.p[i][1] - shown[i][1]) * 0.4] : [...src.p[i]];
    }
    const left = Math.max(0, src.f - (now - src.at) / 1000), pause = src.pause ? src.pause - (now - src.at) / 1000 : 0;
    const hot = left < 3 && pause <= 0;

    g2.clearRect(0, 0, canvas.width, canvas.height);
    const bg = g2.createRadialGradient(canvas.width / 2, canvas.height / 2, u * 0.1, canvas.width / 2, canvas.height / 2, canvas.height * 0.75);
    bg.addColorStop(0, '#1d2a44'); bg.addColorStop(1, '#0b1222');
    g2.fillStyle = bg; g2.fillRect(0, 0, canvas.width, canvas.height);
    g2.strokeStyle = '#ffffff10'; g2.lineWidth = 1;   // floor tiles
    for (let x = 0; x <= canvas.width; x += u * 0.1) { g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, canvas.height); g2.stroke(); }
    for (let y = 0; y <= canvas.height; y += u * 0.1) { g2.beginPath(); g2.moveTo(0, y); g2.lineTo(canvas.width, y); g2.stroke(); }
    g2.save(); g2.strokeStyle = hot ? '#ff5d3a' : '#8ecae6'; g2.shadowColor = g2.strokeStyle; g2.shadowBlur = u * 0.04; g2.lineWidth = u * 0.016;
    g2.strokeRect(0, 0, canvas.width, canvas.height); g2.restore();
    if (flash > 0) { g2.fillStyle = `rgba(255,170,60,${flash})`; g2.fillRect(0, 0, canvas.width, canvas.height); flash = Math.max(0, flash - 0.04); }

    pfx.step((now - lastFrame) / 1000); lastFrame = now;
    pfx.begin(g2);
    const r = f.R * u;
    for (const [ix, iy, kind] of src.it || []) {   // 🎁 floor pickups: a glowing disc with the power's icon
      const sx = ix * u, sy = iy * u, pulse = 1 + 0.12 * Math.sin(now / 160);
      g2.save(); g2.shadowColor = kind === 'shield' ? '#6cecff' : '#ffd166'; g2.shadowBlur = r * 1.4;
      g2.fillStyle = kind === 'shield' ? '#12466a' : '#6a4a12'; g2.beginPath(); g2.arc(sx, sy, r * 0.8 * pulse, 0, 7); g2.fill();
      g2.lineWidth = r * 0.12; g2.strokeStyle = g2.shadowColor; g2.stroke(); g2.restore();
      g2.font = `${r * 1.0}px system-ui, "Noto Color Emoji", sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillText(kind === 'shield' ? '🛡️' : '⚡', sx, sy + r * 0.05);
    }
    src.p.forEach((_, i) => {
      if (!src.a[i]) return;
      const [sx, sy] = [shown[i][0] * u, shown[i][1] * u], isC = i === src.c, imm = (src.im?.[i] || 0) > 0;
      if (src.dn?.[i]) { g2.fillStyle = colorOf(i) + '55'; g2.beginPath(); g2.arc(sx, sy, r * 1.7, 0, 7); g2.fill(); }   // a dash glow
      g2.save(); g2.globalAlpha = imm ? 0.55 : 1;
      if (isC) { g2.shadowColor = '#ff7a2f'; g2.shadowBlur = r * (hot ? 2.2 + Math.sin(now / 60) : 1.4); }
      const grad = g2.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r);
      grad.addColorStop(0, '#ffffffcc'); grad.addColorStop(0.4, colorOf(i)); grad.addColorStop(1, '#00000066');
      g2.fillStyle = grad; g2.beginPath(); g2.arc(sx, sy, r, 0, 7); g2.fill();
      g2.lineWidth = r * (i === f.me ? 0.22 : 0.1); g2.strokeStyle = i === f.me ? '#fff' : '#0008'; g2.stroke();
      g2.restore();
      if (src.sh?.[i]) { g2.save(); g2.strokeStyle = '#6cecff'; g2.shadowColor = '#6cecff'; g2.shadowBlur = r; g2.lineWidth = r * 0.16; g2.globalAlpha = 0.8; g2.beginPath(); g2.arc(sx, sy, r * 1.45, 0, 7); g2.stroke(); g2.restore(); }
      if (src.bo?.[i]) { pfx.spark(sx, sy, 1, { color: '#ffd166', speed: [u * 0.03, u * 0.12], size: [u * 0.003, u * 0.007] }); }
      if (isC) { g2.font = `${r * 1.5}px system-ui, "Noto Color Emoji", sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('💣', sx, sy - r * 1.7); }
      if (imm) { g2.font = `${r * 0.9}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.fillText('🛡️', sx, sy - r * 1.6); }
    });
    pfx.draw(g2); pfx.end(g2);

    // the fuse, burning down along the top
    const frac = src.len ? left / src.len : 0, bw = canvas.width * 0.8, bx = canvas.width * 0.1, by = u * 0.035;
    g2.fillStyle = '#0007'; g2.fillRect(bx, by, bw, u * 0.022);
    g2.fillStyle = frac > 0.35 ? '#ffd166' : '#ff5d3a'; g2.fillRect(bx, by, bw * Math.min(1, frac), u * 0.022);
    if (frac > 0) { pfx.spark(bx + bw * Math.min(1, frac), by + u * 0.011, 1, { color: '#ffb703', speed: [u * 0.05, u * 0.2], size: [u * 0.003, u * 0.006] }); }

    const banner = $('fzBanner'), me = mine();
    banner.hidden = !(pause > 0 && S.phase === 'playing');
    banner.textContent = pause > 0.7 ? `Round ${src.rd}` : 'Run!';
    const btn = $('fzDash');
    if (btn) {
      const cd = Math.max(0, (src.dc?.[me ?? 0] || 0) - (now - src.at) / 1000);
      btn.disabled = me == null || !src.a[me] || cd > 0;
      btn.textContent = cd > 0 ? `⚡ Dash ${cd.toFixed(1)}` : '⚡ Dash';
      btn.hidden = me == null;
    }
    // the countdown ticks over the last 3 seconds
    const sec = Math.ceil(left);
    if (hot && sec !== lastTickSec && sec <= 3 && sec > 0) { ctx.sfx?.('tick'); ctx.buzz?.(10); }
    lastTickSec = hot ? sec : -1;
  }

  function fast(data) {
    const f = S?.fuse;
    if (f && canvas?.width) {
      const u = canvas.width, at = (i) => [(shown[i] || data.p[i])[0] * u, (shown[i] || data.p[i])[1] * u / 1];
      if (lastCarrier >= 0 && data.c !== lastCarrier && data.rd === lastRound) {   // the bomb changed hands
        const [x, y] = at(data.c);
        pfx.ring(x, y, { r0: u * 0.03, r1: u * 0.2, color: '#ffb703', width: u * 0.012, life: 0.4 });
        pfx.spark(x, y, 12, { color: '#ffd166', speed: [u * 0.1, u * 0.5], size: [u * 0.004, u * 0.01] });
        ctx.sfx?.('pop');
        if (data.c === f.me) { ctx.buzz?.([30, 30, 30]); if (typeof Kit !== 'undefined') Kit.callout('💣 You have the bomb! Tag someone!', 'bad', { ms: 1200 }); }
      }
      if (lastAlive) data.a.forEach((v, i) => {
        if (lastAlive[i] && !v) {   // someone blew up
          const [x, y] = at(i);
          pfx.ring(x, y, { r0: u * 0.03, r1: u * 0.55, color: '#ff7a2f', width: u * 0.03, life: 0.7 });
          pfx.spark(x, y, 36, { color: '#ffb703', speed: [u * 0.2, u * 1.1], size: [u * 0.006, u * 0.016] });
          flash = 0.45; ctx.sfx?.('boom'); ctx.buzz?.(i === f.me ? [120, 40, 160] : 40);
        }
      });
      for (const old of data.rd === lastRound ? lastItems : []) {   // a pickup that is gone was taken: sparks where it lay
        if (!(data.it || []).some((q) => q[0] === old[0] && q[1] === old[1])) {
          const x = old[0] * u, y = old[1] * u, col = old[2] === 'shield' ? '#6cecff' : '#ffd166';
          pfx.ring(x, y, { r0: u * 0.02, r1: u * 0.12, color: col, width: u * 0.01, life: 0.4 });
          pfx.spark(x, y, 10, { color: col, speed: [u * 0.1, u * 0.4], size: [u * 0.004, u * 0.009] });
          ctx.sfx?.('pop');
        }
      }
      if (lastShield) data.sh?.forEach((v, i) => {   // a shield used up: a flash round the runner
        if (lastShield[i] && !v && data.a[i]) {
          const [x, y] = at(i);
          pfx.ring(x, y, { r0: u * 0.04, r1: u * 0.2, color: '#6cecff', width: u * 0.014, life: 0.5 });
          ctx.sfx?.('tick');
        }
      });
      if (data.rd !== lastRound && lastRound) ctx.sfx?.('rise');
    }
    lastCarrier = data.c; lastRound = data.rd; lastAlive = [...data.a]; lastItems = (data.it || []).map((q) => [...q]); lastShield = [...(data.sh || [])];
    net = { ...data, at: performance.now() };
    renderSeats();
  }

  function renderSeats() {
    const f = S?.fuse, box = $('fzSeats'); if (!f || !box) return;
    const a = net ? net.a : f.a, c = net ? net.c : f.c;
    box.innerHTML = '';
    f.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row' + (a[i] ? '' : ' fz-out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#888';
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === f.me ? ' (you)' : ''}`), ctx.el('b', '', !a[i] ? '☠️' : i === c ? '💣' : '🏃'));
      box.append(row);
    });
  }

  function render(s, c) {
    const first = !S;
    S = s; ctx = c;
    if (first || !canvas.width) resize();
    if (!net) { lastItems = (s.fuse.it || []).map((q) => [...q]); lastShield = [...(s.fuse.sh || [])]; lastCarrier = s.fuse.c; lastRound = s.fuse.rd; lastAlive = [...s.fuse.a]; }
    renderSeats();
    $('fzHint').hidden = s.fuse.me == null || s.fuse.me < 0;
  }

  const turnText = (s) => (s.phase === 'playing' ? `💣 Round ${(net || s.fuse).rd} · ${(net ? net.a : s.fuse.a).filter(Boolean).length} left` : null);
  const myMove = (s) => s.phase === 'playing' && s.fuse.me != null && s.fuse.me >= 0;

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
