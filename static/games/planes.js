// Paper Planes: a park in 3D (three.js) or flat from above. Everyone throws at once, two planes a round.
// Pick a fold, swipe up on the park (sideways aims, the length is the power), ▲ ▼ set the loft; or the arrow keys,
// W/S for loft, 1/2/3 for the fold and Space to throw. The server flies every plane and sends its path; the page
// plays it back, so everyone sees what scored.
UI.planes = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null, keyFn = null;
  let anims = [], seen = new Set(), roundKey = '', lastV = null, goAt = 0, endAt = 0, busyAt = 0;
  let fold = 'glider', pitch = 10, yaw = 0, power = 0.6, clip = false, swipe = null, lastThrow = 0, popT = 0, lastDraw = 0, lastTick = 0;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FOLD = { dart: '🎯 Dart', glider: '🕊 Glider', stunt: '🌀 Stunt' };
  const GOAL_ICON = { far: '📏', hoop: '⭕', blanket: '🎯', rings: '💫', air: '⏱' };
  const nameOf = (pid) => ctx?.player(pid)?.name ?? '?';
  const colorOf = (pid) => ctx?.player(pid)?.color ?? '#ccc';
  const mine = () => (V?.me ? V.fliers[V.me] : null);
  const left = () => mine()?.left ?? 0;
  const canThrow = () => S?.phase === 'playing' && V?.stage === 'play' && V.me && left() > 0 && !S.paused
    && performance.now() > busyAt && performance.now() - lastThrow > 600;

  function mount(main, side) {
    gl = null; flat = null; anims = []; seen = new Set(); roundKey = ''; lastV = null; goAt = endAt = busyAt = 0;
    fold = 'glider'; pitch = 10; yaw = 0; power = 0.6; clip = false; swipe = null; lastThrow = 0;
    main.innerHTML = `<div class="pl"><div class="pl-stage" id="plStage">
        <div class="pl-hud"><span id="plGoal"></span><span id="plClock" class="pl-clock"></span></div>
        <div class="pl-sub"><span id="plLeft" class="pl-left"></span><span id="plWind"></span><span id="plLive" class="pl-live"></span></div>
        <div class="pl-count" id="plCount" hidden></div>
        <div class="pl-pop" id="plPop" hidden></div>
        <div class="pl-done" id="plDone" hidden><h3 id="plDoneTitle"></h3><div id="plStand"></div></div>
      </div>
      <div class="pl-ctl" id="plCtl">
        <div class="pl-folds" id="plFolds">${Object.entries(FOLD).map(([k, t]) => `<button data-f="${k}">${t}</button>`).join('')}<button id="plClip" class="pl-clip" title="Paperclip: this throw flies true (once a game)">📎</button></div>
        <div class="pl-aim">
          <button data-a="-1" aria-label="Aim left">◀</button>
          <span class="pl-loft"><button data-l="-1" aria-label="Less loft">▼</button><b id="plLoft"></b><button data-l="1" aria-label="More loft">▲</button></span>
          <button data-a="1" aria-label="Aim right">▶</button>
          <div class="pl-meter" title="Power"><i id="plPow"></i></div>
          <button data-p="-1" aria-label="Less power">−</button><button data-p="1" aria-label="More power">+</button>
          <button class="pl-go" id="plGo">✈️ Throw</button>
        </div>
      </div>
      <p id="plHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>✈️ Points</h3><div id="plRace" class="pl-race"></div><div id="plFeed" class="pl-feed"></div></div>';
    $('plCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'plGo') return fire();
      if (b.id === 'plClip') { if (mine()?.clip) clip = !clip; return controls(); }
      if (b.dataset.f) fold = b.dataset.f;
      if (b.dataset.a) yaw = clamp(yaw + 2 * b.dataset.a, -30, 30);
      if (b.dataset.l) pitch = clamp(pitch + 3 * b.dataset.l, -9, 48);
      if (b.dataset.p) power = clamp(power + 0.04 * b.dataset.p, 0, 1);
      controls();
    });
    const stage = $('plStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canThrow() || e.target.closest('button, .pl-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, a: yaw, p: power };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const r = stage.getBoundingClientRect(), dx = e.clientX - swipe.x, dy = swipe.y - e.clientY;
      yaw = clamp(30 * dx / Math.max(80, r.width * 0.4), -30, 30);      // looking down the park, +z is to your right
      power = clamp(dy / Math.max(120, r.height * 0.6), 0, 1);
      swipe.moved = Math.max(swipe.moved || 0, dy);
      controls();
    });
    stage.addEventListener('pointerup', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const ok = (swipe.moved || 0) > 24;
      if (!ok) { yaw = swipe.a; power = swipe.p; }
      swipe = null; controls();
      if (ok) fire();
    });
    stage.addEventListener('pointercancel', () => { if (swipe) { yaw = swipe.a; power = swipe.p; } swipe = null; });
    keyFn = (e) => {
      if (!V || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') yaw = clamp(yaw + (k === 'ArrowLeft' ? -1.5 : 1.5), -30, 30);
      else if (k === 'ArrowUp' || k === 'ArrowDown') power = clamp(power + (k === 'ArrowDown' ? -0.03 : 0.03), 0, 1);
      else if (k === 'w' || k === 'W' || k === 's' || k === 'S') pitch = clamp(pitch + (k.toLowerCase() === 'w' ? 2 : -2), -9, 48);
      else if (k === '1' || k === '2' || k === '3') fold = ['dart', 'glider', 'stunt'][+k - 1];
      else if ((k === ' ' || k === 'Enter') && !e.target.closest?.('button')) fire();
      else return;
      e.preventDefault(); controls();
    };
    window.addEventListener('keydown', keyFn);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; swipe = null;
    if (keyFn) window.removeEventListener('keydown', keyFn); keyFn = null;
    window.Snd?.bed('pl.air').set(0);
  }

  // ---------- sound: the shared Snd kit out in a park
  const AT = { room: 'outdoor', send: 0.25 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...AT, pan, vol })));
  const SND = {
    // paper leaving the hand: a crisp swish
    toss: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 2600, f1: 1200, q: 0.9, vol: 0.22, tau: 0.12, dur: 0.25 }); }),
    // a paper plane touching down on the grass
    pat: (pan) => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 1400, q: 0.7, vol: 0.18, tau: 0.04, buf: 'brown' }); K.burst(d, t + 0.05, { type: 'bandpass', f: 3000, q: 1.5, vol: 0.05, tau: 0.03 }); }, pan),
    // through a hoop or a ring: a bright chime
    ding: (n = 1) => snd((t, K, d) => { for (let k = 0; k < n; k++) { K.mode(d, t + k * 0.09, 1568 * (1 + k * 0.25), 0.1, 0.5); K.mode(d, t + k * 0.09, 2352 * (1 + k * 0.25), 0.04, 0.3); } }),
    // the whistle that starts a round
    whistle: () => snd((t, K, d) => { K.sweep(d, t, { f0: 2300, f1: 2500, dur: 0.35, vol: 0.12, type: 'sine', attack: 0.02 }); K.sweep(d, t + 0.4, { f0: 2400, f1: 2400, dur: 0.18, vol: 0.1, type: 'sine', attack: 0.02 }); }),
    cheer: () => snd((t, K, d) => { for (let k = 0; k < 10; k++) K.burst(d, t + K.R(0, 0.5), { type: 'bandpass', f: K.R(900, 2400), q: 2, vol: 0.05, tau: 0.25 }); [784, 988, 1175].forEach((f, k) => K.mode(d, t + 0.05 + k * 0.08, f, 0.06, 0.25)); }),
  };
  // the breeze across the park, louder with a stronger wind
  const airBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), bp = A.createBiquadFilter(), g = A.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.4; g.gain.value = 0;
    src.connect(bp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.05 * l, A.currentTime, 0.8); }, stop() { try { src.stop(); } catch {} } };
  };

  function fire() {
    if (!canThrow()) return;
    lastThrow = performance.now();
    SND.toss(); ctx.buzz?.(12);
    const useClip = clip && !!mine()?.clip;
    clip = false;
    ctx.quiet(ctx.act('throw', { fold, pitch: +pitch.toFixed(1), yaw: +yaw.toFixed(1), power: +power.toFixed(3), clip: useClip }));
    controls();
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.planes;
    const now = performance.now();
    if (V !== lastV) {
      lastV = V;
      goAt = V.stage === 'count' ? now + V.startIn * 1000 : 0;
      endAt = V.stage === 'play' || V.stage === 'settle' ? now + V.timeLeft * 1000 : 0;
      if (V.busyIn) busyAt = Math.max(busyAt, now + V.busyIn * 1000 - 300);
    }
    const key = `${V.round}`;
    if (key !== roundKey) {
      // a new round: what's already happened isn't replayed
      roundKey = key; anims = [];
      seen = new Set(V.seats.flatMap((pid) => (V.fliers[pid]?.shots || []).map((sh) => sh.id)));
      yaw = 0; clip = false;
    }
    let stagger = 0;
    for (const pid of V.seats) for (const sh of V.fliers[pid]?.shots || []) {
      if (seen.has(sh.id)) continue;
      seen.add(sh.id);
      anims.push({ shot: sh, pid, t0: now + stagger, done: false, gates: new Set() });
      if (pid === V.me) busyAt = Math.max(busyAt, now + sh.t * 1000 + 300);
      stagger += 60;
    }
    hud(); controls(); race(); feed(); done(); hint();
  }

  function hud() {
    $('plGoal').textContent = `${GOAL_ICON[V.goal]} ${V.goalName.replace(/^\S+ /, '')} · ${V.round}/${V.rounds}`;
    const f = mine();
    const n = f?.left ?? 0;
    $('plLeft').textContent = f ? '✈'.repeat(n) + '·'.repeat(Math.max(0, V.throws - n)) + (f.roundPts ? `  ${f.roundPts} pts` : '') : '';
    const [wx, wz] = V.wind, sp = Math.hypot(wx, wz);
    // an arrow for where the wind blows to, as seen from the throwing line (downrange is up the screen)
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    const ix = ((Math.round(Math.atan2(wz, wx) / (Math.PI / 4)) % 8) + 8) % 8;
    $('plWind').textContent = sp < 0.5 ? '🌬 still' : `🌬 ${Math.round(sp * 3.6)} km/h ${arrows[ix]}`;
  }

  function controls() {
    if (!V) return;
    const go = canThrow(), f = mine();
    $('plGo').disabled = !go;
    $('plGo').classList.toggle('pl-ready', go);
    $('plCtl').classList.toggle('pl-off', !(V.me && left() > 0 && V.stage !== 'between'));
    for (const b of $('plFolds').querySelectorAll('[data-f]')) b.classList.toggle('on', b.dataset.f === fold);
    const cb = $('plClip'); cb.disabled = !f?.clip; cb.classList.toggle('on', clip && !!f?.clip); cb.hidden = !V.me;
    $('plLoft').textContent = `${Math.round(pitch)}°`;
    const p = $('plPow'); if (p) p.style.height = `${Math.round(power * 100)}%`;
  }

  function race() {
    const box = $('plRace'); box.innerHTML = '';
    const rows = V.seats.map((pid) => ({ pid, ...V.fliers[pid] })).sort((a, b) => b.points - a.points);
    const top = Math.max(1, ...rows.map((r) => r.points));
    for (const r of rows) {
      const row = ctx.el('div', 'pl-row' + (r.pid === V.me ? ' on' : '') + (r.out ? ' out' : ''));
      const nm = ctx.el('span', 'pl-nm', nameOf(r.pid)); nm.style.color = colorOf(r.pid);
      const bar = ctx.el('span', 'pl-bar'); const fill = ctx.el('i'); fill.style.width = `${(100 * r.points / top).toFixed(1)}%`; fill.style.background = colorOf(r.pid); bar.append(fill);
      const t = ctx.el('b', '', `${r.points}`);
      const extra = ctx.el('small', '', `${r.left ? '✈'.repeat(r.left) : '✓'} · this round ${r.roundPts}${r.clip ? ' · 📎' : ''}`);
      row.append(nm, bar, t, extra);
      box.append(row);
    }
  }

  function what(sh) {
    if (V.goal === 'far') return `${sh.far} m`;
    if (V.goal === 'air') return `${(+sh.air).toFixed(1)} s`;
    if (V.goal === 'blanket') return sh.pts ? `blanket +${sh.pts}` : `${sh.off} m off`;
    if (V.goal === 'hoop') return sh.hoop ? 'HOOP +60' : sh.pts ? `close +${sh.pts}` : 'miss';
    return `${(sh.rings || []).length} ring${(sh.rings || []).length === 1 ? '' : 's'}${sh.pts ? ` +${sh.pts}` : ''}`;
  }

  function feed() {
    const box = $('plFeed'); box.innerHTML = '';
    const all = [];
    for (const pid of V.seats) for (const s of V.fliers[pid]?.shots || []) all.push({ pid, s });
    all.sort((a, b) => b.s.id - a.s.id);
    const flying = new Set(anims.filter((a) => !a.done).map((a) => a.shot.id));
    for (const { pid, s } of all.slice(0, 6)) {
      const row = ctx.el('div', 'pl-f');
      const nm = ctx.el('b', '', nameOf(pid)); nm.style.color = colorOf(pid);
      row.append(nm, ctx.el('span', '', ` ${FOLD[s.fold].split(' ')[0]}${s.clip ? '📎' : ''} ${flying.has(s.id) ? '…in the air' : what(s)}`));
      box.append(row);
    }
  }

  function done() {
    const show = V.stage === 'between' && !!V.standings;
    $('plDone').hidden = !show;
    if (!show) return;
    $('plDoneTitle').textContent = `🏁 ${V.goalName} done`;
    const nxt = V.round < V.rounds ? V.order[V.round] : null;
    standingsCard($('plStand'), V.standings, { title: '✈️ Points', note: nxt ? `Next: ${GOAL_ICON[nxt]} in a moment…` : 'That was the last round!' });
  }

  function hint() {
    const t = S.phase !== 'playing' ? '' : V.stage === 'count' ? 'Get ready…'
      : V.stage === 'between' ? '' : !V.me ? 'Everyone throws at once: watch the planes fly.'
        : left() === 0 ? 'Both planes thrown: watch the others land.'
          : { far: 'Longest throw: a glider thrown flat and hard goes furthest; ride a tail wind.',
              hoop: 'Through the hoop: a steady dart at low loft is easiest to aim. 60 points through, a little for close.',
              blanket: 'Land on the blanket: 50 in the middle. Gentler throws come down sooner.',
              rings: 'Through the rings: 20 each, +20 for all three. They get lower further out.',
              air: 'Longest flight: a glider over the 🔥 grills hangs in the air. 10 points a second.' }[V.goal];
    if ($('plHint').textContent !== t) $('plHint').textContent = t;
  }

  function pop(sh) {
    const el = $('plPop'); if (!el) return;
    const big = (V.goal === 'hoop' && sh.hoop) || (V.goal === 'blanket' && sh.pts === 50) || (V.goal === 'rings' && sh.pts >= 80);
    el.textContent = `${big ? '🎉 ' : ''}${what(sh)}${sh.pts && V.goal !== 'hoop' && V.goal !== 'blanket' && V.goal !== 'rings' ? ` · ${sh.pts} pts` : ''}`;
    el.style.color = big ? '#ffd23f' : sh.pts ? '#fff' : '#ffb0b0';
    el.hidden = false; el.classList.remove('pl-pop-in'); void el.offsetWidth; el.classList.add('pl-pop-in');
    popT = performance.now() + 1500;
  }

  // where a flight is at `tp` seconds into its own path: [x, y, z, heading dx, dy, dz]
  function at(path, tp) {
    let k = 1;
    while (k < path.length - 1 && path[k][0] < tp) k++;
    const a = path[k - 1], b = path[k], u = b[0] > a[0] ? clamp((tp - a[0]) / (b[0] - a[0]), 0, 1) : 1;
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, b[1] - a[1], b[2] - a[2], b[3] - a[3]];
  }
  const playT = (a, now) => { const sh = a.shot; return clamp((now - a.t0) / 1000, 0, sh.t) * (sh.air / sh.t); };

  // the calm-air flight with no wobble (the server's model): only its first half second shows as the aim guide
  function preview() {
    const F = V.geo.folds[fold]; if (!F) return [];
    const [cl, cd, spd, , , curl, lmax] = F, G = V.geo.g, DT = V.geo.dt;
    let Vs = (V.geo.speed[0] + (V.geo.speed[1] - V.geo.speed[0]) * power) * spd, gam = pitch * Math.PI / 180, psi = yaw * Math.PI / 180;
    let x = 0, y = V.geo.h0, z = 0; const out = [];
    for (let t = 0; t < 0.55; t += DT) {
      const L = Math.min(cl * Vs * Vs, lmax * G);
      Vs = Math.max(0.3, Vs + (-cd * Vs * Vs - G * Math.sin(gam)) * DT);
      gam += (L - G * Math.cos(gam)) / Vs * DT;
      if (curl) psi += curl * Math.min(1, Vs / 8) * DT;
      const hv = Vs * Math.cos(gam);
      x += hv * Math.cos(psi) * DT; z += hv * Math.sin(psi) * DT; y += Vs * Math.sin(gam) * DT;
      out.push([x, y, z]);
    }
    return out.filter((_, k) => k % 3 === 2);
  }

  function scene(now) {
    const fly = [], landed = [];
    for (const pid of V.seats) {
      const live = new Map(anims.filter((a) => a.pid === pid && !a.done).map((a) => [a.shot.id, a]));
      for (const sh of V.fliers[pid]?.shots || []) {
        const a = live.get(sh.id);
        if (a) fly.push({ a, pid, shot: sh, tp: playT(a, now), color: colorOf(pid), me: pid === V.me });
        else landed.push({ pid, shot: sh, color: colorOf(pid) });
      }
    }
    return { goal: V.goal, wind: V.wind, vents: V.vents, targets: V.targets, geo: V.geo, fly, landed, now,
      preview: canThrow() || swipe ? preview() : null, fold, swiping: !!swipe, myColor: V.me ? colorOf(V.me) : '#fff' };
  }

  // the moment a plane touches down
  function land(a) {
    const sh = a.shot, me = a.pid === V.me;
    SND.pat(clamp(-sh.land[1] / 15, -1, 1));
    if (me) {
      ctx.buzz?.(sh.pts >= 50 ? [30, 30, 50] : 12);
      pop(sh);
      if ((V.goal === 'hoop' && sh.hoop) || (V.goal === 'blanket' && sh.pts >= 50) || (V.goal === 'rings' && sh.pts >= 80)) SND.cheer();
    }
    (gl || flat)?.impact?.(sh, colorOf(a.pid), me);
  }
  // crossing a hoop or ring during the flight: chime as it passes (scored by the server, played here)
  function gates(a) {
    const sh = a.shot, tp = playT(a, performance.now()), [x] = at(sh.path, tp);
    const list = V.goal === 'hoop' && sh.hoop ? [V.targets.hoop[0]] : V.goal === 'rings' ? (sh.rings || []).map((k) => V.targets.rings[k][0]) : [];
    list.forEach((gx, k) => { if (x >= gx && !a.gates.has(k)) { a.gates.add(k); if (a.pid === V.me || V.seats.length <= 2) SND.ding(V.goal === 'rings' ? a.gates.size : 2); } });
  }

  function loop(now) {
    if (!$('plStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    let changed = false;
    for (const a of anims) {
      if (a.done) continue;
      gates(a);
      if (now - a.t0 >= a.shot.t * 1000) { a.done = true; changed = true; land(a); }
    }
    if (changed) feed();
    anims = anims.filter((a) => !a.done || now - a.t0 < a.shot.t * 1000 + 1500);
    if (popT && now > popT) { popT = 0; $('plPop').hidden = true; }
    const cnt = $('plCount');
    if (V.stage === 'count' && goAt) {
      const s = Math.ceil((goAt - now) / 1000);
      const txt = s > 0 ? String(s) : 'GO!';
      if (cnt.textContent !== txt) { cnt.textContent = txt; if (s > 0) ctx.sfx?.('tick'); else SND.whistle(); }
      cnt.hidden = false;
    } else if (!cnt.hidden && !(goAt && now - goAt < 700)) cnt.hidden = true;
    else if (!cnt.hidden && cnt.textContent !== 'GO!') { cnt.textContent = 'GO!'; SND.whistle(); }
    const ck = $('plClock');
    if (endAt && V.stage !== 'between') {
      const s = Math.max(0, Math.ceil((endAt - now) / 1000));
      const txt = `⏱ ${s}`;
      if (ck.textContent !== txt) {
        ck.textContent = txt;
        if (s <= 5 && s > 0 && V.stage === 'play' && left() > 0 && now - lastTick > 500) { lastTick = now; ctx.sfx?.('tickfast'); }
      }
      ck.classList.toggle('low', s <= 5 && left() > 0);
    } else ck.textContent = '';
    // a live readout for your own plane in the air
    const myFly = anims.find((a) => a.pid === V.me && !a.done);
    const live = $('plLive');
    if (myFly && (V.goal === 'air' || V.goal === 'far')) {
      const tp = playT(myFly, now), [x] = at(myFly.shot.path, tp);
      live.textContent = V.goal === 'air' ? `⏱ ${tp.toFixed(1)} s` : `📏 ${Math.max(0, x).toFixed(1)} m`;
    } else if (live.textContent) live.textContent = '';
    if ($('plGo').disabled === canThrow()) controls();
    window.Snd?.bed('pl.air', airBed).set(S.phase === 'playing' && !S.paused ? clamp(0.3 + Math.hypot(...V.wind) / 5, 0, 1) : 0);
    const sc = scene(now);
    const idle = !sc.fly.length && !swipe && !(gl || flat)?.moving?.();
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- three.js: x runs downrange from the throwing line, y is up, +z is to your right
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 400);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.0, hemi: [0xdff1ff, 0x5a7a3a, 0.75], env: true,
      key: { color: 0xfff1d6, i: 1.25, pos: [10, 30, 18], area: 34, near: 5, far: 90, map: 1024 },
      sky: { top: 0x3f8fe0, horizon: 0xd8ecff, bottom: 0x7aa860, radius: 220, band: 0.08 },
    });
    const low = stg.low;
    scene3.fog = new T.Fog(0xd8ecff, 70, 210);
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });

    // mown grass in stripes across the park, with chalk lines every 10 m
    const grass = tex(512, 512, (g, w, h) => {
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#5e9a3c' : '#6aa845'; g.fillRect(0, k * h / 8, w, h / 8); }
      for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,70,20' : '150,200,90'},${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 3); }
    });
    grass.wrapS = grass.wrapT = T.RepeatWrapping; grass.repeat.set(10, 10);
    const ground = new T.Mesh(new T.PlaneGeometry(160, 160), std(0xffffff, { map: grass, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.rotation.z = Math.PI / 2; ground.position.x = 30; ground.receiveShadow = true; scene3.add(ground);
    const chalk = new T.MeshBasicMaterial({ color: 0xf4f6ee, transparent: true, opacity: 0.8, depthWrite: false });
    const label = (text, col = '#fff') => {
      const t = tex(128, 64, (g, w, h) => { g.font = '800 44px "Baloo 2", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8; g.strokeStyle = '#0008'; g.strokeText(text, w / 2, h / 2); g.fillStyle = col; g.fillText(text, w / 2, h / 2); });
      return new T.Sprite(new T.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
    };
    for (let m = 10; m <= 60; m += 10) {
      const line = new T.Mesh(new T.PlaneGeometry(0.15, 30), chalk); line.rotation.x = -Math.PI / 2; line.position.set(m, 0.01, 0); scene3.add(line);
      const lb = label(`${m} m`); lb.scale.set(2.4, 1.2, 1); lb.position.set(m, 0.7, 15.8); scene3.add(lb);
    }
    const startLine = new T.Mesh(new T.PlaneGeometry(0.25, 30), new T.MeshBasicMaterial({ color: 0xffffff })); startLine.rotation.x = -Math.PI / 2; startLine.position.set(0.6, 0.012, 0); scene3.add(startLine);

    // the throwing stand: a little wooden deck with a rail
    const wood = std(0x9a6a3a, { roughness: 0.7 });
    const deck = new T.Mesh(new T.BoxGeometry(2.2, 0.3, 3), wood); deck.position.set(-0.6, 0.15, 0); deck.castShadow = deck.receiveShadow = true; scene3.add(deck);
    for (const z of [-1.4, 1.4]) { const r = new T.Mesh(new T.BoxGeometry(2.2, 0.06, 0.06), wood); r.position.set(-0.6, 1.2, z); scene3.add(r); for (const x of [-1.6, 0.4]) { const p = new T.Mesh(new T.BoxGeometry(0.08, 0.9, 0.08), wood); p.position.set(x, 0.75, z); scene3.add(p); } }

    // trees around the edges of the park (a few clumps, cheap cones and balls)
    const trunkMat = std(0x6a4a2a), leafMats = [std(0x3f7a2e), std(0x4f8a34), std(0x2f6a2a)];
    const coneG = new T.ConeGeometry(1, 2.2, 8), ballG = new T.IcosahedronGeometry(1, 1), trunkG = new T.CylinderGeometry(0.18, 0.25, 1.6, 6);
    let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let k = 0; k < (low ? 22 : 44); k++) {
      const side = k % 2 ? 1 : -1, x = -10 + rnd() * 90, z = side * (19 + rnd() * 16), s = 1.4 + rnd() * 1.6;
      const tr = new T.Group();
      const trunk = new T.Mesh(trunkG, trunkMat); trunk.position.y = 0.8; tr.add(trunk);
      const leaf = new T.Mesh(rnd() < 0.5 ? coneG : ballG, leafMats[k % 3]); leaf.position.y = 2.4; leaf.castShadow = !low; tr.add(leaf);
      tr.scale.setScalar(s); tr.position.set(x, 0, z); scene3.add(tr);
    }
    for (let k = 0; k < (low ? 6 : 12); k++) {
      const x = 75 + rnd() * 30, z = -30 + rnd() * 60, s = 1.8 + rnd() * 2;
      const leaf = new T.Mesh(ballG, leafMats[k % 3]); leaf.scale.setScalar(s * 1.4); leaf.position.set(x, s * 1.6, z); scene3.add(leaf);
    }

    // the windsock on a pole beside the stand: it points where the wind blows
    const pole = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 4.4, 8), std(0xdddddd, { metalness: 0.4, roughness: 0.4 })); pole.position.set(4, 2.2, -5); scene3.add(pole);
    const sockTex = tex(128, 32, (g, w, h) => { for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#ffffff' : '#ff6a1a'; g.fillRect(k * w / 5, 0, w / 5, h); } });
    const sock = new T.Mesh(new T.CylinderGeometry(0.28, 0.12, 1.4, 12, 1, true), std(0xffffff, { map: sockTex, side: T.DoubleSide }));
    sock.geometry.rotateZ(-Math.PI / 2); sock.geometry.translate(0.7, 0, 0);
    const sockPivot = new T.Group(); sockPivot.position.set(4, 4.3, -5); sockPivot.add(sock); scene3.add(sockPivot);

    // barbecue grills with warm air shimmering up from them
    const grillG = new T.Group(); scene3.add(grillG);
    const grillMat = std(0x222222, { metalness: 0.6, roughness: 0.4 }), coalMat = new T.MeshBasicMaterial({ color: 0xff6a2a });
    const heatTex = tex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,170,90,.55)'); gr.addColorStop(1, 'rgba(255,200,140,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const heatMat = new T.MeshBasicMaterial({ map: heatTex, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, opacity: 0.16 });
    const motes = [];
    let ventKey = '';
    function grills(vents) {
      const key = JSON.stringify(vents); if (key === ventKey) return; ventKey = key;
      while (grillG.children.length) grillG.remove(grillG.children[0]);
      motes.length = 0;
      for (const [x, z] of vents) {
        const g = new T.Group(); g.position.set(x, 0, z);
        const bowl = new T.Mesh(new T.SphereGeometry(0.45, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), grillMat); bowl.position.y = 0.85; bowl.castShadow = true; g.add(bowl);
        const coals = new T.Mesh(new T.CircleGeometry(0.4, 16), coalMat); coals.rotation.x = -Math.PI / 2; coals.position.y = 0.83; g.add(coals);
        for (let k = 0; k < 3; k++) { const leg = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.85, 5), grillMat); const a = k * 2.1; leg.position.set(Math.cos(a) * 0.3, 0.42, Math.sin(a) * 0.3); g.add(leg); }
        const col = new T.Mesh(new T.CylinderGeometry(V.geo.ventR * 0.45, 0.45, 7, 18, 1, true), heatMat); col.position.y = 4.3; g.add(col);
        if (!low) for (let k = 0; k < 14; k++) { const m = new T.Mesh(new T.SphereGeometry(0.06, 5, 4), new T.MeshBasicMaterial({ color: 0xffd0a0, transparent: true, opacity: 0.6 })); m.userData = { r: Math.random() * 1.6, a: Math.random() * 7, h: Math.random() * 8 }; g.add(m); motes.push(m); }
        grillG.add(g);
      }
    }

    // the challenge props: a hoop on a stand, rings on thin poles, the picnic blanket
    const props = new T.Group(); scene3.add(props);
    let propKey = '';
    const RCOL = [0xff5a8a, 0x5ac8ff, 0xffd23f];
    function challenge(sc) {
      const key = sc.goal + JSON.stringify(sc.targets); if (key === propKey) return; propKey = key;
      while (props.children.length) props.remove(props.children[0]);
      const t = sc.targets, gm = sc.geo;
      const gate = (x, y, z, r, col) => {
        const ring = new T.Mesh(new T.TorusGeometry(r, 0.08, 10, 40), std(col, { roughness: 0.4, emissive: col, emissiveIntensity: 0.25 }));
        ring.rotation.y = Math.PI / 2; ring.position.set(x, y, z); ring.castShadow = true; props.add(ring);
        const p = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, y - r, 6), std(0xeeeeee)); p.position.set(x, (y - r) / 2, z); props.add(p);
      };
      if (t.hoop) gate(t.hoop[0], t.hoop[1], t.hoop[2], gm.hoopR, 0xffb21a);
      if (t.rings) t.rings.forEach(([x, y, z], k) => gate(x, y, z, gm.ringR, RCOL[k % 3]));
      if (t.blanket) {
        const R = gm.blanket[gm.blanket.length - 1];
        const bt = tex(512, 512, (g, w, h) => {
          const n = 12; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#f4efe4' : '#d8342f'; g.fillRect(i * w / n, j * h / n, w / n, h / n); }
          const cx = w / 2, k = w / 2 / R;
          [...gm.blanket].reverse().forEach((r, i) => { g.beginPath(); g.arc(cx, cx, r * k, 0, 7); g.fillStyle = ['#ffffff55', '#2f7fe866', '#ffd23f88', '#ffd23f'][i]; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); });
        });
        const bl = new T.Mesh(new T.PlaneGeometry(2 * R, 2 * R), std(0xffffff, { map: bt, roughness: 0.95 })); bl.rotation.x = -Math.PI / 2; bl.position.set(t.blanket[0], 0.02, t.blanket[1]); bl.receiveShadow = true; props.add(bl);
        const basket = new T.Mesh(new T.BoxGeometry(0.7, 0.45, 0.5), std(0xb8823f)); basket.position.set(t.blanket[0] + R + 0.6, 0.23, t.blanket[1] - R + 0.6); basket.castShadow = true; props.add(basket);
      }
    }

    // paper planes: a dart (narrow), a glider (broad wings), a stunt (delta with tips turned up)
    const planeGeo = {};
    function geoFor(f) {
      if (planeGeo[f]) return planeGeo[f];
      const W = f === 'glider' ? 0.16 : f === 'stunt' ? 0.12 : 0.07, L = f === 'glider' ? 0.24 : 0.3, tip = f === 'stunt' ? 0.04 : 0;
      const v = [
        // left wing, right wing (nose, tail tip, tail centre), keel
        L / 2, 0, 0, -L / 2, tip, W, -L / 2, 0, 0,
        L / 2, 0, 0, -L / 2, 0, 0, -L / 2, tip, -W,
        L / 2, 0, 0, -L / 2, 0, 0, -L / 2, -0.045, 0,
      ];
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
      g.scale(4.5, 4.5, 4.5);    // drawn larger than life so it shows across a 60 m park
      return (planeGeo[f] = g);
    }
    const paperMat = (col) => new T.MeshStandardMaterial({ color: new T.Color(col).lerp(new T.Color(0xffffff), 0.2), roughness: 0.85, side: T.DoubleSide, emissive: new T.Color(col), emissiveIntensity: 0.18 });
    const planes = new Map();       // shot id -> { mesh, trail, line }
    function planeFor(sh, col) {
      let p = planes.get(sh.id);
      if (p) return p;
      const mesh = new T.Mesh(geoFor(sh.fold), paperMat(col)); mesh.castShadow = true;
      const pts = sh.path.map((q) => new T.Vector3(q[1], q[2], q[3]));
      const lg = new T.BufferGeometry().setFromPoints(pts);
      const line = new T.Line(lg, new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
      const shadow = new T.Mesh(new T.CircleGeometry(0.35, 12), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })); shadow.rotation.x = -Math.PI / 2;
      scene3.add(mesh, line, shadow);
      p = { mesh, line, shadow, n: pts.length };
      planes.set(sh.id, p);
      return p;
    }
    const pose = (m, x, y, z, dx, dy, dz) => {
      m.position.set(x, y, z);
      const h = Math.hypot(dx, dz);
      m.rotation.set(0, Math.atan2(-dz, dx), 0); m.rotateZ(Math.atan2(dy, h || 1e-6));
    };

    // the aim guide: a dotted start of the flight
    const dotMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    const dots = Array.from({ length: 10 }, () => { const m = new T.Mesh(new T.SphereGeometry(0.06, 6, 4), dotMat); m.visible = false; scene3.add(m); return m; });
    const handPlane = new T.Mesh(geoFor('glider'), paperMat('#ffffff')); handPlane.visible = false; scene3.add(handPlane);

    // landing confetti (little paper squares)
    const bits = [], bitG = new T.PlaneGeometry(0.18, 0.12);
    function confetti(pos, n, col) {
      if (low) n = Math.ceil(n / 2);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(bitG, new T.MeshBasicMaterial({ color: k % 3 ? col : ['#ffd23f', '#ffffff', '#ff6a8a'][k % 3], side: T.DoubleSide }));
        m.position.copy(pos); m.userData = { v: new T.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5), life: 1.4 + Math.random() * 0.6, s: Math.random() * 6 };
        scene3.add(m); bits.push(m);
      }
    }

    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    let lastT = 0, moving = 0;
    const cam = { pos: new T.Vector3(-7, 4.5, 0), look: new T.Vector3(18, 0, 0), init: false, follow: null, hold: 0 };

    function draw(now, sc, idle) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      grills(sc.vents); challenge(sc);
      // the windsock swings round to the wind and fills with it
      const [wx, wz] = sc.wind, wsp = Math.hypot(wx, wz);
      sockPivot.rotation.y = Math.atan2(-wz, wx) + Math.sin(now / 400) * 0.06 * Math.min(1, wsp);
      sockPivot.rotation.z = -1.35 + Math.min(1.3, wsp / 3.5) + Math.sin(now / 230) * 0.04;
      // grills: motes drift up the warm air
      for (const m of motes) { const u = m.userData; u.h = (u.h + dt * 1.6) % 8.5; u.a += dt * 0.7; m.position.set(Math.cos(u.a) * u.r, 1 + u.h, Math.sin(u.a) * u.r); m.material.opacity = 0.6 * (1 - u.h / 8.5); }
      // planes: in the air ones fly their path; landed ones lie in the grass where they came down
      const live = new Set();
      for (const f of sc.fly) {
        const p = planeFor(f.shot, f.color); live.add(f.shot.id);
        const [x, y, z, dx, dy, dz] = at(f.shot.path, f.tp);
        pose(p.mesh, x, y + 0.05, z, dx, dy, dz);
        // the stunt rolls a little as it banks; everyone wobbles in the air
        p.mesh.rotateX((f.shot.fold === 'stunt' ? -0.5 : 0) + Math.sin(now / 120 + f.shot.id) * 0.08);
        let k = 1; while (k < f.shot.path.length && f.shot.path[k][0] <= f.tp) k++;
        p.line.geometry.setDrawRange(0, k); p.line.visible = true; p.line.material.opacity = f.me ? 0.95 : 0.6;
        p.shadow.visible = true; p.shadow.position.set(x, 0.03, z); p.shadow.scale.setScalar(1 + y * 0.12); p.shadow.material.opacity = Math.max(0.06, 0.3 - y * 0.02);
      }
      for (const f of sc.landed) {
        const p = planeFor(f.shot, f.color); live.add(f.shot.id);
        const path = f.shot.path, a = path[Math.max(0, path.length - 2)], b = path[path.length - 1];
        pose(p.mesh, b[1], 0.04, b[3], b[1] - a[1], 0, b[3] - a[3]);
        p.mesh.rotateX(0.25);
        p.line.geometry.setDrawRange(0, p.n); p.line.visible = !low; p.line.material.opacity = 0.25;
        p.shadow.visible = false;
      }
      for (const [id, p] of planes) if (!live.has(id)) { scene3.remove(p.mesh, p.line, p.shadow); p.line.geometry.dispose(); p.line.material.dispose(); p.mesh.material.dispose(); p.shadow.geometry.dispose(); p.shadow.material.dispose(); planes.delete(id); }
      // the aim guide and a plane in your hand
      const pv = sc.preview;
      dots.forEach((d, k) => { d.visible = !!pv && k < pv.length; if (d.visible) d.position.set(...pv[k]); });
      dotMat.opacity = sc.swiping ? 0.95 : 0.6;
      handPlane.visible = !!pv;
      if (pv) { handPlane.geometry = geoFor(sc.fold); handPlane.material.color.set(new T.Color(sc.myColor).lerp(new T.Color(0xffffff), 0.2)); handPlane.material.emissive.set(sc.myColor); const q = pv[1] || [1, V.geo.h0, 0]; pose(handPlane, 0.2, V.geo.h0, 0, q[0] - 0.2, q[1] - V.geo.h0, q[2]); }
      for (let k = bits.length - 1; k >= 0; k--) {
        const m = bits[k], u = m.userData;
        u.life -= dt; u.v.y -= 6 * dt; u.v.multiplyScalar(0.97);
        m.position.addScaledVector(u.v, dt); if (m.position.y < 0.03) { m.position.y = 0.03; u.v.set(0, 0, 0); }
        m.rotation.set(u.s + now / 200, u.s * 2 + now / 260, 0);
        if (u.life <= 0) { scene3.remove(m); m.material.dispose(); bits.splice(k, 1); }
      }
      // the camera: behind the stand looking down the park; it chases your own plane while it flies
      const mineFly = sc.fly.find((f) => f.me);
      let want, look;
      if (mineFly) {
        const [x, y, z, dx, , dz] = at(mineFly.shot.path, mineFly.tp), h = Math.hypot(dx, dz) || 1;
        want = new T.Vector3(x - (dx / h) * 6, Math.max(1.5, y + 2.2), z - (dz / h) * 6);
        look = new T.Vector3(x + (dx / h) * 4, y * 0.7, z + (dz / h) * 4);
        cam.hold = now + 1300; cam.last = [want.clone(), look.clone()];
      } else if (cam.last && now < cam.hold) { [want, look] = cam.last; }
      else {
        const far = sc.goal === 'far' || sc.goal === 'air' ? 26 : sc.targets.hoop ? sc.targets.hoop[0] : sc.targets.blanket ? sc.targets.blanket[0] : 12;
        want = new T.Vector3(-7, 4.2, 0); look = new T.Vector3(far, 0.5, pv && sc.swiping ? yaw / 30 * 6 : 0);
      }
      const fov = Math.max(52, Math.min(80, 2 * Math.atan(Math.tan(52 * Math.PI / 360) / Math.min(1, camera.aspect / 1.1)) * 180 / Math.PI));
      const k = cam.init ? 1 - Math.exp(-dt * (mineFly ? 6 : 2.5)) : 1; cam.init = true;
      cam.pos.lerp(want, k); cam.look.lerp(look, k);
      moving = cam.pos.distanceTo(want) > 0.02 || bits.length || motes.length ? 1 : 0;
      camera.position.copy(cam.pos);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      stg.follow(camera);
      if (idle && renderer.renderStill) renderer.renderStill(scene3, camera); else renderer.render(scene3, camera);
    }

    return {
      draw, resize, moving: () => moving,
      impact(sh, col, me) {
        const p = new T.Vector3(sh.land[0], 0.3, sh.land[1]);
        const big = (V.goal === 'hoop' && sh.hoop) || (V.goal === 'blanket' && sh.pts >= 35) || (V.goal === 'rings' && sh.pts >= 60) || (V.goal === 'far' && sh.pts >= 40) || (V.goal === 'air' && sh.air >= 7);
        if (big) { confetti(p, 40, col); if (me) GL3.shake(camera, 0.08); } else if (me && sh.pts) confetti(p, 10, col);
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the park from above, downrange up the screen
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the park.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, sparks = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    function draw(now, sc) {
      // world: x 0..56 up the screen, z -16..16 across (+z to the right)
      const k = Math.min(w / 34, (h - 90) / 58), cx = w / 2, by = h - 20;
      const X = (z) => cx + z * k, Y = (x) => by - (x + 1) * k;
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#5e9a3c' : '#6aa845'; g.fillRect(0, Y(i * 5 + 4), w, 5 * k + 1); }
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; g.fillStyle = '#fff'; g.font = '11px system-ui'; g.textAlign = 'left';
      for (let m = 10; m <= 50; m += 10) { g.beginPath(); g.moveTo(0, Y(m)); g.lineTo(w, Y(m)); g.stroke(); g.fillText(`${m} m`, 4, Y(m) - 3); }
      for (const [x, z] of sc.vents) { const r = g.createRadialGradient(X(z), Y(x), 0, X(z), Y(x), sc.geo.ventR * k); r.addColorStop(0, '#ff8a3acc'); r.addColorStop(1, '#ff8a3a00'); g.fillStyle = r; g.beginPath(); g.arc(X(z), Y(x), sc.geo.ventR * k, 0, 7); g.fill(); g.font = '14px system-ui'; g.textAlign = 'center'; g.fillText('🔥', X(z), Y(x) + 5); }
      const t = sc.targets;
      if (t.blanket) { [...sc.geo.blanket].reverse().forEach((r, i) => { g.beginPath(); g.arc(X(t.blanket[1]), Y(t.blanket[0]), r * k, 0, 7); g.fillStyle = ['#f4efe4', '#d8342f', '#f4efe4', '#ffd23f'][i]; g.fill(); }); }
      const gate = (x, z, r, c) => { g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); g.moveTo(X(z - r), Y(x)); g.lineTo(X(z + r), Y(x)); g.stroke(); };
      if (t.hoop) gate(t.hoop[0], t.hoop[2], sc.geo.hoopR, '#ffb21a');
      if (t.rings) t.rings.forEach(([x, , z], i) => gate(x, z, sc.geo.ringR, ['#ff5a8a', '#5ac8ff', '#ffd23f'][i % 3]));
      // the wind arrow
      const [wx, wz] = sc.wind, sp = Math.hypot(wx, wz);
      if (sp > 0.3) { const ax = w - 34, ay = 92, L = 10 + sp * 4, ux = wz / sp, uy = -wx / sp; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(ax - ux * L, ay - uy * L); g.lineTo(ax + ux * L, ay + uy * L); g.stroke(); g.beginPath(); g.arc(ax + ux * L, ay + uy * L, 4, 0, 7); g.fillStyle = '#fff'; g.fill(); }
      const tri = (x, z, dx, dz, s, c) => { g.save(); g.translate(X(z), Y(x)); g.rotate(Math.atan2(dz, dx)); g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.6, s * 0.7); g.lineTo(-s * 0.6, s * 0.7); g.closePath(); g.fillStyle = c; g.fill(); g.strokeStyle = '#000a'; g.lineWidth = 1; g.stroke(); g.restore(); };
      const trace = (path, upto, c, a) => { g.globalAlpha = a; g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); path.forEach((q, i) => { if (q[0] > upto) return; i ? g.lineTo(X(q[3]), Y(q[1])) : g.moveTo(X(q[3]), Y(q[1])); }); g.stroke(); g.globalAlpha = 1; };
      for (const f of sc.landed) { const p = f.shot.path, b = p[p.length - 1], a = p[Math.max(0, p.length - 2)]; trace(p, 99, f.color, 0.3); tri(b[1], b[3], b[1] - a[1], b[3] - a[3], 6, f.color); }
      for (const f of sc.fly) {
        const [x, y, z, dx, , dz] = at(f.shot.path, f.tp);
        trace(f.shot.path, f.tp, f.color, 0.9);
        g.beginPath(); g.arc(X(z), Y(x), 3 + y * 0.5, 0, 7); g.fillStyle = '#0003'; g.fill();
        tri(x, z, dx, dz, 7 + y * 0.6, f.color);
      }
      if (sc.preview) { g.fillStyle = '#fff'; for (const [x, , z] of sc.preview) { g.beginPath(); g.arc(X(z), Y(x), 2.5, 0, 7); g.fill(); } }
      sparks = sparks.filter((s) => now < s.t + 700);
      for (const s of sparks) { const u = (now - s.t) / 700; g.beginPath(); g.arc(X(s.z), Y(s.x), 6 + u * 40, 0, 7); g.lineWidth = 4 * (1 - u); g.strokeStyle = s.c; g.stroke(); }
      g.lineWidth = 1;
    }
    return {
      draw, resize, moving: () => sparks.length > 0,
      impact(sh, col) { if (sh.pts) sparks.push({ x: sh.land[0], z: sh.land[1], t: performance.now(), c: col }); },
      dispose() { canvas.remove(); },
    };
  }

  const turnText = (s) => (s.phase === 'playing' && s.planes ? `✈️ Round ${s.planes.round} of ${s.planes.rounds} · ${s.planes.goalName}` : null);
  const myMove = (s) => s.phase === 'playing' && s.planes?.stage === 'play' && !!s.planes.me && (s.planes.fliers[s.planes.me]?.left ?? 0) > 0;
  return { mount, unmount, render, turnText, myMove, focus: true };
})();
