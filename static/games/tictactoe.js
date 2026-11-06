UI.tictactoe = (() => {
  let S, ctx, grid, built = 0, prev = null, last = -1, strike = null, struck = '', me = -1;
  // the marks are pen strokes that draw themselves in (Kit.ink: an ✖ is two strokes, a ◯ one loop)
  const SVGNS = 'http://www.w3.org/2000/svg';
  const drawMark = (seat) => Kit.ink(seat);

  function mount(main, side) {
    built = 0; prev = null; last = -1;
    main.innerHTML = '<div class="ttt"></div>';
    side.innerHTML = '<div class="panel" id="tttInfo"></div>';
    grid = main.querySelector('.ttt');
    strike = null; struck = '';
  }

  function build(n) {  // 3×3 or 4×4
    built = n; grid.innerHTML = ''; strike = null; struck = '';
    grid.style.setProperty('--n', n);
    grid.classList.toggle('big', n === 4);
    for (let i = 0; i < n * n; i++) {
      const b = document.createElement('button');
      b.className = 'ttt-cell';
      b.onclick = () => ctx.quiet(ctx.act('move', { cell: i }));
      // a faint ghost of your mark where you're pointing (or focused), before you commit
      const ghostOn = () => { if (ctx?.myTurn && !b.disabled && me >= 0 && !b.querySelector('.ghost')) { const g = Kit.ink(me, true); g.classList.add('ghost'); b.append(g); } };
      const ghostOff = () => b.querySelector('.ghost')?.remove();
      b.onpointerenter = (e) => e.pointerType === 'mouse' && ghostOn();
      b.onpointerleave = ghostOff; b.onfocus = () => b.matches(':focus-visible') && ghostOn(); b.onblur = ghostOff;
      grid.append(b);
    }
    gridKeys(grid, n);
    // the grid itself is drawn in pen too, line by line
    const lines = document.createElementNS(SVGNS, 'svg');
    lines.setAttribute('viewBox', '0 0 100 100'); lines.setAttribute('preserveAspectRatio', 'none'); lines.setAttribute('class', 'ttt-grid');
    for (let k = 1; k < n; k++) for (const d of [`M${(100 * k) / n} 3 V97`, `M3 ${(100 * k) / n} H97`]) {
      const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); p.setAttribute('pathLength', '100');
      p.style.animationDelay = `${lines.childElementCount * 0.08}s`;
      lines.append(p);
    }
    grid.append(lines);
  }

  function render(s, c) {
    S = s; ctx = c;
    const t = S.ttt, n = t.n || 3;
    if (built !== n) { build(n); prev = null; }
    // the newest mark gets an outline (and pops in), so you can see what was just played
    if (prev && prev.length === t.cells.length) {
      const fresh = t.cells.findIndex((v, i) => v != null && prev[i] !== v);
      if (fresh >= 0) last = fresh;
    }
    if (t.cells.every((v) => v == null)) last = -1;
    prev = [...t.cells];
    [...grid.querySelectorAll('.ttt-cell')].forEach((b, i) => {  // (the pen overlays aren't cells)
      const v = t.cells[i];
      if (String(v) !== b.dataset.v) {
        b.dataset.v = String(v);
        b.replaceChildren();
        if (v != null) b.append(drawMark(v), ctx.el('span', 'sr-only', t.marks[v]));
      }
      b.style.color = v == null ? '' : ctx.player(t.seats[v])?.color ?? '#999';
      b.classList.toggle('mark', v != null);
      b.setAttribute('aria-label', `row ${Math.floor(i / n) + 1}, column ${i % n + 1}, ${v == null ? 'empty' : `${ctx.player(t.seats[v])?.name ?? '?'}'s ${t.marks[v]}`}${t.fading.includes(i) ? ', fades next' : ''}`);
      b.classList.toggle('fading', t.fading.includes(i));
      b.classList.toggle('win', !!t.line?.includes(i));
      b.classList.toggle('last', i === last && v != null && !t.line);
      b.disabled = !ctx.myTurn || v != null;
    });
    drawStrike(t, n);
    const lineNew = Kit.changed('ttt-line', t.line || null);
    if (t.line && lineNew) ctx.sfx('crack');
    // a full board and no line: the cat gets this one
    const drawn = S.phase === 'over' && !S.winner && !t.line;
    if (drawn && Kit.changed('ttt-cat', S.gameNo)) { Kit.callout("🐱 Cat's game", 'cool', { ms: 1500 }); ctx.sfx('bad'); }
    me = t.seats.indexOf(S.me.id);
    const info = document.getElementById('tttInfo'); info.innerHTML = '';
    t.seats.forEach((pid, i) => {
      const p = ctx.player(pid);
      const row = ctx.el('div', 'seat-row', `${t.marks[i]}  ${p?.name ?? '—'}${pid === S.me.id ? ' (you)' : ''}`);
      row.style.color = p?.color ?? '';
      // the series: wins at Tic-Tac-Toe tonight
      row.append(ctx.el('b', 'ttt-wins', '🏆'.repeat(Math.min(5, p?.byGame?.tictactoe || 0)) + ((p?.byGame?.tictactoe || 0) > 5 ? `×${p.byGame.tictactoe}` : '')));
      info.append(row);
    });
    if (S.settings.variant === 'vanishing')
      info.append(ctx.el('p', 'hint', `👻 Vanishing: you only keep ${n} marks. Your faded mark disappears when you place the next one.`));
    if (n === 4) info.append(ctx.el('p', 'hint', 'Four in a row wins: across, down or corner to corner.'));
  }

  // a pen line through the winning row, from the first square's centre to the last one's
  function drawStrike(t, n) {
    const key = t.line ? t.line.join() : '';
    if (key === struck) return;
    struck = key;
    strike?.remove(); strike = null;
    if (!t.line) return;
    const c = (i) => [((i % n) + 0.5) * 100 / n, (Math.floor(i / n) + 0.5) * 100 / n];
    const [a, b] = [c(t.line[0]), c(t.line.at(-1))];
    const ext = 0.32 * 100 / n, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const ux = dx / len * ext, uy = dy / len * ext;
    strike = document.createElementNS(SVGNS, 'svg');
    strike.setAttribute('viewBox', '0 0 100 100'); strike.setAttribute('preserveAspectRatio', 'none'); strike.setAttribute('class', 'ttt-strike');
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', `M${a[0] - ux} ${a[1] - uy} L${b[0] + ux} ${b[1] + uy}`); p.setAttribute('pathLength', '100');
    strike.append(p);
    grid.append(strike);
  }

  return { mount, render };
})();
