UI.checkers = (() => {
  let S, ctx, boardEl, sel = null, shownLast;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = null; shownLast = undefined;
    main.innerHTML = '<div class="chessboard checkers"></div>';
    side.innerHTML = `<div class="panel">
      <div id="ckStatus" class="seat-row"></div>
      <p class="hint left">Tap a piece, then where it should land. Captures are compulsory and multi-jumps happen in one go.</p>
      <div id="ckDraw" class="row"></div><div id="ckUndo" class="row"></div>
      <div class="row"><button id="ckResign" class="danger">🏳️ Resign</button></div></div>`;
    boardEl = main.querySelector('.chessboard');
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('button');
      sq.className = 'csq';
      sq.onclick = () => onSquare(i);
      boardEl.append(sq);
    }
    gridKeys(boardEl, 8);
    $('ckResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  const flip = () => S.checkers.me === 'l';
  const rc = (i) => { const r = Math.floor(i / 8), c = i % 8; return flip() ? [7 - r, 7 - c] : [r, c]; };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];


  // Hop a piece through every square of its capture path, slowly enough to follow: about 0.45 s a jump.
  // The pieces it takes come back as ghosts on their squares and fade as it passes over them.
  const HOP = 450;
  let hopRun = null;  // {key, start}: a hop still playing, picked up again if the board redraws mid-way
  function hopAlong(disc, path, color, elapsed = 0) {
    const s = flip() ? -1 : 1, end = path.at(-1);
    const at = ([r, c]) => `translate(calc(${(c - end[1]) * s} * var(--step, 100%)), calc(${(r - end[0]) * s} * var(--step, 100%)))`;
    const frames = [];
    path.forEach((x, i) => {
      if (i) {  // lift halfway through each hop
        const m = [(x[0] + path[i - 1][0]) / 2, (x[1] + path[i - 1][1]) / 2];
        frames.push({ transform: `${at(m)} scale(1.22)`, offset: (i - 0.5) / (path.length - 1) });
      }
      frames.push({ transform: `${at(x)} scale(1)`, offset: i / (path.length - 1) });
    });
    disc.style.zIndex = 4;
    const run = disc.animate(frames, { duration: HOP * (path.length - 1), easing: 'ease-in-out' });
    run.currentTime = elapsed;
    run.onfinish = run.oncancel = () => { disc.style.zIndex = ''; };
    const other = color === 'd' ? 'l' : 'd';
    path.forEach((x, i) => {
      if (!i || Math.abs(x[0] - path[i - 1][0]) !== 2) return;
      const sq = [...boardEl.children].find((_, k) => same(rc(k), [(x[0] + path[i - 1][0]) / 2, (x[1] + path[i - 1][1]) / 2]));
      if (!sq) return;
      const ghost = ctx.el('span', 'checker ' + other + ' ck-ghost', '');
      sq.append(ghost);
      const fade = ghost.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1)', offset: 0.5 }, { opacity: 0, transform: 'scale(.4)' }],
        { duration: HOP, delay: HOP * (i - 1), fill: 'both' });
      fade.currentTime = elapsed;
      fade.onfinish = fade.oncancel = () => ghost.remove();
    });
  }
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
    // a capture hops square by square, each taken piece fading as it's jumped (#43); a plain step just slides
    const jumped = animate && ck.last.some((x, i) => i && Math.abs(x[0] - ck.last[i - 1][0]) === 2);
    const hopping = jumped && typeof motionOK === 'function' && motionOK() && !!Element.prototype.animate;
    if (hopping) hopRun = { key: lastKey, start: performance.now() };
    const resume = !animate && hopRun?.key === lastKey ? performance.now() - hopRun.start : null;
    const resuming = resume != null && resume < HOP * ((ck.last?.length || 1) - 1);
    let hopper = null;
    [...boardEl.children].forEach((sq, i) => {
      const [r, col] = rc(i), k = `${r},${col}`;
      const p = ck.board[r][col];
      sq.className = 'csq ' + ((r + col) % 2 ? 'dark' : 'light');
      if (last.has(k)) sq.classList.add('last');
      if (sel && same(sel, [r, col])) sq.classList.add('sel');
      if (ends.has(k)) sq.classList.add('target');
      if (via.has(k)) sq.classList.add('via');
      if (!sel && ctx.myTurn && starts.has(k)) sq.classList.add('movable');
      sq.setAttribute('aria-label', `${'abcdefgh'[col]}${8 - r}, ${p ? `${p.toLowerCase() === 'd' ? 'dark' : 'light'} ${p === p.toUpperCase() ? 'king' : 'man'}` : (r + col) % 2 ? 'empty' : 'light square'}`);
      sq.innerHTML = '';
      if (p) {
        const disc = ctx.el('span', 'checker ' + p.toLowerCase(), p === p.toUpperCase() ? '♛︎' : '');
        if (to && to[0] === r && to[1] === col) {
          if (hopping || resuming) hopper = [disc, p.toLowerCase()];
          else if (animate) slideFrom(disc, from[0] - r, from[1] - col, flip());
        }
        sq.append(disc);
      }
    });
    // after every square is drawn, so the ghosts of taken pieces aren't cleared away again
    if (hopper) hopAlong(hopper[0], ck.last, hopper[1], hopping ? 0 : resume);
    const mine = ck.me ? (ck.me === 'd' ? '⚫ You play Dark' : '⚪ You play Light') : '👁 Watching';
    const forced = ctx.myTurn && ck.forced;
    $('ckStatus').textContent = mine + (forced ? ' · ⚠️ you must capture' : '');
    $('ckResign').disabled = S.phase !== 'playing' || !ck.me;
    const dr = $('ckDraw'); dr.innerHTML = '';
    if (S.phase === 'playing' && ck.me) {
      if (ck.drawOffer && ck.drawOffer !== S.me.id) {
        const yes = ctx.el('button', 'primary', '🤝 Accept draw'); yes.onclick = () => ctx.quiet(ctx.act('draw_accept'));
        const no = ctx.el('button', '', 'Decline'); no.onclick = () => ctx.quiet(ctx.act('draw_decline'));
        dr.append(yes, no);
      } else {
        const b = ctx.el('button', '', ck.drawOffer ? 'Draw offered…' : '🤝 Offer draw');
        b.disabled = !!ck.drawOffer; b.onclick = () => ctx.quiet(ctx.act('draw_offer'));
        dr.append(b);
      }
    }
    undoRow($('ckUndo'), ck.undo, S, ctx, !!ck.me);
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
