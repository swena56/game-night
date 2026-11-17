// Domino Run: a shared domino table in 3D (three.js) or flat from above. Take turns standing up three dominoes:
// tap a square (tap it again, or ⟳, to turn the domino 45°), then ✔ Place. The squares each run reaches light up in
// its colour. After the last build turn every starter is pushed and the server's topple plays out here.
UI.domino = (() => {
  let S, ctx, V, gl = null, flat = null, raf = 0, ro = null, keyFn = null;
  let sel = null, axis = 0, kind = 'domino', toppleAt = 0, toppleKey = '', played = 0, lastDraw = 0, rung = new Set(), busy = false;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const nameOf = (i) => ctx?.player(V?.seats[i])?.name ?? '?';
  const colorOf = (i) => ctx?.player(V?.seats[i])?.color ?? '#ccc';
  const myTurn = () => S?.phase === 'playing' && ctx?.myTurn && V?.stage === 'build' && V.me != null && V.cur === V.me;
  const ICON = { bell: '🔔', gate: '⛩', tower: '🏯' };

  function mount(main, side) {
    gl = null; flat = null; sel = null; axis = 0; kind = 'domino'; toppleAt = 0; toppleKey = ''; played = 0; rung = new Set(); busy = false;
    main.innerHTML = `<div class="dm"><div class="dm-stage" id="dmStage">
        <div class="dm-hud"><span id="dmTable"></span><span id="dmWho"></span></div>
        <div class="dm-sub"><span id="dmReach"></span></div>
        <div class="dm-pop" id="dmPop" hidden></div>
        <div class="dm-tip" id="dmTip" hidden></div>
        <div class="dm-done" id="dmDone" hidden><h3 id="dmDoneTitle"></h3><div id="dmStand"></div></div>
      </div>
      <div class="dm-ctl" id="dmCtl">
        <div class="dm-kinds" id="dmKinds"><button data-k="domino">🁫 Domino</button><button data-k="split" title="Once a game: forks the run both ways">✂ Split</button><button data-k="block" title="Once a game: nothing gets past">🚫 Block</button></div>
        <div class="dm-acts"><button id="dmRot" aria-label="Turn 45°">⟳ Turn</button><span id="dmLeft" class="dm-left"></span><button class="dm-go" id="dmGo">✔ Place</button></div>
      </div>
      <p id="dmHint" class="hint"></p></div>`;
    side.innerHTML = '<div class="panel"><h3>🁫 Points</h3><div id="dmRace" class="dm-race"></div></div>';
    $('dmKinds').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; kind = b.dataset.k; controls(); });
    $('dmRot').addEventListener('click', () => { axis = (axis + 1) % 4; controls(); });
    $('dmGo').addEventListener('click', place);
    const stage = $('dmStage');
    stage.style.touchAction = 'manipulation';
    stage.addEventListener('click', (e) => {
      if (!myTurn() || e.target.closest('button, .dm-done')) return;
      const c = (gl || flat)?.pick?.(e.clientX, e.clientY); if (!c) return;
      const [x, y] = c;
      if (x < 0 || y < 0 || x >= V.size || y >= V.size || !freeCell(x, y)) return;
      if (sel && sel[0] === x && sel[1] === y) axis = (axis + 1) % 4;
      else { sel = [x, y]; axis = bestAxis(x, y); }
      ctx.sfx?.('tick');
      controls();
    });
    keyFn = (e) => {
      if (!V || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || !myTurn()) return;
      const k = e.key;
      if (k === 'r' || k === 'R') axis = (axis + 1) % 4;
      else if (k.startsWith('Arrow')) {
        const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
        const [x, y] = sel || [Math.floor(V.size / 2), Math.floor(V.size / 2)];
        sel = [clamp(x + dx, 0, V.size - 1), clamp(y + dy, 0, V.size - 1)];
      } else if ((k === 'Enter' || k === ' ') && !e.target.closest?.('button')) place();
      else return;
      e.preventDefault(); controls();
    };
    window.addEventListener('keydown', keyFn);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null;
    ro?.observe(stage);
    GL3.load().then(() => { if (stage.isConnected && !gl) GL3.revive(stage, { build: () => (gl = make3d(stage)), flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }); })
      .catch(() => { if (stage.isConnected && !gl && !flat) flat = make2d(stage); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); gl?.dispose(); gl = null; flat = null;
    if (keyFn) window.removeEventListener('keydown', keyFn); keyFn = null;
  }

  // ---------- sound: wood on wood in a quiet room
  const AT = { room: 'room', send: 0.2 };
  const snd = (fn, pan = 0, vol = 1) => window.Snd?.play((t, K) => fn(t, K, K.at({ ...AT, pan, vol })));
  const SND = {
    set: () => snd((t, K, d) => { K.mode(d, t, K.R(900, 1100), 0.1, 0.04); K.burst(d, t, { type: 'bandpass', f: 2600, q: 2, vol: 0.08, tau: 0.015 }); }),
    clack: (pan, n) => snd((t, K, d) => { K.mode(d, t, 1200 + (n % 7) * 60 + K.R(-40, 40), 0.07, 0.03); K.burst(d, t, { type: 'bandpass', f: 3000, q: 2.5, vol: 0.05, tau: 0.01 }); }, pan, 0.8),
    bell: (pan) => snd((t, K, d) => { K.mode(d, t, 1318, 0.12, 0.9); K.mode(d, t, 2637, 0.05, 0.5); K.mode(d, t, 3951, 0.02, 0.3); }, pan),
    gate: (pan) => snd((t, K, d) => { K.sweep(d, t, { f0: 300, f1: 220, dur: 0.35, vol: 0.06, type: 'triangle', attack: 0.02 }); K.mode(d, t + 0.3, 180, 0.12, 0.06); }, pan),
    tower: () => snd((t, K, d) => { for (let k = 0; k < 14; k++) { const s = t + k * 0.05 + K.R(0, 0.05); K.mode(d, s, K.R(600, 1400), 0.08, 0.05); K.burst(d, s, { type: 'bandpass', f: K.R(2000, 3500), q: 2, vol: 0.05, tau: 0.02 }); } K.mode(d, t, 90, 0.25, 0.2); }),
  };

  // ---------- acting
  function freeCell(x, y) {
    return !V.pieces.some((p) => p[0] === x && p[1] === y) && !V.targets.some((p) => p[0] === x && p[1] === y) && !V.starters.some((p) => p[0] === x && p[1] === y);
  }
  // a fresh square starts at the angle that carries on whichever run pushes into it
  function bestAxis(x, y) {
    for (const [ex, ey, d] of pushes()) if (ex === x && ey === y) return d % 4;
    return axis;
  }
  function pushes() {
    // squares the current runs push into (from the server's reach: last fallen cells and their fall directions aren't
    // sent, so work them out from the starters and pieces the same way the server does)
    const out = [], fallen = sim().falls;
    for (const [k, f] of fallen) {
      const [x, y] = k.split(',').map(Number), pc = pieceAt(x, y);
      for (const p of pc?.[3] === 'split' ? [(f.d + 7) % 8, (f.d + 1) % 8] : [f.d]) out.push([x + DIRS[p][0], y + DIRS[p][1], p]);
    }
    return out;
  }
  // #152: the free squares that carry MY run on: where my run's last dominoes push (through bells and lined-up gates)
  function myTaps() {
    if (V.me == null) return [];
    const mine = new Set((V.reach[String(V.me)]?.cells || []).map(([x, y]) => `${x},${y}`));
    const out = [], seen = new Set(), fallen = sim().falls;
    for (const [k, f] of fallen) {
      if (!mine.has(k)) continue;
      const [x, y] = k.split(',').map(Number), pc = pieceAt(x, y);
      for (const p of pc?.[3] === 'split' ? [(f.d + 7) % 8, (f.d + 1) % 8] : [f.d]) {
        let cx = x, cy = y;
        for (let n = 0; n < V.size; n++) {
          cx += DIRS[p][0]; cy += DIRS[p][1];
          if (cx < 0 || cy < 0 || cx >= V.size || cy >= V.size) break;
          const tg = targetAt(cx, cy);
          if (tg) { if (tg[2] === 'tower' || (tg[2] === 'gate' && p % 4 !== tg[3])) break; continue; }
          const ck = `${cx},${cy}`;
          if (freeCell(cx, cy) && !seen.has(ck)) { seen.add(ck); out.push([cx, cy, p]); }
          break;
        }
      }
    }
    return out;
  }
  const pieceAt = (x, y) => V.pieces.find((p) => p[0] === x && p[1] === y);
  const targetAt = (x, y) => V.targets.find((p) => p[0] === x && p[1] === y);
  function fallDir(ax, push) {
    let best = null, bd = 9;
    for (const d of [ax, ax + 4]) { const diff = Math.min((d - push + 8) % 8, (push - d + 8) % 8); if (diff <= 1 && diff < bd) { best = d; bd = diff; } }
    return best;
  }
  // the server's topple, for directions only (the server's preview says who owns what)
  let simKey = '', simRes = null;
  function sim() {
    const key = JSON.stringify([V.pieces, V.table]);
    if (key === simKey) return simRes;
    simKey = key;
    const falls = new Map();
    let front = V.starters.map(([x, y, d]) => [x, y, d]);
    while (front.length) {
      const nxt = [];
      for (const [x, y, d] of front) {
        const k = `${x},${y}`; if (falls.has(k)) continue;
        falls.set(k, { d });
        const pc = pieceAt(x, y);
        for (const p of pc?.[3] === 'split' ? [(d + 7) % 8, (d + 1) % 8] : [d]) {
          let cx = x, cy = y;
          for (let n = 0; n < V.size; n++) {
            cx += DIRS[p][0]; cy += DIRS[p][1];
            if (cx < 0 || cy < 0 || cx >= V.size || cy >= V.size) break;
            const tg = targetAt(cx, cy);
            if (tg) { if (tg[2] === 'tower' || (tg[2] === 'gate' && p % 4 !== tg[3])) break; continue; }
            const q = pieceAt(cx, cy);
            if (!q || q[3] === 'block' || falls.has(`${cx},${cy}`)) break;
            const nd = fallDir(q[2], p); if (nd != null) nxt.push([cx, cy, nd]);
            break;
          }
        }
      }
      front = nxt;
    }
    return (simRes = { falls });
  }

  function place() {
    if (!myTurn() || !sel || busy) return;
    if (kind === 'split' && !V.split[V.me]) kind = 'domino';
    if (kind === 'block' && !V.block[V.me]) kind = 'domino';
    busy = true;
    SND.set(); ctx.buzz?.(10);
    const [x, y] = sel;
    ctx.act('place', { x, y, axis, kind }).then(() => { sel = null; kind = 'domino'; }).catch((e) => ctx.toast?.(e?.message || String(e))).finally(() => { busy = false; controls(); });
  }

  // ---------- state
  function render(s, c) {
    S = s; ctx = c; V = s.domino;
    if (sel && !freeCell(sel[0], sel[1])) sel = null;
    if (!myTurn()) sel = null;
    const tk = V.topple ? `${V.table}` : '';
    if (tk && tk !== toppleKey) {
      toppleKey = tk; rung = new Set(); played = 0;
      // a reload mid-topple doesn't replay what's already fallen
      const ago = V.topple.end + 3.5 - V.readyIn;
      toppleAt = performance.now() - Math.max(0, ago) * 1000;
    }
    if (!tk) toppleKey = '';
    hud(); controls(); race(); done(); hint();
  }

  function hud() {
    $('dmTable').textContent = `🪵 Table ${V.table}/${V.tables}` + (V.stage === 'build' ? ` · build ${V.round}/${V.turns}` : V.stage === 'topple' ? ' · TOPPLE!' : '');
    const who = $('dmWho');
    if (V.stage !== 'build' || V.cur == null) who.textContent = '';
    else { who.textContent = V.cur === V.me ? `🁫 Your turn: ${V.perTurn - V.placed} to place` : `${nameOf(V.cur)} is building`; who.style.color = V.cur === V.me ? '' : colorOf(V.cur); }
    const r = $('dmReach');
    if (V.stage === 'build' && V.me != null) {
      const mineT = (V.reach[String(V.me)]?.targets || []).map(([x, y]) => ICON[targetAt(x, y)?.[2]] || '').join('');
      r.textContent = `Your run: ${V.preview[String(V.me)] || 0} pts ${mineT}`;
      r.style.color = colorOf(V.me);
    } else r.textContent = '';
  }

  function controls() {
    if (!V) return;
    const mine = myTurn();
    $('dmCtl').classList.toggle('dm-off', !mine);
    for (const b of $('dmKinds').querySelectorAll('button')) {
      const k = b.dataset.k;
      b.disabled = !mine || (k === 'split' && !V.split[V.me]) || (k === 'block' && !V.block[V.me]);
      b.classList.toggle('on', k === kind);
    }
    $('dmRot').disabled = !mine || !sel || kind === 'block';
    $('dmGo').disabled = !mine || !sel || busy;
    $('dmGo').classList.toggle('dm-ready', mine && !!sel);
    $('dmLeft').textContent = mine ? '●'.repeat(V.perTurn - V.placed) + '○'.repeat(V.placed) : '';
  }

  function race() {
    const box = $('dmRace'); box.innerHTML = '';
    const rows = V.seats.map((_, i) => i).sort((a, b) => V.points[b] - V.points[a]);
    const top = Math.max(1, ...V.points);
    for (const i of rows) {
      const row = ctx.el('div', 'dm-row' + (i === V.me ? ' on' : '') + (i === V.cur && V.stage === 'build' ? ' turn' : ''));
      const nm = ctx.el('span', 'dm-nm', nameOf(i)); nm.style.color = colorOf(i);
      const bar = ctx.el('span', 'dm-bar'); const fill = ctx.el('i'); fill.style.width = `${(100 * V.points[i] / top).toFixed(1)}%`; fill.style.background = colorOf(i); bar.append(fill);
      const t = ctx.el('b', '', `${V.points[i]}`);
      const pv = V.stage === 'build' ? `run now ${V.preview[String(i)] || 0}` : V.topple ? `+${V.topple.pts[String(i)] || 0} this table` : '';
      const extra = ctx.el('small', '', `${pv}${V.split[i] ? ' · ✂' : ''}${V.block[i] ? ' · 🚫' : ''}`);
      row.append(nm, bar, t, extra);
      box.append(row);
    }
  }

  function done() {
    const show = V.stage === 'between' && !!V.standings;
    $('dmDone').hidden = !show;
    if (!show) return;
    $('dmDoneTitle').textContent = `💥 Table ${V.table} toppled`;
    standingsCard($('dmStand'), V.standings, { title: '🁫 Points', note: V.table < V.tables ? 'A fresh table in a moment…' : 'That was the last table!' });
  }

  function hint() {
    const t = S.phase !== 'playing' ? '' : V.stage === 'topple' ? 'Watch them fall!' : V.stage === 'between' ? ''
      : !myTurn() ? (V.me == null ? 'Watch the runs grow.' : 'Plan ahead: the coloured squares show where each run reaches now.')
        : !sel ? 'Tap a pulsing ring to stand a domino where your run reaches next (or any free square to plan ahead).'
          : 'Tap the square again (or ⟳ / R) to turn it 45°, then ✔ Place. Side-on stops a run.';
    if ($('dmHint').textContent !== t) $('dmHint').textContent = t;
    // the same nudge on the board itself (the hint line sits below the fold on a phone)
    const tip = $('dmTip'), tt = !myTurn() ? '' : !sel ? '👆 Tap a pulsing ring' : kind === 'block' ? '✔ Place to block' : '⟳ Tap again to turn · ✔ Place';
    if (tip.textContent !== tt) tip.textContent = tt;
    tip.hidden = !tt;
  }

  function pop(text, color = '#fff') {
    const el = $('dmPop'); if (!el) return;
    el.textContent = text; el.style.color = color; el.hidden = false;
    el.classList.remove('dm-pop-in'); void el.offsetWidth; el.classList.add('dm-pop-in');
  }

  // what the table looks like now (and, in a topple, how far each domino has fallen)
  function scene(now) {
    const owner = new Map();
    if (V.stage === 'build') for (const [s, r] of Object.entries(V.reach || {})) for (const [x, y] of r.cells) { const k = `${x},${y}`; if (!owner.has(k)) owner.set(k, []); owner.get(k).push(+s); }
    let fall = null, ring = null, tp = 0;
    if (V.topple) {
      tp = (now - toppleAt) / 1000;
      fall = new Map(V.topple.falls.map(([x, y, t, d, o]) => [`${x},${y}`, { t, d, o, u: clamp((tp - t) / 0.28, 0, 1) }]));
      ring = new Map(V.topple.rings.map(([x, y, t, o]) => [`${x},${y}`, { t, o, u: clamp((tp - t) / 0.6, 0, 1) }]));
    }
    const ghost = myTurn() && sel ? { x: sel[0], y: sel[1], axis, kind } : null;
    const taps = myTurn() ? myTaps() : [];
    return { V, owner, fall, ring, tp, ghost, taps, idle: false, now, myColor: V.me != null ? colorOf(V.me) : '#fff', colorOf };
  }

  function topple(now) {
    if (!V.topple) return;
    const tp = (now - toppleAt) / 1000;
    let n = 0;
    for (const [x, , t] of V.topple.falls) { if (t <= tp) n++; }
    while (played < n) { const f = V.topple.falls[played]; if (tp - f[2] < 0.4) SND.clack(clamp((f[0] - V.size / 2) / V.size * 2, -1, 1), played); played++; }
    for (const [x, y, t, o] of V.topple.rings) {
      const k = `${x},${y}`; if (t > tp || rung.has(k)) continue;
      rung.add(k);
      if (tp - t > 0.5) continue;
      const tg = targetAt(x, y)?.[2], pan = clamp((x - V.size / 2) / V.size * 2, -1, 1);
      if (tg === 'bell') SND.bell(pan); else if (tg === 'gate') SND.gate(pan); else { SND.tower(); (gl || flat)?.shake?.(); }
      if (tg === 'tower' || o.includes(V.me)) pop(`${ICON[tg]} ${o.map(nameOf).join(' & ')} +${V.values[tg]}`, tg === 'tower' ? '#ffd23f' : '#fff');
    }
  }

  function loop(now) {
    if (!$('dmStage')) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!V) return;
    topple(now);
    const busyAnim = V.topple && (now - toppleAt) / 1000 < V.topple.end + 1.2;
    if (!busyAnim && now - lastDraw < 100) return;
    lastDraw = now;
    const sc = scene(now); sc.idle = !busyAnim;
    (gl || flat)?.draw(now, sc);
  }

  // ---------- three.js: square (x, y) sits at world (x - mid, 0, mid - y); +y on the table runs away from you
  function make3d(stage) {
    const T = window.THREE;
    const renderer = GL3.renderer({}, { onLost: () => GL3.revive(stage, { build: () => { gl?.dispose(); gl = null; return (gl = make3d(stage)); }, flat: () => { flat ||= make2d(stage); }, unflat: () => { flat?.dispose?.(); flat = null; } }) });
    if (!renderer) return null;
    const canvas = renderer.domElement;
    stage.prepend(canvas);
    const scene3 = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.1, 200);
    const stg = GL3.stage(renderer, scene3, {
      exposure: 1.05, hemi: [0xfff1dd, 0x3a2a1a, 0.6], env: true,
      key: { color: 0xfff0d8, i: 1.3, pos: [-5, 14, 7], area: 12, near: 2, far: 40, map: 2048 },
      sky: { top: 0x2a1c14, horizon: 0x4a3426, bottom: 0x1a120c, radius: 90, band: 0.1 },
    });
    const low = stg.low;
    const tex = (w, h, paint) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); if (g) paint(g, w, h);
      const t = new T.CanvasTexture(c); t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4); return t;
    };
    const std = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
    let N = V.size, mid = (N - 1) / 2;
    const W = (x, y, h = 0) => new T.Vector3(x - mid, h, mid - y);
    // the table: a wooden top with a felt playing area marked in squares
    const woodTex = tex(512, 512, (g, w, h) => { g.fillStyle = '#6a4024'; g.fillRect(0, 0, w, h); for (let k = 0; k < 90; k++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,20,8' : '140,90,50'},${0.15 + Math.random() * 0.2})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + Math.random() * 20 - 10, 2 * w / 3, y + Math.random() * 20 - 10, w, y + Math.random() * 10 - 5); g.stroke(); } });
    woodTex.wrapS = woodTex.wrapT = T.RepeatWrapping; woodTex.repeat.set(3, 3);
    const top = new T.Mesh(new T.BoxGeometry(N + 4, 0.4, N + 4), std(0xffffff, { map: woodTex, roughness: 0.45 }));
    top.position.y = -0.2; top.receiveShadow = true; scene3.add(top);
    const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 4;
    // #151: the felt was a 512 texture stretched over a ~900 device-px board: soft grid lines
    const FT = low ? 1024 : 2048;
    const feltTex = tex(FT, FT, (g, w) => { g.fillStyle = '#1f5a3e'; g.fillRect(0, 0, w, w); const s = w / N; g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = w / 256; for (let k = 0; k <= N; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, w); g.stroke(); g.beginPath(); g.moveTo(0, k * s); g.lineTo(w, k * s); g.stroke(); } for (let k = 0; k < 3000 * (w / 512) ** 2 / 2; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * w, w / 256, w / 256); } });
    feltTex.anisotropy = maxAniso; feltTex.colorSpace = woodTex.colorSpace;
    const felt = new T.Mesh(new T.PlaneGeometry(N, N), std(0xffffff, { map: feltTex, roughness: 0.95 }));
    felt.rotation.x = -Math.PI / 2; felt.position.y = 0.002; felt.receiveShadow = true; scene3.add(felt);
    // reach tiles: a soft glow on the squares each run reaches now
    const tileGeo = new T.PlaneGeometry(0.92, 0.92), tiles = [];
    const tile = (k) => { if (tiles[k]) return tiles[k]; const m = new T.Mesh(tileGeo, new T.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false })); m.rotation.x = -Math.PI / 2; scene3.add(m); return (tiles[k] = m); };

    // dominoes: white with a band of the placer's colour; a pivot on the front bottom edge so they tip over it
    const DW = 0.62, DT = 0.15, DH = 0.98;
    const domGeo = new T.BoxGeometry(DT, DH, DW), bandGeo = new T.BoxGeometry(DT + 0.004, 0.12, DW + 0.004), pipGeo = new T.CircleGeometry(0.045, 10);
    const ivory = std(0xf4efe4, { roughness: 0.35 }), pipMat = std(0x1a1a1a, { roughness: 0.5 });
    const doms = new Map();
    function domFor(x, y, kindD, by, isStarter) {
      const k = `${x},${y}`;
      let d = doms.get(k);
      if (d && d.kind === kindD) return d;
      if (d) { scene3.remove(d.g); }
      const g = new T.Group(), pivot = new T.Group(); g.add(pivot);
      let body;
      if (kindD === 'block') {
        body = new T.Mesh(new T.BoxGeometry(0.7, 0.5, 0.7), std(0x8a5a32, { roughness: 0.7 })); body.position.set(0, 0.25, 0); body.castShadow = true; pivot.add(body);
      } else {
        body = new T.Mesh(domGeo, ivory); body.position.set(-DT / 2, DH / 2, 0); body.castShadow = true; body.receiveShadow = !low; pivot.add(body);
        const band = new T.Mesh(bandGeo, std(colorOf(by), { roughness: 0.4 })); band.position.set(-DT / 2, isStarter ? DH * 0.5 : DH * 0.82, 0); pivot.add(band);
        if (isStarter) { const band2 = band.clone(); band2.position.y = DH * 0.2; pivot.add(band2); const band3 = band.clone(); band3.position.y = DH * 0.8; pivot.add(band3); }
        if (!low) for (const side of [1, -1]) for (const [py, pz] of [[0.25, 0], [0.65, -0.14], [0.65, 0.14]]) { const p = new T.Mesh(pipGeo, pipMat); p.position.set(side > 0 ? 0.002 : -DT - 0.002, DH * py, pz); p.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; pivot.add(p); }
        if (kindD === 'split') { const v = new T.Mesh(new T.ConeGeometry(0.12, 0.2, 3), std(0xffd23f)); v.position.set(-DT / 2, DH + 0.1, 0); v.rotation.z = Math.PI; pivot.add(v); }
      }
      scene3.add(g);
      d = { g, pivot, kind: kindD };
      doms.set(k, d);
      return d;
    }
    // targets: a brass bell on a stand, a red gate (torii-like arch, along its axis), the cup tower
    const brass = std(0xd8a838, { metalness: 0.85, roughness: 0.3 }), redBase = std(0xc0392b, { roughness: 0.5 }), cupMat = std(0xf4f4f4, { roughness: 0.4 });
    const tgs = new Map();
    function targetFor(x, y, kindT, ax) {
      const k = `${x},${y}`; if (tgs.has(k)) return tgs.get(k);
      const g = new T.Group(); g.position.copy(W(x, y)); const parts = [];
      if (kindT === 'bell') {
        const post = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.9, 6), std(0x5a3a22)); post.position.y = 0.45; g.add(post);
        const arm = new T.Mesh(new T.BoxGeometry(0.4, 0.04, 0.04), std(0x5a3a22)); arm.position.set(0.15, 0.88, 0); g.add(arm);
        const swing = new T.Group(); swing.position.set(0.3, 0.86, 0); g.add(swing);
        const bell = new T.Mesh(new T.CylinderGeometry(0.06, 0.17, 0.26, 16, 1, true), brass); bell.position.y = -0.15; bell.material.side = T.DoubleSide; bell.castShadow = true; swing.add(bell);
        const knob = new T.Mesh(new T.SphereGeometry(0.04, 8, 6), brass); knob.position.y = -0.02; swing.add(knob);
        parts.push(swing);
      } else if (kindT === 'gate') {
        const ga = new T.Group(); ga.rotation.y = ax * Math.PI / 4 + Math.PI / 2; g.add(ga);
        const red = redBase.clone();       // each gate glows on its own when its run swings it
        for (const z of [-0.36, 0.36]) { const p = new T.Mesh(new T.CylinderGeometry(0.04, 0.05, 0.9, 8), red); p.position.set(0, 0.45, z); p.castShadow = true; ga.add(p); }
        const beam = new T.Mesh(new T.BoxGeometry(0.1, 0.08, 1.0), red); beam.position.y = 0.92; ga.add(beam);
        const beam2 = new T.Mesh(new T.BoxGeometry(0.08, 0.05, 0.8), std(0x2a1a1a)); beam2.position.y = 0.78; ga.add(beam2);
        parts.push(ga);
        // an arrow on the felt along the gate's line
        const arr = new T.Mesh(new T.PlaneGeometry(0.9, 0.12), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.45 })); arr.rotation.set(-Math.PI / 2, 0, ax * Math.PI / 4); arr.position.y = 0.006; g.add(arr);
      } else {
        // a pyramid of cups
        let n = 0;
        for (let row = 0; row < 4; row++) for (let k = 0; k <= 3 - row; k++) {
          const c = new T.Mesh(new T.CylinderGeometry(0.1, 0.075, 0.2, 12), cupMat);
          c.position.set((k - (3 - row) / 2) * 0.22, 0.1 + row * 0.2, ((n++ % 2) - 0.5) * 0.04); c.castShadow = true; g.add(c); parts.push(c);
          c.userData.home = c.position.clone(); c.userData.v = new T.Vector3((Math.random() - 0.5) * 2.4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2.4);
        }
        const flag = new T.Mesh(new T.PlaneGeometry(0.3, 0.18), new T.MeshBasicMaterial({ color: 0xffd23f, side: T.DoubleSide })); flag.position.set(0.15, 1.15, 0); g.add(flag);
        const stick = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 0.4, 4), std(0x333333)); stick.position.y = 1.0; g.add(stick);
        parts.push(flag, stick);
      }
      scene3.add(g);
      const t = { g, parts, kind: kindT };
      tgs.set(k, t); return t;
    }
    // #152: pulsing rings on the squares that carry my run on, and an arrow by my own starter showing its fall
    const tapGeo = new T.RingGeometry(0.28, 0.44, 32), taps3 = [];
    const tapMesh = (k) => { if (taps3[k]) return taps3[k]; const m = new T.Mesh(tapGeo, new T.MeshBasicMaterial({ transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; scene3.add(m); return (taps3[k] = m); };
    const arrowShape = new T.Shape(); arrowShape.moveTo(0, 0.5); arrowShape.lineTo(0.32, 0.12); arrowShape.lineTo(0.12, 0.12); arrowShape.lineTo(0.12, -0.4); arrowShape.lineTo(-0.12, -0.4); arrowShape.lineTo(-0.12, 0.12); arrowShape.lineTo(-0.32, 0.12); arrowShape.closePath();
    const startArrow = new T.Mesh(new T.ShapeGeometry(arrowShape), new T.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    startArrow.rotation.x = -Math.PI / 2; startArrow.visible = false;
    const startHolder = new T.Group(); startHolder.add(startArrow); scene3.add(startHolder);
    // the ghost of the domino you're about to place
    const ghostMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const ghost = new T.Group(); const ghostBody = new T.Mesh(domGeo, ghostMat); ghostBody.position.set(0, DH / 2, 0); ghost.add(ghostBody);
    const ghostArrow = new T.Mesh(new T.ConeGeometry(0.1, 0.3, 8), ghostMat); ghostArrow.rotation.z = -Math.PI / 2; ghostArrow.position.set(0.4, 0.05, 0); ghost.add(ghostArrow);
    const ghostArrow2 = ghostArrow.clone(); ghostArrow2.rotation.z = Math.PI / 2; ghostArrow2.position.x = -0.4; ghost.add(ghostArrow2);
    const selRing = new T.Mesh(new T.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })); selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.01;
    ghost.add(selRing); ghost.visible = false; scene3.add(ghost);

    function resize() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    let lastT = 0, built = '';
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();

    function draw(now, sc) {
      const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
      const V2 = sc.V;
      if (V2.size !== N) { N = V2.size; mid = (N - 1) / 2; }
      // a new table: clear the old pieces and targets
      const key = `${V2.table}:${JSON.stringify(V2.targets)}`;
      if (key !== built) { built = key; for (const d of doms.values()) scene3.remove(d.g); doms.clear(); for (const t of tgs.values()) scene3.remove(t.g); tgs.clear(); }
      const live = new Set();
      const stand = (x, y, ax, kindD, by, isStarter, d0) => {
        const k = `${x},${y}`; live.add(k);
        const d = domFor(x, y, kindD, by, isStarter);
        const f = sc.fall?.get(k);
        const dir = f ? f.d : d0 ?? ax;
        d.g.position.copy(W(x, y)); d.g.rotation.y = dir * Math.PI / 4;
        d.pivot.position.x = kindD === 'block' ? 0 : DT / 2;
        const u = f ? f.u : 0, ease = u * u * (3 - 2 * u);
        d.pivot.rotation.z = kindD === 'block' ? 0 : -ease * (dir % 2 ? 1.25 : 1.2);
      };
      for (const [x, y, d, s] of V2.starters) stand(x, y, d % 4, 'domino', s, true, d);
      for (const [x, y, ax, kindD, by] of V2.pieces) stand(x, y, ax, kindD, by, false);
      for (const [k, d] of doms) if (!live.has(k)) { scene3.remove(d.g); doms.delete(k); }
      for (const [x, y, kindT, ax] of V2.targets) {
        const t = targetFor(x, y, kindT, ax), r = sc.ring?.get(`${x},${y}`), u = r ? r.u : 0;
        if (kindT === 'bell') t.parts[0].rotation.z = r && u < 1 ? Math.sin(u * 30) * 0.6 * (1 - u) : r ? 0 : 0;
        else if (kindT === 'gate') t.parts[0].children.forEach((m) => { m.material.emissive?.set(r && u > 0 ? 0x553300 : 0x000000); });
        else t.parts.forEach((c) => { if (!c.userData.home) { c.visible = !r || u <= 0; return; } if (r && sc.tp >= r.t) { const s = Math.min(1.5, sc.tp - r.t); c.position.copy(c.userData.home).addScaledVector(c.userData.v, s); c.position.y = Math.max(0.1, c.userData.home.y + c.userData.v.y * s - 4.9 * s * s); c.rotation.set(s * 6, 0, s * 4); } else { c.position.copy(c.userData.home); c.rotation.set(0, 0, 0); } });
      }
      // reach tiles (build) or the toppled path tinted by owner (topple)
      let n = 0;
      if (sc.owner.size) for (const [k, owners] of sc.owner) {
        const [x, y] = k.split(',').map(Number), m = tile(n++);
        m.position.copy(W(x, y, 0.004)); m.material.color.set(sc.colorOf(owners[0])); m.material.opacity = owners.includes(V2.me) ? 0.42 : 0.2; m.visible = true;
      }
      for (let k = n; k < tiles.length; k++) tiles[k].visible = false;
      // tap targets (my turn) and my starter's arrow (whole build stage)
      sc.taps.forEach(([x, y], k) => { const m = tapMesh(k); m.visible = true; m.position.copy(W(x, y, 0.008)); m.material.color.set(sc.myColor); const p = 0.5 + 0.5 * Math.sin(now / 260 + k); m.material.opacity = 0.45 + 0.45 * p; m.scale.setScalar(0.9 + 0.18 * p); });
      for (let k = sc.taps.length; k < taps3.length; k++) taps3[k].visible = false;
      const st = V2.stage === 'build' && V2.me != null ? V2.starters.find((s) => s[3] === V2.me) : null;
      startArrow.visible = !!st;
      if (st) {
        const [sx, sy, sd] = st;
        startHolder.position.copy(W(sx + DIRS[sd][0] * 0.62, sy + DIRS[sd][1] * 0.62, 0.012));
        startHolder.rotation.y = sd * Math.PI / 4 - Math.PI / 2;
        startArrow.material.color.set(sc.myColor); startArrow.material.opacity = 0.55 + 0.3 * Math.sin(now / 300);
        startArrow.scale.setScalar(0.9);
      }
      // the ghost
      const gh = sc.ghost;
      ghost.visible = !!gh;
      if (gh) {
        ghost.position.copy(W(gh.x, gh.y)); ghost.rotation.y = gh.axis * Math.PI / 4;
        ghostBody.visible = gh.kind !== 'block'; ghostArrow.visible = ghostArrow2.visible = gh.kind !== 'block';
        ghostMat.color.set(gh.kind === 'block' ? 0xff8a5a : sc.myColor); ghostMat.opacity = 0.45 + 0.15 * Math.sin(now / 200);
      }
      // the camera: the whole table, tilted toward you; it fits a narrow phone
      const fov = 42, need = (N + 1) / 2, dist = need / Math.tan(fov * Math.PI / 360) / Math.min(1, camera.aspect * 1.1) * 1.2;
      camera.position.set(0, dist * 0.86, dist * 0.52);
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      GL3.tickShake(camera, dt);
      camera.lookAt(0, 0, 0.6);
      stg.follow(camera);
      // #151: idle redraws (~10 fps on purpose) must not count as a slow phone, or GL3 drops the resolution
      if (sc.idle && renderer.renderStill) renderer.renderStill(scene3, camera); else renderer.render(scene3, camera);
    }

    return {
      draw, resize,
      shake() { GL3.shake(camera, 0.12); },
      pick(cx, cy) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera({ x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 }, camera);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return [Math.round(hit.x + mid), Math.round(mid - hit.z)];
      },
      dispose() {
        stg.dispose();
        scene3.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material || [])) { mat.map?.dispose(); mat.dispose(); } });
        renderer.dispose(); canvas.remove();
      },
    };
  }

  // ---------- flat fallback: the table from above
  function make2d(stage) {
    const canvas = document.createElement('canvas');
    stage.prepend(canvas);
    const g = canvas.getContext('2d');
    if (!g) { canvas.remove(); stage.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This browser cannot draw the table.' })); return { draw() {}, resize() {}, dispose() {} }; }
    let w = 1, h = 1, k = 1, ox = 0, oy = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = stage.clientWidth || 1; h = stage.clientHeight || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const X = (x) => ox + (x + 0.5) * k, Y = (y) => oy + (V.size - y - 0.5) * k;
    function draw(now, sc) {
      const N = V.size;
      k = Math.min(w - 12, h - 76) / N; ox = (w - k * N) / 2; oy = 62 + (h - 70 - k * N) / 2;
      g.fillStyle = '#4a2e1a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f5a3e'; g.fillRect(ox, oy, k * N, k * N);
      g.strokeStyle = '#ffffff22'; g.lineWidth = 1;
      for (let i = 0; i <= N; i++) { g.beginPath(); g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + N * k); g.stroke(); g.beginPath(); g.moveTo(ox, oy + i * k); g.lineTo(ox + N * k, oy + i * k); g.stroke(); }
      for (const [key, owners] of sc.owner) { const [x, y] = key.split(',').map(Number); g.globalAlpha = owners.includes(V.me) ? 0.4 : 0.2; g.fillStyle = sc.colorOf(owners[0]); g.fillRect(X(x) - k / 2 + 1, Y(y) - k / 2 + 1, k - 2, k - 2); }
      g.globalAlpha = 1;
      g.font = `${Math.round(k * 0.7)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [x, y, kindT, ax] of V.targets) {
        const r = sc.ring?.get(`${x},${y}`);
        if (kindT === 'gate') { g.save(); g.translate(X(x), Y(y)); g.rotate(-ax * Math.PI / 4); g.strokeStyle = '#ffd23f88'; g.lineWidth = 3; g.beginPath(); g.moveTo(-k * 0.45, 0); g.lineTo(k * 0.45, 0); g.stroke(); g.restore(); }
        g.globalAlpha = r && sc.tp >= r.t ? 0.5 : 1; g.fillText(ICON[kindT], X(x), Y(y) + (r && sc.tp >= r.t && kindT === 'bell' ? Math.sin(now / 40) * 2 : 0)); g.globalAlpha = 1;
      }
      const dom = (x, y, ax, kindD, by, d0) => {
        const f = sc.fall?.get(`${x},${y}`), dir = f ? f.d : d0 ?? ax, u = f ? f.u : 0;
        g.save(); g.translate(X(x) + DIRS[dir][0] * u * k * 0.45, Y(y) - DIRS[dir][1] * u * k * 0.45); g.rotate(-dir * Math.PI / 4);
        if (kindD === 'block') { g.fillStyle = '#8a5a32'; g.fillRect(-k * 0.35, -k * 0.35, k * 0.7, k * 0.7); }
        else { const len = k * (0.16 + u * 0.8); g.fillStyle = '#f4efe4'; g.fillRect(-len / 2, -k * 0.32, len, k * 0.64); g.fillStyle = sc.colorOf(by); g.fillRect(-len / 2, -k * 0.32, Math.max(2, len * 0.35), k * 0.64); if (kindD === 'split') { g.fillStyle = '#ffd23f'; g.fillRect(-2, -k * 0.4, 4, k * 0.8); } }
        g.restore();
      };
      for (const [x, y, d, s] of V.starters) dom(x, y, d % 4, 'domino', s, d);
      for (const [x, y, ax, kindD, by] of V.pieces) dom(x, y, ax, kindD, by);
      sc.taps.forEach(([x, y], i) => { const p = 0.5 + 0.5 * Math.sin(now / 260 + i); g.globalAlpha = 0.5 + 0.45 * p; g.strokeStyle = sc.myColor; g.lineWidth = 3; g.beginPath(); g.arc(X(x), Y(y), k * (0.3 + 0.08 * p), 0, Math.PI * 2); g.stroke(); });
      g.globalAlpha = 1;
      const st = V.stage === 'build' && V.me != null ? V.starters.find((s) => s[3] === V.me) : null;
      if (st) { const [sx, sy, sd] = st; g.save(); g.translate(X(sx) + DIRS[sd][0] * k * 0.62, Y(sy) - DIRS[sd][1] * k * 0.62); g.rotate(-sd * Math.PI / 4); g.fillStyle = sc.myColor; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(k * 0.35, 0); g.lineTo(0, k * 0.25); g.lineTo(0, -k * 0.25); g.closePath(); g.fill(); g.restore(); g.globalAlpha = 1; }
      if (sc.ghost) { g.globalAlpha = 0.6; g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(X(sc.ghost.x) - k / 2, Y(sc.ghost.y) - k / 2, k, k); dom(sc.ghost.x, sc.ghost.y, sc.ghost.axis, sc.ghost.kind, V.me); g.globalAlpha = 1; }
    }
    return {
      draw, resize, shake() {},
      pick(px, py) { const r = canvas.getBoundingClientRect(); return [Math.floor((px - r.left - ox) / k), V.size - 1 - Math.floor((py - r.top - oy) / k)]; },
      dispose() { canvas.remove(); },
    };
  }

  // #152: keep the shell's "your turn" message on your turn
  const turnText = (s) => {
    const D = s.domino; if (s.phase !== 'playing' || !D) return null;
    if (D.stage !== 'build') return '🁫 Topple!';
    return `${D.cur != null && D.cur === D.me ? '✨ Your turn · ' : '🁫 '}Table ${D.table} · build ${D.round} of ${D.turns}`;
  };
  return { mount, unmount, render, turnText, focus: true };
})();
