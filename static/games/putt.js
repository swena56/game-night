// Putt Party: the hole in 3D (three.js) or top-down 2D. Every putt's path comes from the server and is
// played back on every phone, one after another. To putt, put your finger on your ball and drag back
// (slingshot): direction and power follow the drag, an aim line shows both, and letting go putts.
// A drag that starts anywhere else turns the view (sideways) and tilts it (up and down); two fingers
// or a right-drag pan, pinch or the wheel zoom. The camera follows your ball while it rolls, then
// swings round behind it, looking down the fairway.
UI.putt = (() => {
  let S, ctx, gl = null, flat = null, raf = 0, ro = null, holeKey = '', aim = null;
  // shots play back in order: `anim` is the one rolling now, `queue` the ones still to come
  let anim = null, queue = [], seenShot = 0, primed = false;
  let pts = new Map(), gest = null, behindFor = '', onKey = null, clockOff = 0;
  const COLORS = { fair: ['#2f9e44', '#37b24d'], sand: '#e9c46a', water: '#3a86ff', slope: '#74c69d', fringe: '#2b7a3b', long: '#1f5f2e', ramp: '#b5835a' };
  const $ = (id) => document.getElementById(id);
  const GRAB = 56;  // px: how near your ball a drag has to start to be a putt
  const coarse = () => window.matchMedia?.('(pointer: coarse)').matches;

  // the height of the ground: a hump or bowl fills a whole tile, a·sin²(πu)·sin²(πv) (same as the server)
  const RAMP_H = 0.12;
  function groundH(x, y) {
    const p = S?.putt;
    if (!p) return 0;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (p.kinds[`${cx},${cy}`] === 'ramp') return RAMP_H * (y - cy);  // a ramp rises up the course to its lip
    const h = p.hills?.find((t) => t[0] === cx && t[1] === cy);
    if (!h) return 0;
    const su = Math.sin(Math.PI * (x - cx)), sv = Math.sin(Math.PI * (y - cy));
    return h[2] * su * su * sv * sv;
  }

  // a short knock (wall, post, bumper) or a cup rattle, through the app's sound setting
  let actx = null;
  function knock(freq, vol) {
    if (typeof prefs !== 'undefined' && !prefs.sound) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.002, vol), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.12);
    } catch {}
  }

  function splashSound() {
    if (typeof prefs !== 'undefined' && !prefs.sound) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const len = Math.floor(actx.sampleRate * 0.35), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.35;
      src.connect(f).connect(g).connect(actx.destination); src.start();
    } catch {}
  }
  function boing(vol) {
    if (typeof prefs !== 'undefined' && !prefs.sound) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.12); o.frequency.exponentialRampToValueAtTime(380, t + 0.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.32);
    } catch {}
  }

  function mount(main, side) {
    gl = null; flat = null; holeKey = ''; aim = null;
    anim = null; queue = []; seenShot = 0; primed = false;
    pts = new Map(); gest = null; behindFor = '';
    main.innerHTML = `<div class="pp"><div class="pp-hud"><span id="ppHole"></span><span id="ppTurn"></span></div>
      <div class="pp-stage" id="ppStage"><div class="pp-power" id="ppPower" hidden><span></span></div>
        <div class="pp-cam" id="ppCam" hidden>
          <button data-c="left" title="Turn anticlockwise (←)" aria-label="Turn the course anticlockwise">⟲</button>
          <button data-c="right" title="Turn clockwise (→)" aria-label="Turn the course clockwise">⟳</button>
          <button data-c="in" title="Zoom in (+)" aria-label="Zoom in">＋</button>
          <button data-c="out" title="Zoom out (−)" aria-label="Zoom out">－</button>
          <button data-c="ball" title="Look from behind your ball" aria-label="Look from behind your ball">🎯</button>
          <button data-c="fit" title="Show the whole hole" aria-label="Show the whole hole">⛳</button>
        </div>
        <div class="pp-done" id="ppDone" hidden><h3 id="ppDoneTitle"></h3><div id="ppDoneRows"></div><div id="ppStand" hidden></div></div>
      </div>
      <p id="ppHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scorecard</h3><div id="ppCard" class="pp-card"></div></div>';
    const stage = $('ppStage');
    main.querySelector('.pp').style.touchAction = 'none';
    $('ppCam').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('ppCam').addEventListener('click', (e) => {
      const c = e.target.closest('button')?.dataset.c, v = gl?.view;
      if (!c || !v) return;
      if (c === 'left') v.rotate(Math.PI / 4);    // the course turns anticlockwise: the camera swings right
      else if (c === 'right') v.rotate(-Math.PI / 4);
      else if (c === 'in') v.zoom(1.3);
      else if (c === 'out') v.zoom(1 / 1.3);
      else if (c === 'ball') v.behind();
      else if (c === 'fit') v.fit();
    });
    const two = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    stage.addEventListener('pointerdown', (e) => {
      try { stage.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && gl) { aim = null; $('ppPower').hidden = true; gest = { ...two(), kind: 'two' }; return; }
      if (pts.size > 1) return;
      // a putt starts on your ball (anywhere in the flat view, which has no camera to move)
      const onBall = !gl || gl.nearBall(e.clientX, e.clientY, GRAB);
      if (e.button === 0 && !e.shiftKey && onBall && myTurn()) {
        skipAhead();  // putting now: any putt still rolling jumps to where it stopped
        aim = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
        return;
      }
      // elsewhere: a drag turns and tilts the view; a right-, middle- or shift-drag pans it
      if (gl) gest = { x: e.clientX, y: e.clientY, kind: e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit' };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = gl?.view;
      if (gest?.kind === 'two' && pts.size === 2 && v) {
        const g = two();
        v.pan(gest.x, gest.y, g.x, g.y);
        if (gest.d > 20 && g.d > 20) v.zoom(g.d / gest.d, true);
        v.rotate(gest.ang - g.ang, true);
        gest = { ...g, kind: 'two' };
      } else if (gest?.kind === 'pan' && v) {
        v.pan(gest.x, gest.y, e.clientX, e.clientY);
        gest = { ...gest, x: e.clientX, y: e.clientY };
      } else if (gest?.kind === 'orbit' && v) {
        v.rotate((e.clientX - gest.x) * 0.008, true);
        v.tilt((e.clientY - gest.y) * 0.005, true);
        gest = { ...gest, x: e.clientX, y: e.clientY };
      } else if (aim) { aim.x = e.clientX; aim.y = e.clientY; }
    });
    const release = (e) => {
      pts.delete(e.pointerId);
      if (gest) { if (!pts.size || gest.kind === 'two') gest = null; return; }
      if (!aim) return;
      const shot = aimShot();
      aim = null;
      $('ppPower').hidden = true;
      if (shot && shot.power > 0.03 && myTurn()) ctx.quiet(ctx.act('putt', { angle: +shot.angle.toFixed(4), power: +shot.power.toFixed(3) }));
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); gest = null; aim = null; $('ppPower').hidden = true; });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('wheel', (e) => { if (!gl) return; e.preventDefault(); gl.view.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, true); }, { passive: false });
    // keys: ← → turn, ↑ ↓ tilt, + − zoom, W A S D pan
    onKey = (e) => {
      if (!gl || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = gl.view, k = e.key;
      if (k === 'ArrowLeft') v.rotate(Math.PI / 16); else if (k === 'ArrowRight') v.rotate(-Math.PI / 16);
      else if (k === 'ArrowUp') v.tilt(-0.08); else if (k === 'ArrowDown') v.tilt(0.08);
      else if (k === '+' || k === '=') v.zoom(1.15); else if (k === '-' || k === '_') v.zoom(1 / 1.15);
      else if (k.length === 1 && 'wasd'.includes(k.toLowerCase())) {
        const key = k.toLowerCase();
        v.nudge(key === 'a' ? -0.6 : key === 'd' ? 0.6 : 0, key === 'w' ? 0.6 : key === 's' ? -0.6 : 0);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    const ready = GL3.load();
    ready.then(() => { if (stage.isConnected && !gl) gl = make3d(stage); }).catch(() => {})
      .finally(() => {
        if (stage.isConnected && !gl && !flat) flat = make2d(stage);
        holeKey = '';
        if ($('ppCam')) $('ppCam').hidden = !gl;  // the flat view always shows the whole hole
      });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
    if (onKey) window.removeEventListener('keydown', onKey);
    onKey = null;
  }

  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !S.putt.between;
  const rolling = () => !!(anim || queue.length);
  const skipAhead = () => { anim = null; queue = []; };
  const colorOf = (i) => ctx.player(S.putt.seats[i])?.color ?? '#fff';

  // the drag, turned into a course direction (server x/y) and a power 0..1; full power is a short pull
  function aimShot() {
    if (!aim) return null;
    const stage = $('ppStage'), size = Math.min(stage.clientWidth || 320, stage.clientHeight || 320);
    const sx = aim.x0 - aim.x, sy = aim.y0 - aim.y;  // slingshot: the ball goes opposite to the drag
    const len = Math.hypot(sx, sy);
    if (len < 6) return null;
    const dir = (gl || flat)?.screenDir?.(aim, sx, sy) ?? [sx, -sy];
    return { angle: Math.atan2(dir[1], dir[0]), power: Math.min(1, len / Math.max(70, size * 0.25)) };
  }

  function render(s, c) {
    S = s; ctx = c;
    const p = S.putt;
    if (p.now) clockOff = p.now - performance.now() / 1000;  // server time = performance time + clockOff (the windmills)
    if (!primed) { primed = true; seenShot = p.shot?.id ?? 0; }  // a putt from before you opened the page isn't replayed
    if (p.shot && p.shot.id !== seenShot) {
      seenShot = p.shot.id;
      if (p.shot.frames?.length && p.shot.by < p.balls.length) {
        queue.push({ by: p.shot.by, frames: p.shot.frames, from: p.shot.from, result: p.shot.result, hits: p.shot.hits || [], hole: p.hole, clock: p.shot.t0 });
      }
    }
    $('ppHole').textContent = `⛳ Hole ${p.hole} of ${p.holes} · par ${p.par ?? 3}`;
    const turn = p.seats.indexOf(S.turn);
    $('ppTurn').textContent = p.between ? `Hole ${p.hole} done` : turn >= 0 ? `${turn === p.me ? 'Your' : (ctx.player(S.turn)?.name ?? '?') + "'s"} putt · stroke ${p.strokes[turn] + 1}` : '';
    hint();
    renderCard();
    renderDone();
  }

  function hint() {
    const p = S.putt;
    const cam = !gl ? '' : coarse() ? ' Drag elsewhere to turn the view; two fingers pan and zoom.'
      : ' Drag elsewhere to turn the view; right-drag pans, the wheel zooms (or ← → ↑ ↓, W A S D, + −).';
    const t = S.phase !== 'playing' ? '' : p.between ? 'Next hole in a moment…'
      : !myTurn() ? cam.trim()
        : gl ? 'Drag back from your ball (the ringed one) and let go to putt.' + cam : 'Drag back and let go to putt.';
    const h = $('ppHint');
    if (h && h.textContent !== t) h.textContent = t;
  }

  // golf words for a score against par, and the card's mark (circle under par, square over)
  const VS_PAR = { '-3': 'Albatross! 🦅🦅', '-2': 'Eagle! 🦅', '-1': 'Birdie! 🐦', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
  const vsPar = (n, par) => (n === 1 ? '🎯 Hole in one!' : VS_PAR[n - par] ?? `${n - par > 0 ? '+' : ''}${n - par}`);
  const markCls = (n, par) => (n - par <= -2 ? 'eagle' : n - par === -1 ? 'birdie' : n - par === 1 ? 'bogey' : n - par >= 2 ? 'dbl' : '');
  const toPar = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d));

  function renderCard() {
    const p = S.putt, box = $('ppCard'); box.innerHTML = '';
    const t = ctx.el('table', 'scores');
    const head = ctx.el('tr');
    const live = !p.between && S.phase === 'playing';  // between holes and after the last one, the hole just played is already on the card
    const pars = p.pars || [];
    const played = p.cards[0].length + (live ? 1 : 0);
    head.append(ctx.el('th', '', 'Hole'), ...Array.from({ length: played }, (_, k) => ctx.el('th', k + 1 === p.hole ? 'now' : '', String(k + 1))));
    head.append(ctx.el('th', '', 'Σ'), ctx.el('th', '', '±'));
    t.append(head);
    if (pars.length) {
      const pr = ctx.el('tr', 'pp-par');
      pr.append(ctx.el('td', '', 'Par'), ...Array.from({ length: played }, (_, k) => ctx.el('td', '', String(pars[k] ?? 3))));
      pr.append(ctx.el('td', '', String(pars.slice(0, played).reduce((a, b) => a + b, 0))), ctx.el('td'));
      t.append(pr);
    }
    p.seats.forEach((pid, i) => {
      const row = ctx.el('tr');
      const nm = ctx.el('td', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      row.append(nm);
      let diff = 0;
      p.cards[i].forEach((v, k) => {
        const par = pars[k] ?? 3; diff += v - par;
        const td = ctx.el('td'); td.append(ctx.el('span', 'pp-mark ' + markCls(v, par), String(v)));
        td.title = vsPar(v, par); row.append(td);
      });
      if (live) row.append(ctx.el('td', 'now', p.holed[i] ? `${p.strokes[i]}✓` : String(p.strokes[i])));
      if (live && p.holed[i]) diff += p.strokes[i] - (pars[p.hole - 1] ?? 3);
      const tot = ctx.el('td');
      tot.append(ctx.el('b', '', String(p.cards[i].reduce((a, b) => a + b, 0) + (live ? p.strokes[i] : 0))));
      row.append(tot, ctx.el('td', 'pp-topar ' + (diff < 0 ? 'pp-under' : diff > 0 ? 'pp-over' : ''), toPar(diff)));
      t.append(row);
    });
    box.append(t);
    box.append(ctx.el('p', 'hint left pp-legend', '◯ birdie · ◎ eagle · ▢ bogey · ± strokes against par'));
  }

  // between holes: this hole's strokes and the standings, once the last putt has rolled in (see loop)
  function renderDone() {
    const p = S.putt;
    if (!p.between) { $('ppDone').hidden = true; return; }
    $('ppDoneTitle').textContent = `🏁 Hole ${p.hole} of ${p.holes}`;
    const rows = $('ppDoneRows'); rows.innerHTML = '';
    p.seats.forEach((pid, i) => {
      const s = p.cards[i][p.cards[i].length - 1];
      const r = ctx.el('div', 'pp-done-row');
      const nm = ctx.el('span', '', ctx.player(pid)?.name ?? '?'); nm.style.color = colorOf(i);
      const par = p.pars?.[p.hole - 1] ?? 3;
      r.append(nm, ctx.el('b', 'pp-res ' + markCls(s, par), p.holed[i] ? (s === 1 ? '🎯 Hole in one!' : `${s} · ${vsPar(s, par)}`) : `${s} (picked up)`));
      rows.append(r);
    });
    standingsCard($('ppStand'), p.standings, { title: 'Total so far', note: 'Fewest strokes wins.', lower: true });
  }

  // where each ball is drawn: on its putt's path while that plays, at the start of a putt still waiting
  // to play, else where the server says it is
  function ballPos(i, now) {
    const p = S.putt;
    if (anim && anim.by === i) {
      const k = Math.max(0, Math.floor(((now - anim.t0) / 1000) * 30));
      return anim.frames[Math.min(k, anim.frames.length - 1)];
    }
    const waiting = queue.find((q) => q.by === i);
    return waiting ? waiting.from : p.balls[i];
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!S?.putt) return;
    const p = S.putt, key = `${p.hole}:${JSON.stringify(p.cells)}`;
    if (key !== holeKey && (gl || flat)) {
      holeKey = key; behindFor = '';
      queue = queue.filter((q) => q.hole === p.hole); if (anim && anim.hole !== p.hole) anim = null;
      (gl || flat).build();
    }
    // play the putts one after another, with their knocks and splashes
    if (!anim && queue.length) anim = { ...queue.shift(), t0: now, hi: 0, ended: false };
    if (anim) {
      const f = ((now - anim.t0) / 1000) * 30;
      // (advance the index outside gl?.effect(): an optional call skips its arguments, which froze the flat view)
      while (anim.hi < anim.hits.length && anim.hits[anim.hi][0] <= f) { const h = anim.hits[anim.hi++]; gl?.effect(h); }
      if (!anim.ended && f >= anim.frames.length - 1) {
        anim.ended = true;
        const [x, y] = anim.frames[anim.frames.length - 1];
        if (anim.result === 'cup') {
          gl?.burst(x, y, 0xffffff, 18); knock(1400, 0.12); setTimeout(() => knock(1000, 0.1), 90);
          if (anim.by === p.me) ctx.confetti?.();
        }
      }
      if (f >= anim.frames.length + 8) anim = null;  // a short rest at the end
    }
    const me = p.me, mine = !!anim && anim.by === me;
    // while your ball rolls, the camera follows it; once it stops, it swings round behind it
    if (gl && mine) gl.view.follow(...ballPos(me, now));
    const mineWaiting = me != null && queue.some((q) => q.by === me);
    if (gl && me != null && S.phase === 'playing' && !p.between && !p.holed[me] && p.strokes[me] > 0 && !mine && !mineWaiting) {
      const k = `${p.hole}:${p.strokes[me]}`;
      if (k !== behindFor) { behindFor = k; gl.view.behind(); }
    }
    $('ppDone').hidden = !p.between || rolling();
    const shot = aimShot();
    const bar = $('ppPower');
    bar.hidden = !shot;
    if (shot) bar.firstElementChild.style.width = `${shot.power * 100}%`;
    (gl || flat)?.draw(now, shot);
    hint();  // the putts finish rolling here, not in render
  }

  // ---------- three.js course: world x = course x, world y = up, world z = -course y
  function canvasTex(T, w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    paint(g, w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }

  // the phone threw the GPU context away (app switch, memory): start a fresh 3D view
  function lost(stage) {
    if (!stage.isConnected) return;
    gl?.dispose(); gl = make3d(stage);
    if (!gl) flat ||= make2d(stage); holeKey = '';
  }

  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    renderer = GL3.renderer({}, { onLost: () => lost(stage) });
    if (!renderer) return null;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x0c1a2b);
    const camera = new T.PerspectiveCamera(45, 1, 0.05, 120);
    scene.add(new T.HemisphereLight(0xdff3ff, 0x1d3b1d, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 0.75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    // the rough around the course, so the fairway doesn't float in space
    const rough = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: 0x173d27, roughness: 1 }));
    rough.rotation.x = -Math.PI / 2; rough.position.y = -0.22; rough.receiveShadow = true; scene.add(rough);
    // textures, drawn once: mown grass (stripes and speckle) and a dimpled golf ball
    const grass = canvasTex(T, 64, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2); }
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, w / 2, h);
    });
    const dimples = canvasTex(T, 128, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let row = 0; row < 9; row++) for (let col = 0; col < 18; col++) {
        const x = (col + (row % 2) * 0.5) * (w / 18), y = (row + 0.5) * (h / 9);
        const gr = g.createRadialGradient(x, y, 0, x, y, 3);
        gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      }
    });
    const planks = canvasTex(T, 64, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 6; i++) g.fillRect(0, i * (h / 6), w, 1.5);
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(80,40,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 6, 1); }
    });
    let course = new T.Group(); scene.add(course);
    const balls = [], ballGeo = new T.SphereGeometry(1, 28, 18);
    let aimLine = null, flag = null, flagBase = null;
    const bumperMeshes = [], effects = [], mills = [];
    // a ring on the ground under your own ball, so you can find it (every ball starts on the same tee)
    const ring = new T.Mesh(new T.RingGeometry(0.1, 0.14, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    const W = (x, y) => new T.Vector3(x, groundH(x, y), -y);

    // a tile with a hump or a bowl in it: a grid of vertices lifted to the ground's height
    function hillTile(x, y, color) {
      const N = 18, pos = [], uv = [], idx = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const u = i / N, v = j / N;
        pos.push(x + u, groundH(x + u * 0.999 + 0.0005, y + v * 0.999 + 0.0005), -(y + v)); uv.push(u, v);
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const ramp = S.putt.kinds[`${x},${y}`] === 'ramp';
      const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color, map: ramp ? planks : grass, roughness: ramp ? 0.7 : 0.9, side: T.DoubleSide }));
      m.receiveShadow = true;
      return m;
    }

    function build() {
      scene.remove(course); course = new T.Group(); scene.add(course);
      bumperMeshes.length = 0;
      const p = S.putt, open = new Set(p.cells.map(([x, y]) => `${x},${y}`));
      const hills = new Set((p.hills || []).map((h) => `${h[0]},${h[1]}`));
      const blades = [];  // grass blades to stand on the fringe and the long grass: [x, y, height]
      mills.length = 0;
      for (const [x, y] of p.cells) {
        const kind = p.kinds[`${x},${y}`];
        const color = kind ? COLORS[kind] : COLORS.fair[(x + y) % 2];
        if (kind === 'fringe' || kind === 'long') {
          const n = kind === 'long' ? 70 : 30, tall = kind === 'long' ? 0.06 : 0.03;
          for (let i = 0; i < n; i++) blades.push([x + 0.04 + Math.random() * 0.92, y + 0.04 + Math.random() * 0.92, tall * (0.6 + Math.random() * 0.6)]);
        }
        if (hills.has(`${x},${y}`) || kind === 'ramp') {
          course.add(hillTile(x, y, color));
          const base = new T.Mesh(new T.BoxGeometry(1, 0.06, 1), new T.MeshStandardMaterial({ color: 0x1f6f35 }));
          base.position.set(x + 0.5, -0.17, -(y + 0.5)); course.add(base);
        } else {
          const water = kind === 'water';
          const mat = new T.MeshStandardMaterial({ color, roughness: water ? 0.2 : 0.9, map: water ? null : grass, transparent: water, opacity: water ? 0.85 : 1 });
          const tile = new T.Mesh(new T.BoxGeometry(1, 0.2, 1), mat);
          tile.position.set(x + 0.5, water ? -0.16 : -0.1, -(y + 0.5)); tile.receiveShadow = true; course.add(tile);
        }
        if (kind === 'slope' && p.slope) {
          const arrow = new T.Mesh(new T.ConeGeometry(0.12, 0.3, 12), new T.MeshBasicMaterial({ color: 0xffffff }));
          arrow.position.set(x + 0.5, 0.02, -(y + 0.5));
          arrow.lookAt(x + 0.5 + p.slope[0], 0.02, -(y + 0.5 + p.slope[1]));  // +Z toward the downhill side
          arrow.rotateX(Math.PI / 2);  // the cone's tip (+Y) now points along +Z
          course.add(arrow);
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (open.has(`${x + dx},${y + dy}`)) continue;
          const wall = new T.Mesh(new T.BoxGeometry(dx ? 0.07 : 1.07, 0.17, dy ? 0.07 : 1.07), new T.MeshStandardMaterial({ color: 0x8d5a2b, roughness: 0.7 }));
          wall.position.set(x + 0.5 + dx * 0.5, 0.05, -(y + 0.5 + dy * 0.5)); wall.castShadow = wall.receiveShadow = true; course.add(wall);
          const cap = new T.Mesh(new T.BoxGeometry(dx ? 0.09 : 1.09, 0.02, dy ? 0.09 : 1.09), new T.MeshStandardMaterial({ color: 0xc08a4f, roughness: 0.6 }));
          cap.position.set(x + 0.5 + dx * 0.5, 0.145, -(y + 0.5 + dy * 0.5)); course.add(cap);
        }
      }
      for (const [bx, by, br] of p.bumpers) {
        const b = new T.Mesh(new T.CylinderGeometry(br, br, 0.14, 28), new T.MeshStandardMaterial({ color: 0xff70a6, emissive: 0x551133 }));
        b.position.copy(W(bx, by)).setY(0.05); b.castShadow = true; course.add(b);
        bumperMeshes.push({ mesh: b, x: bx, y: by, kick: 0 });
      }
      if (blades.length) {
        const bg = new T.ConeGeometry(0.006, 1, 3); bg.translate(0, 0.5, 0);
        const im = new T.InstancedMesh(bg, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), blades.length);
        const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
        blades.forEach(([bx, by, h], i) => {
          e.set((Math.random() - 0.5) * 0.5, Math.random() * 6.3, (Math.random() - 0.5) * 0.5);
          m4.compose(new T.Vector3(bx, groundH(bx, by), -by), q.setFromEuler(e), new T.Vector3(1, h, 1));
          im.setMatrixAt(i, m4);
          if (im.setColorAt) im.setColorAt(i, new T.Color().setHSL(0.3 + Math.random() * 0.05, 0.55, 0.2 + Math.random() * 0.12));
        });
        course.add(im);
      }
      for (const [rx, ry, rr] of p.rocks || []) {
        const rock = new T.Mesh(new T.DodecahedronGeometry(rr * 1.05, 0), new T.MeshStandardMaterial({ color: 0x7d7f86, roughness: 0.95, flatShading: true }));
        rock.scale.set(1, 0.7, 1); rock.rotation.set(Math.random(), Math.random() * 6, Math.random());
        rock.position.set(rx, rr * 0.45, -ry); rock.castShadow = rock.receiveShadow = true; course.add(rock);
      }
      // banks: a straight wall at 45° across a turn's outer corner, or a curve of short wall pieces
      const BANK = 0.38, wallMat = new T.MeshStandardMaterial({ color: 0x8d5a2b, roughness: 0.7 });
      for (const [cx, cy, ex, ey, nx, ny, shape] of p.banks || []) {
        const qx = cx + 0.5 - 0.5 * ex - 0.5 * nx, qy = cy + 0.5 - 0.5 * ey - 0.5 * ny;
        const seg = (x1, y1, x2, y2) => {
          const len = Math.hypot(x2 - x1, y2 - y1), w = new T.Mesh(new T.BoxGeometry(len + 0.02, 0.17, 0.06), wallMat);
          w.position.set((x1 + x2) / 2, 0.05, -(y1 + y2) / 2); w.rotation.y = Math.atan2(y2 - y1, x2 - x1);
          w.castShadow = true; course.add(w);
        };
        if (shape === 'flat') seg(qx + BANK * nx, qy + BANK * ny, qx + BANK * ex, qy + BANK * ey);
        else {
          const ox = qx + BANK * (ex + nx), oy = qy + BANK * (ey + ny), a0 = Math.atan2(-ny, -nx), a1 = Math.atan2(-ey, -ex);
          // the arc runs from where it touches one side round to the other, bulging into the corner
          let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          for (let k = 0; k < 8; k++) {
            const t0 = a0 + da * k / 8, t1 = a0 + da * (k + 1) / 8;
            seg(ox + BANK * Math.cos(t0), oy + BANK * Math.sin(t0), ox + BANK * Math.cos(t1), oy + BANK * Math.sin(t1));
          }
        }
      }
      // windmills: a little house across the fairway with a doorway, its sails turning on the server's clock
      for (const [mx, my] of p.mills || []) {
        const g = new T.Group(), body = new T.MeshStandardMaterial({ color: 0xf1e3c8, roughness: 0.8 });
        const DOOR = 0.17, line = my + 0.5;
        for (const side of [-1, 1]) {  // the walls either side of the doorway
          const w = 0.5 - DOOR, part = new T.Mesh(new T.BoxGeometry(w, 0.42, 0.3), body);
          part.position.set(mx + 0.5 + side * (DOOR + w / 2), 0.2, -(line + 0.12)); part.castShadow = true; g.add(part);
        }
        const lintel = new T.Mesh(new T.BoxGeometry(DOOR * 2, 0.24, 0.3), body);
        lintel.position.set(mx + 0.5, 0.3, -(line + 0.12)); g.add(lintel);
        const roof = new T.Mesh(new T.ConeGeometry(0.62, 0.4, 4), new T.MeshStandardMaterial({ color: 0xb23a48, roughness: 0.7 }));
        roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.5); roof.position.set(mx + 0.5, 0.61, -(line + 0.12)); roof.castShadow = true; g.add(roof);
        const hub = new T.Group();
        hub.position.set(mx + 0.5, 0.5, -(line - 0.06));
        for (let i = 0; i < 4; i++) {
          const arm = new T.Group(); arm.rotation.z = i * Math.PI / 2;
          const sail = new T.Mesh(new T.BoxGeometry(0.46, 0.1, 0.015), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
          sail.position.x = 0.25; sail.castShadow = true; arm.add(sail); hub.add(arm);
        }
        const nut = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.05, 12), new T.MeshStandardMaterial({ color: 0x444444 }));
        nut.rotation.x = Math.PI / 2; hub.add(nut);
        g.add(hub); course.add(g);
        mills.push({ hub, x: mx + 0.5, y: line });
      }
      for (const [px, py, ph] of p.posts || []) {
        const post = new T.Mesh(new T.BoxGeometry(ph * 2, 0.2, ph * 2), new T.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.6 }));
        post.position.set(px, 0.08, -py); post.castShadow = true; course.add(post);
        const top = new T.Mesh(new T.BoxGeometry(ph * 2 + 0.02, 0.025, ph * 2 + 0.02), new T.MeshStandardMaterial({ color: 0xffd166 }));
        top.position.set(px, 0.19, -py); course.add(top);
      }
      const cup = new T.Mesh(new T.CylinderGeometry(p.cupR, p.cupR, 0.02, 28), new T.MeshBasicMaterial({ color: 0x111111 }));
      cup.position.copy(W(...p.cup)).setY(0.005); course.add(cup);
      const pole = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.7, 6), new T.MeshStandardMaterial({ color: 0xeeeeee }));
      pole.position.copy(W(...p.cup)).setY(0.35); pole.castShadow = true; course.add(pole);
      // the flag: a strip of cloth that waves (see draw)
      const fg = new T.PlaneGeometry(0.25, 0.15, 10, 3);
      flag = new T.Mesh(fg, new T.MeshStandardMaterial({ color: 0xef476f, side: T.DoubleSide, roughness: 0.8 }));
      flag.position.copy(W(...p.cup)).add(new T.Vector3(0.125, 0.62, 0)); flag.castShadow = true; course.add(flag);
      flagBase = Float32Array.from(fg.attributes.position.array);
      const tee = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.01, 16), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
      tee.position.copy(W(...p.tee)).setY(0.003); course.add(tee);
      // the sun's shadow box covers the hole
      const b = bounds(), span = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 1.5;
      sun.position.set(b.cx - 3, 8, b.cz + 4); sun.target.position.set(b.cx, 0, b.cz);
      Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 25 });
      sun.shadow.camera.updateProjectionMatrix();
      // a new hole starts on the whole-hole view, at once
      Object.assign(goal, HOME); Object.assign(view, HOME);
      resize();
    }
    function ensureBalls() {
      while (balls.length > S.putt.seats.length) scene.remove(balls.pop().mesh);  // a rematch with fewer players (#53)
      while (balls.length < S.putt.seats.length) {
        const i = balls.length;
        const m = new T.Mesh(ballGeo, new T.MeshStandardMaterial({ color: new T.Color(colorOf(i)), map: dimples, bumpMap: dimples, bumpScale: 0.12, roughness: 0.3 }));
        m.scale.setScalar(S.putt.ball * 1.3); m.castShadow = true;
        scene.add(m); balls.push({ mesh: m, last: null });
      }
    }

    // effects: a ring where the ball knocked into something, a bumper's flash, a burst at the cup or a splash
    function ripple(x, y, color, delay, big, dur, h = -0.055) {
      const m = new T.Mesh(new T.RingGeometry(0.04, 0.055, 32), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, h, -y); scene.add(m);
      effects.push({ t: -delay, dur, step(k) { if (k <= 0) return; m.scale.setScalar(1 + k * big); m.material.opacity = 0.8 * (1 - k); }, done() { scene.remove(m); m.geometry.dispose(); } });
    }
    function effect([, x, y, kind, speed]) {
      if (kind === 'splash') {  // into the water: rings spreading out and a spray of drops
        for (let i = 0; i < 3; i++) ripple(x, y, 0xdff6ff, i * 0.18, 5 + i * 2, 1.1);
        burst(x, y, 0xbfe9ff, 26, 0.9);
        splashSound();
        return;
      }
      if (kind === 'land') { burst(x, y, 0xd8c3a5, 10, 0.5); knock(160, Math.min(0.12, 0.03 + speed * 0.03)); return; }
      if (kind === 'bumper') {  // a squash, a bright flash, a shockwave and sparks, and a boing
        if (bumperMeshes.length) {
          const b = bumperMeshes.reduce((best, o) => (Math.hypot(o.x - x, o.y - y) < Math.hypot(best.x - x, best.y - y) ? o : best));
          b.kick = 1;
          ripple(b.x, b.y, 0xff9fc6, 0, 4 + speed, 0.5, 0.02);
        }
        burst(x, y, 0xff70a6, 8, 0.45);
        boing(Math.min(0.2, 0.05 + speed * 0.04));
      }
      const color = kind === 'bumper' ? 0xff70a6 : kind === 'post' ? 0xffd166 : kind === 'rock' ? 0xb0b0b0 : 0xffffff;
      const m = new T.Mesh(new T.RingGeometry(0.04, 0.06, 24), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(W(x, y)).setY(groundH(x, y) + 0.04);
      scene.add(m);
      const big = 2 + Math.min(4, speed * 1.4);
      effects.push({ t: 0, dur: 0.45, step(k) { m.scale.setScalar(1 + k * big); m.material.opacity = 0.9 * (1 - k); }, done() { scene.remove(m); m.geometry.dispose(); } });
      if (kind !== 'bumper') knock(kind === 'post' ? 760 : kind === 'rock' ? 240 : kind === 'mill' ? 420 : 330, Math.min(0.14, 0.02 + speed * 0.03));
    }
    function burst(x, y, color, n, power = 1) {
      const g = new T.SphereGeometry(0.018, 6, 4), mat = new T.MeshBasicMaterial({ color });
      const at = W(x, y);
      for (let i = 0; i < n; i++) {
        const m = new T.Mesh(g, mat), a = Math.random() * Math.PI * 2, s = (0.6 + Math.random() * 0.9) * power;
        const v = new T.Vector3(Math.cos(a) * s * 0.5, (1.4 + Math.random()) * power, Math.sin(a) * s * 0.5);
        m.position.copy(at).setY(at.y + 0.03); scene.add(m);
        effects.push({ t: 0, dur: 0.9, step(k, dt) { v.y -= 4 * dt; m.position.addScaledVector(v, dt); }, done() { scene.remove(m); } });
      }
    }

    // The view: turned by yaw (0 = looking up the course from behind the tee), tilted (radians below the
    // horizon), zoomed in from the fit that shows the whole hole, and panned (world x/z). `goal` is where the
    // camera is heading; `view` follows it smoothly, except for finger and mouse drags, which move both.
    const HOME = { yaw: 0, tilt: 1.05, zoom: 1, px: 0, pz: 0 };
    const view = { ...HOME }, goal = { ...HOME };
    let box = null, fitD = 10, fitKey = '', last = 0;
    const forward = (yaw, tilt) => new T.Vector3(Math.sin(yaw) * Math.cos(tilt), -Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt));
    function bounds() {
      const p = S.putt;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of p.cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
      if (!isFinite(x0)) { x0 = 0; x1 = p.cols; y0 = 0; y1 = p.rows; }
      return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cz: -(y0 + y1) / 2 };
    }
    function aimAt(target, d, yaw, tilt) {
      camera.position.copy(target).addScaledVector(forward(yaw, tilt), -d);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    }
    // the distance at which the whole hole (every corner, and the flag on top) fits, at this angle
    function fitFor(yaw, tilt) {
      const p = S.putt, target = new T.Vector3(box.cx, 0, box.cz), corners = [];
      for (const x of [box.x0, box.x1]) for (const y of [box.y0, box.y1]) for (const h of [0, 0.15]) corners.push(new T.Vector3(x, h, -y));
      corners.push(W(...p.cup).setY(0.75));
      const fits = (d) => { aimAt(target, d, yaw, tilt); return corners.every((c) => { const v = c.clone().project(camera); return Math.abs(v.x) <= 0.94 && Math.abs(v.y) <= 0.94 && v.z < 1; }); };
      let lo = 0.5, hi = 60;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      return hi;
    }
    function clamp(v) {
      v.zoom = Math.min(8, Math.max(0.6, v.zoom));
      v.tilt = Math.min(1.45, Math.max(0.5, v.tilt));
      // keep the point you look at over the course, give or take a tile
      v.px = Math.min(box.x1 + 1 - box.cx, Math.max(box.x0 - 1 - box.cx, v.px));
      v.pz = Math.min(-box.y0 + 1 - box.cz, Math.max(-box.y1 - 1 - box.cz, v.pz));
    }
    function place() {
      if (!box) return;
      clamp(view); clamp(goal);
      const k = `${view.yaw.toFixed(2)}:${view.tilt.toFixed(2)}`;
      if (k !== fitKey) { fitD = fitFor(view.yaw, view.tilt); fitKey = k; }
      aimAt(new T.Vector3(box.cx + view.px, 0, box.cz + view.pz), fitD / view.zoom, view.yaw, view.tilt);
    }
    function resize() {
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      renderer.setSize(w, h); camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!S?.putt) return;
      box = bounds(); fitKey = '';
      place();
    }
    // ease the camera toward its goal
    function glide(dt) {
      const k = 1 - Math.exp(-dt * 5);
      let moved = false;
      for (const key of ['yaw', 'tilt', 'zoom', 'px', 'pz']) {
        const d = goal[key] - view[key];
        if (Math.abs(d) > 1e-3) { view[key] += d * k; moved = true; } else view[key] = goal[key];
      }
      if (moved) place();
    }
    const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
    function toGround(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
      const out = new T.Vector3();
      return ray.ray.intersectPlane(ground, out) ? out : null;
    }
    function screenDir(a) {
      const p0 = toGround(a.x0, a.y0), p1 = toGround(a.x, a.y);
      if (!p0 || !p1) return null;
      return [p0.x - p1.x, -(p0.z - p1.z)];
    }
    // where your ball lies on the screen (client px)
    function ballOnScreen() {
      const p = S?.putt;
      if (!p || p.me == null) return null;
      const v = W(...p.balls[p.me]).project(camera), rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
    }
    // is the screen point (x, y) within r px of your ball?
    function nearBall(x, y, r) {
      const b = ballOnScreen();
      return !!b && Math.hypot(x - b.x, y - b.y) <= r;
    }
    // which way the fairway goes from (x, y): toward the next cell of the tee-to-cup path, or the cup
    function downFairway(x, y) {
      const p = S.putt, path = p.path || [];
      if (!path.length) return [p.cup[0] - x, p.cup[1] - y];
      let k = path.findIndex(([cx, cy]) => cx === Math.floor(x) && cy === Math.floor(y));
      if (k < 0) k = path.reduce((best, c, j) => (Math.hypot(c[0] + 0.5 - x, c[1] + 0.5 - y) < Math.hypot(path[best][0] + 0.5 - x, path[best][1] + 0.5 - y) ? j : best), 0);
      const [tx, ty] = k >= path.length - 1 ? p.cup : [path[k + 1][0] + 0.5, path[k + 1][1] + 0.5];
      return [tx - x, ty - y];
    }
    // close enough to see the ball clearly, far enough to show about three tiles across (a tall phone sees
    // much less side to side than up and down, so the distance follows the screen's shape)
    const nearDist = () => Math.max(3.6, 1.6 / (camera.aspect * Math.tan((camera.fov / 2) * Math.PI / 180)));
    const viewApi = {
      fit() { Object.assign(goal, HOME); },
      rotate(da, now) { goal.yaw += da; if (now) { view.yaw = goal.yaw; place(); } },
      tilt(dt, now) { goal.tilt += dt; clamp(goal); if (now) { view.tilt = goal.tilt; place(); } },
      zoom(f, now) { goal.zoom *= f; if (now) { view.zoom = goal.zoom; place(); } },
      // drag the ground under the finger from screen point (x0, y0) to (x1, y1)
      pan(x0, y0, x1, y1) {
        const a = toGround(x0, y0), b = toGround(x1, y1);
        if (!a || !b) return;
        for (const v of [view, goal]) { v.px -= b.x - a.x; v.pz -= b.z - a.z; }
        place();
      },
      // move the view by (right, forward) tiles, relative to the way the camera faces
      nudge(r, f) {
        const s = Math.sin(goal.yaw), c = Math.cos(goal.yaw);
        goal.px += r * c + f * s; goal.pz += r * s - f * c;
      },
      // keep a rolling ball in the middle of the picture, close enough to watch it
      follow(x, y) {
        if (!box) return;
        goal.px = x - box.cx; goal.pz = -y - box.cz;
        goal.zoom = Math.max(goal.zoom, fitD / (nearDist() * 1.25));
      },
      // stand behind your ball looking down the fairway, close in, with the ball low in the picture
      behind() {
        const p = S.putt;
        if (p.me == null || !box) return;
        const [bx, by] = p.balls[p.me], [dx, dy] = downFairway(bx, by), len = Math.hypot(dx, dy) || 1;
        let yaw = Math.atan2(dx, dy);
        while (yaw - view.yaw > Math.PI) yaw -= 2 * Math.PI;   // turn the short way round
        while (yaw - view.yaw < -Math.PI) yaw += 2 * Math.PI;
        const d = fitFor(yaw, HOME.tilt), dist = nearDist(), ahead = Math.min(1.4, dist * 0.25);
        fitKey = '';
        Object.assign(goal, { yaw, tilt: HOME.tilt, zoom: d / dist, px: bx + (dx / len) * ahead - box.cx, pz: -(by + (dy / len) * ahead) - box.cz });
        place();  // fitFor() moved the camera while measuring: put it back where the view is now
      },
    };
    function draw(now, shot) {
      ensureBalls();
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
      glide(dt);
      const p = S.putt;
      balls.forEach((b, i) => {
        const at = ballPos(i, now), m = b.mesh;
        const playing = (anim && anim.by === i) || queue.some((q) => q.by === i);
        const sunk = p.holed[i] && !playing;
        m.visible = !sunk || i === p.me;
        const r = p.ball * 1.3, pos = W(at[0], at[1]), z = at[2] || 0;
        pos.y = sunk ? -0.05 : z < 0 ? -0.06 + r * 0.6 + z * 1.2 : pos.y + r + z;   // flying over a jump, or sinking
        // roll: turn the ball about the axis across its path, by the distance travelled over its radius
        if (b.last) {
          const mv = pos.clone().sub(b.last), d = Math.hypot(mv.x, mv.z);
          if (d > 1e-4 && d < 0.5) m.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(-mv.z, 0, mv.x).normalize(), d / r));
        }
        b.last = pos.clone();
        m.position.copy(pos);
      });
      const clock = anim ? anim.clock + (now - anim.t0) / 1000 : now / 1000 + clockOff;
      for (const m of mills) m.hub.rotation.z = (p.millSpeed || 1.2566) * clock;
      // the flag waves, more toward its free end
      if (flag && flagBase) {
        const a = flag.geometry.attributes.position, t = now / 1000;
        for (let k = 0; k < a.count; k++) {
          const s = (flagBase[k * 3] + 0.125) / 0.25;
          a.setZ(k, Math.sin(t * 5 - s * 5) * 0.03 * s);
          a.setY(k, flagBase[k * 3 + 1] - s * s * 0.015);
        }
        a.needsUpdate = true;
        flag.geometry.computeVertexNormals();
      }
      for (const b of bumperMeshes) {
        if (b.kick <= 0) continue;
        b.kick = Math.max(0, b.kick - dt * 2.2);
        const wob = 1 + b.kick * 0.45 * Math.cos((1 - b.kick) * 14);   // squash, then wobble back
        b.mesh.scale.set(wob, 2 - wob, wob);
        b.mesh.material.emissive.setRGB(0.33 + b.kick * 0.67, 0.07 + b.kick * 0.5, 0.2 + b.kick * 0.5);
      }
      for (let k = effects.length - 1; k >= 0; k--) {
        const e = effects[k];
        e.t += dt;
        e.step(Math.min(1, e.t / e.dur), dt);
        if (e.t >= e.dur) { e.done(); effects.splice(k, 1); }
      }
      if (aimLine) { scene.remove(aimLine); aimLine.geometry.dispose(); aimLine = null; }
      const me = p.me;
      ring.visible = me != null && !(p.holed[me] && !rolling());
      if (ring.visible) {
        const at = ballPos(me, now);
        ring.position.copy(W(at[0], at[1])).setY(groundH(at[0], at[1]) + 0.006);
        ring.scale.setScalar(myTurn() ? 1 + 0.15 * Math.sin(now / 250) : 1);  // pulses on your turn
      }
      if (shot && me != null) {
        const [bx, by] = p.balls[me], len = 0.4 + shot.power * 2.2, line = [];
        for (let k = 0; k <= 12; k++) {  // the aim line hugs the ground over hills
          const x = bx + Math.cos(shot.angle) * len * k / 12, y = by + Math.sin(shot.angle) * len * k / 12;
          line.push(W(x, y).setY(groundH(x, y) + 0.04));
        }
        aimLine = new T.Line(new T.BufferGeometry().setFromPoints(line), new T.LineBasicMaterial({ color: 0xffffff }));
        scene.add(aimLine);
      }
      renderer.render(scene, camera);
    }
    function dispose() { renderer.dispose(); renderer.domElement.remove(); }
    return { build, draw, resize, dispose, screenDir, nearBall, ballOnScreen, effect, burst, view: viewApi };
  }

  // ---------- flat top-down fallback
  function make2d(stage) {
    const canvas = document.createElement('canvas'); stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { stage.append('Your browser cannot draw this game.'); return null; }
    let k = 30;
    function resize() {
      const p = S?.putt, dpr = Math.min(devicePixelRatio || 1, 2);
      const w = stage.clientWidth || 320, h = stage.clientHeight || 320;
      const cols = p?.cols || 6, rows = p?.rows || 9;
      const unit = Math.min(w / cols, h / rows);
      canvas.style.width = `${unit * cols}px`; canvas.style.height = `${unit * rows}px`;
      canvas.width = Math.round(unit * cols * dpr); canvas.height = Math.round(unit * rows * dpr);
      k = canvas.width / cols;
    }
    const X = (x) => x * k, Y = (y) => canvas.height - y * k;
    function draw(now, shot) {
      const p = S.putt;
      if (!canvas.width) resize();
      g.fillStyle = '#0c1a2b'; g.fillRect(0, 0, canvas.width, canvas.height);
      for (const [x, y] of p.cells) {
        const kind = p.kinds[`${x},${y}`];
        g.fillStyle = kind ? COLORS[kind] : COLORS.fair[(x + y) % 2];
        g.fillRect(X(x), Y(y + 1), k, k);
      }
      for (const [hx, hy, a] of p.hills || []) {  // a hump is lighter in the middle, a bowl darker
        const gr = g.createRadialGradient(X(hx + 0.5), Y(hy + 0.5), 0, X(hx + 0.5), Y(hy + 0.5), k * 0.5);
        gr.addColorStop(0, a > 0 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(X(hx), Y(hy + 1), k, k);
      }
      for (const [bx, by, br] of p.bumpers) { g.fillStyle = '#ff70a6'; g.beginPath(); g.arc(X(bx), Y(by), br * k, 0, 7); g.fill(); }
      for (const [px, py, ph] of p.posts || []) { g.fillStyle = '#9aa5b1'; g.fillRect(X(px - ph), Y(py + ph), ph * 2 * k, ph * 2 * k); }
      for (const [rx, ry, rr] of p.rocks || []) { g.fillStyle = '#7d7f86'; g.beginPath(); g.arc(X(rx), Y(ry), rr * k, 0, 7); g.fill(); }
      g.strokeStyle = '#8d5a2b'; g.lineWidth = Math.max(2, k * 0.06);
      for (const [cx, cy, ex, ey, nx, ny, shape] of p.banks || []) {  // drawn straight in the flat view
        const qx = cx + 0.5 - 0.5 * ex - 0.5 * nx, qy = cy + 0.5 - 0.5 * ey - 0.5 * ny;
        g.beginPath(); g.moveTo(X(qx + 0.38 * nx), Y(qy + 0.38 * ny)); g.lineTo(X(qx + 0.38 * ex), Y(qy + 0.38 * ey)); g.stroke();
      }
      for (const [mx, my] of p.mills || []) {  // the windmill's wall, its doorway open or shut right now
        const clock = anim ? anim.clock + (now - anim.t0) / 1000 : now / 1000 + clockOff;
        const a = ((p.millSpeed || 1.2566) * clock + Math.PI / 2) % (Math.PI / 2), shut = Math.min(a, Math.PI / 2 - a) < 0.32;
        g.fillStyle = '#f1e3c8';
        g.fillRect(X(mx), Y(my + 0.56), (0.5 - 0.17) * k, 0.12 * k); g.fillRect(X(mx + 0.67), Y(my + 0.56), (0.5 - 0.17) * k, 0.12 * k);
        if (shut) { g.fillStyle = '#ffffff'; g.fillRect(X(mx + 0.33), Y(my + 0.56), 0.34 * k, 0.12 * k); }
      }
      g.fillStyle = '#111'; g.beginPath(); g.arc(X(p.cup[0]), Y(p.cup[1]), p.cupR * k, 0, 7); g.fill();
      p.seats.forEach((_, i) => {
        const at = ballPos(i, now);
        g.fillStyle = colorOf(i); g.strokeStyle = i === p.me ? '#fff' : '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(at[0]), Y(at[1]), Math.max(4, p.ball * k * 1.3), 0, 7); g.fill(); g.stroke();
      });
      if (shot && p.me != null) {
        const [bx, by] = p.balls[p.me], len = 0.4 + shot.power * 2.2;
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(bx), Y(by));
        g.lineTo(X(bx + Math.cos(shot.angle) * len), Y(by + Math.sin(shot.angle) * len)); g.stroke();
      }
    }
    resize();
    return { build: resize, draw, resize, screenDir: (a, sx, sy) => [sx, -sy] };
  }

  const turnText = (s) => (s.phase === 'playing' ? `⛳ Hole ${s.putt.hole} of ${s.putt.holes}` : null);

  // for the browser tests: ballOnScreen (where to start a putt; null in the flat view, where any drag putts), camera
  return { mount, render, unmount, turnText, focus: true, ballOnScreen: () => gl?.ballOnScreen() ?? null, camera: () => gl?.view ?? null };
})();
