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
    side.innerHTML = '<div class="panel"><h3>Scoreboard</h3><div id="arCard" class="ar-card"></div></div>';
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
  const DART_TIP = 32.4;   // tip height above the model origin; a real dart spans outer bull to double ring (~84 board units)

  function makeDarts3d(surface) {
    const T = window.THREE;
    let api;
    const renderer = GL3.renderer({ alpha: true }, { onLost: () => api?.dispose() });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    canvas.className = 'ar-darts-webgl';
    canvas.setAttribute('aria-hidden', 'true');
    surface.prepend(canvas);
    const cameraDistance = 345;
    const fov = 2 * Math.atan(125 / cameraDistance) * 180 / Math.PI;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(fov, 1, 1, 550);
    camera.position.z = cameraDistance;
    const VIEW_TARGET = new T.Vector3();
    scene.add(new T.HemisphereLight(0xf4e4ce, 0x6c534c, 1.35));
    const lamp = new T.SpotLight(0xffcb88, 2.8, 0, 0.51, 0.72);
    lamp.position.set(-75, 174, 235);
    lamp.target.position.set(1, -5, 0);
    scene.add(lamp, lamp.target);
    const rimLight = new T.DirectionalLight(0x8ac5ff, 0.9);
    rimLight.position.set(130, -105, 46);
    scene.add(rimLight);
    const dartLight = new T.PointLight(0xe8f3ff, 0, 84, 1);
    scene.add(dartLight);
    if (renderer.shadowMap && GL3.level?.() !== 'low') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(768, 768);
      lamp.shadow.camera.near = 120;
      lamp.shadow.camera.far = 400;
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
        const grainValue = 0.83 + 0.072 * streak + 0.035 * (fibers[i] / 128 - 1);
        woodPixels[i] = 222 * grainValue;
        woodPixels[i + 1] = 159 * grainValue;
        woodPixels[i + 2] = 116 * grainValue;
        woodPixels[i + 3] = 255;
      }
    }
    const wood = detailTexture(woodPixels);
    const cabinet = new T.Group();
    scene.add(cabinet);
    const walnut = material(0x75452d, { map: wood, bumpMap: wood, bumpScale: 0.6, roughness: 0.58 });
    const lip = material(0x3d291f, { map: wood, roughness: 0.52 });
    const seam = material(0x211510);
    const mountMetal = material(0x8c6945, { metalness: 0.42, roughness: 0.4 });
    const plank = new T.BoxGeometry(52, 265, 5);
    for (let n = -2; n <= 2; n++) {
      const x = n * 53;
      mesh(cabinet, plank, walnut, x, 0, -19).receiveShadow = true;
      if (n < 2) mesh(cabinet, new T.BoxGeometry(1.5, 265, 1), seam, x + 26.5, 0, -17).receiveShadow = true;
    }
    const rail = new T.BoxGeometry(265, 8, 6);
    const bevel = new T.BoxGeometry(265, 1.4, 2);
    for (const y of [-126, 126]) {
      mesh(cabinet, rail, lip, 0, y, -14).receiveShadow = true;
      mesh(cabinet, bevel, walnut, 0, y - Math.sign(y) * 4.2, -11);
    }
    const bracket = new T.BoxGeometry(16, 7, 1.8);
    const bolt = new T.SphereGeometry(1.25, 10, 6);
    for (const x of [-112, 112]) for (const y of [-110, 110]) {
      mesh(cabinet, bracket, mountMetal, x, y, -15.5).rotation.z = Math.sign(x * y) * 0.78;
      for (const offset of [-4, 4]) {
        mesh(cabinet, bolt, mountMetal, x + offset, y + offset * Math.sign(x * y), -14.2);
      }
    }

    function paint(view) {
      if (face.children.length) return;
      const rings = view.radii.map((r) => r * 98);
      const [inner, outer, tripleIn, tripleOut, doubleIn, edge] = rings;
      mesh(face, new T.CircleGeometry(113, 96), material(0x171815), 0, 0, -0.5);
      const wire = material(0xb0a395, { metalness: 0.34, roughness: 0.38 });
      const liner = material(0xd2d6da, { metalness: 0.6, roughness: 0.28 });
      for (const r of [117.5]) mesh(face, new T.TorusGeometry(r, 0.45, 6, 128), liner, 0, 0, -0.1);
      const screwHead = new T.CircleGeometry(1.2, 12);
      const slot = new T.PlaneGeometry(1.5, 0.26);
      const slotMat = material(0x211c19);
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * Math.PI / 4, x = 115.9 * Math.cos(a), y = 115.9 * Math.sin(a);
        mesh(face, screwHead, wire, x, y, 0.2);
        mesh(face, slot, slotMat, x, y, 0.3).rotation.z = a;
      }
      const step = Math.PI / 10;
      const [map, bump] = sisalFace(rings);
      mesh(face, new T.CircleGeometry(113, 128), material(0xffffff, { map, bumpMap: bump, bumpScale: 0.4, roughness: 0.96 }), 0, 0, 0.1);
      holes = new T.CanvasTexture(holeCanvas);
      if (T.SRGBColorSpace) holes.colorSpace = T.SRGBColorSpace;
      holeLayer = mesh(face, new T.CircleGeometry(113, 64), new T.MeshBasicMaterial({ map: holes, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0, 0, 0.38);
      view.numbers.forEach((_, i) => {
        const a = Math.PI / 2 - (i + 0.5) * step;
        const spoke = mesh(face, new T.CylinderGeometry(0.27, 0.27, edge - outer, 5), wire,
          Math.cos(a) * (edge + outer) / 2, Math.sin(a) * (edge + outer) / 2, 0.35);
        spoke.rotation.z = a - Math.PI / 2;
      });
      for (const r of rings) mesh(face, new T.TorusGeometry(r, 0.32, 6, 112), wire, 0, 0, 0.43);
      face.children.forEach((part) => { part.receiveShadow = true; });
    }

    // One painted face: sisal fibre dashes, mottling, pressed grooves under the wire, plus a matching bump map.
    function sisalFace(rings) {
      const N = 1024, half = N / 2, unit = half / 113, [bullR, outerR, tripleIn, tripleOut, doubleIn, edge] = rings;
      const hash = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
      const paletteDark = [37, 35, 32], paletteLight = [214, 190, 140], paletteRed = [158, 40, 44], paletteGreen = [34, 108, 78];
      const color = document.createElement('canvas'), relief = document.createElement('canvas');
      color.width = color.height = relief.width = relief.height = N;
      const cg = color.getContext('2d'), rg = relief.getContext('2d');
      const img = cg.createImageData(N, N), bmp = rg.createImageData(N, N);
      const step = Math.PI / 10;
      for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - half) / unit, dy = (half - py - 0.5) / unit, r = Math.hypot(dx, dy);
        const o = 4 * (py * N + px);
        let base, rgb;
        const turn = (Math.PI / 2 - Math.atan2(dy, dx)) / step, i = Math.round(turn), off = turn - i;
        const even = (((i % 20) + 20) % 20) % 2 === 0;
        if (r > edge) rgb = r > 113 ? [24, 24, 22] : [41, 39, 32];
        else if (r < bullR) rgb = paletteRed;
        else if (r < outerR) rgb = paletteGreen;
        else if (r < tripleIn || (r >= tripleOut && r < doubleIn)) rgb = even ? paletteDark : paletteLight;
        else rgb = even ? paletteRed : paletteGreen;
        // short radial fibre dashes, a coarser mottle, and fine grain
        const s = Math.floor(Math.atan2(dy, dx) * r / 0.26), col = hash(s, 7);
        const fibre = hash(s, Math.floor((r + 9 * col) / 1.7));
        const mottle = hash(Math.floor(px / 9), Math.floor(py / 9)) * 0.6 + hash(Math.floor(px / 23), Math.floor(py / 23)) * 0.4;
        const fine = hash(px, py);
        let groove = 1;
        const edgeDist = Math.min(
          (0.5 - Math.abs(off)) * step * r,
          ...[bullR, outerR, tripleIn, tripleOut, doubleIn, edge].map((ring) => Math.abs(r - ring)));
        if (r <= edge + 0.6 && edgeDist < 1.1) groove = 0.55 + 0.45 * (edgeDist / 1.1);
        const k = (0.7 + 0.24 * fibre + 0.16 * (mottle - 0.5) + 0.12 * (fine - 0.5)) * groove;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, rgb[c] * k);
        img.data[o + 3] = 255;
        base = (0.3 + 0.5 * fibre + 0.2 * fine) * groove * (r > edge ? 0.7 : 1) * 255;
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
        const halo = g.createRadialGradient(x, y, r * 0.5, x, y, r * 2.1);
        halo.addColorStop(0, 'rgba(20,14,10,0.55)'); halo.addColorStop(1, 'rgba(20,14,10,0)');
        g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.1, 0, 7); g.fill();
        const pit = g.createRadialGradient(x, y, 0, x, y, r);
        pit.addColorStop(0, '#050403'); pit.addColorStop(0.7, '#0b0807'); pit.addColorStop(1, 'rgba(11,8,7,0.2)');
        g.fillStyle = pit; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
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

    const steel = material(0xcbbfb0, { roughness: 0.27, metalness: 0.46 });
    const brass = material(0xb2834b, { roughness: 0.33, metalness: 0.42 });
    const groove = material(0x503929, { roughness: 0.54 });
    const blue = material(0x256d91, { side: T.DoubleSide, roughness: 0.43 });
    const trim = material(0x79cddd, { side: T.DoubleSide, roughness: 0.45 });
    const flightShape = new T.Shape();
    flightShape.moveTo(0, -2);
    flightShape.quadraticCurveTo(2.5, -4, 5, -7);
    flightShape.quadraticCurveTo(7.6, -9.6, 6.3, -14);
    flightShape.lineTo(5.2, -15.8); flightShape.lineTo(0, -12.5); flightShape.closePath();
    const stripeShape = new T.Shape();
    stripeShape.moveTo(0, -6.5); stripeShape.lineTo(6.5, -10.6);
    stripeShape.lineTo(6.5, -12.2); stripeShape.lineTo(0, -8.2); stripeShape.closePath();
    function dart() {
      const group = new T.Group();
      mesh(group, new T.ConeGeometry(0.78, 7, 12), steel, 0, 28.9);
      mesh(group, new T.CylinderGeometry(1.08, 2.15, 3, 16), steel, 0, 24.05);
      mesh(group, new T.CylinderGeometry(2.15, 1.95, 22, 18), brass, 0, 11.55);
      const gripRing = new T.TorusGeometry(2.06, 0.17, 4, 18);
      for (let i = 0; i < 12; i++) {
        mesh(group, gripRing, groove, 0, 1.4 + i * 1.7).rotation.x = Math.PI / 2;
      }
      mesh(group, new T.CylinderGeometry(1.88, 0.9, 2.5, 14), steel, 0, -0.65);
      mesh(group, new T.CylinderGeometry(0.82, 0.68, 38, 10), steel, 0, -19.7);
      const finGeo = new T.ExtrudeGeometry(flightShape, { depth: 0.9, bevelEnabled: false }).translate(0, 0, -0.45), stripeGeo = new T.ShapeGeometry(stripeShape);
      for (let i = 0; i < 4; i++) {
        const fin = new T.Group();
        fin.rotation.y = i * Math.PI / 2;
        fin.position.y = -35.9;
        mesh(fin, finGeo, blue);
        mesh(fin, stripeGeo, trim, 0, 0, 0.5);
        mesh(fin, stripeGeo, trim, 0, 0, -0.5);
        group.add(fin);
      }
      group.traverse((part) => { if (part.isMesh) part.castShadow = true; });
      scene.add(group);
      return group;
    }
    const inHand = dart(), flying = dart(), lodged = Array.from({ length: 3 }, dart);
    const tip = new T.Vector3(), direction = new T.Vector3();
    const trailPoints = [];
    const trail = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.4, depthWrite: false }));
    trail.frustumCulled = false; trail.visible = false;
    scene.add(trail);
    const dartAxis = new T.Vector3(0, 1, 0);
    const aimingOrientation = new T.Quaternion().setFromUnitVectors(dartAxis,
      new T.Vector3(0, 0, -1));
    const landedOrientation = new T.Quaternion(), wobble = new T.Quaternion(), wobbleEuler = new T.Euler(), sight = new T.Vector3();
    // A stuck dart points along the line of sight to its tip, so perspective doesn't streak the tail outward from
    // the board centre, then lifts the tail a little so it reads as thrown from below.
    function lodgedPose(x, y, out) {
      sight.set(x * 98, y * 98, -cameraDistance).normalize();
      sight.y -= 0.2;
      return out.setFromUnitVectors(dartAxis, sight.normalize());
    }
    const travelOrientation = new T.Quaternion();
    const smooth = (t) => { const k = c01(t); return k * k * (3 - 2 * k); };
    const planeScale = (depth) => 98 * (1 - depth / cameraDistance);
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
      dart.scale.setScalar(scale);
      tip.set(0, DART_TIP * scale, 0).applyQuaternion(dart.quaternion);
      const k = planeScale(depth);
      dart.position.set(x * k - tip.x, y * k - tip.y, depth - tip.z);
    }
    let size = 0, disposed = false, lastFrame;
    function draw(pins, hand, flight, flyingId, impact, past = []) {
      if (disposed) return;
      paintHoles(past);
      const w = surface.clientWidth;
      if (!w || !face.children.length) return;
      if (w !== size) {
        size = w; renderer.setSize(w, surface.clientHeight, false); lastFrame = null;
        camera.aspect = surface.clientWidth / surface.clientHeight;
        camera.updateProjectionMatrix();
      }
      camera.position.set(0, 0, cameraDistance);
      camera.lookAt(VIEW_TARGET);
      const signature = [pins.map((p) => p.id).join(), hand?.x, hand?.y, hand?.angle, hand?.lift, hand?.aiming, flight?.u, impact?.angle].join('|');
      if (signature === lastFrame) return;
      lastFrame = signature;
      inHand.visible = !!hand;
      if (hand) {
        const depth = DART_HAND_DEPTH + 9 * hand.lift;
        const k = planeScale(depth);
        inHand.position.set(hand.x * k, hand.y * k, depth);
        if (hand.aiming) inHand.quaternion.copy(aimingOrientation);
        else inHand.rotation.set(-0.94, -0.30, -hand.angle);
        inHand.scale.setScalar(hand.scale);
        dartLight.position.copy(inHand.position);
        dartLight.position.addScaledVector(dartAxis, 20);
        dartLight.position.z += 31;
        dartLight.intensity = 1.35;
      }
      flying.visible = !!flight;
      if (flight) {
        // Nose follows the real path tangent (up at release, level at the apex, dipping on approach).
        const { behind, ahead } = flight, kb = planeScale(behind.depth), ka = planeScale(ahead.depth);
        // The hand sits well off to the side, so the true path is mostly sideways. A dart flies nose-first,
        // so keep the nose pointed mostly at the board and let only a small fraction of the sideways drift tilt it
        // (the dart is long, so any tilt swings its tail a long way).
        direction.set(0.12 * (ahead.x * ka - behind.x * kb), 0.2 * (ahead.y * ka - behind.y * kb), 3 * (ahead.depth - behind.depth)).normalize();
        travelOrientation.setFromUnitVectors(dartAxis, direction);
        flying.quaternion.copy(aimingOrientation).slerp(travelOrientation, smooth(flight.u / 0.14));
        flying.rotateY(flight.roll);
        flying.quaternion.slerp(lodgedPose(flight.x, flight.y, landedOrientation), smooth((flight.u - 0.6) / 0.4));
        placeTip(flying, flight.x, flight.y, flight.depth, flight.scale);
        const kk = planeScale(flight.depth);
        trailPoints.push(new T.Vector3(flight.x * kk, flight.y * kk, flight.depth + 40 * flight.scale));
        if (trailPoints.length > 9) trailPoints.shift();
        trail.geometry.setFromPoints(trailPoints);
        trail.visible = trailPoints.length > 1;
        dartLight.position.copy(flying.position);
        dartLight.position.y += 12;
        dartLight.position.z += 30;
        dartLight.intensity = 1.15 * (1 - flight.u);
      }
      if (!flight) { trailPoints.length = 0; trail.visible = false; }
      if (!hand && !flight) dartLight.intensity = 0;
      lodged.forEach((obj, i) => {
        const p = pins[i];
        obj.visible = !!p && p.id !== flyingId && Math.hypot(p.x, p.y) <= 1.5;
        if (!obj.visible) return;
        const quiver = p.id === impact?.id ? impact.angle : 0;
        obj.quaternion.copy(lodgedPose(p.x, p.y, landedOrientation));
        if (quiver) obj.quaternion.multiply(wobble.setFromEuler(wobbleEuler.set(quiver, 0, -quiver * 0.6)));
        placeTip(obj, p.x, p.y, 0.45, DART_BOARD_SCALE);
      });
      renderer.render(scene, camera);
      surface.classList.add('ar-darts-is3d');
    }

    api = { paint, draw, releasePoint, dispose() {
      if (disposed) return;
      disposed = true;
      surface.classList.remove('ar-darts-is3d');
      const resources = new Set([grain, wood, holes]);
      scene.traverse(({ material, geometry }) => {
        if (material) { resources.add(material); if (material.map) resources.add(material.map); if (material.bumpMap) resources.add(material.bumpMap); }
        if (geometry) resources.add(geometry);
      });
      resources.forEach((resource) => resource.dispose());
      lamp.shadow.map?.dispose();
      renderer.dispose(); canvas.remove();
    } };
    return api;
  }

  function makeDartsUI() {
    const STEP = Math.PI / 10, CENTER = 125, SCALE = 98, WIDTH = 250;
    let root, score, stage, board, geometry, holeG, pins, grip, held, guide, dartModel, result, callout, hint, turn, tabletop, darts3d, swipeButton, grabButton, hintButton, aim, spreadEl, hitFlash;
    const zoom = { s: 1, x: 0, y: 0 };
    let hintOn = false;
    let past = [], pastIds = new Set();
    let view, state, ctx, frame, readyAt, grabAt, grabbing, pending, visit, shown, flight, swipe, keys, releasedFrom, waitingHand, impact;
    const xAt = (x) => CENTER + SCALE * x, yAt = (y) => CENTER - SCALE * y;
    const point = (a, r) => [CENTER + Math.sin(a) * r, CENTER - Math.cos(a) * r];
    const circle = (r, fill) => `<circle cx="125" cy="125" r="${r}" fill="${fill}"/>`;
    const player = (i) => ctx.player(view.seats[i]);
    const clockLabel = (number) => number == null ? 'Done' : number === 25 ? 'Bull' : String(number);
    const origin = () => { const [x, y] = view.dartOrigin || [1.04, -0.55]; return { x, y }; };
    const mine = () => view && state.phase === 'playing' && ctx.myTurn && !state.paused;
    const ready = () => mine() && !view.grab && !pending && !waitingHand && !flight && performance.now() >= readyAt;
    const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const transform = (x, y) => `translate(${xAt(x)} ${yAt(y)})`;

    function sector(a, inner, outer, color) {
      const left = a - STEP / 2, right = a + STEP / 2;
      return `<path fill="${color}" d="M ${point(left, outer)} A ${outer} ${outer} 0 0 1 ${point(right, outer)}
        L ${point(right, inner)} A ${inner} ${inner} 0 0 0 ${point(left, inner)} Z"/>`;
    }

    function paintBoard() {
      const [bull, outer, t0, t1, d0, edge] = view.radii.map((r) => r * SCALE);
      geometry.innerHTML = circle(117, '#181815') + circle(113, '#292720')
        + view.numbers.map((number, i) => {
          const angle = i * STEP, [x, y] = point(angle, 108);
          const sisal = i % 2 ? '#dcc697' : '#292723', stripe = i % 2 ? '#317553' : '#a33c39';
          return `<g stroke="#a89d81" stroke-width=".45">${sector(angle, outer, t0, sisal)}
            ${sector(angle, t0, t1, stripe)}${sector(angle, t1, d0, sisal)}${sector(angle, d0, edge, stripe)}
            </g><text data-number="${number}" x="${x}" y="${y}">${number}</text>`;
        }).join('') + circle(outer, '#317553') + circle(bull, '#b7423d');
    }

    function mount(main, side) {
      main.innerHTML = `<section class="ar-darts">
        <header><div><h2></h2><span class="ar-darts-turn"></span></div>
          <button type="button" class="ar-darts-hintbtn" aria-pressed="false">💡 Hint</button>
        </header>
        <div class="ar-darts-board-wrap"><div class="ar-darts-stage"><div class="ar-darts-tabletop">
          <div class="ar-darts-aim" aria-hidden="true" hidden></div>
          <div class="ar-darts-spread" aria-hidden="true" hidden></div>
          <svg class="ar-darts-hitflash" viewBox="0 0 250 250" aria-hidden="true"></svg>
          <svg viewBox="0 0 250 250" tabindex="0" role="group"
            aria-label="Dartboard. Hold the dart at the right edge and swipe inward. With a keyboard, use arrow keys to adjust the swipe and Enter to throw.">
            <g class="ar-darts-board"></g><g class="ar-darts-holes"></g><g class="ar-darts-pins"></g>
            <g class="ar-darts-grip" aria-hidden="true"><rect x="-25" y="-25" width="48" height="50" rx="14"/></g>
            <g class="ar-darts-held">
              <path class="ar-darts-direction" d="M-12 -8L0 -53L12 -8Z" hidden/>
              <g class="ar-darts-model" transform="scale(${DART_HELD_SCALE})"><path d="M0-19L2-9V4L6 10V17L0 13L-6 17V10L-2 4V-9Z"/></g>
            </g>
          </svg>
        </div></div><div class="ar-darts-callout" aria-hidden="true" hidden></div></div>
        <div class="ar-darts-footer">
          <p class="ar-darts-result" role="status"></p>
          <button type="button" class="ar-darts-swipe" aria-label="Swipe toward the board to throw, or press Enter to throw">Swipe to throw</button>
          <button type="button" class="ar-darts-grab" hidden></button>
        </div>
        <p class="hint ar-darts-hint"></p>
      </section>`;
      side.innerHTML = '<div class="panel"><h3>Scoreboard</h3><div class="ar-darts-score"></div></div>';
      root = main.firstElementChild; score = side.querySelector('.ar-darts-score');
      const find = (name) => root.querySelector('.ar-darts-' + name);
      board = root.querySelector('svg'); grip = find('grip'); held = find('held');
      guide = find('direction'); dartModel = find('model'); tabletop = find('tabletop'); stage = find('stage'); swipeButton = find('swipe'); grabButton = find('grab'); hintButton = find('hintbtn'); aim = find('aim'); spreadEl = find('spread'); hitFlash = find('hitflash');
      geometry = find('board'); holeG = find('holes'); pins = find('pins'); past = []; pastIds = new Set();
      result = find('result'); callout = find('callout'); hint = find('hint'); turn = find('turn');
      view = null; pending = false; flight = null; shown = null; visit = null;
      swipe = null; keys = null; releasedFrom = null; waitingHand = null; darts3d = null; impact = null;
      zoom.s = 1; zoom.x = 0; zoom.y = 0;
      hintButton.addEventListener('click', () => { hintOn = !hintOn; paintHint(); });
      grabButton.addEventListener('click', () => {
        if (grabbing) return;
        grabbing = true;
        ctx.quiet(ctx.act('grab').catch((error) => { grabbing = false; throw error; }));
      });
      callout.addEventListener('animationend', () => { callout.hidden = true; });
      // Pinch to look closer while no dart is in hand; picking the dart up eases back to the full board.
      const touches = new Map();
      let pinch = null, panFrom = null;
      stage.addEventListener('pointerdown', (e) => {
        if (swipe) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: zoom.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, x: zoom.x, y: zoom.y };
          panFrom = null;
        } else if (zoom.s > 1) panFrom = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: zoom.x, y: zoom.y };
      });
      stage.addEventListener('pointermove', (e) => {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (swipe) return;
        if (pinch && touches.size === 2) {
          const [a, b] = [...touches.values()];
          zoom.s = pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
          zoom.x = pinch.x + (a.x + b.x) / 2 - pinch.mx;
          zoom.y = pinch.y + (a.y + b.y) / 2 - pinch.my;
          applyZoom();
        } else if (panFrom?.id === e.pointerId) {
          zoom.x = panFrom.x + e.clientX - panFrom.cx;
          zoom.y = panFrom.y + e.clientY - panFrom.cy;
          applyZoom();
        }
      });
      const lift = (e) => {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
        if (panFrom?.id === e.pointerId) panFrom = null;
      };
      stage.addEventListener('pointerup', lift);
      stage.addEventListener('pointercancel', lift);
      stage.addEventListener('dblclick', resetZoom);
      const pickUp = (e) => {
        if (!ready() || swipe || e.button !== 0) return;
        resetZoom();
        const scale = board.getBoundingClientRect().width * SCALE / WIDTH;
        if (!scale) return;
        e.preventDefault();
        keys = null;
        swipe = { id: e.pointerId, scale, x: e.clientX, y: e.clientY, samples: [], dx: 0, dy: 0, pickedAt: performance.now() };
        sample(e);
        playGrip();
        board.setPointerCapture?.(e.pointerId);
      };
      grip.addEventListener('pointerdown', pickUp);
      swipeButton.addEventListener('pointerdown', pickUp);
      board.addEventListener('pointermove', (e) => {
        if (swipe?.id === e.pointerId) sample(e);
      });
      board.addEventListener('pointerup', (e) => {
        if (swipe?.id !== e.pointerId) return;
        sample(e);
        const { dx, dy, samples } = swipe;
        const hand = pose();
        const from = darts3d?.releasePoint(hand) ?? {
          x: hand.x - 0.04,
          y: hand.y + 0.12,
          depth: DART_HAND_DEPTH + 9 * hand.lift - 18 * hand.scale,
          scale: hand.scale,
        };
        swipe = null;
        if (dx > -0.05 || Math.hypot(dx, dy) < 0.1) return;
        const first = samples[0], last = samples.at(-1);
        const seconds = Math.max(0.032, (last.t - first.t) / 1000);
        submit(dx, dy, (last.x - first.x) / seconds, (last.y - first.y) / seconds, from, hand);
      });
      const cancelSwipe = (e) => { if (swipe?.id === e.pointerId) swipe = null; };
      board.addEventListener('pointercancel', cancelSwipe);
      board.addEventListener('lostpointercapture', cancelSwipe);
      const clearKeys = () => { keys = null; };
      board.addEventListener('blur', clearKeys);
      swipeButton.addEventListener('blur', clearKeys);
      root.addEventListener('keydown', (e) => {
        if ((e.target !== board && e.target !== swipeButton) || !ready() || swipe) return;
        if (e.key === 'Escape') { keys = null; return; }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (delta) {
          e.preventDefault();
          keys ??= { dx: -origin().x, dy: -origin().y };
          const step = e.shiftKey ? 0.20 : 0.055;
          keys.dx = Math.max(-2.5, Math.min(-0.05, keys.dx + step * delta[0]));
          keys.dy = clamp(keys.dy + step * delta[1], 1.5);
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) submit(keys?.dx ?? -origin().x, keys?.dy ?? -origin().y, -view.swipePace, 0);
        }
      });
      const surface = tabletop;
      window.GL3?.load().then(() => {
        if (tabletop !== surface || !surface.isConnected) return;
        darts3d = makeDarts3d(surface);
        if (darts3d && view) darts3d.paint(view);
      }).catch(() => {});
      frame = requestAnimationFrame(tick);
    }

    function paintHint() {
      const hint = view?.hint;
      hintButton.setAttribute('aria-pressed', String(hintOn));
      hintButton.textContent = hintOn && hint ? `💡 Aim: ${hint.label}` : '💡 Hint';
      if (hint) {
        aim.style.left = `${xAt(hint.x) / WIDTH * 100}%`;
        aim.style.top = `${yAt(hint.y) / WIDTH * 100}%`;
      }
    }

    function applyZoom() {
      zoom.s = Math.max(1, Math.min(3.5, zoom.s));
      const mx = (zoom.s - 1) * tabletop.offsetWidth / 2, my = (zoom.s - 1) * tabletop.offsetHeight / 2;
      zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
      zoom.y = Math.max(-my, Math.min(my, zoom.y));
      tabletop.style.transform = zoom.s === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
    }

    function resetZoom() {
      zoom.s = 1; zoom.x = 0; zoom.y = 0;
      if (tabletop) applyZoom();
    }

    // Pace of the swipe so far, as the server will see it on release (board radii per second).
    function swipePace() {
      const samples = swipe?.samples;
      if (!samples || samples.length < 2) return 0;
      const first = samples[0], last = samples.at(-1), seconds = Math.max(0.032, (last.t - first.t) / 1000);
      return Math.min(6, Math.hypot(last.x - first.x, last.y - first.y) / seconds);
    }

    function sample(e) {
      const dx = (e.clientX - swipe.x) / swipe.scale, dy = (swipe.y - e.clientY) / swipe.scale;
      swipe.dx = dx; swipe.dy = dy;
      swipe.samples.push({ t: e.timeStamp, x: dx, y: dy });
      // Use a short window so changing direction or slowing down before release affects the throw.
      while (swipe.samples.length > 2 && e.timeStamp - swipe.samples[0].t > 105) swipe.samples.shift();
    }

    function submit(dx, dy, vx, vy, from = origin(), hand = null) {
      if (!ready()) return;
      const surface = tabletop;
      pending = true;
      hintOn = false;
      releasedFrom = from;
      waitingHand = hand && { ...hand, until: performance.now() + 1800 };
      playRelease(Math.hypot(vx, vy));
      ctx.quiet(ctx.act('throw', {
        dx: clamp(dx, 2.5), dy: clamp(dy, 3.2), vx: clamp(vx, 6), vy: clamp(vy, 6),
      }).catch((error) => {
        if (tabletop === surface) { waitingHand = null; releasedFrom = null; }
        throw error;
      }).finally(() => { if (tabletop === surface) pending = false; }));
    }

    function pose(now = performance.now()) {
      const start = origin(), dx = swipe?.dx ?? 0, dy = swipe?.dy ?? 0;
      const lift = swipe ? 1 - (1 - (reduce() ? 1 : c01((now - swipe.pickedAt) / 160))) ** 3 : 0;
      const x = start.x + (0.56 - start.x) * lift + dx * (1 - 0.18 * lift);
      const y = start.y + (-0.18 - start.y) * lift + dy * (1 - 0.18 * lift);
      const angle = keys ? Math.atan2(keys.dx, keys.dy) : Math.atan2(-start.x, -start.y);
      const scale = DART_HELD_SCALE + (DART_AIM_SCALE - DART_HELD_SCALE) * lift;
      return { x: clamp(x, 1.2), y: clamp(y, 1.1), angle, lift, scale, aiming: !!swipe };
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
      window.Snd?.play((t, K) => {
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
    function flashSection(shot) {
      hitFlash.innerHTML = '';
      const [bull, outer, t0, t1, d0, edge] = view.radii.map((r) => r * SCALE);
      const r = Math.hypot(shot.x, shot.y) * SCALE, i = view.numbers.indexOf(shot.number);
      if (!shot.number || r > edge) return;
      let shape;
      if (r <= bull) shape = `<circle cx="125" cy="125" r="${bull}"/>`;
      else if (r <= outer) shape = `<path fill-rule="evenodd" d="M${CENTER - outer} ${CENTER}a${outer} ${outer} 0 1 0 ${outer * 2} 0a${outer} ${outer} 0 1 0 ${-outer * 2} 0ZM${CENTER - bull} ${CENTER}a${bull} ${bull} 0 1 0 ${bull * 2} 0a${bull} ${bull} 0 1 0 ${-bull * 2} 0Z"/>`;
      else if (i >= 0) {
        const [inner, outerR] = r < t0 ? [outer, t0] : r <= t1 ? [t0, t1] : r < d0 ? [t1, d0] : [d0, edge];
        shape = sector(i * STEP, inner, outerR, '');
      }
      if (!shape) return;
      hitFlash.innerHTML = shape;
      hitFlash.classList.remove('ar-darts-lit');
      void hitFlash.getBoundingClientRect();
      hitFlash.classList.add('ar-darts-lit');
    }

    function flashHit(shot) {
      flashSection(shot);
      const prefix = ['Miss', 'Single', 'Double', 'Triple'][shot.multiplier];
      callout.textContent = shot.number && shot.number !== 25 ? `${prefix} ${shot.number}` : shot.label;
      callout.dataset.tone = shot.bust || !shot.number ? 'miss' : shot.multiplier >= 2 ? 'bull' : '';
      callout.hidden = false;
      callout.classList.remove('ar-darts-flash');
      void callout.offsetWidth;
      callout.classList.add('ar-darts-flash');
    }

    function showShot(shot) {
      const pieces = [player(shot.o)?.name ?? 'Player', shot.label];
      if (shot.bust) pieces.push('Bust, visit score restored');
      else if (view.x01) pieces.push(shot.win ? 'Checkout!' : `${shot.points} left`);
      else if (view.mode === 'clock') {
        pieces.push(shot.win ? 'Clock complete!' : `${shot.gain ? 'Next' : 'Still aiming for'} ${clockLabel(view.nextNumbers[shot.o])}`);
      } else {
        if (shot.win) pieces.push('All targets closed!');
        if (shot.marks) pieces.push(`+${shot.marks} marks`);
        if (shot.gain) pieces.push(`+${shot.gain} pts`);
      }
      result.textContent = pieces.join(' · ');
    }

    function tick(now) {
      frame = requestAnimationFrame(tick);
      if (!view) return;
      if (waitingHand && now >= waitingHand.until) waitingHand = null;
      const show = ready(), hand = waitingHand || pose(now);
      const drawHand = !flight && (show || !!waitingHand);
      grip.toggleAttribute('hidden', !show || !!swipe);
      swipeButton.disabled = !show;
      hintButton.disabled = !show;
      // While swiping, ring where the dart will land; its size is two standard deviations of the wobble.
      spreadEl.hidden = !swipe;
      if (swipe) {
        const o = origin(), r = 2 * (view.spreadBase + view.spreadPerPace * swipePace());
        spreadEl.style.left = `${xAt(o.x + swipe.dx) / WIDTH * 100}%`;
        spreadEl.style.top = `${yAt(o.y + swipe.dy) / WIDTH * 100}%`;
        spreadEl.style.width = `${2 * r * SCALE / WIDTH * 100}%`;
      }
      aim.hidden = !(hintOn && view.hint && show);
      // After the last dart of a visit the thrower pulls them from the board before the next player goes.
      const canGrab = mine() && view.grab && !flight && now >= readyAt;
      swipeButton.hidden = canGrab || (mine() && view.grab);
      grabButton.hidden = !canGrab;
      if (canGrab) {
        grabButton.disabled = grabbing;
        grabButton.textContent = `🖐 Grab darts · ${Math.max(0, Math.ceil((grabAt - now) / 1000))}s`;
      }
      held.toggleAttribute('hidden', !drawHand);
      guide.toggleAttribute('hidden', hand.aiming);
      const angle = hand.angle * 180 / Math.PI;
      held.setAttribute('transform', `${transform(hand.x, hand.y)} rotate(${angle})`);
      dartModel.setAttribute('transform', hand.aiming
        ? `rotate(${-angle - 12}) scale(${hand.scale}, ${hand.scale * 0.39})` : `scale(${hand.scale})`);
      let throwPose = null;
      if (flight) {
        const { shot, dot, from: start, duration } = flight;
        const time = c01((now - flight.start) / duration);
        const dx = shot.x - start.x, dy = shot.y - start.y;
        const pace = shot.pace ?? 2.2;
        // Gravity bows the path above the straight line: slow, lobbed throws arc higher than hard flicks.
        const lift = (0.04 + 0.07 * (1 - c01(pace / 6))) * Math.min(1.4, 0.6 + Math.hypot(dx, dy));
        const at = (t) => {
          const u = c01(t) * (1.07 - 0.07 * c01(t));   // drag: a touch quicker off the fingers, settling toward the board
          return {
            x: start.x + dx * u,
            y: start.y + dy * u + lift * 4 * u * (1 - u),
            depth: 0.45 + (start.depth ?? DART_HAND_DEPTH - 10) * (1 - u),
            scale: DART_BOARD_SCALE + ((start.scale ?? DART_HELD_SCALE) - DART_BOARD_SCALE) * (1 - u) ** 1.25,
            u,
          };
        };
        const cur = at(time), ahead = at(Math.min(1, time + 0.02)), behind = at(Math.max(0, time - 0.02));
        const { x, y, depth, scale, u } = cur;
        throwPose = { x, y, depth, scale, u, roll: time * 5,
          behind, ahead };
        const flightAngle = 0;
        const pinScale = 1 + (scale - DART_BOARD_SCALE) * 2.2;
        dot?.setAttribute('transform', `${transform(x, y)} rotate(${flightAngle}) scale(${pinScale})`);
        if (time >= 1) {
          flight = null;
          dot?.setAttribute('transform', transform(shot.x, shot.y));
          impact = shot.number ? { id: shot.id, at: now, power: 0.7 + 0.5 * c01((shot.pace ?? 2.2) / 6) } : null;
          showShot(shot);
          flashHit(shot);
          playLanding(shot);
          ctx.buzz?.(shot.bust ? [25, 40, 25] : 15);
        }
      }
      if (impact && now - impact.at > 380) impact = null;
      const age = impact ? (now - impact.at) / 1000 : 0;
      const quiver = impact ? { id: impact.id, angle: 0.035 * impact.power * Math.exp(-11 * age) * Math.sin(105 * age) } : null;
      noteHoles();
      darts3d?.draw(view.darts, drawHand ? hand : null, flight ? throwPose : null, flight?.shot.id, quiver, past);
    }

    // Remember where each dart landed so its hole stays in the board after the dart is pulled.
    function noteHoles() {
      if (!view) return;
      const [, , , , , edge] = view.radii;
      let added = false;
      for (const d of view.darts) {
        if (pastIds.has(d.id) || d.id === flight?.shot.id || Math.hypot(d.x, d.y) > edge) continue;
        pastIds.add(d.id);
        past.push({ x: d.x, y: d.y, seed: (d.id * 0.6180339) % 1 });
        added = true;
      }
      if (!added) return;
      if (past.length > 90) past.shift();
      holeG.innerHTML = past.map((h) => `<circle cx="${xAt(h.x)}" cy="${yAt(h.y)}" r="1.6" fill="#0a0706" stroke="#c9b88f" stroke-opacity=".45" stroke-width=".5"/>`).join('');
    }

    function paintPins() {
      pins.innerHTML = view.darts.map((d) => `<g data-shot="${d.id}" transform="${transform(d.x, d.y)}">
        <path d="M0 0L6 9L5 13L10 14L12 10L8 8Z"/><circle r="2"/>
      </g>`).join('');
      view.darts.forEach((d, i) => pins.children[i].style.setProperty('--dart-color', player(d.o)?.color ?? '#ffe198'));
      if (flight) {
        flight.dot = pins.querySelector(`[data-shot="${flight.shot.id}"]`);
        flight.dot?.setAttribute('transform', transform(0, -1.2));
      }
    }

    function renderScores() {
      const cricket = view.mode === 'cricket', clock = view.mode === 'clock', countup = view.mode === 'countup';
      const table = ctx.el('table', 'scores ar-darts-table');
      const head = ctx.el('thead'), headings = ctx.el('tr');
      const targets = cricket ? view.targets.map((n) => n === 25 ? 'Bull' : String(n)) : [];
      const columns = clock ? ['Next', 'Hit'] : countup ? ['Visits', 'Pts'] : [...targets, view.x01 ? 'Left' : 'Pts'];
      for (const title of ['Player', ...columns]) {
        const cell = ctx.el('th', '', title); cell.scope = 'col'; headings.append(cell);
      }
      head.append(headings); table.append(head);
      const body = ctx.el('tbody'); table.append(body);
      view.seats.forEach((_, i) => {
        const row = ctx.el('tr', view.next === i ? 'now' : '');
        const name = ctx.el('th', '', player(i)?.name ?? '?'); name.scope = 'row';
        name.style.color = player(i)?.color ?? '';
        row.classList.toggle('out', !view.active.includes(i));
        row.append(name);
        if (cricket) for (const marks of view.marks[i]) {
          const cell = ctx.el('td', marks === 3 ? 'closed' : '', ['–', '/', '×', '⊗'][marks]);
          cell.setAttribute('aria-label', marks === 3 ? 'Closed' : `${marks} of 3 marks`);
          row.append(cell);
        }
        if (clock) row.append(ctx.el('td', '', clockLabel(view.nextNumbers[i])));
        if (countup) row.append(ctx.el('td', '', `${view.visitsDone[i]}/${view.visitLimit}`));
        row.append(ctx.el('td', 'total', String(view.points[i])));
        body.append(row);
      });
      score.replaceChildren(table);
      if (view.checkout.length) score.append(ctx.el('p', 'ar-darts-checkout', `Checkout · ${view.checkout.join(' → ')}`));
    }

    function render(s, c) {
      noteHoles();
      const first = !view;
      view = s.darts; state = s; ctx = c;
      readyAt = performance.now() + view.readyIn * 1000;
      grabAt = performance.now() + view.grabIn * 1000;
      grabbing = false;
      paintHint();
      if (first) {
        const start = origin();
        grip.setAttribute('transform', transform(start.x, start.y));
        paintBoard();
        darts3d?.paint(view);
        root.querySelector('h2').textContent = `Darts · ${view.title}`;
      }
      if (!mine() || visit !== view.visit) { visit = view.visit; swipe = null; keys = null; }
      const shot = view.shot;
      if (shot?.id !== shown) {
        shown = shot?.id;
        flight = shot && !first && c.peek && !reduce() ? {
          shot, start: performance.now(),
          from: shot.o === view.me && releasedFrom ? releasedFrom : origin(),
          duration: Math.max(400, 600 - 30 * (shot.pace ?? 2.2)),
        } : null;
        if (shot && !first && c.peek && (shot.o !== view.me || !releasedFrom)) playRelease(shot.pace ?? 2.2);
        releasedFrom = null;
        waitingHand = null;
        if (shot && !flight) {
          showShot(shot);
          if (!first && c.peek) {
            flashHit(shot);
            playLanding(shot);
          }
        }
        if (!shot) result.textContent = '';
      }
      paintPins();
      const target = view.nextNumbers?.[view.next];
      for (const label of geometry.querySelectorAll('[data-number]')) {
        label.classList.toggle('ar-darts-next-number', Number(label.dataset.number) === target);
      }
      turn.textContent = s.phase === 'over' ? 'Game over' : view.next == null ? 'Final dart'
        : view.grab ? `${view.next === view.me ? 'Grab your darts' : `${player(view.next)?.name ?? 'Player'} is collecting darts`}`
        : `${view.next === view.me ? 'Your visit' : player(view.next)?.name ?? 'Player'} · ${view.left} left`;
      updateHint();
      renderScores();
    }

    function updateHint() {
      let rule = view.doubleOut ? 'Reach zero on a double.' : 'Reach exactly zero; any dart finishes.';
      if (view.mode === 'cricket') rule = 'Close 15–20 and bull. Extra hits score while a rival has the target open.';
      if (view.mode === 'clock') rule = view.next == null ? 'Hit 1–20 in order, then bull.'
        : `Next target: ${clockLabel(view.nextNumbers[view.next])}.`;
      if (view.mode === 'countup') rule = `Highest score after ${view.visitLimit} visits wins.`;
      hint.textContent = mine() ? `Swipe inward from the dart or the button below. The dart lands where the swipe ends; the ring shows how far a rushed swipe may stray. 💡 Hint shows a good spot. Pinch to zoom. ${rule}` : rule;
    }

    return { mount, render, unmount() { cancelAnimationFrame(frame); darts3d?.dispose(); darts3d = null; view = null; tabletop = null; } };
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
      if (next == null) return 'Final dart';
      const name = s.players.find((p) => p.id === seats[next])?.name;
      return next === s.darts.me ? `Your visit · ${left} left` : `${name ?? 'Player'} · ${left} left`;
    },
  };
})();
