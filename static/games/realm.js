// Realm Wars: an SVG sea chart of an archipelago. Each land is a real shape (a Voronoi cell of the island, cut
// back from the other islands by a strait and roughened along a shared noise field so neighbours stay
// seamless), tinted in its ruler's colour over the island's terrain, with a bevelled army token on top.
// Claim (an option): tap a free land. Draft: tap your lands to place troops (↶ takes one back; 🏰 forts one).
// Attack: tap one of your lands, then a rival neighbour, and roll (or blitz). Fortify: tap a land, then one
// joined to it, and move. Press and hold a land for its details; pinch, drag or ＋/− to zoom the map.
UI.realm = (() => {
  let S, ctx, built = null, sel = null, tgt = null, amt = 1, moveN = null, fortMode = false;
  let seenEv = null, seenLast = null, seenOwner = null, colours = '', stormKey = '', chain = null;
  let W = 600, H = 660, vb = null, suppress = false, press = null, infoTimer = null, autoZoomed = false;
  let cellPaths = [], seenTurn = null, playEnd = 0, lastManual = 0, tween = null, lens = 0, advise = false;
  let seenIsles = null, seenHand = null, seenAmb = null, snapMine = null, bountyKey = '';
  const pointers = new Map(), holding = new Map(), holdOwner = new Map(), ticks = new Map(), marching = new Set();
  const NS = 'http://www.w3.org/2000/svg';
  const GAP = 13;
  const KINDS = ['⚔️', '🛡️', '🏹', '⭐'];
  const $ = (id) => document.getElementById(id);
  const svgEl = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.append(e);
    return e;
  };
  // motion: cheap one-off effects (marching, bursts, flags, pops, ticking counts) — off only for reduced motion.
  // rich: also needs graphics above low, for textures and endless loops (the CSS body.lowgfx rules).
  const motion = () => (typeof motionOK === 'function' ? motionOK() : true);
  const rich = () => motion() && !document.body.classList.contains('lowgfx');
  const GAMBIT = { muster: ['📯', 'Muster', '+50% troops in this draft'], shield: ['🛡️', 'Shield wall', 'until your next turn, every land of yours defends as if forted'],
    march: ['🎺', 'Forced march', 'two fortify moves this turn'], runner: ['⛵', 'Storm runner', 'this turn, attack and move across stormy lanes'] };
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // -- the odds an attack with `a` spare troops takes a land held by `d`, rolling until it's settled.
  // A fort adds 1 to the defender's best die (games/realm.py resolve()).
  const ODDS = (() => {
    const out = {};
    for (const fort of [false, true]) for (const na of [1, 2, 3]) for (const nd of [1, 2]) {
      const tally = {}, n = na + nd, total = 6 ** n;
      for (let c = 0; c < total; c++) {
        const dice = []; let x = c;
        for (let k = 0; k < n; k++) { dice.push(x % 6 + 1); x = Math.floor(x / 6); }
        const at = dice.slice(0, na).sort((p, q) => q - p), de = dice.slice(na).sort((p, q) => q - p);
        if (fort) de[0] += 1;
        let la = 0; for (let k = 0; k < Math.min(na, nd); k++) if (at[k] <= de[k]) la++;
        const key = la + ',' + (Math.min(na, nd) - la);
        tally[key] = (tally[key] || 0) + 1;
      }
      out[`${na},${nd},${fort}`] = Object.entries(tally).map(([k, v]) => [...k.split(',').map(Number), v / total]);
    }
    return out;
  })();
  const memo = new Map();
  function winChance(a, d, fort = false) {
    if (d <= 0) return 1;
    if (a <= 0) return 0;
    const key = `${a},${d},${fort}`;
    if (memo.has(key)) return memo.get(key);
    let p = 0;
    for (const [la, ld, pr] of ODDS[`${Math.min(3, a)},${Math.min(2, d)},${fort}`]) p += pr * winChance(a - la, d - ld, fort);
    memo.set(key, p);
    return p;
  }

  // -- geometry: land shapes
  function clip(poly, a, b, c) {  // keep the side where a·x + b·y <= c
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const P = poly[k], Q = poly[(k + 1) % poly.length];
      const fp = a * P[0] + b * P[1] - c, fq = a * Q[0] + b * Q[1] - c;
      if (fp <= 0) out.push(P);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return out;
  }
  function cells(lands, reach) {
    return lands.map(([, ki, xi, yi]) => {
      let poly = Array.from({ length: 48 }, (_, k) => [xi + reach * Math.cos(k * Math.PI / 24), yi + reach * Math.sin(k * Math.PI / 24)]);
      for (const [, kj, xj, yj] of lands) {
        if (xj === xi && yj === yi) continue;
        const nx = xj - xi, ny = yj - yi;
        poly = clip(poly, nx, ny, nx * (xi + xj) / 2 + ny * (yi + yj) / 2 - (ki !== kj ? GAP * Math.hypot(nx, ny) : 0));
      }
      for (const [a, b, c] of [[1, 0, W - 6], [-1, 0, -6], [0, 1, H - 6], [0, -1, -6]]) poly = clip(poly, a, b, c);
      return poly;
    });
  }
  // a smooth displacement field: both lands sharing a border bend it the same way
  const wob = (x, y) => [x + 2.4 * Math.sin(0.13 * x + 0.09 * y + 1.7) + 1.3 * Math.sin(0.31 * y - 0.22 * x + 0.4),
    y + 2.4 * Math.sin(0.11 * y - 0.12 * x + 2.9) + 1.3 * Math.sin(0.27 * x + 0.19 * y + 5.1)];
  function pathOf(poly) {
    const pts = [];
    poly.forEach((P, i) => {
      const Q = poly[(i + 1) % poly.length], k = Math.max(1, Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1]) / 6));
      for (let s = 0; s < k; s++) pts.push(wob(P[0] + (Q[0] - P[0]) * s / k, P[1] + (Q[1] - P[1]) * s / k));
    });
    return 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  }
  // the gentle curve between two lands that arrows and marching troops follow
  function curve(m, f, t, startPad = 17, endPad = 24) {
    const [, , x1, y1] = m.map.lands[f], [, , x2, y2] = m.map.lands[t];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const sx = x1 + ux * startPad, sy = y1 + uy * startPad, ex = x2 - ux * endPad, ey = y2 - uy * endPad;
    const mx = (sx + ex) / 2 - uy * len * 0.18, my = (sy + ey) / 2 + ux * len * 0.18;
    const at = (u) => [(1 - u) ** 2 * sx + 2 * (1 - u) * u * mx + u * u * ex, (1 - u) ** 2 * sy + 2 * (1 - u) * u * my + u * u * ey];
    return { d: `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, at };
  }
  const laneMid = (m, a, b) => {
    const [, , x1, y1] = m.map.lands[a], [, , x2, y2] = m.map.lands[b];
    return [(x1 + x2) / 2 + (y2 - y1) * 0.06, (y1 + y2) / 2 - (x2 - x1) * 0.06];
  };

  // -- colour helpers
  const hexRGB = (h) => { const n = parseInt(/^#[0-9a-f]{6}$/i.test(h || '') ? h.slice(1) : '888888', 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (h, t, w) => '#' + hexRGB(h).map((v, i) => Math.round(v + (t[i] - v) * w).toString(16).padStart(2, '0')).join('');
  const colourOf = (m, o) => (o >= 0 ? ctx.player(m.seats[o])?.color ?? '#888888' : '#8a8a92');
  const shapeOf = (c) => (typeof SHAPES !== 'undefined' && SHAPES[c]) || '';

  // -- terrain textures, one per island (Frostmere, Skyreef, Tidewatch, Verdant, Ashlands, Sunreach, Stormholt, Mirefen)
  function patterns(defs) {
    const pat = (id, w, h, draw) => { const p = svgEl('pattern', { id, width: w, height: h, patternUnits: 'userSpaceOnUse' }, defs); draw(p); };
    pat('rwT0', 22, 22, (p) => {  // ice: frost specks and hairline cracks
      svgEl('path', { d: 'M3 6l5 3l3 -2M13 16l4 -3l3 2', stroke: '#ffffff', 'stroke-width': 1, fill: 'none', opacity: 0.8 }, p);
      svgEl('circle', { cx: 16, cy: 5, r: 1.2, fill: '#fff' }, p); svgEl('circle', { cx: 6, cy: 17, r: 1, fill: '#fff' }, p);
    });
    pat('rwT1', 26, 20, (p) => {  // high reef: puffs of cloud
      svgEl('path', { d: 'M4 12a3 3 0 0 1 5-2a3.5 3.5 0 0 1 6 1h-11z M16 4a2 2 0 0 1 4 -1a2.5 2.5 0 0 1 4 1h-8z', fill: '#ffffff', opacity: 0.75 }, p);
    });
    pat('rwT2', 18, 16, (p) => {  // marsh: reed tufts
      svgEl('path', { d: 'M4 12l-1 -5M5 12l1 -6M6 12l2 -4M13 6l-1 -4M14 6l1 -5', stroke: '#2f6b45', 'stroke-width': 1.1, 'stroke-linecap': 'round', fill: 'none' }, p);
    });
    pat('rwT3', 20, 20, (p) => {  // forest: little trees
      for (const [x, y] of [[5, 7], [15, 15]]) {
        svgEl('path', { d: `M${x} ${y - 5}l4 7h-8z`, fill: '#2d6a2a' }, p);
        svgEl('rect', { x: x - 0.7, y: y + 2, width: 1.4, height: 2, fill: '#5b3d1e' }, p);
      }
    });
    pat('rwT4', 24, 24, (p) => {  // volcanic: cracks with embers
      svgEl('path', { d: 'M2 8l5 2l3 -3l6 3M10 20l4 -4l5 1', stroke: '#4a2416', 'stroke-width': 1.2, fill: 'none' }, p);
      svgEl('circle', { cx: 18, cy: 6, r: 1.3, fill: '#ff7a2e' }, p); svgEl('circle', { cx: 5, cy: 18, r: 1, fill: '#ffae4a' }, p);
    });
    pat('rwT5', 28, 14, (p) => {  // desert: dune ripples
      svgEl('path', { d: 'M1 6q6 -4 12 0t12 0M8 12q5 -3 10 0', stroke: '#a7793a', 'stroke-width': 1.1, fill: 'none' }, p);
    });
    pat('rwT6', 26, 22, (p) => {  // rock: boulders and ridges
      svgEl('path', { d: 'M3 15l4 -6l3 3l3 -5l5 8', stroke: '#5c554c', 'stroke-width': 1.2, fill: 'none', 'stroke-linejoin': 'round' }, p);
      svgEl('ellipse', { cx: 20, cy: 18, rx: 2.6, ry: 1.8, fill: '#77706a' }, p); svgEl('ellipse', { cx: 6, cy: 4, rx: 1.8, ry: 1.3, fill: '#77706a' }, p);
    });
    pat('rwT7', 24, 20, (p) => {  // fen: pools among the reeds
      svgEl('ellipse', { cx: 8, cy: 13, rx: 5, ry: 2.2, fill: '#5d8fa3', opacity: 0.8 }, p);
      svgEl('path', { d: 'M18 8l-1 -5M19 8l1 -6M20 8l2 -4', stroke: '#4f6b35', 'stroke-width': 1.1, 'stroke-linecap': 'round', fill: 'none' }, p);
    });
    pat('rwWave', 46, 30, (p) => {  // the open sea
      svgEl('path', { d: 'M4 10q4 -4 8 0t8 0M26 24q4 -4 8 0t8 0', stroke: '#ffffff', 'stroke-width': 1.2, fill: 'none', opacity: 0.16, 'stroke-linecap': 'round' }, p);
    });
  }

  function mount(main, side) {
    built = null; sel = null; tgt = null; moveN = null; fortMode = false; chain = null;
    seenEv = null; seenLast = null; seenOwner = null; colours = ''; stormKey = ''; vb = null; suppress = false;
    pointers.clear(); holding.clear(); holdOwner.clear(); ticks.clear();
    cellPaths = []; snapMine = null; bountyKey = ''; seenTurn = null; playEnd = 0; lastManual = 0; tween = null; seenIsles = null; seenHand = null; seenAmb = null;
    try { amt = +localStorage.getItem('rwAmt') || 1; } catch { amt = 1; }
    try { lens = +localStorage.getItem('rwLens') || 0; advise = localStorage.getItem('rwAdvise') === '1'; } catch { lens = 0; advise = false; }
    main.innerHTML = `<div class="rw">
      <div id="rwSteps" class="rw-steps"></div>
      <div id="rwStatus" class="rw-status"></div>
      <div id="rwAlert" class="rw-alert" hidden></div>
      <div id="rwRecap" class="rw-recap" hidden></div>
      <div id="rwWrap" class="rw-mapwrap">
        <svg id="rwMap" class="rw-map" viewBox="0 0 600 660" role="img" aria-label="Map of the islands"></svg>
        <div class="rw-zoom"><button id="rwZin" aria-label="Zoom in">＋</button><button id="rwZout" aria-label="Zoom out">−</button><button id="rwZfit" aria-label="Show the whole map">⤢</button><button id="rwLensBtn" aria-label="Map lens">🧭</button></div>
        <div id="rwLensTag" class="rw-lens-tag" hidden></div>
        <div id="rwInfo" class="rw-info" hidden></div>
      </div>
      <div id="rwBattle" class="rw-battle" hidden><div class="rw-side"><div id="rwAtk" class="ya-dice"></div><span id="rwAtkTxt"></span></div>
        <b class="rw-vs">⚔</b><div class="rw-side"><div id="rwDef" class="ya-dice"></div><span id="rwDefTxt"></span></div></div>
      <div id="rwBar" class="rw-bar"></div></div>`;
    side.innerHTML = `<div class="panel"><div id="rwRound" class="hint left"></div><div class="rw-powerwrap"><div id="rwPower" class="rw-power"></div><i id="rwDomMark" class="rw-dommark" hidden></i></div><div id="rwDomTxt" class="hint left rw-domtxt" hidden></div><div id="rwSeats"></div></div>
      <div id="rwAmbBox" class="panel" hidden><h3>🎯 Your ambition</h3><div id="rwAmb" class="rw-amb"></div></div>
      <div class="panel"><h3>📜 Chronicle</h3><div id="rwChron" class="rw-chron"></div></div>
      <div class="panel"><h3>🎴 Your banners</h3><div id="rwHand" class="rw-hand"></div><div class="row"><button id="rwTrade">Trade a set</button></div>
      <p class="hint left">Three alike, or one of each (⭐ is wild). You earn one each turn you take a land.</p></div>
      <div class="panel"><h3>🏝️ Islands</h3><div id="rwIsles"></div></div>`;
    $('rwTrade').onclick = () => ctx.quiet(ctx.act('trade'));
    $('rwZin').onclick = () => { lastManual = now(); zoomBy(1 / 1.5); };
    $('rwZout').onclick = () => { lastManual = now(); zoomBy(1.5); };
    $('rwZfit').onclick = () => { lastManual = now(); tweenVB(0, 0, W); };
    $('rwLensBtn').onclick = () => { lens = (lens + 1) % 3; try { localStorage.setItem('rwLens', lens); } catch {} paint(); };
    $('rwInfo').onclick = hideInfo;
    wire($('rwMap'));
  }

  // -- zoom and pan: the viewBox moves, the shapes don't
  function setVB(x, y, w) {
    w = Math.max(W / 3, Math.min(W, w));
    const h = w * H / W;
    vb = { x: Math.max(0, Math.min(W - w, x)), y: Math.max(0, Math.min(H - h, y)), w, h };
    const svg = $('rwMap');
    svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
    svg.classList.toggle('zoomed', w < W - 0.5);
    $('rwZout').disabled = w >= W - 0.5; $('rwZfit').disabled = w >= W - 0.5; $('rwZin').disabled = w <= W / 3 + 0.5;
    hideInfo();
  }
  function zoomBy(f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) {
    const w = Math.max(W / 3, Math.min(W, vb.w * f)), h = w * H / W;
    tweenVB(cx - (cx - vb.x) * (w / vb.w), cy - (cy - vb.y) * (h / vb.h), w);
  }
  // glide the view to a new box (or jump, without motion)
  function tweenVB(x, y, w, ms = 320) {
    if (!motion()) return setVB(x, y, w);
    const from = { ...vb }, t0 = now(), id = {};
    tween = id;
    const step = () => {
      if (tween !== id) return;
      const u = Math.min(1, (now() - t0) / ms), e = 1 - (1 - u) ** 3;
      setVB(from.x + (x - from.x) * e, from.y + (y - from.y) * e, from.w + (w - from.w) * e);
      if (u < 1) raf(step); else tween = null;
    };
    raf(step);
  }
  // when zoomed in, bring the action into view (unless you panned by hand in the last 8 s)
  function follow(m, lands) {
    if (!vb || vb.w >= W - 0.5 || now() - lastManual < 8000 || !lands.length) return;
    const pts = lands.map((i) => m.map.lands[i]);
    const pad = 40, out = pts.some(([, , x, y]) => x < vb.x + pad || x > vb.x + vb.w - pad || y < vb.y + pad || y > vb.y + vb.h - pad);
    if (!out) return;
    const cx = pts.reduce((a, l) => a + l[2], 0) / pts.length, cy = pts.reduce((a, l) => a + l[3], 0) / pts.length;
    tweenVB(cx - vb.w / 2, cy - vb.h / 2, vb.w);
  }
  function toSheet(cx, cy) {
    const r = $('rwMap').getBoundingClientRect();
    if (!r.width) return [vb.x + vb.w / 2, vb.y + vb.h / 2];
    return [vb.x + (cx - r.left) * vb.w / r.width, vb.y + (cy - r.top) * vb.h / r.height];
  }
  function wire(svg) {
    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const land = e.target?.dataset?.i;
        press = { x: e.clientX, y: e.clientY, vb: { ...vb }, moved: false, land };
        clearTimeout(infoTimer);
        if (land != null) infoTimer = setTimeout(() => { if (press && !press.moved) { suppress = true; showInfo(+land); } }, 480);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        press = { pinch: Math.hypot(a.x - b.x, a.y - b.y), vb: { ...vb }, mid: toSheet((a.x + b.x) / 2, (a.y + b.y) / 2), moved: true };
        clearTimeout(infoTimer);
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !press) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && press.pinch) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        lastManual = now(); tween = null;
        const w = Math.max(W / 3, Math.min(W, press.vb.w * press.pinch / d)), h = w * H / W;
        const [mx, my] = press.mid;
        setVB(mx - (mx - press.vb.x) * (w / press.vb.w), my - (my - press.vb.y) * (h / press.vb.h), w);
        return;
      }
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      if (!press.moved && Math.hypot(dx, dy) > 8) { press.moved = true; clearTimeout(infoTimer); }
      if (press.moved && vb.w < W - 0.5) {
        lastManual = now(); tween = null;
        const r = svg.getBoundingClientRect(), k = r.width ? vb.w / r.width : 1;
        setVB(press.vb.x - dx * k, press.vb.y - dy * k, press.vb.w);
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      clearTimeout(infoTimer);
      if (press?.moved) suppress = true;
      if (!pointers.size) { press = null; setTimeout(() => { suppress = false; }, 60); }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    // a mouse gets the land card on hover
    svg.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || e.target?.dataset?.i == null) return;
      clearTimeout(infoTimer);
      const i = +e.target.dataset.i;
      infoTimer = setTimeout(() => showInfo(i), 450);
    });
    svg.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse') { clearTimeout(infoTimer); hideInfo(); } });
  }

  // -- the land card: press and hold (or hover)
  function showInfo(i) {
    const m = S?.realm, box = $('rwInfo');
    if (!m || !box) return;
    const [name, k, x, y] = m.map.lands[i], o = m.owner[i];
    const [iname, bonus] = m.map.islands[k], holder = m.isles.findIndex((l) => l.includes(k));
    box.replaceChildren();
    box.append(ctx.el('b', '', name));
    box.append(ctx.el('div', '', `🏝️ ${iname} (+${bonus}) · ${holder >= 0 ? `held by ${ctx.player(m.seats[holder])?.name ?? '?'}` : 'not held whole'}`));
    const who = o >= 0 ? ctx.player(m.seats[o])?.name ?? '?' : 'unclaimed';
    box.append(ctx.el('div', '', `${o === m.me ? '🛡️ Yours' : `🏴 ${who}`} · ${m.troops[i]} troop${m.troops[i] === 1 ? '' : 's'}`
      + (m.forts.includes(i) ? ' · 🏰 fort' : '') + (m.capitals?.includes(i) ? ' · 👑 capital' : '')));
    if (m.bounty === i) box.append(ctx.el('div', 'rw-info-bounty', `💰 Bounty: take it for +${m.bountyTroops} troops and a banner`));
    const sea = m.map.links.filter(([a, b, s]) => s && (a === i || b === i)).map(([a, b]) => (a === i ? b : a));
    const nb = adjAll(m, i).length;
    box.append(ctx.el('div', 'hint', `${nb} neighbour${nb === 1 ? '' : 's'}` + (sea.length
      ? ` · ⛵ ${sea.map((j) => m.map.lands[j][0] + (stormed(m, i, j) ? ' ⛈️' : '')).join(', ')}` : '')));
    if (mineTurn() && m.phase === 'attack' && o !== m.me) {
      const from = adj(m, i).filter((f) => m.owner[f] === m.me && m.troops[f] >= 2);
      if (from.length) {
        const best = Math.max(...from.map((f) => winChance(m.troops[f] - 1, m.troops[i], m.forts.includes(i))));
        box.append(ctx.el('div', '', `🎲 Best odds: ${Math.round(best * 100)}%`));
      }
    }
    box.hidden = false;
    const r = $('rwMap').getBoundingClientRect(), wr = $('rwWrap').getBoundingClientRect();
    const px = r.width ? (x - vb.x) / vb.w * r.width + (r.left - wr.left) : 0, py = r.height ? (y - vb.y) / vb.h * r.height + (r.top - wr.top) : 0;
    const bw = box.offsetWidth || 200;
    box.style.left = `${Math.max(4, Math.min((wr.width || 300) - bw - 4, px - bw / 2))}px`;
    box.style.top = `${py > (wr.height || 400) * 0.55 ? Math.max(4, py - (box.offsetHeight || 90) - 26) : py + 26}px`;
    clearTimeout(showInfo.t);
    showInfo.t = setTimeout(hideInfo, 4000);
  }
  function hideInfo() { const b = $('rwInfo'); if (b) b.hidden = true; }

  function build(m) {
    const svg = $('rwMap'), L = m.map.lands;
    [W, H] = m.map.size;
    const paths = cells(L, m.map.reach).map(pathOf);
    cellPaths = paths;
    svg.innerHTML = '';
    $('rwWrap').style.setProperty('--ar', String(W / H));
    const defs = svgEl('defs', {}, svg);
    const sea = svgEl('radialGradient', { id: 'rwSea', cx: '50%', cy: '42%', r: '75%' }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#3c86ad' }, sea);
    svgEl('stop', { offset: '.6', 'stop-color': '#225c82' }, sea);
    svgEl('stop', { offset: '1', 'stop-color': '#112f4a' }, sea);
    for (const [id, fill] of [['rwHeadR', '#ff4d4d'], ['rwHeadF', '#3ee0c0']]) {
      const head = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 4, refY: 5, markerWidth: 3.2, markerHeight: 3.2, orient: 'auto', markerUnits: 'strokeWidth' }, defs);
      svgEl('path', { d: 'M0 0L10 5L0 10z', fill, stroke: '#fff', 'stroke-width': 1 }, head);
    }
    svgEl('g', { id: 'rwGrads' }, defs);
    patterns(defs);

    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#rwSea)' }, svg);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#rwWave)' }, svg);
    // shallows and beaches: wide strokes under the land merge into one coast per island; a held island's
    // beach turns its ruler's colour
    const shallow = svgEl('g', { class: 'rw-shallow' }, svg), beach = svgEl('g', { class: 'rw-beach', id: 'rwBeach' }, svg);
    paths.forEach((d, i) => { svgEl('path', { d }, shallow); svgEl('path', { d, 'data-k': L[i][1] }, beach); });
    // sea lanes under the land, so they read as routes across the water
    const lanes = svgEl('g', { class: 'rw-lanes' }, svg);
    for (const [a, b, isSea] of m.map.links) {
      if (!isSea) continue;
      const [, , x1, y1] = L[a], [, , x2, y2] = L[b];
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
      svgEl('path', { d: `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`, class: 'rw-sealane', 'data-lane': `${Math.min(a, b)}-${Math.max(a, b)}` }, lanes);
    }
    const terrain = svgEl('g', { class: 'rw-terrain' }, svg), tint = svgEl('g', { class: 'rw-tint' }, svg), tex = svgEl('g', { class: 'rw-tex' }, svg);
    const borders = svgEl('g', { class: 'rw-borders' }, svg);
    paths.forEach((d, i) => {
      const k = L[i][1];
      svgEl('path', { d, fill: m.map.islands[k][2] }, terrain);
      svgEl('path', { d, id: `rwTint${i}` }, tint);
      svgEl('path', { d, fill: `url(#rwT${k})` }, tex);
      svgEl('path', { d }, borders);
    });
    // island names out on the water, and a compass
    const names = svgEl('g', { class: 'rw-isle-names' }, svg);
    m.map.islands.forEach(([name, bonus], k) => {
      const [x, y, anchor] = m.map.labels[k] || [W / 2, H / 2, 'middle'];
      svgEl('text', { x, y, 'text-anchor': anchor, class: 'rw-isle-name', 'data-k': k }, names).textContent = `${name.toUpperCase()} +${bonus}`;
    });
    const [rx, ry] = m.map.compass;
    const rose = svgEl('g', { class: 'rw-rose', transform: `translate(${rx} ${ry})` }, svg);
    svgEl('circle', { r: 30, class: 'rw-rose-ring' }, rose);
    svgEl('path', { d: 'M0 -28L6 0L0 28L-6 0Z', class: 'rw-rose-ns' }, rose);
    svgEl('path', { d: 'M-28 0L0 -5L28 0L0 5Z', class: 'rw-rose-ew' }, rose);
    svgEl('path', { d: 'M0 -28L6 0L-6 0Z', class: 'rw-rose-n' }, rose);
    svgEl('text', { y: -33, class: 'rw-rose-t' }, rose).textContent = 'N';
    svgEl('g', { id: 'rwLens', class: 'rw-lens' }, svg);
    svgEl('g', { id: 'rwStorms', class: 'rw-storms' }, svg);
    svgEl('g', { id: 'rwArrows' }, svg);
    svgEl('g', { id: 'rwAdvice', class: 'rw-advice' }, svg);
    // army tokens
    const toks = svgEl('g', { class: 'rw-toks' }, svg);
    L.forEach(([name, , x, y], i) => {
      const g = svgEl('g', { class: 'rw-tok', id: `rwTok${i}`, transform: `translate(${x} ${y})` }, toks);
      svgEl('ellipse', { cy: 14, rx: 15, ry: 4.5, class: 'rw-tok-shadow' }, g);
      const fort = svgEl('g', { class: 'rw-fort', transform: 'translate(-15 -9)' }, g);
      svgEl('path', { d: 'M-7 8V-4h2.4v-3h2.4v3h2.4v-3h2.4v3h2.4v-3h2.4v3H7V8z' }, fort);
      svgEl('path', { d: 'M-1.6 8V3.5a1.6 1.6 0 0 1 3.2 0V8z', class: 'rw-fort-door' }, fort);
      const body = svgEl('g', { class: 'rw-tok-body' }, g);
      svgEl('circle', { r: 15, class: 'rw-tok-disc' }, body);
      svgEl('circle', { r: 11.5, class: 'rw-tok-ring' }, body);
      svgEl('text', { y: 1, class: 'rw-n' }, g);
      const emb = svgEl('g', { class: 'rw-emb', transform: 'translate(12 -11)' }, g);
      svgEl('circle', { r: 6.5 }, emb);
      svgEl('text', { y: 0.5 }, emb);
      svgEl('text', { y: 29, class: 'rw-name' }, g).textContent = name;
      svgEl('text', { y: -17, class: 'rw-crown' }, g);
    });
    svgEl('g', { id: 'rwBounty', class: 'rw-bounty' }, svg);
    // the whole land is the tap target, and its outline shows what you can do with it
    const hits = svgEl('g', { class: 'rw-hits' }, svg);
    paths.forEach((d, i) => {
      const h = svgEl('path', { d, class: 'rw-node', 'data-i': i }, hits);
      h.addEventListener('click', () => tap(i));
    });
    svgEl('rect', { x: 3, y: 3, width: W - 6, height: H - 6, rx: 14, class: 'rw-frame' }, svg);
    built = m.map.key;
    colours = ''; stormKey = '';
    vb = { x: 0, y: 0, w: W, h: H };
    setVB(0, 0, W);
    autoZoomed = false;
  }

  // a big map on a phone opens zoomed in on your own lands, once you have some
  function autoZoom(m) {
    if (autoZoomed || m.map.key !== 'grand' || m.me == null || m.phase === 'claim') return;
    const L = m.map.lands, mine = L.filter((_, i) => m.owner[i] === m.me);
    const wide = $('rwWrap').getBoundingClientRect().width;
    if (!mine.length || !wide) return;
    autoZoomed = true;
    if (wide >= 560) return;
    const cx = mine.reduce((s, l) => s + l[2], 0) / mine.length, cy = mine.reduce((s, l) => s + l[3], 0) / mine.length;
    const w = W / 1.6;
    tweenVB(cx - w / 2, cy - w * H / W / 2, w, 600);
  }

  // one bevelled gradient per seat colour
  function grads(m) {
    const key = m.seats.map((pid) => ctx.player(pid)?.color).join();
    if (key === colours) return;
    colours = key;
    const box = $('rwGrads'); box.replaceChildren();
    const make = (id, c) => {
      const g = svgEl('radialGradient', { id, cx: '35%', cy: '30%', r: '80%' }, box);
      svgEl('stop', { offset: '0', 'stop-color': mix(c, [255, 255, 255], 0.55) }, g);
      svgEl('stop', { offset: '.55', 'stop-color': c }, g);
      svgEl('stop', { offset: '1', 'stop-color': mix(c, [0, 0, 0], 0.45) }, g);
    };
    m.seats.forEach((_, k) => make(`rwG${k}`, colourOf(m, k)));
    make('rwGN', '#8a8a92');
  }

  const stormed = (m, a, b) => !m.runner && (m.storms || []).some(([x, y]) => x === Math.min(a, b) && y === Math.max(a, b));
  const adjAll = (m, i) => m.map.links.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a));
  const adj = (m, i) => adjAll(m, i).filter((j) => !stormed(m, i, j));
  function reach(m, f) {
    const me = m.me, seen = new Set([f]), todo = [f];
    while (todo.length) { const x = todo.pop(); for (const y of adj(m, x)) if (!seen.has(y) && m.owner[y] === me) { seen.add(y); todo.push(y); } }
    seen.delete(f);
    return seen;
  }
  const mineTurn = () => ctx.myTurn && S.phase === 'playing' && S.realm.me != null;
  const canAttackFrom = (m, i) => m.owner[i] === m.me && m.troops[i] >= 2 && adj(m, i).some((j) => m.owner[j] !== m.me);

  function tap(i) {
    if (suppress) return;
    const m = S?.realm;
    hideInfo();
    if (!m || !mineTurn()) return;
    const own = m.owner[i] === m.me;
    if (m.phase === 'claim') {
      if (m.owner[i] !== -1) return ctx.toast('That land is taken.');
      return ctx.quiet(ctx.act('claim', { land: i }));
    }
    if (m.phase === 'draft') {
      if (m.mustTrade) return ctx.toast('You hold 5 banners: trade a set first.');
      if (!own) return ctx.toast('Place troops on your own lands.');
      if (fortMode) {
        fortMode = false;
        if (m.forts.includes(i)) { paint(); return ctx.toast('That land already has a fort.'); }
        return ctx.quiet(ctx.act('fort', { land: i }));
      }
      const n = amt === 99 ? m.reserve : Math.min(amt, m.reserve);
      return ctx.quiet(ctx.act('place', { land: i, n }));
    }
    if (m.phase === 'attack') {
      if (own) { sel = m.troops[i] >= 2 && sel !== i ? i : null; tgt = null; return paint(); }
      if (sel != null && adj(m, sel).includes(i)) { tgt = i; return paint(); }
      if (sel != null && adjAll(m, sel).includes(i)) { ctx.toast('⛈️ A storm closes that sea lane this round.'); return; }
      sel = null; tgt = null; return paint();
    }
    if (m.phase === 'fortify') {
      if (own && sel != null && sel !== i && reach(m, sel).has(i)) { tgt = i; moveN = m.troops[sel] - 1; return paint(); }
      if (own && m.troops[i] >= 2 && sel !== i) { sel = i; tgt = null; return paint(); }
      sel = null; tgt = null; paint();
    }
  }

  // a curved arrow between two tokens; kind: atk | fort; flash = fades out on its own
  function arrow(m, f, t, kind, flash = false) {
    const box = $('rwArrows');
    if (!flash) box.querySelectorAll('.rw-arrow:not(.flash)').forEach((e) => e.remove());
    if (f == null || t == null) return;
    const { d } = curve(m, f, t);
    const g = svgEl('g', { class: `rw-arrow ${kind}${flash ? ' flash' : ''}` }, box);
    svgEl('path', { d, class: 'rw-arrow-under' }, g);
    svgEl('path', { d, class: 'rw-arrow-line', 'marker-end': `url(#${kind === 'fort' ? 'rwHeadF' : 'rwHeadR'})` }, g);
    if (flash) setTimeout(() => g.remove(), 1600);
  }

  function burst(m, i, colour, big) {
    if (!motion()) return;
    const [, , x, y] = m.map.lands[i], box = $('rwArrows');
    const g = svgEl('g', { class: 'rw-burst' + (big ? ' big' : ''), transform: `translate(${x} ${y})` }, box);
    for (let k = 0; k < (big ? 3 : 1); k++) {
      const c = svgEl('circle', { r: 16 }, g);
      c.style.stroke = colour; c.style.animationDelay = `${k * 140}ms`;
    }
    for (let k = 0; k < 8; k++) {  // sparks
      const a = (k / 8) * Math.PI * 2 + Math.random() * 0.4;
      const s = svgEl('line', { x1: (Math.cos(a) * 12).toFixed(1), y1: (Math.sin(a) * 12).toFixed(1), x2: (Math.cos(a) * 19).toFixed(1), y2: (Math.sin(a) * 19).toFixed(1), class: 'rw-spark' }, g);
      s.style.setProperty('--dx', `${(Math.cos(a) * 14).toFixed(1)}px`); s.style.setProperty('--dy', `${(Math.sin(a) * 14).toFixed(1)}px`);
    }
    setTimeout(() => g.remove(), 1000);
  }

  // troops walking along the curve; the target's count waits for them
  function march(m, f, t, n, colour, delay = 0) {
    if (!motion() || !n) return;
    const before = m.troops[t] - n;
    if (!holding.has(t)) holding.set(t, before);
    marching.add(t);
    delay = Math.max(delay, playEnd - now() + 120);
    const { at } = curve(m, f, t, 12, 14), box = $('rwArrows'), dots = Math.min(5, n), dur = 560;
    setTimeout(() => {
      holding.set(t, before);
      setTokText(t, before);
      follow(m, [f, t]);
      const g = svgEl('g', { class: 'rw-march' }, box), list = [];
      for (let k = 0; k < dots; k++) {
        const c = svgEl('circle', { r: 5.5 }, g);
        c.style.fill = colour;
        list.push(c);
      }
      const t0 = now();
      const step = () => {
        const el = now() - t0;
        list.forEach((c, k) => {
          const u = Math.max(0, Math.min(1, (el - k * 70) / dur)), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
          const [x, y] = at(e);
          c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1));
          c.style.opacity = u <= 0 || u >= 1 ? '0' : '1';
        });
        if (el < dur + dots * 70) return raf(step);
        g.remove();
        holding.delete(t);
        marching.delete(t);
        tickTo(t, S.realm.troops[t]);
        pop(t);
      };
      raf(step);
    }, delay);
  }

  // a flag goes up on a land that changed hands
  function plant(m, i, colour) {
    if (!motion()) return;
    const [, , x, y] = m.map.lands[i];
    const g = svgEl('g', { class: 'rw-flag', transform: `translate(${x + 9} ${y - 12})` }, $('rwArrows'));
    svgEl('line', { x1: 0, y1: 0, x2: 0, y2: -20, class: 'rw-flag-pole' }, g);
    const f = svgEl('path', { d: 'M0 -20L13 -16L0 -12Z', class: 'rw-flag-cloth' }, g);
    f.style.fill = colour;
    setTimeout(() => g.remove(), 1900);
    const tintP = $(`rwTint${i}`);
    tintP?.classList.add('flash');
    setTimeout(() => tintP?.classList.remove('flash'), 800);
  }

  function setTokText(i, n) {
    ticks.delete(i);
    const t = $(`rwTok${i}`)?.querySelector('.rw-n');
    if (t) t.textContent = n;
  }
  // troop counts count up or down instead of jumping
  function tickTo(i, n) {
    const t = $(`rwTok${i}`)?.querySelector('.rw-n');
    if (!t) return;
    const job = ticks.get(i);
    if (job) { job.to = n; return; }
    const from = parseInt(t.textContent, 10);
    if (!motion() || Number.isNaN(from) || from === n || Math.abs(from - n) > 80) { t.textContent = n; return; }
    const me = { to: n, t0: now() };
    ticks.set(i, me);
    const step = () => {
      if (ticks.get(i) !== me) return;
      const u = Math.min(1, (now() - me.t0) / 320);
      t.textContent = Math.round(from + (me.to - from) * u);
      if (u < 1) raf(step); else { t.textContent = me.to; ticks.delete(i); }
    };
    raf(step);
  }
  function lunge(f, t, m) {
    const g = $(`rwTok${f}`);
    if (!g?.animate || !motion()) return;
    const [, , x1, y1] = m.map.lands[f], [, , x2, y2] = m.map.lands[t], d = Math.hypot(x2 - x1, y2 - y1) || 1;
    const dx = ((x2 - x1) / d * 9).toFixed(1), dy = ((y2 - y1) / d * 9).toFixed(1);
    g.animate([{ translate: '0px 0px' }, { translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 230, easing: 'ease-out' });
  }
  function shake(i) {
    const g = $(`rwTok${i}`)?.querySelector('.rw-tok-body');
    if (!g?.animate || !motion()) return;
    g.animate([{ translate: '0px 0px' }, { translate: '-3px 0px' }, { translate: '3px 0px' }, { translate: '-2px 0px' }, { translate: '0px 0px' }], { duration: 240 });
  }
  // a ribbon in the player's colour sweeps over the map when the turn passes
  function banner(text, colour) {
    if (!motion()) return;
    const b = ctx.el('div', 'rw-banner', text);
    b.style.setProperty('--c', colour);
    $('rwWrap').append(b);
    setTimeout(() => b.remove(), 1700);
  }
  // a ripple across a newly held island, nearest land first
  function ripple(m, k, from) {
    if (!motion()) return;
    const L = m.map.lands, [, , x0, y0] = L[from] ?? L[0];
    m.map.lands.map((l, i) => [i, l]).filter(([, l]) => l[1] === k)
      .sort((a, b) => Math.hypot(a[1][2] - x0, a[1][3] - y0) - Math.hypot(b[1][2] - x0, b[1][3] - y0))
      .forEach(([i], j) => setTimeout(() => {
        const p = $(`rwTint${i}`);
        p?.classList.add('ripple'); pop(i);
        setTimeout(() => p?.classList.remove('ripple'), 700);
      }, j * 90));
  }
  // a new banner card flies from the map into your hand
  function flyCard(card) {
    if (!card || !motion() || typeof Kit === 'undefined' || !Kit.fly) return;
    const r = $('rwMap').getBoundingClientRect();
    const ghost = ctx.el('span', card.className, card.textContent);
    Object.assign(ghost.style, { position: 'fixed', left: `${r.left + r.width / 2 - 20}px`, top: `${r.top + r.height / 2 - 27}px`, zIndex: 30 });
    document.body.append(ghost);
    card.style.opacity = '0';
    Kit.fly(ghost, card, { ms: 700 });
    ghost.remove();
    setTimeout(() => { card.style.opacity = ''; }, 700);
  }

  function storms(m) {
    const key = JSON.stringify(m.storms || []);
    document.querySelectorAll('#rwMap .rw-sealane').forEach((p) => p.classList.toggle('storm', (m.storms || []).some(([a, b]) => p.dataset.lane === `${a}-${b}`)));
    $('rwStorms').classList.toggle('parted', !!m.runner);
    if (key === stormKey) return;
    const arriving = stormKey !== '' && motion();
    stormKey = key;
    const box = $('rwStorms');
    if (arriving) {  // the old clouds blow away, the new ones roll in from the edge
      box.querySelectorAll('.rw-storm').forEach((g) => { g.classList.add('leaving'); setTimeout(() => g.remove(), 700); });
    } else box.replaceChildren();
    for (const [a, b] of m.storms || []) {
      const [x, y] = laneMid(m, a, b);
      const g = svgEl('g', { class: 'rw-storm' + (arriving ? ' arriving' : ''), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, box);
      const drift = svgEl('g', { class: 'rw-storm-drift' }, svgEl('g', { class: 'rw-storm-in' }, g));
      svgEl('path', { d: 'M-14 5a6 6 0 0 1 1-12a8 8 0 0 1 15-2a6.5 6.5 0 0 1 11 6a5 5 0 0 1-2 8z', class: 'rw-cloud' }, drift);
      svgEl('path', { d: 'M1 4l-5 9h4l-2 8l7-11h-4l2-6z', class: 'rw-bolt' }, drift);
    }
  }

  function paint() {
    const m = S.realm;
    if (built !== m.map.key) build(m);
    grads(m);
    storms(m);
    const mine = mineTurn();
    if (m.phase !== 'draft') fortMode = false;
    // drop a stale pick: a land that changed hands or ran low
    if (sel != null && (m.owner[sel] !== m.me || m.troops[sel] < 2 || !['attack', 'fortify'].includes(m.phase) || !mine)) { sel = null; tgt = null; }
    if (tgt != null && (m.phase === 'attack' && m.owner[tgt] === m.me)) tgt = null;
    const targets = new Set();
    if (mine && sel != null) {
      if (m.phase === 'attack') adj(m, sel).filter((y) => m.owner[y] !== m.me).forEach((y) => targets.add(y));
      if (m.phase === 'fortify') reach(m, sel).forEach((y) => targets.add(y));
    }
    const last = m.last || {};
    const forts = new Set(m.forts || []);
    m.owner.forEach((o0, i) => {
      const o = holdOwner.has(i) ? holdOwner.get(i) : o0;
      const c = colourOf(m, o);
      const tintP = $(`rwTint${i}`);
      tintP.style.fill = c;
      tintP.classList.toggle('neutral', o < 0);
      tintP.classList.toggle('free', o < 0 && m.phase === 'claim');
      const tok = $(`rwTok${i}`);
      tok.classList.toggle('empty', m.troops[i] <= 0 && o < 0);
      tok.querySelector('.rw-tok-disc').setAttribute('fill', o >= 0 ? `url(#rwG${o})` : 'url(#rwGN)');
      const n = m.troops[i];
      tickTo(i, holding.has(i) ? holding.get(i) : n);
      tok.querySelector('.rw-tok-body').setAttribute('transform', `scale(${(1 + Math.min(0.35, Math.log2(Math.max(1, n)) * 0.07)).toFixed(3)})`);
      const shape = o >= 0 ? shapeOf(c) : '';
      const emb = tok.querySelector('.rw-emb');
      emb.querySelector('text').textContent = shape; emb.querySelector('text').style.fill = c;
      emb.style.display = shape ? '' : 'none';
      tok.querySelector('.rw-fort').style.display = forts.has(i) ? '' : 'none';
      tok.querySelector('.rw-crown').textContent = m.capitals && m.capitals.includes(i) ? '👑' : '';
      tok.classList.toggle('sel', i === sel);
      tok.classList.toggle('mine', o === m.me);
      const can = mine && (m.phase === 'claim' ? o === -1
        : m.phase === 'draft' ? o === m.me && !m.mustTrade && !(fortMode && forts.has(i))
          : m.phase === 'attack' ? (o === m.me && m.troops[i] >= 2) || targets.has(i)
            : m.phase === 'fortify' ? (o === m.me && m.troops[i] >= 2) || targets.has(i) : false);
      const h = document.querySelector(`#rwMap .rw-node[data-i="${i}"]`);
      h.setAttribute('class', 'rw-node' + (o === m.me ? ' mine' : '') + (can ? ' can' : '') + (i === sel ? ' sel' : '')
        + (i === tgt ? ' tgt' : '') + (targets.has(i) ? ' target' : '') + (m.phase === 'fortify' ? ' fort' : '')
        + (fortMode && can ? ' building' : '') + ((last.to === i || last.from === i) && !mine ? ' last' : '')
        + ((m.shield || []).includes(o) ? ' shielded' : ''));
    });
    lensLayer(m);
    adviceLayer(m, mine);
    bountyLayer(m);
    // a whole island's beach in its ruler's colour
    const held = {};
    m.isles.forEach((ks, seat) => ks.forEach((k) => { held[k] = seat; }));
    document.querySelectorAll('#rwBeach path').forEach((p) => {
      const seat = held[p.dataset.k];
      p.classList.toggle('held', seat != null);
      p.style.stroke = seat != null ? colourOf(m, seat) : '';
      p.style.fill = seat != null ? colourOf(m, seat) : '';
    });
    $('rwMap').classList.toggle('picking', mine && sel != null);
    arrow(m, mine ? sel : null, mine ? tgt : null, m.phase === 'fortify' ? 'fort' : 'atk');
    steps(m, mine);
    bar(m, mine);
  }

  // 💰 the round's bounty: a coin over the land and a gold ring
  function bountyLayer(m) {
    const key = `${m.bounty}`;
    if (key === bountyKey) return;
    const box = $('rwBounty'), had = bountyKey !== '';
    bountyKey = key;
    box.replaceChildren();
    if (m.bounty == null) return;
    const [, , x, y] = m.map.lands[m.bounty];
    const g = svgEl('g', { class: 'rw-bounty-mark' + (had && motion() ? ' drop' : ''), transform: `translate(${x} ${y})` }, box);
    svgEl('circle', { r: 22, class: 'rw-bounty-ring' }, g);
    const coin = svgEl('g', { class: 'rw-coin', transform: 'translate(15 11)' }, g);
    svgEl('circle', { r: 8 }, coin);
    svgEl('text', { y: 0.5 }, coin).textContent = '$';
  }

  // 🧭 lenses: 1 = strongest reachable current stack against your lands, 2 = island progress
  function lensLayer(m) {
    const box = $('rwLens'), tag = $('rwLensTag'), btn = $('rwLensBtn');
    box.replaceChildren();
    const on = lens && m.me != null && m.phase !== 'claim';
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', String(!!on));
    tag.hidden = !on;
    document.querySelectorAll('#rwMap .rw-isle-name').forEach((t) => {
      const k = +t.dataset.k, [name, bonus] = m.map.islands[k];
      const ls = m.map.lands.filter((l) => l[1] === k).length;
      const have = m.map.lands.filter((l, i) => l[1] === k && m.owner[i] === m.me).length;
      t.textContent = on && lens === 2 ? `${name.toUpperCase()} ${have}/${ls} +${bonus}` : `${name.toUpperCase()} +${bonus}`;
      t.classList.toggle('mine', !!(on && lens === 2 && have === ls));
    });
    if (!on) return;
    tag.textContent = lens === 1 ? '🧭 Next-turn risk: strongest current enemy stack; storms, forts and shields count. Future draft troops are not included.' : '🧭 Islands: your share of each';
    m.owner.forEach((o, i) => {
      const [, , x, y] = m.map.lands[i];
      if (lens === 1) {
        if (o !== m.me) return;
        const enemies = adj(m, i).filter((j) => m.owner[j] >= 0 && m.owner[j] !== m.me && m.troops[j] > 1);
        const guard = m.forts.includes(i) || (m.shield || []).includes(m.me);
        const best = enemies.map((j) => ({ land: j, spare: m.troops[j] - 1,
          odds: winChance(m.troops[j] - 1, m.troops[i], guard) }))
          .sort((a, b) => b.odds - a.odds || b.spare - a.spare)[0];
        if (!best) return;
        const p = svgEl('path', { d: cellPaths[i], class: 'rw-lens-threat' }, box);
        p.style.opacity = (0.18 + 0.44 * best.odds).toFixed(2);
        const t = svgEl('text', { x: x - 18, y: y + 17, class: 'rw-threat' + (best.odds >= 0.5 ? ' hot' : '') }, box);
        const chance = Math.round(100 * best.odds);
        t.textContent = `⚠${chance}%`;
        svgEl('title', {}, t).textContent = `${m.map.lands[best.land][0]}: ${best.spare} attacking troops can reach this land. Estimated conquest chance ${chance}% with current stacks; ${guard ? 'fort/shield included' : 'no fort/shield bonus'}. Unplaced draft troops are excluded.`;
      } else if (o !== m.me) {
        svgEl('path', { d: cellPaths[i], class: 'rw-lens-dim' }, box);
      }
    });
  }

  // 💡 the advisor's suggestion, drawn in gold
  function adviceLayer(m, mine) {
    const box = $('rwAdvice');
    box.replaceChildren();
    const a = m.advice;
    if (!advise || !mine || !a) return;
    const ring = (i) => {
      const [, , x, y] = m.map.lands[i];
      svgEl('circle', { cx: x, cy: y, r: 24, class: 'rw-adv-ring' }, box);
    };
    const line = (f, t) => {
      const { d } = curve(m, f, t);
      svgEl('path', { d, class: 'rw-adv-arrow' }, box);
    };
    if ((a.kind === 'attack' || a.kind === 'fortify') && a.from != null) { line(a.from, a.to); ring(a.from); }
    else if (a.kind === 'place' && a.to != null) { ring(a.land); line(a.land, a.to); }
    else if (a.land != null) ring(a.land);
    else if (a.kind === 'occupy' && m.pending) line(m.pending.from, m.pending.to);
  }

  function doAdvice(m) {
    const a = m.advice;
    if (!a) return;
    if (a.kind === 'claim') return ctx.quiet(ctx.act('claim', { land: a.land }));
    if (a.kind === 'trade') return ctx.quiet(ctx.act('trade'));
    if (a.kind === 'fort') return ctx.quiet(ctx.act('fort', { land: a.land }));
    if (a.kind === 'place') return ctx.quiet(ctx.act('place', { land: a.land, n: a.n }));
    if (a.kind === 'attack') { sel = a.from; tgt = a.to; return paint(); }
    if (a.kind === 'stop') { sel = null; tgt = null; return ctx.quiet(ctx.act('stop')); }
    if (a.kind === 'occupy') return ctx.quiet(ctx.act('occupy', { n: a.n }));
    if (a.kind === 'fortify') { sel = a.from; tgt = a.to; moveN = a.n; return paint(); }
    return ctx.quiet(ctx.act('end'));
  }

  function playGambit(name) {
    const [icon, title, what] = GAMBIT[name];
    ctx.ask(`${what[0].toUpperCase()}${what.slice(1)}. You can play each gambit once a game.`, { title: `${icon} ${title}`, ok: 'Play it' })
      .then((ok) => { if (ok) ctx.quiet(ctx.act('gambit', { name })); });
  }

  function gambitOk(m, name) {
    const ph = m.phase;
    if (ph === 'claim' || ph === 'occupy') return false;
    if (name === 'muster') return ph === 'draft' && !m.mustered && !m.mustTrade;
    if (name === 'shield') return !(m.shield || []).includes(m.me);
    if (name === 'march') return m.marches < 2;
    if (name === 'runner') return (m.storms || []).length > 0 && !m.runner && ph !== 'fortify';
    return false;
  }

  function steps(m, mine) {
    const box = $('rwSteps'); box.replaceChildren();
    if (S.phase !== 'playing') { $('rwStatus').textContent = ''; return; }
    const who = ctx.player(S.turn);
    const tag = ctx.el('span', 'rw-who', mine ? 'You' : who?.name ?? '?');
    tag.style.setProperty('--c', who?.color ?? '#888');
    box.append(tag);
    if (m.phase === 'claim') {
      const left = m.owner.filter((o) => o === -1).length;
      box.append(ctx.el('span', 'rw-step-chip on', `🚩 Claim · ${left} free`));
    } else {
      const ph = m.phase === 'occupy' ? 'attack' : m.phase, order = ['draft', 'attack', 'fortify'];
      [['draft', '🪖 Draft'], ['attack', '⚔️ Attack'], ['fortify', '🛡️ Fortify']].forEach(([k, t], j) => {
        const idx = order.indexOf(ph);
        box.append(ctx.el('span', 'rw-step-chip' + (k === ph ? ' on' : j < idx ? ' done' : ''), t + (k === 'draft' && ph === 'draft' ? ` · ${m.reserve}` : '')));
      });
    }
    let t;
    if (!mine) t = `${who?.name ?? '?'} is ${{ claim: 'picking a land', draft: 'drafting troops', attack: 'on the attack', occupy: 'moving in', fortify: 'fortifying' }[m.phase] || 'playing'}…`;
    else if (m.phase === 'claim') t = '🚩 Tap a free land to claim it. Whole islands pay a bonus every turn.';
    else if (m.phase === 'draft') t = m.mustTrade ? '🎴 You hold 5 banners: trade a set first.' : fortMode ? `🏰 Tap one of your lands to fort it (${m.fortCost} troops).` : `Place ${m.reserve} troop${m.reserve === 1 ? '' : 's'}: tap your lands.`;
    else if (m.phase === 'attack') t = sel == null ? 'Tap one of your lands (2+ troops) to attack from.' : tgt == null ? '🎯 Now tap a rival land next to it.' : 'Roll once, or blitz until it falls.';
    else if (m.phase === 'occupy') t = '🚶 Land taken! How many troops move in?';
    else t = sel == null ? 'Tap a land to move troops from, or end your turn.' : tgt == null ? 'Tap a land joined to it through yours.' : 'Choose how many to move.';
    $('rwStatus').textContent = t;
  }

  function btn(text, cls, fn, disabled = false) {
    const b = ctx.el('button', cls, text);
    b.onclick = fn; b.disabled = disabled;
    return b;
  }

  function stepper(lo, hi, label, go) {
    moveN = Math.max(lo, Math.min(hi, moveN ?? hi));
    const wrap = ctx.el('div', 'row center rw-step');
    const minus = btn('−', '', () => { moveN = Math.max(lo, moveN - 1); paint(); }, moveN <= lo);
    const plus = btn('+', '', () => { moveN = Math.min(hi, moveN + 1); paint(); }, moveN >= hi);
    const ok = btn(`${label} ${moveN}`, 'primary', () => { const n = moveN; moveN = null; go(n); });
    wrap.append(minus, ctx.el('b', 'rw-num', String(moveN)), plus, ok);
    return wrap;
  }

  function oddsBar(p, fort) {
    const wrap = ctx.el('div', 'rw-odds'), fill = ctx.el('i');
    fill.style.width = `${p}%`;
    fill.style.background = p >= 70 ? '#51cf66' : p >= 45 ? '#fcc419' : '#ff6b6b';
    wrap.append(fill, ctx.el('b', '', `${p}% to take it${fort ? ' · 🏰 +1 to defence' : ''}`));
    return wrap;
  }

  const undoBtn = (m) => (m.canUndo ? btn('↶ Undo', '', () => ctx.quiet(ctx.act('unplace'))) : null);

  function bar(m, mine) {
    const box = $('rwBar');
    box.replaceChildren();
    if (!mine) return;
    const L = (i) => m.map.lands[i][0];
    // 💡 the advisor: a suggestion with its reason, and a button to follow it
    const adv = ctx.el('div', 'rw-advbox' + (advise ? ' open' : ''));
    const tog = btn(advise ? '💡 Advisor' : '💡 Advice', 'rw-advtog' + (advise ? ' on' : ''), () => { advise = !advise; try { localStorage.setItem('rwAdvise', advise ? '1' : '0'); } catch {} paint(); });
    tog.setAttribute('aria-pressed', String(advise));
    if (S.hintsOk) adv.append(tog);
    if (advise && m.advice) {
      const body = ctx.el('div', 'rw-advbody');
      body.append(ctx.el('span', 'rw-advwhy', m.advice.why || ''));
      const label = { claim: 'Claim it', trade: 'Trade', fort: 'Fort it', place: `Place ${m.advice.n ?? ''}`, attack: 'Aim', stop: 'Fortify →', occupy: `Move ${m.advice.n ?? ''}`, fortify: 'Set it up', end: 'End turn' }[m.advice.kind] || 'Do it';
      body.append(btn(`✓ ${label}`, 'rw-advdo', () => doAdvice(m)));
      adv.append(body);
      if (m.gambitHint) {
        const g = GAMBIT[m.gambitHint.name];
        const idea = ctx.el('div', 'rw-advbody idea');
        idea.append(ctx.el('span', 'rw-advwhy', `${g[0]} ${m.gambitHint.why}`), btn(`${g[0]} ${g[1]}`, 'rw-advdo', () => playGambit(m.gambitHint.name)));
        adv.append(idea);
      }
    }
    box.append(adv);
    // 🎺 gambits still in hand
    const held = m.gambitsOn && m.me != null ? (m.gambits?.[m.me] || []) : [];
    if (held.length && m.phase !== 'claim') {
      const row = ctx.el('div', 'row center rw-gambits');
      for (const name of held) {
        const [icon, title, what] = GAMBIT[name];
        const b = btn(`${icon} ${title}`, 'rw-gambit', () => playGambit(name), !gambitOk(m, name));
        b.title = what;
        row.append(b);
      }
      box.append(row);
    }
    if (m.phase === 'claim') return;
    if (m.phase === 'draft') {
      const row = ctx.el('div', 'row center seg rw-amt');
      for (const [v, t] of [[1, '+1'], [3, '+3'], [99, 'All']]) {
        const b = btn(t, v === amt && !fortMode ? 'on' : '', () => { amt = v; fortMode = false; try { localStorage.setItem('rwAmt', v); } catch {} paint(); });
        b.setAttribute('aria-pressed', String(v === amt && !fortMode));
        row.append(b);
      }
      if (m.fortsOn) {
        const f = btn(`🏰 Fort (${m.fortCost})`, fortMode ? 'on' : '', () => { fortMode = !fortMode; paint(); },
          m.fortBuilt || m.reserve < m.fortCost || m.mustTrade);
        f.setAttribute('aria-pressed', String(fortMode));
        f.title = m.fortBuilt ? 'One fort per turn' : `Spend ${m.fortCost} troops: the defender's best die gets +1 here`;
        row.append(f);
      }
      box.append(row);
      const row2 = ctx.el('div', 'row center');
      if (m.canTrade) row2.append(btn(`🎴 Trade banners (+${m.tradeValue})`, m.mustTrade ? 'primary' : '', () => ctx.quiet(ctx.act('trade'))));
      const u = undoBtn(m); if (u) row2.append(u);
      if (row2.childElementCount) box.append(row2);
    } else if (m.phase === 'attack') {
      if (sel != null && tgt != null) {
        const fort = m.forts.includes(tgt);
        box.append(ctx.el('div', 'hint', `${L(sel)} (${m.troops[sel]}) → ${L(tgt)} (${m.troops[tgt]})`));
        box.append(oddsBar(Math.round(100 * winChance(m.troops[sel] - 1, m.troops[tgt], fort)), fort));
        const row = ctx.el('div', 'row center');
        row.append(btn('🎲 Roll', 'primary', () => ctx.quiet(ctx.act('attack', { from: sel, to: tgt, blitz: false }))),
          btn('⚡ Blitz', '', () => ctx.quiet(ctx.act('attack', { from: sel, to: tgt, blitz: true }))));
        box.append(row);
      }
      const row = ctx.el('div', 'row center');
      const u = undoBtn(m); if (u) row.append(u);
      row.append(btn('🛡️ Fortify →', '', () => { sel = null; tgt = null; ctx.quiet(ctx.act('stop')); }),
        btn('End turn', '', () => ctx.quiet(ctx.act('end'))));
      box.append(row);
    } else if (m.phase === 'occupy' && m.pending) {
      const pd = m.pending;
      box.append(ctx.el('div', 'hint', `${L(pd.from)} → ${L(pd.to)}`));
      box.append(stepper(pd.min, pd.max, 'Move in', (n) => ctx.quiet(ctx.act('occupy', { n }))));
    } else if (m.phase === 'fortify') {
      if (sel != null && tgt != null) {
        box.append(ctx.el('div', 'hint', `${L(sel)} → ${L(tgt)}`));
        box.append(stepper(1, m.troops[sel] - 1, 'Move', (n) => { const f = sel, t = tgt; sel = null; tgt = null; ctx.quiet(ctx.act('fortify', { from: f, to: t, n })); }));
      }
      box.append(btn('End turn', sel == null ? 'primary' : '', () => ctx.quiet(ctx.act('end'))));
    }
  }

  // -- the chronicle: lands held at the start of each round, one 2px line per realm, the live count last
  function chronicle(m) {
    const box = $('rwChron');
    const rows = [...(m.hist || [])];
    const live = m.seats.map((_, k) => m.owner.filter((o) => o === k).length);
    if (m.phase !== 'claim') rows.push(live);
    box.replaceChildren();
    if (rows.length < 2) { box.append(ctx.el('p', 'hint left', 'The story of the war draws itself here, round by round.')); return; }
    const VW = 300, VH = 132, pl = 26, pr = 30, pt = 8, pb = 20;
    const peak = Math.max(1, ...rows.flat());
    const N = Math.min(m.owner.length, Math.max(4, Math.ceil(peak * 1.25 / 2) * 2)), n = rows.length;
    const X = (i) => pl + (VW - pl - pr) * (n === 1 ? 0 : i / (n - 1)), Y = (v) => pt + (VH - pt - pb) * (1 - v / N);
    const svg = svgEl('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'rw-chart', role: 'img', 'aria-label': 'Lands held each round' });
    for (const v of [0, Math.round(N / 2), N]) {
      svgEl('line', { x1: pl, x2: VW - pr, y1: Y(v), y2: Y(v), class: 'rw-grid' }, svg);
      svgEl('text', { x: pl - 5, y: Y(v) + 3.5, class: 'rw-axis', 'text-anchor': 'end' }, svg).textContent = v;
    }
    svgEl('text', { x: pl, y: VH - 5, class: 'rw-axis' }, svg).textContent = 'Round 1';
    svgEl('text', { x: VW - pr, y: VH - 5, class: 'rw-axis', 'text-anchor': 'end' }, svg).textContent = m.phase === 'claim' || S.phase !== 'playing' ? `Round ${n}` : 'now';
    const label = m.seats.length <= 4;
    const ends = [];
    m.seats.forEach((pid, k) => {
      const c = colourOf(m, k);
      const pts = rows.map((r, i) => `${X(i).toFixed(1)},${Y(r[k] ?? 0).toFixed(1)}`).join(' ');
      const line = svgEl('polyline', { points: pts, class: 'rw-line' }, svg);
      line.style.stroke = c;
      const v = rows[n - 1][k] ?? 0;
      const dot = svgEl('circle', { cx: X(n - 1), cy: Y(v), r: 4, class: 'rw-dot' }, svg);
      dot.style.fill = c;
      ends.push([Y(v), v, k]);
    });
    if (label) {  // direct labels at the line ends, nudged apart so they never overlap
      ends.sort((a, b) => a[0] - b[0]);
      const ys = ends.map(([y]) => y + 3.5);
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + 11);  // push apart downwards
      const floor = VH - pb + 2;
      for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], i === ys.length - 1 ? floor : ys[i + 1] - 11);  // then up off the floor
      ends.forEach(([, v, k], i) => {
        const t = svgEl('text', { x: VW - pr + 7, y: ys[i].toFixed(1), class: 'rw-endlab' }, svg);
        t.textContent = v;
      });
    }
    // hover / tap: a crosshair and the round's numbers
    const cross = svgEl('line', { y1: pt, y2: VH - pb, class: 'rw-cross' }, svg);
    cross.style.display = 'none';
    const tip = ctx.el('div', 'rw-tip');
    tip.hidden = true;
    const hit = svgEl('rect', { x: pl, y: 0, width: VW - pl - pr, height: VH - pb, class: 'rw-chart-hit' }, svg);
    const show = (e) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const fx = ((e.clientX - r.left) / r.width) * VW;
      const i = Math.max(0, Math.min(n - 1, Math.round(((fx - pl) / (VW - pl - pr)) * (n - 1))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.style.display = '';
      tip.replaceChildren(ctx.el('b', '', i === n - 1 && m.phase !== 'claim' && S.phase === 'playing' ? 'Now' : `Round ${i + 1}`));
      m.seats.map((pid, k) => [rows[i][k] ?? 0, k, pid]).sort((a, b) => b[0] - a[0]).forEach(([v, k, pid]) => {
        const row = ctx.el('div', 'rw-tip-row'), sw = ctx.el('span', 'rw-sw', shapeOf(colourOf(m, k)) || '●');
        sw.style.color = colourOf(m, k);
        row.append(sw, ctx.el('span', '', `${ctx.player(pid)?.name ?? '?'} `), ctx.el('b', '', String(v)));
        tip.append(row);
      });
      tip.hidden = false;
      tip.style.left = `${Math.max(0, Math.min(r.width - 150, (X(i) / VW) * r.width - 75))}px`;
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.hidden = true; });
    const legend = ctx.el('div', 'rw-legend');
    m.seats.forEach((pid, k) => {
      const it = ctx.el('span', 'rw-leg'), sw = ctx.el('span', 'rw-sw', shapeOf(colourOf(m, k)) || '●');
      sw.style.color = colourOf(m, k);
      it.append(sw, ctx.el('span', '', ctx.player(pid)?.name ?? '?'));
      legend.append(it);
    });
    const wrap = ctx.el('div', 'rw-chart-wrap');
    wrap.append(svg, tip);
    box.append(wrap, legend);
  }

  function side(m) {
    $('rwRound').textContent = m.phase === 'claim' ? '🚩 Claiming the map' : `Round ${m.round}${m.limit ? ` of ${m.limit}` : ''} · ${m.goal === 'capitals' ? '👑 hold every capital' : 'rule the whole map'}`;
    // share of the map: one bar split by ruler
    const pow = $('rwPower'); pow.replaceChildren();
    m.seats.forEach((pid, k) => {
      const n = m.owner.filter((o) => o === k).length;
      if (!n) return;
      const seg = ctx.el('i', '', String(n)); seg.style.flexGrow = n; seg.style.background = colourOf(m, k);
      seg.title = `${ctx.player(pid)?.name ?? '?'}: ${n}`;
      pow.append(seg);
    });
    const mark = $('rwDomMark'), dtxt = $('rwDomTxt');
    mark.hidden = !m.dominion; dtxt.hidden = !m.dominion;
    if (m.dominion) {
      mark.style.left = `${(100 * m.dominion) / m.owner.length}%`;
      const counts = m.seats.map((_, k) => m.owner.filter((o) => o === k).length);
      const lead = counts.indexOf(Math.max(...counts)), gap = m.dominion - counts[lead];
      const who = lead === m.me ? 'You' : ctx.player(m.seats[lead])?.name ?? '?';
      dtxt.textContent = gap <= 0 ? `🏁 ${who} ${lead === m.me ? 'hold' : 'holds'} two thirds: dominion at the start of ${lead === m.me ? 'your' : 'their'} next turn!`
        : `🏁 Dominion at ${m.dominion} lands · ${who} ${lead === m.me ? 'need' : 'needs'} ${gap} more`;
      dtxt.classList.toggle('hot', gap <= 0);
    }
    const free = m.owner.filter((o) => o === -1).length;
    if (free) { const seg = ctx.el('i', 'free', String(free)); seg.style.flexGrow = free; pow.append(seg); }
    const seats = $('rwSeats'); seats.replaceChildren();
    m.seats.forEach((pid, k) => {
      const p = ctx.player(pid), lands = m.owner.filter((o) => o === k).length;
      const troops = m.troops.reduce((s, t, i) => s + (m.owner[i] === k ? t : 0), 0);
      const row = ctx.el('div', 'seat-row' + (pid === S.turn ? ' turn' : '') + (lands || m.phase === 'claim' ? '' : ' out'));
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = p?.color ?? '#777';
      const isl = m.isles[k].map((j) => m.map.islands[j][0]).join(', ');
      const marks = ((m.shield || []).includes(k) ? '🛡️' : '') + (m.ambitionsOn ? ` 🎯${m.ambDone?.[k] ?? 0}` : '')
        + (m.gambitsOn ? ' ' + (m.gambits?.[k] || []).map((g) => GAMBIT[g]?.[0] ?? '').join('') : '');
      row.append(dot, ctx.el('span', 'grow', `${p?.name ?? 'left'}${k === m.me ? ' (you)' : ''}${marks.trim() ? ` ${marks.trim()}` : ''}`),
        ctx.el('span', 'hint', m.phase === 'claim' ? `${lands} 🏴` : lands ? `${lands} 🏴 · ${troops} 🪖 · +${m.income[k]}/turn · 🎴${m.cards[k]}${isl ? ` · ${isl}` : ''}` : '💀 out'));
      seats.append(row);
    });
    chronicle(m);
    const ab = $('rwAmbBox'), amb = m.ambition;
    ab.hidden = !amb;
    if (amb) {
      const box = $('rwAmb');
      box.replaceChildren();
      box.append(ctx.el('b', 'rw-amb-text', amb.text));
      const bar = ctx.el('div', 'rw-amb-bar'), fill = ctx.el('i');
      fill.style.width = `${Math.min(100, (100 * amb.have) / Math.max(1, amb.need))}%`;
      bar.append(fill, ctx.el('span', '', `${Math.min(amb.have, amb.need)} / ${amb.need}`));
      box.append(bar);
      const pips = ctx.el('div', 'rw-amb-pips');
      for (let k = 0; k < amb.of; k++) pips.append(ctx.el('span', k < amb.done ? 'on' : '', k < amb.done ? '🎯' : '○'));
      pips.append(ctx.el('span', 'hint', ` fulfilled ${amb.done} of ${amb.of} · each pays +6 troops and a ⭐`));
      box.append(pips);
      if (box.classList.contains('flip')) setTimeout(() => box.classList.remove('flip'), 900);
    }
    const hand = $('rwHand'); hand.replaceChildren();
    if (!m.hand.length) hand.append(ctx.el('span', 'hint', m.me == null ? 'Watching.' : 'None yet.'));
    for (const c of m.hand) hand.append(ctx.el('span', 'rw-card k' + c, KINDS[c]));
    $('rwTrade').disabled = !(mineTurn() && m.phase === 'draft' && m.canTrade);
    $('rwTrade').textContent = `Trade a set (+${m.tradeValue})`;
    const isles = $('rwIsles'); isles.replaceChildren();
    m.map.islands.forEach(([name, bonus, colour], j) => {
      const holder = m.isles.findIndex((l) => l.includes(j));
      const row = ctx.el('div', 'seat-row');
      const dot = ctx.el('span', 'mini-disc'); dot.style.background = colour;
      const n = m.map.lands.filter((l) => l[1] === j).length;
      row.append(dot, ctx.el('span', 'grow', `${name} · ${n} lands`),
        ctx.el('span', 'hint', `+${bonus}${holder >= 0 ? ` · ${ctx.player(m.seats[holder])?.name ?? '?'}` : ''}`));
      isles.append(row);
    });
  }

  const tokOf = (i) => document.getElementById(`rwTok${i}`);
  function pop(i) {
    const t = tokOf(i)?.querySelector('.rw-tok-body');
    if (!t || !motion()) return;
    t.classList.remove('pop'); void t.getBoundingClientRect(); t.classList.add('pop');
    setTimeout(() => t.classList.remove('pop'), 500);
  }

  // the newest battle: dice tumble, an arrow flashes, losses rise from both lands, a taken land ripples
  function battle(m) {
    const r = m.roll, box = $('rwBattle');
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    const fresh = seenEv !== null && r.ev !== seenEv;
    if (r.ev !== seenEv) {
      const atk = $('rwAtk'), def = $('rwDef');
      const a = ctx.player(r.by)?.name ?? '?', d = ctx.player(r.vs)?.name ?? 'unclaimed';
      const show = (at, de, la, ld, k, of) => {
        atk.replaceChildren(...at.map((v) => Dice.die(v, 'small rw-red')));
        def.replaceChildren(...de.map((v, j) => {
          const die = Dice.die(v, 'small' + (r.fort && j === 0 ? ' rw-fortdie' : ''));
          if (r.fort && j === 0) die.dataset.plus = '+1';
          return die;
        }));
        $('rwAtkTxt').textContent = `${a} −${la}`;
        $('rwDefTxt').textContent = `${r.shield ? '🛡️ ' : r.fort ? '🏰 ' : ''}${d} −${ld}` + (of > 1 ? ` (roll ${k + 1}/${of})` : '');
      };
      const seq = r.seq && r.seq.length ? r.seq : [[r.a, r.d, r.la, r.ld]];
      box.classList.toggle('won', !!r.won);
      if (!fresh || !motion()) {
        show(r.a, r.d, r.la, r.ld, 0, 1);
        $('rwDefTxt').textContent = `${r.shield ? '🛡️ ' : r.fort ? '🏰 ' : ''}${d} −${r.ld}` + (r.rolls > 1 ? ` (${r.rolls} rolls)` : '');
      }
      if (fresh) {
        hideInfo();
        follow(m, [r.from, r.to]);
        if (r.by !== S.me?.id) arrow(m, r.from, r.to, 'atk', true);
        // play the battle roll by roll: dice, a lunge, a shake, counts ticking down
        const gap = motion() && seq.length > 1 ? 260 : 0;
        const total = gap * (seq.length - 1);
        playEnd = now() + total + 450;
        const prevSeat = r.vs ? m.seats.indexOf(r.vs) : -1;
        if (r.won && motion()) holdOwner.set(r.to, prevSeat);
        let ac = r.a0, dc = r.d0;
        const counting = motion() && ac != null && gap;
        if (counting) { holding.set(r.from, ac); holding.set(r.to, dc); }
        let la = 0, ld = 0;
        seq.forEach(([at, de, xa, xd], k) => setTimeout(() => {
          la += xa; ld += xd;
          if (motion()) show(at, de, la, ld, k, seq.length);
          Dice.roll([...atk.children, ...def.children], { sound: k % 2 === 0 });
          lunge(r.from, r.to, m);
          if (xd) shake(r.to);
          if (xa) shake(r.from);
          if (counting) { ac -= xa; dc -= xd; holding.set(r.from, ac); holding.set(r.to, dc); tickTo(r.from, ac); tickTo(r.to, dc); }
        }, k * gap));
        setTimeout(() => {
          $('rwDefTxt').textContent = `${r.shield ? '🛡️ ' : r.fort ? '🏰 ' : ''}${d} −${r.ld}` + (r.rolls > 1 ? ` (${r.rolls} rolls)` : '');
          holding.delete(r.from);
          if (!marching.has(r.to)) holding.delete(r.to);
          holdOwner.delete(r.to);
          if (r.la) Kit.flyText(tokOf(r.from), `−${r.la}`, 'bad');
          if (r.ld) Kit.flyText(tokOf(r.to), `−${r.ld}`, r.by === S.me?.id ? 'good' : 'bad');
          burst(m, r.to, r.won ? ctx.player(r.by)?.color ?? '#fff' : '#ffd166', r.won);
          if (r.won) { ctx.sfx?.('capture'); pop(r.to); }
          if (S?.realm) paint();
        }, total + 450);
        if (r.won && r.by === S.me?.id) chain = { from: r.from, to: r.to };
      }
    }
    seenEv = r.ev;
  }

  // the latest move: placements and forts pop, marching troops for moves in and fortifying
  function moves(m) {
    const l = m.last;
    if (!l || l.ev == null) return;
    const fresh = seenLast !== null && l.ev !== seenLast;
    seenLast = l.ev;
    if (!fresh) return;
    hideInfo();
    const colour = ctx.player(l.by)?.color ?? '#fff';
    if (l.kind === 'place') { Kit.flyText(tokOf(l.to), `+${l.n}`, 'good'); pop(l.to); ctx.sfx?.('place'); }
    if (l.kind === 'fort') { Kit.flyText(tokOf(l.to), '🏰', 'gold'); pop(l.to); ctx.sfx?.('thud'); }
    if (l.kind === 'unplace') pop(l.to);
    if (l.kind === 'gambit') {
      const seat = m.seats.indexOf(l.by);
      m.owner.forEach((o, i) => { if (o === seat) setTimeout(() => pop(i), (i % 9) * 40); });
      if (l.name === 'runner') ctx.sfx?.('whoosh');
    }
    if (l.kind === 'ambition' && l.by === S.me?.id) $('rwAmb')?.classList.add('flip');
    if (l.kind === 'move') march(m, l.from, l.to, l.n, colour, 520);
    if (l.kind === 'fortify') { arrow(m, l.from, l.to, 'fort', true); march(m, l.from, l.to, l.n, colour, 100); }
  }

  // flags for lands that changed hands
  function owners(m) {
    const prev = seenOwner;
    seenOwner = [...m.owner];
    if (!prev || prev.length !== m.owner.length) return;
    const changed = m.owner.map((o, i) => (o !== prev[i] && o >= 0 ? i : -1)).filter((i) => i >= 0);
    if (changed.length > 6) return;
    const wait = Math.max(0, playEnd - now());
    changed.forEach((i) => setTimeout(() => plant(m, i, colourOf(m, m.owner[i])), wait));
    // a realm that just lost its last land: a skull on the spot
    m.seats.forEach((_, k) => {
      if (prev.includes(k) && !m.owner.includes(k)) {
        const spot = m.roll?.to ?? prev.indexOf(k);
        setTimeout(() => { if (typeof Kit !== 'undefined' && Kit.stamp) Kit.stamp(tokOf(spot), '💀', 'bad'); }, wait + 200);
      }
    });
  }

  function render(s, c) {
    S = s; ctx = c;
    const m = S.realm;
    if (built !== m.map.key) build(m);
    if (m.phase !== 'occupy' && m.phase !== 'fortify') moveN = null;
    autoZoom(m);
    battle(m);
    // chain attacks: after taking a land, it becomes the attacker (or the old one stays, if it still can)
    if (chain && m.phase === 'attack' && mineTurn()) {
      sel = canAttackFrom(m, chain.to) ? chain.to : canAttackFrom(m, chain.from) ? chain.from : null;
      tgt = null;
      chain = null;
    } else if (chain && m.phase !== 'occupy') chain = null;
    paint();
    moves(m);
    owners(m);
    side(m);
    // someone holds two thirds: a standing alarm over the map
    const alert = $('rwAlert');
    const dom = m.dominion && S.phase === 'playing' ? m.seats.findIndex((_, k) => m.owner.filter((o) => o === k).length >= m.dominion) : -1;
    alert.hidden = dom < 0;
    if (dom >= 0) alert.textContent = dom === m.me ? '🏁 You hold two thirds of the map: keep it through one round and you win!'
      : `⚠️ ${ctx.player(m.seats[dom])?.name ?? '?'} holds two thirds of the map: break their hold before their next turn!`;
    // the turn passes: a ribbon in the new player's colour
    if (S.turn !== seenTurn) {
      if (seenTurn === S.me?.id && m.me != null) snapMine = [...m.owner];
      if (S.turn === S.me?.id && snapMine && m.me != null && m.phase !== 'claim') recap(m, snapMine);
      if (seenTurn !== null && S.phase === 'playing') {
        const p = ctx.player(S.turn);
        banner(S.turn === S.me?.id ? (m.phase === 'claim' ? '🚩 Your pick' : '⚔️ Your turn') : `${p?.name ?? '?'}'s turn`, p?.color ?? '#888');
      }
      seenTurn = S.turn;
    }
    // a newly held island ripples
    const isleKey = m.isles.map((l) => l.join('.'));
    if (seenIsles) m.isles.forEach((ks, seat) => ks.forEach((k) => {
      if (!(seenIsles[seat] || '').split('.').includes(String(k))) setTimeout(() => ripple(m, k, m.last?.to ?? m.roll?.to), Math.max(0, playEnd - now()));
    }));
    seenIsles = isleKey;
    // a banner earned flies into your hand
    if (seenHand !== null && m.hand.length > seenHand) flyCard($('rwHand').lastElementChild);
    seenHand = m.hand.length;
  }

  function turnText(S) {
    const m = S.realm;
    if (!m || S.phase !== 'playing') return null;
    if (S.turn !== S.me?.id) return null;
    return { claim: 'Your turn: claim a land', draft: `Your turn: place ${m.reserve} troops`, attack: 'Your turn: attack', occupy: 'Move troops in', fortify: 'Fortify, then end your turn' }[m.phase] || null;
  }

  // ⏪ what happened to you while you waited
  function recap(m, before) {
    const box = $('rwRecap');
    const lost = {}, got = [];
    before.forEach((o, i) => {
      if (o === m.me && m.owner[i] !== m.me) (lost[m.owner[i]] = lost[m.owner[i]] || []).push(m.map.lands[i][0]);
      if (o !== m.me && m.owner[i] === m.me) got.push(m.map.lands[i][0]);
    });
    const lines = Object.entries(lost).map(([o, names]) => `${+o >= 0 ? ctx.player(m.seats[+o])?.name ?? '?' : 'Unclaimed'} took ${names.join(', ')}`);
    if (got.length) lines.push(`you gained ${got.join(', ')}`);
    const nowMine = m.owner.filter((o) => o === m.me).length, was = before.filter((o) => o === m.me).length;
    box.replaceChildren(ctx.el('b', '', lines.length ? '⏪ While you waited' : '⏪ While you waited: all quiet on your borders'));
    for (const l of lines) box.append(ctx.el('div', '', `· ${l[0].toUpperCase()}${l.slice(1)}`));
    box.append(ctx.el('div', 'hint left', `You hold ${nowMine} lands (${nowMine - was >= 0 ? '+' : ''}${nowMine - was}). Tap to close.`));
    box.classList.toggle('bad', nowMine < was);
    box.hidden = false;
    box.onclick = () => { box.hidden = true; };
    clearTimeout(recap.t);
    recap.t = setTimeout(() => { box.hidden = true; }, 8000);
  }

  function unmount() { built = null; clearTimeout(infoTimer); pointers.clear(); holding.clear(); }

  return { mount, render, turnText, unmount };
})();
