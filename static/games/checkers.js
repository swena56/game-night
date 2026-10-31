UI.checkers = (() => {
  let S, ctx, boardEl, sel = null, shownLast;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = null; shownLast = undefined;
    main.innerHTML = '<div class="chessboard checkers"></div>';
    side.innerHTML = `<div class="panel">
      <div id="ckStatus" class="seat-row"></div>
      <p class="hint left">Tap a piece, then where it should land. Captures are compulsory and multi-jumps happen in one go.</p>
      <div class="row"><button id="ckResign" class="danger">🏳️ Resign</button></div></div>`;
    boardEl = main.querySelector('.chessboard');
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('button');
      sq.className = 'csq';
      sq.onclick = () => onSquare(i);
      boardEl.append(sq);
    }
    $('ckResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  const flip = () => S.checkers.me === 'l';
  const rc = (i) => { const r = Math.floor(i / 8), c = i % 8; return flip() ? [7 - r, 7 - c] : [r, c]; };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];

  function render(s, c) {
    S = s; ctx = c;
    const ck = S.checkers;
    if (!ctx.myTurn) sel = null;
    const fromMe = sel ? ck.moves.filter((m) => same(m[0], sel)) : [];
    const ends = new Set(fromMe.map((m) => m.at(-1).join()));
    const via = new Set(fromMe.flatMap((m) => m.slice(1, -1).map((x) => x.join())));
    const starts = new Set(ck.moves.map((m) => m[0].join()));
    const last = new Set((ck.last || []).map((x) => x.join()));
    const lastKey = ck.last ? ck.last.join(';') : null, animate = shownLast !== undefined && lastKey && lastKey !== shownLast;
    shownLast = lastKey;
    const [from, to] = ck.last ? [ck.last[0], ck.last.at(-1)] : [];
    [...boardEl.children].forEach((sq, i) => {
      const [r, col] = rc(i), k = `${r},${col}`;
      const p = ck.board[r][col];
      sq.className = 'csq ' + ((r + col) % 2 ? 'dark' : 'light');
      if (last.has(k)) sq.classList.add('last');
      if (sel && same(sel, [r, col])) sq.classList.add('sel');
      if (ends.has(k)) sq.classList.add('target');
      if (via.has(k)) sq.classList.add('via');
      if (!sel && ctx.myTurn && starts.has(k)) sq.classList.add('movable');
      sq.innerHTML = '';
      if (p) {
        const disc = ctx.el('span', 'checker ' + p.toLowerCase(), p === p.toUpperCase() ? '♛︎' : '');
        if (animate && to[0] === r && to[1] === col) slideFrom(disc, from[0] - r, from[1] - col, flip());
        sq.append(disc);
      }
    });
    const mine = ck.me ? (ck.me === 'd' ? '⚫ You play Dark' : '⚪ You play Light') : '👁 Watching';
    const forced = ctx.myTurn && ck.forced;
    $('ckStatus').textContent = mine + (forced ? ' · ⚠️ you must capture' : '');
    $('ckResign').disabled = S.phase !== 'playing' || !ck.me;
  }

  function onSquare(i) {
    if (!ctx.myTurn) return;
    const [r, c] = rc(i);
    const moves = S.checkers.moves;
    if (sel) {
      const path = moves.find((m) => same(m[0], sel) && same(m.at(-1), [r, c]));
      if (path) { sel = null; ctx.quiet(ctx.act('move', { path })); return ctx.rerender(); }
    }
    sel = moves.some((m) => same(m[0], [r, c])) ? [r, c] : null;
    ctx.rerender();
  }

  return { mount, render };
})();
