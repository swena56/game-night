// Wind Archery: a 3D range (three.js) or a flat target face. On your turn: drag to move the sight over the
// target (it moves like a trackpad, so your finger never hides the gold), hold to draw, and let go to loose;
// or nudge with ◀ ▲ ▼ ▶ and tap 🏹 Loose. The server says where the arrow lands; every screen plays the flight.
// #177: each end is a course (🍎 apple, 🎈 balloons, 🪝 a swinging face you lead), 🔥 a fire arrow once an end
// (gold doubles, else nothing), ✨ golden streaks, slow motion on big shots, a crowd, and a 🏹 shoot-off for ties.
UI.archery = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, queue = [], seen = 0, primed = false, lastDraw = 0, shotAt = 0, endSeen = 0;
  let aim = { x: 0, y: 0 }, breath = false, fire = false, hold = null, popT = 0;
  let swT0 = null, corr = 0, corrT = 0;      // the swinging face's clock (seconds, performance.now based) and a jump easing out
  const $ = (id) => document.getElementById(id);
  const HIT = 1.3;       // seconds on the hit close-up
  const V = () => S.archery;
  const colorOf = (i) => ctx?.player(V().seats[i])?.color ?? '#ccc';
  const nameOf = (i) => ctx?.player(V().seats[i])?.name ?? '?';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !V().between;
  const busy = () => !!(anim || queue.length);
  const canShoot = () => myTurn() && !busy();
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

  function mount(main, side) {
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
      if (!canShoot() || e.target.closest('button, .ar-done')) return;
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
    stage.addEventListener('pointercancel', () => { hold = null; });
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
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
    ctx.quiet(ctx.act('shoot', { ax: +clamp(aim.x + s.x, a).toFixed(3), ay: +clamp(aim.y + s.y, a).toFixed(3), breath: useBreath, fire: useFire, held: +held.toFixed(2), ...extra }));
    controls();
  }

  function controls() {
    if (!S?.archery) return;
    const v = V(), go = canShoot(), mine = myTurn();
    $('arLoose').disabled = !go;
    $('arLoose').classList.toggle('ar-ready', go);
    $('arCtl').classList.toggle('ar-off', !mine);
    const left = v.me != null && v.breath[v.me];
    if (!left) breath = false;
    $('arBreath').disabled = !mine || !left;
    $('arBreath').classList.toggle('on', breath);
    $('arBreath').textContent = left ? (breath ? '🧘 Steady: on' : '🧘 Steady') : '🧘 used';
    const fl = v.me != null && !!v.fire?.[v.me] && v.kind !== 'shootoff';
    if (!fl) fire = false;
    $('arFire').disabled = !mine || !fl;
    $('arFire').hidden = v.kind === 'shootoff' || !v.fire;
    $('arFire').classList.toggle('on', fire);
    $('arFire').textContent = fl ? (fire ? '🔥 Fire: on' : '🔥 Fire') : '🔥 used';
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = V();
    if (!primed) { primed = true; seen = v.shot?.id ?? 0; endSeen = v.done > 0 || v.between ? (v.kind === 'shootoff' ? `so${v.end}` : v.end) : null; }  // a shot from before you opened the page isn't replayed
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

  function pop(shot) {
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

  return { mount, unmount, render };
})();
