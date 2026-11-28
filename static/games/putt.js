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
  let aimSet = null;   // (#395) a shot set by the aim panel, keys or a tap instead of a drag: {angle, power}
  let pts = new Map(), gest = null, lastTap = null, behindFor = '', onKey = null, clockOff = 0, holeShownAt = 0, behindTimer = 0;
  const COLORS = { fair: ['#2f9e44', '#37b24d'], sand: '#e9c46a', water: '#3a86ff', slope: '#74c69d', fringe: '#2b7a3b', long: '#1f5f2e', ramp: '#b5835a' };
  const HAZARD_MARKS = { sand: '⠿', water: '≈', fringe: '╵╵╵', long: '╿╿╿', ramp: '↑' };
  function hazardMark(kind, p) {
    if (kind !== 'slope') return HAZARD_MARKS[kind];
    const [x, y] = p.slope || [0, -1];
    return x > 0 ? '→' : x < 0 ? '←' : y > 0 ? '↑' : '↓';
  }
  let scoreSelection = null;
  let pickupKey = '', resultUntil = 0;
  function showResult(by, message) {
    const who = by === S.putt.me ? 'You' : (ctx.player(S.putt.seats[by])?.name ?? 'Player');
    $('ppResult').textContent = `${who} · ${message}`;
    resultUntil = performance.now() + 4000;
    $('ppResult').hidden = false;
  }
  const $ = (id) => document.getElementById(id);
  const cameraModes = ['Behind ball', 'Overhead'];
  let cameraMode = 0, cameraLocked = false, overview = false;
  const cameraHeld = () => cameraLocked && !overview;
  function saveCamera() {
    try { localStorage.setItem('putt-camera', JSON.stringify([cameraMode, cameraLocked])); } catch {}
  }
  function cameraLabels() {
    $('ppPreset').textContent = cameraModes[cameraMode];
    $('ppLock').setAttribute('aria-pressed', String(cameraLocked));
    $('ppLock').textContent = cameraLocked ? 'Locked' : 'Lock';
  }
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

  // a short knock (wall, post, bumper) or a cup rattle; all putt sounds go through the app's output (the
  // volume slider and its softening) and follow the sound and move-sound settings
  let actx = null;
  const quiet = () => typeof prefs !== 'undefined' && (!prefs.sound || prefs.moves === false);
  function dest() {
    if (typeof out === 'function') { const o = out(); actx = audio; return o; }
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    return actx.destination;
  }
  function knock(freq, vol) {
    if (quiet()) return;
    try {
      const to = dest();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.002, vol), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(to); o.start(t); o.stop(t + 0.12);
    } catch {}
  }

  function splashSound() {
    if (quiet()) return;
    try {
      const to = dest();
      const len = Math.floor(actx.sampleRate * 0.35), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.35;
      src.connect(f).connect(g).connect(to); src.start();
    } catch {}
  }
  function boing(vol) {
    if (quiet()) return;
    try {
      const to = dest();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.12); o.frequency.exponentialRampToValueAtTime(380, t + 0.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(to); o.start(t); o.stop(t + 0.32);
    } catch {}
  }

  // the putter striking the ball: a woody tock, firmer for a harder putt
  let struckAt = 0;
  function strike(power) {
    knock(1050, 0.05 + power * 0.09); knock(520, 0.03 + power * 0.05);
  }

  function mount(main, side) {
    gl = null; flat = null; holeKey = ''; aim = null; scoreSelection = null;
    anim = null; queue = []; seenShot = 0; primed = false; pickupKey = ''; resultUntil = 0;
    pts = new Map(); gest = null; behindFor = ''; overview = false;
    try {
      const saved = JSON.parse(localStorage.getItem('putt-camera'));
      cameraMode = saved?.[0] === 1 ? 1 : 0;
      cameraLocked = saved?.[1] === true;
    } catch {}
    main.innerHTML = `<div class="pp"><div class="pp-hud"><span id="ppHole"></span><span id="ppTurn"></span><button id="ppAimBtn" class="ghost-btn pp-pick" hidden title="Aim with buttons or keys instead of dragging (Z X turn, C V power, Enter putts)">🎯 Aim</button><button id="ppPick" class="ghost-btn pp-pick" hidden title="Pick up your ball: this hole costs your strokes so far +1">⛳ Pick up</button></div>
      <div class="pp-aim" id="ppAim" hidden role="group" aria-label="Aim your putt">
        <button data-a="left" title="Turn the aim left (Z; Shift for fine)" aria-label="Turn the aim left">⟲</button>
        <button data-a="right" title="Turn the aim right (X; Shift for fine)" aria-label="Turn the aim right">⟳</button>
        <button data-a="less" title="Less power (C)" aria-label="Less power">−</button>
        <output id="ppAimPow" aria-live="polite">40%</output>
        <button data-a="more" title="More power (V)" aria-label="More power">+</button>
        <button id="ppPreview" data-a="preview" title="Estimate from current conditions. Windmill timing changes as you wait." hidden>Preview</button>
        <button data-a="go" class="primary" title="Putt (Enter)">⛳ Putt</button>
        <button data-a="close" title="Close (Esc)" aria-label="Close the aim panel">✕</button>
        <output id="ppPreviewResult" class="pp-preview-result"></output>
        <span class="pp-aim-tip">Tap the course to aim there</span>
      </div>
      <p id="ppPractice" class="hint" hidden>Practice: bank off the first corner, use more power through sand, watch the windmill doorway, build speed for the ramp, and ease off near the cup. Rematch to try the same hole again.</p>
      <div class="pp-stage" id="ppStage"><div class="pp-power" id="ppPower" hidden><span></span></div>
        <div id="ppResult" class="pp-result" role="status" hidden></div>
        <div class="pp-cam" id="ppCam" hidden>
          <button id="ppPreset" data-c="preset" title="Switch aiming camera"></button>
          <button id="ppLock" data-c="lock" title="Lock camera and disable follow and inertia"></button>
          <button data-c="left" title="Turn anticlockwise (←)" aria-label="Turn the course anticlockwise">⟲</button>
          <button data-c="right" title="Turn clockwise (→)" aria-label="Turn the course clockwise">⟳</button>
          <button data-c="in" title="Zoom in (+)" aria-label="Zoom in">＋</button>
          <button data-c="out" title="Zoom out (−)" aria-label="Zoom out">－</button>
          <button data-c="ball" title="Return to aiming view" aria-label="Return to aiming view">🎯</button>
          <button data-c="fit" title="Show the whole hole" aria-label="Show the whole hole">⛳</button>
        </div>
        <div class="pp-done" id="ppDone" hidden><h3 id="ppDoneTitle"></h3><div id="ppDoneRows"></div><div id="ppStand" hidden></div></div>
      </div>
      <p class="hint pp-hazards">⠿ Sand · ╵╵╵ Rough · ≈ Water · Arrows show downhill or up a ramp</p>
      <p id="ppCode" class="hint" hidden>Course code <code></code></p>
      <p id="ppHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>Scorecard</h3><div id="ppCard" class="pp-card" tabindex="0" aria-label="Hole scores"></div><p id="ppScoreDetail" role="status" hidden></p><p class="hint pp-legend">Total includes the current hole. To par counts finished holes only.</p></div>';
    cameraLabels();
    const stage = $('ppStage');
    // (#395) aim without dragging: a panel (and keys) set the direction and power, the same putt goes to the server
    $('ppAimBtn').onclick = () => (aimSet ? closeAim() : openAim());
    $('ppAim').addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a) aimStep(a, e.shiftKey);
    });
    $('ppAim').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('ppPick').onclick = async () => {
      const n = (S.putt.strokes[S.putt.me] ?? 0) + 1;
      if (await ctx.ask(`Pick up? This hole will cost you ${n}.`, { ok: '⛳ Pick up' })) ctx.quiet(ctx.act('pickup'));
    };
    // only the course takes over touches (aiming, turning the view): the page above and below still scrolls (#72)
    stage.style.touchAction = 'none';
    $('ppCam').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('ppCam').addEventListener('click', (e) => {
      const c = e.target.closest('button')?.dataset.c, v = gl?.view;
      if (!c || !v) return;
      if (c === 'preset' || c === 'ball') {
        if (c === 'preset') { cameraMode = 1 - cameraMode; saveCamera(); cameraLabels(); }
        overview = false; v.behind();
      } else if (c === 'fit') {
        overview = true; v.fit();
      } else if (c === 'lock') {
        cameraLocked = !cameraLocked; saveCamera(); cameraLabels(); v.stop(cameraLocked);
      } else if (cameraHeld()) return;
      else if (c === 'left') v.rotate(Math.PI / 4);    // the course turns anticlockwise: the camera swings right
      else if (c === 'right') v.rotate(-Math.PI / 4);
      else if (c === 'in') v.zoom(1.3);
      else if (c === 'out') v.zoom(1 / 1.3);
    });
    const two = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.gl3-retry')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && gl && !cameraHeld()) { aim = null; $('ppPower').hidden = true; gest = { ...two(), kind: 'two' }; return; }
      if (pts.size > 1) return;
      // a putt starts on your ball (anywhere in the flat view, which has no camera to move)
      const onBall = !gl || gl.nearBall(e.clientX, e.clientY, coarse() ? GRAB * 1.4 : GRAB);  // a fingertip is wider than a cursor
      if (e.button === 0 && !e.shiftKey && onBall && myTurn()) {
        skipAhead();  // putting now: any putt still rolling jumps to where it stopped
        gl?.view.stop(true);
        aim = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
        return;
      }
      if (cameraHeld()) {
        if (aimSet) gest = { kind: 'aim-tap', x0: e.clientX, y0: e.clientY };
        return;
      }
      // a second tap on the same spot flies the view there (a mouse has dblclick)
      if (gl && e.pointerType === 'touch') {
        const now = performance.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { gl.view.focus(e.clientX, e.clientY); lastTap = null; return; }
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
      // elsewhere: a drag turns and tilts the view; a right-, middle- or shift-drag pans it
      if (gl) { gl.view.stop(); gest = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, kind: e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit', vx: 0, vy: 0, t: performance.now() }; }
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
        const now = performance.now(), dt = Math.max(1, now - gest.t);   // how fast it's turning, for a flick to carry on
        gest = { ...gest, x: e.clientX, y: e.clientY, vx: 0.7 * gest.vx + 0.3 * ((e.clientX - gest.x) * 0.008 / dt), vy: 0.7 * gest.vy + 0.3 * ((e.clientY - gest.y) * 0.005 / dt), t: now };
      } else if (aim) { aim.x = e.clientX; aim.y = e.clientY; }
    });
    // (#395) with the aim panel open, a tap on the course (no drag) aims there
    const tapAim = (e) => {
      const g = (gl || flat)?.groundAt?.(e.clientX, e.clientY), p = S.putt;
      if (!g || !aimSet || p.me == null) return false;
      const [bx, by] = p.balls[p.me];
      if (Math.hypot(g[0] - bx, g[1] - by) < 0.05) return false;
      aimSet.angle = Math.atan2(g[1] - by, g[0] - bx); paintAim();
      return true;
    };
    const release = (e) => {
      pts.delete(e.pointerId);
      if (gest && ['orbit', 'aim-tap'].includes(gest.kind) && aimSet && Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) < 6 && tapAim(e)) { gest = null; return; }
      if (gest) {
        // (#385) a flick keeps the view turning for a moment, slowing to a stop
        if (gest.kind === 'orbit' && gl && !cameraLocked && performance.now() - gest.t < 80 && Math.abs(gest.vx) > 0.0004) gl.view.spin(gest.vx * 1000, gest.vy * 1000);
        if (!pts.size || gest.kind === 'two') gest = null;
        return;
      }
      if (!aim) return;
      const shot = aimShot();
      aim = null;
      $('ppPower').hidden = true;
      if (shot && shot.power > 0.03 && myTurn()) { closeAim(); fire(shot); }
      else if (!shot && aimSet) tapAim(e);   // the flat view: every press starts a drag, a tap without one aims
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); gest = null; aim = null; $('ppPower').hidden = true; });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    // (#385) the wheel zooms toward what's under the cursor; a double-click (or double-tap) flies the view to a spot
    stage.addEventListener('wheel', (e) => { if (!gl || cameraHeld()) return; e.preventDefault(); gl.view.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener('dblclick', (e) => { if (gl && !cameraHeld() && !e.target.closest('#ppCam')) gl.view.focus(e.clientX, e.clientY); });
    // keys: ← → turn, ↑ ↓ tilt, + − zoom, W A S D pan
    onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = gl?.view, k = e.key;
      // (#395) aim by keys: Z X turn (Shift: fine), C V power, Enter putts, Esc closes
      const ak = { z: 'left', x: 'right', c: 'less', v: 'more' }[k.toLowerCase()];
      if (ak && myTurn()) { aimStep(ak, e.shiftKey); e.preventDefault(); return; }
      if (k === 'Enter' && aimSet && myTurn()) { aimStep('go'); e.preventDefault(); return; }
      if (k === 'Escape' && aimSet) { closeAim(); e.preventDefault(); return; }
      if (!v || cameraHeld()) return;
      if (k === 'ArrowLeft' || k === 'q' || k === 'Q') v.rotate(Math.PI / 16); else if (k === 'ArrowRight' || k === 'e' || k === 'E') v.rotate(-Math.PI / 16);
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
    cancelAnimationFrame(raf); clearTimeout(behindTimer); behindTimer = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
    if (onKey) window.removeEventListener('keydown', onKey);
    onKey = null;
  }

  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && !S.putt.between;
  const rolling = () => !!(anim || queue.length);
  function skipAhead() {
    const skipped = [...queue].reverse().concat(anim).find((shot) => shot?.outcome?.length);
    if (skipped) showResult(skipped.by, skipped.outcome.join(' · '));
    anim = null; queue = [];
  }
  const colorOf = (i) => ctx.player(S.putt.seats[i])?.color ?? '#fff';

  // aim colour by power (#82): green for a tap, amber mid-way, red at full power
  const powerHue = (t) => (1 - Math.min(1, Math.max(0, t))) * 120;
  const powerCss = (t, a = 1) => `hsla(${powerHue(t).toFixed(0)}, 90%, 55%, ${a})`;
  // (#395) the aim panel: it opens aimed at the cup at 40%, and steps the angle and power
  function openAim() {
    const p = S?.putt;
    if (!p || p.me == null || !myTurn()) return;
    gl?.view.stop(true);
    const [bx, by] = p.balls[p.me];
    aimSet = { angle: Math.atan2(p.cup[1] - by, p.cup[0] - bx), power: 0.4 };
    paintAim();
  }
  function closeAim() { aimSet = null; paintAim(); }
  function aimStep(a, fine) {
    if (a === 'preview') {
      if (aimSet && myTurn() && S.putt.previewOn) ctx.quiet(ctx.act('preview', {
        angle: +aimSet.angle.toFixed(4), power: +aimSet.power.toFixed(3),
      }));
      return;
    }
    if (!aimSet && a !== 'close') openAim();
    if (!aimSet) return;
    const turn = fine ? Math.PI / 180 * 0.5 : Math.PI / 180 * 3, step = fine ? 0.01 : 0.05;
    if (a === 'left') aimSet.angle += turn;
    else if (a === 'right') aimSet.angle -= turn;
    else if (a === 'less') aimSet.power = Math.max(0.02, aimSet.power - step);
    else if (a === 'more') aimSet.power = Math.min(1, aimSet.power + step);
    else if (a === 'go') { const shot = { ...aimSet }; closeAim(); fire(shot); return; }
    else if (a === 'close') { closeAim(); return; }
    paintAim();
  }
  function paintAim() {
    const box = $('ppAim');
    if (!box) return;
    box.hidden = !aimSet;
    $('ppAimBtn')?.classList.toggle('on', !!aimSet);
    if (aimSet) $('ppAimPow').textContent = `${Math.round(aimSet.power * 100)}%`;
    const previewLabel = { land: 'Predicted landing', water: 'Predicted splash', cup: 'Predicted hole-out' };
    const prediction = matchingPreview(aimSet, S.putt.preview);
    $('ppPreviewResult').textContent = prediction ? (previewLabel[prediction.kind] ??
      (prediction.kind ? 'Predicted bounce' : 'Predicted stop')) : '';
  }
  // a putt, from a drag or the aim panel: feedback straight away (#73), then the server
  function fire(shot) {
    if (!shot || shot.power <= 0.03 || !myTurn()) return;
    strike(shot.power); struckAt = performance.now(); ctx.buzz?.(15);
    const me = S.putt.me;
    if (gl && me != null) gl.burst(...S.putt.balls[me], 0xffffff, 6, 0.3 + shot.power * 0.4);
    ctx.quiet(ctx.act('putt', { angle: +shot.angle.toFixed(4), power: +shot.power.toFixed(3) }));
  }
  // the drag, turned into a course direction (server x/y) and a power 0..1; full power is a short pull
  function aimShot() {
    if (!aim) return aimSet && myTurn() ? aimSet : null;
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
    $('ppCode').hidden = !p.courseCode;
    $('ppCode').firstElementChild.textContent = p.courseCode || '';
    $('ppPreview').hidden = !p.previewOn;
    $('ppPractice').hidden = !p.practice;
    if (p.pickupNotice) {
      const key = `${p.hole}:${p.pickupNotice.by}`;
      if (key !== pickupKey) {
        pickupKey = key;
        showResult(p.pickupNotice.by, `Picked up · scores ${p.pickupNotice.score}`);
      }
    }
    if (p.now) clockOff = p.now - performance.now() / 1000;  // server time = performance time + clockOff (the windmills)
    // (#389) every putt since the last one seen, in order (the server keeps the last few), so a quick second putt
    // or a missed update doesn't drop one from the replay
    const recent = (p.shots?.length ? p.shots : p.shot ? [p.shot] : []).slice().sort((a, b) => a.id - b.id);
    if (!primed) { primed = true; seenShot = recent.length ? recent[recent.length - 1].id : 0; }  // a putt from before you opened the page isn't replayed
    for (const sh of recent) {
      if (sh.id <= seenShot) continue;
      seenShot = sh.id;
      if (sh.frames?.length && sh.by < p.balls.length && (sh.hole ?? p.hole) === p.hole) {   // never an old hole's putt on this course
        queue.push({ by: sh.by, frames: sh.frames, from: sh.from, result: sh.result, outcome: sh.outcome, hits: sh.hits || [], hole: sh.hole ?? p.hole, clock: sh.t0 });
      }
    }
    $('ppHole').textContent = `⛳ Hole ${p.hole} of ${p.holes} · par ${p.par ?? 3}`;
    const turn = p.seats.indexOf(S.turn);
    $('ppTurn').textContent = p.between ? `Hole ${p.hole} done` : turn >= 0 ? `${turn === p.me ? 'Your' : (ctx.player(S.turn)?.name ?? '?') + "'s"} putt · stroke ${p.strokes[turn] + 1}${p.cap ? ` of ${p.cap}` : ''}` : '';
    // with no stroke limit (#68), you can give up on a hole once you've had a go
    $('ppPick').hidden = !(p.cap == null && myTurn() && p.strokes[p.me] > 0);
    $('ppAimBtn').hidden = !myTurn() || !!p.between;
    if (aimSet && (!myTurn() || p.between)) closeAim();
    else if (aimSet) paintAim();
    hint();
    renderCard();
    renderDone();
  }

  function hint() {
    const p = S.putt;
    const cam = !gl ? '' : cameraHeld() ? ' Camera locked.' : coarse() ? ' Drag elsewhere to turn the view; two fingers pan and zoom; double-tap flies there.'
      : ' Drag elsewhere to turn the view (flick it to spin); right-drag pans, the wheel zooms where you point, double-click flies there (or ← → / Q E, ↑ ↓, W A S D, + −).';
    const t = S.phase !== 'playing' ? '' : p.between ? 'Next hole in a moment…'
      : !myTurn() ? cam.trim()
        : gl ? 'Drag back from your ball (the ringed one) and let go to putt.' + cam : 'Drag back and let go to putt.';
    const h = $('ppHint');
    if (h && h.textContent !== t) h.textContent = t;
  }

  // (#368, #392) the course's corners, for both views and as the server's physics has them: a tile's outer corner
  // (walled on both sides) is a bank's curve or 45° cut where the server put one, else rounded to roundR. Corners are
  // numbered 0 (+x,-y), 1 (+x,+y), 2 (-x,+y), 3 (-x,-y); each is null (square), ['round', r] or ['flat', r].
  const TILE_CORNERS = [[1, -1], [1, 1], [-1, 1], [-1, -1]], BANK_R = 0.38;
  function cornerRule(p) {
    const open = new Set(p.cells.map(([x, y]) => `${x},${y}`)), R = p.roundR || 0.22;
    const bankAt = new Map((p.banks || []).map(([cx, cy, ex, ey, nx, ny, shape]) => [`${cx},${cy}`, [-(ex + nx), -(ey + ny), shape]]));
    return (x, y, sx, sy) => {
      if (open.has(`${x + sx},${y}`) || open.has(`${x},${y + sy}`)) return null;
      const b = bankAt.get(`${x},${y}`);
      if (b && b[0] === sx && b[1] === sy) return b[2] === 'flat' ? ['flat', BANK_R] : ['round', BANK_R];
      return ['round', R];
    };
  }
  // a tile's outline as points in course units, its corners rounded or cut as above (n points per quarter circle)
  function tileOutline(x, y, corner, n = 8) {
    const pts = [];
    TILE_CORNERS.forEach(([sx, sy], k) => {
      const c = corner[k], cx = x + 0.5 + 0.5 * sx, cy = y + 0.5 + 0.5 * sy;
      if (!c) { pts.push([cx, cy]); return; }
      const r = c[1], into = k % 2 ? [cx, cy - r * sy] : [cx - r * sx, cy], out = k % 2 ? [cx - r * sx, cy] : [cx, cy - r * sy];
      if (c[0] === 'flat') { pts.push(into, out); return; }
      const ox = cx - r * sx, oy = cy - r * sy, a0 = -Math.PI / 2 + k * Math.PI / 2;
      for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * (i / n); pts.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]); }
    });
    return pts;
  }

  // golf words for a score against par, and the card's mark (circle under par, square over)
  const VS_PAR = { '-3': 'Albatross! 🦅🦅', '-2': 'Eagle! 🦅', '-1': 'Birdie! 🐦', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
  // ls: this score had a long shot's stroke taken off (#387): a credited 1 is then no hole in one, and it says so
  const vsPar = (n, par, ls = false) => (ls ? `${VS_PAR[n - par] ?? (n - par > 0 ? '+' : '') + (n - par)} · 🚀 long shot (played ${n + 1})`
    : n === 1 ? '🎯 Hole in one!' : VS_PAR[n - par] ?? `${n - par > 0 ? '+' : ''}${n - par}`);
  const longShot = (i, hole) => !!S.putt.longShots?.[i]?.includes(hole);
  const markCls = (n, par) => (n - par <= -2 ? 'eagle' : n - par === -1 ? 'birdie' : n - par === 1 ? 'bogey' : n - par >= 2 ? 'dbl' : '');
  const toPar = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d));

  function scoreDetail(i, hole) {
    const p = S.putt;
    return p.cards[i].length >= hole ? p.scoreHistory?.[i]?.[hole - 1] : p.liveScores?.[i];
  }

  function paintScoreDetail() {
    const line = $('ppScoreDetail');
    line.hidden = !scoreSelection;
    if (!scoreSelection) return;
    const [i, hole] = scoreSelection, p = S.putt;
    const d = scoreDetail(i, hole);
    const name = ctx.player(p.seats[i])?.name ?? '?';
    const score = p.cards[i][hole - 1] ?? p.holeScores?.[i] ?? p.strokes[i];
    const distance = p.madePutts?.[i]?.[hole];
    const parts = [`${name} · Hole ${hole}`];
    if (d) {
      parts.push(d.status);
      if (d.played != null) {
        parts.push(`${d.played} played`);
        if (d.water) parts.push(`+${d.water} water`);
        if (d.adjustment) parts.push(`${d.adjustment > 0 ? '+' : ''}${d.adjustment} ${d.status}`);
      }
      if (d.discount) parts.push('−1 Long Shot');
    } else if (longShot(i, hole)) {
      parts.push('−1 Long Shot');
    }
    parts.push(d?.status === 'playing' ? `${score} running score` : `${score} credited`);
    if (distance != null) parts.push(`${distance.toFixed(1)} tiles to hole out`);
    line.textContent = parts.join(' · ');
  }

  function renderCard() {
    const p = S.putt, box = $('ppCard'), scroll = box.scrollLeft;
    const selected = document.activeElement?.dataset.score;
    box.innerHTML = '';
    const t = ctx.el('table', 'scores');
    const live = !p.between && S.phase === 'playing';
    const pars = p.pars || [];
    const head = ctx.el('tr');
    const range = Array.from({ length: p.holes }, (_, k) => k + 1);
    head.append(ctx.el('th', 'pp-name', 'Hole'), ctx.el('th', 'pp-total', 'Total'));
    head.append(...range.map((hole) => ctx.el('th', hole === p.hole ? 'now' : '', String(hole))));
    head.append(ctx.el('th', '', 'To par'));
    t.append(head);
    const pr = ctx.el('tr', 'pp-par');
    pr.append(ctx.el('td', 'pp-name', 'Par'), ctx.el('td', 'pp-total', ''));
    pr.append(...range.map((hole) => ctx.el('td', '', String(pars[hole - 1] ?? '—'))));
    pr.append(ctx.el('td'));
    t.append(pr);
    p.seats.forEach((pid, i) => {
      const row = ctx.el('tr');
      const name = ctx.player(pid)?.name ?? '?';
      const nm = ctx.el('th', 'pp-name', name); nm.scope = 'row'; nm.style.color = colorOf(i);
      row.append(nm, ctx.el('td', 'pp-total', String(p.totals[i])));
      let diff = 0;
      for (const hole of range) {
        const finished = p.cards[i][hole - 1] ?? (live && hole === p.hole ? p.holeScores?.[i] : null);
        const score = finished ?? (live && hole === p.hole ? p.strokes[i] : null);
        const par = pars[hole - 1] ?? 3;
        const td = ctx.el('td', hole === p.hole ? 'now' : '');
        if (score != null) {
          if (finished != null) diff += finished - par;
          const d = scoreDetail(i, hole);
          const mark = ctx.el('button', 'pp-score-button', String(score));
          mark.type = 'button';
          mark.dataset.score = `${i}:${hole}`;
          mark.setAttribute('aria-label', `${name}, hole ${hole}, ${score}${d ? ', ' + d.status : ''}`);
          if (finished != null) mark.classList.add('pp-mark', ...markCls(score, par).split(' ').filter(Boolean));
          mark.onclick = () => { scoreSelection = [i, hole]; paintScoreDetail(); };
          td.append(mark);
          if (d && d.status !== 'playing') td.append(ctx.el('small', 'pp-made-putt', d.status));
          const distance = p.madePutts?.[i]?.[hole];
          if (distance != null) td.append(ctx.el('small', 'pp-made-putt', `${distance.toFixed(1)} tiles`));
        } else {
          td.textContent = '—';
        }
        row.append(td);
      }
      row.append(ctx.el('td', 'pp-topar ' + (diff < 0 ? 'pp-under' : diff > 0 ? 'pp-over' : ''), toPar(diff)));
      t.append(row);
    });
    box.append(t);
    box.scrollLeft = scroll;
    if (selected) box.querySelector(`[data-score="${selected}"]`)?.focus({ preventScroll: true });
    paintScoreDetail();
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
      const ls = longShot(i, p.hole);
      // (#394) why a ball that didn't sink stopped: picked up, the stroke limit, or the automatic stop with no limit
      const why = p.autoPicked?.[i]?.includes(p.hole) ? 'picked up automatically at 20' : p.picked?.[i] ? 'picked up' : p.cap ? `stroke limit ${p.cap}` : 'picked up';
      r.append(nm, ctx.el('b', 'pp-res ' + markCls(s, par), p.holed[i] ? (s === 1 && !ls ? '🎯 Hole in one!' : `${s} · ${vsPar(s, par, ls)}`) : `${s} (${why})`));
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

  // #217: balls still waiting on the tee (not yours, not mid-putt) stay out of sight, so a crowd of them doesn't pile up there
  function unplayed(i) {
    const p = S.putt;
    return i !== p.me && !p.strokes[i] && !p.holed[i] && !(anim && anim.by === i) && !queue.some((q) => q.by === i);
  }

  function matchingPreview(shot, preview) {
    return shot && preview && Math.abs(preview.angle - shot.angle) < 0.00006
      && Math.abs(preview.power - shot.power) < 0.0006 ? preview : null;
  }

  function loop(now) {
    if (!document.getElementById('ppStage')) { raf = 0; return; }  // the game view is gone: stop drawing
    raf = requestAnimationFrame(loop);
    if (!S?.putt) return;
    const p = S.putt, key = `${p.hole}:${JSON.stringify(p.cells)}`;
    if (key !== holeKey && (gl || flat)) {
      holeKey = key; behindFor = ''; overview = false; holeShownAt = performance.now();
      queue = queue.filter((q) => q.hole === p.hole); if (anim && anim.hole !== p.hole) anim = null;
      (gl || flat).build();
    }
    // play the putts one after another, with their knocks and splashes
    if (!anim && queue.length) {
      anim = { ...queue.shift(), t0: now, hi: 0, ended: false };
      // the tock for every putt, unless it's the one you just struck yourself (that one already sounded)
      if (!(anim.by === p.me && now - struckAt < 2500)) strike(0.5);
    }
    if (anim) {
      const f = ((now - anim.t0) / 1000) * 30;
      // (advance the index outside gl?.effect(): an optional call skips its arguments, which froze the flat view)
      while (anim.hi < anim.hits.length && anim.hits[anim.hi][0] <= f) { const h = anim.hits[anim.hi++]; gl?.effect(h); }
      if (!anim.ended && f >= anim.frames.length - 1) {
        anim.ended = true;
        if (anim.outcome?.length) showResult(anim.by, anim.outcome.join(' · '));
        const [x, y] = anim.frames[anim.frames.length - 1];
        if (anim.result === 'cup') {
          gl?.burst(x, y, 0xffffff, 18); knock(1400, 0.12); setTimeout(() => knock(1000, 0.1), 90);
          if (anim.by === p.me) ctx.confetti?.();
          // a big hole gets its name on screen: a hole in one, or two or more under par
          // (#387) not for a long shot: its credited 1 was played in 2, and the server's own callout says so
          const sk = p.strokes?.[anim.by], par = p.par ?? 3, ls = longShot(anim.by, anim.hole ?? p.hole);
          if (sk && !ls && typeof Kit !== 'undefined' && (sk === 1 || sk - par <= -2)) {
            const who = anim.by === p.me ? 'You' : (ctx.player(p.seats?.[anim.by])?.name ?? 'Someone');
            Kit.callout(`${sk === 1 ? '🎯 Hole in one' : '🦅 Eagle'}: ${who}!`, 'gold', { ms: 1800 });
            ctx.sfx?.('fanfare');
          }
        }
      }
      if (f >= anim.frames.length + 8) anim = null;  // a short rest at the end
    }
    if (now >= resultUntil) $('ppResult').hidden = true;
    const me = p.me, mine = !!anim && anim.by === me;
    // while your ball rolls, the camera follows it; once it stops, it swings round behind it
    if (gl && mine && !cameraLocked && !overview && !aim && !aimSet) gl.view.follow(...ballPos(me, now));
    const mineWaiting = me != null && queue.some((q) => q.by === me);
    if (gl && !overview && !aim && !aimSet && me != null && S.phase === 'playing' && !p.between && !p.holed[me] && !mine && !mineWaiting) {
      // (#386) every putt, the first of a hole too: there the whole hole shows for a moment before the view steps behind the ball
      const k = `${p.hole}:${p.strokes[me]}`, wait = p.strokes[me] === 0 ? 2500 - (performance.now() - holeShownAt) : 0;
      if (k !== behindFor && wait <= 0) { behindFor = k; gl.view.behind(); }
      else if (k !== behindFor && !behindTimer) behindTimer = setTimeout(() => { behindTimer = 0; ctx.rerender?.(); }, wait + 50);
    }
    $('ppDone').hidden = !p.between || rolling();
    const shot = aimShot();
    const bar = $('ppPower');
    bar.hidden = !shot;
    const point = matchingPreview(shot, p.preview)?.point;
    if (shot) {
      const fill = bar.firstElementChild;
      fill.style.width = `${shot.power * 100}%`;
      bar.dataset.pct = `${Math.round(shot.power * 100)}%`;   // (#395) the number beside the colour
      fill.style.background = powerCss(shot.power); fill.style.boxShadow = `0 0 10px ${powerCss(shot.power, 0.8)}`;
    }
    (gl || flat)?.draw(now, shot, point);
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

  // Keep the current round running while the browser makes a GPU context available again.
  function lost(stage) {
    if (!stage.isConnected) return;
    const resetView = () => {
      holeKey = '';
      aim = null; gest = null; pts.clear();
      $('ppPower').hidden = true;
      $('ppCam').hidden = !gl;
    };
    gl?.dispose(); gl = null;
    GL3.revive(stage, {
      build: () => {
        gl = make3d(stage);
        if (gl) resetView();
        return gl;
      },
      flat: () => { flat = make2d(stage); resetView(); },
      unflat: () => { flat = null; },
    });
  }

  function make3d(stage) {
    const T = window.THREE;
    let renderer;
    renderer = GL3.renderer({}, { onLost: () => {
      if (renderer.domElement.isConnected) lost(stage);
    } });
    if (!renderer) return null;
    stage.prepend(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x0c1a2b);
    const camera = new T.PerspectiveCamera(45, 1, 0.05, 120);
    const stg = GL3.stage(renderer, scene, { exposure: 1.1, hemi: [0xdff3ff, 0x1d3b1d, 0.75], key: { i: 0.75, area: 10, near: 1, far: 25 } });
    const hemi = stg.hemi, sun = stg.key;
    // (#385) the land round the course is built per hole in dress(): rolling ground that rises into hills away from it
    const lowGfx = () => window.gfxLevel?.() === 'low';
    // textures, drawn once: mown grass (stripes and speckle) and a dimpled golf ball
    const grass = canvasTex(T, 64, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2); }
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w / 2, h);
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
    const blob = canvasTex(T, 32, 32, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const planks = canvasTex(T, 64, 64, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 6; i++) g.fillRect(0, i * (h / 6), w, 1.5);
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(80,40,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 6, 1); }
    });
    const waterTex = canvasTex(T, 128, 128, (g, w, h) => {
      g.fillStyle = '#15738c'; g.fillRect(0, 0, w, h);
      // The wave spacing repeats at the tile edges so adjacent water tiles join cleanly.
      for (let row = 0; row < 5; row++) {
        const y = (row + 0.5) * h / 5;
        for (const [offset, color, width] of [[0, '#52b4be', 3], [3, '#216e87', 1]]) {
          g.beginPath();
          for (let x = 0; x <= w; x += 4) {
            const waveY = y + offset + 4 * Math.sin(x / w * Math.PI * 2 + row * 1.4);
            if (x === 0) g.moveTo(x, waveY); else g.lineTo(x, waveY);
          }
          g.strokeStyle = color; g.lineWidth = width; g.stroke();
        }
      }
    });
    waterTex.colorSpace = T.SRGBColorSpace;
    const waterMat = new T.MeshStandardMaterial({ map: waterTex, roughness: 0.28, metalness: 0.12 });
    const railMat = new T.MeshStandardMaterial({ color: 0x815436, map: planks, roughness: 0.75 });
    const railCapMat = new T.MeshStandardMaterial({ color: 0xe0b882, roughness: 0.55 });
    const bumperStripeMat = new T.MeshBasicMaterial({ color: 0xffe8bd, toneMapped: false });
    let course = new T.Group(); scene.add(course);

    // each hole's look (#69): a sky, a horizon haze, the light, and trees, flowers or lanterns around the course.
    // The server picks the theme; the scenery's places come from the hole, so every phone sees the same course.
    const THEME = {
      day: { sky: ['#4ea8ff', '#bfe3ff'], fog: 0xbfe3ff, hemi: [0xdff3ff, 0x1d3b1d, 0.75], sun: [0xffffff, 0.75], rough: 0x1f5130, crown: [0x2d6a4f, 0x40916c, 0x52b788], bloom: [0xffd6e8, 0xfff3b0, 0xffffff] },
      sunset: { sky: ['#5b3a8c', '#ff9e6d'], fog: 0xf7a072, hemi: [0xffd1a8, 0x2a1d3b, 0.7], sun: [0xffb37a, 0.85], rough: 0x23402b, crown: [0x2f5d46, 0x3f6f4f, 0x5a7d4f], bloom: [0xffb4a2, 0xffd166] },
      night: { sky: ['#050b1d', '#1b2a4e'], fog: 0x14203d, hemi: [0x8fb3ff, 0x0b1a10, 0.55], sun: [0xbcd2ff, 0.45], rough: 0x0f2a1a, crown: [0x18392b, 0x1f4a37], bloom: [], lamps: true, stars: true },
      autumn: { sky: ['#7fb4d8', '#f3e1c4'], fog: 0xf0dcc0, hemi: [0xfff0d6, 0x3b2a14, 0.75], sun: [0xfff1d6, 0.8], rough: 0x4a4a22, crown: [0xd9480f, 0xf08c00, 0xe8590c, 0xb08900], bloom: [0xf4a261] },
    };
    function skyTex(th) {
      return canvasTex(T, 4, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.75, th.sky[1]); gr.addColorStop(1, th.sky[1]);
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
    }
    function starTex(th) {
      return canvasTex(T, 256, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, th.sky[0]); gr.addColorStop(1, th.sky[1]);
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`; g.fillRect(Math.random() * w, Math.random() * h * 0.7, 1, 1); }
      });
    }
    const trunkGeo = new T.CylinderGeometry(0.05, 0.08, 0.4, 6);
    // (#385) a pine's three tiers, a leafy tree's blobs (also bushes and cloud puffs), a rock
    const pineGeo = [new T.ConeGeometry(0.62, 0.5, 8), new T.ConeGeometry(0.5, 0.42, 8), new T.ConeGeometry(0.36, 0.36, 8)];
    const leafGeo = new T.IcosahedronGeometry(0.42, 1), rockGeo = new T.DodecahedronGeometry(0.16, 0);
    const pineFar = [new T.ConeGeometry(0.62, 0.5, 5), new T.ConeGeometry(0.5, 0.42, 5), new T.ConeGeometry(0.36, 0.36, 5)];
    const leafFar = new T.IcosahedronGeometry(0.42, 0);
    const bloomGeo = new T.SphereGeometry(0.04, 6, 4), lampGeo = new T.SphereGeometry(0.08, 10, 8), poleGeo = new T.CylinderGeometry(0.02, 0.02, 0.5, 5);
    let skyFor = '';
    function dress(p) {
      const th = THEME[p.theme] || THEME.day;
      if (skyFor !== p.theme) {
        skyFor = p.theme;
        scene.background?.dispose?.();
        scene.background = th.stars ? starTex(th) : skyTex(th);
        scene.fog = new T.Fog(th.fog, 16, 46);
        hemi.color.setHex(th.hemi[0]); hemi.groundColor.setHex(th.hemi[1]); hemi.intensity = th.hemi[2];
        sun.color.setHex(th.sun[0]); sun.intensity = th.sun[1];
      }
      // a little random sequence of the hole's own, the same on every phone
      let seed = (p.hole * 7919 + p.cells.length * 104729 + Math.round(p.cup[0] * 31)) >>> 0;
      const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const near = (x, y, d) => p.cells.some(([cx, cy]) => x > cx - d && x < cx + 1 + d && y > cy - d && y < cy + 1 + d);
      // (#385) the land: flat by the course, rising into rolling hills away from it, shaded darker in the dips
      const b0 = bounds(), low = lowGfx();
      const away = (x, y) => {   // distance from the nearest tile of the course
        let d = Infinity;
        for (const [cx, cy] of p.cells) d = Math.min(d, Math.hypot(Math.max(cx - x, 0, x - cx - 1), Math.max(cy - y, 0, y - cy - 1)));
        return d;
      };
      const ss = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
      const terrainH = (x, y) => {
        const n = Math.sin(x * 0.33 + 1.3) * Math.cos(y * 0.27 + 0.7) + 0.55 * Math.sin(x * 0.71 + y * 0.53 + 2.1) + 0.3 * Math.cos(x * 1.3 - y * 1.1);
        return -0.22 + ss(1.2, 7, away(x, y)) * (0.5 + 0.85 * (n * 0.45 + 0.5)) * 1.7;
      };
      {
        const S_ = 90, N = low ? 40 : 64, geo = new T.PlaneGeometry(S_, S_, N, N);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position, cols = [], base = new T.Color(th.rough), c = new T.Color();
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) + b0.cx, z = pos.getZ(i) + b0.cz, h = terrainH(x, -z);
          pos.setXYZ(i, x, h, z);
          const shade = 0.78 + 0.3 * Math.min(1, (h + 0.22) / 2.2) + 0.05 * Math.sin(x * 2.3 + z * 1.7);
          c.copy(base).multiplyScalar(shade); cols.push(c.r, c.g, c.b);
        }
        geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
        geo.computeVertexNormals();
        const land = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: !low }));
        land.receiveShadow = true; course.add(land);
      }
      // far mountains round the edge, half lost in the haze
      {
        const ring = [], hz = new T.Color(th.fog).lerp(new T.Color(th.rough), 0.45);
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2 + rnd() * 0.2, r = 34 + rnd() * 8;
          ring.push([b0.cx + Math.cos(a) * r, b0.cz + Math.sin(a) * r, 5 + rnd() * 7, 4 + rnd() * 5]);
        }
        const im = new T.InstancedMesh(new T.ConeGeometry(1, 1, 6), new T.MeshLambertMaterial({ color: hz, flatShading: true }), ring.length);
        const m4 = new T.Matrix4();
        ring.forEach(([x, z, h, w], i) => { m4.compose(new T.Vector3(x, h / 2 - 0.5, z), new T.Quaternion().setFromEuler(new T.Euler(0, rnd() * 3, 0)), new T.Vector3(w, h, w)); im.setMatrixAt(i, m4); });
        course.add(im);
      }
      const trees = [], blooms = [], lamps = [], rocks = [], bushes = [];
      const reach = low ? 5 : 8;
      for (let y = -reach; y < p.rows + reach; y += 0.9) for (let x = -reach; x < p.cols + reach; x += 0.9) {
        const jx = x + rnd() * 0.8, jy = y + rnd() * 0.8;
        if (near(jx, jy, 0.55)) continue;
        const r = rnd(), far = away(jx, jy), h = terrainH(jx, jy);
        // no trees right behind the tee or round the cup: that's where the camera stands to look down the hole
        const clear = Math.hypot(jx - p.tee[0], jy - p.tee[1]) < 3.2 || Math.hypot(jx - p.cup[0], jy - p.cup[1]) < 1.6;
        const dense = far < 4 ? 0.27 : 0.4;   // woods thicken toward the hills
        const k = 0.7 + rnd() * 0.8, pine = th.lamps ? rnd() < 0.85 : p.theme === 'autumn' ? rnd() < 0.25 : rnd() < 0.55;
        // a tree keeps its crown clear of the course: the bigger and rounder, the further back it stands
        const room = far > 0.35 + k * (pine ? 0.55 : 0.75);
        if (r < dense && !clear && room) trees.push({ x: jx, y: jy, h, near: far < 3, k, c: Math.floor(rnd() * th.crown.length), pine, lean: pine ? [rnd() - 0.5, rnd() - 0.5] : [0, 0], turn: rnd() * 6.3, tint: 0.85 + rnd() * 0.3 });
        else if (r < 0.5 && th.bloom.length && far < 1.6) blooms.push([jx, jy, Math.floor(rnd() * th.bloom.length)]);
        else if (r < 0.56 && far < 4) rocks.push({ x: jx, y: jy, h, k: 0.6 + rnd() * 1.1, turn: rnd() * 6 });
        else if (r < 0.66 && far < 3) bushes.push({ x: jx, y: jy, h, k: 0.6 + rnd() * 0.7, turn: rnd() * 6, tint: 0.8 + rnd() * 0.3 });
      }
      if (low) trees.splice(Math.floor(trees.length * 0.6));
      if (th.lamps) for (const [x, y] of p.path.filter((_, k) => k % 3 === 1)) {
        const side = rnd() < 0.5 ? -0.25 : 1.25;
        if (!near(x + side, y + 0.5, 0.05)) lamps.push([x + side, y + 0.5]);
      }
      const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), at = new T.Vector3(), up = new T.Euler();
      const group = (geo, mat, list, place, shadow = false) => {
        if (!list.length) return;
        const im = new T.InstancedMesh(geo, mat, list.length);
        const col = new T.Color();
        list.forEach((it, i) => {
          const tint = place(it, col);
          m4.compose(at, q.setFromEuler(up), sc); im.setMatrixAt(i, m4);
          if (tint) im.setColorAt(i, col);
        });
        im.castShadow = shadow && !low; im.receiveShadow = true;
        im.frustumCulled = false;   // r128 culls an instanced mesh by one instance's bounds at the origin
        course.add(im);
      };
      // (#385) trees: pines of three tiers, or round leafy trees of a few clustered blobs; each its own size, lean and shade
      // near the course: full detail and shadows; further off, simpler shapes and no shadows (the far ones are many)
      const sets = [[trees.filter((t) => t.near), pineGeo, leafGeo, true], [trees.filter((t) => !t.near), pineFar, leafFar, false]];
      const tilt = (t, y0) => { up.set(t.lean[0] * 0.07, t.turn, t.lean[1] * 0.07); return y0; };   // pines lean a little
      const crown = (t, col, light) => col.setHex(th.crown[t.c]).multiplyScalar(t.tint * light);
      group(trunkGeo, new T.MeshLambertMaterial({ color: 0x5c3d2e }), trees, (t) => { at.set(t.x, t.h + 0.2 * t.k, -t.y); sc.set(t.k, t.k * (t.pine ? 1 : 1.4), t.k); tilt(t); });
      for (const [set, pg, lg, shadow] of sets) {
        const pines = set.filter((t) => t.pine), leafy = set.filter((t) => !t.pine);
        [[0.42, 0.8], [0.78, 0.95], [1.08, 1.1]].forEach(([y, light], tier) => {
          group(pg[tier], new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), pines, (t, col) => {
            at.set(t.x, t.h + y * t.k, -t.y); sc.set(t.k, t.k, t.k); tilt(t); crown(t, col, light); return true;
          }, shadow);
        });
        [[0, 0.95, 0, 1, 1], [0.24, 0.8, 0.1, 0.75, 0.9], [-0.2, 0.84, -0.14, 0.8, 1.08]].forEach(([dx, y, dz, r, light]) => {
          group(lg, new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), leafy, (t, col) => {
            const c = Math.cos(t.turn), s2 = Math.sin(t.turn);
            at.set(t.x + (dx * c - dz * s2) * t.k, t.h + y * t.k * 1.2, -t.y + (dx * s2 + dz * c) * t.k);
            sc.set(t.k * r, t.k * r * 0.9, t.k * r); up.set(0, t.turn, 0); crown(t, col, light); return true;
          }, shadow);
        });
      }
      group(rockGeo, new T.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.95, flatShading: true }), rocks, (r) => { at.set(r.x, r.h + 0.03 * r.k, -r.y); sc.set(r.k, r.k * 0.6, r.k * 0.9); up.set(0, r.turn, 0); }, true);
      group(leafGeo, new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), bushes, (b, col) => {
        at.set(b.x, b.h + 0.08 * b.k, -b.y); sc.set(b.k * 0.42, b.k * 0.3, b.k * 0.42); up.set(0, b.turn, 0);
        col.setHex(th.crown[0]).multiplyScalar(b.tint); return true;
      });
      blooms.forEach((b) => (b.color = th.bloom[b[2]]));
      group(bloomGeo, new T.MeshLambertMaterial({ color: 0xffffff }), blooms, ([x, y, c], col) => { at.set(x, -0.19, -y); sc.set(1, 1, 1); up.set(0, 0, 0); col.setHex(th.bloom[c]); return true; });
      group(poleGeo, new T.MeshLambertMaterial({ color: 0x333a44 }), lamps, ([x, y]) => { at.set(x, 0.03, -y); sc.set(1, 1, 1); up.set(0, 0, 0); });
      group(lampGeo, new T.MeshBasicMaterial({ color: 0xffe8a3 }), lamps, ([x, y]) => { at.set(x, 0.3, -y); sc.set(1, 1, 1); up.set(0, 0, 0); });
      // (#385) the sky moves: clouds drift over by day; at night fireflies hang about the course
      clouds = null; flies = null;
      if (!th.stars) {
        clouds = new T.Group();
        const mat = new T.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, flatShading: true });
        for (let i = 0; i < (low ? 4 : 9); i++) {
          const cl = new T.Group(), cx = b0.cx + (rnd() - 0.5) * 50, cz = b0.cz + (rnd() - 0.5) * 50, y = 9 + rnd() * 5;
          for (let j = 0; j < 4; j++) {
            const puff = new T.Mesh(leafGeo, mat);
            puff.position.set((j - 1.5) * 1.1 + rnd(), rnd() * 0.5, rnd()); puff.scale.set(2 + rnd(), 1 + rnd() * 0.6, 1.6 + rnd());
            cl.add(puff);
          }
          cl.position.set(cx, y, cz); clouds.add(cl);
        }
        course.add(clouds);
      } else {
        const n = low ? 20 : 45, geo = new T.BufferGeometry(), pos = new Float32Array(n * 3);
        flies = { seeds: [], geo };
        for (let i = 0; i < n; i++) {
          const [cx, cy] = p.cells[Math.floor(rnd() * p.cells.length)];
          flies.seeds.push([cx + rnd() * 1.4 - 0.2, cy + rnd() * 1.4 - 0.2, 0.15 + rnd() * 0.5, rnd() * 6]);
        }
        geo.setAttribute('position', new T.BufferAttribute(pos, 3));
        course.add(new T.Points(geo, new T.PointsMaterial({ color: 0xfff3a0, size: 0.06, transparent: true, opacity: 0.9, toneMapped: false })));
      }
    }
    let clouds = null, flies = null;
    function ambient(dt, now) {   // (#385) drifting clouds, wandering fireflies
      if (clouds) for (const cl of clouds.children) { cl.position.x += dt * 0.25; if (cl.position.x > box.cx + 30) cl.position.x -= 60; }
      if (flies) {
        const pos = flies.geo.attributes.position, t = now / 1000;
        flies.seeds.forEach(([x, y, hgt, ph], i) => pos.setXYZ(i, x + 0.25 * Math.sin(t * 0.6 + ph), hgt + 0.08 * Math.sin(t * 1.7 + ph * 2), -(y + 0.25 * Math.cos(t * 0.5 + ph))));
        pos.needsUpdate = true;
      }
    }
    const balls = [], ballGeo = new T.SphereGeometry(1, 28, 18);
    let flag = null, flagBase = null, cupGlow = null;
    // aim guide (#82): dots that drift out from the ball and shrink toward an arrowhead, all in the power colour
    const AIM_DOTS = 12, aimMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const aimDots = [], dotGeo = new T.SphereGeometry(1, 10, 8);
    for (let k = 0; k < AIM_DOTS; k++) { const m = new T.Mesh(dotGeo, aimMat); m.visible = false; scene.add(m); aimDots.push(m); }
    const headGeo = new T.ConeGeometry(0.09, 0.22, 14); headGeo.rotateZ(-Math.PI / 2);  // points along +x
    const aimHead = new T.Mesh(headGeo, aimMat); aimHead.visible = false; scene.add(aimHead);
    const bumperMeshes = [], effects = [], mills = [];
    // a ring on the ground under your own ball, so you can find it (every ball starts on the same tee)
    const ring = new T.Mesh(new T.RingGeometry(0.1, 0.14, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    const W = (x, y) => new T.Vector3(x, groundH(x, y), -y);

    // a tile with a hump or a bowl in it: a grid of vertices lifted to the ground's height
    // corner: the tile's corners as slabGeometry takes them (#368): grid points outside a rounded or cut corner are
    // pulled onto its edge, so a hill or a ramp never pokes out past the curved rail
    function hillTile(x, y, color, corner = []) {
      const N = 18, pos = [], uv = [], idx = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        let u = i / N, v = j / N;
        CORNERS.forEach(([sx, sy], k) => {
          const c = corner[k];
          if (!c) return;
          const gx = u - 0.5, gy = v - 0.5, r = c[1];
          if (c[0] === 'round') {
            const ox = 0.5 * sx - r * sx, oy = 0.5 * sy - r * sy, d = Math.hypot(gx - ox, gy - oy);
            if ((gx - ox) * sx > 0 && (gy - oy) * sy > 0 && d > r) { u = ox + (gx - ox) * r / d + 0.5; v = oy + (gy - oy) * r / d + 0.5; }
          } else {
            const over = sx * gx + sy * gy - (1 - r);
            if (over > 0) { u -= sx * over / 2; v -= sy * over / 2; }
          }
        });
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

    // (#368, sent back: "does not look so box like") the course is one smooth surface: tiles sit flush with no bevel
    // and no seam, and only the course's outer corners are rounded, to the radius the server's walls curve at
    // (roundR). A tile's corners are numbered round it: 0 (+x,-y), 1 (+x,+y), 2 (-x,+y), 3 (-x,-y).
    const CORNERS = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    const slabs = new Map();
    // a hole (radius holeR at (hx, hy) from the tile's middle, or none) cut through the slab: the cup's tile has one, so the
    // well can go down into the course (#370). The cup is seldom dead centre (the server puts it at y + 0.55).
    // corner: per corner [shape, size] — 'round' (a quarter circle), 'flat' (a 45° cut, a bank) or null (square)
    function slabGeometry(corner = [], holeR = 0, hx = 0, hy = 0) {
      const key = corner.map((c) => (c ? c.join(':') : '-')).join('|');
      if (!holeR && slabs.has(key)) return slabs.get(key);
      const shape = new T.Shape();   // in the tile's own grid units: shape y is the course's +y (rotated onto -z below)
      shape.moveTo(-0.5 + (corner[3] ? corner[3][1] : 0), -0.5);
      CORNERS.forEach(([sx, sy], k) => {
        const a0 = -Math.PI / 2 + k * Math.PI / 2, c = corner[k];
        if (c && c[0] === 'round') shape.absarc(0.5 * sx - c[1] * sx, 0.5 * sy - c[1] * sy, c[1], a0, a0 + Math.PI / 2, false);
        else if (c) {   // the cut runs from the side coming in to the side going out
          const r = c[1], into = k % 2 ? [0.5 * sx, 0.5 * sy - r * sy] : [0.5 * sx - r * sx, 0.5 * sy];
          const out = k % 2 ? [0.5 * sx - r * sx, 0.5 * sy] : [0.5 * sx, 0.5 * sy - r * sy];
          shape.lineTo(...into); shape.lineTo(...out);
        } else shape.lineTo(0.5 * sx, 0.5 * sy);
      });
      shape.closePath();
      if (holeR) shape.holes.push(new T.Path().absarc(hx, hy, holeR, 0, Math.PI * 2, true));
      const geo = new T.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false, curveSegments: holeR ? 24 : 10 });
      geo.rotateX(-Math.PI / 2);      // lay it flat: the thickness runs up the Y axis
      geo.translate(0, -0.1, 0);      // and span -0.1 .. 0.1, as the box it replaces did
      if (!holeR) slabs.set(key, geo);
      return geo;
    }
    // (#368, sent back: "the wall lip intersects with other wall lips") the rails are one piece per loop round the course:
    // its boundary is traced edge by edge, the outer corners rounded (or banked, as the server banks them), the inner
    // corners given a small fillet, and the whole loop built as one wall with one rounded cap, so no two lips cross
    const RAIL_T = 0.07, RAIL_TOP = 0.12, CAP_R = 0.045, FILLET = 0.07;
    function buildRails(open, cornerOf) {
      // every edge between an open and a closed cell, pointing so the course is on its left
      const edges = new Map(), add = (x1, y1, x2, y2) => {
        const k = `${x1},${y1}`;
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push({ a: [x1, y1], b: [x2, y2], d: [x2 - x1, y2 - y1], used: false });
      };
      for (const key of open) {
        const [x, y] = key.split(',').map(Number);
        if (!open.has(`${x},${y - 1}`)) add(x, y, x + 1, y);
        if (!open.has(`${x + 1},${y}`)) add(x + 1, y, x + 1, y + 1);
        if (!open.has(`${x},${y + 1}`)) add(x + 1, y + 1, x, y + 1);
        if (!open.has(`${x - 1},${y}`)) add(x, y + 1, x, y);
      }
      const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
      for (const list of edges.values()) for (const first of list) {
        if (first.used) continue;
        const loop = [];   // follow the boundary round to where it started
        for (let e = first; e && !e.used;) {
          e.used = true; loop.push(e);
          const next = (edges.get(`${e.b[0]},${e.b[1]}`) || []).filter((n) => !n.used);
          next.sort((m, n) => cross(e.d, n.d) - cross(e.d, m.d));   // where two corners touch, keep turning left
          e = next[0];
        }
        railLoop(loop, cornerOf);
      }
    }
    function railLoop(loop, cornerOf) {
      // merge straight runs; each join is a corner: a left turn is an outer corner of the course, a right turn an inner one
      const runs = [];
      for (const e of loop) {
        const last = runs[runs.length - 1];
        if (last && last.d[0] === e.d[0] && last.d[1] === e.d[1]) last.b = e.b;
        else runs.push({ a: e.a, b: e.b, d: e.d });
      }
      if (runs.length > 1 && runs[0].d[0] === runs[runs.length - 1].d[0] && runs[0].d[1] === runs[runs.length - 1].d[1]) {
        runs[0].a = runs.pop().a;
      }
      const n = runs.length, corners = runs.map((r, i) => {
        const o = runs[(i + 1) % n], q = r.b, left = r.d[0] * o.d[1] - r.d[1] * o.d[0] > 0;
        if (!left) return { q, kind: 'round', r: FILLET, left };
        // an outer corner belongs to the tile inside it; it curves as that tile's slab does
        const cx = q[0] - r.d[0] * 0.5 + o.d[0] * 0.5, cy = q[1] - r.d[1] * 0.5 + o.d[1] * 0.5;
        const c = cornerOf(Math.floor(cx), Math.floor(cy), r.d[0] - o.d[0], r.d[1] - o.d[1]);
        return { q, kind: c ? c[0] : 'round', r: c ? c[1] : FILLET, left };
      });
      // the centre line, as points with the way into the course (left of travel)
      const pts = [];
      const push = (x, y, dx, dy) => { const l = Math.hypot(dx, dy) || 1; pts.push([x, y, -dy / l, dx / l]); };
      runs.forEach((r, i) => {
        const r0 = corners[(i - 1 + n) % n].r, r1 = corners[i].r;
        const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) - r0 - r1, steps = Math.max(1, Math.ceil(len / 0.25));
        for (let k = 0; k <= steps; k++) {
          const t = r0 + (len * k) / steps;
          push(r.a[0] + r.d[0] * t, r.a[1] + r.d[1] * t, r.d[0], r.d[1]);
        }
        const c = corners[i], o = runs[(i + 1) % n], s0 = [c.q[0] - r.d[0] * c.r, c.q[1] - r.d[1] * c.r], s1 = [c.q[0] + o.d[0] * c.r, c.q[1] + o.d[1] * c.r];
        if (c.kind === 'flat') { push(...s0, (s1[0] - s0[0]), (s1[1] - s0[1])); push(...s1, (s1[0] - s0[0]), (s1[1] - s0[1])); return; }
        const side = c.left ? 1 : -1, nl = [-r.d[1], r.d[0]];   // the arc's centre: into the course for an outer corner
        const ox = s0[0] + nl[0] * c.r * side, oy = s0[1] + nl[1] * c.r * side;
        const a0 = Math.atan2(s0[1] - oy, s0[0] - ox), a1 = Math.atan2(s1[1] - oy, s1[0] - ox);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        for (let k = 1; k < 8; k++) {
          const a = a0 + (da * k) / 8;
          push(ox + c.r * Math.cos(a), oy + c.r * Math.sin(a), -Math.sin(a) * Math.sign(da), Math.cos(a) * Math.sign(da));
        }
      });
      const clean = pts.filter((pt, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(pt[0] - q[0], pt[1] - q[1]) > 1e-4; });
      // the wall: the band between the centre line moved half the rail's thickness each way, standing on the tile bottom
      const outer = clean.map(([x, y, nx, ny]) => new T.Vector2(x - nx * RAIL_T / 2, y - ny * RAIL_T / 2));
      const inner = clean.map(([x, y, nx, ny]) => new T.Vector2(x + nx * RAIL_T / 2, y + ny * RAIL_T / 2));
      const shape = new T.Shape(outer); shape.holes.push(new T.Path(inner));
      const geo = new T.ExtrudeGeometry(shape, { depth: RAIL_TOP + 0.2, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2); geo.translate(0, -0.2, 0);
      const wall = new T.Mesh(geo, railMat); wall.castShadow = wall.receiveShadow = true; course.add(wall);
      // the lip: one rounded tube all the way round
      const curve = new T.CatmullRomCurve3(clean.map(([x, y]) => new T.Vector3(x, RAIL_TOP, -y)), true, 'centripetal');
      course.add(new T.Mesh(new T.TubeGeometry(curve, clean.length * 3, CAP_R, 8, true), railCapMat));
    }
    const hazardMaterials = new Map();
    const hazardPlane = new T.PlaneGeometry(0.65, 0.65);
    function addHazardMark(x, y, kind, p) {
      const mark = hazardMark(kind, p);
      if (!mark) return;
      if (!hazardMaterials.has(mark)) {
        const map = canvasTex(T, 128, 128, (g) => {
          g.font = 'bold 74px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = 6; g.strokeStyle = '#18232b'; g.fillStyle = '#fff4cf';
          g.strokeText(mark, 64, 64); g.fillText(mark, 64, 64);
        });
        hazardMaterials.set(mark, new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
      }
      const mesh = new T.Mesh(hazardPlane, hazardMaterials.get(mark));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x + 0.5, groundH(x + 0.5, y + 0.5) + (kind === 'ramp' ? 0.05 : 0.015), -(y + 0.5));
      course.add(mesh);
    }
    function build() {
      scene.remove(course); course = new T.Group(); scene.add(course);
      bumperMeshes.length = 0;
      const p = S.putt, open = new Set(p.cells.map(([x, y]) => `${x},${y}`));
      const hills = new Set((p.hills || []).map((h) => `${h[0]},${h[1]}`));
      const blades = [];  // grass blades to stand on the fringe and the long grass: [x, y, height]
      mills.length = 0;
      dress(p);
      const cornerOf = cornerRule(p);   // (#368) shared with the flat view (#392)
      const rounded = (x, y) => CORNERS.map(([sx, sy]) => cornerOf(x, y, sx, sy));
      buildRails(open, cornerOf);
      for (const [x, y] of p.cells) {
        const round = rounded(x, y);
        const kind = p.kinds[`${x},${y}`];
        addHazardMark(x, y, kind, p);
        const color = kind ? COLORS[kind] : COLORS.fair[(x + y) % 2];
        if (kind === 'fringe' || kind === 'long') {
          const n = kind === 'long' ? 70 : 30, tall = kind === 'long' ? 0.06 : 0.03;
          for (let i = 0; i < n; i++) blades.push([x + 0.04 + Math.random() * 0.92, y + 0.04 + Math.random() * 0.92, tall * (0.6 + Math.random() * 0.6)]);
        }
        if (hills.has(`${x},${y}`) || kind === 'ramp') {
          course.add(hillTile(x, y, color, round));
          // the earth under it: the same outline as a flat tile's slab, squashed to 0.06 thick (#368)
          const base = new T.Mesh(slabGeometry(round), new T.MeshStandardMaterial({ color: 0x1f6f35 }));
          base.scale.y = 0.3; base.position.set(x + 0.5, -0.17, -(y + 0.5)); course.add(base);
        } else {
          const water = kind === 'water';
          const mat = water ? waterMat : new T.MeshStandardMaterial({ color, roughness: 0.9, map: grass });
          const cupTile = !water && Math.floor(p.cup[0]) === x && Math.floor(p.cup[1]) === y;   // the cell the cup is in
          const tile = new T.Mesh(cupTile ? slabGeometry(round, p.cupR, p.cup[0] - x - 0.5, p.cup[1] - y - 0.5) : slabGeometry(round), mat);
          tile.position.set(x + 0.5, water ? -0.16 : -0.1, -(y + 0.5)); tile.receiveShadow = true; tile.castShadow = cupTile; course.add(tile);   // (#370) the lip shades the well
        }
        if (kind === 'slope' && p.slope) {
          const arrow = new T.Mesh(new T.ConeGeometry(0.12, 0.3, 12), new T.MeshBasicMaterial({ color: 0xffffff }));
          arrow.position.set(x + 0.5, 0.02, -(y + 0.5));
          arrow.lookAt(x + 0.5 + p.slope[0], 0.02, -(y + 0.5 + p.slope[1]));  // +Z toward the downhill side
          arrow.rotateX(Math.PI / 2);  // the cone's tip (+Y) now points along +Z
          course.add(arrow);
        }
      }
      for (const [bx, by, br] of p.bumpers) {
        const b = new T.Mesh(new T.CylinderGeometry(br, br, 0.14, 28), new T.MeshStandardMaterial({ color: 0xff70a6, emissive: 0x551133 }));
        b.position.copy(W(bx, by)).setY(0.05); b.castShadow = true; course.add(b);
        const stripe = new T.Mesh(new T.RingGeometry(br * 0.72, br * 0.89, 28), bumperStripeMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.y = 0.071;
        b.add(stripe);
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
      // banks are part of the rail outline (buildRails): a turn's outer corner curves or is cut across at 45°
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
        // a gabled roof: a triangular prism running along the wall, with a ridge cap
        const roof = new T.Mesh(new T.CylinderGeometry(0.23, 0.23, 1.04, 3), new T.MeshStandardMaterial({ color: 0xb23a48, roughness: 0.7 }));
        roof.rotation.order = 'ZYX'; roof.rotation.set(0, Math.PI / 2, Math.PI / 2);
        roof.position.set(mx + 0.5, 0.535, -(line + 0.12)); roof.castShadow = true; g.add(roof);
        const ridge = new T.Mesh(new T.BoxGeometry(1.06, 0.03, 0.05), new T.MeshStandardMaterial({ color: 0x7d2230, roughness: 0.6 }));
        ridge.position.set(mx + 0.5, 0.655, -(line + 0.12)); g.add(ridge);
        // (#369) the hub sits in front of the roof: the sails used to turn through its gable
        const hub = new T.Group();
        hub.position.set(mx + 0.5, 0.5, -(line - 0.14));
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
      // the cup: a dark well that gets deeper toward the middle, a worn-lighter apron round it, a bright metal rim and
      // a soft ring that breathes so the hole reads from far away (#216)
      const cupAt = W(...p.cup), flatRing = (r0, r1, mat, y) => { const m = new T.Mesh(new T.RingGeometry(r0, r1, 40), mat); m.rotation.x = -Math.PI / 2; m.position.copy(cupAt).setY(y); course.add(m); return m; };
      const well = canvasTex(T, 64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        gr.addColorStop(0, '#000'); gr.addColorStop(0.7, '#0b0b0e'); gr.addColorStop(1, '#2b2d33');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      // the well goes down through the tile: a dark wall, and the floor at its bottom (the gradient darkens toward the middle)
      // (#370) a real hole: the walls and the floor take the light and the shadow of the lip above them
      // the wall darkens with depth, as the light from the opening fades (a painted shadow: the sun's map is too coarse for so small a hole)
      const wallTex = canvasTex(T, 4, 64, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);   // canvas top = the cylinder's top edge
        gr.addColorStop(0, '#8a7458'); gr.addColorStop(0.12, '#4a3b2a'); gr.addColorStop(0.5, '#1c150e'); gr.addColorStop(1, '#050403');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      const shaft = new T.Mesh(new T.CylinderGeometry(p.cupR, p.cupR, 0.16, 40, 1, true), new T.MeshStandardMaterial({ map: wallTex, roughness: 1, side: T.BackSide }));
      shaft.position.copy(cupAt).setY(-0.08); shaft.receiveShadow = true; course.add(shaft);
      const cup = new T.Mesh(new T.CircleGeometry(p.cupR, 40), new T.MeshStandardMaterial({ map: well, color: 0x6a6a6a, roughness: 1 }));
      cup.rotation.x = -Math.PI / 2; cup.position.copy(cupAt).setY(-0.158); cup.receiveShadow = true; course.add(cup);
      // a soft shadow on the grass just round the lip, so the opening sits in the green rather than on it (a ring's
      // texture is mapped flat over its square, so the gradient is radial: the lip is at 1/1.6 of the way out)
      flatRing(p.cupR, p.cupR * 1.6, new T.MeshBasicMaterial({ map: canvasTex(T, 64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, w / 2 / 1.6, w / 2, h / 2, w / 2); gr.addColorStop(0, '#000000a0'); gr.addColorStop(1, '#00000000');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }), transparent: true, depthWrite: false }), 0.004);
      // a dark lip, not a bright ring, so the opening reads as a hole
      const rim = new T.Mesh(new T.TorusGeometry(p.cupR, 0.008, 8, 40), new T.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.3, roughness: 0.6 }));
      rim.rotation.x = Math.PI / 2; rim.position.copy(cupAt).setY(0.002); rim.castShadow = true; course.add(rim);
      cupGlow = flatRing(p.cupR * 2.6, p.cupR * 2.9,   // (#370) faint and clear of the lip, so the hole isn't a white ring
        new T.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide }), 0.01);
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
      spinV = null;
      Object.assign(goal, HOME); Object.assign(view, HOME);
      resize();
    }
    function ensureBalls() {
      while (balls.length > S.putt.seats.length) { const o = balls.pop(); scene.remove(o.mesh); scene.remove(o.sh); }  // a rematch with fewer players (#53)
      while (balls.length < S.putt.seats.length) {
        const i = balls.length;
        const m = new T.Mesh(ballGeo, new T.MeshPhysicalMaterial({ color: new T.Color(colorOf(i)), map: dimples, bumpMap: dimples, bumpScale: 0.12, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, emissive: new T.Color(colorOf(i)), emissiveIntensity: 0.12 }));
        m.scale.setScalar(S.putt.ball * 1.3); m.castShadow = true;
        // a soft blob under it, so you can see where it is on the green and how high it's flying
        const sh = new T.Mesh(new T.CircleGeometry(1, 20), new T.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.6 }));
        sh.rotation.x = -Math.PI / 2; scene.add(sh);
        scene.add(m); balls.push({ mesh: m, last: null, sh });
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
    const HOME = { yaw: 0, tilt: 1.05, zoom: 1, px: 0, pz: 0 }, AIM_TILT = 0.74;
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
      v.tilt = Math.min(1.56, Math.max(0.3, v.tilt));   // (#385) down to a low look along the course
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
      if (spinV) {
        goal.yaw += spinV.yaw * dt; view.yaw = goal.yaw;
        goal.tilt += spinV.tilt * dt; clamp(goal); view.tilt = goal.tilt;
        const f = Math.exp(-dt * 3.5); spinV.yaw *= f; spinV.tilt *= f;
        if (Math.abs(spinV.yaw) < 0.02 && Math.abs(spinV.tilt) < 0.02) spinV = null;
        place();
      }
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
    // (#386) where to look from the ball: the cup if there's a clear straight line to it, else the furthest point
    // down the fairway you can see straight to (not just the next tile), so the view lines up with a real putt
    function downFairway(x, y) {
      const p = S.putt, path = p.path || [];
      if (!path.length) return [p.cup[0] - x, p.cup[1] - y];
      const open = new Set(p.cells.map(([cx, cy]) => `${cx},${cy}`));
      const clear = (tx, ty) => {   // the line from the ball stays on the course, a ball's width from any wall
        const n = Math.ceil(Math.hypot(tx - x, ty - y) / 0.08);
        for (let i = 1; i <= n; i++) {
          const u = i / n, sx = x + (tx - x) * u, sy = y + (ty - y) * u;
          for (const [ox, oy] of [[0, 0], [0.07, 0], [-0.07, 0], [0, 0.07], [0, -0.07]]) if (!open.has(`${Math.floor(sx + ox)},${Math.floor(sy + oy)}`)) return false;
        }
        return true;
      };
      let k = path.findIndex(([cx, cy]) => cx === Math.floor(x) && cy === Math.floor(y));
      if (k < 0) k = path.reduce((best, c, j) => (Math.hypot(c[0] + 0.5 - x, c[1] + 0.5 - y) < Math.hypot(path[best][0] + 0.5 - x, path[best][1] + 0.5 - y) ? j : best), 0);
      if (clear(...p.cup)) return [p.cup[0] - x, p.cup[1] - y];
      for (let j = path.length - 1; j > k; j--) {
        const tx = path[j][0] + 0.5, ty = path[j][1] + 0.5;
        if (clear(tx, ty)) return [tx - x, ty - y];
      }
      const [tx, ty] = k >= path.length - 1 ? p.cup : [path[k + 1][0] + 0.5, path[k + 1][1] + 0.5];
      return [tx - x, ty - y];
    }
    // close enough to see the ball clearly, far enough to show about three tiles across (a tall phone sees
    // much less side to side than up and down, so the distance follows the screen's shape)
    const nearDist = () => Math.max(3.6, 1.6 / (camera.aspect * Math.tan((camera.fov / 2) * Math.PI / 180)));
    let spinV = null;   // (#385) a flicked view still turning: radians a second, yaw and tilt
    const viewApi = {
      fit() { spinV = null; Object.assign(goal, HOME); },
      spin(vyaw, vtilt) { spinV = { yaw: vyaw, tilt: vtilt }; },
      stop(freeze = false) { spinV = null; if (freeze) Object.assign(goal, view); },
      // zoom by f keeping the ground under screen point (x, y) where it is
      zoomAt(f, x, y) {
        const a = toGround(x, y);
        goal.zoom *= f; clamp(goal); view.zoom = goal.zoom; place();
        const b = toGround(x, y);
        if (a && b) { for (const v of [view, goal]) { v.px += a.x - b.x; v.pz += a.z - b.z; } place(); }
      },
      // fly the view to the ground under screen point (x, y), a little closer
      focus(x, y) {
        const g = toGround(x, y);
        if (!g || !box) return;
        spinV = null;
        goal.px = g.x - box.cx; goal.pz = g.z - box.cz; goal.zoom = Math.min(8, Math.max(goal.zoom * 1.5, 1.6));
      },
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
        let yaw = cameraMode ? 0 : Math.atan2(dx, dy);
        while (yaw - view.yaw > Math.PI) yaw -= 2 * Math.PI;   // turn the short way round
        while (yaw - view.yaw < -Math.PI) yaw += 2 * Math.PI;
        // (#386) lower than the overview (about 42°), looking at a point part way to the target, back far enough that
        // the ball sits low in the picture and the target is in it too
        const tilt = cameraMode ? 1.56 : AIM_TILT, d = fitFor(yaw, tilt);
        const dist = Math.min(7.5, Math.max(nearDist() * 0.8, 2.8, len * 0.75 + 2)), ahead = Math.min(len * 0.45, 2.4);
        fitKey = '';
        Object.assign(goal, { yaw, tilt, zoom: d / dist, px: bx + (dx / len) * ahead - box.cx, pz: -(by + (dy / len) * ahead) - box.cz });
        if (cameraLocked) Object.assign(view, goal);
        place();  // fitFor() moved the camera while measuring: put it back where the view is now
      },
    };
    const previewMarker = new T.Mesh(new T.RingGeometry(0.12, 0.17, 28),
      new T.MeshBasicMaterial({ color: 0xffdf72, side: T.DoubleSide, depthTest: false }));
    previewMarker.rotation.x = -Math.PI / 2;
    previewMarker.renderOrder = 5;
    scene.add(previewMarker);
    function draw(now, shot, point) {
      previewMarker.visible = !!point;
      if (point) previewMarker.position.set(point[0], groundH(...point) + 0.06, -point[1]);
      ensureBalls();
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
      glide(dt);
      if (box) ambient(dt, now);
      const p = S.putt;
      balls.forEach((b, i) => {
        const at = ballPos(i, now), m = b.mesh;
        const playing = (anim && anim.by === i) || queue.some((q) => q.by === i);
        const sunk = p.holed[i] && !playing;
        m.visible = (!sunk || i === p.me) && !unplayed(i);
        // (#388) out of the hole (picked up, capped, gone): a faded ghost where it lay, which nothing bumps into
        const ghost = !!p.out?.[i] && !playing;
        if (m.material.transparent !== ghost) { m.material.transparent = ghost; m.material.opacity = ghost ? 0.3 : 1; m.material.needsUpdate = true; }
        const r = p.ball * 1.3, pos = W(at[0], at[1]), z = at[2] || 0;
        pos.y = sunk ? -0.05 : z < 0 ? -0.06 + r * 0.6 + z * 1.2 : pos.y + r + z;   // flying over a jump, or sinking
        // roll: turn the ball about the axis across its path, by the distance travelled over its radius
        if (b.last) {
          const mv = pos.clone().sub(b.last), d = Math.hypot(mv.x, mv.z);
          if (d > 1e-4 && d < 0.5) m.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(-mv.z, 0, mv.x).normalize(), d / r));
        }
        b.last = pos.clone();
        m.position.copy(pos);
        if (b.sh) {   // under the ball on the ground; smaller and fainter the higher it flies
          const lift = Math.max(0, z), onGround = !sunk && z >= 0;
          b.sh.visible = m.visible && onGround;
          b.sh.position.set(pos.x, groundH(at[0], at[1]) + 0.012, pos.z);
          b.sh.scale.setScalar(r * 1.5 * (1 + lift * 0.8)); b.sh.material.opacity = Math.max(0.1, 0.55 - lift * 1.6);
        }
      });
      const clock = anim ? anim.clock + (now - anim.t0) / 1000 : now / 1000 + clockOff;
      for (const m of mills) m.hub.rotation.z = (p.millSpeed || 1.2566) * clock;
      // the flag waves, more toward its free end
      if (cupGlow) {
        const br = 0.5 + 0.5 * Math.sin(now / 420);
        cupGlow.material.opacity = 0.05 + 0.1 * br; cupGlow.scale.setScalar(0.92 + 0.14 * br);
      }
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
      const me = p.me;
      ring.visible = me != null && !(p.holed[me] && !rolling());
      if (ring.visible) {
        const at = ballPos(me, now);
        ring.position.copy(W(at[0], at[1])).setY(groundH(at[0], at[1]) + 0.006);
        // pulses on your turn; while aiming it swells and takes the power colour
        ring.scale.setScalar(shot ? 1 + 0.6 * shot.power : myTurn() ? 1 + 0.15 * Math.sin(now / 250) : 1);
        ring.material.color.setHSL(shot ? powerHue(shot.power) / 360 : 0, shot ? 0.9 : 0, shot ? 0.55 : 1);
      }
      const aiming = !!(shot && me != null);
      aimDots.forEach((m) => { m.visible = false; }); aimHead.visible = aiming;
      if (aiming) {
        aimMat.color.setHSL(powerHue(shot.power) / 360, 0.9, 0.55);
        const [bx, by] = p.balls[me], len = 0.4 + shot.power * 2.2, c = Math.cos(shot.angle), sn = Math.sin(shot.angle);
        const at = (f, lift) => { const x = bx + c * len * f, y = by + sn * len * f; return W(x, y).setY(groundH(x, y) + lift); };
        const drift = (now / 500) % 1;  // the dots creep outward, the way the ball will go
        aimDots.forEach((m, k) => {
          const f = (k + drift) / AIM_DOTS;
          if (f < 0.1 || f > 0.9) return;  // clear of the ball and the arrowhead
          m.visible = true; m.position.copy(at(f, 0.05)); m.scale.setScalar(0.06 - 0.028 * f);
        });
        aimHead.position.copy(at(0.97, 0.06)); aimHead.rotation.set(0, shot.angle, 0);
      }
      renderer.render(scene, camera);
    }
    function dispose() {
      hazardPlane.dispose();
      for (const material of hazardMaterials.values()) { material.map?.dispose(); material.dispose(); }
      previewMarker.geometry.dispose(); previewMarker.material.dispose();
      stg.dispose(); renderer.dispose(); renderer.domElement.remove();
    }
    const groundAt = (cx, cy) => { const g = toGround(cx, cy); return g ? [g.x, -g.z] : null; };   // (#395) course x, y under a screen point
    return { build, draw, resize, dispose, screenDir, nearBall, ballOnScreen, effect, burst, groundAt, view: viewApi };
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
    function draw(now, shot, point) {
      const p = S.putt;
      if (!canvas.width) resize();
      g.fillStyle = '#0c1a2b'; g.fillRect(0, 0, canvas.width, canvas.height);
      // (#392) tiles with the corners the physics has: rounded outer corners, banks curved or cut
      const cornerOf = cornerRule(p);
      for (const [x, y] of p.cells) {
        const kind = p.kinds[`${x},${y}`];
        g.fillStyle = kind ? COLORS[kind] : COLORS.fair[(x + y) % 2];
        const pts = tileOutline(x, y, TILE_CORNERS.map(([sx, sy]) => cornerOf(x, y, sx, sy)));
        g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(X(px), Y(py)) : g.moveTo(X(px), Y(py)))); g.closePath(); g.fill();
        const mark = hazardMark(kind, p);
        if (mark) {
          g.font = `bold ${k * 0.43}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = 2; g.strokeStyle = '#18232b'; g.fillStyle = '#fff4cf';
          g.strokeText(mark, X(x + 0.5), Y(y + 0.5)); g.fillText(mark, X(x + 0.5), Y(y + 0.5));
        }
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
      for (const [cx, cy, ex, ey, nx, ny, shape] of p.banks || []) {  // (#392) a curve where the physics curves, a cut where it cuts
        const qx = cx + 0.5 - 0.5 * ex - 0.5 * nx, qy = cy + 0.5 - 0.5 * ey - 0.5 * ny;
        g.beginPath();
        if (shape === 'flat') { g.moveTo(X(qx + BANK_R * nx), Y(qy + BANK_R * ny)); g.lineTo(X(qx + BANK_R * ex), Y(qy + BANK_R * ey)); }
        else {
          const ox = qx + BANK_R * (ex + nx), oy = qy + BANK_R * (ey + ny), a0 = Math.atan2(-ny, -nx);
          let da = Math.atan2(-ey, -ex) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          for (let i = 0; i <= 12; i++) { const a = a0 + (da * i) / 12, px = ox + BANK_R * Math.cos(a), py = oy + BANK_R * Math.sin(a); i ? g.lineTo(X(px), Y(py)) : g.moveTo(X(px), Y(py)); }
        }
        g.stroke();
      }
      for (const [mx, my] of p.mills || []) {  // the windmill's wall, its doorway open or shut right now
        const clock = anim ? anim.clock + (now - anim.t0) / 1000 : now / 1000 + clockOff;
        const a = ((p.millSpeed || 1.2566) * clock + Math.PI / 2) % (Math.PI / 2), shut = Math.min(a, Math.PI / 2 - a) < 0.32;
        g.fillStyle = '#f1e3c8';
        g.fillRect(X(mx), Y(my + 0.56), (0.5 - 0.17) * k, 0.12 * k); g.fillRect(X(mx + 0.67), Y(my + 0.56), (0.5 - 0.17) * k, 0.12 * k);
        if (shut) { g.fillStyle = '#ffffff'; g.fillRect(X(mx + 0.33), Y(my + 0.56), 0.34 * k, 0.12 * k); }
      }
      {   // the cup (#216): a breathing ring, a pale apron, a dark well and a bright rim
        const cx = X(p.cup[0]), cy = Y(p.cup[1]), cr = p.cupR * k, br = 0.5 + 0.5 * Math.sin(now / 420);
        g.strokeStyle = `rgba(255,226,122,${0.18 + 0.3 * br})`; g.lineWidth = Math.max(2, cr * 0.25);
        g.beginPath(); g.arc(cx, cy, cr * (2 + 0.2 * br), 0, 7); g.stroke();
        g.fillStyle = 'rgba(207,232,168,0.3)'; g.beginPath(); g.arc(cx, cy, cr * 1.7, 0, 7); g.fill();
        const gr = g.createRadialGradient(cx, cy, 1, cx, cy, cr);
        gr.addColorStop(0, '#000'); gr.addColorStop(0.7, '#0b0b0e'); gr.addColorStop(1, '#2b2d33');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, cr, 0, 7); g.fill();
        g.strokeStyle = '#e6e9ee'; g.lineWidth = Math.max(1.5, cr * 0.12); g.beginPath(); g.arc(cx, cy, cr * 1.03, 0, 7); g.stroke();
      }
      p.seats.forEach((_, i) => {
        if (unplayed(i)) return;
        // (#391) as in 3D: a ball that has sunk is gone once its putt has finished playing, so the cup stays clear;
        // a ball out of the hole without sinking (#388) is a faded ghost
        const playing = (anim && anim.by === i) || queue.some((q) => q.by === i);
        if (p.holed[i] && !playing) return;
        const ghost = !!p.out?.[i] && !playing;
        if (ghost) g.globalAlpha = 0.3;
        const at = ballPos(i, now), bx = X(at[0]), by = Y(at[1]), br = Math.max(4, p.ball * k * 1.3);
        g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(bx + br * 0.25, by + br * 0.4, br * 1.05, br * 0.8, 0, 0, 7); g.fill();
        const bg = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
        bg.addColorStop(0, '#fff'); bg.addColorStop(0.35, colorOf(i)); bg.addColorStop(1, colorOf(i));
        g.fillStyle = colorOf(i); g.strokeStyle = i === p.me ? '#fff' : '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); g.stroke();
        g.fillStyle = bg; g.globalAlpha = ghost ? 0.2 : 0.65; g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); g.globalAlpha = ghost ? 0.3 : 1;
        g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(bx - br * 0.35, by - br * 0.38, br * 0.2, 0, 7); g.fill();
        g.globalAlpha = 1;
      });
      if (point) {
        g.strokeStyle = '#ffdf72'; g.lineWidth = 3;
        g.beginPath(); g.arc(X(point[0]), Y(point[1]), k * 0.15, 0, 2 * Math.PI); g.stroke();
      }
      if (shot && p.me != null) {  // a dotted guide with an arrowhead, in the power colour (#82)
        const [bx, by] = p.balls[p.me], len = 0.4 + shot.power * 2.2;
        const x0 = X(bx), y0 = Y(by), x1 = X(bx + Math.cos(shot.angle) * len), y1 = Y(by + Math.sin(shot.angle) * len);
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, head = Math.max(8, 0.35 * k);
        g.save();
        g.strokeStyle = g.fillStyle = powerCss(shot.power); g.shadowColor = powerCss(shot.power, 0.7); g.shadowBlur = 8;
        g.lineWidth = Math.max(3, 0.08 * k); g.lineCap = 'round'; g.setLineDash([0.1, g.lineWidth * 2.2]); g.lineDashOffset = -now / 40;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - ux * head, y1 - uy * head); g.stroke();
        g.setLineDash([]); g.beginPath(); g.moveTo(x1, y1);
        g.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
        g.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55); g.closePath(); g.fill();
        g.restore();
      }
    }
    resize();
    const groundAt = (cx, cy) => {   // (#395) course x, y under a screen point
      const r = canvas.getBoundingClientRect(), px = (cx - r.left) * (canvas.width / r.width), py = (cy - r.top) * (canvas.height / r.height);
      return [px / k, (canvas.height - py) / k];
    };
    return { build: resize, draw, resize, groundAt, screenDir: (a, sx, sy) => [sx, -sy] };
  }

  const turnText = (s) => (s.phase === 'playing' ? `⛳ Hole ${s.putt.hole} of ${s.putt.holes}` : null);

  // for the browser tests: ballOnScreen (where to start a putt; null in the flat view, where any drag putts), camera
  return { mount, render, unmount, turnText, focus: true, ballOnScreen: () => gl?.ballOnScreen() ?? null, camera: () => gl?.view ?? null };
})();
