// Ice Stones: the sheet in 3D (three.js) or a flat top-down house. On your turn: set the 🧹 broom (tap or drag the
// ice, or ◀ ▶), the weight (the zones under the slider say guard / draw / hit) and the curl, then 🥌 Throw. #187: the
// stone then slides live on the server, and you sweep it as it goes (hold the 🧹 pad, scrub it to sweep hard): the
// marker on the ice shows where it will stop if you keep doing what you're doing. Its tracks stream to every phone
// (fast()) and play back a moment behind, smoothly between frames. #186: the count is shown as it stands (the gold
// measuring ring through the best rival stone, numbers on the stones that count) and explained after each end.
UI.stones = (() => {
  let still = false;
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, queue = [], seen = 0, primed = false, camMode = 'auto', lastDraw = 0, thrownAt = 0, lastT = 0;
  // the throw being set up (kept between turns, like a player's habit): a draw to the button, aimed for the curl
  let aim = -0.95, weight = 0.48, curl = 1;
  // live sweeping: the finger on the pad (or the ice), how fast it scrubs, what was last sent
  const pad = { down: false, scrub: 0, lx: 0, ly: 0, lt: 0, sent: -1, sentAt: 0, key: false };
  const $ = (id) => document.getElementById(id);
  const FPS = 30;

  const colorOf = (i) => ctx?.player(S.stones.seats[i])?.color ?? '#ccc';
  const nameOf = (i) => ctx?.player(S.stones.seats[i])?.name ?? '?';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !S.stones.between && S.stones.sliding == null;
  const sheet = () => S.stones.sheet;
  const busy = () => !!(anim || queue.length);

  // ---------- the physics, as the server has it (games/stones.py Slide), for the path preview and the stop marker
  const PH0 = { fric: 0.75, curl: 0.13, vc: 0.8, sweep: [[1, 1], [0.93, 0.8], [0.86, 0.6]], from: 7.5, dt: 1 / 120, fk: 1, ck: 1, wd: 0.7, lo: 19, hi: 32, vmax: 8.8, lag: 0.45 };
  const ph = () => S?.stones?.phys || PH0;
  function speedOf(w) {
    const p = ph(), sh = sheet();
    if (w <= p.wd) return Math.sqrt(2 * p.fric * (p.lo + (p.hi - p.lo) * w / p.wd - sh.start));
    const v = Math.sqrt(2 * p.fric * (p.hi - sh.start));
    return v + (p.vmax - v) * (w - p.wd) / (1 - p.wd);
  }
  function weightFor(stop) {  // the weight that stops a straight, unswept stone at y = stop on this ice
    const p = ph(), sh = sheet(), v = Math.sqrt(2 * p.fric * p.fk * Math.max(0, stop - sh.start));
    const lo = speedOf(0), hi = speedOf(p.wd);
    if (v <= hi) return v < lo ? 0 : Math.max(0, Math.min(p.wd, ((sh.start + v * v / (2 * p.fric)) - p.lo) / (p.hi - p.lo) * p.wd));
    return Math.min(1, p.wd + (v - hi) / (p.vmax - hi) * (1 - p.wd));
  }
  // slide one stone (no collisions) from (x, y) at (vx, vy); `lvl` sweeping; returns the path every `every` steps
  function glide(x, y, vx, vy, spin, lvl, every = 8, stopAt = 1e9) {
    const p = ph(), sh = sheet(), pts = [[x, y]];
    for (let n = 0; n < 4000; n++) {
      const sp = Math.hypot(vx, vy);
      if (sp < 1e-3 || y > sh.back + sh.r || Math.abs(x) > sh.half - sh.r || y > stopAt) break;
      const swept = lvl && y > p.from && y < sh.back;
      const [fm, cm] = swept ? p.sweep[lvl] : [1, 1];
      const ns = Math.max(0, sp - p.fric * p.fk * fm * p.dt);
      let ux = vx / sp, uy = vy / sp;
      if (spin && ns > 0) {
        const a = spin * p.curl * p.ck * cm * 2 * p.vc / (ns * ns + p.vc * p.vc) * p.dt, c = Math.cos(a), s = Math.sin(a);
        [ux, uy] = [ux * c + uy * s, uy * c - ux * s];
      }
      vx = ux * ns; vy = uy * ns; x += vx * p.dt; y += vy * p.dt;
      if (n % every === 0) pts.push([x, y]);
      if (ns === 0) break;
    }
    pts.push([x, y]);
    return { pts, x, y, out: y > sh.back + sh.r || Math.abs(x) > sh.half - sh.r };
  }
  function launchPath(stopAt) {
    const sh = sheet(), v = speedOf(weight), d = Math.hypot(aim, sh.tee - sh.start);
    return glide(0, sh.start, v * aim / d, v * (sh.tee - sh.start) / d, curl, 0, 8, stopAt);
  }
  // the weight's zone, from where a straight unswept stone would stop
  function zoneOf(w) {
    const p = ph(), sh = sheet();
    if (w > p.wd) return w > 0.88 ? ['peel', '💥 Peel', 'clears a stone right out'] : ['hit', '🎯 Hit', 'knocks a stone out'];
    const stop = sh.start + speedOf(w) ** 2 / (2 * p.fric * p.fk), d = stop - sh.tee;
    if (stop < sh.hog) return ['short', '⚠️ Too light', 'stops short of the hog line'];
    if (stop < sh.tee - sh.house - sh.r) return ['guard', '🛡 Guard', `stops ${(sh.tee - sh.house - stop).toFixed(1)} m short of the house`];
    if (stop <= sh.tee + sh.house + sh.r) return ['draw', '🏠 Draw', Math.abs(d) < 0.3 ? 'stops on the button' : `stops ${Math.abs(d).toFixed(1)} m ${d < 0 ? 'short of' : 'past'} the button`];
    return ['through', '↗ Through', 'slides through the house'];
  }
  const ZONES = [['short', '#8a93a3'], ['guard', '#5b8def'], ['draw', '#2ec27e'], ['through', '#e0a030'], ['hit', '#f07a3a'], ['peel', '#e04848']];

  function mount(main, side) {
    gl = null; flat = null; anim = null; queue = []; seen = 0; primed = false; camMode = 'auto';
    main.innerHTML = `<div class="ic"><div class="ic-hud"><span id="icEnd"></span><span id="icCount" class="ic-count"></span><span id="icTurn"></span></div>
      <div class="ic-stage" id="icStage">
        <button class="ic-cam ghost-btn" id="icCam" hidden title="Switch view">👁 Sheet</button>
        <div class="ic-live" id="icLive" hidden><b id="icSpeed"></b><span id="icCurlNow"></span><span id="icStop"></span><i id="icBrooms"></i></div>
        <div class="ic-done" id="icDone" hidden><h3 id="icDoneTitle"></h3><p id="icDoneWhy" class="ic-why"></p><div id="icDoneCard"></div></div>
      </div>
      <div class="ic-ctl" id="icCtl">
        <div class="ic-row">
          <span class="ic-lbl">🧹 Aim</span>
          <div class="ic-dial"><button data-a="-1" aria-label="Aim left">◀</button><b id="icAim"></b><button data-a="1" aria-label="Aim right">▶</button></div>
          <div class="ic-seg" id="icCurl" role="group" aria-label="Curl">
            <button data-c="-1" title="The stone bends left as it slows">↺ Left</button><button data-c="1" title="The stone bends right as it slows">↻ Right</button>
          </div>
        </div>
        <div class="ic-row ic-wrow">
          <span class="ic-lbl">💪 Weight</span>
          <div class="ic-wbox">
            <div class="ic-wline"><button data-w="-1" aria-label="Less weight">−</button>
              <div class="ic-slide"><input type="range" id="icWeight" min="0" max="1000" step="1" aria-label="Weight"><div class="ic-zones" id="icZones"></div></div>
              <button data-w="1" aria-label="More weight">+</button></div>
            <div class="ic-zone" id="icZone"><b></b> <span></span></div>
          </div>
        </div>
        <div class="ic-row"><button class="ic-throw" id="icThrow">🥌 Throw</button></div>
        <button class="ic-pad" id="icPad" hidden aria-label="Hold to sweep"><span class="ic-padtxt">🧹 <b>HOLD TO SWEEP</b><small>scrub fast to sweep hard</small></span><span class="ic-meter"><i id="icMeter"></i></span></button>
      </div>
      <p id="icHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scoreboard</h3><div id="icCard" class="ic-card"></div>'
      + '<label class="ic-sweepsnd">🧹 Sweeping sound <select id="icSweepSnd"><option value="soft">Soft</option><option value="off">Off</option></select></label></div>';
    $('icSweepSnd').value = sweepPref();
    $('icSweepSnd').onchange = (e) => { try { localStorage.setItem('stones.sweepSound', e.target.value); } catch {} if (e.target.value === 'off') brush(0); };
    const stage = $('icStage');
    $('icCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.id === 'icPad') return;
      if (b.dataset.a) setAim(aim + +b.dataset.a * 0.05);
      else if (b.dataset.c) { const c = +b.dataset.c; if (c !== curl) { curl = c; setAim(-aim); } }  // the skip's broom moves across with the turn
      else if (b.dataset.w) weight = Math.max(0, Math.min(1, Math.round(weight * 100 + +b.dataset.w) / 100));
      else if (b.id === 'icThrow') return throwNow();
      controls();
    });
    $('icWeight').addEventListener('input', (e) => { weight = +e.target.value / 1000; controls(); });
    $('icCam').onclick = () => { camMode = camMode === 'house' ? 'sheet' : 'house'; controls(); };
    // the sweep pad: hold to sweep, scrub (move the finger back and forth) to sweep hard
    const padEl = $('icPad');
    padEl.addEventListener('pointerdown', (e) => { e.preventDefault(); try { padEl.setPointerCapture(e.pointerId); } catch {} sweepDown(e); });
    padEl.addEventListener('pointermove', sweepMove);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) padEl.addEventListener(t, sweepUp);
    padEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // the ice: on your turn, tap to put the broom there, drag sideways to nudge it (finely) or up/down for the
    // weight; while your stone slides, hold or scrub it to sweep
    stage.style.touchAction = 'none';
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .ic-done')) return;
      if (mySlide()) { try { stage.setPointerCapture(e.pointerId); } catch {} return sweepDown(e); }
      if (!myTurn() || busy()) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      drag = { x: e.clientX, y: e.clientY, aim, weight, ix: iceAt(e), lock: null };
    });
    stage.addEventListener('pointermove', (e) => {
      if (pad.down) return sweepMove(e);
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.lock && Math.hypot(dx, dy) > 9) drag.lock = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (drag.lock === 'x') { const ix = iceAt(e); if (ix != null && drag.ix != null) setAim(drag.aim + (ix - drag.ix) * 0.5); }
      else if (drag.lock === 'y') weight = Math.max(0, Math.min(1, drag.weight - dy / (stage.clientHeight * 2.2)));
      if (drag.lock) controls();
    });
    const stop = (e) => {
      if (pad.down) return sweepUp(e);
      if (drag && !drag.lock) { const x = iceAt(e); if (x != null) { setAim(x); controls(); } }  // a tap: the broom goes there
      drag = null;
    };
    stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', () => { drag = null; if (pad.down) sweepUp(); });
    document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); if ($('icCam')) $('icCam').hidden = !gl; });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    brush(0); sweepUp();
    document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey);
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
  }

  const iceAt = (e) => (gl || flat)?.iceX?.(e.clientX, e.clientY) ?? null;
  function setAim(x) {
    const h = S?.stones?.sheet?.half ?? 2.2;
    aim = Math.max(-h + 0.2, Math.min(h - 0.2, Math.round(x * 100) / 100));
  }

  function onKey(e) {
    if (!$('icStage') || e.target.closest?.('input, textarea, select')) return;
    if (mySlide() && (e.key === ' ' || e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (e.type === 'keydown' && !pad.key) { pad.key = true; sendSweep(); } else if (e.type === 'keyup') { pad.key = false; sendSweep(); }
      return;
    }
    if (e.type !== 'keydown' || !myTurn() || busy()) return;
    const k = { ArrowLeft: () => setAim(aim - 0.05), ArrowRight: () => setAim(aim + 0.05),
      ArrowUp: () => { weight = Math.min(1, weight + 0.01); }, ArrowDown: () => { weight = Math.max(0, weight - 0.01); }, Enter: throwNow }[e.key];
    if (k) { e.preventDefault(); k(); controls(); }
  }

  function throwNow() {
    if (!myTurn() || busy()) return;
    thrownAt = performance.now();
    SND.push(true); ctx.buzz?.(15);
    ctx.quiet(ctx.act('throw', { aim: +aim.toFixed(3), weight: +weight.toFixed(3), curl }));
  }

  // ---------- sweeping your own stone
  const mySlide = () => !!(S?.stones && S.stones.sliding != null && S.stones.sliding === S.stones.me && S.phase === 'playing');
  const myLevel = () => (pad.key ? 2 : !pad.down ? 0 : pad.scrub > 520 ? 2 : 1);
  function sweepDown(e) {
    if (!mySlide()) return;
    pad.down = true; pad.scrub = 0; pad.lx = e?.clientX ?? 0; pad.ly = e?.clientY ?? 0; pad.lt = performance.now();
    ctx.buzz?.(8); sendSweep();
  }
  function sweepMove(e) {
    if (!pad.down) return;
    const now = performance.now(), dt = Math.max(8, now - pad.lt), d = Math.hypot(e.clientX - pad.lx, e.clientY - pad.ly);
    pad.scrub = pad.scrub * 0.6 + (d / dt) * 1000 * 0.4;   // px a second, smoothed
    pad.lx = e.clientX; pad.ly = e.clientY; pad.lt = now;
    sendSweep();
  }
  function sweepUp() {
    if (!pad.down) return;
    pad.down = false; pad.scrub = 0; sendSweep();
  }
  function sendSweep(force = false) {
    if (!ctx || !mySlide()) { pad.sent = -1; return; }
    const l = myLevel(), now = performance.now();
    if (l !== pad.sent || force || (l && now - pad.sentAt > 250)) {
      if (l !== pad.sent && l) ctx.buzz?.(l === 2 ? 12 : 6);
      pad.sent = l; pad.sentAt = now;
      ctx.input({ sweep: l }, true);
    }
  }

  function controls() {
    const v = S?.stones;
    if (!v || !$('icAim')) return;
    $('icAim').textContent = aim === 0 ? 'centre' : `${aim < 0 ? '◀' : '▶'} ${Math.abs(aim).toFixed(2)}`;
    $('icWeight').value = Math.round(weight * 1000);
    const [zk, zl, zd] = zoneOf(weight);
    const zb = $('icZone');
    zb.dataset.z = zk; zb.firstElementChild.textContent = zl; zb.lastElementChild.textContent = zd;
    zones();
    for (const b of $('icCurl').children) b.classList.toggle('on', +b.dataset.c === curl);
    const go = myTurn() && !busy();
    $('icThrow').disabled = !go;
    $('icThrow').classList.toggle('ic-ready', go);
    const sliding = mySlide();
    $('icCtl').classList.toggle('ic-off', !myTurn() && !sliding);
    $('icCtl').classList.toggle('ic-sliding', sliding);
    $('icPad').hidden = !sliding;
    if (!sliding && pad.down) sweepUp();
    $('icCam').textContent = camMode === 'house' ? '👁 Sheet' : '👁 House';
  }
  // the coloured bands under the weight slider: where a stone thrown at that weight stops
  let zonesKey = '';
  function zones() {
    const p = ph(), sh = sheet(), key = `${p.fk}`;
    if (key === zonesKey) return;
    zonesKey = key;
    const cuts = [0, weightFor(sh.hog), weightFor(sh.tee - sh.house - sh.r), weightFor(sh.tee + sh.house + sh.r), p.wd, 0.88, 1];
    const box = $('icZones'); box.innerHTML = '';
    ZONES.forEach(([k, c], i) => {
      const w = Math.max(0, cuts[i + 1] - cuts[i]);
      if (w <= 0) return;
      const z = document.createElement('i'); z.style.flex = `${w} 0 0`; z.style.background = c; z.dataset.z = k;
      z.textContent = { short: '', guard: 'guard', draw: 'draw', through: '', hit: 'hit', peel: 'peel' }[k];
      box.append(z);
    });
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = S.stones;
    const now = performance.now();
    if (!primed) { primed = true; seen = v.shot?.live ? (v.shot.id - 1) : (v.shot?.id ?? 0); }  // a throw from before you opened the page isn't replayed (a live one is joined)
    if (v.shot && v.shot.id !== seen && v.shot.id > seen) { seen = v.shot.id; queue.push({ ...v.shot, tracks: v.shot.tracks.map((t) => ({ ...t, f: [...t.f] })), rx: now }); }
    else if (v.shot) {
      // the same shot again: a live one has finished (take the server's final tracks) or moved on
      const sh = anim?.shot?.id === v.shot.id ? anim.shot : queue.find((q) => q.id === v.shot.id);
      if (sh && sh.live && !v.shot.live) Object.assign(sh, { ...v.shot, tracks: v.shot.tracks.map((t) => ({ ...t, f: [...t.f] })), live: false, rx: now });
      else if (sh && sh.live) mergeTracks(sh, v.shot.tracks.map((t) => [t.k, t.s, 0, t.f, t.out ? 2 : 0]), v.shot.frames, now);
    }
    const ex = v.extra ? `⚖️ Extra end ${v.extra}` : `🧊 End ${v.end} of ${v.ends}`;
    $('icEnd').textContent = ex;
    const n = v.order.length;
    const hotNow = v.thrown === v.hot;
    const who = v.next != null ? (v.next === v.me ? 'Your' : `${nameOf(v.next)}'s`) : '';
    $('icTurn').textContent = v.between ? `End ${v.end} done` : v.sliding != null ? (v.sliding === v.me ? '🧹 Sweep it!' : `${nameOf(v.sliding)}'s stone…`)
      : v.next != null ? `${who} stone · ${v.thrown + 1} of ${n}${hotNow ? ' · 🔥 HOT' : ''}` : '';
    $('icTurn').classList.toggle('ic-hot', hotNow && !v.between && v.sliding == null);
    controls();
    countLine();
    renderCard($('icCard'));
    renderDone();
    hint();
  }

  // who's counting right now (or, mid-throw, as it stood before it)
  function countLine() {
    const v = S.stones, c = v.between ? v.endMeasure : v.count, el = $('icCount');
    if (!c || c.side == null) { el.textContent = Object.keys(c?.d || {}).length ? '🎯 Dead heat' : '🎯 House empty'; el.style.color = ''; return; }
    el.textContent = `🎯 ${c.side === v.me ? 'You' : nameOf(c.side)} ${v.between ? 'scored' : 'lying'} ${c.pts}`;
    el.style.color = colorOf(c.side);
  }

  function hint() {
    const v = S.stones;
    const t = S.phase !== 'playing' ? '' : v.between ? 'Next end in a moment…'
      : mySlide() ? 'Hold the 🧹 pad (or the ice) to sweep: the stone runs further and curls less. Scrub fast to sweep hard. The ring on the ice shows where it will stop.'
        : !myTurn() ? (busy() ? '' : 'Watch the ice.')
          : `Tap the ice for the broom (drag sideways to nudge it, up/down for weight). The stone bends ${curl > 0 ? 'right ↻' : 'left ↺'} as it slows, so aim ${curl > 0 ? 'left' : 'right'} of where you want it. Then 🥌 Throw and sweep it home.`;
    if ($('icHint').textContent !== t) $('icHint').textContent = t;
  }

  function renderCard(box, compact = false) {
    const v = S.stones; box.innerHTML = '';
    const t = ctx.el('table', 'scores ic-scores');
    const head = ctx.el('tr');
    head.append(ctx.el('th', '', ''), ...v.endsLog.map((_, k) => ctx.el('th', '', k < v.ends ? String(k + 1) : `X${k - v.ends + 1}`)), ctx.el('th', '', 'Σ'));
    if (!compact) head.append(ctx.el('th', '', '🥌'));
    t.append(head);
    v.seats.forEach((pid, i) => {
      const row = ctx.el('tr', v.next === i ? 'now' : '');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm, ...v.endsLog.map(([side, pts]) => ctx.el('td', side === i ? 'ic-pt' : '', side === i ? String(pts) : '·')));
      row.append(ctx.el('td', '', ''));
      row.lastChild.append(ctx.el('b', '', String(v.points[i])));
      if (!compact) {
        let left = 0;
        for (let k = v.thrown; k < v.order.length; k++) if (v.order[k] === i) left++;
        row.append(ctx.el('td', 'ic-left', left ? '●'.repeat(left) : '–'));
      }
      t.append(row);
    });
    box.append(t);
    if (!compact) box.append(ctx.el('p', 'hint left', `🎯 Only the player nearest the button scores: 1 for each of their stones in the house closer than anyone else's best. 🔥 Stone ${v.hot + 1} of this end is hot (counts 2). Hammer: ${nameOf(v.order[v.order.length - 1])}.`));
  }

  function renderDone() {
    const v = S.stones;
    if (!v.between) { $('icDone').hidden = true; return; }
    const [side, pts] = v.endsLog[v.endsLog.length - 1] || [null, 0];
    const m = v.endMeasure;
    $('icDoneTitle').textContent = side == null ? `🏁 End ${v.end}: blank end` : `🏁 End ${v.end}: ${nameOf(side)} scores ${pts}`;
    $('icDoneTitle').style.color = side == null ? '' : colorOf(side);
    let why = 'Nobody had a stone in the house.';
    if (side != null) {
      const n = m?.ids?.length ?? pts;
      why = m?.ring != null ? `${n} stone${n !== 1 ? 's' : ''} inside the gold ring — closer to the button than anyone else's best stone.`
        : `${n} stone${n !== 1 ? 's' : ''} in the house, and nobody else had one there.`;
      if (pts > n) why += ' 🔥 The hot stone counted double.';
    } else if (m && Object.keys(m.d || {}).length) why = 'Two stones were exactly as close: a dead heat, nobody scores.';
    $('icDoneWhy').textContent = why;
    renderCard($('icDoneCard'), true);
  }

  // ---------- live tracks: fast() packets carry the newest frames of every track [k, s, from, frames, 0 moving | 1 stopped | 2 out]
  function mergeTracks(sh, list, head, now) {
    for (const [k, s, i0, fr, flag] of list) {
      let tr = sh.tracks.find((t) => t.k === k);
      if (!tr) { tr = { k, s, f: [] }; sh.tracks.push(tr); }
      for (let j = 0; j < fr.length; j++) tr.f[i0 + j] = fr[j];
      for (let j = 0; j < tr.f.length; j++) if (!tr.f[j]) tr.f[j] = tr.f[j - 1] || fr[0];   // a gap from lost packets
      tr.flag = flag; if (flag === 2) tr.out = true;
    }
    if (head >= (sh.frames || 0)) { sh.frames = head; sh.rx = now; }
  }
  function fast(d) {
    const p = d?.ic;
    if (!p || !S?.stones) return;
    const sh = anim?.shot?.id === p.id ? anim.shot : queue.find((q) => q.id === p.id);
    if (!sh || !sh.live) return;
    mergeTracks(sh, p.t, p.h, performance.now());
    sh.sw = p.sw;
  }

  // ---------- playback: where every stone is right now (between the 30 fps frames, smoothly)
  // returns [{id, o, hot, x, y, gone, moving}] for drawing
  function positions() {
    const v = S.stones;
    if (!anim) {
      if (!queue.length) return v.stones.map((s) => ({ ...s }));
      return queue[0].before.map((s) => ({ ...s }));  // a throw waiting to play: the stones as they were before it
    }
    const sh = anim.shot, f = anim.f;
    const list = [...sh.before.map((s) => ({ ...s })), { id: sh.new, o: sh.by, hot: sh.hot, x: 0, y: sheet().start, fresh: true }];
    for (const tr of sh.tracks) {
      const s = list[tr.k];
      if (!s || !tr.f.length) continue;
      const k = f - tr.s, n = tr.f.length;
      const i = Math.max(0, Math.min(n - 1, Math.floor(k))), a = Math.max(0, Math.min(1, k - i));
      const p0 = tr.f[i], p1 = tr.f[Math.min(n - 1, i + 1)];
      s.x = p0[0] + (p1[0] - p0[0]) * a; s.y = p0[1] + (p1[1] - p0[1]) * a;
      const ended = (!sh.live || tr.flag >= 1 || tr.out) && k >= n - 1;
      s.moving = k >= 0 && !ended;
      if (s.moving && i + 1 < n) { s.vx = (p1[0] - p0[0]) * FPS; s.vy = (p1[1] - p0[1]) * FPS; }
      else if (s.moving && n > 1) { s.vx = (tr.f[n - 1][0] - tr.f[n - 2][0]) * FPS; s.vy = (tr.f[n - 1][1] - tr.f[n - 2][1]) * FPS; }
      if ((tr.out || tr.short) && k >= n - 1) s.gone = Math.min(1, (k - n + 1) / 12);
    }
    if (!sh.tracks.some((tr) => tr.k === list.length - 1)) list[list.length - 1].gone = 1;
    return list;
  }

  // the thrown stone right now: its speed, which way it bends, how hard it's swept, and where it would stop
  let proj = null, projAt = 0;
  function liveInfo(list, now) {
    if (!anim) return null;
    const sh = anim.shot, st = list[list.length - 1], P = ph(), shh = sheet();
    if (!st || st.gone || !st.moving) return null;
    const sp = Math.hypot(st.vx || 0, st.vy || 0);
    const mine = sh.live && sh.by === S.stones.me;
    const lvl = Math.max(mine ? myLevel() : 0, sh.live ? (sh.sw || 0) : (sh.sweep || 0));
    const zone = st.y > P.from && st.y < shh.back;
    const hit = sh.tracks.length > 1;   // after a hit the stop marker would be a guess
    if (!hit && sp > 0.05 && now - projAt > 90) {
      projAt = now;
      const g = glide(st.x, st.y, st.vx, st.vy, sh.curl, zone || st.y < P.from ? lvl : 0, 1e9);
      proj = { x: g.x, y: g.y, out: g.out };
    }
    return { sp, lvl: zone ? lvl : 0, curl: sh.curl, x: st.x, y: st.y, o: sh.by, proj: hit ? null : proj, mine, zone };
  }
  function liveHud(info) {
    const box = $('icLive');
    if (!box) return;
    box.hidden = !info;
    if (!info) return;
    const shh = sheet();
    $('icSpeed').textContent = `💨 ${info.sp.toFixed(1)} m/s`;
    $('icCurlNow').textContent = info.curl > 0 ? '↻' : '↺';
    let stop = '';
    if (info.proj) {
      const p = info.proj, d = Math.hypot(p.x, p.y - shh.tee);
      stop = p.out ? '→ out' : p.y < shh.hog ? '→ short!' : d <= shh.house + shh.r ? (d < 0.3 ? '→ 🎯 button' : `→ house ${d.toFixed(1)} m`) : p.y < shh.tee ? '→ guard' : '→ past the house';
    }
    $('icStop').textContent = stop;
    const b = $('icBrooms');
    b.textContent = info.lvl === 2 ? '🧹🧹 HARD' : info.lvl === 1 ? '🧹 sweep' : info.zone ? '🧹 —' : '';
    b.className = info.lvl ? `ic-sw${info.lvl}` : '';
    box.style.setProperty('--who', colorOf(info.o));
    const m = $('icMeter'); if (m) m.style.width = `${[0, 55, 100][info.mine ? myLevel() : 0]}%`;
  }

  // #106: sweeping used to fire the app's 'sweep' blip every half second, a harsh hiss with a rising note. Now
  // it's one soft brushing hush: low, filtered noise with the brooms' stroke in it, fading in and out with the
  // sweeping, and it can be turned off (🧹 in the side panel).
  const sweepPref = () => { try { return localStorage.getItem('stones.sweepSound') || 'soft'; } catch { return 'soft'; } };
  let hush = null;
  function brush(level) {
    const on = level > 0 && sweepPref() !== 'off' && typeof prefs !== 'undefined' && prefs.sound && prefs.moves && !document.hidden;
    if (!on && !hush) return;
    try {
      if (!hush) {
        const dst = window.out?.(); if (!dst) return;
        const a = dst.context, sr = a.sampleRate, buf = a.createBuffer(1, sr, sr), d = buf.getChannelData(0);
        for (let i = 0, lp = 0; i < d.length; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp; }
        const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), depth = a.createGain();
        src.buffer = buf; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
        g.gain.value = 0; lfo.frequency.value = 3.2; depth.gain.value = 0; lfo.connect(depth).connect(g.gain);
        src.connect(bp).connect(g).connect(dst); src.start(); lfo.start();
        hush = { a, src, lfo, g, depth, bp, lvl: -1 };
      }
      const want = on ? 0.014 + 0.012 * level : 0;
      if (want === hush.lvl) return;
      hush.lvl = want;
      const t = hush.a.currentTime;
      hush.g.gain.setTargetAtTime(want, t, 0.08); hush.depth.gain.setTargetAtTime(want * 0.75, t, 0.08);
      hush.lfo.frequency.setTargetAtTime(2.4 + level * 1.6, t, 0.08);   // the strokes quicken when sweeping hard
      hush.bp.frequency.setTargetAtTime(800 + level * 350, t, 0.1);
      if (!on) { const h = hush; hush = null; setTimeout(() => { try { h.src.stop(); h.lfo.stop(); } catch {} }, 600); }
    } catch {}
  }

  // ---------- #121 the stones' own sounds, on the shared Snd kit (static/sfx.js), in a big cold arena: the push
  // out of the hack, a granite rumble on the pebble that follows the fastest stone, and a hard "clock" when two
  // stones meet (louder the harder they hit), panned across the sheet
  const ARENA = { room: 'arena', send: 0.7 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...ARENA, pan, vol })));
  const SND = {
    push: (mine) => snd((t, K, d) => {
      K.burst(d, t, { type: 'lowpass', f: 500, q: 0.7, vol: mine ? 0.3 : 0.15, tau: 0.03, buf: 'brown' });
      K.mode(d, t, 70, mine ? 0.18 : 0.08, 0.08);
      K.burst(d, t + 0.05, { type: 'bandpass', f: 1200, f1: 600, q: 0.6, vol: mine ? 0.06 : 0.03, tau: 0.08, dur: 0.4, attack: 0.05 });
    }),
    clock: (hard, x) => snd((t, K, d) => {
      const v = 0.25 + 0.75 * hard;
      K.burst(d, t, { type: 'bandpass', f: 2800 + 1200 * hard, q: 1.2, vol: 0.4 * v, tau: 0.003 });
      K.mode(d, t, 720, 0.16 * v, 0.02); K.mode(d, t, 1530, 0.08 * v, 0.012); K.mode(d, t, 2650, 0.04 * v, 0.007);
      K.mode(d, t, 260, 0.07 * v, 0.03);
    }, Math.max(-0.8, Math.min(0.8, x / 2.2)), 1),
  };
  const slideBed = (K, dst) => {
    const A = K.ctx, src = K.loopSrc('brown'), lp = A.createBiquadFilter(), g = A.createGain(), o = A.createOscillator(), og = A.createGain();
    const hiss = K.loopSrc('white'), bp = A.createBiquadFilter(), hg = A.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 1; o.type = 'sine'; o.frequency.value = 48; og.gain.value = 0.3; g.gain.value = 0;
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8; hg.gain.value = 0.05;  // the pebble under the running band
    src.connect(lp).connect(g); o.connect(og).connect(g); hiss.connect(bp).connect(hg).connect(g);
    const room = K.at({ ...ARENA, send: 0.4 });
    g.connect(room); o.start();
    return {
      set(l) { const t = A.currentTime; g.gain.setTargetAtTime(0.16 * l, t, 0.08); lp.frequency.setTargetAtTime(150 + 200 * l, t, 0.1); o.frequency.setTargetAtTime(40 + 18 * l, t, 0.1); },
      stop() { try { src.stop(); hiss.stop(); o.stop(); } catch {} },
    };
  };
  // how fast the fastest stone is going (0..1)
  const slideLevel = (list) => Math.min(1, list.reduce((m, s) => (s.moving ? Math.max(m, Math.hypot(s.vx || 0, s.vy || 0)) : m), 0) / 3.2);

  function loop(now) {
    if (!$('icStage')) { raf = 0; brush(0); window.Snd?.bed('st.slide').set(0); return; }
    raf = requestAnimationFrame(loop);
    if (!S?.stones) return;
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
    if (!anim && queue.length) {
      const shot = queue.shift();
      // a live shot starts a little behind the server (the lag soaks up the network); a finished one from the start
      const lagF = (ph().lag || 0.45) * FPS;
      const head = shot.live ? (shot.frames || 0) + ((now - (shot.rx || now)) / 1000) * FPS : 0;
      anim = { shot, f: Math.min(0, head - lagF), hits: [], hi: 0 };
      if (!(shot.by === S.stones.me && now - thrownAt < 3000)) SND.push(false);
      controls(); hint();
    }
    let list;
    if (anim) {
      const sh = anim.shot, dtp = Math.min(0.25, (now - (anim.lastNow || now)) / 1000 || dt); anim.lastNow = now;   // a slow phone still plays in real time
      let rate = 1;
      if (sh.live) {
        const head = (sh.frames || 0) + ((now - (sh.rx || now)) / 1000) * FPS, want = head - (ph().lag || 0.45) * FPS;
        rate = Math.max(0.5, Math.min(1.6, 1 + (want - anim.f) * 0.05));
        anim.f = Math.min(anim.f + dtp * FPS * rate, head - 1);
      } else anim.f += dtp * FPS * (anim.f < sh.frames - 90 ? 2 : 1);   // a late joiner catches up
      const f = anim.f;
      // stones set moving by a hit: crack when the playhead gets there
      for (const tr of sh.tracks) if (tr.s > 0 && !anim.hits.includes(tr.k) && f >= tr.s && tr.f.length) {
        anim.hits.push(tr.k);
        const sp = tr.f.length > 1 ? Math.hypot(tr.f[1][0] - tr.f[0][0], tr.f[1][1] - tr.f[0][1]) * FPS : 1;
        SND.clock(Math.min(1, sp / 2.2), tr.f[0][0]);
        gl?.spark(tr.f[0][0], tr.f[0][1]); flat?.spark?.(tr.f[0][0], tr.f[0][1]);
      }
      list = positions();
      window.Snd?.bed('st.slide', slideBed).set(slideLevel(list));
      if (!sh.live && f >= sh.frames + 12) { anim = null; brush(0); window.Snd?.bed('st.slide').set(0); controls(); hint(); list = positions(); }
    } else list = positions();
    const info = liveInfo(list, now);
    brush(info?.lvl || 0);
    liveHud(info);
    if (mySlide()) sendSweep();
    else if (pad.down) sweepUp();
    // the end card waits for the shell's moment callout ("🥌 Ann scores 3!", room.moment) to fade, so the two never stack
    $('icDone').hidden = !S.stones.between || busy() || !!document.querySelector('.kit-callout');
    // on-demand drawing: every frame while anything moves, otherwise ~15 fps for the glows
    const idle = !anim && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    still = idle;  // idle redraws are drawn sharp and kept out of the frame-rate watch (#107/#109)
    (gl || flat)?.draw(now, list, info, dt);
  }
  // ---------- three.js sheet: world x = sheet x, world z = -sheet y, y up
  function canvasTex(T, w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (g) paint(g, w, h);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const sh = S?.stones?.sheet || { half: 2.2, start: 1, hog: 21, tee: 28, house: 1.83, back: 29.83, end: 31, r: 0.145 };
    const scene = new T.Scene(); scene.background = new T.Color(0x0b1220);
    const camera = new T.PerspectiveCamera(30, 1, 0.05, 200);
    const stg = GL3.stage(renderer, scene, {
      exposure: 1.05, hemi: [0xe8f2ff, 0x1a2233, 0.85],
      key: { i: 0.7, pos: [3, 14, -sh.tee + 6], area: 4, near: 2, far: 30 },
      env: { walls: 0x10182a, floor: 0xdfe8f2, lamp: 0xffffff, accent: 0x3a6ea5 },
      sky: { top: 0x070b16, horizon: 0x23365e, bottom: 0x0d1424, band: 0.08 },
    });
    stg.key.target.position.set(0, 0, -sh.tee);
    const low = stg.low;
    const len = sh.end + 3;
    // #120 the ice: a white sheet with the lines and the house painted under a layer of clear ice (their edges
    // a touch soft, a faint blue cast over them), fine pebble everywhere, frost built up along the boards, and
    // a worn, glossier path down the middle where the stones run. On fine graphics it's a clear coat over a
    // frosted base: the lamps make sharp highlights on the pebble, and the stones show in it (below).
    const TW = low ? 256 : 512, TH = low ? 2048 : 4096;
    const iceTex = canvasTex(T, TW, TH, (g, w, h) => {
      const k = h / len, X = (x) => (x / (2 * sh.half) + 0.5) * w, Y = (y) => h - (y + 2) * k, q = w / 256;
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#e9f0f6'); gr.addColorStop(0.08, '#eef4fa'); gr.addColorStop(0.5, '#f8fbff'); gr.addColorStop(0.92, '#eef4fa'); gr.addColorStop(1, '#e9f0f6');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const ring = (r, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(X(0), Y(sh.tee), r / (2 * sh.half) * w, r * k, 0, 0, 7); g.fill(); };
      g.filter = 'blur(0.6px)';
      ring(sh.house, '#2c68c9'); ring(1.22, '#f7fbff'); ring(0.61, '#d23636'); ring(0.15, '#f7fbff');
      g.filter = 'none';
      // the path: the pebble's worn a little flatter (and so a touch greyer) where the stones run
      const pg = g.createLinearGradient(X(-0.9), 0, X(0.9), 0);
      pg.addColorStop(0, 'rgba(170,190,210,0)'); pg.addColorStop(0.5, 'rgba(170,190,210,.10)'); pg.addColorStop(1, 'rgba(170,190,210,0)');
      g.fillStyle = pg; g.fillRect(X(-0.9), Y(sh.end), X(0.9) - X(-0.9), Y(sh.start) - Y(sh.end));
      // frost along the boards
      for (const side of [0, 1]) {
        const fg = g.createLinearGradient(side ? w : 0, 0, side ? w - 22 * q : 22 * q, 0);
        fg.addColorStop(0, 'rgba(255,255,255,.95)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = fg; g.fillRect(side ? w - 22 * q : 0, 0, 22 * q, h);
        for (let i = 0; i < 1400 * q; i++) { const d = Math.random() ** 2 * 26 * q; g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`; g.fillRect(side ? w - d : d, Math.random() * h, 1.5 * q, 1.5 * q); }
      }
      // the pebble: fine frozen droplets, each a dot with a bright side
      for (let i = 0; i < 26000 * q; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        g.fillStyle = `rgba(140,165,195,${Math.random() * 0.13})`; g.fillRect(x, y, q, q);
        if (i % 4 === 0) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; g.fillRect(x - q * 0.5, y - q * 0.5, q * 0.7, q * 0.7); }
      }
      g.fillStyle = '#d83a3a'; g.fillRect(0, Y(sh.hog) - 4 * q, w, 8 * q);   // the hog line
      g.fillStyle = '#d83a3a'; g.fillRect(0, Y(7) - 3 * q, w, 6 * q);        // the near hog line, for looks
      g.fillStyle = '#26324a'; g.fillRect(0, Y(sh.tee) - 1.5 * q, w, 3 * q); // the tee line
      g.fillRect(0, Y(sh.back) - 1.5 * q, w, 3 * q);                         // the back line
      g.fillRect(w / 2 - q, Y(sh.end), 2 * q, Y(sh.start) - Y(sh.end));      // the centre line
      g.fillStyle = '#26324a'; g.fillRect(w / 2 - 8 * q, Y(0.2), 16 * q, 6 * q);  // the hack
      g.fillStyle = 'rgba(150,190,240,.05)'; g.fillRect(0, 0, w, h);            // the clear ice over it all
    });
    const iceMat = !low && T.MeshPhysicalMaterial
      ? new T.MeshPhysicalMaterial({ map: iceTex, roughness: 0.6, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.1, envMapIntensity: 0.55 })
      : new T.MeshStandardMaterial({ map: iceTex, roughness: 0.22, metalness: 0 });
    const ice = new T.Mesh(new T.PlaneGeometry(2 * sh.half, len), iceMat);
    ice.rotation.x = -Math.PI / 2; ice.position.set(0, 0, -(len / 2 - 2)); ice.receiveShadow = true; scene.add(ice);
    // the boards down both sides and across the back, and a dark arena floor beyond them
    const boardMat = new T.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const b = new T.Mesh(new T.BoxGeometry(0.15, 0.25, len), boardMat);
      b.position.set(sx * (sh.half + 0.075), 0.125, -(len / 2 - 2)); b.receiveShadow = true; scene.add(b);
    }
    const back = new T.Mesh(new T.BoxGeometry(2 * sh.half + 0.3, 0.6, 0.15), boardMat); back.position.set(0, 0.3, -sh.end - 0.1); scene.add(back);
    // the arena's end wall: banners and a lit scoreboard strip, so the view down the sheet has a backdrop
    const wallTex = canvasTex(T, 512, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#16223c'); gr.addColorStop(1, '#0e1628');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const cols = ['#e63946', '#2a9d8f', '#f4a261', '#4361ee', '#ffd23f', '#9b5de5'];
      for (let i = 0; i < 6; i++) { g.fillStyle = cols[i]; g.fillRect(14 + i * 83, 70, 70, 40); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(14 + i * 83, 70, 70, 6); }
      g.fillStyle = '#fff6e0'; g.fillRect(150, 18, 212, 30); g.fillStyle = '#0e1628'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('🥌 ICE STONES', 256, 41);
    });
    const wall = new T.Mesh(new T.PlaneGeometry(14, 3.5), new T.MeshBasicMaterial({ map: wallTex }));
    wall.position.set(0, 1.75, -sh.end - 2.5); scene.add(wall);
    // #147 the arena: banner boards with a clear shield above them, tiered stands with a crowd, a roof of trusses
    const bannerTex = canvasTex(T, 1024, 64, (g, w, h) => {
      const cols = ['#e63946', '#2a9d8f', '#f4a261', '#4361ee', '#ffd23f', '#9b5de5', '#06d6a0', '#ef476f'];
      for (let i = 0; i < 16; i++) {
        const x = i * w / 16; g.fillStyle = cols[i % cols.length]; g.fillRect(x, 0, w / 16, h);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `bold ${h * 0.42}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(['🥌', '❄', '★', '🧊'][i % 4], x + w / 32, h / 2);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, h - 6, w / 16, 6);
      }
    });
    bannerTex.wrapS = T.RepeatWrapping; bannerTex.repeat.x = len / 12;
    const bannerMat = new T.MeshBasicMaterial({ map: bannerTex, color: 0xb8c0d0 });
    const glassMat = new T.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false });
    for (const sx of [-1, 1]) {
      const bn = new T.Mesh(new T.PlaneGeometry(len, 0.22), bannerMat);
      bn.rotation.y = -sx * Math.PI / 2; bn.position.set(sx * (sh.half - 0.002), 0.13, -(len / 2 - 2)); scene.add(bn);
      if (!low) { const gl2 = new T.Mesh(new T.PlaneGeometry(len, 0.8), glassMat); gl2.rotation.y = -sx * Math.PI / 2; gl2.position.set(sx * (sh.half + 0.16), 0.66, -(len / 2 - 2)); scene.add(gl2); }
    }
    const standMat = new T.MeshStandardMaterial({ color: 0x1a2440, roughness: 0.95 }), seatMat = new T.MeshStandardMaterial({ color: 0x24345e, roughness: 0.8 });
    const TIERS = 5, crowd = [];
    for (const sx of [-1, 1]) {
      for (let t = 0; t < TIERS; t++) {
        const st = new T.Mesh(new T.BoxGeometry(0.8, 0.45, len + 4), t % 2 ? seatMat : standMat);
        st.position.set(sx * (sh.half + 0.75 + t * 0.8), 0.2 + t * 0.45, -(len / 2 - 2)); st.receiveShadow = true; scene.add(st);
        if (!low) for (let z = -1; z < len + 2; z += 0.55) if (Math.random() < 0.72) crowd.push([sx * (sh.half + 0.75 + t * 0.8) + (Math.random() - 0.5) * 0.25, 0.45 + t * 0.45, -z + (Math.random() - 0.5) * 0.2]);
      }
    }
    if (crowd.length) {
      // a person is a coloured coat with a head on top: two instanced meshes, a little random in size and colour
      const coats = new T.InstancedMesh(new T.CylinderGeometry(0.13, 0.17, 0.42, 6), new T.MeshStandardMaterial({ roughness: 0.9 }), crowd.length);
      const heads = new T.InstancedMesh(new T.SphereGeometry(0.1, 8, 6), new T.MeshStandardMaterial({ roughness: 0.8 }), crowd.length);
      const m4 = new T.Matrix4(), c = new T.Color(), COATS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x4361ee, 0xffd23f, 0x9b5de5, 0xf1faee, 0x264653, 0xd62828];
      const SKIN = [0xf1c7a3, 0xe0a878, 0xc68642, 0x8d5524, 0xfde0c5];
      crowd.forEach(([x, y, z], i) => {
        const k = 0.85 + Math.random() * 0.3;
        coats.setMatrixAt(i, m4.makeScale(k, k, k).setPosition(x, y + 0.21 * k, z)); coats.setColorAt(i, c.setHex(COATS[i % COATS.length]));
        heads.setMatrixAt(i, m4.makeScale(k, k, k).setPosition(x, y + 0.52 * k, z)); heads.setColorAt(i, c.setHex(SKIN[(i * 7) % SKIN.length]));
      });
      scene.add(coats, heads);
    }
    // the roof: trusses across the sheet, the lamps hang from them
    const trussMat = new T.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.7, metalness: 0.4 });
    for (let z = 2; z < len; z += 5) { const tr = new T.Mesh(new T.BoxGeometry(14, 0.12, 0.12), trussMat); tr.position.set(0, 7.35, -z); scene.add(tr); }
    for (const sx of [-2.2, 2.2]) { const rail = new T.Mesh(new T.BoxGeometry(0.1, 0.1, len + 6), trussMat); rail.position.set(sx, 7.4, -(len / 2 - 2)); scene.add(rail); }
    const floor = new T.Mesh(new T.PlaneGeometry(40, len + 20), new T.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.02, -(len / 2 - 2)); scene.add(floor);
    // arena lights hanging over the sheet
    const lampMat = new T.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false });
    const poolTex = canvasTex(T, 128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,248,230,.22)'); gr.addColorStop(1, 'rgba(255,248,230,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    const poolMat = new T.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    for (let z = 2; z < len; z += 5) {
      const l = new T.Mesh(new T.BoxGeometry(2.2, 0.05, 0.4), lampMat); l.position.set(0, 7, -z); scene.add(l);
      if (!low) { const pool = new T.Mesh(new T.PlaneGeometry(3.6, 3.2), poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.003, -z); scene.add(pool); }
    }
    // the stones' reflections in the clear coat (fine graphics): a faint mirrored copy, drawn only where the ice
    // shows (a stencil: the ice marks its pixels, the stones unmark theirs)
    const stencil = (m, ref, func, op) => Object.assign(m, { stencilWrite: true, stencilRef: ref, stencilFunc: func, stencilZPass: op, stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp });
    const mirror = low ? null : new T.Group();
    if (mirror) { mirror.scale.y = -1; scene.add(mirror); stencil(iceMat, 1, T.AlwaysStencilFunc, T.ReplaceStencilOp); }
    const ghostOf = (m) => stencil(new T.MeshBasicMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0xffffff, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }), 1, T.EqualStencilFunc, T.KeepStencilOp);

    // stones: a granite body, a coloured band and a handle in the player's colour
    const R = sh.r;
    const prof = [[0, 0], [R * 0.8, 0], [R, R * 0.35], [R, R * 0.75], [R * 0.85, R * 0.95], [0, R * 0.95]].map(([x, y]) => new T.Vector2(x, y));
    const bodyGeo = new T.LatheGeometry(prof, 24);
    const graniteTex = canvasTex(T, 128, 64, (g, w, h) => {
      g.fillStyle = '#8a8f99'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) { const c = 60 + Math.random() * 120; g.fillStyle = `rgba(${c},${c},${c + 8},.55)`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    });
    const bodyMat = new T.MeshStandardMaterial({ map: graniteTex, roughness: 0.35, metalness: 0.05 });
    const bandGeo = new T.CylinderGeometry(R * 0.86, R * 0.86, R * 0.22, 24);
    const handleGeo = new T.BoxGeometry(R * 0.28, R * 0.28, R * 1.05);
    const gooseGeo = new T.CylinderGeometry(R * 0.12, R * 0.12, R * 0.35, 8);
    const glowTex = canvasTex(T, 64, 64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,170,60,1)'); gr.addColorStop(0.5, 'rgba(255,90,20,.45)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    const ringGeo = new T.RingGeometry(R * 1.25, R * 1.5, 32);
    const meshes = new Map();  // stone id → group
    function stoneMesh(s) {
      const grp = new T.Group();
      const body = new T.Mesh(bodyGeo, bodyMat); body.castShadow = true; body.receiveShadow = true; grp.add(body);
      const col = new T.Color(colorOf(s.o));
      const band = new T.Mesh(bandGeo, new T.MeshStandardMaterial({ color: col, roughness: 0.4 })); band.position.y = R * 0.98; grp.add(band);
      const hm = new T.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.1 });
      const goose = new T.Mesh(gooseGeo, hm); goose.position.set(0, R * 1.2, R * 0.35); grp.add(goose);
      const handle = new T.Mesh(handleGeo, hm); handle.position.set(0, R * 1.38, -R * 0.1); handle.castShadow = true; grp.add(handle);
      if (s.hot) {
        const glow = new T.Mesh(new T.PlaneGeometry(R * 6, R * 6), new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        glow.rotation.x = -Math.PI / 2; glow.position.y = 0.004; glow.name = 'glow'; grp.add(glow);
      }
      const mark = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: T.DoubleSide }));
      mark.rotation.x = -Math.PI / 2; mark.position.y = 0.006; mark.visible = false; mark.name = 'mark'; grp.add(mark);
      grp.userData = { o: s.o, hot: !!s.hot };
      scene.add(grp);
      if (mirror) {
        const twin = new T.Group();
        for (const c of [body, band, goose, handle]) {
          stencil(c.material, 0, T.AlwaysStencilFunc, T.ReplaceStencilOp);
          const g2 = new T.Mesh(c.geometry, ghostOf(c.material)); g2.position.copy(c.position); g2.renderOrder = 2; twin.add(g2);
        }
        mirror.add(twin); grp.userData.twin = twin;
      }
      return grp;
    }
    // the skip's broom: where the thrower aims
    const broom = new T.Group();
    const stick = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 1.2, 6), new T.MeshStandardMaterial({ color: 0x2b2b2b }));
    stick.position.y = 0.6; stick.rotation.z = 0.25; broom.add(stick);
    const skipPad = new T.Mesh(new T.BoxGeometry(0.22, 0.04, 0.08), new T.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.8 }));
    skipPad.position.set(0.15, 0.02, 0); broom.add(skipPad);
    const spot = new T.Mesh(new T.RingGeometry(0.06, 0.09, 24), new T.MeshBasicMaterial({ color: 0xffd23f, side: T.DoubleSide }));
    spot.rotation.x = -Math.PI / 2; spot.position.y = 0.005; broom.add(spot);
    scene.add(broom);
    // #187 the line to the broom, faint, and the stone's path for its first stretch (to the hog line), bright:
    // the rest (where it curls most) is yours to judge
    const aimLine = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
      new T.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.35 }));
    scene.add(aimLine);
    const PATH_N = 160, pathPos = new Float32Array(PATH_N * 3), pathGeo = new T.BufferGeometry();
    pathGeo.setAttribute('position', new T.BufferAttribute(pathPos, 3));
    const pathLine = new T.Line(pathGeo, new T.LineDashedMaterial({ color: 0x1d6fe0, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 }));
    pathLine.frustumCulled = false; scene.add(pathLine);
    const pathEnd = new T.Mesh(new T.RingGeometry(0.05, 0.08, 20), new T.MeshBasicMaterial({ color: 0x1d6fe0, side: T.DoubleSide, transparent: true, opacity: 0.9 }));
    pathEnd.rotation.x = -Math.PI / 2; scene.add(pathEnd);
    let pathKey = '';
    // where the stone will stop if the sweeping carries on as it is (a dashed ring that slides as you sweep)
    const stopMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false });
    const stopRing = new T.Mesh(new T.RingGeometry(R * 1.05, R * 1.35, 32, 1), stopMat);
    stopRing.rotation.x = -Math.PI / 2; stopRing.visible = false; stopRing.renderOrder = 3; scene.add(stopRing);
    const stopDot = new T.Mesh(new T.CircleGeometry(R * 0.25, 12), stopMat); stopDot.rotation.x = -Math.PI / 2; stopDot.visible = false; scene.add(stopDot);
    // #188 the sweepers' brooms: a long handle up and away to the side, a dark head with a coloured cover, scrubbing
    // across the path just in front of a swept stone (lifted and idle when they aren't sweeping)
    const broomHeadGeo = new T.BoxGeometry(0.34, 0.05, 0.1), broomPadGeo = new T.BoxGeometry(0.36, 0.022, 0.11);
    const handleGeo2 = new T.CylinderGeometry(0.014, 0.014, 1.25, 6); handleGeo2.translate(0, 0.625, 0);
    const broomDark = new T.MeshStandardMaterial({ color: 0x23262e, roughness: 0.7 });
    const broomCover = new T.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.95 });
    const handleMat = new T.MeshStandardMaterial({ color: 0x9aa3b5, roughness: 0.35, metalness: 0.6 });
    const sweepers = [-1, 1].map((side) => {
      const g = new T.Group(), head = new T.Mesh(broomHeadGeo, broomDark), cover = new T.Mesh(broomPadGeo, broomCover), stick = new T.Mesh(handleGeo2, handleMat);
      head.position.y = 0.05; cover.position.y = 0.012; head.castShadow = true;
      stick.position.y = 0.07; stick.rotation.set(-0.3, 0, side * 0.95);   // up, back towards the hack and out to the side
      g.add(head, cover, stick); g.visible = false; g.userData = { side, ph: Math.random() * 6, lift: 0.12 };
      scene.add(g); return g;
    });
    // frost kicked up by the brooms: soft points that drift, fall and fade (a pool, per-point alpha)
    const NFR = low ? 70 : 160, frPos = new Float32Array(NFR * 3), frA = new Float32Array(NFR), frV = new Float32Array(NFR * 3), frT = new Float32Array(NFR);
    const frGeo = new T.BufferGeometry();
    frGeo.setAttribute('position', new T.BufferAttribute(frPos, 3)); frGeo.setAttribute('alpha', new T.BufferAttribute(frA, 1));
    const frMat = new T.ShaderMaterial({
      uniforms: { color: { value: new T.Color(0xb4cfea) }, size: { value: 0.026 }, scale: { value: 400 } },
      vertexShader: 'attribute float alpha; varying float vA; uniform float size; uniform float scale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; uniform vec3 color; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(color, vA * (1.0 - d * 3.2)); }',
      transparent: true, depthWrite: false,
    });
    const frost = new T.Points(frGeo, frMat); frost.frustumCulled = false; frost.renderOrder = 4; scene.add(frost);
    let frN = 0, frLive = 0;
    function frostAt(x, y, n, speed) {
      for (let k = 0; k < n; k++) {
        const i = frN++ % NFR;
        frPos[i * 3] = x + (Math.random() - 0.5) * 0.3; frPos[i * 3 + 1] = 0.01; frPos[i * 3 + 2] = -y + (Math.random() - 0.5) * 0.06;
        const a = Math.random() * Math.PI * 2;
        frV[i * 3] = Math.cos(a) * (0.3 + Math.random() * 0.6); frV[i * 3 + 1] = 0.25 + Math.random() * 0.5; frV[i * 3 + 2] = -speed * 0.5 + Math.sin(a) * 0.3;
        frT[i] = 0.45 + Math.random() * 0.4; frA[i] = 0.9;
      }
      frLive = 1.0;
    }
    // the swept path: brushed, glossier streaks on the pebble that fade behind the stone
    const streakTex = canvasTex(T, 64, 64, (g, w, h) => {
      for (let i = 0; i < 26; i++) { const y = Math.random() * h; g.strokeStyle = `rgba(120,160,210,${0.15 + Math.random() * 0.35})`; g.lineWidth = 0.6 + Math.random() * 1.6; g.beginPath(); g.moveTo(Math.random() * 8, y); g.lineTo(w - Math.random() * 8, y + (Math.random() - 0.5) * 6); g.stroke(); }
    });
    const streakGeo = new T.PlaneGeometry(0.42, 0.16);
    const streaks = Array.from({ length: low ? 14 : 34 }, () => {
      const m = new T.Mesh(streakGeo, new T.MeshBasicMaterial({ map: streakTex, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1; scene.add(m); return m;
    });
    let streakAt = 0, streakN = 0;
    // #186 the count: a gold measuring ring round the button through the best rival stone; the stones inside it
    // that count get a number; after the end, gold lines measure them to the button
    const measMat = new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false });
    const measRing = new T.Mesh(new T.RingGeometry(0.97, 1, 72), measMat);
    measRing.rotation.x = -Math.PI / 2; measRing.position.set(0, 0.007, -sh.tee); measRing.visible = false; measRing.renderOrder = 2; scene.add(measRing);
    const numTex = new Map();
    const numOf = (n) => {
      if (!numTex.has(n)) numTex.set(n, canvasTex(T, 64, 64, (g, w) => { g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 3, 0, 7); g.fill(); g.strokeStyle = '#3a2a00'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#2a1d00'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), w / 2, w / 2 + 2); }));
      return numTex.get(n);
    };
    const nums = Array.from({ length: 8 }, () => { const sp = new T.Sprite(new T.SpriteMaterial({ map: numOf(1), depthTest: false, transparent: true })); sp.scale.setScalar(0.2); sp.visible = false; sp.renderOrder = 6; scene.add(sp); return sp; });
    const lineMat = new T.LineBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.9 });
    const measLines = Array.from({ length: 8 }, () => { const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), lineMat); l.visible = false; l.frustumCulled = false; scene.add(l); return l; });
    // sparks where stones crack together
    const sparkGeo = new T.BufferGeometry(), NSP = 40, sp = new Float32Array(NSP * 3), sv = [];
    sparkGeo.setAttribute('position', new T.BufferAttribute(sp, 3));
    const sparks = new T.Points(sparkGeo, new T.PointsMaterial({ color: 0xdff4ff, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false }));
    sparks.frustumCulled = false; scene.add(sparks);
    let sparkT = 0;

    const haloMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: T.DoubleSide });
    const halo = new T.Mesh(new T.RingGeometry(R * 1.35, R * 1.75, 32), haloMat); halo.rotation.x = -Math.PI / 2; halo.visible = false; scene.add(halo);
    const wakeGeo = new T.CircleGeometry(R * 0.9, 16); let wakeAt = 0, wakeN = 0;
    const wake = Array.from({ length: low ? 10 : 24 }, () => { const m = new T.Mesh(wakeGeo, new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return m; });
    // camera: rides behind the thrown stone, else looks down the sheet (aiming) or down on the house
    const cam = { pos: new T.Vector3(0, 3.4, 1.5), look: new T.Vector3(0, 0, -sh.tee), tp: new T.Vector3(), tl: new T.Vector3(), fov: 30, tf: 30, moving: true };
    function target(list) {
      const v = S.stones;
      const thrown = anim && list[list.length - 1];
      const tall = camera.aspect < 0.8;
      const houseView = () => { cam.tp.set(0, tall ? 7.4 : 6.2, -sh.tee + (tall ? 3.4 : 4.2)); cam.tl.set(0, 0, -sh.tee + 0.2); cam.tf = 34; };
      if (thrown && !thrown.gone && thrown.y < sh.tee - 5) {
        // #146: ride low and close behind the stone, so it's big in the frame and the ice streams past
        cam.tp.set(thrown.x * 0.8, 0.72, -thrown.y + 1.45); cam.tl.set(thrown.x * 0.9, 0, -thrown.y - 2.4); cam.tf = 46; cam.chase = true;
      } else if (anim || v.between || camMode === 'house') houseView();
      else if (camMode === 'sheet' || myTurn()) { cam.tp.set(0, 3.4, 1.5); cam.tl.set(aim * 0.4, 0, -sh.tee + 1.2); cam.tf = tall ? 17 : 13; }
      else houseView();
    }
    function draw(now, list, info, dt) {
      const seenIds = new Set();
      const v = S.stones, counted = new Set(v.counted || []);
      for (const s of list) {
        let m = meshes.get(s.id);
        if (!m) { m = stoneMesh(s); meshes.set(s.id, m); }
        seenIds.add(s.id);
        m.position.set(s.x, s.gone ? -s.gone * 0.15 : 0, -s.y);
        m.visible = !(s.gone >= 1);
        const tw = m.userData.twin;
        if (tw) { tw.position.copy(m.position); tw.rotation.copy(m.rotation); tw.visible = m.visible && !s.gone; }
        if (s.moving) m.rotation.y += (s.fresh ? (anim?.shot.curl ?? 1) : 0.4) * -dt * 1.6;
        const glow = m.getObjectByName('glow');
        if (glow) glow.material.opacity = 0.6 + 0.4 * Math.sin(now / 220);
        const mark = m.getObjectByName('mark');
        mark.visible = v.between && !busy() && counted.has(s.id);
        if (mark.visible) mark.scale.setScalar(1 + 0.12 * Math.sin(now / 180));
      }
      for (const [id, m] of meshes) if (!seenIds.has(id)) { scene.remove(m); if (m.userData.twin) { mirror.remove(m.userData.twin); m.userData.twin.traverse((o) => o.material?.dispose?.()); } m.traverse((o) => { if (o.material && o.material !== bodyMat && !o.material.map) o.material.dispose(); }); meshes.delete(id); }
      // the broom while you aim, and the path for its first stretch
      const aiming = myTurn() && !busy();
      broom.visible = aimLine.visible = pathLine.visible = pathEnd.visible = aiming;
      if (aiming) {
        broom.position.set(aim, 0, -sh.tee);
        const key = `${aim},${weight},${curl},${ph().fk},${ph().ck}`;
        if (key !== pathKey) {
          pathKey = key;
          aimLine.geometry.setFromPoints([new T.Vector3(0, 0.01, -sh.start), new T.Vector3(aim, 0.01, -sh.tee)]);
          aimLine.computeLineDistances();
          const pts = launchPath(sh.hog).pts, n = Math.min(PATH_N, pts.length);
          for (let i = 0; i < PATH_N; i++) { const p = pts[Math.min(i, n - 1)]; pathPos[i * 3] = p[0]; pathPos[i * 3 + 1] = 0.012; pathPos[i * 3 + 2] = -p[1]; }
          pathGeo.attributes.position.needsUpdate = true; pathGeo.setDrawRange(0, n); pathLine.computeLineDistances();
          const e = pts[n - 1]; pathEnd.position.set(e[0], 0.012, -e[1]);
        }
      }
      // where it will stop
      const pr = info?.proj;
      stopRing.visible = stopDot.visible = !!(pr && !pr.out);
      if (stopRing.visible) {
        stopRing.position.set(pr.x, 0.008, -pr.y); stopDot.position.set(pr.x, 0.008, -pr.y);
        stopMat.color.set(colorOf(info.o)); stopMat.opacity = 0.65 + 0.3 * Math.sin(now / 140);
        stopRing.rotation.z = now / 600;
      }
      // the count, when the ice is still
      const v2 = S.stones, m = v2.between ? v2.endMeasure : (!busy() ? v2.count : null);
      const showCount = !!(m && m.side != null);
      measRing.visible = !!(showCount && m.ring != null);
      if (measRing.visible) { measRing.scale.set(m.ring, m.ring, 1); measMat.opacity = v2.between ? 0.95 : 0.45 + 0.15 * Math.sin(now / 400); }
      const byId = new Map(list.map((s) => [s.id, s]));
      nums.forEach((sp, k) => {
        const s = showCount ? byId.get(m.ids[k]) : null;
        sp.visible = !!s && !s.gone;
        if (sp.visible) {
          sp.material.map = numOf(k + 1); sp.position.set(s.x, R * 2.6 + 0.04 * Math.sin(now / 250 + k), -s.y);
          sp.scale.setScalar(v2.between ? 0.24 : 0.17);
        }
        const l = measLines[k];
        l.visible = !!(sp.visible && v2.between);
        if (l.visible) { l.geometry.setFromPoints([new T.Vector3(0, 0.012, -sh.tee), new T.Vector3(s.x, 0.012, -s.y)]); }
      });
      // sweepers in front of the thrown stone past the sweeping point
      const thrown = anim && list[list.length - 1];
      // #146: a ring in the thrower's colour under the moving stone and a fading wake behind it, so it reads on white ice
      halo.visible = !!(thrown && thrown.moving && !thrown.gone);
      if (halo.visible) {
        halo.position.set(thrown.x, 0.005, -thrown.y); haloMat.color.set(colorOf(thrown.o)); halo.scale.setScalar(1 + 0.08 * Math.sin(now / 120));
        if (now - wakeAt > 45) { wakeAt = now; wake[wakeN % wake.length].position.set(thrown.x, 0.004, -thrown.y); wake[wakeN % wake.length].userData.t = now; wake[wakeN % wake.length].material.color.set(colorOf(thrown.o)); wakeN++; }
      }
      for (const w of wake) { const a = (now - (w.userData.t || -1e9)) / 1100; w.visible = a < 1; if (w.visible) { w.material.opacity = 0.32 * (1 - a); w.scale.setScalar(1 + a * 0.6); } }
      // #188 the brooms: with the stone from the sweeping line on, scrubbing when it's swept (quicker and wider
      // when hard), throwing up frost and leaving brushed streaks; lifted and hovering when not
      const lvl = info?.lvl || 0;
      const withIt = !!(thrown && info && thrown.moving && !thrown.gone && thrown.y > ph().from - 1 && thrown.y < sh.back);
      haloMat.opacity = lvl ? 0.95 : 0.75;
      sweepers.forEach((b, k) => {
        b.visible = withIt;
        if (!withIt) return;
        const u = b.userData, side = u.side;
        u.lift += ((lvl ? 0 : 0.12) - u.lift) * Math.min(1, dt * 10);
        u.ph += dt * (lvl === 2 ? 17 : lvl ? 11 : 2.5);
        const amp = lvl === 2 ? 0.2 : lvl ? 0.14 : 0.04;
        const dir = Math.atan2(info.sp > 0.05 ? (thrown.vx || 0) : 0, 1);
        const ahead = 0.34 + k * 0.2;
        b.position.set(thrown.x + Math.sin(dir) * ahead + side * 0.05 + Math.sin(u.ph + k * 1.7) * amp, u.lift, -thrown.y - Math.cos(dir) * ahead);
        b.rotation.y = -dir + Math.sin(u.ph + k * 1.7) * (lvl ? 0.28 : 0.05);
        if (lvl && Math.random() < (lvl === 2 ? 0.9 : 0.5) * (dt * 60)) frostAt(b.position.x, -b.position.z, lvl === 2 ? 3 : 2, info.sp);
      });
      if (withIt && lvl && now - streakAt > (lvl === 2 ? 30 : 55)) {
        streakAt = now;
        const m2 = streaks[streakN++ % streaks.length];
        m2.position.set(thrown.x + (Math.random() - 0.5) * 0.1, 0.0045, -thrown.y - 0.3); m2.rotation.z = (Math.random() - 0.5) * 0.3;
        m2.userData.t = now; m2.userData.a = lvl === 2 ? 0.75 : 0.5; m2.visible = true;
      }
      for (const m2 of streaks) {
        if (!m2.visible) continue;
        const a = (now - m2.userData.t) / 2200;
        if (a >= 1) { m2.visible = false; continue; }
        m2.material.opacity = m2.userData.a * (1 - a);
      }
      if (frLive > 0) {
        frLive -= dt;
        for (let i = 0; i < NFR; i++) {
          if (frT[i] <= 0) { frA[i] = 0; continue; }
          frT[i] -= dt; frV[i * 3 + 1] -= 2.2 * dt;
          frPos[i * 3] += frV[i * 3] * dt; frPos[i * 3 + 1] = Math.max(0.004, frPos[i * 3 + 1] + frV[i * 3 + 1] * dt); frPos[i * 3 + 2] += frV[i * 3 + 2] * dt;
          frA[i] = Math.max(0, Math.min(0.9, frT[i] * 2));
        }
        if (frLive <= 0) frA.fill(0);
        frGeo.attributes.position.needsUpdate = true; frGeo.attributes.alpha.needsUpdate = true;
        if (frT.some((t) => t > 0)) frLive = Math.max(frLive, 0.05);
      }
      frost.visible = frLive > 0;
      frMat.uniforms.scale.value = (renderer.domElement.height || 600) / 2 / Math.tan((camera.fov * Math.PI) / 360);
      if (sparkT > 0) {
        sparkT -= dt;
        for (let k = 0; k < NSP; k++) { sp[k * 3] += sv[k][0] * dt; sp[k * 3 + 1] = Math.max(0, sp[k * 3 + 1] + sv[k][1] * dt); sv[k][1] -= 4 * dt; sp[k * 3 + 2] += sv[k][2] * dt; }
        sparkGeo.attributes.position.needsUpdate = true;
        sparks.material.opacity = Math.max(0, sparkT / 0.6);
      }
      sparks.visible = sparkT > 0;
      target(list);
      const k = 1 - Math.exp(-dt * (anim ? 4 : 2.5));
      if (cam.chase && thrown && thrown.moving) {
        // chasing: keep pace with the stone down the sheet (no lag along it), ease only across and in height
        const kz = 1 - Math.exp(-dt * 14);
        cam.pos.x += (cam.tp.x - cam.pos.x) * k; cam.pos.y += (cam.tp.y - cam.pos.y) * k; cam.pos.z += (cam.tp.z - cam.pos.z) * kz;
        cam.look.x += (cam.tl.x - cam.look.x) * k; cam.look.y += (cam.tl.y - cam.look.y) * k; cam.look.z += (cam.tl.z - cam.look.z) * kz;
      } else { cam.pos.lerp(cam.tp, k); cam.look.lerp(cam.tl, k); }
      cam.chase = false;
      cam.fov += (cam.tf - cam.fov) * k;
      cam.moving = cam.pos.distanceTo(cam.tp) > 0.01 || cam.look.distanceTo(cam.tl) > 0.01 || Math.abs(cam.fov - cam.tf) > 0.05;
      if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
      GL3.tickShake(camera, dt);
      stg.follow(camera);
      (still && renderer.renderStill ? renderer.renderStill : renderer.render)(scene, camera);
    }
    function spark(x, y) {
      for (let k = 0; k < NSP; k++) {
        sp[k * 3] = x; sp[k * 3 + 1] = sh.r; sp[k * 3 + 2] = -y;
        const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 1.5;
        sv[k] = [Math.cos(a) * s, 0.5 + Math.random() * 1.5, Math.sin(a) * s];
      }
      sparkT = 0.6;
      if (!low) GL3.shake(camera, 0.15);
    }
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    function iceX(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(ice)[0];
      return hit ? hit.point.x : null;
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h;
      camera.updateProjectionMatrix();
      frMat.uniforms.scale.value = (h * renderer.getPixelRatio()) / 2 / Math.tan((camera.fov * Math.PI) / 360);
    }
    resize();
    function dispose() {
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
      for (const t of numTex.values()) t.dispose();
    }
    return { draw, resize, dispose, iceX, spark, moving: () => cam.moving };
  }

  // ---------- flat top-down fallback: the far end of the sheet, from the hog line to the back boards
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    const sh = () => S.stones.sheet;
    let k = 60, top = 0;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      k = Math.min(canvas.width / (2 * 2.2), canvas.height / 12);
    }
    // sheet y from (end - 12) to end fills the canvas; stones further up show at the bottom edge
    const X = (x) => canvas.width / 2 + x * k, Y = (y) => (sh().end - y) * k + top;
    const fx = [];   // frost specks and hit sparks: [x, y, vx, vy, life, kind]
    function draw(now, list, info, dt = 0.016) {
      const s = sh();
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#eef4fa'; g.fillRect(X(-s.half), 0, 2 * s.half * k, canvas.height);
      for (const [r, c] of [[s.house, '#2f6fd1'], [1.22, '#eef4fa'], [0.61, '#d83a3a'], [0.15, '#eef4fa']]) {
        g.fillStyle = c; g.beginPath(); g.arc(X(0), Y(s.tee), r * k, 0, 7); g.fill();
      }
      g.fillStyle = '#d83a3a'; g.fillRect(X(-s.half), Y(s.hog) - 2, 2 * s.half * k, 4);
      g.fillStyle = '#26324a'; g.fillRect(X(-s.half), Y(s.tee) - 1, 2 * s.half * k, 2); g.fillRect(X(-s.half), Y(s.back) - 1, 2 * s.half * k, 2);
      const v = S.stones, counted = new Set(v.counted || []);
      const bottom = s.end - (canvas.height - top) / k;
      if (myTurn() && !busy()) {
        // the broom, and the path's first stretch where it shows (the flat view starts near the hog line)
        const pts = launchPath(s.hog).pts.filter((p) => p[1] > bottom);
        g.setLineDash([6, 5]); g.strokeStyle = '#1d6fe0'; g.lineWidth = 3; g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke();
        g.strokeStyle = 'rgba(255,210,63,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(aim * (bottom - s.start) / (s.tee - s.start)), Y(bottom)); g.lineTo(X(aim), Y(s.tee)); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.beginPath(); g.arc(X(aim), Y(s.tee), 0.12 * k, 0, 7); g.stroke();
      }
      // the count: the gold measuring ring, lines to the counting stones after the end
      const m = v.between ? v.endMeasure : (!busy() ? v.count : null);
      const byId = new Map(list.map((st) => [st.id, st]));
      if (m && m.side != null) {
        if (m.ring != null) { g.strokeStyle = v.between ? '#ffc83d' : 'rgba(255,200,61,.6)'; g.lineWidth = 3; g.beginPath(); g.arc(X(0), Y(s.tee), m.ring * k, 0, 7); g.stroke(); }
        if (v.between) for (const id of m.ids) { const st = byId.get(id); if (!st) continue; g.strokeStyle = '#ffc83d'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(0), Y(s.tee)); g.lineTo(X(st.x), Y(st.y)); g.stroke(); }
      }
      // where it will stop, and the sweeping
      const pr = info?.proj;
      if (pr && !pr.out) { g.setLineDash([4, 4]); g.strokeStyle = colorOf(info.o); g.lineWidth = 3; g.beginPath(); g.arc(X(pr.x), Y(pr.y), s.r * k * 1.2, 0, 7); g.stroke(); g.setLineDash([]); }
      if (info?.lvl) {
        const yy = Math.max(info.y, bottom + 0.3) + 0.35;
        for (let j = 0; j < 2; j++) {
          const bx = info.x + Math.sin(now / (info.lvl === 2 ? 45 : 70) + j * 2) * 0.16;
          g.fillStyle = '#ffd23f'; g.fillRect(X(bx) - 0.17 * k, Y(yy + j * 0.15) - 3, 0.34 * k, 6);
          if (Math.random() < 0.6) fx.push([bx + (Math.random() - 0.5) * 0.3, yy + j * 0.15, (Math.random() - 0.5) * 1.2, (Math.random() - 0.2) * 1, 0.5, 0]);
        }
      }
      for (const st of list) {
        if (st.gone >= 1) continue;
        const y = Math.max(st.y, s.end - (canvas.height - top) / k + 0.3);
        g.globalAlpha = 1 - (st.gone || 0);
        if (st.hot) { g.fillStyle = 'rgba(255,120,30,.45)'; g.beginPath(); g.arc(X(st.x), Y(y), s.r * k * 2.2, 0, 7); g.fill(); }
        g.fillStyle = '#8a8f99'; g.beginPath(); g.arc(X(st.x), Y(y), s.r * k, 0, 7); g.fill();
        g.fillStyle = colorOf(st.o); g.beginPath(); g.arc(X(st.x), Y(y), s.r * k * 0.7, 0, 7); g.fill();
        if (v.between && counted.has(st.id)) { g.strokeStyle = '#ffe066'; g.lineWidth = 3; g.beginPath(); g.arc(X(st.x), Y(y), s.r * k * 1.4, 0, 7); g.stroke(); }
        g.globalAlpha = 1;
        const n = m && m.side != null ? m.ids.indexOf(st.id) : -1;
        if (n >= 0 && !st.gone) {
          const r = Math.max(9, s.r * k * 0.6), cx = X(st.x) + s.r * k * 0.8, cy = Y(y) - s.r * k * 0.8;
          g.fillStyle = '#ffc83d'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
          g.fillStyle = '#2a1d00'; g.font = `bold ${Math.round(r * 1.3)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n + 1), cx, cy + 1);
        }
      }
      for (let i = fx.length - 1; i >= 0; i--) {
        const p = fx[i]; p[4] -= dt;
        if (p[4] <= 0) { fx.splice(i, 1); continue; }
        p[0] += p[2] * dt; p[1] += p[3] * dt;
        g.fillStyle = p[5] ? `rgba(220,240,255,${p[4] * 1.6})` : `rgba(120,160,210,${p[4] * 1.6})`;
        g.fillRect(X(p[0]) - 2, Y(p[1]) - 2, 4, 4);
      }
      if (fx.length > 300) fx.splice(0, fx.length - 300);
    }
    function spark(x, y) { for (let i = 0; i < 24; i++) { const a = Math.random() * 7, sp = 0.5 + Math.random() * 1.5; fx.push([x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6, 1]); } }
    function iceX(cx) {
      const r = canvas.getBoundingClientRect();
      return ((cx - r.left) * (canvas.width / r.width) - canvas.width / 2) / k;
    }
    resize();
    return { draw, resize, iceX, spark };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🥌 End ${s.stones.end} of ${s.stones.ends}` : null);

  return { mount, render, unmount, fast, turnText, focus: true, testAim: () => aim, testWeight: () => weight };
})();
