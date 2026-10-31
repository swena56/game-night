UI.go = (() => {
  let S, ctx, boardEl, size = 0, shownLast, showArea = false;
  const STARS = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    size = 0; shownLast = undefined; showArea = false;
    main.innerHTML = '<div class="goban"></div>';
    side.innerHTML = `<div class="panel">
      <div id="goStatus" class="seat-row"></div>
      <div id="goScore" class="hint left"></div>
      <div class="row"><button id="goPass">Pass</button><button id="goResign" class="danger">🏳️ Resign</button></div>
      <div class="row" id="goUndo"></div>
      <div class="row"><button id="goArea">◫ Show territory</button></div>
      <p class="hint left">Area scoring: stones + surrounded empty points. Capture dead stones
      before you both pass — the board is scored exactly as it stands.</p></div>`;
    boardEl = main.querySelector('.goban');
    $('goPass').onclick = async () => {
      const msg = S.go.passes ? 'Your opponent passed. Passing now ends the game and scores the board. Pass?' : 'Pass your turn?';
      if (await ctx.ask(msg, { ok: 'Pass' })) ctx.quiet(ctx.act('pass'));
    };
    $('goArea').onclick = () => { showArea = !showArea; ctx.rerender(); };
    $('goResign').onclick = async () => (await ctx.ask('Resign this game?', { ok: '🏳️ Resign', danger: true })) && ctx.quiet(ctx.act('resign'));
  }

  function build(n) {
    size = n; boardEl.innerHTML = '';
    boardEl.style.setProperty('--n', n);
    const stars = STARS[n] || [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const pt = document.createElement('button');
        pt.className = 'go-pt' + (r === 0 ? ' t' : '') + (r === n - 1 ? ' b' : '') + (c === 0 ? ' l' : '') + (c === n - 1 ? ' r' : '');
        if (stars.includes(r) && stars.includes(c) && (n !== 9 || (r === c || r + c === n - 1))) pt.classList.add('star');
        pt.onclick = () => ctx.myTurn && ctx.quiet(ctx.act('move', { r, c }));
        boardEl.append(pt);
      }
    gridKeys(boardEl, n);
  }

  function render(s, c) {
    S = s; ctx = c;
    const g = S.go, n = g.board.length;
    if (n !== size) build(n);
    const lastKey = g.last?.join() ?? null, fresh = shownLast !== undefined && lastKey !== shownLast;
    shownLast = lastKey;
    const area = showArea || S.phase !== 'playing' ? new Map(g.territory.map(([r, col, o]) => [r * n + col, o])) : new Map();
    [...boardEl.children].forEach((pt, i) => {
      const r = Math.floor(i / n), col = i % n, v = g.board[r][col];
      pt.setAttribute('aria-label', `${'ABCDEFGHJKLMNOPQRST'[col]}${n - r}, ${v === 'b' ? 'black stone' : v === 'w' ? 'white stone' : area.has(i) ? `${area.get(i) === 'b' ? 'black' : 'white'} territory` : 'empty'}`);
      pt.innerHTML = '';
      pt.disabled = !ctx.myTurn || !!v;
      if (v) {
        const stone = ctx.el('span', 'stone ' + v);
        if (g.last && g.last[0] === r && g.last[1] === col) stone.classList.add('last', ...(fresh ? ['drop'] : []));
        pt.append(stone);
      } else if (area.has(i)) pt.append(ctx.el('span', 'go-area ' + area.get(i)));
      else if (ctx.myTurn) pt.append(ctx.el('span', 'ghost-stone ' + g.me));
    });
    const mine = g.me ? (g.me === 'b' ? '⚫ You play Black' : `⚪ You play White (+${g.komi})`) : '👁 Watching';
    $('goStatus').textContent = mine + (g.passes && S.phase === 'playing' ? ' · opponent passed' : '');
    $('goScore').textContent = `Score if it ended now — ⚫ ${g.score.b} : ⚪ ${g.score.w} · captures ⚫ ${g.captures.b} ⚪ ${g.captures.w}`;
    $('goPass').disabled = !ctx.myTurn;
    $('goResign').disabled = S.phase !== 'playing' || !g.me;
    const ar = $('goArea');
    ar.hidden = S.phase !== 'playing';
    ar.textContent = showArea ? '◫ Hide territory' : '◫ Show territory';
    const un = $('goUndo'); un.innerHTML = '';
    if (S.phase === 'playing' && g.me) {
      if (g.undo.asker && g.undo.asker !== S.me.id) {
        const yes = ctx.el('button', 'primary', '↶ Allow undo'); yes.onclick = () => ctx.quiet(ctx.act('undo_yes'));
        const no = ctx.el('button', '', 'Refuse'); no.onclick = () => ctx.quiet(ctx.act('undo_no'));
        un.append(yes, no);
      } else {
        const b = ctx.el('button', '', g.undo.asker ? 'Undo asked…' : '↶ Undo my move');
        b.disabled = !!g.undo.asker || !g.undo.can; b.onclick = () => ctx.quiet(ctx.act('undo_ask'));
        un.append(b);
      }
    }
  }

  return { mount, render };
})();
