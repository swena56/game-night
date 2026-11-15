// 🦋 Kindred: a 4×4 board of SVG pieces (☀️/🌙 colour, ●/■ shape, big/small, ✦ starred/plain).
// Your turn: tap a square for the piece in your hand (each square shows what it would score), then tap the
// piece your rival must place next (each one shows the most your rival could score with it).
UI.kindred = (() => {
  let S, ctx, cellSel = null, seen = '';
  const $ = (id) => document.getElementById(id);
  const BITS = [[1, 'big', 'small'], [2, 'moon', 'sun'], [4, 'square', 'round'], [8, 'starred', 'plain']];
  const name = (p) => BITS.map(([b, a, z]) => (p & b ? a : z)).join(' ');
  const SVGNS = 'http://www.w3.org/2000/svg';

  // one piece as SVG: big pieces fill the square, small ones sit at about 60%; moon pieces are indigo,
  // sun pieces gold; starred ones carry a white four-point star
  function pieceSvg(p) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'kn-piece');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', name(p));
    const big = p & 1, moon = p & 2, sq = p & 4, star = p & 8;
    const r = big ? 44 : 27, fill = moon ? '#5b5fd6' : '#f4b73f', edge = moon ? '#2c2f86' : '#9a5d00';
    const sh = document.createElementNS(SVGNS, sq ? 'rect' : 'circle');
    if (sq) { sh.setAttribute('x', 50 - r); sh.setAttribute('y', 50 - r); sh.setAttribute('width', 2 * r); sh.setAttribute('height', 2 * r); sh.setAttribute('rx', big ? 10 : 6); }
    else { sh.setAttribute('cx', 50); sh.setAttribute('cy', 50); sh.setAttribute('r', r); }
    sh.setAttribute('fill', fill); sh.setAttribute('stroke', edge); sh.setAttribute('stroke-width', big ? 5 : 4);
    svg.append(sh);
    if (star) {
      const s = r * 0.62, t = s * 0.28, st = document.createElementNS(SVGNS, 'path');
      st.setAttribute('d', `M50 ${50 - s} L${50 + t} ${50 - t} L${50 + s} 50 L${50 + t} ${50 + t} L50 ${50 + s} L${50 - t} ${50 + t} L${50 - s} 50 L${50 - t} ${50 - t} Z`);
      st.setAttribute('fill', '#fff'); st.setAttribute('stroke', edge); st.setAttribute('stroke-width', 2);
      svg.append(st);
    }
    return svg;
  }

  // a full line's points, as on the server: per trait 2 (four alike), 1 (three alike), 0 (2–2)
  const linePts = (ps) => BITS.reduce((t, [b]) => t + Math.abs(ps.filter((x) => x & b).length - 2), 0);
  function gainAt(board, lines, cell, piece) {
    let pts = 0;
    for (const ln of lines) {
      if (!ln.includes(cell) || !ln.every((c) => c === cell || board[c] != null)) continue;
      pts += linePts(ln.map((c) => (c === cell ? piece : board[c])));
    }
    return pts;
  }
  const bestReply = (board, lines, piece) => Math.max(0, ...board.map((v, c) => (v == null ? gainAt(board, lines, c, piece) : 0)));

  function mount(main, side) {
    cellSel = null; seen = '';
    main.innerHTML = `<div class="kn">
      <div class="kn-top"><div id="knSeats" class="kn-seats"></div></div>
      <div id="knHand" class="kn-hand"></div>
      <div id="knBoard" class="kn-board" aria-label="Board"></div>
      <div id="knPoolHead" class="kn-poolhead"></div>
      <div id="knPool" class="kn-pool"></div></div>`;
    side.innerHTML = `<div class="panel"><h3>🦋 Scoring a line</h3>
      <p class="hint left">Per trait: <b>4 alike = 2</b>, <b>3 alike = 1</b>, 2–2 = 0. Up to 8 a line.</p>
      <div id="knStand" class="kn-stand" hidden></div>
      <div class="row"><button id="knResign" class="danger">🏳️ Resign</button></div></div>`;
    const board = $('knBoard');
    for (let c = 0; c < 16; c++) {
      const b = ctx?.el ? ctx.el('button', 'kn-cell') : Object.assign(document.createElement('button'), { className: 'kn-cell' });
      b.setAttribute('aria-label', `${'abcd'[c % 4]}${Math.floor(c / 4) + 1}`);
      b.onclick = () => tapCell(c);
      board.append(b);
    }
    if (typeof gridKeys === 'function') gridKeys(board, 4);
    $('knResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  const k = () => S.kindred;
  const placing = () => ctx.myTurn && k().stage === 'place' && k().hand != null;
  const lastMove = () => k().board.filter((v) => v == null).length === 1;

  function tapCell(c) {
    if (!placing() || k().board[c] != null) return;
    if (lastMove()) return send(c, null);  // the last square: nothing left to hand over
    cellSel = cellSel === c ? null : c;
    render(S, ctx);
  }
  function tapPiece(p) {
    if (!ctx.myTurn) return;
    const kd = k();
    if (kd.stage === 'give') return send(null, p);
    if (kd.stage === 'place' && cellSel != null) send(cellSel, p);
    else ctx.toast('First tap a square for your piece.');
  }
  function send(cell, give) {
    const a = {}; if (cell != null) a.cell = cell; if (give != null) a.give = give;
    cellSel = null;
    ctx.quiet(ctx.act('move', a));
  }

  function render(s, c) {
    S = s; ctx = c;
    const kd = k(), board = $('knBoard');
    if (!placing()) cellSel = null;
    // seats and scores
    const seats = $('knSeats'); seats.innerHTML = '';
    kd.seats.forEach((pid, i) => {
      const p = ctx.player(pid), d = ctx.el('div', 'kn-seat' + (S.turn === pid ? ' turn' : '') + (i === kd.me ? ' me' : ''));
      d.append(ctx.el('span', 'kn-name', `${p?.name ?? 'left'}${i === kd.me ? ' (you)' : ''}`), ctx.el('b', '', String(kd.scores[i])));
      seats.append(d);
    });
    seats.append(ctx.el('span', 'kn-round', `Board ${kd.round + 1}/${kd.rounds}`));
    // the piece in hand, and what to do
    const hand = $('knHand'); hand.innerHTML = '';
    const rival = ctx.player(kd.seats[1 - (kd.me ?? 0)])?.name ?? 'your rival';
    const mover = ctx.player(S.turn)?.name ?? '…';
    let say;
    if (kd.stage === 'between') say = '📊 Board full! The next one starts in a moment.';
    else if (S.phase !== 'playing') say = '';
    else if (kd.stage === 'give') say = ctx.myTurn ? `🎁 You give first: tap a piece below for ${rival} to place.` : `🎁 ${mover} is choosing your first piece…`;
    else if (ctx.myTurn) say = cellSel == null ? (lastMove() ? 'Last square: tap it to place your piece.' : '① Tap a square for this piece (the numbers are what it scores).') : `② Now tap the piece ${rival} must place next.`;
    else say = `${mover} is placing…`;
    if (kd.hand != null && kd.stage === 'place') {
      const box = ctx.el('div', 'kn-inhand');
      box.append(pieceSvg(kd.hand));
      hand.append(box);
    }
    const txt = ctx.el('div', 'kn-say'); txt.append(ctx.el('b', '', say));
    if (kd.hand != null && kd.stage === 'place') txt.append(ctx.el('small', '', `In hand: ${name(kd.hand)}`));
    hand.append(txt);
    // board: pieces, the last one ringed, the lines just scored glowing; my hints on empty squares
    const fresh = `${kd.round}:${kd.last}:${kd.board.filter((v) => v != null).length}`;
    const isNew = fresh !== seen && seen !== '';
    seen = fresh;
    const glow = new Set((kd.scored || []).filter((x) => x.pts > 0).flatMap((x) => x.cells));
    [...board.children].forEach((b, i) => {
      const v = kd.board[i];
      b.innerHTML = '';
      b.classList.toggle('last', i === kd.last);
      b.classList.toggle('glow', glow.has(i));
      b.classList.toggle('sel', i === cellSel);
      const can = placing() && v == null;
      b.classList.toggle('can', can);
      b.disabled = !can;
      if (v != null) b.append(pieceSvg(v));
      else if (i === cellSel) { const g = pieceSvg(kd.hand); g.classList.add('ghost'); b.append(g); }
      if (can) {
        const n = gainAt(kd.board, kd.lines, i, kd.hand);
        if (n) b.append(ctx.el('span', 'kn-gain', `+${n}`));
      }
    });
    if (isNew && kd.last != null) {
      ctx.sfx?.('place');
      const pts = (kd.scored || []).reduce((t, x) => t + x.pts, 0);
      if (pts && typeof Kit !== 'undefined') Kit.flyText(board.children[kd.last], `+${pts}`, pts >= 5 ? 'gold' : 'good');
    }
    // the pool: pieces left to hand over; while choosing, each shows the most the rival could score with it
    const pool = $('knPool'); pool.innerHTML = '';
    const choosing = ctx.myTurn && (kd.stage === 'give' || (kd.stage === 'place' && cellSel != null));
    const after = kd.board.slice(); if (cellSel != null) after[cellSel] = kd.hand;
    $('knPoolHead').textContent = choosing ? `Hand ${rival} a piece: the number is the most they could score with it` : `Pieces left (${kd.pool.length})`;
    for (const p of kd.pool) {
      const b = ctx.el('button', 'kn-pp' + (choosing ? ' can' : ''));
      b.disabled = !choosing;
      b.setAttribute('aria-label', name(p));
      b.append(pieceSvg(p));
      if (choosing) {
        const n = bestReply(after, kd.lines, p);
        b.append(ctx.el('span', 'kn-risk' + (n >= 4 ? ' hot' : n ? '' : ' safe'), n ? `+${n}` : '0'));
      }
      b.onclick = () => tapPiece(p);
      pool.append(b);
    }
    // between boards: the standings card
    const st = $('knStand');
    if (kd.standings && typeof standingsCard === 'function') standingsCard(st, kd.standings, { title: `After board ${kd.round + 1}`, note: 'Highest total wins.' });
    else st.hidden = true;
    $('knResign').hidden = kd.me == null;
    $('knResign').disabled = S.phase !== 'playing';
  }

  const turnText = (s) => (s.phase !== 'playing' ? null : s.kindred.stage === 'between' ? '📊 Next board soon…' : null);
  return { mount, render, turnText, ownSounds: true };
})();
