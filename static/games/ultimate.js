// Ultimate Tic-Tac-Toe: nine small boards; the boards you may play in glow, and won boards show a big mark.
UI.ultimate = (() => {
  let S, ctx, big, prevCells = null, prevOpen = '';
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  // small boards that would win the big board for `seat` if `seat` took them
  const threats = (boards, seat) => new Set(boards.map((v, b) => b).filter((b) => boards[b] == null
    && LINES.some((l) => l.includes(b) && l.every((x) => x === b || boards[x] === seat))));
  const MARK = ['✕', '◯'];
  const $ = (id) => document.getElementById(id);

  function mount(main, side) {
    main.innerHTML = '<div class="ut"><div class="ut-big" id="utBig"></div><p id="utHint" class="hint"></p><div id="utUndo" class="row center"></div></div>';
    side.innerHTML = '<div class="panel"><div id="utSeats"></div><p class="hint left">Where you play in a small board sends your rival to that board on the big grid.</p></div>';
    big = $('utBig'); prevCells = null; prevOpen = '';
    for (let b = 0; b < 9; b++) {
      const sb = document.createElement('div'); sb.className = 'ut-small';
      for (let k = 0; k < 9; k++) {
        const cell = document.createElement('button'); cell.className = 'ut-cell';
        const idx = b * 9 + k;
        cell.setAttribute('aria-label', `board ${b + 1}, square ${k + 1}`);
        cell.onclick = () => ctx.myTurn && ctx.quiet(ctx.act('mark', { cell: idx }));
        sb.append(cell);
      }
      sb.append(Object.assign(document.createElement('span'), { className: 'ut-won' }));
      big.append(sb);
    }
  }

  function render(s, c) {
    S = s; ctx = c;
    const u = S.ultimate, legal = new Set(u.legal), open = new Set(u.open);
    const tx = threats(u.boards, 0), to = threats(u.boards, 1);
    // when play is sent to a single board, it zooms up for a moment so you see where you're sent
    const openKey = u.open.join();
    const sent = prevOpen && openKey !== prevOpen && u.open.length === 1 && S.phase === 'playing';
    prevOpen = openKey;
    [...big.children].forEach((sb, b) => {
      const res = u.boards[b];
      sb.classList.toggle('open', open.has(b) && S.phase === 'playing');
      sb.classList.toggle('threat-x', tx.has(b) && S.phase === 'playing');
      sb.classList.toggle('threat-o', to.has(b) && S.phase === 'playing');
      if (sent && open.has(b) && motionOK()) { sb.classList.remove('sent'); void sb.offsetWidth; sb.classList.add('sent'); }
      const wasWon = sb.classList.contains('done');
      sb.classList.toggle('done', res != null);
      const won = sb.lastElementChild;
      won.textContent = res === 0 || res === 1 ? MARK[res] : '';
      won.className = 'ut-won' + (res === 0 ? ' x' : res === 1 ? ' o' : '') + (prevCells && !wasWon && res != null ? ' stamp' : '');
      [...sb.querySelectorAll('.ut-cell')].forEach((cell, k) => {
        const i = b * 9 + k, v = u.cells[i];
        cell.textContent = v == null ? '' : MARK[v];
        cell.className = 'ut-cell' + (v === 0 ? ' x' : v === 1 ? ' o' : '') + (i === u.last ? ' last' : '') + (legal.has(i) && ctx.myTurn ? ' can' : '')
          + (prevCells && v != null && prevCells[i] !== v ? ' fresh' : '');
        cell.disabled = !(legal.has(i) && ctx.myTurn);
      });
    });
    if (prevCells && u.boards.some((v, b) => v != null && big.children[b].querySelector('.stamp'))) ctx.sfx('thud');
    prevCells = [...u.cells];
    const info = $('utSeats'); info.innerHTML = '';
    u.seats.forEach((pid, i) => {
      const p = ctx.player(pid), row = ctx.el('div', 'seat-row');
      row.append(ctx.el('b', i === 0 ? 'ut-x' : 'ut-o', MARK[i]), ctx.el('span', 'grow', `${p?.name ?? 'left'}${i === u.me ? ' (you)' : ''}`),
        ctx.el('span', 'hint', `${u.boards.filter((v) => v === i).length} boards`));
      info.append(row);
    });
    const mine = u.me === 0 ? tx : u.me === 1 ? to : null, theirs = u.me === 0 ? to : u.me === 1 ? tx : null;
    $('utHint').textContent = S.phase !== 'playing' || !ctx.myTurn ? '' : (u.open.length > 1 ? 'Play in any glowing board.' : `Play in board ${u.open[0] + 1}.`)
      + (theirs?.size ? ` ⚠ Your rival wins the game with board ${[...theirs].map((b) => b + 1).join(' or ')}.` : mine?.size ? ` ⭐ Board ${[...mine].map((b) => b + 1).join(' or ')} wins it for you.` : '');
    undoRow($('utUndo'), u.undo, S, ctx, u.me != null);
  }

  return { mount, render };
})();
