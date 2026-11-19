UI.checkers = (() => {
  let S, ctx, boardEl, sel = null, shownLast, shownKings = 0, replayIx = null, replayOpen = false, replayTimer = 0;
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    sel = null; shownLast = undefined; shownKings = 0; replayIx = null; replayOpen = false; clearInterval(replayTimer); replayTimer = 0;
    main.innerHTML = '<div class="chessboard checkers"></div>';
    side.innerHTML = `<div class="panel">
      <div id="ckStatus" class="seat-row"></div>
      <div id="ckTray" class="ck-tray"></div>
      <p class="hint left">Tap a piece, then where it should land. Captures are compulsory and multi-jumps happen in one go.</p>
      <div id="ckDraw" class="row"></div><div id="ckUndo" class="row"></div>
      <div class="ck-replay"><button id="ckReplayToggle" type="button">↶ Review moves</button><div id="ckReplayPanel" hidden>
        <button id="ckReplayPlay" type="button">▶ Play replay</button><input id="ckReplayRange" type="range" min="0" value="0" aria-label="Replay move">
        <p id="ckReplayLabel" aria-live="polite"></p></div></div>
      <div class="row"><button id="ckResign" class="danger">🏳️ Resign</button></div></div>`;
    $('ckReplayToggle').onclick = () => {
      replayOpen = !replayOpen;
      if (!replayOpen) { replayIx = null; clearInterval(replayTimer); replayTimer = 0; }
      ctx.rerender();
    };
    $('ckReplayRange').oninput = (e) => { replayIx = +e.target.value; sel = null; ctx.rerender(); };
    $('ckReplayPlay').onclick = playReplay;
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

  const replayBoard = (code) => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
    const ch = code?.[r * 8 + c] || '.'; return ch === '.' ? null : ch;
  }));
  const squareName = ([r, c]) => `${'abcdefgh'[c]}${8 - r}`;
  function renderReplay(ck) {
    if (!ck) return;
    const history = ck.history || [], toggle = $('ckReplayToggle'), panel = $('ckReplayPanel'), range = $('ckReplayRange');
    toggle.hidden = !history.length; panel.hidden = !history.length || !replayOpen;
    if (!history.length) { replayIx = null; return; }
    range.max = String(history.length); range.value = String(replayIx == null ? history.length : Math.min(replayIx, history.length));
    const record = replayIx == null || replayIx === 0 ? null : history[Math.min(replayIx, history.length) - 1];
    const position = replayIx == null ? 'Live board' : replayIx === 0 ? 'Starting position' : `Move ${replayIx}/${history.length}`;
    const notation = record ? ` · ${record.side === 'd' ? 'Dark' : 'Light'}: ${record.path.map(squareName).join(record.taken ? ' × ' : ' → ')}${record.promoted ? ' · crowned' : ''}` : '';
    $('ckReplayLabel').textContent = position + notation;
    $('ckReplayPlay').textContent = replayTimer ? '⏸ Pause replay' : '▶ Play replay';
  }
  function playReplay() {
    if (replayTimer) { clearInterval(replayTimer); replayTimer = 0; renderReplay(S?.checkers); return; }
    const total = S?.checkers?.history?.length || 0; if (!total) return;
    replayOpen = true;
    if (replayIx == null || replayIx >= total) replayIx = 0;
    ctx.rerender();
    replayTimer = setInterval(() => {
      if (replayIx >= total) { clearInterval(replayTimer); replayTimer = 0; replayIx = null; replayOpen = false; ctx.rerender(); return; }
      replayIx++; ctx.rerender();
    }, 850);
    renderReplay(S.checkers);
  }

  function unmount() { clearInterval(replayTimer); replayTimer = 0; }

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
      fade.oncancel = () => ghost.remove();
      // the taken piece is carried off to the tray beside the board
      fade.onfinish = () => { Kit.fly(ghost, $('ckTray'), { ms: 500, scale: 0.4 }); ghost.remove(); };
    });
  }
  // did the last move make a king? (one more king on the board than before it)
  const crownedNow = (ck) => ck.board.flat().filter((x) => x && x === x.toUpperCase()).length > shownKings;
  function render(s, c) {
    S = s; ctx = c;
    const ck = S.checkers;
    const history = ck.history || [];
    if (replayIx != null) replayIx = Math.min(replayIx, history.length);
    const reviewing = replayIx != null;
    if (!ctx.myTurn || reviewing) sel = null;
    const record = reviewing && replayIx > 0 ? history[replayIx - 1] : null;
    const board = !reviewing ? ck.board : replayIx === 0 ? ck.initial : replayBoard(record?.board);
    const lastPath = reviewing ? record?.path : ck.last;
    const moves = reviewing ? [] : ck.moves;
    const fromMe = sel ? moves.filter((m) => same(m[0], sel)) : [];
    const ends = new Set(fromMe.map((m) => m.at(-1).join()));
    const via = new Set(fromMe.flatMap((m) => m.slice(1, -1).map((x) => x.join())));
    const starts = new Set(moves.map((m) => m[0].join()));
    const last = new Set((lastPath || []).map((x) => x.join()));
    const lastKey = lastPath ? lastPath.join(';') : null, animate = !reviewing && shownLast !== undefined && lastKey && lastKey !== shownLast;
    shownLast = lastKey;
    const [from, to] = lastPath ? [lastPath[0], lastPath.at(-1)] : [];
    // a capture hops square by square, each taken piece fading as it's jumped (#43); a plain step just slides
    const jumped = animate && lastPath.some((x, i) => i && Math.abs(x[0] - lastPath[i - 1][0]) === 2);
    const hopping = jumped && typeof motionOK === 'function' && motionOK() && !!Element.prototype.animate;
    if (hopping) hopRun = { key: lastKey, start: performance.now() };
    const resume = !reviewing && !animate && hopRun?.key === lastKey ? performance.now() - hopRun.start : null;
    const resuming = resume != null && resume < HOP * ((lastPath?.length || 1) - 1);
    let hopper = null;
    [...boardEl.children].forEach((sq, i) => {
      const [r, col] = rc(i), k = `${r},${col}`;
      const p = board[r][col];
      sq.className = 'csq ' + ((r + col) % 2 ? 'dark' : 'light');
      if (last.has(k)) sq.classList.add('last');
      if (sel && same(sel, [r, col])) sq.classList.add('sel');
      if (ends.has(k)) sq.classList.add('target');
      if (via.has(k)) sq.classList.add('via');
      if (!sel && ctx.myTurn && starts.has(k)) sq.classList.add('movable', ...(ck.forced ? ['must'] : []));
      sq.setAttribute('aria-label', `${'abcdefgh'[col]}${8 - r}, ${p ? `${p.toLowerCase() === 'd' ? 'dark' : 'light'} ${p === p.toUpperCase() ? 'king' : 'man'}` : (r + col) % 2 ? 'empty' : 'light square'}`);
      sq.innerHTML = '';
      if (p) {
        const disc = ctx.el('span', 'checker ' + p.toLowerCase() + (p === p.toUpperCase() ? ' king' : ''), p === p.toUpperCase() ? '♛︎' : '');
        if (to && to[0] === r && to[1] === col) {
          // just crowned: the crown drops onto the piece once it has landed
          if (animate && p === p.toUpperCase() && crownedNow(ck)) { disc.classList.add('crowned'); disc.style.setProperty('--cd', `${hopping ? (HOP * (lastPath.length - 1)) / 1000 : 0.25}s`); }
          if (hopping || resuming) hopper = [disc, p.toLowerCase()];
          else if (animate) slideFrom(disc, from[0] - r, from[1] - col, flip());
        }
        sq.append(disc);
      }
      // the board's edges carry rank and file labels, like the chessboard's
      if (i % 8 === 0) sq.append(ctx.el('span', 'coord rank', String(8 - r)));
      if (i >= 56) sq.append(ctx.el('span', 'coord file', 'abcdefgh'[col]));
    });
    // after every square is drawn, so the ghosts of taken pieces aren't cleared away again
    if (hopper) hopAlong(hopper[0], lastPath, hopper[1], hopping ? 0 : resume);
    // a multi-jump gets a callout as it lands, and each hop clicks
    if (hopping) {
      const hops = lastPath.length - 1;
      for (let k = 1; k <= hops; k++) setTimeout(() => ctx.sfx('capture'), HOP * k - 60);
      if (hops >= 2) setTimeout(() => Kit.callout(hops === 2 ? 'Double jump!' : hops === 3 ? 'Triple jump!' : `${hops}× jump!`, 'gold'), HOP * hops);
    } else if (animate) ctx.sfx('place');
    const kings = board.flat().filter((x) => x && x === x.toUpperCase()).length;
    if (animate && kings > shownKings) setTimeout(() => { ctx.sfx('good'); Kit.callout('👑 Crowned!', 'gold', { ms: 1100 }); }, hopping ? HOP * (lastPath.length - 1) : 250);
    shownKings = kings;
    // pieces taken so far: 12 each to start
    const tray = $('ckTray'); tray.innerHTML = '';
    // material: a bar split by what each side has left (kings count as one and a half)
    const worth = (sd) => board.flat().reduce((t, x) => t + (x && x.toLowerCase() === sd ? (x === x.toUpperCase() ? 1.5 : 1) : 0), 0);
    const wd = worth('d'), wl = worth('l'), bar = ctx.el('div', 'ck-material');
    const fill = ctx.el('i'); fill.style.width = `${wd + wl ? (100 * wd) / (wd + wl) : 50}%`; bar.append(fill);
    bar.title = `Material: dark ${wd}, light ${wl}`;
    tray.append(bar);
    for (const side of ['d', 'l']) {
      const left = board.flat().filter((x) => x && x.toLowerCase() === side).length, lost = 12 - left;
      const span = ctx.el('span', '', `${side === 'd' ? '⚫' : '⚪'} ${left} `);
      const pile = ctx.el('span', '');
      for (let k = 0; k < lost; k++) pile.append(ctx.el('i', 'mini ' + side));
      span.append(pile);
      tray.append(span);
    }
    const mine = ck.me ? (ck.me === 'd' ? '⚫ You play Dark' : '⚪ You play Light') : '👁 Watching';
    const forced = ctx.myTurn && ck.forced;
    $('ckStatus').textContent = (reviewing ? '↶ Reviewing · ' : '') + mine + (forced ? ' · ⚠️ you must capture' : '');
    $('ckResign').disabled = S.phase !== 'playing' || !ck.me || reviewing;
    const dr = $('ckDraw'); dr.innerHTML = '';
    if (!reviewing && S.phase === 'playing' && ck.me) {
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
    $('ckUndo').hidden = reviewing;
    renderReplay(ck);
  }

  function onSquare(i) {
    if (!ctx.myTurn || replayIx != null) return;
    const [r, c] = rc(i);
    const moves = S.checkers.moves;
    if (sel) {
      const path = moves.find((m) => same(m[0], sel) && same(m.at(-1), [r, c]));
      if (path) { sel = null; ctx.quiet(ctx.act('move', { path })); return ctx.rerender(); }
    }
    sel = moves.some((m) => same(m[0], [r, c])) ? [r, c] : null;
    // tapping one of your pieces that can't move while a capture is due: say why, and shake it
    const p = S.checkers.board[r][c];
    if (!sel && p && p.toLowerCase() === S.checkers.me && S.checkers.forced) {
      ctx.toast('You must capture: use a glowing piece.');
      const disc = boardEl.children[i]?.querySelector('.checker');
      if (disc && motionOK()) { disc.classList.remove('nope'); void disc.offsetWidth; disc.classList.add('nope'); }
      return;
    }
    ctx.rerender();
  }

  return { mount, render, unmount, ownSounds: true };
})();
