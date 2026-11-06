// Cannon Hills: a side-on range of hills on a 2D canvas. Every shot's path comes from the server and plays
// back on every phone, blast by blast (craters, drops, damage numbers). To aim, drag anywhere on the range
// (slingshot: the shell goes the opposite way to your drag, further = harder) or use ◀ ▶ and − +; pick a
// shell and 🔥 Fire. Your last shot's path stays as a dashed line so you can adjust for the wind.
UI.cannon = (() => {
  let S, ctx, cv = null, g2 = null, raf = 0, ro = null, onKey = null;
  let anim = null, queue = [], seenShot = 0, primed = false, fx = [], shake = 0;
  let aim = { angle: 45, power: 0.6, shell: 'shell', set: false }, drag = null, hold = null, roundKey = '';
  const $ = (id) => document.getElementById(id);
  const THEMES = {
    rolling: { sky: ['#5fa8e6', '#bfe3ff'], earth: ['#7a5232', '#4e321d'], top: '#4caf50', sea: '#2f6fb3' },
    mountains: { sky: ['#3b2a5a', '#f2a65a'], earth: ['#6b6370', '#3d3842'], top: '#e8e8f0', sea: '#2a4f7a' },
    islands: { sky: ['#4cc3e0', '#e4f8ff'], earth: ['#c8a165', '#8a6a3a'], top: '#5fbf5a', sea: '#1d8fb8' },
  };

  // -- sound: a thump to fire, a crump for a blast; through the app's output (volume, softening)
  let actx = null;
  const quiet = () => typeof prefs !== 'undefined' && (!prefs.sound || prefs.moves === false);
  function dest() {
    if (typeof out === 'function') { const o = out(); actx = audio; return o; }
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    return actx.destination;
  }
  function noise(len, freq, vol) {
    if (quiet()) return;
    try {
      const to = dest();
      const n = Math.floor(actx.sampleRate * len), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.5;
      const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
      src.connect(f).connect(g).connect(to); src.start();
    } catch {}
  }
  function thump() {
    noise(0.18, 500, 0.5);
    if (quiet()) return;
    try {
      const to = dest(), o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(to); o.start(t); o.stop(t + 0.22);
    } catch {}
  }
  const crump = (r) => noise(0.35 + r / 60, 380 + r * 12, 0.45 + r / 80);

  // -- set-up

  function mount(main, side) {
    anim = null; queue = []; seenShot = 0; primed = false; fx = []; shake = 0; drag = null; roundKey = '';
    aim = { angle: 45, power: 0.6, shell: 'shell', set: false };
    main.innerHTML = `<div class="cn"><div class="cn-hud"><span id="cnRound"></span><span id="cnTurn"></span></div>
      <div class="cn-stage" id="cnStage"><canvas id="cnCanvas" aria-label="The range: hills and cannons"></canvas>
        <div class="cn-done" id="cnDone" hidden><h3 id="cnDoneTitle"></h3><div id="cnStand" hidden></div></div></div>
      <div class="cn-ctl" id="cnCtl">
        <div class="cn-dial"><button data-k="a+" aria-label="Aim further left">◀</button><b id="cnAng"></b><button data-k="a-" aria-label="Aim further right">▶</button></div>
        <div class="cn-dial"><button data-k="p-" aria-label="Less power">−</button><b id="cnPow"></b><button data-k="p+" aria-label="More power">＋</button></div>
        <button id="cnFire" class="primary cn-fire">🔥 Fire</button>
      </div>
      <div class="cn-shells" id="cnShells"></div>
      <p id="cnHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Cannons</h3><div id="cnScores"></div></div>';
    cv = $('cnCanvas');
    g2 = cv.getContext?.('2d') || null;
    const stage = $('cnStage');
    stage.style.touchAction = 'none';
    // drag anywhere on the range to aim: the shell flies the opposite way to the drag
    stage.addEventListener('pointerdown', (e) => {
      if (!canAim()) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      drag = { x0: e.clientX, y0: e.clientY, id: e.pointerId };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const sx = drag.x0 - e.clientX, sy = e.clientY - drag.y0;  // up the screen is up the range
      const len = Math.hypot(sx, sy);
      if (len < 8) return;
      let a = (Math.atan2(sy, sx) * 180) / Math.PI;
      if (a < 0) a = a < -90 ? 180 : 0;
      aim.angle = Math.round(a);
      aim.power = Math.min(1, Math.max(0.05, len / Math.max(90, (stage.clientWidth || 320) * 0.32)));
      aim.set = true;
      showAim();
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // ◀ ▶ − +: a tap nudges, holding keeps going
    const nudge = (k) => {
      if (k === 'a+') aim.angle = Math.min(180, aim.angle + 1);
      else if (k === 'a-') aim.angle = Math.max(0, aim.angle - 1);
      else if (k === 'p+') aim.power = Math.min(1, Math.round(aim.power * 100 + 1) / 100);
      else if (k === 'p-') aim.power = Math.max(0.05, Math.round(aim.power * 100 - 1) / 100);
      aim.set = true;
      showAim();
    };
    const stop = () => { if (hold) { clearTimeout(hold.t); clearInterval(hold.i); hold = null; } };
    $('cnCtl').querySelectorAll('[data-k]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); stop(); nudge(b.dataset.k);
        hold = { t: setTimeout(() => { hold.i = setInterval(() => nudge(b.dataset.k), 45); }, 320), i: 0 };
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
      b.addEventListener('click', (e) => { if (e.detail === 0) nudge(b.dataset.k); });  // keyboard Enter / Space
    });
    $('cnFire').onclick = fire;
    onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || !S?.cannon) return;
      const k = e.key, big = e.shiftKey ? 5 : 1;
      if (k === 'ArrowLeft') { aim.angle = Math.min(180, aim.angle + big); aim.set = true; showAim(); }
      else if (k === 'ArrowRight') { aim.angle = Math.max(0, aim.angle - big); aim.set = true; showAim(); }
      else if (k === 'ArrowUp') { aim.power = Math.min(1, Math.round(aim.power * 100 + big) / 100); aim.set = true; showAim(); }
      else if (k === 'ArrowDown') { aim.power = Math.max(0.05, Math.round(aim.power * 100 - big) / 100); aim.set = true; showAim(); }
      else if (k === ' ' && !e.target.closest?.('button')) fire();
      else if ('1234'.includes(k) && k.length === 1) { const sh = S.cannon.shells[+k - 1]; if (sh) pickShell(sh[0]); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    ro = window.ResizeObserver ? new ResizeObserver(size) : null;
    ro?.observe(stage);
    size();
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); ro = null;
    if (hold) { clearTimeout(hold.t); clearInterval(hold.i); hold = null; }
    if (onKey) window.removeEventListener('keydown', onKey);
    onKey = null; cv = null; g2 = null;
  }

  function size() {
    const stage = $('cnStage');
    if (!stage || !cv) return;
    const w = stage.clientWidth || 320, c = S?.cannon, h = Math.round(w * ((c?.h ?? 180) / (c?.w ?? 320)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }

  // -- state

  const C = () => S?.cannon;
  const mine = () => { const c = C(); return c && c.me != null && c.me >= 0 ? c.me : null; };
  const busy = () => !!(anim || queue.length);
  const alive = (i) => C()?.tanks[i]?.[2] > 0;
  function myMove(s) {
    const c = s?.cannon;
    if (!c || s.phase !== 'playing' || c.between || !c.volley || c.me == null) return false;
    return c.tanks[c.me]?.[2] > 0 && !c.locked.includes(c.me);
  }
  // you can fire now: your turn (or a volley you haven't locked into), and the last shells have landed
  const canFire = () => {
    const c = C();
    if (!c || S.phase !== 'playing' || c.between || mine() == null || !alive(c.me) || busy()) return false;
    return c.volley ? !c.locked.includes(c.me) : !!ctx?.myTurn;
  };
  // aiming is allowed any time your cannon is up, so you can line up your next shot while others fire
  const canAim = () => { const c = C(); return !!c && S.phase === 'playing' && mine() != null && alive(c.me) && !c.between; };
  const left = (sh) => { const c = C(), n = c.ammo[c.me]?.[sh]; return n === undefined ? Infinity : n; };

  function fire() {
    if (!canFire()) return;
    if (left(aim.shell) <= 0) aim.shell = 'shell';
    const shot = { angle: aim.angle, power: Math.round(aim.power * 1000) / 1000, shell: aim.shell };
    ctx.quiet(ctx.act('fire', shot));
    $('cnFire').disabled = true;
  }

  function pickShell(k) {
    if (left(k) <= 0) return;
    aim.shell = k;
    renderShells();
  }

  function render(s, c) {
    S = s; ctx = c;
    const p = S.cannon;
    const key = `${p.round}`;
    if (key !== roundKey) {  // a new round: new ground, back to a plain shell, aim across the range
      roundKey = key; fx = [];
      queue = queue.filter((q) => q.round === p.round); if (anim && anim.round !== p.round) anim = null;
      if (aim.shell !== 'shell') aim.shell = 'shell';
      if (p.me != null && p.tanks[p.me]) {
        const right = p.tanks[p.me][0] < p.w / 2;
        if (!aim.set || (right !== aim.angle < 90)) aim.angle = right ? 45 : 135;
      }
      size();
    }
    if (!primed) { primed = true; seenShot = p.shot?.id ?? 0; }  // a shot from before you opened the page isn't replayed
    if (p.shot && p.shot.id !== seenShot) {
      seenShot = p.shot.id;
      queue.push({ ...p.shot, round: p.round });
    }
    $('cnRound').textContent = `🏔️ Round ${p.round} of ${p.rounds}`;
    let t = '';
    if (p.between) t = 'Round over';
    else if (p.volley) {
      const waiting = p.tanks.map((_, i) => i).filter((i) => p.tanks[i][2] > 0 && !p.locked.includes(i));
      t = `⚡ ${waiting.length ? `Waiting for ${waiting.length}` : 'Firing!'}`;
    } else if (S.turn) t = p.seats.indexOf(S.turn) === p.me ? 'Your shot' : `${ctx.player(S.turn)?.name ?? '?'}'s shot`;
    $('cnTurn').textContent = t;
    if (p.me != null && aim.shell !== 'shell' && left(aim.shell) <= 0) aim.shell = 'shell';
    showAim();
    renderShells();
    renderScores();
    renderDone();
  }

  function showAim() {
    const c = C();
    if (!c) return;
    const a = aim.angle;
    $('cnAng').textContent = a <= 90 ? `${a}° ↗` : `${180 - a}° ↖`;
    $('cnPow').textContent = `${Math.round(aim.power * 100)}%`;
    const playing = mine() != null && S.phase === 'playing';
    $('cnCtl').hidden = !playing;
    $('cnShells').hidden = !playing;
    $('cnCtl').querySelectorAll('[data-k]').forEach((b) => { b.disabled = !canAim(); });
    const f = $('cnFire');
    f.disabled = !canFire();
    f.classList.toggle('cn-ready', canFire());
    const locked = c.volley && c.me != null && c.locked.includes(c.me);
    f.textContent = locked ? '✅ Locked in' : c.volley ? '⚡ Lock in' : '🔥 Fire';
    hint();
  }

  function hint() {
    const c = C();
    let t = '';
    if (S.phase === 'playing' && c && mine() != null) {
      if (c.between) t = 'Next round in a moment…';
      else if (!alive(c.me)) t = '💀 Your cannon is out this round. Watch the rest fight it out.';
      else if (canFire()) t = c.volley ? 'Everyone aims at once: drag on the range (or ◀ ▶ − +), then ⚡ Lock in.' : 'Your shot: drag back on the range like a slingshot (or ◀ ▶ − +), then 🔥 Fire.';
      else if (busy()) t = 'Incoming…';
      else t = c.volley ? 'Locked in: waiting for the others.' : 'Line up your next shot while you wait.';
    }
    const h = $('cnHint');
    if (h && h.textContent !== t) h.textContent = t;
  }

  function renderShells() {
    const c = C(), box = $('cnShells');
    if (!c || mine() == null) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    c.shells.forEach(([k, icon, name, , what], n) => {
      const cnt = left(k);
      const b = ctx.el('button', 'cn-shell' + (aim.shell === k ? ' on' : ''));
      b.append(ctx.el('span', 'cn-ico', icon), ctx.el('span', 'cn-nm', name), ctx.el('small', '', cnt === Infinity ? '∞' : `×${cnt}`));
      b.title = `${what} (key ${n + 1})`;
      b.disabled = cnt <= 0 || !canAim();
      b.setAttribute('aria-pressed', String(aim.shell === k));
      b.onclick = () => pickShell(k);
      box.append(b);
    });
  }

  function renderScores() {
    const c = C(), box = $('cnScores');
    box.innerHTML = '';
    const t = ctx.el('table', 'scores cn-scores');
    const head = ctx.el('tr');
    head.append(ctx.el('th', '', ''), ctx.el('th', '', '❤️'), ctx.el('th', '', '🏆'), ctx.el('th', '', 'Dealt'));
    t.append(head);
    c.seats.forEach((pid, i) => {
      const row = ctx.el('tr', (S.turn === pid && !c.between ? 'now' : '') + (c.tanks[i][2] <= 0 ? ' cn-out' : ''));
      const nm = ctx.el('td', '', (c.volley && c.locked.includes(i) ? '✅ ' : '') + (ctx.player(pid)?.name ?? '?'));
      nm.style.color = colorOf(i);
      row.append(nm, ctx.el('td', '', c.tanks[i][2] > 0 ? String(c.tanks[i][2]) : '💀'), ctx.el('td', '', String(c.wins[i])), ctx.el('td', '', String(c.dealt[i])));
      t.append(row);
    });
    box.append(t);
  }

  function renderDone() {
    const c = C();
    const show = c.between && !busy();
    $('cnDone').hidden = !show;
    if (!show) return;
    const w = c.roundWinner;
    $('cnDoneTitle').textContent = w == null ? `🤝 Round ${c.round}: a draw` : `🏆 ${ctx.player(c.seats[w])?.name ?? '?'} takes round ${c.round}`;
    standingsCard($('cnStand'), c.standings, { title: 'Rounds won', note: 'Most rounds wins.' });
  }

  const colorOf = (i) => ctx?.player(C()?.seats[i])?.color ?? '#fff';

  // -- drawing

  function loop(now) {
    if (!document.getElementById('cnCanvas')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const c = C();
    if (!c) return;
    if (queue.length > 2) queue = queue.slice(-1);  // back from a hidden tab: skip to the latest shot
    let terrain = c.terrain, tanks = c.tanks, frame = -1;
    if (!anim && queue.length) {
      anim = { ...queue.shift(), t0: now, done: 0 };
      thump();
      if (typeof buzz === 'function' && anim.by.includes(c.me)) buzz(25);
    }
    if (anim) {
      frame = ((now - anim.t0) / 1000) * 30;
      terrain = anim.before; tanks = anim.tanksBefore;
      for (let k = 0; k < anim.booms.length; k++) {
        const b = anim.booms[k];
        if (frame < b.at) break;
        terrain = b.terrain; tanks = b.tanks;
        if (k >= anim.done) { anim.done = k + 1; boom(b, now); }
      }
      const last = Math.max(0, ...anim.paths.map((p) => p.at + p.f.length));
      if (frame > last + 30) {
        anim = null;
        if (!queue.length) { showAim(); renderDone(); }
      }
    }
    if (g2) draw(now, terrain, tanks, frame);
  }

  function boom(b, now) {
    crump(b.r);
    shake = Math.max(shake, b.shell === 'dirt' ? 3 : b.r / 3);
    fx.push({ kind: b.shell === 'dirt' ? 'dirt' : b.kind === 'water' ? 'splash' : 'blast', x: b.x, y: b.y, r: b.r, t0: now });
    const n = b.shell === 'dirt' ? 26 : 18;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI, v = 20 + Math.random() * 50;
      fx.push({ kind: 'bit', x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: now, water: b.kind === 'water' });
    }
    for (const [j, n2] of b.dmg) {
      const t = b.tanks[j];
      fx.push({ kind: 'num', x: t[0], y: t[1] + 16, text: `−${n2}`, t0: now, color: colorOf(j) });
      if (j === C()?.me && typeof buzz === 'function') buzz([40, 30, 60]);
    }
  }

  function draw(now, terrain, tanks, frame) {
    const c = C(), W = c.w, H = c.h, th = THEMES[c.style] || THEMES.rolling;
    const dpr = cv.width / (cv.clientWidth || cv.width || 1);
    const s = (cv.width / W);
    const X = (x) => x * s, Y = (y) => (H - y) * s;
    g2.setTransform(1, 0, 0, 1, 0, 0);
    shake *= 0.9;
    if (shake > 0.2) g2.translate((Math.random() - 0.5) * shake * dpr, (Math.random() - 0.5) * shake * dpr);
    // sky
    const sky = g2.createLinearGradient(0, 0, 0, cv.height);
    sky.addColorStop(0, th.sky[0]); sky.addColorStop(1, th.sky[1]);
    g2.fillStyle = sky; g2.fillRect(-20, -20, cv.width + 40, cv.height + 40);
    // the ground
    g2.beginPath();
    g2.moveTo(0, cv.height + 20);
    for (let x = 0; x < W; x++) { g2.lineTo(X(x), Y(terrain[x])); g2.lineTo(X(x + 1), Y(terrain[x])); }
    g2.lineTo(cv.width, cv.height + 20); g2.closePath();
    const earth = g2.createLinearGradient(0, Y(H * 0.6), 0, cv.height);
    earth.addColorStop(0, th.earth[0]); earth.addColorStop(1, th.earth[1]);
    g2.fillStyle = earth; g2.fill();
    g2.strokeStyle = th.top; g2.lineWidth = Math.max(2, s * 1.6); g2.lineJoin = 'round';
    g2.beginPath();
    for (let x = 0; x < W; x++) { if (terrain[x] < c.water) { g2.moveTo(X(x + 1), Y(terrain[x])); continue; } g2.lineTo(X(x), Y(terrain[x])); g2.lineTo(X(x + 1), Y(terrain[x])); }
    g2.stroke();
    // the sea
    g2.fillStyle = th.sea + 'dd';
    g2.fillRect(0, Y(c.water), cv.width, cv.height - Y(c.water) + 20);
    // wind
    drawWind(c, s);
    // your last shot's path
    const me = mine();
    const trail = me != null ? c.trails[me] : null;
    if (trail?.length > 1 && !c.between) {
      g2.save(); g2.setLineDash([4 * dpr, 5 * dpr]); g2.strokeStyle = '#ffffffaa'; g2.lineWidth = 1.5 * dpr;
      g2.beginPath(); trail.forEach(([x, y], k) => (k ? g2.lineTo(X(x), Y(y)) : g2.moveTo(X(x), Y(y)))); g2.stroke(); g2.restore();
    }
    // cannons
    tanks.forEach((t, i) => drawTank(t, i, s, X, Y, dpr, now));
    // shells in the air
    if (anim && frame >= 0) {
      for (const p of anim.paths) {
        const k = Math.floor(frame) - p.at;
        if (k < 0 || k >= p.f.length) continue;
        g2.strokeStyle = '#ffffff66'; g2.lineWidth = 2 * dpr; g2.beginPath();
        for (let q = Math.max(0, k - 8); q <= k; q++) { const [x, y] = p.f[q]; q === Math.max(0, k - 8) ? g2.moveTo(X(x), Y(Math.min(y, H + 4))) : g2.lineTo(X(x), Y(Math.min(y, H + 4))); }
        g2.stroke();
        const [x, y] = p.f[k];
        if (y > H) {  // above the top of the screen: a marker on the edge
          g2.fillStyle = colorOf(p.by); g2.beginPath(); g2.moveTo(X(x), 2 * dpr); g2.lineTo(X(x) - 5 * dpr, 10 * dpr); g2.lineTo(X(x) + 5 * dpr, 10 * dpr); g2.fill();
        } else {
          g2.fillStyle = p.shell === 'big' ? '#ff6b35' : p.shell === 'dirt' ? '#8a6a3a' : p.shell === 'split' ? '#ffd60a' : '#222';
          g2.beginPath(); g2.arc(X(x), Y(y), Math.max(2.5, s * (p.shell === 'big' ? 2.4 : 1.6)), 0, 7); g2.fill();
          g2.strokeStyle = colorOf(p.by); g2.lineWidth = 1.2 * dpr; g2.stroke();
        }
      }
    }
    drawFx(now, s, X, Y, dpr);
  }

  function drawWind(c, s) {
    const dpr = cv.width / (cv.clientWidth || cv.width || 1);
    const cx = cv.width / 2, y = 16 * dpr, w = c.wind;
    g2.font = `600 ${12 * dpr}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillStyle = '#0008'; g2.beginPath(); g2.roundRect?.(cx - 62 * dpr, y - 11 * dpr, 124 * dpr, 22 * dpr, 11 * dpr); g2.fill();
    g2.fillStyle = '#fff';
    if (!w) { g2.fillText('🍃 No wind', cx, y); return; }
    const len = (Math.abs(w) / Math.max(5, c.windMax || 5)) * 40 * dpr, dir = Math.sign(w);
    g2.fillText(`${Math.abs(w)}`, cx - dir * 44 * dpr, y);
    g2.strokeStyle = '#fff'; g2.lineWidth = 2.5 * dpr; g2.lineCap = 'round';
    const x0 = cx - (dir * len) / 2, x1 = cx + (dir * len) / 2;
    g2.beginPath(); g2.moveTo(x0, y); g2.lineTo(x1, y); g2.moveTo(x1, y); g2.lineTo(x1 - dir * 6 * dpr, y - 5 * dpr); g2.moveTo(x1, y); g2.lineTo(x1 - dir * 6 * dpr, y + 5 * dpr); g2.stroke();
  }

  function barrelAngle(i, t) {
    const c = C();
    if (i === c.me && canAim()) return aim.angle;
    const tr = c.trails[i];
    if (tr?.length) return (Math.atan2(tr[0][1] - (t[1] + 4), tr[0][0] - t[0]) * 180) / Math.PI;
    return t[0] < c.w / 2 ? 45 : 135;
  }

  function drawTank(t, i, s, X, Y, dpr, now) {
    const c = C(), [x, y, hp] = t, col = colorOf(i), dead = hp <= 0;
    const cx = X(x), cy = Y(y);
    // barrel
    const a = (barrelAngle(i, t) * Math.PI) / 180;
    g2.strokeStyle = dead ? '#555' : '#222'; g2.lineWidth = Math.max(3, s * 1.8); g2.lineCap = 'round';
    g2.beginPath(); g2.moveTo(cx, Y(y + 4)); g2.lineTo(cx + Math.cos(a) * 8 * s, Y(y + 4 + Math.sin(a) * 8)); g2.stroke();
    // dome and tracks
    g2.fillStyle = dead ? '#666' : col;
    g2.beginPath(); g2.arc(cx, Y(y + 2.5), 4.4 * s, Math.PI, 0); g2.fill();
    g2.fillStyle = dead ? '#444' : '#2b2b2b';
    g2.beginPath(); g2.roundRect ? g2.roundRect(cx - 6 * s, Y(y + 2.6), 12 * s, 2.8 * s, 1.4 * s) : g2.rect(cx - 6 * s, Y(y + 2.6), 12 * s, 2.8 * s); g2.fill();
    if (dead) {  // a wisp of smoke
      g2.fillStyle = '#5558';
      const k = (now / 900) % 1;
      g2.beginPath(); g2.arc(cx + k * 4 * s, Y(y + 8 + k * 10), (1.5 + k * 3) * s, 0, 7); g2.fill();
      return;
    }
    // ❤️ bar and name
    const bw = 18 * s, by = Y(y + 13);
    g2.fillStyle = '#0009'; g2.fillRect(cx - bw / 2, by, bw, 2.2 * s);
    g2.fillStyle = hp > 50 ? '#57cc99' : hp > 25 ? '#ffb703' : '#ef476f';
    g2.fillRect(cx - bw / 2, by, (bw * hp) / 100, 2.2 * s);
    g2.font = `600 ${Math.max(10, 4.2 * s)}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'bottom';
    g2.fillStyle = '#000a'; g2.fillText(ctx.player(c.seats[i])?.name ?? '?', cx + 1, by - 1);
    g2.fillStyle = '#fff'; g2.fillText(ctx.player(c.seats[i])?.name ?? '?', cx, by - 2);
    // whose shot it is: a bobbing arrow; locked in (volley): a tick
    const up = !c.between && !busy() && S.phase === 'playing';
    if (up && !c.volley && S.turn === c.seats[i]) {
      const bob = Math.sin(now / 180) * 2 * s;
      g2.fillStyle = col; g2.beginPath();
      g2.moveTo(cx, by - 12 * s + bob); g2.lineTo(cx - 3.5 * s, by - 17 * s + bob); g2.lineTo(cx + 3.5 * s, by - 17 * s + bob); g2.fill();
    } else if (up && c.volley && c.locked.includes(i)) {
      g2.fillText('✅', cx, by - 12 * s);
    }
    // your aim: a power arc round your barrel
    if (i === c.me && canAim()) {
      g2.strokeStyle = col; g2.lineWidth = 2 * dpr; g2.setLineDash([2 * dpr, 3 * dpr]);
      const len = (10 + aim.power * 26) * s;
      g2.beginPath(); g2.moveTo(cx + Math.cos(a) * 9 * s, Y(y + 4 + Math.sin(a) * 9)); g2.lineTo(cx + Math.cos(a) * len, Y(y + 4) - Math.sin(a) * len); g2.stroke();
      g2.setLineDash([]);
    }
  }

  function drawFx(now, s, X, Y, dpr) {
    fx = fx.filter((f) => now - f.t0 < (f.kind === 'num' ? 1400 : f.kind === 'bit' ? 1100 : 600));
    for (const f of fx) {
      const t = (now - f.t0) / 1000;
      if (f.kind === 'blast' || f.kind === 'splash' || f.kind === 'dirt') {
        const k = t / 0.6;
        g2.globalAlpha = Math.max(0, 1 - k);
        const grad = g2.createRadialGradient(X(f.x), Y(f.y), 0, X(f.x), Y(f.y), f.r * s * (0.6 + k * 0.6));
        if (f.kind === 'blast') { grad.addColorStop(0, '#fff6c0'); grad.addColorStop(0.4, '#ffb703'); grad.addColorStop(1, '#ef476f00'); }
        else if (f.kind === 'splash') { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#4cc3e000'); }
        else { grad.addColorStop(0, '#b08850'); grad.addColorStop(1, '#6b4a2a00'); }
        g2.fillStyle = grad; g2.beginPath(); g2.arc(X(f.x), Y(f.y), f.r * s * (0.6 + k * 0.6), 0, 7); g2.fill();
        g2.globalAlpha = 1;
      } else if (f.kind === 'bit') {
        const x = f.x + f.vx * t, y = f.y + f.vy * t - 30 * t * t;
        g2.fillStyle = f.water ? '#e4f8ffcc' : '#5a3d22';
        g2.fillRect(X(x), Y(y), 1.6 * s, 1.6 * s);
      } else if (f.kind === 'num') {
        g2.globalAlpha = Math.max(0, 1 - t / 1.4);
        g2.font = `800 ${Math.max(13, 6 * s)}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
        g2.fillStyle = '#000b'; g2.fillText(f.text, X(f.x) + 1.5, Y(f.y + t * 10) + 1.5);
        g2.fillStyle = '#ff5d5d'; g2.fillText(f.text, X(f.x), Y(f.y + t * 10));
        g2.globalAlpha = 1;
      }
    }
  }

  // the top bar: between rounds and in a volley nobody has "the turn"
  const turnText = (s) => {
    const c = s.cannon;
    if (s.phase !== 'playing' || !c) return null;
    if (c.between) return `🏁 Round ${c.round} over`;
    if (c.volley) return myMove(s) ? '⚡ Aim and lock in!' : '⚡ Everyone aims at once';
    return null;
  };

  return { mount, render, unmount, myMove, turnText };
})();
