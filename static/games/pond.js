// Frozen Pond: a frozen pond in 3D (three.js) or flat from above. Everyone fishes at once against the clock.
// Tap the ice to drill a hole, tap your hole to drop the line in; when the flag springs up, HOOK (button or Space),
// then hold to reel while the fish rests and let go when it lunges. Schools drift on seeded paths that the page works
// out from the server's numbers; the fight meters run the server's own fight model on the reel times it recorded.
UI.pond = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null, keyFn = null, keyUp = null;
  let recvAt = 0, holding = false, lastNote = {}, popT = 0, lastDraw = 0, lastCount = '', lastBite = '', reelTick = 0;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nameOf = (pid) => ctx?.player(pid)?.name ?? '?';
  const colorOf = (pid) => ctx?.player(pid)?.color ?? '#ccc';
  const T = () => (V ? V.t + (performance.now() - recvAt) / 1000 : 0);
  const me = () => (V?.me ? V.anglers[V.me] : null);
  const line = () => me()?.line ?? { st: 'idle' };
  const myHoles = () => (V ? V.holes.map((h, k) => ({ ...h, k })).filter((h) => V.me && h.o === V.anglers[V.me].seat) : []);
  const playing = () => S?.phase === 'playing' && !S.paused && V?.me && T() >= 0 && T() < V.end;
  const squall = (t) => (V?.squalls || []).some(([a, b]) => t >= a && t < b);
  const FISHCOL = { perch: [0x7a9a3a, 0x2a3a1a], trout: [0xc8c0c8, 0xd87a8a], pike: [0x5a7a4a, 0xc8d090], char: [0xffc83a, 0xff8a2a] };

  function mount(main, side) {
    gl = null; flat = null; recvAt = 0; holding = false; lastNote = {}; lastCount = ''; lastBite = '';
    main.innerHTML = `<div class="fp"><div class="fp-stage" id="fpStage">
        <div class="fp-hud"><span id="fpPts"></span><span id="fpClock" class="fp-clock"></span></div>
        <div class="fp-sub"><span id="fpState"></span><span id="fpSquall" class="fp-squall" hidden>❄️ Squall!</span><span id="fpChar" class="fp-char" hidden></span></div>
        <div class="fp-count" id="fpCount" hidden></div>
        <div class="fp-pop" id="fpPop" hidden></div>
        <div class="fp-fight" id="fpFight" hidden>
          <div class="fp-mood" id="fpMood"></div>
          <div class="fp-bar fp-tension"><i id="fpTau"></i><b>tension</b></div>
          <div class="fp-bar fp-line"><i id="fpLine"></i><b id="fpLineTxt">line</b></div>
        </div>
      </div>
      <div class="fp-ctl"><button class="fp-go" id="fpGo">🎣</button></div>
      <p id="fpHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🎣 Catch</h3><div id="fpRace" class="fp-race"></div></div>';
    const go = $('fpGo');
    // one big button: drop / HOOK / hold to reel
    go.addEventListener('pointerdown', (e) => { e.preventDefault(); press(true); });
    go.addEventListener('pointerup', () => press(false));
    go.addEventListener('pointerleave', () => { if (holding) press(false); });
    go.addEventListener('pointercancel', () => press(false));
    go.addEventListener('contextmenu', (e) => e.preventDefault());
    const stage = $('fpStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const ln = line();
      if (ln.st === 'bite' || ln.st === 'fight') return press(true);
      if (!playing()) return;
      const p = (gl || flat)?.pick?.(e.clientX, e.clientY); if (!p) return;
      tapIce(p);
    });
    stage.addEventListener('pointerup', () => { if (holding) press(false); });
    keyFn = (e) => {
      if (!V || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') { if (e.target.closest?.('button') && e.target.id !== 'fpGo') return; e.preventDefault(); if (!e.repeat) press(true); }
    };
    keyUp = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault?.(); press(false); } };
    window.addEventListener('keydown', keyFn); window.addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
    if (keyFn) window.removeEventListener('keydown', keyFn); if (keyUp) window.removeEventListener('keyup', keyUp); keyFn = keyUp = null;
    window.Snd?.bed('fp.wind').set(0);
  }

  // ---------- sound: out on the ice (the shared Snd kit)
  const AT = { room: 'outdoor', send: 0.3 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...AT, pan, vol })));
  const SND = {
    drill: (pan) => snd((t, K, d) => { for (let k = 0; k < 9; k++) K.burst(d, t + k * 0.2, { type: 'bandpass', f: K.R(1800, 2600), q: 2.5, vol: 0.08, tau: 0.15 }); K.burst(d, t + 1.9, { type: 'lowpass', f: 900, q: 0.8, vol: 0.12, tau: 0.08, buf: 'brown' }); }, pan),
    plop: (pan) => snd((t, K, d) => { K.mode(d, t, 520, 0.12, 0.06, { f1: 900 }); K.burst(d, t + 0.02, { type: 'bandpass', f: 1400, q: 1.2, vol: 0.06, tau: 0.08 }); }, pan),
    bite: (pan) => snd((t, K, d) => { K.mode(d, t, 1760, 0.14, 0.4); K.mode(d, t + 0.12, 1760, 0.1, 0.35); K.burst(d, t, { type: 'bandpass', f: 900, q: 1.3, vol: 0.12, tau: 0.1 }); }, pan),
    click: () => snd((t, K, d) => K.burst(d, t, { type: 'bandpass', f: 3200, q: 3, vol: 0.05, tau: 0.01 })),
    snap: () => snd((t, K, d) => { K.burst(d, t, { type: 'highpass', f: 2500, q: 0.7, vol: 0.35, tau: 0.02 }); K.mode(d, t, 300, 0.1, 0.05, { f1: 120 }); }),
    land: (big) => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 1200, q: 0.7, vol: 0.25, tau: 0.12 }); for (let k = 0; k < 4; k++) K.burst(d, t + 0.25 + k * 0.17, { type: 'bandpass', f: 1300, q: 1, vol: 0.08, tau: 0.04 }); if (big) [988, 1319, 1568, 1976].forEach((f, k) => K.mode(d, t + 0.1 + k * 0.08, f, 0.07, 0.4)); }),
    whiff: () => snd((t, K, d) => K.burst(d, t, { type: 'bandpass', f: 700, f1: 300, q: 0.9, vol: 0.12, tau: 0.2, dur: 0.3 })),
    horn: () => snd((t, K, d) => { K.sweep(d, t, { f0: 220, f1: 230, dur: 0.9, vol: 0.12, type: 'sawtooth', attack: 0.05 }); K.sweep(d, t, { f0: 277, f1: 285, dur: 0.9, vol: 0.08, type: 'sawtooth', attack: 0.05 }); }),
  };
  const windBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), bp = A.createBiquadFilter(), g = A.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.5; g.gain.value = 0;
    src.connect(bp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.05 * l, A.currentTime, 0.8); bp.frequency.setTargetAtTime(380 + 300 * Math.max(0, l - 1), A.currentTime, 1); }, stop() { try { src.stop(); } catch {} } };
  };

  // ---------- acting
  function tapIce([x, y]) {
    const mine = myHoles();
    const near = mine.find((h) => Math.hypot(h.x - x, h.y - y) < 1.1);
    if (near) {
      if (near.at > T()) return ctx.toast?.('Still drilling…');
      if (line().h === near.k && line().st === 'wait') return;
      SND.plop(0); ctx.quiet(ctx.act('drop', { hole: near.k }));
      return;
    }
    if (Math.hypot(x, y) > V.R - 0.8) return;
    if (mine.length >= V.geo.holes) return ctx.toast?.(`You have ${V.geo.holes} holes: tap one to fish it.`);
    SND.drill(clamp(x / V.R, -1, 1)); ctx.buzz?.(10);
    ctx.act('drill', { x: +x.toFixed(2), y: +y.toFixed(2) }).catch((e) => ctx.toast?.(e?.message || String(e)));
  }

  function press(on) {
    const ln = line();
    if (on) {
      if (!playing()) return;
      if (ln.st === 'bite') { ctx.buzz?.(20); ctx.quiet(ctx.act('hook')); return; }
      if (ln.st === 'fight') { if (!holding) { holding = true; ctx.quiet(ctx.act('reel', { on: true })); } return; }
      if (ln.st === 'idle') {
        const ready = myHoles().filter((h) => h.at <= T());
        if (ready.length) { SND.plop(0); ctx.quiet(ctx.act('drop', { hole: ready[ready.length - 1].k })); }
      }
    } else if (holding) {
      holding = false;
      if (line().st === 'fight') ctx.quiet(ctx.act('reel', { on: false }));
    }
  }

  // ---------- the fight, as the server runs it (static/… must match games/pond.py fight_state)
  function fightNow(ln, upto) {
    const G = V.geo, F = V.fish[ln.kind], tg = [...ln.toggles];
    const serverReel = tg.length % 2 === 1;
    if (holding !== serverReel) tg.push(Math.max(tg[tg.length - 1] ?? 0, Math.floor(upto / G.dt)));    // our press, not yet echoed
    let p = 0, tau = 0, reel = false, ti = 0, si = 0, segEnd = ln.segs[0][0];
    const n = Math.floor(Math.min(upto, G.max) / G.dt + 1e-9);
    for (let s = 0; s < n; s++) {
      while (ti < tg.length && tg[ti] <= s) { reel = !reel; ti++; }
      const t = s * G.dt;
      while (t >= segEnd && si < ln.segs.length - 1) { si++; segEnd += ln.segs[si][0]; }
      const lunge = ln.segs[si][1];
      if (reel && !lunge) { p += G.reel * G.dt; tau += 0.04 * G.dt; }
      else if (reel && lunge) { p += G.lreel * G.dt; tau += F.k * G.dt; }
      else { tau = Math.max(0, tau - G.slack * G.dt); if (lunge) p = Math.max(0, p - G.take * G.dt); }
      if (tau >= 1) return { p, tau: 1, lunge, reel };
      if (p >= F.L) return { p: F.L, tau, lunge, reel };
    }
    let acc = 0, lunge = false; for (const [d, l] of ln.segs) { if (upto < acc + d) { lunge = l; break; } acc += d; }
    return { p, tau, lunge, reel };
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.pond; recvAt = performance.now();
    if (line().st !== 'fight' && holding) holding = false;
    // news for each angler: a catch, a snap, a bite
    for (const pid of V.seats) {
      const a = V.anglers[pid]; if (!a) continue;
      const k = a.last?.id;
      if (lastNote[pid] === undefined) { lastNote[pid] = k; continue; }
      if (k !== lastNote[pid] && a.last) {
        lastNote[pid] = k;
        const F = V.fish[a.last.kind], mine = pid === V.me, h = V.holes[a.line?.h ?? -1];
        if (a.last.what === 'land') { if (mine) { SND.land(F.pts >= 60); ctx.buzz?.([30, 40, 60]); pop(`${F.icon} ${cap(F.name)} +${F.pts}`, F.pts >= 60 ? '#ffd23f' : '#fff'); } (gl || flat)?.landed?.(pid, a.last.kind, h); }
        else if (mine) { if (a.last.what === 'snap') { SND.snap(); ctx.buzz?.(60); pop('💥 Snap!', '#ff9a9a'); } else { SND.whiff(); pop('💨 It got away', '#ffd0d0'); } }
      }
    }
    const ln = line();
    const bk = ln.st === 'bite' ? `${ln.h}:${ln.at}` : '';
    if (bk && bk !== lastBite) { SND.bite(0); ctx.buzz?.([40, 30, 40]); }
    if (!bk && lastBite && ln.st !== 'fight' && line().st !== 'fight') { /* missed */ }
    lastBite = bk;
    hud(); race(); hint();
  }
  const cap = (w) => w[0].toUpperCase() + w.slice(1);

  function hud() {
    const m = me();
    $('fpPts').textContent = m ? `🎣 ${m.points} pts · ${m.n} fish` : '🎣 Frozen Pond';
    $('fpChar').hidden = !V.charBy; if (V.charBy) $('fpChar').textContent = `✨ ${V.charBy} has the char`;
  }

  function race() {
    const box = $('fpRace'); box.innerHTML = '';
    const rows = V.seats.map((pid) => ({ pid, ...V.anglers[pid] })).sort((a, b) => b.points - a.points);
    const top = Math.max(1, ...rows.map((r) => r.points));
    for (const r of rows) {
      const row = ctx.el('div', 'fp-row' + (r.pid === V.me ? ' on' : '') + (r.out ? ' out' : ''));
      const nm = ctx.el('span', 'fp-nm', nameOf(r.pid)); nm.style.color = colorOf(r.pid);
      const bar = ctx.el('span', 'fp-barr'); const fill = ctx.el('i'); fill.style.width = `${(100 * r.points / top).toFixed(1)}%`; fill.style.background = colorOf(r.pid); bar.append(fill);
      const t = ctx.el('b', '', `${r.points}`);
      const st = r.line?.st, doing = st === 'fight' ? ' 🎣 fighting!' : st === 'bite' ? ' ❗' : '';
      const extra = ctx.el('small', '', `${(r.catches || []).slice(-8).map((c) => V.fish[c.kind].icon).join('')}${r.n > 8 ? ` +${r.n - 8}` : ''}${doing}`);
      row.append(nm, bar, t, extra);
      box.append(row);
    }
  }

  function hint() {
    const ln = line(), t = T();
    const txt = S.phase !== 'playing' ? '' : !V.me ? 'Watch the anglers.' : t < 0 ? 'Get ready…'
      : ln.st === 'fight' ? 'Hold to reel while it rests; let go when it lunges!'
        : ln.st === 'bite' ? 'HOOK IT!'
          : myHoles().length === 0 ? 'Tap the ice near the fish shadows (or bubbles) to drill a hole.'
            : ln.st === 'idle' ? 'Tap one of your holes to drop the line in, or drill another.'
              : 'Waiting for a bite… Tap another of your holes to move, or drill near the shadows.';
    if ($('fpHint').textContent !== txt) $('fpHint').textContent = txt;
  }

  function pop(text, color) {
    const el = $('fpPop'); if (!el) return;
    el.textContent = text; el.style.color = color;
    el.hidden = false; el.classList.remove('fp-pop-in'); void el.offsetWidth; el.classList.add('fp-pop-in');
    popT = performance.now() + 1600;
  }

  // the button and the fight meters, every frame
  function controls(t) {
    const ln = line(), go = $('fpGo'), fightBox = $('fpFight');
    let txt = '🎣', cls = '', dis = !playing();
    if (ln.st === 'bite') { txt = '❗ HOOK!'; cls = 'bite'; }
    else if (ln.st === 'fight') { txt = holding ? '🌀 Reeling…' : '✊ Hold to reel'; cls = holding ? 'reel' : 'fight'; }
    else if (ln.st === 'wait') { txt = '🎣 Line in · waiting'; dis = true; }
    else if (ln.st === 'retie') { txt = '🪝 Baiting…'; dis = true; }
    else { const r = myHoles().filter((h) => h.at <= t); txt = r.length ? '🎣 Drop the line' : myHoles().length ? '⛏ Drilling…' : '⛏ Tap the ice to drill'; dis = dis || !r.length; }
    if (go.textContent !== txt) go.textContent = txt;
    go.disabled = dis && ln.st !== 'fight' && ln.st !== 'bite';
    go.className = `fp-go ${cls}`;
    $('fpState').textContent = ln.st === 'wait' ? '〰 line in' : ln.st === 'bite' ? '❗ BITE' : ln.st === 'fight' ? `${V.fish[ln.kind].icon} on the line` : '';
    fightBox.hidden = ln.st !== 'fight';
    if (ln.st === 'fight') {
      const el = ln.age + (performance.now() - recvAt) / 1000, f = fightNow(ln, el), F = V.fish[ln.kind];
      $('fpTau').style.width = `${(f.tau * 100).toFixed(0)}%`;
      $('fpTau').parentElement.classList.toggle('hot', f.tau > 0.7);
      $('fpLine').style.width = `${(100 * f.p / F.L).toFixed(0)}%`;
      $('fpLineTxt').textContent = `${Math.max(0, F.L - f.p).toFixed(1)} m to go`;
      const mood = f.lunge ? '💢 LUNGING: ease off!' : '😮‍💨 Resting: reel!';
      $('fpMood').textContent = mood; $('fpMood').classList.toggle('lunge', f.lunge);
      if (holding && performance.now() - reelTick > 90) { reelTick = performance.now(); SND.click(); }
      return f;
    }
    return null;
  }

  // where each school (and each of its fish) is now
  function schools(t) {
    const out = [];
    V.schools.forEach((s, k) => {
      if (s.gone || t < (s.t0 ?? -1e9) || t > (s.t1 ?? 1e9)) return;
      const x = s.cx + s.a1 * Math.cos(s.w1 * t + s.p1) + s.a2 * Math.cos(s.w2 * t + s.p2);
      const y = s.cy + s.b1 * Math.sin(s.w1 * t + s.p1) + s.b2 * Math.sin(s.w2 * t + s.p2);
      const dx = -s.a1 * s.w1 * Math.sin(s.w1 * t + s.p1) - s.a2 * s.w2 * Math.sin(s.w2 * t + s.p2);
      const dy = s.b1 * s.w1 * Math.cos(s.w1 * t + s.p1) + s.b2 * s.w2 * Math.cos(s.w2 * t + s.p2);
      out.push({ k, s, x, y, h: Math.atan2(dy, dx) });
    });
    return out;
  }

  function loop(now) {
    if (!$('fpStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    const t = T();
    const cnt = $('fpCount');
    if (S.phase === 'playing' && t < 0) { const s = String(Math.ceil(-t)); if (cnt.textContent !== s) { cnt.textContent = s; ctx.sfx?.('tick'); } cnt.hidden = false; }
    else if (!cnt.hidden && t < 0.8 && S.phase === 'playing') { if (cnt.textContent !== 'GO!') { cnt.textContent = 'GO!'; SND.horn(); } }
    else cnt.hidden = true;
    const left = Math.max(0, V.end - Math.max(0, t)), ck = `⏱ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    if ($('fpClock').textContent !== ck) $('fpClock').textContent = ck;
    $('fpClock').classList.toggle('low', left < 15 && S.phase === 'playing');
    const sq = squall(t); $('fpSquall').hidden = !sq;
    if (popT && now > popT) { popT = 0; $('fpPop').hidden = true; }
    const fight = controls(t);
    window.Snd?.bed('fp.wind', windBed).set(S.phase === 'playing' && !S.paused ? (sq ? 2 : 0.7) : 0);
    const sc = { t, now, sq, schools: schools(t), fight, holding };
    const idle = false;
    if (now - lastDraw < 33) return;       // the fish never stop moving: ~30 fps is plenty
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- three.js: the pond lies flat; pond x is world x, pond y is world -z (away from you)
  function make3d(stage) {
    const T3 = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T3.Scene();
    const camera = new T3.PerspectiveCamera(48, 1, 0.2, 400);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 0.95, hemi: [0xe8f0ff, 0x8aa0b8, 0.6], env: true,
      key: { color: 0xfff4e6, i: 1.0, pos: [-14, 22, 10], area: 30, near: 5, far: 80, map: 1024 },
      sky: { top: 0x8fb4dc, horizon: 0xe6eef6, bottom: 0xdfe8f0, radius: 200, band: 0.1 },
    });
    const low = stg.low;
    scene3.fog = new T3.Fog(0xe6eef6, 40, 140);
    const W = (x, y, h = 0) => new T3.Vector3(x, h, -y);
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T3.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T3.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
    const R = V.R;
    // snow all round
    const snowTex = tex(256, 256, (g, w, h) => { g.fillStyle = '#f2f6fb'; g.fillRect(0, 0, w, h); for (let k = 0; k < 1500; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '200,215,235' : '255,255,255'},${Math.random() * 0.6})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
    snowTex.wrapS = snowTex.wrapT = T3.RepeatWrapping; snowTex.repeat.set(16, 16);
    const snow = new T3.Mesh(new T3.PlaneGeometry(200, 200), std(0xffffff, { map: snowTex, roughness: 0.95 }));
    snow.rotation.x = -Math.PI / 2; snow.position.y = -0.02; snow.receiveShadow = true; scene3.add(snow);
    // the ice: blue-white with cracks and drifts of snow
    const iceTex = tex(1024, 1024, (g, w) => {
      const c = w / 2, gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, '#6fa6d6'); gr.addColorStop(0.7, '#94bfe4'); gr.addColorStop(0.97, '#c8def0'); gr.addColorStop(1, '#f2f6fb');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5;
      for (let k = 0; k < 26; k++) { let x = Math.random() * w, y = Math.random() * w; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 7; j++) { x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90; g.lineTo(x, y); } g.stroke(); }
      for (let k = 0; k < 18; k++) { const x = Math.random() * w, y = Math.random() * w, r = 30 + Math.random() * 90, d = g.createRadialGradient(x, y, 0, x, y, r); d.addColorStop(0, 'rgba(245,249,253,.7)'); d.addColorStop(1, 'rgba(245,249,253,0)'); g.fillStyle = d; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    });
    const ice = new T3.Mesh(new T3.CircleGeometry(R, 72), std(0xffffff, { map: iceTex, roughness: 0.22, metalness: 0.05 }));
    ice.rotation.x = -Math.PI / 2; ice.receiveShadow = true; scene3.add(ice);
    // a snowbank round the shore
    const bank = new T3.Mesh(new T3.TorusGeometry(R + 0.6, 0.7, 10, 72), std(0xf4f8fc, { roughness: 0.95 }));
    bank.rotation.x = -Math.PI / 2; bank.scale.z = 0.45; bank.position.y = 0.05; bank.receiveShadow = true; scene3.add(bank);
    // pines with snow on them, and two little fishing huts
    const pineMat = std(0x2f5a3a), snowCap = std(0xf4f8fc, { roughness: 0.9 }), trunkMat = std(0x5a3a22);
    let seed = 11; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let k = 0; k < (low ? 26 : 50); k++) {
      const a = rnd() * Math.PI * 2, d = R + 4 + rnd() * 18, s = 1.2 + rnd() * 1.4, tr = new T3.Group();
      if (Math.sin(a) < -0.6 && d < R + 10) continue;       // keep the near shore open for the camera
      const trunk = new T3.Mesh(new T3.CylinderGeometry(0.15, 0.2, 1, 6), trunkMat); trunk.position.y = 0.5; tr.add(trunk);
      for (let j = 0; j < 3; j++) {
        const c = new T3.Mesh(new T3.ConeGeometry(1.3 - j * 0.32, 1.5, 8), pineMat); c.position.y = 1.4 + j * 0.85; c.castShadow = !low; tr.add(c);
        const cap = new T3.Mesh(new T3.ConeGeometry(0.75 - j * 0.2, 0.5, 8), snowCap); cap.position.y = 1.85 + j * 0.85; tr.add(cap);
      }
      tr.scale.setScalar(s); tr.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); scene3.add(tr);
    }
    const hutCols = [0xc0392b, 0x2f6fb5];
    [[-R - 3, -4], [R + 3.2, -7]].forEach(([x, y], k) => {
      const hut = new T3.Group();
      const body = new T3.Mesh(new T3.BoxGeometry(2.2, 1.8, 2.6), std(hutCols[k])); body.position.y = 0.9; body.castShadow = true; hut.add(body);
      const roof = new T3.Mesh(new T3.CylinderGeometry(0.01, 1.8, 1, 4, 1), snowCap); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 0.9, 1.25); roof.position.y = 2.25; hut.add(roof);
      const door = new T3.Mesh(new T3.PlaneGeometry(0.7, 1.2), std(0x3a2a1a)); door.position.set(0, 0.6, 1.31); hut.add(door);
      hut.position.copy(W(x, y)); hut.lookAt(0, 0, 0); scene3.add(hut);
    });

    // fish shadows under the ice (a dark fish shape, seen through it)
    const fishTex = tex(128, 64, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(w * 0.45, h / 2, w * 0.36, h * 0.3, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(w * 0.78, h / 2); g.lineTo(w * 0.98, h * 0.15); g.lineTo(w * 0.98, h * 0.85); g.closePath(); g.fill(); });
    const shadows = [];
    function shadow(i, char) {
      if (shadows[i]) return shadows[i];
      const m = new T3.Mesh(new T3.PlaneGeometry(1, 0.5), new T3.MeshBasicMaterial({ map: fishTex, color: char ? 0xffc83a : 0x1a3048, transparent: true, opacity: 0.35, depthWrite: false, blending: char ? T3.AdditiveBlending : T3.NormalBlending }));
      m.rotation.x = -Math.PI / 2; scene3.add(m); return (shadows[i] = m);
    }
    const rings = [];
    const ringGeo = new T3.RingGeometry(0.25, 0.32, 24);
    function ripple(x, y, col = 0xffffff, op = 0.6) { const m = new T3.Mesh(ringGeo, new T3.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.copy(W(x, y, 0.03)); m.userData = { t: 0 }; scene3.add(m); rings.push(m); }

    // holes, their flags (tip-ups) and the anglers
    const holeG = new T3.Group(); scene3.add(holeG);
    const waterMat = new T3.MeshStandardMaterial({ color: 0x0a1a2a, roughness: 0.1, metalness: 0.3 }), slushMat = std(0xe8f2fa, { roughness: 0.9 });
    const holeMeshes = [];
    function holeFor(k, h) {
      if (holeMeshes[k]) return holeMeshes[k];
      const g = new T3.Group(); g.position.copy(W(h.x, h.y, 0));
      const water = new T3.Mesh(new T3.CircleGeometry(0.34, 20), waterMat); water.rotation.x = -Math.PI / 2; water.position.y = 0.012; g.add(water);
      const slush = new T3.Mesh(new T3.RingGeometry(0.34, 0.55, 20), slushMat); slush.rotation.x = -Math.PI / 2; slush.position.y = 0.014; g.add(slush);
      const col = new T3.Color(colorOf(V.seats[h.o]));
      const prog = new T3.Mesh(new T3.RingGeometry(0.58, 0.68, 32, 1, 0, Math.PI * 2), new T3.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false })); prog.rotation.x = -Math.PI / 2; prog.position.y = 0.02; g.add(prog);
      // the tip-up: a stick across the hole with a flag on a spring
      const stick = new T3.Mesh(new T3.BoxGeometry(1.0, 0.04, 0.05), std(0x8a5a32)); stick.position.y = 0.05; g.add(stick);
      const pole = new T3.Group(); pole.position.set(0.2, 0.06, 0);
      const rod = new T3.Mesh(new T3.CylinderGeometry(0.012, 0.012, 0.7, 5), std(0x222222)); rod.position.y = 0.35; pole.add(rod);
      const flagM = new T3.Mesh(new T3.PlaneGeometry(0.22, 0.16), new T3.MeshBasicMaterial({ color: 0xff6a1a, side: T3.DoubleSide })); flagM.position.set(0.11, 0.62, 0); pole.add(flagM);
      g.add(pole);
      const bob = new T3.Mesh(new T3.SphereGeometry(0.07, 10, 8), new T3.MeshStandardMaterial({ color: 0xff3a3a, roughness: 0.4 })); bob.position.y = 0.03; g.add(bob);
      holeG.add(g);
      return (holeMeshes[k] = { g, prog, pole, bob, water });
    }
    const anglers = {};
    function anglerFor(pid) {
      if (anglers[pid]) return anglers[pid];
      const col = new T3.Color(colorOf(pid)), g = new T3.Group();
      const parka = std(col, { roughness: 0.75 });
      const bucket = new T3.Mesh(new T3.CylinderGeometry(0.22, 0.18, 0.45, 12), std(0xe8e8e8, { roughness: 0.5 })); bucket.position.y = 0.22; g.add(bucket);
      const body = new T3.Mesh(new T3.CylinderGeometry(0.2, 0.28, 0.65, 10), parka); body.position.y = 0.78; body.castShadow = true; g.add(body);
      const head = new T3.Mesh(new T3.SphereGeometry(0.15, 12, 10), std(0xf0c8a0)); head.position.y = 1.22; g.add(head);
      const hood = new T3.Mesh(new T3.SphereGeometry(0.19, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), parka); hood.position.y = 1.25; hood.rotation.x = -0.3; g.add(hood);
      const hat = new T3.Mesh(new T3.SphereGeometry(0.06, 8, 6), std(0xffffff)); hat.position.y = 1.43; g.add(hat);
      // the rod: from the hands out over the hole (the group faces the hole along +x)
      const rodPivot = new T3.Group(); rodPivot.position.set(0.15, 0.85, 0); g.add(rodPivot);
      const rod = new T3.Mesh(new T3.CylinderGeometry(0.012, 0.02, 1.0, 5), std(0x3a2a1a)); rod.rotation.z = -Math.PI / 2 + 0.5; rod.position.set(0.42, 0.24, 0); rodPivot.add(rod);
      const lineGeo = new T3.BufferGeometry().setFromPoints([new T3.Vector3(), new T3.Vector3()]);
      const lineM = new T3.Line(lineGeo, new T3.LineBasicMaterial({ color: 0x223344 })); lineM.frustumCulled = false; scene3.add(lineM);
      scene3.add(g);
      return (anglers[pid] = { g, rodPivot, rod, lineM, lineGeo });
    }
    // landed fish flopping on the ice
    const flops = [];
    function fishMesh(kind) {
      const [c1, c2] = FISHCOL[kind] || FISHCOL.perch, g = new T3.Group();
      const long = kind === 'pike' ? 1.6 : kind === 'char' ? 1.25 : kind === 'trout' ? 1.15 : 0.9;
      const body = new T3.Mesh(new T3.SphereGeometry(0.18, 14, 10), std(c1, { roughness: 0.35, metalness: 0.2, emissive: kind === 'char' ? c2 : 0x000000, emissiveIntensity: kind === 'char' ? 0.4 : 0 })); body.scale.set(long * 1.6, 0.7, 0.45); g.add(body);
      const tail = new T3.Mesh(new T3.ConeGeometry(0.14, 0.24, 4), std(c2)); tail.rotation.z = Math.PI / 2; tail.position.x = -0.3 * long; tail.scale.z = 0.3; g.add(tail);
      return g;
    }

    // falling snow, heavy in a squall
    const flakes = low ? 250 : 700, fp = new Float32Array(flakes * 3);
    for (let k = 0; k < flakes; k++) fp.set([(Math.random() - 0.5) * 50, Math.random() * 20, (Math.random() - 0.5) * 50], k * 3);
    const fgeo = new T3.BufferGeometry(); fgeo.setAttribute('position', new T3.BufferAttribute(fp, 3));
    const fmat = new T3.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.8, depthWrite: false });
    const snowfall = new T3.Points(fgeo, fmat); scene3.add(snowfall);

    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    let lastT = 0, bubbleAt = 0;
    const cam = { pos: new T3.Vector3(0, 20, 20), look: new T3.Vector3(0, 0, 0), init: false };
    const ray = new T3.Raycaster(), plane = new T3.Plane(new T3.Vector3(0, 1, 0), 0), hit = new T3.Vector3();
    let sqFade = 0;

    function draw(now, sc) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      sqFade = clamp(sqFade + (sc.sq ? dt : -dt) / 1.5, 0, 1);
      // shadows: each school's fish around its centre, swimming the way it goes
      let n = 0;
      for (const s of sc.schools) {
        const char = s.s.kind === 'char';
        if (s.s.deep) {
          if (!sc.sq && now > bubbleAt && Math.random() < 0.06) ripple(s.x + (Math.random() - 0.5) * 1.2, s.y + (Math.random() - 0.5) * 1.2, 0xffffff, 0.5);
          continue;
        }
        for (let j = 0; j < s.s.n; j++) {
          const m = shadow(n++, char), a = j * 2.4 + s.k, r = s.s.n > 1 ? 0.5 + (j % 3) * 0.45 : 0;
          const wob = Math.sin(sc.t * 1.7 + j) * 0.2;
          m.position.copy(W(s.x + Math.cos(a + sc.t * 0.2) * r, s.y + Math.sin(a + sc.t * 0.2) * r, 0.02 + j * 0.0005));
          m.rotation.z = s.h + Math.PI + wob;
          const size = s.s.kind === 'pike' ? 1.7 : s.s.kind === 'trout' ? 0.9 : char ? 1.1 : 0.6;
          m.scale.set(size, size, 1);
          m.material.color.set(char ? 0xffc83a : 0x1a3048);
          m.material.opacity = (char ? 0.55 + 0.25 * Math.sin(now / 200) : 0.33) * (1 - sqFade);
          m.visible = true;
        }
      }
      for (let k = n; k < shadows.length; k++) shadows[k].visible = false;
      if (now > bubbleAt) bubbleAt = now + 120;
      for (let k = rings.length - 1; k >= 0; k--) { const m = rings[k]; m.userData.t += dt; const u = m.userData.t / 1.4; m.scale.setScalar(1 + u * 3); m.material.opacity = 0.6 * (1 - u); if (u >= 1) { scene3.remove(m); m.material.dispose(); rings.splice(k, 1); } }
      // holes and lines
      const lineHoles = new Map();
      for (const pid of V.seats) { const a = V.anglers[pid]; if (a?.line?.h != null && a.line.st !== 'idle') lineHoles.set(a.line.h, { pid, a }); }
      V.holes.forEach((h, k) => {
        const hm = holeFor(k, h), drilling = h.at > sc.t, u = clamp(1 - (h.at - sc.t) / V.geo.drill, 0, 1);
        hm.prog.visible = drilling || V.seats[h.o] === V.me;
        if (drilling) { hm.prog.geometry.dispose(); hm.prog.geometry = new T3.RingGeometry(0.58, 0.68, 32, 1, 0, Math.PI * 2 * u); hm.prog.material.opacity = 0.9; }
        else if (hm.prog.userData.full !== true) { hm.prog.geometry.dispose(); hm.prog.geometry = new T3.RingGeometry(0.58, 0.68, 32); hm.prog.userData.full = true; hm.prog.material.opacity = 0.35; }
        hm.water.visible = !drilling || u > 0.8;
        const L = lineHoles.get(k), st = L?.a.line.st;
        hm.pole.visible = !!L && !drilling;
        hm.bob.visible = !!L && st !== 'retie' && !drilling;
        const bite = st === 'bite', fight = st === 'fight';
        hm.pole.rotation.z = bite || fight ? 0 : -1.45;     // the flag springs up on a bite
        if (bite) hm.pole.rotation.x = Math.sin(now / 50) * 0.15; else hm.pole.rotation.x = 0;
        hm.bob.position.y = bite ? -0.04 + Math.sin(now / 70) * 0.05 : fight ? -0.08 : 0.03 + Math.sin(now / 600 + k) * 0.01;
        if ((bite || fight) && Math.random() < (fight ? 0.15 : 0.08)) ripple(h.x + (Math.random() - 0.5) * 0.3, h.y + (Math.random() - 0.5) * 0.3, 0xbfe4ff, 0.8);
      });
      // anglers sit by the hole they're fishing (or their newest hole)
      for (const pid of V.seats) {
        const a = V.anglers[pid]; if (!a) continue;
        const own = V.holes.map((h, k) => ({ h, k })).filter((o) => o.h.o === a.seat);
        const at = a.line?.h != null ? V.holes[a.line.h] : own.length ? own[own.length - 1].h : null;
        const m = anglerFor(pid);
        m.g.visible = !!at && !a.out; m.lineM.visible = m.g.visible && a.line?.st !== 'idle';
        if (!at) continue;
        // sit on the shore side of the hole, facing it
        const d = Math.hypot(at.x, at.y) || 1, ox = at.x + (at.x / d) * 0.9, oy = at.y + (at.y / d) * 0.9;
        m.g.position.copy(W(ox, oy, 0));
        m.g.lookAt(W(at.x, at.y, 0)); m.g.rotateY(-Math.PI / 2);     // the figure faces along its +x
        const st = a.line?.st, fighting = st === 'fight';
        let bend = 0;
        if (fighting) { const ln = a.line, f = pid === V.me ? sc.fight : null, lunge = f ? f.lunge : false; bend = (lunge ? 0.5 : 0.25) + Math.sin(now / (lunge ? 40 : 120)) * (lunge ? 0.12 : 0.05); if (!f && ln) bend = 0.3 + Math.sin(now / 90) * 0.08; }
        m.rodPivot.rotation.z = -bend;
        m.g.updateMatrixWorld(true);
        const tip = m.rodPivot.localToWorld(new T3.Vector3(0.86, 0.48, 0));     // the rod's far end
        const pos = m.lineGeo.attributes.position; pos.setXYZ(0, tip.x, tip.y, tip.z); const hp = W(at.x, at.y, 0.02); pos.setXYZ(1, hp.x, hp.y, hp.z); pos.needsUpdate = true;
      }
      // landed fish: a flop on the ice, then into the bucket
      for (let k = flops.length - 1; k >= 0; k--) {
        const f = flops[k], u = (now - f.t0) / 1600;
        if (u >= 1) { scene3.remove(f.m); f.m.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); flops.splice(k, 1); continue; }
        const hop = Math.abs(Math.sin(u * 14)) * 0.35 * (1 - u);
        f.m.position.copy(f.at).add(new T3.Vector3(0, 0.6 * Math.sin(Math.min(1, u * 3) * Math.PI) + hop, 0));
        f.m.rotation.set(Math.sin(u * 20) * 0.6, u * 4, 0);
      }
      // snow
      const fall = (sc.sq ? 6 : 1.4) * dt, pos = fgeo.attributes.position;
      for (let k = 0; k < flakes; k++) { let y = pos.getY(k) - fall * (0.8 + (k % 5) * 0.1); let x = pos.getX(k) + (sc.sq ? 3 : 0.4) * dt; if (y < 0) { y = 20; x = (Math.random() - 0.5) * 50; } if (x > 25) x -= 50; pos.setXY(k, x, y); }
      pos.needsUpdate = true; fmat.size = sc.sq ? 0.18 : 0.12; fmat.opacity = sc.sq ? 0.95 : 0.7;
      scene3.fog.near = 40 - sqFade * 22; scene3.fog.far = 140 - sqFade * 80;
      // the camera: the whole pond, leaning in toward your hole while you fight a fish
      const myA = V.me ? V.anglers[V.me] : null, myH = myA?.line?.st === 'fight' ? V.holes[myA.line.h] : null;
      const fov = 48, need = (2 * R + 1) / 2, dist = Math.max(need / Math.tan(fov * Math.PI / 360) / Math.min(1, camera.aspect) * 0.74, 16);
      let want, look;
      if (myH) { want = W(myH.x * 0.7, myH.y * 0.7 - 7, 6.5); look = W(myH.x, myH.y, 0); }
      else { want = new T3.Vector3(0, dist * 0.68, dist * 0.74); look = new T3.Vector3(0, 0, -0.6); }
      const k = cam.init ? 1 - Math.exp(-dt * 2.5) : 1; cam.init = true;
      cam.pos.lerp(want, k); cam.look.lerp(look, k);
      camera.position.copy(cam.pos);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      stg.follow(camera);
      renderer.render(scene3, camera);
    }

    return {
      draw, resize,
      pick(cx, cy) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
        return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null;
      },
      landed(pid, kind, h) {
        if (!h) return;
        const m = fishMesh(kind); scene3.add(m);
        flops.push({ m, at: W(h.x, h.y, 0.15), t0: performance.now() });
        if (kind === 'char' || kind === 'pike') GL3.shake(camera, 0.08);
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the pond from above
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the pond.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, k = 1, cx = 0, cy = 0, pops = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const X = (x) => cx + x * k, Y = (y) => cy - y * k;
    function draw(now, sc) {
      k = Math.min(w, h - 70) / (2 * V.R + 2); cx = w / 2; cy = h / 2 + 24;
      g.fillStyle = '#eef3f9'; g.fillRect(0, 0, w, h);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, V.R * k); gr.addColorStop(0, '#9cc4e4'); gr.addColorStop(1, '#d4e6f4');
      g.beginPath(); g.arc(cx, cy, V.R * k, 0, 7); g.fillStyle = gr; g.fill();
      if (!sc.sq) for (const s of sc.schools) {
        if (s.s.deep) { if (Math.random() < 0.05) pops.push({ x: s.x + (Math.random() - 0.5), y: s.y + (Math.random() - 0.5), t: now }); continue; }
        for (let j = 0; j < s.s.n; j++) {
          const a = j * 2.4 + s.k + sc.t * 0.2, r = s.s.n > 1 ? 0.5 + (j % 3) * 0.45 : 0, size = s.s.kind === 'pike' ? 1.7 : s.s.kind === 'trout' ? 0.9 : s.s.kind === 'char' ? 1.1 : 0.6;
          g.save(); g.translate(X(s.x + Math.cos(a) * r), Y(s.y + Math.sin(a) * r)); g.rotate(-s.h); g.fillStyle = s.s.kind === 'char' ? '#ffc83acc' : '#1a304855';
          g.beginPath(); g.ellipse(0, 0, size * k * 0.4, size * k * 0.15, 0, 0, 7); g.fill(); g.restore();
        }
      }
      pops = pops.filter((p) => now - p.t < 1200);
      for (const p of pops) { const u = (now - p.t) / 1200; g.beginPath(); g.arc(X(p.x), Y(p.y), 3 + u * 12, 0, 7); g.strokeStyle = `rgba(255,255,255,${1 - u})`; g.lineWidth = 1.5; g.stroke(); }
      V.holes.forEach((ho, i) => {
        const col = colorOf(V.seats[ho.o]), drilling = ho.at > sc.t;
        g.beginPath(); g.arc(X(ho.x), Y(ho.y), 0.5 * k, 0, 7); g.fillStyle = drilling ? '#ffffff' : '#0a1a2a'; g.fill(); g.lineWidth = 3; g.strokeStyle = col; g.stroke();
        if (drilling) { const u = clamp(1 - (ho.at - sc.t) / V.geo.drill, 0, 1); g.beginPath(); g.arc(X(ho.x), Y(ho.y), 0.7 * k, -Math.PI / 2, -Math.PI / 2 + u * 7); g.stroke(); }
        for (const pid of V.seats) {
          const a = V.anglers[pid]; if (a?.line?.h !== i || a.line.st === 'idle') continue;
          g.font = `${Math.max(12, k)}px system-ui`; g.textAlign = 'center';
          g.fillText(a.line.st === 'bite' ? '🚩' : a.line.st === 'fight' ? '🎣' : '•', X(ho.x), Y(ho.y) - 0.7 * k);
        }
      });
      if (sc.sq) { g.fillStyle = '#ffffffb0'; g.fillRect(0, 0, w, h); }
    }
    return {
      draw, resize,
      pick(px, py) { const r = canvas.getBoundingClientRect(); return [(px - r.left - cx) / k, -(py - r.top - cy) / k]; },
      landed() {},
      dispose() { canvas.remove(); },
    };
  }

  const turnText = (s) => (s.phase === 'playing' && s.pond ? '🎣 Frozen Pond · everyone fishing' : null);
  const myMove = (s) => s.phase === 'playing' && !!s.pond?.me && ['bite', 'fight'].includes(s.pond.anglers[s.pond.me]?.line?.st);
  // the pond shows its own clock: the room's deadline here is only the next bite or lunge
  const ownTimer = () => true;
  return { mount, unmount, render, turnText, myMove, ownTimer, focus: true };
})();
