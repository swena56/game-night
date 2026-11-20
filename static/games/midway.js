// Midway Night: a carnival booth in 3D (three.js) or flat. Everyone throws at once in their own copy of the booth.
// Swipe up anywhere on the booth: sideways aims, the length sets how far (or high) it goes; or nudge with ◀ ▶ ▲ ▼
// (arrow keys) and tap 🎯 Throw (Space). The server says where each throw lands; the page plays it out.
UI.midway = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null, keyFn = null;
  let anims = [], seen = new Set(), watchId = null, watchKey = '', lastV = null, goAt = 0, endAt = 0;
  let aim = 0, power = 0.5, swipe = null, lastThrow = 0, popT = 0, lastDraw = 0, lastTick = 0, fallAt = [];
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ICON = { skee: '🎳', rings: '⭕', cans: '🥫' };
  const nameOf = (pid) => ctx?.player(pid)?.name ?? '?';
  const colorOf = (pid) => ctx?.player(pid)?.color ?? '#ccc';
  const watched = () => V?.booths?.[watchId];
  const left = () => V?.me ? V.booths[V.me]?.left ?? 0 : 0;
  const canThrow = () => S?.phase === 'playing' && V?.stage === 'play' && V.me && left() > 0 && !S.paused
    && performance.now() - lastThrow > (V.gap ?? 0.8) * 1000 + 80;

  function mount(main, side) {
    gl = null; flat = null; anims = []; seen = new Set(); watchId = null; watchKey = ''; lastV = null; goAt = endAt = 0;
    aim = 0; power = 0.5; swipe = null; lastThrow = 0; fallAt = [];
    main.innerHTML = `<div class="mw"><div class="mw-stage" id="mwStage">
        <div class="mw-hud"><span id="mwBooth"></span><span id="mwClock" class="mw-clock"></span></div>
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
      <p id="mwHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🎟 Tickets</h3><div id="mwRace" class="mw-race"></div><div id="mwFeed" class="mw-feed"></div></div>';
    $('mwCtl').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'mwGo') return fire();
      if (b.dataset.a) aim = clamp(aim + 0.08 * b.dataset.a, -1, 1);
      if (b.dataset.p) power = clamp(power + 0.04 * b.dataset.p, 0, 1);
      meter();
    });
    $('mwRace').addEventListener('click', (e) => {
      const row = e.target.closest('[data-pid]');
      if (row && (!V?.me || left() === 0 || V.stage !== 'play')) { watchId = row.dataset.pid; resync(); render(S, ctx); }
    });
    const stage = $('mwStage');
    stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (!canThrow() || e.target.closest('button, .mw-done')) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, a: aim, p: power, t: performance.now() };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const r = stage.getBoundingClientRect(), dx = e.clientX - swipe.x, dy = swipe.y - e.clientY;
      aim = clamp(dx / Math.max(80, r.width * 0.38), -1, 1);
      power = clamp(dy / Math.max(120, r.height * 0.62), 0, 1);
      swipe.moved = Math.max(swipe.moved || 0, dy);
      meter();
    });
    stage.addEventListener('pointerup', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const ok = (swipe.moved || 0) > 24;
      if (!ok) { aim = swipe.a; power = swipe.p; }
      swipe = null; meter();
      if (ok) fire();
    });
    stage.addEventListener('pointercancel', () => { if (swipe) { aim = swipe.a; power = swipe.p; } swipe = null; });
    keyFn = (e) => {
      if (!V || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') aim = clamp(aim + (k === 'ArrowLeft' ? -0.06 : 0.06), -1, 1);
      else if (k === 'ArrowUp' || k === 'ArrowDown') power = clamp(power + (k === 'ArrowDown' ? -0.03 : 0.03), 0, 1);
      else if ((k === ' ' || k === 'Enter') && !e.target.closest?.('button')) fire();
      else return;
      e.preventDefault(); meter();
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
    ctx.quiet(ctx.act('throw', { aim: +aim.toFixed(3), power: +power.toFixed(3) }));
    controls();
  }

  // ---------- state
  function resync() {
    // a new booth (or a different one to watch): what's already happened isn't replayed
    const b = watched();
    seen = new Set((b?.shots || []).map((s) => s.id));
    anims = [];
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
    if (key !== watchKey) { watchKey = key; resync(); aim = 0; power = 0.5; }
    const b = watched();
    let stagger = 0;
    for (const sh of b?.shots || []) {
      if (seen.has(sh.id)) continue;
      seen.add(sh.id);
      anims.push({ shot: sh, t0: now + stagger, hit: false });
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
    const p = $('mwPow'); if (p) p.style.height = `${Math.round(power * 100)}%`;
  }

  function controls() {
    if (!V) return;
    const go = canThrow();
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
          : { skee: 'Swipe up to roll: sideways aims, a longer swipe rolls further up the board. The corner cups pay 100.',
              rings: 'Swipe up to toss: a longer swipe reaches the back rows. Red bottles pay 80.',
              cans: 'Swipe up to throw: a longer swipe throws higher. Hit the bottom row and the cans above it fall too.' }[V.kind];
    if ($('mwHint').textContent !== t) $('mwHint').textContent = t;
  }

  function pop(sh) {
    const el = $('mwPop'); if (!el) return;
    const words = sh.k === 'skee' ? (sh.where === 'short' ? 'Short!' : sh.where === 'cup' ? (sh.rattle ? '🏆 RATTLED IN!' : '🏆 CUP!') : (sh.rattle ? 'Rattled!' : ''))
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
    const fly = [];
    for (const a of anims) {
      const u = Math.max(0, (now - a.t0) / 1000 / a.shot.t);
      fly.push({ shot: a.shot, u: Math.min(1, u), landU: HIT[a.shot.k] });
    }
    const pending = new Set(anims.filter((a) => !a.hit).map((a) => a.shot.id));
    const preview = canThrow() || swipe ? spot(aim, power) : null;
    return {
      kind: V.kind, geo: V.geo, layout: V.layout, jackLive: !V.jackBy && !(V.kind === 'cans' && b?.stacks),
      shots: (b?.shots || []).filter((s) => !pending.has(s.id)), fly, fallAt, now, preview, swiping: !!swipe, left: b?.left ?? 0,
      pts: (b?.pts ?? 0) - (b?.shots || []).filter((s) => pending.has(s.id)).reduce((a, s) => a + s.pts, 0),
      color: colorOf(watchId),
    };
  }
  // the share of a throw's play-out at which it lands
  const HIT = { skee: 0.85, rings: 0.75, cans: 0.55 };

  function loop(now) {
    if (!$('mwStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    for (const a of anims) {
      if (!a.hit && now - a.t0 >= a.shot.t * HIT[a.shot.k] * 1000) { a.hit = true; land(a, now); }
      if (a.restack && now >= a.restack) { a.restack = 0; fallAt = fallAt.map(() => null); }
    }
    anims = anims.filter((a) => now - a.t0 < a.shot.t * 1000 + 900 || a.restack);
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
    if ($('mwGo').disabled === canThrow()) controls();
    window.Snd?.bed('mw.crowd', crowdBed).set(S.phase === 'playing' && !S.paused ? 1 : 0);
    const sc = scene(now);
    const idle = !anims.length && !swipe && !(gl?.moving?.());
    if (idle && now - lastDraw < 66) return;
    lastDraw = now;
    (gl || flat)?.draw(now, sc, idle);
  }

  // ---------- three.js: you stand at z = 0 looking down -z at the booth; one scene, three sets of props
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
    function marquee(text, w, h) {
      const t = tex(512, Math.round(512 * h / w), (g, W, H) => {
        g.fillStyle = '#5a0f1e'; g.fillRect(0, 0, W, H);
        g.strokeStyle = '#ffd23f'; g.lineWidth = 6; g.strokeRect(10, 10, W - 20, H - 20);
        const n = 22; g.fillStyle = '#fff2b0';
        for (let k = 0; k < n; k++) { const x = 10 + (W - 20) * k / (n - 1); for (const yy of [10, H - 10]) { g.beginPath(); g.arc(x, yy, 5, 0, 7); g.fill(); } }
        g.font = `800 ${Math.round(H * 0.5)}px "Baloo 2", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = '#ff9a2a'; g.shadowBlur = 18; g.fillStyle = '#ffe066'; g.fillText(text, W / 2, H / 2 + 3);
      });
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t })); return m;
    }

    // 🎳 Skee Roll: an inclined lane up to a tilted ring board. Board coordinates (bx, by) are local x, y of `board`.
    const skee = new T.Group(); scene3.add(skee);
    const lane = new T.Mesh(new T.BoxGeometry(0.75, 0.04, 3.1), std(0x2c6e9e, { roughness: 0.4 }));
    lane.position.set(0, 1.0, -1.7); lane.rotation.x = 0.1; lane.receiveShadow = true; skee.add(lane);
    for (const sx of [-0.4, 0.4]) { const rail = new T.Mesh(new T.BoxGeometry(0.05, 0.12, 3.1), std(0xffd23f, { roughness: 0.4, metalness: 0.3 })); rail.position.set(sx, 1.05, -1.7); rail.rotation.x = 0.1; skee.add(rail); }
    // #149 the cabinet: varnished wooden sides with a lit trim strip, the hump the ball jumps off at the top of the lane,
    // side nets up to the board, a ball-return trough holding the balls you have left, and a glowing score panel
    const woodTex = tex(256, 64, (g, w, h) => { g.fillStyle = '#8a4f24'; g.fillRect(0, 0, w, h); for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(${60 + Math.random() * 40},${30 + Math.random() * 20},10,.35)`; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + Math.random() * 8 - 4, 2 * w / 3, y + Math.random() * 8 - 4, w, y); g.stroke(); } });
    const woodMat = std(0xffffff, { map: woodTex, roughness: 0.35 });
    const trimMat = new T.MeshBasicMaterial({ color: 0xff5ab4 });
    for (const sx of [-1, 1]) {
      const side = new T.Mesh(new T.BoxGeometry(0.08, 0.5, 3.3), woodMat); side.position.set(sx * 0.47, 0.88, -1.7); side.rotation.x = 0.1; side.castShadow = true; skee.add(side);
      const trim = new T.Mesh(new T.BoxGeometry(0.02, 0.025, 3.3), trimMat); trim.position.set(sx * 0.51, 1.1, -1.72); trim.rotation.x = 0.1; skee.add(trim);
      const net = new T.Mesh(new T.PlaneGeometry(0.9, 0.9), new T.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.25, side: T.DoubleSide, depthWrite: false }));
      net.rotation.y = Math.PI / 2; net.position.set(sx * 0.62, 1.55, -3.55); skee.add(net);
    }
    const cabFront = new T.Mesh(new T.BoxGeometry(1.0, 0.6, 0.08), woodMat); cabFront.position.set(0, 0.62, -0.08); skee.add(cabFront);
    const hump = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.72, 20), std(0x2c6e9e, { roughness: 0.35 }));   // a roll across the lane, half sunk
    hump.rotation.z = Math.PI / 2; hump.position.set(0, 1.15, -3.14); skee.add(hump);
    const trough = new T.Mesh(new T.BoxGeometry(0.16, 0.06, 0.9), woodMat); trough.position.set(0.62, 0.9, -0.45); skee.add(trough);
    const trayBalls = Array.from({ length: 9 }, (_, k) => { const m = new T.Mesh(new T.SphereGeometry(0.045, 14, 10), std(0xf4efe4, { roughness: 0.4 })); m.position.set(0.62, 0.97, -0.1 - k * 0.095); m.castShadow = true; skee.add(m); return m; });
    let panelTex = null, panelVal = null;
    const panel = new T.Mesh(new T.PlaneGeometry(0.62, 0.2), new T.MeshBasicMaterial({ color: 0xffffff }));
    panel.position.set(0, 2.08, -4.25); skee.add(panel);
    function paintPanel(pts) {
      if (pts === panelVal) return;
      panelVal = pts; panelTex?.dispose();
      panelTex = tex(256, 80, (g, w, h) => {
        g.fillStyle = '#0a0612'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ff5ab4'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
        g.font = '700 50px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = '#ff3a3a'; g.shadowBlur = 14; g.fillStyle = '#ff6a5a'; g.fillText(String(pts).padStart(4, '0'), w / 2, h / 2 + 2);
      });
      panel.material.map = panelTex; panel.material.needsUpdate = true;
    }
    const ballTex = tex(64, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, h * 0.42, w, h * 0.16); g.fillRect(w * 0.45, 0, w * 0.1, h); });
    const board = new T.Group(); board.position.set(0, 1.18, -3.3); board.rotation.x = -0.927; skee.add(board);
    let boardTex = null, boardFace = null;
    function paintBoard(geo) {
      const W = 640, H = Math.round(W * 1.2 / 1.3);
      boardTex?.dispose();
      boardTex = tex(W, H, (g) => {
        const X = (bx) => (bx + 0.65) / 1.3 * W, Y = (by) => H - by / 1.2 * H, k = W / 1.3;
        g.fillStyle = '#16365c'; g.fillRect(0, 0, W, H);
        const cols = ['#2a6fb5', '#e8483f', '#ffd23f', '#3ddc97', '#f4efe4'];
        [...geo.rings].reverse().forEach(([r, pts], n) => {
          g.beginPath(); g.arc(X(0), Y(geo.cy), r * k, 0, 7); g.fillStyle = cols[n % cols.length]; g.fill();
          g.lineWidth = 3; g.strokeStyle = '#0b1830'; g.stroke();
        });
        g.font = `800 ${Math.round(k * 0.05)}px "Baloo 2", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        // each ring's pocket: a dark hole at the top of its band, with the score on a lit plate beside it
        geo.rings.forEach(([r, pts], n) => {
          const r0 = n ? geo.rings[n - 1][0] : 0, y = n ? Y(geo.cy) - (r0 + r) / 2 * k : Y(geo.cy), hr = n ? (r - r0) * k * 0.36 : r * k * 0.55;
          const hole = g.createRadialGradient(X(0), y - hr * 0.2, 0, X(0), y, hr); hole.addColorStop(0, '#000'); hole.addColorStop(0.8, '#05080f'); hole.addColorStop(1, '#2a3550');
          g.fillStyle = hole; g.beginPath(); g.arc(X(0), y, hr, 0, 7); g.fill();
          if (n) {
            const pw = k * 0.075, ph = k * 0.05, px = X(0) + hr + pw * 0.75;
            g.fillStyle = '#fff6d0'; g.fillRect(px - pw / 2, y - ph / 2, pw, ph); g.strokeStyle = '#0b1830'; g.lineWidth = 2; g.strokeRect(px - pw / 2, y - ph / 2, pw, ph);
            g.fillStyle = '#0b1830'; g.fillText(String(pts), px, y + 1);
          } else { g.fillStyle = '#ffd23f'; g.fillText(String(pts), X(0), y + hr + k * 0.03); }
        });
        for (const [cx, cy] of geo.cups) { g.beginPath(); g.arc(X(cx), Y(cy), geo.cupR * k, 0, 7); g.fillStyle = '#05080f'; g.fill(); g.fillStyle = '#ffd23f'; g.fillText('100', X(cx), Y(cy) + geo.cupR * k * 1.9); }
      });
      if (!boardFace) {
        boardFace = new T.Mesh(new T.PlaneGeometry(1.3, 1.2), std(0xffffff, { roughness: 0.45 }));
        boardFace.position.set(0, 0.6, 0); boardFace.receiveShadow = true; board.add(boardFace);
        const rimMat = std(0xe8e0d0, { roughness: 0.3, metalness: 0.2 });
        for (const [r] of geo.rings) { const rim = new T.Mesh(new T.TorusGeometry(r, 0.012, 6, 48), rimMat); rim.position.set(0, geo.cy, 0.012); board.add(rim); }
        for (const [cx, cy] of geo.cups) { const rim = new T.Mesh(new T.TorusGeometry(geo.cupR, 0.012, 6, 24), std(0xffd23f, { metalness: 0.6, roughness: 0.3 })); rim.position.set(cx, cy, 0.012); board.add(rim); }
        const net = new T.Mesh(new T.PlaneGeometry(1.3, 0.6), new T.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.35, side: T.DoubleSide }));
        net.position.set(0, 1.4, 0.2); net.rotation.x = 0.6; board.add(net);
      }
      boardFace.material.map = boardTex; boardFace.material.needsUpdate = true;
    }
    const goldMat = std(0xffc83a, { metalness: 0.75, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const skeeJack = new T.Mesh(new T.TorusGeometry(0.05, 0.014, 8, 24), goldMat); skeeJack.position.z = 0.016; board.add(skeeJack);
    const skeeBall = new T.Mesh(new T.SphereGeometry(0.045, 16, 12), std(0xffffff, { roughness: 0.35, map: ballTex })); skeeBall.castShadow = true;
    const skeeBalls = [];
    const skeeSign = marquee('SKEE ROLL', 1.3, 0.3); skeeSign.position.set(0, 2.38, -4.3); skee.add(skeeSign);
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

    // the preview: dots along the arc and a ring where it would land
    const dotGeo = new T.SphereGeometry(0.012, 6, 4), dotMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false });
    const dots = Array.from({ length: 14 }, () => { const m = new T.Mesh(dotGeo, dotMat); m.renderOrder = 9; scene3.add(m); return m; });
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
      if (sc.kind === 'cans') {
        canGeo ||= new T.CylinderGeometry(sc.geo.w / 2 - 0.004, sc.geo.w / 2 - 0.004, sc.geo.h - 0.004, low ? 12 : 20);
        while (canMeshes.length < sc.geo.cans.length) { const m = new T.Mesh(canGeo, canMat); m.castShadow = true; cansG.add(m); canMeshes.push(m); }
      }
    }

    const cam = { pos: new T.Vector3(0, 1.7, 1.1), look: new T.Vector3(0, 1.1, -3), init: false };
    const VIEW = { skee: { pos: [0, 1.7, -0.5], look: [0, 1.4, -3.6], w: 0.72, d: 3.2 }, rings: { pos: [0, 1.9, 0.1], look: [0, 0.78, -2.05], w: 0.8, d: 2.6 },
      cans: { pos: [0, 1.4, -0.2], look: [0, 1.18, -2.6], w: 0.55, d: 2.4 } };
    let lastT = 0, moving = 0;
    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();

    const arc = (a, b, h, u) => new T.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + h * 4 * u * (1 - u), a.z + (b.z - a.z) * u);
    // where a throw is at u (0..1 of its flight to the landing), for each booth
    const HAND = { skee: new T.Vector3(0, 1.0, -0.1), rings: new T.Vector3(0.1, 1.35, 0.25), cans: new T.Vector3(0.15, 1.35, 0.5) };
    function skeePath(sh, u, landU) {
      const lip = new T.Vector3(sh.x * 0.7, 1.2, -3.15);
      if (sh.where === 'short') {
        const top = Math.max(0.15, (sh.y + 0.08) / 1.1) * 0.95, s = u < 0.6 ? u / 0.6 * top : top * (1 - (u - 0.6) / 0.4);
        return HAND.skee.clone().lerp(lip, s).setY(1.02 + 0.18 * s);
      }
      if (u < 0.55) { const s = 1 - (1 - u / 0.55) ** 1.6; return HAND.skee.clone().lerp(lip, s).setY(1.02 + 0.18 * s); }
      if (u < landU) return arc(lip, boardPt(sh.x, Math.max(0.02, sh.y)), 0.22, (u - 0.55) / (landU - 0.55));
      const w = Math.min(1, (u - landU) / (1 - landU));
      if (sh.rattle) {   // 🎳 it rattles along the wire, then drops on one side (or into the cup)
        const k = Math.min(1, w / 0.45), hop = Math.sin(Math.min(1, w / 0.45) * Math.PI * 3) * 0.012 * (1 - k);
        return boardPt(sh.x + (sh.ex - sh.x) * k + hop, Math.max(0.02, sh.y + (sh.ey - sh.y) * k), 0.05 - 0.12 * Math.max(0, (w - 0.45) / 0.55));
      }
      return boardPt(sh.x, Math.max(0.02, sh.y), 0.05 - 0.12 * w);
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
      skee.visible = sc.kind === 'skee'; rings.visible = sc.kind === 'rings'; cansG.visible = sc.kind === 'cans';
      const pool = (arr, proto, parent) => { while (arr.length < sc.fly.length) { const m = proto.clone(); m.material = proto.material.clone(); parent.add(m); arr.push(m); } arr.forEach((m) => { m.visible = false; }); };
      if (sc.kind === 'skee') {
        skeeJack.visible = sc.jackLive; skeeJack.position.set(sc.layout.jack[0], sc.layout.jack[1], 0.016);
        pool(skeeBalls, skeeBall, scene3);
        sc.fly.forEach((f, k) => { const m = skeeBalls[k]; m.visible = f.u > 0 && f.u < 1; m.position.copy(skeePath(f.shot, f.u, f.landU)); m.rotation.x = -f.u * 40; m.material.color.set(sc.color); trail(k, (u) => skeePath(f.shot, u, f.landU), f, sc.color); });
        trayBalls.forEach((m, k) => { m.visible = k < (sc.left ?? 0); });
        paintPanel(sc.pts ?? 0);
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
      // just a short arrow of dots up the lane, and the power meter is the only guide to how far
      mark.visible = false; dots.forEach((d) => { d.visible = !!pv; });
      if (pv) {
        let end, h, start = HAND[sc.kind], from = 0.14, upto = 0.32;
        if (sc.kind === 'skee') { end = new T.Vector3(pv.x * 0.7, 1.2, -3.15); h = 0; from = 0.2; upto = 0.4; }
        else if (sc.kind === 'rings') { end = tablePt(pv.x, pv.y, TY + 0.3); h = 0.5; }
        else { end = new T.Vector3(pv.x, SY + pv.y, SZ + 0.12); h = 0.12; }
        dotMat.opacity = sc.swiping ? 0.9 : 0.5;
        dots.forEach((d, k) => { const p = arc(start, end, h, from + upto * (k + 1) / dots.length); if (sc.kind === 'skee') p.y = 1.0 + 0.07 + 0.2 * (-p.z - 0.1) / 3.05; d.position.copy(p); });
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
        else at = new T.Vector3(sh.x, SY + sh.y, SZ + 0.1);
        if (sh.jack || sh.sweep || (sh.k === 'skee' && sh.where === 'cup')) { confetti(at, sh.jack ? 60 : 36); GL3.shake(camera, 0.12); }
        else if (sh.pts >= (sh.k === 'skee' ? 30 : 1)) confetti(at, sh.hot ? 22 : 12);
        else if (sh.k === 'cans' && sh.fell.length >= 3) GL3.shake(camera, 0.08);
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        boardTex?.dispose(); panelTex?.dispose(); renderer.dispose(); canvas.remove();
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
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#20123a'); bg.addColorStop(1, '#3a1f22'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      // world box: x in [-0.7, 0.7], y in [-0.1, 1.2]; fitted with room for the HUD at the top and the hand at the bottom
      const k = Math.min(w / 1.5, (h - 90) / 1.35), cx = w / 2, by = h - 34;
      const X = (x) => cx + x * k, Y = (y) => by - (y + 0.1) * k;
      g.lineWidth = 2;
      if (sc.kind === 'skee') {
        g.fillStyle = '#16365c'; g.fillRect(X(-0.65), Y(1.2), 1.3 * k, 1.2 * k);
        const cols = ['#2a6fb5', '#e8483f', '#ffd23f', '#3ddc97', '#f4efe4'];
        [...sc.geo.rings].reverse().forEach(([r], n) => { g.beginPath(); g.arc(X(0), Y(sc.geo.cy), r * k, 0, 7); g.fillStyle = cols[n]; g.fill(); g.strokeStyle = '#0b1830'; g.stroke(); });
        for (const [x, y] of sc.geo.cups) { g.beginPath(); g.arc(X(x), Y(y), sc.geo.cupR * k, 0, 7); g.fillStyle = '#05080f'; g.fill(); g.strokeStyle = '#ffd23f'; g.stroke(); }
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
