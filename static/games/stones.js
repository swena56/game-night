// Ice Stones: the sheet in 3D (three.js) or a flat top-down house. Every throw's tracks come from the server
// and play back on every phone. On your turn: set the 🧹 broom (tap the ice or use ◀ ▶), the weight, the curl
// and the sweeping, then 🥌 Throw. The camera rides behind the stone, then looks down on the house.
UI.stones = (() => {
  let still = false;
  let S, ctx, gl = null, flat = null, raf = 0, ro = null;
  let anim = null, queue = [], seen = 0, primed = false, camMode = 'auto', lastDraw = 0, thrownAt = 0;
  // the throw being set up (kept between turns, like a player's habit)
  let aim = 0, weight = 0.36, curl = 1, sweep = 0;
  const $ = (id) => document.getElementById(id);
  const FPS = 30;

  const colorOf = (i) => ctx?.player(S.stones.seats[i])?.color ?? '#ccc';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !S.stones.between;
  const sheet = () => S.stones.sheet;
  const zone = (w) => (w < 0.1 ? 'Hog' : w < 0.27 ? 'Guard' : w < 0.43 ? 'Draw' : w < 0.7 ? 'Hit' : 'Peel');

  function mount(main, side) {
    gl = null; flat = null; anim = null; queue = []; seen = 0; primed = false; camMode = 'auto';
    main.innerHTML = `<div class="ic"><div class="ic-hud"><span id="icEnd"></span><span id="icTurn"></span></div>
      <div class="ic-stage" id="icStage">
        <button class="ic-cam ghost-btn" id="icCam" hidden title="Switch view">👁 Sheet</button>
        <div class="ic-done" id="icDone" hidden><h3 id="icDoneTitle"></h3><div id="icStand"></div></div>
      </div>
      <div class="ic-ctl" id="icCtl">
        <div class="ic-row">
          <span class="ic-lbl">🧹 Aim</span>
          <div class="ic-dial"><button data-a="-1" aria-label="Aim left">◀</button><b id="icAim"></b><button data-a="1" aria-label="Aim right">▶</button></div>
          <div class="ic-seg" id="icCurl" role="group" aria-label="Curl">
            <button data-c="-1" title="The stone bends left as it slows">↺ Left</button><button data-c="1" title="The stone bends right as it slows">↻ Right</button>
          </div>
        </div>
        <div class="ic-row">
          <span class="ic-lbl">💪 Weight</span>
          <input type="range" id="icWeight" min="0" max="100" step="1" aria-label="Weight">
          <b class="ic-zone" id="icZone"></b>
        </div>
        <div class="ic-row">
          <span class="ic-lbl">🧹 Sweep</span>
          <div class="ic-seg" id="icSweep" role="group" aria-label="Sweeping">
            <button data-s="0">None</button><button data-s="1">Light</button><button data-s="2">Hard</button>
          </div>
          <button class="ic-throw" id="icThrow">🥌 Throw</button>
        </div>
      </div>
      <p id="icHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scoreboard</h3><div id="icCard" class="ic-card"></div>'
      + '<label class="ic-sweepsnd">🧹 Sweeping sound <select id="icSweepSnd"><option value="soft">Soft</option><option value="off">Off</option></select></label></div>';
    $('icSweepSnd').value = sweepPref();
    $('icSweepSnd').onchange = (e) => { try { localStorage.setItem('stones.sweepSound', e.target.value); } catch {} if (e.target.value === 'off') brush(0); };
    const stage = $('icStage');
    $('icCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.a) setAim(aim + +b.dataset.a * 0.05);
      else if (b.dataset.c) curl = +b.dataset.c;
      else if (b.dataset.s) sweep = +b.dataset.s;
      else if (b.id === 'icThrow') return throwNow();
      controls();
    });
    $('icWeight').addEventListener('input', (e) => { weight = +e.target.value / 100; controls(); });
    $('icCam').onclick = () => { camMode = camMode === 'house' ? 'sheet' : 'house'; controls(); };
    // tap or drag on the ice to put the broom there
    stage.style.touchAction = 'none';
    let dragging = false;
    const place = (e) => { const x = (gl || flat)?.iceX?.(e.clientX, e.clientY); if (x != null) { setAim(x); controls(); } };
    stage.addEventListener('pointerdown', (e) => {
      if (!myTurn() || e.target.closest('button, .ic-done')) return;
      dragging = true; try { stage.setPointerCapture(e.pointerId); } catch {} place(e);
    });
    stage.addEventListener('pointermove', (e) => { if (dragging) place(e); });
    const stop = () => { dragging = false; };
    stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', stop);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); if ($('icCam')) $('icCam').hidden = !gl; });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    brush(0);
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
  }

  function setAim(x) {
    const h = S?.stones?.sheet?.half ?? 2.2;
    aim = Math.max(-h + 0.2, Math.min(h - 0.2, Math.round(x * 100) / 100));
  }

  function throwNow() {
    if (!myTurn() || busy()) return;
    thrownAt = performance.now();
    SND.push(true); ctx.buzz?.(15);
    ctx.quiet(ctx.act('throw', { aim: +aim.toFixed(3), weight: +weight.toFixed(3), curl, sweep }));
  }

  const busy = () => !!(anim || queue.length);

  function controls() {
    $('icAim').textContent = aim === 0 ? 'centre' : `${aim < 0 ? '◀' : '▶'} ${Math.abs(aim).toFixed(2)}`;
    $('icWeight').value = Math.round(weight * 100);
    $('icZone').textContent = zone(weight);
    for (const b of $('icCurl').children) b.classList.toggle('on', +b.dataset.c === curl);
    for (const b of $('icSweep').children) b.classList.toggle('on', +b.dataset.s === sweep);
    const go = myTurn() && !busy();
    $('icThrow').disabled = !go;
    $('icThrow').classList.toggle('ic-ready', go);
    $('icCtl').classList.toggle('ic-off', !myTurn());
    $('icCam').textContent = camMode === 'house' ? '👁 Sheet' : '👁 House';
  }

  function render(s, c) {
    S = s; ctx = c;
    const v = S.stones;
    if (!primed) { primed = true; seen = v.shot?.id ?? 0; }  // a throw from before you opened the page isn't replayed
    if (v.shot && v.shot.id !== seen) { seen = v.shot.id; queue.push(v.shot); }
    $('icEnd').textContent = `🧊 End ${v.end} of ${v.ends}`;
    const n = v.order.length;
    const who = v.next != null ? (v.next === v.me ? 'Your' : `${ctx.player(v.seats[v.next])?.name ?? '?'}'s`) : '';
    const hotNow = v.thrown === v.hot;
    $('icTurn').textContent = v.between ? `End ${v.end} done` : v.next != null ? `${who} stone · ${v.thrown + 1} of ${n}${hotNow ? ' · 🔥 HOT' : ''}` : '';
    $('icTurn').classList.toggle('ic-hot', hotNow && !v.between);
    controls();
    renderCard();
    renderDone();
    hint();
  }

  function hint() {
    const v = S.stones;
    const t = S.phase !== 'playing' ? '' : v.between ? 'Next end in a moment…'
      : !myTurn() ? (busy() ? '' : 'Watch the ice.')
        : `Tap the ice to set the broom: aim there, and the stone bends ${curl > 0 ? 'right ↻' : 'left ↺'} as it slows. Draw weight stops in the house.`;
    if ($('icHint').textContent !== t) $('icHint').textContent = t;
  }

  function renderCard() {
    const v = S.stones, box = $('icCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores ic-scores');
    const head = ctx.el('tr');
    head.append(ctx.el('th', '', ''), ...v.endsLog.map((_, k) => ctx.el('th', '', String(k + 1))), ctx.el('th', '', 'Σ'), ctx.el('th', '', '🥌'));
    t.append(head);
    v.seats.forEach((pid, i) => {
      const row = ctx.el('tr', v.next === i ? 'now' : '');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm, ...v.endsLog.map(([side, pts]) => ctx.el('td', side === i ? 'ic-pt' : '', side === i ? String(pts) : '·')));
      row.append(ctx.el('td', '', ''));
      row.lastChild.append(ctx.el('b', '', String(v.points[i])));
      let left = 0;
      for (let k = v.thrown; k < v.order.length; k++) if (v.order[k] === i) left++;
      row.append(ctx.el('td', 'ic-left', left ? '●'.repeat(left) : '–'));
      t.append(row);
    });
    box.append(t);
    box.append(ctx.el('p', 'hint left', `🔥 Stone ${v.hot + 1} of this end is hot: it scores double. Hammer: ${ctx.player(v.seats[v.order[v.order.length - 1]])?.name ?? '?'}.`));
  }

  function renderDone() {
    const v = S.stones;
    if (!v.between) { $('icDone').hidden = true; return; }
    const [side, pts] = v.endsLog[v.endsLog.length - 1] || [null, 0];
    $('icDoneTitle').textContent = side == null ? `🏁 End ${v.end}: blank end` : `🏁 End ${v.end}: ${ctx.player(v.seats[side])?.name ?? '?'} scores ${pts}`;
    standingsCard($('icStand'), v.standings, { title: 'Points', note: 'Most points wins.' });
  }

  // ---------- playback: where every stone is right now
  // returns [{id, o, hot, x, y, gone, moving}] for drawing
  function positions(now) {
    const v = S.stones;
    if (!anim) {
      if (!queue.length) return v.stones.map((s) => ({ ...s }));
      const sh = queue[0];  // a throw waiting to play: show the stones as they were before it
      return sh.before.map((s) => ({ ...s }));
    }
    const sh = anim.shot, f = ((now - anim.t0) / 1000) * FPS;
    const list = [...sh.before.map((s) => ({ ...s })), { id: sh.new, o: sh.by, hot: sh.hot, x: 0, y: sheet().start, fresh: true }];
    for (const tr of sh.tracks) {
      const s = list[tr.k];
      if (!s) continue;
      const k = Math.floor(f - tr.s);
      const at = tr.f[Math.max(0, Math.min(tr.f.length - 1, k))];
      s.x = at[0]; s.y = at[1];
      s.moving = k >= 0 && k < tr.f.length - 1;
      if ((tr.out || tr.short) && k >= tr.f.length - 1) s.gone = Math.min(1, (k - tr.f.length + 1) / 12);
    }
    if (!sh.tracks.some((tr) => tr.k === list.length - 1)) list[list.length - 1].gone = 1;
    return list;
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
        hush = { a, src, lfo, g, depth, lvl: -1 };
      }
      const want = on ? 0.012 + 0.008 * level : 0;
      if (want === hush.lvl) return;
      hush.lvl = want;
      const t = hush.a.currentTime;
      hush.g.gain.setTargetAtTime(want, t, 0.12); hush.depth.gain.setTargetAtTime(want * 0.7, t, 0.12);
      hush.lfo.frequency.setTargetAtTime(2.6 + level * 0.8, t, 0.1);
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
  // how fast the fastest stone is going in this frame of the throw (0..1)
  function slideLevel(shot, f) {
    let best = 0;
    for (const tr of shot.tracks) {
      const k = Math.floor(f - tr.s);
      if (k < 1 || k >= tr.f.length) continue;
      const [x0, y0] = tr.f[k - 1], [x1, y1] = tr.f[k];
      best = Math.max(best, Math.hypot(x1 - x0, y1 - y0) * FPS);
    }
    return Math.min(1, best / 3.2);
  }

  function loop(now) {
    if (!$('icStage')) { raf = 0; brush(0); window.Snd?.bed('st.slide').set(0); return; }
    raf = requestAnimationFrame(loop);
    if (!S?.stones) return;
    if (!anim && queue.length) {
      const shot = queue.shift();
      anim = { shot, t0: now, hits: shot.tracks.filter((t) => t.s > 0).map((t) => t.s).sort((a, b) => a - b), hi: 0, sw: 0 };
      if (!(shot.by === S.stones.me && now - thrownAt < 3000)) SND.push(false);
    }
    if (anim) {
      const f = ((now - anim.t0) / 1000) * FPS;
      while (anim.hi < anim.hits.length && anim.hits[anim.hi] <= f) {
        const hf = anim.hits[anim.hi++], tr = anim.shot.tracks.find((t) => t.s === hf);
        const sp = tr && tr.f.length > 1 ? Math.hypot(tr.f[1][0] - tr.f[0][0], tr.f[1][1] - tr.f[0][1]) * FPS : 1;
        SND.clock(Math.min(1, sp / 2.2), tr?.f?.[0]?.[0] ?? 0);
        gl?.spark(anim.shot, hf);
      }
      window.Snd?.bed('st.slide', slideBed).set(slideLevel(anim.shot, f));
      brush(anim.shot.sweep && f > 8 && f < anim.shot.frames * 0.8 ? anim.shot.sweep : 0);
      if (f >= anim.shot.frames + 12) { anim = null; brush(0); window.Snd?.bed('st.slide').set(0); controls(); hint(); }
    }
    $('icDone').hidden = !S.stones.between || busy();
    // on-demand drawing: every frame while anything moves, otherwise ~15 fps for the glows
    const idle = !anim && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    still = idle;  // idle redraws are drawn sharp and kept out of the frame-rate watch (#107/#109)
    (gl || flat)?.draw(now, positions(now));
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
    const pad = new T.Mesh(new T.BoxGeometry(0.22, 0.04, 0.08), new T.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.8 }));
    pad.position.set(0.15, 0.02, 0); broom.add(pad);
    const spot = new T.Mesh(new T.RingGeometry(0.06, 0.09, 24), new T.MeshBasicMaterial({ color: 0xffd23f, side: T.DoubleSide }));
    spot.rotation.x = -Math.PI / 2; spot.position.y = 0.005; broom.add(spot);
    scene.add(broom);
    const aimLine = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
      new T.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.7 }));
    scene.add(aimLine);
    // the sweepers' brooms, brushing in front of a swept stone
    const sweepers = [0, 1].map(() => { const b = new T.Mesh(new T.BoxGeometry(0.2, 0.03, 0.07), pad.material); b.visible = false; scene.add(b); return b; });
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
    let lastT = 0;
    function draw(now, list) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
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
      // the broom while you aim
      const aiming = myTurn() && !busy();
      broom.visible = aimLine.visible = aiming;
      if (aiming) {
        broom.position.set(aim, 0, -sh.tee);
        aimLine.geometry.setFromPoints([new T.Vector3(0, 0.01, -sh.start), new T.Vector3(aim, 0.01, -sh.tee)]);
        aimLine.computeLineDistances();
      }
      // sweepers in front of the thrown stone past the sweeping point
      const thrown = anim && list[list.length - 1];
      // #146: a ring in the thrower's colour under the moving stone and a fading wake behind it, so it reads on white ice
      halo.visible = !!(thrown && thrown.moving && !thrown.gone);
      if (halo.visible) {
        halo.position.set(thrown.x, 0.005, -thrown.y); haloMat.color.set(colorOf(thrown.o)); halo.scale.setScalar(1 + 0.08 * Math.sin(now / 120));
        if (now - wakeAt > 45) { wakeAt = now; wake[wakeN % wake.length].position.set(thrown.x, 0.004, -thrown.y); wake[wakeN % wake.length].userData.t = now; wake[wakeN % wake.length].material.color.set(colorOf(thrown.o)); wakeN++; }
      }
      for (const w of wake) { const a = (now - (w.userData.t || -1e9)) / 1100; w.visible = a < 1; if (w.visible) { w.material.opacity = 0.32 * (1 - a); w.scale.setScalar(1 + a * 0.6); } }
      const brushing = thrown && anim.shot.sweep && thrown.moving && thrown.y > 8;
      sweepers.forEach((b, k) => {
        b.visible = !!brushing;
        if (brushing) b.position.set(thrown.x + (k ? 0.12 : -0.12) + Math.sin(now / (60 - anim.shot.sweep * 12) + k * 3) * 0.12, 0.02, -thrown.y - 0.35 - k * 0.1);
      });
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
    function spark(shot, frame) {
      // the stone that starts moving at this frame is where the hit happened
      const tr = shot.tracks.find((t) => t.s === frame);
      if (!tr) return;
      const [x, y] = tr.f[0];
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
    }
    resize();
    function dispose() {
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
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
    function draw(now, list) {
      const s = sh();
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#eef4fa'; g.fillRect(X(-s.half), 0, 2 * s.half * k, canvas.height);
      for (const [r, c] of [[s.house, '#2f6fd1'], [1.22, '#eef4fa'], [0.61, '#d83a3a'], [0.15, '#eef4fa']]) {
        g.fillStyle = c; g.beginPath(); g.arc(X(0), Y(s.tee), r * k, 0, 7); g.fill();
      }
      g.fillStyle = '#d83a3a'; g.fillRect(X(-s.half), Y(s.hog) - 2, 2 * s.half * k, 4);
      g.fillStyle = '#26324a'; g.fillRect(X(-s.half), Y(s.tee) - 1, 2 * s.half * k, 2); g.fillRect(X(-s.half), Y(s.back) - 1, 2 * s.half * k, 2);
      const v = S.stones, counted = new Set(v.counted || []);
      if (myTurn() && !busy()) {
        g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.beginPath(); g.arc(X(aim), Y(s.tee), 0.12 * k, 0, 7); g.stroke();
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
      }
    }
    function iceX(cx) {
      const r = canvas.getBoundingClientRect();
      return ((cx - r.left) * (canvas.width / r.width) - canvas.width / 2) / k;
    }
    resize();
    return { draw, resize, iceX };
  }

  const turnText = (s) => (s.phase === 'playing' ? `🥌 End ${s.stones.end} of ${s.stones.ends}` : null);

  return { mount, render, unmount, turnText, focus: true, testAim: () => aim };
})();
