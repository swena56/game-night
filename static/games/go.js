UI.go = (() => {
  let S, ctx, boardEl, size = 0, shownLast, showArea = false, prevBoard = null, filled = false;
  const STARS = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    size = 0; shownLast = undefined; showArea = false; prevBoard = null; filled = false;
    main.innerHTML = '<div class="goban"></div>';
    side.innerHTML = `<div class="panel">
      <div id="goStatus" class="seat-row"></div>
      <div id="goScore" class="hint left"></div>
      <div class="go-bowls"><div class="go-bowl" id="goBowlB" title="White stones Black has captured"><span></span><b></b></div>
        <div class="go-bowl" id="goBowlW" title="Black stones White has captured"><span></span><b></b></div></div>
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
    // stones that vanished since the last redraw were captured: they lift off the board
    const gone = prevBoard && prevBoard.length === n ? prevBoard.flatMap((row, r) => row.map((v, col) => (v && !g.board[r][col] ? [r, col, v] : null))).filter(Boolean) : [];
    // when the game ends, territory fills in from the centre outwards
    const fillIn = S.phase !== 'playing' && !filled && prevBoard != null;
    if (S.phase !== 'playing') filled = true;
    [...boardEl.children].forEach((pt, i) => {
      const r = Math.floor(i / n), col = i % n, v = g.board[r][col];
      pt.setAttribute('aria-label', `${'ABCDEFGHJKLMNOPQRST'[col]}${n - r}, ${v === 'b' ? 'black stone' : v === 'w' ? 'white stone' : area.has(i) ? `${area.get(i) === 'b' ? 'black' : 'white'} territory` : 'empty'}`);
      pt.innerHTML = '';
      pt.disabled = !ctx.myTurn || !!v;
      if (v) {
        const stone = ctx.el('span', 'stone ' + v);
        if (g.last && g.last[0] === r && g.last[1] === col) stone.classList.add('last', ...(fresh ? ['drop'] : []));
        pt.append(stone);
      } else if (area.has(i)) {
        const a = ctx.el('span', 'go-area ' + area.get(i) + (fillIn ? ' fill' : ''));
        if (fillIn) a.style.animationDelay = Math.hypot(r - (n - 1) / 2, col - (n - 1) / 2) * 0.06 + 's';
        pt.append(a);
      }
      else if (ctx.myTurn) pt.append(ctx.el('span', 'ghost-stone ' + g.me));
    });
    // captured stones lift off and fly into the capturer's bowl of prisoners
    gone.forEach(([r, col, v], k) => {
      const pt = boardEl.children[r * n + col];
      const ghost = ctx.el('span', 'stone ' + v + ' go-gone'), flyer = ctx.el('span', 'stone ' + v);
      pt?.append(ghost, flyer);
      Kit.fly(flyer, $(v === 'w' ? 'goBowlB' : 'goBowlW').firstElementChild, { ms: 560, delay: 120 + k * 70, scale: 0.45, remove: false });
      flyer.remove();
      setTimeout(() => ghost.remove(), 700);
    });
    bowls(g, gone.length ? 680 + gone.length * 70 : 0);
    if (fresh && lastKey) ctx.sfx('place');
    if (gone.length) setTimeout(() => ctx.sfx('capture'), 120);
    if (gone.length >= 4) Kit.callout(`${gone.length} captured!`, 'gold', { ms: 1200 });
    if (fillIn) setTimeout(() => ctx.sfx('sweep'), 100);
    prevBoard = g.board.map((row) => [...row]);
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

  // each side's prisoners: a little pile of the rival's stones (up to 14 drawn) with the count
  function bowls(g, wait) {
    for (const [c, id] of [['b', 'goBowlB'], ['w', 'goBowlW']]) {
      const bowl = $(id), pile = bowl.firstElementChild, n = g.captures[c];
      if (bowl.dataset.n === String(n)) continue;
      const grew = bowl.dataset.n != null && n > +bowl.dataset.n;
      const fill = () => {
        pile.innerHTML = '';
        for (let k = 0; k < Math.min(n, 14); k++) {
          const st = ctx.el('i', 'stone ' + (c === 'b' ? 'w' : 'b'));
          st.style.setProperty('--x', `${50 + 30 * Math.sin(k * 2.4) * Math.min(1, k / 4)}%`);
          st.style.setProperty('--y', `${60 - 18 * Math.cos(k * 2.4) * Math.min(1, k / 4) - k}%`);
          pile.append(st);
        }
        bowl.lastElementChild.textContent = `${c === 'b' ? '⚫' : '⚪'} ${n}`;
        if (grew) { bowl.classList.remove('bump'); void bowl.offsetWidth; bowl.classList.add('bump'); }
      };
      bowl.dataset.n = n;
      grew && wait ? setTimeout(fill, wait) : fill();
    }
  }

  return { mount, render, ownSounds: true };
})();
