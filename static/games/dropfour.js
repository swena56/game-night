UI.dropfour = (() => {
  let S, ctx, board, dims = '', bombArmed = false;

  function mount(main, side) {
    dims = ''; bombArmed = false;
    main.innerHTML = '<div class="d4"></div>';
    side.innerHTML = `<div class="panel"><div id="d4Info"></div>
      <div id="d4Moves" class="d4-moves"></div>
      <button id="bombBtn" class="danger" hidden>💣 Arm bomb</button></div>`;
    board = main.querySelector('.d4');
    document.getElementById('bombBtn').onclick = () => { bombArmed = !bombArmed; ctx.rerender(); };
  }

  function render(s, c) {
    S = s; ctx = c;
    const d = S.d4, rows = d.grid.length, cols = d.grid[0].length;
    if (dims !== `${rows}x${cols}`) {
      dims = `${rows}x${cols}`;
      board.innerHTML = '';
      board.style.setProperty('--cols', cols);
      for (let r = 0; r < rows; r++)
        for (let col = 0; col < cols; col++) {
          const cell = ctx.el('button', 'd4-cell');
          cell.onclick = () => drop(col);
          board.append(cell);
        }
      gridKeys(board, cols);
    }
    const win = new Set((d.line || []).map(([r, c]) => r * cols + c));
    const last = d.last ? d.last[0] * cols + d.last[1] : -1;
    [...board.children].forEach((cell, i) => {
      const v = d.grid[Math.floor(i / cols)][i % cols];
      cell.style.setProperty('--disc', v == null ? 'transparent' : ctx.player(d.seats[v])?.color ?? '#777');
      cell.classList.toggle('filled', v != null);
      cell.setAttribute('aria-label', `column ${i % cols + 1}, row ${rows - Math.floor(i / cols)}: ${v == null ? 'empty' : `${ctx.player(d.seats[v])?.name ?? '?'}'s disc`}`);
      cell.classList.toggle('win', win.has(i));
      cell.classList.toggle('last', i === last);
      cell.style.setProperty('--fall', Math.floor(i / cols) + 1);
      cell.disabled = !ctx.myTurn;
    });
    board.classList.toggle('armed', bombArmed);

    const info = document.getElementById('d4Info'); info.innerHTML = '';
    for (const pid of d.seats) {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row');
      const disc = ctx.el('span', 'mini-disc'); disc.style.background = p?.color ?? '#777';
      row.append(disc, `${p?.name ?? 'left'}${pid === S.me.id ? ' (you)' : ''}`);
      info.append(row);
    }
    const hist = document.getElementById('d4Moves'), moves = d.moves || [];
    hist.innerHTML = '';
    hist.hidden = !moves.length;
    moves.forEach(([seat, col, bomb], i) => {
      const m = ctx.el('span', 'd4-move' + (i === moves.length - 1 ? ' now' : ''), bomb ? `💣${col + 1}` : String(col + 1));
      m.style.setProperty('--disc', ctx.player(d.seats[seat])?.color ?? '#777');
      m.title = `Move ${i + 1}: column ${col + 1}`;
      hist.append(m);
    });
    hist.scrollTop = hist.scrollHeight;
    const bb = document.getElementById('bombBtn');
    bb.hidden = !d.bombs || S.phase !== 'playing';
    bb.disabled = !ctx.myTurn;
    bb.classList.toggle('on', bombArmed);
    bb.textContent = bombArmed ? '💣 Armed — pick a column' : '💣 Arm bomb';
  }

  function drop(col) {
    if (!ctx.myTurn) return;
    const bomb = bombArmed;
    bombArmed = false;
    ctx.quiet(ctx.act('drop', { col, bomb }));
  }

  return { mount, render };
})();
