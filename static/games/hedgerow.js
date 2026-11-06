UI.hedgerow = (() => {
  // An SVG garden. The board turns so your own pawn starts at the bottom. Cells are 1 unit, grooves G wide.
  // Hedges sit centred on a groove crossing: crossing (r, c) lies between rows r, r+1 and columns c, c+1, and
  // hedge "h,r,c" runs left–right through it, "v,r,c" up–down. Tapping a groove picks the hedge centred on the
  // nearest crossing; the preview shows how many steps it costs each rival (worked out here, in the browser).
  let S, ctx, svg, built = '', mode = 'move', ghost = null, hovered = null, prev = null, lastO = 'h', turnDeg = 0;
  const NS = 'http://www.w3.org/2000/svg', G = 0.3, P = 1 + G;
  const TURN = { S: 0, N: 180, W: -90, E: 90 };
  const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const $ = (id) => document.getElementById(id);
  const hover = () => !!window.matchMedia?.('(hover: hover)').matches;  // mouse: click plants; touch: pick, then confirm
  const node = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.append(e);
    return e;
  };

  // ---- garden logic (mirrors games/hedgerow.py, for previews only; the server decides)

  const ek = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`);
  const cutsOf = (o, r, c) => (o === 'h'
    ? [ek([r, c], [r + 1, c]), ek([r, c + 1], [r + 1, c + 1])]
    : [ek([r, c], [r, c + 1]), ek([r + 1, c], [r + 1, c + 1])]);
  const cutSet = (hedges, extra) => {
    const s = new Set();
    for (const [o, r, c] of hedges) cutsOf(o, r, c).forEach((x) => s.add(x));
    if (extra) cutsOf(...extra).forEach((x) => s.add(x));
    return s;
  };
  const atGoal = (n, side, [r, c]) => ({ S: r === 0, N: r === n - 1, W: c === n - 1, E: c === 0 }[side]);
  // shortest route (cells after start) to the side's goal edge, ignoring pawns; null if sealed in
  function route(n, side, start, cut) {
    const prevOf = new Map([[`${start}`, null]]), q = [start];
    for (let i = 0; i < q.length; i++) {
      const cell = q[i];
      if (atGoal(n, side, cell)) {
        const out = [];
        for (let k = `${cell}`; k !== `${start}`; k = prevOf.get(k)) out.push(k.split(',').map(Number));
        return out.reverse();
      }
      for (const [dr, dc] of STEPS) {
        const nx = [cell[0] + dr, cell[1] + dc];
        if (nx[0] < 0 || nx[1] < 0 || nx[0] >= n || nx[1] >= n || prevOf.has(`${nx}`) || cut.has(ek(cell, nx))) continue;
        prevOf.set(`${nx}`, `${cell}`);
        q.push(nx);
      }
    }
    return null;
  }
  function fits(o, r, c) {
    const have = new Set(S.hedgerow.hedges.map(([a, b, d]) => `${a},${b},${d}`));
    const other = o === 'h' ? 'v' : 'h';
    const near = o === 'h' ? [[o, r, c - 1], [o, r, c + 1]] : [[o, r - 1, c], [o, r + 1, c]];
    return !have.has(`${o},${r},${c}`) && !have.has(`${other},${r},${c}`) && !near.some((x) => have.has(x.join(',')));
  }
  const racers = () => S.hedgerow.seats.filter((x) => !x.out);
  const legalSet = () => new Set(S.hedgerow.legal || []);
  const parse = (key) => { const [o, r, c] = key.split(','); return [o, +r, +c]; };

  // what a hedge would do: [{seat, before, after}] for every racer
  function effect(key) {
    const g = S.hedgerow, now = cutSet(g.hedges), next = cutSet(g.hedges, parse(key));
    return racers().map((x) => {
      const a = route(g.n, x.side, x.pos, now), b = route(g.n, x.side, x.pos, next);
      return { seat: x, before: a?.length, after: b?.length };
    });
  }

  // ---- building the board

  function mount(main, side) {
    built = ''; mode = 'move'; ghost = null; hovered = null; prev = null;
    main.innerHTML = '<div class="hg-wrap"><svg class="hg-board" id="hgSvg"></svg></div>';
    side.innerHTML = `<div class="panel">
      <div class="hg-modes"><button id="hgMove">🐾 Move</button><button id="hgHedge">🌿 Hedge</button></div>
      <div class="hg-confirm" id="hgConfirm" hidden>
        <button id="hgPlant" class="primary">🌿 Plant here</button><button id="hgTurn" title="Turn the hedge">↻ Turn</button><button id="hgCancel" title="Cancel">✕</button>
      </div>
      <div id="hgSeats"></div><p class="hint left" id="hgHint"></p></div>`;
    svg = $('hgSvg');
    $('hgMove').onclick = () => { mode = 'move'; ghost = null; ctx.rerender(); };
    $('hgHedge').onclick = () => { mode = mode === 'hedge' ? 'move' : 'hedge'; ghost = null; ctx.rerender(); };
    $('hgPlant').onclick = () => ghost && plant(ghost);
    $('hgTurn').onclick = () => { if (!ghost) return; const [o, r, c] = parse(ghost); pick(`${o === 'h' ? 'v' : 'h'},${r},${c}`); };
    $('hgCancel').onclick = () => { ghost = null; paintGhost(); };
  }

  function defs(parent) {
    const d = node('defs', {}, parent);
    const grad = (tag, id, attrs, stops) => {
      const e = node(tag, { id, ...attrs }, d);
      for (const [o, col] of stops) node('stop', { offset: o, 'stop-color': col }, e);
    };
    grad('linearGradient', 'hgGrass', { x1: 0, y1: 0, x2: 0.3, y2: 1 }, [[0, '#a8d46f'], [1, '#86b552']]);
    grad('linearGradient', 'hgGrass2', { x1: 0, y1: 0, x2: 0.3, y2: 1 }, [[0, '#9fcc66'], [1, '#7eab4b']]);
    grad('linearGradient', 'hgSoil', { x1: 0, y1: 0, x2: 1, y2: 1 }, [[0, '#7a5534'], [0.5, '#6a4729'], [1, '#573a21']]);
    grad('linearGradient', 'hgHedgeBase', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#2f7d32'], [1, '#174f1f']]);
    grad('radialGradient', 'hgLeaf', { cx: 0.4, cy: 0.35, r: 0.65 }, [[0, '#7fd36a'], [0.55, '#3f9a3c'], [1, '#226b27']]);
    grad('radialGradient', 'hgShine', { cx: 0.35, cy: 0.3, r: 0.6 }, [[0, '#ffffffcc'], [0.4, '#ffffff33'], [1, '#ffffff00']]);
    grad('radialGradient', 'hgShade', { cx: 0.5, cy: 0.5, r: 0.5 }, [[0, '#0000'], [0.75, '#0000'], [1, '#00000059']]);
  }

  function build(n, turn) {
    built = `${n}:${turn}`; svg.innerHTML = ''; turnDeg = turn;
    const W = n * P - G, mid = W / 2, pad = 0.62;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + 2 * pad} ${W + 2 * pad}`);
    defs(svg);
    const root = node('g', { transform: `rotate(${turn} ${mid} ${mid})` }, svg);
    node('rect', { x: -pad + 0.06, y: -pad + 0.06, width: W + 2 * pad - 0.12, height: W + 2 * pad - 0.12, rx: 0.45, class: 'hg-rim' }, root);
    node('g', { id: 'hgGoals' }, root);
    node('rect', { x: -0.14, y: -0.14, width: W + 0.28, height: W + 0.28, rx: 0.22, class: 'hg-soil' }, root);
    const cells = node('g', {}, root);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const g = node('g', { class: 'hg-cell', 'data-k': `${r},${c}` }, cells);
        node('rect', { x: c * P, y: r * P, width: 1, height: 1, rx: 0.16, fill: (r + c) % 2 ? 'url(#hgGrass2)' : 'url(#hgGrass)' }, g);
        // a few blades of grass, placed by a fixed hash so every device sees the same lawn
        const h = (r * 31 + c * 17) % 7;
        if (h < 3) node('path', { d: `M${c * P + 0.22 + h * 0.2} ${r * P + 0.8}q.01 -.08 -.03 -.13m.03 .13q.01 -.1 .05 -.14`, class: 'hg-blade' }, g);
        g.onclick = () => tapCell(r, c);
      }
    node('g', { id: 'hgRoutes' }, root);
    node('g', { id: 'hgCross' }, root);
    node('g', { id: 'hgHedges' }, root);
    node('g', { id: 'hgGhost', class: 'hg-ghost' }, root);
    node('g', { id: 'hgPawns' }, root);
    // tap targets, live only while planting: each groove piece is split in half, and each half belongs to the
    // hedge centred on the crossing nearest it; the crossings themselves sit on top
    const hits = node('g', { id: 'hgHits' }, root), reach = 0.24;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (r < n - 1) {
          const y = r * P + 1 - reach, hh = G + 2 * reach;
          hit(hits, `h,${r},${Math.max(c - 1, 0)}`, `h,${r},${Math.min(c, n - 2)}`, c * P - G / 2, y, 0.5 + G / 2, hh);
          hit(hits, `h,${r},${Math.min(c, n - 2)}`, `h,${r},${Math.max(c - 1, 0)}`, c * P + 0.5, y, 0.5 + G / 2, hh);
        }
        if (c < n - 1) {
          const x = c * P + 1 - reach, ww = G + 2 * reach;
          hit(hits, `v,${Math.max(r - 1, 0)},${c}`, `v,${Math.min(r, n - 2)},${c}`, x, r * P - G / 2, ww, 0.5 + G / 2);
          hit(hits, `v,${Math.min(r, n - 2)},${c}`, `v,${Math.max(r - 1, 0)},${c}`, x, r * P + 0.5, ww, 0.5 + G / 2);
        }
      }
    for (let r = 0; r < n - 1; r++)
      for (let c = 0; c < n - 1; c++) {
        const e = node('rect', { x: c * P + 1 - 0.1, y: r * P + 1 - 0.1, width: G + 0.2, height: G + 0.2, class: 'hg-seg hg-xing' }, hits);
        const at = () => crossingSlot(r, c);
        e.onclick = () => tapSlot(at(), true);
        e.onpointerenter = () => { if (hover() && mode === 'hedge') { hovered = at(); paintGhost(); } };
        e.onpointerleave = () => { if (hover()) { hovered = null; paintGhost(); } };
      }
    node('g', { id: 'hgTop' }, svg);  // unrotated: labels that must read upright
  }

  // a half-groove: `near` is the hedge centred on its nearest crossing; `alt` also covers it, used when near can't go
  function hit(parent, near, alt, x, y, width, height) {
    const e = node('rect', { x, y, width, height, class: 'hg-seg', 'data-slot': near }, parent);
    const at = () => { const L = legalSet(); return L.has(near) || !L.has(alt) ? near : alt; };
    e.onclick = () => tapSlot(at());
    e.onpointerenter = () => { if (hover() && mode === 'hedge') { hovered = at(); paintGhost(); } };
    e.onpointerleave = () => { if (hover()) { hovered = null; paintGhost(); } };
  }

  // on a crossing: tapping the picked hedge's own crossing turns it; otherwise the last way you laid one
  function crossingSlot(r, c) {
    const L = legalSet();
    if (ghost && !hover()) {
      const [o, gr, gc] = parse(ghost);
      if (gr === r && gc === c) return `${o === 'h' ? 'v' : 'h'},${r},${c}`;
    }
    const want = `${lastO},${r},${c}`, other = `${lastO === 'h' ? 'v' : 'h'},${r},${c}`;
    return L.has(want) || !L.has(other) ? want : other;
  }

  function pick(key) {
    ghost = key; lastO = key[0];
    paintGhost();
  }

  function tapSlot(key, crossing = false) {
    if (!ctx.myTurn || mode !== 'hedge') return;
    if (!legalSet().has(key)) { pick(key); return ctx.toast(whyNot(key)); }
    if (hover() || (ghost === key && !crossing)) return plant(key);
    pick(key);
  }

  function plant(key) {
    if (!legalSet().has(key)) return ctx.toast(whyNot(key));
    ghost = null; hovered = null; lastO = key[0];
    const [o, r, c] = parse(key);
    ctx.quiet(ctx.act('hedge', { o, r, c }));
  }

  function whyNot(key) {
    const [o, r, c] = parse(key);
    if (!fits(o, r, c)) return 'That hedge would overlap or cross another one.';
    const stuck = effect(key).find((x) => x.after === undefined);
    const who = stuck && (stuck.seat.id === S.me.id ? 'you' : ctx.player(stuck.seat.id)?.name || 'someone');
    return `That hedge would seal ${who || 'someone'} in — there must always be a way through.`;
  }

  function tapCell(r, c) {
    if (!ctx.myTurn) return;
    if (mode === 'hedge') return;
    const m = (S.hedgerow.moves || []).find(([mr, mc]) => mr === r && mc === c);
    if (!m) return;
    ctx.quiet(ctx.act('move', { r, c }));
  }

  // ---- drawing

  const colorOf = (pid) => ctx.player(pid)?.color ?? '#888';

  // a hedge: a dark base, a row of leafy lumps, and two flowers in the planter's colour
  function drawHedge(parent, o, r, c, ink, cls) {
    const L = 2 + G, T = G + 0.14, x0 = o === 'h' ? c * P : c * P + 1 - 0.07, y0 = o === 'h' ? r * P + 1 - 0.07 : r * P;
    const g = node('g', { class: cls }, parent);
    const at = (along, across) => (o === 'h' ? [x0 + along, y0 + across] : [x0 + across, y0 + along]);
    const box = (along, across, l, t, attrs) => {
      const [x, y] = at(along, across);
      return node('rect', { x, y, width: o === 'h' ? l : t, height: o === 'h' ? t : l, ...attrs }, g);
    };
    if (cls === 'hg-ghedge') box(-0.08, -0.08, L + 0.16, T + 0.16, { rx: T / 2 + 0.08, class: 'hg-gline' });
    box(0.02, 0.07, L, T, { rx: T / 2, class: 'hg-hshadow' });
    box(0, 0, L, T, { rx: T / 2, fill: 'url(#hgHedgeBase)', class: 'hg-hbase' });
    const lumps = 6;
    for (let i = 0; i < lumps; i++) {
      const [cx, cy] = at(0.2 + i * (L - 0.4) / (lumps - 1), T / 2 + (i % 2 ? 0.03 : -0.03));
      node('circle', { cx, cy, r: T * (i % 2 ? 0.46 : 0.52), fill: 'url(#hgLeaf)', class: 'hg-lump' }, g);
    }
    if (ink) for (const f of [0.3, 0.7]) {
      const [cx, cy] = at(L * f, T / 2 - 0.02);
      node('circle', { cx, cy, r: 0.075, fill: ink, class: 'hg-flower' }, g);
      node('circle', { cx, cy, r: 0.03, class: 'hg-flower-eye' }, g);
    }
    return g;
  }

  // an upright label at a garden point (the garden itself may be turned)
  function topPoint(x, y) {
    const n = S.hedgerow.n, mid = (n * P - G) / 2, t = turnDeg * Math.PI / 180;
    const dx = x - mid, dy = y - mid;
    return [mid + dx * Math.cos(t) - dy * Math.sin(t), mid + dx * Math.sin(t) + dy * Math.cos(t)];
  }

  function paintGhost() {
    const e = $('hgGhost'), top = $('hgTop'), key = ghost || hovered;
    if (!e) return;
    e.innerHTML = ''; top.innerHTML = '';
    const live = key && mode === 'hedge' && ctx.myTurn;
    const confirm = $('hgConfirm');
    if (confirm) confirm.hidden = !(live && ghost && !hover() && legalSet().has(ghost));
    if (!live) { e.setAttribute('class', 'hg-ghost'); paintRoutes(null); return hintNow(); }
    const [o, r, c] = parse(key);
    const ok = legalSet().has(key);
    drawHedge(e, o, r, c, ok ? colorOf(S.me.id) : null, 'hg-ghedge');
    e.setAttribute('class', `hg-ghost on${ok ? '' : ' bad'}${ghost === key ? ' picked' : ''}`);
    paintRoutes(ok ? key : null);
    if (ok) {
      // a chip per racer whose route gets longer, beside the hedge's middle
      const fx = effect(key).filter((x) => x.after > x.before);
      const [cx, cy] = topPoint(c * P + 1 + G / 2, r * P + 1 + G / 2);
      fx.forEach((x, i) => {
        const gx = cx + (i - (fx.length - 1) / 2) * 0.95, gy = cy + (cy < (S.hedgerow.n * P - G) / 2 ? 0.72 : -0.72);  // toward the middle, off the edge rows
        const chip = node('g', { class: 'hg-chip' + (x.seat.id === S.me.id ? ' self' : '') }, top);
        node('rect', { x: gx - 0.42, y: gy - 0.24, width: 0.84, height: 0.48, rx: 0.24, fill: colorOf(x.seat.id) }, chip);
        node('text', { x: gx, y: gy + 0.012 }, chip).textContent = `+${x.after - x.before}`;
      });
    }
    hintNow(key, ok);
  }

  // your route always; while planting, every rival's too (through the previewed hedge, if there is one)
  function paintRoutes(extra) {
    const box = $('hgRoutes'); if (!box) return;
    box.innerHTML = '';
    const g = S.hedgerow, me = g.seats.find((x) => x.id === S.me.id);
    if (S.phase !== 'playing') return;
    const cut = cutSet(g.hedges, extra && parse(extra));
    for (const x of racers()) {
      const mine = x.id === me?.id;
      if (!mine && !(mode === 'hedge' && ctx.myTurn)) continue;
      if (mine && !me) continue;
      const cells = route(g.n, x.side, x.pos, cut);
      if (!cells?.length) continue;
      const pts = [x.pos, ...cells].map(([r, c]) => `${c * P + 0.5},${r * P + 0.5}`).join(' ');
      node('polyline', { points: pts, stroke: colorOf(x.id), class: 'hg-route' + (mine ? ' mine' : '') + (extra ? ' preview' : '') }, box);
      const [er, ec] = cells[cells.length - 1];
      node('circle', { cx: ec * P + 0.5, cy: er * P + 0.5, r: 0.12, fill: colorOf(x.id), class: 'hg-route-end' }, box);
    }
  }

  function hintNow(key, ok) {
    const hint = $('hgHint'); if (!hint || !S) return;
    const g = S.hedgerow, me = g.seats.find((x) => x.id === S.me.id);
    if (!me) { hint.textContent = 'Each pawn races to the strip of its colour on the far side.'; return; }
    if (!ctx.myTurn) { hint.textContent = 'Race to the strip in your colour at the top. The dotted line is your shortest way.'; return; }
    if (mode !== 'hedge') {
      hint.textContent = me.hop ? 'Tap a glowing square to move. 🐇 marks a hop through a hedge (once a game).' : 'Tap a glowing square to move, or switch to 🌿 Hedge.';
      return;
    }
    if (!key) {
      hint.textContent = hover()
        ? 'Point at a groove: the hedge snaps to the nearest crossing. Click to plant. Dotted lines show each rival\'s way home.'
        : 'Tap a groove: the hedge snaps to the nearest crossing. Dotted lines show each rival\'s way home.';
      return;
    }
    if (!ok) { hint.textContent = whyNot(key); return; }
    const fx = effect(key), parts = fx.filter((x) => x.after !== x.before)
      .map((x) => `${x.seat.id === S.me.id ? 'you' : ctx.player(x.seat.id)?.name ?? '?'} +${x.after - x.before}`);
    const what = parts.length ? `This hedge: ${parts.join(' · ')} steps.` : 'This hedge doesn\'t lengthen anyone\'s route yet.';
    hint.textContent = what + (hover() ? ' Click to plant.' : ' Plant it, ↻ turn it, or tap another groove.');
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.hedgerow, n = g.n;
    const me = g.seats.find((x) => x.id === S.me.id);
    const turn = TURN[me?.side ?? 'S'];
    if (built !== `${n}:${turn}`) { build(n, turn); prev = null; }
    if (!ctx.myTurn) { ghost = null; hovered = null; }
    const mineLeft = me && !me.out ? me.hedges : 0;
    if (mode === 'hedge' && (!ctx.myTurn || !mineLeft)) mode = 'move';
    svg.classList.toggle('live', ctx.myTurn);
    svg.classList.toggle('planting', mode === 'hedge');
    const W = n * P - G;

    // goal edges: a flower bed in each racer's colour along the side it races to
    const goals = $('hgGoals'); goals.innerHTML = '';
    for (const x of g.seats) {
      if (x.out) continue;
      const t = 0.3, o = -0.5, far = W + 0.2;
      const at = { S: [0, o, W, t], N: [0, far, W, t], W: [far, 0, t, W], E: [o, 0, t, W] }[x.side];
      node('rect', { x: at[0], y: at[1], width: at[2], height: at[3], rx: t / 2, fill: colorOf(x.id), class: 'hg-goal' + (x.id === S.me.id ? ' mine' : '') }, goals);
      const along = at[2] > at[3];
      for (let i = 0; i < n; i++) {
        const cx = along ? i * P + 0.5 : at[0] + t / 2, cy = along ? at[1] + t / 2 : i * P + 0.5;
        node('circle', { cx, cy, r: 0.06, class: 'hg-goal-bud' }, goals);
      }
    }

    // cells: move targets
    const moves = new Map((g.moves || []).map(([r, cc, k]) => [`${r},${cc}`, k]));
    for (const e of svg.querySelectorAll('.hg-cell')) {
      const k = moves.get(e.dataset.k);
      e.classList.toggle('target', ctx.myTurn && mode === 'move' && !!k);
      e.classList.toggle('hop', ctx.myTurn && mode === 'move' && k === 'hop');
    }

    // crossings where a hedge can go (while planting)
    const cross = $('hgCross'); cross.innerHTML = '';
    if (mode === 'hedge' && ctx.myTurn) {
      const L = legalSet();
      for (let r = 0; r < n - 1; r++)
        for (let cc = 0; cc < n - 1; cc++)
          if (L.has(`h,${r},${cc}`) || L.has(`v,${r},${cc}`))
            node('circle', { cx: cc * P + 1 + G / 2, cy: r * P + 1 + G / 2, r: 0.07, class: 'hg-x' }, cross);
    }

    // hedges
    const hedges = $('hgHedges'); hedges.innerHTML = '';
    const lastH = g.last?.kind === 'hedge' ? g.last.hedge.join(',') : null;
    for (const [o, r, cc, seat] of g.hedges) {
      const k = `${o},${r},${cc}`, fresh = prev && k === lastH && prev.hedges < g.hedges.length;
      const e = drawHedge(hedges, o, r, cc, colorOf(g.seats.find((x) => x.seat === seat)?.id), 'hg-hedge' + (k === lastH ? ' last' : '') + (fresh ? ' fresh' : ''));
      if (fresh) {
        ctx.sfx('thud');
        if (g.last.gain >= 2) Kit.flyText(e, `+${g.last.gain} 🌀`, 'gold');
      }
    }

    // pawns glide between squares (CSS transition on the group transform)
    const pawns = $('hgPawns');
    for (const x of g.seats) {
      let e = pawns.querySelector(`[data-id="${x.id}"]`);
      if (!e) {
        e = node('g', { class: 'hg-pawn', 'data-id': x.id }, pawns);
        const up = node('g', { transform: `rotate(${-turnDeg} 0.5 0.5)` }, e);  // keep the light coming from the top left
        node('ellipse', { cx: 0.53, cy: 0.62, rx: 0.33, ry: 0.22, class: 'hg-pshadow' }, up);
        node('circle', { cx: 0.5, cy: 0.5, r: 0.42, class: 'hg-ring' }, up);
        node('circle', { cx: 0.5, cy: 0.48, r: 0.33, class: 'hg-body' }, up);
        node('circle', { cx: 0.5, cy: 0.48, r: 0.33, fill: 'url(#hgShade)' }, up);
        node('circle', { cx: 0.5, cy: 0.48, r: 0.33, fill: 'url(#hgShine)' }, up);
      }
      e.classList.toggle('gone', x.out);
      e.classList.toggle('now', x.id === S.turn && S.phase === 'playing');
      e.classList.toggle('me', x.id === S.me.id);
      e.querySelector('.hg-body').style.fill = colorOf(x.id);
      e.style.transform = `translate(${x.pos[1] * P}px, ${x.pos[0] * P}px)`;
      const was = prev?.pos[x.id];
      if (was && was !== x.pos.join(',')) {
        ctx.sfx(g.last?.kind === 'hop' ? 'whoosh' : 'place');
        if (g.last?.kind === 'hop') Kit.flyText(e, '🐇 hop!', 'good');
      }
    }
    prev = { hedges: g.hedges.length, pos: Object.fromEntries(g.seats.map((x) => [x.id, x.pos.join(',')])) };

    // side panel
    $('hgMove').classList.toggle('primary', mode === 'move');
    $('hgHedge').classList.toggle('primary', mode === 'hedge');
    $('hgMove').disabled = !ctx.myTurn;
    $('hgHedge').disabled = !ctx.myTurn || !mineLeft;
    $('hgHedge').textContent = `🌿 Hedge (${mineLeft})`;
    const box = $('hgSeats'); box.innerHTML = '';
    for (const x of g.seats) {
      const p = ctx.player(x.id);
      const row = ctx.el('div', 'seat-row hg-seat' + (x.id === S.turn ? ' now' : '') + (x.out ? ' out' : ''));
      const sw = ctx.el('span', 'mini-disc'); sw.style.background = colorOf(x.id);
      row.append(sw, ctx.el('span', 'grow', `${p?.name ?? 'left'}${x.id === S.me.id ? ' (you)' : ''}`),
        ctx.el('span', 'hg-stat', `${x.dist ?? '–'} to go`), ctx.el('span', 'hg-stat', `🌿${x.hedges}${x.hop ? ' 🐇' : ''}`));
      box.append(row);
    }
    paintGhost();
  }

  return { mount, render };
})();
