// Midway Night: a carnival booth in 3D (three.js) or flat. Everyone throws at once in their own copy of the booth.
// Skee Roll and Basketball use drag-to-aim and hold-to-release controls.
// The server decides where each throw lands; the page plays it out.
UI.midway = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null;
  let anims = [], seen = new Set(), watchId = null, watchKey = '', lastV = null, goAt = 0, endAt = 0, hoopAt = 0;
  let basketballRound;
  let charge, cancelCharge, heldBall = false, pendingShots = [], netStrike = null;
  let aim = 0, power = 0.5, swipe = null, lastThrow = 0, popT = 0, lastDraw = 0, lastTick = 0, fallAt = [];
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ICON = { skee: '🎳', rings: '⭕', cans: '🥫', hoops: '🏀' };
  const SKEE_FACE = '#123b42';
  const SKEE_RINGS = ['#fff0c5', '#d8a964', '#cb7157', '#a3c7b7', '#487d79'];
  const SKEE_WELL_DEPTH = 0.19;
  const SKEE_DIVIDER_HEIGHT = 0.042;
  function skeeScorePockets({ rings, cy, stacked }) {
    if (stacked) {
      return [...rings.map(([radius, points, center]) =>
        [0, points === 20 ? center - radius * 0.55 : center, Math.min(0.06, radius)]),
      [0, 0.09, 0.055]];
    }
    return rings.map(([outer], i) => {
      const inner = i ? rings[i - 1][0] : 0;
      return [0, i ? cy + (inner + outer) / 2 : cy, i ? (outer - inner) * 0.36 : outer * 0.86];
    });
  }
  const nameOf = (pid) => ctx?.player(pid)?.name ?? '?';
  const colorOf = (pid) => ctx?.player(pid)?.color ?? '#ccc';
  const watched = () => V?.booths?.[watchId];
  const hasShots = (view) => view.kind === 'hoops' || (view.booths[view.me]?.left ?? 0) > 0;
  const holdToThrow = () => V?.kind === 'skee' || V?.kind === 'hoops';
  const hoopRackSize = 5;
  const chargeDuration = () => V?.kind === 'hoops' ? 490 : 1000;
  let ballUid = 0;
  let rackBalls = [], rackTargets = [], heldBallX = 0, lastRackTick = 0, rackDebt = 0;
  const canPlay = () => !ctx?.readOnly && S?.phase === 'playing' && V?.stage === 'play' && V.me &&
    !watched()?.out && hasShots(V) && !S.paused && (!endAt || performance.now() < endAt);
  const canThrow = () => canPlay() && (V.kind !== 'hoops' || heldBall)
    && performance.now() - lastThrow > (V.gap ?? 0.8) * 1000 + 80;

  function pickUpBall(e) {
    if (!canPlay() || heldBall) return;
    const rect = $('mwStage').getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best, distance = Infinity;
    for (const target of rackTargets) {
      if (!target.ball.ready || !rackBalls.includes(target.ball)) continue;
      const d = Math.hypot(target.x - x, target.y - y);
      if (d < distance && d <= Math.max(19, target.radius + 7)) {
        best = target.ball;
        distance = d;
      }
    }
    if (!best) return;
    heldBall = best;
    heldBallX = best.x;
    aim = 0;
    rackBalls = takeRackBall(rackBalls, best);
    power = 0;
    controls();
  }

  function mount(main, side) {
    gl = null; flat = null; anims = []; seen = new Set(); watchId = null; watchKey = ''; lastV = null; goAt = endAt = 0; basketballRound = null;
    aim = 0; power = 0.5; swipe = null; lastThrow = 0; fallAt = []; heldBall = false; pendingShots = []; netStrike = null; rackBalls = []; rackTargets = [];
    main.innerHTML = `<div class="mw">
      <div id="mwSkeeScores" class="mw-skee-scores" hidden>
        <div><span id="mwSkeeScoreLabel">Round score</span><strong id="mwSkeeScore">0</strong></div>
        <div id="mwSkeeBestCard" hidden><span>Personal best</span><strong id="mwSkeeBest">—</strong></div>
      </div>
      <div class="mw-stage" id="mwStage">
        <div class="mw-hud"><span id="mwBooth"></span><div class="mw-display"><span id="mwScore" class="mw-score"></span><span id="mwClock" class="mw-clock"></span><span id="mwBest" class="mw-best" hidden></span></div></div>
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
        <button class="mw-go" id="mwGo">🎯 Throw</button>
      </div>
      <div class="mw-basket-toast" id="mwBasketToast" role="status"></div>
      <p id="mwHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🎟 Tickets</h3><div id="mwRace" class="mw-race"></div><div id="mwFeed" class="mw-feed"></div></div>';
    $('mwCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'mwGo') { if (!holdToThrow()) fire(); return; }
      if (charge) return;
      if (b.dataset.a) aim = clamp(aim + 0.08 * b.dataset.a, -1, 1);
      if (b.dataset.p) power = clamp(power + 0.04 * b.dataset.p, 0, 1);
      meter();
    });
    $('mwRace').addEventListener('click', (e) => {
      const row = e.target.closest('[data-pid]');
      if (row && (!V?.me || !hasShots(V) || V.stage !== 'play')) { watchId = row.dataset.pid; resync(); render(S, ctx); }
    });
    const roll = $('mwGo');
    function finishCharge(e, release = false) {
      if (!charge || (e && e.pointerId !== charge.id)) return;
      const { id, start, target } = charge;
      charge = null;
      if (target === $('mwStage')) swipe = null;
      if (target?.hasPointerCapture?.(id)) target.releasePointerCapture(id);
      power = release ? clamp((performance.now() - start) / chargeDuration(), 0, 1) : 0;
      meter();
      if (release) fire();
    }
    cancelCharge = () => finishCharge();
    roll.addEventListener('pointerdown', (e) => {
      if (!holdToThrow() || !canThrow() || charge || swipe || e.button !== 0) return;
      try { roll.setPointerCapture(e.pointerId); } catch {}
      charge = { id: e.pointerId, start: performance.now(), target: roll };
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
      if (charge || swipe || e.button !== 0 || e.target.closest('button, .mw-done')) return;
      const basketball = V?.kind === 'hoops';
      if (basketball) pickUpBall(e);
      if (!canThrow()) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, a: aim, p: power, startX: heldBallX };
      if (basketball) {
        power = 0;
        meter();
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const r = stage.getBoundingClientRect(), dx = e.clientX - swipe.x, dy = swipe.y - e.clientY;
      if (V.kind === 'hoops') {
        const dragRange = clamp(r.width * 0.48, 105, 220);
        if (heldBall) heldBallX = clamp(swipe.startX + dx / dragRange * 0.68, -0.68, 0.68);
        aim = clamp(swipe.a + dx / dragRange, -1, 1);
        power = clamp(dy / Math.max(75, r.height * 0.42), 0, 1);
        swipe.moved = Math.max(swipe.moved || 0, Math.hypot(dx, dy));
        swipe.dy = Math.max(swipe.dy || 0, dy);
        meter();
        return;
      }
      if (V.kind === 'skee') {
        aim = clamp(swipe.a + dx / Math.max(80, r.width * 0.38), -1, 1);
        if (!charge && -dy >= 18 && canThrow()) {
          charge = { id: e.pointerId, start: performance.now(), target: stage };
          power = 0;
          meter();
        }
        return;
      }
      aim = clamp(dx / Math.max(80, r.width * 0.38), -1, 1);
      power = clamp(dy / Math.max(120, r.height * 0.62), 0, 1);
      swipe.moved = Math.max(swipe.moved || 0, dy);
      meter();
    });
    stage.addEventListener('pointerup', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      if (V.kind === 'hoops') {
        const flicked = (swipe.dy || 0) > 28;
        if (!flicked) { aim = swipe.a; power = swipe.p; }
        swipe = null;
        meter();
        if (flicked && canThrow()) fire();
        return;
      }
      if (charge?.target === stage) {
        finishCharge(e, true);
        return;
      }
      if (holdToThrow()) { swipe = null; return; }
      const ok = (swipe.moved || 0) > 24;
      if (!ok) { aim = swipe.a; power = swipe.p; }
      swipe = null; meter();
      if (ok) fire();
    });
    function cancelSwipe(e) {
      if (!swipe || e.pointerId !== swipe.id) return;
      if (charge?.target === stage) finishCharge(e);
      else { aim = swipe.a; power = swipe.p; swipe = null; }
    }
    stage.addEventListener('pointercancel', cancelSwipe);
    stage.addEventListener('lostpointercapture', cancelSwipe);
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
    // A dry, audible wooden rumble and a few rolling knocks, timed with the lane animation.
    skeeRoll: () => snd((t, K, d) => {
      K.burst(d, t + 0.06, { type: 'lowpass', f: 280, f1: 150, q: 0.55, vol: 0.34, tau: 0.28, dur: 0.72, attack: 0.018, buf: 'brown' });
      for (let i = 0; i < 6; i++) {
        K.mode(d, t + 0.1 + i * 0.11, 115 + (i % 3) * 18, 0.085, 0.035, { f1: 82 });
        K.burst(d, t + 0.1 + i * 0.11, { type: 'bandpass', f: 310 + (i % 2) * 55, q: 0.65, vol: 0.065, tau: 0.025, dur: 0.07, attack: 0.002, buf: 'brown' });
      }
      K.burst(d, t + 0.79, { type: 'lowpass', f: 520, q: 0.6, vol: 0.18, tau: 0.025, dur: 0.12, attack: 0.002, buf: 'brown' });
    }, 0, 1),
    // A clean make snaps the net. After contact, leave room for the rim or glass.
    basketSwoosh: (clean) => snd((t, K, d) => K.burst(d, t, {
      type: 'bandpass', f: clean ? 2300 : 1150, f1: 650, q: 0.7,
      vol: clean ? 0.19 : 0.075, tau: clean ? 0.065 : 0.10,
      dur: 0.19, attack: clean ? 0.004 : 0.018, buf: 'pink',
    })),
    basketHot: () => snd((t, K, d) => K.mode(d, t + 0.075, 1319, 0.085, 0.075)),
    // a ball dropping into its ring, a clunk and a little rattle
    sink: (big) => snd((t, K, d) => { K.mode(d, t, 140, 0.25, 0.06, { f1: 100 }); K.burst(d, t, { type: 'bandpass', f: 1200, q: 1.5, vol: 0.12, tau: 0.02 }); for (let n = 1; n < 4; n++) K.mode(d, t + n * 0.07, 220 + n * 30, 0.06 / n, 0.03); if (big) [1047, 1319, 1568].forEach((f, n) => K.mode(d, t + 0.1 + n * 0.08, f, 0.06, 0.2)); }),
    // a ring on glass: a bright clink, ringing on a bottle
    clink: (on) => snd((t, K, d) => { K.mode(d, t, K.R(2400, 2900), 0.12, on ? 0.35 : 0.08); K.mode(d, t, K.R(3600, 4200), 0.05, 0.12); if (on) K.mode(d, t + 0.05, 1600, 0.06, 0.4); }),
    // a rubber ball on the iron rim: a low, short bonk with a faint hum, nothing like glass
    rimHit: () => snd((t, K, d) => {
      K.mode(d, t, K.R(170, 220), 0.26, 0.07, { f1: 120 });
      K.mode(d, t, K.R(520, 640), 0.05, 0.10);
      K.burst(d, t, { type: 'lowpass', f: 900, q: 0.7, vol: 0.12, tau: 0.025, buf: 'brown' });
    }),
    // a ball against the backboard (or a side rail, softer): a deep thud with a short glassy boom
    backboard: (vol = 1) => snd((t, K, d) => {
      K.mode(d, t, K.R(110, 140), 0.32, 0.09, { f1: 85 });
      K.mode(d, t, K.R(300, 360), 0.07, 0.14);
      K.burst(d, t, { type: 'lowpass', f: 700, q: 0.7, vol: 0.14, tau: 0.03, buf: 'brown' });
    }, 0, vol),
    // a ring landing on the table
    tap: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 900, q: 1.2, vol: 0.16, tau: 0.02 }); K.mode(d, t, 300, 0.05, 0.03); }),
    // a ball into a tin pyramid: the smack, then cans clattering for each that falls
    clatter: (n) => snd((t, K, d) => {
      K.burst(d, t, { type: 'bandpass', f: 1800, q: 0.9, vol: 0.35, tau: 0.03 }); K.mode(d, t, 520, 0.12, 0.08);
      for (let k = 0; k < n * 2; k++) { const s = t + 0.05 + K.R(0, 0.5); K.mode(d, s, K.R(700, 1500), 0.05, 0.05); K.burst(d, s, { type: 'bandpass', f: K.R(2000, 4000), q: 2, vol: 0.06, tau: 0.015 }); }
    }),
    // a ball into the canvas backdrop
    flop: () => snd((t, K, d) => K.burst(d, t, { type: 'lowpass', f: 500, q: 0.7, vol: 0.25, tau: 0.05, buf: 'brown' })),
    buzzer: (ending) => snd((t, K, d) => {
      const duration = ending ? 0.76 : 0.34;
      K.sweep(d, t, { f0: 153, f1: 147, dur: duration, vol: 0.14, type: 'sawtooth', attack: 0.018 });
      K.sweep(d, t, { f0: 310, f1: 300, dur: duration, vol: 0.05, type: 'square', attack: 0.025 });
    }),
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
    if (V.kind !== 'hoops') ctx.sfx?.('whoosh');
    ctx.buzz?.(12);
    const request = ctx.act('throw', { aim: +aim.toFixed(3), power: +power.toFixed(3), ...(V.kind === 'hoops' ? { startX: +heldBallX.toFixed(3) } : {}) });
    if (V.kind === 'hoops') {
      const pending = { ball: heldBall, startX: heldBallX };
      // the ball leaves the hand now, on the plain arc this aim and power would give; the server's flight replaces it
      const guess = spot(aim, power);
      pending.anim = {
        shot: { id: -(++ballUid), t: hoopShowTime, x: guess.x, y: guess.y, startX: heldBallX, aim, hoop: null, k: 'hoops' },
        t0: performance.now(), hit: true, nextContact: 1e9, predicted: true, ball: pending.ball,
      };
      pending.anim.flightPath = basketballPath(pending.anim.shot);
      anims.push(pending.anim);
      pendingShots.push(pending);
      heldBall = false;
      ctx.quiet(request.catch(() => {
        const index = pendingShots.indexOf(pending);
        if (index < 0) return;
        anims = anims.filter((a) => a !== pending.anim);
        pendingShots.splice(index, 1);
        heldBall = pending.ball;
        heldBallX = pending.startX;
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
    heldBall = false; pendingShots = []; netStrike = null; rackTargets = [];
    lastRackTick = rackDebt = 0;
    rackBalls = V.kind === 'hoops'
      ? Array.from({ length: hoopRackSize }, (_, i) => rackBall((i - (hoopRackSize - 1) / 2) * 0.34))
      : [];
    fallAt = (b?.cans || []).map((up) => (up ? null : -1e9));
  }

  function render(s, c) {
    const previousShot = watched()?.shots.at(-1)?.id ?? 0;
    S = s; ctx = c; V = s.midway;
    const now = performance.now();
    if (V !== lastV) {
      const lastRound = lastV?.round;
      lastV = V;
      if (V.stage === 'count') goAt = now + V.startIn * 1000;
      else if (V.kind !== 'hoops' || lastRound !== V.round || V.stage !== 'play') goAt = 0;
      hoopAt = now - (V.hoopElapsed ?? 0) * 1000;
      endAt = V.stage === 'play' || V.stage === 'settle' ? (V.timeLeft == null ? 0 : now + V.timeLeft * 1000) : 0;
    }
    if (!V.booths[watchId] || (V.me && watchId !== V.me && hasShots(V) && V.stage === 'play')) watchId = V.me ?? V.seats[0];
    const key = `${V.round}:${watchId}`;
    if (key !== watchKey) { cancelCharge?.(); swipe = null; watchKey = key; resync(); aim = 0; power = 0.5; }
    const b = watched();
    if (ctx.readOnly && previousShot > (b?.shots.at(-1)?.id ?? 0)) {
      resync();
      $('mwPop').hidden = true;
    }
    let stagger = 0;
    for (const sh of b?.shots || []) {
      if (seen.has(sh.id)) continue;
      seen.add(sh.id);
      const pendingIndex = sh.k === 'hoops' && pendingShots.length ? 0 : -1;
      const pendingShot = pendingIndex >= 0 ? pendingShots[pendingIndex] : null;
      if (pendingShot) sh.startX = pendingShot.startX;
      const flightPath = sh.k === 'hoops' ? basketballPath(sh) : null;
      let ball;
      if (flightPath) {
        if (pendingIndex >= 0) {
          ball = pendingShots[pendingIndex].ball;
          pendingShots.splice(pendingIndex, 1);
        } else {
          const launchX = sh.startX ?? hoopHandX(sh.aim);
          const rackIndex = rackBalls.findIndex((candidate) => candidate.ready && !candidate.transient);
          if (rackIndex >= 0) {
            ball = rackBalls[rackIndex];
            for (let i = rackIndex + 1; i < rackBalls.length; i++) {
              const candidate = rackBalls[i];
              if (candidate.ready && !candidate.transient && Math.abs(candidate.x - launchX) < Math.abs(ball.x - launchX)) ball = candidate;
            }
            rackBalls = takeRackBall(rackBalls, ball);
          }
        }
      }
      // a shot this player just released has been flying since the release: carry on from there
      let t0 = now + stagger;
      if (pendingShot?.anim) {
        const guess = pendingShot.anim;
        anims = anims.filter((a) => a !== guess);
        if (now - guess.t0 < 1200) t0 = guess.t0;
      }
      anims.push({ shot: sh, t0, hit: false, flightPath, ball, nextContact: 1 });
      stagger += 120;
    }
    const basketball = V.kind === 'hoops';
    const stage = $('mwStage'), meterBox = $('mwPow').parentElement;
    $('mwSkeeScores').hidden = V.kind !== 'skee';
    stage.classList.toggle('mw-skee', V.kind === 'skee');
    $('mwSkeeScoreLabel').textContent = V.stage === 'between' ? 'Final score' : 'Round score';
    const expanded = stage.parentElement.classList.toggle('mw-basketball', basketball);
    if (expanded !== (meterBox.parentElement === stage)) {
      if (expanded) stage.append(meterBox);
      else $('mwCtl').querySelector('[data-a="1"]').before(meterBox);
      (gl || flat)?.resize();
    }
    const helper = $('mwHint'), toastSlot = $('mwBasketToast');
    if (basketball && stage.previousElementSibling !== helper) stage.before(helper);
    if (!basketball && toastSlot.nextElementSibling !== helper) toastSlot.after(helper);
    const pop = $('mwPop'), toastParent = basketball ? toastSlot : stage;
    if (pop.parentElement !== toastParent) {
      pop.hidden = true;
      pop.classList.remove('mw-pop-in');
      toastParent.append(pop);
    }
    hud(); boothRecord(); controls(); race(); feed(); done(); hint();
  }

  function boothRecord() {
    const display = $('mwBest');
    const booth = V.booths[V.me];
    const skee = V.kind === 'skee';
    const timedBasketball = V.kind === 'hoops' && V.clock > 0;
    const eligible = !!booth && !ctx.readOnly;
    display.hidden = !timedBasketball || !eligible;
    $('mwSkeeBestCard').hidden = !skee || !eligible;
    if ((!skee && !timedBasketball) || !eligible) return;
    const key = skee ? (V.geo.stacked ? 'midway.skee.stacked.best' : 'midway.skee.best')
      : `midway.basketball.best.${V.clock}.${V.geo.travel > 0 ? 'moving' : 'fixed'}`;
    const saved = load(key);
    let best = Number.isSafeInteger(saved) && saved >= 0 ? saved : null;
    const complete = V.stage === 'between' || (!skee && V.stage === 'settle');
    const score = booth.pts;
    if (complete && !booth.out && Number.isSafeInteger(score) && score >= 0 &&
        (best === null || score > best)) {
      best = score;
      store(key, best);
    }
    if (skee) {
      $('mwSkeeBest').textContent = best ?? '—';
    } else {
      setLed(display, 'BEST', best === null ? '----' : String(best).padStart(4, '0'));
    }
  }

  function hud() {
    const b = watched();
    $('mwBooth').textContent = `${ICON[V.kind]} ${V.name.replace(/^\S+ /, '')} · ${V.round}/${V.rounds}`;
    const n = b?.left ?? 0;
    if (V.kind !== 'hoops') {
      const balls = $('mwBalls');
      balls.textContent = '●'.repeat(n) + '○'.repeat(Math.max(0, V.throws - n));
    }
    $('mwHot').hidden = !(b && b.streak >= V.hotAt);
    $('mwJack').textContent = V.kind === 'hoops' ? '' : V.jackBy ? `🔔 ${V.jackBy} got the jackpot` : '🔔 Jackpot up!';
    $('mwJack').classList.toggle('taken', !!V.jackBy);
    const w = $('mwWatch');
    w.hidden = !watchId || watchId === V.me;
    if (!w.hidden) { w.textContent = `👀 Watching ${nameOf(watchId)}`; w.style.color = colorOf(watchId); }
  }

  function meter() {
    const percent = `${Math.round(power * 100)}%`;
    const basketball = V?.kind === 'hoops';
    const fill = $('mwPow');
    if (fill) fill.style.height = basketball && !charge ? '0%' : percent;
    const button = $('mwGo');
    if (!button) return;
    const label = holdToThrow()
      ? `${charge ? 'Release to' : 'Hold to'} ${basketball ? 'shoot' : 'roll'}`
      : '🎯 Throw';
    if (button.textContent !== label) button.textContent = label;
    button.classList.toggle('mw-charging', !!charge);
    if (charge) button.style.setProperty('--mw-charge', percent);
  }

  // a red seven-segment readout: lit segments over faint unlit ones, drawn as SVG. Returns whether it changed.
  const LED_DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  const LED_BARS = { a: [1, 1, 9, 1], b: [9, 1.5, 9, 8.5], c: [9, 9.5, 9, 16.5], d: [1, 17, 9, 17], e: [1, 9.5, 1, 16.5], f: [1, 1.5, 1, 8.5], g: [1, 9, 9, 9] };
  function ledBar([x1, y1, x2, y2]) {
    return y1 === y2 ? `${x1},${y1} ${x1 + 1},${y1 - 1} ${x2 - 1},${y1 - 1} ${x2},${y1} ${x2 - 1},${y1 + 1} ${x1 + 1},${y1 + 1}`
      : `${x1},${y1} ${x1 + 1},${y1 + 1} ${x1 + 1},${y2 - 1} ${x1},${y2} ${x1 - 1},${y2 - 1} ${x1 - 1},${y1 + 1}`;
  }
  function setLed(el, label, value) {
    const key = label + value;
    if (el.dataset.led === key) return false;
    el.dataset.led = key;
    const digits = [...value].map((ch, i) => {
      const lit = LED_DIGITS[ch] || '';
      return `<g transform="translate(${i * 13} 0)">${Object.entries(LED_BARS).map(([seg, bar]) =>
        `<polygon class="${lit.includes(seg) ? 'on' : 'off'}" points="${ledBar(bar)}"/>`).join('')}</g>`;
    }).join('');
    el.innerHTML = `<small>${label}</small><svg class="mw-led" viewBox="-1 -1 ${value.length * 13 + 1} 20" role="img" aria-label="${label} ${value}">${digits}</svg>`;
    return true;
  }

  function controls() {
    if (!V) return;
    const go = canThrow();
    if (!go) cancelCharge?.();
    $('mwCtl').classList.toggle('mw-hold', holdToThrow());
    $('mwGo').disabled = !go;
    $('mwGo').classList.toggle('mw-ready', go);
    $('mwCtl').classList.toggle('mw-off', !(V.me && hasShots(V) && V.stage !== 'between'));
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
      const progress = V.kind === 'hoops' ? `${r.shots.length} shots` : r.left ? '●'.repeat(r.left) : '✓';
      const extra = ctx.el('small', '', `${progress}${r.streak >= V.hotAt ? ' 🔥' : ''}${r.jackpots ? ' 🔔'.repeat(r.jackpots) : ''}`);
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
        : !hasShots(V) ? 'Out of throws: tap a name to watch a rival.'
          : { skee: 'Drag sideways to aim. Pull back and hold to charge, then release to roll. Aim for 50, 40 or 30, or the corner 100s.',
              rings: 'Swipe up to toss: a longer swipe reaches the back rows. Red bottles pay 80.',
              hoops: 'Tap a ball to pick it up. Flick up to shoot, with a slight left or right flick to adjust aim.',
              cans: 'Swipe up to throw: a longer swipe throws higher. Hit the bottom row and the cans above it fall too.' }[V.kind];
    if ($('mwHint').textContent !== t) $('mwHint').textContent = t;
  }

  function pop(sh) {
    const el = $('mwPop'); if (!el) return;
    const words = sh.k === 'skee' ? (sh.jack ? '🔔 Jackpot!' :
      sh.where === 'short' ? 'Short · 0' : sh.rattle ? 'Rattled in!' :
        sh.where === 'cup' ? 'Corner cup!' : sh.where === 'gutter' ? 'Gutter' : 'Pocket')
      : sh.k === 'hoops' ? (sh.swish ? 'SWISH!' : sh.bank ? 'BANK!' : 'BASKET')
        : sh.k === 'rings' ? (sh.b == null ? 'Miss' : 'RINGER!') : (sh.fell.length ? `${sh.fell.length} can${sh.fell.length > 1 ? 's' : ''}` : 'Miss');
    el.textContent = `${words}${sh.pts ? ` +${sh.pts}` : ''}${sh.hot ? ' 🔥' : ''}${sh.jack && sh.k !== 'skee' ? '  🔔 JACKPOT' : ''}${sh.sweep ? '  🥫 SWEEP' : ''}`.trim();
    const madeBasket = sh.k === 'hoops' && sh.hoop != null;
    el.classList.toggle('mw-made', madeBasket);
    el.classList.toggle('mw-jackpot', sh.k === 'skee' && !!sh.jack);
    el.style.color = madeBasket ? '#aaff9d' : sh.jack ? '#ffd23f' : sh.pts ? '#fff' : '#ff9a9a';
    el.hidden = false;
    if (sh.k !== 'hoops') {
      el.classList.remove('mw-pop-in');
      void el.offsetWidth;
      el.classList.add('mw-pop-in');
    }
    popT = performance.now() + 1300;
  }

  // the moment a throw lands, for the watched booth
  function land(a, now) {
    const sh = a.shot, mine = watchId === V.me;
    if (sh.k === 'skee') {
      if (!ctx.readOnly) {
        if (sh.where === 'short') SND.tap();
        else SND.sink(sh.pts >= 50);
      }
    }
    else if (sh.k === 'rings') sh.b != null ? SND.clink(true) : SND.tap();
    else if (sh.k === 'hoops') {
      if (sh.hoop != null) {
        netStrike = { at: now, offset: (sh.path?.at(-1)?.[1] ?? sh.x) - (sh.targetX ?? sh.x) };
        SND.basketSwoosh(sh.swish === true && !sh.bank);
        if (sh.hot) SND.basketHot();
      } else if (!sh.path?.some((k) => k[7] === 'rim' || k[7] === 'board' || k[7] === 'wall')) SND.flop();
    }
    else if (sh.fell.length) {
      SND.clatter(sh.fell.length);
      for (const i of sh.fell) if (fallAt[i] == null || fallAt[i] < 0) fallAt[i] = now + Math.random() * 140;
      if (sh.sweep) a.restack = now + 1100;
    } else SND.flop();
    if (mine) ctx.buzz?.(sh.jack ? [40, 30, 60] : sh.pts ? 25 : 8);
    if (sh.k !== 'hoops' || sh.hoop != null) pop(sh);
    (gl || flat)?.impact?.(sh);
  }

  // where a throw with this aim and power lands on the booth, no wobble (the server's map, from geo)
  const spot = (a, p) => { const m = V.geo.map; return { x: a * m[0], y: p * m[1] + m[2] }; };

  function scene(now) {
    const b = watched();
    const fly = [], basketballs = [];
    const age = netStrike ? (now - netStrike.at) / 1000 : Infinity;
    const netHit = age < 1.45 ? { age, offset: netStrike.offset } : null;
    const scoreGlow = Math.max(0, 1 - age / 0.72);
    for (const a of anims) {
      const u = Math.max(0, (now - a.t0) / 1000 / a.shot.t);
      if (a.flightPath) {
        if (!a.returned && now >= a.t0) {
          const p = basketballSample(a.flightPath, (now - a.t0) / 1000);
          p.uid = a.uid ??= (a.ball ? a.ball.uid ??= ++ballUid : ++ballUid);
          basketballs.push(p);
        }
      } else fly.push({ shot: a.shot, u: Math.min(1, u), landU: HIT[a.shot.k] });
    }
    const pending = new Set(anims.filter((a) => !a.hit).map((a) => a.shot.id));
    const preview = canThrow() || swipe ? { ...spot(aim, power), aim, startX: heldBall ? heldBallX : hoopHandX(aim) } : null;
    if (V.kind === 'hoops') {
      basketballs.push(...rackBalls.map((ball) => ({ ...ball, uid: ball.uid ??= ++ballUid })));
      if (heldBall) basketballs.push({ x: heldBallX, y: 1.17, z: hoopLaunchZ, spin: heldBall.spin ?? 0, uid: heldBall.uid ??= ++ballUid });
    }
    const movingHoop = V.kind === 'hoops' && V.geo.travel > 0 && (V.stage === 'play' || V.stage === 'settle');
    const elapsed = movingHoop && !S.paused ? Math.max(0, (now - hoopAt) / 1000) : V.hoopElapsed ?? 0;
    const { hoopX, netDrift } = basketballHoopMotion(movingHoop ? elapsed : 0, V.geo);
    return {
      rack: rackBalls.filter((ball) => ball.ready && !ball.transient), hoopX, netHit, netDrift, scoreGlow, movingHoop: movingHoop && !S.paused,
      kind: V.kind, geo: V.geo, layout: V.layout, jackLive: !V.jackBy && !(V.kind === 'cans' && b?.stacks),
      shots: (b?.shots || []).filter((s) => !pending.has(s.id)), fly, basketballs, fallAt, now, preview, swiping: !!swipe, charging: !!charge, chargePower: charge ? power : 0, left: b?.left ?? 0,
      pts: (b?.pts ?? 0) - (b?.shots || []).filter((s) => pending.has(s.id)).reduce((a, s) => a + s.pts, 0),
      color: colorOf(watchId),
    };
  }
  // the share of a throw's play-out at which it lands
  const HIT = { skee: 0.85, rings: 0.75, cans: 0.55, hoops: 0.73 };

  const hoopStep = 1 / 120;
  const maxReturnFrame = 42 * hoopStep;
  const hoopRadius = 0.155;
  const hoopDepth = -2.42;
  const hoopRackZ = -0.86;
  const hoopReturnZ = hoopRackZ - 0.14;
  const hoopSlope = 0.24;
  // Cabinet proportions follow a 44-inch-wide, 86-inch-deep, 70-inch-tall arcade unit.
  const cabinetHeightScale = 1.14;
  const cabinetDepthScale = 1.68;
  const cabinetFloorY = 0.69;
  const hoopRampY = (z) => cabinetFloorY + hoopRadius + (hoopRackZ - z) * hoopSlope;

  const returnScale = [1, cabinetHeightScale, cabinetDepthScale];
  const returnDiameter = 2 * hoopRadius;
  // A ball stopped behind the front row is still within reach in the tray.
  const returnPickupZ = hoopRackZ - returnDiameter / cabinetDepthScale - 0.01;
  const returnWall = 0.92 - hoopRadius;
  const returnFloorSlope = hoopSlope * cabinetHeightScale / cabinetDepthScale;
  const returnFloorLength = Math.hypot(1, returnFloorSlope);
  const returnFloor = [0, 1 / returnFloorLength, returnFloorSlope / returnFloorLength];
  const dotReturn = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const offsetReturn = (a, b, amount) => {
    for (let i = 0; i < 3; i++) a[i] += b[i] * amount;
  };
  // Plane offsets and velocities are in the same space as the rendered spheres.
  const returnPlanes = [
    [returnFloor, hoopRampY(0) * cabinetHeightScale / returnFloorLength, 0.49],
    [[1, 0, 0], -returnWall, 0.48],
    [[-1, 0, 0], -returnWall, 0.48],
    [[0, 0, 1], -2.5295 * cabinetDepthScale, 0.55],
    [[0, 0, -1], -hoopRackZ * cabinetDepthScale, 0.18],
  ];
  const rackBall = (x) => ({
    x, y: hoopRampY(hoopRackZ), z: hoopRackZ, spin: 0,
    velocity: [0, 0, 0], quietSteps: 12, ready: true, stillSteps: 12, sleeping: true,
  });

  function takeRackBall(balls, ball) {
    const remaining = balls.filter((resting) => resting !== ball);
    // Removing a support can release other balls even without an impact.
    for (const resting of remaining) {
      resting.sleeping = false;
      resting.stillSteps = 0;
    }
    return remaining;
  }

  function beginBasketballReturn(ball, shot, last) {
    const slowdown = shot.hoop != null ? [0.25, 0.65, 0.2] : [1, 1, 1];
    Object.assign(ball, {
      x: last[1], y: last[2], z: last[3], spin: last[0] * 9,
      velocity: returnScale.map((scale, i) => last[i + 4] * scale * slowdown[i]),
      quietSteps: 0, ready: false, stillSteps: 0, sleeping: false,
    });
    return ball;
  }

  function stepBasketballReturn(balls) {
    if (balls.every((ball) => ball.sleeping)) return false;
    const bodies = balls.map((ball) => ({
      ball, position: [ball.x, ball.y * cabinetHeightScale, ball.z * cabinetDepthScale],
      velocity: ball.velocity,
    }));
    for (const body of bodies) {
      const { position, velocity } = body;
      if (dotReturn(position, returnFloor) - returnPlanes[0][1] < 0.002) {
        const inTray = body.ball.z >= hoopReturnZ;
        const drag = 1 - Math.exp(-(inTray ? 5.5 : 1.2) * hoopStep);
        // Static friction resists slow sideways creep under a neighboring ball.
        if (inTray && Math.abs(velocity[0]) < 0.045) velocity[0] = 0;
        const normalSpeed = dotReturn(velocity, returnFloor);
        for (let i = 0; i < 3; i++) velocity[i] -= (velocity[i] - returnFloor[i] * normalSpeed) * drag;
      }
      if (!body.ball.sleeping) velocity[1] -= gravity * cabinetHeightScale * hoopStep;
    }
    let remaining = hoopStep;
    // Find the earliest swept contact, then advance every ball to that instant.
    // The cap bounds crowded, nearly simultaneous contacts. Remaining time is
    // dropped if the cap is reached so we never advance through unchecked geometry.
    for (let event = 0; event < 32 && remaining > 1e-8; event++) {
      let time = remaining, contact;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        for (const [normal, limit, bounce] of returnPlanes) {
          const speed = dotReturn(a.velocity, normal);
          const gap = dotReturn(a.position, normal) - limit;
          const hit = speed < -1e-7 ? Math.max(0, gap / -speed) : Infinity;
          if (hit > time) continue;
          time = hit;
          contact = { a, normal, speed, bounce, depth: Math.max(0, -gap) };
        }
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          const delta = a.position.map((v, axis) => v - b.position[axis]);
          const relative = a.velocity.map((v, axis) => v - b.velocity[axis]);
          const approach = dotReturn(delta, relative);
          const squaredGap = dotReturn(delta, delta) - returnDiameter ** 2;
          const speedSquared = dotReturn(relative, relative);
          const discriminant = approach ** 2 - speedSquared * squaredGap;
          const hit = squaredGap < -1e-6 ? 0 : approach < -1e-7 && discriminant >= 0
            ? Math.max(0, squaredGap / (-approach + Math.sqrt(discriminant))) : Infinity;
          if (hit > time) continue;
          const normal = delta.map((v, axis) => v + relative[axis] * hit);
          const distance = Math.hypot(...normal);
          if (distance > 1e-8) normal.forEach((v, axis) => { normal[axis] = v / distance; });
          else normal[0] = 1;
          time = hit;
          contact = { a, b, normal, speed: dotReturn(relative, normal), bounce: 0.32,
            depth: Math.max(0, returnDiameter - distance) };
        }
      }
      for (const body of bodies) offsetReturn(body.position, body.velocity, time);
      remaining -= time;
      if (!contact) break;
      const { a, b, normal, speed, bounce, depth } = contact;
      // At low speed the tray resists sideways sliding, but a strike
      // still transfers momentum along the full sphere contact normal.
      const supported = (body) => body.ball.z >= hoopReturnZ &&
        dotReturn(body.position, returnFloor) - returnPlanes[0][1] < 0.002;
      const staticContact = b && Math.abs(normal[2]) > 0.2 && speed > -0.18 &&
        Math.abs(a.velocity[0]) + Math.abs(b.velocity[0]) < 0.045 && supported(a) && supported(b);
      const response = staticContact ? [0, normal[1], normal[2]] : normal;
      const share = b ? 0.5 / dotReturn(normal, response) : 1;
      const impulse = Math.max(0, -speed) * (speed < -0.45 ? 1 + bounce : 1) * share;
      offsetReturn(a.velocity, response, impulse);
      offsetReturn(a.position, response, (depth + 1e-7) * share);
      if (b) {
        offsetReturn(b.velocity, response, -impulse);
        offsetReturn(b.position, response, -(depth + 1e-7) * share);
      }
    }
    let moved = false;
    for (const { ball, position, velocity } of bodies) {
      // A server keyframe can already be slightly inside the return geometry.
      for (const [normal, limit] of returnPlanes) {
        const gap = dotReturn(position, normal) - limit;
        if (gap < 0) offsetReturn(position, normal, -gap);
      }
      const [x, y, z] = position.map((v, i) => v / returnScale[i]);
      const travel = Math.hypot(x - ball.x, (z - ball.z) * cabinetDepthScale);
      const nearFloor = y <= hoopRampY(z) + 0.008;
      const rackSpeed = Math.hypot(...velocity);
      const quiet = z >= returnPickupZ && nearFloor && rackSpeed < 0.13;
      ball.quietSteps = quiet ? Math.min(12, ball.quietSteps + 1) : 0;
      // Make a slowly rolling ball available as soon as it reaches the tray.
      const ready = z >= returnPickupZ && nearFloor && rackSpeed < 0.55;
      moved ||= travel > 1e-5 || Math.abs(y - ball.y) > 1e-5 || ready !== ball.ready;
      // A settled ball participates in swept collisions without repeatedly
      // spending the shared event budget on gravity against the tray.
      const still = quiet && travel < 0.00025 && Math.abs(y - ball.y) < 0.00025;
      ball.stillSteps = still ? Math.min(12, ball.stillSteps + 1) : 0;
      ball.sleeping = ball.stillSteps === 12;
      if (ball.sleeping) velocity.fill(0);
      ball.spin += nearFloor ? travel / hoopRadius : hoopStep * 5;
      Object.assign(ball, { x, y, z, ready });
    }
    return moved;
  }

  function advanceBasketballReturn(balls, debt, elapsed) {
    // Keep pace on slow frames while bounding work after a suspended tab resumes.
    debt += elapsed > 0.5 ? 15 * hoopStep : Math.min(elapsed, maxReturnFrame);
    let moved = false;
    while (debt + 1e-9 >= hoopStep) {
      moved = stepBasketballReturn(balls) || moved;
      debt -= hoopStep;
    }
    return { debt, moved };
  }

  const hoopLaunchZ = -0.50;
  const hoopShowTime = 1.1;
  const gravity = 9.81;

  const hoopHandX = (aim) => (aim ?? 0) * 0.28;

  function basketballHoopMotion(elapsed, { period = 1, travel = 0, centerPause = 0 }) {
    const leg = period / 2 + centerPause;
    const clock = Math.max(0, elapsed) % (2 * leg);
    const away = Math.max(0, clock % leg - centerPause);
    const direction = clock < leg ? 1 : -1;
    const phase = 2 * Math.PI * away / period;
    return {
      hoopX: direction * travel * Math.sin(phase) ** 2,
      netDrift: travel ? -direction * 0.028 * Math.sin(2 * phase) : 0,
    };
  }

  function basketballFlight(shot, time, duration) {
    const progress = time / duration;
    const startX = shot.startX ?? hoopHandX(shot.aim);
    return {
      x: startX + (shot.x - startX) * progress,
      y: 1.17 + (shot.y - 0.17) * progress + gravity * time * (duration - time) / 2,
      z: hoopLaunchZ + (hoopDepth - hoopLaunchZ) * progress,
      spin: time * 9,
    };
  }

  const hoopBoardZ = -2.622;   // the ball bounces with its surface on this plane, just behind the ring
  const boardHalfWidth = 0.92;   // inside the side rails, where the walls stop a ball's surface
  const boardBottom = 0.66, boardTop = 1.50;   // entry-plane heights: the rim up to the top bar
  const hoopTubeRadius = 0.013;
  const hoopRingRadius = (width) => width + 0.052;

  const netRows = 5, netKnots = 12, netSubdivisions = 3;
  const netWeave = [];
  for (let row = 0; row < netRows; row++) {
    for (let i = 0; i < netKnots; i++) {
      const upper = row * netKnots + i;
      const lower = upper + netKnots;
      const neighbor = (row + 1) * netKnots + (i + (row % 2 ? 1 : netKnots - 1)) % netKnots;
      netWeave.push([upper, lower], [upper, neighbor]);
    }
  }

  function basketballRimTilt(hit) {
    const age = hit?.age ?? 0;
    return -0.035 * Math.sin(age * 22) * Math.exp(-7 * age);
  }

  function basketballNet(radius, hit, drift = 0) {
    const knots = [];
    for (let row = 0; row <= netRows; row++) {
      const depth = row / netRows;
      // The rim attachments stay fixed while the opening pulse runs down the net.
      const time = Math.max(0, (hit?.age ?? 0) - 0.14 * depth);
      const decay = hit ? depth * Math.exp(-4 * time) : 0;
      const pulse = Math.sin(time * 24) * decay;
      const swing = Math.sin(time * 11) * decay;
      const sway = drift * depth ** 2 + swing * clamp((hit?.offset ?? 0) * 1.5, -0.15, 0.15);
      const width = radius * (0.47 + 0.53 * (1 - depth) ** 1.4) + 0.09 * pulse;
      for (let i = 0; i < netKnots; i++) {
        const a = (i + (row % 2) / 2) * 2 * Math.PI / netKnots + 0.37 * swing;
        const billow = 0.018 * decay * Math.sin(19 * time + 2 * a) * Math.min(1, time * 25);
        knots.push({
          x: sway + Math.cos(a) * (width + billow),
          y: -0.45 * depth - 0.115 * pulse + 0.035 * swing * Math.cos(a),
          z: Math.sin(a) * (width + billow) + 0.095 * swing,
        });
      }
    }
    return knots;
  }

  // Both renderers show the same tapering arc through the first part of the flight.
  function basketballGuide(shot, index, count) {
    const t = index / (count - 1);
    const duration = hoopShowTime * HIT.hoops;
    return basketballFlight(shot, (0.12 + 0.50 * t) * duration, duration);
  }

  // The server's flight as keyframes [t, x, y, z, vx, vy, vz, kind]: launch, each contact, then the landing.
  // Between keyframes the ball is in free fall. A shot without a path (an older one) is a plain arc.
  function netCordPoint(a, b, t) {
    const bow = 4 * t * (1 - t);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t - 0.009 * bow,
      z: a.z + (b.z - a.z) * t,
    };
  }

  function basketballPath(shot) {
    if (shot.path) return shot.path;
    const T = shot.t * HIT.hoops, startX = shot.startX ?? hoopHandX(shot.aim);
    return [[0, startX, 1.17, hoopLaunchZ, (shot.x - startX) / T, (shot.y - 0.17) / T + gravity * T / 2, (hoopDepth - hoopLaunchZ) / T, 'launch'],
      [T, shot.x, shot.y + 1, hoopDepth, (shot.x - startX) / T, (shot.y - 0.17) / T - gravity * T / 2, (hoopDepth - hoopLaunchZ) / T, shot.hoop != null ? 'net' : 'end']];
  }

  function basketballSample(path, time) {
    let segment = 0;
    while (segment + 1 < path.length && path[segment + 1][0] <= time) segment++;
    const [start, x, y, z, vx, vy, vz] = path[segment];
    const dt = Math.min(time, path.at(-1)[0]) - start;
    return { x: x + vx * dt, y: y + vy * dt - gravity * dt * dt / 2, z: z + vz * dt, spin: time * 9 };
  }

  function loop(now) {
    if (!$('mwStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    const rackDt = lastRackTick ? Math.max(0, (now - lastRackTick) / 1000) : 0;
    lastRackTick = now;
    const availableBefore = rackBalls.filter((ball) => ball.ready && !ball.transient).length;
    let rackMoved = false;
    if (V.kind === 'hoops' && !S.paused) {
      const result = advanceBasketballReturn(rackBalls, rackDebt, rackDt);
      rackDebt = result.debt;
      rackMoved = result.moved;
      rackBalls = rackBalls.filter((ball) => !ball.transient || !ball.ready);
    }
    for (const a of anims) {
      if (a.predicted) { if (now - a.t0 > 2500) a.dead = true; continue; }
      const elapsed = (now - a.t0) / 1000;
      if (a.shot.k === 'skee' && elapsed >= 0 && !a.started) {
        a.started = true;
        if (!ctx.readOnly) SND.skeeRoll();
      }
      // each contact in the server's flight sounds at its own moment
      for (const path = a.shot.path; path && a.nextContact < path.length && elapsed >= path[a.nextContact][0]; a.nextContact++) {
        const kind = path[a.nextContact][7];
        if (kind === 'rim') SND.rimHit();
        else if (kind === 'board' || kind === 'wall') SND.backboard();
        else if (kind === 'rail') SND.backboard(0.5);
      }
      if (!a.hit && elapsed >= (a.shot.landAt ?? a.shot.t * HIT[a.shot.k])) { a.hit = true; land(a, now); }
      if (a.flightPath && !a.returned && !S.paused && elapsed >= a.flightPath.at(-1)[0]) {
        const ball = a.ball ?? { transient: true };
        ball.uid = a.uid ?? ball.uid ?? ++ballUid;
        rackBalls.push(beginBasketballReturn(ball, a.shot, a.flightPath.at(-1)));
        a.returned = true;
        rackMoved = true;
      }
      if (a.restack && now >= a.restack) { a.restack = 0; fallAt = fallAt.map(() => null); }
    }
    anims = anims.filter((a) => !a.dead && (a.flightPath ? !a.returned : now - a.t0 < a.shot.t * 1000 + 900 || a.restack));
    if (popT && now > popT) { popT = 0; $('mwPop').hidden = true; }
    // The buzzer belongs to the round, independent of who is being watched.
    const hoopsClock = V.kind === 'hoops';
    let clockEnded = false;
    if (hoopsClock) {
      if (basketballRound?.round !== V.round) basketballRound = { round: V.round };
      basketballRound.expired ||= V.stage === 'settle' || V.stage === 'between' || S.phase === 'over' ||
        (!S.paused && V.stage === 'play' && endAt > 0 && now >= endAt);
      clockEnded = basketballRound.expired;
      basketballRound.counted ||= V.stage === 'count';
      basketballRound.played ||= V.stage === 'play';
      if (!S.paused && !clockEnded && basketballRound.counted && !basketballRound.started &&
          (V.stage === 'play' || (goAt && now >= goAt))) {
        basketballRound.started = true;
        SND.buzzer(false);
      }
      if (!S.paused && clockEnded && basketballRound.played && !basketballRound.ended) {
        basketballRound.ended = true;
        SND.buzzer(true);
      }
    } else basketballRound = null;
    // The countdown and the clock.
    const cnt = $('mwCount');
    if (V.stage === 'count' && goAt) {
      const s = Math.ceil((goAt - now) / 1000);
      const txt = s > 0 ? String(s) : 'GO!';
      if (cnt.textContent !== txt) { cnt.textContent = txt; if (s > 0) ctx.sfx?.('tick'); else if (!hoopsClock) SND.bell(); }
      cnt.hidden = false;
    } else if (!cnt.hidden && !(goAt && now - goAt < 700)) cnt.hidden = true;
    else if (!cnt.hidden && cnt.textContent !== 'GO!') { cnt.textContent = 'GO!'; if (!hoopsClock) SND.bell(); }
    const ck = $('mwClock');
    if (clockEnded) {
      setLed(ck, 'TIME', '00');
      ck.classList.add('low');
    } else if (hoopsClock && (V.stage === 'count' || (V.stage === 'play' && V.timeLeft == null))) {
      const startingTime = V.stage === 'count' && V.clock > 0 ? String(V.clock).padStart(2, '0') : '--';
      setLed(ck, 'TIME', startingTime);
      ck.classList.remove('low');
    } else if (endAt && V.stage !== 'between') {
      const s = Math.max(0, Math.ceil((endAt - now) / 1000));
      const txt = V.kind === 'hoops' ? String(s).padStart(2, '0') : `⏱ ${s}`;
      if (V.kind === 'hoops' ? setLed(ck, 'TIME', txt) : ck.textContent !== txt && (ck.textContent = txt, true)) {
        if (s <= 5 && s > 0 && V.stage === 'play' && hasShots(V) && now - lastTick > 500) { lastTick = now; ctx.sfx?.('tickfast'); }
      }
      ck.classList.toggle('low', s <= 5);
    } else { ck.textContent = ''; delete ck.dataset.led; }
    if (rackBalls.filter((ball) => ball.ready && !ball.transient).length !== availableBefore || $('mwGo').disabled === canThrow()) controls();
    if (charge) { power = clamp((now - charge.start) / chargeDuration(), 0, 1); meter(); }
    window.Snd?.bed('mw.crowd', crowdBed).set(S.phase === 'playing' && !S.paused ? 1 : 0);
    const sc = scene(now);
    if (sc.kind === 'hoops') {
      const balls = $('mwBalls');
      const available = sc.rack.length;
      const rack = heldBall ? 'Ball in hand' : available ? `Balls ready ${available}/${hoopRackSize}` : 'Waiting for a ball';
      const status = `Round ${V.round}/${V.rounds} · ${rack}`;
      if (balls.textContent !== status) balls.textContent = status;
    }
    const score = $('mwScore');
    if (sc.kind === 'hoops') setLed(score, 'SCORE', String(sc.pts).padStart(4, '0'));
    else if (score.textContent) { score.textContent = ''; delete score.dataset.led; }
    if (sc.kind === 'skee') {
      const roundScore = $('mwSkeeScore');
      const value = String(sc.pts);
      if (roundScore.textContent !== value) roundScore.textContent = value;
    }
    score.classList.toggle('mw-score-hit', sc.scoreGlow > 0);
    const idle = !rackMoved && !sc.movingHoop && !sc.netHit && !anims.length && !swipe && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- three.js: you stand at z = 0 looking down -z at the booth; one scene with props for each booth
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, {
      min: 0.6, frameWindow: 8, frameGap: 500, idleFullResolution: false,
      onLost: () => GL3.revive(stage, {
        build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); },
        flat: () => { flat ||= make2d(stage); },
        unflat: () => { flat?.dispose?.(); flat = null; },
      }),
    });
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
    const hoopsBackground = new T.Color(0x080f17).convertLinearToSRGB();
    const boothCastsShadow = stg.key.castShadow;
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });
    const glow = (color) => new T.MeshBasicMaterial({ color });

    // the booth: boards underfoot, a counter in front, striped side walls and an awning, string lights
    const midwayDecor = new T.Group(); scene3.add(midwayDecor);
    const planks = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#6b4426'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#74492a' : '#633e22'; g.fillRect(k * w / 8, 0, w / 8 - 2, h); }
      for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(30,15,5,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 6); }
    });
    planks.wrapS = planks.wrapT = T.RepeatWrapping; planks.repeat.set(4, 6);
    const floor = new T.Mesh(new T.PlaneGeometry(8, 12), std(0xffffff, { map: planks }));
    floor.rotation.x = -Math.PI / 2; floor.position.z = -3; floor.receiveShadow = true; midwayDecor.add(floor);
    const stripe = tex(256, 64, (g, w, h) => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#f4efe4' : '#d8342f'; g.fillRect(k * w / 8, 0, w / 8, h); } });
    stripe.wrapS = T.RepeatWrapping;
    const wallMat = std(0xffffff, { map: stripe, side: T.DoubleSide });
    for (const sx of [-1.35, 1.35]) {
      const wall = new T.Mesh(new T.PlaneGeometry(4.6, 2.6), wallMat);
      wall.rotation.y = Math.PI / 2; wall.position.set(sx, 1.3, -2.5); wall.receiveShadow = true; midwayDecor.add(wall);
    }
    const backTex = tex(512, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a1f5c'); gr.addColorStop(1, '#1d1030'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,214,120,.18)'; for (let k = 0; k < 40; k++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.5, 0, 7); g.fill(); }
    });
    const back = new T.Mesh(new T.PlaneGeometry(2.8, 2.8), std(0xffffff, { map: backTex }));
    back.position.set(0, 1.4, -4.8); midwayDecor.add(back);
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
      midwayDecor.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), wireMat));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, col = BULB[k % 4], b = new T.Mesh(bulbGeo, glow(col));
        b.scale.setScalar(r); b.position.set(-1.32 + 2.64 * u, sag(u), z);
        if (!low) { const h = new T.Sprite(new T.SpriteMaterial({ map: haloTex, color: col, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.55 })); h.scale.setScalar(9); b.add(h); }   // the halo is 9× the bulb (it inherits the bulb's scale)
        midwayDecor.add(b); bulbs.push(b);
      }
    }
    if (!low) for (const x of [-0.8, 0.8]) { const L = new T.PointLight(0xffc27a, 0.6, 6, 2); L.position.set(x, 2.1, -1.8); scene3.add(L); }
    // a warm spotlight on whatever you're throwing at (it follows the booth)
    const spot = low ? null : new T.SpotLight(0xfff0d0, 1.1, 8, 0.42, 0.65, 1.4);
    if (spot) { spot.position.set(0, 2.9, -0.6); scene3.add(spot, spot.target); }

    // the prize wall behind every booth: shelves of plush bears in carnival colours
    const prizes = new T.Group(); midwayDecor.add(prizes);
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
    const skee = new T.Group();
    const laneFront = -0.1, laneLip = -3.15, ballRadius = 0.045;
    skee.scale.set(1, 0.72, 1.18);
    skee.position.z = laneFront * (1 - skee.scale.z);
    scene3.add(skee);
    const ballCenterHeight = ballRadius / skee.scale.y;
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
      cabinetBox(0.06, 1.18, 1.13, side * 0.66, 0.94, -3.73, lacquer);
    }
    const returnX = 0.59, returnFront = -0.075, ballSpacing = 0.095;
    const returnHeight = (z) => 0.9 + (returnFront - z) * 0.065;
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
    const trayBallGeo = new T.SphereGeometry(ballRadius, 14, 10);
    const trayBallMat = std(0xb87d48, { roughness: 0.38 });
    const trayBalls = Array.from({ length: 9 }, (_, k) => {
      const ball = new T.Mesh(trayBallGeo, trayBallMat);
      ball.position.set(returnX, 0, returnFront - k * ballSpacing);
      ball.scale.set(1, 1 / skee.scale.y, 1 / skee.scale.z);
      ball.castShadow = true; skee.add(ball);
      return ball;
    });
    let lastTrayCount = null;
    const ballTex = tex(64, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, h * 0.42, w, h * 0.16); g.fillRect(w * 0.45, 0, w * 0.1, h); });
    const board = new T.Group(); board.position.set(0, 1.18, -3.3); board.rotation.x = -0.927; skee.add(board);
    const targets = new T.Group();
    board.add(targets);
    skee.updateMatrixWorld(true);
    let boardTex = null, boardFace = null, stackedBoard = false;
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
          const [r, , cy = geo.cy] = geo.rings[i];
          g.beginPath(); g.arc(X(0), Y(cy), r * k, 0, 7); g.fillStyle = geo.stacked ? (i === 3 ? '#d2a66e' : '#f1d8a9') : SKEE_RINGS[i]; g.fill();
          g.lineWidth = 3; g.strokeStyle = '#112d30'; g.stroke();
        }
        g.strokeStyle = '#f4d7a0';
        g.lineWidth = 3;
        g.strokeRect(13, 13, W - 26, H - 26);
      });
      boardTex.colorSpace = T.SRGBColorSpace;
      const stacked = !!geo.stacked;
      if (!boardFace || stacked !== stackedBoard) {
        const materials = new Set();
        for (const mesh of targets.children) {
          mesh.geometry.dispose();
          if (mesh.material !== brass) materials.add(mesh.material);
        }
        for (const material of materials) {
          if (material !== boardFace?.material) material.map?.dispose();
          material.dispose();
        }
        targets.clear();
        scorePockets.clear();
        stackedBoard = stacked;
        const face = new T.Shape();
        face.moveTo(-0.65, 0); face.lineTo(0.65, 0); face.lineTo(0.65, 1.2);
        face.lineTo(-0.65, 1.2); face.closePath();
        skeeScorePockets(geo).forEach((pocket, i) => {
          scorePockets.set(String(geo.rings[i]?.[1] ?? 10), pocket);
        });
        cornerPockets = geo.cups.map(([x, y]) => [x, y, geo.cupR]);
        const pockets = [...scorePockets.values(), ...cornerPockets];
        const liner = std(0x43302b, { side: T.BackSide, roughness: 0.85 });
        const throat = glow(0x09070a);
        for (const [x, y, r] of pockets) {
          const opening = new T.Path();
          opening.absarc(x, y, r, 0, Math.PI * 2, true);
          face.holes.push(opening);
          const throatRadius = r * (geo.stacked ? 0.85 : 0.68);
          const well = new T.Mesh(new T.CylinderGeometry(r, throatRadius, SKEE_WELL_DEPTH, 48, 1, true), liner);
          well.rotation.x = Math.PI / 2;
          well.position.set(x, y, -SKEE_WELL_DEPTH / 2);
          targets.add(well);
          const bottom = new T.Mesh(new T.CircleGeometry(throatRadius, 48), throat);
          bottom.position.set(x, y, -SKEE_WELL_DEPTH);
          targets.add(bottom);
        }
        const faceGeo = new T.ShapeGeometry(face, 24);
        const uv = faceGeo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + 0.65) / 1.3, uv.getY(i) / 1.2);
        boardFace = new T.Mesh(faceGeo, std(0xffffff, { roughness: 0.45 }));
        boardFace.receiveShadow = true; targets.add(boardFace);
        const dividerMaterial = std(0x263a37, { side: T.DoubleSide });
        for (const [r, points, cy = geo.cy] of geo.rings) {
          if (geo.stacked && points !== 20) continue;
          const profile = [
            [r + 0.011, 0], [r + 0.006, SKEE_DIVIDER_HEIGHT],
            [r - 0.006, SKEE_DIVIDER_HEIGHT], [r - 0.011, 0],
          ].map(([radius, height]) => new T.Vector2(radius, height));
          const divider = new T.Mesh(new T.LatheGeometry(profile, 64), dividerMaterial);
          divider.rotation.x = Math.PI / 2;
          divider.position.y = cy;
          divider.castShadow = true;
          targets.add(divider);
          const cap = new T.Mesh(new T.TorusGeometry(r, 0.006, 8, 64), brass);
          cap.position.set(0, cy, SKEE_DIVIDER_HEIGHT);
          targets.add(cap);
        }
        const cupLip = stacked ? std(0xffe5ac, { roughness: 0.42, side: T.DoubleSide }) : brass;
        const cornerLip = stacked ? std(0xffa449, { roughness: 0.42, side: T.DoubleSide }) : brass;
        for (const [x, y, radius] of pockets) {
          const material = x === 0 ? cupLip : cornerLip;
          if (stacked) {
            const collar = new T.Mesh(new T.CylinderGeometry(radius + 0.008, radius + 0.016, 0.027, 48, 1, true), material);
            collar.rotation.x = Math.PI / 2;
            collar.position.set(x, y, 0.0135);
            targets.add(collar);
          }
          const rim = new T.Mesh(new T.TorusGeometry(stacked ? radius + 0.005 : radius, stacked ? 0.012 : 0.006, 8, 48), material);
          rim.position.set(x, y, stacked ? 0.027 : 0.004);
          targets.add(rim);
        }
        const badgeGeo = new T.PlaneGeometry(stacked ? 0.186 : 0.118, stacked ? 0.096 : 0.07);
        function scoreBadge(points, x, y) {
          const map = tex(128, 76, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 12);
            g.fillStyle = '#102629'; g.fill();
            g.strokeStyle = '#e7b86c'; g.lineWidth = 4; g.stroke();
            g.font = stacked ? '900 65px system-ui, sans-serif' : '900 60px system-ui, sans-serif';
            g.fillStyle = '#fff2d7'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(String(points), w / 2, h / 2, w - 14);
          });
          map.colorSpace = T.SRGBColorSpace;
          const badge = new T.Mesh(badgeGeo, new T.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, toneMapped: false }));
          badge.position.set(x, y, SKEE_DIVIDER_HEIGHT + 0.008);
          targets.add(badge);
        }
        let index = 0;
        for (const [points, [, y, radius]] of scorePockets) {
          scoreBadge(points, (!geo.stacked && index % 2 ? -1 : 1) * (radius + (stacked ? 0.118 : 0.069)), y);
          index++;
        }
        for (const [x, y, radius] of cornerPockets) scoreBadge(100, x, y + radius + (stacked ? 0.055 : 0.046));
      }
      boardFace.material.map = boardTex; boardFace.material.needsUpdate = true;
    }
    const goldMat = std(0xffc83a, { metalness: 0.75, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const skeeJack = new T.Group();
    const jackBeacon = new T.Mesh(new T.ConeGeometry(0.026, 0.09, 8), goldMat);
    jackBeacon.position.y = 0.055;
    const jackHalo = new T.Mesh(new T.TorusGeometry(0.042, 0.008, 8, 24), goldMat);
    jackHalo.rotation.x = Math.PI / 2;
    jackHalo.position.y = 0.02;
    skeeJack.add(jackBeacon, jackHalo);
    const jackLabel = new T.Mesh(new T.PlaneGeometry(0.13, 0.055), new T.MeshBasicMaterial({
      map: tex(192, 80, (g, w, h) => {
        g.fillStyle = '#542d08'; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 18); g.fill();
        g.strokeStyle = '#ffdf72'; g.lineWidth = 5; g.stroke();
        g.font = '900 48px system-ui, sans-serif'; g.fillStyle = '#fff4c7';
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+100', w / 2, h / 2);
      }), transparent: true, toneMapped: false, side: T.DoubleSide,
    }));
    jackLabel.position.y = 0.13;
    skeeJack.add(jackLabel);
    board.add(skeeJack);
    const skeeBall = new T.Mesh(new T.SphereGeometry(0.045, 16, 12), std(0xffffff, { roughness: 0.35, map: ballTex })); skeeBall.castShadow = true;
    const skeeBalls = [];
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

    // Basketball cabinet and moving target.
    const hoops = new T.Group(); scene3.add(hoops);
    hoops.scale.set(1, cabinetHeightScale, cabinetDepthScale);
    hoops.position.set(0, cabinetFloorY * (1 - cabinetHeightScale), hoopRackZ * (1 - cabinetDepthScale));
    const hoopBalls = [];
    // Depth cues on the ramp: a shadow under each ball and a ring under the hoop, so height and distance read apart.
    const rampTilt = -Math.PI / 2 + Math.atan(hoopSlope);
    const rampSurface = (z) => hoopRampY(z) - hoopRadius;
    const shadowGeo = new T.CircleGeometry(hoopRadius, 20);
    const hoopShadows = [];
    const footprint = new T.Mesh(new T.RingGeometry(0.97, 1, 56), new T.MeshBasicMaterial({
      color: 0x64edff, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    footprint.rotation.x = rampTilt;
    footprint.position.set(0, rampSurface(hoopDepth) + 0.006, hoopDepth);
    footprint.renderOrder = 2;
    hoops.add(footprint);
    let movingTarget, rimAssembly, hoopNet, scoreHalo, lastNetAge, lastNetOffset, lastNetDrift;
    const cord = new T.Object3D();
    const cordAxis = new T.Vector3(0, 1, 0), cordDirection = new T.Vector3();
    const hoopRimMat = std(0xff6a2a, { metalness: 0.55, roughness: 0.34, emissive: 0x7aff55, emissiveIntensity: 0 });
    const hoopPoint = (x, y) => new T.Vector3(x, 1 + y, hoopDepth);
    let hoopBall;
    function basketballGeometry(model) {
      const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
      const geometry = new T.BufferGeometry();
      const positions = new Int16Array(bytes(model.p));
      geometry.setAttribute('position', new T.BufferAttribute(Float32Array.from(positions, (v) => v / 32767), 3));
      const leather = new Uint16Array(bytes(model.leather)), seam = new Uint16Array(bytes(model.seam));
      const indices = new Uint16Array(leather.length + seam.length);
      indices.set(leather);
      indices.set(seam, leather.length);
      geometry.setIndex(new T.BufferAttribute(indices, 1));
      geometry.addGroup(0, leather.length, 0);
      geometry.addGroup(leather.length, seam.length, 1);
      geometry.computeVertexNormals();
      return geometry;
    }
    function buildHoops(geo) {
      const leather = std(0xe0601c, { roughness: 0.8, emissive: 0x82330d, emissiveIntensity: 0.25 });
      const seam = std(0x14100e, { roughness: 0.9 });
      const model = window.MIDWAY_BALL;
      const ballMesh = model
        ? new T.Mesh(basketballGeometry(model), [leather, seam])
        : new T.Mesh(new T.SphereGeometry(1, 40, 32), leather);
      ballMesh.scale.setScalar(hoopRadius);
      hoopBall = new T.Group();
      hoopBall.add(ballMesh);
      hoopBall.scale.set(1, 1 / cabinetHeightScale, 1 / cabinetDepthScale);
      hoops.add(hoopBall);
      hoopBalls.push(hoopBall);
      const shell = std(0x252c34), dark = std(0x10151c);
      const cyan = new T.MeshBasicMaterial({ color: 0x55edff, toneMapped: false });
      const box = (w, h, d, x, y, z, mat) => {
        const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        hoops.add(mesh);
        return mesh;
      };
      const cabinetTex = tex(512, 512, (g, w, h) => {
        const wash = g.createRadialGradient(w * 0.5, h * 0.16, 0, w * 0.5, h * 0.22, w * 0.8);
        wash.addColorStop(0, '#343e49'); wash.addColorStop(0.5, '#222a34'); wash.addColorStop(1, '#10131a');
        g.fillStyle = wash; g.fillRect(0, 0, w, h);
        g.fillStyle = '#bac8df16';
        for (let y = 10; y < h; y += 14) {
          for (let x = 8 + y % 4; x < w; x += 14) g.fillRect(x, y, 2, 2);
        }
      });
      const cabinet = new T.Mesh(new T.PlaneGeometry(2.01, 1.775), std(0xffffff, { map: cabinetTex }));
      const surround = new T.Mesh(new T.PlaneGeometry(8, 6), new T.MeshBasicMaterial({
        color: 0x080f17, toneMapped: false,
      }));
      surround.position.set(0, 1.6, -3.2);
      hoops.add(surround);
      cabinet.position.set(0, 1.7325, -2.65);
      hoops.add(cabinet);
      box(2.30, 0.08, 0.16, 0, 2.66, -2.60, shell);
      box(1.84, 0.013, 0.035, 0, 2.52, -2.55, cyan);
      const lamp = new T.PointLight(0x91dfff, 2.1, 4, 2);
      lamp.position.set(0, 2.45, -2.13);
      const fill = new T.PointLight(0xc6faff, 1.6, 1.8, 2);
      fill.position.set(0, 1.08, hoopRackZ + 0.15);
      hoops.add(lamp, fill);
      // The side panels sit outside the playable ramp, with the strips following their upper edge.
      const panel = new T.Shape();
      panel.moveTo(-2.64, 0.54);
      panel.lineTo(hoopRackZ + 0.14, 0.54);
      panel.lineTo(hoopRackZ + 0.14, 0.78);
      panel.lineTo(-2.64, 1.53);
      panel.closePath();
      const panelGeo = new T.ExtrudeGeometry(panel, { depth: 0.09, bevelEnabled: false });
      panelGeo.rotateY(-Math.PI / 2);
      const railRun = hoopRackZ + 0.14 + 2.64;
      for (const side of [-1, 1]) {
        box(0.10, 1.80, 0.15, side * 0.97, 1.76, -2.575, shell);
        box(0.012, 1.27, 0.016, side * 0.97, 1.66, -2.493, cyan);
        const wall = new T.Mesh(panelGeo, shell);
        wall.position.x = side * 1.01;
        hoops.add(wall);
        const strip = box(0.018, 0.012, Math.hypot(railRun, 0.75),
          side * 0.97, 1.155, -2.64 + railRun / 2, cyan);
        strip.rotation.x = Math.atan2(0.75, railRun);
      }
      const rampLength = hoopRackZ + 2.622;
      const rampTex = tex(256, 256, (g, w, h) => {
        g.fillStyle = '#242c36'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 6) {
          g.fillStyle = '#ffffff0c'; g.fillRect(0, y, w, 1);
        }
        g.strokeStyle = '#679099'; g.lineWidth = 2; g.strokeRect(12, 14, w - 24, h - 28);
        g.strokeStyle = '#67909977';
        g.beginPath(); g.moveTo(12, h / 2); g.lineTo(w - 12, h / 2); g.stroke();
        g.beginPath(); g.arc(w / 2, h / 2, 30, 0, 2 * Math.PI); g.stroke();
        // chevrons pointing toward the hoop
        g.strokeStyle = '#64edff66'; g.lineWidth = 4; g.lineJoin = 'round';
        for (const cy of [h * 0.24, h * 0.8]) {
          for (const dy of [0, 16]) {
            g.beginPath(); g.moveTo(w / 2 - 26, cy + 14 + dy); g.lineTo(w / 2, cy - 4 + dy); g.lineTo(w / 2 + 26, cy + 14 + dy); g.stroke();
          }
        }
      });
      const ramp = new T.Mesh(new T.PlaneGeometry(1.84, rampLength * Math.hypot(1, hoopSlope)),
        std(0xffffff, { map: rampTex, roughness: 0.78 }));
      ramp.rotation.x = -Math.PI / 2 + Math.atan(hoopSlope);
      ramp.position.z = hoopRackZ - rampLength / 2;
      ramp.position.y = hoopRampY(ramp.position.z) - hoopRadius;
      hoops.add(ramp);
      box(2.28, 0.55, 0.24, 0, 0.36, hoopRackZ + 0.025, shell);
      box(2.12, 0.018, 0.24, 0, 0.681, hoopRackZ + 0.046, dark);
      box(2.22, 0.10, 0.045, 0, 0.636, hoopRackZ + 0.17, shell);
      box(1.78, 0.012, 0.012, 0, 0.667, hoopRackZ + 0.195, cyan);
      const trayGlow = new T.Mesh(new T.PlaneGeometry(2.14, 0.25), new T.MeshBasicMaterial({
        map: haloTex, color: 0x57dfff, opacity: 0.36, transparent: true, depthWrite: false,
        blending: T.AdditiveBlending,
      }));
      trayGlow.rotation.x = -Math.PI / 2;
      trayGlow.position.set(0, 0.694, hoopRackZ + 0.045);
      hoops.add(trayGlow);
      const [x, y, rx] = geo.hoops[0];
      {
        const target = movingTarget = new T.Group();
        target.position.copy(hoopPoint(x, y));
        hoops.add(target);
        // The glass fills the back of the cabinet between the side rails, from the rim up to the top bar.
        const glassTex = tex(512, 352, (g, w, h) => {
          const tint = g.createLinearGradient(0, 0, w, h);
          tint.addColorStop(0, '#a4ebff80');
          tint.addColorStop(0.45, '#3a839738');
          tint.addColorStop(1, '#6bb8df66');
          g.fillStyle = tint; g.fillRect(0, 0, w, h);
          g.fillStyle = '#ffffff12';
          g.beginPath(); g.moveTo(w * 0.12, 0); g.lineTo(w * 0.30, 0); g.lineTo(w * 0.08, h); g.lineTo(0, h); g.lineTo(0, h * 0.7); g.closePath(); g.fill();
          g.strokeStyle = '#b9e5e9'; g.lineWidth = 9;
          g.strokeRect(5, 5, w - 10, h - 10);
          g.lineWidth = 3; g.strokeStyle = '#b9e5e988';
          g.strokeRect(22, 22, w - 44, h - 44);
        });
        const glass = new T.Mesh(new T.PlaneGeometry(boardHalfWidth * 2, boardTop - boardBottom),
          std(0xffffff, { map: glassTex, roughness: 0.28, transparent: true, depthWrite: false }));
        glass.position.set(0, 1 + (boardTop + boardBottom) / 2, hoopBoardZ);
        hoops.add(glass);
        // a metal frame around the glass, with a lit lower edge level with the rim
        const frameMetal = std(0x46515f, { metalness: 0.65, roughness: 0.38 });
        const glassMid = 1 + (boardTop + boardBottom) / 2, glassH = boardTop - boardBottom;
        const bar = (w, h, x, y, mat = frameMetal) => {
          const mesh = new T.Mesh(new T.BoxGeometry(w, h, 0.05), mat);
          mesh.position.set(x, y, hoopBoardZ + 0.012);
          hoops.add(mesh);
        };
        bar(boardHalfWidth * 2, 0.035, 0, 1 + boardTop - 0.0175);
        bar(boardHalfWidth * 2, 0.035, 0, 1 + boardBottom + 0.0175);
        for (const side of [-1, 1]) bar(0.035, glassH, side * (boardHalfWidth - 0.0175), glassMid);
        const edgeGlow = new T.Mesh(new T.BoxGeometry(boardHalfWidth * 2 - 0.07, 0.008, 0.012), cyan);
        edgeGlow.position.set(0, 1 + boardBottom + 0.04, hoopBoardZ + 0.04);
        hoops.add(edgeGlow);
        // the rim's warm spot, for highlights on the iron and the ball
        const rimLight = new T.PointLight(0xffd2a0, 1.1, 2.6, 2);
        rimLight.position.set(0, 1 + boardBottom + 0.55, hoopDepth + 0.55);
        hoops.add(rimLight);
        // the shooter's square follows the hoop, as the rim and net do
        const squareTex = tex(256, 160, (g, w, h) => {
          g.strokeStyle = '#d5f6ff'; g.lineWidth = 8;
          g.strokeRect(6, 6, w - 12, h - 12);
        });
        const board = new T.Mesh(new T.PlaneGeometry(0.58, 0.36),
          std(0xffffff, { map: squareTex, roughness: 0.28, transparent: true, depthWrite: false }));
        board.position.set(0, 0.17, hoopBoardZ - hoopDepth + 0.004);
        target.add(board);
        const mountPlate = new T.Mesh(new T.BoxGeometry(0.30, 0.13, 0.016), frameMetal);
        mountPlate.position.set(0, 0.062, hoopBoardZ - hoopDepth + 0.012);
        target.add(mountPlate);
        const screwGeo = new T.CylinderGeometry(0.009, 0.009, 0.01, 8);
        for (const [sx, sy] of [[-0.12, 0.02], [0.12, 0.02], [-0.12, 0.105], [0.12, 0.105]]) {
          const screw = new T.Mesh(screwGeo, hoopRimMat);
          screw.rotation.x = Math.PI / 2;
          screw.position.set(sx, sy, hoopBoardZ - hoopDepth + 0.025);
          target.add(screw);
        }
        const rimMount = new T.Group();
        rimMount.scale.set(1, 1 / cabinetHeightScale, 1 / cabinetDepthScale);
        target.add(rimMount);
        rimAssembly = new T.Group();
        rimMount.add(rimAssembly);
        const radius = hoopRingRadius(rx);
        const rim = new T.Mesh(new T.TorusGeometry(radius, hoopTubeRadius, 12, 64), hoopRimMat);
        rim.rotation.x = -Math.PI / 2;
        rimAssembly.add(rim);
        scoreHalo = new T.Sprite(new T.SpriteMaterial({
          map: haloTex, color: 0x89ff66, transparent: true, depthWrite: false,
          blending: T.AdditiveBlending,
        }));
        scoreHalo.position.set(0, -0.035, 0.035);
        scoreHalo.scale.set(0.80, 0.56, 1);
        rimAssembly.add(scoreHalo);
        const strand = new T.CylinderGeometry(0.0027, 0.0027, 1, 6);
        hoopNet = new T.InstancedMesh(strand, std(0xffecd3, { roughness: 0.96 }), netWeave.length * netSubdivisions);
        hoopNet.instanceMatrix.setUsage(T.DynamicDrawUsage);
        hoopNet.frustumCulled = false;
        rimAssembly.add(hoopNet);
      }
    }

    // the preview: dots along the arc and a ring where it would land
    const dotGeo = new T.SphereGeometry(0.012, 6, 4), dotMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false });
    const dots = Array.from({ length: 14 }, () => { const m = new T.Mesh(dotGeo, dotMat); m.renderOrder = 9; scene3.add(m); return m; });
    const hoopDots = Array.from({ length: 16 }, (_, i) => {
      const t = i / 15;
      const material = new T.MeshBasicMaterial({
        color: 0x64edff, transparent: true, opacity: 0.96 - 0.70 * t,
        depthTest: false, depthWrite: false,
      });
      const dot = new T.Mesh(dotGeo, material);
      dot.scale.setScalar(1.23 - 0.67 * t);
      dot.renderOrder = 9;
      hoops.add(dot);
      return dot;
    });
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
      skee.add(arrow);
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
      const key = `${sc.kind}:${!!sc.geo.stacked}:${JSON.stringify(sc.layout)}`;
      if (key === built) return;
      built = key;
      if (sc.kind === 'skee') paintBoard(sc.geo);
      if (sc.kind === 'rings') {
        while (bottleMeshes.length < sc.geo.bottles.length) { const m = new T.Mesh(bottleGeo, glass.g); m.castShadow = true; rings.add(m); bottleMeshes.push(m); }
        sc.geo.bottles.forEach(([bx, by], i) => { const m = bottleMeshes[i]; m.position.copy(tablePt(bx, by)); m.material = glass[sc.layout.colours[i]]; });
      }
      if (sc.kind === 'hoops' && !movingTarget) buildHoops(sc.geo);
      if (sc.kind === 'cans') {
        canGeo ||= new T.CylinderGeometry(sc.geo.w / 2 - 0.004, sc.geo.w / 2 - 0.004, sc.geo.h - 0.004, low ? 12 : 20);
        while (canMeshes.length < sc.geo.cans.length) { const m = new T.Mesh(canGeo, canMat); m.castShadow = true; cansG.add(m); canMeshes.push(m); }
      }
    }

    const cam = { pos: new T.Vector3(0, 1.7, 1.1), look: new T.Vector3(0, 1.1, -3), init: false };
    const VIEW = { skee: { pos: [0, 1.08, 0.36], look: [0, 0.50, -3.6], w: 0.648, d: 2.7, minFov: 34 }, rings: { pos: [0, 1.9, 0.1], look: [0, 0.78, -2.05], w: 0.8, d: 2.6 },
      hoops: { pos: [0, 1.92, 1.46], look: [0, 1.25, -2.70], w: 1.2, d: 2.4 },
      cans: { pos: [0, 1.4, -0.2], look: [0, 1.18, -2.6], w: 0.55, d: 2.4 } };
    let lastT = 0, moving = 0;
    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();

    const arc = (a, b, h, u) => new T.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + h * 4 * u * (1 - u), a.z + (b.z - a.z) * u);
    // where a throw is at u (0..1 of its flight to the landing), for each booth
    const HAND = { skee: new T.Vector3(0, laneHeight(laneFront) + ballCenterHeight, laneFront), rings: new T.Vector3(0.1, 1.35, 0.25), cans: new T.Vector3(0.15, 1.35, 0.5), hoops: new T.Vector3(0, 1.17, hoopLaunchZ) };
    function skeePath(sh, u, landU) {
      const lip = new T.Vector3(clamp(sh.x * 0.7, -0.33, 0.33), laneHeight(laneLip) + ballCenterHeight, laneLip);
      const rollAt = (s) => {
        const p = HAND.skee.clone().lerp(lip, s);
        p.y = laneHeight(p.z) + ballCenterHeight;
        return skee.localToWorld(p);
      };
      if (sh.where === 'short') {
        const top = Math.max(0.15, (sh.y + 0.08) / 1.1) * 0.95, s = u < 0.6 ? u / 0.6 * top : top * (1 - (u - 0.6) / 0.4);
        return rollAt(s);
      }
      if (u < 0.55) { const s = 1 - (1 - u / 0.55) ** 1.6; return rollAt(s); }
      if (u < landU) return arc(skee.localToWorld(lip), boardPt(sh.x, Math.max(0.02, sh.y)), 0.22, (u - 0.55) / (landU - 0.55));
      const w = Math.min(1, (u - landU) / (1 - landU));
      const settle = sh.rattle ? Math.min(1, w / 0.25) : 1;
      const hop = sh.rattle ? Math.abs(Math.sin(settle * Math.PI * 2)) * 0.035 * (1 - settle) : 0;
      const rattleSide = sh.rattle ? Math.sin(settle * Math.PI * 5) * 0.018 * (1 - settle) : 0;
      const x = sh.x + (sh.ex - sh.x) * settle + hop + rattleSide;
      const y = Math.max(0.02, sh.y + (sh.ey - sh.y) * settle);
      const pocket = sh.where === 'cup' ? cornerPockets[x < 0 ? 0 : 1] :
        scorePockets.get(sh.where === 'gutter' && V.geo.stacked ? '10' : sh.where);
      const progress = clamp((w - 0.25) / 0.55, 0, 1);
      const approach = progress * progress * (3 - 2 * progress);
      const targetX = pocket ? pocket[0] : x;
      const targetY = pocket ? pocket[1] : 0.02;
      const depth = w > 0.8 ? (w - 0.8) / 0.2 : 0;
      const lift = SKEE_DIVIDER_HEIGHT * Math.sin(Math.PI * progress);
      return boardPt(x + (targetX - x) * approach, y + (targetY - y) * approach,
        0.05 + lift - (0.05 + SKEE_WELL_DEPTH - 0.045) * depth);
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
      if (sc.kind !== kindNow) {
        kindNow = sc.kind;
        cam.init = false;
        const basketball = sc.kind === 'hoops';
        // The basketball cabinet uses its own ball shadows and opaque backdrop.
        stg.key.castShadow = boothCastsShadow && !basketball;
        stg.sky.visible = !basketball;
        scene3.background = basketball ? hoopsBackground : null;
        if (spot) spot.target.position.set(0, sc.kind === 'rings' ? TY : 1.4, sc.kind === 'skee' ? -3.7 : sc.kind === 'rings' ? TZ - 0.5 : SZ);
      }
      if (sc.kind !== 'skee') lastTrayCount = null;
      counter.visible = front.visible = sc.kind !== 'skee' && sc.kind !== 'hoops';
      awning.visible = midwayDecor.visible = sc.kind !== 'hoops' && sc.kind !== 'skee';
      hoops.visible = sc.kind === 'hoops';
      skee.visible = sc.kind === 'skee'; rings.visible = sc.kind === 'rings'; cansG.visible = sc.kind === 'cans';
      const pool = (arr, proto, parent, count = sc.fly.length) => { while (arr.length < count) { const m = proto.clone(); m.material = proto.material.clone(); parent.add(m); arr.push(m); } arr.forEach((m) => { m.visible = false; }); };
      if (sc.kind === 'skee') {
        skeeJack.visible = sc.jackLive;
        skeeJack.position.set(sc.layout.jack[0], sc.layout.jack[1], SKEE_DIVIDER_HEIGHT + 0.014);
        skeeJack.rotation.y = Math.sin(now / 260) * 0.16;
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
          ball.position.y = returnHeight(ball.position.z) + ballCenterHeight;
          ball.rotation.x += step / ballRadius;
        });
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
        movingTarget.position.x = sc.hoopX ?? 0;
        rimAssembly.rotation.x = basketballRimTilt(sc.netHit);
        const flash = sc.scoreGlow ?? 0;
        hoopRimMat.emissiveIntensity = flash * 1.7;
        scoreHalo.visible = flash > 0;
        scoreHalo.material.opacity = flash * 0.75;
        const netAge = sc.netHit?.age ?? 0, netOffset = sc.netHit?.offset ?? 0;
        if (netAge !== lastNetAge || netOffset !== lastNetOffset || sc.netDrift !== lastNetDrift) {
          lastNetAge = netAge;
          lastNetOffset = netOffset;
          lastNetDrift = sc.netDrift;
          const knots = basketballNet(hoopRingRadius(sc.geo.hoops[0][2]), sc.netHit, sc.netDrift);
          netWeave.forEach(([from, to], index) => {
            let a = knots[from];
            for (let segment = 1; segment <= netSubdivisions; segment++) {
              const b = netCordPoint(knots[from], knots[to], segment / netSubdivisions);
              cord.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
              cordDirection.set(b.x - a.x, b.y - a.y, b.z - a.z);
              cord.scale.y = cordDirection.length() + 0.001;
              cord.quaternion.setFromUnitVectors(cordAxis, cordDirection.normalize());
              cord.updateMatrix();
              hoopNet.setMatrixAt(index * netSubdivisions + segment - 1, cord.matrix);
              a = b;
            }
          });
          hoopNet.instanceMatrix.needsUpdate = true;
        }
        while (hoopBalls.length < sc.basketballs.length) {
          const ball = hoopBall.clone();
          hoops.add(ball);
          hoopBalls.push(ball);
        }
        hoopBalls.forEach((ball, i) => { ball.visible = i < sc.basketballs.length; });
        const footprintRadius = hoopRingRadius(sc.geo.hoops[0][2]);
        footprint.scale.set(footprintRadius, footprintRadius / cabinetDepthScale, 1);
        footprint.position.x = sc.hoopX ?? 0;
        while (hoopShadows.length < sc.basketballs.length) {
          const shadow = new T.Mesh(shadowGeo, new T.MeshBasicMaterial({
            color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
          }));
          shadow.rotation.x = rampTilt;
          shadow.renderOrder = 3;
          hoops.add(shadow);
          hoopShadows.push(shadow);
        }
        hoopShadows.forEach((shadow, i) => {
          const ball = sc.basketballs[i];
          shadow.visible = !!ball;
          if (!ball) return;
          const height = Math.max(0, ball.y - hoopRampY(ball.z)) * cabinetHeightScale;
          const grow = 1 - 0.3 * Math.min(1, height / 1.2);
          shadow.position.set(ball.x, rampSurface(ball.z) + 0.004, ball.z);
          shadow.scale.set(grow, grow / cabinetDepthScale, 1);
          shadow.material.opacity = clamp(0.5 - height * 0.3, 0.12, 0.5);
        });
        sc.basketballs.forEach(({ x, y, z, spin, uid }, i) => {
          const ball = hoopBalls[i];
          ball.position.set(x, y, z);
          ball.children[0].rotation.set(spin + 0.55, -1.1 + ((uid ?? i) * 0.97) % 2.2, 0.12);
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
      const basketball = sc.kind === 'hoops';
      hoopDots.forEach((dot, i) => {
        dot.visible = basketball && !!pv;
        if (dot.visible) {
          const { x, y, z } = basketballGuide(pv, i, hoopDots.length);
          dot.position.set(x, y, z);
        }
      });
      dots.forEach((d) => { d.visible = !!pv && !lanePreview && !basketball; });
      if (pv && !lanePreview && !basketball) {
        const start = HAND[sc.kind];
        const ringToss = sc.kind === 'rings';
        const end = ringToss ? tablePt(pv.x, pv.y, TY + 0.3) : new T.Vector3(pv.x, SY + pv.y, SZ + 0.12);
        dotMat.opacity = sc.swiping ? 0.9 : 0.5;
        dots.forEach((d, k) => {
          const progress = 0.14 + 0.32 * (k + 1) / dots.length;
          d.position.copy(arc(start, end, ringToss ? 0.5 : 0.12, progress));
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
      if (sc.kind === 'skee') want.z -= Math.max(0, 0.5 - camera.aspect) * 0.8;
      else if (pv && sc.swiping) want.x += pv.x * 0.15;
      const fov = Math.max(vw.minFov ?? 42, 2 * Math.atan(vw.w / vw.d / Math.min(1, camera.aspect)) * 180 / Math.PI);
      const k = cam.init ? 1 - Math.exp(-dt * 4) : 1; cam.init = true;
      cam.pos.lerp(want, k); cam.look.lerp(look, k);
      moving = cam.pos.distanceTo(want) > 0.005 || bits.length ? 1 : 0;
      camera.position.copy(cam.pos);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      stg.follow(camera);
      if (sc.kind === 'hoops') {
        camera.updateMatrixWorld();
        hoops.updateMatrixWorld();
        const w = stage.clientWidth, h = stage.clientHeight;
        rackTargets = (sc.rack ?? []).map((ball) => {
          const center = hoops.localToWorld(new T.Vector3(ball.x, ball.y, ball.z));
          const top = center.clone().add(new T.Vector3(0, hoopRadius, 0)).project(camera);
          const p = center.project(camera);
          return { ball, x: (p.x + 1) * w / 2, y: (1 - p.y) * h / 2, radius: Math.abs(top.y - p.y) * h / 2 };
        });
      }
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
      bg.addColorStop(0, basketball ? '#080f17' : '#20123a');
      bg.addColorStop(1, basketball ? '#141e27' : '#3a1f22');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const skee = sc.kind === 'skee';
      const laneDepth = skee ? Math.round(h * 0.33) : 0;
      const k = Math.max(1, Math.min((w - (basketball ? 48 : 0)) / (basketball ? 1.78 : 1.5),
        (h - (skee ? 60 : 90) - laneDepth) / (basketball ? 2.35 : 1.35)));
      const cx = w / 2, by = basketball ? h - 24 - 0.50 * k : skee ? h - laneDepth : h - 34;
      const X = (x) => cx + x * k, Y = (y) => by - (y + 0.1) * k * (basketball ? cabinetHeightScale : 1);
      g.lineWidth = 2;
      if (skee) {
        const mouth = Math.min(w * 0.48, k * 0.65);
        const wood = g.createLinearGradient(0, Y(0), 0, h);
        wood.addColorStop(0, '#b57b44');
        wood.addColorStop(1, '#e4b57c');
        g.beginPath();
        g.moveTo(cx - mouth, Y(0));
        g.lineTo(cx + mouth, Y(0));
        g.lineTo(w, h);
        g.lineTo(0, h);
        g.closePath();
        g.fillStyle = wood;
        g.fill();
        for (let i = 1; i < 5; i++) {
          const fraction = i / 5;
          g.beginPath();
          g.moveTo(cx + (2 * fraction - 1) * mouth, Y(0));
          g.lineTo(w * fraction, h);
          g.strokeStyle = '#60391488';
          g.stroke();
        }
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx + side * mouth, Y(0));
          g.lineTo(side < 0 ? 0 : w, h);
          g.strokeStyle = '#705132';
          g.lineWidth = 4;
          g.stroke();
        }
        if (sc.preview) {
          for (let i = 0; i < 6; i++) {
            const t = 0.18 + i * 0.08;
            const x = cx + clamp(sc.preview.x, -0.45, 0.45) * k * t;
            const y = h + (Y(0) - h) * t;
            g.beginPath();
            g.moveTo(x, y - 5);
            g.lineTo(x - 5, y + 3);
            g.lineTo(x + 5, y + 3);
            g.closePath();
            g.fillStyle = sc.charging && sc.chargePower * 6 > i ? '#ffac30' : '#fff3cb';
            g.fill();
            g.strokeStyle = '#3d2918';
            g.lineWidth = 1;
            g.stroke();
          }
        }
        g.lineWidth = 2;
        g.fillStyle = SKEE_FACE; g.fillRect(X(-0.65), Y(1.2), 1.3 * k, 1.2 * k);
        g.strokeStyle = '#e7b86c'; g.strokeRect(X(-0.63), Y(1.18), 1.26 * k, 1.16 * k);
        const { rings, cy, cups, cupR, stacked } = sc.geo;
        const pockets = skeeScorePockets(sc.geo);
        for (let i = rings.length - 1; i >= 0; i--) {
          const [r, points, center = cy] = rings[i];
          if (stacked && points !== 20) continue;
          const radius = r * k;
          g.beginPath(); g.arc(X(0), Y(center), radius, 0, Math.PI * 2);
          g.fillStyle = stacked ? '#d2a66e' : SKEE_RINGS[i]; g.fill();
          g.strokeStyle = '#172e2d'; g.lineWidth = 0.025 * k; g.stroke();
          g.beginPath(); g.arc(X(0), Y(center) - 0.012 * k, radius, 0, Math.PI * 2);
          g.strokeStyle = '#d9b47c'; g.lineWidth = 0.009 * k; g.stroke();
        }
        function drawPocket(x, y, radius) {
          const px = X(x), py = Y(y), r = radius * k;
          const well = g.createRadialGradient(px, py - r * 0.26, r * 0.16, px, py, r);
          well.addColorStop(0, '#09070a');
          well.addColorStop(0.65, '#151013');
          well.addColorStop(1, '#725749');
          g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2);
          g.fillStyle = well; g.fill();
          g.strokeStyle = stacked ? (x === 0 ? '#ffe5ac' : '#ffa449') : '#e7b86c';
          g.lineWidth = Math.max(1, (stacked ? 0.018 : 0.007) * k); g.stroke();
        }
        function label(points, x, y) {
          g.font = `900 ${Math.max(13, k * 0.063)}px system-ui, sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.strokeStyle = '#102629'; g.lineWidth = 4; g.strokeText(String(points), X(x), Y(y));
          g.fillStyle = '#fff2d7'; g.fillText(String(points), X(x), Y(y));
        }
        pockets.forEach(([x, y, radius], i) => {
          drawPocket(x, y, radius);
          label(rings[i]?.[1] ?? 10, (!stacked && i % 2 ? -1 : 1) * (radius + (stacked ? 0.118 : 0.069)), y);
        });
        for (const [x, y] of cups) {
          drawPocket(x, y, cupR);
          label(100, x, y + cupR + 0.045);
        }
        g.lineWidth = 2;
        if (sc.jackLive) {
          const jx = X(sc.layout.jack[0]), jy = Y(sc.layout.jack[1]);
          g.beginPath(); g.moveTo(jx, jy - 11); g.lineTo(jx + 8, jy); g.lineTo(jx, jy + 11); g.lineTo(jx - 8, jy); g.closePath();
          g.fillStyle = '#ffc83a'; g.fill(); g.strokeStyle = '#392508'; g.lineWidth = 2; g.stroke();
          g.beginPath(); g.arc(jx, jy, 14 + 2 * Math.sin(now / 120), 0, Math.PI * 2);
          g.strokeStyle = '#ffdf72'; g.lineWidth = 1.5; g.stroke();
          g.font = '900 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = '#fff4c7'; g.strokeStyle = '#542d08'; g.lineWidth = 3;
          g.strokeText('+100', jx, jy - 17); g.fillText('+100', jx, jy - 17);
        }
        for (const f of sc.fly) {
          if (f.u <= 0 || f.u >= 1) continue;
          const s = f.shot, v = Math.min(1, f.u / f.landU);
          let x = s.x * v;
          const launchY = -0.1 - laneDepth / k;
          let y = launchY + (s.y - launchY) * (s.where === 'short' ? Math.sin(Math.PI * f.u) : v);
          let radius = Math.max(4, 0.045 * k * (1.4 - 0.4 * v));
          if (f.u >= f.landU && s.rattle && s.where !== 'short') {
            const settle = clamp(((f.u - f.landU) / (1 - f.landU)) / 0.25, 0, 1);
            x += Math.sin(settle * Math.PI * 5) * 0.014 * (1 - settle);
            y += Math.abs(Math.sin(settle * Math.PI * 2)) * 0.025 * (1 - settle);
          }
          if (stacked && f.u >= f.landU && s.where !== 'short') {
            const targetIndex = s.where === 'gutter' ? rings.length : rings.findIndex(([, value]) => String(value) === s.where);
            const target = s.where === 'cup' ? cups[s.ex < 0 ? 0 : 1] : pockets[targetIndex];
            const w = (f.u - f.landU) / (1 - f.landU);
            const settle = clamp(w / 0.25, 0, 1);
            const approach = clamp((w - 0.25) / 0.55, 0, 1);
            x += (s.ex - x) * settle;
            y += (s.ey - y) * settle;
            if (target) {
              x += (target[0] - x) * approach;
              y += (target[1] - y) * approach;
              radius *= 1 - clamp((w - 0.8) / 0.2, 0, 1);
            }
          }
          g.beginPath(); g.arc(X(x), Y(y), radius, 0, 7); g.fillStyle = sc.color; g.fill(); g.strokeStyle = '#111'; g.stroke();
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
        cabinet.addColorStop(0, '#343e49');
        cabinet.addColorStop(1, '#111820');
        g.fillStyle = cabinet;
        g.beginPath();
        g.moveTo(X(-1.00), Y(0.38)); g.lineTo(X(-0.81), Y(1.34));
        g.lineTo(X(-0.74), Y(1.47)); g.lineTo(X(0.74), Y(1.47));
        g.lineTo(X(0.81), Y(1.34)); g.lineTo(X(1.00), Y(0.38));
        g.closePath(); g.fill();
        const strip = (x1, y1, x2, y2) => {
          g.save();
          g.strokeStyle = '#59ebff';
          g.shadowColor = '#2cd9ff'; g.shadowBlur = 8;
          g.lineWidth = Math.max(1.5, 0.012 * k);
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
          g.restore();
        };
        for (const side of [-1, 1]) strip(X(side * 0.785), Y(1.21), X(side * 0.83), Y(0.39));
        const marqueeWash = g.createLinearGradient(0, Y(1.44), 0, Y(1.25));
        marqueeWash.addColorStop(0, '#23505d'); marqueeWash.addColorStop(1, '#10242d');
        g.fillStyle = marqueeWash; g.fillRect(X(-0.75), Y(1.44), 1.50 * k, 0.19 * k);
        strip(X(-0.74), Y(1.25), X(0.74), Y(1.25));
        g.fillStyle = '#bdf6ff';
        g.font = `900 ${Math.max(12, k * 0.112)}px system-ui`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('BASKETBALL', cx, Y(1.345));
        const [, y, rx] = sc.geo.hoops[0];
        const py = Y(y);
        g.fillStyle = '#141a22'; g.fillRect(X(-0.92), Y(y + 0.21), 1.84 * k, 0.066 * k);
        strip(X(-0.72), Y(y + 0.18), X(0.72), Y(y + 0.18));
        {
          const px = X(sc.hoopX ?? 0), rim = hoopRingRadius(rx) * k;
          const glassTint = g.createLinearGradient(px - 0.18 * k, py - 0.19 * k, px + 0.18 * k, py);
          glassTint.addColorStop(0, '#a4ebff99'); glassTint.addColorStop(0.45, '#3a839744');
          glassTint.addColorStop(1, '#6bb8df77');
          g.fillStyle = glassTint; g.fillRect(px - 0.18 * k, py - 0.19 * k, 0.36 * k, 0.22 * k);
          g.strokeStyle = '#91b6b6'; g.strokeRect(px - 0.18 * k, py - 0.19 * k, 0.36 * k, 0.22 * k);
          g.strokeRect(px - 0.065 * k, py - 0.058 * k, 0.13 * k, 0.072 * k);
          g.strokeRect(px - 0.15 * k, py - 0.16 * k, 0.30 * k, 0.15 * k);
          const tilt = basketballRimTilt(sc.netHit);
          const sine = Math.sin(tilt), cosine = Math.cos(tilt);
          const projectNetY = ({ y, z }) => py - (y * (cosine + 0.14 * sine) + z * (0.14 * cosine - sine)) * k;
          const knots = basketballNet(rim / k, sc.netHit, sc.netDrift);
          for (const front of [false, true]) {
            g.beginPath();
            for (const [from, to] of netWeave) {
              const a = knots[from], b = knots[to];
              if ((a.z + b.z > 0) !== front) continue;
              g.moveTo(px + a.x * k, projectNetY(a));
              for (let segment = 1; segment <= netSubdivisions; segment++) {
                const point = netCordPoint(a, b, segment / netSubdivisions);
                g.lineTo(px + point.x * k, projectNetY(point));
              }
            }
            g.lineWidth = Math.max(0.75, 0.005 * k);
            g.strokeStyle = front ? '#f3e4cc' : '#9ba29c';
            g.stroke();
          }
          g.beginPath(); g.ellipse(px, py, rim, Math.max(2, rim * Math.abs(0.14 * cosine - sine)), 0, 0, 2 * Math.PI);
          const flash = sc.scoreGlow ?? 0;
          if (flash > 0) {
            g.strokeStyle = `rgba(157, 255, 125, ${flash * 0.75})`;
            g.lineWidth = 4 + 5 * flash;
            g.stroke();
          }
          g.strokeStyle = flash > 0.25 ? '#ccffb4' : '#ff833e';
          g.lineWidth = 4; g.stroke(); g.lineWidth = 2;
        }
        const ballY = (y, z) => Y(y - 1 + 0.14 * (hoopDepth - z));
        g.beginPath();
        g.moveTo(X(-0.92), ballY(hoopRampY(hoopDepth) - hoopRadius, hoopDepth));
        g.lineTo(X(-0.92), ballY(hoopRampY(hoopRackZ) - hoopRadius, hoopRackZ));
        g.lineTo(X(0.92), ballY(hoopRampY(hoopRackZ) - hoopRadius, hoopRackZ));
        g.lineTo(X(0.92), ballY(hoopRampY(hoopDepth) - hoopRadius, hoopDepth));
        const rampBack = ballY(hoopRampY(hoopDepth) - hoopRadius, hoopDepth);
        const rampFront = ballY(hoopRampY(hoopRackZ) - hoopRadius, hoopRackZ);
        const rampShade = g.createLinearGradient(0, rampBack, 0, rampFront);
        rampShade.addColorStop(0, '#34404a'); rampShade.addColorStop(1, '#182029');
        g.fillStyle = rampShade; g.fill();
        for (const side of [-1, 1]) {
          g.fillStyle = '#28313b';
          g.beginPath();
          g.moveTo(X(side * 0.86), Y(0.38)); g.lineTo(X(side * 0.76), rampBack);
          g.lineTo(X(side * 0.76), rampFront); g.lineTo(X(side * 0.86), rampFront + 0.12 * k);
          g.closePath(); g.fill();
          strip(X(side * 0.86), Y(0.38), X(side * 0.84), rampFront);
        }
        g.strokeStyle = '#a0cec57a'; g.lineWidth = 1;
        g.strokeRect(X(-0.88), rampBack + 0.025 * k, 1.76 * k, rampFront - rampBack - 0.05 * k);
        g.strokeStyle = '#64edffa8'; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(X(sc.hoopX ?? 0), rampBack, hoopRingRadius(sc.geo.hoops[0][2]) * k, 0.048 * k, 0, 0, 2 * Math.PI); g.stroke();
        const trayY = ballY(hoopRampY(hoopRackZ), hoopRackZ);
        g.fillStyle = '#10151c'; g.fillRect(X(-1.00), trayY + 0.03 * k, 1.72 * k, 0.18 * k);
        g.save();
        g.translate(cx, trayY + 0.06 * k); g.scale(0.92 * k, 0.13 * k);
        const poolLight = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        poolLight.addColorStop(0, '#6de9ff80'); poolLight.addColorStop(1, '#6de9ff00');
        g.fillStyle = poolLight; g.fillRect(-1, -1, 2, 2);
        g.restore();
        strip(X(-0.83), trayY + 0.151 * k, X(0.83), trayY + 0.151 * k);
        if (sc.preview) {
          const count = 16;
          for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            const { x, y, z } = basketballGuide(sc.preview, i, count);
            g.beginPath();
            g.arc(X(x), ballY(y, z), clamp(k * 0.02, 2.2, 4) * (1 - 0.52 * t), 0, 2 * Math.PI);
            g.fillStyle = `rgba(100, 237, 255, ${0.96 - 0.70 * t})`;
            g.fill();
          }
        }
        const ballSize = (z) => Math.max(4, hoopRadius * k * (1 + 0.17 * (z - hoopRackZ)));
        rackTargets = (sc.rack ?? []).map((ball) => ({ ball, x: X(ball.x), y: ballY(ball.y, ball.z), radius: ballSize(ball.z) }));
        for (const ball of [...sc.basketballs].sort((a, b) => a.z - b.z)) {
          const x = X(ball.x), py = ballY(ball.y, ball.z), r = ballSize(ball.z);
          const floorY = ballY(hoopRampY(ball.z), ball.z), lift = clamp((floorY - py) / (1.2 * k), 0, 1);
          g.fillStyle = `rgba(0, 0, 0, ${0.5 - 0.38 * lift})`;
          g.beginPath(); g.ellipse(x, floorY + r * 0.1, r * (1 - 0.3 * lift), r * 0.28 * (1 - 0.3 * lift), 0, 0, 2 * Math.PI); g.fill();
          g.beginPath(); g.arc(x, py, r, 0, 2 * Math.PI);
          const rubber = g.createRadialGradient(x - r * 0.35, py - r * 0.4, 0, x, py, r);
          rubber.addColorStop(0, '#ffe1ad'); rubber.addColorStop(0.33, '#ff9b4e');
          rubber.addColorStop(0.68, '#e46120'); rubber.addColorStop(1, '#8e3313');
          g.fillStyle = rubber; g.fill();
          g.strokeStyle = '#723514'; g.lineWidth = Math.max(0.8, r * 0.055); g.stroke();
          g.save();
          g.clip();
          g.translate(x, py);
          g.rotate(ball.spin * 0.65 + 0.32);
          g.fillStyle = '#ffe3bb42';
          for (let row = -5; row <= 5; row++) {
            for (let col = -5; col <= 5; col++) {
              g.fillRect((col + (row % 2) * 0.5) * r / 5, row * r / 5, r * 0.055, r * 0.055);
            }
          }
          g.beginPath();
          g.moveTo(0, -r); g.lineTo(0, r);
          g.moveTo(-r, 0);
          g.lineTo(r, 0);
          for (const offset of [-0.34, 0.34]) {
            g.moveTo(offset * r, -r);
            g.bezierCurveTo(offset * 0.72 * r, -0.35 * r, offset * 0.72 * r, 0.35 * r, offset * r, r);
          }
          g.lineWidth = Math.max(1, r * 0.075);
          g.strokeStyle = '#21140d';
          g.stroke();
          g.restore();
          const shade = g.createRadialGradient(x - r * 0.4, py - r * 0.45, r * 0.05, x, py, r);
          shade.addColorStop(0, '#ffffff55'); shade.addColorStop(0.35, '#ffffff00'); shade.addColorStop(1, '#2a0d0455');
          g.beginPath(); g.arc(x, py, r, 0, 2 * Math.PI); g.fillStyle = shade; g.fill();
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
      if (sc.preview && !basketball) {
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
  const myMove = (s) => s.phase === 'playing' && s.midway?.stage === 'play' && !!s.midway.me && hasShots(s.midway);
  return { mount, unmount, render, turnText, myMove, focus: true };
})();
