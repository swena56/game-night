// Fuse Frenzy: the server runs the chase and streams positions over the fast channel (~30/s).
// This module draws the arena, smooths the runners between updates and sends joystick or keyboard directions.
UI.fuse = (() => {
  let S, ctx, canvas, g2, raf = 0, ro = null, net = null, shown = [], keys = {}, keyDown = null, keyUp = null;
  let snapshotAt = 0;
  let lastItems = [], lastShield = null, lastCarrier = -1, lastRound = 0, lastAlive = null, lastTickSec = -1, lastFrame = 0, flash = 0;
  let drag = null, direction = '', steering = null, clearInput;
  const pfx = Fx2D.create({ cap: 160 });
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    S = null; net = null; shown = []; keys = {}; lastItems = []; lastShield = null; lastCarrier = -1; lastRound = 0; lastAlive = null; lastTickSec = -1;
    drag = null; direction = ''; steering = null; lastFrame = 0; flash = 0;
    main.innerHTML = `<div class="fz"><div class="fz-hud"><strong id="fzRole" aria-live="polite"></strong>
      <span id="fzClock" role="timer"></span></div><div class="fz-stage" id="fzStage"><canvas id="fzCanvas"></canvas>
      <div class="fz-banner" id="fzBanner" hidden></div></div>
      <div class="fz-deck"><div class="fz-pad" id="fzPad" aria-hidden="true">🕹️ Drag here to steer</div><button class="btn fz-dash" id="fzDash" type="button">⚡ Dash</button></div>
      <div class="fz-stick" id="fzStick" hidden><i></i></div></div>`;
    side.innerHTML = `<div class="panel"><div id="fzSeats"></div>
      <p class="hint left" id="fzHint">Drag to steer like a joystick. Lift to stop. Use Dash for a burst. Keyboard: WASD or arrows, Space to dash.</p></div>`;
    canvas = $('fzCanvas');
    g2 = canvas.getContext('2d');
    if (!g2) { $('fzStage').append('Your browser cannot draw this game.'); return; }
    canvas.style.touchAction = 'none';
    // (#253) the arena still steers, and so does the thumb pad under it, where your thumb hides nothing
    for (const surface of [canvas, $('fzPad')]) {
      surface.addEventListener('pointerdown', (e) => {
        if (drag || e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
        surface.setPointerCapture?.(e.pointerId);
        point(e);
      });
      surface.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) point(e); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        surface.addEventListener(event, (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          drag = null; $('fzStick').hidden = true; sendKeys();
        });
      }
    }
    clearInput = () => {
      drag = null; keys = {}; $('fzStick').hidden = true; sendKeys();
    };
    window.addEventListener('blur', clearInput);
    const dashButton = $('fzDash');
    dashButton.addEventListener('pointerdown', (e) => { if (e.button === 0 && !dashButton.disabled) dash(); });
    dashButton.addEventListener('click', (e) => { if (e.detail === 0) dash(); });
    keyDown = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.code === 'Space' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); if (!e.repeat) dash(); return; }
      if (KEYS[e.code]) { keys[e.code] = true; e.preventDefault(); if (!drag) sendKeys(); }
    };
    keyUp = (e) => { if (KEYS[e.code]) { delete keys[e.code]; if (!drag) sendKeys(); } };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe($('fzStage'));
    resize();
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect();
    window.removeEventListener('blur', clearInput);
    window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
  }

  const KEYS = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const mine = () => (S?.fuse?.me != null && S.fuse.me >= 0 ? S.fuse.me : null);
  const alive = (i) => (net ? net.a : S.fuse.a)[i];

  function sendKeys() {
    let dx = 0, dy = 0;
    for (const k of Object.keys(keys)) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
    steer(dx, dy);
  }

  function steer(dx, dy) {
    const me = mine();
    if (me == null || S.phase !== 'playing' || S.paused || !alive(me)) return;
    const length = Math.hypot(dx, dy) || 1;
    const data = { dx: +(dx / length).toFixed(2), dy: +(dy / length).toFixed(2) };
    const next = `${(net || S.fuse).rd}:${data.dx},${data.dy}`;
    if (next === direction) return;
    direction = next;
    steering = data;
    ctx.input(data);
  }

  function dash() {
    const me = mine();
    if (me == null || S?.phase !== 'playing' || S.paused || !alive(me) || $('fzDash').disabled) return;
    ctx.input({ ...steering, dash: true }, true);
    ctx.sfx?.('whoosh');
  }

  function point(e) {
    const stick = $('fzStick'), bounds = stick.parentElement.getBoundingClientRect();
    if (mine() == null || S.phase !== 'playing' || !alive(mine())) return;
    const reach = 28, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const length = Math.hypot(dx, dy), scale = Math.min(1, reach / (length || 1));
    drag.x += dx * (1 - scale); drag.y += dy * (1 - scale);
    stick.hidden = false;
    stick.style.left = `${drag.x - bounds.left}px`;
    stick.style.top = `${drag.y - bounds.top}px`;
    stick.firstElementChild.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    drag.dx = length < 4 ? 0 : dx; drag.dy = length < 4 ? 0 : dy;
    steer(drag.dx, drag.dy);
  }

  function resize() {
    const stage = $('fzStage');
    if (!stage || !S?.fuse) return;
    const ratio = S.fuse.H / S.fuse.W;
    const deck = matchMedia('(pointer: coarse)').matches ? 70 : 0;   // the thumb pad is taller than a lone Dash button
    const available = window.innerHeight - (document.body.classList.contains('focus') ? 176 : 232) - deck;
    const width = Math.min(stage.clientWidth || 320, Math.max(110, available / ratio), 520);
    Fx2D.fit(canvas, width, width * ratio);
    $('fzRole').parentElement.style.width = `${width}px`;
  }

  const colorOf = (i) => ctx.player(S.fuse.seats[i])?.color ?? '#888';

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.fuse || !g2 || !canvas.width) return;
    const f = S.fuse, src = net || { ...f, at: snapshotAt };
    const u = canvas.width / f.W;
    if (drag) steer(drag.dx, drag.dy);
    else if (Object.keys(keys).length) sendKeys();
    for (let i = 0; i < src.p.length; i++) {   // ease each runner toward its server position
      shown[i] = shown[i] ? [shown[i][0] + (src.p[i][0] - shown[i][0]) * 0.4, shown[i][1] + (src.p[i][1] - shown[i][1]) * 0.4] : [...src.p[i]];
    }
    const elapsed = S.paused || S.phase !== 'playing' ? 0 : Math.max(0, (now - src.at) / 1000);
    const left = Math.max(0, src.f - Math.max(0, elapsed - src.pause));
    const pause = Math.max(0, src.pause - elapsed);
    const hot = left <= 3 && pause === 0 && S.phase === 'playing';
    const edge = (src.edge || 0) * u;

    g2.clearRect(0, 0, canvas.width, canvas.height);
    const bg = g2.createRadialGradient(canvas.width / 2, canvas.height / 2, u * 0.1, canvas.width / 2, canvas.height / 2, canvas.height * 0.75);
    bg.addColorStop(0, '#1d2a44'); bg.addColorStop(1, '#0b1222');
    g2.fillStyle = bg; g2.fillRect(0, 0, canvas.width, canvas.height);
    g2.strokeStyle = '#ffffff10'; g2.lineWidth = 1;   // floor tiles
    for (let x = 0; x <= canvas.width; x += u * 0.1) { g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, canvas.height); g2.stroke(); }
    for (let y = 0; y <= canvas.height; y += u * 0.1) { g2.beginPath(); g2.moveTo(0, y); g2.lineTo(canvas.width, y); g2.stroke(); }
    g2.save(); g2.strokeStyle = hot ? '#ff5d3a' : '#8ecae6'; g2.shadowColor = g2.strokeStyle; g2.shadowBlur = u * 0.04; g2.lineWidth = u * 0.016;
    if (edge) {
      g2.fillStyle = '#090f1cbb';
      g2.beginPath();
      g2.rect(0, 0, canvas.width, canvas.height);
      g2.rect(edge, edge, canvas.width - 2 * edge, canvas.height - 2 * edge);
      g2.fill('evenodd');
    }
    g2.strokeRect(edge, edge, canvas.width - 2 * edge, canvas.height - 2 * edge); g2.restore();
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
      if (i === f.me) {   // (#253) which one is me, at a glance
        g2.save(); g2.font = `900 ${Math.max(11, r * 0.8)}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.lineWidth = Math.max(3, r * 0.22);
        const ly = sy + r * 1.75 > canvas.height - r * 0.5 ? sy - r * 2.7 : sy + r * 1.75;
        g2.strokeStyle = '#000c'; g2.strokeText('YOU', sx, ly); g2.fillStyle = '#fff'; g2.fillText('YOU', sx, ly); g2.restore();
      }
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
    const role = $('fzRole'), clock = $('fzClock');
    const hunting = me != null && src.a[me] && src.c === me;
    const roleText = S.phase !== 'playing' ? 'Match over' : S.paused ? 'Paused'
      : me == null || !src.a[me] ? 'Watching' : hunting ? '💣 Tag someone!' : '🏃 Dodge the bomb';
    if (role.textContent !== roleText) role.textContent = roleText;
    const clockText = S.phase === 'playing' ? `${left.toFixed(1)}s` : '';
    if (clock.textContent !== clockText) clock.textContent = clockText;
    clock.classList.toggle('fz-hot', hot);
    banner.hidden = !(pause > 0 && S.phase === 'playing');
    banner.textContent = pause > 0.7 ? `Round ${src.rd}` : 'Run!';
    const btn = $('fzDash');
    if (btn) {
      const cd = Math.max(0, (src.dc?.[me ?? 0] || 0) - elapsed);
      btn.disabled = S.phase !== 'playing' || S.paused || pause > 0 || left <= 0 || me == null || !src.a[me] || cd > 0;
      const label = cd > 0 ? `⚡ Dash ${cd.toFixed(1)}` : '⚡ Dash';
      if (btn.textContent !== label) btn.textContent = label;
      btn.hidden = me == null;
      $('fzPad').classList.toggle('fz-off', me == null || !src.a[me]);
    }
    // the countdown ticks over the last 3 seconds
    const sec = Math.ceil(left);
    if (hot && !S.paused && sec !== lastTickSec && sec > 0) { ctx.sfx?.('tick'); ctx.buzz?.(10); }
    lastTickSec = hot ? sec : -1;
  }

  function fast(data) {
    const f = S?.fuse;
    if (!f || S.paused || data.rd < f.rd) return;
    if (f && canvas?.width) {
      const u = canvas.width, at = (i) => [data.p[i][0] * u, data.p[i][1] * u];
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
      for (const old of data.rd === lastRound ? lastItems : []) {
        const edge = (data.edge || 0) + f.itemR;
        if (old[0] >= edge && old[0] <= f.W - edge && old[1] >= edge && old[1] <= f.H - edge
          && !(data.it || []).some((q) => q[0] === old[0] && q[1] === old[1])) {
          const x = old[0] * u, y = old[1] * u, col = old[2] === 'shield' ? '#6cecff' : '#ffd166';
          pfx.ring(x, y, { r0: u * 0.02, r1: u * 0.12, color: col, width: u * 0.01, life: 0.4 });
          pfx.spark(x, y, 10, { color: col, speed: [u * 0.1, u * 0.4], size: [u * 0.004, u * 0.009] });
          ctx.sfx?.('pop');
        }
      }
      if (lastShield && data.rd === lastRound) data.sh?.forEach((v, i) => {
        if (lastShield[i] && !v && data.a[i]) {
          const [x, y] = at(i);
          pfx.ring(x, y, { r0: u * 0.04, r1: u * 0.2, color: '#6cecff', width: u * 0.014, life: 0.5 });
          ctx.sfx?.('tick');
        }
      });
      if (data.rd !== lastRound && lastRound) {
        shown = [];
        ctx.sfx?.('rise');
      }
    }
    const seatsChanged = lastCarrier !== data.c || data.a.some((a, i) => a !== lastAlive?.[i]);
    lastCarrier = data.c; lastRound = data.rd; lastAlive = [...data.a]; lastItems = (data.it || []).map((q) => [...q]); lastShield = [...(data.sh || [])];
    net = { ...data, at: performance.now() };
    if (seatsChanged) renderSeats();
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
    const first = !S, resumed = S?.paused && !s.paused;
    if (s.paused || resumed || (net && s.fuse.rd > net.rd)) net = null;
    snapshotAt = performance.now();
    S = s; ctx = c;
    if (resumed) { direction = ''; clearInput?.(); }
    if (first || !canvas.width) resize();
    if (!net) { lastItems = (s.fuse.it || []).map((q) => [...q]); lastShield = [...(s.fuse.sh || [])]; lastCarrier = s.fuse.c; lastRound = s.fuse.rd; lastAlive = [...s.fuse.a]; }
    renderSeats();
    $('fzHint').hidden = s.fuse.me == null || s.fuse.me < 0;
  }

  const turnText = (s) => (s.phase === 'playing' ? `💣 Round ${(net || s.fuse).rd} · ${(net ? net.a : s.fuse.a).filter(Boolean).length} left` : null);
  const myMove = (s) => s.phase === 'playing' && Boolean((net || s.fuse).a[s.fuse.me]);

  return { mount, render, unmount, fast, turnText, myMove, focus: true };
})();
