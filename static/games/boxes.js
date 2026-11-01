UI.boxes = (() => {
  // A wide grid lies the long way on the screen: across on a sideways phone, down on an upright one.
  let S, ctx, svg, size = '', prev = null, picked = null;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const hover = () => !!window.matchMedia?.('(hover: hover)').matches;  // mouse: click draws; touch: tap twice
  const landscape = () => !!window.matchMedia?.('(orientation: landscape)').matches;
  const layout = (b) => `${b.rows}x${b.cols}:${b.rows !== b.cols && (b.cols > b.rows) !== landscape()}`;
  const onTurn = () => { if (S && layout(S.boxes) !== size) ctx.rerender(); };
  const node = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.append(e);
    return e;
  };

  function mount(main, side) {
    size = ''; prev = null; picked = null;
    main.innerHTML = '<div class="bx-wrap"><svg class="bx-board" id="bxSvg"></svg></div>';
    side.innerHTML = `<div class="panel"><div id="bxScores"></div>
      <p class="hint left" id="bxHint"></p></div>`;
    svg = $('bxSvg');
    window.addEventListener('resize', onTurn);
  }

  function unmount() { window.removeEventListener('resize', onTurn); }

  function build(b) {
    const { rows, cols } = b;
    size = layout(b); svg.innerHTML = '';
    const flip = size.endsWith('true');
    const at = (r, c) => (flip ? [r, c] : [c, r]);  // a grid point (row, column) on screen as [x, y]
    const [w, h] = at(rows, cols);
    svg.setAttribute('viewBox', `-0.35 -0.35 ${w + 0.7} ${h + 0.7}`);
    svg.parentElement.style.setProperty('--ar', w / h);
    const boxes = node('g', {}, svg), lines = node('g', {}, svg), dots = node('g', {}, svg);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const g = node('g', { class: 'bx-box', 'data-k': `${r},${c}` }, boxes);
        const [x, y] = at(r, c);
        node('rect', { x: x + 0.06, y: y + 0.06, width: 0.88, height: 0.88, rx: 0.08 }, g);
        node('text', { x: x + 0.5, y: y + 0.53 }, g);
      }
    const addLine = (d, r, c) => {
      const [x1, y1] = at(r, c), [x2, y2] = d === 'h' ? at(r, c + 1) : at(r + 1, c);
      const g = node('g', { class: 'bx-line', 'data-k': `${d},${r},${c}` }, lines);
      node('line', { x1, y1, x2, y2, class: 'bx-ink', pathLength: 1 }, g);
      node('line', { x1, y1, x2, y2, class: 'bx-hit' }, g);
      g.onclick = () => tap(d, r, c, g);
    };
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) addLine('h', r, c);
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) addLine('v', r, c);
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const [cx, cy] = at(r, c);
      node('circle', { cx, cy, r: 0.075, class: 'bx-dot' }, dots);
    }
  }

  function tap(d, r, c, g) {
    if (!ctx.myTurn || g.classList.contains('drawn')) return;
    const key = `${d},${r},${c}`;
    if (!hover() && picked !== key) { picked = key; return ctx.rerender(); }
    picked = null;
    ctx.quiet(ctx.act('line', { d, r, c }));
  }

  const colorOf = (seat) => ctx.player(S.boxes.seats[seat])?.color ?? '#888';

  function render(s, c) {
    S = s; ctx = c;
    const b = S.boxes;
    b.rows ??= b.n; b.cols ??= b.n;
    if (layout(b) !== size) { build(b); prev = null; }
    const mySeat = b.seats.indexOf(S.me.id);
    svg.style.setProperty('--mine', mySeat >= 0 ? colorOf(mySeat) : '#fff');
    svg.classList.toggle('live', ctx.myTurn);
    if (!ctx.myTurn) picked = null;
    const lastKey = b.last?.join(',');

    for (const g of svg.querySelectorAll('.bx-line')) {
      const [d, r, col] = g.dataset.k.split(','), seat = (d === 'h' ? b.h : b.v)[+r][+col];
      const was = prev && (d === 'h' ? prev.h : prev.v)[+r][+col];
      g.classList.toggle('drawn', seat != null);
      g.classList.toggle('fresh', seat != null && prev != null && was == null);
      g.classList.toggle('last', g.dataset.k === lastKey);
      g.classList.toggle('picked', g.dataset.k === picked);
      g.style.setProperty('--ink', seat != null ? colorOf(seat) : '');
    }
    const gems = new Set(b.gems.map((x) => x.join(',')));
    for (const g of svg.querySelectorAll('.bx-box')) {
      const [r, col] = g.dataset.k.split(',').map(Number), seat = b.owner[r][col];
      const gem = gems.has(g.dataset.k);
      g.classList.toggle('owned', seat != null);
      g.classList.toggle('fresh', seat != null && prev != null && prev.owner[r][col] == null);
      g.classList.toggle('gem', gem);
      g.style.setProperty('--fill', seat != null ? colorOf(seat) : 'transparent');
      const name = seat != null ? ctx.player(b.seats[seat])?.name ?? '?' : '';
      g.querySelector('text').textContent = seat != null ? (gem ? '💎' : [...name.replace(/^🤖\s*/, '')][0] ?? '') : gem ? '💎' : '';
    }
    prev = { h: b.h, v: b.v, owner: b.owner };

    const box = $('bxScores'); box.innerHTML = '';
    for (const [i, pid] of b.seats.entries()) {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row bx-score' + (pid === S.turn ? ' now' : ''));
      const sw = ctx.el('span', 'mini-disc'); sw.style.background = colorOf(i);
      row.append(sw, ctx.el('span', 'grow', `${p?.name ?? 'left'}${pid === S.me.id ? ' (you)' : ''}`), ctx.el('b', '', p?.meta || '0 pts'));
      box.append(row);
    }
    $('bxHint').textContent = !ctx.myTurn ? (b.gems.length ? `💎 Gem boxes are worth 3.` : '')
      : picked ? 'Tap the glowing line again to draw it.'
        : hover() ? 'Click a line between two dots.' : 'Tap a line to pick it, tap again to draw.';
    // endgame: every line now gives boxes away, so show what's left to hand over
    if (b.chains?.length) {
      const chains = b.chains.filter(([, loop]) => !loop).map(([n]) => n), loops = b.chains.filter(([, loop]) => loop).map(([n]) => n);
      $('bxHint').textContent += ` ⛓ Every line gives boxes away now. Chains: ${chains.join(' · ') || 'none'}` +
        (loops.length ? ` · loops: ${loops.join(' · ')}` : '') + '. Hand over the small ones first.';
    }
  }

  return { mount, render, unmount };
})();
