// Midway Night: a carnival booth in 3D (three.js) or flat. Everyone throws at once in their own copy of the booth.
// Skee Roll and Basketball use drag-to-aim and hold-to-release controls.
// The server decides where each throw lands; the page plays it out.
UI.midway = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null;
  let anims = [], seen = new Set(), watchId = null, watchKey = '', lastV = null, goAt = 0, endAt = 0;
  let charge, cancelCharge, heldBall = false, pendingShot = null;
  let aim = 0, power = 0.5, swipe = null, lastThrow = 0, popT = 0, lastDraw = 0, lastTick = 0, fallAt = [];
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ICON = { skee: '🎳', rings: '⭕', cans: '🥫', hoops: '🏀' };
  const SKEE_FACE = '#123b42';
  const SKEE_RINGS = ['#fff0c5', '#d8a964', '#cb7157', '#a3c7b7', '#487d79'];
  const nameOf = (pid) => ctx?.player(pid)?.name ?? '?';
  const colorOf = (pid) => ctx?.player(pid)?.color ?? '#ccc';
  const watched = () => V?.booths?.[watchId];
  const left = () => V?.me ? V.booths[V.me]?.left ?? 0 : 0;
  const holdToThrow = () => V?.kind === 'skee' || V?.kind === 'hoops';
  const hoopRackSize = 3;
  const hoopRackCount = () => Math.max(0, hoopRackSize - Number(heldBall) - Number(!!pendingShot)
    - anims.filter((a) => a.trajectory && !a.returned).length);
  const canPlay = () => S?.phase === 'playing' && V?.stage === 'play' && V.me && left() > 0 && !S.paused;
  const canThrow = () => canPlay() && (V.kind !== 'hoops' || (heldBall && !pendingShot))
    && performance.now() - lastThrow > (V.gap ?? 0.8) * 1000 + 80;

  function mount(main, side) {
    gl = null; flat = null; anims = []; seen = new Set(); watchId = null; watchKey = ''; lastV = null; goAt = endAt = 0;
    aim = 0; power = 0.5; swipe = null; lastThrow = 0; fallAt = []; heldBall = false; pendingShot = null;
    main.innerHTML = `<div class="mw"><div class="mw-stage" id="mwStage">
        <div class="mw-hud"><span id="mwBooth"></span><span id="mwScore" class="mw-score"></span><span id="mwClock" class="mw-clock"></span></div>
        <div class="mw-sub"><span id="mwBalls" class="mw-balls"></span><span id="mwHot" class="mw-hot" hidden>🔥 ×2</span><span id="mwJack" class="mw-jack"></span></div>
        <div class="mw-watch" id="mwWatch" hidden></div>
        <div class="mw-count" id="mwCount" hidden></div>
        <div class="mw-pop" id="mwPop" hidden></div>
        <div class="mw-done" id="mwDone" hidden><h3 id="mwDoneTitle"></h3><div id="mwStand"></div></div>
      </div>
      <div class="mw-ctl" id="mwCtl">
        <button data-a="-1" aria-label="Aim left">◀</button>
        <div class="mw-meter" title="Power"><i id="mwPow"></i></div>
        <button data-a="1" aria-label="Aim right">▶</button>
        <button data-p="-1" aria-label="Less power">▼</button><button data-p="1" aria-label="More power">▲</button>
        <button id="mwPickup" hidden>Pick up ball</button>
        <button class="mw-go" id="mwGo">🎯 Throw</button>
      </div>
      <p id="mwHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🎟 Tickets</h3><div id="mwRace" class="mw-race"></div><div id="mwFeed" class="mw-feed"></div></div>';
    $('mwCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'mwGo') { if (!holdToThrow()) fire(); return; }
      if (b.id === 'mwPickup') {
        if (V?.kind === 'hoops' && canPlay() && !heldBall && !pendingShot && hoopRackCount() > 0) {
          heldBall = true;
          power = 0;
          controls();
        }
        return;
      }
      if (charge) return;
      if (b.dataset.a) aim = clamp(aim + 0.08 * b.dataset.a, -1, 1);
      if (b.dataset.p) power = clamp(power + 0.04 * b.dataset.p, 0, 1);
      meter();
    });
    $('mwRace').addEventListener('click', (e) => {
      const row = e.target.closest('[data-pid]');
      if (row && (!V?.me || left() === 0 || V.stage !== 'play')) { watchId = row.dataset.pid; resync(); render(S, ctx); }
    });
    const roll = $('mwGo');
    function finishCharge(e, release = false) {
      if (!charge || (e && e.pointerId !== charge.id)) return;
      const { id, start } = charge;
      charge = null;
      if (id != null && roll.hasPointerCapture?.(id)) roll.releasePointerCapture(id);
      power = release ? clamp((performance.now() - start) / 1000, 0, 1) : 0;
      meter();
      if (release) fire();
    }
    cancelCharge = () => finishCharge();
    roll.addEventListener('pointerdown', (e) => {
      if (!holdToThrow() || !canThrow() || charge || swipe || e.button !== 0) return;
      try { roll.setPointerCapture(e.pointerId); } catch {}
      charge = { id: e.pointerId, start: performance.now() };
      power = 0;
      meter();
    });
    const chargeKey = (e) => e.key === ' ' || e.key === 'Enter';
    roll.addEventListener('keydown', (e) => {
      if (!holdToThrow() || !chargeKey(e)) return;
      e.preventDefault();
      if (!e.repeat && canThrow() && !charge && !swipe) {
        charge = { id: null, start: performance.now() };
        power = 0;
        meter();
      }
    });
    roll.addEventListener('keyup', (e) => {
      if (!holdToThrow() || !chargeKey(e)) return;
      e.preventDefault();
      if (charge?.id === null) finishCharge(null, true);
    });
    roll.addEventListener('blur', () => { if (charge?.id === null) finishCharge(); });
    roll.addEventListener('pointerup', (e) => finishCharge(e, true));
    roll.addEventListener('pointercancel', finishCharge);
    roll.addEventListener('lostpointercapture', finishCharge);
    window.addEventListener('blur', cancelCharge);
    const stage = $('mwStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!(V?.kind === 'hoops' ? canPlay() : canThrow()) || charge || swipe || e.target.closest('button, .mw-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, a: aim, p: power, t: performance.now() };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const r = stage.getBoundingClientRect(), dx = e.clientX - swipe.x, dy = swipe.y - e.clientY;
      if (holdToThrow()) {
        aim = clamp(swipe.a + dx / Math.max(80, r.width * 0.38), -1, 1);
        return;
      }
      aim = clamp(dx / Math.max(80, r.width * 0.38), -1, 1);
      power = clamp(dy / Math.max(120, r.height * 0.62), 0, 1);
      swipe.moved = Math.max(swipe.moved || 0, dy);
      meter();
    });
    stage.addEventListener('pointerup', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      if (holdToThrow()) { swipe = null; return; }
      const ok = (swipe.moved || 0) > 24;
      if (!ok) { aim = swipe.a; power = swipe.p; }
      swipe = null; meter();
      if (ok) fire();
    });
    stage.addEventListener('pointercancel', () => { if (swipe) { aim = swipe.a; power = swipe.p; } swipe = null; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelCharge?.();
    window.removeEventListener('blur', cancelCharge); cancelCharge = null;
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; swipe = null;
    window.Snd?.bed('mw.crowd').set(0);
  }

  // ---------- sound: the shared Snd kit (static/sfx.js) out on a fairground at night
  const AT = { room: 'outdoor', send: 0.35 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...AT, pan, vol })));
  const SND = {
    // a wooden ball trundling up the lane, then the hop
    roll: () => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 260, f1: 420, q: 0.8, vol: 0.22, tau: 0.5, dur: 0.9, attack: 0.05, buf: 'brown' }); K.mode(d, t + 0.95, 180, 0.12, 0.05); }),
    // a ball dropping into its ring, a clunk and a little rattle
    sink: (big) => snd((t, K, d) => { K.mode(d, t, 140, 0.25, 0.06, { f1: 100 }); K.burst(d, t, { type: 'bandpass', f: 1200, q: 1.5, vol: 0.12, tau: 0.02 }); for (let n = 1; n < 4; n++) K.mode(d, t + n * 0.07, 220 + n * 30, 0.06 / n, 0.03); if (big) [1047, 1319, 1568].forEach((f, n) => K.mode(d, t + 0.1 + n * 0.08, f, 0.06, 0.2)); }),
    // a ring on glass: a bright clink, ringing on a bottle
    clink: (on) => snd((t, K, d) => { K.mode(d, t, K.R(2400, 2900), 0.12, on ? 0.35 : 0.08); K.mode(d, t, K.R(3600, 4200), 0.05, 0.12); if (on) K.mode(d, t + 0.05, 1600, 0.06, 0.4); }),
    // a ring landing on the table
    tap: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 900, q: 1.2, vol: 0.16, tau: 0.02 }); K.mode(d, t, 300, 0.05, 0.03); }),
    // a ball into a tin pyramid: the smack, then cans clattering for each that falls
    clatter: (n) => snd((t, K, d) => {
      K.burst(d, t, { type: 'bandpass', f: 1800, q: 0.9, vol: 0.35, tau: 0.03 }); K.mode(d, t, 520, 0.12, 0.08);
      for (let k = 0; k < n * 2; k++) { const s = t + 0.05 + K.R(0, 0.5); K.mode(d, s, K.R(700, 1500), 0.05, 0.05); K.burst(d, s, { type: 'bandpass', f: K.R(2000, 4000), q: 2, vol: 0.06, tau: 0.015 }); }
    }),
    // a ball into the canvas backdrop
    flop: () => snd((t, K, d) => K.burst(d, t, { type: 'lowpass', f: 500, q: 0.7, vol: 0.25, tau: 0.05, buf: 'brown' })),
    // the bell that opens a booth
    bell: () => snd((t, K, d) => { for (let n = 0; n < 3; n++) { K.mode(d, t + n * 0.12, 1760, 0.1, 0.3); K.mode(d, t + n * 0.12, 2640, 0.04, 0.2); } }),
  };
  // the fairground behind you: a soft crowd murmur
  const crowdBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), bp = A.createBiquadFilter(), g = A.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.5; g.gain.value = 0;
    src.connect(bp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.035 * l, A.currentTime, 0.8); }, stop() { try { src.stop(); } catch {} } };
  };

  function fire() {
    if (!canThrow()) return;
    lastThrow = performance.now();
    ctx.sfx?.('whoosh'); ctx.buzz?.(12);
    const request = ctx.act('throw', { aim: +aim.toFixed(3), power: +power.toFixed(3) });
    if (V.kind === 'hoops') {
      heldBall = false;
      const pending = pendingShot = { left: left() };
      ctx.quiet(request.catch(() => {
        if (pendingShot !== pending) return;
        pendingShot = null;
        heldBall = true;
        controls();
      }));
    } else ctx.quiet(request);
    controls();
  }

  // ---------- state
  function resync() {
    // a new booth (or a different one to watch): what's already happened isn't replayed
    const b = watched();
    seen = new Set((b?.shots || []).map((s) => s.id));
    anims = [];
    heldBall = false; pendingShot = null;
    fallAt = (b?.cans || []).map((up) => (up ? null : -1e9));
  }

  function render(s, c) {
    S = s; ctx = c; V = s.midway;
    const now = performance.now();
    if (V !== lastV) {
      lastV = V;
      goAt = V.stage === 'count' ? now + V.startIn * 1000 : 0;
      endAt = V.stage === 'play' || V.stage === 'settle' ? now + V.timeLeft * 1000 : 0;
    }
    if (!V.booths[watchId] || (V.me && watchId !== V.me && left() > 0 && V.stage === 'play')) watchId = V.me ?? V.seats[0];
    const key = `${V.round}:${watchId}`;
    if (key !== watchKey) { cancelCharge?.(); swipe = null; watchKey = key; resync(); aim = 0; power = 0.5; }
    const b = watched();
    if (pendingShot && left() < pendingShot.left) pendingShot = null;
    let stagger = 0;
    for (const sh of b?.shots || []) {
      if (seen.has(sh.id)) continue;
      seen.add(sh.id);
      const trajectory = sh.k === 'hoops' ? basketballTrajectory(sh) : null;
      anims.push({ shot: sh, t0: now + stagger, hit: false, trajectory });
      stagger += 120;
      if (sh.k === 'skee') SND.roll();
    }
    hud(); controls(); race(); feed(); done(); hint();
  }

  function hud() {
    const b = watched();
    $('mwBooth').textContent = `${ICON[V.kind]} ${V.name.replace(/^\S+ /, '')} · ${V.round}/${V.rounds}`;
    const n = b?.left ?? 0;
    $('mwBalls').textContent = '●'.repeat(n) + '○'.repeat(Math.max(0, V.throws - n));
    $('mwHot').hidden = !(b && b.streak >= V.hotAt);
    $('mwJack').textContent = V.jackBy ? `🔔 ${V.jackBy} got the jackpot` : '🔔 Jackpot up!';
    $('mwJack').classList.toggle('taken', !!V.jackBy);
    const w = $('mwWatch');
    w.hidden = !watchId || watchId === V.me;
    if (!w.hidden) { w.textContent = `👀 Watching ${nameOf(watchId)}`; w.style.color = colorOf(watchId); }
  }

  function meter() {
    const percent = `${Math.round(power * 100)}%`;
    const fill = $('mwPow');
    if (fill) fill.style.height = percent;
    const button = $('mwGo');
    if (!button) return;
    const basketball = V?.kind === 'hoops';
    const label = holdToThrow()
      ? `${charge ? 'Release to' : 'Hold to'} ${basketball ? 'shoot' : 'roll'}`
      : '🎯 Throw';
    if (button.textContent !== label) button.textContent = label;
    button.classList.toggle('mw-charging', !!charge);
    if (charge) button.style.setProperty('--mw-charge', percent);
  }

  function controls() {
    if (!V) return;
    const go = canThrow();
    if (!go) cancelCharge?.();
    $('mwCtl').classList.toggle('mw-hold', holdToThrow());
    const pickup = $('mwPickup');
    pickup.hidden = V.kind !== 'hoops';
    if (!pickup.hidden) {
      const available = hoopRackCount();
      pickup.disabled = !canPlay() || heldBall || !!pendingShot || available === 0;
      const label = heldBall ? 'Ball in hand' : available ? `Pick up ball (${available})` : 'Waiting for a ball';
      if (pickup.textContent !== label) pickup.textContent = label;
    }
    $('mwGo').disabled = !go;
    $('mwGo').classList.toggle('mw-ready', go);
    $('mwCtl').classList.toggle('mw-off', !(V.me && left() > 0 && V.stage !== 'between'));
    meter();
  }

  function race() {
    const box = $('mwRace'); box.innerHTML = '';
    const rows = V.seats.map((pid) => ({ pid, ...V.booths[pid] })).sort((a, b) => b.tickets - a.tickets);
    const top = Math.max(1, ...rows.map((r) => r.tickets));
    for (const r of rows) {
      const row = ctx.el('div', 'mw-row' + (r.pid === watchId ? ' on' : '') + (r.out ? ' out' : ''));
      row.dataset.pid = r.pid;
      const nm = ctx.el('span', 'mw-nm', nameOf(r.pid)); nm.style.color = colorOf(r.pid);
      const bar = ctx.el('span', 'mw-bar'); const fill = ctx.el('i'); fill.style.width = `${(100 * r.tickets / top).toFixed(1)}%`; fill.style.background = colorOf(r.pid); bar.append(fill);
      const t = ctx.el('b', '', `${r.tickets}`);
      const extra = ctx.el('small', '', `${r.left ? '●'.repeat(r.left) : '✓'}${r.streak >= V.hotAt ? ' 🔥' : ''}${r.jackpots ? ' 🔔'.repeat(r.jackpots) : ''}`);
      row.append(nm, bar, t, extra);
      box.append(row);
    }
  }

  function feed() {
    const box = $('mwFeed'); box.innerHTML = '';
    const all = [];
    for (const pid of V.seats) for (const s of V.booths[pid]?.shots || []) all.push({ pid, s });
    all.sort((a, b) => b.s.id - a.s.id);
    for (const { pid, s } of all.slice(0, 6)) {
      const row = ctx.el('div', 'mw-f' + (s.jack ? ' gold' : ''));
      const nm = ctx.el('b', '', nameOf(pid)); nm.style.color = colorOf(pid);
      row.append(nm, ctx.el('span', '', ` ${s.pts ? `+${s.pts}` : 'miss'}${s.hot ? ' 🔥' : ''}${s.jack ? ' 🔔' : ''}${s.sweep ? ' 🥫' : ''}`));
      box.append(row);
    }
  }

  function done() {
    const show = V.stage === 'between' && !!V.standings;
    $('mwDone').hidden = !show;
    if (!show) return;
    $('mwDoneTitle').textContent = `🏁 ${V.name} done`;
    standingsCard($('mwStand'), V.standings, { title: '🎟 Tickets', note: V.round < V.rounds ? `Next booth: ${ICON[V.order[V.round]]} in a moment…` : 'The last booth: the prize counter awaits!' });
  }

  function hint() {
    const t = S.phase !== 'playing' ? '' : V.stage === 'count' ? 'Get ready…'
      : V.stage === 'between' ? '' : !V.me ? 'Tap a name to watch their booth.'
        : left() === 0 ? 'Out of throws: tap a name to watch a rival.'
          : { skee: 'Drag sideways to aim. Hold to charge, then release to roll. The corner cups pay 100.',
              rings: 'Swipe up to toss: a longer swipe reaches the back rows. Red bottles pay 80.',
              hoops: 'Pick up a ball, drag sideways to aim, then hold Shoot and release. Hold longer for higher hoops.',
              cans: 'Swipe up to throw: a longer swipe throws higher. Hit the bottom row and the cans above it fall too.' }[V.kind];
    if ($('mwHint').textContent !== t) $('mwHint').textContent = t;
  }

  function pop(sh) {
    const el = $('mwPop'); if (!el) return;
    const words = sh.k === 'skee' ? (sh.where === 'short' ? 'Short!' : sh.where === 'cup' ? (sh.rattle ? '🏆 RATTLED IN!' : '🏆 CUP!') : (sh.rattle ? 'Rattled!' : ''))
      : sh.k === 'hoops' ? (sh.hoop == null ? 'Miss' : '🏀 Basket!')
        : sh.k === 'rings' ? (sh.b == null ? 'Miss' : 'RINGER!') : (sh.fell.length ? `${sh.fell.length} can${sh.fell.length > 1 ? 's' : ''}` : 'Miss');
    el.textContent = `${words}${sh.pts ? ` +${sh.pts}` : ''}${sh.hot ? ' 🔥' : ''}${sh.jack ? '  🔔 JACKPOT' : ''}${sh.sweep ? '  🥫 SWEEP' : ''}`.trim();
    el.style.color = sh.jack ? '#ffd23f' : sh.pts ? '#fff' : '#ff9a9a';
    el.hidden = false; el.classList.remove('mw-pop-in'); void el.offsetWidth; el.classList.add('mw-pop-in');
    popT = performance.now() + 1300;
  }

  // the moment a throw lands, for the watched booth
  function land(a, now) {
    const sh = a.shot, mine = watchId === V.me;
    if (sh.k === 'skee') SND.sink(sh.pts >= 50);
    else if (sh.k === 'rings') sh.b != null ? SND.clink(true) : SND.tap();
    else if (sh.k === 'hoops') sh.hoop == null ? SND.flop() : SND.clink(true);
    else if (sh.fell.length) {
      SND.clatter(sh.fell.length);
      for (const i of sh.fell) if (fallAt[i] == null || fallAt[i] < 0) fallAt[i] = now + Math.random() * 140;
      if (sh.sweep) a.restack = now + 1100;
    } else SND.flop();
    if (mine) ctx.buzz?.(sh.jack ? [40, 30, 60] : sh.pts ? 25 : 8);
    pop(sh);
    (gl || flat)?.impact?.(sh);
  }

  // where a throw with this aim and power lands on the booth, no wobble (the server's map, from geo)
  const spot = (a, p) => { const m = V.geo.map; return { x: a * m[0], y: p * m[1] + m[2] }; };

  function scene(now) {
    const b = watched();
    const fly = [], basketballs = [];
    for (const a of anims) {
      const u = Math.max(0, (now - a.t0) / 1000 / a.shot.t);
      if (a.trajectory) {
        if (!a.returned && now >= a.t0) basketballs.push(basketballSample(a.trajectory, (now - a.t0) / 1000));
      } else fly.push({ shot: a.shot, u: Math.min(1, u), landU: HIT[a.shot.k] });
    }
    const pending = new Set(anims.filter((a) => !a.hit).map((a) => a.shot.id));
    const preview = canThrow() || swipe ? spot(aim, power) : null;
    if (V.kind === 'hoops') {
      for (let i = 0; i < hoopRackCount(); i++) {
        basketballs.push({ x: (i - 1) * 0.15, y: hoopRampY(hoopRackZ), z: hoopRackZ, spin: 0 });
      }
      if (heldBall) basketballs.push({ x: 0, y: 1.17, z: hoopLaunchZ, spin: 0 });
    }
    return {
      kind: V.kind, geo: V.geo, layout: V.layout, jackLive: !V.jackBy && !(V.kind === 'cans' && b?.stacks),
      shots: (b?.shots || []).filter((s) => !pending.has(s.id)), fly, basketballs, fallAt, now, preview, swiping: !!swipe, charging: !!charge, chargePower: charge ? power : 0, left: b?.left ?? 0,
      pts: (b?.pts ?? 0) - (b?.shots || []).filter((s) => pending.has(s.id)).reduce((a, s) => a + s.pts, 0),
      color: colorOf(watchId),
    };
  }
  // the share of a throw's play-out at which it lands
  const HIT = { skee: 0.85, rings: 0.75, cans: 0.55, hoops: 0.73 };

  const hoopStep = 1 / 120;
  const hoopRadius = 0.053;
  const hoopDepth = -2.42;
  const hoopRackZ = -0.86;
  const hoopSlope = 0.24;
  const hoopRampY = (z) => 0.69 + hoopRadius + (hoopRackZ - z) * hoopSlope;
  const hoopLaunchZ = -0.50;
  const hoopShowTime = 1.35;
  const gravity = 9.81;

  function basketballFlight(shot, time, duration) {
    const progress = time / duration;
    return {
      x: shot.x * progress,
      y: 1.17 + (shot.y - 0.17) * progress + gravity * time * (duration - time) / 2,
      z: hoopLaunchZ + (hoopDepth - hoopLaunchZ) * progress,
      spin: time * 9,
    };
  }

  function basketballTrajectory(shot) {
    const flightTime = shot.t * HIT.hoops;
    const frames = [];
    let ball = basketballFlight(shot, flightTime, flightTime);
    let vx = shot.x / flightTime;
    let vy = (shot.y - 0.17) / flightTime - gravity * flightTime / 2;
    let vz = (hoopDepth - hoopLaunchZ) / flightTime;
    // The net slows a basket. A miss keeps its momentum until it reaches the rear panel.
    if (shot.hoop != null) { vx *= 0.25; vy *= 0.65; vz *= 0.20; }
    const back = -2.57 + hoopRadius;
    const normalLength = Math.hypot(1, hoopSlope);
    for (let i = 0; i <= 480; i++) {
      const time = i * hoopStep;
      if (time <= flightTime) {
        frames.push(basketballFlight(shot, time, flightTime));
        continue;
      }

      const dt = Math.min(hoopStep, time - flightTime);
      vy -= gravity * dt;
      ball = { x: ball.x + vx * dt, y: ball.y + vy * dt, z: ball.z + vz * dt, spin: ball.spin + vz * dt / hoopRadius };
      if (ball.z < back && vz < 0) {
        ball.z = back;
        vz *= -0.65;
      }
      if (Math.abs(ball.x) > 0.76 - hoopRadius) {
        ball.x = Math.sign(ball.x) * (0.76 - hoopRadius);
        vx *= -0.55;
      }
      const ramp = hoopRampY(ball.z);
      if (ball.y < ramp) {
        ball.y = ramp;
        const normalSpeed = (vy + hoopSlope * vz) / normalLength;
        if (normalSpeed < 0) {
          const impulse = -(normalSpeed < -0.40 ? 1.56 : 1) * normalSpeed / normalLength;
          vy += impulse;
          vz += hoopSlope * impulse;
          vx *= 0.94;
          vz *= 0.99;
        }
      }
      frames.push(ball);
      if (ball.z >= hoopRackZ && ball.y <= hoopRampY(hoopRackZ) + 0.10) break;
    }
    return frames;
  }

  function basketballSample(frames, time) {
    const frame = Math.min(time / hoopStep, frames.length - 1);
    const i = Math.floor(frame);
    const a = frames[i], b = frames[i + 1] || a, t = frame - i;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      spin: a.spin + (b.spin - a.spin) * t,
    };
  }

  function loop(now) {
    if (!$('mwStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    let ballReturned = false;
    for (const a of anims) {
      if (!a.hit && now - a.t0 >= a.shot.t * HIT[a.shot.k] * 1000) { a.hit = true; land(a, now); }
      if (a.trajectory && !a.returned && now - a.t0 >= (a.trajectory.length - 1) * hoopStep * 1000) {
        a.returned = true;
        ballReturned = true;
      }
      if (a.restack && now >= a.restack) { a.restack = 0; fallAt = fallAt.map(() => null); }
    }
    anims = anims.filter((a) => a.trajectory ? !a.returned : now - a.t0 < a.shot.t * 1000 + 900 || a.restack);
    if (popT && now > popT) { popT = 0; $('mwPop').hidden = true; }
    // the countdown and the clock
    const cnt = $('mwCount');
    if (V.stage === 'count' && goAt) {
      const s = Math.ceil((goAt - now) / 1000);
      const txt = s > 0 ? String(s) : 'GO!';
      if (cnt.textContent !== txt) { cnt.textContent = txt; if (s > 0) ctx.sfx?.('tick'); else SND.bell(); }
      cnt.hidden = false;
    } else if (!cnt.hidden && !(goAt && now - goAt < 700)) cnt.hidden = true;
    else if (!cnt.hidden && cnt.textContent !== 'GO!') { cnt.textContent = 'GO!'; SND.bell(); }
    const ck = $('mwClock');
    if (endAt && V.stage !== 'between') {
      const s = Math.max(0, Math.ceil((endAt - now) / 1000));
      const txt = `⏱ ${s}`;
      if (ck.textContent !== txt) {
        ck.textContent = txt;
        if (s <= 5 && s > 0 && V.stage === 'play' && left() > 0 && now - lastTick > 500) { lastTick = now; ctx.sfx?.('tickfast'); }
      }
      ck.classList.toggle('low', s <= 5);
    } else ck.textContent = '';
    if (ballReturned || $('mwGo').disabled === canThrow()) controls();
    if (charge) { power = clamp((now - charge.start) / 1000, 0, 1); meter(); }
    window.Snd?.bed('mw.crowd', crowdBed).set(S.phase === 'playing' && !S.paused ? 1 : 0);
    const sc = scene(now);
    const score = $('mwScore');
    const digits = sc.kind === 'hoops' ? `SCORE ${String(sc.pts).padStart(4, '0')}` : '';
    if (score.textContent !== digits) score.textContent = digits;
    const idle = !anims.length && !swipe && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- three.js: you stand at z = 0 looking down -z at the booth; one scene with props for each booth
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 1, 0.05, 200);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.05, hemi: [0xffd9b0, 0x2a1838, 0.55], env: false,
      key: { color: 0xffe2b8, i: 0.95, pos: [1.5, 4.5, 2.5], area: 3, near: 0.5, far: 12, map: 1024 },
      sky: { top: 0x070a24, horizon: 0x3a2350, bottom: 0x1a1020, radius: 90, band: 0.1, stars: true },
    });
    const low = stg.low;
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });
    const glow = (color) => new T.MeshBasicMaterial({ color });

    // the booth: boards underfoot, a counter in front, striped side walls and an awning, string lights
    const planks = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#6b4426'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#74492a' : '#633e22'; g.fillRect(k * w / 8, 0, w / 8 - 2, h); }
      for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(30,15,5,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 6); }
    });
    planks.wrapS = planks.wrapT = T.RepeatWrapping; planks.repeat.set(4, 6);
    const floor = new T.Mesh(new T.PlaneGeometry(8, 12), std(0xffffff, { map: planks }));
    floor.rotation.x = -Math.PI / 2; floor.position.z = -3; floor.receiveShadow = true; scene3.add(floor);
    const stripe = tex(256, 64, (g, w, h) => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#f4efe4' : '#d8342f'; g.fillRect(k * w / 8, 0, w / 8, h); } });
    stripe.wrapS = T.RepeatWrapping;
    const wallMat = std(0xffffff, { map: stripe, side: T.DoubleSide });
    for (const sx of [-1.35, 1.35]) {
      const wall = new T.Mesh(new T.PlaneGeometry(4.6, 2.6), wallMat);
      wall.rotation.y = Math.PI / 2; wall.position.set(sx, 1.3, -2.5); wall.receiveShadow = true; scene3.add(wall);
    }
    const backTex = tex(512, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a1f5c'); gr.addColorStop(1, '#1d1030'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,214,120,.18)'; for (let k = 0; k < 40; k++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.5, 0, 7); g.fill(); }
    });
    const back = new T.Mesh(new T.PlaneGeometry(2.8, 2.8), std(0xffffff, { map: backTex }));
    back.position.set(0, 1.4, -4.8); scene3.add(back);
    const awnTex = tex(256, 64, (g, w, h) => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#fff6dc' : '#e03a3a'; g.fillRect(k * w / 8, 0, w / 8, h); } g.fillStyle = '#ffcf3f'; for (let k = 0; k < 8; k++) { g.beginPath(); g.arc((k + 0.5) * w / 8, h, w / 16, Math.PI, 0); g.fill(); } });
    const awning = new T.Mesh(new T.PlaneGeometry(2.9, 0.7), std(0xffffff, { map: awnTex, side: T.DoubleSide }));
    awning.position.set(0, 2.55, -0.3); awning.rotation.x = 0.55; scene3.add(awning);
    const counter = new T.Mesh(new T.BoxGeometry(2.7, 0.08, 0.35), std(0xb8823f, { roughness: 0.55 }));
    counter.position.set(0, 0.92, 0.05); counter.castShadow = true; counter.receiveShadow = true; scene3.add(counter);
    const front = new T.Mesh(new T.BoxGeometry(2.7, 0.9, 0.05), std(0xc23b32)); front.position.set(0, 0.45, 0.2); scene3.add(front);
    // string lights: bulbs on a sagging wire (each bulb in a soft halo), three runs across the booth
    const bulbs = [], bulbGeo = new T.SphereGeometry(1, 8, 6), BULB = [0xffd27a, 0xff7a7a, 0x8ad8ff, 0xb8ff8a];
    const haloTex = tex(64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.25, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
    const wireMat = new T.LineBasicMaterial({ color: 0x1a1a1a });
    for (const [z, y, n, r] of [[-0.45, 2.3, low ? 9 : 13, 0.018], [-2.5, 2.45, low ? 9 : 14, 0.026], [-4.55, 2.85, low ? 7 : 12, 0.03]]) {
      const sag = (u) => y - 0.2 * Math.sin(Math.PI * u), pts = [];
      for (let k = 0; k <= 24; k++) pts.push(new T.Vector3(-1.32 + 2.64 * k / 24, sag(k / 24) + 0.03, z));
      scene3.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), wireMat));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, col = BULB[k % 4], b = new T.Mesh(bulbGeo, glow(col));
        b.scale.setScalar(r); b.position.set(-1.32 + 2.64 * u, sag(u), z);
        if (!low) { const h = new T.Sprite(new T.SpriteMaterial({ map: haloTex, color: col, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.55 })); h.scale.setScalar(9); b.add(h); }   // the halo is 9× the bulb (it inherits the bulb's scale)
        scene3.add(b); bulbs.push(b);
      }
    }
    if (!low) for (const x of [-0.8, 0.8]) { const L = new T.PointLight(0xffc27a, 0.6, 6, 2); L.position.set(x, 2.1, -1.8); scene3.add(L); }
    // a warm spotlight on whatever you're throwing at (it follows the booth)
    const spot = low ? null : new T.SpotLight(0xfff0d0, 1.1, 8, 0.42, 0.65, 1.4);
    if (spot) { spot.position.set(0, 2.9, -0.6); scene3.add(spot, spot.target); }

    // the prize wall behind every booth: shelves of plush bears in carnival colours
    const prizes = new T.Group(); scene3.add(prizes);
    const shelfMat = std(0x8a5a32, { roughness: 0.6 }), PLUSH = [0xff8fb1, 0x8fd3ff, 0xffd166, 0xb48cff, 0x7ee0a1, 0xff9f6b, 0xf4efe4];
    const bodyG = new T.SphereGeometry(0.085, 14, 10), headG = new T.SphereGeometry(0.06, 14, 10), earG = new T.SphereGeometry(0.024, 8, 6), noseG = new T.SphereGeometry(0.026, 8, 6), eyeG = new T.SphereGeometry(0.009, 6, 4);
    const eyeMat = std(0x111111, { roughness: 0.3 }), plushMats = PLUSH.map((c) => std(c, { roughness: 0.95 })), snout = std(0xfff3e0, { roughness: 0.95 });
    function bear(m, s) {
      const g = new T.Group(), body = new T.Mesh(bodyG, m); body.scale.y = 1.1; body.position.y = 0.085; body.castShadow = !low; g.add(body);
      const head = new T.Mesh(headG, m); head.position.y = 0.21; g.add(head);
      for (const sx of [-1, 1]) { const e = new T.Mesh(earG, m); e.position.set(sx * 0.045, 0.26, -0.005); g.add(e); const eye = new T.Mesh(eyeG, eyeMat); eye.position.set(sx * 0.021, 0.225, 0.053); g.add(eye); }
      const n = new T.Mesh(noseG, snout); n.position.set(0, 0.2, 0.052); n.scale.z = 0.7; g.add(n);
      g.scale.setScalar(s); return g;
    }
    for (const [y, n] of [[1.45, low ? 4 : 7], [1.95, low ? 4 : 8], [2.45, low ? 3 : 7]]) {
      const sh = new T.Mesh(new T.BoxGeometry(2.5, 0.04, 0.22), shelfMat); sh.position.set(0, y, -4.68); sh.receiveShadow = true; prizes.add(sh);
      for (let k = 0; k < n; k++) {
        const b = bear(plushMats[(k * 3 + Math.round(y * 10)) % PLUSH.length], 0.85 + ((k * 7 + y * 13) % 5) * 0.08);
        b.position.set(-1.12 + 2.24 * (k + 0.5) / n, y + 0.02, -4.66); b.rotation.y = ((k * 5) % 7 - 3) * 0.12; prizes.add(b);
      }
    }
    // a lit marquee over each booth: its name in gold, a border of bulbs
    function marquee(text, w, h, background = '#5a0f1e', lettering = '#ffe066') {
      const t = tex(512, Math.round(512 * h / w), (g, W, H) => {
        g.fillStyle = background; g.fillRect(0, 0, W, H);
        g.strokeStyle = lettering; g.lineWidth = 6; g.strokeRect(10, 10, W - 20, H - 20);
        const n = 22; g.fillStyle = '#fff2b0';
        for (let k = 0; k < n; k++) { const x = 10 + (W - 20) * k / (n - 1); for (const yy of [10, H - 10]) { g.beginPath(); g.arc(x, yy, 5, 0, 7); g.fill(); } }
        g.font = `800 ${Math.round(H * 0.5)}px "Baloo 2", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = '#ff9a2a'; g.shadowBlur = 18; g.fillStyle = lettering; g.fillText(text, W / 2, H / 2 + 3);
      });
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t })); return m;
    }

    // 🎳 Skee Roll: an inclined lane up to a tilted ring board. Board coordinates (bx, by) are local x, y of `board`.
    const skee = new T.Group(); scene3.add(skee);
    const laneFront = -0.1, laneLip = -3.15, ballRadius = 0.045;
    const laneHeight = (z) => {
      const t = clamp((laneFront - z) / (laneFront - laneLip), 0, 1);
      return 0.975 + 0.1 * t + 0.08 * (Math.max(0, t - 0.82) / 0.18) ** 2;
    };
    const maple = tex(256, 512, (g, w, h) => {
      const boards = ['#c99860', '#d7ac75', '#dfb883', '#d0a06b', '#d9b17d'];
      for (const [i, color] of boards.entries()) {
        const x = i * w / boards.length;
        g.fillStyle = color;
        g.fillRect(x, 0, w / boards.length + 1, h);
        g.fillStyle = '#5b301b35';
        g.fillRect(x, 0, 1, h);
      }
      for (let i = 0; i < 260; i++) {
        const x = (i * 97.37) % w, y = (i * 53.21) % h;
        g.fillStyle = i % 2 ? '#63391e21' : '#fff2cd42';
        g.fillRect(x, y, 0.5 + i % 2, 18 + i % 83);
      }
      const shade = g.createLinearGradient(0, 0, w, 0);
      shade.addColorStop(0, '#30180965');
      shade.addColorStop(0.22, '#30180900');
      shade.addColorStop(0.78, '#30180900');
      shade.addColorStop(1, '#30180965');
      g.fillStyle = shade;
      g.fillRect(0, 0, w, h);
    });
    maple.colorSpace = T.SRGBColorSpace;
    const lacquer = std(0x174b50, { roughness: 0.36 });
    const brass = std(0xe1b26c, { roughness: 0.42, metalness: 0.25 });
    const rubber = std(0x172327);
    const railLight = new T.MeshBasicMaterial({ color: 0xffcc84, toneMapped: false });
    function cabinetBox(w, h, d, x, y, z, mat) {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      skee.add(mesh);
      return mesh;
    }
    const laneGeo = new T.PlaneGeometry(0.76, laneFront - laneLip, 1, 48);
    const laneVerts = laneGeo.attributes.position;
    for (let i = 0; i < laneVerts.count; i++) {
      const z = (laneFront + laneLip) / 2 - laneVerts.getY(i);
      laneVerts.setXYZ(i, laneVerts.getX(i), laneHeight(z), z);
    }
    laneGeo.computeVertexNormals();
    const lane = new T.Mesh(laneGeo, std(0xffffff, { map: maple, roughness: 0.52 }));
    lane.receiveShadow = true; skee.add(lane);
    cabinetBox(0.92, 0.87, 3.05, 0, 0.47, -1.625, lacquer);
    cabinetBox(1.32, 0.96, 1.13, 0, 0.51, -3.73, lacquer);
    cabinetBox(1.36, 0.46, 0.24, 0, 2.22, -4.31, lacquer);
    function laneRail(x, width, bottom, top, material) {
      const profile = new T.Shape();
      profile.moveTo(-laneFront, laneHeight(laneFront) + bottom);
      for (let i = 0; i <= 48; i++) {
        const z = laneFront + (laneLip - laneFront) * i / 48;
        profile.lineTo(-z, laneHeight(z) + top);
      }
      profile.lineTo(-laneLip, laneHeight(laneLip) + bottom);
      profile.closePath();
      const rail = new T.Mesh(new T.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false }), material);
      rail.rotation.y = Math.PI / 2;
      rail.position.x = x - width / 2;
      rail.receiveShadow = true;
      skee.add(rail);
    }
    for (const side of [-1, 1]) {
      laneRail(side * 0.425, 0.09, -0.1, 0.075, lacquer);
      laneRail(side * 0.425, 0.095, 0.075, 0.09, brass);
      laneRail(side * 0.425, 0.022, 0.09, 0.094, railLight);
      cabinetBox(0.018, 0.025, 2.93, side * 0.461, 0.77, -1.625, brass);
      cabinetBox(0.06, 1.18, 1.13, side * 0.66, 0.94, -3.73, lacquer);
    }
    const returnX = 0.59, returnFront = -0.075, ballSpacing = 0.095;
    const returnHeight = (z) => 0.9 + (returnFront - z) * 0.065;
    cabinetBox(0.24, 0.73, 1.03, returnX, 0.46, -0.52, lacquer);
    const cradle = cabinetBox(0.19, 0.035, 0.96, returnX, returnHeight(-0.52) - 0.017, -0.52, rubber);
    cradle.rotation.x = 0.065;
    for (const x of [0.49, 0.69]) {
      const wall = cabinetBox(0.028, 0.077, 0.96, x, returnHeight(-0.52) + 0.025, -0.52, lacquer);
      wall.rotation.x = cradle.rotation.x;
      const edge = cabinetBox(0.03, 0.012, 0.96, x, wall.position.y + 0.039, -0.52, brass);
      edge.rotation.x = cradle.rotation.x;
    }
    cabinetBox(0.22, 0.045, 0.035, returnX, 0.926, -0.038, brass);
    cabinetBox(0.23, 0.035, 0.17, returnX, 1.065, -0.95, lacquer);
    cabinetBox(0.22, 0.11, 0.028, returnX, 0.995, -1.026, rubber);
    cabinetBox(0.92, 0.08, 3.06, 0, 0.055, -1.625, rubber);
    cabinetBox(1.34, 0.08, 1.14, 0, 0.055, -3.73, rubber);
    const trayBallGeo = new T.SphereGeometry(ballRadius, 14, 10);
    const trayBallMat = std(0xb87d48, { roughness: 0.38 });
    const trayBalls = Array.from({ length: 9 }, (_, k) => {
      const ball = new T.Mesh(trayBallGeo, trayBallMat);
      ball.position.set(returnX, 0, returnFront - k * ballSpacing);
      ball.castShadow = true; skee.add(ball);
      return ball;
    });
    let lastTrayCount = null;
    const displayWidth = 512, displayHeight = 112;
    const panelCanvas = document.createElement('canvas');
    panelCanvas.width = displayWidth;
    panelCanvas.height = displayHeight;
    const panelInk = panelCanvas.getContext('2d');
    const panelTex = new T.CanvasTexture(panelCanvas);
    cabinetBox(1.08, 0.21, 0.034, 0, 2.08, -4.18, brass);
    const panel = new T.Mesh(new T.PlaneGeometry(1.04, 0.18), new T.MeshBasicMaterial({ map: panelTex }));
    panel.position.set(0, 2.08, -4.161); skee.add(panel);
    let displayedScore, displayedCount;
    function paintPanel(score, count) {
      const g = panelInk;
      if (!g || (score === displayedScore && count === displayedCount)) return;
      displayedScore = score;
      displayedCount = count;
      g.fillStyle = '#183335';
      g.fillRect(0, 0, displayWidth, displayHeight);
      g.fillStyle = '#09070a';
      g.fillRect(8, 8, 326, 96);
      g.fillRect(344, 8, 160, 96);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 20px system-ui, sans-serif';
      g.fillStyle = '#f4d8a6';
      g.fillText('SCORE', 171, 25);
      g.fillText('BALLS LEFT', 424, 25);
      g.font = '700 62px monospace';
      g.fillStyle = '#ffab55';
      g.fillText(String(score).padStart(4, '0'), 171, 70, 310);
      g.fillStyle = count ? '#ffe0a0' : '#eb9a80';
      g.fillText(String(count), 424, 70);
      panelTex.needsUpdate = true;
    }
    const ballTex = tex(64, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, h * 0.42, w, h * 0.16); g.fillRect(w * 0.45, 0, w * 0.1, h); });
    const board = new T.Group(); board.position.set(0, 1.18, -3.3); board.rotation.x = -0.927; skee.add(board);
    let boardTex = null, boardFace = null;
    const scorePockets = new Map();
    let cornerPockets = [];
    function paintBoard(geo) {
      const W = 640, H = Math.round(W * 1.2 / 1.3);
      boardTex?.dispose();
      boardTex = tex(W, H, (g) => {
        const X = (bx) => (bx + 0.65) / 1.3 * W, Y = (by) => H - by / 1.2 * H, k = W / 1.3;
        const enamel = g.createLinearGradient(0, 0, 0, H);
        enamel.addColorStop(0, '#29636a');
        enamel.addColorStop(1, SKEE_FACE);
        g.fillStyle = enamel; g.fillRect(0, 0, W, H);
        for (let i = geo.rings.length - 1; i >= 0; i--) {
          const [r] = geo.rings[i];
          g.beginPath(); g.arc(X(0), Y(geo.cy), r * k, 0, 7); g.fillStyle = SKEE_RINGS[i]; g.fill();
          g.lineWidth = 3; g.strokeStyle = '#112d30'; g.stroke();
        }
        g.strokeStyle = '#f4d7a0';
        g.lineWidth = 3;
        g.strokeRect(13, 13, W - 26, H - 26);
      });
      boardTex.colorSpace = T.SRGBColorSpace;
      if (!boardFace) {
        const face = new T.Shape();
        face.moveTo(-0.65, 0); face.lineTo(0.65, 0); face.lineTo(0.65, 1.2);
        face.lineTo(-0.65, 1.2); face.closePath();
        geo.rings.forEach(([outer, points], i) => {
          const inner = i ? geo.rings[i - 1][0] : 0;
          const y = i ? geo.cy + (inner + outer) / 2 : geo.cy;
          scorePockets.set(String(points), [0, y, i ? (outer - inner) * 0.36 : outer * 0.78]);
        });
        cornerPockets = geo.cups.map(([x, y]) => [x, y, geo.cupR]);
        const pockets = [...scorePockets.values(), ...cornerPockets];
        for (const [x, y, r] of pockets) {
          const opening = new T.Path();
          opening.absarc(x, y, r, 0, Math.PI * 2, true);
          face.holes.push(opening);
          const well = new T.Mesh(new T.CylinderGeometry(r, r * 0.78, 0.14, 24, 1, true),
            std(0x21141c, { side: T.DoubleSide }));
          well.rotation.x = Math.PI / 2;
          well.position.set(x, y, -0.07);
          board.add(well);
          const bottom = new T.Mesh(new T.CircleGeometry(r, 24), glow(0x130d13));
          bottom.position.set(x, y, -0.14);
          board.add(bottom);
        }
        const faceGeo = new T.ShapeGeometry(face, 24);
        const uv = faceGeo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + 0.65) / 1.3, uv.getY(i) / 1.2);
        boardFace = new T.Mesh(faceGeo, std(0xffffff, { roughness: 0.45 }));
        boardFace.receiveShadow = true; board.add(boardFace);
        for (const [r] of geo.rings) {
          const rim = new T.Mesh(new T.TorusGeometry(r, 0.014, 6, 48), rubber);
          rim.position.set(0, geo.cy, 0.012);
          board.add(rim);
        }
        for (const [x, y, radius] of pockets) {
          const rim = new T.Mesh(new T.TorusGeometry(radius, 0.004, 6, 24), brass);
          rim.position.set(x, y, 0.003);
          board.add(rim);
        }
        const badgeGeo = new T.PlaneGeometry(0.118, 0.07);
        function scoreBadge(points, x, y) {
          const map = tex(128, 76, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 12);
            g.fillStyle = '#102629'; g.fill();
            g.strokeStyle = '#e7b86c'; g.lineWidth = 4; g.stroke();
            g.font = '900 53px system-ui, sans-serif';
            g.fillStyle = '#fff2d7'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(String(points), w / 2, h / 2, w - 14);
          });
          map.colorSpace = T.SRGBColorSpace;
          const badge = new T.Mesh(badgeGeo, new T.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, toneMapped: false }));
          badge.position.set(x, y, 0.031);
          board.add(badge);
        }
        geo.rings.forEach(([, points], i) => {
          const [, y, radius] = scorePockets.get(String(points));
          scoreBadge(points, (i % 2 ? -1 : 1) * (radius + 0.069), y);
        });
        for (const [x, y, radius] of cornerPockets) scoreBadge(100, x, y + radius + 0.046);
      }
      boardFace.material.map = boardTex; boardFace.material.needsUpdate = true;
    }
    const goldMat = std(0xffc83a, { metalness: 0.75, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const skeeJack = new T.Mesh(new T.TorusGeometry(0.05, 0.014, 8, 24), goldMat); skeeJack.position.z = 0.016; board.add(skeeJack);
    const skeeBall = new T.Mesh(new T.SphereGeometry(0.045, 16, 12), std(0xffffff, { roughness: 0.35, map: ballTex })); skeeBall.castShadow = true;
    const skeeBalls = [];
    const skeeSign = marquee('SKEE ROLL', 1.3, 0.22, SKEE_FACE); skeeSign.position.set(0, 2.34, -4.18); skee.add(skeeSign);
    const boardPt = (bx, by, lift = 0.05) => board.localToWorld(new T.Vector3(bx, by, lift));

    // ⭕ Ring Toss: a table of bottles, board (bx, by) → world (bx, 0.86, -1.5 - by)
    const rings = new T.Group(); scene3.add(rings);
    const TY = 0.86, TZ = -1.5;
    const table = new T.Mesh(new T.BoxGeometry(1.5, 0.06, 1.25), std(0x7a4a2a, { roughness: 0.6 }));
    table.position.set(0, TY - 0.03, TZ - 0.52); table.receiveShadow = true; rings.add(table);
    const fringe = tex(256, 48, (g, w, h) => { g.fillStyle = '#1f6a3c'; g.fillRect(0, 0, w, h * 0.6); g.fillStyle = '#ffd23f'; g.fillRect(0, h * 0.18, w, 3); for (let k = 0; k < 16; k++) { g.beginPath(); g.arc((k + 0.5) * w / 16, h * 0.6, w / 32, 0, Math.PI); g.fillStyle = k % 2 ? '#1f6a3c' : '#c23b32'; g.fill(); } });
    fringe.wrapS = T.RepeatWrapping; fringe.repeat.x = 2;
    const cloth = new T.Mesh(new T.PlaneGeometry(1.52, 0.2), std(0xffffff, { map: fringe, transparent: true, alphaTest: 0.1, side: T.DoubleSide })); cloth.position.set(0, TY - 0.1, TZ + 0.11); rings.add(cloth);
    const legMat = std(0x5a3a20); for (const sx of [-0.68, 0.68]) for (const lz of [TZ + 0.05, TZ - 1.1]) { const leg = new T.Mesh(new T.BoxGeometry(0.06, TY, 0.06), legMat); leg.position.set(sx, TY / 2, lz); rings.add(leg); }
    const bottlePts = [[0, 0], [0.045, 0], [0.05, 0.02], [0.05, 0.15], [0.034, 0.19], [0.017, 0.22], [0.017, 0.28], [0.02, 0.29], [0, 0.29]].map(([x, y]) => new T.Vector2(x, y));
    const bottleGeo = new T.LatheGeometry(bottlePts, low ? 10 : 18);
    const glass = { g: std(0x2fbf5a, { roughness: 0.12, transparent: true, opacity: 0.85 }), b: std(0x2f7fe8, { roughness: 0.12, transparent: true, opacity: 0.85 }),
      r: std(0xe8343f, { roughness: 0.12, transparent: true, opacity: 0.85 }) };
    const bottleMeshes = [];
    const ringSign = marquee('RING TOSS', 1.2, 0.28); ringSign.position.set(0, 1.55, TZ - 1.5); rings.add(ringSign);
    const ringGeo = new T.TorusGeometry(0.06, 0.009, 6, 28); ringGeo.rotateX(Math.PI / 2);
    const ringMats = new Map(), ringMat = (c) => { if (!ringMats.has(c)) ringMats.set(c, std(c, { roughness: 0.35, emissive: c, emissiveIntensity: 0.2 })); return ringMats.get(c); };
    const ringPool = [], flyRings = [];
    const tablePt = (bx, by, y = TY) => new T.Vector3(bx, y, TZ - by);

    // 🥫 Can Slam: a shelf with a 4-3-2-1 pyramid, can (cx, cy) → world (cx, SY + cy, SZ)
    const cansG = new T.Group(); scene3.add(cansG);
    const SY = 1.0, SZ = -2.6;
    const shelf = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.35), std(0x8a5a32)); shelf.position.set(0, SY - 0.03, SZ); shelf.castShadow = shelf.receiveShadow = true; cansG.add(shelf);
    const post = new T.Mesh(new T.BoxGeometry(0.08, SY, 0.08), std(0x5a3a20)); post.position.set(0, SY / 2, SZ); cansG.add(post);
    const curtain = new T.Mesh(new T.PlaneGeometry(2.6, 1.55), std(0x6a1630, { side: T.DoubleSide })); curtain.position.set(0, 0.85, SZ - 0.9); cansG.add(curtain);
    const cansSign = marquee('CAN SLAM', 1.0, 0.24); cansSign.position.set(0, 1.86, SZ - 0.85); cansG.add(cansSign);
    const canTex = tex(128, 64, (g, w, h) => { g.fillStyle = '#c8ccd2'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8483f'; g.fillRect(0, h * 0.25, w, h * 0.5); g.fillStyle = '#fff'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.fillText('POW', w / 2, h * 0.62); });
    const canMat = [std(0xffffff, { map: canTex, metalness: 0.5, roughness: 0.35 }), std(0xb8bcc2, { metalness: 0.7, roughness: 0.3 }), std(0xb8bcc2, { metalness: 0.7, roughness: 0.3 })];
    const goldCan = [goldMat, goldMat, goldMat];
    let canGeo = null; const canMeshes = [];
    const canBall = new T.Mesh(new T.SphereGeometry(0.045, 14, 10), std(0xf4efe4, { roughness: 0.6 })); canBall.castShadow = true;
    const canBalls = [];

    // 🏀 Basketball: staggered backboards, rims, and tapered nets.
    const hoops = new T.Group(); scene3.add(hoops);
    const hoopRims = [], hoopBalls = [];
    const hoopRimMat = std(0xff7435, { metalness: 0.35 });
    const hoopPoint = (x, y) => new T.Vector3(x, 1 + y, hoopDepth);
    let hoopBall;
    function buildHoops(geo) {
      const rubber = tex(512, 256, (g, w, h) => {
        g.fillStyle = '#df641f'; g.fillRect(0, 0, w, h);
        for (let y = 2; y < h; y += 4) {
          for (let x = 1 + (y % 8 === 2 ? 0 : 2); x < w; x += 4) {
            g.fillStyle = '#a64219'; g.fillRect(x, y, 2, 2);
            g.fillStyle = '#f78943'; g.fillRect(x, y, 1, 1);
          }
        }
        g.strokeStyle = '#3e2018'; g.lineWidth = 4;
        g.beginPath();
        g.moveTo(0, h / 2); g.lineTo(w, h / 2);
        for (const x of [0, w / 2, w]) {
          g.moveTo(x, 0); g.lineTo(x, h);
        }
        for (const x of [w / 4, w * 3 / 4]) {
          g.moveTo(x, 0);
          g.bezierCurveTo(x - 88, h / 3, x + 88, h * 2 / 3, x, h);
        }
        g.stroke();
      });
      hoopBall = new T.Mesh(new T.SphereGeometry(hoopRadius, 28, 20),
        std(0xffffff, { map: rubber, roughness: 0.68 }));
      hoops.add(hoopBall);
      hoopBalls.push(hoopBall);
      const teal = std(0x15535a), dark = std(0x102f38), trim = std(0xe86b32);
      const box = (w, h, d, x, y, z, mat) => {
        const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        hoops.add(mesh);
        return mesh;
      };
      box(1.72, 1.63, 0.09, 0, 1.66, -2.63, dark);
      box(1.72, 0.08, 0.16, 0, 2.46, -2.57, teal);
      const sign = marquee('BASKETBALL', 1.48, 0.22, '#13464e', '#ffb078');
      sign.position.set(0, 2.32, -2.55);
      hoops.add(sign);
      const warm = glow(0xffaf72);
      box(1.52, 0.018, 0.045, 0, 2.21, -2.52, warm);
      const lamp = new T.PointLight(0xffb078, 0.8, 3, 2);
      lamp.position.set(0, 2.24, -2.23);
      hoops.add(lamp);
      for (const side of [-1, 1]) {
        box(0.10, 1.55, 0.15, side * 0.82, 1.66, -2.54, teal);
        box(0.12, 0.32, 1.76, side * 0.82, 0.86, -1.71, teal);
        const pad = box(0.12, 0.07, 1.76, side * 0.82, 1.07, -1.71, trim);
        pad.rotation.x = Math.atan(hoopSlope);
      }
      const rampLength = hoopRackZ + 2.57;
      const ramp = new T.Mesh(new T.PlaneGeometry(1.52, rampLength * Math.hypot(1, hoopSlope)), std(0x294655));
      ramp.rotation.x = -Math.PI / 2 + Math.atan(hoopSlope);
      ramp.position.z = hoopRackZ - rampLength / 2;
      ramp.position.y = hoopRampY(ramp.position.z) - hoopRadius;
      hoops.add(ramp);
      box(1.72, 0.48, 0.14, 0, 0.43, hoopRackZ + 0.06, teal);
      box(1.64, 0.07, 0.09, 0, 0.68, hoopRackZ + 0.06, trim);
      box(0.53, 0.12, 0.026, 0, 0.58, hoopRackZ + 0.14, dark);
      for (const [x, y, rx, , points] of geo.hoops) {
        const target = new T.Group();
        target.position.copy(hoopPoint(x, y));
        hoops.add(target);
        const boardTex = tex(256, 160, (g, w, h) => {
          g.fillStyle = '#22515b'; g.fillRect(0, 0, w, h);
          g.strokeStyle = '#91b6b6'; g.lineWidth = 7;
          g.strokeRect(7, 7, w - 14, h - 14);
          g.lineWidth = 4; g.strokeRect(81, 89, 94, 64);
          g.fillStyle = '#ffebd5'; g.font = '800 60px system-ui';
          g.textAlign = 'center'; g.fillText(points, w / 2, 74);
        });
        const board = new T.Mesh(new T.PlaneGeometry(0.36, 0.23), std(0xffffff, { map: boardTex }));
        board.position.set(0, 0.11, -0.15);
        target.add(board);
        const radius = rx + 0.052;
        const rim = new T.Mesh(new T.TorusGeometry(radius, 0.011, 8, 28), hoopRimMat);
        rim.rotation.x = -Math.PI / 2;
        target.add(rim); hoopRims.push(rim);
        const net = [];
        const netPoint = (angle, row) => {
          const r = radius * (1 - 0.35 * row / 3);
          return [Math.cos(angle) * r, -0.18 * row / 3, Math.sin(angle) * r];
        };
        for (let row = 0; row < 3; row++) {
          for (let i = 0; i < 12; i++) {
            const angle = (i + (row % 2) / 2) * Math.PI / 6;
            for (const offset of [-Math.PI / 12, Math.PI / 12]) {
              net.push(...netPoint(angle, row), ...netPoint(angle + offset, row + 1));
            }
          }
        }
        const netGeo = new T.BufferGeometry();
        netGeo.setAttribute('position', new T.Float32BufferAttribute(net, 3));
        target.add(new T.LineSegments(netGeo, new T.LineBasicMaterial({ color: 0xf3ebe0 })));
      }
    }

    // the preview: dots along the arc and a ring where it would land
    const dotGeo = new T.SphereGeometry(0.012, 6, 4), dotMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false });
    const dots = Array.from({ length: 14 }, () => { const m = new T.Mesh(dotGeo, dotMat); m.renderOrder = 9; scene3.add(m); return m; });
    const arrowShape = new T.Shape();
    arrowShape.moveTo(-0.046, -0.035);
    arrowShape.lineTo(0, 0.035);
    arrowShape.lineTo(0.046, -0.035);
    arrowShape.lineTo(0, -0.012);
    arrowShape.closePath();
    const arrowGeo = new T.ShapeGeometry(arrowShape);
    const arrowBacking = new T.MeshBasicMaterial({ color: 0x102629, toneMapped: false });
    const aimArrows = Array.from({ length: 6 }, () => {
      const arrow = new T.Mesh(arrowGeo, new T.MeshBasicMaterial({
        color: 0xfff3cb, toneMapped: false,
      }));
      const backing = new T.Mesh(arrowGeo, arrowBacking);
      backing.scale.set(1.24, 1.24, 1);
      backing.position.z = -0.002;
      arrow.add(backing);
      scene3.add(arrow);
      return arrow;
    });
    const mark = new T.Mesh(new T.RingGeometry(0.035, 0.05, 24), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: T.DoubleSide }));
    mark.renderOrder = 9; scene3.add(mark);
    // confetti for jackpots and sweeps
    const bits = [], bitGeo = new T.PlaneGeometry(0.025, 0.04), CONF = [0xffd23f, 0xff5a7a, 0x5ad1ff, 0x7dff8a, 0xffffff];
    function confetti(at, n) {
      if (low) n = Math.ceil(n / 2);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(bitGeo, new T.MeshBasicMaterial({ color: CONF[k % 5], side: T.DoubleSide }));
        m.position.copy(at);
        m.userData = { v: new T.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.2) * 1.5), life: 1.2 + Math.random() * 0.6, s: Math.random() * 10 };
        scene3.add(m); bits.push(m);
      }
    }

    let built = '', kindNow = '';
    function build(sc) {
      const key = `${sc.kind}:${JSON.stringify(sc.layout)}`;
      if (key === built) return;
      built = key;
      if (sc.kind === 'skee') paintBoard(sc.geo);
      if (sc.kind === 'rings') {
        while (bottleMeshes.length < sc.geo.bottles.length) { const m = new T.Mesh(bottleGeo, glass.g); m.castShadow = true; rings.add(m); bottleMeshes.push(m); }
        sc.geo.bottles.forEach(([bx, by], i) => { const m = bottleMeshes[i]; m.position.copy(tablePt(bx, by)); m.material = glass[sc.layout.colours[i]]; });
      }
      if (sc.kind === 'hoops' && !hoopRims.length) buildHoops(sc.geo);
      if (sc.kind === 'cans') {
        canGeo ||= new T.CylinderGeometry(sc.geo.w / 2 - 0.004, sc.geo.w / 2 - 0.004, sc.geo.h - 0.004, low ? 12 : 20);
        while (canMeshes.length < sc.geo.cans.length) { const m = new T.Mesh(canGeo, canMat); m.castShadow = true; cansG.add(m); canMeshes.push(m); }
      }
    }

    const cam = { pos: new T.Vector3(0, 1.7, 1.1), look: new T.Vector3(0, 1.1, -3), init: false };
    const VIEW = { skee: { pos: [0, 1.85, 1.65], look: [0, 1.36, -2.6], w: 0.86, d: 2.7 }, rings: { pos: [0, 1.9, 0.1], look: [0, 0.78, -2.05], w: 0.8, d: 2.6 },
      hoops: { pos: [0, 1.86, 1.36], look: [0, 1.31, -2.30], w: 0.82, d: 2.4 },
      cans: { pos: [0, 1.4, -0.2], look: [0, 1.18, -2.6], w: 0.55, d: 2.4 } };
    let lastT = 0, moving = 0;
    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();

    const arc = (a, b, h, u) => new T.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + h * 4 * u * (1 - u), a.z + (b.z - a.z) * u);
    // where a throw is at u (0..1 of its flight to the landing), for each booth
    const HAND = { skee: new T.Vector3(0, laneHeight(laneFront) + ballRadius, laneFront), rings: new T.Vector3(0.1, 1.35, 0.25), cans: new T.Vector3(0.15, 1.35, 0.5), hoops: new T.Vector3(0, 1.17, hoopLaunchZ) };
    function skeePath(sh, u, landU) {
      const lip = new T.Vector3(clamp(sh.x * 0.7, -0.33, 0.33), laneHeight(laneLip) + ballRadius, laneLip);
      const rollAt = (s) => {
        const p = HAND.skee.clone().lerp(lip, s);
        p.y = laneHeight(p.z) + ballRadius;
        return p;
      };
      if (sh.where === 'short') {
        const top = Math.max(0.15, (sh.y + 0.08) / 1.1) * 0.95, s = u < 0.6 ? u / 0.6 * top : top * (1 - (u - 0.6) / 0.4);
        return rollAt(s);
      }
      if (u < 0.55) { const s = 1 - (1 - u / 0.55) ** 1.6; return rollAt(s); }
      if (u < landU) return arc(lip, boardPt(sh.x, Math.max(0.02, sh.y)), 0.22, (u - 0.55) / (landU - 0.55));
      const w = Math.min(1, (u - landU) / (1 - landU));
      const settle = sh.rattle ? Math.min(1, w / 0.25) : 1;
      const hop = sh.rattle ? Math.sin(settle * Math.PI * 3) * 0.012 * (1 - settle) : 0;
      const x = sh.x + (sh.ex - sh.x) * settle + hop;
      const y = Math.max(0.02, sh.y + (sh.ey - sh.y) * settle);
      const pocket = sh.where === 'cup' ? cornerPockets[x < 0 ? 0 : 1] : scorePockets.get(sh.where);
      const progress = clamp((w - 0.25) / 0.55, 0, 1);
      const approach = progress * progress * (3 - 2 * progress);
      const targetX = pocket ? pocket[0] : x;
      const targetY = pocket ? pocket[1] : 0.02;
      const depth = w > 0.8 ? (w - 0.8) / 0.2 : 0;
      return boardPt(x + (targetX - x) * approach, y + (targetY - y) * approach, 0.05 - 0.14 * depth);
    }
    function ringPath(sh, u, landU) {
      const top = 0.31, first = tablePt(sh.x, sh.y, TY + top);
      if (u < landU) return arc(HAND.rings, first, 0.55, u / landU);
      const v = (u - landU) / (1 - landU), endY = sh.b != null ? TY + 0.17 : TY + 0.01;
      const end = tablePt(sh.ex, sh.ey, endY);
      if (sh.bounce) return arc(first, end, 0.12, v);
      return first.clone().lerp(end, Math.min(1, v * 1.6));
    }
    function canPath(sh, u, landU) {
      const hit = new T.Vector3(sh.x, SY + sh.y, SZ + 0.1);
      if (u < landU) return arc(HAND.cans, hit, 0.15, u / landU);
      const v = (u - landU) / (1 - landU);
      return sh.fell.length ? hit.clone().add(new T.Vector3(sh.x * 0.3 * v, -0.6 * v * v, -0.3 * v))
        : hit.clone().add(new T.Vector3(0, -0.8 * v * v, -0.85 * v));
    }

    // a short fading trail behind a flying ball
    const trailGeo = new T.SphereGeometry(0.04, 8, 6), trails = [];
    function trail(k, path, f, col) {
      if (low) return;
      trails[k] ||= Array.from({ length: 5 }, (_, j) => { const m = new T.Mesh(trailGeo, new T.MeshBasicMaterial({ transparent: true, opacity: 0.35 * (1 - j / 5), depthWrite: false })); m.scale.setScalar(1 - j * 0.15); scene3.add(m); return m; });
      trails[k].forEach((m, j) => { const u = f.u - 0.035 * (j + 1); m.visible = f.u < f.landU && u > 0.05; if (m.visible) { m.position.copy(path(u)); m.material.color.set(col); } });
    }
    function draw(now, sc, idle) {
      for (const t of trails) if (t) for (const m of t) m.visible = false;
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      build(sc);
      if (sc.kind !== kindNow) { kindNow = sc.kind; cam.init = false; if (spot) spot.target.position.set(0, sc.kind === 'rings' ? TY : 1.4, sc.kind === 'skee' ? -3.7 : sc.kind === 'rings' ? TZ - 0.5 : SZ); }
      if (sc.kind !== 'skee') lastTrayCount = null;
      counter.visible = front.visible = sc.kind !== 'skee' && sc.kind !== 'hoops';
      awning.visible = sc.kind !== 'hoops';
      hoops.visible = sc.kind === 'hoops';
      skee.visible = sc.kind === 'skee'; rings.visible = sc.kind === 'rings'; cansG.visible = sc.kind === 'cans';
      const pool = (arr, proto, parent, count = sc.fly.length) => { while (arr.length < count) { const m = proto.clone(); m.material = proto.material.clone(); parent.add(m); arr.push(m); } arr.forEach((m) => { m.visible = false; }); };
      if (sc.kind === 'skee') {
        skeeJack.visible = sc.jackLive; skeeJack.position.set(sc.layout.jack[0], sc.layout.jack[1], 0.016);
        pool(skeeBalls, skeeBall, scene3);
        sc.fly.forEach((f, k) => { const m = skeeBalls[k]; m.visible = f.u > 0 && f.u < 1; m.position.copy(skeePath(f.shot, f.u, f.landU)); m.rotation.x = -f.u * 40; m.material.color.set(sc.color); trail(k, (u) => skeePath(f.shot, u, f.landU), f, sc.color); });
        const count = clamp(sc.left ?? 0, 0, trayBalls.length);
        if (lastTrayCount === null || count > lastTrayCount) {
          trayBalls.forEach((ball, k) => { ball.position.z = returnFront - k * ballSpacing; });
        } else if (count < lastTrayCount) {
          const used = lastTrayCount - count;
          for (let k = 0; k < count; k++) trayBalls[k].position.z = trayBalls[k + used].position.z;
        }
        lastTrayCount = count;
        trayBalls.forEach((ball, k) => {
          ball.visible = k < count;
          const target = returnFront - k * ballSpacing;
          const step = Math.min(target - ball.position.z, dt * 0.7);
          ball.position.z += step;
          ball.position.y = returnHeight(ball.position.z) + ballRadius;
          ball.rotation.x += step / ballRadius;
        });
        paintPanel(sc.pts ?? 0, count);
      } else if (sc.kind === 'rings') {
        bottleMeshes.forEach((m, i) => { m.material = i === sc.layout.jack && sc.jackLive ? goldMat : glass[sc.layout.colours[i]]; });
        while (ringPool.length < sc.shots.length) { const m = new T.Mesh(ringGeo, ringMat(0xffffff)); rings.add(m); ringPool.push(m); }
        ringPool.forEach((m, k) => {
          const s = sc.shots[k]; m.visible = !!s; if (!s) return;
          m.position.copy(tablePt(s.ex, s.ey, s.b != null ? TY + 0.17 : TY + 0.01)); m.material = ringMat(sc.color);
          m.rotation.set(s.b != null ? 0 : ((s.id * 37) % 7 - 3) * 0.02, s.id, 0);
        });
        while (flyRings.length < sc.fly.length) { const m = new T.Mesh(ringGeo, ringMat(0xffffff)); rings.add(m); flyRings.push(m); }
        flyRings.forEach((m) => { m.visible = false; });
        sc.fly.forEach((f, k) => { const m = flyRings[k]; m.visible = f.u > 0; m.position.copy(ringPath(f.shot, f.u, f.landU)); m.rotation.set(f.u < f.landU ? 0.5 * (1 - f.u) : 0, f.u * 9, 0); m.material = ringMat(sc.color); });
      } else if (sc.kind === 'hoops') {
        hoopRims.forEach((rim, i) => { rim.material = sc.jackLive && i === sc.layout.jack ? goldMat : hoopRimMat; });
        pool(hoopBalls, hoopBall, hoops, sc.basketballs.length);
        sc.basketballs.forEach(({ x, y, z, spin }, i) => {
          const ball = hoopBalls[i];
          ball.visible = true;
          ball.position.set(x, y, z);
          ball.rotation.x = spin;
        });
      } else {
        sc.geo.cans.forEach(([cx, cy], i) => {
          const m = canMeshes[i]; if (!m) return;
          const t0 = sc.fallAt[i];
          m.material = i === sc.layout.jack && sc.jackLive ? goldCan : canMat;
          if (t0 == null || now < t0) { m.visible = true; m.position.set(cx, SY + cy, SZ); m.rotation.set(0, i * 0.7, 0); return; }
          const e = Math.min(1, (now - t0) / 650);
          m.visible = e < 1;
          m.position.set(cx + (i % 2 ? 0.05 : -0.05) * e, SY + cy - (cy + 0.6) * e * e, SZ - 0.4 * e);
          m.rotation.set(-1.6 * e, i * 0.7, (i % 2 ? 1 : -1) * 0.8 * e);
        });
        pool(canBalls, canBall, scene3);
        sc.fly.forEach((f, k) => { const m = canBalls[k]; m.visible = f.u > 0 && f.u < 1; m.position.copy(canPath(f.shot, f.u, f.landU)); trail(k, (u) => canPath(f.shot, u, f.landU), f, 0xfff2c0); });
      }
      // the preview arc
      const pv = sc.preview;
      // #149: only the start of the throw shows (its direction and loft), never where it lands; the skee lane shows
      // a short row of arrows whose lighting mirrors the charge meter
      mark.visible = false;
      const lanePreview = sc.kind === 'skee' && pv;
      aimArrows.forEach((arrow, i) => {
        arrow.visible = !!lanePreview;
        if (!lanePreview) return;
        const t = 0.16 + i * 0.08;
        const x = clamp(pv.x * 0.7, -0.33, 0.33) * t;
        const z = laneFront + (laneLip - laneFront) * t;
        const yaw = Math.atan2(x, laneFront - z);
        arrow.position.set(x, laneHeight(z) + 0.008, z);
        arrow.rotation.set(-Math.PI / 2 + Math.atan(0.1 / (laneFront - laneLip)), 0, -yaw);
        const lit = sc.charging && sc.chargePower * aimArrows.length > i;
        arrow.material.color.setHex(lit ? 0xffac30 : 0xfff3cb);
      });
      dots.forEach((d) => { d.visible = !!pv && !lanePreview; });
      if (pv && !lanePreview) {
        const start = HAND[sc.kind];
        const ringToss = sc.kind === 'rings';
        const basketball = sc.kind === 'hoops';
        const end = ringToss ? tablePt(pv.x, pv.y, TY + 0.3) : basketball ? hoopPoint(pv.x, pv.y) : new T.Vector3(pv.x, SY + pv.y, SZ + 0.12);
        dotMat.opacity = sc.swiping ? 0.9 : 0.5;
        dots.forEach((d, k) => {
          const progress = 0.14 + 0.32 * (k + 1) / dots.length;
          if (basketball) {
            const duration = hoopShowTime * HIT.hoops;
            const { x, y, z } = basketballFlight(pv, progress * duration, duration);
            d.position.set(x, y, z);
          } else d.position.copy(arc(start, end, ringToss ? 0.5 : 0.12, progress));
        });
      }
      for (let k = bits.length - 1; k >= 0; k--) {
        const m = bits[k], u = m.userData;
        u.life -= dt; u.v.y -= 3.5 * dt; u.v.multiplyScalar(0.985);
        m.position.addScaledVector(u.v, dt); m.rotation.set(u.s + now / 300, u.s * 2 + now / 260, 0);
        if (u.life <= 0) { scene3.remove(m); m.material.dispose(); bits.splice(k, 1); }
      }
      // the bulbs chase
      if (!idle || now % 1000 < 70) bulbs.forEach((b, k) => { b.visible = ((k + Math.floor(now / 350)) % 5) !== 0; });
      // the camera: fixed per booth, fitted so the booth's width shows on a narrow phone
      const vw = VIEW[sc.kind];
      const want = new T.Vector3(...vw.pos), look = new T.Vector3(...vw.look);
      if (pv && sc.swiping) want.x += pv.x * 0.15;
      const fov = Math.max(42, 2 * Math.atan(vw.w / vw.d / Math.min(1, camera.aspect)) * 180 / Math.PI);
      const k = cam.init ? 1 - Math.exp(-dt * 4) : 1; cam.init = true;
      cam.pos.lerp(want, k); cam.look.lerp(look, k);
      moving = cam.pos.distanceTo(want) > 0.005 || bits.length ? 1 : 0;
      camera.position.copy(cam.pos);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      stg.follow(camera);
      if (idle && renderer.renderStill) renderer.renderStill(scene3, camera); else renderer.render(scene3, camera);
    }

    return {
      draw, resize, moving: () => moving,
      impact(sh) {
        let at;
        if (sh.k === 'skee') at = boardPt(sh.x, Math.max(0.02, sh.y), 0.1);
        else if (sh.k === 'rings') at = tablePt(sh.ex, sh.ey, TY + 0.3);
        else if (sh.k === 'hoops') at = hoopPoint(sh.x, sh.y);
        else at = new T.Vector3(sh.x, SY + sh.y, SZ + 0.1);
        if (sh.jack || sh.sweep || (sh.k === 'skee' && sh.where === 'cup')) { confetti(at, sh.jack ? 60 : 36); GL3.shake(camera, 0.12); }
        else if (sh.pts >= (sh.k === 'skee' ? 30 : 1)) confetti(at, sh.hot ? 22 : 12);
        else if (sh.k === 'cans' && sh.fell.length >= 3) GL3.shake(camera, 0.08);
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        boardTex?.dispose(); renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the booth face-on (skee board, the bottles from above, the pyramid)
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the booth.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, sparks = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const RC = { g: '#2fbf5a', b: '#2f7fe8', r: '#e8343f' };
    function draw(now, sc) {
      const basketball = sc.kind === 'hoops';
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, basketball ? '#081b25' : '#20123a');
      bg.addColorStop(1, basketball ? '#20484d' : '#3a1f22');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      // world box: x in [-0.7, 0.7], y in [-0.1, 1.2]; fitted with room for the HUD at the top and the hand at the bottom
      const k = Math.max(1, Math.min(w / (basketball ? 1.78 : 1.5), (h - 90) / (basketball ? 2.07 : 1.35)));
      const cx = w / 2, by = basketball ? h - 18 - 0.50 * k : h - 34;
      const X = (x) => cx + x * k, Y = (y) => by - (y + 0.1) * k;
      g.lineWidth = 2;
      if (sc.kind === 'skee') {
        g.fillStyle = SKEE_FACE; g.fillRect(X(-0.65), Y(1.2), 1.3 * k, 1.2 * k);
        g.strokeStyle = '#e7b86c'; g.strokeRect(X(-0.63), Y(1.18), 1.26 * k, 1.16 * k);
        const { rings, cy, cups, cupR } = sc.geo;
        for (let i = rings.length - 1; i >= 0; i--) {
          g.beginPath(); g.arc(X(0), Y(cy), rings[i][0] * k, 0, 7);
          g.fillStyle = SKEE_RINGS[i]; g.fill(); g.strokeStyle = '#112d30'; g.stroke();
        }
        function label(points, x, y) {
          g.font = `800 ${Math.max(10, k * 0.056)}px system-ui, sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.strokeStyle = '#102629'; g.lineWidth = 3; g.strokeText(String(points), X(x), Y(y));
          g.fillStyle = '#fff2d7'; g.fillText(String(points), X(x), Y(y));
          g.lineWidth = 2;
        }
        rings.forEach(([r, points], i) => {
          const inner = i ? rings[i - 1][0] : 0;
          label(points, i ? (i % 2 ? -1 : 1) * (inner + r) / 2 : 0, cy);
        });
        for (const [x, y] of cups) {
          g.beginPath(); g.arc(X(x), Y(y), cupR * k, 0, 7);
          g.fillStyle = '#0a1518'; g.fill(); g.strokeStyle = '#e7b86c'; g.stroke();
          label(100, x, y + cupR + 0.045);
        }
        if (sc.jackLive) { g.beginPath(); g.arc(X(sc.layout.jack[0]), Y(sc.layout.jack[1]), sc.geo.jackR * k, 0, 7); g.strokeStyle = '#ffc83a'; g.lineWidth = 4; g.stroke(); g.lineWidth = 2; }
        for (const f of sc.fly) {
          if (f.u <= 0 || f.u >= 1) continue;
          const s = f.shot, v = Math.min(1, f.u / f.landU), y = s.where === 'short' ? -0.1 + (s.y + 0.1) * Math.sin(Math.PI * f.u) : -0.1 + (s.y + 0.1) * v;
          g.beginPath(); g.arc(X(s.x * v), Y(y), Math.max(4, 0.045 * k * (1.4 - 0.4 * v)), 0, 7); g.fillStyle = sc.color; g.fill(); g.strokeStyle = '#111'; g.stroke();
        }
      } else if (sc.kind === 'rings') {
        g.fillStyle = '#7a4a2a'; g.fillRect(X(-0.65), Y(1.05), 1.3 * k, 1.1 * k);
        sc.geo.bottles.forEach(([x, y], i) => { g.beginPath(); g.arc(X(x), Y(y), 0.05 * k, 0, 7); g.fillStyle = i === sc.layout.jack && sc.jackLive ? '#ffc83a' : RC[sc.layout.colours[i]]; g.fill(); g.beginPath(); g.arc(X(x), Y(y), 0.017 * k, 0, 7); g.fillStyle = '#0006'; g.fill(); });
        for (const s of sc.shots) { g.beginPath(); g.arc(X(s.ex), Y(s.ey), 0.06 * k, 0, 7); g.strokeStyle = sc.color; g.lineWidth = 3; g.stroke(); }
        for (const f of sc.fly) {
          if (f.u <= 0) continue;
          const s = f.shot, v = Math.min(1, f.u / f.landU), x = f.u < f.landU ? s.x * v : s.ex, y = f.u < f.landU ? -0.1 + (s.y + 0.1) * v : s.ey;
          g.beginPath(); g.arc(X(x), Y(y), 0.06 * k * (1 + 0.6 * (1 - v)), 0, 7); g.strokeStyle = sc.color; g.lineWidth = 3; g.stroke();
        }
        g.lineWidth = 2;
      } else if (sc.kind === 'hoops') {
        const cabinet = g.createLinearGradient(0, Y(1.4), 0, Y(-0.52));
        cabinet.addColorStop(0, '#234c54'); cabinet.addColorStop(1, '#0b252e');
        g.fillStyle = cabinet; g.fillRect(X(-0.86), Y(1.44), 1.72 * k, 1.88 * k);
        g.fillStyle = '#24606a';
        for (const x of [-0.86, 0.76]) g.fillRect(X(x), Y(1.44), 0.10 * k, 1.88 * k);
        g.fillStyle = '#11343d'; g.fillRect(X(-0.75), Y(1.44), 1.50 * k, 0.19 * k);
        g.fillStyle = '#ffbc85'; g.fillRect(X(-0.75), Y(1.25), 1.50 * k, Math.max(2, 0.02 * k));
        g.font = `900 ${Math.max(12, k * 0.112)}px system-ui`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('BASKETBALL', cx, Y(1.345));
        sc.geo.hoops.forEach(([x, y, rx, , points], i) => {
          const px = X(x), py = Y(y), rim = (rx + 0.052) * k;
          g.fillStyle = '#315976'; g.fillRect(px - 0.18 * k, py - 0.19 * k, 0.36 * k, 0.22 * k);
          g.strokeStyle = '#91b6b6'; g.strokeRect(px - 0.18 * k, py - 0.19 * k, 0.36 * k, 0.22 * k);
          g.strokeRect(px - 0.065 * k, py - 0.058 * k, 0.13 * k, 0.072 * k);
          g.fillStyle = '#ffebd5'; g.font = `800 ${Math.max(10, k * 0.085)}px system-ui`;
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(points, px, py - 0.115 * k);
          g.beginPath();
          for (let i = 0; i <= 6; i++) {
            const x = i / 3 - 1;
            g.moveTo(px + x * rim, py);
            g.lineTo(px + (x * 0.55 + 0.36) * rim, py + 0.17 * k);
            g.moveTo(px + x * rim, py);
            g.lineTo(px + (x * 0.55 - 0.36) * rim, py + 0.17 * k);
          }
          g.lineWidth = 1; g.strokeStyle = '#a3c3c4'; g.stroke();
          g.beginPath(); g.ellipse(px, py, rim, Math.max(2, 0.025 * k), 0, 0, 2 * Math.PI);
          g.strokeStyle = sc.jackLive && i === sc.layout.jack ? '#ffd23f' : '#ff833e';
          g.lineWidth = 4; g.stroke(); g.lineWidth = 2;
        });
        const ballY = (y, z) => Y(y - 1 + 0.14 * (hoopDepth - z));
        g.beginPath();
        g.moveTo(X(-0.76), ballY(hoopRampY(hoopDepth) - hoopRadius, hoopDepth));
        g.lineTo(X(-0.76), ballY(hoopRampY(hoopRackZ) - hoopRadius, hoopRackZ));
        g.lineTo(X(0.76), ballY(hoopRampY(hoopRackZ) - hoopRadius, hoopRackZ));
        g.lineTo(X(0.76), ballY(hoopRampY(hoopDepth) - hoopRadius, hoopDepth));
        g.fillStyle = '#345e63'; g.fill(); g.strokeStyle = '#dd7540'; g.stroke();
        const trayY = ballY(hoopRampY(hoopRackZ), hoopRackZ);
        g.fillStyle = '#102d35'; g.fillRect(X(-0.76), trayY + 0.038 * k, 1.52 * k, 0.11 * k);
        g.fillStyle = '#df7139'; g.fillRect(X(-0.76), trayY + 0.055 * k, 1.52 * k, 0.025 * k);
        if (sc.preview) {
          const duration = hoopShowTime * HIT.hoops;
          g.fillStyle = '#ffffffa0';
          for (let i = 0; i < 10; i++) {
            const { x, y, z } = basketballFlight(sc.preview, duration * (0.14 + i * 0.034), duration);
            g.beginPath(); g.arc(X(x), ballY(y, z), 2, 0, 2 * Math.PI); g.fill();
          }
        }
        for (const ball of [...sc.basketballs].sort((a, b) => a.z - b.z)) {
          const x = X(ball.x), py = ballY(ball.y, ball.z), r = Math.max(4, hoopRadius * k * (1 + 0.25 * (ball.z - hoopDepth)));
          g.beginPath(); g.arc(x, py, r, 0, 2 * Math.PI);
          const rubber = g.createRadialGradient(x - r * 0.35, py - r * 0.4, 0, x, py, r);
          rubber.addColorStop(0, '#ffba74'); rubber.addColorStop(0.56, '#ee772d'); rubber.addColorStop(1, '#a64018');
          g.fillStyle = rubber; g.fill();
          g.lineWidth = Math.max(1, r * 0.11); g.strokeStyle = '#57271c'; g.stroke();
          g.beginPath();
          g.ellipse(x, py, r * 0.94, r * 0.34, ball.spin, 0, 2 * Math.PI);
          g.stroke(); g.beginPath();
          g.ellipse(x, py, r * 0.94, r * 0.25, ball.spin + Math.PI / 2, 0, 2 * Math.PI);
          g.stroke();
        }
      } else {
        g.fillStyle = '#6a1630'; g.fillRect(X(-0.7), Y(1.2), 1.4 * k, 1.3 * k);
        g.fillStyle = '#8a5a32'; g.fillRect(X(-0.45), Y(0), 0.9 * k, 0.04 * k);
        sc.geo.cans.forEach(([x, y], i) => {
          const t0 = sc.fallAt[i]; if (t0 != null && now >= t0) return;
          g.fillStyle = i === sc.layout.jack && sc.jackLive ? '#ffc83a' : '#c8ccd2'; g.fillRect(X(x - sc.geo.w / 2 + 0.004), Y(y + sc.geo.h / 2 - 0.004), (sc.geo.w - 0.008) * k, (sc.geo.h - 0.008) * k);
          g.fillStyle = '#e8483f'; g.fillRect(X(x - sc.geo.w / 2 + 0.004), Y(y + 0.03), (sc.geo.w - 0.008) * k, 0.06 * k);
        });
        for (const f of sc.fly) {
          if (f.u <= 0 || f.u >= f.landU) continue;
          const s = f.shot, v = f.u / f.landU;
          g.beginPath(); g.arc(X(s.x * v), Y(s.y * v + 0.15 * Math.sin(Math.PI * v)), Math.max(4, 0.045 * k * (2 - v)), 0, 7); g.fillStyle = '#f4efe4'; g.fill(); g.strokeStyle = '#111'; g.stroke();
        }
      }
      if (sc.preview) {
        // #149: just the direction it leaves in, not where it lands
        const p = sc.preview, ex = X(p.x), ey = Y(p.y), u = 0.35, qx = (cx + ex) / 2, qy = ey - 40;
        const mx = (1 - u) ** 2 * cx + 2 * (1 - u) * u * qx + u * u * ex, my = (1 - u) ** 2 * (by + 20) + 2 * (1 - u) * u * qy + u * u * ey;
        g.setLineDash([4, 6]); g.strokeStyle = '#fffb'; g.beginPath(); g.moveTo(cx, by + 20); g.quadraticCurveTo(cx + (qx - cx) * u, by + 20 + (qy - by - 20) * u, mx, my); g.stroke(); g.setLineDash([]);
      }
      sparks = sparks.filter((s) => now < s.t + 600);
      for (const s of sparks) { const u = (now - s.t) / 600; g.beginPath(); g.arc(X(s.x), Y(s.y), 8 + u * 60, 0, 7); g.lineWidth = 4 * (1 - u); g.strokeStyle = s.c; g.stroke(); }
      g.lineWidth = 2;
    }
    return {
      draw, resize, moving: () => sparks.length > 0,
      impact(sh) { if (sh.pts) sparks.push({ x: sh.k === 'rings' ? sh.ex : sh.x, y: sh.k === 'rings' ? sh.ey : sh.y, t: performance.now(), c: sh.jack ? '#ffd23f' : '#fff' }); },
      dispose() { canvas.remove(); },
    };
  }

  const turnText = (s) => (s.phase === 'playing' && s.midway ? `🎪 Booth ${s.midway.round} of ${s.midway.rounds} · ${s.midway.name}` : null);
  const myMove = (s) => s.phase === 'playing' && s.midway?.stage === 'play' && !!s.midway.me && (s.midway.booths[s.midway.me]?.left ?? 0) > 0;
  return { mount, unmount, render, turnText, myMove, focus: true };
})();
