UI.dropfour = (() => {
  let S, ctx, board, dims = '', bombArmed = false, pullArmed = false, seenMoves = -1, prevGrid = null;

  function mount(main, side) {
    dims = ''; bombArmed = false; pullArmed = false; seenMoves = -1; prevGrid = null;
    main.innerHTML = '<div class="d4"></div>';
    side.innerHTML = `<div class="panel"><div id="d4Info"></div>
      <div id="d4Moves" class="d4-moves"></div>
      <button id="bombBtn" class="danger" hidden>💣 Arm bomb</button>
      <button id="pullBtn" hidden>⬇️ Pull a disc</button>
      <label class="check d4-warn"><input type="checkbox" id="d4Warn"> ⚠ Show where a rival wins next</label></div>`;
    try { document.getElementById('d4Warn').checked = !!localStorage.getItem('dropfour.warn'); } catch {}
    document.getElementById('d4Warn').onchange = (e) => { try { localStorage.setItem('dropfour.warn', e.target.checked ? '1' : ''); } catch {} ctx.rerender(); };
    board = main.querySelector('.d4');
    document.getElementById('bombBtn').onclick = () => { bombArmed = !bombArmed; pullArmed = false; ctx.rerender(); };
    document.getElementById('pullBtn').onclick = () => { pullArmed = !pullArmed; bombArmed = false; ctx.rerender(); };
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
          cell.onpointerenter = () => hover(col);
          board.append(cell);
        }
      gridKeys(board, cols);
      board.onpointerleave = () => hover(-1);
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
      const pullable = pullArmed && Math.floor(i / cols) === rows - 1 && (d.pulls || []).includes(i % cols);
      cell.classList.toggle('pullable', pullable);
      cell.disabled = !ctx.myTurn || (pullArmed && !pullable);
    });
    // the win line lights up disc by disc
    (d.line || []).forEach(([r, c], k) => board.children[r * cols + c]?.style.setProperty('--k', k));
    // ⚠ (on this device, if asked for) the columns where a rival's next disc makes four
    const warn = document.getElementById('d4Warn')?.checked && S.phase === 'playing' && d.me != null;
    const danger = warn ? threats(d.grid, d.me) : new Set();
    [...board.children].forEach((cell, i) => cell.classList.toggle('danger', Math.floor(i / cols) === 0 && danger.has(i % cols)));
    juice(d, rows, cols);
    board.classList.toggle('armed', bombArmed);
    board.classList.toggle('pulling', pullArmed);

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
      const m = ctx.el('span', 'd4-move' + (i === moves.length - 1 ? ' now' : ''), bomb === 'pull' ? `⬇${col + 1}` : bomb ? `💣${col + 1}` : String(col + 1));
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
    const pb = document.getElementById('pullBtn');
    pb.hidden = !(d.pulls && S.phase === 'playing' && (d.pulls.length || pullArmed) && ctx.myTurn);
    if (pb.hidden) pullArmed = false;
    pb.classList.toggle('on', pullArmed);
    pb.textContent = pullArmed ? '⬇️ Tap one of your bottom discs (tap here to cancel)' : '⬇️ Pull a disc';
  }

  // columns where some rival dropping a disc next would line up four
  function threats(grid, me) {
    const rows = grid.length, cols = grid[0].length, out = new Set();
    const seats = new Set(grid.flat().filter((v) => v != null && v !== me));
    for (let c = 0; c < cols; c++) {
      let r = rows - 1; while (r >= 0 && grid[r][c] != null) r--;
      if (r < 0) continue;
      for (const s of seats) {
        const at = (y, x) => y >= 0 && y < rows && x >= 0 && x < cols && (y === r && x === c ? s : grid[y][x]) === s;
        for (const [dy, dx] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
          let n = 1;
          for (let k = 1; k < 4 && at(r + dy * k, c + dx * k); k++) n++;
          for (let k = 1; k < 4 && at(r - dy * k, c - dx * k); k++) n++;
          if (n >= 4) out.add(c);
        }
      }
    }
    return out;
  }

  // the column under the pointer glows, with a ghost of my disc at the top of it
  function hover(col) {
    const cols = +board.style.getPropertyValue('--cols') || 7;
    const mine = ctx?.player(S.me.id)?.color;
    [...board.children].forEach((cell, i) => cell.classList.toggle('col-hot', ctx?.myTurn && i % cols === col));
    if (mine) board.style.setProperty('--mine', mine);
  }

  // sounds and shakes for what just happened: a disc landing (after its fall), a bomb, a pull, a win
  function juice(d, rows, cols) {
    const moves = d.moves || [], n = moves.length;
    const grid = JSON.stringify(d.grid);
    if (seenMoves >= 0 && n > seenMoves) {
      const [, , how] = moves[n - 1];
      if (how === 'pull' || how === true) {
        ctx.sfx(how === true ? 'boom' : 'whoosh');
        if (how === true) Kit.callout('💣 BOOM', 'bad', { ms: 1000 });
        if (how === true) { ctx.buzz(60); if (motionOK()) { board.classList.remove('shake'); void board.offsetWidth; board.classList.add('shake'); } }
        // discs that changed after a bomb or pull slide down into place
        const before = prevGrid ? JSON.parse(prevGrid) : null;
        if (before) [...board.children].forEach((cell, i) => {
          const r = Math.floor(i / cols), c = i % cols;
          const moved = d.grid[r][c] != null && before[r][c] !== d.grid[r][c];
          cell.classList.remove('settle'); if (moved && motionOK()) { void cell.offsetWidth; cell.classList.add('settle'); }
        });
      } else if (d.last) {
        setTimeout(() => ctx.sfx('place'), (250 + (d.last[0] + 1) * 60));
      }
      if (d.line) {
        setTimeout(() => ctx.sfx('good'), 500);
        const wonBy = d.grid[d.line[0][0]][d.line[0][1]];
        setTimeout(() => Kit.callout(wonBy === d.me ? '🔴 Four!' : 'Four in a row', wonBy === d.me ? 'gold' : 'cool', { ms: 1400 }), 650);
      }
    }
    seenMoves = n; prevGrid = grid;
  }

  function drop(col) {
    if (!ctx.myTurn) return;
    if (pullArmed) { pullArmed = false; return ctx.quiet(ctx.act('pull', { col })); }
    const bomb = bombArmed;
    bombArmed = false;
    ctx.quiet(ctx.act('drop', { col, bomb }));
  }

  return { mount, render, ownSounds: true };
})();
