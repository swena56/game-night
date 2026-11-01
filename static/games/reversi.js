// Reversi: an 8×8 board; your legal squares glow, the last disc is ringed and flipped discs spin over.
UI.reversi = (() => {
  let S, ctx, board, seen = '';
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    seen = '';
    main.innerHTML = '<div class="rv"><div class="rv-board" id="rvBoard"></div><p id="rvHint" class="hint"></p><div id="rvUndo" class="row center"></div></div>';
    side.innerHTML = '<div class="panel"><div id="rvSeats"></div></div>';
    board = $('rvBoard');
    for (let c = 0; c < 64; c++) {
      const b = ctx?.el ? ctx.el('button', 'rv-cell') : Object.assign(document.createElement('button'), { className: 'rv-cell' });
      b.setAttribute('aria-label', `${'abcdefgh'[c % 8]}${Math.floor(c / 8) + 1}`);
      b.onclick = () => ctx.myTurn && ctx.quiet(ctx.act('place', { cell: c }));
      board.append(b);
    }
    gridKeys(board, 8);
  }

  function render(s, c) {
    S = s; ctx = c;
    const r = S.reversi, legal = new Set(r.legal), flipped = new Set(r.flipped);
    const fresh = `${r.last}:${r.counts}` !== seen;  // animate flips once per move
    seen = `${r.last}:${r.counts}`;
    [...board.children].forEach((b, i) => {
      const v = r.board[i];
      b.classList.toggle('can', legal.has(i) && ctx.myTurn);
      b.classList.toggle('last', i === r.last);
      b.disabled = !(legal.has(i) && ctx.myTurn);
      const n = ctx.myTurn ? r.flipCounts?.[i] : null;  // flip hint: how many discs this square flips
      if (n) b.dataset.flips = n; else delete b.dataset.flips;
      let disc = b.querySelector('.rv-disc');
      if (v == null) { disc?.remove(); return; }
      if (!disc) { disc = ctx.el('span', 'rv-disc'); b.append(disc); }
      disc.className = 'rv-disc ' + (v === 0 ? 'dark' : 'light') + (fresh && flipped.has(i) ? ' flip' : '') + (fresh && i === r.last ? ' drop' : '');
    });
    const info = $('rvSeats'); info.innerHTML = '';
    r.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      row.append(ctx.el('span', 'rv-disc mini ' + (i === 0 ? 'dark' : 'light')), ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === r.me ? ' (you)' : ''}`), ctx.el('b', '', String(r.counts[i])));
      info.append(row);
    });
    $('rvHint').textContent = S.phase === 'playing' && ctx.myTurn ? 'Tap a glowing square.' : '';
    undoRow($('rvUndo'), r.undo, S, ctx, r.me != null);
  }

  return { mount, render };
})();
