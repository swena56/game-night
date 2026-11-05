// Nine Men's Morris: an SVG board of 24 points. Tap a point to place; in the moving phase tap a man,
// then where it goes. When a move makes a mill, tap the rival man to take. Only legal choices respond.
UI.morris = (() => {
  let S, ctx, svg, pick = null, pending = null, seenLast = null, warn = false;
  const MILLS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
    [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23]];
  const DIAGS = [[0, 3, 6], [2, 5, 8], [21, 18, 15], [23, 20, 17]];
  const POS = [[0, 0], [3, 0], [6, 0], [1, 1], [3, 1], [5, 1], [2, 2], [3, 2], [4, 2], [0, 3], [1, 3], [2, 3],
    [4, 3], [5, 3], [6, 3], [2, 4], [3, 4], [4, 4], [1, 5], [3, 5], [5, 5], [0, 6], [3, 6], [6, 6]];
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const at = (i) => [10 + POS[i][0] * 30, 10 + POS[i][1] * 30];

  function mount(main, side) {
    pick = null; pending = null; seenLast = null;
    main.innerHTML = `<div class="mm"><svg id="mmSvg" class="mm-board" viewBox="0 0 200 200"></svg><p id="mmHint" class="hint"></p></div>`;
    side.innerHTML = `<div class="panel"><div id="mmSeats"></div>
      <div class="row"><button id="mmWarn" aria-pressed="false">⚠ Show threats</button></div>
      <p class="hint left">Threats ring the empty points where your rival could finish a mill next move.</p></div>`;
    svg = $('mmSvg');
    try { warn = localStorage.getItem('mmWarn') === '1'; } catch { warn = false; }
    $('mmWarn').onclick = () => { warn = !warn; try { localStorage.setItem('mmWarn', warn ? '1' : '0'); } catch {} paint(); };
    const line = (a, b, cls = 'mm-line') => { const l = document.createElementNS(NS, 'line'); const [x1, y1] = at(a), [x2, y2] = at(b); Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => l.setAttribute(k, v)); l.setAttribute('class', cls); svg.append(l); };
    for (const [a, b, c] of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
      [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23]]) { line(a, b); line(b, c); }
    // Twelve Men's Morris: the corner diagonals (shown only in that variant)
    for (const [a, b, c] of [[0, 3, 6], [2, 5, 8], [21, 18, 15], [23, 20, 17]]) { line(a, b, 'mm-line mm-diag'); line(b, c, 'mm-line mm-diag'); }
    for (let i = 0; i < 24; i++) {
      const g = document.createElementNS(NS, 'circle');
      const [x, y] = at(i);
      g.setAttribute('cx', x); g.setAttribute('cy', y); g.setAttribute('r', 8);
      g.setAttribute('class', 'mm-pt'); g.dataset.i = i;
      g.addEventListener('click', () => tap(i));
      svg.append(g);
    }
  }

  function tap(i) {
    const m = S?.morris; if (!m || !ctx.myTurn) return;
    const legal = m.legal;
    if (pending) {  // choosing which rival man to take
      if (legal.some(([s, d, r]) => s === pending[0] && d === pending[1] && r === i)) send([pending[0], pending[1], i]);
      return;
    }
    const placing = m.hand[m.me] > 0;
    if (placing || pick != null) {
      const src = placing ? -1 : pick;
      const opts = legal.filter(([s, d]) => s === src && d === i);
      if (opts.length) {
        if (opts[0][2] < 0) return send(opts[0]);
        pending = [src, i]; pick = null; return paint();
      }
    }
    if (!placing && legal.some(([s]) => s === i)) { pick = pick === i ? null : i; return paint(); }
    pick = null; paint();
  }

  function send(mv) { pick = null; pending = null; paint(); ctx.quiet(ctx.act('move', { move: mv })); }

  // empty points where `seat` could complete a mill with its next move (a placement, a step or a flight;
  // the man that moves can't be one of the two already in the line)
  function threats(m, seat) {
    const b = m.board, lines = [...MILLS, ...(m.twelve ? DIAGS : [])], out = new Set();
    const mine = b.map((v, i) => (v === seat ? i : -1)).filter((i) => i >= 0);
    const flying = !m.hand[seat] && m.fly !== false && mine.length === 3;
    const adj = (a, c) => lines.some((l) => l.indexOf(a) >= 0 && Math.abs(l.indexOf(a) - l.indexOf(c)) === 1 && l.includes(c));
    for (const l of lines) {
      const empty = l.filter((i) => b[i] == null);
      if (empty.length !== 1 || l.filter((i) => b[i] === seat).length !== 2) continue;
      const d = empty[0];
      if (m.hand[seat] > 0 || mine.some((s) => !l.includes(s) && (flying || adj(s, d)))) out.add(d);
    }
    return out;
  }

  function paint() {
    const m = S.morris, legal = m.legal, mine = ctx.myTurn;
    const danger = warn && m.me != null && S.phase === 'playing' ? threats(m, 1 - m.me) : new Set();
    const wb = $('mmWarn');
    if (wb) { wb.hidden = m.me == null; wb.classList.toggle('on', warn); wb.setAttribute('aria-pressed', String(warn));
      wb.textContent = warn ? `⚠ Threats: ${danger.size || 'none'}` : '⚠ Show threats'; }
    const placing = m.me != null && m.hand[m.me] > 0;
    const targets = new Set(), sources = new Set(), takes = new Set();
    if (mine) {
      if (pending) legal.filter(([s, d]) => s === pending[0] && d === pending[1]).forEach(([, , r]) => takes.add(r));
      else if (placing) legal.forEach(([, d]) => targets.add(d));
      else { legal.forEach(([s]) => sources.add(s)); if (pick != null) legal.filter(([s]) => s === pick).forEach(([, d]) => targets.add(d)); }
    }
    const last = m.last || [-1, -1, -1];
    for (const g of svg.querySelectorAll('.mm-pt')) {
      const i = +g.dataset.i;
      let v = m.board[i];
      if (pending && i === pending[1]) v = m.me;
      if (pending && i === pending[0]) v = null;
      const color = v == null ? null : ctx.player(m.seats[v])?.color ?? '#777';
      g.setAttribute('r', v == null ? 5 : 9);
      g.style.fill = v == null ? '' : v === 0 ? '#1c1726' : '#f4eedd';
      g.style.stroke = color || '';
      g.setAttribute('class', 'mm-pt' + (v == null ? ' empty' : ' man') + (targets.has(i) ? ' can' : '') + (sources.has(i) ? ' src' : '')
        + (i === pick ? ' picked' : '') + (takes.has(i) ? ' take' : '') + (i === last[1] ? ' last' : '') + (danger.has(i) ? ' warn' : ''));
    }
    $('mmHint').textContent = !mine || S.phase !== 'playing' ? '' : pending ? '🎯 Mill! Tap a rival man to take.'
      : placing ? `Tap an empty point to place a man (${m.hand[m.me]} left).` : pick != null ? 'Tap where it goes.' : 'Tap one of your men to move it.';
  }

  // the move just made: a man glides from where it was, a new mill flashes, a taken man shrinks away
  function animateLast(m) {
    const key = JSON.stringify(m.last);
    if (seenLast === null || key === seenLast || !m.last) { seenLast = key; return; }
    seenLast = key;
    const [src, dst, take] = m.last;
    const man = svg.querySelector(`.mm-pt[data-i="${dst}"]`);
    if (motionOK() && man?.animate) {
      const [x0, y0] = src >= 0 ? at(src) : [at(dst)[0], -20], [x1, y1] = at(dst);
      man.animate([{ transform: `translate(${x0 - x1}px, ${y0 - y1}px)` }, { transform: 'none' }], { duration: src >= 0 ? 320 : 380, easing: 'cubic-bezier(.3, .9, .4, 1)' });
    }
    setTimeout(() => ctx.sfx('place'), 300);
    if (take >= 0) {
      const lines = [...MILLS, ...(m.twelve ? DIAGS : [])].filter((l) => l.includes(dst) && l.every((i) => m.board[i] === m.board[dst]));
      for (const l of lines) {
        const [x1, y1] = at(l[0]), [x2, y2] = at(l[2]);
        const f = document.createElementNS(NS, 'line');
        Object.entries({ x1, y1, x2, y2, class: 'mm-mill' }).forEach(([k, v]) => f.setAttribute(k, v));
        svg.insertBefore(f, svg.querySelector('.mm-pt'));
        setTimeout(() => f.remove(), 1400);
      }
      const [tx, ty] = at(take), ghost = document.createElementNS(NS, 'circle');
      Object.entries({ cx: tx, cy: ty, r: 9, class: 'mm-gone' }).forEach(([k, v]) => ghost.setAttribute(k, v));
      ghost.style.fill = m.board[dst] === 0 ? '#f4eedd' : '#1c1726';
      svg.append(ghost);
      setTimeout(() => ghost.remove(), 700);
      setTimeout(() => ctx.sfx('capture'), 380);
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    if (!ctx.myTurn) { pick = null; pending = null; }
    paint();
    animateLast(S.morris);
    const m = S.morris, info = $('mmSeats'); info.innerHTML = '';
    svg.classList.toggle('twelve', !!m.twelve);
    m.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      const disc = ctx.el('span', 'mini-disc'); disc.style.background = i === 0 ? '#1c1726' : '#f4eedd'; disc.style.border = `2px solid ${p?.color ?? '#777'}`;
      row.append(disc, ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === m.me ? ' (you)' : ''}`),
        ctx.el('span', 'hint', `${m.board.filter((v) => v === i).length} on board${m.hand[i] ? ` · ${m.hand[i]} to place` : ''}`));
      info.append(row);
    });
  }

  return { mount, render, ownSounds: true };
})();
