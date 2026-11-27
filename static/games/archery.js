// Wind Archery: a 3D range (three.js) or a flat target face. On your turn: drag to move the sight over the
// target (it moves like a trackpad, so your finger never hides the gold), hold to draw, and let go to loose;
// or nudge with ◀ ▲ ▼ ▶ and tap 🏹 Loose. The server says where the arrow lands; every screen plays the flight.
// #177: each end is a course (🍎 apple, 🎈 balloons, 🪝 a swinging face you lead), 🔥 a fire arrow once an end
// (gold doubles, else nothing), ✨ golden streaks, slow motion on big shots, a crowd, and a 🏹 shoot-off for ties.
UI.archery = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, queue = [], seen = 0, primed = false, lastDraw = 0, shotAt = 0, endSeen = 0;
  let aim = { x: 0, y: 0 }, breath = false, fire = false, hold = null, popT = 0;
  let rangeReadyAt = 0, rangePending = false;
  let swT0 = null, corr = 0, corrT = 0;      // the swinging face's clock (seconds, performance.now based) and a jump easing out
  const $ = (id) => document.getElementById(id);
  const HIT = 1.3;       // seconds on the hit close-up
  const V = () => S.archery;
  const colorOf = (i) => ctx?.player(V().seats[i])?.color ?? '#ccc';
  const nameOf = (i) => ctx?.player(V().seats[i])?.name ?? '?';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !S.paused && !V().between;
  const busy = () => !!(anim || queue.length);
  const canShoot = () => myTurn() && !busy() && !rangePending && performance.now() >= rangeReadyAt;
  const clamp = (v, a) => Math.max(-a, Math.min(a, v));
  // how much of the target plane the aiming view shows (half its short side, in metres): further looks smaller
  const span = (dist) => 0.75 + dist / 100;
  const KIND = { apple: '🍎 Apple end', balloons: '🎈 Balloon end', swing: '🪝 Swinging target', shootoff: '🏹 Shoot-off' };

  // ---------- #177 the swinging face: where its centre is (m right of the middle) at `age` s into the end
  const swingAt = (age) => { const r = V().range; return (r.swingA ?? 0.32) * Math.sin(2 * Math.PI * age / (r.swingP ?? 4.6)); };
  const swingAge = (now) => now / 1000 - swT0;
  // slow motion (#177): a big shot flies at normal speed for most of the way, then the last stretch takes `slow`
  // seconds longer. simT maps real seconds since the loose to the arrow's own clock (0 … fly, then on).
  function simT(sh, r) {
    const fly = sh.fly ?? sh.t, slow = sh.slow || 0;
    if (!slow) return r;
    const a = 0.72 * fly, rest = fly - a, realRest = rest + slow;
    if (r <= a) return r;
    if (r >= a + realRest) return fly + (r - a - realRest);
    return a + rest * (r - a) / realRest;
  }
  const inSlow = (sh, r) => !!sh.slow && r > 0.72 * (sh.fly ?? sh.t) && r < sh.t;
  function bossX(now) {
    const sh = anim?.shot;
    if (sh && sh.ph != null) return swingAt(sh.ph + simT(sh, (now - anim.t0) / 1000));
    if (!V().swing || swT0 == null) return 0;
    return swingAt(swingAge(now)) + (corr ? corr * Math.exp(-(now - corrT) / 350) : 0);
  }

  function mountRange(main, side) {
    S = null; rangePending = false; rangeReadyAt = 0; popT = 0;
    gl = null; flat = null; anim = null; queue = []; seen = 0; primed = false; hold = null; breath = false; fire = false; endSeen = 0; swT0 = null; corr = 0;
    aim = { x: 0, y: 0 };
    main.innerHTML = `<div class="ar"><div class="ar-stage" id="arStage">
        <div class="ar-hud"><span id="arEnd"></span><span id="arTurn"></span></div>
        <div class="ar-wind" id="arWind" title="The wind on the flag"><i id="arWindArrow">➤</i><b id="arWindKmh"></b><small>km/h</small></div>
        <div class="ar-pop" id="arPop" hidden></div>
        <div class="ar-course" id="arCourse" hidden></div>
        <div class="ar-stam" id="arStam" hidden title="How long you can hold the draw"><i></i><b>💪</b></div>
        <div class="ar-done" id="arDone" hidden><h3 id="arDoneTitle"></h3><div id="arStand"></div></div>
      </div>
      <div class="ar-ctl" id="arCtl">
        <div class="ar-pad" role="group" aria-label="Move the sight">
          <button data-n="-1,0" aria-label="Sight left">◀</button><button data-n="0,1" aria-label="Sight up">▲</button>
          <button data-n="0,-1" aria-label="Sight down">▼</button><button data-n="1,0" aria-label="Sight right">▶</button>
        </div>
        <button class="ar-breath" id="arBreath" title="Once a game: no sway and no gust on this arrow">🧘 Steady</button>
        <button class="ar-fire" id="arFire" title="Once an end: the gold (9 or 10) scores double, anything else scores nothing">🔥 Fire</button>
        <button class="ar-loose" id="arLoose">🏹 Loose</button>
      </div>
      <p id="arLast" class="ar-last" role="status"></p>
      <p id="arHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel ar-darts-scorecard"><h3>Scoreboard</h3><div id="arCard" class="ar-card"></div></div>';
    const stage = $('arStage');
    $('arCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.n) {
        if (!myTurn()) return;
        const [dx, dy] = b.dataset.n.split(',').map(Number), step = V().range.ring / 2;
        setAim(aim.x + dx * step, aim.y + dy * step);
      } else if (b.id === 'arBreath') {
        if (myTurn() && V().breath[V().me]) breath = !breath;
      } else if (b.id === 'arFire') {
        if (myTurn() && V().fire?.[V().me] && V().kind !== 'shootoff') { fire = !fire; if (fire) SND.ignite(); }
      } else if (b.id === 'arLoose') return loose();
      controls();
    });
    // drag anywhere on the range: the sight follows the finger's movement; holding draws the bow, letting go looses
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (hold || e.button !== 0 || !canShoot() || e.target.closest('button, .ar-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      const r = stage.getBoundingClientRect(), k = (2 * span(V().dist)) / Math.max(120, Math.min(r.width, r.height));
      const dx = e.clientX - hold.x, dy = e.clientY - hold.y;
      hold.x = e.clientX; hold.y = e.clientY; hold.moved += Math.abs(dx) + Math.abs(dy);
      setAim(aim.x + dx * k, aim.y - dy * k);
    });
    stage.addEventListener('pointerup', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      const drawn = performance.now() - hold.t0 > 350;   // a quick tap doesn't shoot
      if (drawn) loose(); else hold = null;
    });
    const cancelHold = (e) => { if (hold?.id === e.pointerId) hold = null; };
    stage.addEventListener('pointercancel', cancelHold);
    stage.addEventListener('lostpointercapture', cancelHold);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmountRange() {
    clearTimeout(course.t);
    S = null;
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null; hold = null;
    window.Snd?.bed('ar.wind').set(0);
  }

  // ---------- sound (#127), on the shared Snd kit (static/sfx.js), outdoors on the range
  const OUT = { room: 'outdoor', send: 0.5 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...OUT, pan, vol })));
  const SND = {
    // the limbs bending as you draw: a low wooden creak
    draw: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 320, f1: 520, q: 4, vol: 0.12, tau: 0.08, dur: 0.35, attack: 0.08 }); K.mode(d, t + 0.05, 95, 0.05, 0.08); }),
    // tired arms: a creak with a shiver in it, louder as they tire
    strain: (k) => snd((t, K, d) => { for (let n = 0; n < 3; n++) K.burst(d, t + n * 0.06, { type: 'bandpass', f: K.R(260, 420), q: 5, vol: 0.05 + 0.08 * k, tau: 0.03 }); }),
    // the arm gives out: the string eased back down
    letdown: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 500, f1: 260, q: 3, vol: 0.12, tau: 0.08, dur: 0.4 }); K.mode(d, t + 0.35, 90, 0.08, 0.06); }),
    // the string: a twang (the bow's low body and the string's partials), the slap on the arm guard, then the
    // arrow's hiss away downrange
    loose: (mine) => snd((t, K, d) => {
      const v = mine ? 1 : 0.45, f = K.R(100, 125);
      K.mode(d, t, f, 0.22 * v, 0.09); K.mode(d, t, f * 2.02, 0.1 * v, 0.06); K.mode(d, t, f * 3.05, 0.05 * v, 0.04); K.mode(d, t, f * 5.1, 0.02 * v, 0.02);
      K.burst(d, t, { type: 'bandpass', f: 1800, q: 1.2, vol: 0.25 * v, tau: 0.006 });
      K.burst(d, t + 0.02, { type: 'bandpass', f: 3800, f1: 1400, q: 1.5, vol: 0.09 * v, tau: 0.08, dur: 0.45, attack: 0.03 });
    }, 0, 1),
    // the arrow arriving: a deep thwack into the straw boss, a ring of the gold for a 9 or 10, a thump in the
    // grass for a miss, and an apple bursting
    hit: (ring, apple) => snd((t, K, d) => {
      if (!ring) { K.burst(d, t, { type: 'lowpass', f: 380, q: 0.7, vol: 0.25, tau: 0.03, buf: 'brown' }); K.burst(d, t, { type: 'bandpass', f: 2500, q: 1, vol: 0.05, tau: 0.02 }); return; }
      K.burst(d, t, { type: 'lowpass', f: 900, q: 0.8, vol: 0.45, tau: 0.018, buf: 'brown' });
      K.mode(d, t, 140, 0.22, 0.05, { f1: 110 }); K.burst(d, t, { type: 'bandpass', f: 2600, q: 1.3, vol: 0.18, tau: 0.004 });
      K.mode(d, t + 0.01, 38, 0.1, 0.06);  // the arrow's shaft quivering
      if (ring >= 9) [1319, 1760, 2637].forEach((f, n) => K.mode(d, t + 0.08 + n * 0.07, f, ring === 10 ? 0.06 : 0.04, 0.25));
      if (apple) for (let n = 0; n < 6; n++) K.burst(d, t + n * K.R(0.01, 0.03), { type: 'bandpass', f: K.R(1800, 4200), q: 1.6, vol: 0.12, tau: 0.01 });
    }),
    // #177 a balloon popping: a sharp crack and a rubbery slap
    pop: () => snd((t, K, d) => { K.burst(d, t, { type: 'highpass', f: 1800, q: 0.7, vol: 0.5, tau: 0.008 }); K.burst(d, t, { type: 'bandpass', f: 700, f1: 300, q: 2, vol: 0.18, tau: 0.03 }); }),
    // the crowd along the range: a cheer and claps for a big shot, a groan for a burnt-out fire arrow or a miss
    cheer: (big) => snd((t, K, d) => {
      K.burst(d, t + 0.05, { type: 'bandpass', f: 1300, q: 0.6, vol: 0.09 * big, tau: 0.35, dur: 1.2 + 0.4 * big, attack: 0.22 });
      K.burst(d, t + 0.05, { type: 'bandpass', f: 560, q: 0.8, vol: 0.07 * big, tau: 0.4, dur: 1.1 + 0.4 * big, attack: 0.28 });
      for (let n = 0; n < Math.round(10 * big); n++) K.burst(d, t + 0.15 + K.R(0, 1.3), { type: 'bandpass', f: K.R(1500, 2600), q: 1.4, vol: 0.05, tau: 0.012 });
    }, 0, 0.8),
    groan: () => snd((t, K, d) => {
      for (const f of [190, 235, 290]) K.sweep(d, t + 0.05 + K.R(0, 0.06), { f0: f, f1: f * 0.7, dur: 0.9, vol: 0.022, type: 'triangle', attack: 0.25 });
      K.burst(d, t + 0.05, { type: 'bandpass', f: 520, f1: 320, q: 1.2, vol: 0.06, tau: 0.3, dur: 0.9, attack: 0.2 });
    }, 0, 0.8),
    // a fire arrow lit: a soft whump and crackle
    ignite: () => snd((t, K, d) => { K.burst(d, t, { type: 'lowpass', f: 600, f1: 1800, q: 0.7, vol: 0.18, tau: 0.08, dur: 0.35, attack: 0.04, buf: 'brown' }); for (let n = 0; n < 5; n++) K.burst(d, t + K.R(0.05, 0.4), { type: 'bandpass', f: K.R(2000, 4500), q: 2, vol: 0.05, tau: 0.006 }); }),
    // slow motion setting in: a deep stretched whoosh
    slow: () => snd((t, K, d) => { K.burst(d, t, { type: 'bandpass', f: 900, f1: 180, q: 1.3, vol: 0.14, tau: 0.2, dur: 0.9, attack: 0.15 }); K.sweep(d, t, { f0: 120, f1: 60, dur: 0.9, vol: 0.06, attack: 0.1 }); }),
  };
  // the wind across the range, louder in a stronger wind
  const windBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('white'), bp = A.createBiquadFilter(), g = A.createGain(), lfo = A.createOscillator(), lg = A.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 450; bp.Q.value = 0.7; g.gain.value = 0;
    lfo.frequency.value = 0.17; lg.gain.value = 220; lfo.connect(lg).connect(bp.frequency); lfo.start();
    src.connect(bp).connect(g).connect(dst);
    return { set(l) { g.gain.setTargetAtTime(0.022 * l, A.currentTime, 0.8); }, stop() { try { src.stop(); lfo.stop(); } catch {} } };
  };
  function popText(text) { const el = $('arPop'); if (!el) return; el.textContent = text; el.style.color = '#ffd6a0'; el.style.fontSize = '20px'; el.hidden = false; popT = performance.now() + 1800; }

  function setAim(x, y) {
    const a = S?.archery?.range?.aim ?? 1.2;
    aim.x = clamp(x, a); aim.y = clamp(y, a);
  }

  // the sight never sits still: a little when the bow is just up, steady for the first couple of seconds of a
  // draw, then the arms tire (#128): the sway grows, a tremor creeps in after 5 s, and at 9 s the arm gives out
  // and the draw is let down without a shot
  const STEADY = 2, TREMOR = 5, GIVE = 9;
  const heldFor = (now) => (hold ? (now - hold.t0) / 1000 : -1);
  const c01 = (v) => Math.max(0, Math.min(1, v));
  function sway(now) {
    if (breath || (window.motionOK && !motionOK() && !hold)) return { x: 0, y: 0 };
    const held = heldFor(now), t = now / 1000;
    const A = held < 0 ? 0.03 : 0.012 + 0.075 * c01((held - STEADY) / 4);
    const J = held > TREMOR ? 0.03 * c01((held - TREMOR) / 3) : 0;
    return {
      x: A * (Math.sin(t * 1.7) + 0.5 * Math.sin(t * 3.1 + 1)) / 1.5 + J * (Math.sin(t * 11.3) + 0.6 * Math.sin(t * 17.9 + 2)) / 1.6,
      y: A * (Math.cos(t * 1.3) + 0.5 * Math.sin(t * 2.7)) / 1.5 + J * (Math.cos(t * 12.7 + 1) + 0.6 * Math.sin(t * 19.3)) / 1.6,
    };
  }
  // the stamina ring while drawing, and the arm giving out
  function stamina(now) {
    const el = $('arStam'); if (!el) return;
    const held = heldFor(now);
    el.hidden = held < 0 || breath;
    if (held < 0) return;
    const left = 1 - c01(held / GIVE), col = held < STEADY ? '#3ddc97' : held < TREMOR ? '#ffd23f' : '#ef476f';
    el.style.setProperty('--p', `${Math.round(left * 360)}deg`); el.style.setProperty('--c', col);
    el.classList.toggle('shake', held > TREMOR);
    if (held > 0.8 && !hold.creak) { hold.creak = 1; SND.draw(); }
    if (held > STEADY + 1.5 * (hold.creak || 1) && held < GIVE) { hold.creak = (hold.creak || 1) + 1; SND.strain(c01((held - STEADY) / (GIVE - STEADY))); }
    if (held >= GIVE && !breath) {
      hold = null; el.hidden = true; SND.letdown(); ctx.buzz?.([30, 40, 30]);
      popText('💪 Your arm gave out: draw again'); controls();
    }
  }

  function loose() {
    if (!canShoot()) { hold = null; return; }
    const now = performance.now(), s = sway(now), a = V().range.aim;
    const held = Math.max(0, heldFor(now));
    hold = null; shotAt = now;
    SND.loose(true); ctx.buzz?.(15);
    const useBreath = breath && V().breath[V().me], useFire = fire && !!V().fire?.[V().me] && V().kind !== 'shootoff';
    breath = false; fire = false;
    const extra = V().swing && swT0 != null ? { ph: +swingAge(now).toFixed(3) } : {};
    rangePending = true;
    ctx.quiet(ctx.act('shoot', { ax: +clamp(aim.x + s.x, a).toFixed(3), ay: +clamp(aim.y + s.y, a).toFixed(3), breath: useBreath, fire: useFire, held: +held.toFixed(2), ...extra }).finally(() => {
      if (S && shotAt === now) {
        rangePending = false;
        controls();
      }
    }));
    controls();
  }

  function controls() {
    if (!S?.archery) return;
    const v = V(), go = canShoot(), mine = myTurn();
    $('arLoose').disabled = !go;
    $('arLoose').classList.toggle('ar-ready', go);
    $('arCtl').classList.toggle('ar-off', !mine);
    for (const button of $('arCtl').querySelectorAll('[data-n]')) button.disabled = !mine;
    const left = v.me != null && v.breath[v.me];
    if (!left) breath = false;
    $('arBreath').disabled = !mine || !left;
    $('arBreath').classList.toggle('on', breath);
    $('arBreath').setAttribute('aria-pressed', String(breath));
    $('arBreath').textContent = left ? (breath ? '🧘 Steady: on' : '🧘 Steady') : '🧘 used';
    const fl = v.me != null && !!v.fire?.[v.me] && v.kind !== 'shootoff';
    if (!fl) fire = false;
    $('arFire').disabled = !mine || !fl;
    $('arFire').hidden = v.kind === 'shootoff' || !v.fire;
    $('arFire').classList.toggle('on', fire);
    $('arFire').setAttribute('aria-pressed', String(fire));
    $('arFire').textContent = fl ? (fire ? '🔥 Fire: on' : '🔥 Fire') : '🔥 used';
  }

  function renderRange(s, c) {
    S = s; ctx = c;
    const v = V();
    rangeReadyAt = performance.now() + 1000 * (v.readyIn || 0);
    if (!myTurn()) hold = null;
    if (!primed) {
      primed = true;
      seen = v.shot?.id ?? 0;
      endSeen = v.done > 0 || v.between ? (v.kind === 'shootoff' ? `so${v.end}` : v.end) : null;
      showArrowResult(v.shot);
    }
    if (v.shot && v.shot.id !== seen) { seen = v.shot.id; queue.push({ ...v.shot, dist: v.dist }); }
    const endKey = v.kind === 'shootoff' ? `so${v.end}` : v.end;
    if (endKey !== endSeen) { endSeen = endKey; aim = { x: 0, y: 0 }; swT0 = null; corr = 0; if (S.phase === 'playing') course(v); }   // a new distance: the sight starts on the gold
    if (v.swing) {   // the swing clock, from the server's: keep the first reading unless it drifts (a slow message)
      const est = performance.now() / 1000 - v.swing.age;
      if (swT0 == null || Math.abs(est - swT0) > 0.3) swT0 = est;
    }
    $('arEnd').textContent = v.kind === 'shootoff' ? `🏹 Shoot-off · ${v.dist} m` : `${(KIND[v.kind] || '🎯').split(' ')[0]} End ${v.end} of ${v.ends} · ${v.dist} m`;
    const who = v.next != null ? (v.next === v.me ? 'Your arrow' : `${nameOf(v.next)}'s arrow`) : '';
    $('arTurn').textContent = v.between ? `End ${v.end} done` : v.next != null ? `${who} · ${v.done + 1} of ${v.order.length}` : '';
    $('arWindKmh').textContent = String(v.kmh);
    $('arWindArrow').style.transform = `rotate(${(-Math.atan2(v.wind[1], v.wind[0]) * 180 / Math.PI).toFixed(0)}deg)`;
    $('arWind').classList.toggle('ar-strong', v.kmh >= 18);
    controls(); renderCard(); renderDone(); hint();
  }

  function hint() {
    const v = V();
    const t = S.phase !== 'playing' ? '' : v.between ? 'Next end in a moment…'
      : !myTurn() ? (busy() ? '' : `Watch where ${v.next != null ? nameOf(v.next) : 'the next archer'} aims and where the arrow lands: it tells you the wind.`)
        : v.kind === 'shootoff' ? 'One arrow: closest to the middle wins the game.'
        : v.kind === 'swing' ? `The target swings: aim where it will be when the arrow arrives. Wind ${v.wind[0] > 0 ? '→, aim left of it' : '←, aim right of it'}.`
        : `Drag to move the sight, hold to draw, let go to loose. The wind blows ${v.wind[0] > 0 ? 'to the right →, so aim left' : 'to the left ←, so aim right'}.`;
    if ($('arHint').textContent !== t) $('arHint').textContent = t;
  }

  function renderCard() {
    const v = V(), box = $('arCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores ar-scores');
    const head = ctx.el('tr');
    const cols = v.between || v.kind === 'shootoff' ? v.endsLog : [...v.endsLog, v.endPts];
    head.append(ctx.el('th', '', ''), ...cols.map((_, k) => ctx.el('th', '', String(k + 1))), ctx.el('th', '', 'Σ'), ctx.el('th', '', '✖'), ctx.el('th', '', '🏹'));
    t.append(head);
    v.seats.forEach((pid, i) => {
      const row = ctx.el('tr', v.next === i ? 'now' : '');
      const st = v.streak?.[i] || 0;
      const nm = ctx.el('td', '', (ctx.player(pid)?.name ?? '?') + (st >= 2 ? ` ✨${st}` : '')); nm.style.color = colorOf(i);
      if (st >= 2) nm.title = st >= 3 ? `${st} golds in a row: +1 a gold` : '2 golds in a row: one more for +1 a gold';
      row.append(nm, ...cols.map((r) => ctx.el('td', '', String(r[i] ?? 0))));
      const tot = ctx.el('td', ''); tot.append(ctx.el('b', '', String(v.points[i]))); row.append(tot);
      row.append(ctx.el('td', 'ar-x', v.xs[i] ? String(v.xs[i]) : '·'));
      let left = 0;
      if (!v.between) for (let k = v.done; k < v.order.length; k++) if (v.order[k] === i) left++;
      row.append(ctx.el('td', 'ar-left', (left ? '●'.repeat(left) : '–') + (v.fire?.[i] && v.kind !== 'shootoff' && !v.between ? ' 🔥' : '') + (v.breath[i] ? ' 🧘' : '')));
      t.append(row);
    });
    box.append(t);
    const pr = v.prizes || [], bal = pr.filter((q) => q.k !== 'apple').length;
    box.append(ctx.el('p', 'hint left', v.kind === 'shootoff' ? `🏹 Shoot-off: ${(v.shootoff || []).map(nameOf).join(' vs ')}, one arrow each, closest to the middle wins.`
      : v.kind === 'swing' ? '🪝 The target swings side to side: lead it.'
        : v.kind === 'balloons' ? (bal ? `🎈 ${bal} balloon${bal > 1 ? 's' : ''} still up: +3 each${pr.some((q) => q.k === 'gold') ? ', the gold one +6' : ''}.` : '🎈 Every balloon is popped.')
          : v.apple ? '🍎 The apple is still up: first arrow through it scores +5.' : '🍎 The apple is gone this end.'));
    box.append(ctx.el('p', 'hint left', '🔥 Fire arrow, once an end: gold scores double, anything else 0. ✨ Three golds in a row: +1 a gold.'));
  }

  function renderDone() {
    const v = V();
    if (!v.between) { $('arDone').hidden = true; return; }
    $('arDoneTitle').textContent = v.kind === 'shootoff' ? '🏹 Shoot-off' : `🏁 End ${v.end} · ${v.dist} m`;
    const nextK = v.end < v.ends ? ({ 2: ['apple', 'swing'], 3: ['apple', 'balloons', 'swing'], 5: ['apple', 'balloons', 'swing', 'balloons', 'swing'] }[v.ends] || [])[v.end] : null;
    standingsCard($('arStand'), v.standings, { title: 'Points', note: `Most points wins; a tie goes to a one-arrow shoot-off.${nextK && v.kind !== 'shootoff' ? ` Next: ${KIND[nextK]}.` : ''}` });
  }

  // the course banner as an end starts
  function course(v) {
    const el = $('arCourse'); if (!el) return;
    el.textContent = v.kind === 'shootoff' ? '🏹 Shoot-off! Closest to the middle' : `${KIND[v.kind] || '🎯'} · ${v.dist} m`;
    el.hidden = false; el.classList.remove('ar-course-in'); void el.offsetWidth; el.classList.add('ar-course-in');
    clearTimeout(course.t); course.t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function showArrowResult(shot) {
    if (!shot) return;
    const hit = shot.x10 ? 'Dead centre' : shot.ring ? `Ring ${shot.ring}` : 'Miss';
    const score = shot.so ? `${Math.round(Math.hypot(shot.x, shot.y) * 100)} cm from centre` : `+${shot.pts} pts`;
    $('arLast').textContent = `${nameOf(shot.o)} · ${hit} · ${score}`;
  }

  function pop(shot) {
    showArrowResult(shot);
    const el = $('arPop'); if (!el) return;
    el.style.fontSize = '';
    const ring = shot.x10 ? '✖ 10' : shot.ring ? String(shot.ring) : 'Miss';
    const extras = [];
    if (shot.so) extras.push(`${Math.round(Math.hypot(shot.x, shot.y) * 100)} cm`);
    if (shot.fire) extras.push(shot.ring >= (V().range.fireGold ?? 9) ? `🔥 ×2 = ${shot.ring * 2}` : '🔥 burnt out: 0');
    for (const q of shot.prizes || (shot.apple ? [{ k: 'apple', pts: 5 }] : [])) extras.push(`${q.k === 'apple' ? '🍎' : '🎈'} +${q.pts}`);
    if (shot.bonus) extras.push(`✨ +${shot.bonus}`);
    if (shot.split) extras.push('🏹 split!');
    el.textContent = ring + (extras.length ? '  ' + extras.join('  ') : '');
    if (extras.length > 1) el.style.fontSize = 'clamp(22px, 6.5vw, 40px)';
    el.style.color = shot.fire && shot.ring >= 9 ? '#ff9b3d' : shot.ring >= 9 ? '#ffd23f' : shot.ring ? '#fff' : '#ff9a9a';
    el.hidden = false; el.classList.remove('ar-pop-in'); void el.offsetWidth; el.classList.add('ar-pop-in');
    popT = performance.now() + 1500;
  }

  // where the flying arrow is at u (0 at the bow, 1 in the target), in range coordinates: x, y on the target
  // plane's axes and d metres down the range. The wind's push grows with the square of the time in the air.
  // On a swinging end the shot's aim and landing are relative to the face, which was at shot.cx when it arrived.
  function arrowAt(shot, u) {
    const x0 = 0.18, y0 = 0.25;   // the bow hand, a little right of and below the eye line (target-centre relative)
    const c = shot.cx || 0, ax = shot.ax + c;
    return {
      x: x0 + (ax - x0) * u + (shot.x - shot.ax) * u * u,
      y: y0 + (shot.ay - y0) * u + (shot.y - shot.ay) * u * u + shot.dist * 0.03 * 4 * u * (1 - u),
      d: shot.dist * u,
    };
  }

  // everything a view needs to draw this instant
  function scene(now) {
    const v = V();
    const sh = anim?.shot || queue[0] || null;
    const r = anim ? (now - anim.t0) / 1000 : 0;
    const u = anim ? Math.min(1, simT(anim.shot, r) / (anim.shot.fly ?? anim.shot.t)) : 0;
    const landed = anim && r >= anim.shot.t;
    const pending = sh && !landed ? sh.id : 0;          // this arrow isn't in the target yet
    const arrows = v.arrows.filter((a) => a.id !== pending && !(queue.length && queue.some((q) => q.id === a.id)));
    // prizes (apple, balloons) still up, plus any that an arrow still on its way is about to take
    const prizes = [...(v.prizes || (v.apple ? [{ k: 'apple', x: v.apple.x, y: v.apple.y, id: 0 }] : []))];
    for (const q of [anim && !landed ? anim.shot : null, ...queue]) for (const p of q?.prizes || []) if (!prizes.some((o) => o.id === p.id)) prizes.push(p);
    const apple = prizes.find((q) => q.k === 'apple') || null;
    const mode = anim ? (landed ? 'hit' : 'flight') : myTurn() ? 'aim' : 'watch';
    const sw = mode === 'aim' ? sway(now) : { x: 0, y: 0 };
    const shooter = sh ? sh.o : v.next;
    return {
      mode, dist: sh?.dist ?? v.dist, wind: v.wind, arrows, apple, prizes, shooter,
      bx: bossX(now), swing: !!(v.swing || anim?.shot?.ph != null),
      slow: anim && !landed && inSlow(anim.shot, r),
      sight: mode === 'aim' ? { x: aim.x + sw.x, y: aim.y + sw.y, drawn: !!hold, calm: breath, fire } : null,
      fly: anim && !landed ? { ...arrowAt(anim.shot, u), u, o: anim.shot.o, fire: !!anim.shot.fire, next: arrowAt(anim.shot, Math.min(1, u + 0.02)) } : null,
      shot: anim?.shot || null, last: !anim && !queue.length ? v.shot : anim?.shot,
      span: span(sh?.dist ?? v.dist),
    };
  }

  function loop(now) {
    if (!$('arStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!S?.archery) return;
    if (!anim && queue.length) {
      anim = { shot: queue.shift(), t0: now, hit: false };
      if (!(anim.shot.o === V().me && now - shotAt < 3000)) SND.loose(false);
    }
    if (anim) {
      const t = (now - anim.t0) / 1000, sh = anim.shot;
      if (!anim.slowed && inSlow(sh, t)) { anim.slowed = true; SND.slow(); }
      if (!anim.hit && t >= sh.t) {
        anim.hit = true;
        SND.hit(sh.ring, !!sh.apple);
        if ((sh.prizes || []).some((q) => q.k !== 'apple')) SND.pop();
        const gold = sh.ring >= 9, big = sh.x10 || (sh.fire && gold) || (sh.prizes || []).length || sh.split;
        if (big) SND.cheer(sh.x10 || sh.fire ? 1.4 : 1); else if (gold && !sh.so) SND.cheer(0.5);
        else if ((sh.fire && !gold) || !sh.ring) SND.groan();
        if (sh.o === V().me) ctx.buzz?.(gold ? 40 : 20);
        pop(sh); (gl || flat)?.impact?.(sh);
      }
      if (t >= sh.t + HIT) {
        if (sh.ph != null && V().swing && swT0 != null) { corr = bossX(now) - swingAt(swingAge(now)); corrT = now; }  // ease back onto the clock
        anim = null; controls(); hint();
      }
    }
    if ($('arLoose').disabled === canShoot()) controls();
    if (popT && now > popT) { popT = 0; $('arPop').hidden = true; }
    stamina(now);
    window.Snd?.bed('ar.wind', windBed).set(S.phase === 'playing' && !S.paused ? Math.min(1, 0.25 + (V().kmh || 0) / 25) : 0);
    $('arDone').hidden = !V().between || busy();
    const sc = scene(now);
    $('arStage').classList.toggle('ar-slow', !!sc.slow);
    // on-demand drawing: every frame while aiming or flying, otherwise ~15 fps for the flag
    const idle = sc.mode === 'watch' && !(gl?.moving?.()) && !V().swing;
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- the target face, painted once for both views
  const RINGS = ['#f4f4f4', '#f4f4f4', '#22252b', '#22252b', '#3aa0e8', '#3aa0e8', '#e8483f', '#e8483f', '#ffd23f', '#ffd23f'];
  function paintFace(g, cx, cy, R) {
    for (let k = 0; k < 10; k++) {
      g.beginPath(); g.arc(cx, cy, R * (10 - k) / 10, 0, Math.PI * 2);
      g.fillStyle = RINGS[k]; g.fill();
      g.lineWidth = Math.max(1, R / 220); g.strokeStyle = k === 2 || k === 3 ? '#f4f4f4' : '#22252b88'; g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, R / 20, 0, Math.PI * 2); g.strokeStyle = '#22252b88'; g.stroke();   // the ✖ ring
  }

  // ---------- three.js range: world x = target x, world y = up, the target stands at z = -dist; face centre at y = CY
  const CY = 1.3;
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 0.1, 600);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.0, hemi: [0xdff1ff, 0x5c7a3a, 0.85], env: false,
      key: { color: 0xfff2d6, i: 1.05, pos: [-6, 12, 8], area: 5, near: 1, far: 40, map: 1024 },
      sky: { top: 0x2f7fd6, horizon: 0xbfe6ff, bottom: 0xcfe9d2, radius: 500, band: 0.12 }, fog: [0xcfe9d2, 90, 420],
    });
    const low = stg.low;
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });

    // the field: mown stripes down the range, darker rough either side
    const grass = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#4f9a3c'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#5aa845' : '#4a9238'; g.fillRect(0, k * h / 8, w, h / 8); }
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${20 + Math.random() * 40},${70 + Math.random() * 60},20,.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
    grass.wrapS = grass.wrapT = T.RepeatWrapping; grass.repeat.set(40, 40);
    const ground = new T.Mesh(new T.PlaneGeometry(800, 800), std(0xffffff, { map: grass }));
    ground.rotation.x = -Math.PI / 2; ground.position.z = -150; ground.receiveShadow = true; scene3.add(ground);
    const line = new T.Mesh(new T.PlaneGeometry(8, 0.12), new T.MeshBasicMaterial({ color: 0xffffff }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.01, -0.6); scene3.add(line);
    // a line of trees and soft hills far behind the targets
    const trees = new T.Group();
    const cone = new T.ConeGeometry(1, 1, 7), leaf = [std(0x2f6b2c), std(0x3c7d33), std(0x285a2a)];
    for (let k = 0; k < (low ? 22 : 46); k++) {
      const h = 7 + Math.random() * 8, m = new T.Mesh(cone, leaf[k % 3]);
      m.scale.set(h * 0.32, h, h * 0.32);
      m.position.set(-90 + k * (180 / (low ? 22 : 46)) + Math.random() * 3, h / 2 + 0.5, -100 - Math.random() * 30);
      trees.add(m);
    }
    for (let k = 0; k < 5; k++) {
      const hill = new T.Mesh(new T.SphereGeometry(60, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std([0x6fae5a, 0x7dba66, 0x64a352][k % 3]));
      hill.scale.y = 0.18 + Math.random() * 0.12; hill.position.set(-180 + k * 90, 0, -210 - Math.random() * 40); trees.add(hill);
    }
    scene3.add(trees);

    // the boss: a straw round on a wooden easel, the face on its front, a flag pole behind
    const boss = new T.Group(); scene3.add(boss);
    const straw = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#d2a85a'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 60; k++) { g.strokeStyle = `rgba(120,80,30,${0.15 + Math.random() * 0.2})`; g.beginPath(); g.arc(w / 2, h / 2, k * 2.2, 0, 7); g.stroke(); }
    });
    const round = new T.Mesh(new T.CylinderGeometry(0.72, 0.72, 0.22, 40), [std(0xc79a4c), std(0xffffff, { map: straw }), std(0xb88a40)]);
    round.rotation.x = Math.PI / 2; round.position.set(0, CY, -0.12); round.castShadow = true; round.receiveShadow = true; boss.add(round);
    const faceTex = tex(1024, 1024, (g, w) => { g.clearRect(0, 0, w, w); paintFace(g, w / 2, w / 2, w / 2 - 2); });
    const face = new T.Mesh(new T.CircleGeometry(0.61, 64), std(0xffffff, { map: faceTex, roughness: 0.8, transparent: true }));
    face.position.set(0, CY, 0.002); face.receiveShadow = true; boss.add(face);
    const wood = std(0x7a5230), easel = [];
    for (const [x, rz] of [[-0.5, 0.16], [0.5, -0.16]]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.07, 2.2, 0.07), wood); leg.position.set(x, 1.05, -0.26); leg.rotation.z = rz; leg.castShadow = true; boss.add(leg); easel.push(leg);
    }
    const back = new T.Mesh(new T.BoxGeometry(0.07, 2.3, 0.07), wood); back.position.set(0, 1.0, -0.75); back.rotation.x = -0.42; boss.add(back); easel.push(back);
    // #177 the swinging end: a gallows frame the boss hangs from on two ropes (the boss itself only slides
    // sideways, which is what the server scores)
    const frame = new T.Group(); frame.visible = false; scene3.add(frame);
    const FTOP = 3.5;
    for (const x of [-1.45, 1.45]) { const post = new T.Mesh(new T.BoxGeometry(0.12, FTOP + 0.1, 0.12), wood); post.position.set(x, FTOP / 2, -0.3); post.castShadow = true; frame.add(post); }
    const beam = new T.Mesh(new T.BoxGeometry(3.1, 0.12, 0.14), wood); beam.position.set(0, FTOP, -0.3); beam.castShadow = true; frame.add(beam);
    const ropeGeo = new T.CylinderGeometry(0.012, 0.012, 1, 6), ropeMat = std(0xcdb78a);
    const ropes = [-0.32, 0.32].map((ox) => { const m = new T.Mesh(ropeGeo, ropeMat); m.userData.ox = ox; frame.add(m); return m; });
    function hang(bx) {
      for (const m of ropes) {
        const tx = m.userData.ox, ty = FTOP, bxx = bx + m.userData.ox, by = CY + 0.66, dx = bxx - tx, dy = ty - by;
        m.position.set((tx + bxx) / 2, (ty + by) / 2, -0.2); m.scale.y = Math.hypot(dx, dy); m.rotation.z = Math.atan2(dx, dy);
      }
    }
    // 🎈 balloons pinned round the face (the gold one on the edge), each on a short string
    const BCOL = [0xffc93a, 0xff4f7b, 0x3fa9f5, 0x5ad66b];
    const balloonGeo = new T.SphereGeometry(0.068, 18, 14), knotGeo = new T.ConeGeometry(0.014, 0.022, 6), strGeo = new T.CylinderGeometry(0.002, 0.002, 0.16, 4);
    const balloons = BCOL.map((c, k) => {
      const g = new T.Group();
      const b = new T.Mesh(balloonGeo, std(c, k ? { roughness: 0.25 } : { roughness: 0.2, metalness: 0.5, emissive: 0x553300, emissiveIntensity: 0.4 }));
      b.scale.set(1, 1.18, 1); b.castShadow = true; b.position.y = 0.04;
      const kn = new T.Mesh(knotGeo, b.material); kn.rotation.x = Math.PI; kn.position.y = -0.045;
      const st = new T.Mesh(strGeo, std(0xeeeeee)); st.position.y = -0.13;
      g.add(b, kn, st); g.visible = false; boss.add(g); return g;
    });
    const pole = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 3.3, 8), std(0xe8e8e8, { roughness: 0.5 })); pole.position.set(0, 1.65, -0.5); boss.add(pole);
    const FW = 0.9, FH = 0.5, FN = 10;
    const flagGeo = new T.PlaneGeometry(FW, FH, FN, 3);
    const flag = new T.Mesh(flagGeo, new T.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.8, side: T.DoubleSide }));
    flag.position.set(0, 3.0, -0.5); boss.add(flag);
    const flagBase = Float32Array.from(flagGeo.attributes.position.array);
    function wave(now, wind) {
      const sp = Math.hypot(wind[0], wind[1]), dir = wind[0] >= 0 ? 1 : -1, lift = Math.min(1, sp / 5), pa = flagGeo.attributes.position, t = now / 1000;
      for (let k = 0; k < pa.count; k++) {
        const u = (flagBase[k * 3] + FW / 2) / FW, v0 = flagBase[k * 3 + 1];   // u: 0 at the pole, 1 at the fly end
        const droop = (1 - lift) * u * u * 0.55, flap = Math.sin(t * (3 + sp * 1.2) - u * 7) * 0.05 * u * (0.4 + lift);
        pa.setXYZ(k, dir * u * FW * (0.45 + 0.55 * lift), v0 - droop + wind[1] * 0.03 * u + flap * 0.5, flap);
      }
      pa.needsUpdate = true; flagGeo.computeVertexNormals();
    }
    // the apple
    const apple = new T.Group();
    const fruit = new T.Mesh(new T.SphereGeometry(0.055, 16, 12), std(0xe02a2a, { roughness: 0.35 })); fruit.scale.y = 0.92; fruit.castShadow = true;
    const stem = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, 0.035, 5), std(0x5a3a1a)); stem.position.y = 0.06;
    const lf = new T.Mesh(new T.SphereGeometry(0.018, 6, 4), std(0x4caf50)); lf.scale.set(1.4, 0.3, 0.8); lf.position.set(0.02, 0.065, 0);
    apple.add(fruit, stem, lf); boss.add(apple);

    // arrows: a shaft, a point and three vanes in the archer's colour; +z is the nock end
    const shaftGeo = new T.CylinderGeometry(0.008, 0.008, 0.72, 6); shaftGeo.rotateX(Math.PI / 2); shaftGeo.translate(0, 0, 0.36);
    const vaneGeo = new T.PlaneGeometry(0.045, 0.14); vaneGeo.translate(0.03, 0, 0); vaneGeo.rotateX(Math.PI / 2); vaneGeo.translate(0, 0, 0.62);
    const nockGeo = new T.SphereGeometry(0.012, 6, 4); nockGeo.translate(0, 0, 0.72);
    const shaftMat = std(0x2b2b2b, { roughness: 0.5 });
    // 🔥 a fire arrow's flame: a glowing blob at the head (or just out of the straw once it's stuck), embers behind
    const flameGeo = new T.SphereGeometry(0.035, 10, 8), flameMat = new T.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, fog: false });
    const emberGeo = new T.SphereGeometry(0.012, 5, 4), emberMats = [0xffd04a, 0xff7a1a, 0xff4a1a].map((c) => new T.MeshBasicMaterial({ color: c, transparent: true, fog: false }));
    const embers = [];
    const vaneMats = new Map();
    const vaneMat = (col) => { if (!vaneMats.has(col)) vaneMats.set(col, new T.MeshStandardMaterial({ color: col, roughness: 0.7, side: T.DoubleSide, emissive: col, emissiveIntensity: 0.25 })); return vaneMats.get(col); };
    function makeArrow() {
      const g = new T.Group(), sh = new T.Mesh(shaftGeo, shaftMat); sh.castShadow = true; g.add(sh);
      g.vanes = [0, 1, 2].map((k) => { const m = new T.Mesh(vaneGeo, shaftMat); m.rotation.z = k * 2.094; g.add(m); return m; });
      g.nock = new T.Mesh(nockGeo, shaftMat); g.add(g.nock);
      g.flame = new T.Mesh(flameGeo, flameMat); g.flame.visible = false; g.add(g.flame);
      g.paint = (col) => { const m = vaneMat(col); for (const v of g.vanes) v.material = m; g.nock.material = m; };
      return g;
    }
    const stuck = []; const stuckGroup = new T.Group(); boss.add(stuckGroup);
    let emberTick = 0;
    function ember(x, y, z, n = 1) {
      for (let k = 0; k < n && embers.length < (low ? 30 : 90); k++) {
        const m = new T.Mesh(emberGeo, emberMats[(Math.random() * 3) | 0]);
        m.position.set(x + (Math.random() - 0.5) * 0.04, y + (Math.random() - 0.5) * 0.04, z);
        m.userData = { vx: (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.4, life: 0.4 + Math.random() * 0.5, l0: 0.9 };
        scene3.add(m); embers.push(m);
      }
    }
    const flying = makeArrow(); flying.visible = false; scene3.add(flying);
    // the sight: a ring and a cross on the target plane, and a small ring where the last arrow was aimed
    const basic = (color, o = {}) => new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, fog: false, ...o });
    const sight = new T.Group(); sight.renderOrder = 10;
    const sightMat = basic(0xffffff, { opacity: 0.95 });
    sight.add(new T.Mesh(new T.RingGeometry(0.075, 0.088, 40), sightMat));
    sight.add(new T.Mesh(new T.CircleGeometry(0.008, 12), basic(0xff3355)));
    for (let k = 0; k < 4; k++) { const tick = new T.Mesh(new T.PlaneGeometry(0.05, 0.008), sightMat); tick.position.set(Math.cos(k * Math.PI / 2) * 0.12, Math.sin(k * Math.PI / 2) * 0.12, 0); tick.rotation.z = k * Math.PI / 2; sight.add(tick); }
    const fireRing = new T.Mesh(new T.RingGeometry(0.1, 0.112, 40), basic(0xff8a2a, { opacity: 0.85 })); fireRing.visible = false; sight.add(fireRing);
    sight.traverse((m) => { m.renderOrder = 10; }); boss.add(sight);
    const ghostMat = basic(0xffffff, { opacity: 0.8 });
    const ghost = new T.Mesh(new T.RingGeometry(0.03, 0.04, 24), ghostMat); ghost.renderOrder = 9; boss.add(ghost);
    // the archer on the line (seen as the arrow leaves): a simple figure in the shooter's colour with a bow
    const archer = new T.Group();
    const bodyMat = std(0x8888ff, { roughness: 0.6 });
    const body = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.95, 12), bodyMat); body.position.y = 0.95; body.castShadow = true;
    const legs = new T.Mesh(new T.CylinderGeometry(0.16, 0.13, 0.5, 10), std(0x333a4a)); legs.position.y = 0.25;
    const head = new T.Mesh(new T.SphereGeometry(0.14, 14, 10), std(0xf0c9a0, { roughness: 0.7 })); head.position.y = 1.6; head.castShadow = true;
    const bow = new T.Mesh(new T.TorusGeometry(0.62, 0.016, 6, 24, Math.PI * 0.9), std(0x5a3418, { roughness: 0.5 }));
    bow.rotation.set(0, Math.PI / 2, -Math.PI * 0.45); bow.position.set(-0.3, 1.3, -0.45);
    const arm = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.6, 6), bodyMat); arm.rotation.x = Math.PI / 2; arm.position.set(-0.22, 1.32, -0.3);
    archer.add(body, legs, head, bow, arm); archer.position.set(0.6, 0, 0.1); scene3.add(archer);
    // bits of straw and apple that fly on a hit
    const bits = []; const bitGeo = new T.BoxGeometry(0.02, 0.02, 0.02);
    function burst(x, y, color, n) {
      if (low) n = Math.ceil(n / 2);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(bitGeo, new T.MeshBasicMaterial({ color }));
        m.position.set(x, CY + y, 0.03);
        m.userData = { vx: (Math.random() - 0.5) * 1.6, vy: Math.random() * 1.8, vz: 0.4 + Math.random() * 1.4, life: 0.7 + Math.random() * 0.4 };
        boss.add(m); bits.push(m);
      }
    }

    const cam = { pos: new T.Vector3(0.6, 1.9, 3.2), look: new T.Vector3(0, CY, -30), fov: 40, init: false };
    const want = { pos: new T.Vector3(), look: new T.Vector3(), fov: 40 };
    let lastT = 0, moving = 0, distNow = 0, lastMode = '';
    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();

    function draw(now, sc, idle) {
      const dt = Math.min(0.2, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const d = sc.dist;
      if (d !== distNow) { distNow = d; boss.position.z = -d; frame.position.z = -d; stg.key.position.set(-6, 12, -d + 8); stg.key.target.position.set(0, 1, -d); }
      wave(now, sc.wind);
      const bx = sc.bx || 0;
      boss.position.x = bx;
      frame.visible = sc.swing; for (const m of easel) m.visible = !sc.swing;
      if (sc.swing) hang(bx);
      pole.position.x = flag.position.x = -bx;   // the flag stands still behind a swinging face
      // arrows in the boss
      while (stuck.length < sc.arrows.length) { const a = makeArrow(); stuckGroup.add(a); stuck.push(a); }
      stuck.forEach((a, k) => {
        const s = sc.arrows[k];
        a.visible = !!s; if (!s) return;
        a.position.set(s.x, CY + s.y, s.ring ? -0.1 : -0.1);
        if (!s.ring) a.position.set(s.x + (s.cx || 0) - bx, Math.max(0.05, Math.min(CY + s.y, 0.2)), 0.6 + (s.id % 5) * 0.25);   // a miss lies in the grass in front
        a.rotation.set(s.ring ? ((s.id * 37) % 10 - 5) * 0.012 - 0.05 : -0.5, ((s.id * 53) % 10 - 5) * 0.012, 0);
        a.paint(colorOf(s.o));
        a.flame.visible = !!s.fire && !!s.ring;
        if (a.flame.visible) { a.flame.position.z = 0.1; const f = 0.55 + 0.25 * Math.sin(now / 90 + s.id); a.flame.scale.set(f, f * 1.4, f); if (!idle && !low && Math.random() < 0.08) ember(bx + s.x, CY + s.y + 0.02, -d + 0.05); }
      });
      apple.visible = !!sc.apple;
      if (sc.apple) apple.position.set(sc.apple.x, CY + sc.apple.y, 0.05);
      balloons.forEach((g, k) => {
        const q = sc.prizes.find((p) => p.k !== 'apple' && p.id === k);
        g.visible = !!q; if (!q) return;
        g.position.set(q.x, CY + q.y + Math.sin(now / 700 + k * 1.7) * 0.006, 0.09); g.rotation.z = Math.sin(now / 900 + k) * 0.08;
      });
      // the flying arrow
      flying.visible = !!sc.fly;
      if (sc.fly) {
        const f = sc.fly, n = f.next;
        flying.position.set(f.x, CY + f.y, -f.d);
        flying.lookAt(2 * f.x - n.x, CY + 2 * f.y - n.y, -(2 * f.d - n.d));   // +z (the nock) points back along the flight
        flying.paint(colorOf(f.o));
        flying.flame.visible = f.fire;
        if (f.fire) {
          flying.flame.position.z = 0; const fl = 0.9 + 0.3 * Math.sin(now / 40); flying.flame.scale.set(fl, fl, fl * 1.8);
          if ((emberTick = (emberTick + 1) % (low ? 3 : 1)) === 0) ember(f.x, CY + f.y, -f.d + 0.1, low ? 1 : 2);
        }
      } else flying.flame.visible = false;
      for (let k = embers.length - 1; k >= 0; k--) {
        const m = embers[k], u = m.userData;
        u.life -= dt; m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt;
        const sz = Math.max(0.05, u.life / u.l0); m.scale.set(sz, sz, sz);
        if (u.life <= 0) { scene3.remove(m); embers.splice(k, 1); }
      }
      sight.visible = !!sc.sight;
      if (sc.sight) {
        sight.position.set(sc.sight.x - bx, CY + sc.sight.y, 0.06);   // the sight stays put while the face swings under it
        const k = sc.span / 1.05 * (sc.sight.drawn ? 0.85 : 1); sight.scale.set(k, k, 1);
        sightMat.color.set(sc.sight.calm ? 0x7dffb0 : sc.sight.drawn ? 0xffe066 : 0xffffff);
        fireRing.visible = !!sc.sight.fire; if (fireRing.visible) { const p = 1 + 0.06 * Math.sin(now / 120); fireRing.scale.set(p, p, 1); }
      }
      const last = sc.mode !== 'flight' ? sc.last : null;
      ghost.visible = !!last && sc.arrows.some((a) => a.id === last.id);
      if (ghost.visible) { ghost.position.set(last.ax, CY + last.ay, 0.055); ghostMat.color.set(colorOf(last.o)); }
      archer.visible = sc.mode === 'flight' && sc.shooter != null && !sc.slow;
      if (archer.visible) bodyMat.color.set(colorOf(sc.shooter));
      for (let k = bits.length - 1; k >= 0; k--) {
        const m = bits[k], u = m.userData;
        u.life -= dt; u.vy -= 6 * dt;
        m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt; m.rotation.x += 9 * dt; m.rotation.y += 7 * dt;
        if (u.life <= 0) { boss.remove(m); m.material.dispose(); bits.splice(k, 1); }
      }
      // camera
      const asp = camera.aspect;
      if (sc.mode === 'aim') {
        want.pos.set(0, 1.62, 0.2); want.look.set(0, CY, -d);
        want.fov = 2 * Math.atan(sc.span / d / Math.min(1, asp)) * 180 / Math.PI;
      } else if (sc.mode === 'flight' && sc.slow) {
        // slow motion: tuck in beside the arrow and look along it at the face
        const f = sc.fly;
        want.pos.set(f.x + 0.32, CY + f.y + 0.12, -f.d + 0.9); want.look.set(f.x * 0.3 + bx * 0.7, CY + f.y * 0.5, -d);
        want.fov = 34;
      } else if (sc.mode === 'flight') {
        const f = sc.fly, back = 2.2 + 3.5 * (1 - f.u);
        want.pos.set(f.x * 0.6 - 0.35, CY + f.y + 0.55, -f.d + back); want.look.set(f.x * 0.5, CY + f.y * 0.6, -d);
        want.fov = 46;
      } else if (sc.mode === 'hit') {
        const s = sc.shot; want.pos.set(s.x * 0.5 + 0.7 + bx, CY + Math.max(-0.6, s.y) * 0.5 + 0.25, -d + 2.6 / Math.min(1, asp * 1.1));
        want.look.set(s.x * 0.6 + bx, CY + Math.max(-0.8, s.y) * 0.6, -d); want.fov = 38;
      } else {
        // waiting: the target close enough to study the arrows in it, from a step to the side
        want.pos.set(1.4, 1.75, 0.4); want.look.set(0, CY + 0.15, -d);
        want.fov = 2 * Math.atan(sc.span * 1.35 / d / Math.min(1, asp)) * 180 / Math.PI;
      }
      const snap = !cam.init || (sc.mode === 'flight' && lastMode !== 'flight');
      const k = snap ? 1 : 1 - Math.exp(-dt * (sc.mode === 'flight' ? (sc.slow ? 5 : 9) : 4.5));
      cam.init = true; lastMode = sc.mode;
      const gap = cam.pos.distanceTo(want.pos) + Math.abs(cam.fov - want.fov) * 0.1;
      moving = gap > 0.01 || bits.length || embers.length ? 1 : 0;
      cam.pos.lerp(want.pos, k); cam.look.lerp(want.look, k); cam.fov += (want.fov - cam.fov) * k;
      camera.position.copy(cam.pos); camera.fov = cam.fov; camera.updateProjectionMatrix();
      GL3.tickShake(camera, dt);
      camera.lookAt(cam.look);
      stg.follow(camera);
      if (idle && renderer.renderStill) renderer.renderStill(scene3, camera); else renderer.render(scene3, camera);
    }

    return {
      draw, resize, moving: () => moving,
      impact(sh) {
        if (sh.ring) { burst(sh.x, sh.y, 0xe8c878, 10); GL3.shake(camera, sh.ring >= 9 ? (sh.fire ? 0.32 : 0.22) : 0.14); }
        if (sh.fire && sh.ring) ember(boss.position.x + sh.x, CY + sh.y, -distNow + 0.06, low ? 8 : 24);
        for (const q of sh.prizes || (sh.apple ? [{ k: 'apple', ...sh.apple }] : [])) burst(q.x, q.y, q.k === 'apple' ? 0xe02a2a : BCOL[q.id] ?? 0xff4f7b, 16);
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the target face straight on
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the range.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, sparks = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    function draw(now, sc) {
      const k = Math.min(w, h) / 2 / sc.span, cx0 = w / 2, cy = h / 2 + 6, bx = sc.bx || 0;
      const X0 = (x) => cx0 + x * k, Y = (y) => cy - y * k;
      const cx = X0(bx), X = (x) => cx + x * k;     // X: on the face (it swings on a swinging end); X0: the world
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#5aa2e6'); sky.addColorStop(0.62, '#cfe9f5'); sky.addColorStop(0.62, '#5aa845'); sky.addColorStop(1, '#3f8a34');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7a5230';
      if (sc.swing) {   // the frame and two ropes
        const top = Y(2.2); g.fillRect(X0(-1.45) - 4, top, 8, h); g.fillRect(X0(1.45) - 4, top, 8, h); g.fillRect(X0(-1.5), top - 4, 3 * k, 8);
        g.strokeStyle = '#cdb78a'; g.lineWidth = 2; g.beginPath();
        for (const ox of [-0.32, 0.32]) { g.moveTo(X0(ox), top); g.lineTo(X(ox), Y(0.66)); } g.stroke();
      } else { g.fillRect(X(-0.5) - 3, cy, 6, h); g.fillRect(X(0.5) - 3, cy, 6, h); }
      g.beginPath(); g.arc(cx, cy, 0.72 * k, 0, 7); g.fillStyle = '#c79a4c'; g.fill();
      paintFace(g, cx, cy, 0.61 * k);
      // the flag, leaning with the wind
      const sp = Math.hypot(sc.wind[0], sc.wind[1]), dir = sc.wind[0] >= 0 ? 1 : -1, fl = Math.min(1, sp / 5), py = Y(0.72) - 0.55 * k;
      const fx = sc.swing ? cx0 - 1.0 * k : cx0;    // the flag stands still (beside the frame on a swinging end)
      g.strokeStyle = '#eee'; g.lineWidth = 3; g.beginPath(); g.moveTo(fx, Y(0.7)); g.lineTo(fx, py); g.stroke();
      g.fillStyle = '#ff5a3c'; g.beginPath(); g.moveTo(fx, py);
      const wob = Math.sin(now / 1000 * (3 + sp)) * 0.03 * k;
      g.lineTo(fx + dir * 0.5 * k * (0.4 + 0.6 * fl), py + 0.25 * k * (1 - fl) + wob); g.lineTo(fx + dir * 0.1 * k, py + 0.24 * k); g.lineTo(fx, py + 0.22 * k); g.fill();
      for (const q of sc.prizes) {
        const qx = X(q.x), qy = Y(q.y);
        if (q.k === 'apple') {
          g.beginPath(); g.arc(qx, qy, Math.max(4, 0.055 * k), 0, 7); g.fillStyle = '#e02a2a'; g.fill();
          g.fillStyle = '#4caf50'; g.fillRect(qx, qy - 0.075 * k, 0.03 * k, 0.02 * k);
        } else {
          const r = Math.max(5, 0.068 * k), bob = Math.sin(now / 700 + q.id * 1.7) * 0.006 * k;
          g.strokeStyle = '#eee'; g.lineWidth = 1; g.beginPath(); g.moveTo(qx, qy + r); g.lineTo(qx, qy + r + 0.12 * k); g.stroke();
          g.beginPath(); g.ellipse(qx, qy - bob, r, r * 1.18, 0, 0, 7); g.fillStyle = ['#ffc93a', '#ff4f7b', '#3fa9f5', '#5ad66b'][q.id] || '#ff4f7b'; g.fill();
          g.lineWidth = 1.5; g.strokeStyle = '#0006'; g.stroke();
          g.beginPath(); g.arc(qx - r * 0.35, qy - bob - r * 0.4, r * 0.22, 0, 7); g.fillStyle = '#fff8'; g.fill();
        }
      }
      for (const a of sc.arrows) {
        const px = a.ring ? X(a.x) : X0(a.x + (a.cx || 0)), py2 = a.ring ? Y(a.y) : Math.min(h - 8, Math.max(Y(a.y), cy + 0.8 * k));
        if (a.fire && a.ring) { g.beginPath(); g.arc(px, py2, Math.max(6, 0.035 * k) * (1 + 0.15 * Math.sin(now / 90 + a.id)), 0, 7); g.fillStyle = '#ff8a2a99'; g.fill(); }
        g.beginPath(); g.arc(px, py2, Math.max(3.5, 0.02 * k), 0, 7); g.fillStyle = colorOf(a.o); g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#111'; g.stroke();
      }
      const last = sc.mode !== 'flight' ? sc.last : null;
      if (last && sc.arrows.some((a) => a.id === last.id)) { g.beginPath(); g.arc(X(last.ax), Y(last.ay), Math.max(5, 0.035 * k), 0, 7); g.lineWidth = 2; g.strokeStyle = colorOf(last.o); g.stroke(); }
      if (sc.fly) {
        const f = sc.fly, r = 14 * (1 - f.u) + 3, fx2 = X0(f.x), fy2 = Y(f.y) + (1 - f.u) * h * 0.3;
        if (f.fire) { g.beginPath(); g.arc(fx2, fy2, r * 1.7, 0, 7); g.fillStyle = '#ff8a2a88'; g.fill(); }
        g.beginPath(); g.arc(fx2, fy2, r, 0, 7); g.fillStyle = colorOf(f.o); g.fill(); g.strokeStyle = '#111'; g.stroke();
      }
      if (sc.sight) {
        const sx = X0(sc.sight.x), sy = Y(sc.sight.y), r = 0.085 * k * (sc.sight.drawn ? 0.85 : 1);
        if (sc.sight.fire) { g.lineWidth = 2; g.strokeStyle = '#ff8a2a'; g.beginPath(); g.arc(sx, sy, r * 1.3, 0, 7); g.stroke(); }
        g.lineWidth = 2.5; g.strokeStyle = sc.sight.calm ? '#7dffb0' : sc.sight.drawn ? '#ffe066' : '#fff';
        g.beginPath(); g.arc(sx, sy, r, 0, 7); g.stroke();
        g.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(sx + dx * r * 1.15, sy + dy * r * 1.15); g.lineTo(sx + dx * r * 1.7, sy + dy * r * 1.7); } g.stroke();
        g.beginPath(); g.arc(sx, sy, 2.5, 0, 7); g.fillStyle = '#ff3355'; g.fill();
      }
      sparks = sparks.filter((s) => now < s.t + 500);
      for (const s of sparks) {
        const u = (now - s.t) / 500;
        g.beginPath(); g.arc(X(s.x), Y(s.y), 6 + u * 0.2 * k * (s.big || 1), 0, 7); g.lineWidth = 3 * (1 - u); g.strokeStyle = s.c; g.stroke();
      }
    }
    return {
      draw, resize, moving: () => sparks.length > 0,
      impact(sh) {
        const t = performance.now();
        if (sh.ring) sparks.push({ x: sh.x, y: sh.y, t, c: sh.fire ? '#ff8a2a' : '#fff', big: sh.fire ? 2 : 1 });
        for (const q of sh.prizes || (sh.apple ? [{ k: 'apple', ...sh.apple }] : [])) sparks.push({ x: q.x, y: q.y, t, c: q.k === 'apple' ? '#e02a2a' : ['#ffc93a', '#ff4f7b', '#3fa9f5', '#5ad66b'][q.id] || '#ff4f7b', big: 1.5 });
      },
      dispose() { canvas.remove(); },
    };
  }

  const DART_HELD_SCALE = 1.15;
  const DART_AIM_SCALE = 1.4;
  const DART_HAND_DEPTH = 48;
  const DART_BOARD_SCALE = 1;
  const DART_LENGTH = 0.74;
  const DART_POINT_APEX = 32.4;
  const DART_TIP = DART_POINT_APEX * DART_LENGTH;

  const smooth = (t) => { const k = c01(t); return k * k * (3 - 2 * k); };
  const DART_NUMBER_RADIUS = 108;
  const DART_PALETTE = { dark: '#242522', light: '#ebd5a6', red: '#c14a48', green: '#3d8962' };
  const DART_WIRE = '#d0c5b4';
  const DART_BRASS = '#c5a273';
  const DART_WIRE_BASE = '#514a42';
  const DART_NUMBER_BAND = '#242421';
  const DART_DOT_HOLD = 250;
  const DART_DOT_FADE = 900;
  const DART_RIM = '#292723';
  const DART_FASTENERS = Array.from({ length: 8 }, (_, i) => (i + 0.5) * Math.PI / 4);

  const DART_LODGED_ANGLE = -34;
  const AXE_SCALE = 1.4;
  const BOARD_CAMERA_DISTANCE = 345;
  const boardPlaneScale = (depth) => 98 * (1 - depth / BOARD_CAMERA_DISTANCE);
  const AXE_WINDUP_MS = 140;
  const AXE_RELEASE_WINDOW_MS = 190;
  const AXE_FLICK_WINDOW_MS = 115;
  const AXE_FLICK_PAUSE_MS = 75;
  const AXE_FLICK_MIN_DISTANCE = 0.22; // Board radii.
  const AXE_FLICK_MIN_SPEED = 2.2; // Board radii per second.
  const AXE_BACKSWING_MS = 60;
  const AXE_GRAVITY = 1.8; // Board radii per second squared on the game clock.
  const AXE_LODGED_ANGLE = 38;
  const AXE_BOARD_DEPTH = 0.1;
  const AXE_HEADING = -78;
  const AXE_HEADING_COS = Math.cos(AXE_HEADING * Math.PI / 180);
  const AXE_HEADING_SIN = Math.sin(AXE_HEADING * Math.PI / 180);
  const AXE_START_POSE = { pitch: 12, roll: 0, yaw: -60 };
  const AXE_READY_HEADING = axeStartOrientation({ pitch: 0, roll: 0, yaw: AXE_HEADING });
  const AXE_RELEASE_ANGLE = 0;
  const AXE_COLORS = ['#91362b', '#a76d42', '#dfba86', '#9e6d48', '#d6ab76'];
  const expandAxeHead = (points) => points.map(([x, y]) => [x * 1.15, y * 1.10]);
  const AXE_EDGE = expandAxeHead([[0, 0], [-3.2, 2.3], [-4.5, 5.4], [-3.2, 8.7], [0, 11]]);
  const AXE_BEVEL = expandAxeHead([[1.3, 0.9], [-0.7, 2.9], [-1.5, 5.4], [-0.7, 8], [1.3, 10.1]]);
  const AXE_SPINE = expandAxeHead([[9, 7.4], [9, 3.6]]);
  const AXE_BLADE_THICKNESS = 2.8;
  const AXE_PROFILE = [...AXE_EDGE, ...AXE_SPINE];
  // Relative model masses. A longer handle adds mass as well as moving its midpoint.
  const AXE_MASS_PROFILE = {
    headMass: 4.4, headOutline: AXE_PROFILE, headThickness: AXE_BLADE_THICKNESS,
    handleStart: [5.5, 4], handleEnd: [7.4, 26], handleMassPerUnit: 0.05,
  };

  function axeMassProperties({ headMass, headOutline, headThickness, handleStart, handleEnd, handleMassPerUnit }) {
    let areaTwice = 0, headX = 0, headY = 0, secondX = 0, secondY = 0;
    for (let i = 0; i < headOutline.length; i++) {
      const [x, y] = headOutline[i], [nextX, nextY] = headOutline[(i + 1) % headOutline.length];
      const cross = x * nextY - nextX * y;
      areaTwice += cross;
      headX += (x + nextX) * cross;
      headY += (y + nextY) * cross;
      secondX += (x ** 2 + x * nextX + nextX ** 2) * cross;
      secondY += (y ** 2 + y * nextY + nextY ** 2) * cross;
    }
    headX /= 3 * areaTwice;
    headY /= 3 * areaTwice;
    const dx = handleEnd[0] - handleStart[0], dy = handleEnd[1] - handleStart[1];
    const handleLength = Math.hypot(dx, dy * DART_LENGTH);
    const handleMass = handleLength * handleMassPerUnit;
    const handleX = handleStart[0] + dx / 2, handleY = handleStart[1] + dy / 2;
    const mass = headMass + handleMass;
    const x = (headMass * headX + handleMass * handleX) / mass;
    const y = (headMass * headY + handleMass * handleY) / mass;
    // The fixed heading turns the blade's local X into depth relative to the world-X tumble axis.
    const radiusSquared = (px, py) => (AXE_HEADING_SIN * px) ** 2 + (DART_LENGTH * py) ** 2;
    const headInertia = (secondX * AXE_HEADING_SIN ** 2 + secondY * DART_LENGTH ** 2) / (6 * areaTwice)
      - radiusSquared(headX, headY) + (headThickness * AXE_HEADING_COS) ** 2 / 12;
    const inertia = headMass * (headInertia + radiusSquared(headX - x, headY - y))
      + handleMass * (radiusSquared(dx, dy) / 12 + radiusSquared(handleX - x, handleY - y));
    return { x, y, headMass, handleMass, handleLength, inertia };
  }

  const AXE_PIVOT = axeMassProperties(AXE_MASS_PROFILE);
  const AXE_SETTLE_SCALE = Math.sqrt(AXE_PIVOT.inertia / 104.38);
  const AXE_PIVOT_LABEL = `Rotation center from blade contact · X ${AXE_PIVOT.x.toFixed(2)} · Y ${AXE_PIVOT.y.toFixed(2)} model units · Inertia ${AXE_PIVOT.inertia.toFixed(1)} (relative)`;


  const AXE_ART = {
    board: '/games/axe-art/target.jpg',
    steel: '/games/axe-art/forged-steel.jpg',
    bevel: '/games/axe-art/ground-steel.jpg',
    handle: '/games/axe-art/hickory.jpg',
  };
  const AXE_HANDLE_PATH = 'M3.5 2.5Q5 1.9 6.7 2.5Q6.1 11 7.1 17Q7.6 21 8.8 24.7Q9.4 27 7 27Q5.3 26.8 5.3 25Q3 17 3.5 10Z';

  const polygonPoints = (points) => points.map((point) => point.join(',')).join(' ');
  const AXE_BODY_PATH = `M${polygonPoints(AXE_PROFILE.slice(0, AXE_EDGE.length))}L8.4 8.1Q10.35 8.1 10.35 7L10.35 2.9Q10.35 1.7 8.4 1.7Z`;
  const axeSilhouette = `<g stroke="none"><path d="M5.5 5Q5 15 7.4 25" fill="none" stroke="#a37a4e" stroke-width="1.5"
      stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="M.5 1Q-5 5.4 .5 10" fill="none" stroke="#bfc7cb" stroke-width="1.1"
      stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path fill="var(--dart-color, #e8c99f)" d="${AXE_HANDLE_PATH}"/>
    <path fill="url(#ar-axe-wood-light)" opacity=".45" d="${AXE_HANDLE_PATH}"/>
    <path fill="url(#ar-axe-hickory)" opacity=".20" d="${AXE_HANDLE_PATH}"/>
    <path fill="none" stroke="#f2c28d" stroke-width=".48" opacity=".75" d="M4.4 7Q3.7 17 6.2 24.7"/>
    <ellipse cx="7.1" cy="25.9" rx="1.6" ry=".75" fill="#ad754b"/>
    <path fill="url(#ar-axe-steel-light)" d="${AXE_BODY_PATH}"/>
    <path fill="url(#ar-axe-forged)" opacity=".38" d="${AXE_BODY_PATH}"/>
    <polygon fill="url(#ar-axe-bevel-light)" points="${polygonPoints([...AXE_EDGE, ...AXE_BEVEL.slice().reverse()])}"/>
    <polygon fill="url(#ar-axe-ground)" opacity=".25" points="${polygonPoints([...AXE_EDGE, ...AXE_BEVEL.slice().reverse()])}"/>
    <polyline fill="none" stroke="#f1f9ff" stroke-width=".48" points="${polygonPoints(AXE_EDGE)}"/>
    <path fill="none" stroke="#89949b" stroke-width=".45" opacity=".65" d="M2 2L8 4"/>
    <path fill="#d7a471" stroke="#34251e" stroke-width=".35" d="M3.5 2.8L4.7 2.3L6.7 2.8L5.1 3.1Z"/></g>`;
  const ringColor = (points) => AXE_COLORS[5 - points];
  const axeLabelRadius = (radius, points) => radius - (points === 5 ? 0.055 : 0.10);

  function axeStartOrientation({ pitch, roll, yaw }) {
    const radians = Math.PI / 360;
    const a = pitch * radians, b = yaw * radians, c = -roll * radians;
    const [sa, sb, sc] = [Math.sin(a), Math.sin(b), Math.sin(c)];
    const [ca, cb, cc] = [Math.cos(a), Math.cos(b), Math.cos(c)];
    return [sa * cb * cc + ca * sb * sc, ca * sb * cc - sa * cb * sc,
      ca * cb * sc + sa * sb * cc, ca * cb * cc - sa * sb * sc];
  }

  function axeTumbleOrientation(angle) {
    return pitchAxe(AXE_READY_HEADING, angle);
  }

  function pitchAxe(from, angle) {
    const half = -angle * Math.PI / 360;
    const sine = Math.sin(half), cosine = Math.cos(half);
    const [x, y, z, w] = from;
    return [cosine * x + sine * w, cosine * y - sine * z,
      cosine * z + sine * y, cosine * w - sine * x];
  }

  function blendAxeOrientation(from, angle, progress) {
    const [x, y, z, w] = from;
    if (Math.abs(x * y - z * w) < 1e-7) {
      // An X pitch followed by a Y yaw leaves the handle in the vertical plane throughout alignment.
      const pitch = Math.atan2(2 * (y * z + x * w), 1 - 2 * (x * x + z * z)) * 180 / Math.PI;
      const yaw = Math.atan2(2 * (x * z + y * w), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;
      const headingDelta = ((AXE_HEADING - yaw + 540) % 360) - 180;
      return axeStartOrientation({ pitch: pitch * (1 - progress) - angle * progress, roll: 0, yaw: yaw + headingDelta * progress });
    }
    // Ease custom debug orientation into the release heading before the axe leaves the hand.
    const sign = from.reduce((dot, component, i) => dot + component * AXE_READY_HEADING[i], 0) < 0 ? -1 : 1;
    const aligned = from.map((component, i) => component * (1 - progress) + sign * AXE_READY_HEADING[i] * progress);
    const length = Math.hypot(...aligned);
    return pitchAxe(aligned.map((component) => component / length), angle * progress);
  }

  function axeProjection(angle) {
    const radians = angle * Math.PI / 180;
    return [AXE_HEADING_COS, AXE_HEADING_SIN * Math.sin(radians), 0, Math.cos(radians)];
  }

  function axePointOffset([modelX, modelY, modelZ = 0], scale, [qx, qy, qz, qw]) {
    const x = modelX * scale, y = -modelY * DART_LENGTH * scale, z = modelZ * scale;
    return {
      x: (1 - 2 * (qy ** 2 + qz ** 2)) * x + 2 * (qx * qy - qz * qw) * y + 2 * (qx * qz + qy * qw) * z,
      y: 2 * (qx * qy + qz * qw) * x + (1 - 2 * (qx ** 2 + qz ** 2)) * y + 2 * (qy * qz - qx * qw) * z,
      depth: 2 * (qx * qz - qy * qw) * x + 2 * (qy * qz + qx * qw) * y + (1 - 2 * (qx ** 2 + qy ** 2)) * z,
    };
  }

  function axeLeadingEdge(angle) {
    const orientation = axeTumbleOrientation(angle);
    const depths = AXE_EDGE.map((point) => axePointOffset(point, AXE_SCALE, orientation).depth);
    const nearest = Math.min(...depths);
    const index = depths.findIndex((depth) => depth <= nearest + 1e-8);
    const midpoint = index < depths.length - 1 && depths[index + 1] <= nearest + 1e-8;
    const point = midpoint ? AXE_EDGE[index].map((value, axis) => (value + AXE_EDGE[index + 1][axis]) / 2) : AXE_EDGE[index];
    return { point, index, midpoint };
  }

  function axeContactPose(shot, rotation, edge) {
    const offset = axePointOffset(edge, AXE_SCALE, axeTumbleOrientation(rotation));
    const depth = AXE_BOARD_DEPTH - offset.depth;
    const plane = boardPlaneScale(depth), board = boardPlaneScale(AXE_BOARD_DEPTH);
    return { x: (shot.x * board - offset.x) / plane, y: (shot.y * board - offset.y) / plane,
      depth, rotation, scale: AXE_SCALE, u: 1 };
  }

  function axeRestPose(shot, landingAngle, quiver = 0) {
    const angle = landingAngle - (shot.axeAngle ?? 0);
    const { point } = axeLeadingEdge(angle);
    return { ...axeContactPose(shot, angle + quiver, point), edge: point };
  }

  function axeClearance(pose, margin = 0) {
    const orientation = axeTumbleOrientation(pose.rotation);
    const leadingDepth = Math.min(...AXE_EDGE.map((point) => axePointOffset(point, pose.scale, orientation).depth));
    return Math.max(0, AXE_BOARD_DEPTH + margin - pose.depth - leadingDepth);
  }

  // The flight path follows the axe's mass center. Renderers place the cutting edge
  // by rotating the offset from that center, including at the exact contact frame.
  function axeMotion(start, shot, landingAngle, airTime, edge) {
    const contactAngle = landingAngle - (shot.axeAngle ?? 0);
    const turn = shot.axeTurn ?? (360 + ((AXE_RELEASE_ANGLE - contactAngle + 540) % 360) - 180);
    const lift = AXE_GRAVITY * (airTime / 1000) ** 2 / 8;
    const initialDepth = start.depth ?? DART_HAND_DEPTH - 10;
    const initialScale = start.scale ?? AXE_SCALE;
    const pivotPoint = [AXE_PIVOT.x, AXE_PIVOT.y];
    const offset = (angle, scale) => axePointOffset(pivotPoint, scale, axeTumbleOrientation(angle));
    const from = offset(AXE_RELEASE_ANGLE, initialScale);
    const to = offset(contactAngle, AXE_SCALE);
    const endPose = edge ? axeContactPose(shot, contactAngle, edge)
      : { x: shot.x, y: shot.y, depth: AXE_BOARD_DEPTH };
    const startX = start.x * boardPlaneScale(initialDepth) + from.x;
    const startY = start.y * boardPlaneScale(initialDepth) + from.y;
    const startDepth = initialDepth + from.depth;
    const dx = endPose.x * boardPlaneScale(endPose.depth) + to.x - startX;
    const dy = endPose.y * boardPlaneScale(endPose.depth) + to.y - startY;
    const dz = endPose.depth + to.depth - startDepth;
    const arc = 4 * lift * 98;
    return (time, afterImpact = false) => {
      const extra = afterImpact ? time : 0;
      const u = afterImpact ? 1 : c01(time);
      const bounce = afterImpact && shot.axeBounce;
      const rotation = AXE_RELEASE_ANGLE - turn * (u + extra * (bounce ? 0.65 : 1));
      const scale = AXE_SCALE + (initialScale - AXE_SCALE) * (1 - u);
      const pivot = offset(rotation, scale);
      const centerDepth = startDepth + dz * (u + extra * (bounce ? -0.55 : 1));
      const centerX = startX + dx * (u + extra * (bounce ? 0.45 : 1));
      const releaseY = bounce ? Math.min(0.24 * 98, Math.max(0.08 * 98, -0.35 * (dy - arc))) : dy - arc;
      const centerY = startY + dy * u + arc * u * (1 - u) + releaseY * extra - arc * extra ** 2;
      const depth = centerDepth - pivot.depth;
      const plane = boardPlaneScale(depth);
      return {
        x: (centerX - pivot.x) / plane, y: (centerY - pivot.y) / plane, depth, rotation, scale, u,
        center: { x: centerX, y: centerY, depth: centerDepth },
      };
    };
  }

  function axeWindup(grip, motion, elapsed, airTime, windupMs, backswingMs) {
    const back = {
      x: grip.x + grip.backswingX, y: grip.y + 0.18,
      depth: grip.depth + 5, rotation: 40,
    };
    const release = motion(0);
    // Sample the flight tangent so the swing carries through release at the same speed.
    const sample = motion(0.001);
    const forward = elapsed >= backswingMs;
    const duration = forward ? windupMs - backswingMs : backswingMs;
    const u = c01((elapsed - (forward ? backswingMs : 0)) / duration);
    const ease = smooth(u);
    const from = forward ? back : grip;
    const to = forward ? release : back;
    const pose = { scale: release.scale };
    if (!forward) pose.orientation = blendAxeOrientation(grip.orientation, back.rotation, ease);
    for (const key of ['x', 'y', 'depth', 'rotation']) {
      const tangent = forward ? (sample[key] - release[key]) * duration / (0.001 * airTime) : 0;
      pose[key] = from[key] + (to[key] - from[key]) * ease + tangent * u * u * (u - 1);
    }
    return pose;
  }

  function axeTrajectory(start, shot, duration, landingAngle, orientation) {
    const grip = {
      x: start.placed ? start.x : clamp(start.x, 0.86), y: start.placed ? start.y : clamp(start.y, 0.68),
      depth: DART_HAND_DEPTH + 9 * (start.lift ?? 0), rotation: 0,
      orientation: start.orientation ?? orientation,
    };
    const sweepX = start.placed ? clamp(shot.x - grip.x, 0.08) : -0.08;
    grip.backswingX = -Math.sign(sweepX) * 0.09;
    const release = { x: grip.x + sweepX, y: grip.y + 0.16, depth: DART_HAND_DEPTH, scale: AXE_SCALE };
    const windupMs = shot.axeWindupMs ?? AXE_WINDUP_MS;
    const backswingMs = Math.round(windupMs * AXE_BACKSWING_MS / AXE_WINDUP_MS);
    const airTime = duration - windupMs;
    const contact = shot.number || shot.axeBounce ? axeLeadingEdge(landingAngle - (shot.axeAngle ?? 0)) : null;
    const rawMotion = axeMotion(release, shot, landingAngle, airTime, contact?.point);
    const motion = (time, afterImpact = false) => {
      const pose = rawMotion(time, afterImpact);
      const keepEdgeClear = contact && (afterImpact ? shot.axeBounce && time > 0 : pose.u < 1);
      const correction = keepEdgeClear ? axeClearance(pose, (1 - pose.u) * 0.01) : 0;
      if (!correction) return pose;
      const depth = pose.depth + correction;
      const scaleRatio = boardPlaneScale(pose.depth) / boardPlaneScale(depth);
      return { ...pose, depth, x: pose.x * scaleRatio, y: pose.y * scaleRatio };
    };
    return { motion, rawMotion, contact, windupMs, backswingMs, windup: (elapsed) => axeWindup(grip, motion, elapsed, airTime, windupMs, backswingMs) };
  }

  const AXE_TRACE_COLUMNS = ['Time (ms)', 'Phase', 'X', 'Y', 'Z', 'Tumble (°)', 'qx', 'qy', 'qz', 'qw'];
  const AXE_TRACE_AXES = `Blade reference point in board radii. +X right, +Y up, +Z toward viewer. Negative tumble pitches forward about world X at ${AXE_HEADING}° heading. Quaternion uses WebGL X/Y/Z axes.`;
  function axeTraceRows(shot, duration, trajectory) {
    const { motion, windup, windupMs, backswingMs } = trajectory;
    const airTime = duration - windupMs;
    const samples = [
      [0, 'Start', windup(0)],
      [backswingMs, 'Backswing', windup(backswingMs)],
      [windupMs, 'Release', motion(0)],
      ...[0.25, 0.5, 0.75].map((progress) =>
        [windupMs + airTime * progress, `Flight ${progress * 100}%`, motion(progress)]),
      [duration, shot.number || shot.axeBounce ? 'Impact' : 'Board plane', motion(1)],
    ];
    if (!shot.number) {
      for (const delay of [100, 250]) samples.push([duration + delay, shot.axeBounce ? 'Bounce' : 'Past target',
        motion(delay / airTime, true)]);
    }
    return samples.map(([elapsed, phase, pose]) => {
      const rotation = phase === 'Start' || phase === 'Backswing' ? '' : pose.rotation.toFixed(1);
      const orientation = pose.orientation ?? axeTumbleOrientation(pose.rotation);
      return [Math.round(elapsed), phase, pose.x.toFixed(3), pose.y.toFixed(3), (pose.depth / 98).toFixed(3),
        rotation, ...orientation.map((component) => component.toFixed(4))];
    });
  }

  const AXE_CONTACT_LANDMARKS = [
    ...AXE_EDGE.map((point) => ({ feature: 'cutting edge', point })),
    ...[-1, 1].flatMap((side) => [
      ...AXE_BEVEL.map((point) => ({ feature: 'head face', point: [...point, side * AXE_BLADE_THICKNESS / 2] })),
      ...AXE_SPINE.map((point) => ({ feature: 'poll', point: [...point, side * AXE_BLADE_THICKNESS / 2] })),
      ...[[4.4, 4], [6.6, 4], [6, 13], [9, 24], [5.8, 26], [3.4, 17]]
        .map((point) => ({ feature: 'handle', point: [...point, side * 2.8] })),
    ]),
  ];

  const wrapAxeAngle = (angle) => ((angle % 360 + 540) % 360) - 180;

  function axeShadowContact(rawMotion, windupMs, airTime, contact) {
    // This compares landmarks on the fitted path before any visual clearance correction.
    const steps = 64, epsilon = 1e-7;
    const frameAt = (u) => {
      const pose = rawMotion(u);
      const orientation = axeTumbleOrientation(pose.rotation);
      const depthAt = ({ point }) => pose.depth + axePointOffset(point, pose.scale, orientation).depth;
      return { pose, orientation, depthAt };
    };
    const landmarks = contact?.midpoint
      ? [...AXE_CONTACT_LANDMARKS, { feature: 'cutting edge', point: contact.point }] : AXE_CONTACT_LANDMARKS;
    let previous = frameAt(0);
    for (let step = 1; step <= steps; step++) {
      const next = frameAt(step / steps);
      let first = null;
      for (const landmark of landmarks) {
        if (previous.depthAt(landmark) <= AXE_BOARD_DEPTH + epsilon || next.depthAt(landmark) > AXE_BOARD_DEPTH + epsilon) continue;
        let lo = (step - 1) / steps, hi = step / steps;
        for (let iteration = 0; iteration < 12; iteration++) {
          const mid = (lo + hi) / 2;
          if (frameAt(mid).depthAt(landmark) > AXE_BOARD_DEPTH + epsilon) lo = mid;
          else hi = mid;
        }
        if (first && hi >= first.u) continue;
        const { pose, orientation } = frameAt(hi);
        const offset = axePointOffset(landmark.point, pose.scale, orientation);
        const pointDepth = pose.depth + offset.depth;
        const worldX = pose.x * boardPlaneScale(pose.depth) + offset.x;
        const worldY = pose.y * boardPlaneScale(pose.depth) + offset.y;
        const x = worldX / boardPlaneScale(pointDepth), y = worldY / boardPlaneScale(pointDepth);
        if (Math.hypot(x, y) > 1 + epsilon) continue;
        const beforeU = Math.max(0, hi - 0.001), afterU = Math.min(1, hi + 0.001);
        const before = rawMotion(beforeU), after = rawMotion(afterU);
        const seconds = (afterU - beforeU) * airTime / 1000;
        const centerVelocity = (after.center.depth - before.center.depth) / seconds;
        const angularVelocity = (before.rotation - after.rotation) * Math.PI / 180 / seconds;
        const contactLeverY = worldY - pose.center.y;
        first = {
          u: hi, feature: landmark.feature, timeMs: Math.round(windupMs + hi * airTime),
          x, y, pitch: wrapAxeAngle(pose.rotation), approachSpeed: -(centerVelocity + angularVelocity * contactLeverY) / 98,
        };
      }
      if (first) {
        const { u, ...result } = first;
        return result;
      }
      previous = next;
    }
    return null;
  }

  function axeContactTrace(shot, duration, trajectory, landingAngle, stickAngle = 30) {
    const { contact, rawMotion, windupMs } = trajectory;
    let clearance = 0;
    if (contact) {
      for (let i = 0; i < 64; i++) {
        const u = i / 64;
        clearance = Math.max(clearance, axeClearance(rawMotion(u), (1 - u) * 0.01));
      }
    }
    const shadow = axeShadowContact(rawMotion, windupMs, duration - windupMs, contact);
    if (shadow) shadow.angleError = wrapAxeAngle(shadow.pitch - landingAngle);
    const bladeFirst = shadow?.feature === 'cutting edge' && shadow.approachSpeed > 0 && Math.abs(shadow.angleError) <= stickAngle;
    return {
      version: 1,
      boardPoint: contact ? { x: shot.x, y: shot.y, z: AXE_BOARD_DEPTH / 98 } : null,
      edge: contact, timeMs: contact ? duration : null,
      pitch: wrapAxeAngle(rawMotion(1).rotation), heading: AXE_HEADING,
      clearance: clearance / 98,
      shadow,
      serverResult: shot.number ? 'stick' : shot.axeBounce ? 'bounce' : 'miss',
      predictedResult: shadow ? (bladeFirst ? 'blade-first' : 'glancing') : 'no target contact',
    };
  }

  function makeDarts3d(surface, onRendererChange) {
    const T = window.THREE;
    let api;
    const renderer = GL3.renderer({ alpha: true }, { onLost: () => api?.dispose() });
    if (!renderer) return null;
    renderer.outputEncoding = T.sRGBEncoding;
    const canvas = renderer.domElement;
    canvas.className = 'ar-darts-webgl';
    canvas.setAttribute('aria-hidden', 'true');
    surface.prepend(canvas);
    const cameraDistance = BOARD_CAMERA_DISTANCE;
    const fov = 2 * Math.atan(125 / cameraDistance) * 180 / Math.PI;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(fov, 1, 1, 850);
    camera.position.z = cameraDistance;
    const VIEW_TARGET = new T.Vector3();
    scene.add(new T.HemisphereLight(0xf4e4ce, 0x6c534c, 1.35));
    const lamp = new T.SpotLight(0xffc890, 3.65, 0, 0.53, 0.79);
    lamp.position.set(-75, 174, 235);
    lamp.target.position.set(1, 24, 0);
    scene.add(lamp, lamp.target);
    const rimLight = new T.DirectionalLight(0xf2f3f5, 0.28);
    rimLight.position.set(130, -105, 46);
    scene.add(rimLight);
    const dartLight = new T.PointLight(0xe8f3ff, 0, 84, 1);
    scene.add(dartLight);
    if (renderer.shadowMap && GL3.level?.() !== 'low') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(768, 768);
      lamp.shadow.camera.near = 120;
      lamp.shadow.camera.far = 400;
      lamp.shadow.radius = 3;
      lamp.shadow.normalBias = 0.32;
    }
    const face = new T.Group(); scene.add(face);
    const material = (color, options = {}) => new T.MeshStandardMaterial({ color, roughness: 0.88, ...options });
    const mesh = (group, geo, mat, x = 0, y = 0, z = 0) => {
      const obj = new T.Mesh(geo, mat);
      obj.position.set(x, y, z);
      group.add(obj);
      return obj;
    };

    const textureSize = 256;
    const fibers = new Uint8Array(textureSize * textureSize * 4);
    let seed = 413;
    for (let y = 0; y < textureSize; y++) {
      for (let x = 0; x < textureSize; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const index = 4 * (y * textureSize + x);
        const grain = 161 + (seed >>> 26) + 22 * Math.sin(x * 1.9 + Math.sin(y * 0.41));
        fibers[index] = fibers[index + 1] = fibers[index + 2] = grain;
        fibers[index + 3] = 255;
      }
    }
    function detailTexture(pixels) {
      const texture = new T.DataTexture(pixels, textureSize, textureSize);
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.magFilter = T.LinearFilter;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      return texture;
    }
    const grain = detailTexture(fibers);
    const woodPixels = new Uint8Array(fibers.length);
    for (let y = 0; y < textureSize; y++) {
      for (let x = 0; x < textureSize; x++) {
        const i = 4 * (y * textureSize + x);
        const curve = x + 2.1 * Math.sin(y * 0.031 + x * 0.094) + 1.6 * Math.sin(y * 0.012 + x * 0.23);
        const streak = Math.sin(curve * 1.12) + 0.6 * Math.sin(curve * 2.47) + 0.9 * Math.sin(curve * 0.19);
        const grainValue = 0.82 + 0.031 * streak + 0.035 * (fibers[i] / 128 - 1);
        woodPixels[i] = 222 * grainValue;
        woodPixels[i + 1] = 159 * grainValue;
        woodPixels[i + 2] = 116 * grainValue;
        woodPixels[i + 3] = 255;
      }
    }
    const wood = detailTexture(woodPixels);
    wood.encoding = T.sRGBEncoding;
    const cabinet = new T.Group();
    scene.add(cabinet);
    const walnut = material(0x79503a, { map: wood, bumpMap: grain, bumpScale: 0.24, roughness: 0.72 });
    const seam = material(0x211510);
    const mountMetal = material(DART_BRASS, { metalness: 0.42, roughness: 0.4 });
    const edgeWear = material(0x896249, { map: wood, roughness: 0.78 });
    const wornEdge = new T.BoxGeometry(0.65, 265, 0.4);
    const seamGeometry = new T.BoxGeometry(1.5, 265, 1);
    for (let n = -2; n <= 2; n++) {
      const x = n * 53;
      const plank = new T.BoxGeometry(52, 265, 5);
      const uv = plank.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) + n * 0.23, uv.getY(i) + n * 0.17);
      }
      mesh(cabinet, plank, walnut, x, 0, -19).receiveShadow = true;
      if (n < 2) {
        mesh(cabinet, seamGeometry, seam, x + 26.5, 0, -17).receiveShadow = true;
        mesh(cabinet, wornEdge, edgeWear, x + 25.4, 0, -16.4).receiveShadow = true;
      }
    }
    const shadowSize = 128;
    const shadowPixels = new Uint8Array(shadowSize * shadowSize * 4);
    for (let y = 0; y < shadowSize; y++) {
      for (let x = 0; x < shadowSize; x++) {
        const radius = Math.hypot(x + 0.5 - shadowSize / 2, y + 0.5 - shadowSize / 2) * 132 / (shadowSize / 2);
        const alpha = smooth((132 - radius) / 18);
        shadowPixels[(y * shadowSize + x) * 4 + 3] = Math.round(103 * alpha);
      }
    }
    const contactShadow = new T.DataTexture(shadowPixels, shadowSize, shadowSize);
    contactShadow.magFilter = T.LinearFilter;
    contactShadow.needsUpdate = true;
    mesh(cabinet, new T.PlaneGeometry(264, 264),
      new T.MeshBasicMaterial({ map: contactShadow, transparent: true, depthWrite: false }), 0, 0, -16.1);

    const cabinetHalf = 132.5, openingHalf = 122, cabinetBack = -36, cabinetFront = -11;
    const railWood = wood.clone();
    railWood.rotation = Math.PI / 2;
    railWood.center.set(0.5, 0.5);
    railWood.needsUpdate = true;
    const railFace = material(0x654434, { map: railWood, roughness: 0.57 });
    const railSide = material(0x4c3328, { map: railWood, roughness: 0.65 });
    const miterGap = 0.85;
    const railShape = new T.Shape();
    railShape.moveTo(-cabinetHalf + miterGap, cabinetHalf);
    railShape.lineTo(-openingHalf + miterGap, openingHalf);
    railShape.lineTo(openingHalf - miterGap, openingHalf);
    railShape.lineTo(cabinetHalf - miterGap, cabinetHalf);
    railShape.closePath();
    const rail = new T.ExtrudeGeometry(railShape, {
      depth: cabinetFront - cabinetBack, bevelSize: 0.72, bevelThickness: 0.72, bevelSegments: 2,
    });
    const railUV = rail.attributes.uv;
    for (let i = 0; i < railUV.count; i++) {
      railUV.setXY(i, railUV.getX(i) / (2 * cabinetHalf) + 0.5, railUV.getY(i) / 36);
    }
    for (let i = 0; i < 4; i++) {
      const side = mesh(cabinet, rail, [railFace, railSide], 0, 0, cabinetBack);
      side.rotation.z = i * Math.PI / 2;
      side.receiveShadow = true;
    }
    mesh(cabinet, new T.BoxGeometry(2 * openingHalf, 2 * openingHalf, 4),
      railSide, 0, 0, cabinetBack + 2);
    const bracket = new T.BoxGeometry(16, 7, 1.8);
    const bolt = new T.SphereGeometry(1.25, 10, 6);
    for (const x of [-112, 112]) for (const y of [-110, 110]) {
      mesh(cabinet, bracket, mountMetal, x, y, -15.5).rotation.z = Math.sign(x * y) * 0.78;
      for (const offset of [-4, 4]) {
        mesh(cabinet, bolt, mountMetal, x + offset, y + offset * Math.sign(x * y), -14.2);
      }
    }

    const numbers = new Map();
    let normalNumber, goldNumber, highlighted;
    function makeNumbers(order) {
      const atlas = document.createElement('canvas');
      const size = 512, tile = 64, glyphSize = 12, planeSize = 21;
      atlas.width = atlas.height = size;
      const ink = atlas.getContext('2d');
      if (!ink) return;
      const texture = new T.CanvasTexture(atlas);
      texture.colorSpace = T.SRGBColorSpace;
      normalNumber = new T.MeshBasicMaterial({ map: texture, alphaTest: 0.25 });
      goldNumber = new T.MeshBasicMaterial({ map: texture, color: 0xffdf82, alphaTest: 0.25 });
      ink.font = `bold ${glyphSize * tile / planeSize}px system-ui, sans-serif`;
      ink.textAlign = 'center';
      ink.textBaseline = 'middle';
      ink.lineJoin = 'round';
      order.forEach((number, index) => {
        const left = (index % 8) * tile, top = Math.floor(index / 8) * tile;
        const x = left + tile / 2, y = top + tile / 2;
        ink.lineWidth = 4;
        ink.strokeStyle = '#130e0b';
        ink.strokeText(number, x, y + 3);
        ink.fillStyle = '#b8a58b';
        ink.fillText(number, x, y + 1.5);
        ink.strokeStyle = '#16110d';
        ink.strokeText(number, x, y);
        ink.fillStyle = '#fff7e6';
        ink.fillText(number, x, y);
        ink.fillStyle = '#fffaf1';
        ink.save();
        ink.beginPath();
        ink.rect(left, top, tile, tile / 2);
        ink.clip();
        ink.fillText(number, x, y - 0.7);
        ink.restore();

        const depth = 0.38, perspective = 1 - depth / cameraDistance;
        const geometry = new T.PlaneGeometry(planeSize * perspective, planeSize * perspective);
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, (left + uv.getX(i) * tile) / size, 1 - (top + (1 - uv.getY(i)) * tile) / size);
        }
        const angle = index * Math.PI / 10;
        const radius = DART_NUMBER_RADIUS * perspective;
        numbers.set(number, mesh(face, geometry, normalNumber, Math.sin(angle) * radius, Math.cos(angle) * radius, depth));
      });
    }

    function setNumberTarget(target) {
      const next = numbers.get(target);
      if (next === highlighted) return;
      if (highlighted) highlighted.material = normalNumber;
      if (next) next.material = goldNumber;
      highlighted = next;
      lastFrame = null;
    }

    function paint(view) {
      if (face.children.length) return;
      axe = !!view.axeRings;
      axeLodgedAngle = view.axeLodgedAngle;
      inHand = dart();
      flying = dart();
      if (axe) {
        lamp.color.setHex(0xffead5);
        lamp.intensity = 2.5;
        makeAxeReflection();
        paintAxeEndGrain();
        loadAxeMaterial(axeSteel, AXE_ART.steel, true);
        loadAxeMaterial(axeEdgeSteel, AXE_ART.bevel);
        loadAxeMaterial(axeWood, AXE_ART.handle, true);
        const target = document.createElement('canvas');
        target.width = target.height = 512;
        const ink = target.getContext('2d');
        ink.font = 'bold 29px system-ui';
        ink.textAlign = 'center';
        ink.textBaseline = 'middle';
        const rings = [...view.axeRings].reverse();
        const boardMap = new T.CanvasTexture(target);
        boardMap.encoding = T.sRGBEncoding;
        boardMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        const boardMaterial = material(0xded0bc, { map: boardMap, bumpMap: grain, bumpScale: 0.25 });
        const paintTarget = (photo) => {
          ink.fillStyle = '#cfa275';
          ink.fillRect(0, 0, 512, 512);
          if (photo) ink.drawImage(photo, 0, 0, 512, 512);
          rings.forEach(([radius, points], index) => {
            ink.beginPath();
            ink.arc(256, 256, radius * 256, 0, Math.PI * 2);
            if (index + 1 < rings.length) {
              const inner = rings[index + 1][0] * 256;
              ink.moveTo(256 + inner, 256);
              ink.arc(256, 256, inner, 0, Math.PI * 2, true);
            }
            ink.fillStyle = ringColor(points) + (photo ? '80' : 'ff');
            ink.fill();
            ink.strokeStyle = '#42291b99';
            ink.lineWidth = 2.5;
            ink.stroke();
          });
          for (const [radius, points] of rings) {
            const labelY = 256 - axeLabelRadius(radius, points) * 256;
            ink.strokeStyle = '#35231a';
            ink.lineWidth = 3;
            ink.strokeText(points, 256, labelY);
            ink.fillStyle = '#fff5df';
            ink.fillText(points, 256, labelY);
          }
          for (const [x, y, radius] of view.axeCorners ?? []) {
            ink.beginPath();
            ink.arc(256 * (1 + x), 256 * (1 - y), radius * 256, 0, Math.PI * 2);
            ink.fillStyle = '#30653f';
            ink.fill();
            ink.fillStyle = '#fff5df';
            ink.font = 'bold 24px system-ui';
            ink.fillText('7', 256 * (1 + x), 256 * (1 - y));
            ink.font = 'bold 29px system-ui';
          }
          boardMap.needsUpdate = true;
        };
        paintTarget();
        const backingProfile = [[0, -10], [97, -10], [99, -8], [99, -2], [98, AXE_BOARD_DEPTH]]
          .map(([radius, depth]) => new T.Vector2(radius, depth));
        mesh(face, new T.LatheGeometry(backingProfile, 96), walnut).rotation.x = Math.PI / 2;
        mesh(face, new T.CircleGeometry(98, 96), boardMaterial, 0, 0, AXE_BOARD_DEPTH).receiveShadow = true;
        const photo = new Image();
        photo.onload = () => {
          if (disposed) return;
          paintTarget(photo);
          boardMaterial.bumpMap = boardMap;
          boardMaterial.bumpScale = 0.32;
          refreshAxeArt();
        };
        photo.src = AXE_ART.board;
        return;
      }
      const rings = view.radii.map((r) => r * 98);
      const [, outer, , , , edge] = rings;
      const rimProfile = [
        [0, -13.5], [119, -13.5], [119, -2.7], [118.9, -1.9],
        [118.6, -1.35], [118.1, -0.95], [117.5, -0.65], [116.8, -0.5], [0, -0.5],
      ].map(([radius, depth]) => new T.Vector2(radius, depth));
      const backing = mesh(face, new T.LatheGeometry(rimProfile, 96),
        material(DART_RIM, { roughness: 0.72 }));
      backing.rotation.x = Math.PI / 2;
      backing.castShadow = true;
      const spacers = new T.CylinderGeometry(4, 4, 3.3, 12);
      for (const y of [-77, 77]) {
        mesh(face, spacers, backing.material, 0, y, -15).rotation.x = Math.PI / 2;
      }
      const wire = material(DART_WIRE, { metalness: 0.31, roughness: 0.48 });
      const screwHead = new T.CircleGeometry(1.2, 12);
      const slot = new T.PlaneGeometry(1.5, 0.26);
      const slotMat = material(0x211c19);
      for (const a of DART_FASTENERS) {
        const x = 115.9 * Math.cos(a), y = 115.9 * Math.sin(a);
        mesh(face, screwHead, mountMetal, x, y, 0.2);
        mesh(face, slot, slotMat, x, y, 0.3).rotation.z = a;
      }
      const step = Math.PI / 10;
      const [map, bump] = sisalFace(rings);
      mesh(face, new T.CircleGeometry(113, 128), material(0xffffff, { map, bumpMap: bump, bumpScale: 0.12, roughness: 1 }), 0, 0, 0.1);
      mesh(face, new T.RingGeometry(edge + 0.85, 115, 128), material(DART_NUMBER_BAND), 0, 0, 0.25);
      holes = new T.CanvasTexture(holeCanvas);
      if (T.SRGBColorSpace) holes.colorSpace = T.SRGBColorSpace;
      holes.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);  // the board's filtering
      holeLayer = mesh(face, new T.CircleGeometry(113, 64), new T.MeshBasicMaterial({ map: holes, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0, 0, 0.38);
      const wireSeat = material(DART_WIRE_BASE);
      const spokeTube = new T.CylinderGeometry(0.49, 0.49, edge - outer, 8);
      const spokeSeat = new T.PlaneGeometry(1.28, edge - outer);
      view.numbers.forEach((_, i) => {
        const a = Math.PI / 2 - (i + 0.5) * step;
        const x = Math.cos(a) * (edge + outer) / 2, y = Math.sin(a) * (edge + outer) / 2;
        mesh(face, spokeSeat, wireSeat, x, y, 0.12).rotation.z = a - Math.PI / 2;
        mesh(face, spokeTube, wire, x, y, 0.49).rotation.z = a - Math.PI / 2;
      });
      for (const r of rings) {
        mesh(face, new T.RingGeometry(r - 0.68, r + 0.68, 112), wireSeat, 0, 0, 0.13);
        mesh(face, new T.TorusGeometry(r, 0.53, 8, 112), wire, 0, 0, 0.53);
      }
      face.children.forEach((part) => { part.receiveShadow = true; });
      makeNumbers(view.numbers);
    }

    // One painted face: sisal fibre dashes, mottling, pressed grooves under the wire, plus a matching bump map.
    function sisalFace(rings) {
      const N = 1024, half = N / 2, unit = half / 113, [bullR, outerR, tripleIn, tripleOut, doubleIn, edge] = rings;
      const hash = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
      const rgbChannels = (hex) => hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
      const [paletteDark, paletteLight, paletteRed, paletteGreen] = Object.values(DART_PALETTE).map(rgbChannels);
      const color = document.createElement('canvas'), relief = document.createElement('canvas');
      color.width = color.height = relief.width = relief.height = N;
      const cg = color.getContext('2d'), rg = relief.getContext('2d');
      const img = cg.createImageData(N, N), bmp = rg.createImageData(N, N);
      const edgeTint = [189, 172, 144];
      const step = Math.PI / 10;
      for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - half) / unit, dy = (half - py - 0.5) / unit, r = Math.hypot(dx, dy);
        const o = 4 * (py * N + px);
        let base, rgb;
        const angle = Math.atan2(dy, dx);
        const turn = (Math.PI / 2 - angle) / step, i = Math.round(turn), off = turn - i;
        const even = (((i % 20) + 20) % 20) % 2 === 0;
        if (r > edge) rgb = r > 113 ? [24, 24, 22] : [41, 39, 32];
        else if (r < bullR) rgb = paletteRed;
        else if (r < outerR) rgb = paletteGreen;
        else if (r < tripleIn || (r >= tripleOut && r < doubleIn)) rgb = even ? paletteDark : paletteLight;
        else rgb = even ? paletteRed : paletteGreen;
        // Broken directional fibres and broad variations in compressed sisal.
        const bend = 0.36 * Math.sin(r * 0.32 + angle * 9);
        const strand = Math.floor((angle * r + bend) / 0.26);
        const offset = 9 * hash(strand, 7);
        const fibre = hash(strand, Math.floor((r + offset) / 1.7));
        const bundle = hash(Math.floor(strand / 6), Math.floor((r + offset) / 5));
        const fine = hash(px, py);

        const cellX = Math.floor(px / 26), cellY = Math.floor(py / 26);
        const wearSeed = hash(cellX, cellY);
        const wearX = px % 26 - (5 + 16 * wearSeed);
        const wearY = py % 26 - (5 + 16 * hash(cellY, cellX + 41));
        const impression = r < edge && wearSeed > 0.89
          ? c01(1 - (wearX * wearX + wearY * wearY) / 10) : 0;

        const ringEdge = Math.min(Math.abs(r - tripleIn), Math.abs(r - tripleOut), Math.abs(r - doubleIn), Math.abs(r - edge));
        const spokeEdge = r >= outerR ? (0.5 - Math.abs(off)) * step * r : Infinity;
        const wireEdge = Math.min(spokeEdge, ringEdge, Math.abs(r - bullR), Math.abs(r - outerR));
        const groove = r <= edge + 0.6 ? 0.62 + 0.38 * c01(wireEdge / 1.1) : 1;
        const seam = r <= edge ? 0.16 * c01(1 - ringEdge / 0.55) : 0;
        const k = (0.82 + 0.10 * fibre + 0.09 * (bundle - 0.5) + 0.04 * (fine - 0.5) - 0.14 * impression) * groove;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, rgb[c] * k * (1 - seam) + edgeTint[c] * seam);
        img.data[o + 3] = 255;
        base = (0.32 + 0.38 * fibre + 0.12 * bundle + 0.16 * fine - 0.22 * impression) * groove * (r > edge ? 0.7 : 1) * 255;
        bmp.data[o] = bmp.data[o + 1] = bmp.data[o + 2] = base;
        bmp.data[o + 3] = 255;
      }
      cg.putImageData(img, 0, 0); rg.putImageData(bmp, 0, 0);
      const make = (canvas, srgb) => {
        const texture = new T.CanvasTexture(canvas);
        if (srgb && T.SRGBColorSpace) texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
        return texture;
      };
      return [make(color, true), make(relief, false)];
    }
    // Holes left by earlier darts, painted onto a transparent overlay on the board.
    const holeCanvas = document.createElement('canvas');
    holeCanvas.width = holeCanvas.height = 1024;
    let holes, holeLayer, holeCount = -1;
    function paintHoles(list) {
      if (!holes || list.length === holeCount) return;
      holeCount = list.length;
      const g = holeCanvas.getContext('2d'), unit = 512 / 113;
      g.clearRect(0, 0, 1024, 1024);
      for (const h of list) {
        const x = 512 + h.x * 98 * unit, y = 512 - h.y * 98 * unit, r = 1.5 * unit;
        // a small hard-edged pit and a lit lower lip: as sharp as the board around it (a wide soft halo looked
        // like a blurry patch, #22)
        g.fillStyle = 'rgba(20,14,10,0.3)'; g.beginPath(); g.arc(x, y, r * 1.1, 0, 7); g.fill();
        g.fillStyle = '#0a0706'; g.beginPath(); g.arc(x, y, r * 0.72, 0, 7); g.fill();
        g.strokeStyle = 'rgba(236,220,180,0.75)'; g.lineWidth = 1.6;
        g.beginPath(); g.arc(x, y, r * 0.82, 0.35, 2.8); g.stroke();
        g.strokeStyle = 'rgba(214,196,150,0.5)'; g.lineWidth = 0.9;   // torn fibres round the rim
        for (let n = 0; n < 7; n++) {
          const a = h.seed * 9 + n * 0.9 + Math.sin(n * 7 + h.seed * 13) * 0.3, l = r * (1.1 + 0.6 * ((n * 37 + h.seed * 100) % 7) / 7);
          g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
          g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
        }
      }
      holes.needsUpdate = true;
      lastFrame = null;
    }

    const steel = material(0xf0e8db, { roughness: 0.31, metalness: 0.43 });
    const pointSteel = material(0xbfc8cd, { roughness: 0.28, metalness: 0.48 });
    const brass = material(0xc59b62, { roughness: 0.39, metalness: 0.48 });
    const groove = material(0x8a6c46, { roughness: 0.54 });  // close to the brass: dark rings read as noise (#22)
    const defaultFinColor = 0x24516c;
    const defaultAxeHandleColor = 0xe8c99f;
    const foldHighlight = material(0x97a9b3, { side: T.DoubleSide, roughness: 0.6 });
    const flightShape = new T.Shape();
    flightShape.moveTo(0, -2);
    flightShape.lineTo(6.4, -8.4);
    flightShape.quadraticCurveTo(7.2, -9.2, 7, -10.1);
    flightShape.lineTo(6.1, -14.3);
    flightShape.quadraticCurveTo(5.9, -15.2, 5, -15);
    flightShape.lineTo(0, -12.5);
    flightShape.closePath();
    const foldShape = new T.Shape();
    foldShape.moveTo(0.72, -2.85);
    foldShape.lineTo(1.15, -3.3);
    foldShape.lineTo(1.15, -12.9);
    foldShape.lineTo(0.72, -12.7);
    foldShape.closePath();
    const tipGeometry = new T.LatheGeometry([
      [0.42, 24.2], [0.39, 26.1], [0.33, 29.8], [0.19, 31.4], [0, DART_POINT_APEX],
    ].map(([radius, height]) => new T.Vector2(radius, height)), 12);
    const noseGeometry = new T.CylinderGeometry(0.61, 2.15, 2.6, 16);
    const barrelGeometry = new T.CylinderGeometry(2.15, 1.95, 22, 18);
    const collarGeometry = new T.CylinderGeometry(1.88, 0.9, 2.5, 14);
    const shaftGeometry = new T.CylinderGeometry(0.82, 0.68, 38, 10);
    const gripRing = new T.TorusGeometry(2.08, 0.2, 6, 24);
    const finGeo = new T.ExtrudeGeometry(flightShape, {
      depth: 0.22, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1, curveSegments: 5,
    }).translate(0, 0, -0.11);
    const foldGeo = new T.ShapeGeometry(foldShape);
    // Extend the flight toward the barrel while keeping its rear edge in place.
    for (const geometry of [finGeo, foldGeo]) {
      geometry.translate(0, 15, 0).scale(1.16, 1.65, 1).translate(0, -15, 0);
    }
    function dart() {
      const group = new T.Group();
      const finMaterial = axe ? axeWood.clone() : material(defaultFinColor, { side: T.DoubleSide, roughness: 0.8 });
      group.userData.finMaterial = finMaterial;
      if (axe) {
        const model = new T.Group();
        model.scale.set(0.5, 1 / 3, 1);
        model.position.y = DART_POINT_APEX * (2 / 3);
        axeHandleMaterials.add(finMaterial);
        mesh(model, axeHandle, finMaterial).castShadow = true;
        mesh(model, axeButt, axeEndGrain);
        mesh(model, axeEye, axeEndGrain);
        mesh(model, axeWedge, axeWedgeWood, 10.2, 29.85);
        mesh(model, axeBlade, axeSteel).castShadow = true;
        mesh(model, axeBevel, axeEdgeSteel);
        group.add(model);
        scene.add(group);
        return group;
      }
      mesh(group, tipGeometry, pointSteel);
      mesh(group, noseGeometry, steel, 0, 23.85);
      mesh(group, barrelGeometry, brass, 0, 11.55);
      for (let i = 0; i < 5; i++) {  // few enough to stay separate lines at board size (#22)
        mesh(group, gripRing, groove, 0, 3 + i * 4.2).rotation.x = Math.PI / 2;
      }
      mesh(group, collarGeometry, steel, 0, -0.65);
      mesh(group, shaftGeometry, steel, 0, -19.7);
      for (let i = 0; i < 4; i++) {
        const fin = new T.Group();
        fin.rotation.y = i * Math.PI / 2;
        fin.position.y = -35.9;
        mesh(fin, finGeo, finMaterial);
        mesh(fin, foldGeo, foldHighlight, 0, 0, 0.13);
        mesh(fin, foldGeo, foldHighlight, 0, 0, -0.13);
        group.add(fin);
      }
      group.traverse((part) => { if (part.isMesh) part.castShadow = true; });
      scene.add(group);
      return group;
    }
    const axePoint = ([x, y]) => new T.Vector2(x * 2, DART_POINT_APEX - y * 3);
    const axeShape = new T.Shape(AXE_BEVEL.map(axePoint));
    axeShape.lineTo(16.8, 8.1);
    axeShape.quadraticCurveTo(20.7, 8.1, 20.7, 11.4);
    axeShape.lineTo(20.7, 23.7);
    axeShape.quadraticCurveTo(20.7, 27.2, 16.8, 27.2);
    axeShape.closePath();
    const halfBlade = AXE_BLADE_THICKNESS / 2;
    const axeBlade = new T.ExtrudeGeometry(axeShape, {
      depth: AXE_BLADE_THICKNESS - 0.36, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.23,
      bevelThickness: 0.18, curveSegments: 5,
    }).translate(0, 0, 0.18 - halfBlade);
    const bevelVertices = [], bevelNormals = [];
    const edge = AXE_EDGE.map(axePoint), shoulder = AXE_BEVEL.map(axePoint);
    const bevelPoint = (points, index, z) => new T.Vector3(points[index].x, points[index].y, z);
    const triangle = (a, b, c, normals) => {
      bevelVertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      const face = new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a)).normalize();
      for (const normal of normals ?? [face, face, face]) bevelNormals.push(...normal.toArray());
    };
    for (const side of [-1, 1]) {
      const z = side * halfBlade;
      const normals = edge.map((point, i) => {
        const tangent = new T.Vector3().subVectors(
          bevelPoint(edge, Math.min(i + 1, edge.length - 1), 0),
          bevelPoint(edge, Math.max(i - 1, 0), 0));
        const slope = new T.Vector3(shoulder[i].x - point.x, shoulder[i].y - point.y, z);
        return tangent.cross(slope).multiplyScalar(side).normalize();
      });
      for (let i = 0; i < edge.length - 1; i++) {
        const a = bevelPoint(edge, i, 0), b = bevelPoint(edge, i + 1, 0);
        const c = bevelPoint(shoulder, i, z), d = bevelPoint(shoulder, i + 1, z);
        if (side > 0) {
          triangle(a, b, c, [normals[i], normals[i + 1], normals[i]]);
          triangle(b, d, c, [normals[i + 1], normals[i + 1], normals[i]]);
        } else {
          triangle(a, c, b, [normals[i], normals[i], normals[i + 1]]);
          triangle(b, c, d, [normals[i + 1], normals[i], normals[i + 1]]);
        }
      }
    }
    for (const i of [0, edge.length - 1]) {
      const a = bevelPoint(edge, i, 0), b = bevelPoint(shoulder, i, halfBlade), c = bevelPoint(shoulder, i, -halfBlade);
      if (i === 0) triangle(a, c, b);
      else triangle(a, b, c);
    }
    const axeBevel = new T.BufferGeometry();
    axeBevel.setAttribute('position', new T.Float32BufferAttribute(bevelVertices, 3));
    axeBevel.setAttribute('normal', new T.Float32BufferAttribute(bevelNormals, 3));
    let axeReflection;
    function makeAxeReflection() {
      const image = document.createElement('canvas');
      image.width = 128; image.height = 64;
      const ink = image.getContext('2d');
      if (!ink) return;
      ink.fillStyle = '#414953';
      ink.fillRect(0, 0, 128, 64);
      for (const [x, y, radius, color] of [[32, 22, 23, '#fff4e1'], [94, 28, 16, '#bacfea']]) {
        const light = ink.createRadialGradient(x, y, 1, x, y, radius);
        light.addColorStop(0, color);
        light.addColorStop(1, 'transparent');
        ink.fillStyle = light;
        ink.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
      }
      const source = new T.CanvasTexture(image);
      source.encoding = T.sRGBEncoding;
      const pmrem = new T.PMREMGenerator(renderer);
      axeReflection = pmrem.fromEquirectangular(source);
      pmrem.dispose();
      source.dispose();
      axeSteel.envMap = axeEdgeSteel.envMap = axeReflection.texture;
    }

    function loadAxeMaterial(mat, url, useBump = false) {
      new T.TextureLoader().load(url, (map) => {
        if (disposed) {
          map.dispose();
          return;
        }
        map.encoding = T.sRGBEncoding;
        map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        const materials = mat === axeWood ? [mat, ...axeHandleMaterials] : [mat];
        for (const material of materials) {
          material.map = map;
          if (useBump) material.bumpMap = map;
          material.needsUpdate = true;
        }
        refreshAxeArt();
      });
    }

    // The extrusion uses world units for UVs. Project the material across the actual local bounds.
    function mapAxeMaterial(geometry, depthWeight = 0) {
      geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      const position = geometry.attributes.position;
      const left = min.x + min.z * depthWeight;
      const width = max.x + max.z * depthWeight - left;
      const uv = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i++) {
        uv[i * 2] = (position.getX(i) + position.getZ(i) * depthWeight - left) / width;
        uv[i * 2 + 1] = (position.getY(i) - min.y) / (max.y - min.y);
      }
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    }
    const axeSteel = material(0x89949d, { metalness: 0.68, roughness: 0.55, bumpScale: 0.045, envMapIntensity: 1.2 });
    const axeEdgeSteel = material(0xe8edf0, { metalness: 0.72, roughness: 0.28, envMapIntensity: 1.65 });
    const handleRings = [
      // Height, center X, width radius, and thickness radius.
      [29.7, 10.2, 3.1, 1.95], [21, 10.1, 3.25, 2.1], [14, 9.8, 2.7, 1.85],
      [5, 10, 2.5, 1.75], [-7, 10.7, 2.55, 1.85], [-19, 12.1, 2.65, 2],
      [-31, 14.4, 2.85, 2.15], [-40, 15.3, 3.45, 2.45], [-46, 14.4, 3.65, 2.5], [-48, 14.1, 2.8, 2.05],
    ];
    const radialSegments = 16, handleVertices = [], handleUVs = [], handleIndices = [];
    for (const [ring, [y, x, width, thickness]] of handleRings.entries()) {
      for (let i = 0; i <= radialSegments; i++) {
        const angle = i * Math.PI * 2 / radialSegments;
        handleVertices.push(x + Math.cos(angle) * width, y, Math.sin(angle) * thickness);
        handleUVs.push(i / radialSegments, (y + 48) / 73);
        if (ring && i) {
          const last = ring * (radialSegments + 1) + i, above = last - radialSegments - 1;
          handleIndices.push(above - 1, above, last - 1, above, last, last - 1);
        }
      }
    }
    const axeHandle = new T.BufferGeometry();
    axeHandle.setAttribute('position', new T.Float32BufferAttribute(handleVertices, 3));
    axeHandle.setAttribute('uv', new T.Float32BufferAttribute(handleUVs, 2));
    axeHandle.setIndex(handleIndices);
    axeHandle.computeVertexNormals();
    const handleCap = ([y, x, width, thickness], top) => new T.CircleGeometry(1, radialSegments)
      .scale(width, thickness, 1).rotateX(top ? -Math.PI / 2 : Math.PI / 2).translate(x, y, 0);
    const axeButt = handleCap(handleRings.at(-1), false);
    const axeEye = handleCap(handleRings[0], true);
    const axeWedge = new T.BoxGeometry(4.1, 0.18, 0.5).rotateY(-0.2);
    const axeWedgeWood = material(0x58321f, { roughness: 0.82 });
    const axeEndGrain = material(0xc48d55, { roughness: 0.85 });
    function paintAxeEndGrain() {
      const image = document.createElement('canvas');
      image.width = image.height = 32;
      const ink = image.getContext('2d');
      if (!ink) return;
      ink.fillStyle = '#eac593';
      ink.fillRect(0, 0, 32, 32);
      ink.strokeStyle = '#b57f53';
      ink.lineWidth = 0.8;
      for (let radius = 4; radius <= 28; radius += 4) {
        ink.beginPath();
        ink.ellipse(10, 18, radius, radius * 0.8, -0.3, 0, Math.PI * 2);
        ink.stroke();
      }
      axeEndGrain.map = new T.CanvasTexture(image);
      axeEndGrain.map.encoding = T.sRGBEncoding;
      axeEndGrain.needsUpdate = true;
    }
    const axeHandleMaterials = new Set();
    const axeWood = material(defaultAxeHandleColor, { roughness: 0.59, bumpScale: 0.06 });
    mapAxeMaterial(axeBlade, 0.5);
    mapAxeMaterial(axeBevel);
    let axe, axeLodgedAngle, inHand, flying;
    const lodged = [];
    const tip = new T.Vector3(), direction = new T.Vector3();
    const dartAxis = new T.Vector3(0, 1, 0);
    const aimingOrientation = new T.Quaternion().setFromUnitVectors(dartAxis,
      new T.Vector3(0, 0, -1));
    const landedOrientation = new T.Quaternion(), wobble = new T.Quaternion(), wobbleEuler = new T.Euler(), sight = new T.Vector3();
    // A stuck dart points along the line of sight to its tip, so perspective doesn't streak the tail outward from
    // the board centre, then lifts the tail a little so it reads as thrown from below.
    function lodgedPose(x, y, id, fan, out) {
      sight.set(x * 98, y * 98, -cameraDistance).normalize();
      const turn = fan * Math.PI / 180;
      const side = 0.1 * ((id * 0.6180339) % 1 - 0.5);
      const drop = 0.18 + 0.08 * ((id * 0.4142136) % 1);
      sight.x += side * Math.cos(turn) - drop * Math.sin(turn);
      sight.y -= side * Math.sin(turn) + drop * Math.cos(turn);
      return out.setFromUnitVectors(dartAxis, sight.normalize());
    }
    const travelOrientation = new T.Quaternion();
    const planeScale = boardPlaneScale;
    function releasePoint(hand) {
      const depth = DART_HAND_DEPTH + 9 * hand.lift;
      tip.set(0, DART_TIP * hand.scale, 0).applyQuaternion(aimingOrientation);
      const startDepth = depth + tip.z;
      return {
        x: (hand.x * planeScale(depth) + tip.x) / planeScale(startDepth),
        y: (hand.y * planeScale(depth) + tip.y) / planeScale(startDepth),
        depth: startDepth,
        scale: hand.scale,
      };
    }

    function placeTip(dart, x, y, depth, scale) {
      dart.scale.set(scale, scale * DART_LENGTH, scale);
      tip.set(0, DART_TIP * scale, 0).applyQuaternion(dart.quaternion);
      const k = planeScale(depth);
      dart.position.set(x * k - tip.x, y * k - tip.y, depth - tip.z);
    }
    const cabinetCorner = new T.Vector3(), cameraRotation = new T.Quaternion();
    const fitLimit = 0.97 * Math.tan(fov * Math.PI / 360);
    let size = 0, disposed = false, lastFrame, latestDraw;
    function refreshAxeArt() {
      lastFrame = null;
      if (latestDraw) draw(...latestDraw);
    }
    function draw(pins, hand, flight, flyingId, impact, past, ownerColor, angle, pinFans) {
      if (disposed) return;
      if (axe) latestDraw = [pins, hand, flight, flyingId, impact, past, ownerColor, angle, pinFans];
      pins = pins.filter((pin) => pin.number && pin.id !== flyingId);
      paintHoles(past);
      const w = surface.clientWidth;
      if (!w || !face.children.length) return;
      if (w !== size) {
        size = w; renderer.setSize(w, surface.clientHeight, false); lastFrame = null;
        camera.aspect = surface.clientWidth / surface.clientHeight;
        camera.updateProjectionMatrix();
      }
      const handColor = hand ? ownerColor(hand.owner) : null;
      const flightColor = flight ? ownerColor(flight.owner) : null;
      const pinColors = pins.map((pin) => ownerColor(pin.o));
      const signature = [pins.map((p) => p.id).join(), ...pinColors, handColor, flightColor, hand?.x, hand?.y, hand?.angle, hand?.orientation?.join(','), hand?.lift, hand?.aiming, flight?.u, flight?.tumble, flight?.rotation, flight?.orientation?.join(','), impact?.angle, angle.pitch, angle.yaw].join('|');
      if (signature === lastFrame) return;
      lastFrame = signature;
      const pitch = angle.pitch * -Math.PI / 180 || 0;
      const yaw = angle.yaw * -Math.PI / 180 || 0;
      const distance = cameraDistance;
      camera.position.set(
        distance * Math.cos(pitch) * Math.sin(yaw),
        distance * Math.sin(pitch),
        distance * Math.cos(pitch) * Math.cos(yaw)
      );
      camera.lookAt(VIEW_TARGET);
      if (pitch || yaw) {
        cameraRotation.copy(camera.quaternion).invert();
        let framedDistance = distance;
        // Each corner must fit both axes of the perspective frustum.
        for (const x of [-cabinetHalf - 1, cabinetHalf + 1]) {
          for (const y of [-cabinetHalf - 1, cabinetHalf + 1]) {
            for (const z of [cabinetBack - 1, cabinetFront + 1]) {
              cabinetCorner.set(x, y, z).applyQuaternion(cameraRotation);
              const extent = Math.max(Math.abs(cabinetCorner.x) / camera.aspect, Math.abs(cabinetCorner.y));
              framedDistance = Math.max(framedDistance, cabinetCorner.z + extent / fitLimit);
            }
          }
        }
        // The board sits in front of the cabinet opening and projects farther out.
        for (let i = 0; i < 32; i++) {
          const a = i * Math.PI / 16;
          cabinetCorner.set(120 * Math.cos(a), 120 * Math.sin(a), 1.2).applyQuaternion(cameraRotation);
          const extent = Math.max(Math.abs(cabinetCorner.x) / camera.aspect, Math.abs(cabinetCorner.y));
          framedDistance = Math.max(framedDistance, cabinetCorner.z + extent / fitLimit);
        }
        camera.position.multiplyScalar(framedDistance / distance);
      }
      inHand.visible = !!hand;
      if (hand) {
        inHand.userData.finMaterial.color.set(handColor ?? (axe ? defaultAxeHandleColor : defaultFinColor));
        const depth = DART_HAND_DEPTH + 9 * hand.lift;
        const k = planeScale(depth);
        inHand.position.set(hand.x * k, hand.y * k, depth);
        if (axe) {
          inHand.quaternion.set(...hand.orientation);
          placeTip(inHand, hand.x, hand.y, depth, hand.scale);
        } else if (hand.aiming) inHand.quaternion.copy(aimingOrientation);
        else inHand.rotation.set(-0.94, -0.30, -hand.angle);
        inHand.scale.set(hand.scale, hand.scale * DART_LENGTH, hand.scale);
        dartLight.position.copy(inHand.position);
        dartLight.position.addScaledVector(dartAxis, 20);
        dartLight.position.z += 31;
        dartLight.intensity = axe ? 0.30 : 1.35;
      }
      flying.visible = !!flight;
      if (flight) flying.userData.finMaterial.color.set(flightColor ?? (axe ? defaultAxeHandleColor : defaultFinColor));
      if (flight && axe) {
        flying.quaternion.set(...(flight.orientation ?? axeTumbleOrientation(flight.rotation)));
        placeTip(flying, flight.x, flight.y, flight.depth, flight.scale);
      } else if (flight?.tumble != null) {
        flying.quaternion.copy(lodgedPose(flight.x, flight.landingY, flight.id, 0, landedOrientation));
        flying.rotateX(flight.tumble * 2.1);
        flying.rotateZ(flight.tumble * 1.1);
        placeTip(flying, flight.x, flight.y, 0.45, flight.scale);
      } else if (flight) {
        // Nose follows the real path tangent (up at release, level at the apex, dipping on approach).
        const { behind, ahead } = flight, kb = planeScale(behind.depth), ka = planeScale(ahead.depth);
        // The hand sits well off to the side, so the true path is mostly sideways. A dart flies nose-first,
        // so keep the nose pointed mostly at the board and let only a small fraction of the sideways drift tilt it
        // (the dart is long, so any tilt swings its tail a long way).
        direction.set(0.12 * (ahead.x * ka - behind.x * kb), 0.2 * (ahead.y * ka - behind.y * kb), 3 * (ahead.depth - behind.depth)).normalize();
        travelOrientation.setFromUnitVectors(dartAxis, direction);
        flying.quaternion.copy(aimingOrientation).slerp(travelOrientation, smooth(flight.u / 0.14));
        flying.rotateY(flight.roll);
        flying.quaternion.slerp(lodgedPose(flight.landingX, flight.landingY, flight.id, pinFans.get(flight.id) ?? 0, landedOrientation),
          smooth((flight.u - 0.6) / 0.4));
        placeTip(flying, flight.x, flight.y, flight.depth, flight.scale);
        dartLight.position.copy(flying.position);
        dartLight.position.y += 12;
        dartLight.position.z += 30;
        dartLight.intensity = 1.15 * (1 - flight.u);
      }
      if (!hand && (!flight || flight.tumble != null)) dartLight.intensity = 0;
      while (lodged.length < pins.length) lodged.push(dart());
      lodged.forEach((obj, i) => {
        const p = pins[i];
        obj.visible = !!p;
        if (!obj.visible) return;
        obj.userData.finMaterial.color.set(pinColors[i] ?? (axe ? defaultAxeHandleColor : defaultFinColor));
        const quiver = p.id === impact?.id ? impact.angle : 0;
        if (axe) {
          const pose = axeRestPose(p, axeLodgedAngle ?? AXE_LODGED_ANGLE, quiver * 180 / Math.PI);
          obj.quaternion.set(...axeTumbleOrientation(pose.rotation));
          placeTip(obj, pose.x, pose.y, pose.depth, pose.scale);
        } else {
          obj.quaternion.copy(lodgedPose(p.x, p.y, p.id, pinFans.get(p.id) ?? 0, landedOrientation));
          if (quiver) obj.quaternion.multiply(wobble.setFromEuler(wobbleEuler.set(quiver, 0, -quiver * 0.6)));
          placeTip(obj, p.x, p.y, 0.45, DART_BOARD_SCALE);
        }
      });
      renderer.render(scene, camera);
      if (!surface.classList.contains('ar-darts-is3d')) {
        surface.classList.add('ar-darts-is3d');
        onRendererChange();
      }
      surface.classList.toggle('ar-darts-3d-numbers', axe || numbers.size > 0);
    }

    api = { paint, draw, releasePoint, setNumberTarget, dispose() {
      if (disposed) return;
      disposed = true;
      surface.classList.remove('ar-darts-is3d', 'ar-darts-3d-numbers');
      const resources = new Set([grain, wood, holes, normalNumber, goldNumber, axeWood]);
      scene.traverse(({ material, geometry }) => {
        const materials = Array.isArray(material) ? material : [material];
        for (const mat of materials) {
          if (!mat) continue;
          resources.add(mat);
          if (mat.map) resources.add(mat.map);
          if (mat.bumpMap) resources.add(mat.bumpMap);
        }
        if (geometry) resources.add(geometry);
      });
      axeReflection?.dispose();
      resources.forEach((resource) => resource?.dispose());
      lamp.shadow.map?.dispose();
      renderer.dispose(); canvas.remove();
      onRendererChange();
    } };
    return api;
  }

  function makeDartsUI() {
    const STEP = Math.PI / 10, CENTER = 125, SCALE = 98, WIDTH = 250;
    let root, score, stage, board, geometry, holeG, pins, grip, held, guide, dartModel, result, callout, hint, turn, dartIndicators, tabletop, darts3d, swipeButton, visitPanel, hintButton, aim, spreadEl, hitFlash, landing, trail, impactMark;
    const zoom = { s: 1, x: 0, y: 0 };
    const angle = { pitch: 0, yaw: 0 };
    let adjust, aimX, aimY, release, aimStatus, hintAdvice, touchListeners, aimTimer;
    let inspecting, inspectButton, tabletopResize, drag;
    let hintOn = false;
    let past = [], pastIds = new Set();
    let landingId, landingAt;
    let axeDebug, axeReadout, axeLive, axeCopyFlight, axeSliders;
    let axeTraceBody, axeTraceSummary, axeContactSummary, axeContactMarker, axeSwipeSummary, axeTraceCopy, axeTraceText, axeLogStatus;
    const showAxeDiagnostics = new URLSearchParams(window.location.search).get('axeDebug') === '1';
    let callCorner = false, cornerButton;
    let releasedSwipe, axePlacement, axeDrag, axeGrab, resetAxePosition;
    const axeStart = { ...AXE_START_POSE };
    let view, state, ctx, frame, readyAt, pending, visit, shown, flight, falling, swipe, keys, releasedFrom, waitingHand, impact;
    const xAt = (x) => CENTER + SCALE * x, yAt = (y) => CENTER - SCALE * y;
    const point = (a, r) => [CENTER + Math.sin(a) * r, CENTER - Math.cos(a) * r];
    const circle = (r, fill) => `<circle cx="125" cy="125" r="${r}" fill="${fill}"/>`;
    const player = (i) => ctx.player(view.seats[i]);
    const ownerColor = (i) => i == null ? undefined : player(i)?.color;
    const clockLabel = (number) => number == null ? 'Done' : number === 25 ? 'Bull' : String(number);
    const defaultOrigin = () => {
      const [x, y] = view.dartOrigin || [1.04, -0.55];
      return { x, y };
    };
    const origin = () => (view.axeRings && axePlacement) || defaultOrigin();
    const mine = () => view && state.phase === 'playing' && ctx.myTurn && !state.paused;
    const ready = () => mine() && !view.roundRecap && !pending && !waitingHand && !flight && performance.now() >= readyAt;
    const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const visibleImpact = (x, y) => xAt(x) >= 5 && xAt(x) <= 245 && yAt(y) >= 5 && yAt(y) <= 245;
    const transform = (x, y) => `translate(${xAt(x)} ${yAt(y)})`;
    const lodgedAngle = DART_LODGED_ANGLE;
    const pinFans = new Map();
    // Local origin is the steel tip. The flight extends below it in SVG coordinates.
    const dartSilhouette = `<path class="ar-darts-tip" d="M0 0L.23 1.6L.34 5.1H-.34L-.23 1.6Z"/>
      <path class="ar-darts-barrel" d="M-.5 5H.5L1.5 5.8V9H-1.5V5.8Z"/>
      <path class="ar-darts-shaft" d="M0 9V13"/>
      <path class="ar-darts-fin" d="M0 9.3L4 13.5Q4.3 13.9 4.1 14.5L3.5 16.8Q3.4 17.2 3 17L0 16L-3 17Q-3.4 17.2-3.5 16.8L-4.1 14.5Q-4.3 13.9-4 13.5Z"/>
      <path class="ar-darts-fin-fold" d="M0 9.3L4 13.5Q4.3 13.9 4.1 14.5L3.5 16.8Q3.4 17.2 3 17L0 16Z"/>
      <path class="ar-darts-fin-seam" d="M0 10.3V15.8"/>`;


    function sector(a, inner, outer, color) {
      const left = a - STEP / 2, right = a + STEP / 2;
      return `<path fill="${color}" d="M ${point(left, outer)} A ${outer} ${outer} 0 0 1 ${point(right, outer)}
        L ${point(right, inner)} A ${inner} ${inner} 0 0 0 ${point(left, inner)} Z"/>`;
    }

    function paintBoard() {
      if (view.axeRings) {
        const materialPattern = (id, href, x, y, width, height) => `<pattern id="${id}" x="${x}" y="${y}"
          width="${width}" height="${height}" patternUnits="userSpaceOnUse">
          <image width="${width}" height="${height}" href="${href}" preserveAspectRatio="none"/>
          </pattern>`;
        geometry.innerHTML = `<defs>
          <clipPath id="ar-axe-face"><circle cx="125" cy="125" r="${SCALE}"/></clipPath>
          <linearGradient id="ar-axe-rim" x2="20%" y2="100%">
            <stop stop-color="#bc8b59"/><stop offset=".35" stop-color="#795034"/><stop offset="1" stop-color="#382419"/>
          </linearGradient>
          <linearGradient id="ar-axe-wood-light">
            <stop stop-color="#261911"/><stop offset=".42" stop-color="#fff6e8"/><stop offset="1" stop-color="#34241a"/>
          </linearGradient>
          <linearGradient id="ar-axe-steel-light" x2="30%" y2="100%">
            <stop stop-color="#788891"/><stop offset=".46" stop-color="#404a52"/><stop offset="1" stop-color="#20282f"/>
          </linearGradient>
          <linearGradient id="ar-axe-bevel-light" x2="40%" y2="100%">
            <stop stop-color="#f4f7f9"/><stop offset=".52" stop-color="#adbcc5"/><stop offset="1" stop-color="#687d8c"/>
          </linearGradient>
          ${materialPattern('ar-axe-forged', AXE_ART.steel, -6, 0, 18, 13)}
          ${materialPattern('ar-axe-ground', AXE_ART.bevel, -6, 0, 8, 13)}
          ${materialPattern('ar-axe-hickory', AXE_ART.handle, 3, 4, 7, 23)}
          </defs>`
          + circle(101, 'url(#ar-axe-rim)')
          + circle(SCALE, '#cfa275')
          + `<g clip-path="url(#ar-axe-face)"><image href="${AXE_ART.board}" x="${125 - SCALE}" y="${125 - SCALE}"
            width="${2 * SCALE}" height="${2 * SCALE}"/></g>`
          + [...view.axeRings].reverse().map(([radius, points], index, rings) => {
            const outer = radius * SCALE;
            const inner = (rings[index + 1]?.[0] ?? 0) * SCALE;
            const mid = (outer + inner) / 2;
            return `<circle cx="125" cy="125" r="${mid}" fill="none" stroke="${ringColor(points)}"
              stroke-opacity=".5" stroke-width="${outer - inner}"/>
              <circle cx="125" cy="125" r="${outer}" fill="none" stroke="#42291b99" stroke-width=".65"/>`;
          }).join('')
          + view.axeRings.map(([radius, points]) =>
            `<text x="125" y="${125 - axeLabelRadius(radius, points) * SCALE}">${points}</text>`).join('')
          + (view.axeCorners ?? []).map(([x, y, r]) =>
            `<circle cx="${xAt(x)}" cy="${yAt(y)}" r="${r * SCALE}" fill="#30653f"/>
              <text x="${xAt(x)}" y="${yAt(y)}">7</text>`).join('');
        return;
      }
      const [bull, outer, t0, t1, d0, edge] = view.radii.map((r) => r * SCALE);
      const rings = [bull, outer, t0, t1, d0, edge]
        .map((r) => `<circle cx="125" cy="125" r="${r}"/>`).join('');
      const spokes = view.numbers.map((_, i) => {
        const angle = (i + 0.5) * STEP, [x1, y1] = point(angle, outer), [x2, y2] = point(angle, edge);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      }).join('');
      const wirePath = `<g>${rings}${spokes}</g>`;
      geometry.innerHTML = `<defs><linearGradient id="ar-darts-rim-bevel" x2="30%" y2="100%">
        <stop stop-color="#62584a"/><stop offset=".48" stop-color="#39342d"/><stop offset="1" stop-color="#171713"/>
        </linearGradient><linearGradient id="ar-darts-sisal-light" x2="68%" y2="100%">
        <stop stop-color="#fff3d9" stop-opacity=".09"/><stop offset=".48" stop-color="#fff3d9" stop-opacity="0"/>
        <stop offset="1" stop-color="#20150d" stop-opacity=".13"/>
        </linearGradient><pattern id="ar-darts-fibers" width="5" height="4" patternUnits="userSpaceOnUse">
          <path d="M.5 1l.8 .4m1.4 1.8 1 .3" stroke="#fff4d7" stroke-opacity=".24" stroke-width=".34"/>
          <path d="M2 .5l.3 .8m2.1 .4-.5 .9M.5 3l.5 .4" stroke="#170e09" stroke-opacity=".34" stroke-width=".38"/>
        </pattern></defs>`
        + circle(119, '#161714') + circle(118.5, 'url(#ar-darts-rim-bevel)')
        + circle(117, DART_RIM) + circle(115, DART_NUMBER_BAND)
        + DART_FASTENERS.map((a) => {
          const x = 125 + 115.9 * Math.cos(a), y = 125 - 115.9 * Math.sin(a);
          return `<g transform="translate(${x} ${y}) rotate(${-a * 180 / Math.PI})">
            <circle r="1.2" fill="${DART_BRASS}"/><path d="M-.75 0H.75" stroke="#211c19" stroke-width=".26"/>
            </g>`;
        }).join('')
        + '<g>' + view.numbers.map((_, i) => {
          const angle = i * STEP;
          const sisal = i % 2 ? DART_PALETTE.light : DART_PALETTE.dark;
          const stripe = i % 2 ? DART_PALETTE.green : DART_PALETTE.red;
          return `${sector(angle, outer, t0, sisal)}
            ${sector(angle, t0, t1, stripe)}${sector(angle, t1, d0, sisal)}${sector(angle, d0, edge, stripe)}`;
        }).join('') + '</g>' + circle(outer, DART_PALETTE.green) + circle(bull, DART_PALETTE.red)
        + circle(edge, 'url(#ar-darts-fibers)') + circle(edge, 'url(#ar-darts-sisal-light)')
        + `<g fill="none" class="ar-darts-wires" style="--wire-base: ${DART_WIRE_BASE}; --wire-light: ${DART_WIRE}">${wirePath}${wirePath}</g>`
        + view.numbers.map((number, i) => {
          const [x, y] = point(i * STEP, DART_NUMBER_RADIUS);
          return `<text data-number="${number}" x="${x}" y="${y}">${number}</text>`;
        }).join('');
      geometry.querySelector(':scope > circle').classList.add('ar-darts-rim');
    }

    function mount(main, side) {
      main.innerHTML = `<section class="ar-darts">
        <header><div><h2></h2><div class="ar-darts-visit"><span class="ar-darts-turn" role="status"></span>
            <span class="ar-darts-indicators" aria-hidden="true"><i></i><i></i><i></i></span></div></div>
          <div class="ar-darts-tools">
            <button type="button" class="ar-darts-inspect" aria-pressed="false" aria-label="Inspect dartboard at an angle">Inspect</button>
            <button type="button" class="ar-darts-hintbtn" aria-label="Strategy hint" aria-pressed="false">💡 Hint</button>
            <button type="button" class="ar-darts-hintbtn ar-darts-flashbtn" aria-label="Flash the section a dart hits" aria-pressed="false">✨ Flash</button>
          </div>
        </header>
        <p class="ar-darts-strip" aria-label="Scores"></p>
        <div class="ar-darts-board-wrap"><div class="ar-darts-stage"><div class="ar-darts-tabletop">
          <svg class="ar-darts-aim" viewBox="0 0 250 250" aria-hidden="true" hidden></svg>
          <div class="ar-darts-spread" aria-hidden="true" hidden></div>
          <svg class="ar-darts-trail" viewBox="0 0 250 250" aria-hidden="true" hidden>
            ${Array.from({ length: 5 }, (_, i) => `<line opacity="${(0.14 + i * 0.16).toFixed(2)}" stroke-width="${(0.55 + i * 0.23).toFixed(2)}"/>`).join('')}
          </svg>
          <svg class="ar-darts-impact" viewBox="0 0 250 250" aria-hidden="true" hidden>
            <circle r="4"/><path class="ar-darts-miss-mark" d="M-3 -3L3 3M3 -3L-3 3"/><path class="ar-darts-bull-mark" d="M0-5L5 0L0 5L-5 0Z"/>
          </svg>
          <svg class="ar-darts-landing" viewBox="0 0 250 250" aria-hidden="true" hidden
            style="--dot-hold: ${DART_DOT_HOLD}ms; --dot-fade: ${DART_DOT_FADE}ms">
            <circle r="1.8"/>
          </svg>
          <svg class="ar-darts-hitflash" viewBox="0 0 250 250" aria-hidden="true"></svg>
          <svg class="ar-darts-input" viewBox="0 0 250 250" tabindex="0" role="group"
            aria-label="Dartboard. Activate Inspect to rotate the board. Touch the right half to pick up a dart and swipe inward; with a mouse, press anywhere on the board, swipe inward and let go. With a keyboard, use arrows to aim, Shift and arrows for larger steps, Enter or Space to throw, and Escape to clear aim.">
            <g class="ar-darts-board"></g><g class="ar-darts-holes"></g><g class="ar-darts-pins"></g>
            <circle class="ar-darts-axe-contact-marker" r="3" hidden aria-hidden="true"/>
            <g class="ar-darts-grip" aria-hidden="true"><rect x="-25" y="-25" width="48" height="50" rx="14"/></g>
            <g class="ar-darts-held">
              <path class="ar-darts-direction" d="M-12 -8L0 -53L12 -8Z" hidden/>
              <g class="ar-darts-model" transform="scale(${DART_HELD_SCALE})"><g transform="translate(0 -19) scale(2.1 ${2.1 * DART_LENGTH})">${dartSilhouette}</g></g>
            </g>
            <rect class="ar-darts-axe-grab" x="-22" y="-36" width="44" height="72" rx="8" hidden
              role="group" aria-label="Axe starting position. Drag to move, or use arrow keys. Hold Shift for larger steps."></rect>
          </svg>
        </div><p class="ar-darts-axe-live" hidden></p></div><div class="ar-darts-callout" aria-hidden="true" hidden></div></div>
        <div class="ar-darts-footer">
          <p class="ar-darts-result" role="status"></p>
          <button type="button" class="ar-darts-swipe" aria-label="Swipe toward the board to throw, or press Enter to throw">Swipe to throw</button>
        </div>
        <fieldset class="ar-darts-adjust" hidden>
          <legend>Adjust aim</legend>
          <label>Horizontal aim <input class="ar-darts-aim-x" type="range" min="-100" max="100" value="0"></label>
          <label>Vertical aim <input class="ar-darts-aim-y" type="range" min="-100" max="100" value="0"></label>
          <button type="button" class="ar-darts-release">Release dart</button>
        </fieldset>
        <div class="ar-darts-axe-placement" hidden>
          <button type="button" class="ar-darts-axe-corner" aria-pressed="false" hidden>Call 7-point corner</button>
          <button type="button" class="ar-darts-axe-reset-position" disabled>Reset position</button>
        </div>
        <details class="ar-darts-axe-debug" hidden>
          <summary>Axe diagnostics</summary>
          <p class="ar-darts-axe-readout"></p>
          <p class="ar-darts-axe-pivot">${AXE_PIVOT_LABEL}</p>
          <div class="ar-darts-axe-sliders">
            ${Object.entries(AXE_START_POSE).map(([axis, value]) => `<label>
              ${axis[0].toUpperCase() + axis.slice(1)}
              <input aria-label="${axis[0].toUpperCase() + axis.slice(1)}" type="range" min="-180" max="180" step="1"
                data-axis="${axis}" value="${value}">
              <span>${value}°</span>
            </label>`).join('')}
          </div>
          <button type="button" class="ar-darts-axe-reset">Reset pose</button>
          <button type="button" class="ar-darts-axe-copy">Copy start coordinates</button>
          <button type="button" class="ar-darts-axe-copy-flight" disabled>Copy flight coordinates</button>
          <div class="ar-darts-axe-trace">
            <p class="ar-darts-axe-trace-summary">Throw to record a flight trace.</p>
            <p class="ar-darts-axe-contact-summary" hidden></p>
            <p class="ar-darts-axe-swipe-summary" hidden></p>
            <p class="ar-darts-axe-log-status" role="status"></p>
            <div class="ar-darts-axe-trace-scroll" tabindex="0" aria-label="Axe flight trace">
              <table aria-label="Axe flight trace" hidden>
                <thead><tr>${AXE_TRACE_COLUMNS.map((column) => `<th scope="col">${column}</th>`).join('')}</tr></thead>
                <tbody></tbody>
              </table>
            </div>
            <button type="button" class="ar-darts-axe-trace-copy" disabled>Copy flight trace</button>
            <textarea class="ar-darts-axe-trace-text" aria-label="Flight trace text" readonly hidden></textarea>
          </div>
          <span class="ar-darts-axe-copy-status" role="status"></span>
        </details>
        <p class="ar-darts-aim-status" role="status"></p>
        <p class="ar-darts-advice" role="status"></p>
        <div class="ar-darts-visit-card"></div>
        <p class="hint ar-darts-hint"></p>
      </section>`;
      side.innerHTML = '<div class="panel ar-darts-score-panel"><h3>Scoreboard</h3><div class="ar-darts-score"></div></div>';
      root = main.firstElementChild; score = side.querySelector('.ar-darts-score');
      const find = (name) => root.querySelector('.ar-darts-' + name);
      board = find('input'); grip = find('grip'); held = find('held');
      guide = find('direction'); dartModel = find('model'); tabletop = find('tabletop'); stage = find('stage'); swipeButton = find('swipe'); visitPanel = find('visit-card'); hintButton = find('hintbtn'); aim = find('aim'); spreadEl = find('spread'); hitFlash = find('hitflash'); landing = find('landing'); trail = find('trail'); impactMark = find('impact');
      geometry = find('board'); holeG = find('holes'); pins = find('pins'); past = []; pastIds = new Set();
      result = find('result'); callout = find('callout'); hint = find('hint'); turn = find('turn'); dartIndicators = find('indicators');
      adjust = find('adjust'); aimX = find('aim-x'); aimY = find('aim-y');
      release = find('release'); aimStatus = find('aim-status'); hintAdvice = find('advice');
      axePlacement = axeDrag = null;
      axeGrab = find('axe-grab');
      cornerButton = find('axe-corner');
      callCorner = false;
      cornerButton.addEventListener('click', () => {
        if (!ready() || !view.canCallCorner || throwInProgress()) return;
        callCorner = !callCorner;
        updateCorner();
        paintHint();
        if (view.aimControl) announceAim(adjustPayload());
      });
      resetAxePosition = find('axe-reset-position');
      resetAxePosition.addEventListener('click', () => {
        if (throwInProgress()) return;
        axePlacement = null;
        keys = null;
        resetAxePosition.disabled = true;
        updateHint();
        if (view.aimControl) announceAim(adjustPayload());
      });
      axeDebug = find('axe-debug'); axeReadout = find('axe-readout');
      axeLive = find('axe-live'); axeCopyFlight = find('axe-copy-flight');
      const trace = find('axe-trace');
      axeTraceBody = trace.querySelector('tbody');
      axeTraceSummary = find('axe-trace-summary'); axeTraceCopy = find('axe-trace-copy'); axeTraceText = find('axe-trace-text');
      axeContactSummary = find('axe-contact-summary'); axeContactMarker = find('axe-contact-marker');
      axeSwipeSummary = find('axe-swipe-summary'); axeLogStatus = find('axe-log-status');
      axeSliders = [...axeDebug.querySelectorAll('input[data-axis]')];
      for (const slider of axeSliders) {
        const axis = slider.dataset.axis;
        slider.value = axeStart[axis];
        slider.nextElementSibling.textContent = `${slider.value}°`;
        slider.addEventListener('input', () => {
          axeStart[axis] = Number(slider.value);
          slider.nextElementSibling.textContent = `${slider.value}°`;
        });
      }
      const copyStatus = find('axe-copy-status');
      const copyCoordinates = async (readout) => {
        const textField = readout instanceof HTMLTextAreaElement;
        const coordinates = textField ? readout.value : readout.textContent;
        setText(copyStatus, '');
        try {
          await navigator.clipboard.writeText(coordinates);
          setText(copyStatus, 'Copied.');
        } catch {
          const selection = window.getSelection();
          if (textField) {
            readout.hidden = false;
            readout.select();
          } else {
            const range = document.createRange();
            range.selectNodeContents(readout);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          if (document.execCommand?.('copy')) {
            selection.removeAllRanges();
            if (textField) readout.hidden = true;
            setText(copyStatus, 'Copied.');
          } else {
            setText(copyStatus, 'Coordinates selected. Copy them manually.');
          }
        }
      };
      find('axe-copy').addEventListener('click', () => {
        setText(axeReadout, axeCoordinates(waitingHand || pose()));
        copyCoordinates(axeReadout);
      });
      axeCopyFlight.addEventListener('click', () => copyCoordinates(axeLive));
      axeTraceCopy.addEventListener('click', () => copyCoordinates(axeTraceText));
      find('axe-reset').addEventListener('click', () => {
        for (const slider of axeSliders) {
          const axis = slider.dataset.axis;
          axeStart[axis] = AXE_START_POSE[axis];
          slider.value = axeStart[axis];
          slider.nextElementSibling.textContent = `${slider.value}°`;
        }
      });
      hintOn = false;
      landingId = null;
      view = null; pending = false; flight = null; falling = null; shown = null; visit = null;
      swipe = null; keys = null; releasedFrom = null; releasedSwipe = null; waitingHand = null; darts3d = null; impact = null;
      inspectButton = find('inspect');
      resetView();
      tabletopResize = window.ResizeObserver ? new ResizeObserver(applyView) : null;
      tabletopResize?.observe(tabletop);
      hintButton.addEventListener('click', () => { hintOn = !hintOn; paintHint(); });
      const flashButton = find('flashbtn');
      flashButton.setAttribute('aria-pressed', String(sectionFlashOn()));
      flashButton.addEventListener('click', () => {
        const on = !sectionFlashOn();
        try { localStorage.setItem('ar-section-flash', on ? '1' : '0'); } catch {}
        flashButton.setAttribute('aria-pressed', String(on));
        if (!on) hitFlash.classList.remove('ar-darts-lit');
      });
      inspectButton.addEventListener('click', () => {
        if (inspectButton.disabled) return;
        if (inspecting) { resetView(); return; }
        inspecting = true;
        keys = null;
        angle.pitch = 12;
        angle.yaw = -24;
        applyView();
      });
      callout.addEventListener('animationend', () => { callout.hidden = true; });
      // Track contacts across the entire document, including touches outside the board
      // and throws that start on the separate swipe button.
      touchListeners = new AbortController();
      const options = { capture: true, signal: touchListeners.signal };
      const contacts = new Set();
      let interrupted = false, adjustingPointer = null;
      const cancelThrow = (message) => {
        clearTimeout(aimTimer);
        swipe = keys = null;
        aimX.value = aimY.value = 0;
        spreadEl.hidden = true;
        setText(aimStatus, message);
      };
      document.addEventListener('pointerdown', (e) => {
        if (!contacts.size) {
          interrupted = false;
          if (adjust.contains(e.target)) adjustingPointer = e.pointerId;
        }
        if (e.pointerType !== 'touch') return;
        contacts.add(e.pointerId);
        if (contacts.size > 1) axeDrag = null;
        if (contacts.size > 1 && (swipe || adjustingPointer !== null || adjust.contains(e.target))) {
          interrupted = true;
          cancelThrow('Aim cleared. Try again.');
        }
      }, options);
      for (const event of ['pointerup', 'pointercancel']) {
        document.addEventListener(event, (e) => {
          contacts.delete(e.pointerId);
          if (event === 'pointercancel' && (swipe?.id === e.pointerId || adjustingPointer === e.pointerId)) {
            interrupted = true;
            cancelThrow('Aim cleared. Try again.');
          }
          if (adjustingPointer === e.pointerId) adjustingPointer = null;
        }, options);
      }
      adjust.addEventListener('pointerdown', (e) => {
        if (contacts.size > 1) e.preventDefault();
      });
      adjust.addEventListener('lostpointercapture', (e) => {
        if (adjustingPointer !== e.pointerId) return;
        interrupted = true;
        adjustingPointer = null;
        cancelThrow('Aim cleared. Try again.');
      });
      const updateAdjustment = () => {
        if (interrupted && contacts.size) {
          aimX.value = aimY.value = 0;
          return;
        }
        resetView();
        announceAim(adjustPayload());
      };
      for (const slider of [aimX, aimY]) {
        slider.addEventListener('input', updateAdjustment);
        slider.addEventListener('focus', updateAdjustment);
      }
      adjust.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancelThrow('Aim cleared.');
      });
      release.addEventListener('click', (e) => {
        if (swipe || contacts.size || (e.detail && interrupted)) return;
        const { dx, dy, vx, vy } = adjustPayload();
        submit(dx, dy, vx, vy);
      });
      const touches = new Map();
      let pinch = null;
      const moveAxe = (e) => {
        const drag = axeDrag;
        const x = (e.clientX - drag.clientX) / drag.scale;
        const y = (drag.clientY - e.clientY) / drag.scale;
        const last = drag.samples.at(-1);
        if (Math.hypot(x - last.x, y - last.y) * drag.scale >= 1) {
          drag.samples.push({ x, y, time: e.timeStamp });
          drag.samples = drag.samples.filter((sample) => e.timeStamp - sample.time <= AXE_FLICK_WINDOW_MS);
        }
        drag.flick = releaseFlick(drag, e.timeStamp);
        drag.cueUntil = performance.now() + AXE_FLICK_PAUSE_MS;
        if (drag.position || Math.hypot(x, y) * drag.scale >= 4) {
          drag.position = placedOrigin(drag.x + x, drag.y + y);
        }
      };
      stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !view || axeDrag) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (view.axeRings && ready() && !inspecting && !swipe && board.contains(e.target) && touches.size === 1 && contacts.size <= 1) {
          const scale = board.getBoundingClientRect().width * SCALE / WIDTH;
          if (!scale) return;
          // Each drag starts from the displayed axe, even when the pointer starts elsewhere.
          const { x, y } = pose();
          axeDrag = {
            id: e.pointerId, x, y, scale, clientX: e.clientX, clientY: e.clientY,
            samples: [{ x: 0, y: 0, time: e.timeStamp }],
          };
          stage.setPointerCapture?.(e.pointerId);
          e.preventDefault();
          return;
        }
        if (touches.size === 2) {
          if (swipe?.id !== e.pointerId && touches.has(swipe?.id)) swipe = null;
          const [a, b] = [...touches.values()];
          const bounds = stage.getBoundingClientRect();
          const cx = bounds.left + bounds.width / 2;
          const cy = bounds.top + bounds.height / 2;
          pinch = {
            d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: zoom.s, cx, cy,
            x: ((a.x + b.x) / 2 - cx - zoom.x) / zoom.s,
            y: ((a.y + b.y) / 2 - cy - zoom.y) / zoom.s,
          };
          drag = null;
          stage.setPointerCapture?.(e.pointerId);
        } else if (touches.size === 1) {
          const onBoard = board.contains(e.target);
          const bounds = board.getBoundingClientRect();
          const onGrabSide = e.clientX >= bounds.left + bounds.width / 2;
          // a mouse can pick the dart up from anywhere on the board; the right-half rule is there for stray touches
          if (onBoard && (onGrabSide || e.pointerType === 'mouse') && !view.axeRings && !inspecting && ready() && contacts.size <= 1) {
            pickUp(e);
            return;
          }
          if (!inspecting || throwInProgress()) return;
          drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ...angle, onBoard, moved: false };
          stage.setPointerCapture?.(e.pointerId);
        }
      });
      stage.addEventListener('pointermove', (e) => {
        if (axeDrag?.id === e.pointerId) {
          if (ready() && contacts.size <= 1) moveAxe(e);
          return;
        }
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (throwInProgress()) return;
        if (pinch && touches.size === 2) {
          const [a, b] = [...touches.values()];
          const scale = pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
          zoom.s = Math.max(1, Math.min(3.5, scale));
          zoom.x = (a.x + b.x) / 2 - pinch.cx - pinch.x * zoom.s;
          zoom.y = (a.y + b.y) / 2 - pinch.cy - pinch.y * zoom.s;
          applyView();
        } else if (inspecting && drag?.id === e.pointerId) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) < 8) return;
          drag.moved = true;
          keys = null;
          angle.pitch = clamp(drag.pitch - dy * 0.35, 65);
          angle.yaw = clamp(drag.yaw + dx * 0.35, 75);
          applyView();
        }
      });
      const lift = (e) => {
        if (axeDrag?.id === e.pointerId) {
          const released = e.type === 'pointerup' && ready() && contacts.size === 0;
          if (released) moveAxe(e);
          const { flick, position } = axeDrag;
          axeDrag = null;
          if (released && flick) {
            setAxePlacement(flick.origin);
            submit(flick.dx, flick.dy, flick.vx, flick.vy, pose(), null, {
              input: 'board flick', releaseWindowMs: Math.round(flick.duration),
            });
          } else if (released && position) {
            setAxePlacement(position);
          }
        }
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
        if (drag?.id !== e.pointerId) return;
        const tapped = e.type === 'pointerup' && drag.onBoard && !drag.moved
          && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8;
        drag = null;
        if (!tapped) return;
        if (inspecting && ready()) resetView();
      };
      stage.addEventListener('pointerup', lift);
      stage.addEventListener('pointercancel', lift);
      stage.addEventListener('lostpointercapture', lift);
      stage.addEventListener('dblclick', resetView);
      const pickUp = (e) => {
        if (!ready() || axeDrag || swipe || e.button !== 0 || contacts.size > 1) return;
        resetView();
        const scale = board.getBoundingClientRect().width * SCALE / WIDTH;
        if (!scale) return;
        e.preventDefault();
        keys = null;
        swipe = { id: e.pointerId, scale, x: e.clientX, y: e.clientY, samples: [], dx: 0, dy: 0, pickedAt: performance.now() };
        if (view.axeRings) swipe.capture = {
          pointer: e.pointerType || 'mouse', start: e.timeStamp,
          points: [], count: 0, path: 0, peak: 0, lastMovement: e.timeStamp,
        };
        sample(e);
        playGrip();
        board.setPointerCapture?.(e.pointerId);
      };
      swipeButton.addEventListener('pointerdown', pickUp);
      board.addEventListener('pointermove', (e) => {
        if (swipe?.id !== e.pointerId) return;
        sample(e);
        clearTimeout(aimTimer);
        if (view.axeRings) announceAim(swipePayload());
        else aimTimer = setTimeout(() => { if (swipe) announceAim(swipePayload()); }, 180);
      });
      board.addEventListener('pointerup', (e) => {
        if (swipe?.id !== e.pointerId) return;
        sample(e);
        clearTimeout(aimTimer);
        const { dx, dy, vx, vy } = swipePayload();
        const hand = pose();
        const from = view.axeRings ? hand : darts3d?.releasePoint(hand) ?? {
          x: hand.x - 0.04,
          y: hand.y + 0.12,
          depth: DART_HAND_DEPTH + 9 * hand.lift - 18 * DART_LENGTH * hand.scale,
          scale: hand.scale,
        };
        const swipeStats = swipe.capture && axeSwipeStats();
        swipe = null;
        if ((!axePlacement && dx > -0.05) || Math.hypot(dx, dy) < (view.axeRings ? 0.18 : 0.1)) {
          setText(aimStatus, view.axeRings ? 'Make a longer swipe toward your target.' : 'Swipe inward to throw. Try again.');
          return;
        }
        submit(dx, dy, vx, vy, from, hand, swipeStats);
      });
      const cancelSwipe = (e) => {
        if (swipe?.id === e.pointerId) cancelThrow('Aim cleared. Try again.');
      };
      board.addEventListener('pointercancel', cancelSwipe);
      board.addEventListener('lostpointercapture', cancelSwipe);
      const clearKeys = () => {
        if (keys) setText(aimStatus, '');
        keys = null;
      };
      board.addEventListener('blur', clearKeys);
      swipeButton.addEventListener('blur', clearKeys);
      root.addEventListener('keydown', (e) => {
        if (!ready() || axeDrag || swipe || contacts.size) return;
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (e.target === axeGrab) {
          if (delta && !inspecting) {
            e.preventDefault();
            const start = pose(), step = e.shiftKey ? 0.20 : 0.02;
            setAxePlacement(placedOrigin(start.x + step * delta[0], start.y + step * delta[1]));
          }
          return;
        }
        if (e.target !== board && e.target !== swipeButton) return;
        if (e.key === 'Escape') { cancelThrow('Aim cleared.'); resetView(); return; }
        if (delta) {
          e.preventDefault();
          if (inspecting || zoom.s !== 1) resetView();
          keys ??= { dx: -origin().x, dy: -origin().y };
          const step = e.shiftKey ? 0.20 : 0.02;
          keys.dx = Math.max(-2.5, Math.min(axePlacement ? 2.5 : -0.05, keys.dx + step * delta[0]));
          keys.dy = clamp(keys.dy + step * delta[1], 1.5);
          announceAim(throwPayload(keys.dx, keys.dy, -view.swipePace, 0));
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) submit(keys?.dx ?? -origin().x, keys?.dy ?? -origin().y, -view.swipePace, 0);
        }
      });
      const surface = tabletop;
      if (window.WebGLRenderingContext || window.WebGL2RenderingContext) {
        window.GL3?.load().then(() => {
          if (tabletop !== surface || !surface.isConnected) return;
          darts3d = makeDarts3d(surface, applyView);
          if (darts3d && view) {
            darts3d.paint(view);
            darts3d.setNumberTarget(view.nextNumbers?.[view.next]);
          }
        }).catch(() => {});
      }
      frame = requestAnimationFrame(tick);
    }

    function placedOrigin(x, y) {
      const edge = CENTER / SCALE;
      return { x: clamp(x, edge), y: clamp(y, edge), placed: true };
    }

    function releaseFlick(drag, time) {
      const last = drag.samples.at(-1);
      if (time - last.time > AXE_FLICK_PAUSE_MS) return null;
      let path = 0, flick = null;
      for (let i = drag.samples.length - 2; i >= 0; i--) {
        const start = drag.samples[i], next = drag.samples[i + 1];
        path += Math.hypot(next.x - start.x, next.y - start.y);
        const dx = last.x - start.x, dy = last.y - start.y;
        const distance = Math.hypot(dx, dy);
        const duration = Math.max(32, last.time - start.time);
        if (distance < AXE_FLICK_MIN_DISTANCE || distance * drag.scale < 14 || distance < 0.85 * path
          || distance * 1000 / duration < AXE_FLICK_MIN_SPEED) continue;
        const origin = placedOrigin(drag.x + start.x, drag.y + start.y);
        flick = { origin, dx, dy, vx: dx * 1000 / duration, vy: dy * 1000 / duration, duration };
      }
      return flick;
    }

    function setAxePlacement(position) {
      axePlacement = position;
      keys = null;
      resetAxePosition.disabled = false;
      updateHint();
    }

    function updateCorner() {
      cornerButton.hidden = !(mine() && view.canCallCorner);
      cornerButton.disabled = !ready() || throwInProgress();
      cornerButton.setAttribute('aria-pressed', String(callCorner));
    }

    function paintHint() {
      const hint = callCorner
        ? { x: view.axeCorners[1][0], y: view.axeCorners[1][1], label: '7-point corner', reason: 'Either green target scores.' }
        : view?.hint;
      hintButton.hidden = !state?.hintsOk;
      hintButton.setAttribute('aria-pressed', String(hintOn));
      setText(hintAdvice, hintOn && hint ? `Aim for ${hint.label}. ${hint.reason ?? ''}`.trim() : '');
      hintButton.textContent = hintOn && hint ? `💡 Aim: ${hint.label}` : '💡 Hint';
      // the target itself lights up, in its own shape, then fades away; a new target or a new dart lights it again
      const shape = hint && state?.hintsOk ? sectionShape(hint.x, hint.y) : '';
      if (aim.dataset.shape !== shape) {
        aim.dataset.shape = shape;
        aim.innerHTML = shape;
        for (const anim of aim.getAnimations?.() ?? []) { anim.cancel(); anim.play(); }
      }
    }

    function throwInProgress() {
      return !!(axeDrag || swipe || waitingHand || pending || (flight && flight.shot.o === view.me));
    }

    function fitFlatTilt() {
      const half = tabletop.offsetWidth / 2;
      if (!half) return 1;
      const pitch = angle.pitch * Math.PI / 180, yaw = angle.yaw * Math.PI / 180;
      let extent = half;
      for (const x of [-half, half]) {
        for (const y of [-half, half]) {
          const turnedZ = -x * Math.sin(yaw);
          const vertical = y * Math.cos(pitch) - turnedZ * Math.sin(pitch);
          const depth = y * Math.sin(pitch) + turnedZ * Math.cos(pitch);
          const perspective = 950 / (950 - depth);
          extent = Math.max(extent, perspective * Math.max(Math.abs(x * Math.cos(yaw)), Math.abs(vertical)));
        }
      }
      return Math.min(1, 0.97 * half / extent);
    }

    function applyView() {
      const mx = (zoom.s - 1) * tabletop.offsetWidth / 2, my = (zoom.s - 1) * tabletop.offsetHeight / 2;
      zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
      zoom.y = Math.max(-my, Math.min(my, zoom.y));
      const tilted = inspecting && !tabletop.classList.contains('ar-darts-is3d');
      const zoomTransform = zoom.s > 1 ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : '';
      const tiltTransform = tilted ? `scale(${fitFlatTilt()}) perspective(950px) rotateX(${angle.pitch}deg) rotateY(${angle.yaw}deg)` : '';
      tabletop.style.transform = `${zoomTransform} ${tiltTransform}`.trim();
      stage.classList.toggle('ar-darts-inspecting', inspecting);
      inspectButton.setAttribute('aria-pressed', String(inspecting));
      inspectButton.textContent = inspecting ? 'Front view' : 'Inspect';
      inspectButton.setAttribute('aria-label', inspecting ? 'Return to front view' : view?.axeRings ? 'Inspect axe target at an angle' : 'Inspect dartboard at an angle');
    }

    function resetView() {
      drag = null;
      zoom.s = 1; zoom.x = 0; zoom.y = 0;
      angle.pitch = 0; angle.yaw = 0;
      inspecting = false;
      applyView();
    }

    function throwPayload(dx, dy, vx, vy) {
      return { dx: clamp(dx, 2.5), dy: clamp(dy, 3.2), vx: clamp(vx, 6), vy: clamp(vy, 6) };
    }

    function setText(element, text) {
      if (element.textContent !== text) element.textContent = text;
    }

    // (#336) Aim and release takes timing: the aim drifts round the spot the sliders set, in a loose figure that never
    // quite repeats, and the dart goes where the ring is at the moment of release
    function aimSway(now = performance.now()) {
      const a = (!view.axeRings && view.aimSway) || 0;
      if (!a) return { x: 0, y: 0 };
      const t = now / 1000;
      return { x: a * (0.8 * Math.sin(t * 3.5) + 0.2 * Math.sin(t * 8.3 + 1)), y: a * (0.75 * Math.sin(t * 4.7 + 2) + 0.25 * Math.sin(t * 2.1)) };
    }

    function adjustPayload() {
      const { x, y } = origin(), drift = aimSway();
      const dx = Number(aimX.value) / 100 + drift.x - x;
      return throwPayload(axePlacement ? dx : Math.min(-0.05, dx), Number(aimY.value) / 100 + drift.y - y, 0, 0);
    }

    function announceAim({ dx, dy, vx, vy }) {
      const o = origin(), x = o.x + dx, y = o.y + dy;
      const [inner, outer, tripleIn, tripleOut, doubleIn] = view.radii;
      const radius = Math.hypot(x, y);
      const wedge = Math.floor(Math.atan2(x, y) / (Math.PI / 10) + 0.5);
      const number = view.numbers[(wedge + 20) % 20];
      const axeRing = view.axeRings?.find(([edge]) => radius <= edge);
      const corner = view.axeCorners?.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r);
      const target = view.axeRings ? (callCorner ? (corner ? '7-point corner' : 'Aim for a green corner')
        : corner ? 'Corner requires a call' : axeRing ? `${axeRing[1]}-point ring` : 'Off board') : radius > 1 ? 'Off board' : radius <= inner ? 'Bull' : radius <= outer ? 'Outer bull'
        : number == null ? 'Board' : `${radius >= doubleIn ? 'Double' : radius >= tripleIn && radius <= tripleOut ? 'Triple' : 'Single'} ${number}`;
      const spread = 2 * (view.spreadBase + view.spreadPerPace * Math.hypot(vx, vy));
      const blade = axeBladeFeedback(vx, vy, radius <= 1);
      setText(aimStatus, `${target}. Spread radius ${Math.round(spread * 100)}% of the board radius.${blade ? ` ${blade}.` : ''}`);
    }

    function axeBladeFeedback(vx, vy, onBoard) {
      const spin = axeSwipeSpin(vx, vy);
      if (!spin) return '';
      if (!onBoard) return 'Move aim onto the target';
      if (spin.angle < -spin.limit) return 'Too little rotation · flick faster';
      if (spin.angle > spin.limit) return 'Too much rotation · ease off';
      return `Blade-first · ${Math.round(spin.angle)}° from ideal`;
    }

    function axeSwipeSpin(vx, vy) {
      const limit = view.axeStickAngle ?? 30;
      if (view.axeSpin) {
        const { referenceSpeed, referenceRate, rateGain, airBaseMs, airMinMs, airMsPerSpeed } = view.axeSpin;
        const drive = Math.hypot(vx, vy) || referenceSpeed;
        const airMs = Math.round(Math.max(airMinMs, airBaseMs - drive * airMsPerSpeed));
        const rate = referenceRate + rateGain * (drive - referenceSpeed);
        return { limit, angle: rate * airMs / 1000 - (360 - (view.axeLodgedAngle ?? AXE_LODGED_ANGLE)) };
      }
      if (!view.axeStickSpeed) return null;
      const [low, high] = view.axeStickSpeed;
      const steady = (low + high) / 2;
      const drive = Math.hypot(vx, vy) || steady;
      return { limit, angle: limit * (drive - steady) / ((high - low) / 2) };
    }

    function swipeReleaseVelocity() {
      const [first, next] = swipe.samples;
      const last = swipe.samples.at(-1);
      let { x, y, t } = first;
      const cutoff = last.t - AXE_RELEASE_WINDOW_MS;
      if (swipe.capture && next && t < cutoff) {
        const weight = (cutoff - t) / (next.t - t);
        x += (next.x - x) * weight;
        y += (next.y - y) * weight;
        t = cutoff;
      }
      const windowMs = Math.max(32, last.t - t);
      return { vx: 1000 * (last.x - x) / windowMs, vy: 1000 * (last.y - y) / windowMs, windowMs };
    }

    function swipePayload() {
      const { vx, vy } = swipeReleaseVelocity();
      return throwPayload(swipe.dx, swipe.dy, swipe.capture && !vx && !vy ? -0.001 : vx, vy);
    }

    function sample(e) {
      const dx = (e.clientX - swipe.x) / swipe.scale, dy = (swipe.y - e.clientY) / swipe.scale;
      const capture = swipe.capture;
      if (capture) {
        const last = capture.points.at(-1);
        if (last) {
          const step = Math.hypot(dx - last[1], dy - last[2]);
          const seconds = Math.max(0.008, (e.timeStamp - capture.start - last[0]) / 1000);
          if (step > 0) capture.lastMovement = e.timeStamp;
          capture.path += step;
          capture.peak = Math.max(capture.peak, step / seconds);
        }
        capture.points.push([e.timeStamp - capture.start, dx, dy]);
        capture.count++;
        if (capture.points.length > 64) capture.points.splice(1, 1);
      }
      swipe.dx = dx; swipe.dy = dy;
      swipe.samples.push({ t: e.timeStamp, x: dx, y: dy });
      // Keep one axe sample before the cutoff to interpolate the start of the release window.
      const cutoff = e.timeStamp - (capture ? AXE_RELEASE_WINDOW_MS : 105);
      while (swipe.samples.length > 2 && swipe.samples[capture ? 1 : 0].t < cutoff) swipe.samples.shift();
    }

    function axeSwipeStats() {
      const capture = swipe.capture;
      const last = swipe.samples.at(-1);
      const { vx, vy, windowMs } = swipeReleaseVelocity();
      const round = (value) => Number(value.toFixed(3));
      const durationMs = Math.round(last.t - capture.start);
      return {
        input: capture.pointer,
        durationMs, pathLength: round(capture.path),
        meanSpeed: round(1000 * capture.path / Math.max(1, durationMs)),
        peakSpeed: round(capture.peak), sampleCount: capture.count,
        releaseWindowMs: Math.round(windowMs), releaseFilterMs: AXE_RELEASE_WINDOW_MS,
        rawReleaseVx: round(vx), rawReleaseVy: round(vy),
        releasePauseMs: Math.round(last.t - capture.lastMovement),
        samples: capture.points.map(([time, x, y]) => [Math.round(time), round(x), round(y)]),
      };
    }

    function submit(dx, dy, vx, vy, from = origin(), hand = null, swipeStats = null) {
      if (!ready() || axeDrag) return;
      resetView();
      const surface = tabletop;
      pending = true;
      landing.setAttribute('hidden', '');
      clearImpact();
      keys = null;
      hintOn = false;
      paintHint();
      clearTimeout(aimTimer);
      setText(aimStatus, '');
      releasedFrom = from;
      if (view.axeRings) releasedSwipe = {
        input: vx || vy ? 'keyboard' : 'adjusted',
        ...swipeStats, dx, dy, vx, vy, distance: Math.hypot(dx, dy), speed: Math.hypot(vx, vy),
      };
      waitingHand = hand && { ...hand, owner: view.me, until: performance.now() + 1800 };
      playRelease(Math.hypot(vx, vy));
      const payload = throwPayload(dx, dy, vx, vy);
      if (callCorner) payload.axeCorner = true;
      if (view.axeRings && axePlacement) payload.axeOrigin = [axePlacement.x, axePlacement.y];
      ctx.quiet(ctx.act('throw', payload).catch((error) => {
        if (tabletop === surface) {
          waitingHand = null; releasedFrom = null; releasedSwipe = null; paintLanding();
          setText(aimStatus, 'Throw failed. Try again.');
        }
        throw error;
      }).finally(() => { if (tabletop === surface) pending = false; }));
    }

    function paintAxeTrace(shot, rows = [], stroke, contact) {
      const summary = stroke ? [
        stroke.input,
        stroke.durationMs == null ? '' : `${stroke.durationMs} ms · ${stroke.sampleCount} samples`,
        `ΔX ${stroke.dx.toFixed(2)} · ΔY ${stroke.dy.toFixed(2)}`,
        `Release VX ${stroke.vx.toFixed(2)} · VY ${stroke.vy.toFixed(2)}`,
        stroke.releaseWindowMs == null ? '' : `Speed measured over ${stroke.releaseWindowMs} ms`,
        stroke.pathLength == null ? '' : `Path ${stroke.pathLength} · Mean ${stroke.meanSpeed} · Peak ${stroke.peakSpeed} · Release pause ${stroke.releasePauseMs} ms`,
      ].filter(Boolean).join(' · ') : '';
      axeSwipeSummary.hidden = !summary;
      setText(axeSwipeSummary, summary ? `Swipe · ${summary}` : '');
      const speed = rows.length && shot.axeSpinRate != null ? ` · ${Math.round(shot.axeSpinRate)}°/s` : '';
      const result = rows.length ? `Flight trace · ${shot.label} · ${shot.value} points${speed}` : 'Throw to record a flight trace.';
      setText(axeTraceSummary, result);
      const boardPoint = contact?.boardPoint;
      const contactDetails = boardPoint ? `Contact · edge ${contact.edge.index + 1}${contact.edge.midpoint ? ' midpoint' : ''} · Blade ${contact.edge.point.map((axis) => axis.toFixed(2)).join(', ')} · X ${boardPoint.x.toFixed(3)} · Y ${boardPoint.y.toFixed(3)} · Z ${boardPoint.z.toFixed(3)} · ${contact.timeMs} ms · Pitch ${contact.pitch.toFixed(1)}° · Heading ${contact.heading}° · Clearance ${contact.clearance.toFixed(3)}`
        : contact ? 'Contact · shot passed the board plane' : '';
      const shadow = contact?.shadow;
      const prediction = contact ? (shadow
        ? `Collision estimate · ${shadow.feature} · ${shadow.timeMs} ms · Approach ${shadow.approachSpeed.toFixed(2)} radii/s · Pitch error ${shadow.angleError.toFixed(1)}° · ${contact.predictedResult}`
        : 'Collision estimate · no target contact') : '';
      axeContactSummary.hidden = !contactDetails;
      setText(axeContactSummary, [contactDetails, prediction].filter(Boolean).join('\n'));

      axeTraceBody.replaceChildren(...rows.map((row) => {
        const tr = document.createElement('tr');
        for (const value of row) tr.insertCell().textContent = value;
        return tr;
      }));
      axeTraceBody.closest('table').hidden = !rows.length;
      axeTraceBody.closest('div').hidden = !rows.length;
      axeTraceCopy.disabled = !rows.length;
      axeTraceText.hidden = true;
      axeTraceText.value = rows.length ? [result, ...(summary ? [`Swipe · ${summary}`] : []), AXE_TRACE_AXES, AXE_PIVOT_LABEL, contactDetails, prediction, AXE_TRACE_COLUMNS.join('\t'),
        ...rows.map((row) => row.join('\t'))].join('\n') : '';
    }

    function axePosition({ x, y, depth }) {
      return `X ${x.toFixed(2)} · Y ${y.toFixed(2)} · Z ${(depth / SCALE).toFixed(2)}`;
    }

    function axeCoordinates(hand) {
      return `${axePosition({ ...hand, depth: DART_HAND_DEPTH + 9 * hand.lift })} · Pitch ${axeStart.pitch}° · Roll ${axeStart.roll}° · Yaw ${axeStart.yaw}°`;
    }

    function pose(now = performance.now()) {
      const flick = axeDrag && now <= axeDrag.cueUntil ? axeDrag.flick : null;
      const start = flick?.origin ?? axeDrag?.position ?? origin(), dx = swipe?.dx ?? 0, dy = swipe?.dy ?? 0;
      const lift = swipe ? 1 - (1 - (reduce() ? 1 : c01((now - swipe.pickedAt) / 160))) ** 3 : 0;
      const x = start.x + (0.56 - start.x) * lift + dx * (1 - 0.18 * lift);
      const y = start.y + (-0.18 - start.y) * lift + dy * (1 - 0.18 * lift);
      const angle = keys ? Math.atan2(keys.dx, keys.dy) : Math.atan2(-start.x, -start.y);
      const scale = DART_HELD_SCALE + (DART_AIM_SCALE - DART_HELD_SCALE) * lift;
      if (view.axeRings) {
        let orientation = axeStartOrientation(axeStart);
        const forward = c01(start.placed ? Math.hypot(dx, dy) : -dx);
        if (swipe) {
          const { vx, vy } = swipePayload();
          const drive = c01(Math.hypot(vx, vy) / 6);
          orientation = pitchAxe(orientation, -95 * forward * drive * lift);
        }
        if (start.placed) {
          const edge = CENTER / SCALE;
          return { x: clamp(start.x + clamp(dx * 0.28, 0.24), edge),
            y: clamp(start.y + clamp(dy * 0.35, 0.30), edge), placed: true,
            angle: 0, orientation, lift, scale: AXE_SCALE, aiming: !!swipe, owner: view.next };
        }
        // Follow the drag near the pickup, then ease into the edge of the throwing area.
        const carryX = 0.28 * (1 - Math.exp(-2.7 * forward));
        const carryY = clamp(dy * 0.55, 0.30);
        return { x: clamp(start.x, 0.86) - carryX + 0.08 * c01(2 * dx),
          y: clamp(start.y + 0.22 * lift + carryY, 0.68),
          angle: 0, orientation, lift, scale: AXE_SCALE, aiming: !!swipe, owner: view.next };
      }
      return { x: clamp(x, 1.2), y: clamp(y, 1.1), angle, lift, scale, aiming: !!swipe, owner: view.next };
    }

    function playGrip() {
      window.Snd?.play((t, K) => {
        const dst = K.at({ room: 'room', send: 0.24, vol: 0.2 });
        K.burst(dst, t, { type: 'lowpass', f: 700, vol: 0.1, tau: 0.015, buf: 'brown' });
      });
    }

    function playRelease() {
      window.Snd?.play((t, K) => {
        const dst = K.at({ room: 'room', send: 0.12, vol: 0.16 });
        K.burst(dst, t, { type: 'lowpass', f: 420, vol: 0.1, tau: 0.02, buf: 'brown' });
      });
    }

    function playLanding(shot) {
      const axe = !!view.axeRings;
      if (axe && !shot.number && !shot.axeBounce) return;
      window.Snd?.play((t, K) => {
        if (axe) {
          const dst = K.at({ room: 'room', send: 0.27, pan: clamp(shot.x * 0.65, 0.9), vol: 0.65 });
          if (shot.number) {
            K.burst(dst, t, { type: 'lowpass', f: 1050, vol: 0.45, tau: 0.027, buf: 'brown' });
            K.mode(dst, t, 144, 0.17, 0.064);
          } else {
            K.burst(dst, t, { type: 'bandpass', f: 1950, q: 2, vol: 0.26, tau: 0.015 });
            K.mode(dst, t, 310, 0.12, 0.05);
          }
          return;
        }
        const hit = !!shot.number;
        const dst = K.at({ room: 'room', send: 0.35, pan: clamp(shot.x * 0.65, 0.9), vol: 0.65 });
        K.burst(dst, t, { type: 'lowpass', f: hit ? 1550 : 560, vol: 0.28, tau: 0.016, buf: 'brown' });
        if (hit) {
          K.mode(dst, t, 180, 0.1, 0.035);
          K.burst(dst, t, { type: 'bandpass', f: 3200, q: 2.5, vol: 0.13, tau: 0.009 });
        } else {
          K.mode(dst, t + 0.038, 420, 0.075, 0.042);
          K.mode(dst, t + 0.076, 510, 0.033, 0.026);
        }
      });
    }

    // Light up the exact section the dart landed in, briefly.
    function sectionFlashOn() {
      try { return localStorage.getItem('ar-section-flash') === '1'; } catch { return false; }
    }

    // The outline of the section under (x, y): `shot` names it for a dart that landed, a hint only gives the point.
    function sectionShape(x, y, shot = null) {
      const [bull, outer, t0, t1, d0, edge] = view.radii.map((r) => r * SCALE);
      const r = Math.hypot(x, y) * SCALE;
      if (view.axeRings) {
        const corner = (view.axeCorners ?? []).find(([cx, cy, radius]) => Math.hypot(x - cx, y - cy) <= radius);
        if (shot ? shot.value === 7 && view.axeCorners : corner) {
          const [cx, cy, radius] = shot ? view.axeCorners[shot.x > 0 ? 1 : 0] : corner;
          return `<circle cx="${xAt(cx)}" cy="${yAt(cy)}" r="${radius * SCALE}"/>`;
        }
        const index = view.axeRings.findIndex(([limit, points]) => (shot ? points === shot.value : r <= limit * SCALE));
        if (index < 0) return '';
        const out = view.axeRings[index][0] * SCALE;
        const inner = (view.axeRings[index - 1]?.[0] ?? 0) * SCALE;
        return inner ? `<circle cx="125" cy="125" r="${(out + inner) / 2}"
          style="fill:none;stroke:#fff2b8;stroke-width:${out - inner};stroke-opacity:.42"/>`
          : `<circle cx="125" cy="125" r="${out}"/>`;
      }
      const number = shot ? shot.number : r > edge ? null : r <= outer ? 25
        : view.numbers[(Math.round(Math.atan2(x, y) / STEP) + 20) % 20];
      const multiplier = shot ? shot.multiplier : r <= bull ? 2 : r >= d0 ? 2 : r >= t0 && r <= t1 ? 3 : 1;
      if (number === 25) return multiplier === 2 ? `<circle cx="125" cy="125" r="${bull}"/>`
        : `<path fill-rule="evenodd" d="M${CENTER - outer} ${CENTER}a${outer} ${outer} 0 1 0 ${outer * 2} 0a${outer} ${outer} 0 1 0 ${-outer * 2} 0ZM${CENTER - bull} ${CENTER}a${bull} ${bull} 0 1 0 ${bull * 2} 0a${bull} ${bull} 0 1 0 ${-bull * 2} 0Z"/>`;
      const i = view.numbers.indexOf(number);
      if (i < 0) return '';
      const [inner, outerR] = multiplier === 2 ? [d0, edge]
        : multiplier === 3 ? [t0, t1] : r < (t0 + t1) / 2 ? [outer, t0] : [t1, d0];
      return sector(i * STEP, inner, outerR, '');
    }

    function flashSection(shot) {
      hitFlash.innerHTML = '';
      if (!sectionFlashOn()) return;
      if (view.axeRings ? !shot.value : !shot.number) return;
      const shape = sectionShape(shot.x, shot.y, shot);
      if (!shape) return;
      hitFlash.innerHTML = shape + (reduce() ? '' :
        `<circle class="ar-darts-impact-ring" cx="${xAt(shot.x)}" cy="${yAt(shot.y)}" r="5"/>`);
      hitFlash.classList.remove('ar-darts-lit');
      void hitFlash.getBoundingClientRect();
      hitFlash.classList.add('ar-darts-lit');
    }

    function paintLanding() {
      const shot = view.shot;
      const visible = !!shot?.number && !flight && view.darts.some((dart) => dart.id === shot.id);
      if (!visible) {
        landing.setAttribute('hidden', '');
        return;
      }
      if (landingId === shot.id) return;
      landingId = shot.id;
      landingAt = performance.now();
      landing.firstElementChild.setAttribute('transform', transform(shot.x, shot.y));
      landing.removeAttribute('hidden');
    }

    function clearImpact() {
      callout.hidden = true;
      callout.classList.remove('ar-darts-flash');
      hitFlash.classList.remove('ar-darts-lit');
      impactMark.setAttribute('hidden', '');
      impactMark.classList.remove('ar-darts-impact-active');
    }

    function flashHit(shot) {
      clearImpact();
      flashSection(shot);
      const x = xAt(shot.x), y = yAt(shot.y);
      if (visibleImpact(shot.x, shot.y)) {
        impactMark.dataset.kind = shot.number === 25 ? 'bull' : shot.number ? 'hit' : 'miss';
        const [ring, cross, diamond] = impactMark.children;
        ring.setAttribute('cx', x);
        ring.setAttribute('cy', y);
        cross.setAttribute('transform', transform(shot.x, shot.y));
        diamond.setAttribute('transform', transform(shot.x, shot.y));
        impactMark.removeAttribute('hidden');
        void impactMark.getBoundingClientRect();
        impactMark.classList.add('ar-darts-impact-active');
      }
      callout.textContent = shot.bust ? 'Bust' : view.axeRings && !shot.value ? `${shot.label} · 0 points` : hitName(shot);
      // #21 a colour and an icon for each kind of hit
      const tone = shot.bust ? 'bust' : (view.axeRings ? !shot.value : !shot.number) ? 'miss'
        : view.axeRings ? (shot.value >= 5 ? 'bull' : 'single') : shot.number === 25 ? 'bull'
          : ['', 'single', 'double', 'triple'][shot.multiplier];
      callout.dataset.tone = tone;
      callout.dataset.icon = { bust: '💥', miss: '💨', single: '🎯', double: '✨', triple: '🔥', bull: '🐂' }[tone];
      callout.hidden = false;
      void callout.offsetWidth;
      callout.classList.add('ar-darts-flash');
    }

    function hitName(shot) {
      if (view.axeRings) return shot.label;
      const prefix = ['', 'Single', 'Double', 'Triple'][shot.multiplier];
      return shot.number && shot.number !== 25 ? `${prefix} ${shot.number}` : shot.label;
    }

    function showShot(shot) {
      const pieces = [shot.bust ? 'Bust' : hitName(shot)];
      if (shot.bust) pieces.push('Score restored');
      else if (shot.win) pieces.push(view.x01 ? 'Checkout!' : view.mode === 'clock' ? 'Clock complete!' : 'Winner');
      else if (view.mode === 'clock') pieces.push(`Next: ${clockLabel(view.nextNumbers[shot.o])}`);
      else if (view.mode === 'cricket') {
        if (shot.marks) pieces.push(`+${shot.marks} marks`);
        if (shot.gain) pieces.push(`+${shot.gain} pts`);
      } else if (view.axeRings) {
        if (!shot.value) pieces.push('0 points');
      }
      else if (shot.number) pieces.push(String(shot.value));
      result.dataset.tone = shot.bust || (view.axeRings ? !shot.value : !shot.number) ? 'miss' : '';
      result.textContent = pieces.join(' · ');
    }

    function tick(now) {
      frame = requestAnimationFrame(tick);
      if (!view) return;
      if (waitingHand && now >= waitingHand.until) waitingHand = null;
      if (!landing.hasAttribute('hidden') && now - landingAt >= DART_DOT_HOLD + (reduce() ? 0 : DART_DOT_FADE)) {
        landing.setAttribute('hidden', '');
      }
      const show = ready();
      if (!show) axeDrag = null;
      const hand = waitingHand || pose(now);
      const drawHand = !inspecting && !flight && (show || !!waitingHand || (!!view.axeRings && axeDebug.open && !falling));
      if (view.axeRings && axeDebug.open) setText(axeReadout, axeCoordinates(hand));
      const movingAxe = !!axeDrag;
      const canGrab = !!view.axeRings && show && !inspecting && !swipe;
      axeGrab.toggleAttribute('hidden', !canGrab);
      if (canGrab) {
        axeGrab.setAttribute('tabindex', '0');
        axeGrab.setAttribute('transform', transform(hand.x, hand.y));
      } else axeGrab.removeAttribute('tabindex');
      if (view.axeRings) {
        resetAxePosition.disabled = !axePlacement || throwInProgress();
        updateCorner();
      }
      inspectButton.disabled = throwInProgress();
      grip.toggleAttribute('hidden', !show || !!swipe || inspecting || movingAxe || !!view.axeRings);
      swipeButton.disabled = !show || movingAxe;
      release.setAttribute('aria-disabled', String(!show || !!swipe || movingAxe));
      aimX.disabled = aimY.disabled = !mine();
      hintButton.disabled = !show;
      const readyFlick = axeDrag && now <= axeDrag.cueUntil ? axeDrag.flick : null;
      const preview = readyFlick || (show && !inspecting && !movingAxe && (swipe ? swipePayload()
        : keys ? throwPayload(keys.dx, keys.dy, -view.swipePace, 0) : view.aimControl && adjustPayload()));
      spreadEl.hidden = !preview;
      if (preview) {
        const o = readyFlick?.origin ?? origin();
        const pace = Math.hypot(preview.vx, preview.vy);
        const radius = 2 * (view.spreadBase + view.spreadPerPace * pace);
        spreadEl.style.left = `${xAt(o.x + preview.dx) / WIDTH * 100}%`;
        spreadEl.style.top = `${yAt(o.y + preview.dy) / WIDTH * 100}%`;
        spreadEl.style.width = `${2 * radius * SCALE / WIDTH * 100}%`;
      }
      aim.toggleAttribute('hidden', !(hintOn && view.hint && show));  // hiding and showing restarts the fade
      swipeButton.hidden = !!view.roundRecap;
      held.toggleAttribute('hidden', !drawHand);
      guide.toggleAttribute('hidden', hand.aiming || !!view.axeRings);
      const handAngle = hand.angle * 180 / Math.PI;
      held.setAttribute('transform', view.axeRings ? axeTransform(hand.x, hand.y, 0, 1, hand.orientation, DART_HAND_DEPTH + 9 * hand.lift)
        : `${transform(hand.x, hand.y)} rotate(${handAngle})`);
      dartModel.style.setProperty('--dart-color', ownerColor(hand.owner) ?? '#ffe198');
      dartModel.setAttribute('transform', view.axeRings ? `scale(${hand.scale} ${hand.scale * DART_LENGTH})` : hand.aiming
        ? `rotate(${-handAngle - 12}) scale(${hand.scale}, ${hand.scale * 0.39})` : `scale(${hand.scale})`);
      let throwPose = null;
      trail.toggleAttribute('hidden', !flight || reduce());
      if (flight) {
        const { shot, dot, from: start, duration } = flight;
        const windup = flight.axeTrajectory?.windupMs ?? 0;
        const elapsed = now - flight.start;
        const airTime = duration - windup;
        const time = reduce() ? 1 : c01((elapsed - windup) / airTime);
        const dx = shot.x - start.x, dy = shot.y - start.y;
        const pace = shot.pace ?? 2.2;
        // Gravity bows the path above the straight line: slow, lobbed throws arc higher than hard flicks.
        const lift = (0.04 + 0.07 * (1 - c01(pace / 6))) * Math.min(1.4, 0.6 + Math.hypot(dx, dy));
        const trajectory = flight.axeTrajectory;
        const motion = trajectory?.motion;
        const at = motion ?? ((t) => {
          const u = c01(t) * (1.07 - 0.07 * c01(t));   // drag: a touch quicker off the fingers, settling toward the board
          return {
            x: start.x + dx * u,
            y: start.y + dy * u + lift * 4 * u * (1 - u),
            depth: 0.45 + (start.depth ?? DART_HAND_DEPTH - 10) * (1 - u),
            scale: DART_BOARD_SCALE + ((start.scale ?? DART_HELD_SCALE) - DART_BOARD_SCALE) * (1 - u) ** 1.25,
            u,
          };
        });
        if (motion && elapsed < windup && !reduce()) {
          const pose = trajectory.windup(elapsed);
          throwPose = { ...pose, owner: shot.o };
          trail.setAttribute('hidden', '');
          dot?.setAttribute('transform', axeTransform(pose.x, pose.y, pose.rotation, pose.scale, pose.orientation, pose.depth));
        } else {
          const startOffset = 85, gap = 12;
          let previous = at(time - startOffset / duration);
          for (let i = 0; i < trail.children.length; i++) {
            const line = trail.children[i];
            const next = at(time - (startOffset - (i + 1) * (startOffset - gap) / 5) / duration);
            line.setAttribute('x1', xAt(previous.x));
            line.setAttribute('y1', yAt(previous.y));
            line.setAttribute('x2', xAt(next.x));
            line.setAttribute('y2', yAt(next.y));
            previous = next;
          }
          const cur = at(time), ahead = at(Math.min(1, time + 0.02)), behind = at(Math.max(0, time - 0.02));
          const { x, y, depth, scale, u } = cur;
          throwPose = { x, y, depth, scale, u, owner: shot.o, id: shot.id, landingX: shot.x, landingY: shot.y, roll: time * 5,
            behind, ahead, rotation: cur.rotation };
          const tangent = Math.atan2(ahead.x - behind.x, ahead.y - behind.y) * 180 / Math.PI;
          const landingAngle = pinAngle(shot);
          const turnToLodged = ((landingAngle - tangent + 540) % 360) - 180;
          const flightAngle = motion ? cur.rotation : tangent + turnToLodged * smooth((u - 0.65) / 0.35);
          const pinScale = motion ? scale : 1 + (scale - DART_BOARD_SCALE) * 2.2;
          dot?.setAttribute('transform', motion ? axeContactTransform(cur, trajectory.contact?.point) : `${transform(x, y)} rotate(${flightAngle}) scale(${pinScale})`);
          if (time >= 1) {
            const flightEnd = flight.start + duration;
            if (trajectory) paintAxeTrace(shot, flight.axeTrace, flight.axeStroke, flight.axeContact);
            flight = null;
            trail.setAttribute('hidden', '');
            if (!motion) dot?.setAttribute('transform', `${transform(shot.x, shot.y)} rotate(${landingAngle})`);
            if (!shot.number) {
              if (!reduce() && (motion || visibleImpact(shot.x, shot.y))) falling = { shot, dot, started: motion ? flightEnd : now, motion, edge: trajectory?.contact?.point, duration: airTime };
              else dot?.setAttribute('hidden', '');
            }
            impact = shot.number ? { id: shot.id, at: now, power: 0.7 + 0.5 * c01((shot.pace ?? 2.2) / 6) } : null;
            showShot(shot);
            if (view.axeRings) renderScores();
            renderVisit();
            paintLanding();
            flashHit(shot);
            playLanding(shot);
            if (!view.axeRings || shot.number || shot.axeBounce) {
              ctx.buzz?.(shot.bust ? [25, 40, 25] : shot.axeBounce ? [12, 24, 8] : 15);
            }
          }
        }
      }
      if (falling) {
        const { shot, dot, started, motion, edge, duration } = falling;
        const elapsed = now - started;
        const progress = c01(elapsed / (motion ? 330 : 150));
        if (progress >= 1 || reduce()) {
          dot?.setAttribute('hidden', '');
          falling = null;
          throwPose = null;
        } else if (motion) {
          const pose = motion(elapsed / duration, true);
          throwPose = { ...pose, owner: shot.o, id: shot.id };
          dot?.setAttribute('transform', axeContactTransform(pose, edge));
        } else {
          const y = shot.y - 0.24 * progress * progress;
          throwPose = { x: shot.x, y, landingY: shot.y, id: shot.id, owner: shot.o,
            scale: DART_BOARD_SCALE * (1 - 0.35 * progress), tumble: progress };
          dot?.setAttribute('transform', `${transform(shot.x, y)} rotate(${lodgedAngle + progress * 105}) scale(${1 - 0.35 * progress})`);
        }
      }
      if (view.axeRings) {
        const moving = !!throwPose && (flight || falling);
        const shot = view.shot;
        const contact = !moving && shot && { x: shot.x, y: shot.y, depth: AXE_BOARD_DEPTH };
        const position = moving ? throwPose : contact;
        const mark = axeDebug.open && !flight && !swipe && !pending && (shot?.number || shot?.axeBounce);
        axeContactMarker.toggleAttribute('hidden', !mark);
        if (mark) {
          axeContactMarker.setAttribute('cx', xAt(shot.x));
          axeContactMarker.setAttribute('cy', yAt(shot.y));
        }
        const flickReady = !!readyFlick;
        const stroke = !moving && swipe ? swipePayload() : null;
        const aim = stroke && origin();
        const alignment = stroke && axeBladeFeedback(stroke.vx, stroke.vy, Math.hypot(aim.x + stroke.dx, aim.y + stroke.dy) <= 1);
        axeLive.hidden = !flickReady && !alignment && (!axeDebug.open || !position);
        axeCopyFlight.disabled = !position || !!alignment || flickReady;
        if (flickReady) {
          setText(axeLive, "Ready to release");
        } else if (alignment) {
          setText(axeLive, alignment);
        } else if (!axeLive.hidden) {
          const phase = moving ? (falling ? (falling.shot.axeBounce ? 'Bounce' : 'Past target')
            : throwPose.u == null ? 'Windup' : 'Flight') : shot.number || shot.axeBounce ? 'Impact' : 'Board plane';
          setText(axeLive, `${phase} · ${axePosition(position)}`);
        }
      }
      if (impact && now - impact.at > 380) impact = null;
      const age = impact ? (now - impact.at) / 1000 : 0;
      const settle = view.axeRings
        ? Math.sin(Math.PI * c01(age / (0.16 * AXE_SETTLE_SCALE))) * Math.exp(-14 * age / AXE_SETTLE_SCALE)
        : Math.sin(105 * age) * Math.exp(-11 * age);
      const quiver = impact && !reduce() ? { id: impact.id, angle: 0.035 * impact.power * settle } : null;
      for (const pin of pins.children) {
        const quivering = quiver && String(quiver.id) === pin.dataset.shot;
        const model = pin.firstElementChild;
        if (view.axeRings && impact && String(impact.id) === pin.dataset.shot) {
          const shot = view.darts.find((dart) => dart.id === impact.id);
          if (shot) {
            const pose = axeRestPose(shot, pinAngle(shot), (quiver?.angle ?? 0) * 180 / Math.PI);
            pin.setAttribute('transform', axeContactTransform(pose, pose.edge));
          }
        } else if (quivering) model.setAttribute('transform', `rotate(${quiver.angle * 180 / Math.PI})`);
        else if (model.hasAttribute('transform')) model.removeAttribute('transform');
      }
      noteHoles();
      darts3d?.draw(view.darts, drawHand ? hand : null, flight || falling ? throwPose : null, flight?.shot.id, quiver, past, ownerColor, angle, pinFans);
    }

    // Remember where each dart landed so its hole stays in the board after the dart is pulled.
    function noteHoles() {
      if (!view) return;
      let added = false;
      for (const d of view.darts) {
        if (!d.number || pastIds.has(d.id) || d.id === flight?.shot.id) continue;
        pastIds.add(d.id);
        past.push({ x: d.x, y: d.y, seed: (d.id * 0.6180339) % 1 });
        added = true;
      }
      if (!added) return;
      if (past.length > 90) past.shift();
      holeG.innerHTML = past.map((h) => `<circle cx="${xAt(h.x)}" cy="${yAt(h.y)}" r="1.6" fill="#0a0706" stroke="#c9b88f" stroke-opacity=".45" stroke-width=".5"/>`).join('');
    }

    function axeTransform(x, y, angle, scale = AXE_SCALE, orientation, depth = 0.45) {
      let projection = axeProjection(angle);
      if (orientation) {
        const [qx, qy, qz, qw] = orientation;
        projection = [1 - 2 * (qy * qy + qz * qz), -2 * (qx * qy + qz * qw),
          -2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz)];
      }
      const matrix = projection.map((value) => value * scale * 98 / boardPlaneScale(depth));
      return `${transform(x, y)} matrix(${matrix.join(' ')} 0 0)`;
    }

    function axeContactTransform(pose, edge) {
      const { x, y, rotation, scale, depth } = pose;
      if (!edge) return axeTransform(x, y, rotation, scale, pose.orientation, depth);
      const offset = axePointOffset(edge, scale, pose.orientation ?? axeTumbleOrientation(rotation));
      const plane = boardPlaneScale(depth), contactPlane = boardPlaneScale(depth + offset.depth);
      // Correct the affine fallback at the edge as it approaches the contact frame.
      const weight = smooth(pose.u);
      const correctedX = x + weight * ((x * plane + offset.x) / contactPlane - x - offset.x / plane);
      const correctedY = y + weight * ((y * plane + offset.y) / contactPlane - y - offset.y / plane);
      return axeTransform(correctedX, correctedY, rotation, scale, pose.orientation, depth);
    }

    function pinAngle(dart) {
      if (view.axeRings) return view.axeLodgedAngle ?? AXE_LODGED_ANGLE;
      return lodgedAngle + (pinFans.get(dart.id) ?? 0);
    }

    function paintPins() {
      pinFans.clear();
      const hits = view.darts.filter((dart) => dart.number);
      for (const [index, dart] of hits.entries()) {
        const occupied = new Set(hits.slice(0, index)
          .filter((other) => Math.hypot(other.x - dart.x, other.y - dart.y) < 0.08)
          .map((other) => pinFans.get(other.id)));
        // Separate nearby tails while keeping every tip on its scored hit.
        let fan = 0;
        while (occupied.has(fan)) fan = (fan + 137) % 360;
        pinFans.set(dart.id, fan);
      }
      const visible = view.darts.filter((dart) => dart.number || dart.id === flight?.shot.id || dart.id === falling?.shot.id);
      const existing = new Map(Array.from(pins.children, (pin) => [Number(pin.dataset.shot), pin]));
      for (const dart of visible) {
        const pose = view.axeRings && dart.number ? axeRestPose(dart, pinAngle(dart)) : null;
        const resting = pose ? axeContactTransform(pose, pose.edge) : `${transform(dart.x, dart.y)} rotate(${pinAngle(dart)})`;
        let pin = existing.get(dart.id);
        if (!pin) {
          pin = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          pin.dataset.shot = dart.id;
          pin.innerHTML = `<g><g transform="scale(1 ${DART_LENGTH})">${view.axeRings ? axeSilhouette : dartSilhouette}</g></g>`;
          pin.setAttribute('transform', flight?.shot.id === dart.id
            ? transform(0, -1.2) : resting);
          pins.append(pin);
        }
        existing.delete(dart.id);
        pin.style.setProperty('--dart-color', player(dart.o)?.color ?? '#ffe198');
        if (flight?.shot.id === dart.id) flight.dot = pin;
        else if (falling?.shot.id === dart.id) falling.dot = pin;
        else pin.setAttribute('transform', resting);
      }
      existing.forEach((pin) => pin.remove());
    }

    function renderScores() {
      const cricket = view.mode === 'cricket', clock = view.mode === 'clock', countup = view.mode === 'countup' || !!view.axeRings;
      const table = ctx.el('table', 'scores ar-darts-table');
      const head = ctx.el('thead'), headings = ctx.el('tr');
      const targets = cricket ? view.targets.map((n) => n === 25 ? 'Bull' : String(n)) : [];
      const columns = clock ? ['Next', 'Hit'] : countup ? [view.axesPerRound ? 'Rounds' : 'Visits', 'Pts'] : [...targets, view.x01 ? 'Left' : 'Pts'];
      for (const title of ['Player', ...columns]) {
        const cell = ctx.el('th', '', title); cell.scope = 'col'; headings.append(cell);
      }
      head.append(headings); table.append(head);
      const body = ctx.el('tbody'); table.append(body);
      view.seats.forEach((_, i) => {
        const row = ctx.el('tr', view.next === i ? 'now' : '');
        const name = ctx.el('th', '', player(i)?.name ?? '?'); name.scope = 'row';
        if (view.next === i) name.append(ctx.el('span', 'ar-darts-up', view.roundRecap ? 'Round complete' : 'Up next'));
        row.classList.toggle('out', !view.active.includes(i));
        row.append(name);
        if (cricket) for (const marks of view.marks[i]) {
          const cell = ctx.el('td', marks === 3 ? 'closed' : '', ['–', '/', '×', '⊗'][marks]);
          cell.setAttribute('aria-label', marks === 3 ? 'Closed' : `${marks} of 3 marks`);
          row.append(cell);
        }
        if (clock) row.append(ctx.el('td', '', clockLabel(view.nextNumbers[i])));
        if (countup) row.append(ctx.el('td', '', `${view.visitsDone[i]}/${view.visitLimit}`));
        const inAir = view.axeRings && flight?.shot.o === i ? flight.shot.gain ?? flight.shot.value ?? 0 : 0;
        row.append(ctx.el('td', 'total', String(view.points[i] - inAir)));
        body.append(row);
      });
      score.replaceChildren(table);
      // #278 everyone's score on one line above the board, so it's in view without scrolling
      const total = (i) => (clock ? `at ${clockLabel(view.nextNumbers[i])}` : String(view.points[i] - (view.axeRings && flight?.shot.o === i ? flight.shot.gain ?? flight.shot.value ?? 0 : 0)));
      root.querySelector('.ar-darts-strip').replaceChildren(...view.seats.map((_, i) => {
        const chip = ctx.el('span', (view.next === i ? 'now' : '') + (view.active.includes(i) ? '' : ' out'));
        chip.append(ctx.el('i', '', player(i)?.name ?? '?'), ctx.el('b', '', total(i)));
        chip.style.setProperty('--pc', ownerColor(i) ?? '#888');
        return chip;
      }));
      if (view.checkout.length) score.append(ctx.el('p', 'ar-darts-checkout', `Checkout · ${view.checkout.join(' → ')}`));
    }

    function render(s, c) {
      noteHoles();
      const first = !view;
      view = s.darts; state = s; ctx = c;
      readyAt = performance.now() + view.readyIn * 1000;
      if (!ready()) axeDrag = null;
      if (!mine() || !view.canCallCorner || view.shot?.id !== shown) callCorner = false;
      updateCorner();
      paintHint();
      if (first) {
        const start = origin();
        grip.setAttribute('transform', transform(start.x, start.y));
        paintBoard();
        if (view.axeRings) {
          dartModel.firstElementChild.innerHTML = axeSilhouette;
          dartModel.firstElementChild.removeAttribute('transform');
          release.textContent = 'Release axe';
          if (view.axesPerRound) {
            while (dartIndicators.children.length < view.axesPerRound) dartIndicators.append(document.createElement('i'));
          }
          swipeButton.setAttribute('aria-label', 'Swipe to throw the axe, or press Enter to throw');
          const scorePanel = score.parentElement;
          scorePanel.classList.add('ar-darts-score-above');
          stage.parentElement.before(scorePanel);
          axeDebug.hidden = !showAxeDiagnostics;
          root.querySelector('.ar-darts-axe-placement').hidden = false;
          board.setAttribute('aria-label', 'Axe target. Drag to move the axe. Flick and release to throw, or pause and lift to place it. Use arrows to aim, Shift and arrows for larger steps, Enter or Space to throw, and Escape to clear aim.');
          applyView();
        }
        darts3d?.paint(view);
        root.querySelector('h2').textContent = `Darts · ${view.title}`;
      }
      adjust.hidden = !view.aimControl;
      if (!mine() || view.roundRecap || visit !== view.visit) {
        visit = view.visit; swipe = null; keys = null;
        aimX.value = aimY.value = 0;
        setText(aimStatus, '');
      }
      const shot = view.shot;
      const previousShot = shown;
      if (shot?.id !== shown) {
        falling = null;
        landing.setAttribute('hidden', '');
        clearImpact();
        trail.setAttribute('hidden', '');
        shown = shot?.id;
        const from = shot?.o === view.me && releasedFrom ? releasedFrom : shot?.axeOrigin
          ? { x: shot.axeOrigin[0], y: shot.axeOrigin[1], placed: true }
          : defaultOrigin();
        const duration = view.axeRings ? (shot?.axeFlightMs ?? 700) : Math.max(400, 600 - 30 * (shot?.pace ?? 2.2));
        const trajectory = shot && !first && view.axeRings
          ? axeTrajectory(from, shot, duration, pinAngle(shot), axeStartOrientation(axeStart)) : null;
        const stroke = shot?.o === view.me ? releasedSwipe : null;
        const trace = trajectory ? axeTraceRows(shot, duration, trajectory) : [];
        const contact = trajectory ? axeContactTrace(shot, duration, trajectory, pinAngle(shot), view.axeStickAngle) : null;
        flight = shot && !first && (c.peek || trajectory) && !reduce()
          ? { shot, start: performance.now(), from, duration, axeTrajectory: trajectory, axeTrace: trace, axeStroke: stroke, axeContact: contact } : null;
        if (view.axeRings) {
          paintAxeTrace(shot, flight ? [] : trace, stroke, flight ? null : contact);
          if (stroke && trace.length && c.logAxeDebug) {
            const status = axeLogStatus;
            setText(status, 'Saving throw…');
            c.logAxeDebug({
              shotId: shot.id, swipe: stroke,
              trace: { columns: AXE_TRACE_COLUMNS, axes: AXE_TRACE_AXES, pivot: AXE_PIVOT, rows: trace, contact },
            }).then(() => {
              if (shown === shot.id && status === axeLogStatus) setText(status, 'Throw saved to debug log.');
            }).catch(() => {
              if (shown === shot.id && status === axeLogStatus) setText(status, 'Could not save this throw.');
            });
          } else {
            setText(axeLogStatus, '');
          }
        }
        if (shot && !first && c.peek && (shot.o !== view.me || !releasedFrom)) playRelease(shot.pace ?? 2.2);
        releasedFrom = null;
        releasedSwipe = null;
        waitingHand = null;
        if (shot && !flight) {
          showShot(shot);
          if (!first && c.peek) {
            flashHit(shot);
            playLanding(shot);
          }
        }
      }
      if (shot && !view.darts.some((dart) => dart.id === shot.id)) {
        falling = null;
        clearImpact();
      }
      paintPins();
      if (!pending || shot?.id !== previousShot) paintLanding();
      const target = view.nextNumbers?.[view.next];
      darts3d?.setNumberTarget(target);
      for (const label of geometry.querySelectorAll('[data-number]')) {
        label.classList.toggle('ar-darts-next-number', Number(label.dataset.number) === target);
      }
      setText(turn, s.phase === 'over' ? 'Game over' : view.next == null ? (view.axeRings ? 'Final throw' : 'Final dart')
        : view.roundRecap ? 'Round complete'
        : `${view.next === view.me ? (view.axesPerRound ? 'Your throw' : 'Your visit') : player(view.next)?.name ?? 'Player'} · ${view.left} left`);
      const remaining = s.phase === 'over' || view.roundRecap || view.next == null ? 0 : view.left;
      for (const [i, indicator] of Array.from(dartIndicators.children).entries()) {
        indicator.classList.toggle('ready', i < remaining);
      }
      updateHint();
      renderScores();
      renderVisit();
    }

    function renderVisit() {
      const visible = (dart) => dart.id !== flight?.shot.id;
      const completed = view.completedVisit;
      const current = (view.visitDarts ?? []).filter(visible);
      const showCompleted = completed && completed.darts.every(visible);
      const parts = [];
      if (!showCompleted || completed.visit !== view.visit) {
        const landed = completed && !showCompleted ? completed.darts.filter(visible) : current;
        const labels = Array.from({ length: view.axesPerRound ?? 3 }, (_, i) => landed[i]?.label ?? '–');
        parts.push(ctx.el('div', '', `${view.axesPerRound ? (view.me == null ? "Current player’s axes" : "Your axes this round") : "Current visit"} · ${labels.join(' / ')}`));
      }
      if (showCompleted) {
        const { seat, darts, reason, before, after, marks } = completed;
        const labels = darts.map((dart) => dart.label).join(' / ');
        const delta = after - before;
        const summary = reason === 'bust' ? `Bust on ${darts.at(-1).label} · Restored to ${after}`
          : view.x01 ? `${-delta} scored · ${after} left`
          : view.mode === 'cricket' ? `${marks} marks · ${delta} points`
          : view.mode === 'clock' ? `${delta} targets cleared` : `${delta} points`;
        const ending = reason === 'timeout' ? ' · Time expired' : reason === 'departure' ? ' · Player left' : '';
        parts.push(ctx.el('div', '', `${player(seat)?.name ?? 'Player'} · ${labels ? labels + ' · ' : ''}${summary}${ending}`));
      }
      visitPanel.replaceChildren(...parts);
    }

    function updateHint() {
      if (view.axeRings) {
        const controls = mine() ? `Drag to move the axe. Flick and release to throw, or use Swipe to throw. ${view.aimControl ? 'You can also adjust aim and select Release axe. ' : ''}` : '';
        const format = view.axesPerRound ? `${view.axesPerRound} axes each, one throw per turn. Highest score after ${view.visitLimit} rounds wins.`
          : `Highest score after ${view.visitLimit} visits wins.`;
        hint.textContent = view.roundRecap ? 'The target clears after the recap.'
          : `${controls}${view.axeCorners
            ? 'Rings score 5, 3, or 1. On your last throw, call a corner to play for 7 points. Only the green targets score on a called throw.'
            : 'A clean stick scores 1–5 points.'} ${format}`;
        return;
      }
      let rule = view.doubleOut ? 'Reach zero on a double.' : 'Reach exactly zero; any dart finishes.';
      if (view.mode === 'cricket') rule = 'Close 15–20 and bull. Extra hits score while a rival has the target open.';
      if (view.mode === 'clock') rule = view.next == null ? 'Hit 1–20 in order, then bull.'
        : `Next target: ${clockLabel(view.nextNumbers[view.next])}.`;
      if (view.mode === 'countup') rule = `Highest score after ${view.visitLimit} visits wins.`;
      hint.textContent = view.roundRecap ? 'The board clears after the recap.'
        : mine() && view.aimControl && view.aimSway && !view.axeRings ? `Set the aim with the sliders. The ring drifts around it: press Release as it crosses your target. You can still swipe from the right half of the board, or from anywhere on it with a mouse. Select Inspect to rotate. ${rule}`
        : mine() && view.aimControl ? `Adjust horizontal and vertical aim, then release. Swipe from the right half of the board, or from anywhere on it with a mouse. Select Inspect to rotate. ${rule}`
        : mine() ? matchMedia('(pointer: fine)').matches
          ? `Hold the mouse button anywhere on the board, swipe inward and release when the ring is over your target. A faster swipe scatters more. Select Inspect to rotate. ${rule}`
          : `Select Inspect to rotate. Start on the right half or the throw button. Swipe inward and release when the ring is over your target. Pinch to zoom. ${rule}`
        : `Select Inspect to rotate. Pinch to zoom. ${rule}`;
    }

    return { mount, render, unmount() {
      cancelAnimationFrame(frame);
      clearTimeout(aimTimer);
      touchListeners?.abort();
      tabletopResize?.disconnect();
      darts3d?.dispose();
      darts3d = null;
      view = null;
      tabletop = null;
    } };
  }

  let mainBox, sideBox, activeUI;
  const rangeUI = { mount: mountRange, unmount: unmountRange, render: renderRange };
  const dartsUI = makeDartsUI();
  return {
    mount(main, side) { mainBox = main; sideBox = side; },
    unmount() { activeUI?.unmount(); activeUI = null; },
    render(s, c) {
      const ui = s.darts ? dartsUI : rangeUI;
      if (ui !== activeUI) {
        activeUI?.unmount();
        activeUI = ui;
        ui.mount(mainBox, sideBox);
      }
      ui.render(s, c);
    },
    turnText(s) {
      if (!s.darts || s.phase !== 'playing') return null;
      const { next, seats, left } = s.darts;
      if (s.darts.roundRecap) return 'Round complete';
      if (next == null) return s.darts.axeRings ? 'Final throw' : 'Final dart';
      const name = s.players.find((p) => p.id === seats[next])?.name;
      return next === s.darts.me ? `${s.darts.axesPerRound ? "Your throw" : "Your visit"} · ${left} left` : `${name ?? 'Player'} · ${left} left`;
    },
  };
})();
